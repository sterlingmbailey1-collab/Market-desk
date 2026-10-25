/* Sports Betting: odds at each sportsbook for US leagues and the five big European soccer leagues,
   the chance each bet wins once the bookmaker's margin is removed, the Statz model and an optional AI
   read for soccer, a value and arbitrage finder, calculators, a bet slip with parlays, and a tracker
   for bets the viewer places elsewhere. Market Desk shows prices only; it never places a bet. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const C = MD.core, U = MD.ui, D = MD.data, O = MD.odds, B = MD.bet, h = U.h;
  const V = (MD.views = MD.views || {});
  const head = (...a) => MD.marketsHelpers.head(...a);
  const DEF = { oddsFormat: "american", bankroll: 1000, unit: 10, kelly: 0.25, minEdge: 1 };
  const prefs = (app) => Object.assign({}, DEF, app.settings.betting || {});
  const setPrefs = (app, patch) => app.saveSettings({ betting: Object.assign(prefs(app), patch) });
  const odds = (app, d) => O.fmt(d, prefs(app).oddsFormat);
  const pct = (p, dp = 1) => p == null || !isFinite(p) ? "—" : (p * 100).toFixed(dp) + "%";
  const edgeTxt = (e) => e == null || !isFinite(e) ? "—" : (e > 0 ? "+" : "") + (e * 100).toFixed(1) + "%";
  const lineTxt = (k, side, line) => line == null ? "" : k === "total" ? (side === "over" ? "O " : "U ") + line : line === 0 ? "PK" : (line > 0 ? "+" : "") + line;
  const SIDE_ORDER = { away: 0, home: 1, draw: 2, over: 0, under: 1 };
  const sideName = (g, side) => side === "home" ? g.home.name : side === "away" ? g.away.name : side === "draw" ? "Draw" : side === "over" ? "Over" : "Under";
  const title = (g) => g.soccer ? g.home.name + " vs " + g.away.name : g.away.name + " at " + g.home.name;
  const whenTxt = (g) => g.start ? new Date(g.start).toLocaleString(undefined, g.startHasTime ? { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } : { weekday: "short", month: "short", day: "numeric" }) : g.dateLabel || "Date not listed on the odds page";
  const STATUS = { upcoming: "Upcoming", listed: "Listed", "in progress": "In progress", past: "Started", final: "Final" };
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago"; };
  const sportLabel = (s) => (s.country ? s.country + " · " : "") + s.name;
  const bookTxt = (b) => b ? b.book + (b.exchange ? " (before fee)" : "") : "—";

  /* ---------- bet slip (this browser) ---------- */
  const slip = (app) => app.ls.get("bet.slip", []);
  const setSlip = (app, legs) => { app.ls.set("bet.slip", legs); app.emit("betslip", legs); };
  function legOf(g, k, side, book) {
    const mk = g.markets[k], q = mk.books[book][side];
    const pick = k === "ml" ? (side === "draw" ? "Draw" : sideName(g, side) + (g.soccer ? " to win" : " moneyline")) : k === "total" ? sideName(g, side) + " " + q.line : sideName(g, side) + " " + lineTxt(k, side, q.line);
    return { id: g.id + "|" + k + "|" + side + "|" + book, gameId: g.id, sport: g.sport, game: title(g), home: g.home.name, away: g.away.name, soccer: !!g.soccer, start: g.start || null, startDate: g.espn && g.espn.date || null, market: k, marketLabel: mk.label, side, pick, book, dec: q.dec, line: q.line, p: q.p ?? null, push: q.push || 0, modelP: q.modelP ?? null, addedAt: Date.now() };
  }
  function addLeg(app, leg, quiet) {
    const legs = slip(app).filter(l => l.id !== leg.id && !(l.gameId === leg.gameId && l.market === leg.market && l.side === leg.side));
    legs.push(leg); setSlip(app, legs);
    if (!quiet) U.toast("Added to bet slip", leg.pick + " · " + leg.book + " " + odds(app, leg.dec) + " · " + legs.length + " on the slip");
  }

  /* ---------- tracked bets (account storage) ---------- */
  const profit = (b) => b.status === "won" ? b.stake * (b.dec - 1) : b.status === "lost" ? -b.stake : b.status === "cashout" ? (Number(b.cashout) || 0) - b.stake : 0;
  const settled = (b) => ["won", "lost", "push", "void", "cashout"].includes(b.status);

  V.betting = function (root, app) {
    const ctx = app.ctx.betting;
    const off = app.on("betslip", () => { const p = root.querySelector(".slippanel"); if (p) p.replaceWith(slipPanel(app)); const bar = root.querySelector(".slipbar"); if (bar) bar.replaceWith(slipBar(app)); });
    const main = h("div", { class: "stack betmain" });
    root.append(h("div", { class: "betshell" }, main, h("aside", { class: "betaside" }, slipPanel(app))), slipBar(app));
    let stop = null;
    if (ctx && ctx.gameId) gameView(main, app, ctx); else stop = listView(main, app);
    // Re-read odds every 5 minutes while the tab is open (price alerts are checked on each read).
    const timer = setInterval(() => { const sport = ctx && ctx.gameId ? ctx.sport : app.ls.get("bet.sport", "nfl"); B.load(sport, true).then(r => checkAlerts(app, r)).catch(() => {}); }, 5 * 60e3);
    return () => { off(); clearInterval(timer); stop && stop(); };
  };

  /* ================= list ================= */
  const SHORT = { nfl: "NFL", ncaaf: "NCAAF", nba: "NBA", ncaab: "NCAAB", wnba: "WNBA", mlb: "MLB", nhl: "NHL", epl: "Premier League", laliga: "La Liga", seriea: "Serie A", bundesliga: "Bundesliga", ligue1: "Ligue 1" };
  function leagueChips(app, cur, onPick) {
    const groups = [...new Set(B.SPORTS.map(s => s.group))];
    return h("div", { class: "leagues", role: "group", "aria-label": "League" }, groups.map((gname, gi) => h("div", { class: "lg-group" }, gi ? h("span", { class: "lg-sep", "aria-hidden": "true" }) : null,
      B.SPORTS.filter(s => s.group === gname).map(s => h("button", { type: "button", class: "lg", "aria-pressed": String(s.id === cur), title: sportLabel(s), "data-league": s.id, onclick: () => onPick(s.id) }, SHORT[s.id] || s.name, s.country ? h("span", { class: "lg-c" }, s.country) : null)))));
  }
  function rgNote() {
    return h("details", { class: "rg" }, h("summary", { class: "tiny" }, h("strong", {}, "Bet responsibly."), " Only stake what you can afford to lose. Help: ", h("b", { class: "mono" }, "1-800-GAMBLER"), " (US) · Market Desk never places bets."),
      h("p", { class: "small" }, "Check that sports betting is legal where you are and that you meet the age limit (21+ in most US states, 18+ in the UK and EU). Help is free and confidential: call or text ", h("b", { class: "mono" }, "1-800-GAMBLER"), " (US), or visit ", h("a", { href: "https://www.begambleaware.org/", target: "_blank", rel: "noopener noreferrer" }, "BeGambleAware"), " (UK). You can set a daily loss limit and a stake cap under My bets."));
  }
  const VIEWS = [["games", "Games"], ["picks", "AI picks"], ["props", "Player props"], ["value", "Value & arbitrage"], ["bets", "My bets"], ["calc", "Calculators"], ["assistant", "AI assistant"]];
  function listView(root, app) {
    let sport = app.ls.get("bet.sport", "nfl"); if (!B.SPORTS.some(s => s.id === sport)) sport = "nfl";
    let tab = app.ls.get("bet.tab", "games"); if (!VIEWS.some(v => v[0] === tab)) tab = "games";
    const chips = h("div", {}), tabsBox = h("div", {}), body = h("div", { class: "stack" });
    root.append(h("div", { class: "page-head bethead" }, h("div", { class: "stack", style: "gap:2px" }, h("h1", { class: "page" }, "Sports Betting"), h("p", { class: "sub" }, "Odds from every book, the real chance of each bet, AI forecasts and picks, and tools to size and track your bets."))),
      rgNote(), chips, tabsBox, body);
    const paintHead = () => { chips.replaceChildren(leagueChips(app, sport, (v) => { sport = v; app.ls.set("bet.sport", v); paint(); })); tabsBox.replaceChildren(U.tabs(VIEWS, tab, (k) => { tab = k; app.ls.set("bet.tab", k); paint(); })); };
    function paint() {
      paintHead();
      body._loadId = (body._loadId || 0) + 1; // drop any odds load still in flight for the previous view
      body.replaceChildren();
      if (tab === "bets") return betsView(body, app);
      if (tab === "props") return MD.propsView(body, app, sport);
      if (tab === "calc") return calcView(body, app);
      if (tab === "assistant") return body.append(U.section("AI betting assistant", MD.betAI.assistant(app, () => ({ league: sport }))));
      const sp = B.sportOf(sport);
      U.async(body, () => B.load(sport), (r) => { checkAlerts(app, r); (tab === "value" ? valueView : tab === "picks" ? picksView : gamesView)(body, app, r); }, { loading: "Reading odds for " + sportLabel(sp) + " from " + (sp.soccer ? "SportsLine, Kalshi, ESPN and the Statz model" : "VegasInsider and ESPN") + "…" });
    }
    paint();
    return null;
  }
  function sourcesLine(r) {
    return h("div", { class: "srcline tiny muted" }, "Sources: ", ...r.sources.flatMap((s, i) => [i ? " · " : "", h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer" }, s.name), s.updated ? " (page updated " + U.fmtDate(s.updated) + ")" : ""]), " · read " + ago(r.loadedAt) + ". Odds move quickly and the copy read can lag: confirm the price in the sportsbook before betting.");
  }
  const dayOf = (g) => { if (!g.start) return "later"; const d = B.etYmd(g.start), t = B.etYmd(), t1 = B.etYmd(Date.now() + 864e5); return d === t ? "today" : d === t1 ? "tomorrow" : d < t ? "today" : "later"; };
  function gamesView(body, app, r) {
    const sp = r.sport, P = prefs(app);
    let day = app.ls.get("bet.day", "all"), valueOnly = app.ls.get("bet.valueOnly", false), showDone = app.ls.get("bet.show", "upcoming") === "all";
    const listBox = h("div", { class: "gamelist" }), info = h("span", { class: "tiny muted" });
    const fc = MD.betAI.cache(app);
    const hasValue = (g) => Object.values(g.markets).some(mk => Object.values(mk.books).some(q => mk.sides.some(s => q[s] && (q[s].edge > 0.01 || q[s].modelEdge > 0.03)))) || Object.values(g.markets).some(m => m.arb && m.arb.arb);
    const paintList = () => {
      let list = r.games.filter(g => showDone || (g.status !== "final" && g.status !== "past"));
      if (day !== "all") list = list.filter(g => dayOf(g) === day);
      if (valueOnly) list = list.filter(hasValue);
      info.textContent = list.length + " of " + r.games.length + " games · " + (r.books.length ? r.books.length + " books" : "no books") + (fc.size ? " · AI forecasts: " + r.games.filter(g => fc.has(g.id)).length : "");
      listBox.replaceChildren(...(list.length ? list.map(g => gameRow(app, g, sp)) : [h("div", { class: "empty" }, r.games.length ? "No games match these filters." : "No games are listed for " + sp.name + " right now. The league may be between games or out of season.")]));
    };
    const slateBtn = h("button", { class: "btn sm", type: "button" }, fc.size && r.games.some(g => fc.has(g.id)) ? "Re-run AI forecast for all games" : "AI forecast for all games");
    slateBtn.onclick = async () => {
      slateBtn.disabled = true; slateBtn.textContent = "Forecasting…";
      try { const out = await MD.betAI.forecastSlate(app, r); U.toast("AI forecasts ready", out.length + " games · first forecasts are logged to the AI track record"); paintList(); }
      catch (e) { U.toast("Forecast didn't finish", MD.betAI.errText(e), true); }
      slateBtn.disabled = false; slateBtn.textContent = "Re-run AI forecast for all games";
    };
    const fmtSeg = U.seg(["American", "Decimal", "Fractional"], P.oddsFormat[0].toUpperCase() + P.oddsFormat.slice(1), (v) => { setPrefs(app, { oddsFormat: v.toLowerCase() }); app.rerender(); });
    const vChk = h("input", { type: "checkbox", checked: !!valueOnly }); vChk.onchange = () => { valueOnly = vChk.checked; app.ls.set("bet.valueOnly", valueOnly); paintList(); };
    const dChk = h("input", { type: "checkbox", checked: !!showDone }); dChk.onchange = () => { showDone = dChk.checked; app.ls.set("bet.show", showDone ? "all" : "upcoming"); paintList(); };
    body.append(
      h("div", { class: "row between betbar" },
        h("div", { class: "row" }, U.seg(["All", "Today", "Tomorrow", "Later"], day[0].toUpperCase() + day.slice(1), (v) => { day = v.toLowerCase(); app.ls.set("bet.day", day); body.replaceChildren(); gamesView(body, app, r); }), h("label", { class: "chk" }, vChk, " Value only"), h("label", { class: "chk" }, dChk, " Finished too")),
        h("div", { class: "row" }, slateBtn, fmtSeg, h("button", { class: "btn ghost sm", type: "button", onclick: () => { B.cacheClear(); app.rerender(); } }, "Refresh odds"))),
      info,
      r.errors && r.errors.length ? h("div", { class: "banner warn" }, h("p", { class: "small" }, "Some sources didn't answer: " + r.errors.join(" · ") + ". What loaded is shown.")) : null,
      listBox, sourcesLine(r),
      h("p", { class: "tiny muted" }, "Win % is the fair chance with the bookmaker's margin removed" + (sp.soccer ? " (Kalshi's exchange prices, else the Statz model)" : "") + "; ✦ marks the AI's pick and its confidence. * Kalshi price before its trading fee."));
    paintList();
  }
  function bestCell(app, g, k, side) {
    const mk = g.markets[k]; if (!mk || !mk.best || !mk.best[side]) return h("span", { class: "faint" }, "—");
    const b = mk.best[side], q = mk.books[b.book][side];
    return h("span", { class: "bc", title: b.exchange ? "Kalshi exchange price before its trading fee" : "Best price: " + b.book }, h("b", { class: "num" }, (k === "ml" ? "" : lineTxt(k, side, b.line) + " ") + odds(app, b.dec)), h("span", { class: "tiny muted" }, " " + b.book + (b.exchange ? "*" : "")), q.edge != null && q.edge > 0.005 ? h("span", { class: "evtag" }, edgeTxt(q.edge)) : null);
  }
  function probBar(p, cls) { return h("span", { class: "pbar " + (cls || "") }, h("i", { style: "width:" + Math.max(0, Math.min(100, (p || 0) * 100)).toFixed(1) + "%" })); }
  function injBadge(list) { const out = (list || []).filter(p => p.severe).length, q = (list || []).filter(p => !p.severe && /questionable|day-to-day|doubtful/i.test(p.status)).length; return out || q ? h("span", { class: "injb", title: (list || []).map(p => p.name + ": " + p.status).join("\n") }, out ? out + " out" : "", out && q ? " · " : "", q ? q + " q" : "") : null; }
  function gameRow(app, g, sp) {
    const ml = g.markets.ml, f = MD.betAI.cache(app).get(g.id);
    const sides = g.soccer ? ["home", "draw", "away"] : ["away", "home"];
    const pOf = (s) => ml && ml.fair ? ml.fair[s] : g.model ? g.model[s] : null;
    const rec = (s) => g.espn ? h("span", {}, g.espn[s].record + (g.espn[s].split ? " (" + g.espn[s].split + (g.espn[s].splitKind ? " " + g.espn[s].splitKind.toLowerCase() : "") + ")" : "")) : null;
    const badges = [];
    const evs = Object.entries(g.markets).flatMap(([k, mk]) => Object.entries(mk.books).flatMap(([b, q]) => mk.sides.filter(s => q[s] && q[s].edge > 0.01).map(s => ({ b, e: q[s].edge }))));
    if (evs.length) { const top = evs.sort((a, b) => b.e - a.e)[0]; badges.push(h("span", { class: "chip ev" }, "Edge " + edgeTxt(top.e) + " · " + top.b)); }
    const arb = Object.values(g.markets).find(m => m.arb && m.arb.arb);
    if (arb) badges.push(h("span", { class: "chip arb" }, "Arb " + arb.arb.profitPct.toFixed(2) + "%"));
    if (g.espn && g.espn.tempF != null) badges.push(h("span", { class: "chip" }, g.espn.tempF + "°F"));
    if (g.model) badges.push(h("span", { class: "chip" }, "Statz model"));
    if (g.kalshi) badges.push(h("span", { class: "chip" }, "Kalshi"));
    return h("button", { class: "gamerow" + (f ? " has-ai" : ""), type: "button", onclick: () => app.openGame(g) },
      h("span", { class: "gr-when" }, h("span", { class: "tiny" }, whenTxt(g)), h("span", { class: "gstat " + g.status.replace(/\s/g, "") }, STATUS[g.status] || g.status)),
      h("span", { class: "gr-teams" }, sides.map(s => h("span", { class: "gr-side" + (f && f.winner === s ? " ai-pick" : "") },
        h("span", { class: "gr-name" }, h("span", { class: "gr-team" }, s === "draw" ? "Draw" : sideName(g, s)), s !== "draw" && (g.espn || (g.injuries && g.injuries[s] && g.injuries[s].length)) ? h("span", { class: "gr-meta" }, rec(s), g.injuries ? injBadge(g.injuries[s]) : null) : null),
        h("span", { class: "gr-p" }, probBar(pOf(s)), h("span", { class: "num small" }, pct(pOf(s), 0))),
        h("span", { class: "gr-odds" }, ml ? bestCell(app, g, "ml", s) : h("span", { class: "faint tiny" }, "no price"))))),
      h("span", { class: "gr-side2" },
        f ? h("span", { class: "aipick", title: "AI forecast (" + f.mode + "): " + sideName(g, f.winner) + " " + pct(f.probs[f.winner]) + ", confidence " + f.confidence + "/100" }, "✦ " + (f.winner === "draw" ? "Draw" : sideName(g, f.winner).split(" ").slice(-1)[0]) + " " + pct(f.probs[f.winner]), h("span", { class: "conf-dot", style: "--c:" + f.confidence }), f.predicted ? h("span", { class: "tiny muted" }, " " + (g.soccer ? f.predicted.home + "–" + f.predicted.away : f.predicted.away + "–" + f.predicted.home)) : null) : null,
        h("span", { class: "tiny muted" }, [g.markets.spread && g.markets.spread.mainLine != null ? (g.soccer ? "Hcp " : "Spread ") + sideName(g, "away").split(" ").slice(-1)[0] + " " + lineTxt("spread", "away", g.markets.spread.mainLine) : null, g.markets.total && g.markets.total.mainLine != null ? "Total " + g.markets.total.mainLine : null, Object.keys(g.markets).length ? null : "Model only: no odds yet"].filter(Boolean).join(" · ")),
        badges.length ? h("span", { class: "row gc-badges" }, badges) : null));
  }

  /* ---------- AI picks: slate forecasts, ready-made slips, track record ---------- */
  function picksView(body, app, r) {
    const A = MD.betAI, fc = A.cache(app), sp = r.sport;
    const fcs = r.games.filter(g => fc.has(g.id)).map(g => ({ g, f: fc.get(g.id) }));
    const run = h("button", { class: "btn", type: "button" }, fcs.length ? "Re-run the slate forecast" : "Forecast every " + sp.name + " game with AI");
    run.onclick = async () => { run.disabled = true; run.textContent = "Forecasting…"; try { await A.forecastSlate(app, r); body.replaceChildren(); picksView(body, app, r); } catch (e) { U.toast("Forecast didn't finish", A.errText(e), true); run.disabled = false; run.textContent = "Try again"; } };
    body.append(U.section("Most likely results", h("div", { class: "stack" },
      h("div", { class: "row between" }, h("p", { class: "small", style: "margin:0;max-width:62ch" }, "A quick AI pass over every game using the odds, ESPN injuries, records and home/away splits" + (sp.soccer ? ", and the Statz model" : "") + ". Open a game for an in-depth forecast with live news."), run),
      fcs.length ? U.table([
        { t: "Game", v: (x) => h("span", { class: "stack", style: "gap:2px;justify-items:start;text-align:left" }, h("button", { class: "linkbtn", type: "button", style: "text-align:left", onclick: () => app.openGame(x.g) }, title(x.g)), h("span", { class: "tiny muted" }, whenTxt(x.g) + (x.f.summary || x.f.why ? " · " + (x.f.summary || x.f.why) : ""))) },
        { t: "AI pick", v: (x) => h("b", {}, sideName(x.g, x.f.winner)) },
        { t: "AI chance", v: (x) => pct(x.f.probs[x.f.winner]), n: true },
        { t: "Market", v: (x) => x.f.fair && x.f.fair[x.f.winner] != null ? pct(x.f.fair[x.f.winner]) : "—", n: true },
        { t: "Score", v: (x) => x.f.predicted ? (x.g.soccer ? x.f.predicted.home + "–" + x.f.predicted.away : x.f.predicted.away + "–" + x.f.predicted.home) : "—", n: true },
        { t: "Confidence", v: (x) => confMeter(x.f) }
      ], fcs.sort((a, b) => b.f.confidence - a.f.confidence)) : h("div", { class: "empty" }, "No forecasts yet for " + sp.name + ". Run the slate forecast, or open a game for an in-depth one."))));
    const s = A.buildSlips(app, r);
    const legRow = (x) => h("div", { class: "sl-leg" }, h("b", {}, x.label), h("span", { class: "num small" }, odds(app, x.dec) + " · " + x.book), h("span", { class: "tiny muted" }, title(x.g) + " · " + pct(x.p) + " chance (" + x.src + ")"));
    const addSlip = (legs) => { for (const x of legs) { const l = legOf(x.g, x.k, x.side, x.book); if (x.src === "AI") l.aiP = x.p; addLeg(app, l, true); } U.toast("Slip loaded", legs.length + " legs on your bet slip"); };
    body.append(U.section("Ready-made slips", s.slips.length ? h("div", { class: "grid g3 slips" }, s.slips.map(x => h("div", { class: "slipcard" },
      h("div", { class: "row between" }, h("strong", {}, x.name), h("span", { class: "num" }, odds(app, x.dec))),
      h("p", { class: "tiny muted" }, x.blurb), ...x.legs.map(legRow),
      h("div", { class: "sl-stats" }, [["All win", x.p != null ? pct(x.p, 1) : "—"], ["$10 pays", U.money(10 * (x.dec - 1), "USD")], ["Expected", x.edge != null ? edgeTxt(x.edge) : "—"]].map(([k, v]) => h("div", {}, h("span", { class: "label" }, k), h("b", { class: "num" }, v)))),
      h("button", { class: "btn sm", type: "button", onclick: () => addSlip(x.legs) }, "Put on my bet slip")))) : h("div", { class: "empty" }, "Not enough priced games with probabilities to build slips."),
      [h("span", { class: "tiny muted" }, "Chances multiply as if games were independent. Each slip uses the best book per leg; a real parlay is priced at one book.")]));
    if (s.upsets.length || s.singles.length) body.append(h("div", { class: "grid g2" },
      U.section("Top singles", s.singles.length ? h("div", { class: "stack" }, s.singles.map(x => h("div", { class: "row between sl-single" }, legRow(x), h("button", { class: "btn ghost sm", type: "button", onclick: () => { const l = legOf(x.g, x.k, x.side, x.book); if (x.src === "AI") l.aiP = x.p; addLeg(app, l); } }, "+ Slip")))) : h("div", { class: "empty" }, "None above 55%.")),
      U.section("Upset watch", s.upsets.length ? h("div", { class: "stack" }, s.upsets.map(x => h("div", { class: "row between sl-single" }, legRow(x), h("button", { class: "btn ghost sm", type: "button", onclick: () => { const l = legOf(x.g, x.k, x.side, x.book); l.aiP = x.p; addLeg(app, l); } }, "+ Slip")))) : h("div", { class: "empty" }, "No underdog the AI rates well above the market."))));
    body.append(trackRecord(app), sourcesLine(r));
  }
  function confMeter(f) {
    const p = f.parts || {};
    return h("span", { class: "confm", title: "AI " + p.ai + " · data coverage " + p.coverage + " · agreement with market " + p.agreement }, h("span", { class: "meter" }, h("i", { style: "width:" + f.confidence + "%" })), h("span", { class: "num tiny" }, f.confidence + "/100"));
  }
  function trackRecord(app) {
    const A = MD.betAI, box = h("div", { class: "stack" });
    const paint = () => {
      const rec = A.record(app);
      box.replaceChildren(
        h("div", { class: "grid g4" }, [["Picks graded", String(rec.graded), ""], ["Hit rate", rec.hitRate != null ? pct(rec.hitRate) + " vs " + pct(rec.avgP) + " expected" : "—", ""], ["Brier score", rec.brier != null ? rec.brier.toFixed(3) : "—", ""], ["Return at best price", rec.roi != null ? edgeTxt(rec.roi) + " per pick" : "—", rec.roi != null ? U.signCls(rec.roi) : ""]].map(([k, v, c]) => h("div", { class: "tile" }, h("span", { class: "label" }, k), h("span", { class: "v " + c }, v)))),
        rec.graded ? U.table([{ t: "Stated chance", v: "label" }, { t: "Picks", v: (b) => String(b.n), n: true }, { t: "Expected hit rate", v: (b) => b.n ? pct(b.expected) : "—", n: true }, { t: "Actual", v: (b) => b.n ? pct(b.actual) : "—", n: true }], rec.buckets) : null,
        rec.rows.length ? U.dataTable([{ t: "Game", v: "game", sort: (x) => x.game }, { t: "Date", v: (x) => x.startDate || U.fmtDate(x.at), sort: (x) => x.start || x.at }, { t: "AI pick", v: "pickName" }, { t: "Chance", v: (x) => pct(x.p), sort: (x) => x.p, n: true }, { t: "Conf.", v: (x) => String(x.confidence ?? "—"), sort: (x) => x.confidence, n: true }, { t: "Result", v: (x) => x.grade ? h("span", { class: "gstat " + (x.grade.result === "hit" ? "won" : x.grade.result === "miss" ? "lost" : "") }, x.grade.result + (x.grade.score ? " · " + x.grade.score.away + "–" + x.grade.score.home : "")) : h("span", { class: "tiny muted" }, "pending"), sort: (x) => x.grade ? x.grade.result : "zz" }], rec.rows, { key: "betpicks", sort: [1, -1], pageSize: 15, noun: "AI picks", placeholder: "Filter picks…" }) : h("div", { class: "empty" }, "No AI picks logged yet. The first forecast for each game is logged automatically."),
        h("p", { class: "tiny muted" }, "Each game's first AI forecast is logged and can't be changed, so the record can't be cherry-picked. Results are graded from ESPN final scores. Until there are dozens of graded picks, these numbers are mostly noise."));
    };
    paint();
    const btn = h("button", { class: "btn ghost sm", type: "button" }, "Check results");
    btn.onclick = async () => { btn.disabled = true; btn.textContent = "Checking scores…"; try { const r = await MD.betAI.gradePicks(app); U.toast("Results checked", r.graded + " of " + r.checked + " finished picks graded"); } catch (e) { U.toast("Couldn't check results", U.errorText(e), true); } btn.disabled = false; btn.textContent = "Check results"; paint(); };
    return U.section("AI track record", box, [btn]);
  }

  /* ---------- value & arbitrage across the league ---------- */
  function valueView(body, app, r) {
    const P = prefs(app);
    let min = Number(app.ls.get("bet.minEdge", P.minEdge)) || 0, useModel = app.ls.get("bet.useModel", true);
    const rows = [];
    for (const g of r.games) {
      if (g.status === "final" || g.status === "past") continue;
      for (const [k, mk] of Object.entries(g.markets)) for (const [b, q] of Object.entries(mk.books)) for (const s of mk.sides) {
        const x = q[s]; if (!x) continue;
        const e = x.edge, me = x.modelEdge;
        rows.push({ g, k, mk, b, s, x, e, me, p: x.p, mp: x.modelP });
      }
    }
    const tableBox = h("div", {});
    const paint = () => {
      const pick = rows.filter(r0 => (r0.e != null && r0.e * 100 >= min) || (useModel && r0.me != null && r0.me * 100 >= min)).map(r0 => Object.assign(r0, { use: useModel && r0.me != null && (r0.e == null || r0.me > r0.e) ? "model" : "market" }));
      tableBox.replaceChildren(U.dataTable([
        { t: "Game", v: (x) => h("button", { class: "linkbtn", type: "button", onclick: () => app.openGame(x.g) }, title(x.g)), sort: (x) => x.g.start || 0 },
        { t: "When", v: (x) => h("span", { class: "tiny" }, whenTxt(x.g)), sort: (x) => x.g.start || 0 },
        { t: "Bet", v: (x) => x.mk.label + ": " + (x.k === "ml" ? sideName(x.g, x.s) : sideName(x.g, x.s) + " " + lineTxt(x.k, x.s, x.x.line).replace(/^[OU] /, "")), sort: (x) => x.k },
        { t: "Book", v: (x) => x.b === "Kalshi" ? "Kalshi (before fee)" : x.b, sort: (x) => x.b },
        { t: "Odds", v: (x) => h("b", { class: "num" }, odds(app, x.x.dec)), sort: (x) => x.x.dec, n: true },
        { t: "Wins (fair)", v: (x) => pct(x.p), sort: (x) => x.p, n: true },
        { t: "Market edge", v: (x) => h("span", { class: "num " + U.signCls(x.e) }, edgeTxt(x.e)), sort: (x) => x.e, n: true },
        { t: "Model edge", v: (x) => x.me == null ? "—" : h("span", { class: "num " + U.signCls(x.me) }, edgeTxt(x.me) + " (" + pct(x.mp, 0) + ")"), sort: (x) => x.me, n: true },
        { t: "Kelly stake", v: (x) => { const p = x.use === "model" ? x.mp : x.p; const f = p != null ? O.kelly(p, x.x.dec, x.x.push || 0) * P.kelly : 0; return f > 0 ? U.money(f * P.bankroll, "USD") : "—"; }, sort: (x) => (x.use === "model" ? x.me : x.e) || 0, n: true },
        { t: "", v: (x) => h("button", { class: "btn ghost sm", type: "button", onclick: () => addLeg(app, legOf(x.g, x.k, x.s, x.b)) }, "+ Slip") }
      ], pick, { key: "betvalue", sort: [6, -1], pageSize: 40, noun: "prices", empty: "No price clears " + min + "% edge right now. That's normal: books copy each other quickly.", placeholder: "Filter by team, book or bet…", text: (x) => title(x.g) + " " + x.b + " " + x.mk.label }));
    };
    const arbs = [];
    for (const g of r.games) for (const [k, mk] of Object.entries(g.markets)) if (mk.arb && mk.arb.arb && g.status !== "final" && g.status !== "past") arbs.push({ g, k, mk });
    const minSel = h("select", { "aria-label": "Minimum edge" }, [0, 0.5, 1, 2, 3, 5].map(v => h("option", { value: v, selected: v === min }, v + "%")));
    minSel.onchange = () => { min = Number(minSel.value); app.ls.set("bet.minEdge", min); paint(); };
    const mChk = h("input", { type: "checkbox", checked: !!useModel }); mChk.onchange = () => { useModel = mChk.checked; app.ls.set("bet.useModel", useModel); paint(); };
    body.append(
      U.section("Prices above the fair line", h("div", { class: "stack" },
        h("div", { class: "row" }, U.field("Minimum edge", minSel), r.sport.soccer ? h("label", { class: "chk" }, mChk, " Include Statz model edges") : null),
        tableBox,
        h("p", { class: "tiny muted" }, "Market edge compares a book's price with the fair chance from all the books together, so it finds prices that are out of line with the market. That is the most reliable kind of value, but it can vanish within minutes and some books limit winning accounts. Model edge compares with the Statz projection, which can be wrong. Kelly stakes use your bankroll (" + U.money(P.bankroll, "USD") + ") at " + (P.kelly * 100).toFixed(0) + "% Kelly; change both under My bets."))),
      U.section("Arbitrage: back every outcome, profit whatever happens", arbs.length ? h("div", { class: "stack" }, arbs.map(a => arbCard(app, a))) : h("div", { class: "empty" }, "No arbitrage in the prices read. When the best prices for every outcome add up to less than 100%, it shows here with the stakes."), [h("span", { class: "tiny muted" }, "Books void palpable errors and may limit arbitrage bettors.")]),
      sourcesLine(r));
    paint();
  }
  function arbCard(app, a) {
    const { g, k, mk } = a, T = 100;
    const st = mk.arb.stakes.map(x => x * T / 100);
    return h("div", { class: "arbcard" }, h("div", { class: "row between" }, h("button", { class: "linkbtn", type: "button", onclick: () => app.openGame(g) }, title(g) + " · " + mk.label), h("span", { class: "chip arb" }, "+" + mk.arb.profitPct.toFixed(2) + "% locked")),
      U.table([{ t: "Outcome", v: (x) => sideName(g, x.s) + (k === "ml" ? "" : " " + lineTxt(k, x.s, x.b.line)) }, { t: "Best price", v: (x) => odds(app, x.b.dec) + " · " + x.b.book, n: true }, { t: "Stake of $100", v: (x) => "$" + x.stake.toFixed(2), n: true }, { t: "Returns", v: (x) => "$" + (x.stake * x.b.dec).toFixed(2), n: true }],
        mk.sides.map((s, i) => ({ s, b: mk.best[s], stake: st[i] }))),
      k !== "ml" && new Set(mk.sides.map(s => Math.abs(mk.best[s].line))).size > 1 ? h("p", { class: "tiny warn-t" }, "The two prices are on different lines, so a result landing between them changes the outcome.") : null);
  }

  /* ================= game detail ================= */
  function gameView(root, app, ctx) {
    root.append(app.backBar());
    const box = h("div", { class: "stack" });
    root.append(box);
    U.async(box, () => B.load(ctx.sport), (r) => {
      checkAlerts(app, r);
      const g = r.games.find(x => x.id === ctx.gameId) || r.games.find(x => title(x) === ctx.label);
      if (!g) { box.append(h("div", { class: "empty" }, "This game is no longer on the odds pages read. It may have started or been taken down."), h("button", { class: "btn ghost", type: "button", onclick: () => app.back() }, "Back to the list")); return; }
      renderGame(box, app, g, r);
    }, { loading: "Loading the game's odds, injuries and records…" });
  }
  const GTABS = [["overview", "Overview"], ["odds", "Odds"], ["stats", "Stats & model"], ["ai", "AI analysis"]];
  function renderGame(box, app, g, r) {
    const sp = r.sport;
    let tab = app.ls.get("bet.gtab", "overview"); if (!GTABS.some(t => t[0] === tab)) tab = "overview";
    const tabsBox = h("div", {}), body = h("div", { class: "stack" });
    const e = g.espn;
    box.append(
      h("div", { class: "hero bethero" }, h("div", { class: "stack", style: "gap:4px" },
        h("span", { class: "label" }, sportLabel(sp) + " · " + (STATUS[g.status] || g.status)),
        h("h1", { class: "page" }, title(g)),
        h("span", { class: "small muted" }, [whenTxt(g) + (g.startHasTime ? " (your time)" : ""), e && e.venue ? e.venue : null, e && e.tempF != null ? e.tempF + "°F at game time" : null, e && e.status === "final" ? "Final " + (g.soccer ? e.home.score + "–" + e.away.score : e.away.score + "–" + e.home.score) : null].filter(Boolean).join(" · "))),
        h("div", { class: "row" }, g.model && g.model.url ? h("a", { class: "btn ghost sm", href: g.model.url, target: "_blank", rel: "noopener noreferrer" }, "Statz preview ↗") : null, g.kalshi ? h("a", { class: "btn ghost sm", href: g.kalshi.url, target: "_blank", rel: "noopener noreferrer" }, "Kalshi ↗") : null)),
      g.status === "final" || g.status === "past" ? h("div", { class: "banner warn" }, h("p", {}, "This game has started or finished. The prices below are the last ones the page showed, not live in-game odds.")) : null,
      tabsBox, body);
    const paint = () => {
      tabsBox.replaceChildren(U.tabs(GTABS, tab, (k) => { tab = k; app.ls.set("bet.gtab", k); paint(); }));
      body.replaceChildren();
      if (tab === "overview") {
        const chances = h("div", {});
        const paintChances = () => chances.replaceChildren(chancePanel(app, g, sp));
        paintChances();
        body.append(chances, forecastCard(app, g, sp, () => { paintChances(); }), h("div", { class: "grid g2" }, injuryPanel(g), matchupPanel(g, sp)), Object.keys(g.markets).length ? payoutSection(app, g) : null);
      } else if (tab === "odds") {
        if (!Object.keys(g.markets).length) body.append(h("div", { class: "banner info" }, h("p", {}, "No sportsbook prices are listed for this game yet; books usually post soccer lines about a week ahead. The model's probabilities and fair odds are under Stats & model.")));
        for (const k of ["ml", "spread", "total"]) if (g.markets[k]) body.append(oddsSection(app, g, k, sp));
        if (Object.keys(g.markets).length) body.append(movementSection(app, g), alertsSection(app, g, sp));
      } else if (tab === "stats") {
        if (g.modelGoals) body.append(modelSection(app, g));
        body.append(h("div", { class: "grid g2" }, matchupPanel(g, sp), injuryPanel(g)));
        if (g.model && g.model.fixtureId) body.append(leadersSection(app, g));
        if (!g.modelGoals && !(g.model && g.model.fixtureId)) body.append(h("p", { class: "tiny muted" }, "Player stats and props for US leagues are coming in the next update."));
      } else {
        const aiBox = h("div", { id: "sec-ai" });
        body.append(aiBox, U.section("Ask the AI assistant about this game", MD.betAI.assistant(app, () => ({ league: g.sport, game: title(g) }))));
        forecastDetail(aiBox, app, g, sp);
      }
    };
    paint();
    box.append(sourcesLine(r));
  }
  function injuryPanel(g) {
    if (!g.injuries) return U.section("Injuries", h("p", { class: "small muted" }, g.soccer ? "No injury report is read for soccer. The AI analysis searches the news for team news." : "No ESPN injury report is read for this league; the AI analysis searches the news instead."));
    const side = (s) => { const list = g.injuries[s] || []; return h("div", { class: "stack", style: "gap:4px" }, h("span", { class: "label" }, sideName(g, s)), list.length ? h("ul", { class: "injlist" }, list.slice(0, 10).map(p => h("li", { class: p.severe ? "sev" : "" }, h("b", {}, p.name), " " + p.pos + " · ", h("span", { class: "gstat " + (p.severe ? "lost" : "inprogress") }, p.status), p.returns ? h("span", { class: "tiny muted" }, " · back ~" + p.returns) : null, p.comment ? h("div", { class: "tiny muted" }, p.comment.slice(0, 180)) : null))) : h("p", { class: "tiny muted" }, "Nobody listed.")); };
    return U.section("Injuries", h("div", { class: "stack" }, side("away"), side("home"), h("a", { class: "tiny", href: g.injuries.url, target: "_blank", rel: "noopener noreferrer" }, "ESPN injury report ↗")));
  }
  function matchupPanel(g, sp) {
    const e = g.espn;
    if (!e) return U.section("Matchup", h("p", { class: "small muted" }, "ESPN's scoreboard didn't list this game, so records and venue aren't shown."));
    const row = (s) => [sideName(g, s), e[s].record + (e[s].split ? " · " + e[s].split + " " + (e[s].splitKind || "").toLowerCase() : "")];
    return U.section("Matchup", h("div", { class: "stack" }, U.kv([row("away"), row("home"), ["Venue", e.venue || "—"], ["Temperature", e.tempF != null ? e.tempF + "°F" : "—"], ["ESPN line", [e.spread, e.total != null ? "total " + e.total : null].filter(Boolean).join(" · ") || "—"]]),
      h("p", { class: "tiny muted" }, "Records are " + (g.soccer ? "wins–draws–losses" : "wins–losses") + "; the second figure is the record at home or on the road. From ESPN's scoreboard.")));
  }
  /* ---------- AI forecast on the game page ---------- */
  function forecastCard(app, g, sp, onDone) {
    const box = h("div", {});
    const paint = () => {
      const f = MD.betAI.cache(app).get(g.id);
      const run = h("button", { class: f ? "btn ghost sm" : "btn sm", type: "button" }, f && f.mode === "deep" ? "Update with fresh news" : "Forecast this game with AI");
      run.onclick = async () => { run.disabled = true; run.textContent = "Reading injuries and news…"; try { await MD.betAI.forecastGame(app, g, sp); onDone && onDone(); paint(); } catch (e) { U.toast("Forecast didn't finish", MD.betAI.errText(e), true); run.disabled = false; run.textContent = "Try again"; } };
      box.replaceChildren(U.section("Most likely result", f ? h("div", { class: "stack" },
        h("div", { class: "fc-head" }, h("div", { class: "stack", style: "gap:2px" }, h("span", { class: "label" }, "AI pick" + (f.mode === "quick" ? " (quick pass)" : "")), h("span", { class: "fc-pick" }, sideName(g, f.winner) + " " + pct(f.probs[f.winner], 0)), f.predicted ? h("span", { class: "small muted" }, "Predicted score " + (g.soccer ? g.home.name + " " + f.predicted.home + "–" + f.predicted.away + " " + g.away.name : g.away.name + " " + f.predicted.away + "–" + f.predicted.home + " " + g.home.name)) : null),
          h("div", { class: "stack", style: "gap:4px;min-width:180px" }, h("span", { class: "label" }, "Confidence"), confMeter(f), h("span", { class: "tiny muted" }, "AI " + f.parts.ai + " · data " + f.parts.coverage + " · agrees with market " + f.parts.agreement))),
        f.summary ? h("p", { class: "small" }, f.summary) : null,
        f.mode === "deep" ? h("p", { class: "tiny muted" }, "Full reasoning, factors and sources are on the AI analysis tab.") : h("p", { class: "tiny muted" }, "Quick pass from the page's data only. Run the full forecast for live injury and lineup news."),
        h("div", { class: "row" }, run)) : h("div", { class: "stack" }, h("p", { class: "small" }, "Claude reads the odds, the injury report, records and splits" + (sp.soccer ? ", the Statz model" : "") + ", then searches for lineup news, recent form and weather, and gives the most likely result with a confidence score."), h("div", { class: "row" }, run))));
    };
    paint();
    return box;
  }
  function forecastDetail(box, app, g, sp) {
    const log = h("div", { class: "log" }), out = h("div", { class: "stack" });
    const paint = () => {
      const f = MD.betAI.cache(app).get(g.id);
      const run = h("button", { class: "btn", type: "button" }, f && f.mode === "deep" ? "Run again with fresh news" : "Run the full AI forecast");
      let ctl = null; const stop = h("button", { class: "btn ghost", type: "button", hidden: true, onclick: () => ctl && ctl.abort() }, "Stop");
      run.onclick = async () => { ctl = new AbortController(); run.disabled = true; stop.hidden = false; log.replaceChildren(); out.replaceChildren(h("div", { class: "skeleton" }, "Checking injuries, lineups, form and weather…")); try { await MD.betAI.forecastGame(app, g, sp, { signal: ctl.signal, onLog: (e) => { log.append(h("div", { class: e.kind }, e.text)); } }); paint(); } catch (e) { out.replaceChildren(e && e.code === "cancelled" ? h("p", { class: "muted" }, "Stopped.") : U.errorBox({ message: MD.betAI.errText(e) })); run.disabled = false; stop.hidden = true; } };
      box.replaceChildren(U.section("AI forecast", h("div", { class: "stack" }, h("p", { class: "small" }, "Starts from the market's fair line and moves away only as far as the evidence supports. The first forecast for each game is logged to the AI track record."), h("div", { class: "row" }, run, stop), out, h("details", {}, h("summary", { class: "label" }, "Research steps"), log))));
      if (f) out.replaceChildren(forecastBody(app, g, f));
    };
    paint();
  }
  function forecastBody(app, g, f) {
    const P = prefs(app), ml = g.markets.ml, rows = [];
    for (const [s, p] of Object.entries(f.probs)) { const b = ml && ml.best && ml.best[s]; rows.push({ bet: (ml ? ml.label : "Result") + ": " + sideName(g, s), p, fair: f.fair ? f.fair[s] : null, b, k: "ml", s }); }
    const sp = g.markets.spread, tt = g.markets.total;
    if (f.spreadAway != null && sp && sp.best && sp.best.away && sp.best.home) rows.push({ bet: sp.label + ": " + g.away.name + " " + lineTxt("spread", "away", sp.mainLine), p: f.spreadAway, fair: sp.fair ? sp.fair.away : null, b: sp.best.away, k: "spread", s: "away" }, { bet: sp.label + ": " + g.home.name + " " + lineTxt("spread", "home", -sp.mainLine), p: 1 - f.spreadAway, fair: sp.fair ? sp.fair.home : null, b: sp.best.home, k: "spread", s: "home" });
    if (f.over != null && tt && tt.best && tt.best.over && tt.best.under) rows.push({ bet: tt.label + ": over " + tt.mainLine, p: f.over, fair: tt.fair ? tt.fair.over : null, b: tt.best.over, k: "total", s: "over" }, { bet: tt.label + ": under " + tt.mainLine, p: 1 - f.over, fair: tt.fair ? tt.fair.under : null, b: tt.best.under, k: "total", s: "under" });
    const unver = f.factors.filter(x => x.source_url && !x.verified).length;
    const bb = f.bestBet;
    return h("div", { class: "stack" },
      h("div", { class: "row between" }, h("span", { class: "verdict " + (bb ? "positive" : "neutral") }, bb ? "Best bet: " + (bb.market === "ml" ? sideName(g, bb.side) : bb.market + " " + bb.side) : "No bet"), h("span", { class: "tiny muted" }, (f.mode === "deep" ? "Full forecast" : "Quick pass") + " · " + U.fmtTs(f.at))),
      h("div", { class: "fc-head" }, h("div", { class: "stack", style: "gap:2px" }, h("span", { class: "fc-pick" }, sideName(g, f.winner) + " " + pct(f.probs[f.winner], 0)), f.predicted ? h("span", { class: "small muted" }, "Predicted " + (g.soccer ? f.predicted.home + "–" + f.predicted.away : f.predicted.away + "–" + f.predicted.home)) : null), h("div", { class: "stack", style: "gap:4px;min-width:200px" }, confMeter(f), h("span", { class: "tiny muted" }, "AI " + f.parts.ai + " · data coverage " + f.parts.coverage + " (" + f.parts.coverageWhy.join(", ") + ") · agreement with market " + f.parts.agreement), f.why ? h("span", { class: "tiny" }, f.why) : null)),
      unver ? h("div", { class: "banner warn" }, h("p", { class: "small" }, unver + " cited source(s) weren't retrieved in this analysis; treat those claims as unconfirmed.")) : null,
      f.summary ? h("div", { class: "prose" }, h("p", {}, f.summary), bb && bb.reason ? h("p", { class: "muted" }, bb.reason) : null) : null,
      rows.length ? U.table([{ t: "Bet", v: "bet" }, { t: "AI chance", v: (x) => pct(x.p, 1), n: true }, { t: "Market fair", v: (x) => pct(x.fair, 1), n: true }, { t: "Best price", v: (x) => x.b ? odds(app, x.b.dec) + " · " + bookTxt(x.b) : "—", n: true }, { t: "AI edge", v: (x) => x.b ? h("span", { class: "num " + U.signCls(x.p * x.b.dec - 1) }, edgeTxt(x.p * x.b.dec - 1)) : "—", n: true }, { t: "Kelly stake", v: (x) => { const k = x.b ? O.kelly(x.p, x.b.dec) * P.kelly : 0; return k > 0 ? U.money(Math.min(k, 0.02) * P.bankroll, "USD") : "—"; }, n: true }, { t: "", v: (x) => x.b ? h("button", { class: "btn ghost sm", type: "button", onclick: () => { const l = legOf(g, x.k, x.s, x.b.book); l.aiP = x.p; addLeg(app, l); } }, "+ Slip") : "" }], rows) : null,
      h("div", { class: "grid g2" },
        h("div", { class: "stack" }, h("h3", {}, "Key factors"), f.factors.length ? h("ul", { class: "small" }, f.factors.map(x => h("li", {}, h("span", { class: "imp " + (x.impact || "") }, x.impact || ""), " ", x.factor, x.favors && x.favors !== "none" ? h("span", { class: "tiny muted" }, " (favours " + (["home", "away"].includes(x.favors) ? sideName(g, x.favors) : x.favors) + ")") : null, x.source_url ? h("span", {}, " · ", h("a", { href: x.source_url, target: "_blank", rel: "noopener noreferrer" }, String(x.source_url).replace(/^https?:\/\//, "").split("/")[0]), x.verified ? null : h("span", { class: "warn-t tiny" }, " unverified")) : null))) : h("p", { class: "muted small" }, "None given.")),
        h("div", { class: "stack" }, h("h3", {}, "Injuries, form and risk"), U.kv([["Injury impact", f.injuryImpact || "—"], ["Form", f.form || "—"], ["Upset risk", f.upsetRisk || "—"], ["Versus the market", f.market || "—"]]))),
      f.risks.length || f.gaps.length ? h("div", { class: "small" }, h("span", { class: "label" }, "Risks and gaps"), h("ul", {}, [...f.risks, ...f.gaps.map(x => "Not found: " + x)].map(x => h("li", {}, String(x))))) : null,
      h("p", { class: "tiny muted" }, "An AI estimate, not a guarantee. Sources retrieved: " + f.sources.length + ". Kelly stakes use your bankroll at " + Math.round(P.kelly * 100) + "% Kelly, capped at 2% of bankroll."));
  }
  /* ---------- price alerts (checked whenever odds are read while the page is open) ---------- */
  const alertsOf = (app) => app.ls.get("bet.alerts", []);
  function alertsSection(app, g, sp) {
    const box = h("div", { class: "stack" });
    const opts = [];
    for (const [k, mk] of Object.entries(g.markets)) for (const s of mk.sides) if (mk.best && mk.best[s]) opts.push({ k, s, label: mk.label + ": " + sideName(g, s) });
    const sel = h("select", { "aria-label": "Bet to watch" }, opts.map((o, i) => h("option", { value: i }, o.label)));
    const kind = h("select", { "aria-label": "Condition" }, h("option", { value: "price" }, "best price reaches (odds)"), h("option", { value: "line" }, "line reaches (number)"));
    const target = h("input", { type: "text", placeholder: "+150 or -2.5", "aria-label": "Target" });
    const msg = h("span", { class: "tiny warn-t" });
    const paint = () => {
      const mine = alertsOf(app).filter(a => a.gameId === g.id);
      box.replaceChildren(h("div", { class: "form" }, U.field("Bet", sel), U.field("Alert when the", kind), U.field("Target", target), h("div", { class: "field" }, h("span", { class: "label" }, " "), h("button", { class: "btn ghost sm", type: "button", onclick: add }, "Add alert"))), msg,
        mine.length ? U.table([{ t: "Alert", v: (a) => a.label + " · " + (a.kind === "price" ? "price ≥ " + O.fmtAm(a.target) : "line ≥ " + a.target) }, { t: "Status", v: (a) => a.hitAt ? h("span", { class: "gstat won" }, "Hit " + U.fmtTs(a.hitAt)) : "Watching" }, { t: "", v: (a) => h("button", { class: "linkbtn", type: "button", onclick: () => { app.ls.set("bet.alerts", alertsOf(app).filter(x => x.id !== a.id)); paint(); } }, "Remove") }], mine) : h("p", { class: "tiny muted" }, "No alerts on this game."),
        h("p", { class: "tiny muted" }, "Checked each time the odds are read while Market Desk is open (it refreshes every 5 minutes on this tab). Alerts appear as a notification and in your Alerts inbox; nothing runs when the page is closed."));
    };
    function add() {
      const o = opts[Number(sel.value)]; if (!o) return;
      let t;
      if (kind.value === "price") { t = O.parseOdds(target.value); if (!t) { msg.textContent = "Enter odds like +150, 2.50 or 6/4."; return; } }
      else { t = parseFloat(target.value); if (!isFinite(t)) { msg.textContent = "Enter a line like -2.5 or 44.5."; return; } }
      msg.textContent = "";
      app.ls.set("bet.alerts", alertsOf(app).concat({ id: MD.store.newId(), sport: sp.id, gameId: g.id, game: title(g), market: o.k, side: o.s, label: o.label, kind: kind.value, target: t, at: Date.now() }));
      U.toast("Alert added", o.label); paint();
    }
    paint();
    const sec = U.section("Price alerts", box); sec.id = "sec-alerts"; return sec;
  }
  function checkAlerts(app, r) {
    const list = alertsOf(app); if (!list.length) return;
    let changed = false;
    for (const a of list) {
      if (a.hitAt || a.sport !== r.sport.id) continue;
      const g = r.games.find(x => x.id === a.gameId); if (!g || !g.markets[a.market]) continue;
      const b = g.markets[a.market].best && g.markets[a.market].best[a.side]; if (!b) continue;
      const hit = a.kind === "price" ? b.dec >= a.target - 1e-9 : b.line != null && b.line >= a.target;
      if (!hit) continue;
      a.hitAt = Date.now(); changed = true;
      const text = a.label + " is now " + (a.market === "ml" ? "" : lineTxt(a.market, a.side, b.line) + " ") + O.fmtAm(b.dec) + " at " + b.book;
      U.toast("Betting alert: " + a.game, text);
      if (!app.demo && app.store) app.store.create("inbox", { kind: "alert", title: "Betting alert: " + a.game, body: text + ". Source: " + (r.sources[0] ? r.sources[0].name : "odds page") + ".", materiality: 2, read: false, at: Date.now() }).catch(() => {});
    }
    if (changed) app.ls.set("bet.alerts", list);
  }
  function chancePanel(app, g, sp) {
    const ml = g.markets.ml;
    const sides = g.soccer ? ["home", "draw", "away"] : ["away", "home"];
    const ai = (app._betAI || new Map()).get(g.id);
    const rows = sides.map(s => {
      const fair = ml && ml.fair ? ml.fair[s] : null, model = g.model ? g.model[s] : null, aiP = ai && ai.probs ? ai.probs[s] : null;
      const best = ml && ml.best ? ml.best[s] : null;
      return { s, fair, model, aiP, best };
    });
    const sec = U.section("Chance of each result", h("div", { class: "stack" },
      h("div", { class: "chance" }, rows.map(x => h("div", { class: "ch-row" },
        h("span", { class: "ch-name" }, x.s === "draw" ? "Draw" : sideName(g, x.s)),
        h("div", { class: "ch-bars" },
          x.fair != null ? h("div", { class: "ch-b" }, h("span", { class: "tiny label" }, "Market"), probBar(x.fair, "mk"), h("b", { class: "num" }, pct(x.fair))) : null,
          x.model != null ? h("div", { class: "ch-b" }, h("span", { class: "tiny label" }, "Statz model"), probBar(x.model, "md"), h("b", { class: "num" }, pct(x.model))) : null,
          x.aiP != null ? h("div", { class: "ch-b" }, h("span", { class: "tiny label" }, "AI estimate"), probBar(x.aiP, "ai"), h("b", { class: "num" }, pct(x.aiP))) : null,
          x.fair == null && x.model == null && x.aiP == null ? h("span", { class: "tiny muted" }, "No estimate") : null),
        h("span", { class: "ch-best small" }, x.best ? h("span", {}, "Best ", h("b", { class: "num" }, odds(app, x.best.dec)), " at " + x.best.book + (x.best.exchange ? " (before fee)" : ""), h("br"), h("span", { class: "tiny muted" }, "fair price " + (x.fair ? odds(app, 1 / x.fair) : x.model ? odds(app, 1 / x.model) : "—"))) : x.model ? h("span", { class: "tiny muted" }, "Fair price " + odds(app, 1 / x.model)) : null)))),
      h("p", { class: "tiny muted" }, (ml && ml.fairFrom ? "Market chance from " + ml.fairFrom + ", with the margin removed. " : "") + (g.model ? "The Statz model projects " + g.model.hg.toFixed(2) + "–" + g.model.ag.toFixed(2) + " goals (" + g.home.name + "–" + g.away.name + "). " : "") + (g.soccer ? "Soccer results are after 90 minutes plus stoppage time. " : "Moneylines include overtime. ") + "A fair price is the odds at which a bet breaks even over time.")));
    sec.id = "sec-chance";
    return sec;
  }
  function oddsSection(app, g, k, sp) {
    const mk = g.markets[k];
    const ord = (x) => g.soccer ? { home: 0, draw: 1, away: 2, over: 0, under: 1 }[x] : SIDE_ORDER[x];
    const sides = mk.sides.slice().sort((a, b) => ord(a) - ord(b));
    const books = Object.keys(mk.books).sort((a, b) => (a === "Kalshi") - (b === "Kalshi") || a.localeCompare(b));
    const cell = (b, s) => {
      const x = mk.books[b][s]; if (!x) return h("span", { class: "faint" }, "—");
      const ev = x.edge != null && x.edge > 0.005, mev = x.modelEdge != null && x.modelEdge > 0.02;
      return h("button", { class: "oc" + (x.isBest ? " best" : "") + (ev ? " ev" : ""), type: "button", title: "Add to bet slip", onclick: () => addLeg(app, legOf(g, k, s, b)) },
        h("b", { class: "num" }, (k === "ml" ? "" : lineTxt(k, s, x.line) + " ") + odds(app, x.dec)),
        h("span", { class: "tiny oc-sub" }, "implied " + pct(1 / x.dec, 0) + (x.p != null ? " · wins " + pct(x.p, 0) : "") + (x.push > 0.005 ? " · push " + pct(x.push, 0) : "")),
        x.edge != null ? h("span", { class: "tiny oc-sub " + U.signCls(x.edge) }, "edge " + edgeTxt(x.edge)) : null,
        x.modelP != null ? h("span", { class: "tiny oc-sub" + (mev ? " up" : "") }, "model " + pct(x.modelP, 0) + (x.modelEdge != null ? " · " + edgeTxt(x.modelEdge) : "")) : null);
    };
    const refRow = (label, ref) => ref ? h("tr", { class: "ref" }, h("th", { scope: "row" }, label), ...sides.map(s => h("td", {}, ref[s] ? h("span", { class: "num small" }, (k === "ml" ? "" : lineTxt(k, s, ref[s].line) + " ") + (ref[s].dec ? odds(app, ref[s].dec) : "")) : "—")), h("td", {}, "")) : null;
    const tbl = h("div", { class: "tbl-wrap" }, h("table", { class: "tbl oddtbl" },
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Book"), ...sides.map(s => h("th", { scope: "col" }, s === "draw" ? "Draw" : sideName(g, s))), h("th", { scope: "col", class: "n" }, "Margin"))),
      h("tbody", {}, books.map(b => h("tr", {}, h("th", { scope: "row" }, b, b === "Kalshi" ? h("span", { class: "tiny faint" }, " exchange") : null), ...sides.map(s => h("td", {}, cell(b, s))), h("td", { class: "n tiny" }, mk.books[b].hold != null ? pct(mk.books[b].hold) : "—"))),
        refRow("Opening line", mk.open), refRow("Consensus", mk.consensus),
        mk.fair ? h("tr", { class: "ref fair" }, h("th", { scope: "row" }, "Fair (no margin)"), ...sides.map(s => h("td", {}, mk.fair[s] != null ? h("span", { class: "num small" }, pct(mk.fair[s]) + " · " + odds(app, 1 / mk.fair[s])) : "—")), h("td", {}, "")) : null)));
    const notes = [];
    if (mk.lowestHold) notes.push("Lowest margin: " + mk.lowestHold.book + " at " + pct(mk.lowestHold.hold) + ".");
    if (mk.mainLine != null) notes.push("Main line " + lineTxt(k, mk.sides[0], mk.mainLine) + "; probabilities at other lines " + (g.soccer ? "come from the Statz goal model" : "use a normal model of the " + (k === "total" ? "combined score" : "margin") + " (σ ≈ " + (O.SIGMA[sp.sigma] || {})[k === "total" ? "total" : "margin"] + " " + sp.unit + ")") + ".");
    if (mk.arb && mk.arb.arb) notes.push("The best prices form an arbitrage of " + mk.arb.profitPct.toFixed(2) + "% (see Value & arbitrage).");
    if (k === "spread" && g.soccer) notes.push("Quarter lines (±0.25, ±0.75) split the stake across the two neighbouring lines, so half can push.");
    if (k === "spread" && !g.soccer && sp.id === "nfl") notes.push("NFL margins bunch on 3 and 7, so the normal model is rough around those numbers.");
    if (mk.fairFrom) notes.push("Fair line from " + mk.fairFrom + ".");
    if (mk.books.Kalshi) notes.push("Kalshi is an exchange: its prices are shown before its trading fee, so they don't count as the best price or toward arbitrage when a sportsbook quotes the same outcome.");
    const sec = U.section(mk.label + (k === "spread" && mk.mainLine != null ? " · " + sideName(g, mk.sides[0]) + " " + lineTxt(k, mk.sides[0], mk.mainLine) : k === "total" && mk.mainLine != null ? " · " + mk.mainLine : ""), h("div", { class: "stack" }, tbl,
      h("div", { class: "legend-row tiny" }, h("span", {}, h("i", { class: "swatch sq best-sw" }), "Best price"), h("span", {}, h("i", { class: "swatch sq ev-sw" }), "Pays above fair"), h("span", {}, "Click any price to add it to the bet slip")),
      notes.length ? h("p", { class: "tiny muted" }, notes.join(" ")) : null));
    sec.id = "sec-" + k;
    return sec;
  }
  function modelSection(app, g) {
    const m = g.modelGoals;
    const fair = (p) => p > 0.001 && p < 0.999 ? odds(app, 1 / p) : "—";
    const ou = [0.5, 1.5, 2.5, 3.5, 4.5].map(l => { const r = m.over(l); return { l, over: r.win, under: r.lose }; });
    const ah = [-1.5, -1, -0.5, 0, 0.5, 1, 1.5].map(l => ({ l, home: m.homeHandicap(l), away: m.awayHandicap(-l) }));
    const scoreGrid = h("div", { class: "scoregrid" }, m.scores.slice(0, 9).map(s => h("div", { class: "sg-c" }, h("b", { class: "num" }, s.home + "–" + s.away), h("span", { class: "tiny" }, pct(s.p)), h("span", { class: "tiny muted" }, fair(s.p)))));
    const dist = m.totals.slice(0, 7);
    const maxP = Math.max(...dist.map(d => d[1]));
    const sec = U.section("Model markets (Statz goal projection)", h("div", { class: "stack" },
      h("div", { class: "grid g3" },
        h("div", { class: "tile" }, h("span", { class: "label" }, "Both teams score"), h("span", { class: "v" }, pct(m.btts)), h("span", { class: "tiny muted" }, "Yes " + fair(m.btts) + " · No " + fair(1 - m.btts))),
        h("div", { class: "tile" }, h("span", { class: "label" }, g.home.name + " clean sheet"), h("span", { class: "v" }, pct(m.cleanSheetHome)), h("span", { class: "tiny muted" }, "fair " + fair(m.cleanSheetHome))),
        h("div", { class: "tile" }, h("span", { class: "label" }, g.away.name + " clean sheet"), h("span", { class: "v" }, pct(m.cleanSheetAway)), h("span", { class: "tiny muted" }, "fair " + fair(m.cleanSheetAway)))),
      h("div", { class: "grid g2" },
        h("div", { class: "stack" }, h("h3", {}, "Total goals"), U.table([{ t: "Line", v: (x) => String(x.l) }, { t: "Over", v: (x) => pct(x.over) + " · " + fair(x.over), n: true }, { t: "Under", v: (x) => pct(x.under) + " · " + fair(x.under), n: true }], ou),
          h("div", { class: "gdist" }, dist.map(([n, p]) => h("div", { class: "gd-b", title: n + " goals: " + pct(p) }, h("i", { style: "height:" + (p / maxP * 100).toFixed(0) + "%" }), h("span", { class: "tiny" }, n === dist[dist.length - 1][0] ? n + "+" : String(n)))))),
        h("div", { class: "stack" }, h("h3", {}, "Handicap (home line)"), U.table([{ t: g.home.name, v: (x) => (x.l > 0 ? "+" : "") + x.l }, { t: "Home covers", v: (x) => pct(x.home.win) + (x.home.push > 0.001 ? " (push " + pct(x.home.push, 0) + ")" : ""), n: true }, { t: "Fair", v: (x) => fair(x.home.win / Math.max(1e-9, 1 - x.home.push)), n: true }, { t: "Away covers", v: (x) => pct(x.away.win), n: true }], ah))),
      h("h3", {}, "Most likely scores"), scoreGrid,
      h("p", { class: "tiny muted" }, "Built from Statz's projected goals (" + m.lh.toFixed(2) + " – " + m.la.toFixed(2) + ") with independent Poisson scoring. Real matches have slightly more draws and fewer 0–0s than this simple model, and it ignores red cards and tactics. Compare these fair prices with your sportsbook's: a book paying more than the fair price is the bet worth a closer look.")));
    sec.id = "sec-model";
    return sec;
  }
  function movementSection(app, g) {
    const rows = [];
    for (const [k, mk] of Object.entries(g.markets)) {
      if (!mk.open) continue;
      for (const s of mk.sides) {
        const o = mk.open[s], c = mk.consensus && mk.consensus[s] ? mk.consensus[s] : null;
        if (!o) continue;
        const cur = c || (mk.best && mk.best[s]);
        let move = "—";
        if (k === "ml" && o.dec && cur && cur.dec) { const dp = 1 / cur.dec - 1 / o.dec; move = Math.abs(dp) < 0.005 ? "steady" : (dp > 0 ? "shortened (more backed)" : "drifted (less backed)") + " " + (dp > 0 ? "+" : "") + (dp * 100).toFixed(1) + " pts"; }
        else if (o.line != null && cur && cur.line != null) { const d = cur.line - o.line; move = Math.abs(d) < 1e-9 ? "steady" : (k === "total" ? (d > 0 ? "up " : "down ") + Math.abs(d) : (d < 0 ? "toward " : "away from ") + sideName(g, s) + " by " + Math.abs(d)); }
        rows.push({ k, mk, s, o, cur, move });
      }
    }
    const sec = U.section("Line movement", rows.length ? h("div", { class: "stack" }, U.table([{ t: "Market", v: (x) => x.mk.label }, { t: "Side", v: (x) => sideName(g, x.s) }, { t: "Opened", v: (x) => (x.k === "ml" ? "" : lineTxt(x.k, x.s, x.o.line) + " ") + (x.o.dec ? odds(app, x.o.dec) : ""), n: true }, { t: "Now (consensus)", v: (x) => x.cur ? (x.k === "ml" ? "" : lineTxt(x.k, x.s, x.cur.line) + " ") + (x.cur.dec ? odds(app, x.cur.dec) : "") : "—", n: true }, { t: "Move", v: "move" }], rows),
      h("p", { class: "tiny muted" }, "Opening lines are from the odds page (VegasInsider's opener, or SportsLine's consensus open). A line that moves against the public side often reflects professional money; it is a clue, not a guarantee.")) : h("div", { class: "empty" }, "The odds page lists no opening line for this game."));
    sec.id = "sec-move";
    return sec;
  }
  function payoutSection(app, g) {
    const P = prefs(app);
    const stake = h("input", { type: "number", min: "0", step: "1", value: String(P.unit), "aria-label": "Stake", style: "max-width:140px" });
    const out = h("div", {});
    const paint = () => {
      const s = Math.max(0, Number(stake.value) || 0);
      const rows = [];
      for (const [k, mk] of Object.entries(g.markets)) for (const side of mk.sides) { const b = mk.best && mk.best[side]; if (!b) continue; const x = mk.books[b.book][side]; rows.push({ k, mk, side, b, x }); }
      out.replaceChildren(rows.length ? U.table([{ t: "Bet", v: (r) => r.mk.label + ": " + (r.k === "ml" ? sideName(g, r.side) : sideName(g, r.side) + " " + lineTxt(r.k, r.side, r.b.line).replace(/^[OU] /, "")) }, { t: "Best price", v: (r) => odds(app, r.b.dec) + " · " + bookTxt(r.b), n: true }, { t: "Profit if it wins", v: (r) => U.money(s * (r.b.dec - 1), "USD"), n: true }, { t: "Total return", v: (r) => U.money(s * r.b.dec, "USD"), n: true }, { t: "Chance", v: (r) => pct(r.x.p), n: true }, { t: "Expected profit", v: (r) => r.x.edge != null ? h("span", { class: "num " + U.signCls(r.x.edge) }, U.money(s * r.x.edge, "USD")) : "—", n: true }], rows) : h("div", { class: "empty" }, "No prices to calculate from."));
    };
    stake.oninput = paint; paint();
    const sec = U.section("What a bet pays", h("div", { class: "stack" }, U.field("Stake (USD)", stake), out, h("p", { class: "tiny muted" }, "Expected profit = chance × profit − (1 − chance) × stake, using the fair chance. Negative is normal: it is the bookmaker's margin.")));
    sec.id = "sec-pay";
    return sec;
  }
  function leadersSection(app, g) {
    const box = h("div", {});
    U.async(box, () => B.statzLeaders(g.model.fixtureId), (r) => {
      const panels = (r.panels || []).slice(0, 8);
      if (!panels.length) { box.append(h("div", { class: "empty" }, "Statz lists no leaders for this match.")); return; }
      box.append(h("div", { class: "grid g2 leaders" }, panels.map(p => h("div", { class: "stack lpanel" }, h("span", { class: "label" }, p.title), h("ol", { class: "small" }, (p.rows || []).slice(0, 5).map(x => h("li", {}, h("b", {}, x.name), " ", h("span", { class: "num" }, String(x.value)), h("span", { class: "tiny muted" }, " · " + (x.detail || "")))))))),
        r.link ? h("a", { class: "tiny", href: r.link.url, target: "_blank", rel: "noopener noreferrer" }, r.link.label + " ↗") : null);
    }, { loading: "Loading team leaders from Statz…" });
    const sec = U.section("Team leaders this season (Statz)", box);
    sec.id = "sec-leaders";
    return sec;
  }

  /* ================= bet slip: singles, parlay, round robin ================= */
  // Round robin: every k-leg parlay from the slip. Outcome odds are exact over all win/lose combinations
  // (legs treated as independent), so the chance of finishing ahead is computed, not guessed.
  function roundRobin(legs, k, stake) {
    const n = legs.length, combos = [];
    const rec = (start, pick) => { if (pick.length === k) { combos.push(pick.slice()); return; } for (let i = start; i < n; i++) { pick.push(i); rec(i + 1, pick); pick.pop(); } };
    if (k >= 2 && k <= n) rec(0, []);
    const total = combos.length * stake, decOf = (c) => c.reduce((a, i) => a * legs[i].dec, 1);
    const maxReturn = combos.reduce((a, c) => a + stake * decOf(c), 0);
    const ps = legs.map(l => l.aiP ?? l.p ?? l.modelP);
    let pProfit = null, ev = null;
    if (ps.every(p => p != null) && n <= 10) {
      pProfit = 0; ev = 0;
      for (let m = 0; m < (1 << n); m++) {
        let pr = 1; for (let i = 0; i < n; i++) pr *= (m >> i) & 1 ? ps[i] : 1 - ps[i];
        let ret = 0; for (const c of combos) if (c.every(i => (m >> i) & 1)) ret += stake * decOf(c);
        if (ret > total + 1e-9) pProfit += pr; ev += pr * (ret - total);
      }
    }
    return { combos: combos.length, total, maxReturn, pProfit, ev };
  }
  function todaysLoss(app) {
    const t = B.etYmd();
    return -app.store.cached("bets").filter(b => settled(b) && b.settledAt && B.etYmd(b.settledAt) === t).reduce((a, b) => a + profit(b), 0);
  }
  function slipBar(app) {
    const n = slip(app).length;
    return h("button", { class: "slipbar", type: "button", hidden: !n, onclick: () => { const m = U.modal("Bet slip", slipPanel(app, () => m.close())); } }, h("b", {}, "Bet slip"), h("span", {}, n + " leg" + (n === 1 ? "" : "s")), h("span", { class: "tiny" }, "Open ▴"));
  }
  function slipPanel(app, onDone) {
    const P = prefs(app), legs = slip(app);
    const panel = h("div", { class: "slippanel stack" });
    if (!legs.length) { panel.append(h("div", { class: "sp-head" }, h("strong", {}, "Bet slip")), h("p", { class: "tiny muted" }, "Empty. Click any price, or load a ready-made slip from AI picks.")); return panel; }
    let mode = app.ls.get("bet.slipMode", "singles"); if (mode === "parlay" && legs.length < 2) mode = "singles"; if (mode === "rr" && legs.length < 3) mode = "singles";
    let rrK = Math.min(app.ls.get("bet.rrK", 2), legs.length - 1);
    const stakeIn = h("input", { type: "number", min: "0", step: "1", value: String(app.ls.get("bet.slipStake", P.unit)), "aria-label": "Stake", style: "max-width:110px" });
    const out = h("div", { class: "stack" }), warn = h("div", { class: "stack" });
    const pOf = (l) => l.aiP ?? l.p ?? l.modelP;
    const refresh = () => panel.replaceWith(slipPanel(app, onDone));
    const paint = () => {
      const P = prefs(app); // read fresh: limits can change while the slip is open
      const stake = Math.max(0, Number(stakeIn.value) || 0); app.ls.set("bet.slipStake", stake);
      const sameGame = new Set(legs.map(l => l.gameId)).size < legs.length, books = new Set(legs.map(l => l.book));
      if (mode === "parlay") {
        const pr = O.parlay(legs.map(l => ({ dec: l.dec, p: pOf(l) })));
        out.replaceChildren(U.kv([["Parlay odds", odds(app, pr.dec)], ["Pays", U.money(stake * (pr.dec - 1), "USD")], ["Chance", pr.p != null ? pct(pr.p, 1) : "—"], ["Expected", pr.edge != null ? U.money(stake * pr.edge, "USD") : "—"]]));
      } else if (mode === "rr") {
        const rr = roundRobin(legs, rrK, stake);
        out.replaceChildren(U.kv([["Parlays", rr.combos + " × " + U.money(stake, "USD")], ["Total staked", U.money(rr.total, "USD")], ["If all win", U.money(rr.maxReturn - rr.total, "USD") + " profit"], ["Chance to finish ahead", rr.pProfit != null ? pct(rr.pProfit, 1) : "—"], ["Expected", rr.ev != null ? U.money(rr.ev, "USD") : "—"]]));
      } else {
        const ev = legs.reduce((a, l) => a + (pOf(l) != null ? stake * O.edge(pOf(l), l.dec, l.push || 0) : 0), 0);
        out.replaceChildren(U.kv([["Bets", String(legs.length)], ["Total staked", U.money(stake * legs.length, "USD")], ["If all win", U.money(legs.reduce((a, l) => a + stake * (l.dec - 1), 0), "USD")], ["Expected", U.money(ev, "USD")]]));
      }
      const w = [];
      if (mode !== "singles" && sameGame) w.push("Two legs are from the same game: their results are linked, so the chance shown is wrong and most books only allow it as a priced same-game parlay.");
      if (mode !== "singles" && books.size > 1) w.push("Prices come from " + books.size + " books; a parlay is placed at one book, so its price there will differ.");
      const capPct = Number(P.maxStakePct) || 0, perBet = mode === "rr" ? stake : stake;
      if (capPct > 0 && perBet > P.bankroll * capPct / 100) w.push("This stake is above your cap of " + capPct + "% of bankroll (" + U.money(P.bankroll * capPct / 100, "USD") + ").");
      const lim = Number(P.dailyLossLimit) || 0, lost = todaysLoss(app);
      if (lim > 0 && lost >= lim) w.push("You've reached today's loss limit (" + U.money(lim, "USD") + "). Taking a break is the limit doing its job.");
      warn.replaceChildren(...w.map(t => h("p", { class: "tiny warn-t" }, t)));
    };
    stakeIn.oninput = paint;
    const logBtn = h("button", { class: "btn sm", type: "button", onclick: async () => {
      const stake = Math.max(0, Number(stakeIn.value) || 0);
      if (!stake) { U.toast("Enter a stake first", null, true); return; }
      if (app.demo) { U.toast("Demo mode", "Bets aren't saved in demo mode.", true); return; }
      const P = prefs(app), lim = Number(P.dailyLossLimit) || 0, capPct = Number(P.maxStakePct) || 0;
      if (lim > 0 && todaysLoss(app) >= lim && !(await U.confirmBox("Daily loss limit reached", "You set a daily loss limit of " + U.money(lim, "USD") + " and today's settled bets have reached it. Log this anyway?", "Log anyway"))) return;
      if (capPct > 0 && stake > P.bankroll * capPct / 100 && !(await U.confirmBox("Above your stake cap", "This stake is above your cap of " + capPct + "% of bankroll. Log it anyway?", "Log anyway"))) return;
      const base = { createdAt: Date.now(), placedAt: Date.now(), stake, currency: "USD", status: "open", note: "" };
      if (mode === "single" || mode === "singles") { for (const l of legs) await app.store.put("bets", MD.store.newId(), Object.assign({}, base, { type: "single", legs: [l], dec: l.dec, book: l.book, pick: l.pick, game: l.game, sport: l.sport, market: l.market, fairP: pOf(l), start: l.start, gameId: l.gameId })); }
      else {
        const groups = mode === "rr" ? (() => { const out = []; const rec = (s, p) => { if (p.length === rrK) { out.push(p.map(i => legs[i])); return; } for (let i = s; i < legs.length; i++) { p.push(i); rec(i + 1, p); p.pop(); } }; rec(0, []); return out; })() : [legs];
        for (const ls of groups) { const pr = O.parlay(ls.map(l => ({ dec: l.dec, p: pOf(l) }))); await app.store.put("bets", MD.store.newId(), Object.assign({}, base, { type: "parlay", rr: mode === "rr" ? rrK : null, legs: ls, dec: pr.dec, book: [...new Set(ls.map(l => l.book))].join(" / "), pick: ls.length + "-leg parlay" + (mode === "rr" ? " (round robin)" : ""), game: ls.map(l => l.game).join(" + "), sport: ls[0].sport, fairP: pr.p, start: Math.min(...ls.map(l => l.start || Infinity)) || null })); }
      }
      setSlip(app, []); U.toast("Logged in My bets", "Settle them there after the games, or let Check results suggest outcomes."); onDone && onDone();
      if (app.route === "betting" && !(app.ctx.betting && app.ctx.betting.gameId)) { app.ls.set("bet.tab", "bets"); app.rerender(); }
    } }, "Log as placed");
    const modes = [["singles", "Singles"], ["parlay", "Parlay"], ["rr", "Round robin"]];
    panel.append(
      h("div", { class: "sp-head" }, h("strong", {}, "Bet slip (" + legs.length + ")"), h("button", { class: "linkbtn tiny", type: "button", onclick: () => { setSlip(app, []); } }, "Clear")),
      h("div", { class: "sp-legs" }, legs.map(l => h("div", { class: "sp-leg" }, h("div", { class: "stack", style: "gap:0;min-width:0" }, h("b", { class: "small" }, l.pick), h("span", { class: "tiny muted" }, l.game), h("span", { class: "tiny" }, l.book + " · chance " + pct(pOf(l), 0) + (l.aiP != null ? " (AI)" : ""))), h("span", { class: "num" }, odds(app, l.dec)), h("button", { class: "linkbtn tiny", type: "button", "aria-label": "Remove " + l.pick, onclick: () => setSlip(app, slip(app).filter(x => x.id !== l.id)) }, "✕")))),
      U.seg(modes.map(m => m[1]), modes.find(m => m[0] === mode)[1], (v) => { app.ls.set("bet.slipMode", modes.find(m => m[1] === v)[0]); refresh(); }, (v) => (v === "Parlay" && legs.length < 2) || (v === "Round robin" && legs.length < 3)),
      mode === "rr" ? U.field("Parlays of", (() => { const s = h("select", { "aria-label": "Round robin size" }, Array.from({ length: legs.length - 2 }, (_, i) => i + 2).map(k => h("option", { value: k, selected: k === rrK }, k + " legs"))); s.onchange = () => { app.ls.set("bet.rrK", Number(s.value)); refresh(); }; return s; })()) : null,
      U.field(mode === "singles" ? "Stake per bet (USD)" : mode === "rr" ? "Stake per parlay (USD)" : "Stake (USD)", stakeIn), out, warn,
      h("div", { class: "row" }, logBtn),
      h("p", { class: "tiny muted" }, "A worksheet: place the bet in your sportsbook, then log it here to track it."));
    paint();
    return panel;
  }

  /* ================= my bets ================= */
  function betsView(body, app) {
    const P = prefs(app);
    const all = app.store.cached("bets").slice().sort((a, b) => (b.placedAt || b.createdAt) - (a.placedAt || a.createdAt));
    let filter = app.ls.get("bet.filter", "all");
    const done = all.filter(settled), open = all.filter(b => !settled(b));
    const staked = done.reduce((a, b) => a + (b.status === "void" ? 0 : b.stake), 0), pl = done.reduce((a, b) => a + profit(b), 0);
    const graded = done.filter(b => b.status === "won" || b.status === "lost"), wins = graded.filter(b => b.status === "won").length;
    const clvs = all.filter(b => b.closingDec > 1).map(b => O.clv(b.dec, b.closingDec));
    const expected = done.filter(b => b.fairP != null && b.status !== "void").reduce((a, b) => a + b.stake * O.edge(b.fairP, b.dec), 0);
    const bankroll = P.bankroll + pl;
    // Settings
    const bInput = h("input", { type: "number", min: "0", step: "10", value: String(P.bankroll), "aria-label": "Starting bankroll" });
    const uInput = h("input", { type: "number", min: "0", step: "1", value: String(P.unit), "aria-label": "Unit size" });
    const kSel = h("select", { "aria-label": "Kelly fraction" }, [[1, "Full Kelly (aggressive)"], [0.5, "Half Kelly"], [0.25, "Quarter Kelly (common)"], [0.1, "Tenth Kelly (cautious)"]].map(([v, t]) => h("option", { value: v, selected: v === P.kelly }, t)));
    const lInput = h("input", { type: "number", min: "0", step: "5", value: String(P.dailyLossLimit || 0), "aria-label": "Daily loss limit" });
    const cInput = h("input", { type: "number", min: "0", max: "100", step: "0.5", value: String(P.maxStakePct || 0), "aria-label": "Stake cap percent" });
    const saveP = () => setPrefs(app, { bankroll: Math.max(0, Number(bInput.value) || 0), unit: Math.max(0, Number(uInput.value) || 0), kelly: Number(kSel.value), dailyLossLimit: Math.max(0, Number(lInput.value) || 0), maxStakePct: Math.max(0, Math.min(100, Number(cInput.value) || 0)) });
    bInput.onchange = saveP; uInput.onchange = saveP; kSel.onchange = saveP; lInput.onchange = saveP; cInput.onchange = saveP;
    const suggestBox = h("div", { class: "stack" });
    const checkBtn = h("button", { class: "btn ghost sm", type: "button", disabled: !open.length }, "Check results");
    checkBtn.onclick = async () => {
      checkBtn.disabled = true; checkBtn.textContent = "Reading final scores…";
      try {
        const sug = await suggestSettlements(app);
        suggestBox.replaceChildren(sug.length ? h("div", { class: "banner info stack" }, h("p", { class: "small" }, h("strong", {}, sug.length + " bet(s) can be settled from ESPN final scores. "), "Check each, then apply."),
          U.table([{ t: "Bet", v: (x) => x.bet.pick + " · " + x.bet.game }, { t: "Suggested", v: (x) => h("span", { class: "gstat " + (x.status === "won" ? "won" : x.status === "lost" ? "lost" : "") }, x.status === "cashout" ? "Part win · returns " + U.money(x.cashout, "USD") : x.status) }, { t: "Detail", v: (x) => h("span", { class: "tiny" }, x.text) }, { t: "", v: (x) => h("button", { class: "btn sm", type: "button", onclick: async () => { await app.store.put("bets", x.bet.id, Object.assign({}, x.bet, { status: x.status, cashout: x.cashout, settledAt: Date.now(), settleNote: "From ESPN final score: " + x.text })); app.rerender(); } }, "Apply") }], sug)) : h("p", { class: "tiny muted" }, "No open bet has a final score yet (only bets added from the odds pages can be checked)."));
      } catch (e) { suggestBox.replaceChildren(U.errorBox(e)); }
      checkBtn.disabled = false; checkBtn.textContent = "Check results";
    };
    body.append(
      h("div", { class: "grid g4" }, [["Bankroll now", U.money(bankroll, "USD"), U.signCls(pl)], ["Profit / loss", (pl >= 0 ? "+" : "") + U.money(pl, "USD"), U.signCls(pl)], ["Return on stakes", staked ? edgeTxt(pl / staked) : "—", U.signCls(pl)], ["Win rate", graded.length ? pct(wins / graded.length, 0) + " of " + graded.length : "—", ""], ["Open bets", String(open.length) + " · " + U.money(open.reduce((a, b) => a + b.stake, 0), "USD") + " at risk", ""], ["Average odds", all.length ? odds(app, all.reduce((a, b) => a + b.dec, 0) / all.length) : "—", ""], ["Closing-line value", clvs.length ? edgeTxt(clvs.reduce((a, b) => a + b, 0) / clvs.length) + " avg (" + clvs.length + ")" : "add closing odds", clvs.length ? U.signCls(clvs.reduce((a, b) => a + b, 0)) : ""], ["Luck vs expectation", done.some(b => b.fairP != null) ? (pl - expected >= 0 ? "+" : "") + U.money(pl - expected, "USD") : "—", ""]].map(([k, v, cls]) => h("div", { class: "tile" }, h("span", { class: "label" }, k), h("span", { class: "v " + cls }, v)))),
      done.length >= 2 ? curve(done, P.bankroll) : null,
      U.section("Bets", h("div", { class: "stack" }, suggestBox,
        h("div", { class: "row between" }, U.seg(["All", "Open", "Settled"], filter[0].toUpperCase() + filter.slice(1), (v) => { app.ls.set("bet.filter", v.toLowerCase()); body.replaceChildren(); betsView(body, app); }), h("div", { class: "row" }, checkBtn, h("button", { class: "btn ghost sm", type: "button", onclick: () => manualBet(app) }, "Add a bet manually"), all.length ? h("button", { class: "btn ghost sm", type: "button", onclick: () => U.download("bets-" + new Date().toISOString().slice(0, 10) + ".csv", C.toCSV([["placed", "sport", "game", "pick", "type", "book", "decimal_odds", "american_odds", "stake", "status", "profit", "closing_decimal", "clv_pct", "fair_probability"], ...all.map(b => [new Date(b.placedAt || b.createdAt).toISOString(), b.sport, b.game, b.pick, b.type, b.book, b.dec.toFixed(4), O.fmtAm(b.dec), b.stake, b.status, settled(b) ? profit(b).toFixed(2) : "", b.closingDec || "", b.closingDec ? (O.clv(b.dec, b.closingDec) * 100).toFixed(2) : "", b.fairP != null ? b.fairP.toFixed(4) : ""])])) }, "Export CSV") : null)),
        U.dataTable([
          { t: "Placed", v: (b) => U.fmtDate(b.placedAt || b.createdAt), sort: (b) => b.placedAt || b.createdAt },
          { t: "Bet", v: (b) => h("span", {}, h("b", {}, b.pick), h("br"), h("span", { class: "tiny muted" }, b.game + (b.type === "parlay" ? " · " + b.legs.map(l => l.pick).join(", ") : ""))), sort: (b) => b.pick },
          { t: "Book", v: "book", sort: (b) => b.book },
          { t: "Odds", v: (b) => h("span", { class: "num" }, odds(app, b.dec)), sort: (b) => b.dec, n: true },
          { t: "Stake", v: (b) => U.money(b.stake, "USD"), sort: (b) => b.stake, n: true },
          { t: "Result", v: (b) => settled(b) ? h("span", { class: "gstat " + b.status }, b.status === "cashout" ? "Cashed out" : b.status[0].toUpperCase() + b.status.slice(1)) : settleBtns(app, b), sort: (b) => b.status },
          { t: "P/L", v: (b) => settled(b) ? h("span", { class: "num " + U.signCls(profit(b)) }, (profit(b) >= 0 ? "+" : "") + U.money(profit(b), "USD")) : h("span", { class: "tiny muted" }, "to win " + U.money(b.stake * (b.dec - 1), "USD")), sort: (b) => settled(b) ? profit(b) : null, n: true },
          { t: "CLV", v: (b) => b.closingDec ? h("span", { class: "num " + U.signCls(O.clv(b.dec, b.closingDec)) }, edgeTxt(O.clv(b.dec, b.closingDec))) : h("button", { class: "linkbtn tiny", type: "button", onclick: () => closingPrompt(app, b) }, "add closing"), sort: (b) => b.closingDec ? O.clv(b.dec, b.closingDec) : null, n: true },
          { t: "", v: (b) => h("button", { class: "linkbtn tiny", type: "button", onclick: async () => { if (await U.confirmBox("Delete this bet?", b.pick + " · " + U.money(b.stake, "USD"), "Delete", true)) { await app.store.remove("bets", b.id); app.rerender(); } } }, "Delete") }
        ], filter === "open" ? open : filter === "settled" ? done : all, { key: "bets", sort: [0, -1], noun: "bets", empty: "No bets logged yet. Add prices to the bet slip, place the bet in your sportsbook, then log it.", text: (b) => b.pick + " " + b.game + " " + b.book })),
        [h("span", { class: "tiny muted" }, "Saved to your account; only you can see it.")]),
      breakdown(done),
      U.section("Bankroll & staking", h("div", { class: "stack" }, h("div", { class: "form" }, U.field("Starting bankroll (USD)", bInput), U.field("Unit size (USD)", uInput, "Your standard stake; the slip starts here."), U.field("Kelly fraction", kSel, "Full Kelly maximizes growth only if your probabilities are exact; fractions cut the swings."), U.field("Daily loss limit (USD, 0 = off)", lInput, "Logging a bet after today's settled losses reach this asks you to confirm."), U.field("Stake cap (% of bankroll, 0 = off)", cInput, "Warns when one stake is bigger than this.")),
        h("p", { class: "tiny muted" }, "Closing-line value (CLV) compares your price with the last price before the game: beating the close regularly is the best evidence of skill, long before win rate means anything. “Luck vs expectation” compares your result with what the fair chances predicted."))));
  }
  function settleBtns(app, b) {
    const set = async (status, extra) => { await app.store.put("bets", b.id, Object.assign({}, b, { status, settledAt: Date.now() }, extra || {})); app.rerender(); };
    return h("span", { class: "row settle", style: "gap:4px" }, h("button", { class: "btn ghost sm", type: "button", onclick: () => set("won") }, "Won"), h("button", { class: "btn ghost sm", type: "button", onclick: () => set("lost") }, "Lost"), h("button", { class: "btn ghost sm", type: "button", onclick: () => set("push") }, "Push"),
      h("details", { class: "more" }, h("summary", { class: "tiny" }, "more"), h("div", { class: "stack", style: "gap:4px" }, h("button", { class: "btn ghost sm", type: "button", onclick: () => set("void") }, "Void"), h("button", { class: "btn ghost sm", type: "button", onclick: () => { const inp = h("input", { type: "number", min: "0", step: "0.01", "aria-label": "Cash-out amount" }); const m = U.modal("Cash out", h("div", { class: "stack" }, U.field("Amount received (USD)", inp), h("button", { class: "btn", type: "button", onclick: () => { const v = Number(inp.value); if (inp.value !== "" && v >= 0) { m.close(); set("cashout", { cashout: v }); } } }, "Save"))); } }, "Cashed out…"))));
  }
  function closingPrompt(app, b) {
    const inp = h("input", { type: "text", placeholder: "e.g. -125, 1.80 or 4/5", "aria-label": "Closing odds" });
    const msg = h("p", { class: "tiny muted" }, "The last price before the game started, from the same book if you can.");
    const m = U.modal("Closing odds for " + b.pick, h("div", { class: "stack" }, U.field("Closing odds", inp), msg, h("button", { class: "btn", type: "button", onclick: async () => { const d = O.parseOdds(inp.value); if (!d) { msg.textContent = "Couldn't read those odds. Try -125, 1.80 or 4/5."; return; } await app.store.put("bets", b.id, Object.assign({}, b, { closingDec: d })); m.close(); app.rerender(); } }, "Save")));
  }
  function manualBet(app) {
    const f = { pick: h("input", { type: "text", placeholder: "e.g. Chiefs -3", "aria-label": "Pick" }), game: h("input", { type: "text", placeholder: "e.g. Chiefs at Bills", "aria-label": "Game" }), book: h("input", { type: "text", placeholder: "e.g. DraftKings", "aria-label": "Book" }), odds: h("input", { type: "text", placeholder: "-110", "aria-label": "Odds" }), stake: h("input", { type: "number", min: "0", step: "1", value: String(prefs(app).unit), "aria-label": "Stake" }), sport: sportSelect(app, app.ls.get("bet.sport", "nfl"), () => {}) };
    const msg = h("p", { class: "tiny warn-t" });
    const m = U.modal("Add a bet", h("div", { class: "stack" }, h("div", { class: "form" }, U.field("Pick", f.pick), U.field("Game", f.game), U.field("Sport", f.sport), U.field("Book", f.book), U.field("Odds (any format)", f.odds), U.field("Stake (USD)", f.stake)), msg,
      h("button", { class: "btn", type: "button", onclick: async () => {
        const d = O.parseOdds(f.odds.value), st = Number(f.stake.value);
        if (!f.pick.value.trim() || !d || !(st > 0)) { msg.textContent = "Fill in the pick, odds and a stake."; return; }
        if (app.demo) { msg.textContent = "Bets aren't saved in demo mode."; return; }
        await app.store.put("bets", MD.store.newId(), { createdAt: Date.now(), placedAt: Date.now(), type: "single", legs: [], pick: f.pick.value.trim(), game: f.game.value.trim(), sport: f.sport.value, book: f.book.value.trim() || "—", dec: d, stake: st, currency: "USD", status: "open", fairP: null });
        m.close(); app.rerender();
      } }, "Add bet")));
  }
  function curve(done, start) {
    const pts = done.slice().sort((a, b) => (a.settledAt || a.placedAt) - (b.settledAt || b.placedAt));
    let v = start; const vals = [start, ...pts.map(b => (v += profit(b)))];
    const W = 640, H = 140, lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
    const x = (i) => (i / (vals.length - 1) * (W - 20) + 10).toFixed(1), y = (val) => (H - 12 - (val - lo) / span * (H - 24)).toFixed(1);
    const path = vals.map((val, i) => (i ? "L" : "M") + x(i) + " " + y(val)).join(" ");
    const box = h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", { class: "sec" }, "Bankroll over settled bets")), h("div", { class: "bd" }, h("div", { class: "bkcurve", html: `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Bankroll after each settled bet, from ${start.toFixed(0)} to ${vals[vals.length - 1].toFixed(0)}"><line class="bk-base" x1="10" x2="${W - 10}" y1="${y(start)}" y2="${y(start)}"/><path class="bk-line ${vals[vals.length - 1] >= start ? "up" : "down"}" d="${path}"/></svg>` })));
    return box;
  }
  function breakdown(done) {
    if (!done.length) return null;
    const by = (key) => { const m = new Map(); for (const b of done) { const k = key(b); const e = m.get(k) || { k, n: 0, staked: 0, pl: 0 }; e.n++; e.staked += b.status === "void" ? 0 : b.stake; e.pl += profit(b); m.set(k, e); } return [...m.values()].sort((a, b) => b.n - a.n); };
    const tbl = (rows, label) => U.table([{ t: label, v: "k" }, { t: "Bets", v: (r) => String(r.n), n: true }, { t: "Staked", v: (r) => U.money(r.staked, "USD"), n: true }, { t: "P/L", v: (r) => h("span", { class: "num " + U.signCls(r.pl) }, (r.pl >= 0 ? "+" : "") + U.money(r.pl, "USD")), n: true }, { t: "ROI", v: (r) => r.staked ? edgeTxt(r.pl / r.staked) : "—", n: true }], rows);
    return U.section("Where the results come from", h("div", { class: "grid g3" }, tbl(by(b => (B.SPORTS.find(s => s.id === b.sport) || { name: b.sport || "Other" }).name), "Sport"), tbl(by(b => b.type === "parlay" ? "Parlay" : ({ ml: "Moneyline / result", spread: "Spread / handicap", total: "Total" }[b.market] || "Other")), "Bet type"), tbl(by(b => b.book || "—"), "Book")));
  }

  /* ================= calculators ================= */
  function calcView(body, app) {
    const card = (t, ...kids) => h("section", { class: "card calc" }, h("div", { class: "hd" }, h("h2", { class: "sec" }, t)), h("div", { class: "bd stack" }, ...kids));
    const oddsIn = (v, label) => h("input", { type: "text", value: v, "aria-label": label || "Odds", placeholder: "-110, 2.10 or 5/4" });
    const numIn = (v, label) => h("input", { type: "number", value: String(v), step: "any", "aria-label": label });
    const res = () => h("div", { class: "calc-out" });
    const bad = (el) => el.replaceChildren(h("span", { class: "tiny warn-t" }, "Enter odds like -110, +150, 2.50 or 5/4."));
    // 1. converter
    const c1 = oddsIn("-110"), o1 = res();
    const p1 = () => { const d = O.parseOdds(c1.value); if (!d) return bad(o1); o1.replaceChildren(U.kv([["American", O.fmtAm(d)], ["Decimal", O.fmtDec(d)], ["Fractional", O.fmtFrac(d)], ["Implied chance", pct(1 / d, 2)], ["Break-even win rate", pct(1 / d, 2)]])); };
    c1.oninput = p1;
    // 2. payout
    const c2o = oddsIn("+150"), c2s = numIn(prefs(app).unit, "Stake"), o2 = res();
    const p2 = () => { const d = O.parseOdds(c2o.value), s = Number(c2s.value) || 0; if (!d) return bad(o2); o2.replaceChildren(U.kv([["Profit if it wins", U.money(s * (d - 1), "USD")], ["Total return", U.money(s * d, "USD")], ["Loss if it loses", U.money(-s, "USD")]])); };
    c2o.oninput = p2; c2s.oninput = p2;
    // 3. no-vig / hold
    const c3 = [oddsIn("-150", "Outcome 1 odds"), oddsIn("+130", "Outcome 2 odds"), oddsIn("", "Outcome 3 odds (optional, e.g. a draw)")], o3 = res();
    const p3 = () => { const ds = c3.map(i => i.value.trim() ? O.parseOdds(i.value) : null).filter((d, i) => i < 2 || d); if (ds.length < 2 || ds.some(d => !d)) return bad(o3); const f = O.noVig(ds), fp = O.noVig(ds, "power"); o3.replaceChildren(U.table([{ t: "Outcome", v: (r) => "#" + (r.i + 1) }, { t: "Price", v: (r) => O.fmtAm(ds[r.i]), n: true }, { t: "Implied", v: (r) => pct(1 / ds[r.i]), n: true }, { t: "Fair chance", v: (r) => pct(f[r.i]), n: true }, { t: "Fair odds", v: (r) => odds(app, 1 / f[r.i]), n: true }, { t: "Power method", v: (r) => pct(fp[r.i]), n: true }], ds.map((_, i) => ({ i }))), h("p", { class: "small" }, "Bookmaker margin (hold): ", h("b", {}, pct(O.hold(ds), 2)), " · overround " + pct(O.overround(ds), 2))); };
    c3.forEach(i => i.oninput = p3);
    // 4. EV & Kelly
    const c4p = numIn(55, "Your win probability (%)"), c4o = oddsIn("+100"), c4b = numIn(prefs(app).bankroll, "Bankroll"), o4 = res();
    const p4 = () => { const p = (Number(c4p.value) || 0) / 100, d = O.parseOdds(c4o.value), bk = Number(c4b.value) || 0; if (!d) return bad(o4); const e = O.edge(p, d), k = O.kelly(p, d); o4.replaceChildren(U.kv([["Expected profit per $100", U.money(100 * e, "USD"), U.signCls(e)], ["Edge", edgeTxt(e), U.signCls(e)], ["Break-even chance", pct(1 / d, 1)], ["Full Kelly stake", k > 0 ? U.money(k * bk, "USD") + " (" + pct(k) + ")" : "Don't bet: no edge"], ["Quarter Kelly", k > 0 ? U.money(k * bk / 4, "USD") : "—"]])); };
    [c4p, c4o, c4b].forEach(i => i.oninput = p4);
    // 5. parlay
    const c5 = [oddsIn("-110", "Leg 1"), oddsIn("-110", "Leg 2"), oddsIn("+120", "Leg 3"), oddsIn("", "Leg 4"), oddsIn("", "Leg 5"), oddsIn("", "Leg 6")], c5s = numIn(prefs(app).unit, "Parlay stake"), o5 = res();
    const p5 = () => { const ds = c5.map(i => i.value.trim() ? O.parseOdds(i.value) : null).filter(Boolean); if (ds.length < 2) return o5.replaceChildren(h("span", { class: "tiny muted" }, "Enter at least two legs.")); const pr = O.parlay(ds.map(d => ({ dec: d }))); const s = Number(c5s.value) || 0; const fairEach = ds.map(d => 1 / d / 1.0476); o5.replaceChildren(U.kv([["Parlay odds", O.fmtAm(pr.dec) + " · " + pr.dec.toFixed(2) + "×"], ["Pays", U.money(s * (pr.dec - 1), "USD") + " profit"], ["Implied chance", pct(pr.impliedP, 2)], ["If each leg carries a 4.5% margin", "true chance ≈ " + pct(fairEach.reduce((a, b) => a * b, 1), 2) + ", so the parlay gives up ≈ " + pct(1 - fairEach.reduce((a, b) => a * b, 1) * pr.dec, 1) + " of the stake"]])); };
    c5.concat(c5s).forEach(i => i.oninput = p5);
    // 6. arbitrage
    const c6 = [oddsIn("+105", "Outcome 1 best odds"), oddsIn("+102", "Outcome 2 best odds"), oddsIn("", "Outcome 3 best odds (optional)")], c6t = numIn(100, "Total stake"), o6 = res();
    const p6 = () => { const ds = c6.map(i => i.value.trim() ? O.parseOdds(i.value) : null).filter((d, i) => i < 2 || d); if (ds.length < 2 || ds.some(d => !d)) return bad(o6); const a = O.arbitrage(ds, Number(c6t.value) || 100); o6.replaceChildren(h("p", { class: "small " + (a.arb ? "up" : "") }, a.arb ? "Arbitrage: " + a.profitPct.toFixed(2) + "% profit whatever happens." : "No arbitrage: the prices add to " + pct(a.sum, 1) + " (needs under 100%)."), U.table([{ t: "Outcome", v: (r) => "#" + (r.i + 1) }, { t: "Stake", v: (r) => U.money(a.stakes[r.i], "USD"), n: true }, { t: "Returns", v: (r) => U.money(a.returns[r.i], "USD"), n: true }], ds.map((_, i) => ({ i })))); };
    c6.concat(c6t).forEach(i => i.oninput = p6);
    // 7. hedge
    const c7o = oddsIn("+400", "Original bet odds"), c7s = numIn(50, "Original stake"), c7h = oddsIn("-150", "Hedge odds now"), o7 = res();
    const p7 = () => { const d1 = O.parseOdds(c7o.value), d2 = O.parseOdds(c7h.value), s = Number(c7s.value) || 0; if (!d1 || !d2) return bad(o7); const hs = s * d1 / d2, win1 = s * (d1 - 1) - hs, win2 = hs * (d2 - 1) - s; o7.replaceChildren(U.kv([["Hedge stake for the same result either way", U.money(hs, "USD")], ["If the original bet wins", U.money(win1, "USD"), U.signCls(win1)], ["If the hedge wins", U.money(win2, "USD"), U.signCls(win2)]]), h("p", { class: "tiny muted" }, "Hedging locks in a result but pays the margin twice; it only makes sense when the swing matters more to you than the expected value.")); };
    [c7o, c7s, c7h].forEach(i => i.oninput = p7);
    // 8. hold-adjusted break-even & record
    const c8w = numIn(53, "Wins"), c8l = numIn(47, "Losses"), c8o = oddsIn("-110", "Typical odds"), o8 = res();
    const p8 = () => { const w = Number(c8w.value) || 0, l = Number(c8l.value) || 0, d = O.parseOdds(c8o.value); if (!d || w + l === 0) return bad(o8); const n = w + l, wr = w / n, be = 1 / d, se = Math.sqrt(be * (1 - be) / n), z = (wr - be) / se; o8.replaceChildren(U.kv([["Win rate", pct(wr, 1) + " (" + n + " bets)"], ["Break-even at these odds", pct(be, 1)], ["Units won", ((w * (d - 1) - l)).toFixed(2)], ["How unusual by luck alone", "z = " + z.toFixed(2) + " · " + (Math.abs(z) < 2 ? "within normal luck" : z > 0 ? "unlikely to be luck alone" : "worse than luck alone")]])); };
    [c8w, c8l, c8o].forEach(i => i.oninput = p8);
    body.append(h("div", { class: "grid g2 calcs" },
      card("Odds converter", U.field("Odds", c1), o1),
      card("Payout", h("div", { class: "form" }, U.field("Odds", c2o), U.field("Stake (USD)", c2s)), o2),
      card("Fair odds & bookmaker margin", h("div", { class: "form" }, ...c3.map((i, k) => U.field("Outcome " + (k + 1), i))), o3),
      card("Expected value & Kelly stake", h("div", { class: "form" }, U.field("Your chance (%)", c4p), U.field("Odds", c4o), U.field("Bankroll (USD)", c4b)), o4),
      card("Parlay", h("div", { class: "form" }, ...c5.map((i, k) => U.field("Leg " + (k + 1), i)), U.field("Stake (USD)", c5s)), o5),
      card("Arbitrage stakes", h("div", { class: "form" }, ...c6.map((i, k) => U.field("Outcome " + (k + 1), i)), U.field("Total stake (USD)", c6t)), o6),
      card("Hedge", h("div", { class: "form" }, U.field("Original odds", c7o), U.field("Original stake", c7s), U.field("Hedge odds now", c7h)), o7),
      card("Is my record skill or luck?", h("div", { class: "form" }, U.field("Wins", c8w), U.field("Losses", c8l), U.field("Typical odds", c8o)), o8)));
    [p1, p2, p3, p4, p5, p6, p7, p8].forEach(f => f());
  }

  function sportSelect(app, cur, onPick) {
    const sel = h("select", { "aria-label": "Sport or league", class: "sportsel" });
    const groups = [...new Set(B.SPORTS.map(s => s.group))];
    for (const g of groups) sel.append(h("optgroup", { label: g }, B.SPORTS.filter(s => s.group === g).map(s => h("option", { value: s.id, selected: s.id === cur }, sportLabel(s)))));
    sel.onchange = () => onPick(sel.value);
    return sel;
  }
  // Suggested results for open bets from ESPN final scores (only bets added from the odds pages carry
  // the teams, market and line needed). A parlay with any losing leg is lost even if others are pending.
  async function suggestSettlements(app) {
    const open = app.store.cached("bets").filter(b => !settled(b) && Array.isArray(b.legs) && b.legs.length && b.legs.every(l => l.home && l.away && l.market && l.side && l.sport));
    const boards = new Map(), out = [];
    for (const b of open) {
      const res = [];
      for (const l of b.legs) {
        const date = l.startDate || (l.start ? B.etYmd(l.start) : null), key = l.sport + "|" + (date || "");
        if (!boards.has(key)) boards.set(key, B.scoreboard(l.sport, date).then(r => r.games).catch(() => []));
        const e = B.findEspn({ home: { name: l.home }, away: { name: l.away } }, await boards.get(key));
        res.push(e ? B.gradeLeg(l, e) : null);
      }
      const text = res.map((x, i) => x ? b.legs[i].pick + ": " + x.result + " (" + b.legs[i].away + " " + x.score.away + "–" + x.score.home + " " + b.legs[i].home + ")" : b.legs[i].pick + ": pending").join("; ");
      if (res.some(x => x && x.mult === 0)) { out.push({ bet: b, status: "lost", cashout: null, text }); continue; }
      if (res.some(x => !x)) continue;
      const mult = res.reduce((a, x) => a * x.mult, 1);
      const status = Math.abs(mult - b.dec) < 1e-6 ? "won" : Math.abs(mult - 1) < 1e-9 ? "push" : "cashout";
      out.push({ bet: b, status, cashout: status === "cashout" ? +(b.stake * mult).toFixed(2) : null, text });
    }
    return out;
  }
  // Dashboard card: open bets, today's result, and today's AI picks.
  function dashboardCard(box, app) {
    const bets = app.store.cached("bets"), open = bets.filter(b => !settled(b)), t = B.etYmd();
    const todayPL = bets.filter(b => settled(b) && b.settledAt && B.etYmd(b.settledAt) === t).reduce((a, b) => a + profit(b), 0);
    const picks = app.store.cached("betpicks").filter(p => p.startDate === t || (p.start && B.etYmd(p.start) === t)).sort((a, b) => (b.confidence || 0) - (a.confidence || 0)).slice(0, 4);
    const rec = MD.betAI.record(app);
    box.append(h("div", { class: "grid g3" }, [["Open bets", open.length + " · " + U.money(open.reduce((a, b) => a + b.stake, 0), "USD") + " at risk"], ["Today", (todayPL >= 0 ? "+" : "") + U.money(todayPL, "USD")], ["AI record", rec.graded ? pct(rec.hitRate, 0) + " of " + rec.graded : "no graded picks"]].map(([k, v]) => h("div", { class: "tile" }, h("span", { class: "label" }, k), h("span", { class: "v small" }, v)))),
      picks.length ? h("div", { class: "stack", style: "gap:4px;margin-top:8px" }, h("span", { class: "label" }, "Today's AI picks"), picks.map(p => h("div", { class: "row between small" }, h("span", {}, h("b", {}, p.pickName), " · " + p.game), h("span", { class: "num" }, pct(p.p, 0) + " · conf " + (p.confidence ?? "—"))))) : h("p", { class: "tiny muted", style: "margin-top:8px" }, "No AI picks for today yet. Run a slate forecast on the Sports Betting tab."),
      h("div", { class: "row", style: "margin-top:8px" }, h("button", { class: "btn ghost sm", type: "button", onclick: () => app.go("betting", null, { fromNav: true }) }, "Open Sports Betting")));
  }
  MD.betting = { legOf, addLeg, slip, setSlip, profit, settled, roundRobin, dashboardCard, suggestSettlements };
})(typeof window !== "undefined" ? window : globalThis);
