# Changelog

## Version 38 (2026-10-26)
- **The AI sees the portfolio health score.**
  - Claude's portfolio review and the AI Advisor's portfolio tool (also used by Ask AI) now get the 0–100 health
    score and its parts, against your risk setting.
  - The review also gets the sector mix of your stock holdings once their sectors have been looked up.
  - The page, the review and the advisor all use the same measured numbers.

## Version 37 (2026-10-26)
- **ML odds recalibrated on their own record (Platt scaling).**
  - The ensemble's raw odds are refitted on its own out-of-sample predictions.
  - The fit is made on the first two thirds and kept only if it lowered the Brier score on the last third (data it
    hadn't seen).
  - Overconfident odds get pulled in; when recalibration doesn't help, it isn't used.
  - The card says when it was applied and by how much it improved the held-back score. Tested on synthetic
    overconfident odds.

## Version 36 (2026-10-26)
- **What's new card on the dashboard.** It lists the features added since Version 25, each linking to its page:
  the game plan, paper trading, the screener, fresher recommendations, stronger AI and the portfolio additions. It
  stays until you dismiss it.

## Version 35 (2026-10-26)
- **Wall Street's 1-year target as a measured fact.**
  - Every stock candidate in Recommendations and every AI decision gets the analysts' average 1-year price target
    from Nasdaq's summary (NYSE and Nasdaq listings), with the upside or downside from today's price.
  - Claude weighs it as one input, and the pick shows it under "how the chance was built".
- **AI decisions see your holdings' news tone.** If you've read the news sentiment for your holdings in the last
  three days, the AI decision on one of them gets its score, label and summary.

## Version 34 (2026-10-26)
- **The AI learns from more of its own record.** When it studies its graded calls to write lessons, it now also sees:
  - each specialist analyst's record
  - the paper account's results by source of ideas.

  So lessons like "the quant analyst has been more reliable" or "the screener's ideas have lagged the S&P 500" can
  reach every future prompt.
- **Volume-spike alert.** A new technical alert fires when today's volume so far reaches a set multiple of the
  20-day average (2× by default). It fires at most once a session.

## Version 33 (2026-10-26)
- **The specialist panel learns from its record.**
  - Every pick, AI decision and market call now logs each analyst's own odds: the lead analyst, fundamentals, quant
    and news & macro.
  - Once an analyst has 20 graded estimates, the team weighs it by its accuracy, from 0.5× to 2× (Brier score; a
    coin flip counts 1×). Analysts who have been right count more, and ones who have been wrong count less.
  - The disagreement check still uses the plain spread, so a confident outlier can't hide a split team.
  - The AI scorecard shows how each analyst has done (graded, right, Brier) and its current weight.

## Version 32 (2026-10-26)
- **Mid-cap discovery in Recommendations.** Every day, two sectors rotate in and the desk adds mid-sized companies
  ($2B–10B) from each, on the NYSE and Nasdaq, to the candidate pool. Picks reach beyond the same large names, and
  ones that came in this way are tagged "Mid-cap discovery".
- **Sector allocation** (Portfolio → Allocation → Sector). Stock holdings are grouped by sector from Nasdaq's
  summary (NYSE and Nasdaq listings, cached for a week); ETFs are grouped as diversified.
- Dividend income projection was considered and left out. Nasdaq's dividend data doesn't cover NYSE listings
  (checked live), so the projection would be wrong for many portfolios.

## Version 31 (2026-10-26)
- **The ML checks whether its edge still holds.**
  - The model now also scores itself on the most recent third of its out-of-sample test. If it has done worse than
    the base rate there, while still showing an edge overall, its weight is halved and the card says the edge has
    faded.
  - Tested on synthetic data: a pattern that stops working is flagged, one that keeps working isn't.
  - Claude also gets the recent skill wherever the ML's odds go into a prompt.
- **Realized gains and dividends by year** (Portfolio).
  - Realized gains are split into short-term (held a year or less) and long-term, matched first-in first-out, with
    dividends.
  - Amounts are in your reporting currency at each date's reference rate. Anything without a rate is left out and
    listed.
  - A summary to check against your broker's statements, not tax advice.

## Version 30 (2026-10-26)
- **Desk consensus** on stock and crypto pages. Every model on the desk with an open call on the asset is combined
  into one chance of a rise per horizon (next two weeks, 1–4 months, 4–12 months). That covers the quick take, the
  AI decision, Recommendations, the ML model, day-trade plans and your own forecasts.
  - Sources with 10 or more graded calls count by their accuracy (Brier score); the rest count once.
  - The card shows how much of the weight agrees and the spread between sources, and warns when the models disagree.
  - It updates as soon as a new call is logged.
- **Earnings on the game plan.** Each upcoming report for your names shows the options-implied move and the stock's
  typical two-day reaction. Both also go to the AI game plan and the daily digest.
- **Paper-trading AI coach.** Claude reads your closed paper trades and says:
  - what's working and what isn't
  - which habits show
  - what to try next.

  It uses the return, the S&P 500 over the same days, the holding time and the source of each idea, and says
  plainly when the sample is too small to mean much.
- **Portfolio health score** (Portfolio analysis). A 0–100 score measured from the past year of your current
  holdings against bands for your risk setting:
  - diversification
  - the largest position
  - volatility
  - the worst drop
  - how independently your holdings move.

  Each part is shown with its band.
- **Automatic catalysts.** Earnings for your holdings and watchlist names go on the Calendar & Catalysts list once,
  with the EPS forecast and the options-implied move.
- **Negative-news notice.** When a news reading scores a holding at −50 or lower from two or more relevant
  headlines, one inbox notice goes out that day.
- **Ask AI knows the new pages.** It has starter questions and context for the paper account, the game plan and the
  stock screener.
- The game plan lists the calendars one under the other, and caps the graded calls at eight with a link to the rest.

## Version 29 (2026-10-26)
- **Follow the AI automatically** (Paper Trading).
  - When it's on, every new recommendation that leans up is paper-bought with a set share of the account (5% by
    default) and sold automatically when its window ends.
  - The paper account becomes a sized, forward test of the AI's picks against the S&P 500. Positions you buy yourself
    are never auto-sold.
