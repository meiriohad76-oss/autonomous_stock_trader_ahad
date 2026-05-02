import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import pg from "pg";
import { buildInitialScreenerSnapshot, createEmptyFundamentalsState } from "./fundamentals.js";
import { createEmptyFundamentalPersistence } from "./fundamental-persistence.js";
import { summarizeEvidenceQuality } from "./evidence-quality.js";
import { buildMacroRegimeSnapshot } from "./macro-regime.js";
import { buildTradeSetupsSnapshot } from "./trade-setup.js";

const { Pool } = pg;

function formatBackupStamp(date = new Date()) {
  const iso = date.toISOString().replace(/[-:]/g, "").replace("T", "-");
  return iso.replace(".", "-");
}

function escapeSqliteLiteral(value) {
  return String(value).replace(/'/g, "''");
}

function listSqliteBackupEntries(config) {
  if (!existsSync(config.sqliteBackupDir)) {
    return [];
  }

  return readdirSync(config.sqliteBackupDir)
    .filter((name) => /^sentiment-analyst-\d{8}-\d{6}-\d{3}Z\.sqlite$/i.test(name))
    .map((name) => {
      const filePath = path.join(config.sqliteBackupDir, name);
      const stats = statSync(filePath);
      return {
        name,
        path: filePath,
        size_bytes: stats.size,
        created_at: stats.mtime.toISOString(),
        created_at_ms: stats.mtimeMs
      };
    })
    .sort((a, b) => b.created_at_ms - a.created_at_ms);
}

function buildDisabledBackupStatus(config, reason = "database_disabled") {
  return {
    provider: config.databaseProvider,
    supported: false,
    enabled: false,
    reason,
    backup_dir: null,
    interval_ms: null,
    retention_count: null,
    retention_days: null,
    on_startup: null,
    last_backup_at: null,
    last_backup_path: null,
    last_backup_size_bytes: null,
    backup_count: 0,
    last_error: null
  };
}

function buildSqliteBackupStatus(config, state) {
  const backups = listSqliteBackupEntries(config);
  return {
    provider: "sqlite",
    supported: true,
    enabled: Boolean(config.sqliteBackupEnabled),
    reason: null,
    backup_dir: config.sqliteBackupDir,
    interval_ms: config.sqliteBackupIntervalMs,
    retention_count: config.sqliteBackupRetentionCount,
    retention_days: config.sqliteBackupRetentionDays,
    on_startup: config.sqliteBackupOnStartup,
    last_backup_at: state.lastBackupAt || backups[0]?.created_at || null,
    last_backup_path: state.lastBackupPath || backups[0]?.path || null,
    last_backup_size_bytes: state.lastBackupSizeBytes ?? backups[0]?.size_bytes ?? null,
    backup_count: backups.length,
    last_error: state.lastError || null
  };
}

function pruneSqliteBackups(config) {
  if (!config.sqliteBackupEnabled) {
    return [];
  }

  const backups = listSqliteBackupEntries(config);
  const keepCount = Math.max(1, Number(config.sqliteBackupRetentionCount || 1));
  const retentionMs = Math.max(0, Number(config.sqliteBackupRetentionDays || 0)) * 24 * 60 * 60 * 1000;
  const cutoff = retentionMs ? Date.now() - retentionMs : null;

  backups.forEach((entry, index) => {
    const exceedsCount = index >= keepCount;
    const exceedsAge = cutoff !== null && entry.created_at_ms < cutoff;
    if (exceedsCount || exceedsAge) {
      rmSync(entry.path, { force: true });
    }
  });

  return listSqliteBackupEntries(config);
}

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

const SQLITE_FUNDAMENTALS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS coverage_universe (
  ticker TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  cik TEXT,
  exchange TEXT,
  country TEXT DEFAULT 'US',
  sector TEXT NOT NULL,
  industry TEXT NOT NULL,
  market_cap_bucket TEXT,
  benchmark_group TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS filing_events (
  filing_id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  cik TEXT,
  form_type TEXT NOT NULL,
  filing_date TEXT NOT NULL,
  accepted_at TEXT,
  accession_no TEXT,
  period_end TEXT,
  source_url TEXT NOT NULL,
  is_restated INTEGER NOT NULL DEFAULT 0,
  contains_xbrl INTEGER NOT NULL DEFAULT 0,
  filing_metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ticker, accession_no)
);
CREATE TABLE IF NOT EXISTS financial_periods (
  period_id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  fiscal_year INTEGER NOT NULL,
  fiscal_quarter INTEGER,
  period_type TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT NOT NULL,
  filing_id TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  is_latest INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS financial_facts (
  fact_id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  taxonomy TEXT NOT NULL,
  concept TEXT NOT NULL,
  canonical_field TEXT NOT NULL,
  value REAL,
  unit TEXT,
  source_form TEXT,
  as_reported_label TEXT,
  normalization_notes TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS market_reference (
  reference_id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  as_of TEXT NOT NULL,
  close_price REAL,
  market_cap REAL,
  enterprise_value REAL,
  shares_outstanding REAL,
  beta REAL,
  market_reference_metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ticker, as_of)
);
CREATE TABLE IF NOT EXISTS fundamental_features (
  feature_id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  as_of TEXT NOT NULL,
  window_basis TEXT NOT NULL,
  revenue_growth_yoy REAL,
  eps_growth_yoy REAL,
  fcf_growth_yoy REAL,
  gross_margin REAL,
  operating_margin REAL,
  net_margin REAL,
  roe REAL,
  roic REAL,
  debt_to_equity REAL,
  net_debt_to_ebitda REAL,
  current_ratio REAL,
  interest_coverage REAL,
  fcf_margin REAL,
  fcf_conversion REAL,
  asset_turnover REAL,
  margin_stability REAL,
  revenue_consistency REAL,
  pe_ttm REAL,
  ev_to_ebitda_ttm REAL,
  price_to_sales_ttm REAL,
  peg REAL,
  fcf_yield REAL,
  feature_metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ticker, as_of, window_basis)
);
CREATE TABLE IF NOT EXISTS fundamental_scores (
  score_id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  as_of TEXT NOT NULL,
  sector TEXT NOT NULL,
  quality_score REAL NOT NULL,
  growth_score REAL NOT NULL,
  valuation_score REAL NOT NULL,
  balance_sheet_score REAL NOT NULL,
  efficiency_score REAL NOT NULL,
  earnings_stability_score REAL NOT NULL,
  sector_score REAL NOT NULL,
  reporting_confidence_score REAL NOT NULL,
  data_freshness_score REAL NOT NULL,
  peer_comparability_score REAL NOT NULL,
  rule_confidence REAL NOT NULL,
  llm_confidence REAL NOT NULL,
  anomaly_penalty REAL NOT NULL,
  final_confidence REAL NOT NULL,
  composite_fundamental_score REAL NOT NULL,
  rating_label TEXT NOT NULL,
  valuation_label TEXT NOT NULL,
  direction_label TEXT NOT NULL,
  regime_label TEXT NOT NULL,
  reason_codes TEXT NOT NULL DEFAULT '[]',
  score_metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ticker, as_of)
);
CREATE TABLE IF NOT EXISTS fundamental_states (
  state_id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  as_of TEXT NOT NULL,
  sector TEXT NOT NULL,
  rank_in_sector INTEGER NOT NULL,
  rank_global INTEGER NOT NULL,
  composite_fundamental_score REAL NOT NULL,
  confidence REAL NOT NULL,
  score_delta_30d REAL NOT NULL,
  rating_label TEXT NOT NULL,
  valuation_label TEXT NOT NULL,
  direction_label TEXT NOT NULL,
  regime_label TEXT NOT NULL,
  top_strengths TEXT NOT NULL DEFAULT '[]',
  top_weaknesses TEXT NOT NULL DEFAULT '[]',
  state_metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ticker, as_of)
);
CREATE TABLE IF NOT EXISTS macro_regime_states (
  state_id TEXT PRIMARY KEY,
  as_of TEXT NOT NULL,
  window TEXT NOT NULL,
  regime_label TEXT NOT NULL,
  bias_label TEXT NOT NULL,
  risk_posture TEXT NOT NULL,
  conviction REAL NOT NULL,
  exposure_multiplier REAL NOT NULL,
  max_gross_exposure REAL NOT NULL,
  long_threshold REAL NOT NULL,
  short_threshold REAL NOT NULL,
  summary TEXT NOT NULL,
  supporting_signals TEXT NOT NULL DEFAULT '[]',
  risk_flags TEXT NOT NULL DEFAULT '[]',
  state_metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (window, as_of)
);
CREATE TABLE IF NOT EXISTS trade_setup_states (
  setup_id TEXT PRIMARY KEY,
  as_of TEXT NOT NULL,
  window TEXT NOT NULL,
  ticker TEXT NOT NULL,
  company_name TEXT NOT NULL,
  sector TEXT NOT NULL,
  action TEXT NOT NULL,
  setup_label TEXT NOT NULL,
  conviction REAL NOT NULL,
  position_size_pct REAL NOT NULL,
  timeframe TEXT NOT NULL,
  current_price REAL,
  entry_low REAL,
  entry_high REAL,
  entry_bias TEXT,
  stop_loss REAL,
  take_profit REAL,
  macro_regime_label TEXT,
  macro_bias_label TEXT,
  macro_exposure_multiplier REAL,
  summary TEXT NOT NULL,
  thesis TEXT NOT NULL DEFAULT '[]',
  risk_flags TEXT NOT NULL DEFAULT '[]',
  evidence_positive TEXT NOT NULL DEFAULT '[]',
  evidence_negative TEXT NOT NULL DEFAULT '[]',
  score_metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ticker, as_of, window)
);
CREATE TABLE IF NOT EXISTS llm_selection_reviews (
  review_id TEXT PRIMARY KEY,
  as_of TEXT NOT NULL,
  window TEXT,
  ticker TEXT NOT NULL,
  company_name TEXT,
  sector TEXT,
  action TEXT NOT NULL,
  confidence REAL,
  selected INTEGER NOT NULL DEFAULT 0,
  deterministic_action TEXT,
  deterministic_conviction REAL,
  disagreement_with_deterministic TEXT,
  reviewer TEXT,
  provider TEXT,
  model TEXT,
  mode TEXT,
  status TEXT,
  prompt_version TEXT,
  rationale TEXT,
  supporting_factors TEXT NOT NULL DEFAULT '[]',
  concerns TEXT NOT NULL DEFAULT '[]',
  missing_data TEXT NOT NULL DEFAULT '[]',
  evidence_alignment TEXT,
  risk_assessment TEXT,
  confidence_reason TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (as_of, ticker)
);
CREATE TABLE IF NOT EXISTS final_selection_candidates (
  candidate_id TEXT PRIMARY KEY,
  as_of TEXT NOT NULL,
  window TEXT NOT NULL,
  ticker TEXT NOT NULL,
  company_name TEXT,
  sector TEXT,
  deterministic_action TEXT,
  deterministic_conviction REAL,
  llm_action TEXT,
  llm_confidence REAL,
  agreement TEXT,
  final_action TEXT NOT NULL,
  final_conviction REAL,
  required_final_conviction REAL,
  final_conviction_gap REAL,
  execution_allowed INTEGER NOT NULL DEFAULT 0,
  position_size_pct REAL,
  current_price REAL,
  stop_loss REAL,
  take_profit REAL,
  reason_codes TEXT NOT NULL DEFAULT '[]',
  policy_gates TEXT NOT NULL DEFAULT '[]',
  score_components TEXT NOT NULL DEFAULT '{}',
  selection_report_json TEXT NOT NULL DEFAULT '{}',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (as_of, window, ticker)
);
CREATE TABLE IF NOT EXISTS trading_selection_passes (
  pass_id TEXT PRIMARY KEY,
  as_of TEXT NOT NULL,
  window TEXT NOT NULL,
  ticker TEXT NOT NULL,
  company_name TEXT,
  sector TEXT,
  final_action TEXT NOT NULL,
  side TEXT,
  final_conviction REAL,
  position_size_pct REAL,
  current_price REAL,
  stop_loss REAL,
  take_profit REAL,
  estimated_notional_usd REAL,
  report_status TEXT,
  final_reason TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (as_of, window, ticker, final_action)
);
CREATE TABLE IF NOT EXISTS risk_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  as_of TEXT NOT NULL,
  status TEXT NOT NULL,
  equity REAL,
  buying_power REAL,
  gross_exposure_pct REAL,
  open_orders INTEGER,
  position_count INTEGER,
  hard_blocks TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (as_of)
);
CREATE TABLE IF NOT EXISTS position_monitor_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  as_of TEXT NOT NULL,
  status TEXT,
  risk_status TEXT,
  position_count INTEGER,
  open_order_count INTEGER,
  review_count INTEGER,
  close_candidate_count INTEGER,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (as_of)
);
CREATE TABLE IF NOT EXISTS execution_intents (
  intent_id TEXT PRIMARY KEY,
  as_of TEXT NOT NULL,
  ticker TEXT,
  action TEXT,
  side TEXT,
  allowed INTEGER NOT NULL DEFAULT 0,
  execution_allowed INTEGER NOT NULL DEFAULT 0,
  broker_ready INTEGER NOT NULL DEFAULT 0,
  dry_run INTEGER NOT NULL DEFAULT 1,
  estimated_notional_usd REAL,
  estimated_quantity REAL,
  current_price REAL,
  blocked_reason TEXT,
  risk_allowed INTEGER,
  risk_blocked_reason TEXT,
  order_json TEXT NOT NULL DEFAULT '{}',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (as_of, ticker, action)
);
CREATE TABLE IF NOT EXISTS agency_cycle_states (
  cycle_id TEXT PRIMARY KEY,
  as_of TEXT NOT NULL,
  mode TEXT,
  status TEXT,
  baseline_ready INTEGER NOT NULL DEFAULT 0,
  data_progress_pct REAL,
  current_worker_key TEXT,
  can_use_for_decisions INTEGER NOT NULL DEFAULT 0,
  can_preview_orders INTEGER NOT NULL DEFAULT 0,
  can_submit_orders INTEGER NOT NULL DEFAULT 0,
  worker_count INTEGER,
  executable_count INTEGER,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (as_of)
);
`;

const POSTGRES_FUNDAMENTALS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS coverage_universe (
  ticker TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  cik TEXT,
  exchange TEXT,
  country TEXT DEFAULT 'US',
  sector TEXT NOT NULL,
  industry TEXT NOT NULL,
  market_cap_bucket TEXT,
  benchmark_group TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS filing_events (
  filing_id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  cik TEXT,
  form_type TEXT NOT NULL,
  filing_date DATE NOT NULL,
  accepted_at TIMESTAMPTZ,
  accession_no TEXT,
  period_end DATE,
  source_url TEXT NOT NULL,
  is_restated BOOLEAN NOT NULL DEFAULT FALSE,
  contains_xbrl BOOLEAN NOT NULL DEFAULT FALSE,
  filing_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticker, accession_no)
);
CREATE TABLE IF NOT EXISTS financial_periods (
  period_id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  fiscal_year INTEGER NOT NULL,
  fiscal_quarter INTEGER,
  period_type TEXT NOT NULL,
  period_start DATE,
  period_end DATE NOT NULL,
  filing_id TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  is_latest BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS financial_facts (
  fact_id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  taxonomy TEXT NOT NULL,
  concept TEXT NOT NULL,
  canonical_field TEXT NOT NULL,
  value NUMERIC(24,6),
  unit TEXT,
  source_form TEXT,
  as_reported_label TEXT,
  normalization_notes JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS market_reference (
  reference_id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  as_of TIMESTAMPTZ NOT NULL,
  close_price NUMERIC(18,6),
  market_cap NUMERIC(22,2),
  enterprise_value NUMERIC(22,2),
  shares_outstanding NUMERIC(22,2),
  beta NUMERIC(10,4),
  market_reference_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticker, as_of)
);
CREATE TABLE IF NOT EXISTS fundamental_features (
  feature_id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  as_of TIMESTAMPTZ NOT NULL,
  window_basis TEXT NOT NULL,
  revenue_growth_yoy NUMERIC(10,6),
  eps_growth_yoy NUMERIC(10,6),
  fcf_growth_yoy NUMERIC(10,6),
  gross_margin NUMERIC(10,6),
  operating_margin NUMERIC(10,6),
  net_margin NUMERIC(10,6),
  roe NUMERIC(10,6),
  roic NUMERIC(10,6),
  debt_to_equity NUMERIC(10,6),
  net_debt_to_ebitda NUMERIC(10,6),
  current_ratio NUMERIC(10,6),
  interest_coverage NUMERIC(10,6),
  fcf_margin NUMERIC(10,6),
  fcf_conversion NUMERIC(10,6),
  asset_turnover NUMERIC(10,6),
  margin_stability NUMERIC(10,6),
  revenue_consistency NUMERIC(10,6),
  pe_ttm NUMERIC(10,6),
  ev_to_ebitda_ttm NUMERIC(10,6),
  price_to_sales_ttm NUMERIC(10,6),
  peg NUMERIC(10,6),
  fcf_yield NUMERIC(10,6),
  feature_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticker, as_of, window_basis)
);
CREATE TABLE IF NOT EXISTS fundamental_scores (
  score_id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  as_of TIMESTAMPTZ NOT NULL,
  sector TEXT NOT NULL,
  quality_score NUMERIC(10,6) NOT NULL,
  growth_score NUMERIC(10,6) NOT NULL,
  valuation_score NUMERIC(10,6) NOT NULL,
  balance_sheet_score NUMERIC(10,6) NOT NULL,
  efficiency_score NUMERIC(10,6) NOT NULL,
  earnings_stability_score NUMERIC(10,6) NOT NULL,
  sector_score NUMERIC(10,6) NOT NULL,
  reporting_confidence_score NUMERIC(10,6) NOT NULL,
  data_freshness_score NUMERIC(10,6) NOT NULL,
  peer_comparability_score NUMERIC(10,6) NOT NULL,
  rule_confidence NUMERIC(10,6) NOT NULL,
  llm_confidence NUMERIC(10,6) NOT NULL,
  anomaly_penalty NUMERIC(10,6) NOT NULL,
  final_confidence NUMERIC(10,6) NOT NULL,
  composite_fundamental_score NUMERIC(10,6) NOT NULL,
  rating_label TEXT NOT NULL,
  valuation_label TEXT NOT NULL,
  direction_label TEXT NOT NULL,
  regime_label TEXT NOT NULL,
  reason_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  score_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticker, as_of)
);
CREATE TABLE IF NOT EXISTS fundamental_states (
  state_id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  as_of TIMESTAMPTZ NOT NULL,
  sector TEXT NOT NULL,
  rank_in_sector INTEGER NOT NULL,
  rank_global INTEGER NOT NULL,
  composite_fundamental_score NUMERIC(10,6) NOT NULL,
  confidence NUMERIC(10,6) NOT NULL,
  score_delta_30d NUMERIC(10,6) NOT NULL,
  rating_label TEXT NOT NULL,
  valuation_label TEXT NOT NULL,
  direction_label TEXT NOT NULL,
  regime_label TEXT NOT NULL,
  top_strengths TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  top_weaknesses TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  state_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticker, as_of)
);
CREATE TABLE IF NOT EXISTS macro_regime_states (
  state_id TEXT PRIMARY KEY,
  as_of TIMESTAMPTZ NOT NULL,
  window TEXT NOT NULL,
  regime_label TEXT NOT NULL,
  bias_label TEXT NOT NULL,
  risk_posture TEXT NOT NULL,
  conviction NUMERIC(10,6) NOT NULL,
  exposure_multiplier NUMERIC(10,6) NOT NULL,
  max_gross_exposure NUMERIC(10,6) NOT NULL,
  long_threshold NUMERIC(10,6) NOT NULL,
  short_threshold NUMERIC(10,6) NOT NULL,
  summary TEXT NOT NULL,
  supporting_signals TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  risk_flags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  state_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (window, as_of)
);
CREATE TABLE IF NOT EXISTS trade_setup_states (
  setup_id TEXT PRIMARY KEY,
  as_of TIMESTAMPTZ NOT NULL,
  window TEXT NOT NULL,
  ticker TEXT NOT NULL,
  company_name TEXT NOT NULL,
  sector TEXT NOT NULL,
  action TEXT NOT NULL,
  setup_label TEXT NOT NULL,
  conviction NUMERIC(10,6) NOT NULL,
  position_size_pct NUMERIC(10,6) NOT NULL,
  timeframe TEXT NOT NULL,
  current_price NUMERIC(18,6),
  entry_low NUMERIC(18,6),
  entry_high NUMERIC(18,6),
  entry_bias TEXT,
  stop_loss NUMERIC(18,6),
  take_profit NUMERIC(18,6),
  macro_regime_label TEXT,
  macro_bias_label TEXT,
  macro_exposure_multiplier NUMERIC(10,6),
  summary TEXT NOT NULL,
  thesis TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  risk_flags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  evidence_positive TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  evidence_negative TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  score_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticker, as_of, window)
);
CREATE TABLE IF NOT EXISTS llm_selection_reviews (
  review_id TEXT PRIMARY KEY,
  as_of TIMESTAMPTZ NOT NULL,
  window TEXT,
  ticker TEXT NOT NULL,
  company_name TEXT,
  sector TEXT,
  action TEXT NOT NULL,
  confidence NUMERIC(10,6),
  selected BOOLEAN NOT NULL DEFAULT FALSE,
  deterministic_action TEXT,
  deterministic_conviction NUMERIC(10,6),
  disagreement_with_deterministic TEXT,
  reviewer TEXT,
  provider TEXT,
  model TEXT,
  mode TEXT,
  status TEXT,
  prompt_version TEXT,
  rationale TEXT,
  supporting_factors TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  concerns TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  missing_data TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  evidence_alignment TEXT,
  risk_assessment TEXT,
  confidence_reason TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (as_of, ticker)
);
CREATE TABLE IF NOT EXISTS final_selection_candidates (
  candidate_id TEXT PRIMARY KEY,
  as_of TIMESTAMPTZ NOT NULL,
  window TEXT NOT NULL,
  ticker TEXT NOT NULL,
  company_name TEXT,
  sector TEXT,
  deterministic_action TEXT,
  deterministic_conviction NUMERIC(10,6),
  llm_action TEXT,
  llm_confidence NUMERIC(10,6),
  agreement TEXT,
  final_action TEXT NOT NULL,
  final_conviction NUMERIC(10,6),
  required_final_conviction NUMERIC(10,6),
  final_conviction_gap NUMERIC(10,6),
  execution_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  position_size_pct NUMERIC(10,6),
  current_price NUMERIC(18,6),
  stop_loss NUMERIC(18,6),
  take_profit NUMERIC(18,6),
  reason_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  policy_gates JSONB NOT NULL DEFAULT '[]'::JSONB,
  score_components JSONB NOT NULL DEFAULT '{}'::JSONB,
  selection_report_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  payload_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (as_of, window, ticker)
);
CREATE TABLE IF NOT EXISTS trading_selection_passes (
  pass_id TEXT PRIMARY KEY,
  as_of TIMESTAMPTZ NOT NULL,
  window TEXT NOT NULL,
  ticker TEXT NOT NULL,
  company_name TEXT,
  sector TEXT,
  final_action TEXT NOT NULL,
  side TEXT,
  final_conviction NUMERIC(10,6),
  position_size_pct NUMERIC(10,6),
  current_price NUMERIC(18,6),
  stop_loss NUMERIC(18,6),
  take_profit NUMERIC(18,6),
  estimated_notional_usd NUMERIC(18,2),
  report_status TEXT,
  final_reason TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (as_of, window, ticker, final_action)
);
CREATE TABLE IF NOT EXISTS risk_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  as_of TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  equity NUMERIC(18,2),
  buying_power NUMERIC(18,2),
  gross_exposure_pct NUMERIC(10,6),
  open_orders INTEGER,
  position_count INTEGER,
  hard_blocks TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  payload_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (as_of)
);
CREATE TABLE IF NOT EXISTS position_monitor_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  as_of TIMESTAMPTZ NOT NULL,
  status TEXT,
  risk_status TEXT,
  position_count INTEGER,
  open_order_count INTEGER,
  review_count INTEGER,
  close_candidate_count INTEGER,
  payload_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (as_of)
);
CREATE TABLE IF NOT EXISTS execution_intents (
  intent_id TEXT PRIMARY KEY,
  as_of TIMESTAMPTZ NOT NULL,
  ticker TEXT,
  action TEXT,
  side TEXT,
  allowed BOOLEAN NOT NULL DEFAULT FALSE,
  execution_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  broker_ready BOOLEAN NOT NULL DEFAULT FALSE,
  dry_run BOOLEAN NOT NULL DEFAULT TRUE,
  estimated_notional_usd NUMERIC(18,2),
  estimated_quantity NUMERIC(18,6),
  current_price NUMERIC(18,6),
  blocked_reason TEXT,
  risk_allowed BOOLEAN,
  risk_blocked_reason TEXT,
  order_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  payload_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (as_of, ticker, action)
);
CREATE TABLE IF NOT EXISTS agency_cycle_states (
  cycle_id TEXT PRIMARY KEY,
  as_of TIMESTAMPTZ NOT NULL,
  mode TEXT,
  status TEXT,
  baseline_ready BOOLEAN NOT NULL DEFAULT FALSE,
  data_progress_pct NUMERIC(10,6),
  current_worker_key TEXT,
  can_use_for_decisions BOOLEAN NOT NULL DEFAULT FALSE,
  can_preview_orders BOOLEAN NOT NULL DEFAULT FALSE,
  can_submit_orders BOOLEAN NOT NULL DEFAULT FALSE,
  worker_count INTEGER,
  executable_count INTEGER,
  payload_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (as_of)
);
`;

