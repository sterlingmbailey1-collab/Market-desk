/* Market Desk app shell: boot, settings, storage, rates service, routing, command bar, alert monitor. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const C = MD.core, U = MD.ui, D = MD.data, h = U.h;

  const ROUTES = [
    ["dashboard", "Dashboard", "Overview"], ["markets", "Global Markets", "Overview"],
    ["stocks", "Stocks & ETFs", "Markets"], ["crypto", "Crypto", "Markets"], ["fx", "FX & Currencies", "Markets"], ["metals", "Precious Metals", "Markets"], ["cards", "Trading Cards", "Markets"],
    ["betting", "Sports Betting", "Sports"],
    ["portfolio", "Portfolio", "Decide"], ["picks", "Recommendations", "Decide"], ["opportunities", "Opportunities", "Decide"], ["research", "Deep Research", "Decide"], ["calendar", "Calendar & Catalysts", "Decide"], ["advisor", "AI Advisor", "Decide"], ["strategies", "Strategies & Backtesting", "Decide"],
    ["reports", "Reports", "Workflow"], ["inbox", "Alerts & Research Inbox", "Workflow"], ["settings", "Settings & Data Sources", "Workflow"]
  ];
  const DEFAULT_SETTINGS = {
    displayCurrency: "USD", reportingCurrency: "USD", liveRate: 1000, tape: true, theme: "system", mode: "intermediate", fontScale: 1, reduceMotion: false,
    quiet: { enabled: false, start: "22:00", end: "07:00" }, notify: { toasts: true, minMateriality: 1 },
    assumptions: { stockExitPct: 0.05, cryptoExitPct: 0.5, metalSpreadPct: 3, cardFeePct: 13, cardShipping: 5, fxSpreadMajorPct: 0.1, fxSpreadOtherPct: 1, riskFreePct: 4, inflationPct: 2.5 },
    betting: { oddsFormat: "american", bankroll: 1000, unit: 10, kelly: 0.25, minEdge: 1 },
    customCurrencies: [], dashboard: ["changes", "portfolio", "fx", "watch", "alerts", "catalysts", "data"], universe: ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSM", "ASML", "NVO", "TM"]
  };
  const ls = { get(k, d) { try { const v = localStorage.getItem("mdp." + k); return v ? JSON.parse(v) : d; } catch { return d; } }, set(k, v) { try { localStorage.setItem("mdp." + k, JSON.stringify(v)); } catch {} } };

  const app = MD.app = {
    ROUTES, ls, caps: {}, store: null, liveStore: null, demo: false, settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), reg: C.makeRegistry(), uid: null,
    route: "dashboard", ctx: ls.get("ctx", {}), listeners: new Map(), quotes: new Map(),
    on(ev, f) { if (!this.listeners.has(ev)) this.listeners.set(ev, new Set()); this.listeners.get(ev).add(f); return () => this.listeners.get(ev).delete(f); },
    emit(ev, d) { for (const f of this.listeners.get(ev) || []) try { f(d); } catch (e) { console.error(e); } }
  };

  /* ---------- settings ---------- */
  async function loadSettings() {
    let s = null;
    try { s = await app.store.get("settings", "main"); } catch {}
    app.settings = Object.assign(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), s || {});
    for (const k of ["quiet", "notify", "assumptions", "betting"]) app.settings[k] = Object.assign({}, DEFAULT_SETTINGS[k], (s || {})[k] || {});
    applySettings();
  }
  let saveTimer = null;
  app.saveSettings = function (patch) {
    Object.assign(app.settings, patch || {});
    applySettings(); app.emit("settings", app.settings);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => app.store.put("settings", "main", app.settings).catch(e => U.toast("Settings not saved", U.errorText(e), true)), 600);
  };
  function applySettings() {
    const s = app.settings, root = document.documentElement;
    if (s.theme === "light" || s.theme === "dark") root.setAttribute("data-theme", s.theme); else if (app._hostTheme !== undefined) { if (app._hostTheme) root.setAttribute("data-theme", app._hostTheme); else root.removeAttribute("data-theme"); }
    root.style.setProperty("--fs", (14 * (Number(s.fontScale) || 1)) + "px");
    document.body.classList.toggle("reduce-motion", !!s.reduceMotion);
    document.body.classList.remove("mode-beginner", "mode-intermediate", "mode-advanced"); document.body.classList.add("mode-" + (s.mode || "intermediate"));
    app.reg = C.makeRegistry(s.customCurrencies);
  }

  /* ---------- rates service ---------- */
  const rates = app.rates = {
    table: null, fetchedAt: 0, metals: {}, hist: new Map(), loading: null,
    async refresh(force) {
      if (!D.available()) return null;
      if (!force && this.table && Date.now() - this.fetchedAt < 60000) return this.table;
      if (this.loading) return this.loading;
      this.loading = (async () => {
        const [t] = await Promise.all([D.fx.usdTable(), ...D.METALS.map(([m]) => D.metals.spot(m).then(q => { this.metals[m] = q; }).catch(() => {}))]);
        for (const [m] of D.METALS) if (this.metals[m]) t.rates[m] = String(1 / this.metals[m].price);
        this.table = t; this.fetchedAt = Date.now(); app.emit("rates", t); return t;
      })().finally(() => { this.loading = null; });
      return this.loading;
    },
    quote(from, to) { if (from === to) return C.quote(from, to, 1, { type: "identity", source: "identity" }); return this.table ? C.rateFromTable(this.table, from, to) : null; },
    // Historical reference rate on a date. Only ECB currencies have history; returns {rate, date, source} or null.
    async at(date, from, to) {
      if (from === to) return { rate: C.ONE, date, source: "identity" };
      if (!C.ECB_CODES.has(from) || !C.ECB_CODES.has(to)) return null;
      const key = date + "|" + from + "|" + to;
      if (this.hist.has(key)) return this.hist.get(key);
      const cached = app.store && app.store.cached("fxcache").find(d => d.id === key.replace(/\|/g, "_"));
      if (cached) { const v = { rate: C.dec(cached.rate), date: cached.date, source: cached.source }; this.hist.set(key, v); return v; }
      try {
        const r = await D.fx.ecbOn(date, from, [to]);
        const rate = r.rates[to]; if (!rate) return null;
        const v = { rate: C.dec(rate), date: r.date, source: "ECB reference rate" + (r.date !== date ? " (" + r.date + ", nearest prior fixing)" : "") };
        this.hist.set(key, v);
        if (app.store && !app.demo) app.store.put("fxcache", key.replace(/\|/g, "_"), { rate: String(rate), date: r.date, source: v.source }).catch(() => {});
        return v;
      } catch { return null; }
    }
  };

  /* ---------- quotes with short cache ---------- */
  app.quote = async function (asset, maxAgeMs = 45000) {
    const key = asset.id + "|" + (asset.variant || "") + "|" + (asset.priceSource || "");
    const hit = app.quotes.get(key);
    if (hit && Date.now() - hit.at < maxAgeMs) return hit.q;
    let q;
    if ((asset.cls || D.clsOf(asset.id)) === "fx") {
      await rates.refresh(); const r = rates.quote(asset.base, asset.quote);
      if (!r) throw new D.DataError("not_found", "No rate for " + asset.base + "/" + asset.quote + ".");
      q = { id: asset.id, cls: "fx", symbol: asset.base + "/" + asset.quote, name: asset.base + "/" + asset.quote, price: Number(r.rate), currency: asset.quote, ts: r.ts, status: "Live", source: r.source, kind: "fx", rateQuote: r };
    } else q = await D.quoteFor(asset);
    q.kind = q.kind || ({ stock: "stock", etf: "stock", crypto: "crypto", metal: "metal", pokemon: "card", yugioh: "card", sports: "card", cash: "fx" }[q.cls] || "stock");
    const prev = hit && hit.q.price; const anomaly = prev ? C.anomalyCheck(prev, q.price, q.cls) : null; if (anomaly) q.warning = anomaly;
    app.quotes.set(key, { at: Date.now(), q });
    return q;
  };

  /* ---------- portfolio valuation (shared by Dashboard, Portfolio, Reports, Advisor) ---------- */
  function exitAssumption(cls, currency, R) {
    const a = app.settings.assumptions, major = ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD"].includes(currency) && ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD"].includes(R);
    const fxSpreadPct = currency === R ? 0 : major ? a.fxSpreadMajorPct : a.fxSpreadOtherPct;
    if (cls === "stock" || cls === "etf") return { exitCostPct: a.stockExitPct, fxSpreadPct, fixedCost: 0, label: "Commission/spread " + a.stockExitPct + "%" };
    if (cls === "crypto") return { exitCostPct: a.cryptoExitPct, fxSpreadPct, fixedCost: 0, label: "Exchange fee " + a.cryptoExitPct + "%" };
    if (cls === "metal") return { exitCostPct: a.metalSpreadPct, fxSpreadPct, fixedCost: 0, label: "Dealer buy-back spread " + a.metalSpreadPct + "%" };
    if (cls === "pokemon" || cls === "yugioh" || cls === "sports") return { exitCostPct: a.cardFeePct, fxSpreadPct, fixedCost: a.cardShipping, label: "Marketplace fees " + a.cardFeePct + "% + shipping" };
    return { exitCostPct: 0, fxSpreadPct, fixedCost: 0, label: "Conversion only" };
  }
  app.exitAssumption = exitAssumption;
  app.valuePortfolio = async function (R) {
    R = R || app.settings.reportingCurrency;
    const txs = app.store.cached("tx");
    const { positions, issues } = C.buildPositions(txs);
    await rates.refresh().catch(() => null);
    const comps = app.store.cached("comps");
    const rows = [];
    // Historical rates for every lot date (native -> R).
    const need = new Set();
    for (const p of positions.values()) for (const l of p.lots) need.add(l.date + "|" + p.currency);
    for (const p of positions.values()) for (const r of p.realized) { need.add(r.date + "|" + p.currency); for (const c of r.consumed) need.add(c.date + "|" + p.currency); }
    const histMap = new Map();
    await Promise.all([...need].map(async (k) => { const [date, cur] = k.split("|"); histMap.set(k, await ratesOnDate(date, cur, R)); }));
    /* Rate N->R for a lot or sale on a date:
       1. same currency: 1
       2. the transaction recorded its own N->USD rate: use it, bridged to R with the ECB USD->R rate for that date
       3. otherwise the ECB N->R reference rate for that date
       4. otherwise unknown (cost basis shown as estimated at today's rate) */
    const rateFor = (cur, date, lot) => {
      if (cur === R) return C.ONE;
      const hr = histMap.get(date + "|" + cur) || {};
      if (lot && lot.fxToUSD) return R === "USD" ? lot.fxToUSD : (hr.usdR ? lot.fxToUSD.times(hr.usdR) : null);
      return hr.direct || null;
    };
    for (const p of positions.values()) {
      if (p.qty.lte(0) && !p.realized.length && !p.income.length) continue;
      const asset = Object.assign({ id: p.assetId, cls: p.assetClass, symbol: p.symbol, name: p.name }, p.meta || {});
      let q = null, err = null;
      if (p.qty.gt(0)) {
        if (p.assetClass === "sports" || p.assetClass === "manual") {
          // CardChain-linked cards use CardChain's market price; otherwise (or if it fails) the latest recorded comp.
          if (asset.cardchainId) { try { q = await app.quote(asset); } catch (e) { err = U.errorText(e); } }
          const cs = q ? [] : comps.filter(c => c.assetId === p.assetId).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
          if (cs.length) { q = { price: Number(cs[0].price), currency: cs[0].currency, ts: Date.parse(cs[0].date), status: "Estimated", source: "Your latest recorded comp (" + cs[0].date + ")" }; err = null; }
          else if (!q) err = err || "No valuation recorded";
        } else { try { q = await app.quote(asset); } catch (e) { err = U.errorText(e); } }
      }
      const priceN = q && q.currency === p.currency ? q.price : (q && rates.quote(q.currency, p.currency) ? C.convert(q.price, rates.quote(q.currency, p.currency)) : null);
      const rq = rates.quote(p.currency, R);
      const v = C.valuePosition(p, priceN, rq ? rq.rate : null, (date, lot) => rateFor(p.currency, date, lot));
      const realized = C.realizedInReporting(p, (date) => rateFor(p.currency, date, null));
      const income = p.income.reduce((a, i) => a.plus(i.amount), C.ZERO);
      const nl = v.valueR ? C.netLiquidation(v.valueR, exitAssumption(p.assetClass, p.currency, R)) : null;
      rows.push({ p, asset, q, err, v, realized, incomeN: income, nl, exit: exitAssumption(p.assetClass, p.currency, R), rateQuote: rq,
        country: p.meta && p.meta.country || (p.assetClass === "stock" || p.assetClass === "etf" ? (p.meta && p.meta.listing === "US depositary receipt (ADR)" ? "Non-US (via ADR)" : "US listing") : "—"),
        liquidity: { stock: "High", etf: "High", crypto: "High", cash: "High", metal: "Medium", pokemon: "Low", yugioh: "Low", sports: "Low", manual: "Low" }[p.assetClass] || "Unknown" });
    }
    const sum = (f) => rows.reduce((a, r) => { const x = f(r); return x ? a.plus(x) : a; }, C.ZERO);
    const totals = { valueR: sum(r => r.v.valueR), costR: sum(r => r.p.qty.gt(0) ? r.v.costR : null), pnlR: sum(r => r.p.qty.gt(0) ? r.v.pnlR : null), priceEffectR: sum(r => r.p.qty.gt(0) ? r.v.priceEffectR : null), fxEffectR: sum(r => r.p.qty.gt(0) ? r.v.fxEffectR : null), realizedR: sum(r => r.realized.pnl), netLiq: sum(r => r.nl && r.nl.net), exitCosts: sum(r => r.nl && r.nl.costs) };
    const missing = rows.filter(r => r.p.qty.gt(0) && !r.v.valueR);
    return { R, rows, totals, issues, missing, estimatedBasis: rows.some(r => r.v.costBasisStatus === "estimated" && r.p.qty.gt(0)), ratesAt: rates.fetchedAt, ratesSource: rates.table && rates.table.source };
  };
  async function ratesOnDate(date, cur, R) {
    if (cur === R) return { direct: C.ONE, usdR: R === "USD" ? C.ONE : null };
    const [direct, usdR] = await Promise.all([rates.at(date, cur, R), R === "USD" ? Promise.resolve({ rate: C.ONE }) : rates.at(date, "USD", R)]);
    return { direct: direct ? direct.rate : null, usdR: usdR ? usdR.rate : null };
  }

  /* ---------- navigation ---------- */
  /* List → detail → back. Tabs open their list; opening an item remembers where you came from. */
  const LIST_ROUTES = ["stocks", "crypto", "fx", "metals", "cards", "markets", "betting"];
  const routeLabel = (r) => (ROUTES.find(x => x[0] === r) || [r, r])[1];
  app.backStack = [];
  function placeLabel(route) {
    const c = app.ctx[route];
    if (route === "betting") return c && c.gameId ? c.label || "game" : "Sports Betting";
    if (LIST_ROUTES.includes(route)) {
      if (route === "fx" && c && c.base && c.cls === "fx") return c.base + "/" + c.quote;
      if (route === "markets" && c && c.cls === "event") return c.name || "event";
      if (c && c.cls && route !== "fx" && route !== "markets") return c.symbol && c.symbol !== c.name ? c.symbol : (c.name || routeLabel(route));
      return routeLabel(route) + " list";
    }
    return routeLabel(route);
  }
  app.backLabel = () => app.backStack.length ? app.backStack[app.backStack.length - 1].label : routeLabel(app.route) + " list";
  app.back = function () {
    const e = app.backStack.pop();
    if (!e) { app.ctx[app.route] = null; ls.set("ctx", app.ctx); renderView(); return; }
    app.ctx[e.route] = e.ctx; if (e.cardsTab) app.ctx.cardsTab = e.cardsTab; if (e.marketsTab) app.ctx.marketsTab = e.marketsTab;
    ls.set("ctx", app.ctx);
    app.route = e.route; ls.set("route", e.route); history.replaceState(null, "", "#" + e.route);
    renderNav(); renderView();
    const y = e.scroll || 0; [60, 400, 1200].forEach(ms => setTimeout(() => { if (app.route === e.route) window.scrollTo(0, y); }, ms));
  };
  app.backBar = function () {
    return h("div", { class: "backbar" }, h("button", { class: "btn ghost sm", type: "button", onclick: () => app.back() }, "← Back to " + app.backLabel()));
  };
  app.go = function (route, ctx, opts) {
    opts = opts || {};
    if (opts.fromNav) { app.backStack = []; if (LIST_ROUTES.includes(route)) { app.ctx[route] = null; if (route === "markets") app.ctx.marketsTab = app.ctx.marketsTab === "events" ? "events" : "overview"; } }
    if (ctx) app.ctx[route] = ctx;
    ls.set("ctx", app.ctx);
    if (location.hash.slice(1) !== route) { history.replaceState(null, "", "#" + route); }
    app.route = route; ls.set("route", route);
    document.body.classList.remove("nav-open");
    renderNav(); renderView();
  };
  // Recently opened assets (this browser only), for the dashboard and the command bar.
  app.recent = () => ls.get("recentAssets", []);
  function remember(a) {
    if (!a || !a.id || !a.cls || a.cls === "cash") return;
    const keep = {}; for (const k of ["id", "cls", "symbol", "name", "cgId", "tcgdexId", "ygoId", "base", "quote", "slug", "cardchainId", "ccQuery", "grade", "player", "currency"]) if (a[k] != null) keep[k] = a[k];
    ls.set("recentAssets", [Object.assign(keep, { at: Date.now() })].concat(app.recent().filter(x => x.id !== a.id)).slice(0, 12));
  }
  app.openAsset = function (a, opts) {
    remember(a);
    if (!(opts && opts.noBack)) {
      app.backStack.push({ route: app.route, ctx: app.ctx[app.route] ? JSON.parse(JSON.stringify(app.ctx[app.route])) : null, cardsTab: app.ctx.cardsTab, marketsTab: app.ctx.marketsTab, scroll: window.scrollY, label: placeLabel(app.route) });
      if (app.backStack.length > 30) app.backStack.shift();
    }
    const cls = a.cls || D.clsOf(a.id);
    const route = { stock: "stocks", etf: "stocks", crypto: "crypto", fx: "fx", metal: "metals", pokemon: "cards", yugioh: "cards", sports: "cards", manual: "cards", event: "markets" }[cls] || "stocks";
    if (route === "cards") app.ctx.cardsTab = cls === "pokemon" ? "pokemon" : cls === "yugioh" ? "yugioh" : "sports";
    if (route === "markets") app.ctx.marketsTab = "events";
    app.go(route, a);
  };
  // A game on the Sports Betting tab: same list → detail → back behaviour as assets.
  app.openGame = function (g) {
    app.backStack.push({ route: app.route, ctx: app.ctx[app.route] ? JSON.parse(JSON.stringify(app.ctx[app.route])) : null, scroll: window.scrollY, label: placeLabel(app.route) });
    if (app.backStack.length > 30) app.backStack.shift();
    app.go("betting", { gameId: g.id, sport: g.sport, label: g.soccer ? g.home.name + " vs " + g.away.name : g.away.name + " at " + g.home.name });
  };
  window.addEventListener("hashchange", () => { const r = location.hash.slice(1); if (ROUTES.some(x => x[0] === r) && r !== app.route) app.go(r, null, { fromNav: true }); });
  /* Live tickers belong to the page that started them. */
  const liveSet = new Set();
  app.trackLive = (t) => { liveSet.add(t); return t; };
  app.stopLive = () => { for (const t of liveSet) try { t.stop(); } catch {} liveSet.clear(); };

  /* Section icons: 24px line drawings, stroke = currentColor. */
  const ICONS = {
    dashboard: "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z",
    markets: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zM2 12h20M12 2c2.8 2.8 4.2 6.1 4.2 10S14.8 19.2 12 22M12 2C9.2 4.8 7.8 8.1 7.8 12s1.4 7.2 4.2 10",
    stocks: "M3 17l6-6 4 4 8-8M15 7h6v6",
    crypto: "M12 2l8.7 5v10L12 22l-8.7-5V7zM9.5 8h3.5a2 2 0 0 1 0 4H9.5zM9.5 12H14a2 2 0 0 1 0 4H9.5zM9.5 8v8M11 6.5V8M11 16v1.5",
    fx: "M4 8h14l-4-4M20 16H6l4 4",
    metals: "M3 19h18l-2.5-6h-13zM7.5 13l1.8-5h5.4l1.8 5",
    cards: "M8 3h9a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM3 7v12a3 3 0 0 0 3 3h9M10 8h5M10 12h5",
    betting: "M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4zM14 7v2M14 11v2M14 15v2M7 11h4M7 14h3",
    portfolio: "M21 12A9 9 0 1 1 12 3v9zM15 3.5A9 9 0 0 1 20.5 9H15z",
    picks: "M12 3l1.9 4.8L18.7 9.7l-4.8 1.9L12 16.4l-1.9-4.8L5.3 9.7l4.8-1.9zM19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z",
    opportunities: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1.1 1.3 1.1 2.2h5c0-.9.5-1.7 1.1-2.2A6 6 0 0 0 12 3z",
    research: "M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM21 21l-4.4-4.4M8 11h6M11 8v6",
    calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h3",
    advisor: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12zM8.5 12h.01M12 12h.01M15.5 12h.01",
    strategies: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5",
    reports: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5",
    inbox: "M6 9a6 6 0 0 1 12 0c0 6.5 3 8 3 8H3s3-1.5 3-8M10 20a2 2 0 0 0 4 0",
    settings: "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4"
  };
  app.ICONS = ICONS;
  const icon = (d) => h("span", { class: "ico", "aria-hidden": "true", html: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="' + d + '"/></svg>' });
  const LOGO = '<svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--accent)"/><stop offset="1" style="stop-color:var(--accent-2)"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#lg)"/><path d="M9 9v14M16 6v20M23 11v10" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity="0.7"/><rect x="7" y="12" width="4" height="7" rx="1.2" fill="#fff"/><rect x="14" y="9" width="4" height="10" rx="1.2" fill="#fff"/><rect x="21" y="14" width="4" height="5" rx="1.2" fill="#fff"/></svg>';
  function renderNav() {
    const side = U.$("#side"); side.replaceChildren();
    side.append(h("div", { class: "brand" }, h("span", { class: "logo", html: LOGO }), h("span", {}, "Market ", h("span", { class: "brand-2" }, "Desk"))));
    const nav = h("nav", { class: "nav", "aria-label": "Main" });
    let grp = "";
    const unread = app.store ? app.store.cached("inbox").filter(i => !i.read).length : 0;
    for (const [id, label, g] of ROUTES) {
      if (g !== grp) { nav.append(h("div", { class: "grp" }, g)); grp = g; }
      nav.append(h("a", { href: "#" + id, "aria-current": app.route === id ? "page" : null, onclick: (e) => { e.preventDefault(); app.go(id, null, { fromNav: true }); } }, h("span", { class: "nav-l" }, icon(ICONS[id] || ICONS.dashboard), label), id === "inbox" && unread ? h("span", { class: "count", "aria-label": unread + " unread" }, String(unread)) : null));
    }
    side.append(nav, h("div", { class: "tiny muted", style: "padding:0 8px" }, "Press ", h("kbd", {}, "⌘K"), " or ", h("kbd", {}, "/"), " to search. ", h("kbd", {}, "?"), " for shortcuts."));
  }
  function renderTop() {
    const top = U.$("#topbar"); top.replaceChildren();
    const disp = h("select", { id: "dispCcy", "aria-label": "Display currency", style: "width:auto" }, [...app.reg.values()].filter(c => c.type === "fiat" || c.type === "metal").map(c => h("option", { value: c.code, selected: c.code === app.settings.displayCurrency }, c.code)));
    disp.onchange = () => app.saveSettings({ displayCurrency: disp.value });
    const storeLabel = app.demo ? h("span", { class: "pill demo", title: "Demo data is fictional and kept in memory only." }, "Demo data") : h("span", { class: "pill", title: app.store.kind === "account" ? "Saved privately to your claude.ai account" : "Saved in this browser only" }, app.store.kind === "account" ? "Saved to account" : "This browser only");
    const live = D.available() ? h("span", { class: "pill ok", id: "livePill" }, h("span", { class: "dot" }), "Live data") : h("span", { class: "pill bad", title: "Exa connector unavailable" }, h("span", { class: "dot" }), "No live data");
    top.append(
      h("button", { class: "btn ghost sm menu-btn", type: "button", "aria-label": "Open sections", onclick: () => { document.body.classList.toggle("nav-open"); } }, "Menu"),
      h("button", { class: "cmd-btn", type: "button", onclick: () => openCommand() }, "Search assets, currencies, cards, pages… or ask", h("kbd", {}, "⌘K")),
      h("div", { class: "top-right" }, h("label", { class: "row", style: "gap:6px" }, h("span", { class: "label" }, "Display"), disp), storeLabel, live));
  }
  /* ---------- ticker tape ---------- */
  const TAPE = [
    { id: "etf:SPY", cls: "etf", symbol: "SPY", name: "SPDR S&P 500" }, { id: "etf:QQQ", cls: "etf", symbol: "QQQ", name: "Invesco QQQ" }, { id: "etf:DIA", cls: "etf", symbol: "DIA", name: "SPDR Dow Jones" },
    { id: "crypto:bitcoin", cls: "crypto", cgId: "bitcoin", symbol: "BTC", name: "Bitcoin" }, { id: "crypto:ethereum", cls: "crypto", cgId: "ethereum", symbol: "ETH", name: "Ethereum" }, { id: "crypto:solana", cls: "crypto", cgId: "solana", symbol: "SOL", name: "Solana" },
    { id: "metal:XAU", cls: "metal", symbol: "XAU", name: "Gold", label: "Gold" }, { id: "metal:XAG", cls: "metal", symbol: "XAG", name: "Silver", label: "Silver" },
    { fx: ["EUR", "USD"] }, { fx: ["USD", "JPY"] }, { fx: ["GBP", "USD"] }
  ];
  let tapeTimer = 0;
  function renderTape() {
    const el = U.$("#tape"); if (!el) return;
    clearInterval(tapeTimer);
    if (!D.available() || app.settings.tape === false) { el.hidden = true; el.replaceChildren(); return; }
    const load = async () => {
      if (document.hidden) return;
      const [cm] = await Promise.all([D.crypto.markets(TAPE.filter(a => a.cls === "crypto").map(a => a.cgId), "usd").catch(() => []), rates.refresh().catch(() => null)]);
      const items = (await Promise.all(TAPE.map(async (a) => {
        try {
          if (a.fx) { const q = rates.quote(a.fx[0], a.fx[1]); return q ? { a: { id: "fx:" + a.fx.join(""), cls: "fx", base: a.fx[0], quote: a.fx[1], symbol: a.fx.join("/") }, label: a.fx.join("/"), price: Number(q.rate), pct: null } : null; }
          if (a.cls === "crypto") { const c = cm.find(x => x.cgId === a.cgId); return c ? { a, label: a.symbol, price: c.price, pct: c.changePct } : null; }
          const q = await app.quote(a, 60000); return { a, label: a.label || a.symbol, price: q.price, pct: q.changePct };
        } catch { return null; }
      }))).filter(x => x && x.price > 0);
      if (!items.length) { el.hidden = true; return; }
      const set = (dup) => h("div", { class: "tape-set", "aria-hidden": dup ? "true" : null }, items.map(x => h("button", { class: "tk", type: "button", tabindex: dup ? "-1" : null, onclick: () => app.openAsset(x.a) }, h("b", {}, x.label), h("span", { class: "num" }, C.fmtNum(x.price, x.a.cls === "fx" ? (x.price >= 20 ? 2 : 4) : 2)), x.pct != null ? h("span", { class: "num " + U.signCls(x.pct) }, (x.pct > 0 ? "▲ " : x.pct < 0 ? "▼ " : "") + Math.abs(x.pct).toFixed(2) + "%") : null)));
      el.hidden = false;
      el.replaceChildren(h("div", { class: "tape-track" }, set(false), set(true)));
    };
    tapeTimer = setInterval(load, 90000);
    load().catch(() => {});
  }
  app.renderTape = renderTape;

  let viewCleanup = null;
  function renderView() {
    const root = U.$("#content");
    if (viewCleanup) { try { viewCleanup(); } catch {} viewCleanup = null; }
    app.stopLive();
    root.replaceChildren();
    U.disposeCharts();
    const v = MD.views && MD.views[app.route];
    if (app.demo) root.append(h("div", { class: "banner warn" }, h("p", {}, "Demo mode: the portfolio, alerts and tasks shown are fictional and kept in memory. Nothing is saved, and research is not recorded to your journal. Prices are still live."), h("button", { class: "btn ghost sm", type: "button", onclick: () => setDemo(false) }, "Exit demo")));
    if (app.store.kind === "browser" && !app.demo) root.append(h("div", { class: "banner info" }, h("p", {}, "You're not signed in to account storage, so your data is saved in this browser only. Export a backup from Reports to keep it.")));
    if (!v) { root.append(h("div", { class: "empty" }, "This section is loading.")); return; }
    try { viewCleanup = v(root, app) || null; } catch (e) { console.error(e); root.append(U.errorBox(e)); }
    root.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  app.rerender = renderView;

  /* ---------- demo mode ---------- */
  async function setDemo(on) {
    app.demo = !!on;
    if (on) { app.store = C && MD.store.makeStore(MD.store.memoryBackend(MD.store.demoSeed())); }
    else { app.store.close(); app.store = app.liveStore; }
    app.quotes.clear();
    await primeStore();
    renderNav(); renderTop(); renderView();
  }
  app.setDemo = setDemo;
  async function primeStore() {
    await Promise.all(MD.store.COLLECTIONS.map(c => app.store.list(c).catch(() => [])));
    for (const c of ["tx", "inbox", "alerts", "watch", "comps"]) app.store.watch(c, () => { app.emit("data:" + c); if (c === "inbox") renderNav(); });
  }

  /* ---------- command bar ---------- */
  const recentKey = "recentSearches";
  function localIndex() {
    const items = ROUTES.map(([id, label]) => ({ group: "Go to", title: label, sub: "Section", kind: "page", run: () => app.go(id), text: label + " " + id }));
    for (const c of app.reg.values()) items.push({ group: "Currencies", title: c.code + " — " + c.name, sub: c.type + (c.note ? " · " + c.note.slice(0, 60) : ""), kind: c.type, text: c.code + " " + c.name, run: () => app.openAsset(c.type === "metal" ? { id: "metal:" + c.code, cls: "metal", symbol: c.code, name: c.name } : { id: "fx:" + C.marketPair(c.code, app.settings.displayCurrency === c.code ? "USD" : app.settings.displayCurrency).base + C.marketPair(c.code, app.settings.displayCurrency === c.code ? "USD" : app.settings.displayCurrency).quote, cls: "fx", ...C.marketPair(c.code, app.settings.displayCurrency === c.code ? "USD" : app.settings.displayCurrency) }) });
    const { positions } = C.buildPositions(app.store.cached("tx"));
    for (const p of positions.values()) if (p.qty.gt(0)) items.push({ group: "Holdings", title: p.symbol + " — " + p.name, sub: "In your portfolio · " + p.assetClass, kind: "holding", text: p.symbol + " " + p.name, run: () => app.openAsset(Object.assign({ id: p.assetId, cls: p.assetClass, symbol: p.symbol, name: p.name }, p.meta || {})) });
    for (const w of app.store.cached("watch")) items.push({ group: "Watchlist", title: w.symbol + " — " + w.name, sub: "Watchlist · " + w.cls, kind: "watch", text: w.symbol + " " + w.name, run: () => app.openAsset(Object.assign({ id: w.assetId }, w)) });
    for (const r of app.store.cached("reports")) items.push({ group: "Research reports", title: (r.assetName || r.question || "Report").slice(0, 80), sub: "Report · " + U.fmtDate(r.createdAt), kind: "report", text: (r.assetName || "") + " " + (r.question || ""), run: () => app.go("research", Object.assign({}, app.ctx.research || {}, { openReport: r.id })) });
    for (const s of app.store.cached("searches")) items.push({ group: "Saved searches", title: s.query, sub: "Saved search", kind: "saved", text: s.query, run: () => openCommand(s.query) });
    for (const a of app.store.cached("alerts")) items.push({ group: "Alerts", title: a.symbol + " " + a.kind + " " + a.threshold, sub: "Alert", kind: "alert", text: a.symbol + " alert", run: () => app.go("inbox") });
    for (const c of app.store.cached("catalysts")) items.push({ group: "Catalysts", title: c.title, sub: c.date + " · " + (c.symbol || ""), kind: "catalyst", text: c.title + " " + (c.symbol || ""), run: () => app.go("calendar") });
    return items;
  }
  function openCommand(initial) {
    const input = h("input", { type: "search", placeholder: "Search or ask: AAPL, bitcoin, EUR/JPY, Charizard, Ash Blossom, 'show my portfolio in EUR'…", "aria-label": "Search", autocomplete: "off", spellcheck: "false" });
    const results = h("div", { class: "results", role: "listbox" });
    const box = h("div", { class: "cmd" }, input, results);
    const m = U.modal(null, box, { cls: "cmd" });
    m.box.querySelector(".bd").style.padding = "0";
    let items = [], sel = 0, remoteId = 0, remote = [];
    const index = localIndex();
    const render = () => {
      results.replaceChildren();
      let g = "";
      items.forEach((it, i) => {
        if (it.group !== g) { results.append(h("div", { class: "grp" }, it.group)); g = it.group; }
        const b = h("button", { class: "item", type: "button", role: "option", "aria-selected": String(i === sel), onclick: () => pick(i) }, h("span", { class: "t" }, it.title), h("span", { class: "s" }, it.sub || ""), h("span", { class: "k" }, it.kind || ""));
        results.append(b);
      });
      if (!items.length) results.append(h("div", { class: "empty" }, input.value.trim() ? "No matches yet." : "Type to search everything."));
      const cur = results.querySelector('[aria-selected="true"]'); if (cur) cur.scrollIntoView({ block: "nearest" });
    };
    const pick = (i) => {
      const it = items[i]; if (!it) return;
      const q = input.value.trim();
      if (q) { const rec = [q, ...ls.get(recentKey, []).filter(x => x !== q)].slice(0, 8); ls.set(recentKey, rec); }
      m.close(); it.run();
    };
    const compute = () => {
      const q = input.value.trim();
      if (!q) {
        items = app.recent().slice(0, 6).map(a => ({ group: "Recently viewed", title: (a.symbol && a.symbol !== a.name ? a.symbol + " — " : "") + (a.name || a.symbol), sub: a.cls, kind: a.cls, run: () => app.openAsset(a) }))
          .concat(ls.get(recentKey, []).map(r => ({ group: "Recent searches", title: r, sub: "Search again", kind: "recent", run: () => openCommand(r) })))
          .concat(index.filter(i => i.kind === "page"));
        sel = 0; render(); return;
      }
      const scored = index.map(it => ({ it, s: C.fuzzyScore(q, it.text) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 14).map(x => x.it);
      const words = q.split(/\s+/).length;
      const ask = (words >= 3 && app.caps.sample) ? [{ group: "Ask", title: "Ask Market Desk: “" + q + "”", sub: "Claude works out what you mean and takes you there", kind: "ai", run: () => routeNatural(q) }] : [];
      const save = [{ group: "Ask", title: "Save this search", sub: "Keeps “" + q + "” in saved searches", kind: "save", run: () => app.store.create("searches", { query: q }).then(() => U.toast("Search saved")) }];
      const pair = C.parsePair(q); const pairItem = pair && app.reg.has(pair.base) && app.reg.has(pair.quote) ? [{ group: "Currencies", title: pair.base + "/" + pair.quote, sub: "Open currency pair", kind: "fx", run: () => app.openAsset({ id: "fx:" + pair.base + pair.quote, cls: "fx", base: pair.base, quote: pair.quote, symbol: pair.base + "/" + pair.quote }) }] : [];
      items = [...pairItem, ...scored, ...remote, ...ask, ...save];
      sel = Math.min(sel, Math.max(0, items.length - 1)); render();
    };
    let t = null;
    const searchRemote = () => {
      const q = input.value.trim(); const id = ++remoteId; remote = [];
      if (q.length < 2 || !D.available() || q.split(/\s+/).length > 4) { compute(); return; }
      const add = (group, list) => { if (id !== remoteId) return; remote = remote.concat(list.slice(0, 6).map(a => ({ group, title: (a.symbol && a.symbol !== a.name ? a.symbol + " — " : "") + a.name, sub: a.sub || "", kind: a.cls, run: () => app.openAsset(a) }))); compute(); };
      D.stocks.search(q).then(l => add("Stocks & ETFs", l)).catch(() => {});
      D.crypto.search(q).then(l => add("Crypto", l)).catch(() => {});
      if (q.length >= 3) { D.pokemon.search(q).then(l => add("Pokémon cards", l)).catch(() => {}); D.ygo.search(q).then(l => add("Yu-Gi-Oh! cards", l)).catch(() => {}); D.events.search(q).then(l => add("Event odds", l)).catch(() => {}); }
    };
    input.addEventListener("input", () => { sel = 0; remote = []; compute(); clearTimeout(t); t = setTimeout(searchRemote, 350); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); render(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
      else if (e.key === "Enter") { e.preventDefault(); pick(sel); }
    });
    if (initial) input.value = initial;
    compute(); if (initial) searchRemote();
    setTimeout(() => input.focus(), 20);
  }
  app.openCommand = openCommand;
  async function routeNatural(q) {
    const s = app.caps.sample; if (!s) return;
    U.toast("Working out your request…");
    const routes = ROUTES.map(r => r[0]).join(", ");
    try {
      const r = await s.json(`You route requests inside a finance app. Reply with ONLY JSON: {"action": one of "navigate","open_asset","set_display_currency","convert","research","compare","explain_portfolio","screen", "route": one of [${routes}] or null, "assetQuery": string or null, "assetClass": "stock"|"etf"|"crypto"|"fx"|"metal"|"pokemon"|"yugioh"|null, "currency": 3-letter code or null, "amount": number or null, "from": code or null, "to": code or null, "assets": [strings], "note": short string}.
Request: "${q.replace(/"/g, "'")}"`, { modelTier: "quick" });
      runIntent(r, q);
    } catch (e) { U.toast("Couldn't work that out", e && e.code === "not_granted" ? "Claude access was declined for this page." : "Try searching for the asset or section directly.", true); }
  }
  async function runIntent(r, q) {
    if (!r || typeof r !== "object") return;
    if (r.action === "set_display_currency" && r.currency && app.reg.has(r.currency)) { app.saveSettings({ displayCurrency: r.currency, reportingCurrency: /portfolio|report/i.test(q) ? r.currency : app.settings.reportingCurrency }); app.go(/portfolio/i.test(q) ? "portfolio" : app.route); U.toast("Showing values in " + r.currency); return; }
    if (r.action === "convert" && r.from && r.to) { app.go("fx", { convert: { amount: r.amount || 1, from: r.from, to: r.to } }); return; }
    if (r.action === "compare") { app.go("opportunities", { compare: r.assets || [] }); return; }
    if (r.action === "screen") { app.go("opportunities", { screen: q }); return; }
    if (r.action === "explain_portfolio") { app.go("dashboard"); setTimeout(() => app.emit("explainToday"), 300); return; }
    if (r.action === "research") { app.go("research", Object.assign({}, app.ctx.research || {}, { prefill: q })); return; }
    if ((r.action === "open_asset" || r.assetQuery) && r.assetQuery) { openCommand(r.assetQuery); return; }
    if (r.route && ROUTES.some(x => x[0] === r.route)) { app.go(r.route); return; }
    openCommand(q);
  }

  /* ---------- shortcuts ---------- */
  const SHORTCUTS = [["⌘K / Ctrl+K or /", "Open search and commands"], ["?", "Show shortcuts"], ["Backspace or Alt+←", "Back to the previous list"], ["g then d", "Dashboard"], ["g then p", "Portfolio"], ["g then r", "Deep Research"], ["g then f", "FX & Currencies"], ["g then i", "Inbox"], ["g then s", "Settings"], ["Esc", "Close dialogs"]];
  app.SHORTCUTS = SHORTCUTS;
  let gPending = false;
  document.addEventListener("keydown", (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName) || document.activeElement.isContentEditable;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openCommand(); return; }
    if (typing || document.querySelector(".overlay")) return;
    if (e.key === "/") { e.preventDefault(); openCommand(); return; }
    if (e.key === "?") { U.modal("Keyboard shortcuts", U.table([{ t: "Keys", v: 0 }, { t: "Action", v: 1 }], SHORTCUTS)); return; }
    if (e.key === "Backspace" || (e.altKey && e.key === "ArrowLeft")) { if (document.querySelector(".backbar")) { e.preventDefault(); app.back(); } return; }
    if (e.key === "g") { gPending = true; setTimeout(() => gPending = false, 900); return; }
    if (gPending) { const map = { d: "dashboard", p: "portfolio", r: "research", f: "fx", i: "inbox", s: "settings", m: "markets", c: "calendar" }; if (map[e.key]) { app.go(map[e.key]); gPending = false; } }
  });

  /* ---------- alert monitor (runs while the page is open) ---------- */
  let monitoring = false;
  app.checkAlerts = async function (manual) {
    if (monitoring || !D.available()) return [];
    monitoring = true; const fired = [];
    try {
      for (const a of app.store.cached("alerts")) {
        if (a.paused) continue;
        let q; try { q = await app.quote(Object.assign({ id: a.assetId }, a), manual ? 0 : 60000); } catch { continue; }
        const value = a.kind === "move" ? q.changePct : q.price;
        if (value == null) continue;
        const r = C.evaluateAlert(a, value, a.state);
        if (JSON.stringify(r.state) !== JSON.stringify(a.state || {})) await app.store.put("alerts", a.id, Object.assign({}, a, { state: r.state, lastValue: value, lastCheckedAt: Date.now() })).catch(() => {});
        if (r.triggered) {
          const mat = C.materiality(q.changePct || 0, a.volPct);
          const title = a.symbol + (a.kind === "above" ? " rose to " : a.kind === "below" ? " fell to " : " moved ") + (a.kind === "move" ? U.pct(value) : C.fmtNum(value, Math.abs(value) >= 1 ? 2 : 6) + " " + (q.currency || ""));
          await app.store.create("inbox", { kind: "alert", alertId: a.id, title, body: (a.note || "") + " Threshold " + a.threshold + ". Source: " + (q.source || "") + ".", materiality: mat, read: false, at: Date.now() });
          fired.push(title);
          if (app.settings.notify.toasts && !C.inQuietHours(new Date(), app.settings.quiet) && mat >= (app.settings.notify.minMateriality || 0)) U.toast("Alert: " + title, a.note || "");
        }
      }
      // keep the inbox bounded
      const inbox = app.store.cached("inbox").sort((x, y) => (y.at || 0) - (x.at || 0));
      for (const old of inbox.slice(300)) await app.store.remove("inbox", old.id).catch(() => {});
    } finally { monitoring = false; }
    return fired;
  };

  /* ---------- boot ---------- */
  async function boot() {
    renderNavPlaceholder();
    const use = (n) => window.claude ? claude.use(n).catch(() => null) : Promise.resolve(null);
    const [db, user, mcp, sample, downloads] = await Promise.all(["db", "user", "mcp", "sample", "downloads"].map(use));
    app.caps = { db, user, mcp, sample, downloads };
    D.init(mcp);
    app.uid = user ? await user.id().catch(() => null) : null;
    app.liveStore = MD.store.makeStore(db && app.uid ? MD.store.dbBackend(db, app.uid) : MD.store.localBackend("mdp.data."));
    app.store = app.liveStore;
    app._hostTheme = document.documentElement.getAttribute("data-theme");
    await primeStore();
    await loadSettings();
    const r = location.hash.slice(1);
    app.route = ROUTES.some(x => x[0] === r) ? r : ls.get("route", "dashboard");
    renderNav(); renderTop(); renderView(); renderTape();
    let tapeOn = app.settings.tape;
    app.on("settings", () => { renderTop(); if (app.settings.tape !== tapeOn) { tapeOn = app.settings.tape; renderTape(); } });
    rates.refresh().catch(() => {});
    D.onActivity(() => { const p = U.$("#livePill"); if (p) p.title = "Last data request " + new Date().toLocaleTimeString(); });
    setInterval(() => { if (!document.hidden) app.checkAlerts(false).catch(() => {}); }, 120000);
    setTimeout(() => app.checkAlerts(false).catch(() => {}), 8000);
    try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => renderView()); } catch {}
    new MutationObserver(() => { if (app.settings.theme === "system") { app._hostTheme = document.documentElement.getAttribute("data-theme"); renderView(); } }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }
  function renderNavPlaceholder() { U.$("#content").replaceChildren(h("div", { class: "skeleton" }, "Starting Market Desk…")); }
  app.boot = boot;
})(typeof window !== "undefined" ? window : globalThis);
