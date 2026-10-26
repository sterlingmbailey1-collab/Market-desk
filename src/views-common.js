/* Shared asset-page building blocks: chart panel, action bar and the modals behind it. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const C = MD.core, U = MD.ui, D = MD.data, h = U.h;
  MD.views = MD.views || {};
  const A = () => MD.app;

  /* ---------- price chart panel ---------- */
  function chartPanel(asset, opts) {
    opts = opts || {};
    const tfs = opts.tfs || ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y", "5Y", "Max"];
    const st = A().ls.get("chart." + (asset.cls || ""), { tf: opts.defaultTf || "1Y", type: "area" });
    if (!tfs.includes(st.tf)) st.tf = tfs.includes("1Y") ? "1Y" : tfs[0];
    const box = h("div", { class: "chartbox" }), stats = h("div", { class: "row", style: "gap:6px 20px" }), meta = h("div", {});
    const tfSeg = h("div", { class: "tf-seg" }), typeSeg = h("div", {});
    let series = null, handle = null;
    const drawControls = () => {
      tfSeg.replaceChildren(U.seg(tfs, st.tf, (tf) => { st.tf = tf; A().ls.set("chart." + asset.cls, st); load(); drawControls(); }));
      typeSeg.replaceChildren(U.seg(["Line", "Candles"], st.type === "candles" ? "Candles" : "Line", (t) => { st.type = t === "Candles" ? "candles" : "area"; A().ls.set("chart." + asset.cls, st); drawControls(); if (series) draw(); }, (t) => t === "Candles" && series && series.kind !== "ohlc"));
    };
    const drawStats = () => {
      const s = series.points.length >= 2 ? C.seriesStats(series.points, series.ppy || 252) : null;
      stats.replaceChildren(
        s ? statItem(st.tf + " change", U.chg(s.changePct)) : null,
        s ? statItem("High", h("span", { class: "num" }, C.fmtNum(s.high, s.high >= 1 ? 2 : 6))) : null,
        s ? statItem("Low", h("span", { class: "num" }, C.fmtNum(s.low, s.low >= 1 ? 2 : 6))) : null,
        s && isFinite(s.volPct) && !series.intraday ? statItem("Volatility (ann.)", h("span", { class: "num" }, s.volPct.toFixed(1) + "%"), "adv") : null,
        s && !series.intraday ? statItem("Max drawdown", h("span", { class: "num down" }, s.maxDrawdownPct.toFixed(1) + "%"), "adv") : null,
        s && s.cagrPct != null ? statItem("CAGR", U.chg(s.cagrPct), "adv") : null);
    };
    const draw = () => {
      handle = U.chart(box, series, { type: st.tf === "Live" ? "area" : st.type, fmt: opts.fmt, emptyText: "Waiting for the first live prices…" });
      drawStats();
      meta.replaceChildren(U.status({ status: series.proxy ? "Estimated" : series.status, source: series.source, note: series.note }));
      if (opts.onSeries) opts.onSeries(series, st.tf);
    };
    const asLive = (s) => Object.assign({}, s, { kind: "line", points: s.points.map(p => ({ time: p.time, value: p.close ?? p.value })), volume: null, barSec: 1, status: "Live", note: "Live ticks since you opened this page" + (s.points.length ? ", after " + (s.note || "recent history") : "") });
    const load = () => {
      handle = null;
      const msg = h("div", { class: "msg" }, "Loading " + st.tf + " chart…");
      box.replaceChildren(msg); stats.replaceChildren(); meta.replaceChildren();
      const id = (box._id = (box._id || 0) + 1);
      const req = opts.loader ? opts.loader(st.tf) : D.historyFor(asset, st.tf);
      req.then((s) => { if (box._id !== id) return; series = st.tf === "Live" ? asLive(s) : s; drawControls(); draw(); }, (e) => {
        if (box._id !== id) return;
        if (st.tf === "Live" && D.liveSupported(asset)) { series = asLive({ points: [], intraday: true, shift: -new Date().getTimezoneOffset() * 60, source: "Live ticks", note: "" }); drawControls(); draw(); return; }
        box.replaceChildren(h("div", { class: "msg" }, h("div", {}, U.errorText(e)), h("div", {}, h("button", { class: "btn ghost sm", type: "button", onclick: load }, "Try again"))));
      });
    };
    let statTimer = 0;
    // Fold a live price into the visible chart: extends the Live tick line, or moves the latest bar.
    const tick = (price, tsMs) => {
      if (!series || !handle || series.pct || !(price > 0)) return;
      const t = Math.floor(tsMs / 1000) + (series.shift || 0);
      const r = C.applyTick(series.points, series.kind, series.barSec || 86400, t, price);
      if (!r) return;
      handle.update(r.point);
      if (Date.now() - statTimer > 5000) { statTimer = Date.now(); drawStats(); }
    };
    drawControls(); load();
    return { el: h("div", { class: "stack" }, h("div", { class: "row between" }, tfSeg, typeSeg), box, h("div", { class: "row between" }, stats, meta)), reload: load, tick, get series() { return series; }, get tf() { return st.tf; } };
  }
  /* Time frames available per asset class (shortest first). */
  function tfsFor(asset) {
    const cls = asset.cls;
    if (cls === "stock" || cls === "etf") return ["Live", "15m", "1H", "4H", "1D", "1W", "1M", "3M", "6M", "YTD", "1Y", "5Y", "10Y"];
    if (cls === "crypto") return ["Live", "15m", "1H", "4H", "12H", "1D", "1W", "1M", "3M", "6M", "YTD", "1Y", "5Y", "Max"];
    if (cls === "fx") return D.fx.krakenPair(asset.base, asset.quote) ? ["Live", "15m", "1H", "4H", "12H", "1D", "1W", "1M", "3M", "6M", "YTD", "1Y", "5Y", "Max"] : ["Live", "1W", "1M", "3M", "6M", "YTD", "1Y", "5Y", "Max"];
    if (cls === "metal") return asset.symbol === "XAU" ? ["Live", "15m", "1H", "4H", "12H", "1W", "1M", "3M", "6M", "YTD", "1Y", "5Y", "10Y", "Max"] : asset.symbol === "XAG" ? ["Live", "1W", "1M", "3M", "6M", "YTD", "1Y", "5Y", "10Y", "Max"] : ["Live"];
    if (cls === "sports") return ["1M", "Max"];
    return ["1D", "1W", "1M", "Max"];
  }
  function statItem(label, v, cls) { return h("div", { class: "stack " + (cls || ""), style: "gap:0" }, h("span", { class: "label" }, label), v); }

  /* ---------- quote header ---------- */
  function quoteHeader(q, extra, live) {
    const app = A(), R = app.settings.displayCurrency;
    const conv = q.currency && q.currency !== R && q.price != null ? app.rates.quote(q.currency, R) : null;
    const priceEl = h("div", { class: "num price-big" }, q.price == null ? "—" : U.money(q.price, q.currency, { price: true }));
    const chgText = (price, change, pct, label) => (change != null ? (change > 0 ? "+" : "") + C.fmtNum(change, Math.abs(change) >= 1 ? 2 : 6) + " " : "") + "(" + U.pct(pct) + ") " + (label || "today");
    const chgEl = h("div", { class: "num " + U.signCls(q.changePct) }, q.changePct != null ? chgText(q.price, q.change, q.changePct, q.changeLabel) : "");
    const convEl = h("div", { class: "num muted small", title: conv ? "Converted at " + C.fmtNum(conv.rate, 6) + " (" + conv.source + "). Indicative." : "" }, conv ? "≈ " + U.money(C.convert(q.price, conv), R, { price: true }) : "");
    const statusEl = h("div", {}, U.status(Object.assign({}, q, { kind: q.kind })));
    const bidAskEl = h("div", { class: "num small muted" });
    const liveEl = h("div", { class: "livebar" });
    const trendCls = (pct) => pct > 0 ? " is-up" : pct < 0 ? " is-down" : "";
    const head = h("div", { class: "hero row between" + trendCls(q.changePct), style: "align-items:flex-start" },
      h("div", { class: "stack", style: "gap:2px" },
        h("div", { class: "row" }, h("span", { class: "pill" }, q.clsLabel || q.cls), q.listing ? h("span", { class: "pill" }, q.listing) : null, q.exchange ? h("span", { class: "pill" }, q.exchange) : null),
        h("h1", { class: "page" }, q.name), h("span", { class: "muted mono" }, [q.symbol, q.subline].filter(Boolean).join(" · "))),
      h("div", { class: "stack", style: "gap:2px;text-align:right;justify-items:end" }, priceEl, chgEl, bidAskEl, convEl, statusEl, liveEl, q.warning ? h("span", { class: "warn-t small" }, q.warning) : null, extra || null));
    if (live && live.asset && D.liveSupported(live.asset) && D.available()) {
      // Reference for the daily change when the live source doesn't give one: the previous close.
      const prevClose = q.price != null && q.change != null ? q.price - q.change : null;
      let lastPrice = q.price, lastAt = 0;
      const dot = h("span", { class: "dot" }), txt = h("span", {});
      const rates = MD.live.RATES;
      const cur = () => rates.find(r => r[1] === app.settings.liveRate) || rates[0];
      const segBox = h("span", {});
      const paintSeg = () => segBox.replaceChildren(U.seg(rates.map(r => r[0]), cur()[0], (label) => { const ms = rates.find(r => r[0] === label)[1]; app.saveSettings({ liveRate: ms }); ctl.setRate(ms); paintSeg(); }));
      liveEl.append(h("span", { class: "row", style: "gap:6px;justify-content:flex-end" }, dot, txt), segBox);
      paintSeg();
      const ctl = MD.live.start(live.asset, {
        onTick(lq) {
          let price = lq.price;
          if (lq.currency && q.currency && lq.currency !== q.currency) { const r = app.rates.quote(lq.currency, q.currency); if (!r) return; price = Number(C.convert(price, r)); }
          if (!(price > 0)) return;
          const dir = lastPrice == null || price === lastPrice ? 0 : price > lastPrice ? 1 : -1;
          priceEl.textContent = U.money(price, q.currency, { price: true });
          if (dir) { priceEl.classList.remove("tick-up", "tick-down"); void priceEl.offsetWidth; priceEl.classList.add(dir > 0 ? "tick-up" : "tick-down"); }
          let pct = null, change = null, label = q.changeLabel;
          if (prevClose && (!lq.changeLabel || lq.currency !== q.currency)) { change = price - prevClose; pct = change / prevClose * 100; }
          else if (lq.changePct != null) { pct = lq.changePct; label = lq.changeLabel; }
          if (pct != null) { chgEl.className = "num " + U.signCls(pct); chgEl.textContent = chgText(price, change, pct, label); head.classList.toggle("is-up", pct > 0); head.classList.toggle("is-down", pct < 0); }
          if (lq.bid && lq.ask) bidAskEl.textContent = "Bid " + C.fmtNum(lq.bid, lq.bid >= 1 ? 2 : 6) + " · Ask " + C.fmtNum(lq.ask, lq.ask >= 1 ? 2 : 6) + " · spread " + C.fmtNum(C.spreadBps(lq.bid, lq.ask), 1) + " bps";
          if (conv) { const c2 = app.rates.quote(q.currency, R); if (c2) convEl.textContent = "≈ " + U.money(C.convert(price, c2), R, { price: true }); }
          statusEl.replaceChildren(U.status({ status: lq.status === "Delayed" || (lq.status === "Historical") ? lq.status : "Live", source: lq.source, ts: lq.ts, currency: q.currency }));
          lastPrice = price; lastAt = Date.now();
          if (live.onTick && (!lq.currency || lq.currency === (live.chartCurrency || q.currency) || lq.currency === "USD")) live.onTick(lq.price, Date.now());
        },
        onState() {}
      });
      const paint = () => {
        const s = ctl.state;
        if (s.mode === "off") { dot.className = "dot"; txt.textContent = "Live updates off"; return; }
        if (s.mode === "paused") { dot.className = "dot"; txt.textContent = "Paused while the tab is hidden"; return; }
        if (s.mode === "error" && !lastAt) { dot.className = "dot down"; txt.textContent = "Live source unavailable · " + U.errorText(s.error); return; }
        if (!lastAt) { dot.className = "dot"; txt.textContent = "Connecting…"; return; }
        const ago = (Date.now() - lastAt) / 1000;
        dot.className = "dot live-on";
        txt.textContent = (s.closed ? "Market closed · checking every minute · " : "LIVE · ") + "updated " + (ago < 10 ? ago.toFixed(1) : Math.round(ago)) + "s ago" + (s.avgMs ? " · ~" + (s.avgMs / 1000).toFixed(1) + "s per update" : "") + (s.mode === "error" ? " · retrying" : "");
      };
      const timer = setInterval(paint, 250);
      app.trackLive({ stop() { ctl.stop(); clearInterval(timer); } });
      paint();
    }
    return head;
  }

  /* ---------- action bar ---------- */
  function actionBar(asset, getQuote, getSeries) {
    const app = A();
    const watched = () => app.store.cached("watch").find(w => w.assetId === asset.id);
    const watchBtn = h("button", { class: "btn ghost sm", type: "button" });
    const syncWatch = () => { watchBtn.textContent = watched() ? "★ Watching" : "☆ Watch"; };
    watchBtn.onclick = async () => { const w = watched(); if (w) await app.store.remove("watch", w.id); else await app.store.create("watch", Object.assign({ assetId: asset.id }, slim(asset))); syncWatch(); };
    syncWatch();
    return h("div", { class: "row" },
      h("button", { class: "btn sm", type: "button", onclick: () => app.go("research", Object.assign({}, app.ctx.research || {}, { asset: slim(asset), autostart: false })) }, "Deep research"),
      h("button", { class: "btn ghost sm", type: "button", onclick: () => txModal(asset, getQuote && getQuote()) }, "Add to portfolio"),
      MD.paper ? MD.paper.button(app, asset, { source: "asset" }) : null,
      watchBtn,
      h("button", { class: "btn ghost sm", type: "button", onclick: () => alertModal(asset, getQuote && getQuote()) }, "Create alert"),
      h("button", { class: "btn ghost sm", type: "button", onclick: () => scenarioModal(asset, getQuote && getQuote(), getSeries && getSeries()) }, "Run scenario"),
      h("button", { class: "btn ghost sm", type: "button", onclick: () => app.go("opportunities", { compare: [slim(asset)] }) }, "Compare"),
      h("button", { class: "btn ghost sm", type: "button", onclick: () => explainMove(asset, getQuote && getQuote()) }, "Explain price move"),
      h("button", { class: "btn ghost sm", type: "button", onclick: () => catalystModal(asset) }, "Track catalyst"));
  }
  function slim(a) { const o = {}; for (const k of ["id", "cls", "symbol", "name", "cgId", "tcgdexId", "ygoId", "base", "quote", "slug", "variant", "priceSource", "currency", "exchange", "listing", "cardchainId", "ccQuery", "grade", "player"]) if (a[k] != null) o[k] = a[k]; return o; }

  /* ---------- news list (Bigdata.com, CoinMarketCap) ---------- */
  function newsList(items, opts = {}) {
    if (!items.length) return h("div", { class: "empty" }, opts.empty || "No recent news found.");
    const clip = (t, n) => { t = String(t || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n).replace(/\s\S*$/, "") + "…" : t; };
    return h("ul", { class: "newslist" }, items.slice(0, opts.max || 10).map(x => h("li", {},
      h("a", { href: x.url, target: "_blank", rel: "noopener noreferrer" }, x.title || x.url),
      h("div", { class: "tiny muted" }, [x.source, x.ts ? U.fmtTs(x.ts) : null].filter(Boolean).join(" · ")),
      x.text || x.description ? h("p", { class: "small" }, clip(x.description || x.text, opts.clip || 320)) : null)));
  }

  /* ---------- transaction modal ---------- */
  function assetPicker(onPick, classes) {
    const input = h("input", { type: "search", placeholder: "Search ticker, coin, card, metal or currency…", "aria-label": "Asset" });
    const list = h("div", { class: "stack", style: "max-height:220px;overflow:auto" });
    let t = null, id = 0;
    input.addEventListener("input", () => {
      clearTimeout(t); const q = input.value.trim(); const my = ++id;
      if (q.length < 2) { list.replaceChildren(); return; }
      t = setTimeout(async () => {
        const out = [];
        const reg = A().reg;
        const up = q.toUpperCase();
        if (reg.has(up)) { const c = reg.get(up); out.push(c.type === "metal" ? { id: "metal:" + up, cls: "metal", symbol: up, name: c.name, currency: "USD" } : { id: "cash:" + up, cls: "cash", symbol: up, name: up + " cash", currency: up }); }
        const tasks = [D.stocks.search(q), D.crypto.search(q)];
        if (q.length >= 3) tasks.push(D.pokemon.search(q), D.ygo.search(q));
        const res = await Promise.allSettled(tasks);
        if (my !== id) return;
        for (const r of res) if (r.status === "fulfilled") out.push(...r.value.slice(0, 5));
        list.replaceChildren(...out.filter(a => !classes || classes.includes(a.cls)).map(a => h("button", { class: "btn ghost sm", type: "button", style: "justify-content:space-between;width:100%", onclick: () => { onPick(a); list.replaceChildren(); input.value = (a.symbol || "") + " — " + a.name; } }, h("span", {}, (a.symbol ? a.symbol + " — " : "") + a.name), h("span", { class: "faint tiny" }, [a.exchange, a.cls].filter(Boolean).join(" · ")))));
        if (!out.length) list.replaceChildren(h("div", { class: "muted small" }, "No matches. For sports cards or other collectibles, use “Custom asset”."));
      }, 350);
    });
    return h("div", { class: "stack" }, input, list);
  }
  function txModal(asset, quote, preset) {
    const app = A();
    let a = asset ? Object.assign({}, asset) : null;
    const info = h("div", { class: "small muted" });
    const f = {
      type: h("select", { id: "tx-type" }, ["buy", "sell", "dividend", "fee", "deposit", "withdraw"].map(t => h("option", { value: t }, t))),
      date: h("input", { type: "date", id: "tx-date", value: new Date().toISOString().slice(0, 10) }),
      qty: h("input", { type: "text", id: "tx-qty", inputmode: "decimal", placeholder: "e.g. 10" }),
      unit: h("select", { id: "tx-unit" }, ["unit", "share", "coin", "toz", "g", "kg", "card"].map(u => h("option", { value: u }, u))),
      price: h("input", { type: "text", id: "tx-price", inputmode: "decimal", placeholder: "per unit" }),
      amount: h("input", { type: "text", id: "tx-amount", inputmode: "decimal", placeholder: "total amount" }),
      currency: h("select", { id: "tx-ccy" }, [...app.reg.values()].filter(c => c.type !== "metal").map(c => h("option", { value: c.code }, c.code))),
      fees: h("input", { type: "text", id: "tx-fees", inputmode: "decimal", value: "0" }),
      fx: h("input", { type: "text", id: "tx-fx", inputmode: "decimal", placeholder: "auto" }),
      note: h("input", { type: "text", id: "tx-note", placeholder: "Optional" }),
      condition: h("input", { type: "text", id: "tx-cond", placeholder: "e.g. Near Mint, PSA 10" }),
      variant: h("input", { type: "text", id: "tx-variant", placeholder: "printing / parallel / variant" })
    };
    if (preset) for (const [k, v] of Object.entries(preset)) if (f[k]) f[k].value = v;
    const fxNote = h("span", { class: "hint" }, "Rate from the transaction currency to USD on the trade date. Leave blank to use the ECB reference rate; enter the rate you actually got if you know it.");
    let fxAuto = null;
    const setAsset = (x) => {
      a = x;
      f.currency.value = x.currency || (x.cls === "cash" ? x.symbol : "USD");
      f.unit.value = x.cls === "metal" ? "toz" : (x.cls === "pokemon" || x.cls === "yugioh" || x.cls === "sports") ? "card" : x.cls === "crypto" ? "coin" : x.cls === "cash" ? "unit" : "share";
      if (quote && quote.price && !f.price.value) f.price.value = String(quote.price);
      info.textContent = a ? (a.symbol || "") + " · " + a.name + " · " + a.cls : "";
      sync(); lookupFx();
    };
    const sync = () => {
      const t = f.type.value, cash = a && a.cls === "cash";
      for (const k of ["qty", "price", "unit"]) f[k].closest(".field").hidden = !["buy", "sell"].includes(t) || cash;
      f.amount.closest(".field").hidden = ["buy", "sell"].includes(t) && !cash;
      for (const k of ["condition", "variant"]) f[k].closest(".field").hidden = !(a && ["pokemon", "yugioh", "sports"].includes(a.cls));
    };
    async function lookupFx() {
      const cur = f.currency.value, date = f.date.value;
      if (cur === "USD") { fxAuto = { rate: "1", source: "identity" }; fxNote.textContent = "USD transaction: rate 1."; return; }
      fxNote.textContent = "Looking up the ECB reference rate for " + date + "…";
      const r = await app.rates.at(date, cur, "USD");
      if (r) { fxAuto = { rate: r.rate.toString(), source: r.source, date: r.date }; fxNote.textContent = "ECB reference: 1 " + cur + " = " + C.fmtNum(r.rate, 6) + " USD (" + r.source + "). Override with your executed rate if different."; }
      else { fxAuto = null; fxNote.textContent = "No historical reference rate for " + cur + " (the ECB doesn't publish it). Enter the rate you got, or the cost basis will be marked estimated."; }
    }
    f.type.onchange = sync; f.currency.onchange = lookupFx; f.date.onchange = lookupFx;
    const err = h("div", { class: "err" });
    const custom = h("button", { class: "linkbtn", type: "button", onclick: () => customAssetModal((x) => setAsset(x)) }, "Custom asset (sports card, collectible…)");
    const body = h("div", { class: "stack" },
      a ? null : U.field("Asset", assetPicker(setAsset)), a ? null : custom, info,
      h("div", { class: "form" }, U.field("Type", f.type), U.field("Trade date", f.date), U.field("Quantity", f.qty), U.field("Unit", f.unit), U.field("Price per unit", f.price), U.field("Amount", f.amount), U.field("Currency", f.currency), U.field("Fees (same currency)", f.fees),
        h("div", { class: "wide" }, U.field("FX rate to USD", f.fx, null), fxNote), U.field("Condition / grade", f.condition), U.field("Variant", f.variant), h("div", { class: "wide" }, U.field("Note", f.note))),
      h("p", { class: "small muted" }, "Transactions are permanent. To fix a mistake, reverse it from the ledger and enter it again; the original stays in the audit trail."),
      err,
      h("div", { class: "row end" }, h("button", { class: "btn", type: "button", onclick: save }, "Record transaction")));
    const m = U.modal("Add transaction", body);
    if (a) setAsset(a); else sync();
    lookupFx();
    async function save() {
      if (!a) { err.textContent = "Choose an asset first."; return; }
      const t = f.type.value, cash = a.cls === "cash";
      const tx = { type: t, tradeDate: f.date.value, assetId: a.id, assetClass: a.cls, symbol: a.symbol, name: a.name, unit: f.unit.value, currency: f.currency.value, fees: f.fees.value || "0", note: f.note.value, source: "manual",
        meta: Object.assign(slim(a), { condition: f.condition.value || undefined, printing: f.variant.value || undefined }) };
      if (["buy", "sell"].includes(t) && !cash) { tx.quantity = f.qty.value.replace(/,/g, ""); tx.price = f.price.value.replace(/,/g, ""); }
      else if (cash && ["buy", "sell"].includes(t)) { tx.type = t === "buy" ? "deposit" : "withdraw"; tx.amount = f.amount.value.replace(/,/g, ""); }
      else tx.amount = f.amount.value.replace(/,/g, "");
      if (f.fx.value.trim()) { tx.fxToUSD = f.fx.value.trim(); tx.fxSource = "Entered by you"; }
      else if (fxAuto) { tx.fxToUSD = fxAuto.rate; tx.fxSource = fxAuto.source; }
      const errs = C.validateTx(tx, app.reg);
      if (t === "sell") { const { positions } = C.buildPositions(app.store.cached("tx")); const p = positions.get(a.id); if (!p || p.qty.lt(C.dec(tx.quantity) || 0)) errs.push("You hold " + (p ? p.qty.toString() : "0") + "; you can't sell more than that."); }
      if (errs.length) { err.textContent = errs.join(" "); return; }
      try { await app.store.create("tx", tx); U.toast("Transaction recorded", tx.type + " " + (tx.quantity || tx.amount) + " " + a.symbol); m.close(); app.emit("data:tx"); }
      catch (e) { err.textContent = U.errorText(e); }
    }
  }
  function customAssetModal(onDone) {
    const f = { name: h("input", { type: "text", placeholder: "e.g. 2018 Prizm Luka Dončić #280 Silver" }), kind: h("select", {}, [["sports", "Sports card"], ["manual", "Other collectible / alternative"]].map(([v, l]) => h("option", { value: v }, l))), player: h("input", { type: "text" }), year: h("input", { type: "text" }), grade: h("input", { type: "text", placeholder: "e.g. PSA 10" }), currency: h("select", {}, [...MD.app.reg.values()].filter(c => c.type === "fiat").map(c => h("option", { value: c.code }, c.code))) };
    const m = U.modal("Custom asset", h("div", { class: "stack" }, h("p", { class: "small muted" }, "Market Desk looks up this card's sold listings on PriceCharting / SportsCardsPro by name, and you can value it at the median sale."),
      h("div", { class: "form" }, h("div", { class: "wide" }, U.field("Name", f.name)), U.field("Kind", f.kind), U.field("Player / subject", f.player), U.field("Year", f.year), U.field("Grade", f.grade), U.field("Valuation currency", f.currency)),
      h("div", { class: "row end" }, h("button", { class: "btn", type: "button", onclick: async () => {
        if (!f.name.value.trim()) return;
        const asset = { id: f.kind.value + ":" + MD.store.newId(), cls: f.kind.value, symbol: (f.player.value || f.name.value).slice(0, 18), name: f.name.value.trim(), currency: f.currency.value, player: f.player.value, year: f.year.value, grade: f.grade.value };
        await MD.app.store.put("assets", asset.id, asset); m.close(); onDone(asset);
      } }, "Create"))));
  }

  /* ---------- alert modal ---------- */
  function alertModal(asset, quote, preset) {
    const app = A();
    const techOk = ["stock", "etf", "crypto", "metal", "fx"].includes(asset.cls || String(asset.id || "").split(":")[0]);
    const kind = h("select", {}, [["above", "Price rises to or above"], ["below", "Price falls to or below"], ["move", "Daily move of at least (±%)"]].concat(techOk ? Object.entries(MD.quant.TECH_ALERTS) : []).map(([v, l]) => h("option", { value: v, selected: !!(preset && preset.kind === v) }, l)));
    const th = h("input", { type: "text", inputmode: "decimal", value: preset && preset.threshold ? String(preset.threshold) : quote && quote.price ? String(quote.price) : "" });
    const note = h("input", { type: "text", placeholder: "Why this matters (optional)", value: preset && preset.note || null });
    const err = h("div", { class: "err" }), thField = U.field("Threshold", th, quote ? "Now " + C.fmtNum(quote.price, quote.price >= 1 ? 2 : 6) + " " + (quote.currency || "") : null);
    const noTh = (k) => ["xma50", "xma200", "high52", "low52"].includes(k);
    kind.addEventListener("change", () => { thField.hidden = noTh(kind.value); if (kind.value === "rsi_above") th.value = "70"; else if (kind.value === "rsi_below") th.value = "30"; else if (!noTh(kind.value) && quote && quote.price && Number(th.value) <= 100 && kind.value !== "move") th.value = String(quote.price); });
    const m = U.modal("Create alert · " + (asset.symbol || asset.name), h("div", { class: "stack" },
      h("div", { class: "form" }, U.field("Condition", kind), thField, h("div", { class: "wide" }, U.field("Note", note))),
      h("p", { class: "small muted" }, "Alerts are checked every two minutes while Market Desk is open, then once each time you return. An alert fires once and re-arms only after the price moves back past the threshold. Technical alerts compare the live price with daily closes (moving averages, RSI, the prior 52-week range)."),
      err, h("div", { class: "row end" }, h("button", { class: "btn", type: "button", onclick: async () => {
        const v = noTh(kind.value) ? 0 : Number(th.value.replace(/,/g, "")); if (!noTh(kind.value) && (!isFinite(v) || v <= 0)) { err.textContent = "Enter a positive threshold."; return; }
        if (kind.value.startsWith("rsi") && v >= 100) { err.textContent = "RSI runs from 0 to 100."; return; }
        // The asset's own id must not become the alert's id, or a second alert on the same asset would replace the first.
        const doc = Object.assign(slim(asset), { assetId: asset.id, kind: kind.value, threshold: v, note: note.value, state: { armed: true } }); delete doc.id;
        await app.store.create("alerts", doc);
        U.toast("Alert created"); m.close();
      } }, "Create alert"))));
  }

  /* ---------- scenario (reward/risk + touch probability) ---------- */
  function scenarioModal(asset, quote, series) {
    const p0 = quote && quote.price;
    const vol = series ? C.seriesStats(series.points, series.ppy || 252) : null;
    const f = { entry: h("input", { type: "text", value: p0 ? String(p0) : "" }), target: h("input", { type: "text", value: p0 ? String(+(p0 * 1.15).toPrecision(6)) : "" }), stop: h("input", { type: "text", value: p0 ? String(+(p0 * 0.92).toPrecision(6)) : "" }),
      side: h("select", {}, ["long", "short"].map(s => h("option", { value: s }, s))), fee: h("input", { type: "text", value: String(MD.app.exitAssumption(asset.cls, quote && quote.currency || "USD", MD.app.settings.reportingCurrency).exitCostPct) }), fxc: h("input", { type: "text", value: quote && quote.currency !== MD.app.settings.reportingCurrency ? "0.5" : "0" }),
      pUp: h("input", { type: "text", placeholder: "optional %" }), days: h("input", { type: "text", value: "90" }), sigma: h("input", { type: "text", value: vol && isFinite(vol.volPct) ? vol.volPct.toFixed(1) : "" }), mu: h("input", { type: "text", value: "0" }) };
    const out = h("div", { class: "stack" });
    const calc = () => {
      const r = C.rewardRisk({ entry: f.entry.value, target: f.target.value, stop: f.stop.value, side: f.side.value, feePct: f.fee.value || 0, fxCostPct: f.fxc.value || 0, pUp: f.pUp.value ? Number(f.pUp.value) : null });
      out.replaceChildren();
      if (!r.ok) { out.append(h("div", { class: "err" }, r.reason)); return; }
      out.append(U.kv([["Gross upside", r.grossUpPct ? U.pct(r.grossUpPct) : "—"], ["Gross downside", r.grossDownPct ? U.pct(r.grossDownPct.neg()) : "—"], ["Round-trip costs", U.pct(r.costsPct.neg())], ["Net upside", r.netUpPct ? U.pct(r.netUpPct) : "—"], ["Net downside", r.netDownPct ? U.pct(r.netDownPct.neg()) : "—"],
        ["Reward-to-risk", r.ratio != null ? C.fmtNum(r.ratio, 2) + " : 1" : "Not defined"], ["Break-even win rate", r.breakevenWinRatePct ? C.fmtNum(r.breakevenWinRatePct, 1) + "%" : "—"], ["Expected return (your probability)", r.expectedPct ? U.pct(r.expectedPct) : "—"]]));
      if (r.ratio == null) out.append(h("div", { class: "banner warn" }, h("p", {}, r.ratioReason)));
      const sig = Number(f.sigma.value) / 100, days = Number(f.days.value), e = Number(f.entry.value);
      if (sig > 0 && days > 0 && f.side.value === "long") {
        const tp = C.touchProbability({ entry: e, target: Number(f.target.value), stop: Number(f.stop.value), days: Math.round(days * (asset.cls === "crypto" ? 1 : 252 / 365)), mu: Number(f.mu.value) / 100, sigma: sig, ppy: asset.cls === "crypto" ? 365 : 252, paths: 3000, seed: 11 });
        out.append(h("h3", {}, "Hypothetical path simulation"), U.kv([["Hits target first", (tp.pTarget * 100).toFixed(1) + "%"], ["Hits stop first", (tp.pStop * 100).toFixed(1) + "%"], ["Neither within " + days + " days", (tp.pNeither * 100).toFixed(1) + "%"], ["Median days to target (when hit)", tp.medianDaysToTarget != null ? String(Math.round(tp.medianDaysToTarget * (asset.cls === "crypto" ? 1 : 365 / 252))) : "—"]]),
          h("p", { class: "small muted" }, "Random-walk model with " + f.sigma.value + "% annual volatility" + (vol ? " (measured from the chart you were viewing)" : "") + " and " + f.mu.value + "% assumed drift; " + tp.paths + " paths, seed " + tp.seed + ". This is a model of uncertainty, not a forecast. Real prices jump, trend and gap; a target may never be reached."));
      }
    };
    for (const i of Object.values(f)) i.addEventListener("input", calc);
    f.side.onchange = calc;
    U.modal("Scenario · " + (asset.symbol || asset.name), h("div", { class: "stack" },
      h("div", { class: "explain" }, "Reward-to-risk = net upside ÷ net downside, after round-trip fees and currency costs. It is undefined when there's no downside level below the entry."),
      h("div", { class: "form" }, U.field("Entry", f.entry), U.field("Target", f.target), U.field("Downside / stop", f.stop), U.field("Direction", f.side), U.field("Fee % per side", f.fee), U.field("FX cost % per side", f.fxc), U.field("Your probability of target (%)", f.pUp), U.field("Horizon (calendar days)", f.days), U.field("Volatility (ann. %)", f.sigma), U.field("Assumed drift (ann. %)", f.mu)),
      out));
    calc();
  }

  /* ---------- catalyst modal ---------- */
  function catalystModal(asset) {
    const f = { title: h("input", { type: "text", placeholder: "e.g. Q3 earnings, set rotation, ECB meeting" }), date: h("input", { type: "date" }), impact: h("select", {}, ["High", "Medium", "Low"].map(x => h("option", {}, x))), note: h("textarea", { placeholder: "What could happen and why it matters" }) };
    const m = U.modal("Track catalyst · " + (asset.symbol || asset.name), h("div", { class: "stack" }, h("div", { class: "form" }, h("div", { class: "wide" }, U.field("Event", f.title)), U.field("Date", f.date), U.field("Expected impact", f.impact), h("div", { class: "wide" }, U.field("Notes", f.note))),
      h("div", { class: "row end" }, h("button", { class: "btn", type: "button", onclick: async () => { if (!f.title.value.trim() || !f.date.value) return; await MD.app.store.create("catalysts", Object.assign(slim(asset), { assetId: asset.id, title: f.title.value.trim(), date: f.date.value, impact: f.impact.value, note: f.note.value })); U.toast("Catalyst tracked"); m.close(); } }, "Save"))));
  }

  /* ---------- explain price move (AI + web search with a visible tool log) ---------- */
  async function explainMove(asset, quote) {
    const app = A(), s = app.caps.sample;
    const log = h("div", { class: "log" }), out = h("div", { class: "prose" });
    const m = U.modal("Explain price move · " + (asset.symbol || asset.name), h("div", { class: "stack" }, log, out));
    if (!s) { out.append(U.errorBox({ message: "Claude isn't available in this view. Open the page on claude.ai." })); return; }
    const sources = [];
    const add = (cls, t) => log.append(h("div", { class: cls }, t));
    add("run", "Using live quote: " + (quote ? C.fmtNum(quote.price, quote.price >= 1 ? 2 : 6) + " " + quote.currency + " (" + (quote.changePct != null ? U.pct(quote.changePct) : "change n/a") + "), " + quote.source : "unavailable"));
    try {
      const r = await s.json(`Explain the most recent price move of ${asset.name} (${asset.symbol}, ${asset.cls}). Today is ${new Date().toISOString().slice(0, 10)}.
Live quote: ${JSON.stringify(quote ? { price: quote.price, currency: quote.currency, changePct: quote.changePct, source: quote.source, status: quote.status } : null)}
Use search_web to find news from the last few days. Only state causes supported by a retrieved source; if nothing explains the move, say so plainly — moves are often noise.
Reply ONLY with JSON: {"summary": "2-4 sentences", "drivers": [{"driver": "...", "evidence": "...", "url": "https://..."}], "confidence": "low"|"medium"|"high", "caveat": "one sentence"}`, {
        modelTier: "default", cache: false,
        tools: [{ name: "search_web", description: "Search recent news and pages. Returns titles, URLs and text highlights.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
          async execute(i) { add("run", "Searching: " + i.query); try { const r = await D.webSearch(String(i.query), "Recent news explaining price moves of " + asset.name, 5); sources.push(...r.results); add("ok", r.results.length + " results"); return r.text.slice(0, 20000); } catch (e) { add("fail", "Search failed"); throw new Error(U.errorText(e)); } } }]
      });
      const retrieved = new Set(sources.map(x => x.url));
      out.append(h("p", {}, r.summary || ""), h("ul", {}, (r.drivers || []).map(d => h("li", {}, h("strong", {}, d.driver + ": "), d.evidence || "", " ", d.url && /^https?:/.test(d.url) ? h("a", { href: d.url, target: "_blank", rel: "noopener noreferrer" }, "source") : null, d.url && !retrieved.has(d.url) ? h("span", { class: "warn-t small" }, " (not retrieved in this session)") : null))),
        h("p", { class: "small muted" }, "Confidence: " + (r.confidence || "—") + ". " + (r.caveat || "")));
    } catch (e) { out.append(U.errorBox({ message: e && e.code === "not_granted" ? "Claude access was declined for this page." : (e && e.message) || "Couldn't explain the move." })); }
  }

  MD.common = { newsList, tfsFor, chartPanel, quoteHeader, actionBar, slim, txModal, assetPicker, customAssetModal, alertModal, scenarioModal, catalystModal, explainMove, statItem };
})(typeof window !== "undefined" ? window : globalThis);
