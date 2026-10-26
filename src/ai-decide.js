/* AI decision on an asset page: should this investor buy, add slowly, hold, trim, sell, avoid or wait, given their
   profile, horizon and current position? The page measures the asset's own odds over the investor's horizon, its
   risk and their position; Claude researches and decides; a second reader checks it; the page computes the expected
   value and a position-size ceiling. The call is logged (source ai-decide) and graded at the horizon's end. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const C = MD.core, Q = MD.quant, U = MD.ui, D = MD.data, h = U.h;
  const HORIZON_DAYS = { short: 91, mid: 365, long: 365 }, CAP = { low: 5, mid: 10, high: 20 };
  const DECISIONS = { buy: ["Buy", "positive"], accumulate: ["Add slowly", "positive"], hold: ["Hold", "neutral"], trim: ["Trim", "negative"], sell: ["Sell", "negative"], avoid: ["Avoid", "negative"], wait: ["Wait", "neutral"] };
  const r1 = (x) => x == null || !isFinite(x) ? null : Math.round(x * 10) / 10;
  const idOf = (a) => String(a.id || a.symbol).replace(/[^\w-]/g, "_");

  async function decide(app, asset, opts = {}) {
    const s = app.caps.sample; if (!s) throw Object.assign(new Error("Claude isn't available in this view."), { code: "no_sample" });
    const S = MD.ai.session(opts.onLog), prof = app.settings.profile || {}, days = HORIZON_DAYS[prof.horizon] || 365, cap = CAP[prof.risk] || 10;
    const isStock = asset.cls === "stock" || asset.cls === "etf";
    let e = S.step("run", "Measuring " + asset.symbol + "'s own odds over " + days + " days, its risk and your position");
    const [br, q, hs, pv] = await Promise.all([MD.ai.baseRatesFor(asset, days).catch(() => null), app.quote(asset, 30000).catch(() => null), D.historyCached(asset, "1Y").catch(() => null), app.valuePortfolio().catch(() => null)]);
    const st = hs ? C.seriesStats(hs.points, hs.ppy || 252) : null, tech = hs ? C.technicals(hs.points, hs.ppy || 252) : null;
    const total = pv ? Number(pv.totals.valueR) || 0 : 0, row = pv ? pv.rows.find(r => r.p.assetId === asset.id || r.p.symbol === asset.symbol) : null;
    const position = row && row.p.qty.gt(0) ? { weightPct: total ? r1(Number(row.v.valueR) / total * 100) : null, gainPct: row.v.pnlPctN != null ? r1(Number(row.v.pnlPctN)) : null } : null;
    S.done(e, "ok", br ? " → history: higher " + br.model.upPct + "% of the time in situations like today's" : "");
    // Portfolio fit: what a position at the investor's maximum size would have done to their portfolio over the past year.
    let fit = null;
    if (total > 0 && hs && MD.rebalance) {
      e = S.step("run", "Measuring how a " + cap + "% position would fit your portfolio");
      try {
        const P = await Promise.race([MD.rebalance.previewBuy(app, asset, { pct: cap, pv, history: hs }), new Promise((_, rej) => setTimeout(() => rej(new Error("timed out")), 45000))]), t = P.t;
        fit = { testedPositionPctOfPortfolio: cap, correlationWithPortfolio: t.corr != null ? +t.corr.toFixed(2) : null, portfolioVolPct: { before: r1(t.volBefore), after: r1(t.volAfter) }, worstDrop1yPct: { before: r1(t.ddBefore), after: r1(t.ddAfter) }, weightAfterPct: r1(t.weightAfter) };
        S.done(e, "ok", " → correlation " + (fit.correlationWithPortfolio ?? "—") + ", volatility " + fit.portfolioVolPct.before + "% → " + fit.portfolioVolPct.after + "%");
      } catch (err) { S.done(e, "fail", " → " + U.errorText(err)); }
    }
    // Machine learning on the asset's own history (3-month horizon, the longest the history supports), validated out of sample.
    let ml = null;
    if (MD.mlView) {
      e = S.step("run", "Training the machine-learning model on " + asset.symbol + "'s history");
      try { ml = MD.mlView.compact(await MD.mlView.run(app, asset, 91)); S.done(e, "ok", " → " + ml.upPct + "% up in 3 months, " + (ml.edgeOutOfSample ? "beat the base rate out of sample (Brier skill " + ml.outOfSample.brierSkillPct + "%)" : "no edge out of sample")); }
      catch (err) { S.done(e, "fail", " → " + U.errorText(err)); }
    }
    const measured = { symbol: asset.symbol, name: (q && q.name) || asset.name, class: asset.cls, price: q ? q.price : null, horizonDays: days, investor: { risk: prof.risk || "mid", horizon: prof.horizon || "mid", maxPositionPct: cap, income: !!prof.income },
      baseRates: br ? { modelUpPct: br.model.upPct, overallUpPct: r1(br.overall.upPct), independent: br.overall.independent, typicalIfUpPct: br.model.avgUpPct, typicalIfDownPct: br.model.avgDownPct, conditions: br.conditions.map(c => ({ condition: c.label, upPct: r1(c.upPct), windows: c.n })) } : null,
      risk: st ? { volPct: r1(st.volPct), maxDrawdown1yPct: r1(st.maxDrawdownPct), return1yPct: r1(st.changePct) } : null, trend: tech ? { trend: tech.trend, rsi14: r1(tech.rsi14), fromHighPct: r1(tech.fromHighPct) } : null,
      yourPosition: position, portfolioValue: total ? Math.round(total) : null, portfolioFit: fit, mlModel: ml, nextEarnings: q && q.nextEarnings || null };
    // Wall Street's average 1-year target (Nasdaq's summary) and, when the investor read their holdings' news lately, its tone.
    if (asset.cls === "stock") try { const pr = await D.stocks.profile(asset.symbol, "stock"); if (pr && pr.target1y > 0 && q && q.price > 0) measured.analystsOneYearTarget = { price: pr.target1y, upsidePct: r1((pr.target1y / q.price - 1) * 100) }; } catch {}
    { const sd = MD.sentiment && MD.sentiment.latest(app), row = sd && Date.now() - sd.at < 3 * 864e5 ? sd.rows.find(r => r.symbol === asset.symbol && r.score != null) : null; if (row) measured.newsSentiment = { score: row.score, label: row.label, relevantHeadlines: row.relevant, readOn: new Date(sd.at).toISOString().slice(0, 10), summary: row.summary }; }
    const lim = await s.limits().catch(() => null);
    const tools = lim && lim.tools ? MD.ai.tools(app, S, isStock ? ["search_news", "zacks_view", "earnings_info", "insider_activity", "smart_money", "options_move", "explain_move", "market_memory", "search_web", "ml_forecast", "portfolio_fit", "open_calls"] : ["crypto_news", "search_news", "explain_move", "market_memory", "search_web", "ml_forecast", "portfolio_fit", "open_calls"]) : undefined;
    e = S.step("run", "Claude is deciding (usually 1–2 minutes)");
    const r = await s.json(`Decide what this investor should do with ${asset.symbol} (${measured.name}) over their horizon of about ${days} days: "buy", "accumulate" (add slowly), "hold", "trim", "sell", "avoid" or "wait" (for a specific level or event). Fit the decision to their risk appetite, holding period and current position (yourPosition is null if they don't own it). portfolioFit (when present) is what a position at their maximum size would have done to their portfolio over the past year: weigh diversification (low correlation) against concentration and added volatility when choosing the decision and size. mlModel is a machine-learning model trained on the asset's history and tested out of sample: lean on its odds only when edgeOutOfSample is true, and say so.
Start from the measured base rate (baseRates.modelUpPct: how often it was higher over this horizon in situations like today's) and move away only for evidence history can't know: valuation, earnings revisions, news, insiders, the market regime. ${tools ? "Use 3 to 8 tool calls; cite only URLs the tools returned." : ""} Give the chance it is higher at the horizon's end, the typical gain if it rises and loss if it falls (use the measured typical sizes unless you have a reason), an entry plan (now, in steps, or at a level), an exit plan (where you'd be wrong; where you'd take profit), and what would change the decision. Never tell them to put in an order; "wait" and "avoid" are valid.
${MD.ai.calibrationNote(MD.ai.trackRecord(app, "ai-decide"))}
${MD.ai.contextNote(app)}
${MD.ai.assetNote(app, asset)}
Measured: ${JSON.stringify(measured)}
Reply with ONLY JSON: {"decision": "buy"|"accumulate"|"hold"|"trim"|"sell"|"avoid"|"wait", "headline": "one sentence", "upProbabilityPct": 5-95, "ifUpPct": number, "ifDownPct": number, "positionSizePct": number (suggested share of the portfolio, 0 if none), "entryPlan": "...", "exitPlan": {"wrongIf": "...", "stopPct": number (loss from here that means you're wrong), "takeProfitPct": number}, "reasons": ["3-5 reasons citing the measured numbers and news"], "risks": ["..."], "changeMyMind": "...", "preMortem": "the most likely way this decision turns out wrong", "conflictJustification": "only if upProbabilityPct is 20+ points from the measured history: the evidence", "confidence": 0-100, "sources": [{"title": "...", "url": "https://..."}]}`, Object.assign({ modelTier: "complex", signal: opts.signal }, tools ? { tools } : { cache: false }));
    S.done(e, "ok");
    const decision = DECISIONS[r.decision] ? r.decision : "hold";
    let claudeUp = Math.max(5, Math.min(95, Number(r.upProbabilityPct) || 50)), conf = Math.max(0, Math.min(100, Number(r.confidence) || 0)), conflict = null;
    // The measured side: the base-rate model, averaged with the ML model when the ML beat the base rate out of sample.
    const modelUp = br ? (ml && ml.edgeOutOfSample ? Math.round((br.model.upPct + ml.upPct) / 2 * 10) / 10 : br.model.upPct) : null;
    // Conflict check: 20+ points from the measured evidence needs specific evidence, or the gap is halved.
    if (modelUp != null && Math.abs(claudeUp - modelUp) > 20) { const why = String(r.conflictJustification || "").trim(); conflict = { fromPct: Math.round(claudeUp), measuredPct: Math.round(modelUp), justification: why }; if (!why) claudeUp = modelUp + (claudeUp - modelUp) / 2; conflict.toPct = Math.round(claudeUp); }
    // Specialist panel: three more analysts estimate the same odds independently; the team's number is used.
    const lead = Math.round(claudeUp), PN = await MD.ai.panel(app, { task: "Estimate the chance " + asset.symbol + " is HIGHER in " + days + " days than now.", items: [{ id: "decision", symbol: asset.symbol, name: measured.name, horizonDays: days }], facts: measured, S, signal: opts.signal }).catch(e => { if (e && e.code === "cancelled") throw e; return null; });
    let panelInfo = null;
    if (PN && PN.decision) { const T = MD.ai.teamUp(claudeUp, PN.decision, MD.ai.panelWeights(app).weights); panelInfo = Object.assign({ lead, spread: Math.round(T.spread) }, PN.decision.by); claudeUp = T.upPct; conf = Math.max(0, conf - MD.ai.disagreementPenalty(T.spread)); }
    const bw = MD.ai.blendFor(app, "ai-decide");
    let up = modelUp != null ? bw.wClaude * claudeUp + (1 - bw.wClaude) * modelUp : claudeUp;
    const rv = await MD.ai.review(app, { task: "Should this investor " + decision + " " + asset.symbol + " over " + days + " days?", S, signal: opts.signal, facts: measured, items: [{ id: "decision", decision, upProbabilityPct: Math.round(up), reasons: r.reasons, preMortem: r.preMortem || null, specialistPanel: panelInfo, confidence: conf }] }).catch(() => null);
    const review = rv && rv.reviews[0] || null;
    if (review && review.probabilityPct != null) up = (up + review.probabilityPct) / 2;
    else if (review && review.adjustedConfidence != null && review.adjustedConfidence < conf && conf) up = 50 + (up - 50) * review.adjustedConfidence / conf;
    if (review && review.adjustedConfidence != null && review.adjustedConfidence < conf) conf = review.adjustedConfidence;
    // The learned combiner replaces the fixed pipeline once it has beaten it on the graded record; otherwise calibrate.
    const stk = MD.ai.stackFor(app, "ai-decide"), cal = stk.used ? { applied: false } : MD.ai.calibrateUp(app, "ai-decide", up);
    if (stk.used) up = stk.apply({ c: claudeUp, m: modelUp, r: review && review.probabilityPct != null ? review.probabilityPct : null, ml: ml ? ml.upPct : null }); else if (cal.applied) up = cal.upPct;
    up = Math.round(up);
    const ifUp = Math.abs(Number(r.ifUpPct)) || (br && br.model.avgUpPct) || 10, ifDown = Math.abs(Number(r.ifDownPct)) || Math.abs((br && br.model.avgDownPct) || 10);
    const math = Q.decisionMath({ upPct: up, upMovePct: ifUp, downMovePct: ifDown, capPct: cap });
    const out = { conflict, panel: panelInfo, preMortem: String(r.preMortem || ""), fit, assetId: asset.id, symbol: asset.symbol, at: Date.now(), days, decision, headline: String(r.headline || ""), upPct: up, probs: { claude: Math.round(claudeUp), model: modelUp, ml: ml ? ml.upPct : null, mlEdge: ml ? ml.edgeOutOfSample : null, reviewer: review && review.probabilityPct != null ? Math.round(review.probabilityPct) : null, final: up }, calibration: cal.applied ? cal : null, stacked: stk.used ? { n: stk.n } : null,
      ifUpPct: r1(ifUp), ifDownPct: r1(ifDown), math, aiSizePct: Math.max(0, Math.min(100, Number(r.positionSizePct) || 0)), cap, entryPlan: String(r.entryPlan || ""), exitPlan: r.exitPlan || null, reasons: (r.reasons || []).slice(0, 5).map(String), risks: (r.risks || []).slice(0, 4).map(String), changeMyMind: String(r.changeMyMind || ""), confidence: conf, review, sources: S.verify(r.sources), price: measured.price, position, toolCalls: S.calls };
    if (!app.demo && out.price > 0 && up !== 50) {
      const f = await app.store.create("forecasts", { assetId: asset.id, asset: MD.common.slim(asset), symbol: asset.symbol, source: "ai-decide", horizonDays: days, dueAt: Date.now() + days * 864e5, priceAtCreation: out.price, currency: "USD", priceSource: q ? q.source : "quote", direction: up > 50 ? "up" : "down", probability: Math.max(up, 100 - up) / 100, thesis: out.headline + " (" + decision + ")", flatBandPct: 1, claudeUpPct: out.probs.claude, modelUpPct: out.probs.model, reviewerUpPct: out.probs.reviewer ?? null, leadUpPct: out.panel ? out.panel.lead : null, panelUpPct: out.panel ? { fundamentals: out.panel.fundamentals ?? null, quant: out.panel.quant ?? null, news: out.panel.news ?? null } : null, mlUpPct: ml ? ml.upPct : null }).catch(() => null);
      out.forecastId = f && f.id;
      if (MD.paper) MD.paper.followDecision(app, out, asset).then(o => { if (o) U.toast("Paper account followed the AI decision", "Bought " + o.qty + " " + o.symbol + " with virtual money; sold when the horizon ends."); }).catch(() => {});
      await app.store.put("decisions", idOf(asset), JSON.parse(JSON.stringify(out))).catch(() => {});
    }
    return out;
  }

  function view(app, d) {
    const [label, cls] = DECISIONS[d.decision], m = d.math;
    return h("div", { class: "stack" },
      h("div", { class: "row between", style: "flex-wrap:wrap;gap:8px" }, h("span", { class: "verdict " + cls }, label), h("span", { class: "tiny muted" }, U.fmtTs(d.at) + " · over " + d.days + " days · confidence " + d.confidence + "/100")),
      h("p", {}, h("strong", {}, d.headline)),
      MD.day ? MD.day.probBar(d.upPct, "Higher in " + d.days + " days", "Lower") : null,
      m ? h("div", { class: "kpis k4" },
        h("div", { class: "kpi" }, h("span", { class: "label" }, "Expected value"), h("b", { class: "v " + (m.evPct > 0 ? "up" : m.evPct < 0 ? "down" : "") }, (m.evPct > 0 ? "+" : "") + m.evPct.toFixed(1) + "%"), h("span", { class: "s" }, d.upPct + "% × +" + d.ifUpPct + "% vs " + (100 - d.upPct) + "% × −" + d.ifDownPct + "%")),
        h("div", { class: "kpi" }, h("span", { class: "label" }, "Break-even odds"), h("b", { class: "v" }, m.breakEvenUpPct + "%"), h("span", { class: "s" }, "chance up needed for this payoff")),
        h("div", { class: "kpi" }, h("span", { class: "label" }, "Size ceiling (maths)"), h("b", { class: "v" }, m.ceilingPct + "%"), h("span", { class: "s" }, "¼ Kelly, capped at your " + d.cap + "% max")),
        h("div", { class: "kpi" }, h("span", { class: "label" }, "Claude suggests"), h("b", { class: "v" }, d.aiSizePct + "%"), h("span", { class: "s" }, d.position ? "you hold " + (d.position.weightPct ?? "—") + "% now" : "of the portfolio"))) : null,
      d.aiSizePct > (m ? m.ceilingPct : 100) + 0.5 ? h("p", { class: "small warn-t" }, "Claude's suggested size is above what the odds and payoff support; the smaller number is the safer one.") : null,
      d.fit ? h("p", { class: "small" }, h("strong", {}, "Portfolio fit: "), "correlation " + (d.fit.correlationWithPortfolio ?? "—") + " with your holdings; a " + d.fit.testedPositionPctOfPortfolio + "% position would have taken the portfolio's volatility from " + d.fit.portfolioVolPct.before + "% to " + d.fit.portfolioVolPct.after + "% and its worst drop from " + d.fit.worstDrop1yPct.before + "% to " + d.fit.worstDrop1yPct.after + "% over the past year (measured).") : null,
      d.entryPlan ? h("p", { class: "small" }, h("strong", {}, "Entry: "), d.entryPlan) : null,
      d.preMortem ? h("p", { class: "small" }, h("strong", {}, "Pre-mortem (how it most likely goes wrong): "), d.preMortem) : null,
      d.panel ? h("p", { class: "tiny muted" }, "Specialist panel: fundamentals " + (d.panel.fundamentals ?? "—") + "%, quant " + (d.panel.quant ?? "—") + "%, news & macro " + (d.panel.news ?? "—") + "% · lead analyst " + d.panel.lead + "% (spread ±" + d.panel.spread + ")") : null,
      d.conflict ? h("p", { class: "tiny muted" }, "Conflict check: Claude said " + d.conflict.fromPct + "% against the measured " + d.conflict.measuredPct + "%" + (d.conflict.justification ? "; kept because " + d.conflict.justification : "; no specific evidence, so the gap was halved to " + d.conflict.toPct + "%") + ".") : null,
      d.exitPlan ? h("p", { class: "small" }, h("strong", {}, "Exit: "), "wrong if " + (d.exitPlan.wrongIf || "—") + (d.exitPlan.stopPct ? " (about −" + Math.abs(d.exitPlan.stopPct) + "%)" : "") + (d.exitPlan.takeProfitPct ? "; take profit around +" + Math.abs(d.exitPlan.takeProfitPct) + "%" : "")) : null,
      MD.ai.list("Why", d.reasons), MD.ai.list("Risks", d.risks), d.changeMyMind ? h("p", { class: "small" }, h("strong", {}, "Would change the decision: "), d.changeMyMind) : null,
      h("p", { class: "tiny muted" }, "Claude " + d.probs.claude + "%" + (d.probs.model != null ? " · the asset's own history " + d.probs.model + "%" : "") + (d.probs.reviewer != null ? " · reviewer " + d.probs.reviewer + "%" : "") + (d.calibration ? " · calibrated from " + d.calibration.scored + " graded decisions" : "") + " · final " + d.upPct + "%."),
      MD.ai.reviewBadge(d.review), MD.ai.sources(d.sources),
      d.price > 0 && d.exitPlan && (d.exitPlan.stopPct || d.exitPlan.takeProfitPct) ? h("button", { class: "btn ghost sm", type: "button", onclick: async (ev) => {
        const a = { id: d.assetId, cls: String(d.assetId).split(":")[0], symbol: d.symbol }, base = { assetId: d.assetId, cls: a.cls, symbol: d.symbol, state: { armed: true } };
        const stop = d.exitPlan.stopPct ? +(d.price * (1 - Math.abs(d.exitPlan.stopPct) / 100)).toPrecision(6) : null, tp = d.exitPlan.takeProfitPct ? +(d.price * (1 + Math.abs(d.exitPlan.takeProfitPct) / 100)).toPrecision(6) : null;
        if (stop) await app.store.create("alerts", Object.assign({}, base, { kind: "below", threshold: stop, note: "AI decision on " + d.symbol + ": the level where it's wrong (" + (d.exitPlan.wrongIf || "stop") + ")" }));
        if (tp) await app.store.create("alerts", Object.assign({}, base, { kind: "above", threshold: tp, note: "AI decision on " + d.symbol + ": take-profit area" }));
        ev.currentTarget.disabled = true; ev.currentTarget.textContent = "Alerts set"; U.toast("Alerts set for " + d.symbol, [stop && "below " + stop, tp && "above " + tp].filter(Boolean).join(" and "));
      } }, "Alerts at the stop and take-profit") : null,
      MD.paper && (d.decision === "buy" || d.decision === "accumulate") ? MD.paper.button(app, { id: d.assetId, cls: String(d.assetId).split(":")[0], symbol: d.symbol, name: d.name || d.symbol }, { source: "ai-decide", pct: d.math && d.math.ceilingPct > 0 ? d.math.ceilingPct : 5, note: (DECISIONS[d.decision] || [d.decision])[0] + " · " + d.upPct + "% up over " + d.days + " days" }, "Paper trade this decision") : null,
      h("p", { class: "tiny muted" }, d.forecastId ? "Logged in the forecast journal and graded in " + d.days + " days. Not advice: you decide and place any order yourself." : "Not advice: you decide and place any order yourself."));
  }
  function card(app, asset) {
    const out = h("div", { class: "stack" }), log = MD.ai.logBox(), phase = h("span", { class: "small muted" });
    const sec = U.section("AI decision: buy, hold or avoid?", h("div", { class: "stack" }, out, h("details", {}, h("summary", { class: "label", style: "cursor:pointer" }, "Research steps"), log))); sec.id = "sec-decide";
    const saved = app.store.cached("decisions").find(x => x.id === idOf(asset));
    const prof = app.settings.profile || {};
    const btn = h("button", { class: "btn", type: "button", onclick: async () => {
      btn.disabled = true; log.clear(); phase.textContent = "Working…";
      try { const d = await decide(app, asset, { onLog: (e) => log.add(e) }); out.replaceChildren(view(app, d)); phase.textContent = ""; btn.textContent = "Decide again"; }
      catch (e) { phase.textContent = MD.ai.errText(e); }
      btn.disabled = false;
    } }, saved ? "Decide again" : "Should I buy, hold or avoid?");
    out.append(saved ? view(app, saved) : h("p", { class: "small muted" }, "For your profile (" + (MD.ai.RISK[prof.risk] || MD.ai.RISK.mid) + ", holding " + (MD.ai.HZ[prof.horizon] || MD.ai.HZ.mid) + "; change it in Settings), using the asset's own odds over that horizon, your current position, news, valuation and the desk's record."));
    sec.querySelector(".bd").prepend(h("div", { class: "row", style: "gap:8px;align-items:center;flex-wrap:wrap" }, btn, phase));
    return sec;
  }

  MD.decide = { decide, card, view, DECISIONS };
})(typeof window !== "undefined" ? window : globalThis);
