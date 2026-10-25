/* Watchlist scanner: measured signals across the watchlist and holdings (overbought/oversold, 52-week
   extremes, moving-average crosses, big moves, volatility spikes, earnings soon, smart-money activity),
   then an AI triage of what needs attention today, checked by the review pass. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const C = MD.core, U = MD.ui, D = MD.data, h = U.h, X = MD.common, A = () => MD.ai;
  async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; try { await fn(items[k], k); } catch {} } })); }
  const SEV = { high: 3, medium: 2, low: 1 };

  function universe(app) {
    const m = new Map();
    const { positions } = C.buildPositions(app.store.cached("tx"));
    for (const p of positions.values()) if (p.qty.gt(0) && ["stock", "etf", "crypto"].includes(p.assetClass)) m.set(p.assetId, Object.assign({ id: p.assetId, cls: p.assetClass, symbol: p.symbol, name: p.name, held: true }, p.meta || {}));
    for (const w of app.store.cached("watch")) if (["stock", "etf", "crypto"].includes(w.cls) && !m.has(w.assetId)) m.set(w.assetId, Object.assign({ id: w.assetId }, w, { held: false }));
    return [...m.values()].slice(0, 30);
  }
  // Signals from one year of daily closes (and the quote for earnings). Each: {kind, sev, text}.
  function signalsFor(a, hs, q, smart) {
    const out = [], pts = hs.points, t = C.technicals(pts, hs.ppy || 252); if (!t) return { out, t: null };
    const last = t.last, r = C.periodReturns(pts);
    if (t.rsi14 >= 70) out.push({ kind: "overbought", sev: t.rsi14 >= 80 ? "high" : "medium", text: "RSI " + t.rsi14.toFixed(0) + " (overbought)" });
    if (t.rsi14 <= 30) out.push({ kind: "oversold", sev: t.rsi14 <= 20 ? "high" : "medium", text: "RSI " + t.rsi14.toFixed(0) + " (oversold)" });
    if (t.high52 && last >= t.high52 * 0.97) out.push({ kind: "near-high", sev: "low", text: "Within 3% of its 52-week high" });
    if (t.low52 && last <= t.low52 * 1.05) out.push({ kind: "near-low", sev: "medium", text: "Within 5% of its 52-week low" });
    if (t.cross && t.cross.since && Date.now() / 1000 - t.cross.since < 20 * 86400) out.push({ kind: t.cross.kind + "-cross", sev: "medium", text: (t.cross.kind === "golden" ? "Golden cross" : "Death cross") + " " + Math.round((Date.now() / 1000 - t.cross.since) / 86400) + " days ago" });
    const n = pts.length, prev = (k) => pts[Math.max(0, n - 1 - k)].close ?? pts[Math.max(0, n - 1 - k)].value;
    for (const [lbl, sma] of [["200-day", t.sma200], ["50-day", t.sma50]]) {
      if (!sma) continue; const before = prev(5);
      if (before < sma && last > sma) out.push({ kind: "cross-up-" + lbl, sev: lbl === "200-day" ? "medium" : "low", text: "Moved above its " + lbl + " average this week" });
      if (before > sma && last < sma) out.push({ kind: "cross-down-" + lbl, sev: lbl === "200-day" ? "high" : "medium", text: "Fell below its " + lbl + " average this week" });
    }
    if (r["1W"] != null && Math.abs(r["1W"]) >= (a.cls === "crypto" ? 15 : 8)) out.push({ kind: "big-move", sev: Math.abs(r["1W"]) >= (a.cls === "crypto" ? 25 : 15) ? "high" : "medium", text: (r["1W"] > 0 ? "Up " : "Down ") + Math.abs(r["1W"]).toFixed(1) + "% in a week" });
    if (t.vol30 && t.volYr && t.vol30 > 1.5 * t.volYr) out.push({ kind: "vol-spike", sev: "medium", text: "30-day volatility " + t.vol30.toFixed(0) + "% vs " + t.volYr.toFixed(0) + "% for the year" });
    if (t.fromHighPct != null && t.fromHighPct <= -25) out.push({ kind: "drawdown", sev: t.fromHighPct <= -40 ? "high" : "medium", text: Math.abs(t.fromHighPct).toFixed(0) + "% below its 52-week high" });
    const ed = q && q.nextEarnings ? Date.parse(q.nextEarnings) : NaN;
    if (isFinite(ed) && ed > Date.now() - 864e5 && ed - Date.now() < 14 * 864e5) out.push({ kind: "earnings", sev: ed - Date.now() < 5 * 864e5 ? "high" : "medium", text: "Earnings " + new Date(ed).toLocaleDateString(undefined, { month: "short", day: "numeric" }) });
    if (smart && smart.length) out.push({ kind: "smart-money", sev: "low", text: smart.length + " tracked " + (smart.length > 1 ? "people hold or traded it" : "person holds or traded it") + ": " + smart.map(w => w.name).slice(0, 3).join(", ") });
    return { out, t, r };
  }
  async function scan(app, onProgress) {
    const list = universe(app), rows = [];
    let done = 0;
    await pool(list, 3, async (a) => {
      try {
        const [hs, q] = await Promise.all([D.historyFor(a, "1Y"), a.cls === "crypto" ? Promise.resolve(null) : app.quote(a).catch(() => null)]);
        const smart = a.cls !== "crypto" && MD.smartView ? MD.smartView.whoOwns(app, a.symbol) : [];
        const { out, t, r } = signalsFor(a, hs, q, smart);
        rows.push({ a, signals: out, score: out.reduce((s, x) => s + SEV[x.sev], 0) + (a.held ? 0.5 : 0), t, r, last: t ? t.last : null, source: hs.source });
      } catch (e) { rows.push({ a, err: U.errorText(e), signals: [], score: -1 }); }
      onProgress && onProgress(++done, list.length);
    });
    return { rows: rows.sort((x, y) => y.score - x.score), at: Date.now(), size: list.length };
  }

  function view(root, app) {
    const box = h("div", { class: "stack" }), prog = h("span", { class: "small muted" }), aiBox = h("div", { class: "stack" });
    let last = null;
    const run = async () => {
      runBtn.disabled = true; box.replaceChildren(h("div", { class: "skeleton" }, "Measuring signals…"));
      last = await scan(app, (d, n) => { prog.textContent = "Measured " + d + " of " + n; });
      runBtn.disabled = false; prog.textContent = "Scanned " + last.size + " assets · " + U.fmtTs(last.at); paint();
    };
    const runBtn = h("button", { class: "btn", type: "button", onclick: run }, "Scan my watchlist and holdings");
    const paint = () => {
      const rows = last.rows;
      if (!rows.length) { box.replaceChildren(h("div", { class: "empty" }, "Add stocks, ETFs or coins to your watchlist or portfolio to scan them.")); return; }
      const flagged = rows.filter(r => r.signals.length);
      box.replaceChildren(
        h("div", { class: "row", style: "gap:8px;flex-wrap:wrap" }, h("span", { class: "pill" }, rows.length + " scanned"), h("span", { class: "pill " + (flagged.length ? "bad" : "ok") }, flagged.length + " with signals"), h("span", { class: "pill" }, rows.filter(r => r.signals.some(s => s.sev === "high")).length + " high priority")),
        U.table([
          { t: "Asset", v: (r) => h("span", { class: "who sym" }, h("b", {}, r.a.symbol), h("span", { class: "tiny muted" }, (r.a.held ? "Holding · " : "Watchlist · ") + String(r.a.name || "").slice(0, 26))) },
          { t: "Last", n: true, v: (r) => r.last != null ? C.fmtNum(r.last, r.last >= 1 ? 2 : 6) : "—" },
          { t: "1W", n: true, v: (r) => r.r ? U.chg(r.r["1W"], 1) : "—" }, { t: "1M", n: true, v: (r) => r.r ? U.chg(r.r["1M"], 1) : "—" },
          { t: "RSI", n: true, v: (r) => r.t && r.t.rsi14 != null ? r.t.rsi14.toFixed(0) : "—" },
          { t: "Signals", v: (r) => r.err ? h("span", { class: "tiny warn-t" }, r.err) : r.signals.length ? h("div", { class: "row", style: "gap:4px;flex-wrap:wrap" }, r.signals.map(s => h("span", { class: "sig " + s.sev, title: s.kind }, s.text))) : h("span", { class: "faint small" }, "Nothing unusual") },
          { t: "", v: (r) => r.t ? h("button", { class: "btn ghost sm", type: "button", onclick: (ev) => { ev.stopPropagation(); X.alertModal(r.a, { price: r.last, currency: "USD" }, r.t.sma200 ? { kind: r.last > r.t.sma200 ? "below" : "above", threshold: +r.t.sma200.toPrecision(5), note: "Crosses its 200-day average" } : null); } }, "Alert") : null }],
          rows, { onRow: (r) => app.openAsset(r.a) }),
        h("p", { class: "tiny muted" }, "Signals are measured by the app from one year of daily closes (Nasdaq, Kraken, CoinGecko) and Nasdaq's earnings date. They describe the past; none predicts the next move on its own."));
      if (!aiBox._ready) { aiBox._ready = true; aiBox.replaceChildren(MD.oppAI.runner(app, "AI: what needs attention today", (S, signal) => triage(app, last, S, signal), triageView(app))); }
    };
    root.append(U.section("Watchlist scanner", h("div", { class: "stack" }, h("p", { class: "small muted" }, "Measures every stock, ETF and coin in your watchlist and portfolio for overbought or oversold readings, 52-week extremes, moving-average crosses, big moves, volatility spikes, earnings within two weeks and smart-money activity."), h("div", { class: "row" }, runBtn, prog), box)),
      U.section("AI triage", h("div", { class: "stack" }, h("p", { class: "small muted" }, "Claude ranks what deserves your attention, checks the news behind the biggest signals and suggests whether to review a position, research further or do nothing. A second review checks it."), aiBox)));
    aiBox.append(h("div", { class: "empty" }, "Run the scan first."));
  }
  async function triage(app, scanRes, S, signal) {
    if (!scanRes) throw new Error("Run the scan first.");
    const flagged = scanRes.rows.filter(r => r.signals.length).slice(0, 12);
    if (!flagged.length) return { summary: "Nothing in your watchlist or holdings shows an unusual signal right now. No action needed.", items: [], at: Date.now() };
    const facts = flagged.map(r => ({ symbol: r.a.symbol, name: r.a.name, class: r.a.cls, held: r.a.held, last: r.last, return1WPct: r.r && r.r["1W"] != null ? +r.r["1W"].toFixed(1) : null, return1MPct: r.r && r.r["1M"] != null ? +r.r["1M"].toFixed(1) : null, rsi14: r.t && r.t.rsi14 != null ? +r.t.rsi14.toFixed(0) : null, signals: r.signals.map(s => s.sev + ": " + s.text) }));
    const lim = await app.caps.sample.limits().catch(() => null);
    const tools = lim && lim.tools ? A().tools(app, S, ["search_news", "crypto_news", "stock_snapshot", "zacks_view", "my_portfolio", "search_web"]) : undefined;
    const prompt = `Today is ${new Date().toISOString().slice(0, 10)}. Triage the investor's watchlist and holdings: the app measured the signals below. Decide what deserves attention today and why.
${tools ? "Use 2 to 8 tool calls: search_news (or crypto_news) for the 2–4 highest-priority names to explain the moves, my_portfolio once to judge position sizes. Cite only URLs the tools returned." : ""}
A signal is not a reason to trade. "No action" is often right; say so. Holdings matter more than watchlist names. Never invent figures.
Signals: ${JSON.stringify(facts)}
Reply with ONLY JSON: {"summary": "2 sentences", "items": [{"symbol": "...", "priority": "high"|"medium"|"low", "headline": "one line", "why": "1-2 sentences with the evidence", "action": "Review position"|"Research"|"Set an alert"|"No action", "confidence": 0-100, "sources": [{"title": "...", "url": "https://..."}]}]}`;
    const r = await app.caps.sample.json(prompt, Object.assign({ modelTier: "default", signal }, tools ? { tools } : { cache: false }));
    const known = new Map(flagged.map(x => [x.a.symbol, x]));
    const items = (r.items || []).filter(x => known.has(x.symbol)).map(x => ({ symbol: x.symbol, asset: known.get(x.symbol).a, priority: ["high", "medium", "low"].includes(x.priority) ? x.priority : "low", headline: String(x.headline || ""), why: String(x.why || ""), action: String(x.action || "No action"), confidence: Math.max(0, Math.min(100, Number(x.confidence) || 0)), sources: S.verify(x.sources) }));
    if (!r.summary && !items.length) throw Object.assign(new Error("The answer came back unreadable; try again."), { code: "invalid_json" });
    const rv = await A().review(app, { task: "Which watchlist and holdings signals deserve attention today", S, signal, facts, items: items.map(x => ({ id: x.symbol, priority: x.priority, headline: x.headline, why: x.why, action: x.action, confidence: x.confidence, sources: x.sources.map(s => s.url) })) });
    for (const x of items) { const rr = rv && rv.reviews.find(y => y.id === x.symbol); if (rr) x.review = rr; }
    items.sort((a, b) => SEV[b.priority] - SEV[a.priority]);
    return { summary: String(r.summary || ""), items, overall: rv && rv.overall, at: Date.now() };
  }
  const triageView = (app) => (res) => h("div", { class: "stack" }, h("p", {}, res.summary), res.overall ? h("p", { class: "small muted" }, h("strong", {}, "Review: "), res.overall) : null,
    res.items.map(x => h("div", { class: "card aicard", style: "padding:10px 12px" },
      h("div", { class: "row between", style: "flex-wrap:wrap;gap:6px" }, h("div", { class: "row", style: "gap:8px" }, h("span", { class: "sig " + x.priority }, x.priority), h("button", { class: "linkbtn", type: "button", onclick: () => app.openAsset(x.asset) }, h("b", {}, x.symbol)), h("span", {}, x.headline)), h("span", { class: "verdict sm " + (x.action === "No action" ? "neutral" : "positive") }, x.action)),
      h("p", { class: "small", style: "margin:6px 0" }, x.why), A().reviewBadge(x.review), A().sources(x.sources))),
    h("p", { class: "tiny muted" }, "Claude's triage of the measured signals, checked by a second review. Not advice."));

  MD.watchScan = { view, scan, signalsFor, universe };
})(typeof window !== "undefined" ? window : globalThis);
