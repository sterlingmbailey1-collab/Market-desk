/* Quant engine: measured odds and explanations for the AI to reason over. Every number here comes from price
   history; nothing is a guess.
   - Base rates: how often an asset finished higher over a horizon in its own history, overall and in situations
     like today's (RSI, trend, a sharp recent move, distance from the high), with honest sample sizes.
   - Direction model: those base rates, shrunk toward 50% by how little independent evidence there is, as P(up)/P(down).
   - Factor model: daily returns regressed on the market, the sector, rates, the dollar and oil; a move is split into
     the part those explain and the part they don't (company- or coin-specific news).
   - Day trading: VWAP, opening range, floor pivots, ATR, gap statistics, relative volume, position sizing, and the
     New York session clock with the NYSE holiday calendar. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const C = MD.core;
  const closeOf = (p) => p.close ?? p.value;
  const r1 = (x) => x == null || !isFinite(x) ? null : Math.round(x * 10) / 10;

  /* ---------- base rates and the direction model ---------- */
  function rsiSeries(v, n = 14) {
    const out = new Array(v.length).fill(null); if (v.length <= n) return out;
    let g = 0, l = 0;
    for (let i = 1; i <= n; i++) { const d = v[i] - v[i - 1]; if (d > 0) g += d; else l -= d; }
    g /= n; l /= n; out[n] = l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l);
    for (let i = n + 1; i < v.length; i++) { const d = v[i] - v[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; out[i] = l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l); }
    return out;
  }
  // The state of the series on each bar: RSI bucket, trend against the 50/200 averages, the last 20 bars' move in
  // units of its own recent volatility, and distance from the trailing 1-year high.
  function states(v, ppy) {
    const rs = rsiSeries(v), s50 = C.sma(v, 50), s200 = C.sma(v, 200), yr = Math.round(ppy);
    const lr = v.map((x, i) => i ? Math.log(x / v[i - 1]) : 0);
    return v.map((x, i) => {
      const st = {};
      if (rs[i] != null) st.rsi = rs[i] < 30 ? "oversold" : rs[i] > 70 ? "overbought" : rs[i] < 45 ? "weak" : rs[i] > 55 ? "strong" : "neutral";
      if (s200[i] != null) st.trend = x > s50[i] && s50[i] > s200[i] ? "up" : x < s50[i] && s50[i] < s200[i] ? "down" : "mixed";
      if (i >= 80) {
        const w = lr.slice(i - 79, i - 19), m = w.reduce((a, b) => a + b, 0) / w.length, sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / (w.length - 1));
        const z = sd > 0 ? Math.log(x / v[i - 20]) / (sd * Math.sqrt(20)) : 0;
        st.move20 = z < -1.5 ? "sharp drop" : z > 1.5 ? "sharp rise" : z < -0.5 ? "drifting down" : z > 0.5 ? "drifting up" : "flat"; st.z20 = z;
      }
      if (i >= yr) { let hi = -Infinity; for (let k = i - yr + 1; k <= i; k++) hi = Math.max(hi, v[k]); const fh = (x / hi - 1) * 100; st.high = fh > -3 ? "at the high" : fh > -10 ? "near the high" : fh > -25 ? "off the high" : "far below the high"; }
      return st;
    });
  }
  function summarize(rets, flatPct = 0) {
    const n = rets.length; if (!n) return { n: 0 };
    const up = rets.filter(r => r > flatPct / 100).length, down = rets.filter(r => r < -flatPct / 100).length;
    const s = rets.slice().sort((a, b) => a - b), ups = rets.filter(r => r > 0), dns = rets.filter(r => r < 0);
    return { n, upPct: up / n * 100, downPct: down / n * 100, medianPct: C.percentile(s, 0.5) * 100, meanPct: C.mean(rets) * 100, p10Pct: C.percentile(s, 0.1) * 100, p90Pct: C.percentile(s, 0.9) * 100,
      avgUpPct: ups.length ? C.mean(ups) * 100 : null, avgDownPct: dns.length ? C.mean(dns) * 100 : null };
  }
  const LABEL = { rsi: (s) => "RSI(14) " + s, trend: (s) => "trend " + s + " (50/200-day averages)", move20: (s) => "last 20 bars: " + s, high: (s) => "price " + s };
  /* How often the price was higher after `bars` bars, overall and whenever each of today's conditions held before.
     Windows overlap, so `independent` (≈ n / bars) is the honest sample size used for shrinkage. */
  function baseRates(points, bars, opts = {}) {
    const v = points.map(closeOf).filter(x => x > 0), ppy = opts.ppy || 252, h = Math.max(1, Math.round(bars));
    if (v.length < h + 60) return null;
    const S = states(v, ppy), fwd = (i) => v[i + h] / v[i] - 1, last = S[v.length - 1];
    const idx = []; for (let i = 0; i + h < v.length; i++) idx.push(i);
    const indep = (n) => Math.max(1, Math.round(n / h));
    const all = summarize(idx.map(fwd));
    const conditions = Object.keys(LABEL).filter(k => last[k]).map(k => {
      const sel = idx.filter(i => S[i][k] === last[k]), sm = summarize(sel.map(fwd));
      return Object.assign({ key: k, state: last[k], label: LABEL[k](last[k]), independent: indep(sm.n) }, sm);
    }).filter(c => c.n >= 5);
    return { bars: h, from: points[0].time, to: points[points.length - 1].time, overall: Object.assign({ independent: indep(all.n) }, all), conditions, now: { rsi: last.rsi, trend: last.trend, move20: last.move20, z20: last.z20 != null ? r1(last.z20) : null, high: last.high } };
  }
  /* P(up) from base rates: the overall rate shrunk toward 50% by its independent sample size, then nudged by each
     condition's difference from the overall rate, again shrunk. Capped so history alone never claims certainty. */
  function directionModel(br, k = 12) {
    if (!br) return null;
    const o = br.overall, w0 = o.independent / (o.independent + k), base = 50 + (o.upPct - 50) * w0;
    const parts = [{ label: "Overall history (" + o.n + " windows, ≈" + o.independent + " independent)", upPct: o.upPct, effect: base - 50 }];
    let adj = 0;
    for (const c of br.conditions) { const w = c.independent / (c.independent + k * 1.5), e = (c.upPct - o.upPct) * w; adj += e; parts.push({ label: c.label + " (" + c.n + " windows, ≈" + c.independent + " independent)", upPct: c.upPct, effect: e }); }
    adj = Math.max(-15, Math.min(15, adj));
    const up = Math.max(25, Math.min(75, base + adj));
    return { upPct: r1(up), downPct: r1(100 - up), parts: parts.map(p => ({ label: p.label, upPct: r1(p.upPct), effect: r1(p.effect) })), avgUpPct: r1(o.avgUpPct), avgDownPct: r1(o.avgDownPct), medianPct: r1(o.medianPct) };
  }
  // Calendar days → bars for a series with ppy bars a year (stocks ≈ 252, crypto 365).
  const barsFor = (days, ppy) => Math.max(1, Math.round(days * (ppy || 252) / 365));
  // Chance the price finishes more than x% away from today (either direction) from lognormal volatility.
  function bigMoveChance(volPct, days, x) { const s = (volPct / 100) * Math.sqrt(days / 365); if (!(s > 0)) return null; const up = 1 - C.normCdf(Math.log(1 + x / 100) / s), dn = C.normCdf(Math.log(1 - Math.min(99, x) / 100) / s); return { upPct: up * 100, downPct: dn * 100, eitherPct: (up + dn) * 100 }; }

  /* ---------- factor model and move attribution ---------- */
  // Least squares with an intercept: y = a + Σ b_j x_j. Solved from the normal equations by Gaussian elimination.
  function ols(y, X) {
    const n = y.length, k = X.length + 1; if (n < k + 5) return null;
    const row = (i) => [1].concat(X.map(c => c[i]));
    const A = Array.from({ length: k }, () => new Array(k).fill(0)), b = new Array(k).fill(0);
    for (let i = 0; i < n; i++) { const r = row(i); for (let p = 0; p < k; p++) { b[p] += r[p] * y[i]; for (let q = 0; q < k; q++) A[p][q] += r[p] * r[q]; } }
    for (let c = 0; c < k; c++) {
      let piv = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      if (Math.abs(A[piv][c]) < 1e-14) return null;
      [A[c], A[piv]] = [A[piv], A[c]]; [b[c], b[piv]] = [b[piv], b[c]];
      for (let r = 0; r < k; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let q = c; q < k; q++) A[r][q] -= f * A[c][q]; b[r] -= f * b[c]; }
    }
    const coef = b.map((x, i) => x / A[i][i]);
    const my = C.mean(y); let ss = 0, sr = 0;
    for (let i = 0; i < n; i++) { const r = row(i), fit = r.reduce((s, x, j) => s + x * coef[j], 0); ss += (y[i] - my) ** 2; sr += (y[i] - fit) ** 2; }
    return { alpha: coef[0], betas: coef.slice(1), r2: ss > 0 ? 1 - sr / ss : 0, residStd: Math.sqrt(sr / Math.max(1, n - k)), n };
  }
  const dayKey = (p) => Math.floor(p.time / 86400);
  // Daily simple returns keyed by calendar day.
  function dailyReturns(points) { const m = new Map(); for (let i = 1; i < points.length; i++) { const a = closeOf(points[i - 1]), b = closeOf(points[i]); if (a > 0 && b > 0) m.set(dayKey(points[i]), b / a - 1); } return m; }
  /* Regress an asset's daily returns on factor returns over the last `lookback` common days. A sector factor is
     entered relative to the market so the two don't fight over the same variance. */
  function factorModel(asset, factors, opts = {}) {
    const lookback = opts.lookback || 250, names = Object.keys(factors).filter(n => factors[n] && factors[n].length > 30);
    const ra = dailyReturns(asset), rf = Object.fromEntries(names.map(n => [n, dailyReturns(factors[n])]));
    const mkt = opts.market && rf[opts.market] ? opts.market : null;
    let days = [...ra.keys()].filter(d => names.every(n => rf[n].has(d))).sort((a, b) => a - b).slice(-lookback);
    if (days.length < 40) return null;
    const val = (n, d) => mkt && n !== mkt && opts.relative && opts.relative.includes(n) ? rf[n].get(d) - rf[mkt].get(d) : rf[n].get(d);
    const fit = ols(days.map(d => ra.get(d)), names.map(n => days.map(d => val(n, d))));
    if (!fit) return null;
    return { names, betas: Object.fromEntries(names.map((n, i) => [n, fit.betas[i]])), alphaDailyPct: fit.alpha * 100, r2: fit.r2, residVolPct: fit.residStd * Math.sqrt(opts.ppy || 252) * 100, n: fit.n, market: mkt, relative: opts.relative || [], from: days[0] * 86400, to: days[days.length - 1] * 86400 };
  }
  /* Split a move into what the factors explain and the rest. factorMoves are the factors' own % moves over the same
     period; relative factors are converted to their move against the market first. */
  function attribute(model, factorMoves, assetMovePct) {
    if (!model) return null;
    const parts = model.names.filter(n => factorMoves[n] != null).map(n => {
      const mv = model.market && n !== model.market && model.relative.includes(n) ? factorMoves[n] - (factorMoves[model.market] || 0) : factorMoves[n];
      return { factor: n, factorMovePct: r1(mv), beta: Math.round(model.betas[n] * 100) / 100, contributionPct: model.betas[n] * mv };
    });
    const explained = parts.reduce((s, p) => s + p.contributionPct, 0);
    return { movePct: r1(assetMovePct), explainedPct: r1(explained), unexplainedPct: r1(assetMovePct - explained), parts: parts.map(p => Object.assign(p, { contributionPct: r1(p.contributionPct) })).sort((a, b) => Math.abs(b.contributionPct) - Math.abs(a.contributionPct)), r2: Math.round(model.r2 * 100) / 100 };
  }
  // % change of a daily series over its last `n` bars (n = 1 → the last day).
  function lastMove(points, n = 1) { if (points.length <= n) return null; const a = closeOf(points[points.length - 1 - n]), b = closeOf(points[points.length - 1]); return a > 0 ? (b / a - 1) * 100 : null; }
  // Rolling correlation of daily returns of two series over their last `n` common days.
  function recentCorrelation(a, b, n = 60) {
    const ra = dailyReturns(a), rb = dailyReturns(b), d = [...ra.keys()].filter(k => rb.has(k)).sort((x, y) => x - y).slice(-n);
    if (d.length < 20) return null; const x = d.map(k => ra.get(k)), y = d.map(k => rb.get(k)), mx = C.mean(x), my = C.mean(y);
    let c = 0, vx = 0, vy = 0; for (let i = 0; i < d.length; i++) { c += (x[i] - mx) * (y[i] - my); vx += (x[i] - mx) ** 2; vy += (y[i] - my) ** 2; }
    return vx > 0 && vy > 0 ? c / Math.sqrt(vx * vy) : null;
  }

  /* ---------- decision maths ---------- */
  /* Expected value of a position from the chance it rises and the typical sizes of the up and down moves, the payoff
     ratio, the Kelly fraction (the bet size that maximizes long-run growth if the odds are right) and a ceiling of a
     quarter of Kelly capped by the investor's maximum position: odds are estimates, so full Kelly is far too much. */
  function decisionMath({ upPct, upMovePct, downMovePct, capPct = 10 }) {
    const p = Math.max(0, Math.min(100, Number(upPct))) / 100, up = Math.abs(Number(upMovePct)), dn = Math.abs(Number(downMovePct));
    if (!(up > 0) || !(dn > 0)) return null;
    const ev = p * up - (1 - p) * dn, b = up / dn, kelly = Math.max(0, (p * b - (1 - p)) / b) * 100;
    return { evPct: Math.round(ev * 100) / 100, payoff: Math.round(b * 100) / 100, kellyPct: Math.round(kelly * 10) / 10, ceilingPct: Math.round(Math.min(capPct, kelly / 4) * 10) / 10, breakEvenUpPct: Math.round(dn / (up + dn) * 1000) / 10 };
  }

  /* ---------- calibration from the record ---------- */
  /* Correct a stated probability (for the favoured side, 0.5–1) with the record of past calls: the hit rate of calls
     stated near it (Gaussian-weighted by distance), shrunk toward the stated value by k pseudo-calls so a short record
     moves it only a little. items: [{p, hit}]. */
  function calibrateFrom(items, p, k = 15, bw = 0.08) {
    let w = 0, hw = 0;
    for (const it of items) { const d = (it.p - p) / bw, wi = Math.exp(-d * d); w += wi; hw += wi * (it.hit ? 1 : 0); }
    if (w < 1e-6) return { p, applied: false, n: 0 };
    const obs = hw / w;
    return { p: (w * obs + k * p) / (w + k), applied: true, n: Math.round(w * 10) / 10, observed: obs };
  }

  /* Learned blend weights: how much to trust Claude's probability vs the measured history, from each one's Brier score
     on graded calls (inverse-Brier weighting), shrunk toward the prior weight by k pseudo-calls and kept within 20–90%.
     items: [{claude, model (0–100), up (did it finish higher)}]. */
  function blendWeights(items, prior = 0.65, k = 20) {
    const xs = items.filter(x => x.claude != null && x.model != null);
    if (!xs.length) return { wClaude: prior, n: 0 };
    const brier = (key) => xs.reduce((s, x) => s + Math.pow(x[key] / 100 - (x.up ? 1 : 0), 2), 0) / xs.length;
    const bC = brier("claude"), bM = brier("model"), data = (1 / Math.max(bC, 1e-4)) / (1 / Math.max(bC, 1e-4) + 1 / Math.max(bM, 1e-4)), n = xs.length;
    return { wClaude: Math.max(0.2, Math.min(0.9, (n * data + k * prior) / (n + k))), n, brierClaude: bC, brierModel: bM };
  }

  /* ---------- testable cause → effect rules ---------- */
  /* A rule over daily % moves: {cause: {symbol, op: "<"|">", pct}, effect: {symbol, vs?, op, pct}, lagDays: 0|1}.
     "When TLT falls more than 1%, XLK trails SPY the same day" =
     {cause: {symbol: "TLT", op: "<", pct: -1}, effect: {symbol: "XLK", vs: "SPY", op: "<", pct: 0}, lagDays: 0}. */
  const opHolds = (op, x, pct) => op === "<" ? x < pct : x > pct;
  function cleanRule(r) {
    if (!r || !r.cause || !r.effect) return null;
    const sym = (s) => String(s || "").toUpperCase().replace(/[^A-Z.\-]/g, "").slice(0, 8), op = (o) => o === "<" || o === ">" ? o : null, num = (x) => isFinite(Number(x)) ? Math.max(-50, Math.min(50, Number(x))) : null;
    const c = { symbol: sym(r.cause.symbol), op: op(r.cause.op), pct: num(r.cause.pct) }, e = { symbol: sym(r.effect.symbol), vs: r.effect.vs ? sym(r.effect.vs) : null, op: op(r.effect.op), pct: num(r.effect.pct) ?? 0 };
    if (!c.symbol || !c.op || c.pct == null || !e.symbol || !e.op || (e.vs && e.vs === e.symbol)) return null;
    return { cause: c, effect: e, lagDays: Number(r.lagDays) === 1 ? 1 : 0 };
  }
  function ruleText(r) {
    if (!r) return "";
    const c = r.cause, e = r.effect, sign = (x) => (x > 0 ? "+" : "") + x + "%";
    return c.symbol + " " + (c.op === "<" ? "below " : "above ") + sign(c.pct) + " → " + e.symbol + (e.vs ? " minus " + e.vs : "") + " " + (e.op === "<" ? "below " : "above ") + sign(e.pct) + (r.lagDays ? " the next day" : " the same day");
  }
  /* On the days the cause held, how often the effect followed, against how often the effect happens on any day.
     `series` maps symbols to daily points. z is the binomial z-score of the difference. */
  function backtestRule(rule, series) {
    const R = {}; for (const [s, pts] of Object.entries(series)) if (pts && pts.length > 2) R[s] = dailyReturns(pts);
    const c = rule.cause, e = rule.effect, lag = rule.lagDays ? 1 : 0, need = [c.symbol, e.symbol].concat(e.vs ? [e.vs] : []);
    const missing = need.filter(s => !R[s]); if (missing.length) return { error: "No history for " + missing.join(", ") };
    const days = [...R[c.symbol].keys()].filter(d => need.every(s => R[s].has(d))).sort((a, b) => a - b);
    let occ = 0, held = 0, all = 0, allHeld = 0; const recent = [];
    for (let i = 0; i + lag < days.length; i++) {
      const d2 = days[i + lag], ev = (R[e.symbol].get(d2) - (e.vs ? R[e.vs].get(d2) : 0)) * 100, okE = opHolds(e.op, ev, e.pct);
      all++; if (okE) allHeld++;
      const cv = R[c.symbol].get(days[i]) * 100;
      if (opHolds(c.op, cv, c.pct)) { occ++; if (okE) held++; recent.push({ date: new Date(days[i] * 864e5).toISOString().slice(0, 10), causePct: r1(cv), effectPct: r1(ev), held: okE }); }
    }
    const base = all ? allHeld / all : null, rate = occ ? held / occ : null;
    const z = occ && base > 0 && base < 1 ? (rate - base) / Math.sqrt(base * (1 - base) / occ) : null;
    return { occurrences: occ, held, heldPct: rate == null ? null : r1(rate * 100), baselinePct: base == null ? null : r1(base * 100), liftPts: rate == null || base == null ? null : r1((rate - base) * 100), z: z == null ? null : Math.round(z * 10) / 10, days: all,
      from: days.length ? new Date(days[0] * 864e5).toISOString().slice(0, 10) : null, to: days.length ? new Date(days[days.length - 1] * 864e5).toISOString().slice(0, 10) : null, recent: recent.slice(-6) };
  }
  // Whether a same-day rule's cause happened in today's moves ({symbol: % change}), and if so whether the effect followed.
  function ruleToday(rule, moves) {
    if (!rule || rule.lagDays) return null;
    const c = rule.cause, e = rule.effect;
    if ([c.symbol, e.symbol, e.vs].filter(Boolean).some(s => moves[s] == null)) return null;
    if (!opHolds(c.op, moves[c.symbol], c.pct)) return { causeHappened: false };
    const ev = moves[e.symbol] - (e.vs ? moves[e.vs] : 0);
    return { causeHappened: true, effectFollowed: opHolds(e.op, ev, e.pct), causePct: r1(moves[c.symbol]), effectPct: r1(ev) };
  }
  // How convincing a backtest is, in words.
  function backtestVerdict(b) {
    if (!b || b.error) return b && b.error ? b.error : "Not tested";
    if (b.occurrences < 8) return "Too few cases to judge (" + b.occurrences + ")";
    if (b.z >= 2) return "Strong: well above chance";
    if (b.z >= 1) return "Some evidence";
    if (b.z <= -1) return "Against it: the effect is rarer than usual";
    return "No better than chance";
  }

  /* ---------- day trading ---------- */
  // Session VWAP with ±1σ bands from bars {time, high, low, close, volume}.
  function vwap(bars) {
    let pv = 0, vv = 0, pv2 = 0; const out = [];
    for (const b of bars) { const tp = ((b.high ?? b.close) + (b.low ?? b.close) + b.close) / 3, vol = Number(b.volume) || 0; pv += tp * vol; vv += vol; pv2 += tp * tp * vol; if (vv > 0) { const w = pv / vv, sd = Math.sqrt(Math.max(0, pv2 / vv - w * w)); out.push({ time: b.time, value: w, upper: w + sd, lower: w - sd }); } }
    return out.length ? { series: out, last: out[out.length - 1].value, upper: out[out.length - 1].upper, lower: out[out.length - 1].lower, volume: vv } : null;
  }
  // High and low of the first `minutes` after the open (openSec = the open's timestamp).
  function openingRange(bars, openSec, minutes = 15) { const w = bars.filter(b => b.time >= openSec && b.time < openSec + minutes * 60); if (!w.length) return null; return { high: Math.max(...w.map(b => b.high ?? b.close ?? b.value)), low: Math.min(...w.map(b => b.low ?? b.close ?? b.value)), minutes, complete: bars.some(b => b.time >= openSec + minutes * 60) }; }
  // Classic floor-trader pivots from the prior session's high, low and close.
  function pivots({ high, low, close }) { if (!(high > 0 && low > 0 && close > 0)) return null; const P = (high + low + close) / 3; return { P, R1: 2 * P - low, S1: 2 * P - high, R2: P + (high - low), S2: P - (high - low), R3: high + 2 * (P - low), S3: low - 2 * (high - P) }; }
  // Wilder's average true range from daily OHLC.
  function atr(points, n = 14) {
    if (points.length <= n) return null; const tr = [];
    for (let i = 1; i < points.length; i++) { const p = points[i], c0 = closeOf(points[i - 1]), hi = p.high ?? closeOf(p), lo = p.low ?? closeOf(p); tr.push(Math.max(hi - lo, Math.abs(hi - c0), Math.abs(lo - c0))); }
    let a = tr.slice(0, n).reduce((s, x) => s + x, 0) / n; for (let i = n; i < tr.length; i++) a = (a * (n - 1) + tr[i]) / n;
    const last = closeOf(points[points.length - 1]); return { atr: a, atrPct: last > 0 ? a / last * 100 : null };
  }
  /* How past gaps like today's played out the same day: how often the gap filled (traded back to the prior close),
     and how often the close finished above the open. Daily OHLC; gaps at least `minPct` in the same direction. */
  function gapStats(points, gapPct, minPct) {
    const thr = Math.max(0.3, minPct ?? Math.abs(gapPct) * 0.6), dir = Math.sign(gapPct); if (!dir) return null;
    const rows = [];
    for (let i = 1; i < points.length; i++) { const p = points[i], pc = closeOf(points[i - 1]); if (!(p.open > 0) || !(pc > 0)) continue; const g = (p.open / pc - 1) * 100; if (Math.sign(g) !== dir || Math.abs(g) < thr) continue; rows.push({ filled: dir > 0 ? p.low <= pc : p.high >= pc, upClose: p.close > p.open, oc: (p.close / p.open - 1) * 100 }); }
    if (!rows.length) return { n: 0, thresholdPct: thr };
    return { n: rows.length, thresholdPct: r1(thr), fillPct: r1(rows.filter(r => r.filled).length / rows.length * 100), closeAboveOpenPct: r1(rows.filter(r => r.upClose).length / rows.length * 100), avgOpenToClosePct: Math.round(C.mean(rows.map(r => r.oc)) * 100) / 100 };
  }
  /* Relative volume: today's volume against the average day's volume by this point of the session. Intraday volume
     is U-shaped (heavy at the open and close), so the expected share by time is a fitted curve, not a straight line. */
  // Cumulative share of a typical day's volume by fraction f of the session: ~12% in the first 20 minutes, ~22% in
  // the last 40 (including the closing auction), the rest spread evenly.
  function sessionVolumeShare(frac) { const f = Math.max(0, Math.min(1, frac)); return Math.max(0.02, f <= 0.05 ? 0.12 * f / 0.05 : f <= 0.9 ? 0.12 + 0.66 * (f - 0.05) / 0.85 : 0.78 + 0.22 * (f - 0.9) / 0.1); }
  function rvol(volumeToday, avgVolume, sessionFraction) { if (!(volumeToday > 0) || !(avgVolume > 0)) return null; return volumeToday / (avgVolume * sessionVolumeShare(sessionFraction ?? 1)); }
  /* Shares to trade so a stop-out loses `riskPct` of the account, capped by a maximum position size. */
  function positionSize({ account, riskPct, entry, stop, target, side = "long", maxPositionPct = 100 }) {
    const a = Number(account), e = Number(entry), s = Number(stop), t = Number(target), rp = Number(riskPct);
    if (!(a > 0) || !(e > 0) || !(s > 0) || !(rp > 0) || e === s) return null;
    if ((side === "long" && s >= e) || (side === "short" && s <= e)) return { error: side === "long" ? "For a long trade the stop must be below the entry." : "For a short trade the stop must be above the entry." };
    const perShare = Math.abs(e - s), budget = a * rp / 100, byRisk = Math.floor(budget / perShare), byCap = Math.floor(a * Number(maxPositionPct) / 100 / e);
    const shares = Math.max(0, Math.min(byRisk, byCap)), dir = side === "long" ? 1 : -1;
    const out = { shares, perShareRisk: perShare, dollarsAtRisk: shares * perShare, positionValue: shares * e, positionPct: shares * e / a * 100, cappedBySize: byCap < byRisk, targets: [1, 2, 3].map(r => ({ r, price: e + dir * r * perShare })) };
    if (t > 0) { out.rewardRisk = Math.abs(t - e) / perShare; out.dollarsAtTarget = shares * Math.abs(t - e); out.targetOnWrongSide = (t - e) * dir <= 0; }
    return out;
  }
  /* Chance a trade reaches its target before its stop by the end of the session, from a driftless random walk in
     1-minute steps with the asset's daily volatility (log scale). A baseline, not a forecast: it knows nothing about
     trend or news, so it shows what the setup's geometry alone implies. */
  function barrierOdds({ entry, stop, target, side = "long", dailyVolPct, minutesLeft, paths = 2000, seed = 7 }) {
    const e = Number(entry), s = Number(stop), t = Number(target), v = Number(dailyVolPct) / 100, n = Math.max(1, Math.min(1440, Math.round(Number(minutesLeft) || 0)));
    if (!(e > 0 && s > 0 && t > 0 && v > 0)) return null;
    const dir = side === "short" ? -1 : 1;
    if ((t - e) * dir <= 0 || (e - s) * dir <= 0) return null;
    const up = Math.log(t / e) * dir, dn = Math.log(s / e) * dir, sd = v / Math.sqrt(390), r = C.rng(seed);
    let hitT = 0, hitS = 0;
    for (let i = 0; i < paths; i++) { let x = 0; for (let k = 0; k < n; k++) { x += sd * C.gauss(r); if (x >= up) { hitT++; break; } if (x <= dn) { hitS++; break; } } }
    return { pTarget: hitT / paths, pStop: hitS / paths, pNeither: (paths - hitT - hitS) / paths, minutes: n, rr: Math.abs(t - e) / Math.abs(e - s) };
  }
  /* Where an open up/down call stands: the move since it was made, that move in daily-volatility units for the bars
     elapsed (positive = in the call's favour), and the chance it finishes beyond its flat band on the called side,
     from a driftless walk over the bars left. Geometry only: it knows nothing about the reasons behind the call. */
  /* Learned weights for the members of a forecasting team from graded rows {member: upPct, …, up: bool}: a member
     with `minN`+ graded estimates gets 0.25 / its Brier score (a coin flip = 1), kept within 0.5–2; others weigh 1. */
  function memberWeights(rows, members, minN = 20) {
    const weights = {}, stats = {};
    for (const k of members) {
      const xs = rows.filter(r => r[k] != null && isFinite(r[k]) && r.up != null);
      const brier = xs.length ? xs.reduce((a, r) => a + (r[k] / 100 - (r.up ? 1 : 0)) ** 2, 0) / xs.length : null;
      const hit = xs.length ? xs.filter(r => (r[k] > 50) === !!r.up && r[k] !== 50).length / xs.length * 100 : null;
      stats[k] = { n: xs.length, brier, hitPct: hit };
      weights[k] = xs.length >= minN && brier > 0 ? Math.max(0.5, Math.min(2, 0.25 / brier)) : 1;
    }
    return { weights, stats, learned: members.some(k => stats[k].n >= minN) };
  }
  /* Portfolio health (0–100) from measured numbers against the investor's risk setting: diversification (effective
     number of holdings, 8+ = full marks), the largest position against the single-position band, volatility and the
     past year's worst drop against the risk band, and how independently the holdings move (average correlation). */
  const HEALTH_BANDS = { low: { cap: 10, vol: 10, dd: 12 }, mid: { cap: 20, vol: 18, dd: 22 }, high: { cap: 30, vol: 28, dd: 35 } };
  function healthScore({ effective, topWeightPct, volPct, maxDrawdownPct, avgCorr, risk }) {
    const b = HEALTH_BANDS[risk] || HEALTH_BANDS.mid, cl = (x) => Math.max(0, Math.min(100, Math.round(x))), parts = [];
    if (effective > 0) parts.push({ key: "diversification", value: cl(effective / 8 * 100), band: "8+ equal-sized holdings" });
    if (topWeightPct != null) parts.push({ key: "concentration", value: topWeightPct <= b.cap ? 100 : cl(100 * (1 - (topWeightPct - b.cap) / (2 * b.cap))), band: "largest position ≤ " + b.cap + "%" });
    if (volPct != null && isFinite(volPct)) parts.push({ key: "volatility", value: volPct <= b.vol ? 100 : cl(100 * (1 - (volPct - b.vol) / b.vol)), band: "≤ " + b.vol + "% a year" });
    if (maxDrawdownPct != null && isFinite(maxDrawdownPct)) { const dd = Math.abs(maxDrawdownPct); parts.push({ key: "drawdown", value: dd <= b.dd ? 100 : cl(100 * (1 - (dd - b.dd) / b.dd)), band: "worst drop ≤ " + b.dd + "%" }); }
    if (avgCorr != null && isFinite(avgCorr)) parts.push({ key: "independence", value: cl(100 * (1 - Math.max(0, avgCorr))), band: "low average correlation" });
    return { score: parts.length ? Math.round(parts.reduce((a, p) => a + p.value, 0) / parts.length) : null, parts };
  }
  /* Desk consensus on one asset: the latest open call from each source (up/down with a probability), grouped by horizon
     (days ≤14, months 15–120, a year >120), averaged with each source's weight (from its graded record). Returns per
     horizon the consensus chance of a rise, how much of the weight agrees with it, and the spread between sources. */
  function deskConsensus(calls, weightOf) {
    const B = [["days", "Next two weeks", 0, 14], ["months", "1–4 months", 15, 120], ["year", "4–12 months", 121, 10000]], out = [];
    for (const [key, label, lo, hi] of B) {
      const latest = new Map();
      for (const c of calls) if (c.horizonDays >= lo && c.horizonDays <= hi && c.upPct != null && (!latest.has(c.source) || (latest.get(c.source).at || 0) < (c.at || 0))) latest.set(c.source, c);
      const cs = [...latest.values()]; if (!cs.length) continue;
      const ws = cs.map(c => Math.max(0.25, Number(weightOf ? weightOf(c.source) : 1) || 1)), W = ws.reduce((a, x) => a + x, 0);
      const up = cs.reduce((a, c, i) => a + c.upPct * ws[i], 0) / W, side = up >= 50;
      const agree = cs.reduce((a, c, i) => a + ((c.upPct >= 50) === side ? ws[i] : 0), 0) / W * 100;
      out.push({ key, label, upPct: up, n: cs.length, agreePct: agree, spread: Math.max(...cs.map(c => c.upPct)) - Math.min(...cs.map(c => c.upPct)), calls: cs.map((c, i) => Object.assign({}, c, { weight: ws[i] })) });
    }
    return out;
  }
  /* Long-only portfolio weights from an annualised covariance matrix. minVarWeights: the mix with the least variance,
     no weight above `cap` (projected gradient onto the capped simplex). ercWeights: equal risk contribution, every
     holding adds the same share of the portfolio's variance (cyclical coordinate descent). riskShares: each one's share. */
  function capSimplex(v, cap) {
    let lo = Math.min(...v) - cap - 1, hi = Math.max(...v);
    for (let k = 0; k < 100; k++) { const t = (lo + hi) / 2, s = v.reduce((a, x) => a + Math.max(0, Math.min(cap, x - t)), 0); if (s > 1) lo = t; else hi = t; }
    const t = (lo + hi) / 2; return v.map(x => Math.max(0, Math.min(cap, x - t)));
  }
  function minVarWeights(cov, cap = 1, iters = 4000) {
    const n = cov.length; if (!n) return [];
    cap = Math.max(1 / n, Math.min(1, cap));
    const L = 2 * Math.max(...cov.map(r => r.reduce((a, x) => a + Math.abs(x), 0))) || 1;
    let w = Array(n).fill(1 / n);
    for (let k = 0; k < iters; k++) {
      const g = cov.map(r => 2 * r.reduce((a, x, j) => a + x * w[j], 0));
      const nw = capSimplex(w.map((x, i) => x - g[i] / L), cap);
      const d = nw.reduce((a, x, i) => a + Math.abs(x - w[i]), 0); w = nw; if (d < 1e-12) break;
    }
    return w;
  }
  function ercWeights(cov, iters = 500) {
    const n = cov.length; if (!n) return [];
    let y = cov.map((r, i) => 1 / Math.sqrt(Math.max(r[i], 1e-12)));
    for (let k = 0; k < iters; k++) {
      let move = 0;
      for (let i = 0; i < n; i++) { const c = cov[i].reduce((a, x, j) => a + (j === i ? 0 : x * y[j]), 0), s = Math.max(cov[i][i], 1e-12), ni = (-c + Math.sqrt(c * c + 4 * s / n)) / (2 * s); move += Math.abs(ni - y[i]); y[i] = ni; }
      if (move < 1e-12) break;
    }
    const t = y.reduce((a, x) => a + x, 0); return y.map(x => x / t);
  }
  function riskShares(cov, w) {
    const m = cov.map(r => r.reduce((a, x, j) => a + x * w[j], 0)), v = w.reduce((a, x, i) => a + x * m[i], 0);
    return w.map((x, i) => v > 0 ? x * m[i] / v : 0);
  }
  /* News sentiment score (−100…100) from classified headlines {s: −2…2, mat: 1…3, ts}, weighted by materiality and
     recency (half-life three days). label: positive/negative at ±25, mixed when material good and bad news meet. */
  function newsScore(items, now = Date.now()) {
    let w = 0, s = 0;
    for (const x of items) { const age = x.ts ? Math.max(0, (now - x.ts) / 864e5) : 3, wt = Math.max(1, Math.min(3, x.mat || 1)) * Math.pow(0.5, age / 3); w += wt; s += wt * Math.max(-2, Math.min(2, Number(x.s) || 0)) / 2; }
    if (!(w > 0)) return { score: null, label: "none" };
    const score = Math.round(s / w * 100), good = items.some(x => x.s >= 1 && x.mat >= 2), bad = items.some(x => x.s <= -1 && x.mat >= 2);
    return { score, label: score >= 25 ? "positive" : score <= -25 ? "negative" : good && bad ? "mixed" : "neutral" };
  }
  function callStanding({ direction, p0, price, bandPct = 1, dailyVolPct, barsElapsed, barsLeft }) {
    const a = Number(p0), b = Number(price), v = Number(dailyVolPct) / 100;
    if (!(a > 0 && b > 0 && v > 0) || (direction !== "up" && direction !== "down")) return null;
    const x = Math.log(b / a), dir = direction === "up" ? 1 : -1, band = Math.min(0.99, Math.max(0, Number(bandPct) || 0) / 100);
    const need = Math.log(1 + dir * band), zFor = barsElapsed > 0 ? dir * x / (v * Math.sqrt(barsElapsed)) : 0;
    let p;
    if (!(barsLeft > 0)) p = dir > 0 ? (x > need ? 1 : 0) : (x < need ? 1 : 0);
    else { const s = v * Math.sqrt(barsLeft); p = dir > 0 ? 1 - C.normCdf((need - x) / s) : C.normCdf((need - x) / s); }
    return { movePct: (b / a - 1) * 100, zFor, oddsNowPct: p * 100 };
  }
  /* Technical alerts. techState measures the live price against daily history (the live price replaces today's bar
     or extends the series): 50/200-day averages, RSI(14), and the prior 52-week high and low. evaluateTechAlert
     fires once per event: on a cross of an average (the first check only records the side), when RSI reaches its
     threshold (re-arming 3 points back), or on a new 52-week high or low (re-arming once price is back inside). */
  const TECH_ALERTS = { xma50: "Crosses its 50-day average", xma200: "Crosses its 200-day average", rsi_above: "RSI(14) at or above", rsi_below: "RSI(14) at or below", high52: "Makes a new 52-week high", low52: "Makes a new 52-week low" };
  function techState(points, price, nowSec) {
    const day = (t) => Math.floor(t / 86400), now = day(nowSec || Date.now() / 1000), p = Number(price);
    const past = (points || []).filter(x => (x.close ?? x.value) > 0 && day(x.time) < now).map(x => x.close ?? x.value);
    if (past.length < 30 || !(p > 0)) return null;
    const closes = past.concat([p]), avg = (n) => closes.length >= n ? closes.slice(-n).reduce((s, x) => s + x, 0) / n : null, prior = past.slice(-252);
    return { price: p, ma50: avg(50), ma200: avg(200), rsi14: C.rsi(closes, 14), high52: Math.max(...prior), low52: Math.min(...prior) };
  }
  function evaluateTechAlert(alert, ts, state) {
    const st = Object.assign({ armed: true }, state || {}), k = alert.kind, th = Number(alert.threshold);
    if (!ts) return { triggered: false, state: st };
    if (k === "xma50" || k === "xma200") {
      const ma = k === "xma50" ? ts.ma50 : ts.ma200; if (ma == null) return { triggered: false, state: st };
      const side = ts.price >= ma ? "above" : "below", crossed = st.side && st.side !== side;
      return { triggered: !!crossed, value: ma, detail: "crossed " + side + " its " + (k === "xma50" ? "50" : "200") + "-day average", state: Object.assign({}, st, { side }, crossed ? { lastTriggeredAt: Date.now() } : {}) };
    }
    let cond, back, value, detail;
    if (k === "rsi_above" || k === "rsi_below") { if (ts.rsi14 == null) return { triggered: false, state: st }; value = ts.rsi14; cond = k === "rsi_above" ? value >= th : value <= th; back = k === "rsi_above" ? value < th - 3 : value > th + 3; detail = "RSI(14) reached " + value.toFixed(0); }
    else if (k === "high52") { value = ts.high52; cond = ts.price > value; back = !cond; detail = "made a new 52-week high"; }
    else if (k === "low52") { value = ts.low52; cond = ts.price < value; back = !cond; detail = "made a new 52-week low"; }
    else return { triggered: false, state: st };
    if (cond && st.armed) return { triggered: true, value, detail, state: Object.assign({}, st, { armed: false, lastTriggeredAt: Date.now() }) };
    if (!st.armed && back) return { triggered: false, value, detail, state: Object.assign({}, st, { armed: true }) };
    return { triggered: false, value, detail, state: st };
  }
  function alertText(a) {
    if (TECH_ALERTS[a.kind]) return TECH_ALERTS[a.kind] + (a.kind.startsWith("rsi") ? " " + a.threshold : "");
    return ({ above: "≥ ", below: "≤ ", move: "daily move ≥ ±" }[a.kind] || a.kind + " ") + a.threshold + (a.kind === "move" ? "%" : "");
  }
  /* What buying would have done to the portfolio over the same days: `values` is the portfolio's value path (today's
     holdings held throughout) and `prices` the asset's closes on those days. Bought today for `amount` (paid from cash
     already in the portfolio, or new money), the position's path is its prices scaled to `amount` today. `existing` is
     the value already held in the asset. Measured history, not a forecast. */
  function tradePreview({ values, prices, amount, fromCash = false, existing = 0, ppy = 252 }) {
    const n = Math.min((values || []).length, (prices || []).length), A = Number(amount);
    if (n < 30 || !(A > 0)) return null;
    const V = values.slice(-n), P = prices.slice(-n), pT = P[n - 1], VT = V[n - 1];
    if (!(pT > 0) || !(VT > 0) || (fromCash && V.some(v => v - A <= 0))) return null;
    const V2 = V.map((v, k) => v - (fromCash ? A : 0) + A * P[k] / pT);
    const lr = (a) => a.slice(1).map((v, k) => Math.log(v / a[k])), rv = lr(V), rp = lr(P), r2 = lr(V2);
    const vol = (r) => C.stdev(r) * Math.sqrt(ppy) * 100;
    const dd = (a) => { let peak = a[0], m = 0; for (const v of a) { peak = Math.max(peak, v); m = Math.min(m, v / peak - 1); } return m * 100; };
    const mv = rv.reduce((s, x) => s + x, 0) / rv.length, mp = rp.reduce((s, x) => s + x, 0) / rp.length;
    let cvp = 0, vv = 0, vp = 0; for (let i = 0; i < rv.length; i++) { cvp += (rv[i] - mv) * (rp[i] - mp); vv += (rv[i] - mv) ** 2; vp += (rp[i] - mp) ** 2; }
    const total2 = VT + (fromCash ? 0 : A);
    return { volBefore: vol(rv), volAfter: vol(r2), assetVol: vol(rp), ddBefore: dd(V), ddAfter: dd(V2), corr: vv > 0 && vp > 0 ? cvp / Math.sqrt(vv * vp) : null,
      weightBefore: Number(existing) / VT * 100, weightAfter: (Number(existing) + A) / total2 * 100, ret1yBefore: (VT / V[0] - 1) * 100, ret1yAfter: (V2[n - 1] / V2[0] - 1) * 100, days: n };
  }
  /* Today's risk limits from the trade journal: P&L, trades and losing streak so far today, what is left before the
     daily loss limit and the trade cap (gains don't raise the limit), and whether the rules say to stop for the day. */
  function riskGuard({ trades, date, account, maxLossPct, maxTrades, maxLosingStreak }) {
    const st = tradeStats((trades || []).filter(t => t.date === date)), rows = (st.rows || []).slice().sort((a, b) => String(a.time || "").localeCompare(String(b.time || "")));
    const pnl = st.n ? st.net : 0, limit = Number(account) > 0 && Number(maxLossPct) > 0 ? Number(account) * Number(maxLossPct) / 100 : null;
    let streak = 0; for (let i = rows.length - 1; i >= 0 && rows[i].pnl < 0; i--) streak++;
    const lossLeft = limit == null ? null : Math.max(0, limit + Math.min(0, pnl)), tradesLeft = Number(maxTrades) > 0 ? Math.max(0, Number(maxTrades) - rows.length) : null;
    const reasons = [];
    if (limit != null && lossLeft <= 0) reasons.push("daily loss limit reached");
    if (tradesLeft === 0) reasons.push("trade cap reached");
    if (Number(maxLosingStreak) > 0 && streak >= Number(maxLosingStreak)) reasons.push(streak + " losses in a row");
    return { date, trades: rows.length, pnl, limit, lossLeft, tradesLeft, streak, stop: reasons.length > 0, reasons };
  }
  // Expectancy and other stats of logged day trades {side, entry, exit, shares, stop?, fees?}.
  function tradeStats(trades) {
    const rows = trades.filter(t => t.entry > 0 && t.exit > 0 && t.shares > 0).map(t => { const dir = t.side === "short" ? -1 : 1, pnl = dir * (t.exit - t.entry) * t.shares - (Number(t.fees) || 0), risk = t.stop > 0 ? Math.abs(t.entry - t.stop) * t.shares : null; return Object.assign({}, t, { pnl, r: risk ? pnl / risk : null }); });
    if (!rows.length) return { n: 0, rows };
    const wins = rows.filter(r => r.pnl > 0), losses = rows.filter(r => r.pnl < 0), gw = wins.reduce((s, r) => s + r.pnl, 0), gl = -losses.reduce((s, r) => s + r.pnl, 0), rs = rows.filter(r => r.r != null);
    return { n: rows.length, rows, net: gw - gl, winRatePct: wins.length / rows.length * 100, avgWin: wins.length ? gw / wins.length : 0, avgLoss: losses.length ? gl / losses.length : 0, profitFactor: gl > 0 ? gw / gl : null, expectancy: (gw - gl) / rows.length, avgR: rs.length ? C.mean(rs.map(r => r.r)) : null, largestLoss: losses.length ? Math.min(...losses.map(r => r.pnl)) : 0 };
  }

  /* Measured intraday setups from regular-session minute prices ({time, close}, oldest first), 5-minute bars with
     their VWAP, and the day's levels. Each signal says what happened and since when; none is a recommendation. */
  function intradaySignals(x) {
    const out = [], m = x.minute || [], last = x.last, add = (name, side, detail, at) => out.push({ name, side, detail, at: at || null });
    if (!(last > 0)) return out;
    const f2 = (v) => v == null ? "—" : (Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(4));
    const cross = (level, dir, from) => { let t = null; for (let i = Math.max(1, from || 1); i < m.length; i++) { const a = m[i - 1].close, b = m[i].close; if (dir > 0 ? a <= level && b > level : a >= level && b < level) t = m[i].time; } return t; };
    if (x.or15 && x.or15.complete) {
      const from = m.findIndex(p => p.time >= (x.openSec || 0) + 15 * 60);
      if (last > x.or15.high) add("Opening-range breakout", "long", "Above the 15-minute high " + f2(x.or15.high), cross(x.or15.high, 1, from));
      else if (last < x.or15.low) add("Opening-range breakdown", "short", "Below the 15-minute low " + f2(x.or15.low), cross(x.or15.low, -1, from));
      else add("Inside the opening range", "neutral", f2(x.or15.low) + " – " + f2(x.or15.high));
    }
    const b = x.bars || [], vw = x.vwapSeries || [];
    if (b.length >= 3 && vw.length === b.length) {
      const rel = b.map((bar, i) => bar.close - vw[i].value), n = rel.length;
      let lastCross = -1; for (let i = 1; i < n; i++) if (Math.sign(rel[i]) !== Math.sign(rel[i - 1]) && rel[i] !== 0) lastCross = i;
      if (lastCross >= n - 6 && lastCross > 0) add(rel[n - 1] > 0 ? "VWAP reclaim" : "VWAP rejection", rel[n - 1] > 0 ? "long" : "short", (rel[n - 1] > 0 ? "Crossed back above" : "Crossed back below") + " VWAP " + f2(vw[n - 1].value), b[lastCross].time);
      else if (n >= 12 && rel.slice(-12).every(r => r > 0)) add("Holding above VWAP", "long", "Every bar of the last hour closed above VWAP");
      else if (n >= 12 && rel.slice(-12).every(r => r < 0)) add("Below VWAP all hour", "short", "Every bar of the last hour closed below VWAP");
      if (x.vwapUpper && last > x.vwapUpper) add("Stretched above VWAP", "neutral", "Above the +1σ band " + f2(x.vwapUpper) + "; extended moves often pull back");
      else if (x.vwapLower && last < x.vwapLower) add("Stretched below VWAP", "neutral", "Below the −1σ band " + f2(x.vwapLower) + "; extended moves often bounce");
    }
    if (x.high && last >= x.high * 0.999) add("At the high of the day", "long", "Within 0.1% of " + f2(x.high));
    else if (x.low && last <= x.low * 1.001) add("At the low of the day", "short", "Within 0.1% of " + f2(x.low));
    if (x.priorHigh && last > x.priorHigh) add("Above the prior day's high", "long", f2(x.priorHigh), cross(x.priorHigh, 1));
    else if (x.priorLow && last < x.priorLow) add("Below the prior day's low", "short", f2(x.priorLow), cross(x.priorLow, -1));
    if (x.preHigh && m.length && last > x.preHigh) add("Above the pre-market high", "long", f2(x.preHigh), cross(x.preHigh, 1));
    else if (x.preLow && m.length && last < x.preLow) add("Below the pre-market low", "short", f2(x.preLow), cross(x.preLow, -1));
    if (x.gapPct != null && Math.abs(x.gapPct) >= 0.3 && x.prevClose) {
      const filled = x.gapPct > 0 ? x.low != null && x.low <= x.prevClose : x.high != null && x.high >= x.prevClose;
      if (filled) add("Gap filled", "neutral", "Traded back to the previous close " + f2(x.prevClose));
      else { const left = (last - x.prevClose) / (x.open - x.prevClose); if (x.open && left < 0.5 && left > 0) add("Gap filling", "neutral", Math.round((1 - left) * 100) + "% of the gap retraced"); else add(x.gapPct > 0 ? "Gap up holding" : "Gap down holding", x.gapPct > 0 ? "long" : "short", (x.gapPct > 0 ? "+" : "") + x.gapPct.toFixed(1) + "% gap not filled"); }
    }
    if (x.rvol != null && x.rvol >= 2) add("Heavy volume", "neutral", "Relative volume " + x.rvol.toFixed(1) + "×");
    else if (x.rvol != null && x.rvol < 0.6) add("Light volume", "neutral", "Relative volume " + x.rvol.toFixed(1) + "×; moves are less reliable");
    return out;
  }

  /* ---------- New York session clock ---------- */
  // NYSE full closures and 1 p.m. early closes (the exchange's published calendar).
  const HOLIDAYS = new Set(["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"]);
  const EARLY = new Set(["2026-11-27", "2026-12-24", "2027-11-26"]);
  function nyParts(date) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" }).formatToParts(date).map(x => [x.type, x.value]));
    return { ymd: p.year + "-" + p.month + "-" + p.day, mins: +p.hour * 60 + +p.minute + +p.second / 60, dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) };
  }
  const tradingDay = (ymd, dow) => dow > 0 && dow < 6 && !HOLIDAYS.has(ymd);
  /* Where the US stock market is right now: pre-market (4:00–9:30 ET), open, after-hours (to 20:00) or closed, the
     fraction of the regular session elapsed, and minutes to the next open or close. */
  function session(now = new Date()) {
    const t = nyParts(now), trading = tradingDay(t.ymd, t.dow), close = EARLY.has(t.ymd) ? 780 : 960;
    let phase = "closed";
    if (trading) phase = t.mins < 240 ? "closed" : t.mins < 570 ? "pre" : t.mins < close ? "open" : t.mins < 1200 ? "after" : "closed";
    const frac = phase === "open" ? (t.mins - 570) / (close - 570) : phase === "after" || (phase === "closed" && trading && t.mins >= close) ? 1 : 0;
    let toOpen = null;
    if (phase !== "open") {
      let d = new Date(now.getTime()), mins = 0;
      if (trading && t.mins < 570) mins = 570 - t.mins;
      else { mins = 1440 - t.mins; for (let i = 1; i < 10; i++) { d = new Date(now.getTime() + i * 864e5); const q = nyParts(d); if (tradingDay(q.ymd, q.dow)) { mins += 570; break; } mins += 1440; } }
      toOpen = Math.round(mins);
    }
    return { phase, date: t.ymd, tradingDay: trading, earlyClose: EARLY.has(t.ymd), closeAt: close === 780 ? "1:00 p.m." : "4:00 p.m.", fraction: Math.max(0, Math.min(1, frac)), minutesToClose: phase === "open" ? Math.round(close - t.mins) : null, minutesToOpen: toOpen, nyMinutes: t.mins };
  }

  // UTC time (ms) of a session's close (4:00 p.m. ET, 1:00 p.m. on early-close days), daylight saving included.
  function closeTimeUTC(ymd) { const [y, m, d] = ymd.split("-").map(Number); let t = Date.UTC(y, m - 1, d, 20, 0); t += (960 - nyParts(new Date(t)).mins) * 60e3; if (EARLY.has(ymd)) t -= 180 * 60e3; return t; }
  // The session a call made now is about: today's if it hasn't closed yet, otherwise the next trading day's.
  function targetSession(now = new Date()) {
    const s = session(now); if (s.tradingDay && s.nyMinutes < (s.earlyClose ? 780 : 960)) return s.date;
    for (let i = 1; i < 10; i++) { const p = nyParts(new Date(now.getTime() + i * 864e5)); if (tradingDay(p.ymd, p.dow)) return p.ymd; }
    return s.date;
  }
  MD.quant = { memberWeights, healthScore, deskConsensus, minVarWeights, ercWeights, riskShares, newsScore, TECH_ALERTS, techState, evaluateTechAlert, alertText, tradePreview, riskGuard, callStanding, blendWeights, barrierOdds, decisionMath, intradaySignals, calibrateFrom, closeTimeUTC, targetSession, cleanRule, ruleText, backtestRule, ruleToday, backtestVerdict, rsiSeries, states, summarize, baseRates, directionModel, barsFor, bigMoveChance, ols, dailyReturns, factorModel, attribute, lastMove, recentCorrelation,
    vwap, openingRange, pivots, atr, gapStats, sessionVolumeShare, rvol, positionSize, tradeStats, session, nyParts, HOLIDAYS, EARLY };
})(typeof window !== "undefined" ? window : globalThis);
