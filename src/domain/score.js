import { clamp, makeId, round } from "../utils/helpers.js";

export function simulateLlmScore(normalized, ruleResult) {
  const ambiguityPenalty = normalized.mentioned_tickers.length > 1 ? 0.08 : 0;
  const duplicatePenalty = normalized.novelty_score < 0.55 ? 0.06 : 0;
  const missingBodyPenalty = normalized.body_text ? 0 : 0.08;
  const filingBonus = normalized.is_official_filing ? 0.06 : 0;
  const llmConfidence = clamp(
    ruleResult.rule_confidence + filingBonus - ambiguityPenalty - duplicatePenalty - missingBodyPenalty,
    0.2,
    0.96
  );

  const sentimentAdjustment = normalized.is_official_filing ? 0.04 : 0;
  const impactAdjustment = normalized.source_type === "macro" ? 0.06 : 0;

  return {
    event_family: ruleResult.event_family,
    event_type: ruleResult.event_type,
    event_direction: ruleResult.event_direction,
    bullish_bearish_label: ruleResult.bullish_bearish_label,
    sentiment_score: clamp(ruleResult.sentiment_score + Math.sign(ruleResult.sentiment_score || 1) * sentimentAdjustment, -1, 1),
    impact_score: clamp(ruleResult.impact_score + impactAdjustment, 0, 1),
    relevance_score: ruleResult.relevance_score,
    llm_confidence: round(llmConfidence, 3),
    reason_codes: ruleResult.reason_codes,
    explanation_short: ruleResult.explanation_short
  };
}

export function buildDocumentScore(normalized, ruleResult, llmResult) {
  const classificationConfidence = clamp(0.6 * llmResult.llm_confidence + 0.4 * ruleResult.rule_confidence, 0, 1);
  let finalConfidence = clamp(
    0.35 * classificationConfidence +
      0.15 * normalized.source_trust +
      0.15 * normalized.extraction_quality_score +
      0.15 * llmResult.relevance_score +
      0.1 * normalized.novelty_score +
      0.1 * normalized.timeliness_score,
    0,
    1
  );

  if (!normalized.primary_ticker) {
    finalConfidence *= 0.55;
  }

  if (normalized.mentioned_tickers.length > 1) {
    finalConfidence *= 0.92;
  }

  const documentAlpha =
    llmResult.sentiment_score *
    llmResult.impact_score *
    llmResult.relevance_score *
    normalized.novelty_score *
    normalized.timeliness_score *
    finalConfidence;

  return {
    score_id: makeId(),
    doc_id: normalized.doc_id,
    model_version: "rules-simulated-llm-v1",
    event_family: llmResult.event_family,
    event_type: llmResult.event_type,
    event_direction: llmResult.event_direction,
    bullish_bearish_label: llmResult.bullish_bearish_label,
    urgency: ruleResult.urgency,
    tradeability:
      finalConfidence >= 0.85 && Math.abs(llmResult.sentiment_score) >= 0.55
        ? "actionable"
        : finalConfidence >= 0.6
          ? "monitor"
          : "ignore",
    horizon: "1d",
    sentiment_score: round(llmResult.sentiment_score, 4),
    impact_score: round(llmResult.impact_score, 3),
    relevance_score: round(llmResult.relevance_score, 3),
    novelty_score: round(normalized.novelty_score, 3),
    timeliness_score: round(normalized.timeliness_score, 3),
    source_reliability_score: round(normalized.source_trust, 3),
    extraction_quality_score: round(normalized.extraction_quality_score, 3),
    llm_confidence: round(llmResult.llm_confidence, 3),
    rule_confidence: round(ruleResult.rule_confidence, 3),
    classification_confidence: round(classificationConfidence, 3),
    final_confidence: round(finalConfidence, 3),
    document_alpha: round(documentAlpha, 5),
    reason_codes: llmResult.reason_codes,
    evidence_quotes: ruleResult.evidence_quotes,
    explanation_short: llmResult.explanation_short,
    score_metadata: {
      mapping_confidence: normalized.mapping_confidence,
      source_name: normalized.source_name
    },
    scored_at: new Date().toISOString()
  };
}
