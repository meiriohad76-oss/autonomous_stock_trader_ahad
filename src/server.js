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

function listen() {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const databaseTarget =
        app.config.databaseProvider === "postgres"
          ? app.config.databaseUrl || "unconfigured"
          : app.config.databasePath;
      app.setStartupStatus({ http_listening: true, phase: "http_listening" });
      console.log(`Sentiment Analyst listening on http://${app.config.host}:${app.config.port}`);
      console.log(`Persistence provider: ${app.config.databaseProvider} (${databaseTarget})`);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(app.config.port, app.config.host);
  });
}

async function start() {
  await listen();

  try {
    app.setStartupStatus({ phase: "initializing" });
    await app.initialize();
    if (app.config.seedDataOnEmpty && (!(await app.hasPersistedData()) || !app.hasDashboardData(app.config.defaultWindow))) {
      app.setStartupStatus({ phase: "replaying_seed_data" });
      await app.replay({ reset: false, intervalMs: 180, skipFundamentals: true });
    }
    app.setStartupStatus({ initialized: true, phase: "starting_live_sources", last_error: null });
  } catch (error) {
    app.setStartupStatus({ phase: "initialization_failed", last_error: error.message });
    console.error("Failed to initialize Sentiment Analyst:", error);
    server.close(() => process.exit(1));
    return;
  }

  app.startLiveSources()
    .then(() => {
      app.setStartupStatus({ live_sources_started: true, phase: "running", last_error: null });
    })
    .catch((error) => {
      app.setStartupStatus({ live_sources_started: false, phase: "running_with_live_source_error", last_error: error.message });
      console.error("Live source startup failed:", error);
    });
}

start().catch((error) => {
  app.setStartupStatus({ phase: "startup_failed", last_error: error.message });
  if (error.code === "EADDRINUSE") {
    console.error(`Failed to start Sentiment Analyst: ${app.config.host}:${app.config.port} is already in use.`);
  } else {
    console.error("Failed to start Sentiment Analyst:", error);
  }
  process.exitCode = 1;
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
