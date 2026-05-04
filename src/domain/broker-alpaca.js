function normalizedMode(config) {
  return String(config.brokerTradingMode || "paper").toLowerCase() === "live" ? "live" : "paper";
}

function baseUrlForMode(config) {
  return normalizedMode(config) === "live" ? config.alpacaLiveBaseUrl : config.alpacaPaperBaseUrl;
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function hasCredentials(config) {
  return Boolean(config.alpacaApiKeyId && config.alpacaApiSecretKey);
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export function buildAlpacaBrokerStatus(config) {
  const mode = normalizedMode(config);
  const configured = hasCredentials(config);
  const liveBlocked = mode === "live" && !config.alpacaAllowLiveTrading;

  return {
    provider: "alpaca",
    adapter: "rest",
    mode,
    base_url: trimTrailingSlash(baseUrlForMode(config)),
    configured,
    submit_enabled: Boolean(config.brokerSubmitEnabled),
    live_trading_allowed: Boolean(config.alpacaAllowLiveTrading),
    ready_for_account_calls: configured,
    ready_for_order_submission: configured && config.brokerSubmitEnabled && !liveBlocked,
    blocked_reason: !configured
      ? "missing_alpaca_credentials"
      : liveBlocked
        ? "live_trading_requires_ALPACA_ALLOW_LIVE_TRADING_true"
        : config.brokerSubmitEnabled
          ? null
          : "BROKER_SUBMIT_ENABLED_is_false"
  };
}

export function createAlpacaBroker({ config }) {
  const readCache = new Map();

  function cacheKeyFor(method, url) {
    const ttlMs = Number(config.brokerReadCacheMs || 0);
    if (method !== "GET" || !Number.isFinite(ttlMs) || ttlMs <= 0) {
      return null;
    }
    return `${normalizedMode(config)}:${url.pathname}?${url.searchParams.toString()}`;
  }

  function getCachedRead(cacheKey) {
    if (!cacheKey) {
      return null;
    }
    const entry = readCache.get(cacheKey);
    if (!entry) {
      return null;
    }
    const ttlMs = Number(config.brokerReadCacheMs || 0);
    const expired = !entry.pending && Date.now() - entry.createdAt > ttlMs;
    if (expired) {
      readCache.delete(cacheKey);
      return null;
    }
    return entry.promise;
  }

  function rememberRead(cacheKey, promise) {
    if (!cacheKey) {
      return promise;
    }
    const entry = { createdAt: Date.now(), pending: true, promise };
    readCache.set(cacheKey, entry);
    promise
      .then(() => {
        entry.pending = false;
        entry.createdAt = Date.now();
      })
      .catch(() => {
        readCache.delete(cacheKey);
      });
    return promise;
  }

  async function request(pathname, { method = "GET", query = null, body = null } = {}) {
    if (!hasCredentials(config)) {
      throw new Error("Alpaca credentials are missing. Set ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY.");
    }

    const url = new URL(`${trimTrailingSlash(baseUrlForMode(config))}${pathname}`);
    if (query) {
      Object.entries(query).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, String(value));
        }
      });
    }

    const cacheKey = cacheKeyFor(method, url);
    const cached = getCachedRead(cacheKey);
    if (cached) {
      return cached;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.brokerRequestTimeoutMs);

    const requestPromise = (async () => {
      const response = await fetch(url, {
        method,
        headers: {
          "APCA-API-KEY-ID": config.alpacaApiKeyId,
          "APCA-API-SECRET-KEY": config.alpacaApiSecretKey,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      const payload = await parseResponse(response);

      if (!response.ok) {
        const message = payload?.message || payload?.error || response.statusText || "Alpaca request failed";
        const error = new Error(`Alpaca ${method} ${pathname} failed: ${message}`);
        error.status = response.status;
        error.payload = payload;
        throw error;
      }

      if (method !== "GET") {
        readCache.clear();
      }

      return payload;
    })();

    try {
      return await rememberRead(cacheKey, requestPromise);
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    getStatus() {
      return buildAlpacaBrokerStatus(config);
    },
    async getAccount() {
      return request("/v2/account");
    },
    async getPositions() {
      return request("/v2/positions");
    },
    async getOrders({ status = "open", limit = 50, nested = false, symbols = null } = {}) {
      return request("/v2/orders", {
        query: {
          status,
          limit,
          nested,
          symbols
        }
      });
    },
    async submitOrder(order) {
      return request("/v2/orders", {
        method: "POST",
        body: order
      });
    }
  };
}
