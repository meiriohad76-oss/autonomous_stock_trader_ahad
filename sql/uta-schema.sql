CREATE TABLE IF NOT EXISTS uta_universes (
  universe_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  label TEXT NOT NULL,
  category TEXT NOT NULL,
  ticker_count INTEGER NOT NULL DEFAULT 0,
  last_updated TEXT,
  source TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS uta_ticker_profiles (
  ticker TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  exchange TEXT,
  sector TEXT,
  industry TEXT,
  liquidity_bucket TEXT,
  adv_20day REAL,
  notional_floor REAL,
  last_updated TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS uta_baseline_cache (
  ticker TEXT NOT NULL,
  as_of_date TEXT NOT NULL,
  time_bucket TEXT NOT NULL,
  metric TEXT NOT NULL,
  median REAL,
  mad REAL,
  session_count INTEGER NOT NULL DEFAULT 0,
  earnings_excluded_count INTEGER NOT NULL DEFAULT 0,
  last_built_at TEXT,
  PRIMARY KEY (ticker, as_of_date, time_bucket, metric)
);

CREATE TABLE IF NOT EXISTS uta_observations (
  id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  as_of_date TEXT NOT NULL,
  source_lane TEXT NOT NULL,
  condition_code_policy_version TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS uta_signal_results (
  id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  universe TEXT,
  as_of TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  tier TEXT,
  direction TEXT,
  indicators_json TEXT NOT NULL,
  lane_state_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  replay_mode INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS uta_lane_states (
  lane_id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  latest_as_of TEXT,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS uta_activity_alerts (
  id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  provider TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  direction TEXT,
  alert_timestamp TEXT,
  confidence_level REAL,
  dedup_key TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS uta_user_state (
  state_key TEXT PRIMARY KEY,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS uta_replay_runs (
  run_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  replay_clock TEXT,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS uta_replay_evaluations (
  evaluation_id TEXT PRIMARY KEY,
  fixture_schema_version TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  actionable_row_count INTEGER NOT NULL DEFAULT 0,
  windows_json TEXT NOT NULL DEFAULT '[]',
  metrics_json TEXT NOT NULL DEFAULT '{}',
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS uta_calibration_reports (
  report_id TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  lookahead_passed INTEGER NOT NULL DEFAULT 0,
  b_score_stability_passed INTEGER NOT NULL DEFAULT 0,
  false_positive_passed INTEGER NOT NULL DEFAULT 0,
  precision_passed INTEGER NOT NULL DEFAULT 0,
  monotonic_tier_passed INTEGER NOT NULL DEFAULT 0,
  paper_trading_effect_allowed INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL
);
