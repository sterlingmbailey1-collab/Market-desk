// Day-trading and market adapters against real captured responses (Nasdaq through Exa, Twelve Data connector).
globalThis.Decimal = require("../vendor/decimal.js");
require("../src/core.js"); require("../src/quant.js"); require("../src/data.js");
const fs = require("fs"), D = MD.data, Q = MD.quant, R = (f) => fs.readFileSync(__dirname + "/real/" + f, "utf8");
let fail = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };
const pages = [[/\/MSFT\/chart/, "nasdaq-chart-msft.md"], [/\/NVDA\/summary/, "nasdaq-summary-nvda.md"], [/marketmovers.*preMarket/, "nasdaq-movers-premarket.md"], [/screener\/stocks.*exchange=nyse&sector=energy/, "nasdaq-screener-nyse-energy.md"]];
D.init({ async callTool(server, tool, input) {
  if (server === "Exa") { const u = input.urls[0], hit = pages.find(([re]) => re.test(u)); if (!hit) throw Object.assign(new Error("no fixture for " + u), { code: "not_found" }); return { content: [{ type: "text", text: R(hit[1]).replace(/^<!--.*-->$/m, "") }] }; }
  if (server === "Twelve Data" && tool === "get_time_series") return { content: [{ type: "text", text: JSON.stringify({ result: R("twelvedata-aapl-5min.csv") }) }] };
  throw Object.assign(new Error("unexpected " + server), { code: "not_found" });
} });
(async () => {
  const it = await D.stocks.intraday("MSFT", "stock");
  ok(it.points.length === 14 && it.points[0].et === 240 && it.points[13].et === 253, "real Nasdaq minute chart: 14 points from 4:00 AM ET (" + it.points.length + ")");
  ok(it.previousClose === 521.08 && it.volume === 13681266 && it.last === 524.51, "previous close, session volume and last sale");
  ok(it.pre && it.pre.high === 518.26 && it.pre.low === 515.99 && it.pre.last === 517.6657 && it.regular === null && it.openSec === null, "pre-market range; no regular session in the cut capture");
  ok(it.points[0].time === 1792728000 - D.tzOffsetSec("America/New_York") && Q.nyParts(new Date(it.points[0].time * 1000)).ymd === "2026-10-23", "Nasdaq's wall-clock timestamps converted to real UTC (4:00 AM ET on Oct 23)");
  const pr = await D.stocks.profile("NVDA", "stock");
  ok(pr.sector === "Technology" && pr.industry === "Semiconductors" && pr.avgVolume === 114391116 && pr.volume === 80191997 && pr.target1y === 315 && pr.previousClose === 212.21, "real Nasdaq summary: sector, industry, volumes, 1-year target");
  const mv = await D.stocks.movers("preMarket");
  ok(mv.asOf === "Oct 23, 2026 4:15 PM ET" && mv.active.rows.length === 10 && mv.active.rows[5].symbol === "SPCX" && mv.active.rows[5].price === 147.49 && mv.active.rows[5].volume > 1e8, "real pre-market movers: as-of, most active with price and volume");
  const sc = await D.stocks.screen({ exchange: "nyse", sector: "energy", limit: 5 });
  ok(sc.rows.length === 5 && sc.total === 122 && sc.asOf === "Oct 22, 2026" && sc.rows[0].symbol === "XOM" && sc.rows[0].name === "ExxonMobil Holdings Corporation" && sc.rows[0].price === 178.23 && sc.rows[4].changePct === -4.009 && sc.rows[0].marketCap === 732866068631 && sc.rows[0].exchange === "NYSE", "real Nasdaq screener with exchange and sector filters: rows, total matches, as-of");
  const ib = await D.intradayBars({ id: "stock:AAPL", cls: "stock", symbol: "AAPL" });
  const off = D.tzOffsetSec("America/New_York");
  ok(ib.bars.length === 4 && ib.date === "2026-10-23" && ib.bars[0].time === Date.parse("2026-10-23T15:40:00Z") / 1000 - off && ib.bars[3].volume === 9480724, "real Twelve Data 5-minute bars: oldest first, New York time converted to UTC, volume kept");
  const vw = Q.vwap(ib.bars);
  ok(vw && vw.last > 347.4 && vw.last < 347.8 && Math.abs(vw.volume - (9480724 + 748345 + 340266 + 285709)) < 1, "VWAP over the real bars weights the closing-auction bar (" + vw.last.toFixed(3) + ")");
  console.log(fail ? fail + " failed" : "all passed"); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
