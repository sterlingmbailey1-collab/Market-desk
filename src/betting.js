/* Sports betting data. Odds pages and exchange prices are read through the viewer's Exa connector
   (this page can't reach other hosts); the Statz connector supplies soccer model projections.
   Every game carries the sources it came from and each source's own update time. Market Desk only
   reads odds: it never logs in to a sportsbook or places a bet. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const D = MD.data, O = MD.odds;

  const SPORTS = [
    { id: "nfl", name: "NFL", group: "US & college", vi: "nfl", sl: "nfl", sigma: "nfl", unit: "points" },
    { id: "ncaaf", name: "College football", group: "US & college", vi: "college-football", sl: "college-football", sigma: "ncaaf", unit: "points" },
    { id: "nba", name: "NBA", group: "US & college", vi: "nba", sl: "nba", sigma: "nba", unit: "points" },
    { id: "ncaab", name: "College basketball", group: "US & college", vi: "college-basketball", sl: "college-basketball", sigma: "ncaab", unit: "points" },
    { id: "wnba", name: "WNBA", group: "US & college", vi: "wnba", sl: "wnba", sigma: "wnba", unit: "points" },
    { id: "mlb", name: "MLB", group: "US & college", vi: "mlb", sl: "mlb", sigma: "mlb", unit: "runs" },
    { id: "nhl", name: "NHL", group: "US & college", vi: "nhl", sl: "nhl", sigma: "nhl", unit: "goals" },
    { id: "epl", name: "Premier League", country: "England", group: "Soccer · top 5 leagues", soccer: true, sl: "epl", kalshi: "KXEPLGAME", statz: "premier-league", unit: "goals" },
    { id: "laliga", name: "La Liga", country: "Spain", group: "Soccer · top 5 leagues", soccer: true, sl: "la-liga", kalshi: "KXLALIGAGAME", statz: "la-liga", unit: "goals" },
    { id: "seriea", name: "Serie A", country: "Italy", group: "Soccer · top 5 leagues", soccer: true, sl: "serie-a", kalshi: "KXSERIEAGAME", statz: "serie-a", unit: "goals" },
    { id: "bundesliga", name: "Bundesliga", country: "Germany", group: "Soccer · top 5 leagues", soccer: true, sl: "bundesliga", kalshi: "KXBUNDESLIGAGAME", statz: "bundesliga", unit: "goals" },
    { id: "ligue1", name: "Ligue 1", country: "France", group: "Soccer · top 5 leagues", soccer: true, sl: "ligue-1", kalshi: "KXLIGUE1GAME", statz: "ligue-1", unit: "goals" }
  ];
  const sportOf = (id) => SPORTS.find(s => s.id === id) || SPORTS[0];
  const BOOK_NAMES = { bet365: "bet365", betmgm: "BetMGM", draftkings: "DraftKings", caesars: "Caesars", fanduel: "FanDuel", hardrock: "Hard Rock", fanatics: "Fanatics", kalshi: "Kalshi", espnbet: "ESPN BET", betrivers: "BetRivers", pointsbet: "PointsBet" };
  const bookName = (s) => BOOK_NAMES[String(s).toLowerCase().replace(/[^a-z0-9]/g, "")] || String(s).trim();
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  /* ---------- time helpers (odds pages print US Eastern time) ---------- */
  function nyOffsetMs(t) {
    try {
      const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t)).map(x => [x.type, x.value]));
      return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
    } catch { return -4 * 3600e3; }
  }
  function easternToUtc(y, mo, d, hh, mm) { let t = Date.UTC(y, mo, d, hh, mm) + 5 * 3600e3; for (let i = 0; i < 2; i++) t = Date.UTC(y, mo, d, hh, mm) - nyOffsetMs(t); return t; }
  // "Oct 24" (+ optional "2:45PM") → epoch ms, choosing the year that puts the date nearest today.
  function parseWhen(monthDay, time, now = Date.now()) {
    const m = String(monthDay || "").match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})/); if (!m || MONTHS[m[1].toLowerCase()] == null) return null;
    const mo = MONTHS[m[1].toLowerCase()], d = +m[2];
    let hh = 12, mm = 0, hasTime = false;
    const t = String(time || "").match(/(\d{1,2}):(\d{2})\s*([AP])\.?M/i);
    if (t) { hh = (+t[1] % 12) + (/p/i.test(t[3]) ? 12 : 0); mm = +t[2]; hasTime = true; }
    const y0 = new Date(now).getUTCFullYear();
    let best = null;
    for (const y of [y0 - 1, y0, y0 + 1]) { const v = easternToUtc(y, mo, d, hh, mm); if (best == null || Math.abs(v - now) < Math.abs(best - now)) best = v; }
    return { at: best, hasTime };
  }
  function statusOf(g, now = Date.now()) {
    if (g.final) return "final";
    if (!g.start) return "listed";
    if (g.startHasTime === false) return now > g.start + 36 * 3600e3 ? "past" : "upcoming";
    const len = g.soccer ? 2.1 : g.sport === "mlb" ? 3.2 : g.sport === "nhl" ? 2.7 : 3.3;
    return now < g.start ? "upcoming" : now < g.start + len * 3600e3 ? "in progress" : "past";
  }

  /* ---------- cell parsing ---------- */
  const RX = {
    total: /^([ou])\s?(\d+(?:\.\d+)?)\s*([+-]\d{3,}|even)$/i,
    spread: /^([+-]?\d+(?:\.\d+)?|pk|pick)\s*([+-]\d{3,}|even)$/i,
    ml: /^([+-]\d{3,}|even)$/i
  };
  function parseCell(raw) {
    const s = String(raw || "").replace(/[▲▼]/g, "").replace(/\s+Open:.*$/i, "").trim();
    if (!s || /^(n\/a|--|-|—|off)$/i.test(s)) return null;
    let m = s.match(RX.total); if (m) return { kind: "total", side: m[1].toLowerCase() === "o" ? "over" : "under", line: +m[2], dec: O.parseOdds(m[3]), text: m[3] };
    m = s.match(RX.spread); if (m) return { kind: "spread", line: /^p/i.test(m[1]) ? 0 : +m[1], dec: O.parseOdds(m[2]), text: m[2] };
    m = s.match(RX.ml); if (m) return { kind: "ml", dec: O.parseOdds(m[1]), text: m[1] };
    return null;
  }
  // SportsLine prints the opening line after the price: "-0.5+108 Open: -0.5▼" or "+338 Open: +350▲".
  function parseOpen(raw, kind) {
    const m = String(raw || "").match(/Open:\s*([^▲▼|]+)/i); if (!m) return null;
    const v = m[1].trim();
    if (kind === "ml") { const d = O.parseOdds(v); return d ? { dec: d, text: v } : null; }
    const n = /^pk/i.test(v) ? 0 : parseFloat(v); return isFinite(n) ? { line: n } : null;
  }
  const cellsOf = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
  const SIDES = { ml: ["away", "home"], spread: ["away", "home"], total: ["over", "under"] };
  const LABEL = { ml: "Moneyline", spread: "Spread", total: "Total" };
  const newMarket = (kind) => ({ kind, label: LABEL[kind], sides: SIDES[kind].slice(), books: {}, open: null, consensus: null });
  function addQuote(mkt, book, side, q) { if (!q || !(q.dec > 1)) return; const b = mkt.books[book] || (mkt.books[book] = {}); b[side] = { dec: q.dec, line: q.line != null ? q.line : null }; }

  /* ---------- VegasInsider (US sports, named books) ---------- */
  function parseVegasInsider(md, sport) {
    const lines = String(md || "").split("\n");
    const upd = (md.match(/Updated on (\d{1,2})\/(\d{1,2})\/(\d{2,4})/) || []);
    const updated = upd.length ? Date.UTC(+(upd[3].length === 2 ? "20" + upd[3] : upd[3]), +upd[1] - 1, +upd[2], 12) : null;
    let cols = null, status = "", date = null, prev = null;
    const games = new Map();
    for (const raw of lines) {
      const t = raw.trim();
      const dh = t.match(/^#{1,4}\s+(?:[A-Za-z]+,?\s+)?((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2})(?:st|nd|rd|th)?\s*$/);
      if (dh) { date = dh[1]; continue; }
      if (!t.startsWith("|")) continue;
      const c = cellsOf(t);
      if (/^time$/i.test(c[0])) { cols = c.slice(1); continue; }
      if (!cols || /^:?-{2,}/.test(c[0])) continue;
      if (c[1] === "Open" && (c[2] === "›" || c[2] === ">")) { status = c[0]; prev = null; continue; }
      const m = c[0].match(/^(\d{2,4})\s+(.+)$/);
      if (!m) { prev = null; continue; }
      const vals = c.slice(1, 1 + cols.length).map(parseCell);
      const first = vals.find(Boolean); if (!first) continue;
      const row = { rot: +m[1], team: m[2].replace(/\s+/g, " ").trim(), vals, kind: first.kind, status, date };
      if (prev && prev.kind === row.kind && row.rot === prev.rot + 1) {
        const key = sport.id + ":" + prev.rot;
        let g = games.get(key);
        if (!g) {
          const when = parseWhen(prev.date, prev.status);
          g = { id: key, sport: sport.id, soccer: false, away: { name: prev.team, rot: prev.rot }, home: { name: row.team, rot: row.rot }, final: /final/i.test(prev.status), start: when ? when.at : null, startHasTime: when ? when.hasTime : null, dateLabel: prev.date || null, timeLabel: /\d:\d\d/.test(prev.status) ? prev.status : null, live: /live|qtr|half|inning|period|\d(st|nd|rd|th)\b/i.test(prev.status) && !/final/i.test(prev.status) ? prev.status : null, markets: {}, sources: [] };
          games.set(key, g);
        }
        const mk = g.markets[row.kind] || (g.markets[row.kind] = newMarket(row.kind));
        cols.forEach((name, i) => {
          const a = prev.vals[i], b = vals[i];
          const sideOf = (q, dflt) => row.kind === "total" ? (q && q.side) || dflt : dflt;
          const qa = a && a.kind === row.kind ? a : null, qb = b && b.kind === row.kind ? b : null;
          if (/^open$/i.test(name)) { mk.open = {}; if (qa) mk.open[sideOf(qa, mk.sides[0])] = { dec: qa.dec, line: qa.line ?? null }; if (qb) mk.open[sideOf(qb, mk.sides[1])] = { dec: qb.dec, line: qb.line ?? null }; return; }
          if (/^consensus$/i.test(name)) { mk.consensus = {}; if (qa) mk.consensus[sideOf(qa, mk.sides[0])] = { dec: qa.dec, line: qa.line ?? null }; if (qb) mk.consensus[sideOf(qb, mk.sides[1])] = { dec: qb.dec, line: qb.line ?? null }; return; }
          const bk = bookName(name);
          if (qa) addQuote(mk, bk, sideOf(qa, mk.sides[0]), qa);
          if (qb) addQuote(mk, bk, sideOf(qb, mk.sides[1]), qb);
        });
        prev = null;
      } else prev = row;
    }
    return { games: [...games.values()], updated, books: cols ? cols.filter(x => !/^(open|consensus)$/i.test(x)).map(bookName) : [] };
  }

  /* ---------- SportsLine (soccer, and US backup) ---------- */
  function parseSportsLine(md, sport, kind) {
    const lines = String(md || "").split("\n");
    let header = null, date = null, pending = null, last = null;
    const games = [];
    for (const raw of lines) {
      const t = raw.trim(); if (!t.startsWith("|")) continue;
      const c = cellsOf(t);
      if (/^matchup$/i.test(c[0])) { header = c; continue; }
      if (!header || /^:?-{2,}/.test(c[0])) continue;
      const dm = c[0].match(/^(?:Today|Tomorrow|Yesterday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,\s+([A-Z][a-z]{2}\s+\d{1,2})$/);
      if (dm) { date = dm[1]; pending = null; continue; }
      const tm = c[0].match(/(\d{1,2}:\d{2}\s*[AP]M)\s*ET/i);
      if (tm && /insight|pick/i.test(c[0])) { if (last && !last.timeLabel) { last.timeLabel = tm[1].replace(/\s+/g, ""); const w = parseWhen(last.dateLabel, last.timeLabel); if (w) { last.start = w.at; last.startHasTime = true; } } pending = null; continue; }
      const books = header.map((hd, i) => ({ i, name: hd })).filter(x => x.i >= 3 && x.name);
      const parsed = books.map(b => ({ name: b.name, q: parseCell(c[b.i]), open: parseOpen(c[b.i], kind) }));
      if (!c[0] || !parsed.some(p => p.q)) { pending = null; continue; }
      if (!pending) { pending = { team: c[0], parsed, date }; continue; }
      const w = parseWhen(pending.date, null);
      const g = { id: sport.id + ":" + slug(pending.team) + "@" + slug(c[0]) + ":" + (pending.date || ""), sport: sport.id, soccer: !!sport.soccer, away: { name: pending.team }, home: { name: c[0] }, final: false, start: w ? w.at : null, startHasTime: false, dateLabel: pending.date, timeLabel: null, markets: {}, sources: [] };
      const mk = g.markets[kind] = newMarket(kind);
      if (sport.soccer && kind === "ml") mk.label = "Match result (90 min)";
      if (sport.soccer && kind === "spread") mk.label = "Handicap";
      if (sport.soccer && kind === "total") mk.label = "Total goals";
      // pending.parsed is the away (first) row, parsed the home (second) row; totals read the side from the cell.
      pending.parsed.forEach((pa, j) => {
        const pb = parsed[j];
        const a = pa.q && pa.q.kind === kind ? pa.q : null, b = pb.q && pb.q.kind === kind ? pb.q : null;
        const sa = kind === "total" ? (a && a.side) || "over" : "away", sb = kind === "total" ? (b && b.side) || "under" : "home";
        if (/^consensus$/i.test(pa.name)) { mk.consensus = {}; if (a) mk.consensus[sa] = { dec: a.dec, line: a.line ?? null }; if (b) mk.consensus[sb] = { dec: b.dec, line: b.line ?? null }; if (pa.open || pb.open) { mk.open = {}; if (pa.open) mk.open[sa] = pa.open; if (pb.open) mk.open[sb] = pb.open; } return; }
        const bk = bookName(pa.name);
        if (a) addQuote(mk, bk, sa, a);
        if (b) addQuote(mk, bk, sb, b);
      });
      games.push(g); last = g; pending = null;
    }
    return { games, books: header ? header.slice(3).filter(x => x && !/^consensus$/i.test(x)).map(bookName) : [] };
  }
  const slug = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  /* ---------- Kalshi soccer match markets ---------- */
  // Read field by field from the raw text so a response cut short by the size limit still yields the
  // complete markets before the cut.
  function parseKalshi(text) {
    const out = new Map();
    const chunks = String(text || "").split(/\{"can_close_early"/).slice(1);
    const f = (s, k) => { const m = s.match(new RegExp('"' + k + '":"([^"]*)"')); return m ? m[1] : null; };
    for (const s of chunks) {
      const ev = f(s, "event_ticker"), team = f(s, "yes_sub_title"); if (!ev || !team) continue;
      const ask = parseFloat(f(s, "yes_ask_dollars")), bid = parseFloat(f(s, "yes_bid_dollars")), last = parseFloat(f(s, "last_price_dollars"));
      if (!(ask > 0) && !(last > 0)) continue;
      const rules = f(s, "rules_primary") || "";
      const game = (rules.match(/the (.+?) professional/) || [])[1] || null;
      const e = out.get(ev) || { ticker: ev, title: game, outcomes: [], when: f(s, "occurrence_datetime") || f(s, "expected_expiration_time"), status: f(s, "status") };
      e.outcomes.push({ name: team, tie: /^tie$/i.test(team), ask: ask > 0 ? ask : null, bid: bid > 0 ? bid : null, last: last > 0 ? last : null, volume: parseFloat(f(s, "volume_fp")) || 0, ticker: f(s, "ticker") });
      if (!e.title && game) e.title = game;
      out.set(ev, e);
    }
    return [...out.values()].filter(e => e.outcomes.length >= 2);
  }

  /* ---------- team-name matching across sources ---------- */
  const ALIAS = { psg: "paris saint germain", "paris sg": "paris saint germain", "man city": "manchester city", "man utd": "manchester united", "man united": "manchester united", spurs: "tottenham", wolves: "wolverhampton", "nottm forest": "nottingham forest", forest: "nottingham forest", bilbao: "athletic", "athletic bilbao": "athletic", atleti: "atletico madrid", inter: "internazionale", "inter milan": "internazionale", gladbach: "monchengladbach", "m gladbach": "monchengladbach", leverkusen: "bayer leverkusen", "bayern munich": "bayern", "bayern munchen": "bayern", "rb leipzig": "leipzig", "sporting cp": "sporting", "olympique marseille": "marseille", om: "marseille", "olympique lyonnais": "lyon", ol: "lyon", "saint etienne": "st etienne", betis: "real betis", sociedad: "real sociedad", celta: "celta vigo", "celta de vigo": "celta vigo", "racing de santander": "racing santander", "angers sco": "angers", "brighton hove albion": "brighton", "west ham united": "west ham", "newcastle united": "newcastle", "leeds united": "leeds", "ipswich town": "ipswich", "coventry city": "coventry", "hull city": "hull", "leicester city": "leicester", "norwich city": "norwich", "stoke city": "stoke", "sheffield united": "sheffield utd", "afc bournemouth": "bournemouth", "hellas verona": "verona", "ac milan": "milan" };
  const STOP = new Set(["fc", "cf", "afc", "sc", "ac", "as", "ss", "us", "ssc", "sv", "vfb", "vfl", "tsg", "fsv", "1", "club", "de", "del", "la", "le", "calcio", "the", "and", "cd", "ud", "rcd", "ca", "sd", "olympique", "stade", "rc", "real", "town", "city", "united", "hotspur", "albion"]);
  function teamTokens(name) {
    let s = String(name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
    if (ALIAS[s]) s = ALIAS[s];
    const keep = s.split(" ").filter(w => w && !STOP.has(w));
    return keep.length ? keep : s.split(" ").filter(Boolean);
  }
  function teamScore(a, b) {
    const A = teamTokens(a), B = teamTokens(b); if (!A.length || !B.length) return 0;
    const hit = (x, y) => x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x)));
    let n = 0; for (const x of A) if (B.some(y => hit(x, y))) n++;
    return n / Math.max(A.length, B.length);
  }
  // Best pairing of a game with one of `others` ({home, away, at}), allowing the other source to list
  // the teams the other way round. Returns {item, flipped, score} or null.
  function matchGame(g, others, getTeams) {
    let best = null;
    for (const o of others) {
      const t = getTeams(o); if (!t) continue;
      if (g.start && t.at && Math.abs(g.start - t.at) > 40 * 3600e3) continue;
      const straight = Math.min(teamScore(g.home.name, t.home), teamScore(g.away.name, t.away));
      const flipped = Math.min(teamScore(g.home.name, t.away), teamScore(g.away.name, t.home));
      const sc = Math.max(straight, flipped);
      if (sc >= 0.34 && (!best || sc > best.score)) best = { item: o, flipped: flipped > straight, score: sc };
    }
    return best;
  }
  function mergeGames(into, more) {
    for (const g of more) {
      const m = matchGame(g, into, (o) => ({ home: o.home.name, away: o.away.name, at: o.start }));
      if (!m) { into.push(g); continue; }
      if (m.flipped) swapSides(g);
      const t = m.item;
      for (const [k, mk] of Object.entries(g.markets)) { if (!t.markets[k]) t.markets[k] = mk; else Object.assign(t.markets[k].books, mk.books); }
      if (!t.timeLabel && g.timeLabel) { t.timeLabel = g.timeLabel; t.start = g.start; t.startHasTime = g.startHasTime; }
    }
    return into;
  }

  /* ---------- Statz (soccer model) ---------- */
  const statzConn = D.connector("Statz", "statz");
  const pick = (r, k) => r && r[k] !== undefined ? r[k] : r && r.__text && r.__text[k] !== undefined ? r.__text[k] : (() => { try { return JSON.parse(r.text)[k]; } catch { return undefined; } })();
  async function statzFixtures(comp, days = 7) {
    const r = await statzConn.call("get_upcoming_fixtures", { competition: comp, days }, 15 * 60e3);
    return (pick(r, "fixtures") || []).map(f => ({ id: f.fixture_id, home: f.home, away: f.away, at: Date.parse(f.kickoff), url: f.url, p: f.projection ? { home: f.projection.home_win_pct / 100, draw: f.projection.draw_pct / 100, away: f.projection.away_win_pct / 100, hg: Number(f.projection.home_goals), ag: Number(f.projection.away_goals) } : null }));
  }
  async function statzLeaders(fixtureId) {
    const r = await statzConn.call("get_match_leaders", { fixture_id: fixtureId }, 30 * 60e3);
    return { title: pick(r, "title"), subtitle: pick(r, "subtitle"), panels: pick(r, "panels") || [], link: pick(r, "link") || null };
  }

  /* ---------- loading a league ---------- */
  const cache = new Map();
  const TTL = 5 * 60e3;
  const source = (name, url, updated, note) => ({ name, url, updated: updated || null, retrieved: Date.now(), note: note || null });
  async function loadUS(sport) {
    const url = "https://www.vegasinsider.com/" + sport.vi + "/odds/las-vegas/";
    let games = [], books = [], srcs = [], viErr = null;
    try {
      const body = await D.fetchRaw(D.bust(url), 120000, 0);
      const r = parseVegasInsider(body, sport); games = r.games; books = r.books;
      srcs.push(source("VegasInsider", url, r.updated));
    } catch (e) { viErr = e; }
    const usable = games.filter(g => Object.values(g.markets).some(m => Object.keys(m.books).length));
    if (!usable.length) {
      // Backup: SportsLine's three line pages.
      const kinds = [["ml", "money-line/"], ["spread", ""], ["total", "over-under/"]];
      const got = await Promise.allSettled(kinds.map(([k, p]) => D.fetchRaw(D.bust("https://www.sportsline.com/" + sport.sl + "/odds/" + p), 120000, 0).then(b => parseSportsLine(b, sport, k))));
      const merged = [];
      got.forEach((r, i) => { if (r.status === "fulfilled") { mergeGames(merged, r.value.games); books = books.length ? books : r.value.books; srcs.push(source("SportsLine", "https://www.sportsline.com/" + sport.sl + "/odds/" + kinds[i][1])); } });
      if (merged.length) games = merged;
      else if (viErr) throw viErr;
    }
    for (const g of games) g.sources = srcs;
    return { sport, games, books, sources: srcs };
  }
  async function loadSoccer(sport) {
    const base = "https://www.sportsline.com/" + sport.sl + "/odds/";
    const kinds = [["ml", "money-line/"], ["spread", ""], ["total", "over-under/"]];
    const [sl, kal, st] = await Promise.all([
      Promise.allSettled(kinds.map(([k, p]) => D.fetchRaw(D.bust(base + p), 120000, 0).then(b => parseSportsLine(b, sport, k)))),
      D.fetchRaw("https://api.elections.kalshi.com/trade-api/v2/events?series_ticker=" + sport.kalshi + "&status=open&with_nested_markets=true&limit=40", 250000, 60e3).then(parseKalshi).catch(e => ({ error: e })),
      statzFixtures(sport.statz, 8).catch(e => ({ error: e }))
    ]);
    const srcs = [], games = [], errors = [];
    let books = [];
    sl.forEach((r, i) => { if (r.status === "fulfilled") { mergeGames(games, r.value.games); if (!books.length) books = r.value.books; srcs.push(source("SportsLine", base + kinds[i][1])); } else errors.push("SportsLine " + LABEL[kinds[i][0]].toLowerCase() + ": " + ((r.reason && r.reason.message) || "failed")); });
    const fixtures = Array.isArray(st) ? st : [];
    if (!Array.isArray(st)) errors.push("Statz: " + ((st.error && st.error.message) || "failed"));
    else srcs.push(source("Statz model", "https://statz.ai/competitions/" + sport.statz, null, "Model projections"));
    const events = Array.isArray(kal) ? kal : [];
    if (!Array.isArray(kal)) errors.push("Kalshi: " + ((kal.error && kal.error.message) || "failed"));
    else srcs.push(source("Kalshi", "https://kalshi.com/markets/" + sport.kalshi.toLowerCase(), null, "Exchange prices"));
    // Orient each game by Statz's home/away when it matches, and attach the model.
    for (const g of games) {
      const m = matchGame(g, fixtures, (f) => ({ home: f.home, away: f.away, at: f.at }));
      if (m) {
        if (m.flipped) swapSides(g);
        g.model = Object.assign({ fixtureId: m.item.id, url: m.item.url, home: m.item.home, away: m.item.away }, m.item.p);
        if (m.item.at) { g.start = m.item.at; g.startHasTime = true; }
      }
    }
    // Statz fixtures that no odds page lists yet still show, with the model only.
    for (const f of fixtures) if (!games.some(g => g.model && g.model.fixtureId === f.id)) games.push({ id: sport.id + ":statz:" + f.id, sport: sport.id, soccer: true, home: { name: f.home }, away: { name: f.away }, start: f.at, startHasTime: true, markets: {}, model: Object.assign({ fixtureId: f.id, url: f.url, home: f.home, away: f.away }, f.p), sources: [] });
    // Kalshi: home / away / tie prices.
    for (const e of events) {
      const teams = e.outcomes.filter(o => !o.tie);
      if (teams.length !== 2) continue;
      const at = e.when ? Date.parse(e.when) - 2 * 3600e3 : null;
      const gm = matchGame({ home: { name: teams[0].name }, away: { name: teams[1].name }, start: at }, games, (o) => ({ home: o.home.name, away: o.away.name, at: o.start }));
      if (!gm) continue;
      const g = gm.item;
      const hTeam = teamScore(g.home.name, teams[0].name) >= teamScore(g.home.name, teams[1].name) ? teams[0] : teams[1];
      const aTeam = hTeam === teams[0] ? teams[1] : teams[0], tie = e.outcomes.find(o => o.tie);
      g.kalshi = { ticker: e.ticker, title: e.title, home: hTeam, away: aTeam, tie: tie || null, url: "https://kalshi.com/markets/" + sport.kalshi.toLowerCase() };
      const mk = g.markets.ml || (g.markets.ml = Object.assign(newMarket("ml"), { label: "Match result (90 min)" }));
      if (!mk.sides.includes("draw")) mk.sides = ["home", "draw", "away"];
      const q = {}; if (hTeam.ask) q.home = { dec: 1 / hTeam.ask, line: null }; if (aTeam.ask) q.away = { dec: 1 / aTeam.ask, line: null }; if (tie && tie.ask) q.draw = { dec: 1 / tie.ask, line: null };
      mk.books.Kalshi = q;
    }
    for (const g of games) { g.sources = srcs; if (g.markets.ml) g.markets.ml.sides = ["home", "draw", "away"]; }
    if (!games.length && errors.length) throw new D.DataError("fetch_failed", errors.join(" · "), "sportsline");
    return { sport, games, books: books.concat(events.length ? ["Kalshi"] : []), sources: srcs, errors };
  }
  function swapSides(g) {
    [g.home, g.away] = [g.away, g.home];
    for (const [k, mk] of Object.entries(g.markets)) {
      if (k === "total") continue;
      for (const b of Object.keys(mk.books)) { const q = mk.books[b]; mk.books[b] = Object.assign({}, q, { home: q.away, away: q.home }); if (!mk.books[b].home) delete mk.books[b].home; if (!mk.books[b].away) delete mk.books[b].away; }
      if (mk.consensus) mk.consensus = { home: mk.consensus.away, away: mk.consensus.home };
      if (mk.open) mk.open = { home: mk.open.away, away: mk.open.home };
    }
  }
  function load(sportId, force) {
    const sport = sportOf(sportId);
    const hit = cache.get(sport.id);
    if (!force && hit && Date.now() - hit.at < TTL) return hit.p;
    const p = (sport.soccer ? loadSoccer(sport) : loadUS(sport)).then(r => { r.loadedAt = Date.now(); for (const g of r.games) { g.status = statusOf(g); analyze(g, sport); } r.games.sort(gameOrder); return r; });
    cache.set(sport.id, { at: Date.now(), p });
    p.catch(() => cache.delete(sport.id));
    return p;
  }
  const RANK = { "in progress": 0, upcoming: 1, listed: 2, past: 3, final: 4 };
  const gameOrder = (a, b) => (RANK[a.status] - RANK[b.status]) || ((a.start || 9e15) - (b.start || 9e15)) || ((a.away.rot || 0) - (b.away.rot || 0));

  /* ---------- analysis: best prices, fair probabilities, edges ---------- */
  const mode = (xs) => { const c = new Map(); for (const x of xs) c.set(x, (c.get(x) || 0) + 1); let best = null, n = 0; for (const [k, v] of c) if (v > n || (v === n && Math.abs(k) < Math.abs(best))) { best = k; n = v; } return best; };
  // Adds to every market: the main line, the fair (no-vig) probability of each side, each quote's
  // probability and edge at its own line, the best price, the lowest-hold book, and an arbitrage check.
  function analyze(g, sport) {
    const sig = O.SIGMA[sport.sigma] || null;
    const model = g.model && g.model.hg != null ? O.soccer(g.model.hg, g.model.ag) : null;
    g.modelGoals = model;
    for (const [k, mk] of Object.entries(g.markets)) {
      const books = Object.entries(mk.books);
      const sides = mk.sides;
      // The line most books quote (for spreads: from the first side's perspective).
      if (k !== "ml") { const ls = books.map(([, q]) => q[sides[0]] && q[sides[0]].line).filter(x => x != null); mk.mainLine = ls.length ? mode(ls) : null; }
      // Fair probability per side: median of each complete book's no-vig split at the main line.
      const fairs = [];
      for (const [b, q] of books) {
        if (!sides.every(s => q[s] && q[s].dec > 1)) continue;
        if (k !== "ml" && q[sides[0]].line !== mk.mainLine) continue;
        q.hold = O.hold(sides.map(s => q[s].dec));
        if (b === "Kalshi" && sport.soccer) continue;
        const nv = O.noVig(sides.map(s => q[s].dec)); if (nv) fairs.push(nv);
      }
      let fair = fairs.length ? sides.map((_, i) => O.median(fairs.map(f => f[i]))) : null;
      if (fair) { const t = fair.reduce((a, b) => a + b, 0); fair = fair.map(x => x / t); }
      mk.fairFrom = fair ? fairs.length + " book" + (fairs.length === 1 ? "" : "s") : null;
      // Soccer result: the books here quote no draw, so the fair split comes from Kalshi's prices, else the model.
      if (k === "ml" && sport.soccer) {
        fair = null; mk.fairFrom = null;
        const kq = g.kalshi;
        if (kq && kq.home && kq.away && kq.tie) {
          const mid = (o) => o.bid && o.ask ? (o.bid + o.ask) / 2 : o.last || o.ask;
          const v = [mid(kq.home), mid(kq.tie), mid(kq.away)];
          if (v.every(x => x > 0)) { const t = v.reduce((a, b) => a + b, 0); fair = v.map(x => x / t); mk.fairFrom = "Kalshi mid prices"; }
        }
        if (!fair && g.model && g.model.home != null) { fair = [g.model.home, g.model.draw, g.model.away]; mk.fairFrom = "Statz model"; }
      }
      mk.fair = fair ? Object.fromEntries(sides.map((s, i) => [s, fair[i]])) : null;
      // Probability of each quote at its own line.
      const probAt = (side, line) => {
        if (k === "ml" || line == null || line === mk.mainLine) {
          const p = mk.fair ? mk.fair[side] : null; if (p == null) return null;
          if (k !== "ml" && line != null && Math.abs(line - Math.round(line)) < 1e-9 && sig) { /* whole line: keep push separate */ const r = lineAt(side, line); if (r) return r; }
          return { win: p, push: 0 };
        }
        return lineAt(side, line);
      };
      const lineAt = (side, line) => {
        if (sport.soccer) {
          if (!model) return null;
          if (k === "total") { const r = model.over(line); return side === "over" ? { win: r.win, push: r.push } : { win: r.lose, push: r.push }; }
          const r = side === "home" ? model.homeHandicap(line) : model.awayHandicap(line); return { win: r.win, push: r.push };
        }
        if (!sig || !mk.fair || mk.mainLine == null) return null;
        if (k === "total") { const mu = O.impliedMean(mk.fair.over, sig.total, mk.mainLine); if (mu == null) return null; const r = O.normalLine(mu, sig.total, line); return side === "over" ? { win: r.win, push: r.push } : { win: r.lose, push: r.push }; }
        // Spread: implied mean margin for the first side (away) from its fair cover probability at the main line.
        const muAway = O.impliedMean(mk.fair[sides[0]], sig.margin, -mk.mainLine); if (muAway == null) return null;
        const r = side === sides[0] ? O.coverProb(muAway, sig.margin, line) : O.coverProb(-muAway, sig.margin, line);
        return { win: r.win, push: r.push };
      };
      // Kalshi's prices are before its trading fee, so a sportsbook's price wins "best" when there is
      // one; Kalshi is best only where no book quotes that outcome (e.g. the soccer draw here).
      mk.best = {};
      for (const s of sides) {
        let best = null, bestEx = null;
        for (const [b, q] of books) {
          const x = q[s]; if (!x) continue;
          const pr = probAt(s, x.line);
          x.p = pr ? pr.win : null; x.push = pr ? pr.push : 0;
          x.edge = pr ? O.edge(pr.win, x.dec, pr.push) : null;
          if (model || (g.model && k === "ml")) {
            const mp = k === "ml" ? (g.model ? g.model[s] : null) : lineAt(s, x.line);
            x.modelP = mp == null ? null : typeof mp === "number" ? mp : mp.win;
            x.modelEdge = x.modelP != null ? O.edge(x.modelP, x.dec, typeof mp === "object" ? mp.push : 0) : null;
          }
          // Best price among quotes at the main line (or any line for moneylines).
          if (k === "ml" || x.line === (s === sides[0] ? mk.mainLine : mainOther(mk, k))) {
            if (b === "Kalshi") { if (!bestEx || x.dec > bestEx.dec) bestEx = { book: b, dec: x.dec, line: x.line, exchange: true }; }
            else if (!best || x.dec > best.dec) best = { book: b, dec: x.dec, line: x.line };
          }
        }
        mk.best[s] = best || bestEx;
      }
      for (const [b, q] of books) for (const s of sides) if (q[s]) q[s].isBest = !!(mk.best[s] && mk.best[s].book === b && Math.abs(mk.best[s].dec - q[s].dec) < 1e-9);
      const bestDecs = sides.map(s => mk.best[s] && !mk.best[s].exchange ? mk.best[s].dec : null);
      mk.arb = bestDecs.every(d => d > 1) ? O.arbitrage(bestDecs) : null;
      const holds = books.filter(([, q]) => q.hold != null).sort((a, b) => a[1].hold - b[1].hold);
      mk.lowestHold = holds.length ? { book: holds[0][0], hold: holds[0][1].hold } : null;
      mk.bookCount = books.length;
    }
  }
  // Spreads quote opposite lines for the two sides (-3 / +3); totals quote the same number.
  const mainOther = (mk, k) => mk.mainLine == null ? null : k === "spread" ? -mk.mainLine : mk.mainLine;

  // Plain-data snapshot of a game for the AI and for saved bets.
  function snapshot(g) {
    const mk = Object.fromEntries(Object.entries(g.markets).map(([k, m]) => [k, { label: m.label, mainLine: m.mainLine ?? null, fairProbability: m.fair, fairFrom: m.fairFrom, best: m.best, books: Object.fromEntries(Object.entries(m.books).map(([b, q]) => [b, Object.fromEntries(m.sides.filter(s => q[s]).map(s => [s, { american: O.fmtAm(q[s].dec), decimal: +q[s].dec.toFixed(3), line: q[s].line, impliedPct: +(100 / q[s].dec).toFixed(1) }]))])), open: m.open, consensus: m.consensus }]));
    return { game: g.away.name + " at " + g.home.name, home: g.home.name, away: g.away.name, start: g.start ? new Date(g.start).toISOString() : null, startKnown: !!g.startHasTime, status: g.status, markets: mk, model: g.model || null, kalshi: g.kalshi ? { home: g.kalshi.home, away: g.kalshi.away, tie: g.kalshi.tie } : null, sources: (g.sources || []).map(s => ({ name: s.name, url: s.url })) };
  }

  MD.bet = { SPORTS, sportOf, load, analyze, snapshot, statusOf, statzFixtures, statzLeaders, parseVegasInsider, parseSportsLine, parseKalshi, parseCell, parseWhen, teamScore, matchGame, mergeGames, bookName, cacheClear: () => cache.clear() };
})(typeof window !== "undefined" ? window : globalThis);
