# Live Connectors Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three new live data collectors — earnings calendar (Yahoo Finance), social sentiment (StockTwits), and delayed trade prints (Polygon.io) — each following the exact collector pattern already used by live-news.js and market-flow.js.

**Architecture:** Each collector is a self-contained module in `src/domain/` constructed via `createXxxCollector({ config, store, pipeline })` returning `{ start, stop, pollOnce }`. All signals flow through `pipeline.processRawDocument()`. The earnings calendar also maintains `store.earningsCalendar` (a Map) as a side-output consumed by the trade-setup risk-flag layer. Persistence is extended to save/load `store.earningsCalendar` as a `runtime_state` row alongside health and fundamentals.

**Tech Stack:** Node.js ESM, no build step; Yahoo Finance quoteSummary (no key), StockTwits public stream API (no key), Polygon.io v3 trades (free API key, disabled by default), node:fetch, EventEmitter store bus.

---

## File Map

| File | Action | What changes |
|---|---|---|
| `src/config.js` | Modify | 12 new config keys for the three collectors |
| `src/domain/taxonomy.js` | Modify | SOURCE_TRUST entries, EVENT_TAXONOMY, HALF_LIFE_HOURS, RULE_PATTERNS |
| `src/domain/store.js` | Modify | `earningsCalendar: new Map()` in createStore and resetStore |
| `src/domain/persistence.js` | Modify | Save/load `earningsCalendar` as runtime_state in both SQLite and Postgres paths |
| `src/domain/corporate-events.js` | Create | Earnings calendar collector (Yahoo Finance quoteSummary) |
| `src/domain/social-sentiment.js` | Create | StockTwits social sentiment collector |
| `src/domain/trade-prints.js` | Create | Delayed block-trade print collector (Polygon.io / IEX Cloud) |
| `src/domain/trade-setup.js` | Modify | Add `earnings_in_window` risk flag reading `store.earningsCalendar` |
| `src/app.js` | Modify | Import, instantiate, start/stop all three collectors; add getEarningsCalendar() |
| `scripts/check.js` | Modify | Assert collector interfaces and earningsCalendar Map after init |

---

## Task 1: Config extensions

**Files:**
- Modify: `src/config.js`

- [ ] **Step 1: Add 12 new config keys**

In `src/config.js`, after the line `sec13fEnabled: String(process.env.SEC_13F_ENABLED || "true").toLowerCase() !== "false",` and before `secRequestTimeoutMs`, insert:

```js
  earningsEnabled: String(process.env.EARNINGS_ENABLED || "true").toLowerCase() !== "false",
  earningsPollMs: Number(process.env.EARNINGS_POLL_MS || 3600000),
  earningsRequestTimeoutMs: Number(process.env.EARNINGS_REQUEST_TIMEOUT_MS || 12000),
  stocktwitsEnabled: String(process.env.STOCKTWITS_ENABLED || "true").toLowerCase() !== "false",
  stocktwitsPollMs: Number(process.env.STOCKTWITS_POLL_MS || 900000),
  stocktwitsRequestTimeoutMs: Number(process.env.STOCKTWITS_REQUEST_TIMEOUT_MS || 10000),
  tradePrintsEnabled: String(process.env.TRADE_PRINTS_ENABLED || "false").toLowerCase() !== "false",
  tradePrintsProvider: process.env.TRADE_PRINTS_PROVIDER || "polygon",
  tradePrintsApiKey: process.env.TRADE_PRINTS_API_KEY || "",
  tradePrintsPollMs: Number(process.env.TRADE_PRINTS_POLL_MS || 300000),
  tradePrintsRequestTimeoutMs: Number(process.env.TRADE_PRINTS_REQUEST_TIMEOUT_MS || 12000),
  tradePrintsBlockTradeMinNotionalUsd: Number(process.env.TRADE_PRINTS_BLOCK_TRADE_MIN_NOTIONAL_USD || 1000000),
```

- [ ] **Step 2: Verify**

```bash
node --input-type=module <<'EOF'
import { config } from "./src/config.js";
console.log("earningsEnabled:", config.earningsEnabled);
console.log("stocktwitsEnabled:", config.stocktwitsEnabled);
console.log("tradePrintsEnabled:", config.tradePrintsEnabled);
EOF
```

Expected:
```
earningsEnabled: true
stocktwitsEnabled: true
tradePrintsEnabled: false
```

- [ ] **Step 3: Commit**

```bash
git add src/config.js
git commit -m "feat(config): add earnings, stocktwits, and trade-prints collector config keys"
```

---

## Task 2: taxonomy.js extensions

**Files:**
- Modify: `src/domain/taxonomy.js`

- [ ] **Step 1: Add SOURCE_TRUST entries**

After `manual: 0.5` in the SOURCE_TRUST block, add:
```js
  yahoo_earnings: 0.72,
  stocktwits: 0.58,
  polygon_trades: 0.81,
  iex_trades: 0.75,
```

- [ ] **Step 2: Extend EVENT_TAXONOMY earnings family and add social family**

Change:
```js
  earnings: ["beat", "miss", "guidance_raise", "guidance_cut", "margin_change"],
```
To:
```js
  earnings: ["beat", "miss", "guidance_raise", "guidance_cut", "margin_change", "earnings_upcoming", "earnings_release"],
```

Add after `macro_sector: [...]`:
```js
  social: ["social_buzz"],
```

