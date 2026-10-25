/* Player props (NBA points): sportsbook lines from VegasInsider, each player's game logs from ESPN (this season
   and last), a recency-weighted model of the chance of going over the line, the next opponent and injury status
   from ESPN. Every probability is computed here; the AI reads these numbers and the news. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const D = MD.data, O = MD.odds;
  const PROPS_URL = "https://www.vegasinsider.com/nba/odds/player-props/";
  const DFS = new Set(["PrizePicks", "Sleeper", "Underdog"]); // pick'em sites: lines count, prices don't
  const cellsOf = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
  const slug = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const median = (xs) => { const a = xs.slice().sort((x, y) => x - y); return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null; };

  /* VegasInsider props table: one row per player, one column per book, cells like "o28.5 -110". */
  function parseVIProps(text) {
    const t = String(text || ""); let books = null; const out = [];
    const um = t.match(/Updated on (\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    for (const line of t.split(/\r?\n/)) {
      if (!/^\s*\|/.test(line)) continue;
      const c = cellsOf(line);
      if (/^Time$|^Player$/i.test(c[0]) && c.length > 2) { books = c.slice(1); continue; }
      if (!books || /^-+$/.test(c[0]) || /^Filter/i.test(c[0]) || !c[0]) continue;
      const row = { player: c[0], books: {} };
      books.forEach((b, i) => {
        const m = String(c[i + 1] || "").match(/^([ou])\s*(\d+(?:\.\d+)?)\s+([+-]\d+|even)$/i); if (!m) return;
        const am = /even/i.test(m[3]) ? 100 : Number(m[3]), dec = O.amToDec(am);
        row.books[b] = { side: m[1].toLowerCase() === "o" ? "over" : "under", line: Number(m[2]), am, dec, dfs: DFS.has(b) };
      });
      const lines = Object.values(row.books).map(x => x.line); if (!lines.length) continue;
      row.consensusLine = median(lines);
      const priced = Object.entries(row.books).filter(([, x]) => !x.dfs && x.side === "over" && x.line === row.consensusLine);
      const best = priced.reduce((b, [book, x]) => !b || x.dec > b.dec ? Object.assign({ book }, x) : b, null);
      row.bestOver = best; row.bookCount = Object.keys(row.books).length;
      row.lowLine = Math.min(...lines); row.highLine = Math.max(...lines);
      out.push(row);
    }
    return { props: out, books: books || [], updated: um ? new Date(Date.UTC(+(um[3].length === 2 ? "20" + um[3] : um[3]), +um[1] - 1, +um[2])).getTime() : null, url: PROPS_URL };
  }
  async function loadProps(force) { return parseVIProps(await D.fetchRaw(force ? D.bust(PROPS_URL) : PROPS_URL, 60000, 5 * 60e3)); }

  /* ESPN game log: team, season, and regular-season rows (newest first). */
  function parseGameLog(text) {
    const t = String(text || "");
    const team = (t.match(/^# [^\n]+\n+- ([^\n]+)$/m) || [])[1] || null;
    const name = (t.match(/^# ([^\n]+?)(?: \d{4}-\d{2} Stats.*)?$/m) || [])[1] || null;
    let startYear = null, regular = false, hdr = null; const games = [];
    for (const line of t.split(/\r?\n/)) {
      const sm = line.match(/^(\d{4})-(\d{2}) (Regular Season|Preseason|Postseason|Play-?In)/i);
      if (sm) { startYear = +sm[1]; regular = /Regular/i.test(sm[3]); hdr = null; continue; }
      if (!/^\s*\|/.test(line)) continue;
      const c = cellsOf(line);
      if (c[0] === "Date") { hdr = c; continue; }
      if (!hdr || !regular || !startYear) continue;
      const dm = c[0].match(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})\/(\d{1,2})$/); if (!dm) continue;
      const mo = +dm[1], y = mo >= 8 ? startYear : startYear + 1;
      const col = (k) => c[hdr.indexOf(k)];
      const opp = String(col("OPP") || ""), res = String(col("Result") || "");
      const g = { date: y + "-" + String(mo).padStart(2, "0") + "-" + dm[2].padStart(2, "0"), home: /^vs/i.test(opp), opp: opp.replace(/^(vs|@)\s*/i, ""), win: /^W/.test(res), min: Number(col("MIN")) || 0, pts: Number(col("PTS")), reb: Number(col("REB")), ast: Number(col("AST")) };
      if (isFinite(g.pts)) games.push(g);
    }
    games.sort((a, b) => b.date.localeCompare(a.date));
    return { name, team, games };
  }
  const idsKey = "md.espn.nba.ids";
  const idCache = () => { try { return JSON.parse(localStorage.getItem(idsKey) || "{}"); } catch { return {}; } };
  // Find a player's ESPN id with one web search, remembered in this browser.
  async function espnId(name) {
    const k = slug(name), cache = idCache(); if (cache[k]) return cache[k];
    const r = await D.webSearch(name + " ESPN NBA game log", "The player's ESPN NBA game log or player page", 5);
    const hits = [...r.text.matchAll(/espn\.com\/nba\/player\/(?:gamelog\/|stats\/|bio\/)?_\/id\/(\d+)\/([a-z0-9-]+)/g)].map(m => ({ id: m[1], slug: m[2] }));
    const hit = hits.find(x => x.slug === k) || hits.find(x => x.slug.includes(k.split("-").pop())) || null;
    if (!hit) throw new D.DataError("not_found", "Couldn't find " + name + " on ESPN.", "espn");
    cache[k] = hit; try { localStorage.setItem(idsKey, JSON.stringify(cache)); } catch {}
    return hit;
  }
  async function playerLogs(name) {
    const { id, slug: s } = await espnId(name);
    const now = new Date(), seasonEnd = now.getUTCMonth() >= 7 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
    const [cur, prev] = await Promise.all([
      D.fetchRaw("https://www.espn.com/nba/player/gamelog/_/id/" + id + "/" + s, 40000, 30 * 60e3).then(parseGameLog),
      D.fetchRaw("https://www.espn.com/nba/player/gamelog/_/id/" + id + "/type/nba/year/" + (seasonEnd - 1), 40000, 24 * 3600e3).then(parseGameLog).catch(() => ({ games: [] }))]);
    return { id, slug: s, team: cur.team || prev.team, games: cur.games.concat(prev.games), current: cur.games.length, url: "https://www.espn.com/nba/player/gamelog/_/id/" + id + "/" + s };
  }

  /* Model: recency-weighted normal for points (recent games count more, 6% decay per game back), with a floor on
     the spread; plus plain hit rates. For whole-number lines a push is possible and reported. */
  function model(games, line, opts = {}) {
    const g = games.filter(x => x.min > 0).slice(0, opts.n || 40);
    if (g.length < 3) return null;
    let W = 0, S = 0; g.forEach((x, i) => { const w = Math.pow(0.94, i); W += w; S += w * x.pts; });
    const mean = S / W;
    let V = 0; g.forEach((x, i) => { V += Math.pow(0.94, i) * Math.pow(x.pts - mean, 2); });
    const sd = Math.max(Math.sqrt(V / W), 2.5, 0.18 * mean);
    const z = (x) => (x - mean) / sd, Phi = MD.core.normCdf;
    const whole = Number.isInteger(line);
    const pOver = 1 - Phi(z(whole ? line + 0.5 : line)), pPush = whole ? Phi(z(line + 0.5)) - Phi(z(line - 0.5)) : 0;
    const hit = (n) => { const xs = g.slice(0, n); return xs.length ? xs.filter(x => x.pts > line).length / xs.length : null; };
    const avg = (xs, k) => xs.length ? xs.reduce((s, x) => s + x[k], 0) / xs.length : null;
    const home = g.filter(x => x.home), away = g.filter(x => !x.home);
    return { n: g.length, mean, sd, pOver, pUnder: 1 - pOver - pPush, pPush, hit5: hit(5), hit10: hit(10), hit20: hit(20), avg5: avg(g.slice(0, 5), "pts"), avg20: avg(g.slice(0, 20), "pts"), min5: avg(g.slice(0, 5), "min"), min20: avg(g.slice(0, 20), "min"), homeAvg: avg(home, "pts"), awayAvg: avg(away, "pts"), last: g.slice(0, 10).map(x => ({ date: x.date, opp: x.opp, home: x.home, pts: x.pts, min: x.min })) };
  }
  // Model probability against the best sportsbook over price: expected value per unit staked.
  function edge(p, dec) { return p != null && dec > 1 ? p * dec - 1 : null; }

  // Next game for the player's team today (ESPN scoreboard, Eastern date) and the player's injury status.
  async function context(team, name) {
    const B = MD.bet; if (!B || !team) return {};
    const nick = String(team).split(" ").pop();
    const [sb, inj] = await Promise.all([B.scoreboard("nba", B.etYmd()).catch(() => ({ games: [] })), B.injuries("nba").catch(() => ({ list: [] }))]);
    const g = (sb.games || []).find(x => x.home && x.away && (B.teamMatch(x.home.name, nick) || B.teamMatch(x.away.name, nick)));
    const me = (inj.list || []).find(x => slug(x.name) === slug(name));
    const isHome = g ? B.teamMatch(g.home.name, nick) : null;
    return { game: g ? { home: isHome, opponent: isHome ? g.away.name : g.home.name, status: g.status || null, date: g.date || null } : null, injury: me ? { status: me.status, comment: me.comment } : null };
  }

  /* NFL anytime touchdown: one "Yes" price per book. The fair chance is estimated from the median price across
     books with an assumed margin removed (the page shows no "No" prices to de-vig against); a book far from the
     others is flagged as a likely different market (first TD, or a stale line) and left out. */
  const TD_URL = "https://www.vegasinsider.com/nfl/odds/player-props/", TD_MARGIN = 0.05;
  function parseVITD(text) {
    const t = String(text || ""); let books = null; const out = [];
    for (const line of t.split(/\r?\n/)) {
      if (!/^\s*\|/.test(line)) continue;
      const c = cellsOf(line);
      if (/^Time$|^Player$/i.test(c[0]) && c.length > 2) { books = c.slice(1); continue; }
      if (!books || /^-+$/.test(c[0]) || /^Filter/i.test(c[0]) || !c[0]) continue;
      const row = { player: c[0], books: {} };
      books.forEach((b, i) => { const m = String(c[i + 1] || "").match(/^([+-]\d+|even)$/i); if (!m) return; const am = /even/i.test(m[1]) ? 100 : Number(m[1]); const dec = O.amToDec(am); row.books[b] = { am, dec, implied: 1 / dec }; });
      const imps = Object.values(row.books).map(x => x.implied); if (imps.length < 2) continue;
      const med = median(imps);
      for (const x of Object.values(row.books)) x.outlier = Math.abs(x.implied - med) > 0.15;
      const ok = Object.entries(row.books).filter(([, x]) => !x.outlier);
      row.medianImplied = med; row.fair = Math.max(0.01, med * (1 - TD_MARGIN));
      row.best = ok.reduce((b, [book, x]) => !b || x.dec > b.dec ? Object.assign({ book }, x) : b, null);
      row.edge = row.best ? row.fair * row.best.dec - 1 : null;
      row.bookCount = imps.length; row.outliers = Object.entries(row.books).filter(([, x]) => x.outlier).map(([b]) => b);
      out.push(row);
    }
    return { props: out, books: books || [], url: TD_URL, margin: TD_MARGIN };
  }
  async function loadTD(force) { return parseVITD(await D.fetchRaw(force ? D.bust(TD_URL) : TD_URL, 60000, 5 * 60e3)); }

  /* AI prop picks are logged and graded from the player's next game in the ESPN log, so the props AI has a
     track record to calibrate against. */
  function gradePick(pick, games) {
    const g = games.filter(x => x.date >= pick.date).sort((a, b) => a.date.localeCompare(b.date))[0];
    if (!g) return null;
    if (!(g.min > 0)) return { result: "void", pts: g.pts, date: g.date, note: "did not play" };
    const over = g.pts > pick.line, push = g.pts === pick.line;
    return { result: push ? "push" : (pick.side === "over" ? over : !over) ? "hit" : "miss", pts: g.pts, date: g.date };
  }
  function propRecord(list) {
    const g = list.filter(x => x.grade && (x.grade.result === "hit" || x.grade.result === "miss"));
    const hits = g.filter(x => x.grade.result === "hit").length;
    const priced = g.filter(x => x.price > 1);
    return { logged: list.length, graded: g.length, hitPct: g.length ? hits / g.length * 100 : null, avgStatedPct: g.length ? g.reduce((s, x) => s + x.probabilityPct, 0) / g.length : null,
      roiPct: priced.length ? priced.reduce((s, x) => s + (x.grade.result === "hit" ? x.price - 1 : -1), 0) / priced.length * 100 : null, pending: list.filter(x => !x.grade).length };
  }
  async function gradeAll(app) {
    const due = app.store.cached("proppicks").filter(x => !x.grade && x.kind === "nba-points" && x.date < new Date().toISOString().slice(0, 10)).slice(0, 10);
    let n = 0;
    for (const pk of due) { try { const logs = await playerLogs(pk.player); const gr = gradePick(pk, logs.games); if (gr) { await app.store.put("proppicks", pk.id, Object.assign({}, pk, { grade: gr })); n++; } } catch {} }
    return n;
  }

  MD.props = { PROPS_URL, TD_URL, DFS, gradePick, propRecord, gradeAll, parseVIProps, loadProps, parseVITD, loadTD, parseGameLog, espnId, playerLogs, model, edge, context, slug };
})(typeof window !== "undefined" ? window : globalThis);
