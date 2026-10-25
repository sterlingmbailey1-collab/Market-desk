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
    return { id: g.id + "|" + k + "|" + side + "|" + book, gameId: g.id, sport: g.sport, game: title(g), start: g.start || null, market: k, marketLabel: mk.label, side, pick, book, dec: q.dec, line: q.line, p: q.p ?? null, push: q.push || 0, modelP: q.modelP ?? null, addedAt: Date.now() };
  }
  function addLeg(app, leg) {
    const legs = slip(app).filter(l => l.id !== leg.id && !(l.gameId === leg.gameId && l.market === leg.market && l.side === leg.side));
    legs.push(leg); setSlip(app, legs);
    U.toast("Added to bet slip", leg.pick + " · " + leg.book + " " + odds(app, leg.dec) + " · " + legs.length + " on the slip");
  }

  /* ---------- tracked bets (account storage) ---------- */
  const profit = (b) => b.status === "won" ? b.stake * (b.dec - 1) : b.status === "lost" ? -b.stake : b.status === "cashout" ? (Number(b.cashout) || 0) - b.stake : 0;
  const settled = (b) => ["won", "lost", "push", "void", "cashout"].includes(b.status);

  V.betting = function (root, app) {
    const ctx = app.ctx.betting;
    if (ctx && ctx.gameId) return gameView(root, app, ctx);
    return listView(root, app);
  };

  /* ================= list ================= */
  function sportSelect(app, cur, onPick) {
    const sel = h("select", { "aria-label": "Sport or league", class: "sportsel" });
    const groups = [...new Set(B.SPORTS.map(s => s.group))];
    for (const g of groups) sel.append(h("optgroup", { label: g }, B.SPORTS.filter(s => s.group === g).map(s => h("option", { value: s.id, selected: s.id === cur }, sportLabel(s)))));
    sel.onchange = () => onPick(sel.value);
    return sel;
  }
  function rgNote() {
    return h("div", { class: "banner info rg" }, h("p", { class: "small" }, h("strong", {}, "Bet responsibly. "), "Only stake what you can afford to lose, and check that sports betting is legal where you are and that you meet the age limit (21+ in most US states, 18+ in the UK and EU). Help is free and confidential: call or text ", h("b", { class: "mono" }, "1-800-GAMBLER"), " (US), or visit ", h("a", { href: "https://www.begambleaware.org/", target: "_blank", rel: "noopener noreferrer" }, "BeGambleAware"), " (UK). Market Desk reads published odds and never places bets."));
  }
  function listView(root, app) {
    let sport = app.ls.get("bet.sport", "nfl"); if (!B.SPORTS.some(s => s.id === sport)) sport = "nfl";
    let tab = app.ls.get("bet.tab", "games");
    const P = prefs(app);
    const tabsBox = h("div", {}), body = h("div", { class: "stack" });
    const fmtSeg = () => U.seg(["American", "Decimal", "Fractional"], P.oddsFormat[0].toUpperCase() + P.oddsFormat.slice(1), (v) => { setPrefs(app, { oddsFormat: v.toLowerCase() }); app.rerender(); });
    const refresh = h("button", { class: "btn ghost sm", type: "button", onclick: () => { B.cacheClear(); paint(); } }, "Refresh odds");
    root.append(head("Sports Betting", "Every book's price for each bet, the chance it wins once the bookmaker's margin is taken out, and tools to size, compare and track bets."),
      rgNote(),
      h("div", { class: "row betbar" }, U.field("Sport or league", sportSelect(app, sport, (v) => { sport = v; app.ls.set("bet.sport", v); paint(); })), h("div", { class: "field" }, h("span", { class: "label" }, "Odds format"), fmtSeg()), h("div", { class: "field" }, h("span", { class: "label" }, " "), refresh)),
      tabsBox, body);
    const paintTabs = () => tabsBox.replaceChildren(U.tabs([["games", "Games & odds"], ["value", "Value & arbitrage"], ["slip", "Bet slip (" + slip(app).length + ")"], ["bets", "My bets"], ["calc", "Calculators"]], tab, (k) => { tab = k; app.ls.set("bet.tab", k); paint(); }));
    const off = app.on("betslip", paintTabs);
    function paint() {
      paintTabs();
      body._loadId = (body._loadId || 0) + 1; // drop any odds load still in flight for the previous tab
      body.replaceChildren();
      if (tab === "slip") return slipView(body, app);
      if (tab === "bets") return betsView(body, app);
      if (tab === "calc") return calcView(body, app);
      U.async(body, () => B.load(sport), (r) => tab === "value" ? valueView(body, app, r) : gamesView(body, app, r), { loading: "Reading odds for " + sportLabel(B.sportOf(sport)) + " from " + (B.sportOf(sport).soccer ? "SportsLine, Kalshi and the Statz model" : "VegasInsider") + "…" });
    }
    paint();
    return () => off();
  }
  function sourcesLine(r) {
    return h("div", { class: "srcline tiny muted" }, "Sources: ", ...r.sources.flatMap((s, i) => [i ? " · " : "", h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer" }, s.name), s.updated ? " (page updated " + U.fmtDate(s.updated) + ")" : ""]), " · read " + ago(r.loadedAt) + ". Odds move quickly and the copy read can lag: confirm the price in the sportsbook before betting.");
  }
  function gamesView(body, app, r) {
    const sp = r.sport, P = prefs(app);
    let show = app.ls.get("bet.show", "upcoming");
    const upcoming = r.games.filter(g => g.status !== "final" && g.status !== "past");
    const list = show === "all" ? r.games : upcoming;
    const grid = h("div", { class: "gcards" }, list.map(g => gameCard(app, g, sp)));
    body.append(
      h("div", { class: "row between" }, h("div", { class: "row" }, h("strong", {}, sportLabel(sp)), h("span", { class: "tiny muted" }, upcoming.length + " upcoming · " + r.games.length + " listed · " + (r.books.length ? r.books.length + " books: " + r.books.join(", ") : "no books"))),
        U.seg(["Upcoming", "All incl. finished"], show === "all" ? "All incl. finished" : "Upcoming", (v) => { app.ls.set("bet.show", v === "Upcoming" ? "upcoming" : "all"); body.replaceChildren(); gamesView(body, app, r); })),
      r.errors && r.errors.length ? h("div", { class: "banner warn" }, h("p", { class: "small" }, "Some sources didn't answer: " + r.errors.join(" · ") + ". What loaded is shown.")) : null,
      list.length ? grid : h("div", { class: "empty" }, r.games.length ? "No upcoming games listed. Switch to “All incl. finished” to see the rest." : "No games are listed for " + sp.name + " right now. The league may be between games or out of season."),
      sourcesLine(r),
      h("p", { class: "tiny muted" }, "“Fair” is the chance each side wins with the bookmaker's margin removed: the median, across books, of each book's prices scaled so they add to 100%." + (sp.soccer ? " For soccer results, the fair split comes from Kalshi's exchange prices (they include the draw), or the Statz model when Kalshi has no market." : "") + " Edge is how much a price pays above that fair chance. * Kalshi exchange price, before its trading fee. Click a game for every book, line and calculator."));
  }
  function bestCell(app, g, k, side) {
    const mk = g.markets[k]; if (!mk || !mk.best || !mk.best[side]) return h("span", { class: "faint" }, "—");
    const b = mk.best[side], q = mk.books[b.book][side];
    return h("span", { class: "bc", title: b.exchange ? "Kalshi exchange price before its trading fee" : "" }, h("b", { class: "num" }, (k === "ml" ? "" : lineTxt(k, side, b.line) + " ") + odds(app, b.dec)), h("span", { class: "tiny muted" }, " " + b.book + (b.exchange ? "*" : "")), q.edge != null && q.edge > 0.005 ? h("span", { class: "evtag" }, edgeTxt(q.edge)) : null);
  }
  function probBar(p, cls) { return h("span", { class: "pbar " + (cls || "") }, h("i", { style: "width:" + Math.max(0, Math.min(100, (p || 0) * 100)).toFixed(1) + "%" })); }
  function gameCard(app, g, sp) {
    const ml = g.markets.ml;
    const sides = g.soccer ? ["home", "draw", "away"] : ["away", "home"];
    const pOf = (s) => ml && ml.fair ? ml.fair[s] : g.model ? g.model[s] : null;
    const badges = [];
    const evs = Object.entries(g.markets).flatMap(([k, mk]) => Object.entries(mk.books).flatMap(([b, q]) => mk.sides.filter(s => q[s] && q[s].edge > 0.01).map(s => ({ k, b, s, e: q[s].edge }))));
    if (evs.length) { const top = evs.sort((a, b) => b.e - a.e)[0]; badges.push(h("span", { class: "chip ev" }, "Best edge " + edgeTxt(top.e) + " · " + top.b)); }
    const arb = Object.values(g.markets).find(m => m.arb && m.arb.arb);
    if (arb) badges.push(h("span", { class: "chip arb" }, "Arbitrage " + arb.arb.profitPct.toFixed(2) + "%"));
    if (g.model) badges.push(h("span", { class: "chip" }, "Statz model"));
    if (g.kalshi) badges.push(h("span", { class: "chip" }, "Kalshi"));
    const open = () => app.openGame(g);
    return h("button", { class: "gcard", type: "button", onclick: open },
      h("div", { class: "row between gc-top" }, h("span", { class: "tiny" }, whenTxt(g)), h("span", { class: "gstat " + g.status.replace(/\s/g, "") }, STATUS[g.status] || g.status)),
      h("div", { class: "gc-teams" }, sides.map(s => h("div", { class: "gc-row" },
        h("span", { class: "gc-name" }, s === "draw" ? "Draw" : sideName(g, s), s === "home" && !g.soccer ? h("span", { class: "tiny faint" }, " home") : null),
        h("span", { class: "gc-p" }, probBar(pOf(s)), h("span", { class: "num small" }, pct(pOf(s), 0))),
        h("span", { class: "gc-odds" }, ml ? bestCell(app, g, "ml", s) : h("span", { class: "faint tiny" }, "no price"))))),
      h("div", { class: "gc-lines tiny" },
        g.markets.spread && g.markets.spread.mainLine != null ? h("span", {}, (g.soccer ? "Handicap " : "Spread ") + g.away.name.split(" ").slice(-1)[0] + " " + lineTxt("spread", "away", g.markets.spread.mainLine)) : null,
        g.markets.total && g.markets.total.mainLine != null ? h("span", {}, "Total " + g.markets.total.mainLine + (g.markets.total.fair ? " · over " + pct(g.markets.total.fair.over, 0) : "")) : null,
        Object.values(g.markets).length ? h("span", {}, Math.max(...Object.values(g.markets).map(m => m.bookCount || 0)) + " books") : h("span", {}, "Model only: no odds listed yet")),
      badges.length ? h("div", { class: "row gc-badges" }, badges) : null);
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
      const g = r.games.find(x => x.id === ctx.gameId) || r.games.find(x => title(x) === ctx.label);
      if (!g) { box.append(h("div", { class: "empty" }, "This game is no longer on the odds pages read. It may have started or been taken down."), h("button", { class: "btn ghost", type: "button", onclick: () => app.back() }, "Back to the list")); return; }
      renderGame(box, app, g, r);
    }, { loading: "Loading the game's odds…" });
  }
  function renderGame(box, app, g, r) {
    const sp = r.sport;
    const aiBox = h("div", {});
    const chances = h("div", {});
    box.append(
      h("div", { class: "hero bethero" }, h("div", { class: "stack", style: "gap:4px" },
        h("span", { class: "label" }, sportLabel(sp) + " · " + (STATUS[g.status] || g.status)),
        h("h1", { class: "page" }, title(g)),
        h("span", { class: "small muted" }, whenTxt(g) + (g.startHasTime ? " (your time)" : "") + (g.away.rot ? " · rotation " + g.away.rot + " / " + g.home.rot : ""))),
        h("div", { class: "row" }, g.model && g.model.url ? h("a", { class: "btn ghost sm", href: g.model.url, target: "_blank", rel: "noopener noreferrer" }, "Statz preview ↗") : null, g.kalshi ? h("a", { class: "btn ghost sm", href: g.kalshi.url, target: "_blank", rel: "noopener noreferrer" }, "Kalshi ↗") : null)),
      h("div", { class: "jump" }, [["sec-chance", "Win chances"], ...Object.keys(g.markets).map(k => ["sec-" + k, g.markets[k].label]), g.modelGoals ? ["sec-model", "Model markets"] : null, Object.keys(g.markets).length ? ["sec-move", "Line movement"] : null, Object.keys(g.markets).length ? ["sec-pay", "Payout"] : null, g.model && g.model.fixtureId ? ["sec-leaders", "Team leaders"] : null, ["sec-ai", "AI analysis"]].filter(Boolean).map(([id, t]) => h("a", { href: "#" + id, onclick: (e) => { e.preventDefault(); const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); } }, t))),
      g.status === "final" || g.status === "past" ? h("div", { class: "banner warn" }, h("p", {}, "This game has started or finished. The prices below are the last ones the page showed, not live in-game odds.")) : null,
      chances);
    const paintChances = () => chances.replaceChildren(chancePanel(app, g, sp));
    paintChances();
    for (const k of ["ml", "spread", "total"]) if (g.markets[k]) box.append(oddsSection(app, g, k, sp));
    if (!Object.keys(g.markets).length) box.append(h("div", { class: "banner info" }, h("p", {}, "No sportsbook prices are listed for this game yet; books usually post soccer lines about a week ahead. The model's probabilities and fair odds are below.")));
    if (g.modelGoals) box.append(modelSection(app, g));
    if (Object.keys(g.markets).length) box.append(movementSection(app, g), payoutSection(app, g));
    if (g.model && g.model.fixtureId) box.append(leadersSection(app, g));
    aiBox.id = "sec-ai";
    box.append(aiBox, sourcesLine(r));
    aiSection(aiBox, app, g, sp, () => paintChances());
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

  /* ---------- AI analysis ---------- */
  const SAMPLE_ERR = { not_granted: "Claude access was declined for this page.", rate_limited: "You've hit a usage limit. Try again in a few minutes.", tools_unavailable: "This view can't run research tools. Open the page on claude.ai.", no_sample: "Claude isn't available in this view. Open the page on claude.ai." };
  function aiSection(box, app, g, sp, onDone) {
    const cache = app._betAI || (app._betAI = new Map());
    const log = h("div", { class: "log" }), out = h("div", { class: "stack" });
    const run = h("button", { class: "btn", type: "button" }, cache.has(g.id) ? "Run again with fresh news" : "Analyze this game with AI");
    let ctl = null;
    const stop = h("button", { class: "btn ghost", type: "button", hidden: true, onclick: () => ctl && ctl.abort() }, "Stop");
    run.onclick = async () => {
      const s = app.caps.sample;
      if (!s) { out.replaceChildren(U.errorBox({ message: SAMPLE_ERR.no_sample })); return; }
      ctl = new AbortController(); run.disabled = true; stop.hidden = false; log.replaceChildren(); out.replaceChildren(h("div", { class: "skeleton" }, "Checking injuries, lineups and news…"));
      try { const res = await analyzeGame(app, g, sp, ctl.signal, (e) => { log.append(h("div", { class: e.kind }, e.text)); log.scrollTop = log.scrollHeight; }); cache.set(g.id, res); paint(res); onDone && onDone(); }
      catch (e) { out.replaceChildren(e && e.code === "cancelled" ? h("p", { class: "muted" }, "Stopped.") : U.errorBox({ message: SAMPLE_ERR[e && e.code] || (e && e.message) || "The analysis didn't finish." })); }
      run.disabled = false; stop.hidden = true; ctl = null; run.textContent = "Run again with fresh news";
    };
    const paint = (res) => out.replaceChildren(aiResult(app, g, res));
    box.replaceChildren(U.section("AI matchup analysis", h("div", { class: "stack" },
      h("p", { class: "small" }, "Claude reads current injury reports, lineup news and form with your Exa and Bigdata.com connectors, then estimates each result's chance. It starts from the market's fair line and only moves away from it when the evidence supports it, so “no bet” is a common answer."),
      h("div", { class: "row" }, run, stop), out, h("details", {}, h("summary", { class: "label" }, "Research steps"), log))));
    if (cache.has(g.id)) paint(cache.get(g.id));
  }
  async function analyzeGame(app, g, sp, signal, onLog) {
    const s = app.caps.sample;
    const lim = await s.limits().catch(() => null);
    if (!lim || !lim.tools) throw Object.assign(new Error(SAMPLE_ERR.tools_unavailable), { code: "tools_unavailable" });
    const ctx = { app, asset: null, question: title(g) + " " + sp.name + " betting preview", log: [], sources: [], stats: {}, onLog };
    const tools = MD.research.makeTools(ctx).filter(t => ["search_web", "read_page", "search_news"].includes(t.name));
    const snap = B.snapshot(g);
    const today = new Date().toISOString().slice(0, 10);
    const r = await s.json(`Today is ${today}. You are a careful, sceptical sports betting analyst helping one bettor.
Game (${sportLabel(sp)}): ${title(g)}${g.start ? ", starting " + new Date(g.start).toISOString() : ""}.
Market data read by the app (authoritative; "fairProbability" has the bookmaker margin removed): ${JSON.stringify(snap).slice(0, 14000)}
Research with the tools (2 to 5 searches): injuries and suspensions, expected lineups or starting pitchers/goalies/quarterbacks, rest and travel, weather for outdoor games, recent form, motivation and schedule spot. Use search_news for news and search_web or read_page for injury reports.
Rules: never invent facts, injuries or sources; cite only URLs your tools returned; if you can't confirm something, say so. Betting markets are efficient: start from the fair probabilities and only move away from them as far as the evidence justifies. Account for the margin: a bet needs the probability to beat 1/decimal odds. "No bet" is often the right recommendation. Never suggest chasing losses or staking more than a small share of a bankroll.
Reply with ONLY JSON: {"summary": "3-5 sentences", "keyFactors": [{"factor": "...", "favors": "home|away|draw|over|under|none", "source_url": "https://..."}], "injuries": [{"team": "...", "player": "...", "status": "...", "source_url": "https://..."}], "probabilities": {"home": 0-100, "away": 0-100, "draw": ${g.soccer ? "0-100" : "null"}, "awayCoversMainSpread": 0-100 or null, "overMainTotal": 0-100 or null}, "recommendation": {"bet": "short description, or No bet", "market": "ml|spread|total|none", "side": "home|away|draw|over|under|none", "confidencePct": 0-100, "reasoning": "2-4 sentences", "maxStakePctOfBankroll": 0-5}, "risks": ["..."], "dataGaps": ["..."]}`, { modelTier: "complex", tools, signal });
    const retrieved = new Set(ctx.sources.map(x => String(x.url).replace(/[#?].*$/, "").replace(/\/$/, "")));
    const ver = (u) => !!u && retrieved.has(String(u).replace(/[#?].*$/, "").replace(/\/$/, ""));
    const pr = r.probabilities || {};
    const raw = { home: num(pr.home), away: num(pr.away), draw: g.soccer ? num(pr.draw) : null };
    const keys = g.soccer ? ["home", "draw", "away"] : ["home", "away"];
    const sum = keys.reduce((a, k) => a + (raw[k] || 0), 0);
    const probs = sum > 0 ? Object.fromEntries(keys.map(k => [k, (raw[k] || 0) / sum])) : null;
    return { at: Date.now(), summary: r.summary || "", keyFactors: (r.keyFactors || []).map(f => Object.assign({}, f, { verified: ver(f.source_url) })), injuries: (r.injuries || []).map(f => Object.assign({}, f, { verified: ver(f.source_url) })), probs, spreadAway: num(pr.awayCoversMainSpread) != null ? num(pr.awayCoversMainSpread) / 100 : null, over: num(pr.overMainTotal) != null ? num(pr.overMainTotal) / 100 : null, rec: r.recommendation || null, risks: r.risks || [], gaps: r.dataGaps || [], sources: ctx.sources, steps: ctx.log };
  }
  const num = (x) => { const n = Number(x); return x == null || x === "" || !isFinite(n) ? null : n; };
  function aiResult(app, g, res) {
    const P = prefs(app);
    const rows = [];
    const ml = g.markets.ml;
    if (res.probs) for (const [s, p] of Object.entries(res.probs)) { const b = ml && ml.best && ml.best[s]; rows.push({ bet: (ml ? ml.label : "Result") + ": " + (s === "draw" ? "Draw" : sideName(g, s)), p, fair: ml && ml.fair ? ml.fair[s] : null, b, k: "ml", s }); }
    const sp = g.markets.spread, tt = g.markets.total;
    if (res.spreadAway != null && sp && sp.best && sp.best.away) rows.push({ bet: sp.label + ": " + g.away.name + " " + lineTxt("spread", "away", sp.mainLine), p: res.spreadAway, fair: sp.fair ? sp.fair.away : null, b: sp.best.away, k: "spread", s: "away" }, { bet: sp.label + ": " + g.home.name + " " + lineTxt("spread", "home", -sp.mainLine), p: 1 - res.spreadAway, fair: sp.fair ? sp.fair.home : null, b: sp.best.home, k: "spread", s: "home" });
    if (res.over != null && tt && tt.best && tt.best.over) rows.push({ bet: tt.label + ": over " + tt.mainLine, p: res.over, fair: tt.fair ? tt.fair.over : null, b: tt.best.over, k: "total", s: "over" }, { bet: tt.label + ": under " + tt.mainLine, p: 1 - res.over, fair: tt.fair ? tt.fair.under : null, b: tt.best.under, k: "total", s: "under" });
    const unver = [...res.keyFactors, ...res.injuries].filter(f => f.source_url && !f.verified).length;
    const rec = res.rec || {};
    return h("div", { class: "stack" },
      h("div", { class: "row between" }, h("span", { class: "verdict " + (/no bet/i.test(rec.bet || "") || rec.market === "none" ? "neutral" : "positive") }, rec.bet || "No recommendation"), h("span", { class: "tiny muted" }, "Analysed " + U.fmtTs(res.at) + (rec.confidencePct != null ? " · confidence " + rec.confidencePct + "/100" : ""))),
      unver ? h("div", { class: "banner warn" }, h("p", { class: "small" }, unver + " cited source(s) weren't retrieved in this analysis; treat those claims as unconfirmed.")) : null,
      h("div", { class: "prose" }, h("p", {}, res.summary), rec.reasoning ? h("p", { class: "muted" }, rec.reasoning) : null),
      rows.length ? U.table([{ t: "Bet", v: "bet" }, { t: "AI chance", v: (x) => pct(x.p), n: true }, { t: "Market fair", v: (x) => pct(x.fair), n: true }, { t: "Best price", v: (x) => x.b ? odds(app, x.b.dec) + " · " + bookTxt(x.b) : "—", n: true }, { t: "AI edge", v: (x) => x.b ? h("span", { class: "num " + U.signCls(x.p * x.b.dec - 1) }, edgeTxt(x.p * x.b.dec - 1)) : "—", n: true }, { t: "Kelly stake", v: (x) => { const f = x.b ? O.kelly(x.p, x.b.dec) * P.kelly : 0; const cap = (Number(rec.maxStakePctOfBankroll) || 2) / 100; return f > 0 ? U.money(Math.min(f, cap) * P.bankroll, "USD") : "—"; }, n: true }, { t: "", v: (x) => x.b ? h("button", { class: "btn ghost sm", type: "button", onclick: () => { const leg = legOf(g, x.k, x.s, x.b.book); leg.aiP = x.p; addLeg(app, leg); } }, "+ Slip") : "" }], rows) : null,
      h("div", { class: "grid g2" },
        h("div", { class: "stack" }, h("h3", {}, "Key factors"), res.keyFactors.length ? h("ul", { class: "small" }, res.keyFactors.map(f => h("li", {}, f.factor, f.favors && f.favors !== "none" ? h("span", { class: "tiny muted" }, " (favours " + (["home", "away"].includes(f.favors) ? sideName(g, f.favors) : f.favors) + ")") : null, f.source_url ? h("span", {}, " · ", h("a", { href: f.source_url, target: "_blank", rel: "noopener noreferrer" }, String(f.source_url).replace(/^https?:\/\//, "").split("/")[0]), f.verified ? null : h("span", { class: "warn-t tiny" }, " unverified")) : null))) : h("p", { class: "muted small" }, "None given.")),
        h("div", { class: "stack" }, h("h3", {}, "Injuries & availability"), res.injuries.length ? h("ul", { class: "small" }, res.injuries.map(f => h("li", {}, h("b", {}, f.player || "?"), " (" + (f.team || "") + "): " + (f.status || ""), f.source_url ? h("span", {}, " · ", h("a", { href: f.source_url, target: "_blank", rel: "noopener noreferrer" }, "source"), f.verified ? null : h("span", { class: "warn-t tiny" }, " unverified")) : null))) : h("p", { class: "muted small" }, "No confirmed injury news found."))),
      res.risks.length || res.gaps.length ? h("div", { class: "small" }, h("span", { class: "label" }, "Risks and gaps"), h("ul", {}, [...res.risks, ...res.gaps.map(x => "Not found: " + x)].map(x => h("li", {}, String(x))))) : null,
      h("p", { class: "tiny muted" }, "An AI estimate from public news, not a guarantee. Sources retrieved: " + res.sources.length + ". Kelly stakes are capped at the share of bankroll the analysis suggests."));
  }

  /* ================= bet slip & parlay ================= */
  function slipView(body, app) {
    const P = prefs(app);
    const legs = slip(app);
    let mode = app.ls.get("bet.slipMode", "singles");
    const stakeIn = h("input", { type: "number", min: "0", step: "1", value: String(app.ls.get("bet.slipStake", P.unit)), "aria-label": "Stake", style: "max-width:140px" });
    const out = h("div", { class: "stack" });
    if (!legs.length) { body.append(h("div", { class: "empty" }, "Your bet slip is empty. Click any price on a game's page to add it.")); return; }
    const paint = () => {
      const stake = Math.max(0, Number(stakeIn.value) || 0); app.ls.set("bet.slipStake", stake);
      const pOf = (l) => l.aiP ?? l.p ?? l.modelP;
      const games = new Set(legs.map(l => l.gameId));
      const sameGame = games.size < legs.length;
      const books = new Set(legs.map(l => l.book));
      if (mode === "parlay") {
        const pr = O.parlay(legs.map(l => ({ dec: l.dec, p: pOf(l) })));
        out.replaceChildren(U.kv([["Legs", String(legs.length)], ["Parlay odds", odds(app, pr.dec) + " (" + pr.dec.toFixed(2) + "×)"], ["Pays if all win", U.money(stake * (pr.dec - 1), "USD") + " profit · " + U.money(stake * pr.dec, "USD") + " back"], ["Implied chance", pct(pr.impliedP, 2)], ["Estimated chance", pr.p != null ? pct(pr.p, 2) : "needs a probability for every leg"], ["Expected profit", pr.edge != null ? U.money(stake * pr.edge, "USD") + " (" + edgeTxt(pr.edge) + ")" : "—"]]),
          sameGame ? h("div", { class: "banner warn" }, h("p", { class: "small" }, "Two legs are from the same game. Their outcomes are linked, so multiplying their chances is wrong, and most books only allow it as a priced same-game parlay.")) : null,
          books.size > 1 ? h("div", { class: "banner info" }, h("p", { class: "small" }, "These prices come from " + books.size + " books (" + [...books].join(", ") + "). A parlay is placed at one book, so its price there will differ.")) : null,
          h("p", { class: "tiny muted" }, "Each leg's estimated chance uses the AI estimate if you added it from the analysis, else the market's fair chance, else the model. Parlays compound the bookmaker's margin on every leg."));
      } else {
        const tot = legs.reduce((a, l) => a + stake * (l.dec - 1), 0), ev = legs.reduce((a, l) => { const p = pOf(l); return a + (p != null ? stake * O.edge(p, l.dec, l.push || 0) : 0); }, 0);
        out.replaceChildren(U.kv([["Bets", String(legs.length)], ["Total staked", U.money(stake * legs.length, "USD")], ["Profit if all win", U.money(tot, "USD")], ["Expected profit", U.money(ev, "USD")]]));
      }
    };
    const legTable = U.table([{ t: "Pick", v: (l) => h("span", {}, h("b", {}, l.pick), h("br"), h("span", { class: "tiny muted" }, l.game + " · " + l.marketLabel)) }, { t: "Book", v: "book" }, { t: "Odds", v: (l) => h("b", { class: "num" }, odds(app, l.dec)), n: true }, { t: "Chance", v: (l) => pct(l.aiP ?? l.p ?? l.modelP) + (l.aiP != null ? " (AI)" : l.p == null && l.modelP != null ? " (model)" : ""), n: true }, { t: "Kelly", v: (l) => { const p = l.aiP ?? l.p ?? l.modelP; const f = p != null ? O.kelly(p, l.dec, l.push || 0) * P.kelly : 0; return f > 0 ? U.money(f * P.bankroll, "USD") : "no edge"; }, n: true }, { t: "", v: (l) => h("button", { class: "linkbtn", type: "button", "aria-label": "Remove " + l.pick, onclick: () => { setSlip(app, slip(app).filter(x => x.id !== l.id)); body.replaceChildren(); slipView(body, app); } }, "Remove") }], legs);
    stakeIn.oninput = paint;
    const logBtn = h("button", { class: "btn", type: "button", onclick: async () => {
      const stake = Math.max(0, Number(stakeIn.value) || 0);
      if (!stake) { U.toast("Enter a stake first", null, true); return; }
      if (app.demo) { U.toast("Demo mode", "Bets aren't saved in demo mode.", true); return; }
      const base = { createdAt: Date.now(), placedAt: Date.now(), stake, currency: "USD", status: "open", note: "" };
      if (mode === "parlay") { const pr = O.parlay(legs.map(l => ({ dec: l.dec, p: l.aiP ?? l.p ?? l.modelP }))); await app.store.put("bets", MD.store.newId(), Object.assign(base, { type: "parlay", legs, dec: pr.dec, book: [...new Set(legs.map(l => l.book))].join(" / "), pick: legs.length + "-leg parlay", game: legs.map(l => l.game).join(" + "), sport: legs[0].sport, fairP: pr.p, start: Math.min(...legs.map(l => l.start || Infinity)) || null })); }
      else for (const l of legs) await app.store.put("bets", MD.store.newId(), Object.assign({}, base, { type: "single", legs: [l], dec: l.dec, book: l.book, pick: l.pick, game: l.game, sport: l.sport, market: l.market, fairP: l.aiP ?? l.p ?? l.modelP, start: l.start, gameId: l.gameId }));
      setSlip(app, []); U.toast("Logged in My bets", "Settle them there after the games."); app.ls.set("bet.tab", "bets"); app.rerender();
    } }, "Log as placed");
    body.append(U.section("Bet slip", h("div", { class: "stack" }, legTable,
      h("div", { class: "row" }, U.field("Stake per bet (USD)", stakeIn), h("div", { class: "field" }, h("span", { class: "label" }, "Type"), U.seg(["Singles", "Parlay"], mode === "parlay" ? "Parlay" : "Singles", (v) => { mode = v.toLowerCase(); app.ls.set("bet.slipMode", mode); body.replaceChildren(); slipView(body, app); }, (v) => v === "Parlay" && legs.length < 2))),
      out,
      h("div", { class: "row" }, logBtn, h("button", { class: "btn ghost", type: "button", onclick: () => { setSlip(app, []); body.replaceChildren(); slipView(body, app); } }, "Clear slip")),
      h("p", { class: "tiny muted" }, "The slip is a worksheet. Place the bet yourself in the sportsbook, then “Log as placed” to track it. Prices on the slip are from when you added them."))));
    paint();
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
    const saveP = () => setPrefs(app, { bankroll: Math.max(0, Number(bInput.value) || 0), unit: Math.max(0, Number(uInput.value) || 0), kelly: Number(kSel.value) });
    bInput.onchange = saveP; uInput.onchange = saveP; kSel.onchange = saveP;
    body.append(
      h("div", { class: "grid g4" }, [["Bankroll now", U.money(bankroll, "USD"), U.signCls(pl)], ["Profit / loss", (pl >= 0 ? "+" : "") + U.money(pl, "USD"), U.signCls(pl)], ["Return on stakes", staked ? edgeTxt(pl / staked) : "—", U.signCls(pl)], ["Win rate", graded.length ? pct(wins / graded.length, 0) + " of " + graded.length : "—", ""], ["Open bets", String(open.length) + " · " + U.money(open.reduce((a, b) => a + b.stake, 0), "USD") + " at risk", ""], ["Average odds", all.length ? odds(app, all.reduce((a, b) => a + b.dec, 0) / all.length) : "—", ""], ["Closing-line value", clvs.length ? edgeTxt(clvs.reduce((a, b) => a + b, 0) / clvs.length) + " avg (" + clvs.length + ")" : "add closing odds", clvs.length ? U.signCls(clvs.reduce((a, b) => a + b, 0)) : ""], ["Luck vs expectation", done.some(b => b.fairP != null) ? (pl - expected >= 0 ? "+" : "") + U.money(pl - expected, "USD") : "—", ""]].map(([k, v, cls]) => h("div", { class: "tile" }, h("span", { class: "label" }, k), h("span", { class: "v " + cls }, v)))),
      done.length >= 2 ? curve(done, P.bankroll) : null,
      U.section("Bets", h("div", { class: "stack" },
        h("div", { class: "row between" }, U.seg(["All", "Open", "Settled"], filter[0].toUpperCase() + filter.slice(1), (v) => { app.ls.set("bet.filter", v.toLowerCase()); body.replaceChildren(); betsView(body, app); }), h("div", { class: "row" }, h("button", { class: "btn ghost sm", type: "button", onclick: () => manualBet(app) }, "Add a bet manually"), all.length ? h("button", { class: "btn ghost sm", type: "button", onclick: () => U.download("bets-" + new Date().toISOString().slice(0, 10) + ".csv", C.toCSV([["placed", "sport", "game", "pick", "type", "book", "decimal_odds", "american_odds", "stake", "status", "profit", "closing_decimal", "clv_pct", "fair_probability"], ...all.map(b => [new Date(b.placedAt || b.createdAt).toISOString(), b.sport, b.game, b.pick, b.type, b.book, b.dec.toFixed(4), O.fmtAm(b.dec), b.stake, b.status, settled(b) ? profit(b).toFixed(2) : "", b.closingDec || "", b.closingDec ? (O.clv(b.dec, b.closingDec) * 100).toFixed(2) : "", b.fairP != null ? b.fairP.toFixed(4) : ""])])) }, "Export CSV") : null)),
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
      U.section("Bankroll & staking", h("div", { class: "stack" }, h("div", { class: "form" }, U.field("Starting bankroll (USD)", bInput), U.field("Unit size (USD)", uInput, "Your standard stake; the slip starts here."), U.field("Kelly fraction", kSel, "Full Kelly maximizes growth only if your probabilities are exact; fractions cut the swings.")),
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

  MD.betting = { legOf, addLeg, slip, profit, analyzeGame };
})(typeof window !== "undefined" ? window : globalThis);
