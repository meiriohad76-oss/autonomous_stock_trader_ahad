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

function sseHeartbeat(response) {
  response.write(`: heartbeat ${Date.now()}\n\n`);
}

async function serveStaticFile(publicDir, response, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const publicRoot = path.resolve(publicDir);
  const filePath = path.resolve(publicRoot, requested);

  try {
    if (!filePath.startsWith(`${publicRoot}${path.sep}`) && filePath !== publicRoot) {
      sendText(response, 403, "Forbidden");
      return;
    }

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

  if (!app.config.dashboardMutationsEnabled && request.method !== "GET" && pathname !== "/api/stream") {
    sendJson(response, 403, {
      ok: false,
      error: "Dashboard mutations are disabled for this deployment."
    });
    return;
  }

  if (pathname === "/api/health" && request.method === "GET") {
    sendJson(response, 200, app.getHealth());
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

  if (pathname === "/api/fundamentals/dashboard" && request.method === "GET") {
    sendJson(response, 200, app.getFundamentalsSnapshot({
      sector: query.sector || null,
      minConfidence: query.minConfidence ? Number(query.minConfidence) : null,
      search: query.search || "",
      onlyChanged: String(query.onlyChanged || "false").toLowerCase() === "true"
    }));
    return;
  }

  if (pathname === "/api/fundamentals/changes" && request.method === "GET") {
    sendJson(response, 200, app.getFundamentalsChanges(query.limit ? Number(query.limit) : 12));
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
      minConfidence: query.minConfidence ? Number(query.minConfidence) : null
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

  if (pathname === "/api/money-flow" && request.method === "GET") {
    sendJson(response, 200, app.getMoneyFlowSnapshot({
      hours: query.hours ? Number(query.hours) : 48,
      limit: query.limit ? Number(query.limit) : 120
    }));
    return;
  }

  if (pathname?.startsWith("/api/money-flow/ticker/") && request.method === "GET") {
    const ticker = decodeURIComponent(pathname.split("/").pop()).toUpperCase();
    const detail = app.getMoneyFlowTickerDetail(ticker, {
      hours: query.hours ? Number(query.hours) : 168,
      limit: query.limit ? Number(query.limit) : 60
    });
    if (!detail) {
      sendJson(response, 404, { error: `Money flow detail for ${ticker} not found` });
      return;
    }
    sendJson(response, 200, detail);
    return;
  }

  if (pathname === "/api/events/high-impact" && request.method === "GET") {
    sendJson(response, 200, app.getHighImpactEvents(query.limit ? Number(query.limit) : 10));
    return;
  }

  if (pathname === "/api/macro-regime" && request.method === "GET") {
    const regime = app.getMacroRegime();
    if (!regime) {
      response.writeHead(204);
      response.end();
      return;
    }
    sendJson(response, 200, regime);
    return;
  }

  if (pathname === "/api/trade-setups" && request.method === "GET") {
    const filters = {
      action: query.action || null,
      minConviction: query.minConviction ? Number(query.minConviction) : null,
      provisional: query.provisional !== undefined ? String(query.provisional) === "true" : null
    };
    const setups = app.getTradeSetups(filters);
    sendJson(response, 200, {
      as_of: new Date().toISOString(),
      macro_regime: app.getMacroRegime(),
      count: setups.length,
      setups
    });
    return;
  }

  if (pathname?.startsWith("/api/trade-setups/ticker/") && request.method === "GET") {
    const ticker = decodeURIComponent(pathname.split("/").pop()).toUpperCase();
    const setup = app.getTradeSetupDetail(ticker);
    if (!setup) {
      sendJson(response, 404, { error: `Trade setup for ${ticker} not found` });
      return;
    }
    sendJson(response, 200, setup);
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
      app.replay({ reset: true, intervalMs: options.interval_ms ?? 350 }).catch(() => undefined);
      sendJson(response, 202, { status: "accepted" });
    });
    return;
  }

  if (pathname === "/api/stream" && request.method === "GET") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    response.write(": connected\n\n");
    sseWrite(response, {
      type: "snapshot",
      health: app.getHealth(),
      watchlist: app.getWatchlistSnapshot(app.config.defaultWindow),
      fundamentals: app.getFundamentalsSnapshot(),
      macro_regime: app.getMacroRegime(),
      trade_setups: app.getTradeSetups()
    });

    const listener = (event) => sseWrite(response, event);
    app.store.bus.on("event", listener);
    const heartbeat = setInterval(() => sseHeartbeat(response), Math.max(5000, app.config.sseHeartbeatMs || 25000));
    request.on("close", () => {
      clearInterval(heartbeat);
      app.store.bus.off("event", listener);
    });
    return;
  }

  await serveStaticFile(app.config.publicDir, response, pathname);
}
