# Market Desk — notes for Claude

Market Desk is one self-contained HTML page published as a claude.ai artifact:
https://claude.ai/artifact/2xMeHkV6MPetc5mjHmTQiE (owner: the repo owner; currently Version 24; see CHANGELOG.md).
It covers stocks/ETFs, crypto, FX, precious metals, trading cards, prediction markets, a portfolio
with FX-aware cost basis, Deep Research, an AI Advisor, Recommendations, Opportunities (scanner, comparator,
AI idea finder), Smart Money (Congress trades and 13F superinvestors), Market Brain, Day Trading and a Sports Betting tab.

## Build, test, publish

```sh
node build.js dist/market-desk.html   # bundles src/* into one page (order is in build.js)
node tests/run.js                     # unit tests for core.js + odds.js (also run in-app: Settings → Self-test)
node tests/bet.js                     # betting parsers and analysis against tests/bet-fixtures.js
node tests/real.js                    # parsers against real captured page text in tests/real/
node tests/smart.js                   # Smart Money parsers (real Capitol Trades / Dataroma pages) and return maths
node tests/quant-real.js              # intraday/market adapters against real Nasdaq and Twelve Data captures
node tests/e2e.js dist/market-desk.html shots   # Playwright, mocked claude.ai runtime (tests/mock-runtime.js)
node tests/upgrade.js dist/market-desk.html     # opens the page with settings saved by an older version
```

- claude.ai storage returns **frozen** documents (the mock does too). `src/store.js` deep-copies everything it
  reads; never mutate a document obtained any other way.

- e2e needs Playwright with Chromium (`npm i -D playwright@1.63.0 && npx playwright install chromium`).
  It serves `vendor/` copies of decimal.js and lightweight-charts in place of the CDN.
