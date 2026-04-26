import pg from "pg";
import { config } from "../src/config.js";
import { createPersistence } from "../src/domain/persistence.js";

const { Pool } = pg;

if (config.databaseProvider !== "postgres") {
  console.error("DATABASE_PROVIDER is not set to postgres in .env");
  process.exit(1);
}

if (!config.databaseUrl) {
  console.error("DATABASE_URL is empty in .env");
  process.exit(1);
}

const pool = new Pool({
  connectionString: config.databaseUrl
});

try {
  const version = await pool.query("SELECT version() AS version");
  const persistence = createPersistence({ config });
  await persistence.init();
  const hasData = await persistence.hasData();
  const tableCount = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN (
         'raw_documents',
         'normalized_documents',
         'document_entities',
         'document_scores',
         'sentiment_states',
         'source_stats',
         'alert_history',
         'dedupe_clusters',
         'seen_external_documents',
         'runtime_state'
       )`
  );

  console.log(
    JSON.stringify(
      {
        database_provider: config.databaseProvider,
        version: version.rows[0]?.version || null,
        schema_tables_present: tableCount.rows[0]?.count || 0,
        has_data: hasData
      },
      null,
      2
    )
  );
} finally {
  await pool.end();
}
