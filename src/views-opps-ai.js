/* Opportunities AI: a reviewed read of scanner results, a structured comparison scorecard, and an idea
   finder that turns a theme or goal into candidates the page then verifies with its own measurements.
   Each run uses the shared AI kit: research tools, a second-pass review and blended confidence. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const C = MD.core, U = MD.ui, D = MD.data, h = U.h, A = () => MD.ai;
  const r1 = (x) => x == null || !isFinite(x) ? null : +Number(x).toFixed(1);
  const today = () => new Date().toISOString().slice(0, 10);
  const verdictCls = (v) => /research|buy|strong|add|consider/i.test(v || "") ? "positive" : /pass|avoid|sell/i.test(v || "") ? "negative" : "neutral";

  // Shared run harness: button + stop + log + phase, then render(result).
  function runner(app, label, run, render, opts = {}) {
    const out = h("div", { class: "stack" }), log = A().logBox(), phase = h("div", { class: "small muted" });
    let ctl = null;
    const go = h("button", { class: opts.primary === false ? "btn ghost" : "btn", type: "button" }, label);
    const stop = h("button", { class: "btn ghost", type: "button", hidden: true, onclick: () => ctl && ctl.abort() }, "Stop");
    go.onclick = async () => {
      if (!app.caps.sample) { out.replaceChildren(U.errorBox({ message: "Claude isn't available in this view." })); return; }
      ctl = new AbortController(); go.disabled = true; stop.hidden = false; log.clear(); phase.textContent = "Working… usually 1–3 minutes.";
      const S = A().session((e) => log.add(e));
      try { const res = await run(S, ctl.signal); phase.textContent = "Done · " + S.calls + " research steps, " + S.sources.length + " sources"; out.replaceChildren(render(res)); if (opts.onDone) opts.onDone(res); }
      catch (e) { phase.textContent = ""; log.add({ at: Date.now(), kind: "fail", text: A().errText(e) }); }
      go.disabled = false; stop.hidden = true; ctl = null;
    };
    const el = h("div", { class: "stack" }, h("div", { class: "row" }, go, stop), phase, log, out);
    el.show = (res) => out.replaceChildren(render(res));
    return el;
  }
  async function limitsTools(app, S, names) { const lim = await app.caps.sample.limits().catch(() => null); return lim && lim.tools ? A().tools(app, S, names) : undefined; }
  function applyReview(items, rv, key = "symbol") {
    for (const it of items) { const r = rv && rv.reviews.find(x => x.id === String(it[key])); if (r) it.review = r; }
    return items;
  }

  /* ---------- scanner review ---------- */
  function scanReview(app, getRows, presetLabel) {
    return runner(app, "AI review of these results", async (S, signal) => {
      const rows = getRows().slice(0, 8); if (!rows.length) throw new Error("Run a scan first.");
      const facts = rows.map(r => ({ symbol: r.a.symbol, name: r.a.name, class: r.a.cls, return3mPct: r1(r.s.r3m), return1yPct: r1(r.s.r1y), volPct: r1(r.s.vol), maxDrawdownPct: r1(r.s.mdd), fromHighPct: r1(r.s.fromHigh), above200DayAvg: r.s.above200, sharpe: isFinite(r.s.sharpe) ? r1(r.s.sharpe) : null, fcfMarginPct: r1(r.s.fcfMargin) }));
      const tools = await limitsTools(app, S, ["stock_snapshot", "zacks_view", "search_news", "crypto_news", "smart_money", "insider_activity", "my_portfolio", "search_web"]);
      const prompt = `Today is ${today()}. The investor screened their own universe by "${presetLabel}". Review the top results below (measured by the app from one year of daily closes) as opportunities for roughly a 6–12 month holding.
${tools ? "Use 4 to 10 tool calls: stock_snapshot and zacks_view for the most interesting names, search_news (or crypto_news) for anything that could explain the numbers, smart_money where relevant, and my_portfolio once to judge fit and concentration. Cite only URLs the tools returned." : "Tools are unavailable; say news wasn't checked."}
Judge each honestly: a screen rank is not a reason to buy. "Pass" and "Watch" are valid. Never invent figures.
${A().calibrationNote(A().trackRecord(app))}
${A().contextNote(app)}
Results: ${JSON.stringify(facts)}
Reply with ONLY JSON: {"summary": "2-3 sentences", "bestIdea": {"symbol": "...", "why": "..."} or null,
 "items": [{"symbol": "...", "verdict": "Research further"|"Watch"|"Pass", "score": 0-100 (attractiveness for the holding period after risk), "thesis": "1-2 sentences", "keyRisk": "...", "catalyst": "dated if possible, else empty", "fit": "how it fits the user's portfolio", "changeMyMind": "...", "confidence": 0-100, "sources": [{"title": "...", "url": "https://..."}]}]}`;
      const r = await app.caps.sample.json(prompt, Object.assign({ modelTier: "complex", signal }, tools ? { tools } : { cache: false }));
      const known = new Set(facts.map(f => f.symbol));
      const items = (r.items || []).filter(x => known.has(x.symbol)).map(x => ({ symbol: x.symbol, verdict: String(x.verdict || "Watch"), score: Math.max(0, Math.min(100, Number(x.score) || 0)), thesis: String(x.thesis || ""), keyRisk: String(x.keyRisk || ""), catalyst: String(x.catalyst || ""), fit: String(x.fit || ""), changeMyMind: String(x.changeMyMind || ""), confidence: Math.max(0, Math.min(100, Number(x.confidence) || 0)), sources: S.verify(x.sources) }));
      if (!items.length) throw Object.assign(new Error("The answer came back unreadable; try again."), { code: "invalid_json" });
      const rv = await A().review(app, { task: "Which screen results deserve research for a 6–12 month holding", S, signal, facts, items: items.map(x => ({ id: x.symbol, verdict: x.verdict, score: x.score, thesis: x.thesis, keyRisk: x.keyRisk, confidence: x.confidence, sources: x.sources.map(s => s.url) })) });
      applyReview(items, rv);
      for (const x of items) x.blended = A().blend([{ value: x.review && x.review.adjustedConfidence != null ? x.review.adjustedConfidence : x.confidence, weight: 0.7 }, { value: Math.min(100, x.sources.filter(s => s.verified).length * 30 + 10), weight: 0.3 }]);
      items.sort((a, b) => (b.review && b.review.verdict === "drop" ? -1 : b.score) - (a.review && a.review.verdict === "drop" ? -1 : a.score));
      return { summary: String(r.summary || ""), bestIdea: r.bestIdea && known.has(r.bestIdea.symbol) ? r.bestIdea : null, items, overall: rv && rv.overall, at: Date.now() };
    }, (res) => h("div", { class: "stack" },
      h("p", {}, res.summary), res.bestIdea ? h("div", { class: "aireview positive" }, h("span", { class: "verdict sm positive" }, "Best idea: " + res.bestIdea.symbol), h("span", { class: "small" }, res.bestIdea.why)) : null,
      res.overall ? h("p", { class: "small muted" }, h("strong", {}, "Review: "), res.overall) : null,
      h("div", { class: "grid g2", style: "align-items:start" }, res.items.map((x, i) => h("section", { class: "card aicard" + (x.review && x.review.verdict === "drop" ? " dim" : "") },
        h("div", { class: "hd" }, h("div", { class: "row", style: "gap:8px" }, h("span", { class: "rank" }, "#" + (i + 1)), h("strong", {}, x.symbol)), h("span", { class: "verdict sm " + verdictCls(x.verdict) }, x.verdict + " · " + x.score)),
        h("div", { class: "bd stack" }, h("p", { class: "small" }, x.thesis), x.keyRisk ? h("p", { class: "small" }, h("strong", {}, "Key risk: "), x.keyRisk) : null, x.catalyst ? h("p", { class: "small" }, h("strong", {}, "Catalyst: "), x.catalyst) : null, x.fit ? h("p", { class: "small" }, h("strong", {}, "Portfolio fit: "), x.fit) : null, x.changeMyMind ? h("p", { class: "small" }, h("strong", {}, "What would change the view: "), x.changeMyMind) : null,
          A().reviewBadge(x.review), h("div", { class: "row between" }, h("span", { class: "small" }, "Confidence ", h("b", {}, String(x.blended))), h("span", { class: "tiny muted" }, "Claude " + x.confidence + (x.review && x.review.adjustedConfidence != null ? " · review " + x.review.adjustedConfidence : ""))), A().sources(x.sources)),
        h("div", { class: "ft" }, h("button", { class: "btn sm", type: "button", onclick: () => app.openAsset({ id: "stock:" + x.symbol, cls: "stock", symbol: x.symbol, name: x.symbol }) }, "Open"), h("button", { class: "btn ghost sm", type: "button", onclick: () => app.go("research", { asset: { id: "stock:" + x.symbol, cls: "stock", symbol: x.symbol, name: x.symbol }, prefill: "Is " + x.symbol + " worth buying for a 6–12 month holding? Thesis to test: " + x.thesis }) }, "Deep research"))))),
      h("p", { class: "tiny muted" }, "Written by Claude from the scan's measured data and the tools it used, then checked by a second review. Not advice.")));
  }

  /* ---------- comparator ---------- */
  function compareAI(app, ok, tf, R) {
    return runner(app, "AI comparison scorecard", async (S, signal) => {
      const facts = ok.map(r => ({ symbol: r.a.symbol, name: r.a.name, class: r.a.cls, periodReturnPct: r1(r.st.changePct), volPct: r1(r.st.volPct), maxDrawdownPct: r1(r.st.maxDrawdownPct), currency: r.s.currency || "USD" }));
      const tools = await limitsTools(app, S, ["stock_snapshot", "zacks_view", "search_news", "crypto_news", "compare_returns", "my_portfolio", "smart_money"]);
      const prompt = `Today is ${today()}. Compare these investments for an investor reporting in ${R} (measured period ${tf}). ${tools ? "Use 3 to 8 tool calls: zacks_view and stock_snapshot for valuation and trend, search_news for anything material, compare_returns against SPY and SGOV as baselines, my_portfolio once for fit. Cite only URLs the tools returned." : ""}
${A().contextNote(app)}
Score each on growth potential, risk (higher = safer), valuation (higher = cheaper vs its own history and peers), momentum and portfolio fit, 0–10, from the evidence. Say plainly when the data can't separate them, and that "none of these" or "wait" can be right. Never invent figures.
Measured: ${JSON.stringify(facts)}
Reply with ONLY JSON: {"summary": "3-4 sentences", "overallWinner": {"symbol": "... or none", "why": "..."}, "bestFor": [{"goal": "growth"|"stability"|"income"|"diversification", "symbol": "...", "why": "..."}],
 "scorecard": [{"symbol": "...", "growth": 0-10, "risk": 0-10, "valuation": 0-10, "momentum": 0-10, "fit": 0-10, "overall": 0-10, "bull": "...", "bear": "..."}],
 "waitOrNone": "when waiting or choosing none is better", "changeMyMind": "...", "confidence": 0-100, "sources": [{"title": "...", "url": "https://..."}]}`;
      const r = await app.caps.sample.json(prompt, Object.assign({ modelTier: "complex", signal }, tools ? { tools } : { cache: false }));
      const known = new Set(facts.map(f => f.symbol));
      const sc = (r.scorecard || []).filter(x => known.has(x.symbol)).map(x => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, ["growth", "risk", "valuation", "momentum", "fit", "overall"].includes(k) ? Math.max(0, Math.min(10, Number(v) || 0)) : String(v || "")])));
      if (!sc.length) throw Object.assign(new Error("The answer came back unreadable; try again."), { code: "invalid_json" });
      const rv = await A().review(app, { task: "Compare these investments and pick the best for each goal", S, signal, facts, items: sc.map(x => ({ id: x.symbol, scores: x, winnerOverall: r.overallWinner && r.overallWinner.symbol === x.symbol })).concat([{ id: "summary", summary: r.summary, confidence: r.confidence }]) });
      const sumRv = rv && rv.reviews.find(x => x.id === "summary");
      applyReview(sc, rv);
      return { summary: String(r.summary || ""), winner: r.overallWinner || null, bestFor: (r.bestFor || []).filter(x => known.has(x.symbol)), scorecard: sc, waitOrNone: String(r.waitOrNone || ""), changeMyMind: String(r.changeMyMind || ""),
        confidence: A().blend([{ value: sumRv && sumRv.adjustedConfidence != null ? sumRv.adjustedConfidence : Number(r.confidence) || 0, weight: 0.7 }, { value: Math.min(100, S.sources.length * 15), weight: 0.3 }]), claudeConfidence: Number(r.confidence) || 0, reviewNote: sumRv ? sumRv.note : rv && rv.overall, sources: S.verify(r.sources) };
    }, (res) => h("div", { class: "stack" },
      h("div", { class: "row between", style: "flex-wrap:wrap;gap:8px" }, h("span", { class: "verdict " + (res.winner && res.winner.symbol && !/none/i.test(res.winner.symbol) ? "positive" : "neutral") }, res.winner && res.winner.symbol ? "Overall: " + res.winner.symbol : "No clear winner"), h("span", { class: "small" }, "Confidence ", h("b", {}, String(res.confidence)), h("span", { class: "tiny muted" }, " (Claude " + res.claudeConfidence + ")"))),
      h("p", {}, res.summary), res.winner && res.winner.why ? h("p", { class: "small" }, res.winner.why) : null,
      U.table([{ t: "Asset", v: "symbol" }, ...["growth", "risk", "valuation", "momentum", "fit", "overall"].map(k => ({ t: k[0].toUpperCase() + k.slice(1), n: true, v: (x) => h("span", { class: "score s" + Math.round(x[k] / 2.5) }, String(x[k])) })), { t: "Review", v: (x) => x.review ? h("span", { class: "verdict sm " + (x.review.verdict === "keep" ? "positive" : x.review.verdict === "drop" ? "negative" : "neutral"), title: x.review.note }, x.review.verdict) : "—" }], res.scorecard),
      res.bestFor.length ? h("div", { class: "row", style: "flex-wrap:wrap;gap:6px" }, res.bestFor.map(b => h("span", { class: "pill", title: b.why }, "Best for " + b.goal + ": " + b.symbol))) : null,
      h("div", { class: "grid g2", style: "align-items:start" }, res.scorecard.map(x => h("div", { class: "bullbear" }, h("div", { class: "bb up" }, h("span", { class: "label" }, x.symbol + " bull"), h("p", { class: "small" }, x.bull || "—")), h("div", { class: "bb down" }, h("span", { class: "label" }, x.symbol + " bear"), h("p", { class: "small" }, x.bear || "—"))))),
      res.waitOrNone ? h("p", { class: "small" }, h("strong", {}, "When to wait or choose none: "), res.waitOrNone) : null,
      res.changeMyMind ? h("p", { class: "small" }, h("strong", {}, "What would change the view: "), res.changeMyMind) : null,
      res.reviewNote ? h("p", { class: "small muted" }, h("strong", {}, "Review: "), res.reviewNote) : null, A().sources(res.sources),
      h("p", { class: "tiny muted" }, "Scores are Claude's judgement from the measured table and the sources retrieved, checked by a second review. Not advice.")), { primary: false });
  }

  /* ---------- idea finder ---------- */
  const HORIZONS = { short: "3–12 months", mid: "1–3 years", long: "5+ years" };
  const RISKS = { low: "conservative (capital preservation first)", mid: "balanced", high: "aggressive (accepts large drawdowns)" };
  async function verifyIdea(app, x) {
    try {
      const a = await A().findAsset(x.symbol);
      const hs = await D.historyFor(a, "1Y"), st = C.seriesStats(hs.points, hs.ppy || 252), t = C.technicals(hs.points, hs.ppy || 252);
      return { asset: a, measured: { price: st.end, return1YPct: st.changePct, volPct: st.volPct, maxDrawdownPct: st.maxDrawdownPct, trend: t && t.trend, fromHighPct: t && t.fromHighPct, source: hs.source, asOf: new Date(hs.points[hs.points.length - 1].time * 1000).toISOString().slice(0, 10) } };
    } catch (e) { return { error: U.errorText(e) }; }
  }
  function ideaFinder(root, app) {
    const saved = app.store.cached("ideas").slice().sort((a, b) => b.createdAt - a.createdAt);
    const theme = h("textarea", { rows: 2, placeholder: "A theme or goal, e.g. ‘companies selling picks and shovels for AI data centres’, ‘dividend payers for retirement income’, ‘beaten-down quality stocks’", "aria-label": "Theme or goal" }, app.ls.get("idea.theme", ""));
    const hz = h("select", {}, Object.entries(HORIZONS).map(([k, l]) => h("option", { value: k, selected: k === app.ls.get("idea.hz", (app.settings.profile || {}).horizon || "mid") }, l)));
    const rk = h("select", {}, Object.entries(RISKS).map(([k, l]) => h("option", { value: k, selected: k === app.ls.get("idea.risk", (app.settings.profile || {}).risk || "mid") }, l.split(" (")[0][0].toUpperCase() + l.split(" (")[0].slice(1))));
    const n = h("select", {}, ["3", "5", "7"].map(x => h("option", { value: x, selected: x === app.ls.get("idea.n", "5") }, x + " ideas")));
    const my = new Set(app.store.cached("watch").map(w => w.symbol));
    const render = (res) => h("div", { class: "stack" },
      h("div", { class: "row between", style: "flex-wrap:wrap;gap:8px" }, h("strong", {}, "“" + res.theme + "”"), h("span", { class: "tiny muted" }, HORIZONS[res.horizon] + " · " + RISKS[res.risk].split(" (")[0] + " · " + U.fmtTs(res.createdAt || res.at))),
      h("p", {}, res.summary), res.overall ? h("p", { class: "small muted" }, h("strong", {}, "Review: "), res.overall) : null,
      h("div", { class: "grid g2", style: "align-items:start" }, res.ideas.map(x => h("section", { class: "card aicard" + (x.review && x.review.verdict === "drop" ? " dim" : "") },
        h("div", { class: "hd" }, h("div", { class: "stack", style: "gap:0" }, h("strong", { style: "font-size:1.05rem" }, x.symbol), h("span", { class: "tiny muted" }, x.name || "")), h("span", { class: "verdict sm " + (x.role === "speculative" ? "neutral" : "positive") }, x.role || "idea")),
        h("div", { class: "bd stack" },
          x.measured ? U.kv([["1Y return", U.chg(x.measured.return1YPct, 1)], ["Volatility", r1(x.measured.volPct) + "%"], ["Max drawdown", h("span", { class: "down" }, r1(x.measured.maxDrawdownPct) + "%")], ["Trend", x.measured.trend || "—"], ["From 52w high", U.chg(x.measured.fromHighPct, 1)]]) : h("p", { class: "small warn-t" }, "Couldn't verify this ticker: " + (x.verifyError || "no price history")),
          x.measured ? h("p", { class: "tiny muted" }, "Measured by the app · " + x.measured.source + " · to " + x.measured.asOf) : null,
          h("p", { class: "small" }, x.thesis), x.whyNow ? h("p", { class: "small" }, h("strong", {}, "Why now: "), x.whyNow) : null, x.risks ? h("p", { class: "small" }, h("strong", {}, "Risks: "), x.risks) : null,
          A().reviewBadge(x.review), h("span", { class: "small" }, "Confidence ", h("b", {}, String(x.blended)), h("span", { class: "tiny muted" }, " (Claude " + x.confidence + (x.review && x.review.adjustedConfidence != null ? ", review " + x.review.adjustedConfidence : "") + (x.measured ? "" : ", unverified") + ")")), A().sources(x.sources)),
        x.asset ? h("div", { class: "ft" }, h("button", { class: "btn sm", type: "button", onclick: () => app.openAsset(x.asset) }, "Open"), my.has(x.symbol) ? h("span", { class: "pill ok" }, "On watchlist") : h("button", { class: "btn ghost sm", type: "button", onclick: async (ev) => { await app.store.create("watch", Object.assign({ assetId: x.asset.id }, MD.common.slim(x.asset))); ev.target.replaceWith(h("span", { class: "pill ok" }, "On watchlist")); } }, "Watch"), h("button", { class: "btn ghost sm", type: "button", onclick: () => app.go("research", { asset: x.asset, prefill: x.symbol + ": " + x.thesis }) }, "Deep research")) : null))),
      res.avoid && res.avoid.length ? A().list("Considered and left out", res.avoid.map(a => (a.symbol ? a.symbol + ": " : "") + (a.reason || ""))) : null,
      h("p", { class: "tiny muted" }, "Ideas are Claude's, from the sources it retrieved; every ticker was checked against exchange data by the app and reviewed by a second reader. A starting point for research, not advice."));
    const r = runner(app, "Find ideas", async (S, signal) => {
      const t = theme.value.trim(); if (t.length < 4) throw new Error("Describe a theme or goal first.");
      app.ls.set("idea.theme", t); app.ls.set("idea.hz", hz.value); app.ls.set("idea.risk", rk.value); app.ls.set("idea.n", n.value);
      const tools = await limitsTools(app, S, ["search_web", "search_news", "stock_snapshot", "zacks_view", "compare_returns", "smart_money", "my_portfolio", "read_page", "screen_stocks"]);
      const prompt = `Today is ${today()}. An investor asks for ${n.value} investment ideas for this theme or goal: "${t.replace(/"/g, "'")}". Holding period: ${HORIZONS[hz.value]}. Risk appetite: ${RISKS[rk.value]}.
${tools ? "Research before answering, with 5 to 12 tool calls: search_web and search_news to find companies or funds that genuinely fit (prefer primary sources and recent, dated reporting), stock_snapshot and zacks_view to check each candidate's measured price picture and ratings, my_portfolio once to avoid duplicating what they own. Cite only URLs the tools returned." : "Tools are unavailable: say ideas weren't checked against current news."}
${A().contextNote(app)} (The holding period and risk appetite chosen above override the profile for this search.)
Only US-listed stocks or ETFs, or major coins. Mix roles sensibly for the risk appetite (core holdings, satellites, at most one speculative idea unless aggressive). Include a diversified ETF when it fits the theme better than single names. Never invent tickers or figures.
Reply with ONLY JSON: {"summary": "2-3 sentences on the theme and how to approach it", "ideas": [{"symbol": "TICKER", "name": "...", "role": "core"|"satellite"|"speculative", "thesis": "2 sentences on why it fits", "whyNow": "...", "risks": "...", "confidence": 0-100, "sources": [{"title": "...", "url": "https://..."}]}], "avoid": [{"symbol": "...", "reason": "considered but left out, and why"}]}`;
      const res = await app.caps.sample.json(prompt, Object.assign({ modelTier: "complex", signal }, tools ? { tools } : { cache: false }));
      let ideas = (res.ideas || []).filter(x => x && x.symbol).slice(0, Number(n.value) + 2).map(x => ({ symbol: String(x.symbol).toUpperCase().trim(), name: String(x.name || ""), role: ["core", "satellite", "speculative"].includes(x.role) ? x.role : "satellite", thesis: String(x.thesis || ""), whyNow: String(x.whyNow || ""), risks: String(x.risks || ""), confidence: Math.max(0, Math.min(100, Number(x.confidence) || 0)), sources: S.verify(x.sources) }));
      if (!ideas.length) throw Object.assign(new Error("The answer came back unreadable; try again."), { code: "invalid_json" });
      const vs = S.step("run", "Verifying " + ideas.length + " tickers against exchange data");
      await Promise.all(ideas.map(async (x) => { const v = await verifyIdea(app, x); if (v.error) x.verifyError = v.error; else { x.asset = MD.common.slim(Object.assign({}, v.asset, { name: x.name || v.asset.name })); x.measured = v.measured; } }));
      S.done(vs, "ok", " → " + ideas.filter(x => x.measured).length + " of " + ideas.length + " verified");
      const rv = await A().review(app, { task: "Ideas for: " + t + " (" + HORIZONS[hz.value] + ", " + RISKS[rk.value] + ")", S, signal, facts: ideas.map(x => ({ symbol: x.symbol, measured: x.measured ? A().rnd(x.measured) : "could not verify ticker" })), items: ideas.map(x => ({ id: x.symbol, role: x.role, thesis: x.thesis, whyNow: x.whyNow, risks: x.risks, confidence: x.confidence, sources: x.sources.map(s => s.url) })) });
      applyReview(ideas, rv);
      for (const x of ideas) x.blended = A().blend([{ value: x.review && x.review.adjustedConfidence != null ? x.review.adjustedConfidence : x.confidence, weight: 0.6 }, { value: x.measured ? 80 : 0, weight: 0.2 }, { value: Math.min(100, x.sources.filter(s => s.verified).length * 30 + 10), weight: 0.2 }]);
      ideas.sort((a, b) => (b.measured ? 1 : 0) - (a.measured ? 1 : 0) || (a.review && a.review.verdict === "drop" ? 1 : 0) - (b.review && b.review.verdict === "drop" ? 1 : 0) || b.blended - a.blended);
      ideas = ideas.slice(0, Number(n.value) + 1);
      const out = { theme: t, horizon: hz.value, risk: rk.value, summary: String(res.summary || ""), ideas, avoid: (res.avoid || []).slice(0, 6), overall: rv && rv.overall, at: Date.now() };
      if (!app.demo) { const doc = await app.store.create("ideas", JSON.parse(JSON.stringify(out))).catch(() => null); for (const old of app.store.cached("ideas").sort((a, b) => b.createdAt - a.createdAt).slice(12)) app.store.remove("ideas", old.id).catch(() => {}); if (doc) out.createdAt = doc.createdAt; }
      return out;
    }, render);
    root.append(U.section("AI idea finder", h("div", { class: "stack" },
      h("p", { class: "small muted" }, "Describe a theme, sector or goal. Claude researches it with news, web and market-data tools, the app checks every ticker against exchange data, and a second review flags weak reasoning. Takes 1–3 minutes."),
      U.field("Theme or goal", theme), h("div", { class: "form" }, U.field("Holding period", hz), U.field("Risk appetite", rk), U.field("How many", n)), r)));
    if (saved.length) {
      r.show(saved[0]);
      if (saved.length > 1) root.append(U.section("Earlier idea searches", U.table([{ t: "When", v: (x) => U.fmtTs(x.createdAt) }, { t: "Theme", v: "theme" }, { t: "Ideas", v: (x) => x.ideas.map(i => i.symbol).join(", ") }], saved.slice(1), { onRow: (x) => { r.show(x); window.scrollTo(0, 0); } })));
    }
  }

  MD.oppAI = { scanReview, compareAI, ideaFinder, runner };
})(typeof window !== "undefined" ? window : globalThis);
