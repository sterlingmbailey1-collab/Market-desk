// Smart Money parsers (real captured pages in tests/real/) and return maths.
globalThis.Decimal = require("../vendor/decimal.js");
require("../src/core.js");
const num = (s) => { const n = parseFloat(String(s ?? "").replace(/[$,%\s]/g, "")); return isFinite(n) ? n : null; };
globalThis.MD.data = { connector: () => ({ call: async () => ({}) }), fetchRaw: async () => "", historyFor: async () => { throw new Error("offline"); }, DataError: Error, num, stocks: { ETFS: [["SPY", "SPDR S&P 500"]] } };
require("../src/smartmoney.js");
const fs = require("fs"), M = MD.smart;
let fail = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const real = (f) => fs.readFileSync(__dirname + "/real/" + f, "utf8");

// dates and size buckets
ok(M.dmy("8 Sept 2026") === "2026-09-08" && M.dmy("24 Aug 2026") === "2026-08-24" && M.dmy("nope") === null, "dates like '8 Sept 2026'");
const s1 = M.sizeRange("500K–1M"), s2 = M.sizeRange("$1,001 - $15,000"), s3 = M.sizeRange("< 1K"), s4 = M.sizeRange("50M+");
ok(s1.low === 5e5 && s1.high === 1e6 && s1.mid === 7.5e5, "size 500K–1M");
ok(s2.low === 1001 && s2.high === 15000, "FMP size $1,001 - $15,000");
ok(s3.low === 0 && s3.high === 1000 && s4.low === 5e7 && s4.high === null, "open-ended sizes");

// Capitol Trades page 1
const p1 = M.parseCapitol(real("capitol-pelosi-p1.md"), "P000197");
ok(p1.name === "Nancy Pelosi" && p1.party === "Democrat" && p1.chamber === "House" && p1.state === "California", "member header: " + [p1.name, p1.party, p1.chamber, p1.state].join(" / "));
ok(p1.tradesCount === 51 && p1.issuersCount === 23 && p1.volume === 109.81e6 && p1.lastTraded === "2026-09-08", "trade count, issuers, volume, last traded");
ok(p1.trades.length === 15, "15 trades on page 1 (" + p1.trades.length + ")");
const t0 = p1.trades[0], t1 = p1.trades[1];
ok(t0.ticker === null && t0.issuer === "REOF XXX LLC" && t0.traded === "2026-09-08" && t0.published === "2026-10-05", "private fund row has no ticker");
ok(t1.ticker === "BE" && t1.issuer === "Bloom Energy Corp" && t1.type === "buy" && t1.filedAfterDays === 28 && t1.size.label === "1M–5M", "listed row: ticker, type, delay, size");
ok(p1.trades.filter(t => t.type === "sell").length === 1 && p1.trades.find(t => t.type === "sell").ticker === "GOOGL", "sell row");
ok(p1.sectors[0].name === "Information Technology" && p1.sectors[0].count === 23 && p1.topIssuers[0].name === "NVIDIA Corporation", "most traded sectors and issuers");
ok(p1.pages === 4, "page count inferred from the trade count (" + p1.pages + ")");
// page 2 (a separate crawl with a squashed header)
const p2 = M.parseCapitol(real("capitol-pelosi-p2.md"), "P000197");
ok(p2.trades.length === 15 && p2.page === 2 && p2.pages === 4, "page 2: 15 trades, page 2 of 4");
ok(p2.tradesCount === 43 && p2.lastTraded === "2026-05-29", "squashed header still parses");
ok(p2.trades.some(t => t.type === "exchange" && t.ticker === "VSNT" && t.size.high === 1000), "exchange row keeps its type, '< 1K' size");

// Dataroma
const brk = M.parseHoldings(real("dataroma-brk.md"), "BRK");
ok(brk.manager === "Warren Buffett - Berkshire Hathaway" && brk.period === "Q2 2026" && brk.portfolioDate === "2026-06-30" && brk.stocksCount === 29 && brk.value === 299253558000, "13F header");
ok(brk.holdings.length === 11 && brk.holdings[10].symbol === "KHC" && brk.holdings[10].changePct === 5 && brk.holdings[10].high52 === null, "a row cut after its change column is kept (" + brk.holdings.length + ")");
const aapl = brk.holdings[0], googl = brk.holdings.find(x => x.symbol === "GOOGL");
ok(aapl.symbol === "AAPL" && aapl.weightPct === 22.04 && aapl.reportedPrice === 289.36 && aapl.currentPrice === 347.73 && aapl.changePct === 20.17 && aapl.high52 === 351.73, "holding row fields");
ok(googl.activity === "Add 45.24%" && googl.activityKind === "Add" && !aapl.activityKind, "recent activity");
const act = M.parseActivity(real("dataroma-brk-activity.md"));
ok(act.length >= 20 && act[0].quarter === "Q2 2026" && act[0].symbol === "GOOG" && act[0].action === "Add" && act[0].changePct === 658.35, "activity rows by quarter");
ok(act.some(r => r.symbol === "STZ" && r.action === "Sell") && act.some(r => r.quarter === "Q1 2026" && r.symbol === "DAL" && r.action === "Buy"), "sells and new buys");

