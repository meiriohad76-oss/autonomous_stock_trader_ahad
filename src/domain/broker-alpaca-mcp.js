import {
  buildAlpacaMcpStatus,
  callAlpacaMcpTool,
  mapStockOrderToMcpArgs
} from "./alpaca-mcp-client.js";

function normalizeOrderSymbols(symbols) {
  if (Array.isArray(symbols)) {
    return symbols.filter(Boolean).join(",");
  }
  return symbols || undefined;
}

export function createAlpacaMcpBroker({ config }) {
  return {
    getStatus() {
      return buildAlpacaMcpStatus(config);
    },
    async getAccount() {
      return callAlpacaMcpTool(config, "get_account_info");
    },
    async getPositions() {
      return callAlpacaMcpTool(config, "get_all_positions");
    },
    async getOrders({ status = "open", limit = 50, nested = false, symbols = null } = {}) {
      return callAlpacaMcpTool(config, "get_orders", {
        status,
        limit,
        nested,
        symbols: normalizeOrderSymbols(symbols)
      });
    },
    async submitOrder(order) {
      return callAlpacaMcpTool(config, "place_stock_order", mapStockOrderToMcpArgs(order));
    }
  };
}
