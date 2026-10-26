# Changelog

## Version 22 (2026-10-26)
- **Fix: overlapping text in the Recommendations prediction log.** The "▲ 61% up" pill no longer spills into the
  "Price then" column; the column widens and the table scrolls instead. The same fix covers every table with pills or
  no-wrap figures, including the Market Brain playbook's backtest column. Every page is now checked automatically for
  overlapping text at phone width.
- **Fix:** the odds explanation on picks said "since NaN"; it now names the year the history starts.
- **Fix:** the position sizer shows "your rules say stop for today" even before entry and stop are filled in.
- **Machine learning.** Two models are trained in your browser on each asset's daily history, with the market (SPY,
  or bitcoin for coins) as context:
  - logistic regression over 13 measured features (momentum, RSI, distance from averages and the 1-year range,
    volatility regime, strength against the market)
  - nearest-neighbour "similar past setups".
  They're scored walk-forward, only on stretches of history they hadn't seen, against the base rate. Their odds count
  only when the improvement is statistically clear across independent stretches (t ≥ 1.64). Otherwise the forecast
  stays at the base rate and says it found no edge.
  - Stock and crypto pages get a Machine-learning forecast (1 week, 1 month or 3 months) showing:
    - the odds
    - the out-of-sample record (Brier skill, AUC, accuracy against always guessing the more common outcome)
    - what drives today's reading
    - the most similar past days and what followed them.
    The first forecast per asset, horizon and day is logged and graded like every other call.
  - AI decisions, Recommendations and the daily market call get the model's odds and record; its odds join the
    measured side of the blend only with a clear edge.
  - New `ml_forecast` tool for Ask AI and the Advisor.
  - The scorecard lists the Machine-learning model as its own source.

## Version 21 (2026-10-26)
- The dashboard's Market Brain card shows the latest weekly review and next week's top events.
- "Where do the open calls stand?" stays on the dashboard card after a pricing, so the calls can be re-priced.
- Checked at phone width (400 px) with the new panels open (Market Brain, Day Trading, open calls, If you buy, the AI
  pipeline): no sideways scrolling.
- Tests: the Smart Money "most bought" check no longer depends on today's date, and a unit test pins the 90-day window.

## Version 20 (2026-10-25)
- **AI weekly review** (Market Brain). Claude looks back at the week: why the market moved (cause → effect, with
  evidence), what the desk's graded calls got right and wrong, lessons for next week, and next week's events
  (earnings for your holdings and watchlist, the economic calendar). It is written automatically on the weekend once
  you've studied a session, and its lessons and calendar reach every AI on the desk.
- **Portfolio-aware AI decisions.** Before deciding, the desk measures what a position at your maximum size would have
  done to your portfolio (correlation, volatility, worst drop) and Claude weighs diversification against
  concentration. The decision card shows the fit.
- **Technical alerts**: crosses of the 50- and 200-day averages, RSI(14) at a threshold, new 52-week highs and lows.
  Each is measured from daily closes plus the live price and fires once per event.
- **How the desk's AI decides** (scorecard): the steps behind every probability (measure, research, context, review,
  blend, calibrate, grade, learn) with their live state. Per feature, it shows graded calls, how much the odds lean on
  Claude versus history, and whether calibration has started.
