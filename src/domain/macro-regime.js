import { round } from "../utils/helpers.js";

const RISK_ON_SENTIMENT = 0.25;
const RISK_OFF_SENTIMENT = -0.25;
const RISK_ON_BREADTH = 0.6;
const RISK_OFF_BREADTH = 0.4;
const MIN_SECTORS = 5;
const MIN_DOC_COUNT = 20;

function getMarketState(store, window) {
  return store.sentimentStates.find(
    (s) => s.entity_type === "market" && s.entity_key === "market" && s.window === window
  ) || null;
}

function getSectorStates(store) {
  return store.sentimentStates.filter(
    (s) => s.entity_type === "sector" && s.window === "1h"
  );
}

function biasFromRegime(regime) {
  if (regime === "risk_on") return "bullish";
  if (regime === "risk_off") return "bearish";
  return "neutral";
}

export function computeMacroRegime(store) {
  const market1h = getMarketState(store, "1h");
  const market1d = getMarketState(store, "1d");
  const sectors = getSectorStates(store);

  const sentiment1h = market1h?.weighted_sentiment ?? 0;
  const sentiment1d = market1d?.weighted_sentiment ?? 0;
  const momentum = market1h?.momentum_delta ?? 0;

  const totalSectors = sectors.length;
  const bullishSectors = sectors.filter((s) => s.weighted_sentiment > 0.1).length;
  const bearishSectors = sectors.filter((s) => s.weighted_sentiment < -0.1).length;
  const neutralSectors = totalSectors - bullishSectors - bearishSectors;
  const breadthScore = totalSectors > 0 ? round(bullishSectors / totalSectors, 3) : 0.5;

  const totalDocs = (market1h?.doc_count ?? 0) + (market1d?.doc_count ?? 0);
  const hasEnoughData = totalSectors >= MIN_SECTORS && totalDocs >= MIN_DOC_COUNT;

  let regime;
  if (!hasEnoughData) {
    regime = "neutral";
  } else if (sentiment1h >= RISK_ON_SENTIMENT && breadthScore >= RISK_ON_BREADTH) {
    regime = "risk_on";
  } else if (sentiment1h <= RISK_OFF_SENTIMENT && breadthScore <= RISK_OFF_BREADTH) {
    regime = "risk_off";
  } else if (Math.abs(sentiment1h) < 0.1 && bullishSectors > 0 && bearishSectors > 0) {
    regime = "mixed";
  } else {
    regime = "neutral";
  }

  const marketConf = market1h?.weighted_confidence ?? 0;
  const sectorCoverage = Math.min(1, totalSectors / 9);
  const confidence = round(Math.min(1, marketConf * 0.5 + sectorCoverage * 0.3 + (hasEnoughData ? 0.2 : 0)), 3);

  const signalsUsed = [];
  if (market1h) signalsUsed.push("market_sentiment_1h");
  if (market1d) signalsUsed.push("market_sentiment_1d");
  if (sectors.length) signalsUsed.push("sector_breadth");
  if (store.alertHistory?.length) signalsUsed.push("alert_history");

  const sentimentStr = sentiment1h >= 0 ? `+${sentiment1h.toFixed(2)}` : sentiment1h.toFixed(2);
  const breadthStr = totalSectors > 0
    ? `${bullishSectors}/${totalSectors} sectors bullish`
    : "insufficient sector data";
  const explanation = `${regime.replace("_", "-")} regime; 1h market sentiment ${sentimentStr}; ${breadthStr}; confidence ${confidence.toFixed(2)}`;

  return {
    as_of: new Date().toISOString(),
    regime,
    confidence,
    bias: biasFromRegime(regime),
    breadth: {
      bullish_sectors: bullishSectors,
      bearish_sectors: bearishSectors,
      neutral_sectors: neutralSectors,
      breadth_score: breadthScore
    },
    market_sentiment_1h: round(sentiment1h, 4),
    market_sentiment_1d: round(sentiment1d, 4),
    momentum_delta: round(momentum, 4),
    signals_used: signalsUsed,
    explanation
  };
}
