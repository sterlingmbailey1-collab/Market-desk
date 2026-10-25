/* Portfolio analysis: how today's holdings behaved together over the past year (value, volatility,
   drawdown, beta), where the risk comes from, how diversified it is, a projected value range, and an
   optional written review by Claude built only from these measured figures. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const C = MD.core, U = MD.ui, D = MD.data, h = U.h;
  const DAY = 86400, PRICED = new Set(["stock", "etf", "crypto", "metal", "fx"]);
  const pct = (x, dp = 1) => x == null || !isFinite(x) ? "—" : (x > 0 ? "+" : "") + x.toFixed(dp) + "%";
  const bare = (x, dp = 1) => x == null || !isFinite(x) ? "—" : x.toFixed(dp) + "%";
  async function pool(items, n, fn) { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch { out[k] = null; } } })); return out; }

  /* Measure the current holdings over the past year. Each holding's value path is its price history scaled
     to today's value in the reporting currency (today's exchange rate throughout). */
  async function measure(app, pv, R) {
    const rows = pv.rows.filter(r => r.p.qty.gt(0) && r.v.valueR && Number(r.v.valueR) > 0);
    const total = rows.reduce((a, r) => a + Number(r.v.valueR), 0);
    const hist = await pool(rows, 3, async (r) => { if (!PRICED.has(r.p.assetClass)) return null; const s = await D.historyFor(r.asset, "1Y"); return s && !s.intraday && s.points.length > 20 ? s : null; });
    const now = Math.floor(Date.now() / 1000 / DAY), days = [];
    for (let d = now - 365; d <= now; d++) { const wd = new Date(d * DAY * 1000).getUTCDay(); if (wd !== 0 && wd !== 6) days.push(d); }
    const items = rows.map((r, i) => {
      const value = Number(r.v.valueR), s = hist[i];
      let path = null;
      if (s) {
        const byDay = new Map(s.points.map(p => [Math.floor(p.time / DAY), p.close ?? p.value]));
        const firstVal = s.points[0].close ?? s.points[0].value, last = s.points[s.points.length - 1].close ?? s.points[s.points.length - 1].value;
        let cur = null; path = days.map(d => { if (byDay.has(d)) cur = byDay.get(d); else if (cur == null) { for (let k = d; k >= d - 6; k--) if (byDay.has(k)) { cur = byDay.get(k); break; } } return value * ((cur ?? firstVal) / last); });
      }
      return { r, symbol: r.p.symbol, name: r.p.name, cls: r.p.assetClass, value, weight: value / total, path, source: s && s.source };
    });
    const series = days.map((d, k) => ({ time: d * DAY, value: items.reduce((a, it) => a + (it.path ? it.path[k] : it.value), 0) }));
    // Returns and covariance of the holdings that have history (others count as constant value).
    const live = items.filter(it => it.path);
    const rets = live.map(it => it.path.slice(1).map((v, k) => Math.log(v / it.path[k])));
    const n = rets.length ? rets[0].length : 0;
    const mean = rets.map(a => a.reduce((x, y) => x + y, 0) / (a.length || 1));
    const cov = live.map((_, i) => live.map((_, j) => { let s = 0; for (let k = 0; k < n; k++) s += (rets[i][k] - mean[i]) * (rets[j][k] - mean[j]); return n > 1 ? s / (n - 1) * 252 : 0; }));
    const w = live.map(it => it.weight);
    const sw = cov.map(row => row.reduce((a, c, j) => a + c * w[j], 0));
    const varP = w.reduce((a, wi, i) => a + wi * sw[i], 0);
    live.forEach((it, i) => { it.volPct = Math.sqrt(cov[i][i]) * 100; it.riskShare = varP > 0 ? w[i] * sw[i] / varP : 0; it.ret1y = (it.path[it.path.length - 1] / it.path[0] - 1) * 100; });
    const corr = live.map((_, i) => live.map((_, j) => cov[i][i] > 0 && cov[j][j] > 0 ? cov[i][j] / Math.sqrt(cov[i][i] * cov[j][j]) : (i === j ? 1 : 0)));
    const vals = series.map(p => p.value);
    const stats = C.seriesStats(series, 252) || {};
    let beta = null; try { const spy = await D.historyFor({ id: "etf:SPY", cls: "etf", symbol: "SPY" }, "1Y"); beta = C.betaTo(series, spy.points); beta = beta && Object.assign(beta, { spy }); } catch {}
    const hhi = items.reduce((a, it) => a + it.weight * it.weight, 0);
    const sorted = items.slice().sort((a, b) => b.weight - a.weight);
    const rf = Number(app.settings.assumptions.riskFreePct || 0) / 100;
    return { R, total, items, live, series, corr, cov, volPct: Math.sqrt(Math.max(varP, 0)) * 100, stats, sharpe: C.sharpe(vals, 252, rf), beta, effective: hhi > 0 ? 1 / hhi : 0, top: sorted[0], top3: sorted.slice(0, 3).reduce((a, it) => a + it.weight, 0), classes: new Set(items.map(it => it.cls)).size, constant: items.filter(it => !it.path), ret1y: vals.length > 1 ? (vals[vals.length - 1] / vals[0] - 1) * 100 : null };
  }

  function heatmap(m) {
    const top = m.live.slice().sort((a, b) => b.weight - a.weight).slice(0, 8), idx = top.map(t => m.live.indexOf(t));
    if (top.length < 2) return h("p", { class: "small muted" }, "Correlation needs at least two holdings with price history.");
    const cell = (v) => { const a = Math.min(1, Math.abs(v)); const col = v >= 0 ? "var(--accent)" : "var(--r1)"; return h("div", { class: "hm-c", style: "background:color-mix(in srgb, " + col + " " + Math.round(a * 70) + "%, var(--sheet-2))" + (a > 0.55 ? ";color:var(--accent-ink)" : ""), title: v.toFixed(2) }, v.toFixed(2)); };
    return h("div", { class: "hm-wrap" }, h("div", { class: "hm", style: "grid-template-columns: 64px repeat(" + top.length + ", minmax(40px, 1fr))" },
      h("div", {}), top.map(t => h("div", { class: "hm-h" }, t.symbol)),
      idx.map((i, r) => [h("div", { class: "hm-h left" }, top[r].symbol), idx.map(j => cell(m.corr[i][j]))])));
  }

  function projection(app, m) {
    const box = h("div", { class: "stack" }), fan = h("div", { class: "fan" }), kpis = h("div", { class: "kpis" });
    const st = Object.assign({ days: 365, drift: "none" }, app.ls.get("pfProj", {}));
    const range = h("input", { type: "range", min: "1", max: "730", value: String(st.days), class: "hrange", "aria-label": "Projection horizon in days" }), lbl = h("strong", { class: "num" }), segBox = h("div", {});
    const drift = h("select", { "aria-label": "Expected return" }, [["none", "No view · 0%"], m.ret1y != null ? ["trend", "Past-year return of this mix · " + pct(Math.max(-90, Math.min(200, m.ret1y)))] : null].filter(Boolean).map(([k, l]) => h("option", { value: k, selected: k === st.drift }, l)));
    const R = m.R, money = (v) => U.money(v, R);
    const draw = () => {
      app.ls.set("pfProj", st);
      const hz = MD.insights.HORIZONS.find(x => x[1] === st.days);
      segBox.replaceChildren(U.seg(MD.insights.HORIZONS.map(x => x[0]), hz ? hz[0] : "", (k) => { st.days = MD.insights.HORIZONS.find(x => x[0] === k)[1]; range.value = String(st.days); draw(); }));
      lbl.textContent = st.days + (st.days === 1 ? " day" : " days") + " · " + new Date(Date.now() + st.days * 864e5).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
      const d = st.drift === "trend" && m.ret1y != null ? Math.max(-90, Math.min(200, m.ret1y)) : 0;
      const mk = (days) => C.projectPrice({ price: m.total, volPct: m.volPct, driftPct: d, days });
      const p = mk(st.days);
      if (!p) { fan.replaceChildren(h("div", { class: "empty" }, "No measurable volatility yet: add holdings with price history.")); kpis.replaceChildren(); return; }
      MD.insights.drawFan(fan, m.series, m.total, mk, st.days);
      const tile = (l, v, s, cls) => h("div", { class: "kpi " + (cls || "") }, h("span", { class: "label" }, l), h("span", { class: "v num" }, v), s ? h("span", { class: "s num" }, s) : null);
      kpis.replaceChildren(tile("Middle outcome", money(p.median), pct((p.median / m.total - 1) * 100), "hero-kpi"), tile("Likely range · 50%", money(p.p25) + " – " + money(p.p75)), tile("Wide range · 90%", money(p.p05) + " – " + money(p.p95)),
        tile("Chance it's higher", Math.round(p.probUp * 100) + "%", "than " + money(m.total) + " today"), tile("A bad year (1 in 20)", money(p.p05), pct((p.p05 / m.total - 1) * 100)), tile("Typical move (±1σ)", "±" + p.oneSigmaPct.toFixed(1) + "%", "about 2 in 3 outcomes"));
    };
    range.oninput = () => { st.days = Number(range.value); draw(); };
    drift.onchange = () => { st.drift = drift.value; draw(); };
    box.append(h("div", { class: "proj-controls" }, h("div", { class: "stack", style: "gap:6px" }, h("span", { class: "label" }, "Horizon"), segBox, h("div", { class: "row", style: "gap:10px;flex-wrap:nowrap" }, range, lbl)), h("div", { class: "form" }, U.field("Expected return a year", drift))),
      h("div", { class: "proj-grid" }, fan, kpis),
      h("p", { class: "small muted" }, "Uses the portfolio's measured volatility of " + m.volPct.toFixed(1) + "% a year, which already counts how your holdings offset each other. It assumes you keep today's holdings and add nothing. A statistical range, not a prediction; markets jump more than this model allows."));
    draw();
    return box;
  }

  async function review(app, m, out, btn) {
    const s = app.caps.sample;
    if (!s) { out.replaceChildren(U.errorBox({ message: "Claude isn't available in this view." })); return; }
    btn.disabled = true; out.replaceChildren(h("div", { class: "skeleton" }, "Claude is reviewing your portfolio…"));
    const facts = { reportingCurrency: m.R, totalValue: Math.round(m.total), holdings: m.items.map(it => ({ symbol: it.symbol, name: it.name, class: it.cls, weightPct: +(it.weight * 100).toFixed(1), return1yPct: it.ret1y != null ? +it.ret1y.toFixed(1) : null, volatilityPct: it.volPct != null ? +it.volPct.toFixed(1) : null, shareOfRiskPct: it.riskShare != null ? +(it.riskShare * 100).toFixed(1) : null, hasPriceHistory: !!it.path })),
      portfolio: { return1yOfCurrentMixPct: m.ret1y != null ? +m.ret1y.toFixed(1) : null, volatilityPct: +m.volPct.toFixed(1), maxDrawdown1yPct: m.stats.maxDrawdownPct != null ? +m.stats.maxDrawdownPct.toFixed(1) : null, sharpe: isFinite(m.sharpe) ? +m.sharpe.toFixed(2) : null, betaVsSPY: m.beta ? +m.beta.beta.toFixed(2) : null, effectiveNumberOfHoldings: +m.effective.toFixed(1), largestPositionPct: +(m.top.weight * 100).toFixed(1), top3Pct: +(m.top3 * 100).toFixed(1), assetClasses: m.classes } };
    try {
      const log = MD.ai.logBox(); out.replaceChildren(log);
      const S = MD.ai.session((e) => log.add(e));
      const lim = await s.limits().catch(() => null);
      const tools = lim && lim.tools ? MD.ai.tools(app, S, ["search_news", "crypto_news", "zacks_view", "stock_snapshot", "smart_money", "compare_returns", "search_web", "market_pulse", "explain_move", "market_memory"]) : undefined;
      const r = await s.json(`You are reviewing a personal investment portfolio for its owner. The measured figures below were computed by the app from market data (returns are for today's holdings over the past year, not the owner's actual results):
${JSON.stringify(facts)}
${tools ? "Investigate before writing, with 3 to 8 tool calls: search_news (or crypto_news) for the two or three largest or riskiest holdings, zacks_view for large stock positions, compare_returns against SPY, AGG and SGOV as baselines, smart_money where interesting. Cite only URLs the tools returned." : ""}
${MD.ai.contextNote(app)}
Be specific, plain and balanced. Do not invent prices, news or figures. Do not tell them to buy or sell; frame ideas as things to consider, with the trade-off. Say what a stress in the market would do using the measured beta.
Reply with ONLY JSON: {"headline": "one sentence", "summary": "3-4 sentences", "strengths": ["..."], "risks": ["..."], "concentration": "1-2 sentences on concentration and diversification", "toConsider": [{"idea": "...", "tradeOff": "..."}], "watch": ["what to monitor"], "confidence": 0-100, "sources": [{"title": "...", "url": "https://..."}]}`, Object.assign({ modelTier: "complex" }, tools ? { tools } : { cache: false }));
      const rv = await MD.ai.review(app, { task: "A balanced review of this portfolio", S, facts, items: [{ id: "review", headline: r.headline, summary: r.summary, risks: r.risks, toConsider: r.toConsider, confidence: r.confidence, sources: (r.sources || []).map(x => x.url) }] });
      const rev = rv && rv.reviews[0], srcs = S.verify(r.sources);
      const conf = MD.ai.blend([{ value: rev && rev.adjustedConfidence != null ? rev.adjustedConfidence : Number(r.confidence) || 0, weight: 0.7 }, { value: Math.min(100, srcs.filter(x => x.verified).length * 25 + 20), weight: 0.3 }]);
      const list = (t, a, cls) => Array.isArray(a) && a.length ? h("div", { class: "stack", style: "gap:4px" }, h("span", { class: "label" }, t), h("ul", { class: "small " + (cls || ""), style: "margin:0;padding-left:1.1em;display:grid;gap:3px" }, a.map(x => h("li", {}, typeof x === "string" ? x : (x.idea + (x.tradeOff ? " — trade-off: " + x.tradeOff : "")))))) : null;
      out.replaceChildren(log, h("div", { class: "review" }, h("div", { class: "row between", style: "flex-wrap:wrap;gap:8px" }, h("strong", { class: "review-h" }, r.headline || "Portfolio review"), h("span", { class: "small" }, "Confidence ", h("b", {}, String(conf)))), r.summary ? h("p", {}, r.summary) : null,
        h("div", { class: "grid g2" }, list("Strengths", r.strengths), list("Risks", r.risks)), r.concentration ? h("p", { class: "small" }, h("strong", {}, "Concentration: "), r.concentration) : null,
        list("Worth considering", r.toConsider), list("What to watch", r.watch), MD.ai.reviewBadge(rev), MD.ai.sources(srcs),
        h("p", { class: "tiny muted" }, "Written by Claude from the figures above and the sources it retrieved (" + S.calls + " research steps), then checked by a second review, " + new Date().toLocaleString() + ". Not financial advice; it can't see your goals, taxes or other accounts.")));
    } catch (e) { out.replaceChildren(U.errorBox({ message: ({ not_granted: "Claude access was declined for this page.", rate_limited: "Usage limit reached; try again later." })[e && e.code] || (e && e.message) || "The review failed." })); }
    btn.disabled = false;
  }

  function render(el, app, pv, R) {
    const rows = pv.rows.filter(r => r.p.qty.gt(0) && r.v.valueR);
    if (!rows.length) { el.replaceChildren(h("div", { class: "empty" }, "Add holdings to see how they behave together: volatility, drawdown, where the risk comes from and a projected value range.")); return; }
    U.async(el, () => measure(app, pv, R), (m) => {
      const money = (v) => U.money(v, R);
      const tile = (l, v, s, cls) => h("div", { class: "tile" }, h("span", { class: "label" }, l), h("span", { class: "v " + (cls || "") }, v), s ? h("span", { class: "s muted" }, s) : null);
      const divLabel = m.effective >= 10 ? "Broad" : m.effective >= 5 ? "Moderate" : m.effective >= 2.5 ? "Concentrated" : "Very concentrated";
      const chartBox = h("div", { class: "chartbox sm" });
      const reviewOut = h("div", {}), reviewBtn = h("button", { class: "btn", type: "button" }, "Write an AI review");
      reviewBtn.onclick = () => review(app, m, reviewOut, reviewBtn);
      const live = m.live.slice().sort((a, b) => b.weight - a.weight);
      el.append(
        h("div", { class: "grid g4" },
          tile("Diversification", divLabel, "Like " + m.effective.toFixed(1) + " equal-sized holdings · " + m.classes + " asset class" + (m.classes === 1 ? "" : "es")),
          tile("Largest position", m.top.symbol + " · " + bare(m.top.weight * 100), "Top 3: " + bare(m.top3 * 100)),
          tile("Volatility (1 year)", bare(m.volPct), "Max drawdown " + bare(m.stats.maxDrawdownPct)),
          tile("This mix, past year", pct(m.ret1y), "Beta vs SPY " + (m.beta ? m.beta.beta.toFixed(2) : "—") + " · Sharpe " + (isFinite(m.sharpe) ? m.sharpe.toFixed(2) : "—"), U.signCls(m.ret1y))),
        h("div", { class: "stack" }, h("span", { class: "label" }, "Today's holdings over the past year · " + R), chartBox,
          h("p", { class: "small muted" }, "What your current holdings would have been worth each day, at today's exchange rates, compared with the S&P 500 (SPY) scaled to the same start." + (m.constant.length ? " Held at today's value (no daily prices): " + m.constant.map(it => it.symbol).join(", ") + "." : ""))),
        h("div", { class: "grid g2" },
          h("div", { class: "stack" }, h("span", { class: "label" }, "Where the risk comes from"),
            live.length ? U.table([{ t: "Holding", v: (it) => h("span", { class: "stack", style: "gap:0" }, h("strong", {}, it.symbol), h("span", { class: "tiny muted" }, String(it.name || "").slice(0, 26))) }, { t: "Weight", v: (it) => bare(it.weight * 100), n: true }, { t: "1y", v: (it) => U.chg(it.ret1y, 1), n: true }, { t: "Volatility", v: (it) => bare(it.volPct), n: true },
              { t: "Share of risk", v: (it) => h("span", { class: "riskbar", title: bare(it.riskShare * 100) }, h("i", { style: "width:" + Math.max(0, Math.min(100, it.riskShare * 100)).toFixed(1) + "%" }), h("b", { class: "num" }, bare(it.riskShare * 100))), n: true }], live) : h("p", { class: "small muted" }, "No holdings with price history."),
            h("p", { class: "tiny muted" }, "Share of risk shows how much of the portfolio's swings each holding causes, after counting how they move together. A holding whose share of risk is far above its weight is doing more than its size suggests.")),
          h("div", { class: "stack" }, h("span", { class: "label" }, "How your holdings move together"), heatmap(m),
            h("p", { class: "tiny muted" }, "Correlation of daily moves over the past year: 1 means they move in lockstep, 0 unrelated, negative opposite. High numbers across the board mean less real diversification than the holding count suggests."))),
        h("div", { class: "stack" }, h("span", { class: "label" }, "Projected value"), projection(app, m)),
        h("div", { class: "stack" }, h("span", { class: "label" }, "Stress test"), MD.rebalance.stress(app, m)),
        h("div", { class: "stack" }, h("span", { class: "label" }, "Rebalancing helper"), MD.rebalance.section(app, m)),
        h("div", { class: "stack" }, h("div", { class: "row between" }, h("span", { class: "label" }, "Claude's review"), reviewBtn), reviewOut));
      const spy = m.beta && m.beta.spy, compare = [];
      if (spy && spy.points.length > 2) {
        const first = m.series[0].time, base = spy.points.find(p => p.time >= first) || spy.points[0], scale = m.series[0].value / (base.close ?? base.value);
        compare.push({ label: "SPY (scaled)", points: spy.points.filter(p => p.time >= first).map(p => ({ time: Math.floor(p.time / DAY) * DAY, value: (p.close ?? p.value) * scale })) });
      }
      U.chart(chartBox, { kind: "line", points: m.series, intraday: false }, { fmt: (v) => C.fmtNum(v, 0), compare });
    }, { loading: "Measuring how your holdings moved over the past year…" });
  }

  MD.portfolioAnalysis = { render, measure };
})(typeof window !== "undefined" ? window : globalThis);
