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

server.listen(app.config.port, app.config.host, async () => {
  await app.initialize();
  if (!(await app.hasPersistedData())) {
    await app.replay({ reset: true, intervalMs: 180, skipFundamentals: true });
  }
  await app.startLiveSources();
  const databaseTarget =
    app.config.databaseProvider === "postgres"
      ? app.config.databaseUrl || "unconfigured"
      : app.config.databasePath;
  console.log(`Sentiment Analyst listening on http://${app.config.host}:${app.config.port}`);
  console.log(`Persistence provider: ${app.config.databaseProvider} (${databaseTarget})`);
});

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
