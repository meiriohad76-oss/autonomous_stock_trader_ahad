import { SOURCE_TRUST, TICKER_LOOKUP, WATCHLIST } from "./taxonomy.js";
import { clamp, differenceInHours, makeId, normalizeWhitespace } from "../utils/helpers.js";

function detectTickers(text) {
  const matches = [];

  for (const entry of WATCHLIST) {
    const tokens = [entry.ticker, entry.company, ...entry.aliases];
    const found = tokens.some((token) => new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));

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

export function normalizeRawDocument(raw) {
  const headline = normalizeWhitespace(raw.title);
  const bodyText = normalizeWhitespace(raw.body);
  const combined = `${headline} ${bodyText}`;
  const hintedTicker = raw.source_metadata?.ticker_hint?.toUpperCase?.() || null;
  const detectedTickers = detectTickers(combined);
  const primaryTicker = hintedTicker || detectedTickers[0] || null;
  const watchlistEntry = primaryTicker ? TICKER_LOOKUP.get(primaryTicker) : null;
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
  const mappingConfidence = hintedTicker ? 0.94 : primaryTicker ? 0.72 : 0.18;
  const sourceTrust = SOURCE_TRUST[raw.source_name] || 0.5;
  const sector = raw.source_metadata?.sector_hint || watchlistEntry?.sector || null;
  const industry = watchlistEntry?.industry || null;
  const companies = watchlistEntry ? [watchlistEntry.company] : [];

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
      ticker_hint_used: Boolean(hintedTicker),
      theme_count: detectThemes(combined).length
    }
  };
}

export function buildEntityRows(normalized, universeName) {
  const entities = [];

  if (normalized.primary_ticker) {
    const tickerEntry = TICKER_LOOKUP.get(normalized.primary_ticker);
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
