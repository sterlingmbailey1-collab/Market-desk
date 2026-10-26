/* Stock screener (Opportunities → Stock screener): Nasdaq's screener of US-listed stocks filtered by exchange, sector and
   size, then by price and today's move in the page. Results go straight to the machine-learning scan, to Recommendations
   as the focus, to the watchlist or to a paper trade. The screener is a snapshot that can lag a session (its as-of is
   shown); asset pages show the live quote. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const U = MD.ui, D = MD.data, h = U.h;
  const SECTORS = [["", "Any sector"], ["technology", "Technology"], ["health_care", "Health care"], ["finance", "Finance"], ["consumer_discretionary", "Consumer discretionary"], ["consumer_staples", "Consumer staples"], ["industrials", "Industrials"], ["energy", "Energy"], ["utilities", "Utilities"], ["real_estate", "Real estate"], ["basic_materials", "Basic materials"], ["telecommunications", "Telecommunications"]];
  const SIZES = [["", "Any size"], ["mega", "Mega (over $200B)"], ["large", "Large ($10B–200B)"], ["mid", "Mid ($2B–10B)"], ["small", "Small ($300M–2B)"], ["micro", "Micro ($50M–300M)"]];
  const SORTS = { cap: ["Market cap", (r) => -(r.marketCap || 0)], up: ["Today's move, up first", (r) => -(r.changePct ?? -1e9)], down: ["Today's move, down first", (r) => r.changePct ?? 1e9], price: ["Price, high first", (r) => -(r.price || 0)] };
  const capFmt = (x) => !(x > 0) ? "—" : x >= 1e12 ? "$" + (x / 1e12).toFixed(2) + "T" : x >= 1e9 ? "$" + (x / 1e9).toFixed(1) + "B" : "$" + (x / 1e6).toFixed(0) + "M";
  const numOrNull = (v) => v === "" || v == null || !isFinite(Number(v)) ? null : Number(v);

  // The in-page filters (price and today's move) and the sort, kept pure for testing.
  function filterRows(rows, f) {
    const out = rows.filter(r => r.price > 0 && (f.minPrice == null || r.price >= f.minPrice) && (f.maxPrice == null || r.price <= f.maxPrice)
      && (f.minMove == null || (r.changePct != null && r.changePct >= f.minMove)) && (f.maxMove == null || (r.changePct != null && r.changePct <= f.maxMove)));
    const key = (SORTS[f.sort] || SORTS.cap)[1];
    return out.sort((a, b) => key(a) - key(b));
  }
  async function run(f) {
    const exs = f.exchange === "nyse" || f.exchange === "nasdaq" ? [f.exchange] : ["nyse", "nasdaq"];
    const res = await Promise.all(exs.map(x => D.stocks.screen({ exchange: x, sector: f.sector, size: f.size, limit: 200 })));
    const all = res.flatMap(r => r.rows);
    return { rows: filterRows(all, f), scanned: all.length, total: res.reduce((a, r) => a + (r.total || r.rows.length), 0), asOf: res.map(r => r.asOf).find(Boolean) || "", at: Date.now(), f };
  }
  const describe = (f) => [f.exchange === "nyse" ? "NYSE" : f.exchange === "nasdaq" ? "Nasdaq" : "NYSE + Nasdaq", (SECTORS.find(s => s[0] === f.sector) || [, ""])[1], (SIZES.find(s => s[0] === f.size) || [, ""])[1].replace(/ \(.*/, "") + (f.size ? " caps" : "")].filter(x => x && !/^Any/.test(x)).join(", ");

  function view(root, app) {
    const saved = app.ls.get("scr.f", {}), sel = (opts, v, label) => h("select", { "aria-label": label }, opts.map(([k, l]) => h("option", { value: k, selected: k === (v || "") }, l)));
    const f = { exchange: sel([["both", "NYSE + Nasdaq"], ["nyse", "NYSE only"], ["nasdaq", "Nasdaq only"]], saved.exchange || "both", "Exchange"), sector: sel(SECTORS, saved.sector, "Sector"), size: sel(SIZES, saved.size, "Company size"),
      minPrice: h("input", { type: "number", min: 0, step: "any", placeholder: "any", value: saved.minPrice ?? "", "aria-label": "Minimum price" }), maxPrice: h("input", { type: "number", min: 0, step: "any", placeholder: "any", value: saved.maxPrice ?? "", "aria-label": "Maximum price" }),
      minMove: h("input", { type: "number", step: "any", placeholder: "any", value: saved.minMove ?? "", "aria-label": "Today's move at least (%)" }), maxMove: h("input", { type: "number", step: "any", placeholder: "any", value: saved.maxMove ?? "", "aria-label": "Today's move at most (%)" }),
      sort: sel(Object.entries(SORTS).map(([k, [l]]) => [k, l]), saved.sort || "cap", "Sort") };
    const read = () => ({ exchange: f.exchange.value, sector: f.sector.value, size: f.size.value, minPrice: numOrNull(f.minPrice.value), maxPrice: numOrNull(f.maxPrice.value), minMove: numOrNull(f.minMove.value), maxMove: numOrNull(f.maxMove.value), sort: f.sort.value });
    const out = h("div", { class: "stack" }, h("div", { class: "empty" }, "Set the filters and run the screen.")), mlBox = h("div", { class: "stack" });
    const go = h("button", { class: "btn", type: "button" }, "Run screen");
    let last = null;
    const paint = () => {
      const r = last, top = r.rows.slice(0, 12);
      const watch = (a) => app.store.cached("watch").some(w => w.assetId === a.id);
      out.replaceChildren(
        h("div", { class: "row", style: "gap:8px;flex-wrap:wrap;align-items:center" }, h("span", { class: "pill" }, r.rows.length + " match" + (r.rows.length === 1 ? "" : "es")), h("span", { class: "small muted" }, "of the " + r.scanned + " largest checked (" + (r.total || r.scanned) + " listed for these filters) · " + describe(r.f))),
        r.rows.length ? h("div", { class: "row", style: "gap:8px;flex-wrap:wrap" },
          h("button", { class: "btn ghost sm", type: "button", onclick: (e) => mlScanTop(app, top.slice(0, 10), e.currentTarget) }, "Machine-learning scan of the top 10"),
          h("button", { class: "btn ghost sm", type: "button", onclick: () => { app.ctx.picks = { symbols: top.map(x => x.symbol), label: "your stock screen (" + describe(r.f) + ")" }; app.go("picks", app.ctx.picks); } }, "Recommendations from the top " + top.length),
          h("button", { class: "btn ghost sm", type: "button", onclick: async (e) => { let n = 0; for (const a of top.slice(0, 10)) if (!watch(a)) { await app.store.create("watch", Object.assign({ assetId: a.id }, MD.common.slim(a))); n++; } e.currentTarget.disabled = true; U.toast(n ? "Added " + n + " to the watchlist" : "Already on the watchlist"); } }, "Watch the top 10")) : null,
        mlBox,
        U.table([
          { t: "Stock", v: (a) => h("span", { class: "who sym" }, h("b", {}, a.symbol), h("span", { class: "tiny muted" }, a.exchange || "")) },
          { t: "Name", v: (a) => h("span", { class: "small" }, a.name) },
          { t: "Price", v: (a) => U.money(a.price, "USD", { price: true }), n: true },
          { t: "Today", v: (a) => a.changePct != null ? h("span", { class: U.signCls(a.changePct) }, U.pct(a.changePct)) : "—", n: true },
          { t: "Market cap", v: (a) => capFmt(a.marketCap), n: true },
          { t: "", v: (a) => h("div", { class: "row", style: "gap:4px;flex-wrap:nowrap" }, MD.paper ? MD.paper.button(app, a, { source: "screener", note: describe(r.f) }) : null) }],
          r.rows.slice(0, 100), { empty: "Nothing matches. Widen the price or move range, or pick another sector or size.", onRow: (a) => app.openAsset(a) }),
        h("p", { class: "tiny muted" }, "Nasdaq screener" + (r.asOf ? " · last price as of " + r.asOf : "") + " · fetched " + U.fmtTs(r.at) + ". The screener is a snapshot that can lag a session; each stock's page shows the live quote. Up to 200 of the largest companies per exchange are checked against the price and move filters; the first 100 matches are shown."));
    };
    go.onclick = async () => {
      const q = read(); app.ls.set("scr.f", q); go.disabled = true; out.replaceChildren(h("div", { class: "skeleton" }, "Screening…")); mlBox.replaceChildren();
      try { last = await run(q); paint(); } catch (e) { out.replaceChildren(U.errorBox({ message: U.errorText(e) })); }
      go.disabled = false;
    };
    async function mlScanTop(app, list, btn) {
      btn.disabled = true; const days = app.ls.get("ml.scanDays", 30);
      mlBox.replaceChildren(h("div", { class: "skeleton" }, "Training the machine-learning model on each…"));
      try { const res = await MD.watchScan.mlScan(app, days, (d, n) => { btn.textContent = "Trained " + d + " of " + n; }, list); mlBox.replaceChildren(U.section("Machine-learning scan of the screen", MD.watchScan.mlTable(app, res))); }
      catch (e) { mlBox.replaceChildren(U.errorBox({ message: U.errorText(e) })); }
      btn.disabled = false; btn.textContent = "Machine-learning scan of the top 10";
    }
    root.append(U.section("Stock screener", h("div", { class: "stack" },
      h("div", { class: "form" }, U.field("Exchange", f.exchange), U.field("Sector", f.sector), U.field("Company size", f.size), U.field("Sort by", f.sort)),
      h("div", { class: "form" }, U.field("Price from ($)", f.minPrice), U.field("Price to ($)", f.maxPrice), U.field("Today's move from (%)", f.minMove), U.field("Today's move to (%)", f.maxMove)),
      h("div", { class: "row" }, go),
      h("p", { class: "small muted" }, "US-listed stocks on the NYSE and Nasdaq from Nasdaq's screener (one data request per exchange). Send the results to the machine-learning scan, to Recommendations as a focus list, to your watchlist, or paper-trade one."), out)));
    if (saved.exchange) go.click();
  }

  MD.screener = { view, run, filterRows, describe, SECTORS, SIZES };
})(typeof window !== "undefined" ? window : globalThis);
