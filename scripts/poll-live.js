import { createSentimentApp } from "../src/app.js";

const app = createSentimentApp();
await app.replay({ reset: true, intervalMs: 0 });
const pollResult = await app.pollLiveSourcesOnce();
const snapshot = app.getWatchlistSnapshot("1h");
const recent = app.getRecentDocuments({ limit: 12 });

console.log(
  JSON.stringify(
    {
      poll_result: pollResult,
      health: app.getHealth(),
      latest_events: recent.slice(0, 6).map((item) => ({
        ticker: item.ticker,
        source_name: item.source_name,
        event_type: item.event_type,
        headline: item.headline,
        timestamp: item.timestamp
      })),
      leaderboard_head: snapshot.leaderboard.slice(0, 5).map((item) => ({
        ticker: item.entity_key,
        weighted_sentiment: item.weighted_sentiment,
        confidence: item.weighted_confidence,
        top_event_type: item.top_event_types[0] || null
      }))
    },
    null,
    2
  )
);
