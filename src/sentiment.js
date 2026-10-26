/* News sentiment for holdings: the latest headlines for each stock, ETF and coin you hold (Bigdata.com for stocks,
   CoinMarketCap for coins), read by Claude for what they mean to someone who owns it (−2…+2, materiality 1–3, or "not
   about this asset"). The page computes each holding's score (materiality- and recency-weighted, MD.quant.newsScore);
   links are only ever the retrieved articles. One reading per day is saved (collection "sentiment"). */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const C = MD.core, U = MD.ui, D = MD.data, h = U.h;
  const LABEL = { positive: ["Positive", "up"], negative: ["Negative", "down"], mixed: ["Mixed", "warn-t"], neutral: ["Neutral", "muted"], none: ["No news found", "muted"] };
  const dayKey = () => MD.quant.nyParts(new Date()).ymd;

  function holdings(app, max = 8) {
    const { positions } = C.buildPositions(app.store.cached("tx"));
    return [...positions.values()].filter(p => p.qty.gt(0) && ["stock", "etf", "crypto"].includes(p.assetClass))
      .sort((a, b) => Number(b.lots.reduce((s, l) => s.plus(l.cost), C.ZERO)) - Number(a.lots.reduce((s, l) => s.plus(l.cost), C.ZERO)))
      .slice(0, max).map(p => Object.assign({ id: p.assetId, cls: p.assetClass, symbol: p.symbol, name: p.name }, p.meta || {}));
  }
  async function headlinesFor(a) {
    if (a.cls === "crypto") { const r = await D.cmc.news(String(a.symbol).toUpperCase(), 6); return { source: "CoinMarketCap", items: r.items.filter(x => x.url && x.title).slice(0, 5).map(x => ({ title: x.title, url: x.url, ts: x.ts || null, publisher: x.source || "CoinMarketCap", excerpt: String(x.text || x.description || "").slice(0, 400) })) }; }
    const q = (a.name && a.name !== a.symbol ? a.name + " (" + a.symbol + ")" : a.symbol + " stock") + " latest company news this week";
    const r = await D.bigdataNews(q, 6);
    const seen = new Set();
    return { source: "Bigdata.com", items: r.items.filter(x => x.url && x.title && !seen.has(x.title) && seen.add(x.title)).slice(0, 5).map(x => ({ title: x.title, url: x.url, ts: x.ts || null, publisher: x.source || "", excerpt: String(x.text || "").slice(0, 400) })) };
  }

  async function run(app, opts = {}) {
    const list = holdings(app);
    if (!list.length) return { at: Date.now(), day: dayKey(), rows: [] };
    if (!app.caps.sample) throw Object.assign(new Error("Claude isn't available in this view."), { code: "no_sample" });
    const got = await Promise.all(list.map(async (a) => { try { return Object.assign({ a }, await headlinesFor(a)); } catch (e) { return { a, items: [], err: U.errorText(e) }; } }));
    const H = [];
    got.forEach((g, gi) => g.items.forEach((n, ni) => { n.id = "h" + gi + "_" + ni; H.push({ id: n.id, asset: g.a.symbol + (g.a.name && g.a.name !== g.a.symbol ? " (" + g.a.name + ")" : ""), headline: n.title, published: n.ts ? new Date(n.ts).toISOString().slice(0, 10) : null, publisher: n.publisher, excerpt: n.excerpt }); }));
    const cls = {}, sums = {};
    if (H.length) {
      const r = await app.caps.sample.json(`You are the desk's news-sentiment reader. For each headline below, judge what it means for someone who OWNS the named asset: sentiment from -2 (clearly bad for the holder) to +2 (clearly good), 0 when neutral; materiality from 1 (minor) to 3 (could move the price); and whether it is really about that asset (aboutAsset false for unrelated or generic market pieces). Judge only from the headline and excerpt; never add facts or numbers of your own. Then one plain sentence per asset on what its news says, or "Nothing material." when nothing is.
${MD.ai.profileNote ? MD.ai.profileNote(app) : ""}
Headlines: ${JSON.stringify(H)}
Reply with ONLY JSON: {"headlines": [{"id": "h0_0", "sentiment": 0, "materiality": 1, "aboutAsset": true}], "assets": [{"symbol": "TICKER", "summary": "one sentence"}]}`, { modelTier: "default", signal: opts.signal, cache: false });
      for (const x of Array.isArray(r.headlines) ? r.headlines : []) if (x && x.id) cls[x.id] = x;
      for (const x of Array.isArray(r.assets) ? r.assets : []) if (x && x.symbol) sums[String(x.symbol).toUpperCase()] = String(x.summary || "").slice(0, 300);
    }
    const rows = got.map(g => {
      const items = g.items.map(n => { const c = cls[n.id] || {}; return { title: n.title, url: n.url, ts: n.ts, publisher: n.publisher, s: Math.max(-2, Math.min(2, Math.round(Number(c.sentiment) || 0))), mat: Math.max(1, Math.min(3, Math.round(Number(c.materiality) || 1))), about: c.aboutAsset !== false, judged: !!cls[n.id] }; });
      const rel = items.filter(x => x.about && x.judged), sc = MD.quant.newsScore(rel);
      const top = rel.slice().sort((x, y) => y.mat * Math.abs(y.s) - x.mat * Math.abs(x.s) || (y.ts || 0) - (x.ts || 0))[0] || null;
      return { asset: MD.common.slim(g.a), symbol: g.a.symbol, source: g.source || null, error: g.err || null, score: sc.score, label: sc.label, headlines: items.length, relevant: rel.length, newest: items.reduce((m, x) => Math.max(m, x.ts || 0), 0) || null, summary: sums[String(g.a.symbol).toUpperCase()] || "", top, items };
    });
    const doc = { at: Date.now(), day: dayKey(), rows };
    if (!app.demo) {
      await app.store.put("sentiment", doc.day, JSON.parse(JSON.stringify(doc))).catch(() => {});
      // A clearly negative reading on a holding (score −50 or lower from 2+ relevant headlines) goes to the inbox once a day.
      for (const r of rows.filter(r => r.score != null && r.score <= -50 && r.relevant >= 2)) {
        if (app.store.cached("inbox").some(i => i.kind === "news" && i.day === doc.day && i.symbol === r.symbol)) continue;
        await app.store.create("inbox", { kind: "news", day: doc.day, symbol: r.symbol, assetId: r.asset && r.asset.id, title: r.symbol + ": the news tone is clearly negative (" + r.score + ")", body: (r.summary ? r.summary + " " : "") + (r.top ? "Top headline: " + r.top.title + (r.top.publisher ? " (" + r.top.publisher + ")" : "") + ". " : "") + "Source: " + (r.source || "news") + " headlines read by Claude; score computed by the page.", materiality: 1.5, read: false, at: Date.now() }).catch(() => {});
      }
    }
    return doc;
  }
  const latest = (app) => app.store.cached("sentiment").slice().sort((a, b) => (b.at || 0) - (a.at || 0))[0] || null;

  function table(app, doc) {
    const bar = (s) => { if (s == null) return h("span", { class: "muted" }, "—"); const w = Math.round(Math.abs(s) / 2); return h("span", { class: "row", style: "gap:6px;align-items:center;flex-wrap:nowrap" }, h("span", { class: "num " + (s > 0 ? "up" : s < 0 ? "down" : "") }, (s > 0 ? "+" : "") + s), h("span", { "aria-hidden": "true", style: "display:inline-block;height:6px;border-radius:3px;width:" + Math.max(2, w) + "px;background:" + (s > 0 ? "var(--up)" : s < 0 ? "var(--down)" : "var(--line)") })); };
    return h("div", { class: "stack" },
      U.table([
        { t: "Holding", v: (r) => h("span", { class: "who sym" }, h("b", {}, r.symbol), h("span", { class: "tiny muted" }, r.source || "")) },
        { t: "Sentiment", v: (r) => h("span", { class: (LABEL[r.label] || LABEL.none)[1] }, (LABEL[r.label] || LABEL.none)[0]) },
        { t: "Score", v: (r) => bar(r.score) },
        { t: "Headlines", v: (r) => r.error ? h("span", { class: "tiny warn-t" }, "unavailable") : r.relevant + " of " + r.headlines + (r.newest ? " · newest " + U.fmtDate(r.newest) : ""), n: true },
        { t: "What the news says", v: (r) => h("div", { class: "stack", style: "gap:2px" }, h("span", { class: "small" }, r.summary || (r.headlines ? "" : "No recent headlines found.")),
          r.top ? h("a", { class: "tiny", href: r.top.url, target: "_blank", rel: "noopener noreferrer" }, (r.top.title || r.top.url).slice(0, 90) + (r.top.publisher ? " · " + r.top.publisher : "")) : null) }],
        doc.rows, { empty: "Add stocks, ETFs or coins to the portfolio to read their news.", onRow: (r) => app.openAsset(r.asset) }),
      h("p", { class: "tiny muted" }, "Read " + U.fmtTs(doc.at) + ". Headlines from Bigdata.com (stocks) and CoinMarketCap (coins); Claude judges each one for a holder, and the page scores them (−100 to +100, recent and material news counts more; headlines not about the asset are left out). Links are the retrieved articles. News tone is one input, not a price forecast."));
  }
  function section(app) {
    const box = h("div", { class: "stack" }), saved = latest(app);
    const btn = h("button", { class: "btn ghost", type: "button", onclick: async () => {
      btn.disabled = true; box.replaceChildren(h("div", { class: "skeleton" }, "Reading the latest news for your holdings…"));
      try { box.replaceChildren(table(app, await run(app))); btn.textContent = "Read again"; }
      catch (e) { box.replaceChildren(U.errorBox({ message: MD.ai.errText ? MD.ai.errText(e) : U.errorText(e) })); }
      btn.disabled = false;
    } }, saved ? "Read again" : "Read the news for my holdings");
    box.append(saved ? table(app, saved) : h("div", { class: "empty" }, "Reads the latest headlines for up to eight holdings (one news search each, plus one Claude reading) and scores the tone for a holder."));
    const sec = U.section("News sentiment for your holdings", h("div", { class: "stack" }, h("div", { class: "row" }, btn), box)); sec.id = "sec-sentiment";
    return sec;
  }

  MD.sentiment = { run, latest, section, table, holdings };
})(typeof window !== "undefined" ? window : globalThis);
