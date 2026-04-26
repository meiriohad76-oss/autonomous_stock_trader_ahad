const OEF_HOLDINGS_URL =
  "https://www.ishares.com/us/products/239723/ishares-sp-100-etf/1467271812596.ajax?dataType=fund&fileName=OEF_holdings&fileType=csv";

const QQQ_TICKERS = [
  "NVDA", "GOOGL", "GOOG", "AAPL", "MSFT", "AMZN", "AVGO", "META", "TSLA", "WMT",
  "AMD", "ASML", "MU", "COST", "INTC", "NFLX", "CSCO", "PLTR", "LRCX", "AMAT",
  "KLAC", "TXN", "ARM", "LIN", "PEP", "TMUS", "ADI", "AMGN", "ISRG", "SHOP",
  "GILD", "QCOM", "APP", "PANW", "MRVL", "BKNG", "PDD", "WDC", "HON", "STX",
  "CRWD", "CEG", "SBUX", "INTU", "VRTX", "ADBE", "CMCSA", "MAR", "SNPS", "MELI",
  "CDNS", "ABNB", "CSX", "MPWR", "ADP", "ORLY", "DASH", "MNST", "REGN", "MDLZ",
  "AEP", "ROST", "CTAS", "BKR", "WBD", "PCAR", "FTNT", "NXPI", "MSTR", "FANG",
  "FAST", "EA", "ADSK", "FER", "XEL", "MCHP", "EXC", "ODFL", "DDOG", "PYPL",
  "IDXX", "CCEP", "ALNY", "KDP", "TRI", "TTWO", "ROP", "PAYX", "AXON", "CPRT",
  "GEHC", "WDAY", "INSM", "CTSH", "KHC", "CHTR", "DXCM", "VRSK", "ZS", "SNDK",
  "CSGP"
];

const SP100_FALLBACK_TICKERS = [
  "NVDA", "AAPL", "MSFT", "AMZN", "AVGO", "GOOGL", "GOOG", "META", "TSLA", "BRKB",
  "JPM", "LLY", "XOM", "WMT", "JNJ", "MU", "V", "AMD", "COST", "MA",
  "NFLX", "CAT", "ABBV", "CVX", "CSCO", "BAC", "HD", "PG", "PLTR", "LRCX",
  "UNH", "AMAT", "INTC", "GEV", "ORCL", "GE", "KO", "MRK", "GS", "PM",
  "TXN", "WFC", "RTX", "LIN", "MS", "C", "IBM", "MCD", "PEP", "NEE",
  "VZ", "AMGN", "T", "BA", "DIS", "TMO", "AXP", "ISRG", "GILD", "CRM",
  "UNP", "ABT", "UBER", "COP", "PFE", "BLK", "DE", "SCHW", "QCOM", "BKNG",
  "LOW", "HON", "COF", "BMY", "CMCSA", "SBUX", "DHR", "MO", "ACN", "MDT",
  "LMT", "INTU", "SO", "CVS", "DUK", "ADBE", "BK", "TMUS", "NOW", "USB",
  "FDX", "AMT", "GD", "EMR", "UPS", "MMM", "MDLZ", "GM", "CL", "SPG",
  "NKE"
];

