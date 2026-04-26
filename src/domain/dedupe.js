import { dedupeKey, makeId, normalizeWhitespace, round } from "../utils/helpers.js";

function clusterKeyForDocument(normalized) {
  const urlBase = normalized.canonical_url ? normalized.canonical_url.split("?")[0] : null;
  return dedupeKey([normalized.primary_ticker, urlBase || normalizeWhitespace(normalized.headline)]);
}

export function assignDedupeCluster(store, normalized) {
  const key = clusterKeyForDocument(normalized);
  const existing = store.dedupeClusters.get(key);
  const now = new Date().toISOString();

  if (!existing) {
    const cluster = {
      dedupe_cluster_id: makeId(),
      cluster_key: key,
      canonical_headline: normalized.headline,
      canonical_url: normalized.canonical_url,
      first_seen_at: now,
      last_seen_at: now,
      member_count: 1,
      unique_source_count: 1,
      novelty_score: 1,
      source_names: new Set([normalized.source_name]),
      doc_ids: [normalized.doc_id]
    };

    store.dedupeClusters.set(key, cluster);
    return cluster;
  }

  existing.member_count += 1;
  existing.source_names.add(normalized.source_name);
  existing.unique_source_count = existing.source_names.size;
  existing.last_seen_at = now;
  existing.doc_ids.push(normalized.doc_id);
  existing.novelty_score = round(Math.max(0.18, 1 / existing.member_count ** 0.7), 3);
  return existing;
}
