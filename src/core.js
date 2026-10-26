/* Market Desk core: pure, deterministic financial logic. No DOM, no network.
   Money uses decimal.js (global Decimal). Statistics on returns use floats and are never used for money. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const D = G.Decimal;
  D.set({ precision: 40, rounding: D.ROUND_HALF_EVEN });

  /* ---------- decimals ---------- */
  function dec(x) {
    if (x instanceof D) return x;
    if (x === null || x === undefined) return null;
    const s = String(x).trim().replace(/,/g, "").replace(/^\+/, "");
    if (s === "" || s === "-" || !/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return null;
    return new D(s);
  }
  const ZERO = new D(0), ONE = new D(1);
  const sum = (xs) => xs.reduce((a, b) => a.plus(b), ZERO);

  /* ---------- currency registry ---------- */
  // [code, name, minorUnits, type, note]
  // type: fiat | metal | crypto | stablecoin. Notes flag restricted or non-standard convertibility.
  const BASE_CURRENCIES = [
    ["USD", "US dollar", 2, "fiat"], ["EUR", "Euro", 2, "fiat"], ["GBP", "British pound", 2, "fiat"],
    ["JPY", "Japanese yen", 0, "fiat"], ["CHF", "Swiss franc", 2, "fiat"], ["CAD", "Canadian dollar", 2, "fiat"],
    ["AUD", "Australian dollar", 2, "fiat"], ["NZD", "New Zealand dollar", 2, "fiat"],
    ["CNY", "Chinese yuan (onshore)", 2, "fiat", "Onshore yuan: capital controls; daily trading band around the PBoC fixing."],
    ["CNH", "Chinese yuan (offshore)", 2, "fiat", "Offshore yuan traded in Hong Kong; can differ from onshore CNY."],
    ["HKD", "Hong Kong dollar", 2, "fiat", "Pegged to USD within a 7.75–7.85 band."],
    ["SGD", "Singapore dollar", 2, "fiat"], ["KRW", "South Korean won", 0, "fiat", "Restricted offshore convertibility; offshore trading uses non-deliverable forwards."],
    ["INR", "Indian rupee", 2, "fiat", "Partially convertible; offshore trading uses non-deliverable forwards."],
    ["TWD", "New Taiwan dollar", 2, "fiat", "Restricted convertibility; offshore trading uses non-deliverable forwards."],
    ["THB", "Thai baht", 2, "fiat"], ["MYR", "Malaysian ringgit", 2, "fiat", "Not traded offshore; onshore market controls apply."],
    ["IDR", "Indonesian rupiah", 2, "fiat", "Restricted offshore convertibility."], ["PHP", "Philippine peso", 2, "fiat", "Restricted offshore convertibility."],
    ["VND", "Vietnamese dong", 0, "fiat", "Managed currency with a central-bank reference rate and band; not freely convertible."],
    ["BRL", "Brazilian real", 2, "fiat", "Not freely convertible offshore."], ["MXN", "Mexican peso", 2, "fiat"],
    ["ARS", "Argentine peso", 2, "fiat", "Multiple exchange rates have coexisted (official vs parallel). Indicative rates may not be executable."],
    ["CLP", "Chilean peso", 0, "fiat"], ["COP", "Colombian peso", 2, "fiat"], ["ZAR", "South African rand", 2, "fiat"],
    ["NGN", "Nigerian naira", 2, "fiat", "Official and parallel-market rates can differ widely; access to FX can be limited."],
    ["EGP", "Egyptian pound", 2, "fiat", "History of FX shortages and devaluations; executable rates can differ from indicative."],
    ["TRY", "Turkish lira", 2, "fiat"], ["PLN", "Polish złoty", 2, "fiat"], ["CZK", "Czech koruna", 2, "fiat"],
    ["HUF", "Hungarian forint", 2, "fiat"], ["SEK", "Swedish krona", 2, "fiat"], ["NOK", "Norwegian krone", 2, "fiat"],
    ["DKK", "Danish krone", 2, "fiat", "Pegged to EUR within ERM II."], ["AED", "UAE dirham", 2, "fiat", "Pegged to USD."],
    ["SAR", "Saudi riyal", 2, "fiat", "Pegged to USD."], ["ILS", "Israeli new shekel", 2, "fiat"],
    ["PKR", "Pakistani rupee", 2, "fiat", "Managed float with periodic FX restrictions."], ["BDT", "Bangladeshi taka", 2, "fiat", "Managed; FX availability can be limited."],
    ["KES", "Kenyan shilling", 2, "fiat"], ["GHS", "Ghanaian cedi", 2, "fiat", "Volatile; executable rates can differ from indicative."],
    ["ISK", "Icelandic króna", 0, "fiat"], ["RON", "Romanian leu", 2, "fiat"],
    ["XAU", "Gold (troy ounce)", 4, "metal", "A metal-market unit (1 troy ounce of gold), not a government-issued currency."],
    ["XAG", "Silver (troy ounce)", 4, "metal", "A metal-market unit (1 troy ounce of silver), not a government-issued currency."],
    ["XPT", "Platinum (troy ounce)", 4, "metal", "A metal-market unit, not a currency."],
    ["XPD", "Palladium (troy ounce)", 4, "metal", "A metal-market unit, not a currency."],
    ["BTC", "Bitcoin", 8, "crypto", "Cryptoasset, not legal tender in most jurisdictions."],
    ["ETH", "Ether", 8, "crypto", "Cryptoasset."],
    ["USDT", "Tether USD", 6, "stablecoin", "Stablecoin. Its USD peg is not guaranteed."],
    ["USDC", "USD Coin", 6, "stablecoin", "Stablecoin. Its USD peg is not guaranteed."]
  ];
  const ECB_CODES = new Set("AUD BRL CAD CHF CNY CZK DKK EUR GBP HKD HUF IDR ILS INR ISK JPY KRW MXN MYR NOK NZD PHP PLN RON SEK SGD THB TRY USD ZAR".split(" "));
  function makeRegistry(custom) {
    const map = new Map();
    for (const [code, name, minor, type, note] of BASE_CURRENCIES) map.set(code, { code, name, minor, type, note: note || "", ecbHistory: ECB_CODES.has(code), custom: false });
    for (const c of custom || []) {
      if (!c || !/^[A-Z0-9]{3,5}$/.test(c.code)) continue;
      map.set(c.code, { code: c.code, name: c.name || c.code, minor: Number.isInteger(c.minor) ? c.minor : 2, type: c.type || "fiat", note: c.note || "", ecbHistory: ECB_CODES.has(c.code), custom: true });
    }
    return map;
  }

  /* ---------- pair conventions ---------- */
  // Market convention: metals first, then EUR > GBP > AUD > NZD > USD > CAD > CHF > JPY; USD is base against all others.
  const PAIR_PRIORITY = ["XAU", "XAG", "XPT", "XPD", "BTC", "ETH", "EUR", "GBP", "AUD", "NZD", "USD", "CAD", "CHF", "JPY"];
  function marketPair(a, b) {
    const ra = PAIR_PRIORITY.indexOf(a), rb = PAIR_PRIORITY.indexOf(b);
    if (ra >= 0 && rb >= 0) return { base: ra <= rb ? a : b, quote: ra <= rb ? b : a, convention: "standard" };
    if (ra >= 0) return { base: a, quote: b, convention: "standard" };
    if (rb >= 0) return { base: b, quote: a, convention: "standard" };
    const [x, y] = [a, b].sort();
    return { base: x, quote: y, convention: "none (alphabetical)" };
  }
  function parsePair(s) {
    const m = String(s || "").toUpperCase().match(/\b([A-Z]{3,4})\s*[\/\-\s]?\s*([A-Z]{3,4})\b/);
    return m ? { base: m[1], quote: m[2] } : null;
  }

  /* ---------- FX quotes ----------
     A quote says: 1 unit of `base` = `rate` units of `quote`. */
  function quote(base, quote_, rate, meta) {
    const r = dec(rate);
    if (!r || r.lte(0)) throw new Error("Invalid rate for " + base + "/" + quote_);
    return Object.assign({ base, quote: quote_, rate: r, bid: null, ask: null, source: "", ts: null, type: "indicative-mid", legs: null, warnings: [] }, meta || {}, { rate: r });
  }
  function invert(q) {
    return Object.assign({}, q, { base: q.quote, quote: q.base, rate: ONE.div(q.rate),
      bid: q.ask ? ONE.div(dec(q.ask)) : null, ask: q.bid ? ONE.div(dec(q.bid)) : null, inverted: true });
  }
  // Cross rate A->B through a common pivot P using two quotes P->A and P->B.
  function cross(pa, pb, opts) {
    if (pa.base !== pb.base) throw new Error("Cross legs must share a pivot");
    const maxSkew = (opts && opts.maxSkewMs) || 5 * 60 * 1000;
    const q = quote(pa.quote, pb.quote, pb.rate.div(pa.rate), { type: "cross", source: "cross via " + pa.base, legs: [pa, pb] });
    q.ts = pa.ts != null && pb.ts != null ? Math.min(pa.ts, pb.ts) : (pa.ts ?? pb.ts);
    if (pa.ts != null && pb.ts != null && Math.abs(pa.ts - pb.ts) > maxSkew) q.warnings.push("Leg timestamps differ by " + Math.round(Math.abs(pa.ts - pb.ts) / 60000) + " min; cross rate is estimated.");
    if (pa.type !== pb.type) q.warnings.push("Legs use different rate types (" + pa.type + ", " + pb.type + ").");
    return q;
  }
  // Build a conversion quote from a table of pivot rates {pivot, rates: {CCY: Decimal}, ts, source, type}.
  function rateFromTable(table, from, to) {
    if (from === to) return quote(from, to, 1, { type: "identity", source: "identity", ts: table && table.ts });
    if (!table) return null;
    const P = table.pivot, r = table.rates;
    const leg = (c) => c === P ? ONE : (r[c] ? dec(r[c]) : null);
    const ra = leg(from), rb = leg(to);
    if (!ra || !rb) return null;
    const meta = { ts: table.ts, source: table.source, type: table.type || "indicative-mid" };
    if (from === P) return quote(P, to, rb, meta);
    if (to === P) return invert(quote(P, from, ra, meta));
    return cross(quote(P, from, ra, meta), quote(P, to, rb, meta));
  }
  function convert(amount, q) {
    const a = dec(amount);
    return a == null || !q ? null : a.times(q.rate);
  }
  function spreadBps(bid, ask) {
    const b = dec(bid), a = dec(ask);
    if (!b || !a || b.lte(0) || a.lt(b)) return null;
    const mid = a.plus(b).div(2);
    return a.minus(b).div(mid).times(10000);
  }

  /* ---------- formatting ---------- */
  function minorOf(reg, code) { const c = reg && reg.get(code); return c ? c.minor : 2; }
  function fmtNum(x, dp, locale) {
    const d = dec(x); if (d == null) return "—";
    // Display rounding: half away from zero. Internal arithmetic keeps 40 significant digits (half-even).
    const fixed = d.toDecimalPlaces(dp, D.ROUND_HALF_UP).toFixed(dp);
    const [i, f] = fixed.split(".");
    const neg = i.startsWith("-");
    const intPart = (neg ? i.slice(1) : i).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg ? "-" : "") + intPart + (f ? "." + f : "");
  }
  function fmtMoney(x, code, reg, opts) {
    const d = dec(x); if (d == null) return "—";
    const minor = opts && opts.dp != null ? opts.dp : minorOf(reg, code);
    let dp = minor;
    if (opts && opts.price) { const a = d.abs(); dp = a.gte(1000) ? Math.max(minor, 2) : a.gte(1) ? Math.max(minor, 2) : a.gte("0.01") ? 4 : 6; if (code === "JPY" || code === "KRW") dp = a.gte(100) ? 0 : 2; }
    const sign = opts && opts.sign && d.gt(0) ? "+" : "";
    return sign + fmtNum(d, dp) + " " + code;
  }
  function fmtPct(x, dp = 2, sign = true) {
    const d = dec(x); if (d == null) return "—";
    return (sign && d.gt(0) ? "+" : "") + fmtNum(d, dp) + "%";
  }

  /* ---------- precious metals ---------- */
  const GRAMS_PER = { toz: new D("31.1034768"), g: ONE, kg: new D(1000), oz: new D("28.349523125"), tola: new D("11.6638038"), tael_hk: new D("37.42900"), baht_th: new D("15.244") };
  const UNIT_NAMES = { toz: "troy ounce", g: "gram", kg: "kilogram", oz: "avoirdupois ounce", tola: "tola", tael_hk: "tael (Hong Kong)", baht_th: "baht (Thai gold)" };
  function convertWeight(value, from, to) {
    const v = dec(value); if (v == null || !GRAMS_PER[from] || !GRAMS_PER[to]) return null;
    return v.times(GRAMS_PER[from]).div(GRAMS_PER[to]);
  }
  // Bullion economics. spotPerToz is in the chosen currency.
  function bullion({ quantity, unitWeight, unit, purity, spotPerToz, dealerPremiumPct, buySellSpreadPct, shipping, insurance, storagePerYear, years, taxPct }) {
    const q = dec(quantity) || ZERO, w = dec(unitWeight) || ZERO, p = dec(purity) || ONE, spot = dec(spotPerToz);
    if (!spot) return null;
    const fineToz = convertWeight(q.times(w).times(p), unit, "toz");
    const meltValue = fineToz.times(spot);
    const premium = meltValue.times(dec(dealerPremiumPct) || ZERO).div(100);
    const tax = meltValue.plus(premium).times(dec(taxPct) || ZERO).div(100);
    const acquisition = meltValue.plus(premium).plus(tax).plus(dec(shipping) || ZERO).plus(dec(insurance) || ZERO);
    const holding = (dec(storagePerYear) || ZERO).times(dec(years) || ZERO);
    const sellHaircut = meltValue.times(dec(buySellSpreadPct) || ZERO).div(100);
    const netLiquidation = meltValue.minus(sellHaircut);
    const breakevenSpot = fineToz.gt(0) ? acquisition.plus(holding).div(fineToz).div(ONE.minus((dec(buySellSpreadPct) || ZERO).div(100))) : null;
    return { fineToz, meltValue, premium, tax, acquisition, holding, sellHaircut, netLiquidation, breakevenSpot };
  }

  /* ---------- ledger (FIFO lots, immutable transactions) ---------- */
  const TX_TYPES = ["buy", "sell", "dividend", "fee", "deposit", "withdraw", "reversal"];
  function validDate(s) {
    const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }
  function txSortKey(t) { return (t.tradeDate || "") + "|" + String(t.createdAt || 0).padStart(15, "0") + "|" + (t.id || ""); }
  function validateTx(t, reg) {
    const errs = [];
    if (!TX_TYPES.includes(t.type)) errs.push("Unknown type '" + t.type + "'.");
    if (!validDate(t.tradeDate)) errs.push("Date must be a real calendar date in YYYY-MM-DD form.");
    else if (t.tradeDate.slice(0, 10) > new Date(Date.now() + 864e5).toISOString().slice(0, 10)) errs.push("Date is in the future.");
    if (t.type === "reversal") { if (!t.reverses) errs.push("A reversal must name the transaction it reverses."); return errs; }
    if (!t.assetId) errs.push("Missing asset.");
    if (!t.currency || (reg && !reg.has(t.currency))) errs.push("Unknown currency '" + (t.currency || "") + "'.");
    const q = dec(t.quantity), p = dec(t.price), f = t.fees == null || t.fees === "" ? ZERO : dec(t.fees);
    if (["buy", "sell"].includes(t.type)) {
      if (!q || q.lte(0)) errs.push("Quantity must be greater than zero.");
      if (!p || p.lt(0)) errs.push("Price must be zero or more.");
    }
    if (["dividend", "fee", "deposit", "withdraw"].includes(t.type) && (!dec(t.amount) || dec(t.amount).lte(0))) errs.push("Amount must be greater than zero.");
    if (f == null || f.lt(0)) errs.push("Fees must be zero or more.");
    if (t.fxToUSD != null && t.fxToUSD !== "" && (!dec(t.fxToUSD) || dec(t.fxToUSD).lte(0))) errs.push("FX rate must be greater than zero.");
    return errs;
  }
  function activeTxs(txs) {
    const reversed = new Set(txs.filter(t => t.type === "reversal").map(t => t.reverses));
    return txs.filter(t => t.type !== "reversal" && !reversed.has(t.id)).sort((a, b) => txSortKey(a) < txSortKey(b) ? -1 : 1);
  }
  function buildPositions(txs) {
    const pos = new Map(), issues = [];
    for (const t of activeTxs(txs)) {
      if (!pos.has(t.assetId)) pos.set(t.assetId, { assetId: t.assetId, assetClass: t.assetClass, symbol: t.symbol, name: t.name, currency: t.currency, unit: t.unit || "unit", meta: t.meta || null, qty: ZERO, lots: [], realized: [], income: [], fees: [], lastTxDate: t.tradeDate });
      const p = pos.get(t.assetId);
      p.lastTxDate = t.tradeDate; if (t.meta) p.meta = t.meta;
      if (t.currency !== p.currency && ["buy", "sell"].includes(t.type)) { issues.push({ txId: t.id, msg: "Currency " + t.currency + " differs from the position's " + p.currency + "; transaction skipped." }); continue; }
      const fees = dec(t.fees) || ZERO, fx = dec(t.fxToUSD);
      if (t.type === "buy") {
        const q = dec(t.quantity), cost = q.times(dec(t.price)).plus(fees);
        p.lots.push({ txId: t.id, date: t.tradeDate, qty: q, cost, fxToUSD: fx, fxSource: t.fxSource || null });
        p.qty = p.qty.plus(q);
      } else if (t.type === "sell") {
        let q = dec(t.quantity);
        if (q.gt(p.qty)) { issues.push({ txId: t.id, msg: "Sell of " + q + " exceeds holding of " + p.qty + "; sale capped at holding." }); q = p.qty; }
        if (q.lte(0)) continue;
        const proceeds = q.times(dec(t.price)).minus(fees);
        let remaining = q, costOut = ZERO; const consumed = [];
        while (remaining.gt(0) && p.lots.length) {
          const lot = p.lots[0], take = D.min(lot.qty, remaining);
          const c = lot.cost.times(take).div(lot.qty);
          consumed.push({ qty: take, cost: c, date: lot.date, fxToUSD: lot.fxToUSD });
          lot.cost = lot.cost.minus(c); lot.qty = lot.qty.minus(take); remaining = remaining.minus(take); costOut = costOut.plus(c);
          if (lot.qty.lte(0)) p.lots.shift();
        }
        p.qty = p.qty.minus(q);
        p.realized.push({ txId: t.id, date: t.tradeDate, qty: q, proceeds, cost: costOut, pnl: proceeds.minus(costOut), fxToUSD: fx, consumed });
      } else if (t.type === "dividend") {
        p.income.push({ txId: t.id, date: t.tradeDate, amount: dec(t.amount).minus(fees), currency: t.currency, fxToUSD: fx });
      } else if (t.type === "fee") {
        p.fees.push({ txId: t.id, date: t.tradeDate, amount: dec(t.amount), currency: t.currency, fxToUSD: fx });
      } else if (t.type === "deposit" || t.type === "withdraw") {
        const a = dec(t.amount).times(t.type === "deposit" ? 1 : -1);
        if (t.type === "deposit") p.lots.push({ txId: t.id, date: t.tradeDate, qty: dec(t.amount), cost: dec(t.amount), fxToUSD: fx });
        else {
          let remaining = dec(t.amount);
          while (remaining.gt(0) && p.lots.length) { const lot = p.lots[0], take = D.min(lot.qty, remaining); lot.cost = lot.cost.minus(lot.cost.times(take).div(lot.qty)); lot.qty = lot.qty.minus(take); remaining = remaining.minus(take); if (lot.qty.lte(0)) p.lots.shift(); }
        }
        p.qty = p.qty.plus(a);
      }
    }
    return { positions: pos, issues };
  }
  /* Value a position in its native currency N and reporting currency R.
     rateNow: Decimal N->R now. rateAt(date, lot): Decimal N->R at that date, or null when unknown.
     Decomposition (exact): pnlR = priceEffectR + fxEffectR, where
       priceEffectR = (valueN - costN) * rateNow and fxEffectR = Σ lotCostN * (rateNow - rateLot). */
  function valuePosition(p, priceN, rateNow, rateAt) {
    const price = dec(priceN), rn = dec(rateNow);
    const costN = sum(p.lots.map(l => l.cost));
    const valueN = price ? p.qty.times(price) : null;
    let costR = ZERO, estimated = false, fxEffectR = ZERO;
    for (const l of p.lots) {
      let r = rateAt ? rateAt(l.date, l) : null;
      if (r == null) { r = rn; estimated = true; }
      costR = costR.plus(l.cost.times(r));
      if (rn) fxEffectR = fxEffectR.plus(l.cost.times(rn.minus(r)));
    }
    const out = { qty: p.qty, costN, valueN, pnlN: valueN ? valueN.minus(costN) : null, costR: rn ? costR : null, valueR: valueN && rn ? valueN.times(rn) : null, costBasisStatus: estimated ? "estimated" : "historical" };
    out.pnlR = out.valueR && out.costR ? out.valueR.minus(out.costR) : null;
    out.priceEffectR = out.pnlN && rn ? out.pnlN.times(rn) : null;
    out.fxEffectR = rn ? fxEffectR : null;
    out.pnlPctN = costN.gt(0) && out.pnlN ? out.pnlN.div(costN).times(100) : null;
    out.pnlPctR = out.costR && out.costR.gt(0) && out.pnlR ? out.pnlR.div(out.costR).times(100) : null;
    return out;
  }
  function realizedInReporting(p, rateAt) {
    // Realized P&L in R: proceeds at sale-date rate minus cost at each consumed lot's date rate.
    let pnl = ZERO, fx = ZERO, estimated = false;
    for (const r of p.realized) {
      const rs = rateAt ? rateAt(r.date) : null; if (rs == null) { estimated = true; continue; }
      let costR = ZERO;
      for (const c of r.consumed) { const rl = rateAt(c.date) ?? (estimated = true, rs); costR = costR.plus(c.cost.times(rl)); fx = fx.plus(c.cost.times(rs.minus(rl))); }
      pnl = pnl.plus(r.proceeds.times(rs).minus(costR));
    }
    return { pnl, fxEffect: fx, estimated };
  }

  /* ---------- liquidation & allocation ---------- */
  function netLiquidation(valueR, assumptions) {
    const v = dec(valueR); if (!v) return null;
    const pct = dec(assumptions.exitCostPct) || ZERO, fxPct = dec(assumptions.fxSpreadPct) || ZERO, fixed = dec(assumptions.fixedCost) || ZERO;
    const cost = v.times(pct.plus(fxPct)).div(100).plus(fixed);
    return { gross: v, costs: cost, net: v.minus(cost) };
  }
  function allocation(items, key) {
    const groups = new Map(); let total = ZERO;
    for (const it of items) { const v = dec(it.value); if (!v) continue; const k = it[key] || "Other"; groups.set(k, (groups.get(k) || ZERO).plus(v)); total = total.plus(v); }
    return [...groups.entries()].map(([k, v]) => ({ key: k, value: v, pct: total.gt(0) ? v.div(total).times(100) : ZERO })).sort((a, b) => b.value.cmp(a.value));
  }
  function hhi(weightsPct) { return weightsPct.reduce((a, w) => a + Math.pow(Number(w) / 100, 2), 0); }

  /* ---------- risk / reward ---------- */
  /* Paper account (virtual US dollars): orders in time order → cash, open positions and closed trades. Each buy is
     mirrored into SPY at the same moment with the same dollars; a sell closes the same fraction of the position and of
     its SPY mirror, so every trade can be judged against "the same trade in the S&P 500". No margin, no short selling:
     a buy beyond the cash or a sell of something not held is skipped and reported. feeRate = cost per side. */
  function paperLedger(orders, startCash) {
    let cash = Number(startCash) || 0, mirrorCash = cash;
    const pos = new Map(), closed = [], issues = [];
    for (const o of [...orders].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))) {
      const qty = Number(o.qty), price = Number(o.price), feeRate = Number(o.feeRate) || 0, spy = Number(o.spyPrice) > 0 ? Number(o.spyPrice) : null;
      if (!(qty > 0) || !(price > 0)) { issues.push({ id: o.id, msg: "Order without a quantity or price; skipped." }); continue; }
      let p = pos.get(o.assetId);
      if (o.side === "buy") {
        const amount = qty * price * (1 + feeRate);
        if (amount > cash + 0.005) { issues.push({ id: o.id, msg: "Buy of " + o.symbol + " needs " + amount.toFixed(2) + " but only " + cash.toFixed(2) + " cash was left; skipped." }); continue; }
        if (!p) pos.set(o.assetId, p = { assetId: o.assetId, asset: o.asset || null, symbol: o.symbol, qty: 0, cost: 0, mirror: 0, mirrorKnown: true, openedAt: o.createdAt, sources: [] });
        p.qty += qty; p.cost += amount; cash -= amount; mirrorCash -= amount;
        if (spy) p.mirror += amount / spy; else p.mirrorKnown = false;
        if (o.source && !p.sources.includes(o.source)) p.sources.push(o.source);
      } else if (o.side === "sell") {
        if (!p || p.qty <= 0) { issues.push({ id: o.id, msg: "Sell of " + o.symbol + " without a holding; skipped." }); continue; }
        const q = Math.min(qty, p.qty), frac = q / p.qty, proceeds = q * price * (1 - feeRate), costOut = p.cost * frac, mirrorOut = p.mirror * frac;
        const mirrorProceeds = spy && p.mirrorKnown ? mirrorOut * spy : null;
        if (q < qty - 1e-9) issues.push({ id: o.id, msg: "Sell of " + o.symbol + " was more than held; capped at the holding." });
        cash += proceeds; mirrorCash += mirrorProceeds != null ? mirrorProceeds : proceeds;
        closed.push({ orderId: o.id, assetId: o.assetId, asset: p.asset, symbol: p.symbol, qty: q, cost: costOut, proceeds, pnl: proceeds - costOut, pnlPct: costOut > 0 ? (proceeds / costOut - 1) * 100 : null,
          mirrorPct: mirrorProceeds != null && costOut > 0 ? (mirrorProceeds / costOut - 1) * 100 : null, openedAt: p.openedAt, closedAt: o.createdAt, sources: p.sources.slice() });
        p.qty -= q; p.cost -= costOut; p.mirror -= mirrorOut;
        if (p.qty <= 1e-9) pos.delete(o.assetId);
      }
    }
    return { cash, mirrorCash, positions: [...pos.values()], closed, issues };
  }
  // Mark a ledger to market: prices = {assetId: price}, spyNow = SPY's price now. Missing prices are listed, not guessed.
  function paperValue(L, prices, spyNow, startCash) {
    let held = 0, mirror = 0; const missing = [];
    for (const p of L.positions) { const px = prices[p.assetId]; if (px > 0) held += p.qty * px; else { missing.push(p.symbol); held += p.cost; } if (spyNow > 0 && p.mirrorKnown) mirror += p.mirror * spyNow; else mirror += p.cost; }
    const equity = L.cash + held, mirrorEquity = L.mirrorCash + mirror, s = Number(startCash) || 0;
    return { equity, mirrorEquity, held, returnPct: s > 0 ? (equity / s - 1) * 100 : null, mirrorReturnPct: s > 0 ? (mirrorEquity / s - 1) * 100 : null, missing };
  }
  function rewardRisk({ entry, target, stop, side = "long", feePct = 0, fxCostPct = 0, pUp = null }) {
    const e = dec(entry), t = dec(target), s = dec(stop);
    if (!e || e.lte(0)) return { ok: false, reason: "Entry price must be greater than zero." };
    const costs = (dec(feePct) || ZERO).plus(dec(fxCostPct) || ZERO).div(100).times(2); // round trip
    const dir = side === "short" ? -1 : 1;
    const grossUp = t ? t.minus(e).div(e).times(dir) : null;
    const grossDown = s ? e.minus(s).div(e).times(dir) : null;
    const netUp = grossUp != null ? grossUp.minus(costs) : null;
    const netDown = grossDown != null ? grossDown.plus(costs) : null;
    const out = { ok: true, grossUpPct: grossUp && grossUp.times(100), grossDownPct: grossDown && grossDown.times(100), netUpPct: netUp && netUp.times(100), netDownPct: netDown && netDown.times(100), costsPct: costs.times(100), ratio: null, ratioReason: "" };
    if (netUp == null || netDown == null) out.ratioReason = "Needs both a target and a downside (stop) level.";
    else if (grossUp.lte(0)) out.ratioReason = "Target is not above the entry for this direction.";
    else if (grossDown.lte(0)) out.ratioReason = "Downside level is not below the entry for this direction, so risk is undefined.";
    else if (netUp.lte(0)) { out.ratio = ZERO; out.ratioReason = "Costs consume the whole upside."; }
    else out.ratio = netUp.div(netDown);
    if (netUp != null && netDown != null && netDown.gt(0) && netUp.plus(netDown).gt(0)) out.breakevenWinRatePct = netDown.div(netUp.plus(netDown)).times(100);
    if (pUp != null && netUp != null && netDown != null) { const p = dec(pUp).div(100); out.expectedPct = p.times(netUp).minus(ONE.minus(p).times(netDown)).times(100); }
    return out;
  }

  /* ---------- statistics (floats; returns, not money) ---------- */
  function returnsFrom(values) { const r = []; for (let i = 1; i < values.length; i++) if (values[i - 1] > 0 && values[i] > 0) r.push(Math.log(values[i] / values[i - 1])); return r; }
  const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
  function stdev(a) { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1)); }
  function annVol(values, ppy = 252) { return stdev(returnsFrom(values)) * Math.sqrt(ppy); }
  function maxDrawdown(values) { let peak = -Infinity, mdd = 0, peakI = 0, troughI = 0, bestPeak = 0; values.forEach((v, i) => { if (v > peak) { peak = v; peakI = i; } const dd = v / peak - 1; if (dd < mdd) { mdd = dd; troughI = i; bestPeak = peakI; } }); return { mdd, peakIndex: bestPeak, troughIndex: troughI }; }
  function cagr(v0, v1, years) { return v0 > 0 && years > 0 ? Math.pow(v1 / v0, 1 / years) - 1 : NaN; }
  function sharpe(values, ppy = 252, rf = 0) { const r = returnsFrom(values).map(x => Math.exp(x) - 1); const ex = r.map(x => x - rf / ppy); const s = stdev(ex); return s > 0 ? mean(ex) / s * Math.sqrt(ppy) : NaN; }
  function alignByTime(a, b) { const mb = new Map(b.map(p => [p.time, p.value])); const out = []; for (const p of a) if (mb.has(p.time)) out.push([p.value, mb.get(p.time)]); return out; }
  function correlation(a, b) {
    const pairs = alignByTime(a, b); if (pairs.length < 10) return NaN;
    const ra = returnsFrom(pairs.map(x => x[0])), rb = returnsFrom(pairs.map(x => x[1]));
    const ma = mean(ra), mb = mean(rb); let num = 0, da = 0, db = 0;
    for (let i = 0; i < ra.length; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
    return num / Math.sqrt(da * db);
  }
  function seriesStats(points, ppy) {
    const v = points.map(p => p.close ?? p.value); if (v.length < 2) return null;
    const years = (points[points.length - 1].time - points[0].time) / (365.25 * 86400);
    const dd = maxDrawdown(v);
    return { start: v[0], end: v[v.length - 1], changePct: (v[v.length - 1] / v[0] - 1) * 100, high: Math.max(...points.map(p => p.high ?? p.value)), low: Math.min(...points.map(p => p.low ?? p.value)), volPct: annVol(v, ppy) * 100, maxDrawdownPct: dd.mdd * 100, cagrPct: years >= 0.9 ? cagr(v[0], v[v.length - 1], years) * 100 : null, sharpe: sharpe(v, ppy), years, n: v.length };
  }

  /* ---------- seeded randomness for reproducible simulations ---------- */
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function percentile(sorted, p) { if (!sorted.length) return NaN; const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo); }
  // Probability of touching target before stop within `days` under GBM with annual drift mu and vol sigma.
  function touchProbability({ entry, target, stop, days, mu = 0, sigma, ppy = 252, paths = 4000, seed = 42 }) {
    if (!(sigma > 0) || !(entry > 0) || !(days > 0)) return null;
    const r = rng(seed), dt = 1 / ppy, drift = (mu - 0.5 * sigma * sigma) * dt, sd = sigma * Math.sqrt(dt);
    let hitT = 0, hitS = 0, tTimes = [];
    for (let i = 0; i < paths; i++) { let p = entry; for (let d = 1; d <= days; d++) { p *= Math.exp(drift + sd * gauss(r)); if (target && p >= target) { hitT++; tTimes.push(d); break; } if (stop && p <= stop) { hitS++; break; } } }
    tTimes.sort((a, b) => a - b);
    return { pTarget: hitT / paths, pStop: hitS / paths, pNeither: (paths - hitT - hitS) / paths, medianDaysToTarget: tTimes.length ? percentile(tTimes, 0.5) : null, paths, seed };
  }
  // Long-horizon goal projection with monthly steps. Returns nominal and real percentiles per year.
  function goalSimulation({ start, monthly, years, muPct, volPct, inflationPct, paths = 2000, seed = 7, goal }) {
    const r = rng(seed), m = Math.round(years * 12), mu = muPct / 100, sig = volPct / 100, infl = inflationPct / 100;
    const yearly = Array.from({ length: Math.ceil(years) + 1 }, () => []);
    const finals = [];
    for (let i = 0; i < paths; i++) { let v = start; yearly[0].push(v); for (let k = 1; k <= m; k++) { v = v * Math.exp((mu - 0.5 * sig * sig) / 12 + sig / Math.sqrt(12) * gauss(r)) + monthly; if (k % 12 === 0) yearly[k / 12].push(v); } finals.push(v); }
    const rows = yearly.map((arr, y) => { const s = arr.slice().sort((a, b) => a - b); const deflator = Math.pow(1 + infl, y); return { year: y, p10: percentile(s, 0.1), p50: percentile(s, 0.5), p90: percentile(s, 0.9), p50Real: percentile(s, 0.5) / deflator, p10Real: percentile(s, 0.1) / deflator, p90Real: percentile(s, 0.9) / deflator }; });
    const contributed = start + monthly * m;
    const realGoal = goal ? goal : null;
    const deflT = Math.pow(1 + infl, years);
    const pGoal = realGoal ? finals.filter(v => v / deflT >= realGoal).length / paths : null;
    return { rows, contributed, pGoalReal: pGoal, paths, seed };
  }

  /* ---------- backtesting (daily closes) ---------- */
  function sma(vals, n) { const out = new Array(vals.length).fill(null); let s = 0; for (let i = 0; i < vals.length; i++) { s += vals[i]; if (i >= n) s -= vals[i - n]; if (i >= n - 1) out[i] = s / n; } return out; }
  function backtest(points, strat, opts) {
    const closes = points.map(p => p.close ?? p.value), times = points.map(p => p.time);
    const costRate = (opts && opts.costBps || 0) / 10000, ppy = (opts && opts.ppy) || 252;
    let equity = [], cash = 1, units = 0, trades = 0, inMarket = 0;
    const fast = strat.fast ? sma(closes, strat.fast) : null, slow = strat.slow ? sma(closes, strat.slow) : null;
    let invested = 0;
    for (let i = 0; i < closes.length; i++) {
      const px = closes[i];
      let want = null;
      if (strat.type === "buyhold") want = 1;
      else if (strat.type === "sma") want = fast[i] != null && slow[i] != null ? (fast[i] > slow[i] ? 1 : 0) : 0;
      else if (strat.type === "trend") want = slow[i] != null ? (px > slow[i] ? 1 : 0) : 0;
      if (strat.type === "dca") {
        const month = new Date(times[i] * 1000).getUTCMonth();
        const prevMonth = i ? new Date(times[i - 1] * 1000).getUTCMonth() : -1;
        if (i === 0 || month !== prevMonth) { cash += 1 / 12; invested += 1 / 12; const buy = cash; units += buy * (1 - costRate) / px; cash = 0; trades++; }
      } else {
        // Signal decided on today's close executes at today's close (no look-ahead beyond the bar used).
        const holding = units > 0;
        if (want === 1 && !holding) { units = cash * (1 - costRate) / px; cash = 0; trades++; }
        else if (want === 0 && holding) { cash = units * px * (1 - costRate); units = 0; trades++; }
      }
      if (units > 0) inMarket++;
      equity.push({ time: times[i], value: cash + units * px });
    }
    const vals = equity.map(e => e.value);
    const base = strat.type === "dca" ? (1 + invested) : 1;
    const years = (times[times.length - 1] - times[0]) / (365.25 * 86400);
    const end = vals[vals.length - 1];
    return { equity, trades, exposurePct: inMarket / closes.length * 100, totalReturnPct: (end / base - 1) * 100, cagrPct: strat.type === "dca" ? null : cagr(vals[0], end, years) * 100, volPct: annVol(vals, ppy) * 100, maxDrawdownPct: maxDrawdown(vals).mdd * 100, sharpe: sharpe(vals, ppy, (opts && opts.rf) || 0), invested: base, years };
  }

  /* ---------- scenarios ---------- */
  // FX stress: exposures [{currency, valueR}] (Decimals in reporting ccy). shocks {CCY: pct change of CCY vs reporting}.
  function fxStress(exposures, shocks, reporting) {
    const rows = exposures.filter(e => e.currency !== reporting).map(e => { const s = dec(shocks[e.currency] ?? shocks["*"] ?? 0); return { currency: e.currency, valueR: e.valueR, shockPct: s, impact: e.valueR.times(s).div(100) }; });
    return { rows, total: sum(rows.map(r => r.impact)) };
  }
  // Market ripple: holdings [{id, valueR, betas: {factor: beta}}], factorShocks {factor: pct}.
  function ripple(holdings, factorShocks) {
    const rows = holdings.map(h => { let pct = 0; for (const [f, b] of Object.entries(h.betas || {})) pct += (Number(b) || 0) * (Number(factorShocks[f]) || 0); return { id: h.id, valueR: h.valueR, movePct: pct, impact: h.valueR.times(pct).div(100) }; });
    return { rows, total: sum(rows.map(r => r.impact)) };
  }
  // Catalyst: probability-weighted outcome for one asset.
  function catalystImpact({ price, pEvent, upPct, downPct, noEventDriftPct = 0 }) {
    const p = Number(pEvent) / 100;
    const ev = p * Number(upPct) + (1 - p) * Number(downPct);
    return { expectedMovePct: ev, expectedPrice: Number(price) * (1 + ev / 100), outcomes: [{ label: "Event happens", p, movePct: Number(upPct), price: Number(price) * (1 + Number(upPct) / 100) }, { label: "Event does not happen", p: 1 - p, movePct: Number(downPct), price: Number(price) * (1 + Number(downPct) / 100) }], spreadPct: Number(upPct) - Number(downPct) };
  }

  /* ---------- forecasts ---------- */
  function evaluateForecast(fc, priceAtDue) {
    const p0 = Number(fc.priceAtCreation), p1 = Number(priceAtDue);
    if (!(p0 > 0) || !(p1 > 0)) return null;
    const ret = (p1 / p0 - 1) * 100;
    const band = Number(fc.flatBandPct ?? 1);
    const actual = ret > band ? "up" : ret < -band ? "down" : "flat";
    // "move" = a large move in either direction of at least fc.movePct percent.
    const hit = fc.direction === "move" ? Math.abs(ret) >= Number(fc.movePct || 0) : actual === fc.direction;
    const prob = fc.probability != null ? Number(fc.probability) : null;
    const brier = prob != null ? Math.pow(prob - (hit ? 1 : 0), 2) : null;
    const targetErrPct = fc.target ? (p1 / Number(fc.target) - 1) * 100 : null;
    return { realizedReturnPct: ret, actualDirection: actual, directionHit: hit, brier, targetErrorPct: targetErrPct };
  }
  function calibration(evals) {
    const buckets = [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.01]].map(([lo, hi]) => ({ lo, hi, n: 0, hits: 0 }));
    for (const e of evals) { if (e.probability == null) continue; const b = buckets.find(b => e.probability >= b.lo && e.probability < b.hi); if (b) { b.n++; if (e.directionHit) b.hits++; } }
    const withB = evals.filter(e => e.brier != null);
    return { buckets, n: evals.length, hitRate: evals.length ? evals.filter(e => e.directionHit).length / evals.length : null, brier: withB.length ? mean(withB.map(e => e.brier)) : null, meanAbsTargetErr: mean(evals.filter(e => e.targetErrorPct != null).map(e => Math.abs(e.targetErrorPct))) };
  }

  /* ---------- alerts ---------- */
  // state: {armed: true}. A triggered alert disarms until the condition clears (dedupe).
  function evaluateAlert(alert, value, state) {
    const st = Object.assign({ armed: true }, state || {});
    const v = Number(value), th = Number(alert.threshold);
    if (!isFinite(v)) return { triggered: false, state: st };
    const cond = alert.kind === "above" ? v >= th : alert.kind === "below" ? v <= th : alert.kind === "move" ? Math.abs(v) >= th : false;
    if (cond && st.armed) return { triggered: true, state: { armed: false, lastTriggeredAt: Date.now(), lastValue: v } };
    if (!cond && !st.armed) {
      const hyst = th * (alert.kind === "move" ? 0.5 : 0.002);
      const cleared = alert.kind === "above" ? v < th - hyst : alert.kind === "below" ? v > th + hyst : Math.abs(v) < th - hyst;
      if (cleared) return { triggered: false, state: Object.assign({}, st, { armed: true }) };
    }
    return { triggered: false, state: st };
  }
  function materiality(movePct, volPct) { const dailyVol = (Number(volPct) || 30) / Math.sqrt(252); return Math.abs(Number(movePct)) / (dailyVol || 1); }
  function inQuietHours(now, quiet) {
    if (!quiet || !quiet.enabled) return false;
    const [sh, sm] = String(quiet.start || "22:00").split(":").map(Number), [eh, em] = String(quiet.end || "07:00").split(":").map(Number);
    const mins = now.getHours() * 60 + now.getMinutes(), s = sh * 60 + sm, e = eh * 60 + em;
    return s <= e ? mins >= s && mins < e : mins >= s || mins < e;
  }

  /* ---------- CSV ---------- */
  function parseCSV(text) {
    const rows = []; let row = [], field = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
      else if (c === '"') q = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(field); rows.push(row); row = []; field = ""; }
      else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(x => x.trim() !== ""));
  }
  function toCSV(rows) { return rows.map(r => r.map(v => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\n"); }
  const CSV_COLUMNS = ["date", "type", "asset_class", "symbol", "name", "asset_id", "quantity", "price", "amount", "currency", "fees", "fx_to_usd", "note"];
  function txHash(t) { return [t.tradeDate, t.type, t.assetId, dec(t.quantity)?.toString() || "", dec(t.price)?.toString() || "", dec(t.amount)?.toString() || "", t.currency, dec(t.fees)?.toString() || "0"].join("|"); }
  function csvToTxs(text, reg, existing) {
    const rows = parseCSV(text.replace(/^﻿/, ""));
    if (!rows.length) return { ok: [], errors: [{ line: 0, msg: "The file is empty." }], duplicates: [] };
    const header = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));
    const missing = ["date", "type", "symbol", "currency"].filter(c => !header.includes(c));
    if (missing.length) return { ok: [], errors: [{ line: 1, msg: "Missing required column(s): " + missing.join(", ") + "." }], duplicates: [] };
    const seen = new Set((existing || []).map(txHash));
    const ok = [], errors = [], duplicates = [];
    rows.slice(1).forEach((r, i) => {
      const o = {}; header.forEach((h, j) => o[h] = (r[j] ?? "").trim());
      const cls = (o.asset_class || "stock").toLowerCase();
      const t = { type: o.type.toLowerCase(), tradeDate: o.date, assetClass: cls, symbol: o.symbol.toUpperCase(), name: o.name || o.symbol.toUpperCase(), assetId: o.asset_id || (cls === "cash" ? "cash:" + o.currency.toUpperCase() : cls + ":" + o.symbol.toUpperCase()), quantity: o.quantity || null, price: o.price || null, amount: o.amount || null, currency: o.currency.toUpperCase(), fees: o.fees || "0", fxToUSD: o.fx_to_usd || null, note: o.note || "", source: "csv" };
      const errs = validateTx(t, reg);
      if (errs.length) errors.push({ line: i + 2, msg: errs.join(" ") });
      else { const hsh = txHash(t); if (seen.has(hsh)) duplicates.push({ line: i + 2, tx: t }); else { seen.add(hsh); ok.push(t); } }
    });
    return { ok, errors, duplicates };
  }
  function txsToCSV(txs) {
    return toCSV([CSV_COLUMNS.concat(["id", "created_at", "reverses", "source"]), ...txs.map(t => [t.tradeDate, t.type, t.assetClass, t.symbol, t.name, t.assetId, t.quantity, t.price, t.amount, t.currency, t.fees, t.fxToUSD, t.note, t.id, t.createdAt ? new Date(t.createdAt).toISOString() : "", t.reverses || "", t.source || ""])]);
  }

  /* ---------- fuzzy search ---------- */
  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) { let prev = dp[0]; dp[0] = i; let rowMin = dp[0]; for (let j = 1; j <= b.length; j++) { const tmp = dp[j]; dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = tmp; rowMin = Math.min(rowMin, dp[j]); } if (rowMin > max) return max + 1; }
    return dp[b.length];
  }
  function fuzzyScore(query, text) {
    const q = String(query).toLowerCase().trim(), t = String(text).toLowerCase();
    if (!q) return 0;
    if (t === q) return 100;
    if (t.startsWith(q)) return 90 - Math.min(20, t.length - q.length);
    const words = t.split(/[^a-z0-9]+/).filter(Boolean);
    if (words.some(w => w.startsWith(q))) return 75;
    if (t.includes(q)) return 60;
    const qw = q.split(/\s+/).filter(Boolean);
    let score = 0;
    for (const w of qw) {
      if (words.some(x => x.startsWith(w))) score += 30;
      else if (w.length >= 4 && words.some(x => lev(w, x.slice(0, w.length + 1), 1) <= 1 || lev(w, x, 2) <= 2)) score += 18;
      else return 0;
    }
    return Math.min(55, score / qw.length * 1.6);
  }

  /* ---------- data quality ---------- */
  function freshness(tsMs, kind, now = Date.now()) {
    if (!tsMs) return { status: "unknown", ageMin: null };
    const age = (now - tsMs) / 60000;
    const limits = { crypto: 15, fx: 30, metal: 30, stock: 20, card: 60 * 24 * 3, event: 15 };
    const lim = limits[kind] ?? 60;
    return { status: age <= lim ? "fresh" : age <= lim * 8 ? "delayed" : "stale", ageMin: age };
  }
  function anomalyCheck(prev, next, kind) {
    if (!(prev > 0) || !(next > 0)) return null;
    const move = Math.abs(next / prev - 1) * 100;
    const lim = { stock: 40, etf: 20, crypto: 60, fx: 8, metal: 15 }[kind] ?? 50;
    return move > lim ? "Price moved " + move.toFixed(1) + "% between readings — verify before relying on it." : null;
  }

  /* ---------- live ticks & expected moves ---------- */
  // Fold one live price into a bar series. Bars start at `last.time + k * barSec` (same time base as the series).
  function applyTick(points, kind, barSec, t, price) {
    if (!points.length || !(price > 0) || !(barSec > 0)) return null;
    const last = points[points.length - 1];
    if (t < last.time) return null;
    const k = Math.floor((t - last.time) / barSec);
    if (k === 0) {
      const p = kind === "ohlc" ? { time: last.time, open: last.open, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price } : { time: last.time, value: price };
      points[points.length - 1] = p; return { op: "update", point: p };
    }
    const time = last.time + k * barSec;
    const prev = last.close ?? last.value;
    const p = kind === "ohlc" ? { time, open: prev, high: Math.max(prev, price), low: Math.min(prev, price), close: price } : { time, value: price };
    points.push(p); return { op: "append", point: p };
  }
  // At-the-money straddle as a share of price ≈ the move the options market prices in by expiry.
  function straddleMove(price, call, put) {
    const mid = (o) => { const b = Number(o.bid), a = Number(o.ask), l = Number(o.last); return b > 0 && a >= b ? (a + b) / 2 : l > 0 ? l : NaN; };
    const c = mid(call), p = mid(put), s = Number(price);
    if (!(s > 0) || !isFinite(c) || !isFinite(p)) return null;
    return (c + p) / s * 100;
  }
  // One-standard-deviation move over `days` calendar days from annualized volatility.
  function expectedMoveFromVol(volPct, days) { return Number(volPct) > 0 && days > 0 ? Number(volPct) * Math.sqrt(days / 365) : null; }

  /* ---------- price projection (geometric Brownian motion, closed form) ---------- */
  function erf(x) { const sg = x < 0 ? -1 : 1, a = Math.abs(x), t = 1 / (1 + 0.3275911 * a); return sg * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a)); }
  const normCdf = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
  // Inverse standard normal CDF (Acklam's rational approximation, |error| < 1.2e-9).
  function normInv(p) {
    if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN;
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239], b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572], c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783], d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const lo = 0.02425, hi = 1 - lo;
    if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > hi) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    const q = p - 0.5, r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  /* Distribution of the price `days` calendar days ahead. volPct: annualized volatility; driftPct: the
     expected annual return (0 = no directional view). Log-price is normal, so every figure is exact for
     the model; real markets have fatter tails than this. */
  function projectPrice({ price, volPct, driftPct = 0, days }) {
    price = Number(price); const sig = Number(volPct) / 100, years = Number(days) / 365;
    if (!(price > 0) || !(sig > 0) || !(years > 0) || !(Number(driftPct) > -100)) return null;
    const nu = Math.log(1 + Number(driftPct) / 100) - sig * sig / 2;   // drift of log-price per year
    const m = Math.log(price) + nu * years, s = sig * Math.sqrt(years);
    const quantile = (p) => Math.exp(m + s * normInv(p));
    const probAbove = (k) => k > 0 ? 1 - normCdf((Math.log(k) - m) / s) : 1;
    // Chance the price trades through level k at some point before the horizon (reflection principle with drift).
    const probTouch = (k) => {
      if (!(k > 0)) return null; const b = Math.log(k / price); if (b === 0) return 1;
      const T = years, sd = s, e = Math.exp(2 * nu * b / (sig * sig));
      const p = b > 0 ? normCdf((-b + nu * T) / sd) + e * normCdf((-b - nu * T) / sd) : normCdf((b - nu * T) / sd) + e * normCdf((b + nu * T) / sd);
      return Math.min(1, Math.max(0, p));
    };
    return { price, days: Number(days), volPct: Number(volPct), driftPct: Number(driftPct), sigmaT: s, mean: price * Math.pow(1 + Number(driftPct) / 100, years), median: quantile(0.5),
      p05: quantile(0.05), p25: quantile(0.25), p75: quantile(0.75), p95: quantile(0.95), oneSigmaPct: (Math.exp(s) - 1) * 100, probUp: probAbove(price), quantile, probAbove, probTouch };
  }
  // Annualized volatility implied by an options-implied move (at-the-money straddle ≈ σ·√t·√(2/π) of the price).
  function impliedVolFromMove(movePct, days) { return movePct > 0 && days > 0 ? movePct / (Math.sqrt(2 / Math.PI) * Math.sqrt(days / 365)) : null; }

  /* ---------- technical indicators (describe past prices; they don't predict) ---------- */
  function ema(vals, n) { const k = 2 / (n + 1); let e = null; return vals.map(v => (e = e == null ? v : v * k + e * (1 - k))); }
  function rsi(vals, n = 14) {
    if (vals.length <= n) return null;
    let g = 0, l = 0;
    for (let i = 1; i <= n; i++) { const d = vals[i] - vals[i - 1]; if (d > 0) g += d; else l -= d; }
    g /= n; l /= n;
    for (let i = n + 1; i < vals.length; i++) { const d = vals[i] - vals[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
    return l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l);
  }
  function macd(vals) {
    if (vals.length < 35) return null;
    const a = ema(vals, 12), b = ema(vals, 26), line = a.map((x, i) => x - b[i]), sig = ema(line, 9), n = vals.length - 1;
    return { macd: line[n], signal: sig[n], hist: line[n] - sig[n], prevHist: line[n - 1] - sig[n - 1] };
  }
  // Beta and correlation of daily returns against a benchmark, matched by calendar day.
  function betaTo(points, bench) {
    const day = (p) => Math.floor(p.time / 86400);
    const a = points.map(p => ({ time: day(p), value: p.close ?? p.value })), b = bench.map(p => ({ time: day(p), value: p.close ?? p.value }));
    const pairs = alignByTime(a, b); if (pairs.length < 30) return null;
    const ra = returnsFrom(pairs.map(x => x[0])), rb = returnsFrom(pairs.map(x => x[1]));
    const ma = mean(ra), mb = mean(rb); let cov = 0, va = 0, vb = 0;
    for (let i = 0; i < ra.length; i++) { cov += (ra[i] - ma) * (rb[i] - mb); va += (ra[i] - ma) ** 2; vb += (rb[i] - mb) ** 2; }
    return vb > 0 && va > 0 ? { beta: cov / vb, correlation: cov / Math.sqrt(va * vb), n: ra.length } : null;
  }
  // Returns over standard look-back windows from a daily (or coarser) series, measured to its last point.
  function periodReturns(points, nowSec) {
    if (points.length < 2) return {};
    const last = points[points.length - 1], end = last.close ?? last.value, now = nowSec || last.time;
    const at = (t) => { let best = null; for (const p of points) { if (p.time <= t) best = p; else break; } return best; };
    const y0 = Date.UTC(new Date(now * 1000).getUTCFullYear(), 0, 1) / 1000;
    const out = {};
    for (const [k, t] of [["1W", now - 7 * 86400], ["1M", now - 30 * 86400], ["3M", now - 91 * 86400], ["YTD", y0 - 1], ["1Y", now - 365 * 86400], ["3Y", now - 3 * 365 * 86400], ["5Y", now - 5 * 365 * 86400]]) {
      const p = at(t); if (p && t >= points[0].time - 5 * 86400) out[k] = (end / (p.close ?? p.value) - 1) * 100;
    }
    return out;
  }
  // Snapshot of common indicators from daily points (oldest first).
  function technicals(points, ppy = 252) {
    const v = points.map(p => p.close ?? p.value); if (v.length < 30) return null;
    const n = v.length - 1, last = v[n];
    const s20 = sma(v, 20), s50 = sma(v, 50), s200 = sma(v, 200);
    const yr = points.filter(p => p.time >= points[n].time - 365 * 86400);
    const hi = Math.max(...yr.map(p => p.high ?? p.close ?? p.value)), lo = Math.min(...yr.map(p => p.low ?? p.close ?? p.value));
    let cross = null;
    if (s200[n] != null) {
      const above = s50[n] > s200[n];
      let since = null; for (let i = n; i > 0 && s200[i - 1] != null; i--) { if ((s50[i - 1] > s200[i - 1]) !== above) { since = points[i].time; break; } }
      cross = { kind: above ? "golden" : "death", since };
    }
    const rets = returnsFrom(v), r30 = rets.slice(-30), rYr = returnsFrom(yr.map(p => p.close ?? p.value));
    const simple = rYr.map(x => Math.exp(x) - 1).sort((a, b) => a - b);
    const trend = s200[n] != null ? (last > s50[n] && s50[n] > s200[n] ? "up" : last < s50[n] && s50[n] < s200[n] ? "down" : "mixed") : s50[n] != null ? (last > s50[n] ? "up" : "down") : "mixed";
    return { last, rsi14: rsi(v, 14), sma20: s20[n], sma50: s50[n], sma200: s200[n], cross, high52: hi, low52: lo, rangePos: hi > lo ? (last - lo) / (hi - lo) : null, fromHighPct: (last / hi - 1) * 100,
      macd: macd(v), vol30: r30.length > 10 ? stdev(r30) * Math.sqrt(ppy) * 100 : null, volYr: rYr.length > 20 ? stdev(rYr) * Math.sqrt(ppy) * 100 : null,
      var95: simple.length > 20 ? percentile(simple, 0.05) * 100 : null, worstDay: simple.length ? simple[0] * 100 : null, bestDay: simple.length ? simple[simple.length - 1] * 100 : null,
      maxDrawdownYrPct: maxDrawdown(yr.map(p => p.close ?? p.value)).mdd * 100, trend };
  }

  MD.core = { paperLedger, paperValue, D, dec, applyTick, straddleMove, expectedMoveFromVol, normCdf, normInv, projectPrice, impliedVolFromMove, ema, rsi, macd, betaTo, periodReturns, technicals, ZERO, ONE, sum, BASE_CURRENCIES, ECB_CODES, makeRegistry, PAIR_PRIORITY, marketPair, parsePair, quote, invert, cross, rateFromTable, convert, spreadBps,
    fmtNum, fmtMoney, fmtPct, GRAMS_PER, UNIT_NAMES, convertWeight, bullion, TX_TYPES, validDate, validateTx, activeTxs, buildPositions, valuePosition, realizedInReporting,
    netLiquidation, allocation, hhi, rewardRisk, returnsFrom, mean, stdev, annVol, maxDrawdown, cagr, sharpe, correlation, alignByTime, seriesStats, rng, gauss, percentile,
    touchProbability, goalSimulation, sma, backtest, fxStress, ripple, catalystImpact, evaluateForecast, calibration, evaluateAlert, materiality, inQuietHours,
    parseCSV, toCSV, CSV_COLUMNS, txHash, csvToTxs, txsToCSV, lev, fuzzyScore, freshness, anomalyCheck };
})(typeof window !== "undefined" ? window : globalThis);
