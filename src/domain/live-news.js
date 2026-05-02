import { WATCHLIST } from "./taxonomy.js";
import { dedupeKey, normalizeWhitespace } from "../utils/helpers.js";
import { fetchJsonWithRetry, fetchTextWithRetry } from "../utils/http.js";

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
      query: provider.query || createTickerQuery(entry),
      source_url: item.link,
      marketaux_uuid: item.marketauxUuid || null,
      marketaux_entity_symbol: item.marketauxEntity?.symbol || null,
      marketaux_sentiment_score: item.marketauxSentiment ?? null,
      marketaux_entity_sentiment_score: item.marketauxEntity?.sentiment_score ?? null,
      marketaux_entity_match_score: item.marketauxEntity?.match_score ?? null
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

function chunkArray(items, size) {
  const chunks = [];
  const chunkSize = Math.max(1, Number(size || 20));
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function marketauxProvider(symbols) {
  return {
    key: "marketaux",
    label: "Marketaux",
    sourceName: "marketaux",
    sourcePriority: 0.84,
    collector: "marketaux_news",
    query: symbols.join(",")
  };
}

function buildMarketauxUrl(config, entries) {
  const lookbackHours = Number(config.liveNewsLookbackHours || 24);
  const limit = Math.min(100, Math.max(1, entries.length * Number(config.marketauxMaxItemsPerTicker || 3)));
  const params = new URLSearchParams({
    api_token: config.marketauxApiKey,
    symbols: entries.map((entry) => entry.ticker).join(","),
    filter_entities: "true",
    language: "en",
    limit: String(limit),
    published_after: new Date(Date.now() - lookbackHours * 3_600_000).toISOString()
  });

  return `${config.marketauxBaseUrl || "https://api.marketaux.com/v1/news/all"}?${params.toString()}`;
}

export function mapMarketauxArticles(payload, entries, maxItemsPerTicker = 3) {
  const bySymbol = new Map(entries.map((entry) => [entry.ticker, entry]));
  const provider = marketauxProvider(entries.map((entry) => entry.ticker));
  const grouped = new Map(entries.map((entry) => [entry.ticker, { entry, provider, items: [], attempts: [], error: null }]));
  const perTickerLimit = Math.max(1, Number(maxItemsPerTicker || 3));

  for (const article of Array.isArray(payload?.data) ? payload.data : []) {
    const articleUrl = article.url || article.source_url || "";
    const entities = Array.isArray(article.entities) ? article.entities : [];
    const matchingEntities = entities.filter((entity) => bySymbol.has(String(entity.symbol || "").toUpperCase()));
    const targets = matchingEntities.length
      ? matchingEntities
      : article.symbols?.length
        ? article.symbols.map((symbol) => ({ symbol })).filter((entity) => bySymbol.has(String(entity.symbol || "").toUpperCase()))
        : [];

    for (const entity of targets) {
      const symbol = String(entity.symbol || "").toUpperCase();
      const group = grouped.get(symbol);
      if (!group || group.items.length >= perTickerLimit) {
        continue;
      }

      group.items.push({
        title: article.title || "",
        link: articleUrl,
        guid: article.uuid || articleUrl || `${symbol}:${article.title}`,
        description: article.description || article.snippet || article.title || "",
        pubDate: article.published_at || article.published_on || new Date().toISOString(),
        source:
          typeof article.source === "string"
            ? article.source
            : article.source?.name || article.source_name || "Marketaux",
        marketauxUuid: article.uuid || null,
        marketauxSentiment: article.sentiment_score ?? null,
        marketauxEntity: entity,
        raw: article
      });
    }
  }

  return [...grouped.values()].filter((result) => result.items.length);
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

  function ensureMarketauxHealthEntry() {
    if (!store.health.liveSources.marketaux_news) {
      store.health.liveSources.marketaux_news = {
        provider: "marketaux",
        enabled: Boolean(config.liveNewsEnabled && config.marketauxEnabled),
        configured: Boolean(config.marketauxApiKey),
        polling: false,
        last_poll_at: null,
        last_success_at: null,
        last_empty_at: null,
        last_error: null,
        polls: 0,
        consecutive_failures: 0,
        ingested_documents: 0,
        requested_symbols: 0,
        fetched_articles: 0
      };
    }
    store.health.liveSources.marketaux_news.enabled = Boolean(config.liveNewsEnabled && config.marketauxEnabled);
    store.health.liveSources.marketaux_news.configured = Boolean(config.marketauxApiKey);
    return store.health.liveSources.marketaux_news;
  }

  async function fetchMarketauxFeeds(entries) {
    const aggregateHealth = ensureHealthEntry();
    const marketauxHealth = ensureMarketauxHealthEntry();
    if (!config.marketauxEnabled || !config.marketauxApiKey || !entries.length) {
      if (config.marketauxEnabled && !config.marketauxApiKey) {
        marketauxHealth.last_error = "MARKETAUX_API_KEY is not configured.";
        aggregateHealth.provider_failures.marketaux = (aggregateHealth.provider_failures.marketaux || 0) + 1;
      }
      return [];
    }

    marketauxHealth.polling = true;
    marketauxHealth.last_poll_at = new Date().toISOString();
    marketauxHealth.polls += 1;
    marketauxHealth.requested_symbols = entries.length;

    const results = [];
    let fetchedArticles = 0;
    let failedChunks = 0;
    const chunks = chunkArray(entries, config.marketauxSymbolsPerRequest);

    try {
      for (const chunk of chunks) {
        try {
          const payload = await fetchJsonWithRetry(buildMarketauxUrl(config, chunk), {
            timeoutMs: config.marketauxRequestTimeoutMs,
            retries: config.marketauxRequestRetries,
            label: `Marketaux news ${chunk.map((entry) => entry.ticker).join(",")}`,
            headers: {
              "User-Agent": "SentimentAnalyst/1.0 (+marketaux news)",
              Accept: "application/json"
            }
          });
          fetchedArticles += Array.isArray(payload?.data) ? payload.data.length : 0;
          results.push(...mapMarketauxArticles(payload, chunk, config.marketauxMaxItemsPerTicker));
        } catch (error) {
          failedChunks += 1;
          marketauxHealth.last_error = error.message;
          aggregateHealth.provider_failures.marketaux = (aggregateHealth.provider_failures.marketaux || 0) + 1;
        }
      }

      marketauxHealth.fetched_articles += fetchedArticles;
      if (results.length) {
        marketauxHealth.last_success_at = new Date().toISOString();
        marketauxHealth.last_error = null;
      } else if (!failedChunks) {
        marketauxHealth.last_success_at = new Date().toISOString();
        marketauxHealth.last_empty_at = marketauxHealth.last_success_at;
        marketauxHealth.last_error = null;
      }
      marketauxHealth.consecutive_failures = failedChunks === chunks.length ? marketauxHealth.consecutive_failures + 1 : 0;
      return results;
    } finally {
      marketauxHealth.polling = false;
    }
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
    const marketauxHealth = ensureMarketauxHealthEntry();
    health.polling = true;
    health.last_poll_at = new Date().toISOString();
    health.polls += 1;

    let ingested = 0;
    let skipped = 0;

    try {
      const marketauxFeeds = await fetchMarketauxFeeds(WATCHLIST);
      const marketauxTickers = new Set(marketauxFeeds.map((result) => result.entry.ticker));
      const rssFallbackEntries = WATCHLIST.filter((entry) => !marketauxTickers.has(entry.ticker));
      const rssFeeds = await Promise.all(rssFallbackEntries.map((entry) => fetchTickerFeed(entry)));
      const fetchedFeeds = [...marketauxFeeds, ...rssFeeds];

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
          if (provider?.key === "marketaux") {
            marketauxHealth.ingested_documents += 1;
          }
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
