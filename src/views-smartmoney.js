/* Smart Money: members of Congress and well-known investors, ranked by how their disclosed trades and
   portfolios have done, with a page per person (trades, holdings, copy-trade backtest, projection,
   news and an AI read). Every number is measured by the page; the projection is a stated model. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const C = MD.core, U = MD.ui, D = MD.data, h = U.h, X = MD.common, M = MD.smart;
  const V = (MD.views = MD.views || {});
  const TTL = 12 * 3600e3;
  const WIN_LABEL = { All: "Since each trade", "1Y": "Last 1Y", "6M": "Last 6M", "3M": "Last 3M", "1M": "Last 1M" };

  /* ---------- shared state (survives tab switches; measured results are cached in the account) ---------- */
  const S = { map: new Map(), spy: null, spyP: null, spyErr: null, loading: null, progress: { done: 0, total: 0, failed: 0 }, listeners: new Set(), loadedAt: 0 };
  const emit = () => { for (const f of S.listeners) try { f(); } catch (e) { console.error(e); } };
  let emitTimer = 0;
  const emitSoon = () => { if (!emitTimer) emitTimer = setTimeout(() => { emitTimer = 0; emit(); }, 900); };
  async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; try { await fn(items[k], k); } catch {} } })); }
  const rf = (app) => Number(app.settings.assumptions.riskFreePct) || 4;
  const idOf = (kind, key) => kind + "_" + key;
  const fresh = (e) => e.status === "ready" && e.at && Date.now() - e.at < TTL;
  function ent(kind, key, name, extra) {
    const id = idOf(kind, key); let e = S.map.get(id);
    if (!e) { e = Object.assign({ id, kind, key, name, status: "idle" }, extra || {}); S.map.set(id, e); }
    return e;
  }
  for (const p of M.POLITICIANS) ent("pol", p.id, p.name);
  for (const v of M.INVESTORS) ent("inv", v.code, v.name, { firm: v.firm });
  function derive(e) {
    const rows = e.rows || [];
    e.sum = { All: M.summarize(rows, null) }; for (const [k, d] of M.WINDOWS) e.sum[k] = M.summarize(rows, d);
    e.listed = rows.filter(r => r.ticker).length; e.measured = rows.filter(r => r.ret != null).length;
  }
  function hydrate(app) {
    for (const d of app.store.cached("smcache")) {
      if (!d.kind || !d.key) continue;
      const e = ent(d.kind, d.key, d.name);
      if (e.at && e.at >= d.at) continue;
      Object.assign(e, { name: d.name || e.name, firm: d.firm || e.firm, page: d.page ? Object.assign({}, d.page, { trades: d.rows || d.page.trades || [] }) : null, rows: d.rows || null, volPct: d.volPct ?? null, since: d.since || null, curve: d.curve || null, at: d.at, status: "ready", cached: true });
      if (e.kind === "pol") derive(e);
    }
  }
  async function persist(app, e) {
    if (app.demo || !e.page) return;
    const page = Object.assign({}, e.page, { trades: [] });
    const doc = { kind: e.kind, key: e.key, name: e.name, firm: e.firm || "", page, at: e.at };
    if (e.kind === "pol") Object.assign(doc, { rows: e.rows || [], volPct: e.volPct ?? null }); else Object.assign(doc, { since: e.since || null, curve: e.curve || null });
    try { await app.store.put("smcache", e.id, JSON.parse(JSON.stringify(doc))); } catch {}
  }
  function getSpy() {
    if (S.spy) return Promise.resolve(S.spy);
    if (!S.spyP) S.spyP = M.closes("SPY", "3Y").then(p => (S.spy = p)).catch(e => { S.spyErr = e; S.spyP = null; return null; });
    return S.spyP;
  }
  async function tickerCloses(trades, syms) {
    syms = syms || [...new Set(trades.filter(t => t.ticker).map(t => t.ticker))];
    const oldest = trades.reduce((m, t) => !m || (t.traded && t.traded < m) ? t.traded : m, null), tf = M.tfFor(oldest);
    S.progress.total += syms.length; emitSoon();
    const map = new Map();
    await pool(syms, 3, async (s) => { try { map.set(s, await M.closes(s, tf)); } catch { map.set(s, []); S.progress.failed++; } S.progress.done++; emitSoon(); });
    return map;
  }
  async function loadPol(app, e) {
    e.status = "loading"; e.err = null; emitSoon();
    try { e.page = await M.politician(e.key, 2); }
    catch (err) { e.err = err; e.status = e.rows ? "ready" : "error"; emit(); return; }
    if (e.page.name) e.name = e.page.name;
    e.status = "measuring"; emitSoon();
    const [byTicker, spy] = await Promise.all([tickerCloses(e.page.trades), getSpy()]);
    e.byTicker = byTicker;
    e.rows = M.measureTrades(e.page.trades, byTicker, spy || []);
    const net = M.netPositions(e.page.trades).filter(x => x.net > 0);
    e.volPct = M.basketVol(net.map(x => ({ symbol: x.ticker, weight: x.net })), byTicker);
    derive(e); e.status = "ready"; e.at = Date.now(); e.cached = false; emit(); persist(app, e);
  }
  function sinceFiling(page, spy) {
    const hs = page.holdings.filter(x => x.changePct != null && x.weightPct > 0), W = hs.reduce((s, x) => s + x.weightPct, 0);
    const ret = W ? hs.reduce((s, x) => s + x.weightPct * x.changePct, 0) / W : null;
    const s0 = M.closeOn(spy, page.portfolioDate), sz = spy && spy.length ? spy[spy.length - 1] : null;
    const spyRet = s0 && sz ? (sz.close / s0.close - 1) * 100 : null;
    const kinds = (k) => page.holdings.filter(x => x.activityKind === k).length;
    const top10 = page.holdings.slice().sort((a, b) => b.weightPct - a.weightPct).slice(0, 10).reduce((s, x) => s + x.weightPct, 0);
    return { ret, spyRet, excess: ret != null && spyRet != null ? ret - spyRet : null, coveragePct: Math.min(100, W), n: hs.length, days: page.portfolioDate ? (Date.now() - Date.parse(page.portfolioDate)) / 864e5 : null, buys: kinds("Buy"), adds: kinds("Add"), reduces: kinds("Reduce"), sells: kinds("Sell"), top10Pct: top10 };
  }
  function splitManager(m) { const i = String(m || "").indexOf(" - "); return i > 0 ? [m.slice(0, i).trim(), m.slice(i + 3).trim()] : [String(m || "").trim(), ""]; }
  async function loadInv(app, e) {
    e.status = "loading"; e.err = null; emitSoon();
    try { e.page = await M.investor(e.key); }
    catch (err) { e.err = err; e.status = e.since ? "ready" : "error"; emit(); return; }
    if (e.page.manager) { const [n, f] = splitManager(e.page.manager); e.name = n || e.name; e.firm = f || e.firm; }
    e.since = sinceFiling(e.page, await getSpy());
    e.status = "ready"; e.at = Date.now(); e.cached = false; emit(); persist(app, e);
  }
  // Backtest of the current top holdings over the past year (for the projection's volatility and the per-period columns).
  async function measureInv(app, e) {
    if (!e.page) await loadInv(app, e); if (!e.page) return;
    const top = e.page.holdings.slice().sort((a, b) => b.weightPct - a.weightPct).slice(0, 12);
    const weights = top.map(x => ({ symbol: x.symbol, weight: x.weightPct }));
    const [map, spy] = await Promise.all([tickerCloses([], top.map(x => x.symbol)), getSpy()]);
    e.byTicker = map;
    const curve = M.basketCurve(weights, map, spy, 365), vol = M.basketVol(weights, map);
    e.curvePts = curve;
    const usedW = top.filter(x => (map.get(x.symbol) || []).length > 30).reduce((s, x) => s + x.weightPct, 0);
    e.curve = { periods: curve ? curve.periods : {}, volPct: vol, usedHoldings: curve ? curve.used : 0, portfolioPct: usedW, at: Date.now() };
    emit(); persist(app, e);
  }
  async function load(app, force) {
    if (S.loading) return S.loading;
    hydrate(app);
    S.progress = { done: 0, total: 0, failed: 0 };
    S.loading = (async () => {
      getSpy();
      const jobs = [];
      for (const e of S.map.values()) if (force || !fresh(e)) jobs.push(e.kind === "pol" ? loadPol(app, e) : loadInv(app, e));
      emit();
      await Promise.all(jobs);
      S.loadedAt = Date.now();
      await checkFollows(app).catch(() => {});
    })().finally(() => { S.loading = null; emit(); });
    return S.loading;
  }

  /* ---------- metrics ---------- */
  function measured(e, win) {
    if (e.kind === "pol") { const s = e.sum && e.sum[win]; return s && s.n ? { ret: s.ret, spy: s.spyRet, excess: s.excess, copy: s.retPub, n: s.n, hit: s.hitRate } : null; }
    if (win === "All") return e.since && e.since.ret != null ? { ret: e.since.ret, spy: e.since.spyRet, excess: e.since.excess, n: e.since.n } : null;
    const p = e.curve && e.curve.periods && e.curve.periods[win];
    return p ? { ret: p.ret, spy: p.spy, excess: p.ret - p.spy, n: e.curve.usedHoldings } : null;
  }
  function projection(app, e) {
    if (e.kind === "pol") { const s = e.sum && e.sum.All; return s && s.n ? M.project({ excessPct: s.excess, years: s.years, n: s.n, k: 20, volPct: e.volPct, riskFreePct: rf(app) }) : null; }
    if (!e.since || e.since.ret == null) return null;
    const p1 = e.curve && e.curve.periods && e.curve.periods["1Y"];
    return p1 ? M.project({ excessPct: p1.ret - p1.spy, years: 1, n: 1, k: 3, volPct: e.curve.volPct, riskFreePct: rf(app) })
      : M.project({ excessPct: e.since.excess, years: Math.max(0.25, (e.since.days || 90) / 365), n: 1, k: 4, volPct: e.curve && e.curve.volPct, riskFreePct: rf(app) });
  }
  const usd = (n) => n == null || !isFinite(n) ? "—" : n >= 1e9 ? "$" + (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + "B" : n >= 1e6 ? "$" + (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M" : n >= 1e3 ? "$" + Math.round(n / 1e3) + "K" : "$" + Math.round(n);
  const sub = (e) => e.kind === "pol" ? [e.page && e.page.chamber, e.page && e.page.state].filter(Boolean).join(" · ") || "Congress" : e.firm || "13F filer";
  const partyChip = (e) => e.kind === "pol" && e.page && e.page.party ? h("span", { class: "party " + e.page.party, title: e.page.party }, e.page.party[0]) : e.kind === "inv" ? h("span", { class: "party inv", title: "Investor (13F)" }, "13F") : null;
  const assetOf = (sym, name) => ({ id: "stock:" + sym, cls: "stock", symbol: sym, name: name || sym });
  function mySymbols(app) {
    const out = new Map();
    const { positions } = C.buildPositions(app.store.cached("tx"));
    for (const p of positions.values()) if (p.qty.gt(0) && p.symbol) out.set(String(p.symbol).toUpperCase(), "holding");
    for (const w of app.store.cached("watch")) if (w.symbol && !out.has(String(w.symbol).toUpperCase())) out.set(String(w.symbol).toUpperCase(), "watchlist");
    return out;
  }
  // Who among the tracked people holds or recently bought a ticker (from what's already loaded or cached; never fetches).
  function whoOwns(app, symbol) {
    hydrate(app);
    const sym = String(symbol || "").toUpperCase(), out = [];
    for (const e of S.map.values()) {
      if (!e.page) continue;
      if (e.kind === "inv") { const x = e.page.holdings.find(y => y.symbol === sym); if (x) out.push({ name: e.name, kind: "inv", key: e.key, note: x.weightPct.toFixed(1) + "% of portfolio" + (x.activity ? " · " + x.activity : "") + " (13F " + (e.page.period || "") + ")" }); }
      else { const ts = (e.page.trades || []).filter(t => t.ticker === sym); if (ts.length) { const last = ts[0]; out.push({ name: e.name, kind: "pol", key: e.key, note: ts.length + " disclosed trade" + (ts.length > 1 ? "s" : "") + " · latest " + last.type + " " + (last.size ? last.size.label : "") + " on " + last.traded }); } }
    }
    return out;
  }

  /* ---------- follows ---------- */
  const follows = (app) => app.store.cached("follows");
  const followOf = (app, e) => follows(app).find(f => f.id === e.id);
  function newCount(app, e) {
    const f = followOf(app, e); if (!f || !e.page) return 0;
    if (e.kind === "pol") return (e.page.trades || []).filter(t => t.published && t.published > (f.seenUpTo || "")).length;
    return e.page.period && e.page.period !== f.seenPeriod ? 1 : 0;
  }
  const latestPub = (e) => (e.page && e.page.trades || []).reduce((m, t) => t.published && t.published > m ? t.published : m, "");
  async function toggleFollow(app, e) {
    const f = followOf(app, e);
    if (f) { await app.store.remove("follows", e.id); U.toast("Stopped following " + e.name); }
    else { await app.store.put("follows", e.id, { kind: e.kind, key: e.key, name: e.name, seenUpTo: latestPub(e), seenPeriod: e.page && e.page.period || null, notifiedUpTo: latestPub(e) }); U.toast("Following " + e.name, e.kind === "pol" ? "New disclosed trades will appear in your inbox when this page loads." : "A new 13F filing will appear in your inbox when this page loads."); }
  }
  async function markSeen(app, e) {
    const f = followOf(app, e); if (!f || !e.page || app.demo) return;
    const up = latestPub(e);
    if ((e.kind === "pol" && up && up !== f.seenUpTo) || (e.kind === "inv" && e.page.period && e.page.period !== f.seenPeriod)) await app.store.put("follows", e.id, Object.assign({}, f, { seenUpTo: up || f.seenUpTo, seenPeriod: e.page.period || f.seenPeriod, notifiedUpTo: up || f.notifiedUpTo })).catch(() => {});
  }
  async function checkFollows(app) {
    for (const f of follows(app)) {
      const e = S.map.get(f.id); if (!e || !e.page) continue;
      if (e.kind === "pol") {
        const fresh = (e.page.trades || []).filter(t => t.published && t.published > (f.notifiedUpTo || f.seenUpTo || ""));
        if (!fresh.length) continue;
        const tick = [...new Set(fresh.map(t => (t.type === "buy" ? "+" : t.type === "sell" ? "−" : "") + (t.ticker || t.issuer)))].slice(0, 8).join(", ");
        await app.store.create("inbox", { kind: "smart", title: e.name + " disclosed " + fresh.length + " new trade" + (fresh.length > 1 ? "s" : ""), body: tick + ". Source: Capitol Trades (STOCK Act filings).", materiality: 1, read: false, at: Date.now() });
        await app.store.put("follows", f.id, Object.assign({}, f, { notifiedUpTo: latestPub(e) }));
      } else if (e.page.period && e.page.period !== f.seenPeriod && e.page.period !== f.notifiedPeriod) {
        await app.store.create("inbox", { kind: "smart", title: e.name + " filed a new 13F (" + e.page.period + ")", body: "Portfolio date " + e.page.portfolioDate + ". Source: Dataroma.", materiality: 1, read: false, at: Date.now() });
        await app.store.put("follows", f.id, Object.assign({}, f, { notifiedPeriod: e.page.period }));
      }
    }
  }

  /* ---------- page ---------- */
  V.smartmoney = function (root, app) {
    const ctx = app.ctx.smartmoney || {};
    hydrate(app);
    if (ctx.person) { root.append(app.backBar()); return ctx.person.kind === "inv" ? invDetail(root, app, ctx.person.key) : polDetail(root, app, ctx.person.key); }
    const tab = app.ls.get("sm.tab", "leaders");
    root.append(MD.marketsHelpers.head("Smart Money", "What members of Congress and well-known investors disclose buying and selling, how those trades have done against the S&P 500 (SPY), and a stated model of what copying them might return."),
      h("div", { class: "banner info" }, h("p", {}, "Disclosures arrive late: Congress members have up to 45 days to report a trade, and 13F portfolios are filed up to 45 days after each quarter. Trade sizes are disclosed as ranges. A disclosed trade does not show why it was made and is not evidence of wrongdoing or of an edge. Past returns don't predict future ones; nothing here is advice.")),
      U.tabs([["leaders", "Leaderboard"], ["consensus", "Most bought"], ["latest", "Latest filings"], ["method", "How it's measured"]], tab, (k) => { app.ls.set("sm.tab", k); app.rerender(); }));
    const body = h("div", { class: "stack" }); root.append(body);
    const cleanups = [];
    ({ leaders: leaderboard, consensus: consensusView, latest: filingsView, method: methodView }[tab] || leaderboard)(body, app, cleanups);
    return () => cleanups.forEach(f => f());
  };
  const open = (app, e) => app.openPerson({ kind: e.kind, key: e.key, name: e.name });
  function subscribe(cleanups, f) { S.listeners.add(f); cleanups.push(() => S.listeners.delete(f)); }
  function progressLine() {
    const el = h("div", { class: "small muted" });
    const paint = () => {
      const p = S.progress, ents = [...S.map.values()], busy = ents.filter(e => e.status === "loading" || e.status === "measuring").length, errs = ents.filter(e => e.status === "error").length;
      el.replaceChildren(S.loading ? h("span", {}, h("span", { class: "spin sm" }), " Loading " + busy + " of " + ents.length + " people" + (p.total ? " · prices " + p.done + " of " + p.total + " tickers" + (p.failed ? " (" + p.failed + " unavailable)" : "") : "") + "…") : h("span", {}, S.loadedAt || ents.some(e => e.at) ? "Measured " + U.fmtTs(Math.max(S.loadedAt, ...ents.map(e => e.at || 0))) + (ents.some(e => e.cached) ? " (from your saved results; refreshed every 12 hours)" : "") : ""), errs ? h("span", { class: "warn-t" }, " · " + errs + " couldn't be read: " + ents.filter(e => e.status === "error").map(e => e.name).join(", ")) : null);
    };
    el.paint = paint; paint(); return el;
  }

  function leaderboard(body, app, cleanups) {
    const st = Object.assign({ group: "all", win: "All", follow: false }, app.ls.get("sm.lb", {}));
    const save = () => app.ls.set("sm.lb", st);
    const prog = progressLine();
    const podium = h("div", { class: "podium" });
    const tableBox = h("div", { class: "stack" });
    const GROUPS = [["all", "Everyone"], ["pol", "Congress"], ["inv", "Investors"]];
    const groupSeg = U.seg(GROUPS.map(g => g[1]), GROUPS.find(g => g[0] === st.group)[1], (l) => { st.group = GROUPS.find(g => g[1] === l)[0]; save(); app.rerender(); });
    const winSeg = U.seg(["All", "1Y", "6M", "3M", "1M"].map(k => WIN_LABEL[k]), WIN_LABEL[st.win], (l) => { st.win = Object.keys(WIN_LABEL).find(k => WIN_LABEL[k] === l); save(); app.rerender(); });
    const fol = h("label", { class: "chk" }, h("input", { type: "checkbox", checked: st.follow, onchange: (ev) => { st.follow = ev.target.checked; save(); paint(); } }), "Following only");
    const measureBtn = h("button", { class: "btn ghost sm", type: "button", onclick: async () => { measureBtn.disabled = true; measureBtn.textContent = "Measuring portfolios…"; for (const e of [...S.map.values()].filter(x => x.kind === "inv")) await measureInv(app, e).catch(() => {}); measureBtn.textContent = "Portfolios measured"; } }, "Measure investors' 1M–1Y");
    body.append(h("div", { class: "row between", style: "flex-wrap:wrap;gap:10px" }, h("div", { class: "row", style: "flex-wrap:wrap;gap:8px" }, groupSeg, winSeg, fol), h("div", { class: "row" }, measureBtn, h("button", { class: "btn ghost sm", type: "button", onclick: () => load(app, true) }, "Refresh"))), prog, podium, tableBox);
    const rowsFor = () => [...S.map.values()].filter(e => (st.group === "all" || e.kind === st.group) && (!st.follow || followOf(app, e))).map(e => ({ e, m: measured(e, st.win), p: projection(app, e), name: e.name, symbol: e.name }));
    const projCell = (k) => ({ t: "Projected " + k, n: true, sort: (r) => r.p && r.p.horizons[k].mean, v: (r) => { const x = r.p && r.p.horizons[k]; if (!x) return h("span", { class: "faint" }, "—"); return h("span", { class: "projcell" }, U.chg(x.mean, 1), x.p05 != null ? h("span", { class: "tiny muted num" }, C.fmtNum(x.p05, 0) + " to " + C.fmtNum(x.p95, 0) + "%") : null); } });
    const cols = [
      { t: "", v: (r) => h("button", { class: "star", type: "button", "aria-pressed": String(!!followOf(app, r.e)), "aria-label": (followOf(app, r.e) ? "Unfollow " : "Follow ") + r.e.name, onclick: async (ev) => { ev.stopPropagation(); await toggleFollow(app, r.e); paint(); } }, followOf(app, r.e) ? "★" : "☆") },
      { t: "Person", sort: (r) => r.e.name, v: (r) => h("span", { class: "who" }, h("span", { class: "row", style: "gap:6px;flex-wrap:nowrap" }, partyChip(r.e), h("b", {}, r.e.name), newCount(app, r.e) ? h("span", { class: "newb" }, r.e.kind === "pol" ? newCount(app, r.e) + " new" : "new 13F") : null), h("span", { class: "tiny muted" }, sub(r.e))) },
      { t: WIN_LABEL[st.win] === "Since each trade" ? "Return" : "Return · " + st.win, n: true, sort: (r) => r.m ? r.m.ret : null, v: (r) => r.m ? h("span", { class: "projcell" }, h("b", {}, U.chg(r.m.ret, 1)), h("span", { class: "tiny muted num" }, r.e.kind === "pol" ? r.m.n + " buy" + (r.m.n === 1 ? "" : "s") : st.win === "All" ? "since " + (r.e.page ? U.fmtDate(r.e.page.portfolioDate) : "filing") : "top holdings")) : statusCell(r.e, st.win) },
      { t: "vs SPY", n: true, sort: (r) => r.m ? r.m.excess : null, v: (r) => r.m && r.m.excess != null ? U.chg(r.m.excess, 1) : "—" },
      { t: "Copy return", n: true, sort: (r) => r.m ? r.m.copy : null, v: (r) => r.e.kind === "pol" && r.m && r.m.copy != null ? h("span", { title: "From each filing's publish date, the first day a follower could act" }, U.chg(r.m.copy, 1)) : h("span", { class: "faint", title: r.e.kind === "inv" ? "13F returns already start at the portfolio date" : "" }, "—") },
      projCell("1M"), projCell("3M"), projCell("6M"), projCell("1Y"),
      { t: "Activity", sort: (r) => r.e.kind === "pol" ? (r.e.page && r.e.page.lastTraded) || "" : (r.e.page && r.e.page.portfolioDate) || "", v: (r) => !r.e.page ? "—" : r.e.kind === "pol" ? h("span", { class: "projcell" }, h("span", {}, (r.e.page.tradesCount || r.e.page.trades.length) + " trades"), h("span", { class: "tiny muted" }, "last " + (r.e.page.lastTraded || "—"))) : h("span", { class: "projcell" }, h("span", {}, r.e.page.stocksCount + " stocks · " + usd(r.e.page.value)), h("span", { class: "tiny muted" }, r.e.page.period || "")) }];
    const table = U.dataTable(cols, rowsFor(), { key: "sm.lb." + st.win, sort: [2, -1], noun: "people", placeholder: "Filter by name…", text: (r) => r.e.name + " " + sub(r.e) + " " + (r.e.page && r.e.page.party || ""), onRow: (r) => open(app, r.e) });
    tableBox.append(table, h("p", { class: "tiny muted" }, "Return: Congress = size-weighted return of disclosed buys from each trade date to the latest close (about the last 30 trades per member; ", st.win === "All" ? "all of them" : "only buys made in the window", "). Investors = 13F holdings since the portfolio date", st.win === "All" ? "" : "; for 1M–1Y, the current top holdings held over that window (press “Measure investors' 1M–1Y”)", ". Projected = the model's expected return (5–95% range when volatility is measured); see “How it's measured”."));
    function paint() {
      prog.paint();
      const rows = rowsFor();
      table.update(rows);
      const top = rows.filter(r => r.m && r.m.ret != null).sort((a, b) => b.m.ret - a.m.ret).slice(0, 3);
      podium.replaceChildren(...top.map((r, i) => h("button", { class: "pod", type: "button", onclick: () => open(app, r.e) },
        h("span", { class: "pod-rank" }, ["1st", "2nd", "3rd"][i]), h("span", { class: "row", style: "gap:6px" }, partyChip(r.e), h("b", {}, r.e.name)), h("span", { class: "tiny muted" }, sub(r.e)),
        h("span", { class: "pod-ret num " + U.signCls(r.m.ret) }, U.pct(r.m.ret, 1)), h("span", { class: "tiny muted" }, (r.m.excess != null ? U.pct(r.m.excess, 1) + " vs SPY · " : "") + WIN_LABEL[st.win].toLowerCase()),
        r.p ? h("span", { class: "tiny" }, "Model 1Y: ", h("b", { class: U.signCls(r.p.horizons["1Y"].mean) }, U.pct(r.p.horizons["1Y"].mean, 1))) : null)));
    }
    subscribe(cleanups, paint);
    paint();
    if (!S.loading && [...S.map.values()].some(e => !fresh(e))) load(app);
    body.append(modelSection(app));
  }
  /* Smart-money model portfolio: today's best measured performers (5 Congress members with at least 3 priced buys,
     3 investors), each given an equal share split across their disclosed net buying or top holdings, then
     backtested over the past year against SPY. Built from hindsight, so it is a research view, not a strategy. */
  function modelPortfolio(app) {
    const ents = [...S.map.values()];
    const pols = ents.filter(e => e.kind === "pol" && e.page && e.sum && e.sum.All && e.sum.All.n >= 3).sort((a, b) => (b.sum.All.excess ?? -1e9) - (a.sum.All.excess ?? -1e9)).slice(0, 5);
    const invs = ents.filter(e => e.kind === "inv" && e.page && e.since && e.since.excess != null).sort((a, b) => b.since.excess - a.since.excess).slice(0, 3);
    const people = pols.concat(invs); if (!people.length) return null;
    const w = new Map(), who = new Map();
    for (const e of people) {
      const parts = e.kind === "pol" ? M.netPositions(e.page.trades).filter(x => x.net > 0).map(x => [x.ticker, x.net, x.issuer]) : e.page.holdings.slice().sort((a, b) => b.weightPct - a.weightPct).slice(0, 10).map(x => [x.symbol, x.weightPct, x.name]);
      const tot = parts.reduce((s, x) => s + x[1], 0); if (!tot) continue;
      for (const [sym, val, name] of parts) { w.set(sym, (w.get(sym) || 0) + val / tot / people.length); if (!who.has(sym)) who.set(sym, { name, people: [] }); who.get(sym).people.push(e.name); }
    }
    const rows = [...w.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15), sum = rows.reduce((s, x) => s + x[1], 0);
    return { people: people.map(e => ({ name: e.name, kind: e.kind })), rows: rows.map(([symbol, x]) => ({ symbol, weight: x / sum, name: who.get(symbol).name, people: who.get(symbol).people })) };
  }
  function modelSection(app) {
    const out = h("div", { class: "stack" });
    const btn = h("button", { class: "btn ghost", type: "button", onclick: async () => {
      const mp = modelPortfolio(app); if (!mp) { out.replaceChildren(h("div", { class: "empty" }, "Load the leaderboard first.")); return; }
      btn.disabled = true; out.replaceChildren(h("div", { class: "skeleton" }, "Pricing " + mp.rows.length + " holdings over the past year…"));
      const [map, spy] = await Promise.all([tickerCloses([], mp.rows.map(r => r.symbol)), getSpy()]);
      const weights = mp.rows.map(r => ({ symbol: r.symbol, weight: r.weight })), cv = M.basketCurve(weights, map, spy, 365), vol = M.basketVol(weights, map);
      const p1 = cv && cv.periods["1Y"], proj = p1 ? M.project({ excessPct: p1.ret - p1.spy, years: 1, n: 1, k: 3, volPct: vol, riskFreePct: rf(app) }) : null;
      btn.disabled = false;
      const box = h("div", { class: "chartbox" });
      out.replaceChildren(
        h("p", { class: "small" }, "Built from: " + mp.people.map(p => p.name + (p.kind === "inv" ? " (13F)" : "")).join(", ") + "."),
        U.table([{ t: "Stock", v: (r) => h("span", { class: "who sym" }, h("b", {}, r.symbol), h("span", { class: "tiny muted" }, String(r.name || "").slice(0, 28))) }, { t: "Weight", v: (r) => (r.weight * 100).toFixed(1) + "%", n: true }, { t: "From", v: (r) => h("span", { class: "small" }, r.people.join(", ")) }], mp.rows, { onRow: (r) => app.openAsset(assetOf(r.symbol, r.name)) }),
        cv ? h("div", { class: "stack" }, box, h("div", { class: "legend-row" }, h("span", {}, h("span", { class: "swatch", style: "background:" + U.tok("--accent") }), "Model portfolio"), h("span", {}, h("span", { class: "swatch", style: "background:" + U.tok("--bench") }), "SPY")),
          U.table([{ t: "Period", v: "k" }, { t: "Model", v: (r) => U.chg(r.ret, 1), n: true }, { t: "SPY", v: (r) => U.chg(r.spy, 1), n: true }, { t: "Excess", v: (r) => U.chg(r.ret - r.spy, 1), n: true }], M.WINDOWS.map(([k]) => Object.assign({ k }, cv.periods[k])).filter(r => r.ret != null))) : h("p", { class: "small warn-t" }, "Not enough price history to backtest."),
        proj ? h("p", { class: "small" }, h("strong", {}, "Model's next-year expectation: "), U.pct(proj.horizons["1Y"].mean, 1) + (proj.horizons["1Y"].p05 != null ? " (5–95%: " + C.fmtNum(proj.horizons["1Y"].p05, 0) + "% to " + C.fmtNum(proj.horizons["1Y"].p95, 0) + "%)" : "") + ", volatility " + (vol ? vol.toFixed(1) + "%" : "—") + ".") : null,
        h("div", { class: "row" }, h("button", { class: "btn ghost sm", type: "button", onclick: async (ev) => { const have = new Set(app.store.cached("watch").map(w => w.symbol)); let n = 0; for (const r of mp.rows) if (!have.has(r.symbol)) { const a = assetOf(r.symbol, r.name); await app.store.create("watch", Object.assign({ assetId: a.id }, a)); n++; } ev.target.textContent = n + " added to watchlist"; ev.target.disabled = true; } }, "Add all to watchlist")),
        h("p", { class: "tiny muted" }, "Hindsight warning: these are today's best measured performers, so the backtest flatters the idea. Disclosures lag weeks, Congress trade sizes are ranges, and 13F data is up to 45 days old. A research view, not a strategy or advice."));
      if (cv) setTimeout(() => { if (document.body.contains(box)) U.chart(box, { kind: "line", points: cv.points, intraday: false }, { compare: [{ label: "SPY", points: cv.spy }], fmt: (x) => x.toFixed(1) }); }, 0);
    } }, "Build the smart-money model portfolio");
    return U.section("Smart-money model portfolio", h("div", { class: "stack" }, h("p", { class: "small muted" }, "Combines what the best measured performers are buying (top 5 Congress members by excess return with at least 3 priced buys, top 3 investors since their latest 13F) into one portfolio, each person weighted equally, and tests it over the past year against SPY."), btn, out));
  }
  function statusCell(e, win) {
    if (e.status === "loading" || e.status === "measuring") return h("span", { class: "tiny muted" }, h("span", { class: "spin sm" }), e.status === "loading" ? " reading" : " pricing");
    if (e.status === "error") return h("span", { class: "tiny warn-t", title: U.errorText(e.err) }, "unavailable");
    if (e.kind === "inv" && win !== "All") return h("span", { class: "tiny faint" }, "not measured");
    if (e.kind === "pol" && e.sum && e.sum.All && e.sum.All.n === 0) return h("span", { class: "tiny faint" }, "no listed buys");
    return h("span", { class: "tiny faint" }, "no buys in window");
  }

  function consensusView(body, app, cleanups) {
    const prog = progressLine(), box = h("div", { class: "stack" }), mine = h("div", { class: "stack" });
    body.append(prog, U.section("Most bought by the people tracked", box), U.section("Your overlap", mine));
    const paint = () => {
      prog.paint();
      const ents = [...S.map.values()].filter(e => e.page);
      const rows = M.consensus(ents.filter(e => e.kind === "pol").map(e => ({ name: e.name, trades: e.page.trades || [] })), ents.filter(e => e.kind === "inv").map(e => ({ name: e.name, holdings: e.page.holdings || [] }))).slice(0, 80);
      const my = mySymbols(app);
      box.replaceChildren(rows.length ? U.dataTable([
        { t: "Stock", sort: (r) => r.symbol, v: (r) => h("span", { class: "who sym" }, h("b", {}, r.symbol), h("span", { class: "tiny muted" }, String(r.name || "").slice(0, 34))) },
        { t: "People", n: true, sort: (r) => r.people, v: (r) => h("b", {}, String(r.people)) },
        { t: "Congress buyers (90 days)", sort: (r) => r.politicians.length, v: (r) => r.politicians.length ? h("span", { class: "small" }, r.politicians.join(", "), r.boughtUSD ? h("span", { class: "tiny muted" }, " · ~" + usd(r.boughtUSD) + " disclosed") : null) : h("span", { class: "faint" }, "—") },
        { t: "Investors buying or adding (latest 13F)", sort: (r) => r.investors.length, v: (r) => r.investors.length ? h("span", { class: "small" }, r.investors.join(", ")) : h("span", { class: "faint" }, "—") },
        { t: "Congress sells", n: true, sort: (r) => r.sold, v: (r) => r.sold ? String(r.sold) : "—" },
        { t: "You", v: (r) => my.has(r.symbol) ? h("span", { class: "pill ok" }, my.get(r.symbol)) : "" },
        { t: "", v: (r) => h("div", { class: "row" }, h("button", { class: "btn ghost sm", type: "button", onclick: (ev) => { ev.stopPropagation(); app.go("research", { asset: assetOf(r.symbol, r.name), prefill: "Several closely watched buyers disclosed buying " + r.symbol + " recently (" + r.politicians.concat(r.investors).join(", ") + "). Is it a good investment now, and what are they likely seeing?" }); } }, "Research")) }],
        rows, { key: "sm.cons", sort: [1, -1], noun: "stocks", placeholder: "Filter by ticker…", text: (r) => r.symbol + " " + r.name + " " + r.politicians.join(" ") + " " + r.investors.join(" "), onRow: (r) => app.openAsset(assetOf(r.symbol, r.name)) })
        : h("div", { class: "empty" }, S.loading ? "Reading filings…" : "No recent buys found yet."),
        h("p", { class: "tiny muted" }, "Congress: buys disclosed with a trade date in the last 90 days, with the size midpoint summed. Investors: positions their latest 13F shows as a new buy or an add. Being bought by several people is not a signal that a stock will rise."));
      const syms = [...my.keys()];
      const hits = syms.map(s => ({ s, who: whoOwns(app, s) })).filter(x => x.who.length);
      mine.replaceChildren(!syms.length ? h("div", { class: "empty" }, "Add holdings or watchlist items to see which tracked people own or trade them.") : !hits.length ? h("div", { class: "empty" }, "None of your " + syms.length + " holdings and watchlist items appear in the tracked trades and portfolios yet.")
        : h("div", { class: "stack" }, hits.map(x => h("div", { class: "card", style: "padding:10px 12px" }, h("div", { class: "row between" }, h("b", {}, x.s), h("span", { class: "pill" }, my.get(x.s))), h("ul", { class: "small", style: "margin:6px 0 0;padding-left:1.1em;display:grid;gap:3px" }, x.who.map(w => h("li", {}, h("button", { class: "linkbtn", type: "button", onclick: () => app.openPerson(w) }, w.name), " — ", w.note)))))));
    };
    subscribe(cleanups, paint); paint();
    if (!S.loading && [...S.map.values()].some(e => !fresh(e))) load(app);
  }

  function filingsView(body, app) {
    const box = h("div", { class: "stack" });
    body.append(U.section("Latest House and Senate disclosures", box));
    const tracked = new Map(M.POLITICIANS.map(p => [p.id, p]));
    U.async(box, () => M.latestFilings(60), (rows) => {
      box.append(U.dataTable([
        { t: "Disclosed", sort: (r) => r.disclosed, v: (r) => U.fmtDate(r.disclosed) },
        { t: "Traded", sort: (r) => r.traded, v: (r) => U.fmtDate(r.traded) },
        { t: "Member", sort: (r) => r.member, v: (r) => h("span", { class: "who" }, h("b", {}, r.member), h("span", { class: "tiny muted" }, r.chamber + (r.district ? " · " + r.district : "") + (tracked.has(r.bioguide) ? " · tracked" : ""))) },
        { t: "Asset", sort: (r) => r.symbol || r.asset, v: (r) => h("span", { class: "who" }, h("b", {}, r.symbol || "—"), h("span", { class: "tiny muted" }, String(r.asset).slice(0, 40))) },
        { t: "Type", sort: (r) => r.type, v: (r) => h("span", { class: "verdict sm " + (r.type === "buy" ? "positive" : r.type === "sell" ? "negative" : "neutral") }, r.typeLabel || r.type) },
        { t: "Size", sort: (r) => r.size && r.size.mid, n: true, v: (r) => r.size ? r.size.label : "—" },
        { t: "Owner", v: (r) => r.owner || "—" },
        { t: "Filing", v: (r) => r.link ? h("a", { href: r.link, target: "_blank", rel: "noopener noreferrer", onclick: (ev) => ev.stopPropagation() }, "Official record") : "—" }],
        rows, { key: "sm.latest", sort: [0, -1], noun: "disclosures", placeholder: "Filter by member or ticker…", text: (r) => r.member + " " + (r.symbol || "") + " " + r.asset, onRow: (r) => tracked.has(r.bioguide) ? app.openPerson({ kind: "pol", key: r.bioguide, name: r.member }) : r.symbol ? app.openAsset(assetOf(r.symbol, r.asset)) : null }),
        h("p", { class: "tiny muted" }, "From your FMP connector (latest filings only on your plan). Each row links to the official House or Senate record. Members marked “tracked” open their Smart Money page; other rows open the stock."));
    }, { loading: "Loading the latest filings from FMP…" });
  }

  function methodView(body, app) {
    const m = rf(app) + M.EQUITY_PREMIUM_PCT;
    body.append(U.section("How it's measured", h("div", { class: "prose stack" },
      h("p", {}, h("strong", {}, "Congress. "), "Each tracked member's most recent disclosed trades (about 30, from their Capitol Trades pages) are priced with daily closes (Nasdaq, Twelve Data as backup). A buy's return runs from the close on the trade date to the latest close, whether or not the position is still held, and is weighted by the midpoint of its disclosed size range. SPY over the same dates is the benchmark. “Copy return” starts at the publish date instead, the first day anyone outside could have acted."),
      h("p", {}, h("strong", {}, "Investors. "), "Dataroma's copy of each manager's latest 13F: holdings, weights, the price at the portfolio date and Dataroma's current price. The return is the weighted change since the portfolio date. For 1M–1Y the page prices the current top 12 holdings over each window; that is how today's portfolio would have done, not what the manager earned (positions changed during the year)."),
      h("p", {}, h("strong", {}, "Projection. "), "A log-normal model per person: expected return = a long-run market return of " + m.toFixed(1) + "% a year (risk-free " + rf(app) + "% from Settings + " + M.EQUITY_PREMIUM_PCT + "% equity premium) plus their measured excess return over SPY, annualized, capped at ±40% and shrunk toward zero by the amount of evidence (n ÷ (n + 20) for n scored buys; one 13F quarter counts as little). The 5–95% range uses the measured volatility of their current positions. It is a model of what copying might return if the past pattern partly persisted, not a forecast by anyone, and real outcomes vary far more."),
      h("p", {}, h("strong", {}, "Limits. "), "Sizes are ranges, so weights are approximate. Options, private funds and non-US securities aren't priced. Spouse and managed-account trades are included as filed. Prices are end-of-day. A few dozen trades is a small sample: a high rank can be luck."))));
  }

  /* ---------- detail pages ---------- */
  function hero(app, e, facts, links) {
    const fol = h("button", { class: "btn ghost sm", type: "button" });
    const sync = () => { const f = followOf(app, e); fol.textContent = f ? "★ Following" : "☆ Follow"; fol.setAttribute("aria-pressed", String(!!f)); };
    fol.onclick = async () => { await toggleFollow(app, e); sync(); }; sync();
    return h("div", { class: "hero" }, h("div", { class: "smhead" },
      h("div", { class: "stack", style: "gap:4px;min-width:0" }, h("div", { class: "row", style: "gap:8px" }, partyChip(e), h("span", { class: "label" }, e.kind === "pol" ? "Member of Congress" : "Superinvestor")), h("h1", { class: "page" }, e.name), h("p", { class: "sub" }, facts)),
      h("div", { class: "row", style: "flex-wrap:wrap" }, fol, links)));
  }
  const kpi = (label, v, s, cls) => h("div", { class: "kpi " + (cls || "") }, h("span", { class: "label" }, label), h("span", { class: "v" }, v), s ? h("span", { class: "s" }, s) : null);
  function projSection(app, e, p, note) {
    if (!p) return U.section("Projected return if you copied", h("div", { class: "empty" }, "Not enough measured data for a projection yet."));
    const rows = M.WINDOWS.map(([k]) => Object.assign({ k }, p.horizons[k]));
    return U.section("Projected return if you copied", h("div", { class: "stack" },
      U.table([{ t: "Horizon", v: "k" }, { t: "Expected (mean)", v: (r) => U.chg(r.mean, 1), n: true }, { t: "Median", v: (r) => r.p50 != null ? U.chg(r.p50, 1) : "—", n: true }, { t: "5–95% range", v: (r) => r.p05 != null ? h("span", { class: "num" }, C.fmtNum(r.p05, 1) + "% to " + C.fmtNum(r.p95, 1) + "%") : "needs volatility", n: true }, { t: "Chance of a gain", v: (r) => r.probUp != null ? r.probUp.toFixed(0) + "%" : "—", n: true }], rows),
      U.kv([["Market assumption", p.marketPct.toFixed(1) + "% a year"], ["Measured excess (annualized, capped)", U.pct(p.alphaAnnPct, 1)], ["Weight given to it", (p.shrink * 100).toFixed(0) + "%"], ["Model return", U.pct(p.driftPct, 1) + " a year"], ["Volatility", p.volPct ? p.volPct.toFixed(1) + "% (measured)" : "not measured"]]),
      h("p", { class: "tiny muted" }, note || "A stated model, not a prediction: expected return = market assumption + the measured excess return shrunk by the amount of evidence. See Smart Money → How it's measured.")));
  }
  function chartSection(title, curve, labelA, note) {
    const box = h("div", { class: "chartbox" });
    const sec = U.section(title, h("div", { class: "stack" }, box, h("div", { class: "legend-row" }, h("span", {}, h("span", { class: "swatch", style: "background:" + U.tok("--accent") }), labelA), h("span", {}, h("span", { class: "swatch", style: "background:" + U.tok("--bench") }), "SPY, same money and dates")), note));
    setTimeout(() => { if (document.body.contains(box)) U.chart(box, { kind: "line", points: curve.points, intraday: false }, { compare: [{ label: "SPY", points: curve.spy }], fmt: (v) => v.toFixed(1) }); }, 0);
    return sec;
  }

  function polDetail(root, app, key) {
    const meta = M.POLITICIANS.find(p => p.id === key);
    const e = ent("pol", key, (app.ctx.smartmoney.person && app.ctx.smartmoney.person.name) || (meta && meta.name) || key);
    const box = h("div", { class: "stack" }); root.append(box);
    const render = () => {
      box.replaceChildren();
      const pg = e.page;
      if (!pg) { box.append(e.status === "error" ? U.errorBox(e.err, () => { loadPol(app, e).then(render); }) : h("div", { class: "skeleton" }, "Reading " + e.name + "'s disclosed trades…")); return; }
      markSeen(app, e);
      const s = e.sum && e.sum.All || { n: 0 };
      box.append(hero(app, e, [pg.party, pg.chamber, pg.state].filter(Boolean).join(" · ") + " · " + (pg.tradesCount || pg.trades.length) + " trades · " + (pg.issuersCount || "?") + " issuers · " + usd(pg.volume) + " volume · last traded " + (pg.lastTraded || "—"),
        h("a", { class: "btn ghost sm", href: pg.url, target: "_blank", rel: "noopener noreferrer" }, "Capitol Trades ↗")));
      const delays = pg.trades.map(t => t.filedAfterDays).filter(x => x != null), avgDelay = delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : null;
      box.append(h("div", { class: "kpis k4" },
        kpi("Return on disclosed buys", s.n ? U.pct(s.ret, 1) : "—", s.n ? "SPY " + U.pct(s.spyRet, 1) + " · " + s.n + " buys" : "no priced buys", s.n ? U.signCls(s.excess) : ""),
        kpi("Copy-trade return", s.n && s.retPub != null ? U.pct(s.retPub, 1) : "—", s.n && s.excessPub != null ? U.pct(s.excessPub, 1) + " vs SPY from publish dates" : "from each publish date"),
        kpi("Beat SPY", s.n ? s.hitRate.toFixed(0) + "%" : "—", s.n ? "of " + s.n + " priced buys" : ""),
        kpi("Average filing delay", avgDelay != null ? avgDelay.toFixed(0) + " days" : "—", "trade date → published")));
      // windows
      box.append(U.section("Returns by period", h("div", { class: "stack" }, U.table([{ t: "Buys made", v: (r) => WIN_LABEL[r.k] === "Since each trade" ? "All shown (" + pg.pagesRead + " pages)" : "In the " + WIN_LABEL[r.k].toLowerCase() }, { t: "Buys", v: (r) => String(r.s.n || 0), n: true }, { t: "Return since trade", v: (r) => r.s.n ? U.chg(r.s.ret, 1) : "—", n: true }, { t: "SPY", v: (r) => r.s.n ? U.chg(r.s.spyRet, 1) : "—", n: true }, { t: "Excess", v: (r) => r.s.n ? U.chg(r.s.excess, 1) : "—", n: true }, { t: "Copy return", v: (r) => r.s.n ? U.chg(r.s.retPub, 1) : "—", n: true }, { t: "Copy vs SPY", v: (r) => r.s.n ? U.chg(r.s.excessPub, 1) : "—", n: true }, { t: "Best", v: (r) => r.s.best ? r.s.best.ticker + " " + U.pct(r.s.best.ret, 0) : "—" }, { t: "Worst", v: (r) => r.s.worst ? r.s.worst.ticker + " " + U.pct(r.s.worst.ret, 0) : "—" }],
        ["All", "1Y", "6M", "3M", "1M"].map(k => ({ k, s: (e.sum && e.sum[k]) || { n: 0 } }))), h("p", { class: "tiny muted" }, "Size-weighted by the midpoint of each disclosed range; measured to the latest close (" + ((e.rows || []).find(r => r.nowDate) || {}).nowDate + "). " + (e.listed - e.measured > 0 ? (e.listed - e.measured) + " listed trades couldn't be priced. " : "") + pg.trades.filter(t => !t.ticker).length + " trades are in private funds or non-US securities and aren't priced."))));
      box.append(projSection(app, e, projection(app, e)));
      const curveBox = h("div", { class: "stack" }); box.append(curveBox);
      const holdBox = h("div", { class: "stack" }); box.append(holdBox);
      const paintCurve = () => {
        const cv = e.byTicker && S.spy ? M.copyCurve(e.rows || [], e.byTicker, S.spy, 1000) : null;
        curveBox.replaceChildren(cv ? chartSection("Copy-trade backtest", cv, "Copying each disclosed buy on its publish date", h("div", { class: "stack" }, U.kv([["Buys copied", String(cv.legs)], ["Put in", usd(cv.invested) + " ($1,000 each)"], ["Worth now", usd(cv.value)], ["Return", U.chg(cv.ret, 1)], ["Same money in SPY", U.chg(cv.spyRet, 1)]]), h("p", { class: "tiny muted" }, "Hypothetical: $1,000 into each disclosed buy at the close on its publish date, held to the latest close, sells ignored. Chart shows value per $100 put in so far. Excludes fees, taxes and dividends.")))
          : U.section("Copy-trade backtest", h("div", { class: "skeleton" }, "Loading price history…")));
      };
      paintCurve();
      if (!e.byTicker) tickerCloses(pg.trades).then(async (m) => { e.byTicker = m; const spy = await getSpy(); e.rows = M.measureTrades(pg.trades, m, spy || []); derive(e); paintCurve(); paintHold(); }).catch(() => curveBox.replaceChildren());
      // estimated positions
      const my = mySymbols(app);
      const paintHold = () => {
        const net = M.netPositions(pg.trades);
        const firstBuy = (sym) => (e.rows || []).filter(r => r.ticker === sym && r.type === "buy" && r.ret != null).sort((a, b) => a.traded.localeCompare(b.traded))[0];
        holdBox.replaceChildren(U.section("What they've been buying and selling", h("div", { class: "stack" }, net.length ? U.table([
          { t: "Stock", v: (r) => h("span", { class: "who" }, h("b", {}, r.ticker), h("span", { class: "tiny muted" }, String(r.issuer).slice(0, 30))) },
          { t: "Bought (disclosed)", v: (r) => r.bought ? "~" + usd(r.bought) : "—", n: true }, { t: "Sold", v: (r) => r.sold ? "~" + usd(r.sold) : "—", n: true },
          { t: "Net", v: (r) => h("span", { class: r.net > 0 ? "up" : "faint" }, r.net > 0 ? "~" + usd(r.net) + " net buying" : "net seller / closed") },
          { t: "Since first buy", v: (r) => { const f = firstBuy(r.ticker); return f ? U.chg(f.ret, 1) : "—"; }, n: true },
          { t: "Last trade", v: (r) => U.fmtDate(r.last) }, { t: "You", v: (r) => my.has(r.ticker) ? h("span", { class: "pill ok" }, my.get(r.ticker)) : "" }], net, { onRow: (r) => app.openAsset(assetOf(r.ticker, r.issuer)) }) : h("div", { class: "empty" }, "No listed stock trades in the pages read."),
          h("p", { class: "tiny muted" }, "Net = disclosed buys minus sells by size midpoint, within the trades read. It's a rough guide to what is still held, not a holdings statement."))));
      };
      paintHold();
      // all trades
      box.append(U.section("Disclosed trades", U.dataTable([
        { t: "Traded", sort: (r) => r.traded, v: (r) => U.fmtDate(r.traded) }, { t: "Published", sort: (r) => r.published, v: (r) => U.fmtDate(r.published) },
        { t: "Delay", n: true, sort: (r) => r.filedAfterDays, v: (r) => r.filedAfterDays != null ? r.filedAfterDays + "d" : "—" },
        { t: "Issuer", sort: (r) => r.ticker || r.issuer, v: (r) => h("span", { class: "who" }, h("b", {}, r.ticker || "—"), h("span", { class: "tiny muted" }, String(r.issuer).slice(0, 32))) },
        { t: "Type", sort: (r) => r.type, v: (r) => h("span", { class: "verdict sm " + (r.type === "buy" ? "positive" : r.type === "sell" ? "negative" : "neutral") }, r.type) },
        { t: "Size", n: true, sort: (r) => r.size && r.size.mid, v: (r) => r.size ? r.size.label : "—" },
        { t: "Price then", n: true, sort: (r) => r.p0, v: (r) => r.p0 ? C.fmtNum(r.p0, 2) : "—" }, { t: "Now", n: true, sort: (r) => r.pNow, v: (r) => r.pNow ? C.fmtNum(r.pNow, 2) : "—" },
        { t: "Since trade", n: true, sort: (r) => r.ret, v: (r) => r.ret != null ? U.chg(r.ret, 1) : h("span", { class: "tiny faint", title: r.why || "" }, r.why ? "n/a" : "—") },
        { t: "vs SPY", n: true, sort: (r) => r.excess, v: (r) => r.excess != null ? U.chg(r.excess, 1) : "—" },
        { t: "Since published", n: true, sort: (r) => r.retPub, v: (r) => r.retPub != null ? U.chg(r.retPub, 1) : "—" }],
        e.rows || pg.trades, { key: "sm.trades", sort: [0, -1], noun: "trades", placeholder: "Filter by ticker or issuer…", text: (r) => (r.ticker || "") + " " + r.issuer + " " + r.type, onRow: (r) => r.ticker && app.openAsset(assetOf(r.ticker, r.issuer)) })));
      if (pg.sectors.length || pg.topIssuers.length) box.append(h("div", { class: "grid g2" },
        pg.sectors.length ? U.section("Most traded sectors", U.bars(pg.sectors.map(x => ({ label: x.name, value: x.count, text: x.count + " trades" })))) : null,
        pg.topIssuers.length ? U.section("Most traded issuers", U.bars(pg.topIssuers.map(x => ({ label: x.name, value: x.count, text: x.count + " trades" })))) : null));
      const topTickers = M.netPositions(pg.trades).slice(0, 3);
      box.append(newsSection(app, "News around their investments", [e.name + " stock trades and financial disclosures"].concat(topTickers.map(t => t.issuer + " stock news"))));
      box.append(aiSection(app, e));
    };
    render();
    if (!fresh(e) || !e.page) loadPol(app, e).then(render);
  }

  function invDetail(root, app, key) {
    const meta = M.INVESTORS.find(v => v.code === key);
    const e = ent("inv", key, (meta && meta.name) || key, { firm: meta && meta.firm });
    const box = h("div", { class: "stack" }); root.append(box);
    const render = () => {
      box.replaceChildren();
      const pg = e.page;
      if (!pg) { box.append(e.status === "error" ? U.errorBox(e.err, () => { loadInv(app, e).then(render); }) : h("div", { class: "skeleton" }, "Reading " + e.name + "'s latest 13F portfolio…")); return; }
      markSeen(app, e);
      const s = e.since || {};
      box.append(hero(app, e, [e.firm, pg.period ? "13F " + pg.period : null, pg.portfolioDate ? "portfolio date " + U.fmtDate(pg.portfolioDate) : null, pg.stocksCount + " stocks", usd(pg.value)].filter(Boolean).join(" · "),
        h("a", { class: "btn ghost sm", href: pg.url, target: "_blank", rel: "noopener noreferrer" }, "Dataroma ↗")));
      box.append(h("div", { class: "kpis k4" },
        kpi("Since the portfolio date", s.ret != null ? U.pct(s.ret, 1) : "—", s.spyRet != null ? "SPY " + U.pct(s.spyRet, 1) + " · " + Math.round(s.days || 0) + " days" : "", U.signCls(s.excess)),
        kpi("Top 10 holdings", s.top10Pct != null ? s.top10Pct.toFixed(0) + "%" : "—", "of the portfolio"),
        kpi("This quarter", (s.buys || 0) + " new · " + (s.adds || 0) + " added", (s.reduces || 0) + " reduced · from " + (pg.period || "13F")),
        kpi("Measured", s.n ? s.n + " holdings" : "—", s.coveragePct != null ? s.coveragePct.toFixed(0) + "% of portfolio weight" : "")));
      const btBox = h("div", { class: "stack" }), projBox = h("div", { class: "stack" });
      box.append(btBox, projBox);
      const paintBt = () => {
        projBox.replaceChildren(projSection(app, e, projection(app, e), "Model: market assumption + the measured excess of today's top holdings over the last year (or since the portfolio date until that's measured), shrunk heavily because one portfolio snapshot is weak evidence."));
        const cv = e.curvePts;
        if (!cv) { btBox.replaceChildren(U.section("Today's top holdings over the past year", h("div", { class: "skeleton" }, "Pricing the top 12 holdings…"))); return; }
        btBox.replaceChildren(chartSection("Today's top holdings over the past year", cv, "Current top " + cv.used + " holdings, today's weights", h("div", { class: "stack" },
          U.table([{ t: "Period", v: "k" }, { t: "Portfolio", v: (r) => U.chg(r.ret, 1), n: true }, { t: "SPY", v: (r) => U.chg(r.spy, 1), n: true }, { t: "Excess", v: (r) => U.chg(r.ret - r.spy, 1), n: true }], M.WINDOWS.map(([k]) => Object.assign({ k }, cv.periods[k])).filter(r => r.ret != null)),
          h("p", { class: "tiny muted" }, "Backtest of today's holdings (" + (e.curve && e.curve.portfolioPct != null ? e.curve.portfolioPct.toFixed(0) + "% of the portfolio" : "top holdings") + "), not the manager's actual return: positions changed during the year and 13F data is up to 45 days old. Price-only, before fees."))));
      };
      paintBt();
      if (!e.curvePts) measureInv(app, e).then(paintBt).catch(() => btBox.replaceChildren());
      const my = mySymbols(app);
      box.append(U.section("Holdings (latest 13F)", U.dataTable([
        { t: "Stock", sort: (r) => r.symbol, v: (r) => h("span", { class: "who" }, h("b", {}, r.symbol), h("span", { class: "tiny muted" }, String(r.name).slice(0, 32))) },
        { t: "Weight", n: true, sort: (r) => r.weightPct, v: (r) => r.weightPct.toFixed(2) + "%" },
        { t: "Activity", sort: (r) => r.activity, v: (r) => r.activity ? h("span", { class: "verdict sm " + (/Buy|Add/i.test(r.activity) ? "positive" : /Reduce|Sell/i.test(r.activity) ? "negative" : "neutral") }, r.activity) : "" },
        { t: "Reported price", n: true, sort: (r) => r.reportedPrice, v: (r) => r.reportedPrice != null ? C.fmtNum(r.reportedPrice, 2) : "—" },
        { t: "Current", n: true, sort: (r) => r.currentPrice, v: (r) => r.currentPrice != null ? C.fmtNum(r.currentPrice, 2) : "—" },
        { t: "Since", n: true, sort: (r) => r.changePct, v: (r) => U.chg(r.changePct, 1) },
        { t: "52-week range", v: (r) => r.low52 != null && r.high52 > r.low52 && r.currentPrice != null ? h("span", { class: "meter", style: "display:inline-block;width:70px", title: C.fmtNum(r.low52, 2) + " – " + C.fmtNum(r.high52, 2) }, h("i", { style: "width:" + Math.max(0, Math.min(100, (r.currentPrice - r.low52) / (r.high52 - r.low52) * 100)).toFixed(0) + "%" })) : "—" },
        { t: "You", v: (r) => my.has(r.symbol) ? h("span", { class: "pill ok" }, my.get(r.symbol)) : "" }],
        pg.holdings, { key: "sm.hold", sort: [1, -1], noun: "holdings", placeholder: "Filter by ticker…", onRow: (r) => app.openAsset(assetOf(r.symbol, r.name)) }),
        h("p", { class: "tiny muted" }, "Reported price = Dataroma's price at the portfolio date; current price from Dataroma's quote provider (Intrinio). 13F filings list US-listed long positions only.")));
      const actBox = h("div", { class: "stack" });
      box.append(U.section("Recent quarters: buys and sells", actBox));
      U.async(actBox, () => M.activity(e.key), (rows) => {
        const qs = [...new Set(rows.map(r => r.quarter))].slice(0, 2);
        actBox.append(qs.length ? h("div", { class: "grid g2", style: "align-items:start" }, qs.map(q => h("div", { class: "stack", style: "align-content:start" }, h("span", { class: "label" }, q), U.table([{ t: "Stock", v: (r) => h("span", { class: "who" }, h("b", {}, r.symbol), h("span", { class: "tiny muted" }, String(r.name).slice(0, 28))) }, { t: "Action", v: (r) => h("span", { class: "verdict sm " + (/Buy|Add/.test(r.action) ? "positive" : "negative") }, r.action + (r.changePct != null ? " " + r.changePct.toFixed(0) + "%" : "")) }, { t: "Portfolio impact", v: (r) => r.portfolioImpactPct != null ? r.portfolioImpactPct.toFixed(2) + "%" : "—", n: true }], rows.filter(r => r.quarter === q).slice(0, 14), { onRow: (r) => app.openAsset(assetOf(r.symbol, r.name)) })))) : h("div", { class: "empty" }, "No activity listed."));
      }, { loading: "Loading recent activity…" });
      const top = pg.holdings.slice().sort((a, b) => b.weightPct - a.weightPct).slice(0, 3);
      box.append(newsSection(app, "News around their investments", [e.name + (e.firm ? " " + e.firm : "") + " portfolio moves"].concat(top.map(t => t.name + " stock news"))));
      box.append(aiSection(app, e));
    };
    render();
    if (!fresh(e) || !e.page) loadInv(app, e).then(render);
  }

  /* ---------- news ---------- */
  function newsSection(app, title, queries) {
    const box = h("div", { class: "stack" });
    U.async(box, async () => {
      const res = await Promise.allSettled(queries.map(q => D.bigdataNews(q, 4)));
      let items = [], used = "Bigdata.com";
      for (const r of res) if (r.status === "fulfilled") items.push(...r.value.items);
      if (!items.length) {
        const w = await D.webSearch(queries[0] + " latest news", "Recent news articles with dates.", 6).catch(() => null);
        if (!w) throw (res.find(r => r.status === "rejected") || {}).reason || new Error("No news sources answered.");
        items = w.results.map(x => ({ title: x.title, url: x.url, source: (x.url.match(/^https?:\/\/(?:www\.)?([^/]+)/) || [])[1] })); used = "Exa web search";
      }
      const seen = new Set(); items = items.filter(x => x.url && !seen.has(x.url) && seen.add(x.url)).sort((a, b) => (b.ts || 0) - (a.ts || 0));
      return { items, used };
    }, ({ items, used }) => box.append(X.newsList(items, { max: 12, clip: 260 }), h("p", { class: "tiny muted" }, "From " + used + " for: " + queries.join(" · ") + ". Check each headline is about this person or company.")), { loading: "Searching news…" });
    return U.section(title, box);
  }

  /* ---------- AI read ---------- */
  const rnd = (o) => JSON.parse(JSON.stringify(o, (k, v) => typeof v === "number" ? +v.toFixed(2) : v));
  function factsFor(app, e) {
    const pg = e.page, p = projection(app, e);
    const proj = p ? { modelReturnPctPerYear: p.driftPct, expectedPct: Object.fromEntries(Object.entries(p.horizons).map(([k, x]) => [k, x.mean])), rangePct1Y: p.horizons["1Y"].p05 != null ? [p.horizons["1Y"].p05, p.horizons["1Y"].p95] : null } : null;
    if (e.kind === "pol") {
      const cv = e.byTicker && S.spy ? M.copyCurve(e.rows || [], e.byTicker, S.spy, 1000) : null;
      return rnd({ person: { name: e.name, party: pg.party, chamber: pg.chamber, state: pg.state, tradesDisclosed: pg.tradesCount, volumeUSD: pg.volume, lastTraded: pg.lastTraded }, tradesRead: pg.trades.length,
        measured: Object.fromEntries(Object.entries(e.sum || {}).map(([k, s]) => [k, s.n ? { buys: s.n, returnPct: s.ret, spyPct: s.spyRet, excessPct: s.excess, copyReturnPct: s.retPub, beatSpyPct: s.hitRate } : { buys: 0 }])),
        copyTradeBacktest: cv ? { buys: cv.legs, returnPct: cv.ret, spyPct: cv.spyRet, from: cv.from } : null, projection: proj,
        netPositions: M.netPositions(pg.trades).slice(0, 10).map(x => ({ ticker: x.ticker, issuer: x.issuer, boughtUSD: x.bought, soldUSD: x.sold, lastTrade: x.last })),
        recentTrades: (e.rows || pg.trades).slice(0, 25).map(r => ({ traded: r.traded, published: r.published, ticker: r.ticker, issuer: r.ticker ? undefined : r.issuer, type: r.type, size: r.size && r.size.label, returnPct: r.ret, vsSpyPct: r.excess })),
        sectors: pg.sectors });
    }
    const cv = e.curvePts;
    return rnd({ investor: { name: e.name, firm: e.firm, period: pg.period, portfolioDate: pg.portfolioDate, valueUSD: pg.value, stocks: pg.stocksCount }, sincePortfolioDate: e.since,
      topHoldingsBacktest: cv ? cv.periods : null, projection: proj,
      holdings: pg.holdings.slice(0, 20).map(x => ({ symbol: x.symbol, name: x.name, weightPct: x.weightPct, activity: x.activity || null, changeSinceReportedPct: x.changePct, from52wHighPct: x.high52 && x.currentPrice ? (x.currentPrice / x.high52 - 1) * 100 : null })) });
  }
  function aiTools(sources, log) {
    const add = (url, title) => { if (url && !sources.some(s => s.url === url)) sources.push({ url, title: title || url, retrievedAt: Date.now() }); };
    return [
      { name: "search_news", description: "Search Bigdata.com's indexed financial news for one company or one topic (publisher, timestamp, excerpts). One company per call, in natural language.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        async execute(i) { const q = String(i.query || ""); log("run", "Bigdata.com news: " + q); const r = await D.bigdataNews(q, 5); for (const x of r.items) add(x.url, x.title); log("ok", r.items.length + " articles"); return r.items.map(x => ({ headline: x.title, publisher: x.source, published: x.ts ? new Date(x.ts).toISOString() : null, url: x.url, excerpt: String(x.text || "").slice(0, 1400) })); } },
      { name: "search_web", description: "Search the web (news, filings, official pages). Use when search_news finds nothing.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        async execute(i) { const q = String(i.query || ""); log("run", "Web search: " + q); const r = await D.webSearch(q, "Recent, dated news and primary sources.", 5); for (const x of r.results) add(x.url, x.title); log("ok", r.results.length + " results"); return r.text.slice(0, 12000); } },
      { name: "stock_snapshot", description: "Measured one-year price picture for a US ticker (return, volatility, drawdown, trend vs moving averages, RSI, distance from the 52-week high), computed by the app from exchange closes, plus the Zacks Rank when available.", inputSchema: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] },
        async execute(i) {
          const sym = String(i.symbol || "").toUpperCase(); log("run", "Price picture for " + sym);
          const s = await D.historyFor(assetOf(sym), "1Y"), st = C.seriesStats(s.points, 252), t = C.technicals(s.points);
          let z = null; try { const m = await D.zacks.metrics(sym); z = { zacksRank: m.v("zacks_rank_text") || m.v("zacks_rank"), targetPrice: m.v("zacks_target_price"), url: m.url }; add(m.url, "Zacks " + sym); } catch {}
          log("ok", sym + " measured");
          return rnd({ symbol: sym, source: s.source, return1YPct: st.changePct, volPct: st.volPct, maxDrawdownPct: st.maxDrawdownPct, trend: t && t.trend, rsi14: t && t.rsi14, fromHighPct: t && t.fromHighPct, returnsPct: C.periodReturns(s.points), zacks: z });
        } }];
  }
  function aiSection(app, e) {
    const out = h("div", { class: "stack" }), log = h("div", { class: "log", hidden: true }), phase = h("div", { class: "small muted" });
    let ctl = null;
    const saved = () => app.store.cached("smai").find(d => d.id === e.id);
    const go = h("button", { class: "btn", type: "button" }, saved() ? "Refresh AI analysis" : "Run AI analysis");
    const stop = h("button", { class: "btn ghost", type: "button", hidden: true, onclick: () => ctl && ctl.abort() }, "Stop");
    go.onclick = async () => {
      const s = app.caps.sample; if (!s) { out.replaceChildren(U.errorBox({ message: "Claude isn't available in this view." })); return; }
      ctl = new AbortController(); go.disabled = true; stop.hidden = false; log.hidden = false; log.replaceChildren(); phase.textContent = "Working… usually under two minutes.";
      const L = (kind, text) => { log.append(h("div", { class: kind }, new Date().toLocaleTimeString() + "  " + text)); log.scrollTop = log.scrollHeight; };
      const sources = [];
      try {
        const lim = await s.limits().catch(() => null);
        const tools = lim && lim.tools ? aiTools(sources, L) : undefined;
        const facts = factsFor(app, e);
        const who = e.kind === "pol" ? `the publicly disclosed stock trades of ${e.name}, a ${e.page.party || ""} member of the US ${e.page.chamber || "Congress"}${e.page.state ? " from " + e.page.state : ""}` : `the latest 13F portfolio of ${e.name}${e.firm ? " (" + e.firm + ")" : ""}`;
        const prompt = `Today is ${new Date().toISOString().slice(0, 10)}. You are analysing ${who}, for an investor deciding whether following these disclosures is useful and which positions look most interesting now.
The app measured everything below from ${e.kind === "pol" ? "official STOCK Act disclosures (via Capitol Trades)" : "13F filings (via Dataroma)"} and exchange closes. Use these numbers as given; never invent figures, dates or trades.
Rules: be neutral and factual. ${e.kind === "pol" ? "Disclosures cannot show why a trade was made: never suggest or imply insider trading, wrongdoing or access to non-public information. Many trades are made by spouses or outside managers. Filings arrive up to 45 days late, so a follower only gets the copy (publish-date) return." : "A 13F is a quarter-end snapshot of US long positions, filed up to 45 days later; it omits shorts, cash and non-US holdings."} A few dozen trades or one snapshot is weak evidence; a high return can be luck.
${MD.ai.contextNote(app)}
${tools ? "Use 3 to 8 tool calls: search_news for the 2–4 largest or most recent positions (one company per call), and stock_snapshot for the same tickers. Use search_web only if search_news fails. Cite only URLs the tools returned." : "Tools are unavailable, so say that news wasn't checked."}
Measured data: ${JSON.stringify(facts)}
Reply with ONLY JSON:
{"summary": "3-4 sentences: what this record shows and how much it can be trusted",
 "style": "1-2 sentences on their apparent style (sectors, size, holding period, concentration)",
 "tilts": ["short labels, e.g. 'Large-cap tech', 'Energy'"],
 "notable": [{"ticker": "...", "note": "what they did and what the measured numbers show"}],
 "positions": [{"ticker": "...", "view": "positive"|"neutral"|"negative", "why": "1-2 sentences using the news and measured data", "sources": [{"title": "...", "url": "https://..."}]}],
 "copyVerdict": {"label": "Worth watching"|"Mixed record"|"Not useful to copy", "why": "1-2 sentences, mentioning the disclosure delay or snapshot age"},
 "risks": ["2-4 risks of following this person"], "watch": ["2-4 things to watch next"],
 "confidence": 0-100 (how much weight the evidence deserves), "confidenceWhy": "one sentence"}`;
        L("run", "Asking Claude");
        const r = await s.json(prompt, Object.assign({ modelTier: "complex", signal: ctl.signal }, tools ? { tools } : { cache: false }));
        const ok = new Set(sources.map(x => x.url));
        const verify = (arr) => (Array.isArray(arr) ? arr : []).filter(x => x && /^https?:\/\//.test(x.url)).map(x => ({ title: x.title || x.url, url: x.url, verified: ok.has(x.url) }));
        const res = { summary: String(r.summary || ""), style: String(r.style || ""), tilts: (r.tilts || []).slice(0, 6).map(String), notable: (r.notable || []).slice(0, 6), positions: (r.positions || []).slice(0, 6).map(p => Object.assign({}, p, { sources: verify(p.sources) })),
          copyVerdict: r.copyVerdict || null, risks: (r.risks || []).slice(0, 5).map(String), watch: (r.watch || []).slice(0, 5).map(String), confidence: Math.max(0, Math.min(100, Number(r.confidence) || 0)), confidenceWhy: String(r.confidenceWhy || ""), sourcesRetrieved: sources.length, at: Date.now() };
        if (!res.summary) throw Object.assign(new Error("The answer came back unreadable; try again."), { code: "invalid_json" });
        const RS = MD.ai.session((e2) => L(e2.kind, e2.text)); RS.sources = sources;
        const rv = await MD.ai.review(app, { task: "An analysis of " + who, S: RS, signal: ctl.signal, facts, items: [{ id: "read", summary: res.summary, copyVerdict: res.copyVerdict, positions: res.positions.map(p => ({ ticker: p.ticker, view: p.view, why: p.why })), confidence: res.confidence }] }).catch(() => null);
        if (rv && rv.reviews[0]) { res.review = rv.reviews[0]; if (res.review.adjustedConfidence != null && res.review.adjustedConfidence < res.confidence) res.confidence = res.review.adjustedConfidence; }
        if (!app.demo) await app.store.put("smai", e.id, JSON.parse(JSON.stringify(res))).catch(() => {});
        else e.aiDemo = res;
        phase.textContent = "Done" + (app.demo ? " (demo mode: not saved)" : " · saved"); paint(res);
      } catch (err) { phase.textContent = err && err.code === "cancelled" ? "Stopped." : ""; if (!(err && err.code === "cancelled")) L("fail", ({ no_sample: "Claude isn't available in this view.", not_granted: "Claude access was declined for this page.", rate_limited: "Usage limit reached; try again later.", invalid_json: "The answer came back unreadable; try again." })[err && err.code] || (err && err.message) || "Failed."); }
      go.disabled = false; stop.hidden = true; ctl = null; go.textContent = "Refresh AI analysis";
    };
    const paint = (res) => {
      if (!res) { out.replaceChildren(h("p", { class: "small muted" }, "Claude reads the measured record above, checks recent news on the biggest positions and says how much weight the record deserves. Uses your Claude usage and a few Bigdata.com and Exa searches.")); return; }
      const cov = e.kind === "pol" ? (e.listed ? e.measured / e.listed * 100 : 0) : (e.since && e.since.coveragePct) || 0;
      const n = e.kind === "pol" ? (e.sum && e.sum.All && e.sum.All.n) || 0 : null;
      const sample = e.kind === "pol" ? n / (n + 10) * 100 : e.curve ? 55 : 35;
      const overall = Math.round(0.5 * res.confidence + 0.3 * Math.min(100, cov) + 0.2 * sample);
      const meter = (label, v, note) => h("div", { class: "stack", style: "gap:2px" }, h("div", { class: "row between" }, h("span", { class: "label" }, label), h("b", { class: "num" }, Math.round(v) + "")), h("span", { class: "meter" }, h("i", { style: "width:" + Math.max(0, Math.min(100, v)).toFixed(0) + "%" })), note ? h("span", { class: "tiny muted" }, note) : null);
      const cvd = res.copyVerdict || {};
      out.replaceChildren(
        h("div", { class: "row between", style: "flex-wrap:wrap;gap:8px" }, h("span", { class: "verdict " + (/Worth/.test(cvd.label) ? "positive" : /Not useful/.test(cvd.label) ? "negative" : "neutral") }, cvd.label || "Analysis"), h("span", { class: "tiny muted" }, "Generated " + U.fmtTs(res.at) + " from " + res.sourcesRetrieved + " retrieved sources")),
        h("p", {}, res.summary), cvd.why ? h("p", { class: "small" }, h("strong", {}, "Copying them: "), cvd.why) : null, res.review ? MD.ai.reviewBadge(res.review) : null,
        res.style ? h("p", { class: "small" }, h("strong", {}, "Style: "), res.style) : null,
        res.tilts.length ? h("div", { class: "row", style: "flex-wrap:wrap;gap:6px" }, res.tilts.map(t => h("span", { class: "pill" }, t))) : null,
        h("div", { class: "grid g2", style: "align-items:start" },
          h("div", { class: "stack" }, h("span", { class: "label" }, "Positions"), res.positions.length ? res.positions.map(p => h("div", { class: "card", style: "padding:10px 12px" }, h("div", { class: "row between" }, h("button", { class: "linkbtn", type: "button", onclick: () => app.openAsset(assetOf(String(p.ticker || "").toUpperCase())) }, h("b", {}, p.ticker)), h("span", { class: "verdict sm " + (p.view === "positive" ? "positive" : p.view === "negative" ? "negative" : "neutral") }, p.view || "neutral")), h("p", { class: "small", style: "margin:4px 0" }, p.why || ""), p.sources.length ? h("div", { class: "tiny" }, p.sources.map((s, i) => h("span", {}, i ? " · " : "", h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer" }, String(s.title).slice(0, 50)), s.verified ? null : h("span", { class: "warn-t" }, " (unverified)")))) : null)) : h("p", { class: "small faint" }, "None.")),
          h("div", { class: "stack" },
            h("span", { class: "label" }, "Confidence"), meter("Overall", overall, "Half Claude's judgement, 30% data coverage, 20% sample size"), meter("Claude", res.confidence, res.confidenceWhy), meter("Data coverage", Math.min(100, cov), e.kind === "pol" ? e.measured + " of " + e.listed + " listed trades priced" : "share of portfolio weight measured"), meter("Sample size", sample, e.kind === "pol" ? n + " priced buys" : e.curve ? "one 13F plus a 1-year holdings backtest" : "one 13F snapshot"),
            res.notable.length ? h("div", {}, h("span", { class: "label" }, "Notable moves"), h("ul", { class: "small", style: "margin:4px 0 0;padding-left:1.1em;display:grid;gap:3px" }, res.notable.map(x => h("li", {}, h("b", {}, x.ticker + ": "), x.note)))) : null,
            res.risks.length ? h("div", {}, h("span", { class: "label" }, "Risks of following"), h("ul", { class: "small", style: "margin:4px 0 0;padding-left:1.1em;display:grid;gap:3px" }, res.risks.map(x => h("li", {}, x)))) : null,
            res.watch.length ? h("div", {}, h("span", { class: "label" }, "What to watch"), h("ul", { class: "small", style: "margin:4px 0 0;padding-left:1.1em;display:grid;gap:3px" }, res.watch.map(x => h("li", {}, x)))) : null)),
        h("p", { class: "tiny muted" }, "Written by Claude from the measured data and the sources it retrieved; links marked unverified weren't among them. Not advice."));
    };
    paint(saved() || e.aiDemo || null);
    return U.section("AI analysis", h("div", { class: "stack" }, h("div", { class: "row" }, go, stop), phase, log, out));
  }

  /* ---------- dashboard card ---------- */
  function dashboardCard(box, app) {
    hydrate(app);
    const ents = [...S.map.values()].map(e => ({ e, m: measured(e, "All") })).filter(x => x.m && x.m.ret != null).sort((a, b) => b.m.ret - a.m.ret);
    const fol = follows(app).map(f => S.map.get(f.id)).filter(e => e && newCount(app, e));
    if (!ents.length) { box.append(h("div", { class: "empty" }, "See which members of Congress and investors have done best with their disclosed trades."), h("button", { class: "btn ghost sm", type: "button", onclick: () => app.go("smartmoney") }, "Open Smart Money")); return; }
    box.append(U.table([{ t: "Top measured returns", v: (x) => h("span", { class: "row", style: "gap:6px" }, partyChip(x.e), x.e.name) }, { t: "Return", v: (x) => U.chg(x.m.ret, 1), n: true }, { t: "vs SPY", v: (x) => x.m.excess != null ? U.chg(x.m.excess, 1) : "—", n: true }], ents.slice(0, 4), { onRow: (x) => open(app, x.e) }),
      fol.length ? h("p", { class: "small" }, h("strong", {}, "New from people you follow: "), fol.map(e => e.name).join(", ")) : null,
      h("button", { class: "btn ghost sm", type: "button", onclick: () => app.go("smartmoney") }, "Open Smart Money"));
  }

  MD.smartView = { dashboardCard, load, whoOwns, measured, projection, state: S, hydrate };
})(typeof window !== "undefined" ? window : globalThis);
