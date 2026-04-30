process.env.SEED_DATA_IN_DECISIONS = "true";

const { createSentimentApp } = await import("../src/app.js");

const app = createSentimentApp();
const count = await app.replay({ reset: true, intervalMs: 0 });

console.log(
  JSON.stringify(
    {
      replayed_documents: count,
      health: app.getHealth(),
      top_watchlist: app.getWatchlistSnapshot("1h").leaderboard.slice(0, 5).map((item) => ({
        ticker: item.entity_key,
        weighted_sentiment: item.weighted_sentiment,
        confidence: item.weighted_confidence
      }))
    },
    null,
    2
  )
);
