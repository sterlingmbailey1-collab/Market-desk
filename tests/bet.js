// Parser and analysis checks for the betting data layer (Node). Usage: node tests/bet.js
globalThis.Decimal = require("../vendor/decimal.js");
require("../src/core.js"); require("../src/odds.js"); require("./bet-fixtures.js");
const F = globalThis.__betFixtures;
const calls = [];
globalThis.MD.data = {
  connector: (server) => ({ async call(tool, input) { calls.push([server, tool, input]); if (tool === "get_upcoming_fixtures") return F.statz(input.competition); if (tool === "get_match_leaders") return F.leaders(input.fixture_id); throw new Error("no"); } }),
  async fetchRaw(url) { calls.push(["exa", url]); let e = url.match(/espn\.com\/(.+?)\/(scoreboard|injuries)/); if (e) return e[2] === "injuries" ? F.espnInjuries(e[1]) : F.espnScoreboard(url.includes("soccer") ? "soccer" : e[1]); if (/vegasinsider\.com\/(\w[\w-]*)\//.test(url)) return F.vi(url.match(/vegasinsider\.com\/([\w-]+)\//)[1]); let m = url.match(/sportsline\.com\/([\w-]+)\/odds\/(money-line\/|over-under\/)?/); if (m) return F.sl(m[1], m[2] === "money-line/" ? "ml" : m[2] === "over-under/" ? "total" : "spread"); m = url.match(/series_ticker=(\w+)/); if (m) return F.kalshi(m[1]); throw new Error("unmocked " + url); },
  bust: (u) => u + "?_=1", DataError: class extends Error { constructor(c, m) { super(m); this.code = c; } }
};
require("../src/betting.js");
const B = globalThis.MD.bet, O = globalThis.MD.odds;
let fail = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };
(async () => {
  const vi = B.parseVegasInsider(F.vi("nfl"), B.sportOf("nfl"));
  ok(vi.games.length === 4, "VegasInsider: 4 games parsed (" + vi.games.length + ")");
  const g0 = vi.games[0];
  ok(g0.away.name === "Steelers" && g0.home.name === "Saints", "away/home from rotation pairs");
  ok(Object.keys(g0.markets).sort().join() === "ml,spread,total", "three markets per game: " + Object.keys(g0.markets));
  ok(g0.markets.spread.books.DraftKings.away.line === -3 && Math.abs(g0.markets.spread.books.DraftKings.away.dec - O.amToDec(-112)) < 1e-9, "spread line and price per book");
  ok(g0.markets.total.books.FanDuel.over.line === 43.5 && g0.markets.total.books.FanDuel.under, "total over/under per book");
  ok(g0.markets.ml.books["Hard Rock"].home.dec > 1 && g0.markets.ml.books.Kalshi, "moneyline incl. Hard Rock and Kalshi columns");
  ok(g0.markets.spread.open.away.line === -1.5 && g0.markets.spread.consensus.home.line === 3, "open and consensus kept apart from books");
  ok(vi.games[3].final === true, "Final games flagged");
  ok(!vi.games[3].markets.ml.books.DraftKings, "N/A cells skipped");
  ok(vi.books.includes("Hard Rock") && vi.books.length === 8, "book list from header: " + vi.books.join(","));
  const nba = B.parseVegasInsider(F.vi("nba"), B.sportOf("nba")); ok(nba.games[0].dateLabel && nba.games[0].start, "date header gives a game date (" + nba.games[0].dateLabel + ")");

  const r = await B.load("nfl", true);
  const g2 = r.games.find(g => g.away.name === "Dolphins");
  const ml = g2.markets.ml;
  ok(ml.best.away.book === "DraftKings" && ml.books.DraftKings.away.isBest, "best price marked (DraftKings +215)");
  ok(ml.fair && Math.abs(ml.fair.away + ml.fair.home - 1) < 1e-9, "fair probabilities sum to 1");
  ok(ml.books.DraftKings.away.edge > 0.05, "off-market price shows a positive edge: " + (ml.books.DraftKings.away.edge * 100).toFixed(1) + "%");
  ok(ml.arb && ml.arb.arb, "best prices across books form an arbitrage (" + ml.arb.profitPct.toFixed(2) + "%)");
  const sp = r.games[0].markets.spread;
  ok(sp.mainLine === -3, "main spread line is the most common (" + sp.mainLine + ")");
  const alt = sp.books.bet365.away; ok(alt.line === -3.5 && alt.p != null && alt.p < sp.fair.away, "alternate line (-3.5) probability from the normal model is lower than at -3: " + alt.p.toFixed(3));
  ok(sp.books.DraftKings.away.push > 0, "whole-number line carries a push probability");
  ok(r.games[r.games.length - 1].status === "final", "final games sort last");

  const s = await B.load("laliga", true);
  const bar = s.games.find(g => /Barcelona/.test(g.home.name + g.away.name));
  ok(bar && bar.home.name === "Barcelona", "Statz orients home/away (SportsLine listed Real Madrid first): home=" + (bar && bar.home.name));
  ok(Math.abs(bar.markets.ml.books.Caesars.home.dec - O.amToDec(-150)) < 1e-9 && Math.abs(bar.markets.ml.books.Caesars.away.dec - O.amToDec(275)) < 1e-9, "Caesars prices follow the teams when sides are swapped");
  const ath0 = s.games.find(g => g.home.name === "Athletic Club"); ok(Math.abs(ath0.markets.ml.books.FanDuel.away.dec - O.amToDec(550)) < 1e-9 && Math.abs(ath0.markets.ml.books.FanDuel.home.dec - O.amToDec(-180)) < 1e-9, "away row and home row prices kept apart");
  ok(bar.model && Math.abs(bar.model.home - 0.5732) < 1e-9 && bar.model.fixtureId === 19732648, "Statz model attached");
  ok(bar.kalshi && /Barcelona/.test(bar.kalshi.home.name), "Kalshi market matched: " + (bar.kalshi && bar.kalshi.home.name));
  ok(bar.markets.ml.books.Kalshi.draw && bar.markets.ml.fairFrom === "Kalshi mid prices", "draw from Kalshi; fair from Kalshi mids");
  ok(bar.markets.ml.books.FanDuel.home.modelP === bar.model.home, "model probability on each result quote");
  const ath = s.games.find(g => g.home.name === "Athletic Club"); ok(ath && ath.kalshi && /Bilbao/.test(ath.kalshi.home.name), "alias: Kalshi 'Bilbao' = Athletic Club");
  const tot = ath.markets.total; ok(tot.books.Caesars.over.modelP > 0 && tot.books.Caesars.over.modelP < 1, "Poisson model probability for over 2.5: " + tot.books.Caesars.over.modelP.toFixed(3));
  const ah = ath.markets.spread; ok(ah.books.DraftKings.home && ah.books.DraftKings.home.line === -0.75 && ah.books.DraftKings.home.modelP != null, "quarter-line handicap gets a model probability");
  ok(s.games.some(g => g.home.name === "Sociedad" && !Object.keys(g.markets).length && g.model), "fixtures without odds still listed with the model");
  ok(ath.start && ath.startHasTime, "kickoff time known");
  const snap = B.snapshot(bar); ok(snap.markets.ml.books.Kalshi && snap.model, "snapshot for AI/bets");
  const orig = F.statz; const d1 = new Date(Date.now() + 864e5);
  F.statz = (c) => c === "premier-league" ? { fixtures: [{ fixture_id: 7, home: "Coventry City", away: "Fulham", kickoff: new Date(Date.UTC(d1.getUTCFullYear(), d1.getUTCMonth(), d1.getUTCDate(), 14)).toISOString(), projection: { home_win_pct: 30, draw_pct: 28, away_win_pct: 42, home_goals: 1.1, away_goals: 1.4 } }] } : orig(c);
  const e = await B.load("epl", true); F.statz = orig;
  const cov = e.games[0];
  ok(cov.home.name === "Coventry" && Math.abs(cov.markets.ml.books.FanDuel.home.dec - O.amToDec(240)) < 1e-9 && Math.abs(cov.markets.spread.books.FanDuel.home.line - 0.25) < 1e-9, "when Statz lists the teams the other way round, sides and lines swap together");
  // ESPN enrichment and grading
  const nfl2 = await B.load("nfl", true);
  const pit = nfl2.games.find(g => g.away.name === "Steelers"), mia = nfl2.games.find(g => g.away.name === "Dolphins"), ne = nfl2.games.find(g => g.away.name === "Patriots");
  ok(pit.espn && pit.espn.away.record === "4-2" && pit.espn.away.split === "2-1" && pit.espn.venue === "Caesars Superdome New Orleans, LA", "ESPN records, road split and venue attached");
  ok(mia.espn.tempF === 63 && mia.injuries.away.length === 2 && mia.injuries.away[0].severe && mia.injuries.away[0].name === "Q. Back", "game-time temperature and the away team's injuries (Out first)");
  ok(pit.injuries.away.length === 1 && mia.injuries.home.length === 1 && pit.injuries.home.length === 0, "injuries matched by nickname (New York Jets ↔ Jets, not Steelers ↔ Jets)");
  ok(ne.final && ne.espn.home.score === 30 && ne.status === "final", "final score from ESPN marks the game final");
  ok(pit.start && pit.startHasTime === false, "date from ESPN when the odds page has none");
  ok(nfl2.sources.some(x => x.name === "ESPN injury report"), "ESPN listed as a source");
  const fin = nfl2.scoreboard.find(x => x.status === "final");
  const leg = (market, side, line, dec) => ({ market, side, line, dec, home: "Bears", away: "Patriots", soccer: false });
  ok(B.gradeLeg(leg("ml", "home", null, 1.5), fin).result === "won" && B.gradeLeg(leg("ml", "away", null, 2.6), fin).result === "lost", "moneyline graded from the final (Bears 30–24)");
  ok(B.gradeLeg(leg("spread", "home", -6, 1.91), fin).result === "push" && B.gradeLeg(leg("spread", "away", 6.5, 1.91), fin).result === "won" && B.gradeLeg(leg("spread", "home", -6.5, 1.91), fin).result === "lost", "spread: push on the number, cover and miss");
  ok(B.gradeLeg(leg("total", "over", 53.5, 1.91), fin).result === "won" && B.gradeLeg(leg("total", "under", 54, 1.91), fin).result === "push", "totals (54 points)");
  const q = B.gradeLeg(leg("spread", "home", -6.25, 2.0), fin); ok(q.result === "half-lost" && q.mult === 0.5, "quarter line: half push, half loss");
  ok(B.gradeLeg(leg("ml", "home", null, 1.5), nfl2.scoreboard.find(x => x.status === "scheduled")) === null, "no grade before the game ends");
  ok(B.teamMatch("New York Jets", "Jets") && !B.teamMatch("Chicago White Sox", "Red Sox") && B.teamMatch("Chicago White Sox", "White Sox"), "nickname matching");
  ok(B.teamScore("Paris FC", "PSG") < B.teamScore("PSG", "Paris Saint-Germain"), "PSG ≠ Paris FC");
  ok(B.teamScore("Manchester City", "Man City") === 1, "alias Man City");
  console.log(fail ? fail + " failed" : "all passed"); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
