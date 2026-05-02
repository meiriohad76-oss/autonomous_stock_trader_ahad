function cleanTicker(value) {
  return String(value || "").toUpperCase().trim();
}

function cleanCompanyName(entry, ticker) {
  return entry.company || entry.company_name || entry.name || entry.entity_name || ticker;
}

function defaultAliases(company) {
  const normalized = String(company || "")
    .replace(/\b(incorporated|inc|corporation|corp|company|co|plc|ltd|holdings|holding|class|common|stock)\b\.?/gi, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized && normalized !== company ? [normalized] : [];
}

export function normalizeUniverseEntry(entry = {}) {
  const ticker = cleanTicker(entry.ticker || entry.symbol || entry.entity_key);
  if (!ticker) {
    return null;
  }

  const company = cleanCompanyName(entry, ticker);
  const aliases = [...new Set([...(Array.isArray(entry.aliases) ? entry.aliases : []), ...defaultAliases(company)])]
    .map((alias) => String(alias || "").trim())
    .filter(Boolean);

  return {
    ticker,
    company,
    company_name: company,
    sector: entry.sector || "Unknown",
    industry: entry.industry || null,
    aliases,
    base_price: Number(entry.base_price ?? entry.current_price ?? entry.market_reference?.current_price) || null,
    market_reference: entry.market_reference || null
  };
}

export function uniqueUniverseEntries(entries = []) {
  const seen = new Set();
  const normalized = [];

  for (const entry of Array.isArray(entries) ? entries : []) {
    const next = normalizeUniverseEntry(entry);
    if (!next || seen.has(next.ticker)) {
      continue;
    }
    seen.add(next.ticker);
    normalized.push(next);
  }

  return normalized;
}

export function getTrackedUniverseEntries(source = {}, options = {}) {
  const rawEntries =
    typeof source.getTrackedFundamentalCompanies === "function"
      ? source.getTrackedFundamentalCompanies()
      : typeof source.getUniverseEntries === "function"
        ? source.getUniverseEntries()
        : source.store?.fundamentals?.leaderboard || source.fundamentals?.leaderboard || [];

  const entries = uniqueUniverseEntries(rawEntries);
  if (!options.excludeFunds) {
    return entries;
  }

  return entries.filter((entry) => !/\b(etf|fund|trust)\b/i.test(`${entry.sector} ${entry.industry} ${entry.company}`));
}

export function buildUniverseLookup(entries = []) {
  return new Map(uniqueUniverseEntries(entries).map((entry) => [entry.ticker, entry]));
}

export function lookupUniverseEntry(entries = [], ticker) {
  return buildUniverseLookup(entries).get(cleanTicker(ticker)) || null;
}

export function rotateUniverseEntries(entries, cursor, maxCount) {
  if (!entries.length) {
    return { selected: [], nextCursor: 0 };
  }

  const limit = Math.min(entries.length, Math.max(1, Math.floor(Number(maxCount || entries.length))));
  const selected = [];
  for (let offset = 0; offset < limit; offset += 1) {
    selected.push(entries[(cursor + offset) % entries.length]);
  }

  return {
    selected,
    nextCursor: (cursor + limit) % entries.length
  };
}