- **New AI tools.** Ask AI, the AI Advisor and the idea finder can now:
  - read the paper account: its record against the S&P 500 and by source of ideas
  - run the stock screener: exchange, sector, size, price and today's move
  - read the latest news sentiment for your holdings.

  The tool router adds these only when the question is about them.
- **Dashboard cards.** "Today" shows the clock, the SPY call, calls due, unread alerts and the day's first US
  releases. "Paper account" shows its value and return against the S&P 500. Existing dashboards get both once.
- **Did the ML's odds hold up?** The machine-learning card has a reliability table. It groups the model's
  out-of-sample odds by what it said and shows how often the asset actually rose. Gaps of more than 10 points on 20+
  cases are flagged.
- **Earnings warning on paper orders.** The order ticket shows the next earnings date when one is known.

## Version 28 (2026-10-26)
- **Paper trading** (new page under Decide). A virtual account with $100,000 to start; you can change the amount
  when you start over. Nothing is ever bought or sold for real.
  - Orders fill at the live quote, and the quote's source and time are kept with each order. Estimated commission
    and spread come from Settings. There's no margin and no short selling.
  - Every buy is mirrored into SPY with the same dollars at the same moment. Each closed trade shows the S&P 500's
    return over the same days.
  - Closed trades are grouped by where the idea came from: your own, an asset page, Recommendations, an AI decision
    or the screener. This shows which source of ideas actually works when sized like real trades.
  - "Paper trade" appears on stock and crypto pages, on recommendations that lean up, on AI buy decisions (sized at
    the decision's ceiling) and on screener rows.
- **Stock screener** (Opportunities → Stock screener).
  - Filters: NYSE and/or Nasdaq, sector, company size, price range and today's move. Sort by size, move or price.
  - The results can go to the machine-learning scan, to your watchlist, or to Recommendations as a focus list. The
    focus-list names are verified and measured like any other candidate.
  - Shows the screener's as-of time; each stock's page has the live quote.
- **Today's Game Plan** (new page under Overview).
  - The market clock and the desk's SPY call.
  - Today's US economic releases and earnings in the next five trading days for your holdings and watchlist.
  - How your names are moving, AI calls coming due this week, what was graded since yesterday, unread alerts and
    the paper account.
  - An optional AI game plan turns those measured facts into a few priorities. Claude adds no prices or events of its
    own, and unknown tickers or pages are dropped.
- **Daily digest.** Once a day after 6 a.m. New York time (while the desk is open), a summary of the day goes to the
  inbox. Switch it off on the game-plan page.
- **News sentiment for your holdings** (Portfolio). For up to eight holdings, the latest headlines come from
  Bigdata.com (stocks) and CoinMarketCap (coins).
  - Claude judges each headline for someone who owns the asset and drops the ones that aren't about it.
  - The page scores each holding from −100 to +100; recent and material news counts more.
  - Links are only the retrieved articles. The day's reading also feeds the digest and the game plan.
- **Risk-parity rebalancing.** The rebalancing helper adds:
  - Equal risk contribution: every holding adds the same share of the portfolio's swings.
  - Minimum volatility, with no position above your cap.

  Both use the measured covariance. A new column shows each holding's share of the risk before and after.
- **Sector on stock pages.** The header shows the sector and industry next to the exchange, and asset search shows
  each result's exchange.

## Version 27 (2026-10-26)
- **Boosted trees in the ML forecast.** A third model (40 small gradient-boosted decision trees) joins the logistic
  regression and the similar-past-setups model. The three count equally and are tested the same way, on history they
  hadn't seen. The card shows which features the trees split on most.
- **The ML model calibrates itself.** Once its own logged forecasts have 10 or more grades, its odds are corrected
  toward how often calls at that level actually came true. The card shows the correction.
- **Cross-stock model for Recommendations.** One model is trained across all the stock candidates at once on which
  ones beat the S&P 500 over the window. It's tested walk-forward by date: did its top third beat its bottom third on
  data it hadn't seen? Claude sees each candidate's odds and rank. The set header shows the model's record, and the
  set says plainly when it has no edge.
- **Correlation check.** The set check measures how closely each pair of picks has moved over the last 120 sessions.
  It flags pairs at 0.7 or above, since holding both is closer to one bet than two.

## Version 26 (2026-10-26)
- **Specialist panel.** Three more analysts estimate every Recommendations pick, AI decision and market call
  independently, each with their own tools:
  - fundamentals: Zacks, earnings, insiders
  - quant: base rates, the ML model, options, technicals
  - news and macro: headlines, the economic calendar, the Market Brain.

  The lead analyst and the three specialists count equally, and wide disagreement lowers confidence. Evidence must
  carry a measured figure or a retrieved source, or it's dropped. It can be switched off in Settings → AI, since it
  uses about three times the Claude usage.
- **Conflict check.** When Claude's odds sit more than 20 points from the measured history, it must give specific
  evidence, or the desk halves the gap. Shown on the card.
- **Pre-mortem.** Every pick and AI decision states its most likely way to fail, and the reviewer checks it.
- **A reviewer with its own tools.** The second reviewer can check news, the measured price picture, base rates and
  the ML model itself, instead of judging only what the analyst cited.
- **Learned combiner (stacking).** After 30 graded calls, a model trained on the record weighs Claude, the reviewer,
  the history and the ML model by how each has actually done. It takes over only if it beat the fixed blend on the
  most recent calls. Every forecast now logs the reviewer's and the ML model's odds for this.
- **More tools for the pickers.** Recommendations get the ML forecast, base rates and open calls; AI decisions get the
  ML forecast, portfolio fit and open calls.
- **Plain-English mode** (Settings → AI): every AI answer in simple language, with finance terms explained.

## Version 25 (2026-10-26)
- **Fresher recommendations.**
  - The desk remembers every name recommended in the last 30 days and ranks those lower in the candidate pool.
  - Claude may pick one again only with a stated reason, which is shown on the card ("Picked again: why again …").
    Repeats are capped at a third of the set.
  - A repeat without a reason is set aside, and one of two fresh alternates takes its place.
  - No more than two picks share a sector. What was set aside is listed with the reason.
- **NYSE and Nasdaq.** Candidates come from the largest companies on each exchange (above $2B market cap and $5 a
  share), mixed evenly, with a "Stocks from" choice (NYSE + Nasdaq, NYSE only, Nasdaq only). Each pick shows its
  exchange.
- **More angles.** Candidates come in through several angles: earnings in the window, today's movers, the biggest
  moves, and a rotating sample of names not recommended lately that changes daily. Each pick shows its angles
  (earnings in the window, oversold, near its 52-week high, heavy short interest, fresh name…).
- **Pick history.** Every name ever recommended, with:
  - how often and when it was picked
  - the last call
  - how its graded calls turned out
  - what following it would have returned.

  A chart shows following every graded pick against the S&P 500 over the same windows.

## Version 24 (2026-10-26)
- The AI day-trade plan also gets the ML model's next-session odds and out-of-sample record. They count only with a
  clear edge.

## Version 23 (2026-10-26)
- **Market regimes (unsupervised machine learning)** in the Market Brain. k-means clusters three years of S&P 500
  days by trend, volatility, distance from the 200-day average and drawdown. You see:
  - which regime today belongs to and since when
  - a year-long strip of regimes
  - for each regime, what the S&P 500 did over the following month (average and how often it rose, with the number
    of independent months).
  The regime goes to every AI on the desk and into the daily market call.
- **Machine-learning scan** (Opportunities → Watchlist scanner). The ML model is trained on every name in your
  watchlist and holdings, and the names are ranked with clear out-of-sample edges first. Each forecast is logged and
  graded, and the AI triage sees the results.

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
