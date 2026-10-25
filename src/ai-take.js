/* Everyday AI without Deep Research: a reviewed one-click "AI quick take" on every stock and crypto page,
   and a daily AI morning brief on the dashboard. Both use the shared AI kit (tools, review pass,
   blended confidence). Each quick take's 3-month lean is logged in the forecast journal, so the takes are
   scored and later takes are told how earlier ones did. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const C = MD.core, U = MD.ui, D = MD.data, h = U.h, A = () => MD.ai;
  const idOf = (asset) => String(asset.id || "").replace(/[^\w-]/g, "_");
  const today = () => new Date().toISOString().slice(0, 10);
  const stanceCls = (s) => s === "positive" ? "positive" : s === "negative" ? "negative" : "neutral";
  const pctTxt = (x) => x == null || !isFinite(x) ? "—" : (x > 0 ? "+" : "") + Number(x).toFixed(1) + "%";

  // Levels the page measures itself, so Claude explains levels rather than inventing them.
  function levelsFrom(points) {
    const t = C.technicals(points); if (!t) return null;
    const out = [["52-week low", t.low52], ["200-day average", t.sma200], ["50-day average", t.sma50], ["20-day average", t.sma20], ["52-week high", t.high52]].filter(([, v]) => v > 0).map(([label, v]) => ({ label, price: +v.toPrecision(6), vsPricePct: +((v / t.last - 1) * 100).toFixed(1) }));
    return { last: t.last, trend: t.trend, rsi14: t.rsi14 != null ? +t.rsi14.toFixed(1) : null, levels: out.sort((a, b) => a.price - b.price) };
  }

  /* ---------- AI quick take on an asset page ---------- */
  function card(app, asset) {
    const out = h("div", { class: "stack" }), log = A().logBox(), phase = h("div", { class: "small muted" });
    let ctl = null;
    const saved = () => app.store.cached("aitakes").find(d => d.id === idOf(asset)) || (card._demo && card._demo[idOf(asset)]);
    const go = h("button", { class: "btn", type: "button" });
    const stop = h("button", { class: "btn ghost", type: "button", hidden: true, onclick: () => ctl && ctl.abort() }, "Stop");
    const label = () => { const s = saved(); go.textContent = s ? (Date.now() - s.at > 6 * 3600e3 ? "Refresh AI take (" + U.fmtTs(s.at) + ")" : "Refresh AI take") : "Get AI quick take"; };
    go.onclick = async () => {
      const s = app.caps.sample; if (!s) { out.replaceChildren(U.errorBox({ message: "Claude isn't available in this view." })); return; }
      ctl = new AbortController(); go.disabled = true; stop.hidden = false; log.clear(); phase.textContent = "Working… usually under a minute.";
      const S = A().session((e) => log.add(e));
      try { const res = await run(app, asset, S, ctl.signal); phase.textContent = "Done · " + S.calls + " research steps, " + S.sources.length + " sources" + (app.demo ? " (demo: not saved)" : ""); paint(res); }
      catch (e) { phase.textContent = ""; log.add({ at: Date.now(), kind: "fail", text: A().errText(e) }); }
      go.disabled = false; stop.hidden = true; ctl = null; label();
    };
    const paint = (r) => {
      if (!r) { out.replaceChildren(h("p", { class: "small muted" }, "Claude reads the measured price picture, " + (asset.cls === "crypto" ? "crypto news" : "news, Zacks, the options-implied move and smart-money ownership") + ", your position if you hold it, and gives a quick read with the evidence on both sides. A second review checks it before you see it.")); return; }
      const lv = r.levels;
      out.replaceChildren(
        h("div", { class: "fc-head" }, h("div", { class: "stack", style: "gap:4px;min-width:0" }, h("span", { class: "verdict " + stanceCls(r.stance) }, r.stanceLabel || r.stance), h("strong", { style: "font-size:1.05rem" }, r.headline)),
          h("div", { class: "stack", style: "gap:2px;justify-items:end" }, h("span", { class: "label" }, "Confidence"), h("b", { class: "num", style: "font-size:1.3rem" }, String(r.confidence)), h("span", { class: "tiny muted" }, U.fmtTs(r.at)))),
        h("p", {}, r.summary),
        r.outlook ? h("div", { class: "kpis k4" }, ["1M", "3M", "6M"].filter(k => r.outlook[k]).map(k => h("div", { class: "kpi" }, h("span", { class: "label" }, k + " lean"), h("span", { class: "v " + (r.outlook[k].lean === "up" ? "up" : r.outlook[k].lean === "down" ? "down" : "") }, (r.outlook[k].lean === "up" ? "▲ Up" : r.outlook[k].lean === "down" ? "▼ Down" : "→ Flat") + " · " + r.outlook[k].probabilityPct + "%"), r.outlook[k].note ? h("span", { class: "s" }, r.outlook[k].note) : null))) : null,
        h("div", { class: "bullbear" }, h("div", { class: "bb up" }, h("span", { class: "label" }, "Working for it"), h("ul", { class: "small", style: "margin:4px 0 0;padding-left:1.1em" }, (r.forIt || []).map(x => h("li", {}, x)))), h("div", { class: "bb down" }, h("span", { class: "label" }, "Working against it"), h("ul", { class: "small", style: "margin:4px 0 0;padding-left:1.1em" }, (r.against || []).map(x => h("li", {}, x))))),
        lv && lv.levels.length ? h("div", { class: "stack", style: "gap:4px" }, h("span", { class: "label" }, "Levels measured by the app"), h("div", { class: "row", style: "flex-wrap:wrap;gap:6px" }, lv.levels.map(l => h("span", { class: "pill" }, l.label + " " + C.fmtNum(l.price, l.price >= 1 ? 2 : 6) + " (" + pctTxt(l.vsPricePct) + ")"))), r.levelsNote ? h("p", { class: "small" }, r.levelsNote) : null) : null,
        r.position ? h("p", { class: "small" }, h("strong", {}, "Your position: "), r.position) : null,
        A().list("What to watch", r.watch), r.changeMyMind ? h("p", { class: "small" }, h("strong", {}, "What would change the view: "), r.changeMyMind) : null,
        A().reviewBadge(r.review),
        h("details", { class: "small" }, h("summary", { class: "label", style: "cursor:pointer" }, "How confident, and why"), A().meters([{ label: "Claude", value: r.parts.claude, note: r.confidenceWhy }, { label: "After review", value: r.parts.reviewed }, { label: "Evidence", value: r.parts.evidence, note: "Verified sources retrieved" }, { label: "Data coverage", value: r.parts.coverage, note: "Research tools that returned data" }, r.parts.track != null ? { label: "Track record", value: r.parts.track, note: "How earlier AI takes' leans turned out" } : null])),
        A().sources(r.sources),
        h("p", { class: "tiny muted" }, "Claude's read of the measured data and the sources it retrieved, checked by a second review. The 3-month lean is logged in your forecast journal and scored when it's due. Not advice."));
    };
    label(); paint(saved());
    const dOut = h("div", { class: "stack" });
    const dSaved = () => app.store.cached("aitakes").find(d => d.id === idOf(asset) + "__debate") || (card._demo && card._demo[idOf(asset) + "__debate"]);
    const dGo = h("button", { class: "btn ghost", type: "button" }, dSaved() ? "Re-run bull vs bear debate" : "Bull vs bear debate");
    dGo.onclick = async () => {
      if (!app.caps.sample) return;
      ctl = new AbortController(); dGo.disabled = true; go.disabled = true; stop.hidden = false; log.clear(); phase.textContent = "Two analysts are researching opposite cases, then a judge weighs them… usually 1–2 minutes.";
      const S = A().session((e) => log.add(e));
      try { const r = await debate(app, asset, S, ctl.signal); phase.textContent = "Debate done · " + S.calls + " research steps"; dOut.replaceChildren(debateView(r)); }
      catch (e) { phase.textContent = ""; log.add({ at: Date.now(), kind: "fail", text: A().errText(e) }); }
      dGo.disabled = false; go.disabled = false; stop.hidden = true; ctl = null; dGo.textContent = "Re-run bull vs bear debate";
    };
    if (dSaved()) dOut.append(debateView(dSaved()));
    const sec = U.section("AI quick take", h("div", { class: "stack" }, h("div", { class: "row" }, go, dGo, stop), phase, log, out, dOut));
    sec.id = "sec-ai";
    return sec;
  }
  async function run(app, asset, S, signal) {
    const isStock = asset.cls === "stock" || asset.cls === "etf", sym = asset.symbol;
    const lim = await app.caps.sample.limits().catch(() => null);
    const names = isStock ? ["stock_snapshot", "zacks_view", "search_news", "options_move", "smart_money", "insider_activity", "price_range", "my_portfolio", "search_web"] : ["stock_snapshot", "crypto_news", "search_news", "price_range", "my_portfolio", "search_web"];
    const tools = lim && lim.tools ? A().tools(app, S, names) : undefined;
    const ls = S.step("run", "Measuring levels from price history");
    let lv = null; try { const hs = await D.historyFor(asset, "1Y"); lv = levelsFrom(hs.points); } catch {}
    S.done(ls, lv ? "ok" : "fail", lv ? "" : " → no price history");
    const tr = A().trackRecord(app, "ai-take");
    const prompt = `Today is ${today()}. Give a quick, decision-useful read of ${asset.name || sym} (${sym}, ${isStock ? "US-listed " + (asset.cls === "etf" ? "ETF" : "stock") : "cryptocurrency"}) for an investor looking at its page.
${tools ? "Investigate with 3 to 7 tool calls before answering: stock_snapshot first, then " + (isStock ? "zacks_view, search_news (one focused query), options_move if a near-term move matters, smart_money, and my_portfolio once to see whether they hold it." : "crypto_news or search_news, and my_portfolio once to see whether they hold it.") + " Cite only URLs the tools returned." : "Tools are unavailable: say news wasn't checked."}
Weigh both sides honestly; "neutral" is a valid stance. Use only measured figures; never invent prices, targets or dates. For the levels, use only the measured levels below and say which matter now.
${A().calibrationNote(tr)}
Measured levels: ${JSON.stringify(lv)}
Reply with ONLY JSON: {"stance": "positive"|"neutral"|"negative", "stanceLabel": "2-4 words, e.g. 'Constructive, but stretched'", "headline": "one sentence", "summary": "3-4 sentences",
 "outlook": {"1M": {"lean": "up"|"down"|"flat", "probabilityPct": 50-75, "note": "short"}, "3M": {...}, "6M": {...}},
 "forIt": ["2-4 points, each citing a measured figure or a source"], "against": ["2-4 points"], "levelsNote": "which measured levels matter and why",
 "position": "if the user holds it: what the take means for their position (size, concentration); otherwise empty", "watch": ["2-4 dated things to watch"], "changeMyMind": "...",
 "confidence": 0-100, "confidenceWhy": "one sentence", "sources": [{"title": "...", "url": "https://..."}]}`;
    const r = await app.caps.sample.json(prompt, Object.assign({ modelTier: "default", signal }, tools ? { tools } : { cache: false }));
    if (!r || !r.summary) throw Object.assign(new Error("The answer came back unreadable; try again."), { code: "invalid_json" });
    const lean = (o) => o && ["up", "down", "flat"].includes(o.lean) ? { lean: o.lean, probabilityPct: Math.max(50, Math.min(80, Number(o.probabilityPct) || 50)), note: String(o.note || "") } : null;
    const res = { asset: MD.common.slim(asset), stance: ["positive", "neutral", "negative"].includes(r.stance) ? r.stance : "neutral", stanceLabel: String(r.stanceLabel || ""), headline: String(r.headline || ""), summary: String(r.summary || ""),
      outlook: { "1M": lean(r.outlook && r.outlook["1M"]), "3M": lean(r.outlook && r.outlook["3M"]), "6M": lean(r.outlook && r.outlook["6M"]) },
      forIt: (r.forIt || []).slice(0, 5).map(String), against: (r.against || []).slice(0, 5).map(String), levels: lv, levelsNote: String(r.levelsNote || ""), position: String(r.position || ""), watch: (r.watch || []).slice(0, 5).map(String), changeMyMind: String(r.changeMyMind || ""),
      sources: S.verify(r.sources), at: Date.now() };
    const rv = await A().review(app, { task: "A quick read of " + sym + " with 1/3/6-month leans", S, signal, facts: { measuredLevels: lv, toolSteps: S.log.filter(e => e.kind === "ok").map(e => e.text) }, items: [{ id: "take", stance: res.stance, headline: res.headline, summary: res.summary, outlook: res.outlook, forIt: res.forIt, against: res.against, confidence: Number(r.confidence) || 0, sources: res.sources.map(s => s.url) }] });
    const rev = rv && rv.reviews.find(x => x.id === "take");
    if (rev) res.review = rev;
    const verified = res.sources.filter(s => s.verified).length, okSteps = S.log.filter(e => e.kind === "ok").length, allSteps = S.log.filter(e => /^(ok|fail)$/.test(e.kind)).length;
    res.parts = { claude: Math.max(0, Math.min(100, Number(r.confidence) || 0)), reviewed: rev && rev.adjustedConfidence != null ? rev.adjustedConfidence : null, evidence: Math.min(100, verified * 25 + 10), coverage: allSteps ? Math.round(okSteps / allSteps * 100) : 0, track: tr.scored >= 5 ? Math.round(tr.hitPct) : null };
    res.confidenceWhy = String(r.confidenceWhy || "");
    res.confidence = A().blend([{ value: res.parts.reviewed ?? res.parts.claude, weight: 0.45 }, { value: res.parts.evidence, weight: 0.2 }, { value: res.parts.coverage, weight: 0.15 }, { value: res.parts.track, weight: 0.2 }]);
    // If the review lowered confidence, pull the leans toward 50%.
    if (rev && rev.adjustedConfidence != null && res.parts.claude && rev.adjustedConfidence < res.parts.claude) for (const k of Object.keys(res.outlook)) if (res.outlook[k]) res.outlook[k].probabilityPct = Math.round(50 + (res.outlook[k].probabilityPct - 50) * rev.adjustedConfidence / res.parts.claude);
    if (app.demo) { card._demo = card._demo || {}; card._demo[idOf(asset)] = res; return res; }
    await app.store.put("aitakes", idOf(asset), JSON.parse(JSON.stringify(res))).catch(() => {});
    // Journal the 3-month lean so AI takes are scored like every other forecast.
    const o3 = res.outlook["3M"], price = lv && lv.last;
    if (o3 && o3.lean !== "flat" && price > 0) await app.store.create("forecasts", { assetId: asset.id, asset: MD.common.slim(asset), symbol: sym, source: "ai-take", horizonDays: 91, dueAt: Date.now() + 91 * 864e5, priceAtCreation: price, currency: "USD", priceSource: "latest close", direction: o3.lean, probability: o3.probabilityPct / 100, thesis: res.headline, flatBandPct: 1 }).catch(() => {});
    return res;
  }

  /* ---------- Bull vs bear debate ---------- */
  /* Two analysts build the strongest case each way with the research tools (in parallel), then a judge who
     sees both cases, the measured price picture and which citations were actually retrieved weighs them. */
  async function debate(app, asset, S, signal) {
    const s = app.caps.sample, isStock = asset.cls === "stock" || asset.cls === "etf", sym = asset.symbol;
    const lim = await s.limits().catch(() => null);
    const names = isStock ? ["stock_snapshot", "zacks_view", "search_news", "options_move", "smart_money", "search_web"] : ["stock_snapshot", "crypto_news", "search_news", "search_web"];
    const snapStep = S.step("run", "Measured price picture for the judge");
    let snap = null; try { snap = await A().TOOLS.stock_snapshot.run(app, S, { symbol: sym }); S.done(snapStep, "ok"); } catch (e) { S.done(snapStep, "fail", " → " + U.errorText(e)); }
    const side = (role) => s.json(`Today is ${today()}. You are the ${role.toUpperCase()} analyst in a structured debate about ${asset.name || sym} (${sym}) over the next 6–12 months. Build the strongest honest ${role === "bull" ? "case for the price rising" : "case for the price falling or lagging"}.
${lim && lim.tools ? "Research with 3 to 6 tool calls (search_news, stock_snapshot" + (isStock ? ", zacks_view, options_move, smart_money" : "") + "). Cite only URLs the tools returned." : "Tools are unavailable."} Use measured figures only; never invent numbers. Concede the single best point on the other side.
Reply with ONLY JSON: {"thesis": "2 sentences", "points": [{"point": "...", "evidence": "the figure or fact", "source_url": "https://... or empty"}], "concession": "the other side's best point", "confidence": 0-100}`, Object.assign({ modelTier: "complex", signal }, lim && lim.tools ? { tools: A().tools(app, S, names) } : { cache: false }));
    S.step("run", "Bull and bear analysts researching");
    const [bull, bear] = await Promise.all([side("bull"), side("bear")]);
    const clean = (c) => ({ thesis: String(c && c.thesis || ""), points: (c && c.points || []).slice(0, 5).map(p => ({ point: String(p.point || ""), evidence: String(p.evidence || ""), source: p.source_url && /^https?:/.test(p.source_url) ? { url: p.source_url, verified: S.sources.some(x => x.url === p.source_url) } : null })), concession: String(c && c.concession || ""), confidence: Math.max(0, Math.min(100, Number(c && c.confidence) || 0)) });
    const B = clean(bull), R = clean(bear);
    if (!B.thesis || !R.thesis) throw Object.assign(new Error("The debate came back unreadable; try again."), { code: "invalid_json" });
    const judgeStep = S.step("run", "Judge weighing both cases");
    const j = await s.json(`You are the judge of a debate about ${sym}. Weigh the bull and bear cases below against the measured data. Points whose source was not actually retrieved ("verified": false) or that contradict the measured data count for little. Decide which case is stronger on evidence (not rhetoric), and give a calibrated probability that the price is higher in 6 months. ${A().calibrationNote(A().trackRecord(app))}
Measured: ${JSON.stringify(snap)}
Bull: ${JSON.stringify(B)}
Bear: ${JSON.stringify(R)}
Reply with ONLY JSON: {"stronger": "bull"|"bear"|"even", "probabilityHigherIn6mPct": 30-70, "verdict": "2-3 sentences", "keyDisagreement": "the one question that decides it", "bullWeakness": "...", "bearWeakness": "...", "watch": ["1-3 things that would settle it"], "confidence": 0-100}`, { modelTier: "complex", signal, cache: false });
    S.done(judgeStep, "ok");
    const res = { asset: MD.common.slim(asset), bull: B, bear: R, stronger: ["bull", "bear", "even"].includes(j.stronger) ? j.stronger : "even", prob: Math.max(25, Math.min(75, Number(j.probabilityHigherIn6mPct) || 50)), verdict: String(j.verdict || ""), keyDisagreement: String(j.keyDisagreement || ""), bullWeakness: String(j.bullWeakness || ""), bearWeakness: String(j.bearWeakness || ""), watch: (j.watch || []).slice(0, 3).map(String), confidence: Math.max(0, Math.min(100, Number(j.confidence) || 0)), at: Date.now() };
    if (!app.demo) await app.store.put("aitakes", idOf(asset) + "__debate", JSON.parse(JSON.stringify(res))).catch(() => {});
    else { card._demo = card._demo || {}; card._demo[idOf(asset) + "__debate"] = res; }
    return res;
  }
  function debateView(r) {
    const sideBox = (c, cls, label) => h("div", { class: "bb " + cls }, h("span", { class: "label" }, label + " · conviction " + c.confidence), h("p", { class: "small", style: "font-weight:600" }, c.thesis),
      h("ul", { class: "small", style: "margin:4px 0 0;padding-left:1.1em;display:grid;gap:3px" }, c.points.map(p => h("li", {}, p.point, p.evidence ? h("span", { class: "muted" }, " — " + p.evidence) : null, p.source ? h("span", {}, " ", h("a", { href: p.source.url, target: "_blank", rel: "noopener noreferrer" }, "source"), p.source.verified ? null : h("span", { class: "warn-t" }, " (unverified)")) : null))),
      c.concession ? h("p", { class: "tiny muted" }, "Concedes: " + c.concession) : null);
    return h("div", { class: "stack debate" },
      h("div", { class: "fc-head" }, h("div", { class: "stack", style: "gap:4px" }, h("span", { class: "verdict " + (r.stronger === "bull" ? "positive" : r.stronger === "bear" ? "negative" : "neutral") }, r.stronger === "even" ? "Evenly matched" : (r.stronger === "bull" ? "Bull case stronger" : "Bear case stronger")), h("strong", {}, r.verdict)),
        h("div", { class: "stack", style: "gap:2px;justify-items:end" }, h("span", { class: "label" }, "Higher in 6 months"), h("b", { class: "num", style: "font-size:1.3rem" }, r.prob + "%"), h("span", { class: "tiny muted" }, "judge's confidence " + r.confidence))),
      h("div", { class: "bullbear" }, sideBox(r.bull, "up", "Bull"), sideBox(r.bear, "down", "Bear")),
      r.keyDisagreement ? h("p", { class: "small" }, h("strong", {}, "What decides it: "), r.keyDisagreement) : null,
      h("div", { class: "grid g2" }, r.bullWeakness ? h("p", { class: "small" }, h("strong", {}, "Weakest bull point: "), r.bullWeakness) : null, r.bearWeakness ? h("p", { class: "small" }, h("strong", {}, "Weakest bear point: "), r.bearWeakness) : null),
      A().list("What would settle it", r.watch), h("p", { class: "tiny muted" }, "Two Claude analysts argued opposite sides with the research tools; a third weighed them against measured data and checked which citations were retrieved. " + U.fmtTs(r.at) + ". Not advice."));
  }

  /* ---------- AI morning brief (dashboard) ---------- */
  function brief(box, app) {
    const out = h("div", { class: "stack" }), log = A().logBox();
    const key = today();
    const saved = () => app.store.cached("briefs").find(d => d.id === key) || brief._demo;
    let ctl = null;
    const go = h("button", { class: "btn sm", type: "button" }, saved() ? "Rewrite today's brief" : "Write today's brief");
    const paint = (b) => {
      if (!b) { out.replaceChildren(h("p", { class: "small muted" }, "A short daily read of your portfolio, the news behind its moves, upcoming catalysts and what changed among the people you follow on Smart Money. Takes about a minute.")); return; }
      out.replaceChildren(h("strong", {}, b.headline), h("p", { class: "small" }, b.market),
        b.holdings && b.holdings.length ? h("ul", { class: "small", style: "margin:0;padding-left:1.1em;display:grid;gap:3px" }, b.holdings.map(x => h("li", {}, h("b", {}, x.symbol + ": "), x.note))) : null,
        A().list("Today", b.today), A().list("Risks", b.risks), A().reviewBadge(b.review),
        h("div", { class: "row between" }, h("span", { class: "tiny muted" }, "Written " + U.fmtTs(b.at) + " · confidence " + b.confidence), A().sources(b.sources)));
    };
    go.onclick = async () => {
      if (!app.caps.sample) { out.replaceChildren(U.errorBox({ message: "Claude isn't available in this view." })); return; }
      ctl = new AbortController(); go.disabled = true; log.clear();
      const S = A().session((e) => log.add(e));
      try { const b = await writeBrief(app, S, ctl.signal); paint(b); go.textContent = "Rewrite today's brief"; }
      catch (e) { log.add({ at: Date.now(), kind: "fail", text: A().errText(e) }); }
      go.disabled = false; ctl = null;
    };
    paint(saved());
    box.append(out, h("div", { class: "row" }, go), log);
  }
  async function writeBrief(app, S, signal) {
    const vp = S.step("run", "Valuing your portfolio");
    const pv = await app.valuePortfolio().catch(() => null);
    const total = pv ? Number(pv.totals.valueR) || 0 : 0;
    const holdings = pv ? pv.rows.filter(r => r.p.qty.gt(0)).map(r => ({ symbol: r.p.symbol, name: r.p.name, class: r.p.assetClass, weightPct: total ? +(Number(r.v.valueR || 0) / total * 100).toFixed(1) : null, todayPct: r.q && r.q.changePct != null ? +Number(r.q.changePct).toFixed(2) : null, gainPct: r.v.pnlPctN != null ? +Number(r.v.pnlPctN).toFixed(1) : null })).sort((a, b) => (b.weightPct || 0) - (a.weightPct || 0)).slice(0, 15) : [];
    S.done(vp, "ok", " → " + holdings.length + " holdings");
    const in14 = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
    const catalysts = app.store.cached("catalysts").filter(c => !c.done && c.date >= today() && c.date <= in14).map(c => ({ date: c.date, symbol: c.symbol, event: c.title })).slice(0, 10);
    const dueSoon = app.store.cached("forecasts").filter(f => f.dueAt > Date.now() && f.dueAt < Date.now() + 7 * 864e5).map(f => ({ symbol: f.symbol, source: f.source, direction: f.direction, due: new Date(f.dueAt).toISOString().slice(0, 10) })).slice(0, 8);
    const follows = app.store.cached("follows").map(f => f.name);
    const smartNew = app.store.cached("inbox").filter(i => i.kind === "smart" && Date.now() - (i.at || 0) < 3 * 864e5).map(i => i.title).slice(0, 6);
    const openBets = app.store.cached("bets").filter(b => b.status === "open").length;
    const lim = await app.caps.sample.limits().catch(() => null);
    const tools = lim && lim.tools ? A().tools(app, S, ["search_news", "crypto_news", "stock_snapshot", "smart_money", "search_web"]) : undefined;
    const facts = { reportingCurrency: pv && pv.R, holdings, catalystsNext14Days: catalysts, forecastsDueThisWeek: dueSoon, followingOnSmartMoney: follows, smartMoneyNoticesLast3Days: smartNew, openBets, demo: !!app.demo };
    const prompt = `Today is ${today()}. Write the investor's short morning brief from the measured data below. ${tools ? "Use 2 to 6 tool calls: search_news for the market backdrop today (one query) and for the one or two holdings with the biggest moves or weights; crypto_news if they hold coins. Cite only URLs the tools returned." : ""}
Be specific and brief. Explain moves only with evidence; say "no clear news" when there is none. No advice to trade; "nothing to do today" is fine.
Data: ${JSON.stringify(facts)}
Reply with ONLY JSON: {"headline": "one line", "market": "2 sentences on the backdrop", "holdings": [{"symbol": "...", "note": "what moved it or what matters, one sentence"}], "today": ["2-4 things to look at today, dated where possible"], "risks": ["1-3"], "confidence": 0-100, "sources": [{"title": "...", "url": "https://..."}]}`;
    const r = await app.caps.sample.json(prompt, Object.assign({ modelTier: "default", signal }, tools ? { tools } : { cache: false }));
    if (!r || !r.headline) throw Object.assign(new Error("The answer came back unreadable; try again."), { code: "invalid_json" });
    const b = { headline: String(r.headline), market: String(r.market || ""), holdings: (r.holdings || []).slice(0, 6).map(x => ({ symbol: String(x.symbol || ""), note: String(x.note || "") })), today: (r.today || []).slice(0, 5).map(String), risks: (r.risks || []).slice(0, 4).map(String), sources: S.verify(r.sources), at: Date.now() };
    const rv = await A().review(app, { task: "A morning brief for this investor", S, signal, facts, items: [{ id: "brief", headline: b.headline, market: b.market, holdings: b.holdings, today: b.today, confidence: Number(r.confidence) || 0, sources: b.sources.map(s => s.url) }] });
    const rev = rv && rv.reviews.find(x => x.id === "brief"); if (rev) b.review = rev;
    b.confidence = A().blend([{ value: rev && rev.adjustedConfidence != null ? rev.adjustedConfidence : Number(r.confidence) || 0, weight: 0.7 }, { value: Math.min(100, b.sources.filter(s => s.verified).length * 25 + 20), weight: 0.3 }]);
    if (app.demo) { brief._demo = b; return b; }
    await app.store.put("briefs", today(), JSON.parse(JSON.stringify(b))).catch(() => {});
    for (const old of app.store.cached("briefs").filter(d => d.id < new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10))) app.store.remove("briefs", old.id).catch(() => {});
    return b;
  }

  MD.aiTake = { card, brief, levelsFrom };
})(typeof window !== "undefined" ? window : globalThis);