- **New AI tools** for Ask AI and the Advisor: `portfolio_fit` (what buying a symbol would do to your portfolio) for
  buying questions, and `open_calls` (where the desk's open calls stand) for questions about its calls.

## Version 19 (2026-10-25)
- **Open-call monitor.** Every open AI call (recommendations, quick takes, AI decisions, research) priced now: the
  move since the call and the chance it still finishes on its side by the due date, from the asset's own volatility
  alone. "Where do the open calls stand?" on the dashboard card. Every two hours, the inbox gets one notice when a call
  turns clearly against itself (25% or less) or clearly in its favour (85% or more). It can be switched off on the card.
- **Recommendations focus.** An optional theme, sector or style (e.g. "AI chips", "nuclear power", "oversold large
  caps"). Claude names the assets that fit; the app checks each with a live quote, measures it like every other
  candidate and drops the ones it can't price; the picks lead with them.
- **Day-trading risk limits.** Your own daily rules (maximum loss as a % of the account, maximum trades, stop after N
  losses in a row) checked against today's logged trades: P&L, loss left, trades left and losing streak. The position
  sizer warns when a trade would break the loss limit and gives the share count that stays inside it. The AI plan is
  told your state and says to sit out once your rules say stop.
- **If you buy** (stock and crypto pages): what a purchase would have done to your portfolio over the past year,
  covering weight, volatility, worst drop and correlation with what you hold. It is checked against the position cap
  for your risk setting and the AI decision's size ceiling. Read-only: nothing is bought.

## Version 18 (2026-10-25)
- **Target-before-stop odds** in day trading: from the stock's measured volatility and the minutes left in the
  session, the sizer shows the chance price reaches the target before the stop on geometry alone (a driftless random
  walk), and each AI setup carries the same figure next to Claude's own odds.
- **AI read of the watch board**: "which setup is cleanest now?" ranks the symbols on the board from the measured
  signals, relative volume and levels.
- **Learned blend weights**: how much each probability leans on Claude versus the measured history is now learned
  from the record. Once a feature has 10+ graded calls, each side is weighted by its Brier score (shrunk toward the
  65/35 default). The scorecard shows the current split.
- **Automatic lessons**: after 10+ new graded calls the Market Brain's after-close run has Claude re-study what went
  right and wrong, and the lessons reach every forecasting prompt.
- **Set check** on Recommendations: warns when most picks sit in one sector, overlap what you already hold, or all
  lean the same way.
- **Alerts from an AI decision**: one click sets alerts at the decision's stop level and take-profit.
- **What the AI is tracking** (dashboard card): open AI calls by source with the next one due, this week's graded
  results, the latest market call and the latest lesson.

## Version 17 (2026-10-25)
- **AI decision** on every stock and crypto page: buy, add slowly, hold, trim, sell, avoid or wait, for your risk
  profile and holding period and your current position. The page measures the asset's odds over your horizon; Claude
  researches (news, valuation, earnings, insiders, smart money, options); a reviewer checks it. The page then shows
  the expected value, the break-even odds and a position-size ceiling (a quarter of the Kelly fraction, capped by your
  risk setting), and flags any suggested size above what the odds support. The decision is graded at the horizon's end.
- **AI memory** on asset pages: every past AI call on the asset (recommendations, quick takes, day plans, decisions,
  research) with how it turned out, plus the Market Brain's notes on its moves. Every AI that looks at the asset again
  is told this record.
- **Scorecard: "if followed"**: what acting on each AI's up/down calls would have returned on average, next to the
  S&P 500 over the same windows.
- **Sector rotation** in the Market Brain: each sector's strength against the S&P 500 over 3 months and 1 month,
  placed in four quadrants (leading, improving, weakening, lagging), shown on a chart and given to every AI.
- **Earnings this week** on the Day Trading page: reports from your watchlist, holdings and the largest companies,
  with the options-implied move against the stock's average past reaction ("priced more/less than usual"), beats,
  and an AI read of the week.
- **Faster, lighter analysis**: daily histories used by base rates, factor models, backtests and the market pulse are
  kept in the browser for six hours (size-capped), so repeated studies don't re-fetch years of prices.

## Version 16 (2026-10-25)
- **Day trading: setup signals.** The desk measures setups as they happen (opening-range breakout/breakdown, VWAP
  reclaim/rejection, holding above or below VWAP, stretched from VWAP, at the day's high/low, beyond the prior day's
  or pre-market range, gap holding/filling/filled, heavy or light volume) with the time each began; the AI plan sees
  them too.
- **Watch board.** Several symbols at once (price, change, gap, position in the day's range, relative volume,
  signals), refreshed every minute while US markets trade, with a notice when a new setup appears.
- **One-click level alerts** on every key level of the day-trade desk.
- **Portfolio macro sensitivity.** Each holding's sensitivity to the market, its sector, long Treasuries, the dollar,
  oil, gold and bitcoin, weighted into the portfolio's betas, with scenario estimates in money ("stocks fall 10%",
  "long yields jump", "risk-off day", …), your own scenario, and the asset-specific risk left over. The AI portfolio
  review sees these exposures.
- **Recommendations:** re-check a pick (updated odds and whether the thesis holds, with sources; the logged call is
  not changed) and set alerts at a pick's upside target and downside level in one click.
- **Fix:** a second price alert on the same asset no longer replaces the first.

## Version 15 (2026-10-25)
- **Testable playbook.** Market Brain patterns now carry a rule over daily moves (e.g. "TLT below −1% → XLK minus SPY
  below 0% the same day"). Every rule is backtested on a year of daily closes (how often the effect followed the cause
  vs how often it happens on any day, with a z-score), same-day rules are scored by the app itself from each
  session's measured moves, and refining the playbook adds rules to older patterns and re-runs the backtests.
- **Hypothesis Lab.** Describe a cause and effect in plain words; Claude turns it into a rule (ETFs stand in for
  sectors and themes), the app backtests it over 1 or 3 years, and you can add it to the playbook. Ideas that can't
  be measured with daily prices are explained, not forced.
- **backtest_rule** AI tool: every AI on the desk can test a pattern against history before relying on it.
- **Daily market call.** The chance the S&P 500 closes up in the next session, anchored to SPY's own history of up
  days in situations like today's, adjusted for pre-market moves, the calendar, earnings, news and backtested
  patterns, and checked by a reviewer. The first call per session is graded from the close; the record feeds the
  next call. Made automatically after each studied session; shown on the Market Brain page, the dashboard card and
  in every AI prompt.
- **Two readers.** The reviewer now gives its own independent probability, which is averaged with the analyst's for
  Recommendations, day-trade plans and market calls.
- **Automatic calibration.** Once a feature has 10+ graded calls, its probabilities are corrected toward how often
  calls stated at that level actually came true (never flipping the direction); each card shows the correction.
- Test harness: the reload check now looks for the stored account data itself, not just any stored key.

## Version 14 (2026-10-25)

**Recommendations**
- Every pick now gives the chance of going up and of going down (no more "big move either way"). The odds blend
  Claude's judgement (65%) with the asset's own measured history (35%): how often it finished higher over the same
  window in 5 years of daily closes (2 for coins), overall and in situations like today's (RSI, trend, a sharp
  recent move, distance from the high), shrunk toward 50% when the history has few independent windows. The
  review pass can pull the odds toward 50%. Each card shows how the odds were built.
