import { WATCHLIST } from "./taxonomy.js";
import { dedupeKey, normalizeWhitespace, round } from "../utils/helpers.js";
import { fetchJsonWithRetry, fetchTextWithRetry } from "../utils/http.js";

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

function extractContainerValue(xml, tagName) {
  const block = extractFirst(xml, tagName);
  if (!block) {
    return "";
  }

  const nestedValue = extractFirst(block, "value");
  return nestedValue || block;
}

function extractBlocks(xml, tagName) {
  return [...String(xml || "").matchAll(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "gi"))].map((match) => match[1]);
}

function parseNumber(value) {
  const parsed = Number(String(value || "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function cikToPaddedString(value) {
  return String(value || "").replace(/\D/g, "").padStart(10, "0");
}

function cikToArchiveString(value) {
  return String(Number(String(value || "").replace(/\D/g, "")));
}

function buildArchiveUrl(cik, accessionNumber, primaryDocument) {
  return `https://www.sec.gov/Archives/edgar/data/${cikToArchiveString(cik)}/${String(accessionNumber).replace(/-/g, "")}/${primaryDocument}`;
}

async function fetchJson(url, config) {
  return fetchJsonWithRetry(url, {
    timeoutMs: config.secRequestTimeoutMs,
    retries: config.secRequestRetries,
    label: "SEC Form 4 request",
    headers: secHeaders(config)
  });
}

async function fetchText(url, config) {
  return fetchTextWithRetry(url, {
    timeoutMs: config.secRequestTimeoutMs,
    retries: config.secRequestRetries,
    label: "SEC Form 4 document request",
    headers: secHeaders(config)
  });
}

async function loadTickerCikMap(config, store) {
  const cache = store.externalLookups.secTickerMap;
  if (cache.data && Date.now() - cache.fetchedAt <= config.secTickerMapCacheMs) {
    return cache.data;
  }

  const payload = await fetchJson("https://www.sec.gov/files/company_tickers.json", config);
  const map = new Map();
  for (const record of Object.values(payload || {})) {
    if (record?.ticker && record?.cik_str) {
      map.set(String(record.ticker).toUpperCase(), cikToPaddedString(record.cik_str));
    }
  }

  cache.data = map;
  cache.fetchedAt = Date.now();
  return map;
}

function formTransactionLabel(transaction) {
  if (transaction.netDirection === "buy") {
    return "open-market share purchase";
  }
  if (transaction.netDirection === "sell") {
    return "open-market share sale";
  }
  return "ownership change";
}

export function parseOwnershipXml(xml) {
  const owners = extractBlocks(xml, "reportingOwner");
  const ownerNames = owners.map((block) => extractFirst(block, "rptOwnerName")).filter(Boolean);
  const relationships = owners
    .map((block) => {
      const relation = extractFirst(block, "officerTitle") || [
        extractFirst(block, "isDirector") === "1" ? "director" : "",
        extractFirst(block, "isOfficer") === "1" ? "officer" : "",
        extractFirst(block, "isTenPercentOwner") === "1" ? "10% owner" : ""
      ]
        .filter(Boolean)
        .join(", ");
      return relation || "insider";
    })
    .filter(Boolean);

  const nonDerivativeTransactions = extractBlocks(xml, "nonDerivativeTransaction");
  const transactions = nonDerivativeTransactions
    .map((block) => {
      const code = extractFirst(block, "transactionCode").toUpperCase();
      const acquiredDisposed = extractContainerValue(block, "transactionAcquiredDisposedCode").toUpperCase();
      const shares = parseNumber(extractContainerValue(block, "transactionShares"));
      const pricePerShare = parseNumber(extractContainerValue(block, "transactionPricePerShare"));
      const date = extractContainerValue(block, "transactionDate");
      const security = extractContainerValue(block, "securityTitle") || "common stock";
      const netDirection = acquiredDisposed === "A" || code === "P" ? "buy" : acquiredDisposed === "D" || code === "S" ? "sell" : "mixed";

      return {
        code,
        shares,
        pricePerShare,
        date,
        security,
        netDirection,
        value: round(shares * pricePerShare, 2)
      };
    })
    .filter((item) => item.shares > 0);

  const totals = transactions.reduce(
    (acc, item) => {
      if (item.netDirection === "buy") {
        acc.buyShares += item.shares;
        acc.buyValue += item.value;
      } else if (item.netDirection === "sell") {
        acc.sellShares += item.shares;
        acc.sellValue += item.value;
      }
      return acc;
    },
    { buyShares: 0, buyValue: 0, sellShares: 0, sellValue: 0 }
  );

  let dominantDirection = "mixed";
  if (totals.buyValue > totals.sellValue) {
    dominantDirection = "buy";
  } else if (totals.sellValue > totals.buyValue) {
    dominantDirection = "sell";
  }

  return {
    ownerNames,
    relationships,
    transactions,
    totals,
    dominantDirection
  };
}

function buildNarrative(ticker, parsed) {
  const ownerLabel = parsed.ownerNames[0] || "an insider";
  const relationLabel = parsed.relationships[0] || "insider";
  const totalBuyShares = parsed.totals.buyShares;
  const totalSellShares = parsed.totals.sellShares;

  if (parsed.dominantDirection === "buy" && totalBuyShares > 0) {
    return `${ownerLabel}, ${relationLabel}, reported an open-market share purchase in a Form 4 filing for ${ticker}. The filing disclosed approximately ${Math.round(totalBuyShares).toLocaleString()} shares acquired with insider conviction.`;
  }

  if (parsed.dominantDirection === "sell" && totalSellShares > 0) {
    return `${ownerLabel}, ${relationLabel}, reported an open-market share sale in a Form 4 filing for ${ticker}. The filing disclosed approximately ${Math.round(totalSellShares).toLocaleString()} shares disposed in the market.`;
  }

  return `${ownerLabel}, ${relationLabel}, reported a Form 4 ownership change for ${ticker}. The filing included insider transaction activity that should be monitored for money-flow context.`;
}

function buildHeadline(ticker, parsed) {
  const ownerLabel = parsed.ownerNames[0] || "Insider";
  return `${ticker}: ${ownerLabel} reports ${formTransactionLabel({ netDirection: parsed.dominantDirection })} in Form 4`;
}

function buildRawDocument(entry, filing, parsed) {
  const accessionNumber = filing.accessionNumber;
  const archiveUrl = buildArchiveUrl(filing.cik, accessionNumber, filing.primaryDocument);
  const totalValue = parsed.dominantDirection === "buy" ? parsed.totals.buyValue : parsed.totals.sellValue;
  const totalShares = parsed.dominantDirection === "buy" ? parsed.totals.buyShares : parsed.totals.sellShares;

  return {
    source_name: "sec_edgar",
    source_type: "insider",
    source_priority: 0.98,
    canonical_url: archiveUrl,
    url: archiveUrl,
    title: buildHeadline(entry.ticker, parsed),
    body: buildNarrative(entry.ticker, parsed),
    language: "en",
    published_at: filing.filingDate ? new Date(`${filing.filingDate}T00:00:00Z`).toISOString() : new Date().toISOString(),
    fetched_at: new Date().toISOString(),
    source_metadata: {
      ticker_hint: entry.ticker,
      sector_hint: entry.sector,
      collector: "sec_form4",
      filing_form: filing.form,
      accession_number: accessionNumber,
      insider_direction: parsed.dominantDirection,
      insider_owner: parsed.ownerNames[0] || null,
      insider_role: parsed.relationships[0] || null,
      transaction_count: parsed.transactions.length,
      transaction_shares: round(totalShares, 0),
      transaction_value_usd: round(totalValue, 2)
    },
    raw_payload: {
      filing,
      parsed
    }
  };
}

async function loadRecentForm4Filings(entry, cik, config) {
  const submissions = await fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`, config);
  const recent = submissions?.filings?.recent;
  if (!recent?.form?.length) {
    return [];
  }

  const filings = [];
  for (let index = 0; index < recent.form.length; index += 1) {
    const form = String(recent.form[index] || "");
    if (form !== "4" && form !== "4/A") {
      continue;
    }

    const filingDate = recent.filingDate[index];
    const filingTime = filingDate ? new Date(`${filingDate}T00:00:00Z`).getTime() : Date.now();
    const ageHours = Math.max(0, (Date.now() - filingTime) / 3_600_000);
    if (ageHours > config.secForm4LookbackHours) {
      continue;
    }

    filings.push({
      cik,
      ticker: entry.ticker,
      form,
      filingDate,
      accessionNumber: recent.accessionNumber[index],
      primaryDocument: recent.primaryDocument[index],
      primaryDocDescription: recent.primaryDocDescription[index]
    });
  }

  return filings;
}

export function createSecInsiderCollector(app) {
  const { config, pipeline, store } = app;
  let timer = null;
  let running = false;
  let inFlight = false;

  function ensureHealthEntry() {
    if (!store.health.liveSources.sec_form4) {
      store.health.liveSources.sec_form4 = {
        enabled: config.secForm4Enabled,
        polling: false,
        last_poll_at: null,
        last_success_at: null,
        last_error: null,
        polls: 0,
        ingested_documents: 0,
        recent_filings_seen: 0
      };
    }

    return store.health.liveSources.sec_form4;
  }

  async function pollOnce() {
    if (!config.secForm4Enabled || inFlight) {
      return { ingested: 0, filings: 0 };
    }

    inFlight = true;
    const health = ensureHealthEntry();
    health.polling = true;
    health.last_poll_at = new Date().toISOString();
    health.polls += 1;

    let ingested = 0;
    let filingsSeen = 0;

    try {
      const tickerMap = await loadTickerCikMap(config, store);

      for (const entry of WATCHLIST) {
        const cik = tickerMap.get(entry.ticker);
        if (!cik) {
          continue;
        }

        const filings = await loadRecentForm4Filings(entry, cik, config);
        filingsSeen += filings.length;

        for (const filing of filings) {
          const seenKey = dedupeKey(["sec_form4", filing.ticker, filing.accessionNumber]);
          if (store.seenExternalDocuments.has(seenKey)) {
            continue;
          }

          try {
            const archiveUrl = buildArchiveUrl(cik, filing.accessionNumber, filing.primaryDocument);
            const xml = await fetchText(archiveUrl, config);
            const parsed = parseOwnershipXml(xml);
            const rawDocument = buildRawDocument(entry, filing, parsed);
            store.seenExternalDocuments.add(seenKey);
            await pipeline.processRawDocument(rawDocument);
            ingested += 1;
          } catch (error) {
            health.last_error = error.message;
          }
        }
      }

      health.ingested_documents += ingested;
      health.recent_filings_seen = filingsSeen;
      health.last_success_at = new Date().toISOString();
      if (!health.last_error || ingested > 0) {
        health.last_error = null;
      }
      return { ingested, filings: filingsSeen };
    } catch (error) {
      health.last_error = error.message;
      return { ingested, filings: filingsSeen, error: error.message };
    } finally {
      health.polling = false;
      inFlight = false;
    }
  }

  function scheduleNext() {
    if (!running || !config.secForm4Enabled) {
      return;
    }

    timer = setTimeout(async () => {
      await pollOnce();
      scheduleNext();
    }, config.secForm4PollMs);
  }

  return {
    async start() {
      ensureHealthEntry();
      if (running || !config.secForm4Enabled) {
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
