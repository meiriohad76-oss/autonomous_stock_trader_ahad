import { SOURCE_TRUST } from "./taxonomy.js";
import { buildUniverseLookup, uniqueUniverseEntries } from "./tracked-universe.js";
import { clamp, differenceInHours, makeId, normalizeWhitespace } from "../utils/helpers.js";

const AMBIGUOUS_TICKER_WORDS = new Set([
  "A",
  "ALL",
  "ARE",
  "CAT",
  "COST",
  "FAST",
  "GE",
  "HD",
  "LOW",
  "MA",
  "NOW",
  "ON",
  "PM",
  "T",
  "V"
]);

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phrasePattern(value) {
  return new RegExp(`\\b${escapeRegex(value)}\\b`, "i");
}

function strongTickerPattern(ticker) {
  const escaped = escapeRegex(ticker);
  return new RegExp(`(?:\\$${escaped}\\b|\\(${escaped}\\)|\\b(?:NASDAQ|NYSE|AMEX|ticker)\\s*:?\\s*${escaped}\\b|\\b${escaped}\\s+(?:stock|shares|earnings|options)\\b)`, "i");
}

function tickerTokenFound(ticker, text) {
  if (!ticker) {
    return false;
  }
  const ambiguous = ticker.length <= 2 || AMBIGUOUS_TICKER_WORDS.has(ticker);
  return ambiguous ? strongTickerPattern(ticker).test(text) : phrasePattern(ticker).test(text);
}

function detectTickers(text, universeEntries) {
  const matches = [];

  for (const entry of universeEntries) {
    const companyTokens = [entry.company, entry.company_name, ...entry.aliases]
      .map((token) => String(token || "").trim())
      .filter((token) => token && token.toUpperCase() !== entry.ticker && token.length >= 3);
    const found = tickerTokenFound(entry.ticker, text) || companyTokens.some((token) => phrasePattern(token).test(text));

    if (found) {
      matches.push(entry.ticker);
    }
  }

  return [...new Set(matches)];
}

function detectThemes(text) {
  const themePatterns = [
    ["earnings", /earnings|quarter|guidance|outlook/i],
    ["legal", /investigation|lawsuit|antitrust|regulatory/i],
    ["operations", /delay|outage|launch|recall|contract/i],
    ["capital", /buyback|offering|debt|liquidity|bankruptcy/i],
    ["insider", /form 4|insider|director purchased|activist/i],
    ["macro", /inflation|rates|policy|commodity/i]
  ];

  return themePatterns.filter(([, pattern]) => pattern.test(text)).map(([theme]) => theme);
}

