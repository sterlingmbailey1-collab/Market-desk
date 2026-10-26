/* Recommendations: assets that could make large moves, why, and over what window.
   The app builds and measures the candidate list itself (option-implied moves, realized volatility,
   catalysts, short interest, momentum). Claude chooses from that measured list, checks the news,
   and explains each pick. Every pick is logged in the forecast journal so its accuracy is scored. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const C = MD.core, U = MD.ui, D = MD.data, h = U.h, X = MD.common;
  const V = (MD.views = MD.views || {});
  const WINDOWS = { "1w": ["Next week", 7], "2w": ["Next 2 weeks", 14], "3m": ["1–3 months", 75], "12m": ["3–12 months", 240] };
  const r1 = (x) => x == null || !isFinite(x) ? null : Math.round(x * 10) / 10;
  // Stocks, ETFs and coins on the watchlist or held, as assets.
  function myAssets(app) {
    const out = new Map();
    for (const w of app.store.cached("watch")) { const id = w.assetId || "", cls = w.cls || id.split(":")[0]; if (["stock", "etf", "crypto"].includes(cls) && w.symbol) out.set(id, { id, cls, symbol: w.symbol, name: w.name || w.symbol, cgId: w.cgId || (cls === "crypto" ? id.split(":")[1] : undefined) }); }
    try { for (const ps of C.buildPositions(app.store.cached("tx")).positions.values()) { const id = ps.assetId || "", cls = ps.assetClass || id.split(":")[0]; if (ps.qty && ps.qty.gt && ps.qty.gt(0) && ["stock", "etf", "crypto"].includes(cls)) out.set(id, { id, cls, symbol: ps.symbol, name: ps.name || ps.symbol, cgId: cls === "crypto" ? id.split(":")[1] : undefined, held: true }); } } catch {}
    return [...out.values()];
  }
  const SKIP_COINS = new Set(["USDT", "USDC", "DAI", "FDUSD", "USDE", "TUSD", "PYUSD", "USDS", "BUSD", "USD1", "WBTC", "STETH", "WSTETH", "WETH", "WEETH", "CBBTC", "RETH", "BSC-USD", "BUIDL", "USDTB", "SUSDE", "SUSDS", "LEO", "XAUT", "PAXG", "USDD", "FRAX", "USDF", "USYC", "RLUSD"]);

  async function pool(items, n, fn) { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = { error: e }; } } })); return out; }

  /* ---------- 1. candidate pool + measurements (deterministic) ---------- */
  async function buildCandidates(app, opts, log) {
    const days = WINDOWS[opts.window][1];
    const today = new Date();
    const cands = [];
    // A focus (theme, sector or style) asks Claude which assets fit; the app then verifies and measures each one.
    const focus = { stocks: new Map(), crypto: new Map() };
    if (opts.focus && app.caps.sample) {
      log("run", "Asking Claude which assets fit your focus: “" + opts.focus + "”");
      try {
        const r = await app.caps.sample.json(`An investor wants large-move candidates focused on: "${opts.focus.replace(/"/g, "'")}". List the assets that genuinely fit${opts.stocks ? ": up to 10 US-listed stocks or ETFs" : ""}${opts.crypto ? (opts.stocks ? " and" : ":") + " up to 5 coins (no stablecoins or wrapped tokens)" : ""}. Prefer liquid names. Only real, currently traded tickers; never invent one; leave a list empty when nothing fits.
Reply with ONLY JSON: {"stocks": [{"symbol": "TICKER", "why": "a few words on the fit"}], "crypto": [{"symbol": "SYMBOL", "why": "..."}]}`, { modelTier: "default", signal: opts.signal, cache: false });
        for (const x of (opts.stocks && Array.isArray(r.stocks) ? r.stocks : []).slice(0, 10)) { const sym = String(x && x.symbol || "").toUpperCase().trim(); if (/^[A-Z][A-Z.\-]{0,5}$/.test(sym)) focus.stocks.set(sym, String(x.why || "")); }
        for (const x of (opts.crypto && Array.isArray(r.crypto) ? r.crypto : []).slice(0, 5)) { const sym = String(x && x.symbol || "").toUpperCase().trim(); if (/^[A-Z0-9]{2,10}$/.test(sym) && !SKIP_COINS.has(sym)) focus.crypto.set(sym, String(x.why || "")); }
        const named = [...focus.stocks.keys(), ...focus.crypto.keys()];
        log(named.length ? "ok" : "fail", named.length ? "Fit the focus (to be verified): " + named.join(", ") : "Claude named nothing that fits; using the usual pool");
      } catch (e) { if (e && e.code === "cancelled") throw e; log("fail", "Couldn't get assets for the focus (" + U.errorText(e) + "); using the usual pool"); }
    }
    const focused = focus.stocks.size + focus.crypto.size >= 3;
    if (opts.stocks) {
      log("run", "Loading the 200 largest US-listed companies (Nasdaq screener)");
      const [p1, p2] = await Promise.all([D.stocks.screener(0, 100), D.stocks.screener(100, 100).catch(() => [])]);
      const big = new Map([...p1, ...p2].filter(r => r.price >= 5 && r.marketCap >= 5e9).map(r => [r.symbol, r]));
      log("ok", big.size + " liquid large caps");
      const horizonDates = []; for (let i = 0; i < Math.min(days, 21); i++) { const d = new Date(today.getTime() + i * 864e5); if (d.getUTCDay() % 6) horizonDates.push(D.ymd(d)); }
      log("run", "Checking the earnings calendar for the next " + horizonDates.length + " trading days");
      const earn = (await Promise.all(horizonDates.map(d => D.calendar.earnings(d).catch(() => [])))).flat();
      const earnBy = new Map(); for (const e of earn) if (big.has(e.symbol) && !earnBy.has(e.symbol)) earnBy.set(e.symbol, e);
      log("ok", earnBy.size + " of them report earnings in the window");
      let movers = { gainers: { rows: [] }, losers: { rows: [] } };
      try { movers = await D.stocks.movers(); } catch {}
      const moverSyms = [...movers.gainers.rows, ...movers.losers.rows].filter(r => big.has(r.symbol)).map(r => r.symbol);
      const byAbs = [...big.values()].sort((a, b) => Math.abs(b.changePct || 0) - Math.abs(a.changePct || 0)).slice(0, 6).map(r => r.symbol);
      const mine = opts.mine ? myAssets(app).filter(a => a.cls !== "crypto").slice(0, 6) : [], mineCls = new Map(mine.map(a => [a.symbol, a]));
      const foc = [...focus.stocks.keys()].filter(s => !mineCls.has(s));
      const short = [...new Set(mine.map(a => a.symbol).concat(foc, [...earnBy.keys()].slice(0, focused ? 3 : 9), moverSyms, byAbs))].slice(0, (focused ? 6 : 14) + mine.length + foc.length);
      if (mine.length) log("ok", "Including " + mine.length + " from your watchlist and holdings: " + mine.map(a => a.symbol).join(", "));
      log("run", "Measuring " + short.length + " stocks: options-implied move, volatility, momentum, short interest");
      const measured = await pool(short, 5, async (sym) => {
        const own = mineCls.get(sym);
        let base = big.get(sym);
        if (!base) { const q = await app.quote(own || { id: "stock:" + sym, cls: "stock", symbol: sym }, 60000); base = { name: q.name || sym, price: q.price, changePct: q.changePct, marketCap: null }; }
        const fa = focus.stocks.has(sym) ? await MD.ai.findAsset(sym) : null;
        const a = own ? { id: own.id, cls: own.cls, symbol: sym, name: own.name || base.name } : { id: (fa ? fa.cls : "stock") + ":" + sym, cls: fa ? fa.cls : "stock", symbol: sym, name: base.name };
        const [hist, si] = await Promise.all([D.historyFor(a, "1Y").catch(() => null), D.stocks.shortInterest(sym).catch(() => null)]);
        let om = null; try { om = await D.stocks.optionMoves(sym, base.price); } catch {}
        const st = hist ? C.seriesStats(hist.points, 252) : null;
        const closes = hist ? hist.points.map(p => p.close) : [];
        const ret = (n) => closes.length > n ? (closes[closes.length - 1] / closes[closes.length - 1 - n] - 1) * 100 : null;
        const target = om && om.moves.length ? om.moves.reduce((b, m) => !b || Math.abs(m.days - days) < Math.abs(b.days - days) ? m : b, null) : null;
        const near = om && om.moves.length ? om.moves[0] : null;
        const e = earnBy.get(sym);
        return { asset: a, mine: !!own, price: base.price, marketCap: base.marketCap, dayChangePct: base.changePct, volPct: st ? st.volPct : null, expectedMovePct: st ? C.expectedMoveFromVol(st.volPct, days) : null,
          impliedMovePct: target ? target.movePct : null, impliedExpiry: target ? target.expiry : null, impliedDays: target ? target.days : null, nearImplied: near && near !== target ? { expiry: near.expiry, movePct: near.movePct } : null, optionsAsOf: om ? om.asOf : null,
          earnings: e ? { date: e.date, time: e.time, epsForecast: e.epsForecast } : null, shortDaysToCover: si ? si.daysToCover : null, shortDate: si ? si.date : null,
          ret1m: ret(21), ret3m: ret(63), fromHighPct: st ? (closes[closes.length - 1] / st.high - 1) * 100 : null, fromLowPct: st ? (closes[closes.length - 1] / st.low - 1) * 100 : null, source: "Nasdaq" };
      });
      for (const m of measured) if (m && !m.error) { if (focus.stocks.has(m.asset.symbol)) m.focus = focus.stocks.get(m.asset.symbol) || "named for the focus"; cands.push(m); }
      log("ok", "Measured " + cands.length + " stocks" + (focus.stocks.size ? " (" + cands.filter(c => c.focus).length + " of " + focus.stocks.size + " focus names verified)" : ""));
    }
    if (opts.crypto) {
      log("run", "Loading the top 60 coins (CoinGecko), excluding stablecoins and wrapped tokens");
      const top = (await D.crypto.top("usd", 60)).filter(c => !SKIP_COINS.has(c.symbol) && c.marketCap > 1e9);
      const myCoins = opts.mine ? new Set(myAssets(app).filter(a => a.cls === "crypto").map(a => a.cgId)) : new Set();
      const scored = top.map(c => Object.assign(c, { score: Math.abs(c.ch7d || 0) + Math.abs(c.ch30d || 0) / 2 + (c.volume24h / (c.marketCap || 1)) * 40 })).sort((a, b) => b.score - a.score);
      const focCoins = scored.filter(c => focus.crypto.has(c.symbol));
      for (const sym of focus.crypto.keys()) if (!focCoins.some(c => c.symbol === sym)) {
        try { const a = await MD.ai.findAsset(sym); if (a && a.cls === "crypto") { const q = await D.quoteFor(a); focCoins.push({ id: a.id, cgId: a.cgId, symbol: a.symbol || sym, name: a.name || sym, price: Number(q.price), marketCap: null, changePct: q.changePct ?? null, volume24h: 0 }); } } catch {}
      }
      const pick = [...new Set(focCoins.concat(scored.filter(c => myCoins.has(c.cgId)).slice(0, 3), scored.slice(0, focused ? 3 : 7)))];
      log("run", "Measuring " + pick.length + " coins: volatility and momentum");
      const measured = await pool(pick, 4, async (c) => {
        const a = { id: c.id, cls: "crypto", cgId: c.cgId, symbol: c.symbol, name: c.name };
        const hist = await D.historyFor(a, "1Y").catch(() => null);
        const st = hist ? C.seriesStats(hist.points, 365) : null;
        return { asset: a, mine: myCoins.has(c.cgId), price: c.price, marketCap: c.marketCap, dayChangePct: c.changePct, volPct: st ? st.volPct : null, expectedMovePct: st ? C.expectedMoveFromVol(st.volPct, days) : null, impliedMovePct: null, earnings: null, shortDaysToCover: null,
          ret1m: c.ch30d, ret7d: c.ch7d, ret1y: c.ch1y, fromHighPct: st ? (st.end / st.high - 1) * 100 : null, fromLowPct: st ? (st.end / st.low - 1) * 100 : null, volumeToCap: c.volume24h / (c.marketCap || 1), source: "CoinGecko / Kraken" };
      });
      for (const m of measured) if (m && !m.error) { if (focus.crypto.has(m.asset.symbol)) m.focus = focus.crypto.get(m.asset.symbol) || "named for the focus"; cands.push(m); }
      log("ok", "Measured " + measured.filter(m => m && !m.error).length + " coins");
    }
    // Deterministic movement score: the bigger of the market-implied and volatility-implied move, boosted by a dated catalyst or crowded short.
    for (const c of cands) {
      const basis = Math.max(c.impliedMovePct || 0, c.expectedMovePct || 0);
      c.score = basis * (1 + (c.earnings ? 0.35 : 0) + (c.shortDaysToCover > 5 ? 0.15 : 0) + (Math.abs(c.ret1m || 0) > 20 ? 0.1 : 0));
    }
    // Your own names stay in the pool even when their movement score is lower.
    const ranked = cands.sort((a, b) => b.score - a.score), own = ranked.filter(c => c.mine), fit = ranked.filter(c => c.focus);
    return [...new Set(fit.concat(ranked.slice(0, fit.length >= 3 ? 6 : 14), own))];
  }

  /* ---------- 2. Claude chooses, explains and gets reviewed ---------- */
  // How well the measured signals line up with the call (0–100): momentum and Zacks for a direction, options vs history for "either".
  function signalAgreement(p, c) {
    if (p.lean === "either") return c.impliedMovePct != null && c.expectedMovePct ? Math.min(90, 40 + 25 * (c.impliedMovePct / c.expectedMovePct)) : 50;
    const dir = p.lean === "up" ? 1 : -1; let pts = 0, n = 0;
    if (c.ret3m != null || c.ret1m != null) { n++; if (Math.sign(c.ret3m ?? c.ret1m) === dir) pts++; }
    if (c.zacksRank != null) { n++; if ((dir > 0 && c.zacksRank <= 2) || (dir < 0 && c.zacksRank >= 4)) pts++; else if (c.zacksRank === 3) pts += 0.5; }
    if (c.fromHighPct != null) { n++; if ((dir > 0 && c.fromHighPct > -15) || (dir < 0 && c.fromHighPct < -15)) pts++; }
    if (c.smartMoney && c.smartMoney.length) { n++; if (dir > 0) pts++; }
    return n ? Math.round(25 + 65 * pts / n) : 50;
  }
  async function generate(app, opts, log, signal, onStep) {
    const s = app.caps.sample; if (!s) throw Object.assign(new Error("Claude isn't available in this view."), { code: "no_sample" });
    const lim = await s.limits().catch(() => null);
    const [wLabel, days] = WINDOWS[opts.window];
    const cands = await buildCandidates(app, opts, log);
    if (!cands.length) throw new Error("No candidates could be measured right now. Try again in a few minutes.");
    // Extra measured signals: Zacks Rank for stocks, and who among the tracked Congress members and investors holds it.
    log("run", "Adding Zacks Rank, insider activity and smart-money ownership");
    await pool(cands.filter(c => c.asset.cls === "stock"), 4, async (c) => {
      try { const m = await D.zacks.metrics(c.asset.symbol); c.zacksRank = m.n("zacks_rank"); c.zacksTarget = m.n("zacks_target_price"); c.zacksUrl = m.url; } catch {}
      try { const ins = await D.stocks.insiders(c.asset.symbol); const b = ins.counts["Number of Open Market Buys"], sl = ins.counts["Number of Sells"]; c.insiders = { openMarketBuys3m: b ? b.m3 : null, sells3m: sl ? sl.m3 : null }; } catch {}
    });
    for (const c of cands) c.smartMoney = MD.smartView && c.asset.cls === "stock" ? MD.smartView.whoOwns(app, c.asset.symbol).map(w => w.name) : [];
    // The asset's own odds: how often it finished higher over this window in 5 years of history (2 for coins),
    // overall and in situations like today's; and how much of its last week was the market versus the asset itself.
    log("run", "Measuring each candidate's own odds of finishing higher over " + days + " days, and what drove its last week");
    const [P] = await Promise.all([MD.brain ? MD.brain.pulse(app, { history: true }).catch(() => null) : null, pool(cands, 4, async (c) => {
      try { const br = await MD.ai.baseRatesFor(c.asset, days); c.baseRates = { historyFrom: br.history && br.history.from, modelUpPct: br.model.upPct, overallUpPct: r1(br.overall.upPct), windows: br.overall.n, independent: br.overall.independent, typicalIfUpPct: br.model.avgUpPct, typicalIfDownPct: br.model.avgDownPct, conditions: br.conditions.map(x => ({ condition: x.label, upPct: r1(x.upPct), windows: x.n, independent: x.independent })), parts: br.model.parts, historyFrom: br.history.from, source: br.history.source }; } catch {}
      try { c.ml = MD.mlView.compact(await MD.mlView.run(app, c.asset, days <= 10 ? 7 : days <= 45 ? 30 : 91)); } catch {}
      if (MD.brain) try { const ex = await MD.brain.explainMove(app, c.asset); c.moveExplained = { last5Days: ex.week, sectorEtf: ex.sectorEtf, factorFitR2: ex.model.r2 }; } catch {}
    })]);
    log("ok", cands.filter(c => c.baseRates).length + " with measured base rates, " + cands.filter(c => c.moveExplained).length + " with their last week explained" + (P && P.regime ? "; market regime: " + P.regime.label : ""));
    log("ok", cands.filter(c => c.zacksRank != null).length + " with a Zacks Rank, " + cands.filter(c => c.smartMoney.length).length + " held or traded by tracked people, " + cands.filter(c => c.insiders && c.insiders.openMarketBuys3m > 0).length + " with insider buying");
    const S = MD.ai.session(onStep || ((e) => log(e.kind, e.text)));
    for (const c of cands) if (c.zacksUrl) S.add(c.zacksUrl, "Zacks " + c.asset.symbol, "data");
    const tools = lim && lim.tools ? MD.ai.tools(app, S, ["search_news", "crypto_news", "search_web", "stock_snapshot", "zacks_view", "options_move", "smart_money", "earnings_info", "insider_activity", "market_memory", "explain_move"]) : undefined;
    const table = cands.map(c => ({ symbol: c.asset.symbol, name: c.asset.name, class: c.asset.cls, price: +Number(c.price).toPrecision(6), marketCapB: c.marketCap ? +(c.marketCap / 1e9).toFixed(1) : null, todayPct: c.dayChangePct != null ? +Number(c.dayChangePct).toFixed(2) : null,
      optionsImpliedMovePct: c.impliedMovePct != null ? +c.impliedMovePct.toFixed(1) : null, optionsExpiry: c.impliedExpiry, optionsDays: c.impliedDays, nearestExpiryMove: c.nearImplied, volatilityImplied1SigmaMovePct: c.expectedMovePct != null ? +c.expectedMovePct.toFixed(1) : null, annualVolPct: c.volPct != null ? +c.volPct.toFixed(1) : null,
      earnings: c.earnings, shortInterestDaysToCover: c.shortDaysToCover != null ? +c.shortDaysToCover.toFixed(1) : null, return1mPct: c.ret1m != null ? +Number(c.ret1m).toFixed(1) : null, return3mPct: c.ret3m != null ? +c.ret3m.toFixed(1) : null, return7dPct: c.ret7d != null ? +Number(c.ret7d).toFixed(1) : null, fromYearHighPct: c.fromHighPct != null ? +c.fromHighPct.toFixed(1) : null,
      zacksRank: c.zacksRank ?? null, zacksTarget: c.zacksTarget ?? null, smartMoney: c.smartMoney.length ? c.smartMoney : null, insiders: c.insiders || null, movementScore: +c.score.toFixed(1),
      baseRates: c.baseRates ? { modelUpPct: c.baseRates.modelUpPct, overallUpPct: c.baseRates.overallUpPct, independentSamples: c.baseRates.independent, typicalIfUpPct: c.baseRates.typicalIfUpPct, typicalIfDownPct: c.baseRates.typicalIfDownPct, conditions: c.baseRates.conditions } : null,
      last5DaysExplained: c.moveExplained ? c.moveExplained.last5Days : null, onYourWatchlistOrHeld: !!c.mine, fitsFocus: c.focus || null, mlModel: c.ml ? { horizonDays: c.ml.horizonDays, upPct: c.ml.upPct, edgeOutOfSample: c.ml.edgeOutOfSample, brierSkillPct: c.ml.outOfSample.brierSkillPct, auc: c.ml.outOfSample.auc, topDrivers: c.ml.topDrivers } : null,
      deskPastAiCalls: (() => { const mm = MD.ai.assetMemory(app, c.asset); return mm.calls.length ? mm.calls.length + " logged, " + mm.graded + " graded, " + mm.right + " right; latest " + mm.calls.slice(0, 2).map(x => (x.direction || "") + " " + (x.probabilityPct || "") + "% → " + (x.result ? (x.result.hit ? "right" : "wrong") : "pending")).join(", ") : null; })() }));
    const calib = MD.ai.calibrationNote(MD.ai.trackRecord(app, "ai-picks"));
    log("run", "Asking Claude to choose and explain (usually 1–3 minutes)");
    const prompt = `Today is ${new Date().toISOString().slice(0, 10)}. You are picking assets that could make a LARGE price move within the window "${wLabel}" (about ${days} days), for an investor who wants to watch them closely, and giving the odds of each one going UP or DOWN.
Use ONLY the measured candidates below (measured by the app from exchange, options, Zacks, disclosure and 5-year price data). ${tools ? "Investigate the strongest candidates with 4 to 12 tool calls before deciding: search_news (Bigdata.com) for stocks, crypto_news for coins, earnings_info when a report falls in the window, explain_move or stock_snapshot for the price picture, options_move, zacks_view or insider_activity where they would change your view, market_memory for what has been driving this market, search_web if a news tool fails. Cite only URLs returned by the tools." : "Web search is unavailable; say so in each pick's risks."}
Pick the ${opts.count} with the best case for a large move${opts.mine ? " (candidates marked onYourWatchlistOrHeld belong to the investor; include them when the evidence supports it)" : ""}. For EVERY pick give upProbabilityPct: the chance its price is HIGHER at the end of its window than now. Never answer "either way": a near coin-flip is still a number like 52 or 47. Start from the measured base rate (baseRates.modelUpPct, the asset's own history in situations like today's) and move away from it only for evidence history can't know: a dated catalyst, news, estimate revisions, the market regime. Give the typical size of the move if it rises and if it falls. Anchor the expected move size to the options-implied move when present (the market's own estimate) and to the volatility-implied move otherwise; if you expect more than the market prices, say why. Anchor the time window to a dated catalyst (earnings date, options expiry) when there is one. Give the strongest case on each side and what would change your mind. Do not invent prices, dates or figures.
${opts.focus ? `The investor asked to focus on: "${opts.focus.replace(/"/g, "'")}". Candidates with fitsFocus were named for it; choose from them first, and include others only when fewer than ${opts.count} focus candidates have a real case (say so in the summary).\n` : ""}mlModel is a machine-learning model (logistic regression + similar past setups) trained on each candidate's history and tested out of sample; give it weight only when edgeOutOfSample is true.
Market regime (measured): ${JSON.stringify(P && P.regime)}
${calib}
${MD.ai.contextNote(app)}
Measured candidates: ${JSON.stringify(table)}
Reply with ONLY JSON:
{"summary": "2-3 sentences on the overall picture and how uncertain this is",
 "picks": [{"symbol": "...", "upProbabilityPct": 5-95 (chance the price is higher at the end of the window than now),
   "ifUpPct": number (typical gain if it rises, positive percent), "ifDownPct": number (typical loss if it falls, positive percent),
   "expectedMovePct": {"low": number, "high": number} (size of the move you expect in the window, as positive percents),
   "timeframe": {"days": number, "label": "e.g. 'by Nov 21 (options expiry)' or 'around earnings on Oct 30'", "anchor": "earnings"|"options expiry"|"event"|"trend"},
   "why": ["3-5 short reasons citing the measured numbers and news"], "catalyst": {"event": "...", "date": "YYYY-MM-DD or TBD"},
   "bullCase": "the strongest case for a move up", "bearCase": "the strongest case for a move down", "changeMyMind": "the specific evidence that would make you drop this call",
   "invalidation": "what would mean the big move is unlikely", "risks": "biggest risk to this call", "confidence": 0-100,
   "sources": [{"title": "...", "url": "https://..."}]}],
 "excluded": [{"symbol": "...", "reason": "short reason a high-scoring candidate was left out"}]}`;
    const r = await s.json(prompt, Object.assign({ modelTier: "complex", signal }, tools ? { tools } : { cache: false }));
    const bySym = new Map(cands.map(c => [c.asset.symbol, c]));
    let picks = (Array.isArray(r.picks) ? r.picks : []).filter(p => bySym.has(p.symbol)).slice(0, opts.count).map(p => {
      const c = bySym.get(p.symbol);
      const lo = Math.max(0, Number(p.expectedMovePct && p.expectedMovePct.low) || 0), hi = Math.max(lo, Number(p.expectedMovePct && p.expectedMovePct.high) || lo);
      const modelUp = c.baseRates ? (c.ml && c.ml.edgeOutOfSample ? Math.round((c.baseRates.modelUpPct + c.ml.upPct) / 2 * 10) / 10 : c.baseRates.modelUpPct) : null, claudeRaw = Number(p.upProbabilityPct), claudeUp = isFinite(claudeRaw) && claudeRaw > 0 ? Math.max(5, Math.min(95, claudeRaw)) : (modelUp ?? 50);
      // Claude's judgement blended with the measured history; the review below can pull it toward 50%.
      const bw = MD.ai.blendFor(app, "ai-picks"), up = modelUp != null ? bw.wClaude * claudeUp + (1 - bw.wClaude) * modelUp : claudeUp;
      return { symbol: p.symbol, asset: c.asset, upPct: up, probs: { claude: Math.round(claudeUp), model: modelUp, ml: c.ml ? c.ml.upPct : null, mlEdge: c.ml ? c.ml.edgeOutOfSample : null, blended: Math.round(up), weightClaude: Math.round(bw.wClaude * 100), learnedWeights: bw.learned }, ifUpPct: Math.max(0, Number(p.ifUpPct) || hi || lo), ifDownPct: Math.max(0, Number(p.ifDownPct) || hi || lo), moveLow: lo, moveHigh: hi, mine: !!c.mine, focus: c.focus || null, baseRates: c.baseRates || null, moveExplained: c.moveExplained || null,
        timeframeDays: Math.max(1, Math.min(400, Math.round(Number(p.timeframe && p.timeframe.days) || days))), timeframeLabel: (p.timeframe && p.timeframe.label) || wLabel, anchor: (p.timeframe && p.timeframe.anchor) || "trend",
        why: Array.isArray(p.why) ? p.why.slice(0, 6).map(String) : [], catalyst: p.catalyst || null, invalidation: p.invalidation || "", risks: p.risks || "", confidence: Math.max(0, Math.min(100, Number(p.confidence) || 0)),
        bullCase: String(p.bullCase || ""), bearCase: String(p.bearCase || ""), changeMyMind: String(p.changeMyMind || ""),
        sources: S.verify(p.sources),
        measured: { price: c.price, impliedMovePct: c.impliedMovePct, impliedExpiry: c.impliedExpiry, optionsAsOf: c.optionsAsOf, expectedMovePct: c.expectedMovePct, volPct: c.volPct, earnings: c.earnings, shortDaysToCover: c.shortDaysToCover, ret1m: c.ret1m, ret3m: c.ret3m, fromHighPct: c.fromHighPct, score: c.score, zacksRank: c.zacksRank ?? null, smartMoney: c.smartMoney } };
    });
    if (!picks.length) throw Object.assign(new Error("Claude didn't return usable picks. Try again."), { code: "invalid_json" });
    // Second reader: checks each pick against the measured table and the sources retrieved.
    const rv = await MD.ai.review(app, { task: "Which assets could make a large move in " + wLabel + ", which way, and why", S, signal,
      items: picks.map(p => ({ id: p.symbol, upProbabilityPct: Math.round(p.upPct), measuredHistoryUpPct: p.probs.model, ifUpPct: p.ifUpPct, ifDownPct: p.ifDownPct, expectedMovePct: [p.moveLow, p.moveHigh], timeframe: p.timeframeLabel, why: p.why, catalyst: p.catalyst, bullCase: p.bullCase, bearCase: p.bearCase, confidence: p.confidence, sources: p.sources.map(x => x.url) })),
      facts: table.filter(t => picks.some(p => p.symbol === t.symbol)) });
    const dropped = [];
    for (const p of picks) {
      const c = bySym.get(p.symbol), rev = rv && rv.reviews.find(x => x.id === p.symbol);
      if (rev) {
        p.review = rev;
        // Two readers: the reviewer's own independent estimate is averaged in; without one, lower confidence pulls toward 50%.
        if (rev.probabilityPct != null) { p.probs.reviewer = Math.round(rev.probabilityPct); p.upPct = (p.upPct + rev.probabilityPct) / 2; }
        else if (rev.adjustedConfidence != null && rev.adjustedConfidence < p.confidence) { const k = p.confidence ? rev.adjustedConfidence / p.confidence : 1; p.upPct = 50 + (p.upPct - 50) * k; }
      }
      p.probs.afterReview = Math.round(p.upPct);
      const cal = MD.ai.calibrateUp(app, "ai-picks", p.upPct); if (cal.applied) { p.calibration = cal; p.upPct = cal.upPct; }
      p.upPct = Math.round(p.upPct); p.downPct = 100 - p.upPct; p.probs.final = p.upPct;
      p.lean = p.upPct >= 50 ? "up" : "down"; p.leanProbabilityPct = Math.max(p.upPct, p.downPct);
      p.bigMove = c.volPct ? MD.quant.bigMoveChance(c.volPct, p.timeframeDays, Math.max(1, p.moveLow)) : null;
      const verified = p.sources.filter(x => x.verified).length;
      p.confidenceParts = { claude: p.confidence, reviewed: rev && rev.adjustedConfidence != null ? rev.adjustedConfidence : null, signals: signalAgreement(p, c), evidence: Math.min(100, verified * 25 + (p.catalyst && /^\d{4}-\d{2}-\d{2}$/.test(p.catalyst.date || "") ? 25 : 0)) };
      p.confidence = MD.ai.blend([{ value: p.confidenceParts.reviewed ?? p.confidenceParts.claude, weight: 0.5 }, { value: p.confidenceParts.signals, weight: 0.3 }, { value: p.confidenceParts.evidence, weight: 0.2 }]);
      if (rev && rev.verdict === "drop") dropped.push(p);
    }
    if (dropped.length && dropped.length < picks.length) picks = picks.filter(p => !dropped.includes(p));
    else dropped.length = 0;
    log("run", "Recording current prices");
    await pool(picks, 5, async (p) => { try { const q = await app.quote(p.asset, 0); p.priceAtPick = q.price; p.currency = q.currency || "USD"; p.priceSource = q.source; } catch { p.priceAtPick = p.measured.price; p.currency = "USD"; p.priceSource = "screener snapshot"; } });
    log("ok", "Done");
    return { focus: opts.focus || null, window: opts.window, windowLabel: wLabel, scope: { stocks: !!opts.stocks, crypto: !!opts.crypto }, summary: r.summary || "", picks, excluded: (Array.isArray(r.excluded) ? r.excluded.slice(0, 8) : []).concat(dropped.map(p => ({ symbol: p.symbol, reason: "Dropped by the review: " + (p.review.note || p.review.issues.join("; ")) }))),
      review: rv ? { overall: rv.overall, kept: rv.reviews.filter(x => x.verdict === "keep").length, revised: rv.reviews.filter(x => x.verdict === "revise").length, dropped: dropped.length } : null,
      candidates: cands.length, sourcesRetrieved: S.sources.length, toolCalls: S.calls, demo: !!app.demo };
  }

  async function journal(app, set) {
    for (const p of set.picks) {
      if (!(p.priceAtPick > 0)) continue;
      const mid = (p.moveLow + p.moveHigh) / 2;
      const f = { assetId: p.asset.id, asset: p.asset, symbol: p.symbol, source: "ai-picks", pickSetId: set.id, horizonDays: p.timeframeDays, dueAt: Date.now() + p.timeframeDays * 864e5, priceAtCreation: p.priceAtPick, currency: p.currency, priceSource: p.priceSource, thesis: p.why.join(" "), flatBandPct: 1 };
      if (p.lean === "either") Object.assign(f, { direction: "move", movePct: +p.moveLow.toFixed(1), probability: 0.5 + p.confidence / 400 });
      else { const size = p.upPct != null ? (p.lean === "up" ? p.ifUpPct : p.ifDownPct) || mid : mid; Object.assign(f, { direction: p.lean, probability: p.leanProbabilityPct / 100, upProbability: p.upPct != null ? p.upPct / 100 : null, claudeUpPct: p.probs ? p.probs.claude : null, modelUpPct: p.probs ? p.probs.model : null, target: +(p.priceAtPick * (1 + (p.lean === "up" ? 1 : -1) * size / 100)).toPrecision(6) }); }
      await app.store.create("forecasts", f);
    }
  }

  /* ---------- re-checking a pick (shown on the card; the logged call is never changed) ---------- */
  async function recheck(app, set, p) {
    const s = app.caps.sample; if (!s) throw Object.assign(new Error("Claude isn't available in this view."), { code: "no_sample" });
    const S = MD.ai.session(), due = set.createdAt + p.timeframeDays * 864e5, daysLeft = Math.max(1, Math.round((due - Date.now()) / 864e5));
    const [q, br] = await Promise.all([app.quote(p.asset, 30000).catch(() => null), MD.ai.baseRatesFor(p.asset, daysLeft).catch(() => null)]);
    const since = q && p.priceAtPick ? (q.price / p.priceAtPick - 1) * 100 : null;
    const lim = await s.limits().catch(() => null);
    const tools = lim && lim.tools ? MD.ai.tools(app, S, p.asset.cls === "crypto" ? ["crypto_news", "search_news", "explain_move", "search_web"] : ["search_news", "explain_move", "earnings_info", "search_web"]) : undefined;
    const r = await s.json(`You made this call on ${new Date(set.createdAt).toISOString().slice(0, 10)}: ${p.symbol} has a ${p.upPct}% chance of being higher by ${new Date(due).toISOString().slice(0, 10)} (${p.timeframeLabel}). Reasons then: ${p.why.join(" ")} Catalyst: ${p.catalyst ? p.catalyst.event + " " + (p.catalyst.date || "") : "none"}. What would change the view: ${p.changeMyMind || "—"}.
