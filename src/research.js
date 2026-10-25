/* Research engine. Claude does the reasoning; the page does every lookup and calculation and keeps
   the log, so the research steps shown are the steps that actually ran. Citations are checked
   against the pages actually retrieved in the session. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const C = MD.core, U = MD.ui, D = MD.data;

  const MODES = {
    quick: { label: "Quick analysis", tier: "default", searches: "1 to 3", challenge: false, phases: ["evidence", "analysis"] },
    deep: { label: "Deep research", tier: "complex", searches: "4 to 8", challenge: true, phases: ["evidence", "analysis", "challenge"] },
    dd: { label: "Comprehensive due diligence", tier: "complex", searches: "6 to 12, including primary sources (filings, official sites)", challenge: true, phases: ["evidence", "evidence2", "analysis", "challenge"] }
  };

  function makeTools(ctx) {
    const { asset, log, sources, app } = ctx;
    const step = (kind, text) => { const e = { at: Date.now(), kind, text }; log.push(e); ctx.onLog && ctx.onLog(e); return e; };
    const tools = [
      { name: "search_web", description: "Search the live web (news, filings, official sites, data pages). Returns titles, URLs, publication info and text highlights.", inputSchema: { type: "object", properties: { query: { type: "string", description: "Descriptive query for the ideal page" } }, required: ["query"] },
        async execute(i, c) { const q = String(i.query || ""); const e = step("run", "Web search: " + q); try { const r = await D.webSearch(q, "Find authoritative, recent sources with exact figures and dates relevant to: " + ctx.question, 6); for (const s of r.results) if (!sources.some(x => x.url === s.url)) sources.push({ url: s.url, title: s.title, retrievedAt: Date.now(), via: "search" }); e.kind = "ok"; e.text += " → " + r.results.length + " results"; return r.text.slice(0, 18000); } catch (err) { e.kind = "fail"; throw new Error(U.errorText(err)); } } },
      { name: "read_page", description: "Read the full text of one URL (for primary sources such as filings, official rules or press releases).", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
        async execute(i) { const u = String(i.url || ""); if (!/^https?:\/\//.test(u)) throw new Error("Give a full https URL."); const e = step("run", "Read page: " + u); try { const t = await D.readPage(u, 9000); if (!sources.some(x => x.url === u)) sources.push({ url: u, title: u, retrievedAt: Date.now(), via: "read" }); e.kind = "ok"; return t; } catch (err) { e.kind = "fail"; throw new Error(U.errorText(err)); } } },
      { name: "search_news", description: "Search Bigdata.com's indexed financial news (publisher, timestamp, passage excerpts). Better than search_web for company, sector and macro news. One topic and one time period per call, in natural language.", inputSchema: { type: "object", properties: { query: { type: "string", description: "e.g. 'Nvidia data-center revenue guidance this quarter'" } }, required: ["query"] },
        async execute(i) { const q = String(i.query || ""); const e = step("run", "Bigdata.com news: " + q); try { const r = await D.bigdataNews(q, 6); for (const x of r.items) if (x.url && !sources.some(y => y.url === x.url)) sources.push({ url: x.url, title: x.title, retrievedAt: Date.now(), via: "news" }); e.kind = "ok"; e.text += " → " + r.items.length + " articles"; return r.items.map(x => ({ headline: x.title, publisher: x.source, published: x.ts ? new Date(x.ts).toISOString() : null, url: x.url, excerpt: String(x.text || "").slice(0, 1800) })); } catch (err) { e.kind = "fail"; throw new Error(U.errorText(err)); } } },
      { name: "crypto_news", description: "Latest news for one cryptocurrency from CoinMarketCap (title, date, excerpt, URL). Matching is loose: check each headline is about the coin.", inputSchema: { type: "object", properties: { symbol: { type: "string", description: "Coin symbol, e.g. BTC" } }, required: ["symbol"] },
        async execute(i) { const sym = String(i.symbol || (asset && asset.symbol) || "").toUpperCase(); const e = step("run", "CoinMarketCap news: " + sym); try { const r = await D.cmc.news(sym, 8); for (const x of r.items) if (!sources.some(y => y.url === x.url)) sources.push({ url: x.url, title: x.title, retrievedAt: Date.now(), via: "news" }); e.kind = "ok"; e.text += " → " + r.items.length + " items"; return r.items.map(x => ({ title: x.title, published: x.ts ? new Date(x.ts).toISOString() : null, url: x.url, excerpt: String(x.text || x.description || "").slice(0, 1500) })); } catch (err) { e.kind = "fail"; throw new Error(U.errorText(err)); } } },
      { name: "get_quote", description: "Current quote for the asset under research, with source, status and timestamp. Use this for the current price; never quote a price from memory.", inputSchema: { type: "object", properties: {} },
        async execute() { const e = step("run", "Live quote for " + (asset ? asset.symbol : "asset")); if (!asset) throw new Error("No asset selected."); try { const q = await app.quote(asset, 15000); ctx.quote = q; e.kind = "ok"; e.text += " → " + q.price + " " + q.currency + " (" + q.status + ", " + q.source + ")"; return { price: q.price, currency: q.currency, changePct: q.changePct, status: q.status, source: q.source, timestamp: q.ts ? new Date(q.ts).toISOString() : null, marketStatus: q.marketStatus || null, listing: q.listing || null }; } catch (err) { e.kind = "fail"; throw new Error(U.errorText(err)); } } },
      { name: "get_price_stats", description: "Measured price statistics for the asset over a timeframe: return, high, low, annualized volatility, max drawdown, CAGR. Computed by the app from exchange data.", inputSchema: { type: "object", properties: { timeframe: { type: "string", enum: ["1M", "3M", "1Y", "5Y"] } }, required: ["timeframe"] },
        async execute(i) { const tf = ["1M", "3M", "1Y", "5Y"].includes(i.timeframe) ? i.timeframe : "1Y"; const e = step("run", "Price statistics " + tf); try { const s = await D.historyFor(asset, tf); const st = C.seriesStats(s.points, s.ppy || 252); ctx.stats[tf] = st; e.kind = "ok"; return Object.assign({ source: s.source, note: s.note, from: new Date(s.points[0].time * 1000).toISOString().slice(0, 10), to: new Date(s.points[s.points.length - 1].time * 1000).toISOString().slice(0, 10) }, Object.fromEntries(Object.entries(st).map(([k, v]) => [k, typeof v === "number" ? +v.toPrecision(5) : v]))); } catch (err) { e.kind = "fail"; throw new Error(U.errorText(err)); } } },
      { name: "get_fundamentals", description: "For US-listed stocks and ETFs: Nasdaq summary (sector, market cap, dividend, analyst target) and condensed annual financial statements.", inputSchema: { type: "object", properties: {} },
        async execute() { if (!asset || !["stock", "etf"].includes(asset.cls)) throw new Error("Fundamentals are available for US-listed stocks and ETFs only."); const e = step("run", "Fundamentals from Nasdaq"); try { const [sum, fin] = await Promise.all([D.stocks.summary(asset.symbol, asset.cls), asset.cls === "stock" ? D.stocks.financials(asset.symbol).catch(() => null) : null]); const pick = (tb, names) => tb ? tb.rows.filter(r => names.some(n => String(r[0]).toLowerCase().startsWith(n))).map(r => ({ item: r[0], values: Object.fromEntries(tb.headers.slice(1).map((hd, j) => [hd, r[j + 1]])) })) : []; e.kind = "ok"; sources.push({ url: "https://www.nasdaq.com/market-activity/stocks/" + asset.symbol.toLowerCase(), title: "Nasdaq " + asset.symbol + " data", retrievedAt: Date.now(), via: "data" }); return { summary: sum, unit: fin && fin.unitNote, income: fin && pick(fin.income, ["total revenue", "gross profit", "operating income", "net income"]), balance: fin && pick(fin.balance, ["cash and cash", "total assets", "total liabilities", "long-term debt", "total equity"]), cashflow: fin && pick(fin.cash, ["net cash flow-operating", "capital expenditures", "net cash flows-financing"]) }; } catch (err) { e.kind = "fail"; throw new Error(U.errorText(err)); } } },
      { name: "get_asset_data", description: "Asset-specific market data: crypto supply/market cap/ATH; card legality, reference prices and (Pokémon) tournament usage; metal spot; currency pair rate.", inputSchema: { type: "object", properties: {} },
        async execute() { const e = step("run", "Asset data for " + (asset && asset.symbol)); try { let out; if (asset.cls === "crypto") out = await D.crypto.quote(asset.cgId || asset.id.split(":")[1], "usd"); else if (asset.cls === "pokemon") { const c = await D.pokemon.card(asset.tcgdexId || asset.id.slice(4)); let usage = null; try { usage = await D.pokemon.usage(c.name, 2); } catch {} out = { name: c.name, set: c.set, rarity: c.rarity, legal: c.legal, regulationMark: c.regulationMark, variants: c.variants, tournamentUsage: usage && { decks: usage.decks, inclusionPct: usage.inclusionPct, avgCopies: usage.avgCopies, archetypes: usage.archetypes, source: usage.source } }; } else if (asset.cls === "yugioh") out = await D.ygo.card(asset.ygoId || asset.id.split(":")[1]); else if (asset.cls === "metal") out = await D.metals.spot(asset.symbol); else if (asset.cls === "sports" && asset.cardchainId) { const c = await D.cardchain.card(asset); out = { name: c.name, player: c.player, set: c.set, grade: c.grade, priceUSD: c.price, averageUSD: c.avgPrice, pricePoints: c.history.slice(-30).map(p => ({ date: new Date(p.time * 1000).toISOString().slice(0, 10), price: p.value })), source: "CardChain AI market estimates (not verified individual sales)" }; } else if (asset.cls === "fx") { await app.rates.refresh(); const q = app.rates.quote(asset.base, asset.quote); out = { pair: asset.base + "/" + asset.quote, rate: q && q.rate.toString(), source: q && q.source }; } else out = await app.quote(asset); e.kind = "ok"; return out; } catch (err) { e.kind = "fail"; throw new Error(U.errorText(err)); } } },
      { name: "get_technicals", description: "Technical picture of the asset, computed by the app from exchange data: trend versus 20/50/200-day averages, golden/death cross, RSI(14), MACD, 52-week range position, volatility, 1-day 95% value at risk, and returns from 1 week to 5 years.", inputSchema: { type: "object", properties: {} },
        async execute() { if (!asset) throw new Error("No asset selected."); const e = step("run", "Technical indicators for " + asset.symbol); try { const s = await D.historyFor(asset, "5Y").catch(() => D.historyFor(asset, "1Y")); const t = C.technicals(s.points); if (!t) throw new Error("Not enough history."); e.kind = "ok"; const rd = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "number" ? +v.toPrecision(5) : v && typeof v === "object" ? rd(v) : v])); return { source: s.source, technicals: rd(Object.assign({}, t, { cross: t.cross ? { kind: t.cross.kind, since: t.cross.since ? new Date(t.cross.since * 1000).toISOString().slice(0, 10) : null } : null })), returnsPct: rd(C.periodReturns(s.points)) }; } catch (err) { e.kind = "fail"; throw new Error(U.errorText(err)); } } },
      { name: "get_zacks", description: "For US-listed stocks: Zacks Rank (1 Strong Buy to 5 Strong Sell), style scores, Zacks target price, industry rank, and each Wall Street broker's latest rating and target. Present as Zacks' view and cite the returned URL.", inputSchema: { type: "object", properties: {} },
        async execute() { if (!asset || asset.cls !== "stock") throw new Error("Zacks covers US-listed stocks only."); const e = step("run", "Zacks rank and broker ratings for " + asset.symbol); try { const [m, r] = await Promise.all([D.zacks.metrics(asset.symbol), D.zacks.ratings(asset.symbol).catch(() => null)]); if (!sources.some(x => x.url === m.url)) sources.push({ url: m.url, title: "Zacks " + asset.symbol, retrievedAt: Date.now(), via: "data" }); e.kind = "ok"; const keep = ["zacks_rank", "zacks_rank_text", "value_score", "growth_score", "momentum_score", "vgm_score", "zacks_target_price", "industry_rank", "industry", "last_trade_date"]; return { url: m.url, facts: Object.fromEntries(keep.filter(k => m.v(k) != null).map(k => [k, m.v(k)])), brokers: r && r.records ? r.records.slice(0, 12).map(x => ({ broker: x.broker, rating: x.rating, previous: x.prev, action: x.action, target: x.target, date: x.date })) : [] }; } catch (err) { e.kind = "fail"; throw new Error(U.errorText(err)); } } },
      { name: "get_portfolio_context", description: "The user's current holdings in their reporting currency: weights, the position in this asset if any, currency exposure.", inputSchema: { type: "object", properties: {} },
        async execute() { const e = step("run", "Portfolio context"); const pv = await app.valuePortfolio(); const total = Number(pv.totals.valueR) || 0; e.kind = "ok"; return { reportingCurrency: pv.R, totalValue: total.toFixed(2), holdings: pv.rows.filter(r => r.p.qty.gt(0)).map(r => ({ symbol: r.p.symbol, class: r.p.assetClass, currency: r.p.currency, weightPct: total ? (Number(r.v.valueR || 0) / total * 100).toFixed(1) : null, pnlPctNative: r.v.pnlPctN ? Number(r.v.pnlPctN).toFixed(1) : null })), demo: app.demo }; } },
      { name: "compare_alternatives", description: "Measured 1-year return, volatility and max drawdown for alternative US tickers or coins (e.g. SGOV for cash, SPY for the broad market, a competitor). Use for opportunity cost.", inputSchema: { type: "object", properties: { symbols: { type: "array", items: { type: "string" }, description: "Up to 4 tickers, or coin ids prefixed crypto: (e.g. crypto:ethereum)" } }, required: ["symbols"] },
        async execute(i) { const syms = (Array.isArray(i.symbols) ? i.symbols : []).slice(0, 4).map(String); const e = step("run", "Alternatives: " + syms.join(", ")); const out = await Promise.all(syms.map(async s => { const a = s.startsWith("crypto:") ? { id: s, cls: "crypto", cgId: s.slice(7), symbol: s.slice(7).toUpperCase() } : { id: "stock:" + s.toUpperCase(), cls: "stock", symbol: s.toUpperCase() }; try { const h = await D.historyFor(a, "1Y"); const st = C.seriesStats(h.points, h.ppy || 252); return { symbol: a.symbol, returnPct: +st.changePct.toFixed(2), volPct: +st.volPct.toFixed(1), maxDrawdownPct: +st.maxDrawdownPct.toFixed(1), source: h.source }; } catch (err) { return { symbol: a.symbol, error: U.errorText(err) }; } })); e.kind = "ok"; ctx.alternatives = out; return out; } },
      { name: "calc_reward_risk", description: "Deterministic reward-to-risk calculation after round-trip fees and FX costs. Use instead of doing the arithmetic yourself.", inputSchema: { type: "object", properties: { entry: { type: "number" }, target: { type: "number" }, downside: { type: "number" }, feePct: { type: "number" }, fxCostPct: { type: "number" } }, required: ["entry", "target", "downside"] },
        async execute(i) { const e = step("run", "Reward-to-risk calculation"); const r = C.rewardRisk({ entry: i.entry, target: i.target, stop: i.downside, feePct: i.feePct || 0, fxCostPct: i.fxCostPct || 0 }); e.kind = "ok"; const n = (x) => x == null ? null : Number(x.toFixed ? x.toFixed(4) : x); return { ok: r.ok, netUpPct: n(r.netUpPct), netDownPct: n(r.netDownPct), ratio: r.ratio == null ? null : n(r.ratio), ratioNote: r.ratioReason || null, breakevenWinRatePct: n(r.breakevenWinRatePct) }; } }
    ];
    return tools;
  }

  const REPORT_SHAPE = `{
 "title": "short title",
 "decision": "the user's decision restated",
 "questions": ["3-5 research questions you answered"],
 "executiveSummary": "4-6 sentences",
 "verdict": {"label": "one of: No action | Wait and monitor | Investigate further | Consider a small position | Consider adding | Hold | Consider reducing | Avoid", "stance": "positive"|"neutral"|"negative", "rationale": "2-3 sentences"},
 "thesis": "the investment thesis in 2-4 sentences",
 "evidence": [{"claim": "...", "source_url": "https://... (must be a URL you retrieved)", "source_date": "YYYY-MM-DD or unknown", "data_period": "what period the figure covers", "strength": "strong"|"moderate"|"weak", "conflicts": "any conflicting source, else empty"}],
 "competingExplanations": ["alternative explanations for the evidence"],
 "strongestCounterargument": "the single strongest argument against the thesis",
 "valuation": "valuation discussion with the method used and its limits (for cards/crypto say why conventional valuation doesn't apply)",
 "scenarios": {"bull": {"price": number|null, "probabilityPct": number|null, "drivers": "..."}, "base": {...}, "bear": {...}},
 "rewardRisk": {"entry": number|null, "target": number|null, "downside": number|null, "explanation": "where the levels come from"},
 "holdingPeriod": "expected holding period if supportable, distinguishing the forecast horizon from time-to-target; or say it isn't supportable",
 "fxImpact": "how currency moves affect a holder reporting in the user's currency",
 "liquidity": "how easily and cheaply it can be exited",
 "catalysts": [{"date": "YYYY-MM-DD or TBD", "event": "..."}],
 "invalidation": ["specific conditions that would prove the thesis wrong"],
 "alternatives": [{"name": "...", "why": "opportunity-cost comparison"}],
 "confidence": {"data": 0-100, "analysis": 0-100, "forecast": 0-100, "explanation": "why"},
 "limitations": ["..."],
 "missingEvidence": ["what you could not find or verify"],
 "monitoringPlan": ["what to watch and how often"],
 "forecast": {"direction": "up"|"down"|"flat", "horizonDays": number, "probabilityPct": 50-95, "target": number|null} or null if no defensible forecast
}`;

  async function run(opts) {
    const { app, asset, question, mode, horizon, onLog, onPhase, signal } = opts;
    const s = app.caps.sample; if (!s) throw Object.assign(new Error("Claude isn't available in this view."), { code: "no_sample" });
    const M = MODES[mode] || MODES.quick;
    const lim = await s.limits().catch(() => null);
    if (!lim || !lim.tools) throw Object.assign(new Error("This view can't run research tools."), { code: "tools_unavailable" });
    const ctx = { app, asset, question, log: [], sources: [], stats: {}, onLog, quote: null };
    const tools = makeTools(ctx);
    const R = app.settings.reportingCurrency;
    const today = new Date().toISOString().slice(0, 10);
    const assetLine = asset ? `${asset.name} (${asset.symbol}; class ${asset.cls}${asset.listing ? "; " + asset.listing : ""})` : "no specific asset";
    const base = `Today is ${today}. User's reporting currency: ${R}. Decision horizon: ${horizon}.
Asset: ${assetLine}.
User's question / decision: "${question}".
Rules: never invent prices, figures, sources or research steps. Use get_quote for the current price and the app's tools for any calculation. Cite only URLs returned by your tools. Say plainly when evidence is missing. "No action" or "wait" are valid conclusions.`;
    // Phase 1: evidence gathering (tools)
    onPhase && onPhase("Gathering evidence");
    const evPrompt = `${base}
PHASE: evidence gathering. Call get_quote first${asset && ["stock", "etf"].includes(asset.cls) ? ", then get_fundamentals" + (asset.cls === "stock" ? " and get_zacks" : "") : asset ? ", then get_asset_data" : ""}, then get_price_stats (1Y and one other)${asset && ["stock", "etf", "crypto"].includes(asset.cls) ? " and get_technicals" : ""}, then search ${M.searches} times for recent news, primary sources, competitive and regulatory context, and the strongest bear case: use search_news (Bigdata.com) for company, sector and macro news${asset && asset.cls === "crypto" ? ", crypto_news for this coin's news" : ""}, and search_web for primary sources and anything else. If a news tool fails, carry on with search_web. Use read_page on the most important primary source if one exists. Call compare_alternatives for opportunity cost (include a cash proxy such as SGOV and a broad index).
Then reply with ONLY JSON: {"facts": [{"fact": "...", "source_url": "...", "source_date": "...", "strength": "strong|moderate|weak"}], "conflicts": ["..."], "gaps": ["..."]}`;
    const ev = await s.json(evPrompt, { modelTier: M.tier, tools, signal });
    let ev2 = null;
    if (M.phases.includes("evidence2")) {
      onPhase && onPhase("Checking primary sources and gaps");
      ev2 = await s.json(`${base}
PHASE: second evidence pass for due diligence. Earlier evidence: ${JSON.stringify(ev).slice(0, 12000)}
Fill the listed gaps and verify the most important claims against primary sources (company filings, regulator or exchange notices, official game rules, central bank statements) using search_web and read_page. Look specifically for evidence that contradicts the earlier facts.
Reply with ONLY JSON in the same shape: {"facts": [...], "conflicts": [...], "gaps": [...]}`, { modelTier: M.tier, tools, signal });
    }
    // Phase 2: analysis (no tools; every number must come from the evidence or the measured data)
    onPhase && onPhase("Analysing");
    const measured = { quote: ctx.quote && { price: ctx.quote.price, currency: ctx.quote.currency, status: ctx.quote.status, source: ctx.quote.source, ts: ctx.quote.ts && new Date(ctx.quote.ts).toISOString() }, stats: ctx.stats, alternatives: ctx.alternatives || null };
    const report = await s.json(`${base}
PHASE: analysis. Build the report from ONLY this evidence and measured data. Compare competing explanations, build bull/base/bear scenarios with prices in ${ctx.quote ? ctx.quote.currency : "the asset's currency"}, quantify uncertainty, and compare alternatives.
Measured data (authoritative): ${JSON.stringify(measured).slice(0, 8000)}
Evidence: ${JSON.stringify(ev).slice(0, 20000)}
${ev2 ? "Second-pass evidence: " + JSON.stringify(ev2).slice(0, 12000) : ""}
Reply with ONLY JSON of this shape:
${REPORT_SHAPE}`, { modelTier: M.tier, signal, cache: false });
    // Phase 3: challenge
    let challenge = null;
    if (M.challenge) { onPhase && onPhase("Challenging the conclusion"); challenge = await challengeReport(app, report, measured, base, signal, M.tier); }
    return finalize(app, { asset, question, mode, horizon, report, challenge, ctx, measured });
  }

  async function challengeReport(app, report, measured, base, signal, tier) {
    const s = app.caps.sample;
    return s.json(`${base || ""}
You are an independent reviewer. Challenge this investment report as hard as the evidence allows.
Report: ${JSON.stringify(report).slice(0, 24000)}
Measured data: ${JSON.stringify(measured || {}).slice(0, 6000)}
Answer: What is the strongest argument against the thesis? Is the catalyst already priced in? Which assumptions are most fragile? Could currency moves or transaction costs reverse the result? What could cause a permanent loss? What evidence would invalidate the thesis? Is another asset a better use of the capital?
Reply with ONLY JSON: {"strongestCounter": "...", "pricedIn": "...", "fragileAssumptions": ["..."], "costsAndFx": "...", "permanentLossRisks": ["..."], "invalidationEvidence": ["..."], "betterUseOfCapital": "...", "revisedConfidence": {"data": 0-100, "analysis": 0-100, "forecast": 0-100}, "revisedVerdict": {"label": "...", "stance": "positive|neutral|negative"}, "whatWouldChangeMyMind": "...", "survives": true|false}`, { modelTier: tier || "complex", signal, cache: false });
  }

  function finalize(app, { asset, question, mode, horizon, report, challenge, ctx, measured }) {
    const retrieved = new Set(ctx.sources.map(s => s.url));
    const norm = (u) => String(u || "").replace(/[#?].*$/, "").replace(/\/$/, "");
    const retrievedNorm = new Set([...retrieved].map(norm));
    const evidence = (Array.isArray(report.evidence) ? report.evidence : []).map(e => Object.assign({}, e, { verified: !!e.source_url && (retrieved.has(e.source_url) || retrievedNorm.has(norm(e.source_url))) }));
    const unverified = evidence.filter(e => !e.verified).length;
    const rr = report.rewardRisk && report.rewardRisk.entry ? C.rewardRisk({ entry: report.rewardRisk.entry, target: report.rewardRisk.target, stop: report.rewardRisk.downside, feePct: app.exitAssumption(asset && asset.cls, ctx.quote && ctx.quote.currency || "USD", app.settings.reportingCurrency).exitCostPct, fxCostPct: ctx.quote && ctx.quote.currency !== app.settings.reportingCurrency ? app.exitAssumption("cash", ctx.quote.currency, app.settings.reportingCurrency).fxSpreadPct : 0 }) : null;
    const doc = {
      assetId: asset ? asset.id : null, asset: asset ? MD.common.slim(asset) : null, assetName: asset ? asset.name : (report.title || question.slice(0, 60)), question, mode, horizon,
      reportingCurrency: app.settings.reportingCurrency, report: Object.assign({}, report, { evidence }), challenge,
      measured: { quote: measured.quote, stats: measured.stats, alternatives: measured.alternatives },
      computed: { rewardRisk: rr ? { netUpPct: rr.netUpPct && Number(rr.netUpPct), netDownPct: rr.netDownPct && Number(rr.netDownPct), ratio: rr.ratio != null ? Number(rr.ratio) : null, ratioReason: rr.ratioReason || "", costsPct: Number(rr.costsPct) } : null, unverifiedCitations: unverified },
      steps: ctx.log, sources: ctx.sources, demo: !!app.demo, model: "Claude (" + (MODES[mode] || MODES.quick).tier + " tier)"
    };
    return doc;
  }

  function diffReports(prev, cur) {
    if (!prev) return [];
    const out = [];
    const p = prev.report || {}, c = cur.report || {};
    const pq = prev.measured && prev.measured.quote, cq = cur.measured && cur.measured.quote;
    if (pq && cq && pq.price && cq.price) out.push(["Price", C.fmtNum(pq.price, 2) + " → " + C.fmtNum(cq.price, 2) + " (" + U.pct((cq.price / pq.price - 1) * 100) + ")"]);
    if ((p.verdict || {}).label !== (c.verdict || {}).label) out.push(["Verdict", ((p.verdict || {}).label || "—") + " → " + ((c.verdict || {}).label || "—")]);
    for (const k of ["data", "analysis", "forecast"]) { const a = (p.confidence || {})[k], b = (c.confidence || {})[k]; if (a != null && b != null && Math.abs(a - b) >= 5) out.push([k[0].toUpperCase() + k.slice(1) + " confidence", a + " → " + b]); }
    for (const k of ["bull", "base", "bear"]) { const a = ((p.scenarios || {})[k] || {}).price, b = ((c.scenarios || {})[k] || {}).price; if (a && b && Math.abs(a / b - 1) > 0.02) out.push([k + " scenario", C.fmtNum(a, 2) + " → " + C.fmtNum(b, 2)]); }
    const pr = prev.computed && prev.computed.rewardRisk, cr = cur.computed && cur.computed.rewardRisk;
    if (pr && cr && pr.ratio != null && cr.ratio != null && Math.abs(pr.ratio - cr.ratio) > 0.1) out.push(["Reward-to-risk", pr.ratio.toFixed(2) + " → " + cr.ratio.toFixed(2)]);
    return out;
  }

  MD.research = { MODES, run, challengeReport, finalize, diffReports, makeTools };
})(typeof window !== "undefined" ? window : globalThis);