const QQQ_NAME_OVERRIDES = new Map([
  ["AAPL", "Apple Inc."],
  ["ABNB", "Airbnb, Inc."],
  ["ADBE", "Adobe Inc."],
  ["ADI", "Analog Devices, Inc."],
  ["ADP", "Automatic Data Processing, Inc."],
  ["ADSK", "Autodesk, Inc."],
  ["AEP", "American Electric Power Company, Inc."],
  ["ALNY", "Alnylam Pharmaceuticals, Inc."],
  ["AMAT", "Applied Materials, Inc."],
  ["AMD", "Advanced Micro Devices, Inc."],
  ["AMGN", "Amgen Inc."],
  ["AMZN", "Amazon.com, Inc."],
  ["APP", "AppLovin Corporation"],
  ["ARM", "Arm Holdings plc"],
  ["ASML", "ASML Holding N.V."],
  ["AVGO", "Broadcom Inc."],
  ["AXON", "Axon Enterprise, Inc."],
  ["BKR", "Baker Hughes Company"],
  ["BKNG", "Booking Holdings Inc."],
  ["CCEP", "Coca-Cola Europacific Partners PLC"],
  ["CDNS", "Cadence Design Systems, Inc."],
  ["CEG", "Constellation Energy Corporation"],
  ["CHTR", "Charter Communications, Inc."],
  ["CMCSA", "Comcast Corporation"],
  ["CPRT", "Copart, Inc."],
  ["CRWD", "CrowdStrike Holdings, Inc."],
  ["CSCO", "Cisco Systems, Inc."],
  ["CSGP", "CoStar Group, Inc."],
  ["CSX", "CSX Corporation"],
  ["CTAS", "Cintas Corporation"],
  ["CTSH", "Cognizant Technology Solutions Corporation"],
  ["COST", "Costco Wholesale Corporation"],
  ["DASH", "DoorDash, Inc."],
  ["DDOG", "Datadog, Inc."],
  ["DXCM", "DexCom, Inc."],
  ["EA", "Electronic Arts Inc."],
  ["EXC", "Exelon Corporation"],
  ["FANG", "Diamondback Energy, Inc."],
  ["FAST", "Fastenal Company"],
  ["FER", "Ferrovial SE"],
  ["FTNT", "Fortinet, Inc."],
  ["GEHC", "GE HealthCare Technologies Inc."],
  ["GILD", "Gilead Sciences, Inc."],
  ["GOOG", "Alphabet Inc."],
  ["GOOGL", "Alphabet Inc."],
  ["HON", "Honeywell International Inc."],
  ["IDXX", "IDEXX Laboratories, Inc."],
  ["INSM", "Insmed Incorporated"],
  ["INTC", "Intel Corporation"],
  ["INTU", "Intuit Inc."],
  ["ISRG", "Intuitive Surgical, Inc."],
  ["KDP", "Keurig Dr Pepper Inc."],
  ["KHC", "The Kraft Heinz Company"],
  ["KLAC", "KLA Corporation"],
  ["LIN", "Linde plc"],
  ["LRCX", "Lam Research Corporation"],
  ["MAR", "Marriott International, Inc."],
  ["MCHP", "Microchip Technology Incorporated"],
  ["MDLZ", "Mondelez International, Inc."],
  ["MELI", "MercadoLibre, Inc."],
  ["META", "Meta Platforms, Inc."],
  ["MNST", "Monster Beverage Corporation"],
  ["MPWR", "Monolithic Power Systems, Inc."],
  ["MRVL", "Marvell Technology, Inc."],
  ["MSFT", "Microsoft Corporation"],
  ["MSTR", "Strategy Inc"],
  ["MU", "Micron Technology, Inc."],
  ["NFLX", "Netflix, Inc."],
  ["NVDA", "NVIDIA Corporation"],
  ["NXPI", "NXP Semiconductors N.V."],
  ["ODFL", "Old Dominion Freight Line, Inc."],
  ["ORLY", "O'Reilly Automotive, Inc."],
  ["PANW", "Palo Alto Networks, Inc."],
  ["PAYX", "Paychex, Inc."],
  ["PCAR", "PACCAR Inc"],
  ["PDD", "PDD Holdings Inc."],
  ["PEP", "PepsiCo, Inc."],
  ["PLTR", "Palantir Technologies Inc."],
  ["PYPL", "PayPal Holdings, Inc."],
  ["QCOM", "QUALCOMM Incorporated"],
  ["REGN", "Regeneron Pharmaceuticals, Inc."],
  ["ROP", "Roper Technologies, Inc."],
  ["ROST", "Ross Stores, Inc."],
  ["SBUX", "Starbucks Corporation"],
  ["SHOP", "Shopify Inc."],
  ["SNPS", "Synopsys, Inc."],
  ["SNDK", "Sandisk Corporation"],
  ["STX", "Seagate Technology Holdings plc"],
  ["TMUS", "T-Mobile US, Inc."],
  ["TRI", "Thomson Reuters Corporation"],
  ["TSLA", "Tesla, Inc."],
  ["TTWO", "Take-Two Interactive Software, Inc."],
  ["TXN", "Texas Instruments Incorporated"],
  ["VRSK", "Verisk Analytics, Inc."],
  ["VRTX", "Vertex Pharmaceuticals Incorporated"],
  ["WBD", "Warner Bros. Discovery, Inc."],
  ["WDAY", "Workday, Inc."],
  ["WDC", "Western Digital Corporation"],
  ["WMT", "Walmart Inc."],
  ["XEL", "Xcel Energy Inc."],
  ["ZS", "Zscaler, Inc."]
]);

