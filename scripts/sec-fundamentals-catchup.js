import { setTimeout as sleep } from "node:timers/promises";

const DEFAULT_MAX_BATCHES = 5;
const DEFAULT_DELAY_MS = 2000;
const DEFAULT_STOP_ON_ERROR_BATCHES = 2;

function usage() {
  return `
SEC fundamentals catch-up helper

Usage:
  node scripts/sec-fundamentals-catchup.js [options]

Options:
  --max-batches <n>          Max SEC batches to run. Default: ${DEFAULT_MAX_BATCHES}
  --delay-ms <n>             Delay between batches. Default: ${DEFAULT_DELAY_MS}
  --stop-on-error-batches <n> Stop after this many consecutive error-only batches. Default: ${DEFAULT_STOP_ON_ERROR_BATCHES}
  --force-universe           Rebuild the tracked universe before the first batch.
  --help                     Show this help.

Example:
  npm run sec:catchup -- --max-batches 5 --delay-ms 2000
`.trim();
}

function readOptionValue(argv, index, flag) {
  const arg = argv[index];
  const inlinePrefix = `${flag}=`;
  if (arg.startsWith(inlinePrefix)) {
    return { value: arg.slice(inlinePrefix.length), nextIndex: index };
  }
  return { value: argv[index + 1], nextIndex: index + 1 };
}

function parsePositiveInteger(value, label, { allowZero = false } = {}) {
  if (value === undefined || value === "") {
    throw new Error(`${label} requires a value.`);
  }
  const parsed = Number(value);
  const isValid = Number.isInteger(parsed) && (allowZero ? parsed >= 0 : parsed > 0);
  if (!isValid) {
    throw new Error(`${label} must be ${allowZero ? "zero or a positive" : "a positive"} integer.`);
  }
  return parsed;
}

function parseArgs(argv) {
  const options = {
    maxBatches: DEFAULT_MAX_BATCHES,
    delayMs: DEFAULT_DELAY_MS,
    stopOnErrorBatches: DEFAULT_STOP_ON_ERROR_BATCHES,
    forceUniverse: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--force-universe") {
      options.forceUniverse = true;
    } else if (arg === "--max-batches" || arg.startsWith("--max-batches=")) {
      const parsed = readOptionValue(argv, index, "--max-batches");
      options.maxBatches = parsePositiveInteger(parsed.value, "--max-batches", { allowZero: true });
      index = parsed.nextIndex;
    } else if (arg === "--delay-ms" || arg.startsWith("--delay-ms=")) {
      const parsed = readOptionValue(argv, index, "--delay-ms");
      options.delayMs = parsePositiveInteger(parsed.value, "--delay-ms", { allowZero: true });
      index = parsed.nextIndex;
    } else if (arg === "--stop-on-error-batches" || arg.startsWith("--stop-on-error-batches=")) {
      const parsed = readOptionValue(argv, index, "--stop-on-error-batches");
      options.stopOnErrorBatches = parsePositiveInteger(parsed.value, "--stop-on-error-batches", { allowZero: true });
      index = parsed.nextIndex;
    } else {
      throw new Error(`Unknown option: ${arg}\n\n${usage()}`);
    }
  }

  return options;
}

function readSecHealth(response) {
  return response?.health?.live_sources?.sec_fundamentals || null;
}

function summarizeBatch(batchNumber, response) {
  const result = response?.result || {};
  const secHealth = readSecHealth(response) || {};
  return {
    batch: batchNumber,
    ingested: Number(result.ingested || 0),
    errors: Number(result.errors || 0),
    live_companies: Number(result.liveCompanies ?? secHealth.live_companies ?? 0),
    pending_live_sec_companies: Number(
      result.pendingLiveSecCompanies ??
        secHealth.pending_live_sec_companies ??
        result.pendingBootstrapCompanies ??
        secHealth.pending_bootstrap_companies ??
        0
    ),
    refresh_batch_size: Number(result.refreshBatchSize ?? secHealth.refresh_batch_size ?? 0),
    refresh_limit: Number(result.refreshLimit ?? secHealth.refresh_limit ?? 0),
    lightweight_state_saved: Boolean(result.lightweight_state_saved),
    runtime_status: response?.runtime_reliability?.status || null
  };
}

function logBatchProgress(summary) {
  console.error(
    [
      `batch=${summary.batch}`,
      `ingested=${summary.ingested}`,
      `errors=${summary.errors}`,
      `live=${summary.live_companies}`,
      `pending=${summary.pending_live_sec_companies}`,
      `selected=${summary.refresh_batch_size}/${summary.refresh_limit || "?"}`,
      `runtime=${summary.runtime_status || "unknown"}`,
      summary.lightweight_state_saved ? "state=saved" : "state=not-saved"
    ].join(" ")
  );
}

async function runCatchup(options) {
  const { createSentimentApp } = await import("../src/app.js");
  const app = createSentimentApp();
  const batches = [];
  let stopReason = options.maxBatches === 0 ? "max_batches_zero" : "max_batches_reached";
  let consecutiveErrorOnlyBatches = 0;

  try {
    await app.initialize();

    for (let batchNumber = 1; batchNumber <= options.maxBatches; batchNumber += 1) {
      const response = await app.runRuntimeReliabilityAction({
        action: "poll_once",
        source: "sec_fundamentals",
        forceUniverse: options.forceUniverse && batchNumber === 1
      });
      const summary = summarizeBatch(batchNumber, response);
      batches.push(summary);
      logBatchProgress(summary);

      if (summary.pending_live_sec_companies === 0) {
        stopReason = "complete";
        break;
      }

      if (summary.errors > 0 && summary.ingested === 0) {
        consecutiveErrorOnlyBatches += 1;
      } else {
        consecutiveErrorOnlyBatches = 0;
      }

      if (
        options.stopOnErrorBatches > 0 &&
        consecutiveErrorOnlyBatches >= options.stopOnErrorBatches
      ) {
        stopReason = "error_only_batches";
        break;
      }

      if (batchNumber < options.maxBatches && options.delayMs > 0) {
        await sleep(options.delayMs);
      }
    }

    const health = app.getHealth();
    const runtimeReliability = app.getRuntimeReliability();
    return {
      status: stopReason === "complete" ? "complete" : "partial",
      stop_reason: stopReason,
      options,
      batches,
      final_sec_fundamentals: health.live_sources?.sec_fundamentals || null,
      runtime_reliability: {
        status: runtimeReliability.status,
        summary: runtimeReliability.summary
      },
      lightweight_state: health.live_sources?.lightweight_state || null
    };
  } finally {
    await app.stopLiveSources();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const result = await runCatchup(options);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: "error",
    error: error.message
  }, null, 2));
  process.exitCode = 1;
});
