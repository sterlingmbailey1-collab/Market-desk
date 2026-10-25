globalThis.Decimal = require("../vendor/decimal.js");
require("../src/core.js");
require("../src/odds.js");
require("../src/tests.js");
const res = globalThis.MD.tests.run();
let fail = 0;
for (const r of res) { console.log((r.ok ? "PASS " : "FAIL ") + r.name + (r.ok ? "" : "\n     " + r.err)); if (!r.ok) fail++; }
console.log(`\n${res.length - fail}/${res.length} passed`);
process.exit(fail ? 1 : 0);
