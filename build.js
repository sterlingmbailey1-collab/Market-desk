// Bundles src/* into one artifact page. Usage: node build.js <out.html>
const fs = require("fs"), path = require("path");
const order = ["core.js", "odds.js", "tests.js", "data.js", "betting.js", "props.js", "smartmoney.js", "store.js", "ui.js", "live.js", "app.js", "views-common.js", "views-insights.js", "views-cards.js", "views-markets.js", "views-decide.js", "views-portfolio-analysis.js", "research.js", "ai-kit.js", "views-opps-ai.js", "views-watch.js", "views-earnings.js", "views-rebalance.js", "ai-take.js", "ask-ai.js", "views-picks.js", "views-smartmoney.js", "bet-ai.js", "views-betting.js", "views-props.js", "views-ai.js", "main.js"];
const src = (f) => fs.readFileSync(path.join(__dirname, "src", f), "utf8");
for (const f of order) { try { new Function(src(f)); } catch (e) { console.error("Syntax error in " + f + ": " + e.message); process.exit(1); } }
const scripts = order.map(f => "<script>\n/* ---- " + f + " ---- */\n" + src(f).replace(/<\/script/gi, "<\\/script") + "\n</script>").join("\n");
// Function form: a string replacement would treat "$$", "$&" and "$'" in the code as patterns.
const html = src("template.html").replace("<!--SCRIPTS-->", () => scripts);
const out = process.argv[2] || path.join(__dirname, "dist", "market-desk.html");
fs.writeFileSync(out, html);
console.log("Wrote " + out + " (" + (html.length / 1024).toFixed(0) + " KB)");