const FUNDAMENTAL_ROW_SELECTS = {
  coverageUniverse: "SELECT * FROM coverage_universe ORDER BY ticker ASC",
  filingEvents: "SELECT * FROM filing_events ORDER BY filing_date DESC, ticker ASC",
  financialPeriods: "SELECT * FROM financial_periods ORDER BY ticker ASC, period_end DESC",
  financialFacts: "SELECT * FROM financial_facts ORDER BY ticker ASC, canonical_field ASC",
  marketReference: "SELECT * FROM market_reference ORDER BY as_of DESC, ticker ASC",
  fundamentalFeatures: "SELECT * FROM fundamental_features ORDER BY as_of DESC, ticker ASC",
  fundamentalScores: "SELECT * FROM fundamental_scores ORDER BY as_of DESC, composite_fundamental_score DESC",
  fundamentalStates: "SELECT * FROM fundamental_states ORDER BY as_of DESC, sector ASC, rank_in_sector ASC"
};

const AGENT_ROW_SELECTS = {
  macroRegimeStates: "SELECT * FROM macro_regime_states ORDER BY as_of DESC, window ASC",
  tradeSetupStates: "SELECT * FROM trade_setup_states ORDER BY as_of DESC, conviction DESC, ticker ASC",
  llmSelectionReviews: "SELECT * FROM llm_selection_reviews ORDER BY as_of DESC, confidence DESC, ticker ASC",
  finalSelectionCandidates: "SELECT * FROM final_selection_candidates ORDER BY as_of DESC, execution_allowed DESC, final_conviction DESC, ticker ASC",
  tradingSelectionPasses: "SELECT * FROM trading_selection_passes ORDER BY as_of DESC, final_conviction DESC, ticker ASC",
  riskSnapshots: "SELECT * FROM risk_snapshots ORDER BY as_of DESC",
  positionMonitorSnapshots: "SELECT * FROM position_monitor_snapshots ORDER BY as_of DESC",
  executionIntents: "SELECT * FROM execution_intents ORDER BY as_of DESC",
  agencyCycleStates: "SELECT * FROM agency_cycle_states ORDER BY as_of DESC"
};

function reviveFundamentals(snapshot) {
  if (!snapshot?.asOf) {
    return createEmptyFundamentalsState();
  }
  const liveLeaderboard = (snapshot.leaderboard || []).filter(
    (item) => item?.data_source !== "bootstrap_placeholder" && item?.form_type !== "BOOTSTRAP"
  ).map((item) => ({
    ...item,
    initial_screen: item.initial_screen
      ? {
          ...item.initial_screen,
          provisional: item.data_source === "live_sec_filing" ? false : Boolean(item.initial_screen.provisional)
        }
      : item.initial_screen,
    quality_flags: item.quality_flags
      ? {
          ...item.quality_flags,
          anomaly_flags: (item.quality_flags.anomaly_flags || []).filter(
            (flag) => !["bootstrap_placeholder", "awaiting_sec_refresh"].includes(flag)
          )
        }
      : item.quality_flags
  }));
  const removedRows = liveLeaderboard.length !== (snapshot.leaderboard || []).length;

  return {
    ...snapshot,
    leaderboard: liveLeaderboard,
    sectors: removedRows ? [] : snapshot.sectors || [],
    changes: removedRows ? [] : snapshot.changes || [],
    screener: buildInitialScreenerSnapshot(liveLeaderboard),
    byTicker: new Map(liveLeaderboard.map((item) => [item.ticker, item])),
    bySector: new Map((removedRows ? [] : snapshot.sectors || []).map((item) => [item.sector, item]))
  };
}

function scrubLegacyPlaceholderMetadata(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return /bootstrap/i.test(value) || value === "BOOTSTRAP" ? undefined : value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => scrubLegacyPlaceholderMetadata(item))
      .filter((item) => item !== undefined);
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/bootstrap/i.test(key))
        .map(([key, item]) => [key, scrubLegacyPlaceholderMetadata(item)])
        .filter(([, item]) => item !== undefined)
    );
  }
  return value;
}

function reviveFundamentalUniverse(snapshot) {
  const clean = scrubLegacyPlaceholderMetadata(snapshot);
  if (!clean?.companies?.length) {
    return clean;
  }
  return {
    ...clean,
    companies: clean.companies.map((company) => ({
      ...company,
      data_source: company.data_source || "universe_membership",
      initial_screen: company.initial_screen
        ? {
            ...company.initial_screen,
            provisional: false
          }
        : company.initial_screen
    }))
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

function parseTextArray(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== null && item !== undefined).map(String);
  }
  return parsePayload(value, []);
}

function latestTimestamp(current, candidate) {
  if (!candidate) {
    return current;
  }
  if (!current) {
    return candidate;
  }
  return new Date(candidate) > new Date(current) ? candidate : current;
}

function buildRuntimeFundamentals(store) {
  return {
    asOf: store.fundamentals.asOf,
    summary: store.fundamentals.summary,
    screener: store.fundamentals.screener,
    leaderboard: store.fundamentals.leaderboard,
    sectors: store.fundamentals.sectors,
    changes: store.fundamentals.changes
  };
}

function buildFundamentalWarehouseRows(store) {
  const warehouse = store.fundamentalWarehouse || createEmptyFundamentalPersistence();
  return {
    coverageUniverse: [...warehouse.coverageUniverse.values()],
    filingEvents: [...warehouse.filingEvents.values()],
    financialPeriods: [...warehouse.financialPeriods.values()],
    financialFacts: [...warehouse.financialFacts.values()],
    marketReference: [...warehouse.marketReference.values()],
    fundamentalFeatures: [...warehouse.fundamentalFeatures.values()],
    fundamentalScores: [...warehouse.fundamentalScores.values()],
    fundamentalStates: [...warehouse.fundamentalStates.values()]
  };
}

function finiteOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function boolInt(value) {
  return value ? 1 : 0;
}

