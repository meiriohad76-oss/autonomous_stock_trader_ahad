import { WATCHLIST } from "./taxonomy.js";

const YAHOO_BASE = "https://query2.finance.yahoo.com/v10/finance/quoteSummary";
const TWELVE_DATA_BASE = "https://api.twelvedata.com/earnings";
const UPCOMING_WINDOW_DAYS = 7;
const RELEASE_LOOKBACK_HOURS = 48;
const YAHOO_USER_AGENT = "Mozilla/5.0 SentimentAnalyst/1.0 (+earnings-calendar)";

let yahooAuthCache = null;

function buildQuoteSummaryUrl(ticker) {
  return `${YAHOO_BASE}/${encodeURIComponent(ticker)}?modules=calendarEvents`;
}

function buildTwelveDataEarningsUrl(ticker, apiKey) {
  const params = new URLSearchParams({
    symbol: ticker,
    apikey: apiKey
  });
  return `${TWELVE_DATA_BASE}?${params.toString()}`;
}

function buildSeenKey(type, ticker, isoDate) {
  return `${type}:${ticker}:${isoDate.slice(0, 10)}`;
}

function parseEarningsDateMs(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "number") {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    return new Date(`${value}T13:00:00.000Z`).getTime();
  }
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

async function fetchYahooCalendarEvents(ticker, timeoutMs) {
  async function fetchWithAuth(retry = true) {
    const auth = await getYahooAuth(timeoutMs);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `${buildQuoteSummaryUrl(ticker)}&crumb=${encodeURIComponent(auth.crumb)}`;
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": YAHOO_USER_AGENT,
          Cookie: auth.cookie,
          Accept: "application/json"
        }
      });
      if (response.status === 401 && retry) {
        yahooAuthCache = null;
        return fetchWithAuth(false);
      }
      if (!response.ok) throw new Error(`Yahoo quoteSummary ${response.status}`);
      return response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  const json = await fetchWithAuth();
  const result = json?.quoteSummary?.result?.[0];
  const earningsDates = result?.calendarEvents?.earnings?.earningsDate ?? [];
  return earningsDates.map((d) => parseEarningsDateMs(typeof d === "object" ? d.raw : d)).filter(Boolean);
}