const DEFAULT_METRICS = {
  revenue_growth_yoy: 0.11,
  eps_growth_yoy: 0.1,
  fcf_growth_yoy: 0.08,
  gross_margin: 0.42,
  operating_margin: 0.18,
  net_margin: 0.14,
  roe: 0.17,
  roic: 0.13,
  debt_to_equity: 0.7,
  net_debt_to_ebitda: 1.4,
  current_ratio: 1.35,
  interest_coverage: 12,
  fcf_margin: 0.1,
  fcf_conversion: 0.86,
  asset_turnover: 0.8,
  margin_stability: 0.68,
  revenue_consistency: 0.7,
  pe_ttm: 26,
  ev_to_ebitda_ttm: 16,
  price_to_sales_ttm: 5,
  peg: 1.9,
  fcf_yield: 0.03
};

const DEFAULT_QUALITY_FLAGS = {
  restatement_flag: false,
  missing_fields_count: 2,
  anomaly_flags: ["awaiting_sec_refresh"],
  reporting_confidence_score: 0.8,
  data_freshness_score: 0.78,
  peer_comparability_score: 0.74,
  rule_confidence: 0.79,
  llm_confidence: 0.72
};

function withTimeout(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer);
    }
  };
}

function secHeaders(config) {
  return {
    "User-Agent": config.secUserAgent,
    Accept: "application/json, text/plain;q=0.9"
  };
}

function normalizeSectorLabel(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "Unknown";
  }

  if (normalized === "Communication") {
    return "Communication Services";
  }

  return normalized;
}

function parseCsvLine(line) {
  return [...line.matchAll(/"([^"]*)"|([^,]+)/g)].map((match) => (match[1] ?? match[2] ?? "").trim());
}

async function fetchSecCompanyDirectory(config) {
  const request = withTimeout(config.secRequestTimeoutMs || 15000);
  try {
    const response = await fetch("https://www.sec.gov/files/company_tickers.json", {
      signal: request.signal,
      headers: secHeaders(config)
    });
    if (!response.ok) {
      throw new Error(`SEC company directory request failed with ${response.status}`);
    }

    const payload = await response.json();
    return new Map(
      Object.values(payload || {})
        .filter((entry) => entry?.ticker)
        .map((entry) => [
          String(entry.ticker).toUpperCase(),
          {
            cik: String(entry.cik_str || "").replace(/\D/g, "").padStart(10, "0") || null,
            company_name: String(entry.title || "").trim() || null
          }
        ])
    );
  } finally {
    request.clear();
  }
}