- [ ] **Step 3: Add HALF_LIFE_HOURS entries**

After `buyback: 48,` in the HALF_LIFE_HOURS block, add:
```js
  earnings_upcoming: 168,
  earnings_release: 24,
  social_buzz: 4,
```

- [ ] **Step 4: Add RULE_PATTERNS entries**

Add these four entries before the closing `];` of RULE_PATTERNS:

```js
  {
    family: "earnings",
    type: "earnings_upcoming",
    direction: "neutral",
    label: "neutral",
    urgency: "high",
    tradeability: "monitor",
    sentiment: 0,
    impact: 0.7,
    confidence: 0.85,
    patterns: [/reports earnings on/i, /earnings (report|call) (expected|scheduled)/i, /upcoming earnings/i],
    reasons: ["earnings_calendar_event"]
  },
  {
    family: "earnings",
    type: "earnings_release",
    direction: "neutral",
    label: "neutral",
    urgency: "high",
    tradeability: "monitor",
    sentiment: 0,
    impact: 0.75,
    confidence: 0.82,
    patterns: [/reports (quarterly|q[1-4]) (results|earnings)/i, /fiscal (q[1-4]|quarter) results/i, /earnings release/i],
    reasons: ["earnings_release_event"]
  },
  {
    family: "social",
    type: "social_buzz",
    direction: "positive",
    label: "bullish",
    urgency: "low",
    tradeability: "monitor",
    sentiment: 0.38,
    impact: 0.35,
    confidence: 0.62,
    patterns: [/bullish crowd sentiment/i, /\d+% bullish/i, /bullish social/i],
    reasons: ["social_bullish_skew"]
  },
  {
    family: "social",
    type: "social_buzz",
    direction: "negative",
    label: "bearish",
    urgency: "low",
    tradeability: "monitor",
    sentiment: -0.38,
    impact: 0.35,
    confidence: 0.62,
    patterns: [/bearish crowd sentiment/i, /\d+% bearish/i, /bearish social/i],
    reasons: ["social_bearish_skew"]
  },
```

- [ ] **Step 5: Verify**

```bash
node --input-type=module <<'EOF'
import { SOURCE_TRUST, EVENT_TAXONOMY, RULE_PATTERNS } from "./src/domain/taxonomy.js";
console.log("yahoo_earnings trust:", SOURCE_TRUST.yahoo_earnings);
console.log("social family:", EVENT_TAXONOMY.social);
const socialRules = RULE_PATTERNS.filter(r => r.family === "social");
console.log("social rule count:", socialRules.length);
const earningsRules = RULE_PATTERNS.filter(r => r.type === "earnings_upcoming" || r.type === "earnings_release");
console.log("new earnings rules:", earningsRules.length);
EOF
```

Expected:
```
yahoo_earnings trust: 0.72
social family: [ 'social_buzz' ]
social rule count: 2
new earnings rules: 2
```

- [ ] **Step 6: Commit**

```bash
git add src/domain/taxonomy.js
git commit -m "feat(taxonomy): add earnings calendar and social buzz sources and rule patterns"
```

---

## Task 3: store.js — add earningsCalendar

**Files:**
- Modify: `src/domain/store.js`

- [ ] **Step 1: Add to createStore**

After `tradeSetups: [],` add:
```js
    earningsCalendar: new Map(),
```

- [ ] **Step 2: Add to resetStore**

After `store.tradeSetups = [];` add:
```js
  store.earningsCalendar = new Map();
```

- [ ] **Step 3: Verify**

```bash
node --input-type=module <<'EOF'
import { createStore, resetStore } from "./src/domain/store.js";
const store = createStore({});
console.log("earningsCalendar is Map:", store.earningsCalendar instanceof Map);
resetStore(store);
console.log("after reset still Map:", store.earningsCalendar instanceof Map);
EOF
```

Expected:
```
earningsCalendar is Map: true
after reset still Map: true
```

- [ ] **Step 4: Commit**

```bash
git add src/domain/store.js
git commit -m "feat(store): add earningsCalendar Map field"
```

---

## Task 4: persistence.js — save/load earningsCalendar

**Files:**
- Modify: `src/domain/persistence.js`

`earningsCalendar` is stored as a single `runtime_state` row with key `"earnings_calendar"`, value = JSON array of `[ticker, entry]` pairs (the serialized Map).

- [ ] **Step 1: Add save in SQLite saveStoreSnapshot**

After:
```js
        insertRuntime.run("fundamentals", now, JSON.stringify(buildRuntimeFundamentals(store)));
```
Add:
```js
        insertRuntime.run("earnings_calendar", now, JSON.stringify([...store.earningsCalendar.entries()]));
```

- [ ] **Step 2: Add load in hydrateStoreFromRows**

After the `if (persistedFundamentals)` block (around line 231), add:
```js
  const persistedEarningsCalendar = runtimeMap.get("earnings_calendar");
  if (Array.isArray(persistedEarningsCalendar)) {
    store.earningsCalendar = new Map(persistedEarningsCalendar);
  }
```

- [ ] **Step 3: Add save in Postgres saveStoreSnapshot**

After the `fundamentals` INSERT block (around line 573), add:
```js
        await client.query(
          `INSERT INTO runtime_state (state_key, updated_at, payload_json)
           VALUES ($1, $2, $3::jsonb)
           ON CONFLICT (state_key) DO UPDATE
           SET updated_at = EXCLUDED.updated_at,
               payload_json = EXCLUDED.payload_json`,
          ["earnings_calendar", now, JSON.stringify([...store.earningsCalendar.entries()])]
        );
```

