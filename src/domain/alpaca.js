const PAPER_BASE = "https://paper-api.alpaca.markets";
const LIVE_BASE = "https://api.alpaca.markets";

export function createAlpacaClient(config) {
  const base = config.alpacaPaper ? PAPER_BASE : LIVE_BASE;
  const headers = {
    "APCA-API-KEY-ID": config.alpacaApiKey,
    "APCA-API-SECRET-KEY": config.alpacaApiSecret,
    "Content-Type": "application/json",
    "User-Agent": "SentimentAnalyst/1.0 (+execution)"
  };

  async function request(method, path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${base}${path}`, {
        method,
        headers,
        signal: controller.signal,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Alpaca ${method} ${path} → ${response.status}: ${text}`);
      }
      if (response.status === 204) return null;
      return response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    getAccount: () => request("GET", "/v2/account"),
    getPositions: () => request("GET", "/v2/positions"),
    placeOrder: (params) => request("POST", "/v2/orders", params),
    cancelOrder: (orderId) => request("DELETE", `/v2/orders/${orderId}`),
    getOrders: (status = "all") => request("GET", `/v2/orders?status=${status}&limit=200`)
  };
}
