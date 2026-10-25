/* Asset insights: what the measured price history implies — a projection with an adjustable horizon,
   technical condition, risk and returns — plus the viewer's own position, private notes and (for US
   stocks) Zacks ratings. Every figure is computed here from the same daily history the chart uses. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const C = MD.core, U = MD.ui, D = MD.data, h = U.h;
  const A = () => MD.app, X = () => MD.common;
  const DAY = 86400;
  const HORIZONS = [["1D", 1], ["1W", 7], ["1M", 30], ["3M", 91], ["6M", 182], ["1Y", 365], ["2Y", 730]];
  const fmtP = (v) => v == null || !isFinite(v) ? "—" : C.fmtNum(v, Math.abs(v) >= 1 ? 2 : 6);
  const pctTxt = (x, dp = 1) => x == null || !isFinite(x) ? "—" : (x > 0 ? "+" : "") + x.toFixed(dp) + "%";
  const odds = (p) => p == null || !isFinite(p) ? "—" : p < 0.005 ? "<1%" : p > 0.995 ? ">99%" : Math.round(p * 100) + "%";
  const dateIn = (days) => new Date(Date.now() + days * 864e5).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const qtyTxt = (q) => { const t = C.fmtNum(q, 8); return t.includes(".") ? t.replace(/0+$/, "").replace(/\.$/, "") : t; };

  /* ---------- shared data ---------- */
  const histCache = new Map();
  // Daily history for the measures (the densest daily series available) plus a longer series for look-back returns.
  function loadHistory(asset) {
    const hit = histCache.get(asset.id);
    if (hit && Date.now() - hit.at < 5 * 60e3) return hit.p;
    const p = (async () => {
      const [y1, y5] = await Promise.all([D.historyFor(asset, "1Y").catch(e => ({ error: e })), D.historyFor(asset, "5Y").catch(() => null)]);
      const ok = (s) => s && !s.error && Array.isArray(s.points) && s.points.length >= 30;
      const daily = [y5, y1].filter(s => ok(s) && !s.intraday && (s.barSec || DAY) <= DAY).sort((a, b) => b.points.length - a.points.length)[0] || (ok(y1) ? y1 : null);
      if (!daily) throw (y1 && y1.error) || new D.DataError("not_found", "Not enough price history to analyse yet.");
      return { daily, long: ok(y5) ? y5 : daily, ppy: daily.ppy || (asset.cls === "crypto" ? 365 : 252) };
    })();
    histCache.set(asset.id, { at: Date.now(), p });
    p.catch(() => histCache.delete(asset.id));
    return p;
  }
  async function currentPrice(asset, daily, cur) {
    try { const q = await A().quote(asset, 60000); if (q && q.price > 0 && (!q.currency || q.currency === cur)) return { price: Number(q.price), priceSource: q.source }; } catch {}
    const last = daily.points[daily.points.length - 1];
    return { price: last.close ?? last.value, priceSource: "last close" };
  }
  function benchmarkFor(asset) {
    const spy = { id: "etf:SPY", cls: "etf", symbol: "SPY", name: "S&P 500 (SPY)" };
    if ((asset.cls === "stock" || asset.cls === "etf") && asset.symbol !== "SPY") return spy;
    if (asset.cls === "crypto" && String(asset.symbol).toUpperCase() !== "BTC") return { id: "crypto:bitcoin", cls: "crypto", cgId: "bitcoin", symbol: "BTC", name: "Bitcoin" };
    if (asset.cls === "crypto" || asset.cls === "metal") return spy;
    return null;
  }
  function heldPosition(asset) {
    const { positions } = C.buildPositions(A().store.cached("tx"));
    const p = positions.get(asset.id);
    return p && p.qty.gt(0) ? p : null;
  }
  async function analystTarget(asset, price) {
    try { const z = await D.zacks.metrics(asset.symbol); const t = z.n("zacks_target_price"); if (t > 0) return { target: t, pct: (t / price - 1) * 100, source: "Zacks target price" }; } catch {}
    try { const rows = await D.stocks.summary(asset.symbol, asset.cls); const r = rows.find(x => /1\s*y(ea)?r\s*target/i.test(x.label)); const t = r && D.num(r.value); if (t > 0) return { target: t, pct: (t / price - 1) * 100, source: "Nasdaq 1-year analyst target" }; } catch {}
    return null;
  }

  /* ---------- fan chart: history plus the projected 50% and 90% ranges ---------- */
  function drawFan(el, points, price, mk, days) {
    const W = Math.max(300, Math.round(el.clientWidth || 720)), H = W < 520 ? 220 : 270;
    const padL = 6, padR = W < 520 ? 62 : 78, padT = 14, padB = 24, now = Date.now() / 1000;
    const histDays = clamp(Math.round(days * 1.6), 30, 730);
    const hist = points.filter(p => p.time >= now - histDays * DAY).map(p => [p.time, p.close ?? p.value]);
    hist.push([now, price]);
    const N = 48, cone = [];
    for (let i = 0; i <= N; i++) { const d = days * i / N, p = i ? mk(d) : null; cone.push({ t: now + d * DAY, a: p ? p.p05 : price, b: p ? p.p25 : price, m: p ? p.median : price, c: p ? p.p75 : price, e: p ? p.p95 : price }); }
    const t0 = Math.min(hist[0][0], now - histDays * DAY), t1 = now + days * DAY;
    const vals = hist.map(x => x[1]).concat(cone.map(c => c.a), cone.map(c => c.e));
    let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * 0.08 || hi * 0.05; lo = Math.max(0, lo - pad); hi += pad;
    const x = (t) => (padL + (t - t0) / (t1 - t0) * (W - padL - padR)).toFixed(1), y = (v) => (padT + (hi - v) / (hi - lo) * (H - padT - padB)).toFixed(1);
    const line = (pts) => pts.map((p, i) => (i ? "L" : "M") + x(p[0]) + " " + y(p[1])).join(" ");
    const band = (k1, k2) => line(cone.map(c => [c.t, c[k1]])) + " " + line(cone.slice().reverse().map(c => [c.t, c[k2]])).replace(/^M/, "L") + " Z";
    const end = cone[N];
    const labels = [[end.e, "fan-lbl"], [end.m, "fan-lbl mid"], [end.a, "fan-lbl"]].map(([v, cls]) => ({ v, cls, y: +y(v) }));
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 15) labels[i].y = labels[i - 1].y + 15;
    const ax = (t) => new Date(t * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const nowX = +x(now), endX = W - padR;
    const axis = endX - nowX < 96
      ? `<text class="fan-ax" x="${padL}" y="${H - 6}">${esc(ax(t0))}</text><text class="fan-ax" x="${endX}" y="${H - 6}" text-anchor="end">Today → ${esc(ax(t1))}</text>`
      : `<text class="fan-ax" x="${padL}" y="${H - 6}">${esc(ax(t0))}</text><text class="fan-ax" x="${nowX}" y="${H - 6}" text-anchor="middle">Today</text><text class="fan-ax" x="${endX}" y="${H - 6}" text-anchor="end">${esc(ax(t1))}</text>`;
    el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Projected price range: middle ${esc(fmtP(end.m))}, 90% range ${esc(fmtP(end.a))} to ${esc(fmtP(end.e))}">` +
      `<defs><linearGradient id="fanG" x1="0" x2="1" y1="0" y2="0"><stop offset="0" style="stop-color:var(--accent);stop-opacity:0.02"/><stop offset="1" style="stop-color:var(--accent);stop-opacity:0.12"/></linearGradient></defs>` +
      [0.25, 0.5, 0.75].map(f => { const v = lo + (hi - lo) * f; return `<line class="fan-grid" x1="${padL}" x2="${endX}" y1="${y(v)}" y2="${y(v)}"/>`; }).join("") +
      `<rect class="fan-future" x="${nowX}" y="${padT - 6}" width="${(endX - nowX).toFixed(1)}" height="${H - padB - padT + 6}"/>` +
      `<path class="fan-90" d="${band("e", "a")}"/><path class="fan-50" d="${band("c", "b")}"/>` +
      `<path class="fan-hist" d="${line(hist)}"/><path class="fan-mid" d="${line(cone.map(c => [c.t, c.m]))}"/>` +
      `<line class="fan-today" x1="${nowX}" x2="${nowX}" y1="${padT - 6}" y2="${H - padB}"/><circle class="fan-dot" cx="${nowX}" cy="${y(price)}" r="4.5"/>` +
      labels.map(l => `<text class="${l.cls}" x="${endX + 6}" y="${(l.y + 4).toFixed(1)}">${esc(fmtP(l.v))}</text>`).join("") + axis + `</svg>`;
  }

  /* ---------- projection card ---------- */
  function projectionCard(asset, Hs, tech, cur) {
    const app = A(), key = "proj." + (asset.cls || "x");
    const st = Object.assign({ days: 30, vol: "hist", drift: "none", customVol: "", customDrift: "" }, app.ls.get(key, {}));
    st.days = clamp(Math.round(Number(st.days) || 30), 1, 730);
    const save = () => app.ls.set(key, st);
    const yearRet = C.periodReturns(Hs.daily.points)["1Y"];
    const long = Hs.long.points.length > 2 ? C.seriesStats(Hs.long.points, Hs.ppy) : null;
    const extras = { moves: null, optionsAsOf: "", target: null };
    const volSel = h("select", { "aria-label": "Volatility basis" }), driftSel = h("select", { "aria-label": "Expected return" });
    const volIn = h("input", { type: "text", inputmode: "decimal", placeholder: "% a year", value: st.customVol, "aria-label": "Custom volatility, percent a year" });
    const driftIn = h("input", { type: "text", inputmode: "decimal", placeholder: "% a year", value: st.customDrift, "aria-label": "Custom expected return, percent a year" });
    const range = h("input", { type: "range", min: "1", max: "730", step: "1", value: String(st.days), class: "hrange", "aria-label": "Projection horizon in days" });
    const segBox = h("div", {}), dayLbl = h("strong", { class: "num" });
    const fan = h("div", { class: "fan" }), kpis = h("div", { class: "kpis" }), extra = h("div", { class: "stack" }), note = h("p", { class: "small muted" });
    const tgtIn = h("input", { type: "text", inputmode: "decimal", "aria-label": "Price level to check" }), tgtOut = h("div", { class: "small" });
    let current = null;

    const impliedFor = (days) => {
      if (!extras.moves || !extras.moves.length) return null;
      const m = extras.moves.reduce((b, x) => !b || Math.abs(x.days - days) < Math.abs(b.days - days) ? x : b, null);
      const vol = C.impliedVolFromMove(m.movePct, m.days);
      return vol ? { vol, expiry: m.expiry } : null;
    };
    const vols = () => {
      const iv = impliedFor(st.days);
      return [
        tech && tech.volYr ? ["hist", "Past year · " + tech.volYr.toFixed(1) + "%", tech.volYr] : null,
        tech && tech.vol30 ? ["recent", "Last 30 days · " + tech.vol30.toFixed(1) + "%", tech.vol30] : null,
        iv ? ["options", "Options market · " + iv.vol.toFixed(1) + "% (" + iv.expiry + ")", iv.vol] : null,
        ["custom", "Custom…", D.num(volIn.value)]].filter(Boolean);
    };
    const drifts = () => [
      ["none", "No view · 0%", 0],
      yearRet != null ? ["trend", "Past-year trend · " + pctTxt(clamp(yearRet, -90, 300)), clamp(yearRet, -90, 300)] : null,
      long && long.cagrPct != null && long.years >= 2.5 ? ["cagr", "Long-run average · " + pctTxt(long.cagrPct) + " (" + Math.round(long.years) + "y)", long.cagrPct] : null,
      extras.target ? ["analyst", "Analyst target · " + pctTxt(extras.target.pct) + " (" + fmtP(extras.target.target) + ")", extras.target.pct] : null,
      ["custom", "Custom…", D.num(driftIn.value)]].filter(Boolean);
    const fillSel = (sel, opts, val) => { sel.replaceChildren(...opts.map(([k, l]) => h("option", { value: k, selected: k === val }, l))); if (!opts.some(o => o[0] === val)) sel.value = opts[0][0]; return sel.value; };

    const check = () => {
      const k = D.num(tgtIn.value), pr = current;
      if (!pr || !(k > 0)) { tgtOut.replaceChildren(h("span", { class: "muted" }, "Enter a price to see the odds at your horizon.")); return; }
      const above = k >= pr.price, fin = above ? pr.probAbove(k) : 1 - pr.probAbove(k), touch = pr.probTouch(k);
      tgtOut.replaceChildren(
        h("div", {}, (above ? "Ends above " : "Ends below ") + fmtP(k) + " on " + dateIn(st.days) + ": ", h("strong", { class: "num" }, odds(fin))),
        h("div", {}, "Trades " + (above ? "up" : "down") + " to " + fmtP(k) + " at any point before then: ", h("strong", { class: "num" }, odds(touch))));
    };
    tgtIn.addEventListener("input", check);

    const render = () => {
      st.vol = fillSel(volSel, vols(), st.vol); st.drift = fillSel(driftSel, drifts(), st.drift);
      volIn.hidden = st.vol !== "custom"; driftIn.hidden = st.drift !== "custom";
      const volPct = (vols().find(v => v[0] === st.vol) || [])[2], driftPct = (drifts().find(d => d[0] === st.drift) || [])[2] || 0;
      const hz = HORIZONS.find(x => x[1] === st.days);
      segBox.replaceChildren(U.seg(HORIZONS.map(x => x[0]), hz ? hz[0] : "", (k) => { st.days = HORIZONS.find(x => x[0] === k)[1]; range.value = String(st.days); save(); render(); }));
      dayLbl.textContent = st.days + (st.days === 1 ? " day" : " days") + " · " + dateIn(st.days);
      range.style.setProperty("--fill", ((st.days - 1) / 729 * 100).toFixed(1) + "%");
      const P = Hs.price, mk = (d) => C.projectPrice({ price: P, volPct, driftPct, days: d });
      current = volPct > 0 ? mk(st.days) : null;
      if (!current) { fan.replaceChildren(h("div", { class: "empty" }, st.vol === "custom" ? "Enter a volatility above 0% to project." : "Not enough history to measure volatility.")); kpis.replaceChildren(); extra.replaceChildren(); note.textContent = ""; tgtOut.replaceChildren(); return; }
      drawFan(fan, Hs.daily.points, P, mk, st.days);
      fan._redraw = () => drawFan(fan, Hs.daily.points, P, mk, st.days);
      const pc = (v) => (v / P - 1) * 100;
      const tile = (label, main, sub, cls) => h("div", { class: "kpi " + (cls || "") }, h("span", { class: "label" }, label), h("span", { class: "v num" }, main), sub ? h("span", { class: "s num" }, sub) : null);
      kpis.replaceChildren(
        tile("Middle outcome", fmtP(current.median), pctTxt(pc(current.median)) + " · half of outcomes above, half below", "hero-kpi " + (Math.abs(pc(current.median)) < 0.5 ? "" : U.signCls(pc(current.median)))),
        tile("Likely range · 50%", fmtP(current.p25) + " – " + fmtP(current.p75), pctTxt(pc(current.p25)) + " to " + pctTxt(pc(current.p75))),
        tile("Wide range · 90%", fmtP(current.p05) + " – " + fmtP(current.p95), pctTxt(pc(current.p05)) + " to " + pctTxt(pc(current.p95))),
        tile("Chance it's higher", odds(current.probUp), "than " + fmtP(P) + " today"),
        tile("Typical move (±1σ)", "±" + current.oneSigmaPct.toFixed(1) + "%", "about 2 in 3 outcomes"),
        tile("Chance of a 10%+ swing", odds(current.probAbove(P * 1.1) + 1 - current.probAbove(P * 0.9)), "up " + odds(current.probAbove(P * 1.1)) + " · down " + odds(1 - current.probAbove(P * 0.9))),
        tile("Average outcome", fmtP(current.mean), pctTxt(pc(current.mean)) + " · pulled up by big gains"));
      const pos = heldPosition(asset);
      extra.replaceChildren(
        pos && pos.currency === cur ? h("div", { class: "banner info" }, h("p", {}, "Your " + qtyTxt(pos.qty) + " " + (asset.symbol || "") + ": middle outcome " + U.money(pos.qty.times(current.median), cur) + ", 90% range " + U.money(pos.qty.times(current.p05), cur) + " – " + U.money(pos.qty.times(current.p95), cur) + " (now " + U.money(pos.qty.times(P), cur) + ").")) : null,
        h("div", { class: "row" },
          h("button", { class: "btn ghost sm", type: "button", onclick: () => X().alertModal(asset, { price: +current.p95.toPrecision(6), currency: cur }, { kind: "above" }) }, "Alert above the 90% range (" + fmtP(current.p95) + ")"),
          h("button", { class: "btn ghost sm", type: "button", onclick: () => X().alertModal(asset, { price: +current.p05.toPrecision(6), currency: cur }, { kind: "below" }) }, "Alert below it (" + fmtP(current.p05) + ")")));
      const volName = (vols().find(v => v[0] === st.vol) || [, ""])[1].split(" · ")[0];
      note.textContent = "Model: a random walk with " + volPct.toFixed(1) + "% annual volatility (" + volName.toLowerCase() + ") and an expected return of " + pctTxt(driftPct) + " a year, from " + fmtP(P) + " (" + Hs.priceSource + "). The middle outcome sits a little below the average because a few large gains pull the average up. It's a statistical range, not a prediction: real prices jump more often than this model assumes, so moves beyond the 90% range happen more than 1 time in 10, especially around earnings and news." + (Hs.daily.proxy ? " History here is a proxy series; see the chart note." : "");
      if (!tgtIn.value) tgtIn.value = String(+(extras.target ? extras.target.target : current.p75).toPrecision(5));
      check();
    };
    volSel.onchange = () => { st.vol = volSel.value; save(); render(); };
    driftSel.onchange = () => { st.drift = driftSel.value; save(); render(); };
    volIn.oninput = () => { st.customVol = volIn.value; save(); render(); };
    driftIn.oninput = () => { st.customDrift = driftIn.value; save(); render(); };
    range.oninput = () => { st.days = Number(range.value); save(); render(); };
    if (typeof ResizeObserver === "function") { let w = 0; const ro = new ResizeObserver(() => { if (!fan.isConnected) { ro.disconnect(); return; } const nw = fan.clientWidth; if (Math.abs(nw - w) > 24 && fan._redraw) { w = nw; fan._redraw(); } }); ro.observe(fan); }

    if (asset.cls === "stock" || asset.cls === "etf") {
      D.stocks.optionMoves(asset.symbol, Hs.price).then(o => { if (o.moves.length) { extras.moves = o.moves; extras.optionsAsOf = o.asOf; render(); } }).catch(() => {});
      analystTarget(asset, Hs.price).then(t => { if (t) { extras.target = t; tgtIn.value = ""; render(); } }).catch(() => {});
    }
    const sec = U.section("Price projection", h("div", { class: "stack" },
      h("div", { class: "proj-controls" },
        h("div", { class: "stack", style: "gap:6px" }, h("span", { class: "label" }, "Horizon"), segBox, h("div", { class: "row", style: "gap:10px;flex-wrap:nowrap" }, range, dayLbl)),
        h("div", { class: "form proj-form" }, U.field("Volatility from", volSel), volIn, U.field("Expected return a year", driftSel), driftIn)),
      h("div", { class: "proj-grid" }, h("div", { class: "stack" }, fan, h("div", { class: "legend-row" }, h("span", {}, h("i", { class: "swatch", style: "background:var(--ink)" }), "Price history"), h("span", {}, h("i", { class: "swatch", style: "background:var(--accent)" }), "Middle outcome"), h("span", {}, h("i", { class: "swatch sq a50" }), "50% range"), h("span", {}, h("i", { class: "swatch sq a90" }), "90% range"))), kpis),
      h("div", { class: "proj-check" }, h("span", { class: "label" }, "Odds of a price level"), h("div", { class: "row", style: "gap:10px;align-items:start" }, h("div", { style: "width:140px" }, tgtIn), tgtOut)),
      extra, note), [h("span", { class: "pill" }, "Adjustable")]);
    sec.id = "sec-projection";
    render();
    return sec;
  }

  /* ---------- returns, technicals, risk ---------- */
  function returnsStrip(Hs) {
    // Daily bars for recent windows, the long (possibly weekly) series only before the daily data starts.
    const d0 = Hs.daily.points[0].time, now = Date.now() / 1000;
    const pts = (Hs.long === Hs.daily ? [] : Hs.long.points.filter(p => p.time < d0)).concat(Hs.daily.points);
    if (Hs.price > 0 && now > pts[pts.length - 1].time) pts.push({ time: now, value: Hs.price });
    const r = C.periodReturns(pts, now);
    const keys = ["1W", "1M", "3M", "YTD", "1Y", "3Y", "5Y"].filter(k => r[k] != null);
    return h("div", { class: "retstrip", role: "list", "aria-label": "Returns" }, keys.map(k => h("div", { class: "ret " + U.signCls(r[k]), role: "listitem" }, h("span", { class: "label" }, k), h("span", { class: "num" }, pctTxt(r[k])))));
  }
  function technicalCard(t, Hs) {
    if (!t) return U.section("Technical snapshot", h("div", { class: "empty" }, "Not enough daily history for indicators."));
    const P = Hs.price, rel = (v) => v ? " · price " + pctTxt((P / v - 1) * 100) : "";
    const hi = Math.max(t.high52, P), lo = Math.min(t.low52, P);
    const pos = hi > lo ? (P - lo) / (hi - lo) : 0.5;
    const rsiTxt = t.rsi14 == null ? "—" : t.rsi14 >= 70 ? "Overbought zone" : t.rsi14 <= 30 ? "Oversold zone" : "Neutral";
    const trend = { up: ["▲ Uptrend", "up"], down: ["▼ Downtrend", "down"], mixed: ["↔ Mixed trend", ""] }[t.trend];
    const regime = t.vol30 && t.volYr ? (t.vol30 / t.volYr > 1.25 ? "More volatile than usual" : t.vol30 / t.volYr < 0.8 ? "Calmer than usual" : "About normal") : "—";
    const m = t.macd;
    const sec = U.section("Technical snapshot", h("div", { class: "stack" },
      h("div", { class: "row between" }, h("span", { class: "trend " + trend[1] }, trend[0]), h("span", { class: "tiny muted" }, "Daily closes · " + (Hs.daily.source || ""))),
      h("div", { class: "stack", style: "gap:4px" }, h("span", { class: "label" }, "52-week range"), h("div", { class: "rangebar" }, h("i", { style: "left:" + (pos * 100).toFixed(1) + "%" })), h("div", { class: "row between tiny num muted" }, h("span", {}, fmtP(lo)), h("span", {}, P >= hi ? "At the 52-week high" : P <= lo ? "At the 52-week low" : pctTxt((P / hi - 1) * 100) + " from the high"), h("span", {}, fmtP(hi)))),
      t.rsi14 != null ? h("div", { class: "stack", style: "gap:4px" }, h("div", { class: "row between" }, h("span", { class: "label" }, "RSI (14 days)"), h("span", { class: "small" }, h("strong", { class: "num" }, t.rsi14.toFixed(0)), " · " + rsiTxt)), h("div", { class: "gauge" }, h("i", { style: "left:" + t.rsi14.toFixed(1) + "%" }))) : null,
      U.kv([["20-day average", fmtP(t.sma20) + rel(t.sma20)], ["50-day average", t.sma50 ? fmtP(t.sma50) + rel(t.sma50) : "—"], ["200-day average", t.sma200 ? fmtP(t.sma200) + rel(t.sma200) : "needs 200 days"],
        ["50 vs 200-day", t.cross ? (t.cross.kind === "golden" ? "Golden cross (50 above 200)" : "Death cross (50 below 200)") + (t.cross.since ? " since " + U.fmtDate(t.cross.since * 1000) : "") : "—"],
        ["MACD momentum", m ? (m.hist > 0 ? "Positive" : "Negative") + (Math.abs(m.hist) > Math.abs(m.prevHist) ? ", strengthening" : ", fading") : "—", m ? (m.hist > 0 ? "up" : "down") : ""],
        ["Volatility now", regime]]),
      h("div", { class: "explain" }, "Uptrend means the price is above its 50-day average, which is above its 200-day average. RSI above 70 or below 30 marks a stretched run, not a reversal signal. These describe past prices; they don't predict.")));
    sec.id = "sec-technicals";
    return sec;
  }
  function riskCard(asset, Hs, t) {
    const pts = Hs.daily.points, lastT = pts[pts.length - 1].time;
    const s1 = C.seriesStats(pts.filter(p => p.time >= lastT - 365 * DAY), Hs.ppy);
    const bm = benchmarkFor(asset), betaEl = h("span", { class: "num" }, bm ? "measuring…" : "—"), corrEl = h("span", { class: "num" }, bm ? "…" : "—");
    if (bm) D.historyFor(bm, "1Y").then(B => {
      const r = C.betaTo(pts.filter(p => p.time >= lastT - 365 * DAY), B.points);
      betaEl.textContent = r ? r.beta.toFixed(2) : "not enough overlap"; corrEl.textContent = r ? r.correlation.toFixed(2) : "—";
    }).catch(() => { betaEl.textContent = "unavailable"; corrEl.textContent = "—"; });
    const sec = U.section("Risk", h("div", { class: "stack" },
      U.kv([["Volatility · 1 year", t && t.volYr ? t.volYr.toFixed(1) + "%" : "—"], ["Volatility · 30 days", t && t.vol30 ? t.vol30.toFixed(1) + "%" : "—"],
        ["Max drawdown · 1 year", t ? pctTxt(t.maxDrawdownYrPct) : "—", "down"], ["1-in-20 bad day", t && t.var95 != null ? pctTxt(t.var95) + " or worse" : "—", "down"],
        ["Worst day · 1 year", t && t.worstDay != null ? pctTxt(t.worstDay) : "—", "down"], ["Best day · 1 year", t && t.bestDay != null ? pctTxt(t.bestDay) : "—", "up"],
        ["Sharpe ratio · 1 year", s1 && isFinite(s1.sharpe) ? s1.sharpe.toFixed(2) : "—"], [bm ? "Beta vs " + bm.symbol : "Beta", betaEl], [bm ? "Correlation with " + bm.symbol : "Correlation", corrEl]]),
      h("div", { class: "explain" }, "A 1-in-20 bad day is the loss exceeded on 5% of trading days in the past year. Beta 1.5 means it has tended to move 1.5% for each 1% move in " + (bm ? bm.symbol : "the benchmark") + "; correlation near 1 means they usually move together.")));
    sec.id = "sec-risk";
    return sec;
  }

  /* ---------- your position & notes ---------- */
  function positionCard(asset) {
    const app = A(), box = h("div", { class: "stack" });
    const draw = async () => {
      const p = heldPosition(asset);
      if (!p) { box.replaceChildren(h("p", { class: "small muted" }, "You don't hold " + (asset.symbol || asset.name) + " in your Market Desk portfolio."), h("div", { class: "row" }, h("button", { class: "btn ghost sm", type: "button", onclick: () => X().txModal(asset) }, "Record a purchase"))); return; }
      const cost = p.lots.reduce((a, l) => a.plus(l.cost), C.ZERO), avg = cost.div(p.qty);
      let q = null; try { q = await app.quote(asset, 60000); } catch {}
      let price = null;
      if (q && q.price > 0) { if (!q.currency || q.currency === p.currency) price = q.price; else { const r = app.rates.quote(q.currency, p.currency); if (r) price = Number(C.convert(q.price, r)); } }
      const value = price != null ? p.qty.times(price) : null, pnl = value ? value.minus(cost) : null;
      const realized = p.realized.reduce((a, r) => a.plus(r.pnl), C.ZERO);
      box.replaceChildren(U.kv([["Quantity", qtyTxt(p.qty) + " " + (p.unit || "")], ["Average cost", U.money(avg, p.currency, { price: true })], ["Cost basis", U.money(cost, p.currency)], ["Value now", value ? U.money(value, p.currency) : "—"],
        ["Unrealized P&L", pnl ? U.money(pnl, p.currency) + " (" + pctTxt(Number(pnl.div(cost).times(100))) + ")" : "—", pnl ? U.signCls(Number(pnl)) : ""], ["Realized P&L", U.money(realized, p.currency), U.signCls(Number(realized))], ["First bought", p.lots[0] ? U.fmtDate(p.lots[0].date) : "—"]]),
        h("div", { class: "row" }, h("button", { class: "btn ghost sm", type: "button", onclick: () => X().txModal(asset) }, "Record a trade"), h("button", { class: "btn ghost sm", type: "button", onclick: () => app.go("portfolio", null, { fromNav: true }) }, "Open portfolio")));
    };
    draw();
    const sec = U.section("Your position", box);
    sec.id = "sec-position";
    return sec;
  }
  function notesCard(asset) {
    const app = A(), id = "n_" + String(asset.id).replace(/[^A-Za-z0-9_-]/g, "_");
    const existing = app.store.cached("notes").find(n => n.id === id);
    const ta = h("textarea", { rows: 5, placeholder: "Your thesis, levels to watch, reminders… Private to you.", "aria-label": "Notes on " + (asset.symbol || asset.name) });
    ta.value = existing ? existing.text || "" : "";
    const stEl = h("span", { class: "tiny muted" }, existing ? "Saved " + U.fmtTs(existing.updatedAt) : app.demo ? "Demo mode: notes aren't saved" : "Saves as you type");
    let timer = 0;
    const save = async () => { try { await app.store.put("notes", id, { assetId: asset.id, symbol: asset.symbol || "", name: asset.name || "", text: ta.value.slice(0, 5000), updatedAt: Date.now() }); stEl.textContent = "Saved " + U.fmtTs(Date.now()); } catch (e) { stEl.textContent = "Couldn't save: " + U.errorText(e); } };
    ta.addEventListener("input", () => { clearTimeout(timer); stEl.textContent = "Editing…"; timer = setTimeout(save, 700); });
    const sec = U.section("Notes", h("div", { class: "stack" }, ta, stEl));
    sec.id = "sec-notes";
    return sec;
  }

  /* ---------- Wall Street view (Zacks Data) ---------- */
  const RATING_ORDER = ["Strong Buy", "Buy", "Hold", "Sell", "Strong Sell"];
  function wallStreetCard(asset) {
    const app = A(), sym = String(asset.symbol).toUpperCase(), box = h("div", { class: "stack" });
    const link = h("a", { class: "btn ghost sm", href: "https://www.zacks.com/stock/quote/" + encodeURIComponent(sym) + "?utm_source=zacks_mcp", target: "_blank", rel: "noopener noreferrer" }, "Zacks ↗");
    U.async(box, () => Promise.all([D.zacks.metrics(sym), D.zacks.ratings(sym).catch(e => ({ status: "error", error: e, records: [] }))]), ([z, r]) => {
      const rank = z.n("zacks_rank"), close = z.n("last_closing_price"), tgt = z.n("zacks_target_price");
      const grade = (k, l) => { const g = z.v(k); return g ? h("span", { class: "grade g-" + String(g).charAt(0) }, h("b", {}, g), l) : null; };
      const left = h("div", { class: "stack" });
      if (rank) left.append(h("div", { class: "zrank" }, h("div", { class: "zscale", "aria-label": "Zacks Rank " + rank + " of 5" }, [1, 2, 3, 4, 5].map(n => h("span", { class: "r" + n + (n === rank ? " on" : "") }, String(n)))), h("div", { class: "stack", style: "gap:0" }, h("span", { class: "label" }, "Zacks Rank"), h("strong", { class: "zr-t r" + rank }, rank + " · " + (z.v("zacks_rank_text") || "")))));
      const grades = [grade("value_score", "Value"), grade("growth_score", "Growth"), grade("momentum_score", "Momentum"), grade("vgm_score", "VGM")].filter(Boolean);
      if (grades.length) left.append(h("div", { class: "row", style: "gap:6px" }, grades));
      left.append(U.kv([
        tgt ? ["Zacks target price", fmtP(tgt) + (close ? " (" + pctTxt((tgt / close - 1) * 100) + ")" : "")] : null,
        z.v("zacks_recommendation_text") ? ["Zacks recommendation", z.v("zacks_recommendation_text") + (z.v("prior_recommendation_text") && z.v("prior_recommendation_text") !== z.v("zacks_recommendation_text") ? " (was " + z.v("prior_recommendation_text") + ")" : "")] : null,
        z.v("x_industry_name") ? ["Industry", z.v("x_industry_name") + (z.n("x_industry_rank") ? " · rank " + z.v("x_industry_rank") + " of " + z.v("x_industry_count") + (z.v("x_industry_pct") ? " (top " + z.v("x_industry_pct") + "%)" : "") : "")] : null,
        z.v("exp_rep_date") ? ["Next earnings", U.fmtDate(z.v("exp_rep_date"))] : null,
        z.n("last_qtr_eps_surp_pct") != null ? ["Last EPS surprise", pctTxt(z.n("last_qtr_eps_surp_pct")), U.signCls(z.n("last_qtr_eps_surp_pct"))] : null,
        z.n("pe_trailing12m") != null ? ["P/E (trailing)", z.v("pe_trailing12m")] : null, z.n("peg_f1") != null ? ["PEG", z.v("peg_f1")] : null,
        z.n("beta") != null ? ["Beta (Zacks)", z.v("beta")] : null, z.n("div_yield") != null ? ["Dividend yield", z.v("div_yield") + "%"] : null,
        z.v("expense_ratio") ? ["Expense ratio", z.v("expense_ratio")] : null, z.v("aum") ? ["Assets under management", z.v("aum")] : null, z.v("investment_category") ? ["Category", z.v("investment_category")] : null, z.v("benchmark") ? ["Benchmark", z.v("benchmark")] : null].filter(Boolean)));
      if (z.peers.length) left.append(h("div", { class: "stack", style: "gap:4px" }, h("span", { class: "label" }, "Peers · Zacks Rank"), h("div", { class: "row", style: "gap:6px" }, z.peers.slice(0, 8).map(pp => h("button", { class: "chip", type: "button", title: pp.name, onclick: () => app.openAsset({ id: "stock:" + pp.symbol, cls: "stock", symbol: pp.symbol, name: pp.name }) }, h("b", {}, pp.symbol), pp.rank ? h("span", { class: "zr-t r" + pp.rank }, " " + pp.rank) : null)))));
      const right = h("div", { class: "stack" }), brokerBox = h("div", { class: "stack" });
      const brokers = r.records.filter(x => !x.zacksOwn);
      if (brokers.length) {
        const counts = RATING_ORDER.map(k => brokers.filter(b => b.rating === k).length);
        const tg = brokers.map(b => b.target).filter(x => x > 0), avgT = tg.length ? tg.reduce((a, b) => a + b, 0) / tg.length : null;
        const showAll = h("button", { class: "linkbtn small", type: "button" }, "Show all " + brokers.length);
        const tbl = h("div", {});
        const drawTbl = (all) => tbl.replaceChildren(U.table([{ t: "Broker", v: (b) => h("span", { class: "stack", style: "gap:0" }, h("strong", {}, b.broker), b.analyst ? h("span", { class: "tiny muted" }, b.analyst) : null) }, { t: "Rating", v: (b) => h("span", { class: "rt " + String(b.rating).replace(/\s/g, "") }, b.rating), sort: true }, { t: "Action", v: (b) => b.action + (b.prev && b.prev !== b.rating ? " from " + b.prev : "") }, { t: "Target", v: (b) => b.target ? fmtP(b.target) : "—", n: true }, { t: "Upside", v: (b) => b.upsidePct != null ? h("span", { class: U.signCls(b.upsidePct) }, pctTxt(b.upsidePct)) : "—", n: true }, { t: "Date", v: "date" }], all ? brokers : brokers.slice(0, 6)));
        showAll.onclick = () => { drawTbl(true); showAll.remove(); };
        drawTbl(false);
        right.append(h("div", { class: "stack", style: "gap:4px" }, h("span", { class: "label" }, brokers.length + " Wall Street ratings"),
          h("div", { class: "dist" }, RATING_ORDER.map((k, i) => counts[i] ? h("span", { class: "rt " + k.replace(/\s/g, ""), style: "flex:" + counts[i], title: k + ": " + counts[i] }, String(counts[i])) : null)),
          h("div", { class: "row tiny muted", style: "gap:10px" }, RATING_ORDER.map((k, i) => counts[i] ? h("span", {}, h("i", { class: "swatch rt " + k.replace(/\s/g, "") }), k) : null))),
          U.kv([avgT ? ["Average target", fmtP(avgT) + (r.price ? " (" + pctTxt((avgT / r.price - 1) * 100) + ")" : "")] : null, tg.length ? ["Target range", fmtP(Math.min(...tg)) + " – " + fmtP(Math.max(...tg))] : null, r.priceAsOf ? ["Upside measured from", fmtP(r.price) + " close, " + U.fmtDate(r.priceAsOf)] : null].filter(Boolean)));
        brokerBox.append(tbl, brokers.length > 6 ? showAll : null);
      } else right.append(h("div", { class: "empty" }, r.status === "error" ? "Broker ratings unavailable: " + U.errorText(r.error) : r.status === "not_covered" ? "No broker ratings: " + (r.reason || "not covered") + "." : "No broker ratings on file."));
      if (z.peers.length) right.append(left.lastChild);
      box.append(h("div", { class: "grid g2" }, left, right), brokerBox,
        h("p", { class: "tiny muted" }, "Source: ", h("a", { href: "https://www.zacks.com/stock/quote/" + encodeURIComponent(sym) + "?utm_source=zacks_mcp", target: "_blank", rel: "noopener noreferrer" }, "Zacks Investment Research"), z.asOf ? ", as of " + U.fmtDate(z.asOf) : "", ". Zacks Rank (1 Strong Buy … 5 Strong Sell) is a 1–3 month rating driven by earnings-estimate revisions. Broker ratings are each firm's opinion on the date shown, not advice from Market Desk."));
    }, { loading: "Loading Zacks ratings…" });
    const sec = U.section("Wall Street view", box, [link]);
    sec.id = "sec-analysts";
    return sec;
  }

  /* ---------- assembly ---------- */
  // Jump links to the sections of a long asset page.
  function jumpBar(items) {
    return h("nav", { class: "jump", "aria-label": "On this page" }, items.map(([id, label]) => h("a", { href: "#" + id, onclick: (e) => { e.preventDefault(); const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: document.body.classList.contains("reduce-motion") ? "auto" : "smooth", block: "start" }); } }, label)));
  }
  function panel(asset, opts = {}) {
    const cur = opts.currency || "USD";
    const wrap = h("div", { class: "stack insights", style: "gap:18px" });
    const measured = h("div", { class: "stack", style: "gap:18px" });
    wrap.append(measured);
    U.async(measured, async () => { const Hs = await loadHistory(asset); return Object.assign({}, Hs, await currentPrice(asset, Hs.daily, cur)); }, (Hs) => {
      const tech = C.technicals(Hs.daily.points, Hs.ppy);
      const ret = U.section("Returns", returnsStrip(Hs)); ret.id = "sec-returns";
      measured.append(ret, projectionCard(asset, Hs, tech, cur), h("div", { class: "grid g2" }, technicalCard(tech, Hs), riskCard(asset, Hs, tech)));
    }, { loading: "Measuring price history for projections and indicators…" });
    if (opts.analysts && (asset.cls === "stock" || asset.cls === "etf")) wrap.append(wallStreetCard(asset));
    wrap.append(h("div", { class: "grid g2" }, positionCard(asset), notesCard(asset)));
    return wrap;
  }
  MD.insights = { panel, jumpBar, wallStreetCard, loadHistory, drawFan, HORIZONS };
})(typeof window !== "undefined" ? window : globalThis);
