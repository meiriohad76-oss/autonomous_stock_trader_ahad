import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { parse } from "node:url";
import { parseJsonBody, sendJson, sendText } from "../utils/helpers.js";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function sseWrite(response, event) {
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function serveStaticFile(publicDir, response, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.join(publicDir, requested);

  try {
    const fileInfo = await stat(filePath);
    if (!fileInfo.isFile()) {
      sendText(response, 404, "Not Found");
      return;
    }

    const extension = path.extname(filePath);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    createReadStream(filePath).pipe(response);
  } catch {
    sendText(response, 404, "Not Found");
  }
}

export async function routeRequest(app, request, response) {
  const { pathname, query } = parse(request.url, true);

  if (pathname === "/api/health" && request.method === "GET") {
    sendJson(response, 200, app.getHealth());
    return;
  }

  if (pathname === "/api/ready" && request.method === "GET") {
    const readiness = app.getReadiness();
    sendJson(response, readiness.ready ? 200 : 503, readiness);
    return;
  }

  if (pathname === "/api/performance" && request.method === "GET") {
    sendJson(response, 200, app.getPerformance());
    return;
  }

  if (pathname === "/api/runtime-reliability" && request.method === "GET") {
    sendJson(response, 200, app.getRuntimeReliability());
    return;
  }

  if (pathname === "/api/runtime-reliability/actions" && request.method === "POST") {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", async () => {
      try {
        const payload = parseJsonBody(body) || {};
        const result = await app.runRuntimeReliabilityAction(payload);
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error.message });
      }
    });
    return;
  }

  if (pathname === "/api/config" && request.method === "GET") {
    sendJson(response, 200, app.getConfig());
    return;
  }

  if (pathname === "/api/settings/market-flow" && request.method === "GET") {
    sendJson(response, 200, app.getMarketFlowSettings());
    return;
  }

  if (pathname === "/api/settings/market-flow" && request.method === "POST") {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", async () => {
      try {
        const payload = parseJsonBody(body) || {};
        const settings = await app.updateMarketFlowSettings(payload, {
          persist: String(payload.persist ?? "true").toLowerCase() !== "false"
        });
        sendJson(response, 200, { ok: true, settings });
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error.message });
      }
    });
    return;
  }

  if (pathname === "/api/settings/fundamental-screener" && request.method === "GET") {
    sendJson(response, 200, app.getScreenerSettings());
    return;
  }

  if (pathname === "/api/settings/fundamental-screener" && request.method === "POST") {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", async () => {
      try {
        const payload = parseJsonBody(body) || {};
        const screener = await app.updateScreenerSettings(payload, {
          persist: String(payload.persist ?? "true").toLowerCase() !== "false"
        });
        sendJson(response, 200, { ok: true, screener });
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error.message });
      }
    });
    return;
  }

  if (pathname === "/api/fundamentals/dashboard" && request.method === "GET") {
    sendJson(response, 200, app.getFundamentalsSnapshot({
      sector: query.sector || null,
      minConfidence: query.minConfidence ? Number(query.minConfidence) : null,
      search: query.search || "",
      onlyChanged: String(query.onlyChanged || "false").toLowerCase() === "true",
      screenStage: query.screenStage || null
    }));
    return;
  }

  if (pathname === "/api/fundamentals/changes" && request.method === "GET") {
    sendJson(response, 200, app.getFundamentalsChanges(query.limit ? Number(query.limit) : 12));
    return;
  }

  if (pathname === "/api/fundamentals/sec-queue" && request.method === "GET") {
    sendJson(response, 200, app.getSecFundamentalsQueue({
      limit: query.limit ? Number(query.limit) : 20
    }));
    return;
  }

  if (pathname === "/api/fundamentals/refresh" && request.method === "POST") {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", async () => {
      try {
        const payload = parseJsonBody(body) || {};
        const result = await app.refreshFundamentals({
          forceUniverse: String(payload.forceUniverse ?? "false").toLowerCase() === "true"
        });
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, 500, { ok: false, error: error.message });
      }
    });
    return;
  }

  if (pathname === "/api/fundamentals/storage/summary" && request.method === "GET") {
    sendJson(response, 200, app.getFundamentalPersistenceSummary());
    return;
  }

  if (pathname?.startsWith("/api/fundamentals/storage/ticker/") && pathname?.endsWith("/filings") && request.method === "GET") {
    const parts = pathname.split("/");
    const ticker = decodeURIComponent(parts[parts.length - 2]).toUpperCase();
    sendJson(response, 200, {
      ticker,
      filings: app.getFundamentalPersistenceFilings(ticker, query.limit ? Number(query.limit) : 10)
    });
    return;
  }

  if (pathname?.startsWith("/api/fundamentals/storage/ticker/") && pathname?.includes("/facts/") && request.method === "GET") {
    const parts = pathname.split("/");
    const ticker = decodeURIComponent(parts[parts.length - 3]).toUpperCase();
    const canonicalField = decodeURIComponent(parts[parts.length - 1]);
    sendJson(response, 200, {
      ticker,
      canonical_field: canonicalField,
      series: app.getFundamentalPersistenceFactSeries(ticker, canonicalField, {
        periodType: query.periodType || null,
        limit: query.limit ? Number(query.limit) : 12
      })
    });
    return;
  }

  if (pathname?.startsWith("/api/fundamentals/storage/ticker/") && request.method === "GET") {
    const ticker = decodeURIComponent(pathname.split("/").pop()).toUpperCase();
    sendJson(response, 200, app.getFundamentalPersistenceTicker(ticker));
    return;
  }

  if (pathname?.startsWith("/api/fundamentals/ticker/") && request.method === "GET") {
    const ticker = decodeURIComponent(pathname.split("/").pop()).toUpperCase();
    const detail = app.getFundamentalsTickerDetail(ticker);
    if (!detail) {
      sendJson(response, 404, { error: `Fundamental snapshot for ${ticker} not found` });
      return;
    }
    sendJson(response, 200, detail);
    return;
  }

  if (pathname?.startsWith("/api/fundamentals/sector/") && request.method === "GET") {
    const sector = decodeURIComponent(pathname.split("/").pop());
    const detail = app.getFundamentalsSectorDetail(sector);
    if (!detail) {
      sendJson(response, 404, { error: `Fundamental sector ${sector} not found` });
      return;
    }
    sendJson(response, 200, detail);
    return;
  }

  if (pathname === "/api/sentiment/watchlist" && request.method === "GET") {
    sendJson(response, 200, app.getWatchlistSnapshot(query.window || app.config.defaultWindow, {
      label: query.label || null,
      minConfidence: query.minConfidence ? Number(query.minConfidence) : null,
      screenStage: query.screenStage || null
    }));
    return;
  }

  if (pathname?.startsWith("/api/sentiment/ticker/") && request.method === "GET") {
    const ticker = decodeURIComponent(pathname.split("/").pop()).toUpperCase();
    const detail = await app.getTickerDetail(ticker);
    if (!detail) {
      sendJson(response, 404, { error: `Ticker ${ticker} not found` });
      return;
    }
    sendJson(response, 200, detail);
    return;
  }

  if (pathname?.startsWith("/api/sentiment/sector/") && request.method === "GET") {
    const sector = decodeURIComponent(pathname.split("/").pop());
    const detail = app.getSectorDetail(sector);
    if (!detail) {
      sendJson(response, 404, { error: `Sector ${sector} not found` });
      return;
    }
    sendJson(response, 200, detail);
    return;
  }

  if (pathname === "/api/news/recent" && request.method === "GET") {
    sendJson(response, 200, app.getRecentDocuments({
      ticker: query.ticker ? String(query.ticker).toUpperCase() : null,
      limit: query.limit ? Number(query.limit) : 20
    }));
    return;
  }

  if (pathname === "/api/events/high-impact" && request.method === "GET") {
    sendJson(response, 200, app.getHighImpactEvents(query.limit ? Number(query.limit) : 10));
    return;
  }

  if (pathname === "/api/evidence-quality" && request.method === "GET") {
    sendJson(response, 200, app.getEvidenceQuality({
      ticker: query.ticker ? String(query.ticker).toUpperCase() : null,
      tier: query.tier || null,
      limit: query.limit ? Number(query.limit) : 50
    }));
    return;
  }

  if (pathname === "/api/macro-regime" && request.method === "GET") {
    sendJson(response, 200, app.getMacroRegime({
      window: query.window || app.config.defaultWindow
    }));
    return;
  }

  if (pathname === "/api/macro-regime/history" && request.method === "GET") {
    sendJson(response, 200, {
      history: app.getMacroRegimeHistory(query.limit ? Number(query.limit) : 20)
    });
    return;
  }

  if (pathname === "/api/trade-setups" && request.method === "GET") {
    sendJson(response, 200, app.getTradeSetups({
      window: query.window || app.config.defaultWindow,
      limit: query.limit ? Number(query.limit) : 12,
      minConviction: query.minConviction ? Number(query.minConviction) : 0.35,
      action: query.action || null
    }));
    return;
  }

  if (pathname === "/api/trading-workflow/status" && request.method === "GET") {
    try {
      sendJson(response, 200, await app.getTradingWorkflowStatus({
        window: query.window || app.config.defaultWindow,
        limit: query.limit ? Number(query.limit) : 25,
        minConviction: query.minConviction !== undefined ? Number(query.minConviction) : undefined
      }));
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/trade-setups/storage/summary" && request.method === "GET") {
    sendJson(response, 200, app.getTradeSetupStorageSummary());
    return;
  }

  if (pathname?.startsWith("/api/trade-setups/storage/ticker/") && request.method === "GET") {
    const ticker = decodeURIComponent(pathname.split("/").pop()).toUpperCase();
    sendJson(response, 200, {
      ticker,
      setups: app.getTradeSetupStorageTicker(ticker, query.limit ? Number(query.limit) : 20)
    });
    return;
  }

  if (pathname?.startsWith("/api/trade-setups/ticker/") && request.method === "GET") {
    const ticker = decodeURIComponent(pathname.split("/").pop()).toUpperCase();
    const detail = app.getTradeSetupTicker(ticker, {
      window: query.window || app.config.defaultWindow
    });
    if (!detail) {
      sendJson(response, 404, { error: `Trade setup for ${ticker} not found` });
      return;
    }
    sendJson(response, 200, detail);
    return;
  }

  if (pathname === "/api/execution/status" && request.method === "GET") {
    sendJson(response, 200, app.getExecutionStatus());
    return;
  }

  if (pathname === "/api/risk/status" && request.method === "GET") {
    try {
      sendJson(response, 200, await app.getRiskSnapshot());
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/risk/evaluate" && request.method === "POST") {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", async () => {
      try {
        const payload = parseJsonBody(body) || {};
        sendJson(response, 200, await app.evaluateExecutionRisk(payload));
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error.message });
      }
    });
    return;
  }

  if (pathname === "/api/positions/monitor" && request.method === "GET") {
    try {
      sendJson(response, 200, await app.getPositionMonitor({
        window: query.window || app.config.defaultWindow,
        limit: query.limit ? Number(query.limit) : 25
      }));
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/execution/account" && request.method === "GET") {
    try {
      sendJson(response, 200, await app.getBrokerAccount());
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/execution/positions" && request.method === "GET") {
    try {
      sendJson(response, 200, await app.getBrokerPositions());
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/execution/orders" && request.method === "GET") {
    try {
      sendJson(response, 200, await app.getBrokerOrders({
        status: query.status || "open",
        limit: query.limit ? Number(query.limit) : 50,
        nested: String(query.nested || "false").toLowerCase() === "true",
        symbols: query.symbols || null
      }));
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/execution/preview" && request.method === "POST") {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", async () => {
      try {
        const payload = parseJsonBody(body) || {};
        sendJson(response, 200, await app.previewExecutionOrder(payload));
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error.message });
      }
    });
    return;
  }

  if (pathname === "/api/execution/orders" && request.method === "POST") {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", async () => {
      try {
        const payload = parseJsonBody(body) || {};
        sendJson(response, 200, await app.submitExecutionOrder(payload));
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error.message });
      }
    });
    return;
  }

  if (pathname === "/api/replay" && request.method === "POST") {
    let options = {};
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", async () => {
      options = parseJsonBody(body) || {};
      if (!app.config.seedDataInDecisions) {
        sendJson(response, 403, {
          status: "blocked",
          reason: "seed_data_disabled",
          message: "Sample replay is disabled for decision data. Set SEED_DATA_IN_DECISIONS=true only for offline testing."
        });
        return;
      }
      app.replay({
        reset: true,
        intervalMs: options.interval_ms ?? 350,
        preserveFundamentals: true
      }).catch(() => undefined);
      sendJson(response, 202, { status: "accepted" });
    });
    return;
  }

  if (pathname === "/api/stream" && request.method === "GET") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive"
    });

    response.write(": connected\n\n");
    sseWrite(response, {
      type: "snapshot",
      health: app.getHealth(),
      watchlist: app.getWatchlistSnapshot(app.config.defaultWindow),
      fundamentals: app.getFundamentalsSnapshot()
    });

    const listener = (event) => sseWrite(response, event);
    app.store.bus.on("event", listener);
    request.on("close", () => {
      app.store.bus.off("event", listener);
    });
    return;
  }

  await serveStaticFile(app.config.publicDir, response, pathname);
}
