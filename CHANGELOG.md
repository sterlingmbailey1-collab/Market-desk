# Changelog

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
