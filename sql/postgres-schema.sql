CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'source_type_enum') THEN
    CREATE TYPE source_type_enum AS ENUM ('rss', 'news_api', 'filing', 'insider', 'macro', 'calendar', 'manual');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'entity_type_enum') THEN
    CREATE TYPE entity_type_enum AS ENUM ('ticker', 'sector', 'watchlist', 'market');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'event_direction_enum') THEN
    CREATE TYPE event_direction_enum AS ENUM ('positive', 'negative', 'mixed', 'unclear');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bullish_bearish_enum') THEN
    CREATE TYPE bullish_bearish_enum AS ENUM ('bullish', 'neutral', 'bearish');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'urgency_enum') THEN
    CREATE TYPE urgency_enum AS ENUM ('low', 'medium', 'high');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tradeability_enum') THEN
    CREATE TYPE tradeability_enum AS ENUM ('ignore', 'monitor', 'actionable');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pipeline_stage_enum') THEN
    CREATE TYPE pipeline_stage_enum AS ENUM ('collected', 'normalized', 'deduped', 'scored', 'aggregated', 'alerted', 'failed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'financial_period_type_enum') THEN
    CREATE TYPE financial_period_type_enum AS ENUM ('quarterly', 'annual', 'ttm');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fundamental_rating_enum') THEN
    CREATE TYPE fundamental_rating_enum AS ENUM ('fundamentally_strong', 'balanced', 'weak', 'deteriorating');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fundamental_valuation_enum') THEN
    CREATE TYPE fundamental_valuation_enum AS ENUM ('cheap', 'fair', 'expensive', 'extremely_expensive');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fundamental_direction_enum') THEN
    CREATE TYPE fundamental_direction_enum AS ENUM ('bullish_supportive', 'neutral', 'bearish_headwind');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fundamental_regime_enum') THEN
    CREATE TYPE fundamental_regime_enum AS ENUM ('compounder', 'cyclical_recovery', 'value_trap_risk', 'quality_at_premium', 'distressed', 'mixed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS raw_documents (
  raw_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name TEXT NOT NULL,
  source_type source_type_enum NOT NULL,
  source_priority NUMERIC(4,3) NOT NULL DEFAULT 0.500 CHECK (source_priority >= 0 AND source_priority <= 1),
  url TEXT NOT NULL,
  canonical_url TEXT,
  title TEXT NOT NULL,
  body TEXT,
  published_at TIMESTAMPTZ NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  language VARCHAR(8) NOT NULL DEFAULT 'en',
  author TEXT,
  source_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  raw_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  content_hash TEXT NOT NULL,
  ingest_run_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_name, url),
  UNIQUE (content_hash)
);

