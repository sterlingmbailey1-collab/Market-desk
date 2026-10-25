/* Earnings preview: the page measures the last four reports (EPS vs consensus, the stock's two-day reaction),
   the consensus for the coming quarter with recent revisions, and the options-implied move to the first expiry
   after the report; Claude then writes a reviewed preview with scenario probabilities. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const C = MD.core, U = MD.ui, D = MD.data, h = U.h, A = () => MD.ai;
  const dayT = (ymd) => Date.parse(ymd + "T00:00:00Z") / 1000;
  const r1 = (x) => x == null || !isFinite(x) ? null : +Number(x).toFixed(1);
  // Two-day reaction: last close before the report day to the first close after it (covers pre- and post-market reports).
  function reaction(points, reported) {
    const t = dayT(reported);
    let before = null, after = null;
    for (const p of points) { if (p.time < t) before = p; else if (p.time > t + 43200) { after = p; break; } }
    return before && after && after.time - t < 6 * 86400 ? ((after.close ?? after.value) / (before.close ?? before.value) - 1) * 100 : null;
  }
  async function measure(app, a) {
    const sym = a.symbol;
    const [surp, fc, q, hs] = await Promise.all([D.stocks.earningsSurprise(sym).catch(() => []), D.stocks.earningsForecast(sym).catch(() => null), app.quote(a).catch(() => null), D.historyFor(a, "3Y").catch(() => D.historyFor(a, "1Y")).catch(() => null)]);
    const past = surp.map(s => Object.assign({}, s, { reactionPct: hs ? reaction(hs.points, s.reported) : null }));
    const moves = past.map(p => p.reactionPct).filter(x => x != null);
    const next = q && q.nextEarnings ? Date.parse(q.nextEarnings) : NaN;
    const nextDate = isFinite(next) ? new Date(next).toISOString().slice(0, 10) : null;
    let implied = null;
    if (nextDate && q && q.price && next - Date.now() < 50 * 864e5 && next > Date.now() - 864e5) {
      try { const om = await D.stocks.optionMoves(sym, q.price); const m = om.moves.find(x => Date.parse(x.expiry) >= next) || null; if (m) implied = { expiry: m.expiry, days: m.days, movePct: m.movePct, asOf: om.asOf, source: om.source }; } catch {}
    }
    const nq = fc && fc.quarterly[0] || null, ny = fc && fc.yearly[0] || null;
    if (!past.length && !nq && !nextDate) throw new D.DataError("not_found", "Nasdaq has no earnings data for " + sym + ".", "nasdaq");
    return { symbol: sym, name: (q && q.name) || a.name, price: q && q.price, nextDate, daysToNext: nextDate ? Math.round((next - Date.now()) / 864e5) : null, past, beats: past.filter(p => p.surprisePct > 0).length,
      avgAbsReactionPct: moves.length ? moves.reduce((s, x) => s + Math.abs(x), 0) / moves.length : null, nextQuarter: nq, nextYear: ny, implied, historySource: hs && hs.source };
  }
  function panel(el, app, a) {
    U.async(el, () => measure(app, a), (m) => {
      const ratio = m.implied && m.avgAbsReactionPct ? m.implied.movePct / m.avgAbsReactionPct : null;
      el.append(h("div", { class: "kpis k4" },
        h("div", { class: "kpi" }, h("span", { class: "label" }, "Next report"), h("span", { class: "v" }, m.nextDate ? U.fmtDate(m.nextDate) : "Not announced"), m.daysToNext != null ? h("span", { class: "s" }, m.daysToNext >= 0 ? "in " + m.daysToNext + " days" : "reported") : null),
        h("div", { class: "kpi" }, h("span", { class: "label" }, "Consensus EPS " + (m.nextQuarter ? m.nextQuarter.period : "")), h("span", { class: "v" }, m.nextQuarter && m.nextQuarter.consensus != null ? "$" + m.nextQuarter.consensus.toFixed(2) : "—"), m.nextQuarter ? h("span", { class: "s" }, "range $" + m.nextQuarter.low + "–$" + m.nextQuarter.high + " · " + m.nextQuarter.estimates + " estimates · revisions ↑" + (m.nextQuarter.up || 0) + " ↓" + (m.nextQuarter.down || 0)) : null),
        h("div", { class: "kpi" }, h("span", { class: "label" }, "Options price a move of"), h("span", { class: "v" }, m.implied ? "±" + m.implied.movePct.toFixed(1) + "%" : "—"), h("span", { class: "s" }, m.implied ? "to " + m.implied.expiry + " (includes normal day-to-day moves)" : "no expiry after the report yet")),
        h("div", { class: "kpi" }, h("span", { class: "label" }, "Typical reaction"), h("span", { class: "v" }, m.avgAbsReactionPct != null ? "±" + m.avgAbsReactionPct.toFixed(1) + "%" : "—"), h("span", { class: "s" }, ratio ? "options price " + (ratio > 1.15 ? "more than" : ratio < 0.85 ? "less than" : "about") + " the usual reaction" : "average two-day move, last " + m.past.length + " reports"))),
        m.past.length ? U.table([{ t: "Quarter", v: "quarter" }, { t: "Reported", v: (p) => U.fmtDate(p.reported) }, { t: "EPS", v: (p) => p.eps != null ? "$" + p.eps.toFixed(2) : "—", n: true }, { t: "Consensus", v: (p) => p.consensus != null ? "$" + p.consensus.toFixed(2) : "—", n: true }, { t: "Surprise", v: (p) => U.chg(p.surprisePct, 1), n: true }, { t: "2-day reaction", v: (p) => p.reactionPct != null ? U.chg(p.reactionPct, 1) : "—", n: true }], m.past) : null,
        U.status({ status: "Delayed", source: "Nasdaq earnings surprise and analyst forecast" + (m.historySource ? "; reactions from " + m.historySource + " daily closes" : ""), note: m.beats + " of " + m.past.length + " recent reports beat consensus. A beat is common; the reaction depends on guidance." }),
        U.section("AI earnings preview", MD.oppAI.runner(app, "Write an AI earnings preview", (S, signal) => preview(app, m, S, signal), previewView)));
    }, { loading: "Loading earnings history and forecasts…" });
  }
  async function preview(app, m, S, signal) {
    const lim = await app.caps.sample.limits().catch(() => null);
    const tools = lim && lim.tools ? A().tools(app, S, ["search_news", "zacks_view", "stock_snapshot", "search_web"]) : undefined;
    const facts = A().rnd({ symbol: m.symbol, name: m.name, price: m.price, nextReport: m.nextDate, daysToNext: m.daysToNext, nextQuarterConsensus: m.nextQuarter, nextYearConsensus: m.nextYear, lastFourReports: m.past, beatsOfLastFour: m.beats, avgAbsTwoDayReactionPct: m.avgAbsReactionPct, optionsImpliedMove: m.implied });
    const prompt = `Today is ${new Date().toISOString().slice(0, 10)}. Write an earnings preview for ${m.name || m.symbol} (${m.symbol}) from the measured data below. ${tools ? "Use 2 to 6 tool calls: search_news for what the market expects and recent company news (one focused query each), zacks_view for estimate revisions and the Zacks view. Cite only URLs the tools returned." : ""}
Be specific about what matters this quarter (guidance, margins, segments, demand signals). Use the measured beat rate and typical reaction as the base rate; the options-implied move includes normal daily moves until that expiry. Never invent figures. No advice to trade.
${A().calibrationNote(A().trackRecord(app))}
Measured: ${JSON.stringify(facts)}
Reply with ONLY JSON: {"setup": "2-3 sentences", "watch": ["3-5 metrics or topics that will decide the reaction"], "bulls": "what bulls need to hear", "bears": "what bears fear",
 "scenarios": [{"name": "Beat and raise"|"In line"|"Miss or weak guide", "probabilityPct": number, "likelyMovePct": number (signed), "why": "..."}],
 "moveView": "bigger"|"in line"|"smaller", "moveWhy": "versus the options-implied move", "confidence": 0-100, "sources": [{"title": "...", "url": "https://..."}]}`;
    const r = await app.caps.sample.json(prompt, Object.assign({ modelTier: "complex", signal }, tools ? { tools } : { cache: false }));
    if (!r || !r.setup) throw Object.assign(new Error("The answer came back unreadable; try again."), { code: "invalid_json" });
    let sc = (r.scenarios || []).slice(0, 4).map(x => ({ name: String(x.name || ""), p: Math.max(0, Number(x.probabilityPct) || 0), move: Number(x.likelyMovePct) || 0, why: String(x.why || "") }));
    const tot = sc.reduce((s, x) => s + x.p, 0); if (tot > 0) sc = sc.map(x => Object.assign(x, { p: x.p / tot * 100 }));
    const res = { setup: String(r.setup), watch: (r.watch || []).slice(0, 5).map(String), bulls: String(r.bulls || ""), bears: String(r.bears || ""), scenarios: sc, expectedMove: sc.reduce((s, x) => s + x.p / 100 * x.move, 0), moveView: String(r.moveView || ""), moveWhy: String(r.moveWhy || ""), sources: S.verify(r.sources), implied: m.implied };
    const rv = await A().review(app, { task: "An earnings preview for " + m.symbol, S, signal, facts, items: [{ id: "preview", setup: res.setup, scenarios: sc, moveView: res.moveView, confidence: Number(r.confidence) || 0, sources: res.sources.map(s => s.url) }] });
    const rev = rv && rv.reviews[0]; if (rev) res.review = rev;
    res.confidence = A().blend([{ value: rev && rev.adjustedConfidence != null ? rev.adjustedConfidence : Number(r.confidence) || 0, weight: 0.7 }, { value: Math.min(100, res.sources.filter(s => s.verified).length * 25 + 20), weight: 0.3 }]);
    return res;
  }
  const previewView = (r) => h("div", { class: "stack" },
    h("div", { class: "row between", style: "flex-wrap:wrap;gap:8px" }, h("p", { style: "margin:0;flex:1 1 300px" }, r.setup), h("span", { class: "small" }, "Confidence ", h("b", {}, String(r.confidence)))),
    U.table([{ t: "Scenario", v: "name" }, { t: "Probability", v: (x) => x.p.toFixed(0) + "%", n: true }, { t: "Likely move", v: (x) => U.chg(x.move, 1), n: true }, { t: "Why", v: "why" }], r.scenarios),
    h("p", { class: "small" }, h("strong", {}, "Probability-weighted move: "), U.chg(r.expectedMove, 1), r.implied ? " · options price ±" + r.implied.movePct.toFixed(1) + "%" : "", r.moveView ? " · Claude expects a " + r.moveView + " move than implied" + (r.moveWhy ? ": " + r.moveWhy : "") : ""),
    h("div", { class: "bullbear" }, h("div", { class: "bb up" }, h("span", { class: "label" }, "What bulls need"), h("p", { class: "small" }, r.bulls)), h("div", { class: "bb down" }, h("span", { class: "label" }, "What bears fear"), h("p", { class: "small" }, r.bears))),
    A().list("What will decide the reaction", r.watch), A().reviewBadge(r.review), A().sources(r.sources),
    h("p", { class: "tiny muted" }, "Scenario probabilities are Claude's, normalised to 100%, from the measured history and the sources retrieved; checked by a second review. Not advice."));

  MD.earnings = { measure, panel, reaction };
})(typeof window !== "undefined" ? window : globalThis);
