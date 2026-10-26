/* Portfolio stress test and rebalancing helper. Both are deterministic: the stress test applies the measured
   beta and the past year's worst moves to today's value; the rebalancer shows what a target mix would take
   (trades, estimated costs, resulting volatility and diversification) without placing anything. Claude can
   then weigh a chosen rebalance with the research tools and the review pass. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const C = MD.core, U = MD.ui, D = MD.data, h = U.h;
  const bare = (x, dp = 1) => x == null || !isFinite(x) ? "—" : x.toFixed(dp) + "%";

  // Target weights (fractions summing to 1) for a strategy. items: [{weight, volPct?, fixed?}].
  function targets(items, strategy, opts = {}) {
    const n = items.length; if (!n) return [];
    if (strategy === "equal") return items.map(() => 1 / n);
    // Minimum volatility (capped) and equal risk contribution use the measured covariance of the holdings with history;
    // holdings without history (cash, cards…) keep their weight.
    if (strategy === "minvol" || strategy === "erc") {
      const idx = items.map(it => (opts.symbols || []).indexOf(it.symbol)), live = idx.map((k, i) => [k, i]).filter(([k]) => k >= 0);
      if (live.length < 2 || !opts.cov) return items.map(it => it.weight);
      const sub = live.map(([k]) => live.map(([k2]) => opts.cov[k][k2])), fixedW = items.reduce((s, it, i) => s + (idx[i] < 0 ? it.weight : 0), 0);
      const w = strategy === "minvol" ? MD.quant.minVarWeights(sub, Math.min(1, (Number(opts.cap) || 0.4) / Math.max(1e-9, 1 - fixedW))) : MD.quant.ercWeights(sub);
      const out = items.map(it => it.weight); live.forEach(([, i], j) => { out[i] = (1 - fixedW) * w[j]; }); return out;
    }
    if (strategy === "invvol") {
      const priced = items.filter(it => it.volPct > 0), fixedW = items.filter(it => !(it.volPct > 0)).reduce((s, it) => s + it.weight, 0);
      const inv = priced.reduce((s, it) => s + 1 / it.volPct, 0);
      return items.map(it => it.volPct > 0 ? (1 - fixedW) * (1 / it.volPct) / inv : it.weight);
    }
    // cap: no position above `cap`; the excess goes to the others in proportion to their weights.
    const cap = Math.max(1 / n, Math.min(1, Number(opts.cap) || 0.2));
    let w = items.map(it => it.weight);
    for (let iter = 0; iter < 50; iter++) {
      const over = w.map(x => Math.max(0, x - cap)), excess = over.reduce((s, x) => s + x, 0);
      if (excess < 1e-9) break;
      w = w.map(x => Math.min(x, cap));
      const room = w.map(x => x < cap - 1e-12 ? x : 0), roomSum = room.reduce((s, x) => s + x, 0);
      if (roomSum <= 0) break;
      w = w.map((x, i) => room[i] ? x + excess * room[i] / roomSum : x);
    }
    return w;
  }
  // Annualized volatility (%) of a weighting, from the measured covariance of the holdings with history.
  function volOf(m, weightsBySymbol) {
    const w = m.live.map(it => weightsBySymbol.get(it.symbol) || 0);
    let v = 0; for (let i = 0; i < w.length; i++) for (let j = 0; j < w.length; j++) v += w[i] * w[j] * m.cov[i][j];
    return Math.sqrt(Math.max(v, 0)) * 100;
  }
  function plan(app, m, strategy, opts) {
    const items = m.items.map(it => ({ symbol: it.symbol, name: it.name, cls: it.cls, weight: it.weight, value: it.value, volPct: it.volPct }));
    const t = targets(items, strategy, Object.assign({ cov: m.cov, symbols: m.live.map(x => x.symbol) }, opts));
    const rows = items.map((it, i) => {
      const trade = (t[i] - it.weight) * m.total, ex = app.exitAssumption(it.cls, "USD", m.R);
      return Object.assign({}, it, { target: t[i], trade, cost: Math.abs(trade) * ((ex.exitCostPct || 0) + (ex.fxSpreadPct || 0)) / 100 });
    });
    const newW = new Map(rows.map(r => [r.symbol, r.target]));
    const hhi = rows.reduce((s, r) => s + r.target * r.target, 0);
    // Each holding's share of the portfolio's risk (variance), before and after, from the measured covariance.
    const share = (wOf) => { const w = m.live.map(x => wOf(x.symbol) || 0), s = MD.quant.riskShares(m.cov, w); return new Map(m.live.map((x, i) => [x.symbol, s[i]])); };
    const rsB = share((s) => (items.find(it => it.symbol === s) || {}).weight), rsA = share((s) => newW.get(s));
    for (const r of rows) { r.riskBefore = rsB.get(r.symbol) ?? null; r.riskAfter = rsA.get(r.symbol) ?? null; }
    return { rows, volBefore: m.volPct, volAfter: volOf(m, newW), effBefore: m.effective, effAfter: hhi > 0 ? 1 / hhi : 0, turnover: rows.reduce((s, r) => s + Math.abs(r.trade), 0) / 2, cost: rows.reduce((s, r) => s + r.cost, 0) };
  }

  function stress(app, m) {
    const money = (v) => U.money(v, m.R);
    const beta = m.beta ? m.beta.beta : null;
    const daily = m.series.slice(1).map((p, i) => p.value / m.series[i].value - 1), worstDay = daily.length ? Math.min(...daily) * 100 : null;
    const rows = [];
    for (const mv of [-20, -10, 10]) if (beta != null) rows.push({ s: "S&P 500 " + (mv > 0 ? "rises " : "falls ") + Math.abs(mv) + "%", pct: beta * mv, how: "beta " + beta.toFixed(2) + " × market move" });
    if (m.top) rows.push({ s: m.top.symbol + " (largest position) falls 30%", pct: m.top.weight * -30, how: bare(m.top.weight * 100) + " weight × −30%" });
    if (worstDay != null) rows.push({ s: "Repeat of the past year's worst day", pct: worstDay, how: "this mix's worst daily move" });
    if (m.stats && m.stats.maxDrawdownPct != null) rows.push({ s: "Repeat of the past year's deepest drawdown", pct: m.stats.maxDrawdownPct > 0 ? -m.stats.maxDrawdownPct : m.stats.maxDrawdownPct, how: "peak-to-trough for this mix" });
    return h("div", { class: "stack" }, U.table([{ t: "Scenario", v: "s" }, { t: "Portfolio move", v: (r) => U.chg(r.pct, 1), n: true }, { t: "In " + m.R, v: (r) => h("span", { class: "num " + U.signCls(r.pct) }, money(m.total * r.pct / 100)), n: true }, { t: "Based on", v: (r) => h("span", { class: "tiny muted" }, r.how) }], rows),
      h("p", { class: "tiny muted" }, "Linear estimates from the past year's measured behaviour. In a real sell-off correlations rise and losses are often larger than beta implies."));
  }

  function section(app, m) {
    const st = Object.assign({ strategy: "cap", cap: 20 }, app.ls.get("rebal", {}));
    const out = h("div", { class: "stack" }), ai = h("div", { class: "stack" });
    const strat = h("select", { class: "rebal-strat", style: "width:auto", "aria-label": "Rebalancing strategy" }, [["cap", "Cap any position at…"], ["equal", "Equal weight"], ["invvol", "Weight by inverse volatility (simple risk parity)"], ["erc", "Equal risk contribution (risk parity)"], ["minvol", "Minimum volatility, no position above…"]].map(([v, l]) => h("option", { value: v, selected: v === st.strategy }, l)));
    const cap = h("input", { type: "number", min: 5, max: 100, step: 5, value: st.cap, style: "width:80px" });
    const paint = () => {
      st.strategy = strat.value; st.cap = Math.max(5, Math.min(100, Number(cap.value) || 20)); app.ls.set("rebal", st);
      cap.hidden = st.strategy !== "cap" && st.strategy !== "minvol";
      const p = plan(app, m, st.strategy, { cap: st.cap / 100 });
      const money = (v) => U.money(v, m.R);
      out.replaceChildren(
        h("div", { class: "kpis k4" },
          h("div", { class: "kpi" }, h("span", { class: "label" }, "Volatility"), h("span", { class: "v" }, bare(p.volBefore) + " → " + bare(p.volAfter)), h("span", { class: "s" }, "measured covariance, past year")),
          h("div", { class: "kpi" }, h("span", { class: "label" }, "Diversification"), h("span", { class: "v" }, p.effBefore.toFixed(1) + " → " + p.effAfter.toFixed(1)), h("span", { class: "s" }, "effective number of holdings")),
          h("div", { class: "kpi" }, h("span", { class: "label" }, "Turnover"), h("span", { class: "v" }, money(p.turnover)), h("span", { class: "s" }, bare(p.turnover / m.total * 100) + " of the portfolio")),
          h("div", { class: "kpi" }, h("span", { class: "label" }, "Estimated costs"), h("span", { class: "v" }, money(p.cost)), h("span", { class: "s" }, "your fee and spread assumptions; taxes not included"))),
        U.table([{ t: "Holding", v: (r) => h("span", { class: "who sym" }, h("b", {}, r.symbol), h("span", { class: "tiny muted" }, String(r.name || "").slice(0, 24))) }, { t: "Now", v: (r) => bare(r.weight * 100), n: true }, { t: "Target", v: (r) => bare(r.target * 100), n: true },
          { t: "Change", v: (r) => Math.abs(r.trade) < m.total * 0.001 ? h("span", { class: "faint" }, "—") : h("span", { class: "num " + (r.trade > 0 ? "up" : "down") }, (r.trade > 0 ? "Add " : "Trim ") + money(Math.abs(r.trade))), n: true }, { t: "Volatility", v: (r) => bare(r.volPct), n: true }, { t: "Share of risk", v: (r) => r.riskBefore == null ? "—" : bare(r.riskBefore * 100) + " → " + bare(r.riskAfter * 100), n: true }], p.rows.slice().sort((a, b) => b.weight - a.weight)),
        h("p", { class: "tiny muted" }, "A what-if, not an instruction: Market Desk never places trades. Selling can realise taxable gains, and adding new money to underweight holdings can get you most of the way without selling."));
      ai.replaceChildren(MD.oppAI.runner(app, "Ask Claude about this rebalance", (S, signal) => weigh(app, m, p, st, S, signal), aiView, { primary: false }));
    };
    strat.onchange = paint; cap.oninput = () => { clearTimeout(cap._t); cap._t = setTimeout(paint, 250); };
    paint();
    return h("div", { class: "stack" }, h("div", { class: "row", style: "gap:8px;flex-wrap:wrap" }, strat, cap), out, ai);
  }
  async function weigh(app, m, p, st, S, signal) {
    const lim = await app.caps.sample.limits().catch(() => null);
    const tools = lim && lim.tools ? MD.ai.tools(app, S, ["search_news", "zacks_view", "stock_snapshot", "compare_returns"]) : undefined;
    const facts = MD.ai.rnd({ reportingCurrency: m.R, totalValue: m.total, strategy: ({ cap: "cap positions at " + st.cap + "%", equal: "equal weight", invvol: "inverse volatility (simple risk parity)", erc: "equal risk contribution (risk parity)", minvol: "minimum volatility, no position above " + st.cap + "%" })[st.strategy] || st.strategy, volatilityPctBefore: p.volBefore, volatilityPctAfter: p.volAfter, effectiveHoldingsBefore: p.effBefore, effectiveHoldingsAfter: p.effAfter, turnover: p.turnover, estimatedCosts: p.cost, betaVsSPY: m.beta ? m.beta.beta : null,
      changes: p.rows.filter(r => Math.abs(r.trade) >= m.total * 0.001).map(r => ({ symbol: r.symbol, class: r.cls, weightNowPct: r.weight * 100, targetPct: r.target * 100, trade: r.trade, volPct: r.volPct })) });
    const r = await app.caps.sample.json(`Today is ${new Date().toISOString().slice(0, 10)}. The investor is considering this rebalance of their portfolio (measured by the app). ${tools ? "Use 2 to 5 tool calls on the biggest trims and adds (search_news, zacks_view or stock_snapshot) so the trade-offs reflect what's happening now. Cite only URLs the tools returned." : ""}
${MD.ai.contextNote(app)}
Weigh it honestly: risk reduction versus giving up exposure to what has worked, costs and taxes, and gentler alternatives (direct new money to underweights, rebalance in steps, set bands). Doing nothing can be right. Never invent figures; never instruct a trade.
Plan: ${JSON.stringify(facts)}
Reply with ONLY JSON: {"verdict": "Sensible"|"Partly sensible"|"Not worth it now", "summary": "2-3 sentences", "pros": ["..."], "cons": ["..."], "gentlerPath": "a gentler way to get most of the benefit", "biggestRisk": "...", "confidence": 0-100, "sources": [{"title": "...", "url": "https://..."}]}`, Object.assign({ modelTier: "default", signal }, tools ? { tools } : { cache: false }));
    if (!r || !r.summary) throw Object.assign(new Error("The answer came back unreadable; try again."), { code: "invalid_json" });
    const res = { verdict: String(r.verdict || ""), summary: String(r.summary), pros: (r.pros || []).slice(0, 4).map(String), cons: (r.cons || []).slice(0, 4).map(String), gentlerPath: String(r.gentlerPath || ""), biggestRisk: String(r.biggestRisk || ""), sources: S.verify(r.sources) };
    const rv = await MD.ai.review(app, { task: "Whether this rebalance is worth doing", S, signal, facts, items: [{ id: "rebalance", verdict: res.verdict, summary: res.summary, pros: res.pros, cons: res.cons, confidence: Number(r.confidence) || 0 }] });
    res.review = rv && rv.reviews[0];
    res.confidence = MD.ai.blend([{ value: res.review && res.review.adjustedConfidence != null ? res.review.adjustedConfidence : Number(r.confidence) || 0, weight: 0.75 }, { value: Math.min(100, res.sources.filter(s => s.verified).length * 25 + 25), weight: 0.25 }]);
    return res;
  }
  const aiView = (r) => h("div", { class: "stack" },
    h("div", { class: "row between", style: "flex-wrap:wrap;gap:8px" }, h("span", { class: "verdict " + (/^Sensible/.test(r.verdict) ? "positive" : /Not worth/.test(r.verdict) ? "negative" : "neutral") }, r.verdict || "Assessment"), h("span", { class: "small" }, "Confidence ", h("b", {}, String(r.confidence)))),
    h("p", {}, r.summary), h("div", { class: "bullbear" }, h("div", { class: "bb up" }, h("span", { class: "label" }, "For"), h("ul", { class: "small", style: "margin:4px 0 0;padding-left:1.1em" }, r.pros.map(x => h("li", {}, x)))), h("div", { class: "bb down" }, h("span", { class: "label" }, "Against"), h("ul", { class: "small", style: "margin:4px 0 0;padding-left:1.1em" }, r.cons.map(x => h("li", {}, x))))),
    r.gentlerPath ? h("p", { class: "small" }, h("strong", {}, "Gentler path: "), r.gentlerPath) : null, r.biggestRisk ? h("p", { class: "small" }, h("strong", {}, "Biggest risk: "), r.biggestRisk) : null,
    MD.ai.reviewBadge(r.review), MD.ai.sources(r.sources), h("p", { class: "tiny muted" }, "Claude's assessment, checked by a second review. Market Desk never places trades. Not advice."));

  /* "If you buy": what a purchase would have done to the portfolio over the past year (today's holdings and exchange
     rates held throughout), against the single-position cap for the investor's risk setting and the AI decision's size
     ceiling when there is one. Nothing is bought: the desk is read-only. */
  // Measures a purchase against today's holdings: `amount` in the reporting currency, or `pct` of the portfolio.
  async function previewBuy(app, asset, opts = {}) {
    const R = app.settings.reportingCurrency, pv = opts.pv || await app.valuePortfolio(R), m = await MD.portfolioAnalysis.measure(app, pv, R);
    if (!(m.total > 0)) throw new Error("Add holdings in Portfolio first: the preview compares a purchase with what you hold.");
    const A = opts.amount > 0 ? Number(opts.amount) : Math.round(m.total * (opts.pct > 0 ? opts.pct : 5) / 100);
    const hs = opts.history || await D.historyFor(asset, "1Y"), byDay = new Map(hs.points.map(p => [Math.floor(p.time / 86400), p.close ?? p.value]));
    let cur = null; const prices = m.series.map(p => { const d = Math.floor(p.time / 86400); if (byDay.has(d)) cur = byDay.get(d); else if (cur == null) for (let k = d; k >= d - 6; k--) if (byDay.has(k)) { cur = byDay.get(k); break; } return cur; });
    const first = prices.findIndex(x => x > 0); if (first < 0) throw new Error("No price history for " + asset.symbol + " over the past year.");
    const cash = m.items.filter(it => it.cls === "cash").reduce((s, it) => s + it.value, 0), held = m.items.filter(it => it.symbol === asset.symbol).reduce((s, it) => s + it.value, 0);
    const fromCash = opts.payFromCash !== false && cash >= A;
    const t = MD.quant.tradePreview({ values: m.series.slice(first).map(p => p.value), prices: prices.slice(first), amount: A, fromCash, existing: held });
    if (!t) throw new Error("Not enough overlapping history to measure this purchase.");
    return { t, m, A, R, cash, held, fromCash, source: hs.source };
  }
  function buyCard(app, asset) {
    const R = app.settings.reportingCurrency, out = h("div", { class: "stack" }), prof = app.settings.profile || {}, cap = ({ low: 5, mid: 10, high: 20 })[prof.risk] || 10;
    const amt = h("input", { type: "number", min: 0, step: "100", placeholder: "e.g. 1000" }), cashChk = h("input", { type: "checkbox", checked: true });
    const btn = h("button", { class: "btn ghost", type: "button" }, "Preview");
    const sec = U.section("If you buy: what it does to your portfolio", h("div", { class: "stack" },
      h("div", { class: "row", style: "gap:10px;flex-wrap:wrap;align-items:flex-end" }, U.field("Amount (" + R + ")", amt), h("label", { class: "chk" }, cashChk, "Pay from cash in the portfolio"), btn),
      h("p", { class: "tiny muted" }, "Leave the amount empty to use the AI decision's size ceiling, or 5% of the portfolio."), out)); sec.id = "sec-buy";
    btn.onclick = async () => {
      btn.disabled = true; out.replaceChildren(h("p", { class: "small muted" }, "Measuring your holdings and " + asset.symbol + " over the past year…"));
      try {
        const dec = app.store.cached("decisions").find(x => x.assetId === asset.id || x.id === String(asset.id || asset.symbol).replace(/[^\w-]/g, "_"));
        const ceil = dec && dec.math ? dec.math.ceilingPct : null;
        const P = await previewBuy(app, asset, { amount: Number(amt.value), pct: ceil > 0 ? ceil : 5, payFromCash: cashChk.checked }), { t, A, cash, fromCash } = P, hs = { source: P.source };
        amt.value = A;
        const arrow = (a, b, dp = 1) => a.toFixed(dp) + "% → " + b.toFixed(dp) + "%", dv = t.volAfter - t.volBefore;
        const notes = [];
        notes.push(Math.abs(dv) < 0.2 ? "Barely changes how much the portfolio swings." : dv < 0 ? "Lowers the portfolio's swings by " + (-dv).toFixed(1) + " points a year: " + asset.symbol + " has tended to move differently from what you hold." : "Raises the portfolio's swings by " + dv.toFixed(1) + " points a year" + (t.assetVol > t.volBefore ? " (" + asset.symbol + " swings " + t.assetVol.toFixed(0) + "% a year on its own, against the portfolio's " + t.volBefore.toFixed(0) + "%)." : "."));
        if (t.corr != null) notes.push(t.corr > 0.7 ? "It has moved closely with your portfolio (correlation " + t.corr.toFixed(2) + "), so it adds more of the same risk." : t.corr < 0.3 ? "Its moves have been largely independent of your portfolio (correlation " + t.corr.toFixed(2) + "), which helps diversify." : "Moderate correlation with your portfolio (" + t.corr.toFixed(2) + ").");
        if (t.weightAfter > cap) notes.push("It would be " + t.weightAfter.toFixed(1) + "% of the portfolio, above the " + cap + "% single-position cap for your " + (prof.risk || "mid") + " risk setting.");
        if (ceil != null) notes.push("The AI decision of " + U.fmtDate(dec.at) + " (" + ((MD.decide && MD.decide.DECISIONS[dec.decision] || [dec.decision])[0]) + ") put the size ceiling at " + ceil + "% of the portfolio; this makes it " + t.weightAfter.toFixed(1) + "%" + (t.weightAfter > ceil + 0.5 ? ", above what the odds and payoff support." : "."));
        if (cashChk.checked && !fromCash) notes.push("Not enough cash in the portfolio (" + U.money(cash, R) + "), so this is treated as new money.");
        const kpi = (l, v, s, cls) => h("div", { class: "kpi" }, h("span", { class: "label" }, l), h("b", { class: "v " + (cls || "") }, v), h("span", { class: "s" }, s));
        out.replaceChildren(
          h("div", { class: "kpis k4" }, kpi("Weight after", t.weightAfter.toFixed(1) + "%", "now " + t.weightBefore.toFixed(1) + "% · " + U.money(A, R), t.weightAfter > cap ? "down" : ""),
            kpi("Portfolio volatility", arrow(t.volBefore, t.volAfter), "yearly, before → after", dv < -0.2 ? "up" : dv > 0.2 ? "down" : ""),
            kpi("Worst drop, past year", arrow(t.ddBefore, t.ddAfter), "peak to trough", t.ddAfter < t.ddBefore - 0.5 ? "down" : t.ddAfter > t.ddBefore + 0.5 ? "up" : ""),
            kpi("Correlation", t.corr == null ? "—" : t.corr.toFixed(2), "with your portfolio's daily moves")),
          h("ul", { class: "small", style: "margin:0;padding-left:1.1em;display:grid;gap:4px" }, notes.map(x => h("li", {}, x))),
          h("p", { class: "tiny muted" }, "Over " + t.days + " trading days with today's holdings and exchange rates held constant (" + asset.symbol + " prices: " + (hs.source || "price history") + "). Past behaviour, not a forecast. Nothing is bought: the desk is read-only."));
      } catch (e) { out.replaceChildren(U.errorBox ? U.errorBox({ message: U.errorText(e) }) : h("p", { class: "small neg" }, U.errorText(e))); }
      btn.disabled = false;
    };
    return sec;
  }
  MD.rebalance = { previewBuy, buyCard, targets, volOf, plan, stress, section };
})(typeof window !== "undefined" ? window : globalThis);
