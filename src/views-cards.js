/* Trading-card pages: the card's real picture (re-encoded through an image proxy, since this page can't
   load images from other hosts), a drawn face as the fallback, the viewer's own photo of the card, and
   every sold listing PriceCharting / SportsCardsPro shows for it. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const C = MD.core, U = MD.ui, D = MD.data, h = U.h;
  const A = () => MD.app;

  /* ---------- drawn card faces (fixed card colours, readable on either theme) ---------- */
  const PKM = { Grass: ["#4f8f1b", "#eaf4dc"], Fire: ["#cf4a25", "#fbe5db"], Water: ["#2482bd", "#dfeffa"], Lightning: ["#c99a07", "#fdf3cf"], Psychic: ["#8e4584", "#f3e1f0"], Fighting: ["#a8522a", "#f6e3d8"], Darkness: ["#2e3946", "#e1e5ea"], Metal: ["#6f7d89", "#eaeef1"], Dragon: ["#9a7720", "#f3ecd6"], Fairy: ["#c45d99", "#fbe6f2"], Colorless: ["#8f8a7c", "#f4f2ed"] };
  const YGO = { normal: ["#b88f3a", "#f6e9c6"], effect: ["#b9602f", "#f7e0d0"], ritual: ["#4f74b5", "#dde7f6"], fusion: ["#6f519a", "#ebe2f4"], synchro: ["#8c96a1", "#f2f4f6"], xyz: ["#2b2b2b", "#e0e0e0"], link: ["#1d4b93", "#dbe5f6"], spell: ["#177c60", "#d8f0e8"], trap: ["#953a66", "#f4dde8"], token: ["#7d7d7d", "#eeeeee"], skill: ["#2f6aa8", "#dce9f7"] };
  const ORB = { G: "#4f8f1b", R: "#cf4a25", W: "#2482bd", L: "#c99a07", P: "#8e4584", F: "#a8522a", D: "#2e3946", M: "#6f7d89", N: "#9a7720", Y: "#c45d99", C: "#b9b4a7" };
  const orbKey = (t) => ({ Grass: "G", Fire: "R", Water: "W", Lightning: "L", Psychic: "P", Fighting: "F", Darkness: "D", Metal: "M", Dragon: "N", Fairy: "Y" }[t] || "C");
  const orb = (t) => h("i", { class: "cf-orb", style: "background:" + ORB[orbKey(t)], title: t });
  const initials = (s) => String(s || "?").replace(/\b(ex|EX|V|VMAX|VSTAR|GX)\b/g, "").trim().split(/\s+/).slice(0, 2).map(w => w.charAt(0)).join("").toUpperCase();
  // Gentle tilt and sheen under the pointer (skipped when motion is reduced).
  function tilt(el) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return el;
    el.addEventListener("pointermove", (e) => { if (document.body.classList.contains("reduce-motion")) return; const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height; el.style.setProperty("--rx", ((0.5 - y) * 10).toFixed(2) + "deg"); el.style.setProperty("--ry", ((x - 0.5) * 12).toFixed(2) + "deg"); el.style.setProperty("--sx", (x * 100).toFixed(1) + "%"); el.style.setProperty("--sy", (y * 100).toFixed(1) + "%"); });
    el.addEventListener("pointerleave", () => { el.style.removeProperty("--rx"); el.style.removeProperty("--ry"); });
    return el;
  }
  function pokemonFace(c) {
    const t = (c.types && c.types[0]) || (c.category === "Trainer" ? null : "Colorless");
    const [c1, c2] = PKM[t] || ["#5a6470", "#eef1f4"];
    const total = c.setCount ? c.setCount.official : "";
    const body = c.category === "Pokemon"
      ? [...c.abilities.slice(0, 1).map(a => h("div", { class: "cf-move" }, h("div", { class: "cf-mrow" }, h("span", { class: "cf-ab" }, a.type || "Ability"), h("b", {}, a.name)), a.effect ? h("p", {}, a.effect) : null)),
        ...c.attacks.slice(0, 2).map(a => h("div", { class: "cf-move" }, h("div", { class: "cf-mrow" }, h("span", { class: "cf-cost" }, a.cost.map(orb)), h("b", {}, a.name), h("span", { class: "cf-dmg" }, a.damage)), a.effect ? h("p", {}, a.effect) : null))]
      : [h("div", { class: "cf-move" }, h("div", { class: "cf-mrow" }, h("b", {}, c.trainerType || c.energyType || c.category || "")), c.effect ? h("p", {}, c.effect) : null)];
    return tilt(h("div", { class: "cface pkm", style: "--c1:" + c1 + ";--c2:" + c2, role: "img", "aria-label": "Drawing of the card " + c.name },
      h("div", { class: "cf-head" }, h("span", { class: "cf-stage" }, c.category === "Pokemon" ? (c.stage || "Basic") : c.category), h("b", { class: "cf-name" }, c.name), c.hp ? h("span", { class: "cf-hp" }, h("small", {}, "HP"), String(c.hp), t ? orb(t) : null) : null),
      h("div", { class: "cf-art" }, h("span", { class: "cf-mono" }, initials(c.name)), c.evolveFrom ? h("span", { class: "cf-evo" }, "Evolves from " + c.evolveFrom) : null),
      h("div", { class: "cf-text" }, body),
      h("div", { class: "cf-foot" }, h("span", {}, [c.weaknesses.length ? "Weak " + c.weaknesses.join(", ") : null, c.resistances.length ? "Resist " + c.resistances.join(", ") : null, c.retreat != null ? "Retreat " + c.retreat : null].filter(Boolean).join(" · ")), h("span", {}, [c.set, (c.localId || "") + (total ? "/" + total : ""), c.rarity, c.regulationMark].filter(Boolean).join(" · ")), c.illustrator ? h("span", {}, "Illus. " + c.illustrator) : null)));
  }
  function ygoFace(c) {
    const base = String(c.frameType || (/Spell/.test(c.type) ? "spell" : /Trap/.test(c.type) ? "trap" : "effect")).split("_")[0];
    const [c1, c2] = YGO[base] || YGO.effect;
    const dark = base === "xyz";
    const isMonster = !/Spell|Trap|Skill/.test(c.type || "");
    const stars = isMonster && c.level ? h("div", { class: "cf-stars" + (base === "xyz" ? " rank" : "") }, "★".repeat(Math.min(13, c.level))) : null;
    return tilt(h("div", { class: "cface ygo" + (dark ? " dark" : ""), style: "--c1:" + c1 + ";--c2:" + c2, role: "img", "aria-label": "Drawing of the card " + c.name },
      h("div", { class: "cf-head" }, h("b", { class: "cf-name" }, c.name), h("span", { class: "cf-attr" }, isMonster ? (c.attribute || "") : (/Spell/.test(c.type) ? "SPELL" : "TRAP"))),
      stars || h("div", { class: "cf-stars" }, isMonster ? "" : "[" + (c.race || "Normal") + " " + (/Spell/.test(c.type) ? "Spell" : "Trap") + "]"),
      h("div", { class: "cf-art" }, h("span", { class: "cf-mono" }, initials(c.name))),
      h("div", { class: "cf-text" }, isMonster ? h("b", { class: "cf-race" }, "[" + [c.race, String(c.type || "").replace(/ Monster$/, "")].filter(Boolean).join(" / ") + "]") : null, h("p", { class: "cf-desc" }, c.desc || "")),
      h("div", { class: "cf-foot" }, isMonster ? h("span", { class: "cf-atk" }, c.linkval != null ? "ATK/" + (c.atk ?? "?") + "  LINK-" + c.linkval : "ATK/" + (c.atk ?? "?") + "  DEF/" + (c.def ?? "?")) : null, h("span", {}, [c.archetype, c.ygoId ? "#" + c.ygoId : null].filter(Boolean).join(" · ")))));
  }
  function sportsFace(c) {
    const g = String(c.grade || "Raw"), graded = !/^raw$/i.test(g);
    const label = graded ? g.replace(/^PSA 10$/, "PSA 10 · GEM MT").replace(/^PSA 9$/, "PSA 9 · MINT").replace(/^BGS 9\.5$/, "BGS 9.5 · GEM MINT") : "RAW · UNGRADED";
    return tilt(h("div", { class: "cface slab" + (graded ? "" : " raw"), role: "img", "aria-label": "Drawing of the card " + c.name },
      h("div", { class: "cf-label" }, h("span", {}, String(c.set || "").slice(0, 40)), h("b", {}, label)),
      h("div", { class: "cf-card" }, h("span", { class: "cf-mono" }, initials(c.player || c.name)), h("b", { class: "cf-player" }, c.player || c.name), h("span", { class: "cf-par" }, [c.parallel && c.parallel !== "Base" ? c.parallel : null, /Silver|Gold|Green|Hyper|Red|Blue|Purple|Orange|Pink|Black|Fast Break/i.test(c.name || "") ? (c.name.match(/(Silver|Gold|Green|Hyper|Red|Blue|Purple|Orange|Pink|Black|Fast Break)/i) || [])[1] : null].filter(Boolean)[0] || "Base"))));
  }

  /* ---------- the card's picture, or the viewer's own photo of it ---------- */
  // The real picture arrives as a data: URL through the image proxy (see MD.data.imageData); until it
  // does, and if it can't, the drawn face stands in.
  function realPicture(url, alt, w) {
    const fig = h("figure", { class: "realcard loading" }, h("div", { class: "rc-wait" }, h("span", { class: "spin" }), h("span", { class: "tiny" }, "Loading the card's picture…")));
    const p = D.imageData(url, w || 480).then((src) => new Promise((ok, bad) => {
      const img = h("img", { src, alt, decoding: "async" });
      img.onload = () => { fig.classList.remove("loading"); fig.replaceChildren(img); ok(img); };
      img.onerror = () => bad(new Error("The picture data was damaged."));
    }));
    return { el: tilt(fig), ready: p };
  }
  // Small picture for result grids: loads only once scrolled into view.
  function thumb(url, alt) {
    const box = h("span", { class: "rthumb" });
    if (!url || !D.available()) return box;
    const go = () => D.imageData(url, 200).then((src) => { const img = h("img", { src, alt: alt || "", decoding: "async" }); img.onload = () => box.replaceChildren(img); }).catch(() => box.classList.add("none"));
    if (typeof IntersectionObserver === "undefined") { go(); return box; }
    const io = new IntersectionObserver((es) => { if (es.some(e => e.isIntersecting)) { io.disconnect(); go(); } }, { rootMargin: "120px" });
    setTimeout(() => io.observe(box), 0);
    return box;
  }
  let assetsCap;
  const assetsNs = () => assetsCap || (assetsCap = (G.claude && G.claude.use ? G.claude.use("assets").catch(() => null) : Promise.resolve(null)));
  const SOURCE = { pokemon: "TCGdex", yugioh: "YGOPRODeck", sports: "CardChain AI" };
  function cardVisual(app, kind, c, assetId, imageUrl) {
    const id = "ph_" + String(assetId).replace(/[^A-Za-z0-9_-]/g, "_");
    const wrap = h("div", { class: "stack cardvis" });
    let view = null; // "card" | "photo" when the viewer has both
    const drawn = () => kind === "pokemon" ? pokemonFace(c) : kind === "yugioh" ? ygoFace(c) : sportsFace(c);
    const draw = async () => {
      const doc = app.store.cached("photos").find(p => p.id === id);
      const showPhoto = doc && view !== "card";
      const note = h("p", { class: "tiny muted" });
      let face;
      if (showPhoto) {
        face = h("figure", { class: "myphoto" }, h("img", { src: doc.url && /^(blob|data):/.test(doc.url) ? doc.url : "/_blob/" + doc.ref, alt: "Your photo of " + (c.name || "this card"), onerror: (e) => { e.target.replaceWith(h("div", { class: "empty" }, "Your photo couldn't load in this view.")); } }), h("figcaption", { class: "tiny muted" }, "Your photo · added " + U.fmtDate(doc.at)));
      } else if (imageUrl && D.available()) {
        const pic = realPicture(imageUrl, (c.name || "Card") + (c.set ? ", " + c.set : ""), kind === "sports" ? 520 : 480);
        face = pic.el;
        note.textContent = "Card picture from " + (SOURCE[kind] || "the card database") + ".";
        pic.ready.catch(() => { const d = drawn(); if (face.isConnected) face.replaceWith(d); face = d; note.textContent = "The card's picture couldn't load right now, so this is a drawing made from its details. Reload the page to try again" + (imageUrl ? ", or open the picture in a new tab." : "."); });
      } else {
        face = drawn();
        note.textContent = kind === "sports" && !imageUrl ? "No picture is listed for this card, so this is a drawing made from its details." : "Pictures need the Exa connector; this is a drawing made from the card's details.";
      }
      const assets = app.demo ? null : await assetsNs();
      const file = h("input", { type: "file", accept: "image/*", "aria-label": "Choose a photo of your card", hidden: true });
      const status = h("span", { class: "tiny muted" });
      file.onchange = async () => {
        const f = file.files && file.files[0]; if (!f) return;
        if (f.size > 15 * 1024 * 1024) { status.textContent = "That photo is over 15 MB. Choose a smaller one."; return; }
        status.textContent = "Uploading…";
        try {
          const up = await assets.upload(f);
          if (doc) { try { await assets.delete(doc.ref); } catch {} }
          await app.store.put("photos", id, { assetId, ref: up.id, url: up.url, at: Date.now(), name: c.name || "" });
          view = "photo"; U.toast("Photo saved"); draw();
        } catch (e) { status.textContent = "Upload failed: " + ({ unsupported_type: "use a JPG, PNG or WebP image", quota_exceeded: "this page's storage is full", not_granted: "only the page's owner can add photos" }[e && e.code] || U.errorText(e)); }
      };
      wrap.replaceChildren(
        doc && imageUrl ? U.seg(["Card picture", "Your photo"], showPhoto ? "Your photo" : "Card picture", (v) => { view = v === "Your photo" ? "photo" : "card"; draw(); }) : null,
        face,
        h("div", { class: "row", style: "gap:6px" },
          imageUrl ? h("a", { class: "btn ghost sm", href: imageUrl, target: "_blank", rel: "noopener noreferrer" }, "Full-size picture ↗") : null,
          assets ? h("button", { class: "btn ghost sm", type: "button", onclick: () => file.click() }, doc ? "Replace your photo" : "Add your photo") : null,
          assets && doc ? h("button", { class: "btn ghost sm", type: "button", onclick: async () => { try { await assets.delete(doc.ref); } catch {} await app.store.remove("photos", id); view = null; U.toast("Photo removed"); draw(); } }, "Remove photo") : null),
        file, status, showPhoto ? null : note,
        !doc && assets ? h("p", { class: "tiny muted" }, "Add a photo of your own copy to keep its condition on record; it's stored privately with this page.") : null);
    };
    draw();
    return wrap;
  }

  /* ---------- sold listings ---------- */
  const GRADE_FROM = (g) => { g = String(g || ""); if (/^raw$/i.test(g)) return "Ungraded"; if (/^PSA 10$/i.test(g)) return "PSA 10"; const m = g.match(/(\d+(?:\.\d)?)$/); return m ? "Grade " + m[1] : null; };
  function scatter(el, list, groups) {
    const W = Math.max(300, Math.round(el.clientWidth || 700)), H = 230, padL = 54, padR = 12, padT = 12, padB = 24;
    if (list.length < 1) { el.replaceChildren(); return; }
    const ts = list.map(s => Date.parse(s.date)), ps = list.map(s => s.price);
    let t0 = Math.min(...ts), t1 = Math.max(...ts); if (t1 === t0) { t0 -= 864e5 * 3; t1 += 864e5 * 3; }
    let lo = Math.min(...ps), hi = Math.max(...ps); const logScale = hi / Math.max(lo, 0.01) > 8;
    if (hi === lo) { lo *= 0.9; hi *= 1.1; }
    const f = logScale ? Math.log : (v) => v, a = f(Math.max(lo * 0.9, 0.01)), b = f(hi * 1.08);
    const x = (t) => (padL + (t - t0) / (t1 - t0) * (W - padL - padR)).toFixed(1), y = (v) => (padT + (b - f(Math.max(v, 0.01))) / (b - a) * (H - padT - padB)).toFixed(1);
    const ticks = [0, 0.5, 1].map(k => logScale ? Math.exp(a + (b - a) * k) : a + (b - a) * k);
    const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
    const d = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
    el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sale prices over time, ${list.length} sales">` +
      ticks.map(v => `<line class="sc-grid" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/><text class="sc-ax" x="${padL - 6}" y="${(+y(v) + 4).toFixed(1)}" text-anchor="end">$${esc(C.fmtNum(v, v >= 100 ? 0 : 2))}</text>`).join("") +
      list.map(s => `<circle class="sc-dot sg${groups.indexOf(s.grade) % 6}" cx="${x(Date.parse(s.date))}" cy="${y(s.price)}" r="4"><title>${esc(s.date + " · " + s.grade + " · $" + C.fmtNum(s.price, 2) + (s.source ? " · " + s.source : ""))}</title></circle>`).join("") +
      `<text class="sc-ax" x="${padL}" y="${H - 6}">${esc(d(t0))}</text><text class="sc-ax" x="${W - padR}" y="${H - 6}" text-anchor="end">${esc(d(t1))}</text>` +
      (logScale ? `<text class="sc-ax" x="${W - padR}" y="${padT + 4}" text-anchor="end">log scale</text>` : "") + `</svg>`;
  }
  /* card: {kind: "pokemon"|"yugioh"|"sports"|"other", name, number, set, setCode, printings, grade, assetId, valueAsset} */
  function salesSection(app, card) {
    const R = app.settings.displayCurrency, box = h("div", { class: "stack" }), linkKey = "pcLink." + card.assetId;
    const linkBtn = h("span", {});
    const printSel = card.kind === "yugioh" && card.printings && card.printings.length ? h("select", { "aria-label": "Printing", style: "width:auto;max-width:100%" }, card.printings.map(p => h("option", { value: p.code }, p.set + " · " + p.code + " · " + p.rarity))) : null;
    if (printSel) { printSel.value = app.ls.get("ygoPrint." + card.assetId, card.printings[0].code); printSel.onchange = () => { app.ls.set("ygoPrint." + card.assetId, printSel.value); app.ls.set(linkKey, null); load(); }; }
    const load = (override) => {
      const saved = override || app.ls.get(linkKey, null);
      U.async(box, () => {
        if (saved && saved.startsWith("q:")) return D.sales.search(saved.slice(2));
        return D.sales.find(Object.assign({}, card, { url: saved || null, setCode: printSel ? printSel.value : card.setCode }));
      }, render, { loading: "Reading sold listings from PriceCharting…" });
    };
    const manual = () => {
      const inp = h("input", { type: "url", placeholder: "https://www.pricecharting.com/game/…", "aria-label": "PriceCharting or SportsCardsPro page link" });
      return h("details", { class: "small" }, h("summary", {}, "Wrong card? Use a PriceCharting or SportsCardsPro page"), h("div", { class: "row", style: "margin-top:6px" }, h("div", { style: "flex:1;min-width:200px" }, inp), h("button", { class: "btn ghost sm", type: "button", onclick: () => { const u = inp.value.trim(); if (!/^https:\/\/www\.(pricecharting|sportscardspro)\.com\/game\//.test(u)) { U.toast("Paste a pricecharting.com or sportscardspro.com card page link", null, true); return; } app.ls.set(linkKey, u); load(u); } }, "Use this page")));
    };
    const render = (r) => {
      if (!r.isProduct) {
        box.append(r.candidates && r.candidates.length ? h("div", { class: "stack" }, h("p", { class: "small" }, "PriceCharting has several matches. Pick this card:"),
          U.table([{ t: "Card", v: "title" }, { t: "Set", v: "set" }, { t: "Price", v: (x) => x.price != null ? U.money(x.price, "USD", { price: true }) : "—", n: true }], r.candidates, { onRow: (x) => { const q = "q:" + x.title + " " + x.set; app.ls.set(linkKey, q); load(q); } }))
          : h("div", { class: "empty" }, "No sold listings found for this card on PriceCharting or SportsCardsPro."), manual());
        return;
      }
      linkBtn.replaceChildren(h("a", { class: "btn ghost sm", href: r.url, target: "_blank", rel: "noopener noreferrer" }, /sportscardspro/.test(r.url) ? "SportsCardsPro ↗" : "PriceCharting ↗"));
      const groups = [...new Set(r.sales.map(s => s.grade))];
      const fxq = R !== "USD" ? app.rates.quote("USD", R) : null;
      let cur = app.ls.get("salesGrade." + card.assetId, null) || GRADE_FROM(card.grade);
      if (!groups.includes(cur)) cur = "All";
      const segBox = h("div", {}), stats = h("div", {}), chart = h("div", { class: "salechart" }), legend = h("div", { class: "legend-row" }), tblBox = h("div", {}), valueRow = h("div", {});
      const show = (g) => {
        cur = g; app.ls.set("salesGrade." + card.assetId, g);
        segBox.replaceChildren(U.seg(["All"].concat(groups), g, show));
        const list = (g === "All" ? r.sales : r.sales.filter(s => s.grade === g)).slice().sort((a, b) => b.date.localeCompare(a.date));
        const ps = list.map(s => s.price).sort((a, b) => a - b), med = ps.length ? C.percentile(ps, 0.5) : null;
        stats.replaceChildren(U.kv([["Sales listed", String(list.length)], ["Dates", list.length ? U.fmtDate(list[list.length - 1].date) + " – " + U.fmtDate(list[0].date) : "—"], ["Median sale", med != null ? U.money(med, "USD", { price: true }) : "—"], ["Lowest – highest", ps.length ? U.money(ps[0], "USD", { price: true }) + " – " + U.money(ps[ps.length - 1], "USD", { price: true }) : "—"], ["Most recent", list[0] ? U.money(list[0].price, "USD", { price: true }) + " · " + U.fmtDate(list[0].date) : "—"]]));
        scatter(chart, list, groups);
        legend.replaceChildren(...(g === "All" ? groups : [g]).map(x => h("span", {}, h("i", { class: "swatch sq sg" + (groups.indexOf(x) % 6) }), x)));
        const cols = [{ t: "Sold", v: (s) => U.fmtDate(s.date), sort: (s) => s.date }, { t: "Grade", v: "grade", sort: (s) => s.grade }, { t: "Listing", v: (s) => h("span", { class: "small" }, s.title), sort: (s) => s.title }, { t: "Where", v: "source", sort: (s) => s.source },
          { t: "Price", v: (s) => h("span", { title: s.alt ? "PriceCharting shows two prices for this sale (often a best offer); the first is used." : "" }, U.money(s.price, "USD", { price: true }) + (s.alt ? " †" : "")), sort: (s) => s.price, n: true }];
        if (fxq) cols.push({ t: "≈ " + R, v: (s) => U.money(C.convert(s.price, fxq), R, { price: true }), sort: (s) => s.price, n: true });
        tblBox.replaceChildren(U.dataTable(cols, list, { key: "sales." + card.kind, sort: [0, -1], pageSize: 25, noun: "sales", placeholder: "Filter listings…" }));
        valueRow.replaceChildren(card.valueAsset && med != null ? h("div", { class: "row" }, h("button", { class: "btn ghost sm", type: "button", onclick: async () => { await app.store.put("comps", MD.store.newId(), { assetId: card.valueAsset.id, date: new Date().toISOString().slice(0, 10), price: String(+med.toFixed(2)), currency: "USD", venue: "PriceCharting median of " + list.length + " sales (" + g + ")", grade: g, fees: "0", shipping: "0", url: r.url, verified: false, createdAt: Date.now() }); U.toast("Portfolio value set", U.money(med, "USD") + " from the median sale"); } }, "Value this card in my portfolio at the median (" + U.money(med, "USD", { price: true }) + ")")) : null);
      };
      box.append(
        h("div", { class: "row between" }, h("strong", {}, r.title || card.name), h("span", { class: "tiny muted" }, "Prices in USD")),
        r.grades.length ? h("div", { class: "gradechips" }, r.grades.map(g => h("div", { class: "gchip" }, h("span", { class: "label" }, g.grade), h("b", { class: "num" }, U.money(g.price, "USD", { price: true })), g.change != null ? h("span", { class: "tiny num " + U.signCls(g.change) }, (g.change > 0 ? "+" : "") + C.fmtNum(g.change, 2)) : null, g.volume ? h("span", { class: "tiny muted" }, g.volume) : null))) : null,
        r.sales.length ? h("div", { class: "stack" }, segBox, stats, chart, legend, tblBox, valueRow) : h("div", { class: "empty" }, "PriceCharting lists no sold listings for this card yet."),
        h("p", { class: "tiny muted" }, "Sold listings from eBay, TCGplayer, Fanatics and other marketplaces, as collected by " + (/sportscardspro/.test(r.url) ? "SportsCardsPro" : "PriceCharting") + ": the most recent 30 to 60 per grade, which for slow-selling grades reaches back years. Older sales need a PriceCharting subscription. Check listing titles for mislabelled sales."),
        manual());
      show(cur);
    };
    load();
    const sec = U.section("Sales history", h("div", { class: "stack" }, printSel ? U.field("Printing", printSel) : null, box), [linkBtn]);
    sec.id = "sec-sales";
    return sec;
  }

  MD.cards = { cardVisual, salesSection, pokemonFace, ygoFace, sportsFace, thumb, realPicture };
})(typeof window !== "undefined" ? window : globalThis);