- [ ] **Step 4: Commit**

```bash
git add src/domain/persistence.js
git commit -m "feat(persistence): save and restore earningsCalendar across restarts"
```

---

## Task 5: corporate-events.js — earnings calendar collector

**Files:**
- Create: `src/domain/corporate-events.js`

Polls Yahoo Finance `quoteSummary` for each WATCHLIST ticker once per hour. Emits `earnings_upcoming` docs for dates within 7 days, `earnings_release` docs for dates within the past 48 hours. Writes `store.earningsCalendar` Map: `ticker → { next_earnings_date, days_until, confirmed, last_checked_at }`.

seenKey: `earnings_upcoming:{ticker}:{YYYY-MM-DD}` — one doc per ticker per calendar day.

- [ ] **Step 1: Write the file**

Create `src/domain/corporate-events.js` with this complete content:

```js
import { WATCHLIST } from "./taxonomy.js";

const YAHOO_BASE = "https://query2.finance.yahoo.com/v10/finance/quoteSummary";
const UPCOMING_WINDOW_DAYS = 7;
const RELEASE_LOOKBACK_HOURS = 48;

function buildQuoteSummaryUrl(ticker) {
  return `${YAHOO_BASE}/${encodeURIComponent(ticker)}?modules=calendarEvents`;
}

function buildSeenKey(type, ticker, isoDate) {
  return `${type}:${ticker}:${isoDate.slice(0, 10)}`;
}

async function fetchCalendarEvents(ticker, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(buildQuoteSummaryUrl(ticker), {
      signal: controller.signal,
      headers: { "User-Agent": "SentimentAnalyst/1.0 (+earnings-calendar)" }
    });
    if (!response.ok) throw new Error(`Yahoo quoteSummary ${response.status}`);
    const json = await response.json();
    const result = json?.quoteSummary?.result?.[0];
    const earningsDates = result?.calendarEvents?.earnings?.earningsDate ?? [];
    return earningsDates.map((d) => (typeof d === "object" ? d.raw * 1000 : Number(d) * 1000));
  } finally {
    clearTimeout(timer);
  }
}

function buildUpcomingRawDocument(entry, earningsDateMs) {
  const isoDate = new Date(earningsDateMs).toISOString();
  const dateStr = isoDate.slice(0, 10);
  const daysUntil = Math.ceil((earningsDateMs - Date.now()) / 86_400_000);
  return {
    source_name: "yahoo_earnings",
    source_type: "api",
    source_priority: 0.72,
    canonical_url: `https://finance.yahoo.com/quote/${entry.ticker}`,
    url: `https://finance.yahoo.com/quote/${entry.ticker}`,
    title: `${entry.company} reports earnings on ${dateStr} (${daysUntil}d away)`,
    body: `${entry.company} (${entry.ticker}) upcoming earnings event. Reports earnings on ${dateStr}. Upcoming earnings scheduled in ${daysUntil} day${daysUntil === 1 ? "" : "s"}.`,
    language: "en",
    published_at: new Date().toISOString(),
    fetched_at: new Date().toISOString(),
    source_metadata: {
      ticker_hint: entry.ticker,
      sector_hint: entry.sector,
      collector: "yahoo_earnings_calendar",
      earnings_date: isoDate,
      days_until: daysUntil
    },
    raw_payload: { earningsDateMs, ticker: entry.ticker }
  };
}

function buildReleaseRawDocument(entry, earningsDateMs) {
  const isoDate = new Date(earningsDateMs).toISOString();
  const dateStr = isoDate.slice(0, 10);
  return {
    source_name: "yahoo_earnings",
    source_type: "api",
    source_priority: 0.72,
    canonical_url: `https://finance.yahoo.com/quote/${entry.ticker}`,
    url: `https://finance.yahoo.com/quote/${entry.ticker}`,
    title: `${entry.company} earnings release — ${dateStr}`,
    body: `${entry.company} (${entry.ticker}) fiscal quarter results. Reports quarterly earnings on ${dateStr}. Earnings release event.`,
    language: "en",
    published_at: isoDate,
    fetched_at: new Date().toISOString(),
    source_metadata: {
      ticker_hint: entry.ticker,
      sector_hint: entry.sector,
      collector: "yahoo_earnings_calendar",
      earnings_date: isoDate
    },
    raw_payload: { earningsDateMs, ticker: entry.ticker }
  };
}

