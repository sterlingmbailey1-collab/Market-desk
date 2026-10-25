# Changelog

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
