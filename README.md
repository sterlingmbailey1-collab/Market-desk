# Market Desk

A multi-asset market desk that runs as a single page inside claude.ai: live prices and charts for stocks,
ETFs, crypto, currencies and precious metals; trading-card prices and sold listings; prediction markets;
a portfolio with currency-aware cost basis, risk analysis, stress test and rebalancing helper; Smart Money (Congress
trades and superinvestor 13F portfolios ranked by measured return); AI research, an AI advisor, Ask AI on every page,
AI quick takes and bull-vs-bear debates, recommendations and an idea finder, all reviewed by a second AI pass and
scored against their own track record; and a Sports Betting tab with odds by sportsbook, fair win chances, AI game
forecasts, NBA and NFL player props, value and arbitrage finders, calculators, a bet slip and a bet tracker.

Live page (private to its owner): https://claude.ai/artifact/2xMeHkV6MPetc5mjHmTQiE

## Working on it

```sh
npm install                 # only needed for the browser tests (Playwright)
npm run build               # → dist/market-desk.html
npm test                    # unit + parser tests (no browser needed)
npm run e2e                 # browser tests; needs Playwright with Chromium
```

The page reads data through the viewer's own claude.ai connectors (Exa, Twelve Data, Zacks Data, Statz
and others), so it holds no API keys. It only reads data: it never trades, places bets or moves money.

See `CLAUDE.md` for architecture, data sources and publishing notes, and `CHANGELOG.md` for what changed.

Not investment or betting advice. If gambling stops being fun, call or text 1-800-GAMBLER (US) or visit
BeGambleAware (UK).
