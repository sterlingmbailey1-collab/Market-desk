/* Shared AI analyst kit. Any AI feature can use the same research tools (news, web, measured price
   picture, Zacks, options-implied move, smart-money ownership, the user's portfolio), a second-pass
   review that checks a draft against the evidence actually retrieved, and the track record of past
   calls so stated confidence can be calibrated. The page fetches and computes every number; Claude
   reasons over tool results; every citation is checked against the URLs the tools returned. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const C = MD.core, U = MD.ui, D = MD.data, h = U.h;
  const rnd = (o) => o == null ? o : JSON.parse(JSON.stringify(o, (k, v) => typeof v === "number" ? (isFinite(v) ? +v.toPrecision(5) : null) : v));
  const COINS = new Set(["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE", "ADA", "AVAX", "DOT", "LINK", "LTC", "TRX", "TON", "SHIB", "XLM", "SUI", "HBAR", "BCH", "UNI", "NEAR", "APT", "PEPE", "ICP", "ETC"]);
  const iso = (t) => new Date(t * 1000).toISOString().slice(0, 10);

  // Resolve a ticker or coin cheaply: plain US tickers skip the search request.
  async function findAsset(q) {
    const s = String(q || "").trim(); if (!s) throw new Error("Give a ticker or coin name.");
    if (/^[A-Z][A-Z.\-]{0,5}$/.test(s) && !COINS.has(s)) { const etf = D.stocks.ETFS.some(e => e[0] === s); return { id: (etf ? "etf:" : "stock:") + s, cls: etf ? "etf" : "stock", symbol: s, name: s }; }
    return MD.advisorKit.findAsset(s);
  }

  /* A research session: the log shown to the user, the sources retrieved, and citation checks. */
  function session(onLog) {
    const S = { sources: [], log: [], calls: 0 };
    S.step = (kind, text) => { const e = { at: Date.now(), kind, text }; S.log.push(e); onLog && onLog(e); return e; };
    S.done = (e, kind, extra) => { e.kind = kind; if (extra) e.text += extra; onLog && onLog(e); };
    S.add = (url, title, via) => { if (url && /^https?:\/\//.test(url) && !S.sources.some(x => x.url === url)) S.sources.push({ url, title: title || url, via: via || "", retrievedAt: Date.now() }); };
    S.verify = (list) => (Array.isArray(list) ? list : []).filter(x => x && /^https?:\/\//.test(x.url)).map(x => ({ title: String(x.title || x.url).slice(0, 140), url: x.url, verified: S.sources.some(s => s.url === x.url) }));
    S.sourceList = () => S.sources.map(s => ({ title: s.title, url: s.url }));
    return S;
  }

  /* ---------- tools ---------- */
  const TOOLS = {
    search_news: { description: "Search Bigdata.com's indexed financial news (publisher, timestamp, passage excerpts). One company or topic and one time period per call, in natural language.", props: { query: { type: "string" } }, req: ["query"],
      label: (i) => "Bigdata.com news: " + i.query,
      async run(app, S, i) { const r = await D.bigdataNews(String(i.query || ""), 5); for (const x of r.items) S.add(x.url, x.title, "news"); return { results: r.items.length, articles: r.items.map(x => ({ headline: x.title, publisher: x.source, published: x.ts ? new Date(x.ts).toISOString() : null, url: x.url, excerpt: String(x.text || "").slice(0, 1400) })) }; } },
    search_web: { description: "Search the live web (news, filings, official pages, data pages). Returns titles, URLs and highlights. Use when search_news finds nothing or for non-financial sources.", props: { query: { type: "string" } }, req: ["query"],
      label: (i) => "Web search: " + i.query,
      async run(app, S, i) { const r = await D.webSearch(String(i.query || ""), "Recent, dated, reliable sources with exact figures.", 5); for (const x of r.results) S.add(x.url, x.title, "search"); return r.text.slice(0, 12000); } },
    read_page: { description: "Read the full text of one URL already found (a filing, press release or article).", props: { url: { type: "string" } }, req: ["url"],
      label: (i) => "Read page: " + i.url,
      async run(app, S, i) { const u = String(i.url || ""); if (!/^https?:\/\//.test(u)) throw new Error("Give a full https URL."); const t = await D.readPage(u, 9000); S.add(u, u, "read"); return t; } },
    crypto_news: { description: "Latest news for one cryptocurrency from CoinMarketCap. Matching is loose: check each headline is about the coin.", props: { symbol: { type: "string" } }, req: ["symbol"],
      label: (i) => "CoinMarketCap news: " + i.symbol,
      async run(app, S, i) { const r = await D.cmc.news(String(i.symbol || "").toUpperCase(), 6); for (const x of r.items) S.add(x.url, x.title, "news"); return r.items.map(x => ({ title: x.title, published: x.ts ? new Date(x.ts).toISOString() : null, url: x.url, excerpt: String(x.text || x.description || "").slice(0, 1200) })); } },
    stock_snapshot: { description: "Measured picture of a US stock/ETF or a coin, computed by the app from exchange data: live quote, 1-year return, volatility and max drawdown, trend versus 50/200-day averages, RSI(14), MACD, distance from the 52-week high and low, returns from 1 week to 1 year, and the next earnings date when Nasdaq lists one.", props: { symbol: { type: "string", description: "Ticker (NVDA) or coin (bitcoin, BTC)" } }, req: ["symbol"],
      label: (i) => "Price picture for " + i.symbol,
      async run(app, S, i) {
        const a = await findAsset(i.symbol);
        const [q, hs] = await Promise.all([app.quote(a).catch(() => null), D.historyFor(a, "1Y")]);
        const st = C.seriesStats(hs.points, hs.ppy || 252), t = C.technicals(hs.points, hs.ppy || 252);
        return rnd({ symbol: a.symbol, name: q && q.name || a.name, class: a.cls, price: q ? q.price : st.end, currency: q ? q.currency : "USD", quoteSource: q ? q.source + " · " + q.status : hs.source + " (last close)", dayChangePct: q && q.changePct, nextEarnings: q && q.nextEarnings || null,
          history: { source: hs.source, from: iso(hs.points[0].time), to: iso(hs.points[hs.points.length - 1].time) }, return1YPct: st.changePct, volPct: st.volPct, maxDrawdownPct: st.maxDrawdownPct, sharpe: st.sharpe,
          trend: t && t.trend, aboveSma50: t && t.sma50 ? st.end > t.sma50 : null, aboveSma200: t && t.sma200 ? st.end > t.sma200 : null, cross: t && t.cross ? t.cross.kind : null, rsi14: t && t.rsi14, macdHist: t && t.macd && t.macd.hist, fromHighPct: t && t.fromHighPct, rangePos52w: t && t.rangePos, returnsPct: C.periodReturns(hs.points) });
      } },
    zacks_view: { description: "Zacks Investment Research for a US-listed stock: Zacks Rank (1 Strong Buy to 5 Strong Sell), Value/Growth/Momentum scores, Zacks target price, industry rank, EPS surprise and each Wall Street broker's latest rating and target. Present as Zacks' view and cite the returned URL.", props: { ticker: { type: "string" } }, req: ["ticker"],
      label: (i) => "Zacks view of " + i.ticker,
      async run(app, S, i) {
        const sym = String(i.ticker || "").toUpperCase();
        const [m, r] = await Promise.all([D.zacks.metrics(sym), D.zacks.ratings(sym).catch(() => null)]);
        S.add(m.url, "Zacks " + sym, "data");
        const keep = ["zacks_rank", "zacks_rank_text", "value_score", "growth_score", "momentum_score", "vgm_score", "zacks_target_price", "x_industry_rank", "x_industry_count", "x_industry_name", "pe_trailing12m", "peg_f1", "last_qtr_eps_surp_pct", "exp_rep_date", "last_trade_date"];
        const recs = r && r.records ? r.records : [];
        const tally = recs.reduce((o, x) => { const k = /strong buy|buy|outperform|overweight/i.test(x.rating) ? "buy" : /sell|underperform|underweight/i.test(x.rating) ? "sell" : "hold"; o[k]++; return o; }, { buy: 0, hold: 0, sell: 0 });
        const tg = recs.map(x => x.target).filter(x => x > 0);
        return rnd({ ticker: sym, url: m.url, facts: Object.fromEntries(keep.filter(k => m.v(k) != null).map(k => [k, m.v(k)])), brokers: { count: recs.length, ...tally, medianTarget: tg.length ? tg.sort((a, b) => a - b)[Math.floor(tg.length / 2)] : null, recent: recs.slice(0, 6).map(x => ({ broker: x.broker, rating: x.rating, action: x.action, target: x.target, date: x.date })) } });
      } },
    options_move: { description: "The options market's own estimate of how far a US stock may move by each listed expiry in the next ~7 weeks (at-the-money straddle), from Nasdaq's option chain.", props: { ticker: { type: "string" } }, req: ["ticker"],
      label: (i) => "Options-implied move for " + i.ticker,
      async run(app, S, i) {
        const sym = String(i.ticker || "").toUpperCase(); const q = await app.quote({ id: "stock:" + sym, cls: "stock", symbol: sym });
        const om = await D.stocks.optionMoves(sym, q.price);
        return rnd({ ticker: sym, price: q.price, asOf: om.asOf, source: om.source, moves: om.moves.slice(0, 5).map(m => ({ expiry: m.expiry, days: m.days, movePct: m.movePct })) });
      } },
    insider_activity: { description: "Company insiders' Form 4 trades for a US stock from Nasdaq: open-market buys and sells over 3 and 12 months, net shares, and the latest transactions (most insider selling is scheduled or tax-related; open-market buys are the rarer, more telling signal).", props: { ticker: { type: "string" } }, req: ["ticker"],
      label: (i) => "Insider activity for " + i.ticker,
      async run(app, S, i) { const sym = String(i.ticker || "").toUpperCase(); const r = await D.stocks.insiders(sym); S.add(r.url, "Nasdaq insider activity " + sym, "data"); return rnd({ ticker: sym, url: r.url, counts: r.counts, shares: r.shares, latest: r.rows.slice(0, 10).map(x => ({ insider: x.insider, relation: x.relation, date: x.date, type: x.type, shares: x.shares, price: x.price })) }); } },
    smart_money: { description: "Which tracked members of Congress (disclosed trades) and superinvestors (latest 13F) hold or recently traded a US ticker, from data the Smart Money tab has already loaded. Disclosures lag by weeks and say nothing about why a trade was made.", props: { ticker: { type: "string" } }, req: ["ticker"],
      label: (i) => "Smart money in " + i.ticker,
      async run(app, S, i) { const sym = String(i.ticker || "").toUpperCase(); const who = MD.smartView ? MD.smartView.whoOwns(app, sym) : []; return { ticker: sym, holdersOrTraders: who.map(w => ({ name: w.name, kind: w.kind === "pol" ? "member of Congress" : "13F investor", detail: w.note })), note: who.length ? "From disclosures loaded on the Smart Money tab." : "None of the tracked people hold or recently traded it (or the Smart Money tab hasn't loaded yet)." }; } },
    price_range: { description: "Statistical price range for a stock/ETF or coin over N days from its measured 1-year volatility (lognormal): 5/25/50/75/95th percentile prices, chance of finishing above today, and optionally the chance of finishing above or touching a target. A range of outcomes, not a forecast.", props: { symbol: { type: "string" }, days: { type: "number" }, target: { type: "number" } }, req: ["symbol", "days"],
      label: (i) => "Price range for " + i.symbol + " over " + i.days + " days",
      async run(app, S, i) {
        const a = await findAsset(i.symbol); const [q, hs] = await Promise.all([app.quote(a), D.historyFor(a, "1Y")]);
        const st = C.seriesStats(hs.points, hs.ppy || 252), days = Math.max(1, Math.min(1825, Number(i.days) || 30));
        const p = C.projectPrice({ price: q.price, volPct: st.volPct, driftPct: 0, days }); if (!p) throw new Error("Couldn't model " + a.symbol + ".");
        const out = { symbol: a.symbol, price: q.price, volPct: st.volPct, days, p05: p.p05, p25: p.p25, median: p.median, p75: p.p75, p95: p.p95, chanceAboveTodayPct: p.probUp * 100 };
        if (Number(i.target) > 0) { out.target = Number(i.target); out.chanceFinishAbovePct = p.probAbove(out.target) * 100; out.chanceTouchPct = p.probTouch(out.target) * 100; }
        return rnd(out);
      } },
    my_portfolio: { description: "The user's current holdings in their reporting currency: each holding's weight, class, currency and gain since purchase, plus the watchlist.", props: {}, req: [],
      label: () => "Your portfolio",
      async run(app) { const pv = await app.valuePortfolio(); const total = Number(pv.totals.valueR) || 0; return rnd({ reportingCurrency: pv.R, totalValue: total, holdings: pv.rows.filter(r => r.p.qty.gt(0)).map(r => ({ symbol: r.p.symbol, name: r.p.name, class: r.p.assetClass, weightPct: total ? Number(r.v.valueR || 0) / total * 100 : null, gainPct: r.v.pnlPctN != null ? Number(r.v.pnlPctN) : null })), watchlist: app.store.cached("watch").map(w => w.symbol).slice(0, 30), demo: !!app.demo }); } },
    track_record: { description: "How the app's own past AI calls turned out, from the forecast journal: Recommendations picks and AI quick takes, each with the number scored, hit rate, Brier score and hit rate by stated probability. Use it to calibrate how confident to be.", props: {}, req: [],
      label: () => "AI track record",
      async run(app) { return rnd({ recommendations: trackRecord(app, "ai-picks"), quickTakes: trackRecord(app, "ai-take"), allForecasts: trackRecord(app) }); } },
    compare_returns: { description: "Measured 1-year return, volatility, max drawdown and Sharpe ratio for up to 5 tickers or coins side by side (e.g. against SPY or SGOV as baselines).", props: { symbols: { type: "array", items: { type: "string" } } }, req: ["symbols"],
      label: (i) => "Compare " + (i.symbols || []).join(", "),
      async run(app, S, i) { const syms = (Array.isArray(i.symbols) ? i.symbols : []).slice(0, 5).map(String); return Promise.all(syms.map(async (s) => { try { const a = await findAsset(s); const hs = await D.historyFor(a, "1Y"); const st = C.seriesStats(hs.points, hs.ppy || 252); return rnd({ symbol: a.symbol, returnPct: st.changePct, volPct: st.volPct, maxDrawdownPct: st.maxDrawdownPct, sharpe: st.sharpe }); } catch (e) { return { symbol: s, error: U.errorText(e) }; } })); } }
  };
  // Tool objects in the shape app.caps.sample expects; failures come back as readable errors.
  function tools(app, S, names) {
    return (names || Object.keys(TOOLS)).filter(n => TOOLS[n]).map(n => {
      const T = TOOLS[n];
      return { name: n, description: T.description, inputSchema: { type: "object", properties: T.props, required: T.req },
        async execute(i) { S.calls++; const e = S.step("run", T.label(i || {})); try { const r = await T.run(app, S, i || {}); S.done(e, "ok"); return r; } catch (err) { S.done(e, "fail", " → " + U.errorText(err)); throw new Error(U.errorText(err)); } } };
    });
  }

  /* ---------- track record (forecast journal) ---------- */
  // How past calls from one source turned out, bucketed by the probability Claude stated.
  function trackRecord(app, source) {
    const fcs = app.store.cached("forecasts").filter(f => !source || f.source === source), evals = app.store.cached("evals");
    const scored = fcs.map(f => { const e = evals.find(v => v.forecastId === f.id); return e ? { p: Number(f.probability) || 0.5, hit: !!e.directionHit } : null; }).filter(Boolean);
    const buckets = [[0.5, 0.6], [0.6, 0.7], [0.7, 1.01]].map(([lo, hi]) => { const xs = scored.filter(x => x.p >= lo && x.p < hi); return { range: Math.round(lo * 100) + "–" + Math.min(100, Math.round(hi * 100)) + "%", n: xs.length, hitPct: xs.length ? xs.filter(x => x.hit).length / xs.length * 100 : null }; });
    const n = scored.length, hits = scored.filter(x => x.hit).length;
    const brier = n ? scored.reduce((s, x) => s + Math.pow(x.p - (x.hit ? 1 : 0), 2), 0) / n : null;
    return { logged: fcs.length, scored: n, hitPct: n ? hits / n * 100 : null, brier, buckets };
  }
  function calibrationNote(tr) {
    if (!tr || tr.scored < 5) return "Track record: fewer than 5 of your past calls have been scored, so there is no calibration evidence yet; keep stated probabilities modest.";
    return "Track record of your past calls of this kind: " + tr.scored + " scored, " + tr.hitPct.toFixed(0) + "% came true (Brier " + tr.brier.toFixed(3) + "). By stated probability: " + tr.buckets.filter(b => b.n).map(b => b.range + ": " + b.hitPct.toFixed(0) + "% of " + b.n).join("; ") + ". If calls at a stated level came true less often than stated, state lower probabilities this time.";
  }

  // The investor profile from Settings, told to every AI feature so its judgements fit this person.
  const RISK = { low: "conservative (protect capital first)", mid: "balanced", high: "aggressive (accepts large drawdowns)" }, HZ = { short: "under a year", mid: "1–3 years", long: "5+ years" };
  function profileNote(app) {
    const p = (app.settings && app.settings.profile) || {};
    return "Investor profile (set by the user in Settings; respect it): risk appetite " + (RISK[p.risk] || RISK.mid) + "; typical holding period " + (HZ[p.horizon] || HZ.mid) + (p.income ? "; wants income (dividends)" : "") + (p.goals ? "; goals: " + String(p.goals).slice(0, 300) : "") + (p.avoid ? "; avoid: " + String(p.avoid).slice(0, 200) : "") + "; experience: " + ((app.settings && app.settings.mode) || "intermediate") + ".";
  }
  /* Score forecasts whose date has passed, from the close on (or after) the due date. Runs from the journal's
     button and quietly in the background, so every AI's track record stays current. */
  let scoring = null;
  function scoreDue(app, opts = {}) {
    if (scoring) return scoring;
    scoring = (async () => {
      const evals = app.store.cached("evals"), done = new Set(evals.map(e => e.forecastId));
      const due = app.store.cached("forecasts").filter(f => f.dueAt <= Date.now() && !done.has(f.id) && f.asset).sort((a, b) => a.dueAt - b.dueAt).slice(0, opts.max || 50);
      let n = 0; const failed = [];
      for (const f of due) {
        try {
          const dueDay = Math.floor(f.dueAt / 864e5);
          const s = await D.historyFor(f.asset, (Date.now() - f.dueAt) / 864e5 > 300 ? "5Y" : "1Y");
          const pt = s.points.find(p => Math.floor(p.time / 86400) >= dueDay) || s.points[s.points.length - 1];
          if (Math.floor(pt.time / 86400) < dueDay - 4) continue; // the due date's close isn't in yet
          const price = pt.close ?? pt.value, ev = C.evaluateForecast(f, price);
          if (ev && !app.store.cached("evals").some(e => e.forecastId === f.id)) { await app.store.create("evals", Object.assign({ forecastId: f.id, evaluatedAt: Date.now(), priceAtDue: price, priceDate: iso(pt.time), priceSource: s.source, probability: f.probability, source: f.source }, ev)); n++; }
        } catch (e) { failed.push({ symbol: f.symbol, error: U.errorText(e) }); }
      }
      return { scored: n, failed, due: due.length };
    })().finally(() => { scoring = null; });
    return scoring;
  }
  const SOURCE_LABEL = { "ai-picks": "Recommendations", "ai-take": "AI quick takes", ai: "Deep Research", user: "Your own forecasts" };
  /* Per-source accuracy and a calibration chart: for each stated-probability band, how often calls came true. */
  function scorecard(app) {
    const fcs = app.store.cached("forecasts"), evals = app.store.cached("evals");
    const srcs = [...new Set(fcs.map(f => f.source || "user"))];
    const rows = srcs.map(s => Object.assign({ source: s, label: SOURCE_LABEL[s] || s }, trackRecord(app, s === "user" ? null : s))).filter(r => r.logged);
    const all = trackRecord(app);
    const W = 300, H = 150, pad = 26;
    const pts = all.buckets.filter(b => b.n);
    const x = (p) => pad + (p - 50) / 50 * (W - pad - 8), y = (p) => H - pad - p / 100 * (H - pad - 8);
    const mid = { "50–60%": 55, "60–70%": 65, "70–100%": 80 };
    const svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:420px" role="img" aria-label="Calibration: stated probability against how often calls came true">' +
      '<line x1="' + x(50) + '" y1="' + y(50) + '" x2="' + x(100) + '" y2="' + y(100) + '" stroke="currentColor" stroke-opacity="0.35" stroke-dasharray="4 4"/>' +
      '<line x1="' + pad + '" y1="' + (H - pad) + '" x2="' + (W - 8) + '" y2="' + (H - pad) + '" stroke="currentColor" stroke-opacity="0.3"/><line x1="' + pad + '" y1="8" x2="' + pad + '" y2="' + (H - pad) + '" stroke="currentColor" stroke-opacity="0.3"/>' +
      pts.map(b => '<circle cx="' + x(mid[b.range]) + '" cy="' + y(b.hitPct) + '" r="' + Math.min(10, 3 + Math.sqrt(b.n) * 1.5) + '" fill="var(--accent)" fill-opacity="0.75"><title>' + b.range + ' stated: ' + b.hitPct.toFixed(0) + '% came true (' + b.n + ')</title></circle>').join("") +
      '<text x="' + pad + '" y="' + (H - 8) + '" font-size="9" fill="currentColor" opacity="0.6">50% stated</text><text x="' + (W - 60) + '" y="' + (H - 8) + '" font-size="9" fill="currentColor" opacity="0.6">100% stated</text><text x="2" y="14" font-size="9" fill="currentColor" opacity="0.6">came true</text></svg>';
    return h("div", { class: "stack" },
      rows.length ? U.table([{ t: "Source", v: "label" }, { t: "Logged", v: (r) => String(r.logged), n: true }, { t: "Scored", v: (r) => String(r.scored), n: true }, { t: "Came true", v: (r) => r.hitPct != null ? r.hitPct.toFixed(0) + "%" : "—", n: true }, { t: "Brier (lower is better)", v: (r) => r.brier != null ? r.brier.toFixed(3) : "—", n: true }, { t: "By stated probability", v: (r) => r.buckets.filter(b => b.n).map(b => b.range + ": " + b.hitPct.toFixed(0) + "% of " + b.n).join(" · ") || "—" }], rows) : h("div", { class: "empty" }, "No forecasts logged yet."),
      all.scored ? h("div", { class: "row", style: "gap:16px;flex-wrap:wrap;align-items:center" }, h("div", { html: svg, style: "color:var(--muted);flex:1 1 260px;min-width:0" }), h("p", { class: "small muted", style: "flex:1 1 220px" }, "Each dot is a band of stated probability; its height is how often those calls came true. Dots below the dashed line mean the AI was overconfident in that band. Every AI that logs forecasts is told this record and asked to calibrate.")) : null,
      h("p", { class: "tiny muted" }, "Due forecasts are scored automatically while the page is open, from the close on their due date. A Brier score of 0.25 is what always saying 50% would earn."));
  }

  /* ---------- review pass ---------- */
  /* A skeptical second reader checks each item of a draft against the measured data and the sources
     actually retrieved: unsupported claims, ignored risks, overconfidence. Returns per-item verdicts. */
  async function review(app, { task, items, facts, S, signal }) {
    const s = app.caps.sample; if (!s || !items.length) return null;
    const st = S.step("run", "Independent review of " + items.length + " item" + (items.length > 1 ? "s" : ""));
    const prompt = `You are a skeptical independent reviewer checking an analyst's draft before an investor sees it. Task the draft answers: ${task}
Check each item ONLY against the measured data and the list of sources that were actually retrieved. Flag: claims not supported by the data or sources, figures that contradict the measured data, risks ignored, confidence that is too high for the evidence, and anything that reads like advice to act. Be concrete. Keep items that hold up.
Measured data: ${JSON.stringify(facts).slice(0, 60000)}
Sources retrieved: ${JSON.stringify(S.sourceList()).slice(0, 12000)}
Draft items: ${JSON.stringify(items).slice(0, 60000)}
Reply with ONLY JSON: {"reviews": [{"id": "the item's id", "verdict": "keep"|"revise"|"drop", "issues": ["short, specific problems; empty if none"], "adjustedConfidence": 0-100, "note": "one sentence the investor should read"}], "overall": "one sentence on the draft as a whole"}`;
    try {
      const r = await s.json(prompt, { modelTier: "complex", signal, cache: false });
      const reviews = (Array.isArray(r.reviews) ? r.reviews : []).filter(x => x && x.id != null).map(x => ({ id: String(x.id), verdict: ["keep", "revise", "drop"].includes(x.verdict) ? x.verdict : "keep", issues: (x.issues || []).slice(0, 4).map(String), adjustedConfidence: x.adjustedConfidence == null ? null : Math.max(0, Math.min(100, Number(x.adjustedConfidence) || 0)), note: String(x.note || "") }));
      S.done(st, "ok", " → " + reviews.filter(x => x.verdict === "keep").length + " kept, " + reviews.filter(x => x.verdict === "revise").length + " revised, " + reviews.filter(x => x.verdict === "drop").length + " dropped");
      return { reviews, overall: String(r.overall || "") };
    } catch (e) { if (e && e.code === "cancelled") throw e; S.done(st, "fail", " → didn't complete; showing the draft unreviewed"); return null; }
  }

  /* Overall confidence from parts (0–100 each) with weights; parts missing are skipped. */
  function blend(parts) {
    const xs = parts.filter(p => p.value != null && isFinite(p.value)); const w = xs.reduce((s, p) => s + p.weight, 0);
    return w ? Math.round(xs.reduce((s, p) => s + p.weight * Math.max(0, Math.min(100, p.value)), 0) / w) : null;
  }

  /* ---------- UI helpers ---------- */
  const ERR = { no_sample: "Claude isn't available in this view.", not_granted: "Claude access was declined for this page.", rate_limited: "Usage limit reached; try again later.", invalid_json: "The answer came back unreadable; try again.", cancelled: "Stopped." };
  const errText = (e) => ERR[e && e.code] || (e && e.message) || "Failed.";
  function logBox() {
    const el = h("div", { class: "log", hidden: true });
    // A step logged again (when it finishes) updates its line instead of adding one.
    el.add = (e) => { el.hidden = false; const t = new Date(e.at || Date.now()).toLocaleTimeString() + "  " + e.text; if (e._el && el.contains(e._el)) { e._el.className = e.kind; e._el.textContent = t; } else { e._el = h("div", { class: e.kind }, t); el.append(e._el); } el.scrollTop = el.scrollHeight; };
    el.clear = () => { el.replaceChildren(); el.hidden = true; };
    return el;
  }
  function meters(parts) {
    return h("div", { class: "aimeters" }, parts.filter(p => p && p.value != null).map(p => h("div", { class: "stack", style: "gap:2px" },
      h("div", { class: "row between" }, h("span", { class: "label" }, p.label), h("b", { class: "num" }, String(Math.round(p.value)))),
      h("span", { class: "meter" }, h("i", { style: "width:" + Math.max(0, Math.min(100, p.value)).toFixed(0) + "%" })), p.note ? h("span", { class: "tiny muted" }, p.note) : null)));
  }
  function sources(list) {
    if (!list || !list.length) return h("p", { class: "tiny faint" }, "No sources cited.");
    return h("div", { class: "tiny" }, h("span", { class: "label" }, "Sources "), list.map((s, i) => h("span", {}, i ? " · " : "", h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer" }, String(s.title || s.url).slice(0, 60)), s.verified === false ? h("span", { class: "warn-t" }, " (unverified)") : null)));
  }
  function reviewBadge(rv) {
    if (!rv) return null;
    const cls = rv.verdict === "keep" ? "positive" : rv.verdict === "drop" ? "negative" : "neutral";
    return h("div", { class: "aireview " + cls }, h("span", { class: "verdict sm " + cls }, rv.verdict === "keep" ? "Review: holds up" : rv.verdict === "drop" ? "Review: dropped" : "Review: revised"), rv.note ? h("span", { class: "small" }, rv.note) : null, rv.issues && rv.issues.length ? h("ul", { class: "small" }, rv.issues.map(x => h("li", {}, x))) : null);
  }
  const list = (label, xs) => xs && xs.length ? h("div", {}, h("span", { class: "label" }, label), h("ul", { class: "small", style: "margin:4px 0 0;padding-left:1.1em;display:grid;gap:3px" }, xs.map(x => h("li", {}, x)))) : null;

  MD.ai = { findAsset, session, tools, TOOLS, profileNote, RISK, HZ, trackRecord, calibrationNote, scoreDue, scorecard, SOURCE_LABEL, review, blend, errText, logBox, meters, sources, reviewBadge, list, rnd };
})(typeof window !== "undefined" ? window : globalThis);