// FMP latest filings
const fmp = M.normalizeFmp([{ symbol: "NVDA", senateID: "F000110", disclosureDate: "2026-10-23", transactionDate: "2026-10-01", firstName: "Cleo", lastName: "Fields", office: "Cleo Fields", district: "LA06", owner: "", assetDescription: "NVIDIA Corporation", assetType: "Stock", type: "Purchase", amount: "$1,001 - $15,000", link: "https://disclosures-clerk.house.gov/x.pdf" }], "House");
ok(fmp[0].member === "Cleo Fields" && fmp[0].type === "buy" && fmp[0].size.high === 15000 && fmp[0].bioguide === "F000110", "FMP rows normalized");

// returns
const day = (s) => Date.parse(s + "T00:00:00Z") / 1000;
const series = (pairs) => pairs.map(([d, c]) => ({ time: day(d), close: c }));
const aaa = series([["2026-01-02", 100], ["2026-01-05", 102], ["2026-02-02", 110], ["2026-03-02", 120]]);
const spy = series([["2026-01-02", 500], ["2026-01-05", 505], ["2026-02-02", 510], ["2026-03-02", 525]]);
ok(M.closeOn(aaa, "2026-01-04").close === 100, "weekend date uses the prior close");
ok(M.closeOn(aaa, "2025-12-01") === null, "no close more than a week before");
const trades = [
  { issuer: "AAA Inc", ticker: "AAA", traded: "2026-01-02", published: "2026-02-02", type: "buy", size: M.sizeRange("1K–15K") },
  { issuer: "AAA Inc", ticker: "AAA", traded: "2026-02-02", published: "2026-03-02", type: "buy", size: M.sizeRange("15K–50K") },
  { issuer: "Fund LLC", ticker: null, traded: "2026-01-02", published: "2026-02-02", type: "buy", size: M.sizeRange("1K–15K") },
  { issuer: "AAA Inc", ticker: "AAA", traded: "2026-02-02", published: "2026-03-02", type: "sell", size: M.sizeRange("1K–15K") }];
const rows = M.measureTrades(trades, new Map([["AAA", aaa]]), spy);
ok(near(rows[0].ret, 20) && near(rows[0].spyRet, 5) && near(rows[0].excess, 15) && near(rows[0].retPub, (120 / 110 - 1) * 100), "trade return, SPY and copy return");
ok(rows[2].ret === null && rows[2].why === "Not a listed US security", "unlisted trade not priced");
const sum = M.summarize(rows, null, Date.parse("2026-03-03"));
const w1 = 8000, w2 = 32500, r2 = (120 / 110 - 1) * 100;
ok(sum.n === 2 && near(sum.ret, (w1 * 20 + w2 * r2) / (w1 + w2)), "size-weighted summary of buys only");
ok(near(sum.hitRate, 100) && near(sum.best.ret, 20), "hit rate and best trade");
const recent = M.summarize(rows, 40, Date.parse("2026-03-03"));
ok(recent.n === 1 && near(recent.ret, r2), "window keeps only recent buys");
const net = M.netPositions(trades);
ok(net[0].ticker === "AAA" && net[0].bought === 8000 + 32500 && net[0].sold === 8000 && net[0].net === 32500, "net disclosed buying");
const cv = M.copyCurve(rows, new Map([["AAA", aaa]]), spy, 1000);
ok(cv && cv.legs === 2 && near(cv.invested, 2000), "copy-trade backtest legs");
ok(near(cv.value, 1000 * 120 / 110 + 1000 * 120 / 120) && near(cv.ret, (cv.value / 2000 - 1) * 100), "copy-trade value at the latest close");
ok(near(cv.spyRet, ((1000 * 525 / 510 + 1000) / 2000 - 1) * 100), "same money in SPY on the same days");

// projection model
const pj = M.project({ excessPct: 20, years: 1, n: 20, k: 20, volPct: 25, riskFreePct: 4 });
ok(near(pj.marketPct, 9) && near(pj.shrink, 0.5) && near(pj.alphaAnnPct, 20) && near(pj.driftPct, 19), "drift = market + shrunk excess");
ok(near(pj.horizons["1Y"].mean, 19) && pj.horizons["1Y"].p05 < 0 && pj.horizons["1Y"].p95 > 40, "1Y mean and a wide range");
ok(pj.horizons["1M"].mean > 0 && pj.horizons["1M"].mean < pj.horizons["3M"].mean, "horizons scale with time");
const capped = M.project({ excessPct: 300, years: 0.1, n: 1000, k: 20, riskFreePct: 4 });
ok(near(capped.alphaAnnPct, 40) && capped.horizons["1Y"].p05 === null, "excess capped at 40%; no range without volatility");
ok(near(M.project({ excessPct: 10, years: 1, n: 0, riskFreePct: 4 }).driftPct, 9), "no evidence → market return");

// consensus
const cons = M.consensus([{ name: "A", trades: [{ ticker: "AAA", issuer: "AAA Inc", traded: new Date().toISOString().slice(0, 10), type: "buy", size: M.sizeRange("1K–15K") }] }], [{ name: "B", holdings: [{ symbol: "AAA", name: "AAA Inc", activityKind: "Add" }, { symbol: "BBB", name: "B Co", activityKind: null }] }]);
ok(cons.length === 1 && cons[0].people === 2 && cons[0].politicians[0] === "A" && cons[0].investors[0] === "B", "consensus counts politicians and investors");

console.log(fail ? fail + " failed" : "all passed");
process.exit(fail ? 1 : 0);
