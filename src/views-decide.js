/* Decision views: Dashboard, Portfolio, Opportunities, Strategies & Backtesting, Calendar & Catalysts. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const C = MD.core, U = MD.ui, D = MD.data, h = U.h, X = MD.common;
  const V = (MD.views = MD.views || {});
  const head = (...a) => MD.marketsHelpers.head(...a);
  const CLS_LABEL = { stock: "Stocks", etf: "ETFs", crypto: "Crypto", metal: "Precious metals", cash: "Cash & FX", pokemon: "Pokémon cards", yugioh: "Yu-Gi-Oh! cards", sports: "Sports cards", manual: "Other collectibles", fx: "FX" };
  const RISK_CAT = { stock: "Equity", etf: "Equity", crypto: "Crypto (high volatility)", metal: "Real asset", cash: "Cash", pokemon: "Illiquid collectible", yugioh: "Illiquid collectible", sports: "Illiquid collectible", manual: "Illiquid collectible" };
  const DEFAULT_BETAS = { stock: { equities: 1 }, etf: { equities: 1 }, crypto: { crypto: 1, equities: 0.3 }, metal: { gold: 1 }, cash: {}, pokemon: { collectibles: 1 }, yugioh: { collectibles: 1 }, sports: { collectibles: 1 }, manual: { collectibles: 1 } };
  const marketable = (cls) => ["stock", "etf", "crypto", "metal"].includes(cls);

  /* ================= Portfolio ================= */
  V.portfolio = function (root, app) {
    const R = app.ls.get("tempReporting", null) || app.settings.reportingCurrency;
    const rsel = h("select", { "aria-label": "Reporting currency", style: "width:auto" }, [...app.reg.values()].filter(c => c.type === "fiat" || c.type === "metal").map(c => h("option", { value: c.code, selected: c.code === R }, c.code)));
    rsel.onchange = () => { app.ls.set("tempReporting", rsel.value === app.settings.reportingCurrency ? null : rsel.value); app.rerender(); };
    root.append(head("Portfolio", "One ledger across every asset class. Original transactions keep their currency, date and exchange rate; reporting values are converted for display only.", [
      h("label", { class: "row" }, h("span", { class: "label" }, "Report in"), rsel),
      R !== app.settings.reportingCurrency ? h("button", { class: "btn ghost sm", type: "button", onclick: () => { app.saveSettings({ reportingCurrency: R }); app.ls.set("tempReporting", null); app.rerender(); } }, "Make " + R + " the default") : null,
      h("button", { class: "btn", type: "button", onclick: () => X.txModal(null) }, "Add transaction"),
      h("button", { class: "btn ghost", type: "button", onclick: () => importModal(app) }, "Import CSV")]));
    const sum = h("div", {}), hold = h("div", {}), alloc = h("div", {}), risk = h("div", {}), ledger = h("div", {}), analysis = h("div", { class: "stack", style: "gap:18px" });
    const anSec = U.section("Portfolio analysis · " + R, analysis); anSec.id = "sec-analysis";
    const taxBox = h("div", { class: "stack" }), taxSec = U.section("Realized gains and dividends by year · " + R, taxBox); taxSec.id = "sec-tax";
    // Realized gains split short-term / long-term by each lot's holding period (FIFO), and dividends, at each date's rate.
    const paintTax = (pv) => {
      const ys = C.taxYears(pv.rows.map(r => r.p), pv.rateOf), m = (x) => h("span", { class: "num " + U.signCls(Number(x)) }, U.money(x, R, { sign: true }));
      taxBox.replaceChildren(!ys.length ? h("div", { class: "empty" }, "No sales or dividends recorded yet.") : U.table([{ t: "Year", v: "year" }, { t: "Short-term gains", v: (y) => m(y.shortTerm), n: true }, { t: "Long-term gains", v: (y) => m(y.longTerm), n: true }, { t: "Total realized", v: (y) => m(y.shortTerm.plus(y.longTerm)), n: true }, { t: "Dividends", v: (y) => U.money(y.dividends, R), n: true }, { t: "Sales", v: "sales", n: true }],
          ys.map(y => Object.assign({}, y, { _cls: y.unknownRates ? "warn" : "" }))),
        ys.some(y => y.unknownRates) ? h("p", { class: "small warn-t" }, ys.filter(y => y.unknownRates).map(y => y.year + ": " + y.unknownRates + " item" + (y.unknownRates > 1 ? "s" : "") + " left out (no exchange rate for the date)").join("; ") + ".") : null,
        h("p", { class: "tiny muted" }, "Short-term = shares held a year or less, long-term = more than a year, matched first-in first-out after fees. Converted at each date's reference rate. A summary to check against your broker's tax statements, not tax advice: wash sales, lot choices and local rules aren't applied."));
    };
    root.append(sum, U.section("Holdings · " + R, hold), h("div", { class: "grid g2" }, U.section("Allocation", alloc), U.section("Risk & currency exposure", risk)), anSec, MD.sentiment ? MD.sentiment.section(app) : null, taxSec, U.section("Transaction ledger", ledger, [h("button", { class: "btn ghost sm", type: "button", onclick: () => U.download("market-desk-transactions.csv", C.txsToCSV(app.store.cached("tx"))) }, "Export CSV")]));
    const draw = () => U.async(sum, () => app.valuePortfolio(R), (pv) => {
      const t = pv.totals;
      try { paintTax(pv); } catch (e) { taxBox.replaceChildren(h("p", { class: "small warn-t" }, U.errorText(e))); }
      sum.append(h("div", { class: "grid g4" },
        tileKV("Market value", U.money(t.valueR, R), pv.missing.length ? pv.missing.length + " holding(s) without a price" : "All holdings priced"),
        tileKV("Unrealized P&L", h("span", { class: U.signCls(t.pnlR) }, U.money(t.pnlR, R, { sign: true })), "Price " + U.money(t.priceEffectR, R, { sign: true }) + " · FX " + U.money(t.fxEffectR, R, { sign: true })),
        tileKV("Realized P&L", h("span", { class: U.signCls(t.realizedR) }, U.money(t.realizedR, R, { sign: true })), "Closed lots, at sale-date rates"),
        tileKV("Est. net liquidation", U.money(t.netLiq, R), "After est. exit costs of " + U.money(t.exitCosts, R))),
        pv.estimatedBasis ? h("div", { class: "banner warn" }, h("p", {}, "Some cost bases are estimated: a historical exchange rate wasn't available for at least one lot (the ECB doesn't publish that currency), so today's rate was used and its FX effect shows as zero. Record the rate you got on the transaction to fix this.")) : null,
        pv.issues.length ? h("div", { class: "banner err" }, h("p", {}, pv.issues.map(i => i.msg).join(" "))) : null,
        h("div", { class: "explain" }, "P&L in " + R + " splits exactly into a price effect (the asset's move in its own currency, valued at today's rate) and an FX effect (how much the currency moved between each purchase date and today). Est. net liquidation subtracts the exit-cost assumptions in Settings."));
      const total = Number(t.valueR) || 1;
      const rows = pv.rows.filter(r => r.p.qty.gt(0));
      MD.portfolioAnalysis.render(analysis, app, pv, R);
      hold.replaceChildren(rows.length ? U.table([
        { t: "Asset", v: (r) => h("div", { class: "stack", style: "gap:0" }, h("strong", {}, r.p.symbol), h("span", { class: "small muted" }, r.p.name)) },
        { t: "Class", v: (r) => CLS_LABEL[r.p.assetClass] || r.p.assetClass },
        { t: "Quantity", v: (r) => C.fmtNum(r.p.qty, r.p.qty.gte(100) ? 2 : 6) + " " + (r.p.unit === "unit" ? "" : r.p.unit), n: true },
        { t: "Price", v: (r) => r.q ? h("div", { class: "stack", style: "gap:0;justify-items:end" }, U.money(r.q.price, r.q.currency, { price: true }), h("span", { class: "st " + (r.q.status || "Live") }, r.q.status || "Live")) : h("span", { class: "down small" }, r.err || "—"), n: true },
        { t: "Value (native)", v: (r) => r.v.valueN ? U.money(r.v.valueN, r.p.currency) : "—", n: true },
        { t: "P&L native", v: (r) => r.v.pnlPctN != null ? U.chg(r.v.pnlPctN) : "—", n: true },
        { t: "Value " + R, v: (r) => r.v.valueR ? U.money(r.v.valueR, R) : "—", n: true },
        { t: "P&L " + R, v: (r) => r.v.pnlR ? h("span", { class: "num " + U.signCls(r.v.pnlR) }, U.money(r.v.pnlR, R, { sign: true })) : "—", n: true },
        { t: "of which FX", v: (r) => r.v.fxEffectR && r.p.currency !== R ? h("span", { class: "num " + U.signCls(r.v.fxEffectR), title: r.v.costBasisStatus === "estimated" ? "Estimated: missing historical rate" : "" }, U.money(r.v.fxEffectR, R, { sign: true }) + (r.v.costBasisStatus === "estimated" ? "*" : "")) : "—", n: true },
        { t: "Weight", v: (r) => r.v.valueR ? (Number(r.v.valueR) / total * 100).toFixed(1) + "%" : "—", n: true },
        { t: "Net liquidation", v: (r) => r.nl ? h("span", { title: r.exit.label }, U.money(r.nl.net, R)) : "—", n: true }
      ], rows, { onRow: (r) => positionModal(app, r, R) }) : h("div", { class: "empty" }, "No holdings yet. Add a transaction or import a CSV.", h("button", { class: "btn sm", type: "button", onclick: () => X.txModal(null) }, "Add transaction")),
      h("p", { class: "small muted" }, "Rates: " + (pv.ratesSource || "unavailable") + (pv.ratesAt ? ", " + U.fmtTs(pv.ratesAt) : "") + ". Collectible and metal values are reference prices; what you'd realize is the net liquidation estimate."));
      const items = rows.filter(r => r.v.valueR).map(r => ({ symbol: r.p.symbol, assetClass: r.p.assetClass, value: r.v.valueR, cls: CLS_LABEL[r.p.assetClass] || r.p.assetClass, currency: r.p.currency, country: r.country, liquidity: r.liquidity, risk: RISK_CAT[r.p.assetClass] || "Other", sector: r.p.meta && r.p.meta.sector || (r.p.assetClass === "stock" ? "Unclassified" : CLS_LABEL[r.p.assetClass]) }));
      const dims = [["cls", "Asset class"], ["sector", "Sector"], ["currency", "Currency"], ["country", "Listing / region"], ["liquidity", "Liquidity"], ["risk", "Risk category"]];
      const dim = app.ls.get("allocDim", "cls");
      // Sectors for stock holdings come from Nasdaq's summary (NYSE and Nasdaq listings), cached for a week.
      let sectorsReady = false;
      const loadSectors = async () => {
        const cache = app.ls.get("sectors", {}), fresh = (k) => cache[k] && Date.now() - cache[k].at < 7 * 864e5;
        await Promise.all(items.filter(it => it.assetClass === "stock" && !fresh(it.symbol)).map(async it => { try { const p = await D.stocks.profile(it.symbol, "stock"); if (p && p.sector) cache[it.symbol] = { sector: p.sector, at: Date.now() }; } catch {} }));
        app.ls.set("sectors", cache);
        for (const it of items) if (it.assetClass === "stock") it.sector = (cache[it.symbol] && cache[it.symbol].sector) || "Sector unknown"; else if (it.assetClass === "etf") it.sector = "ETFs (diversified)";
        sectorsReady = true;
      };
      const showAlloc = (d) => { app.ls.set("allocDim", d);
        if (d === "sector" && !sectorsReady) { alloc.replaceChildren(U.tabs(dims, d, showAlloc), h("div", { class: "skeleton" }, "Looking up sectors…")); loadSectors().then(() => { if (app.ls.get("allocDim") === "sector") showAlloc("sector"); }); return; } const a = C.allocation(items, d); alloc.replaceChildren(U.tabs(dims, d, showAlloc), items.length ? U.bars(a.map(x => ({ label: x.key, value: Number(x.pct), text: Number(x.pct).toFixed(1) + "% · " + U.money(x.value, R) }))) : h("div", { class: "empty" }, "Nothing to allocate yet.")); };
      showAlloc(dim);
      const byCcy = C.allocation(items, "currency");
      const foreign = byCcy.filter(x => x.key !== R);
      const hh = C.hhi(byCcy.map(x => x.pct));
      const stress5 = C.fxStress(byCcy.map(x => ({ currency: x.key, valueR: x.value })), { "*": -5 }, R);
      risk.replaceChildren(U.kv([["Foreign-currency share", foreign.length ? U.pct(foreign.reduce((a, x) => a + Number(x.pct), 0), 1).replace("+", "") : "0%"], ["Currency concentration (HHI)", hh.toFixed(2) + (hh > 0.5 ? " · concentrated" : "")], ["If all foreign currencies fall 5% vs " + R, U.money(stress5.total, R, { sign: true })], ["Illiquid share", U.pct(items.filter(i => i.liquidity === "Low").reduce((a, i) => a + Number(i.value), 0) / total * 100, 1).replace("+", "")]]),
        h("div", { class: "explain" }, "HHI (Herfindahl index) adds up squared weights: 1.0 means everything in one currency; lower is more diversified. Stress figures are hypothetical, not predictions."),
        h("div", { class: "row" }, h("button", { class: "btn ghost sm", type: "button", onclick: () => app.go("strategies", { tab: "fx" }) }, "FX stress test"), h("button", { class: "btn ghost sm", type: "button", onclick: () => app.go("strategies", { tab: "ripple" }) }, "Market ripple simulator"), h("button", { class: "btn ghost sm", type: "button", onclick: () => volatilityModal(app, rows, R) }, "Historical volatility")));
    });
    const drawLedger = () => {
      const txs = app.store.cached("tx").slice().sort((a, b) => (b.tradeDate || "").localeCompare(a.tradeDate || "") || (b.createdAt || 0) - (a.createdAt || 0));
      const reversed = new Set(txs.filter(t => t.type === "reversal").map(t => t.reverses));
      const filt = app.ls.get("ledgerFilter", "");
      const input = h("input", { type: "search", placeholder: "Filter by symbol, type, currency…", value: filt, style: "max-width:320px" });
      const list = h("div", {});
      const paint = () => {
        const q = input.value.trim().toLowerCase(); app.ls.set("ledgerFilter", q);
        const rows = txs.filter(t => !q || [t.symbol, t.type, t.currency, t.name, t.note, t.source].join(" ").toLowerCase().includes(q)).map(t => Object.assign({}, t, { _cls: reversed.has(t.id) ? "void" : "" }));
        list.replaceChildren(U.table([{ t: "Date", v: "tradeDate" }, { t: "Type", v: "type" }, { t: "Asset", v: (t) => t.type === "reversal" ? "Reverses " + (txs.find(x => x.id === t.reverses) || {}).symbol : t.symbol }, { t: "Qty", v: (t) => t.quantity || "", n: true }, { t: "Price / amount", v: (t) => t.price ? U.money(t.price, t.currency, { price: true }) : t.amount ? U.money(t.amount, t.currency) : "", n: true }, { t: "Fees", v: (t) => t.fees && Number(t.fees) ? U.money(t.fees, t.currency) : "", n: true },
          { t: "FX to USD", v: (t) => t.fxToUSD ? h("span", { title: t.fxSource || "" }, C.fmtNum(t.fxToUSD, 6)) : h("span", { class: "faint" }, "—"), n: true }, { t: "Source", v: (t) => (t.source || "") + (t.demo ? " (demo)" : "") }, { t: "Recorded", v: (t) => U.fmtDate(t.createdAt) },
          { t: "", v: (t) => t.type !== "reversal" && !reversed.has(t.id) ? h("button", { class: "btn ghost sm", type: "button", onclick: async (e) => { e.stopPropagation(); if (await U.confirmBox("Reverse this transaction?", "A reversal entry is added and the original stays in the ledger, struck through. Re-enter it correctly afterwards if needed.", "Reverse")) { await app.store.create("tx", { type: "reversal", reverses: t.id, tradeDate: new Date().toISOString().slice(0, 10), source: "manual", note: "Reversal of " + t.id }); U.toast("Reversed"); } } }, "Reverse") : reversed.has(t.id) ? h("span", { class: "faint small" }, "reversed") : "" }], rows, { empty: "No transactions yet." }));
      };
      input.addEventListener("input", paint); paint();
      const batches = [...new Set(txs.filter(t => t.importBatch && !reversed.has(t.id)).map(t => t.importBatch))];
      ledger.replaceChildren(h("div", { class: "row between" }, input, batches.length ? h("select", { style: "width:auto", "aria-label": "Reverse an import", onchange: async (e) => { const b = e.target.value; e.target.value = ""; if (!b) return; const n = txs.filter(t => t.importBatch === b && !reversed.has(t.id)); if (await U.confirmBox("Reverse import?", "Adds " + n.length + " reversal entries for import " + b + ".", "Reverse " + n.length)) { for (const t of n) await app.store.create("tx", { type: "reversal", reverses: t.id, tradeDate: new Date().toISOString().slice(0, 10), source: "manual", note: "Reversal of import " + b }); U.toast("Import reversed"); } } }, h("option", { value: "" }, "Reverse an import…"), batches.map(b => h("option", { value: b }, b))) : null), list,
        h("p", { class: "small muted" }, "The ledger is append-only. Corrections are reversal entries, so the history you see is the history that was recorded."));
    };
    draw(); drawLedger();
    const off = app.on("data:tx", () => { draw(); drawLedger(); });
    return off;
  };
  function tileKV(label, v, sub) { return h("div", { class: "tile" }, h("span", { class: "label" }, label), h("span", { class: "v" }, v), sub ? h("span", { class: "s muted" }, sub) : null); }
  function positionModal(app, r, R) {
    const p = r.p;
    U.modal(p.symbol + " · " + p.name, h("div", { class: "stack" },
      U.kv([["Quantity", C.fmtNum(p.qty, 8)], ["Native currency", p.currency], ["Cost (native)", U.money(r.v.costN, p.currency)], ["Value (native)", r.v.valueN ? U.money(r.v.valueN, p.currency) : "—"], ["P&L (native)", r.v.pnlN ? U.money(r.v.pnlN, p.currency, { sign: true }) : "—"], ["Cost (" + R + ", historical rates)", r.v.costR ? U.money(r.v.costR, R) : "—"], ["Value (" + R + ", today's rate)", r.v.valueR ? U.money(r.v.valueR, R) : "—"], ["Price effect", r.v.priceEffectR ? U.money(r.v.priceEffectR, R, { sign: true }) : "—"], ["FX effect", r.v.fxEffectR ? U.money(r.v.fxEffectR, R, { sign: true }) : "—"], ["Income received", U.money(r.incomeN, p.currency)], ["Realized (" + R + ")", U.money(r.realized.pnl, R, { sign: true })], ["Cost basis", r.v.costBasisStatus]]),
      h("h3", {}, "Open lots (FIFO)"), U.table([{ t: "Date", v: "date" }, { t: "Qty", v: (l) => C.fmtNum(l.qty, 8), n: true }, { t: "Cost incl. fees", v: (l) => U.money(l.cost, p.currency), n: true }, { t: "Unit cost", v: (l) => U.money(l.cost.div(l.qty), p.currency, { price: true }), n: true }, { t: "Rate to USD at trade", v: (l) => l.fxToUSD ? C.fmtNum(l.fxToUSD, 6) : "—", n: true }], p.lots),
      p.realized.length ? h("h3", {}, "Realized") : null, p.realized.length ? U.table([{ t: "Date", v: "date" }, { t: "Qty", v: (x) => C.fmtNum(x.qty, 8), n: true }, { t: "Proceeds", v: (x) => U.money(x.proceeds, p.currency), n: true }, { t: "Cost", v: (x) => U.money(x.cost, p.currency), n: true }, { t: "P&L native", v: (x) => U.money(x.pnl, p.currency, { sign: true }), n: true }], p.realized) : null,
      r.q ? U.status(Object.assign({}, r.q, { kind: r.q.kind })) : null, h("p", { class: "small muted" }, "Exit cost assumption: " + r.exit.label + (r.exit.fxSpreadPct ? " + " + r.exit.fxSpreadPct + "% FX spread" : "") + "."),
      h("div", { class: "row" }, h("button", { class: "btn ghost sm", type: "button", onclick: () => app.openAsset(r.asset) }, "Open asset page"), h("button", { class: "btn ghost sm", type: "button", onclick: () => X.txModal(r.asset, r.q) }, "Add transaction"))));
  }
  async function volatilityModal(app, rows, R) {
    const body = h("div", { class: "stack" });
    U.modal("Historical volatility (1 year, USD prices)", body);
    const liquid = rows.filter(r => marketable(r.p.assetClass) && r.v.valueR);
    if (!liquid.length) { body.append(h("div", { class: "empty" }, "No marketable holdings to measure.")); return; }
    U.async(body, async () => Promise.all(liquid.map(async r => { try { return { r, s: await D.historyFor(r.asset, "1Y") }; } catch (e) { return { r, err: e }; } })), (res) => {
      const ok = res.filter(x => x.s);
      const stats = ok.map(x => ({ x, st: C.seriesStats(x.s.points, x.s.ppy || 252) }));
      // Weighted daily-return index on common dates.
      const total = ok.reduce((a, x) => a + Number(x.r.v.valueR), 0);
      const maps = ok.map(x => new Map(x.s.points.map(p => [Math.floor(p.time / 86400), p.close ?? p.value])));
      const days = [...maps[0].keys()].filter(d => maps.every(m => m.has(d))).sort((a, b) => a - b);
      let idx = [100];
      for (let i = 1; i < days.length; i++) { let r = 0; ok.forEach((x, j) => { r += Number(x.r.v.valueR) / total * (maps[j].get(days[i]) / maps[j].get(days[i - 1]) - 1); }); idx.push(idx[idx.length - 1] * (1 + r)); }
      const pv = idx.length > 20 ? { vol: C.annVol(idx, 252) * 100, dd: C.maxDrawdown(idx).mdd * 100 } : null;
      body.append(U.table([{ t: "Holding", v: (y) => y.x.r.p.symbol }, { t: "Weight (liquid)", v: (y) => (Number(y.x.r.v.valueR) / total * 100).toFixed(1) + "%", n: true }, { t: "1Y return", v: (y) => U.chg(y.st.changePct), n: true }, { t: "Volatility", v: (y) => y.st.volPct.toFixed(1) + "%", n: true }, { t: "Max drawdown", v: (y) => h("span", { class: "down num" }, y.st.maxDrawdownPct.toFixed(1) + "%"), n: true }], stats),
        pv ? U.kv([["Liquid portfolio volatility", pv.vol.toFixed(1) + "% a year"], ["Liquid portfolio max drawdown (1Y)", pv.dd.toFixed(1) + "%"], ["Common trading days", String(days.length)]]) : h("p", { class: "muted" }, "Not enough overlapping dates to combine."),
        res.some(x => x.err) ? h("p", { class: "small warn-t" }, "No history for: " + res.filter(x => x.err).map(x => x.r.p.symbol).join(", ")) : null,
        h("p", { class: "small muted" }, "Uses today's weights and USD price history; currency effects for non-USD investors and illiquid collectibles are excluded. Collectibles don't have meaningful daily volatility, so equity-style risk measures aren't applied to them."));
    }, { loading: "Fetching a year of prices for each holding…" });
  }
  function importModal(app) {
    const ta = h("textarea", { placeholder: C.CSV_COLUMNS.join(",") + "\n2024-01-15,buy,stock,AAPL,Apple Inc.,,10,185.20,,USD,1,,first lot", style: "min-height:160px;font-family:var(--font-data)" });
    const file = h("input", { type: "file", accept: ".csv,text/csv" });
    const out = h("div", { class: "stack" });
    file.onchange = () => { const f = file.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { ta.value = String(r.result); preview(); }; r.readAsText(f); };
    let parsed = null;
    const preview = () => {
      parsed = C.csvToTxs(ta.value, app.reg, app.store.cached("tx"));
      out.replaceChildren(U.kv([["Ready to import", String(parsed.ok.length)], ["Errors", String(parsed.errors.length), parsed.errors.length ? "down" : ""], ["Duplicates skipped", String(parsed.duplicates.length)]]),
        parsed.errors.length ? U.table([{ t: "Line", v: "line", n: true }, { t: "Problem", v: "msg" }], parsed.errors) : null,
        parsed.duplicates.length ? h("p", { class: "small muted" }, "Duplicates match an existing transaction exactly (date, type, asset, quantity, price, amount, currency, fees) and are skipped: lines " + parsed.duplicates.map(d => d.line).join(", ") + ".") : null,
        parsed.ok.length ? U.table([{ t: "Date", v: "tradeDate" }, { t: "Type", v: "type" }, { t: "Asset", v: "assetId" }, { t: "Qty", v: "quantity", n: true }, { t: "Price", v: "price", n: true }, { t: "Amount", v: "amount", n: true }, { t: "Ccy", v: "currency" }], parsed.ok.slice(0, 50)) : null);
    };
    ta.addEventListener("input", () => { clearTimeout(ta._t); ta._t = setTimeout(preview, 300); });
    const m = U.modal("Import transactions (CSV)", h("div", { class: "stack" },
      h("p", { class: "small" }, "Columns: ", h("code", {}, C.CSV_COLUMNS.join(", ")), ". Required: date (YYYY-MM-DD), type (buy, sell, dividend, fee, deposit, withdraw), symbol, currency. Asset IDs default to class:SYMBOL (e.g. crypto:bitcoin for CoinGecko IDs). Leave fx_to_usd blank to look up the ECB rate later."),
      file, ta, out,
      h("div", { class: "row end" }, h("button", { class: "btn", type: "button", onclick: async () => {
        if (!parsed) preview(); if (!parsed.ok.length) return;
        const batch = "import-" + new Date().toISOString().slice(0, 16).replace(/[:T]/g, "");
        let n = 0;
        for (const t of parsed.ok) {
          if (!t.fxToUSD && t.currency !== "USD") { const r = await app.rates.at(t.tradeDate, t.currency, "USD"); if (r) { t.fxToUSD = r.rate.toString(); t.fxSource = r.source; } }
          else if (t.currency === "USD") t.fxToUSD = "1";
          if (t.assetClass === "crypto" && !t.meta) t.meta = { cgId: t.assetId.split(":")[1].toLowerCase() };
          await app.store.create("tx", Object.assign(t, { importBatch: batch })); n++;
        }
        U.toast("Imported " + n + " transactions", "Batch " + batch); m.close();
      } }, "Import valid rows"))));
  }

  /* ================= Dashboard ================= */
  const WIDGETS = { today: "Today", paper: "Paper account", brief: "AI morning brief", brain: "Market Brain", aistatus: "What the AI is tracking", aiscore: "AI scorecard", changes: "What changed today", portfolio: "Portfolio", fx: "Currency exposure", watch: "Watchlist", alerts: "Alerts & inbox", catalysts: "Upcoming catalysts", smart: "Smart Money", betting: "Betting today", data: "Data health" };
  V.dashboard = function (root, app) {
    const R = app.settings.reportingCurrency;
    root.append(head("Dashboard", new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) + " · reporting in " + R, [h("button", { class: "btn ghost sm", type: "button", onclick: () => customize(app) }, "Customize")]));
    // What's new since Version 25, once, until dismissed.
    const NEW_IN = 35;
    if ((app.ls.get("whatsNew", 0) || 0) < NEW_IN) {
      const go = (route, pre) => () => { if (pre) pre(); app.go(route, null, { fromNav: true }); };
      const items = [["Today's Game Plan", "the day's clock, SPY call, releases, earnings for your names (with implied moves), calls due, and an AI plan; a daily digest goes to the inbox", go("today")],
        ["Paper Trading", "virtual money at live prices, judged against the same trades in the S&P 500; can follow the AI's picks automatically", go("paper")],
        ["Stock screener", "NYSE and Nasdaq by sector, size, price and today's move; send results to the ML scan or Recommendations", go("opportunities", () => app.ls.set("oppTab", "screener"))],
        ["Fresher recommendations", "NYSE + Nasdaq, mid-cap discovery in rotating sectors, no repeats without a reason, a correlation check and analysts' targets", go("picks")],
        ["Stronger AI", "a specialist panel that learns from its record, a conflict check, desk consensus on every asset page, and an ML model with boosted trees that checks whether its edge still holds", go("research", () => app.ls.set("resTab", "journal"))],
        ["Portfolio", "health score, news sentiment for your holdings, sector allocation, risk-parity rebalancing and realized gains by tax year", go("portfolio")]];
      const card = h("section", { class: "card whatsnew" }, h("div", { class: "hd" }, h("h2", { class: "sec" }, "What's new"), h("button", { class: "btn ghost sm", type: "button", onclick: () => { app.ls.set("whatsNew", NEW_IN); card.remove(); } }, "Got it")),
        h("div", { class: "bd" }, h("ul", { class: "small", style: "margin:0;padding-left:1.1em;display:grid;gap:6px" }, items.map(([t, d, f]) => h("li", {}, h("a", { href: "#", onclick: (e) => { e.preventDefault(); f(); } }, h("strong", {}, t)), " — " + d)))));
      root.append(card);
    }
    const rec = app.recent().slice(0, 8);
    if (rec.length) root.append(h("div", { class: "recent" }, h("span", { class: "label" }, "Recently viewed"), h("div", { class: "row", style: "gap:6px" }, rec.map(a => h("button", { class: "chip", type: "button", onclick: () => app.openAsset(a) }, h("b", {}, a.symbol || a.name), a.symbol && a.name && a.symbol !== a.name ? h("span", { class: "muted" }, String(a.name).slice(0, 24)) : null)))));
    const pvP = app.valuePortfolio(R).catch(e => ({ error: e }));
    const grid = h("div", { class: "grid g2" });
    root.append(grid);
    for (const w of app.settings.dashboard) {
      const box = h("div", {});
      const sec = U.section(WIDGETS[w] || w, box);
      if (w === "changes") sec.style.gridColumn = "1 / -1";
      grid.append(sec);
      ({ changes: wChanges, portfolio: wPortfolio, fx: wFx, watch: wWatch, alerts: wAlerts, catalysts: wCatalysts, smart: (b) => MD.smartView.dashboardCard(b, app), brain: (b) => MD.brain.dashboardCard(b, app), aistatus: (b) => MD.ai.statusCard(b, app), brief: (b) => MD.aiTake.brief(b, app), today: (b) => MD.today.dashCard(b, app), paper: (b) => MD.paper.dashCard(b, app), aiscore: (b) => b.append(MD.ai.scorecard(app)), betting: (b) => MD.betting.dashboardCard(b, app), data: wData }[w] || (() => {}))(box, app, pvP, R, sec);
    }
    return app.on("explainToday", () => { const b = root.querySelector("[data-explain]"); if (b) b.click(); });
  };
  function wChanges(box, app, pvP, R, sec) {
    U.async(box, async () => {
      const pv = await pvP; if (pv.error) throw pv.error;
      const rows = pv.rows.filter(r => r.p.qty.gt(0) && r.q && r.q.changePct != null && r.v.valueR);
      const moves = rows.map(r => { const pct = Number(r.q.changePct); const dayR = Number(r.v.valueR) * pct / (100 + pct); return { sym: r.p.symbol, pct, dayR, label: r.q.changeLabel || "today" }; }).sort((a, b) => Math.abs(b.dayR) - Math.abs(a.dayR));
      const dayTotal = moves.reduce((a, m) => a + m.dayR, 0);
      // Currency moves since the latest ECB fixing, for currencies held.
      const ccys = [...new Set(pv.rows.filter(r => r.p.qty.gt(0)).map(r => r.p.currency))].filter(c => c !== R && C.ECB_CODES.has(c) && C.ECB_CODES.has(R));
      const fxMoves = [];
      if (ccys.length) { try { const fix = await D.fx.ecbOn("latest", R, ccys); for (const c of ccys) { const now = app.rates.quote(R, c); if (now && fix.rates[c]) fxMoves.push({ c, pct: (Number(fix.rates[c]) / Number(now.rate) - 1) * 100, date: fix.date }); } } catch {} }
      const today = new Date().toISOString().slice(0, 10), soon = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
      const cats = app.store.cached("catalysts").filter(c => !c.done && c.date >= today && c.date <= soon);
      const alerts = app.store.cached("inbox").filter(i => i.kind === "alert" && i.at > Date.now() - 864e5);
      const due = app.store.cached("forecasts").filter(f => f.dueAt && f.dueAt <= Date.now() && !app.store.cached("evals").some(e => e.forecastId === f.id));
      const held = new Set(pv.rows.filter(r => r.p.qty.gt(0)).map(r => r.p.assetId));
      const staleResearch = app.store.cached("reports").filter(r => held.has(r.assetId)).reduce((m, r) => { if (!m[r.assetId] || m[r.assetId].createdAt < r.createdAt) m[r.assetId] = r; return m; }, {});
      const stale = Object.values(staleResearch).filter(r => Date.now() - r.createdAt > 30 * 864e5);
      const dataIssues = pv.rows.filter(r => r.q && r.q.warning).map(r => r.p.symbol + ": " + r.q.warning).concat(pv.missing.map(r => r.p.symbol + ": no price (" + (r.err || "unknown") + ")"));
      return { moves, dayTotal, fxMoves, cats, alerts, due, stale, dataIssues, pv };
    }, (d) => {
      const facts = [];
      box.append(h("div", { class: "grid g4" },
        tileKV("Portfolio move today", h("span", { class: U.signCls(d.dayTotal) }, U.money(d.dayTotal, R, { sign: true })), d.moves.length + " priced holdings with a daily change"),
        tileKV("Alerts triggered (24h)", String(d.alerts.length), d.alerts[0] ? d.alerts[0].title : "None"),
        tileKV("Catalysts in 3 days", String(d.cats.length), d.cats[0] ? d.cats[0].date + " · " + d.cats[0].title : "None tracked"),
        tileKV("Forecasts due for scoring", String(d.due.length), d.due.length ? "Score them in Deep Research → Journal" : "None due")));
      if (d.moves.length) { box.append(h("h3", {}, "Biggest contributors"), U.bars(d.moves.slice(0, 6).map(m => ({ label: m.sym + " " + U.pct(m.pct), value: m.dayR, text: U.money(m.dayR, R, { sign: true }) })), { signed: true })); facts.push("Holdings moves: " + d.moves.slice(0, 6).map(m => m.sym + " " + m.pct.toFixed(2) + "% (" + m.dayR.toFixed(0) + " " + R + ")").join(", ")); }
      if (d.fxMoves.length) { box.append(h("h3", {}, "Your currencies vs " + R + " since the last ECB fixing"), U.bars(d.fxMoves.map(f => ({ label: f.c, value: f.pct, text: U.pct(f.pct, 2) + " since " + f.date })), { signed: true })); facts.push("FX: " + d.fxMoves.map(f => f.c + " " + f.pct.toFixed(2) + "%").join(", ")); }
      if (d.stale.length) box.append(h("div", { class: "banner info" }, h("p", {}, "Research older than 30 days on holdings: " + d.stale.map(r => r.assetName).join(", ") + "."), h("button", { class: "btn ghost sm", type: "button", onclick: () => app.go("research") }, "Refresh research")));
      if (d.dataIssues.length) box.append(h("div", { class: "banner warn" }, h("p", {}, "Data quality: " + d.dataIssues.join(" · "))));
      if (!d.moves.length && !d.fxMoves.length) box.append(h("div", { class: "empty" }, "Nothing material to report yet. Add holdings or a watchlist to see daily changes here."));
      const ai = h("div", { class: "prose" });
      const btn = h("button", { class: "btn ghost sm", type: "button", "data-explain": "1", onclick: async () => {
        const s = app.caps.sample; if (!s) { ai.replaceChildren(U.errorBox({ message: "Claude isn't available in this view." })); return; }
        btn.disabled = true; ai.replaceChildren(h("div", { class: "skeleton" }, "Thinking…"));
        try {
          const t = await s(`Summarize what changed today for this investor in 3-5 short bullet points, ordered by materiality. Use ONLY these computed facts; do not add prices, news or causes that aren't listed. If little changed, say so. Reporting currency ${R}.
Facts: ${facts.join(" | ") || "no material moves"} | Alerts: ${d.alerts.map(a => a.title).join("; ") || "none"} | Catalysts next 3 days: ${d.cats.map(c => c.date + " " + c.title).join("; ") || "none"} | Forecasts due: ${d.due.length} | Stale research: ${d.stale.map(r => r.assetName).join(", ") || "none"} | Data issues: ${d.dataIssues.join("; ") || "none"}`, { modelTier: "quick", cache: false, onText: ({ text }) => { ai.replaceChildren(h("div", { style: "white-space:pre-wrap" }, text)); } });
          ai.replaceChildren(h("div", { style: "white-space:pre-wrap" }, t.text), h("p", { class: "small muted" }, "Written by Claude from the figures above only."));
        } catch (e) { ai.replaceChildren(U.errorBox({ message: e && e.code === "not_granted" ? "Claude access was declined for this page." : "Couldn't summarize." })); }
        btn.disabled = false;
      } }, "Explain what changed");
      box.append(h("div", { class: "row" }, btn), ai);
    }, { loading: "Checking prices, currencies, alerts and catalysts…" });
  }
  function wPortfolio(box, app, pvP, R) {
    U.async(box, () => pvP.then(pv => { if (pv.error) throw pv.error; return pv; }), (pv) => {
      const t = pv.totals;
      const items = pv.rows.filter(r => r.p.qty.gt(0) && r.v.valueR).map(r => ({ value: r.v.valueR, cls: CLS_LABEL[r.p.assetClass] || r.p.assetClass }));
      box.append(U.kv([["Market value", U.money(t.valueR, R)], ["Unrealized P&L", U.money(t.pnlR, R, { sign: true }), U.signCls(t.pnlR)], ["of which FX", U.money(t.fxEffectR, R, { sign: true }), U.signCls(t.fxEffectR)], ["Net liquidation (est.)", U.money(t.netLiq, R)]]),
        items.length ? U.bars(C.allocation(items, "cls").map(x => ({ label: x.key, value: Number(x.pct), text: Number(x.pct).toFixed(1) + "%" }))) : h("div", { class: "empty" }, "No holdings yet."),
        h("button", { class: "btn ghost sm", type: "button", onclick: () => app.go("portfolio") }, "Open portfolio"));
    });
  }
  function wFx(box, app, pvP, R) {
    U.async(box, () => pvP.then(pv => { if (pv.error) throw pv.error; return pv; }), (pv) => {
      const items = pv.rows.filter(r => r.p.qty.gt(0) && r.v.valueR).map(r => ({ value: r.v.valueR, currency: r.p.currency }));
      const a = C.allocation(items, "currency");
      box.append(a.length ? U.bars(a.map(x => ({ label: x.key + (x.key === R ? " (reporting)" : ""), value: Number(x.pct), text: Number(x.pct).toFixed(1) + "%" }))) : h("div", { class: "empty" }, "No currency exposure yet."),
        h("p", { class: "small muted" }, "Exposure by the currency each holding is priced in. A US-listed ETF of Japanese stocks is priced in USD but its underlying exposure is to JPY."));
    });
  }
  function wWatch(box, app) {
    const ws = app.store.cached("watch");
    if (!ws.length) { box.append(h("div", { class: "empty" }, "Your watchlist is empty. Use ☆ Watch on any asset page.")); return; }
    const g = h("div", { class: "grid g-auto" }); box.append(g);
    MD.marketsHelpers.quoteGrid(g, ws.map(w => Object.assign({ id: w.assetId }, w)));
  }
  function wAlerts(box, app) {
    const items = app.store.cached("inbox").sort((a, b) => (b.materiality || 0) - (a.materiality || 0) || (b.at || 0) - (a.at || 0)).slice(0, 6);
    box.append(items.length ? U.table([{ t: "When", v: (i) => U.fmtTs(i.at) }, { t: "What", v: "title" }], items, { onRow: () => app.go("inbox") }) : h("div", { class: "empty" }, "No alerts yet."),
      h("div", { class: "row" }, h("button", { class: "btn ghost sm", type: "button", onclick: async () => { const f = await app.checkAlerts(true); U.toast(f.length ? f.length + " alert(s) fired" : "Checked " + app.store.cached("alerts").length + " alerts; none fired"); } }, "Check alerts now")));
  }
  function wCatalysts(box, app) {
    const today = new Date().toISOString().slice(0, 10);
    const cs = app.store.cached("catalysts").filter(c => !c.done && c.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
    box.append(cs.length ? U.table([{ t: "Date", v: "date" }, { t: "Asset", v: "symbol" }, { t: "Event", v: "title" }, { t: "Impact", v: "impact" }], cs, { onRow: () => app.go("calendar") }) : h("div", { class: "empty" }, "No catalysts tracked. Add them from any asset page or the calendar."));
  }
  function wData(box, app) {
    const rows = D.PROVIDERS.filter(p => p.id !== "exa").map(p => { const hl = D.health.get(p.id); return { name: p.name, status: hl ? (hl.ok ? "OK" : "Error") : "Not used yet", at: hl ? U.fmtTs(hl.at) : "", ms: hl && hl.ms ? hl.ms + " ms" : "" }; });
    box.append(U.table([{ t: "Source", v: "name" }, { t: "Status", v: (r) => h("span", { class: r.status === "OK" ? "up" : r.status === "Error" ? "down" : "faint" }, r.status) }, { t: "Last call", v: "at" }, { t: "Latency", v: "ms", n: true }], rows), h("button", { class: "btn ghost sm", type: "button", onclick: () => app.go("settings", { tab: "sources" }) }, "Data sources"));
  }
  function customize(app) {
    const cur = app.settings.dashboard.slice();
    const list = h("div", { class: "stack" });
    const paint = () => list.replaceChildren(...Object.entries(WIDGETS).map(([k, label]) => { const i = cur.indexOf(k); return h("div", { class: "row between" }, h("label", { class: "chk" }, h("input", { type: "checkbox", checked: i >= 0, onchange: (e) => { if (e.target.checked) cur.push(k); else cur.splice(cur.indexOf(k), 1); paint(); } }), label), i >= 0 ? h("div", { class: "row" }, h("button", { class: "btn ghost sm", type: "button", disabled: i === 0, onclick: () => { cur.splice(i, 1); cur.splice(i - 1, 0, k); paint(); } }, "Up"), h("button", { class: "btn ghost sm", type: "button", disabled: i === cur.length - 1, onclick: () => { cur.splice(i, 1); cur.splice(i + 1, 0, k); paint(); } }, "Down")) : null); }));
    paint();
    const m = U.modal("Customize dashboard", h("div", { class: "stack" }, list, h("div", { class: "row end" }, h("button", { class: "btn", type: "button", onclick: () => { app.saveSettings({ dashboard: cur }); m.close(); app.rerender(); } }, "Save layout"))));
  }

  /* ================= Opportunities ================= */
  V.opportunities = function (root, app) {
    const ctx = app.ctx.opportunities || {};
    const tab = ctx.compare ? "compare" : (app.ls.get("oppTab", "scan"));
    root.append(head("Opportunities", "Screens, comparisons and AI idea finding built on measured data. Claude researches with news and market-data tools, a second review checks its reasoning, and every number comes from the app. A result is a lead to research, not a recommendation."),
      U.tabs([["scan", "Scanner"], ["screener", "Stock screener"], ["watch", "Watchlist scanner"], ["compare", "Investment decision comparator"], ["ideas", "AI idea finder"]], tab, (k) => { app.ls.set("oppTab", k); app.ctx.opportunities = k === "compare" ? { compare: ctx.compare || [] } : {}; app.rerender(); }));
    if (tab === "compare") return comparator(root, app, ctx.compare || []);
    if (tab === "ideas") return MD.oppAI.ideaFinder(root, app);
    if (tab === "watch") return MD.watchScan.view(root, app);
    if (tab === "screener") return MD.screener.view(root, app);
    scanner(root, app, ctx.screen);
  };
  const PRESETS = {
    momentum: ["Momentum (3-month return)", (s) => s.r3m],
    trend: ["Steady trend (Sharpe ratio)", (s) => s.sharpe],
    pullback: ["Pullback in an uptrend", (s) => s.above200 && s.fromHigh < -10 ? -s.fromHigh : -Infinity],
    lowvol: ["Lowest volatility", (s) => -s.vol],
    drawdown: ["Deepest drawdown (contrarian)", (s) => -s.mdd],
    fcf: ["Free-cash-flow margin (stocks)", (s) => s.fcfMargin ?? -Infinity]
  };
  function scanner(root, app, screenText) {
    const presetSaved = screenText && /cash flow|fcf/i.test(screenText) ? "fcf" : screenText && /reward|risk/i.test(screenText) ? "trend" : app.ls.get("scanPreset", "momentum");
    const universe = new Map();
    for (const s of app.settings.universe) universe.set("stock:" + s, { id: "stock:" + s, cls: "stock", symbol: s, name: s });
    for (const w of app.store.cached("watch")) if (marketable(w.cls)) universe.set(w.assetId, Object.assign({ id: w.assetId }, w));
    const { positions } = C.buildPositions(app.store.cached("tx"));
    for (const p of positions.values()) if (p.qty.gt(0) && marketable(p.assetClass)) universe.set(p.assetId, Object.assign({ id: p.assetId, cls: p.assetClass, symbol: p.symbol, name: p.name }, p.meta || {}));
    const presetSel = h("select", { style: "width:auto" }, Object.entries(PRESETS).map(([k, [l]]) => h("option", { value: k, selected: k === presetSaved }, l)));
    const out = h("div", { class: "stack" });
    let results = null, ranked = [];
    const aiBox = h("div", { class: "stack" }, h("div", { class: "empty" }, "Run a scan first."));
    const paint = () => {
      app.ls.set("scanPreset", presetSel.value);
      if (!results) return;
      const f = PRESETS[presetSel.value][1];
      const rows = results.filter(r => r.s).sort((a, b) => f(b.s) - f(a.s));
      ranked = rows;
      if (!aiBox._ready) { aiBox._ready = true; aiBox.replaceChildren(MD.oppAI.scanReview(app, () => ranked, PRESETS[presetSel.value][0])); }
      out.replaceChildren(U.table([{ t: "Asset", v: (r) => r.a.symbol }, { t: "Class", v: (r) => r.a.cls }, { t: "3M", v: (r) => U.chg(r.s.r3m), n: true }, { t: "1Y", v: (r) => U.chg(r.s.r1y), n: true }, { t: "Volatility", v: (r) => r.s.vol.toFixed(1) + "%", n: true }, { t: "Max DD", v: (r) => h("span", { class: "num down" }, r.s.mdd.toFixed(1) + "%"), n: true }, { t: "From 1Y high", v: (r) => U.chg(r.s.fromHigh), n: true }, { t: "vs 200-day avg", v: (r) => r.s.above200 == null ? "—" : r.s.above200 ? "Above" : "Below" }, { t: "Sharpe", v: (r) => isFinite(r.s.sharpe) ? r.s.sharpe.toFixed(2) : "—", n: true, cls: "adv" }, { t: "FCF margin", v: (r) => r.s.fcfMargin != null ? r.s.fcfMargin.toFixed(1) + "%" : "—", n: true },
        { t: "", v: (r) => h("div", { class: "row" }, h("button", { class: "btn ghost sm", type: "button", onclick: (e) => { e.stopPropagation(); app.go("research", { asset: X.slim(r.a) }); } }, "Research"), h("button", { class: "btn ghost sm", type: "button", onclick: (e) => { e.stopPropagation(); app.go("opportunities", { compare: [X.slim(r.a)] }); app.ls.set("oppTab", "compare"); } }, "Compare")) }], rows, { onRow: (r) => app.openAsset(r.a) }),
        results.some(r => r.err) ? h("p", { class: "small warn-t" }, "Skipped (no data): " + results.filter(r => r.err).map(r => r.a.symbol).join(", ")) : null,
        h("p", { class: "small muted" }, "Price statistics from one year of daily closes (Nasdaq, Kraken). Past movement does not predict future returns, and the universe is small and hand-picked, so survivorship bias applies."));
    };
    presetSel.onchange = paint;
    const runScan = async (withFcf) => {
      out.replaceChildren(h("div", { class: "skeleton" }, "Scanning " + universe.size + " assets…"));
      results = await Promise.all([...universe.values()].map(async (a) => {
        try {
          const s = await D.historyFor(a, "1Y");
          const v = s.points.map(p => p.close ?? p.value), n = v.length, last = v[n - 1];
          const i3 = Math.max(0, n - 63), st = C.seriesStats(s.points, s.ppy || 252), sma200 = n >= 200 ? v.slice(-200).reduce((x, y) => x + y, 0) / 200 : null;
          const out = { r3m: (last / v[i3] - 1) * 100, r1y: st.changePct, vol: st.volPct, mdd: st.maxDrawdownPct, fromHigh: (last / Math.max(...v) - 1) * 100, above200: sma200 ? last > sma200 : null, sharpe: st.sharpe };
          if (withFcf && a.cls === "stock") { try { const f = await D.stocks.financials(a.symbol); const row = (tb, name) => tb && tb.rows.find(r => String(r[0]).toLowerCase().startsWith(name)); const ocf = row(f.cash, "net cash flow-operating"), capex = row(f.cash, "capital expenditures"), rev = row(f.income, "total revenue"); if (ocf && rev) { const fcf = D.num(ocf[1]) + (capex ? D.num(capex[1]) : 0); out.fcfMargin = fcf / D.num(rev[1]) * 100; } } catch {} }
          return { a, s: out };
        } catch (e) { return { a, err: e }; }
      }));
      paint();
    };
    root.append(U.section("Scanner", h("div", { class: "stack" },
      h("div", { class: "row" }, h("label", { class: "row" }, h("span", { class: "label" }, "Rank by"), presetSel), h("button", { class: "btn", type: "button", onclick: () => runScan(presetSel.value === "fcf") }, "Run scan"), h("button", { class: "btn ghost", type: "button", onclick: () => runScan(true) }, "Run with fundamentals (slower)")),
      screenText ? h("div", { class: "banner info" }, h("p", {}, "From your request: “" + screenText + "”. International primary listings aren't scannable; the universe includes US-listed ADRs you add in Settings.")) : null,
      h("p", { class: "small muted" }, "Universe: " + [...universe.values()].map(a => a.symbol).join(", ") + ". Edit it in Settings; holdings and watchlist are included automatically."),
      out)), U.section("AI review of the scan", h("div", { class: "stack" }, h("p", { class: "small muted" }, "Claude checks the top eight results with news, Zacks, the price picture and smart-money tools, judges each for a 6–12 month holding (Research further, Watch or Pass), and a second review checks the reasoning."), aiBox)));
  }
  function comparator(root, app, initial) {
    const R = app.settings.reportingCurrency;
    const list = (app.ls.get("compareList", []).concat(initial || [])).filter((a, i, arr) => a && arr.findIndex(b => b.id === a.id) === i).slice(0, 4);
    const save = () => app.ls.set("compareList", list);
    save();
    const tf = app.ls.get("compareTf", "1Y");
    const out = h("div", { class: "stack" });
    const chips = h("div", { class: "row" }, list.map(a => h("span", { class: "pill" }, a.symbol, h("button", { class: "linkbtn", type: "button", "aria-label": "Remove " + a.symbol, onclick: () => { list.splice(list.indexOf(a), 1); save(); app.ctx.opportunities = { compare: [] }; app.rerender(); } }, "×"))));
    root.append(U.section("Compare up to four investments under the same assumptions", h("div", { class: "stack" },
      chips, list.length < 4 ? X.assetPicker((a) => { list.push(X.slim(a)); save(); app.ctx.opportunities = { compare: [] }; app.rerender(); }, ["stock", "etf", "crypto", "metal"]) : null,
      h("div", { class: "row" }, h("span", { class: "label" }, "Period"), U.seg(["3M", "6M", "1Y", "5Y"], tf, (x) => { app.ls.set("compareTf", x); app.rerender(); })),
      out)));
    if (list.length < 2) { out.append(h("div", { class: "empty" }, "Add at least two assets to compare. Cash (a money-market ETF such as SGOV or BIL) and a broad index (SPY, VT) make useful baselines.")); return; }
    U.async(out, () => Promise.all(list.map(async a => { try { const s = await D.historyFor(a, tf); return { a, s, st: C.seriesStats(s.points, s.ppy || 252) }; } catch (e) { return { a, err: e }; } })), (res) => {
      const ok = res.filter(r => r.s);
      const PAL = [U.tok("--accent"), "#c05a00", "#0f7a4a", "#8a3ffc"];
      const box = h("div", { class: "chartbox" });
      out.append(box, h("div", { class: "legend-row" }, ok.map((r, i) => h("span", {}, h("span", { class: "swatch", style: "background:" + PAL[i] }), r.a.symbol))));
      if (ok.length) {
        const rebase = (pts) => { const b = pts[0].close ?? pts[0].value; return pts.map(p => ({ time: Math.floor(p.time / 86400) * 86400, value: (p.close ?? p.value) / b * 100 })).filter((p, i, arr) => i === 0 || p.time > arr[i - 1].time); };
        U.chart(box, { kind: "line", points: rebase(ok[0].s.points), intraday: false }, { compare: ok.slice(1).map((r, i) => ({ label: r.a.symbol, points: rebase(r.s.points), color: PAL[i + 1] })), fmt: (v) => v.toFixed(1) });
      }
      const rf = app.settings.assumptions.riskFreePct;
      const reports = app.store.cached("reports");
      out.append(U.table([{ t: "Asset", v: (r) => r.a.symbol + " · " + (r.a.name || "") }, { t: tf + " return", v: (r) => r.st ? U.chg(r.st.changePct) : "—", n: true }, { t: "Volatility", v: (r) => r.st ? r.st.volPct.toFixed(1) + "%" : "—", n: true }, { t: "Max drawdown", v: (r) => r.st ? h("span", { class: "num down" }, r.st.maxDrawdownPct.toFixed(1) + "%") : "—", n: true },
        { t: "Sharpe (rf " + rf + "%)", v: (r) => r.s ? C.sharpe(r.s.points.map(p => p.close ?? p.value), r.s.ppy || 252, rf / 100).toFixed(2) : "—", n: true }, { t: "Priced in", v: (r) => (r.s && r.s.currency) || "USD" }, { t: "Currency risk vs " + R, v: (r) => ((r.s && r.s.currency) || "USD") === R ? "None" : "Yes" },
        { t: "Liquidity", v: (r) => ({ stock: "High", etf: "High", crypto: "High", metal: "Medium" }[r.a.cls] || "—") }, { t: "Exit cost (assumed)", v: (r) => app.exitAssumption(r.a.cls, "USD", R).exitCostPct + "%", n: true },
        { t: "Latest research", v: (r) => { const rp = reports.filter(x => x.assetId === r.a.id).sort((x, y) => y.createdAt - x.createdAt)[0]; return rp ? (rp.report && rp.report.verdict ? rp.report.verdict.label : "Report") + " · " + U.fmtDate(rp.createdAt) : "None"; } }], res),
        res.some(r => r.err) ? h("p", { class: "small warn-t" }, res.filter(r => r.err).map(r => r.a.symbol + ": " + U.errorText(r.err)).join(" · ")) : null,
        h("p", { class: "small muted" }, "Same period, same risk-free rate, same cost assumptions for every asset. Returns are price-only (dividends excluded) in each asset's own currency."));
      out.append(U.section("AI comparison", h("div", { class: "stack" }, h("p", { class: "small muted" }, "Claude scores each investment on growth, risk, valuation, momentum and fit to your portfolio using news, Zacks and price tools; a second review checks the scores against the evidence."), MD.oppAI.compareAI(app, ok, tf, R))));
    }, { loading: "Loading price history…" });
  }

  /* ================= Strategies & Backtesting ================= */
  V.strategies = function (root, app) {
    const tab = (app.ctx.strategies && app.ctx.strategies.tab) || app.ls.get("stratTab", "backtest");
    root.append(head("Strategies & Backtesting", "Deterministic, reproducible calculations. Every simulator is labelled hypothetical and shows its assumptions."),
      U.tabs([["backtest", "Backtest"], ["ripple", "Market ripple simulator"], ["fx", "FX stress test"], ["catalyst", "Catalyst impact"], ["future", "Financial future"]], tab, (k) => { app.ls.set("stratTab", k); app.ctx.strategies = { tab: k }; app.rerender(); }));
    ({ backtest: backtestView, ripple: rippleView, fx: fxStressView, catalyst: catalystView, future: futureView }[tab] || backtestView)(root, app);
  };
  function backtestView(root, app) {
    const st = app.ls.get("bt", { asset: { id: "etf:SPY", cls: "etf", symbol: "SPY", name: "S&P 500 ETF" }, type: "sma", fast: 50, slow: 200, cost: 5, tf: "5Y" });
    const sel = h("div", { class: "row" }, h("strong", {}, st.asset.symbol + " · " + st.asset.name));
    const f = { type: h("select", {}, [["buyhold", "Buy and hold"], ["sma", "Moving-average crossover"], ["trend", "Trend filter (price vs N-day average)"], ["dca", "Monthly dollar-cost averaging"]].map(([v, l]) => h("option", { value: v, selected: v === st.type }, l))), fast: h("input", { type: "number", value: st.fast, min: 2 }), slow: h("input", { type: "number", value: st.slow, min: 3 }), cost: h("input", { type: "number", value: st.cost, min: 0, step: "0.5" }), tf: h("select", {}, ["1Y", "5Y", "10Y", "Max"].map(x => h("option", { selected: x === st.tf }, x))) };
    const out = h("div", { class: "stack" });
    const run = () => {
      Object.assign(st, { type: f.type.value, fast: +f.fast.value, slow: +f.slow.value, cost: +f.cost.value, tf: f.tf.value }); app.ls.set("bt", st);
      const tf = st.asset.cls === "crypto" ? st.tf : (st.tf === "Max" ? "10Y" : st.tf);
      U.async(out, () => D.historyFor(st.asset, tf), (s) => {
        const ppy = s.ppy || 252;
        const strat = { type: st.type, fast: st.fast, slow: st.slow };
        const r = C.backtest(s.points, strat, { costBps: st.cost, ppy, rf: app.settings.assumptions.riskFreePct / 100 });
        const b = C.backtest(s.points, { type: "buyhold" }, { costBps: st.cost, ppy, rf: app.settings.assumptions.riskFreePct / 100 });
        const box = h("div", { class: "chartbox" });
        out.append(box, h("div", { class: "legend-row" }, h("span", {}, h("span", { class: "swatch", style: "background:" + U.tok("--accent") }), "Strategy"), h("span", {}, h("span", { class: "swatch", style: "background:" + U.tok("--bench") }), "Buy and hold (benchmark)")));
        U.chart(box, { kind: "line", points: r.equity.map(e => ({ time: e.time, value: e.value })), intraday: false }, { compare: st.type === "buyhold" ? [] : [{ label: "Buy and hold", points: b.equity }], fmt: (v) => v.toFixed(3) });
        const row = (x) => [U.pct(x.totalReturnPct), x.cagrPct != null ? U.pct(x.cagrPct) : "n/a (DCA)", x.volPct.toFixed(1) + "%", x.maxDrawdownPct.toFixed(1) + "%", isFinite(x.sharpe) ? x.sharpe.toFixed(2) : "—", String(x.trades), x.exposurePct.toFixed(0) + "%"];
        out.append(U.table([{ t: "", v: 0 }, { t: "Total return", v: 1, n: true }, { t: "CAGR", v: 2, n: true }, { t: "Volatility", v: 3, n: true }, { t: "Max drawdown", v: 4, n: true }, { t: "Sharpe", v: 5, n: true }, { t: "Trades", v: 6, n: true }, { t: "Time invested", v: 7, n: true }], [["Strategy", ...row(r)], ["Buy and hold", ...row(b)]]),
          U.status({ status: "Historical", source: s.source, note: s.note }),
          h("div", { class: "explain" }, "Signals use each day's close and trade at that close, with " + st.cost + " bps cost per trade. Equity starts at 1.0 (DCA invests 1/12 a month)."),
          h("p", { class: "small muted" }, "Limits: prices exclude dividends; no slippage beyond the cost you set; no taxes; the asset was chosen with hindsight (survivorship bias). A strategy that worked in this window can fail in the next one."));
      }, { loading: "Loading history and running the backtest…" });
    };
    root.append(U.section("Backtest", h("div", { class: "stack" }, sel, X.assetPicker((a) => { st.asset = X.slim(a); app.ls.set("bt", st); app.rerender(); }, ["stock", "etf", "crypto"]),
      h("div", { class: "form" }, U.field("Strategy", f.type), U.field("Fast average (days)", f.fast), U.field("Slow / trend average (days)", f.slow), U.field("Cost per trade (bps)", f.cost), U.field("History", f.tf), h("div", { class: "field" }, h("button", { class: "btn", type: "button", onclick: run }, "Run backtest"))), out)));
    run();
  }
  async function holdingsR(app) { const pv = await app.valuePortfolio(app.settings.reportingCurrency); return pv.rows.filter(r => r.p.qty.gt(0) && r.v.valueR); }
  function rippleView(root, app) {
    const R = app.settings.reportingCurrency;
    const PRE = { "Risk-off": { equities: -10, crypto: -25, gold: 4, collectibles: -5, usd: 3 }, "Rate shock": { equities: -7, crypto: -12, gold: -3, collectibles: -3, usd: 2 }, "Crypto winter": { equities: -2, crypto: -50, gold: 0, collectibles: 0, usd: 0 }, "Soft landing": { equities: 6, crypto: 10, gold: -2, collectibles: 2, usd: -1 } };
    const shocks = app.ls.get("rippleShocks", PRE["Risk-off"]);
    const fin = {}; for (const k of ["equities", "crypto", "gold", "collectibles", "usd"]) fin[k] = h("input", { type: "number", step: "0.5", value: shocks[k] ?? 0 });
    const out = h("div", { class: "stack" });
    let holdings = [];
    const betas = app.ls.get("rippleBetas", {});
    const calc = () => {
      for (const k in fin) shocks[k] = Number(fin[k].value) || 0; app.ls.set("rippleShocks", shocks);
      const hs = holdings.map(r => { const b = Object.assign({}, DEFAULT_BETAS[r.p.assetClass] || {}, betas[r.p.assetId] || {}); if (r.p.currency !== R && R !== "USD" && r.p.currency === "USD") b.usd = 1; return { id: r.p.symbol, valueR: r.v.valueR, betas: b }; });
      const res = C.ripple(hs, shocks);
      out.replaceChildren(U.table([{ t: "Holding", v: "id" }, { t: "Value", v: (x) => U.money(x.valueR, R), n: true }, { t: "Exposures (beta)", v: (x) => Object.entries(hs.find(y => y.id === x.id).betas).map(([k, v]) => k + " " + v).join(", ") || "none" }, { t: "Move", v: (x) => U.chg(x.movePct), n: true }, { t: "Impact", v: (x) => h("span", { class: "num " + U.signCls(x.impact) }, U.money(x.impact, R, { sign: true })), n: true }], res.rows),
        h("div", { class: "tile" }, h("span", { class: "label" }, "Hypothetical portfolio impact"), h("span", { class: "v " + U.signCls(res.total) }, U.money(res.total, R, { sign: true }))),
        h("p", { class: "small muted" }, "Hypothetical scenario, not a prediction. Each holding moves by Σ beta × factor shock. Default betas are crude (stocks 1.0 to equities, crypto 1.0 to crypto and 0.3 to equities, metals 1.0 to gold, cards 1.0 to collectibles). USD factor applies to USD-priced holdings when you report in another currency. Real assets don't move in fixed proportions, especially in a crisis."));
    };
    for (const i of Object.values(fin)) i.addEventListener("input", calc);
    root.append(U.section("Market ripple simulator · " + R, h("div", { class: "stack" },
      h("div", { class: "row" }, h("span", { class: "label" }, "Presets"), Object.keys(PRE).map(k => h("button", { class: "btn ghost sm", type: "button", onclick: () => { for (const f in fin) fin[f].value = PRE[k][f]; calc(); } }, k))),
      h("div", { class: "form" }, U.field("Equities %", fin.equities), U.field("Crypto %", fin.crypto), U.field("Gold %", fin.gold), U.field("Collectibles %", fin.collectibles), U.field("USD vs " + R + " %", fin.usd)), out)));
    U.async(out, () => holdingsR(app), (hs) => { holdings = hs; if (!hs.length) { out.append(h("div", { class: "empty" }, "Add holdings to run scenarios.")); return; } calc(); });
  }
  function fxStressView(root, app) {
    const R = app.settings.reportingCurrency;
    const out = h("div", { class: "stack" });
    root.append(U.section("FX stress test · reporting in " + R, out));
    U.async(out, () => holdingsR(app), (hs) => {
      const by = C.allocation(hs.map(r => ({ value: r.v.valueR, currency: r.p.currency })), "currency").filter(x => x.key !== R);
      if (!by.length) { out.append(h("div", { class: "empty" }, "All holdings are priced in " + R + "; there is no direct currency exposure to stress.")); return; }
      const saved = app.ls.get("fxShocks", {});
      const ins = {}; for (const x of by) ins[x.key] = h("input", { type: "number", step: "0.5", value: saved[x.key] ?? -5 });
      const spread = h("input", { type: "number", step: "0.1", value: saved._spread ?? 1 });
      const res = h("div", { class: "stack" });
      const calc = () => {
        const shocks = {}; for (const k in ins) shocks[k] = Number(ins[k].value) || 0; shocks._spread = Number(spread.value) || 0; app.ls.set("fxShocks", shocks);
        const r = C.fxStress(by.map(x => ({ currency: x.key, valueR: x.value })), shocks, R);
        const foreign = by.reduce((a, x) => a.plus(x.value), C.ZERO), spreadCost = foreign.times(shocks._spread).div(100);
        res.replaceChildren(U.table([{ t: "Currency", v: "currency" }, { t: "Exposure", v: (x) => U.money(x.valueR, R), n: true }, { t: "Shock vs " + R, v: (x) => U.pct(x.shockPct), n: true }, { t: "Impact", v: (x) => h("span", { class: "num " + U.signCls(x.impact) }, U.money(x.impact, R, { sign: true })), n: true }], r.rows),
          U.kv([["Currency moves", U.money(r.total, R, { sign: true }), U.signCls(r.total)], ["Extra cost if spreads widen by " + shocks._spread + "%", U.money(spreadCost.neg(), R, { sign: true }), "down"], ["Total hypothetical impact", U.money(r.total.minus(spreadCost), R, { sign: true }), U.signCls(r.total.minus(spreadCost))]]),
          h("p", { class: "small muted" }, "Hypothetical. A shock of −5% means that currency loses 5% against " + R + ". Exposure is by pricing currency; hedged funds, foreign revenue of domestic companies and currency-linked liabilities aren't modelled. Hedging reduces but doesn't remove currency risk, and it costs the interest-rate differential plus fees."));
      };
      for (const i of [...Object.values(ins), spread]) i.addEventListener("input", calc);
      out.append(h("div", { class: "row" }, h("span", { class: "label" }, "Quick"), h("button", { class: "btn ghost sm", type: "button", onclick: () => { for (const k in ins) ins[k].value = -5; calc(); } }, R + " strengthens 5%"), h("button", { class: "btn ghost sm", type: "button", onclick: () => { for (const k in ins) ins[k].value = 5; calc(); } }, R + " weakens 5%"), h("button", { class: "btn ghost sm", type: "button", onclick: () => { for (const k in ins) ins[k].value = k === "EUR" ? -10 : 0; calc(); } }, "EUR −10%")),
        h("div", { class: "form" }, by.map(x => U.field(x.key + " move vs " + R + " (%)", ins[x.key])), U.field("Spread widening (%)", spread)), res);
      calc();
    });
  }
  function catalystView(root, app) {
    const f = { price: h("input", { type: "number", value: "100" }), p: h("input", { type: "number", value: "40", min: 0, max: 100 }), up: h("input", { type: "number", value: "18" }), down: h("input", { type: "number", value: "-8" }), pos: h("input", { type: "number", value: "10000" }) };
    const out = h("div", { class: "stack" });
    const calc = () => {
      const r = C.catalystImpact({ price: f.price.value, pEvent: f.p.value, upPct: f.up.value, downPct: f.down.value });
      const pos = Number(f.pos.value) || 0;
      out.replaceChildren(U.bars(r.outcomes.map(o => ({ label: o.label + " (" + (o.p * 100).toFixed(0) + "%)", value: o.movePct, text: U.pct(o.movePct) + " → " + C.fmtNum(o.price, 2) + " · " + (pos ? (o.movePct * pos / 100 > 0 ? "+" : "") + C.fmtNum(o.movePct * pos / 100, 0) : "") })), { signed: true }),
        U.kv([["Probability-weighted move", U.pct(r.expectedMovePct), U.signCls(r.expectedMovePct)], ["Expected price", C.fmtNum(r.expectedPrice, 2)], ["Outcome spread", r.spreadPct.toFixed(1) + " pts"], ["Expected P&L on position", pos ? C.fmtNum(r.expectedMovePct * pos / 100, 0) : "—"]]),
        h("p", { class: "small muted" }, "Hypothetical. The expected value hides the range: with these inputs you'd see either outcome, never the average. Your probability is an assumption; check whether the market price already reflects it."));
    };
    for (const i of Object.values(f)) i.addEventListener("input", calc);
    root.append(U.section("Catalyst impact simulator", h("div", { class: "stack" }, h("div", { class: "form" }, U.field("Current price", f.price), U.field("Probability the event happens (%)", f.p), U.field("Move if it happens (%)", f.up), U.field("Move if it doesn't (%)", f.down), U.field("Position size", f.pos)), out)));
    calc();
  }
  function futureView(root, app) {
    const R = app.settings.reportingCurrency, a = app.settings.assumptions;
    const f = { start: h("input", { type: "number", value: "10000" }), monthly: h("input", { type: "number", value: "500" }), years: h("input", { type: "number", value: "20", min: 1, max: 60 }), mu: h("input", { type: "number", value: "6", step: "0.5" }), vol: h("input", { type: "number", value: "15", step: "0.5" }), infl: h("input", { type: "number", value: String(a.inflationPct), step: "0.1" }), goal: h("input", { type: "number", value: "300000" }) };
    app.valuePortfolio(R).then(pv => { if (Number(pv.totals.valueR) > 0) f.start.value = Number(pv.totals.valueR).toFixed(0); calc(); }).catch(() => {});
    const out = h("div", { class: "stack" });
    const calc = () => {
      const r = C.goalSimulation({ start: +f.start.value, monthly: +f.monthly.value, years: Math.min(60, Math.max(1, +f.years.value)), muPct: +f.mu.value, volPct: +f.vol.value, inflationPct: +f.infl.value, paths: 2000, seed: 7, goal: +f.goal.value });
      const box = h("div", { class: "chartbox sm" });
      out.replaceChildren(box, h("div", { class: "legend-row" }, h("span", {}, h("span", { class: "swatch", style: "background:" + U.tok("--accent") }), "Median (inflation-adjusted)"), h("span", {}, h("span", { class: "swatch", style: "background:" + U.tok("--bench") }), "10th and 90th percentile")),
        U.kv([["Contributed", U.money(r.contributed, R)], ["Median outcome (today's money)", U.money(r.rows[r.rows.length - 1].p50Real, R)], ["Median outcome (nominal)", U.money(r.rows[r.rows.length - 1].p50, R)], ["Chance of reaching goal (today's money)", r.pGoalReal != null ? (r.pGoalReal * 100).toFixed(0) + "%" : "—"]]),
        U.table([{ t: "Year", v: "year", n: true }, { t: "10th pct (real)", v: (x) => C.fmtNum(x.p10Real, 0), n: true }, { t: "Median (real)", v: (x) => C.fmtNum(x.p50Real, 0), n: true }, { t: "90th pct (real)", v: (x) => C.fmtNum(x.p90Real, 0), n: true }, { t: "Median (nominal)", v: (x) => C.fmtNum(x.p50, 0), n: true }], r.rows.filter((x, i) => i % Math.max(1, Math.round(r.rows.length / 10)) === 0 || i === r.rows.length - 1)),
        h("p", { class: "small muted" }, r.paths + " simulated paths (seed " + r.seed + "), monthly steps, log-normal returns with your assumed " + f.mu.value + "% return and " + f.vol.value + "% volatility, deflated by " + f.infl.value + "% inflation. Taxes, fees and currency changes aren't included unless you lower the return. Assumptions, not forecasts."));
      const yr0 = Math.floor(Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000);
      const pts = (k) => r.rows.map(x => ({ time: yr0 + x.year * 31557600, value: x[k] }));
      U.chart(box, { kind: "line", points: pts("p50Real"), intraday: false }, { compare: [{ label: "p10", points: pts("p10Real") }, { label: "p90", points: pts("p90Real") }], fmt: (v) => C.fmtNum(v, 0) });
    };
    for (const i of Object.values(f)) i.addEventListener("change", calc);
    root.append(U.section("Financial future simulator · " + R, h("div", { class: "stack" }, h("div", { class: "form" }, U.field("Starting value", f.start), U.field("Monthly contribution", f.monthly), U.field("Years", f.years), U.field("Expected return % / yr", f.mu), U.field("Volatility % / yr", f.vol), U.field("Inflation % / yr", f.infl), U.field("Goal (today's money)", f.goal)), out)));
    calc();
  }

  /* ================= Calendar & Catalysts ================= */
  V.calendar = function (root, app) {
    root.append(head("Calendar & Catalysts", "Earnings and economic releases from Nasdaq, plus the catalysts you track."));
    const days = app.ls.get("calDays", 7);
    const mine = app.ls.get("calMine", false);
    const held = new Set();
    const { positions } = C.buildPositions(app.store.cached("tx"));
    for (const p of positions.values()) if (p.qty.gt(0)) held.add(p.symbol);
    for (const w of app.store.cached("watch")) held.add(w.symbol);
    const earn = h("div", {}), econ = h("div", {}), cats = h("div", {});
    const controls = h("div", { class: "row" }, h("span", { class: "label" }, "Window"), U.seg(["3", "7", "14"], String(days), (d) => { app.ls.set("calDays", Number(d)); app.rerender(); }), h("label", { class: "chk" }, h("input", { type: "checkbox", checked: mine, onchange: (e) => { app.ls.set("calMine", e.target.checked); app.rerender(); } }), "Only my holdings & watchlist"));
    root.append(controls, U.section("Your catalysts", cats), h("div", { class: "grid g2" }, U.section("Earnings", earn), U.section("Economic events", econ)));
    const dates = Array.from({ length: days }, (_, i) => D.ymd(new Date(Date.now() + i * 864e5)));
    U.async(earn, async () => (await Promise.all(dates.map(d => D.calendar.earnings(d).catch(() => [])))).flat(), (rows) => {
      const sel = mine ? rows.filter(r => held.has(r.symbol)) : rows;
      earn.append(U.table([{ t: "Date", v: "date" }, { t: "Symbol", v: "symbol" }, { t: "Company", v: "name" }, { t: "When", v: "time" }, { t: "EPS est.", v: "epsForecast", n: true }, { t: "Last yr", v: "lastYearEPS", n: true }], sel.slice(0, 150), { onRow: (r) => app.openAsset({ id: "stock:" + r.symbol, cls: "stock", symbol: r.symbol, name: r.name }), empty: mine ? "None of your holdings or watchlist report in this window." : "No earnings found." }), U.status({ status: "Reference", source: "Nasdaq earnings calendar", note: "Dates can change; companies confirm close to the date." }));
    }, { loading: "Loading earnings…" });
    U.async(econ, async () => (await Promise.all(dates.map(d => D.calendar.economic(d).catch(() => [])))).flat(), (rows) => {
      econ.append(U.table([{ t: "Date", v: "date" }, { t: "GMT", v: "gmt" }, { t: "Country", v: "country" }, { t: "Event", v: "event" }, { t: "Consensus", v: "consensus", n: true }, { t: "Previous", v: "previous", n: true }, { t: "Actual", v: "actual", n: true }], rows.slice(0, 200)), U.status({ status: "Reference", source: "Nasdaq economic calendar" }));
    }, { loading: "Loading economic events…" });
    const list = app.store.cached("catalysts").slice().sort((a, b) => a.date.localeCompare(b.date));
    const f = { title: h("input", { type: "text", placeholder: "Event" }), date: h("input", { type: "date" }), symbol: h("input", { type: "text", placeholder: "Asset (optional)" }), impact: h("select", {}, ["High", "Medium", "Low"].map(x => h("option", {}, x))) };
    cats.append(U.table([{ t: "Date", v: "date" }, { t: "Asset", v: "symbol" }, { t: "Event", v: (c) => h("span", { class: c.done ? "faint" : "" }, c.title) }, { t: "Impact", v: "impact" }, { t: "Notes", v: (c) => h("span", { class: "small" }, c.note || "") }, { t: "", v: (c) => h("div", { class: "row" }, h("button", { class: "btn ghost sm", type: "button", onclick: async () => { await app.store.put("catalysts", c.id, Object.assign({}, c, { done: !c.done })); app.rerender(); } }, c.done ? "Reopen" : "Done"), h("button", { class: "btn ghost sm", type: "button", onclick: async () => { await app.store.remove("catalysts", c.id); app.rerender(); } }, "Delete")) }], list, { empty: "No catalysts tracked yet." }),
      h("div", { class: "form" }, U.field("Event", f.title), U.field("Date", f.date), U.field("Asset", f.symbol), U.field("Impact", f.impact), h("div", { class: "field" }, h("button", { class: "btn", type: "button", onclick: async () => { if (!f.title.value.trim() || !f.date.value) return; await app.store.create("catalysts", { title: f.title.value.trim(), date: f.date.value, symbol: f.symbol.value.toUpperCase(), impact: f.impact.value }); app.rerender(); } }, "Add catalyst"))),
      h("p", { class: "small muted" }, "Pokémon and Yu-Gi-Oh! release and banlist dates have no public API; add them here from the official sites."));
  };
})(typeof window !== "undefined" ? window : globalThis);