export function normalizeRawDocument(raw, options = {}) {
  const universeEntries = uniqueUniverseEntries(options.universeEntries || []);
  const tickerLookup = buildUniverseLookup(universeEntries);
  const headline = normalizeWhitespace(raw.title);
  const bodyText = normalizeWhitespace(raw.body);
  const combined = `${headline} ${bodyText}`;
  const hintedTicker = raw.source_metadata?.ticker_hint?.toUpperCase?.() || null;
  const headlineTickers = detectTickers(headline, universeEntries);
  const fullTextTickers = detectTickers(combined, universeEntries);
  const hintMatchScope = raw.source_metadata?.ticker_hint_match_scope || "provider_entity";
  const hintMatchTickers = hintMatchScope === "headline" ? headlineTickers : fullTextTickers;
  const providerEntityMatchScore = Number(raw.source_metadata?.marketaux_entity_match_score);
  const providerEntityRequiresEvidence = raw.source_name === "marketaux" || raw.source_metadata?.collector === "marketaux_news";
  const providerEntityAccepted = hintMatchScope === "provider_entity" && (
    !providerEntityRequiresEvidence ||
    fullTextTickers.includes(hintedTicker) ||
    (Number.isFinite(providerEntityMatchScore) && providerEntityMatchScore >= 0.55)
  );
  const hintedTickerAccepted = Boolean(
    hintedTicker &&
      (
        providerEntityAccepted ||
        (hintMatchScope !== "provider_entity" && hintMatchTickers.includes(hintedTicker))
      )
  );
  const detectedTickers =
    hintMatchScope === "headline"
      ? headlineTickers
      : hintMatchScope === "provider_entity" && !providerEntityAccepted
        ? headlineTickers
        : fullTextTickers;
  const primaryTicker = hintedTickerAccepted ? hintedTicker : detectedTickers[0] || null;
  const universeEntry = primaryTicker ? tickerLookup.get(primaryTicker) : null;
  const publishedAt = raw.published_at || new Date().toISOString();
  const timelinessScore = clamp(Math.exp(-differenceInHours(publishedAt) / 18), 0.08, 1);
  const extractionQualityScore = clamp(
    (headline ? 0.35 : 0) +
      (bodyText ? 0.35 : 0) +
      (primaryTicker ? 0.2 : 0) +
      (raw.url ? 0.1 : 0),
    0,
    1
  );
  const mappingConfidence = hintedTickerAccepted
    ? hintMatchScope === "provider_entity" ? 0.94 : hintMatchScope === "headline" ? 0.88 : 0.82
    : primaryTicker ? 0.72 : 0.18;
  const sourceTrust = SOURCE_TRUST[raw.source_name] || 0.5;
  const sector = raw.source_metadata?.sector_hint || universeEntry?.sector || null;
  const industry = universeEntry?.industry || null;
  const companies = universeEntry ? [universeEntry.company] : [];

  return {
    doc_id: makeId(),
    raw_id: raw.raw_id,
    canonical_url: raw.canonical_url || raw.url,
    headline,
    summary_text: bodyText ? bodyText.slice(0, 180) : headline,
    body_text: bodyText || null,
    published_at: publishedAt,
    source_name: raw.source_name,
    source_type: raw.source_type,
    source_metadata: raw.source_metadata || null,
    source_trust: sourceTrust,
    is_official_filing: raw.source_type === "filing" || /sec\.gov/i.test(raw.url),
    is_press_release: /announces|company said|press release/i.test(combined),
    primary_ticker: primaryTicker,
    mentioned_tickers: [...new Set([...(primaryTicker ? [primaryTicker] : []), ...detectedTickers])],
    companies,
    sector,
    industry,
    regions: ["US"],
    themes: detectThemes(combined),
    dedupe_cluster_id: null,
    novelty_score: 1,
    timeliness_score: Number(timelinessScore.toFixed(3)),
    extraction_quality_score: Number(extractionQualityScore.toFixed(3)),
    mapping_confidence: Number(mappingConfidence.toFixed(3)),
    processing_notes: {
      ticker_hint_used: hintedTickerAccepted,
      ticker_hint_rejected: Boolean(hintedTicker && !hintedTickerAccepted),
      ticker_hint_match_scope: hintMatchScope,
      theme_count: detectThemes(combined).length
    }
  };
}

export function buildEntityRows(normalized, universeName, options = {}) {
  const tickerLookup = buildUniverseLookup(options.universeEntries || []);
  const entities = [];

  if (normalized.primary_ticker) {
    const tickerEntry = tickerLookup.get(normalized.primary_ticker);
    entities.push({
      entity_type: "ticker",
      entity_key: normalized.primary_ticker,
      entity_name: tickerEntry?.company || normalized.primary_ticker,
      relevance_score: normalized.mapping_confidence,
      is_primary: true
    });
  }

  if (normalized.sector) {
    entities.push({
      entity_type: "sector",
      entity_key: normalized.sector,
      entity_name: normalized.sector,
      relevance_score: normalized.primary_ticker ? 0.78 : 0.56,
      is_primary: !normalized.primary_ticker
    });
  }

  entities.push({
    entity_type: "watchlist",
    entity_key: "primary",
    entity_name: universeName,
    relevance_score: normalized.primary_ticker ? 0.68 : 0.42,
    is_primary: false
  });

  entities.push({
    entity_type: "market",
    entity_key: "market",
    entity_name: "Market",
    relevance_score: normalized.primary_ticker ? 0.52 : 0.66,
    is_primary: false
  });

  return entities.map((entity) => ({ ...entity, entity_id: makeId(), doc_id: normalized.doc_id }));
}
