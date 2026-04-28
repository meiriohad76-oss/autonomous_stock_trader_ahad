import { WATCHLIST } from "./taxonomy.js";

const YAHOO_BASE = "https://query2.finance.yahoo.com/v10/finance/quoteSummary";
const UPCOMING_WINDOW_DAYS = 7;
const RELEASE_LOOKBACK_HOURS = 48;

function buildQuoteSummaryUrl(ticker) {
  return `${YAHOO_BASE}/${encodeURIComponent(ticker)}?modules=calendarEvents`;
}

function buildSeenKey(type, ticker, isoDate) {
  return `${type}:${ticker}:${isoDate.slice(0, 10)}`;
}

async function fetchCalendarEvents(ticker, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(buildQuoteSummaryUrl(ticker), {
      signal: controller.signal,
      headers: { "User-Agent": "SentimentAnalyst/1.0 (+earnings-calendar)" }
    });
    if (!response.ok) throw new Error(`Yahoo quoteSummary ${response.status}`);
    const json = await response.json();
    const result = json?.quoteSummary?.result?.[0];
    const earningsDates = result?.calendarEvents?.earnings?.earningsDate ?? [];
    return earningsDates.map((d) => (typeof d === "object" ? d.raw * 1000 : Number(d) * 1000));
  } finally {
    clearTimeout(timer);
  }
}

function buildUpcomingRawDocument(entry, earningsDateMs) {
  const isoDate = new Date(earningsDateMs).toISOString();
  const dateStr = isoDate.slice(0, 10);
  const daysUntil = Math.ceil((earningsDateMs - Date.now()) / 86_400_000);
  return {
    source_name: "yahoo_earnings",
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
      earnings_date: isoDate,
      days_until: daysUntil
    },
    raw_payload: { earningsDateMs, ticker: entry.ticker }
  };
}

function buildReleaseRawDocument(entry, earningsDateMs) {
  const isoDate = new Date(earningsDateMs).toISOString();
  const dateStr = isoDate.slice(0, 10);
  return {
    source_name: "yahoo_earnings",
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

  function ensureHealthEntry() {
    if (!store.health.liveSources.yahoo_earnings_calendar) {
      store.health.liveSources.yahoo_earnings_calendar = {
        enabled: config.earningsEnabled,
        polling: false,
        last_poll_at: null,
        last_success_at: null,
        last_error: null,
        polls: 0,
        consecutive_failures: 0,
        ingested_documents: 0
      };
    }
    return store.health.liveSources.yahoo_earnings_calendar;
  }

  async function pollOnce() {
    if (!config.earningsEnabled || inFlight) return { ingested: 0, skipped: 0 };

    inFlight = true;
    const health = ensureHealthEntry();
    health.polling = true;
    health.last_poll_at = new Date().toISOString();
    health.polls += 1;

    let ingested = 0;
    let skipped = 0;
    let errors = 0;

    try {
      const results = await Promise.all(
        WATCHLIST.map(async (entry) => {
          try {
            const dates = await fetchCalendarEvents(entry.ticker, config.earningsRequestTimeoutMs);
            return { entry, dates, error: null };
          } catch (err) {
            return { entry, dates: [], error: err.message };
          }
        })
      );

      const now = Date.now();

      for (const { entry, dates, error } of results) {
        if (error) {
          errors += 1;
          continue;
        }

        let calendarEntry = { next_earnings_date: null, days_until: null, confirmed: false, last_checked_at: new Date().toISOString() };

        for (const dateMs of dates) {
          const daysUntil = (dateMs - now) / 86_400_000;

          if (daysUntil > 0 && daysUntil <= UPCOMING_WINDOW_DAYS) {
            const isoDate = new Date(dateMs).toISOString();
            const seenKey = buildSeenKey("earnings_upcoming", entry.ticker, isoDate);
            calendarEntry = { next_earnings_date: isoDate, days_until: Math.ceil(daysUntil), confirmed: true, last_checked_at: new Date().toISOString() };

            if (!store.seenExternalDocuments.has(seenKey)) {
              store.seenExternalDocuments.add(seenKey);
              await pipeline.processRawDocument(buildUpcomingRawDocument(entry, dateMs));
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
              await pipeline.processRawDocument(buildReleaseRawDocument(entry, dateMs));
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
      if (ingested > 0 || errors < WATCHLIST.length) health.last_success_at = new Date().toISOString();
      health.last_error = errors > 0 ? `${errors} tickers failed` : null;
      health.consecutive_failures = errors === WATCHLIST.length ? health.consecutive_failures + 1 : 0;
      return { ingested, skipped, errors };
    } finally {
      health.polling = false;
      inFlight = false;
    }
  }

  function scheduleNext() {
    if (!running || !config.earningsEnabled) return;
    timer = setTimeout(async () => {
      await pollOnce();
      scheduleNext();
    }, config.earningsPollMs);
  }

  return {
    async start() {
      ensureHealthEntry();
      if (running || !config.earningsEnabled) return;
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
