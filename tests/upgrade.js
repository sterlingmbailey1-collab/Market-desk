// Upgrade test: a viewer whose settings were saved by an older version (7-widget dashboard) opens the
// current page. claude.ai storage returns frozen documents, so the app must copy before changing them.
// Usage: node tests/upgrade.js dist/market-desk.html
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const T = __dirname, V = path.join(__dirname, "..", "vendor"), page_ = path.resolve(process.argv[2] || path.join(__dirname, "..", "dist", "market-desk.html"));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route("https://cdn.jsdelivr.net/**", r => r.fulfill({ body: fs.readFileSync(path.join(V, "decimal.js"), "utf8"), contentType: "application/javascript" }));
  await ctx.route("https://unpkg.com/**", r => r.fulfill({ body: fs.readFileSync(path.join(V, "lightweight-charts.standalone.production.js"), "utf8"), contentType: "application/javascript" }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "", contentType: "text/css" }));
  await ctx.addInitScript(() => { if (!localStorage.getItem("__mockdb")) localStorage.setItem("__mockdb", JSON.stringify([["data/users/u_test/md/settings/main", { displayCurrency: "USD", reportingCurrency: "USD", mode: "intermediate", dashboard: ["changes", "portfolio", "fx", "watch", "alerts", "catalysts", "data"], universe: ["SPY", "AAPL"] }]])); });
  await ctx.addInitScript({ path: path.join(T, "bet-fixtures.js") });
  await ctx.addInitScript({ content: "window.__smartFixtures = " + JSON.stringify(Object.fromEntries(["capitol-pelosi-p1", "capitol-pelosi-p2", "dataroma-brk", "dataroma-brk-activity", "vi-nba-props", "espn-nba-gamelog", "espn-nba-gamelog-2026"].map(f => [f, require("fs").readFileSync(path.join(T, "real", f + ".md"), "utf8")]))) });
  await ctx.addInitScript({ path: path.join(T, "mock-runtime.js") });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", e => errs.push(e.message));
  await p.goto("file://" + page_ + "#dashboard");
  await p.waitForTimeout(4000);
  const txt = await p.locator("body").innerText();
  const results = [
    ["starts with settings saved by an older version", !/failed to start/i.test(txt) && await p.locator(".nav a").count() === 19],
    ["older dashboard gains the Betting today card", /Betting today/i.test(txt)],
    ["older dashboard gains the Smart Money card", /Smart Money/i.test(await p.locator("#content").innerText()) && /Open Smart Money/i.test(txt)],
    ["no uncaught errors", errs.length === 0]
  ];
  let fail = 0; for (const [n, ok] of results) { console.log((ok ? "PASS " : "FAIL ") + n); if (!ok) fail++; }
  if (errs.length) console.log(errs.join("\n"));
  await browser.close(); process.exit(fail ? 1 : 0);
})();
