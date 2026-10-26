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
  // Pearson correlation of two equal-length arrays (null with fewer than 20 points or no variance).
  function correlate(a, b) {
    const n = Math.min(a.length, b.length); if (n < 20) return null;
    const ma = a.slice(0, n).reduce((s, x) => s + x, 0) / n, mb = b.slice(0, n).reduce((s, x) => s + x, 0) / n; let c = 0, va = 0, vb = 0;
    for (let i = 0; i < n; i++) { c += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; }
    return va > 0 && vb > 0 ? c / Math.sqrt(va * vb) : null;
  }
  /* What was recommended recently: symbol -> {times, last, lastUpPct}. Cleared picks still count (they were shown). */
  function recentPicks(app, days = 30) {
    const out = new Map(), cut = Date.now() - days * 864e5;
    for (const s of app.store.cached("picks")) if ((s.createdAt || 0) >= cut) for (const p of s.picks || []) {
      const e = out.get(p.symbol) || { times: 0, last: 0, lastUpPct: null };
      e.times++; if ((s.createdAt || 0) > e.last) { e.last = s.createdAt; e.lastUpPct = p.upPct ?? null; } out.set(p.symbol, e);
    }
    return out;
  }
  // A small seeded shuffle, so the exploration slots rotate from day to day but stay stable within a day.
  function seededShuffle(xs, seed) { const a = xs.slice(); let s = seed % 2147483647 || 1; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  const SKIP_COINS = new Set(["USDT", "USDC", "DAI", "FDUSD", "USDE", "TUSD", "PYUSD", "USDS", "BUSD", "USD1", "WBTC", "STETH", "WSTETH", "WETH", "WEETH", "CBBTC", "RETH", "BSC-USD", "BUIDL", "USDTB", "SUSDE", "SUSDS", "LEO", "XAUT", "PAXG", "USDD", "FRAX", "USDF", "USYC", "RLUSD"]);

  async function pool(items, n, fn) { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = { error: e }; } } })); return out; }

  /* ---------- 1. candidate pool + measurements (deterministic) ---------- */
  async function buildCandidates(app, opts, log) {
    const days = WINDOWS[opts.window][1];
    const today = new Date();
    const cands = [];
    // A focus (theme, sector or style) asks Claude which assets fit; the app then verifies and measures each one.
    const focus = { stocks: new Map(), crypto: new Map() };
    const listed = opts.stocks && Array.isArray(opts.symbols) ? [...new Set(opts.symbols.map(s => String(s || "").toUpperCase().trim()).filter(s => /^[A-Z][A-Z.\-]{0,5}$/.test(s)))].slice(0, 12) : [];
    if (listed.length) {
      for (const s of listed) focus.stocks.set(s, "from " + (opts.symbolsLabel || "your list"));
      log("ok", "Focus on " + listed.length + " names from " + (opts.symbolsLabel || "your list") + " (to be verified): " + listed.join(", "));
    } else if (opts.focus && app.caps.sample) {
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
    const recent = recentPicks(app), exch = opts.exchange || "both";
    if (opts.stocks) {
      const exList = exch === "nyse" ? ["nyse"] : exch === "nasdaq" ? ["nasdaq"] : ["nyse", "nasdaq"];
      log("run", "Loading the largest companies on " + exList.map(x => x === "nyse" ? "the NYSE" : "Nasdaq").join(" and ") + " (Nasdaq screener)");
      const lists = await Promise.all(exList.map(x => D.stocks.screener(0, 150, x).catch(() => [])));
      const big = new Map(lists.flat().filter(r => r.price >= 5 && r.marketCap >= 2e9).map(r => [r.symbol, r]));
      if (!big.size) throw new Error("The stock screener didn't answer. Try again in a minute.");
      log("ok", big.size + " liquid companies (" + exList.map((x, i) => lists[i].filter(r => big.has(r.symbol)).length + " " + (x === "nyse" ? "NYSE" : "Nasdaq")).join(", ") + ")");
      // Mid-cap discovery: two sectors a day (rotating with the date), mid-sized companies ($2B–10B) from each exchange,
      // so the pool isn't only the largest names.
      const daySeed0 = Number(D.ymd(today).replace(/-/g, "")) + (opts.window || "").length * 7919;
      const SECTORS = [["technology", "technology"], ["health_care", "health care"], ["finance", "finance"], ["consumer_discretionary", "consumer discretionary"], ["consumer_staples", "consumer staples"], ["industrials", "industrials"], ["energy", "energy"], ["utilities", "utilities"], ["real_estate", "real estate"], ["basic_materials", "basic materials"], ["telecommunications", "telecom"]];
      const todaySectors = seededShuffle(SECTORS, daySeed0 + 17).slice(0, 2);
      const mids = (await Promise.all(todaySectors.flatMap(([sec]) => exList.map(x => D.stocks.screen({ exchange: x, sector: sec, size: "mid", limit: 40 }).then(r => r.rows).catch(() => []))))).flat().filter(r => r.price >= 5 && !big.has(r.symbol));
      for (const r of mids) big.set(r.symbol, Object.assign({}, r, { midCap: true }));
      const midSyms = mids.map(r => r.symbol);
      if (midSyms.length) log("ok", "Mid-cap discovery: " + midSyms.length + " mid-sized companies in " + todaySectors.map(s => s[1]).join(" and ") + " (sectors rotate daily)");
      const horizonDates = []; for (let i = 0; i < Math.min(days, 21); i++) { const d = new Date(today.getTime() + i * 864e5); if (d.getUTCDay() % 6) horizonDates.push(D.ymd(d)); }
      log("run", "Checking the earnings calendar for the next " + horizonDates.length + " trading days");
      const earn = (await Promise.all(horizonDates.map(d => D.calendar.earnings(d).catch(() => [])))).flat();
      const earnBy = new Map(); for (const e of earn) if (big.has(e.symbol) && !earnBy.has(e.symbol)) earnBy.set(e.symbol, e);
      log("ok", earnBy.size + " of them report earnings in the window");
      let movers = { gainers: { rows: [] }, losers: { rows: [] } };
      try { movers = await D.stocks.movers(); } catch {}
      const moverSyms = [...movers.gainers.rows, ...movers.losers.rows].filter(r => big.has(r.symbol)).map(r => r.symbol);
      const byAbs = [...big.values()].sort((a, b) => Math.abs(b.changePct || 0) - Math.abs(a.changePct || 0)).slice(0, 10).map(r => r.symbol);
      const mine = opts.mine ? myAssets(app).filter(a => a.cls !== "crypto").slice(0, 6) : [], mineCls = new Map(mine.map(a => [a.symbol, a]));
      const foc = [...focus.stocks.keys()].filter(s => !mineCls.has(s));
      // Several lenses, fresh names first: earnings in the window, today's movers, the biggest moves, and a rotating
      // sample of names not recommended in the last 30 days. Recently recommended names stay eligible but go last.
      const fresh = (s) => !recent.has(s), exOf = (s) => (big.get(s) || {}).exchange;
      const daySeed = Number(D.ymd(today).replace(/-/g, "")) + (opts.window || "").length * 7919;
      const explore = seededShuffle([...big.keys()].filter(fresh), daySeed);
      // Alternate exchanges inside each lens so neither dominates when both are chosen.
      const mix = (syms) => { if (exList.length < 2) return syms; const a = syms.filter(s => exOf(s) === "NYSE"), b = syms.filter(s => exOf(s) !== "NYSE"), out = []; for (let i = 0; i < Math.max(a.length, b.length); i++) { if (a[i]) out.push(a[i]); if (b[i]) out.push(b[i]); } return out; };
      const lens = (syms, n) => mix(syms.filter(fresh)).slice(0, n);
      const n = focused ? 6 : 18;
      const freshPool = [...new Set(lens([...earnBy.keys()], 6).concat(lens(moverSyms, 3), lens(byAbs, 4), lens(seededShuffle(midSyms, daySeed + 3), 4), mix(explore.filter(s => !(big.get(s) || {}).midCap)).slice(0, 8)))];
      const repeats = [...new Set([...earnBy.keys(), ...moverSyms, ...byAbs].filter(s => !fresh(s)))].slice(0, 3);
      const short = [...new Set(mine.map(a => a.symbol).concat(foc, freshPool.slice(0, n - repeats.length), repeats))].slice(0, n + mine.length + foc.length);
      log("ok", "Shortlist: " + short.filter(fresh).length + " fresh names, " + short.filter(s => !fresh(s)).length + " recommended in the last 30 days" + (exList.length > 1 ? " · " + short.filter(s => exOf(s) === "NYSE").length + " NYSE, " + short.filter(s => exOf(s) === "Nasdaq").length + " Nasdaq" : ""));
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
        return { midCap: !!base.midCap, exchange: base.exchange || null, recent: recent.get(sym) || null, asset: a, mine: !!own, price: base.price, marketCap: base.marketCap, dayChangePct: base.changePct, volPct: st ? st.volPct : null, expectedMovePct: st ? C.expectedMoveFromVol(st.volPct, days) : null,
          impliedMovePct: target ? target.movePct : null, impliedExpiry: target ? target.expiry : null, impliedDays: target ? target.days : null, nearImplied: near && near !== target ? { expiry: near.expiry, movePct: near.movePct } : null, optionsAsOf: om ? om.asOf : null,
          earnings: e ? { date: e.date, time: e.time, epsForecast: e.epsForecast } : null, shortDaysToCover: si ? si.daysToCover : null, shortDate: si ? si.date : null,
          rsi14: closes.length > 15 ? C.rsi(closes, 14) : null, ret1m: ret(21), ret3m: ret(63), fromHighPct: st ? (closes[closes.length - 1] / st.high - 1) * 100 : null, fromLowPct: st ? (closes[closes.length - 1] / st.low - 1) * 100 : null, source: "Nasdaq" };
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
      const freshCoins = scored.filter(c => !recent.has(c.symbol)), rot = seededShuffle(freshCoins.slice(7), Number(D.ymd(today).replace(/-/g, ""))).slice(0, 2);
      const pick = [...new Set(focCoins.concat(scored.filter(c => myCoins.has(c.cgId)).slice(0, 3), freshCoins.slice(0, focused ? 3 : 6), rot, scored.filter(c => recent.has(c.symbol)).slice(0, 2)))];
      log("run", "Measuring " + pick.length + " coins: volatility and momentum");
      const measured = await pool(pick, 4, async (c) => {
        const a = { id: c.id, cls: "crypto", cgId: c.cgId, symbol: c.symbol, name: c.name };
        const hist = await D.historyFor(a, "1Y").catch(() => null);
        const st = hist ? C.seriesStats(hist.points, 365) : null;
        return { recent: recent.get(a.symbol) || null, asset: a, mine: myCoins.has(c.cgId), price: c.price, marketCap: c.marketCap, dayChangePct: c.changePct, volPct: st ? st.volPct : null, expectedMovePct: st ? C.expectedMoveFromVol(st.volPct, days) : null, impliedMovePct: null, earnings: null, shortDaysToCover: null,
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
    // The angles each candidate came in on (shown on the pick and given to Claude).
    for (const c of cands) {
      const L = [];
      if (c.earnings) L.push("Earnings in the window");
      if (Math.abs(c.dayChangePct || 0) >= 4) L.push("Big move today");
      if (c.rsi14 != null && c.rsi14 < 32) L.push("Oversold (RSI " + Math.round(c.rsi14) + ")"); else if (c.rsi14 != null && c.rsi14 > 70) L.push("Overbought (RSI " + Math.round(c.rsi14) + ")");
      if (c.fromHighPct != null && c.fromHighPct > -3) L.push("Near its 52-week high"); else if (c.fromLowPct != null && c.fromLowPct < 5) L.push("Near its 52-week low");
      if (c.shortDaysToCover > 5) L.push("Heavy short interest");
      if (c.midCap) L.push("Mid-cap discovery");
      if (!c.recent) L.push("Fresh name");
      c.lenses = L;
    }
    // Names recommended in the last 30 days rank lower (more so each time), so fresh names get the slots.
    for (const c of cands) if (c.recent) c.score *= Math.pow(0.6, Math.min(3, c.recent.times));
    // Your own names stay in the pool even when their movement score is lower.
    const ranked = cands.sort((a, b) => b.score - a.score), own = ranked.filter(c => c.mine), fit = ranked.filter(c => c.focus);
    return [...new Set(fit.concat(ranked.slice(0, fit.length >= 3 ? 8 : 18), own))];
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
    // Cross-stock model over the stock candidates: the chance each beats the S&P 500 over the window, validated by date.
    let pooledRes = null;
    const stockC = cands.filter(c => c.asset.cls === "stock" || c.asset.cls === "etf");
    if (stockC.length >= 4) {
      log("run", "Training the cross-stock model on " + stockC.length + " candidates' histories (beat the S&P 500 over the window?)");
      try {
        const [mkt, ...hs] = await Promise.all([D.dailyLong({ id: "etf:SPY", cls: "etf", symbol: "SPY", name: "SPY" }), ...stockC.map(c => D.dailyLong(c.asset).catch(() => null))]);
        const R = MD.ml.pooled(stockC.map((c, i) => ({ key: c.asset.symbol, points: hs[i] ? hs[i].points : [] })), mkt.points, { horizonBars: MD.quant.barsFor(days, 252) });
        if (R.error) log("fail", R.error);
        else {
          pooledRes = R;
          for (const t of R.today) { const c = stockC.find(x => x.asset.symbol === t.key); if (c) c.pooled = { beatMarketPct: +t.beatPct.toFixed(1), rank: t.rank, of: t.of, edge: R.edge }; }
          log("ok", "Cross-stock model: " + (R.edge ? "clear out-of-sample edge" : "no clear out-of-sample edge") + " (Brier skill " + (R.oos.brierSkill * 100).toFixed(1) + "%, t " + R.oos.tStat.toFixed(1) + "; top third beat bottom third by " + (R.oos.topVsBottomPct != null ? R.oos.topVsBottomPct.toFixed(2) + "%" : "—") + " a period)");
        }
      } catch (e) { log("fail", "Cross-stock model unavailable: " + U.errorText(e)); }
    }
    const S = MD.ai.session(onStep || ((e) => log(e.kind, e.text)));
    for (const c of cands) if (c.zacksUrl) S.add(c.zacksUrl, "Zacks " + c.asset.symbol, "data");
    const tools = lim && lim.tools ? MD.ai.tools(app, S, ["search_news", "crypto_news", "search_web", "stock_snapshot", "zacks_view", "options_move", "smart_money", "earnings_info", "insider_activity", "market_memory", "explain_move", "ml_forecast", "base_rates", "open_calls"]) : undefined;
    const table = cands.map(c => ({ symbol: c.asset.symbol, name: c.asset.name, class: c.asset.cls, price: +Number(c.price).toPrecision(6), marketCapB: c.marketCap ? +(c.marketCap / 1e9).toFixed(1) : null, todayPct: c.dayChangePct != null ? +Number(c.dayChangePct).toFixed(2) : null,
      optionsImpliedMovePct: c.impliedMovePct != null ? +c.impliedMovePct.toFixed(1) : null, optionsExpiry: c.impliedExpiry, optionsDays: c.impliedDays, nearestExpiryMove: c.nearImplied, volatilityImplied1SigmaMovePct: c.expectedMovePct != null ? +c.expectedMovePct.toFixed(1) : null, annualVolPct: c.volPct != null ? +c.volPct.toFixed(1) : null,
      earnings: c.earnings, shortInterestDaysToCover: c.shortDaysToCover != null ? +c.shortDaysToCover.toFixed(1) : null, return1mPct: c.ret1m != null ? +Number(c.ret1m).toFixed(1) : null, return3mPct: c.ret3m != null ? +c.ret3m.toFixed(1) : null, return7dPct: c.ret7d != null ? +Number(c.ret7d).toFixed(1) : null, fromYearHighPct: c.fromHighPct != null ? +c.fromHighPct.toFixed(1) : null,
      zacksRank: c.zacksRank ?? null, zacksTarget: c.zacksTarget ?? null, smartMoney: c.smartMoney.length ? c.smartMoney : null, insiders: c.insiders || null, movementScore: +c.score.toFixed(1),
      baseRates: c.baseRates ? { modelUpPct: c.baseRates.modelUpPct, overallUpPct: c.baseRates.overallUpPct, independentSamples: c.baseRates.independent, typicalIfUpPct: c.baseRates.typicalIfUpPct, typicalIfDownPct: c.baseRates.typicalIfDownPct, conditions: c.baseRates.conditions } : null,
      last5DaysExplained: c.moveExplained ? c.moveExplained.last5Days : null, onYourWatchlistOrHeld: !!c.mine, fitsFocus: c.focus || null, crossStockModel: c.pooled ? { chanceToBeatSP500Pct: c.pooled.beatMarketPct, rankAmongStockCandidates: c.pooled.rank + " of " + c.pooled.of, edgeOutOfSample: c.pooled.edge } : null, exchange: c.exchange || null, sector: c.moveExplained && c.moveExplained.sectorEtf || null, angles: c.lenses || [],
      recentlyRecommended: c.recent ? { times: c.recent.times, lastOn: new Date(c.recent.last).toISOString().slice(0, 10), lastUpProbabilityPct: c.recent.lastUpPct } : null, mlModel: c.ml ? { horizonDays: c.ml.horizonDays, upPct: c.ml.upPct, edgeOutOfSample: c.ml.edgeOutOfSample, brierSkillPct: c.ml.outOfSample.brierSkillPct, auc: c.ml.outOfSample.auc, topDrivers: c.ml.topDrivers } : null,
      deskPastAiCalls: (() => { const mm = MD.ai.assetMemory(app, c.asset); return mm.calls.length ? mm.calls.length + " logged, " + mm.graded + " graded, " + mm.right + " right; latest " + mm.calls.slice(0, 2).map(x => (x.direction || "") + " " + (x.probabilityPct || "") + "% → " + (x.result ? (x.result.hit ? "right" : "wrong") : "pending")).join(", ") : null; })() }));
    const calib = MD.ai.calibrationNote(MD.ai.trackRecord(app, "ai-picks"));
    log("run", "Asking Claude to choose and explain (usually 1–3 minutes)");
    const prompt = `Today is ${new Date().toISOString().slice(0, 10)}. You are picking assets that could make a LARGE price move within the window "${wLabel}" (about ${days} days), for an investor who wants to watch them closely, and giving the odds of each one going UP or DOWN.
Use ONLY the measured candidates below (measured by the app from exchange, options, Zacks, disclosure and 5-year price data). ${tools ? "Investigate the strongest candidates with 4 to 12 tool calls before deciding: search_news (Bigdata.com) for stocks, crypto_news for coins, earnings_info when a report falls in the window, explain_move or stock_snapshot for the price picture, options_move, zacks_view or insider_activity where they would change your view, market_memory for what has been driving this market, search_web if a news tool fails. Cite only URLs returned by the tools." : "Web search is unavailable; say so in each pick's risks."}
Pick the ${opts.count} with the best case for a large move${opts.mine ? " (candidates marked onYourWatchlistOrHeld belong to the investor; include them when the evidence supports it)" : ""}. For EVERY pick give upProbabilityPct: the chance its price is HIGHER at the end of its window than now. Never answer "either way": a near coin-flip is still a number like 52 or 47. Start from the measured base rate (baseRates.modelUpPct, the asset's own history in situations like today's) and move away from it only for evidence history can't know: a dated catalyst, news, estimate revisions, the market regime. Give the typical size of the move if it rises and if it falls. Anchor the expected move size to the options-implied move when present (the market's own estimate) and to the volatility-implied move otherwise; if you expect more than the market prices, say why. Anchor the time window to a dated catalyst (earnings date, options expiry) when there is one. Give the strongest case on each side and what would change your mind. Do not invent prices, dates or figures.
${opts.focus ? `The investor asked to focus on: "${opts.focus.replace(/"/g, "'")}". Candidates with fitsFocus were named for it; choose from them first, and include others only when fewer than ${opts.count} focus candidates have a real case (say so in the summary).\n` : ""}mlModel is a machine-learning model (logistic regression, boosted trees and similar past setups) trained on each candidate's history and tested out of sample; crossStockModel is one model trained across all the stock candidates for the chance each beats the S&P 500 over the window, with its rank. Give either weight only when its edgeOutOfSample is true.
If your upProbabilityPct differs from the measured history (baseRates.modelUpPct) by more than 20 points, give conflictJustification: the specific evidence history can't know (otherwise the desk halves the gap). For every pick give preMortem: the single most likely way the call fails.
Variety matters to this investor. Prefer fresh names. Candidates with recentlyRecommended were already recommended in the last 30 days (deskPastAiCalls shows how those calls are doing): pick one again only if you genuinely believe it is still among the very best fits, and then give repeatReason (what is new, or why it still stands out). At most ${Math.max(1, Math.floor(opts.count / 3))} repeat${Math.floor(opts.count / 3) > 1 ? "s" : ""}. No more than 2 picks from one sector (the sector fund is given)${opts.exchange && opts.exchange !== "both" ? "" : "; mix NYSE and Nasdaq listings when the evidence is comparable"}. Also give 2 alternates (fresh names, same fields) in case a pick has to be replaced.
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
   "sources": [{"title": "...", "url": "https://..."}], "repeatReason": "only for a recently recommended name: why it is picked again", "preMortem": "the most likely way this call fails", "conflictJustification": "only when you are 20+ points from the measured history: the evidence"}],
 "alternates": [same fields as picks, 2 fresh names],
 "excluded": [{"symbol": "...", "reason": "short reason a high-scoring candidate was left out"}]}`;
    const r = await s.json(prompt, Object.assign({ modelTier: "complex", signal }, tools ? { tools } : { cache: false }));
    const bySym = new Map(cands.map(c => [c.asset.symbol, c]));
    // Variety rules, enforced by the app: a recently recommended name needs a reason and repeats are capped; at most
    // two picks per sector; alternates fill the gaps. What was set aside is listed with the reason.
    const ruled = [], setAside = [], maxRepeats = Math.max(1, Math.floor(opts.count / 3)), perSector = {};
    // Alternates only replace picks that were set aside: the set is never larger than what Claude chose.
    const target = Math.min(opts.count, (Array.isArray(r.picks) ? r.picks : []).filter(p => p && bySym.has(p.symbol)).length);
    for (const p of (Array.isArray(r.picks) ? r.picks : []).concat(Array.isArray(r.alternates) ? r.alternates.map(x => Object.assign({ alternate: true }, x)) : [])) {
      if (!p || !bySym.has(p.symbol) || ruled.some(x => x.symbol === p.symbol) || ruled.length >= target) continue;
      const c = bySym.get(p.symbol), sec = c.moveExplained && c.moveExplained.sectorEtf;
      if (c.recent && !c.mine && !c.focus) {
        if (!String(p.repeatReason || "").trim()) { setAside.push({ symbol: p.symbol, reason: "Recommended " + c.recent.times + "× in the last 30 days and no new reason was given" }); continue; }
        if (ruled.filter(x => bySym.get(x.symbol).recent).length >= maxRepeats) { setAside.push({ symbol: p.symbol, reason: "Repeat limit reached (" + maxRepeats + " per set)" }); continue; }
      }
      if (sec && (perSector[sec] || 0) >= 2) { setAside.push({ symbol: p.symbol, reason: "Third pick in the same sector (" + sec + ")" }); continue; }
      if (sec) perSector[sec] = (perSector[sec] || 0) + 1;
      ruled.push(p);
    }
    if (setAside.length) log("ok", "Variety rules set aside " + setAside.length + ": " + setAside.map(x => x.symbol).join(", ") + (ruled.some(x => x.alternate) ? "; alternates used: " + ruled.filter(x => x.alternate).map(x => x.symbol).join(", ") : ""));
    let picks = ruled.map(p => {
      const c = bySym.get(p.symbol);
      const lo = Math.max(0, Number(p.expectedMovePct && p.expectedMovePct.low) || 0), hi = Math.max(lo, Number(p.expectedMovePct && p.expectedMovePct.high) || lo);
      const modelUp = c.baseRates ? (c.ml && c.ml.edgeOutOfSample ? Math.round((c.baseRates.modelUpPct + c.ml.upPct) / 2 * 10) / 10 : c.baseRates.modelUpPct) : null, claudeRaw = Number(p.upProbabilityPct);
      let claudeUp = isFinite(claudeRaw) && claudeRaw > 0 ? Math.max(5, Math.min(95, claudeRaw)) : (modelUp ?? 50), conflict = null;
      // Conflict check: more than 20 points from the measured evidence needs specific evidence, or the gap is halved.
      if (modelUp != null && Math.abs(claudeUp - modelUp) > 20) { const why = String(p.conflictJustification || "").trim(); conflict = { fromPct: Math.round(claudeUp), measuredPct: Math.round(modelUp), justification: why }; if (!why) claudeUp = modelUp + (claudeUp - modelUp) / 2; conflict.toPct = Math.round(claudeUp); }
      // Claude's judgement blended with the measured history; the review below can pull it toward 50%.
      const bw = MD.ai.blendFor(app, "ai-picks"), up = modelUp != null ? bw.wClaude * claudeUp + (1 - bw.wClaude) * modelUp : claudeUp;
      return { pooled: c.pooled || null, conflict, preMortem: String(p.preMortem || ""), exchange: c.exchange || null, sector: c.moveExplained && c.moveExplained.sectorEtf || null, repeat: c.recent ? { times: c.recent.times, last: c.recent.last, reason: String(p.repeatReason || "") } : null, alternate: !!p.alternate, lenses: c.lenses || [], symbol: p.symbol, asset: c.asset, upPct: up, probs: { claude: Math.round(claudeUp), model: modelUp, ml: c.ml ? c.ml.upPct : null, mlEdge: c.ml ? c.ml.edgeOutOfSample : null, blended: Math.round(up), weightClaude: Math.round(bw.wClaude * 100), learnedWeights: bw.learned }, ifUpPct: Math.max(0, Number(p.ifUpPct) || hi || lo), ifDownPct: Math.max(0, Number(p.ifDownPct) || hi || lo), moveLow: lo, moveHigh: hi, mine: !!c.mine, focus: c.focus || null, baseRates: c.baseRates || null, moveExplained: c.moveExplained || null,
        timeframeDays: Math.max(1, Math.min(400, Math.round(Number(p.timeframe && p.timeframe.days) || days))), timeframeLabel: (p.timeframe && p.timeframe.label) || wLabel, anchor: (p.timeframe && p.timeframe.anchor) || "trend",
        why: Array.isArray(p.why) ? p.why.slice(0, 6).map(String) : [], catalyst: p.catalyst || null, invalidation: p.invalidation || "", risks: p.risks || "", confidence: Math.max(0, Math.min(100, Number(p.confidence) || 0)),
        bullCase: String(p.bullCase || ""), bearCase: String(p.bearCase || ""), changeMyMind: String(p.changeMyMind || ""),
        sources: S.verify(p.sources),
        measured: { price: c.price, impliedMovePct: c.impliedMovePct, impliedExpiry: c.impliedExpiry, optionsAsOf: c.optionsAsOf, expectedMovePct: c.expectedMovePct, volPct: c.volPct, earnings: c.earnings, shortDaysToCover: c.shortDaysToCover, ret1m: c.ret1m, ret3m: c.ret3m, fromHighPct: c.fromHighPct, score: c.score, zacksRank: c.zacksRank ?? null, smartMoney: c.smartMoney } };
    });
    if (!picks.length) throw Object.assign(new Error("Claude didn't return usable picks. Try again."), { code: "invalid_json" });
    // Specialist panel: three more analysts estimate each pick independently; the team's number (lead + panel, equal
    // weight) replaces the lead's, and wide disagreement lowers confidence.
    const PN = await MD.ai.panel(app, { task: "For each item, estimate the chance its price is HIGHER at the end of its window (horizonDays from now) than it is now.", items: picks.map(p => ({ id: p.symbol, name: p.asset.name, horizonDays: p.timeframeDays })), facts: table.filter(t => picks.some(p => p.symbol === t.symbol)), S, signal }).catch(e => { if (e && e.code === "cancelled") throw e; return null; });
    const PW = MD.ai.panelWeights(app).weights;
    for (const p of picks) {
      const P = PN && PN[p.symbol]; if (!P) continue;
      const T = MD.ai.teamUp(p.probs.claude, P, PW), bw2 = MD.ai.blendFor(app, "ai-picks");
      p.probs.lead = p.probs.claude; p.probs.panel = Object.assign({ spread: Math.round(T.spread) }, P.by); p.panelEvidence = P.evidence; p.panelRisks = P.risks;
      p.probs.claude = Math.round(T.upPct); p.upPct = p.probs.model != null ? bw2.wClaude * T.upPct + (1 - bw2.wClaude) * p.probs.model : T.upPct; p.probs.blended = Math.round(p.upPct);
      p.confidence = Math.max(0, p.confidence - MD.ai.disagreementPenalty(T.spread));
    }
    // Second reader: checks each pick against the measured table and the sources retrieved.
    const rv = await MD.ai.review(app, { task: "Which assets could make a large move in " + wLabel + ", which way, and why", S, signal,
      items: picks.map(p => ({ id: p.symbol, preMortem: p.preMortem || null, specialistPanel: p.probs.panel || null, upProbabilityPct: Math.round(p.upPct), measuredHistoryUpPct: p.probs.model, ifUpPct: p.ifUpPct, ifDownPct: p.ifDownPct, expectedMovePct: [p.moveLow, p.moveHigh], timeframe: p.timeframeLabel, why: p.why, catalyst: p.catalyst, bullCase: p.bullCase, bearCase: p.bearCase, confidence: p.confidence, sources: p.sources.map(x => x.url) })),
      facts: table.filter(t => picks.some(p => p.symbol === t.symbol)) });
    const dropped = [], STK = MD.ai.stackFor(app, "ai-picks");
    for (const p of picks) {
      const c = bySym.get(p.symbol), rev = rv && rv.reviews.find(x => x.id === p.symbol);
      if (rev) {
        p.review = rev;
        // Two readers: the reviewer's own independent estimate is averaged in; without one, lower confidence pulls toward 50%.
        if (rev.probabilityPct != null) { p.probs.reviewer = Math.round(rev.probabilityPct); p.upPct = (p.upPct + rev.probabilityPct) / 2; }
        else if (rev.adjustedConfidence != null && rev.adjustedConfidence < p.confidence) { const k = p.confidence ? rev.adjustedConfidence / p.confidence : 1; p.upPct = 50 + (p.upPct - 50) * k; }
      }
      p.probs.afterReview = Math.round(p.upPct);
      // The learned combiner replaces the fixed pipeline once it has beaten it on the graded record; otherwise calibrate.
      if (STK.used) { p.upPct = STK.apply({ c: p.probs.claude, m: p.probs.model, r: p.probs.reviewer ?? null, ml: p.probs.ml ?? null }); p.probs.stacked = Math.round(p.upPct); p.stackedN = STK.n; }
      else { const cal = MD.ai.calibrateUp(app, "ai-picks", p.upPct); if (cal.applied) { p.calibration = cal; p.upPct = cal.upPct; } }
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
    return { crossStock: pooledRes ? { edge: pooledRes.edge, names: pooledRes.names, brierSkillPct: +(pooledRes.oos.brierSkill * 100).toFixed(1), tStat: +pooledRes.oos.tStat.toFixed(2), topVsBottomPct: pooledRes.oos.topVsBottomPct != null ? +pooledRes.oos.topVsBottomPct.toFixed(2) : null, periods: pooledRes.oos.periods } : null, focus: opts.focus || (opts.symbolsLabel ? "names from " + opts.symbolsLabel : null), window: opts.window, windowLabel: wLabel, scope: { stocks: !!opts.stocks, crypto: !!opts.crypto }, summary: r.summary || "", picks, excluded: setAside.concat(Array.isArray(r.excluded) ? r.excluded.slice(0, 8) : []).concat(dropped.map(p => ({ symbol: p.symbol, reason: "Dropped by the review: " + (p.review.note || p.review.issues.join("; ")) }))),
      review: rv ? { overall: rv.overall, kept: rv.reviews.filter(x => x.verdict === "keep").length, revised: rv.reviews.filter(x => x.verdict === "revise").length, dropped: dropped.length } : null,
      candidates: cands.length, sourcesRetrieved: S.sources.length, toolCalls: S.calls, demo: !!app.demo };
  }

  async function journal(app, set) {
    for (const p of set.picks) {
      if (!(p.priceAtPick > 0)) continue;
      const mid = (p.moveLow + p.moveHigh) / 2;
      const f = { assetId: p.asset.id, asset: p.asset, symbol: p.symbol, source: "ai-picks", pickSetId: set.id, horizonDays: p.timeframeDays, dueAt: Date.now() + p.timeframeDays * 864e5, priceAtCreation: p.priceAtPick, currency: p.currency, priceSource: p.priceSource, thesis: p.why.join(" "), flatBandPct: 1 };
      if (p.lean === "either") Object.assign(f, { direction: "move", movePct: +p.moveLow.toFixed(1), probability: 0.5 + p.confidence / 400 });
      else { const size = p.upPct != null ? (p.lean === "up" ? p.ifUpPct : p.ifDownPct) || mid : mid; Object.assign(f, { direction: p.lean, probability: p.leanProbabilityPct / 100, upProbability: p.upPct != null ? p.upPct / 100 : null, claudeUpPct: p.probs ? p.probs.claude : null, modelUpPct: p.probs ? p.probs.model : null, reviewerUpPct: p.probs && p.probs.reviewer != null ? p.probs.reviewer : null, leadUpPct: p.probs && p.probs.panel && p.probs.lead != null ? p.probs.lead : null, panelUpPct: p.probs && p.probs.panel ? { fundamentals: p.probs.panel.fundamentals ?? null, quant: p.probs.panel.quant ?? null, news: p.probs.panel.news ?? null } : null, mlUpPct: p.probs && p.probs.ml != null ? p.probs.ml : null, target: +(p.priceAtPick * (1 + (p.lean === "up" ? 1 : -1) * size / 100)).toPrecision(6) }); }
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
    f.exchange = h("select", { "aria-label": "Exchange" }, [["both", "NYSE + Nasdaq"], ["nyse", "NYSE only"], ["nasdaq", "Nasdaq only"]].map(([v, l]) => h("option", { value: v, selected: v === app.ls.get("pk.exchange", "both") }, l)));
    f.focus = h("input", { type: "text", maxlength: 120, placeholder: "a theme, sector or style, e.g. AI chips, nuclear power, oversold large caps, layer-2 coins", style: "width:100%", value: app.ls.get("pk.focus", ""), "aria-label": "Focus" });
    const log = MD.ai.logBox(), phase = h("div", { class: "label" });
    let ctl = null, listFocus = app.ctx.picks && Array.isArray(app.ctx.picks.symbols) && app.ctx.picks.symbols.length ? app.ctx.picks : null;
    const listChip = h("div", { class: "row", style: "gap:8px;flex-wrap:wrap;align-items:center", hidden: !listFocus });
    const paintChip = () => { listChip.hidden = !listFocus; if (listFocus) listChip.replaceChildren(h("span", { class: "pill ok" }, "Focus list"), h("span", { class: "small" }, listFocus.symbols.length + " names from " + listFocus.label + ": " + listFocus.symbols.join(", ")), h("button", { class: "btn ghost sm", type: "button", onclick: () => { listFocus = null; app.ctx.picks = null; paintChip(); } }, "Clear list")); };
    paintChip();
    const go = h("button", { class: "btn", type: "button" }, sets.length ? "Generate a fresh set" : "Generate recommendations");
    const stop = h("button", { class: "btn ghost", type: "button", hidden: true, onclick: () => ctl && ctl.abort() }, "Stop");
    go.onclick = async () => {
      if (!f.stocks.checked && !f.crypto.checked) { U.toast("Pick stocks, crypto or both", null, true); return; }
      app.ls.set("pk.stocks", f.stocks.checked); app.ls.set("pk.crypto", f.crypto.checked); app.ls.set("pk.mine", f.mine.checked); app.ls.set("pk.window", f.window.value); app.ls.set("pk.count", f.count.value); app.ls.set("pk.focus", f.focus.value.trim()); app.ls.set("pk.exchange", f.exchange.value);
      ctl = new AbortController(); go.disabled = true; stop.hidden = false; log.clear(); phase.textContent = "Working…";
      const L = (kind, text) => log.add({ at: Date.now(), kind, text });
      try {
        const set = await generate(app, { stocks: f.stocks.checked, crypto: f.crypto.checked, mine: f.mine.checked, window: f.window.value, count: Number(f.count.value), focus: listFocus ? null : f.focus.value.trim().slice(0, 120) || null, symbols: listFocus ? listFocus.symbols : null, symbolsLabel: listFocus ? listFocus.label : null, exchange: f.exchange.value, signal: ctl.signal }, L, ctl.signal, (e) => log.add(e));
        if (app.demo) { phase.textContent = "Done (demo mode: not saved)"; body.replaceChildren(setView(app, Object.assign({ id: "unsaved", createdAt: Date.now() }, set))); }
        else { const saved = await app.store.create("picks", set); await journal(app, saved); if (MD.paper) MD.paper.followSet(app, saved).then(o => { if (o.length) U.toast("Paper account followed " + o.length + " pick" + (o.length > 1 ? "s" : ""), "Virtual money; sold automatically when each window ends."); }).catch(() => {}); app.ls.set("picksOpen", saved.id); phase.textContent = "Done · saved and logged in your forecast journal"; app.rerender(); }
      } catch (e) { phase.textContent = e && e.code === "cancelled" ? "Stopped." : ""; if (!(e && e.code === "cancelled")) L("fail", ({ no_sample: "Claude isn't available in this view.", not_granted: "Claude access was declined for this page.", rate_limited: "Usage limit reached; try again later.", invalid_json: "The answer came back unreadable; try again." })[e && e.code] || (e && e.message) || "Failed."); }
      go.disabled = false; stop.hidden = true; ctl = null;
    };
    root.append(U.section("Generate", h("div", { class: "stack" },
      h("div", { class: "form" }, h("label", { class: "chk" }, f.stocks, "US stocks"), h("label", { class: "chk" }, f.crypto, "Crypto"), h("label", { class: "chk" }, f.mine, "Include my watchlist & holdings"), U.field("Window", f.window), U.field("How many", f.count), U.field("Stocks from", f.exchange)),
      listChip,
      h("div", { class: "row", style: "gap:10px;align-items:flex-end;flex-wrap:wrap" }, h("label", { class: "field", style: "flex:1 1 280px;min-width:0" }, h("span", { class: "label" }, "Focus (optional)"), f.focus), h("div", { class: "row" }, go, stop)),
      h("p", { class: "small muted" }, "Takes about 2–4 minutes: the app measures the candidates (including each one's own odds of finishing higher over the window, from 5 years of history), Claude investigates them with news, price, earnings, options, Zacks, insider and smart-money tools and the Market Brain's record, and a second review checks every pick against the evidence before it's shown. Every pick gets a chance of going up and of going down. Uses your Claude usage plus roughly 40–70 data requests through Exa, a few news searches through Bigdata.com and CoinMarketCap, and Zacks lookups when they're connected. Stocks come from the largest companies on the NYSE and Nasdaq (above $2B market cap and $5 a share) through several angles: earnings in the window, today's movers, the biggest moves and a rotating sample of names not recommended lately. Coins come from the top 60 above $1B (no stablecoins or wrapped tokens). A name recommended in the last 30 days is picked again only with a stated reason, and no more than two picks share a sector. A focus adds the names Claude gives for it, each checked with a live quote and measured like the rest; ones that can't be priced are dropped."),
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
    root.append(pickHistory(app, allSets || sets));
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
  /* Every symbol ever recommended: how often, when, the last call, and how the graded calls turned out; plus what
     following every graded pick would have returned against the S&P 500 over the same windows. */
  function pickHistory(app, sets) {
    const fcs = app.store.cached("forecasts").filter(f => f.source === "ai-picks"), evals = app.store.cached("evals"), by = new Map();
    for (const s of sets) for (const p of s.picks || []) {
      const e = by.get(p.symbol) || { symbol: p.symbol, asset: p.asset, exchange: p.exchange || null, times: 0, first: Infinity, last: 0, lastUp: null, graded: 0, right: 0, followed: [] };
      e.times++; e.first = Math.min(e.first, s.createdAt); if (s.createdAt >= e.last) { e.last = s.createdAt; e.lastUp = p.upPct ?? null; e.exchange = p.exchange || e.exchange; }
      const f = fcs.find(x => x.pickSetId === s.id && x.symbol === p.symbol), ev = f && evals.find(v => v.forecastId === f.id);
      if (ev) { e.graded++; if (ev.directionHit) e.right++; if (ev.realizedReturnPct != null && (f.direction === "up" || f.direction === "down")) e.followed.push((f.direction === "up" ? 1 : -1) * Number(ev.realizedReturnPct)); }
      by.set(p.symbol, e);
    }
    const rows = [...by.values()].sort((a, b) => b.last - a.last);
    const box = h("div", { class: "stack" });
    if (!rows.length) { box.append(h("div", { class: "empty" }, "Nothing recommended yet.")); return U.section("Pick history", box); }
    const avg = (xs) => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null, pc = (x) => x == null ? "—" : (x > 0 ? "+" : "") + x.toFixed(1) + "%";
    box.append(h("div", { class: "row", style: "gap:8px;flex-wrap:wrap" }, h("span", { class: "pill" }, rows.length + " different names"), h("span", { class: "pill" }, sets.length + " sets"), h("span", { class: "pill" }, rows.filter(r => r.times > 1).length + " picked more than once"),
      rows.some(r => r.exchange) ? h("span", { class: "pill" }, rows.filter(r => r.exchange === "NYSE").length + " NYSE · " + rows.filter(r => r.exchange === "Nasdaq").length + " Nasdaq") : null));
    box.append(U.dataTable([{ t: "Asset", v: (r) => h("span", { class: "stack", style: "gap:0" }, h("strong", {}, r.symbol), h("span", { class: "tiny muted" }, r.exchange || (r.asset && r.asset.cls === "crypto" ? "Crypto" : "—"))), sort: (r) => r.symbol },
      { t: "Times picked", v: (r) => String(r.times), sort: (r) => r.times, n: true }, { t: "Last picked", v: (r) => U.fmtDate(r.last), sort: (r) => r.last },
      { t: "Last call", v: (r) => r.lastUp == null ? "—" : r.lastUp >= 50 ? "▲ " + r.lastUp + "%" : "▼ " + (100 - r.lastUp) + "%", n: true },
      { t: "Graded right", v: (r) => r.graded ? r.right + " of " + r.graded : "not yet", sort: (r) => r.graded ? r.right / r.graded : -1, n: true },
      { t: "If followed", v: (r) => r.followed.length ? h("span", { class: avg(r.followed) >= 0 ? "up" : "down" }, pc(avg(r.followed))) : "—", sort: (r) => avg(r.followed) ?? -1e9, n: true }], rows, { key: "picks.history", sort: [2, -1], noun: "names", placeholder: "Filter by symbol…", onRow: (r) => r.asset && app.openAsset(r.asset) }));
    // Following every graded pick, in the order they came due, against the S&P 500 over the same windows.
    const trades = MD.ai.followed(app, "ai-picks").sort((a, b) => a.to - b.to), chart = h("div", { class: "stack" });
    box.append(chart);
    if (trades.length < 2) chart.append(h("p", { class: "small muted" }, "The follow-every-pick chart appears once two or more picks have been graded (" + trades.length + " so far)."));
    else MD.ai.spyEach(trades).then(spy => {
      let a = 0, b = 0; const pts = trades.map((t, i) => { a += t.pct; b += spy[i] ?? 0; return { a, b }; }), lo = Math.min(0, ...pts.map(p => Math.min(p.a, p.b))), hi = Math.max(0, ...pts.map(p => Math.max(p.a, p.b))), W = 600, H = 140;
      const x = (i) => i / (pts.length - 1) * W, y = (v) => H - (v - lo) / ((hi - lo) || 1) * H, line = (k) => pts.map((p, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p[k]).toFixed(1)).join(" ");
      chart.replaceChildren(h("span", { class: "label" }, "If you'd followed every graded pick (equal size, a ‘down’ call as a short)"),
        h("div", { html: '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" height="140" preserveAspectRatio="none" role="img" aria-label="Cumulative return of following the picks against the S&P 500"><line x1="0" x2="' + W + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '" stroke="var(--line)" stroke-dasharray="4 4"/><path d="' + line("b") + '" fill="none" stroke="var(--muted)" stroke-width="2"/><path d="' + line("a") + '" fill="none" stroke="var(--accent)" stroke-width="2.5"/></svg>' }),
        h("p", { class: "small" }, h("strong", { style: "color:var(--accent)" }, "Picks " + pc(a)), " summed over " + trades.length + " graded picks · ", h("span", { class: "muted" }, "S&P 500 " + pc(b) + " over the same windows"), " · average per pick " + pc(a / trades.length) + " vs " + pc(b / trades.length) + "."),
        h("p", { class: "tiny muted" }, "Each graded pick counts once, held from the day it was made to its due date; the S&P 500 line holds SPY over exactly the same windows. Past results, before costs and taxes; not a guarantee."));
    }).catch(e => chart.replaceChildren(h("p", { class: "small muted" }, "S&P 500 comparison unavailable: " + U.errorText(e))));
    return U.section("Pick history", box);
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
    if (set.crossStock) wrap.append(h("p", { class: "small muted" }, "Cross-stock model across " + set.crossStock.names + " stock candidates: " + (set.crossStock.edge ? "a clear out-of-sample edge" : "no clear out-of-sample edge this time") + " (Brier skill " + (set.crossStock.brierSkillPct >= 0 ? "+" : "") + set.crossStock.brierSkillPct + "%, t " + set.crossStock.tStat + (set.crossStock.topVsBottomPct != null ? "; its top third beat its bottom third by " + set.crossStock.topVsBottomPct + "% a period over " + set.crossStock.periods + " periods" : "") + ")."));
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
      const banner = h("div", { class: "banner info", hidden: !notes.length }, h("p", { class: "small" }, h("strong", {}, "Set check: "), notes.join(" ")));
      wrap.append(banner);
      // Measured correlation of daily returns over the last 120 sessions: pairs that move together act like one bet.
      if (set.picks.length >= 2) Promise.all(set.picks.map(p => D.historyCached(p.asset, "1Y").then(hs => ({ p, m: new Map(hs.points.map((x, i) => [Math.floor(x.time / 86400), i ? Math.log((x.close ?? x.value) / (hs.points[i - 1].close ?? hs.points[i - 1].value)) : null])) })).catch(() => null))).then(rs => {
        const ok = rs.filter(Boolean), pairs = [];
        for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < ok.length; j++) {
          const days = [...ok[i].m.keys()].filter(d => ok[j].m.has(d) && ok[i].m.get(d) != null && ok[j].m.get(d) != null).slice(-120); if (days.length < 40) continue;
          const cc = correlate(days.map(d => ok[i].m.get(d)), days.map(d => ok[j].m.get(d)));
          if (cc != null && cc >= 0.7) pairs.push(ok[i].p.symbol + " and " + ok[j].p.symbol + " (" + cc.toFixed(2) + ")");
        }
        if (!pairs.length) return;
        banner.hidden = false; banner.firstChild.append((notes.length ? " " : "") + "Measured over the last 120 sessions, " + pairs.join(", ") + " have moved closely together: holding both is closer to one bet than two.");
      });
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
        h("div", { class: "hd" }, h("div", { class: "stack", style: "gap:0" }, h("strong", { style: "font-size:1.1rem" }, p.symbol + (p.mine ? " ★" : "")), h("span", { class: "small muted" }, p.asset.name + " · " + (p.asset.cls === "crypto" ? "Crypto" : p.asset.cls === "etf" ? "US ETF" : p.exchange ? p.exchange + " stock" : "US stock") + (p.mine ? " · on your watchlist or held" : ""))), h("span", { class: "verdict " + leanCls }, leanTxt)),
        h("div", { class: "bd" },
          p.repeat ? h("p", { class: "small" }, h("span", { class: "chip sm" }, "Picked again"), " Recommended " + p.repeat.times + "× in the last 30 days" + (p.repeat.reason ? ". Why again: " + p.repeat.reason : "") + ".") : null,
          (p.lenses || []).length ? h("div", { class: "row", style: "gap:4px;flex-wrap:wrap" }, p.lenses.map(l => h("span", { class: "chip sm" }, l)), p.alternate ? h("span", { class: "chip sm" }, "Alternate") : null) : null,
          p.upPct != null && MD.day ? MD.day.probBar(p.upPct, "Higher by " + due.toLocaleDateString(undefined, { month: "short", day: "numeric" }), "Lower") : null,
          U.kv([p.upPct != null ? ["If it rises / falls", "+" + C.fmtNum(p.ifUpPct, 0) + "% / −" + C.fmtNum(p.ifDownPct, 0) + "%"] : null, ["Expected move", "±" + C.fmtNum(p.moveLow, 0) + "–" + C.fmtNum(p.moveHigh, 0) + "%"], p.bigMove ? ["Chance of a ±" + C.fmtNum(Math.max(1, p.moveLow), 0) + "% move", (p.bigMove.eitherPct < 1 ? "under 1%" : p.bigMove.eitherPct.toFixed(0) + "%") + " (from volatility)"] : null, ["Time window", p.timeframeLabel], ["Price at pick", p.priceAtPick ? U.money(p.priceAtPick, p.currency || "USD", { price: true }) : "—"], ["Price now", now], ["Since pick", since], ["Confidence", p.confidence + "/100"]]),
          h("div", { class: "small muted" }, [m.impliedMovePct != null ? "Options market prices ±" + m.impliedMovePct.toFixed(1) + "% by " + m.impliedExpiry + (m.optionsAsOf ? " (" + m.optionsAsOf + ")" : "") : null, m.expectedMovePct != null ? "Volatility implies ±" + m.expectedMovePct.toFixed(1) + "% over the window (1σ)" : null, m.earnings ? "Earnings " + m.earnings.date : null, m.shortDaysToCover ? "Short interest " + m.shortDaysToCover.toFixed(1) + " days to cover" : null, lo && hi ? "Range at the high estimate: " + C.fmtNum(lo, lo >= 1 ? 2 : 4) + " – " + C.fmtNum(hi, hi >= 1 ? 2 : 4) : null].filter(Boolean).join(" · ")),
          h("div", {}, h("span", { class: "label" }, "Why it could move"), h("ul", { class: "small", style: "margin:4px 0 0;padding-left:1.1em;display:grid;gap:3px" }, p.why.map(w => h("li", {}, w)))),
          p.catalyst && p.catalyst.event ? h("p", { class: "small" }, h("strong", {}, "Catalyst: "), p.catalyst.event + (p.catalyst.date && p.catalyst.date !== "TBD" ? " (" + p.catalyst.date + ")" : "")) : null,
          p.invalidation ? h("p", { class: "small" }, h("strong", {}, "What would make it unlikely: "), p.invalidation) : null,
          p.risks ? h("p", { class: "small" }, h("strong", {}, "Biggest risk: "), p.risks) : null,
          p.preMortem ? h("p", { class: "small" }, h("strong", {}, "Pre-mortem (how it most likely fails): "), p.preMortem) : null,
          (p.panelEvidence || []).length ? h("details", { class: "small" }, h("summary", { class: "label", style: "cursor:pointer" }, "Specialist evidence (" + p.panelEvidence.length + ")"), h("ul", { class: "small", style: "margin:4px 0 0;padding-left:1.1em;display:grid;gap:3px" }, p.panelEvidence.map(e => h("li", {}, h("span", { class: "muted" }, e.by + ": "), e.claim + (e.figure ? " (" + e.figure + ")" : ""), e.url ? h("a", { href: e.url, target: "_blank", rel: "noopener noreferrer" }, " source") : null)))) : null,
          p.bullCase || p.bearCase ? h("div", { class: "bullbear" }, h("div", { class: "bb up" }, h("span", { class: "label" }, "Bull case"), h("p", { class: "small" }, p.bullCase || "—")), h("div", { class: "bb down" }, h("span", { class: "label" }, "Bear case"), h("p", { class: "small" }, p.bearCase || "—"))) : null,
          p.changeMyMind ? h("p", { class: "small" }, h("strong", {}, "What would change the view: "), p.changeMyMind) : null,
          MD.ai.reviewBadge(p.review),
          (() => { const box = h("div", { class: "recheck" }); const c = app.store.cached("pickchecks").filter(x => x.setId === set.id && x.symbol === p.symbol).sort((a, b) => b.at - a.at)[0]; if (c) box.append(recheckNote(c)); return box; })(),
          p.probs ? h("details", { class: "small" }, h("summary", { class: "label", style: "cursor:pointer" }, "How the " + p.upPct + "% chance up was built"),
            h("p", { class: "small" }, "Claude: " + p.probs.claude + "%" + (p.probs.model != null ? " · the asset's own history: " + p.probs.model + "%" : " · no measured history") + " · blended " + p.probs.blended + "%" + (p.probs.learnedWeights ? " (weights learned from the record: Claude " + p.probs.weightClaude + "%)" : "") + (p.probs.reviewer != null ? " · the reviewer's own estimate: " + p.probs.reviewer + "%" : "") + ((p.probs.afterReview ?? p.probs.final) !== p.probs.blended ? " · after the review: " + (p.probs.afterReview ?? p.probs.final) + "%" : "") + (p.calibration ? " · calibrated from " + p.calibration.scored + " graded picks (calls like this came true " + p.calibration.observedPct + "% of the time): " + p.probs.final + "%" : "") + "."),
            p.baseRates ? h("ul", { class: "small", style: "margin:4px 0 0;padding-left:1.1em;display:grid;gap:2px" }, h("li", {}, "Over every " + p.timeframeDays + "-day window " + (() => { const y = String(p.baseRates.historyFrom || "").slice(0, 4); return /^\d{4}$/.test(y) ? "since " + y : "in the measured history"; })() + ", it finished higher " + p.baseRates.overallUpPct + "% of the time (" + p.baseRates.windows + " windows, about " + p.baseRates.independent + " independent)."), p.baseRates.conditions.map(x => h("li", {}, "When " + x.condition + ": higher " + x.upPct + "% of the time (" + x.windows + " windows, ≈" + x.independent + " independent)."))) : null,
            p.moveExplained && p.moveExplained.last5Days ? h("p", { class: "tiny muted" }, "Last 5 days " + U.pct(p.moveExplained.last5Days.movePct) + ": " + U.pct(p.moveExplained.last5Days.explainedPct) + " explained by the market and its factors, " + U.pct(p.moveExplained.last5Days.unexplainedPct) + " its own.") : null,
            p.pooled ? h("p", { class: "small" }, "Cross-stock model: " + p.pooled.beatMarketPct + "% chance to beat the S&P 500 over the window, rank " + p.pooled.rank + " of " + p.pooled.of + " stock candidates (" + (p.pooled.edge ? "clear out-of-sample edge" : "no clear edge, so it's the base rate") + ").") : null,
            p.probs.stacked != null ? h("p", { class: "small" }, "Learned combiner (from " + p.stackedN + " graded picks, it beat the fixed blend on the latest of them): " + p.probs.stacked + "%.") : null,
            p.probs.panel ? h("p", { class: "small" }, "Specialist panel: fundamentals " + (p.probs.panel.fundamentals ?? "—") + "%, quant " + (p.probs.panel.quant ?? "—") + "%, news & macro " + (p.probs.panel.news ?? "—") + "% · lead analyst " + p.probs.lead + "% → team " + p.probs.claude + "% (spread ±" + p.probs.panel.spread + (p.probs.panel.spread > 10 ? ", confidence lowered" : "") + ").") : null,
            p.conflict ? h("p", { class: "small" }, "Conflict check: Claude said " + p.conflict.fromPct + "% against the measured " + p.conflict.measuredPct + "%" + (p.conflict.justification ? "; kept, because: " + p.conflict.justification : "; no specific evidence was given, so the gap was halved to " + p.conflict.toPct + "%") + ".") : null,
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
          MD.paper && p.upPct != null && p.upPct > 50 && set.id !== "unsaved" ? MD.paper.button(app, p.asset, { source: "pick", note: p.upPct + "% up over " + (p.timeframeLabel || p.timeframeDays + " days") + " (" + U.fmtDate(set.createdAt) + ")" }) : null,
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
