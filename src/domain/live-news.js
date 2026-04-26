import { WATCHLIST } from "./taxonomy.js";
import { dedupeKey, normalizeWhitespace } from "../utils/helpers.js";

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " "));
}

function extractTag(block, tagName) {
  const match = block.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "i"));
  return match ? normalizeWhitespace(stripHtml(match[1])) : "";
}

export function parseGoogleNewsRss(xml) {
  const items = [...String(xml || "").matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];

  return items.map(([, block]) => {
    const title = extractTag(block, "title");
    const link = extractTag(block, "link");
    const guid = extractTag(block, "guid");
    const description = extractTag(block, "description");
    const pubDate = extractTag(block, "pubDate");
    const source = extractTag(block, "source");

    return {
      title,
      link,
      guid,
      description,
      pubDate,
      source
    };
  });
}

function createTickerQuery(entry) {
  return `("${entry.company}" OR "${entry.ticker}") (stock OR shares OR earnings OR market OR investor)`;
}

function buildFeedUrl(entry) {
  const query = encodeURIComponent(createTickerQuery(entry));
  return `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
}

function buildSeenKey(entry, item) {
  return dedupeKey([entry.ticker, item.guid, item.link, item.title]);
}

function buildRawDocument(entry, item) {
  return {
    source_name: "google_news",
    source_type: "rss",
    source_priority: 0.62,
    canonical_url: item.link,
    url: item.link,
    title: item.title,
    body: item.description || item.title,
    language: "en",
    published_at: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
    fetched_at: new Date().toISOString(),
    source_metadata: {
      ticker_hint: entry.ticker,
      sector_hint: entry.sector,
      collector: "google_news_rss",
      upstream_source: item.source || "Google News",
      query: createTickerQuery(entry)
    },
    raw_payload: item
  };
}

async function fetchFeed(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "SentimentAnalyst/1.0 (+local RSS collector)"
      }
    });

    if (!response.ok) {
      throw new Error(`RSS request failed with ${response.status}`);
    }

    return response.text();
  } finally {
    clearTimeout(timer);
  }
}

export function createLiveNewsCollector(app) {
  const { config, pipeline, store } = app;
  let timer = null;
  let running = false;
  let inFlight = false;

  function ensureHealthEntry() {
    if (!store.health.liveSources.google_news_rss) {
      store.health.liveSources.google_news_rss = {
        enabled: config.liveNewsEnabled,
        polling: false,
        last_poll_at: null,
        last_success_at: null,
        last_error: null,
        polls: 0,
        consecutive_failures: 0,
        ingested_documents: 0
      };
    }
    return store.health.liveSources.google_news_rss;
  }

  async function pollOnce() {
    if (!config.liveNewsEnabled || inFlight) {
      return { ingested: 0, skipped: 0 };
    }

    inFlight = true;
    const health = ensureHealthEntry();
    health.polling = true;
    health.last_poll_at = new Date().toISOString();
    health.polls += 1;

    let ingested = 0;
    let skipped = 0;

    try {
      const fetchedFeeds = await Promise.all(
        WATCHLIST.map(async (entry) => {
          try {
            const xml = await fetchFeed(buildFeedUrl(entry), config.liveNewsRequestTimeoutMs);
            return {
              entry,
              items: parseGoogleNewsRss(xml).slice(0, config.liveNewsMaxItemsPerTicker),
              error: null
            };
          } catch (error) {
            return {
              entry,
              items: [],
              error: error.message
            };
          }
        })
      );

      const errors = fetchedFeeds.filter((result) => result.error);

      for (const { entry, items } of fetchedFeeds) {
        for (const item of items) {
          if (!item.title || !item.link) {
            skipped += 1;
            continue;
          }

          const publishedAt = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();
          const ageHours = Math.max(0, (Date.now() - publishedAt) / 3_600_000);
          if (ageHours > config.liveNewsLookbackHours) {
            skipped += 1;
            continue;
          }

          const seenKey = buildSeenKey(entry, item);
          if (store.seenExternalDocuments.has(seenKey)) {
            skipped += 1;
            continue;
          }

          store.seenExternalDocuments.add(seenKey);
          await pipeline.processRawDocument(buildRawDocument(entry, item));
          ingested += 1;
        }
      }

      health.ingested_documents += ingested;
      if (ingested > 0 || fetchedFeeds.length > errors.length) {
        health.last_success_at = new Date().toISOString();
      }
      health.last_error = errors.length
        ? `Failed feeds: ${errors.map((result) => result.entry.ticker).join(", ")}`
        : null;
      health.consecutive_failures = errors.length === WATCHLIST.length ? health.consecutive_failures + 1 : 0;
      return { ingested, skipped, errors: errors.length };
    } finally {
      health.polling = false;
      inFlight = false;
    }
  }

  function scheduleNext() {
    if (!running || !config.liveNewsEnabled) {
      return;
    }

    timer = setTimeout(async () => {
      await pollOnce();
      scheduleNext();
    }, config.liveNewsPollMs);
  }

  return {
    async start() {
      ensureHealthEntry();
      if (running || !config.liveNewsEnabled) {
        return;
      }
      running = true;
      await pollOnce();
      scheduleNext();
    },
    stop() {
      running = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const health = ensureHealthEntry();
      health.polling = false;
    },
    async pollOnce() {
      ensureHealthEntry();
      return pollOnce();
    }
  };
}
