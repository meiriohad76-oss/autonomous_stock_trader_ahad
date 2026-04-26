import { readJson } from "../utils/helpers.js";

function materializeSampleEvents(sampleEvents) {
  const now = Date.now();
  return sampleEvents.map((event) => {
    const offsetMinutes = Number(event.source_metadata?.published_offset_minutes || 0);
    const publishedAt = new Date(now - offsetMinutes * 60_000).toISOString();

    return {
      ...event,
      published_at: publishedAt,
      fetched_at: new Date(now - Math.max(0, offsetMinutes - 1) * 60_000).toISOString()
    };
  });
}

export async function replaySampleEvents(app, { reset = false, intervalMs = 600 } = {}) {
  if (reset) {
    await app.reset();
  }

  const sampleEvents = materializeSampleEvents(await readJson(app.config.sampleEventsPath));
  app.store.health.lastReplayAt = new Date().toISOString();

  for (const event of sampleEvents) {
    await app.pipeline.processRawDocument(event);
    if (intervalMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  return sampleEvents.length;
}