CREATE INDEX IF NOT EXISTS idx_raw_documents_published_at ON raw_documents (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_documents_source_type ON raw_documents (source_type);

CREATE TABLE IF NOT EXISTS dedupe_clusters (
  dedupe_cluster_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_key TEXT NOT NULL UNIQUE,
  canonical_headline TEXT NOT NULL,
  canonical_url TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  member_count INTEGER NOT NULL DEFAULT 1 CHECK (member_count >= 1),
  unique_source_count INTEGER NOT NULL DEFAULT 1 CHECK (unique_source_count >= 1),
  novelty_score NUMERIC(4,3) NOT NULL DEFAULT 1.000 CHECK (novelty_score >= 0 AND novelty_score <= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS normalized_documents (
  doc_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_id UUID NOT NULL REFERENCES raw_documents(raw_id) ON DELETE CASCADE,
  canonical_url TEXT,
  headline TEXT NOT NULL,
  summary_text TEXT,
  body_text TEXT,
  published_at TIMESTAMPTZ NOT NULL,
  source_name TEXT NOT NULL,
  source_type source_type_enum NOT NULL,
  source_trust NUMERIC(4,3) NOT NULL CHECK (source_trust >= 0 AND source_trust <= 1),
  is_official_filing BOOLEAN NOT NULL DEFAULT FALSE,
  is_press_release BOOLEAN NOT NULL DEFAULT FALSE,
  primary_ticker TEXT,
  mentioned_tickers TEXT[] NOT NULL DEFAULT '{}',
  companies TEXT[] NOT NULL DEFAULT '{}',
  sector TEXT,
  industry TEXT,
  regions TEXT[] NOT NULL DEFAULT '{}',
  themes TEXT[] NOT NULL DEFAULT '{}',
  dedupe_cluster_id UUID REFERENCES dedupe_clusters(dedupe_cluster_id),
  novelty_score NUMERIC(4,3) NOT NULL CHECK (novelty_score >= 0 AND novelty_score <= 1),
  timeliness_score NUMERIC(4,3) NOT NULL CHECK (timeliness_score >= 0 AND timeliness_score <= 1),
  extraction_quality_score NUMERIC(4,3) NOT NULL CHECK (extraction_quality_score >= 0 AND extraction_quality_score <= 1),
  mapping_confidence NUMERIC(4,3) NOT NULL CHECK (mapping_confidence >= 0 AND mapping_confidence <= 1),
  processing_notes JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (raw_id)
);

CREATE INDEX IF NOT EXISTS idx_normalized_documents_primary_ticker ON normalized_documents (primary_ticker, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_normalized_documents_sector ON normalized_documents (sector, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_normalized_documents_dedupe_cluster ON normalized_documents (dedupe_cluster_id);

CREATE TABLE IF NOT EXISTS document_entities (
  entity_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id UUID NOT NULL REFERENCES normalized_documents(doc_id) ON DELETE CASCADE,
  entity_type entity_type_enum NOT NULL,
  entity_key TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  relevance_score NUMERIC(4,3) NOT NULL CHECK (relevance_score >= 0 AND relevance_score <= 1),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (doc_id, entity_type, entity_key)
);

CREATE INDEX IF NOT EXISTS idx_document_entities_key ON document_entities (entity_type, entity_key);

CREATE TABLE IF NOT EXISTS document_scores (
  score_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id UUID NOT NULL REFERENCES normalized_documents(doc_id) ON DELETE CASCADE,
  model_version TEXT NOT NULL,
  event_family TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_direction event_direction_enum NOT NULL,
  bullish_bearish_label bullish_bearish_enum NOT NULL,
  urgency urgency_enum NOT NULL,
  tradeability tradeability_enum NOT NULL,
  horizon TEXT NOT NULL,
  sentiment_score NUMERIC(5,4) NOT NULL CHECK (sentiment_score >= -1 AND sentiment_score <= 1),
  impact_score NUMERIC(4,3) NOT NULL CHECK (impact_score >= 0 AND impact_score <= 1),
  relevance_score NUMERIC(4,3) NOT NULL CHECK (relevance_score >= 0 AND relevance_score <= 1),
  novelty_score NUMERIC(4,3) NOT NULL CHECK (novelty_score >= 0 AND novelty_score <= 1),
  timeliness_score NUMERIC(4,3) NOT NULL CHECK (timeliness_score >= 0 AND timeliness_score <= 1),
  source_reliability_score NUMERIC(4,3) NOT NULL CHECK (source_reliability_score >= 0 AND source_reliability_score <= 1),
  extraction_quality_score NUMERIC(4,3) NOT NULL CHECK (extraction_quality_score >= 0 AND extraction_quality_score <= 1),
  llm_confidence NUMERIC(4,3) NOT NULL CHECK (llm_confidence >= 0 AND llm_confidence <= 1),
  rule_confidence NUMERIC(4,3) NOT NULL CHECK (rule_confidence >= 0 AND rule_confidence <= 1),
  classification_confidence NUMERIC(4,3) NOT NULL CHECK (classification_confidence >= 0 AND classification_confidence <= 1),
  final_confidence NUMERIC(4,3) NOT NULL CHECK (final_confidence >= 0 AND final_confidence <= 1),
  document_alpha NUMERIC(7,5) NOT NULL,
  reason_codes TEXT[] NOT NULL DEFAULT '{}',
  evidence_quotes TEXT[] NOT NULL DEFAULT '{}',
  explanation_short TEXT NOT NULL,
  score_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  scored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (doc_id, model_version, horizon)
);

CREATE INDEX IF NOT EXISTS idx_document_scores_event_type ON document_scores (event_family, event_type);
CREATE INDEX IF NOT EXISTS idx_document_scores_final_confidence ON document_scores (final_confidence DESC);

CREATE TABLE IF NOT EXISTS sentiment_states (
  state_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type entity_type_enum NOT NULL,
  entity_key TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  window TEXT NOT NULL,
  as_of TIMESTAMPTZ NOT NULL,
  doc_count INTEGER NOT NULL DEFAULT 0,
  unique_story_count INTEGER NOT NULL DEFAULT 0,
  weighted_sentiment NUMERIC(5,4) NOT NULL CHECK (weighted_sentiment >= -1 AND weighted_sentiment <= 1),
  weighted_impact NUMERIC(4,3) NOT NULL CHECK (weighted_impact >= 0 AND weighted_impact <= 1),
  weighted_confidence NUMERIC(4,3) NOT NULL CHECK (weighted_confidence >= 0 AND weighted_confidence <= 1),
  story_velocity NUMERIC(7,3) NOT NULL DEFAULT 0,
  momentum_delta NUMERIC(6,4) NOT NULL DEFAULT 0,
  event_concentration NUMERIC(4,3) NOT NULL DEFAULT 0 CHECK (event_concentration >= 0 AND event_concentration <= 1),
  source_diversity NUMERIC(4,3) NOT NULL DEFAULT 0 CHECK (source_diversity >= 0 AND source_diversity <= 1),
  sentiment_regime bullish_bearish_enum NOT NULL,
  top_event_types TEXT[] NOT NULL DEFAULT '{}',
  top_reasons TEXT[] NOT NULL DEFAULT '{}',
  state_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_type, entity_key, window, as_of)
);

CREATE INDEX IF NOT EXISTS idx_sentiment_states_lookup ON sentiment_states (entity_type, entity_key, window, as_of DESC);

CREATE TABLE IF NOT EXISTS source_stats (
  source_name TEXT PRIMARY KEY,
  source_type source_type_enum NOT NULL,
  rolling_volume_1d INTEGER NOT NULL DEFAULT 0,
  rolling_avg_confidence NUMERIC(4,3) NOT NULL DEFAULT 0,
  rolling_precision_1d NUMERIC(4,3),
  avg_lag_seconds NUMERIC(10,2),
  failure_count_1d INTEGER NOT NULL DEFAULT 0,
  trust_score NUMERIC(4,3) NOT NULL DEFAULT 0.500 CHECK (trust_score >= 0 AND trust_score <= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_outcomes (
  outcome_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id UUID NOT NULL REFERENCES normalized_documents(doc_id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  event_family TEXT NOT NULL,
  event_type TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  horizon_15m_return NUMERIC(8,4),
  horizon_1h_return NUMERIC(8,4),
  horizon_1d_return NUMERIC(8,4),
  horizon_3d_return NUMERIC(8,4),
  abnormal_return_15m NUMERIC(8,4),
  abnormal_return_1h NUMERIC(8,4),
  abnormal_return_1d NUMERIC(8,4),
  abnormal_return_3d NUMERIC(8,4),
  volume_abnormality NUMERIC(8,4),
  realized_signal_quality NUMERIC(4,3),
  calibration_bucket TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_outcomes_ticker_published ON event_outcomes (ticker, published_at DESC);

CREATE TABLE IF NOT EXISTS agent_runs (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type TEXT NOT NULL,
  status pipeline_stage_enum NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  documents_seen INTEGER NOT NULL DEFAULT 0,
  documents_scored INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  run_metadata JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE TABLE IF NOT EXISTS alert_history (
  alert_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type TEXT NOT NULL,
  entity_type entity_type_enum NOT NULL,
  entity_key TEXT NOT NULL,
  headline TEXT,
  severity urgency_enum NOT NULL,
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_history_entity ON alert_history (entity_type, entity_key, created_at DESC);

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

CREATE INDEX IF NOT EXISTS idx_coverage_universe_sector ON coverage_universe (sector, is_active);

CREATE TABLE IF NOT EXISTS filing_events (
  filing_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker TEXT NOT NULL REFERENCES coverage_universe(ticker) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_filing_events_ticker_date ON filing_events (ticker, filing_date DESC);

CREATE TABLE IF NOT EXISTS financial_periods (
  period_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker TEXT NOT NULL REFERENCES coverage_universe(ticker) ON DELETE CASCADE,
  fiscal_year INTEGER NOT NULL,
  fiscal_quarter INTEGER,
  period_type financial_period_type_enum NOT NULL,
  period_start DATE,
  period_end DATE NOT NULL,
  filing_id UUID REFERENCES filing_events(filing_id) ON DELETE SET NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  is_latest BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticker, fiscal_year, fiscal_quarter, period_type)
);

CREATE INDEX IF NOT EXISTS idx_financial_periods_ticker_latest ON financial_periods (ticker, is_latest, period_end DESC);

CREATE TABLE IF NOT EXISTS financial_facts (
  fact_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID NOT NULL REFERENCES financial_periods(period_id) ON DELETE CASCADE,
  ticker TEXT NOT NULL REFERENCES coverage_universe(ticker) ON DELETE CASCADE,
  taxonomy TEXT NOT NULL,
  concept TEXT NOT NULL,
  canonical_field TEXT NOT NULL,
  value NUMERIC(24,6),
  unit TEXT,
  source_form TEXT,
  as_reported_label TEXT,
  normalization_notes JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (period_id, concept, canonical_field)
);

CREATE INDEX IF NOT EXISTS idx_financial_facts_lookup ON financial_facts (ticker, canonical_field);

CREATE TABLE IF NOT EXISTS market_reference (
  reference_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker TEXT NOT NULL REFERENCES coverage_universe(ticker) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_market_reference_ticker_asof ON market_reference (ticker, as_of DESC);

CREATE TABLE IF NOT EXISTS fundamental_features (
  feature_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker TEXT NOT NULL REFERENCES coverage_universe(ticker) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_fundamental_features_ticker_asof ON fundamental_features (ticker, as_of DESC);

CREATE TABLE IF NOT EXISTS peer_normalizations (
  normalization_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker TEXT NOT NULL REFERENCES coverage_universe(ticker) ON DELETE CASCADE,
  as_of TIMESTAMPTZ NOT NULL,
  peer_group_key TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  percentile_value NUMERIC(10,6) NOT NULL CHECK (percentile_value >= 0 AND percentile_value <= 1),
  z_score NUMERIC(12,6),
  winsorized_value NUMERIC(18,6),
  peer_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticker, as_of, peer_group_key, metric_name)
);

CREATE INDEX IF NOT EXISTS idx_peer_normalizations_lookup ON peer_normalizations (ticker, as_of DESC);

CREATE TABLE IF NOT EXISTS sector_features (
  sector_feature_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sector TEXT NOT NULL,
  as_of TIMESTAMPTZ NOT NULL,
  growth_breadth NUMERIC(10,6),
  profitability_strength NUMERIC(10,6),
  revision_breadth NUMERIC(10,6),
  relative_valuation NUMERIC(10,6),
  macro_fit NUMERIC(10,6),
  sector_price_momentum_3m NUMERIC(10,6),
  median_revenue_growth NUMERIC(10,6),
  median_operating_margin NUMERIC(10,6),
  median_roic NUMERIC(10,6),
  median_pe_ttm NUMERIC(10,6),
  sector_attractiveness_score NUMERIC(10,6) NOT NULL CHECK (sector_attractiveness_score >= 0 AND sector_attractiveness_score <= 1),
  sector_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sector, as_of)
);

CREATE INDEX IF NOT EXISTS idx_sector_features_asof ON sector_features (as_of DESC, sector_attractiveness_score DESC);

CREATE TABLE IF NOT EXISTS fundamental_scores (
  score_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker TEXT NOT NULL REFERENCES coverage_universe(ticker) ON DELETE CASCADE,
  as_of TIMESTAMPTZ NOT NULL,
  sector TEXT NOT NULL,
  quality_score NUMERIC(10,6) NOT NULL CHECK (quality_score >= 0 AND quality_score <= 1),
  growth_score NUMERIC(10,6) NOT NULL CHECK (growth_score >= 0 AND growth_score <= 1),
  valuation_score NUMERIC(10,6) NOT NULL CHECK (valuation_score >= 0 AND valuation_score <= 1),
  balance_sheet_score NUMERIC(10,6) NOT NULL CHECK (balance_sheet_score >= 0 AND balance_sheet_score <= 1),
  efficiency_score NUMERIC(10,6) NOT NULL CHECK (efficiency_score >= 0 AND efficiency_score <= 1),
  earnings_stability_score NUMERIC(10,6) NOT NULL CHECK (earnings_stability_score >= 0 AND earnings_stability_score <= 1),
  sector_score NUMERIC(10,6) NOT NULL CHECK (sector_score >= 0 AND sector_score <= 1),
  reporting_confidence_score NUMERIC(10,6) NOT NULL CHECK (reporting_confidence_score >= 0 AND reporting_confidence_score <= 1),
  data_freshness_score NUMERIC(10,6) NOT NULL CHECK (data_freshness_score >= 0 AND data_freshness_score <= 1),
  peer_comparability_score NUMERIC(10,6) NOT NULL CHECK (peer_comparability_score >= 0 AND peer_comparability_score <= 1),
  rule_confidence NUMERIC(10,6) NOT NULL CHECK (rule_confidence >= 0 AND rule_confidence <= 1),
  llm_confidence NUMERIC(10,6) NOT NULL CHECK (llm_confidence >= 0 AND llm_confidence <= 1),
  anomaly_penalty NUMERIC(10,6) NOT NULL CHECK (anomaly_penalty >= 0 AND anomaly_penalty <= 1),
  final_confidence NUMERIC(10,6) NOT NULL CHECK (final_confidence >= 0 AND final_confidence <= 1),
  composite_fundamental_score NUMERIC(10,6) NOT NULL CHECK (composite_fundamental_score >= 0 AND composite_fundamental_score <= 1),
  rating_label fundamental_rating_enum NOT NULL,
  valuation_label fundamental_valuation_enum NOT NULL,
  direction_label fundamental_direction_enum NOT NULL,
  regime_label fundamental_regime_enum NOT NULL,
  reason_codes TEXT[] NOT NULL DEFAULT '{}',
  score_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticker, as_of)
);

CREATE INDEX IF NOT EXISTS idx_fundamental_scores_rank ON fundamental_scores (as_of DESC, composite_fundamental_score DESC, final_confidence DESC);

CREATE TABLE IF NOT EXISTS fundamental_states (
  state_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker TEXT NOT NULL REFERENCES coverage_universe(ticker) ON DELETE CASCADE,
  as_of TIMESTAMPTZ NOT NULL,
  sector TEXT NOT NULL,
  rank_in_sector INTEGER NOT NULL CHECK (rank_in_sector >= 1),
  rank_global INTEGER NOT NULL CHECK (rank_global >= 1),
  composite_fundamental_score NUMERIC(10,6) NOT NULL CHECK (composite_fundamental_score >= 0 AND composite_fundamental_score <= 1),
  confidence NUMERIC(10,6) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  score_delta_30d NUMERIC(10,6) NOT NULL,
  rating_label fundamental_rating_enum NOT NULL,
  valuation_label fundamental_valuation_enum NOT NULL,
  direction_label fundamental_direction_enum NOT NULL,
  regime_label fundamental_regime_enum NOT NULL,
  top_strengths TEXT[] NOT NULL DEFAULT '{}',
  top_weaknesses TEXT[] NOT NULL DEFAULT '{}',
  state_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticker, as_of)
);

CREATE INDEX IF NOT EXISTS idx_fundamental_states_sector_rank ON fundamental_states (as_of DESC, sector, rank_in_sector);

CREATE TABLE IF NOT EXISTS factor_outcomes (
  outcome_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker TEXT NOT NULL REFERENCES coverage_universe(ticker) ON DELETE CASCADE,
  as_of TIMESTAMPTZ NOT NULL,
  score_id UUID REFERENCES fundamental_scores(score_id) ON DELETE SET NULL,
  horizon_1m_return NUMERIC(12,6),
  horizon_3m_return NUMERIC(12,6),
  horizon_6m_return NUMERIC(12,6),
  horizon_12m_return NUMERIC(12,6),
  max_drawdown_3m NUMERIC(12,6),
  max_drawdown_6m NUMERIC(12,6),
  earnings_follow_through_score NUMERIC(10,6),
  strategist_value_add NUMERIC(12,6),
  outcome_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_factor_outcomes_ticker_asof ON factor_outcomes (ticker, as_of DESC);