- Headless Chromium sometimes hands a reloaded `file://` page blank localStorage. The reload test first asserts the
  settings reached the mock account store, then restores the pre-reload snapshot if storage came back blank.
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
  {"server": "Statz", "tools": ["get_upcoming_fixtures", "get_match_leaders"]},
  {"server": "FMP", "tools": ["senate"]}]}}
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
- **AI:** `app.caps.sample` (Claude). Deep Research tools live in `src/research.js` (`makeTools`); the AI Advisor's
  extra tools are in `src/views-ai.js` (`advisorTools`). Everything newer uses the shared kit in `src/ai-kit.js`
  (`MD.ai`): `session()` (log, sources, citation checks), `tools(app, S, names)` (search_news, search_web,
  read_page, crypto_news, stock_snapshot, zacks_view, options_move, smart_money, price_range, my_portfolio,
  track_record, compare_returns, portfolio_fit, open_calls and the quant tools), `review()` (a skeptical second pass that keeps/revises/drops each draft item
  against the measured data and retrieved sources), `trackRecord()`/`calibrationNote()` (forecast-journal
  hit rates fed back into prompts) and `blend()` (confidence from Claude, the review, signals and evidence).
  The page computes every number; Claude reasons over tool results. Citations are checked against URLs
  actually retrieved. AI quick takes log their 3-month lean in the forecast journal (source `ai-take`).
  `scoreDue()` scores due forecasts automatically (boot + every 30 min); `scorecard()` renders the calibration view;
  `profileNote()` adds the investor profile (`settings.profile`) to prompts. `learn()` has Claude study scored calls and save lessons
  (`ailessons`); `trackRecord()` attaches the latest lessons, filtered by feature, so `calibrationNote()` carries
  them into every forecasting prompt. Collections added in v10–v19: follows, smcache, smai, ideas, aitakes, briefs,
  proppicks, ailessons, marketdays, brain (the playbook doc), dayplans, daytrades, pickhide, marketcalls, pickchecks, decisions,
  callwatch (one doc per open-call notice, id `<forecastId>:<against|working>`), weekly (Market Brain weekly reviews,
  `MD.brain.weeklyReview`, keyed by the week's Monday; lessons reach every prompt through `MD.brain.note`).
  `MD.ai.assetNote(app, asset)` = the desk's past calls on one asset (add it to any asset-specific prompt).
  `MD.ai.blendFor(app, source)` = learned Claude/history weights (inverse Brier, 10+ graded calls); `MD.ai.statusCard` is the
  dashboard's "What the AI is tracking" card (widget id `aistatus`); `MD.ai.openCalls/monitorCalls` price open calls
  (`MD.quant.callStanding`). `MD.quant.riskGuard` = day-trade daily limits; `MD.quant.tradePreview` + `MD.rebalance.buyCard`
  = the "If you buy" section on asset pages (`MD.rebalance.previewBuy` is shared with AI decisions' portfolio fit and the
  `portfolio_fit` tool). Technical alerts: `MD.quant.techState/evaluateTechAlert` (kinds xma50, xma200, rsi_above, rsi_below,
  high52, low52).
  `D.historyCached(asset, tf)` caches daily histories for 6 h in localStorage (size-capped); use it for analysis, not charts.
  Playbook patterns may carry `rule` (MD.quant.cleanRule shape) and `backtest`; same-day rules are scored by the page
  (`testSrc[date] = "measured"`). `MD.ai.calibrateUp(app, source, upPct)` corrects probabilities once a source has
  10+ scored calls; the review pass returns `probabilityPct` (the reviewer's own estimate) for items with a probability.
  v14 kit tools: market_pulse, explain_move, base_rates, intraday_levels, market_memory, movers, earnings_info,
  economic_calendar. The runtime caps tools per request (limits().tools.maxCount, 20): use `MD.ai.selectTools(tools,
  questionText, cap, core)` whenever a request could carry more. `MD.ai.contextNote(app)` = investor profile + the
  Market Brain note; use it in every AI prompt (not profileNote alone).
- **Forecast sources:** ai-picks, ai-take, ai-day (day-trade plans, horizonDays 1, graded from that session's close),
  ai-market (daily SPY call, due at MD.quant.closeTimeUTC(target)), ai-decide (asset decisions over the profile horizon),
  ai (Deep Research), user. Recommendations picks carry upPct/downPct; lean is derived from upPct (no "either").

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
| quant.js | Base rates + conditional odds and the shrunk direction model, OLS factor model and move attribution, VWAP, opening range, pivots, ATR, gap stats, RVOL, position sizing, trade stats, New York session clock + NYSE holidays |
| ml.js | Machine learning (`MD.ml`): k-means and S&P 500 regimes (`regimes`, shown in the Market Brain via `MD.brain.regimesNow`), features (no look-ahead), L2 logistic regression (Newton), k-nearest-neighbour analogs, walk-forward validation with a purge gap, Brier/AUC/log loss, equal-weight ensemble, block t-test for a clear edge |
| views-ml.js | ML forecast card on asset pages (`MD.mlView.run/compact/card`), logged as source `ml` |
| ai-kit.js | Shared AI kit: tools, tool router, review pass, track-record calibration, lessons, confidence blending, UI helpers |
| market-brain.js | Market Brain: pulse/regime/sensitivities, explainMove (factor attribution), session study, scored playbook, refine, note for prompts, auto-study, Why it's moving card |
| ai-decide.js | AI decision card on asset pages (profile-fit decision, EV, quarter-Kelly ceiling, logged as ai-decide) |
| views-daytrade.js | Day Trading page: levels(), AI plan (logged as ai-day), position sizer, trade journal + AI coach |
| views-opps-ai.js | Opportunities AI: scan review, comparison scorecard, AI idea finder (tickers verified by the app) |
| ai-take.js | AI quick take, bull vs bear debate (two analysts + judge) on stock/crypto pages; AI morning brief on the dashboard |
| ask-ai.js | Ask AI from any page: context-aware chat with the kit tools, profile and a double-check |
| views-watch.js | Watchlist scanner (measured signals across watchlist + holdings) with AI triage |
| views-earnings.js | Earnings tab: Nasdaq surprises, two-day reactions, consensus revisions, implied move, AI preview |
| views-rebalance.js | Portfolio stress test and rebalancing helper (cap / equal / inverse-vol) with AI weighing |
| props.js | Player props data: VegasInsider NBA points and NFL anytime-TD props, ESPN game logs, recency-weighted model, next game + injury, pick grading |
| views-props.js | Sports Betting → Player props view and AI prop picks |
| smartmoney.js | Smart Money data: Capitol Trades / Dataroma / FMP parsers, trade returns vs SPY, copy-trade backtest, projection model |
| views-smartmoney.js | Smart Money tab: leaderboard, member and investor pages, most bought, latest filings, follows |
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
- Player props (used for NBA points): `vegasinsider.com/nba/odds/player-props/` (overs only, one column per book;
  PrizePicks/Sleeper are pick'em sites, excluded from best price). ESPN game logs
  `espn.com/nba/player/gamelog/_/id/<id>/<slug>` (this season) and `.../_/id/<id>/type/nba/year/<seasonEnd>` (last
  season); the ESPN id comes from one Exa web search per player, cached in localStorage `md.espn.nba.ids`. The ESPN
  search API is not readable through Exa. Ball Ranks answers "Too Many Requests" often. NFL anytime TD
  (`vegasinsider.com/nfl/odds/player-props/`) is not used yet.
- Nasdaq daily history (`/api/quote/<SYM>/historical`) only goes back about three years (from late Oct 2023); earlier
  windows return 0 rows. The "5Y" time frame is therefore ~3 years for stocks and ETFs. The e2e mock serves the same.
- Nasdaq earnings: `api.nasdaq.com/api/company/<SYM>/earnings-surprise` and `/api/analyst/<SYM>/earnings-forecast`.
- Nasdaq minute chart `api.nasdaq.com/api/quote/<SYM>/chart?assetclass=stocks` (4:00 a.m.–8:00 p.m. ET, prices only,
  previousClose and session volume). Its `x` is New York wall-clock time written as UTC: subtract tzOffsetSec(NY).
  Movers: `api/marketmovers?assetclass=stocks&exchangestatus=currentMarket|preMarket|afterHours`. Summary
  (`/summary`) gives Sector, Industry, AverageVolume, OneYrTarget. Twelve Data `get_time_series` 5min gives volume
  (NY wall-clock datetimes). Direct requests from the container are blocked; real captures come through Exa.
- Nasdaq insiders: `api.nasdaq.com/api/company/<SYM>/insider-trades?limit=25&type=ALL&sortColumn=lastDate&sortOrder=DESC`.
  Dividends: `api.nasdaq.com/api/quote/<SYM>/dividends?assetclass=stocks` (Nasdaq-listed symbols only).
- NFL anytime TD: `vegasinsider.com/nfl/odds/player-props/` (price per book; one book's column often looks like a
  different market and is flagged when it's 15+ points from the median).
- ESPN (used): `espn.com/{nfl|nba|wnba|mlb|nhl}/injuries`, `espn.com/{league}/scoreboard[/_/date/YYYYMMDD]`,
  `espn.com/soccer/scoreboard/_/league/{eng.1|esp.1|ita.1|ger.1|fra.1}` (soccer lists teams without home/away).
- Smart Money (used): Capitol Trades member pages `capitoltrades.com/politicians/<bioguide>[?page=N]` (15 trades a
  page; later pages are separate crawls with a squashed header; site keeps 3 years), Dataroma
  `dataroma.com/m/holdings.php?m=CODE` and `m_activity.php?m=CODE&typ=a` (codes BRK, psc, ic, BAUPOST, AM, HC, FS,
  GFT, TGM, LMM; SAM, oaktree, DJCO don't exist), FMP `senate` house-latest/senate-latest (by-name, by-symbol and
  `page` are gated on the owner's plan; `form13F` needs a higher plan). Alpha Vantage `CONGRESS_TRADES` works but the
  free key allows 25 requests a day. Capitol Trades `/trades?politician=ID` has a Price column but it's mostly N/A.
- Soccer odds: `sportsline.com/{epl|la-liga|serie-a|bundesliga|ligue-1}/odds/{money-line/|over-under/|}`
  (no draw column; one unlabelled book column is dropped).
- Kalshi: `api.elections.kalshi.com/trade-api/v2/events?series_ticker=KX{EPL|LALIGA|SERIEA|BUNDESLIGA|LIGUE1}GAME&status=open&with_nested_markets=true`
  (prices are before Kalshi's fee; excluded from "best price" when a sportsbook quotes the outcome).
- Statz slugs: premier-league, la-liga, serie-a, bundesliga, ligue-1.
- Ball Ranks connector (connected, not yet used by the page): NFL/NBA player projections and rankings.

## Roadmap (owner-approved order)

1. Done (v8–v9): betting AI forecasts, slips, assistant, layout; start-up fix for frozen documents.
2. Done (v10): Smart Money tab; deeper AI for Recommendations and Opportunities (tools, review pass, calibration,
   confidence breakdown, idea finder); AI quick take on asset pages; AI morning brief; advisor double-check.
3. Done (v11–v12): NBA points and NFL anytime-TD props with AI picks and graded record; AI scorecard with automatic
   scoring; bull vs bear debate; Ask AI; investor profile; watchlist scanner; earnings preview; insiders & dividends;
   portfolio stress test and rebalancing helper; smart-money model portfolio.
   Next: soccer goalscorer props (Statz), NBA matchup/defence adjustments, NFL game logs for a TD model, dividends for
   non-Nasdaq listings (Twelve Data /dividends needs the owner's Grow plan or higher).
4. Done (v14): Recommendations up/down odds from measured base rates + Claude, clearing picks; Market Brain; Day
   Trading page; Why it's moving; new AI tools and the tool router.
5. Investing upgrades: signal scorecard, earnings preview, watchlist scanner, rebalancing helper, dividends,
   insider activity.
