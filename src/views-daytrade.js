/* Day Trading: the session clock, gappers and movers, and a desk for one symbol with measured intraday levels
   (pre-market range, open, opening range, VWAP, prior day, pivots, ATR, relative volume, how past gaps played out),
   a position-size calculator, an AI day-trade plan with up/down odds that is logged and graded at the close, and a
   journal of your own trades with an AI coach. Read-only: the page never places orders. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const C = MD.core, Q = MD.quant, U = MD.ui, D = MD.data, h = U.h;
  const V = (MD.views = MD.views || {});
  const iso = (t) => new Date(t * 1000).toISOString().slice(0, 10);
  const r2 = (x) => x == null || !isFinite(x) ? null : Math.round(x * 100) / 100;
  const px = (v) => v == null ? "—" : C.fmtNum(v, Math.abs(v) >= 1 ? 2 : 6);
  const pc = (v) => v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(2) + "%";
  const SETUPS = ["Opening range breakout", "VWAP reclaim", "VWAP rejection", "Gap and go", "Gap fill", "Pullback to support", "Breakdown", "Reversal", "News / catalyst", "Other"];

  /* ---------- measured levels ---------- */
  async function levels(app, asset) {
    const cls = asset.cls || String(asset.id).split(":")[0], isStock = cls === "stock" || cls === "etf";
    if (!isStock && cls !== "crypto") throw new Error("Day-trading levels cover US stocks, ETFs and crypto.");
    const [daily, intra, ib, prof, q] = await Promise.all([D.historyFor(asset, "1Y"), isStock ? D.stocks.intraday(asset.symbol, cls).catch(e => ({ error: e })) : null, D.intradayBars(asset).catch(e => ({ error: e })),
      isStock ? D.stocks.profile(asset.symbol, cls).catch(() => null) : null, app.quote(asset, 15000).catch(() => null)]);
    const L = { symbol: asset.symbol, name: (q && q.name) || asset.name, cls, asset, at: Date.now(), clock: Q.session(), notes: [], sources: [] };
    const allBars = ib && !ib.error ? ib.bars : [];
    if (ib && ib.error) L.notes.push("5-minute volume bars unavailable (" + U.errorText(ib.error) + "), so VWAP and relative volume are missing.");
    let prior = [], today = [], series = [], hi = null, lo = null;
    if (isStock) {
      const it = intra && !intra.error ? intra : null;
      if (!it) L.notes.push("Nasdaq's minute-by-minute prices are unavailable" + (intra && intra.error ? " (" + U.errorText(intra.error) + ")" : "") + ".");
      const lastPt = it && it.points.length ? it.points[it.points.length - 1] : null;
      L.sessionDate = lastPt ? Q.nyParts(new Date(lastPt.time * 1000)).ymd : ib && ib.date ? ib.date : L.clock.date;
      today = ib && !ib.error && ib.date === L.sessionDate ? allBars : [];
      if (allBars.length && !today.length) L.notes.push("The 5-minute bars are from " + ib.date + ", not this session, so VWAP is left out.");
      prior = daily.points.filter(p => iso(p.time) < L.sessionDate);
      L.previousClose = (it && it.previousClose) || (prior.length ? prior[prior.length - 1].close : null);
      L.pre = it && it.pre ? { high: it.pre.high, low: it.pre.low, last: it.pre.last } : null;
      L.post = it && it.post ? { high: it.post.high, low: it.post.low, last: it.post.last } : null;
      L.open = it && it.regular ? it.regular.first : today.length ? today[0].open : null;
      const rh = [it && it.regular ? it.regular.high : null, ...today.map(b => b.high)].filter(x => x != null), rl = [it && it.regular ? it.regular.low : null, ...today.map(b => b.low)].filter(x => x != null);
      hi = rh.length ? Math.max(...rh) : null; lo = rl.length ? Math.min(...rl) : null;
      L.last = (q && q.price) || (it && it.last) || (today.length ? today[today.length - 1].close : null);
      L.openSec = (it && it.openSec) || (today[0] && today[0].time) || null;
      series = it ? it.points.map(p => ({ time: p.time, value: p.value })) : today.map(b => ({ time: b.time, value: b.close }));
      L.minute = it ? it.points.filter(p => p.et >= 570 && p.et < 960).map(p => ({ time: p.time, close: p.value })) : [];
      L.volumeToday = (it && it.volume) || (today.length ? today.reduce((s, b) => s + b.volume, 0) : null);
      L.avgVolume = prof && prof.avgVolume; L.sector = prof && prof.sector; L.industry = prof && prof.industry;
      L.shift = D.tzOffsetSec("America/New_York"); L.sessionLabel = "New York session " + L.sessionDate; L.tz = "ET";
      L.fraction = L.sessionDate === L.clock.date ? L.clock.fraction : 1;
      L.sources.push(it ? it.source : null, ib && !ib.error ? ib.source : null, "Nasdaq daily history");
    } else {
      const dayStart = Math.floor(Date.now() / 864e5) * 86400;
      L.sessionDate = iso(dayStart); today = allBars.filter(b => b.time >= dayStart);
      prior = daily.points.filter(p => iso(p.time) < L.sessionDate);
      L.previousClose = prior.length ? prior[prior.length - 1].close : null;
      L.open = today.length ? today[0].open : null; hi = today.length ? Math.max(...today.map(b => b.high)) : null; lo = today.length ? Math.min(...today.map(b => b.low)) : null;
      L.last = (q && q.price) || (allBars.length ? allBars[allBars.length - 1].close : null); L.openSec = dayStart;
      series = allBars.map(b => ({ time: b.time, value: b.close })); L.minute = today;
      L.volumeToday = today.length ? today.reduce((s, b) => s + b.volume * b.close, 0) : null;
      const dv = (daily.volume || []).filter(v => iso(v.time) < L.sessionDate).slice(-30).map(v => v.value); L.avgVolume = dv.length ? dv.reduce((s, x) => s + x, 0) / dv.length : null;
      L.shift = -new Date().getTimezoneOffset() * 60; L.sessionLabel = "UTC day " + L.sessionDate + " (crypto trades around the clock)"; L.tz = "local time";
      L.fraction = Math.min(1, (Date.now() / 1000 - dayStart) / 86400);
      L.sources.push(ib && !ib.error ? ib.source : null, daily.source + " daily candles");
    }
    L.sources = L.sources.filter(Boolean);
    L.high = hi; L.low = lo; L.series = series; L.bars = today;
    L.changePct = L.previousClose && L.last ? (L.last / L.previousClose - 1) * 100 : null;
    if (isStock) { L.gapPct = L.open && L.previousClose ? (L.open / L.previousClose - 1) * 100 : L.pre && L.previousClose ? (L.pre.last / L.previousClose - 1) * 100 : null; L.gapIndicated = !L.open && L.gapPct != null; }
    const pd = prior.length ? prior[prior.length - 1] : null;
    L.prior = pd ? { date: iso(pd.time), high: pd.high, low: pd.low, close: pd.close, open: pd.open } : null;
    L.pivots = pd ? Q.pivots(pd) : null;
    const a = Q.atr(prior, 14); L.atr = a ? a.atr : null; L.atrPct = a ? a.atrPct : null;
    const lr = C.returnsFrom(prior.slice(-61).map(p => p.close)); L.dailyVolPct = lr.length > 10 ? C.stdev(lr) * 100 : null;
    L.minutesLeft = isStock ? (L.clock.phase === "open" ? L.clock.minutesToClose : L.clock.phase === "pre" || (L.clock.tradingDay && L.clock.nyMinutes < 570) ? 390 : 0) : Math.round((Math.floor(Date.now() / 864e5) + 1) * 1440 - Date.now() / 60000);
    L.rangeUsedPct = L.atr && hi != null && lo != null ? (hi - lo) / L.atr * 100 : null;
    const vw = today.length ? Q.vwap(today) : null; L.vwap = vw ? { value: vw.last, upper: vw.upper, lower: vw.lower } : null; L.vwapSeries = vw ? vw.series : [];
    L.vsVwapPct = vw && L.last ? (L.last / vw.last - 1) * 100 : null;
    L.barsAboveVwapPct = vw ? today.filter((b, i) => vw.series[i] && b.close > vw.series[i].value).length / today.length * 100 : null;
    const orSrc = L.minute.length ? L.minute : today;
    L.or15 = L.openSec && orSrc.length ? Q.openingRange(orSrc, L.openSec, 15) : null; L.or30 = L.openSec && orSrc.length ? Q.openingRange(orSrc, L.openSec, 30) : null;
    L.rvol = isStock ? Q.rvol(L.volumeToday, L.avgVolume, L.fraction) : L.volumeToday && L.avgVolume && L.fraction > 0 ? L.volumeToday / (L.avgVolume * L.fraction) : null;
    L.gapStats = isStock && L.gapPct != null && Math.abs(L.gapPct) >= 0.3 ? Q.gapStats(prior, L.gapPct) : null;
    const recent = prior.slice(-250).filter(p => p.open > 0); L.closeAboveOpenPct = recent.length ? recent.filter(p => p.close > p.open).length / recent.length * 100 : null;
    const lv = [];
    const add = (label, price, kind) => { if (price > 0 && isFinite(price)) lv.push({ label, price, kind, distancePct: L.last ? (price / L.last - 1) * 100 : null }); };
    add("Previous close", L.previousClose, "prior"); if (L.prior) { add("Prior day high", L.prior.high, "prior"); add("Prior day low", L.prior.low, "prior"); }
    if (L.pre) { add("Pre-market high", L.pre.high, "pre"); add("Pre-market low", L.pre.low, "pre"); }
    add("Open", L.open, "session"); add("Session high", hi, "session"); add("Session low", lo, "session");
    if (L.or15) { add("15-min opening range high", L.or15.high, "or"); add("15-min opening range low", L.or15.low, "or"); }
    if (L.vwap) { add("VWAP", L.vwap.value, "vwap"); add("VWAP +1σ", L.vwap.upper, "vwap"); add("VWAP −1σ", L.vwap.lower, "vwap"); }
    if (L.pivots) for (const k of ["R2", "R1", "P", "S1", "S2"]) add("Pivot " + k, L.pivots[k], "pivot");
    L.levels = lv.sort((x, y) => y.price - x.price);
    L.signals = Q.intradaySignals({ minute: L.minute, last: L.last, or15: L.or15, openSec: L.openSec, bars: L.bars, vwapSeries: L.vwapSeries, vwapUpper: L.vwap && L.vwap.upper, vwapLower: L.vwap && L.vwap.lower, high: hi, low: lo, priorHigh: L.prior && L.prior.high, priorLow: L.prior && L.prior.low, preHigh: L.pre && L.pre.high, preLow: L.pre && L.pre.low, gapPct: L.gapIndicated ? null : L.gapPct, prevClose: L.previousClose, open: L.open, rvol: L.rvol });
    return L;
  }
  // Signal chips: green for long-side setups, red for short-side, grey for context.
  function signalChips(signals, tzShift) {
    if (!signals || !signals.length) return h("span", { class: "tiny muted" }, "No setups measured yet");
    return h("div", { class: "row sigchips", style: "gap:4px;flex-wrap:wrap" }, signals.map(s => h("span", { class: "pill " + (s.side === "long" ? "ok" : s.side === "short" ? "bad" : ""), title: s.detail + (s.at ? " · since " + new Date((s.at + (tzShift || 0)) * 1000).toISOString().slice(11, 16) : "") }, s.name)));
  }
  /* The watch board: a light measure of several symbols at once (Nasdaq minute prices, the prior day and average
     volume), refreshed every minute while US markets trade. */
  async function boardRow(app, sym) {
    const a = await MD.ai.findAsset(sym); if (a.cls !== "stock" && a.cls !== "etf") throw new Error(sym + ": the board covers US stocks and ETFs.");
    const [it, daily, prof] = await Promise.all([D.stocks.intraday(a.symbol, a.cls), D.historyFor(a, "1M").catch(() => null), D.stocks.profile(a.symbol, a.cls).catch(() => null)]);
    const lastPt = it.points[it.points.length - 1], sessionDate = lastPt ? Q.nyParts(new Date(lastPt.time * 1000)).ymd : Q.session().date;
    const prior = daily ? daily.points.filter(p => iso(p.time) < sessionDate) : [], pd = prior[prior.length - 1] || null;
    const minute = it.points.filter(p => p.et >= 570 && p.et < 960).map(p => ({ time: p.time, close: p.value })), clock = Q.session();
    const last = it.last || (lastPt && lastPt.value), reg = it.regular, prev = it.previousClose || (pd && pd.close);
    const gapPct = reg && prev ? (reg.first / prev - 1) * 100 : it.pre && prev ? (it.pre.last / prev - 1) * 100 : null;
    const or15 = it.openSec && minute.length ? Q.openingRange(minute, it.openSec, 15) : null;
    const rvol = Q.rvol(it.volume, prof && prof.avgVolume, sessionDate === clock.date ? clock.fraction : 1);
    const signals = Q.intradaySignals({ minute, last, or15, openSec: it.openSec, high: reg && reg.high, low: reg && reg.low, priorHigh: pd && pd.high, priorLow: pd && pd.low, preHigh: it.pre && it.pre.high, preLow: it.pre && it.pre.low, gapPct: reg ? gapPct : null, prevClose: prev, open: reg && reg.first, rvol });
    return { symbol: a.symbol, asset: a, last, chgPct: prev && last ? (last / prev - 1) * 100 : null, gapPct, gapIndicated: !reg, high: reg && reg.high, low: reg && reg.low, posPct: reg && reg.high > reg.low ? (last - reg.low) / (reg.high - reg.low) * 100 : null, rvol, signals, sessionDate };
  }
  function boardView(app, load) {
    const box = h("div", { class: "stack" }), tbl = h("div", {}), stamp = h("span", { class: "tiny muted" });
    const get = () => app.ls.get("day.board", ["SPY", "QQQ"]), set = (xs) => app.ls.set("day.board", xs.slice(0, 10));
    const input = h("input", { type: "text", placeholder: "Add a ticker", "aria-label": "Add to board", style: "max-width:150px" });
    const addBtn = h("button", { class: "btn ghost sm", type: "button", onclick: () => { const v = input.value.trim().toUpperCase(); if (!v) return; if (!get().includes(v)) set(get().concat(v)); input.value = ""; refresh(true); } }, "Add");
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") addBtn.click(); });
    let seen = null, lastRows = [];
    const aiOut = h("div", { class: "stack" });
    const aiBtn = h("button", { class: "btn ghost sm", type: "button", disabled: !app.caps.sample, onclick: async () => {
      const rows = lastRows.filter(r => !r.error); if (!rows.length) return;
      aiBtn.disabled = true; aiOut.replaceChildren(h("div", { class: "skeleton" }, "Reading the board…"));
      try {
        const r = await app.caps.sample.json(`You are a disciplined intraday analyst. Below is the user's watch board, measured by the app: price, change, gap, position in the day's range, relative volume and the setups detected (with since-when). The US market is ${Q.session().phase}. Say which one or two setups look cleanest right now and why (trend, volume, clean levels), with a plan in levels already on the board; which names to leave alone; and when the honest answer is "nothing clean, wait". Use only the board's data; no orders.
${MD.ai.contextNote(app)}
Board: ${JSON.stringify(rows.map(x => ({ symbol: x.symbol, last: x.last, changePct: r2(x.chgPct), gapPct: r2(x.gapPct), gapIndicatedByPremarket: x.gapIndicated, dayRangePositionPct: x.posPct != null ? Math.round(x.posPct) : null, relativeVolume: r2(x.rvol), dayHigh: x.high, dayLow: x.low, setups: x.signals.map(sg => sg.name + " (" + sg.detail + ")") })))}
Reply with ONLY JSON: {"summary": "1-2 sentences", "best": [{"symbol": "...", "setup": "...", "why": "...", "plan": "trigger, stop and target from the board's levels"}], "avoid": [{"symbol": "...", "why": "..."}], "waitIf": "when to stand aside"}`, { modelTier: "complex", cache: false });
        aiOut.replaceChildren(h("div", { class: "aicard" }, h("p", {}, r.summary), (r.best || []).length ? h("div", {}, h("span", { class: "label" }, "Cleanest now"), h("ul", { class: "small", style: "margin:4px 0 0;padding-left:1.1em;display:grid;gap:4px" }, r.best.slice(0, 2).map(b => h("li", {}, h("strong", {}, b.symbol + " · " + b.setup + ": "), b.why + " ", h("em", {}, b.plan))))) : null,
          (r.avoid || []).length ? MD.ai.list("Leave alone", r.avoid.slice(0, 4).map(a => a.symbol + ": " + a.why)) : null, r.waitIf ? h("p", { class: "small muted" }, "Stand aside if: " + r.waitIf) : null, h("p", { class: "tiny muted" }, "Claude's read of the measured board · " + new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) + ". Not advice.")));
      } catch (e) { aiOut.replaceChildren(U.errorBox({ message: MD.ai.errText(e) })); }
      aiBtn.disabled = false;
    } }, "AI: which setup is cleanest now?");
    async function refresh(quiet) {
      const syms = get(); stamp.textContent = "Updating…";
      const rows = await Promise.all(syms.map(s => boardRow(app, s).catch(e => ({ symbol: s, error: U.errorText(e) })))); lastRows = rows;
      // A signal that wasn't there at the last refresh pops a notice.
      if (seen && !quiet && app.settings.notify && app.settings.notify.toasts !== false) for (const r of rows) { if (!r.signals) continue; const fresh = r.signals.filter(x => x.side !== "neutral" && !(seen.get(r.symbol) || []).includes(x.name)); if (fresh.length) U.toast(r.symbol + ": " + fresh.map(x => x.name).join(", "), fresh.map(x => x.detail).join(" · ")); }
      seen = new Map(rows.filter(r => r.signals).map(r => [r.symbol, r.signals.map(x => x.name)]));
      tbl.replaceChildren(U.table([{ t: "Symbol", v: (r) => h("strong", {}, r.symbol) }, { t: "Last", v: (r) => r.error ? h("span", { class: "tiny warn-t" }, r.error) : px(r.last), n: true }, { t: "Change", v: (r) => r.chgPct == null ? "—" : U.chg(r.chgPct), n: true },
        { t: "Gap", v: (r) => r.gapPct == null ? "—" : h("span", { class: r.gapPct > 0 ? "up" : "down", title: r.gapIndicated ? "Indicated by pre-market" : "Open vs previous close" }, pc(r.gapPct) + (r.gapIndicated ? "*" : "")), n: true },
        { t: "Day range", v: (r) => r.posPct == null ? "—" : h("span", { class: "row", style: "gap:6px;align-items:center;justify-content:flex-end" }, h("span", { class: "meter", style: "width:60px" }, h("i", { style: "width:" + Math.max(0, Math.min(100, r.posPct)).toFixed(0) + "%" })), h("span", { class: "tiny num" }, Math.round(r.posPct) + "%")), n: true },
        { t: "RVOL", v: (r) => r.rvol == null ? "—" : r.rvol.toFixed(1) + "×", n: true }, { t: "Signals", v: (r) => r.signals ? signalChips(r.signals.filter(x => x.name !== "Inside the opening range"), D.tzOffsetSec("America/New_York")) : "—" },
        { t: "", v: (r) => h("button", { class: "btn ghost sm", type: "button", "aria-label": "Remove " + r.symbol, onclick: (e) => { e.stopPropagation(); set(get().filter(x => x !== r.symbol)); refresh(true); } }, "×") }], rows, { onRow: (r) => r.asset && load(r.asset) }));
      stamp.textContent = "Updated " + new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) + " · every minute while US markets trade · * gap indicated by pre-market";
    }
    box.append(h("div", { class: "row", style: "gap:6px;flex-wrap:wrap;align-items:center" }, input, addBtn, aiBtn, app.store.cached("watch").length ? h("button", { class: "btn ghost sm", type: "button", onclick: () => { const w = app.store.cached("watch").filter(x => ["stock", "etf"].includes(x.cls)).map(x => x.symbol); set([...new Set(get().concat(w))]); refresh(true); } }, "Add my watchlist") : null), tbl, stamp, aiOut);
    refresh(true);
    const timer = setInterval(() => { if (!document.body.contains(box)) { clearInterval(timer); return; } if (!document.hidden && ["pre", "open", "after"].includes(Q.session().phase)) refresh(false); }, 60000);
    return box;
  }
  // The measured picture without chart series, for prompts and tools.
  function forAI(L) {
    return { signals: (L.signals || []).map(s => s.name + ": " + s.detail), symbol: L.symbol, name: L.name, class: L.cls, session: L.sessionLabel, clock: { phase: L.clock.phase, minutesToClose: L.clock.minutesToClose, minutesToOpen: L.clock.minutesToOpen }, last: L.last, previousClose: L.previousClose, changePct: r2(L.changePct),
      gapPct: r2(L.gapPct), gapIsIndicatedFromPremarket: !!L.gapIndicated, preMarket: L.pre, open: L.open, sessionHigh: L.high, sessionLow: L.low, priorDay: L.prior, atr14: r2(L.atr), atrPct: r2(L.atrPct), rangeUsedOfAtrPct: r2(L.rangeUsedPct),
      vwap: L.vwap, vsVwapPct: r2(L.vsVwapPct), barsAboveVwapPct: r2(L.barsAboveVwapPct), openingRange15: L.or15, openingRange30: L.or30, relativeVolume: r2(L.rvol), volumeToday: L.volumeToday, avgVolume: L.avgVolume,
      gapHistory: L.gapStats, closedAboveOpenPctLastYear: r2(L.closeAboveOpenPct), dailyVolPct: r2(L.dailyVolPct), minutesLeftInSession: L.minutesLeft, pivots: L.pivots, levels: L.levels.map(x => ({ label: x.label, price: x.price, distancePct: r2(x.distancePct) })), sector: L.sector || null, notes: L.notes, sources: L.sources };
  }

  /* ---------- AI day-trade plan (logged as a same-day call and graded at the close) ---------- */
  async function plan(app, L, opts = {}) {
    const s = app.caps.sample; if (!s) throw Object.assign(new Error("Claude isn't available in this view."), { code: "no_sample" });
    const S = MD.ai.session(opts.onLog);
    const isStock = L.cls !== "crypto";
    let mkt = null; { const e = S.step("run", "Reading the market (indices, sectors, rates, dollar, oil)"); try { const P = await MD.brain.pulse(app, {}); mkt = P.rows.filter(r => ["SPY", "QQQ", "IWM", "TLT", "UUP", "USO", "BTC"].includes(r.symbol) || (L.sector && r.kind === "sector")).map(r => ({ symbol: r.symbol, name: r.name, todayPct: r2(r.changePct) })); S.done(e, "ok"); } catch (x) { S.done(e, "fail", " → " + U.errorText(x)); } }
    const lim = await s.limits().catch(() => null);
    const tools = lim && lim.tools ? MD.ai.tools(app, S, isStock ? ["search_news", "explain_move", "base_rates", "earnings_info", "economic_calendar", "market_memory", "search_web"] : ["crypto_news", "search_news", "base_rates", "explain_move", "market_memory", "search_web"]) : undefined;
    const calib = MD.ai.calibrationNote(MD.ai.trackRecord(app, "ai-day"));
    const e = S.step("run", "Claude is building the plan (usually under a minute)");
    const prompt = `You are a disciplined intraday trading analyst. Build a plan for ${L.symbol} (${L.name}) for the rest of the current or next session. ${L.clock.phase === "open" ? "The market is open; " + L.clock.minutesToClose + " minutes to the close." : "The US market is " + L.clock.phase + "."}
Use the measured levels below (computed by the app). ${tools ? "Use 2 to 6 tool calls: news for today's catalyst (search_news or crypto_news), explain_move to see whether the move is the market or the stock, earnings_info or economic_calendar when an event could hit today. Cite only URLs the tools returned." : "Tools are unavailable; rely on the measured data and say so."}
Start from the base rates: a typical name closes above its current price about half the time, so stray far from 50% only with strong evidence (a catalyst, relative volume, trend vs VWAP, how past gaps behaved). Give the probability that it CLOSES this session (or the next one, if closed now) ABOVE the current price ${px(L.last)}. Build at most one long and one short setup with exact trigger, entry, stop and targets taken from the measured levels; a stop must be on the correct side of the entry. "No trade" is a valid answer: list the conditions under which to stay out. Never tell the user to place an order; this is analysis.
${calib}
${MD.ai.contextNote(app)}
${MD.ai.assetNote(app, L.asset)}
${guardNote(app)}
Measured: ${JSON.stringify(forAI(L))}
Market right now: ${JSON.stringify(mkt)}
Reply with ONLY JSON:
{"bias": "long"|"short"|"neutral", "upProbabilityPct": 25-75, "summary": "2-3 sentences", "drivers": ["what is moving it today, with evidence"],
 "setups": [{"side": "long"|"short", "name": "e.g. VWAP reclaim", "trigger": "exact condition", "entry": number, "stop": number, "targets": [number, number], "reachFirstTargetPct": 0-100 (chance it hits the first target before the stop), "invalidation": "..."}],
 "noTradeIf": ["..."], "keyTimes": ["e.g. 10:00 ET consumer confidence"], "risks": ["..."], "confidence": 0-100, "sources": [{"title": "...", "url": "https://..."}]}`;
    const r = await s.json(prompt, Object.assign({ modelTier: "complex", signal: opts.signal }, tools ? { tools } : { cache: false }));
    S.done(e, "ok");
    const P = { symbol: L.symbol, asset: { id: L.asset.id, cls: L.asset.cls, symbol: L.asset.symbol, name: L.asset.name, cgId: L.asset.cgId }, at: Date.now(), last: L.last, session: L.sessionLabel, phase: L.clock.phase,
      bias: ["long", "short", "neutral"].includes(r.bias) ? r.bias : "neutral", upPct: Math.max(25, Math.min(75, Number(r.upProbabilityPct) || 50)), summary: String(r.summary || ""), drivers: (r.drivers || []).slice(0, 5).map(String),
      setups: (Array.isArray(r.setups) ? r.setups : []).slice(0, 2).map(x => {
        const side = x.side === "short" ? "short" : "long", entry = Number(x.entry), stop = Number(x.stop), targets = (Array.isArray(x.targets) ? x.targets : []).map(Number).filter(t => t > 0).slice(0, 3);
        const ok = entry > 0 && stop > 0 && (side === "long" ? stop < entry : stop > entry), rr = ok && targets[0] ? Math.abs(targets[0] - entry) / Math.abs(entry - stop) : null;
        const geo = ok && targets[0] && L.dailyVolPct ? Q.barrierOdds({ entry, stop, target: targets[0], side, dailyVolPct: L.dailyVolPct, minutesLeft: L.minutesLeft || 390 }) : null;
        return { geometryPct: geo ? Math.round(geo.pTarget * 100) : null, side, name: String(x.name || ""), trigger: String(x.trigger || ""), entry, stop, targets, reachFirstTargetPct: x.reachFirstTargetPct == null ? null : Math.max(0, Math.min(100, Number(x.reachFirstTargetPct))), invalidation: String(x.invalidation || ""), valid: ok, rewardRisk: rr, expectancyR: rr != null && x.reachFirstTargetPct != null ? (Number(x.reachFirstTargetPct) / 100) * rr - (1 - Number(x.reachFirstTargetPct) / 100) : null };
      }),
      noTradeIf: (r.noTradeIf || []).slice(0, 5).map(String), keyTimes: (r.keyTimes || []).slice(0, 5).map(String), risks: (r.risks || []).slice(0, 4).map(String), confidence: Math.max(0, Math.min(100, Number(r.confidence) || 0)), sources: S.verify(r.sources), toolCalls: S.calls };
    // Second reader checks the plan against the measured levels.
    const rv = await MD.ai.review(app, { task: "An intraday plan for " + L.symbol, S, signal: opts.signal, facts: forAI(L), items: [{ id: "plan", bias: P.bias, upProbabilityPct: P.upPct, setups: P.setups, drivers: P.drivers }] }).catch(() => null);
    P.probs = { claude: P.upPct };
    if (rv && rv.reviews[0]) {
      const rw = rv.reviews[0]; P.review = rw;
      if (rw.probabilityPct != null) { P.probs.reviewer = Math.round(rw.probabilityPct); P.upPct = Math.round((P.upPct + rw.probabilityPct) / 2); }
      else if (rw.adjustedConfidence != null && rw.adjustedConfidence < P.confidence && P.confidence) P.upPct = Math.round(50 + (P.upPct - 50) * rw.adjustedConfidence / P.confidence);
      if (rw.adjustedConfidence != null && rw.adjustedConfidence < P.confidence) P.confidence = rw.adjustedConfidence;
    }
    const cal = MD.ai.calibrateUp(app, "ai-day", P.upPct); if (cal.applied) { P.calibration = cal; P.upPct = cal.upPct; }
    P.downPct = 100 - P.upPct; P.probs.final = P.upPct;
    // Log the call so the AI's intraday record is scored from the session's close.
    if (!app.demo && L.last > 0 && P.upPct !== 50) {
      const c = Q.session(); let dueAt;
      if (isStock) { const closeMin = c.earlyClose ? 780 : 960; dueAt = c.phase === "open" ? Date.now() + c.minutesToClose * 60e3 : c.phase === "pre" || (c.tradingDay && c.nyMinutes < 570) ? Date.now() + (c.minutesToOpen + closeMin - 570) * 60e3 : Date.now() + (c.minutesToOpen + 390) * 60e3; }
      else dueAt = (Math.floor(Date.now() / 864e5) + 1) * 864e5 - 60e3;
      const f = await app.store.create("forecasts", { assetId: L.asset.id, asset: P.asset, symbol: L.symbol, source: "ai-day", horizonDays: 1, dueAt, priceAtCreation: L.last, currency: "USD", priceSource: L.sources[0] || "latest quote", direction: P.upPct > 50 ? "up" : "down", probability: Math.max(P.upPct, P.downPct) / 100, thesis: P.summary, flatBandPct: 0 }).catch(() => null);
      P.forecastId = f && f.id; P.dueAt = dueAt;
      await app.store.create("dayplans", P).catch(() => {});
    }
    return P;
  }

  /* ---------- earnings this week ---------- */
  // Reports due in the next five sessions from the watchlist, holdings and the 100 largest US companies, each with the
  // options-implied move into the report and the stock's average two-day reaction to its last four reports.
  async function earningsWeek(app, max = 12) {
    const days = []; let t = Date.now();
    while (days.length < 5) { const p = Q.nyParts(new Date(t)); if (p.dow > 0 && p.dow < 6 && !Q.HOLIDAYS.has(p.ymd) && !days.includes(p.ymd)) days.push(p.ymd); t += 864e5; }
    const [cal, big] = await Promise.all([Promise.all(days.map(x => D.calendar.earnings(x).catch(() => []))), D.stocks.screener(0, 100).catch(() => [])]);
    const mine = new Set(app.store.cached("watch").map(w => w.symbol).concat((() => { try { return [...C.buildPositions(app.store.cached("tx")).positions.values()].filter(p => p.qty && p.qty.gt && p.qty.gt(0)).map(p => p.symbol); } catch { return []; } })()));
    const bigMap = new Map(big.map(r => [r.symbol, r])), seen = new Set();
    const rows = cal.flat().filter(e => (mine.has(e.symbol) || bigMap.has(e.symbol)) && !seen.has(e.symbol) && seen.add(e.symbol))
      .map(e => ({ date: e.date, time: e.time, symbol: e.symbol, name: e.name, mine: mine.has(e.symbol), marketCap: (bigMap.get(e.symbol) || {}).marketCap || 0, epsForecast: e.epsForecast }))
      .sort((a, b) => (b.mine - a.mine) || b.marketCap - a.marketCap).slice(0, max);
    await Promise.all(rows.map(async (r, i) => { await new Promise(res => setTimeout(res, i * 150)); try { const m = await MD.earnings.measure(app, { id: "stock:" + r.symbol, cls: "stock", symbol: r.symbol, name: r.name }); Object.assign(r, { implied: m.implied, avgReaction: m.avgAbsReactionPct, beats: m.beats, past: m.past.length, lastSurprisePct: m.past[0] ? m.past[0].surprisePct : null, price: m.price }); } catch (e) { r.error = U.errorText(e); } }));
    for (const r of rows) r.richness = r.implied && r.avgReaction ? r.implied.movePct / r.avgReaction : null;
    return { days, rows };
  }
  function earningsWeekView(app) {
    const box = h("div", { class: "stack" }), out = h("div", { class: "stack" }), ai = h("div", { class: "stack" });
    let week = null;
    const load = h("button", { class: "btn ghost", type: "button", onclick: () => U.async(out, () => earningsWeek(app), (w) => {
      week = w;
      out.append(w.rows.length ? U.table([{ t: "Day", v: (r) => r.date.slice(5) + (r.time ? " · " + r.time.replace(/pre market/i, "before open").replace(/after hours/i, "after close") : "") }, { t: "Company", v: (r) => h("span", { class: "stack", style: "gap:0" }, h("strong", {}, r.symbol + (r.mine ? " ★" : "")), h("span", { class: "tiny muted" }, String(r.name || "").slice(0, 28))) },
        { t: "Options imply", v: (r) => r.implied ? "±" + r.implied.movePct.toFixed(1) + "%" : "—", n: true }, { t: "Past reactions", v: (r) => r.avgReaction != null ? "±" + r.avgReaction.toFixed(1) + "% avg" : "—", n: true },
        { t: "Priced", v: (r) => r.richness == null ? "—" : h("span", { class: r.richness > 1.25 ? "warn-t" : r.richness < 0.8 ? "up" : "" }, r.richness > 1.25 ? "more than usual" : r.richness < 0.8 ? "less than usual" : "about usual") },
        { t: "Beats", v: (r) => r.past ? r.beats + " of " + r.past : "—", n: true }], w.rows, { onRow: (r) => { app.ls.set("stockTab", "earnings"); app.openAsset({ id: "stock:" + r.symbol, cls: "stock", symbol: r.symbol, name: r.name }); } }) : h("div", { class: "empty" }, "No reports from your names or the largest companies in the next five sessions."),
        h("p", { class: "tiny muted" }, "Reports " + w.days[0] + " to " + w.days[w.days.length - 1] + " (Nasdaq calendar). ★ = on your watchlist or held. Options imply = at-the-money straddle to the first expiry after the report; past reactions = average two-day move after the last four reports. Click a row for the stock's earnings tab."),
        h("div", { class: "row", style: "gap:8px" }, aiBtn));
    }, { loading: "Loading the calendar, then each company's options and past reactions…" }) }, "Load this week's reports");
    const aiBtn = h("button", { class: "btn ghost sm", type: "button", disabled: !app.caps.sample, onclick: async () => {
      if (!week) return; aiBtn.disabled = true; ai.replaceChildren(h("div", { class: "skeleton" }, "Reading the week…"));
      try {
        const r = await app.caps.sample.json(`These earnings reports are due this week. For an investor and short-term trader, say which reports matter most (their holdings and watchlist first, marked mine), where the options market prices a bigger or smaller move than the stock's own past reactions, and what to watch. Use only the measured data; do not invent figures.
${MD.ai.contextNote(app)}
Reports: ${JSON.stringify(week.rows.map(x => ({ symbol: x.symbol, day: x.date, time: x.time, mine: x.mine, optionsImpliedMovePct: x.implied ? +x.implied.movePct.toFixed(1) : null, avgPastReactionPct: x.avgReaction != null ? +x.avgReaction.toFixed(1) : null, beatsOfLast4: x.past ? x.beats : null, lastSurprisePct: x.lastSurprisePct })))}
Reply with ONLY JSON: {"summary": "2-3 sentences", "mostImportant": [{"symbol": "...", "why": "..."}], "pricedRich": ["symbols where options price more than usual, with one reason each"], "pricedCheap": ["..."], "watch": ["..."]}`, { modelTier: "complex", cache: false });
        ai.replaceChildren(h("div", { class: "aicard" }, h("p", {}, r.summary), (r.mostImportant || []).length ? MD.ai.list("Matter most", r.mostImportant.map(x => x.symbol + ": " + x.why)) : null, MD.ai.list("Options price more than usual", r.pricedRich), MD.ai.list("Options price less than usual", r.pricedCheap), MD.ai.list("Watch", r.watch), h("p", { class: "tiny muted" }, "Claude's read of the measured table; not advice.")));
      } catch (e) { ai.replaceChildren(U.errorBox({ message: MD.ai.errText(e) })); }
      aiBtn.disabled = false;
    } }, "AI read of the week");
    box.append(h("div", { class: "row", style: "gap:8px;align-items:center;flex-wrap:wrap" }, load, h("span", { class: "tiny muted" }, "About 4 data requests per company; up to 12 companies.")), out, ai);
    return box;
  }

  /* ---------- AI coach for the trade journal ---------- */
  async function coach(app, trades) {
    const s = app.caps.sample; if (!s) throw Object.assign(new Error("Claude isn't available in this view."), { code: "no_sample" });
    const st = Q.tradeStats(trades);
    if (st.n < 5) throw new Error("Log at least 5 closed trades first.");
    const rows = st.rows.map(t => ({ date: t.date, time: t.time, symbol: t.symbol, side: t.side, setup: t.setup, pnl: r2(t.pnl), r: r2(t.r), heldMinutes: t.heldMinutes || null, notes: String(t.notes || "").slice(0, 160) }));
    return s.json(`You are a trading coach reviewing a day trader's own journal. Find what is making and losing them money: by setup, side, time of day, holding time, symbol and position size. Every point must cite trades from the journal (dates and symbols). Be direct and specific; suggest rules that would have helped, and say when the sample is too small to be sure. Never recommend specific trades.
Stats: ${JSON.stringify({ trades: st.n, net: r2(st.net), winRatePct: r2(st.winRatePct), avgWin: r2(st.avgWin), avgLoss: r2(st.avgLoss), profitFactor: r2(st.profitFactor), expectancy: r2(st.expectancy), avgR: r2(st.avgR) })}
Trades: ${JSON.stringify(rows.slice(-150))}
Reply with ONLY JSON: {"summary": "2-3 sentences", "strengths": ["..."], "leaks": [{"pattern": "...", "evidence": "the trades that show it", "fix": "a concrete rule"}], "rules": ["3-5 rules for the next sessions"]}`, { modelTier: "complex", cache: false });
  }

  /* ---------- page ---------- */
  V.daytrade = function (root, app) {
    root.append(MD.marketsHelpers.head("Day Trading", "Measured intraday levels, gappers, position sizing and an AI plan with up/down odds for the rest of the session. Every AI plan is logged and graded at the close, so you can see how good it really is."));
    root.append(h("div", { class: "banner warn" }, h("p", {}, "Day trading is high risk and most day traders lose money. This page measures and explains; it never places orders. Size every trade so a stop-out is a loss you can accept.")));
    const c = Q.session();
    const clock = h("div", { class: "row", style: "gap:8px;flex-wrap:wrap;align-items:center" });
    const paintClock = () => { const k = Q.session(); clock.replaceChildren(h("span", { class: "pill " + (k.phase === "open" ? "ok" : "") }, { open: "Market open", pre: "Pre-market", after: "After-hours", closed: "Market closed" }[k.phase]), h("span", { class: "small muted" }, k.phase === "open" ? k.minutesToClose + " min to the " + k.closeAt + " ET close" + (k.earlyClose ? " (early close)" : "") : k.minutesToOpen != null ? "Opens in " + Math.floor(k.minutesToOpen / 60) + " h " + (k.minutesToOpen % 60) + " min" : ""), h("span", { class: "tiny muted" }, "New York " + k.date)); };
    paintClock(); const clockTimer = setInterval(() => { if (!document.body.contains(clock)) { clearInterval(clockTimer); return; } paintClock(); }, 30000);
    const econ = h("div", { class: "small" });
    U.async(econ, async () => (await D.calendar.economic(c.date)).filter(x => /United States|US/i.test(x.country || "")), (rows) => { econ.replaceChildren(rows.length ? h("div", { class: "row", style: "gap:6px;flex-wrap:wrap" }, rows.slice(0, 10).map(x => h("span", { class: "chip", title: [x.actual && "Actual " + x.actual, x.consensus && "Consensus " + x.consensus, x.previous && "Previous " + x.previous].filter(Boolean).join(" · ") }, x.gmt + " GMT · " + x.event + (x.actual ? " · " + x.actual : "")))) : h("span", { class: "muted" }, "No US economic releases listed for " + c.date + ".")); });
    root.append(U.section("Session", h("div", { class: "stack" }, clock, h("span", { class: "label" }, "US economic releases today (Nasdaq calendar)"), econ)));

    // Scanner
    const scanBox = h("div", { class: "stack" });
    const status = app.ls.get("day.scan", c.phase === "pre" ? "preMarket" : c.phase === "after" ? "afterHours" : "currentMarket");
    const SEG = { "Pre-market": "preMarket", "Regular": "currentMarket", "After-hours": "afterHours" }, segOf = (st) => Object.keys(SEG).find(k => SEG[k] === st) || "Regular";
    const segBox = h("div", {}), paintSeg = (st) => segBox.replaceChildren(U.seg(Object.keys(SEG), segOf(st), (k) => { app.ls.set("day.scan", SEG[k]); paintSeg(SEG[k]); paintScan(SEG[k]); }));
    paintSeg(status);
    const min5 = h("input", { type: "checkbox", checked: app.ls.get("day.min5", true), onchange: () => { app.ls.set("day.min5", min5.checked); paintScan(app.ls.get("day.scan", status)); } });
    const paintScan = (st) => U.async(scanBox, () => D.stocks.movers(st), (m) => {
      const f = (rows) => rows.filter(r => !min5.checked || r.price >= 5).slice(0, 10);
      const tbl = (title, rows, vol) => h("div", { class: "stack", style: "gap:4px;min-width:0" }, h("span", { class: "label" }, title), U.table([{ t: "Symbol", v: (r) => h("strong", {}, r.symbol) }, { t: "Last", v: (r) => px(r.price), n: true }, vol ? { t: "Volume", v: (r) => r.volume ? C.fmtNum(r.volume / 1e6, 1) + "M" : "—", n: true } : { t: "Change", v: (r) => U.chg(r.changePct), n: true }], rows, { onRow: (r) => load({ id: "stock:" + r.symbol, cls: "stock", symbol: r.symbol, name: r.name }) }));
      scanBox.replaceChildren(h("div", { class: "grid g3" }, tbl("Gainers", f(m.gainers.rows)), tbl("Losers", f(m.losers.rows)), tbl("Most active", f(m.active.rows), true)), h("p", { class: "tiny muted" }, "Nasdaq market movers" + (m.asOf ? " · " + m.asOf : "") + ". Outside a session's hours Nasdaq shows the last one. Click a row to load it."));
    });
    const watch = app.store.cached("watch").filter(w => ["stock", "etf", "crypto"].includes(w.cls || String(w.assetId || w.id || "").split(":")[0])).slice(0, 16);
    root.append(U.section("Gappers & movers", h("div", { class: "stack" }, h("div", { class: "row between", style: "flex-wrap:wrap;gap:8px" }, segBox, h("label", { class: "chk small" }, min5, "Only $5+ stocks")), scanBox,
      watch.length ? h("div", { class: "row", style: "gap:6px;flex-wrap:wrap" }, h("span", { class: "label" }, "Your watchlist"), watch.map(w => h("button", { class: "chip", type: "button", onclick: () => load(w.asset || { id: w.assetId, cls: w.cls, symbol: w.symbol, name: w.name, cgId: w.cgId }) }, w.symbol))) : null)));
    paintScan(status);

    root.append(U.section("Watch board", boardView(app, (a) => load(a))));
    root.append(U.section("Earnings this week", earningsWeekView(app)));

    // Desk
    const input = h("input", { type: "text", placeholder: "Ticker or coin (e.g. NVDA, SPY, BTC)", "aria-label": "Symbol", style: "max-width:240px" });
    const loadBtn = h("button", { class: "btn", type: "button", onclick: async () => { const v = input.value.trim(); if (!v) return; try { load(await MD.ai.findAsset(v.toUpperCase().length <= 6 ? v.toUpperCase() : v)); } catch (e) { U.toast("Not found", U.errorText(e), true); } } }, "Load");
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") loadBtn.click(); });
    const desk = h("div", { class: "stack" });
    root.append(U.section("Day-trade desk", h("div", { class: "stack" }, h("div", { class: "row", style: "gap:8px;flex-wrap:wrap" }, input, loadBtn), desk)));
    function load(asset) { app.ctx.daytrade = { asset }; app.ls.set("ctx", app.ctx); input.value = asset.symbol || ""; renderDesk(desk, app, asset); desk.scrollIntoView({ behavior: "smooth", block: "start" }); }
    const cur = app.ctx.daytrade && app.ctx.daytrade.asset;
    if (cur) { input.value = cur.symbol || ""; renderDesk(desk, app, cur); } else desk.append(h("div", { class: "empty" }, "Load a symbol to see its levels, VWAP, opening range, relative volume and an AI plan."));

    // Record of AI plans and the journal
    root.append(U.section("AI day-trade record", recordView(app)));
    root.append(U.section("Your trade journal", journalView(app)));
  };

  function kpi(label, v, s, cls) { return h("div", { class: "kpi" }, h("span", { class: "label" }, label), h("b", { class: "v " + (cls || "") }, v), s ? h("span", { class: "s" }, s) : null); }
  function renderDesk(desk, app, asset) {
    U.async(desk, () => levels(app, asset), (L) => {
      const chartBox = h("div", { class: "chartbox", style: "height:320px" });
      const sizerBox = h("div", {}), planBox = h("div", { class: "stack" });
      const lastEl = h("b", { class: "v num" }, px(L.last));
      desk.replaceChildren(
        h("div", { class: "row between", style: "flex-wrap:wrap;gap:8px" }, h("div", { class: "stack", style: "gap:2px" }, h("h2", { style: "font-size:1.2rem" }, L.symbol + " · " + (L.name || "")), h("span", { class: "small muted" }, L.sessionLabel + (L.sector ? " · " + L.sector + (L.industry ? " / " + L.industry : "") : ""))),
          h("div", { class: "row", style: "gap:6px" }, h("button", { class: "btn ghost sm", type: "button", onclick: () => renderDesk(desk, app, asset) }, "Refresh"), h("button", { class: "btn ghost sm", type: "button", onclick: () => app.openAsset(asset) }, "Asset page"), h("button", { class: "btn ghost sm", type: "button", onclick: () => MD.askAI.open(app, "Day-trade read on " + L.symbol + ": what matters for the rest of the session?") }, "Ask AI"))),
        h("div", { class: "kpis k4" }, h("div", { class: "kpi" }, h("span", { class: "label" }, "Last"), lastEl, h("span", { class: "s" }, pc(L.changePct) + " vs previous close")),
          kpi("Gap", pc(L.gapPct), L.cls === "crypto" ? "crypto has no session gap" : L.gapIndicated ? "indicated by pre-market" : "open vs previous close", L.gapPct > 0 ? "up" : L.gapPct < 0 ? "down" : ""),
          kpi("Range used", L.rangeUsedPct == null ? "—" : L.rangeUsedPct.toFixed(0) + "% of ATR", "ATR(14) " + px(L.atr) + (L.atrPct ? " (" + L.atrPct.toFixed(1) + "%)" : "")),
          kpi("Relative volume", L.rvol == null ? "—" : L.rvol.toFixed(1) + "×", L.cls === "crypto" ? "vs 30-day average, time-adjusted" : "vs average day by this time"),
          kpi("vs VWAP", L.vsVwapPct == null ? "—" : pc(L.vsVwapPct), L.vwap ? "VWAP " + px(L.vwap.value) + (L.barsAboveVwapPct != null ? " · " + L.barsAboveVwapPct.toFixed(0) + "% of bars above" : "") : "needs volume bars", L.vsVwapPct > 0 ? "up" : L.vsVwapPct < 0 ? "down" : ""),
          kpi("Opening range (15 min)", L.or15 ? px(L.or15.low) + " – " + px(L.or15.high) : "—", L.or15 && !L.or15.complete ? "still forming" : L.or30 ? "30 min: " + px(L.or30.low) + " – " + px(L.or30.high) : null),
          kpi("Pre-market", L.pre ? px(L.pre.low) + " – " + px(L.pre.high) : "—", L.pre ? "last " + px(L.pre.last) : L.cls === "crypto" ? "not applicable" : "no pre-market trades"),
          kpi("Closed above open", L.closeAboveOpenPct == null ? "—" : L.closeAboveOpenPct.toFixed(0) + "% of days", "last 12 months")),
        h("div", { class: "stack", style: "gap:4px" }, h("span", { class: "label" }, "Setups measured now"), signalChips(L.signals, L.shift)),
        L.gapStats && L.gapStats.n ? h("p", { class: "small" }, h("strong", {}, "Gaps like today's: "), "of " + L.gapStats.n + " past " + (L.gapPct > 0 ? "gap-ups" : "gap-downs") + " of " + L.gapStats.thresholdPct + "% or more in the last year, " + L.gapStats.fillPct + "% filled the same day and " + L.gapStats.closeAboveOpenPct + "% closed above the open (average open-to-close " + pc(L.gapStats.avgOpenToClosePct) + ").") : null,
        chartBox,
        h("details", { open: true }, h("summary", { class: "label", style: "cursor:pointer" }, "Key levels (" + L.levels.length + ")"), U.table([{ t: "Level", v: "label" }, { t: "Price", v: (r) => px(r.price), n: true }, { t: "Distance", v: (r) => r.distancePct == null ? "—" : h("span", { class: r.distancePct > 0 ? "up" : r.distancePct < 0 ? "down" : "" }, pc(r.distancePct)), n: true },
          { t: "Alert", v: (r) => h("button", { class: "btn ghost sm levelalert", type: "button", "aria-label": "Alert at " + r.label, onclick: () => MD.common.alertModal(asset, { price: L.last, currency: "USD" }, { kind: r.price >= L.last ? "above" : "below", threshold: +r.price.toPrecision(6), note: "Day trading: " + (r.price >= L.last ? "breaks above " : "breaks below ") + r.label }) }, "🔔") }], L.levels)),
        L.notes.length ? h("p", { class: "small warn-t" }, L.notes.join(" ")) : null,
        h("p", { class: "tiny muted" }, "Sources: " + L.sources.join(" · ") + ". Times in " + L.tz + ". Pivots are classic floor pivots from the prior day; relative volume uses a typical intraday volume curve."),
        U.section("Position size", sizerBox), U.section("AI plan for the session", planBox));
      // Chart: price (minute data), VWAP and the main levels.
      if (L.series.length > 1) {
        const ch = U.chart(chartBox, { kind: "line", points: L.series.map(p => ({ time: p.time + L.shift, value: p.value })), intraday: true }, { fmt: px });
        if (ch && ch.chart) {
          if (L.vwapSeries.length) { const s = ch.chart.addLineSeries({ color: U.tok("--accent-2") || U.tok("--accent"), lineWidth: 2, lastValueVisible: false, priceLineVisible: false }); s.setData(L.vwapSeries.map(p => ({ time: p.time + L.shift, value: p.value }))); }
          for (const lv of L.levels.filter(x => ["Previous close", "Prior day high", "Prior day low", "Pre-market high", "Pre-market low", "15-min opening range high", "15-min opening range low"].includes(x.label))) ch.main.createPriceLine({ price: lv.price, color: U.tok("--muted"), lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: lv.label.replace("15-min opening range", "OR").replace("Pre-market", "PM").replace("Prior day", "PD").replace("Previous close", "Prev close") });
          if (L.clock.phase === "open" || L.cls === "crypto") {
            const t = setInterval(async () => { if (!document.body.contains(chartBox)) { clearInterval(t); return; } if (document.hidden) return; try { const q = await app.quote(asset, 10000); if (q && q.price) { lastEl.textContent = px(q.price); ch.update({ time: Math.floor(Date.now() / 60000) * 60 + L.shift, value: q.price }); } } catch {} }, 15000);
          }
        }
      } else chartBox.replaceChildren(h("div", { class: "empty" }, "No intraday prices to chart yet."));
      sizer(sizerBox, app, L);
      planView(planBox, app, L, sizerBox);
    }, { loading: "Loading intraday prices, volume bars and a year of daily history…" });
  }

  function sizer(box, app, L, preset) {
    const get = (k, d) => app.ls.get("day." + k, d);
    const f = { account: h("input", { type: "number", min: 0, step: "100", value: get("account", 25000) }), risk: h("input", { type: "number", min: 0.05, step: "0.05", value: get("risk", 0.5) }), maxpos: h("input", { type: "number", min: 1, step: "1", value: get("maxpos", 25) }),
      side: h("select", {}, ["long", "short"].map(s => h("option", { value: s, selected: (preset ? preset.side : "long") === s }, s === "long" ? "Long" : "Short"))),
      entry: h("input", { type: "number", step: "0.01", value: preset ? preset.entry : L.last ? +L.last.toPrecision(6) : "" }), stop: h("input", { type: "number", step: "0.01", value: preset ? preset.stop : L.vwap && L.last > L.vwap.value ? +L.vwap.value.toPrecision(6) : L.or15 ? +L.or15.low.toPrecision(6) : "" }), target: h("input", { type: "number", step: "0.01", value: preset && preset.targets[0] ? preset.targets[0] : "" }) };
    const out = h("div", { class: "stack" });
    const calc = () => {
      app.ls.set("day.account", Number(f.account.value)); app.ls.set("day.risk", Number(f.risk.value)); app.ls.set("day.maxpos", Number(f.maxpos.value));
      const r = Q.positionSize({ account: f.account.value, riskPct: f.risk.value, entry: f.entry.value, stop: f.stop.value, target: f.target.value, side: f.side.value, maxPositionPct: f.maxpos.value });
      if (!r) { out.replaceChildren(h("p", { class: "small muted" }, "Enter the account size, risk per trade, entry and stop.")); return; }
      if (r.error) { out.replaceChildren(h("p", { class: "small warn-t" }, r.error)); return; }
      const stopAtr = L.atr ? Math.abs(f.entry.value - f.stop.value) / L.atr * 100 : null;
      const g = guardFor(app), guard = g.stop ? h("div", { class: "banner err" }, h("p", {}, "Your daily rules say stop for today (" + g.reasons.join(", ") + ")."))
        : g.lossLeft != null && r.dollarsAtRisk > g.lossLeft ? h("div", { class: "banner warn" }, h("p", {}, "This trade risks " + U.money(r.dollarsAtRisk, "USD") + " but only " + U.money(g.lossLeft, "USD") + " is left before today's loss limit; " + Math.floor(g.lossLeft / r.perShareRisk) + " shares would keep you inside it.")) : null;
      const odds = f.target.value && L.dailyVolPct ? Q.barrierOdds({ entry: f.entry.value, stop: f.stop.value, target: f.target.value, side: f.side.value, dailyVolPct: L.dailyVolPct, minutesLeft: L.minutesLeft || 390 }) : null;
      out.replaceChildren(guard || "", h("div", { class: "kpis k4" }, kpi("Shares", String(r.shares), r.cappedBySize ? "capped by max position size" : "from risk per trade"), kpi("At risk", U.money(r.dollarsAtRisk, "USD"), C.fmtNum(r.perShareRisk, 2) + " a share"), kpi("Position", U.money(r.positionValue, "USD"), r.positionPct.toFixed(0) + "% of the account"), kpi("Reward : risk", r.rewardRisk == null ? "—" : r.rewardRisk.toFixed(2) + " R", r.targetOnWrongSide ? "target is on the wrong side" : r.dollarsAtTarget ? U.money(r.dollarsAtTarget, "USD") + " at target" : null)),
        h("p", { class: "small muted" }, "1R / 2R / 3R targets: " + r.targets.map(t => px(t.price)).join(" / ") + (stopAtr != null ? ". The stop is " + stopAtr.toFixed(0) + "% of a normal day's range (ATR)" + (stopAtr < 10 ? ", tight enough that ordinary noise may hit it" : "") + "." : ".") + " Fees and slippage not included."),
        odds ? h("p", { class: "small" }, h("strong", {}, "Geometry alone: "), Math.round(odds.pTarget * 100) + "% chance the target comes before the stop" + (L.minutesLeft ? " by the close" : " in a full session") + ", " + Math.round(odds.pStop * 100) + "% stop first, " + Math.round(odds.pNeither * 100) + "% neither; expectancy " + (() => { const x = odds.pTarget * odds.rr - odds.pStop; return (x > 0 ? "+" : "") + x.toFixed(2); })() + " R. ", h("span", { class: "muted" }, "A random walk with " + (L.dailyVolPct ? L.dailyVolPct.toFixed(1) + "%" : "—") + " daily volatility over " + odds.minutes + " minutes: no trend or news, so a setup needs an edge beyond this to be worth taking.")) : null);
    };
    for (const el of Object.values(f)) el.addEventListener("input", calc);
    f.side.addEventListener("change", calc);
    box.replaceChildren(h("div", { class: "stack" }, h("div", { class: "form" }, U.field("Account size ($)", f.account), U.field("Risk per trade (%)", f.risk), U.field("Max position (% of account)", f.maxpos), U.field("Side", f.side), U.field("Entry", f.entry), U.field("Stop", f.stop), U.field("Target (optional)", f.target)), out));
    calc();
  }

  function planView(box, app, L, sizerBox) {
    const log = MD.ai.logBox(), out = h("div", { class: "stack" }), phase = h("span", { class: "small muted" });
    const prev = app.store.cached("dayplans").filter(p => p.symbol === L.symbol).sort((a, b) => b.at - a.at)[0];
    const show = (P) => out.replaceChildren(planCard(app, P, L, sizerBox));
    if (prev && Date.now() - prev.at < 6 * 3600e3) show(prev);
    const btn = h("button", { class: "btn", type: "button", onclick: async () => {
      btn.disabled = true; log.clear(); phase.textContent = "Working…";
      try { const P = await plan(app, L, { onLog: (e) => log.add(e) }); show(P); phase.textContent = app.demo ? "Done (demo: not logged)" : "Done · logged; graded at the close"; }
      catch (e) { phase.textContent = MD.ai.errText(e); }
      btn.disabled = false;
    } }, prev ? "New AI plan" : "Build an AI plan");
    box.replaceChildren(h("div", { class: "row", style: "gap:8px;align-items:center;flex-wrap:wrap" }, btn, phase), h("p", { class: "tiny muted" }, "Claude reads today's news and the measured levels, gives the chance of closing above the current price, and at most one long and one short setup; a second pass checks it. Logged in the forecast journal and scored from the closing price."), out, h("details", {}, h("summary", { class: "label" }, "Research steps"), log));
  }
  function planCard(app, P, L, sizerBox) {
    const bcls = P.bias === "long" ? "positive" : P.bias === "short" ? "negative" : "neutral";
    return h("div", { class: "card" }, h("div", { class: "bd stack" },
      h("div", { class: "row between", style: "flex-wrap:wrap;gap:8px" }, h("span", { class: "verdict " + bcls }, P.bias === "long" ? "Bias: long" : P.bias === "short" ? "Bias: short" : "Bias: neutral / no edge"), h("span", { class: "tiny muted" }, U.fmtTs(P.at) + " · price then " + px(P.last) + " · confidence " + P.confidence + "/100")),
      probBar(P.upPct, "Closes above " + px(P.last), "Closes below"),
      P.probs ? h("p", { class: "tiny muted" }, "Claude " + P.probs.claude + "%" + (P.probs.reviewer != null ? " · reviewer's own estimate " + P.probs.reviewer + "%" : "") + (P.calibration ? " · calibrated from " + P.calibration.scored + " graded plans: " + P.probs.final + "%" : "") + " · final " + P.upPct + "%") : null,
      h("p", {}, P.summary), MD.ai.list("What's moving it", P.drivers),
      P.setups.length ? h("div", { class: "grid g2" }, P.setups.map(s => h("div", { class: "bb " + (s.side === "long" ? "up" : "down") }, h("span", { class: "label" }, (s.side === "long" ? "Long" : "Short") + " · " + s.name), h("p", { class: "small" }, s.trigger),
        h("p", { class: "small num" }, "Entry " + px(s.entry) + " · stop " + px(s.stop) + " · targets " + s.targets.map(px).join(" / ")), s.valid ? h("p", { class: "tiny muted" }, (s.rewardRisk != null ? s.rewardRisk.toFixed(2) + " R to the first target" : "") + (s.reachFirstTargetPct != null ? " · Claude: " + s.reachFirstTargetPct + "% chance of reaching it before the stop" : "") + (s.geometryPct != null ? " · geometry alone: " + s.geometryPct + "%" : "") + (s.expectancyR != null ? " · expectancy " + (s.expectancyR > 0 ? "+" : "") + s.expectancyR.toFixed(2) + " R" : "")) : h("p", { class: "tiny warn-t" }, "The stop is on the wrong side of the entry; ignore this setup."),
        s.invalidation ? h("p", { class: "tiny" }, "Invalidated if: " + s.invalidation) : null, s.valid ? h("button", { class: "btn ghost sm", type: "button", onclick: () => { sizer(sizerBox, app, L, s); sizerBox.scrollIntoView({ behavior: "smooth", block: "center" }); } }, "Size this setup") : null))) : h("p", { class: "small" }, "No setup worth taking."),
      MD.ai.list("Stay out if", P.noTradeIf), MD.ai.list("Key times", P.keyTimes), MD.ai.list("Risks", P.risks), MD.ai.reviewBadge(P.review), MD.ai.sources(P.sources),
      P.dueAt ? h("p", { class: "tiny muted" }, "Logged in the forecast journal; graded from the close on " + new Date(P.dueAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ".") : null));
  }
  function probBar(up, upLabel, downLabel) {
    return h("div", { class: "probbar", role: "img", "aria-label": upLabel + " " + up + "%, " + downLabel + " " + (100 - up) + "%" }, h("div", { class: "pb-up", style: "width:" + up + "%" }, "▲ " + up + "%"), h("div", { class: "pb-down", style: "width:" + (100 - up) + "%" }, (100 - up) + "% ▼"), h("span", { class: "pb-l tiny" }, upLabel), h("span", { class: "pb-r tiny" }, downLabel));
  }

  function recordView(app) {
    const tr = MD.ai.trackRecord(app, "ai-day"), plans = app.store.cached("dayplans").slice().sort((a, b) => b.at - a.at), evals = app.store.cached("evals");
    if (!plans.length) return h("div", { class: "empty" }, "No AI plans yet. Each plan's call (closes above or below the price at the time) is graded at the close and shown here.");
    return h("div", { class: "stack" }, h("div", { class: "kpis k4" }, kpi("Plans logged", String(tr.logged)), kpi("Graded", String(tr.scored)), kpi("Calls right", tr.hitPct != null ? tr.hitPct.toFixed(0) + "%" : "—"), kpi("Brier", tr.brier != null ? tr.brier.toFixed(3) : "—", "0.25 = coin flip")),
      U.dataTable([{ t: "When", v: (p) => U.fmtTs(p.at), sort: (p) => p.at }, { t: "Symbol", v: "symbol" }, { t: "Bias", v: "bias" }, { t: "Up odds", v: (p) => p.upPct + "%", n: true }, { t: "Price then", v: (p) => px(p.last), n: true },
        { t: "Result", v: (p) => { const e = p.forecastId && evals.find(x => x.forecastId === p.forecastId); return e ? h("span", { class: e.directionHit ? "up" : "down" }, (e.directionHit ? "Right" : "Wrong") + " · close " + px(e.priceAtDue)) : h("span", { class: "muted" }, p.dueAt && p.dueAt > Date.now() ? "Graded after the close" : "Waiting for the close"); } }], plans, { key: "day.plans", sort: [0, -1], noun: "plans", filter: false }),
      h("p", { class: "tiny muted" }, "A call is right when the session closes on the side of the price-at-plan that the plan favoured. The record is given to every new plan so its odds stay calibrated."));
  }

  /* Your own daily rules (loss limit, trade cap, losing streak) against today's logged trades. Read-only: the desk
     never places or blocks trades. */
  const localDate = () => new Date().toLocaleDateString("en-CA");
  function guardFor(app) { const get = (k, d) => app.ls.get("day." + k, d); return Q.riskGuard({ trades: app.store.cached("daytrades"), date: localDate(), account: get("account", 25000), maxLossPct: get("maxloss", 2), maxTrades: get("maxtrades", 6), maxLosingStreak: get("maxstreak", 3) }); }
  function guardNote(app) {
    const g = guardFor(app); if (!g.trades) return "";
    return "The trader's own risk rules today: P&L " + g.pnl.toFixed(0) + " USD over " + g.trades + " trades, losing streak " + g.streak + (g.lossLeft != null ? ", " + g.lossLeft.toFixed(0) + " USD left before their daily loss limit" : "") + (g.tradesLeft != null ? ", " + g.tradesLeft + " trades left" : "") + "." + (g.stop ? " Their rules say to STOP for today (" + g.reasons.join(", ") + "): say plainly that the disciplined plan is to sit out, and keep any setup for a later session." : "");
  }
  function guardPanel(app, onChange) {
    const get = (k, d) => app.ls.get("day." + k, d), g = guardFor(app);
    const inp = (k, d, step) => { const el = h("input", { type: "number", min: 0, step, value: get(k, d) }); el.addEventListener("change", () => { app.ls.set("day." + k, Number(el.value) || 0); onChange(); }); return el; };
    return h("div", { class: "stack", id: "risk-guard" },
      g.stop ? h("div", { class: "banner err" }, h("p", {}, h("strong", {}, "Your rules say stop for today: "), g.reasons.join(", ") + ".")) : null,
      h("div", { class: "kpis k4" },
        kpi("Today's P&L", U.money(g.pnl, "USD"), g.trades + " trade" + (g.trades === 1 ? "" : "s") + " logged for " + g.date, g.pnl > 0 ? "up" : g.pnl < 0 ? "down" : ""),
        kpi("Loss left today", g.limit == null ? "—" : U.money(g.lossLeft, "USD"), g.limit == null ? "no daily limit set" : "of a " + U.money(g.limit, "USD") + " daily limit", g.limit != null && g.lossLeft < g.limit * 0.34 ? "down" : ""),
        kpi("Trades left", g.tradesLeft == null ? "no cap" : String(g.tradesLeft), "cap " + (get("maxtrades", 6) || "none")),
        kpi("Losing streak", String(g.streak), get("maxstreak", 3) ? "stop after " + get("maxstreak", 3) + " in a row" : "no streak rule", g.streak >= 2 ? "down" : "")),
      h("div", { class: "form" }, U.field("Max daily loss (% of account)", inp("maxloss", 2, "0.25")), U.field("Max trades a day", inp("maxtrades", 6, "1")), U.field("Stop after losses in a row", inp("maxstreak", 3, "1"))),
      h("p", { class: "tiny muted" }, "From the trades you log below for today (your local date) and the account size in the position sizer; 0 turns a rule off. Gains don't raise the loss limit. The desk never places or blocks trades: these are your own rules, kept in view."));
  }

  function journalView(app) {
    const box = h("div", { class: "stack" });
    const paint = () => {
      const trades = app.store.cached("daytrades").slice().sort((a, b) => String(b.date + b.time).localeCompare(String(a.date + a.time)));
      const st = Q.tradeStats(trades);
      const f = { date: h("input", { type: "date", value: localDate() }), time: h("input", { type: "time", value: "09:45" }), symbol: h("input", { type: "text", placeholder: "NVDA", style: "max-width:110px" }), side: h("select", {}, h("option", { value: "long" }, "Long"), h("option", { value: "short" }, "Short")),
        shares: h("input", { type: "number", min: 0, step: "1" }), entry: h("input", { type: "number", step: "0.01" }), exit: h("input", { type: "number", step: "0.01" }), stop: h("input", { type: "number", step: "0.01" }), held: h("input", { type: "number", min: 0, step: "1", placeholder: "min" }),
        setup: h("select", {}, SETUPS.map(s => h("option", { value: s }, s))), fees: h("input", { type: "number", min: 0, step: "0.01", value: 0 }), notes: h("input", { type: "text", placeholder: "What you saw, why you exited" }) };
      const add = h("button", { class: "btn", type: "button", onclick: async () => {
        const t = { date: f.date.value, time: f.time.value, symbol: f.symbol.value.trim().toUpperCase(), side: f.side.value, shares: Number(f.shares.value), entry: Number(f.entry.value), exit: Number(f.exit.value), stop: Number(f.stop.value) || null, heldMinutes: Number(f.held.value) || null, setup: f.setup.value, fees: Number(f.fees.value) || 0, notes: f.notes.value };
        if (!t.symbol || !(t.shares > 0) || !(t.entry > 0) || !(t.exit > 0)) { U.toast("Fill in symbol, shares, entry and exit", null, true); return; }
        if (app.demo) { U.toast("Demo mode: not saved"); return; }
        await app.store.create("daytrades", t); paint();
      } }, "Add trade");
      const coachBox = h("div", { class: "stack" }), cbtn = h("button", { class: "btn ghost sm", type: "button", disabled: st.n < 5 || !app.caps.sample, onclick: async () => {
        cbtn.disabled = true; coachBox.replaceChildren(h("p", { class: "small muted" }, "Reviewing your trades…"));
        try { const r = await coach(app, trades); coachBox.replaceChildren(h("div", { class: "card" }, h("div", { class: "bd stack" }, h("p", {}, r.summary), MD.ai.list("Working", r.strengths), (r.leaks || []).length ? h("div", {}, h("span", { class: "label" }, "Leaks"), h("ul", { class: "small", style: "margin:4px 0 0;padding-left:1.1em;display:grid;gap:4px" }, r.leaks.map(l => h("li", {}, h("strong", {}, l.pattern + ". "), l.evidence + " ", h("em", {}, "Fix: " + l.fix))))) : null, MD.ai.list("Rules for next sessions", r.rules)))); }
        catch (e) { coachBox.replaceChildren(U.errorBox({ message: MD.ai.errText(e) })); }
        cbtn.disabled = st.n < 5;
      } }, "AI coach: what's working and what isn't");
      box.replaceChildren(
        h("h3", { class: "label" }, "Today's risk limits"), guardPanel(app, paint),
        h("h3", { class: "label" }, "Log a trade"),
        h("div", { class: "form" }, U.field("Date", f.date), U.field("Time (ET)", f.time), U.field("Symbol", f.symbol), U.field("Side", f.side), U.field("Shares", f.shares), U.field("Entry", f.entry), U.field("Exit", f.exit), U.field("Stop (for R)", f.stop), U.field("Held (min)", f.held), U.field("Setup", f.setup), U.field("Fees", f.fees), U.field("Notes", f.notes), h("div", { class: "field" }, add)),
        st.n ? h("div", { class: "kpis k4" }, kpi("Net P&L", U.money(st.net, "USD"), st.n + " trades", st.net >= 0 ? "up" : "down"), kpi("Win rate", st.winRatePct.toFixed(0) + "%", "avg win " + U.money(st.avgWin, "USD") + " · avg loss " + U.money(st.avgLoss, "USD")), kpi("Profit factor", st.profitFactor == null ? "—" : st.profitFactor.toFixed(2), "gross wins ÷ gross losses"), kpi("Expectancy", U.money(st.expectancy, "USD") + " / trade", st.avgR != null ? "average " + st.avgR.toFixed(2) + " R" : "add stops to see R")) : null,
        st.n ? U.dataTable([{ t: "Date", v: (t) => t.date + " " + (t.time || ""), sort: (t) => t.date + (t.time || "") }, { t: "Symbol", v: "symbol" }, { t: "Side", v: "side" }, { t: "Setup", v: (t) => t.setup || "—" }, { t: "Shares", v: (t) => String(t.shares), n: true }, { t: "Entry → exit", v: (t) => px(t.entry) + " → " + px(t.exit), n: true }, { t: "P&L", v: (t) => h("span", { class: t.pnl >= 0 ? "up" : "down" }, U.money(t.pnl, "USD")), sort: (t) => t.pnl, n: true }, { t: "R", v: (t) => t.r == null ? "—" : t.r.toFixed(2), sort: (t) => t.r, n: true },
          { t: "", v: (t) => h("button", { class: "btn ghost sm", type: "button", "aria-label": "Delete trade", onclick: async (e) => { e.stopPropagation(); await app.store.remove("daytrades", t.id); paint(); } }, "Delete") }], st.rows, { key: "day.journal", sort: [0, -1], noun: "trades" }) : h("div", { class: "empty" }, "Log the day trades you make (in your own broker) to see your win rate, profit factor and expectancy, and to get AI coaching once you have 5 or more."),
        h("div", { class: "row", style: "gap:8px;align-items:center" }, cbtn, st.n < 5 ? h("span", { class: "tiny muted" }, "Needs 5 trades (" + st.n + " so far)") : null), coachBox);
    };
    paint();
    return box;
  }

  MD.day = { guardFor, guardNote, earningsWeek, levels, forAI, plan, coach, probBar, SETUPS };
})(typeof window !== "undefined" ? window : globalThis);
