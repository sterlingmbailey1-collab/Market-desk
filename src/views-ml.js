/* Machine-learning forecast on stock and crypto pages. MD.ml is trained on the asset's own daily history (with the
   market as context: SPY, or bitcoin for coins), judged walk-forward on data it hadn't seen, and shows what drives
   today's call and the most similar past setups. The first forecast per asset, horizon and day is logged (source
   "ml") and graded like every other call, so the scorecard shows whether the model is any good. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const U = MD.ui, D = MD.data, h = U.h;
  const HZ = [["1 week", 7], ["1 month", 30], ["3 months", 91]];
  const cache = new Map();
  const pct = (x, dp = 0) => x == null || !isFinite(x) ? "—" : x.toFixed(dp) + "%";
  const sgn = (x, dp = 1) => x == null || !isFinite(x) ? "—" : (x > 0 ? "+" : "") + x.toFixed(dp) + "%";

  async function run(app, asset, days) {
    const key = asset.id + ":" + days, hit = cache.get(key);
    if (hit && Date.now() - hit.at < 30 * 60e3) return hit;
    const cls = asset.cls || String(asset.id).split(":")[0], isCoin = cls === "crypto";
    const mktSym = isCoin ? (asset.symbol === "BTC" ? null : "BTC") : (asset.symbol === "SPY" ? null : "SPY"), mkt = mktSym && MD.brain ? MD.brain.assetOf(mktSym) : null;
    const [hs, ms] = await Promise.all([D.dailyLong(asset), mkt ? D.dailyLong(mkt).catch(() => null) : null]);
    const ppy = hs.ppy || (isCoin ? 365 : 252), bars = MD.quant.barsFor(days, ppy);
    const r = MD.ml.forecast(hs.points, { horizonBars: bars, market: ms ? ms.points : null });
    if (r.error) throw new Error(r.error);
    Object.assign(r, { at: Date.now(), days, symbol: asset.symbol, source: hs.source, marketSymbol: ms ? mktSym : null });
    // Self-calibration: once the model's own logged forecasts have 10+ grades, its odds are corrected toward how often
    // calls at that level came true (as for every other AI source on the desk).
    const cal = MD.ai && MD.ai.calibrateUp ? MD.ai.calibrateUp(app, "ml", r.upPct) : null;
    if (cal && cal.applied) { r.calibration = { fromPct: r.upPct, scored: cal.scored }; r.upPct = cal.upPct; }
    cache.set(key, r);
    return r;
  }
  // The compact form given to Claude in prompts and tools.
  function compact(r) {
    if (!r) return null;
    const o = r.oos;
    return { horizonDays: r.days, upPct: +r.upPct.toFixed(1), edgeOutOfSample: r.edge, trustPct: Math.round(r.trust * 100), logisticPct: +r.models.logisticPct.toFixed(1), boostedTreesPct: r.models.treesPct != null ? +r.models.treesPct.toFixed(1) : null, similarSetupsPct: +r.models.analogsPct.toFixed(1), baseRatePct: +r.models.baseRatePct.toFixed(1),
      outOfSample: { predictions: o.predictions, independent: o.independent, accuracyPct: +(o.ensemble.accuracy * 100).toFixed(1), alwaysMajorityAccuracyPct: +(Math.max(r.models.baseRatePct, 100 - r.models.baseRatePct)).toFixed(1), brierSkillPct: +(o.skillEnsemble * 100).toFixed(1), tStatVsBaseRate: +(o.tStat || 0).toFixed(2), recentBrierSkillPct: o.recentSkill != null ? +(o.recentSkill * 100).toFixed(1) : null, edgeFadingLately: !!r.fading, auc: o.ensemble.auc != null ? +o.ensemble.auc.toFixed(3) : null },
      topDrivers: r.drivers.slice(0, 4).map(d => d.name + (d.push > 0 ? " (pushes up)" : " (pushes down)")), similarPastSetups: { n: r.analogs.length, roseAfter: r.analogs.filter(a => a.up).length },
      trainedOn: r.from + " to " + r.asOf + " (" + r.bars + " daily bars)", note: "Logistic regression + gradient-boosted trees + nearest-neighbour analogs (equal weights), walk-forward validated; the odds stay at the base rate unless the models beat it clearly out of sample (t >= 1.64 over independent blocks)." };
  }
  async function log(app, asset, r) {
    if (app.demo || Math.abs(r.upPct - 50) < 1) return null;
    const today = new Date().toISOString().slice(0, 10);
    if (app.store.cached("forecasts").some(f => f.source === "ml" && f.assetId === asset.id && f.horizonDays === r.days && new Date(f.createdAt).toISOString().slice(0, 10) === today)) return null;
    const q = await app.quote(asset, 30000).catch(() => null); if (!q || !(q.price > 0)) return null;
    return app.store.create("forecasts", { assetId: asset.id, asset: MD.common.slim(asset), symbol: asset.symbol, source: "ml", horizonDays: r.days, dueAt: Date.now() + r.days * 864e5, priceAtCreation: q.price, currency: q.currency || "USD", priceSource: q.source,
      direction: r.upPct > 50 ? "up" : "down", probability: Math.max(r.upPct, 100 - r.upPct) / 100, thesis: "Machine-learning model (" + (r.edge ? "out-of-sample Brier skill " + sgn(r.oos.skillEnsemble * 100) : "no out-of-sample edge; base rate") + ")", flatBandPct: 0 }).catch(() => null);
  }

  function view(app, asset, r) {
    const o = r.oos, hz = HZ.find(x => x[1] === r.days), label = hz ? hz[0] : r.days + " days", majority = Math.max(r.models.baseRatePct, 100 - r.models.baseRatePct);
    const kpi = (l, v, s, cls) => h("div", { class: "kpi" }, h("span", { class: "label" }, l), h("b", { class: "v " + (cls || "") }, v), s ? h("span", { class: "s" }, s) : null);
    const maxPush = Math.max(...r.drivers.map(d => Math.abs(d.push)), 1e-9);
    return h("div", { class: "stack" },
      MD.day ? MD.day.probBar(Math.round(r.upPct), "Higher in " + label, "Lower") : h("p", {}, pct(r.upPct) + " chance higher in " + label),
      h("p", { class: "small " + (r.edge ? "" : "muted") }, r.edge
        ? "Beat the base rate on data it hadn't seen, clearly across " + o.blocks + " independent stretches (t = " + o.tStat.toFixed(1) + "): Brier skill " + sgn(o.skillEnsemble * 100) + ", AUC " + (o.ensemble.auc != null ? o.ensemble.auc.toFixed(2) : "—") + ", right " + pct(o.ensemble.accuracy * 100) + " of the time against " + pct(majority) + " for always guessing the more common outcome. Its odds count with " + Math.round(r.trust * 100) + "% weight; the rest is the base rate."
        + (r.fading ? " But the edge has faded lately: over the most recent " + o.recentPredictions + " test predictions it did worse than the base rate (skill " + sgn(o.recentSkill * 100) + "), so its weight is halved." : "")
        : "No clear edge on data it hadn't seen (Brier skill " + sgn(o.skillEnsemble * 100) + " against the base rate, t = " + (isFinite(o.tStat) ? o.tStat.toFixed(1) : "—") + " across " + o.blocks + " independent stretches; 1.6 or more counts), so the odds stay at the base rate: how often " + r.symbol + " rose over " + label + " in its history. That's an honest answer, not a failure: most price patterns don't repeat reliably."),
      h("div", { class: "kpis k4" },
        kpi("Logistic model", pct(r.models.logisticPct), "Brier skill " + sgn(o.skillLogistic * 100) + " · L2 " + r.l2),
        kpi("Boosted trees", pct(r.models.treesPct), "40 small trees · skill " + sgn((o.skillTrees || 0) * 100)),
        kpi("Similar past setups", pct(r.models.analogsPct), "40 nearest days · skill " + sgn(o.skillAnalogs * 100)),
        kpi("Base rate", pct(r.models.baseRatePct), "how often it rose over " + label)),
      h("p", { class: "small muted" }, "Tested on " + o.predictions + " out-of-sample predictions (about " + o.independent + " independent " + (o.independent === 1 ? "window" : "windows") + ")" + (r.treeSplits && r.treeSplits.length ? ". The trees split most on: " + r.treeSplits.map(x => x.name.toLowerCase()).join(", ") : "") + (r.calibration ? ". Calibrated from the model's own " + r.calibration.scored + " graded forecasts (" + pct(r.calibration.fromPct) + " → " + pct(r.upPct) + ")" : "") + "."),
      o.confident.n ? h("p", { class: "small" }, "When the models leaned 60% or more one way out of sample, they were right " + o.confident.right + " of " + o.confident.n + " times (" + pct(o.confident.right / o.confident.n * 100) + ").") : null,
      o.reliability && o.reliability.length ? h("details", { class: "small" }, h("summary", { class: "label", style: "cursor:pointer" }, "Did its odds hold up? (out of sample)"),
        U.table([{ t: "When it said", v: (b) => Math.round(b.from * 100) + "–" + Math.round(b.to * 100) + "%" }, { t: "Times", v: "n", n: true }, { t: "Average odds", v: (b) => pct(b.predictedPct), n: true }, { t: "Actually rose", v: (b) => h("span", { class: Math.abs(b.actualPct - b.predictedPct) > 10 && b.n >= 20 ? "warn-t" : "" }, pct(b.actualPct)), n: true }], o.reliability),
        h("p", { class: "tiny muted" }, "Before trust and the base rate are applied: the raw ensemble's odds on data it hadn't seen. Rows with few cases say little; a gap of more than 10 points on 20+ cases is flagged.")) : null,
      h("div", { class: "grid g2", style: "align-items:start" },
        h("div", { class: "stack", style: "gap:4px" }, h("span", { class: "label" }, "What drives today's reading"),
          U.table([{ t: "Feature", v: (d) => d.name }, { t: "Today", v: (d) => d.key === "rsi" ? (d.value * 100 + 50).toFixed(0) : d.key === "last1z" || d.key === "volRatio" ? d.value.toFixed(2) : sgn(d.value * 100), n: true },
            { t: "Pushes", v: (d) => h("span", { class: d.push > 0 ? "up" : "down", style: "white-space:nowrap" }, (d.push > 0 ? "▲ " : "▼ ") + "█".repeat(Math.max(1, Math.round(Math.abs(d.push) / maxPush * 5)))) }], r.drivers.slice(0, 6))),
        h("div", { class: "stack", style: "gap:4px" }, h("span", { class: "label" }, "Most similar past days and what followed"),
          U.table([{ t: "Date", v: (a) => a.date }, { t: "Next " + label, v: (a) => h("span", { class: a.up ? "up" : "down" }, sgn(a.forwardPct)), n: true }], r.analogs),
          h("span", { class: "tiny muted" }, r.analogs.filter(a => a.up).length + " of " + r.analogs.length + " rose afterwards."))),
      h("p", { class: "tiny muted" }, "Trained on " + r.bars + " daily bars (" + r.from + " to " + r.asOf + ", " + (r.source || "price history") + ")" + (r.marketSymbol ? " with " + r.marketSymbol + " as market context" : "") + ". Logistic regression, gradient-boosted trees and nearest-neighbour analogs (equal weights) over " + r.features.length + " measured features, refitted walk-forward so every score above comes from predictions on data the model hadn't seen yet. Past patterns can stop working; this is one input, not advice."));
  }
  function card(app, asset) {
    const out = h("div", { class: "stack" }), phase = h("span", { class: "small muted" });
    let days = app.ls.get("ml.days", 30);
    const seg = h("div", {}), btn = h("button", { class: "btn ghost", type: "button" }, "Train and forecast");
    const paintSeg = () => seg.replaceChildren(U.seg(HZ.map(x => x[0]), (HZ.find(x => x[1] === days) || HZ[1])[0], (v) => { days = HZ.find(x => x[0] === v)[1]; app.ls.set("ml.days", days); paintSeg(); go(); }));
    const go = async () => {
      btn.disabled = true; phase.textContent = "Training on " + asset.symbol + "'s history…";
      try { const r = await run(app, asset, days); out.replaceChildren(view(app, asset, r)); const f = await log(app, asset, r); phase.textContent = f ? "Logged; graded in " + days + " days." : ""; }
      catch (e) { out.replaceChildren(h("p", { class: "small warn-t" }, U.errorText(e))); phase.textContent = ""; }
      btn.disabled = false;
    };
    btn.onclick = go; paintSeg();
    out.append(h("p", { class: "small muted" }, "Trains three models in your browser on this asset's measured daily history, then tests them on stretches of history they hadn't seen before showing a number."));
    const sec = U.section("Machine-learning forecast", h("div", { class: "stack" }, h("div", { class: "row", style: "gap:8px;flex-wrap:wrap;align-items:center" }, seg, btn, phase), out));
    sec.id = "sec-ml";
    return sec;
  }

  MD.mlView = { run, compact, card, log, HZ };
})(typeof window !== "undefined" ? window : globalThis);
