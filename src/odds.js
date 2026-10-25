/* Betting math. Pure functions, no I/O: odds formats, implied and no-vig ("fair") probabilities,
   payouts, expected value, Kelly stakes, parlays, arbitrage, book hold, closing-line value, a normal
   model for spreads and totals in US sports, and a Poisson goal model for soccer. Decimal odds are the
   internal unit everywhere (2.50 = a $1 stake returns $2.50). */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const C = MD.core;
  const fin = (x) => typeof x === "number" && isFinite(x);

  /* ---------- formats ---------- */
  function amToDec(a) { a = Number(a); if (!fin(a) || (a > -100 && a < 100)) return null; return a > 0 ? 1 + a / 100 : 1 + 100 / -a; }
  function decToAm(d) { d = Number(d); if (!(d > 1)) return null; return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)); }
  // Closest fraction to (d - 1) with a denominator up to maxDen, by continued fractions.
  function decToFrac(d, maxDen = 100) {
    const x = Number(d) - 1; if (!(x > 0)) return null;
    let h0 = 0, h1 = 1, k0 = 1, k1 = 0, b = x;
    for (let i = 0; i < 24; i++) {
      const a = Math.floor(b), h2 = a * h1 + h0, k2 = a * k1 + k0;
      if (k2 > maxDen) break;
      h0 = h1; h1 = h2; k0 = k1; k1 = k2;
      if (Math.abs(x - h1 / k1) < 1e-9 || b - a < 1e-12) break;
      b = 1 / (b - a);
    }
    return k1 ? h1 + "/" + k1 : null;
  }
  // Accepts American (+150, -110, even), decimal (2.50) or fractional (5/4) text; returns decimal odds.
  function parseOdds(v) {
    if (v == null) return null;
    if (typeof v === "number") return v > 1 && v < 1000 && !Number.isInteger(v) ? v : amToDec(v);
    const s = String(v).trim().toLowerCase().replace(/\s+/g, "");
    if (!s || s === "n/a" || s === "--" || s === "-") return null;
    if (s === "even" || s === "ev" || s === "evens" || s === "evs") return 2;
    let m = s.match(/^(\d+)\/(\d+)$/); if (m) return +m[2] ? 1 + Number(m[1]) / Number(m[2]) : null;
    m = s.match(/^([+-])(\d{3,})$/); if (m) return amToDec(Number(m[1] + m[2]));
    if (/^\d+\.\d+$/.test(s)) { const n = Number(s); return n > 1 && n < 1000 ? n : null; }
    if (/^\d{3,}$/.test(s)) return amToDec(Number(s));
    return null;
  }
  const fmtAm = (d) => { const a = decToAm(d); return a == null ? "—" : a === 100 ? "+100" : (a > 0 ? "+" : "") + a; };
  const fmtDec = (d) => d > 1 ? Number(d).toFixed(2) : "—";
  const fmtFrac = (d) => { const f = decToFrac(d); return f === "1/1" ? "Evens" : f || "—"; };
  function fmt(d, style) { return style === "decimal" ? fmtDec(d) : style === "fractional" ? fmtFrac(d) : fmtAm(d); }

  /* ---------- probabilities ---------- */
  const implied = (d) => d > 1 ? 1 / d : null;
  const probToDec = (p) => p > 0 && p < 1 ? 1 / p : null;
  // The book's margin across a complete set of outcomes: 1.0476 → 4.76% overround, 4.55% hold.
  function overround(decs) { if (!decs.length || !decs.every(d => d > 1)) return null; return decs.reduce((s, d) => s + 1 / d, 0) - 1; }
  function hold(decs) { const o = overround(decs); return o == null ? null : 1 - 1 / (1 + o); }
  // Fair probabilities with the margin removed. "mult" scales proportionally; "power" raises each implied
  // probability to the exponent that makes them sum to 1 (shades longshots, which carry more margin).
  function noVig(decs, method = "mult") {
    if (!decs.length || !decs.every(d => d > 1)) return null;
    const imp = decs.map(d => 1 / d), s = imp.reduce((a, b) => a + b, 0);
    if (method !== "power") return imp.map(p => p / s);
    let lo = 0.2, hi = 5;
    for (let i = 0; i < 80; i++) { const k = (lo + hi) / 2, f = imp.reduce((a, p) => a + Math.pow(p, k), 0); if (f > 1) lo = k; else hi = k; }
    const k = (lo + hi) / 2, out = imp.map(p => Math.pow(p, k)), t = out.reduce((a, b) => a + b, 0);
    return out.map(p => p / t);
  }

  /* ---------- money ---------- */
  const payout = (stake, d) => ({ profit: stake * (d - 1), total: stake * d });
  // Expected profit per unit staked; with a push probability the stake comes back.
  const edge = (p, d, push = 0) => p * (d - 1) - (1 - p - push);
  // Kelly fraction of bankroll for a win probability p at decimal odds d (0 when there's no edge).
  function kelly(p, d, push = 0) {
    const b = d - 1, q = 1 - p - push; if (!(b > 0) || !(p > 0)) return 0;
    const f = (b * p - q) / (b * (1 - push) || b); return Math.max(0, Math.min(1, f));
  }
  const breakeven = (d) => d > 1 ? 1 / d : null;
  // Closing-line value: how much better the price taken was than the closing price (+ is good).
  const clv = (taken, closing) => taken > 1 && closing > 1 ? taken / closing - 1 : null;
  function parlay(legs) {
    const ok = legs.filter(l => l && l.dec > 1);
    const dec = ok.reduce((a, l) => a * l.dec, 1);
    const withP = ok.every(l => fin(l.p));
    const p = withP ? ok.reduce((a, l) => a * l.p, 1) : null;
    return { dec, legs: ok.length, p, edge: p != null ? p * dec - 1 : null, impliedP: ok.length ? 1 / dec : null };
  }
  // Best price for each outcome across books: if the implied probabilities sum below 1, staking in
  // proportion to them locks in the same return whatever happens.
  function arbitrage(decs, total = 100) {
    if (!decs.length || !decs.every(d => d > 1)) return null;
    const s = decs.reduce((a, d) => a + 1 / d, 0);
    const stakes = decs.map(d => total * (1 / d) / s);
    return { sum: s, arb: s < 1, profitPct: (1 / s - 1) * 100, stakes, returns: stakes.map((x, i) => x * decs[i]) };
  }
  // Bet win/push/lose given a probability table [[value, p], …] when the bet wins on value > line.
  // Quarter lines (2.25, -0.75) split the stake across the two neighbouring half-point lines.
  function lineProbs(dist, line) {
    if (Math.abs(line * 4 - Math.round(line * 4)) < 1e-9 && Math.round(line * 4) % 2 !== 0) {
      const a = lineProbs(dist, line - 0.25), b = lineProbs(dist, line + 0.25);
      return { win: (a.win + b.win) / 2, push: (a.push + b.push) / 2, lose: (a.lose + b.lose) / 2, split: true };
    }
    let win = 0, push = 0, lose = 0;
    for (const [x, p] of dist) { if (x > line + 1e-9) win += p; else if (Math.abs(x - line) <= 1e-9) push += p; else lose += p; }
    return { win, push, lose, split: false };
  }

  /* ---------- US sports: normal model for margins and totals ---------- */
  // Approximate historical standard deviations of the final margin and the combined score.
  const SIGMA = { nfl: { margin: 13.5, total: 10 }, ncaaf: { margin: 16, total: 14 }, nba: { margin: 12, total: 18 }, ncaab: { margin: 11, total: 14 }, wnba: { margin: 11, total: 15 }, mlb: { margin: 4.2, total: 4.4 }, nhl: { margin: 2.4, total: 2.3 } };
  // P(X > line) for an integer-valued score X ≈ Normal(mu, sigma), with the push on whole numbers.
  function normalLine(mu, sigma, line) {
    if (!(sigma > 0)) return null;
    const whole = Math.abs(line - Math.round(line)) < 1e-9;
    if (whole) { const hi = C.normCdf((line + 0.5 - mu) / sigma), lo = C.normCdf((line - 0.5 - mu) / sigma); return { win: 1 - hi, push: hi - lo, lose: lo }; }
    const w = 1 - C.normCdf((line - mu) / sigma); return { win: w, push: 0, lose: 1 - w };
  }
  // Mean that makes "X > line" happen with probability p (inverse of normalLine for half-point lines).
  const impliedMean = (p, sigma, line) => p > 0 && p < 1 ? line + sigma * C.normInv(p) : null;
  // A team's spread of -3 wins when its margin exceeds 3: P(margin > -spread).
  const coverProb = (muMargin, sigma, spread) => normalLine(muMargin, sigma, -spread);

  /* ---------- soccer: Poisson goals ---------- */
  function poissonPmf(lambda, max = 10) {
    const out = []; let p = Math.exp(-lambda), sum = 0;
    for (let k = 0; k <= max; k++) { if (k) p *= lambda / k; out.push(p); sum += p; }
    out[max] += Math.max(0, 1 - sum);
    return out;
  }
  function soccer(lh, la, max = 10) {
    if (!(lh >= 0) || !(la >= 0)) return null;
    const ph = poissonPmf(lh, max), pa = poissonPmf(la, max);
    let home = 0, draw = 0, away = 0, btts = 0, csHome = 0, csAway = 0;
    const tot = new Map(), diff = new Map(), scores = [];
    for (let i = 0; i <= max; i++) for (let j = 0; j <= max; j++) {
      const p = ph[i] * pa[j];
      if (i > j) home += p; else if (i === j) draw += p; else away += p;
      if (i > 0 && j > 0) btts += p; if (j === 0) csHome += p; if (i === 0) csAway += p;
      tot.set(i + j, (tot.get(i + j) || 0) + p); diff.set(i - j, (diff.get(i - j) || 0) + p);
      scores.push({ home: i, away: j, p });
    }
    scores.sort((a, b) => b.p - a.p);
    const totals = [...tot.entries()].sort((a, b) => a[0] - b[0]), diffs = [...diff.entries()].sort((a, b) => a[0] - b[0]);
    return {
      lh, la, home, draw, away, btts, cleanSheetHome: csHome, cleanSheetAway: csAway, scores: scores.slice(0, 12), totals, diffs,
      over: (line) => lineProbs(totals, line),
      // Home team on an Asian handicap: wins when goal difference + handicap > 0.
      homeHandicap: (hcp) => lineProbs(diffs, -hcp),
      awayHandicap: (hcp) => lineProbs(diffs.map(([d, p]) => [-d, p]), -hcp)
    };
  }

  /* ---------- summaries ---------- */
  function median(xs) { const a = xs.filter(fin).sort((x, y) => x - y); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }

  MD.odds = { amToDec, decToAm, decToFrac, parseOdds, fmtAm, fmtDec, fmtFrac, fmt, implied, probToDec, overround, hold, noVig, payout, edge, kelly, breakeven, clv, parlay, arbitrage, lineProbs, SIGMA, normalLine, impliedMean, coverProb, poissonPmf, soccer, median };
})(typeof window !== "undefined" ? window : globalThis);
