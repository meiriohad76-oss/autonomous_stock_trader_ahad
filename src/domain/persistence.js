import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import pg from "pg";
import { createEmptyFundamentalsState } from "./fundamentals.js";

const { Pool } = pg;

const SQLITE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS raw_documents (
  raw_id TEXT PRIMARY KEY,
  published_at TEXT,
  source_name TEXT,
  source_type TEXT,
  url TEXT,
  canonical_url TEXT,
  payload_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS normalized_documents (
  doc_id TEXT PRIMARY KEY,
  raw_id TEXT UNIQUE,
  primary_ticker TEXT,
  source_name TEXT,
  published_at TEXT,
  payload_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS document_entities (
  entity_id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE (doc_id, entity_type, entity_key)
);
CREATE TABLE IF NOT EXISTS document_scores (
  score_id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  event_family TEXT,
  event_type TEXT,
  final_confidence REAL,
  scored_at TEXT,
  payload_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sentiment_states (
  state_id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  window TEXT NOT NULL,
  as_of TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE (entity_type, entity_key, window, as_of)
);
CREATE TABLE IF NOT EXISTS source_stats (
  source_name TEXT PRIMARY KEY,
  updated_at TEXT,
  payload_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alert_history (
  alert_id TEXT PRIMARY KEY,
  entity_key TEXT,
  created_at TEXT,
  payload_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dedupe_clusters (
  cluster_key TEXT PRIMARY KEY,
  dedupe_cluster_id TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS seen_external_documents (
  seen_key TEXT PRIMARY KEY,
  first_seen_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runtime_state (
  state_key TEXT PRIMARY KEY,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
`;

const POSTGRES_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS raw_documents (
  raw_id TEXT PRIMARY KEY,
  published_at TIMESTAMPTZ,
  source_name TEXT,
  source_type TEXT,
  url TEXT,
  canonical_url TEXT,
  payload_json JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS normalized_documents (
  doc_id TEXT PRIMARY KEY,
  raw_id TEXT UNIQUE,
  primary_ticker TEXT,
  source_name TEXT,
  published_at TIMESTAMPTZ,
  payload_json JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS document_entities (
  entity_id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  UNIQUE (doc_id, entity_type, entity_key)
);
CREATE TABLE IF NOT EXISTS document_scores (
  score_id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  event_family TEXT,
  event_type TEXT,
  final_confidence DOUBLE PRECISION,
  scored_at TIMESTAMPTZ,
  payload_json JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS sentiment_states (
  state_id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  window TEXT NOT NULL,
  as_of TIMESTAMPTZ NOT NULL,
  payload_json JSONB NOT NULL,
  UNIQUE (entity_type, entity_key, window, as_of)
);
CREATE TABLE IF NOT EXISTS source_stats (
  source_name TEXT PRIMARY KEY,
  updated_at TIMESTAMPTZ,
  payload_json JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS alert_history (
  alert_id TEXT PRIMARY KEY,
  entity_key TEXT,
  created_at TIMESTAMPTZ,
  payload_json JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS dedupe_clusters (
  cluster_key TEXT PRIMARY KEY,
  dedupe_cluster_id TEXT NOT NULL,
  payload_json JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS seen_external_documents (
  seen_key TEXT PRIMARY KEY,
  first_seen_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS runtime_state (
  state_key TEXT PRIMARY KEY,
  updated_at TIMESTAMPTZ NOT NULL,
  payload_json JSONB NOT NULL
);
`;

function reviveFundamentals(snapshot) {
  if (!snapshot?.asOf) {
    return createEmptyFundamentalsState();
  }

  return {
    ...snapshot,
    byTicker: new Map((snapshot.leaderboard || []).map((item) => [item.ticker, item])),
    bySector: new Map((snapshot.sectors || []).map((item) => [item.sector, item]))
  };
}

function serializeCluster(cluster) {
  return {
    ...cluster,
    source_names: [...(cluster.source_names || [])]
  };
}

function reviveCluster(cluster) {
  return {
    ...cluster,
    source_names: new Set(cluster.source_names || [])
  };
}

function parsePayload(value, fallback) {
  try {
    if (value === null || value === undefined) {
      return fallback;
    }
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
}

function buildRuntimeFundamentals(store) {
  return {
    asOf: store.fundamentals.asOf,
    summary: store.fundamentals.summary,
    leaderboard: store.fundamentals.leaderboard,
    sectors: store.fundamentals.sectors,
    changes: store.fundamentals.changes
  };
}

function hydrateStoreFromRows(store, rows) {
  store.rawDocuments = rows.rawDocuments.map((row) => parsePayload(row.payload_json, null)).filter(Boolean);
  store.normalizedDocuments = rows.normalizedDocuments.map((row) => parsePayload(row.payload_json, null)).filter(Boolean);
  store.documentEntities = rows.documentEntities.map((row) => parsePayload(row.payload_json, null)).filter(Boolean);
  store.documentScores = rows.documentScores.map((row) => parsePayload(row.payload_json, null)).filter(Boolean);
  store.sentimentStates = rows.sentimentStates.map((row) => parsePayload(row.payload_json, null)).filter(Boolean);
  store.sourceStats = new Map(
    rows.sourceStats
      .map((row) => [row.source_name, parsePayload(row.payload_json, null)])
      .filter(([, value]) => Boolean(value))
  );
  store.alertHistory = rows.alertHistory.map((row) => parsePayload(row.payload_json, null)).filter(Boolean);
  store.dedupeClusters = new Map(
    rows.dedupeClusters
      .map((row) => [row.cluster_key, reviveCluster(parsePayload(row.payload_json, null))])
      .filter(([, value]) => Boolean(value))
  );
  store.seenExternalDocuments = new Set(rows.seenExternalDocuments.map((row) => row.seen_key));

  const runtimeMap = new Map(rows.runtimeState.map((row) => [row.state_key, parsePayload(row.payload_json, null)]));
  const persistedHealth = runtimeMap.get("health");
  const persistedFundamentals = runtimeMap.get("fundamentals");

  if (persistedHealth) {
    store.health = {
      ...store.health,
      ...persistedHealth,
      liveSources: persistedHealth.liveSources || {}
    };
  }

  if (persistedFundamentals) {
    store.fundamentals = reviveFundamentals(persistedFundamentals);
  }
}

function createDisabledPersistence() {
  return {
    async init() {},
    async hydrateStore() {},
    async clearAll() {},
    async saveStoreSnapshot() {},
    async hasData() {
      return false;
    }
  };
}

function createSqlitePersistence(config) {
  mkdirSync(path.dirname(config.databasePath), { recursive: true });
  const db = new DatabaseSync(config.databasePath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");

  return {
    async init() {
      db.exec(SQLITE_SCHEMA_SQL);
    },
    async clearAll() {
      db.exec(`
        DELETE FROM raw_documents;
        DELETE FROM normalized_documents;
        DELETE FROM document_entities;
        DELETE FROM document_scores;
        DELETE FROM sentiment_states;
        DELETE FROM source_stats;
        DELETE FROM alert_history;
        DELETE FROM dedupe_clusters;
        DELETE FROM seen_external_documents;
        DELETE FROM runtime_state;
      `);
    },
    async hasData() {
      const row = db.prepare("SELECT COUNT(*) AS count FROM raw_documents").get();
      return Number(row?.count || 0) > 0;
    },
    async hydrateStore(store) {
      hydrateStoreFromRows(store, {
        rawDocuments: db.prepare("SELECT payload_json FROM raw_documents ORDER BY published_at ASC, raw_id ASC").all(),
        normalizedDocuments: db.prepare("SELECT payload_json FROM normalized_documents ORDER BY published_at ASC, doc_id ASC").all(),
        documentEntities: db.prepare("SELECT payload_json FROM document_entities ORDER BY doc_id ASC, entity_type ASC").all(),
        documentScores: db.prepare("SELECT payload_json FROM document_scores ORDER BY scored_at ASC, score_id ASC").all(),
        sentimentStates: db.prepare("SELECT payload_json FROM sentiment_states ORDER BY as_of ASC, entity_type ASC, entity_key ASC").all(),
        sourceStats: db.prepare("SELECT source_name, payload_json FROM source_stats").all(),
        alertHistory: db.prepare("SELECT payload_json FROM alert_history ORDER BY created_at DESC, alert_id DESC").all(),
        dedupeClusters: db.prepare("SELECT cluster_key, payload_json FROM dedupe_clusters").all(),
        seenExternalDocuments: db.prepare("SELECT seen_key FROM seen_external_documents").all(),
        runtimeState: db.prepare("SELECT state_key, payload_json FROM runtime_state").all()
      });
    },
    async saveStoreSnapshot(store) {
      const now = new Date().toISOString();
      const insertRaw = db.prepare(`
        INSERT OR REPLACE INTO raw_documents (raw_id, published_at, source_name, source_type, url, canonical_url, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const insertNormalized = db.prepare(`
        INSERT OR REPLACE INTO normalized_documents (doc_id, raw_id, primary_ticker, source_name, published_at, payload_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const insertEntity = db.prepare(`
        INSERT OR REPLACE INTO document_entities (entity_id, doc_id, entity_type, entity_key, payload_json)
        VALUES (?, ?, ?, ?, ?)
      `);
      const insertScore = db.prepare(`
        INSERT OR REPLACE INTO document_scores (score_id, doc_id, event_family, event_type, final_confidence, scored_at, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const insertState = db.prepare(`
        INSERT OR REPLACE INTO sentiment_states (state_id, entity_type, entity_key, window, as_of, payload_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const insertSource = db.prepare(`
        INSERT OR REPLACE INTO source_stats (source_name, updated_at, payload_json)
        VALUES (?, ?, ?)
      `);
      const insertAlert = db.prepare(`
        INSERT OR REPLACE INTO alert_history (alert_id, entity_key, created_at, payload_json)
        VALUES (?, ?, ?, ?)
      `);
      const insertCluster = db.prepare(`
        INSERT OR REPLACE INTO dedupe_clusters (cluster_key, dedupe_cluster_id, payload_json)
        VALUES (?, ?, ?)
      `);
      const insertSeen = db.prepare(`
        INSERT OR IGNORE INTO seen_external_documents (seen_key, first_seen_at)
        VALUES (?, ?)
      `);
      const insertRuntime = db.prepare(`
        INSERT OR REPLACE INTO runtime_state (state_key, updated_at, payload_json)
        VALUES (?, ?, ?)
      `);

      db.exec("BEGIN");
      try {
        for (const raw of store.rawDocuments) {
          insertRaw.run(raw.raw_id, raw.published_at || null, raw.source_name || null, raw.source_type || null, raw.url || null, raw.canonical_url || raw.url || null, JSON.stringify(raw));
        }
        for (const normalized of store.normalizedDocuments) {
          insertNormalized.run(normalized.doc_id, normalized.raw_id, normalized.primary_ticker || null, normalized.source_name || null, normalized.published_at || null, JSON.stringify(normalized));
        }
        for (const entity of store.documentEntities) {
          insertEntity.run(entity.entity_id, entity.doc_id, entity.entity_type, entity.entity_key, JSON.stringify(entity));
        }
        for (const score of store.documentScores) {
          insertScore.run(score.score_id, score.doc_id, score.event_family || null, score.event_type || null, score.final_confidence || null, score.scored_at || null, JSON.stringify(score));
        }
        for (const state of store.sentimentStates) {
          insertState.run(state.state_id, state.entity_type, state.entity_key, state.window, state.as_of, JSON.stringify(state));
        }
        for (const [sourceName, source] of store.sourceStats.entries()) {
          insertSource.run(sourceName, source.updated_at || now, JSON.stringify(source));
        }
        for (const alert of store.alertHistory) {
          insertAlert.run(alert.alert_id, alert.entity_key || null, alert.created_at || now, JSON.stringify(alert));
        }
        for (const [clusterKey, cluster] of store.dedupeClusters.entries()) {
          insertCluster.run(clusterKey, cluster.dedupe_cluster_id, JSON.stringify(serializeCluster(cluster)));
        }
        for (const seenKey of store.seenExternalDocuments) {
          insertSeen.run(seenKey, now);
        }
        insertRuntime.run("health", now, JSON.stringify(store.health));
        insertRuntime.run("fundamentals", now, JSON.stringify(buildRuntimeFundamentals(store)));
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  };
}

function createPostgresPersistence(config) {
  const pool = new Pool({
    connectionString: config.databaseUrl
  });

  return {
    async init() {
      await pool.query(POSTGRES_SCHEMA_SQL);
    },
    async clearAll() {
      await pool.query(`
        TRUNCATE TABLE
          raw_documents,
          normalized_documents,
          document_entities,
          document_scores,
          sentiment_states,
          source_stats,
          alert_history,
          dedupe_clusters,
          seen_external_documents,
          runtime_state
        RESTART IDENTITY;
      `);
    },
    async hasData() {
      const result = await pool.query("SELECT COUNT(*)::int AS count FROM raw_documents");
      return Number(result.rows[0]?.count || 0) > 0;
    },
    async hydrateStore(store) {
      const [
        rawDocuments,
        normalizedDocuments,
        documentEntities,
        documentScores,
        sentimentStates,
        sourceStats,
        alertHistory,
        dedupeClusters,
        seenExternalDocuments,
        runtimeState
      ] = await Promise.all([
        pool.query("SELECT payload_json FROM raw_documents ORDER BY published_at ASC NULLS LAST, raw_id ASC"),
        pool.query("SELECT payload_json FROM normalized_documents ORDER BY published_at ASC NULLS LAST, doc_id ASC"),
        pool.query("SELECT payload_json FROM document_entities ORDER BY doc_id ASC, entity_type ASC"),
        pool.query("SELECT payload_json FROM document_scores ORDER BY scored_at ASC NULLS LAST, score_id ASC"),
        pool.query("SELECT payload_json FROM sentiment_states ORDER BY as_of ASC, entity_type ASC, entity_key ASC"),
        pool.query("SELECT source_name, payload_json FROM source_stats"),
        pool.query("SELECT payload_json FROM alert_history ORDER BY created_at DESC NULLS LAST, alert_id DESC"),
        pool.query("SELECT cluster_key, payload_json FROM dedupe_clusters"),
        pool.query("SELECT seen_key FROM seen_external_documents"),
        pool.query("SELECT state_key, payload_json FROM runtime_state")
      ]);

      hydrateStoreFromRows(store, {
        rawDocuments: rawDocuments.rows,
        normalizedDocuments: normalizedDocuments.rows,
        documentEntities: documentEntities.rows,
        documentScores: documentScores.rows,
        sentimentStates: sentimentStates.rows,
        sourceStats: sourceStats.rows,
        alertHistory: alertHistory.rows,
        dedupeClusters: dedupeClusters.rows,
        seenExternalDocuments: seenExternalDocuments.rows,
        runtimeState: runtimeState.rows
      });
    },
    async saveStoreSnapshot(store) {
      const client = await pool.connect();
      const now = new Date().toISOString();

      try {
        await client.query("BEGIN");

        for (const raw of store.rawDocuments) {
          await client.query(
            `INSERT INTO raw_documents (raw_id, published_at, source_name, source_type, url, canonical_url, payload_json)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
             ON CONFLICT (raw_id) DO UPDATE
             SET published_at = EXCLUDED.published_at,
                 source_name = EXCLUDED.source_name,
                 source_type = EXCLUDED.source_type,
                 url = EXCLUDED.url,
                 canonical_url = EXCLUDED.canonical_url,
                 payload_json = EXCLUDED.payload_json`,
            [raw.raw_id, raw.published_at || null, raw.source_name || null, raw.source_type || null, raw.url || null, raw.canonical_url || raw.url || null, JSON.stringify(raw)]
          );
        }

        for (const normalized of store.normalizedDocuments) {
          await client.query(
            `INSERT INTO normalized_documents (doc_id, raw_id, primary_ticker, source_name, published_at, payload_json)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb)
             ON CONFLICT (doc_id) DO UPDATE
             SET raw_id = EXCLUDED.raw_id,
                 primary_ticker = EXCLUDED.primary_ticker,
                 source_name = EXCLUDED.source_name,
                 published_at = EXCLUDED.published_at,
                 payload_json = EXCLUDED.payload_json`,
            [normalized.doc_id, normalized.raw_id, normalized.primary_ticker || null, normalized.source_name || null, normalized.published_at || null, JSON.stringify(normalized)]
          );
        }

        for (const entity of store.documentEntities) {
          await client.query(
            `INSERT INTO document_entities (entity_id, doc_id, entity_type, entity_key, payload_json)
             VALUES ($1, $2, $3, $4, $5::jsonb)
             ON CONFLICT (entity_id) DO UPDATE
             SET doc_id = EXCLUDED.doc_id,
                 entity_type = EXCLUDED.entity_type,
                 entity_key = EXCLUDED.entity_key,
                 payload_json = EXCLUDED.payload_json`,
            [entity.entity_id, entity.doc_id, entity.entity_type, entity.entity_key, JSON.stringify(entity)]
          );
        }

        for (const score of store.documentScores) {
          await client.query(
            `INSERT INTO document_scores (score_id, doc_id, event_family, event_type, final_confidence, scored_at, payload_json)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
             ON CONFLICT (score_id) DO UPDATE
             SET doc_id = EXCLUDED.doc_id,
                 event_family = EXCLUDED.event_family,
                 event_type = EXCLUDED.event_type,
                 final_confidence = EXCLUDED.final_confidence,
                 scored_at = EXCLUDED.scored_at,
                 payload_json = EXCLUDED.payload_json`,
            [score.score_id, score.doc_id, score.event_family || null, score.event_type || null, score.final_confidence || null, score.scored_at || null, JSON.stringify(score)]
          );
        }

        for (const state of store.sentimentStates) {
          await client.query(
            `INSERT INTO sentiment_states (state_id, entity_type, entity_key, window, as_of, payload_json)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb)
             ON CONFLICT (state_id) DO UPDATE
             SET entity_type = EXCLUDED.entity_type,
                 entity_key = EXCLUDED.entity_key,
                 window = EXCLUDED.window,
                 as_of = EXCLUDED.as_of,
                 payload_json = EXCLUDED.payload_json`,
            [state.state_id, state.entity_type, state.entity_key, state.window, state.as_of, JSON.stringify(state)]
          );
        }

        for (const [sourceName, source] of store.sourceStats.entries()) {
          await client.query(
            `INSERT INTO source_stats (source_name, updated_at, payload_json)
             VALUES ($1, $2, $3::jsonb)
             ON CONFLICT (source_name) DO UPDATE
             SET updated_at = EXCLUDED.updated_at,
                 payload_json = EXCLUDED.payload_json`,
            [sourceName, source.updated_at || now, JSON.stringify(source)]
          );
        }

        for (const alert of store.alertHistory) {
          await client.query(
            `INSERT INTO alert_history (alert_id, entity_key, created_at, payload_json)
             VALUES ($1, $2, $3, $4::jsonb)
             ON CONFLICT (alert_id) DO UPDATE
             SET entity_key = EXCLUDED.entity_key,
                 created_at = EXCLUDED.created_at,
                 payload_json = EXCLUDED.payload_json`,
            [alert.alert_id, alert.entity_key || null, alert.created_at || now, JSON.stringify(alert)]
          );
        }

        for (const [clusterKey, cluster] of store.dedupeClusters.entries()) {
          await client.query(
            `INSERT INTO dedupe_clusters (cluster_key, dedupe_cluster_id, payload_json)
             VALUES ($1, $2, $3::jsonb)
             ON CONFLICT (cluster_key) DO UPDATE
             SET dedupe_cluster_id = EXCLUDED.dedupe_cluster_id,
                 payload_json = EXCLUDED.payload_json`,
            [clusterKey, cluster.dedupe_cluster_id, JSON.stringify(serializeCluster(cluster))]
          );
        }

        for (const seenKey of store.seenExternalDocuments) {
          await client.query(
            `INSERT INTO seen_external_documents (seen_key, first_seen_at)
             VALUES ($1, $2)
             ON CONFLICT (seen_key) DO NOTHING`,
            [seenKey, now]
          );
        }

        await client.query(
          `INSERT INTO runtime_state (state_key, updated_at, payload_json)
           VALUES ($1, $2, $3::jsonb)
           ON CONFLICT (state_key) DO UPDATE
           SET updated_at = EXCLUDED.updated_at,
               payload_json = EXCLUDED.payload_json`,
          ["health", now, JSON.stringify(store.health)]
        );
        await client.query(
          `INSERT INTO runtime_state (state_key, updated_at, payload_json)
           VALUES ($1, $2, $3::jsonb)
           ON CONFLICT (state_key) DO UPDATE
           SET updated_at = EXCLUDED.updated_at,
               payload_json = EXCLUDED.payload_json`,
          ["fundamentals", now, JSON.stringify(buildRuntimeFundamentals(store))]
        );

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

export function createPersistence({ config }) {
  const provider =
    !config.databaseEnabled
      ? createDisabledPersistence()
      : config.databaseProvider === "postgres"
        ? createPostgresPersistence(config)
        : createSqlitePersistence(config);

  let writeQueue = Promise.resolve();

  return {
    async init() {
      return provider.init();
    },
    async hydrateStore(store) {
      return provider.hydrateStore(store);
    },
    async clearAll() {
      writeQueue = writeQueue.then(() => provider.clearAll());
      return writeQueue;
    },
    async hasData() {
      return provider.hasData();
    },
    async saveStoreSnapshot(store) {
      writeQueue = writeQueue.then(() => provider.saveStoreSnapshot(store));
      return writeQueue;
    }
  };
}