Since then the price moved ${since == null ? "an unknown amount" : since.toFixed(1) + "%"} (${p.priceAtPick} → ${q ? q.price : "?"}). ${daysLeft} days are left. Measured base rate for the remaining window: ${br ? br.model.upPct + "% up" : "n/a"}.
${tools ? "Check what happened since with 1 to 4 tool calls; cite only URLs the tools returned." : ""} Then give the updated chance that the price is higher at the window's end than it was when the call was made (${p.priceAtPick}), and whether the thesis still holds.
${MD.ai.contextNote(app)}
${MD.ai.assetNote(app, p.asset)}
Reply with ONLY JSON: {"upProbabilityPct": 5-95, "status": "holds"|"weakened"|"broken"|"played out", "whatChanged": "2-3 sentences", "sources": [{"title": "...", "url": "https://..."}]}`, Object.assign({ modelTier: "complex" }, tools ? { tools } : { cache: false }));
    const claude = Math.max(5, Math.min(95, Number(r.upProbabilityPct) || 50)), model = br ? br.model.upPct : null;
    const bw = MD.ai.blendFor(app, "ai-picks"), up = Math.round(model != null ? bw.wClaude * claude + (1 - bw.wClaude) * model : claude);
    const doc = { setId: set.id, symbol: p.symbol, at: Date.now(), upPct: up, was: p.upPct, claude, model, status: ["holds", "weakened", "broken", "played out"].includes(r.status) ? r.status : "holds", whatChanged: String(r.whatChanged || ""), priceNow: q ? q.price : null, sinceLoggedPct: since, sources: S.verify(r.sources) };
    return app.demo ? doc : app.store.create("pickchecks", doc);
  }
  function recheckNote(c) {
    if (!c) return null;
    return h("div", { class: "aireview " + (c.status === "holds" || c.status === "played out" ? "positive" : c.status === "broken" ? "negative" : "neutral") }, h("span", { class: "verdict sm " + (c.status === "holds" || c.status === "played out" ? "positive" : c.status === "broken" ? "negative" : "neutral") }, "Re-checked " + new Date(c.at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ": " + c.status),
      h("span", { class: "small" }, "Now " + (c.upPct >= 50 ? c.upPct + "% chance up" : (100 - c.upPct) + "% chance down") + (c.was != null ? " (was " + c.was + "% up)" : "") + (c.sinceLoggedPct != null ? " · price " + U.pct(c.sinceLoggedPct) + " since the call" : "") + ". " + c.whatChanged), MD.ai.sources(c.sources));
  }
  // Two price alerts in one click: the upside target and the downside level from the pick's expected moves.
  async function bracketAlerts(app, p) {
    if (!(p.priceAtPick > 0)) { U.toast("No price at the time of the pick", null, true); return; }
    const up = +(p.priceAtPick * (1 + (p.ifUpPct || p.moveLow) / 100)).toPrecision(6), dn = +(p.priceAtPick * (1 - (p.ifDownPct || p.moveLow) / 100)).toPrecision(6);
    const base = Object.assign(X.slim(p.asset), { assetId: p.asset.id, state: { armed: true } }); delete base.id;
    await app.store.create("alerts", Object.assign({}, base, { kind: "above", threshold: up, note: "Recommendation " + p.symbol + ": reached its upside (+" + C.fmtNum(p.ifUpPct || p.moveLow, 0) + "%)" }));
    await app.store.create("alerts", Object.assign({}, base, { kind: "below", threshold: dn, note: "Recommendation " + p.symbol + ": reached its downside (−" + C.fmtNum(p.ifDownPct || p.moveLow, 0) + "%)" }));
    U.toast("Alerts set for " + p.symbol, "Above " + up + " and below " + dn + ". Checked every two minutes while the desk is open.");
  }

  /* ---------- clearing picks from view (the forecast journal keeps every call for scoring) ---------- */
  function hiddenTest(app) {
    const hs = app.store.cached("pickhide");
    return (set, p) => hs.some(x => (x.scope === "pick" && x.setId === set.id && x.symbol === p.symbol) || (x.scope === "all" && set.createdAt <= x.before) || (x.scope === "cls" && set.createdAt <= x.before && (x.cls === "crypto") === ((p.asset && p.asset.cls) === "crypto")));
  }
  async function clearPicks(app, scope, extra) {
    if (app.demo) { U.toast("Demo mode: nothing to clear"); return; }
    await app.store.create("pickhide", Object.assign({ scope, before: Date.now() }, extra || {}));
    U.toast(scope === "pick" ? "Removed " + extra.symbol : scope === "all" ? "Cleared all recommendations" : "Cleared " + (extra.cls === "crypto" ? "crypto" : "stock") + " recommendations", "Still in your forecast journal, so the AI's track record stays honest.");
    app.rerender();
  }
  async function restorePicks(app) { for (const x of app.store.cached("pickhide").slice()) await app.store.remove("pickhide", x.id); U.toast("Restored cleared recommendations"); app.rerender(); }
  // A set with its hidden picks taken out (null when nothing is left).
  function visibleSet(set, isHidden) { const picks = (set.picks || []).filter(p => !isHidden(set, p)); return picks.length ? Object.assign({}, set, { picks, hiddenCount: set.picks.length - picks.length }) : null; }

  /* ---------- page ---------- */
  V.picks = function (root, app) {
    const isHidden = hiddenTest(app), allSets = app.store.cached("picks").slice().sort((a, b) => b.createdAt - a.createdAt);
    const sets = allSets.map(s => visibleSet(s, isHidden)).filter(Boolean), hiddenN = app.store.cached("pickhide").length;
    const openId = app.ls.get("picksOpen", null);
    const cur = sets.find(s => s.id === openId) || sets[0] || null;
    root.append(MD.marketsHelpers.head("Recommendations", "Claude's watchlist of assets that could make a large move, with why, which way it leans and roughly how long it may take. Built from measured market data; every pick is logged in your forecast journal and scored when its window ends."));
    root.append(h("div", { class: "banner warn" }, h("p", {}, "These are research leads, not advice to buy or sell. Large-move candidates are high risk by nature: a big expected move means big losses are as plausible as big gains, and most calls like these don't play out as described.")));
    const f = { stocks: h("input", { type: "checkbox", checked: app.ls.get("pk.stocks", true) }), crypto: h("input", { type: "checkbox", checked: app.ls.get("pk.crypto", true) }), mine: h("input", { type: "checkbox", checked: app.ls.get("pk.mine", true) }), window: h("select", {}, Object.entries(WINDOWS).map(([k, [l]]) => h("option", { value: k, selected: k === app.ls.get("pk.window", "3m") }, l))), count: h("select", {}, ["4", "6", "8"].map(n => h("option", { value: n, selected: n === app.ls.get("pk.count", "6") }, n + " picks"))) };
    f.focus = h("input", { type: "text", maxlength: 120, placeholder: "a theme, sector or style, e.g. AI chips, nuclear power, oversold large caps, layer-2 coins", style: "width:100%", value: app.ls.get("pk.focus", ""), "aria-label": "Focus" });
    const log = MD.ai.logBox(), phase = h("div", { class: "label" });
    let ctl = null;
    const go = h("button", { class: "btn", type: "button" }, sets.length ? "Generate a fresh set" : "Generate recommendations");
    const stop = h("button", { class: "btn ghost", type: "button", hidden: true, onclick: () => ctl && ctl.abort() }, "Stop");
    go.onclick = async () => {
      if (!f.stocks.checked && !f.crypto.checked) { U.toast("Pick stocks, crypto or both", null, true); return; }
      app.ls.set("pk.stocks", f.stocks.checked); app.ls.set("pk.crypto", f.crypto.checked); app.ls.set("pk.mine", f.mine.checked); app.ls.set("pk.window", f.window.value); app.ls.set("pk.count", f.count.value); app.ls.set("pk.focus", f.focus.value.trim());
      ctl = new AbortController(); go.disabled = true; stop.hidden = false; log.clear(); phase.textContent = "Working…";
      const L = (kind, text) => log.add({ at: Date.now(), kind, text });
      try {
        const set = await generate(app, { stocks: f.stocks.checked, crypto: f.crypto.checked, mine: f.mine.checked, window: f.window.value, count: Number(f.count.value), focus: f.focus.value.trim().slice(0, 120) || null, signal: ctl.signal }, L, ctl.signal, (e) => log.add(e));
        if (app.demo) { phase.textContent = "Done (demo mode: not saved)"; body.replaceChildren(setView(app, Object.assign({ id: "unsaved", createdAt: Date.now() }, set))); }
        else { const saved = await app.store.create("picks", set); await journal(app, saved); app.ls.set("picksOpen", saved.id); phase.textContent = "Done · saved and logged in your forecast journal"; app.rerender(); }
      } catch (e) { phase.textContent = e && e.code === "cancelled" ? "Stopped." : ""; if (!(e && e.code === "cancelled")) L("fail", ({ no_sample: "Claude isn't available in this view.", not_granted: "Claude access was declined for this page.", rate_limited: "Usage limit reached; try again later.", invalid_json: "The answer came back unreadable; try again." })[e && e.code] || (e && e.message) || "Failed."); }
      go.disabled = false; stop.hidden = true; ctl = null;
    };
    root.append(U.section("Generate", h("div", { class: "stack" },
      h("div", { class: "form" }, h("label", { class: "chk" }, f.stocks, "US stocks"), h("label", { class: "chk" }, f.crypto, "Crypto"), h("label", { class: "chk" }, f.mine, "Include my watchlist & holdings"), U.field("Window", f.window), U.field("How many", f.count)),
      h("div", { class: "row", style: "gap:10px;align-items:flex-end;flex-wrap:wrap" }, h("label", { class: "field", style: "flex:1 1 280px;min-width:0" }, h("span", { class: "label" }, "Focus (optional)"), f.focus), h("div", { class: "row" }, go, stop)),
      h("p", { class: "small muted" }, "Takes about 2–4 minutes: the app measures the candidates (including each one's own odds of finishing higher over the window, from 5 years of history), Claude investigates them with news, price, earnings, options, Zacks, insider and smart-money tools and the Market Brain's record, and a second review checks every pick against the evidence before it's shown. Every pick gets a chance of going up and of going down. Uses your Claude usage plus roughly 40–70 data requests through Exa, a few news searches through Bigdata.com and CoinMarketCap, and Zacks lookups when they're connected. Without a focus, stocks are limited to US-listed companies above $5B market cap and $5 a share and coins to the top 60 above $1B (no stablecoins or wrapped tokens). A focus adds the names Claude gives for it, each checked with a live quote and measured like the rest; ones that can't be priced are dropped."),
      phase, log,
      allSets.length ? h("div", { class: "row", style: "gap:6px;flex-wrap:wrap;align-items:center" }, h("span", { class: "label" }, "Clear recommendations"),
        h("button", { class: "btn ghost sm", type: "button", onclick: () => clearPicks(app, "cls", { cls: "stock" }) }, "Clear stocks"),
        h("button", { class: "btn ghost sm", type: "button", onclick: () => clearPicks(app, "cls", { cls: "crypto" }) }, "Clear crypto"),
        h("button", { class: "btn ghost sm", type: "button", onclick: () => clearPicks(app, "all") }, "Clear all"),
        hiddenN ? h("button", { class: "btn ghost sm", type: "button", onclick: () => restorePicks(app) }, "Restore cleared") : null,
        h("span", { class: "tiny muted" }, "Clearing hides picks here and in the prediction log; the forecast journal keeps them so the AI's record stays honest.")) : null)));
    const body = h("div", { class: "stack" });
    root.append(body);
    if (cur) body.append(setView(app, cur));
    else body.append(h("div", { class: "empty" }, allSets.length ? "All recommendations are cleared. Generate a fresh set when you're ready." : "No recommendations yet. Generate a set to see which assets could move sharply, the chance each goes up or down, and over what window."));
    root.append(predictionLog(app, sets));
    // track record
    const fcs = app.store.cached("forecasts").filter(x => x.source === "ai-picks"), evals = app.store.cached("evals");
    const scored = fcs.map(x => { const e = evals.find(v => v.forecastId === x.id); return e ? Object.assign({}, e, { probability: x.probability }) : null; }).filter(Boolean);
    const cal = C.calibration(scored);
    root.append(U.section("AI scorecard (every source)", MD.ai.scorecard(app)));
    root.append(U.section("Track record", h("div", { class: "stack" },
      U.kv([["Picks logged", String(fcs.length)], ["Scored so far", String(cal.n)], ["Calls that came true", cal.hitRate != null ? (cal.hitRate * 100).toFixed(0) + "%" : "—"], ["Brier score", cal.brier != null ? cal.brier.toFixed(3) : "—"], ["Due for scoring", String(fcs.filter(x => x.dueAt <= Date.now() && !evals.some(v => v.forecastId === x.id)).length)]]),
      h("p", { class: "small muted" }, cal.n < 20 ? "Too few scored picks to judge skill yet. Score due picks in Deep Research → Forecast journal." : "Scores come from the forecast journal."),
      sets.length > 1 ? U.dataTable([{ t: "Generated", v: (s) => U.fmtTs(s.createdAt), sort: (s) => s.createdAt }, { t: "Window", v: "windowLabel" }, { t: "Picks", v: (s) => s.picks.map(p => p.symbol).join(", ") }], sets, { key: "picks.sets", sort: [0, -1], noun: "sets", filter: false, onRow: (s) => { app.ls.set("picksOpen", s.id); app.rerender(); window.scrollTo(0, 0); } }) : null)));
  };

  /* ---------- prediction log: every logged pick, its price then and now, and where it was projected to be ---------- */
  function projectedFor(p) {
    const P0 = p.priceAtPick; if (!(P0 > 0)) return null;
    const lo = p.moveLow / 100, hi = p.moveHigh / 100, mid = (lo + hi) / 2;
    if (p.lean === "up") return { kind: "up", mid: P0 * (1 + mid), lo: P0 * (1 + lo), hi: P0 * (1 + hi) };
    if (p.lean === "down") return { kind: "down", mid: P0 * (1 - mid), lo: P0 * (1 - hi), hi: P0 * (1 - lo) };
    return { kind: "either", mid: null, down: P0 * (1 - lo), up: P0 * (1 + lo), lo: P0 * (1 - hi), hi: P0 * (1 + hi) };
  }
  // Where a call stands against its projection: reached, on track, behind, or (after its date) missed.
  function callStatus(r, now) {
    const pj = r.proj; if (!pj || !(now > 0)) return { label: "—", cls: "" };
    const due = Date.now() >= r.dueAt, ch = (now / r.P0 - 1) * 100;
    if (r.eval) return r.eval.hit ? { label: "Hit (scored)", cls: "up" } : { label: "Missed (scored)", cls: "down" };
    const reached = pj.kind === "up" ? now >= pj.lo : pj.kind === "down" ? now <= pj.hi : Math.abs(ch) >= r.p.moveLow;
    if (reached) return { label: due ? "Reached by its date" : "Reached early", cls: "up" };
    if (due) return { label: "Past its date · not reached", cls: "down" };
    const right = pj.kind === "up" ? ch > 0 : pj.kind === "down" ? ch < 0 : Math.abs(ch) >= r.p.moveLow / 2;
    return right ? { label: "On track", cls: "" } : { label: "Behind", cls: "warn-t" };
  }
  function predictionLog(app, sets) {
    const fcs = app.store.cached("forecasts").filter(x => x.source === "ai-picks"), evals = app.store.cached("evals");
    const rows = [];
    for (const s of sets) for (const p of s.picks || []) {
      const fc = fcs.find(f => f.pickSetId === s.id && f.symbol === p.symbol);
      rows.push({ key: s.id + ":" + p.symbol, at: s.createdAt, p, asset: p.asset, symbol: p.symbol, name: (p.asset && p.asset.name) || p.symbol, P0: p.priceAtPick, cur: p.currency || "USD", proj: projectedFor(p), dueAt: s.createdAt + p.timeframeDays * 864e5, now: null, eval: fc ? evals.find(e => e.forecastId === fc.id) || null : null });
    }
    const box = h("div", { class: "stack" }), summary = h("div", { class: "row", style: "gap:8px" });
    if (!rows.length) { box.append(h("div", { class: "empty" }, "Nothing logged yet. Each pick you generate is listed here with its price at the time, today's price and where it was projected to be.")); const sec0 = U.section("Prediction log", box); sec0.id = "prediction-log"; return sec0; }
    const fmt = (v, cur) => v == null ? "—" : U.money(v, cur, { price: true });
    const daysTo = (t) => { const d = Math.round((t - Date.now()) / 864e5); return d > 0 ? "in " + d + " day" + (d === 1 ? "" : "s") : d === 0 ? "today" : -d + " day" + (d === -1 ? "" : "s") + " ago"; };
    const cols = [
      { t: "Logged", v: (r) => h("span", { class: "stack", style: "gap:0" }, h("span", {}, new Date(r.at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })), h("span", { class: "tiny muted" }, new Date(r.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }))), sort: (r) => r.at },
      { t: "Asset", v: (r) => h("span", { class: "stack", style: "gap:0" }, h("strong", {}, r.symbol), h("span", { class: "tiny muted" }, String(r.name).slice(0, 28))), sort: (r) => r.symbol },
      { t: "Call", v: (r) => h("span", { class: "stack", style: "gap:2px" }, h("span", { class: "verdict sm " + (r.p.lean === "up" ? "positive" : r.p.lean === "down" ? "negative" : "neutral") }, r.p.upPct != null ? (r.p.upPct >= 50 ? "▲ " + r.p.upPct + "% up" : "▼ " + (100 - r.p.upPct) + "% down") : r.p.lean === "up" ? "▲ Up" : r.p.lean === "down" ? "▼ Down" : "↕ No direction (older pick)"), h("span", { class: "tiny muted num" }, (r.p.upPct != null ? (r.p.upPct >= 50 ? 100 - r.p.upPct + "% down" : r.p.upPct + "% up") + " · " : "") + C.fmtNum(r.p.moveLow, 0) + "–" + C.fmtNum(r.p.moveHigh, 0) + "% move")), sort: (r) => r.p.upPct ?? r.p.lean },
      { t: "Price then", v: (r) => fmt(r.P0, r.cur), sort: (r) => r.P0, n: true },
      { t: "Price now", v: (r) => r.now == null ? h("span", { class: "faint" }, "…") : fmt(r.now, r.cur), sort: (r) => r.now, n: true },
      { t: "Since logged", v: (r) => r.now && r.P0 ? U.chg((r.now / r.P0 - 1) * 100) : "—", sort: (r) => r.now && r.P0 ? r.now / r.P0 : null, n: true },
      { t: "Projected for target date", v: (r) => !r.proj ? "—" : r.proj.kind === "either" ? h("span", { class: "stack", style: "gap:0;justify-items:end" }, h("span", {}, "≥ " + fmt(r.proj.up, r.cur)), h("span", {}, "or ≤ " + fmt(r.proj.down, r.cur)), h("span", { class: "tiny muted" }, "big move either way")) : h("span", { class: "stack", style: "gap:0;justify-items:end" }, h("strong", {}, fmt(r.proj.mid, r.cur)), h("span", { class: "tiny muted" }, fmt(r.proj.lo, r.cur) + " – " + fmt(r.proj.hi, r.cur))), sort: (r) => r.proj && r.proj.mid, n: true },
      { t: "Target date", v: (r) => h("span", { class: "stack", style: "gap:0" }, h("span", {}, new Date(r.dueAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })), h("span", { class: "tiny muted" }, daysTo(r.dueAt))), sort: (r) => r.dueAt },
      { t: "Status", v: (r) => { const st = callStatus(r, r.now); return h("span", { class: "small " + st.cls }, st.label); }, sort: (r) => callStatus(r, r.now).label }];
    const table = U.dataTable(cols, rows, { key: "picks.log", sort: [0, -1], noun: "predictions", placeholder: "Filter by symbol…", onRow: (r) => r.asset && app.openAsset(r.asset) });
    const paintSummary = () => {
      const st = rows.map(r => callStatus(r, r.now).label);
      const n = (re) => st.filter(x => re.test(x)).length;
      summary.replaceChildren(h("span", { class: "pill" }, rows.length + " logged"), h("span", { class: "pill ok" }, n(/^Reached|^Hit/) + " reached"), h("span", { class: "pill" }, n(/^On track/) + " on track"), h("span", { class: "pill" }, n(/^Behind/) + " behind"), h("span", { class: "pill bad" }, n(/^Past|^Missed/) + " missed"));
    };
    const stamp = h("span", { class: "tiny muted" });
    const refresh = async () => {
      const uniq = new Map(); for (const r of rows) if (r.asset && !uniq.has(r.asset.id)) uniq.set(r.asset.id, r.asset);
      const prices = new Map();
      await pool([...uniq.values()], 4, async (a) => { try { const q = await app.quote(a, 50000); prices.set(a.id, q.price); } catch {} });
      for (const r of rows) if (r.asset && prices.has(r.asset.id)) r.now = prices.get(r.asset.id);
      table.update(rows); paintSummary(); stamp.textContent = "Prices as of " + new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) + " · refresh every minute";
    };
    paintSummary(); refresh();
    const timer = setInterval(() => { if (!document.body.contains(box)) { clearInterval(timer); return; } if (!document.hidden) refresh(); }, 60000);
    box.append(summary, table, h("div", { class: "row between" }, stamp, h("span", { class: "tiny muted" }, "Projected price = price when logged moved by the expected range (middle of the range in bold). Status compares today's price with that projection; the forecast journal scores each call on its date.")));
    const sec = U.section("Prediction log", box);
    sec.id = "prediction-log";
    return sec;
  }

  function setView(app, set) {
    const wrap = h("div", { class: "stack" });
    wrap.append(h("div", { class: "row between" }, h("div", { class: "stack", style: "gap:2px" }, h("h2", { style: "font-size:1.2rem" }, set.picks.length + " picks · " + set.windowLabel + (set.hiddenCount ? " (" + set.hiddenCount + " cleared)" : "")), h("span", { class: "small muted" }, "Generated " + U.fmtTs(set.createdAt) + " from " + set.candidates + " measured candidates, " + set.sourcesRetrieved + " retrieved sources" + (set.toolCalls ? " and " + set.toolCalls + " research steps" : "") + (set.demo ? " · demo" : ""))), h("span", { class: "small muted" }, "Prices refresh every minute")));
    if (set.focus) wrap.append(h("p", { class: "small" }, h("span", { class: "chip sm" }, "Focus"), " " + set.focus + " · " + set.picks.filter(p => p.focus).length + " of " + set.picks.length + " picks were named for it"));
    if (set.summary) wrap.append(h("p", {}, set.summary));
    if (set.review) wrap.append(h("div", { class: "aireview " + (set.review.dropped ? "neutral" : "positive") }, h("span", { class: "verdict sm " + (set.review.dropped ? "neutral" : "positive") }, "Reviewed"), h("span", { class: "small" }, set.review.kept + " held up, " + set.review.revised + " revised, " + set.review.dropped + " dropped. " + (set.review.overall || ""))));
    // At a glance: the odds, sizes and windows side by side.
    if (set.picks.some(p => p.upPct != null)) wrap.append(U.table([{ t: "Asset", v: (p) => h("span", { class: "stack", style: "gap:0" }, h("strong", {}, p.symbol + (p.mine ? " ★" : "")), h("span", { class: "tiny muted" }, String(p.asset.name || "").slice(0, 26))) },
      { t: "Chance up / down", v: (p) => p.upPct == null ? "—" : h("span", { class: "row", style: "gap:6px;align-items:center;justify-content:flex-end" }, h("span", { class: "up num" }, "▲ " + p.upPct + "%"), h("span", { class: "down num" }, "▼ " + (100 - p.upPct) + "%")), n: true },
      { t: "If up / if down", v: (p) => p.upPct == null ? "±" + C.fmtNum(p.moveLow, 0) + "–" + C.fmtNum(p.moveHigh, 0) + "%" : "+" + C.fmtNum(p.ifUpPct, 0) + "% / −" + C.fmtNum(p.ifDownPct, 0) + "%", n: true },
      { t: "Window", v: (p) => p.timeframeLabel }, { t: "Confidence", v: (p) => p.confidence + "/100", n: true }], set.picks, { onRow: (p) => app.openAsset(p.asset) }));
    // Set check: sector concentration across the picks and overlap with what the investor already holds.
    (() => {
      const secs = {}; for (const p of set.picks) { const s = p.moveExplained && p.moveExplained.sectorEtf ? (MD.brain.NAME[p.moveExplained.sectorEtf] || p.moveExplained.sectorEtf) : p.asset.cls === "crypto" ? "Crypto" : null; if (s) (secs[s] = secs[s] || []).push(p.symbol); }
      const top = Object.entries(secs).sort((a, b) => b[1].length - a[1].length)[0], held = myAssets(app).filter(a => a.held).map(a => a.symbol), overlap = set.picks.filter(p => held.includes(p.symbol)).map(p => p.symbol);
      const leanUp = set.picks.filter(p => p.upPct != null && p.upPct >= 50).length, withOdds = set.picks.filter(p => p.upPct != null).length;
      const notes = [];
      if (top && top[1].length >= Math.max(2, Math.ceil(set.picks.length / 2))) notes.push(top[1].length + " of " + set.picks.length + " picks are " + top[0] + " (" + top[1].join(", ") + "): they tend to move together, so the set is less diversified than it looks.");
      if (overlap.length) notes.push("You already hold " + overlap.join(", ") + ": a pick there adds to an existing position.");
      if (withOdds >= 3 && (leanUp === withOdds || leanUp === 0)) notes.push("Every pick leans " + (leanUp ? "up" : "down") + ": the set is a bet on the market's direction as much as on each name.");
      if (notes.length) wrap.append(h("div", { class: "banner info" }, h("p", { class: "small" }, h("strong", {}, "Set check: "), notes.join(" "))));
    })();
    const grid = h("div", { class: "grid g2" });
    const priceEls = new Map();
    for (const p of set.picks) {
      const leanCls = p.lean === "up" ? "positive" : p.lean === "down" ? "negative" : "neutral";
      const leanTxt = p.upPct != null ? (p.upPct >= 50 ? "▲ " + p.upPct + "% chance up" : "▼ " + (100 - p.upPct) + "% chance down") : p.lean === "up" ? "▲ Leans up · " + p.leanProbabilityPct + "%" : p.lean === "down" ? "▼ Leans down · " + p.leanProbabilityPct + "%" : "Older pick: no direction given";
      const m = p.measured || {};
      const now = h("span", { class: "num" }, "…"), since = h("span", { class: "num" });
      priceEls.set(p.symbol, { now, since, p });
      const due = new Date(set.createdAt + p.timeframeDays * 864e5);
      const lo = p.priceAtPick ? p.priceAtPick * (1 - p.moveHigh / 100) : null, hi = p.priceAtPick ? p.priceAtPick * (1 + p.moveHigh / 100) : null;
      grid.append(h("section", { class: "card" },
        h("div", { class: "hd" }, h("div", { class: "stack", style: "gap:0" }, h("strong", { style: "font-size:1.1rem" }, p.symbol + (p.mine ? " ★" : "")), h("span", { class: "small muted" }, p.asset.name + " · " + (p.asset.cls === "crypto" ? "Crypto" : p.asset.cls === "etf" ? "US ETF" : "US stock") + (p.mine ? " · on your watchlist or held" : ""))), h("span", { class: "verdict " + leanCls }, leanTxt)),
        h("div", { class: "bd" },
          p.upPct != null && MD.day ? MD.day.probBar(p.upPct, "Higher by " + due.toLocaleDateString(undefined, { month: "short", day: "numeric" }), "Lower") : null,
          U.kv([p.upPct != null ? ["If it rises / falls", "+" + C.fmtNum(p.ifUpPct, 0) + "% / −" + C.fmtNum(p.ifDownPct, 0) + "%"] : null, ["Expected move", "±" + C.fmtNum(p.moveLow, 0) + "–" + C.fmtNum(p.moveHigh, 0) + "%"], p.bigMove ? ["Chance of a ±" + C.fmtNum(Math.max(1, p.moveLow), 0) + "% move", (p.bigMove.eitherPct < 1 ? "under 1%" : p.bigMove.eitherPct.toFixed(0) + "%") + " (from volatility)"] : null, ["Time window", p.timeframeLabel], ["Price at pick", p.priceAtPick ? U.money(p.priceAtPick, p.currency || "USD", { price: true }) : "—"], ["Price now", now], ["Since pick", since], ["Confidence", p.confidence + "/100"]]),
          h("div", { class: "small muted" }, [m.impliedMovePct != null ? "Options market prices ±" + m.impliedMovePct.toFixed(1) + "% by " + m.impliedExpiry + (m.optionsAsOf ? " (" + m.optionsAsOf + ")" : "") : null, m.expectedMovePct != null ? "Volatility implies ±" + m.expectedMovePct.toFixed(1) + "% over the window (1σ)" : null, m.earnings ? "Earnings " + m.earnings.date : null, m.shortDaysToCover ? "Short interest " + m.shortDaysToCover.toFixed(1) + " days to cover" : null, lo && hi ? "Range at the high estimate: " + C.fmtNum(lo, lo >= 1 ? 2 : 4) + " – " + C.fmtNum(hi, hi >= 1 ? 2 : 4) : null].filter(Boolean).join(" · ")),
          h("div", {}, h("span", { class: "label" }, "Why it could move"), h("ul", { class: "small", style: "margin:4px 0 0;padding-left:1.1em;display:grid;gap:3px" }, p.why.map(w => h("li", {}, w)))),
          p.catalyst && p.catalyst.event ? h("p", { class: "small" }, h("strong", {}, "Catalyst: "), p.catalyst.event + (p.catalyst.date && p.catalyst.date !== "TBD" ? " (" + p.catalyst.date + ")" : "")) : null,
          p.invalidation ? h("p", { class: "small" }, h("strong", {}, "What would make it unlikely: "), p.invalidation) : null,
          p.risks ? h("p", { class: "small" }, h("strong", {}, "Biggest risk: "), p.risks) : null,
          p.bullCase || p.bearCase ? h("div", { class: "bullbear" }, h("div", { class: "bb up" }, h("span", { class: "label" }, "Bull case"), h("p", { class: "small" }, p.bullCase || "—")), h("div", { class: "bb down" }, h("span", { class: "label" }, "Bear case"), h("p", { class: "small" }, p.bearCase || "—"))) : null,
          p.changeMyMind ? h("p", { class: "small" }, h("strong", {}, "What would change the view: "), p.changeMyMind) : null,
          MD.ai.reviewBadge(p.review),
          (() => { const box = h("div", { class: "recheck" }); const c = app.store.cached("pickchecks").filter(x => x.setId === set.id && x.symbol === p.symbol).sort((a, b) => b.at - a.at)[0]; if (c) box.append(recheckNote(c)); return box; })(),
          p.probs ? h("details", { class: "small" }, h("summary", { class: "label", style: "cursor:pointer" }, "How the " + p.upPct + "% chance up was built"),
            h("p", { class: "small" }, "Claude: " + p.probs.claude + "%" + (p.probs.model != null ? " · the asset's own history: " + p.probs.model + "%" : " · no measured history") + " · blended " + p.probs.blended + "%" + (p.probs.learnedWeights ? " (weights learned from the record: Claude " + p.probs.weightClaude + "%)" : "") + (p.probs.reviewer != null ? " · the reviewer's own estimate: " + p.probs.reviewer + "%" : "") + ((p.probs.afterReview ?? p.probs.final) !== p.probs.blended ? " · after the review: " + (p.probs.afterReview ?? p.probs.final) + "%" : "") + (p.calibration ? " · calibrated from " + p.calibration.scored + " graded picks (calls like this came true " + p.calibration.observedPct + "% of the time): " + p.probs.final + "%" : "") + "."),
            p.baseRates ? h("ul", { class: "small", style: "margin:4px 0 0;padding-left:1.1em;display:grid;gap:2px" }, h("li", {}, "Over every " + p.timeframeDays + "-day window " + (() => { const y = String(p.baseRates.historyFrom || "").slice(0, 4); return /^\d{4}$/.test(y) ? "since " + y : "in the measured history"; })() + ", it finished higher " + p.baseRates.overallUpPct + "% of the time (" + p.baseRates.windows + " windows, about " + p.baseRates.independent + " independent)."), p.baseRates.conditions.map(x => h("li", {}, "When " + x.condition + ": higher " + x.upPct + "% of the time (" + x.windows + " windows, ≈" + x.independent + " independent)."))) : null,
            p.moveExplained && p.moveExplained.last5Days ? h("p", { class: "tiny muted" }, "Last 5 days " + U.pct(p.moveExplained.last5Days.movePct) + ": " + U.pct(p.moveExplained.last5Days.explainedPct) + " explained by the market and its factors, " + U.pct(p.moveExplained.last5Days.unexplainedPct) + " its own.") : null,
            p.probs.ml != null ? h("p", { class: "small" }, "Machine-learning model: " + p.probs.ml + "% up" + (p.probs.mlEdge ? " (beat the base rate out of sample, so it's averaged into the history side)" : " (no edge out of sample, so it isn't used)") + ".") : null,
            h("p", { class: "tiny muted" }, "History alone is capped at 25–75% and shrunk toward 50% when it has few independent windows.")) : null,
          p.confidenceParts ? h("details", { class: "small" }, h("summary", { class: "label", style: "cursor:pointer" }, "Confidence " + p.confidence + "/100: how it's built"), MD.ai.meters([{ label: "Claude", value: p.confidenceParts.claude, note: "Claude's own confidence" }, { label: "After review", value: p.confidenceParts.reviewed, note: "The second reader's adjusted confidence" }, { label: "Signals agree", value: p.confidenceParts.signals, note: "Momentum, Zacks Rank, 52-week position, options vs history" }, { label: "Evidence", value: p.confidenceParts.evidence, note: "Verified sources and a dated catalyst" }])) : null,
          p.sources.length ? h("div", { class: "small" }, h("span", { class: "label" }, "Sources "), p.sources.map((s, i) => h("span", {}, i ? " · " : "", h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer" }, (s.title || s.url).slice(0, 60)), s.verified ? null : h("span", { class: "warn-t" }, " (unverified)")))) : h("p", { class: "small faint" }, "No sources cited."),
          h("p", { class: "tiny muted" }, "Logged in your forecast journal; scored on " + due.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) + ".")),
        h("div", { class: "ft" },
          h("button", { class: "btn sm", type: "button", onclick: () => app.openAsset(p.asset) }, "Open live page"),
          h("button", { class: "btn ghost sm", type: "button", onclick: () => app.go("research", { asset: p.asset, prefill: "Could " + p.asset.name + " make a large move (" + p.moveLow + "–" + p.moveHigh + "%) " + p.timeframeLabel + "? Test this thesis: " + p.why.join(" ") }) }, "Deep research"),
          h("button", { class: "btn ghost sm", type: "button", onclick: () => X.alertModal(p.asset, { price: p.priceAtPick, currency: p.currency }) }, "Create alert"),
          p.upPct != null ? h("button", { class: "btn ghost sm", type: "button", onclick: () => bracketAlerts(app, p) }, "Alerts at target & downside") : null,
          p.upPct != null && set.id !== "unsaved" ? h("button", { class: "btn ghost sm", type: "button", onclick: async (ev) => {
            const btn = ev.currentTarget, box = btn.closest(".card").querySelector(".recheck"); btn.disabled = true; btn.textContent = "Re-checking…";
            try { const c = await recheck(app, set, p); box.replaceChildren(recheckNote(c)); } catch (e) { box.replaceChildren(U.errorBox({ message: MD.ai.errText(e) })); }
            btn.disabled = false; btn.textContent = "Re-check";
          } }, "Re-check") : null,
          p.catalyst && /^\d{4}-\d{2}-\d{2}$/.test(p.catalyst.date || "") ? h("button", { class: "btn ghost sm", type: "button", onclick: async () => { await app.store.create("catalysts", { assetId: p.asset.id, symbol: p.symbol, title: p.catalyst.event, date: p.catalyst.date, impact: "High", note: "From recommendations " + U.fmtDate(set.createdAt) }); U.toast("Catalyst tracked"); } }, "Track catalyst") : null,
          h("button", { class: "btn ghost sm", type: "button", onclick: () => { app.ctx.daytrade = { asset: p.asset }; app.go("daytrade", app.ctx.daytrade); } }, "Day-trade view"),
          set.id !== "unsaved" ? h("button", { class: "btn ghost sm pickrm", type: "button", "aria-label": "Remove " + p.symbol + " from recommendations", onclick: () => clearPicks(app, "pick", { setId: set.id, symbol: p.symbol }) }, "Remove") : null)));
    }
    wrap.append(grid);
    if (set.excluded && set.excluded.length) wrap.append(h("details", {}, h("summary", { class: "label", style: "cursor:pointer" }, "High-scoring candidates Claude left out (" + set.excluded.length + ")"), h("ul", { class: "small" }, set.excluded.map(e => h("li", {}, h("strong", {}, e.symbol + ": "), e.reason)))));
    const refresh = async () => {
      await Promise.all([...priceEls.values()].map(async ({ now, since, p }) => {
        try { const q = await app.quote(p.asset, 50000); now.textContent = U.money(q.price, q.currency || "USD", { price: true }); if (p.priceAtPick) { const ch = (q.price / p.priceAtPick - 1) * 100; since.className = "num " + U.signCls(ch); since.textContent = U.pct(ch); } }
        catch (e) { now.textContent = "unavailable"; }
      }));
    };
    refresh();
    const timer = setInterval(() => { if (!document.hidden && document.body.contains(wrap)) refresh(); else if (!document.body.contains(wrap)) clearInterval(timer); }, 60000);
    return wrap;
  }

  MD.picks = { generate, buildCandidates, journal, WINDOWS };
})(typeof window !== "undefined" ? window : globalThis);
