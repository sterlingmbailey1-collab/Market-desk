/* Live ticker: polls one asset as fast as the chosen rate allows, one request in flight at a time.
   Every update is a real request (through a connector), so "Fastest" means back-to-back requests,
   typically one to three seconds apart. Pauses while the tab is hidden and backs off on errors. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const D = MD.data;
  const RATES = [["Fastest", 1000], ["5s", 5000], ["15s", 15000], ["60s", 60000], ["Off", 0]];
  function start(asset, handlers) {
    const app = MD.app;
    let rate = app.settings.liveRate ?? 1000, stopped = false, timer = null, inflight = false, errors = 0, lastOk = 0;
    const gaps = [];
    const state = { mode: "starting", avgMs: null, closed: false, error: null, count: 0 };
    const schedule = (ms) => { clearTimeout(timer); if (!stopped) timer = setTimeout(loop, ms); };
    async function loop() {
      if (stopped || inflight) return;
      if (!rate) { state.mode = "off"; handlers.onState && handlers.onState(state); return; }
      if (document.hidden) { state.mode = "paused"; schedule(1000); return; }
      inflight = true; const t0 = Date.now();
      try {
        const q = await D.liveQuote(asset);
        if (stopped) return;
        errors = 0; state.error = null; state.mode = "live"; state.count++;
        if (lastOk) { gaps.push(Date.now() - lastOk); if (gaps.length > 15) gaps.shift(); state.avgMs = gaps.reduce((a, b) => a + b, 0) / gaps.length; }
        lastOk = Date.now();
        state.closed = q.marketOpen === false;
        handlers.onTick(q);
      } catch (e) {
        if (stopped) return;
        errors++; state.mode = "error"; state.error = e;
        if (e && (e.code === "unavailable" || e.code === "no_mcp")) { rate = 0; state.mode = "error"; }
      } finally { inflight = false; }
      handlers.onState && handlers.onState(state);
      let wait = Math.max(rate <= 1000 ? 150 : 0, rate - (Date.now() - t0));
      if (errors) wait = Math.min(60000, Math.max(rate, 2000) * Math.pow(2, Math.min(errors, 5)));
      if (state.closed) wait = Math.max(wait, 60000);
      if (rate) schedule(wait);
    }
    const ctl = {
      state,
      stop() { stopped = true; clearTimeout(timer); },
      setRate(ms) { rate = ms; gaps.length = 0; lastOk = 0; state.avgMs = null; if (!ms) { clearTimeout(timer); state.mode = "off"; } else if (!inflight) loop(); }
    };
    loop();
    return ctl;
  }
  MD.live = { RATES, start };
})(typeof window !== "undefined" ? window : globalThis);
