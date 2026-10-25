# Market Desk — notes for Claude

Market Desk is one self-contained HTML page published as a claude.ai artifact:
https://claude.ai/artifact/2xMeHkV6MPetc5mjHmTQiE (owner: the repo owner; currently Version 8).
It covers stocks/ETFs, crypto, FX, precious metals, trading cards, prediction markets, a portfolio
with FX-aware cost basis, Deep Research, an AI Advisor, Recommendations, and a Sports Betting tab.

## Build, test, publish

```sh
node build.js dist/market-desk.html   # bundles src/* into one page (order is in build.js)
node tests/run.js                     # unit tests for core.js + odds.js (also run in-app: Settings → Self-test)
node tests/bet.js                     # betting parsers and analysis against tests/bet-fixtures.js
node tests/real.js                    # parsers against real captured page text in tests/real/
node tests/e2e.js dist/market-desk.html shots   # Playwright, mocked claude.ai runtime (tests/mock-runtime.js)
node tests/upgrade.js dist/market-desk.html     # opens the page with settings saved by an older version
```

- claude.ai storage returns **frozen** documents (the mock does too). `src/store.js` deep-copies everything it
  reads; never mutate a document obtained any other way.

- e2e needs Playwright with Chromium (`npm i -D playwright@1.63.0 && npx playwright install chromium`).
  It serves `vendor/` copies of decimal.js and lightweight-charts in place of the CDN.
- Known flake: "settings and ledger persist after reload" sometimes fails because headless Chromium hands a
  reloaded `file://` page blank localStorage. Rerun; the real artifact stores data in the claude.ai account.
- Publish with the Artifact tool: `file_path` = the built page, `url` = the artifact URL above, a short
  `label`, and the FULL capabilities set below (a non-empty `capabilities` replaces the stored set, so
  always restate every entry; omit `capabilities` entirely to keep it unchanged).

```json
{"db": {}, "user": {}, "sample": {}, "downloads": true, "assets": {},
 "mcp": {"servers": [
  {"server": "Exa", "tools": ["web_fetch_exa", "web_search_exa"]},
  {"server": "Crypto.com", "tools": ["get_ticker"]},
  {"server": "CardChain AI", "tools": ["search_cards"]},
  {"server": "Alpha Vantage MCP Server", "tools": ["GOLD_SILVER_HISTORY"]},
  {"server": "Bigdata.com", "tools": ["bigdata_search"]},
  {"server": "karten-ankauf.de", "tools": ["search_cards", "get_buy_price"]},
  {"server": "CoinMarketCap", "tools": ["search_cryptos", "get_crypto_latest_news"]},
  {"server": "Zacks Data", "tools": ["get_zacks_metrics", "get_wall_st_rating"]},
  {"server": "Twelve Data", "tools": ["get_time_series"]},
  {"server": "Statz", "tools": ["get_upcoming_fixtures", "get_match_leaders"]}]}}
```

## How the page works

- **Artifact sandbox:** scripts load only from allowed CDNs (decimal.js on jsDelivr, lightweight-charts
  on unpkg, pinned versions). The page cannot fetch other hosts or load external images. Everything else
  is inlined by `build.js`.
- **All web data goes through the viewer's Exa connector** (`web_fetch_exa`) in `src/data.js` `fetchRaw`:
  max 4 in flight, identical requests shared, one retry on transient errors. The body starts after the
  `URL: …` line. `D.bust(url)` adds a cache-buster when a fresher crawl matters (odds pages).
- **Connectors** are called through `D.connector(displayName, providerId)`; display names must match the
  capabilities list exactly.
- **Images** (card pictures) come from `images.weserv.nl/?url=…&encoding=base64` read through Exa and shown
  as `data:` URLs (`D.imageData`). A drawn card face is the fallback.
- **Storage:** `src/store.js` keeps collections under the viewer's private `data/users/<id>/md/...` in the
  artifact db (browser localStorage when signed out; memory in demo mode). Append-only collections:
  tx, forecasts, evals, reports, picks. Add new collections to `COLLECTIONS`.
- **AI:** `app.caps.sample` (Claude). Research tools live in `src/research.js` (`makeTools`); the AI Advisor's
  extra tools are in `src/views-ai.js` (`advisorTools`). The page computes every number; Claude reasons
  over tool results. Citations are checked against URLs actually retrieved.

## Source map (src/)

