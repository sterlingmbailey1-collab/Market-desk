/* Market Desk data layer. Every network read goes through the viewer's Exa connector (web_fetch_exa),
   because the page itself cannot reach other hosts. Each adapter returns normalized values that carry
   source, timestamp, currency/unit and a status: Live | Delayed | Historical | Reference | Estimated. */
(function (G) {
  const MD = (G.MD = G.MD || {});
  const C = MD.core;
  let mcp = null;
  const cache = new Map();
  const listeners = new Set();
  const health = new Map(); // providerId -> {ok, at, ms, err}

  class DataError extends Error { constructor(code, msg, provider) { super(msg); this.code = code; this.provider = provider; } }
  const arr = (x) => Array.isArray(x) ? x : [];
  const num = (s) => { const n = parseFloat(String(s ?? "").replace(/[$,%\s]/g, "")); return isFinite(n) ? n : null; };
  const ymd = (d) => d.toISOString().slice(0, 10);
  const daysAgo = (n) => new Date(Date.now() - n * 864e5);
  const tzShift = () => -new Date().getTimezoneOffset() * 60;
  // Seconds to add to a UTC epoch to get the wall clock of a time zone (used for New York session times).
  function tzOffsetSec(tz) {
    try {
      const d = new Date(), p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(d).map(x => [x.type, x.value]));
      return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - d.getTime()) / 1000);
    } catch { return -4 * 3600; }
  }
  const MINUTE_TF = { "Live": 30, "15m": 15, "1H": 60, "4H": 240, "12H": 720 };
  const bust = (url) => url + (url.includes("?") ? "&" : "?") + "_=" + Date.now();

  /* ---------- provider registry (documentation shown in Settings → Data sources) ---------- */
  const PROVIDERS = [
    { id: "nasdaq", name: "Nasdaq.com public API", host: "api.nasdaq.com", covers: "US-listed stocks, ETFs and ADRs: quotes, daily and intraday history, company summary, annual financial statements, earnings and economic calendars", frequency: "Last-sale quotes; marked delayed when Nasdaq says it is not real time", history: "About 10 years daily; latest session intraday (1-minute)", costs: "Free public endpoints, no key. Unofficial: no SLA, may change or rate-limit.", licensing: "Nasdaq website terms. Personal, non-commercial display. Not licensed for redistribution.", storage: "Not stored; cached in memory for under a minute.", limits: "No international primary listings. Fundamentals are annual, as reported by Nasdaq." },
    { id: "coingecko", name: "CoinGecko public API", host: "api.coingecko.com", covers: "Crypto search, prices in 40+ quote currencies, market cap, supply, all-time high, 7d/30d/1y change, OHLC up to 365 days", frequency: "About every 1–5 minutes", history: "365 days on the free tier", costs: "Free tier, no key; low rate limits.", licensing: "CoinGecko API terms; attribution required.", storage: "Not stored.", limits: "Free tier caps history at one year and may throttle." },
    { id: "kraken", name: "Kraken public market data", host: "api.kraken.com", covers: "Crypto and major FX pairs (EUR, GBP, AUD, CAD, CHF, JPY vs USD): OHLC candles, live bid/ask", frequency: "Real time", history: "Last 720 candles per interval (weekly candles reach back to 2013 for BTC)", costs: "Free, no key.", licensing: "Kraken API terms.", storage: "Not stored.", limits: "Only pairs Kraken lists. Prices are Kraken's venue prices, not a consolidated benchmark." },
    { id: "cryptocom", name: "Crypto.com Exchange (connector)", host: "Crypto.com connector", covers: "Live crypto tickers (last trade, best bid/ask, 24h change) and 1-minute candles", frequency: "Real time", history: "Last 50 candles per request", costs: "Free, no key; uses your Crypto.com connector.", licensing: "Crypto.com terms.", storage: "Not stored.", limits: "Only coins listed on Crypto.com Exchange; prices are that venue's." },
    { id: "coinbase", name: "Coinbase exchange rates", host: "api.coinbase.com", covers: "Indicative mid rates for ~160 fiat currencies and cryptoassets against USD", frequency: "About every minute", history: "None", costs: "Free, no key.", licensing: "Coinbase API terms.", storage: "Not stored.", limits: "Indicative mid only, no bid/ask. Not executable. No timestamp is returned, so the fetch time is used." },
    { id: "frankfurter", name: "Frankfurter (European Central Bank reference rates)", host: "api.frankfurter.app", covers: "Daily ECB reference rates for 30 currencies since 1999; any cross among them", frequency: "Once per business day around 16:00 CET", history: "Since 4 Jan 1999", costs: "Free, open source, no key.", licensing: "ECB data may be reused with attribution.", storage: "Historical rates used for cost basis are cached in memory.", limits: "Reference fixings, not tradable rates. Only the 30 ECB currencies." },
    { id: "goldapi", name: "gold-api.com", host: "api.gold-api.com", covers: "Spot gold, silver, platinum, palladium in USD per troy ounce", frequency: "Real time (seconds)", history: "Not on the free tier", costs: "Free spot endpoint, no key; history requires a paid key.", licensing: "gold-api.com terms.", storage: "Not stored.", limits: "Spot benchmark only. Dealer premiums, spreads and local taxes are not included." },
    { id: "tcgdex", name: "TCGdex", host: "api.tcgdex.net", covers: "Pokémon TCG cards, sets, variants, Standard/Expanded legality, Cardmarket (EUR) and TCGplayer (USD) reference prices with 1/7/30-day averages", frequency: "Prices refreshed about daily", history: "Rolling averages only (1, 7, 30 days); no sale-by-sale history", costs: "Free, open source, no key.", licensing: "Community project; prices originate from Cardmarket and TCGplayer.", storage: "Not stored.", limits: "Reference market prices, not verified individual sales. Legality is TCGdex's mirror of official rules." },
    { id: "limitless", name: "Limitless TCG", host: "play.limitlesstcg.com", covers: "Pokémon online tournaments with standings and decklists", frequency: "As tournaments finish", history: "Recent tournaments", costs: "Free public API.", licensing: "Limitless terms.", storage: "Not stored.", limits: "Online grassroots events, not official Play! Pokémon events. Usage reflects these events only." },
    { id: "ygoprodeck", name: "YGOPRODeck", host: "db.ygoprodeck.com", covers: "Yu-Gi-Oh! cards, printings and rarities, TCG/OCG Forbidden & Limited status, card-level prices from TCGplayer, Cardmarket, eBay", frequency: "Prices about daily", history: "None", costs: "Free, no key; rate-limited.", licensing: "YGOPRODeck API terms.", storage: "Not stored.", limits: "Prices are card-level, not printing- or condition-specific. Ban status mirrors Konami; check the official list for decisions." },
    { id: "polymarket", name: "Polymarket", host: "gamma-api.polymarket.com", covers: "Event markets: implied probabilities, volume, liquidity, probability history", frequency: "Real time", history: "Full market life", costs: "Free, no key.", licensing: "Polymarket terms.", storage: "Not stored.", limits: "Odds reflect one venue's traders, not a forecast." },
    { id: "alphavantage", name: "Alpha Vantage (connector)", host: "Alpha Vantage connector", covers: "Gold and silver price history in USD per troy ounce", frequency: "Daily", history: "Daily, plus monthly back to 2011", costs: "Uses your Alpha Vantage connector. The free key allows about 25 requests a day, so each series is kept in this browser for 12 hours.", licensing: "Alpha Vantage terms.", storage: "Cached in this browser for 12 hours.", limits: "Gold and silver only. Daily values, not intraday; minute charts for gold use the PAX Gold proxy." },
    { id: "cardchain", name: "CardChain AI (connector)", host: "CardChain AI connector", covers: "Sports cards (baseball, football, basketball, hockey, soccer): card search, market and average price by grade (Raw, PSA, BGS, SGC), daily price points", frequency: "Daily price points", history: "The recent price points CardChain returns with each search", costs: "Uses your CardChain AI connector.", licensing: "CardChain AI terms.", storage: "Not stored; cached in memory for 10 minutes.", limits: "CardChain's own aggregation of sales, not individually verified sales. Thinly traded cards have few or stale points." },
    { id: "kartenankauf", name: "karten-ankauf.de (connector)", host: "karten-ankauf.de connector", covers: "One German dealer's buyback offers in EUR for single Pokémon and Yu-Gi-Oh! cards, by printing, condition and language", frequency: "Recalculated daily around 02:00 German time", history: "None", costs: "Free; uses your karten-ankauf.de connector. The dealer logs each lookup for rate limiting and sale attribution.", licensing: "karten-ankauf.de terms.", storage: "Not stored.", limits: "One dealer's indicative buyback price, not market value; condition and authenticity are checked on arrival. Looked up only when you press the button." },
    { id: "bigdata", name: "Bigdata.com (connector)", host: "Bigdata.com connector", covers: "Indexed financial news with source, timestamp and passage excerpts; stock news tab and a research tool", frequency: "Continuous", history: "News archive", costs: "Uses your Bigdata.com connector; searches count against your Bigdata.com news quota.", licensing: "Bigdata.com and publisher terms. Links open the document on Bigdata.com.", storage: "Research reports keep headlines, links and short quotes.", limits: "Coverage varies by publisher. Loaded only when you open the News tab or research runs." },
    { id: "coinmarketcap", name: "CoinMarketCap (connector)", host: "CoinMarketCap connector", covers: "Latest news and web items for each cryptocurrency", frequency: "Continuous", history: "Latest 10 items per coin", costs: "Uses your CoinMarketCap connector; all its tools share one per-minute budget.", licensing: "CoinMarketCap and publisher terms.", storage: "Not stored; cached in memory for 10 minutes.", limits: "Asset matching is loose, so check each headline. Event and prediction pages with future dates are listed separately." },
    { id: "twelvedata", name: "Twelve Data (connector)", host: "Twelve Data connector", covers: "Second source for price history and quotes: US stocks and ETFs, crypto, FX; used automatically when the primary source fails", frequency: "Real time to end of day by plan", history: "Daily since listing; intraday for recent sessions", costs: "Uses your Twelve Data connector. Free plans allow about 8 requests a minute and 800 a day, so it is only used as a fallback.", licensing: "Twelve Data terms.", storage: "Not stored; cached in memory.", limits: "US listings only on the free plan. Intraday stock times are New York time." },
    { id: "zacks", name: "Zacks Data (connector)", host: "Zacks Data connector", covers: "US stocks: Zacks Rank, Value/Growth/Momentum style scores, Zacks target price, industry rank, EPS surprise, valuation multiples, and each Wall Street broker's rating and price target", frequency: "Zacks Rank recomputed daily; broker ratings as reported", history: "Current ratings plus each broker's previous rating and target", costs: "Uses your Zacks Data connector.", licensing: "Zacks Investment Research terms; attributed and linked on every view.", storage: "Not stored; cached in memory for 30 minutes.", limits: "North American equities (ETFs get fund metrics instead). Ratings and targets are opinions as of their dates, not forecasts by this app." },
    { id: "pricecharting", name: "PriceCharting / SportsCardsPro", host: "pricecharting.com", covers: "Sold listings for trading and sports cards (eBay, TCGplayer, Fanatics and others), with the sale date, listing title and price, plus current prices by grade", frequency: "As sales complete", history: "The most recent 30 to 60 sold listings per grade; for slower grades that reaches back years", costs: "Free pages, read through your Exa connector.", licensing: "PriceCharting terms; each sale links back to the card's page.", storage: "Not stored; cached in memory for 30 minutes.", limits: "Older sales need a PriceCharting subscription. Listings are matched to grades by PriceCharting; check titles for mislabelled sales." },
    { id: "weserv", name: "images.weserv.nl image proxy", host: "images.weserv.nl", covers: "Card pictures (Pokémon from TCGdex, Yu-Gi-Oh! from YGOPRODeck, sports cards from CardChain AI), resized and re-encoded so they can display inside this page", frequency: "On request", history: "None", costs: "Free, read through your Exa connector.", licensing: "Card artwork belongs to its publishers; shown for identification.", storage: "Kept in memory while the page is open (last 60 images).", limits: "A picture that fails to load falls back to a drawing made from the card's details." },
    { id: "vegasinsider", name: "VegasInsider odds", host: "vegasinsider.com", covers: "NFL, NBA, MLB, NHL, college football and basketball, WNBA: point spread, total and moneyline at Bet365, BetMGM, DraftKings, Caesars, FanDuel, Hard Rock, Fanatics and Kalshi, plus opening line and consensus", frequency: "Pages refresh through the day; the copy read can lag by hours", history: "Opening line only", costs: "Free pages, read through your Exa connector.", licensing: "VegasInsider terms; odds link back to the page.", storage: "Not stored; cached in memory for 5 minutes.", limits: "Odds move quickly. Always confirm the price in the sportsbook before betting. The page's own update time is shown." },
    { id: "sportsline", name: "SportsLine odds", host: "sportsline.com", covers: "Premier League, La Liga, Serie A, Bundesliga, Ligue 1 (and US leagues as a backup): moneyline, spread and total at Caesars, DraftKings, FanDuel and bet365, with opening lines and consensus", frequency: "Pages refresh through the day; the copy read can lag by hours", history: "Opening line only", costs: "Free pages, read through your Exa connector.", licensing: "SportsLine terms; odds link back to the page.", storage: "Not stored; cached in memory for 5 minutes.", limits: "Soccer moneylines are 90-minute prices without the draw column; the draw comes from Kalshi and the Statz model. One unlabelled book column is left out." },
    { id: "kalshi", name: "Kalshi exchange", host: "api.elections.kalshi.com", covers: "Soccer match markets (home win, away win, tie) for the five big European leagues: bid, ask, last trade, volume", frequency: "Real time", history: "Current prices only here", costs: "Free public API, read through your Exa connector.", licensing: "Kalshi terms.", storage: "Not stored; cached in memory for 1 minute.", limits: "Prices are before Kalshi's trading fee. Kalshi is a regulated exchange, not a sportsbook; availability depends on where you live." },
    { id: "statz", name: "Statz (connector)", host: "Statz connector", covers: "Soccer model projections for upcoming fixtures: home/draw/away probabilities and projected goals, plus team and player leaders", frequency: "Updated before each matchday", history: "None", costs: "Uses your Statz connector.", licensing: "Statz terms; projections are model estimates.", storage: "Not stored.", limits: "Statz gives no odds or betting advice; Market Desk compares its probabilities with the market's." },
    { id: "capitoltrades", name: "Capitol Trades", host: "capitoltrades.com", covers: "US Congress members' disclosed stock trades (STOCK Act periodic transaction reports): issuer, trade and publish dates, filing delay, buy/sell, size range, plus each member's party, chamber, state, trade count and most-traded sectors", frequency: "As filings are published (members have up to 45 days to disclose)", history: "The most recent trades per member (about 15 on the first page); the site keeps three years", costs: "Free pages, read through your Exa connector.", licensing: "Capitol Trades terms; each member links back to their page and the official filing.", storage: "Measured returns are cached in your account for 12 hours.", limits: "Sizes are disclosed as ranges, not exact amounts. Spouse and managed-account trades are included as filed. A disclosed trade says nothing about why it was made." },
    { id: "dataroma", name: "Dataroma", host: "dataroma.com", covers: "Superinvestor portfolios from 13F filings: holdings with weight, shares, reported price, current price and change, plus quarterly buys and sells", frequency: "Quarterly (13F filings are due 45 days after each quarter)", history: "Current portfolio and recent quarters of activity", costs: "Free pages, read through your Exa connector.", licensing: "Dataroma terms; quote data on its pages is provided by Intrinio.", storage: "Cached in memory for 10 minutes.", limits: "13F filings show US-listed long positions only (no shorts, cash, bonds or non-US holdings) and are already up to 45 days old when published." },
    { id: "fmp", name: "Financial Modeling Prep (connector)", host: "FMP connector", covers: "Latest House and Senate financial disclosures with the official filing link", frequency: "As filings are published", history: "Latest disclosures only on your plan", costs: "Uses your FMP connector.", licensing: "FMP terms; each row links to the official House or Senate record.", storage: "Not stored.", limits: "Search by member or by ticker needs a higher FMP plan, so the page uses Capitol Trades for each member's history." },
    { id: "exa", name: "Exa web search", host: "Exa connector", covers: "News, filings and web pages for research", frequency: "On request", history: "Web archive", costs: "Uses your Exa connector.", licensing: "Each source page has its own terms.", storage: "Research reports store titles, URLs and short quotes.", limits: "Search quality varies; all claims are cited to retrieved pages." }
  ];
  const UNAVAILABLE = [
    { name: "International primary-listing equity prices", why: "No free source this page can reach returns quotes for non-US exchanges. Your Twelve Data connector's free plan covers US listings only (other exchanges need its Grow plan or higher), and your FMP plan denies quote access. US-listed ADRs and country ETFs are covered through Nasdaq.", needs: "A Twelve Data or FMP plan that includes international quotes, or another licensed provider." },
    { name: "Grading population reports", why: "PSA, BGS and SGC population counts need authenticated APIs.", needs: "PSA API access with a backend." },
    { name: "Placing bets and sportsbook accounts", why: "Market Desk only reads published odds. It never logs into a sportsbook, places a bet or moves money.", needs: "Nothing: you place bets yourself, in a sportsbook that's legal where you are." },
    { name: "Player props and live in-game odds", why: "The free odds pages this page can read carry game lines only, and the copy read can lag by hours.", needs: "A licensed odds API (e.g. The Odds API, Sportradar) with a backend and key." },
    { name: "Platinum and palladium price history", why: "Alpha Vantage covers gold and silver only, and gold-api.com history needs a paid key.", needs: "A gold-api.com or LBMA data key. Platinum and palladium charts show live spot only." },
    { name: "Background alerts and scheduled research", why: "This page runs only while it is open; it has no server to run jobs.", needs: "A backend or scheduled job runner. Alerts are checked while the page is open, and research shows when it is due for a refresh." },
    { name: "Brokerage account sync and trading", why: "No authorized brokerage integration is connected, and this app never places trades or moves money.", needs: "A read-only aggregation provider (e.g. Plaid Investments, SnapTrade) with OAuth and a backend." },
    { name: "Official Play! Pokémon and Konami event results", why: "No public API.", needs: "Licensed data or manual entry." }
  ];

  function init(m) { mcp = m; }
  function available() { return !!mcp; }
  function onActivity(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function emit(e) { for (const l of listeners) try { l(e); } catch {} }
  function providerOf(url) { const h = url.replace(/^https?:\/\//, "").split("/")[0]; return (PROVIDERS.find(p => h.endsWith(p.host)) || { id: h }).id; }

  // At most a few web fetches in flight: a page that opens many panels queues its requests instead of
  // bursting past the source's rate limits. Identical requests in flight share one fetch.
  const MAX_INFLIGHT = 4; let inflight = 0; const waiters = []; const pending = new Map();
  const acquire = () => inflight < MAX_INFLIGHT ? (inflight++, Promise.resolve()) : new Promise(r => waiters.push(r));
  const release = () => { const next = waiters.shift(); if (next) next(); else inflight--; };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const TRANSIENT = /TIMEOUT|LIVECRAWL|429|RATE|LIMIT|UNAVAILABLE|5\d\d|no data|upstream|server_error/i;
  // opts.store = false keeps large bodies (card images) out of the shared page cache.
  async function fetchRaw(url, max = 120000, ttlMs = 30000, opts) {
    if (!mcp) throw new DataError("no_mcp", "Live data needs the Exa connector. Open this page on claude.ai with Exa connected.");
    const key = url + "|" + max, hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.body;
    if (pending.has(key)) return pending.get(key);
    const p = fetchOnce(url, max, opts && opts.store === false ? null : key).finally(() => pending.delete(key));
    pending.set(key, p);
    return p;
  }
  async function fetchOnce(url, max, key) {
    const pid = providerOf(url), pname = (PROVIDERS.find(p => p.id === pid) || { name: pid }).name;
    for (let attempt = 0; ; attempt++) {
      await acquire();
      const t0 = Date.now();
      emit({ type: "start", provider: pid });
      let res = null, err = null;
      try { res = await mcp.callTool("Exa", "web_fetch_exa", { urls: [url], maxCharacters: max }, { cache: false }); } catch (e) { err = e; } finally { release(); }
      if (err) {
        const code = (err && err.code) || "upstream_error";
        if (attempt === 0 && !LIFECYCLE.includes(code) && TRANSIENT.test(code + " " + (err.message || ""))) { emit({ type: "end", provider: pid, ok: false }); await sleep(1200 + Math.random() * 600); continue; }
        health.set(pid, { ok: false, at: Date.now(), err: code }); emit({ type: "end", provider: pid, ok: false });
        throw new DataError(code, (err && err.message) || "Request failed", pid);
      }
      const text = arr(res && res.content).filter(b => b && b.type === "text").map(b => b.text).join("\n") || (typeof (res && res.payload) === "string" ? res.payload : "");
      const m = text.match(/^URL: .*$/m);
      if (!m) {
        const e = text.match(/Error fetching[^:]*:\s*(\S+)/), why = e ? e[1] : "no data";
        emit({ type: "end", provider: pid, ok: false });
        if (attempt === 0 && TRANSIENT.test(why)) { await sleep(1200 + Math.random() * 600); continue; }
        health.set(pid, { ok: false, at: Date.now(), err: why });
        throw new DataError("fetch_failed", pname + " didn't answer" + (why !== "no data" ? " (" + why + ")" : "") + ". It may be busy; try again in a moment.", pid);
      }
      const body = text.slice(m.index + m[0].length).trim();
      health.set(pid, { ok: true, at: Date.now(), ms: Date.now() - t0 }); emit({ type: "end", provider: pid, ok: true });
      if (key) { cache.set(key, { at: Date.now(), body }); if (cache.size > 300) cache.delete(cache.keys().next().value); }
      return body;
    }
  }
  async function fetchJSON(url, max, ttl) {
    const body = await fetchRaw(url, max, ttl);
    const i = body.search(/[\[{]/);
    try { return JSON.parse(body.slice(i)); } catch { throw new DataError("bad_data", "The data source returned something unreadable.", providerOf(url)); }
  }
  /* Card pictures. The page can't load images from other hosts, so the image is re-encoded by the
     images.weserv.nl proxy as base64 text, read through Exa, and shown from a data: URL. */
  const images = new Map();
  function imageData(url, w = 480) {
    if (!url || !/^https?:\/\//.test(url)) return Promise.reject(new DataError("bad_image", "No image address for this card.", "weserv"));
    const key = url + "|" + w;
    if (images.has(key)) return images.get(key);
    const proxy = "https://images.weserv.nl/?url=" + encodeURIComponent(url.replace(/^https?:\/\//, "")) + "&w=" + w + "&output=jpg&q=82&encoding=base64";
    const p = fetchRaw(proxy, 300000, 0, { store: false }).then((body) => {
      const m = body.match(/data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}/);
      if (!m || m[0].length < 600) throw new DataError("bad_image", "The card picture couldn't be read.", "weserv");
      return m[0];
    });
    images.set(key, p); p.catch(() => images.delete(key));
    if (images.size > 60) images.delete(images.keys().next().value);
    return p;
  }
  const all = (rx, s) => { rx.lastIndex = 0; return [...s.matchAll(rx)]; };
  function sortUniq(points) { points.sort((a, b) => a.time - b.time); const out = []; for (const p of points) if (!out.length || p.time > out[out.length - 1].time) out.push(p); return out; }
  function chunks(from, to, years) { const out = []; let s = new Date(from); while (s < to) { const e = new Date(s); e.setUTCFullYear(e.getUTCFullYear() + years); const end = e < to ? e : to; out.push([ymd(s), ymd(end)]); s = new Date(end.getTime() + 864e5); } return out; }
  const TF_DAYS = { "1D": 1, "1W": 7, "1M": 30, "3M": 91, "6M": 182, "1Y": 365, "2Y": 730, "3Y": 1096, "5Y": 1826, "10Y": 3652 };
  function tfStart(tf) { if (tf === "YTD") return new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)); return daysAgo(TF_DAYS[tf] || 365); }
  const RX = {
    nasdaqRow: /"date":"(\d{1,2})\/(\d{1,2})\/(\d{4})","close":"\$?([\d,.]+)","volume":"([^"]*)","open":"\$?([^"]*)","high":"\$?([^"]*)","low":"\$?([^"]*)"/g,
    nasdaqIntra: /"x":(\d{13}),"y":([\d.]+)/g,
    kraken: /\[(\d{10}),"([\d.]+)","([\d.]+)","([\d.]+)","([\d.]+)","[\d.]+","([\d.]+)",\d+\]/g,
    cgOhlc: /\[(\d{13}),([\d.eE+-]+),([\d.eE+-]+),([\d.eE+-]+),([\d.eE+-]+)\]/g,
    cgPrices: /\[(\d{13}),([\d.eE+-]+)\]/g,
    fx: /"(\d{4})-(\d{2})-(\d{2})":\{"[A-Z]{3}":([\d.]+)\}/g,
    poly: /"t":(\d+),"p":([\d.]+)/g
  };

  /* ---------- stocks & ETFs (Nasdaq) ---------- */
  const stocks = {
    async search(q) {
      const r = await fetchJSON("https://api.nasdaq.com/api/autocomplete/slookup/10?search=" + encodeURIComponent(q), 30000, 300000);
      return arr(r.data).filter(x => x.asset === "STOCKS" || x.asset === "ETF").map(x => ({ id: (x.asset === "ETF" ? "etf:" : "stock:") + x.symbol, cls: x.asset === "ETF" ? "etf" : "stock", symbol: x.symbol, name: x.name, exchange: x.exchange || "", sub: [x.exchange, x.subCategory, x.region].filter(Boolean).join(" · ") }));
    },
    async quote(sym, cls, fresh) {
      try { return await stocks.nasdaqQuote(sym, cls, fresh); }
      catch (e) {
        if (e && (e.code === "no_mcp" || e.code === "not_found")) throw e;
        try { const q = await twelve.quote(sym); return { id: (cls === "etf" ? "etf:" : "stock:") + sym, cls: cls === "etf" ? "etf" : "stock", symbol: sym, name: sym, exchange: "", listing: "US listing", currency: "USD", price: q.price, change: q.change, changePct: q.changePct, ts: Date.now(), tsNote: "latest daily bar " + q.asOf, status: "Delayed", marketStatus: "—", source: "Twelve Data (Nasdaq unavailable)", timezone: "America/New_York" }; }
        catch { throw e; }
      }
    },
    async nasdaqQuote(sym, cls, fresh) {
      const ac = cls === "etf" ? "etf" : "stocks";
      const u = `https://api.nasdaq.com/api/quote/${encodeURIComponent(sym)}/info?assetclass=${ac}`;
      let r = await fetchJSON(fresh ? bust(u) : u, 20000, fresh ? 0 : 20000);
      let usedClass = cls;
      if (!r || !r.data) { const alt = ac === "etf" ? "stocks" : "etf"; r = await fetchJSON(`https://api.nasdaq.com/api/quote/${encodeURIComponent(sym)}/info?assetclass=${alt}`, 20000, 20000); usedClass = alt === "etf" ? "etf" : "stock"; }
      const d = r && r.data; if (!d) throw new DataError("not_found", "Nasdaq has no quote for " + sym + ".", "nasdaq");
      const pd = d.primaryData || {}, status = String(d.marketStatus || "");
      const open = /open|pre|after/i.test(status) && !/closed/i.test(status);
      const isAdr = /ADR|American Depositary|ADS/i.test(d.companyName || "") || /ADR/i.test(d.stockType || "");
      return { id: (usedClass === "etf" ? "etf:" : "stock:") + sym, cls: usedClass, symbol: sym, name: d.companyName || sym, exchange: d.exchange || "", listing: isAdr ? "US depositary receipt (ADR)" : "US listing", currency: "USD",
        price: num(pd.lastSalePrice), change: num(pd.netChange), changePct: num(pd.percentageChange), volume: pd.volume, ts: Date.now(), tsNote: open ? "last sale" : "last trade (" + (status || "closed") + ")",
        status: open ? (pd.isRealTime === false ? "Delayed" : "Live") : "Historical", marketStatus: status || "—", source: "Nasdaq", timezone: "America/New_York",
        week52: d.keyStats && d.keyStats.fiftyTwoWeekHighLow && d.keyStats.fiftyTwoWeekHighLow.value,
        nextEarnings: arr(d.notifications).flatMap(n => arr(n.eventTypes)).map(e => e.message || "").find(m => /Earnings Date/i.test(m))?.replace(/.*:\s*/, "") || null };
    },
    /* Lists. The screener is Nasdaq's snapshot and can lag a session; asset pages show the live quote. */
    // exchange: "nasdaq" or "nyse" (both when omitted). Share classes written with a slash (BRK/B) are skipped.
    async screener(offset = 0, limit = 100, exchange) {
      const r = await fetchJSON(`https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=${limit}&offset=${offset}&sortcolumn=marketCap&sortorder=desc` + (exchange ? "&exchange=" + exchange : ""), 160000, 300000);
      const t = r && r.data && r.data.table;
      return arr(t && t.rows).filter(x => /^[A-Z][A-Z.\-]{0,5}$/.test(String(x.symbol || ""))).map(x => ({ id: "stock:" + x.symbol, cls: "stock", symbol: x.symbol, name: String(x.name || "").replace(/ Common Stock$| Class A Common Stock$| Common Shares$/, ""), price: num(x.lastsale), change: num(x.netchange), changePct: num(x.pctchange), marketCap: num(x.marketCap), currency: "USD", exchange: exchange ? (exchange === "nyse" ? "NYSE" : "Nasdaq") : null }));
    },
    // status: currentMarket, preMarket or afterHours (outside those hours Nasdaq returns the last session's list).
    async movers(status = "currentMarket") {
      const r = await fetchJSON("https://api.nasdaq.com/api/marketmovers?assetclass=stocks&exchangestatus=" + status + "&limit=50", 160000, 120000);
      const d = (r && r.data && r.data.STOCKS) || {};
      const rows = (k, pct) => { const tb = d[k] || {}; return { asOf: tb.dataAsOf || "", rows: arr(tb.table && tb.table.rows).map(x => { const price = num(x.lastSalePrice), ch = num(x.lastSaleChange); return { id: "stock:" + x.symbol, cls: "stock", symbol: x.symbol, name: x.name, price, change: ch, changePct: pct ? num(x.change) : (price && ch != null && price - ch ? ch / (price - ch) * 100 : null), volume: pct ? null : num(x.change), currency: "USD" }; }) }; };
      return { asOf: ((d.MostAdvanced || d.MostActiveByShareVolume || d.MostDeclined || {}).dataAsOf || "").replace(/^Data as of /, ""), active: rows("MostActiveByShareVolume", false), gainers: rows("MostAdvanced", true), losers: rows("MostDeclined", true) };
    },
    // Sector, industry, average and today's volume, and the analysts' one-year target from Nasdaq's summary.
    async profile(sym, cls) {
      const r = await fetchJSON(`https://api.nasdaq.com/api/quote/${encodeURIComponent(sym)}/summary?assetclass=${cls === "etf" ? "etf" : "stocks"}`, 30000, 300000);
      const s = (r && r.data && r.data.summaryData) || {}, v = (k) => s[k] && s[k].value && s[k].value !== "N/A" ? s[k].value : null;
      return { sector: v("Sector"), industry: v("Industry"), avgVolume: num(v("AverageVolume")), volume: num(v("ShareVolume")), target1y: num(v("OneYrTarget")), previousClose: num(v("PreviousClose")) };
    },
    /* The latest session minute by minute from 4:00 a.m. ET (pre-market) through after-hours, with the previous
       close and the session's volume. Prices only: Nasdaq's chart has no per-minute volume. Nasdaq's timestamps are
       New York wall-clock time written as if it were UTC ("4:00 AM ET" = 04:00Z); they're converted to real UTC. */
    async intraday(sym, cls) {
      const r = await fetchJSON(bust(`https://api.nasdaq.com/api/quote/${encodeURIComponent(sym)}/chart?assetclass=${cls === "etf" ? "etf" : "stocks"}`), 260000, 15000);
      const d = r && r.data; if (!d || !arr(d.chart).length) throw new DataError("not_found", "No intraday data for " + sym + ".", "nasdaq");
      const off = tzOffsetSec("America/New_York");
      const pts = arr(d.chart).map(c => { const m = String((c.z && c.z.dateTime) || "").match(/(\d{1,2}):(\d{2}) (AM|PM)/), wall = Math.floor(+c.x / 1000); return { time: wall - off, value: +c.y, et: m ? ((+m[1] % 12) + (m[3] === "PM" ? 12 : 0)) * 60 + +m[2] : wall > 0 ? Math.floor((wall % 86400) / 60) : null }; }).filter(p => p.value > 0 && p.et != null && p.time > 0);
      const span = (xs) => xs.length ? { high: Math.max(...xs.map(p => p.value)), low: Math.min(...xs.map(p => p.value)), first: xs[0].value, last: xs[xs.length - 1].value } : null;
      const pre = pts.filter(p => p.et < 570), reg = pts.filter(p => p.et >= 570 && p.et < 960), post = pts.filter(p => p.et >= 960);
      return { symbol: sym, date: d.timeAsOf || null, previousClose: num(d.previousClose), last: num(d.lastSalePrice), changePct: num(d.percentageChange), volume: num(d.volume), points: pts, pre: span(pre), regular: span(reg), post: span(post), openSec: reg.length ? reg[0].time : null, source: "Nasdaq (1-minute, from 4:00 a.m. ET)" };
    },
    ETFS: [["SPY", "SPDR S&P 500"], ["VOO", "Vanguard S&P 500"], ["QQQ", "Invesco QQQ (Nasdaq-100)"], ["VTI", "Vanguard Total Stock Market"], ["IWM", "iShares Russell 2000"], ["DIA", "SPDR Dow Jones"], ["VT", "Vanguard Total World"], ["EFA", "iShares MSCI EAFE"], ["VEA", "Vanguard Developed Markets"], ["VWO", "Vanguard Emerging Markets"], ["EEM", "iShares MSCI Emerging Markets"], ["EWJ", "iShares MSCI Japan"], ["VGK", "Vanguard FTSE Europe"], ["INDA", "iShares MSCI India"], ["MCHI", "iShares MSCI China"], ["AGG", "iShares Core US Aggregate Bond"], ["TLT", "iShares 20+ Year Treasury"], ["SGOV", "iShares 0-3 Month Treasury"], ["LQD", "iShares Investment Grade Corporate"], ["HYG", "iShares High Yield Corporate"], ["GLD", "SPDR Gold Shares"], ["SLV", "iShares Silver Trust"], ["XLK", "Technology Select Sector"], ["XLF", "Financial Select Sector"], ["XLE", "Energy Select Sector"], ["XLV", "Health Care Select Sector"], ["SMH", "VanEck Semiconductor"], ["ARKK", "ARK Innovation"], ["IBIT", "iShares Bitcoin Trust"], ["SCHD", "Schwab US Dividend Equity"]],
    // Market-implied move from at-the-money straddles, per expiry. Nasdaq's option data can lag a session.
    async optionMoves(sym, price) {
      const from = ymd(new Date(Date.now() + 864e5)), to = ymd(new Date(Date.now() + 50 * 864e5));
      const r = await fetchJSON(`https://api.nasdaq.com/api/quote/${encodeURIComponent(sym)}/option-chain?assetclass=stocks&limit=200&fromdate=${from}&todate=${to}&money=at&type=all`, 200000, 600000);
      const d = r && r.data; if (!d || !d.table) throw new DataError("not_found", "No option chain for " + sym + ".", "nasdaq");
      const asOf = String(d.lastTrade || "").replace(/^LAST TRADE:\s*/i, "");
      const groups = []; let g = null;
      for (const row of arr(d.table.rows)) { if (row.expirygroup) { g = { expiry: row.expirygroup, rows: [] }; groups.push(g); continue; } if (g && row.strike) g.rows.push(row); }
      const out = [];
      for (const gr of groups) {
        const best = gr.rows.reduce((b, x) => !b || Math.abs(num(x.strike) - price) < Math.abs(num(b.strike) - price) ? x : b, null);
        if (!best) continue;
        const move = C.straddleMove(price, { bid: num(best.c_Bid), ask: num(best.c_Ask), last: num(best.c_Last) }, { bid: num(best.p_Bid), ask: num(best.p_Ask), last: num(best.p_Last) });
        const exp = Date.parse(gr.expiry + " 16:00 GMT-0500");
        if (move != null && isFinite(exp)) out.push({ expiry: gr.expiry, days: Math.max(1, Math.round((exp - Date.now()) / 864e5)), movePct: move, strike: num(best.strike), openInterest: (num(best.c_Openinterest) || 0) + (num(best.p_Openinterest) || 0) });
      }
      return { asOf, moves: out, source: "Nasdaq option chain (at-the-money straddle)" };
    },
    async shortInterest(sym) {
      const r = await fetchJSON(`https://api.nasdaq.com/api/quote/${encodeURIComponent(sym)}/short-interest?assetClass=stocks`, 30000, 3600000);
      const row = arr(r && r.data && r.data.shortInterestTable && r.data.shortInterestTable.rows)[0];
      return row ? { date: row.settlementDate, shares: num(row.interest), daysToCover: Number(row.daysToCover) || null, avgVolume: num(row.avgDailyShareVolume) } : null;
    },
    async summary(sym, cls) {
      const r = await fetchJSON(`https://api.nasdaq.com/api/quote/${encodeURIComponent(sym)}/summary?assetclass=${cls === "etf" ? "etf" : "stocks"}`, 30000, 300000);
      const s = (r && r.data && r.data.summaryData) || {};
      return Object.values(s).filter(x => x && x.label && x.value && x.value !== "N/A").map(x => ({ label: x.label.replace(/:$/, ""), value: x.label === "Market Cap" ? "USD " + C.fmtNum(num(x.value) / 1e9, 2) + "B" : x.value }));
    },
    // Insider (Form 4) activity: 3- and 12-month buy/sell counts and shares, plus the latest transactions.
    async insiders(sym) {
      const r = await fetchJSON(`https://api.nasdaq.com/api/company/${encodeURIComponent(sym)}/insider-trades?limit=25&type=ALL&sortColumn=lastDate&sortOrder=DESC`, 60000, 3600000);
      const d = (r && r.data) || {};
      const grid = (t) => Object.fromEntries(arr(t && t.rows).map(x => [x.insiderTrade, { m3: num(String(x.months3).replace(/[()]/g, "")) * (/\(/.test(x.months3) ? -1 : 1), m12: num(String(x.months12).replace(/[()]/g, "")) * (/\(/.test(x.months12) ? -1 : 1) }]));
      const rows = arr(d.transactionTable && d.transactionTable.table && d.transactionTable.table.rows).map(x => { const m = String(x.lastDate || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return { insider: x.insider, relation: x.relation, date: m ? m[3] + "-" + m[1].padStart(2, "0") + "-" + m[2].padStart(2, "0") : null, type: x.transactionType, owner: x.ownType, shares: num(x.sharesTraded), price: num(x.lastPrice), held: num(x.sharesHeld), openMarketBuy: /^Buy$|Open Market Buy|Purchase/i.test(x.transactionType || "") && !/Option|Non Open/i.test(x.transactionType || "") }; });
      if (!rows.length && !d.numberOfTrades) throw new DataError("not_found", "Nasdaq has no insider data for " + sym + ".", "nasdaq");
      return { counts: grid(d.numberOfTrades), shares: grid(d.numberOfSharesTraded), rows, total: num(d.transactionTable && d.transactionTable.totalRecords), url: "https://www.nasdaq.com/market-activity/stocks/" + String(sym).toLowerCase() + "/insider-activity" };
    },
    // Dividend history (Nasdaq covers Nasdaq-listed symbols only).
    async dividends(sym) {
      const r = await fetchJSON(`https://api.nasdaq.com/api/quote/${encodeURIComponent(sym)}/dividends?assetclass=stocks`, 40000, 3600000);
      const d = (r && r.data) || {};
      const iso = (s) => { const m = String(s || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? m[3] + "-" + m[1].padStart(2, "0") + "-" + m[2].padStart(2, "0") : null; };
      const rows = arr(d.dividends && d.dividends.rows).map(x => ({ exDate: iso(x.exOrEffDate), type: x.type, amount: num(x.amount), declared: iso(x.declarationDate), paid: iso(x.paymentDate) })).filter(x => x.exDate);
      const v = (k) => d[k] && d[k] !== "N/A" ? (/Date$/.test(k) ? iso(d[k]) : d[k]) : null;
      return { available: !!rows.length || !!v("yield"), message: r && r.message, yield: v("yield"), annual: v("annualizedDividend"), payoutRatio: v("payoutRatio"), exDate: v("exDividendDate"), payDate: v("dividendPaymentDate"), rows };
    },
    // Last four reported quarters: date reported, EPS, consensus and surprise.
    async earningsSurprise(sym) {
      const r = await fetchJSON(`https://api.nasdaq.com/api/company/${encodeURIComponent(sym)}/earnings-surprise`, 20000, 3600000);
      const rows = arr(r && r.data && r.data.earningsSurpriseTable && r.data.earningsSurpriseTable.rows);
      return rows.map(x => { const m = String(x.dateReported || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return { quarter: x.fiscalQtrEnd, reported: m ? m[3] + "-" + m[1].padStart(2, "0") + "-" + m[2].padStart(2, "0") : null, eps: num(x.eps), consensus: num(x.consensusForecast), surprisePct: num(x.percentageSurprise) }; }).filter(x => x.reported);
    },
    // Consensus EPS forecasts by quarter and year, with the last four weeks' revisions.
    async earningsForecast(sym) {
      const r = await fetchJSON(`https://api.nasdaq.com/api/analyst/${encodeURIComponent(sym)}/earnings-forecast`, 20000, 3600000);
      const rows = (t) => arr(t && t.rows).map(x => ({ period: x.fiscalEnd, consensus: num(x.consensusEPSForecast), high: num(x.highEPSForecast), low: num(x.lowEPSForecast), estimates: num(x.noOfEstimates), up: num(x.up), down: num(x.down) }));
      const d = (r && r.data) || {};
      return { quarterly: rows(d.quarterlyForecast), yearly: rows(d.yearlyForecast) };
    },
    async financials(sym) {
      const r = await fetchJSON(`https://api.nasdaq.com/api/company/${encodeURIComponent(sym)}/financials?frequency=1`, 120000, 3600000);
      const d = r && r.data; if (!d) throw new DataError("not_found", "No financial statements from Nasdaq for " + sym + ".", "nasdaq");
      const tbl = (t) => t ? { headers: Object.values(t.headers || {}), rows: arr(t.rows).map(r => Object.values(r)) } : null;
      return { income: tbl(d.incomeStatementTable), balance: tbl(d.balanceSheetTable), cash: tbl(d.cashFlowTable), ratios: tbl(d.financialRatiosTable), unitNote: "USD thousands as reported by Nasdaq" };
    },
    async history(sym, cls, tf) {
      const ac = cls === "etf" ? "etf" : "stocks";
      if (tf === "1D" || MINUTE_TF[tf]) {
        const body = await fetchRaw(`https://api.nasdaq.com/api/quote/${encodeURIComponent(sym)}/chart?assetclass=${ac}`, 260000, tf === "1D" ? 30000 : 10000);
        let pts = sortUniq(all(RX.nasdaqIntra, body).map(m => ({ time: Math.floor(+m[1] / 1000), value: +m[2] })));
        if (pts.length < 2) throw new DataError("not_found", "No intraday data for the latest session.", "nasdaq");
        const mins = MINUTE_TF[tf];
        if (mins) { const cut = pts[pts.length - 1].time - mins * 60; pts = pts.filter(p => p.time > cut); }
        const lbl = { "Live": "Live (seeded with the last 30 minutes)", "15m": "Last 15 minutes", "1H": "Last hour", "4H": "Last 4 hours", "12H": "Last 12 hours" }[tf];
        return { kind: "line", points: pts, intraday: true, barSec: 60, shift: tzOffsetSec("America/New_York"), currency: "USD", note: (lbl ? lbl + " of the latest session" : "Latest session") + " · 1-minute · New York time · Nasdaq", status: "Delayed", source: "Nasdaq" };
      }
      // Fixed two-year windows (2025–2026, 2023–2024, …) so every time frame reuses the same cached responses.
      const from = tfStart(tf), y0 = from.getUTCFullYear() - (from.getUTCFullYear() % 2), yNow = new Date().getUTCFullYear();
      const wins = []; for (let y = y0; y <= yNow; y += 2) wins.push([y + "-01-01", (y + 1) + "-12-31"]);
      let firstErr = null;
      const parts = await Promise.all(wins.map(([f, t]) => fetchRaw(`https://api.nasdaq.com/api/quote/${encodeURIComponent(sym)}/historical?assetclass=${ac}&fromdate=${f}&todate=${t}&limit=9999`, 170000, 600000).catch((e) => { firstErr = firstErr || e; return ""; })));
      const pts = [], vol = [];
      for (const body of parts) for (const m of all(RX.nasdaqRow, body)) {
        const time = Date.UTC(+m[3], +m[1] - 1, +m[2]) / 1000, close = num(m[4]); if (close == null) continue;
        const open = num(m[6]) ?? close; pts.push({ time, open, high: num(m[7]) ?? Math.max(open, close), low: num(m[8]) ?? Math.min(open, close), close });
        const v = num(m[5]); if (v != null) vol.push({ time, value: v });
      }
      const cut = Math.floor(from.getTime() / 1000);
      const p = sortUniq(pts).filter(x => x.time >= cut); if (p.length < 2) throw firstErr || new DataError("not_found", "No price history returned for " + sym + ".", "nasdaq");
      return { kind: "ohlc", points: p, volume: sortUniq(vol).filter(x => x.time >= cut), intraday: false, barSec: 86400, shift: 0, currency: "USD", note: "Daily · Nasdaq", status: "Historical", source: "Nasdaq", ppy: 252 };
    }
  };

  /* ---------- crypto (CoinGecko + Kraken) ---------- */
  const crypto = {
    async search(q) {
      const r = await fetchJSON("https://api.coingecko.com/api/v3/search?query=" + encodeURIComponent(q), 40000, 300000);
      return arr(r.coins).slice(0, 10).map(c => ({ id: "crypto:" + c.id, cls: "crypto", symbol: String(c.symbol).toUpperCase(), name: c.name, cgId: c.id, sub: "Rank " + (c.market_cap_rank || "—") }));
    },
    async markets(ids, vs = "usd") {
      const r = await fetchJSON(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=${vs.toLowerCase()}&ids=${ids.join(",")}&price_change_percentage=7d,30d,1y`, 60000, 30000);
      return arr(r).map(c => ({ id: "crypto:" + c.id, cgId: c.id, cls: "crypto", symbol: String(c.symbol).toUpperCase(), name: c.name, currency: vs.toUpperCase(), price: c.current_price, change: c.price_change_24h, changePct: c.price_change_percentage_24h,
        ts: c.last_updated ? Date.parse(c.last_updated) : Date.now(), status: "Live", source: "CoinGecko", marketCap: c.market_cap, rank: c.market_cap_rank, volume24h: c.total_volume, high24h: c.high_24h, low24h: c.low_24h,
        circulating: c.circulating_supply, totalSupply: c.total_supply, maxSupply: c.max_supply, ath: c.ath, athChangePct: c.ath_change_percentage, athDate: c.ath_date, ch7d: c.price_change_percentage_7d_in_currency, ch30d: c.price_change_percentage_30d_in_currency, ch1y: c.price_change_percentage_1y_in_currency }));
    },
    async top(vs = "usd", n = 25) {
      const r = await fetchJSON(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=${vs.toLowerCase()}&order=market_cap_desc&per_page=${n}&page=1&price_change_percentage=7d,30d,1y`, 120000, 60000);
      return arr(r).map(c => ({ id: "crypto:" + c.id, cgId: c.id, cls: "crypto", symbol: String(c.symbol).toUpperCase(), name: c.name, currency: vs.toUpperCase(), price: c.current_price, changePct: c.price_change_percentage_24h, ch7d: c.price_change_percentage_7d_in_currency, ch30d: c.price_change_percentage_30d_in_currency, ch1y: c.price_change_percentage_1y_in_currency, marketCap: c.market_cap, rank: c.market_cap_rank, volume24h: c.total_volume, ts: c.last_updated ? Date.parse(c.last_updated) : Date.now(), status: "Live", source: "CoinGecko" }));
    },
    VS: ["usd", "eur", "gbp", "jpy", "chf", "cad", "aud", "nzd", "cny", "hkd", "sgd", "krw", "inr", "twd", "thb", "myr", "idr", "php", "vnd", "brl", "mxn", "ars", "clp", "zar", "ngn", "try", "pln", "czk", "huf", "sek", "nok", "dkk", "aed", "sar", "ils", "pkr", "bdt", "btc", "eth", "xau", "xag"],
    async quote(cgId, vs) { const r = await crypto.markets([cgId], vs || "usd"); if (!r[0]) throw new DataError("not_found", "No price for " + cgId + ".", "coingecko"); return r[0]; },
    async history(cgId, symbol, tf) {
      const plan = KRAKEN_PLAN[tf] || KRAKEN_PLAN["1Y"];
      const since = krakenSince(plan, tf);
      try { const k = await kraken.ohlc(krakenSym(symbol) + "USD", plan[0], since, MINUTE_TF[tf] ? 5000 : 30000); return Object.assign(k, { note: KRAKEN_LABEL[plan[0]] + " candles · Kraken " + symbol + "/USD" + (k.intraday ? " · local time" : ""), currency: "USD", ppy: 365 }); }
      catch (e) {
        if (e.code === "no_mcp") throw e;
        if (MINUTE_TF[tf]) throw new DataError("unavailable", "Minute candles come from Kraken, which doesn't list " + symbol + ". Live prices still update in the Live view.", "kraken");
        const d = { "1D": 1, "1W": 7, "1M": 30, "3M": 90, "6M": 180 }[tf] || 365;
        const body = await fetchRaw(`https://api.coingecko.com/api/v3/coins/${cgId}/ohlc?vs_currency=usd&days=${d}`, 120000);
        const shift = d <= 30 ? tzShift() : 0;
        const pts = sortUniq(all(RX.cgOhlc, body).map(m => ({ time: Math.floor(+m[1] / 1000) + shift, open: +m[2], high: +m[3], low: +m[4], close: +m[5] })));
        if (pts.length < 2) throw new DataError("not_found", "No price history for this coin.", "coingecko");
        return { kind: "ohlc", points: pts, intraday: d <= 30, barSec: d === 1 ? 1800 : d <= 30 ? 14400 : 345600, shift, currency: "USD", status: "Historical", source: "CoinGecko", ppy: 365, note: "OHLC · CoinGecko" + ((tf === "5Y" || tf === "Max") ? " · free tier covers the last 365 days only" : "") };
      }
    }
  };
  // Kraken candle interval (minutes) and look-back (seconds; 0 = all, null = year to date) per time frame.
  const KRAKEN_PLAN = { "Live": [1, 1800], "15m": [1, 900], "1H": [1, 3600], "4H": [1, 14400], "12H": [1, 43200], "1D": [5, 86400], "1W": [30, 7 * 86400], "1M": [240, 30 * 86400], "3M": [240, 91 * 86400], "6M": [1440, 182 * 86400], "YTD": [1440, null], "1Y": [1440, 365 * 86400], "2Y": [1440, 0], "5Y": [10080, 1826 * 86400], "Max": [10080, 0] };
  const KRAKEN_LABEL = { 1: "1-minute", 5: "5-minute", 30: "30-minute", 240: "4-hour", 1440: "Daily", 10080: "Weekly" };
  function krakenSince(plan, tf) { return plan[1] === 0 ? 0 : plan[1] == null ? Math.floor(tfStart("YTD").getTime() / 1000) : Math.floor(Date.now() / 1000) - plan[1]; }
  const krakenSym = (s) => ({ BTC: "XBT", DOGE: "XDG" }[String(s).toUpperCase()] || String(s).toUpperCase());
  const STABLECOINS = [["tether", "USDT"], ["usd-coin", "USDC"], ["dai", "DAI"], ["first-digital-usd", "FDUSD"], ["ethena-usde", "USDe"]];

  /* ---------- connectors called directly over MCP (no web fetch) ---------- */
  const LIFECYCLE = ["server_not_connected", "not_in_manifest", "not_granted", "capability_disabled", "needs_reauth", "blocked_by_policy", "selection_required"];
  const payloadOf = (r) => { if (r && r.payload && typeof r.payload === "object") return r.payload; const t = arr(r && r.content).find(b => b.type === "text"); try { return t ? JSON.parse(t.text) : null; } catch { return null; } };
  const textOf = (r) => arr(r && r.content).filter(b => b && b.type === "text").map(b => b.text).join("\n") || (typeof (r && r.payload) === "string" ? r.payload : "");
  const ccache = new Map();
  // One wrapper per connector: health tracking, activity events, optional result cache, and a sticky
  // "not connected" state so a missing connector fails fast instead of on every call.
  function connector(server, pid) {
    const c = {
      server, pid, unavailable: false, until: 0, reason: "",
      async call(tool, input, ttlMs = 0) {
        if (!mcp) throw new DataError("no_mcp", "The " + server + " connector isn't available in this view.", pid);
        if (c.unavailable && Date.now() < c.until) throw new DataError("unavailable", c.reason, pid);
        const key = server + "|" + tool + "|" + JSON.stringify(input);
        const hit = ttlMs ? ccache.get(key) : null;
        if (hit && Date.now() - hit.at < ttlMs) return hit.v;
        const t0 = Date.now();
        emit({ type: "start", provider: pid });
        let r;
        try { r = await mcp.callTool(server, tool, input, { cache: false }); }
        catch (e) {
          const code = (e && e.code) || "upstream_error";
          health.set(pid, { ok: false, at: Date.now(), err: code }); emit({ type: "end", provider: pid, ok: false });
          if (LIFECYCLE.includes(code)) { c.unavailable = true; c.until = Date.now() + 60000; c.reason = server + " isn't connected here (" + code.replace(/_/g, " ") + "). Connect it in your claude.ai connector settings, then reload."; }
          throw new DataError(code, (e && e.message) || server + " request failed.", pid);
        }
        if (r && r.isError) { health.set(pid, { ok: false, at: Date.now(), err: "tool_error" }); emit({ type: "end", provider: pid, ok: false }); throw new DataError("upstream_error", server + ": " + (textOf(r) || "request failed").slice(0, 200), pid); }
        c.unavailable = false;
        const v = payloadOf(r) ?? { text: textOf(r) };
        // payload prefers structuredContent; keep the text block's JSON too, since some connectors shape them differently.
        if (v && typeof v === "object") { let tj = null; try { tj = JSON.parse(textOf(r)); } catch {} if (tj && typeof tj === "object" && tj !== v) Object.defineProperty(v, "__text", { value: tj }); }
        health.set(pid, { ok: true, at: Date.now(), ms: Date.now() - t0 }); emit({ type: "end", provider: pid, ok: true });
        if (ttlMs) { ccache.set(key, { at: Date.now(), v }); if (ccache.size > 200) ccache.delete(ccache.keys().next().value); }
        return v;
      }
    };
    connectors.push(c);
    return c;
  }
  const connectors = [];
  // Clears the remembered "not connected" state, e.g. after the viewer connects a connector.
  function resetConnectors() { for (const c of connectors) { c.unavailable = false; c.until = 0; } }
  // The variant of a connector result that carries `key` (structured payload or the text block's JSON).
  const withKey = (r, key) => r && r[key] !== undefined ? r : r && r.__text && r.__text[key] !== undefined ? r.__text : r;
  const rowsOf = (x) => Array.isArray(x) ? x : x && Array.isArray(x.headers) && Array.isArray(x.rows) ? x.rows.map(r => Object.fromEntries(x.headers.map((k, i) => [k, r[i]]))) : [];

  /* Crypto.com: live tickers */
  const cdcConn = connector("Crypto.com", "cryptocom");
  const cdc = {
    get unavailable() { return cdcConn.unavailable; },
    call: (tool, input) => cdcConn.call(tool, input),
    async ticker(sym) {
      let lastErr = null;
      for (const q of ["USD", "USDT"]) {
        try {
          const t = withKey(await cdc.call("get_ticker", { instrument_name: sym + "_" + q }), "last");
          if (t && Number(t.last) > 0) return { price: Number(t.last), bid: Number(t.best_bid) || null, ask: Number(t.best_ask) || null, changePct: t.change != null ? Number(t.change) * 100 : null, changeLabel: "24h", high24: Number(t.high), low24: Number(t.low), ts: Date.parse(t.timestamp) || Date.now(), currency: "USD", source: "Crypto.com " + sym + "/" + q, status: "Live" };
        } catch (e) { lastErr = e; if (cdc.unavailable) throw e; }
      }
      throw lastErr || new DataError("not_found", sym + " isn't listed on Crypto.com.", "cryptocom");
    }
  };

  /* Alpha Vantage: gold and silver history. The free key allows about 25 requests a day, so each
     series is kept in this browser for 12 hours. */
  const avConn = connector("Alpha Vantage MCP Server", "alphavantage");
  const av = {
    async metalHistory(sym, interval) {
      const key = "md.av." + sym + "." + interval, ttl = 12 * 3600e3;
      try { const s = JSON.parse(localStorage.getItem(key) || "null"); if (s && Date.now() - s.at < ttl && arr(s.points).length > 1) return s; } catch {}
      const r = withKey(await avConn.call("GOLD_SILVER_HISTORY", { symbol: sym, interval, datatype: "json", return_full_data: true }, ttl), "data");
      let rows = arr(r && r.data);
      if (!rows.length && r && typeof r.text === "string" && /^\s*(date|timestamp),/i.test(r.text)) rows = r.text.trim().split(/\r?\n/).slice(1).map(l => { const [date, price] = l.split(","); return { date, price }; });
      if (!rows.length) {
        const msg = String((r && (r.Information || r.Note || r["Error Message"] || r.text)) || "");
        throw new DataError(/rate|limit|premium|frequency|per day/i.test(msg) ? "rate_limited" : "not_found", msg ? "Alpha Vantage: " + msg.slice(0, 180) : "Alpha Vantage returned no " + sym + " history.", "alphavantage");
      }
      const points = sortUniq(rows.map(x => ({ time: Math.floor(Date.parse(x.date) / 1000), value: num(x.price) })).filter(p => p.time > 0 && p.value > 0));
      const out = { at: Date.now(), points, nominal: r && r.nominal };
      try { localStorage.setItem(key, JSON.stringify(out)); } catch {}
      return out;
    }
  };

  /* CardChain AI: sports-card search, market price by grade, daily price points */
  const ccConn = connector("CardChain AI", "cardchain");
  const GRADES = ["Raw", "PSA 10", "PSA 9", "PSA 8", "PSA 7", "BGS 10", "BGS 9.5", "BGS 9", "SGC 10", "SGC 9"];
  const SPORTS = ["Baseball", "Football", "Basketball", "Hockey", "Soccer"];
  const gradeSlug = (g) => String(g).replace(/\s+/g, "").toLowerCase();
  const cardchain = {
    GRADES, SPORTS,
    normalize(m, grade, query) {
      const hist = sortUniq(arr(m.priceHistory).filter(p => num(p.price) > 0 && Date.parse(p.date)).map(p => ({ time: Math.floor(Date.parse(p.date) / 864e5) * 86400, value: num(p.price) })));
      const price = num(m.currentPrice), extra = [m.parallel && m.parallel !== "Base" ? m.parallel : null].filter(Boolean);
      return { id: "sports:cc-" + m.card_id + "-" + gradeSlug(grade), cls: "sports", cardchainId: String(m.card_id), ccQuery: query, grade, symbol: m.player || String(m.name || "").slice(0, 18), name: m.name, player: m.player, set: m.set, year: m.year || null, image: m.imageUrl || null,
        price, avgPrice: num(m.avgPrice), history: hist, lastPoint: hist.length ? hist[hist.length - 1].time * 1000 : null, currency: "USD",
        sub: [m.set].concat(extra).filter(Boolean).join(" · ") + (price ? " · $" + price.toFixed(2) + " " + grade : " · no " + grade + " price"), source: "CardChain AI" };
    },
    async search(query, grade = "Raw", sport) {
      const input = { query: String(query).slice(0, 200), grade: GRADES.includes(grade) ? grade : "Raw" };
      if (SPORTS.includes(sport)) input.sport = sport;
      const r = withKey(await ccConn.call("search_cards", input, 10 * 60e3), "matches");
      return arr(r && r.matches).map(m => cardchain.normalize(m, input.grade, query));
    },
    // Re-find one card at a grade (CardChain returns prices for the requested grade only).
    async card(asset, grade) {
      const g = grade || asset.grade || "Raw";
      for (const q of [...new Set([asset.name, asset.ccQuery].filter(Boolean))]) {
        const hit = (await cardchain.search(q, g)).find(c => c.cardchainId === String(asset.cardchainId));
        if (hit) return hit;
      }
      throw new DataError("not_found", "CardChain AI no longer returns this card for a " + g + " search.", "cardchain");
    }
  };

  /* karten-ankauf.de: one German dealer's buyback offers for single Pokémon / Yu-Gi-Oh! cards.
     Only called when the viewer asks; each lookup is logged by the dealer for rate limiting. */
  const kaConn = connector("karten-ankauf.de", "kartenankauf");
  const dealer = {
    CONDITIONS: [["MT", "Mint"], ["NM", "Near mint"], ["EX", "Excellent"], ["GD", "Good"], ["LP", "Light played"], ["PL", "Played"], ["PO", "Poor"]],
    async search(name, game, set, number) {
      const input = { name: String(name).slice(0, 120), game };
      if (set) input.set = String(set);
      if (number) input.collector_number = String(number);
      const r = withKey(await kaConn.call("search_cards", input, 3600e3), "cards");
      if (r && r.ok === false) throw new DataError("not_found", "karten-ankauf.de: " + (r.error || r.message || "no match"), "kartenankauf");
      return arr(r && r.cards).map(c => ({ productId: c.product_id, name: String(c.name_en || c.name_de || "").trim(), set: c.set_name, setCode: c.set_abbreviation, number: c.collector_number, released: c.set_released, variants: c.variants || {}, languages: arr(c.languages_offered) }));
    },
    async price(productId, o = {}) {
      const input = { product_id: Number(productId) };
      for (const k of ["condition", "language"]) if (o[k]) input[k] = o[k];
      for (const k of ["reverse_holo", "first_edition", "foil"]) if (o[k]) input[k] = true;
      const r = withKey(await kaConn.call("get_buy_price", input, 30 * 60e3), "price_eur");
      if (!r || r.ok === false) throw new DataError("not_found", "karten-ankauf.de: " + ((r && (r.error || r.message)) || "no buyback price for this printing"), "kartenankauf");
      return { productId: r.product_id, name: String(r.name_en || "").trim(), set: r.set_name, number: r.collector_number, price: num(r.price_eur), priceClass: r.price_class, byCondition: r.price_by_condition || {}, assumed: r.assumed || {}, validUntil: r.prices_valid_until, url: r.offer_url_en || r.offer_url, currency: r.currency || "EUR", note: r.price_note || "" };
    }
  };

  /* Bigdata.com: indexed financial news with passages */
  const bdConn = connector("Bigdata.com", "bigdata");
  async function bigdataNews(text, maxChunks = 6) {
    const r = withKey(await bdConn.call("bigdata_search", { request: { search_mode: "smart", query: { text: String(text).slice(0, 400), max_chunks: maxChunks } } }, 10 * 60e3), "results");
    const zoned = (t) => /Z$|[+-]\d\d:?\d\d$/.test(t) ? t : t + "Z";
    return { provider: "Bigdata.com", items: arr(r && r.results).map(x => ({ id: x.id, title: x.headline, ts: x.timestamp ? Date.parse(zoned(String(x.timestamp))) || null : null, source: x.source && x.source.name, url: x.url, text: arr(x.chunks).map(c => c.text).join("\n\n") })) };
  }

  /* Twelve Data: second source for price history (US stocks/ETFs, crypto, FX) when the primary fails.
     Free plans allow about 8 requests a minute, so it is only used as a fallback. */
  const tdConn = connector("Twelve Data", "twelvedata");
  const TD_PLAN = { "Live": ["1min", 60], "15m": ["1min", 30], "1H": ["1min", 90], "4H": ["1min", 260], "12H": ["5min", 160], "1D": ["5min", 300], "1W": ["1h", 180] };
  const twelve = {
    symbolFor(asset) {
      const cls = asset.cls || clsOf(asset.id);
      if (cls === "stock" || cls === "etf") return asset.symbol;
      if (cls === "crypto" && asset.symbol) return String(asset.symbol).toUpperCase() + "/USD";
      if (cls === "fx" && asset.base && asset.quote) return asset.base + "/" + asset.quote;
      if (cls === "metal" && (asset.symbol === "XAU" || asset.symbol === "XAG")) return asset.symbol + "/USD";
      return null;
    },
    async series(symbol, interval, opts = {}) {
      const input = { symbol, interval, outputsize: opts.outputsize || 5000 };
      if (opts.start) input.start_date = opts.start;
      const r = await tdConn.call("get_time_series", input, /min|h$/.test(interval) ? 60e3 : 900e3);
      const text = typeof (r && r.result) === "string" ? r.result : typeof (r && r.text) === "string" ? r.text : (r && r.__text && r.__text.result) || "";
      const rows = String(text).trim().split(/\r?\n/).slice(1).map(l => l.split(";")).filter(c => c.length >= 5);
      if (!rows.length) throw new DataError("not_found", "Twelve Data: " + (String(text).slice(0, 140) || "no data for " + symbol), "twelvedata");
      return rows.map(c => ({ dt: c[0], open: num(c[1]), high: num(c[2]), low: num(c[3]), close: num(c[4]), volume: num(c[5]) })).filter(x => x.close != null);
    },
    async history(asset, tf) {
      const sym = twelve.symbolFor(asset); if (!sym) throw new DataError("unavailable", "No second source for this asset.", "twelvedata");
      const cls = asset.cls || clsOf(asset.id), isStock = cls === "stock" || cls === "etf";
      const intra = TD_PLAN[tf];
      const opts = intra ? { outputsize: intra[1] } : tf === "Max" ? { outputsize: 5000 } : { start: ymd(tfStart(tf)) };
      const interval = intra ? intra[0] : tf === "Max" ? "1week" : "1day";
      const rows = await twelve.series(sym, interval, opts);
      // Stock datetimes are New York wall-clock time; crypto and FX are UTC, shown in local time like the primary sources.
      const shift = intra ? (isStock ? tzOffsetSec("America/New_York") : tzShift()) : 0;
      const t = (dt) => Math.floor(Date.parse(dt.replace(" ", "T") + (dt.length > 10 ? "Z" : "T00:00:00Z")) / 1000) + (intra && !isStock ? shift : 0);
      let pts = sortUniq(rows.map(x => ({ time: t(x.dt), open: x.open ?? x.close, high: x.high ?? x.close, low: x.low ?? x.close, close: x.close })).filter(p => p.time > 0));
      if (isStock && (tf === "1D" || MINUTE_TF[tf]) && pts.length) { const day = Math.floor(pts[pts.length - 1].time / 86400); pts = pts.filter(p => Math.floor(p.time / 86400) === day); }
      if (MINUTE_TF[tf] && pts.length) { const cut = pts[pts.length - 1].time - MINUTE_TF[tf] * 60; pts = pts.filter(p => p.time > cut); }
      if (pts.length < 2) throw new DataError("not_found", "Twelve Data returned too little history for " + sym + ".", "twelvedata");
      const barSec = { "1min": 60, "5min": 300, "1h": 3600, "1day": 86400, "1week": 604800 }[interval];
      return { kind: "ohlc", points: pts, volume: sortUniq(rows.filter(x => x.volume != null).map(x => ({ time: t(x.dt), value: x.volume }))), intraday: !!intra, barSec, shift, currency: cls === "fx" ? asset.quote : "USD",
        status: intra ? "Delayed" : "Historical", source: "Twelve Data", ppy: cls === "crypto" ? 365 : 252, note: interval.replace("1day", "Daily").replace("1week", "Weekly").replace("1min", "1-minute").replace("5min", "5-minute").replace("1h", "Hourly") + " · Twelve Data (second source)" + (intra && isStock ? " · New York time" : intra ? " · local time" : "") };
    },
    // Last price and previous close from daily bars, for when the primary quote source fails.
    async quote(sym) {
      const rows = await twelve.series(sym, "1day", { outputsize: 2 });
      const last = rows[0], prev = rows[1];
      return { price: last.close, change: prev ? last.close - prev.close : null, changePct: prev ? (last.close / prev.close - 1) * 100 : null, asOf: last.dt };
    }
  };

  /* Zacks Data: Zacks Rank, style scores, targets and per-broker ratings for US equities */
  const zConn = connector("Zacks Data", "zacks");
  // Markdown tables keyed by the "## Section" above them (Zacks metrics come back as markdown).
  function mdTables(text) {
    const out = {}; let sec = "main", hdr = null;
    for (const line of String(text || "").split(/\r?\n/)) {
      const hm = line.match(/^#+\s*(.+)/); if (hm) { sec = hm[1].trim(); hdr = null; continue; }
      if (!/^\s*\|/.test(line)) { hdr = null; continue; }
      const cells = line.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
      if (cells.every(c => /^:?-{2,}:?$/.test(c))) continue;
      if (!hdr) { hdr = cells; out[sec] = []; continue; }
      out[sec].push(Object.fromEntries(hdr.map((k, i) => [k, cells[i] ?? ""])));
    }
    return out;
  }
  const zacks = {
    async metrics(sym) {
      const r = await zConn.call("get_zacks_metrics", { ticker: String(sym).toUpperCase() }, 30 * 60e3);
      let facts = {}, peers = [];
      if (r && typeof r.text === "string" && r.text.includes("|")) {
        const t = mdTables(r.text);
        const kf = t["Key Facts"] || t.main || [];
        for (const row of kf) if (row.field) facts[row.field] = row.value;
        peers = (t["Top Peers"] || []).map(x => ({ symbol: x.ticker, name: x["company name"], rank: num(x["zacks rank"]), rankText: x["zacks rank text"] }));
      } else if (r && typeof r === "object") facts = r.facts || r;
      if (!facts.ticker && !facts.zacks_rank && !facts.investment_category) throw new DataError("not_found", "Zacks has no data for " + sym + ".", "zacks");
      const v = (k) => facts[k] == null || facts[k] === "N/A" || facts[k] === "" ? null : facts[k];
      return { facts, v, n: (k) => num(v(k)), peers, asOf: v("last_trade_date"), source: "Zacks Investment Research", url: "https://www.zacks.com/stock/quote/" + encodeURIComponent(String(sym).toUpperCase()) + "?utm_source=zacks_mcp" };
    },
    async ratings(sym) {
      const r = withKey(await zConn.call("get_wall_st_rating", { ticker: String(sym).toUpperCase() }, 30 * 60e3), "records");
      if (r && r.status && r.status !== "ok") return { status: r.status, reason: r.status_reason || "", records: [] };
      const records = arr(r && r.records).map(x => ({ broker: x.broker, analyst: x.analyst, rating: x.rating, ratingSource: x.rating_source, prev: x.prev_rating, action: x.action, target: num(x.target_price), prevTarget: num(x.prev_target_price), upsidePct: num(x.upside_downside_pct), date: x.rating_date, zacksOwn: /^Zacks/i.test(String(x.broker)) }));
      return { status: "ok", price: num(r && r.current_price), priceAsOf: r && r.price_as_of, currency: (r && r.currency) || "USD", records };
    }
  };

  /* CoinMarketCap: latest news per coin */
  const cmcConn = connector("CoinMarketCap", "coinmarketcap");
  const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  function cmcDate(s) {
    const m = String(s || "").match(/(\d{1,2}) (\w+) (\d{4}) (\d{1,2}):(\d{2}) (AM|PM)(?: UTC([+-]\d+))?/i);
    if (!m) return Date.parse(s) || null;
    const hr = (+m[4] % 12) + (m[6].toUpperCase() === "PM" ? 12 : 0);
    return Date.UTC(+m[3], MONTHS.indexOf(m[2].toLowerCase()), +m[1], hr, +m[5]) - Number(m[7] || 0) * 3600e3;
  }
  const cmc = {
    ids: new Map(),
    async id(symbol) {
      const s = String(symbol).toUpperCase();
      if (cmc.ids.has(s)) return cmc.ids.get(s);
      const sr = await cmcConn.call("search_cryptos", { query: s }, 86400e3);
      const rows = rowsOf(sr).length ? rowsOf(sr) : rowsOf(sr && sr.__text);
      const best = rows.filter(r => String(r.symbol).toUpperCase() === s).sort((a, b) => (a.rank || 1e9) - (b.rank || 1e9))[0];
      if (!best) throw new DataError("not_found", "CoinMarketCap doesn't list " + s + ".", "coinmarketcap");
      cmc.ids.set(s, String(best.id));
      return String(best.id);
    },
    async news(symbol, limit = 8) {
      const id = await cmc.id(symbol);
      const r = withKey(await cmcConn.call("get_crypto_latest_news", { id, limit }, 10 * 60e3), "news");
      const now = Date.now();
      const items = rowsOf(r && r.news != null ? r.news : r).map(x => ({ title: x.title, description: x.description || "", text: x.content || "", url: x.url, ts: cmcDate(x.publishedAt), quality: num(x.quality) })).filter(x => x.title && x.url);
      // Event and prediction pages carry future dates; keep them apart from the news.
      return { provider: "CoinMarketCap", items: items.filter(x => !x.ts || x.ts <= now + 3600e3), upcoming: items.filter(x => x.ts && x.ts > now + 3600e3) };
    }
  };

  /* ---------- live quotes (one fresh read per call; used by the live ticker) ---------- */
  async function liveQuote(asset) {
    const cls = asset.cls || clsOf(asset.id);
    if (cls === "crypto") {
      const sym = String(asset.symbol || "").toUpperCase();
      try { return await cdc.ticker(sym); } catch (e) { /* fall through to Kraken, then Coinbase */ }
      try { const t = await kraken.ticker(krakenSym(sym) + "USD", true); return { price: +t.last, bid: +t.bid, ask: +t.ask, changePct: t.open ? (t.last / t.open - 1) * 100 : null, changeLabel: "since 00:00 UTC", ts: Date.now(), currency: "USD", source: "Kraken last trade", status: "Live" }; } catch (e) { if (e.code === "no_mcp") throw e; }
      const r = await fetchJSON(bust(`https://api.coinbase.com/v2/prices/${sym}-USD/spot`), 2000, 0);
      return { price: Number(r.data.amount), ts: Date.now(), currency: "USD", source: "Coinbase spot", status: "Live" };
    }
    if (cls === "fx") {
      const kp = fx.krakenPair(asset.base, asset.quote);
      if (kp) { try { const t = await kraken.ticker(kp, true); if (!t.thin) return { price: +t.last, bid: +t.bid, ask: +t.ask, changePct: t.open ? (t.last / t.open - 1) * 100 : null, changeLabel: "since 00:00 UTC", ts: Date.now(), currency: asset.quote, source: "Kraken " + kp, status: "Live" }; } catch (e) { if (e.code === "no_mcp") throw e; } }
      const r = await fetchJSON(bust(`https://api.coinbase.com/v2/prices/${asset.base}-${asset.quote}/spot`), 2000, 0);
      return { price: Number(r.data.amount), ts: Date.now(), currency: asset.quote, source: "Coinbase indicative mid", status: "Live" };
    }
    if (cls === "metal") return Object.assign(await metals.spotFresh(asset.symbol), { currency: "USD" });
    if (cls === "stock" || cls === "etf") { const q = await stocks.quote(asset.symbol, cls, true); return Object.assign(q, { marketOpen: q.status !== "Historical" }); }
    throw new DataError("unavailable", "Live updates aren't available for this kind of asset; its reference price updates about daily.", "manual");
  }
  function liveSupported(asset) { return ["crypto", "fx", "metal", "stock", "etf"].includes(asset.cls || clsOf(asset.id)); }

  /* ---------- Kraken ---------- */
  const kraken = {
    async ohlc(pair, interval, since, ttl) {
      const body = await fetchRaw(`https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${interval}&since=${since}`, 170000, ttl ?? 30000);
      const err = body.match(/"error":\["([^"]+)"/); if (err) throw new DataError("not_found", err[1], "kraken");
      const shift = interval < 1440 ? tzShift() : 0, pts = [], vol = [];
      for (const m of all(RX.kraken, body)) { const time = +m[1] + shift, close = +m[5]; pts.push({ time, open: +m[2], high: +m[3], low: +m[4], close }); vol.push({ time, value: +m[6] * close }); }
      if (!pts.length) throw new DataError("not_found", "No candles returned.", "kraken");
      return { kind: "ohlc", points: sortUniq(pts), volume: sortUniq(vol), intraday: interval < 1440, barSec: interval * 60, shift, status: "Historical", source: "Kraken" };
    },
    async ticker(pair, fresh) {
      const r = await fetchJSON(fresh ? bust(`https://api.kraken.com/0/public/Ticker?pair=${pair}`) : `https://api.kraken.com/0/public/Ticker?pair=${pair}`, 4000, fresh ? 0 : 15000);
      if (arr(r.error).length) throw new DataError("not_found", r.error[0], "kraken");
      const k = Object.keys(r.result || {})[0], t = k && r.result[k]; if (!t) throw new DataError("not_found", "No ticker.", "kraken");
      const trades24 = Array.isArray(t.t) ? Number(t.t[1]) : null;
      return { bid: t.b[0], ask: t.a[0], last: t.c[0], open: t.o, high24: t.h[1], low24: t.l[1], trades24, thin: trades24 != null && trades24 < 200, ts: Date.now(), source: "Kraken", type: "executable-bid-ask" };
    }
  };

  /* ---------- FX ---------- */
  const fx = {
    // All USD-pivot indicative rates in one response, so crosses share one timestamp.
    async usdTable() {
      const r = await fetchJSON("https://api.coinbase.com/v2/exchange-rates?currency=USD", 200000, 60000);
      const rates = (r && r.data && r.data.rates) || {};
      if (!rates.EUR) throw new DataError("bad_data", "Exchange-rate table was incomplete.", "coinbase");
      return { pivot: "USD", rates, ts: Date.now(), source: "Coinbase (indicative mid)", type: "indicative-mid" };
    },
    async ecbOn(date, base, quotes) {
      const r = await fetchJSON(`https://api.frankfurter.app/${date}?from=${base}&to=${quotes.join(",")}`, 8000, 86400000);
      return { date: r.date, base: r.base, rates: r.rates || {}, source: "ECB via Frankfurter", type: "reference-fix" };
    },
    async ecbHistory(base, quote, from, to) {
      const parts = await Promise.all(chunks(from, to, 4).map(([f, t]) => fetchRaw(`https://api.frankfurter.app/${f}..${t}?from=${base}&to=${quote}`, 170000, 3600000).catch(() => "")));
      return sortUniq(parts.flatMap(b => all(RX.fx, b).map(m => ({ time: Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000, value: +m[4] }))));
    },
    krakenPair(base, quote) { const ok = ["EURUSD", "GBPUSD", "AUDUSD", "USDCAD", "USDCHF", "USDJPY", "EURGBP", "EURJPY", "EURCHF", "EURCAD", "EURAUD", "GBPJPY", "AUDJPY"]; return ok.includes(base + quote) ? base + quote : null; },
    async history(base, quote, tf) {
      const kp = fx.krakenPair(base, quote);
      if (kp && (["1D", "1W", "1M"].includes(tf) || MINUTE_TF[tf])) {
        const plan = KRAKEN_PLAN[tf];
        try {
          const k = await kraken.ohlc(kp, plan[0], krakenSince(plan, tf), MINUTE_TF[tf] ? 5000 : 30000);
          // Kraken's FX books can be thin; only trust intraday candles when most intervals traded.
          const traded = k.volume.filter(v => v.value > 0).length / Math.max(1, k.volume.length);
          if (traded >= 0.6) return Object.assign(k, { note: KRAKEN_LABEL[plan[0]] + " candles · Kraken · local time", ppy: 252 * 24 });
        } catch (e) { if (e.code === "no_mcp") throw e; }
      }
      if (MINUTE_TF[tf]) throw new DataError("unavailable", "Minute-level history isn't available for " + base + "/" + quote + " (no liquid free venue). The Live view still updates from indicative rates.", "kraken");
      if (!C.ECB_CODES.has(base) || !C.ECB_CODES.has(quote)) throw new DataError("unavailable", "Historical rates for " + base + "/" + quote + " are unavailable: the ECB does not publish " + [base, quote].filter(c => !C.ECB_CODES.has(c)).join(" or ") + ".", "frankfurter");
      const from = tf === "Max" ? new Date(Date.UTC(1999, 0, 4)) : (tf === "1D" || tf === "1W") ? daysAgo(30) : tfStart(tf);
      const pts = await fx.ecbHistory(base, quote, from, new Date());
      if (pts.length < 2) throw new DataError("not_found", "No history for " + base + "/" + quote + ".", "frankfurter");
      return { kind: "line", points: pts, intraday: false, barSec: 86400, shift: 0, status: "Historical", source: "ECB via Frankfurter", ppy: 252, note: "Daily ECB reference rates · Frankfurter" + ((tf === "1D" || tf === "1W") ? " · intraday not available for this pair, showing 30 days" : "") };
    }
  };

  /* ---------- precious metals ---------- */
  const METALS = [["XAU", "Gold"], ["XAG", "Silver"], ["XPT", "Platinum"], ["XPD", "Palladium"]];
  const metals = {
    async spot(sym) {
      const r = await fetchJSON("https://api.gold-api.com/price/" + sym, 3000, 20000);
      if (!r || !(r.price > 0)) throw new DataError("not_found", "No spot price for " + sym + ".", "goldapi");
      return { id: "metal:" + sym, cls: "metal", symbol: sym, name: r.name, price: r.price, currency: "USD", unit: "troy oz", ts: Date.parse(r.updatedAt) || Date.now(), status: "Live", source: "gold-api.com (spot benchmark)" };
    },
    async spotFresh(sym) {
      // gold-api rejects unknown query parameters, so freshness relies on its seconds-level updates and no local cache.
      const r = await fetchJSON("https://api.gold-api.com/price/" + sym, 3000, 0);
      if (!r || !(r.price > 0)) throw new DataError("not_found", "No spot price for " + sym + ".", "goldapi");
      return { price: r.price, ts: Date.parse(r.updatedAt) || Date.now(), source: "gold-api.com spot", status: "Live" };
    },
    async history(sym, tf) {
      if ((sym === "XAU" || sym === "XAG") && !MINUTE_TF[tf] && tf !== "1D" && !(sym === "XAU" && tf === "1W")) {
        const interval = tf === "10Y" || tf === "Max" ? "monthly" : "daily";
        try {
          const h = await av.metalHistory(sym, interval);
          const from = tf === "Max" ? 0 : Math.floor(tfStart(tf).getTime() / 1000);
          const pts = h.points.filter(p => p.time >= from);
          if (pts.length >= 2) return { kind: "line", points: pts, intraday: false, barSec: interval === "monthly" ? 30 * 86400 : 86400, shift: 0, status: "Historical", source: "Alpha Vantage", ppy: interval === "monthly" ? 12 : 252, note: (sym === "XAU" ? "Gold" : "Silver") + " price, USD per troy oz · " + interval + " · Alpha Vantage" };
        } catch (e) { if (sym === "XAG" && !["1W", "1M", "3M", "6M", "YTD", "1Y"].includes(tf)) throw e; /* otherwise fall back to the token proxies below */ }
      }
      if (sym === "XAU") {
        const h = await crypto.history("pax-gold", "PAXG", tf);
        return Object.assign(h, { proxy: true, note: h.note.replace(/Kraken PAXG\/USD|CoinGecko/, "PAX Gold token (PAXG) as a proxy for spot gold") + " · proxy, not the LBMA benchmark" });
      }
      if (MINUTE_TF[tf]) throw new DataError("unavailable", "Minute-level history for " + sym + " needs a paid metals feed. The Live view still updates from spot.", "goldapi");
      if (sym === "XAG") {
        const d = { "1W": 7, "1M": 30, "3M": 90, "6M": 180, "YTD": Math.ceil((Date.now() - tfStart("YTD").getTime()) / 864e5) }[tf] || 365;
        const body = await fetchRaw(`https://api.coingecko.com/api/v3/coins/kinesis-silver/market_chart?vs_currency=usd&days=${d}&interval=daily`, 80000, 600000);
        const pts = sortUniq(all(RX.cgPrices, body.split('"market_caps"')[0]).map(m => ({ time: Math.floor(+m[1] / 1000 / 86400) * 86400, value: +m[2] })));
        if (pts.length < 2) throw new DataError("unavailable", "Silver history is unavailable.", "coingecko");
        return { kind: "line", points: pts, intraday: false, barSec: 86400, shift: 0, proxy: true, status: "Historical", source: "CoinGecko", ppy: 365, note: "Kinesis Silver token (KAG, 1 oz) as a proxy for spot silver · daily · max 365 days" };
      }
      throw new DataError("unavailable", "Price history for " + sym + " is unavailable without a paid metals-data key.", "goldapi");
    }
  };

  /* ---------- Pokémon (TCGdex + Limitless) ---------- */
  const pokemon = {
    async search(q) {
      const r = await fetchJSON(`https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(q)}&pagination:itemsPerPage=24`, 40000, 300000);
      return arr(r).map(c => ({ id: "pkm:" + c.id, cls: "pokemon", tcgdexId: c.id, symbol: c.id, name: c.name, image: c.image ? c.image + "/low.webp" : null, sub: c.id }));
    },
    async card(id) {
      const c = await fetchJSON("https://api.tcgdex.net/v2/en/cards/" + encodeURIComponent(id), 60000, 600000);
      if (!c || !c.id) throw new DataError("not_found", "TCGdex has no card " + id + ".", "tcgdex");
      const variants = arr(c.variants_detailed).map(v => {
        const cm = v.pricing && v.pricing.cardmarket, tp = v.pricing && v.pricing.tcgplayer;
        const tpKey = tp && Object.keys(tp).find(k => tp[k] && typeof tp[k] === "object");
        const tpv = tpKey ? tp[tpKey] : null;
        return { type: v.type, size: v.size, prices: [
          cm ? { source: "Cardmarket", currency: cm.unit || "EUR", updated: cm.updated, values: [["Trend", cm.trend], ["30-day avg", cm.avg30], ["7-day avg", cm.avg7], ["1-day avg", cm.avg1], ["Low listing", cm.low]].filter(x => x[1] != null && x[1] > 0) } : null,
          tpv ? { source: "TCGplayer" + (tpKey ? " (" + tpKey + ")" : ""), currency: tp.unit || "USD", updated: tp.updated, values: [["Market price", tpv.marketPrice], ["Low", tpv.lowPrice], ["Mid", tpv.midPrice], ["Direct low", tpv.directLowPrice]].filter(x => x[1] != null && x[1] > 0) } : null
        ].filter(Boolean) };
      });
      return { id: "pkm:" + c.id, tcgdexId: c.id, cls: "pokemon", name: c.name, symbol: c.id, rarity: c.rarity, set: c.set && c.set.name, setId: c.set && c.set.id, setCount: c.set && c.set.cardCount, localId: c.localId, image: c.image ? c.image + "/high.webp" : null, regulationMark: c.regulationMark, legal: c.legal || {}, category: c.category, hp: c.hp, types: c.types, stage: c.stage, variants, illustrator: c.illustrator, updated: c.updated, source: "TCGdex",
        imageFull: c.image ? c.image + "/high.png" : null, effect: c.effect || null, evolveFrom: c.evolveFrom || null, retreat: c.retreat ?? null,
        attacks: arr(c.attacks).map(a => ({ name: a.name, cost: arr(a.cost), damage: a.damage ?? "", effect: a.effect || "" })), abilities: arr(c.abilities).map(a => ({ name: a.name, type: a.type, effect: a.effect || "" })),
        weaknesses: arr(c.weaknesses).map(w => (w.type || "") + " " + (w.value || "")), resistances: arr(c.resistances).map(w => (w.type || "") + " " + (w.value || "")), trainerType: c.trainerType || null, energyType: c.energyType || null };
    },
    async tournaments(limit = 20) {
      const r = await fetchJSON(`https://play.limitlesstcg.com/api/tournaments?game=PTCG&limit=${limit}`, 20000, 600000);
      return arr(r).map(t => ({ id: t.id, name: t.name, date: t.date, format: t.format, players: t.players }));
    },
    // Card inclusion across the decklists of the largest recent standard tournaments.
    async usage(cardName, n = 3) {
      const ts = (await pokemon.tournaments(40)).filter(t => t.format === "STANDARD" && t.players >= 24).sort((a, b) => b.players - a.players).slice(0, n);
      if (!ts.length) throw new DataError("not_found", "No recent large Standard tournaments.", "limitless");
      let decks = 0, withCard = 0, copies = 0; const archetypes = new Map(); const used = [];
      for (const t of ts) {
        let body; try { body = await fetchRaw(`https://play.limitlesstcg.com/api/tournaments/${t.id}/standings`, 600000, 600000); } catch { continue; }
        let list; try { list = JSON.parse(body.slice(body.search(/\[/))); } catch { continue; }
        used.push(t);
        for (const p of arr(list)) {
          if (!p.decklist) continue; decks++;
          const cards = [...arr(p.decklist.pokemon), ...arr(p.decklist.trainer), ...arr(p.decklist.energy)];
          const hits = cards.filter(c => String(c.name).toLowerCase() === cardName.toLowerCase());
          if (hits.length) { withCard++; copies += hits.reduce((a, c) => a + (c.count || 0), 0); const a = (p.deck && p.deck.name) || "Other"; archetypes.set(a, (archetypes.get(a) || 0) + 1); }
        }
      }
      return { cardName, tournaments: used, decks, withCard, inclusionPct: decks ? withCard / decks * 100 : null, avgCopies: withCard ? copies / withCard : null, archetypes: [...archetypes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6), source: "Limitless TCG (online events)" };
    }
  };

  /* ---------- Yu-Gi-Oh! (YGOPRODeck) ---------- */
  const ygo = {
    async search(q) {
      const r = await fetchJSON(`https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(q)}&num=20&offset=0`, 300000, 300000).catch(e => { if (e.code === "bad_data") return { data: [] }; throw e; });
      return arr(r.data).map(ygo.normalize);
    },
    normalize(c) {
      const pr = arr(c.card_prices)[0] || {};
      return { id: "ygo:" + c.id, cls: "yugioh", ygoId: c.id, symbol: String(c.id), name: c.name, type: c.type, archetype: c.archetype || null, desc: c.desc, image: c.card_images && c.card_images[0] && c.card_images[0].image_url_small,
        ban: { tcg: (c.banlist_info && c.banlist_info.ban_tcg) || "Unlimited", ocg: (c.banlist_info && c.banlist_info.ban_ocg) || "Unlimited" },
        sets: arr(c.card_sets).map(s => ({ set: s.set_name, code: s.set_code, rarity: s.set_rarity })),
        prices: [["TCGplayer", "USD", pr.tcgplayer_price], ["Cardmarket", "EUR", pr.cardmarket_price], ["eBay", "USD", pr.ebay_price], ["Amazon", "USD", pr.amazon_price], ["CoolStuffInc", "USD", pr.coolstuffinc_price]].filter(p => num(p[2]) > 0).map(([source, currency, v]) => ({ source, currency, value: num(v) })),
        url: c.ygoprodeck_url, sub: [c.type, c.archetype].filter(Boolean).join(" · "), source: "YGOPRODeck",
        imageFull: c.card_images && c.card_images[0] && c.card_images[0].image_url, frameType: c.frameType || "", atk: c.atk ?? null, def: c.def ?? null, level: c.level ?? null, attribute: c.attribute || null, race: c.race || null, linkval: c.linkval ?? null };
    },
    async card(id) { const r = await fetchJSON(`https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${encodeURIComponent(id)}`, 120000, 600000); const c = arr(r.data)[0]; if (!c) throw new DataError("not_found", "No card " + id + ".", "ygoprodeck"); return ygo.normalize(c); },
    async banlist(fmt = "tcg", n = 60) {
      const r = await fetchJSON(`https://db.ygoprodeck.com/api/v7/cardinfo.php?banlist=${fmt}&num=${n}&offset=0`, 900000, 3600000);
      const order = { Forbidden: 0, Limited: 1, "Semi-Limited": 2 };
      return arr(r.data).map(c => ({ id: String(c.id), name: c.name, type: c.type, archetype: c.archetype || "", status: (c.banlist_info || {})["ban_" + fmt] || "Unlimited" }))
        .filter(c => c.status in order).sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
    }
  };

  /* ---------- sold listings (PriceCharting / SportsCardsPro pages, read through Exa) ---------- */
  const GRADE_TAB = /^\s*#*\s*(Ungraded|Grade \d+(?:\.\d)?|(?:PSA|BGS|CGC|SGC|TAG|ACE) 10(?: Black| Prist\.?| Pristine)?) Sold Listings \((\d+)\)\s*$/;
  const cellsOf = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
  const money1 = (s) => { const m = String(s || "").match(/\$\s?([\d,]+(?:\.\d+)?)/g); return m ? m.map(x => num(x)) : []; };
  const sales = {
    // One product page: price by grade, and the sold-listings tables matched to their grade tabs in page order.
    parse(body, url) {
      const lines = String(body || "").split(/\r?\n/);
      const titleLine = lines.find(l => /^#\s+\S/.test(l));
      const out = { url, title: titleLine ? titleLine.replace(/^#\s+/, "").trim() : "", grades: [], tabs: [], sales: [], candidates: [], isProduct: false };
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const tm = l.match(GRADE_TAB); if (tm) { out.tabs.push({ grade: tm[1].replace("Prist.", "Pristine"), count: +tm[2] }); continue; }
        if (/^\|\s*Ungraded\s*\|/.test(l) && !out.grades.length) {
          const hdr = cellsOf(l), vals = cellsOf(lines[i + 2] || ""), vols = cellsOf(lines[i + 3] || "");
          hdr.forEach((g, j) => { if (!g) return; const am = money1(vals[j]); const chg = String(vals[j] || "").match(/([+-])\$([\d,.]+)/); if (am.length) out.grades.push({ grade: g, price: am[0], change: chg ? (chg[1] === "-" ? -1 : 1) * num(chg[2]) : null, volume: String(vols[j] || "").replace(/^volume:\s*/i, "") }); });
        }
        if (/^\|\s*\|\s*Title\s*\|\s*Set\s*\|/.test(l)) {
          for (let k = i + 2; k < lines.length && /^\|/.test(lines[k]); k++) { const c = cellsOf(lines[k]); const pr = money1(c.slice(3).join(" ")); if (c[1]) out.candidates.push({ title: c[1], set: c[2], price: pr[0] ?? null }); }
        }
      }
      // Sold-listings tables, in the same order as the grade tabs.
      const tables = [];
      for (let i = 0; i < lines.length; i++) {
        if (!/^\|\s*Sale Date/.test(lines[i])) continue;
        const rows = [];
        for (let k = i + 2; k < lines.length && /^\|/.test(lines[k]); k++) {
          const c = cellsOf(lines[k]); if (!/^\d{4}-\d{2}-\d{2}$/.test(c[0] || "")) continue;
          const ti = c.findIndex((x, j) => j > 0 && /\[[^\]]+\]\s*$/.test(x)); const titleCell = ti > 0 ? c[ti] : c[2] || "";
          const amounts = money1(c.slice((ti > 0 ? ti : 2) + 1).join(" ")); if (!amounts.length) continue;
          const src = (titleCell.match(/\[([^\]]+)\]\s*$/) || [, ""])[1];
          rows.push({ date: c[0], title: titleCell.replace(/\s*\[[^\]]+\]\s*$/, "").replace(/\s+/g, " ").trim(), source: src, price: amounts[0], alt: amounts.length > 1 ? amounts[1] : null });
          i = k;
        }
        tables.push(rows);
      }
      tables.forEach((rows, j) => { const g = out.tabs[j] ? out.tabs[j].grade : "Sold listings"; for (const r of rows) out.sales.push(Object.assign(r, { grade: g })); });
      out.isProduct = out.tabs.length > 0 || out.grades.length > 0;
      return out;
    },
    async page(url) {
      if (!/^https:\/\/www\.(pricecharting|sportscardspro)\.com\/game\//.test(url)) throw new DataError("bad_input", "Use a pricecharting.com or sportscardspro.com card page link.", "pricecharting");
      const r = sales.parse(await fetchRaw(url, 90000, 1800e3), url);
      if (!r.isProduct) throw new DataError("not_found", "That page has no sales data.", "pricecharting");
      return r;
    },
    async search(q) {
      const url = "https://www.pricecharting.com/search-products?type=prices&q=" + encodeURIComponent(q);
      return sales.parse(await fetchRaw(url, 90000, 1800e3), url);
    },
    // Find the product page for a card: PriceCharting search (Pokémon, Yu-Gi-Oh!), or a web search that
    // lands on PriceCharting / SportsCardsPro (sports cards, which their search doesn't index by name).
    async find(card) {
      if (card.url) return sales.page(card.url);
      if (card.kind === "pokemon" || card.kind === "yugioh") {
        const num_ = card.number ? String(card.number).replace(/^0+(?=\d)/, "") : "";
        const q = [card.name, card.kind === "yugioh" ? card.setCode : num_, card.kind === "pokemon" ? card.set : ""].filter(Boolean).join(" ");
        let r = await sales.search(q);
        if (r.isProduct) return r;
        const words = String(card.set || "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
        const pick = r.candidates.find(c => (!num_ || new RegExp("#0*" + num_ + "\\b").test(c.title)) && (!words.length || words.every(w => (c.title + " " + c.set).toLowerCase().includes(w)))) || (r.candidates.length === 1 ? r.candidates[0] : null);
        if (pick) { const r2 = await sales.search(pick.title + " " + pick.set); if (r2.isProduct) return r2; }
        return { isProduct: false, candidates: r.candidates.filter(c => !/Funko|Comic|Magic|Nintendo/i.test(c.set)).slice(0, 12), query: q };
      }
      const s = await webSearch("PriceCharting or SportsCardsPro price guide page for the sports card " + card.name + (card.number ? " #" + card.number : ""), "Return pricecharting.com/game/ or sportscardspro.com/game/ product pages for exactly this card and parallel. Exclude other sites.", 5);
      const hit = s.results.find(x => /^https:\/\/www\.(pricecharting|sportscardspro)\.com\/game\//.test(x.url));
      if (!hit) return { isProduct: false, candidates: [], query: card.name };
      return sales.page(hit.url);
    }
  };

  /* ---------- event odds (Polymarket) ---------- */
  const events = {
    async search(q) {
      const r = await fetchJSON(`https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(q)}&limit_per_type=5&events_status=active`, 400000, 60000).catch(async (e) => { if (e.code !== "bad_data") throw e; return fetchJSON(`https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(q)}&limit_per_type=1&events_status=active`, 400000, 60000); });
      return arr(r.events).filter(ev => !ev.closed && arr(ev.markets).some(m => m.active && !m.closed)).map(ev => ({ id: "event:" + ev.slug, cls: "event", slug: ev.slug, name: ev.title, symbol: "Polymarket", sub: "Ends " + String(ev.endDate || "").slice(0, 10), raw: ev }));
    },
    async event(slug) { const r = await fetchJSON(`https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(slug)}`, 400000, 30000); if (!arr(r)[0]) throw new DataError("not_found", "That market is no longer listed.", "polymarket"); return r[0]; },
    markets(ev) {
      const pj = (s) => { try { return typeof s === "string" ? JSON.parse(s) : arr(s); } catch { return []; } };
      const ms = arr(ev.markets).filter(m => m.active && !m.closed).map(m => { const outs = pj(m.outcomes), prices = pj(m.outcomePrices).map(Number), toks = pj(m.clobTokenIds); return { label: m.groupItemTitle || m.question, outcomes: outs, prices, tokens: toks, yes: (prices[0] || 0) * 100, d1: typeof m.oneDayPriceChange === "number" ? m.oneDayPriceChange * 100 : null, vol: Number(m.volumeNum || m.volume) || 0 }; });
      if (ms.length === 1 && ms[0].outcomes.length === 2) { const m = ms[0]; return m.outcomes.map((o, i) => ({ ...m, label: o, yes: (m.prices[i] || 0) * 100, token: m.tokens[i], d1: m.d1 == null ? null : (i === 0 ? m.d1 : -m.d1) })); }
      return ms.map(m => ({ ...m, token: m.tokens[0] })).sort((a, b) => b.yes - a.yes);
    },
    async history(token, tf) {
      const [iv, fid] = { "1D": ["1d", 5], "1W": ["1w", 60], "1M": ["1m", 240], "Max": ["max", 1440] }[tf] || ["1m", 240];
      const body = await fetchRaw(`https://clob.polymarket.com/prices-history?market=${token}&interval=${iv}&fidelity=${fid}`, 170000, 30000);
      const shift = fid < 1440 ? tzShift() : 0;
      const pts = sortUniq(all(RX.poly, body).map(x => ({ time: +x[1] + shift, value: +x[2] * 100 })));
      if (pts.length < 2) throw new DataError("not_found", "Not enough trading history for this time frame yet.", "polymarket");
      return { kind: "line", points: pts, intraday: fid < 1440, barSec: fid * 60, shift, pct: true, status: "Historical", source: "Polymarket", note: "Implied probability · Polymarket", ppy: 365 };
    }
  };

  /* ---------- calendars (Nasdaq) ---------- */
  const calendar = {
    async earnings(date) { const r = await fetchJSON("https://api.nasdaq.com/api/calendar/earnings?date=" + date, 200000, 3600000); return arr(r && r.data && r.data.rows).map(x => ({ date, symbol: x.symbol, name: x.name, time: String(x.time || "").replace("time-", "").replace("-", " "), epsForecast: x.epsForecast, lastYearEPS: x.lastYearEPS, marketCap: x.marketCap, quarter: x.fiscalQuarterEnding })); },
    async economic(date) { const r = await fetchJSON("https://api.nasdaq.com/api/calendar/economicevents?date=" + date, 200000, 3600000); return arr(r && r.data && r.data.rows).map(x => ({ date, gmt: x.gmt, country: x.country, event: x.eventName, actual: String(x.actual || "").trim(), consensus: x.consensus, previous: x.previous })); }
  };

  /* ---------- web research (Exa search) ---------- */
  async function webSearch(query, objective, n = 6) {
    if (!mcp) throw new DataError("no_mcp", "Web search needs the Exa connector.");
    const res = await mcp.callTool("Exa", "web_search_exa", { query, objective: objective || "Find recent, reliable sources with exact figures and dates.", numResults: n });
    const text = arr(res.content).filter(b => b.type === "text").map(b => b.text).join("\n") || (typeof res.payload === "string" ? res.payload : JSON.stringify(res.payload ?? ""));
    const urls = [...text.matchAll(/^URL: (\S+)/gm)].map(m => m[1]);
    const titles = [...text.matchAll(/^Title: (.*)$/gm)].map(m => m[1]);
    return { text, results: urls.map((u, i) => ({ url: u, title: titles[i] || u })) };
  }
  async function readPage(url, max = 8000) { const body = await fetchRaw(url, max, 600000); return body; }

  /* ---------- unified asset routing ---------- */
  function clsOf(id) { return String(id).split(":")[0]; }
  async function quoteFor(asset, vs) {
    const cls = asset.cls || clsOf(asset.id);
    if (cls === "stock" || cls === "etf") return stocks.quote(asset.symbol, cls);
    if (cls === "crypto") return crypto.quote(asset.cgId || asset.id.split(":")[1], vs || "usd");
    if (cls === "metal") return metals.spot(asset.symbol);
    if (cls === "pokemon") {
      const c = await pokemon.card(asset.tcgdexId || asset.id.slice(4));
      const v = c.variants.find(v => !asset.variant || v.type === asset.variant) || c.variants[0];
      const p = v && v.prices.find(p => p.source.startsWith(asset.priceSource || "TCGplayer")) || (v && v.prices[0]);
      const val = p && p.values[0];
      if (!val) throw new DataError("not_found", "No reference price for this card.", "tcgdex");
      return { id: asset.id, cls, symbol: c.symbol, name: c.name, price: val[1], currency: p.currency, ts: Date.parse(p.updated) || null, status: "Reference", source: p.source + " " + val[0].toLowerCase() + " via TCGdex", priceBasis: val[0] };
    }
    if (cls === "yugioh") {
      const c = await ygo.card(asset.ygoId || asset.id.split(":")[1]);
      const p = c.prices.find(p => p.source === (asset.priceSource || "TCGplayer")) || c.prices[0];
      if (!p) throw new DataError("not_found", "No reference price for this card.", "ygoprodeck");
      return { id: asset.id, cls, symbol: c.symbol, name: c.name, price: p.value, currency: p.currency, ts: null, status: "Reference", source: p.source + " via YGOPRODeck (card-level)" };
    }
    if (cls === "sports" && asset.cardchainId) {
      const c = await cardchain.card(asset);
      if (!(c.price > 0)) throw new DataError("not_found", "CardChain AI has no " + c.grade + " price for this card.", "cardchain");
      return { id: asset.id, cls, symbol: c.symbol, name: c.name, price: c.price, avgPrice: c.avgPrice, currency: "USD", ts: c.lastPoint, status: "Reference", source: "CardChain AI market price (" + c.grade + ")", image: c.image, grade: c.grade };
    }
    if (cls === "cash") return { id: asset.id, cls, symbol: asset.symbol, name: asset.symbol + " cash", price: 1, currency: asset.symbol, ts: Date.now(), status: "Live", source: "Cash balance" };
    throw new DataError("unavailable", "No live price source for this asset. Its value comes from your own recorded valuations.", "manual");
  }
  /* 5-minute bars with volume for the latest session, times in UTC seconds: stocks from Twelve Data (regular hours,
     New York wall-clock converted to UTC), crypto from Kraken (last 24 hours). Used for VWAP and relative volume. */
  async function intradayBars(asset) {
    const cls = asset.cls || clsOf(asset.id);
    if (cls === "crypto") {
      const k = await kraken.ohlc(krakenSym(asset.symbol) + "USD", 5, Math.floor(Date.now() / 1000) - 86400, 15000);
      const bars = k.points.map((p, i) => ({ time: p.time - k.shift, open: p.open, high: p.high, low: p.low, close: p.close, volume: k.volume[i] && p.close ? k.volume[i].value / p.close : 0 }));
      return { bars, source: "Kraken 5-minute candles (last 24 hours, UTC)", session: "24h" };
    }
    if (cls !== "stock" && cls !== "etf") throw new DataError("unavailable", "Intraday bars cover US stocks, ETFs and crypto.", "manual");
    const rows = await twelve.series(asset.symbol, "5min", { outputsize: 160 });
    const off = tzOffsetSec("America/New_York");
    const bars = sortUniq(rows.map(x => ({ time: Math.floor(Date.parse(x.dt.replace(" ", "T") + "Z") / 1000) - off, open: x.open ?? x.close, high: x.high ?? x.close, low: x.low ?? x.close, close: x.close, volume: x.volume || 0, dt: x.dt })));
    const lastDay = bars.length ? bars[bars.length - 1].dt.slice(0, 10) : null;
    return { bars: bars.filter(b => b.dt.slice(0, 10) === lastDay), prior: bars.filter(b => b.dt.slice(0, 10) !== lastDay), date: lastDay, source: "Twelve Data 5-minute bars (regular hours)", session: "regular" };
  }
  /* Daily histories for the analysis features (base rates, factor models, backtests, the market pulse) are kept in this
     browser for 6 hours, so studying the market again doesn't re-fetch years of prices. Charts always fetch fresh. */
  // Capped by count and by total size, so the cache never crowds out data the page stores in the browser when signed out.
  const HC = "md.h.", HC_INDEX = "md.h.index", HC_TTL = 6 * 3600e3, HC_MAX = 60, HC_CHARS = 1500000;
  async function historyCached(asset, tf) {
    const key = HC + tf + "." + (asset.id || asset.symbol);
    try {
      const raw = localStorage.getItem(key);
      if (raw) { const c = JSON.parse(raw); if (Date.now() - c.at < HC_TTL && c.p && c.p.length > 1) return Object.assign({}, c.m, { points: c.p.map(x => x.length > 2 ? { time: x[0], open: x[1], high: x[2], low: x[3], close: x[4] } : { time: x[0], value: x[1] }), volume: (c.v || []).map(x => ({ time: x[0], value: x[1] })), cachedAt: c.at }); }
    } catch {}
    const s = await historyFor(asset, tf);
    if (!s.intraday) try {
      const m = { kind: s.kind, intraday: false, barSec: s.barSec, shift: s.shift, currency: s.currency, note: s.note, status: s.status, source: s.source, ppy: s.ppy };
      const body = JSON.stringify({ at: Date.now(), m, p: s.points.map(p => p.open != null ? [p.time, p.open, p.high, p.low, p.close] : [p.time, p.value ?? p.close]), v: (s.volume || []).map(v => [v.time, v.value]) });
      if (body.length > HC_CHARS / 8) return s; // one series never takes more than an eighth of the budget
      const idx = JSON.parse(localStorage.getItem(HC_INDEX) || "{}"); idx[key] = { at: Date.now(), n: body.length };
      const keys = Object.keys(idx).sort((a, b) => (idx[a].at || 0) - (idx[b].at || 0)); let total = keys.reduce((t, k) => t + (idx[k].n || 0), 0);
      while (keys.length > HC_MAX || total > HC_CHARS) { const k = keys.shift(); total -= idx[k].n || 0; localStorage.removeItem(k); delete idx[k]; }
      if (idx[key]) { localStorage.setItem(key, body); localStorage.setItem(HC_INDEX, JSON.stringify(idx)); }
    } catch { /* storage full or unavailable: the data is still returned */ }
    return s;
  }
  // Long daily history for base rates: five years for US stocks and ETFs, two years of daily candles for crypto.
  function dailyLong(asset) { const cls = asset.cls || clsOf(asset.id); return historyCached(asset, cls === "crypto" ? "2Y" : cls === "stock" || cls === "etf" ? "5Y" : "1Y"); }
  async function historyFor(asset, tf) {
    try { return await primaryHistory(asset, tf); }
    catch (e) {
      if (e && e.code === "no_mcp") throw e;
      if (!twelve.symbolFor(asset) || (asset.cls === "metal" && MINUTE_TF[tf])) throw e;
      try { return await twelve.history(asset, tf); }
      catch (e2) { throw Object.assign(new DataError(e.code || "fetch_failed", U_msg(e) + " The second source (Twelve Data) also failed: " + U_msg(e2), e.provider), { first: e, second: e2 }); }
    }
  }
  const U_msg = (e) => String((e && e.message) || "request failed").replace(/\.?$/, ".");
  async function primaryHistory(asset, tf) {
    const cls = asset.cls || clsOf(asset.id);
    if (cls === "stock" || cls === "etf") return stocks.history(asset.symbol, cls, tf);
    if (cls === "crypto") return crypto.history(asset.cgId || asset.id.split(":")[1], asset.symbol, tf);
    if (cls === "metal") return metals.history(asset.symbol, tf);
    if (cls === "fx") return fx.history(asset.base, asset.quote, tf);
    if (cls === "sports" && asset.cardchainId) {
      const c = await cardchain.card(asset);
      if (c.history.length < 2) throw new DataError("not_found", "CardChain AI has fewer than two " + c.grade + " price points for this card.", "cardchain");
      return { kind: "line", points: c.history, intraday: false, barSec: 86400, shift: 0, status: "Historical", source: "CardChain AI", ppy: 365, note: "CardChain AI price points · " + c.grade + " · USD" };
    }
    throw new DataError("unavailable", "No price history is available for this kind of asset.", "manual");
  }

  async function checkHealth() {
    const probes = {
      nasdaq: () => fetchRaw("https://api.nasdaq.com/api/quote/SPY/info?assetclass=etf", 4000, 0),
      coingecko: () => fetchRaw("https://api.coingecko.com/api/v3/ping", 1000, 0),
      kraken: () => fetchRaw("https://api.kraken.com/0/public/Time", 1000, 0),
      coinbase: () => fetchRaw("https://api.coinbase.com/v2/prices/EUR-USD/spot", 1000, 0),
      frankfurter: () => fetchRaw("https://api.frankfurter.app/latest?from=EUR&to=USD", 1000, 0),
      goldapi: () => fetchRaw("https://api.gold-api.com/price/XAU", 1000, 0),
      tcgdex: () => fetchRaw("https://api.tcgdex.net/v2/en/sets/sv03.5", 2000, 0),
      limitless: () => fetchRaw("https://play.limitlesstcg.com/api/tournaments?game=PTCG&limit=1", 2000, 0),
      ygoprodeck: () => fetchRaw("https://db.ygoprodeck.com/api/v7/checkDBVer.php", 1000, 0),
      polymarket: () => fetchRaw("https://gamma-api.polymarket.com/markets?limit=1", 2000, 0),
      // Connectors with a free, unmetered call are probed; the others are checked when first used.
      cryptocom: () => cdc.call("get_ticker", { instrument_name: "BTC_USD" }),
      coinmarketcap: () => cmc.id("BTC")
    };
    await Promise.all(Object.entries(probes).map(([id, f]) => f().catch(() => null)));
    return health;
  }

  MD.data = { historyCached, intradayBars, dailyLong, imageData, sales, connector, resetConnectors, twelve, cdc, av, cardchain, dealer, bigdataNews, cmc, zacks, mdTables, liveQuote, liveSupported, MINUTE_TF, tzOffsetSec, bust, init, available, onActivity, DataError, PROVIDERS, UNAVAILABLE, health, checkHealth, fetchRaw, fetchJSON, stocks, crypto, STABLECOINS, kraken, fx, METALS, metals, pokemon, ygo, events, calendar, webSearch, readPage, quoteFor, historyFor, clsOf, TF_DAYS, num, ymd, daysAgo };
})(typeof window !== "undefined" ? window : globalThis);
