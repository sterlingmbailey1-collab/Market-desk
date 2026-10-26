/* Ask AI from anywhere: a chat that already knows what's on screen (the asset, person, game or portfolio being
   viewed), with the shared research tools, the user's investor profile and track record, and a one-click
   independent check of any answer. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const U = MD.ui, h = U.h;

  // What the user is looking at, in a sentence plus starter questions.
  function context(app) {
    const r = app.route, c = app.ctx[r] || {}, label = (app.ROUTES.find(x => x[0] === r) || [r, r])[1];
    if (["stocks", "crypto", "metals", "fx"].includes(r) && c && c.symbol) return { text: "The user is viewing " + (c.name || c.symbol) + " (" + c.symbol + ", " + (c.cls || r) + ").", subject: c.symbol, starters: ["What's driving " + c.symbol + " lately?", "Is " + c.symbol + " expensive right now?", "What could make " + c.symbol + " fall 20%?", "How would " + c.symbol + " fit my portfolio?"] };
    if (r === "smartmoney" && c && c.person) return { text: "The user is viewing the Smart Money page of " + c.person.name + " (" + (c.person.kind === "pol" ? "member of Congress, disclosed trades" : "13F investor") + ").", subject: c.person.name, starters: ["What has " + c.person.name + " been buying, and how has it done?", "Is copying " + c.person.name + " worth it after the disclosure delay?", "Which of their positions look most interesting now?"] };
    if (r === "betting" && c && c.label) return { text: "The user is viewing the game " + c.label + " (" + (c.sport || "") + ") on the Sports Betting tab.", subject: c.label, starters: ["Who's the value side in " + c.label + "?", "What injuries matter in this game?", "Is there a bet here or should I pass?"] };
    if (r === "portfolio") return { text: "The user is viewing their portfolio.", subject: "portfolio", starters: ["Where is my portfolio's risk concentrated?", "What would a 20% market drop do to me?", "What should I watch in my holdings this week?"] };
    if (r === "paper") return { text: "The user is on their Paper Trading page (a virtual account; nothing real is traded).", subject: "paper account", starters: ["How is my paper account doing against the S&P 500?", "Which source of ideas is working best in my paper account?", "What should I paper-trade next that fits my profile?"] };
    if (r === "today") return { text: "The user is on Today's Game Plan (the day's calendar, their names, calls coming due).", subject: "today", starters: ["What matters most for my holdings today?", "Which earnings this week could move my names, and by how much?", "What's the news on my holdings?"] };
    if (r === "opportunities" && app.ls.get("oppTab", "scan") === "screener") return { text: "The user is on the stock screener (NYSE and Nasdaq by exchange, sector and size).", subject: "stock screen", starters: ["Screen mid-cap energy stocks on the NYSE", "Find large-cap health care stocks down today", "Which sector looks strongest right now?"] };
    if (r === "betting") return { text: "The user is on the Sports Betting tab (league " + (app.ls.get("bet.sport", "nfl")) + ").", subject: "betting", starters: ["Any value bets today?", "Which favourites look shaky?", "How is my betting record?"] };
    return { text: "The user is on the " + label + " page.", subject: label, starters: ["What's moving the market today?", "Find me three ideas that fit my profile", "How accurate have the AI's calls been?"] };
  }

  function open(app, initial) {
    const s = app.caps.sample;
    const ctx0 = context(app), turns = [];
    const chat = h("div", { class: "askchat" }), log = MD.ai.logBox(), input = h("textarea", { rows: 2, placeholder: "Ask about " + ctx0.subject + "…", "aria-label": "Question" });
    const send = h("button", { class: "btn", type: "button" }, "Ask");
    const starters = h("div", { class: "row", style: "flex-wrap:wrap;gap:6px" }, ctx0.starters.map(q => h("button", { class: "chip", type: "button", onclick: () => { input.value = q; send.click(); } }, q)));
    const paint = () => chat.replaceChildren(...turns.map(t => h("div", { class: t.role === "user" ? "msg-u" : "msg-a" }, t.content)), turns.length ? null : h("div", { class: "empty" }, ctx0.text + " Ask anything; answers use live data tools and your investor profile."));
    paint();
    send.onclick = async () => {
      const text = input.value.trim(); if (!text) return;
      if (!s) { chat.append(U.errorBox({ message: "Claude isn't available in this view." })); return; }
      turns.push({ role: "user", content: text }); input.value = ""; paint(); starters.hidden = true;
      const bubble = h("div", { class: "msg-a" }, "Thinking…"); chat.append(bubble); send.disabled = true; log.clear();
      const S = MD.ai.session((e) => log.add(e));
      const actx = { app, log: [], sources: S.sources, onLog: (e) => log.add(e) };
      const kit = MD.ai.tools(app, S);
      const extra = MD.advisorKit ? MD.advisorKit.advisorTools(app, actx).filter(t => ["analyze_portfolio", "get_betting_odds", "bet_math", "get_my_bets"].includes(t.name)) : [];
      const RULES = `You are Market Desk's analyst, answering inside the app. Today is ${new Date().toISOString().slice(0, 10)}. ${ctx0.text}
${MD.ai.contextNote(app)}
Use the tools for every price, statistic, odds figure and holding; never invent numbers or sources; cite URLs the tools returned. Think in steps: gather evidence, start from the market's own view (fair odds, implied move, consensus), weigh the strongest counterargument, then conclude with a confidence level and what would change it. "Do nothing", "wait" and "no bet" are valid. Never execute trades or place bets. Disclosed trades by politicians or investors never imply wrongdoing. Plain text, short paragraphs.`;
      try {
        const toolsNow = MD.ai.selectTools([...kit, ...extra], ctx0.text + " " + turns.slice(-3).map(t => t.content).join(" "), await MD.ai.toolCap(app), ["search_news", "search_web", "stock_snapshot"]);
        const r = await s([{ role: "user", content: RULES }, ...turns.slice(-10)], { cache: false, tools: toolsNow, onText: ({ text: t }) => { bubble.textContent = t; } });
        turns.push({ role: "assistant", content: r.text }); paint();
        const checkBox = h("div", { class: "stack" });
        const chk = h("button", { class: "btn ghost sm", type: "button", onclick: async () => {
          chk.disabled = true; chk.textContent = "Checking…";
          const rv = await MD.ai.review(app, { task: text, S, facts: { context: ctx0.text, toolSteps: S.log.map(e => e.kind + ": " + e.text) }, items: [{ id: "answer", answer: r.text }] }).catch(() => null);
          checkBox.replaceChildren(rv && rv.reviews[0] ? MD.ai.reviewBadge(rv.reviews[0]) : h("p", { class: "small muted" }, "The check didn't complete."));
        } }, "Double-check this answer");
        checkBox.append(chk, h("span", { class: "tiny muted" }, S.calls + " research steps · " + S.sources.length + " sources")); chat.append(checkBox);
      } catch (e) { turns.pop(); paint(); chat.append(U.errorBox({ message: MD.ai.errText(e) })); input.value = text; }
      send.disabled = false; chat.scrollTop = chat.scrollHeight;
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!send.disabled) send.click(); } });
    U.modal("Ask AI · " + ctx0.subject, h("div", { class: "stack askai" }, chat, starters, h("div", { class: "row", style: "align-items:flex-end;gap:8px" }, input, send), h("details", {}, h("summary", { class: "label" }, "Research steps"), log), h("p", { class: "tiny muted" }, "Not investment or betting advice. Enter to send.")), { cls: "wide" });
    setTimeout(() => { input.focus(); if (initial) { input.value = initial; send.click(); } }, 50);
  }

  MD.askAI = { open, context };
})(typeof window !== "undefined" ? window : globalThis);
