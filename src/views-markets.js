/* Market views: Global Markets, Stocks & ETFs, Crypto, FX & Currencies, Precious Metals, Trading Cards. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const C = MD.core, U = MD.ui, D = MD.data, h = U.h, X = MD.common;
  const V = (MD.views = MD.views || {});

  function head(title, sub, actions) { return h("div", { class: "page-head" }, h("div", { class: "stack", style: "gap:4px" }, h("h1", { class: "page" }, title), sub ? h("p", { class: "sub" }, sub) : null), actions ? h("div", { class: "row" }, actions) : null); }
  function quoteTile(q, onClick, conv) {
    const R = MD.app.settings.displayCurrency;
    const cq = conv !== false && q.currency && q.currency !== R ? MD.app.rates.quote(q.currency, R) : null;
    return h("button", { class: "tile", type: "button", onclick: onClick, title: (q.source || "") + (q.ts ? " · " + U.fmtTs(q.ts) : "") },
      h("span", { class: "label" }, q.symbol + (q.sublabel ? " · " + q.sublabel : "")),
      h("span", { class: "small", style: "overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, q.name),
      h("span", { class: "v" }, q.price == null ? "—" : U.money(q.price, q.currency, { price: true })),
      h("span", { class: "s" }, q.changePct != null ? U.chg(q.changePct) : h("span", { class: "faint" }, "no daily change"), cq ? h("span", { class: "faint" }, "  ≈ " + U.money(C.convert(q.price, cq), R, { price: true })) : null),
      h("span", { class: "s faint" }, h("span", { class: "st " + (q.status || "Live") }, q.status || "Live"), " ", q.source || ""));
  }
  function tileErr(label, e) { return h("div", { class: "tile" }, h("span", { class: "label" }, label), h("span", { class: "small down" }, U.errorText(e))); }
  async function quoteGrid(el, assets) {
    el.replaceChildren(...assets.map(a => h("div", { class: "tile", "data-id": a.id }, h("span", { class: "label" }, a.symbol), h("span", { class: "skeleton" }, "Loading…"))));
    await Promise.all(assets.map(async (a, i) => {
      let node;
      try { const q = await MD.app.quote(a); node = quoteTile(Object.assign({}, q, { symbol: a.symbol, name: a.name || q.name, sublabel: a.sublabel }), () => MD.app.openAsset(a)); }
      catch (e) { node = tileErr(a.symbol, e); }
      el.children[i] && el.children[i].replaceWith(node);
    }));
  }

  /* List helpers */
  const LIVE_NOTE = "Prices in lists are snapshots; open an item for its live price.";
  const priceCell = (r) => r.price == null ? "—" : U.money(r.price, r.currency || "USD", { price: true });
  const isJunk = (r) => !(r.price >= 1) || /[.\-]?(W|WS|WT|U|R)$/.test(r.symbol) && r.symbol.length >= 5;

  /* ================= Global Markets ================= */
  V.markets = function (root, app) {
    const tab = app.ctx.marketsTab || "overview";
    const ev = app.ctx.markets && app.ctx.markets.cls === "event" ? app.ctx.markets : null;
    if (tab === "events" && ev) { root.append(app.backBar()); return eventDetail(root, app, ev); }
    root.append(head("Global Markets", "A cross-asset snapshot. Click any tile for its live page; ← Back brings you here. International equity markets are shown through US-listed country ETFs, labelled as such."),
      U.tabs([["overview", "Overview"], ["events", "Event odds (prediction markets)"]], tab, (k) => { app.ctx.marketsTab = k; app.rerender(); }));
    if (tab === "events") return eventsList(root, app);
    const groups = [
      ["US equities", [["SPY", "S&P 500 ETF"], ["QQQ", "Nasdaq-100 ETF"], ["DIA", "Dow Jones ETF"], ["IWM", "Russell 2000 ETF"]].map(([s, n]) => ({ id: "etf:" + s, cls: "etf", symbol: s, name: n }))],
      ["International equities (US-listed ETF proxies)", [["EFA", "Developed ex-US"], ["VGK", "Europe"], ["EWJ", "Japan"], ["EWU", "United Kingdom"], ["EWG", "Germany"], ["MCHI", "China"], ["INDA", "India"], ["EWZ", "Brazil"], ["EWC", "Canada"], ["EWA", "Australia"]].map(([s, n]) => ({ id: "etf:" + s, cls: "etf", symbol: s, name: n, sublabel: "USD ETF" }))],
      ["Crypto", [["bitcoin", "BTC", "Bitcoin"], ["ethereum", "ETH", "Ethereum"], ["solana", "SOL", "Solana"], ["tether", "USDT", "Tether (stablecoin)"]].map(([id, s, n]) => ({ id: "crypto:" + id, cls: "crypto", cgId: id, symbol: s, name: n }))],
      ["Precious metals (spot, USD per troy oz)", D.METALS.map(([s, n]) => ({ id: "metal:" + s, cls: "metal", symbol: s, name: n }))]
    ];
    for (const [title, assets] of groups) { const g = h("div", { class: "grid g-auto" }); root.append(U.section(title, g)); quoteGrid(g, assets); }
    const fxBox = h("div", {}); root.append(U.section("Currencies against " + app.settings.displayCurrency, fxBox, [h("button", { class: "btn ghost sm", type: "button", onclick: () => app.go("fx", null, { fromNav: true }) }, "All currencies")]));
    U.async(fxBox, () => app.rates.refresh(), () => {
      const R = app.settings.displayCurrency;
      const codes = ["USD", "EUR", "GBP", "JPY", "CHF", "CNY", "CAD", "AUD", "INR", "BRL", "MXN", "ZAR"].filter(c => c !== R);
      fxBox.append(h("div", { class: "grid g-auto" }, codes.map(c => {
        const mp = C.marketPair(c, R), q = app.rates.quote(mp.base, mp.quote);
        return quoteTile({ symbol: mp.base + "/" + mp.quote, name: app.reg.get(c) ? app.reg.get(c).name : c, price: q ? Number(q.rate) : null, currency: mp.quote, status: "Live", source: q && q.source, ts: q && q.ts }, () => app.openAsset({ id: "fx:" + mp.base + mp.quote, cls: "fx", base: mp.base, quote: mp.quote, symbol: mp.base + "/" + mp.quote }), false);
      })), h("p", { class: "small muted" }, "Indicative mid rates."));
    });
  };
  function eventsList(root, app) {
    const input = h("input", { type: "search", placeholder: "Search events: Fed rate, election, recession…", value: app.ls.get("evq", "Fed rate") });
    const list = h("div", { class: "stack" });
    const search = () => { const q = input.value.trim(); if (!q) return; app.ls.set("evq", q); U.async(list, () => D.events.search(q), (evs) => list.append(U.dataTable([{ t: "Event", v: "name", sort: (r) => r.name }, { t: "Ends", v: (r) => r.sub.replace("Ends ", ""), sort: (r) => r.sub }], evs, { key: "events", noun: "markets", filter: false, empty: "No open markets match.", onRow: (r) => app.openAsset({ id: r.id, cls: "event", slug: r.slug, name: r.name, symbol: "Odds" }) }))); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") search(); });
    root.append(U.section("Find an event market", h("div", { class: "stack" }, h("div", { class: "row" }, input, h("button", { class: "btn", type: "button", onclick: search }, "Search")), list, h("p", { class: "small muted" }, "Polymarket odds are the prices traders pay, not forecasts. Thin markets move on small trades."))));
    search();
  }
  function eventDetail(root, app, a) {
    const detail = h("div", { class: "stack" }); root.append(detail);
    let sel = 0;
    const showEvent = () => U.async(detail, () => D.events.event(a.slug), (ev) => {
      const ms = D.events.markets(ev); if (sel >= ms.length) sel = 0;
      const m = ms[sel];
      const panel = X.chartPanel({ id: "event:" + a.slug, cls: "event" }, { tfs: ["1D", "1W", "1M", "Max"], defaultTf: "1M", loader: (tf) => D.events.history(m.token, tf), fmt: (v) => v.toFixed(1) + "%" });
      detail.append(h("h1", { class: "page" }, ev.title), U.section("Odds", h("div", { class: "stack" },
        U.kv([["Leading outcome", ms[0] ? ms[0].label + " · " + ms[0].yes.toFixed(1) + "%" : "—"], ["Volume", "USD " + C.fmtNum(ev.volume || 0, 0)], ["24h volume", "USD " + C.fmtNum(ev.volume24hr || 0, 0)], ["Liquidity", "USD " + C.fmtNum(ev.liquidity || 0, 0)], ["Ends", U.fmtDate(String(ev.endDate || "").slice(0, 10))]]),
        U.bars(ms.slice(0, 12).map((x, i) => ({ label: (i === sel ? "▸ " : "") + x.label, value: x.yes, text: x.yes.toFixed(1) + "%" + (x.d1 != null ? " (" + (x.d1 > 0 ? "+" : "") + x.d1.toFixed(1) + " pts)" : "") }))),
        h("div", { class: "row" }, h("span", { class: "label" }, "Chart outcome"), h("select", { onchange: (e) => { sel = Number(e.target.value); showEvent(); } }, ms.slice(0, 12).map((x, i) => h("option", { value: i, selected: i === sel }, x.label)))),
        panel.el, U.status({ status: "Live", source: "Polymarket", ts: Date.now() }))));
    });
    showEvent();
  }

  /* ================= Stocks & ETFs ================= */
  const STOCK_LISTS = [["largest", "Largest companies"], ["gainers", "Top gainers"], ["losers", "Top losers"], ["active", "Most active"], ["etfs", "Popular ETFs"], ["mine", "My universe & watchlist"]];
  V.stocks = function (root, app) {
    const a = app.ctx.stocks && (app.ctx.stocks.cls === "stock" || app.ctx.stocks.cls === "etf") ? app.ctx.stocks : null;
    if (a) return stockDetail(root, app, a);
    const tab = app.ls.get("stockList", "largest");
    root.append(head("Stocks & ETFs", "Pick a list, sort or filter it, and click a row to open that stock's live page. ← Back returns you to this list.", [h("button", { class: "btn ghost", type: "button", onclick: () => app.openCommand() }, "Search any ticker")]),
      U.tabs(STOCK_LISTS, tab, (k) => { app.ls.set("stockList", k); app.rerender(); }));
    const box = h("div", {}); root.append(box);
    const open = (r) => app.openAsset({ id: (r.cls === "etf" ? "etf:" : "stock:") + r.symbol, cls: r.cls || "stock", symbol: r.symbol, name: r.name });
    const cols = (extra) => [{ t: "Symbol", v: (r) => h("strong", {}, r.symbol), sort: (r) => r.symbol }, { t: "Name", v: (r) => h("span", { class: "small" }, r.name), sort: (r) => r.name || "" }, { t: "Price", v: priceCell, sort: (r) => r.price, n: true }, { t: "Change", v: (r) => r.change != null ? h("span", { class: "num " + U.signCls(r.change) }, (r.change > 0 ? "+" : "") + C.fmtNum(r.change, 2)) : "—", sort: (r) => r.change, n: true }, { t: "% change", v: (r) => U.chg(r.changePct), sort: (r) => r.changePct, n: true }, ...extra];
    if (tab === "largest") {
      let rows = [], offset = 0, table = null;
      const more = h("button", { class: "btn ghost sm", type: "button" }, "Load the next 100");
      more.onclick = async () => { more.disabled = true; more.textContent = "Loading…"; try { const next = await D.stocks.screener(offset, 100); offset += 100; rows = rows.concat(next); table.update(rows); } catch (e) { U.toast("Couldn't load more", U.errorText(e), true); } more.disabled = false; more.textContent = "Load the next 100"; };
      U.async(box, async () => { const r = await D.stocks.screener(0, 100); offset = 100; return r; }, (r) => { rows = r; table = U.dataTable(cols([{ t: "Market cap", v: (x) => x.marketCap ? "USD " + C.fmtNum(x.marketCap / 1e9, 1) + "B" : "—", sort: (x) => x.marketCap, n: true }]), rows, { key: "stocks.largest", sort: [5, -1], noun: "stocks", onRow: open, more, placeholder: "Filter by symbol or name…" }); box.append(table, U.status({ status: "Delayed", source: "Nasdaq stock screener", note: LIVE_NOTE })); }, { loading: "Loading the largest US-listed companies…" });
    } else if (tab === "gainers" || tab === "losers" || tab === "active") {
      const hide = h("input", { type: "checkbox", checked: app.ls.get("hideJunk", true) });
      U.async(box, () => D.stocks.movers(), (m) => {
        const set = m[tab];
        const filtered = () => hide.checked ? set.rows.filter(r => !isJunk(r)) : set.rows;
        const t = U.dataTable(cols(tab === "active" ? [{ t: "Volume", v: (x) => x.volume ? C.fmtNum(x.volume, 0) : "—", sort: (x) => x.volume, n: true }] : []), filtered(), { key: "stocks." + tab, sort: tab === "active" ? [5, -1] : [4, tab === "losers" ? 1 : -1], noun: "stocks", onRow: open, toolbar: h("label", { class: "chk small" }, hide, "Hide penny stocks, warrants and units") });
        hide.onchange = () => { app.ls.set("hideJunk", hide.checked); t.update(filtered()); };
        box.append(t, U.status({ status: "Delayed", source: "Nasdaq market movers", note: set.asOf + ". Big percentage movers are often tiny, illiquid companies; check volume and market cap before reading anything into a move." }));
      }, { loading: "Loading today's movers…" });
    } else {
      const assets = tab === "etfs" ? D.stocks.ETFS.map(([s, n]) => ({ id: "etf:" + s, cls: "etf", symbol: s, name: n })) : [...new Map([...app.settings.universe.map(s => ["stock:" + s, { id: "stock:" + s, cls: "stock", symbol: s, name: s }]), ...app.store.cached("watch").filter(w => w.cls === "stock" || w.cls === "etf").map(w => [w.assetId, { id: w.assetId, cls: w.cls, symbol: w.symbol, name: w.name }])]).values()];
      U.async(box, () => Promise.all(assets.map(x => app.quote(x).then(q => Object.assign({}, x, { name: x.cls === "etf" ? x.name : q.name || x.name, price: q.price, change: q.change, changePct: q.changePct, currency: "USD", status: q.status }), () => Object.assign({}, x, { price: null })))), (rows) => {
        box.append(U.dataTable(cols([]), rows, { key: "stocks." + tab, sort: [0, 1], noun: tab === "etfs" ? "ETFs" : "assets", onRow: open, empty: "Add tickers in Settings or ☆ Watch stocks to fill this list." }), U.status({ status: rows[0] && rows[0].status || "Delayed", source: "Nasdaq quotes", note: tab === "mine" ? "Edit the universe in Settings → General." : "" }));
      }, { loading: "Loading quotes…" });
    }
    root.append(h("div", { class: "banner info" }, h("p", {}, "International coverage: quotes for primary listings on non-US exchanges aren't available from any free source this page can reach. Many large foreign companies trade in the US as ADRs (TM for Toyota, ASML, NVO for Novo Nordisk, TSM for TSMC, SAP) and country ETFs cover whole markets; these are labelled as US listings in USD.")));
  };
  function stockDetail(root, app, a) {
    let quote = null, panel = null;
    const top = h("div", {}), actions = h("div", {}), overview = h("div", { class: "stack" }), tabEl = h("div", {});
    root.append(app.backBar(), top, actions);
    panel = X.chartPanel(a, { tfs: X.tfsFor(a), defaultTf: "1D" });
    U.async(top, () => app.quote(a, 20000), (q) => {
      quote = q; const asset = Object.assign({}, a, { name: q.name, cls: q.cls, listing: q.listing, exchange: q.exchange, currency: "USD" });
      app.ctx.stocks = X.slim(asset); app.ls.set("ctx", app.ctx);
      top.append(X.quoteHeader(Object.assign({}, q, { clsLabel: q.cls === "etf" ? "ETF" : "Stock", subline: q.marketStatus, changeLabel: "today", kind: "stock" }), q.nextEarnings ? h("span", { class: "small muted" }, "Next earnings: " + q.nextEarnings) : null, { asset, onTick: (p, t) => panel.tick(p, t) }));
      actions.replaceChildren(X.actionBar(asset, () => quote, () => panel && panel.series));
    });
    const priceSec = U.section("Price", panel.el); priceSec.id = "sec-price";
    root.append(MD.insights.jumpBar([["sec-price", "Chart"], ["sec-ai", "AI take"], ["sec-why", "Why it's moving"], ["sec-memory", "AI memory"], ["sec-projection", "Projection"], ["sec-technicals", "Technicals"], ["sec-risk", "Risk"], ["sec-analysts", "Wall Street"], ["sec-company", "Company & news"], ["sec-position", "Your position"], ["sec-notes", "Notes"]]), priceSec, MD.aiTake.card(app, a), MD.brain.whyCard(app, a), MD.ai.memoryCard(app, a), MD.insights.panel(a, { currency: "USD", analysts: true }));
    const tab = app.ls.get("stockTab", "summary");
    const renderTab = (k) => {
      app.ls.set("stockTab", k);
      tabEl.replaceChildren(U.tabs([["summary", "Summary"], ["news", "News"], ["earnings", "Earnings"], ["insiders", "Insiders & dividends"], ["financials", "Financial statements"], ["options", "Options-implied moves"], ["research", "Research history"]], k, renderTab), overview);
      if (k === "summary") U.async(overview, () => D.stocks.summary(a.symbol, a.cls), (rows) => { overview.append(U.kv(rows.map(r => [r.label, r.value])), U.status({ status: "Delayed", source: "Nasdaq company summary", note: "Figures as published by Nasdaq." }), h("div", { class: "explain" }, "Market cap = share price × shares outstanding. The 1-year target is the average analyst price target reported by Nasdaq, not a prediction by this app.")); });
      else if (k === "news") U.async(overview, () => D.bigdataNews("Latest news about " + ((quote && quote.name) || a.name || a.symbol) + " (" + a.symbol + ")", 8), (r) => {
        overview.append(X.newsList(r.items, { empty: "Bigdata.com found no recent news for " + a.symbol + "." }), h("p", { class: "tiny muted" }, "News from ", h("a", { href: "https://bigdata.com", target: "_blank", rel: "noopener noreferrer" }, "Bigdata.com"), ". Headlines are what the publishers reported; check the original before acting."));
      }, { loading: "Searching Bigdata.com news…" });
      else if (k === "earnings") MD.earnings.panel(overview, app, a);
      else if (k === "insiders") MD.earnings.insidersPanel(overview, app, a);
      else if (k === "financials") U.async(overview, () => D.stocks.financials(a.symbol), (f) => {
        const t = app.ls.get("finTab", "income");
        const show = (x) => { app.ls.set("finTab", x); const tb = f[x]; overview.replaceChildren(U.tabs([["income", "Income statement"], ["balance", "Balance sheet"], ["cash", "Cash flow"], ["ratios", "Ratios"]], x, show), tb ? U.table(tb.headers.map((hd, i) => ({ t: hd, v: i, n: i > 0 })), tb.rows) : h("div", { class: "empty" }, "Not provided."), U.status({ status: "Historical", source: "Nasdaq (annual, " + f.unitNote + ")" })); };
        show(t);
      });
      else if (k === "options") U.async(overview, async () => { const q = quote || await app.quote(a); return D.stocks.optionMoves(a.symbol, q.price).then(o => Object.assign(o, { price: q.price })); }, (o) => {
        overview.append(o.moves.length ? U.table([{ t: "Expiry", v: "expiry" }, { t: "Days", v: "days", n: true }, { t: "Implied move (±)", v: (m) => "±" + m.movePct.toFixed(1) + "%", n: true }, { t: "Implied range", v: (m) => C.fmtNum(o.price * (1 - m.movePct / 100), 2) + " – " + C.fmtNum(o.price * (1 + m.movePct / 100), 2), n: true }, { t: "Strike used", v: (m) => C.fmtNum(m.strike, 2), n: true }], o.moves) : h("div", { class: "empty" }, "No liquid at-the-money options found."),
          U.status({ status: "Delayed", source: o.source, note: "As of " + o.asOf }), h("div", { class: "explain" }, "The at-the-money straddle (call + put) costs roughly what the options market expects the stock to move by that expiry, in either direction. It's a market estimate, not a forecast, and says nothing about direction."));
      });
      else { const reps = app.store.cached("reports").filter(r => r.assetId === a.id).sort((x, y) => y.createdAt - x.createdAt); overview.replaceChildren(reps.length ? U.table([{ t: "Date", v: (r) => U.fmtDate(r.createdAt) }, { t: "Mode", v: "mode" }, { t: "Verdict", v: (r) => r.report && r.report.verdict && r.report.verdict.label }], reps, { onRow: (r) => app.go("research", { openReport: r.id }) }) : h("div", { class: "empty" }, "No research on " + a.symbol + " yet.", h("button", { class: "btn sm", type: "button", onclick: () => app.go("research", { asset: X.slim(a) }) }, "Start deep research"))); }
    };
    const coSec = U.section("Company & fund data", tabEl); coSec.id = "sec-company";
    root.append(coSec);
    renderTab(tab);
  }

  /* ================= Crypto ================= */
  V.crypto = function (root, app) {
    const a = app.ctx.crypto && app.ctx.crypto.cls === "crypto" ? app.ctx.crypto : null;
    const vsSaved = app.ls.get("cryptoVs", app.settings.displayCurrency.toLowerCase());
    const vs = D.crypto.VS.includes(vsSaved) ? vsSaved : "usd";
    const vsSel = h("select", { "aria-label": "Quote currency", style: "width:auto", onchange: (e) => { app.ls.set("cryptoVs", e.target.value); app.rerender(); } }, D.crypto.VS.map(c => h("option", { value: c, selected: c === vs }, c.toUpperCase())));
    if (a) {
      root.append(app.backBar(), h("div", { class: "row end" }, h("label", { class: "row" }, h("span", { class: "label" }, "Quote in"), vsSel)));
      let quote = null, panel = null;
      const top = h("div", {}), act = h("div", {}), metrics = h("div", {});
      root.append(top, act);
      panel = X.chartPanel(a, { tfs: X.tfsFor(a), defaultTf: "1D" });
      U.async(top, () => D.crypto.quote(a.cgId || a.id.split(":")[1], vs), (q) => {
        quote = q;
        top.append(X.quoteHeader(Object.assign({}, q, { clsLabel: "Crypto", subline: "Rank " + (q.rank || "—"), changeLabel: "24h", kind: "crypto" }), null, { asset: Object.assign({}, a, { symbol: q.symbol }), chartCurrency: "USD", onTick: (p, t) => panel.tick(p, t) }));
        act.replaceChildren(X.actionBar(Object.assign({}, a, { name: q.name, symbol: q.symbol, currency: q.currency }), () => quote, () => panel && panel.series));
        metrics.replaceChildren(U.kv([["Market cap", U.money(q.marketCap, q.currency)], ["24h volume", U.money(q.volume24h, q.currency)], ["24h range", C.fmtNum(q.low24h, 2) + " – " + C.fmtNum(q.high24h, 2)], ["7d", U.pct(q.ch7d)], ["30d", U.pct(q.ch30d)], ["1y", U.pct(q.ch1y)], ["Circulating supply", C.fmtNum(q.circulating, 0)], ["Max supply", q.maxSupply ? C.fmtNum(q.maxSupply, 0) : "No cap"], ["All-time high", U.money(q.ath, q.currency, { price: true }) + " (" + U.fmtDate(q.athDate) + ")"], ["From all-time high", U.pct(q.athChangePct)]]),
          h("div", { class: "explain" }, "Market cap = price × circulating supply. Fully diluted value assumes every future token exists today, so unlock schedules matter when supply is far below the cap."),
          h("div", { class: "banner warn" }, h("p", {}, "Holding risks to weigh: exchange or custodian failure, smart-contract and bridge bugs, and wrapped tokens (e.g. WBTC) that depend on a custodian. If you hold both a coin and a wrapped version, record them as separate assets; the portfolio doesn't merge them.")));
      });
      const news = h("div", {});
      const priceSec = U.section("Price (USD)", panel.el), newsSec = U.section("Latest news · CoinMarketCap", news); priceSec.id = "sec-price"; newsSec.id = "sec-news";
      root.append(MD.insights.jumpBar([["sec-price", "Chart"], ["sec-ai", "AI take"], ["sec-why", "Why it's moving"], ["sec-memory", "AI memory"], ["sec-projection", "Projection"], ["sec-technicals", "Technicals"], ["sec-risk", "Risk"], ["sec-news", "News"], ["sec-position", "Your position"], ["sec-notes", "Notes"]]), priceSec, MD.aiTake.card(app, Object.assign({}, a, { cls: "crypto" })), MD.brain.whyCard(app, Object.assign({}, a, { cls: "crypto" })), MD.ai.memoryCard(app, Object.assign({}, a, { cls: "crypto" })), U.section("Market data · CoinGecko", metrics), MD.insights.panel(Object.assign({}, a, { cls: "crypto" }), { currency: "USD" }), newsSec);
      U.async(news, () => D.cmc.news(a.symbol, 8), (r) => {
        news.append(X.newsList(r.items, { empty: "CoinMarketCap returned no recent news for " + a.symbol + "." }),
          r.upcoming.length ? h("details", {}, h("summary", { class: "small" }, r.upcoming.length + " event or prediction page" + (r.upcoming.length > 1 ? "s" : "") + " with future dates"), X.newsList(r.upcoming, { clip: 200 })) : null,
          h("p", { class: "tiny muted" }, "CoinMarketCap matches news to coins loosely; check that each headline is about " + a.symbol + "."));
      }, { loading: "Loading news…" });
      return;
    }
    root.append(head("Crypto", "The 100 largest coins. Sort or filter, then click a coin for its live page; ← Back returns here. The list refreshes every 30 seconds while open.", [h("label", { class: "row" }, h("span", { class: "label" }, "Quote in"), vsSel), h("button", { class: "btn ghost", type: "button", onclick: () => app.openCommand() }, "Search any coin")]));
    const tbl = h("div", {}), stamp = h("div", {});
    let table = null;
    const cols = [{ t: "#", v: "rank", sort: (r) => r.rank, n: true }, { t: "Coin", v: (r) => h("span", {}, h("strong", {}, r.symbol), " ", h("span", { class: "small muted" }, r.name)), sort: (r) => r.symbol }, { t: "Price", v: priceCell, sort: (r) => r.price, n: true }, { t: "24h", v: (r) => U.chg(r.changePct), sort: (r) => r.changePct, n: true }, { t: "7d", v: (r) => U.chg(r.ch7d), sort: (r) => r.ch7d, n: true }, { t: "30d", v: (r) => U.chg(r.ch30d), sort: (r) => r.ch30d, n: true, cls: "adv" }, { t: "1y", v: (r) => U.chg(r.ch1y), sort: (r) => r.ch1y, n: true }, { t: "Market cap", v: (r) => U.money(r.marketCap, r.currency), sort: (r) => r.marketCap, n: true }, { t: "24h volume", v: (r) => U.money(r.volume24h, r.currency), sort: (r) => r.volume24h, n: true }];
    root.append(U.section("Largest by market cap · " + vs.toUpperCase(), h("div", { class: "stack" }, tbl, stamp)));
    U.async(tbl, () => D.crypto.top(vs, 100), (rows) => { table = U.dataTable(cols, rows, { key: "crypto.top", sort: [0, 1], noun: "coins", onRow: (r) => app.openAsset(r), placeholder: "Filter by symbol or name…" }); tbl.append(table); stamp.replaceChildren(U.status({ status: "Live", source: "CoinGecko", ts: rows[0] && rows[0].ts, note: LIVE_NOTE })); }, { loading: "Loading the top 100 coins…" });
    const timer = setInterval(async () => { if (document.hidden || !table) return; try { const rows = await D.crypto.top(vs, 100); table.update(rows); stamp.replaceChildren(U.status({ status: "Live", source: "CoinGecko", ts: rows[0] && rows[0].ts, note: LIVE_NOTE })); } catch {} }, 30000);
    const peg = h("div", {});
    root.append(U.section("Stablecoin peg monitor", peg));
    U.async(peg, () => D.crypto.markets(D.STABLECOINS.map(s => s[0]), "usd"), (rows) => {
      peg.append(U.table([{ t: "Stablecoin", v: (r) => r.symbol + " · " + r.name }, { t: "Price (USD)", v: (r) => C.fmtNum(r.price, 4), n: true }, { t: "Deviation", v: (r) => { const bps = (r.price - 1) * 10000; return h("span", { class: "num " + (Math.abs(bps) > 50 ? "down" : "") }, (bps > 0 ? "+" : "") + bps.toFixed(0) + " bps"); }, n: true }, { t: "24h low–high", v: (r) => C.fmtNum(r.low24h, 4) + " – " + C.fmtNum(r.high24h, 4), n: true }, { t: "Status", v: (r) => Math.abs(r.price - 1) > 0.005 || r.low24h < 0.99 ? h("span", { class: "st Estimated" }, "Off peg") : h("span", { class: "st Live" }, "Near peg") }], rows, { onRow: (r) => app.openAsset(r) }),
        h("p", { class: "small muted" }, "Flagged when the price is more than 50 bps from 1.00 or traded below 0.99 in 24 hours. A peg is a promise, not a guarantee."));
    });
    return () => clearInterval(timer);
  };

  /* ================= FX & Currencies ================= */
  V.fx = function (root, app) {
    const R = app.settings.displayCurrency;
    const ctx = app.ctx.fx || {};
    const opts = (sel) => [...app.reg.values()].map(c => h("option", { value: c.code, selected: c.code === sel }, c.code + " · " + c.name));
    if (ctx.cls === "fx" && ctx.base && ctx.quote) return fxDetail(root, app, ctx, opts);
    root.append(head("FX & Currencies", "Convert any two of " + app.reg.size + " currencies and metal units, or click a pair for its live page and chart. ← Back returns here."));
    const pairDefault = C.marketPair("EUR", R === "EUR" ? "USD" : R);
    const conv = ctx.convert || {};
    const amt = h("input", { type: "text", inputmode: "decimal", value: conv.amount != null ? String(conv.amount) : "1000", "aria-label": "Amount" });
    const from = h("select", { "aria-label": "From" }, opts(conv.from || pairDefault.base)), to = h("select", { "aria-label": "To" }, opts(conv.to || pairDefault.quote));
    const out = h("div", { class: "stack" });
    const run = async () => {
      out.replaceChildren(h("div", { class: "skeleton" }, "Converting…"));
      try {
        await app.rates.refresh();
        const q = app.rates.quote(from.value, to.value);
        const a = C.dec(amt.value);
        if (!a) { out.replaceChildren(h("div", { class: "err" }, "Enter a number.")); return; }
        if (!q) { out.replaceChildren(h("div", { class: "banner err" }, h("p", {}, "No rate available for " + from.value + "/" + to.value + ". The source doesn't publish one of these currencies, so a conversion can't be established."))); return; }
        const v = C.convert(a, q), mp = C.marketPair(from.value, to.value);
        const mq = mp.base === from.value ? q : C.invert(q);
        const fc = app.reg.get(from.value), tc = app.reg.get(to.value);
        const kp = D.fx.krakenPair(mp.base, mp.quote);
        const spreadPct = app.exitAssumption("cash", from.value, to.value).fxSpreadPct;
        out.replaceChildren(
          h("div", { class: "num", style: "font-size:1.6rem" }, U.money(a, from.value) + " = " + U.money(v, to.value)),
          U.kv([["Market quote", mp.base + "/" + mp.quote + " " + C.fmtNum(mq.rate, 6)], ["Convention", mp.convention], ["Rate type", q.type === "cross" ? "Cross rate via " + q.legs[0].base : q.type], ["Source", q.source], ["As of", U.fmtTs(q.ts)], ["Est. conversion cost", spreadPct ? "≈ " + U.money(v.times(spreadPct).div(100), to.value) + " (" + spreadPct + "% assumed spread)" : "None (same currency)"]]),
          q.legs ? h("p", { class: "small muted" }, "Legs: " + q.legs.map(l => "1 " + l.base + " = " + C.fmtNum(l.rate, 6) + " " + l.quote).join(" · ") + ". Both legs come from the same table and timestamp.") : null,
          ...q.warnings.map(w => h("div", { class: "banner warn" }, h("p", {}, w))),
          [fc, tc].filter(c => c && (c.note || c.type !== "fiat")).map(c => h("div", { class: "banner " + (c.type === "fiat" ? "info" : "warn") }, h("p", {}, c.code + ": " + (c.note || c.type)))),
          h("div", { class: "explain" }, "This is an indicative mid rate. What you can actually exchange depends on your provider's spread and fees, market hours and transfer costs."),
          h("div", { class: "row" }, h("button", { class: "btn ghost sm", type: "button", onclick: () => app.openAsset({ id: "fx:" + mp.base + mp.quote, cls: "fx", base: mp.base, quote: mp.quote, symbol: mp.base + "/" + mp.quote }) }, "Open " + mp.base + "/" + mp.quote + " live page" + (kp ? " (bid/ask, minute charts)" : ""))));
      } catch (e) { out.replaceChildren(U.errorBox(e, run)); }
    };
    for (const el of [amt, from, to]) el.addEventListener("change", run);
    root.append(U.section("Converter", h("div", { class: "stack" }, h("div", { class: "form" }, U.field("Amount", amt), U.field("From", from), U.field("To", to), h("div", { class: "field" }, h("button", { class: "btn ghost", type: "button", onclick: () => { const x = from.value; from.value = to.value; to.value = x; run(); } }, "Swap"))), out)));
    run();
    const listBox = h("div", {});
    root.append(U.section("Every currency against " + R, listBox, [h("button", { class: "btn ghost sm", type: "button", onclick: () => app.go("settings", { tab: "currencies" }) }, "Add a currency")]));
    U.async(listBox, () => app.rates.refresh(), () => {
      const rows = [...app.reg.values()].filter(c => c.code !== R).map(c => { const mp = C.marketPair(c.code, R); const q = app.rates.quote(mp.base, mp.quote); return Object.assign({}, c, { pair: mp.base + "/" + mp.quote, base: mp.base, quote: mp.quote, rate: q ? Number(q.rate) : null, minute: !!D.fx.krakenPair(mp.base, mp.quote) }); });
      listBox.append(U.dataTable([{ t: "Pair", v: (r) => h("strong", {}, r.pair), sort: (r) => r.pair }, { t: "Currency", v: "name", sort: (r) => r.name }, { t: "Type", v: (r) => h("span", { class: "pill" }, r.type), sort: (r) => r.type }, { t: "Rate", v: (r) => r.rate != null ? C.fmtNum(r.rate, r.rate >= 100 ? 2 : r.rate >= 1 ? 4 : 6) : h("span", { class: "faint" }, "unavailable"), sort: (r) => r.rate, n: true },
        { t: "Charts", v: (r) => r.minute ? "Live, minute & daily" : r.ecbHistory || C.ECB_CODES.has(r.base) && C.ECB_CODES.has(r.quote) ? "Live & daily (ECB)" : "Live only", sort: (r) => r.minute ? 2 : r.ecbHistory ? 1 : 0 }, { t: "Notes", v: (r) => h("span", { class: "small" }, r.note || "") }],
        rows, { key: "fx.pairs", sort: [0, 1], noun: "currencies", onRow: (r) => app.openAsset({ id: "fx:" + r.base + r.quote, cls: "fx", base: r.base, quote: r.quote, symbol: r.pair }), placeholder: "Filter by code or name…" }),
        U.status({ status: "Live", source: app.rates.table && app.rates.table.source, ts: app.rates.fetchedAt, note: "Pairs shown in market convention (e.g. EUR/USD, USD/JPY)." }));
    });
  };
  function fxDetail(root, app, ctx, opts) {
    const pair = { base: ctx.base, quote: ctx.quote };
    const asset = { id: "fx:" + pair.base + pair.quote, cls: "fx", base: pair.base, quote: pair.quote, symbol: pair.base + "/" + pair.quote, name: pair.base + "/" + pair.quote };
    const pb = h("select", { "aria-label": "Base" }, opts(pair.base)), pq = h("select", { "aria-label": "Quote" }, opts(pair.quote));
    const go = () => { app.ctx.fx = { id: "fx:" + pb.value + pq.value, cls: "fx", base: pb.value, quote: pq.value, symbol: pb.value + "/" + pq.value }; app.ls.set("ctx", app.ctx); app.rerender(); };
    pb.onchange = go; pq.onchange = go;
    const mpNote = C.marketPair(pair.base, pair.quote);
    let panel = null, quote = null;
    const live = h("div", {}), act = h("div", {}), bidask = h("div", {});
    root.append(app.backBar(), h("div", { class: "row" }, U.field("Base", pb), U.field("Quote", pq), h("button", { class: "btn ghost sm", type: "button", style: "align-self:end", onclick: () => { pb.value = pair.quote; pq.value = pair.base; go(); } }, "Invert")));
    panel = X.chartPanel(asset, { tfs: X.tfsFor(asset), defaultTf: X.tfsFor(asset).includes("1D") ? "1D" : "1M", fmt: (v) => C.fmtNum(v, v >= 20 ? 3 : 5) });
    U.async(live, async () => { await app.rates.refresh(); return app.quote(asset, 0); }, (q) => {
      quote = q;
      live.append(X.quoteHeader(Object.assign({}, q, { clsLabel: "Currency pair", name: pair.base + "/" + pair.quote, symbol: "1 " + pair.base + " in " + pair.quote, kind: "fx", changePct: null }), null, { asset, chartCurrency: pair.quote, onTick: (p, t) => panel.tick(p, t) }),
        mpNote.base !== pair.base ? h("div", { class: "banner info" }, h("p", {}, "Markets usually quote this pair as " + mpNote.base + "/" + mpNote.quote + " (" + C.fmtNum(1 / q.price, 6) + "). " + pair.base + "/" + pair.quote + " is its inverse; don't mix the two.")) : null);
      act.replaceChildren(X.actionBar(asset, () => quote, () => panel && panel.series));
    });
    const kp = D.fx.krakenPair(mpNote.base, mpNote.quote);
    if (kp) U.async(bidask, () => D.kraken.ticker(kp), (t) => bidask.append(U.kv([["Executable bid (Kraken " + kp + ")", C.fmtNum(t.bid, 5)], ["Ask", C.fmtNum(t.ask, 5)], ["Spread", C.fmtNum(C.spreadBps(t.bid, t.ask), 1) + " bps"], ["24h trades", t.trades24 != null ? String(t.trades24) : "—"]]), t.thin ? h("div", { class: "banner warn" }, h("p", {}, "Kraken's book for this pair is thin (" + t.trades24 + " trades in 24h); its bid/ask isn't representative of the wider market.")) : null, U.status({ status: "Live", source: "Kraken order book", ts: t.ts })));
    const chartSec = U.section("Chart", panel.el); chartSec.id = "sec-price";
    root.append(live, act, MD.insights.jumpBar([["sec-price", "Chart"], ["sec-projection", "Projection"], ["sec-technicals", "Technicals"], ["sec-risk", "Risk"], ["sec-position", "Your position"], ["sec-notes", "Notes"]]), chartSec, kp ? U.section("Order book", bidask) : null, MD.insights.panel(asset, { currency: pair.quote }));
    const macro = h("div", {});
    root.append(U.section("Central banks & macro events (next 7 days)", macro, [h("button", { class: "btn ghost sm", type: "button", onclick: () => app.go("calendar") }, "Full calendar")]));
    const COUNTRY = { USD: "United States", EUR: "Euro Zone", GBP: "United Kingdom", JPY: "Japan", CHF: "Switzerland", CAD: "Canada", AUD: "Australia", NZD: "New Zealand", CNY: "China", CNH: "China", INR: "India", BRL: "Brazil", MXN: "Mexico", ZAR: "South Africa", KRW: "South Korea", SEK: "Sweden", NOK: "Norway", TRY: "Turkey", PLN: "Poland", SGD: "Singapore", HKD: "Hong Kong" };
    U.async(macro, async () => { const days = Array.from({ length: 7 }, (_, i) => D.ymd(new Date(Date.now() + i * 864e5))); const res = await Promise.all(days.map(d => D.calendar.economic(d).catch(() => []))); return res.flat(); }, (rows) => {
      const want = [COUNTRY[pair.base], COUNTRY[pair.quote]].filter(Boolean);
      const sel = rows.filter(r => want.some(w => (r.country || "").includes(w.split(" ")[0])));
      macro.append(sel.length ? U.table([{ t: "Date", v: "date" }, { t: "GMT", v: "gmt" }, { t: "Country", v: "country" }, { t: "Event", v: "event" }, { t: "Consensus", v: "consensus", n: true }, { t: "Previous", v: "previous", n: true }, { t: "Actual", v: "actual", n: true }], sel.slice(0, 40)) : h("div", { class: "empty" }, "No scheduled events found for " + (want.join(" or ") || "these currencies") + "."),
        U.status({ status: "Reference", source: "Nasdaq economic calendar" }), h("div", { class: "explain" }, "A higher interest rate doesn't guarantee a stronger currency. Expectations already priced in, inflation, growth, capital flows and policy risk all matter."));
    });
  }

  /* ================= Precious Metals ================= */
  V.metals = function (root, app) {
    const R = app.settings.displayCurrency;
    const cur = app.ctx.metals && app.ctx.metals.cls === "metal" ? app.ctx.metals : null;
    if (cur) return metalDetail(root, app, cur);
    root.append(head("Precious Metals", "Spot benchmarks in USD per troy ounce, converted explicitly into your display currency and weight unit. Click a metal for its live page and chart. Spot is not what a dealer will pay or charge."));
    const spots = h("div", {});
    root.append(U.section("Spot prices", spots));
    U.async(spots, async () => { await app.rates.refresh(); return Promise.all(D.METALS.map(([s]) => D.metals.spot(s).catch(e => ({ symbol: s, error: e })))); }, (qs) => {
      const fxq = app.rates.quote("USD", R);
      spots.append(U.dataTable([{ t: "Metal", v: (q) => q.error ? q.symbol : h("strong", {}, q.symbol + " · " + q.name), sort: (q) => q.symbol },
        { t: "USD / troy oz", v: (q) => q.error ? U.errorText(q.error) : C.fmtNum(q.price, 2), sort: (q) => q.price, n: true },
        { t: R + " / troy oz", v: (q) => q.error || !fxq ? "—" : C.fmtNum(C.convert(q.price, fxq), 2), n: true },
        { t: R + " / gram", v: (q) => q.error || !fxq ? "—" : C.fmtNum(C.convert(q.price, fxq).div(C.GRAMS_PER.toz), 3), n: true },
        { t: R + " / kg", v: (q) => q.error || !fxq ? "—" : C.fmtNum(C.convert(q.price, fxq).times(1000).div(C.GRAMS_PER.toz), 0), n: true },
        { t: "Updated", v: (q) => q.error ? "" : U.fmtTs(q.ts) }], qs, { key: "metals", filter: false, noun: "metals", onRow: (q) => app.openAsset({ id: "metal:" + q.symbol, cls: "metal", symbol: q.symbol, name: q.name || q.symbol }) }),
        U.status({ status: "Live", source: "gold-api.com spot · FX " + (fxq ? fxq.source : "n/a"), note: "Metal-unit conversion (oz → g) and currency conversion (USD → " + R + ") are applied as two separate steps." }),
        (() => { const g = qs.find(q => q.symbol === "XAU"), s = qs.find(q => q.symbol === "XAG"); return g && s && !g.error && !s.error ? h("p", { class: "small muted" }, "Gold/silver ratio: " + (g.price / s.price).toFixed(1) + " (ounces of silver per ounce of gold).") : null; })());
    });
    const uv = h("input", { type: "text", value: "1" }), uf = h("select", {}, Object.keys(C.GRAMS_PER).map(u => h("option", { value: u }, C.UNIT_NAMES[u]))), ut = h("select", {}, Object.keys(C.GRAMS_PER).map(u => h("option", { value: u, selected: u === "g" }, C.UNIT_NAMES[u]))), uo = h("div", { class: "num" });
    const uc = () => { const r = C.convertWeight(uv.value, uf.value, ut.value); uo.textContent = r ? C.fmtNum(r, 6) + " " + C.UNIT_NAMES[ut.value] + (r.eq(1) ? "" : "s") : "Enter a number."; };
    for (const e of [uv, uf, ut]) e.addEventListener("input", uc); uc();
    const b = { qty: h("input", { type: "text", value: "10" }), w: h("input", { type: "text", value: "1" }), unit: h("select", {}, Object.keys(C.GRAMS_PER).map(u => h("option", { value: u }, C.UNIT_NAMES[u]))), purity: h("input", { type: "text", value: "0.9999" }), metal: h("select", {}, D.METALS.map(([s, n]) => h("option", { value: s }, n))), prem: h("input", { type: "text", value: "4" }), spread: h("input", { type: "text", value: String(app.settings.assumptions.metalSpreadPct) }), ship: h("input", { type: "text", value: "0" }), ins: h("input", { type: "text", value: "0" }), stor: h("input", { type: "text", value: "0" }), yrs: h("input", { type: "text", value: "1" }), tax: h("input", { type: "text", value: "0" }) };
    const bo = h("div", { class: "stack" });
    const bc = async () => {
      let q; try { q = await D.metals.spot(b.metal.value); await app.rates.refresh(); } catch (e) { bo.replaceChildren(U.errorBox(e)); return; }
      const fxq = app.rates.quote("USD", R); if (!fxq) { bo.replaceChildren(U.errorBox({ message: "No USD/" + R + " rate." })); return; }
      const spotR = C.convert(q.price, fxq);
      const r = C.bullion({ quantity: b.qty.value, unitWeight: b.w.value, unit: b.unit.value, purity: b.purity.value, spotPerToz: spotR, dealerPremiumPct: b.prem.value, buySellSpreadPct: b.spread.value, shipping: b.ship.value, insurance: b.ins.value, storagePerYear: b.stor.value, years: b.yrs.value, taxPct: b.tax.value });
      if (!r) { bo.replaceChildren(h("div", { class: "err" }, "Check the inputs.")); return; }
      bo.replaceChildren(U.kv([["Fine metal", C.fmtNum(r.fineToz, 4) + " troy oz"], ["Melt value at spot", U.money(r.meltValue, R)], ["Dealer premium", U.money(r.premium, R)], ["Tax", U.money(r.tax, R)], ["All-in purchase cost", U.money(r.acquisition, R)], ["Holding costs", U.money(r.holding, R)], ["Est. sale proceeds today", U.money(r.netLiquidation, R)], ["Break-even spot", U.money(r.breakevenSpot, R, { price: true }) + " / oz"], ["Spot now", U.money(spotR, R, { price: true }) + " / oz"]]),
        h("p", { class: "small muted" }, "Spot " + C.fmtNum(q.price, 2) + " USD/oz (" + q.source + ", " + U.fmtTs(q.ts) + ") × " + C.fmtNum(fxq.rate, 6) + " " + R + "/USD (" + fxq.source + "). Premiums, spreads and taxes are your assumptions."));
    };
    for (const e of Object.values(b)) e.addEventListener("change", bc);
    root.append(h("div", { class: "grid g2" },
      U.section("Weight converter", h("div", { class: "stack" }, h("div", { class: "form" }, U.field("Amount", uv), U.field("From", uf), U.field("To", ut)), uo)),
      U.section("Bullion cost & liquidation calculator", h("div", { class: "stack" }, h("div", { class: "form" }, U.field("Metal", b.metal), U.field("Pieces", b.qty), U.field("Weight per piece", b.w), U.field("Unit", b.unit), U.field("Purity", b.purity), U.field("Dealer premium %", b.prem), U.field("Buy/sell spread %", b.spread), U.field("Shipping (" + R + ")", b.ship), U.field("Insurance (" + R + ")", b.ins), U.field("Storage per year (" + R + ")", b.stor), U.field("Years held", b.yrs), U.field("Tax %", b.tax)), bo))));
    bc();
  };
  function metalDetail(root, app, cur) {
    const metal = { id: "metal:" + cur.symbol, cls: "metal", symbol: cur.symbol, name: (D.METALS.find(m => m[0] === cur.symbol) || [cur.symbol, cur.name || cur.symbol])[1] };
    let q0 = null, panel = null;
    const top = h("div", {}), act = h("div", {});
    root.append(app.backBar(), top, act);
    panel = X.chartPanel(metal, { tfs: X.tfsFor(metal), defaultTf: metal.symbol === "XAU" ? "1H" : "Live" });
    U.async(top, () => app.quote(metal, 10000), (q) => {
      q0 = q;
      top.append(X.quoteHeader(Object.assign({}, q, { clsLabel: "Precious metal", subline: "USD per troy ounce", kind: "metal" }), null, { asset: metal, onTick: (p, t) => panel.tick(p, t) }));
      act.replaceChildren(X.actionBar(metal, () => q0, () => panel.series));
    });
    const mSec = U.section(metal.name + " chart", h("div", { class: "stack" }, panel.el, h("p", { class: "small muted" }, metal.symbol === "XAU" ? "Daily and monthly history (1M and longer) comes from Alpha Vantage. Minute charts and 1W use the PAX Gold token as a labelled proxy. Live charts spot as it updates." : metal.symbol === "XAG" ? "History comes from Alpha Vantage (daily; monthly for 10Y and Max). If Alpha Vantage is unavailable or over its daily limit, up to 1Y falls back to the Kinesis Silver token as a proxy. Live charts spot." : "No free price history for " + metal.name + "; the Live view charts spot as it updates.")));
    mSec.id = "sec-price";
    root.append(MD.insights.jumpBar([["sec-price", "Chart"], ["sec-projection", "Projection"], ["sec-technicals", "Technicals"], ["sec-risk", "Risk"], ["sec-position", "Your position"], ["sec-notes", "Notes"]]), mSec, MD.insights.panel(metal, { currency: "USD" }));
  }

  /* ================= Trading Cards ================= */
  V.cards = function (root, app) {
    const tab = app.ctx.cardsTab || "pokemon";
    const cur = app.ctx.cards && app.ctx.cards.cls ? app.ctx.cards : null;
    if (cur) {
      root.append(app.backBar());
      if (cur.cls === "pokemon") return pokemonView(root, app, cur);
      if (cur.cls === "yugioh") return ygoView(root, app, cur);
      return sportsView(root, app, cur);
    }
    root.append(head("Trading Cards", "Search, then click a card for its prices, legality and demand; ← Back returns to your results. Prices are marketplace reference prices, not verified individual sales, and selling costs are significant."),
      U.tabs([["pokemon", "Pokémon TCG"], ["yugioh", "Yu-Gi-Oh! TCG"], ["sports", "Sports cards"]], tab, (k) => { app.ctx.cardsTab = k; app.rerender(); }));
    if (tab === "pokemon") pokemonView(root, app, null); else if (tab === "yugioh") ygoView(root, app, null); else sportsView(root, app, null);
  };
  function cardSearch(root, app, placeholder, searchFn, cls, examples) {
    const input = h("input", { type: "search", placeholder });
    const res = h("div", {});
    const run = () => { const q = input.value.trim(); if (q.length < 2) return; app.ls.set("cardq." + cls, q); U.async(res, () => searchFn(q), (list) => res.append(list.length ? h("div", { class: "stack" }, h("div", { class: "grid g-auto" }, list.slice(0, 24).map(c => h("button", { class: "tile", type: "button", onclick: () => app.openAsset(X.slim(c)) }, c.image ? MD.cards.thumb(c.image, c.name) : null, h("strong", {}, c.name), h("span", { class: "s faint" }, c.sub || c.symbol)))), h("span", { class: "tiny muted" }, list.length + " cards · click one to open it")) : h("div", { class: "empty" }, "No cards match."))); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
    input.value = app.ls.get("cardq." + cls, examples || "");
    root.append(U.section("Search", h("div", { class: "stack" }, h("div", { class: "row" }, input, h("button", { class: "btn", type: "button", onclick: run }, "Search")), res)));
    if (input.value) run();
  }
  function priceTable(rows, R) {
    return U.table([{ t: "Source", v: "source" }, { t: "Measure", v: "measure" }, { t: "Price", v: (r) => U.money(r.value, r.currency, { price: true }), n: true }, { t: "≈ " + R + " (today's rate)", v: (r) => { const q = MD.app.rates.quote(r.currency, R); return q ? U.money(C.convert(r.value, q), R, { price: true }) : "—"; }, n: true }, { t: "Updated", v: (r) => r.updated ? U.fmtDate(r.updated) : "—" }], rows);
  }
  function pokemonView(root, app, cur) {
    if (!cur) { cardSearch(root, app, "Card name, e.g. Charizard ex, Iono, Gardevoir", D.pokemon.search, "pokemon", "Charizard ex"); root.append(h("div", { class: "banner info" }, h("p", {}, "Legality comes from TCGdex's mirror of the official rules. Confirm format changes on pokemon.com before acting; rotation and ban speculation is not treated as fact here."))); return; }
    const box = h("div", {});
    root.append(box);
    U.async(box, async () => { await app.rates.refresh().catch(() => {}); return D.pokemon.card(cur.tcgdexId || cur.id.slice(4)); }, (c) => {
      const R = app.settings.displayCurrency;
      const asset = { id: c.id, cls: "pokemon", tcgdexId: c.tcgdexId, symbol: c.symbol, name: c.name + (c.set ? " (" + c.set + ")" : ""), currency: "USD" };
      const rows = []; for (const v of c.variants) for (const p of v.prices) for (const [m, val] of p.values) rows.push({ source: p.source + (c.variants.length > 1 ? " · " + v.type : ""), measure: m, value: val, currency: p.currency, updated: p.updated });
      const cm = c.variants.flatMap(v => v.prices).find(p => p.source === "Cardmarket");
      const val = (k) => cm && (cm.values.find(x => x[0] === k) || [])[1];
      const a1 = val("1-day avg"), a7 = val("7-day avg"), a30 = val("30-day avg");
      const momentum = a7 && a30 ? (a7 / a30 - 1) * 100 : null;
      const usageBox = h("div", { class: "stack" });
      let q0 = null; app.quote(asset).then(q => q0 = q).catch(() => {});
      box.append(U.section(c.name, h("div", { class: "grid g2 cardgrid" },
        MD.cards.cardVisual(app, "pokemon", c, c.id, c.imageFull || c.image),
        h("div", { class: "stack" },
          U.kv([["Set", (c.set || "—") + " · " + (c.localId || "") + "/" + (c.setCount ? c.setCount.official : "?")], ["Rarity", c.rarity || "—"], ["Regulation mark", c.regulationMark || "—"], ["Standard", c.legal.standard ? "Legal" : "Not legal", c.legal.standard ? "up" : "down"], ["Expanded", c.legal.expanded ? "Legal" : "Not legal", c.legal.expanded ? "up" : "down"], ["Category", [c.category, c.stage, c.hp ? c.hp + " HP" : null].filter(Boolean).join(" · ")], ["Illustrator", c.illustrator || "—"]]),
          h("p", { class: "small muted" }, "Legality per TCGdex (", h("a", { href: "https://www.pokemon.com/us/play-pokemon/about/tournaments-rules-and-resources", target: "_blank", rel: "noopener noreferrer" }, "official rules"), "). Standard rotates by regulation mark each year."),
          X.actionBar(asset, () => q0, () => null)))),
        U.section("Reference prices", h("div", { class: "stack" }, rows.length ? priceTable(rows, R) : h("div", { class: "empty" }, "No marketplace prices for this card."),
          momentum != null ? U.kv([["Cardmarket 7-day vs 30-day average", U.pct(momentum), U.signCls(momentum)], ["1-day vs 7-day", a1 ? U.pct((a1 / a7 - 1) * 100) : "—"]]) : null,
          U.status({ status: "Reference", source: "TCGdex (Cardmarket EUR, TCGplayer USD)", note: "Converted at today's rate for comparison only; this is not the historical value of any past sale." }),
          h("div", { class: "explain" }, "Selling a card typically costs " + app.settings.assumptions.cardFeePct + "% in marketplace fees plus shipping, and condition changes value a lot. Reference prices are for near-mint raw copies unless marked otherwise."))),
        MD.cards.salesSection(app, { kind: "pokemon", name: c.name, number: c.localId, set: c.set, assetId: c.id }),
        buybackSection(app, "pokemon", { name: c.name, set: c.set, number: c.localId }),
        U.section("Competitive demand", h("div", { class: "stack" }, usageBox, h("button", { class: "btn ghost sm", type: "button", onclick: () => U.async(usageBox, () => D.pokemon.usage(c.name, 3), (u) => {
          const signal = u.inclusionPct != null && momentum != null ? (u.inclusionPct >= 15 && momentum < -5 ? "Usage is high while price trends down: possible price-to-demand divergence. Check for a reprint or rotation first." : u.inclusionPct < 3 && momentum > 10 ? "Price is rising without competitive usage: likely collector or hype demand." : "No clear divergence between usage and price.") : null;
          usageBox.append(U.kv([["Decks including it", u.withCard + " of " + u.decks + (u.inclusionPct != null ? " (" + u.inclusionPct.toFixed(1) + "%)" : "")], ["Average copies", u.avgCopies ? u.avgCopies.toFixed(2) : "—"], ["Top archetypes", u.archetypes.map(a => a[0] + " (" + a[1] + ")").join(", ") || "—"]]),
            signal ? h("div", { class: "banner info" }, h("p", {}, signal)) : null,
            h("p", { class: "small muted" }, "From " + u.tournaments.map(t => t.name + " (" + t.players + " players, " + U.fmtDate(t.date) + ")").join("; ") + ". " + u.source + "; not official Play! Pokémon events. Exact card-name match."));
        }, { loading: "Reading decklists from recent tournaments…" }) }, "Check tournament usage"))));
    });
  }
  function ygoView(root, app, cur) {
    if (!cur) cardSearch(root, app, "Card name, e.g. Ash Blossom, Maxx C, Snake-Eyes", D.ygo.search, "yugioh", "Ash Blossom");
    const banBox = h("div", {});
    if (cur) {
      const box = h("div", {}); root.append(box);
      U.async(box, async () => { await app.rates.refresh().catch(() => {}); return D.ygo.card(cur.ygoId || cur.id.split(":")[1]); }, (c) => {
        const R = app.settings.displayCurrency;
        const asset = { id: c.id, cls: "yugioh", ygoId: c.ygoId, symbol: c.symbol, name: c.name, currency: "USD" };
        let q0 = null; app.quote(asset).then(q => q0 = q).catch(() => {});
        const banCls = (s) => s === "Forbidden" ? "down" : s === "Unlimited" ? "up" : "warn-t";
        box.append(U.section(c.name, h("div", { class: "grid g2 cardgrid" },
          MD.cards.cardVisual(app, "yugioh", c, c.id, c.imageFull || c.image),
          h("div", { class: "stack" }, U.kv([["Type", c.type], ["Archetype", c.archetype || "—"], ["TCG status", c.ban.tcg, banCls(c.ban.tcg)], ["OCG status", c.ban.ocg, banCls(c.ban.ocg)], ["Printings", String(c.sets.length)]]),
            h("p", { class: "small muted" }, "Ban status mirrored by YGOPRODeck. TCG and OCG lists are separate. Confirm on the ", h("a", { href: "https://www.yugioh-card.com/en/limited/", target: "_blank", rel: "noopener noreferrer" }, "official Forbidden & Limited List"), "."),
            c.desc ? h("details", {}, h("summary", { class: "small" }, "Card text"), h("p", { class: "small" }, c.desc)) : null,
            X.actionBar(asset, () => q0, () => null)))),
          U.section("Reference prices (card-level)", h("div", { class: "stack" }, c.prices.length ? priceTable(c.prices.map(p => ({ source: p.source, measure: "Lowest/market", value: p.value, currency: p.currency })), R) : h("div", { class: "empty" }, "No prices."),
            U.status({ status: "Reference", source: "YGOPRODeck", note: "Card-level, not printing- or condition-specific. Rarity and edition change value substantially." }))),
          MD.cards.salesSection(app, { kind: "yugioh", name: c.name, printings: c.sets, assetId: c.id }),
          U.section("Printings & rarities", U.table([{ t: "Set", v: "set" }, { t: "Code", v: "code" }, { t: "Rarity", v: "rarity" }], c.sets)),
          buybackSection(app, "yugioh", { name: c.name }));
      });
    }
    if (cur) return;
    root.append(U.section("Current TCG Forbidden & Limited list", banBox, [h("a", { class: "btn ghost sm", href: "https://www.yugioh-card.com/en/limited/", target: "_blank", rel: "noopener noreferrer" }, "Official list")]));
    U.async(banBox, () => D.ygo.banlist("tcg", 400), (list) => banBox.append(U.table([{ t: "Card", v: "name" }, { t: "Status", v: (r) => h("span", { class: r.status === "Forbidden" ? "down" : "warn-t" }, r.status) }, { t: "Type", v: "type" }, { t: "Archetype", v: "archetype" }], list, { onRow: (r) => app.openAsset({ id: "ygo:" + r.id, cls: "yugioh", ygoId: r.id, name: r.name, symbol: r.id }) }), U.status({ status: "Reference", source: "YGOPRODeck mirror of Konami's list" })), { loading: "Loading list…" });
  }
  /* ---------- sports cards: CardChain AI search & detail; custom cards and collectibles ---------- */
  function sportsView(root, app, sel) {
    if (sel && sel.cardchainId) return sportsCardDetail(root, app, sel);
    const assets = app.store.cached("assets").filter(a => a.cls === "sports" || a.cls === "manual");
    const cur = sel ? assets.find(a => a.id === sel.id) : null;
    if (sel && !cur) { root.append(h("div", { class: "empty" }, "That card isn't in your collection any more.")); return; }
    if (cur) {
      root.append(U.section(cur.name, h("div", { class: "grid g2 cardgrid" },
        MD.cards.cardVisual(app, "sports", { name: cur.name, player: cur.player, set: [cur.year, cur.cls === "manual" ? "Collectible" : ""].filter(Boolean).join(" · "), grade: cur.grade || "Raw" }, cur.id, null),
        h("div", { class: "stack" }, U.kv([["Kind", cur.cls === "manual" ? "Other collectible" : "Sports card"], ["Player / subject", cur.player || "—"], ["Year", cur.year || "—"], ["Grade", cur.grade || "—"], ["Valued in", cur.currency || "USD"]]),
          h("div", { class: "row" }, h("button", { class: "btn ghost sm", type: "button", onclick: () => X.txModal(Object.assign({}, cur)) }, "Add to portfolio"), h("button", { class: "btn ghost sm", type: "button", onclick: () => app.go("research", { asset: { id: cur.id, cls: cur.cls, symbol: cur.symbol, name: cur.name } }) }, "Research it"))))),
        MD.cards.salesSection(app, { kind: cur.cls === "manual" ? "other" : "sports", name: cur.name, grade: cur.grade, assetId: cur.id, valueAsset: cur }));
      return;
    }
    sportsSearch(root, app);
    root.append(U.section("Your custom cards & collectibles", h("div", { class: "stack" },
      h("p", { class: "small muted" }, "For cards CardChain AI doesn't cover, or other collectibles, create a custom asset. Market Desk finds its sold listings on PriceCharting / SportsCardsPro, and you can value it at the median sale."),
      U.table([{ t: "Name", v: "name" }, { t: "Player / subject", v: "player" }, { t: "Year", v: "year" }, { t: "Grade", v: "grade" }, { t: "Valued", v: (a) => { const cs = app.store.cached("comps").filter(c => c.assetId === a.id).sort((x, y) => (y.date || "").localeCompare(x.date || "")); return cs[0] ? U.money(cs[0].price, cs[0].currency) + " · " + U.fmtDate(cs[0].date) : "not yet"; }, n: true }], assets, { onRow: (a) => app.openAsset({ id: a.id, cls: a.cls, symbol: a.symbol, name: a.name }), empty: "No custom cards yet." }),
      h("div", { class: "row" }, h("button", { class: "btn ghost", type: "button", onclick: () => X.customAssetModal((a) => app.openAsset({ id: a.id, cls: a.cls, symbol: a.symbol, name: a.name })) }, "Add a custom card")))));
  }
  function sportsSearch(root, app) {
    const saved = app.ls.get("ccSearch", { q: "2018 Prizm Luka Doncic", grade: "Raw", sport: "" });
    const input = h("input", { type: "search", placeholder: "Player, year, set, card number, parallel…", value: saved.q, "aria-label": "Search sports cards" });
    const grade = h("select", { "aria-label": "Grade" }, D.cardchain.GRADES.map(g => h("option", { value: g, selected: g === saved.grade }, g)));
    const sport = h("select", { "aria-label": "Sport" }, [["", "All sports"]].concat(D.cardchain.SPORTS.map(x => [x, x])).map(([v, l]) => h("option", { value: v, selected: v === saved.sport }, l)));
    const res = h("div", {});
    const thumb = (c) => c.image ? MD.cards.thumb(c.image, c.name) : null;
    const cols = [{ t: "Card", v: (c) => h("span", { class: "row", style: "gap:10px;flex-wrap:nowrap" }, thumb(c), h("span", { class: "stack", style: "gap:0" }, h("strong", {}, c.name), h("span", { class: "small muted" }, c.set || ""))), sort: (c) => c.name },
      { t: "Price", v: (c) => c.price ? U.money(c.price, "USD", { price: true }) : h("span", { class: "faint" }, "no price"), sort: (c) => c.price, n: true },
      { t: "Average", v: (c) => c.avgPrice ? U.money(c.avgPrice, "USD", { price: true }) : "—", sort: (c) => c.avgPrice, n: true },
      { t: "Price points", v: (c) => String(c.history.length), sort: (c) => c.history.length, n: true },
      { t: "Latest point", v: (c) => c.lastPoint ? U.fmtDate(c.lastPoint) : "—", sort: (c) => c.lastPoint || 0 }];
    const run = () => {
      const q = input.value.trim(); if (q.length < 2) return;
      app.ls.set("ccSearch", { q, grade: grade.value, sport: sport.value });
      cols[1].t = grade.value + " price";
      U.async(res, () => D.cardchain.search(q, grade.value, sport.value || undefined), (list) => {
        res.append(list.length ? U.dataTable(cols, list, { key: "cc.search", filter: false, noun: "cards", onRow: (c) => app.openAsset(X.slim(c)) }) : h("div", { class: "empty" }, "CardChain AI found no cards for that search. Add the year, set or card number."),
          U.status({ status: "Reference", source: "CardChain AI (" + grade.value + ")", note: "Top 5 matches. Click a card for its price history." }));
      }, { loading: "Searching CardChain AI…" });
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
    grade.addEventListener("change", run); sport.addEventListener("change", run);
    root.append(U.section("Search sports cards · CardChain AI", h("div", { class: "stack" },
      h("div", { class: "row" }, input, sport, grade, h("button", { class: "btn", type: "button", onclick: run }, "Search")), res,
      h("p", { class: "small muted" }, "Prices are CardChain AI's market estimates from recent sales for the chosen grade, in USD. They aren't individually verified sales; check recent sold listings before buying or selling."))));
    run();
  }
  function sportsCardDetail(root, app, sel) {
    const R = app.settings.displayCurrency;
    const grades = h("div", { class: "seg", role: "group", "aria-label": "Grade", style: "align-self:start" });
    const top = h("div", {}), chartBox = h("div", {}), act = h("div", {});
    root.append(top, act, U.section("CardChain AI price points", chartBox));
    grades.append(...D.cardchain.GRADES.map(g => h("button", { type: "button", class: g === (sel.grade || "Raw") ? "on" : "", "aria-pressed": String(g === (sel.grade || "Raw")), onclick: () => { if (g !== sel.grade) app.openAsset(Object.assign({}, sel, { id: sel.id.replace(/-[^-]+$/, "-" + g.replace(/\s+/g, "").toLowerCase()), grade: g }), { noBack: true }); } }, g)));
    U.async(top, async () => { await app.rates.refresh().catch(() => {}); return D.cardchain.card(sel); }, (c) => {
      const asset = X.slim(Object.assign({}, sel, { name: c.name, symbol: c.symbol, currency: "USD", grade: c.grade }));
      const q = { id: asset.id, cls: "sports", symbol: c.symbol, name: c.name, price: c.price, currency: "USD", ts: c.lastPoint, status: "Reference", source: "CardChain AI market price (" + c.grade + ")" };
      const fxq = app.rates.quote("USD", R);
      const first = c.history[0], last = c.history[c.history.length - 1];
      const chgPct = first && last && first !== last ? (last.value / first.value - 1) * 100 : null;
      top.append(h("div", { class: "grid g2 cardgrid" },
        MD.cards.cardVisual(app, "sports", { name: c.name, player: c.player, set: c.set, grade: c.grade, parallel: c.parallel }, "cc-" + sel.cardchainId, c.image),
        h("div", { class: "stack" },
          h("span", { class: "pill", style: "align-self:start" }, "Sports card"), h("h1", { class: "page" }, c.name), h("p", { class: "sub" }, [c.set, c.player].filter(Boolean).join(" · ")),
          h("div", { class: "num price-big" }, c.price ? U.money(c.price, "USD", { price: true }) : "No " + c.grade + " price"),
          fxq && R !== "USD" && c.price ? h("span", { class: "small muted" }, "≈ " + U.money(C.convert(c.price, fxq), R, { price: true }) + " at today's rate") : null,
          U.kv([["Grade", c.grade], ["CardChain average", c.avgPrice ? U.money(c.avgPrice, "USD", { price: true }) : "—"], ["Price points", c.history.length + (first ? " since " + U.fmtDate(first.time * 1000) : "")], ["Change over those points", chgPct != null ? U.pct(chgPct) : "—", U.signCls(chgPct)]]),
          U.status({ status: "Reference", source: "CardChain AI", ts: c.lastPoint, note: "Market estimate for " + c.grade + "; not a verified sale." }),
          h("div", { class: "stack", style: "gap:4px" }, h("span", { class: "label" }, "Grade"), grades))));
      act.replaceChildren(X.actionBar(asset, () => q, () => null));
      if (c.history.length >= 2) {
        const cb = h("div", { class: "chartbox sm" });
        chartBox.append(cb, h("p", { class: "small muted" }, c.history.length + " CardChain AI price points for " + c.grade + ", in USD. Gaps are days without a recorded sale."));
        U.chart(cb, { kind: "line", points: c.history, intraday: false }, { fmt: (v) => "$" + C.fmtNum(v, 2) });
      } else chartBox.append(h("div", { class: "empty" }, "Not enough " + c.grade + " price points to chart. Try another grade."));
      root.append(MD.cards.salesSection(app, { kind: "sports", name: c.name, grade: c.grade, assetId: "cc-" + sel.cardchainId }));
    }, { loading: "Loading from CardChain AI…" });
  }
  /* ---------- dealer buyback offer (karten-ankauf.de), looked up only on request ---------- */
  function buybackSection(app, game, card) {
    const R = app.settings.displayCurrency;
    const cond = h("select", { "aria-label": "Condition" }, D.dealer.CONDITIONS.map(([k, l]) => h("option", { value: k, selected: k === "NM" }, l + " (" + k + ")")));
    const lang = h("select", { "aria-label": "Language" }, (game === "pokemon" ? [["en", "English"], ["de", "German"], ["jp", "Japanese"]] : [["en", "English"], ["de", "German"]]).map(([k, l]) => h("option", { value: k }, l)));
    const rev = h("input", { type: "checkbox" }), first = h("input", { type: "checkbox" });
    const out = h("div", { class: "stack" });
    const showPrice = (pr) => U.async(out, () => D.dealer.price(pr.productId, { condition: cond.value, language: lang.value, reverse_holo: rev.checked, first_edition: first.checked }).then(x => Object.assign(x, { printing: pr })), (x) => {
      const fxq = app.rates.quote(x.currency, R);
      const assumed = [x.assumed.condition_assumed ? "condition" : null, x.assumed.language_assumed ? "language" : null].filter(Boolean);
      out.append(
        h("div", { class: "row", style: "align-items:baseline;gap:12px" }, h("div", { class: "num price-big" }, x.price > 0 ? U.money(x.price, x.currency, { price: true }) : "Bulk only"), fxq && x.price > 0 && x.currency !== R ? h("span", { class: "small muted" }, "≈ " + U.money(C.convert(x.price, fxq), R, { price: true })) : null),
        U.kv([["Printing", [x.set, x.number].filter(Boolean).join(" · ")], ["Condition", (x.assumed.condition || cond.value) + (x.assumed.condition_assumed ? " (assumed)" : "")], ["Language", (x.assumed.language || lang.value) + (x.assumed.language_assumed ? " (assumed)" : "")], ["Prices valid until", x.validUntil ? U.fmtTs(Date.parse(x.validUntil + (/Z|[+-]\d\d:?\d\d$/.test(x.validUntil) ? "" : "+01:00"))) : "—"]]),
        Object.keys(x.byCondition).length ? U.table([{ t: "Condition", v: (r) => r.l + " (" + r.k + ")" }, { t: "Buyback (" + x.currency + ")", v: (r) => r.v > 0 ? U.money(r.v, x.currency, { price: true }) : "bulk", n: true }], D.dealer.CONDITIONS.filter(([k]) => x.byCondition[k] != null).map(([k, l]) => ({ k, l, v: x.byCondition[k] }))) : null,
        x.url && /^https:\/\//.test(x.url) ? h("div", { class: "row" }, h("a", { class: "btn ghost sm", href: x.url, target: "_blank", rel: "noopener noreferrer" }, "Open this offer on karten-ankauf.de ↗")) : null,
        h("div", { class: "banner info" }, h("p", {}, "One dealer's indicative buyback offer, not market value. karten-ankauf.de checks condition and authenticity when the card arrives and confirms the payout after that check." + (assumed.length ? " The dealer assumed the " + assumed.join(" and ") + "." : "") + (x.price > 0 ? "" : " A price of 0 means this printing is only bought as bulk."))));
    }, { loading: "Asking karten-ankauf.de…" });
    const picker = (list, why) => { out.replaceChildren(h("p", { class: "small" }, why), U.table([{ t: "Printing", v: (r) => r.name }, { t: "Set", v: (r) => [r.set, r.setCode].filter(Boolean).join(" · ") }, { t: "No.", v: "number" }, { t: "Released", v: (r) => r.released || "—" }], list.slice(0, 30), { onRow: (r) => showPrice(r) })); };
    const run = async () => {
      out.replaceChildren(h("div", { class: "skeleton" }, "Finding the printing on karten-ankauf.de…"));
      try {
        const n = parseInt(card.number, 10);
        let list = [], match = [];
        if (game === "pokemon") {
          list = await D.dealer.search(card.name, game, card.set, null);
          match = list.filter(x => parseInt(x.number, 10) === n);
          if (!match.length && card.number) { const l2 = await D.dealer.search(card.name, game, null, card.number); if (l2.length) list = l2; match = l2.filter(x => parseInt(x.number, 10) === n); }
          const exactSet = match.filter(x => String(x.set || "").toLowerCase() === String(card.set || "").toLowerCase());
          if (exactSet.length === 1 || match.length === 1) return showPrice(exactSet[0] || match[0]);
          if (match.length) return picker(match, "More than one printing matches. Pick yours:");
        } else {
          list = await D.dealer.search(card.name, game, null, null);
          if (list.length === 1) return showPrice(list[0]);
        }
        if (!list.length) { out.replaceChildren(h("div", { class: "empty" }, "karten-ankauf.de doesn't list this card.")); return; }
        picker(list, game === "pokemon" ? "No printing matched this set and number exactly. Pick yours:" : "Pick your printing:");
      } catch (e) { out.replaceChildren(U.errorBox(e, run)); }
    };
    return U.section("Dealer buyback offer · karten-ankauf.de", h("div", { class: "stack" },
      h("p", { class: "small muted" }, "What one German dealer would pay you for this card today, in EUR. Looked up only when you press the button; the dealer logs each lookup."),
      h("div", { class: "form" }, U.field("Condition", cond), U.field("Language", lang), game === "pokemon" ? h("label", { class: "chk" }, rev, "Reverse holo") : null, h("label", { class: "chk" }, first, "1st edition")),
      h("div", { class: "row" }, h("button", { class: "btn ghost", type: "button", onclick: run }, "Check buyback offer")), out));
  }

  MD.marketsHelpers = { quoteTile, quoteGrid, head };
})(typeof window !== "undefined" ? window : globalThis);