function extractCookies(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie().map((cookie) => cookie.split(";")[0]).filter(Boolean).join("; ");
  }
  return String(headers.get("set-cookie") || "")
    .split(/,(?=[^;,]+=)/)
    .map((cookie) => cookie.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function getYahooAuth(timeoutMs) {
  if (yahooAuthCache?.cookie && yahooAuthCache?.crumb) {
    return yahooAuthCache;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const cookieResponse = await fetch("https://fc.yahoo.com", {
      signal: controller.signal,
      headers: { "User-Agent": YAHOO_USER_AGENT }
    });
    const cookie = extractCookies(cookieResponse.headers);
    if (!cookie) {
      throw new Error("Yahoo crumb cookie was not returned");
    }

    const crumbResponse = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      signal: controller.signal,
      headers: {
        "User-Agent": YAHOO_USER_AGENT,
        Cookie: cookie
      }
    });
    if (!crumbResponse.ok) {
      throw new Error(`Yahoo crumb ${crumbResponse.status}`);
    }
    const crumb = String(await crumbResponse.text()).trim();
    if (!crumb || /<html/i.test(crumb)) {
      throw new Error("Yahoo crumb response was invalid");
    }

    yahooAuthCache = { cookie, crumb };
    return yahooAuthCache;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTwelveDataEarnings(ticker, config) {
  const apiKey = config.earningsApiKey || config.twelveDataApiKey;
  if (!apiKey) {
    throw new Error("Twelve Data earnings requires TWELVE_DATA_API_KEY or EARNINGS_API_KEY");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.earningsRequestTimeoutMs);
  try {
    const response = await fetch(buildTwelveDataEarningsUrl(ticker, apiKey), {
      signal: controller.signal,
      headers: { "User-Agent": "SentimentAnalyst/1.0 (+earnings-calendar)" }
    });
    if (!response.ok) throw new Error(`Twelve Data earnings ${response.status}`);
    const json = await response.json();
    if (json?.status === "error") throw new Error(json.message || "Twelve Data earnings returned an error");
    return (json?.earnings ?? []).map((item) => parseEarningsDateMs(item?.date)).filter(Boolean);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCalendarEvents(entry, config) {
  if (config.earningsProvider === "twelvedata") {
    try {
      return {
        dates: await fetchTwelveDataEarnings(entry.ticker, config),
        provider: "twelvedata"
      };
    } catch {
      return {
        dates: await fetchYahooCalendarEvents(entry.ticker, config.earningsRequestTimeoutMs),
        provider: "yahoo"
      };
    }
  }
  return {
    dates: await fetchYahooCalendarEvents(entry.ticker, config.earningsRequestTimeoutMs),
    provider: "yahoo"
  };
}

function buildUpcomingRawDocument(entry, earningsDateMs, provider) {
  const isoDate = new Date(earningsDateMs).toISOString();
  const dateStr = isoDate.slice(0, 10);
  const daysUntil = Math.ceil((earningsDateMs - Date.now()) / 86_400_000);
  return {
    source_name: provider === "twelvedata" ? "twelvedata_earnings" : "yahoo_earnings",
    source_type: "api",
    source_priority: 0.72,
    canonical_url: `https://finance.yahoo.com/quote/${entry.ticker}`,
    url: `https://finance.yahoo.com/quote/${entry.ticker}`,
    title: `${entry.company} reports earnings on ${dateStr} (${daysUntil}d away)`,
    body: `${entry.company} (${entry.ticker}) upcoming earnings event. Reports earnings on ${dateStr}. Upcoming earnings scheduled in ${daysUntil} day${daysUntil === 1 ? "" : "s"}.`,
    language: "en",
    published_at: new Date().toISOString(),
    fetched_at: new Date().toISOString(),
    source_metadata: {
      ticker_hint: entry.ticker,
      sector_hint: entry.sector,
      collector: "yahoo_earnings_calendar",
      provider,
      earnings_date: isoDate,
      days_until: daysUntil
    },
    raw_payload: { earningsDateMs, ticker: entry.ticker }
  };
}

function buildReleaseRawDocument(entry, earningsDateMs, provider) {
  const isoDate = new Date(earningsDateMs).toISOString();
  const dateStr = isoDate.slice(0, 10);
  return {
    source_name: provider === "twelvedata" ? "twelvedata_earnings" : "yahoo_earnings",
    source_type: "api",
    source_priority: 0.72,
    canonical_url: `https://finance.yahoo.com/quote/${entry.ticker}`,
    url: `https://finance.yahoo.com/quote/${entry.ticker}`,
    title: `${entry.company} earnings release — ${dateStr}`,
    body: `${entry.company} (${entry.ticker}) fiscal quarter results. Reports quarterly earnings on ${dateStr}. Earnings release event.`,
    language: "en",
    published_at: isoDate,
    fetched_at: new Date().toISOString(),
    source_metadata: {
      ticker_hint: entry.ticker,
      sector_hint: entry.sector,
      collector: "yahoo_earnings_calendar",
      provider,
      earnings_date: isoDate
    },
    raw_payload: { earningsDateMs, ticker: entry.ticker }
  };
}

export function createCorporateEventsCollector(app) {
  const { config, pipeline, store } = app;
  let timer = null;
  let running = false;
  let inFlight = false;
  let cursor = 0;

  function isEnabled() {
    return Boolean(config.earningsEnabled || config.autonomousDataEnabled);
  }

  function earningsWatchlist() {
    return WATCHLIST.filter((entry) => entry.sector !== "Macro" && entry.industry !== "ETF");
  }

  function nextBatch() {
    const universe = earningsWatchlist();
    const maxTickers = Math.max(0, Math.floor(Number(config.earningsMaxTickersPerPoll || 0)));
    if (!maxTickers || maxTickers >= universe.length) {
      return universe;
    }
    const offset = cursor % universe.length;
    const rotated = [...universe.slice(offset), ...universe.slice(0, offset)];
    cursor = (cursor + maxTickers) % universe.length;
    return rotated.slice(0, maxTickers);
  }

  function ensureHealthEntry() {
    if (!store.health.liveSources.yahoo_earnings_calendar) {
      store.health.liveSources.yahoo_earnings_calendar = {
        enabled: isEnabled(),
        provider: config.earningsProvider,
        polling: false,
        last_poll_at: null,
        last_success_at: null,
        last_error: null,
        polls: 0,
        consecutive_failures: 0,
        ingested_documents: 0,
        last_batch_size: 0
      };
    }
    store.health.liveSources.yahoo_earnings_calendar.enabled = isEnabled();
    store.health.liveSources.yahoo_earnings_calendar.provider = config.earningsProvider;
    return store.health.liveSources.yahoo_earnings_calendar;
  }

  async function pollOnce() {
    if (!isEnabled() || inFlight) return { ingested: 0, skipped: 0 };

    inFlight = true;
    const health = ensureHealthEntry();
    health.polling = true;
    health.last_poll_at = new Date().toISOString();
    health.polls += 1;
    const batch = nextBatch();
    health.last_batch_size = batch.length;

    let ingested = 0;
    let skipped = 0;
    let errors = 0;
    let lastFailure = null;

    try {
      const results = await Promise.all(
        batch.map(async (entry) => {
          try {
            const { dates, provider } = await fetchCalendarEvents(entry, config);
            return { entry, dates, provider, error: null };
          } catch (err) {
            return { entry, dates: [], provider: null, error: err.message };
          }
        })
      );

      const now = Date.now();

      let lastProvider = config.earningsProvider;

      for (const { entry, dates, provider, error } of results) {
        if (error) {
          errors += 1;
          lastFailure = error;
          continue;
        }
        lastProvider = provider || lastProvider;

        let calendarEntry = { next_earnings_date: null, days_until: null, confirmed: false, last_checked_at: new Date().toISOString() };

        for (const dateMs of dates) {
          const daysUntil = (dateMs - now) / 86_400_000;

          if (daysUntil > 0 && daysUntil <= UPCOMING_WINDOW_DAYS) {
            const isoDate = new Date(dateMs).toISOString();
            const seenKey = buildSeenKey("earnings_upcoming", entry.ticker, isoDate);
            calendarEntry = { next_earnings_date: isoDate, days_until: Math.ceil(daysUntil), confirmed: true, last_checked_at: new Date().toISOString() };

            if (!store.seenExternalDocuments.has(seenKey)) {
              store.seenExternalDocuments.add(seenKey);
              await pipeline.processRawDocument(buildUpcomingRawDocument(entry, dateMs, provider || config.earningsProvider));
              ingested += 1;
            } else {
              skipped += 1;
            }
          } else if (daysUntil <= 0 && daysUntil >= -(RELEASE_LOOKBACK_HOURS / 24)) {
            const isoDate = new Date(dateMs).toISOString();
            const seenKey = buildSeenKey("earnings_release", entry.ticker, isoDate);

            if (!calendarEntry.next_earnings_date) {
              calendarEntry = { next_earnings_date: isoDate, days_until: 0, confirmed: true, last_checked_at: new Date().toISOString() };
            }

            if (!store.seenExternalDocuments.has(seenKey)) {
              store.seenExternalDocuments.add(seenKey);
              await pipeline.processRawDocument(buildReleaseRawDocument(entry, dateMs, provider || config.earningsProvider));
              ingested += 1;
            } else {
              skipped += 1;
            }
          } else if (daysUntil > UPCOMING_WINDOW_DAYS && !calendarEntry.next_earnings_date) {
            calendarEntry = { next_earnings_date: new Date(dateMs).toISOString(), days_until: Math.ceil(daysUntil), confirmed: true, last_checked_at: new Date().toISOString() };
          }
        }

        store.earningsCalendar.set(entry.ticker, calendarEntry);
      }

      health.ingested_documents += ingested;
      health.provider = lastProvider;
      if (ingested > 0 || errors < batch.length) health.last_success_at = new Date().toISOString();
      health.partial_errors = errors;
      health.last_error = errors > Math.max(1, Math.floor(batch.length * 0.25))
        ? `${errors} tickers failed${lastFailure ? `: ${lastFailure}` : ""}`
        : null;
      health.consecutive_failures = errors === batch.length ? health.consecutive_failures + 1 : 0;
      return { ingested, skipped, errors, provider: lastProvider, checked: batch.length };
    } finally {
      health.polling = false;
      inFlight = false;
    }
  }

  function scheduleNext() {
    if (!running || !isEnabled()) return;
    timer = setTimeout(async () => {
      await pollOnce();
      scheduleNext();
    }, config.earningsPollMs);
  }

  return {
    async start() {
      ensureHealthEntry();
      if (running || !isEnabled()) return;
      running = true;
      await pollOnce();
      scheduleNext();
    },
    stop() {
      running = false;
      if (timer) { clearTimeout(timer); timer = null; }
      ensureHealthEntry().polling = false;
    },
    async pollOnce() {
      ensureHealthEntry();
      return pollOnce();
    }
  };
}
