/* Paper trading: a virtual US-dollar account for practising and for testing the desk's ideas with real sizing. Orders
   fill at the live quote at the moment they're placed (its source and time are stored with the order); nothing is ever
   bought or sold for real. Every buy is mirrored into SPY at the same moment, so the account and each closed trade are
   judged against "the same trades in the S&P 500". Orders are append-only (collection "paper"); starting over sets a
   new start time and keeps the old orders. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const C = MD.core, U = MD.ui, D = MD.data, h = U.h, X = MD.common;
  const V = (MD.views = MD.views || {});
  const START = 100000;
  const CLASSES = ["stock", "etf", "crypto"];
  const SOURCES = { manual: "You", asset: "Asset page", pick: "Recommendations", "ai-decide": "AI decision", screener: "Screener", today: "Game plan", daytrade: "Day Trading" };
  const SPY = { id: "stock:SPY", cls: "etf", symbol: "SPY", name: "SPDR S&P 500 ETF" };

  const acct = (app) => Object.assign({ startCash: START, startedAt: 0 }, app.settings.paper || {});
  const orders = (app) => { const a = acct(app); return app.store.cached("paper").filter(o => (o.createdAt || 0) >= a.startedAt); };
  const clsOf = (a) => a.cls || String(a.id).split(":")[0];
  const feeRate = (app, cls) => { const s = app.settings.assumptions || {}; return (cls === "crypto" ? Number(s.cryptoExitPct) || 0 : Number(s.stockExitPct) || 0) / 100; };
  const usd = (x) => U.money(x, "USD");

  // The ledger marked to live quotes. Quotes that fail are listed as missing (valued at cost), never guessed.
  async function state(app) {
    const a = acct(app), L = C.paperLedger(orders(app), a.startCash), prices = {}, quotes = {};
    const [spyQ] = await Promise.all([app.quote(SPY, 60000).catch(() => null), ...L.positions.map(async p => {
      try { const q = await app.quote(p.asset || { id: p.assetId, symbol: p.symbol, cls: String(p.assetId).split(":")[0] }, 60000); prices[p.assetId] = q.price; quotes[p.assetId] = q; } catch {}
    })]);
    const v = C.paperValue(L, prices, spyQ ? spyQ.price : null, a.startCash);
    return { a, L, v, prices, quotes, spyQ };
  }

  async function place(app, asset, side, qty, opts) {
    const cls = clsOf(asset);
    if (!CLASSES.includes(cls)) throw new Error("Paper trading covers stocks, ETFs and crypto.");
    if (app.demo) throw new Error("Demo mode: paper orders aren't saved.");
    const [q, spy] = await Promise.all([app.quote(asset, 15000), asset.symbol === "SPY" ? null : app.quote(SPY, 60000).catch(() => null)]);
    if (!(q.price > 0)) throw new Error("No live price for " + asset.symbol + ", so the order can't be filled.");
    if ((q.currency || "USD") !== "USD") throw new Error(asset.symbol + " is priced in " + q.currency + "; the paper account is in US dollars.");
    const spyPrice = asset.symbol === "SPY" ? q.price : spy && spy.price > 0 ? spy.price : null;
    const doc = { side, assetId: asset.id, asset: X.slim(asset), symbol: asset.symbol, qty: +Number(qty).toFixed(6), price: q.price, currency: "USD", priceSource: q.source || "", priceAt: q.ts || Date.now(), priceStatus: q.status || "",
      feeRate: feeRate(app, cls), spyPrice, source: (opts && opts.source) || "manual", note: (opts && opts.note) || "" };
    if (opts && opts.extra) Object.assign(doc, opts.extra);
    const L = C.paperLedger(orders(app).concat([Object.assign({ createdAt: Date.now() + 1 }, doc)]), acct(app).startCash);
    if (L.issues.length > C.paperLedger(orders(app), acct(app).startCash).issues.length) throw new Error(L.issues[L.issues.length - 1].msg.replace(/; skipped\.$/, "."));
    const saved = await app.store.create("paper", doc);
    app.emit("paper", saved);
    return saved;
  }

  /* Order ticket. opts: { source, note, side, amount, pct } (pct = share of the account's value for the default size). */
  function ticket(app, asset, opts) {
    opts = opts || {};
    const cls = clsOf(asset), body = h("div", { class: "stack" }), info = h("div", { class: "stack", style: "gap:4px" }, h("p", { class: "small muted" }, "Getting the live price…"));
    const side = h("select", { "aria-label": "Side" }, h("option", { value: "buy" }, "Buy"), h("option", { value: "sell", selected: opts.side === "sell" }, "Sell"));
    const amt = h("input", { type: "number", min: 0, step: "any", "aria-label": "Amount in US dollars" }), qtyIn = h("input", { type: "number", min: 0, step: "any", "aria-label": "Quantity" });
    const go = h("button", { class: "btn", type: "button", disabled: true }, "Place paper order"), msg = h("p", { class: "small", role: "status" });
    body.append(h("p", { class: "small" }, h("strong", {}, "Virtual money. "), "Nothing is bought or sold for real: the desk is read-only. The order fills at the live quote when you place it."),
      info, h("div", { class: "row", style: "gap:10px;flex-wrap:wrap;align-items:flex-end" }, U.field("Side", side), U.field("Amount (USD)", amt), U.field("Quantity", qtyIn), go), msg);
    const m = U.modal("Paper trade · " + (asset.symbol || asset.name), body);
    if (!CLASSES.includes(cls)) { info.replaceChildren(h("p", { class: "small warn-t" }, "Paper trading covers stocks, ETFs and crypto.")); return m; }
    let q = null, st = null;
    const held = () => st ? st.L.positions.find(p => p.assetId === asset.id) : null;
    const sync = (from) => {
      if (!q) return;
      if (from === "amt") qtyIn.value = Number(amt.value) > 0 ? +(Number(amt.value) / q.price).toFixed(6) : "";
      else amt.value = Number(qtyIn.value) > 0 ? +(Number(qtyIn.value) * q.price).toFixed(2) : "";
      const n = Number(qtyIn.value), fee = n * q.price * feeRate(app, cls), p = held();
      go.disabled = !(n > 0) || (side.value === "sell" && !p);
      msg.className = "small"; msg.textContent = n > 0 ? (side.value === "buy" ? "Costs about " + usd(n * q.price + fee) + " including " + usd(fee) + " estimated commission/spread; cash after: " + usd(st.L.cash - n * q.price - fee) + "." : p ? "Sells " + Math.min(n, p.qty) + " of " + +p.qty.toFixed(6) + " held for about " + usd(Math.min(n, p.qty) * q.price - fee) + " after costs." : "You don't hold " + asset.symbol + " in the paper account.") : "";
    };
    amt.oninput = () => sync("amt"); qtyIn.oninput = () => sync("qty");
    side.onchange = () => { const p = held(); if (side.value === "sell" && p) { qtyIn.value = +p.qty.toFixed(6); sync("qty"); } else sync("amt"); };
    (async () => {
      try {
        [q, st] = await Promise.all([app.quote(asset, 15000), state(app)]);
        if ((q.currency || "USD") !== "USD") { info.replaceChildren(h("p", { class: "small warn-t" }, asset.symbol + " is priced in " + q.currency + "; the paper account is in US dollars.")); return; }
        const p = held();
        info.replaceChildren(h("div", { class: "row", style: "gap:14px;flex-wrap:wrap" }, h("span", {}, h("span", { class: "label" }, "Live price "), h("b", { class: "num" }, U.money(q.price, "USD", { price: true }))),
          h("span", {}, h("span", { class: "label" }, "Paper cash "), h("b", { class: "num" }, usd(st.L.cash))), p ? h("span", {}, h("span", { class: "label" }, "Held "), h("b", { class: "num" }, String(+p.qty.toFixed(6)))) : null),
          h("p", { class: "tiny muted" }, (q.source || "price") + " · " + (q.ts ? U.fmtTs(q.ts) : "time unknown") + (q.status && q.status !== "Live" ? " · " + q.status + ": the order fills at this last price" : "")),
          q.nextEarnings ? h("p", { class: "tiny warn-t" }, "Next earnings: " + q.nextEarnings + ". Prices can gap on the report.") : null);
        if (opts.side === "sell" && p) qtyIn.value = +p.qty.toFixed(6);
        else { const pct = opts.pct > 0 ? opts.pct : 5; amt.value = opts.amount > 0 ? opts.amount : Math.max(0, Math.min(st.L.cash, Math.round(st.v.equity * pct / 100))); }
        sync(opts.side === "sell" && p ? "qty" : "amt");
      } catch (e) { info.replaceChildren(h("p", { class: "small warn-t" }, "No live price: " + U.errorText(e))); }
    })();
    go.onclick = async () => {
      go.disabled = true; msg.textContent = "Filling at the live price…";
      try {
        const o = await place(app, asset, side.value, Number(qtyIn.value), opts);
        m.close(); U.toast("Paper " + o.side + " filled", (o.side === "buy" ? "Bought " : "Sold ") + o.qty + " " + o.symbol + " at " + U.money(o.price, "USD", { price: true }) + " (virtual money)");
      } catch (e) { msg.className = "small neg"; msg.textContent = U.errorText(e); go.disabled = false; }
    };
    return m;
  }
  const button = (app, asset, opts, label) => CLASSES.includes(clsOf(asset)) ? h("button", { class: "btn ghost sm", type: "button", onclick: (e) => { e.stopPropagation(); ticket(app, asset, opts); } }, label || "Paper trade") : null;

  /* Auto-follow: with settings.paperFollow.on, every new Recommendations pick that leans up is paper-bought with
     `pct`% of the account (while cash lasts) and sold automatically once its window ends: a sized, forward test of the
     AI. Positions bought by hand are never auto-sold. */
  const followCfg = (app) => Object.assign({ on: false, pct: 5 }, app.settings.paperFollow || {});
  async function followSet(app, set) {
    const cfg = followCfg(app); if (!cfg.on || app.demo || !set || !Array.isArray(set.picks)) return [];
    const placed = [];
    for (const pk of set.picks) {
      const a = pk.asset || {}, exitAt = (set.createdAt || Date.now()) + (Number(pk.timeframeDays) || 30) * 864e5;
      if (!(pk.upPct > 50) || !CLASSES.includes(clsOf(a)) || exitAt <= Date.now()) continue;
      if (app.store.cached("paper").some(o => o.setId === set.id && o.assetId === a.id)) continue;
      try {
        const st = await state(app), q = await app.quote(a, 30000), amount = Math.min(st.L.cash / (1 + feeRate(app, clsOf(a))), st.v.equity * Math.max(0.5, Math.min(25, Number(cfg.pct) || 5)) / 100);
        if (!(q.price > 0) || amount < 1) continue;
        placed.push(await place(app, a, "buy", amount / q.price, { source: "pick", note: "Auto-follow · " + pk.upPct + "% up over " + (pk.timeframeLabel || pk.timeframeDays + " days"), extra: { auto: true, exitAt, setId: set.id } }));
      } catch {}
    }
    return placed;
  }
  // With paperFollow.decisions on too, an AI decision to buy or add is paper-bought at its size ceiling (at most 25% of
  // the account) and sold when its horizon ends. One per asset per day.
  async function followDecision(app, d, asset) {
    const cfg = followCfg(app); if (!cfg.on || !cfg.decisions || app.demo || !d || !(d.decision === "buy" || d.decision === "accumulate")) return null;
    const a = asset || { id: d.assetId, symbol: d.symbol, cls: String(d.assetId).split(":")[0] }, cls = clsOf(a), key = "decide:" + a.id + ":" + new Date().toISOString().slice(0, 10);
    if (!CLASSES.includes(cls) || app.store.cached("paper").some(o => o.setId === key)) return null;
    const st = await state(app), q = await app.quote(a, 30000), pct = Math.max(0.5, Math.min(25, Number(d.math && d.math.ceilingPct) || Number(cfg.pct) || 5));
    const amount = Math.min(st.L.cash / (1 + feeRate(app, cls)), st.v.equity * pct / 100);
    if (!(q.price > 0) || amount < 1) return null;
    return place(app, a, "buy", amount / q.price, { source: "ai-decide", note: "Auto-follow · " + ((MD.decide && MD.decide.DECISIONS[d.decision]) || [d.decision])[0] + ", " + d.upPct + "% up over " + d.days + " days", extra: { auto: true, exitAt: Date.now() + (Number(d.days) || 91) * 864e5, setId: key } });
  }
  // Sell auto-followed positions whose window has ended (all of the position's buys were automatic).
  async function autoExit(app, opts = {}) {
    if (app.demo) return [];
    const now = opts.now || Date.now(), L = C.paperLedger(orders(app), acct(app).startCash), sold = [];
    for (const p of L.positions) {
      const buys = orders(app).filter(o => o.assetId === p.assetId && o.side === "buy" && o.createdAt >= (p.openedAt || 0));
      if (!buys.length || !buys.every(o => o.auto && o.exitAt)) continue;
      const exitAt = Math.max(...buys.map(o => o.exitAt)); if (exitAt > now) continue;
      try { sold.push(await place(app, p.asset || { id: p.assetId, symbol: p.symbol, cls: String(p.assetId).split(":")[0] }, "sell", p.qty, { source: p.sources[0] || "pick", note: "Auto-exit: the pick's window ended", extra: { auto: true } })); } catch {}
    }
    return sold;
  }

  // Closed trades grouped by where the idea came from.
  function bySource(L) {
    const m = new Map();
    for (const t of L.closed) for (const s of (t.sources.length ? t.sources : ["manual"])) { if (!m.has(s)) m.set(s, []); m.get(s).push(t); }
    const open = new Map(); for (const p of L.positions) for (const s of (p.sources.length ? p.sources : ["manual"])) open.set(s, (open.get(s) || 0) + 1);
    return [...new Set([...m.keys(), ...open.keys()])].map(s => {
      const ts = m.get(s) || [], vs = ts.filter(t => t.mirrorPct != null);
      return { source: s, closed: ts.length, open: open.get(s) || 0, winPct: ts.length ? ts.filter(t => t.pnl > 0).length / ts.length * 100 : null, avgPct: ts.length ? ts.reduce((a, t) => a + t.pnlPct, 0) / ts.length : null,
        vsPct: vs.length ? vs.reduce((a, t) => a + (t.pnlPct - t.mirrorPct), 0) / vs.length : null, pnl: ts.reduce((a, t) => a + t.pnl, 0) };
    });
  }

  V.paper = function (root, app) {
    const a = acct(app);
    root.append(h("div", { class: "page-head" }, h("div", { class: "stack", style: "gap:4px" }, h("h1", { class: "page" }, "Paper Trading"),
      h("p", { class: "sub" }, "Virtual money for practising and for testing the desk's ideas with real sizing. Nothing is bought or sold for real.")),
      h("div", { class: "row" }, h("button", { class: "btn ghost sm", type: "button", onclick: () => restart(app) }, "Start over"))));
    const kpis = h("div", { class: "kpis k4" }), body = h("div", { class: "stack" }, h("p", { class: "small muted" }, "Valuing the paper account at live prices…"));
    const picker = X.assetPicker((asset) => ticket(app, asset, { source: "manual" }), CLASSES);
    root.append(U.section("Paper account", h("div", { class: "stack" }, kpis, h("p", { class: "tiny muted" }, "Started " + (a.startedAt ? U.fmtDate(a.startedAt) : "with the first order") + " with " + usd(a.startCash) + ". Orders fill at the live quote; estimated commission/spread from Settings (stocks " + (app.settings.assumptions.stockExitPct) + "%, crypto " + app.settings.assumptions.cryptoExitPct + "% a side). No margin and no short selling. The S&P 500 comparison puts the same dollars into SPY at the same moments."))),
      U.section("Place a paper order", h("div", { class: "stack" }, picker, h("p", { class: "tiny muted" }, "Or use “Paper trade” on any stock or crypto page, on a recommendation, or on an AI decision; the account then tracks how each source of ideas does."))), followCard(app), body);
    const paint = async () => {
      let S;
      try { S = await state(app); } catch (e) { body.replaceChildren(U.errorBox({ message: U.errorText(e) })); return; }
      const { L, v, prices, quotes, spyQ } = S, diff = v.returnPct - v.mirrorReturnPct, wins = L.closed.filter(t => t.pnl > 0).length;
      const kpi = (l, val, s, cls) => h("div", { class: "kpi" }, h("span", { class: "label" }, l), h("b", { class: "v " + (cls || "") }, val), h("span", { class: "s" }, s));
      kpis.replaceChildren(kpi("Account value", usd(v.equity), "cash " + usd(L.cash) + " · invested " + usd(v.held)),
        kpi("Return since start", U.pct(v.returnPct), usd(v.equity - S.a.startCash), U.signCls(v.returnPct)),
        kpi("Same trades in the S&P 500", U.pct(v.mirrorReturnPct), spyQ ? "SPY " + U.money(spyQ.price, "USD", { price: true }) : "SPY price unavailable", U.signCls(v.mirrorReturnPct)),
        kpi("Against the S&P 500", (diff > 0 ? "+" : "") + diff.toFixed(2) + " pts", L.closed.length ? wins + " of " + L.closed.length + " closed trades made money" : "no closed trades yet", U.signCls(diff)));
      const posRows = L.positions.map(p => { const px = prices[p.assetId], val = px ? p.qty * px : null, mirror = spyQ && p.mirrorKnown ? p.mirror * spyQ.price : null; return { p, px, val, pnl: val != null ? val - p.cost : null, pnlPct: val != null ? (val / p.cost - 1) * 100 : null, mirror, mirrorPct: mirror != null ? (mirror / p.cost - 1) * 100 : null, q: quotes[p.assetId] }; });
      const srcLbl = (ss) => (ss.length ? ss : ["manual"]).map(s => SOURCES[s] || s).join(", ");
      const curveBox = h("div", { class: "stack" });
      body.replaceChildren(
        orders(app).length ? U.section("Account value over time", curveBox) : null,
        U.section("Open positions", h("div", { class: "stack" }, U.table([
          { t: "Asset", v: (r) => h("a", { href: "#", onclick: (e) => { e.preventDefault(); app.openAsset(r.p.asset || { id: r.p.assetId, symbol: r.p.symbol }); } }, r.p.symbol) },
          { t: "Quantity", v: (r) => String(+r.p.qty.toFixed(6)), n: true }, { t: "Avg cost", v: (r) => U.money(r.p.cost / r.p.qty, "USD", { price: true }), n: true },
          { t: "Price now", v: (r) => r.px ? h("span", { title: r.q ? (r.q.source || "") + " · " + (r.q.ts ? U.fmtTs(r.q.ts) : "") : "" }, U.money(r.px, "USD", { price: true })) : h("span", { class: "warn-t" }, "unavailable"), n: true },
          { t: "Value", v: (r) => r.val != null ? usd(r.val) : "—", n: true }, { t: "Return", v: (r) => r.pnlPct != null ? h("span", { class: U.signCls(r.pnlPct) }, U.pct(r.pnlPct)) : "—", n: true },
          { t: "Same $ in SPY", v: (r) => r.mirrorPct != null ? h("span", { class: U.signCls(r.mirrorPct) }, U.pct(r.mirrorPct)) : "—", n: true },
          { t: "From", v: (r) => srcLbl(r.p.sources) },
          { t: "", v: (r) => h("button", { class: "btn ghost sm", type: "button", onclick: () => ticket(app, r.p.asset || { id: r.p.assetId, symbol: r.p.symbol, cls: String(r.p.assetId).split(":")[0] }, { side: "sell", source: r.p.sources[0] || "manual" }) }, "Sell") }], posRows, { empty: "No open paper positions. Search above, or use “Paper trade” on a stock, a recommendation or an AI decision." }),
          v.missing.length ? h("p", { class: "small warn-t" }, "No live price for " + v.missing.join(", ") + ": valued at cost until one comes back.") : null)),
        U.section("Closed trades", U.table([{ t: "Asset", v: "symbol" }, { t: "Held", v: (t) => U.fmtDate(t.openedAt) + " → " + U.fmtDate(t.closedAt) },
          { t: "Return", v: (t) => h("span", { class: U.signCls(t.pnlPct) }, U.pct(t.pnlPct)), n: true }, { t: "P&L", v: (t) => h("span", { class: U.signCls(t.pnl) }, usd(t.pnl)), n: true },
          { t: "S&P 500, same days", v: (t) => t.mirrorPct != null ? U.pct(t.mirrorPct) : "—", n: true },
          { t: "Against it", v: (t) => t.mirrorPct != null ? h("span", { class: U.signCls(t.pnlPct - t.mirrorPct) }, ((t.pnlPct - t.mirrorPct) > 0 ? "+" : "") + (t.pnlPct - t.mirrorPct).toFixed(1) + " pts") : "—", n: true },
          { t: "From", v: (t) => srcLbl(t.sources) }], L.closed.slice().reverse(), { empty: "No closed trades yet." })),
        U.section("How each source of ideas has done", h("div", { class: "stack" }, U.table([{ t: "Source", v: (r) => SOURCES[r.source] || r.source }, { t: "Open", v: "open", n: true }, { t: "Closed", v: "closed", n: true },
          { t: "Made money", v: (r) => r.winPct != null ? r.winPct.toFixed(0) + "%" : "—", n: true }, { t: "Avg return", v: (r) => r.avgPct != null ? h("span", { class: U.signCls(r.avgPct) }, U.pct(r.avgPct)) : "—", n: true },
          { t: "Avg vs S&P 500", v: (r) => r.vsPct != null ? h("span", { class: U.signCls(r.vsPct) }, (r.vsPct > 0 ? "+" : "") + r.vsPct.toFixed(1) + " pts") : "—", n: true }, { t: "P&L", v: (r) => usd(r.pnl), n: true }], bySource(L), { empty: "Closed trades are grouped here by where the idea came from." }),
          h("p", { class: "tiny muted" }, "A handful of trades says little; the comparison means more after 20 or more closed trades from one source."))),
        L.closed.length ? (() => { const out = h("div", { class: "stack" }), b = h("button", { class: "btn ghost", type: "button", onclick: async () => { b.disabled = true; out.replaceChildren(h("div", { class: "skeleton" }, "The coach is reading your closed trades…")); try { out.replaceChildren(coachView(await coach(app, S))); } catch (e) { out.replaceChildren(U.errorBox({ message: MD.ai.errText ? MD.ai.errText(e) : U.errorText(e) })); } b.disabled = false; } }, "What's working? Ask the AI coach");
          return U.section("AI coach", h("div", { class: "stack" }, h("div", { class: "row" }, b), out)); })() : null,
        h("details", {}, h("summary", { class: "label", style: "cursor:pointer" }, "Order history (" + orders(app).length + ")"),
          U.table([{ t: "Time", v: (o) => U.fmtTs(o.createdAt) }, { t: "Order", v: (o) => o.side + " " + o.qty + " " + o.symbol }, { t: "Fill", v: (o) => U.money(o.price, "USD", { price: true }), n: true }, { t: "Price from", v: (o) => (o.priceSource || "—") + (o.priceStatus && o.priceStatus !== "Live" ? " (" + o.priceStatus + ")" : "") }, { t: "From", v: (o) => (SOURCES[o.source] || o.source) + (o.note ? " · " + o.note : "") }],
            orders(app).slice().sort((x, y) => y.createdAt - x.createdAt))),
        L.issues.length ? h("p", { class: "small warn-t" }, L.issues.map(i => i.msg).join(" ")) : null);
      if (orders(app).length) drawCurve(app, S, curveBox).catch(e => curveBox.replaceChildren(h("p", { class: "small muted" }, "No chart: " + U.errorText(e))));
    };
    paint();
    const off = app.on("paper", () => { if (document.body.contains(root)) paint(); else off(); });
  };

  function followCard(app) {
    const cfg = followCfg(app), on = h("input", { type: "checkbox", checked: cfg.on }), pct = h("input", { type: "number", min: 0.5, max: 25, step: 0.5, value: cfg.pct, style: "width:80px", "aria-label": "Percent of the account per pick" }), dec = h("input", { type: "checkbox", checked: !!cfg.decisions });
    const save = () => app.saveSettings({ paperFollow: { on: on.checked, pct: Math.max(0.5, Math.min(25, Number(pct.value) || 5)), decisions: dec.checked } });
    on.onchange = save; pct.onchange = save; dec.onchange = save;
    const auto = C.paperLedger(orders(app), acct(app).startCash).positions.map(p => ({ p, buys: orders(app).filter(o => o.assetId === p.assetId && o.side === "buy" && o.createdAt >= (p.openedAt || 0)) })).filter(x => x.buys.length && x.buys.every(o => o.auto && o.exitAt));
    return U.section("Follow the AI automatically", h("div", { class: "stack" },
      h("div", { class: "row", style: "gap:10px;flex-wrap:wrap;align-items:center" }, h("label", { class: "chk" }, on, "Paper-buy every new recommendation that leans up"), h("label", { class: "row", style: "gap:6px;align-items:center" }, pct, h("span", { class: "small" }, "% of the account each"))),
      h("label", { class: "chk" }, dec, "Also paper-buy AI decisions to buy or add (sized at the decision's ceiling, sold when its horizon ends)"),
      h("p", { class: "tiny muted" }, "Each one is sold automatically when its window ends, so the account becomes a sized, forward test of the AI's picks against the S&P 500. Only automatic positions are auto-sold; anything you buy yourself stays until you sell it. Runs while the desk is open."),
      auto.length ? U.table([{ t: "Auto position", v: (x) => x.p.symbol }, { t: "Bought", v: (x) => U.fmtDate(x.buys[0].createdAt) }, { t: "Sells after", v: (x) => U.fmtDate(Math.max(...x.buys.map(o => o.exitAt))) }, { t: "Why", v: (x) => h("span", { class: "small" }, x.buys[0].note || "") }], auto) : null));
  }
  // The account and its S&P 500 mirror at each close since the first order (daily histories, cached six hours).
  async function drawCurve(app, S, box) {
    const os = orders(app), start = Math.floor(Math.min(...os.map(o => o.createdAt || Date.now())) / 864e5);
    const ids = [...new Map(os.map(o => [o.assetId, o.asset || { id: o.assetId, symbol: o.symbol, cls: String(o.assetId).split(":")[0] }])).values()];
    const [spyH, ...hs] = await Promise.all([D.historyCached(SPY, "1Y"), ...ids.map(a => D.historyCached(a, "1Y").catch(() => null))]);
    const dayMap = (h) => new Map((h ? h.points : []).map(p => [Math.floor(p.time / 86400), p.close ?? p.value]));
    const closes = {}; ids.forEach((a, i) => { closes[a.id] = dayMap(hs[i]); });
    const spy = dayMap(spyH), today = Math.floor(Date.now() / 864e5), days = [...new Set([...spy.keys()].filter(d => d >= start).concat([today]))].sort((a, b) => a - b);
    // Today's point uses the live prices the page already has.
    if (S.spyQ) spy.set(today, S.spyQ.price); for (const id in S.prices) { if (closes[id]) closes[id].set(today, S.prices[id]); }
    const cv = C.paperCurve(os, S.a.startCash, closes, spy, days);
    if (cv.length < 2) { box.replaceChildren(h("p", { class: "small muted" }, "The chart starts after the account's first full day.")); return; }
    const s0 = S.a.startCash, pts = cv.map(p => ({ a: (p.equity / s0 - 1) * 100, b: (p.mirror / s0 - 1) * 100 })), lo = Math.min(0, ...pts.map(p => Math.min(p.a, p.b))), hi = Math.max(0, ...pts.map(p => Math.max(p.a, p.b))), W = 600, H = 140;
    const x = (i) => i / (pts.length - 1) * W, y = (v) => H - (v - lo) / ((hi - lo) || 1) * H, line = (k) => pts.map((p, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p[k]).toFixed(1)).join(" "), last = pts[pts.length - 1];
    box.replaceChildren(h("div", { html: '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" height="140" preserveAspectRatio="none" role="img" aria-label="Paper account value against the same trades in the S&P 500"><line x1="0" x2="' + W + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '" stroke="var(--line)" stroke-dasharray="4 4"/><path d="' + line("b") + '" fill="none" stroke="var(--muted)" stroke-width="2"/><path d="' + line("a") + '" fill="none" stroke="var(--accent)" stroke-width="2.5"/></svg>' }),
      h("p", { class: "small" }, h("strong", { style: "color:var(--accent)" }, "Account " + U.pct(last.a)), " · ", h("span", { class: "muted" }, "same trades in the S&P 500 " + U.pct(last.b)), " · " + cv.length + " days from " + new Date(cv[0].day * 864e5).toISOString().slice(0, 10)),
      h("p", { class: "tiny muted" }, "Rebuilt from your orders and each asset's daily closes (the last point uses live prices). Costs are included as charged on each order."));
  }
  async function restart(app) {
    const box = h("div", { class: "stack" }), cash = h("input", { type: "number", min: 1000, step: 1000, value: acct(app).startCash, "aria-label": "Starting cash" });
    box.append(h("p", {}, "Start a new paper account? Open positions and the record so far are set aside (the orders stay in the history)."), U.field("Starting cash (USD)", cash));
    const m = U.modal("Start over", h("div", { class: "stack" }, box, h("div", { class: "row end" }, h("button", { class: "btn ghost", type: "button", onclick: () => m.close() }, "Cancel"),
      h("button", { class: "btn danger", type: "button", onclick: () => { app.saveSettings({ paper: { startCash: Math.max(1000, Number(cash.value) || START), startedAt: Date.now() } }); m.close(); app.go("paper"); } }, "Start over"))));
  }

  /* AI coach: Claude reads the closed paper trades (returns, the S&P 500 over the same days, holding time, source of
     the idea) and says what's working, what isn't and which habits show, from those measured numbers only. */
  async function coach(app, S0) {
    if (!app.caps.sample) throw Object.assign(new Error("Claude isn't available in this view."), { code: "no_sample" });
    const st = S0 || await state(app), L = st.L, lbl = (ss) => (ss.length ? ss : ["manual"]).map(x => SOURCES[x] || x).join(", ");
    if (!L.closed.length) throw new Error("Close at least one paper trade first: the coach reads finished trades.");
    const facts = { closedTrades: L.closed.slice(-40).map(t => ({ symbol: t.symbol, from: lbl(t.sources), returnPct: +t.pnlPct.toFixed(2), sp500SameDaysPct: t.mirrorPct != null ? +t.mirrorPct.toFixed(2) : null, heldDays: Math.max(0, Math.round((t.closedAt - t.openedAt) / 864e5)) })),
      bySource: bySource(L).map(r => ({ source: SOURCES[r.source] || r.source, closed: r.closed, madeMoneyPct: r.winPct != null ? Math.round(r.winPct) : null, avgReturnPct: r.avgPct != null ? +r.avgPct.toFixed(2) : null, avgVsSP500Pts: r.vsPct != null ? +r.vsPct.toFixed(2) : null })),
      account: { returnPct: +st.v.returnPct.toFixed(2), sameTradesInSP500Pct: +st.v.mirrorReturnPct.toFixed(2), openPositions: L.positions.length } };
    const r = await app.caps.sample.json(`You are the paper-trading coach. Using ONLY these measured results from the investor's virtual account (never invent a number), say what is working, what isn't, and which habits show (for example selling winners early, holding losers, sizing, which source of ideas beats the S&P 500). With fewer than 20 closed trades, say plainly that the sample is small and conclusions are tentative. Be specific and kind. Not advice to trade real money.
${MD.ai.contextNote(app)}
Results: ${JSON.stringify(facts)}
Reply with ONLY JSON: {"headline": "one sentence", "working": ["..."], "notWorking": ["..."], "habits": ["..."], "nextSteps": ["concrete things to try in the paper account"], "sampleNote": "one sentence on how much these results can be trusted"}`, { modelTier: "default", cache: false });
    const arr = (x) => (Array.isArray(x) ? x : []).slice(0, 4).map(v => String(v).slice(0, 300));
    return { at: Date.now(), closed: L.closed.length, headline: String(r.headline || "").slice(0, 300), working: arr(r.working), notWorking: arr(r.notWorking), habits: arr(r.habits), nextSteps: arr(r.nextSteps), sampleNote: String(r.sampleNote || "").slice(0, 300) };
  }
  function coachView(c) {
    const list = (t, xs, cls) => xs.length ? h("div", { class: "stack", style: "gap:2px" }, h("span", { class: "label" + (cls ? " " + cls : "") }, t), h("ul", { class: "small", style: "margin:0;padding-left:1.1em;display:grid;gap:2px" }, xs.map(x => h("li", {}, x)))) : null;
    return h("div", { class: "stack aicoach" }, h("p", {}, h("strong", {}, c.headline)), h("div", { class: "grid g2", style: "align-items:start" }, list("Working", c.working, "up"), list("Not working", c.notWorking, "down")), list("Habits", c.habits), list("Try next", c.nextSteps),
      c.sampleNote ? h("p", { class: "small muted" }, c.sampleNote) : null, h("p", { class: "tiny muted" }, "Claude's reading of " + c.closed + " closed paper trades, from the measured results above only. " + U.fmtTs(c.at) + "."));
  }
  function dashCard(box, app) {
    if (!orders(app).length) { box.append(h("div", { class: "stack", style: "gap:6px" }, h("p", { class: "small" }, "Practise with virtual money and see how each source of ideas does against the S&P 500."), h("div", { class: "row" }, h("button", { class: "btn ghost sm", type: "button", onclick: () => app.go("paper") }, "Open paper trading")))); return; }
    const out = h("div", { class: "stack", style: "gap:6px" }, h("p", { class: "small muted" }, "Valuing at live prices…")); box.append(out);
    state(app).then(({ L, v }) => {
      const wins = L.closed.filter(t => t.pnl > 0).length, diff = v.returnPct - v.mirrorReturnPct;
      out.replaceChildren(h("div", { class: "row", style: "gap:14px;flex-wrap:wrap" }, h("span", {}, h("span", { class: "label" }, "Value "), h("b", { class: "num" }, usd(v.equity))), h("span", {}, h("span", { class: "label" }, "Return "), h("b", { class: "num " + U.signCls(v.returnPct) }, U.pct(v.returnPct))), h("span", {}, h("span", { class: "label" }, "vs S&P 500 "), h("b", { class: "num " + U.signCls(diff) }, (diff > 0 ? "+" : "") + diff.toFixed(2) + " pts"))),
        h("p", { class: "small" }, L.positions.length + " open · " + (L.closed.length ? wins + " of " + L.closed.length + " closed trades made money" : "no closed trades yet") + (followCfg(app).on ? " · following the AI's picks" : "")),
        h("div", { class: "row" }, h("button", { class: "btn ghost sm", type: "button", onclick: () => app.go("paper") }, "Open paper trading")));
    }).catch(e => out.replaceChildren(h("p", { class: "small warn-t" }, U.errorText(e))));
  }
  MD.paper = { followDecision, coach, dashCard, ticket, place, state, button, bySource, followSet, autoExit, followCfg, SOURCES };
})(typeof window !== "undefined" ? window : globalThis);
