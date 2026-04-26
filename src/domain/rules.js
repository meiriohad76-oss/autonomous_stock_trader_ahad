import { RULE_PATTERNS } from "./taxonomy.js";
import { clamp, normalizeWhitespace } from "../utils/helpers.js";

export function classifyWithRules(normalized) {
  const combined = normalizeWhitespace(`${normalized.headline} ${normalized.body_text || ""}`);
  const matched = RULE_PATTERNS
    .map((rule) => ({
      rule,
      hits: rule.patterns.filter((pattern) => pattern.test(combined)).length
    }))
    .filter((item) => item.hits > 0)
    .sort((a, b) => b.hits - a.hits || b.rule.confidence - a.rule.confidence);

  if (!matched.length) {
    return {
      event_family: "unclassified",
      event_type: "monitor_item",
      event_direction: "unclear",
      bullish_bearish_label: "neutral",
      urgency: "low",
      tradeability: "ignore",
      sentiment_score: 0,
      impact_score: 0.25,
      relevance_score: normalized.primary_ticker ? normalized.mapping_confidence : 0.2,
      rule_confidence: normalized.primary_ticker ? 0.42 : 0.28,
      reason_codes: ["no_strong_rule_match"],
      evidence_quotes: [],
      explanation_short: "The document did not match a strong event prior, so it remains a low-confidence monitor item."
    };
  }

  const top = matched[0].rule;
  const relevanceScore = clamp(
    normalized.primary_ticker ? normalized.mapping_confidence * (normalized.is_official_filing ? 1.05 : 1) : 0.22,
    0,
    1
  );

  return {
    event_family: top.family,
    event_type: top.type,
    event_direction: top.direction,
    bullish_bearish_label: top.label,
    urgency: top.urgency,
    tradeability: top.tradeability,
    sentiment_score: top.sentiment,
    impact_score: top.impact,
    relevance_score: Number(relevanceScore.toFixed(3)),
    rule_confidence: top.confidence,
    reason_codes: [...top.reasons, normalized.is_official_filing ? "official_source" : "media_source"],
    evidence_quotes: top.patterns
      .filter((pattern) => pattern.test(combined))
      .map((pattern) => String(pattern).slice(1, -2))
      .slice(0, 3),
    explanation_short: `Rule engine mapped the document to ${top.type} with ${top.label} short-term implications.`
  };
}
