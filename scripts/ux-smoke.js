import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.UX_SMOKE_URL || "http://127.0.0.1:3000";
const outDir = process.env.UX_SMOKE_OUT || "dist";

function boxesOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

async function cardLayoutReport(locator) {
  return locator.evaluateAll((nodes) => {
    const boxes = nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        text: node.textContent.trim().replace(/\s+/g, " ").slice(0, 80),
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        overflowing: node.scrollWidth > node.clientWidth + 2 || node.scrollHeight > node.clientHeight + 2
      };
    });

    const overlaps = [];
    const overlapsBox = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        if (boxes[i].width > 0 && boxes[j].width > 0 && overlapsBox(boxes[i], boxes[j])) {
          overlaps.push([boxes[i].text, boxes[j].text]);
        }
      }
    }

    return {
      count: boxes.length,
      overflowing: boxes.filter((box) => box.overflowing).map((box) => box.text),
      overlaps
    };
  });
}

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1510, height: 900 } });
const consoleIssues = [];

page.on("console", (message) => {
  if (["error", "warning"].includes(message.type())) {
    consoleIssues.push(`${message.type()}: ${message.text()}`);
  }
});
page.on("pageerror", (error) => {
  consoleIssues.push(`pageerror: ${error.message}`);
});

await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-view-panel="overview"].is-active', { timeout: 20_000 });
await page
  .waitForFunction(() => {
    const docs = document.querySelector("#health-docs")?.textContent || "";
    return docs && docs !== "0 docs";
  }, { timeout: 20_000 })
  .catch(() => {});
await page.screenshot({ path: `${outDir}/ux-smoke-overview.png`, fullPage: true });

const overview = {
  tradeSummary: await cardLayoutReport(page.locator("#trade-setup-summary .summary-card")),
  tradeLists: await page.locator(".trade-list-card").count(),
  decisionFlowSteps: await page.locator(".decision-flow-list li").count(),
  sourceButtonText: await page.locator("#signal-source-button").textContent()
};

await page.click('button.side-link[data-view="markets"]');
await page.waitForSelector('[data-view-panel="markets"].is-active', { timeout: 10_000 });
await page
  .waitForFunction(() => (document.querySelector("#markets-table-body")?.innerText || "").trim().length > 0, { timeout: 10_000 })
  .catch(() => {});
await page.screenshot({ path: `${outDir}/ux-smoke-markets.png`, fullPage: true });

const markets = {
  comparisonCards: await page.locator("#markets-comparison-strip .comparison-card").count(),
  comparisonEmpty: await page.locator("#markets-comparison-strip .workspace-empty").textContent().catch(() => null),
  tableRows: await page.locator("#markets-table-body tr").count(),
  tableText: (await page.locator("#markets-table-body").innerText()).slice(0, 500)
};

await page.click('button.topnav-link[data-view="trading"]');
await page.waitForSelector('[data-view-panel="trading"].is-active', { timeout: 10_000 });
await page
  .waitForFunction(() => (document.querySelector("#trading-plan-lists")?.innerText || "").trim().length > 0, { timeout: 10_000 })
  .catch(() => {});

const trading = {
  flowSteps: await page.locator(".trading-flow-step").count(),
  workflowSteps: await page.locator("#trading-workflow-status .workflow-step-card").count(),
  workflowStatusText: (await page.locator("#trading-workflow-status").innerText().catch(() => "")).slice(0, 500),
  tradeLists: await page.locator('#trading-plan-lists .trade-list-card').count(),
  summaryCards: await page.locator("#trading-plan-summary .workspace-stat-card").count(),
  executionCards: await page.locator("#trading-execution-console .runtime-control-card").count(),
  previewButtons: await page.locator("#trading-plan-lists [data-preview-execution], #trading-execution-console [data-preview-execution]").count()
};

await page.click('button.side-link[data-view="alerts"]');
await page.waitForSelector('[data-view-panel="alerts"].is-active', { timeout: 10_000 });
await page
  .waitForFunction(() => (document.querySelector("[data-alert-index], [data-high-impact-index], [data-money-flow-index], .workspace-empty")?.textContent || "").trim().length > 0, { timeout: 10_000 })
  .catch(() => {});
await page.screenshot({ path: `${outDir}/ux-smoke-alerts.png`, fullPage: true });

const firstSignal = page.locator("[data-alert-index], [data-high-impact-index], [data-money-flow-index]").first();
if (await firstSignal.count()) {
  await firstSignal.click();
  await page.waitForSelector(".signal-drawer.is-open", { timeout: 5_000 });
}

const signalDrawer = {
  open: await page.locator(".signal-drawer.is-open").count(),
  title: await page.locator("#signal-drawer-title").textContent(),
  sourceButtonText: await page.locator("#signal-source-button").textContent(),
  sourceButtonDisabled: await page.locator("#signal-source-button").isDisabled(),
  context: (await page.locator("#signal-drawer-context").innerText()).slice(0, 500)
};

await browser.close();

const report = {
  status: "ok",
  baseUrl,
  screenshots: [
    `${outDir}/ux-smoke-overview.png`,
    `${outDir}/ux-smoke-markets.png`,
    `${outDir}/ux-smoke-alerts.png`
  ],
  overview,
  markets,
  trading,
  signalDrawer,
  consoleIssues
};

if (overview.tradeSummary.overlaps.length || overview.tradeSummary.overflowing.length) {
  report.status = "layout_warning";
}

console.log(JSON.stringify(report, null, 2));
