import { dedupeKey, normalizeWhitespace, round } from "../utils/helpers.js";
import { fetchJsonWithRetry, fetchTextWithRetry } from "../utils/http.js";
import { getTrackedUniverseEntries } from "./tracked-universe.js";

const TRACKED_FILERS = [
  { name: "BERKSHIRE HATHAWAY INC", cik: "0001067983" },
  { name: "VANGUARD GROUP INC", cik: "0000102909" },
  { name: "BLACKROCK, INC.", cik: "0002012383" }
];

function secHeaders(config) {
  return {
    "User-Agent": config.secUserAgent,
    Accept: "application/json, text/xml;q=0.9, text/plain;q=0.8"
  };
}

function extractFirst(xml, tagName) {
  const match = String(xml || "").match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "i"));
  return match ? normalizeWhitespace(match[1]) : "";
}

function extractBlocks(xml, tagName) {
  return [...String(xml || "").matchAll(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "gi"))].map((match) => match[1]);
}

function parseNumber(value) {
  const parsed = Number(String(value || "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeIssuerName(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(inc|corp|corporation|holdings|group|trust|tr|plc|ltd|class|cl|com|common|stock|series|etf)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildUniverseNameMap(entries) {
  return entries.map((entry) => {
    const keys = [entry.company, ...entry.aliases].map(normalizeIssuerName).filter(Boolean);
    return {
      ticker: entry.ticker,
      sector: entry.sector,
      keys
    };
  });
}

function matchUniverseTicker(issuerName, universeNameMap) {
  const normalizedIssuer = normalizeIssuerName(issuerName);
  if (!normalizedIssuer) {
    return null;
  }

  for (const entry of universeNameMap) {
    if (entry.keys.some((key) => normalizedIssuer.includes(key) || key.includes(normalizedIssuer))) {
      return { ticker: entry.ticker, sector: entry.sector };
    }
  }

  return null;
}

function filingArchiveRoot(cik, accessionNumber) {
  return `https://www.sec.gov/Archives/edgar/data/${String(Number(cik))}/${String(accessionNumber).replace(/-/g, "")}`;
}

async function fetchJson(url, config) {
  return fetchJsonWithRetry(url, {
    timeoutMs: config.secRequestTimeoutMs,
    retries: config.secRequestRetries,
    label: "SEC 13F request",
    headers: secHeaders(config)
  });
}

async function fetchText(url, config) {
  return fetchTextWithRetry(url, {
    timeoutMs: config.secRequestTimeoutMs,
    retries: config.secRequestRetries,
    label: "SEC 13F document request",
    headers: secHeaders(config)
  });
}

function findRecent13fFilings(submissions, lookbackHours) {
  const recent = submissions?.filings?.recent;
  if (!recent?.form?.length) {
    return [];
  }

  const filings = [];
  for (let index = 0; index < recent.form.length; index += 1) {
    const form = String(recent.form[index] || "");
    if (form !== "13F-HR" && form !== "13F-HR/A") {
      continue;
    }

    const filingDate = recent.filingDate[index];
    const filingTimestamp = filingDate ? new Date(`${filingDate}T00:00:00Z`).getTime() : Date.now();
    const ageHours = Math.max(0, (Date.now() - filingTimestamp) / 3_600_000);
    if (ageHours > lookbackHours) {
      continue;
    }

    filings.push({
      accessionNumber: recent.accessionNumber[index],
      filingDate,
      form,
      primaryDocument: recent.primaryDocument[index]
    });
  }

  return filings.sort((a, b) => new Date(b.filingDate) - new Date(a.filingDate));
}

async function loadInfoTableXml(cik, accessionNumber, config) {
  const root = filingArchiveRoot(cik, accessionNumber);
  const index = await fetchJson(`${root}/index.json`, config);
  const xmlFile = (index?.directory?.item || []).find((item) => {
    const name = String(item.name || "").toLowerCase();
    return name.endsWith(".xml") && !name.startsWith("primary_doc");
  });

  if (!xmlFile) {
    throw new Error("13F information table XML not found");
  }

  return fetchText(`${root}/${xmlFile.name}`, config);
}

export function parseInfoTable(xml) {
  return extractBlocks(xml, "infoTable").map((block) => ({
    issuer: extractFirst(block, "nameOfIssuer"),
    cusip: extractFirst(block, "cusip"),
    value: parseNumber(extractFirst(block, "value")),
    shares: parseNumber(extractFirst(block, "sshPrnamt")),
    discretion: extractFirst(block, "investmentDiscretion")
  }));
}

function mapUniverseHoldings(rows, universeNameMap) {
  const matched = new Map();
  for (const row of rows) {
    const watch = matchUniverseTicker(row.issuer, universeNameMap);
    if (!watch) {
      continue;
    }
    matched.set(watch.ticker, {
      ticker: watch.ticker,
      sector: watch.sector,
      issuer: row.issuer,
      value: row.value,
      shares: row.shares,
      discretion: row.discretion
    });
  }
  return matched;
}

function buildRawInstitutionalDocument(filer, currentFiling, currentHolding, previousHolding) {
  const deltaShares = currentHolding.shares - (previousHolding?.shares || 0);
  const deltaValue = currentHolding.value - (previousHolding?.value || 0);
  const direction = deltaShares > 0 ? "buy" : deltaShares < 0 ? "sell" : "flat";
  const verb = direction === "buy" ? "increased" : direction === "sell" ? "reduced" : "held";
  const phrase =
    direction === "buy"
      ? "institutional accumulation"
      : direction === "sell"
        ? "institutional distribution"
        : "institutional position update";

  return {
    source_name: "sec_edgar",
    source_type: "filing",
    source_priority: 0.96,
    canonical_url: `${filingArchiveRoot(filer.cik, currentFiling.accessionNumber)}/${currentFiling.primaryDocument}`,
    url: `${filingArchiveRoot(filer.cik, currentFiling.accessionNumber)}/${currentFiling.primaryDocument}`,
    title: `${currentHolding.ticker}: ${filer.name} ${verb} position in latest 13F filing`,
    body: `${filer.name} filed ${currentFiling.form} reporting ${phrase} in ${currentHolding.issuer}. The filing shows a position change of approximately ${Math.abs(Math.round(deltaShares)).toLocaleString()} shares, with reported value changing by about $${Math.abs(Math.round(deltaValue)).toLocaleString()}.`,
    language: "en",
    published_at: currentFiling.filingDate ? new Date(`${currentFiling.filingDate}T00:00:00Z`).toISOString() : new Date().toISOString(),
    fetched_at: new Date().toISOString(),
    source_metadata: {
      ticker_hint: currentHolding.ticker,
      sector_hint: currentHolding.sector,
      collector: "sec_13f",
      filer_name: filer.name,
      filer_cik: filer.cik,
      filing_form: currentFiling.form,
      accession_number: currentFiling.accessionNumber,
      previous_accession_number: previousHolding?.accessionNumber || null,
      institutional_direction: direction,
      position_delta_shares: round(deltaShares, 0),
      position_delta_value_usd: round(deltaValue, 2),
      current_position_shares: round(currentHolding.shares, 0),
      current_position_value_usd: round(currentHolding.value, 2)
    },
    raw_payload: {
      filer,
      currentFiling,
      currentHolding,
      previousHolding
    }
  };
}

export function createSecInstitutionalCollector(app) {
  const { config, pipeline, store } = app;
  let timer = null;
  let running = false;
  let inFlight = false;

  function ensureHealthEntry() {
    if (!store.health.liveSources.sec_13f) {
      store.health.liveSources.sec_13f = {
        enabled: config.sec13fEnabled,
        polling: false,
        last_poll_at: null,
        last_success_at: null,
        last_error: null,
        polls: 0,
        ingested_documents: 0,
        tracked_filers: TRACKED_FILERS.length,
        universe_symbols: 0
      };
    }
    return store.health.liveSources.sec_13f;
  }

  async function pollOnce() {
    if (!config.sec13fEnabled || inFlight) {
      return { ingested: 0 };
    }

    inFlight = true;
    const health = ensureHealthEntry();
    health.polling = true;
    health.last_poll_at = new Date().toISOString();
    health.polls += 1;

    let ingested = 0;

    try {
      const universe = getTrackedUniverseEntries(app, { excludeFunds: true });
      const universeNameMap = buildUniverseNameMap(universe);
      health.universe_symbols = universe.length;

      for (const filer of TRACKED_FILERS) {
        const submissions = await fetchJson(`https://data.sec.gov/submissions/CIK${filer.cik}.json`, config);
        const filings = findRecent13fFilings(submissions, config.sec13fLookbackHours);
        if (filings.length < 2) {
          continue;
        }

        const [currentFiling, previousFiling] = filings;
        const currentSeenKey = dedupeKey(["sec_13f", filer.cik, currentFiling.accessionNumber]);
        if (store.seenExternalDocuments.has(currentSeenKey)) {
          continue;
        }

        const [currentXml, previousXml] = await Promise.all([
          loadInfoTableXml(filer.cik, currentFiling.accessionNumber, config),
          loadInfoTableXml(filer.cik, previousFiling.accessionNumber, config)
        ]);

        const currentHoldings = mapUniverseHoldings(parseInfoTable(currentXml), universeNameMap);
        const previousHoldings = mapUniverseHoldings(parseInfoTable(previousXml), universeNameMap);

        for (const [ticker, currentHolding] of currentHoldings.entries()) {
          const previousHolding = previousHoldings.get(ticker) || null;
          const deltaShares = currentHolding.shares - (previousHolding?.shares || 0);
          if (!deltaShares) {
            continue;
          }

          const itemSeenKey = dedupeKey(["sec_13f", filer.cik, currentFiling.accessionNumber, ticker]);
          if (store.seenExternalDocuments.has(itemSeenKey)) {
            continue;
          }

          store.seenExternalDocuments.add(itemSeenKey);
          await pipeline.processRawDocument(buildRawInstitutionalDocument(filer, currentFiling, currentHolding, previousHolding));
          ingested += 1;
        }

        store.seenExternalDocuments.add(currentSeenKey);
      }

      health.ingested_documents += ingested;
      health.last_success_at = new Date().toISOString();
      health.last_error = null;
      return { ingested };
    } catch (error) {
      health.last_error = error.message;
      return { ingested, error: error.message };
    } finally {
      health.polling = false;
      inFlight = false;
    }
  }

  function scheduleNext() {
    if (!running || !config.sec13fEnabled) {
      return;
    }

    timer = setTimeout(async () => {
      await pollOnce();
      scheduleNext();
    }, config.sec13fPollMs);
  }

  return {
    async start() {
      ensureHealthEntry();
      if (running || !config.sec13fEnabled) {
        return;
      }
      running = true;
      await pollOnce();
      scheduleNext();
    },
    stop() {
      running = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      ensureHealthEntry().polling = false;
    },
    async pollOnce() {
      ensureHealthEntry();
      return pollOnce();
    }
  };
}