export function createCorporateEventsCollector(app) {
  const { config, pipeline, store } = app;
  let timer = null;
  let running = false;
  let inFlight = false;

  function ensureHealthEntry() {
    if (!store.health.liveSources.yahoo_earnings_calendar) {
      store.health.liveSources.yahoo_earnings_calendar = {
        enabled: config.earningsEnabled,
        polling: false,
        last_poll_at: null,
        last_success_at: null,
        last_error: null,
        polls: 0,
        consecutive_failures: 0,
        ingested_documents: 0
      };
    }
    return store.health.liveSources.yahoo_earnings_calendar;
  }

  async function pollOnce() {
    if (!config.earningsEnabled || inFlight) return { ingested: 0, skipped: 0 };

    inFlight = true;
    const health = ensureHealthEntry();
    health.polling = true;
    health.last_poll_at = new Date().toISOString();
    health.polls += 1;

    let ingested = 0;
    let skipped = 0;
    let errors = 0;

    try {
      const results = await Promise.all(
        WATCHLIST.map(async (entry) => {
          try {
            const dates = await fetchCalendarEvents(entry.ticker, config.earningsRequestTimeoutMs);
            return { entry, dates, error: null };
          } catch (err) {
            return { entry, dates: [], error: err.message };
          }
        })
      );

      const now = Date.now();

      for (const { entry, dates, error } of results) {
        if (error) {
          errors += 1;
          continue;
        }

        let calendarEntry = { next_earnings_date: null, days_until: null, confirmed: false, last_checked_at: new Date().toISOString() };

        for (const dateMs of dates) {
          const daysUntil = (dateMs - now) / 86_400_000;

          if (daysUntil > 0 && daysUntil <= UPCOMING_WINDOW_DAYS) {
            const isoDate = new Date(dateMs).toISOString();
            const seenKey = buildSeenKey("earnings_upcoming", entry.ticker, isoDate);
            calendarEntry = { next_earnings_date: isoDate, days_until: Math.ceil(daysUntil), confirmed: true, last_checked_at: new Date().toISOString() };

            if (!store.seenExternalDocuments.has(seenKey)) {
              store.seenExternalDocuments.add(seenKey);
              await pipeline.processRawDocument(buildUpcomingRawDocument(entry, dateMs));
              ingested += 1;
            } else {
              skipped += 1;
            }
          } else if (daysUntil <= 0 && daysUntil >= -(RELEASE_LOOKBACK_HOURS / 24)) {
            const isoDate = new Date(dateMs).toISOString();
            const seenKey = buildSeenKey("earnings_release", entry.ticker, isoDate);

            if (!calendarEntry.next_earnings_date) {
              calendarEntry = { next_earnings_date: isoDate, days_until: 0, confirmed: true, last_checked_at: new Date().toISOString() };
            }

            if (!store.seenExternalDocuments.has(seenKey)) {
              store.seenExternalDocuments.add(seenKey);
              await pipeline.processRawDocument(buildReleaseRawDocument(entry, dateMs));
              ingested += 1;
            } else {
              skipped += 1;
            }
          } else if (daysUntil > UPCOMING_WINDOW_DAYS && !calendarEntry.next_earnings_date) {
            calendarEntry = { next_earnings_date: new Date(dateMs).toISOString(), days_until: Math.ceil(daysUntil), confirmed: true, last_checked_at: new Date().toISOString() };
          }
        }

        store.earningsCalendar.set(entry.ticker, calendarEntry);
      }

      health.ingested_documents += ingested;
      if (ingested > 0 || errors < WATCHLIST.length) health.last_success_at = new Date().toISOString();
      health.last_error = errors > 0 ? `${errors} tickers failed` : null;
      health.consecutive_failures = errors === WATCHLIST.length ? health.consecutive_failures + 1 : 0;
      return { ingested, skipped, errors };
    } finally {
      health.polling = false;
      inFlight = false;
    }
  }

  function scheduleNext() {
    if (!running || !config.earningsEnabled) return;
    timer = setTimeout(async () => {
      await pollOnce();
      scheduleNext();
    }, config.earningsPollMs);
  }

  return {
    async start() {
      ensureHealthEntry();
      if (running || !config.earningsEnabled) return;
      running = true;
      await pollOnce();
      scheduleNext();
    },
    stop() {
      running = false;
      if (timer) { clearTimeout(timer); timer = null; }
      ensureHealthEntry().polling = false;
    },
    async pollOnce() {
      ensureHealthEntry();
      return pollOnce();
    }
  };
}
```

- [ ] **Step 2: Verify**

```bash
node --input-type=module <<'EOF'
import { createCorporateEventsCollector } from "./src/domain/corporate-events.js";
console.log("type:", typeof createCorporateEventsCollector);
EOF
```

Expected: `type: function`

- [ ] **Step 3: Commit**

```bash
git add src/domain/corporate-events.js
git commit -m "feat(collectors): add Yahoo Finance earnings calendar collector"
```

---

## Task 6: social-sentiment.js — StockTwits collector

**Files:**
- Create: `src/domain/social-sentiment.js`

Polls StockTwits public symbol stream per ticker. Emits one `social_buzz` document when ≥60% bullish or ≤40% bullish (i.e., ≥60% bearish) from messages that carry a sentiment tag, and at least 5 tagged messages are present. Uses an hourly slot to dedup — at most one document per ticker per hour.

- [ ] **Step 1: Write the file**

Create `src/domain/social-sentiment.js`:

```js
import { WATCHLIST } from "./taxonomy.js";

const STOCKTWITS_BASE = "https://api.stocktwits.com/api/2/streams/symbol";
const BULLISH_SKEW_THRESHOLD = 0.60;
const BEARISH_SKEW_THRESHOLD = 0.40;
const MIN_TAGGED_MESSAGES = 5;

function buildStreamUrl(ticker) {
  return `${STOCKTWITS_BASE}/${encodeURIComponent(ticker)}.json`;
}

function hourlySlot() {
  return Math.floor(Date.now() / 3_600_000);
}

function buildSeenKey(ticker) {
  return `stocktwits:${ticker}:${hourlySlot()}`;
}

