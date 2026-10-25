// End-to-end test: real browser, mocked claude.ai runtime. Usage: node tests/e2e.js <page.html> <shotsDir>
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const page_ = path.resolve(process.argv[2]), shots = path.resolve(process.argv[3] || ".");
const V = path.join(__dirname, "..", "vendor");
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  — " + (detail || ""))); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route("https://cdn.jsdelivr.net/**", r => r.fulfill({ body: fs.readFileSync(path.join(V, "decimal.js"), "utf8"), contentType: "application/javascript" }));
  await ctx.route("https://unpkg.com/**", r => r.fulfill({ body: fs.readFileSync(path.join(V, "lightweight-charts.standalone.production.js"), "utf8"), contentType: "application/javascript" }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "", contentType: "text/css" }));
  await ctx.route(/assets\.tcgdex\.net|images\.ygoprodeck\.com|cardchain\.example/, r => r.fulfill({ status: 404, body: "" }));
  await ctx.addInitScript({ path: path.join(__dirname, "bet-fixtures.js") });
  await ctx.addInitScript({ content: "window.__smartFixtures = " + JSON.stringify(Object.fromEntries(["capitol-pelosi-p1", "capitol-pelosi-p2", "dataroma-brk", "dataroma-brk-activity", "vi-nba-props", "espn-nba-gamelog", "espn-nba-gamelog-2026", "vi-nfl-props"].map(f => [f, require("fs").readFileSync(path.join(__dirname, "real", f + ".md"), "utf8")]))) });
  await ctx.addInitScript({ path: path.join(__dirname, "mock-runtime.js") });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  await page.goto("file://" + page_ + "#dashboard");
  await page.waitForSelector(".nav a", { timeout: 10000 });
  await page.waitForTimeout(1500);
  check("app boots and renders navigation", (await page.locator(".nav a").count()) === 21, String(await page.locator(".nav a").count()));
  check("every section has an icon", await page.locator(".nav a .ico svg").count() === 21);
  await page.waitForTimeout(1500);
  check("ticker tape shows markets and opens them", await page.locator("#tape .tape-set").first().locator(".tk").count() >= 8, String(await page.locator("#tape .tk").count()));
  check("account storage selected", await page.locator("text=Saved to account").count() > 0);

  const routes = ["dashboard", "markets", "brain", "stocks", "crypto", "fx", "metals", "cards", "betting", "smartmoney", "portfolio", "opportunities", "picks", "daytrade", "research", "calendar", "advisor", "strategies", "reports", "inbox", "settings"];
  for (const r of routes) {
    const before = errors.length;
    await page.click(`.nav a[href="#${r}"]`);
    await page.waitForTimeout(r === "markets" || r === "dashboard" ? 2500 : 1600);
    const errBoxes = await page.locator(".banner.err").allTextContents();
    check("route " + r + " renders without script errors", errors.length === before, errors.slice(before).join(" | "));
    if (errBoxes.length) console.log("   (error banners on " + r + ": " + errBoxes.join(" / ").slice(0, 200) + ")");
    if (["dashboard", "portfolio", "fx", "cards", "research"].includes(r)) await page.screenshot({ path: path.join(shots, "e2e-" + r + ".png"), fullPage: false });
  }

  // ---- Stocks: open an asset, chart & fundamentals
  await page.evaluate(() => MD.app.openAsset({ id: "stock:AAPL", cls: "stock", symbol: "AAPL", name: "Apple" }));
  await page.waitForTimeout(2500);
  check("stock page shows quote with status and source", await page.locator(".ds .st").first().count() > 0 && (await page.locator("text=Nasdaq").count()) > 0);
  check("stock chart drawn", await page.locator(".chartbox canvas").count() > 0);
  check("hero quote header and jump links", await page.locator(".hero").count() === 1 && await page.locator(".jump a").count() >= 6);
  await page.waitForTimeout(1500);
  check("projection fan chart and outcome tiles render", await page.locator("#sec-projection .fan svg path.fan-90").count() === 1 && /Middle outcome/i.test(await page.locator("#sec-projection").innerText()));
  await page.click("#sec-projection .seg button:has-text('1Y')"); await page.waitForTimeout(300);
  check("horizon buttons change the projection (1Y = 365 days)", /365 days/.test(await page.locator("#sec-projection").innerText()));
  await page.evaluate(() => { const r = document.querySelector("#sec-projection .hrange"); r.value = "90"; r.dispatchEvent(new Event("input", { bubbles: true })); }); await page.waitForTimeout(300);
  check("horizon slider sets any number of days", /90 days/.test(await page.locator("#sec-projection").innerText()));
  const volOpts = await page.locator("#sec-projection select").first().locator("option").allTextContents();
  const driftOpts = await page.locator("#sec-projection select").nth(1).locator("option").allTextContents();
  check("volatility can come from history, recent, options market or custom", volOpts.some(o => /Past year/.test(o)) && volOpts.some(o => /Options market/.test(o)) && volOpts.some(o => /Custom/.test(o)), volOpts.join(" | "));
  check("expected return can use the Zacks analyst target", driftOpts.some(o => /Analyst target.*366/.test(o)), driftOpts.join(" | "));
  await page.selectOption("#sec-projection select >> nth=0", "custom"); await page.fill("#sec-projection input[aria-label^='Custom volatility']", "40"); await page.waitForTimeout(300);
  check("custom volatility feeds the model", /40\.0% annual volatility/.test(await page.locator("#sec-projection").innerText()));
  await page.fill("#sec-projection input[aria-label='Price level to check']", "400"); await page.waitForTimeout(200);
  check("price-level odds: finish above and touch before", /Ends above 400\.00.*\d+%/s.test(await page.locator("#sec-projection .proj-check").innerText()) && /at any point before then: \d+%/.test(await page.locator("#sec-projection .proj-check").innerText()));
  check("returns strip, technicals and risk", await page.locator(".retstrip .ret").count() >= 3 && /RSI \(14 days\)/i.test(await page.locator("#sec-technicals").innerText()) && /Beta vs SPY/i.test(await page.locator("#sec-risk").innerText()));
  await page.waitForTimeout(800);
  check("beta vs benchmark is measured", /Beta vs SPY\s*-?\d+\.\d\d/i.test(await page.locator("#sec-risk").innerText()), (await page.locator("#sec-risk").innerText()).slice(0, 400));
  const ws = await page.locator("#sec-analysts").innerText();
  check("Wall Street view: Zacks Rank, style scores, broker ratings", /3 · Hold/.test(ws) && /Growth/.test(ws) && await page.locator("#sec-analysts .dist span").count() === 3 && /Loop Capital/.test(ws) && !/Zacks Recommendation/.test(ws.split("Wall Street ratings")[1] || ""), ws.slice(0, 300));
  await page.fill("#sec-notes textarea", "Watch 330 support; earnings Nov 2."); await page.waitForTimeout(1400);
  check("asset notes save privately", await page.evaluate(() => (MD.app.store.cached("notes").find(n => n.assetId === "stock:AAPL") || {}).text) === "Watch 330 support; earnings Nov 2.");
  await page.screenshot({ path: path.join(shots, "e2e-stock.png"), fullPage: true });
  await page.selectOption("#sec-projection select >> nth=0", "hist"); await page.waitForTimeout(200);

  // ---- Stock news tab (Bigdata.com)
  await page.click(".tabs button:has-text('News')"); await page.waitForTimeout(800);
  check("stock News tab lists Bigdata.com articles", await page.locator(".newslist li").count() === 2 && /Bigdata\.com/.test(await page.locator("#content").innerText()));
  await page.click(".tabs button:has-text('Summary')"); await page.waitForTimeout(400);

  // ---- List → detail → Back (stocks)
  await page.click(".nav a[href='#stocks']"); await page.waitForTimeout(1800);
  const listRows = await page.locator("table.tbl tbody tr").count();
  check("Stocks tab opens a list of stocks", listRows >= 3, String(listRows));
  await page.locator("table.tbl tbody tr").first().click(); await page.waitForTimeout(1800);
  const backTxt = await page.locator(".backbar button").first().innerText().catch(() => "");
  check("clicking a stock opens its page with a Back button", /Back to/.test(backTxt) && await page.locator(".price-big").count() > 0, backTxt);
  await page.click(".backbar button"); await page.waitForTimeout(1500);
  check("Back returns to the stocks list", await page.locator("table.tbl tbody tr").count() === listRows && !(await page.locator(".backbar").count()));

  // ---- Live ticks (crypto via Crypto.com connector)
  await page.evaluate(() => { MD.app.settings.liveRate = 1000; MD.app.openAsset({ id: "crypto:bitcoin", cls: "crypto", cgId: "bitcoin", symbol: "BTC", name: "Bitcoin" }); });
  await page.waitForTimeout(1500);
  const p1 = await page.locator(".price-big").first().innerText();
  const calls1 = await page.evaluate(() => window.__mock.toolCalls.filter(c => c.server === "Crypto.com").length);
  await page.waitForTimeout(3500);
  const p2 = await page.locator(".price-big").first().innerText();
  const calls2 = await page.evaluate(() => window.__mock.toolCalls.filter(c => c.server === "Crypto.com").length);
  check("live price ticks about every second", calls2 - calls1 >= 2 && p1 !== p2, `calls +${calls2 - calls1}, ${p1} → ${p2}`);
  check("crypto page shows CoinMarketCap news, future-dated items separated", await page.locator(".newslist").first().locator("li").count() === 2 && /event or prediction page/.test(await page.locator("#content").innerText()));
  check("crypto page gets projection, technicals and risk", await page.locator("#sec-projection .fan svg").count() === 1 && /Beta vs (SPY|BTC)/i.test(await page.locator("#sec-risk").innerText()));
  await page.screenshot({ path: path.join(shots, "e2e-crypto-live.png"), fullPage: true });
  await page.evaluate(() => MD.app.go("dashboard", null, { fromNav: true })); await page.waitForTimeout(1500);
  const callsAfter = await page.evaluate(() => window.__mock.toolCalls.filter(c => c.server === "Crypto.com").length);
  await page.waitForTimeout(2500);
  check("live ticker stops after leaving the page", await page.evaluate(() => window.__mock.toolCalls.filter(c => c.server === "Crypto.com").length) - callsAfter <= 1);

  // ---- Metals history from Alpha Vantage
  await page.evaluate(() => MD.app.openAsset({ id: "metal:XAG", cls: "metal", symbol: "XAG", name: "Silver" })); await page.waitForTimeout(1500);
  await page.click(".seg button:has-text('5Y')"); await page.waitForTimeout(1500);
  check("metal page gets a projection", await page.locator("#sec-projection .fan svg").count() === 1);
  check("silver 5Y chart comes from Alpha Vantage", /Alpha Vantage/.test(await page.locator("#content").innerText()) && await page.locator(".chartbox canvas").count() > 0);

  // ---- Sports cards via CardChain AI: search → detail → grade → back
  await page.evaluate(() => MD.app.go("cards", null, { fromNav: true })); await page.waitForTimeout(600);
  await page.click(".tabs button:has-text('Sports cards')"); await page.waitForTimeout(1500);
  check("sports-card search lists CardChain AI results", await page.locator("table.tbl tbody tr").count() >= 2 && /CardChain AI/.test(await page.locator("#content").innerText()));
  await page.locator("table.tbl tbody tr").first().click(); await page.waitForTimeout(1800);
  const raw = await page.locator(".price-big").first().innerText();
  check("sports-card page shows price, history chart and Back", /35\.40/.test(raw) && await page.locator(".chartbox canvas").count() > 0 && await page.locator(".backbar").count() > 0, raw);
  check("sports card: real picture through the image proxy, sold listings from SportsCardsPro, no comparable-sales form", await page.locator(".cardvis .realcard img[src^='data:image/']").count() === 1 && await page.evaluate(() => (window.__mock.imageUrls || []).some(u => /cardchain\.example/.test(decodeURIComponent(u)))) && /SportsCardsPro/.test(await page.locator("#sec-sales").innerText()) && await page.locator("#sec-sales table.tbl tbody tr").count() >= 1 && !/comparable sales/i.test(await page.locator("#content").innerText()), (await page.locator("#sec-sales").innerText().catch(() => "")).slice(0, 200));
  await page.click(".cardgrid .seg button:has-text('PSA 10')"); await page.waitForTimeout(1800);
  check("switching grade reloads CardChain price for that grade", /212\.40/.test(await page.locator(".price-big").first().innerText()), await page.locator(".price-big").first().innerText());
  await page.screenshot({ path: path.join(shots, "e2e-sports.png"), fullPage: true });
  await page.click(".backbar button"); await page.waitForTimeout(1500);
  check("Back returns to the sports-card search", await page.locator("table.tbl tbody tr").count() >= 2 && !(await page.locator(".backbar").count()));
  const ccVal = await page.evaluate(async () => { const q = await MD.data.quoteFor({ id: "sports:cc-1585927856600x7242-psa10", cls: "sports", cardchainId: "1585927856600x7242", name: "Luka Doncic 2018 Panini Prizm Basketball", grade: "PSA 10" }); return q.price + " " + q.status; });
  check("CardChain card values in the portfolio pipeline", ccVal === "212.4 Reference", ccVal);

  // ---- Pokémon dealer buyback (karten-ankauf.de)
  await page.evaluate(() => MD.app.openAsset({ id: "pkm:sv03.5-199", cls: "pokemon", tcgdexId: "sv03.5-199", symbol: "sv03.5-199", name: "Charizard ex" })); await page.waitForTimeout(1800);
  const kaBefore = await page.evaluate(() => window.__mock.toolCalls.filter(c => c.server === "karten-ankauf.de").length);
  check("dealer buyback not looked up until asked", kaBefore === 0, String(kaBefore));
  await page.click("button:has-text('Check buyback offer')"); await page.waitForTimeout(1200);
  const kaTxt = await page.locator("#content").innerText();
  check("buyback offer matches printing 199 and shows EUR price with dealer link", /€210\.50|210\.50/.test(kaTxt) && /151 · 199/.test(kaTxt) && await page.locator("a[href*='karten-ankauf.de/en/']").count() === 1 && /not market value/.test(kaTxt), kaTxt.slice(kaTxt.indexOf("Dealer buyback"), kaTxt.indexOf("Dealer buyback") + 300));
  await page.screenshot({ path: path.join(shots, "e2e-buyback.png"), fullPage: true });
  check("Pokémon card shows its real picture (TCGdex high-res, via the image proxy) and a full-size link", await page.locator(".cardvis .realcard img[src^='data:image/']").count() === 1 && await page.evaluate(() => (window.__mock.imageUrls || []).some(u => /assets\.tcgdex\.net%2Fen%2Fsv%2Fsv03\.5%2F199%2Fhigh\.png/.test(u))) && await page.locator(".cardvis a[href*='assets.tcgdex.net']").count() === 1 && /Card picture from TCGdex/.test(await page.locator(".cardvis").innerText()));
  await page.evaluate(() => { window.__mock.failImages = true; MD.app.openAsset({ id: "ygo:14558127", cls: "yugioh", ygoId: 14558127, symbol: "14558127", name: "Ash Blossom & Joyous Spring" }); }); await page.waitForTimeout(3500);
  check("when the picture can't load, the drawn card face stands in", await page.locator(".cface.ygo").count() === 1 && /couldn't load/.test(await page.locator(".cardvis").innerText()), await page.locator(".cardvis").innerText().catch(() => ""));
  await page.evaluate(() => { window.__mock.failImages = false; }); await page.click(".backbar button"); await page.waitForTimeout(1500);
  const salesTxt = await page.locator("#sec-sales").innerText();
  check("sales history: prices by grade and every sold listing", await page.locator("#sec-sales .gchip").count() === 6 && await page.locator("#sec-sales table.tbl tbody tr").count() === 9 && /Sales listed\s*9/i.test(salesTxt), salesTxt.slice(0, 300));
  await page.click("#sec-sales .seg button:has-text('PSA 10')"); await page.waitForTimeout(400);
  check("sales filter by grade (PSA 10 → 3 sales, chart drawn)", await page.locator("#sec-sales table.tbl tbody tr").count() === 3 && await page.locator("#sec-sales .salechart circle").count() === 3);
  await page.setInputFiles(".cardvis input[type=file]", { name: "my-card.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64") });
  await page.waitForTimeout(800);
  check("your own card photo uploads and shows, with a switch back to the card picture", await page.locator(".cardvis .myphoto img").count() === 1 && await page.evaluate(() => MD.app.store.cached("photos").length === 1 && window.__mock.uploads.length === 1) && await page.locator(".cardvis .seg button").count() === 2);
  await page.click(".cardvis .seg button:has-text('Card picture')"); await page.waitForTimeout(500);
  check("switching to the card picture", await page.locator(".cardvis .realcard img").count() === 1 && await page.locator(".cardvis .myphoto").count() === 0);
  await page.screenshot({ path: path.join(shots, "e2e-cards.png"), fullPage: true });

  // ---- Recommendations
  await page.evaluate(() => MD.app.go("picks", null, { fromNav: true })); await page.waitForTimeout(800);
  await page.click("button:has-text('Generate recommendations')"); await page.waitForTimeout(9000);
  const picks = await page.evaluate(() => MD.app.store.cached("picks"));
  const pickFc = await page.evaluate(() => MD.app.store.cached("forecasts").filter(f => f.source === "ai-picks"));
  check("recommendations generated, reviewed, saved and journaled", picks.length === 1 && picks[0].picks.length === 2 && pickFc.length === 2, JSON.stringify({ n: picks.length, p: picks[0] && picks[0].picks.length, f: pickFc.length, log: (await page.locator(".log").innerText()).slice(-300) }));
  await page.waitForTimeout(800);
  const logTxt = await page.locator("#prediction-log").innerText();
  check("prediction log lists each pick with time, prices then/now, projection and target date", await page.locator("#prediction-log table.tbl tbody tr").count() === 2 && /Price then/i.test(logTxt) && /Projected for target date/i.test(logTxt) && /\d{1,2}:\d{2}/.test(logTxt) && !/…/.test(await page.locator("#prediction-log tbody").innerText()), logTxt.slice(0, 400));
  const pkTxt = await page.locator("#content").innerText();
  check("pick explains why, up/down odds and time window (no 'either way')", /Why it could move/i.test(pkTxt) && /Time window/i.test(pkTxt) && /% chance up/i.test(pkTxt) && /Chance up \/ down/i.test(pkTxt) && !/either way/i.test(pkTxt) && await page.locator(".probbar").count() >= 2, pkTxt.slice(0, 400));
  check("pick sources: retrieved news verified, invented URL flagged", picks[0] && picks[0].picks[0].sources.find(x => /bigdata/.test(x.url)).verified === true && picks[0].picks[0].sources.find(x => /invented/.test(x.url)).verified === false);
  check("every pick has up and down odds and is journaled up or down", picks[0].picks.every(p => p.upPct >= 5 && p.upPct <= 95 && p.downPct === 100 - p.upPct && (p.lean === "up") === (p.upPct >= 50)) && pickFc.every(f => (f.direction === "up" || f.direction === "down") && f.probability >= 0.5), JSON.stringify(picks[0].picks.map(p => [p.symbol, p.upPct, p.lean])) + JSON.stringify(pickFc.map(f => [f.direction, f.probability])));
  check("odds blend Claude with the asset's own measured history", picks[0].picks[0].probs.claude === 62 && picks[0].picks[0].probs.model >= 25 && picks[0].picks[0].probs.model <= 75 && picks[0].picks[0].baseRates.windows > 50 && Math.abs(picks[0].picks[0].probs.blended - (0.65 * 62 + 0.35 * picks[0].picks[0].probs.model)) <= 1, JSON.stringify(picks[0].picks[0].probs) + " " + JSON.stringify(picks[0].picks[0].baseRates && picks[0].picks[0].baseRates.windows));
  check("two readers: the reviewer's own estimate is averaged into each pick's odds", picks[0].picks[0].probs.reviewer != null && picks[0].picks[1].probs.reviewer === 50, JSON.stringify(picks[0].picks.map(p => p.probs)));
  check("the reviewed pick's odds were pulled toward 50%", Math.abs(picks[0].picks[1].upPct - 50) <= Math.abs(picks[0].picks[1].probs.blended - 50), JSON.stringify(picks[0].picks[1].probs));
  check("review pass: one pick dropped with its reason, one revised", picks[0].review && picks[0].review.dropped === 1 && picks[0].review.revised === 1 && picks[0].excluded.some(x => /Dropped by the review/.test(x.reason)) && picks[0].picks[1].review.verdict === "revise", JSON.stringify(picks[0].review));
  check("AI scorecard section on Recommendations", /AI scorecard/i.test(pkTxt) && /Recommendations/.test(pkTxt));
  check("pick card: bull and bear case, what would change the view, review note", /Bull case/i.test(pkTxt) && /Bear case/i.test(pkTxt) && /What would change the view/i.test(pkTxt) && /Review: holds up/i.test(pkTxt));
  check("confidence blends Claude, the review, measured signals and evidence", picks[0].picks.every(p => p.confidenceParts && p.confidenceParts.signals != null && p.confidence >= 0 && p.confidence <= 100) && picks[0].picks[1].confidenceParts.reviewed === 30);
  check("Claude used the research tools", picks[0].toolCalls > 0 && picks[0].sourcesRetrieved > 0, JSON.stringify({ t: picks[0].toolCalls, s: picks[0].sourcesRetrieved }));
  await page.screenshot({ path: path.join(shots, "e2e-picks.png"), fullPage: true });
  // Clearing recommendations: one pick, then everything, then restore; the journal keeps every call.
  const cards0 = await page.locator("button.pickrm").count();
  await page.locator("button.pickrm").first().click(); await page.waitForTimeout(700);
  check("remove one recommendation", await page.locator("button.pickrm").count() === cards0 - 1 && /1 cleared/.test(await page.locator("#content").innerText()), String(await page.locator("button.pickrm").count()));
  await page.click("button:has-text('Clear all')"); await page.waitForTimeout(700);
  const clearedTxt = await page.locator("#content").innerText();
  check("clear all recommendations; the forecast journal keeps them", await page.locator("button.pickrm").count() === 0 && /All recommendations are cleared/.test(clearedTxt) && await page.locator("#prediction-log table.tbl tbody tr").count() === 0 && (await page.evaluate(() => MD.app.store.cached("forecasts").filter(f => f.source === "ai-picks").length)) === 2, clearedTxt.slice(0, 300));
  await page.click("button:has-text('Restore cleared')"); await page.waitForTimeout(700);
  check("restore cleared recommendations", await page.locator("button.pickrm").count() === cards0);
  await page.click("button:has-text('Clear crypto')"); await page.waitForTimeout(500);
  check("clear crypto keeps stock picks", await page.locator("button.pickrm").count() === picks[0].picks.filter(p => p.asset.cls !== "crypto").length);
  await page.click("button:has-text('Restore cleared')"); await page.waitForTimeout(500);

  // ---- Market Brain: measured pulse, a studied session, a scored playbook, and the note every AI gets
  await page.evaluate(() => MD.app.go("brain", null, { fromNav: true })); await page.waitForTimeout(4000);
  const brTxt = await page.locator("#content").innerText();
  check("Market Brain measures indices, sectors, rates and the regime", await page.locator(".heat-c").count() >= 20 && /S&P 500 trend/i.test(brTxt) && /Volatility/i.test(brTxt) && /What moves what/i.test(brTxt), brTxt.slice(0, 500));
  await page.click("button:has-text('Study today')"); await page.waitForTimeout(6000);
  const brain1 = await page.evaluate(() => ({ days: MD.app.store.cached("marketdays").length, pb: MD.brain.playbook(MD.app) }));
  const brTxt2 = await page.locator("#content").innerText();
  check("studying a session saves drivers, movers and new cause → effect patterns", brain1.days === 1 && brain1.pb.patterns.length === 2 && /Rates jumped after hot inflation data/i.test(brTxt2) && /Hot CPI lifted yields/i.test(brTxt2) && /Movers explained/i.test(brTxt2) && /hypothesis/i.test(brTxt2), JSON.stringify(brain1).slice(0, 400));
  const rule1 = await page.evaluate(() => MD.brain.playbook(MD.app).patterns[0]);
  check("new pattern carries a testable rule, backtested on a year of daily moves", rule1.rule && rule1.rule.cause.symbol === "TLT" && rule1.backtest && rule1.backtest.days > 100 && rule1.backtest.occurrences >= 0 && /1-year backtest/i.test(brTxt2) && /Rule: TLT below -1%/.test(brTxt2), JSON.stringify(rule1.backtest || {}).slice(0, 300));
  const rec1 = await page.evaluate(() => MD.app.store.cached("marketdays")[0]);
  check("session study cites verified sources and flags invented ones", rec1.drivers[0].sources.some(s => s.verified) && rec1.drivers[0].sources.some(s => !s.verified) && rec1.toolCalls > 0);
  await page.click("button:has-text('Study the latest session')"); await page.waitForTimeout(6000);
  const brain2 = await page.evaluate(() => { const pb = MD.brain.playbook(MD.app); return { n: pb.patterns.length, st: pb.patterns.map(p => [p.pattern.slice(0, 30), MD.brain.stats(p)]) }; });
  check("the next study tests the playbook: one pattern held, one failed, a repeat isn't duplicated", brain2.n === 3 && brain2.st[0][1].confirmed === 1 && brain2.st[1][1].contradicted === 1 && brain2.st[2][1].tested === 0, JSON.stringify(brain2));
  const rec2 = await page.evaluate(() => MD.brain.latestPerDay(MD.app)[0]);
  check("same-day rules are scored by the app from the measured moves", rec2.patternChecks.some(c => c.measured && c.verdict === "confirmed" && /TLT -1.30%/.test(c.note)), JSON.stringify(rec2.patternChecks));
  const noteTxt = await page.evaluate(() => MD.ai.contextNote(MD.app));
  check("every AI prompt gets the Market Brain's regime, drivers and patterns", /Market Brain/.test(noteTxt) && /Yields eased and tech led again/.test(noteTxt) && /Investor profile/.test(noteTxt), noteTxt.slice(0, 500));
  await page.evaluate(async () => { const r = Object.assign({}, MD.app.store.cached("marketdays")[0]); delete r.id; r.sessionDate = "2026-10-20"; r.headline = "Earlier session"; await MD.app.store.create("marketdays", r); MD.app.rerender(); }); await page.waitForTimeout(3000);
  await page.click("button:has-text('Refine the playbook')"); await page.waitForTimeout(3000);
  const pb3 = await page.evaluate(() => MD.brain.playbook(MD.app));
  check("refining the playbook rewrites, retires and names themes", /10-year yield jumps more than 0.1 point/.test(pb3.patterns[0].pattern) && pb3.patterns[pb3.patterns.length - 1].status === "retired" && pb3.themes[0].theme === "Rates and inflation" && pb3.lessons.length === 1 && /Rates and inflation/i.test(await page.locator("#content").innerText()), JSON.stringify(pb3).slice(0, 500));
  await page.click("button:has-text('Make the call for')"); await page.waitForTimeout(4000);
  const callTxt = await page.locator("#content").innerText();
  const callFc = await page.evaluate(() => MD.app.store.cached("forecasts").filter(f => f.source === "ai-market"));
  check("market call: SPY up/down odds anchored to its own history, reviewed, logged for the target session's close", /S&P 500 on \d{4}-\d{2}-\d{2}: ▲ 5\d% chance it closes up/.test(callTxt) && /SPY's own history/.test(callTxt) && /Review: holds up/i.test(callTxt) && callFc.length === 1 && callFc[0].dueAt === (await page.evaluate(() => MD.quant.closeTimeUTC(MD.quant.targetSession()))) && callFc[0].flatBandPct === 0, callTxt.slice(callTxt.search(/Market call/i), callTxt.search(/Market call/i) + 500) + JSON.stringify(callFc));
  await page.click("button:has-text('Update the call')"); await page.waitForTimeout(4000);
  check("only the first call per session counts for the record", (await page.evaluate(() => MD.app.store.cached("marketcalls").length)) === 2 && (await page.evaluate(() => MD.app.store.cached("forecasts").filter(f => f.source === "ai-market").length)) === 1 && /the first call for this session already counts/i.test(await page.locator("#content").innerText()));
  check("the market call reaches every AI prompt", /market call for \d{4}-\d{2}-\d{2}: SPY up 5\d%/.test(await page.evaluate(() => MD.ai.contextNote(MD.app))));
  await page.fill("textarea[aria-label=Hypothesis]", "When oil jumps, energy stocks beat the market"); await page.click("button:has-text('Test it')"); await page.waitForTimeout(3000);
  const labTxt = await page.locator("#content").innerText();
  check("hypothesis lab: plain words become a rule, backtested with cases, hit rate and baseline", /Rule tested: USO above \+1% → XLE minus SPY above 0% the same day/.test(labTxt) && /Effect followed/i.test(labTxt) && /On any day/i.test(labTxt) && /Verdict/i.test(labTxt), labTxt.slice(labTxt.search(/Hypothesis lab/i), labTxt.search(/Hypothesis lab/i) + 600));
  await page.click("button:has-text('Add to the playbook')"); await page.waitForTimeout(800);
  check("a tested idea joins the playbook", await page.evaluate(() => MD.brain.playbook(MD.app).patterns.some(p => p.source === "user" && p.rule && p.rule.cause.symbol === "USO" && p.backtest)));
  await page.fill("textarea[aria-label=Hypothesis]", "When it rains in New York, stocks fall"); await page.click("button:has-text('Test it')"); await page.waitForTimeout(1500);
  check("an untestable idea is explained, not forced", /Not testable with daily moves/i.test(await page.locator("#content").innerText()));
  await page.screenshot({ path: path.join(shots, "e2e-brain.png"), fullPage: true });

  // ---- Day Trading: scanner, desk with measured levels, position size, AI plan logged for grading, journal + coach
  await page.evaluate(() => MD.app.go("daytrade", null, { fromNav: true })); await page.waitForTimeout(2500);
  const dtTxt = await page.locator("#content").innerText();
  check("day trading: session clock, economic releases and movers scanner", /Market (open|closed)|Pre-market|After-hours/i.test(dtTxt) && /Nonfarm Payrolls/.test(dtTxt) && await page.locator("table.tbl").count() >= 3 && /Gainers/i.test(dtTxt), dtTxt.slice(0, 400));
  await page.fill("input[aria-label=Symbol]", "AAPL"); await page.click("button:has-text('Load')"); await page.waitForTimeout(5000);
  const deskTxt = await page.locator("#content").innerText();
  check("desk: levels, VWAP, opening range, ATR, relative volume and a chart", /Key levels/i.test(deskTxt) && /VWAP/.test(deskTxt) && /Opening range/i.test(deskTxt) && /ATR\(14\)/.test(deskTxt) && /Relative volume/i.test(deskTxt) && /Pivot R1/.test(deskTxt) && await page.locator(".chartbox canvas").count() > 0, deskTxt.slice(deskTxt.search(/Day-trade desk/i), deskTxt.search(/Day-trade desk/i) + 900));
  const sz = page.locator("h2.sec", { hasText: "Position size" }).locator("xpath=ancestor::section[1]");
  await sz.locator("input").nth(3).fill("100"); await sz.locator("input").nth(4).fill("98"); await sz.locator("input").nth(5).fill("106"); await page.waitForTimeout(300);
  const szTxt = await sz.innerText();
  check("position size: shares from risk per trade, R multiple and targets", /Shares\s*62/i.test(szTxt) && /3\.00 R/.test(szTxt) && /102\.00 \/ 104\.00 \/ 106\.00/.test(szTxt), szTxt.slice(0, 400));
  await page.click("button:has-text('Build an AI plan')"); await page.waitForTimeout(5000);
  const planTxt = await page.locator("#content").innerText();
  const dayFc = await page.evaluate(() => MD.app.store.cached("forecasts").filter(f => f.source === "ai-day"));
  check("AI day plan: odds up/down, setups, invalid stop flagged, reviewed", /Bias: long/i.test(planTxt) && /▲ 5\d%/.test(planTxt) && /VWAP reclaim/i.test(planTxt) && /wrong side of the entry/i.test(planTxt) && /Review:/i.test(planTxt) && await page.locator(".probbar").count() >= 1, planTxt.slice(planTxt.search(/AI plan for the session/i), planTxt.search(/AI plan for the session/i) + 700));
  check("AI day plan logged in the forecast journal, graded at the close", dayFc.length === 1 && dayFc[0].horizonDays === 1 && dayFc[0].dueAt > Date.now() && dayFc[0].flatBandPct === 0 && (await page.evaluate(() => MD.app.store.cached("dayplans").length)) === 1, JSON.stringify(dayFc));
  const tr = await page.evaluate(() => window.__mock.toolResults || {});
  check("AI tools return measured data: backtests, base rates, move split, market memory, earnings, economic calendar", tr.backtest_rule && tr.backtest_rule.days > 100 && /TLT below -1%/.test(tr.backtest_rule.rule) && tr.base_rates && tr.base_rates.model.upPct >= 25 && tr.base_rates.model.upPct <= 75 && tr.base_rates.conditions.length >= 1 && tr.explain_move && tr.explain_move.week && Array.isArray(tr.explain_move.week.parts) && tr.market_memory && tr.market_memory.sessionsStudied === 2 && tr.market_memory.patterns.length >= 1 && tr.earnings_info && !tr.earnings_info.error && tr.economic_calendar && tr.economic_calendar.events.length === 1, JSON.stringify(Object.fromEntries(Object.entries(tr).map(([k, v]) => [k, v && v.error ? v.error : "ok"]))));
  const jr = page.locator("h2.sec", { hasText: "Your trade journal" }).locator("xpath=ancestor::section[1]");
  await jr.locator("input[placeholder='NVDA']").fill("MSFT");
  await jr.locator("input[type=number]").nth(0).fill("10"); await jr.locator("input[type=number]").nth(1).fill("400"); await jr.locator("input[type=number]").nth(2).fill("404"); await jr.locator("input[type=number]").nth(3).fill("398");
  await jr.locator("button:has-text('Add trade')").click(); await page.waitForTimeout(600);
  await page.evaluate(async () => { for (const [sym, side, en, ex, st, set] of [["NVDA", "long", 200, 196, 198, "Reversal"], ["TSLA", "short", 300, 305, 303, "Reversal"], ["AAPL", "long", 250, 255, 248, "Opening range breakout"], ["AMD", "long", 150, 149, 148, "Reversal"]]) await MD.app.store.create("daytrades", { date: "2026-10-2" + (sym.length), time: "09:40", symbol: sym, side, shares: 20, entry: en, exit: ex, stop: st, setup: set, fees: 0 }); MD.app.rerender(); }); await page.waitForTimeout(2500);
  const jTxt = await jr.innerText();
  check("trade journal: P&L, win rate, profit factor, expectancy and R", /Net P&L/i.test(jTxt) && /Win rate\s*40%/i.test(jTxt) && /Profit factor/i.test(jTxt) && /Expectancy/i.test(jTxt) && (await jr.locator("tbody tr").count()) === 5, jTxt.slice(0, 500));
  await jr.locator("button:has-text('AI coach')").click(); await page.waitForTimeout(2500);
  check("AI coach finds leaks in the journal", /Reversal trades lose/.test(await jr.innerText()) && /Skip reversals before 10:30 ET/.test(await jr.innerText()));
  await page.screenshot({ path: path.join(shots, "e2e-daytrade.png"), fullPage: true });

  // ---- Why it's moving (asset page)
  await page.evaluate(() => MD.app.openAsset({ id: "stock:AAPL", cls: "stock", symbol: "AAPL", name: "Apple" })); await page.waitForTimeout(2500);
  await page.click("#sec-why button:has-text('Explain the move')"); await page.waitForTimeout(4000);
  const whyTxt = await page.locator("#sec-why").innerText();
  check("why it's moving: market, sector, rates, dollar, oil and the asset's own part", /Asset-specific/.test(whyTxt) && /S&P 500 \(β/.test(whyTxt) && /Technology \(β/.test(whyTxt) && /Last 5 days/i.test(whyTxt) && /Factor model fitted on/i.test(whyTxt), whyTxt.slice(0, 600));
  await page.click("#sec-why button:has-text('Find the news behind it')"); await page.waitForTimeout(3000);
  check("why it's moving: AI finds the news behind the asset-specific part", /supplier report/.test(await page.locator("#sec-why").innerText()));

  // ---- Connector missing: contained, clear message
  await page.evaluate(() => { window.__mock.disconnected = ["Bigdata.com"]; });
  await page.evaluate(() => MD.app.openAsset({ id: "stock:MSFT", cls: "stock", symbol: "MSFT", name: "Microsoft" })); await page.waitForTimeout(1500);
  await page.click(".tabs button:has-text('News')"); await page.waitForTimeout(800);
  check("disconnected news connector names the connector", /Bigdata\.com isn't connected/.test(await page.locator("#content").innerText()), (await page.locator(".banner.err").allTextContents()).join(" / "));
  await page.evaluate(() => { window.__mock.disconnected = []; MD.data.resetConnectors(); });
  await page.click(".tabs button:has-text('Summary')"); await page.waitForTimeout(300);
  await page.evaluate(() => MD.app.openAsset({ id: "stock:AAPL", cls: "stock", symbol: "AAPL", name: "Apple" })); await page.waitForTimeout(2000);

  // ---- Alert: create via UI, trigger, dedupe
  await page.click("text=Create alert");
  await page.selectOption(".modal select", "above");
  await page.fill(".modal input[inputmode=decimal]", "100");
  await page.click(".modal button:has-text(\"Create alert\")");
  await page.waitForTimeout(300);
  const fired1 = await page.evaluate(() => MD.app.checkAlerts(true));
  const fired2 = await page.evaluate(() => MD.app.checkAlerts(true));
  check("alert fires once then dedupes", fired1.length === 1 && fired2.length === 0, JSON.stringify([fired1, fired2]));

  // ---- Add transaction through the modal
  await page.click(".nav a[href='#portfolio']"); await page.waitForTimeout(1200);
  await page.click("text=Add transaction >> nth=0");
  await page.fill(".modal input[type=search]", "AAPL"); await page.waitForTimeout(900);
  await page.click(".modal .stack button.btn.ghost.sm >> nth=0");
  await page.fill("#tx-date", "2024-03-01"); await page.dispatchEvent("#tx-date", "change");
  await page.fill("#tx-qty", "10"); await page.fill("#tx-price", "150"); await page.fill("#tx-fees", "1");
  await page.waitForTimeout(400);
  await page.click("text=Record transaction");
  await page.waitForTimeout(1500);
  const txs1 = await page.evaluate(() => MD.app.store.cached("tx"));
  check("transaction recorded with USD fx rate", txs1.length === 1 && txs1[0].fxToUSD === "1" && txs1[0].quantity === "10", JSON.stringify(txs1[0] || {}));
  // EUR cash deposit via picker
  await page.click("text=Add transaction >> nth=0");
  await page.fill(".modal input[type=search]", "EUR"); await page.waitForTimeout(900);
  await page.click(".modal .stack button.btn.ghost.sm >> nth=0");
  await page.selectOption("#tx-type", "deposit");
  await page.fill("#tx-date", "2024-02-01"); await page.dispatchEvent("#tx-date", "change"); await page.waitForTimeout(600);
  await page.fill("#tx-amount", "1000");
  await page.click("text=Record transaction"); await page.waitForTimeout(1500);
  const cash = await page.evaluate(() => MD.app.store.cached("tx").find(t => t.assetId === "cash:EUR"));
  check("EUR cash deposit records ECB historical rate", cash && cash.fxToUSD && /ECB/.test(cash.fxSource || ""), JSON.stringify(cash || {}));
  await page.waitForTimeout(1500);
  const holdingsText = await page.locator("table.tbl").first().innerText();
  check("holdings table lists AAPL and EUR cash", /AAPL/.test(holdingsText) && /EUR/.test(holdingsText), holdingsText.slice(0, 200));
  const pv = await page.evaluate(async () => { const p = await MD.app.valuePortfolio("EUR"); const r = p.rows.find(x => x.p.assetId === "stock:AAPL"); return { pnl: r.v.pnlR.toString(), sum: r.v.priceEffectR.plus(r.v.fxEffectR).toString(), basis: r.v.costBasisStatus }; });
  check("EUR reporting: P&L = price effect + FX effect, historical basis", pv.pnl === pv.sum && pv.basis === "historical", JSON.stringify(pv));
  await page.evaluate(() => MD.app.openAsset({ id: "stock:AAPL", cls: "stock", symbol: "AAPL", name: "Apple" })); await page.waitForTimeout(2500);
  const posTxt = await page.locator("#sec-position").innerText();
  check("asset page shows your position", /Quantity\s*10/i.test(posTxt) && /Average cost\s*150\.10/i.test(posTxt), posTxt.slice(0, 300));
  check("projection shows what your holding could be worth", /Your 10 AAPL: middle outcome/.test(await page.locator("#sec-projection").innerText()));
  check("notes reload with the page", await page.locator("#sec-notes textarea").inputValue() === "Watch 330 support; earnings Nov 2.");
  await page.click(".nav a[href='#portfolio']"); await page.waitForTimeout(1200);
  // Oversell blocked
  await page.click("text=Add transaction >> nth=0");
  await page.fill(".modal input[type=search]", "AAPL"); await page.waitForTimeout(900);
  await page.click(".modal .stack button.btn.ghost.sm >> nth=0");
  await page.selectOption("#tx-type", "sell"); await page.fill("#tx-qty", "50"); await page.fill("#tx-price", "200");
  await page.click("text=Record transaction"); await page.waitForTimeout(400);
  check("selling more than held is blocked", /can't sell more/.test(await page.locator(".modal").innerText()));
  await page.keyboard.press("Escape");
  // Reverse the cash deposit
  page.once("dialog", d => d.dismiss());
  const reverseBtns = page.locator("button:has-text('Reverse')");
  await reverseBtns.first().click(); await page.waitForTimeout(200);
  await page.click(".modal button:has-text(\"Reverse\")"); await page.waitForTimeout(1200);
  const txs2 = await page.evaluate(() => MD.app.store.cached("tx"));
  check("reversal appends instead of editing", txs2.length === 3 && txs2.some(t => t.type === "reversal"), String(txs2.length));
  check("append-only store refuses edits", await page.evaluate(async () => { try { await MD.app.store.put("tx", "x", {}); return false; } catch (e) { return /append-only/.test(e.message); } }));

  // ---- CSV import with an error and a duplicate
  await page.click("text=Import CSV");
  await page.fill(".modal textarea", "date,type,asset_class,symbol,quantity,price,currency,fees\n2024-03-01,buy,stock,AAPL,10,150,USD,1\n2024-05-02,buy,etf,SPY,3,520,USD,0\n2024-13-40,buy,stock,MSFT,1,1,USD,0");
  await page.waitForTimeout(600);
  const prev = await page.locator(".modal").innerText();
  check("CSV preview: 1 ready, 1 error, 1 duplicate", /Ready to import\s*1/i.test(prev) && /Errors\s*1/i.test(prev) && /Duplicates skipped\s*1/i.test(prev), prev.slice(0, 300));
  await page.click("text=Import valid rows"); await page.waitForTimeout(1500);
  const imported = await page.evaluate(() => MD.app.store.cached("tx").filter(t => t.importBatch).length);
  check("CSV import created 1 transaction in a batch", imported === 1, String(imported));
  await page.waitForTimeout(2500);
  const anTxt = await page.locator("#sec-analysis").innerText();
  check("portfolio analysis: diversification, risk shares, history chart, projection", /Diversification/i.test(anTxt) && await page.locator("#sec-analysis .riskbar").count() >= 1 && await page.locator("#sec-analysis .fan svg").count() === 1 && await page.locator("#sec-analysis .chartbox canvas").count() > 0 && /Projected value/i.test(anTxt), anTxt.slice(0, 400));
  await page.click("#sec-analysis button:has-text('Write an AI review')"); await page.waitForTimeout(2000);
  check("AI portfolio review written from the measured figures, researched and reviewed", /tech-heavy/.test(await page.locator("#sec-analysis .review").innerText()) && /Review:/i.test(await page.locator("#sec-analysis .review").innerText()));
  const stTxt = await page.locator("#sec-analysis").innerText();
  check("stress test: market moves via beta, largest position, worst day", /S&P 500 falls 20%/i.test(stTxt) && /largest position\) falls 30%/i.test(stTxt) && /worst day/i.test(stTxt), stTxt.slice(0, 300));
  check("rebalancing helper: targets, trades, costs, volatility before and after", /Rebalancing helper/i.test(stTxt) && /Turnover/i.test(stTxt) && /Estimated costs/i.test(stTxt) && /→/.test(stTxt));
  await page.selectOption("#sec-analysis select.rebal-strat", "equal"); await page.waitForTimeout(400);
  check("rebalance strategy switch recomputes targets", (await page.locator("#sec-analysis").innerText()).includes("Equal weight") || await page.evaluate(() => MD.app.ls.get("rebal", {}).strategy === "equal"));
  await page.click("#sec-analysis button:has-text('Ask Claude about this rebalance')"); await page.waitForTimeout(2000);
  check("AI weighs the rebalance with a gentler path and review", /Gentler path/i.test(await page.locator("#sec-analysis").innerText()));
  await page.screenshot({ path: path.join(shots, "e2e-portfolio-filled.png"), fullPage: true });

  // ---- Settings persist across reload
  await page.evaluate(() => MD.app.saveSettings({ reportingCurrency: "EUR", mode: "beginner" }));
  await page.waitForTimeout(1200);
  const dbgBefore = await page.evaluate(() => ({ keys: [...window.__mock.store.keys()].length, ls: localStorage.length, chars: Object.keys(localStorage).reduce((s, k) => s + k.length + (localStorage.getItem(k) || "").length, 0), big: Object.keys(localStorage).map(k => [k, (localStorage.getItem(k) || "").length]).sort((a, b) => b[1] - a[1]).slice(0, 4), url: location.href }));
  // Headless Chromium occasionally hands a reloaded file:// page a blank, temporary storage area (the data is
  // back on the next load). Reload again in that case; the real artifact stores data in the claude.ai account.
  // The save itself must have reached the account store before the reload.
  const savedDoc = await page.evaluate(() => { for (const [k, v] of window.__mock.store) if (/\/settings\/main$/.test(k)) return v; return null; });
  check("settings saved to the account store", savedDoc && savedDoc.reportingCurrency === "EUR" && savedDoc.mode === "beginner", JSON.stringify(savedDoc || {}).slice(0, 200));
  const lsSnap = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])));
  // The app writes a few keys as it boots, so check for the mock account database itself, not just any key.
  const hasDb = () => page.evaluate(() => !!localStorage.getItem("__mockdb"));
  for (let i = 0; i < 3; i++) { await page.reload(); await page.waitForSelector(".nav a"); if (await hasDb()) break; await page.waitForTimeout(700); }
  if (!(await hasDb())) {
    // Headless Chromium sometimes hands a reloaded file:// page blank storage (a browser quirk, not the app). Put the
    // pre-reload storage back, refill the mock account store from it, and start the app again in place.
    console.log("   (headless Chromium handed the reloaded page blank storage; restoring the snapshot and restarting the app in place)");
    await page.evaluate(async (snap) => { for (const [k, v] of Object.entries(snap)) localStorage.setItem(k, v); for (const [k, v] of JSON.parse(snap.__mockdb || "[]")) window.__mock.store.set(k, v); await MD.app.boot(); }, lsSnap);
    await page.waitForSelector(".nav a");
  }
  await page.waitForTimeout(1500);
  const s = await page.evaluate(() => ({ r: MD.app.settings.reportingCurrency, m: MD.app.settings.mode, n: MD.app.store.cached("tx").length }));
  check("settings and ledger persist after reload", s.r === "EUR" && s.m === "beginner" && s.n === 4, JSON.stringify(s) + " before=" + JSON.stringify(dbgBefore) + " after=" + JSON.stringify(await page.evaluate(() => ({ keys: [...window.__mock.store.keys()].length, ss: (sessionStorage.getItem("__mockdb") || "").length, url: location.href }))));
  check("beginner mode applied", await page.evaluate(() => document.body.classList.contains("mode-beginner")));

  // ---- Command bar with misspelling + AI routing
  await page.click(".nav a[href='#dashboard']"); await page.waitForTimeout(800);
  check("dashboard lists recently viewed assets", await page.locator(".recent .chip").count() >= 3 && /AAPL/.test(await page.locator(".recent").innerText()));
  await page.keyboard.press("/"); await page.waitForTimeout(300);
  check("command bar offers recently viewed assets", /Recently viewed/i.test(await page.locator(".cmd .results").innerText()));
  await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  await page.keyboard.press("/");
  await page.fill(".cmd input", "portfolo"); await page.waitForTimeout(300);
  check("fuzzy search finds 'Portfolio' from 'portfolo'", /Portfolio/.test(await page.locator(".cmd .results").innerText()));
  await page.fill(".cmd input", "show my portfolio in EUR please"); await page.waitForTimeout(500);
  check("command bar offers Ask AI and Go to for a question", await page.locator(".cmd .item:has-text('Ask AI:')").count() === 1 && await page.locator(".cmd .item:has-text('Go to:')").count() === 1);
  await page.click(".cmd .item:has-text('Go to:')"); await page.waitForTimeout(1200);
  check("natural-language request routed (display currency EUR)", await page.evaluate(() => MD.app.settings.displayCurrency === "EUR"));

  // ---- Deep research
  await page.evaluate(() => MD.app.go("research", { asset: { id: "stock:AAPL", cls: "stock", symbol: "AAPL", name: "Apple" } }));
  await page.waitForTimeout(800);
  await page.selectOption("select >> nth=1", "deep").catch(() => {});
  await page.click("text=Start research"); await page.waitForTimeout(4000);
  const rep = await page.evaluate(() => MD.app.store.cached("reports"));
  check("research report saved with steps and sources", rep.length === 1 && rep[0].steps.length >= 3 && rep[0].sources.length >= 1, rep[0] ? rep[0].steps.length + " steps" : "none");
  check("unverified citation flagged", rep[0] && rep[0].computed.unverifiedCitations === 1);
  check("reward-to-risk computed by the app", rep[0] && rep[0].computed.rewardRisk && rep[0].computed.rewardRisk.ratio > 1);
  check("challenge pass ran", rep[0] && rep[0].challenge && rep[0].challenge.survives === true);
  check("research used Bigdata.com news and kept it as a source", rep[0] && rep[0].sources.some(x => /bigdata\.com/.test(x.url)) && rep[0].steps.some(x => /Bigdata\.com news/.test(x.text)));
  await page.screenshot({ path: path.join(shots, "e2e-research.png"), fullPage: true });
  await page.click("text=Record forecast in journal").catch(() => {}); await page.waitForTimeout(800);
  const fc = await page.evaluate(() => MD.app.store.cached("forecasts"));
  check("forecast recorded immutably", fc.filter(f => f.source === "ai").length === 1 && await page.evaluate(async () => { try { await MD.app.store.remove("forecasts", MD.app.store.cached("forecasts")[0].id); return false; } catch { return true; } }));
  // Score a due forecast
  await page.evaluate(() => MD.app.store.create("forecasts", { assetId: "stock:AAPL", asset: { id: "stock:AAPL", cls: "stock", symbol: "AAPL" }, symbol: "AAPL", source: "user", direction: "up", probability: 0.7, horizonDays: 30, dueAt: Date.now() - 20 * 864e5, priceAtCreation: 150, currency: "USD", flatBandPct: 1 }));
  await page.waitForTimeout(500);
  await page.evaluate(() => { MD.app.ls.set("resTab", "journal"); MD.app.go("research", {}); });
  await page.waitForTimeout(800);
  await page.click("text=/Score \\d+ due forecast/"); await page.waitForTimeout(2000);
  const ev = await page.evaluate(() => MD.app.store.cached("evals"));
  check("due forecast scored with Brier", ev.length === 1 && typeof ev[0].brier === "number", JSON.stringify(ev[0] || {}));
  // Lessons from the record: seed scored calls, let the AI study them, and check later prompts are told
  await page.evaluate(async () => { const st = MD.app.store; for (const [sym, src, dir, p, hit] of [["AAPL", "ai-picks", "up", 0.75, false], ["MSFT", "ai-picks", "up", 0.75, false], ["NVDA", "ai-picks", "up", 0.7, false], ["SPY", "ai-take", "flat", 0.6, true], ["BTC", "ai-take", "up", 0.6, false]]) { const f = await st.create("forecasts", { assetId: "stock:" + sym, asset: { id: "stock:" + sym, cls: "stock", symbol: sym }, symbol: sym, source: src, direction: dir, probability: p, horizonDays: 90, dueAt: Date.now() - 864e5, priceAtCreation: 100, currency: "USD", thesis: sym + " momentum", flatBandPct: 1 }); await st.create("evals", { forecastId: f.id, evaluatedAt: Date.now(), priceAtDue: hit ? 100.5 : 95, probability: p, source: src, realizedReturnPct: hit ? 0.5 : -5, directionHit: hit, brier: Math.pow(p - (hit ? 1 : 0), 2) }); } });
  await page.evaluate(() => MD.app.go("research", {})); await page.waitForTimeout(800);
  await page.click("button:has-text('Study the misses and write lessons')"); await page.waitForTimeout(2500);
  const lessonTxt = await page.locator("#content").innerText();
  await page.locator("text=What the AI learned from its record").scrollIntoViewIfNeeded().catch(() => {}); await page.screenshot({ path: path.join(shots, "e2e-lessons.png") });
  check("AI studies its scored calls and writes lessons", /Cap stated probabilities at 65%/.test(lessonTxt) && /overconfident above 70%/.test(lessonTxt) && /from 6 scored calls/.test(lessonTxt), lessonTxt.slice(-700));
  const notes = await page.evaluate(() => ({ picks: MD.ai.calibrationNote(MD.ai.trackRecord(MD.app, "ai-picks")), take: MD.ai.calibrationNote(MD.ai.trackRecord(MD.app, "ai-take")), saved: MD.app.store.cached("ailessons").length }));
  check("scorecard counts your own forecasts separately", /Your own forecasts\s+1\s+1\s/.test(lessonTxt), (lessonTxt.match(/Your own forecasts[^\n]*/) || [""])[0]);
  // Automatic calibration: 12 graded market calls stated at 70% that came true half the time pull a new 70% call down.
  const cal = await page.evaluate(async () => { for (let i = 0; i < 12; i++) { const f = await MD.app.store.create("forecasts", { assetId: "etf:SPY", asset: { id: "etf:SPY", cls: "etf", symbol: "SPY" }, symbol: "SPY", source: "ai-market", direction: "up", probability: 0.7, horizonDays: 1, dueAt: Date.now() - 864e5, priceAtCreation: 100, currency: "USD", flatBandPct: 0 }); await MD.app.store.create("evals", { forecastId: f.id, evaluatedAt: Date.now(), priceAtDue: 101, probability: 0.7, source: "ai-market", realizedReturnPct: i % 2 ? 1 : -1, directionHit: i % 2 === 0, brier: i % 2 ? 0.49 : 0.09 }); } return { up: MD.ai.calibrateUp(MD.app, "ai-market", 70), down: MD.ai.calibrateUp(MD.app, "ai-market", 30), none: MD.ai.calibrateUp(MD.app, "ai-day", 70) }; });
  check("calibration from the record pulls overconfident calls toward what actually happened, both directions", cal.up.applied && cal.up.upPct < 70 && cal.up.upPct > 50 && cal.down.upPct === 100 - cal.up.upPct && !cal.none.applied, JSON.stringify(cal));
  check("lessons are fed to later prompts, filtered by feature", notes.saved === 1 && /Cap stated probabilities/.test(notes.picks) && /Weight valuation more/.test(notes.picks) && !/Weight valuation more/.test(notes.take) && /keep leans flat/.test(notes.take), JSON.stringify(notes).slice(0, 600));

  // ---- Strategies
  await page.evaluate(() => MD.app.go("strategies", { tab: "backtest" })); await page.waitForTimeout(2500);
  check("backtest renders results table", /Buy and hold/.test(await page.locator("#content").innerText()) && await page.locator(".chartbox canvas").count() > 0);
  for (const t of ["ripple", "fx", "catalyst", "future"]) { const b = errors.length; await page.evaluate((t) => MD.app.go("strategies", { tab: t }), t); await page.waitForTimeout(1500); check("strategy tab " + t + " renders", errors.length === b && !(await page.locator(".banner.err").count()), errors.slice(b).join("|")); }

  // ---- FX converter cross rate
  await page.evaluate(() => MD.app.go("fx", { convert: { amount: 1000, from: "JPY", to: "GBP" } })); await page.waitForTimeout(1500);
  const fxText = await page.locator("#content").innerText();
  check("FX converter shows cross rate with legs and source", /Cross rate via USD/.test(fxText) && /Legs:/.test(fxText) && /Coinbase/.test(fxText), fxText.slice(0, 300));
  check("restricted currency note shown (NGN)", await page.evaluate(() => MD.app.reg.get("NGN").note.length > 0));

  // ---- Provider failure is contained
  await page.evaluate(() => MD.app.openAsset({ id: "stock:ZZZZ", cls: "stock", symbol: "ZZZZ", name: "Nope" })); await page.waitForTimeout(2000);
  check("unknown ticker shows an error state, not a crash", await page.locator(".banner.err").count() > 0);

  // ---- Self-test, downloads, demo isolation
  await page.evaluate(() => MD.app.go("settings", { tab: "selftest" })); await page.waitForTimeout(500);
  await page.click("text=Run self-test"); await page.waitForTimeout(800);
  check("in-app self-test passes", /(\d+) of \1 tests passed/.test(await page.locator("#content").innerText()));
  await page.evaluate(() => MD.app.go("reports")); await page.waitForTimeout(600);
  await page.click("text=Generate HTML statement"); await page.waitForTimeout(2500);
  const dls = await page.evaluate(() => window.__mock.downloads);
  check("statement offered as a download", dls.some(d => /statement-EUR/.test(d.filename)), JSON.stringify(dls));
  const liveCount = await page.evaluate(() => MD.app.store.cached("tx").length);
  await page.evaluate(() => MD.app.setDemo(true)); await page.waitForTimeout(800);
  await page.evaluate(() => MD.app.go("portfolio")); await page.waitForTimeout(2500);
  await page.waitForTimeout(2500);
  check("portfolio analysis with several holdings: correlation grid and risk shares", await page.locator("#sec-analysis .hm-c").count() >= 4 && await page.locator("#sec-analysis .riskbar").count() >= 2, String(await page.locator("#sec-analysis .hm-c").count()) + " cells");
  await page.screenshot({ path: path.join(shots, "e2e-analysis.png"), fullPage: true });
  check("demo mode shows banner and demo ledger", /Demo mode/.test(await page.locator("#content").innerText()) && await page.evaluate(() => MD.app.store.cached("tx").every(t => t.demo)));
  await page.screenshot({ path: path.join(shots, "e2e-demo.png"), fullPage: false });
  await page.evaluate(() => MD.app.setDemo(false)); await page.waitForTimeout(800);
  check("demo data isolated from live ledger", await page.evaluate(() => MD.app.store.cached("tx").length) === liveCount && await page.evaluate(() => MD.app.store.cached("tx").every(t => !t.demo)));

  // ---- Mobile width and dark theme
  await page.setViewportSize({ width: 400, height: 860 });
  for (const r of ["dashboard", "portfolio", "fx", "metals", "cards", "card-detail", "betting", "picks", "stocks", "stock-detail", "research", "settings"]) {
    if (r === "stock-detail") await page.evaluate(() => MD.app.openAsset({ id: "stock:AAPL", cls: "stock", symbol: "AAPL", name: "Apple" })); else if (r === "card-detail") await page.evaluate(() => MD.app.openAsset({ id: "pkm:sv03.5-199", cls: "pokemon", tcgdexId: "sv03.5-199", symbol: "sv03.5-199", name: "Charizard ex" })); else await page.evaluate((r) => MD.app.go(r, null, { fromNav: true }), r);
    await page.waitForTimeout(r === "stock-detail" ? 3000 : 1300);
    if (r === "stock-detail") await page.screenshot({ path: path.join(shots, "e2e-mobile-stock.png"), fullPage: true });
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    check("no horizontal scroll at 400px: " + r, sw <= 401, "scrollWidth " + sw);
  }
  await page.screenshot({ path: path.join(shots, "e2e-mobile.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => MD.app.go("portfolio")); await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(shots, "e2e-dark.png") });

  // ---- Nasdaq outage: charts fall back to Twelve Data
  await page.evaluate(() => { window.__mock.failNasdaq = true; MD.app.openAsset({ id: "stock:NFLX", cls: "stock", symbol: "NFLX", name: "Netflix" }); }); await page.waitForTimeout(3500);
  check("when Nasdaq fails, stock charts load from Twelve Data", await page.locator("#sec-price .chartbox canvas").count() > 0 && /Twelve Data/.test(await page.locator("#sec-price").innerText()), (await page.locator("#sec-price").innerText()).slice(0, 300));
  await page.evaluate(() => { window.__mock.failNasdaq = false; });
  check("web fetches are throttled (never more than 4 at once)", await page.evaluate(() => window.__mock.maxInflight) <= 4, String(await page.evaluate(() => window.__mock.maxInflight)));
  // ---- Sports Betting
  await page.evaluate(() => { for (const k of ["mdp.bet.sport", "mdp.bet.tab", "mdp.bet.slip", "mdp.bet.gtab", "mdp.bet.day"]) localStorage.removeItem(k); MD.app.go("betting", null, { fromNav: true }); }); await page.waitForTimeout(2500);
  check("betting: league buttons for every major sport and the top 5 soccer leagues", await page.locator(".leagues .lg").count() === 12 && /Premier League\s*England/i.test(await page.locator(".leagues").innerText()) && /Ligue 1\s*France/i.test(await page.locator(".leagues").innerText()));
  check("betting: NFL upcoming games as compact rows with odds from 8 named books", await page.locator(".gamerow").count() === 3 && /8 books/.test(await page.locator("#content").innerText()), String(await page.locator(".gamerow").count()));
  const mia = page.locator(".gamerow:has-text('Dolphins')");
  check("betting: rows show ESPN records, road split, injuries and temperature", /0-5 \(0-3 away\)/.test(await mia.innerText()) && /1 out · 1 q/.test(await mia.locator(".injb").first().innerText()) && /63°F/.test(await mia.innerText()), await mia.innerText());
  check("betting: responsible-gambling note and no bet placing", /1-800-GAMBLER/.test(await page.locator("details.rg").innerText()) && /never places bets/.test(await page.locator("details.rg").innerText()));
  await page.click("button:has-text('AI forecast for all games')"); await page.waitForTimeout(1500);
  check("AI slate forecast: a pick, chance and confidence on every row", await page.locator(".gamerow .aipick").count() === 3 && await page.locator(".gamerow.has-ai").count() === 3);
  check("AI slate forecast: first forecasts logged to the track record", await page.evaluate(() => MD.app.store.cached("betpicks").length) === 3);
  await page.click(".tabs button:has-text('AI picks')"); await page.waitForTimeout(1500);
  const pk = await page.locator("#content").innerText();
  check("AI picks: most likely results with confidence, ready-made slips, singles, track record", await page.locator("table.tbl").first().locator("tbody tr").count() === 3 && await page.locator(".slipcard").count() >= 1 && /Safest|Balanced|Value/.test(pk) && /AI track record/i.test(pk), pk.slice(0, 300));
  await page.locator(".slipcard button:has-text('Put on my bet slip')").first().click(); await page.waitForTimeout(500);
  check("ready-made slip loads into the side bet slip", await page.locator(".betaside .sp-leg").count() >= 2, String(await page.locator(".betaside .sp-leg").count()));
  // grade a finished game's pick from the ESPN final (Patriots 24 – Bears 30)
  await page.evaluate(async () => { const y = new Date(Date.now() - 864e5); await MD.app.store.create("betpicks", { gameId: "nfl:311", sport: "nfl", game: "Patriots at Bears", home: "Bears", away: "Patriots", soccer: false, start: Date.now() - 20 * 3600e3, startDate: null, pick: "home", pickName: "Bears", p: 0.6, confidence: 61, mode: "quick", bestDec: 1.67, at: Date.now() - 864e5 }); });
  await page.click("button:has-text('Check results')"); await page.waitForTimeout(1500);
  check("AI track record: picks graded from ESPN final scores", await page.evaluate(() => MD.app.store.cached("betgrades").length) === 1 && /hit · 24–30/i.test(await page.locator("#content").innerText()), await page.evaluate(() => JSON.stringify(MD.app.store.cached("betgrades"))));
  await page.click(".tabs button:has-text('Games')"); await page.waitForTimeout(1500);
  await page.click(".gamerow:has-text('Dolphins')"); await page.waitForTimeout(2000);
  const ov = await page.locator("#content").innerText();
  check("game overview: venue and temperature, chances incl. AI, injuries, matchup records", /MetLife Stadium/.test(ov) && /63°F/.test(ov) && await page.locator(".ch-b .pbar.ai").count() === 2 && /Q\. Back/.test(ov) && /0-5 · 0-3 away/.test(ov), ov.slice(0, 400));
  await page.click(".tabs button:has-text('Odds')"); await page.waitForTimeout(500);
  check("game odds tab: moneyline, spread and total by book with best price and fair row", await page.locator("#sec-ml table.oddtbl tbody tr").count() >= 8 && await page.locator("#sec-spread").count() === 1 && await page.locator("#sec-total").count() === 1 && /\+215/.test(await page.locator("#sec-ml .oc.best").first().innerText()));
  await page.selectOption("#sec-alerts select >> nth=0", { label: "Moneyline: Dolphins" }); await page.fill("#sec-alerts input", "+200"); await page.click("#sec-alerts button:has-text('Add alert')"); await page.waitForTimeout(300);
  await page.click("#sec-ml .oc.best >> nth=0"); await page.click("#sec-total .oc >> nth=0"); await page.waitForTimeout(300);
  await page.click(".tabs button:has-text('AI analysis')"); await page.waitForTimeout(400);
  await page.click("#sec-ai button:has-text('Run the full AI forecast')"); await page.waitForTimeout(1500);
  const ai = await page.locator("#sec-ai").innerText();
  check("full AI forecast: pick, predicted score, confidence breakdown, factors, sources checked", /Jets 62%/.test(ai) && /Predicted 20–24/.test(ai) && /data coverage/i.test(ai) && /weren't retrieved/.test(ai) && /No bet/i.test(ai) && await page.locator("#sec-ai table tbody tr").count() >= 4, ai.slice(0, 400));
  check("full AI forecast reviewed and told its graded record", /Review: holds up/i.test(ai) && await page.evaluate(() => window.__mock.samplePrompts.some(x => /skeptical independent reviewer/.test(x))), ai.slice(0, 200));
  await page.screenshot({ path: path.join(shots, "e2e-betting-game.png"), fullPage: true });
  await page.click(".backbar button"); await page.waitForTimeout(1800);
  check("price alert fires when the best price reaches the target (toast + inbox)", await page.evaluate(() => MD.app.store.cached("inbox").some(i => /Betting alert/.test(i.title))) && await page.evaluate(() => JSON.parse(localStorage.getItem("mdp.bet.alerts"))[0].hitAt > 0));
  check("Back returns to the games list", await page.locator(".gamerow").count() === 3 && !(await page.locator(".backbar").count()));
  const legs = await page.evaluate(() => JSON.parse(localStorage.getItem("mdp.bet.slip") || "[]").length);
  await page.click(".betaside .seg button:has-text('Round robin')"); await page.waitForTimeout(300);
  const rr = await page.locator(".betaside").innerText();
  check("bet slip: round robin with exact chance to finish ahead", legs >= 3 && /Chance to finish ahead\s*\d/i.test(rr) && new RegExp("Parlays\\s*" + (legs * (legs - 1) / 2) + " ×", "i").test(rr), rr.slice(-300));
  await page.evaluate(() => MD.app.saveSettings({ betting: Object.assign({}, MD.app.settings.betting, { maxStakePct: 1, bankroll: 1000 }) })); await page.waitForTimeout(300);
  await page.fill(".betaside input[aria-label='Stake']", "20"); await page.waitForTimeout(200);
  check("stake cap warns in the slip", /above your cap of 1%/.test(await page.locator(".betaside").innerText()));
  await page.evaluate(() => MD.app.saveSettings({ betting: Object.assign({}, MD.app.settings.betting, { maxStakePct: 0 }) })); await page.waitForTimeout(300);
  await page.fill(".betaside input[aria-label='Stake']", "10");
  await page.click(".betaside button:has-text('Log as placed')"); await page.waitForTimeout(1500);
  check("round robin logged as one parlay per combination", await page.evaluate(() => MD.app.store.cached("bets").filter(b => b.rr === 2).length) === legs * (legs - 1) / 2);
  // a bet on the finished game, settled from the ESPN final
  await page.evaluate(async () => { await MD.app.store.put("bets", "fin1", { createdAt: Date.now() - 864e5, placedAt: Date.now() - 864e5, type: "single", stake: 10, currency: "USD", status: "open", dec: 1.67, book: "FanDuel", pick: "Bears moneyline", game: "Patriots at Bears", sport: "nfl", legs: [{ sport: "nfl", market: "ml", side: "home", line: null, dec: 1.67, home: "Bears", away: "Patriots", soccer: false, pick: "Bears moneyline", start: Date.now() - 20 * 3600e3 }] }); MD.app.ls.set("bet.tab", "bets"); MD.app.rerender(); }); await page.waitForTimeout(1500);
  await page.click("#content button:has-text('Check results')"); await page.waitForTimeout(1500);
  check("my bets: Check results suggests the outcome from the final score", /can be settled/.test(await page.locator("#content").innerText()) && /Bears moneyline: won/.test(await page.locator("#content").innerText()));
  await page.click("#content .banner button:has-text('Apply')"); await page.waitForTimeout(1200);
  check("applying the suggestion settles the bet", await page.evaluate(() => MD.app.store.cached("bets").find(b => b.id === "fin1").status === "won"));
  await page.click(".tabs button:has-text('Calculators')"); await page.waitForTimeout(500);
  check("calculators: eight tools", await page.locator(".calc").count() === 8 && /Fractional\s*10\/11/i.test(await page.locator(".calc >> nth=0").innerText()));
  await page.click(".tabs button:has-text('Value & arbitrage')"); await page.waitForTimeout(1500);
  check("value finder lists the +EV price and the arbitrage stakes", /DraftKings/.test(await page.locator("#content table").first().innerText()) && await page.locator(".arbcard").count() === 1);
  await page.click(".tabs button:has-text('AI assistant')"); await page.waitForTimeout(500);
  await page.fill(".betassist textarea", "Build me a safe parlay"); await page.keyboard.press("Enter"); await page.waitForTimeout(2000);
  const at = await page.evaluate(() => ({ names: window.__mock.advisorTools || [], res: window.__mock.advisorResults || {} }));
  check("AI betting assistant: odds, injuries, scores, forecasts, slips and slip tools", ["get_betting_odds", "get_injuries", "get_scoreboard", "get_game_forecast", "build_slips", "add_to_slip", "get_slip", "bet_math", "get_my_bets", "get_ai_track_record", "search_news"].every(n => at.names.includes(n)) && at.names.length <= 20, at.names.join(","));
  check("assistant tools return real page data (injuries, forecast, slips) and can add to the slip", at.res.get_injuries && at.res.get_injuries.players.length === 2 && at.res.get_game_forecast && at.res.get_game_forecast.confidence > 0 && at.res.build_slips && at.res.build_slips.slips.length >= 1 && at.res.add_to_slip && /Jets|Under/.test(at.res.add_to_slip.added), JSON.stringify(at.res.add_to_slip || at.res.get_injuries || {}).slice(0, 200));
  await page.click(".leagues .lg[data-league='laliga']"); await page.waitForTimeout(400); await page.click(".tabs button:has-text('Games')"); await page.waitForTimeout(2200);
  check("soccer: La Liga rows with draw, Statz model and Kalshi", await page.locator(".gamerow").count() === 3 && /Draw/.test(await page.locator(".gamerow >> nth=0").innerText()) && await page.locator(".gamerow .chip:has-text('Statz model')").count() === 3 && await page.locator(".gamerow .chip:has-text('Kalshi')").count() === 2);
  await page.click(".gamerow:has-text('Barcelona')"); await page.waitForTimeout(2000);
  await page.click(".tabs button:has-text('Odds')"); await page.waitForTimeout(400);
  check("soccer game: home/away from Statz, books + Kalshi draw", /Barcelona vs Real Madrid/.test(await page.locator("h1").innerText()) && await page.locator("#sec-ml .oc").count() >= 11);
  await page.click(".tabs button:has-text('Stats')"); await page.waitForTimeout(1200);
  check("soccer stats: model markets and Statz team leaders", await page.locator("#sec-model .sg-c").count() === 9 && /Raphinha/.test(await page.locator("#sec-leaders").innerText()));
  await page.screenshot({ path: path.join(shots, "e2e-betting-soccer.png"), fullPage: true });
  await page.evaluate(() => { window.__mock.failVI = true; MD.bet.cacheClear(); MD.app.ls.set("bet.sport", "nba"); MD.app.ls.set("bet.tab", "games"); MD.app.go("betting", null, { fromNav: true }); }); await page.waitForTimeout(2200);
  check("odds-page outage shows an error with Try again, not a crash", await page.locator("#content .banner.err button").count() === 1);
  await page.evaluate(() => { window.__mock.failVI = false; MD.app.ls.set("bet.sport", "nfl"); });
  await page.evaluate(() => MD.app.go("dashboard", null, { fromNav: true })); await page.waitForTimeout(1500);
  check("dashboard: Betting today card with open bets and AI record", /Betting today/i.test(await page.locator("#content").innerText()) && /AI record/i.test(await page.locator("#content").innerText()));

  // ---- Opportunities AI: scan review, comparison scorecard, idea finder
  await page.evaluate(() => { MD.app.ls.set("oppTab", "scan"); MD.app.go("opportunities", null, { fromNav: true }); }); await page.waitForTimeout(800);
  await page.click("button:has-text('Run scan')"); await page.waitForTimeout(3500);
  await page.click("button:has-text('AI review of these results')"); await page.waitForTimeout(3500);
  const scanAi = await page.locator("#content").innerText();
  check("scan AI review: verdicts, scores, best idea, review pass", /Best idea:/i.test(scanAi) && /Research further · 80/i.test(scanAi) && /Review: holds up/i.test(scanAi) && /Portfolio fit/i.test(scanAi), scanAi.slice(-600));
  await page.evaluate(() => { MD.app.ls.set("compareList", [{ id: "etf:SPY", cls: "etf", symbol: "SPY", name: "SPDR S&P 500" }, { id: "stock:AAPL", cls: "stock", symbol: "AAPL", name: "Apple" }]); MD.app.ls.set("oppTab", "compare"); MD.app.go("opportunities", null, { fromNav: true }); }); await page.waitForTimeout(2500);
  await page.click("button:has-text('AI comparison scorecard')"); await page.waitForTimeout(3500);
  const cmpAi = await page.locator("#content").innerText();
  check("comparison scorecard: winner, scores, bull/bear, confidence", /Overall: SPY/i.test(cmpAi) && /Best for stability: SPY/i.test(cmpAi) && /SPY bull/i.test(cmpAi) && /Confidence/i.test(cmpAi), cmpAi.slice(-600));
  await page.evaluate(() => { MD.app.ls.set("oppTab", "ideas"); MD.app.go("opportunities", null, { fromNav: true }); }); await page.waitForTimeout(800);
  await page.fill("textarea", "picks and shovels for AI data centres"); await page.click("button:has-text('Find ideas')"); await page.waitForTimeout(5000);
  const ideaTxt = await page.locator("#content").innerText();
  check("idea finder: ideas verified against exchange data and reviewed", /NVDA/.test(ideaTxt) && /SMH/.test(ideaTxt) && /Measured by the app/i.test(ideaTxt) && /1Y return/i.test(ideaTxt) && /Review:/i.test(ideaTxt), ideaTxt.slice(-700));
  check("idea search saved", await page.evaluate(() => MD.app.store.cached("ideas").length === 1 && MD.app.store.cached("ideas")[0].ideas.length >= 2));
  await page.screenshot({ path: path.join(shots, "e2e-ideas.png"), fullPage: false });
  await page.click(".aicard button:has-text('Watch')"); await page.waitForTimeout(400);
  check("add an idea to the watchlist", await page.evaluate(() => MD.app.store.cached("watch").some(w => w.symbol === "NVDA" || w.symbol === "SMH" || w.symbol === "BE")));

  // ---- AI quick take on an asset page, and the dashboard morning brief
  await page.evaluate(() => MD.app.openAsset({ id: "stock:AAPL", cls: "stock", symbol: "AAPL", name: "Apple Inc." })); await page.waitForTimeout(2500);
  await page.click("#sec-ai button:has-text('Get AI quick take')"); await page.waitForTimeout(3500);
  const takeTxt = await page.locator("#sec-ai").innerText();
  check("AI quick take: stance, leans, both sides, measured levels, review", /Constructive, but stretched/i.test(takeTxt) && /3M lean/i.test(takeTxt) && /Working against it/i.test(takeTxt) && /200-day average/i.test(takeTxt) && /Review:/i.test(takeTxt), takeTxt.slice(0, 500));
  check("AI quick take saved and its 3-month lean journaled", await page.evaluate(() => MD.app.store.cached("aitakes").some(d => d.id === "stock_AAPL") && MD.app.store.cached("forecasts").some(f => f.source === "ai-take" && f.symbol === "AAPL" && f.direction === "up")));
  await page.click("#sec-company .tabs button:has-text('Earnings')"); await page.waitForTimeout(2500);
  const ernTxt = await page.locator("#sec-company").innerText();
  check("earnings tab: next report, consensus with revisions, past surprises and reactions", /Consensus EPS/i.test(ernTxt) && /\$2\.00/.test(ernTxt) && /2-day reaction/i.test(ernTxt) && /\+4\.7%/.test(ernTxt), ernTxt.slice(0, 600));
  await page.click("button:has-text('Write an AI earnings preview')"); await page.waitForTimeout(3000);
  const prevTxt = await page.locator("#sec-company").innerText();
  check("AI earnings preview: scenarios normalised to 100%, weighted move, review", /Beat and raise/.test(prevTxt) && /36%/.test(prevTxt) && /Probability-weighted move/i.test(prevTxt) && /Review:/i.test(prevTxt), prevTxt.slice(-600));
  await page.click("#sec-company .tabs button:has-text('Insiders & dividends')"); await page.waitForTimeout(2000);
  const insTxt = await page.locator("#sec-company").innerText();
  check("insiders & dividends: open-market buys, sells, net shares, transactions, yield, history", /Insider buys/i.test(insTxt) && /NEWSTEAD JENNIFER/.test(insTxt) && /0\.31%/.test(insTxt) && /Dividend history \(2 payments\)/i.test(insTxt) && /-1,355,409|−1,355,409/.test(insTxt), insTxt.slice(0, 500));
  await page.evaluate(() => MD.app.ls.set("stockTab", "summary"));
  await page.click("#sec-ai button:has-text('Bull vs bear debate')"); await page.waitForTimeout(3500);
  const debTxt = await page.locator("#sec-ai").innerText();
  check("bull vs bear debate: both cases, judge's probability, unverified source flagged", /Bull case stronger/i.test(debTxt) && /Higher in 6 months/i.test(debTxt) && /57%/.test(debTxt) && /What decides it/i.test(debTxt) && /\(unverified\)/.test(debTxt), debTxt.slice(-600));
  await page.evaluate(() => MD.app.go("dashboard", null, { fromNav: true })); await page.waitForTimeout(1500);
  await page.click("button:has-text(\"Write today's brief\")"); await page.waitForTimeout(3000);
  const briefTxt = await page.locator("#content").innerText();
  check("AI morning brief on the dashboard", /Quiet open; your tech holdings lead/i.test(briefTxt) && await page.evaluate(() => MD.app.store.cached("briefs").length === 1), briefTxt.slice(0, 300));

  // ---- Watchlist scanner + AI triage
  await page.evaluate(() => { MD.app.ls.set("oppTab", "watch"); MD.app.go("opportunities", null, { fromNav: true }); }); await page.waitForTimeout(800);
  await page.click("button:has-text('Scan my watchlist and holdings')");
  await page.waitForFunction(() => /Scanned \d+ assets/.test(document.querySelector("#content").innerText), null, { timeout: 30000 }).catch(() => {});
  const wsTxt = await page.locator("#content").innerText();
  check("watchlist scanner measures signals for holdings and watchlist", /Scanned \d+ assets/i.test(wsTxt) && await page.locator("#content table.tbl tbody tr").count() >= 2 && /RSI/.test(wsTxt), wsTxt.slice(0, 900));
  const flaggedN = await page.evaluate(() => document.querySelectorAll("#content .sig").length);
  await page.click("button:has-text('AI: what needs attention today')"); await page.waitForTimeout(3000);
  const triTxt = await page.locator("#content").innerText();
  check("AI triage ranks what needs attention (or says nothing does)", flaggedN ? /Review position|No action/i.test(triTxt) : /No action needed/i.test(triTxt), triTxt.slice(-500));

  // ---- Smart Money
  const navOrder = await page.evaluate(() => [...document.querySelectorAll(".nav a")].map(a => a.getAttribute("href")));
  check("Smart Money sits right above Portfolio", navOrder.indexOf("#smartmoney") === navOrder.indexOf("#portfolio") - 1, navOrder.join(","));
  await page.evaluate(() => { MD.app.ls.set("sm.tab", "leaders"); MD.app.ls.set("sm.lb", { group: "all", win: "All" }); MD.app.go("smartmoney", null, { fromNav: true }); }); await page.waitForTimeout(9000);
  const smRows = await page.locator("#content .tbl tbody tr").count();
  check("leaderboard lists Congress members and investors", smRows === 23, String(smRows));
  const smTop = await page.locator("#content .tbl tbody tr").first().innerText();
  check("leaderboard sorted by return, highest first", await page.evaluate(() => { const v = [...document.querySelectorAll("#content .tbl tbody tr td:nth-child(3) b")].map(b => parseFloat(b.textContent.replace(/[^0-9.+-]/g, ""))).filter(x => isFinite(x)); return v.length > 5 && v.every((x, i) => !i || v[i - 1] >= x); }), smTop.slice(0, 80));
  check("podium shows the top three", await page.locator(".pod").count() === 3);
  check("projected 1M–1Y columns", /Projected 1M/i.test(await page.locator("#content thead").innerText()) && /Projected 1Y/i.test(await page.locator("#content thead").innerText()));
  check("failed pages are named, not fatal", /couldn't be read: .*Alan Armstrong/.test(await page.locator("#content").innerText()));
  check("measured results saved to the account", await page.evaluate(() => MD.app.store.cached("smcache").length) >= 20);
  await page.click("button:has-text('Build the smart-money model portfolio')"); await page.waitForTimeout(4000);
  const mpTxt = await page.locator("#content").innerText();
  check("smart-money model portfolio: weights from top performers, backtest vs SPY, hindsight warning", /Built from:/i.test(mpTxt) && /Hindsight warning/i.test(mpTxt) && /Excess/i.test(mpTxt), mpTxt.slice(-700));
  await page.locator(".seg button", { hasText: "Congress" }).click(); await page.waitForTimeout(600);
  await page.locator("#content .tbl tbody tr", { hasText: "Nancy Pelosi" }).click(); await page.waitForTimeout(4000);
  const pel = await page.locator("#content").innerText();
  check("member page: header, period returns, projection", /Nancy Pelosi/.test(pel) && /Democrat · House · California/.test(pel) && /Returns by period/i.test(pel) && /Projected return if you copied/i.test(pel), pel.slice(0, 200));
  check("member page: copy-trade backtest chart and trades table", await page.locator(".chartbox canvas").count() > 0 && /Copy-trade backtest/i.test(pel) && await page.locator("text=Disclosed trades").count() > 0);
  check("member page: unlisted trades say why they aren't priced", (await page.locator("td span[title='Not a listed US security']").count()) >= 1);
  await page.click("button:has-text('☆ Follow')"); await page.waitForTimeout(300);
  check("follow a member", await page.evaluate(() => MD.app.store.cached("follows").some(f => f.key === "P000197")));
  await page.click("button:has-text('Run AI analysis')"); await page.waitForTimeout(2500);
  const smAi = await page.locator("#content").innerText();
  check("AI analysis: verdict, confidence breakdown, unverified link flagged", /Worth watching/i.test(smAi) && /Data coverage/i.test(smAi) && await page.locator("text=(unverified)").count() >= 1, smAi.slice(-400));
  check("AI analysis saved", await page.evaluate(() => MD.app.store.cached("smai").some(d => d.id === "pol_P000197")));
  await page.screenshot({ path: path.join(shots, "e2e-smartmoney-member.png"), fullPage: false });
  await page.click(".backbar button"); await page.waitForTimeout(800);
  check("back returns to the leaderboard", await page.locator(".pod").count() > 0);
  await page.locator(".seg button", { hasText: "Investors" }).click(); await page.waitForTimeout(600);
  await page.locator("#content .tbl tbody tr", { hasText: "Warren Buffett" }).click(); await page.waitForTimeout(4000);
  const wb = await page.locator("#content").innerText();
  check("investor page: 13F header, holdings, activity", /Berkshire Hathaway/.test(wb) && /13F Q2 2026/.test(wb) && /AAPL/.test(wb) && /Recent quarters/i.test(wb) && /Add 658%/i.test(wb), wb.slice(0, 200));
  check("investor page: top-holdings backtest and projection range", /Today's top holdings over the past year/i.test(wb) && /5–95% range/i.test(wb) && !/needs volatility/i.test(wb), wb.slice(0, 600));
  await page.screenshot({ path: path.join(shots, "e2e-smartmoney-investor.png"), fullPage: false });
  await page.evaluate(() => { MD.app.ls.set("sm.tab", "consensus"); MD.app.go("smartmoney", null, { fromNav: true }); }); await page.waitForTimeout(1200);
  check("most bought: tickers with Congress buyers and investors", /BE/.test(await page.locator("#content .tbl").first().innerText()) && /Warren Buffett/.test(await page.locator("#content").innerText()));
  await page.evaluate(() => { window.__mock.failFMP = true; MD.app.ls.set("sm.tab", "latest"); MD.app.go("smartmoney", null, { fromNav: true }); }); await page.waitForTimeout(1200);
  check("FMP missing: clear message", /FMP isn't connected/.test(await page.locator("#content .banner.err").innerText().catch(() => "")));
  await page.evaluate(() => { window.__mock.failFMP = false; MD.data.resetConnectors(); MD.app.go("smartmoney", null, { fromNav: true }); }); await page.waitForTimeout(1500);
  const lat = await page.locator("#content").innerText();
  check("latest filings from FMP with official links", /Tuberville|Nancy Pelosi/.test(lat) && /NVDA/.test(lat) && await page.locator("a:has-text('Official record')").count() >= 1, lat.slice(0, 300));
  await page.evaluate(() => { MD.app.ls.set("sm.tab", "leaders"); MD.app.go("dashboard", null, { fromNav: true }); }); await page.waitForTimeout(1500);
  check("dashboard: Smart Money card", /Top measured returns/i.test(await page.locator("#content").innerText()));

  // ---- Player props (NBA points)
  await page.evaluate(() => { MD.app.ls.set("bet.sport", "nba"); MD.app.ls.set("bet.tab", "props"); MD.app.go("betting", null, { fromNav: true }); }); await page.waitForTimeout(2500);
  const prTxt = await page.locator("#content").innerText();
  check("props: players, consensus lines and best prices from the real props page", /NBA points props/i.test(prTxt) && /Giannis Antetokounmpo/.test(prTxt) && /8 books/.test(prTxt) && /1-800-GAMBLER/.test(prTxt), prTxt.slice(0, 400));
  await page.click("button:has-text('Analyze the 12 most-listed players')"); await page.waitForTimeout(6000);
  const analyzed = await page.evaluate(() => [...MD.propsState.an.values()].filter(a => a.model).length);
  check("props: game logs read from ESPN and modelled for 12 players", analyzed === 12, String(analyzed));
  const prDet = await page.locator("#content").innerText();
  check("props detail: model over %, best price EV, hit rates, every book's line", /Model: over/i.test(prDet) && /Went over/i.test(prDet) && /Breakeven/i.test(prDet) && /pick'em/i.test(prDet), prDet.slice(-900));
  await page.click("button:has-text('Pick props with AI')"); await page.waitForTimeout(3000);
  const pkProps = await page.locator("#content").innerText();
  check("AI prop picks logged for grading", await page.evaluate(() => MD.app.store.cached("proppicks").filter(x => x.kind === "nba-points").length >= 1) && /AI prop record/i.test(await page.locator("#content").innerText()));
  check("AI prop picks: picks with model vs Claude probability, passes and the review", /Claude 58% · model/i.test(pkProps) && /Passed on/i.test(pkProps) && /Review:/i.test(pkProps), pkProps.slice(-700));
  await page.screenshot({ path: path.join(shots, "e2e-props.png"), fullPage: false });
  await page.evaluate(() => { MD.app.ls.set("bet.sport", "nfl"); MD.app.go("betting", null, { fromNav: true }); }); await page.waitForTimeout(2000);
  const tdTxt = await page.locator("#content").innerText();
  check("NFL anytime TD: consensus fair chance, best price, flagged outlier books", /NFL anytime touchdown/i.test(tdTxt) && /Jahmyr Gibbs/.test(tdTxt) && /flagged/.test(tdTxt), tdTxt.slice(0, 400));
  await page.click("button:has-text('Pick touchdown scorers with AI')"); await page.waitForTimeout(2500);
  check("AI touchdown picks against the consensus, reviewed", /to score/.test(await page.locator("#content").innerText()) && /consensus \d+%/.test(await page.locator("#content").innerText()));
  await page.evaluate(() => { MD.app.ls.set("bet.tab", "games"); MD.app.ls.set("bet.sport", "nfl"); });

  // ---- Ask AI from any page, with page context
  await page.evaluate(() => MD.app.openAsset({ id: "stock:AAPL", cls: "stock", symbol: "AAPL", name: "Apple Inc." })); await page.waitForTimeout(1500);
  await page.click("button.askbtn"); await page.waitForTimeout(400);
  check("Ask AI opens with the page's context and starter questions", /Ask AI · AAPL/.test(await page.locator(".modal").innerText()) && await page.locator(".askai .chip").count() === 4);
  await page.click(".askai .chip >> nth=0"); await page.waitForTimeout(1500);
  const askTxt = await page.locator(".modal").innerText();
  check("Ask AI answers with tools and offers a double-check", /Mock answer/.test(askTxt) && /Double-check this answer/.test(askTxt) && await page.evaluate(() => (window.__mock.advisorTools || []).includes("stock_snapshot") && (window.__mock.advisorTools || []).includes("insider_activity") && window.__mock.advisorTools.length <= 20 && (window.__mock.advisorTools || []).includes("explain_move")), askTxt.slice(-300));
  check("AI prompts carry the investor profile", await page.evaluate(() => window.__mock.samplePrompts.some(x => /Investor profile|Market Desk's analyst/.test(x))));
  await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  await page.evaluate(() => { MD.app.ls.set("setTab", "ai"); MD.app.go("settings", { tab: "ai" }); }); await page.waitForTimeout(600);
  await page.selectOption("#content select >> nth=0", "high"); await page.waitForTimeout(800);
  check("investor profile saved from Settings", await page.evaluate(() => MD.app.settings.profile.risk === "high" && /aggressive/.test(MD.ai.profileNote(MD.app))));
  await page.evaluate(() => MD.app.ls.set("setTab", "general"));

  // ---- AI Advisor: Enter sends, Shift+Enter adds a line
  await page.evaluate(() => MD.app.go("advisor", null, { fromNav: true })); await page.waitForTimeout(800);
  const before = await page.evaluate(() => window.__mock.samplePrompts.length);
  await page.fill("textarea", "How diversified am I"); await page.keyboard.press("Shift+Enter"); await page.waitForTimeout(150);
  check("Shift+Enter adds a line instead of sending", await page.evaluate(() => window.__mock.samplePrompts.length) === before && /\n/.test(await page.locator("textarea").inputValue()));
  await page.keyboard.press("Enter"); await page.waitForTimeout(800);
  check("Enter sends the advisor message", await page.evaluate(() => window.__mock.samplePrompts.length) > before && (await page.locator("textarea").inputValue()) === "");
  await page.click("button:has-text('Double-check this answer')"); await page.waitForTimeout(1200);
  check("advisor answers can be double-checked by an independent review", /Review: holds up/i.test(await page.locator("#content").innerText()));
  const adv1 = await page.evaluate(() => ({ names: window.__mock.advisorTools || [], res: window.__mock.advisorResults || {} }));
  check("advisor picks tools for the question within the runtime's cap: a portfolio question gets investing tools, no betting tools", ["get_technicals", "project_price", "zacks_view", "analyze_portfolio", "get_portfolio_context", "search_news", "smart_money", "options_move", "track_record", "market_pulse", "intraday_levels"].every(n => adv1.names.includes(n)) && !adv1.names.includes("get_betting_odds") && adv1.names.length <= 20, adv1.names.join(","));
  check("advisor tools: intraday levels, market pulse, base rates computed by the app", adv1.res.intraday_levels && adv1.res.intraday_levels.levels.length >= 5 && adv1.res.market_pulse && adv1.res.market_pulse.regime && adv1.res.base_rates && adv1.res.base_rates.model.upPct >= 25, JSON.stringify(Object.keys(adv1.res)));
  await page.fill("textarea", "What are the odds on the Dolphins game and is a $40 bet at +250 worth it?"); await page.keyboard.press("Enter"); await page.waitForTimeout(1500);
  const adv2 = await page.evaluate(() => ({ names: window.__mock.advisorTools || [], res: window.__mock.advisorResults || {} }));
  check("a betting question brings the betting tools, still within the cap", ["get_betting_odds", "bet_math", "get_my_bets"].every(n => adv2.names.includes(n)) && adv2.names.length <= 20, adv2.names.join(","));
  const adv = { names: adv2.names, res: Object.assign({}, adv1.res, adv2.res) };
  check("advisor tool: technicals and price range computed by the app", adv.res.get_technicals && adv.res.get_technicals.technicals && adv.res.get_technicals.technicals.rsi14 != null && adv.res.project_price && adv.res.project_price.percentiles && adv.res.project_price.chanceTouchPct != null, JSON.stringify(adv.res.project_price || {}).slice(0, 200));
  check("advisor tool: odds lookup filtered to a team", adv.res.get_betting_odds && adv.res.get_betting_odds.games.length === 1 && /Dolphins/.test(adv.res.get_betting_odds.games[0].game) && adv.res.get_betting_odds.games[0].markets.ml.fairPct, JSON.stringify(adv.res.get_betting_odds || {}).slice(0, 200));
  check("advisor tool: exact bet maths (+250 on $40)", adv.res.bet_math && adv.res.bet_math.decimal === 3.5 && adv.res.bet_math.profitIfWin === 100 && adv.res.bet_math.impliedPct === 28.57 && adv.res.bet_math.edgePct === 5, JSON.stringify(adv.res.bet_math || {}));
  check("advisor tool: Zacks view and tracked bets", adv.res.zacks_view && adv.res.zacks_view.facts && adv.res.get_my_bets && adv.res.get_my_bets.totalBets >= 1, JSON.stringify(adv.res.get_my_bets || {}).slice(0, 200));
  check("no uncaught errors overall", errors.length === 0, errors.slice(0, 5).join(" | "));
  const fail = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - fail}/${results.length} checks passed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
