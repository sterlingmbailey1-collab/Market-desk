/* Machine learning on measured price history, trained in the browser and judged only on data it hasn't seen.
   - Features for each bar use that bar and earlier ones only: momentum over 5/20/60/120 bars, RSI(14), distance
     from the 50- and 200-bar averages, short- vs long-run volatility, distance from the 1-year high and low, the last
     bar's move in volatility units and, with a market series (SPY, or bitcoin for coins), the market's momentum and
     the asset's strength against it.
   - Logistic regression with an L2 penalty on standardized features, fitted by Newton's method.
   - Nearest-neighbour analogs: the past days most like today (standardized features) and what followed them.
   - Walk-forward validation: refit on everything known before each block and predict the block, leaving a gap of
     one horizon so no training label overlaps a test day. Accuracy, Brier score, log loss and AUC are measured
     against the base rate (how often the asset rose, as known at the time).
   - The two models are averaged with fixed equal weights (choosing weights on the test data would flatter them).
     Their edge counts only when it is clear across independent stretches of the test period (one-sided t ≥ 1.64 on
     non-overlapping blocks); otherwise the odds stay at the base rate and the model says it has no edge.
   - Overlapping labels (a 1-month outcome measured every day) carry far less information than their count suggests,
     so the L2 penalty grows with the horizon. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const C = MD.core;
  const closeOf = (p) => p.close ?? p.value;
  const dayKey = (t) => Math.floor(t / 86400);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  const FEATURES = [
    ["mom5", "5-bar momentum"], ["mom20", "20-bar momentum"], ["mom60", "60-bar momentum"], ["mom120", "120-bar momentum"],
    ["rsi", "RSI(14)"], ["d50", "Distance from the 50-bar average"], ["d200", "Distance from the 200-bar average"],
    ["volRatio", "Recent vs longer-run volatility"], ["fromHigh", "Distance from the 1-year high"], ["fromLow", "Distance from the 1-year low"],
    ["last1z", "Last bar's move (volatility units)"], ["mkt20", "Market's 20-bar momentum"], ["rel20", "Strength vs the market (20 bars)"]];

  // Market closes carried onto the asset's bars by day (last known value; never a later one).
  function alignMarket(points, market) {
    if (!market || !market.length) return null;
    const ms = market.slice().sort((a, b) => a.time - b.time), out = new Array(points.length).fill(null);
    let j = 0, last = null;
    for (let i = 0; i < points.length; i++) { const d = dayKey(points[i].time); while (j < ms.length && dayKey(ms[j].time) <= d) { last = closeOf(ms[j]); j++; } out[i] = last; }
    return out;
  }
  /* One feature row per bar from bar 200 on. Every value at bar i uses closes up to i only. */
  function features(points, opts = {}) {
    const v = points.map(closeOf), n = v.length, mk = alignMarket(points, opts.market), useMkt = !!mk;
    const rs = MD.quant.rsiSeries(v), lr = v.map((x, i) => i ? Math.log(x / v[i - 1]) : 0);
    const sd = (a, b) => { let s = 0, s2 = 0, k = 0; for (let t = a; t <= b; t++) { s += lr[t]; s2 += lr[t] * lr[t]; k++; } const m = s / k; return Math.sqrt(Math.max(1e-12, s2 / k - m * m)); };
    const sum = (a, b) => { let s = 0; for (let t = a; t <= b; t++) s += v[t]; return s; };
    const rows = [];
    for (let i = 200; i < n; i++) {
      const c = v[i], mom = (k) => Math.log(c / v[i - k]), v20 = sd(i - 19, i), v120 = sd(i - 119, i);
      let hi = -Infinity, lo = Infinity; for (let t = Math.max(0, i - 251); t <= i; t++) { if (v[t] > hi) hi = v[t]; if (v[t] < lo) lo = v[t]; }
      const x = [mom(5), mom(20), mom(60), mom(120), (rs[i] ?? 50) / 100 - 0.5, c / (sum(i - 49, i) / 50) - 1, c / (sum(i - 199, i) / 200) - 1, Math.log(v20 / v120), c / hi - 1, c / lo - 1, lr[i] / v20];
      if (useMkt) { const m0 = mk[i], m20 = mk[i - 20]; const mm = m0 > 0 && m20 > 0 ? Math.log(m0 / m20) : 0; x.push(mm, mom(20) - mm); }
      rows.push({ i, time: points[i].time, x });
    }
    return { rows, names: FEATURES.slice(0, useMkt ? 13 : 11), closes: v };
  }
  // y = 1 when the close `h` bars later is higher; null when that bar isn't known yet.
  const label = (v, i, h) => i + h < v.length ? (v[i + h] > v[i] ? 1 : 0) : null;

  function scaler(X) {
    const k = X[0].length, mu = new Array(k).fill(0), sd = new Array(k).fill(0);
    for (const x of X) for (let j = 0; j < k; j++) mu[j] += x[j] / X.length;
    for (const x of X) for (let j = 0; j < k; j++) sd[j] += (x[j] - mu[j]) ** 2 / X.length;
    for (let j = 0; j < k; j++) sd[j] = Math.sqrt(sd[j]) || 1;
    return { mu, sd, z: (x) => x.map((v, j) => clamp((v - mu[j]) / sd[j], -6, 6)) };
  }
  function solve(A, b) {
    const k = b.length, M = A.map((r, i) => r.concat([b[i]]));
    for (let c = 0; c < k; c++) {
      let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < k; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let q = c; q <= k; q++) M[r][q] -= f * M[c][q]; }
    }
    return M.map((r, i) => r[k] / r[i]);
  }
  const sig = (t) => 1 / (1 + Math.exp(-clamp(t, -30, 30)));
  /* L2-penalized logistic regression on already-standardized rows Z, by Newton's method (the intercept isn't penalized). */
  function logisticFit(Z, y, l2 = 2, iters = 12) {
    const k = Z[0].length + 1; let w = new Array(k).fill(0);
    for (let it = 0; it < iters; it++) {
      const H = Array.from({ length: k }, () => new Array(k).fill(0)), g = new Array(k).fill(0);
      for (let i = 0; i < Z.length; i++) {
        const r = [1].concat(Z[i]); let t = 0; for (let j = 0; j < k; j++) t += w[j] * r[j];
        const p = sig(t), s = Math.max(p * (1 - p), 1e-6);
        for (let a = 0; a < k; a++) { g[a] += (y[i] - p) * r[a]; for (let b = a; b < k; b++) H[a][b] += s * r[a] * r[b]; }
      }
      for (let a = 1; a < k; a++) { g[a] -= l2 * w[a]; H[a][a] += l2; }
      for (let a = 0; a < k; a++) for (let b = 0; b < a; b++) H[a][b] = H[b][a];
      const step = solve(H, g); if (!step) break;
      let big = 0; w = w.map((x, j) => { big = Math.max(big, Math.abs(step[j])); return x + step[j]; });
      if (big < 1e-6) break;
    }
    return { w, predict: (z) => { let t = w[0]; for (let j = 0; j < z.length; j++) t += w[j + 1] * z[j]; return sig(t); } };
  }
  // The k past rows nearest to z (Euclidean on standardized features); the chance up is smoothed toward 50%.
  function knn(Z, y, z, k = 40) {
    const d = Z.map((r, i) => { let s = 0; for (let j = 0; j < z.length; j++) s += (r[j] - z[j]) ** 2; return [s, i]; }).sort((a, b) => a[0] - b[0]).slice(0, Math.min(k, Z.length));
    const ups = d.reduce((s, [, i]) => s + y[i], 0);
    return { p: (ups + 1) / (d.length + 2), idx: d.map(([, i]) => i) };
  }
  /* Ranking quality: the chance a random up-case gets a higher probability than a random down-case (0.5 = none). */
  function auc(p, y) {
    const pos = [], neg = []; p.forEach((x, i) => (y[i] ? pos : neg).push(x)); if (!pos.length || !neg.length) return null;
    const all = p.map((x, i) => [x, y[i]]).sort((a, b) => a[0] - b[0]); let sumPos = 0;
    // Tied probabilities share the average of their ranks.
    for (let i = 0; i < all.length;) { let j = i; while (j < all.length && all[j][0] === all[i][0]) j++; const r = (i + 1 + j) / 2; for (let t = i; t < j; t++) if (all[t][1]) sumPos += r; i = j; }
    return (sumPos - pos.length * (pos.length + 1) / 2) / (pos.length * neg.length);
  }
  function scores(p, y) {
    const n = p.length; if (!n) return null;
    let br = 0, ll = 0, hit = 0; for (let i = 0; i < n; i++) { br += (p[i] - y[i]) ** 2; const q = clamp(p[i], 1e-4, 1 - 1e-4); ll -= y[i] ? Math.log(q) : Math.log(1 - q); if ((p[i] > 0.5) === !!y[i] && p[i] !== 0.5) hit++; }
    return { n, brier: br / n, logLoss: ll / n, accuracy: hit / n, auc: auc(p, y) };
  }

  /* Walk-forward evaluation and today's forecast for an `h`-bar horizon. */
  function forecast(points, opts = {}) {
    const h = Math.max(1, Math.round(opts.horizonBars || 21)), F = features(points, opts), v = F.closes;
    const rows = F.rows.map(r => Object.assign(r, { y: label(v, r.i, h) }));
    const labeled = rows.filter(r => r.y != null), minTrain = Math.max(opts.minTrain || 250, 120), step = Math.max(h, 21);
    if (labeled.length < minTrain + step + h) return { error: "Not enough history: the model needs about " + (200 + minTrain + step + h) + " bars and has " + v.length + "." };
    const oos = { logit: [], knn: [], base: [], y: [], at: [] }, l2 = opts.l2 ?? Math.max(2, 3 * h);
    for (let t0 = minTrain + h; t0 < labeled.length; t0 += step) {
      const train = labeled.slice(0, t0 - h), test = labeled.slice(t0, Math.min(labeled.length, t0 + step));
      if (!test.length) break;
      const S = scaler(train.map(r => r.x)), Z = train.map(r => S.z(r.x)), Y = train.map(r => r.y), m = logisticFit(Z, Y, l2), base = (Y.reduce((s, x) => s + x, 0) + 1) / (Y.length + 2);
      for (const r of test) { const z = S.z(r.x); oos.logit.push(m.predict(z)); oos.knn.push(knn(Z, Y, z, opts.k || 40).p); oos.base.push(base); oos.y.push(r.y); oos.at.push(r.time); }
    }
    const sBase = scores(oos.base, oos.y), sLogit = scores(oos.logit, oos.y), sKnn = scores(oos.knn, oos.y);
    const skill = (s) => sBase && s && sBase.brier > 0 ? 1 - s.brier / sBase.brier : 0;
    const ens = oos.y.map((_, i) => (oos.logit[i] + oos.knn[i]) / 2);
    const sEns = scores(ens, oos.y), skEns = skill(sEns);
    // Is the improvement over the base rate clear? Brier differences averaged over non-overlapping blocks of h test days.
    const blocks = []; for (let b = 0; b + h <= ens.length; b += h) { let d = 0; for (let i = b; i < b + h; i++) d += (oos.base[i] - oos.y[i]) ** 2 - (ens[i] - oos.y[i]) ** 2; blocks.push(d / h); }
    const md = blocks.length ? blocks.reduce((s, x) => s + x, 0) / blocks.length : 0, sdd = blocks.length > 1 ? Math.sqrt(blocks.reduce((s, x) => s + (x - md) ** 2, 0) / (blocks.length - 1)) : Infinity;
    const tStat = sdd > 0 && isFinite(sdd) ? md / (sdd / Math.sqrt(blocks.length)) : 0, clear = tStat >= 1.64 && skEns > 0;
    // Trust in the models: none without a clear edge, full at 5% better Brier than the base rate.
    const trust = clear ? clamp(skEns / 0.05, 0, 1) : 0;
    // Final model on everything labeled, applied to today's (unlabeled) row.
    const S = scaler(labeled.map(r => r.x)), Z = labeled.map(r => S.z(r.x)), Y = labeled.map(r => r.y), m = logisticFit(Z, Y, l2);
    const last = rows[rows.length - 1], zNow = S.z(last.x), pL = m.predict(zNow), nn = knn(Z, Y, zNow, opts.k || 40), pK = nn.p;
    const base = (Y.reduce((s, x) => s + x, 0) + 1) / (Y.length + 2), pEns = (pL + pK) / 2;
    const finalP = clamp(base + (pEns - base) * trust, 0.2, 0.8);
    const contrib = F.names.map(([key, name], j) => ({ key, name, value: last.x[j], z: zNow[j], weight: m.w[j + 1], push: m.w[j + 1] * zNow[j] })).sort((a, b) => Math.abs(b.push) - Math.abs(a.push));
    const analogs = nn.idx.slice(0, 8).map(i => { const r = labeled[i]; return { date: new Date(r.time * 1000).toISOString().slice(0, 10), forwardPct: (v[r.i + h] / v[r.i] - 1) * 100, up: !!r.y }; });
    // Reliability of confident out-of-sample calls: when the blended model said 60%+ one way, how often was it right.
    const conf = ens.map((p, i) => ({ p, y: oos.y[i] })).filter(x => Math.abs(x.p - 0.5) >= 0.1), confRight = conf.filter(x => (x.p > 0.5) === !!x.y).length;
    return { horizonBars: h, asOf: new Date(last.time * 1000).toISOString().slice(0, 10), from: new Date(points[0].time * 1000).toISOString().slice(0, 10), bars: v.length, trainedOn: labeled.length,
      upPct: finalP * 100, models: { logisticPct: pL * 100, analogsPct: pK * 100, baseRatePct: base * 100, blendedPct: pEns * 100 }, trust,
      oos: { predictions: oos.y.length, independent: Math.max(1, Math.floor(oos.y.length / h)), base: sBase, logistic: sLogit, analogs: sKnn, ensemble: sEns, skillLogistic: skill(sLogit), skillAnalogs: skill(sKnn), skillEnsemble: skEns, tStat, blocks: blocks.length, confident: { n: conf.length, right: confRight } },
      edge: clear, l2, drivers: contrib, analogs, features: F.names.map(([, n]) => n), usedMarket: F.names.length > 11 };
  }

  /* k-means with k-means++ seeding (deterministic for a seed) on rows of numbers. Returns centroids and labels. */
  function kmeans(Z, k, seed = 7, iters = 60) {
    const r = C.rng(seed), n = Z.length, d2 = (a, b) => { let s = 0; for (let j = 0; j < a.length; j++) s += (a[j] - b[j]) ** 2; return s; };
    const cents = [Z[Math.floor(r() * n)].slice()];
    while (cents.length < k) { const dist = Z.map(z => Math.min(...cents.map(c => d2(z, c)))), tot = dist.reduce((s, x) => s + x, 0); let u = r() * tot, i = 0; while (i < n - 1 && (u -= dist[i]) > 0) i++; cents.push(Z[i].slice()); }
    let labels = new Array(n).fill(0);
    for (let it = 0; it < iters; it++) {
      const next = Z.map(z => { let b = 0, bd = Infinity; cents.forEach((c, j) => { const dd = d2(z, c); if (dd < bd) { bd = dd; b = j; } }); return b; });
      const moved = next.some((x, i) => x !== labels[i]); labels = next;
      for (let j = 0; j < k; j++) { const mem = Z.filter((_, i) => labels[i] === j); if (mem.length) cents[j] = mem[0].map((_, q) => mem.reduce((s, z) => s + z[q], 0) / mem.length); }
      if (!moved && it) break;
    }
    return { centroids: cents, labels, nearest: (z) => { let b = 0, bd = Infinity; cents.forEach((c, j) => { const dd = d2(z, c); if (dd < bd) { bd = dd; b = j; } }); return b; } };
  }
  /* Market regimes: S&P 500 days clustered (k-means) by 20-day trend, 20-day volatility, distance from the 200-day
     average and drawdown from the 1-year high; for each regime, what SPY did over the next `h` bars. Measured history. */
  function regimes(points, opts = {}) {
    const v = points.map(closeOf), h = opts.horizonBars || 21, k = opts.k || 4, rows = [];
    for (let i = 200; i < v.length; i++) {
      let s = 0, s2 = 0; for (let t = i - 19; t <= i; t++) { const x = Math.log(v[t] / v[t - 1]); s += x; s2 += x * x; }
      let hi = 0; for (let t = Math.max(0, i - 251); t <= i; t++) hi = Math.max(hi, v[t]);
      let m200 = 0; for (let t = i - 199; t <= i; t++) m200 += v[t] / 200;
      rows.push({ i, time: points[i].time, x: [Math.log(v[i] / v[i - 20]), Math.sqrt(Math.max(0, s2 / 20 - (s / 20) ** 2)) * Math.sqrt(252), v[i] / m200 - 1, v[i] / hi - 1] });
    }
    if (rows.length < 120) return { error: "Not enough history to find regimes (" + v.length + " bars)." };
    const S = scaler(rows.map(r => r.x)), Z = rows.map(r => S.z(r.x)), km = kmeans(Z, k, opts.seed || 7);
    const groups = Array.from({ length: k }, (_, j) => {
      const mem = rows.filter((_, i) => km.labels[i] === j), fwd = mem.filter(r => r.i + h < v.length).map(r => (v[r.i + h] / v[r.i] - 1) * 100);
      const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null, c = (q) => mean(mem.map(r => r.x[q]));
      return { id: j, days: mem.length, sharePct: mem.length / rows.length * 100, trend20Pct: c(0) * 100, volPct: c(1) * 100, from200Pct: c(2) * 100, fromHighPct: c(3) * 100,
        next: { n: fwd.length, independent: Math.floor(fwd.length / h), avgPct: mean(fwd), upPct: fwd.length ? fwd.filter(x => x > 0).length / fwd.length * 100 : null } };
    });
    const byVol = groups.slice().sort((a, b) => b.volPct - a.volPct);
    for (const g of groups) g.name = g === byVol[0] ? (g.trend20Pct < 0 ? "Stressed sell-off" : "Volatile") : g.fromHighPct <= -12 ? "Correction (deep drawdown)" : g.from200Pct > 0 && g.trend20Pct > 0 ? (g.volPct < byVol[byVol.length - 1].volPct * 1.15 ? "Calm uptrend" : "Uptrend") : g.trend20Pct < 0 ? "Pullback" : "Sideways";
    const seen = {}; for (const g of groups) { seen[g.name] = (seen[g.name] || 0) + 1; if (seen[g.name] > 1) g.name += " " + seen[g.name]; }
    const today = km.labels[km.labels.length - 1], runStart = (() => { let t = km.labels.length - 1; while (t > 0 && km.labels[t - 1] === today) t--; return rows[t].time; })();
    return { groups, today, todayGroup: groups[today], since: new Date(runStart * 1000).toISOString().slice(0, 10), asOf: new Date(rows[rows.length - 1].time * 1000).toISOString().slice(0, 10), from: new Date(rows[0].time * 1000).toISOString().slice(0, 10), horizonBars: h, days: rows.length,
      timeline: rows.map((r, i) => ({ time: r.time, g: km.labels[i] })) };
  }

  /* Learned combiner ("stacking"): a logistic regression on the logits of each input probability (Claude's team, the
     measured history, the reviewer, the ML model), fitted on graded calls in time order. It is used only if, trained
     on the first 70% of the record, it beat the desk's own logged odds on the last 30%; then it is refitted on all.
     items: [{c, m, r, ml, final, up}] with probabilities in % and up = the asset finished higher. */
  function stacker(items, opts = {}) {
    const minN = opts.minN || 30, lg = (p) => { const q = clamp((p ?? 50) / 100, 0.02, 0.98); return Math.log(q / (1 - q)); };
    const X = (it) => [lg(it.c), lg(it.m ?? it.c), lg(it.r ?? it.c), lg(it.ml ?? it.m ?? it.c)];
    if (items.length < minN) return { used: false, n: items.length, reason: "needs " + minN + " graded calls with every input" };
    const cut = Math.floor(items.length * 0.7), tr = items.slice(0, cut), te = items.slice(cut);
    const fit = (rows) => { const S = scaler(rows.map(X)), m = logisticFit(rows.map(r => S.z(X(r))), rows.map(r => r.up ? 1 : 0), opts.l2 ?? 4); return (it) => m.predict(S.z(X(it))) * 100; };
    const f1 = fit(tr), brier = (ps) => te.reduce((s, it, i) => s + (ps[i] / 100 - (it.up ? 1 : 0)) ** 2, 0) / te.length;
    const bStack = brier(te.map(f1)), bLogged = brier(te.map(it => it.final ?? it.c));
    if (!(bStack < bLogged)) return { used: false, n: items.length, brierStack: bStack, brierLogged: bLogged, reason: "didn't beat the desk's own odds on the latest " + te.length + " calls" };
    const fAll = fit(items);
    return { used: true, n: items.length, brierStack: bStack, brierLogged: bLogged, apply: (it) => clamp(fAll(it), 5, 95) };
  }

  MD.ml = { stacker, kmeans, regimes, FEATURES, features, label, scaler, logisticFit, knn, auc, scores, forecast };
})(typeof window !== "undefined" ? window : globalThis);
