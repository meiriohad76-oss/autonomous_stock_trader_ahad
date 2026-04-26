import { createServer } from "node:http";
import { createSentimentApp } from "./app.js";
import { routeRequest } from "./http/router.js";

const app = createSentimentApp();
const server = createServer((request, response) => {
  routeRequest(app, request, response).catch((error) => {
    response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: error.message }, null, 2));
  });
});

function databaseTargetLabel() {
  return app.config.databaseProvider === "postgres"
    ? app.config.databaseUrl || "unconfigured"
    : app.config.databasePath;
}

async function start() {
  await app.initialize();
  if (!(await app.hasPersistedData())) {
    await app.replay({ reset: true, intervalMs: 180 });
  }
  await app.startLiveSources();

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(app.config.port, app.config.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  console.log(`Sentiment Analyst listening on http://${app.config.host}:${app.config.port}`);
  if (app.config.publicBaseUrl) {
    console.log(`Public URL: ${app.config.publicBaseUrl}`);
  }
  console.log(`Deployment target: ${app.config.deploymentTarget || "local"}`);
  console.log(`Tunnel provider: ${app.config.tunnelProvider || "none"}`);
  console.log(`SSE heartbeat: ${app.config.sseHeartbeatMs}ms`);
  console.log(`Persistence provider: ${app.config.databaseProvider} (${databaseTargetLabel()})`);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    app.stopLiveSources()
      .catch((error) => {
        console.error("Failed to stop live sources cleanly:", error);
      })
      .finally(() => {
        server.close(() => process.exit(0));
      });
  });
}

start().catch((error) => {
  console.error("Failed to start Sentiment Analyst:", error);
  process.exit(1);
});