| File | Role |
| --- | --- |
| core.js | Decimal money/FX maths, portfolio engine, stats, projections, technicals, CSV |
| odds.js | Betting maths: odds formats, no-vig, EV, Kelly, parlay, arbitrage, normal + Poisson models |
| tests.js | Unit tests (`MD.tests`) |
| data.js | Data layer: providers registry, Exa fetcher, every market/card adapter, image proxy |
| betting.js | Odds adapters: VegasInsider (US, named books), SportsLine (soccer), Kalshi, Statz, ESPN injuries + scoreboards; game analysis; grading bets from final scores |
| bet-ai.js | Betting AI: per-game and slate forecasts (confidence = AI + data coverage + market agreement), page-built slips, AI pick log (`betpicks`/`betgrades`, first forecast counts), betting assistant |
| store.js | Storage backends and collections |
| ui.js | DOM helper `h`, tables, tabs, toasts, modals, charts |
| app.js | Shell: routes/nav/icons, settings, back-stack navigation, `openAsset`, `openGame` |
| views-*.js | Pages (markets, cards, insights, decide, portfolio analysis, picks, betting, AI) |
| research.js | Deep Research engine |
| template.html | CSS (theme tokens, light/dark) and the page skeleton |

## Rules this project follows (from the owner's build prompt)

- Never fabricate prices, odds, sources, citations or research steps; show source and as-of time; say
  plainly when data is missing or stale.
- Read-only: never execute trades, place bets or move money.
- No secret keys in the page.
- Don't claim a feature works until it's implemented and tested.
- Betting: show the responsible-gambling notice; fair probabilities are the baseline; "no bet" is valid.

## Data sources worth knowing

- US odds: `vegasinsider.com/{nfl|nba|mlb|nhl|college-football|college-basketball|wnba}/odds/las-vegas/`
  (three tables: spread, total, moneyline; two rows per game by rotation number).
- Player props (not yet used): `vegasinsider.com/nfl/odds/player-props/` (anytime TD by book) and
  `vegasinsider.com/nba/odds/player-props/` (points overs by book incl. PrizePicks, Sleeper). ESPN player game
  logs (`espn.com/nba/player/gamelog/_/id/<id>/<slug>`) read cleanly.
- ESPN (used): `espn.com/{nfl|nba|wnba|mlb|nhl}/injuries`, `espn.com/{league}/scoreboard[/_/date/YYYYMMDD]`,
  `espn.com/soccer/scoreboard/_/league/{eng.1|esp.1|ita.1|ger.1|fra.1}` (soccer lists teams without home/away).
- Smart Money sources (verified, not yet used): FMP `senate` (senate/house latest, by name, by symbol),
  Alpha Vantage `CONGRESS_TRADES`/`POLITICIAN_METADATA`, Dataroma superinvestor pages
  (`dataroma.com/m/holdings.php?m=BRK`, `m_activity.php?m=BRK&typ=a`). FMP `form13F` needs a higher FMP plan.
- Soccer odds: `sportsline.com/{epl|la-liga|serie-a|bundesliga|ligue-1}/odds/{money-line/|over-under/|}`
  (no draw column; one unlabelled book column is dropped).
- Kalshi: `api.elections.kalshi.com/trade-api/v2/events?series_ticker=KX{EPL|LALIGA|SERIEA|BUNDESLIGA|LIGUE1}GAME&status=open&with_nested_markets=true`
  (prices are before Kalshi's fee; excluded from "best price" when a sportsbook quotes the outcome).
- Statz slugs: premier-league, la-liga, serie-a, bundesliga, ligue-1.
- Ball Ranks connector (connected, not yet used by the page): NFL/NBA player projections and rankings.

## Roadmap (owner-approved order)

1. Done (v8): AI game forecasts + slate forecasts with confidence, AI picks and ready-made slips, AI track record,
   betting assistant, streamlined betting layout (league buttons, rows, side slip with round robin), ESPN injuries
   and records, price alerts, loss limits, settle-from-final-score, dashboard betting card.
2. Smart Money tab: Congress trades (FMP + Alpha Vantage), superinvestor portfolios (Dataroma), news
   (Bigdata.com), performance since trade/disclosure vs SPY, copy-trade backtest, projected ranges.
3. Player props: NBA points and NFL anytime TD by book, ESPN game logs, matchup, probability model, AI notes;
   soccer goalscorers via Statz.
4. Investing upgrades: signal scorecard, earnings preview, watchlist scanner, rebalancing helper, dividends,
   insider activity, AI morning brief, confidence across AI features.
