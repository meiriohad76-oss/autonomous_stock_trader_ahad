import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = (process.env.AGENT_UX_BASE_URL || process.env.AGENT_AUDIT_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const outDir = process.env.AGENT_UX_OUT || "dist/agent-ux-workflow";
const endpointTimeoutMs = Number(process.env.AGENT_UX_TIMEOUT_MS || 120_000);
const strict = process.argv.includes("--strict");

const report = {
  status: "unknown",
  base_url: baseUrl,
  endpoint_timeout_ms: endpointTimeoutMs,
  checks: [],
  failures: [],
  warnings: [],
  screens: []
};

const viewPlans = [
  {
    view: "alerts",
    slot: "#signals-agent-process",
    expectedTitles: ["Signals Agent User Test Report"]
  },
  {
    view: "trading",
    slot: "#selection-agent-process",
    expectedTitles: [
      "Deterministic Selection Agent User Test Report",
      "LLM Selection Agent User Test Report",
      "Final Selection Agent User Test Report"
    ]
  },
  {
    view: "risk",
    slot: "#risk-agent-process",
    expectedTitles: ["Risk Manager User Test Report"]
  },
  {
    view: "execution",
    slot: "#execution-agent-process",
    expectedTitles: ["Execution Agent User Test Report"]
  },
  {
    view: "portfolio",
    slot: "#portfolio-agent-process",
    expectedTitles: [
      "Portfolio Policy Agent User Test Report",
      "Portfolio Monitor User Test Report"
    ]
  },
  {
    view: "learning",
    slot: "#learning-agent-process",
    expectedTitles: ["Learning Agent User Test Report"]
  }
];

function addCheck(name, status, detail = {}) {
  const row = { name, status, detail };
  report.checks.push(row);
  if (status === "fail") {
    report.failures.push(row);
  } else if (status === "warning") {
    report.warnings.push(row);
  }
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(endpointTimeoutMs)
  });
  if (!response.ok) {
    throw new Error(`${path} failed with HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  return response.json();
}

async function read(path) {
  try {
    return await getJson(path);
  } catch (error) {
    addCheck(`endpoint_${path}`, "fail", { error: error.message });
    return null;
  }
}

function asList(payload, keys = []) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && typeof payload === "object") {
    for (const key of keys) {
      if (Array.isArray(payload[key])) {
        return payload[key];
      }
    }
  }
  return [];
}

function meaningfulReasonProblems(cards) {
  const thinReason = /^(no explanation|no detailed reason|no .* reason is available|[0-9]+ policy gate\(s\) passed\.|portfolio-level risk gate is not reporting a hard block\.|final selection marked .* user approval is still required\.)/i;
  const badText = /\b(undefined|nan|\[object object\])\b/i;
  const problems = [];

  for (const card of cards) {
    for (const section of card.sections) {
      for (const row of section.rows) {
        if (badText.test(row.text)) {
          problems.push({ title: card.title, item: row.item, problem: "bad_text", text: row.text.slice(0, 220) });
        }
        if (!row.reason || row.reason.length < 50 || thinReason.test(row.reason)) {
          problems.push({ title: card.title, item: row.item, problem: "thin_reason", reason: row.reason });
        }
      }
    }
  }

  return problems;
}

function expectedTitleProblems(cards, expectedTitles) {
  const titles = cards.map((card) => card.title);
  return expectedTitles.filter((title) => !titles.includes(title));
}

function targetWarnings(cards) {
  return cards
    .filter((card) => /review target not met/i.test(card.statusLabel || ""))
    .map((card) => ({
      title: card.title,
      target: card.targetLabel,
      status: card.statusLabel
    }));
}

async function collectReportCards(page, slotSelector) {
  return page.locator(`${slotSelector} .agent-test-report`).evaluateAll((nodes) =>
    nodes.map((node) => {
      const textOf = (selector, root = node) => root.querySelector(selector)?.textContent?.trim().replace(/\s+/g, " ") || "";
      const textsOf = (selector, root = node) =>
        [...root.querySelectorAll(selector)].map((item) => item.textContent.trim().replace(/\s+/g, " ")).filter(Boolean);

      const sections = [...node.querySelectorAll(".agent-test-section")].map((section) => ({
        title: textOf(".section-kicker", section),
        emptyText: textOf(".agent-test-empty", section),
        rows: [...section.querySelectorAll(".agent-test-item")].map((row) => ({
          item: textOf(".agent-test-item-meta strong", row),
          result: textOf(".agent-test-item-meta .sentiment-badge", row),
          score: textOf(".agent-test-score", row),
          reason: textOf("p", row),
          text: row.textContent.trim().replace(/\s+/g, " ")
        }))
      }));

      return {
        title: textOf("h3"),
        targetLabel: textOf(".runtime-source-head p"),
        statusLabel: textOf(".runtime-source-head .sentiment-badge"),
        inputCount: node.querySelectorAll(".agent-test-inputs span").length,
        inputs: textsOf(".agent-test-inputs span"),
        sectionCount: sections.length,
        sections,
        text: node.textContent.trim().replace(/\s+/g, " ")
      };
    })
  );
}

async function checkApis() {
  const ready = await read("/api/ready");
  addCheck("service_ready", ready?.ready ? "pass" : "fail", ready || {});

  const cycle = await read("/api/agency/cycle");
  const workers = Array.isArray(cycle?.workers) ? cycle.workers : [];
  addCheck("agency_cycle_has_12_workers", workers.length === 12 ? "pass" : "fail", {
    count: workers.length,
    mode: cycle?.mode,
    status: cycle?.status
  });

  const config = await read("/api/config");
  addCheck("workflow_test_mode_visible", config?.selection_workflow_test_mode ? "pass" : "warning", {
    selection_workflow_test_mode: config?.selection_workflow_test_mode,
    note: "For end-to-end user testing, lowered thresholds should be visible. Production can run with this off."
  });

  const setups = await read("/api/trade-setups?window=1h&limit=80&minConviction=0");
  const setupRows = asList(setups, ["setups", "items", "data"]);
  const tradableSetups = setupRows.filter((item) => ["long", "short"].includes(item.action));
  addCheck("deterministic_setups_visible", setupRows.length ? "pass" : "fail", {
    visible: setupRows.length,
    tradable: tradableSetups.length,
    counts: setups?.counts || null
  });
  addCheck("deterministic_test_target_10", tradableSetups.length >= 10 ? "pass" : "warning", {
    tradable: tradableSetups.length,
    note: "If this is below 10, the dashboard can still be correct, but the end-to-end workflow test does not have enough buy/sell rows."
  });

  const finalSelection = await read("/api/final-selection?window=1h&limit=80&minConviction=0");
  const candidates = asList(finalSelection, ["candidates", "items", "data"]);
  const executable = candidates.filter((item) => item.execution_allowed && ["long", "short"].includes(item.final_action));
  const openAiReviewed = candidates.filter((item) => item.llm_explanation?.reviewer === "openai");
  const missingSelectionReports = candidates
    .filter((item) => !(item.selection_report || item.report || item.decision_report))
    .map((item) => item.ticker);

  addCheck("final_selection_reports_present", missingSelectionReports.length ? "fail" : "pass", {
    candidates: candidates.length,
    missing: missingSelectionReports.slice(0, 30)
  });
  addCheck("llm_openai_review_status", openAiReviewed.length >= Math.min(10, candidates.length) ? "pass" : "warning", {
    openai_reviewed: openAiReviewed.length,
    llm_agent: finalSelection?.llm_agent || null
  });
  addCheck("final_selection_test_target_10", executable.length >= 10 ? "pass" : "warning", {
    executable: executable.length,
    counts: finalSelection?.counts || null,
    note: "Expected to reach 10 only while thresholds are deliberately lowered for workflow testing."
  });

  const risk = await read("/api/risk/status");
  addCheck("risk_status_visible", risk?.status ? "pass" : "warning", risk || {});

  const execution = await read("/api/execution/status");
  const submitOpen = Boolean(execution?.submit_enabled || execution?.can_submit_orders || execution?.paper_submit_enabled);
  addCheck("execution_submission_guard_closed", submitOpen ? "fail" : "pass", {
    submit_enabled: execution?.submit_enabled,
    can_submit_orders: execution?.can_submit_orders,
    paper_submit_enabled: execution?.paper_submit_enabled,
    note: "End-to-end tests may preview paper tickets, but must not silently open submission."
  });

  const workflow = await read("/api/trading-workflow/status?window=1h&limit=80&minConviction=0");
  addCheck("workflow_status_visible", workflow?.status ? "pass" : "warning", {
    status: workflow?.status,
    can_use_for_decisions: workflow?.can_use_for_decisions,
    can_preview_orders: workflow?.can_preview_orders,
    can_submit_orders: workflow?.can_submit_orders
  });
}

async function checkDashboard() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const consoleIssues = [];

  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      consoleIssues.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    consoleIssues.push(`pageerror: ${error.message}`);
  });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: endpointTimeoutMs });
  await page.waitForSelector('[data-view-panel="overview"].is-active', { timeout: 30_000 });
  await page
    .waitForFunction(() => (document.querySelector("#agency-command-center")?.innerText || "").trim().length > 0, { timeout: 60_000 })
    .catch(() => {});

  for (const plan of viewPlans) {
    await page.evaluate((view) => {
      document.querySelector(`button.topnav-link[data-view="${view}"], button.side-link[data-view="${view}"]`)?.click();
    }, plan.view);
    await page.waitForSelector(`[data-view-panel="${plan.view}"].is-active`, { timeout: 20_000 });
    await page
      .waitForFunction((slot) => (document.querySelector(slot)?.innerText || "").includes("User Test Report"), plan.slot, { timeout: 60_000 })
      .catch(() => {});

    const cards = await collectReportCards(page, plan.slot);
    const screen = {
      view: plan.view,
      expected_titles: plan.expectedTitles,
      card_count: cards.length,
      cards,
      screenshot: `${outDir}/${plan.view}.png`
    };
    report.screens.push(screen);
    await page.screenshot({ path: screen.screenshot, fullPage: true });

    const missingTitles = expectedTitleProblems(cards, plan.expectedTitles);
    addCheck(`dashboard_${plan.view}_report_cards`, missingTitles.length || !cards.length ? "fail" : "pass", {
      expected: plan.expectedTitles,
      actual: cards.map((card) => card.title),
      missing: missingTitles
    });

    const malformedCards = cards
      .filter((card) => card.inputCount < 2 || card.sectionCount < 2)
      .map((card) => ({ title: card.title, input_count: card.inputCount, section_count: card.sectionCount }));
    addCheck(`dashboard_${plan.view}_report_shape`, malformedCards.length ? "fail" : "pass", {
      malformed: malformedCards
    });

    const reasonProblems = meaningfulReasonProblems(cards);
    addCheck(`dashboard_${plan.view}_meaningful_reasons`, reasonProblems.length ? "fail" : "pass", {
      problems: reasonProblems.slice(0, 12)
    });

    const targets = targetWarnings(cards);
    addCheck(`dashboard_${plan.view}_target_10`, targets.length ? "warning" : "pass", {
      targets
    });
  }

  addCheck("dashboard_console_clean", consoleIssues.length ? "warning" : "pass", {
    console_issues: consoleIssues.slice(0, 20)
  });

  await browser.close();
}

await checkApis();
await checkDashboard();

report.status = report.failures.length ? "fail" : report.warnings.length ? "warning" : "ok";

const summary = {
  status: report.status,
  base_url: report.base_url,
  checks: report.checks.length,
  failures: report.failures.length,
  warnings: report.warnings.length,
  failure_checks: report.failures.map((item) => item.name),
  warning_checks: report.warnings.map((item) => item.name),
  screens: report.screens.map((screen) => ({
    view: screen.view,
    card_count: screen.card_count,
    cards: screen.cards.map((card) => ({
      title: card.title,
      target: card.targetLabel,
      status: card.statusLabel,
      inputs: card.inputCount,
      rows: card.sections.reduce((sum, section) => sum + section.rows.length, 0)
    })),
    screenshot: screen.screenshot
  }))
};

console.log(JSON.stringify(summary, null, 2));
if (report.failures.length || report.warnings.length) {
  console.log(JSON.stringify({ failures: report.failures, warnings: report.warnings }, null, 2));
}

if (report.failures.length || (strict && report.warnings.length)) {
  process.exitCode = 1;
}