- "If it rises / falls" move sizes, the chance of a move of the expected size from volatility, an at-a-glance
  table, a next-week window, and an option to include your watchlist and holdings in the candidate pool.
- Clear recommendations: remove one pick, clear stocks, clear crypto or clear all, and restore. Cleared picks stay in
  the forecast journal so the AI's track record stays honest.
- Claude gets more tools here: earnings record, insider activity, Market Brain memory and move explanations.

**Market Brain (new page)**
- Measures the whole market: indices, sectors, long Treasuries, the dollar, oil, gold, credit and bitcoin, the regime
  (trend, volatility state, stock–bond correlation, leadership) and how strongly each sector moves with rates, the
  dollar and oil.
- "Study the session": Claude explains why the market moved (drivers with sources, movers explained, what to watch)
  and tests its playbook of cause → effect patterns. Later sessions mark each pattern held or failed; reliability is
  measured from that record and patterns that keep failing are retired. "Refine the playbook" merges, sharpens and
  retires patterns and names recurring themes. Once started, it studies each session automatically after the close.
- What it learns (regime, recurring drivers, patterns with their record) is given to every AI feature on the desk.

**Day Trading (new page)**
- Session clock with the NYSE holiday calendar, US economic releases, pre-market / regular / after-hours movers.
- Desk for any US stock, ETF or coin: pre-market range, open, 15/30-minute opening range, VWAP with bands, prior day
  high/low/close, floor pivots, ATR and how much of it is used, relative volume, how past gaps like today's played
  out, and a chart with VWAP and the key levels.
- Position-size calculator (risk per trade, max position, R multiples, stop vs ATR).
- AI day-trade plan: chance of closing above the current price, at most one long and one short setup with exact
  entry/stop/targets (a stop on the wrong side is flagged), stay-out conditions, review pass. Every plan is logged
  and graded at the close; the record feeds the next plan.
- Trade journal for your own trades: win rate, profit factor, expectancy, R, and an AI coach that finds leaks.

**Deeper AI across the desk**
- New research tools for every AI: market pulse, explain a move (factor model), base rates, intraday levels,
  Market Brain memory, movers, earnings record, economic calendar.
- "Why it's moving" on stock and crypto pages: today's and the week's move split into market, sector, rates,
  dollar, oil and the asset's own part, with Claude's read of the news behind the asset-specific part.
- A tool router picks the tools each question needs within the runtime's per-request cap.