async function fetchStream(ticker, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(buildStreamUrl(ticker), {
      signal: controller.signal,
      headers: { "User-Agent": "SentimentAnalyst/1.0 (+social-sentiment)" }
    });
    if (response.status === 429) throw new Error("StockTwits rate-limited");
    if (!response.ok) throw new Error(`StockTwits ${response.status}`);
    const json = await response.json();
    return json?.messages ?? [];
  } finally {
    clearTimeout(timer);
  }
}

function classifyMessages(messages) {
  let bullish = 0;
  let bearish = 0;
  const snippets = [];

  for (const msg of messages) {
    const basic = msg?.entities?.sentiment?.basic;
    if (basic === "Bullish") bullish += 1;
    else if (basic === "Bearish") bearish += 1;

    if (snippets.length < 3 && msg?.body) {
      snippets.push(msg.body.slice(0, 120).replace(/\s+/g, " "));
    }
  }

  return { bullish, bearish, total: bullish + bearish, snippets };
}

function buildRawDocument(entry, bullish, bearish, total, bullishPct, snippets) {
  const dominant = bullishPct >= BULLISH_SKEW_THRESHOLD ? "Bullish" : "Bearish";
  const pct = Math.round(bullishPct * 100);
  return {
    source_name: "stocktwits",
    source_type: "api",
    source_priority: 0.58,
    canonical_url: `https://stocktwits.com/symbol/${entry.ticker}`,
    url: `https://stocktwits.com/symbol/${entry.ticker}`,
    title: `${entry.ticker} StockTwits: ${pct}% bullish — ${dominant} crowd sentiment dominant`,
    body: [
      `StockTwits social pulse for ${entry.ticker}: ${bullish} bullish, ${bearish} bearish out of ${total} tagged messages.`,
      `Bullish ratio: ${pct}%. ${dominant} social buzz.`,
      snippets.length ? `Recent: "${snippets.join('" | "')}"` : ""
    ].filter(Boolean).join(" "),
    language: "en",
    published_at: new Date().toISOString(),
    fetched_at: new Date().toISOString(),
    source_metadata: {
      ticker_hint: entry.ticker,
      sector_hint: entry.sector,
      collector: "stocktwits_stream",
      bullish_count: bullish,
      bearish_count: bearish,
      tagged_total: total,
      bullish_pct: bullishPct
    },
    raw_payload: { bullish, bearish, total }
  };
}

export function createSocialSentimentCollector(app) {
  const { config, pipeline, store } = app;
  let timer = null;
  let running = false;
  let inFlight = false;

  function ensureHealthEntry() {
    if (!store.health.liveSources.stocktwits_stream) {
      store.health.liveSources.stocktwits_stream = {
        enabled: config.stocktwitsEnabled,
        polling: false,
        last_poll_at: null,
        last_success_at: null,
        last_error: null,
        polls: 0,
        consecutive_failures: 0,
        ingested_documents: 0
      };
    }
    return store.health.liveSources.stocktwits_stream;
  }

  async function pollOnce() {
    if (!config.stocktwitsEnabled || inFlight) return { ingested: 0, skipped: 0 };

    inFlight = true;
    const health = ensureHealthEntry();
    health.polling = true;
    health.last_poll_at = new Date().toISOString();
    health.polls += 1;

    let ingested = 0;
    let skipped = 0;
    let errors = 0;

    try {
      for (const entry of WATCHLIST) {
        const seenKey = buildSeenKey(entry.ticker);
        if (store.seenExternalDocuments.has(seenKey)) {
          skipped += 1;
          continue;
        }

        let messages;
        try {
          messages = await fetchStream(entry.ticker, config.stocktwitsRequestTimeoutMs);
        } catch {
          errors += 1;
          continue;
        }

        const { bullish, bearish, total, snippets } = classifyMessages(messages);
        if (total < MIN_TAGGED_MESSAGES) {
          skipped += 1;
          continue;
        }

        const bullishPct = bullish / total;
        const hasSkew = bullishPct >= BULLISH_SKEW_THRESHOLD || bullishPct <= BEARISH_SKEW_THRESHOLD;
        if (!hasSkew) {
          skipped += 1;
          continue;
        }

        store.seenExternalDocuments.add(seenKey);
        await pipeline.processRawDocument(buildRawDocument(entry, bullish, bearish, total, bullishPct, snippets));
        ingested += 1;

        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      health.ingested_documents += ingested;
      if (ingested > 0 || errors < WATCHLIST.length) health.last_success_at = new Date().toISOString();
      health.last_error = errors > 0 ? `${errors} tickers failed` : null;
      health.consecutive_failures = errors === WATCHLIST.length ? health.consecutive_failures + 1 : 0;
      return { ingested, skipped, errors };
    } finally {
      health.polling = false;
      inFlight = false;
    }
  }

  function scheduleNext() {
    if (!running || !config.stocktwitsEnabled) return;
    timer = setTimeout(async () => {
      await pollOnce();
      scheduleNext();
    }, config.stocktwitsPollMs);
  }

  return {
    async start() {
      ensureHealthEntry();
      if (running || !config.stocktwitsEnabled) return;
      running = true;
      await pollOnce();
      scheduleNext();
    },
    stop() {
      running = false;
      if (timer) { clearTimeout(timer); timer = null; }
      ensureHealthEntry().polling = false;
    },
    async pollOnce() {
      ensureHealthEntry();
      return pollOnce();
    }
  };
}
```

- [ ] **Step 2: Verify**

```bash
node --input-type=module <<'EOF'
import { createSocialSentimentCollector } from "./src/domain/social-sentiment.js";
console.log("type:", typeof createSocialSentimentCollector);
EOF
```

Expected: `type: function`

- [ ] **Step 3: Commit**

```bash
git add src/domain/social-sentiment.js
git commit -m "feat(collectors): add StockTwits social sentiment collector"
```

---

## Task 7: trade-prints.js — delayed trade print collector

**Files:**
- Create: `src/domain/trade-prints.js`

Polls Polygon.io `/v3/trades/{ticker}` (or IEX `/stable/stock/{ticker}/trades`) for recent delayed prints. Disabled by default (`tradePrintsEnabled: false`). Classifies prints as `block_trade_buying` or `block_trade_selling` by comparing print price to the WATCHLIST `base_price` and applying the `tradePrintsBlockTradeMinNotionalUsd` threshold. Emits one document per ticker per day summarising the dominant flow direction.

- [ ] **Step 1: Write the file**

Create `src/domain/trade-prints.js`:

```js
import { WATCHLIST } from "./taxonomy.js";

const POLYGON_BASE = "https://api.polygon.io/v3/trades";
const IEX_BASE = "https://cloud.iexapis.com/stable/stock";

function dateSlot() {
  return new Date().toISOString().slice(0, 10);
}

function buildSeenKey(ticker) {
  return `trade_print:${ticker}:${dateSlot()}`;
}

async function fetchPolygonTrades(ticker, apiKey, timeoutMs) {
  const url = `${POLYGON_BASE}/${encodeURIComponent(ticker)}?limit=50&sort=timestamp&order=desc&apiKey=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "SentimentAnalyst/1.0 (+trade-prints)" }
    });
    if (!response.ok) throw new Error(`Polygon trades ${response.status}`);
    const json = await response.json();
    return (json?.results ?? []).map((t) => ({ price: t.price, size: t.size }));
  } finally {
    clearTimeout(timer);
  }
}

async function fetchIexTrades(ticker, apiKey, timeoutMs) {
  const url = `${IEX_BASE}/${encodeURIComponent(ticker)}/trades?token=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "SentimentAnalyst/1.0 (+trade-prints)" }
    });
    if (!response.ok) throw new Error(`IEX trades ${response.status}`);
    const json = await response.json();
    return (Array.isArray(json) ? json : []).map((t) => ({ price: t.price, size: t.size }));
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTrades(ticker, config) {
  if (config.tradePrintsProvider === "iex") {
    return fetchIexTrades(ticker, config.tradePrintsApiKey, config.tradePrintsRequestTimeoutMs);
  }
  return fetchPolygonTrades(ticker, config.tradePrintsApiKey, config.tradePrintsRequestTimeoutMs);
}

