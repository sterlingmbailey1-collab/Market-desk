/* Market Brain: an AI that studies each session (what moved, by how much, and why) and learns which causes tend to
   produce which effects.
   - The page measures: index, sector, rates, dollar, oil, gold, credit and bitcoin moves; the regime (trend,
     volatility, stock–bond correlation, leadership); and how strongly each sector moves with rates, the dollar and oil.
   - Claude explains the session from news and the measured moves, names the drivers, and checks the playbook: each
     cause → effect pattern it has written before is marked confirmed or contradicted when a session tests it.
   - The page keeps score. A pattern's reliability is how often it held when tested, so the playbook learns from
     outcomes instead of from the AI's own say-so. The latest regime, themes and most reliable patterns are given to
     every other AI feature on the desk (MD.brain.note). */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const C = MD.core, Q = MD.quant, U = MD.ui, D = MD.data, h = U.h;
  const V = (MD.views = MD.views || {});
  const FACTORS = [["SPY", "S&P 500", "index"], ["QQQ", "Nasdaq-100", "index"], ["IWM", "Russell 2000 (small caps)", "index"], ["DIA", "Dow Jones", "index"],
    ["TLT", "Long Treasuries (up = long yields down)", "rates"], ["UUP", "US dollar", "dollar"], ["USO", "Oil", "commodity"], ["GLD", "Gold", "commodity"], ["HYG", "High-yield credit", "credit"],
    ["XLK", "Technology", "sector"], ["SMH", "Semiconductors", "sector"], ["XLF", "Financials", "sector"], ["XLE", "Energy", "sector"], ["XLV", "Health care", "sector"], ["XLY", "Consumer discretionary", "sector"],
    ["XLP", "Consumer staples", "sector"], ["XLI", "Industrials", "sector"], ["XLU", "Utilities", "sector"], ["XLB", "Materials", "sector"], ["XLRE", "Real estate", "sector"], ["XLC", "Communication services", "sector"]];
  const NAME = Object.fromEntries(FACTORS.map(f => [f[0], f[1]]));
  const SECTOR_ETF = [[/semiconductor/i, "SMH"], [/^technology|software|computer/i, "XLK"], [/financ|bank|insurance/i, "XLF"], [/energy|oil|gas/i, "XLE"], [/health|pharma|biotech|medical/i, "XLV"], [/consumer discretionary|retail|auto/i, "XLY"], [/consumer staples|food|beverage/i, "XLP"], [/industrial|aerospace|transport/i, "XLI"], [/utilit/i, "XLU"], [/materials|chemical|mining|steel/i, "XLB"], [/real estate|reit/i, "XLRE"], [/telecom|communication|media|internet/i, "XLC"]];
  function sectorEtf(p) { if (!p) return null; for (const [re, s] of SECTOR_ETF) if (re.test(p.industry || "")) return s; for (const [re, s] of SECTOR_ETF) if (re.test(p.sector || "")) return s; return null; }
  const etf = (s) => ({ id: "etf:" + s, cls: "etf", symbol: s, name: NAME[s] || s });
  const BTC = { id: "crypto:bitcoin", cls: "crypto", cgId: "bitcoin", symbol: "BTC", name: "Bitcoin" };
  const assetOf = (s) => s === "BTC" ? BTC : etf(s);
  const r1 = (x) => x == null || !isFinite(x) ? null : Math.round(x * 10) / 10;
  // How Claude writes a testable rule (quant.js backtests it over daily moves).
  const RULE_HELP = "Rules are over DAILY % moves. Instruments: " + FACTORS.map(f => f[0] + " (" + f[1] + ")").join(", ") + ", BTC (Bitcoin); any other US stock or ETF ticker also works (e.g. JETS airlines, KBE banks, XHB homebuilders, SOXX chips). Shape: {\"cause\": {\"symbol\": \"TLT\", \"op\": \"<\", \"pct\": -1}, \"effect\": {\"symbol\": \"XLK\", \"vs\": \"SPY\", \"op\": \"<\", \"pct\": 0}, \"lagDays\": 0} means: on days TLT falls more than 1%, XLK's move minus SPY's is below 0 the same day (lagDays 1 = the next day). \"vs\" is optional.";
  async function pool(items, n, fn) { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = { error: e }; } } })); return out; }

  /* ---------- measured market picture ---------- */
  let pulseCache = null;
  async function pulse(app, opts = {}) {
    if (pulseCache && Date.now() - pulseCache.at < 60000 && (!opts.history || pulseCache.history)) return pulseCache;
    const rows = (await pool(FACTORS.concat([["BTC", "Bitcoin", "crypto"]]), 4, async ([sym, name, kind]) => {
      const a = assetOf(sym);
      const [q, hs] = await Promise.all([app.quote(a, 30000).catch(() => null), opts.history ? D.historyCached(a, "1Y").catch(() => null) : null]);
      return { symbol: sym, name, kind, price: q ? q.price : null, changePct: q && q.changePct != null ? Number(q.changePct) : null, marketStatus: q ? q.marketStatus || q.status : null, ret5d: hs ? Q.lastMove(hs.points, 5) : null, ret1m: hs ? Q.lastMove(hs.points, hs.ppy === 365 ? 30 : 21) : null, hist: hs };
    })).filter(r => r && !r.error);
    const by = Object.fromEntries(rows.map(r => [r.symbol, r]));
    const out = { at: Date.now(), history: !!opts.history, rows, by, regime: opts.history ? regimeOf(by, rows) : (pulseCache && pulseCache.regime) || null, session: Q.session() };
    pulseCache = out;
    return out;
  }
  // Trend, volatility state, stock–bond correlation and leadership, measured from 1-year daily histories.
  function regimeOf(by, rows) {
    const spy = by.SPY && by.SPY.hist; if (!spy) return null;
    const t = C.technicals(spy.points, 252), r = C.returnsFrom(spy.points.map(p => p.close ?? p.value));
    const v20 = C.stdev(r.slice(-20)) * Math.sqrt(252) * 100, vYr = C.stdev(r) * Math.sqrt(252) * 100;
    const sbc = by.TLT && by.TLT.hist ? Q.recentCorrelation(spy.points, by.TLT.hist.points, 60) : null;
    const sectors = rows.filter(x => x.kind === "sector" && x.ret1m != null).sort((a, b) => b.ret1m - a.ret1m);
    const spread = (a, b) => by[a] && by[b] && by[a].ret1m != null && by[b].ret1m != null ? by[a].ret1m - by[b].ret1m : null;
    const volState = v20 > vYr * 1.35 ? "stressed" : v20 < vYr * 0.75 ? "calm" : "normal";
    // Sector rotation: strength against the S&P 500 over 3 months (x) and 1 month (y), the classic four quadrants.
    const mv = (x, n) => x && x.hist ? Q.lastMove(x.hist.points, n) : null, spy1 = mv(by.SPY, 21), spy3 = mv(by.SPY, 63);
    const rotation = spy1 == null || spy3 == null ? [] : rows.filter(x => x.kind === "sector" && x.hist).map(x => { const a = mv(x, 21), c = mv(x, 63); if (a == null || c == null) return null; const rs1 = a - spy1, rs3 = c - spy3; return { symbol: x.symbol, name: x.name, rs1mPts: r1(rs1), rs3mPts: r1(rs3), quadrant: rs3 >= 0 ? (rs1 >= 0 ? "Leading" : "Weakening") : (rs1 >= 0 ? "Improving" : "Lagging") }; }).filter(Boolean);
    const trend = t ? t.trend : null;
    const label = (trend === "up" ? "Uptrend" : trend === "down" ? "Downtrend" : "Choppy, no clear trend") + ", " + volState + " volatility" + (sbc == null ? "" : sbc < -0.2 ? ", stocks and long bonds moving opposite (rates-driven)" : sbc > 0.2 ? ", stocks and long bonds moving together (growth-driven)" : "");
    return { rotation, label, trend, aboveSma200: t && t.sma200 ? t.last > t.sma200 : null, spyFromHighPct: t ? r1(t.fromHighPct) : null, spyRsi14: t ? r1(t.rsi14) : null, vol20Pct: r1(v20), volYearPct: r1(vYr), volState, stockBondCorr60d: sbc == null ? null : Math.round(sbc * 100) / 100,
      leaders: sectors.slice(0, 3).map(s => ({ symbol: s.symbol, name: s.name, ret1mPct: r1(s.ret1m) })), laggards: sectors.slice(-3).reverse().map(s => ({ symbol: s.symbol, name: s.name, ret1mPct: r1(s.ret1m) })),
      smallVsLarge1mPct: r1(spread("IWM", "SPY")), cyclicalVsDefensive1mPct: r1(spread("XLY", "XLP")), credit1mPct: r1(by.HYG && by.HYG.ret1m), dollar1mPct: r1(by.UUP && by.UUP.ret1m), oil1mPct: r1(by.USO && by.USO.ret1m), gold1mPct: r1(by.GLD && by.GLD.ret1m), longBonds1mPct: r1(by.TLT && by.TLT.ret1m), bitcoin1mPct: r1(by.BTC && by.BTC.ret1m) };
  }
  function rotationSvg(rot) {
    if (!rot || !rot.length) return null;
    const W = 420, H = 280, pad = 30, mx = Math.max(2, ...rot.map(r => Math.abs(r.rs3mPts))), my = Math.max(2, ...rot.map(r => Math.abs(r.rs1mPts)));
    const x = (v) => W / 2 + v / mx * (W / 2 - pad), y = (v) => H / 2 - v / my * (H / 2 - pad);
    const q = (t, X, Y, anchor) => '<text x="' + X + '" y="' + Y + '" font-size="10" fill="currentColor" opacity="0.55" text-anchor="' + anchor + '">' + t + '</text>';
    const dots = rot.map(r => '<g><title>' + r.name + ': ' + (r.rs3mPts > 0 ? "+" : "") + r.rs3mPts + ' pts vs SPY over 3 months, ' + (r.rs1mPts > 0 ? "+" : "") + r.rs1mPts + ' over 1 month (' + r.quadrant + ')</title><circle cx="' + x(r.rs3mPts).toFixed(1) + '" cy="' + y(r.rs1mPts).toFixed(1) + '" r="4.5" class="rq-' + r.quadrant.toLowerCase() + '"/><text x="' + (x(r.rs3mPts) + 7).toFixed(1) + '" y="' + (y(r.rs1mPts) + 3.5).toFixed(1) + '" font-size="10.5" fill="currentColor">' + r.symbol + '</text></g>').join("");
    return h("div", { class: "rotation", html: '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:520px" role="img" aria-label="Sector rotation: strength against the S&P 500 over three months and one month">' +
      '<line x1="' + pad + '" y1="' + H / 2 + '" x2="' + (W - pad) + '" y2="' + H / 2 + '" stroke="currentColor" stroke-opacity="0.25"/><line x1="' + W / 2 + '" y1="' + pad / 2 + '" x2="' + W / 2 + '" y2="' + (H - pad / 2) + '" stroke="currentColor" stroke-opacity="0.25"/>' +
      q("Leading", W - pad, pad, "end") + q("Weakening", W - pad, H - pad / 2 + 4, "end") + q("Lagging", pad, H - pad / 2 + 4, "start") + q("Improving", pad, pad, "start") +
      q("← weaker over 3 months · stronger →", W / 2, H - 2, "middle") + dots + '</svg>' });
  }
  // What moves what: each sector's beta to the S&P 500 and its 60-day correlation with long bonds, the dollar and oil.
  function sensitivities(P) {
    const g = (s) => P.by[s] && P.by[s].hist && P.by[s].hist.points;
    if (!g("SPY")) return [];
    return P.rows.filter(r => (r.kind === "sector" || r.symbol === "IWM" || r.symbol === "BTC") && g(r.symbol)).map(r => {
      const pts = g(r.symbol), b = C.betaTo(pts, g("SPY")), c = (f) => g(f) ? Q.recentCorrelation(pts, g(f), 60) : null;
      return { symbol: r.symbol, name: r.name, betaToSPY: b ? Math.round(b.beta * 100) / 100 : null, corrLongBonds: c("TLT"), corrDollar: c("UUP"), corrOil: c("USO"), corrGold: c("GLD") };
    });
  }

  /* Why an asset moved: a factor model on a year of daily returns splits today's and the last week's move into the
     market, its sector, rates, the dollar and oil (bitcoin and tech for coins), and the unexplained remainder. */
  // The factor model alone (no quotes): which factors, the fitted betas, and the asset's own history.
  async function fitFactors(app, asset) {
    const cls = asset.cls || String(asset.id).split(":")[0];
    let factors, market, relative = [], sector = null;
    if (cls === "crypto") { market = asset.symbol === "BTC" ? "QQQ" : "BTC"; factors = asset.symbol === "BTC" ? ["QQQ", "UUP", "GLD"] : ["BTC", "QQQ", "UUP"]; }
    else if (cls === "stock" || cls === "etf") {
      const pr = cls === "stock" ? await D.stocks.profile(asset.symbol, cls).catch(() => null) : null;
      sector = sectorEtf(pr); if (sector === asset.symbol) sector = null;
      market = "SPY"; factors = ["SPY"].concat(sector ? [sector] : [], ["TLT", "UUP", "USO"]); relative = sector ? [sector] : [];
      if (asset.symbol === "SPY") { market = null; factors = ["TLT", "UUP", "USO"]; }
    } else throw new Error("Move explanations cover stocks, ETFs and crypto.");
    const [ha, ...hf] = await Promise.all([D.historyCached(asset, "1Y"), ...factors.map(f => D.historyCached(assetOf(f), "1Y").catch(() => null))]);
    const fmap = {}; factors.forEach((f, i) => { if (hf[i]) fmap[f] = hf[i].points; });
    const model = Q.factorModel(ha.points, fmap, { market, relative, ppy: ha.ppy || 252 });
    if (!model) throw new Error("Not enough overlapping history to model " + (asset.symbol || asset.name) + ".");
    return { cls, model, ha, fmap, sector };
  }
  async function explainMove(app, asset) {
    const { cls, model, ha, fmap, sector } = await fitFactors(app, asset);
    const qs = await Promise.all([app.quote(asset, 30000).catch(() => null), ...model.names.map(f => app.quote(assetOf(f), 30000).catch(() => null))]);
    const todayF = {}; model.names.forEach((f, i) => { const q = qs[i + 1]; if (q && q.changePct != null) todayF[f] = Number(q.changePct); });
    const today = qs[0] && qs[0].changePct != null ? Q.attribute(model, todayF, Number(qs[0].changePct)) : null;
    const wkF = {}; model.names.forEach(f => { wkF[f] = Q.lastMove(fmap[f], 5); });
    const week = Q.attribute(model, wkF, Q.lastMove(ha.points, 5));
    const residDaily = model.residVolPct / Math.sqrt(ha.ppy || 252), z = today && residDaily ? today.unexplainedPct / residDaily : null;
    const verdict = !today ? null : Math.abs(today.unexplainedPct) < Math.abs(today.explainedPct) ? "Mostly the market and its factors" : z != null && Math.abs(z) >= 2 ? "Mostly asset-specific, and unusually large for it: look for news" : "Mostly asset-specific, within its normal range";
    return { symbol: asset.symbol, name: asset.name, sectorEtf: sector, sectorName: sector ? NAME[sector] : null, model: { factors: model.names.map(n => ({ factor: n, name: n === "BTC" ? "Bitcoin" : NAME[n] || n, beta: Math.round(model.betas[n] * 100) / 100, relativeToMarket: model.relative.includes(n) })), r2: Math.round(model.r2 * 100) / 100, residualVolPct: r1(model.residVolPct), days: model.n },
      today, week, typicalAssetSpecificDailyPct: r1(residDaily), unexplainedZ: z == null ? null : Math.round(z * 10) / 10, verdict, note: cls === "crypto" ? "Coin moves are 24-hour changes; the ETFs' are session changes." : null };
  }

  /* ---------- testable rules ---------- */
  // Daily histories for a rule's symbols: the pulse's 1-year histories when loaded, otherwise fetched.
  async function seriesFor(app, syms, tf, P) {
    const out = {};
    await pool(syms, 4, async (s) => {
      if (tf === "1Y" && P && P.by[s] && P.by[s].hist) { out[s] = P.by[s].hist.points; return; }
      const a = s === "BTC" ? BTC : NAME[s] || D.stocks.ETFS.some(e => e[0] === s) ? etf(s) : { id: "stock:" + s, cls: "stock", symbol: s, name: s };
      try { out[s] = (await D.historyCached(a, tf)).points; } catch { if (a.cls === "stock") try { out[s] = (await D.historyCached(etf(s), tf)).points; } catch {} }
    });
    return out;
  }
  async function backtest(app, rule, tf, P) {
    const syms = [...new Set([rule.cause.symbol, rule.effect.symbol].concat(rule.effect.vs ? [rule.effect.vs] : []))];
    return Object.assign(Q.backtestRule(rule, await seriesFor(app, syms, tf || "1Y", P)), { lookback: tf || "1Y", at: Date.now() });
  }
  const btLine = (b) => !b ? "" : b.error ? b.error : "cause happened " + b.occurrences + " times; effect followed " + b.held + " (" + (b.heldPct ?? "—") + "%) vs " + (b.baselinePct ?? "—") + "% on all days" + (b.z != null ? " (z " + b.z + ")" : "");
  // Turn a plain-English idea into a rule and backtest it.
  async function testIdea(app, text, tf) {
    const s = app.caps.sample; if (!s) throw Object.assign(new Error("Claude isn't available in this view."), { code: "no_sample" });
    const r = await s.json(`Turn this market hypothesis into a rule the app can backtest, or say plainly why it can't be tested with daily price moves. ${RULE_HELP}
Use ETFs as proxies where sensible (yields up = TLT down; oil = USO; airlines = JETS). Pick thresholds that match the idea: a "big" daily move is usually 1–2% for stock funds, 3–5% for bitcoin.
Hypothesis: ${JSON.stringify(String(text).slice(0, 400))}
Reply with ONLY JSON: {"testable": true|false, "why": "one sentence: what the rule measures, or why it can't be tested", "pattern": "When <cause>, <effect>", "rule": {...} or null}`, { cache: false });
    const rule = r.testable ? Q.cleanRule(r.rule) : null;
    if (!rule) return { testable: false, why: String(r.why || "This idea can't be expressed as a rule over daily moves.") };
    const P = await pulse(app, { history: true }).catch(() => null);
    return { testable: true, why: String(r.why || ""), pattern: String(r.pattern || "").slice(0, 220), rule, backtest: await backtest(app, rule, tf, P) };
  }

  /* ---------- the playbook (cause → effect patterns with a scored record) ---------- */
  const PB_ID = "playbook";
  function playbook(app) { const d = app.store.cached("brain").find(x => x.id === PB_ID); return d ? JSON.parse(JSON.stringify(d)) : { patterns: [], themes: [], lessons: [], narrative: "" }; }
  function stats(p) { const v = Object.values(p.tests || {}), c = v.filter(x => x === "confirmed").length, x = v.filter(x => x === "contradicted").length; return { tested: c + x, confirmed: c, contradicted: x, reliability: (c + 1) / (c + x + 2) }; }
  const words = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 2));
  function similar(a, b) { const A = words(a), B = words(b); if (!A.size || !B.size) return 0; let n = 0; for (const w of A) if (B.has(w)) n++; return n / (A.size + B.size - n); }
  function recaps(app) { return app.store.cached("marketdays").slice().sort((a, b) => (b.sessionDate || "").localeCompare(a.sessionDate || "") || b.createdAt - a.createdAt); }
  // The latest recap per session date (re-studying a session replaces its view, not its history).
  function latestPerDay(app) { const seen = new Set(); return recaps(app).filter(r => !seen.has(r.sessionDate) && seen.add(r.sessionDate)); }

  // The last session whose regular hours have finished (today after the close, otherwise the previous trading day).
  function lastClosedSession(now = new Date()) {
    const s = Q.session(now);
    if (s.tradingDay && s.nyMinutes >= (s.earlyClose ? 780 : 960)) return s.date;
    for (let i = 1; i < 10; i++) { const p = Q.nyParts(new Date(now.getTime() - i * 864e5)); if (p.dow > 0 && p.dow < 6 && !Q.HOLIDAYS.has(p.ymd)) return p.ymd; }
    return s.date;
  }

  /* ---------- studying a session ---------- */
  async function studySession(app, opts = {}) {
    const s = app.caps.sample; if (!s) throw Object.assign(new Error("Claude isn't available in this view."), { code: "no_sample" });
    const S = MD.ai.session(opts.onLog), step = (t) => S.step("run", t);
    const sess = Q.session(), sessionDate = sess.phase === "open" || sess.phase === "pre" ? sess.date : lastClosedSession();
    let e = step("Measuring indices, sectors, rates, the dollar, oil, gold, credit and bitcoin (1-year histories)");
    const P = await pulse(app, { history: true }); S.done(e, "ok", " → " + P.rows.length + " instruments");
    e = step("Loading the session's biggest movers");
    const [mv, big, coins] = await Promise.all([D.stocks.movers().catch(() => null), D.stocks.screener(0, 100).catch(() => []), D.crypto.top("usd", 25).catch(() => [])]);
    const bigMovers = big.filter(r => r.changePct != null).sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).slice(0, 10).map(r => ({ symbol: r.symbol, name: r.name, changePct: r1(r.changePct), marketCapB: r.marketCap ? r1(r.marketCap / 1e9) : null }));
    const pick = (rows) => (rows || []).filter(r => r.price >= 5).slice(0, 6).map(r => ({ symbol: r.symbol, name: r.name, changePct: r1(r.changePct), price: r.price }));
    const notable = mv ? { asOf: mv.asOf, gainers: pick(mv.gainers.rows), losers: pick(mv.losers.rows) } : null;
    const cryptoMoves = coins.filter(c => !["USDT", "USDC", "DAI", "USDE", "FDUSD"].includes(c.symbol)).slice(0, 12).map(c => ({ symbol: c.symbol, changePct24h: r1(c.changePct) }));
    S.done(e, "ok", " → " + bigMovers.length + " large caps, " + cryptoMoves.length + " coins");
    e = step("Checking today's economic calendar and earnings reports");
    const [econ, earn] = await Promise.all([D.calendar.economic(sessionDate).catch(() => []), D.calendar.earnings(sessionDate).catch(() => [])]);
    const bigSet = new Set(big.map(r => r.symbol));
    const events = econ.filter(x => /United States|US/i.test(x.country || "")).slice(0, 14).map(x => ({ time: x.gmt, event: x.event, actual: x.actual, consensus: x.consensus, previous: x.previous }));
    const reports = earn.filter(x => bigSet.has(x.symbol)).slice(0, 12).map(x => ({ symbol: x.symbol, time: x.time }));
    S.done(e, "ok", " → " + events.length + " US releases, " + reports.length + " large-cap reports");
    const pb = playbook(app), active = pb.patterns.filter(p => p.status !== "retired");
    const measured = { sessionDate, sessionPhase: sess.phase, instruments: P.rows.map(r => ({ symbol: r.symbol, name: r.name, todayPct: r1(r.changePct), fiveDayPct: r1(r.ret5d), oneMonthPct: r1(r.ret1m) })), regime: P.regime, largeCapMovers: bigMovers, notableMovers: notable, crypto: cryptoMoves, economicReleases: events, largeCapEarnings: reports };
    const prior = latestPerDay(app).filter(r => r.sessionDate !== sessionDate).slice(0, 5).map(r => ({ date: r.sessionDate, headline: r.headline, drivers: (r.drivers || []).map(d => d.driver) }));
    const tools = MD.ai.tools(app, S, ["search_news", "search_web", "read_page", "crypto_news", "explain_move", "stock_snapshot", "backtest_rule"]);
    e = step("Claude is explaining the session and testing the playbook (usually 1–3 minutes)");
    const prompt = `You are Market Desk's market analyst. Your job is to understand WHY markets moved in the session of ${sessionDate}${sess.phase === "open" ? " (still in progress)" : ""}, so the desk learns cause and effect over time.
The app measured the session below. Use 4 to 10 tool calls: search_news for the big moves and the macro story (one topic per call), explain_move for one or two large movers whose move needs separating from the market, search_web if news comes up empty. Cite only URLs the tools returned. Never invent figures; use the measured numbers.
Explain the session: the main drivers (with evidence), which instruments each one moved and how much (measured), and the biggest movers' reasons. Then test the playbook: for each existing pattern whose CAUSE actually occurred this session, say whether the EFFECT followed (confirmed) or not (contradicted); skip patterns not tested and patterns marked scoredByApp (the app scores those from the measured moves). Propose at most 3 new patterns only if this session gives a clear, checkable example of a cause and its effect (phrase them as "When <cause>, <effect>"), each with a testable rule when one exists so the app can backtest it. Be honest about one-off noise.
${RULE_HELP}
Measured session: ${JSON.stringify(measured)}
Playbook patterns: ${JSON.stringify(active.map(p => ({ id: p.id, pattern: p.pattern, record: stats(p), rule: p.rule ? Q.ruleText(p.rule) : null, scoredByApp: !!(p.rule && !p.rule.lagDays), backtest1y: p.backtest && !p.backtest.error ? { cases: p.backtest.occurrences, heldPct: p.backtest.heldPct, baselinePct: p.backtest.baselinePct } : null })))}
Recent sessions you studied: ${JSON.stringify(prior)}
Reply with ONLY JSON:
{"headline": "one sentence: what the session was about",
 "summary": "3-5 sentences tying the measured moves to their causes",
 "drivers": [{"driver": "short name", "category": "rates"|"inflation"|"growth data"|"earnings"|"central banks"|"policy"|"geopolitics"|"AI & tech"|"energy"|"crypto"|"flows & positioning"|"other", "explanation": "how it moved markets, citing measured moves", "effects": [{"on": "SPY or a sector ETF or ticker", "direction": "up"|"down", "movePct": number}], "strength": "major"|"moderate"|"minor", "persistence": "one-day"|"developing"|"ongoing theme", "sources": [{"title": "...", "url": "https://..."}]}],
 "movers": [{"symbol": "...", "movePct": number, "why": "one sentence", "source": "https://... or null"}],
 "patternChecks": [{"id": "pattern id", "verdict": "confirmed"|"contradicted", "note": "the measured evidence"}],
 "newPatterns": [{"pattern": "When <cause>, <effect>", "cause": "...", "effect": "...", "category": "same list as drivers", "evidence": "this session's measured example", "rule": {...} or null}],
 "regime": {"label": "a few words", "note": "one sentence on what kind of market this is and what it rewards"},
 "watchNext": ["2-4 things to watch next session"],
 "confidence": 0-100}`;
    const r = await s.json(prompt, { modelTier: "complex", signal: opts.signal, tools });
    S.done(e, "ok", " → " + (Array.isArray(r.drivers) ? r.drivers.length : 0) + " drivers");
    const recap = { sessionDate, phase: sess.phase, headline: String(r.headline || "").slice(0, 240), summary: String(r.summary || "").slice(0, 1600), regimeAI: r.regime || null, confidence: Math.max(0, Math.min(100, Number(r.confidence) || 0)),
      drivers: (Array.isArray(r.drivers) ? r.drivers : []).slice(0, 6).map(d => ({ driver: String(d.driver || "").slice(0, 120), category: String(d.category || "other"), explanation: String(d.explanation || "").slice(0, 600), effects: (Array.isArray(d.effects) ? d.effects : []).slice(0, 6).map(x => ({ on: String(x.on || ""), direction: x.direction === "down" ? "down" : "up", movePct: Number(x.movePct) || null })), strength: ["major", "moderate", "minor"].includes(d.strength) ? d.strength : "moderate", persistence: String(d.persistence || ""), sources: S.verify(d.sources) })),
      movers: (Array.isArray(r.movers) ? r.movers : []).slice(0, 10).map(m => ({ symbol: String(m.symbol || ""), movePct: Number(m.movePct) || null, why: String(m.why || ""), source: m.source && /^https?:/.test(m.source) ? S.verify([{ url: m.source, title: m.symbol }])[0] : null })),
      watchNext: (Array.isArray(r.watchNext) ? r.watchNext : []).slice(0, 4).map(String),
      measured: { regime: P.regime, instruments: measured.instruments, largeCapMovers: bigMovers, crypto: cryptoMoves, events, reports },
      patternChecks: [], newPatternIds: [], sourcesRetrieved: S.sources.length, toolCalls: S.calls, steps: S.log.map(x => ({ kind: x.kind, text: x.text })) };
    // Score the playbook: one verdict per pattern per session; re-studying a session replaces that session's verdict.
    const byId = new Map(pb.patterns.map(p => [p.id, p]));
    for (const c of Array.isArray(r.patternChecks) ? r.patternChecks : []) {
      const p = byId.get(String(c.id)); if (!p || !["confirmed", "contradicted"].includes(c.verdict)) continue;
      p.tests = Object.assign({}, p.tests, { [sessionDate]: c.verdict }); p.lastNote = String(c.note || "").slice(0, 300); p.lastTested = sessionDate;
      recap.patternChecks.push({ id: p.id, pattern: p.pattern, verdict: c.verdict, note: p.lastNote });
    }
    for (const n of (Array.isArray(r.newPatterns) ? r.newPatterns : []).slice(0, 3)) {
      const text = String(n.pattern || "").slice(0, 220); if (!text) continue;
      const dup = pb.patterns.find(p => similar(p.pattern, text) >= 0.55);
      if (dup) { if (!dup.tests || !dup.tests[sessionDate]) { dup.tests = Object.assign({}, dup.tests, { [sessionDate]: "confirmed" }); recap.patternChecks.push({ id: dup.id, pattern: dup.pattern, verdict: "confirmed", note: "Seen again: " + String(n.evidence || "").slice(0, 200) }); } continue; }
      const p = { id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), pattern: text, cause: String(n.cause || ""), effect: String(n.effect || ""), category: String(n.category || "other"), firstSeen: sessionDate, evidence: String(n.evidence || "").slice(0, 300), tests: {}, status: "active", rule: Q.cleanRule(n.rule) };
      pb.patterns.push(p); recap.newPatternIds.push(p.id);
    }
    // Backtest every new rule on a year of daily moves, and score same-day rules from the session's measured moves
    // (the app's verdict replaces Claude's for those).
    const newRules = pb.patterns.filter(p => p.rule && recap.newPatternIds.includes(p.id));
    if (newRules.length) { e = step("Backtesting " + newRules.length + " new rule" + (newRules.length > 1 ? "s" : "") + " on a year of daily moves"); for (const p of newRules) p.backtest = await backtest(app, p.rule, "1Y", P).catch(x => ({ error: U.errorText(x) })); S.done(e, "ok"); }
    const moves = Object.fromEntries(P.rows.filter(x => x.changePct != null).map(x => [x.symbol, x.changePct]));
    for (const p of pb.patterns.filter(x => x.status === "active" && x.rule && !x.rule.lagDays && !recap.newPatternIds.includes(x.id))) {
      const t = Q.ruleToday(p.rule, moves); if (!t || !t.causeHappened) continue;
      const v = t.effectFollowed ? "confirmed" : "contradicted";
      p.tests = Object.assign({}, p.tests, { [sessionDate]: v }); p.testSrc = Object.assign({}, p.testSrc, { [sessionDate]: "measured" }); p.lastTested = sessionDate;
      p.lastNote = "Measured: " + p.rule.cause.symbol + " " + fmtP(t.causePct) + ", effect " + fmtP(t.effectPct);
      const entry = { id: p.id, pattern: p.pattern, verdict: v, note: p.lastNote, measured: true }, i = recap.patternChecks.findIndex(c => c.id === p.id);
      if (i >= 0) recap.patternChecks[i] = entry; else recap.patternChecks.push(entry);
    }
    // Retire patterns that keep failing once they have a real record.
    for (const p of pb.patterns) { const st = stats(p); if (p.status !== "retired" && st.tested >= 4 && st.reliability < 0.35) { p.status = "retired"; p.retiredOn = sessionDate; p.retiredWhy = "Held " + st.confirmed + " of " + st.tested + " times"; } }
    if (!app.demo) { const saved = await app.store.create("marketdays", recap); pb.updatedAt = Date.now(); await app.store.put("brain", PB_ID, Object.assign(pb, { id: PB_ID })); return saved; }
    return Object.assign({ id: "unsaved", createdAt: Date.now() }, recap);
  }

  /* Step back across every studied session: merge duplicate patterns, sharpen vague ones, retire ones the record
     doesn't support, and name the themes that keep recurring. */
  async function refinePlaybook(app, opts = {}) {
    const s = app.caps.sample; if (!s) throw Object.assign(new Error("Claude isn't available in this view."), { code: "no_sample" });
    const pb = playbook(app), days = latestPerDay(app).slice(0, 30);
    if (days.length < 2) throw new Error("Study at least two sessions first.");
    const cats = {}; for (const d of days) for (const x of d.drivers || []) cats[x.category] = (cats[x.category] || 0) + 1;
    const P = await pulse(app, { history: true }).catch(() => null);
    const r = await s.json(`You maintain Market Desk's playbook of cause → effect patterns learned from studying market sessions. Below are the patterns with their measured record (how often they held when a session tested them) and summaries of the last ${days.length} sessions. Refine the playbook:
- merge patterns that say the same thing (mergeInto the one with the better record),
- rewrite vague patterns so a future session can clearly test them (keep the meaning),
- retire patterns the record doesn't support (held less than half the time after 4+ tests) or that were one-off noise,
- name the recurring themes (with how many sessions they drove) and whether each is rising, steady or fading,
- write 3-5 lessons for an investor about what has been moving this market, grounded in the record,
- give a testable rule for any kept pattern that lacks one, when it can be expressed over daily moves.
Never invent sessions or results. Patterns with few tests are hypotheses; say so. Weigh each pattern's 1-year backtest (backtest1y) as well as its session record.
${RULE_HELP}
Patterns: ${JSON.stringify(pb.patterns.map(p => Object.assign({ id: p.id, pattern: p.pattern, status: p.status, firstSeen: p.firstSeen, rule: p.rule ? Q.ruleText(p.rule) : null, backtest1y: p.backtest && !p.backtest.error ? { cases: p.backtest.occurrences, heldPct: p.backtest.heldPct, baselinePct: p.backtest.baselinePct, z: p.backtest.z } : null }, stats(p))))}
Driver categories over these sessions: ${JSON.stringify(cats)}
Sessions: ${JSON.stringify(days.map(d => ({ date: d.sessionDate, headline: d.headline, drivers: (d.drivers || []).map(x => x.driver + " (" + x.category + ", " + x.strength + ")") })))}
Measured regime now: ${JSON.stringify(P && P.regime)}
Reply with ONLY JSON: {"patterns": [{"id": "existing id", "action": "keep"|"rewrite"|"merge"|"retire", "pattern": "new wording when rewriting", "mergeInto": "id when merging", "reason": "short", "rule": {...} or null}], "themes": [{"theme": "...", "sessions": number, "status": "rising"|"steady"|"fading", "note": "..."}], "narrative": "3-4 sentences on the market's story across these sessions", "lessons": ["..."]}`, { modelTier: "complex", signal: opts.signal, cache: false });
    const byId = new Map(pb.patterns.map(p => [p.id, p])), changes = [];
    for (const a of Array.isArray(r.patterns) ? r.patterns : []) {
      const p = byId.get(String(a.id)); if (!p) continue;
      const nr = Q.cleanRule(a.rule); if (nr && !p.rule) { p.rule = nr; changes.push({ id: p.id, action: "rule", from: p.pattern, to: Q.ruleText(nr), reason: "Now testable" }); }
      if (a.action === "rewrite" && a.pattern) { changes.push({ id: p.id, action: "rewrite", from: p.pattern, to: String(a.pattern).slice(0, 220), reason: String(a.reason || "") }); p.pattern = String(a.pattern).slice(0, 220); }
      else if (a.action === "merge" && byId.has(String(a.mergeInto)) && String(a.mergeInto) !== p.id) { const into = byId.get(String(a.mergeInto)); into.tests = Object.assign({}, p.tests, into.tests); p.status = "merged"; p.mergedInto = into.id; changes.push({ id: p.id, action: "merge", from: p.pattern, to: into.pattern, reason: String(a.reason || "") }); }
      else if (a.action === "retire" && p.status !== "retired") { p.status = "retired"; p.retiredWhy = String(a.reason || "Retired when the playbook was refined"); changes.push({ id: p.id, action: "retire", from: p.pattern, reason: p.retiredWhy }); }
    }
    pb.patterns = pb.patterns.filter(p => p.status !== "merged");
    // Re-run every active rule's backtest on fresh data.
    for (const p of pb.patterns.filter(x => x.rule && x.status === "active")) p.backtest = await backtest(app, p.rule, "1Y", P).catch(x => ({ error: U.errorText(x) }));
    Object.assign(pb, { themes: (Array.isArray(r.themes) ? r.themes : []).slice(0, 8).map(t => ({ theme: String(t.theme || ""), sessions: Number(t.sessions) || null, status: String(t.status || ""), note: String(t.note || "") })), narrative: String(r.narrative || "").slice(0, 1200), lessons: (Array.isArray(r.lessons) ? r.lessons : []).slice(0, 5).map(String), refinedAt: Date.now(), refinedFrom: days.length, lastChanges: changes });
    if (!app.demo) await app.store.put("brain", PB_ID, Object.assign(pb, { id: PB_ID }));
    return pb;
  }

  /* ---------- the daily market call: will the S&P 500 close up? ---------- */
  const SPY = etf("SPY");
  /* Market regimes found by k-means on SPY's daily history (MD.ml.regimes), cached for the session and given to the AI. */
  let regimeCache = null;
  async function regimesNow() {
    if (regimeCache && Date.now() - regimeCache.at < 3 * 3600e3) return regimeCache;
    const hs = await D.dailyLong(SPY), R = MD.ml.regimes(hs.points, { k: 4, horizonBars: 21 });
    if (R.error) throw new Error(R.error);
    regimeCache = Object.assign(R, { at: Date.now(), source: hs.source });
    return regimeCache;
  }
  function regimeNote() {
    const R = regimeCache; if (!R) return "";
    const g = R.todayGroup, n = g.next;
    return " Machine-learning regime (k-means on SPY since " + R.from + "): " + g.name + " since " + R.since + " (20-day trend " + g.trend20Pct.toFixed(1) + "%, volatility " + g.volPct.toFixed(0) + "%); in this regime SPY rose over the next month " + (n.upPct != null ? n.upPct.toFixed(0) + "% of the time, average " + (n.avgPct >= 0 ? "+" : "") + n.avgPct.toFixed(1) + "% (about " + n.independent + " independent months)" : "with too few months to measure") + ".";
  }
  const REGIME_COLORS = ["var(--accent)", "var(--up)", "var(--down)", "var(--warn)", "var(--muted)"];
  function regimeView(R) {
    const g0 = R.todayGroup, last = R.timeline.slice(-252), w = last.length;
    const svg = '<svg viewBox="0 0 ' + w + ' 14" preserveAspectRatio="none" width="100%" height="14" role="img" aria-label="Regime of each day over the past year">' + last.map((d, i) => '<rect x="' + i + '" y="0" width="1.05" height="14" fill="' + REGIME_COLORS[d.g % REGIME_COLORS.length] + '"/>').join("") + "</svg>";
    const sw = (j) => h("span", { style: "display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;background:" + REGIME_COLORS[j % REGIME_COLORS.length] });
    const f1 = (x) => x == null ? "—" : (x > 0 ? "+" : "") + x.toFixed(1) + "%";
    return h("div", { class: "stack" },
      h("p", {}, h("strong", {}, "Today: " + g0.name), " · since " + R.since + " · " + "S&P 500 rose over the next month " + (g0.next.upPct != null ? g0.next.upPct.toFixed(0) + "% of the time in this regime (average " + f1(g0.next.avgPct) + ")" : "— too few months to measure") + "."),
      h("div", { html: svg, style: "border-radius:6px;overflow:hidden" }), h("div", { class: "row between tiny muted" }, h("span", {}, "a year ago"), h("span", {}, "today")),
      U.table([{ t: "Regime", v: (g) => h("span", { style: g.id === R.today ? "font-weight:700" : "" }, sw(g.id), g.name + (g.id === R.today ? " (today)" : "")) },
        { t: "Share of days", v: (g) => g.sharePct.toFixed(0) + "%", n: true }, { t: "20-day trend", v: (g) => f1(g.trend20Pct), n: true }, { t: "Volatility", v: (g) => g.volPct.toFixed(0) + "%", n: true },
        { t: "vs 200-day", v: (g) => f1(g.from200Pct), n: true }, { t: "From 1-yr high", v: (g) => f1(g.fromHighPct), n: true },
        { t: "Next month: avg", v: (g) => h("span", { class: g.next.avgPct > 0 ? "up" : g.next.avgPct < 0 ? "down" : "" }, f1(g.next.avgPct)), n: true },
        { t: "Next month: rose", v: (g) => g.next.upPct != null ? g.next.upPct.toFixed(0) + "% (" + g.next.independent + ")" : "—", n: true }], R.groups),
      h("p", { class: "tiny muted" }, "Unsupervised machine learning: k-means groups " + R.days + " S&P 500 days (" + R.from + " to " + R.asOf + ", " + (R.source || "Nasdaq") + ") by trend, volatility, distance from the 200-day average and drawdown. The regimes come from the data, not from fixed rules; names are given afterwards from each group's averages. \"Next month\" is what SPY did over the following 21 trading days, with the number of independent months in brackets. Measured history, not a forecast."));
  }
  function callsFor(app) { return app.store.cached("marketcalls").slice().sort((a, b) => b.at - a.at); }
  function latestCall(app) { const t = Q.targetSession(); return callsFor(app).find(c => c.target === t) || null; }
  /* Claude's call on the next close, anchored to SPY's own one-day base rate, checked by the review pass. The first
     call per session is logged in the forecast journal (source ai-market) and graded from that session's close. */
  async function marketCall(app, opts = {}) {
    const s = app.caps.sample; if (!s) throw Object.assign(new Error("Claude isn't available in this view."), { code: "no_sample" });
    const S = MD.ai.session(opts.onLog), step = (t) => S.step("run", t);
    const sess = Q.session(), target = Q.targetSession(), live = sess.phase === "open" && sess.date === target;
    let e = step("Measuring the market and SPY's own odds of an up day");
    const [P, br, it, q] = await Promise.all([pulse(app, { history: true }).catch(() => null), MD.ai.baseRatesFor(SPY, 1).catch(() => null), D.stocks.intraday("SPY", "etf").catch(() => null), app.quote(SPY, 20000).catch(() => null)]);
    S.done(e, "ok", br ? " → history: up " + br.model.upPct + "% of days in situations like today's" : " → no base rate");
    // Reference price: during the session, the current price; before the open, the previous close (an "up day");
    // after the close, today's close (the next session's up day).
    const itDate = it && it.points.length ? Q.nyParts(new Date(it.points[it.points.length - 1].time * 1000)).ymd : null;
    const ref = live ? (q && q.price) : sess.date === target ? (it && it.previousClose) || (q && q.price) : (it && itDate === sess.date && it.regular ? it.regular.last : q && q.price);
    const refLabel = live ? "the current price" : "the previous close";
    e = step("Checking the calendar and earnings for " + target);
    const [econ, earn, big] = await Promise.all([D.calendar.economic(target).catch(() => []), D.calendar.earnings(target).catch(() => []), D.stocks.screener(0, 100).catch(() => [])]);
    const bigSet = new Set(big.map(r => r.symbol)), events = econ.filter(x => /United States|US/i.test(x.country || "")).slice(0, 12).map(x => ({ timeGMT: x.gmt, event: x.event, actual: x.actual || null, consensus: x.consensus || null, previous: x.previous || null }));
    const reports = earn.filter(x => bigSet.has(x.symbol)).slice(0, 10).map(x => ({ symbol: x.symbol, time: x.time }));
    S.done(e, "ok", " → " + events.length + " US releases, " + reports.length + " large-cap reports");
    const pb = playbook(app), rules = pb.patterns.filter(p => p.status === "active" && p.rule && p.backtest && !p.backtest.error && p.backtest.occurrences >= 8).map(p => ({ pattern: p.pattern, rule: Q.ruleText(p.rule), backtest: { heldPct: p.backtest.heldPct, baselinePct: p.backtest.baselinePct, z: p.backtest.z } }));
    const lim = await s.limits().catch(() => null);
    const tools = lim && lim.tools ? MD.ai.tools(app, S, ["search_news", "search_web", "market_memory", "backtest_rule", "explain_move", "economic_calendar"]) : undefined;
    // Machine learning on SPY's daily history for the next session, judged out of sample.
    let ml = null;
    if (MD.mlView) { e = step("Training the machine-learning model on SPY's daily history"); try { ml = MD.mlView.compact(await MD.mlView.run(app, SPY, 1)); S.done(e, "ok", " → " + ml.upPct + "% up, " + (ml.edgeOutOfSample ? "clear edge out of sample" : "no clear edge out of sample")); } catch (err) { S.done(e, "fail", " → " + U.errorText(err)); } }
    const reg = await regimesNow().catch(() => null);
    const measured = { mlModel: ml, regime: reg ? { name: reg.todayGroup.name, since: reg.since, nextMonthUpPct: reg.todayGroup.next.upPct != null ? Math.round(reg.todayGroup.next.upPct) : null, nextMonthAvgPct: reg.todayGroup.next.avgPct != null ? +reg.todayGroup.next.avgPct.toFixed(2) : null, independentMonths: reg.todayGroup.next.independent } : null, target, phase: sess.phase, live, referencePrice: ref, reference: refLabel, spyBaseRate: br ? { modelUpPct: br.model.upPct, overallUpPct: Math.round(br.overall.upPct), conditions: br.conditions.map(c => ({ condition: c.label, upPct: Math.round(c.upPct), days: c.n })), typicalUpDayPct: br.model.avgUpPct, typicalDownDayPct: br.model.avgDownPct } : null,
      preMarket: it && it.pre && !live ? { high: it.pre.high, low: it.pre.low, last: it.pre.last, vsPreviousClosePct: it.previousClose ? Math.round((it.pre.last / it.previousClose - 1) * 1e4) / 100 : null } : null,
      now: P ? P.rows.map(r => ({ symbol: r.symbol, todayPct: r1(r.changePct), fiveDayPct: r1(r.ret5d) })) : null, regime: P && P.regime, economicReleases: events, largeCapEarnings: reports, backtestedPatterns: rules };
    e = step("Claude is making the call (usually under a minute)");
    const r = await s.json(`You are Market Desk's market strategist. Give the probability that the S&P 500 (SPY) closes the ${target} session ABOVE ${refLabel} (${ref ? ref.toFixed(2) : "n/a"}).
Start from SPY's measured base rate (spyBaseRate.modelUpPct: how often it rose in a day in situations like today's; mlModel adds a machine-learning model tested out of sample, worth weight only when edgeOutOfSample is true) and move away from it only for evidence it can't know: ${live ? "how the session is trading so far," : "pre-market moves,"} scheduled releases and their consensus, large-cap earnings, news, and backtested patterns whose cause is in play. Daily direction is close to a coin flip: calls far from 50% need strong evidence. ${tools ? "Use 2 to 6 tool calls (search_news for overnight and macro news; economic_calendar or market_memory if useful). Cite only URLs the tools returned." : ""}
${MD.ai.calibrationNote(MD.ai.trackRecord(app, "ai-market"))}
${note(app)}
Measured: ${JSON.stringify(measured)}
Reply with ONLY JSON: {"upProbabilityPct": 30-70, "summary": "2-3 sentences", "drivers": ["what matters most, with evidence"], "keyEvents": ["time ET: event"], "expectedRangePct": number (typical size of the day's move), "flipIf": "what would flip the call", "sectorTilt": {"leaders": ["sector funds likely to lead"], "laggards": ["..."]}, "confidence": 0-100, "sources": [{"title": "...", "url": "https://..."}]}`, Object.assign({ modelTier: "complex", signal: opts.signal }, tools ? { tools } : { cache: false }));
    S.done(e, "ok");
    let claudeUp = Math.max(25, Math.min(75, Number(r.upProbabilityPct) || 50)), conf = Math.max(0, Math.min(100, Number(r.confidence) || 0)), panelInfo = null;
    const modelUp = br ? (ml && ml.edgeOutOfSample ? Math.round((br.model.upPct + ml.upPct) / 2 * 10) / 10 : br.model.upPct) : null;
    // Specialist panel: three more analysts estimate the same odds independently; the team's number is used.
    const PN = await MD.ai.panel(app, { task: "Estimate the chance the S&P 500 (SPY) closes the " + target + " session ABOVE " + refLabel + " (" + (ref ? ref.toFixed(2) : "n/a") + ").", items: [{ id: "spy", symbol: "SPY", horizonDays: 1 }], facts: measured, S, signal: opts.signal }).catch(e => { if (e && e.code === "cancelled") throw e; return null; });
    if (PN && PN.spy) { const T = MD.ai.teamUp(claudeUp, PN.spy, MD.ai.panelWeights(app).weights); panelInfo = Object.assign({ lead: Math.round(claudeUp), spread: Math.round(T.spread) }, PN.spy.by); claudeUp = Math.max(25, Math.min(75, T.upPct)); conf = Math.max(0, conf - MD.ai.disagreementPenalty(T.spread)); }
    const bw = MD.ai.blendFor(app, "ai-market");
    let up = modelUp != null ? bw.wClaude * claudeUp + (1 - bw.wClaude) * modelUp : claudeUp;
    const rv = await MD.ai.review(app, { task: "Will SPY close the " + target + " session above " + refLabel + "?", S, signal: opts.signal, facts: measured, items: [{ id: "call", upProbabilityPct: Math.round(up), drivers: r.drivers, confidence: conf }] }).catch(() => null);
    const review = rv && rv.reviews[0] || null;
    const reviewerUp = review && review.probabilityPct != null ? Math.round(review.probabilityPct) : null;
    if (reviewerUp != null) up = (up + reviewerUp) / 2;
    else if (review && review.adjustedConfidence != null && review.adjustedConfidence < conf && conf) up = 50 + (up - 50) * review.adjustedConfidence / conf;
    if (review && review.adjustedConfidence != null && review.adjustedConfidence < conf) conf = review.adjustedConfidence;
    // The learned combiner replaces the fixed pipeline once it has beaten it on the graded record; otherwise calibrate.
    const stk = MD.ai.stackFor(app, "ai-market"), cal = stk.used ? { applied: false } : MD.ai.calibrateUp(app, "ai-market", up);
    if (stk.used) up = Math.max(25, Math.min(75, stk.apply({ c: claudeUp, m: modelUp, r: reviewerUp, ml: ml ? ml.upPct : null }))); else if (cal.applied) up = cal.upPct;
    up = Math.round(up);
    const call = { target, at: Date.now(), phase: sess.phase, live, refPrice: ref, refLabel, upPct: up, downPct: 100 - up, panel: panelInfo, probs: { claude: Math.round(claudeUp), model: modelUp, ml: ml ? ml.upPct : null, mlEdge: ml ? ml.edgeOutOfSample : null, reviewer: reviewerUp, final: up, weightClaude: Math.round(bw.wClaude * 100), learnedWeights: bw.learned }, calibration: cal.applied ? cal : null, stacked: stk.used ? { n: stk.n } : null, summary: String(r.summary || ""), drivers: (r.drivers || []).slice(0, 5).map(String), keyEvents: (r.keyEvents || []).slice(0, 6).map(String), expectedRangePct: Number(r.expectedRangePct) || null, flipIf: String(r.flipIf || ""), sectorTilt: r.sectorTilt || null, confidence: conf, review, sources: S.verify(r.sources), toolCalls: S.calls, steps: S.log.map(x => ({ kind: x.kind, text: x.text })) };
    if (app.demo) return Object.assign({ id: "unsaved" }, call);
    // Only the first call per session counts for the record; later ones are shown but not logged.
    const first = !app.store.cached("marketcalls").some(c => c.target === target && c.forecastId);
    if (first && ref > 0 && up !== 50) {
      const f = await app.store.create("forecasts", { assetId: SPY.id, asset: SPY, symbol: "SPY", source: "ai-market", horizonDays: 1, dueAt: Q.closeTimeUTC(target), priceAtCreation: ref, currency: "USD", priceSource: refLabel, direction: up > 50 ? "up" : "down", probability: Math.max(up, 100 - up) / 100, thesis: call.summary, flatBandPct: 0, sessionDate: target, claudeUpPct: call.probs.claude, modelUpPct: call.probs.model, reviewerUpPct: call.probs.reviewer ?? null, leadUpPct: call.panel ? call.panel.lead : null, panelUpPct: call.panel ? { fundamentals: call.panel.fundamentals ?? null, quant: call.panel.quant ?? null, news: call.panel.news ?? null } : null, mlUpPct: call.probs.ml ?? null }).catch(() => null);
      call.forecastId = f && f.id; call.dueAt = Q.closeTimeUTC(target);
    }
    return app.store.create("marketcalls", call);
  }
  function callCard(app, c) {
    if (!c) return h("div", { class: "empty" }, "No call yet for " + Q.targetSession() + ".");
    const ev = c.forecastId && app.store.cached("evals").find(x => x.forecastId === c.forecastId);
    return h("div", { class: "stack" },
      h("div", { class: "row between", style: "flex-wrap:wrap;gap:8px" }, h("strong", {}, "S&P 500 on " + c.target + ": " + (c.upPct >= 50 ? "▲ " + c.upPct + "% chance it closes up" : "▼ " + (100 - c.upPct) + "% chance it closes down")), h("span", { class: "tiny muted" }, "vs " + c.refLabel + (c.refPrice ? " " + c.refPrice.toFixed(2) : "") + " · made " + U.fmtTs(c.at) + " · confidence " + c.confidence + "/100")),
      MD.day ? MD.day.probBar(c.upPct, "Closes up", "Closes down") : null,
      h("p", {}, c.summary), MD.ai.list("Drivers", c.drivers), MD.ai.list("Key events", c.keyEvents),
      c.flipIf ? h("p", { class: "small" }, h("strong", {}, "Would flip the call: "), c.flipIf) : null,
      c.sectorTilt && (c.sectorTilt.leaders || []).length ? h("p", { class: "small muted" }, "Likely leaders: " + c.sectorTilt.leaders.join(", ") + (c.sectorTilt.laggards && c.sectorTilt.laggards.length ? " · laggards: " + c.sectorTilt.laggards.join(", ") : "")) : null,
      h("p", { class: "tiny muted" }, (c.panel ? "Specialist panel: fundamentals " + (c.panel.fundamentals ?? "—") + "%, quant " + (c.panel.quant ?? "—") + "%, news & macro " + (c.panel.news ?? "—") + "%, lead " + c.panel.lead + "% (spread ±" + c.panel.spread + ") → " : "") + "Claude " + c.probs.claude + "%" + (c.probs.model != null ? " · SPY's own history " + c.probs.model + "%" : "") + (c.probs.ml != null ? " · machine-learning model " + c.probs.ml + "% (" + (c.probs.mlEdge ? "clear edge, counted" : "no clear edge, not counted") + ")" : "") + (c.probs.reviewer != null ? " · reviewer's own estimate " + c.probs.reviewer + "%" : "") + (c.calibration ? " · calibrated from " + c.calibration.scored + " graded calls" : "") + " · final " + c.probs.final + "%" + (c.expectedRangePct ? " · typical move ±" + c.expectedRangePct + "%" : "")),
      MD.ai.reviewBadge(c.review), MD.ai.sources(c.sources),
      ev ? h("p", { class: ev.directionHit ? "up small" : "down small" }, (ev.directionHit ? "Right: " : "Wrong: ") + "SPY closed at " + Number(ev.priceAtDue).toFixed(2) + " (" + fmtP(ev.realizedReturnPct) + ")") : c.forecastId ? h("p", { class: "tiny muted" }, "Logged; graded from the " + c.target + " close.") : h("p", { class: "tiny muted" }, "Not logged: the first call for this session already counts."));
  }
  function callsRecord(app) {
    const tr = MD.ai.trackRecord(app, "ai-market"), calls = callsFor(app).filter(c => c.forecastId), evals = app.store.cached("evals");
    if (!calls.length) return null;
    return h("details", {}, h("summary", { class: "label", style: "cursor:pointer" }, "Market-call record: " + tr.scored + " graded" + (tr.hitPct != null ? ", " + tr.hitPct.toFixed(0) + "% right" : "") + (tr.brier != null ? ", Brier " + tr.brier.toFixed(3) : "")),
      U.table([{ t: "Session", v: "target" }, { t: "Call", v: (c) => c.upPct >= 50 ? "▲ " + c.upPct + "% up" : "▼ " + (100 - c.upPct) + "% down" }, { t: "Result", v: (c) => { const ev = evals.find(x => x.forecastId === c.forecastId); return ev ? h("span", { class: ev.directionHit ? "up" : "down" }, (ev.directionHit ? "Right" : "Wrong") + " · " + fmtP(ev.realizedReturnPct)) : h("span", { class: "muted" }, "pending"); } }], calls.slice(0, 30)));
  }

  /* ---------- what the rest of the desk is told ---------- */
  function weeklyNote(app) {
    const w = reviews(app)[0]; if (!w || Date.now() - w.at > 10 * 864e5) return "";
    return " Weekly review (" + w.week + "): " + w.headline + (w.lessons.length ? " Lessons: " + w.lessons.slice(0, 3).join("; ") + "." : "") + (w.nextWeek.length ? " Next week: " + w.nextWeek.slice(0, 4).map(x => x.date + " " + x.event).join("; ") + "." : "");
  }
  function note(app) {
    if (!app || !app.store) return "";
    const days = latestPerDay(app); if (!days.length) { const wn = weeklyNote(app) + regimeNote(); return wn ? ("Market Brain:" + wn).slice(0, 1300) : ""; }
    const pb = playbook(app), last = days[0], rg = (pulseCache && pulseCache.regime) || (last.measured && last.measured.regime) || null;
    const ranked = pb.patterns.filter(p => p.status === "active").map(p => Object.assign({ st: stats(p) }, p));
    const proven = ranked.filter(p => p.st.tested >= 2).sort((a, b) => b.st.reliability * Math.log(1 + b.st.tested) - a.st.reliability * Math.log(1 + a.st.tested)).slice(0, 4);
    const fresh = ranked.filter(p => p.st.tested < 2 && !(p.backtest && p.backtest.z >= 1)).slice(-2);
    const backed = ranked.filter(p => p.backtest && !p.backtest.error && p.backtest.occurrences >= 8 && p.backtest.z >= 1).sort((a, b) => b.backtest.z - a.backtest.z).slice(0, 3);
    const cats = {}; for (const d of days.slice(0, 10)) for (const x of d.drivers || []) cats[x.category] = (cats[x.category] || 0) + 1;
    const top = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => k + " (" + n + " of the last " + Math.min(10, days.length) + " sessions)");
    return ("Market Brain (the desk's own study of " + days.length + " session" + (days.length > 1 ? "s" : "") + "; latest " + last.sessionDate + "): " + (last.headline || "") +
      (rg ? " Regime: " + rg.label + (rg.leaders && rg.leaders.length ? "; leading sectors " + rg.leaders.map(l => l.name).join(", ") : "") + "." : "") +
      (top.length ? " Recurring drivers: " + top.join(", ") + "." : "") +
      (rg && rg.rotation && rg.rotation.length ? " Sector rotation vs SPY: " + ["Leading", "Improving", "Weakening"].map(qd => { const xs = rg.rotation.filter(r => r.quadrant === qd); return xs.length ? qd.toLowerCase() + " " + xs.map(r => r.name).join(", ") : null; }).filter(Boolean).join("; ") + "." : "") +
      (pb.themes && pb.themes.length ? " Themes: " + pb.themes.slice(0, 3).map(t => t.theme + " (" + t.status + ")").join("; ") + "." : "") +
      (proven.length ? " Patterns with a record: " + proven.map(p => "\"" + p.pattern + "\" held " + p.st.confirmed + " of " + p.st.tested + " times").join("; ") + "." : "") +
      (backed.length ? " Backtested over a year of daily moves: " + backed.map(p => "\"" + p.pattern + "\" held " + p.backtest.held + " of " + p.backtest.occurrences + " times (" + p.backtest.heldPct + "% vs " + p.backtest.baselinePct + "% on all days)").join("; ") + "." : "") +
      (fresh.length ? " Untested hypotheses: " + fresh.map(p => "\"" + p.pattern + "\"").join("; ") + "." : "") +
      (() => { const c = latestCall(app); return c ? " The desk's market call for " + c.target + ": SPY " + (c.upPct >= 50 ? "up" : "down") + " " + Math.max(c.upPct, 100 - c.upPct) + "% (" + c.summary.slice(0, 160) + ")." : ""; })() +
      weeklyNote(app).slice(0, 600) + regimeNote() +
      " Use this as context and check it against current data; patterns can break.").slice(0, 2600);
  }
  // What the brain knows about one symbol, sector ETF or theme (for the market_memory tool and asset pages).
  function memory(app, query) {
    const q = String(query || "").trim().toLowerCase(), days = latestPerDay(app), pb = playbook(app);
    const hit = (t) => !q || String(t || "").toLowerCase().includes(q);
    return { sessionsStudied: days.length, regimeNow: (pulseCache && pulseCache.regime) || (days[0] && days[0].measured && days[0].measured.regime) || null, narrative: pb.narrative || null, themes: pb.themes || [], lessons: pb.lessons || [],
      patterns: pb.patterns.filter(p => p.status === "active" && (hit(p.pattern) || hit(p.category) || (p.rule && hit(Q.ruleText(p.rule))))).slice(0, 12).map(p => Object.assign({ pattern: p.pattern, category: p.category, firstSeen: p.firstSeen, rule: p.rule ? Q.ruleText(p.rule) : null, backtest1y: p.backtest && !p.backtest.error ? { cases: p.backtest.occurrences, held: p.backtest.held, heldPct: p.backtest.heldPct, baselinePct: p.backtest.baselinePct, z: p.backtest.z } : null }, stats(p))),
      sessions: days.filter(d => !q || hit(d.headline) || hit(d.summary) || (d.drivers || []).some(x => hit(x.driver) || hit(x.explanation) || (x.effects || []).some(e => hit(e.on))) || (d.movers || []).some(m => hit(m.symbol))).slice(0, 8)
        .map(d => ({ date: d.sessionDate, headline: d.headline, drivers: (d.drivers || []).map(x => ({ driver: x.driver, category: x.category, effects: x.effects })), movers: (d.movers || []).filter(m => !q || hit(m.symbol)).slice(0, 5) })) };
  }

  /* ---------- weekly review ---------- */
  // The week a time falls in, by its Monday (UTC). A review written on the weekend covers the week just ended.
  function weekKey(t = Date.now()) { const d = new Date(t), wd = (d.getUTCDay() + 6) % 7; return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - wd)).toISOString().slice(0, 10); }
  function reviews(app) { return app.store.cached("weekly").slice().sort((a, b) => b.at - a.at); }
  async function weeklyReview(app, opts = {}) {
    const s = app.caps.sample; if (!s) throw Object.assign(new Error("Claude isn't available in this view."), { code: "no_sample" });
    const S = MD.ai.session(opts.onLog), now = Date.now(), from = now - 7 * 864e5, ymd = (t) => new Date(t).toISOString().slice(0, 10);
    let e = S.step("run", "Gathering the week: graded calls, studied sessions and the market's 5-day moves");
    const evals = app.store.cached("evals"), graded = app.store.cached("forecasts").map(f => { const v = evals.find(x => x.forecastId === f.id); return v && v.evaluatedAt >= from ? { symbol: f.symbol, by: MD.ai.SOURCE_LABEL[f.source] || f.source || "you", call: f.direction, probabilityPct: f.probability ? Math.round(f.probability * 100) : null, madeOn: ymd(f.createdAt), returnPct: v.realizedReturnPct != null ? +Number(v.realizedReturnPct).toFixed(2) : null, right: !!v.directionHit, thesis: String(f.thesis || "").slice(0, 160) } : null; }).filter(Boolean);
    const sessions = latestPerDay(app).filter(d => d.sessionDate >= ymd(from)).map(d => ({ date: d.sessionDate, headline: d.headline, drivers: (d.drivers || []).slice(0, 4).map(x => x.driver + " (" + x.category + ")") }));
    const P = await pulse(app, { history: true }).catch(() => null);
    const week = P ? P.rows.filter(r => r.ret5d != null).map(r => ({ symbol: r.symbol, name: r.name, kind: r.kind, last5DaysPct: +r.ret5d.toFixed(2), last1mPct: r.ret1m != null ? +r.ret1m.toFixed(2) : null })) : [];
    const mine = new Set(app.store.cached("watch").map(w => w.symbol).concat((await app.valuePortfolio(app.settings.reportingCurrency).catch(() => ({ rows: [] }))).rows.filter(r => r.p.qty.gt(0)).map(r => r.p.symbol)));
    const days = []; for (let i = 1; days.length < 5 && i < 10; i++) { const d = new Date(now + i * 864e5); if (d.getUTCDay() % 6) days.push(ymd(d)); }
    const earn = (await Promise.all(days.map(d => D.calendar.earnings(d).catch(() => [])))).flat();
    const nextEarnings = earn.filter(x => mine.has(x.symbol)).concat(earn.filter(x => !mine.has(x.symbol)).sort((a, b) => (Number(String(b.marketCap || "").replace(/[$,]/g, "")) || 0) - (Number(String(a.marketCap || "").replace(/[$,]/g, "")) || 0)).slice(0, 10)).map(x => ({ date: x.date, symbol: x.symbol, name: x.name, time: x.time, yours: mine.has(x.symbol) }));
    S.done(e, "ok", " → " + graded.length + " graded calls, " + sessions.length + " sessions studied, " + nextEarnings.length + " earnings next week");
    const lim = await s.limits().catch(() => null);
    const tools = lim && lim.tools ? MD.ai.tools(app, S, ["economic_calendar", "search_news", "market_memory", "explain_move", "search_web"]) : undefined;
    e = S.step("run", "Claude is writing the review (usually 1–2 minutes)");
    const prompt = `You are the desk's market analyst writing the WEEKLY REVIEW for the week ending ${ymd(now)}. ${tools ? "Use 3 to 8 tool calls: economic_calendar for next week's key US releases (call it for the dates that matter), search_news for the week's biggest market stories, market_memory for what the desk already learned. Cite only URLs the tools returned." : "Tools are unavailable: rely on the measured data and say so."}
Explain WHY the market did what it did (causes and their effects, with evidence), not just what moved. Grade the desk's own calls honestly: what it got right and wrong and why. Draw specific, testable lessons that would improve next week's calls. Never invent numbers.
${MD.ai.contextNote(app)}
Measured 5-day and 1-month moves (computed by the app): ${JSON.stringify(week)}
Sessions the desk studied this week: ${JSON.stringify(sessions)}
The desk's calls graded this week: ${JSON.stringify(graded.slice(0, 30))}
Earnings next week (yours flagged): ${JSON.stringify(nextEarnings)}
Reply with ONLY JSON:
{"headline": "one sentence", "summary": "3-4 sentences", "why": [{"cause": "...", "effect": "what it moved and how much", "evidence": "measured figure or source"}],
 "deskRight": ["..."], "deskWrong": ["... and why"], "lessons": ["specific, testable lesson for next week"],
 "nextWeek": [{"date": "YYYY-MM-DD", "event": "...", "whyItMatters": "...", "watch": ["TICKER"]}], "risks": "the main risk to the current picture",
 "sources": [{"title": "...", "url": "https://..."}]}`;
    const r = await s.json(prompt, Object.assign({ modelTier: "complex", signal: opts.signal }, tools ? { tools } : { cache: false }));
    S.done(e, "ok");
    const arr = (x, n) => Array.isArray(x) ? x.slice(0, n) : [];
    const doc = { week: weekKey(now), at: now, headline: String(r.headline || ""), summary: String(r.summary || ""), why: arr(r.why, 6).map(w => ({ cause: String(w.cause || ""), effect: String(w.effect || ""), evidence: String(w.evidence || "") })),
      deskRight: arr(r.deskRight, 5).map(String), deskWrong: arr(r.deskWrong, 5).map(String), lessons: arr(r.lessons, 5).map(String), nextWeek: arr(r.nextWeek, 8).map(x => ({ date: String(x.date || ""), event: String(x.event || ""), whyItMatters: String(x.whyItMatters || ""), watch: arr(x.watch, 6).map(String) })),
      risks: String(r.risks || ""), sources: S.verify(r.sources), measured: { graded: graded.length, right: graded.filter(g => g.right).length, sessions: sessions.length, earningsNextWeek: nextEarnings.length }, toolCalls: S.calls };
    return app.demo ? doc : await app.store.create("weekly", doc);
  }
  function reviewView(app, w) {
    if (!w) return h("p", { class: "small muted" }, "No weekly review yet. It looks back at the week (what moved and why, the desk's graded calls) and ahead to next week's events, and its lessons are given to every AI on the desk.");
    return h("div", { class: "stack" },
      h("div", { class: "row between", style: "flex-wrap:wrap;gap:8px" }, h("strong", {}, w.headline), h("span", { class: "tiny muted" }, "Week of " + w.week + " · written " + U.fmtTs(w.at) + " · " + (w.measured.graded ? w.measured.right + " of " + w.measured.graded + " graded calls right" : "no calls graded this week"))),
      w.summary ? h("p", {}, w.summary) : null,
      w.why.length ? h("div", {}, h("span", { class: "label" }, "Why it happened"), h("ul", { class: "small", style: "margin:4px 0 0;padding-left:1.1em;display:grid;gap:4px" }, w.why.map(x => h("li", {}, h("strong", {}, x.cause), " → " + x.effect, x.evidence ? h("span", { class: "muted" }, " (" + x.evidence + ")") : null)))) : null,
      h("div", { class: "grid g2" }, MD.ai.list("What the desk got right", w.deskRight), MD.ai.list("What it got wrong", w.deskWrong)),
      MD.ai.list("Lessons for next week (told to every AI)", w.lessons),
      w.nextWeek.length ? h("div", {}, h("span", { class: "label" }, "Next week"), U.table([{ t: "Date", v: (x) => x.date }, { t: "Event", v: (x) => x.event }, { t: "Why it matters", v: (x) => x.whyItMatters }, { t: "Watch", v: (x) => x.watch.join(", ") || "—" }], w.nextWeek)) : null,
      w.risks ? h("p", { class: "small" }, h("strong", {}, "Main risk: "), w.risks) : null,
      MD.ai.sources(w.sources));
  }

  /* ---------- automatic study after each close ---------- */
  let autoRunning = false;
  async function autoStudy(app) {
    if (autoRunning || app.demo || !app.caps.sample || !D.available() || document.hidden) return;
    if (app.settings.brainAuto === false || !app.store.cached("marketdays").length) return; // starts once the user has studied a session
    const sess = Q.session(); if (sess.phase === "open" || sess.phase === "pre") return;
    const target = lastClosedSession(), studied = latestPerDay(app).some(d => d.sessionDate === target && d.phase !== "open");
    const nowD = new Date(), wd = nowD.getUTCDay(), weeklyDue = (wd === 6 || wd === 0 || (wd === 5 && nowD.getUTCHours() >= 21)) && !reviews(app).some(r => r.week === weekKey());
    if (studied && !weeklyDue) return;
    autoRunning = true;
    try {
      if (!studied) await afterClose(app, target);
      if (weeklyDue) { const w = await weeklyReview(app, {}); app.emit("data:weekly"); await app.store.create("inbox", { kind: "brain", title: "Weekly review: " + w.headline, body: (w.lessons[0] ? "Lesson: " + w.lessons[0] + " " : "") + "Next week: " + w.nextWeek.slice(0, 3).map(x => x.date + " " + x.event).join("; ") + ". Source: Claude's review of the week's measured moves, graded calls and retrieved news.", materiality: 1, read: false, at: Date.now() }).catch(() => {}); }
    }
    catch (e) { /* tried again at the next check */ }
    finally { autoRunning = false; }
  }
  // After each close: study the session, re-study lessons once 10+ more calls are graded, and make the next market call.
  async function afterClose(app, target) {
    const r = await studySession(app, {}); app.emit("data:marketdays");
    await app.store.create("inbox", { kind: "brain", title: "Market Brain studied " + target, body: r.headline + " Source: Claude's study of measured moves and retrieved news.", materiality: 1, read: false, at: Date.now() }).catch(() => {});
    // Re-study the record once 10+ more calls have been graded since the last lessons.
    const LL = MD.ai.latestLessons(app), scored = MD.ai.scoredCalls(app).length;
    if (scored >= 10 && (!LL || scored - (LL.basedOn || 0) >= 10)) { const les = await MD.ai.learn(app).catch(() => null); if (les) await app.store.create("inbox", { kind: "brain", title: "The AI studied its graded calls and updated its lessons", body: (les.summary || "") + " Every forecasting AI is told the new lessons.", materiality: 1, read: false, at: Date.now() }).catch(() => {}); }
    if (!latestCall(app)) { const c = await marketCall(app, {}); await app.store.create("inbox", { kind: "brain", title: "Market call for " + c.target + ": SPY " + (c.upPct >= 50 ? "up " + c.upPct : "down " + (100 - c.upPct)) + "%", body: c.summary + " Graded from the close.", materiality: 1, read: false, at: Date.now() }).catch(() => {}); }
  }

  /* ---------- page ---------- */
  const fmtP = (x) => x == null ? "—" : (x > 0 ? "+" : "") + x.toFixed(2) + "%";
  function heat(rows) {
    return h("div", { class: "heat" }, rows.map(r => { const v = r.changePct; const a = v == null ? 0 : Math.min(1, Math.abs(v) / 2.5); return h("div", { class: "heat-c " + (v == null ? "" : v >= 0 ? "up" : "down"), style: "--a:" + a.toFixed(2), title: r.name + " " + fmtP(v) }, h("b", {}, r.symbol), h("span", { class: "tiny" }, r.name), h("span", { class: "num small" }, fmtP(v))); }));
  }
  function regimeKpis(rg) {
    if (!rg) return h("p", { class: "small muted" }, "Regime appears after the histories load.");
    const k = (label, value, sub) => h("div", { class: "kpi" }, h("span", { class: "label" }, label), h("b", { class: "v" }, value), sub ? h("span", { class: "s" }, sub) : null);
    return h("div", { class: "stack" }, h("p", {}, h("strong", {}, rg.label)),
      h("div", { class: "kpis k4" }, k("S&P 500 trend", rg.trend || "—", rg.spyFromHighPct != null ? rg.spyFromHighPct.toFixed(1) + "% from its 1-year high" : null), k("Volatility", rg.volState, rg.vol20Pct + "% (20-day) vs " + rg.volYearPct + "% (1-year)"), k("Stocks vs long bonds", rg.stockBondCorr60d == null ? "—" : rg.stockBondCorr60d.toFixed(2), "60-day correlation"), k("Small vs large caps", fmtP(rg.smallVsLarge1mPct), "1 month, IWM minus SPY")),
      h("p", { class: "small muted" }, "Leading sectors (1 month): " + rg.leaders.map(l => l.name + " " + fmtP(l.ret1mPct)).join(", ") + ". Lagging: " + rg.laggards.map(l => l.name + " " + fmtP(l.ret1mPct)).join(", ") + ". Cyclicals vs defensives " + fmtP(rg.cyclicalVsDefensive1mPct) + ", credit " + fmtP(rg.credit1mPct) + ", dollar " + fmtP(rg.dollar1mPct) + ", oil " + fmtP(rg.oil1mPct) + ", gold " + fmtP(rg.gold1mPct) + " over a month."));
  }
  function recapView(app, r) {
    if (!r) return h("div", { class: "empty" }, "No session studied yet. Study one to start the playbook.");
    const strengthCls = { major: "negative", moderate: "neutral", minor: "" };
    return h("div", { class: "stack" },
      h("div", { class: "row between", style: "flex-wrap:wrap;gap:8px" }, h("div", { class: "stack", style: "gap:2px" }, h("h2", { style: "font-size:1.15rem" }, r.headline || "Session " + r.sessionDate), h("span", { class: "small muted" }, "Session " + r.sessionDate + (r.phase === "open" ? " (studied while open)" : "") + " · studied " + U.fmtTs(r.createdAt) + " · " + (r.toolCalls || 0) + " research steps, " + (r.sourcesRetrieved || 0) + " sources · confidence " + r.confidence + "/100")), r.regimeAI ? h("span", { class: "verdict sm neutral" }, r.regimeAI.label) : null),
      h("p", {}, r.summary), r.regimeAI && r.regimeAI.note ? h("p", { class: "small muted" }, r.regimeAI.note) : null,
      h("div", { class: "grid g2" }, (r.drivers || []).map(d => h("div", { class: "card driver" }, h("div", { class: "bd stack", style: "gap:6px" },
        h("div", { class: "row between", style: "gap:6px;flex-wrap:wrap" }, h("strong", {}, d.driver), h("span", { class: "row", style: "gap:4px" }, h("span", { class: "chip sm" }, d.category), h("span", { class: "verdict sm " + (strengthCls[d.strength] || "") }, d.strength))),
        h("p", { class: "small" }, d.explanation),
        d.effects.length ? h("div", { class: "row", style: "gap:4px;flex-wrap:wrap" }, d.effects.map(x => h("span", { class: "pill " + (x.direction === "up" ? "ok" : "bad") }, (x.direction === "up" ? "▲ " : "▼ ") + x.on + (x.movePct != null ? " " + fmtP(x.movePct) : "")))) : null,
        d.persistence ? h("span", { class: "tiny muted" }, "Persistence: " + d.persistence) : null, MD.ai.sources(d.sources))))),
      r.movers && r.movers.length ? h("div", {}, h("span", { class: "label" }, "Movers explained"), h("ul", { class: "small", style: "margin:4px 0 0;padding-left:1.1em;display:grid;gap:3px" }, r.movers.map(m => h("li", {}, h("strong", {}, m.symbol + " " + (m.movePct != null ? fmtP(m.movePct) : "") + ": "), m.why, m.source ? h("span", {}, " ", h("a", { href: m.source.url, target: "_blank", rel: "noopener noreferrer" }, "source"), m.source.verified ? null : h("span", { class: "warn-t" }, " (unverified)")) : null)))) : null,
      r.patternChecks && r.patternChecks.length ? h("div", {}, h("span", { class: "label" }, "Playbook tested this session"), h("ul", { class: "small", style: "margin:4px 0 0;padding-left:1.1em;display:grid;gap:3px" }, r.patternChecks.map(c => h("li", {}, h("span", { class: c.verdict === "confirmed" ? "up" : "down" }, c.verdict === "confirmed" ? "Held: " : "Failed: "), "\"" + c.pattern + "\" ", h("span", { class: "muted" }, c.note), c.measured ? h("span", { class: "chip sm" }, "scored from measured moves") : null)))) : null,
      MD.ai.list("Watch next session", r.watchNext));
  }
  function playbookView(app, pb, refreshBtn) {
    const rows = pb.patterns.filter(p => p.status !== "merged").map(p => Object.assign({ st: stats(p) }, p)).sort((a, b) => (a.status === "retired") - (b.status === "retired") || b.st.tested - a.st.tested || b.st.reliability - a.st.reliability);
    return h("div", { class: "stack" },
      pb.narrative ? h("p", {}, pb.narrative) : null,
      pb.themes && pb.themes.length ? h("div", { class: "row", style: "gap:6px;flex-wrap:wrap" }, pb.themes.map(t => h("span", { class: "chip", title: t.note }, t.theme + (t.sessions ? " · " + t.sessions : "") + (t.status ? " · " + t.status : "")))) : null,
      rows.length ? U.table([{ t: "Pattern", v: (p) => h("span", { class: "stack", style: "gap:1px" }, h("span", { class: p.status === "retired" ? "faint" : "" }, p.pattern), h("span", { class: "tiny muted" }, (p.category || "") + " · first seen " + (p.firstSeen || "—") + (p.source === "user" ? " · your idea" : "") + (p.status === "retired" ? " · retired: " + (p.retiredWhy || "") : "") + (p.lastNote ? " · last test: " + p.lastNote : "")), p.rule ? h("span", { class: "tiny num" }, "Rule: " + Q.ruleText(p.rule)) : null) },
        { t: "1-year backtest", v: (p) => !p.backtest ? h("span", { class: "tiny muted" }, p.rule ? "not run" : "no rule") : p.backtest.error ? h("span", { class: "tiny warn-t" }, p.backtest.error) : h("span", { class: "stack", style: "gap:0;justify-items:end" }, h("span", { class: "num" }, p.backtest.held + "/" + p.backtest.occurrences + " (" + (p.backtest.heldPct ?? "—") + "%)"), h("span", { class: "tiny muted", style: "white-space:normal;min-width:12ch" }, "vs " + (p.backtest.baselinePct ?? "—") + "% normally · " + Q.backtestVerdict(p.backtest))), n: true },
        { t: "Tested", v: (p) => String(p.st.tested), n: true }, { t: "Held", v: (p) => String(p.st.confirmed), n: true }, { t: "Failed", v: (p) => String(p.st.contradicted), n: true },
        { t: "Reliability", v: (p) => p.st.tested ? h("span", { class: "row", style: "gap:6px;align-items:center;justify-content:flex-end" }, h("span", { class: "meter", style: "width:60px" }, h("i", { style: "width:" + (p.st.reliability * 100).toFixed(0) + "%" })), h("span", { class: "num" }, (p.st.reliability * 100).toFixed(0) + "%")) : h("span", { class: "tiny muted" }, "hypothesis"), n: true }], rows)
        : h("div", { class: "empty" }, "No patterns yet. Each studied session can add cause → effect patterns; later sessions test them."),
      MD.ai.list("Lessons so far", pb.lessons),
      pb.lastChanges && pb.lastChanges.length ? h("details", { class: "small" }, h("summary", { class: "label", style: "cursor:pointer" }, "Last refinement: " + pb.lastChanges.length + " change" + (pb.lastChanges.length > 1 ? "s" : "")), h("ul", {}, pb.lastChanges.map(c => h("li", {}, c.action + ": \"" + c.from + "\"" + (c.to ? " → \"" + c.to + "\"" : "") + (c.reason ? " (" + c.reason + ")" : ""))))) : null,
      h("div", { class: "row between", style: "flex-wrap:wrap;gap:8px" }, h("p", { class: "tiny muted" }, "Reliability = (times held + 1) ÷ (times tested + 2), so an untested pattern starts at 50%. Patterns that fail most of 4+ tests are retired automatically. Patterns with a same-day rule are scored by the app from the measured moves; the backtest re-runs on fresh data when the playbook is refined." + (pb.refinedAt ? " Last refined " + U.fmtTs(pb.refinedAt) + "." : "")), refreshBtn));
  }

  V.brain = function (root, app) {
    root.append(MD.marketsHelpers.head("Market Brain", "An AI that studies each market session (what moved, by how much, and why) and keeps a scored playbook of cause and effect. What it learns is given to every other AI on the desk: Recommendations, quick takes, Deep Research, Ask AI, the Advisor and day-trading plans."));
    const days = latestPerDay(app), log = MD.ai.logBox(), phase = h("div", { class: "label" });
    let ctl = null;
    const go = h("button", { class: "btn", type: "button" }, days.length ? "Study the latest session" : "Study today's market");
    const stop = h("button", { class: "btn ghost", type: "button", hidden: true, onclick: () => ctl && ctl.abort() }, "Stop");
    const auto = h("input", { type: "checkbox", checked: app.settings.brainAuto !== false, onchange: () => app.saveSettings({ brainAuto: auto.checked }) });
    go.onclick = async () => {
      ctl = new AbortController(); go.disabled = true; stop.hidden = false; log.clear(); phase.textContent = "Working…";
      try { await studySession(app, { signal: ctl.signal, onLog: (e) => log.add(e) }); phase.textContent = app.demo ? "Done (demo mode: not saved)" : "Done · saved to the playbook"; app.emit("data:marketdays"); if (!app.demo) app.rerender(); }
      catch (e) { phase.textContent = e && e.code === "cancelled" ? "Stopped." : MD.ai.errText(e); }
      go.disabled = false; stop.hidden = true; ctl = null;
    };
    const s = Q.session();
    root.append(U.section("Study", h("div", { class: "stack" },
      h("div", { class: "row", style: "gap:8px;flex-wrap:wrap;align-items:center" }, go, stop, h("label", { class: "chk small" }, auto, "Study each session automatically after the close (once you've studied one)")),
      h("p", { class: "small muted" }, "US market: " + ({ open: "open, " + s.minutesToClose + " minutes to the close", pre: "pre-market, opens in " + s.minutesToOpen + " minutes", after: "after-hours", closed: "closed" + (s.minutesToOpen != null ? ", opens in " + Math.floor(s.minutesToOpen / 60) + " h " + (s.minutesToOpen % 60) + " min" : "") }[s.phase]) + ". A study takes 1–3 minutes: the app measures 22 instruments, the movers and the day's calendar; Claude reads the news, explains the session and tests the playbook. Uses your Claude usage plus about 50 data requests through Exa."),
      phase, log)));
    const callBox = h("div", { class: "stack" }), callLog = MD.ai.logBox(), callPhase = h("span", { class: "small muted" }), cur0 = latestCall(app);
    const callBtn = h("button", { class: "btn ghost", type: "button", disabled: !app.caps.sample, onclick: async () => {
      callBtn.disabled = true; callLog.clear(); callPhase.textContent = "Working…";
      try { const c = await marketCall(app, { onLog: (e) => callLog.add(e) }); callPhase.textContent = c.forecastId ? "Logged; graded at the close." : "Done."; callBox.replaceChildren(callCard(app, c)); callBtn.textContent = "Update the call"; }
      catch (e) { callPhase.textContent = MD.ai.errText(e); }
      callBtn.disabled = false;
    } }, cur0 ? "Update the call" : "Make the call for " + Q.targetSession());
    callBox.append(callCard(app, cur0));
    root.append(U.section("Market call: will the S&P 500 close up?", h("div", { class: "stack" }, callBox, h("div", { class: "row", style: "gap:8px;align-items:center;flex-wrap:wrap" }, callBtn, callPhase), h("details", {}, h("summary", { class: "label" }, "Research steps"), callLog), callsRecord(app),
      h("p", { class: "tiny muted" }, "Anchored to SPY's own history of up days in situations like today's, then adjusted for the calendar, pre-market moves, news and backtested patterns, and checked by a second reader. The first call per session is graded from the close; the record is fed back to future calls. Once you've studied a session, the next session's call is made automatically after each close."))));
    const wkBox = h("div", { class: "stack" }), wkLog = MD.ai.logBox(), wkPhase = h("span", { class: "small muted" }), allW = reviews(app);
    const wkPick = allW.length > 1 ? h("select", { "aria-label": "Past weekly reviews", onchange: () => wkBox.replaceChildren(reviewView(app, allW.find(x => x.id === wkPick.value))) }, allW.map(w => h("option", { value: w.id }, "Week of " + w.week))) : null;
    const wkBtn = h("button", { class: "btn ghost", type: "button", disabled: !app.caps.sample, onclick: async () => {
      wkBtn.disabled = true; wkLog.clear(); wkPhase.textContent = "Working…";
      try { const w = await weeklyReview(app, { onLog: (e) => wkLog.add(e) }); wkPhase.textContent = app.demo ? "Done (demo mode: not saved)" : "Saved; its lessons now reach every AI on the desk."; wkBox.replaceChildren(reviewView(app, w)); }
      catch (e) { wkPhase.textContent = MD.ai.errText(e); }
      wkBtn.disabled = false;
    } }, allW.some(w => w.week === weekKey()) ? "Rewrite this week's review" : "Write this week's review");
    wkBox.append(reviewView(app, allW[0]));
    root.append(U.section("Weekly review", h("div", { class: "stack" }, wkBox, h("div", { class: "row", style: "gap:8px;align-items:center;flex-wrap:wrap" }, wkBtn, wkPick, wkPhase), h("details", {}, h("summary", { class: "label", style: "cursor:pointer" }, "Research steps"), wkLog),
      h("p", { class: "tiny muted" }, "Written automatically on the weekend once you've studied a session (with automatic study on). Built from the week's measured moves, the sessions studied and the desk's graded calls; next week's events come from the earnings calendar and the economic-calendar tool."))));
    const pulseBox = h("div", { class: "stack" });
    root.append(U.section("Right now (measured)", pulseBox));
    U.async(pulseBox, () => pulse(app, { history: true }), (P) => {
      const groups = [["Indices", "index"], ["Rates, dollar, commodities, credit", null], ["Sectors", "sector"]];
      pulseBox.replaceChildren(regimeKpis(P.regime),
        P.regime && P.regime.rotation && P.regime.rotation.length ? h("details", { open: true }, h("summary", { class: "label", style: "cursor:pointer" }, "Sector rotation (strength vs the S&P 500)"), h("div", { class: "row", style: "gap:16px;flex-wrap:wrap;align-items:center" }, h("div", { style: "flex:1 1 300px;min-width:0;color:var(--muted)" }, rotationSvg(P.regime.rotation)),
          h("div", { class: "stack small", style: "flex:1 1 220px;gap:4px" }, ["Leading", "Improving", "Weakening", "Lagging"].map(qd => { const xs = P.regime.rotation.filter(r => r.quadrant === qd); return xs.length ? h("p", {}, h("strong", {}, qd + ": "), xs.map(r => r.name + " (" + (r.rs1mPts > 0 ? "+" : "") + r.rs1mPts + ")").join(", ")) : null; }), h("p", { class: "tiny muted" }, "Leading: stronger than the market over 3 months and still over 1 month. Improving: weak over 3 months but stronger lately. Weakening: the reverse. Points are percentage points vs SPY.")))) : null,
        ...groups.map(([label, kind]) => h("div", { class: "stack", style: "gap:4px" }, h("span", { class: "label" }, label), heat(P.rows.filter(r => kind ? r.kind === kind : !["index", "sector"].includes(r.kind)).sort((a, b) => kind === "sector" ? (b.changePct ?? -99) - (a.changePct ?? -99) : 0)))),
        h("details", {}, h("summary", { class: "label", style: "cursor:pointer" }, "What moves what (measured from a year of daily returns)"),
          U.table([{ t: "Sector", v: (r) => r.name + " (" + r.symbol + ")" }, { t: "Beta to S&P 500", v: (r) => r.betaToSPY == null ? "—" : r.betaToSPY.toFixed(2), n: true }, { t: "Corr. long bonds", v: (r) => r.corrLongBonds == null ? "—" : r.corrLongBonds.toFixed(2), n: true }, { t: "Corr. dollar", v: (r) => r.corrDollar == null ? "—" : r.corrDollar.toFixed(2), n: true }, { t: "Corr. oil", v: (r) => r.corrOil == null ? "—" : r.corrOil.toFixed(2), n: true }, { t: "Corr. gold", v: (r) => r.corrGold == null ? "—" : r.corrGold.toFixed(2), n: true }], sensitivities(P)),
          h("p", { class: "tiny muted" }, "Correlations are over the last 60 trading days. A sector with a high correlation to long bonds rallies when yields fall; a negative one benefits when yields rise.")),
        h("p", { class: "tiny muted" }, "Today's moves from Nasdaq quotes (bitcoin from the crypto feed, 24-hour change); 5-day and 1-month figures and the regime from 1-year daily histories. As of " + new Date(P.at).toLocaleTimeString() + "."));
    }, { loading: "Measuring 22 instruments and a year of their history…" });
    const openId = app.ls.get("brainOpen", null), cur = days.find(d => d.id === openId) || days[0] || null;
    const regBox = h("div", { class: "stack" });
    root.append(U.section("Market regimes (machine learning)", regBox));
    U.async(regBox, () => regimesNow(), (R) => regBox.replaceChildren(regimeView(R)), { loading: "Clustering three years of S&P 500 days…" });
    root.append(U.section("Latest study", recapView(app, cur)));
    const pb = playbook(app), pbPhase = h("span", { class: "small muted" });
    const refine = h("button", { class: "btn ghost sm", type: "button", disabled: days.length < 2 || !app.caps.sample, onclick: async () => {
      refine.disabled = true; pbPhase.textContent = "Refining…";
      try { await refinePlaybook(app, {}); pbPhase.textContent = "Refined."; if (!app.demo) app.rerender(); } catch (e) { pbPhase.textContent = MD.ai.errText(e); }
      refine.disabled = false;
    } }, "Refine the playbook");
    root.append(U.section("Playbook: what causes what", h("div", { class: "stack" }, playbookView(app, pb, h("span", { class: "row", style: "gap:8px;align-items:center" }, pbPhase, refine)))));
    root.append(U.section("Hypothesis lab: test an idea against the data", labView(app)));
    if (days.length) root.append(U.section("Sessions studied", U.dataTable([{ t: "Session", v: (d) => d.sessionDate, sort: (d) => d.sessionDate }, { t: "Headline", v: (d) => d.headline }, { t: "Drivers", v: (d) => (d.drivers || []).map(x => x.category).join(", ") }, { t: "Playbook tests", v: (d) => String((d.patternChecks || []).length), n: true }], days, { key: "brain.days", sort: [0, -1], noun: "sessions", filter: false, onRow: (d) => { app.ls.set("brainOpen", d.id); app.rerender(); window.scrollTo(0, 0); } })));
  };

  /* Asset pages: the measured split of today's and the week's move, what the Market Brain recorded about the
     symbol, and (on request) Claude's read of the news behind the part the market doesn't explain. */
  function whyCard(app, a) {
    const out = h("div", { class: "stack" }), ai = h("div", { class: "stack" });
    const sec = U.section("Why it's moving", h("div", { class: "stack" }, out, ai)); sec.id = "sec-why";
    const split = (at, label) => !at ? null : h("div", { class: "stack", style: "gap:4px" }, h("span", { class: "label" }, label + ": " + fmtP(at.movePct) + " · " + fmtP(at.explainedPct) + " explained by the market and its factors, " + fmtP(at.unexplainedPct) + " its own"),
      U.bars(at.parts.map(p => ({ label: (p.factor === "BTC" ? "Bitcoin" : NAME[p.factor] || p.factor) + " (β " + p.beta + ")", value: p.contributionPct, text: fmtP(p.contributionPct) })).concat([{ label: "Asset-specific", value: at.unexplainedPct, text: fmtP(at.unexplainedPct) }]), { signed: true }));
    let last = null;
    const run = () => U.async(out, () => explainMove(app, a), (ex) => {
      last = ex;
      const mem = memory(app, a.symbol), notes = mem.sessions.filter(s => s.movers.length || s.drivers.some(d => (d.effects || []).some(e => e.on === a.symbol || e.on === ex.sectorEtf)));
      const go = h("button", { class: "btn ghost sm", type: "button", disabled: !app.caps.sample, onclick: () => newsRead(go) }, "Find the news behind it");
      out.append(ex.verdict ? h("p", {}, h("strong", {}, ex.verdict), ex.unexplainedZ != null ? h("span", { class: "small muted" }, " (asset-specific part = " + ex.unexplainedZ + "× its typical daily size of " + ex.typicalAssetSpecificDailyPct + "%)") : null) : null,
        split(ex.today, "Today"), split(ex.week, "Last 5 days"),
        h("p", { class: "tiny muted" }, "Factor model fitted on " + ex.model.days + " days of daily returns (R² " + ex.model.r2 + "): " + ex.model.factors.map(f => f.name + " β " + f.beta + (f.relativeToMarket ? " (vs the market)" : "")).join(", ") + ". " + (ex.note || "")),
        notes.length ? h("div", {}, h("span", { class: "label" }, "Market Brain notes"), h("ul", { class: "small", style: "margin:4px 0 0;padding-left:1.1em" }, notes.slice(0, 3).map(s => h("li", {}, s.date + ": " + s.headline + (s.movers[0] ? " · " + s.movers[0].symbol + " " + fmtP(s.movers[0].movePct) + ": " + s.movers[0].why : ""))))) : null,
        h("div", { class: "row", style: "gap:6px;flex-wrap:wrap" }, go, ["stock", "etf", "crypto"].includes(a.cls) ? h("button", { class: "btn ghost sm", type: "button", onclick: () => { app.ctx.daytrade = { asset: a }; app.go("daytrade", app.ctx.daytrade); } }, "Day-trade view") : null));
    }, { loading: "Fitting a factor model on a year of daily returns…" });
    async function newsRead(btn) {
      const s = app.caps.sample; if (!s || !last) return;
      btn.disabled = true; const log = MD.ai.logBox(); ai.replaceChildren(log);
      const S = MD.ai.session((e) => log.add(e));
      try {
        const r = await s.json(`Explain why ${a.symbol} (${a.name || a.symbol}) moved, separating what the market explains from what is specific to it. The app's factor model already measured the split below; find the news for the asset-specific part with 1 to 4 tool calls (${a.cls === "crypto" ? "crypto_news, search_news" : "search_news"}, search_web if needed). If the asset-specific part is small, say the move is mostly the market and don't invent a story. Cite only URLs the tools returned.
Measured: ${JSON.stringify({ today: last.today, last5Days: last.week, verdict: last.verdict, unexplainedZ: last.unexplainedZ, factors: last.model.factors })}
${MD.ai.contextNote(app)}
${MD.ai.assetNote(app, a)}
Reply with ONLY JSON: {"explanation": "3-4 sentences", "catalysts": [{"what": "...", "when": "date or time", "impact": "how it moved the price"}], "marketPart": "one sentence on the market/sector part", "confidence": 0-100, "sources": [{"title": "...", "url": "https://..."}]}`, { modelTier: "complex", cache: false, tools: MD.ai.tools(app, S, a.cls === "crypto" ? ["crypto_news", "search_news", "search_web"] : ["search_news", "search_web", "read_page"]) });
        ai.replaceChildren(h("div", { class: "aicard" }, h("p", {}, r.explanation), r.marketPart ? h("p", { class: "small muted" }, r.marketPart) : null, (r.catalysts || []).length ? h("ul", { class: "small" }, r.catalysts.slice(0, 4).map(c => h("li", {}, h("strong", {}, c.what), c.when ? " (" + c.when + ")" : "", c.impact ? ": " + c.impact : ""))) : null, MD.ai.sources(S.verify(r.sources)), h("p", { class: "tiny muted" }, "Confidence " + (Number(r.confidence) || 0) + "/100 · " + S.calls + " research steps")));
      } catch (e) { ai.replaceChildren(U.errorBox({ message: MD.ai.errText(e) })); }
      btn.disabled = false;
    }
    const start = h("button", { class: "btn ghost sm", type: "button", onclick: () => run() }, "Explain the move");
    out.append(h("p", { class: "small muted" }, "Splits the move into the market, the sector, rates, the dollar and oil (bitcoin and tech for coins) and the part that's the asset's own."), start);
    return sec;
  }

  function labView(app) {
    const box = h("div", { class: "stack" }), out = h("div", { class: "stack" });
    const input = h("textarea", { rows: 2, placeholder: "e.g. When oil jumps more than 2%, airline stocks fall", "aria-label": "Hypothesis" });
    const tf = h("select", { "aria-label": "Look-back" }, h("option", { value: "1Y" }, "1 year"), h("option", { value: "3Y" }, "3 years"));
    const btn = h("button", { class: "btn", type: "button", disabled: !app.caps.sample, onclick: async () => {
      const text = input.value.trim(); if (!text) return;
      btn.disabled = true; out.replaceChildren(h("div", { class: "skeleton" }, "Turning it into a rule and testing it on daily moves…"));
      try {
        const r = await testIdea(app, text, tf.value);
        if (!r.testable) { out.replaceChildren(h("p", { class: "small" }, h("strong", {}, "Not testable with daily moves: "), r.why)); }
        else {
          const b = r.backtest, add = h("button", { class: "btn ghost sm", type: "button", onclick: async () => {
            if (app.demo) { U.toast("Demo mode: not saved"); return; }
            const pb = playbook(app); pb.patterns.push({ id: "p" + Date.now().toString(36), pattern: r.pattern || text, cause: "", effect: "", category: "your idea", firstSeen: Q.session().date, tests: {}, status: "active", rule: r.rule, backtest: b.lookback === "1Y" ? b : await backtest(app, r.rule, "1Y", pulseCache).catch(() => b), source: "user" });
            await app.store.put("brain", PB_ID, Object.assign(pb, { id: PB_ID })); add.disabled = true; add.textContent = "Added"; U.toast("Added to the playbook", "Each session now tests it; every AI on the desk sees its record.");
          } }, "Add to the playbook");
          out.replaceChildren(h("div", { class: "card" }, h("div", { class: "bd stack" },
            h("strong", {}, r.pattern), h("span", { class: "small num" }, "Rule tested: " + Q.ruleText(r.rule)), r.why ? h("span", { class: "small muted" }, r.why) : null,
            b.error ? h("p", { class: "warn-t small" }, b.error) : h("div", { class: "kpis k4" },
              h("div", { class: "kpi" }, h("span", { class: "label" }, "Cause happened"), h("b", { class: "v" }, String(b.occurrences)), h("span", { class: "s" }, "of " + b.days + " days · " + b.from + " to " + b.to)),
              h("div", { class: "kpi" }, h("span", { class: "label" }, "Effect followed"), h("b", { class: "v" }, (b.heldPct ?? "—") + "%"), h("span", { class: "s" }, b.held + " of " + b.occurrences)),
              h("div", { class: "kpi" }, h("span", { class: "label" }, "On any day"), h("b", { class: "v" }, (b.baselinePct ?? "—") + "%"), h("span", { class: "s" }, "how often the effect happens anyway")),
              h("div", { class: "kpi" }, h("span", { class: "label" }, "Verdict"), h("b", { class: "v " + (b.z >= 2 ? "up" : b.z <= -1 ? "down" : "") }, b.liftPts == null ? "—" : (b.liftPts > 0 ? "+" : "") + b.liftPts + " pts"), h("span", { class: "s" }, Q.backtestVerdict(b) + (b.z != null ? " (z " + b.z + ")" : "")))),
            b.recent && b.recent.length ? h("details", { class: "small" }, h("summary", { class: "label", style: "cursor:pointer" }, "Latest cases"), U.table([{ t: "Day", v: "date" }, { t: "Cause", v: (x) => fmtP(x.causePct), n: true }, { t: "Effect", v: (x) => fmtP(x.effectPct), n: true }, { t: "Held", v: (x) => x.held ? "✓" : "✗" }], b.recent.slice().reverse())) : null,
            h("p", { class: "tiny muted" }, "Daily closes from Nasdaq (bitcoin from Kraken). Past patterns can break; a small number of cases or a z-score under 2 is weak evidence."), b.error ? null : add)));
        }
      } catch (e) { out.replaceChildren(U.errorBox({ message: MD.ai.errText(e) })); }
      btn.disabled = false;
    } }, "Test it");
    box.append(h("p", { class: "small muted" }, "Describe a cause and effect in plain words. Claude turns it into a rule over daily moves (ETFs stand in for sectors and themes) and the app checks it against history: how often the effect followed the cause, compared with how often it happens on any day."),
      h("div", { class: "row", style: "gap:8px;align-items:flex-end;flex-wrap:wrap" }, h("div", { style: "flex:1 1 280px;min-width:0" }, input), U.field("Look-back", tf), btn), out);
    return box;
  }

  /* ---------- portfolio macro sensitivity ---------- */
  const SHOCK_FACTORS = [["SPY", "S&P 500"], ["TLT", "Long Treasuries"], ["UUP", "US dollar"], ["USO", "Oil"], ["BTC", "Bitcoin"], ["QQQ", "Nasdaq-100"], ["GLD", "Gold"]];
  const SCENARIOS = [["Stocks fall 10%", { SPY: -10, QQQ: -12 }], ["Long yields jump (long Treasuries −5%)", { TLT: -5 }], ["Dollar rises 3%", { UUP: 3 }], ["Oil jumps 20%", { USO: 20 }], ["Bitcoin falls 30%", { BTC: -30 }],
    ["Risk-off day: stocks −4%, Treasuries +2%, dollar +1%, oil −5%, bitcoin −10%", { SPY: -4, QQQ: -5, TLT: 2, UUP: 1, USO: -5, BTC: -10 }], ["Inflation scare: Treasuries −4%, stocks −3%, oil +8%", { TLT: -4, SPY: -3, QQQ: -4, USO: 8 }]];
  /* Each holding's betas, weighted by its share of the portfolio. Sector funds are entered relative to the market, so a
     shock to the market alone moves a holding by its market beta (its sector is assumed to move with the market). */
  async function exposures(app, m) {
    const items = m.live.filter(it => ["stock", "etf", "crypto"].includes(it.cls) && it.r && it.r.asset);
    const fits = await pool(items, 3, async (it) => ({ it, fit: await fitFactors(app, it.r.asset) }));
    // A holding that is itself one of the shock factors (SPY, TLT, bitcoin…) moves one-for-one with it.
    const selfOf = (sym) => SHOCK_FACTORS.some(([f]) => f === sym) ? sym : null;
    const rows = fits.filter(x => x && !x.error && x.fit).map(({ it, fit }) => ({ symbol: it.symbol, weight: it.weight, betas: fit.model.betas, relative: fit.model.relative, r2: fit.model.r2, residVolPct: fit.model.residVolPct, self: selfOf(it.symbol) }));
    const total = {}; for (const r of rows) { for (const [f, b] of Object.entries(r.betas)) if (!r.relative.includes(f)) total[f] = (total[f] || 0) + r.weight * b; if (r.self) total[r.self] = (total[r.self] || 0) + r.weight; }
    const modelledWeight = rows.reduce((s, r) => s + r.weight, 0);
    // Asset-specific risk left after the factors, assuming holdings' own news is unrelated.
    const idio = Math.sqrt(rows.reduce((s, r) => s + Math.pow(r.weight * r.residVolPct, 2), 0));
    return { rows, total, modelledWeight, idioVolPct: idio, unmodelled: m.items.filter(it => !rows.some(r => r.symbol === it.symbol)).map(it => it.symbol) };
  }
  function scenarioMove(E, shock) { let pct = 0; const parts = []; for (const r of E.rows) { let x = r.self && shock[r.self] != null ? shock[r.self] : 0; for (const [f, b] of Object.entries(r.betas)) if (!r.relative.includes(f) && shock[f] != null) x += b * shock[f]; pct += r.weight * x; parts.push({ symbol: r.symbol, pct: r.weight * x }); } return { pct, parts: parts.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)) }; }
  function exposureSection(app, m) {
    const box = h("div", { class: "stack" });
    U.async(box, () => exposures(app, m), (E) => {
      m.exposure = { factorBetas: Object.fromEntries(Object.entries(E.total).map(([f, b]) => [f, Math.round(b * 100) / 100])), modelledWeightPct: Math.round(E.modelledWeight * 100), assetSpecificVolPct: r1(E.idioVolPct), scenarios: SCENARIOS.map(([n, s]) => ({ scenario: n, estimatedPortfolioMovePct: r1(scenarioMove(E, s).pct) })) };
      if (!E.rows.length) { box.append(h("p", { class: "small muted" }, "No stocks, ETFs or coins with enough history to model.")); return; }
      const money = (pct) => U.money(m.total * pct / 100, m.R, { sign: true });
      const custom = Object.fromEntries(SHOCK_FACTORS.map(([f]) => [f, h("input", { type: "number", step: "0.5", value: 0, "aria-label": "Shock to " + f, style: "max-width:90px" })]));
      const out = h("div", { class: "small" });
      const calc = () => { const s = Object.fromEntries(Object.entries(custom).map(([f, el]) => [f, Number(el.value) || 0])), r = scenarioMove(E, s); out.replaceChildren(h("strong", { class: U.signCls(r.pct) }, "Estimated move: " + pct1(r.pct) + " (" + money(r.pct) + ")"), r.parts[0] && Math.abs(r.parts[0].pct) >= 0.05 ? h("span", { class: "muted" }, " · biggest contributors: " + r.parts.slice(0, 3).filter(p => Math.abs(p.pct) >= 0.05).map(p => p.symbol + " " + pct1(p.pct)).join(", ")) : null); };
      for (const el of Object.values(custom)) el.addEventListener("input", calc);
      box.append(
        h("div", { class: "row", style: "gap:6px;flex-wrap:wrap" }, SHOCK_FACTORS.filter(([f]) => E.total[f] != null).map(([f, n]) => h("span", { class: "pill", style: "text-transform:none", title: "Portfolio-weighted beta: the portfolio's % move for a 1% move in " + n }, n + " β " + E.total[f].toFixed(2)))),
        U.table([{ t: "Scenario", v: (x) => x[0] }, { t: "Estimated move", v: (x) => { const r = scenarioMove(E, x[1]); return h("span", { class: U.signCls(r.pct) }, pct1(r.pct)); }, n: true }, { t: "In " + m.R, v: (x) => money(scenarioMove(E, x[1]).pct), n: true }, { t: "Biggest contributors", v: (x) => scenarioMove(E, x[1]).parts.slice(0, 3).filter(p => Math.abs(p.pct) >= 0.05).map(p => p.symbol + " " + pct1(p.pct)).join(", ") || "—" }], SCENARIOS),
        h("details", {}, h("summary", { class: "label", style: "cursor:pointer" }, "Your own scenario"), h("div", { class: "stack" }, h("div", { class: "form" }, SHOCK_FACTORS.map(([f, n]) => U.field(n + " (%)", custom[f]))), out)),
        h("p", { class: "tiny muted" }, "From each holding's factor model on a year of daily returns (" + Math.round(E.modelledWeight * 100) + "% of the portfolio modelled" + (E.unmodelled.length ? "; counted as unchanged: " + E.unmodelled.join(", ") : "") + "). Asset-specific risk left after these factors: about " + E.idioVolPct.toFixed(1) + "% a year. These are straight-line estimates; in real sell-offs correlations rise and moves are rarely linear."));
      calc();
    }, { loading: "Fitting each holding's sensitivity to the market, rates, the dollar and oil…" });
    return box;
  }
  const pct1 = (x) => x == null ? "—" : Math.abs(x) < 0.05 ? "0.0%" : (x > 0 ? "+" : "") + x.toFixed(1) + "%";

  function dashboardCard(box, app) {
    const days = latestPerDay(app), last = days[0], pb = playbook(app);
    if (!last) { box.append(h("p", { class: "small muted" }, "The Market Brain studies each session and learns what moves what. Study a session to start."), h("button", { class: "btn sm", type: "button", onclick: () => app.go("brain") }, "Open Market Brain")); return; }
    const best = pb.patterns.filter(p => p.status === "active").map(p => Object.assign({ st: stats(p) }, p)).filter(p => p.st.tested >= 2).sort((a, b) => b.st.reliability - a.st.reliability)[0];
    box.append(h("div", { class: "stack", style: "gap:6px" }, h("strong", {}, last.headline), h("span", { class: "tiny muted" }, "Session " + last.sessionDate + " · " + days.length + " studied · " + pb.patterns.filter(p => p.status === "active").length + " active patterns"),
      h("div", { class: "row", style: "gap:4px;flex-wrap:wrap" }, (last.drivers || []).slice(0, 3).map(d => h("span", { class: "chip sm" }, d.driver))),
      best ? h("p", { class: "small" }, "Most reliable pattern: \"" + best.pattern + "\" (held " + best.st.confirmed + " of " + best.st.tested + ")") : null,
      (() => { const c = latestCall(app); return c ? h("p", { class: "small" }, h("strong", {}, "Market call " + c.target + ": "), "SPY " + (c.upPct >= 50 ? "▲ " + c.upPct + "% up" : "▼ " + (100 - c.upPct) + "% down")) : null; })(),
      (() => { const w = reviews(app)[0]; return w && Date.now() - w.at < 10 * 864e5 ? h("p", { class: "small" }, h("strong", {}, "Weekly review: "), w.headline + (w.nextWeek.length ? " Next week: " + w.nextWeek.slice(0, 2).map(x => x.date + " " + x.event).join("; ") + "." : "")) : null; })(),
      h("button", { class: "btn ghost sm", type: "button", onclick: () => app.go("brain") }, "Open Market Brain")));
  }

  MD.brain = { regimesNow, regimeView, weeklyReview, reviews, weekKey, reviewView, fitFactors, exposures, scenarioMove, exposureSection, SCENARIOS, marketCall, latestCall, callsFor, testIdea, backtest, RULE_HELP, labView, whyCard, FACTORS, NAME, sectorEtf, assetOf, pulse, regimeOf, sensitivities, explainMove, playbook, stats, similar, recaps, latestPerDay, lastClosedSession, studySession, refinePlaybook, note, memory, autoStudy, dashboardCard, recapView };
})(typeof window !== "undefined" ? window : globalThis);
