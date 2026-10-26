/* Today's game plan: one page with what matters for the day (the session clock, the desk's SPY call, US economic
   releases, earnings for your names, how your holdings are moving, calls coming due, what was graded, unread alerts and
   the paper account), plus an optional AI game plan that turns those measured facts into a short list of priorities.
   The same facts make the daily digest, sent to the inbox once a day after 6 a.m. New York time while the page is open. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const C = MD.core, U = MD.ui, D = MD.data, h = U.h, Q = () => MD.quant;
  const V = (MD.views = MD.views || {});
  const mins = (m) => m == null ? "" : m >= 1440 ? Math.floor(m / 1440) + "d " + Math.floor(m % 1440 / 60) + "h" : m >= 60 ? Math.floor(m / 60) + "h " + (m % 60) + "m" : m + "m";
  const nyYmd = (t) => Q().nyParts(new Date(t)).ymd;
  const sgn = (x, dp = 1) => x == null || !isFinite(x) ? "—" : (x > 0 ? "+" : "") + x.toFixed(dp) + "%";

  function clockText(s) {
    if (!s.tradingDay && s.phase === "closed") return "US markets are closed today" + (s.minutesToOpen != null ? "; next open in " + mins(s.minutesToOpen) : "") + ".";
    if (s.phase === "open") return "US market open: closes at " + s.closeAt + " ET, " + mins(s.minutesToClose) + " left" + (s.earlyClose ? " (early close)" : "") + ".";
    if (s.phase === "pre") return "Pre-market: the open is in " + mins(s.minutesToOpen) + ".";
    if (s.phase === "after") return "After-hours: the session has closed.";
    return "Market closed" + (s.minutesToOpen != null ? "; next open in " + mins(s.minutesToOpen) : "") + ".";
  }
  // The names that are yours: holdings, watchlist and open paper positions (stocks, ETFs and coins).
  function myNames(app) {
    const m = new Map(), { positions } = C.buildPositions(app.store.cached("tx"));
    for (const p of positions.values()) if (p.qty.gt(0) && ["stock", "etf", "crypto"].includes(p.assetClass)) m.set(p.assetId, Object.assign({ id: p.assetId, cls: p.assetClass, symbol: p.symbol, name: p.name, held: true }, p.meta || {}));
    for (const w of app.store.cached("watch")) if (["stock", "etf", "crypto"].includes(w.cls) && !m.has(w.assetId)) m.set(w.assetId, Object.assign({ id: w.assetId }, w, { held: false }));
    return [...m.values()];
  }
  // The next n weekdays (YYYY-MM-DD, New York) starting today.
  function weekdays(n) { const out = []; for (let i = 0; out.length < n && i < 14; i++) { const p = Q().nyParts(new Date(Date.now() + i * 864e5)); if (p.dow > 0 && p.dow < 6) out.push(p.ymd); } return out; }

  /* Everything measured for the day. Each part fails on its own and says so. */
  async function gather(app) {
    const s = Q().session(), today = s.date, names = myNames(app), now = Date.now(), errs = [];
    const syms = new Set(names.filter(a => a.cls !== "crypto").map(a => a.symbol));
    const [econ, earn, quotes, paper] = await Promise.all([
      D.calendar.economic(today).then(r => r.filter(x => /United States|^US$/i.test(x.country || ""))).catch(e => { errs.push("economic calendar: " + U.errorText(e)); return null; }),
      syms.size ? Promise.all(weekdays(5).map(d => D.calendar.earnings(d).catch(() => []))).then(rs => { const seen = new Set(); return rs.flat().filter(x => syms.has(x.symbol) && !seen.has(x.symbol) && seen.add(x.symbol)); }).catch(e => { errs.push("earnings calendar: " + U.errorText(e)); return null; }) : Promise.resolve([]),
      Promise.all(names.slice(0, 25).map(async a => { try { const q = await app.quote(a, 60000); return { a, q }; } catch (e) { return { a, err: U.errorText(e) }; } })),
      MD.paper && app.store.cached("paper").length ? MD.paper.state(app).catch(() => null) : Promise.resolve(null)]);
    // The options-implied move and the stock's typical two-day reaction for up to four of your names reporting soon.
    if (earn && earn.length && MD.earnings) await Promise.all(earn.slice(0, 4).map(async (x) => { try { const m = await MD.earnings.measure(app, { id: "stock:" + x.symbol, cls: "stock", symbol: x.symbol, name: x.name || x.symbol }); x.impliedMovePct = m.implied && m.implied.movePct != null ? m.implied.movePct : null; x.typicalReactionPct = m.avgAbsReactionPct; } catch {} }));
    const done = new Set(app.store.cached("evals").map(e => e.forecastId));
    const due = app.store.cached("forecasts").filter(f => !done.has(f.id) && f.dueAt > now && f.dueAt - now < 7 * 864e5).sort((a, b) => a.dueAt - b.dueAt);
    const fById = new Map(app.store.cached("forecasts").map(f => [f.id, f]));
    const graded = app.store.cached("evals").filter(e => now - (e.evaluatedAt || 0) < 36 * 3600e3).map(e => ({ e, f: fById.get(e.forecastId) })).filter(x => x.f);
    const unread = app.store.cached("inbox").filter(i => !i.read && i.kind !== "digest");
    const call = MD.brain && MD.brain.latestCall ? MD.brain.latestCall(app) : null;
    const moves = quotes.filter(x => x.q && x.q.changePct != null).sort((x, y) => Math.abs(y.q.changePct) - Math.abs(x.q.changePct));
    const sent = MD.sentiment ? MD.sentiment.latest(app) : null;
    return { sentiment: sent && sent.day === today ? sent : null, at: now, session: s, today, call, econ, earnings: earn, moves, priceErrors: quotes.filter(x => x.err).map(x => x.a.symbol), due, graded, unread, paper, names: names.length, errs };
  }

  // Earnings for your names go on the catalyst calendar once (Calendar & Catalysts), from Nasdaq's earnings calendar.
  async function syncCatalysts(app, g) {
    if (app.demo || !g || !g.earnings) return 0;
    let n = 0;
    for (const x of g.earnings) {
      const id = "stock:" + x.symbol;
      if (app.store.cached("catalysts").some(c => (c.assetId === id || c.symbol === x.symbol) && c.date === x.date && /earnings/i.test(c.title || ""))) continue;
      await app.store.create("catalysts", { assetId: id, symbol: x.symbol, title: "Earnings" + (x.time && !/not.?supplied/i.test(x.time) ? " (" + x.time + ")" : ""), date: x.date, impact: "High", note: "Added automatically from Nasdaq's earnings calendar" + (x.epsForecast ? "; EPS forecast " + x.epsForecast : "") + (x.impliedMovePct != null ? "; options imply ±" + x.impliedMovePct.toFixed(1) + "%" : "") + "." }).then(() => n++).catch(() => {});
    }
    return n;
  }
  // Compact measured facts for the AI game plan (numbers from the page only).
  function facts(app, g) {
    const lbl = (f) => (MD.ai.SOURCE_LABEL || {})[f.source] || f.source;
    return { today: g.today, session: { phase: g.session.phase, tradingDay: g.session.tradingDay, clock: clockText(g.session) },
      desksSpyCall: g.call ? { session: g.call.target, upPct: g.call.upPct, summary: g.call.summary || "" } : "not made yet for this session",
      usEconomicReleasesToday: g.econ ? g.econ.slice(0, 12).map(x => ({ gmt: x.gmt, event: x.event, consensus: x.consensus || null, previous: x.previous || null, actual: x.actual || null })) : "unavailable",
      earningsForYourNamesNext5Days: g.earnings ? g.earnings.map(x => ({ symbol: x.symbol, date: x.date, time: x.time, epsForecast: x.epsForecast || null, optionsImpliedMovePct: x.impliedMovePct != null ? +x.impliedMovePct.toFixed(1) : null, typicalTwoDayReactionPct: x.typicalReactionPct != null ? +x.typicalReactionPct.toFixed(1) : null })) : "unavailable",
      yourNamesMovingToday: g.moves.slice(0, 8).map(x => ({ symbol: x.a.symbol, held: !!x.a.held, todayPct: +x.q.changePct.toFixed(2) })),
      callsDueThisWeek: g.due.slice(0, 10).map(f => ({ symbol: f.symbol, by: lbl(f), call: f.direction + (f.probability ? " " + Math.round(f.probability * 100) + "%" : ""), due: nyYmd(f.dueAt) })),
      gradedSinceYesterday: g.graded.map(x => ({ symbol: x.f.symbol, by: lbl(x.f), hit: !!x.e.directionHit, returnPct: x.e.realizedReturnPct != null ? +Number(x.e.realizedReturnPct).toFixed(2) : null })),
      unreadAlerts: g.unread.slice(0, 6).map(i => i.title),
      newsSentimentToday: g.sentiment ? g.sentiment.rows.filter(r => r.score != null).map(r => ({ symbol: r.symbol, label: r.label, score: r.score, summary: r.summary })) : "not read today",
      paperAccount: g.paper ? { returnPct: +g.paper.v.returnPct.toFixed(2), sameTradesInSP500Pct: +g.paper.v.mirrorReturnPct.toFixed(2), openPositions: g.paper.L.positions.length } : null };
  }

  async function aiPlan(app, g, opts = {}) {
    if (!app.caps.sample) throw Object.assign(new Error("Claude isn't available in this view."), { code: "no_sample" });
    const F = facts(app, g);
    const r = await app.caps.sample.json(`You are the desk's morning planner. Using ONLY these measured facts from the page (never invent a price, date, event or number), write today's game plan for this investor: 3 to 5 priorities in order, each one concrete (what to look at or decide, and why today), plus what to watch for. Doing nothing is a valid plan when nothing needs attention; say so plainly. Not advice to buy or sell; the investor decides.
${MD.ai.contextNote(app)}
Facts: ${JSON.stringify(F)}
Reply with ONLY JSON: {"headline": "one sentence", "priorities": [{"title": "short imperative", "why": "one or two sentences citing the facts", "symbol": "TICKER or empty", "page": "one of: picks, portfolio, paper, brain, daytrade, inbox, calendar, research, or empty"}], "watchFor": ["short items with times where the facts give them"], "quietDay": true|false}`, { modelTier: "default", signal: opts.signal, cache: false });
    const PAGES = new Set(["picks", "portfolio", "paper", "brain", "daytrade", "inbox", "calendar", "research"]);
    const known = new Set([...myNames(app).map(a => a.symbol), ...g.due.map(f => f.symbol), ...(g.earnings || []).map(x => x.symbol), "SPY"]);
    const plan = { date: g.today, at: Date.now(), headline: String(r.headline || "").slice(0, 300), quietDay: !!r.quietDay,
      priorities: (Array.isArray(r.priorities) ? r.priorities : []).slice(0, 5).map(p => ({ title: String(p.title || "").slice(0, 120), why: String(p.why || "").slice(0, 400), symbol: known.has(String(p.symbol || "").toUpperCase()) ? String(p.symbol).toUpperCase() : "", page: PAGES.has(p.page) ? p.page : "" })).filter(p => p.title),
      watchFor: (Array.isArray(r.watchFor) ? r.watchFor : []).slice(0, 6).map(x => String(x).slice(0, 160)), facts: F };
    if (!app.demo) await app.store.put("gameplans", g.today, JSON.parse(JSON.stringify(plan))).catch(() => {});
    return plan;
  }

  /* The daily digest: the day's facts as one inbox item, once per New York date, after 6 a.m. ET. */
  function digestText(g) {
    const parts = [clockText(g.session)];
    if (g.call) parts.push("The desk's SPY call for " + g.call.target + ": " + g.call.upPct + "% chance of a higher close.");
    if (g.econ && g.econ.length) parts.push("US releases today: " + g.econ.slice(0, 5).map(x => x.event + (x.gmt ? " (" + x.gmt + " GMT)" : "")).join("; ") + (g.econ.length > 5 ? " and " + (g.econ.length - 5) + " more" : "") + ".");
    else if (g.econ) parts.push("No US economic releases today.");
    if (g.earnings && g.earnings.length) parts.push("Earnings for your names: " + g.earnings.map(x => x.symbol + " " + x.date.slice(5) + (x.time && !/not.?supplied/i.test(x.time) ? " (" + x.time + ")" : "") + (x.impliedMovePct != null ? ", options imply ±" + x.impliedMovePct.toFixed(1) + "%" : "")).join("; ") + ".");
    if (g.moves.length) parts.push("Biggest moves among your names: " + g.moves.slice(0, 3).map(x => x.a.symbol + " " + sgn(x.q.changePct)).join(", ") + ".");
    if (g.due.length) parts.push(g.due.length + " AI call" + (g.due.length > 1 ? "s" : "") + " come due this week" + " (" + g.due.slice(0, 4).map(f => f.symbol).join(", ") + (g.due.length > 4 ? ", …" : "") + ").");
    if (g.graded.length) parts.push("Graded since yesterday: " + g.graded.filter(x => x.e.directionHit).length + " of " + g.graded.length + " right.");
    if (g.sentiment) { const neg = g.sentiment.rows.filter(r => r.label === "negative"), pos = g.sentiment.rows.filter(r => r.label === "positive"); if (neg.length || pos.length) parts.push("News tone for your holdings: " + [neg.length ? "negative for " + neg.map(r => r.symbol + " (" + r.score + ")").join(", ") : "", pos.length ? "positive for " + pos.map(r => r.symbol + " (+" + r.score + ")").join(", ") : ""].filter(Boolean).join("; ") + "."); }
    if (g.unread.length) parts.push(g.unread.length + " unread alert" + (g.unread.length > 1 ? "s" : "") + " in the inbox.");
    if (g.paper) parts.push("Paper account " + sgn(g.paper.v.returnPct, 2) + " against " + sgn(g.paper.v.mirrorReturnPct, 2) + " for the same trades in the S&P 500.");
    if (g.errs.length) parts.push("Unavailable: " + g.errs.join("; ") + ".");
    return parts.join(" ") + " Measured by the page from Nasdaq calendars, live quotes and your journal; open Today's Game Plan for details.";
  }
  async function autoDigest(app, opts = {}) {
    if (app.demo || app.settings.digest === false || (!opts.force && (document.hidden || !D.available()))) return null;
    const s = Q().session(), day = s.date;
    if (!opts.force && s.nyMinutes < 360) return null;
    if (app.store.cached("inbox").some(i => i.kind === "digest" && i.day === day)) return null;
    const g = await gather(app);
    await syncCatalysts(app, g);
    if (app.store.cached("inbox").some(i => i.kind === "digest" && i.day === day)) return null;
    const title = "Daily digest · " + new Date(day + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
    return app.store.create("inbox", { kind: "digest", day, title, body: digestText(g), materiality: 0.5, read: false, at: Date.now() });
  }

  V.today = function (root, app) {
    const s = Q().session();
    root.append(h("div", { class: "page-head" }, h("div", { class: "stack", style: "gap:4px" }, h("h1", { class: "page" }, "Today's Game Plan"),
      h("p", { class: "sub" }, new Date(s.date + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }) + " · " + clockText(s)))));
    const kpis = h("div", { class: "kpis k4" }), body = h("div", { class: "stack" }, h("div", { class: "skeleton" }, "Gathering today's calendar, your names and the desk's calls…"));
    const planBox = h("div", { class: "stack" }), saved = app.store.cached("gameplans").find(p => p.id === s.date);
    const digestChk = h("input", { type: "checkbox", checked: app.settings.digest !== false, onchange: (e) => app.saveSettings({ digest: e.target.checked }) });
    let G0 = null;
    const planBtn = h("button", { class: "btn", type: "button", onclick: async () => {
      planBtn.disabled = true; planBox.replaceChildren(h("div", { class: "skeleton" }, "Claude is reading today's facts…"));
      try { const p = await aiPlan(app, G0 || (G0 = await gather(app))); planBox.replaceChildren(planView(app, p)); planBtn.textContent = "Plan again"; }
      catch (e) { planBox.replaceChildren(U.errorBox({ message: MD.ai.errText ? MD.ai.errText(e) : U.errorText(e) })); }
      planBtn.disabled = false;
    } }, saved ? "Plan again" : "Make today's AI game plan");
    if (saved) planBox.append(planView(app, saved));
    root.append(U.section("At a glance", kpis),
      U.section("AI game plan", h("div", { class: "stack" }, h("div", { class: "row", style: "gap:10px;flex-wrap:wrap;align-items:center" }, planBtn, h("label", { class: "chk" }, digestChk, "Send a daily digest to the inbox (once a day after 6 a.m. ET, while the desk is open)")),
        h("p", { class: "tiny muted" }, "Claude turns the measured facts on this page into a few priorities; it adds no prices or events of its own. Not advice: you decide."), planBox)), body);
    (async () => {
      let g;
      try { g = G0 = await gather(app); } catch (e) { body.replaceChildren(U.errorBox({ message: U.errorText(e) })); return; }
      syncCatalysts(app, g).catch(() => {});
      const kpi = (l, v, sub, cls, onclick) => h("div", { class: "kpi" + (onclick ? " click" : ""), onclick, role: onclick ? "button" : null, tabindex: onclick ? 0 : null }, h("span", { class: "label" }, l), h("b", { class: "v " + (cls || "") }, v), h("span", { class: "s" }, sub));
      kpis.replaceChildren(
        kpi("SPY call", g.call ? g.call.upPct + "% up" : "Not made", g.call ? "for the " + g.call.target + " close" : "make it in the Market Brain", g.call ? (g.call.upPct > 50 ? "up" : g.call.upPct < 50 ? "down" : "") : "", () => app.go("brain")),
        kpi("Calls due this week", String(g.due.length), g.graded.length ? g.graded.filter(x => x.e.directionHit).length + " of " + g.graded.length + " graded since yesterday right" : "none graded since yesterday", "", () => app.go("research")),
        kpi("Unread alerts", String(g.unread.length), g.unread[0] ? g.unread[0].title.slice(0, 40) : "inbox is clear", g.unread.length ? "down" : "", () => app.go("inbox")),
        kpi("Paper account", g.paper ? U.pct(g.paper.v.returnPct) : "—", g.paper ? "S&P 500 mirror " + U.pct(g.paper.v.mirrorReturnPct) : "no paper trades yet", g.paper ? U.signCls(g.paper.v.returnPct - g.paper.v.mirrorReturnPct) : "", () => app.go("paper")));
      const lbl = (f) => (MD.ai.SOURCE_LABEL || {})[f.source] || f.source;
      body.replaceChildren(
        h("div", { class: "stack" },
          U.section("US economic releases today", g.econ ? U.table([{ t: "Time (GMT)", v: "gmt" }, { t: "Release", v: "event" }, { t: "Consensus", v: (x) => x.consensus || "—", n: true }, { t: "Previous", v: (x) => x.previous || "—", n: true }, { t: "Actual", v: (x) => x.actual || "—", n: true }], g.econ.slice(0, 15), { empty: "No US releases today." }) : h("p", { class: "small warn-t" }, "Economic calendar unavailable.")),
          U.section("Earnings for your names (next 5 trading days)", g.earnings ? U.table([{ t: "Stock", v: (x) => h("b", {}, x.symbol) }, { t: "Date", v: "date" }, { t: "When", v: (x) => /not.?supplied/i.test(x.time || "") ? "time not given" : x.time || "—" }, { t: "EPS forecast", v: (x) => x.epsForecast || "—", n: true }, { t: "Options imply", v: (x) => x.impliedMovePct != null ? "±" + x.impliedMovePct.toFixed(1) + "%" : "—", n: true }, { t: "Typical reaction", v: (x) => x.typicalReactionPct != null ? "±" + x.typicalReactionPct.toFixed(1) + "%" : "—", n: true }], g.earnings, { empty: g.names ? "None of your holdings or watchlist names report in the next five trading days." : "Add holdings or watchlist names to see their earnings here.", onRow: (x) => app.openAsset({ id: "stock:" + x.symbol, cls: "stock", symbol: x.symbol, name: x.name }) }) : h("p", { class: "small warn-t" }, "Earnings calendar unavailable."))),
        U.section("Your names today", h("div", { class: "stack" }, U.table([{ t: "Asset", v: (x) => h("span", { class: "who sym" }, h("b", {}, x.a.symbol), h("span", { class: "tiny muted" }, x.a.held ? "Holding" : "Watchlist")) },
          { t: "Price", v: (x) => U.money(x.q.price, x.q.currency || "USD", { price: true }), n: true }, { t: "Today", v: (x) => h("span", { class: U.signCls(x.q.changePct) }, sgn(x.q.changePct, 2)), n: true },
          { t: "Flags", v: (x) => h("span", { class: "small" }, [(g.earnings || []).some(e => e.symbol === x.a.symbol) ? "earnings this week" : "", g.due.some(f => f.assetId === x.a.id) ? "AI call due" : ""].filter(Boolean).join(" · ") || "—") }],
          g.moves.slice(0, 12), { empty: "Add holdings or watchlist names to see how they're moving.", onRow: (x) => app.openAsset(x.a) }),
          g.priceErrors.length ? h("p", { class: "tiny warn-t" }, "No live price for " + g.priceErrors.join(", ") + ".") : null)),
        U.section("AI calls coming due this week", U.table([{ t: "Asset", v: "symbol" }, { t: "By", v: (f) => lbl(f) }, { t: "Call", v: (f) => f.direction + (f.probability ? " · " + Math.round(f.probability * 100) + "%" : "") }, { t: "Due", v: (f) => U.fmtTs(f.dueAt) }], g.due.slice(0, 15), { empty: "Nothing comes due this week." })),
        g.graded.length ? U.section("Graded since yesterday", h("div", { class: "stack" }, h("p", { class: "small" }, g.graded.filter(x => x.e.directionHit).length + " of " + g.graded.length + " right."),
          U.table([{ t: "Asset", v: (x) => x.f.symbol }, { t: "By", v: (x) => lbl(x.f) }, { t: "Call", v: (x) => x.f.direction }, { t: "Result", v: (x) => h("span", { class: x.e.directionHit ? "up" : "down" }, (x.e.directionHit ? "Right" : "Wrong") + (x.e.realizedReturnPct != null ? " · " + sgn(Number(x.e.realizedReturnPct)) : "")) }], g.graded.slice(0, 8)),
          g.graded.length > 8 ? h("button", { class: "btn ghost sm", type: "button", onclick: () => app.go("research") }, "All " + g.graded.length + " in the forecast journal") : null)) : null,
        h("p", { class: "tiny muted" }, "Calendars from Nasdaq, prices from each asset's live source, calls and grades from your forecast journal · gathered " + U.fmtTs(g.at) + "." + (g.errs.length ? " Unavailable: " + g.errs.join("; ") + "." : "")));
    })();
  };
  function planView(app, p) {
    return h("div", { class: "stack aiplan" },
      h("p", {}, h("strong", {}, p.headline || (p.quietDay ? "A quiet day: nothing needs attention." : ""))),
      p.priorities.length ? h("ol", { class: "small", style: "margin:0;padding-left:1.3em;display:grid;gap:8px" }, p.priorities.map(x => h("li", {}, h("strong", {}, x.title), x.why ? h("span", {}, " — " + x.why) : null, " ",
        x.symbol ? h("button", { class: "btn ghost sm", type: "button", onclick: () => app.openAsset({ id: "stock:" + x.symbol, cls: "stock", symbol: x.symbol, name: x.symbol }) }, "Open " + x.symbol) : null,
        x.page ? h("button", { class: "btn ghost sm", type: "button", onclick: () => app.go(x.page) }, "Go to " + ((app.ROUTES.find(r => r[0] === x.page) || [, x.page])[1])) : null))) : null,
      p.watchFor.length ? h("div", { class: "small" }, h("span", { class: "label" }, "Watch for "), p.watchFor.join(" · ")) : null,
      h("p", { class: "tiny muted" }, "Made " + U.fmtTs(p.at) + " from the measured facts above."));
  }

  // Dashboard card: the clock, the SPY call, calls due, unread alerts and today's first US releases (store + one calendar read).
  function dashCard(box, app) {
    const s = Q().session(), call = MD.brain && MD.brain.latestCall ? MD.brain.latestCall(app) : null, now = Date.now();
    const done = new Set(app.store.cached("evals").map(e => e.forecastId)), due = app.store.cached("forecasts").filter(f => !done.has(f.id) && f.dueAt > now && f.dueAt - now < 7 * 864e5).length;
    const unread = app.store.cached("inbox").filter(i => !i.read && i.kind !== "digest").length, rel = h("p", { class: "small muted" }, "Checking today's US releases…");
    box.append(h("div", { class: "stack", style: "gap:6px" }, h("p", { class: "small" }, clockText(s)),
      h("p", { class: "small" }, call ? "SPY call for " + call.target + ": " + call.upPct + "% chance of a higher close." : "No SPY call yet for this session."),
      h("p", { class: "small" }, due + " AI call" + (due === 1 ? "" : "s") + " due this week · " + unread + " unread alert" + (unread === 1 ? "" : "s") + "."), rel,
      h("div", { class: "row" }, h("button", { class: "btn ghost sm", type: "button", onclick: () => app.go("today") }, "Open today's game plan"))));
    D.calendar.economic(s.date).then(r => { const us = r.filter(x => /United States|^US$/i.test(x.country || "")); rel.textContent = us.length ? "US releases today: " + us.slice(0, 3).map(x => x.event + (x.gmt ? " (" + x.gmt + " GMT)" : "")).join("; ") + (us.length > 3 ? " and " + (us.length - 3) + " more" : "") + "." : "No US economic releases today."; }).catch(() => { rel.textContent = "Economic calendar unavailable."; });
  }

  MD.today = { syncCatalysts, dashCard, gather, facts, aiPlan, digestText, autoDigest, clockText, myNames };
})(typeof window !== "undefined" ? window : globalThis);
