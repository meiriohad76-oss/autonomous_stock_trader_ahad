process.env.DATABASE_ENABLED = process.env.DATABASE_ENABLED || "false";
process.env.SEED_DATA_IN_DECISIONS = "true";
process.env.BROKER_SUBMIT_ENABLED = process.env.BROKER_SUBMIT_ENABLED || "false";

const { createSentimentApp } = await import("../src/app.js");

const app = createSentimentApp();

try {
  app.setStartupStatus({ http_listening: true, phase: "initializing" });
  await app.initialize();
  app.setStartupStatus({ initialized: true, live_sources_started: true, phase: "running" });
  await app.replay({ reset: true, intervalMs: 0 });

  const [policy, finalSelection, cycle] = await Promise.all([
    app.getPortfolioPolicy(),
    app.getFinalSelection({ window: "1h", limit: 12, minConviction: 0 }),
    app.getAgencyCycleStatus({ window: "1h", limit: 12, minConviction: 0 })
  ]);

  if (!policy.settings || !policy.fields?.length) {
    throw new Error("Portfolio Policy Agent did not expose editable settings.");
  }

  if (!finalSelection.algorithm?.steps?.length || !Array.isArray(finalSelection.candidates)) {
    throw new Error("Final Selection Agent did not expose the arbitration procedure.");
  }

  const requiredWorkers = new Set([
    "universe",
    "fundamentals",
    "market",
    "signals",
    "policy",
    "deterministic_selection",
    "llm_selection",
    "final_selection",
    "risk",
    "execution",
    "portfolio",
    "learning"
  ]);
  const workers = new Set((cycle.workers || []).map((worker) => worker.key));
  const missingWorkers = [...requiredWorkers].filter((worker) => !workers.has(worker));
  if (missingWorkers.length) {
    throw new Error(`Agency cycle is missing workers: ${missingWorkers.join(", ")}`);
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        policy_status: policy.status,
        final_visible: finalSelection.counts.visible,
        final_executable: finalSelection.counts.executable,
        llm_mode: finalSelection.llm_agent.mode,
        agency_workers: cycle.workers.length,
        current_worker: cycle.current_worker_label,
        can_preview_orders: cycle.can_preview_orders,
        can_submit_orders: cycle.can_submit_orders
      },
      null,
      2
    )
  );
} finally {
  await app.stopLiveSources();
}