**Fixes**
- Same-day and next-day forecasts wait for their own closing price instead of using the previous close.
- Nasdaq's minute data is New York wall-clock time; it's now converted before computing intraday levels.

## Version 13 (2026-10-25)
- The AI learns from its own record: in any AI scorecard (Deep Research → Forecast journal, Recommendations), "Study
  the misses and write lessons" has Claude study every scored forecast (what it predicted, how sure it was, its thesis,
  what happened), name its biases and write lessons backed by specific calls. The latest lessons are told to every
  AI that forecasts (Recommendations, quick takes, debates, earnings previews, Deep Research, Opportunities), filtered
  to the feature they apply to. Restudying keeps the lessons the record still supports.
- Fix: the scorecard's "Your own forecasts" row counted every forecast instead of only yours.

## Version 12 (2026-10-25)

Deeper AI and new features, built in one improvement pass on top of v10.

**AI that learns from its record**
- AI scorecard: every logged forecast (Recommendations, AI quick takes, Deep Research) is scored automatically while
  the page is open, with a calibration chart by stated probability. The record is fed back into the prompts so
  stated probabilities stay honest. Shown in Deep Research → Forecast journal, Recommendations, and as a dashboard card.
- Betting forecasts are told their graded pick record and get the independent review pass; the review can drop a
  suggested bet.
- AI prop picks are logged and graded from each player's next ESPN game log; the record is fed back.

**New AI features**
- Bull vs bear debate on every stock and crypto page: two Claude analysts research opposite cases in parallel, a judge
  weighs them against measured data and checks which citations were actually retrieved.
- Ask AI from any page: a chat that knows what you're looking at (asset, person, game, portfolio), with the full
  research toolkit, your investor profile and a one-click double-check. Questions typed in the search bar can open it.
- Investor profile (Settings → AI & investor profile): risk appetite, holding period, income, goals, things to avoid.
  Every AI feature is told it.
- Deep Research gains smart-money, insider and options-implied-move evidence plus the profile and calibration.
- Smart Money AI reads get the review pass.

**New features**
- Player props: NBA points by book (VegasInsider) with a recency-weighted model from ESPN game logs (this season and
  last), hit rates, home/away splits, every book's line, next opponent and injury status; AI prop picks with news and
  review. NFL anytime touchdowns: consensus fair chance across books, best price, outlier books flagged, AI picks.
- Earnings tab on stock pages: next report, consensus EPS with revisions, last four surprises and the stock's two-day
  reactions, options-implied move to the first expiry after the report, and an AI earnings preview with scenarios.
- Insiders & dividends tab: Form 4 activity (open-market buys vs sells, net shares, transactions) and dividend history.
- Watchlist scanner (Opportunities): measured signals across watchlist and holdings (RSI extremes, 52-week extremes,
  moving-average crosses, big moves, volatility spikes, earnings soon, insider buying, smart money) and AI triage.
- Portfolio: market stress test from measured beta and past worst moves; rebalancing helper (cap, equal weight,
  inverse volatility) with trades, costs and volatility before/after, and an AI assessment.
- Smart Money model portfolio: what the best measured performers are buying, combined and backtested against SPY.
- Recommendations add insider activity to the measured signals.

## Version 11 (2026-10-25)
Interim publish of the first part of the v12 work (props, debate, scorecard, earnings, watchlist scanner, portfolio
stress test and rebalancing).

## Version 10 (2026-10-25)
- Smart Money tab: Congress members' disclosed trades (Capitol Trades) and superinvestor 13F portfolios (Dataroma)
  ranked by measured return against SPY, copy-trade backtest from publish dates, projection model, member and investor
  pages with news and an AI read, most-bought list, latest filings (FMP), follows with inbox notices.
- Shared AI kit: research tools, a skeptical review pass, track-record calibration and blended confidence.
- Recommendations: more tools and signals, bull/bear case, what would change the view, review that revises or drops
  picks, confidence breakdown. Opportunities: AI scan review, comparison scorecard, AI idea finder with verified tickers.
- AI quick take on asset pages; AI morning brief on the dashboard; AI Advisor double-check and new tools.

## Version 9
Start-up fix for viewers whose settings were saved by an older version (frozen storage documents).

## Version 8
Sports betting AI: game and slate forecasts with confidence, AI picks and slips, betting assistant, new layout.
