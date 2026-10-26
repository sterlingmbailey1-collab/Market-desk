/* Market Desk storage. Three backends behind one interface:
   - "account": the artifact's db, inside the viewer's private data/users/<id>/ subtree (only they can read it)
   - "browser": localStorage on this device (used when the viewer has no account storage)
   - "demo": in-memory, seeded with clearly fake data; never written anywhere and never mixed with real data
   Append-only collections (ledger, forecasts, evaluations, research) expose create() but no update(). */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const APPEND_ONLY = new Set(["tx", "forecasts", "evals", "reports", "picks", "betpicks", "betgrades", "paper"]);
  const COLLECTIONS = ["settings", "tx", "forecasts", "evals", "reports", "watch", "alerts", "inbox", "tasks", "catalysts", "comps", "assets", "searches", "fxcache", "picks", "notes", "photos", "bets", "betpicks", "betgrades", "follows", "smcache", "smai", "ideas", "aitakes", "briefs", "proppicks", "ailessons", "marketdays", "brain", "dayplans", "daytrades", "pickhide", "marketcalls", "pickchecks", "decisions", "callwatch", "weekly", "paper", "gameplans", "sentiment"];
  const newId = () => Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function memoryBackend(seed) {
    const data = new Map(COLLECTIONS.map(c => [c, new Map()]));
    const subs = new Map(COLLECTIONS.map(c => [c, new Set()]));
    if (seed) for (const [c, docs] of Object.entries(seed)) for (const d of docs) data.get(c).set(d.id, clone(d));
    const fire = (c) => { const list = [...data.get(c).values()].map(clone); for (const f of subs.get(c)) f(list); };
    return {
      kind: "memory",
      async list(c) { return [...data.get(c).values()].map(clone); },
      async get(c, id) { const d = data.get(c).get(id); return d ? clone(d) : null; },
      async set(c, id, doc) { data.get(c).set(id, clone(Object.assign({}, doc, { id }))); fire(c); },
      async del(c, id) { data.get(c).delete(id); fire(c); },
      subscribe(c, f) { subs.get(c).add(f); f([...data.get(c).values()].map(clone)); return () => subs.get(c).delete(f); }
    };
  }

  function localBackend(prefix) {
    const key = (c) => prefix + c;
    const read = (c) => { try { return JSON.parse(localStorage.getItem(key(c)) || "{}"); } catch { return {}; } };
    const write = (c, o) => { try { localStorage.setItem(key(c), JSON.stringify(o)); return true; } catch { return false; } };
    const subs = new Map(COLLECTIONS.map(c => [c, new Set()]));
    const fire = (c) => { const list = Object.values(read(c)); for (const f of subs.get(c)) f(list); };
    let works = true; try { localStorage.setItem(prefix + "_probe", "1"); localStorage.removeItem(prefix + "_probe"); } catch { works = false; }
    return {
      kind: works ? "browser" : "memory-fallback",
      async list(c) { return Object.values(read(c)); },
      async get(c, id) { return read(c)[id] || null; },
      async set(c, id, doc) { const o = read(c); o[id] = Object.assign({}, doc, { id }); if (!write(c, o)) throw Object.assign(new Error("This browser refused to save. Storage may be full or blocked."), { code: "storage_failed" }); fire(c); },
      async del(c, id) { const o = read(c); delete o[id]; write(c, o); fire(c); },
      subscribe(c, f) { subs.get(c).add(f); f(Object.values(read(c))); return () => subs.get(c).delete(f); }
    };
  }

  function dbBackend(db, uid) {
    const root = db.doc("data/users/" + uid + "/md");
    const coll = (c) => root.collection(c);
    return {
      kind: "account",
      // Documents from the artifact db are frozen; deep copies keep the rest of the app free to change them.
      async list(c) { const s = await coll(c).limit(1000).get(); return s.docs.map(d => Object.assign(clone(d.data()), { id: d.id })); },
      async get(c, id) { const s = await coll(c).doc(id).get(); return s.exists ? Object.assign(clone(s.data()), { id }) : null; },
      async set(c, id, doc) { await coll(c).doc(id).set(JSON.parse(JSON.stringify(Object.assign({}, doc, { id })))); },
      async del(c, id) { await coll(c).doc(id).delete(); },
      subscribe(c, f, onErr) { return coll(c).limit(1000).onSnapshot(s => f(s.docs.map(d => Object.assign(clone(d.data()), { id: d.id }))), e => onErr && onErr(e)); }
    };
  }

  function makeStore(backend) {
    const caches = new Map();
    const unsubs = [];
    const watchers = new Map();
    // Apply our own writes to the cache immediately, so reads right after a write see it
    // (the subscription delivers the confirmed state shortly after).
    const local = (c, id, body) => {
      const list = (caches.get(c) || []).filter(d => d.id !== id);
      if (body) list.push(JSON.parse(JSON.stringify(body)));
      caches.set(c, list);
    };
    const store = {
      backend,
      kind: backend.kind,
      newId,
      cached(c) { return caches.get(c) || []; },
      async list(c) { const l = await backend.list(c); caches.set(c, l); return l; },
      get: (c, id) => backend.get(c, id),
      // create-only write; used for every append-only collection
      async create(c, doc) {
        const id = doc.id || newId();
        const body = Object.assign({}, doc, { id, createdAt: doc.createdAt || Date.now() });
        await backend.set(c, id, body);
        local(c, id, body);
        return body;
      },
      async put(c, id, doc) {
        if (APPEND_ONLY.has(c)) throw new Error("'" + c + "' is append-only. Record a correction instead of editing.");
        const body = Object.assign({}, doc, { id, updatedAt: Date.now() });
        await backend.set(c, id, body);
        local(c, id, body);
      },
      async remove(c, id) {
        if (APPEND_ONLY.has(c)) throw new Error("'" + c + "' is append-only and cannot be deleted.");
        await backend.del(c, id);
        local(c, id, null);
      },
      watch(c, f) {
        if (!watchers.has(c)) {
          watchers.set(c, new Set());
          unsubs.push(backend.subscribe(c, (list) => { caches.set(c, list); for (const w of watchers.get(c)) try { w(list); } catch (e) { console.error(e); } }, (e) => console.warn("watch " + c, e)));
        }
        watchers.get(c).add(f);
        if (caches.has(c)) f(caches.get(c));
        return () => watchers.get(c).delete(f);
      },
      close() { for (const u of unsubs) try { u(); } catch {} }
    };
    return store;
  }

  /* Demo data: obviously fictional amounts, flagged on every record. */
  function demoSeed() {
    const t = (o) => Object.assign({ id: newId(), createdAt: Date.now(), source: "demo", demo: true, fees: "0" }, o);
    return {
      tx: [
        t({ type: "buy", tradeDate: "2024-03-04", assetId: "stock:AAPL", assetClass: "stock", symbol: "AAPL", name: "Apple Inc.", quantity: "20", price: "175.10", currency: "USD", fees: "1", fxToUSD: "1" }),
        t({ type: "buy", tradeDate: "2024-06-10", assetId: "etf:EWJ", assetClass: "etf", symbol: "EWJ", name: "iShares MSCI Japan ETF", quantity: "40", price: "68.20", currency: "USD", fxToUSD: "1" }),
        t({ type: "buy", tradeDate: "2024-01-15", assetId: "crypto:bitcoin", assetClass: "crypto", symbol: "BTC", name: "Bitcoin", meta: { cgId: "bitcoin" }, quantity: "0.05", price: "42500", currency: "USD", fees: "10", fxToUSD: "1" }),
        t({ type: "buy", tradeDate: "2024-05-02", assetId: "metal:XAU", assetClass: "metal", symbol: "XAU", name: "Gold", unit: "toz", quantity: "2", price: "2310", currency: "USD", fees: "60", fxToUSD: "1" }),
        t({ type: "deposit", tradeDate: "2024-02-01", assetId: "cash:EUR", assetClass: "cash", symbol: "EUR", name: "EUR cash", amount: "5000", currency: "EUR", fxToUSD: "1.0812" }),
        t({ type: "buy", tradeDate: "2024-09-20", assetId: "pkm:sv03.5-199", assetClass: "pokemon", symbol: "sv03.5-199", name: "Charizard ex (151)", meta: { tcgdexId: "sv03.5-199", condition: "Near Mint" }, quantity: "1", price: "260", currency: "USD", fees: "0", fxToUSD: "1" })
      ],
      watch: [{ id: "w1", assetId: "stock:NVDA", cls: "stock", symbol: "NVDA", name: "NVIDIA" }, { id: "w2", assetId: "crypto:ethereum", cls: "crypto", symbol: "ETH", name: "Ethereum", cgId: "ethereum" }, { id: "w3", assetId: "fx:EURUSD", cls: "fx", symbol: "EUR/USD", name: "EUR/USD", base: "EUR", quote: "USD" }],
      alerts: [{ id: "a1", assetId: "crypto:bitcoin", cls: "crypto", symbol: "BTC", cgId: "bitcoin", kind: "below", threshold: 70000, note: "Demo alert", state: { armed: true } }],
      tasks: [{ id: "k1", title: "Demo task: review gold allocation", status: "open", due: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10) }]
    };
  }

  MD.store = { COLLECTIONS, APPEND_ONLY, newId, memoryBackend, localBackend, dbBackend, makeStore, demoSeed };
})(typeof window !== "undefined" ? window : globalThis);
