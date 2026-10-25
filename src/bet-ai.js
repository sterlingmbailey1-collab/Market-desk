/* Betting AI. Claude forecasts games (one in depth with live news, or a whole slate quickly from the data
   the page already has); the page turns those probabilities into picks and ready-made slips, logs every
   first forecast per game, grades it from ESPN final scores, and keeps the track record. The betting
   assistant is a chat with the same data as tools. Nothing here places a bet. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const U = MD.ui, O = MD.odds, B = MD.bet, h = U.h;
  const num = (x) => { const n = Number(x); return x == null || x === "" || !isFinite(n) ? null : n; };
  const pct = (p, dp = 0) => p == null || !isFinite(p) ? "—" : (p * 100).toFixed(dp) + "%";
  const title = (g) => g.soccer ? g.home.name + " vs " + g.away.name : g.away.name + " at " + g.home.name;
  const sideName = (g, s) => s === "home" ? g.home.name : s === "away" ? g.away.name : s === "draw" ? "Draw" : s === "over" ? "Over" : "Under";
  const cache = (app) => app._betAI || (app._betAI = new Map());
  const SAMPLE_ERR = { not_granted: "Claude access was declined for this page.", rate_limited: "You've hit a usage limit. Try again in a few minutes.", tools_unavailable: "This view can't run research tools. Open the page on claude.ai.", no_sample: "Claude isn't available in this view. Open the page on claude.ai.", invalid_json: "The AI's answer came back unreadable. Try again." };
  const errText = (e) => SAMPLE_ERR[e && e.code] || (e && e.message) || "The AI didn't finish.";

  /* ---------- what the AI sees about a game ---------- */
  function injuryLines(list, n = 8) { return (list || []).slice(0, n).map(p => p.name + " (" + p.pos + ") " + p.status + (p.comment ? ": " + p.comment.replace(/\s+/g, " ").slice(0, 150) : "")); }
  function gameContext(g) {
    const snap = B.snapshot(g);
    return Object.assign({ id: g.id }, snap, {
      espn: g.espn ? { date: g.espn.date, venue: g.espn.venue, temperatureF: g.espn.tempF, awayRecord: g.espn.away.record, awaySplit: g.espn.away.split ? g.espn.away.split + " " + (g.espn.away.splitKind || "") : null, homeRecord: g.espn.home.record, homeSplit: g.espn.home.split ? g.espn.home.split + " " + (g.espn.home.splitKind || "") : null } : null,
      injuries: g.injuries ? { away: injuryLines(g.injuries.away), home: injuryLines(g.injuries.home), source: g.injuries.url } : "no injury report read for this league"
    });
  }
  // How much the page itself knows about the game, 0-100 (shown as "data coverage").
  function coverage(g) {
    let s = 0, why = [];
    const books = Math.max(0, ...Object.values(g.markets).map(m => m.bookCount || 0));
    s += Math.min(35, books * 6); why.push(books + " book" + (books === 1 ? "" : "s"));
    if (g.markets.ml && g.markets.ml.fair) { s += 15; why.push("fair line"); }
    if (g.injuries) { s += 20; why.push("injury report"); } else if (g.soccer) { s += 5; }
    if (g.espn) { s += 15; why.push("records"); }
    if (g.model) { s += 15; why.push("Statz model"); }
    return { score: Math.min(100, s), why };
  }
  function normProbs(raw, soccer) {
    const keys = soccer ? ["home", "draw", "away"] : ["home", "away"];
    const v = Object.fromEntries(keys.map(k => [k, Math.max(0, num(raw && raw[k]) || 0)]));
    const t = keys.reduce((a, k) => a + v[k], 0);
    return t > 0 ? Object.fromEntries(keys.map(k => [k, v[k] / t])) : null;
  }
  // Combined confidence = the AI's own confidence, the page's data coverage, and agreement with the market.
  function finishForecast(g, raw, mode, sources, steps) {
    const probs = normProbs(raw.probabilities, g.soccer);
    if (!probs) throw Object.assign(new Error("The AI gave no usable probabilities."), { code: "invalid_json" });
    const winner = Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0];
    const fair = g.markets.ml && g.markets.ml.fair ? g.markets.ml.fair : g.model ? { home: g.model.home, draw: g.model.draw, away: g.model.away } : null;
    const gap = fair ? Math.max(...Object.keys(probs).map(k => Math.abs(probs[k] - (fair[k] || 0)))) : null;
    const agreement = gap == null ? 50 : Math.round(Math.max(0, 1 - gap / 0.25) * 100);
    const cov = coverage(g), aiConf = Math.max(0, Math.min(100, num(raw.confidence) ?? 50));
    const confidence = Math.round(0.5 * aiConf + 0.3 * cov.score + 0.2 * agreement);
    const retrieved = new Set((sources || []).map(s => String(s.url).replace(/[#?].*$/, "").replace(/\/$/, "")));
    const ver = (u) => !!u && retrieved.has(String(u).replace(/[#?].*$/, "").replace(/\/$/, ""));
    const ps = raw.predictedScore || {};
    return {
      at: Date.now(), mode, gameId: g.id, probs, winner, fair, gap,
      predicted: num(ps.home) != null && num(ps.away) != null ? { home: num(ps.home), away: num(ps.away) } : null,
      confidence, parts: { ai: aiConf, coverage: cov.score, coverageWhy: cov.why, agreement },
      why: raw.confidenceWhy || raw.reason || "", summary: raw.summary || raw.reason || "",
      factors: (raw.keyFactors || []).map(f => Object.assign({}, f, { verified: ver(f.source_url) })),
      injuryImpact: raw.injuryImpact || "", form: raw.form || "", upsetRisk: raw.upsetRisk || "", market: raw.marketComparison || "",
      bestBet: raw.bestBet && raw.bestBet.market && raw.bestBet.market !== "none" ? raw.bestBet : null,
      spreadAway: num(raw.spreadCoverAwayPct) != null ? num(raw.spreadCoverAwayPct) / 100 : null,
      over: num(raw.overPct) != null ? num(raw.overPct) / 100 : null,
      risks: raw.risks || [], gaps: raw.dataGaps || [], sources: sources || [], steps: steps || []
    };
  }
  const RULES = `Rules: never invent injuries, results, statistics or sources; cite only URLs your tools returned. Betting markets are efficient: start from the fair (no-vig) probabilities and move away from them only as far as concrete evidence justifies; a 2-4 point disagreement is a lot. Use the injury report (who is out matters far more than who is questionable), records and home/away splits, rest and travel, weather for outdoor games, and the model when given. Confidence (0-100) is how sure you are of YOUR probabilities, not how likely the favourite is: lower it when lineups or injuries are unclear. "No bet" is a valid best bet.`;
  const SHAPE = `{"probabilities": {"home": 0-100, "away": 0-100, "draw": 0-100 or null}, "predictedScore": {"home": number, "away": number}, "confidence": 0-100, "confidenceWhy": "1 sentence", "summary": "3-4 sentences on the most likely result and why", "keyFactors": [{"factor": "...", "favors": "home|away|draw|over|under|none", "impact": "high|medium|low", "source_url": "https://... or empty"}], "injuryImpact": "1-2 sentences", "form": "1-2 sentences", "upsetRisk": "1 sentence", "marketComparison": "how your view differs from the fair line", "spreadCoverAwayPct": 0-100 or null, "overPct": 0-100 or null, "bestBet": {"market": "ml|spread|total|none", "side": "home|away|draw|over|under|none", "reason": "..."}, "risks": ["..."], "dataGaps": ["..."]}`;

  /* ---------- one game, in depth ---------- */
  async function forecastGame(app, g, sport, opts = {}) {
    const s = app.caps.sample; if (!s) throw Object.assign(new Error(SAMPLE_ERR.no_sample), { code: "no_sample" });
    const lim = await s.limits().catch(() => null);
    if (!lim || !lim.tools) throw Object.assign(new Error(SAMPLE_ERR.tools_unavailable), { code: "tools_unavailable" });
    const ctx = { app, asset: null, question: title(g) + " " + sport.name + " preview", log: [], sources: [], stats: {}, onLog: opts.onLog };
    const tools = MD.research.makeTools(ctx).filter(t => ["search_web", "read_page", "search_news"].includes(t.name));
    const raw = await s.json(`Today is ${new Date().toISOString().slice(0, 10)}. You are a careful sports betting analyst. Forecast the most likely result of this ${sport.name} game.
Data read by the app (authoritative for prices, injuries and records): ${JSON.stringify(gameContext(g)).slice(0, 16000)}
Research with the tools (2 to 5 searches): the latest injury and lineup news (starting quarterback/pitcher/goalie where relevant), recent form over the last 5 games, rest and travel, weather if outdoors, and motivation or schedule spot.
${RULES}
Reply with ONLY JSON: ${SHAPE}`, { modelTier: "complex", tools, signal: opts.signal });
    const f = finishForecast(g, raw, "deep", ctx.sources, ctx.log);
    cache(app).set(g.id, f);
    await logPicks(app, [[g, f]]);
    return f;
  }

  /* ---------- a whole slate, quickly ---------- */
  async function forecastSlate(app, r, opts = {}) {
    const s = app.caps.sample; if (!s) throw Object.assign(new Error(SAMPLE_ERR.no_sample), { code: "no_sample" });
    const games = r.games.filter(g => g.status !== "final" && g.status !== "past" && Object.keys(g.markets).length).slice(0, 14);
    if (!games.length) throw new Error("No upcoming games with odds to forecast.");
    const lite = games.map(g => { const c = gameContext(g); return { id: g.id, game: c.game, start: c.start, fair: Object.fromEntries(Object.entries(c.markets).map(([k, m]) => [k, { line: m.mainLine, fair: m.fairProbability }])), espn: c.espn, injuries: c.injuries, model: c.model }; });
    const raw = await s.json(`Today is ${new Date().toISOString().slice(0, 10)}. You are a careful sports betting analyst. For each ${r.sport.name} game below, forecast the most likely result from the data given (no browsing in this quick pass).
Games: ${JSON.stringify(lite).slice(0, 30000)}
${RULES}
Reply with ONLY JSON: {"games": [{"id": "the game id exactly as given", "probabilities": {"home": 0-100, "away": 0-100, "draw": 0-100 or null}, "predictedScore": {"home": number, "away": number}, "confidence": 0-100, "reason": "1-2 sentences", "spreadCoverAwayPct": 0-100 or null, "overPct": 0-100 or null}]}`, { modelTier: "default", signal: opts.signal });
    const out = [];
    for (const x of (raw && raw.games) || []) {
      const g = games.find(y => y.id === x.id); if (!g) continue;
      try {
        const f = finishForecast(g, x, "quick", [], []);
        const prev = cache(app).get(g.id);
        if (!prev || prev.mode !== "deep") cache(app).set(g.id, f);
        out.push([g, cache(app).get(g.id)]);
      } catch {}
    }
    await logPicks(app, out);
    return out;
  }

  /* ---------- pick log and track record ---------- */
  // The FIRST forecast for each game is the one that counts: later runs never replace it.
  async function logPicks(app, pairs) {
    if (app.demo || !app.store) return;
    const have = new Set(app.store.cached("betpicks").map(p => p.gameId));
    for (const [g, f] of pairs) {
      if (!f || have.has(g.id) || g.status === "final" || g.status === "past") continue;
      const best = g.markets.ml && g.markets.ml.best ? g.markets.ml.best[f.winner] : null;
      have.add(g.id);
      try { await app.store.create("betpicks", { gameId: g.id, sport: g.sport, game: title(g), home: g.home.name, away: g.away.name, soccer: !!g.soccer, start: g.start || null, startDate: g.espn && g.espn.date || (g.start ? B.etYmd(g.start) : null), pick: f.winner, pickName: sideName(g, f.winner), p: f.probs[f.winner], fairP: f.fair ? f.fair[f.winner] ?? null : null, confidence: f.confidence, mode: f.mode, bestDec: best ? best.dec : null, bestBook: best ? best.book : null, at: Date.now() }); } catch {}
    }
  }
  const graded = (app) => { const m = new Map(); for (const x of app.store.cached("betgrades")) m.set(x.pickId, x); return m; };
  async function gradePicks(app) {
    const picks = app.store.cached("betpicks"), done = graded(app);
    const due = picks.filter(p => !done.has(p.id) && p.start && Date.now() > p.start + 3 * 3600e3);
    const boards = new Map(); let n = 0;
    for (const p of due) {
      const key = p.sport + "|" + (p.startDate || "");
      if (!boards.has(key)) boards.set(key, B.scoreboard(p.sport, p.startDate).then(r => r.games).catch(() => []));
      const games = await boards.get(key);
      const e = B.findEspn({ home: { name: p.home }, away: { name: p.away } }, games);
      const res = e ? B.gradeLeg({ market: "ml", side: p.pick, line: null, dec: p.bestDec || 2, home: p.home, away: p.away, soccer: p.soccer }, e) : null;
      if (!res) continue;
      await app.store.create("betgrades", { pickId: p.id, gameId: p.gameId, result: res.result === "push" ? "push" : res.mult > 0 ? "hit" : "miss", score: res.score, at: Date.now(), source: B.scoreboardUrl(B.sportOf(p.sport), p.startDate) });
      n++;
    }
    return { checked: due.length, graded: n };
  }
  function record(app) {
    const picks = app.store.cached("betpicks"), done = graded(app);
    const rows = picks.map(p => Object.assign({}, p, { grade: done.get(p.id) || null })).sort((a, b) => (b.start || b.at) - (a.start || a.at));
    const g = rows.filter(r => r.grade && r.grade.result !== "push");
    const hits = g.filter(r => r.grade.result === "hit").length;
    const brier = g.length ? g.reduce((a, r) => a + Math.pow((r.grade.result === "hit" ? 1 : 0) - r.p, 2), 0) / g.length : null;
    const roiRows = g.filter(r => r.bestDec > 1);
    const roi = roiRows.length ? roiRows.reduce((a, r) => a + (r.grade.result === "hit" ? r.bestDec - 1 : -1), 0) / roiRows.length : null;
    const buckets = [[0, 0.5], [0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 1.01]].map(([lo, hi]) => { const b = g.filter(r => r.p >= lo && r.p < hi); return { label: Math.round(lo * 100) + "–" + Math.min(100, Math.round(hi * 100)) + "%", n: b.length, expected: b.length ? b.reduce((a, r) => a + r.p, 0) / b.length : null, actual: b.length ? b.filter(r => r.grade.result === "hit").length / b.length : null }; });
    return { rows, graded: g.length, hits, hitRate: g.length ? hits / g.length : null, avgP: g.length ? g.reduce((a, r) => a + r.p, 0) / g.length : null, brier, roi, buckets, pending: rows.filter(r => !r.grade).length };
  }

  /* ---------- picks and ready-made slips (built by the page) ---------- */
  // Every price the page can back with a probability: AI forecast first, else the market's fair line, else the model.
  function candidates(app, r) {
    const out = [], fc = cache(app);
    for (const g of r.games) {
      if (g.status === "final" || g.status === "past" || g.status === "in progress") continue;
      const f = fc.get(g.id);
      for (const [k, mk] of Object.entries(g.markets)) {
        for (const side of mk.sides) {
          const b = mk.best && mk.best[side]; if (!b || b.exchange) continue;
          const q = mk.books[b.book][side];
          let p = null, src = null;
          if (f) { if (k === "ml" && f.probs[side] != null) { p = f.probs[side]; src = "AI"; } else if (k === "spread" && f.spreadAway != null && b.line === (side === "away" ? mk.mainLine : -mk.mainLine)) { p = side === "away" ? f.spreadAway : 1 - f.spreadAway; src = "AI"; } else if (k === "total" && f.over != null && b.line === mk.mainLine) { p = side === "over" ? f.over : 1 - f.over; src = "AI"; } }
          if (p == null && q.p != null) { p = q.p; src = "market"; }
          if (p == null && q.modelP != null) { p = q.modelP; src = "model"; }
          if (p == null) continue;
          out.push({ g, k, side, book: b.book, dec: b.dec, line: b.line, p, push: q.push || 0, src, edge: O.edge(p, b.dec, q.push || 0), conf: f ? f.confidence : null, label: (k === "ml" ? sideName(g, side) + (g.soccer && side !== "draw" ? " to win" : side === "draw" ? "" : " ML") : k === "total" ? sideName(g, side) + " " + b.line : sideName(g, side) + " " + (b.line > 0 ? "+" : "") + b.line) });
        }
      }
    }
    return out;
  }
  function slip(name, blurb, legs) {
    if (legs.length < 2) return null;
    const pr = O.parlay(legs.map(l => ({ dec: l.dec, p: l.p })));
    return { name, blurb, legs, dec: pr.dec, p: pr.p, edge: pr.edge };
  }
  const onePerGame = (xs) => { const seen = new Set(); return xs.filter(x => !seen.has(x.g.id) && seen.add(x.g.id)); };
  function buildSlips(app, r) {
    const c = candidates(app, r);
    const safest = slip("Safest", "The three most likely results on the board, one per game. Low payout by design.", onePerGame(c.filter(x => x.p >= 0.6).sort((a, b) => b.p - a.p)).slice(0, 3));
    const value = slip("Value", "Prices that pay more than the estimated chance justifies.", onePerGame(c.filter(x => x.edge >= 0.02).sort((a, b) => b.edge - a.edge)).slice(0, 3));
    const balanced = slip("Balanced", "Likely results (50–72%) at fair-or-better prices, ranked by expected return.", onePerGame(c.filter(x => x.p >= 0.5 && x.p <= 0.72 && x.edge >= -0.02).sort((a, b) => b.p * b.dec - a.p * a.dec)).slice(0, 3));
    const fc = cache(app);
    const upsets = c.filter(x => x.k === "ml" && x.src === "AI" && x.dec >= 2.2 && fc.get(x.g.id) && fc.get(x.g.id).fair && x.p - (fc.get(x.g.id).fair[x.side] || 0) >= 0.04).sort((a, b) => b.edge - a.edge).slice(0, 4);
    const singles = onePerGame(c.slice().sort((a, b) => (b.conf ?? 0) - (a.conf ?? 0) || b.p - a.p)).filter(x => x.p >= 0.55).slice(0, 6);
    return { slips: [safest, balanced, value].filter(Boolean), upsets, singles, candidates: c };
  }

  /* ---------- the betting assistant ---------- */
  function assistantTools(app, ctx, getCtx) {
    const kit = MD.advisorKit;
    const base = MD.research.makeTools(ctx).filter(t => ["search_web", "read_page", "search_news"].includes(t.name));
    const adv = kit ? kit.advisorTools(app, ctx).filter(t => ["get_betting_odds", "bet_math", "get_my_bets"].includes(t.name)) : [];
    const step = (text) => { const e = { at: Date.now(), kind: "run", text }; ctx.log.push(e); ctx.onLog && ctx.onLog(e); return e; };
    const wrap = (label, fn) => async (i) => { const e = step(label(i || {})); try { const r = await fn(i || {}); e.kind = "ok"; return r; } catch (err) { e.kind = "fail"; throw new Error(U.errorText(err)); } };
    const leagues = B.SPORTS.map(x => x.id);
    const findGame = async (league, team) => { const r = await B.load(league); const t = String(team || ""); const g = r.games.find(x => B.teamMatch(x.home.name, t) || B.teamMatch(x.away.name, t)) || r.games.find(x => title(x).toLowerCase().includes(t.toLowerCase())); if (!g) throw new Error("No " + B.sportOf(league).name + " game found for " + team + "."); return { r, g }; };
    return [...base, ...adv,
      { name: "get_injuries", description: "ESPN injury report for one US league (NFL, NBA, WNBA, MLB, NHL), optionally filtered to a team: player, position, status (Out, Doubtful, Questionable…), expected return and the latest note.", inputSchema: { type: "object", properties: { league: { type: "string", enum: ["nfl", "nba", "wnba", "mlb", "nhl"] }, team: { type: "string" } }, required: ["league"] },
        execute: wrap((i) => "Injuries: " + i.league + (i.team ? " · " + i.team : ""), async (i) => { const r = await B.injuries(i.league); const list = i.team ? B.injuriesFor(r.list, i.team) : r.list.slice(0, 60); return { source: r.url, count: list.length, players: list.map(p => ({ team: p.team, player: p.name, pos: p.pos, status: p.status, returns: p.returns, note: p.comment.slice(0, 200) })) }; }) },
      { name: "get_scoreboard", description: "ESPN scoreboard for one league (today, or a date for NBA/NHL/MLB/WNBA/college basketball): teams with records and home/away splits, venue, temperature, live/final status and scores.", inputSchema: { type: "object", properties: { league: { type: "string", enum: leagues }, date: { type: "string", description: "YYYY-MM-DD (optional)" } }, required: ["league"] },
        execute: wrap((i) => "Scoreboard: " + i.league + (i.date ? " " + i.date : ""), async (i) => { const r = await B.scoreboard(i.league, i.date); return { source: r.url, games: r.games.slice(0, 20).map(e => ({ date: e.date, teams: e.teams.map(t => ({ team: t.name, record: t.record, split: t.split ? t.split + " " + (t.splitKind || "") : null, score: t.total })), status: e.status, venue: e.venue, temperatureF: e.tempF })) }; }) },
      { name: "get_game_forecast", description: "The AI forecast already made on this page for a game (probabilities, predicted score, confidence and its parts, key factors), if any. Use it before giving your own view.", inputSchema: { type: "object", properties: { league: { type: "string", enum: leagues }, team: { type: "string" } }, required: ["league", "team"] },
        execute: wrap((i) => "Saved forecast: " + i.team, async (i) => { const { g } = await findGame(i.league, i.team); const f = cache(app).get(g.id); return f ? { game: title(g), mode: f.mode, probabilitiesPct: Object.fromEntries(Object.entries(f.probs).map(([k, v]) => [k, +(v * 100).toFixed(1)])), predictedScore: f.predicted, confidence: f.confidence, confidenceParts: f.parts, summary: f.summary, factors: f.factors.slice(0, 6) } : { game: title(g), forecast: null, note: "No forecast yet; the user can run one from the game page or the AI picks tab." }; }) },
      { name: "build_slips", description: "Ready-made slips the page builds for a league from the forecasts and fair probabilities: Safest, Balanced and Value parlays with combined chance and payout, upset candidates and top singles.", inputSchema: { type: "object", properties: { league: { type: "string", enum: leagues } }, required: ["league"] },
        execute: wrap((i) => "Build slips: " + i.league, async (i) => { const r = await B.load(i.league); const s = buildSlips(app, r); const leg = (x) => ({ bet: x.label, game: title(x.g), book: x.book, american: O.fmtAm(x.dec), chancePct: +(x.p * 100).toFixed(1), from: x.src, edgePct: +(x.edge * 100).toFixed(1) }); return { slips: s.slips.map(x => ({ name: x.name, legs: x.legs.map(leg), parlayAmerican: O.fmtAm(x.dec), chancePct: x.p != null ? +(x.p * 100).toFixed(1) : null, edgePct: x.edge != null ? +(x.edge * 100).toFixed(1) : null })), upsets: s.upsets.map(leg), topSingles: s.singles.map(leg), forecastsAvailable: r.games.filter(g => cache(app).has(g.id)).length }; }) },
      { name: "get_slip", description: "What is on the user's bet slip right now.", inputSchema: { type: "object", properties: {} },
        execute: wrap(() => "Read bet slip", async () => ({ legs: MD.betting.slip(app).map(l => ({ pick: l.pick, game: l.game, book: l.book, american: O.fmtAm(l.dec), chancePct: (l.aiP ?? l.p ?? l.modelP) != null ? +(((l.aiP ?? l.p ?? l.modelP)) * 100).toFixed(1) : null })) })) },
      { name: "add_to_slip", description: "Put a bet on the user's bet slip (a worksheet in this page; it does NOT place a bet) at the best available sportsbook price. market: ml (moneyline/match result), spread, total. side: home, away, draw, over or under. Tell the user what you added.", inputSchema: { type: "object", properties: { league: { type: "string", enum: leagues }, team: { type: "string", description: "Either team in the game" }, market: { type: "string", enum: ["ml", "spread", "total"] }, side: { type: "string", enum: ["home", "away", "draw", "over", "under"] } }, required: ["league", "team", "market", "side"] },
        execute: wrap((i) => "Add to slip: " + i.team + " " + i.market + " " + i.side, async (i) => { const { g } = await findGame(i.league, i.team); const mk = g.markets[i.market]; if (!mk || !mk.best || !mk.best[i.side]) throw new Error("No price for that bet."); const leg = MD.betting.legOf(g, i.market, i.side, mk.best[i.side].book); const f = cache(app).get(g.id); if (f && i.market === "ml" && f.probs[i.side] != null) leg.aiP = f.probs[i.side]; MD.betting.addLeg(app, leg); return { added: leg.pick, game: leg.game, book: leg.book, american: O.fmtAm(leg.dec), slipSize: MD.betting.slip(app).length }; }) },
      { name: "get_ai_track_record", description: "How the page's AI game picks have done: graded picks, hit rate versus the average stated chance, Brier score, return at the best price, and calibration by confidence band.", inputSchema: { type: "object", properties: {} },
        execute: wrap(() => "AI pick record", async () => { const r = record(app); return { graded: r.graded, hitRatePct: r.hitRate != null ? +(r.hitRate * 100).toFixed(1) : null, avgStatedChancePct: r.avgP != null ? +(r.avgP * 100).toFixed(1) : null, brier: r.brier != null ? +r.brier.toFixed(3) : null, roiPerPickPct: r.roi != null ? +(r.roi * 100).toFixed(1) : null, pending: r.pending, calibration: r.buckets.filter(b => b.n).map(b => ({ band: b.label, picks: b.n, expectedPct: +(b.expected * 100).toFixed(1), actualPct: +(b.actual * 100).toFixed(1) })) }; }) }
    ];
  }
  const QUICK = ["What's the most likely result of each game today, and how sure are you?", "Build me a safe 3-leg parlay and put it on my slip", "Which injuries matter most this week?", "Is there any real value on the board, or should I pass?", "How has the AI's track record been?", "Explain this game's spread like I'm new to betting"];
  function assistant(app, getCtx) {
    const s = app.caps.sample;
    const turns = app._betTurns || (app._betTurns = []);
    const chat = h("div", { class: "chat betchat" }), log = h("div", { class: "log" });
    const input = h("textarea", { placeholder: "Ask about a game, a pick, odds or your bets…", style: "min-height:64px", "aria-label": "Message the betting assistant" });
    const send = h("button", { class: "btn", type: "button" }, "Send");
    const paint = () => { chat.replaceChildren(...turns.map(t => h("div", { class: t.role === "user" ? "msg-u" : "msg-a" }, t.content)), turns.length ? null : h("div", { class: "empty" }, "Ask anything about the board. The assistant reads the same odds, injuries, scores and forecasts you see, and it can put bets on your slip.")); chat.scrollTop = chat.scrollHeight; };
    paint();
    send.onclick = async () => {
      const text = input.value.trim(); if (!text) return;
      if (!s) { chat.append(U.errorBox({ message: SAMPLE_ERR.no_sample })); return; }
      const c = getCtx ? getCtx() : {};
      turns.push({ role: "user", content: text }); input.value = ""; paint();
      const bubble = h("div", { class: "msg-a" }, "Thinking…"); chat.append(bubble); send.disabled = true;
      const ctx = { app, asset: null, question: text, log: [], sources: [], stats: {}, onLog: (e) => log.append(h("div", { class: e.kind }, e.text)) };
      const P = Object.assign({ bankroll: 1000, kelly: 0.25 }, app.settings.betting || {});
      const sys = `You are Market Desk's sports betting assistant for one person. Today is ${new Date().toISOString().slice(0, 10)}. The user is viewing: ${c.league ? B.sportOf(c.league).name : "the betting board"}${c.game ? ", game " + c.game : ""}. Bet slip: ${MD.betting.slip(app).length} leg(s). Bankroll setting $${P.bankroll}, ${Math.round(P.kelly * 100)}% Kelly.
Use the tools for every price, injury, score, probability and calculation; never invent them. Leagues: ${B.SPORTS.map(x => x.id + "=" + x.name).join(", ")}.
${RULES}
When asked for the most likely result, give the probability and a confidence level, and say what would change your mind. Parlays multiply the bookmaker's margin; say so when building them. Suggest small stakes (about 1-2% of bankroll) and never chasing losses. If the user shows signs of problem gambling, kindly point to 1-800-GAMBLER (US) or BeGambleAware (UK). You can put bets on the slip with add_to_slip, but you never place bets. Plain text, short paragraphs.`;
      try {
        const r = await s([{ role: "user", content: sys }, ...turns.slice(-12)], { cache: false, tools: assistantTools(app, ctx, getCtx), onText: ({ text: t }) => { bubble.textContent = t; } });
        turns.push({ role: "assistant", content: r.text }); paint();
      } catch (e) { turns.pop(); paint(); chat.append(U.errorBox({ message: errText(e) })); input.value = text; }
      send.disabled = false;
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); if (!send.disabled) send.click(); } });
    return h("div", { class: "stack betassist" }, chat,
      h("div", { class: "row", style: "gap:6px" }, QUICK.map(q => h("button", { class: "chip", type: "button", onclick: () => { input.value = q; input.focus(); } }, q))),
      input, h("div", { class: "row between" }, h("span", { class: "tiny muted" }, "Enter to send · reads live odds, ESPN injuries and scores, news and your bets · never places bets"), h("div", { class: "row" }, h("button", { class: "btn ghost sm", type: "button", onclick: () => { turns.length = 0; log.replaceChildren(); paint(); } }, "Clear"), send)),
      h("details", {}, h("summary", { class: "label" }, "Tool activity"), log));
  }

  MD.betAI = { forecastGame, forecastSlate, finishForecast, coverage, gameContext, logPicks, gradePicks, record, candidates, buildSlips, assistant, assistantTools, cache, errText, title, sideName };
})(typeof window !== "undefined" ? window : globalThis);
