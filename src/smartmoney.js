/* Smart Money data: what members of Congress and well-known investors disclose buying and selling, and
   how those disclosed positions have done. Congress trades come from Capitol Trades (STOCK Act filings),
   superinvestor portfolios from Dataroma (13F filings), both read through Exa; the latest filings feed
   comes from the FMP connector. Every return here is computed by the page from exchange closes and set
   against SPY over the same dates. Projections are a stated model, not a forecast anyone made. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const C = MD.core, D = MD.data;

  // Members with active, frequently disclosed stock trading (Capitol Trades / bioguide ids).
  const POLITICIANS = [
    ["P000197", "Nancy Pelosi"], ["K000389", "Ro Khanna"], ["G000583", "Josh Gottheimer"], ["M001157", "Michael McCaul"], ["T000278", "Tommy Tuberville"],
    ["C001120", "Dan Crenshaw"], ["M001190", "Markwayne Mullin"], ["S001217", "Rick Scott"], ["F000479", "John Fetterman"], ["H001082", "Kevin Hern"],
    ["W000797", "Debbie Wasserman Schultz"], ["M001217", "Jared Moskowitz"], ["A000383", "Alan Armstrong"]
  ].map(([id, name]) => ({ id, name }));
  // Dataroma manager codes.
  const INVESTORS = [
    ["BRK", "Warren Buffett", "Berkshire Hathaway"], ["psc", "Bill Ackman", "Pershing Square Capital Management"], ["ic", "Carl Icahn", "Icahn Capital Management"],
    ["BAUPOST", "Seth Klarman", "Baupost Group"], ["AM", "David Tepper", "Appaloosa Management"], ["HC", "Li Lu", "Himalaya Capital Management"], ["FS", "Terry Smith", "Fundsmith"],
    ["GFT", "Bill & Melinda Gates Foundation Trust", ""], ["TGM", "Chase Coleman", "Tiger Global Management"], ["LMM", "Bill Miller", "Miller Value Partners"]
  ].map(([code, name, firm]) => ({ code, name, firm }));
  const WINDOWS = [["1M", 30], ["3M", 91], ["6M", 182], ["1Y", 365]];
  const EQUITY_PREMIUM_PCT = 5;   // long-run market return assumed = risk-free rate + this
  const capitolUrl = (id) => "https://www.capitoltrades.com/politicians/" + encodeURIComponent(id);
  const holdingsUrl = (code) => "https://www.dataroma.com/m/holdings.php?m=" + encodeURIComponent(code);
  const activityUrl = (code) => "https://www.dataroma.com/m/m_activity.php?m=" + encodeURIComponent(code) + "&typ=a";

  /* ---------- parsing ---------- */
  const cellsOf = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
  const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  // "8 Sept 2026" → "2026-09-08"
  function dmy(s) {
    const m = String(s || "").trim().match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/); if (!m) return null;
    const mo = MON[m[2].slice(0, 3).toLowerCase()]; if (mo == null) return null;
    return m[3] + "-" + String(mo + 1).padStart(2, "0") + "-" + m[1].padStart(2, "0");
  }
  const money = (s) => { const m = String(s || "").replace(/[\s,]/g, "").match(/^\$?([\d.]+)([KMB]?)$/i); return m ? +m[1] * ({ K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase()] || 1) : null; };
  // Disclosed size bucket ("500K–1M", "1K–15K", "50M+", "< 1K", "$1,001 - $15,000") → USD range and midpoint.
  function sizeRange(s) {
    const t = String(s || "").replace(/\s/g, "").replace(/[–—]/g, "-");
    let m = t.match(/^([^-]+)-([^-]+)$/);
    if (m && money(m[1]) != null && money(m[2]) != null) { const lo = money(m[1]), hi = money(m[2]); return { low: lo, high: hi, mid: (lo + hi) / 2, label: String(s).trim() }; }
    m = t.match(/^(.+)\+$/); if (m && money(m[1]) != null) { const lo = money(m[1]); return { low: lo, high: null, mid: lo * 1.5, label: String(s).trim() }; }
    m = t.match(/^<(.+)$/); if (m && money(m[1]) != null) { const hi = money(m[1]); return { low: 0, high: hi, mid: hi / 2, label: String(s).trim() }; }
    return null;
  }
  function bullets(t, heading) {
    const i = t.indexOf("## " + heading); if (i < 0) return [];
    const out = [];
    for (const line of t.slice(i).split(/\r?\n/).slice(1)) {
      if (/^##/.test(line)) break;
      const m = line.match(/^-\s+(.+?)\s*(\d+)\s*$/); if (m) out.push({ name: m[1], count: +m[2] });
    }
    return out;
  }
  // A member's Capitol Trades page: header facts and the most recent trades.
  function parseCapitol(text, id) {
    const t = String(text || "");
    const out = { id, name: null, party: null, chamber: null, state: null, tradesCount: null, issuersCount: null, volume: null, lastTraded: null, trades: [], sectors: bullets(t, "Most Traded Sectors"), topIssuers: bullets(t, "Most Traded Issuers"), url: capitolUrl(id) };
    let m = t.match(/Which stocks is (.+?) trading/); if (m) out.name = m[1].trim();
    m = t.match(/^##\s+(Democrat|Republican|Independent|Other)\s+(House|Senate)\s+(.+)$/m); if (m) { out.party = m[1]; out.chamber = m[2]; out.state = m[3].trim(); }
    m = t.match(/([\d,]+)\s*Trades\s*([\d,]+)\s*Issuers/); if (m) { out.tradesCount = +m[1].replace(/,/g, ""); out.issuersCount = +m[2].replace(/,/g, ""); }
    m = t.match(/\$([\d.,]+[KMB]?)\s*Volume\s*(\d{4}-\d{2}-\d{2})\s*Last Traded/i); if (m) { out.volume = money(m[1]); out.lastTraded = m[2]; }
    for (const line of t.split(/\r?\n/)) {
      if (!/^\s*\|/.test(line)) continue;
      const c = cellsOf(line);
      if (c.length < 6 || c[0] === "Traded Issuer") continue;
      const traded = dmy(c[2]), published = dmy(c[1]); if (!traded) continue;
      const im = c[0].match(/^(.*?)\s+([A-Z0-9][A-Z0-9.\/-]*):([A-Z]{2})$/);
      const issuer = im ? im[1].trim() : c[0].replace(/\s+N\/A$/, "").trim();
      const ty = c[4].toLowerCase();
      const fa = String(c[3]).match(/\d+/);
      out.trades.push({ issuer, ticker: im && im[3] === "US" ? im[2].replace("/", ".") : null, published, traded, filedAfterDays: fa ? +fa[0] : null,
        type: /buy|purchase/.test(ty) ? "buy" : /sell|sale/.test(ty) ? "sell" : ty || "other", size: sizeRange(c[5]) });
    }
    m = t.match(/Page\s+(\d+)\s+of\s+(\d+)/); out.page = m ? +m[1] : 1;
    out.pages = m ? +m[2] : out.tradesCount && out.trades.length ? Math.ceil(out.tradesCount / Math.max(15, out.trades.length)) : 1;
    return out;
  }
  // A Dataroma portfolio page: manager, 13F period and holdings with Dataroma's own current prices.
  function parseHoldings(text, code) {
    const t = String(text || "");
    const out = { code, manager: null, period: null, portfolioDate: null, stocksCount: null, value: null, holdings: [], url: holdingsUrl(code) };
    const lines = t.split(/\r?\n/);
    const pi = lines.findIndex(l => /^Period:\s*Q\d/.test(l.trim()));
    if (pi >= 0) {
      for (let j = pi - 1; j >= 0; j--) if (lines[j].trim() && !/^#|^URL:|DATAROMA/.test(lines[j])) { out.manager = lines[j].trim(); break; }
      const m = lines[pi].match(/Period:\s*(Q\d \d{4})\s+Portfolio date:\s*(\d{1,2} \w+ \d{4})\s+No\. of stocks:\s*(\d+)\s+Portfolio value:\s*\$([\d,]+)/);
      if (m) { out.period = m[1]; out.portfolioDate = dmy(m[2]); out.stocksCount = +m[3]; out.value = +m[4].replace(/,/g, ""); }
    }
    for (const line of lines) {
      if (!/^\s*\|/.test(line)) continue;
      const c = cellsOf(line);
      if (c.length < 9) continue;
      const sm = c[1].match(/^([A-Z0-9][A-Z0-9.\-]*)\s+-\s+(.+)$/); if (!sm) continue;
      const w = D.num(c[2]); if (w == null) continue;
      const act = c[3] || "";
      out.holdings.push({ symbol: sm[1], name: sm[2].trim(), weightPct: w, activity: act, activityKind: (act.match(/^(Buy|Add|Reduce|Sell)/i) || [])[1] || null,
        shares: D.num(c[4]), reportedPrice: D.num(c[5]), value: D.num(c[6]), currentPrice: D.num(c[7]), changePct: D.num(c[8]), low52: D.num(c[9]), high52: D.num(c[10]) });
    }
    return out;
  }
  // Quarterly buys and sells from Dataroma's activity page.
  function parseActivity(text) {
    const out = []; let q = null;
    for (const line of String(text || "").split(/\r?\n/)) {
      if (!/^\s*\|/.test(line)) continue;
      const c = cellsOf(line);
      if (/^Q\d \d{4}$/.test(c[0])) { q = c[0]; continue; }
      const sm = (c[1] || "").match(/^([A-Z0-9][A-Z0-9.\-]*)\s+-\s+(.+)$/); if (!sm || !q) continue;
      const am = String(c[2] || "").match(/^(Buy|Add|Reduce|Sell)\s*([\d.]+%)?/i); if (!am) continue;
      out.push({ quarter: q, symbol: sm[1], name: sm[2].trim(), action: am[1][0].toUpperCase() + am[1].slice(1).toLowerCase(), changePct: am[2] ? D.num(am[2]) : null, shares: D.num(c[3]), portfolioImpactPct: D.num(c[4]) });
    }
    return out;
  }
  // FMP house-latest / senate-latest rows → one shape.
  function normalizeFmp(rows, chamber) {
    return (Array.isArray(rows) ? rows : []).filter(r => r && r.transactionDate).map(r => ({ chamber, member: [r.firstName, r.lastName].filter(Boolean).join(" ") || r.office || "", bioguide: r.senateID || null, district: r.district || null,
      symbol: r.symbol && r.symbol !== "--" ? String(r.symbol).toUpperCase() : null, asset: r.assetDescription || "", assetType: r.assetType || "", type: /purchase/i.test(r.type) ? "buy" : /sale/i.test(r.type) ? "sell" : String(r.type || "").toLowerCase(),
      typeLabel: r.type || "", owner: r.owner || "", traded: r.transactionDate, disclosed: r.disclosureDate, size: sizeRange(r.amount), link: r.link || null }));
  }

  /* ---------- fetching ---------- */
  /* A member's page plus up to `pages` pages of trades (15 per page, newest first). Later pages are
     separate crawls, so the header facts come from page 1. */
  async function politician(id, pages = 2) {
    const first = parseCapitol(await D.fetchRaw(capitolUrl(id), 30000, 600000), id);
    const more = Math.min(pages, first.pages || 1);
    if (more > 1) {
      const rest = await Promise.all(Array.from({ length: more - 1 }, (_, i) => D.fetchRaw(capitolUrl(id) + "?page=" + (i + 2), 30000, 600000).then(t => parseCapitol(t, id)).catch(() => null)));
      // Pages are crawled at different times, so a row can show up on two of them; drop such repeats
      // (repeats on one page are separate lots and stay).
      const key = (t) => [t.issuer, t.traded, t.published, t.type, t.size && t.size.label].join("|");
      for (const r of rest) {
        if (!r) continue;
        const seen = new Map(); for (const t of first.trades) seen.set(key(t), (seen.get(key(t)) || 0) + 1);
        for (const t of r.trades) { const k = key(t); if (seen.get(k) > 0) seen.set(k, seen.get(k) - 1); else first.trades.push(t); }
      }
      first.pagesRead = 1 + rest.filter(Boolean).length;
    } else first.pagesRead = 1;
    return first;
  }
  async function investor(code) { const p = parseHoldings(await D.fetchRaw(holdingsUrl(code), 40000, 600000), code); if (!p.holdings.length && !p.period) throw new D.DataError("not_found", "Dataroma has no portfolio for " + code + ".", "dataroma"); return p; }
  async function activity(code) { return parseActivity(await D.fetchRaw(activityUrl(code), 30000, 600000)); }
  const fmpConn = D.connector("FMP", "fmp");
  async function latestFilings(limit = 60) {
    const rowsOf = (v) => Array.isArray(v) ? v : v && Array.isArray(v.__text) ? v.__text : v && Array.isArray(v.result) ? v.result : v && Array.isArray(v.data) ? v.data : [];
    const [hs, ss] = await Promise.allSettled([fmpConn.call("senate", { endpoint: "house-latest", limit }, 10 * 60e3), fmpConn.call("senate", { endpoint: "senate-latest", limit }, 10 * 60e3)]);
    if (hs.status === "rejected" && ss.status === "rejected") throw hs.reason;
    const out = normalizeFmp(hs.status === "fulfilled" ? rowsOf(hs.value) : [], "House").concat(normalizeFmp(ss.status === "fulfilled" ? rowsOf(ss.value) : [], "Senate"));
    return out.sort((a, b) => String(b.disclosed).localeCompare(String(a.disclosed)) || String(b.traded).localeCompare(String(a.traded)));
  }
  // Daily closes for a US ticker, shared by everyone who traded it.
  const series = new Map();
  function closes(sym, tf) {
    const key = sym + "|" + tf;
    if (!series.has(key)) {
      const cls = sym === "SPY" || D.stocks.ETFS.some(e => e[0] === sym) ? "etf" : "stock";
      const p = D.historyFor({ id: cls + ":" + sym, cls, symbol: sym, name: sym }, tf).then(s => s.points.map(x => ({ time: x.time, close: x.close ?? x.value })).filter(x => x.close > 0));
      series.set(key, p); p.catch(() => series.delete(key));
    }
    return series.get(key);
  }
  const tfFor = (oldest) => !oldest || (Date.now() - Date.parse(oldest)) / 864e5 < 350 ? "1Y" : "3Y";

  /* ---------- measuring ---------- */
  const dayT = (ymd) => Date.parse(ymd + "T00:00:00Z") / 1000;
  // Close on or before a date (a weekend trade uses Friday's close), within a week.
  function closeOn(pts, ymd) {
    if (!pts || !pts.length || !ymd) return null;
    const t = dayT(ymd) + 43200; let lo = 0, hi = pts.length - 1, best = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (pts[mid].time <= t) { best = mid; lo = mid + 1; } else hi = mid - 1; }
    if (best < 0 || t - pts[best].time > 7 * 86400) return null;
    return pts[best];
  }
  // Each trade's move from the trade date and from the publish date to the latest close, beside SPY's.
  function measureTrades(trades, byTicker, spy, asOf) {
    const spyEnd = spy && spy.length ? spy[spy.length - 1] : null;
    return trades.map(t => {
      const pts = t.ticker ? byTicker.get(t.ticker) : null;
      if (!pts || !pts.length) return Object.assign({}, t, { ret: null, why: !t.ticker ? "Not a listed US security" : pts === undefined ? "Price history not loaded" : "No price history" });
      const end = pts[pts.length - 1], a = closeOn(pts, t.traded), b = closeOn(pts, t.published), sa = closeOn(spy, t.traded), sb = closeOn(spy, t.published);
      const r = (x, y) => x && y ? (y.close / x.close - 1) * 100 : null;
      const ret = r(a, end), retPub = r(b, end), spyRet = r(sa, spyEnd), spyRetPub = r(sb, spyEnd);
      return Object.assign({}, t, { p0: a ? a.close : null, pPub: b ? b.close : null, pNow: end.close, nowDate: new Date(end.time * 1000).toISOString().slice(0, 10), ret, retPub, spyRet, spyRetPub,
        excess: ret != null && spyRet != null ? ret - spyRet : null, excessPub: retPub != null && spyRetPub != null ? retPub - spyRetPub : null, days: a ? Math.max(1, (end.time - dayT(t.traded)) / 86400) : null, why: a ? null : "No close near the trade date" });
    });
  }
  // Size-weighted summary of buys (optionally only those made in the last `days`).
  function summarize(rows, days, now = Date.now()) {
    const buys = rows.filter(r => r.type === "buy" && r.ret != null && (days == null || (now - Date.parse(r.traded)) / 864e5 <= days));
    if (!buys.length) return { n: 0 };
    const wt = (r) => (r.size && r.size.mid) || 1, W = buys.reduce((s, r) => s + wt(r), 0);
    const avg = (k) => { const xs = buys.filter(r => r[k] != null); const w = xs.reduce((s, r) => s + wt(r), 0); return w ? xs.reduce((s, r) => s + wt(r) * r[k], 0) / w : null; };
    const years = buys.reduce((s, r) => s + wt(r) * Math.max(30, r.days || 30) / 365, 0) / W;
    return { n: buys.length, weight: W, ret: avg("ret"), retPub: avg("retPub"), spyRet: avg("spyRet"), excess: avg("excess"), excessPub: avg("excessPub"), hitRate: buys.filter(r => r.excess > 0).length / buys.length * 100, years,
      best: buys.reduce((b, r) => !b || r.ret > b.ret ? r : b, null), worst: buys.reduce((b, r) => !b || r.ret < b.ret ? r : b, null) };
  }
  // Disclosed net buying per ticker (buys minus sells, by size midpoint), as a rough "still held" estimate.
  function netPositions(trades) {
    const m = new Map();
    for (const t of trades) { if (!t.ticker) continue; const v = (t.size && t.size.mid) || 0; const e = m.get(t.ticker) || { ticker: t.ticker, issuer: t.issuer, bought: 0, sold: 0, last: t.traded }; if (t.type === "buy") e.bought += v; else if (t.type === "sell") e.sold += v; if (t.traded > e.last) e.last = t.traded; m.set(t.ticker, e); }
    return [...m.values()].map(e => Object.assign(e, { net: Math.max(0, e.bought - e.sold) })).sort((a, b) => b.net - a.net || b.bought - a.bought);
  }
  // Annualized volatility of a weighted basket from aligned daily closes over the last year.
  function basketVol(weights, byTicker) {
    const ws = weights.filter(w => w.weight > 0 && byTicker.get(w.symbol) && byTicker.get(w.symbol).length > 30);
    if (!ws.length) return null;
    const cut = Date.now() / 1000 - 370 * 86400, daily = new Map();
    for (const w of ws) { const pts = byTicker.get(w.symbol).filter(p => p.time >= cut); for (let i = 1; i < pts.length; i++) { const d = Math.floor(pts[i].time / 86400); const e = daily.get(d) || { s: 0, w: 0 }; e.s += w.weight * Math.log(pts[i].close / pts[i - 1].close); e.w += w.weight; daily.set(d, e); } }
    const rets = [...daily.entries()].sort((a, b) => a[0] - b[0]).filter(([, e]) => e.w > 0).map(([, e]) => e.s / e.w);
    return rets.length > 40 ? C.stdev(rets) * Math.sqrt(252) * 100 : null;
  }
  // Buy-and-hold value of today's weights over the past year (rebased to 100), beside SPY.
  function basketCurve(weights, byTicker, spy, days = 365) {
    const ws = weights.filter(w => w.weight > 0 && byTicker.get(w.symbol) && byTicker.get(w.symbol).length > 30);
    if (!ws.length || !spy || spy.length < 30) return null;
    const start = Date.now() / 1000 - days * 86400, sp = spy.filter(p => p.time >= start); if (sp.length < 10) return null;
    const base = ws.map(w => { const pts = byTicker.get(w.symbol); const p0 = closeOn(pts, new Date(sp[0].time * 1000).toISOString().slice(0, 10)); return p0 ? { w, pts, p0: p0.close } : null; }).filter(Boolean);
    const W = base.reduce((s, b) => s + b.w.weight, 0); if (!W) return null;
    const pts = sp.map(s => { const ymd = new Date(s.time * 1000).toISOString().slice(0, 10); let v = 0, ww = 0; for (const b of base) { const c = closeOn(b.pts, ymd); if (c) { v += b.w.weight * c.close / b.p0; ww += b.w.weight; } } return ww ? { time: s.time, value: v / ww * 100 } : null; }).filter(Boolean);
    const spyPts = sp.map(s => ({ time: s.time, value: s.close / sp[0].close * 100 }));
    const at = (arr, d) => { const t = arr[arr.length - 1].time - d * 86400; let b = arr[0]; for (const p of arr) { if (p.time <= t) b = p; else break; } return b; };
    const per = {}; for (const [k, d] of WINDOWS) if (d <= days) { const a = at(pts, d), z = pts[pts.length - 1], sa = at(spyPts, d), sz = spyPts[spyPts.length - 1]; per[k] = { ret: (z.value / a.value - 1) * 100, spy: (sz.value / sa.value - 1) * 100 }; }
    return { points: pts, spy: spyPts, periods: per, covered: W / weights.reduce((s, w) => s + (w.weight || 0), 0) * 100, used: base.length };
  }
  /* Copy-trade backtest: the same stake into every disclosed buy on the day it was published (the first day
     a follower could act), held to the latest close, beside the same money put into SPY on the same days.
     Values are per 100 invested so far. */
  function copyCurve(rows, byTicker, spy, stake = 1000) {
    if (!spy || spy.length < 2) return null;
    const iso = (t) => new Date(t * 1000).toISOString().slice(0, 10);
    const legs = rows.filter(r => r.type === "buy" && r.ticker && r.published).map(r => {
      const pts = byTicker.get(r.ticker), p0 = closeOn(pts, r.published), s0 = closeOn(spy, r.published);
      return pts && p0 && s0 ? { r, pts, sh: stake / p0.close, ssh: stake / s0.close, t0: dayT(r.published) } : null;
    }).filter(Boolean).sort((a, b) => a.t0 - b.t0);
    if (!legs.length) return null;
    const pts = [], bench = [];
    for (const d of spy) {
      if (d.time < legs[0].t0 - 43200) continue;
      let v = 0, b = 0, inv = 0;
      for (const L of legs) { if (L.t0 > d.time + 43200) continue; const c = closeOn(L.pts, iso(d.time)); if (!c) continue; v += L.sh * c.close; b += L.ssh * d.close; inv += stake; }
      if (inv) { pts.push({ time: d.time, value: v / inv * 100 }); bench.push({ time: d.time, value: b / inv * 100 }); }
    }
    if (!pts.length) return null;
    const z = pts[pts.length - 1], zb = bench[bench.length - 1];
    return { points: pts, spy: bench, legs: legs.length, stake, invested: legs.length * stake, value: z.value / 100 * legs.length * stake, ret: z.value - 100, spyRet: zb.value - 100, from: legs[0].r.published };
  }
  /* Forward model for a copy portfolio: log-normal, drift = long-run market return plus the measured
     excess return, shrunk toward zero by how little evidence there is (n / (n + k)). */
  function project({ excessPct, years, n, k = 20, volPct, riskFreePct = 4 }) {
    const mkt = riskFreePct + EQUITY_PREMIUM_PCT;
    const alphaAnn = excessPct != null && years > 0 ? Math.max(-40, Math.min(40, excessPct / Math.max(years, 0.25))) : 0;
    const shrink = n > 0 ? n / (n + k) : 0, driftPct = mkt + shrink * alphaAnn, vol = volPct > 0 ? volPct : null;
    const horizons = {};
    for (const [lbl, d] of WINDOWS) {
      const mean = (Math.pow(1 + driftPct / 100, d / 365) - 1) * 100;
      const p = vol ? C.projectPrice({ price: 100, volPct: vol, driftPct, days: d }) : null;
      horizons[lbl] = { mean, p05: p ? p.p05 - 100 : null, p50: p ? p.median - 100 : null, p95: p ? p.p95 - 100 : null, probUp: p ? p.probUp * 100 : null };
    }
    return { marketPct: mkt, alphaAnnPct: alphaAnn, shrink, driftPct, volPct: vol, horizons };
  }

  // Tickers bought by several of the people tracked (politicians: buys in the last 90 days; investors: latest quarter's buys and adds).
  function consensus(pols, invs) {
    const m = new Map(), now = Date.now();
    const add = (sym, name, who, kind, mid) => { if (!sym) return; const e = m.get(sym) || { symbol: sym, name, politicians: new Set(), investors: new Set(), boughtUSD: 0, sold: 0 }; if (kind === "pol") e.politicians.add(who); else e.investors.add(who); e.boughtUSD += mid || 0; m.set(sym, e); };
    for (const p of pols) for (const t of p.trades || []) if (t.ticker && (now - Date.parse(t.traded)) / 864e5 <= 90) { if (t.type === "buy") add(t.ticker, t.issuer, p.name, "pol", t.size && t.size.mid); else if (t.type === "sell") { const e = m.get(t.ticker); if (e) e.sold++; } }
    for (const v of invs) for (const x of v.holdings || []) if (/^(Buy|Add)$/i.test(x.activityKind || "")) add(x.symbol, x.name, v.name, "inv", 0);
    return [...m.values()].map(e => Object.assign(e, { people: e.politicians.size + e.investors.size, politicians: [...e.politicians], investors: [...e.investors] })).sort((a, b) => b.people - a.people || b.boughtUSD - a.boughtUSD);
  }

  MD.smart = { POLITICIANS, INVESTORS, WINDOWS, EQUITY_PREMIUM_PCT, capitolUrl, holdingsUrl, activityUrl, dmy, sizeRange, parseCapitol, parseHoldings, parseActivity, normalizeFmp,
    politician, investor, activity, latestFilings, closes, tfFor, closeOn, measureTrades, summarize, netPositions, basketVol, basketCurve, copyCurve, project, consensus };
})(typeof window !== "undefined" ? window : globalThis);