async function fetchLiveSp100Map(config) {
  const request = withTimeout(15000);
  try {
    const response = await fetch(OEF_HOLDINGS_URL, {
      signal: request.signal,
      headers: {
        "User-Agent": config.secUserAgent,
        Accept: "text/csv, text/plain;q=0.9"
      }
    });
    if (!response.ok) {
      throw new Error(`S&P 100 holdings request failed with ${response.status}`);
    }

    const text = await response.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    const start = lines.findIndex((line) => line.startsWith("Ticker,Name,Sector,Asset Class"));
    if (start < 0) {
      throw new Error("S&P 100 holdings file did not contain the expected header row");
    }

    return new Map(
      lines
        .slice(start + 1)
        .filter((line) => line.startsWith("\""))
        .map(parseCsvLine)
        .filter((cells) => cells[3] === "Equity")
        .map((cells) => [
          cells[0],
          {
            ticker: cells[0],
            company_name: cells[1],
            sector: normalizeSectorLabel(cells[2]),
            exchange: cells[10] && cells[10] !== "-" ? cells[10] : null
          }
        ])
    );
  } finally {
    request.clear();
  }
}

function buildFallbackSp100Map() {
  return new Map(
    SP100_FALLBACK_TICKERS.map((ticker) => [
      ticker,
      {
        ticker,
        company_name: null,
        sector: "Unknown",
        exchange: null
      }
    ])
  );
}

function buildPlaceholderCompany({
  asOf,
  ticker,
  sp100Record,
  secRecord,
  inSp100,
  inQqq
}) {
  return {
    ticker,
    company_name:
      QQQ_NAME_OVERRIDES.get(ticker) ||
      sp100Record?.company_name ||
      secRecord?.company_name ||
      ticker,
    sector: normalizeSectorLabel(sp100Record?.sector),
    industry: sp100Record?.sector ? `${normalizeSectorLabel(sp100Record.sector)} Constituents` : "Pending SEC classification",
    exchange: sp100Record?.exchange || (inQqq ? "NASDAQ" : "NYSE"),
    market_cap_bucket: inSp100 ? "mega_cap" : "large_cap",
    cik: secRecord?.cik || null,
    as_of: asOf,
    filing_date: asOf.slice(0, 10),
    period_end: asOf.slice(0, 10),
    form_type: "BOOTSTRAP",
    filing_url: "",
    summary:
      inSp100 && inQqq
        ? "Loaded from the S&P 100 and QQQ universe bootstrap while the live SEC refresh catches up."
        : inSp100
          ? "Loaded from the S&P 100 universe bootstrap while the live SEC refresh catches up."
          : "Loaded from the QQQ holdings universe bootstrap while the live SEC refresh catches up.",
    notes: [
      inSp100 && inQqq
        ? "This company sits in both the S&P 100 and QQQ coverage universes."
        : inSp100
          ? "This company is seeded from the S&P 100 coverage universe."
          : "This company is seeded from the QQQ coverage universe.",
      "Live SEC filings will replace this placeholder classification and metric pack after startup."
    ],
    metrics: { ...DEFAULT_METRICS },
    quality_flags: { ...DEFAULT_QUALITY_FLAGS },
    previous_composite_score: 0.5
  };
}

export async function loadFundamentalUniverse({ config }) {
  const asOf = new Date().toISOString();
  const secDirectory = await fetchSecCompanyDirectory(config);

  let sp100Map = null;
  let sp100Source = "official_live";
  try {
    sp100Map = await fetchLiveSp100Map(config);
  } catch {
    sp100Map = buildFallbackSp100Map();
    sp100Source = "cached_fallback";
  }

  const qqqSet = new Set(QQQ_TICKERS);
  const sp100Set = new Set(sp100Map.keys());
  const orderedTickers = [...new Set([...sp100Map.keys(), ...QQQ_TICKERS])];
  const companies = orderedTickers.map((ticker) =>
    buildPlaceholderCompany({
      asOf,
      ticker,
      sp100Record: sp100Map.get(ticker) || null,
      secRecord: secDirectory.get(ticker) || null,
      inSp100: sp100Set.has(ticker),
      inQqq: qqqSet.has(ticker)
    })
  );

  return {
    asOf,
    universeName: "S&P 100 + QQQ Holdings",
    sources: {
      sp100: sp100Source,
      qqq: "nasdaq_100_curated_apr_2026"
    },
    counts: {
      sp100: sp100Set.size,
      qqq: qqqSet.size,
      combined: companies.length
    },
    companies
  };
}
