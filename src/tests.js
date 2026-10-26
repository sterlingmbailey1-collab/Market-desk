/* Unit tests for MD.core. Runs in Node (tests/run.js) and in the app (Settings → Self-test). */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const T = [];
  const test = (name, fn) => T.push({ name, fn });
  const eq = (a, b, msg) => { if (String(a) !== String(b)) throw new Error((msg || "") + " expected " + b + " got " + a); };
  const near = (a, b, tol, msg) => { if (!(Math.abs(Number(a) - Number(b)) <= tol)) throw new Error((msg || "") + " expected ≈" + b + " got " + a); };
  const ok = (c, msg) => { if (!c) throw new Error(msg || "assertion failed"); };

  test("learned weights for the specialist panel from graded estimates", () => {
    const Q = MD.quant, rows = Array.from({ length: 30 }, (_, i) => ({ lead: 50, quant: i % 2 ? 80 : 20, news: i % 2 ? 10 : 90, up: !!(i % 2) }));
    const w = Q.memberWeights(rows, ["lead", "quant", "news", "fundamentals"], 20);
    near(w.weights.lead, 1, 1e-9, "a coin flip weighs 1"); eq(w.weights.quant, 2, "a member that's been right is capped at 2×"); eq(w.weights.news, 0.5, "one that's been wrong floors at 0.5×"); eq(w.weights.fundamentals, 1, "no record yet");
    near(w.stats.quant.brier, 0.04, 1e-9); eq(w.stats.quant.hitPct, 100); ok(w.learned);
    eq(Q.memberWeights(rows.slice(0, 10), ["quant"], 20).weights.quant, 1, "too few graded estimates");
  });
  test("portfolio health score against the risk band", () => {
    const Q = MD.quant, good = Q.healthScore({ effective: 9, topWeightPct: 12, volPct: 14, maxDrawdownPct: -15, avgCorr: 0.3, risk: "mid" });
    eq(good.parts.length, 5); eq(good.parts.find(p => p.key === "diversification").value, 100); eq(good.parts.find(p => p.key === "concentration").value, 100); eq(good.parts.find(p => p.key === "independence").value, 70);
    eq(good.score, Math.round((100 + 100 + 100 + 100 + 70) / 5));
    const bad = Q.healthScore({ effective: 2, topWeightPct: 60, volPct: 45, maxDrawdownPct: -40, avgCorr: null, risk: "low" });
    eq(bad.parts.length, 4); eq(bad.parts.find(p => p.key === "diversification").value, 25); eq(bad.parts.find(p => p.key === "concentration").value, 0); eq(bad.parts.find(p => p.key === "volatility").value, 0); ok(bad.score < 20);
  });
  test("desk consensus: latest call per source per horizon, weighted, with agreement and spread", () => {
    const Q = MD.quant, c = [{ source: "ml", upPct: 55, horizonDays: 30, at: 1 }, { source: "ml", upPct: 40, horizonDays: 30, at: 2 }, { source: "ai-decide", upPct: 70, horizonDays: 91, at: 3 }, { source: "ai-picks", upPct: 64, horizonDays: 75, at: 4 }, { source: "ai-day", upPct: 52, horizonDays: 1, at: 5 }];
    const r = Q.deskConsensus(c, (s) => s === "ai-decide" ? 2 : 1);
    eq(r.length, 2); eq(r[0].key, "days"); eq(r[0].n, 1); near(r[0].upPct, 52, 1e-9);
    const m = r[1]; eq(m.n, 3, "ML's newer call replaces its older one"); near(m.upPct, (40 + 70 * 2 + 64) / 4, 1e-9); near(m.agreePct, 75, 1e-9, "ML leans the other way"); near(m.spread, 30, 1e-9);
  });
  test("ML Platt calibration: overconfident odds are shrunk, and only when it helps on held-back data", () => {
    const C = MD.core, r = C.rng(5), sig = (x) => 1 / (1 + Math.exp(-x)), ps = [], ys = [];
    for (let i = 0; i < 900; i++) { const z = C.gauss(r); ps.push(sig(3 * z)); ys.push(r() < sig(z) ? 1 : 0); }
    const p = MD.ml.platt(ps, ys);
    ok(p.used && p.brierCal < p.brierRaw, JSON.stringify({ used: p.used, raw: p.brierRaw, cal: p.brierCal }));
    ok(p.slope > 0.2 && p.slope < 0.5, "slope near 1/3: " + p.slope);
    ok(p.apply(0.95) < 0.8 && p.apply(0.05) > 0.2, "extreme odds pulled in");
    eq(MD.ml.platt(ps.slice(0, 100), ys.slice(0, 100)).used, false, "too few predictions");
  });
  test("ML reliability table bins out-of-sample odds against outcomes", () => {
    const r = MD.ml.reliability([0.3, 0.35, 0.5, 0.65, 0.7, 0.62], [0, 1, 1, 1, 1, 0]);
    eq(r.length, 3); eq(r[0].n, 2); near(r[0].predictedPct, 32.5, 1e-9); near(r[0].actualPct, 50, 1e-9);
    eq(r[1].n, 1); eq(r[2].n, 3); near(r[2].actualPct, 200 / 3, 1e-9); near(r[2].to, 1, 1e-12);
  });
  test("rebalancing maths: minimum variance (with a cap) and equal risk contribution", () => {
    const Q = MD.quant, two = [[0.04, 0], [0, 0.01]];
    const mv = Q.minVarWeights(two); near(mv[0], 0.2, 1e-6, "inverse variance when uncorrelated"); near(mv[1], 0.8, 1e-6);
    const mc = Q.minVarWeights(two, 0.6); near(mc[0], 0.4, 1e-6, "the cap binds"); near(mc[1], 0.6, 1e-6);
    const e2 = Q.ercWeights(two); near(e2[0], 1 / 3, 1e-6, "inverse volatility when uncorrelated"); near(e2[1], 2 / 3, 1e-6);
    const S = [[0.09, 0.03, 0.01], [0.03, 0.04, 0.006], [0.01, 0.006, 0.0225]], e3 = Q.ercWeights(S), rs = Q.riskShares(S, e3);
    near(e3.reduce((a, x) => a + x, 0), 1, 1e-9); for (const r of rs) near(r, 1 / 3, 1e-6, "equal risk shares");
    const m3 = Q.minVarWeights(S), v = (w) => w.reduce((a, x, i) => a + x * S[i].reduce((b, y, j) => b + y * w[j], 0), 0);
    ok(m3.every(x => x >= -1e-12) && Math.abs(m3.reduce((a, x) => a + x, 0) - 1) < 1e-9, "long-only, fully invested");
    ok(v(m3) <= v(e3) + 1e-12 && v(m3) <= v([1 / 3, 1 / 3, 1 / 3]) + 1e-12, "least variance of the three mixes");
  });
  test("news sentiment score: materiality and recency weights, labels", () => {
    const Q = MD.quant, now = Date.parse("2026-10-26T12:00:00Z"), d = (n) => now - n * 864e5;
    eq(Q.newsScore([], now).score, "null");
    const a = Q.newsScore([{ s: 2, mat: 3, ts: d(0) }, { s: -2, mat: 1, ts: d(6) }], now);
    near(a.score, Math.round((3 * 1 - 1 * 0.25) / 3.25 * 100), 0.5, "fresh material good news outweighs old minor bad news"); eq(a.label, "positive");
    eq(Q.newsScore([{ s: -1, mat: 2, ts: d(1) }, { s: 1, mat: 2, ts: d(1) }], now).label, "mixed");
    eq(Q.newsScore([{ s: 0, mat: 1, ts: d(0) }], now).label, "neutral");
    eq(Q.newsScore([{ s: -2, mat: 3, ts: d(0) }], now).score, -100);
  });
  test("tax-year summary: FIFO lots split short- and long-term, dividends by year", () => {
    const C = MD.core, tx = (o) => Object.assign({ assetId: "stock:AAA", assetClass: "stock", symbol: "AAA", currency: "USD", fees: "0", createdAt: 1 }, o);
    const { positions } = C.buildPositions([tx({ id: "a", type: "buy", tradeDate: "2024-01-02", quantity: "10", price: "100" }), tx({ id: "b", type: "buy", tradeDate: "2025-06-01", quantity: "10", price: "120" }), tx({ id: "d", type: "dividend", tradeDate: "2025-03-01", amount: "20" }), tx({ id: "c", type: "sell", tradeDate: "2025-09-01", quantity: "15", price: "150" })]);
    const ys = C.taxYears([...positions.values()], () => C.ONE);
    eq(ys.length, 1); eq(ys[0].year, "2025"); eq(ys[0].longTerm, "500", "10 shares from the 2024 lot"); eq(ys[0].shortTerm, "150", "5 shares from the 2025 lot"); eq(ys[0].dividends, "20"); eq(ys[0].sales, 1);
    const none = C.taxYears([...positions.values()], () => null); eq(none[0].unknownRates, 2); eq(none[0].longTerm, "0");
  });
  test("paper account: cash, fractional sells, the SPY mirror, and no margin or shorting", () => {
    const C = MD.core, a = { assetId: "stock:AAA", symbol: "AAA" };
    const L = C.paperLedger([
      Object.assign({ id: "1", side: "buy", qty: 10, price: 100, spyPrice: 500, createdAt: 1, source: "pick" }, a),
      Object.assign({ id: "2", side: "buy", qty: 1000, price: 100, spyPrice: 500, createdAt: 2 }, a),
      Object.assign({ id: "3", side: "sell", qty: 5, price: 120, spyPrice: 550, createdAt: 3 }, a),
      { id: "4", side: "sell", assetId: "stock:BBB", symbol: "BBB", qty: 1, price: 10, createdAt: 4 }], 10000);
    near(L.cash, 9600, 1e-9, "cash after a 1000 buy and a 600 sale"); eq(L.issues.length, 2, "over-cash buy and unheld sell skipped");
    eq(L.positions.length, 1); near(L.positions[0].qty, 5, 1e-12); near(L.positions[0].cost, 500, 1e-9); near(L.positions[0].mirror, 1, 1e-12, "half the 2 SPY shares remain");
    eq(L.closed.length, 1); near(L.closed[0].pnlPct, 20, 1e-9); near(L.closed[0].mirrorPct, 10, 1e-9, "SPY rose 10% over the same holding"); eq(L.closed[0].sources[0], "pick");
    near(L.mirrorCash, 9550, 1e-9);
    const v = C.paperValue(L, { "stock:AAA": 130 }, 600, 10000);
    near(v.equity, 9600 + 650, 1e-9); near(v.mirrorEquity, 9550 + 600, 1e-9); near(v.returnPct, 2.5, 1e-9); eq(v.missing.length, 0);
    const fee = C.paperLedger([Object.assign({ id: "f", side: "buy", qty: 10, price: 100, feeRate: 0.001, createdAt: 1 }, a)], 2000);
    near(fee.cash, 2000 - 1001, 1e-9, "the fee is charged on the buy"); ok(!fee.positions[0].mirrorKnown, "no SPY price → mirror unknown");
  });
  test("decimal arithmetic avoids binary float error", () => { const C = MD.core; eq(C.dec("0.1").plus(C.dec("0.2")), "0.3"); eq(C.dec("1,234.50"), "1234.5"); eq(C.dec("abc"), "null"); });
  test("registry distinguishes fiat, metals, crypto, stablecoins", () => {
    const r = MD.core.makeRegistry([{ code: "KWD", name: "Kuwaiti dinar", minor: 3 }]);
    eq(r.get("XAU").type, "metal"); eq(r.get("USD").type, "fiat"); eq(r.get("USDT").type, "stablecoin"); eq(r.get("JPY").minor, 0); eq(r.get("KWD").minor, 3); ok(r.get("KWD").custom);
    ok(r.get("NGN").note.length > 0, "restricted currency carries a note");
  });
  test("market pair conventions", () => {
    const C = MD.core;
    eq(C.marketPair("USD", "EUR").base, "EUR"); eq(C.marketPair("JPY", "USD").base, "USD"); eq(C.marketPair("MXN", "USD").base, "USD");
    eq(C.marketPair("GBP", "EUR").base, "EUR"); eq(C.marketPair("USD", "XAU").base, "XAU"); eq(C.marketPair("BRL", "MXN").convention, "none (alphabetical)");
  });
  test("conversion in both directions round-trips", () => {
    const C = MD.core; const q = C.quote("EUR", "USD", "1.0850");
    const usd = C.convert("100", q); eq(usd, "108.5");
    const back = C.convert(usd, C.invert(q)); near(back, 100, 1e-20);
  });
  test("cross rate through a pivot records legs and flags skew", () => {
    const C = MD.core;
    const a = C.quote("USD", "EUR", "0.9", { ts: 0 }), b = C.quote("USD", "JPY", "150", { ts: 10 * 60 * 1000 });
    const x = C.cross(a, b); eq(x.base, "EUR"); eq(x.quote, "JPY"); near(x.rate, 166.6666667, 1e-6); eq(x.legs.length, 2); ok(x.warnings.length === 1, "skew warning");
    const table = { pivot: "USD", rates: { EUR: "0.9", JPY: "150" }, ts: 1, source: "t" };
    near(C.rateFromTable(table, "JPY", "EUR").rate, 0.006, 1e-12); eq(C.rateFromTable(table, "USD", "USD").rate, "1"); eq(C.rateFromTable(table, "USD", "ZZZ"), "null");
  });
  test("spread in basis points", () => { near(MD.core.spreadBps("1.1000", "1.1002"), 1.818, 0.001); eq(MD.core.spreadBps("2", "1"), "null"); });
  test("money formatting uses currency minor units and codes", () => {
    const C = MD.core, r = C.makeRegistry();
    eq(C.fmtMoney("1234.5", "USD", r), "1,234.50 USD"); eq(C.fmtMoney("1234.5", "JPY", r), "1,235 JPY"); eq(C.fmtMoney("-0.005", "EUR", r), "-0.01 EUR"); eq(C.fmtMoney("2.345", "USD", r), "2.35 USD"); eq(C.fmtMoney("2.5", "USD", r, { sign: true }), "+2.50 USD");
  });
  test("metal weight conversions", () => {
    const C = MD.core; near(C.convertWeight(1, "toz", "g"), 31.1034768, 1e-9); near(C.convertWeight(1, "kg", "toz"), 32.1507466, 1e-6); near(C.convertWeight(31.1034768, "g", "toz"), 1, 1e-12);
  });
  test("bullion economics: premium, spread, net liquidation, breakeven", () => {
    const b = MD.core.bullion({ quantity: 10, unitWeight: 1, unit: "toz", purity: "0.9999", spotPerToz: 2000, dealerPremiumPct: 4, buySellSpreadPct: 3, shipping: 25, insurance: 5, storagePerYear: 0, years: 0, taxPct: 0 });
    near(b.fineToz, 9.999, 1e-9); near(b.meltValue, 19998, 1e-6); near(b.premium, 799.92, 1e-6); near(b.acquisition, 20827.92, 1e-6); near(b.netLiquidation, 19398.06, 1e-6);
    near(b.breakevenSpot, 20827.92 / 9.999 / 0.97, 1e-6);
  });
  const reg = () => MD.core.makeRegistry();
  const tx = (o) => Object.assign({ id: Math.random().toString(36).slice(2), createdAt: 0, assetId: "stock:SAP", assetClass: "stock", symbol: "SAP", currency: "EUR", fees: "0" }, o);
  test("FIFO lots, fees in cost basis, realized P&L", () => {
    const txs = [tx({ id: "a", type: "buy", tradeDate: "2024-01-02", quantity: "10", price: "100", fees: "5" }), tx({ id: "b", type: "buy", tradeDate: "2024-02-01", quantity: "10", price: "120" }), tx({ id: "c", type: "sell", tradeDate: "2024-03-01", quantity: "15", price: "130", fees: "2" })];
    const { positions } = MD.core.buildPositions(txs); const p = positions.get("stock:SAP");
    eq(p.qty, "5"); eq(p.lots.length, 1); eq(p.lots[0].cost, "600");
    const r = p.realized[0]; eq(r.proceeds, "1948"); eq(r.cost, "1605"); eq(r.pnl, "343");
  });
  test("reversal removes a transaction without editing history", () => {
    const txs = [tx({ id: "a", type: "buy", tradeDate: "2024-01-02", quantity: "10", price: "100" }), tx({ id: "b", type: "buy", tradeDate: "2024-01-03", quantity: "99", price: "100" }), { id: "r", type: "reversal", reverses: "b", tradeDate: "2024-01-04", createdAt: 1 }];
    const { positions } = MD.core.buildPositions(txs); eq(positions.get("stock:SAP").qty, "10"); eq(txs.length, 3, "originals kept");
  });
  test("overselling is capped and reported", () => {
    const { positions, issues } = MD.core.buildPositions([tx({ type: "buy", tradeDate: "2024-01-01", quantity: "1", price: "10" }), tx({ type: "sell", tradeDate: "2024-01-02", quantity: "3", price: "10" })]);
    eq(positions.get("stock:SAP").qty, "0"); eq(issues.length, 1);
  });
  test("native vs reporting P&L with exact FX decomposition", () => {
    // Bought 10 SAP at 100 EUR when EUR->USD = 1.10. Now 120 EUR and EUR->USD = 1.00.
    const { positions } = MD.core.buildPositions([tx({ type: "buy", tradeDate: "2024-01-02", quantity: "10", price: "100" })]);
    const v = MD.core.valuePosition(positions.get("stock:SAP"), "120", "1.00", () => MD.core.dec("1.10"));
    eq(v.pnlN, "200"); eq(v.costR, "1100"); eq(v.valueR, "1200"); eq(v.pnlR, "100"); eq(v.priceEffectR, "200"); eq(v.fxEffectR, "-100");
    eq(v.priceEffectR.plus(v.fxEffectR), v.pnlR.toString(), "decomposition sums"); eq(v.costBasisStatus, "historical");
    const v2 = MD.core.valuePosition(positions.get("stock:SAP"), "120", "1.00", () => null); eq(v2.costBasisStatus, "estimated"); eq(v2.fxEffectR, "0");
  });
  test("realized P&L in reporting currency uses sale-date and lot-date rates", () => {
    const { positions } = MD.core.buildPositions([tx({ type: "buy", tradeDate: "2024-01-02", quantity: "10", price: "100" }), tx({ type: "sell", tradeDate: "2024-06-01", quantity: "10", price: "110" })]);
    const rates = { "2024-01-02": "1.10", "2024-06-01": "1.05" };
    const r = MD.core.realizedInReporting(positions.get("stock:SAP"), (d) => MD.core.dec(rates[d]));
    near(r.pnl, 1100 * 1.05 - 1000 * 1.10, 1e-9); near(r.fxEffect, 1000 * (1.05 - 1.10), 1e-9);
  });
  test("validation rejects bad transactions", () => {
    const errs = MD.core.validateTx({ type: "buy", tradeDate: "2024-13", assetId: "x", currency: "ZZZ", quantity: "-1", price: "a" }, reg());
    ok(errs.length >= 4, "multiple errors: " + errs.join(" | ")); ok(!MD.core.validDate("2024-02-30")); ok(MD.core.validDate("2024-02-29"));
  });
  test("reward-to-risk with costs; undefined when downside is not defined", () => {
    const C = MD.core;
    const r = C.rewardRisk({ entry: 100, target: 120, stop: 90, feePct: 0.1, fxCostPct: 0 });
    near(r.netUpPct, 19.8, 1e-9); near(r.netDownPct, 10.2, 1e-9); near(r.ratio, 19.8 / 10.2, 1e-9); near(r.breakevenWinRatePct, 10.2 / 30 * 100, 1e-9);
    const u = C.rewardRisk({ entry: 100, target: 120, stop: 100 }); eq(u.ratio, "null"); ok(/undefined/.test(u.ratioReason));
    const n = C.rewardRisk({ entry: 100, target: 120 }); eq(n.ratio, "null");
    const s = C.rewardRisk({ entry: 100, target: 80, stop: 110, side: "short" }); near(s.ratio, 2, 1e-9);
  });
  test("statistics: volatility, drawdown, CAGR", () => {
    const C = MD.core;
    const dd = C.maxDrawdown([100, 120, 90, 130, 65]); near(dd.mdd, -0.5, 1e-12);
    near(C.cagr(100, 121, 2), 0.1, 1e-12);
    const flat = Array.from({ length: 50 }, () => 100); eq(C.annVol(flat), "0");
  });
  test("seeded simulations are reproducible", () => {
    const C = MD.core;
    const a = C.touchProbability({ entry: 100, target: 110, stop: 95, days: 60, sigma: 0.3, seed: 1, paths: 500 });
    const b = C.touchProbability({ entry: 100, target: 110, stop: 95, days: 60, sigma: 0.3, seed: 1, paths: 500 });
    eq(a.pTarget, b.pTarget); near(a.pTarget + a.pStop + a.pNeither, 1, 1e-12);
    const g = C.goalSimulation({ start: 10000, monthly: 100, years: 10, muPct: 5, volPct: 15, inflationPct: 2, paths: 300, seed: 3, goal: 20000 });
    eq(g.rows.length, 11); ok(g.rows[10].p90 >= g.rows[10].p50 && g.rows[10].p50 >= g.rows[10].p10); eq(g.contributed, 22000);
  });
  test("backtest: buy-and-hold equals price return; costs reduce returns", () => {
    const C = MD.core; const pts = Array.from({ length: 300 }, (_, i) => ({ time: 1.6e9 + i * 86400, close: 100 + i * 0.1 + 20 * Math.sin(i / 15) }));
    const bh = C.backtest(pts, { type: "buyhold" }); near(bh.totalReturnPct, (pts[299].close / pts[0].close - 1) * 100, 1e-9);
    const sm0 = C.backtest(pts, { type: "sma", fast: 10, slow: 30 }, { costBps: 0 }), sm1 = C.backtest(pts, { type: "sma", fast: 10, slow: 30 }, { costBps: 50 });
    ok(sm1.totalReturnPct < sm0.totalReturnPct, "costs reduce return"); ok(sm0.trades > 1);
    const dca = C.backtest(pts, { type: "dca" }); ok(dca.trades >= 9);
  });
  test("FX stress and ripple scenarios", () => {
    const C = MD.core;
    const s = C.fxStress([{ currency: "EUR", valueR: C.dec(1000) }, { currency: "JPY", valueR: C.dec(500) }, { currency: "USD", valueR: C.dec(9999) }], { EUR: -10, JPY: 5 }, "USD");
    eq(s.total, "-75"); eq(s.rows.length, 2);
    const r = C.ripple([{ id: "a", valueR: C.dec(1000), betas: { equities: 1.2 } }, { id: "b", valueR: C.dec(500), betas: { crypto: 1 } }], { equities: -10, crypto: -20 });
    eq(r.total, "-220");
    const c = C.catalystImpact({ price: 100, pEvent: 30, upPct: 20, downPct: -5 }); near(c.expectedMovePct, 2.5, 1e-12);
  });
  test("forecast evaluation and calibration", () => {
    const C = MD.core;
    const e = C.evaluateForecast({ priceAtCreation: 100, direction: "up", probability: 0.7, target: 120 }, 110);
    ok(e.directionHit); near(e.brier, 0.09, 1e-12); near(e.targetErrorPct, -8.333333, 1e-5);
    const miss = C.evaluateForecast({ priceAtCreation: 100, direction: "up", probability: 0.8 }, 95); ok(!miss.directionHit); near(miss.brier, 0.64, 1e-12);
    const mv = C.evaluateForecast({ priceAtCreation: 100, direction: "move", movePct: 15, probability: 0.6 }, 84); ok(mv.directionHit, "a 16% drop counts as a 15% move");
    ok(!C.evaluateForecast({ priceAtCreation: 100, direction: "move", movePct: 15, probability: 0.6 }, 110).directionHit, "10% is not a 15% move");
    const cal = C.calibration([Object.assign({ probability: 0.7 }, e), Object.assign({ probability: 0.8 }, miss)]); eq(cal.n, 2); near(cal.hitRate, 0.5, 1e-12);
  });
  test("alerts trigger once and re-arm only after the condition clears", () => {
    const C = MD.core, a = { kind: "above", threshold: 100 };
    let r = C.evaluateAlert(a, 101, null); ok(r.triggered);
    r = C.evaluateAlert(a, 102, r.state); ok(!r.triggered, "deduped");
    r = C.evaluateAlert(a, 99.9, r.state); ok(!r.triggered && !r.state.armed, "hysteresis keeps it disarmed");
    r = C.evaluateAlert(a, 99, r.state); ok(r.state.armed, "re-armed");
    r = C.evaluateAlert(a, 101, r.state); ok(r.triggered, "triggers again");
    ok(C.inQuietHours(new Date(2024, 0, 1, 23, 0), { enabled: true, start: "22:00", end: "07:00" })); ok(!C.inQuietHours(new Date(2024, 0, 1, 12, 0), { enabled: true, start: "22:00", end: "07:00" }));
  });
  test("CSV import: quoting, validation errors, duplicate detection", () => {
    const C = MD.core;
    const csv = 'date,type,asset_class,symbol,quantity,price,currency,fees,note\n2024-01-02,buy,stock,SAP,10,100,EUR,1,"first, lot"\n2024-01-02,buy,stock,SAP,10,100,EUR,1,dup\n2024-13-01,buy,stock,SAP,1,1,EUR,0,bad\n2024-02-02,sell,stock,SAP,-1,1,EUR,0,neg';
    const r = C.csvToTxs(csv, C.makeRegistry(), []);
    eq(r.ok.length, 1); eq(r.duplicates.length, 1); eq(r.errors.length, 2); eq(r.ok[0].note, "first, lot");
    const again = C.csvToTxs(csv, C.makeRegistry(), r.ok); eq(again.ok.length, 0, "existing rows are duplicates");
    const round = C.parseCSV(C.toCSV([["a,b", 'q"x', "plain"]])); eq(round[0][0], "a,b"); eq(round[0][1], 'q"x');
    eq(C.csvToTxs("symbol\nX", C.makeRegistry(), []).errors[0].line, 1);
  });
  test("fuzzy search tolerates misspellings", () => {
    const C = MD.core; ok(C.fuzzyScore("aple", "Apple Inc.") > 0); ok(C.fuzzyScore("nvda", "NVDA") === 100); ok(C.fuzzyScore("bitcoin", "Bitcoin") > C.fuzzyScore("bit", "Bitcoin Cash") - 20); eq(C.fuzzyScore("zzzz", "Apple"), "0");
  });
  test("data freshness and anomaly checks", () => {
    const C = MD.core, now = Date.now();
    eq(C.freshness(now - 5 * 60000, "crypto", now).status, "fresh"); eq(C.freshness(now - 60 * 60000, "crypto", now).status, "delayed"); eq(C.freshness(now - 10 * 3600000, "crypto", now).status, "stale"); eq(C.freshness(null, "fx").status, "unknown");
    ok(C.anomalyCheck(100, 200, "stock")); eq(C.anomalyCheck(100, 101, "stock"), "null");
  });
  test("net liquidation and allocation", () => {
    const C = MD.core; const n = C.netLiquidation("1000", { exitCostPct: 13, fxSpreadPct: 0.5, fixedCost: 5 }); eq(n.net, "860");
    const a = C.allocation([{ value: C.dec(300), cls: "stock" }, { value: C.dec(100), cls: "crypto" }, { value: C.dec(100), cls: "stock" }], "cls");
    eq(a[0].key, "stock"); eq(a[0].pct, "80"); near(C.hhi(a.map(x => x.pct)), 0.68, 1e-12);
  });

  test("live ticks update the current bar and roll to new bars", () => {
    const C = MD.core;
    const pts = [{ time: 600, open: 10, high: 11, low: 9, close: 10.5 }];
    let r = C.applyTick(pts, "ohlc", 60, 630, 12); eq(r.op, "update"); eq(pts[0].high, 12); eq(pts[0].close, 12); eq(pts.length, 1);
    r = C.applyTick(pts, "ohlc", 60, 785, 11); eq(r.op, "append"); eq(pts[1].time, 780); eq(pts[1].open, 12); eq(pts[1].low, 11);
    eq(C.applyTick(pts, "ohlc", 60, 100, 5), "null", "ticks older than the last bar are ignored");
    const line = [{ time: 0, value: 1 }]; C.applyTick(line, "line", 86400, 3600, 2); eq(line[0].value, 2);
  });
  test("options-implied move and volatility-implied move", () => {
    const C = MD.core;
    near(C.straddleMove(100, { bid: 4, ask: 4.4 }, { bid: 3.8, ask: 4.2 }), 8.2, 1e-9);
    near(C.straddleMove(100, { last: 5 }, { bid: 0, ask: 0, last: 3 }), 8, 1e-9);
    eq(C.straddleMove(0, { last: 1 }, { last: 1 }), "null");
    near(C.expectedMoveFromVol(40, 365), 40, 1e-9); near(C.expectedMoveFromVol(40, 91.25), 20, 1e-9); eq(C.expectedMoveFromVol(0, 10), "null");
  });

  test("normal distribution helpers", () => {
    const C = MD.core;
    near(C.normCdf(0), 0.5, 1e-7); near(C.normCdf(1.959964), 0.975, 1e-6); near(C.normCdf(-1), 0.158655, 1e-6);
    near(C.normInv(0.975), 1.959964, 1e-6); near(C.normInv(0.05), -1.644854, 1e-6); near(C.normInv(0.001), -3.090232, 1e-5); near(C.normCdf(C.normInv(0.3)), 0.3, 1e-7);
  });
  test("price projection: lognormal percentiles, odds and touch probability", () => {
    const C = MD.core;
    const p = C.projectPrice({ price: 100, volPct: 20, driftPct: 0, days: 365 });
    near(p.median, 100 * Math.exp(-0.02), 1e-6, "median sits below today with zero expected return");
    near(p.p95, 100 * Math.exp(-0.02 + 0.2 * 1.644854), 1e-4); near(p.p05, 100 * Math.exp(-0.02 - 0.2 * 1.644854), 1e-4);
    near(p.mean, 100, 1e-9, "mean equals today with no drift");
    near(p.probUp, 1 - C.normCdf(0.1), 1e-7);
    near(p.probAbove(p.p75), 0.25, 1e-6); near(p.oneSigmaPct, (Math.exp(0.2) - 1) * 100, 1e-9);
    const t = p.probTouch(120), a = p.probAbove(120);
    ok(t > a && t < 2 * a + 0.02, "touching is likelier than finishing above, about twice under low drift: " + t + " vs " + a);
    const z = C.projectPrice({ price: 100, volPct: 30, driftPct: 0, days: 1e-9 * 365 }); ok(z && Math.abs(z.median - 100) < 0.01);
    const up = C.projectPrice({ price: 100, volPct: 20, driftPct: 10, days: 365 }); ok(up.median > p.median && up.probUp > p.probUp, "positive drift lifts the distribution");
    eq(C.projectPrice({ price: 0, volPct: 20, days: 30 }), "null"); eq(C.projectPrice({ price: 10, volPct: 0, days: 30 }), "null");
    near(C.impliedVolFromMove(8, 30), 8 / (Math.sqrt(2 / Math.PI) * Math.sqrt(30 / 365)), 1e-9);
  });
  test("technical indicators: RSI, EMA, MACD, beta, period returns", () => {
    const C = MD.core;
    const up = Array.from({ length: 40 }, (_, i) => 100 + i);
    eq(C.rsi(up, 14), 100); eq(C.rsi(Array(30).fill(5), 14), 50); ok(C.rsi(up.slice().reverse(), 14) < 1);
    near(C.ema([1, 2, 3], 3)[2], 2.25, 1e-12);
    ok(C.macd(up).macd > 0, "rising series has positive MACD");
    const pts = Array.from({ length: 120 }, (_, i) => ({ time: i * 86400, value: 100 * Math.exp(0.01 * Math.sin(i) + 0.001 * i) }));
    const b = C.betaTo(pts, pts); near(b.beta, 1, 1e-9); near(b.correlation, 1, 1e-9);
    const dbl = pts.map(p => ({ time: p.time, value: Math.pow(p.value, 2) / 100 })); near(C.betaTo(dbl, pts).beta, 2, 1e-9, "squared prices double log-returns");
    const daily = Array.from({ length: 400 }, (_, i) => ({ time: Date.UTC(2025, 0, 1) / 1000 + i * 86400, value: 100 + i }));
    const r = C.periodReturns(daily); near(r["1W"], (499 / 492 - 1) * 100, 1e-9); ok(r["1Y"] > 0 && r["3Y"] === undefined, "no 3Y return from 400 days");
    const t = C.technicals(daily); eq(t.trend, "up"); eq(t.cross.kind, "golden"); ok(t.rsi14 === 100 && t.rangePos === 1 && t.fromHighPct === 0);
  });
  test("odds formats convert both ways and parse every notation", () => {
    const O = MD.odds;
    near(O.amToDec(-110), 1.909090909, 1e-8); near(O.amToDec(150), 2.5, 1e-12); eq(O.amToDec(50), "null");
    eq(O.decToAm(2.5), 150); eq(O.decToAm(1.909090909), -110); eq(O.decToAm(2), 100);
    eq(O.decToFrac(2.25), "5/4"); eq(O.decToFrac(1.5), "1/2"); eq(O.decToFrac(3.75), "11/4"); eq(O.fmtFrac(2), "Evens");
    near(O.parseOdds("-110"), 1.9090909, 1e-6); eq(O.parseOdds("even"), 2); eq(O.parseOdds("5/4"), 2.25); eq(O.parseOdds("2.50"), 2.5); eq(O.parseOdds("+250"), 3.5); eq(O.parseOdds("N/A"), "null"); eq(O.parseOdds("--"), "null");
    eq(O.fmtAm(O.parseOdds("-105")), "-105"); eq(O.fmtAm(2), "+100");
  });
  test("no-vig probabilities, hold, EV, Kelly", () => {
    const O = MD.odds, d = O.amToDec(-110);
    const f = O.noVig([d, d]); near(f[0], 0.5, 1e-12); near(O.hold([d, d]), 0.0454545, 1e-6); near(O.overround([d, d]), 0.0476190, 1e-6);
    const three = O.noVig([2.25, 3.2, 3.4]); near(three.reduce((a, b) => a + b, 0), 1, 1e-12); ok(three[0] > three[2], "favourite keeps the larger share");
    const pw = O.noVig([1.2, 5.0], "power"); near(pw[0] + pw[1], 1, 1e-9); ok(pw[1] < O.noVig([1.2, 5.0])[1], "power method shades the longshot");
    near(O.edge(0.55, 2), 0.1, 1e-12); near(O.edge(0.5, d), -0.0454545, 1e-6);
    near(O.kelly(0.55, 2), 0.1, 1e-12); eq(O.kelly(0.4, 2), 0);
    near(O.edge(0.4, 2.2, 0.2), 0.4 * 1.2 - 0.4, 1e-12, "push returns the stake");
    near(O.clv(2.1, 2.0), 0.05, 1e-12);
  });
  test("parlay, arbitrage, line splits", () => {
    const O = MD.odds;
    const p = O.parlay([{ dec: 2, p: 0.5 }, { dec: 3, p: 0.4 }]); near(p.dec, 6, 1e-12); near(p.p, 0.2, 1e-12); near(p.edge, 0.2, 1e-12);
    const a = O.arbitrage([2.1, 2.1], 100); ok(a.arb); near(a.stakes[0], 50, 1e-9); near(a.returns[0], 105, 1e-9); ok(!O.arbitrage([1.9, 1.9]).arb);
    const dist = [[0, 0.25], [1, 0.25], [2, 0.25], [3, 0.25]];
    const half = O.lineProbs(dist, 1.5); near(half.win, 0.5, 1e-12); eq(half.push, 0);
    const whole = O.lineProbs(dist, 2); near(whole.win, 0.25, 1e-12); near(whole.push, 0.25, 1e-12);
    const q = O.lineProbs(dist, 1.75); ok(q.split); near(q.win, 0.375, 1e-12); near(q.push, 0.125, 1e-12);
  });
  test("normal spread/total model and Poisson soccer model", () => {
    const O = MD.odds;
    near(O.normalLine(0, 10, 0.5).win, 1 - MD.core.normCdf(0.05), 1e-12);
    const w = O.normalLine(0, 10, 0); near(w.win + w.push + w.lose, 1, 1e-12); ok(w.push > 0);
    const mu = O.impliedMean(0.6, 13.5, 2.5); near(O.normalLine(mu, 13.5, 2.5).win, 0.6, 1e-6);
    near(O.coverProb(3, 13.5, -2.5).win, O.normalLine(3, 13.5, 2.5).win, 1e-12, "-2.5 favourite must win by 3+");
    const pm = O.poissonPmf(1.4); near(pm.reduce((a, b) => a + b, 0), 1, 1e-12); near(pm[0], Math.exp(-1.4), 1e-12);
    const s = O.soccer(1.45, 0.63); near(s.home + s.draw + s.away, 1, 1e-9); ok(s.home > s.away);
    near(s.over(2.5).win + s.over(2.5).lose, 1, 1e-9); near(s.over(2.5).lose, s.totals.filter(t => t[0] <= 2).reduce((a, t) => a + t[1], 0), 1e-12);
    near(s.homeHandicap(-0.5).win, s.home, 1e-12, "home -0.5 wins exactly when home wins"); near(s.awayHandicap(0.5).win, s.away + s.draw, 1e-12);
    near(s.btts, (1 - Math.exp(-1.45)) * (1 - Math.exp(-0.63)), 1e-6);
  });
  /* ---------- quant engine ---------- */
  const series = (n, f) => Array.from({ length: n }, (_, i) => ({ time: 1.6e9 + i * 86400, close: f(i) }));
  test("base rates: rising series has a high up-rate; model shrinks toward 50% and caps at 75%", () => {
    const Q = MD.quant, r = MD.core.rng(3), g = MD.core.gauss;
    let p = 100; const up = series(900, () => (p *= Math.exp(0.002 + 0.01 * g(r))));
    const br = Q.baseRates(up, 20); ok(br && br.overall.n === 880, "880 windows"); ok(br.overall.upPct > 75, "mostly up: " + br.overall.upPct);
    eq(br.overall.independent, 44); ok(br.conditions.length >= 3, "conditions measured");
    const m = Q.directionModel(br); ok(m.upPct > 55 && m.upPct <= 75, "model " + m.upPct); near(m.upPct + m.downPct, 100, 1e-9);
    const short = Q.baseRates(up.slice(-120), 40); const ms = Q.directionModel(short);
    ok(Math.abs(ms.upPct - 50) < Math.abs(m.upPct - 50), "less evidence → closer to 50%");
    let q = 100; const flat = series(900, () => (q *= Math.exp(0.012 * g(r)))); const mf = Q.directionModel(Q.baseRates(flat, 20)); ok(Math.abs(mf.upPct - 50) < 12, "random walk near 50%: " + mf.upPct);
    eq(Q.barsFor(75, 252), 52); eq(Q.barsFor(30, 365), 30);
    const bm = Q.bigMoveChance(40, 365, 20); ok(bm.eitherPct > 40 && bm.eitherPct < 70, "either " + bm.eitherPct);
  });
  test("least squares recovers betas; factor model attributes a move", () => {
    const Q = MD.quant, r = MD.core.rng(9), g = MD.core.gauss;
    const x1 = Array.from({ length: 300 }, () => 0.01 * g(r)), x2 = Array.from({ length: 300 }, () => 0.01 * g(r));
    const y = x1.map((v, i) => 0.0005 + 1.2 * v - 0.5 * x2[i] + 0.001 * g(r));
    const f = Q.ols(y, [x1, x2]); near(f.betas[0], 1.2, 0.03); near(f.betas[1], -0.5, 0.03); near(f.alpha, 0.0005, 0.0003); ok(f.r2 > 0.95);
    let m = 100, s = 100, a = 100; const M = [], SEC = [], A = [];
    for (let i = 0; i < 300; i++) { const rm = 0.01 * g(r), rs = rm + 0.006 * g(r); m *= 1 + rm; s *= 1 + rs; a *= 1 + 0.8 * rm + 0.9 * (rs - rm) + 0.004 * g(r); const t = 1.6e9 + i * 86400; M.push({ time: t, close: m }); SEC.push({ time: t, close: s }); A.push({ time: t, close: a }); }
    const fm = Q.factorModel(A, { SPY: M, XLK: SEC }, { market: "SPY", relative: ["XLK"] });
    near(fm.betas.SPY, 0.8, 0.08); near(fm.betas.XLK, 0.9, 0.12); ok(fm.r2 > 0.8, "r2 " + fm.r2);
    const at = Q.attribute(fm, { SPY: 2, XLK: 3 }, 3.5);
    near(at.explainedPct, fm.betas.SPY * 2 + fm.betas.XLK * 1, 0.11); near(at.unexplainedPct, 3.5 - at.explainedPct, 0.11); eq(at.parts[0].factor, "SPY");
    ok(Q.recentCorrelation(A, M, 60) > 0.5);
  });
  test("day-trading maths: VWAP, opening range, pivots, ATR, gaps, RVOL, position size, trade stats", () => {
    const Q = MD.quant;
    const v = Q.vwap([{ time: 1, high: 11, low: 9, close: 10, volume: 100 }, { time: 2, high: 13, low: 11, close: 12, volume: 300 }]);
    near(v.last, 11.5, 1e-12); ok(v.upper > v.last && v.lower < v.last);
    const orr = Q.openingRange([{ time: 0, close: 5 }, { time: 60, high: 10, low: 8, close: 9 }, { time: 600, high: 12, low: 7, close: 11 }, { time: 1000, high: 20, low: 1, close: 15 }], 60, 15);
    eq(orr.high, 12); eq(orr.low, 7); ok(orr.complete);
    const pv = Q.pivots({ high: 110, low: 90, close: 100 }); near(pv.P, 100, 1e-12); near(pv.R1, 110, 1e-12); near(pv.S1, 90, 1e-12); near(pv.R2, 120, 1e-12); near(pv.S2, 80, 1e-12);
    const flat = Array.from({ length: 30 }, (_, i) => ({ time: i * 86400, open: 100, high: 102, low: 98, close: 100 })); near(Q.atr(flat).atr, 4, 1e-9); near(Q.atr(flat).atrPct, 4, 1e-9);
    const gp = [{ close: 100 }, { open: 103, high: 104, low: 99, close: 101 }, { open: 101, high: 102, low: 100, close: 101 }, { open: 104, high: 107, low: 103, close: 106 }, { open: 106, high: 106, low: 106, close: 106 }];
    const gs = Q.gapStats(gp, 3); eq(gs.n, 2); eq(gs.fillPct, 50); eq(gs.closeAboveOpenPct, 50);
    near(Q.sessionVolumeShare(1), 1, 1e-12); near(Q.sessionVolumeShare(0.05), 0.12, 1e-12); near(Q.rvol(1e6, 1e6, 1), 1, 1e-12); ok(Q.rvol(3e5, 1e6, 0.1) > 1.5, "30% of a day's volume early is heavy");
    const ps = Q.positionSize({ account: 25000, riskPct: 1, entry: 100, stop: 98, target: 106 }); eq(ps.shares, 125); near(ps.dollarsAtRisk, 250, 1e-9); near(ps.rewardRisk, 3, 1e-9); near(ps.targets[1].price, 104, 1e-9);
    eq(Q.positionSize({ account: 25000, riskPct: 1, entry: 100, stop: 98, maxPositionPct: 40 }).shares, 100);
    ok(Q.positionSize({ account: 25000, riskPct: 1, entry: 100, stop: 102 }).error, "long stop above entry rejected");
    eq(Q.positionSize({ account: 25000, riskPct: 1, entry: 100, stop: 102, side: "short" }).shares, 125);
    const st = Q.tradeStats([{ side: "long", entry: 10, exit: 11, shares: 100, stop: 9.5 }, { side: "short", entry: 20, exit: 21, shares: 50, stop: 21 }, { side: "long", entry: 5, exit: 5.5, shares: 100 }]);
    eq(st.n, 3); near(st.net, 100, 1e-9); near(st.winRatePct, 200 / 3, 1e-9); near(st.profitFactor, 3, 1e-9); near(st.avgR, 0.5, 1e-9);
  });
  test("learned blend weights move toward whichever source has been more accurate", () => {
    const Q = MD.quant, mk = (n, claude, model) => Array.from({ length: n }, (_, i) => ({ claude, model, up: i % 2 === 0 }));
    near(Q.blendWeights([]).wClaude, 0.65, 1e-12);
    const modelBetter = Q.blendWeights(mk(40, 75, 52)); ok(modelBetter.wClaude < 0.6 && modelBetter.brierModel < modelBetter.brierClaude, JSON.stringify(modelBetter));
    const claudeBetter = Q.blendWeights(Array.from({ length: 40 }, (_, i) => ({ claude: i % 2 === 0 ? 70 : 30, model: 50, up: i % 2 === 0 }))); ok(claudeBetter.wClaude > 0.7, JSON.stringify(claudeBetter));
    ok(Q.blendWeights(mk(5, 75, 52)).wClaude > modelBetter.wClaude, "a short record moves the weight less");
  });
  test("barrier odds: target before stop matches the driftless result, and shorts mirror longs", () => {
    const Q = MD.quant, long = Q.barrierOdds({ entry: 100, stop: 99, target: 102, dailyVolPct: 6, minutesLeft: 1440, paths: 4000 });
    near(long.pTarget, Math.log(100 / 99) / Math.log(102 / 99), 0.03); ok(long.pNeither < 0.05, "plenty of time: " + long.pNeither); near(long.rr, 2, 1e-9);
    const short = Q.barrierOdds({ entry: 100, stop: 101, target: 98, side: "short", dailyVolPct: 6, minutesLeft: 1440, paths: 4000 }); near(short.pTarget, Math.log(101 / 100) / Math.log(101 / 98), 0.03);
    const late = Q.barrierOdds({ entry: 100, stop: 99, target: 102, dailyVolPct: 1, minutesLeft: 10 }); ok(late.pNeither > 0.9, "ten quiet minutes rarely reach either level");
    eq(Q.barrierOdds({ entry: 100, stop: 101, target: 102, dailyVolPct: 2, minutesLeft: 60 }), null);
  });
  test("machine learning: logistic regression recovers a signal; AUC ranks correctly", () => {
    const C = MD.core, M = MD.ml, r = C.rng(11), Z = [], y = [];
    for (let i = 0; i < 600; i++) { const z = C.gauss(r); Z.push([z, C.gauss(r)]); y.push(z + 0.5 * C.gauss(r) > 0 ? 1 : 0); }
    const m = M.logisticFit(Z, y, 1); ok(m.w[1] > 1 && Math.abs(m.w[2]) < 0.4, JSON.stringify(m.w)); ok(m.predict([2, 0]) > 0.9 && m.predict([-2, 0]) < 0.1);
    near(M.auc([0.1, 0.4, 0.35, 0.8], [0, 0, 1, 1]), 0.75, 1e-12); near(M.auc([0.5, 0.5], [0, 1]), 0.5, 1e-12);
  });
  test("machine learning: boosted trees learn a threshold pattern the logistic model can't", () => {
    const C = MD.core, M = MD.ml, r = C.rng(17), mk = (n) => Array.from({ length: n }, () => { const a = C.gauss(r), b = C.gauss(r); return { x: [a, b], y: Math.abs(a) > 1 ? 1 : 0 }; });
    const tr = mk(800), te = mk(400), gb = M.gbtFit(tr.map(d => d.x), tr.map(d => d.y), { rounds: 40, minLeaf: 20 }), lg = M.logisticFit(tr.map(d => d.x), tr.map(d => d.y), 1);
    const aucG = M.auc(te.map(d => gb.predict(d.x)), te.map(d => d.y)), aucL = M.auc(te.map(d => lg.predict(d.x)), te.map(d => d.y));
    ok(aucG > 0.85 && aucL < 0.65, "trees " + aucG + " vs logistic " + aucL); ok(gb.uses[0] > gb.uses[1], "splits on the feature that matters");
  });
  test("machine learning: the cross-stock model finds a shared pattern across names and ranks them", () => {
    const C = MD.core, r = C.rng(31), N = 700, mkt = []; let mp = 100;
    for (let i = 0; i < N; i++) { mp *= Math.exp(0.0003 + 0.008 * C.gauss(r)); mkt.push({ time: (18000 + i) * 86400, close: mp }); }
    // Every name mean-reverts against the market over 5 days (a pattern shared across stocks).
    const mk = (seed, revert) => { const rr = C.rng(seed), rets = [], pts = []; let p = 100; for (let i = 0; i < N; i++) { const m5 = rets.slice(-5).reduce((s, x) => s + x, 0), mret = i ? Math.log(mkt[i].close / mkt[i - 1].close) : 0; const e = mret - revert * m5 + 0.012 * C.gauss(rr); rets.push(e - mret); p *= Math.exp(e); pts.push({ time: mkt[i].time, close: p }); } return pts; };
    const sig = MD.ml.pooled(Array.from({ length: 8 }, (_, k) => ({ key: "S" + k, points: mk(40 + k, 0.3) })), mkt, { horizonBars: 5 });
    ok(!sig.error && sig.edge && sig.oos.brierSkill > 0.02 && sig.oos.topVsBottomPct > 0.5 && sig.today.length === 8 && sig.today[0].rank === 1, JSON.stringify(sig.error || sig.oos));
    const noise = MD.ml.pooled(Array.from({ length: 8 }, (_, k) => ({ key: "N" + k, points: mk(60 + k, 0) })), mkt, { horizonBars: 5 });
    ok(!noise.edge && noise.today.every(t => Math.abs(t.beatPct - noise.baseRatePct) < 1e-6), JSON.stringify(noise.oos));
    ok(MD.ml.pooled([{ key: "A", points: mk(1, 0) }], mkt, {}).error, "too few names is refused");
  });
  test("machine learning: features never look ahead", () => {
    const C = MD.core, r = C.rng(5); let p = 100; const pts = Array.from({ length: 400 }, (_, i) => { p *= Math.exp(0.01 * C.gauss(r)); return { time: (19000 + i) * 86400, close: p }; });
    const a = MD.ml.features(pts.slice(0, 300)).rows, changed = pts.map((x, i) => i >= 300 ? { time: x.time, close: x.close * 3 } : x), b = MD.ml.features(changed).rows.slice(0, a.length);
    ok(a.length === 100 && a.every((row, i) => row.x.every((v, j) => v === b[i].x[j])), "rows before bar 300 are identical when later prices change");
  });
  test("machine learning: walk-forward finds a real pattern and reports no edge in pure noise", () => {
    const C = MD.core, M = MD.ml, mk = (seed, revert) => { const r = C.rng(seed), rets = [], pts = []; let p = 100; for (let i = 0; i < 1300; i++) { const m5 = rets.slice(-5).reduce((s, x) => s + x, 0); const e = -revert * m5 + 0.01 * C.gauss(r); rets.push(e); p *= Math.exp(e); pts.push({ time: (18000 + i) * 86400, close: p }); } return pts; };
    const sig = M.forecast(mk(3, 0.35), { horizonBars: 5 }), noise = M.forecast(mk(4, 0), { horizonBars: 5 });
    ok(sig.edge && sig.oos.skillEnsemble > 0.02 && sig.oos.logistic.accuracy > 0.58 && sig.oos.logistic.auc > 0.6, JSON.stringify(sig.oos.logistic) + " skill " + sig.oos.skillEnsemble);
    ok(sig.drivers[0].key === "mom5" || sig.drivers.slice(0, 3).some(d => d.key === "mom5" || d.key === "last1z"), "short-term momentum drives a mean-reverting series: " + sig.drivers.slice(0, 3).map(d => d.key));
    ok(!noise.edge && noise.trust === 0 && Math.abs(noise.upPct - noise.models.baseRatePct) < 1e-9, "noise claims no edge and stays at the base rate: " + JSON.stringify({ trust: noise.trust, up: noise.upPct, base: noise.models.baseRatePct, skill: noise.oos.skillEnsemble, t: noise.oos.tStat }));
    ok([21, 22, 23].every(s => !M.forecast(mk(s, 0), { horizonBars: 21 }).edge), "no false edge on random walks at a 1-month horizon");
    ok(sig.oos.tStat > 1.64, "the real pattern's edge is clear across independent blocks: t = " + sig.oos.tStat);
    ok(sig.oos.predictions > 500 && sig.analogs.length === 8 && sig.upPct >= 20 && sig.upPct <= 80);
    ok(M.forecast(mk(3, 0).slice(0, 300), { horizonBars: 21 }).error, "too little history is refused");
  });
  test("machine learning: an edge that has faded lately gets half the trust", () => {
    const C = MD.core, M = MD.ml, mk = (seed, cut) => { const r = C.rng(seed), rets = [], pts = []; let p = 100; for (let i = 0; i < 1300; i++) { const m5 = rets.slice(-5).reduce((s, x) => s + x, 0), e = -(i < cut ? 0.35 : 0) * m5 + 0.01 * C.gauss(r); rets.push(e); p *= Math.exp(e); pts.push({ time: 1800000000 + i * 86400, close: p, value: p }); } return pts; };
    const steady = M.forecast(mk(3, 1e9), { horizonBars: 5 }), faded = M.forecast(mk(7, 950), { horizonBars: 5 });
    ok(steady.edge && !steady.fading && steady.oos.recentSkill > 0, "a pattern that still works isn't flagged: " + steady.oos.recentSkill);
    ok(faded.edge && faded.fading && faded.oos.recentSkill < 0 && faded.trust <= 0.5, "a pattern that stopped working lately is flagged and trusted half: " + JSON.stringify({ edge: faded.edge, rs: faded.oos.recentSkill, trust: faded.trust }));
  });
  test("machine learning: the learned combiner is used only when it beats the logged odds out of sample", () => {
    const C = MD.core, r = C.rng(21), mk = (informative) => Array.from({ length: 80 }, () => { const m = 20 + r() * 60, up = r() * 100 < (informative ? m : 50), c = 30 + r() * 40; return { c, m, r: c, ml: m, final: c, up }; });
    const good = MD.ml.stacker(mk(true)); ok(good.used && good.brierStack < good.brierLogged, JSON.stringify(good));
    ok(good.apply({ c: 50, m: 80, r: 50, ml: 80 }) > good.apply({ c: 50, m: 20, r: 50, ml: 20 }) + 20, "leans on the input that has been right");
    eq(MD.ml.stacker(mk(true).slice(0, 20)).used, false);
    const noise = MD.ml.stacker(Array.from({ length: 80 }, () => ({ c: 50, m: 50, r: 50, ml: 50, final: 50, up: r() < 0.5 }))); eq(noise.used, false);
  });
  test("machine learning: k-means separates clear groups; regimes label a calm uptrend and a sell-off", () => {
    const C = MD.core, r = C.rng(9), Z = [];
    for (let i = 0; i < 200; i++) Z.push(i < 100 ? [C.gauss(r) * 0.2, C.gauss(r) * 0.2] : [5 + C.gauss(r) * 0.2, 5 + C.gauss(r) * 0.2]);
    const km = MD.ml.kmeans(Z, 2, 3); ok(km.labels.slice(0, 100).every(x => x === km.labels[0]) && km.labels.slice(100).every(x => x === km.labels[100]) && km.labels[0] !== km.labels[100]);
    // 400 calm rising days, then 120 volatile falling days, then calm again.
    let p = 100; const pts = [];
    for (let i = 0; i < 700; i++) { const calm = i < 400 || i >= 520; p *= Math.exp(calm ? 0.0008 + 0.004 * C.gauss(r) : -0.004 + 0.03 * C.gauss(r)); pts.push({ time: (18000 + i) * 86400, close: p }); }
    const R = MD.ml.regimes(pts, { k: 3 }); ok(!R.error && R.groups.length === 3, R.error);
    const stressed = R.groups.find(g => /sell-off|Volatile/.test(g.name)); ok(stressed && stressed.volPct > 25, JSON.stringify(R.groups.map(g => [g.name, Math.round(g.volPct)])));
    ok(R.groups.reduce((s, g) => s + g.days, 0) === R.days && R.todayGroup && R.since <= R.asOf);
  });
  test("technical alerts: average crosses, RSI thresholds, 52-week high and low, each firing once", () => {
    const Q = MD.quant, now = 400 * 86400, pts = Array.from({ length: 300 }, (_, i) => ({ time: (i + 90) * 86400, close: 100 + Math.sin(i / 9) * 5 }));
    const ts = Q.techState(pts, 120, now); ok(ts.ma50 > 0 && ts.ma200 > 0 && ts.rsi14 > 50 && ts.high52 <= 105.0001 && ts.low52 >= 94.9999, JSON.stringify(ts));
    const x = { kind: "xma50" }; let r = Q.evaluateTechAlert(x, Q.techState(pts, 90, now), null); eq(r.triggered, false); eq(r.state.side, "below");
    r = Q.evaluateTechAlert(x, ts, r.state); ok(r.triggered && /crossed above its 50-day/.test(r.detail)); r = Q.evaluateTechAlert(x, ts, r.state); eq(r.triggered, false);
    const hi = { kind: "high52" }; let s = Q.evaluateTechAlert(hi, ts, null); ok(s.triggered); s = Q.evaluateTechAlert(hi, ts, s.state); eq(s.triggered, false);
    s = Q.evaluateTechAlert(hi, Q.techState(pts, 100, now), s.state); eq(s.state.armed, true); ok(Q.evaluateTechAlert(hi, ts, s.state).triggered, "re-armed after falling back inside the range");
    ok(Q.evaluateTechAlert({ kind: "low52" }, Q.techState(pts, 80, now), null).triggered);
    const ra = { kind: "rsi_above", threshold: 70 }; ok(Q.evaluateTechAlert(ra, ts, null).triggered === (ts.rsi14 >= 70));
    eq(Q.evaluateTechAlert({ kind: "rsi_below", threshold: 30 }, Object.assign({}, ts, { rsi14: 25 }), null).triggered, true);
    const vh = pts.map(x => ({ time: x.time, value: 1000 })), tv = Q.techState(pts, 100, now, { today: 2500, history: vh });
    near(tv.volRatio, 2.5, 1e-9); eq(tv.avgVol20, 1000);
    let vs = Q.evaluateTechAlert({ kind: "vol_spike", threshold: 2 }, tv, null); ok(vs.triggered, "a 2.5× volume day fires");
    ok(!Q.evaluateTechAlert({ kind: "vol_spike", threshold: 2 }, tv, vs.state).triggered, "once per session");
    ok(Q.evaluateTechAlert({ kind: "vol_spike", threshold: 2 }, Object.assign({}, tv, { day: tv.day + 1 }), vs.state).triggered, "again on a later session");
    ok(!Q.evaluateTechAlert({ kind: "vol_spike", threshold: 3 }, tv, null).triggered); eq(Q.techState(pts, 100, now).volRatio, null, "no volume data, no ratio");
    eq(Q.alertText({ kind: "vol_spike", threshold: 2 }), "Volume at least 2× its 20-day average");
    eq(Q.techState(pts.slice(0, 10), 100, now), null); eq(Q.alertText({ kind: "rsi_below", threshold: 30 }), "RSI(14) at or below 30"); eq(Q.alertText({ kind: "above", threshold: 5 }), "≥ 5");
  });
  test("trade preview: a diversifier lowers volatility, a copy of the portfolio doesn't, weights and cash handled", () => {
    const Q = MD.quant, n = 120;
    const V = [], P = [], S = []; let v = 1000, p = 50, s = 50;
    for (let k = 0; k < n; k++) { const shock = (k % 2 ? 1 : -1) * 0.02; v *= 1 + shock; p *= 1 - shock; s *= 1 + shock; V.push(v); P.push(p); S.push(s); }
    const hedge = Q.tradePreview({ values: V, prices: P, amount: 500 }), same = Q.tradePreview({ values: V, prices: S, amount: 500 });
    ok(hedge.volAfter < hedge.volBefore * 0.6 && hedge.corr < -0.99, JSON.stringify(hedge)); near(same.volAfter, same.volBefore, 0.05); ok(same.corr > 0.99);
    near(hedge.weightAfter, 500 / (V[n - 1] + 500) * 100, 1e-9); eq(hedge.weightBefore, 0);
    const cash = Q.tradePreview({ values: V.map(x => x + 2000), prices: P, amount: 500, fromCash: true, existing: 100 }); near(cash.weightAfter, 600 / (V[n - 1] + 2000) * 100, 1e-9);
    eq(Q.tradePreview({ values: V, prices: P, amount: 5000, fromCash: true }), null); eq(Q.tradePreview({ values: V.slice(0, 10), prices: P.slice(0, 10), amount: 1 }), null);
  });
  test("day-trade risk guard: loss left, trades left, losing streak and the stop rule", () => {
    const Q = MD.quant, d = "2026-10-26", T = (time, entry, exit) => ({ date: d, time, symbol: "X", side: "long", shares: 100, entry, exit });
    const g = Q.riskGuard({ trades: [T("09:40", 10, 11), T("10:05", 10, 9.5), T("10:30", 10, 9.7), { date: "2026-10-23", time: "10:00", symbol: "X", side: "long", shares: 100, entry: 10, exit: 5 }], date: d, account: 10000, maxLossPct: 2, maxTrades: 4, maxLosingStreak: 3 });
    near(g.pnl, 20, 1e-9); eq(g.trades, 3); eq(g.tradesLeft, 1); eq(g.streak, 2); near(g.lossLeft, 200, 1e-9); eq(g.stop, false);
    const bad = Q.riskGuard({ trades: [T("09:40", 10, 9), T("10:05", 10, 9.5)], date: d, account: 10000, maxLossPct: 1, maxTrades: 0, maxLosingStreak: 2 });
    near(bad.pnl, -150, 1e-9); near(bad.lossLeft, 0, 1e-9); eq(bad.tradesLeft, null); ok(bad.stop && bad.reasons.includes("daily loss limit reached") && bad.reasons.includes("2 losses in a row"), JSON.stringify(bad.reasons));
    const none = Q.riskGuard({ trades: [], date: d, account: 10000, maxLossPct: 2, maxTrades: 5 }); eq(none.pnl, 0); near(none.lossLeft, 200, 1e-9); eq(none.stop, false);
  });
  test("open-call standing: odds to finish on the called side from here, and the move in volatility units", () => {
    const Q = MD.quant;
    near(Q.callStanding({ direction: "up", p0: 100, price: 100, bandPct: 0, dailyVolPct: 2, barsElapsed: 5, barsLeft: 10 }).oddsNowPct, 50, 1e-6);
    const up = Q.callStanding({ direction: "up", p0: 100, price: 110, bandPct: 0, dailyVolPct: 2, barsElapsed: 4, barsLeft: 25 });
    near(up.oddsNowPct, 100 * MD.core.normCdf(Math.log(1.1) / 0.1), 1e-9); near(up.movePct, 10, 1e-9); near(up.zFor, Math.log(1.1) / 0.04, 1e-9);
    const dn = Q.callStanding({ direction: "down", p0: 100, price: 100 / 1.1, bandPct: 0, dailyVolPct: 2, barsElapsed: 4, barsLeft: 25 });
    near(dn.oddsNowPct, up.oddsNowPct, 1e-9); near(dn.zFor, up.zFor, 1e-9);
    const against = Q.callStanding({ direction: "up", p0: 100, price: 90, bandPct: 1, dailyVolPct: 2, barsElapsed: 4, barsLeft: 4 }); ok(against.oddsNowPct < 1 && against.zFor < -2.5, JSON.stringify(against));
    ok(Q.callStanding({ direction: "up", p0: 100, price: 100, bandPct: 1, dailyVolPct: 2, barsElapsed: 1, barsLeft: 10 }).oddsNowPct < 50, "the flat band counts against the call");
    eq(Q.callStanding({ direction: "down", p0: 100, price: 98, bandPct: 1, dailyVolPct: 2, barsElapsed: 1, barsLeft: 0 }).oddsNowPct, 100);
    eq(Q.callStanding({ direction: "move", p0: 100, price: 98, dailyVolPct: 2, barsElapsed: 1, barsLeft: 3 }), null);
  });
  test("decision maths: expected value, payoff, Kelly and a capped quarter-Kelly ceiling", () => {
    const Q = MD.quant, d = Q.decisionMath({ upPct: 60, upMovePct: 20, downMovePct: 10, capPct: 10 });
    near(d.evPct, 8, 1e-9); near(d.payoff, 2, 1e-9); near(d.kellyPct, 40, 1e-9); near(d.ceilingPct, 10, 1e-9); near(d.breakEvenUpPct, 33.3, 1e-9);
    const small = Q.decisionMath({ upPct: 55, upMovePct: 10, downMovePct: 10, capPct: 20 }); near(small.kellyPct, 10, 1e-9); near(small.ceilingPct, 2.5, 1e-9);
    const bad = Q.decisionMath({ upPct: 40, upMovePct: 10, downMovePct: 10 }); ok(bad.evPct < 0 && bad.kellyPct === 0 && bad.ceilingPct === 0);
    eq(Q.decisionMath({ upPct: 60, upMovePct: 0, downMovePct: 5 }), null);
  });
  test("calibration from the record pulls overconfident calls down, by more as the record grows", () => {
    const Q = MD.quant, mk = (n, p, hits) => Array.from({ length: n }, (_, i) => ({ p, hit: i < hits }));
    const few = Q.calibrateFrom(mk(10, 0.7, 5), 0.7), many = Q.calibrateFrom(mk(100, 0.7, 50), 0.7);
    ok(few.applied && few.p < 0.7 && few.p > many.p && many.p > 0.5, few.p + " " + many.p); near(many.observed, 0.5, 1e-9);
    const good = Q.calibrateFrom(mk(40, 0.6, 24), 0.6); near(good.p, 0.6, 1e-9);
    const far = Q.calibrateFrom(mk(40, 0.55, 10), 0.85); ok(Math.abs(far.p - 0.85) < 0.01, "calls stated far away barely count: " + far.p);
    ok(!Q.calibrateFrom([], 0.7).applied);
  });
  test("cause → effect rules: cleaning, backtest against the baseline, today's check", () => {
    const Q = MD.quant, r = MD.core.rng(5), g = MD.core.gauss;
    const R0 = Q.cleanRule({ cause: { symbol: "tlt", op: "<", pct: "-1" }, effect: { symbol: "XLK", vs: "spy", op: "<", pct: 0 }, lagDays: 0 });
    eq(R0.cause.symbol, "TLT"); eq(R0.effect.vs, "SPY"); eq(R0.cause.pct, -1); ok(!Q.cleanRule({ cause: { symbol: "TLT", op: "=", pct: 1 }, effect: { symbol: "SPY", op: "<", pct: 0 } }), "bad operator rejected");
    eq(Q.ruleText(R0), "TLT below -1% → XLK minus SPY below 0% the same day");
    // Built so the rule holds: on days TLT drops >1%, XLK trails SPY by 0.5% plus noise.
    let t = 100, s = 100, x = 100; const T = [], S = [], X = [];
    for (let i = 0; i < 400; i++) { const rt = 0.012 * g(r), rs = 0.01 * g(r), rx = rs + (rt < -0.01 ? -0.006 : 0) + 0.002 * g(r); t *= 1 + rt; s *= 1 + rs; x *= 1 + rx; const tm = 1.6e9 + i * 86400; T.push({ time: tm, close: t }); S.push({ time: tm, close: s }); X.push({ time: tm, close: x }); }
    const b = Q.backtestRule(R0, { TLT: T, SPY: S, XLK: X });
    ok(b.occurrences > 40 && b.heldPct > 85 && b.baselinePct < 70 && b.z > 3, JSON.stringify(b).slice(0, 200)); eq(b.days, 399); ok(b.recent.length === 6);
    eq(Q.backtestVerdict(b), "Strong: well above chance");
    ok(Q.backtestRule(R0, { TLT: T, SPY: S }).error, "missing history reported");
    const lag = Q.backtestRule(Object.assign({}, R0, { lagDays: 1 }), { TLT: T, SPY: S, XLK: X }); ok(lag.z < 2, "no next-day effect was built in");
    const td = Q.ruleToday(R0, { TLT: -1.4, SPY: 0.2, XLK: -0.6 }); ok(td.causeHappened && td.effectFollowed); near(td.effectPct, -0.8, 1e-9);
    ok(!Q.ruleToday(R0, { TLT: 0.3, SPY: 0, XLK: 0 }).causeHappened); eq(Q.ruleToday(R0, { TLT: -2 }), null);
  });
  test("intraday setup signals: opening-range breakout, VWAP reclaim, gaps, day extremes, volume", () => {
    const Q = MD.quant, t0 = 1000;
    const minute = [10, 10.2, 10.1, 9.9, 10.05, 10.1, 10.3, 10.6, 10.7].map((c, i) => ({ time: t0 + i * 300, close: c }));
    const bars = minute.map(p => ({ time: p.time, close: p.close })), vw = [10, 10.05, 10.1, 10.12, 10.1, 10.12, 10.15, 10.2, 10.25].map((v, i) => ({ time: t0 + i * 300, value: v }));
    const s = Q.intradaySignals({ minute, last: 10.7, or15: { high: 10.2, low: 9.9, complete: true }, openSec: t0, bars, vwapSeries: vw, vwapUpper: 10.5, high: 10.7, low: 9.9, priorHigh: 10.4, priorLow: 9.5, preHigh: 10.25, preLow: 9.8, gapPct: 2, prevClose: 9.8, open: 10, rvol: 2.5 });
    const names = s.map(x => x.name);
    ["Opening-range breakout", "VWAP reclaim", "Stretched above VWAP", "At the high of the day", "Above the prior day's high", "Above the pre-market high", "Gap up holding", "Heavy volume"].forEach(n => ok(names.includes(n), "missing " + n + " in " + names.join(", ")));
    eq(s.find(x => x.name === "Opening-range breakout").at, t0 + 6 * 300); eq(s.find(x => x.name === "Above the prior day's high").at, t0 + 7 * 300);
    const g = Q.intradaySignals({ last: 9.9, gapPct: 2, prevClose: 9.8, open: 10, low: 9.75, high: 10.1 }); ok(g.some(x => x.name === "Gap filled"));
    const d = Q.intradaySignals({ last: 9.82, gapPct: -1.5, prevClose: 10, open: 9.85, low: 9.8, high: 9.9, rvol: 0.4 }); ok(d.some(x => x.name === "Gap down holding") && d.some(x => x.name === "Light volume") && !d.some(x => x.name === "At the high of the day"));
  });
  test("New York session clock and NYSE holidays", () => {
    const Q = MD.quant;
    const a = Q.session(new Date("2026-10-26T14:00:00Z")); eq(a.phase, "open"); near(a.fraction, 30 / 390, 1e-9); eq(a.minutesToClose, 360);
    eq(Q.session(new Date("2026-10-26T12:00:00Z")).phase, "pre"); eq(Q.session(new Date("2026-10-26T12:00:00Z")).minutesToOpen, 90);
    eq(Q.session(new Date("2026-10-26T21:00:00Z")).phase, "after");
    const th = Q.session(new Date("2026-11-26T16:00:00Z")); eq(th.phase, "closed"); eq(th.tradingDay, false);
    const ec = Q.session(new Date("2026-11-27T18:30:00Z")); eq(ec.phase, "after"); ok(ec.earlyClose);
    eq(new Date(Q.closeTimeUTC("2026-10-26")).toISOString(), "2026-10-26T20:00:00.000Z"); eq(new Date(Q.closeTimeUTC("2026-11-02")).toISOString(), "2026-11-02T21:00:00.000Z"); eq(new Date(Q.closeTimeUTC("2026-11-27")).toISOString(), "2026-11-27T18:00:00.000Z");
    eq(Q.targetSession(new Date("2026-10-26T14:00:00Z")), "2026-10-26"); eq(Q.targetSession(new Date("2026-10-26T21:00:00Z")), "2026-10-27"); eq(Q.targetSession(new Date("2026-10-24T16:00:00Z")), "2026-10-26"); eq(Q.targetSession(new Date("2026-11-25T22:00:00Z")), "2026-11-27");
    const sat = Q.session(new Date("2026-10-24T16:00:00Z")); eq(sat.phase, "closed"); eq(sat.minutesToOpen, 12 * 60 + 1440 + 570);
  });
  MD.tests = { list: T, run() { const res = []; for (const t of T) { try { t.fn(); res.push({ name: t.name, ok: true }); } catch (e) { res.push({ name: t.name, ok: false, err: e.message }); } } return res; } };
})(typeof window !== "undefined" ? window : globalThis);
