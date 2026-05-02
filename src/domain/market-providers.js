export function hasTwelveDataAccess(config) {
  return Boolean(config?.twelveDataApiKey);
}

export function hasAlpacaMarketDataAccess(config) {
  return Boolean(
    config?.alpacaMarketDataEnabled &&
      config?.alpacaMarketDataApiKeyId &&
      config?.alpacaMarketDataApiSecretKey
  );
}

export function isLiveMarketProviderConfigured(config, provider = config?.marketDataProvider) {
  if (provider === "twelvedata") {
    return hasTwelveDataAccess(config);
  }
  if (provider === "alpaca") {
    return hasAlpacaMarketDataAccess(config);
  }
  return provider === "synthetic";
}

export function marketProviderMissingConfigReason(provider, purpose = "live market data") {
  if (provider === "alpaca") {
    return `${purpose} needs Alpaca market data credentials. Set ALPACA_API_KEY/ALPACA_SECRET_KEY or ALPACA_API_KEY_ID/ALPACA_API_SECRET_KEY.`;
  }
  if (provider === "twelvedata") {
    return `${purpose} needs TWELVE_DATA_API_KEY.`;
  }
  return null;
}

export function liveMarketDataStatus(config, provider = config?.marketDataProvider) {
  return {
    provider,
    configured: isLiveMarketProviderConfigured(config, provider),
    fallback_mode: provider === "synthetic" || !isLiveMarketProviderConfigured(config, provider),
    feed:
      provider === "alpaca"
        ? config?.alpacaMarketDataFeed || "iex"
        : provider === "twelvedata"
          ? config?.marketDataInterval || null
          : null,
    missing_config_reason: marketProviderMissingConfigReason(provider)
  };
}

export function alpacaHeaders(config) {
  return {
    "APCA-API-KEY-ID": config.alpacaMarketDataApiKeyId,
    "APCA-API-SECRET-KEY": config.alpacaMarketDataApiSecretKey,
    Accept: "application/json",
    "User-Agent": "SentimentAnalyst/1.0 (+alpaca market data)"
  };
}

export function normalizeAlpacaTimeframe(interval = "15min") {
  const normalized = String(interval || "15min").trim().toLowerCase();
  const match = normalized.match(/^(\d+)\s*(min|m|minute|minutes|h|hr|hour|hours|d|day|days)$/);
  if (!match) {
    return "15Min";
  }

  const value = Math.max(1, Number(match[1] || 1));
  const unit = match[2];
  if (["min", "m", "minute", "minutes"].includes(unit)) {
    return `${value}Min`;
  }
  if (["h", "hr", "hour", "hours"].includes(unit)) {
    return `${value}Hour`;
  }
  return `${value}Day`;
}

export function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}