function dbBool(value) {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

function cleanPayload(value, fallback = {}) {
  return scrubLegacyPlaceholderMetadata(value || fallback) || fallback;
}

function historyRows(store, key, limit = 500) {
  return (Array.isArray(store[key]) ? store[key] : []).slice(0, limit);
}

function snapshotStamp(snapshot) {
  return snapshot?.as_of || snapshot?.asOf || snapshot?.generated_at || snapshot?.at || new Date().toISOString();
}

function candidatePricePlan(candidate = {}) {
  const setup = candidate.setup_for_execution || candidate.setup || {};
  return {
    current_price: finiteOrNull(setup.current_price ?? candidate.selection_report?.trade_plan?.current_price),
    stop_loss: finiteOrNull(setup.stop_loss ?? candidate.selection_report?.trade_plan?.stop_loss),
    take_profit: finiteOrNull(setup.take_profit ?? candidate.selection_report?.trade_plan?.take_profit),
    estimated_notional_usd: finiteOrNull(candidate.selection_report?.trade_plan?.estimated_notional_usd)
  };
}

function buildLlmSelectionRows(store) {
  const rows = [];
  for (const snapshot of historyRows(store, "llmSelectionHistory")) {
    const asOf = snapshotStamp(snapshot);
    const recommendations = snapshot.recommendations || (snapshot.recommendation ? [snapshot.recommendation] : []);
    for (const recommendation of recommendations) {
      if (!recommendation?.ticker) {
        continue;
      }
      rows.push({
        review_id: `${asOf}:${recommendation.ticker}`,
        as_of: asOf,
        window: snapshot.window || null,
        ticker: recommendation.ticker,
        company_name: recommendation.company_name || null,
        sector: recommendation.sector || null,
        action: recommendation.action || "watch",
        confidence: finiteOrNull(recommendation.confidence),
        selected: Boolean(recommendation.selected),
        deterministic_action: recommendation.deterministic_action || null,
        deterministic_conviction: finiteOrNull(recommendation.deterministic_conviction),
        disagreement_with_deterministic: recommendation.disagreement_with_deterministic || null,
        reviewer: recommendation.reviewer || null,
        provider: snapshot.provider || null,
        model: snapshot.model || null,
        mode: snapshot.mode || null,
        status: snapshot.status || null,
        prompt_version: snapshot.prompt_version || null,
        rationale: recommendation.rationale || null,
        supporting_factors: recommendation.supporting_factors || [],
        concerns: recommendation.concerns || [],
        missing_data: recommendation.missing_data || [],
        evidence_alignment: recommendation.evidence_alignment || null,
        risk_assessment: recommendation.risk_assessment || null,
        confidence_reason: recommendation.confidence_reason || null,
        payload_json: cleanPayload({
          snapshot: {
            as_of: asOf,
            enabled: snapshot.enabled,
            configured: snapshot.configured,
            provider: snapshot.provider,
            model: snapshot.model,
            mode: snapshot.mode,
            status: snapshot.status,
            prompt_version: snapshot.prompt_version,
            algorithm: snapshot.algorithm
          },
          recommendation
        })
      });
    }
  }
  return rows;
}

function buildFinalSelectionRows(store) {
  const rows = [];
  for (const snapshot of historyRows(store, "finalSelectionHistory")) {
    const asOf = snapshotStamp(snapshot);
    const window = snapshot.window || "default";
    const candidates = snapshot.candidates || (snapshot.candidate ? [snapshot.candidate] : []);
    for (const candidate of candidates) {
      if (!candidate?.ticker) {
        continue;
      }
      const plan = candidatePricePlan(candidate);
      rows.push({
        candidate_id: `${asOf}:${window}:${candidate.ticker}`,
        as_of: asOf,
        window,
        ticker: candidate.ticker,
        company_name: candidate.company_name || null,
        sector: candidate.sector || null,
        deterministic_action: candidate.deterministic_action || null,
        deterministic_conviction: finiteOrNull(candidate.deterministic_conviction),
        llm_action: candidate.llm_action || null,
        llm_confidence: finiteOrNull(candidate.llm_confidence),
        agreement: candidate.agreement || null,
        final_action: candidate.final_action || "watch",
        final_conviction: finiteOrNull(candidate.final_conviction),
        required_final_conviction: finiteOrNull(candidate.required_final_conviction),
        final_conviction_gap: finiteOrNull(candidate.final_conviction_gap),
        execution_allowed: Boolean(candidate.execution_allowed),
        position_size_pct: finiteOrNull(candidate.position_size_pct),
        current_price: plan.current_price,
        stop_loss: plan.stop_loss,
        take_profit: plan.take_profit,
        reason_codes: candidate.reason_codes || [],
        policy_gates: candidate.policy_gates || [],
        score_components: candidate.final_score_components || {},
        selection_report_json: candidate.selection_report || {},
        payload_json: cleanPayload({
          snapshot: {
            as_of: asOf,
            window,
            counts: snapshot.counts || {},
            algorithm: snapshot.algorithm || null,
            llm_agent: snapshot.llm_agent || null,
            portfolio_policy: snapshot.portfolio_policy || null
          },
          candidate
        })
      });
    }
  }
  return rows;
}

function buildTradingSelectionPassRows(store) {
  const rowsById = new Map();
  for (const snapshot of historyRows(store, "finalSelectionHistory")) {
    const asOf = snapshotStamp(snapshot);
    const window = snapshot.window || "default";
    const candidates = snapshot.candidates || (snapshot.candidate ? [snapshot.candidate] : []);
    for (const candidate of candidates) {
      if (!candidate?.ticker || !candidate.execution_allowed) {
        continue;
      }
      const plan = candidatePricePlan(candidate);
      const reportPlan = candidate.selection_report?.trade_plan || {};
      const row = {
        pass_id: `${asOf}:${window}:${candidate.ticker}:${candidate.final_action}`,
        as_of: asOf,
        window,
        ticker: candidate.ticker,
        company_name: candidate.company_name || null,
        sector: candidate.sector || null,
        final_action: candidate.final_action,
        side: reportPlan.side || (candidate.final_action === "long" ? "buy" : candidate.final_action === "short" ? "sell_short" : null),
        final_conviction: finiteOrNull(candidate.final_conviction),
        position_size_pct: finiteOrNull(candidate.position_size_pct),
        current_price: plan.current_price,
        stop_loss: plan.stop_loss,
        take_profit: plan.take_profit,
        estimated_notional_usd: plan.estimated_notional_usd,
        report_status: candidate.selection_report?.status || null,
        final_reason: candidate.final_reason || null,
        payload_json: cleanPayload({
          snapshot: {
            as_of: asOf,
            window,
            counts: snapshot.counts || {}
          },
          candidate
        })
      };
      rowsById.set(row.pass_id, row);
    }
  }
  for (const pass of historyRows(store, "tradingSelectionPassHistory")) {
    const candidate = pass.candidate || {};
    if (!candidate.ticker) {
      continue;
    }
    const asOf = pass.as_of || snapshotStamp(candidate);
    const window = pass.window || "default";
    const plan = candidatePricePlan(candidate);
    const row = {
      pass_id: pass.id || `${asOf}:${window}:${candidate.ticker}:${candidate.final_action}`,
      as_of: asOf,
      window,
      ticker: candidate.ticker,
      company_name: candidate.company_name || null,
      sector: candidate.sector || null,
      final_action: candidate.final_action || "long",
      side: candidate.selection_report?.trade_plan?.side || null,
      final_conviction: finiteOrNull(candidate.final_conviction),
      position_size_pct: finiteOrNull(candidate.position_size_pct),
      current_price: plan.current_price,
      stop_loss: plan.stop_loss,
      take_profit: plan.take_profit,
      estimated_notional_usd: plan.estimated_notional_usd,
      report_status: candidate.selection_report?.status || null,
      final_reason: candidate.final_reason || null,
      payload_json: cleanPayload(pass)
    };
    rowsById.set(row.pass_id, row);
  }
  return [...rowsById.values()];
}

function buildRiskSnapshotRows(store) {
  return historyRows(store, "riskSnapshotHistory").map((snapshot) => {
    const asOf = snapshotStamp(snapshot);
    return {
      snapshot_id: `risk:${asOf}`,
      as_of: asOf,
      status: snapshot.status || "unknown",
      equity: finiteOrNull(snapshot.equity),
      buying_power: finiteOrNull(snapshot.buying_power),
      gross_exposure_pct: finiteOrNull(snapshot.gross_exposure_pct),
      open_orders: integerOrNull(snapshot.open_orders),
      position_count: Array.isArray(snapshot.positions) ? snapshot.positions.length : integerOrNull(snapshot.position_count),
      hard_blocks: snapshot.hard_blocks || [],
      payload_json: cleanPayload(snapshot)
    };
  });
}

function buildPositionMonitorRows(store) {
  return historyRows(store, "positionMonitorHistory").map((snapshot) => {
    const asOf = snapshotStamp(snapshot);
    return {
      snapshot_id: `position:${asOf}`,
      as_of: asOf,
      status: snapshot.status || null,
      risk_status: snapshot.risk_status || null,
      position_count: integerOrNull(snapshot.position_count),
      open_order_count: integerOrNull(snapshot.open_order_count),
      review_count: integerOrNull(snapshot.review_count),
      close_candidate_count: integerOrNull(snapshot.close_candidate_count),
      payload_json: cleanPayload(snapshot)
    };
  });
}

function buildExecutionIntentRows(store) {
  return historyRows(store, "executionIntentHistory").map((row) => {
    const preview = row.preview || row;
    const intent = preview.intent || preview.preview?.intent || {};
    const risk = preview.risk || preview.preview?.risk || null;
    const asOf = row.as_of || snapshotStamp(preview);
    return {
      intent_id: row.id || `${asOf}:${intent.ticker || row.ticker || "unknown"}:${intent.action || row.action || "unknown"}`,
      as_of: asOf,
      ticker: intent.ticker || row.ticker || null,
      action: intent.action || row.action || null,
      side: intent.side || null,
      allowed: Boolean(intent.allowed),
      execution_allowed: Boolean(preview.execution_allowed ?? preview.submitted),
      broker_ready: Boolean(preview.broker_ready || preview.broker?.ready_for_order_submission),
      dry_run: preview.dry_run !== false,
      estimated_notional_usd: finiteOrNull(intent.estimated_notional_usd),
      estimated_quantity: finiteOrNull(intent.estimated_quantity),
      current_price: finiteOrNull(intent.current_price),
      blocked_reason: intent.blocked_reason || null,
      risk_allowed: risk ? Boolean(risk.allowed) : null,
      risk_blocked_reason: risk?.blocked_reason || null,
      order_json: intent.order || preview.order || {},
      payload_json: cleanPayload(row)
    };
  });
}

function buildAgencyCycleRows(store) {
  return historyRows(store, "agencyCycleHistory").map((snapshot) => {
    const asOf = snapshotStamp(snapshot);
    return {
      cycle_id: `agency:${asOf}`,
      as_of: asOf,
      mode: snapshot.mode || null,
      status: snapshot.status || null,
      baseline_ready: Boolean(snapshot.baseline_ready),
      data_progress_pct: finiteOrNull(snapshot.data_progress?.pct ?? snapshot.data_progress_pct),
      current_worker_key: snapshot.current_worker_key || null,
      can_use_for_decisions: Boolean(snapshot.can_use_for_decisions),
      can_preview_orders: Boolean(snapshot.can_preview_orders),
      can_submit_orders: Boolean(snapshot.can_submit_orders),
      worker_count: Array.isArray(snapshot.workers) ? snapshot.workers.length : integerOrNull(snapshot.worker_count),
      executable_count: integerOrNull(snapshot.final_selection?.counts?.executable ?? snapshot.counts?.executable),
      payload_json: cleanPayload(snapshot)
    };
  });
}

function buildAgentRows(store, config) {
  const macroSnapshot = buildMacroRegimeSnapshot(store, {
    window: config.defaultWindow || "1h"
  });
  const tradeSnapshot = buildTradeSetupsSnapshot(store, {
    window: config.defaultWindow || "1h",
    limit: 500,
    minConviction: 0,
    macroRegimeSnapshot: macroSnapshot
  });

  const macroRegimeStates = [
    {
      state_id: `${macroSnapshot.window}:${macroSnapshot.as_of}`,
      as_of: macroSnapshot.as_of,
      window: macroSnapshot.window,
      regime_label: macroSnapshot.regime_label,
      bias_label: macroSnapshot.bias_label,
      risk_posture: macroSnapshot.risk_posture,
      conviction: macroSnapshot.conviction,
      exposure_multiplier: macroSnapshot.exposure_multiplier,
      max_gross_exposure: macroSnapshot.max_gross_exposure,
      long_threshold: macroSnapshot.long_threshold,
      short_threshold: macroSnapshot.short_threshold,
      summary: macroSnapshot.summary,
      supporting_signals: macroSnapshot.supporting_signals || [],
      risk_flags: macroSnapshot.risk_flags || [],
      state_metadata: {
        score_components: macroSnapshot.score_components || {},
        breadth: macroSnapshot.breadth || {},
        event_balance: macroSnapshot.event_balance || {},
        dominant_sectors: macroSnapshot.dominant_sectors || [],
        recent_alerts: macroSnapshot.recent_alerts || []
      }
    }
  ];

  const tradeSetupStates = (tradeSnapshot.setups || []).map((setup) => ({
    setup_id: `${tradeSnapshot.window}:${setup.ticker}:${tradeSnapshot.as_of}`,
    as_of: tradeSnapshot.as_of,
    window: tradeSnapshot.window,
    ticker: setup.ticker,
    company_name: setup.company_name,
    sector: setup.sector,
    action: setup.action,
    setup_label: setup.setup_label,
    conviction: setup.conviction,
    position_size_pct: setup.position_size_pct,
    timeframe: setup.timeframe,
    current_price: setup.current_price,
    entry_low: setup.entry_zone?.low ?? null,
    entry_high: setup.entry_zone?.high ?? null,
    entry_bias: setup.entry_zone?.bias ?? null,
    stop_loss: setup.stop_loss,
    take_profit: setup.take_profit,
    macro_regime_label: setup.macro_regime?.regime_label || null,
    macro_bias_label: setup.macro_regime?.bias_label || null,
    macro_exposure_multiplier: setup.macro_regime?.exposure_multiplier ?? null,
    summary: setup.summary,
    thesis: setup.thesis || [],
    risk_flags: setup.risk_flags || [],
    evidence_positive: setup.evidence?.positive || [],
    evidence_negative: setup.evidence?.negative || [],
    score_metadata: {
      score_components: setup.score_components || {},
      runtime_reliability: setup.runtime_reliability || null,
      sentiment: setup.sentiment || null,
      fundamentals: setup.fundamentals || null,
      recent_documents: setup.recent_documents || [],
      recent_alerts: setup.recent_alerts || []
    }
  }));

  return {
    macroRegimeStates,
    tradeSetupStates,
    llmSelectionReviews: buildLlmSelectionRows(store),
    finalSelectionCandidates: buildFinalSelectionRows(store),
    tradingSelectionPasses: buildTradingSelectionPassRows(store),
    riskSnapshots: buildRiskSnapshotRows(store),
    positionMonitorSnapshots: buildPositionMonitorRows(store),
    executionIntents: buildExecutionIntentRows(store),
    agencyCycleStates: buildAgencyCycleRows(store)
  };
}

function reviveAgentRows(rows = {}) {
  return {
    macroRegimeHistory: (rows.macroRegimeStates || []).map((row) => ({
      ...row,
      conviction: Number(row.conviction),
      exposure_multiplier: Number(row.exposure_multiplier),
      max_gross_exposure: Number(row.max_gross_exposure),
      long_threshold: Number(row.long_threshold),
      short_threshold: Number(row.short_threshold),
      supporting_signals: parseTextArray(row.supporting_signals),
      risk_flags: parseTextArray(row.risk_flags),
      state_metadata: parsePayload(row.state_metadata, {})
    })),
    tradeSetupHistory: (rows.tradeSetupStates || []).map((row) => ({
      ...row,
      conviction: Number(row.conviction),
      position_size_pct: Number(row.position_size_pct),
      current_price: row.current_price === null || row.current_price === undefined ? null : Number(row.current_price),
      entry_low: row.entry_low === null || row.entry_low === undefined ? null : Number(row.entry_low),
      entry_high: row.entry_high === null || row.entry_high === undefined ? null : Number(row.entry_high),
      stop_loss: row.stop_loss === null || row.stop_loss === undefined ? null : Number(row.stop_loss),
      take_profit: row.take_profit === null || row.take_profit === undefined ? null : Number(row.take_profit),
      macro_exposure_multiplier:
        row.macro_exposure_multiplier === null || row.macro_exposure_multiplier === undefined
          ? null
          : Number(row.macro_exposure_multiplier),
      thesis: parseTextArray(row.thesis),
      risk_flags: parseTextArray(row.risk_flags),
      evidence_positive: parseTextArray(row.evidence_positive),
      evidence_negative: parseTextArray(row.evidence_negative),
      score_metadata: parsePayload(row.score_metadata, {})
    })),
    llmSelectionHistory: (rows.llmSelectionReviews || []).map((row) => ({
      ...parsePayload(row.payload_json, {}),
      as_of: row.as_of,
      recommendation: {
        ticker: row.ticker,
        company_name: row.company_name,
        sector: row.sector,
        action: row.action,
        confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
        selected: dbBool(row.selected),
        deterministic_action: row.deterministic_action,
        deterministic_conviction:
          row.deterministic_conviction === null || row.deterministic_conviction === undefined
            ? null
            : Number(row.deterministic_conviction),
        disagreement_with_deterministic: row.disagreement_with_deterministic,
        reviewer: row.reviewer,
        rationale: row.rationale,
        supporting_factors: parseTextArray(row.supporting_factors),
        concerns: parseTextArray(row.concerns),
        missing_data: parseTextArray(row.missing_data),
        evidence_alignment: row.evidence_alignment,
        risk_assessment: row.risk_assessment,
        confidence_reason: row.confidence_reason
      }
    })),
    finalSelectionHistory: (rows.finalSelectionCandidates || []).map((row) => ({
      as_of: row.as_of,
      window: row.window,
      candidate: {
        ...parsePayload(row.payload_json, {})?.candidate,
        ticker: row.ticker,
        company_name: row.company_name,
        sector: row.sector,
        deterministic_action: row.deterministic_action,
        deterministic_conviction:
          row.deterministic_conviction === null || row.deterministic_conviction === undefined
            ? null
            : Number(row.deterministic_conviction),
        llm_action: row.llm_action,
        llm_confidence: row.llm_confidence === null || row.llm_confidence === undefined ? null : Number(row.llm_confidence),
        agreement: row.agreement,
        final_action: row.final_action,
        final_conviction: row.final_conviction === null || row.final_conviction === undefined ? null : Number(row.final_conviction),
        required_final_conviction:
          row.required_final_conviction === null || row.required_final_conviction === undefined
            ? null
            : Number(row.required_final_conviction),
        final_conviction_gap:
          row.final_conviction_gap === null || row.final_conviction_gap === undefined ? null : Number(row.final_conviction_gap),
        execution_allowed: dbBool(row.execution_allowed),
        position_size_pct: row.position_size_pct === null || row.position_size_pct === undefined ? null : Number(row.position_size_pct),
        reason_codes: parseTextArray(row.reason_codes),
        policy_gates: parsePayload(row.policy_gates, []),
        final_score_components: parsePayload(row.score_components, {}),
        selection_report: parsePayload(row.selection_report_json, {})
      }
    })),
    tradingSelectionPassHistory: (rows.tradingSelectionPasses || []).map((row) => ({
      id: row.pass_id,
      as_of: row.as_of,
      window: row.window,
      candidate: parsePayload(row.payload_json, {})?.candidate || {
        ticker: row.ticker,
        company_name: row.company_name,
        sector: row.sector,
        final_action: row.final_action,
        final_conviction: row.final_conviction === null || row.final_conviction === undefined ? null : Number(row.final_conviction),
        position_size_pct: row.position_size_pct === null || row.position_size_pct === undefined ? null : Number(row.position_size_pct),
        execution_allowed: true
      }
    })),
    riskSnapshotHistory: (rows.riskSnapshots || []).map((row) => ({
      ...parsePayload(row.payload_json, {}),
      as_of: row.as_of,
      status: row.status,
      equity: row.equity === null || row.equity === undefined ? null : Number(row.equity),
      buying_power: row.buying_power === null || row.buying_power === undefined ? null : Number(row.buying_power),
      gross_exposure_pct:
        row.gross_exposure_pct === null || row.gross_exposure_pct === undefined ? null : Number(row.gross_exposure_pct),
      open_orders: row.open_orders === null || row.open_orders === undefined ? null : Number(row.open_orders),
      hard_blocks: parseTextArray(row.hard_blocks)
    })),
    positionMonitorHistory: (rows.positionMonitorSnapshots || []).map((row) => ({
      ...parsePayload(row.payload_json, {}),
      as_of: row.as_of,
      status: row.status,
      risk_status: row.risk_status,
      position_count: row.position_count === null || row.position_count === undefined ? null : Number(row.position_count),
      open_order_count: row.open_order_count === null || row.open_order_count === undefined ? null : Number(row.open_order_count),
      review_count: row.review_count === null || row.review_count === undefined ? null : Number(row.review_count),
      close_candidate_count:
        row.close_candidate_count === null || row.close_candidate_count === undefined ? null : Number(row.close_candidate_count)
    })),
    executionIntentHistory: (rows.executionIntents || []).map((row) => ({
      id: row.intent_id,
      as_of: row.as_of,
      ticker: row.ticker,
      action: row.action,
      preview: parsePayload(row.payload_json, {})?.preview || parsePayload(row.payload_json, {})
    })),
    agencyCycleHistory: (rows.agencyCycleStates || []).map((row) => ({
      ...parsePayload(row.payload_json, {}),
      as_of: row.as_of,
      mode: row.mode,
      status: row.status,
      baseline_ready: dbBool(row.baseline_ready),
      data_progress_pct: row.data_progress_pct === null || row.data_progress_pct === undefined ? null : Number(row.data_progress_pct),
      current_worker_key: row.current_worker_key,
      can_use_for_decisions: dbBool(row.can_use_for_decisions),
      can_preview_orders: dbBool(row.can_preview_orders),
      can_submit_orders: dbBool(row.can_submit_orders)
    }))
  };
}

function reviveFundamentalWarehouseFromRows(rows = {}) {
  const warehouse = createEmptyFundamentalPersistence();

  for (const row of rows.coverageUniverse || []) {
    warehouse.coverageUniverse.set(row.ticker, {
      ...row,
      is_active: Boolean(row.is_active),
      metadata: parsePayload(row.metadata, {})
    });
  }
  for (const row of rows.filingEvents || []) {
    warehouse.filingEvents.set(`${row.ticker}:${row.accession_no}`, {
      ...row,
      is_restated: Boolean(row.is_restated),
      contains_xbrl: Boolean(row.contains_xbrl),
      filing_metadata: parsePayload(row.filing_metadata, {})
    });
  }
  for (const row of rows.financialPeriods || []) {
    warehouse.financialPeriods.set(row.period_id, {
      ...row,
      fiscal_year: Number(row.fiscal_year),
      fiscal_quarter: row.fiscal_quarter === null || row.fiscal_quarter === undefined ? null : Number(row.fiscal_quarter),
      is_latest: Boolean(row.is_latest)
    });
  }
  for (const row of rows.financialFacts || []) {
    warehouse.financialFacts.set(row.fact_id, {
      ...row,
      value: row.value === null || row.value === undefined ? null : Number(row.value),
      normalization_notes: parsePayload(row.normalization_notes, {})
    });
  }
  for (const row of rows.marketReference || []) {
    warehouse.marketReference.set(row.reference_id, {
      ...row,
      close_price: row.close_price === null || row.close_price === undefined ? null : Number(row.close_price),
      market_cap: row.market_cap === null || row.market_cap === undefined ? null : Number(row.market_cap),
      enterprise_value: row.enterprise_value === null || row.enterprise_value === undefined ? null : Number(row.enterprise_value),
      shares_outstanding: row.shares_outstanding === null || row.shares_outstanding === undefined ? null : Number(row.shares_outstanding),
      beta: row.beta === null || row.beta === undefined ? null : Number(row.beta),
      market_reference_metadata: parsePayload(row.market_reference_metadata, {})
    });
    warehouse.lastMaterializedAt = latestTimestamp(warehouse.lastMaterializedAt, row.as_of);
  }
  for (const row of rows.fundamentalFeatures || []) {
    warehouse.fundamentalFeatures.set(row.feature_id, {
      ...row,
      feature_metadata: parsePayload(row.feature_metadata, {})
    });
    warehouse.lastMaterializedAt = latestTimestamp(warehouse.lastMaterializedAt, row.as_of);
  }
  for (const row of rows.fundamentalScores || []) {
    warehouse.fundamentalScores.set(row.score_id, {
      ...row,
      reason_codes: parseTextArray(row.reason_codes),
      score_metadata: parsePayload(row.score_metadata, {})
    });
    warehouse.lastMaterializedAt = latestTimestamp(warehouse.lastMaterializedAt, row.as_of);
  }
  for (const row of rows.fundamentalStates || []) {
    warehouse.fundamentalStates.set(row.state_id, {
      ...row,
      top_strengths: parseTextArray(row.top_strengths),
      top_weaknesses: parseTextArray(row.top_weaknesses),
      state_metadata: parsePayload(row.state_metadata, {})
    });
    warehouse.lastMaterializedAt = latestTimestamp(warehouse.lastMaterializedAt, row.as_of);
  }

  return warehouse;
}

function hydrateStoreFromRows(store, rows) {
  store.rawDocuments = rows.rawDocuments.map((row) => parsePayload(row.payload_json, null)).filter(Boolean);
  store.normalizedDocuments = rows.normalizedDocuments.map((row) => parsePayload(row.payload_json, null)).filter(Boolean);
  store.documentEntities = rows.documentEntities.map((row) => parsePayload(row.payload_json, null)).filter(Boolean);
  store.documentScores = rows.documentScores.map((row) => parsePayload(row.payload_json, null)).filter(Boolean);
  const evidenceItems = store.documentScores.map((score) => score.evidence_quality).filter(Boolean);
  store.evidenceQuality = {
    items: evidenceItems.slice(0, 1000),
    summary: summarizeEvidenceQuality(evidenceItems)
  };
  store.sentimentStates = rows.sentimentStates.map((row) => parsePayload(row.payload_json, null)).filter(Boolean);
  store.sourceStats = new Map(
    rows.sourceStats
      .map((row) => [row.source_name, scrubLegacyPlaceholderMetadata(parsePayload(row.payload_json, null))])
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
  const persistedHealth = scrubLegacyPlaceholderMetadata(runtimeMap.get("health"));
  const persistedFundamentals = runtimeMap.get("fundamentals");
  const persistedFundamentalUniverse = reviveFundamentalUniverse(runtimeMap.get("fundamentalUniverse"));
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
  if (persistedFundamentalUniverse?.companies?.length) {
    store.fundamentalUniverse = persistedFundamentalUniverse;
  }

  const persistedEarnings = runtimeMap.get("earningsCalendar");
  if (persistedEarnings && Array.isArray(persistedEarnings)) {
    store.earningsCalendar = new Map(persistedEarnings);
  }

  const persistedApprovals = runtimeMap.get("pendingApprovals");
  if (persistedApprovals && Array.isArray(persistedApprovals)) {
    store.pendingApprovals = new Map(persistedApprovals);
  }

  const persistedPositions = runtimeMap.get("positions");
  if (persistedPositions && Array.isArray(persistedPositions)) {
    store.positions = new Map(persistedPositions);
  }

  const persistedOrders = runtimeMap.get("orders");
  if (persistedOrders && Array.isArray(persistedOrders)) {
    store.orders = new Map(persistedOrders);
  }

  const persistedExecutionState = runtimeMap.get("executionState");
  if (persistedExecutionState) {
    store.executionState = { ...store.executionState, ...persistedExecutionState };
  }

  const persistedExecutionLog = runtimeMap.get("executionLog");
  if (persistedExecutionLog && Array.isArray(persistedExecutionLog)) {
    store.executionLog = persistedExecutionLog;
  }

  store.fundamentalWarehouse = reviveFundamentalWarehouseFromRows(rows.fundamentals);
  const revivedAgents = reviveAgentRows(rows.agents);
  store.macroRegimeHistory = revivedAgents.macroRegimeHistory;
  store.tradeSetupHistory = revivedAgents.tradeSetupHistory;
  store.llmSelectionHistory = revivedAgents.llmSelectionHistory;
  store.finalSelectionHistory = revivedAgents.finalSelectionHistory;
  store.tradingSelectionPassHistory = revivedAgents.tradingSelectionPassHistory;
  store.riskSnapshotHistory = revivedAgents.riskSnapshotHistory;
  store.positionMonitorHistory = revivedAgents.positionMonitorHistory;
  store.executionIntentHistory = revivedAgents.executionIntentHistory;
  store.agencyCycleHistory = revivedAgents.agencyCycleHistory;
}

function loadSqliteFundamentalRows(db) {
  return {
    coverageUniverse: db.prepare(FUNDAMENTAL_ROW_SELECTS.coverageUniverse).all(),
    filingEvents: db.prepare(FUNDAMENTAL_ROW_SELECTS.filingEvents).all(),
    financialPeriods: db.prepare(FUNDAMENTAL_ROW_SELECTS.financialPeriods).all(),
    financialFacts: db.prepare(FUNDAMENTAL_ROW_SELECTS.financialFacts).all(),
    marketReference: db.prepare(FUNDAMENTAL_ROW_SELECTS.marketReference).all(),
    fundamentalFeatures: db.prepare(FUNDAMENTAL_ROW_SELECTS.fundamentalFeatures).all(),
    fundamentalScores: db.prepare(FUNDAMENTAL_ROW_SELECTS.fundamentalScores).all(),
    fundamentalStates: db.prepare(FUNDAMENTAL_ROW_SELECTS.fundamentalStates).all()
  };
}

function loadSqliteAgentRows(db) {
  return {
    macroRegimeStates: db.prepare(AGENT_ROW_SELECTS.macroRegimeStates).all(),
    tradeSetupStates: db.prepare(AGENT_ROW_SELECTS.tradeSetupStates).all(),
    llmSelectionReviews: db.prepare(AGENT_ROW_SELECTS.llmSelectionReviews).all(),
    finalSelectionCandidates: db.prepare(AGENT_ROW_SELECTS.finalSelectionCandidates).all(),
    tradingSelectionPasses: db.prepare(AGENT_ROW_SELECTS.tradingSelectionPasses).all(),
    riskSnapshots: db.prepare(AGENT_ROW_SELECTS.riskSnapshots).all(),
    positionMonitorSnapshots: db.prepare(AGENT_ROW_SELECTS.positionMonitorSnapshots).all(),
    executionIntents: db.prepare(AGENT_ROW_SELECTS.executionIntents).all(),
    agencyCycleStates: db.prepare(AGENT_ROW_SELECTS.agencyCycleStates).all()
  };
}

async function loadPostgresFundamentalRows(pool) {
  const [
    coverageUniverse,
    filingEvents,
    financialPeriods,
    financialFacts,
    marketReference,
    fundamentalFeatures,
    fundamentalScores,
    fundamentalStates
  ] = await Promise.all([
    pool.query(FUNDAMENTAL_ROW_SELECTS.coverageUniverse),
    pool.query(FUNDAMENTAL_ROW_SELECTS.filingEvents),
    pool.query(FUNDAMENTAL_ROW_SELECTS.financialPeriods),
    pool.query(FUNDAMENTAL_ROW_SELECTS.financialFacts),
    pool.query(FUNDAMENTAL_ROW_SELECTS.marketReference),
    pool.query(FUNDAMENTAL_ROW_SELECTS.fundamentalFeatures),
    pool.query(FUNDAMENTAL_ROW_SELECTS.fundamentalScores),
    pool.query(FUNDAMENTAL_ROW_SELECTS.fundamentalStates)
  ]);

  return {
    coverageUniverse: coverageUniverse.rows,
    filingEvents: filingEvents.rows,
    financialPeriods: financialPeriods.rows,
    financialFacts: financialFacts.rows,
    marketReference: marketReference.rows,
    fundamentalFeatures: fundamentalFeatures.rows,
    fundamentalScores: fundamentalScores.rows,
    fundamentalStates: fundamentalStates.rows
  };
}

async function loadPostgresAgentRows(pool) {
  const [
    macroRegimeStates,
    tradeSetupStates,
    llmSelectionReviews,
    finalSelectionCandidates,
    tradingSelectionPasses,
    riskSnapshots,
    positionMonitorSnapshots,
    executionIntents,
    agencyCycleStates
  ] = await Promise.all([
    pool.query(AGENT_ROW_SELECTS.macroRegimeStates),
    pool.query(AGENT_ROW_SELECTS.tradeSetupStates),
    pool.query(AGENT_ROW_SELECTS.llmSelectionReviews),
    pool.query(AGENT_ROW_SELECTS.finalSelectionCandidates),
    pool.query(AGENT_ROW_SELECTS.tradingSelectionPasses),
    pool.query(AGENT_ROW_SELECTS.riskSnapshots),
    pool.query(AGENT_ROW_SELECTS.positionMonitorSnapshots),
    pool.query(AGENT_ROW_SELECTS.executionIntents),
    pool.query(AGENT_ROW_SELECTS.agencyCycleStates)
  ]);

  return {
    macroRegimeStates: macroRegimeStates.rows,
    tradeSetupStates: tradeSetupStates.rows,
    llmSelectionReviews: llmSelectionReviews.rows,
    finalSelectionCandidates: finalSelectionCandidates.rows,
    tradingSelectionPasses: tradingSelectionPasses.rows,
    riskSnapshots: riskSnapshots.rows,
    positionMonitorSnapshots: positionMonitorSnapshots.rows,
    executionIntents: executionIntents.rows,
    agencyCycleStates: agencyCycleStates.rows
  };
}

function saveSqliteFundamentalWarehouse(db, store, now) {
  const rows = buildFundamentalWarehouseRows(store);
  const insertCoverage = db.prepare(`
    INSERT INTO coverage_universe (ticker, company_name, cik, exchange, country, sector, industry, market_cap_bucket, benchmark_group, is_active, metadata, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ticker) DO UPDATE SET
      company_name = excluded.company_name,
      cik = excluded.cik,
      exchange = excluded.exchange,
      country = excluded.country,
      sector = excluded.sector,
      industry = excluded.industry,
      market_cap_bucket = excluded.market_cap_bucket,
      benchmark_group = excluded.benchmark_group,
      is_active = excluded.is_active,
      metadata = excluded.metadata,
      updated_at = excluded.updated_at
  `);
  const insertFiling = db.prepare(`
    INSERT INTO filing_events (filing_id, ticker, cik, form_type, filing_date, accepted_at, accession_no, period_end, source_url, is_restated, contains_xbrl, filing_metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(filing_id) DO UPDATE SET
      ticker = excluded.ticker,
      cik = excluded.cik,
      form_type = excluded.form_type,
      filing_date = excluded.filing_date,
      accepted_at = excluded.accepted_at,
      accession_no = excluded.accession_no,
      period_end = excluded.period_end,
      source_url = excluded.source_url,
      is_restated = excluded.is_restated,
      contains_xbrl = excluded.contains_xbrl,
      filing_metadata = excluded.filing_metadata
  `);
  const insertPeriod = db.prepare(`
    INSERT INTO financial_periods (period_id, ticker, fiscal_year, fiscal_quarter, period_type, period_start, period_end, filing_id, currency, is_latest)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(period_id) DO UPDATE SET
      ticker = excluded.ticker,
      fiscal_year = excluded.fiscal_year,
      fiscal_quarter = excluded.fiscal_quarter,
      period_type = excluded.period_type,
      period_start = excluded.period_start,
      period_end = excluded.period_end,
      filing_id = excluded.filing_id,
      currency = excluded.currency,
      is_latest = excluded.is_latest
  `);
  const insertFact = db.prepare(`
    INSERT INTO financial_facts (fact_id, period_id, ticker, taxonomy, concept, canonical_field, value, unit, source_form, as_reported_label, normalization_notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(fact_id) DO UPDATE SET
      period_id = excluded.period_id,
      ticker = excluded.ticker,
      taxonomy = excluded.taxonomy,
      concept = excluded.concept,
      canonical_field = excluded.canonical_field,
      value = excluded.value,
      unit = excluded.unit,
      source_form = excluded.source_form,
      as_reported_label = excluded.as_reported_label,
      normalization_notes = excluded.normalization_notes
  `);
  const insertReference = db.prepare(`
    INSERT INTO market_reference (reference_id, ticker, as_of, close_price, market_cap, enterprise_value, shares_outstanding, beta, market_reference_metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(reference_id) DO UPDATE SET
      ticker = excluded.ticker,
      as_of = excluded.as_of,
      close_price = excluded.close_price,
      market_cap = excluded.market_cap,
      enterprise_value = excluded.enterprise_value,
      shares_outstanding = excluded.shares_outstanding,
      beta = excluded.beta,
      market_reference_metadata = excluded.market_reference_metadata
  `);
  const insertFeature = db.prepare(`
    INSERT INTO fundamental_features (feature_id, ticker, as_of, window_basis, revenue_growth_yoy, eps_growth_yoy, fcf_growth_yoy, gross_margin, operating_margin, net_margin, roe, roic, debt_to_equity, net_debt_to_ebitda, current_ratio, interest_coverage, fcf_margin, fcf_conversion, asset_turnover, margin_stability, revenue_consistency, pe_ttm, ev_to_ebitda_ttm, price_to_sales_ttm, peg, fcf_yield, feature_metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(feature_id) DO UPDATE SET
      ticker = excluded.ticker,
      as_of = excluded.as_of,
      window_basis = excluded.window_basis,
      revenue_growth_yoy = excluded.revenue_growth_yoy,
      eps_growth_yoy = excluded.eps_growth_yoy,
      fcf_growth_yoy = excluded.fcf_growth_yoy,
      gross_margin = excluded.gross_margin,
      operating_margin = excluded.operating_margin,
      net_margin = excluded.net_margin,
      roe = excluded.roe,
      roic = excluded.roic,
      debt_to_equity = excluded.debt_to_equity,
      net_debt_to_ebitda = excluded.net_debt_to_ebitda,
      current_ratio = excluded.current_ratio,
      interest_coverage = excluded.interest_coverage,
      fcf_margin = excluded.fcf_margin,
      fcf_conversion = excluded.fcf_conversion,
      asset_turnover = excluded.asset_turnover,
      margin_stability = excluded.margin_stability,
      revenue_consistency = excluded.revenue_consistency,
      pe_ttm = excluded.pe_ttm,
      ev_to_ebitda_ttm = excluded.ev_to_ebitda_ttm,
      price_to_sales_ttm = excluded.price_to_sales_ttm,
      peg = excluded.peg,
      fcf_yield = excluded.fcf_yield,
      feature_metadata = excluded.feature_metadata
  `);
  const insertFundamentalScore = db.prepare(`
    INSERT INTO fundamental_scores (score_id, ticker, as_of, sector, quality_score, growth_score, valuation_score, balance_sheet_score, efficiency_score, earnings_stability_score, sector_score, reporting_confidence_score, data_freshness_score, peer_comparability_score, rule_confidence, llm_confidence, anomaly_penalty, final_confidence, composite_fundamental_score, rating_label, valuation_label, direction_label, regime_label, reason_codes, score_metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(score_id) DO UPDATE SET
      ticker = excluded.ticker,
      as_of = excluded.as_of,
      sector = excluded.sector,
      quality_score = excluded.quality_score,
      growth_score = excluded.growth_score,
      valuation_score = excluded.valuation_score,
      balance_sheet_score = excluded.balance_sheet_score,
      efficiency_score = excluded.efficiency_score,
      earnings_stability_score = excluded.earnings_stability_score,
      sector_score = excluded.sector_score,
      reporting_confidence_score = excluded.reporting_confidence_score,
      data_freshness_score = excluded.data_freshness_score,
      peer_comparability_score = excluded.peer_comparability_score,
      rule_confidence = excluded.rule_confidence,
      llm_confidence = excluded.llm_confidence,
      anomaly_penalty = excluded.anomaly_penalty,
      final_confidence = excluded.final_confidence,
      composite_fundamental_score = excluded.composite_fundamental_score,
      rating_label = excluded.rating_label,
      valuation_label = excluded.valuation_label,
      direction_label = excluded.direction_label,
      regime_label = excluded.regime_label,
      reason_codes = excluded.reason_codes,
      score_metadata = excluded.score_metadata
  `);
  const insertFundamentalState = db.prepare(`
    INSERT INTO fundamental_states (state_id, ticker, as_of, sector, rank_in_sector, rank_global, composite_fundamental_score, confidence, score_delta_30d, rating_label, valuation_label, direction_label, regime_label, top_strengths, top_weaknesses, state_metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(state_id) DO UPDATE SET
      ticker = excluded.ticker,
      as_of = excluded.as_of,
      sector = excluded.sector,
      rank_in_sector = excluded.rank_in_sector,
      rank_global = excluded.rank_global,
      composite_fundamental_score = excluded.composite_fundamental_score,
      confidence = excluded.confidence,
      score_delta_30d = excluded.score_delta_30d,
      rating_label = excluded.rating_label,
      valuation_label = excluded.valuation_label,
      direction_label = excluded.direction_label,
      regime_label = excluded.regime_label,
      top_strengths = excluded.top_strengths,
      top_weaknesses = excluded.top_weaknesses,
      state_metadata = excluded.state_metadata
  `);

  db.exec(`
    DELETE FROM financial_facts;
    DELETE FROM financial_periods;
    DELETE FROM filing_events;
    DELETE FROM fundamental_states;
    DELETE FROM fundamental_scores;
    DELETE FROM fundamental_features;
    DELETE FROM market_reference;
    DELETE FROM coverage_universe;
  `);

  for (const row of rows.coverageUniverse) {
    insertCoverage.run(row.ticker, row.company_name, row.cik || null, row.exchange || null, row.country || "US", row.sector, row.industry, row.market_cap_bucket || null, row.benchmark_group || null, row.is_active ? 1 : 0, JSON.stringify(row.metadata || {}), now);
  }
  for (const row of rows.filingEvents) {
    insertFiling.run(row.filing_id, row.ticker, row.cik || null, row.form_type, row.filing_date, row.accepted_at || null, row.accession_no || null, row.period_end || null, row.source_url, row.is_restated ? 1 : 0, row.contains_xbrl ? 1 : 0, JSON.stringify(row.filing_metadata || {}));
  }
  for (const row of rows.financialPeriods) {
    insertPeriod.run(row.period_id, row.ticker, row.fiscal_year, row.fiscal_quarter ?? null, row.period_type, row.period_start || null, row.period_end, row.filing_id || null, row.currency || "USD", row.is_latest ? 1 : 0);
  }
  for (const row of rows.financialFacts) {
    insertFact.run(row.fact_id, row.period_id, row.ticker, row.taxonomy, row.concept, row.canonical_field, row.value ?? null, row.unit || null, row.source_form || null, row.as_reported_label || null, JSON.stringify(row.normalization_notes || {}));
  }
  for (const row of rows.marketReference) {
    insertReference.run(row.reference_id, row.ticker, row.as_of, row.close_price ?? null, row.market_cap ?? null, row.enterprise_value ?? null, row.shares_outstanding ?? null, row.beta ?? null, JSON.stringify(row.market_reference_metadata || {}));
  }
  for (const row of rows.fundamentalFeatures) {
    insertFeature.run(row.feature_id, row.ticker, row.as_of, row.window_basis, row.revenue_growth_yoy ?? null, row.eps_growth_yoy ?? null, row.fcf_growth_yoy ?? null, row.gross_margin ?? null, row.operating_margin ?? null, row.net_margin ?? null, row.roe ?? null, row.roic ?? null, row.debt_to_equity ?? null, row.net_debt_to_ebitda ?? null, row.current_ratio ?? null, row.interest_coverage ?? null, row.fcf_margin ?? null, row.fcf_conversion ?? null, row.asset_turnover ?? null, row.margin_stability ?? null, row.revenue_consistency ?? null, row.pe_ttm ?? null, row.ev_to_ebitda_ttm ?? null, row.price_to_sales_ttm ?? null, row.peg ?? null, row.fcf_yield ?? null, JSON.stringify(row.feature_metadata || {}));
  }
  for (const row of rows.fundamentalScores) {
    insertFundamentalScore.run(row.score_id, row.ticker, row.as_of, row.sector, row.quality_score, row.growth_score, row.valuation_score, row.balance_sheet_score, row.efficiency_score, row.earnings_stability_score, row.sector_score, row.reporting_confidence_score, row.data_freshness_score, row.peer_comparability_score, row.rule_confidence, row.llm_confidence, row.anomaly_penalty, row.final_confidence, row.composite_fundamental_score, row.rating_label, row.valuation_label, row.direction_label, row.regime_label, JSON.stringify(row.reason_codes || []), JSON.stringify(row.score_metadata || {}));
  }
  for (const row of rows.fundamentalStates) {
    insertFundamentalState.run(row.state_id, row.ticker, row.as_of, row.sector, row.rank_in_sector, row.rank_global, row.composite_fundamental_score, row.confidence, row.score_delta_30d, row.rating_label, row.valuation_label, row.direction_label, row.regime_label, JSON.stringify(row.top_strengths || []), JSON.stringify(row.top_weaknesses || []), JSON.stringify(row.state_metadata || {}));
  }
}

async function savePostgresFundamentalWarehouse(client, store, now) {
  const rows = buildFundamentalWarehouseRows(store);

  await client.query(`
    DELETE FROM financial_facts;
    DELETE FROM financial_periods;
    DELETE FROM filing_events;
    DELETE FROM fundamental_states;
    DELETE FROM fundamental_scores;
    DELETE FROM fundamental_features;
    DELETE FROM market_reference;
    DELETE FROM coverage_universe;
  `);

  for (const row of rows.coverageUniverse) {
    await client.query(
      `INSERT INTO coverage_universe (ticker, company_name, cik, exchange, country, sector, industry, market_cap_bucket, benchmark_group, is_active, metadata, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
       ON CONFLICT (ticker) DO UPDATE SET
         company_name = EXCLUDED.company_name,
         cik = EXCLUDED.cik,
         exchange = EXCLUDED.exchange,
         country = EXCLUDED.country,
         sector = EXCLUDED.sector,
         industry = EXCLUDED.industry,
         market_cap_bucket = EXCLUDED.market_cap_bucket,
         benchmark_group = EXCLUDED.benchmark_group,
         is_active = EXCLUDED.is_active,
         metadata = EXCLUDED.metadata,
         updated_at = EXCLUDED.updated_at`,
      [row.ticker, row.company_name, row.cik || null, row.exchange || null, row.country || "US", row.sector, row.industry, row.market_cap_bucket || null, row.benchmark_group || null, row.is_active !== false, JSON.stringify(row.metadata || {}), now]
    );
  }
  for (const row of rows.filingEvents) {
    await client.query(
      `INSERT INTO filing_events (filing_id, ticker, cik, form_type, filing_date, accepted_at, accession_no, period_end, source_url, is_restated, contains_xbrl, filing_metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
       ON CONFLICT (filing_id) DO UPDATE SET
         ticker = EXCLUDED.ticker,
         cik = EXCLUDED.cik,
         form_type = EXCLUDED.form_type,
         filing_date = EXCLUDED.filing_date,
         accepted_at = EXCLUDED.accepted_at,
         accession_no = EXCLUDED.accession_no,
         period_end = EXCLUDED.period_end,
         source_url = EXCLUDED.source_url,
         is_restated = EXCLUDED.is_restated,
         contains_xbrl = EXCLUDED.contains_xbrl,
         filing_metadata = EXCLUDED.filing_metadata`,
      [row.filing_id, row.ticker, row.cik || null, row.form_type, row.filing_date, row.accepted_at || null, row.accession_no || null, row.period_end || null, row.source_url, row.is_restated === true, row.contains_xbrl === true, JSON.stringify(row.filing_metadata || {})]
    );
  }
  for (const row of rows.financialPeriods) {
    await client.query(
      `INSERT INTO financial_periods (period_id, ticker, fiscal_year, fiscal_quarter, period_type, period_start, period_end, filing_id, currency, is_latest)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (period_id) DO UPDATE SET
         ticker = EXCLUDED.ticker,
         fiscal_year = EXCLUDED.fiscal_year,
         fiscal_quarter = EXCLUDED.fiscal_quarter,
         period_type = EXCLUDED.period_type,
         period_start = EXCLUDED.period_start,
         period_end = EXCLUDED.period_end,
         filing_id = EXCLUDED.filing_id,
         currency = EXCLUDED.currency,
         is_latest = EXCLUDED.is_latest`,
      [row.period_id, row.ticker, row.fiscal_year, row.fiscal_quarter ?? null, row.period_type, row.period_start || null, row.period_end, row.filing_id || null, row.currency || "USD", row.is_latest === true]
    );
  }
  for (const row of rows.financialFacts) {
    await client.query(
      `INSERT INTO financial_facts (fact_id, period_id, ticker, taxonomy, concept, canonical_field, value, unit, source_form, as_reported_label, normalization_notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
       ON CONFLICT (fact_id) DO UPDATE SET
         period_id = EXCLUDED.period_id,
         ticker = EXCLUDED.ticker,
         taxonomy = EXCLUDED.taxonomy,
         concept = EXCLUDED.concept,
         canonical_field = EXCLUDED.canonical_field,
         value = EXCLUDED.value,
         unit = EXCLUDED.unit,
         source_form = EXCLUDED.source_form,
         as_reported_label = EXCLUDED.as_reported_label,
         normalization_notes = EXCLUDED.normalization_notes`,
      [row.fact_id, row.period_id, row.ticker, row.taxonomy, row.concept, row.canonical_field, row.value ?? null, row.unit || null, row.source_form || null, row.as_reported_label || null, JSON.stringify(row.normalization_notes || {})]
    );
  }
  for (const row of rows.marketReference) {
    await client.query(
      `INSERT INTO market_reference (reference_id, ticker, as_of, close_price, market_cap, enterprise_value, shares_outstanding, beta, market_reference_metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       ON CONFLICT (reference_id) DO UPDATE SET
         ticker = EXCLUDED.ticker,
         as_of = EXCLUDED.as_of,
         close_price = EXCLUDED.close_price,
         market_cap = EXCLUDED.market_cap,
         enterprise_value = EXCLUDED.enterprise_value,
         shares_outstanding = EXCLUDED.shares_outstanding,
         beta = EXCLUDED.beta,
         market_reference_metadata = EXCLUDED.market_reference_metadata`,
      [row.reference_id, row.ticker, row.as_of, row.close_price ?? null, row.market_cap ?? null, row.enterprise_value ?? null, row.shares_outstanding ?? null, row.beta ?? null, JSON.stringify(row.market_reference_metadata || {})]
    );
  }
  for (const row of rows.fundamentalFeatures) {
    await client.query(
      `INSERT INTO fundamental_features (feature_id, ticker, as_of, window_basis, revenue_growth_yoy, eps_growth_yoy, fcf_growth_yoy, gross_margin, operating_margin, net_margin, roe, roic, debt_to_equity, net_debt_to_ebitda, current_ratio, interest_coverage, fcf_margin, fcf_conversion, asset_turnover, margin_stability, revenue_consistency, pe_ttm, ev_to_ebitda_ttm, price_to_sales_ttm, peg, fcf_yield, feature_metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27::jsonb)
       ON CONFLICT (feature_id) DO UPDATE SET
         ticker = EXCLUDED.ticker,
         as_of = EXCLUDED.as_of,
         window_basis = EXCLUDED.window_basis,
         revenue_growth_yoy = EXCLUDED.revenue_growth_yoy,
         eps_growth_yoy = EXCLUDED.eps_growth_yoy,
         fcf_growth_yoy = EXCLUDED.fcf_growth_yoy,
         gross_margin = EXCLUDED.gross_margin,
         operating_margin = EXCLUDED.operating_margin,
         net_margin = EXCLUDED.net_margin,
         roe = EXCLUDED.roe,
         roic = EXCLUDED.roic,
         debt_to_equity = EXCLUDED.debt_to_equity,
         net_debt_to_ebitda = EXCLUDED.net_debt_to_ebitda,
         current_ratio = EXCLUDED.current_ratio,
         interest_coverage = EXCLUDED.interest_coverage,
         fcf_margin = EXCLUDED.fcf_margin,
         fcf_conversion = EXCLUDED.fcf_conversion,
         asset_turnover = EXCLUDED.asset_turnover,
         margin_stability = EXCLUDED.margin_stability,
         revenue_consistency = EXCLUDED.revenue_consistency,
         pe_ttm = EXCLUDED.pe_ttm,
         ev_to_ebitda_ttm = EXCLUDED.ev_to_ebitda_ttm,
         price_to_sales_ttm = EXCLUDED.price_to_sales_ttm,
         peg = EXCLUDED.peg,
         fcf_yield = EXCLUDED.fcf_yield,
         feature_metadata = EXCLUDED.feature_metadata`,
      [row.feature_id, row.ticker, row.as_of, row.window_basis, row.revenue_growth_yoy ?? null, row.eps_growth_yoy ?? null, row.fcf_growth_yoy ?? null, row.gross_margin ?? null, row.operating_margin ?? null, row.net_margin ?? null, row.roe ?? null, row.roic ?? null, row.debt_to_equity ?? null, row.net_debt_to_ebitda ?? null, row.current_ratio ?? null, row.interest_coverage ?? null, row.fcf_margin ?? null, row.fcf_conversion ?? null, row.asset_turnover ?? null, row.margin_stability ?? null, row.revenue_consistency ?? null, row.pe_ttm ?? null, row.ev_to_ebitda_ttm ?? null, row.price_to_sales_ttm ?? null, row.peg ?? null, row.fcf_yield ?? null, JSON.stringify(row.feature_metadata || {})]
    );
  }
  for (const row of rows.fundamentalScores) {
    await client.query(
      `INSERT INTO fundamental_scores (score_id, ticker, as_of, sector, quality_score, growth_score, valuation_score, balance_sheet_score, efficiency_score, earnings_stability_score, sector_score, reporting_confidence_score, data_freshness_score, peer_comparability_score, rule_confidence, llm_confidence, anomaly_penalty, final_confidence, composite_fundamental_score, rating_label, valuation_label, direction_label, regime_label, reason_codes, score_metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24::text[], $25::jsonb)
       ON CONFLICT (score_id) DO UPDATE SET
         ticker = EXCLUDED.ticker,
         as_of = EXCLUDED.as_of,
         sector = EXCLUDED.sector,
         quality_score = EXCLUDED.quality_score,
         growth_score = EXCLUDED.growth_score,
         valuation_score = EXCLUDED.valuation_score,
         balance_sheet_score = EXCLUDED.balance_sheet_score,
         efficiency_score = EXCLUDED.efficiency_score,
         earnings_stability_score = EXCLUDED.earnings_stability_score,
         sector_score = EXCLUDED.sector_score,
         reporting_confidence_score = EXCLUDED.reporting_confidence_score,
         data_freshness_score = EXCLUDED.data_freshness_score,
         peer_comparability_score = EXCLUDED.peer_comparability_score,
         rule_confidence = EXCLUDED.rule_confidence,
         llm_confidence = EXCLUDED.llm_confidence,
         anomaly_penalty = EXCLUDED.anomaly_penalty,
         final_confidence = EXCLUDED.final_confidence,
         composite_fundamental_score = EXCLUDED.composite_fundamental_score,
         rating_label = EXCLUDED.rating_label,
         valuation_label = EXCLUDED.valuation_label,
         direction_label = EXCLUDED.direction_label,
         regime_label = EXCLUDED.regime_label,
         reason_codes = EXCLUDED.reason_codes,
         score_metadata = EXCLUDED.score_metadata`,
      [row.score_id, row.ticker, row.as_of, row.sector, row.quality_score, row.growth_score, row.valuation_score, row.balance_sheet_score, row.efficiency_score, row.earnings_stability_score, row.sector_score, row.reporting_confidence_score, row.data_freshness_score, row.peer_comparability_score, row.rule_confidence, row.llm_confidence, row.anomaly_penalty, row.final_confidence, row.composite_fundamental_score, row.rating_label, row.valuation_label, row.direction_label, row.regime_label, row.reason_codes || [], JSON.stringify(row.score_metadata || {})]
    );
  }
  for (const row of rows.fundamentalStates) {
    await client.query(
      `INSERT INTO fundamental_states (state_id, ticker, as_of, sector, rank_in_sector, rank_global, composite_fundamental_score, confidence, score_delta_30d, rating_label, valuation_label, direction_label, regime_label, top_strengths, top_weaknesses, state_metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::text[], $15::text[], $16::jsonb)
       ON CONFLICT (state_id) DO UPDATE SET
         ticker = EXCLUDED.ticker,
         as_of = EXCLUDED.as_of,
         sector = EXCLUDED.sector,
         rank_in_sector = EXCLUDED.rank_in_sector,
         rank_global = EXCLUDED.rank_global,
         composite_fundamental_score = EXCLUDED.composite_fundamental_score,
         confidence = EXCLUDED.confidence,
         score_delta_30d = EXCLUDED.score_delta_30d,
         rating_label = EXCLUDED.rating_label,
         valuation_label = EXCLUDED.valuation_label,
         direction_label = EXCLUDED.direction_label,
         regime_label = EXCLUDED.regime_label,
         top_strengths = EXCLUDED.top_strengths,
         top_weaknesses = EXCLUDED.top_weaknesses,
         state_metadata = EXCLUDED.state_metadata`,
      [row.state_id, row.ticker, row.as_of, row.sector, row.rank_in_sector, row.rank_global, row.composite_fundamental_score, row.confidence, row.score_delta_30d, row.rating_label, row.valuation_label, row.direction_label, row.regime_label, row.top_strengths || [], row.top_weaknesses || [], JSON.stringify(row.state_metadata || {})]
    );
  }
}

function saveSqliteAgentRows(db, store, config) {
  const rows = buildAgentRows(store, config);
  const insertMacroRegime = db.prepare(`
    INSERT INTO macro_regime_states (state_id, as_of, window, regime_label, bias_label, risk_posture, conviction, exposure_multiplier, max_gross_exposure, long_threshold, short_threshold, summary, supporting_signals, risk_flags, state_metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(state_id) DO UPDATE SET
      as_of = excluded.as_of,
      window = excluded.window,
      regime_label = excluded.regime_label,
      bias_label = excluded.bias_label,
      risk_posture = excluded.risk_posture,
      conviction = excluded.conviction,
      exposure_multiplier = excluded.exposure_multiplier,
      max_gross_exposure = excluded.max_gross_exposure,
      long_threshold = excluded.long_threshold,
      short_threshold = excluded.short_threshold,
      summary = excluded.summary,
      supporting_signals = excluded.supporting_signals,
      risk_flags = excluded.risk_flags,
      state_metadata = excluded.state_metadata
  `);
  const insertTradeSetup = db.prepare(`
    INSERT INTO trade_setup_states (setup_id, as_of, window, ticker, company_name, sector, action, setup_label, conviction, position_size_pct, timeframe, current_price, entry_low, entry_high, entry_bias, stop_loss, take_profit, macro_regime_label, macro_bias_label, macro_exposure_multiplier, summary, thesis, risk_flags, evidence_positive, evidence_negative, score_metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(setup_id) DO UPDATE SET
      as_of = excluded.as_of,
      window = excluded.window,
      ticker = excluded.ticker,
      company_name = excluded.company_name,
      sector = excluded.sector,
      action = excluded.action,
      setup_label = excluded.setup_label,
      conviction = excluded.conviction,
      position_size_pct = excluded.position_size_pct,
      timeframe = excluded.timeframe,
      current_price = excluded.current_price,
      entry_low = excluded.entry_low,
      entry_high = excluded.entry_high,
      entry_bias = excluded.entry_bias,
      stop_loss = excluded.stop_loss,
      take_profit = excluded.take_profit,
      macro_regime_label = excluded.macro_regime_label,
      macro_bias_label = excluded.macro_bias_label,
      macro_exposure_multiplier = excluded.macro_exposure_multiplier,
      summary = excluded.summary,
      thesis = excluded.thesis,
      risk_flags = excluded.risk_flags,
      evidence_positive = excluded.evidence_positive,
      evidence_negative = excluded.evidence_negative,
      score_metadata = excluded.score_metadata
  `);
  const insertLlmReview = db.prepare(`
    INSERT INTO llm_selection_reviews (review_id, as_of, window, ticker, company_name, sector, action, confidence, selected, deterministic_action, deterministic_conviction, disagreement_with_deterministic, reviewer, provider, model, mode, status, prompt_version, rationale, supporting_factors, concerns, missing_data, evidence_alignment, risk_assessment, confidence_reason, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(review_id) DO UPDATE SET
      as_of = excluded.as_of,
      window = excluded.window,
      ticker = excluded.ticker,
      company_name = excluded.company_name,
      sector = excluded.sector,
      action = excluded.action,
      confidence = excluded.confidence,
      selected = excluded.selected,
      deterministic_action = excluded.deterministic_action,
      deterministic_conviction = excluded.deterministic_conviction,
      disagreement_with_deterministic = excluded.disagreement_with_deterministic,
      reviewer = excluded.reviewer,
      provider = excluded.provider,
      model = excluded.model,
      mode = excluded.mode,
      status = excluded.status,
      prompt_version = excluded.prompt_version,
      rationale = excluded.rationale,
      supporting_factors = excluded.supporting_factors,
      concerns = excluded.concerns,
      missing_data = excluded.missing_data,
      evidence_alignment = excluded.evidence_alignment,
      risk_assessment = excluded.risk_assessment,
      confidence_reason = excluded.confidence_reason,
      payload_json = excluded.payload_json
  `);
  const insertFinalCandidate = db.prepare(`
    INSERT INTO final_selection_candidates (candidate_id, as_of, window, ticker, company_name, sector, deterministic_action, deterministic_conviction, llm_action, llm_confidence, agreement, final_action, final_conviction, required_final_conviction, final_conviction_gap, execution_allowed, position_size_pct, current_price, stop_loss, take_profit, reason_codes, policy_gates, score_components, selection_report_json, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(candidate_id) DO UPDATE SET
      as_of = excluded.as_of,
      window = excluded.window,
      ticker = excluded.ticker,
      company_name = excluded.company_name,
      sector = excluded.sector,
      deterministic_action = excluded.deterministic_action,
      deterministic_conviction = excluded.deterministic_conviction,
      llm_action = excluded.llm_action,
      llm_confidence = excluded.llm_confidence,
      agreement = excluded.agreement,
      final_action = excluded.final_action,
      final_conviction = excluded.final_conviction,
      required_final_conviction = excluded.required_final_conviction,
      final_conviction_gap = excluded.final_conviction_gap,
      execution_allowed = excluded.execution_allowed,
      position_size_pct = excluded.position_size_pct,
      current_price = excluded.current_price,
      stop_loss = excluded.stop_loss,
      take_profit = excluded.take_profit,
      reason_codes = excluded.reason_codes,
      policy_gates = excluded.policy_gates,
      score_components = excluded.score_components,
      selection_report_json = excluded.selection_report_json,
      payload_json = excluded.payload_json
  `);
  const insertTradingPass = db.prepare(`
    INSERT INTO trading_selection_passes (pass_id, as_of, window, ticker, company_name, sector, final_action, side, final_conviction, position_size_pct, current_price, stop_loss, take_profit, estimated_notional_usd, report_status, final_reason, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(pass_id) DO UPDATE SET
      as_of = excluded.as_of,
      window = excluded.window,
      ticker = excluded.ticker,
      company_name = excluded.company_name,
      sector = excluded.sector,
      final_action = excluded.final_action,
      side = excluded.side,
      final_conviction = excluded.final_conviction,
      position_size_pct = excluded.position_size_pct,
      current_price = excluded.current_price,
      stop_loss = excluded.stop_loss,
      take_profit = excluded.take_profit,
      estimated_notional_usd = excluded.estimated_notional_usd,
      report_status = excluded.report_status,
      final_reason = excluded.final_reason,
      payload_json = excluded.payload_json
  `);
  const insertRiskSnapshot = db.prepare(`
    INSERT INTO risk_snapshots (snapshot_id, as_of, status, equity, buying_power, gross_exposure_pct, open_orders, position_count, hard_blocks, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(snapshot_id) DO UPDATE SET
      as_of = excluded.as_of,
      status = excluded.status,
      equity = excluded.equity,
      buying_power = excluded.buying_power,
      gross_exposure_pct = excluded.gross_exposure_pct,
      open_orders = excluded.open_orders,
      position_count = excluded.position_count,
      hard_blocks = excluded.hard_blocks,
      payload_json = excluded.payload_json
  `);
  const insertPositionMonitor = db.prepare(`
    INSERT INTO position_monitor_snapshots (snapshot_id, as_of, status, risk_status, position_count, open_order_count, review_count, close_candidate_count, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(snapshot_id) DO UPDATE SET
      as_of = excluded.as_of,
      status = excluded.status,
      risk_status = excluded.risk_status,
      position_count = excluded.position_count,
      open_order_count = excluded.open_order_count,
      review_count = excluded.review_count,
      close_candidate_count = excluded.close_candidate_count,
      payload_json = excluded.payload_json
  `);
  const insertExecutionIntent = db.prepare(`
    INSERT INTO execution_intents (intent_id, as_of, ticker, action, side, allowed, execution_allowed, broker_ready, dry_run, estimated_notional_usd, estimated_quantity, current_price, blocked_reason, risk_allowed, risk_blocked_reason, order_json, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(intent_id) DO UPDATE SET
      as_of = excluded.as_of,
      ticker = excluded.ticker,
      action = excluded.action,
      side = excluded.side,
      allowed = excluded.allowed,
      execution_allowed = excluded.execution_allowed,
      broker_ready = excluded.broker_ready,
      dry_run = excluded.dry_run,
      estimated_notional_usd = excluded.estimated_notional_usd,
      estimated_quantity = excluded.estimated_quantity,
      current_price = excluded.current_price,
      blocked_reason = excluded.blocked_reason,
      risk_allowed = excluded.risk_allowed,
      risk_blocked_reason = excluded.risk_blocked_reason,
      order_json = excluded.order_json,
      payload_json = excluded.payload_json
  `);
  const insertAgencyCycle = db.prepare(`
    INSERT INTO agency_cycle_states (cycle_id, as_of, mode, status, baseline_ready, data_progress_pct, current_worker_key, can_use_for_decisions, can_preview_orders, can_submit_orders, worker_count, executable_count, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cycle_id) DO UPDATE SET
      as_of = excluded.as_of,
      mode = excluded.mode,
      status = excluded.status,
      baseline_ready = excluded.baseline_ready,
      data_progress_pct = excluded.data_progress_pct,
      current_worker_key = excluded.current_worker_key,
      can_use_for_decisions = excluded.can_use_for_decisions,
      can_preview_orders = excluded.can_preview_orders,
      can_submit_orders = excluded.can_submit_orders,
      worker_count = excluded.worker_count,
      executable_count = excluded.executable_count,
      payload_json = excluded.payload_json
  `);

  for (const row of rows.macroRegimeStates) {
    insertMacroRegime.run(
      row.state_id,
      row.as_of,
      row.window,
      row.regime_label,
      row.bias_label,
      row.risk_posture,
      row.conviction,
      row.exposure_multiplier,
      row.max_gross_exposure,
      row.long_threshold,
      row.short_threshold,
      row.summary,
      JSON.stringify(row.supporting_signals || []),
      JSON.stringify(row.risk_flags || []),
      JSON.stringify(row.state_metadata || {})
    );
  }

  for (const row of rows.tradeSetupStates) {
    insertTradeSetup.run(
      row.setup_id,
      row.as_of,
      row.window,
      row.ticker,
      row.company_name,
      row.sector,
      row.action,
      row.setup_label,
      row.conviction,
      row.position_size_pct,
      row.timeframe,
      row.current_price ?? null,
      row.entry_low ?? null,
      row.entry_high ?? null,
      row.entry_bias ?? null,
      row.stop_loss ?? null,
      row.take_profit ?? null,
      row.macro_regime_label ?? null,
      row.macro_bias_label ?? null,
      row.macro_exposure_multiplier ?? null,
      row.summary,
      JSON.stringify(row.thesis || []),
      JSON.stringify(row.risk_flags || []),
      JSON.stringify(row.evidence_positive || []),
      JSON.stringify(row.evidence_negative || []),
      JSON.stringify(row.score_metadata || {})
    );
  }

  for (const row of rows.llmSelectionReviews) {
    insertLlmReview.run(
      row.review_id,
      row.as_of,
      row.window,
      row.ticker,
      row.company_name,
      row.sector,
      row.action,
      row.confidence,
      boolInt(row.selected),
      row.deterministic_action,
      row.deterministic_conviction,
      row.disagreement_with_deterministic,
      row.reviewer,
      row.provider,
      row.model,
      row.mode,
      row.status,
      row.prompt_version,
      row.rationale,
      JSON.stringify(row.supporting_factors || []),
      JSON.stringify(row.concerns || []),
      JSON.stringify(row.missing_data || []),
      row.evidence_alignment,
      row.risk_assessment,
      row.confidence_reason,
      JSON.stringify(row.payload_json || {})
    );
  }

  for (const row of rows.finalSelectionCandidates) {
    insertFinalCandidate.run(
      row.candidate_id,
      row.as_of,
      row.window,
      row.ticker,
      row.company_name,
      row.sector,
      row.deterministic_action,
      row.deterministic_conviction,
      row.llm_action,
      row.llm_confidence,
      row.agreement,
      row.final_action,
      row.final_conviction,
      row.required_final_conviction,
      row.final_conviction_gap,
      boolInt(row.execution_allowed),
      row.position_size_pct,
      row.current_price,
      row.stop_loss,
      row.take_profit,
      JSON.stringify(row.reason_codes || []),
      JSON.stringify(row.policy_gates || []),
      JSON.stringify(row.score_components || {}),
      JSON.stringify(row.selection_report_json || {}),
      JSON.stringify(row.payload_json || {})
    );
  }

  for (const row of rows.tradingSelectionPasses) {
    insertTradingPass.run(
      row.pass_id,
      row.as_of,
      row.window,
      row.ticker,
      row.company_name,
      row.sector,
      row.final_action,
      row.side,
      row.final_conviction,
      row.position_size_pct,
      row.current_price,
      row.stop_loss,
      row.take_profit,
      row.estimated_notional_usd,
      row.report_status,
      row.final_reason,
      JSON.stringify(row.payload_json || {})
    );
  }

  for (const row of rows.riskSnapshots) {
    insertRiskSnapshot.run(
      row.snapshot_id,
      row.as_of,
      row.status,
      row.equity,
      row.buying_power,
      row.gross_exposure_pct,
      row.open_orders,
      row.position_count,
      JSON.stringify(row.hard_blocks || []),
      JSON.stringify(row.payload_json || {})
    );
  }

  for (const row of rows.positionMonitorSnapshots) {
    insertPositionMonitor.run(
      row.snapshot_id,
      row.as_of,
      row.status,
      row.risk_status,
      row.position_count,
      row.open_order_count,
      row.review_count,
      row.close_candidate_count,
      JSON.stringify(row.payload_json || {})
    );
  }

  for (const row of rows.executionIntents) {
    insertExecutionIntent.run(
      row.intent_id,
      row.as_of,
      row.ticker,
      row.action,
      row.side,
      boolInt(row.allowed),
      boolInt(row.execution_allowed),
      boolInt(row.broker_ready),
      boolInt(row.dry_run),
      row.estimated_notional_usd,
      row.estimated_quantity,
      row.current_price,
      row.blocked_reason,
      row.risk_allowed === null ? null : boolInt(row.risk_allowed),
      row.risk_blocked_reason,
      JSON.stringify(row.order_json || {}),
      JSON.stringify(row.payload_json || {})
    );
  }

  for (const row of rows.agencyCycleStates) {
    insertAgencyCycle.run(
      row.cycle_id,
      row.as_of,
      row.mode,
      row.status,
      boolInt(row.baseline_ready),
      row.data_progress_pct,
      row.current_worker_key,
      boolInt(row.can_use_for_decisions),
      boolInt(row.can_preview_orders),
      boolInt(row.can_submit_orders),
      row.worker_count,
      row.executable_count,
      JSON.stringify(row.payload_json || {})
    );
  }

  return rows;
}

async function savePostgresAgentRows(client, store, config) {
  const rows = buildAgentRows(store, config);

  for (const row of rows.macroRegimeStates) {
    await client.query(
      `INSERT INTO macro_regime_states (state_id, as_of, window, regime_label, bias_label, risk_posture, conviction, exposure_multiplier, max_gross_exposure, long_threshold, short_threshold, summary, supporting_signals, risk_flags, state_metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text[], $14::text[], $15::jsonb)
       ON CONFLICT (state_id) DO UPDATE SET
         as_of = EXCLUDED.as_of,
         window = EXCLUDED.window,
         regime_label = EXCLUDED.regime_label,
         bias_label = EXCLUDED.bias_label,
         risk_posture = EXCLUDED.risk_posture,
         conviction = EXCLUDED.conviction,
         exposure_multiplier = EXCLUDED.exposure_multiplier,
         max_gross_exposure = EXCLUDED.max_gross_exposure,
         long_threshold = EXCLUDED.long_threshold,
         short_threshold = EXCLUDED.short_threshold,
         summary = EXCLUDED.summary,
         supporting_signals = EXCLUDED.supporting_signals,
         risk_flags = EXCLUDED.risk_flags,
         state_metadata = EXCLUDED.state_metadata`,
      [
        row.state_id,
        row.as_of,
        row.window,
        row.regime_label,
        row.bias_label,
        row.risk_posture,
        row.conviction,
        row.exposure_multiplier,
        row.max_gross_exposure,
        row.long_threshold,
        row.short_threshold,
        row.summary,
        row.supporting_signals || [],
        row.risk_flags || [],
        JSON.stringify(row.state_metadata || {})
      ]
    );
  }

  for (const row of rows.tradeSetupStates) {
    await client.query(
      `INSERT INTO trade_setup_states (setup_id, as_of, window, ticker, company_name, sector, action, setup_label, conviction, position_size_pct, timeframe, current_price, entry_low, entry_high, entry_bias, stop_loss, take_profit, macro_regime_label, macro_bias_label, macro_exposure_multiplier, summary, thesis, risk_flags, evidence_positive, evidence_negative, score_metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22::text[], $23::text[], $24::text[], $25::text[], $26::jsonb)
       ON CONFLICT (setup_id) DO UPDATE SET
         as_of = EXCLUDED.as_of,
         window = EXCLUDED.window,
         ticker = EXCLUDED.ticker,
         company_name = EXCLUDED.company_name,
         sector = EXCLUDED.sector,
         action = EXCLUDED.action,
         setup_label = EXCLUDED.setup_label,
         conviction = EXCLUDED.conviction,
         position_size_pct = EXCLUDED.position_size_pct,
         timeframe = EXCLUDED.timeframe,
         current_price = EXCLUDED.current_price,
         entry_low = EXCLUDED.entry_low,
         entry_high = EXCLUDED.entry_high,
         entry_bias = EXCLUDED.entry_bias,
         stop_loss = EXCLUDED.stop_loss,
         take_profit = EXCLUDED.take_profit,
         macro_regime_label = EXCLUDED.macro_regime_label,
         macro_bias_label = EXCLUDED.macro_bias_label,
         macro_exposure_multiplier = EXCLUDED.macro_exposure_multiplier,
         summary = EXCLUDED.summary,
         thesis = EXCLUDED.thesis,
         risk_flags = EXCLUDED.risk_flags,
         evidence_positive = EXCLUDED.evidence_positive,
         evidence_negative = EXCLUDED.evidence_negative,
         score_metadata = EXCLUDED.score_metadata`,
      [
        row.setup_id,
        row.as_of,
        row.window,
        row.ticker,
        row.company_name,
        row.sector,
        row.action,
        row.setup_label,
        row.conviction,
        row.position_size_pct,
        row.timeframe,
        row.current_price ?? null,
        row.entry_low ?? null,
        row.entry_high ?? null,
        row.entry_bias ?? null,
        row.stop_loss ?? null,
        row.take_profit ?? null,
        row.macro_regime_label ?? null,
        row.macro_bias_label ?? null,
        row.macro_exposure_multiplier ?? null,
        row.summary,
        row.thesis || [],
        row.risk_flags || [],
        row.evidence_positive || [],
        row.evidence_negative || [],
        JSON.stringify(row.score_metadata || {})
      ]
    );
  }

  for (const row of rows.llmSelectionReviews) {
    await client.query(
      `INSERT INTO llm_selection_reviews (review_id, as_of, window, ticker, company_name, sector, action, confidence, selected, deterministic_action, deterministic_conviction, disagreement_with_deterministic, reviewer, provider, model, mode, status, prompt_version, rationale, supporting_factors, concerns, missing_data, evidence_alignment, risk_assessment, confidence_reason, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::text[], $21::text[], $22::text[], $23, $24, $25, $26::jsonb)
       ON CONFLICT (review_id) DO UPDATE SET
         as_of = EXCLUDED.as_of,
         window = EXCLUDED.window,
         ticker = EXCLUDED.ticker,
         company_name = EXCLUDED.company_name,
         sector = EXCLUDED.sector,
         action = EXCLUDED.action,
         confidence = EXCLUDED.confidence,
         selected = EXCLUDED.selected,
         deterministic_action = EXCLUDED.deterministic_action,
         deterministic_conviction = EXCLUDED.deterministic_conviction,
         disagreement_with_deterministic = EXCLUDED.disagreement_with_deterministic,
         reviewer = EXCLUDED.reviewer,
         provider = EXCLUDED.provider,
         model = EXCLUDED.model,
         mode = EXCLUDED.mode,
         status = EXCLUDED.status,
         prompt_version = EXCLUDED.prompt_version,
         rationale = EXCLUDED.rationale,
         supporting_factors = EXCLUDED.supporting_factors,
         concerns = EXCLUDED.concerns,
         missing_data = EXCLUDED.missing_data,
         evidence_alignment = EXCLUDED.evidence_alignment,
         risk_assessment = EXCLUDED.risk_assessment,
         confidence_reason = EXCLUDED.confidence_reason,
         payload_json = EXCLUDED.payload_json`,
      [
        row.review_id,
        row.as_of,
        row.window,
        row.ticker,
        row.company_name,
        row.sector,
        row.action,
        row.confidence,
        Boolean(row.selected),
        row.deterministic_action,
        row.deterministic_conviction,
        row.disagreement_with_deterministic,
        row.reviewer,
        row.provider,
        row.model,
        row.mode,
        row.status,
        row.prompt_version,
        row.rationale,
        row.supporting_factors || [],
        row.concerns || [],
        row.missing_data || [],
        row.evidence_alignment,
        row.risk_assessment,
        row.confidence_reason,
        JSON.stringify(row.payload_json || {})
      ]
    );
  }

  for (const row of rows.finalSelectionCandidates) {
    await client.query(
      `INSERT INTO final_selection_candidates (candidate_id, as_of, window, ticker, company_name, sector, deterministic_action, deterministic_conviction, llm_action, llm_confidence, agreement, final_action, final_conviction, required_final_conviction, final_conviction_gap, execution_allowed, position_size_pct, current_price, stop_loss, take_profit, reason_codes, policy_gates, score_components, selection_report_json, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21::text[], $22::jsonb, $23::jsonb, $24::jsonb, $25::jsonb)
       ON CONFLICT (candidate_id) DO UPDATE SET
         as_of = EXCLUDED.as_of,
         window = EXCLUDED.window,
         ticker = EXCLUDED.ticker,
         company_name = EXCLUDED.company_name,
         sector = EXCLUDED.sector,
         deterministic_action = EXCLUDED.deterministic_action,
         deterministic_conviction = EXCLUDED.deterministic_conviction,
         llm_action = EXCLUDED.llm_action,
         llm_confidence = EXCLUDED.llm_confidence,
         agreement = EXCLUDED.agreement,
         final_action = EXCLUDED.final_action,
         final_conviction = EXCLUDED.final_conviction,
         required_final_conviction = EXCLUDED.required_final_conviction,
         final_conviction_gap = EXCLUDED.final_conviction_gap,
         execution_allowed = EXCLUDED.execution_allowed,
         position_size_pct = EXCLUDED.position_size_pct,
         current_price = EXCLUDED.current_price,
         stop_loss = EXCLUDED.stop_loss,
         take_profit = EXCLUDED.take_profit,
         reason_codes = EXCLUDED.reason_codes,
         policy_gates = EXCLUDED.policy_gates,
         score_components = EXCLUDED.score_components,
         selection_report_json = EXCLUDED.selection_report_json,
         payload_json = EXCLUDED.payload_json`,
      [
        row.candidate_id,
        row.as_of,
        row.window,
        row.ticker,
        row.company_name,
        row.sector,
        row.deterministic_action,
        row.deterministic_conviction,
        row.llm_action,
        row.llm_confidence,
        row.agreement,
        row.final_action,
        row.final_conviction,
        row.required_final_conviction,
        row.final_conviction_gap,
        Boolean(row.execution_allowed),
        row.position_size_pct,
        row.current_price,
        row.stop_loss,
        row.take_profit,
        row.reason_codes || [],
        JSON.stringify(row.policy_gates || []),
        JSON.stringify(row.score_components || {}),
        JSON.stringify(row.selection_report_json || {}),
        JSON.stringify(row.payload_json || {})
      ]
    );
  }

  for (const row of rows.tradingSelectionPasses) {
    await client.query(
      `INSERT INTO trading_selection_passes (pass_id, as_of, window, ticker, company_name, sector, final_action, side, final_conviction, position_size_pct, current_price, stop_loss, take_profit, estimated_notional_usd, report_status, final_reason, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)
       ON CONFLICT (pass_id) DO UPDATE SET
         as_of = EXCLUDED.as_of,
         window = EXCLUDED.window,
         ticker = EXCLUDED.ticker,
         company_name = EXCLUDED.company_name,
         sector = EXCLUDED.sector,
         final_action = EXCLUDED.final_action,
         side = EXCLUDED.side,
         final_conviction = EXCLUDED.final_conviction,
         position_size_pct = EXCLUDED.position_size_pct,
         current_price = EXCLUDED.current_price,
         stop_loss = EXCLUDED.stop_loss,
         take_profit = EXCLUDED.take_profit,
         estimated_notional_usd = EXCLUDED.estimated_notional_usd,
         report_status = EXCLUDED.report_status,
         final_reason = EXCLUDED.final_reason,
         payload_json = EXCLUDED.payload_json`,
      [
        row.pass_id,
        row.as_of,
        row.window,
        row.ticker,
        row.company_name,
        row.sector,
        row.final_action,
        row.side,
        row.final_conviction,
        row.position_size_pct,
        row.current_price,
        row.stop_loss,
        row.take_profit,
        row.estimated_notional_usd,
        row.report_status,
        row.final_reason,
        JSON.stringify(row.payload_json || {})
      ]
    );
  }

  for (const row of rows.riskSnapshots) {
    await client.query(
      `INSERT INTO risk_snapshots (snapshot_id, as_of, status, equity, buying_power, gross_exposure_pct, open_orders, position_count, hard_blocks, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[], $10::jsonb)
       ON CONFLICT (snapshot_id) DO UPDATE SET
         as_of = EXCLUDED.as_of,
         status = EXCLUDED.status,
         equity = EXCLUDED.equity,
         buying_power = EXCLUDED.buying_power,
         gross_exposure_pct = EXCLUDED.gross_exposure_pct,
         open_orders = EXCLUDED.open_orders,
         position_count = EXCLUDED.position_count,
         hard_blocks = EXCLUDED.hard_blocks,
         payload_json = EXCLUDED.payload_json`,
      [
        row.snapshot_id,
        row.as_of,
        row.status,
        row.equity,
        row.buying_power,
        row.gross_exposure_pct,
        row.open_orders,
        row.position_count,
        row.hard_blocks || [],
        JSON.stringify(row.payload_json || {})
      ]
    );
  }

  for (const row of rows.positionMonitorSnapshots) {
    await client.query(
      `INSERT INTO position_monitor_snapshots (snapshot_id, as_of, status, risk_status, position_count, open_order_count, review_count, close_candidate_count, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       ON CONFLICT (snapshot_id) DO UPDATE SET
         as_of = EXCLUDED.as_of,
         status = EXCLUDED.status,
         risk_status = EXCLUDED.risk_status,
         position_count = EXCLUDED.position_count,
         open_order_count = EXCLUDED.open_order_count,
         review_count = EXCLUDED.review_count,
         close_candidate_count = EXCLUDED.close_candidate_count,
         payload_json = EXCLUDED.payload_json`,
      [
        row.snapshot_id,
        row.as_of,
        row.status,
        row.risk_status,
        row.position_count,
        row.open_order_count,
        row.review_count,
        row.close_candidate_count,
        JSON.stringify(row.payload_json || {})
      ]
    );
  }

  for (const row of rows.executionIntents) {
    await client.query(
      `INSERT INTO execution_intents (intent_id, as_of, ticker, action, side, allowed, execution_allowed, broker_ready, dry_run, estimated_notional_usd, estimated_quantity, current_price, blocked_reason, risk_allowed, risk_blocked_reason, order_json, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17::jsonb)
       ON CONFLICT (intent_id) DO UPDATE SET
         as_of = EXCLUDED.as_of,
         ticker = EXCLUDED.ticker,
         action = EXCLUDED.action,
         side = EXCLUDED.side,
         allowed = EXCLUDED.allowed,
         execution_allowed = EXCLUDED.execution_allowed,
         broker_ready = EXCLUDED.broker_ready,
         dry_run = EXCLUDED.dry_run,
         estimated_notional_usd = EXCLUDED.estimated_notional_usd,
         estimated_quantity = EXCLUDED.estimated_quantity,
         current_price = EXCLUDED.current_price,
         blocked_reason = EXCLUDED.blocked_reason,
         risk_allowed = EXCLUDED.risk_allowed,
         risk_blocked_reason = EXCLUDED.risk_blocked_reason,
         order_json = EXCLUDED.order_json,
         payload_json = EXCLUDED.payload_json`,
      [
        row.intent_id,
        row.as_of,
        row.ticker,
        row.action,
        row.side,
        Boolean(row.allowed),
        Boolean(row.execution_allowed),
        Boolean(row.broker_ready),
        Boolean(row.dry_run),
        row.estimated_notional_usd,
        row.estimated_quantity,
        row.current_price,
        row.blocked_reason,
        row.risk_allowed === null ? null : Boolean(row.risk_allowed),
        row.risk_blocked_reason,
        JSON.stringify(row.order_json || {}),
        JSON.stringify(row.payload_json || {})
      ]
    );
  }

  for (const row of rows.agencyCycleStates) {
    await client.query(
      `INSERT INTO agency_cycle_states (cycle_id, as_of, mode, status, baseline_ready, data_progress_pct, current_worker_key, can_use_for_decisions, can_preview_orders, can_submit_orders, worker_count, executable_count, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
       ON CONFLICT (cycle_id) DO UPDATE SET
         as_of = EXCLUDED.as_of,
         mode = EXCLUDED.mode,
         status = EXCLUDED.status,
         baseline_ready = EXCLUDED.baseline_ready,
         data_progress_pct = EXCLUDED.data_progress_pct,
         current_worker_key = EXCLUDED.current_worker_key,
         can_use_for_decisions = EXCLUDED.can_use_for_decisions,
         can_preview_orders = EXCLUDED.can_preview_orders,
         can_submit_orders = EXCLUDED.can_submit_orders,
         worker_count = EXCLUDED.worker_count,
         executable_count = EXCLUDED.executable_count,
         payload_json = EXCLUDED.payload_json`,
      [
        row.cycle_id,
        row.as_of,
        row.mode,
        row.status,
        Boolean(row.baseline_ready),
        row.data_progress_pct,
        row.current_worker_key,
        Boolean(row.can_use_for_decisions),
        Boolean(row.can_preview_orders),
        Boolean(row.can_submit_orders),
        row.worker_count,
        row.executable_count,
        JSON.stringify(row.payload_json || {})
      ]
    );
  }

  return rows;
}

function createDisabledPersistence() {
  const status = buildDisabledBackupStatus({ databaseProvider: "disabled" }, "database_disabled");
  return {
    async init() {},
    async hydrateStore() {},
    async clearAll() {},
    async saveStoreSnapshot() {},
    async hasData() {
      return false;
    },
    async getBackupStatus() {
      return status;
    },
    async backupNow() {
      return status;
    }
  };
}

function limitedPayloadRows(items, limit) {
  return items.slice(Math.max(0, items.length - limit)).map((item) => ({ payload_json: item }));
}

function buildLightweightRows(store, config) {
  const maxDocuments = Math.max(25, Number(config.lightweightStateMaxDocuments || 500));
  return {
    rawDocuments: limitedPayloadRows(store.rawDocuments, maxDocuments),
    normalizedDocuments: limitedPayloadRows(store.normalizedDocuments, maxDocuments),
    documentEntities: limitedPayloadRows(store.documentEntities, maxDocuments * 4),
    documentScores: limitedPayloadRows(store.documentScores, maxDocuments),
    sentimentStates: limitedPayloadRows(store.sentimentStates, maxDocuments),
    sourceStats: [...store.sourceStats.entries()].map(([source_name, payload]) => ({
      source_name,
      payload_json: scrubLegacyPlaceholderMetadata(payload)
    })),
    alertHistory: limitedPayloadRows(store.alertHistory, maxDocuments),
    dedupeClusters: [...store.dedupeClusters.entries()].map(([cluster_key, cluster]) => ({
      cluster_key,
      payload_json: serializeCluster(cluster)
    })),
    seenExternalDocuments: [...store.seenExternalDocuments].slice(-maxDocuments).map((seen_key) => ({ seen_key })),
    runtimeState: [
      { state_key: "health", payload_json: scrubLegacyPlaceholderMetadata(store.health) },
      { state_key: "fundamentals", payload_json: buildRuntimeFundamentals(store) },
      { state_key: "fundamentalUniverse", payload_json: reviveFundamentalUniverse(store.fundamentalUniverse) }
    ],
    fundamentals: buildFundamentalWarehouseRows(store),
    agents: buildAgentRows(store, config)
  };
}

function emptyLightweightRows() {
  return {
    rawDocuments: [],
    normalizedDocuments: [],
    documentEntities: [],
    documentScores: [],
    sentimentStates: [],
    sourceStats: [],
    alertHistory: [],
    dedupeClusters: [],
    seenExternalDocuments: [],
    runtimeState: [],
    fundamentals: {},
    agents: {}
  };
}

function buildLightweightStateStatus(config, state) {
  const exists = existsSync(config.lightweightStatePath);
  const stats = exists ? statSync(config.lightweightStatePath) : null;
  return {
    provider: "json",
    supported: true,
    enabled: true,
    reason: "lightweight_state",
    backup_dir: path.dirname(config.lightweightStatePath),
    interval_ms: null,
    retention_count: 1,
    retention_days: null,
    on_startup: true,
    last_backup_at: state.lastSavedAt || (stats ? stats.mtime.toISOString() : null),
    last_backup_path: exists ? config.lightweightStatePath : null,
    last_backup_size_bytes: stats?.size ?? null,
    backup_count: exists ? 1 : 0,
    last_error: state.lastError || null
  };
}

function createLightweightPersistence(config) {
  const state = {
    lastSavedAt: null,
    lastError: null
  };

  return {
    async init() {
      mkdirSync(path.dirname(config.lightweightStatePath), { recursive: true });
    },
    async hydrateStore(store) {
      if (!existsSync(config.lightweightStatePath)) {
        return;
      }

      try {
        const snapshot = parsePayload(readFileSync(config.lightweightStatePath, "utf8"), null);
        hydrateStoreFromRows(store, {
          ...emptyLightweightRows(),
          ...(snapshot?.rows || {})
        });
        store.health.liveSources.lightweight_state = {
          enabled: true,
          last_success_at: snapshot?.saved_at || null,
          path: config.lightweightStatePath,
          last_error: null
        };
        state.lastSavedAt = snapshot?.saved_at || null;
        state.lastError = null;
      } catch (error) {
        state.lastError = error.message;
        store.health.liveSources.lightweight_state = {
          enabled: true,
          last_success_at: null,
          path: config.lightweightStatePath,
          last_error: error.message
        };
      }
    },
    async clearAll() {
      rmSync(config.lightweightStatePath, { force: true });
      state.lastSavedAt = null;
      state.lastError = null;
    },
    async hasData() {
      return existsSync(config.lightweightStatePath);
    },
    async getBackupStatus() {
      return buildLightweightStateStatus(config, state);
    },
    async backupNow() {
      return buildLightweightStateStatus(config, state);
    },
    async saveStoreSnapshot(store) {
      const savedAt = new Date().toISOString();
      const tempPath = `${config.lightweightStatePath}.${process.pid}.tmp`;
      const snapshot = {
        version: 1,
        saved_at: savedAt,
        rows: buildLightweightRows(store, config)
      };

      try {
        mkdirSync(path.dirname(config.lightweightStatePath), { recursive: true });
        writeFileSync(tempPath, JSON.stringify(snapshot), "utf8");
        renameSync(tempPath, config.lightweightStatePath);
        state.lastSavedAt = savedAt;
        state.lastError = null;
        store.health.liveSources.lightweight_state = {
          enabled: true,
          last_success_at: savedAt,
          path: config.lightweightStatePath,
          last_error: null
        };
      } catch (error) {
        rmSync(tempPath, { force: true });
        state.lastError = error.message;
        store.health.liveSources.lightweight_state = {
          enabled: true,
          last_success_at: state.lastSavedAt,
          path: config.lightweightStatePath,
          last_error: error.message
        };
        throw error;
      }
    }
  };
}

function createSqlitePersistence(config) {
  mkdirSync(path.dirname(config.databasePath), { recursive: true });
  const db = new DatabaseSync(config.databasePath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  const backupState = {
    lastBackupAt: null,
    lastBackupPath: null,
    lastBackupSizeBytes: null,
    lastError: null
  };

  return {
    async init() {
      db.exec(SQLITE_SCHEMA_SQL);
      db.exec(SQLITE_FUNDAMENTALS_SCHEMA_SQL);
      if (config.sqliteBackupEnabled) {
        mkdirSync(config.sqliteBackupDir, { recursive: true });
        pruneSqliteBackups(config);
      }
    },
    async clearAll() {
      db.exec(`
        DELETE FROM financial_facts;
        DELETE FROM financial_periods;
        DELETE FROM filing_events;
        DELETE FROM fundamental_states;
        DELETE FROM fundamental_scores;
        DELETE FROM fundamental_features;
        DELETE FROM market_reference;
        DELETE FROM agency_cycle_states;
        DELETE FROM execution_intents;
        DELETE FROM position_monitor_snapshots;
        DELETE FROM risk_snapshots;
        DELETE FROM trading_selection_passes;
        DELETE FROM final_selection_candidates;
        DELETE FROM llm_selection_reviews;
        DELETE FROM trade_setup_states;
        DELETE FROM macro_regime_states;
        DELETE FROM coverage_universe;
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
      const row = db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM raw_documents) +
          (SELECT COUNT(*) FROM coverage_universe) AS count
      `).get();
      return Number(row?.count || 0) > 0;
    },
    async getBackupStatus() {
      return buildSqliteBackupStatus(config, backupState);
    },
    async backupNow({ reason = "manual" } = {}) {
      if (!config.sqliteBackupEnabled) {
        return buildSqliteBackupStatus(config, backupState);
      }

      mkdirSync(config.sqliteBackupDir, { recursive: true });
      const stamp = formatBackupStamp();
      const tempPath = path.join(config.sqliteBackupDir, `sentiment-analyst-${stamp}-${process.pid}.tmp.sqlite`);
      const finalPath = path.join(config.sqliteBackupDir, `sentiment-analyst-${stamp}.sqlite`);

      try {
        db.exec(`VACUUM INTO '${escapeSqliteLiteral(tempPath)}';`);
        renameSync(tempPath, finalPath);
        const stats = statSync(finalPath);
        backupState.lastBackupAt = new Date().toISOString();
        backupState.lastBackupPath = finalPath;
        backupState.lastBackupSizeBytes = stats.size;
        backupState.lastError = null;
        pruneSqliteBackups(config);
      } catch (error) {
        rmSync(tempPath, { force: true });
        backupState.lastError = `backup:${reason}:${error.message}`;
      }

      return buildSqliteBackupStatus(config, backupState);
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
        runtimeState: db.prepare("SELECT state_key, payload_json FROM runtime_state").all(),
        fundamentals: loadSqliteFundamentalRows(db),
        agents: loadSqliteAgentRows(db)
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
          insertSource.run(sourceName, source.updated_at || now, JSON.stringify(scrubLegacyPlaceholderMetadata(source)));
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
        saveSqliteFundamentalWarehouse(db, store, now);
        const agentRows = saveSqliteAgentRows(db, store, config);
        const revivedAgentRows = reviveAgentRows(agentRows);
        store.macroRegimeHistory = revivedAgentRows.macroRegimeHistory;
        store.tradeSetupHistory = revivedAgentRows.tradeSetupHistory;
        store.llmSelectionHistory = revivedAgentRows.llmSelectionHistory;
        store.finalSelectionHistory = revivedAgentRows.finalSelectionHistory;
        store.tradingSelectionPassHistory = revivedAgentRows.tradingSelectionPassHistory;
        store.riskSnapshotHistory = revivedAgentRows.riskSnapshotHistory;
        store.positionMonitorHistory = revivedAgentRows.positionMonitorHistory;
        store.executionIntentHistory = revivedAgentRows.executionIntentHistory;
        store.agencyCycleHistory = revivedAgentRows.agencyCycleHistory;
        insertRuntime.run("health", now, JSON.stringify(scrubLegacyPlaceholderMetadata(store.health)));
        insertRuntime.run("fundamentals", now, JSON.stringify(buildRuntimeFundamentals(store)));
        insertRuntime.run("fundamentalUniverse", now, JSON.stringify(reviveFundamentalUniverse(store.fundamentalUniverse)));
        insertRuntime.run("earningsCalendar", now, JSON.stringify(Array.from(store.earningsCalendar.entries())));
        insertRuntime.run("pendingApprovals", now, JSON.stringify(Array.from(store.pendingApprovals.entries())));
        insertRuntime.run("positions", now, JSON.stringify(Array.from(store.positions.entries())));
        insertRuntime.run("orders", now, JSON.stringify(Array.from(store.orders.entries())));
        insertRuntime.run("executionState", now, JSON.stringify(store.executionState));
        insertRuntime.run("executionLog", now, JSON.stringify(store.executionLog));
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
  const status = buildDisabledBackupStatus(config, "sqlite_backup_only");

  return {
    async init() {
      await pool.query(POSTGRES_SCHEMA_SQL);
      await pool.query(POSTGRES_FUNDAMENTALS_SCHEMA_SQL);
    },
    async clearAll() {
      await pool.query(`
        TRUNCATE TABLE
          financial_facts,
          financial_periods,
          filing_events,
          fundamental_states,
          fundamental_scores,
          fundamental_features,
          market_reference,
          agency_cycle_states,
          execution_intents,
          position_monitor_snapshots,
          risk_snapshots,
          trading_selection_passes,
          final_selection_candidates,
          llm_selection_reviews,
          trade_setup_states,
          macro_regime_states,
          coverage_universe,
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
      const result = await pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM raw_documents) +
          (SELECT COUNT(*)::int FROM coverage_universe) AS count
      `);
      return Number(result.rows[0]?.count || 0) > 0;
    },
    async getBackupStatus() {
      return status;
    },
    async backupNow() {
      return status;
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
        runtimeState,
        fundamentals,
        agents
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
        pool.query("SELECT state_key, payload_json FROM runtime_state"),
        loadPostgresFundamentalRows(pool),
        loadPostgresAgentRows(pool)
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
        runtimeState: runtimeState.rows,
        fundamentals,
        agents
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
            [sourceName, source.updated_at || now, JSON.stringify(scrubLegacyPlaceholderMetadata(source))]
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
        await savePostgresFundamentalWarehouse(client, store, now);
        const agentRows = await savePostgresAgentRows(client, store, config);
        const revivedAgentRows = reviveAgentRows(agentRows);
        store.macroRegimeHistory = revivedAgentRows.macroRegimeHistory;
        store.tradeSetupHistory = revivedAgentRows.tradeSetupHistory;
        store.llmSelectionHistory = revivedAgentRows.llmSelectionHistory;
        store.finalSelectionHistory = revivedAgentRows.finalSelectionHistory;
        store.tradingSelectionPassHistory = revivedAgentRows.tradingSelectionPassHistory;
        store.riskSnapshotHistory = revivedAgentRows.riskSnapshotHistory;
        store.positionMonitorHistory = revivedAgentRows.positionMonitorHistory;
        store.executionIntentHistory = revivedAgentRows.executionIntentHistory;
        store.agencyCycleHistory = revivedAgentRows.agencyCycleHistory;

        await client.query(
          `INSERT INTO runtime_state (state_key, updated_at, payload_json)
           VALUES ($1, $2, $3::jsonb)
           ON CONFLICT (state_key) DO UPDATE
           SET updated_at = EXCLUDED.updated_at,
               payload_json = EXCLUDED.payload_json`,
          ["health", now, JSON.stringify(scrubLegacyPlaceholderMetadata(store.health))]
        );
        await client.query(
          `INSERT INTO runtime_state (state_key, updated_at, payload_json)
           VALUES ($1, $2, $3::jsonb)
          ON CONFLICT (state_key) DO UPDATE
          SET updated_at = EXCLUDED.updated_at,
              payload_json = EXCLUDED.payload_json`,
          ["fundamentals", now, JSON.stringify(buildRuntimeFundamentals(store))]
        );
        await client.query(
          `INSERT INTO runtime_state (state_key, updated_at, payload_json)
           VALUES ($1, $2, $3::jsonb)
          ON CONFLICT (state_key) DO UPDATE
          SET updated_at = EXCLUDED.updated_at,
              payload_json = EXCLUDED.payload_json`,
          ["fundamentalUniverse", now, JSON.stringify(reviveFundamentalUniverse(store.fundamentalUniverse))]
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
      ? config.lightweightStateEnabled
        ? createLightweightPersistence(config)
        : createDisabledPersistence()
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
    async getBackupStatus() {
      return provider.getBackupStatus ? provider.getBackupStatus() : null;
    },
    async backupNow(options) {
      writeQueue = writeQueue.then(() => (
        provider.backupNow ? provider.backupNow(options) : provider.getBackupStatus?.()
      ));
      return writeQueue;
    },
    async saveStoreSnapshot(store) {
      writeQueue = writeQueue.then(() => provider.saveStoreSnapshot(store));
      return writeQueue;
    }
  };
}
