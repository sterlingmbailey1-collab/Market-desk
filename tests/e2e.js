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
  await ctx.addInitScript({ path: path.join(__dirname, "mock-runtime.js") });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  await page.goto("file://" + page_ + "#dashboard");
  await page.waitForSelector(".nav a", { timeout: 10000 });
  await page.waitForTimeout(1500);
  check("app boots and renders navigation", (await page.locator(".nav a").count()) === 18, String(await page.locator(".nav a").count()));
  check("every section has an icon", await page.locator(".nav a .ico svg").count() === 18);
  await page.waitForTimeout(1500);
  check("ticker tape shows markets and opens them", await page.locator("#tape .tape-set").first().locator(".tk").count() >= 8, String(await page.locator("#tape .tk").count()));
  check("account storage selected", await page.locator("text=Saved to account").count() > 0);

  const routes = ["dashboard", "markets", "stocks", "crypto", "fx", "metals", "cards", "betting", "portfolio", "opportunities", "picks", "research", "calendar", "advisor", "strategies", "reports", "inbox", "settings"];
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
  check("recommendations generated, saved and journaled", picks.length === 1 && picks[0].picks.length === 3 && pickFc.length === 3, JSON.stringify({ n: picks.length, p: picks[0] && picks[0].picks.length, f: pickFc.length, log: (await page.locator(".log").innerText()).slice(-300) }));
  await page.waitForTimeout(800);
  const logTxt = await page.locator("#prediction-log").innerText();
  check("prediction log lists each pick with time, prices then/now, projection and target date", await page.locator("#prediction-log table.tbl tbody tr").count() === 3 && /Price then/i.test(logTxt) && /Projected for target date/i.test(logTxt) && /\d{1,2}:\d{2}/.test(logTxt) && !/…/.test(await page.locator("#prediction-log tbody").innerText()), logTxt.slice(0, 400));
  const pkTxt = await page.locator("#content").innerText();
  check("pick explains why, direction and time window", /Why it could move/i.test(pkTxt) && /Time window/i.test(pkTxt) && /Leans up/i.test(pkTxt) && /Big move, either way/i.test(pkTxt), pkTxt.slice(0, 400));
  check("pick sources: retrieved news verified, invented URL flagged", picks[0] && picks[0].picks[0].sources.find(x => /bigdata/.test(x.url)).verified === true && picks[0].picks[0].sources.find(x => /invented/.test(x.url)).verified === false);
  check("'either way' pick journaled as a move forecast", pickFc.some(f => f.direction === "move" && f.movePct > 0));
  await page.screenshot({ path: path.join(shots, "e2e-picks.png"), fullPage: true });

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
  await page.click("#sec-analysis button:has-text('Write an AI review')"); await page.waitForTimeout(800);
  check("AI portfolio review written from the measured figures", /tech-heavy/.test(await page.locator("#sec-analysis .review").innerText()));
  await page.screenshot({ path: path.join(shots, "e2e-portfolio-filled.png"), fullPage: true });

  // ---- Settings persist across reload
  await page.evaluate(() => MD.app.saveSettings({ reportingCurrency: "EUR", mode: "beginner" }));
  await page.waitForTimeout(1200);
  const dbgBefore = await page.evaluate(() => ({ keys: [...window.__mock.store.keys()].length, ss: (sessionStorage.getItem("__mockdb") || "").length, url: location.href }));
  // Headless Chromium occasionally hands a reloaded file:// page a blank, temporary storage area (the data is
  // back on the next load). Reload again in that case; the real artifact stores data in the claude.ai account.
  for (let i = 0; i < 6; i++) { await page.reload(); await page.waitForSelector(".nav a"); if (await page.evaluate(() => localStorage.length) > 0) break; await page.waitForTimeout(700); }
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
  await page.click(".cmd .item:has-text('Ask Market Desk')"); await page.waitForTimeout(1200);
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
  check("forecast recorded immutably", fc.filter(f => f.source !== "ai-picks").length === 1 && await page.evaluate(async () => { try { await MD.app.store.remove("forecasts", MD.app.store.cached("forecasts")[0].id); return false; } catch { return true; } }));
  // Score a due forecast
  await page.evaluate(() => MD.app.store.create("forecasts", { assetId: "stock:AAPL", asset: { id: "stock:AAPL", cls: "stock", symbol: "AAPL" }, symbol: "AAPL", source: "user", direction: "up", probability: 0.7, horizonDays: 30, dueAt: Date.now() - 20 * 864e5, priceAtCreation: 150, currency: "USD", flatBandPct: 1 }));
  await page.waitForTimeout(500);
  await page.evaluate(() => { MD.app.ls.set("resTab", "journal"); MD.app.go("research", {}); });
  await page.waitForTimeout(800);
  await page.click("text=/Score \\d+ due forecast/"); await page.waitForTimeout(2000);
  const ev = await page.evaluate(() => MD.app.store.cached("evals"));
  check("due forecast scored with Brier", ev.length === 1 && typeof ev[0].brier === "number", JSON.stringify(ev[0] || {}));

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

  // ---- AI Advisor: Enter sends, Shift+Enter adds a line
  await page.evaluate(() => MD.app.go("advisor", null, { fromNav: true })); await page.waitForTimeout(800);
  const before = await page.evaluate(() => window.__mock.samplePrompts.length);
  await page.fill("textarea", "How diversified am I"); await page.keyboard.press("Shift+Enter"); await page.waitForTimeout(150);
  check("Shift+Enter adds a line instead of sending", await page.evaluate(() => window.__mock.samplePrompts.length) === before && /\n/.test(await page.locator("textarea").inputValue()));
  await page.keyboard.press("Enter"); await page.waitForTimeout(800);
  check("Enter sends the advisor message", await page.evaluate(() => window.__mock.samplePrompts.length) > before && (await page.locator("textarea").inputValue()) === "");
  const adv = await page.evaluate(() => ({ names: window.__mock.advisorTools || [], res: window.__mock.advisorResults || {} }));
  check("advisor has investing and betting tools", ["get_technicals", "project_price", "zacks_view", "analyze_portfolio", "get_betting_odds", "bet_math", "get_my_bets", "search_news"].every(n => adv.names.includes(n)) && adv.names.length <= 20, adv.names.join(","));
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
