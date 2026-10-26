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
    ml_forecast: { description: "Machine-learning forecast for a stock, ETF or coin: logistic regression plus nearest-neighbour analogs trained on its daily history, walk-forward validated. Returns the chance it is higher after `days` (7, 30 or 91), the out-of-sample accuracy, Brier skill and AUC against the base rate, the top drivers and how similar past setups turned out. When edgeOutOfSample is false the odds are just the base rate.", props: { symbol: { type: "string" }, days: { type: "number" } }, req: ["symbol"],
      label: (i) => "Machine-learning forecast: " + i.symbol,
      async run(app, S, i) { const a = await findAsset(String(i.symbol || "")), d = [7, 30, 91].reduce((b, x) => Math.abs(x - (Number(i.days) || 30)) < Math.abs(b - (Number(i.days) || 30)) ? x : b, 30); return MD.mlView.compact(await MD.mlView.run(app, a, d)); } },
    portfolio_fit: { description: "What buying a stock, ETF or coin would have done to the user's portfolio over the past year: weight after, portfolio volatility and worst drop before and after, and correlation with the holdings. Give the position as a percent of the portfolio (default 5). Measured with today's holdings held constant; not a forecast.", props: { symbol: { type: "string" }, pct: { type: "number" } }, req: ["symbol"],
      label: (i) => "Portfolio fit: " + i.symbol + " at " + (i.pct || 5) + "% of the portfolio",
      async run(app, S, i) { const a = await findAsset(String(i.symbol || "")), pct = Math.max(0.5, Math.min(50, Number(i.pct) || 5)); const P = await MD.rebalance.previewBuy(app, a, { pct }), t = P.t; return rnd({ symbol: a.symbol, positionPctTested: pct, amount: P.A, currency: P.R, paidFromCash: P.fromCash, weightBeforePct: t.weightBefore, weightAfterPct: t.weightAfter, portfolioVolPct: { before: t.volBefore, after: t.volAfter }, worstDrop1yPct: { before: t.ddBefore, after: t.ddAfter }, correlationWithPortfolio: t.corr, assetVolPct: t.assetVol, tradingDays: t.days, priceSource: P.source }); } },
    open_calls: { description: "The desk's open AI calls (recommendations, quick takes, AI decisions, research) priced now: the move since each call and the chance it still finishes on its side by the due date, from the asset's volatility alone.", props: {}, req: [],
      label: () => "Open AI calls",
      async run(app) { const rows = await openCalls(app, { max: 15 }); return rnd({ calls: rows.map(r => ({ symbol: r.f.symbol, by: SOURCE_LABEL[r.f.source] || r.f.source, call: r.f.direction, statedPct: r.f.probability ? Math.round(r.f.probability * 100) : null, madeOn: new Date(r.f.createdAt).toISOString().slice(0, 10), due: new Date(r.f.dueAt).toISOString().slice(0, 10), movePct: r.movePct ?? null, oddsNowPct: r.st ? r.st.oddsNowPct : null, error: r.error || undefined })) }); } },
    my_portfolio: { description: "The user's current holdings in their reporting currency: each holding's weight, class, currency and gain since purchase, plus the watchlist.", props: {}, req: [],
      label: () => "Your portfolio",
      async run(app) { const pv = await app.valuePortfolio(); const total = Number(pv.totals.valueR) || 0; return rnd({ reportingCurrency: pv.R, totalValue: total, holdings: pv.rows.filter(r => r.p.qty.gt(0)).map(r => ({ symbol: r.p.symbol, name: r.p.name, class: r.p.assetClass, weightPct: total ? Number(r.v.valueR || 0) / total * 100 : null, gainPct: r.v.pnlPctN != null ? Number(r.v.pnlPctN) : null })), watchlist: app.store.cached("watch").map(w => w.symbol).slice(0, 30), demo: !!app.demo }); } },
    track_record: { description: "How the app's own past AI calls turned out, from the forecast journal: Recommendations picks and AI quick takes, each with the number scored, hit rate, Brier score and hit rate by stated probability. Use it to calibrate how confident to be.", props: {}, req: [],
      label: () => "AI track record",
      async run(app) { return rnd({ recommendations: trackRecord(app, "ai-picks"), quickTakes: trackRecord(app, "ai-take"), allForecasts: trackRecord(app) }); } },
    market_pulse: { description: "The whole market right now, measured by the app: today's, 5-day and 1-month moves of the S&P 500, Nasdaq-100, small caps, Dow, long Treasuries (rates), the dollar, oil, gold, high-yield credit, bitcoin and the 11 sector funds plus semiconductors; the regime (trend, volatility state, stock–bond correlation, sector leadership); the US session phase; and what the desk's Market Brain has learned (latest session, recurring drivers, patterns with their record).", props: {}, req: [],
      label: () => "Market pulse",
      async run(app) { const P = await MD.brain.pulse(app, { history: true }); return rnd({ session: P.session, regime: P.regime, instruments: P.rows.map(r => ({ symbol: r.symbol, name: r.name, todayPct: r.changePct, fiveDayPct: r.ret5d, oneMonthPct: r.ret1m })), marketBrain: MD.brain.note(app) || "No sessions studied yet." }); } },
    explain_move: { description: "Why a stock, ETF or coin moved: a factor model fitted on a year of daily returns splits today's and the last 5 days' move into the market (S&P 500), its sector fund, long Treasuries (rates), the dollar and oil (bitcoin, tech and the dollar for coins), and the unexplained, asset-specific remainder, with how unusual that remainder is. Use it before searching for news: a move the market explains needs no company story.", props: { symbol: { type: "string" } }, req: ["symbol"],
      label: (i) => "Explain the move in " + i.symbol,
      async run(app, S, i) { const a = await findAsset(i.symbol); return rnd(await MD.brain.explainMove(app, a)); } },
    base_rates: { description: "Measured odds from the asset's own history (5 years of daily closes for US stocks/ETFs, 2 for coins): how often it finished higher over the given number of days, overall and in past situations like today's (RSI, trend, a sharp recent move, distance from the high), each with its sample size; a shrunk model P(up)/P(down); typical up and down move sizes; and the chance of a move larger than 10% either way. Overlapping windows are counted honestly as fewer independent samples.", props: { symbol: { type: "string" }, days: { type: "number", description: "Horizon in calendar days" } }, req: ["symbol", "days"],
      label: (i) => "Base rates for " + i.symbol + " over " + i.days + " days",
      async run(app, S, i) { const a = await findAsset(i.symbol); return rnd(await baseRatesFor(a, Number(i.days) || 30)); } },
    intraday_levels: { description: "Day-trading picture for a US stock/ETF or coin: price vs the previous close, pre-market high/low, the open and opening range, session high/low, VWAP with bands, the previous day's high/low/close, floor pivots, ATR (typical daily range) and how much of it is used, relative volume, how past gaps like today's played out the same day, and the US session clock.", props: { symbol: { type: "string" } }, req: ["symbol"],
      label: (i) => "Intraday levels for " + i.symbol,
      async run(app, S, i) { const a = await findAsset(i.symbol); const L = await MD.day.levels(app, a); return rnd(MD.day.forAI(L)); } },
    market_memory: { description: "What the desk's Market Brain has learned from studying past sessions: the sessions that mention a symbol, sector fund or theme, the drivers and moves recorded for them, and cause → effect patterns with how often each held when tested. Leave query empty for the overview.", props: { query: { type: "string" } }, req: [],
      label: (i) => "Market memory" + (i && i.query ? ": " + i.query : ""),
      async run(app, S, i) { return rnd(MD.brain.memory(app, i && i.query)); } },
    backtest_rule: { description: "Test a cause → effect idea against history: on days the cause happened (a daily % move of one instrument above or below a threshold), how often did the effect follow (another instrument's daily move, optionally relative to a benchmark, the same day or the next), compared with how often the effect happens on any day. Works for the market ETFs (SPY, QQQ, IWM, TLT, UUP, USO, GLD, HYG, sector funds), BTC and any US stock or ETF. Returns cases, hit rate, baseline, lift and a z-score.", props: { cause_symbol: { type: "string" }, cause_op: { type: "string", enum: ["<", ">"] }, cause_pct: { type: "number" }, effect_symbol: { type: "string" }, effect_vs: { type: "string", description: "Optional benchmark, e.g. SPY" }, effect_op: { type: "string", enum: ["<", ">"] }, effect_pct: { type: "number" }, lag_days: { type: "number", description: "0 = same day, 1 = next day" }, lookback: { type: "string", enum: ["1Y", "3Y"] } }, req: ["cause_symbol", "cause_op", "cause_pct", "effect_symbol", "effect_op"],
      label: (i) => "Backtest: " + i.cause_symbol + " " + i.cause_op + " " + i.cause_pct + "% → " + i.effect_symbol,
      async run(app, S, i) { const rule = MD.quant.cleanRule({ cause: { symbol: i.cause_symbol, op: i.cause_op, pct: i.cause_pct }, effect: { symbol: i.effect_symbol, vs: i.effect_vs || null, op: i.effect_op, pct: i.effect_pct ?? 0 }, lagDays: i.lag_days }); if (!rule) throw new Error("That rule isn't valid: give symbols, '<' or '>' and percentages."); const b = await MD.brain.backtest(app, rule, i.lookback === "3Y" ? "3Y" : "1Y", null); return rnd(Object.assign({ rule: MD.quant.ruleText(rule), verdict: MD.quant.backtestVerdict(b) }, b)); } },
    movers: { description: "Today's biggest US stock gainers, losers and most active names (Nasdaq; $5+ stocks), for the regular session, pre-market or after-hours.", props: { session: { type: "string", enum: ["regular", "pre", "after"] } }, req: [],
      label: (i) => "Movers" + (i && i.session && i.session !== "regular" ? " (" + i.session + "-market)" : ""),
      async run(app, S, i) { const st = { pre: "preMarket", after: "afterHours" }[i && i.session] || "currentMarket"; const m = await D.stocks.movers(st); const f = (rows) => rows.filter(r => r.price >= 5).slice(0, 10).map(r => ({ symbol: r.symbol, name: r.name, price: r.price, changePct: r.changePct })); return rnd({ asOf: m.asOf, gainers: f(m.gainers.rows), losers: f(m.losers.rows), mostActive: m.active.rows.filter(r => r.price >= 5).slice(0, 10).map(r => ({ symbol: r.symbol, price: r.price, changePct: r.changePct, volume: r.volume })) }); } },
    earnings_info: { description: "A US stock's earnings record and setup from Nasdaq: next report date, consensus EPS with revisions, the last four surprises with the stock's two-day reaction to each, the average reaction, and the options-implied move into the report.", props: { ticker: { type: "string" } }, req: ["ticker"],
      label: (i) => "Earnings record for " + i.ticker,
      async run(app, S, i) { const sym = String(i.ticker || "").toUpperCase(); const m = await MD.earnings.measure(app, { id: "stock:" + sym, cls: "stock", symbol: sym, name: sym }); return rnd(m); } },
    economic_calendar: { description: "US economic releases for a date (default today): time (GMT), event, actual, consensus and previous, from Nasdaq's economic calendar.", props: { date: { type: "string", description: "YYYY-MM-DD" } }, req: [],
      label: (i) => "Economic calendar" + (i && i.date ? " " + i.date : ""),
      async run(app, S, i) { const d = i && /^\d{4}-\d{2}-\d{2}$/.test(i.date || "") ? i.date : new Date().toISOString().slice(0, 10); const rows = await D.calendar.economic(d); return { date: d, events: rows.filter(x => /United States|US/i.test(x.country || "")).slice(0, 25).map(x => ({ gmt: x.gmt, event: x.event, actual: x.actual || null, consensus: x.consensus || null, previous: x.previous || null })) }; } },
    compare_returns: { description: "Measured 1-year return, volatility, max drawdown and Sharpe ratio for up to 5 tickers or coins side by side (e.g. against SPY or SGOV as baselines).", props: { symbols: { type: "array", items: { type: "string" } } }, req: ["symbols"],
      label: (i) => "Compare " + (i.symbols || []).join(", "),
      async run(app, S, i) { const syms = (Array.isArray(i.symbols) ? i.symbols : []).slice(0, 5).map(String); return Promise.all(syms.map(async (s) => { try { const a = await findAsset(s); const hs = await D.historyFor(a, "1Y"); const st = C.seriesStats(hs.points, hs.ppy || 252); return rnd({ symbol: a.symbol, returnPct: st.changePct, volPct: st.volPct, maxDrawdownPct: st.maxDrawdownPct, sharpe: st.sharpe }); } catch (e) { return { symbol: s, error: U.errorText(e) }; } })); } },
    paper_account: { description: "The investor's paper-trading account (virtual money; nothing real is traded): cash, value and return against the same trades in the S&P 500, open positions, the latest closed trades, and closed trades grouped by where each idea came from (their own, Recommendations, AI decisions, the screener).", props: {}, req: [],
      label: () => "Paper account",
      async run(app) {
        if (!MD.paper) return { error: "Paper trading isn't available." };
        const st = await MD.paper.state(app), L = st.L, lbl = (ss) => (ss.length ? ss : ["manual"]).map(x => MD.paper.SOURCES[x] || x);
        return rnd({ startCash: st.a.startCash, cash: L.cash, value: st.v.equity, returnPct: st.v.returnPct, sameTradesInSP500Pct: st.v.mirrorReturnPct,
          open: L.positions.map(p => ({ symbol: p.symbol, quantity: p.qty, cost: p.cost, valueNow: st.prices[p.assetId] ? p.qty * st.prices[p.assetId] : null, from: lbl(p.sources) })),
          recentClosed: L.closed.slice(-10).map(t => ({ symbol: t.symbol, returnPct: t.pnlPct, sp500SameDaysPct: t.mirrorPct, opened: new Date(t.openedAt).toISOString().slice(0, 10), closed: new Date(t.closedAt).toISOString().slice(0, 10), from: lbl(t.sources) })),
          bySource: MD.paper.bySource(L).map(r => ({ source: MD.paper.SOURCES[r.source] || r.source, closed: r.closed, open: r.open, madeMoneyPct: r.winPct, avgReturnPct: r.avgPct, avgVsSP500Pts: r.vsPct })) });
      } },
    screen_stocks: { description: "Screen US-listed stocks on the NYSE and Nasdaq by exchange, sector and company size (Nasdaq's screener, largest first; it can lag a session), then by price and today's move. Returns how many matched and the largest matches with price, today's move and market cap.", props: { exchange: { type: "string", enum: ["both", "nyse", "nasdaq"] }, sector: { type: "string", enum: ["technology", "health_care", "finance", "consumer_discretionary", "consumer_staples", "industrials", "energy", "utilities", "real_estate", "basic_materials", "telecommunications"] }, size: { type: "string", enum: ["mega", "large", "mid", "small", "micro"] }, min_price: { type: "number" }, max_price: { type: "number" }, min_move_pct: { type: "number" }, max_move_pct: { type: "number" } }, req: [],
      label: (i) => "Stock screen" + (i.sector ? " · " + i.sector : "") + (i.exchange && i.exchange !== "both" ? " · " + i.exchange.toUpperCase() : "") + (i.size ? " · " + i.size : ""),
      async run(app, S, i) {
        const n = (v) => v == null || v === "" || !isFinite(Number(v)) ? null : Number(v);
        const r = await MD.screener.run({ exchange: i.exchange || "both", sector: i.sector || "", size: i.size || "", minPrice: n(i.min_price), maxPrice: n(i.max_price), minMove: n(i.min_move_pct), maxMove: n(i.max_move_pct), sort: "cap" });
        return rnd({ asOf: r.asOf, checked: r.scanned, matches: r.rows.length, largest: r.rows.slice(0, 15).map(x => ({ symbol: x.symbol, name: x.name, exchange: x.exchange, price: x.price, todayPct: x.changePct, marketCapB: x.marketCap ? x.marketCap / 1e9 : null })) });
      } },
    holdings_news_sentiment: { description: "The latest news-sentiment reading for the investor's holdings, if one has been made (Portfolio → News sentiment): per holding a score from -100 to +100, a label, a one-line summary and the top retrieved headline with its URL.", props: {}, req: [],
      label: () => "News sentiment for holdings",
      async run(app, S) {
        const d = MD.sentiment && MD.sentiment.latest(app);
        if (!d) return { note: "No reading yet. The investor can run one in Portfolio → News sentiment for your holdings." };
        for (const r of d.rows) if (r.top && r.top.url) S.add(r.top.url, r.top.title, "news");
        return { readAt: new Date(d.at).toISOString(), holdings: d.rows.map(r => ({ symbol: r.symbol, score: r.score, label: r.label, relevantHeadlines: r.relevant, summary: r.summary, topHeadline: r.top ? { title: r.top.title, url: r.top.url, published: r.top.ts ? new Date(r.top.ts).toISOString().slice(0, 10) : null } : null })) };
      } },
  };
  /* Tool router. The runtime caps how many tools one request may carry (limits().tools.maxCount), so each request
     gets the core tools, then the groups the question is about, then the rest in the caller's priority order.
     Betting tools ride along only when the question is about betting. */
  const INTENTS = [
    ["betting", /\b(bets?|betting|parlays?|spreads?|moneyline|wager|stake|sportsbooks?|nfl|nba|mlb|nhl|wnba|ncaa|premier league|la liga|serie a|bundesliga|ligue 1|soccer|football|basketball|baseball|hockey|games?|match|props?|touchdowns?|dolphins|chiefs|lakers)\b/i, ["get_betting_odds", "bet_math", "get_my_bets", "get_injuries", "get_scoreboard", "get_game_forecast", "build_slips", "add_to_slip", "get_slip", "get_ai_track_record"]],
    ["intraday", /day ?trad|intraday|scalp|vwap|opening range|\bgaps?\b|gapp|pre-?market|after-?hours|support|resistance|\bstop\b|\bentry\b|\blevels?\b|\bmovers?\b/i, ["intraday_levels", "movers", "economic_calendar", "explain_move"]],
    ["market", /market|macro|\bfed\b|\brates?\b|yields?|inflation|\bcpi\b|jobs|economy|recession|sectors?|regime|why .*(fell|drop|rose|rall|moved?|down|up)|what moved|driving/i, ["market_pulse", "market_memory", "explain_move", "economic_calendar"]],
    ["pattern", /when .* (rise|rises|fall|falls|jump|jumps|drop|drops|spike|spikes)|tends? to|usually|historically|correlat|backtest|does .* (follow|lead)|pattern/i, ["backtest_rule", "base_rates", "market_memory"]],
    ["odds", /chance|probab|likel|will .*(rise|fall|go|hit)|predict|forecast|upside|downside|expect|targets?|machine learning|\bml\b|model/i, ["base_rates", "ml_forecast", "price_range", "project_price", "options_move", "track_record"]],
    ["earnings", /earnings?|\beps\b|guidance|quarter|results/i, ["earnings_info", "options_move"]],
    ["smart", /congress|politic|senator|pelosi|buffett|insiders?|13f|superinvestor|smart money|hedge fund/i, ["smart_money", "insider_activity"]],
    ["options", /options?|implied|straddle|volatil/i, ["options_move", "price_range"]],
    ["portfolio", /portfolio|holdings?|diversif|allocat|rebalanc|my (stocks|positions)|concentrat/i, ["get_portfolio_context", "analyze_portfolio", "my_portfolio", "compare_alternatives", "compare_returns"]],
    ["buying", /should i (buy|add|get into)|buy more|add (to|more)|position size|how much (should|to) (buy|put|invest)|(fit|fits) (in|into|with) my/i, ["portfolio_fit", "base_rates"]],
    ["paper", /paper|virtual|practi[cs]e|simulat|fake money|play money/i, ["paper_account"]],
    ["screen", /screen|scanner|find (me )?(some )?(stocks|names|companies)|\bnyse\b|\bnasdaq\b|small[- ]caps?|mid[- ]caps?|large[- ]caps?|mega[- ]caps?|sector/i, ["screen_stocks"]],
    ["news", /news|headlines?|sentiment|what('s| is) (happening|going on) with my/i, ["holdings_news_sentiment", "search_news"]],
    ["calls", /open calls|your (calls|picks|recommendations)|track record|how (are|is) (the|your) (calls|picks|recommendations)|still (right|on track)/i, ["open_calls", "track_record"]]];
  function selectTools(tools, text, max, core) {
    max = max || 20; text = String(text || "");
    const by = new Map(tools.map(t => [t.name, t])), out = [], add = (n) => { const t = by.get(n); if (t && !out.includes(t) && out.length < max) out.push(t); };
    (core || []).forEach(add);
    for (const [, re, names] of INTENTS) if (re.test(text)) names.forEach(add);
    const betting = new Set(INTENTS[0][2]), wantsBets = INTENTS[0][1].test(text);
    for (const t of tools) if (wantsBets || !betting.has(t.name)) add(t.name);
    return out;
  }
  const intentsOf = (text) => INTENTS.filter(([, re]) => re.test(String(text || ""))).map(([n]) => n);
  // The runtime's tool cap for one request (20 when it doesn't say).
  async function toolCap(app) { const lim = app.caps.sample && app.caps.sample.limits ? await app.caps.sample.limits().catch(() => null) : null; return (lim && lim.tools && lim.tools.maxCount) || 20; }

  /* Base rates and the direction model for one asset over `days` calendar days, plus volatility-based move odds. */
  async function baseRatesFor(a, days) {
    const Q = MD.quant, hs = await D.dailyLong(a), ppy = hs.ppy || (a.cls === "crypto" ? 365 : 252);
    const bars = Q.barsFor(days, ppy), br = Q.baseRates(hs.points, bars, { ppy });
    if (!br) throw new Error("Not enough history for " + a.symbol + " over " + days + " days.");
    const yr = hs.points.slice(-Math.round(ppy)), st = C.seriesStats(yr, ppy), model = Q.directionModel(br);
    return { symbol: a.symbol, days, bars, history: { source: hs.source, from: iso(hs.points[0].time), to: iso(hs.points[hs.points.length - 1].time), points: hs.points.length },
      overall: br.overall, conditions: br.conditions, now: br.now, model, volPct: st.volPct, chanceOfMoveOver10Pct: Q.bigMoveChance(st.volPct, days, 10), chanceOfMoveOver20Pct: Q.bigMoveChance(st.volPct, days, 20),
      note: "Up/down rates count every overlapping " + bars + "-bar window; 'independent' is the honest sample size. The model shrinks toward 50% when evidence is thin and never goes beyond 25–75% on history alone." };
  }
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
    const fcs = app.store.cached("forecasts").filter(f => !source || (f.source || "user") === source), evals = app.store.cached("evals");
    const scored = fcs.map(f => { const e = evals.find(v => v.forecastId === f.id); return e ? { p: Number(f.probability) || 0.5, hit: !!e.directionHit } : null; }).filter(Boolean);
    const buckets = [[0.5, 0.6], [0.6, 0.7], [0.7, 1.01]].map(([lo, hi]) => { const xs = scored.filter(x => x.p >= lo && x.p < hi); return { range: Math.round(lo * 100) + "–" + Math.min(100, Math.round(hi * 100)) + "%", n: xs.length, hitPct: xs.length ? xs.filter(x => x.hit).length / xs.length * 100 : null }; });
    const n = scored.length, hits = scored.filter(x => x.hit).length;
    const brier = n ? scored.reduce((s, x) => s + Math.pow(x.p - (x.hit ? 1 : 0), 2), 0) / n : null;
    const L = latestLessons(app), label = source && SOURCE_LABEL[source];
    const lessons = L ? { at: L.createdAt, items: L.lessons.filter(l => !l.appliesTo || l.appliesTo === "all" || !label || l.appliesTo === label).map(l => l.lesson) } : null;
    return { logged: fcs.length, scored: n, hitPct: n ? hits / n * 100 : null, brier, buckets, lessons };
  }
  /* Automatic calibration: once a source has 10+ scored calls, an up-probability is corrected toward how often calls
     stated at that level actually came true (MD.quant.calibrateFrom). It never flips the direction. */
  function calibrateUp(app, source, upPct) {
    const fcs = app.store.cached("forecasts").filter(f => f.source === source), evals = app.store.cached("evals");
    const items = fcs.map(f => { const e = evals.find(v => v.forecastId === f.id); return e ? { p: Number(f.probability) || 0.5, hit: !!e.directionHit } : null; }).filter(Boolean);
    if (items.length < 10) return { upPct, applied: false, scored: items.length };
    const fav = Math.max(upPct, 100 - upPct) / 100, c = MD.quant.calibrateFrom(items, fav);
    if (!c.applied) return { upPct, applied: false, scored: items.length };
    const adj = Math.max(50, c.p * 100);
    return { upPct: Math.round(upPct >= 50 ? adj : 100 - adj), from: Math.round(upPct), applied: true, scored: items.length, observedPct: Math.round(c.observed * 100), weight: c.n };
  }
  /* The weight on Claude vs the measured history for one source, learned from graded calls that stored both
     probabilities (10+ needed; until then the default 65/35). */
  function blendFor(app, source) {
    const evals = app.store.cached("evals");
    const items = app.store.cached("forecasts").filter(f => f.source === source && f.claudeUpPct != null && f.modelUpPct != null).map(f => { const e = evals.find(v => v.forecastId === f.id); return e && e.realizedReturnPct != null ? { claude: f.claudeUpPct, model: f.modelUpPct, up: Number(e.realizedReturnPct) > 0 } : null; }).filter(Boolean);
    if (items.length < 10) return { wClaude: 0.65, learned: false, n: items.length };
    return Object.assign(MD.quant.blendWeights(items), { learned: true });
  }
  /* The learned combiner for one source (MD.ml.stacker over graded calls that logged their inputs). */
  function stackFor(app, source) {
    const evals = app.store.cached("evals");
    const items = app.store.cached("forecasts").filter(f => f.source === source && f.claudeUpPct != null && f.modelUpPct != null).sort((a, b) => a.createdAt - b.createdAt).map(f => {
      const e = evals.find(v => v.forecastId === f.id); if (!e || e.realizedReturnPct == null) return null;
      const final = f.upProbability != null ? f.upProbability * 100 : f.direction === "up" ? f.probability * 100 : f.direction === "down" ? 100 - f.probability * 100 : null;
      return { c: f.claudeUpPct, m: f.modelUpPct, r: f.reviewerUpPct ?? null, ml: f.mlUpPct ?? null, final, up: Number(e.realizedReturnPct) > 0 };
    }).filter(Boolean);
    return MD.ml.stacker(items);
  }
  function calibrationNote(tr) {
    const learned = tr && tr.lessons && tr.lessons.items.length ? " Lessons you wrote on " + new Date(tr.lessons.at).toISOString().slice(0, 10) + " after studying your scored calls; apply them: " + tr.lessons.items.join(" ") : "";
    if (!tr || tr.scored < 5) return "Track record: fewer than 5 of your past calls have been scored, so there is no calibration evidence yet; keep stated probabilities modest." + learned;
    return "Track record of your past calls of this kind: " + tr.scored + " scored, " + tr.hitPct.toFixed(0) + "% came true (Brier " + tr.brier.toFixed(3) + "). By stated probability: " + tr.buckets.filter(b => b.n).map(b => b.range + ": " + b.hitPct.toFixed(0) + "% of " + b.n).join("; ") + ". If calls at a stated level came true less often than stated, state lower probabilities this time." + learned;
  }

  /* ---------- lessons from the record ---------- */
  /* Claude studies its own scored calls (what it said, how sure, why, and what happened) and writes lessons.
     The latest lessons ride along with every track-record note, so outcomes feed back into later prompts. */
  const latestLessons = (app) => app.store.cached("ailessons").slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null;
  function scoredCalls(app) {
    const evals = app.store.cached("evals");
    return app.store.cached("forecasts").map(f => { const e = evals.find(v => v.forecastId === f.id); return e ? { symbol: f.symbol, by: SOURCE_LABEL[f.source] || f.source || "user", madeOn: f.createdAt ? new Date(f.createdAt).toISOString().slice(0, 10) : null, horizonDays: f.horizonDays, predicted: f.direction === "move" ? "a move of " + f.movePct + "%+ either way" : f.direction, statedProbabilityPct: f.probability != null ? Math.round(f.probability * 100) : null, thesis: String(f.thesis || "").slice(0, 300), priceAtCall: f.priceAtCreation, priceAtDue: e.priceAtDue, returnPct: e.realizedReturnPct != null ? +Number(e.realizedReturnPct).toFixed(1) : null, cameTrue: !!e.directionHit } : null; })
      .filter(Boolean).sort((a, b) => String(b.madeOn).localeCompare(String(a.madeOn))).slice(0, 60);
  }
  async function learn(app, opts = {}) {
    const s = app.caps.sample; if (!s) throw Object.assign(new Error(ERR.no_sample), { code: "no_sample" });
    const calls = scoredCalls(app), tr = trackRecord(app), prev = latestLessons(app);
    if (calls.length < 5) throw new Error("At least 5 scored forecasts are needed; " + calls.length + " so far.");
    const r = await s.json(`You are reviewing your own track record as Market Desk's market analyst, to get better at forecasting. Below are your past forecasts that were scored against the actual close on their due date: what you predicted, the probability you stated, your thesis at the time, and what happened. Overall: ${tr.scored} scored, ${tr.hitPct.toFixed(0)}% came true, Brier ${tr.brier.toFixed(3)} (0.25 is what always saying 50% earns).
Find the patterns behind the misses and the hits: overconfidence at some stated levels, directions or kinds of asset you get wrong, horizons that don't work, kinds of thesis that failed (momentum, valuation, news, analyst ratings). Every lesson must be supported by specific calls in the list (name their symbols); with few calls, say the evidence is thin instead of over-generalising. Do not invent calls, prices or outcomes.${prev ? " Your previous lessons were: " + prev.lessons.map(l => l.lesson).join(" | ") + ". Keep the ones the record still supports and drop the rest." : ""}
Scored calls: ${JSON.stringify(calls)}
Reply with ONLY JSON: {"summary": "two sentences: how good the calls have been and the main weakness", "lessons": [{"lesson": "one-sentence instruction to your future self", "evidence": "the calls that show it, by symbol", "appliesTo": "all"|"Recommendations"|"AI quick takes"|"Deep Research"|"Day-trade plans"|"Market calls"|"AI decisions"}], "biases": ["short names of systematic biases seen"], "keepDoing": ["what worked"]}`, { modelTier: "complex", signal: opts.signal, cache: false });
    const strs = (xs, n) => (Array.isArray(xs) ? xs : []).slice(0, n).map(x => String(x).slice(0, 200));
    const doc = { basedOn: calls.length, hitPct: tr.hitPct, brier: tr.brier, summary: String(r.summary || "").slice(0, 600), biases: strs(r.biases, 5), keepDoing: strs(r.keepDoing, 4),
      lessons: (Array.isArray(r.lessons) ? r.lessons : []).filter(l => l && l.lesson).slice(0, 6).map(l => ({ lesson: String(l.lesson).slice(0, 300), evidence: String(l.evidence || "").slice(0, 300), appliesTo: Object.values(SOURCE_LABEL).includes(l.appliesTo) ? l.appliesTo : "all" })) };
    if (!doc.lessons.length) throw new Error("The review came back without lessons; try again.");
    return app.store.create("ailessons", doc);
  }
  function lessonsPanel(app) {
    const box = h("div", { class: "stack" }), scored = scoredCalls(app).length;
    const paint = (d) => box.replaceChildren(d ? h("div", { class: "stack", style: "gap:8px" }, d.summary ? h("p", { class: "small" }, d.summary) : null,
      list("Lessons (told to every AI that forecasts)", d.lessons.map(l => l.lesson + (l.appliesTo !== "all" ? " [" + l.appliesTo + "]" : "") + (l.evidence ? " — " + l.evidence : ""))),
      list("Biases seen", d.biases), list("Keep doing", d.keepDoing),
      h("p", { class: "tiny muted" }, "Written " + new Date(d.createdAt).toLocaleDateString() + " from " + d.basedOn + " scored calls" + (scored > d.basedOn ? "; " + (scored - d.basedOn) + " more scored since" : "") + "."))
      : h("p", { class: "small muted" }, scored < 5 ? "Once 5 forecasts are scored (" + scored + " so far), the AI can study its hits and misses and write lessons that every later forecast is told." : "The AI hasn't studied its record yet."));
    paint(latestLessons(app));
    const btn = h("button", { class: "btn ghost sm", type: "button", disabled: scored < 5 || !app.caps.sample, onclick: async () => {
      btn.disabled = true; btn.textContent = "Studying the record…";
      try { paint(await learn(app)); } catch (e) { box.append(U.errorBox({ message: errText(e) })); }
      btn.disabled = false; btn.textContent = "Study the record again";
    } }, latestLessons(app) ? "Study the record again" : "Study the misses and write lessons");
    return h("div", { class: "stack" }, h("div", { class: "row between", style: "flex-wrap:wrap;gap:8px" }, h("span", { class: "label" }, "What the AI learned from its record"), btn), box);
  }

  // The investor profile from Settings, told to every AI feature so its judgements fit this person.
  const RISK = { low: "conservative (protect capital first)", mid: "balanced", high: "aggressive (accepts large drawdowns)" }, HZ = { short: "under a year", mid: "1–3 years", long: "5+ years" };
  // Investor profile plus what the Market Brain has learned, for every AI prompt on the desk.
  function contextNote(app) { const m = MD.brain ? MD.brain.note(app) : ""; return profileNote(app) + (m ? "\n" + m : ""); }
  function profileNote(app) {
    const p = (app.settings && app.settings.profile) || {};
    return (app.settings && app.settings.plainEnglish ? "Write for a newer investor: plain, short sentences; explain any finance term the first time you use it (e.g. 'RSI, a measure of how stretched recent moves are'). Keep every number. " : "") + "Investor profile (set by the user in Settings; respect it): risk appetite " + (RISK[p.risk] || RISK.mid) + "; typical holding period " + (HZ[p.horizon] || HZ.mid) + (p.income ? "; wants income (dividends)" : "") + (p.goals ? "; goals: " + String(p.goals).slice(0, 300) : "") + (p.avoid ? "; avoid: " + String(p.avoid).slice(0, 200) : "") + "; experience: " + ((app.settings && app.settings.mode) || "intermediate") + ".";
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
          const after = s.points.find(p => Math.floor(p.time / 86400) >= dueDay);
          // Wait for the due day's close; fall back to the last close before it only once the date is well past
          // (a weekend or holiday due date), never for same-day and next-day calls.
          if (!after && (Date.now() - f.dueAt < 3 * 864e5 || (f.horizonDays || 0) <= 2)) continue;
          const pt = after || s.points[s.points.length - 1];
          if (Math.floor(pt.time / 86400) < dueDay - 4) continue;
          const price = pt.close ?? pt.value, ev = C.evaluateForecast(f, price);
          if (ev && !app.store.cached("evals").some(e => e.forecastId === f.id)) { await app.store.create("evals", Object.assign({ forecastId: f.id, evaluatedAt: Date.now(), priceAtDue: price, priceDate: iso(pt.time), priceSource: s.source, probability: f.probability, source: f.source }, ev)); n++; }
        } catch (e) { failed.push({ symbol: f.symbol, error: U.errorText(e) }); }
      }
      return { scored: n, failed, due: due.length };
    })().finally(() => { scoring = null; });
    return scoring;
  }
  const SOURCE_LABEL = { "ai-picks": "Recommendations", "ai-take": "AI quick takes", "ai-day": "Day-trade plans", "ai-market": "Market calls", "ai-decide": "AI decisions", ml: "Machine-learning model", ai: "Deep Research", user: "Your own forecasts" };
  /* Per-source accuracy and a calibration chart: for each stated-probability band, how often calls came true. */
  /* What following a source's up/down calls would have returned on average (a "down" call counts as a short), and
     the S&P 500 over the same windows for comparison. */
  function followed(app, source) {
    const evals = app.store.cached("evals");
    return app.store.cached("forecasts").filter(f => (f.source || "user") === source && (f.direction === "up" || f.direction === "down")).map(f => { const e = evals.find(v => v.forecastId === f.id); return e && e.realizedReturnPct != null ? { from: f.createdAt, to: f.dueAt, pct: (f.direction === "up" ? 1 : -1) * Number(e.realizedReturnPct) } : null; }).filter(Boolean);
  }
  // The S&P 500's return over each window {from, to} (ms), or null where the history doesn't cover it.
  async function spyEach(windows) {
    const hs = await D.historyCached({ id: "etf:SPY", cls: "etf", symbol: "SPY", name: "SPY" }, "5Y"), pts = hs.points;
    const at = (ms) => { let v = null; for (const p of pts) { if (p.time * 1000 <= ms) v = p.close ?? p.value; else break; } return v; };
    return windows.map(w => { const a = at(w.from), b = at(w.to); return a && b ? (b / a - 1) * 100 : null; });
  }
  async function spyOver(windows) {
    const rets = (await spyEach(windows)).filter(x => x != null);
    return rets.length ? rets.reduce((s, x) => s + x, 0) / rets.length : null;
  }
  function scorecard(app) {
    const fcs = app.store.cached("forecasts"), evals = app.store.cached("evals");
    const srcs = [...new Set(fcs.map(f => f.source || "user"))];
    const rows = srcs.map(s => { const fw = followed(app, s); return Object.assign({ source: s, label: SOURCE_LABEL[s] || s, followedPct: fw.length ? fw.reduce((t, x) => t + x.pct, 0) / fw.length : null, followedN: fw.length, windows: fw }, trackRecord(app, s === "user" ? "user" : s)); }).filter(r => r.logged);
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
      rows.length ? U.table([{ t: "Source", v: "label" }, { t: "Logged", v: (r) => String(r.logged), n: true }, { t: "Scored", v: (r) => String(r.scored), n: true }, { t: "Came true", v: (r) => r.hitPct != null ? r.hitPct.toFixed(0) + "%" : "—", n: true }, { t: "Brier (lower is better)", v: (r) => r.brier != null ? r.brier.toFixed(3) : "—", n: true }, { t: "If followed (avg)", v: (r) => r.followedPct == null ? "—" : h("span", { class: r.followedPct > 0 ? "up" : r.followedPct < 0 ? "down" : "", title: "Average return of its up/down calls if each had been acted on (down calls as shorts), " + r.followedN + " calls" }, (r.followedPct > 0 ? "+" : "") + r.followedPct.toFixed(2) + "%"), n: true }, { t: "Claude vs history", v: (r) => { const bw = blendFor(app, r.source); return bw.learned ? h("span", { title: "Brier on " + bw.n + " graded calls: Claude " + bw.brierClaude.toFixed(3) + ", history " + bw.brierModel.toFixed(3) + " (lower is better)" }, "blend " + Math.round(bw.wClaude * 100) + "/" + Math.round(100 - bw.wClaude * 100)) : h("span", { class: "muted" }, bw.n ? bw.n + "/10 graded" : "—"); } }, { t: "S&P 500 same windows", v: (r) => { if (!r.windows.length) return "—"; const el = h("span", { class: "num muted" }, "…"); spyOver(r.windows).then(v => { el.textContent = v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(2) + "%"; }, () => { el.textContent = "—"; }); return el; }, n: true }, { t: "By stated probability", v: (r) => r.buckets.filter(b => b.n).map(b => b.range + ": " + b.hitPct.toFixed(0) + "% of " + b.n).join(" · ") || "—" }], rows) : h("div", { class: "empty" }, "No forecasts logged yet."),
      all.scored ? h("div", { class: "row", style: "gap:16px;flex-wrap:wrap;align-items:center" }, h("div", { html: svg, style: "color:var(--muted);flex:1 1 260px;min-width:0" }), h("p", { class: "small muted", style: "flex:1 1 220px" }, "Each dot is a band of stated probability; its height is how often those calls came true. Dots below the dashed line mean the AI was overconfident in that band. Every AI that logs forecasts is told this record and asked to calibrate.")) : null,
      lessonsPanel(app), howItDecides(app),
      h("p", { class: "tiny muted" }, "Due forecasts are scored automatically while the page is open, from the close on their due date. A Brier score of 0.25 is what always saying 50% would earn."));
  }

  /* How a probability on the desk is made, with the live state of each step: what has been studied and learned, and,
     per feature, how much its odds lean on Claude versus measured history and whether calibration has started. */
  const BLENDED = new Set(["ai-picks", "ai-decide", "ai-market"]), CALIBRATED = new Set(["ai-picks", "ai-decide", "ai-market", "ai-day", "ml"]);
  function howItDecides(app) {
    const days = MD.brain ? MD.brain.latestPerDay(app).length : 0, pb = MD.brain ? MD.brain.playbook(app) : { patterns: [] }, active = pb.patterns.filter(p => p.status === "active").length;
    const L = latestLessons(app), W = MD.brain && MD.brain.reviews ? MD.brain.reviews(app)[0] : null;
    const rows = ["ai-picks", "ai-decide", "ai-market", "ai-day", "ai-take", "ml", "ai"].map(s => {
      const tr = trackRecord(app, s), bw = BLENDED.has(s) ? blendFor(app, s) : null, cal = CALIBRATED.has(s) ? calibrateUp(app, s, 60) : null;
      return { s, label: SOURCE_LABEL[s], tr, bw, cal };
    });
    const step = (title, text) => h("li", {}, h("strong", {}, title + ". "), text);
    return h("details", { class: "howai" }, h("summary", { class: "label", style: "cursor:pointer" }, "How the desk's AI decides"),
      h("ol", { class: "small", style: "margin:8px 0 0;padding-left:1.3em;display:grid;gap:6px" },
        step("Measure", "The page computes the numbers first: prices, the asset's own base rate (how often it was higher over the same horizon in situations like today's), options-implied moves, volatility, Zacks, insiders, smart money and what moved it (market, sector, rates, dollar, oil)."),
        step("Machine learning", "A logistic-regression model, gradient-boosted decision trees and a nearest-neighbour model of similar past days are trained in the browser on the asset's history and tested walk-forward on years they hadn't seen. Their odds count only as far as they beat the base rate out of sample; the AI is told both the odds and that record."),
        step("Research", "Claude investigates with tools (news, web pages, earnings, options, filings) and reasons over what they return. Citations are checked against the pages actually retrieved; unverified ones are flagged."),
        step("Context", "Every prompt carries your investor profile, the Market Brain (" + days + " session" + (days === 1 ? "" : "s") + " studied, " + active + " active pattern" + (active === 1 ? "" : "s") + ")" + (W ? ", the weekly review of " + W.week : "") + ", the desk's past calls on the asset and the latest lessons" + (L ? " (" + U.fmtDate(L.createdAt) + ")" : " (none yet)") + "."),
        step("Review", "A second, sceptical reader checks each call against the measured data and sources, keeps, revises or drops it, and gives its own probability, which is averaged in."),
        step("Blend", "Claude's probability is blended with the measured history. The weights start at 65% Claude / 35% history and are learned from each feature's graded calls (whichever has been more accurate gets more weight)."),
        step("Specialist panel", "Three more analysts (fundamentals, quant, news and macro) estimate the same odds independently with their own tools; the lead analyst and the panel count equally, wide disagreement lowers confidence, and evidence without a measured figure or a retrieved source is dropped. A conflict of more than 20 points with the measured history must be justified or the gap is halved."),
        step("Calibrate", "Once a feature has 10 graded calls, stated odds are pulled toward how often calls at that level actually came true. After 30, a learned combiner (stacking) weighs Claude, the reviewer, the history and the ML model by how each has actually done, and takes over if it beats the fixed blend on the most recent calls."),
        step("Log, grade, monitor", "Every call is logged with its price and graded from the close on its due date. Open calls are priced every two hours and you're told when one turns."),
        step("Learn", "After 10 more graded calls Claude re-studies the record and writes lessons; the weekly review adds what the week taught. Both reach every forecasting prompt.")),
      U.table([{ t: "Feature", v: (r) => r.label }, { t: "Graded", v: (r) => String(r.tr.scored), n: true }, { t: "Came true", v: (r) => r.tr.hitPct != null ? r.tr.hitPct.toFixed(0) + "%" : "—", n: true },
        { t: "Weight on Claude", v: (r) => !r.bw ? "—" : Math.round(r.bw.wClaude * 100) + "% " + (r.bw.learned ? "(learned)" : "(default; learns at 10, " + r.bw.n + " so far)") },
        { t: "Learned combiner", v: (r) => { if (!BLENDED.has(r.s)) return "—"; const st = stackFor(app, r.s); return st.used ? "active (" + st.n + " graded)" : st.n >= 30 ? "checked; fixed blend still better" : "starts at 30 (" + st.n + " so far)"; } },
        { t: "Calibration", v: (r) => !r.cal ? "—" : r.cal.applied ? "active (" + r.cal.scored + " graded)" : r.cal.scored >= 10 ? "checked; no correction needed" : "starts at 10 (" + r.cal.scored + " so far)" }], rows),
      h("p", { class: "tiny muted" }, "Read-only throughout: the desk never trades or bets. Numbers come from the page's own measurements; Claude never supplies prices."));
  }

  /* ---------- per-asset memory ---------- */
  /* Everything the desk's AI has said about one asset (every logged call from any feature, re-checks of picks, and
     the Market Brain's notes on its moves) and how each call turned out. */
  function assetMemory(app, asset) {
    const sym = String(asset.symbol || "").toUpperCase(), id = asset.id, evals = app.store.cached("evals");
    const calls = app.store.cached("forecasts").filter(f => f.assetId === id || (sym && String(f.symbol || "").toUpperCase() === sym)).map(f => {
      const e = evals.find(v => v.forecastId === f.id);
      return { at: f.createdAt, source: f.source || "user", label: SOURCE_LABEL[f.source] || f.source || "Your own forecasts", direction: f.direction, probabilityPct: f.probability != null ? Math.round(f.probability * 100) : null, horizonDays: f.horizonDays, dueAt: f.dueAt, priceThen: f.priceAtCreation, thesis: String(f.thesis || "").slice(0, 220), result: e ? { hit: !!e.directionHit, returnPct: e.realizedReturnPct, priceAtDue: e.priceAtDue } : null };
    }).sort((a, b) => (b.at || 0) - (a.at || 0));
    const graded = calls.filter(c => c.result), right = graded.filter(c => c.result.hit).length;
    const mentions = (MD.brain ? MD.brain.latestPerDay(app) : []).flatMap(d => (d.movers || []).filter(m => String(m.symbol || "").toUpperCase() === sym).map(m => ({ date: d.sessionDate, movePct: m.movePct, why: m.why }))).slice(0, 6);
    const checks = app.store.cached("pickchecks").filter(c => String(c.symbol).toUpperCase() === sym).sort((a, b) => b.at - a.at).slice(0, 3);
    return { symbol: sym, calls, graded: graded.length, right, hitPct: graded.length ? right / graded.length * 100 : null, mentions, checks };
  }
  const callText = (c) => new Date(c.at || 0).toISOString().slice(0, 10) + " " + c.label + ": " + (c.direction === "move" ? "big move" : c.direction) + (c.probabilityPct != null ? " " + c.probabilityPct + "%" : "") + " → " + (c.result ? (c.result.hit ? "right" : "wrong") + (c.result.returnPct != null ? " (" + (c.result.returnPct > 0 ? "+" : "") + Number(c.result.returnPct).toFixed(1) + "%)" : "") : "pending");
  // For prompts about this asset: its record with the desk and what the Market Brain saw.
  function assetNote(app, asset) {
    const m = assetMemory(app, asset); if (!m.calls.length && !m.mentions.length) return "";
    return ("The desk's past AI calls on " + m.symbol + ": " + m.calls.length + " logged" + (m.graded ? ", " + m.graded + " graded, " + m.right + " right" : "") + (m.calls.length ? ". Latest: " + m.calls.slice(0, 5).map(callText).join("; ") : "") + "." +
      (m.mentions.length ? " Market Brain notes on its moves: " + m.mentions.slice(0, 3).map(x => x.date + " " + (x.movePct > 0 ? "+" : "") + x.movePct + "%: " + x.why).join("; ") + "." : "") +
      (m.checks.length ? " Latest re-check of a pick: " + m.checks[0].status + " (" + m.checks[0].whatChanged.slice(0, 160) + ")." : "") +
      " Learn from the misses; don't repeat a thesis that failed without new evidence.").slice(0, 1400);
  }
  function memoryCard(app, asset) {
    const m = assetMemory(app, asset), body = h("div", { class: "stack" });
    const sec = U.section("AI memory: what the desk has said about " + (asset.symbol || asset.name), body); sec.id = "sec-memory";
    if (!m.calls.length && !m.mentions.length) { body.append(h("p", { class: "small muted" }, "No AI calls on " + (asset.symbol || asset.name) + " yet. Quick takes, recommendations, day-trade plans and research on it are listed here with how they turned out, and every AI that looks at it again is told this record.")); return sec; }
    body.append(h("p", { class: "small" }, m.calls.length + " call" + (m.calls.length > 1 ? "s" : "") + " logged" + (m.graded ? " · " + m.graded + " graded · " + m.right + " right (" + m.hitPct.toFixed(0) + "%)" : " · none graded yet") + ". Every AI that looks at " + m.symbol + " again is told this record."),
      m.calls.length ? U.table([{ t: "When", v: (c) => U.fmtDate(c.at) }, { t: "From", v: "label" }, { t: "Call", v: (c) => (c.direction === "up" ? "▲ up" : c.direction === "down" ? "▼ down" : c.direction === "move" ? "↕ big move" : c.direction) + (c.probabilityPct != null ? " " + c.probabilityPct + "%" : "") + (c.horizonDays ? " · " + c.horizonDays + "d" : "") }, { t: "Price then", v: (c) => c.priceThen ? C.fmtNum(c.priceThen, c.priceThen >= 1 ? 2 : 6) : "—", n: true },
        { t: "Result", v: (c) => c.result ? h("span", { class: c.result.hit ? "up" : "down" }, (c.result.hit ? "Right" : "Wrong") + (c.result.returnPct != null ? " · " + U.pct(c.result.returnPct) : "")) : h("span", { class: "muted" }, c.dueAt > Date.now() ? "due " + U.fmtDate(c.dueAt) : "awaiting grade") }], m.calls.slice(0, 12)) : null,
      m.mentions.length ? MD.ai.list("Market Brain notes on its moves", m.mentions.map(x => x.date + " · " + (x.movePct > 0 ? "+" : "") + x.movePct + "%: " + x.why)) : null);
    return sec;
  }

  /* ---------- open-call monitor ---------- */
  // Every open up/down call with a horizon over two days, priced now: the move since the call, that move against the
  // asset's own volatility for the time elapsed, and the chance it still finishes on the called side (geometry only).
  let lastOpen = null;
  async function openCalls(app, opts = {}) {
    const done = new Set(app.store.cached("evals").map(e => e.forecastId)), now = Date.now();
    const open = app.store.cached("forecasts").filter(f => f.asset && Number(f.priceAtCreation) > 0 && (f.direction === "up" || f.direction === "down") && !done.has(f.id) && f.dueAt > now && (f.horizonDays || 0) > 2)
      .sort((a, b) => a.dueAt - b.dueAt).slice(0, opts.max || 20);
    const assets = new Map(open.map(f => [f.asset.id || f.assetId, f.asset]));
    const priced = new Map(await Promise.all([...assets].map(async ([id, a]) => {
      try {
        const q = await D.quoteFor(a); let vol = null;
        try { const s = await D.historyCached(a, "1Y"), r = C.returnsFrom(s.points.slice(-61).map(p => p.close ?? p.value)); vol = r.length > 10 ? C.stdev(r) * 100 : null; } catch {}
        return [id, { price: Number(q.price), vol, source: q.source }];
      } catch (e) { return [id, { error: U.errorText(e) }]; }
    })));
    const rows = open.map(f => {
      const q = priced.get(f.asset.id || f.assetId) || {}; if (!(q.price > 0)) return { f, error: q.error || "no price" };
      const perDay = (f.asset.cls || String(f.asset.id).split(":")[0]) === "crypto" ? 1 : 252 / 365;
      const st = q.vol ? MD.quant.callStanding({ direction: f.direction, p0: f.priceAtCreation, price: q.price, bandPct: f.flatBandPct ?? 1, dailyVolPct: q.vol, barsElapsed: (now - f.createdAt) / 864e5 * perDay, barsLeft: (f.dueAt - now) / 864e5 * perDay }) : null;
      return { f, price: q.price, source: q.source, vol: q.vol, st, movePct: (q.price / Number(f.priceAtCreation) - 1) * 100 };
    });
    lastOpen = { at: now, rows };
    return rows;
  }
  /* Tells the inbox once per call when one turns clearly against its call or clearly in its favour. */
  async function monitorCalls(app, opts = {}) {
    const rows = await openCalls(app, opts), seen = new Set(app.store.cached("callwatch").map(d => d.id)), sent = [];
    for (const r of rows) {
      if (!r.st) continue;
      const f = r.f, o = r.st.oddsNowPct, kind = o <= 25 && r.st.zFor <= -1 ? "against" : o >= 85 && r.st.zFor >= 1.5 ? "working" : null;
      if (!kind || seen.has(f.id + ":" + kind)) continue;
      await app.store.create("callwatch", { id: f.id + ":" + kind, forecastId: f.id, kind, at: Date.now(), oddsNowPct: o, movePct: r.movePct });
      const word = f.direction === "up" ? "higher" : "lower", label = SOURCE_LABEL[f.source] || f.source || "Forecast";
      await app.store.create("inbox", { kind: "calls", assetId: f.asset.id, title: f.symbol + " (" + label + ") is " + (kind === "against" ? "going against the call" : "working"),
        body: "Called " + word + " on " + U.fmtDate(f.createdAt) + (f.probability ? " at " + Math.round(f.probability * 100) + "%" : "") + "; " + (r.movePct >= 0 ? "+" : "") + r.movePct.toFixed(1) + "% since. On its volatility alone it now has a " + Math.round(o) + "% chance to finish " + word + " by " + U.fmtDate(f.dueAt) + ". Measured position, not new research. Source: " + (r.source || "latest quote") + ".",
        materiality: kind === "against" ? 2 : 1, read: false, at: Date.now() }).catch(() => {});
      sent.push({ symbol: f.symbol, kind });
    }
    return { rows, sent };
  }
  function openCallsTable(app, rows) {
    const pc = (v) => v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
    return U.table([
      { t: "Asset", v: (r) => h("a", { href: "#", onclick: (e) => { e.preventDefault(); app.openAsset(r.f.asset); } }, r.f.symbol) },
      { t: "From", v: (r) => SOURCE_LABEL[r.f.source] || r.f.source || "—" },
      { t: "Call", v: (r) => h("span", { style: "white-space:nowrap" }, (r.f.direction === "up" ? "▲ " : "▼ ") + (r.f.probability ? Math.round(r.f.probability * 100) + "%" : r.f.direction)) },
      { t: "Since", v: (r) => r.error ? h("span", { class: "muted" }, r.error) : h("span", { class: (r.movePct >= 0) === (r.f.direction === "up") ? "pos" : "neg" }, pc(r.movePct)), n: true },
      { t: "Odds now", v: (r) => r.st ? h("span", { class: r.st.oddsNowPct >= 50 ? "pos" : "neg", title: "Chance it finishes " + (r.f.direction === "up" ? "higher" : "lower") + " than the call price (beyond the flat band) by the due date, from its volatility alone" }, Math.round(r.st.oddsNowPct) + "%") : "—", n: true },
      { t: "Due", v: (r) => h("span", { style: "white-space:nowrap" }, U.fmtDate(r.f.dueAt)) }], rows);
  }

  /* ---------- dashboard: what the AI is tracking ---------- */
  function statusCard(box, app) {
    const fcs = app.store.cached("forecasts").filter(f => f.source && f.source !== "user"), evals = app.store.cached("evals"), now = Date.now();
    const open = fcs.filter(f => !evals.some(e => e.forecastId === f.id) && f.dueAt > now - 3 * 864e5);
    const by = {}; for (const f of open) (by[f.source] = by[f.source] || []).push(f);
    const week = fcs.map(f => ({ f, e: evals.find(v => v.forecastId === f.id) })).filter(x => x.e && x.e.evaluatedAt > now - 7 * 864e5);
    const L = latestLessons(app), call = MD.brain ? MD.brain.latestCall(app) : null;
    const callsBox = h("div", { class: "stack", style: "gap:6px" }), watchBox = h("input", { type: "checkbox", checked: app.settings.callWatch !== false, onchange: () => app.saveSettings({ callWatch: watchBox.checked }) });
    const callsOut = h("div", { class: "stack", style: "gap:6px" });
    const showCalls = (rows) => { callsOut.replaceChildren(openCallsTable(app, rows), h("p", { class: "small muted" }, "Odds now: the chance each call still finishes on its side by the due date from the asset's 60-day volatility alone, ignoring the reasons behind it. Priced " + new Date(lastOpen.at).toLocaleTimeString() + ".")); };
    const priceBtn = h("button", { class: "btn ghost sm", type: "button", onclick: async () => { priceBtn.disabled = true; callsOut.replaceChildren(h("p", { class: "small muted" }, "Pricing open calls…")); try { showCalls(await openCalls(app)); } catch (err) { callsOut.replaceChildren(h("p", { class: "small neg" }, U.errorText(err))); } priceBtn.disabled = false; } }, "Where do the open calls stand?");
    callsBox.append(h("div", {}, priceBtn), callsOut);
    if (!fcs.length && !call) { box.append(h("p", { class: "small muted" }, "Nothing yet. Recommendations, quick takes, AI decisions, day-trade plans and market calls are logged here and graded when they come due."), h("button", { class: "btn ghost sm", type: "button", onclick: () => app.go("picks") }, "Open Recommendations")); return; }
    box.append(h("div", { class: "stack", style: "gap:6px" },
      call ? h("p", { class: "small" }, h("strong", {}, "Market call " + call.target + ": "), "SPY " + (call.upPct >= 50 ? "▲ " + call.upPct + "% up" : "▼ " + (100 - call.upPct) + "% down")) : null,
      Object.keys(by).length ? U.table([{ t: "Open calls", v: (r) => SOURCE_LABEL[r[0]] || r[0] }, { t: "Count", v: (r) => String(r[1].length), n: true }, { t: "Next due", v: (r) => { const n = r[1].slice().sort((a, b) => a.dueAt - b.dueAt)[0]; return n.symbol + " · " + U.fmtDate(n.dueAt); } }], Object.entries(by)) : h("p", { class: "small muted" }, "No open calls."),
      week.length ? h("p", { class: "small" }, "Graded this week: " + week.filter(x => x.e.directionHit).length + " right, " + week.filter(x => !x.e.directionHit).length + " wrong" + " (" + [...new Set(week.map(x => SOURCE_LABEL[x.f.source] || x.f.source))].join(", ") + ").") : null,
      L ? h("p", { class: "small muted" }, "Latest lesson (" + U.fmtDate(L.createdAt) + "): " + (L.lessons[0] ? L.lessons[0].lesson : "")) : null,
      open.some(f => (f.horizonDays || 0) > 2 && (f.direction === "up" || f.direction === "down")) ? callsBox : null,
      h("div", { class: "row", style: "gap:8px;flex-wrap:wrap;align-items:center" },
        h("button", { class: "btn ghost sm", type: "button", onclick: () => { app.ls.set("resTab", "journal"); app.go("research", {}); } }, "Open the AI scorecard"),
        h("label", { class: "small muted", title: "Every two hours while the page is open, price the open calls and tell the inbox once when one turns clearly against its call (25% or less to finish right) or clearly in its favour (85% or more)." }, watchBox, " Watch open calls"))));
    if (lastOpen && Date.now() - lastOpen.at < 3600e3) showCalls(lastOpen.rows);
  }

  /* ---------- review pass ---------- */
  /* A skeptical second reader checks each item of a draft against the measured data and the sources
     actually retrieved: unsupported claims, ignored risks, overconfidence. Returns per-item verdicts. */
  async function review(app, { task, items, facts, S, signal, tools: toolNames }) {
    const s = app.caps.sample; if (!s || !items.length) return null;
    // The reviewer can check claims itself (news, the measured price picture, base rates, the ML model) instead of
    // judging only what the analyst cited.
    const lim = await s.limits().catch(() => null), rtools = lim && lim.tools ? tools(app, S, toolNames || ["search_news", "search_web", "stock_snapshot", "base_rates", "ml_forecast"]) : undefined;
    const st = S.step("run", "Independent review of " + items.length + " item" + (items.length > 1 ? "s" : ""));
    const prompt = `You are a skeptical independent reviewer checking an analyst's draft before an investor sees it. Task the draft answers: ${task}
Check each item ONLY against the measured data and the list of sources that were actually retrieved. Flag: claims not supported by the data or sources, figures that contradict the measured data, risks ignored, confidence that is too high for the evidence, and anything that reads like advice to act. Be concrete. Keep items that hold up.
When an item states a probability (upProbabilityPct), also give YOUR OWN independent estimate of that same probability as probabilityPct, from the evidence, without anchoring on the draft's number; leave it null otherwise.
When an item has a preMortem (how it would most likely fail), judge whether that is really the most likely failure and whether the probability allows for it; say so in issues if not.${rtools ? " Use up to 4 tool calls to check the claims you doubt most (news for a stated catalyst, the measured snapshot for a figure, base_rates or ml_forecast for the odds). Cite only what the tools returned." : ""}
Measured data: ${JSON.stringify(facts).slice(0, 60000)}
Sources retrieved: ${JSON.stringify(S.sourceList()).slice(0, 12000)}
Draft items: ${JSON.stringify(items).slice(0, 60000)}
Reply with ONLY JSON: {"reviews": [{"id": "the item's id", "verdict": "keep"|"revise"|"drop", "issues": ["short, specific problems; empty if none"], "adjustedConfidence": 0-100, "probabilityPct": 0-100 or null, "note": "one sentence the investor should read"}], "overall": "one sentence on the draft as a whole"}`;
    try {
      const r = await s.json(prompt, Object.assign({ modelTier: "complex", signal }, rtools ? { tools: rtools } : { cache: false }));
      const reviews = (Array.isArray(r.reviews) ? r.reviews : []).filter(x => x && x.id != null).map(x => ({ id: String(x.id), verdict: ["keep", "revise", "drop"].includes(x.verdict) ? x.verdict : "keep", issues: (x.issues || []).slice(0, 4).map(String), adjustedConfidence: x.adjustedConfidence == null ? null : Math.max(0, Math.min(100, Number(x.adjustedConfidence) || 0)), probabilityPct: x.probabilityPct == null || !isFinite(Number(x.probabilityPct)) ? null : Math.max(1, Math.min(99, Number(x.probabilityPct))), note: String(x.note || "") }));
      S.done(st, "ok", " → " + reviews.filter(x => x.verdict === "keep").length + " kept, " + reviews.filter(x => x.verdict === "revise").length + " revised, " + reviews.filter(x => x.verdict === "drop").length + " dropped");
      return { reviews, overall: String(r.overall || "") };
    } catch (e) { if (e && e.code === "cancelled") throw e; S.done(st, "fail", " → didn't complete; showing the draft unreviewed"); return null; }
  }

  /* ---------- specialist panel ---------- */
  /* Three specialist analysts estimate the same items independently: none sees another's answer or the lead
     analyst's number, and each works from its own tools. Evidence must carry a measured figure or a URL a tool
     returned; an estimate with no usable evidence counts at half strength. Averaging independent estimates and
     reading their disagreement is one of the most reliable ways to improve forecasts. */
  const PANEL = [
    ["fundamentals", "fundamentals analyst (earnings, estimate revisions, valuation, analyst ratings, insider activity)", ["zacks_view", "earnings_info", "insider_activity", "stock_snapshot", "search_news"]],
    ["quant", "quantitative analyst (the asset's own base rates, the machine-learning model and similar past setups, technicals, options-implied moves, volatility)", ["base_rates", "ml_forecast", "options_move", "price_range", "explain_move"]],
    ["news", "news and macro analyst (latest headlines, the economic calendar, the market regime, the desk's Market Brain record)", ["search_news", "crypto_news", "economic_calendar", "market_pulse", "market_memory", "search_web"]]];
  const panelOn = (app) => !!(app.settings && app.settings.aiPanel !== false);
  async function panel(app, { task, items, facts, S, signal }) {
    const s = app.caps.sample; if (!s || !items.length || !panelOn(app)) return null;
    const lim = await s.limits().catch(() => null);
    const one = async ([key, brief, names]) => {
      const st = S.step("run", "Specialist panel: the " + key + " analyst"), kt = lim && lim.tools ? tools(app, S, names) : undefined;
      const prompt = `You are the desk's ${brief}. ${task}
Work independently and give your OWN probability for each item from your specialty's evidence. ${kt ? "Use 2 to 5 tool calls on the items where your specialty matters most. Cite only URLs the tools returned." : "Tools are unavailable; use the measured data."}
Every piece of evidence must carry a measured figure (e.g. "Zacks Rank 2", "RSI 28", "options price ±9%") or a URL a tool returned; evidence with neither is ignored.
${contextNote(app)}
Measured data: ${JSON.stringify(facts).slice(0, 50000)}
Items: ${JSON.stringify(items)}
Reply with ONLY JSON: {"estimates": [{"id": "the item's id", "upProbabilityPct": 5-95, "evidence": [{"claim": "...", "figure": "a measured number, or null", "url": "https://..., or null"}], "biggestRisk": "..."}]}`;
      try {
        const r = await s.json(prompt, Object.assign({ modelTier: "complex", signal }, kt ? { tools: kt } : { cache: false }));
        const urls = new Set(S.sourceList().map(x => x.url));
        const est = (Array.isArray(r.estimates) ? r.estimates : []).filter(x => x && x.id != null).map(x => {
          const ev = (Array.isArray(x.evidence) ? x.evidence : []).filter(e => e && ((e.figure && /\d/.test(String(e.figure))) || (e.url && urls.has(e.url)))).slice(0, 4).map(e => ({ claim: String(e.claim || ""), figure: e.figure ? String(e.figure) : null, url: e.url && urls.has(e.url) ? e.url : null }));
          let p = Math.max(5, Math.min(95, Number(x.upProbabilityPct) || 50)); if (!ev.length) p = 50 + (p - 50) / 2;
          return { id: String(x.id), upPct: p, evidence: ev, risk: String(x.biggestRisk || "") };
        });
        S.done(st, "ok", " → " + est.map(x => x.id + " " + Math.round(x.upPct) + "%").join(", "));
        return [key, est];
      } catch (e) { if (e && e.code === "cancelled") throw e; S.done(st, "fail", " → " + errText(e)); return [key, []]; }
    };
    const res = Object.fromEntries(await Promise.all(PANEL.map(one))), out = {};
    for (const it of items) {
      const id = String(it.id), by = {}, ev = [];
      for (const [k] of PANEL) { const e = (res[k] || []).find(x => x.id === id); if (e) { by[k] = Math.round(e.upPct); for (const x of e.evidence) ev.push(Object.assign({ by: k }, x)); } }
      const ps = Object.values(by); if (!ps.length) continue;
      out[id] = { by, n: ps.length, meanPct: ps.reduce((a, b) => a + b, 0) / ps.length, evidence: ev.slice(0, 8), risks: PANEL.map(([k]) => ((res[k] || []).find(x => x.id === id) || {}).risk).filter(Boolean) };
    }
    return out;
  }
  /* The team's probability: the lead analyst and each specialist count equally; their spread is the disagreement. */
  function teamUp(leadPct, P) {
    const xs = [leadPct].concat(P ? Object.values(P.by) : []), m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return { upPct: m, spread: Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length), n: xs.length };
  }
  // Wide disagreement lowers confidence: 2 points per point of spread beyond 10.
  const disagreementPenalty = (spread) => Math.max(0, Math.round((spread - 10) * 2));

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

  MD.ai = { stackFor, panel, panelOn, teamUp, disagreementPenalty, followed, spyEach, openCalls, monitorCalls, statusCard, blendFor, assetMemory, assetNote, memoryCard, calibrateUp, findAsset, session, tools, TOOLS, selectTools, intentsOf, toolCap, baseRatesFor, contextNote, profileNote, RISK, HZ, trackRecord, calibrationNote, scoreDue, scorecard, learn, latestLessons, scoredCalls, SOURCE_LABEL, review, blend, errText, logBox, meters, sources, reviewBadge, list, rnd };
})(typeof window !== "undefined" ? window : globalThis);
