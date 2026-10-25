/* Player props view (Sports Betting → Player props): NBA points lines by book, a game-log model per player
   loaded on demand, and an AI pick list that reads the model, injuries and news and gets the review pass. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const C = MD.core, U = MD.ui, D = MD.data, O = MD.odds, h = U.h, P = () => MD.props, A = () => MD.ai;
  const S = { an: new Map() }; // player -> {status, logs, model, ctx, err}
  const pctTxt = (p, dp = 0) => p == null ? "—" : (p * 100).toFixed(dp) + "%";
  const evTxt = (e) => e == null ? "—" : h("span", { class: "num " + (e > 0.02 ? "up" : e < -0.02 ? "down" : "") }, (e > 0 ? "+" : "") + (e * 100).toFixed(1) + "%");
  async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; try { await fn(items[k]); } catch {} } })); }

  async function analyze(row) {
    const cur = S.an.get(row.player); if (cur && (cur.status === "ready" || cur.status === "loading")) return cur;
    const a = { status: "loading" }; S.an.set(row.player, a);
    try {
      a.logs = await P().playerLogs(row.player);
      a.model = P().model(a.logs.games, row.consensusLine);
      a.ctx = await P().context(a.logs.team, row.player).catch(() => ({}));
      a.edge = a.model && row.bestOver ? P().edge(a.model.pOver, row.bestOver.dec) : null;
      a.status = a.model ? "ready" : "thin";
    } catch (e) { a.status = "error"; a.err = U.errorText(e); }
    return a;
  }
  function sparkBars(games, line) {
    const xs = games.slice(0, 10).reverse(); if (!xs.length) return null;
    const max = Math.max(line * 1.4, ...xs.map(g => g.pts)), W = 260, H = 80, bw = W / xs.length;
    const y = (v) => H - 14 - v / max * (H - 20);
    const bars = xs.map((g, i) => '<rect x="' + (i * bw + 2) + '" y="' + y(g.pts) + '" width="' + (bw - 4) + '" height="' + (H - 14 - y(g.pts)) + '" rx="2" fill="' + (g.pts > line ? "var(--up)" : "var(--down)") + '" fill-opacity="0.75"><title>' + g.date + " " + (g.home ? "vs " : "@ ") + g.opp + ": " + g.pts + " pts in " + g.min + " min</title></rect>").join("");
    return h("div", { html: '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:420px" role="img" aria-label="Points in the last ' + xs.length + ' games against the line">' + bars + '<line x1="0" x2="' + W + '" y1="' + y(line) + '" y2="' + y(line) + '" stroke="currentColor" stroke-dasharray="4 3" stroke-opacity="0.7"/><text x="2" y="' + (y(line) - 3) + '" font-size="9" fill="currentColor" opacity="0.7">line ' + line + '</text></svg>', style: "color:var(--muted)" });
  }
  function detail(app, row) {
    const a = S.an.get(row.player);
    if (!a || a.status === "loading") return h("div", { class: "skeleton" }, "Reading " + row.player + "'s game logs on ESPN…");
    if (a.status === "error") return U.errorBox({ message: a.err });
    const m = a.model;
    return h("div", { class: "stack" },
      h("div", { class: "row between", style: "flex-wrap:wrap;gap:8px" }, h("div", { class: "stack", style: "gap:2px" }, h("strong", { style: "font-size:1.05rem" }, row.player), h("span", { class: "small muted" }, (a.logs.team || "") + (a.ctx && a.ctx.game ? " · next: " + (a.ctx.game.home ? "vs " : "@ ") + a.ctx.game.opponent : " · no game found on today's ESPN scoreboard") + (a.ctx && a.ctx.injury ? " · " + a.ctx.injury.status : ""))),
        h("a", { href: a.logs.url, target: "_blank", rel: "noopener noreferrer", class: "small" }, "ESPN game log ↗")),
      m ? h("div", { class: "kpis k4" },
        h("div", { class: "kpi" }, h("span", { class: "label" }, "Model: over " + row.consensusLine), h("span", { class: "v" }, pctTxt(m.pOver)), h("span", { class: "s" }, "mean " + m.mean.toFixed(1) + " ± " + m.sd.toFixed(1) + " pts, " + m.n + " games" + (m.pPush ? " · push " + pctTxt(m.pPush) : ""))),
        h("div", { class: "kpi" }, h("span", { class: "label" }, "Best over price"), h("span", { class: "v" }, row.bestOver ? O.fmtAm(row.bestOver.dec) + " " + row.bestOver.book : "—"), h("span", { class: "s" }, row.bestOver ? "breakeven " + pctTxt(1 / row.bestOver.dec, 1) + " · model EV " + (a.edge != null ? (a.edge * 100).toFixed(1) + "%" : "—") : "no sportsbook price at the consensus line")),
        h("div", { class: "kpi" }, h("span", { class: "label" }, "Went over"), h("span", { class: "v" }, pctTxt(m.hit10)), h("span", { class: "s" }, "last 10 · last 5 " + pctTxt(m.hit5) + " · last 20 " + pctTxt(m.hit20))),
        h("div", { class: "kpi" }, h("span", { class: "label" }, "Recent form"), h("span", { class: "v" }, (m.avg5 != null ? m.avg5.toFixed(1) : "—") + " pts"), h("span", { class: "s" }, "last 5 · " + (m.min5 != null ? m.min5.toFixed(0) : "—") + " min vs " + (m.min20 != null ? m.min20.toFixed(0) : "—") + " over 20 · home " + (m.homeAvg != null ? m.homeAvg.toFixed(1) : "—") + " / away " + (m.awayAvg != null ? m.awayAvg.toFixed(1) : "—")))) : h("p", { class: "small warn-t" }, "Fewer than three games with minutes; no model yet."),
      m ? sparkBars(m.last, row.consensusLine) : null,
      h("div", { class: "tbl-wrap" }, U.table([{ t: "Book", v: (x) => x.book + (x.dfs ? " (pick'em)" : "") }, { t: "Line", v: (x) => (x.side === "over" ? "o" : "u") + x.line, n: true }, { t: "Price", v: (x) => x.dfs ? h("span", { class: "faint", title: "Pick'em sites pay by entry, not per-pick odds" }, O.fmtAm(x.dec)) : O.fmtAm(x.dec), n: true }, { t: "Breakeven", v: (x) => pctTxt(1 / x.dec, 1), n: true }, { t: "Model at this line", v: (x) => { if (!m) return "—"; const mm = P().model(a.logs.games, x.line); return mm ? pctTxt(x.side === "over" ? mm.pOver : mm.pUnder) : "—"; }, n: true }], Object.entries(row.books).map(([book, x]) => Object.assign({ book }, x)).sort((p, q) => p.line - q.line || q.dec - p.dec))),
      h("p", { class: "tiny muted" }, "Model: recency-weighted normal fit to points in this season's and last season's regular-season games (ESPN), each game back counting 6% less. It knows nothing about tonight's matchup, minutes limits or lineup news beyond the injury report; the AI picks below check those. Lines: VegasInsider, read " + (row._updated ? U.fmtDate(row._updated) : "today") + "; confirm in the sportsbook."));
  }

  function view(body, app, sport) {
    body.append(h("div", { class: "banner warn" }, h("p", {}, "Player props carry a bigger margin than game lines, and one-player outcomes swing a lot. Bet small, never chase losses. If gambling stops being fun, call or text 1-800-GAMBLER.")));
    if (sport === "nfl") return tdView(body, app);
    if (sport !== "nba") { body.append(U.section("Player props", h("div", { class: "empty" }, "Player props cover NBA points and NFL anytime touchdowns. Pick NBA or NFL above."))); return; }
    const box = h("div", { class: "stack" });
    body.append(U.section("NBA points props", box));
    U.async(box, () => P().loadProps(), (r) => {
      for (const p of r.props) p._updated = r.updated;
      let sel = null;
      const detailBox = h("div", { class: "stack" });
      const show = (row) => { sel = row; detailBox.replaceChildren(detail(app, row)); };
      const cols = [
        { t: "Player", sort: (x) => x.player, v: (x) => h("strong", {}, x.player) },
        { t: "Line", n: true, sort: (x) => x.consensusLine, v: (x) => h("span", { class: "projcell" }, h("b", {}, String(x.consensusLine)), x.lowLine !== x.highLine ? h("span", { class: "tiny muted" }, x.lowLine + "–" + x.highLine) : null) },
        { t: "Best over", n: true, sort: (x) => x.bestOver ? x.bestOver.dec : null, v: (x) => x.bestOver ? h("span", { class: "projcell" }, h("b", {}, O.fmtAm(x.bestOver.dec)), h("span", { class: "tiny muted" }, x.bestOver.book)) : "—" },
        { t: "Books", n: true, sort: (x) => x.bookCount, v: (x) => String(x.bookCount) },
        { t: "Model over", n: true, sort: (x) => { const a = S.an.get(x.player); return a && a.model ? a.model.pOver : null; }, v: (x) => { const a = S.an.get(x.player); return !a ? h("button", { class: "btn ghost sm", type: "button", onclick: async (ev) => { ev.stopPropagation(); ev.target.disabled = true; ev.target.textContent = "…"; await analyze(x); table.update(r.props); if (sel === x || !sel) show(x); } }, "Analyze") : a.status === "loading" ? h("span", { class: "tiny muted" }, "…") : a.status === "error" ? h("span", { class: "tiny warn-t", title: a.err }, "n/a") : a.model ? h("b", {}, pctTxt(a.model.pOver)) : "—"; } },
        { t: "EV at best", n: true, sort: (x) => { const a = S.an.get(x.player); return a ? a.edge : null; }, v: (x) => { const a = S.an.get(x.player); return a ? evTxt(a.edge) : "—"; } },
        { t: "Over, last 10", n: true, sort: (x) => { const a = S.an.get(x.player); return a && a.model ? a.model.hit10 : null; }, v: (x) => { const a = S.an.get(x.player); return a && a.model ? pctTxt(a.model.hit10) : "—"; } },
        { t: "Next", v: (x) => { const a = S.an.get(x.player); return a && a.ctx ? h("span", { class: "tiny" }, a.ctx.game ? (a.ctx.game.home ? "vs " : "@ ") + a.ctx.game.opponent : "—", a.ctx.injury ? h("span", { class: "injb" }, a.ctx.injury.status) : null) : ""; } }];
      const table = U.dataTable(cols, r.props, { key: "props.nba", sort: [3, -1], noun: "players", placeholder: "Filter by player…", text: (x) => x.player, onRow: async (x) => { show(x); if (!S.an.get(x.player)) { await analyze(x); table.update(r.props); show(x); } } });
      const topBtn = h("button", { class: "btn", type: "button", onclick: async () => {
        topBtn.disabled = true; const top = r.props.slice().sort((a, b) => b.bookCount - a.bookCount || b.consensusLine - a.consensusLine).slice(0, 12).filter(x => !S.an.get(x.player));
        let n = 0; topBtn.textContent = "Analyzing 0 of " + top.length + "…";
        await pool(top, 3, async (x) => { await analyze(x); n++; topBtn.textContent = "Analyzing " + n + " of " + top.length + "…"; table.update(r.props); });
        topBtn.textContent = "Analyzed"; if (!sel && top[0]) show(top[0]);
      } }, "Analyze the 12 most-listed players");
      box.append(h("div", { class: "row between", style: "flex-wrap:wrap;gap:8px" }, h("span", { class: "small muted" }, r.props.length + " players · " + r.books.length + " books · VegasInsider" + (r.updated ? ", updated " + U.fmtDate(r.updated) : "")), topBtn), table, detailBox,
        U.section("AI prop picks", h("div", { class: "stack" }, h("p", { class: "small muted" }, "Claude reads the model numbers for the players you've analyzed, checks injury, minutes and role news, and picks the few with the best evidence (or none). A second review checks each pick against the numbers."), MD.oppAI.runner(app, "Pick props with AI", (Sx, signal) => aiPicks(app, r, Sx, signal), picksView(app)))));
    }, { loading: "Reading NBA player props from VegasInsider…" });
  }

  async function aiPicks(app, r, Sx, signal) {
    const rows = r.props.filter(x => { const a = S.an.get(x.player); return a && a.model; }).slice(0, 20);
    if (rows.length < 2) throw new Error("Analyze some players first (the button above analyzes the 12 most-listed).");
    const facts = rows.map(x => { const a = S.an.get(x.player), m = a.model; return A().rnd({ player: x.player, team: a.logs.team, line: x.consensusLine, lineRange: [x.lowLine, x.highLine], bestOver: x.bestOver ? { book: x.bestOver.book, american: O.fmtAm(x.bestOver.dec), breakevenPct: 100 / x.bestOver.dec } : null, modelOverPct: m.pOver * 100, modelUnderPct: m.pUnder * 100, evAtBestPct: a.edge != null ? a.edge * 100 : null, mean: m.mean, sd: m.sd, gamesUsed: m.n, thisSeasonGames: a.logs.current, last5Avg: m.avg5, minutesLast5: m.min5, minutesLast20: m.min20, overRateLast10Pct: m.hit10 != null ? m.hit10 * 100 : null, next: a.ctx && a.ctx.game ? (a.ctx.game.home ? "vs " : "@ ") + a.ctx.game.opponent : null, injury: a.ctx && a.ctx.injury || null }); });
    const lim = await app.caps.sample.limits().catch(() => null);
    const tools = lim && lim.tools ? A().tools(app, Sx, ["search_news", "search_web"]) : undefined;
    const prompt = `Today is ${new Date().toISOString().slice(0, 10)}. You are a disciplined NBA player-props analyst. The app measured these points props: sportsbook lines (VegasInsider) and a model fitted to each player's ESPN game logs.
${tools ? "Use 2 to 6 tool calls (search_news or search_web) on the players you're leaning toward: injuries, minutes restrictions, role or lineup changes, and the opponent's defence. Cite only URLs the tools returned." : ""}
Rules: the model ignores matchup and lineup news, early-season samples are small, and prop margins are large, so an edge under ~3% is noise. "No bet" is often right. Only the over is priced on this page; for an under, say there is no under price here. Never invent numbers. Suggest at most 1% of bankroll per pick.
Props: ${JSON.stringify(facts)}
Reply with ONLY JSON: {"summary": "2 sentences", "picks": [{"player": "...", "side": "over"|"under", "line": number, "book": "best book or empty", "probabilityPct": number, "why": "1-2 sentences with the numbers", "risk": "...", "confidence": 0-100, "sources": [{"title": "...", "url": "https://..."}]}], "passes": [{"player": "...", "reason": "why no bet"}]}`;
    const res = await app.caps.sample.json(prompt, Object.assign({ modelTier: "complex", signal }, tools ? { tools } : { cache: false }));
    const known = new Map(rows.map(x => [x.player, x]));
    const picks = (res.picks || []).filter(p => known.has(p.player)).slice(0, 5).map(p => { const x = known.get(p.player), a = S.an.get(p.player); return { player: p.player, side: p.side === "under" ? "under" : "over", line: Number(p.line) || x.consensusLine, book: String(p.book || (x.bestOver && x.bestOver.book) || ""), probabilityPct: Math.max(40, Math.min(80, Number(p.probabilityPct) || 50)), modelPct: (p.side === "under" ? a.model.pUnder : a.model.pOver) * 100, why: String(p.why || ""), risk: String(p.risk || ""), confidence: Math.max(0, Math.min(100, Number(p.confidence) || 0)), sources: Sx.verify(p.sources), price: x.bestOver && p.side !== "under" ? x.bestOver.dec : null }; });
    const rv = await A().review(app, { task: "NBA points prop picks", S: Sx, signal, facts, items: picks.map(p => ({ id: p.player, side: p.side, line: p.line, probabilityPct: p.probabilityPct, modelPct: p.modelPct, why: p.why, confidence: p.confidence })) });
    for (const p of picks) { const rr = rv && rv.reviews.find(x => x.id === p.player); if (rr) p.review = rr; p.ev = p.price ? (p.probabilityPct / 100) * p.price - 1 : null; }
    return { summary: String(res.summary || ""), picks: picks.filter(p => !(p.review && p.review.verdict === "drop")), dropped: picks.filter(p => p.review && p.review.verdict === "drop"), passes: (res.passes || []).slice(0, 8), overall: rv && rv.overall };
  }
  const picksView = (app) => (res) => h("div", { class: "stack" }, h("p", {}, res.summary), res.overall ? h("p", { class: "small muted" }, h("strong", {}, "Review: "), res.overall) : null,
    res.picks.length ? res.picks.map(p => h("div", { class: "card aicard", style: "padding:10px 12px" },
      h("div", { class: "row between", style: "flex-wrap:wrap;gap:6px" }, h("strong", {}, p.player + " " + p.side + (p.line !== "" ? " " + p.line : "")), h("span", { class: "small" }, "Claude " + p.probabilityPct.toFixed(0) + "% · " + (p.side === "to score" ? "consensus " : "model ") + p.modelPct.toFixed(0) + "%" + (p.price ? " · " + O.fmtAm(p.price) + " " + p.book + " · EV " + (p.ev * 100).toFixed(1) + "%" : " · no price on this page"))),
      h("p", { class: "small", style: "margin:6px 0" }, p.why), p.risk ? h("p", { class: "small" }, h("strong", {}, "Risk: "), p.risk) : null, A().reviewBadge(p.review), A().sources(p.sources))) : h("div", { class: "empty" }, "No bet: nothing clears the bar today."),
    res.dropped.length ? h("p", { class: "small muted" }, "Dropped by the review: " + res.dropped.map(p => p.player + " (" + (p.review.note || "") + ")").join("; ")) : null,
    res.passes.length ? A().list("Passed on", res.passes.map(x => x.player + ": " + x.reason)) : null,
    h("p", { class: "tiny muted" }, "Claude's picks from the measured model and the news it retrieved, checked by a second review. Confirm the price in your sportsbook; Market Desk never places bets."));

  /* NFL anytime touchdown: line shopping against the cross-book consensus, then AI picks with news. */
  function tdView(body, app) {
    const box = h("div", { class: "stack" });
    body.append(U.section("NFL anytime touchdown", box));
    U.async(box, () => P().loadTD(), (r) => {
      const cols = [
        { t: "Player", sort: (x) => x.player, v: (x) => h("strong", {}, x.player) },
        { t: "Fair chance", n: true, sort: (x) => x.fair, v: (x) => pctTxt(x.fair, 1) },
        { t: "Best price", n: true, sort: (x) => x.best ? x.best.dec : null, v: (x) => x.best ? h("span", { class: "projcell" }, h("b", {}, O.fmtAm(x.best.dec)), h("span", { class: "tiny muted" }, x.best.book)) : "—" },
        { t: "Median price", n: true, sort: (x) => x.medianImplied, v: (x) => O.fmtAm(1 / x.medianImplied) },
        { t: "EV at best", n: true, sort: (x) => x.edge, v: (x) => evTxt(x.edge) },
        { t: "Books", n: true, sort: (x) => x.bookCount, v: (x) => h("span", {}, String(x.bookCount), x.outliers.length ? h("span", { class: "tiny warn-t", title: "Left out as a likely different market: " + x.outliers.join(", ") }, " · " + x.outliers.length + " flagged") : null) }];
      box.append(h("p", { class: "small muted" }, r.props.length + " players · " + r.books.length + " books · VegasInsider. Fair chance = the median price across books with a " + Math.round(r.margin * 100) + "% margin removed (the page shows no 'No' prices to measure it), so EV here is how much better the best book pays than the consensus, not a model of the player."),
        U.dataTable(cols, r.props, { key: "props.nfltd", sort: [4, -1], noun: "players", placeholder: "Filter by player…", text: (x) => x.player }),
        U.section("AI touchdown picks", h("div", { class: "stack" }, h("p", { class: "small muted" }, "Claude checks role, red-zone usage, injuries and game script for the players where the best price beats the consensus, and picks the few with real support (or none). A second review checks each pick."),
          MD.oppAI.runner(app, "Pick touchdown scorers with AI", (Sx, signal) => tdPicks(app, r, Sx, signal), picksView(app)))));
    }, { loading: "Reading NFL anytime-touchdown prices from VegasInsider…" });
  }
  async function tdPicks(app, r, Sx, signal) {
    const rows = r.props.filter(x => x.best).sort((a, b) => b.edge - a.edge).slice(0, 16);
    const facts = rows.map(x => A().rnd({ player: x.player, fairChancePct: x.fair * 100, bestPrice: { book: x.best.book, american: O.fmtAm(x.best.dec), breakevenPct: 100 / x.best.dec }, medianImpliedPct: x.medianImplied * 100, evAtBestPct: x.edge * 100, books: x.bookCount, flaggedBooks: x.outliers }));
    const lim = await app.caps.sample.limits().catch(() => null);
    const tools = lim && lim.tools ? A().tools(app, Sx, ["search_news", "search_web"]) : undefined;
    const prompt = `Today is ${new Date().toISOString().slice(0, 10)}. You are a disciplined NFL anytime-touchdown analyst. The app read these prices (VegasInsider) and estimated each player's fair chance from the consensus across books.
${tools ? "Use 2 to 6 tool calls (search_news or search_web) on the players you lean toward: role and snap share, red-zone and goal-line usage, injuries and game status, the matchup and expected game script. Cite only URLs the tools returned." : ""}
Rules: the consensus is the market's best estimate; only claim value where the best price beats it AND the news supports the player's role. Touchdowns are high-variance; "no bet" is often right. Never invent numbers. At most 0.5% of bankroll per pick.
Props: ${JSON.stringify(facts)}
Reply with ONLY JSON: {"summary": "2 sentences", "picks": [{"player": "...", "side": "over", "line": 0.5, "book": "...", "probabilityPct": number, "why": "1-2 sentences", "risk": "...", "confidence": 0-100, "sources": [{"title": "...", "url": "https://..."}]}], "passes": [{"player": "...", "reason": "..."}]}`;
    const res = await app.caps.sample.json(prompt, Object.assign({ modelTier: "complex", signal }, tools ? { tools } : { cache: false }));
    const known = new Map(rows.map(x => [x.player, x]));
    const picks = (res.picks || []).filter(p => known.has(p.player)).slice(0, 5).map(p => { const x = known.get(p.player); return { player: p.player, side: "to score", line: "", book: x.best.book, probabilityPct: Math.max(1, Math.min(90, Number(p.probabilityPct) || x.fair * 100)), modelPct: x.fair * 100, why: String(p.why || ""), risk: String(p.risk || ""), confidence: Math.max(0, Math.min(100, Number(p.confidence) || 0)), sources: Sx.verify(p.sources), price: x.best.dec }; });
    const rv = await A().review(app, { task: "NFL anytime touchdown picks", S: Sx, signal, facts, items: picks.map(p => ({ id: p.player, probabilityPct: p.probabilityPct, consensusPct: p.modelPct, why: p.why, confidence: p.confidence })) });
    for (const p of picks) { const rr = rv && rv.reviews.find(x => x.id === p.player); if (rr) p.review = rr; p.ev = (p.probabilityPct / 100) * p.price - 1; }
    return { summary: String(res.summary || ""), picks: picks.filter(p => !(p.review && p.review.verdict === "drop")), dropped: picks.filter(p => p.review && p.review.verdict === "drop"), passes: (res.passes || []).slice(0, 8), overall: rv && rv.overall };
  }

  MD.propsView = view;
  MD.propsState = S;
})(typeof window !== "undefined" ? window : globalThis);
