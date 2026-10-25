/* Market Desk UI kit: DOM builder, status badges, tables, charts, modals, toasts. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const C = MD.core;
  // Conditional children are written as `cond ? node : null`; the native DOM would print "null".
  if (G.Element && !G.Element.prototype.__mdPatched) {
    for (const m of ["append", "prepend", "replaceChildren"]) {
      const orig = G.Element.prototype[m];
      G.Element.prototype[m] = function (...a) { return orig.apply(this, a.flat(Infinity).filter(x => x != null && x !== false)); };
    }
    G.Element.prototype.__mdPatched = true;
  }

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style") el.setAttribute("style", v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "html") el.innerHTML = v; // only used with static strings
      else if (k === "value") el.value = v;
      else if (k === "checked") el.checked = !!v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
    return el;
  }
  const $ = (sel, root) => (root || document).querySelector(sel);

  /* ---------- formatting with app settings ---------- */
  function tzName() { try { return new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(new Date()).find(p => p.type === "timeZoneName").value; } catch { return ""; } }
  function fmtTs(ts, withDate = true) {
    if (!ts) return "time unknown";
    const d = new Date(ts);
    const sameDay = d.toDateString() === new Date().toDateString();
    return d.toLocaleString(undefined, Object.assign(withDate && !sameDay ? { month: "short", day: "numeric" } : {}, { hour: "numeric", minute: "2-digit", timeZoneName: "short" }));
  }
  function fmtDate(s) { if (!s) return "—"; const d = typeof s === "number" ? new Date(s) : new Date(String(s).length === 10 ? s + "T00:00:00Z" : s); return isNaN(d) ? String(s) : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: String(s).length === 10 ? "UTC" : undefined }); }
  function money(x, code, opts) { return C.fmtMoney(x, code, MD.app ? MD.app.reg : null, opts); }
  function pct(x, dp = 2) { return C.fmtPct(x, dp); }
  function signCls(x) { const n = Number(x); return !isFinite(n) || n === 0 ? "" : n > 0 ? "up" : "down"; }
  function chg(x, dp = 2) { return h("span", { class: "num " + signCls(x) }, x == null || !isFinite(Number(x)) ? "—" : pct(x, dp)); }

  /* Status badge: every market-sensitive figure shows status, source, time and limits. */
  function status(meta) {
    if (!meta) return null;
    let s = meta.status || "Live";
    if (MD.app && MD.app.demo) s = s;
    const fr = meta.ts && meta.kind ? C.freshness(meta.ts, meta.kind) : null;
    if (fr && fr.status === "stale" && (s === "Live" || s === "Delayed")) s = "Stale";
    const parts = [h("span", { class: "st " + s, title: STATUS_HELP[s] || "" }, s)];
    if (meta.source) parts.push(h("span", {}, meta.source));
    if (meta.ts) parts.push(h("span", {}, fmtTs(meta.ts)));
    else if (meta.tsNote) parts.push(h("span", {}, meta.tsNote));
    if (meta.currency) parts.push(h("span", {}, meta.currency + (meta.unit ? " per " + meta.unit : "")));
    if (meta.note) parts.push(h("span", { class: "faint" }, meta.note));
    return h("span", { class: "ds" }, parts);
  }
  const STATUS_HELP = { Live: "Current price from the source.", Delayed: "The source says this quote may be delayed.", Historical: "Last available price; the market is closed or this is a past value.", Reference: "A reference market price, not a verified sale or executable quote.", Estimated: "Calculated or approximated; see the note.", Stale: "Older than expected for this market. Refresh before relying on it.", Unavailable: "No reliable data source.", Demo: "Fictional demo data." };

  /* ---------- toasts & modals ---------- */
  function toast(title, body, bad) {
    const t = h("div", { class: "toast" + (bad ? " bad" : ""), role: "status" }, h("strong", {}, title), body ? h("span", { class: "small" }, body) : null);
    $("#toasts").append(t); setTimeout(() => t.remove(), bad ? 7000 : 4500);
  }
  function modal(title, body, opts) {
    const close = () => { ov.remove(); document.removeEventListener("keydown", onKey); if (opts && opts.onClose) opts.onClose(); if (prevFocus) prevFocus.focus(); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    const prevFocus = document.activeElement;
    const box = h("div", { class: "modal" + (opts && opts.cls ? " " + opts.cls : ""), role: "dialog", "aria-modal": "true", "aria-label": title },
      title ? h("div", { class: "hd" }, h("h3", {}, title), h("button", { class: "btn ghost sm", type: "button", onclick: close, "aria-label": "Close" }, "Close")) : null,
      h("div", { class: "bd" }, body));
    const ov = h("div", { class: "overlay", onclick: (e) => { if (e.target === ov) close(); } }, box);
    document.body.append(ov); document.addEventListener("keydown", onKey);
    const f = box.querySelector("input, select, textarea, button:not([aria-label=Close])"); if (f) setTimeout(() => f.focus(), 30);
    return { close, box };
  }
  function confirmBox(title, text, okLabel = "Confirm", danger = false) {
    return new Promise((resolve) => {
      let done = false;
      const m = modal(title, h("div", { class: "stack" }, h("p", {}, text), h("div", { class: "row end" },
        h("button", { class: "btn ghost", type: "button", onclick: () => { done = true; m.close(); resolve(false); } }, "Cancel"),
        h("button", { class: "btn" + (danger ? " danger" : ""), type: "button", onclick: () => { done = true; m.close(); resolve(true); } }, okLabel))), { onClose: () => { if (!done) resolve(false); } });
    });
  }

  /* ---------- tables ---------- */
  function table(cols, rows, opts) {
    const thead = h("thead", {}, h("tr", {}, cols.map(c => h("th", { class: c.n ? "n" : "", scope: "col" }, c.t))));
    const tbody = h("tbody", {}, rows.length ? rows.map(r => {
      const tr = h("tr", { class: (opts && opts.onRow ? "click " : "") + (r._cls || "") }, cols.map(c => { const v = typeof c.v === "function" ? c.v(r) : r[c.v]; return h("td", { class: c.n ? "n" : "" }, v == null ? "—" : v); }));
      if (opts && opts.onRow) { tr.tabIndex = 0; tr.addEventListener("click", () => opts.onRow(r)); tr.addEventListener("keydown", (e) => { if (e.key === "Enter") opts.onRow(r); }); }
      return tr;
    }) : h("tr", {}, h("td", { colspan: cols.length }, h("div", { class: "empty" }, (opts && opts.empty) || "Nothing here yet."))));
    return h("div", { class: "tbl-wrap" }, h("table", { class: "tbl" }, thead, tbody));
  }
  /* Sortable, filterable table with paging. cols: {t, v, sort?: row => number|string, n?}. */
  function dataTable(cols, rows, opts) {
    opts = opts || {};
    const app = MD.app, key = opts.key ? "dt." + opts.key : null;
    const saved = key && app ? app.ls.get(key, null) : null;
    let sortI = saved ? saved.i : (opts.sort ? opts.sort[0] : -1), dir = saved ? saved.d : (opts.sort ? opts.sort[1] : -1);
    let q = "", shown = opts.pageSize || 50, data = rows;
    const body = h("div", { class: "stack" });
    const filterIn = opts.filter === false ? null : h("input", { type: "search", placeholder: opts.placeholder || "Filter this list…", style: "max-width:320px", "aria-label": "Filter" });
    const text = opts.text || ((r) => cols.map(c => typeof c.v === "string" ? r[c.v] : "").join(" ") + " " + (r.symbol || "") + " " + (r.name || ""));
    const paint = () => {
      let list = data;
      if (q) { const qq = q.toLowerCase(); list = list.filter(r => String(text(r)).toLowerCase().includes(qq)); }
      if (sortI >= 0 && cols[sortI] && cols[sortI].sort) {
        const f = cols[sortI].sort;
        list = list.slice().sort((a, b) => { const x = f(a), y = f(b); const bx = x == null || (typeof x === "number" && !isFinite(x)), by = y == null || (typeof y === "number" && !isFinite(y)); if (bx && by) return 0; if (bx) return 1; if (by) return -1; return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir; });
      }
      const head = h("thead", {}, h("tr", {}, cols.map((c, i) => h("th", { class: c.n ? "n" : "", scope: "col", "aria-sort": i === sortI ? (dir > 0 ? "ascending" : "descending") : null },
        c.sort ? h("button", { class: "sortbtn", type: "button", onclick: () => { if (sortI === i) dir = -dir; else { sortI = i; dir = c.n ? -1 : 1; } if (key && app) app.ls.set(key, { i: sortI, d: dir }); paint(); } }, c.t, i === sortI ? (dir > 0 ? " ▲" : " ▼") : "") : c.t))));
      const vis = list.slice(0, shown);
      const tb = h("tbody", {}, vis.length ? vis.map(r => {
        const tr = h("tr", { class: opts.onRow ? "click" : "" }, cols.map(c => { const v = typeof c.v === "function" ? c.v(r) : r[c.v]; return h("td", { class: c.n ? "n" : "" }, v == null ? "—" : v); }));
        if (opts.onRow) { tr.tabIndex = 0; tr.addEventListener("click", (e) => { if (e.target.closest("button, a, input, select")) return; opts.onRow(r); }); tr.addEventListener("keydown", (e) => { if (e.key === "Enter") opts.onRow(r); }); }
        return tr;
      }) : h("tr", {}, h("td", { colspan: cols.length }, h("div", { class: "empty" }, q ? "Nothing matches “" + q + "”." : (opts.empty || "Nothing here yet.")))));
      body.replaceChildren(h("div", { class: "tbl-wrap" }, h("table", { class: "tbl" }, head, tb)),
        h("div", { class: "row between" }, h("span", { class: "tiny muted" }, (q ? list.length + " of " + data.length : data.length) + " " + (opts.noun || "items") + (opts.onRow ? " · click a row to open it" : "")),
          list.length > shown ? h("button", { class: "btn ghost sm", type: "button", onclick: () => { shown += opts.pageSize || 50; paint(); } }, "Show " + Math.min(opts.pageSize || 50, list.length - shown) + " more") : (opts.more || null)));
    };
    if (filterIn) filterIn.addEventListener("input", () => { q = filterIn.value.trim(); shown = opts.pageSize || 50; paint(); });
    paint();
    const wrap = h("div", { class: "stack" }, filterIn || opts.toolbar ? h("div", { class: "row between" }, filterIn, opts.toolbar || null) : null, body);
    wrap.update = (rowsNext) => { data = rowsNext; paint(); };
    return wrap;
  }
  function kv(pairs) { return h("div", { class: "kv" }, pairs.filter(p => p && p[1] != null && p[1] !== "").map(([k, v, cls]) => h("div", {}, h("span", { class: "label" }, k), h("span", { class: "v " + (cls || "") }, v)))); }
  function tabs(items, active, onPick) {
    return h("div", { class: "tabs", role: "tablist" }, items.map(([k, label]) => h("button", { type: "button", role: "tab", "aria-selected": String(k === active), onclick: () => onPick(k) }, label)));
  }
  function seg(items, active, onPick, disabled) {
    return h("div", { class: "seg", role: "group" }, items.map(k => h("button", { type: "button", "aria-pressed": String(k === active), disabled: disabled && disabled(k), onclick: () => onPick(k) }, k)));
  }
  function field(label, input, hint) { return h("label", { class: "field" }, h("span", { class: "label" }, label), input, hint ? h("span", { class: "hint" }, hint) : null); }
  function bars(items, opts) {
    const max = Math.max(...items.map(i => Math.abs(Number(i.value))), 1e-12);
    return h("div", { class: "bars" }, items.map(i => h("div", { class: "bar" },
      h("span", { title: i.label, style: "overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, i.label),
      h("div", { class: "track" }, h("div", { class: "fill" + (opts && opts.signed ? (Number(i.value) < 0 ? " neg" : " pos") : ""), style: "width:" + (Math.abs(Number(i.value)) / max * 100).toFixed(2) + "%" })),
      h("span", { class: "v" }, i.text))));
  }
  function section(title, body, actions) {
    return h("section", { class: "card" }, h("div", { class: "hd" }, h("h2", { class: "sec" }, title), actions ? h("div", { class: "row" }, actions) : null), h("div", { class: "bd" }, body));
  }
  /* Render an async section with loading and error states, keeping failures local. */
  function async(el, loader, render, opts) {
    const id = (el._loadId = (el._loadId || 0) + 1);
    el.replaceChildren(h("div", { class: "skeleton" }, (opts && opts.loading) || "Loading…"));
    return Promise.resolve().then(loader).then((data) => { if (el._loadId !== id) return; el.replaceChildren(); render(data, el); }, (e) => {
      if (el._loadId !== id) return;
      el.replaceChildren(errorBox(e, () => async(el, loader, render, opts)));
    });
  }
  // Errors from a direct connector name that connector; everything else is fetched through Exa.
  const CONNECTOR_NAMES = { cryptocom: "Crypto.com", alphavantage: "Alpha Vantage", cardchain: "CardChain AI", kartenankauf: "karten-ankauf.de", bigdata: "Bigdata.com", coinmarketcap: "CoinMarketCap", zacks: "Zacks Data", twelvedata: "Twelve Data" };
  function errorText(e) {
    const direct = e && CONNECTOR_NAMES[e.provider], n = direct || "Exa";
    const map = { no_mcp: direct ? "This needs the " + n + " connector. Open this page on claude.ai with " + n + " connected." : "Live data needs the Exa connector. Open this page on claude.ai with Exa connected.", server_not_connected: n + " isn't connected. Add it in claude.ai Settings → Connectors, then reload.", needs_reauth: n + " needs to be reconnected in claude.ai Settings → Connectors.", not_in_manifest: n + " was turned off for this page. Turn it back on from the page's Permissions menu.", not_granted: n + " access was declined for this page. Allow it from the page's Permissions menu.", approval_required: "This needs your approval. Click Try again and allow " + n + ".", server_unavailable: (direct ? n : "The data service") + " didn't respond. Try again in a moment.", blocked_by_policy: "Your organization blocks the " + n + " connector for this page.", rate_limited: n + " says its usage limit has been reached. Try again later." };
    return (e && map[e.code]) || (e && e.message) || "Something went wrong.";
  }
  function errorBox(e, retry) {
    return h("div", { class: "banner err" }, h("p", {}, errorText(e)), retry ? h("button", { class: "btn ghost sm", type: "button", onclick: retry }, "Try again") : null);
  }

  /* ---------- charts ---------- */
  function tok(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function rgba(hex, a) { const m = hex.replace("#", ""); const n = parseInt(m.length === 3 ? m.split("").map(c => c + c).join("") : m, 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
  function fmtTime(t, intraday) { const d = new Date(t * 1000); return d.toLocaleString(undefined, intraday ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" } : { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }); }
  const charts = new Set();
  /* series: {kind, points, volume?, intraday, pct?}; opts: {type: "area"|"candles", fmt, compare: [{label, points, color}] , height} */
  function chart(box, series, opts) {
    opts = opts || {};
    box.replaceChildren();
    const cv = h("div", { class: "cv" }), legend = h("div", { class: "legend" });
    box.append(legend, cv);
    const pts = series.points;
    const first = pts[0], last = pts[pts.length - 1] || null;
    const up = !last || (last.close ?? last.value) >= (first.open ?? first.value);
    const fmt = opts.fmt || ((v) => series.pct ? v.toFixed(1) + "%" : C.fmtNum(v, Math.abs(v) >= 1 ? 2 : 6));
    if (!G.LightweightCharts && pts.length) {
      const vals = pts.map(p => p.close ?? p.value), mn = Math.min(...vals), mx = Math.max(...vals);
      const d = vals.map((v, i) => (i ? "L" : "M") + (i / (vals.length - 1) * 1000).toFixed(1) + " " + (300 - (v - mn) / ((mx - mn) || 1) * 280 - 10).toFixed(1)).join("");
      cv.innerHTML = `<svg viewBox="0 0 1000 300" preserveAspectRatio="none" width="100%" height="100%" role="img" aria-label="Price chart"><path d="${d}" fill="none" stroke="${up ? tok("--up") : tok("--down")}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
      legend.textContent = "Chart library unavailable; showing a simple line.";
      return null;
    }
    const col = opts.color || (up ? tok("--up") : tok("--down"));
    const ch = G.LightweightCharts.createChart(cv, {
      autoSize: true,
      layout: { background: { type: "solid", color: tok("--sheet") }, textColor: tok("--muted"), fontFamily: "IBM Plex Mono, ui-monospace, monospace", fontSize: 11 },
      grid: { vertLines: { color: tok("--grid") }, horzLines: { color: tok("--grid") } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: series.volume && series.volume.length ? 0.24 : 0.06 } },
      timeScale: { borderVisible: false, timeVisible: !!series.intraday, secondsVisible: false, fixLeftEdge: true, fixRightEdge: true, rightOffset: 2 },
      crosshair: { mode: 0, vertLine: { color: tok("--muted"), labelBackgroundColor: tok("--ink") }, horzLine: { color: tok("--muted"), labelBackgroundColor: tok("--ink") } },
      localization: { timeFormatter: (t) => fmtTime(t, series.intraday) }
    });
    charts.add(ch);
    const ref = last ? Math.abs(last.close ?? last.value) : (opts.refPrice || 1);
    const pf = { type: "custom", formatter: fmt, minMove: series.pct ? 0.1 : Math.pow(10, -(ref >= 1 ? 2 : 6)) };
    let main;
    if (opts.type === "candles" && series.kind === "ohlc") { main = ch.addCandlestickSeries({ upColor: tok("--up"), downColor: tok("--down"), wickUpColor: tok("--up"), wickDownColor: tok("--down"), borderVisible: false, priceFormat: pf }); main.setData(pts); }
    else if (opts.compare) { main = ch.addLineSeries({ color: tok("--accent"), lineWidth: 2, priceFormat: pf }); main.setData(pts.map(p => ({ time: p.time, value: p.close ?? p.value }))); }
    else { main = ch.addAreaSeries({ lineColor: col, topColor: rgba(col, 0.24), bottomColor: rgba(col, 0.02), lineWidth: 2, priceFormat: pf, crosshairMarkerRadius: 4, crosshairMarkerBorderColor: tok("--sheet") }); main.setData(pts.map(p => ({ time: p.time, value: p.close ?? p.value }))); }
    const extra = [];
    for (const c of opts.compare || []) { const s = ch.addLineSeries({ color: c.color || tok("--bench"), lineWidth: 2, lineStyle: 2, priceFormat: pf, lastValueVisible: false, priceLineVisible: false }); s.setData(c.points); extra.push([c.label, s]); }
    if (series.volume && series.volume.length && opts.volume !== false) {
      const vs = ch.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
      ch.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      const byT = new Map(pts.map(p => [p.time, p]));
      vs.setData(series.volume.map(v => { const p = byT.get(v.time); return { time: v.time, value: v.value, color: rgba(p && p.close < p.open ? tok("--down") : tok("--up"), 0.35) }; }));
    }
    ch.timeScale().fitContent();
    const show = (p, t) => {
      if (!p) { legend.textContent = ""; return; }
      const parts = [fmtTime(t, series.intraday) + "  "];
      if (p.open != null) for (const [k, v] of [["O", p.open], ["H", p.high], ["L", p.low], ["C", p.close]]) parts.push(k + " ", h("b", {}, fmt(v)), "  ");
      else parts.push(h("b", {}, fmt(p.value)));
      legend.replaceChildren(...parts);
    };
    let latest = last, hovering = false;
    if (latest) show(latest, latest.time); else legend.textContent = opts.emptyText || "Waiting for live prices…";
    ch.subscribeCrosshairMove((param) => { hovering = !!(param && param.time && param.seriesData); if (!hovering) { if (latest) show(latest, latest.time); return; } show(param.seriesData.get(main), param.time); });
    const candles = opts.type === "candles" && series.kind === "ohlc";
    return {
      chart: ch, main,
      // Apply one live bar update (same time base as the series).
      update(p) {
        try { main.update(candles && p.open != null ? p : { time: p.time, value: p.close ?? p.value }); latest = p; if (!hovering) show(p, p.time); if (pts.length <= 2) ch.timeScale().fitContent(); } catch (e) { /* out-of-order tick */ }
      }
    };
  }
  function redrawCharts() { for (const c of charts) { try { c.applyOptions({ layout: { background: { type: "solid", color: tok("--sheet") }, textColor: tok("--muted") }, grid: { vertLines: { color: tok("--grid") }, horzLines: { color: tok("--grid") } } }); } catch { charts.delete(c); } } }
  function disposeCharts(root) { for (const c of [...charts]) { try { if (!document.body.contains(c.chartElement && c.chartElement())) { c.remove(); charts.delete(c); } } catch { charts.delete(c); } } }

  /* ---------- downloads ---------- */
  async function download(filename, data) {
    const dl = MD.app && MD.app.caps.downloads;
    if (!dl) { toast("Downloads aren't available here", "Open the page on claude.ai to save files.", true); return false; }
    try { await dl.save({ filename, data }); toast("Saved", filename); return true; }
    catch (e) { if (e && e.code === "declined") return false; toast("Couldn't save the file", e && e.message, true); return false; }
  }

  MD.ui = { dataTable, h, $, fmtTs, fmtDate, tzName, money, pct, chg, signCls, status, STATUS_HELP, toast, modal, confirmBox, table, kv, tabs, seg, field, bars, section, async, errorText, errorBox, chart, redrawCharts, disposeCharts, tok, rgba, fmtTime, download };
})(typeof window !== "undefined" ? window : globalThis);