function classifyTrades(trades, basePrice, minNotionalUsd) {
  let buyNotional = 0;
  let sellNotional = 0;
  let blockCount = 0;

  for (const trade of trades) {
    const notional = trade.price * trade.size;
    if (notional < minNotionalUsd) continue;
    blockCount += 1;
    if (trade.price >= basePrice) {
      buyNotional += notional;
    } else {
      sellNotional += notional;
    }
  }

  return { buyNotional, sellNotional, blockCount };
}

function buildRawDocument(entry, action, buyNotional, sellNotional, blockCount, provider) {
  const isBuy = action === "block_trade_buying";
  const dominantNotional = isBuy ? buyNotional : sellNotional;
  const usd = (dominantNotional / 1e6).toFixed(1);
  const sourceName = provider === "iex" ? "iex_trades" : "polygon_trades";
  return {
    source_name: sourceName,
    source_type: "api",
    source_priority: provider === "iex" ? 0.75 : 0.81,
    canonical_url: `https://finance.yahoo.com/quote/${entry.ticker}`,
    url: `https://finance.yahoo.com/quote/${entry.ticker}`,
    title: `${entry.ticker} ${isBuy ? "large block buying" : "large block selling"} — $${usd}M notional (${blockCount} prints)`,
    body: `${isBuy ? "Large block buying" : "Large block selling"} detected in ${entry.ticker}. ${blockCount} block trade print${blockCount === 1 ? "" : "s"} with $${usd}M dominant notional flow. ${isBuy ? "Institutional block buying" : "Institutional block selling"} signal.`,
    language: "en",
    published_at: new Date().toISOString(),
    fetched_at: new Date().toISOString(),
    source_metadata: {
      ticker_hint: entry.ticker,
      sector_hint: entry.sector,
      collector: `${provider}_trade_prints`,
      action,
      block_count: blockCount,
      buy_notional_usd: buyNotional,
      sell_notional_usd: sellNotional
    },
    raw_payload: { buyNotional, sellNotional, blockCount }
  };
}

