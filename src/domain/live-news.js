import { WATCHLIST } from "./taxonomy.js";
import { dedupeKey, normalizeWhitespace } from "../utils/helpers.js";
import { fetchTextWithRetry } from "../utils/http.js";

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

function buildGoogleNewsFeedUrl(entry) {
  const query = encodeURIComponent(createTickerQuery(entry));
  return `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
}

function buildYahooFinanceFeedUrl(entry) {
  return `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(entry.ticker)}&region=US&lang=en-US`;
}

function buildSeenKey(entry, item) {
  return dedupeKey([entry.ticker, item.guid, item.link, item.title]);
}

function buildRawDocument(entry, item, provider) {
  return {
    source_name: provider.sourceName,
    source_type: "rss",
    source_priority: provider.sourcePriority,
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
      collector: provider.collector,
      upstream_source: item.source || provider.label,
      query: provider.query || createTickerQuery(entry)
    },
    raw_payload: item
  };
}

function feedProviders(entry) {
  return [
    {
      key: "google_news",
      label: "Google News",
      sourceName: "google_news",
      sourcePriority: 0.62,
      collector: "google_news_rss",
      url: buildGoogleNewsFeedUrl(entry),
      query: createTickerQuery(entry)
    },
    {
      key: "yahoo_finance",
      label: "Yahoo Finance",
      sourceName: "yahoo_finance",
      sourcePriority: 0.68,
      collector: "yahoo_finance_rss",
      url: buildYahooFinanceFeedUrl(entry),
      query: entry.ticker
    }
  ];
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
        ingested_documents: 0,
        provider_success: {},
        provider_failures: {}
      };
    }
    store.health.liveSources.google_news_rss.provider_success ||= {};
    store.health.liveSources.google_news_rss.provider_failures ||= {};
    return store.health.liveSources.google_news_rss;
  }

  async function fetchTickerFeed(entry) {
    const attempts = [];
    for (const provider of feedProviders(entry)) {
      try {
        const xml = await fetchTextWithRetry(provider.url, {
          timeoutMs: config.liveNewsRequestTimeoutMs,
          retries: config.liveNewsRequestRetries,
          label: `${provider.label} RSS ${entry.ticker}`,
          headers: {
            "User-Agent": "SentimentAnalyst/1.0 (+local RSS collector)"
          }
        });
        const items = parseGoogleNewsRss(xml).slice(0, config.liveNewsMaxItemsPerTicker);
        if (items.length) {
          return { entry, provider, items, attempts, error: null };
        }
        attempts.push(`${provider.key}: no items`);
      } catch (error) {
        attempts.push(`${provider.key}: ${error.message}`);
      }
    }

    return {
      entry,
      provider: null,
      items: [],
      attempts,
      error: attempts.join("; ") || "No RSS provider returned items"
    };
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
      const fetchedFeeds = await Promise.all(WATCHLIST.map((entry) => fetchTickerFeed(entry)));

      const errors = fetchedFeeds.filter((result) => result.error);

      for (const result of fetchedFeeds) {
        for (const attempt of result.attempts || []) {
          const providerKey = attempt.split(":")[0];
          health.provider_failures[providerKey] = (health.provider_failures[providerKey] || 0) + 1;
        }
      }

      for (const { entry, items, provider } of fetchedFeeds) {
        if (provider) {
          health.provider_success[provider.key] = (health.provider_success[provider.key] || 0) + 1;
        }

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
          await pipeline.processRawDocument(buildRawDocument(entry, item, provider));
          ingested += 1;
        }
      }

      health.ingested_documents += ingested;
      if (ingested > 0 || fetchedFeeds.length > errors.length) {
        health.last_success_at = new Date().toISOString();
      }
      health.last_error = errors.length
        ? `Failed all news providers for: ${errors.map((result) => result.entry.ticker).join(", ")}`
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