export function createTradePrintsCollector(app) {
  const { config, pipeline, store } = app;
  const healthKey = `${config.tradePrintsProvider}_trade_prints`;
  let timer = null;
  let running = false;
  let inFlight = false;

  function ensureHealthEntry() {
    if (!store.health.liveSources[healthKey]) {
      store.health.liveSources[healthKey] = {
        enabled: config.tradePrintsEnabled,
        polling: false,
        last_poll_at: null,
        last_success_at: null,
        last_error: null,
        polls: 0,
        consecutive_failures: 0,
        ingested_documents: 0
      };
    }
    return store.health.liveSources[healthKey];
  }

  async function pollOnce() {
    if (!config.tradePrintsEnabled || inFlight) return { ingested: 0, skipped: 0 };
    if (!config.tradePrintsApiKey) {
      ensureHealthEntry().last_error = "no API key configured";
      return { ingested: 0, skipped: 0 };
    }

    inFlight = true;
    const health = ensureHealthEntry();
    health.polling = true;
    health.last_poll_at = new Date().toISOString();
    health.polls += 1;

    let ingested = 0;
    let skipped = 0;
    let errors = 0;

    try {
      for (const entry of WATCHLIST) {
        const seenKey = buildSeenKey(entry.ticker);
        if (store.seenExternalDocuments.has(seenKey)) {
          skipped += 1;
          continue;
        }

        let trades;
        try {
          trades = await fetchTrades(entry.ticker, config);
        } catch {
          errors += 1;
          continue;
        }

        const { buyNotional, sellNotional, blockCount } = classifyTrades(trades, entry.base_price, config.tradePrintsBlockTradeMinNotionalUsd);
        if (blockCount === 0) {
          skipped += 1;
          continue;
        }

        const action = buyNotional >= sellNotional ? "block_trade_buying" : "block_trade_selling";
        store.seenExternalDocuments.add(seenKey);
        await pipeline.processRawDocument(buildRawDocument(entry, action, buyNotional, sellNotional, blockCount, config.tradePrintsProvider));
        ingested += 1;

        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      health.ingested_documents += ingested;
      if (ingested > 0 || errors < WATCHLIST.length) health.last_success_at = new Date().toISOString();
      health.last_error = errors > 0 ? `${errors} tickers failed` : null;
      health.consecutive_failures = errors === WATCHLIST.length ? health.consecutive_failures + 1 : 0;
      return { ingested, skipped, errors };
    } finally {
      health.polling = false;
      inFlight = false;
    }
  }

  function scheduleNext() {
    if (!running || !config.tradePrintsEnabled) return;
    timer = setTimeout(async () => {
      await pollOnce();
      scheduleNext();
    }, config.tradePrintsPollMs);
  }

  return {
    async start() {
      ensureHealthEntry();
      if (running || !config.tradePrintsEnabled) return;
      running = true;
      await pollOnce();
      scheduleNext();
    },
    stop() {
      running = false;
      if (timer) { clearTimeout(timer); timer = null; }
      ensureHealthEntry().polling = false;
    },
    async pollOnce() {
      ensureHealthEntry();
      return pollOnce();
    }
  };
}
```

- [ ] **Step 2: Verify**

```bash
node --input-type=module <<'EOF'
import { createTradePrintsCollector } from "./src/domain/trade-prints.js";
console.log("type:", typeof createTradePrintsCollector);
EOF
```

Expected: `type: function`

- [ ] **Step 3: Commit**

```bash
git add src/domain/trade-prints.js
git commit -m "feat(collectors): add Polygon.io delayed trade prints collector"
```

---

## Task 8: trade-setup.js — earnings_in_window risk flag

**Files:**
- Modify: `src/domain/trade-setup.js`

`buildRiskFlags` is a pure function at line 229. It needs one new parameter to receive the earnings calendar so it can flag setups where earnings are within the next 7 days.

- [ ] **Step 1: Extend buildRiskFlags signature**

Change:
```js
function buildRiskFlags(sentiment, moneyFlow, fundamental, macroRegime, provisional, action) {
```
To:
```js
function buildRiskFlags(sentiment, moneyFlow, fundamental, macroRegime, provisional, action, earningsCalendar) {
```

- [ ] **Step 2: Add the flag logic inside buildRiskFlags**

After `if (fundamental?.direction_label === "bearish_headwind") flags.push("weak_fundamentals");` add:
```js
  const cal = earningsCalendar?.get(sentiment?.ticker);
  if (cal?.days_until != null && cal.days_until >= 0 && cal.days_until <= 7) {
    flags.push("earnings_in_window");
  }
```

- [ ] **Step 3: Pass earningsCalendar at the call site (line 344)**

Change:
```js
        risk_flags: buildRiskFlags(sentiment, moneyFlow, fundamental, macroRegime, provisional, action),
```
To:
```js
        risk_flags: buildRiskFlags(sentiment, moneyFlow, fundamental, macroRegime, provisional, action, store.earningsCalendar),
```

- [ ] **Step 4: Run smoke test to confirm nothing broke**

```bash
node scripts/check.js
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/domain/trade-setup.js
git commit -m "feat(trade-setup): add earnings_in_window risk flag from earnings calendar"
```

---

## Task 9: app.js wiring

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: Add three imports after the secInsider import**

After `import { createSecInsiderCollector } from "./domain/sec-insider.js";` add:
```js
import { createCorporateEventsCollector } from "./domain/corporate-events.js";
import { createSocialSentimentCollector } from "./domain/social-sentiment.js";
import { createTradePrintsCollector } from "./domain/trade-prints.js";
```

- [ ] **Step 2: Instantiate after secInstitutionalCollector**

After `const secInstitutionalCollector = createSecInstitutionalCollector({ config, store, pipeline });` add:
```js
  const corporateEventsCollector = createCorporateEventsCollector({ config, store, pipeline });
  const socialSentimentCollector = createSocialSentimentCollector({ config, store, pipeline });
  const tradePrintsCollector = createTradePrintsCollector({ config, store, pipeline });
```

- [ ] **Step 3: Add to startLiveSources Promise.all**

Inside the `await Promise.all([...])` in `app.startLiveSources`, after `secInstitutionalCollector.start(),` add:
```js
      corporateEventsCollector.start(),
      socialSentimentCollector.start(),
      tradePrintsCollector.start(),
```

- [ ] **Step 4: Add to stopLiveSources**

After `secInstitutionalCollector.stop();` in `app.stopLiveSources`, add:
```js
    corporateEventsCollector.stop();
    socialSentimentCollector.stop();
    tradePrintsCollector.stop();
```

- [ ] **Step 5: Expose getEarningsCalendar**

After the `runTradeSetups()` method in the app object, add:
```js
    getEarningsCalendar() {
      return Object.fromEntries(store.earningsCalendar);
    },
```

- [ ] **Step 6: Add config visibility in getConfig()**

After `sec_13f_enabled: config.sec13fEnabled,` in the `getConfig()` return object, add:
```js
        earnings_enabled: config.earningsEnabled,
        stocktwits_enabled: config.stocktwitsEnabled,
        trade_prints_enabled: config.tradePrintsEnabled,
        trade_prints_provider: config.tradePrintsProvider,
```

- [ ] **Step 7: Run smoke test**

```bash
node scripts/check.js
```

Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add src/app.js
git commit -m "feat(app): wire corporate-events, social-sentiment, and trade-prints collectors"
```

---

## Task 10: check.js smoke test

**Files:**
- Modify: `scripts/check.js`

- [ ] **Step 1: Add imports**

After the existing imports in `scripts/check.js`, add:
```js
import { createCorporateEventsCollector } from "../src/domain/corporate-events.js";
import { createSocialSentimentCollector } from "../src/domain/social-sentiment.js";
import { createTradePrintsCollector } from "../src/domain/trade-prints.js";
```

- [ ] **Step 2: Add collector interface and store assertions**

After the `app.runTradeSetups()` call and the existing trade-setup assertions, add:

```js
// --- New collector interface checks ---
const mockApp = { config: app.config, store: app.store, pipeline: app.pipeline };

const corpEvents = createCorporateEventsCollector(mockApp);
if (typeof corpEvents.start !== "function") throw new Error("createCorporateEventsCollector missing start()");
if (typeof corpEvents.stop !== "function") throw new Error("createCorporateEventsCollector missing stop()");
if (typeof corpEvents.pollOnce !== "function") throw new Error("createCorporateEventsCollector missing pollOnce()");

const socialSent = createSocialSentimentCollector(mockApp);
if (typeof socialSent.start !== "function") throw new Error("createSocialSentimentCollector missing start()");
if (typeof socialSent.stop !== "function") throw new Error("createSocialSentimentCollector missing stop()");

const tradePrints = createTradePrintsCollector(mockApp);
if (typeof tradePrints.start !== "function") throw new Error("createTradePrintsCollector missing start()");
if (typeof tradePrints.stop !== "function") throw new Error("createTradePrintsCollector missing stop()");

if (!(app.store.earningsCalendar instanceof Map))
  throw new Error("store.earningsCalendar is not a Map");

if (typeof app.getEarningsCalendar !== "function")
  throw new Error("app.getEarningsCalendar is not a function");

const calendarSnapshot = app.getEarningsCalendar();
if (typeof calendarSnapshot !== "object" || calendarSnapshot === null)
  throw new Error("getEarningsCalendar() did not return an object");
```

- [ ] **Step 3: Add to summary output**

In the final `console.log` output block, add:
```js
earnings_calendar_tickers: app.store.earningsCalendar.size,
```

- [ ] **Step 4: Run the smoke test**

```bash
node scripts/check.js
```

Expected: exits 0, summary includes `earnings_calendar_tickers: 0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/check.js
git commit -m "test(check): assert new collector interfaces and earningsCalendar store field"
```

---

## Self-review

**Spec coverage:**
- ✅ Earnings calendar collector — Yahoo Finance, no key, hourly poll, emits upcoming + release docs, writes store.earningsCalendar
- ✅ StockTwits social sentiment — no key, 15m poll, emits on ≥60% skew, hourly dedup
- ✅ Delayed trade prints — Polygon/IEX, disabled by default, emits block_trade_buying/selling
- ✅ earnings_in_window risk flag in trade-setup.js
- ✅ Exact collector pattern from live-news.js: ensureHealthEntry → pollOnce → scheduleNext → { start, stop, pollOnce }
- ✅ Config keys for all three collectors
- ✅ SOURCE_TRUST, EVENT_TAXONOMY, HALF_LIFE_HOURS, RULE_PATTERNS extended
- ✅ store.earningsCalendar persisted as runtime_state in both SQLite and Postgres
- ✅ Smoke test asserts collector interfaces and earningsCalendar Map field

**Type consistency:**
- All three factories return `{ start, stop, pollOnce }` — matches live-news.js pattern
- `store.earningsCalendar.get(ticker)` → `{ next_earnings_date, days_until, confirmed, last_checked_at }` — consistent across task 5 (writer) and task 8 (reader)
- `config.earningsEnabled`, `config.stocktwitsEnabled`, `config.tradePrintsEnabled` — Boolean guards used consistently in each collector

**No placeholders.**
