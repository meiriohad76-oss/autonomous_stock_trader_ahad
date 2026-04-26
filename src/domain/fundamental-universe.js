import { fingerprint, round } from "../utils/helpers.js";

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

const DEFAULT_METRIC_RANGES = {
  revenue_growth_yoy: [0.01, 0.2],
  eps_growth_yoy: [-0.03, 0.22],
  fcf_growth_yoy: [-0.08, 0.2],
  gross_margin: [0.2, 0.72],
  operating_margin: [0.06, 0.32],
  net_margin: [0.04, 0.24],
  roe: [0.07, 0.28],
  roic: [0.05, 0.22],
  debt_to_equity: [0.08, 1.15],
  net_debt_to_ebitda: [-0.4, 3.6],
  current_ratio: [0.9, 2.3],
  interest_coverage: [5, 42],
  fcf_margin: [0.02, 0.22],
  fcf_conversion: [0.45, 1.02],
  asset_turnover: [0.28, 1.05],
  margin_stability: [0.48, 0.9],
  revenue_consistency: [0.45, 0.88],
  pe_ttm: [15, 48],
  ev_to_ebitda_ttm: [9, 28],
  price_to_sales_ttm: [1.8, 11.5],
  peg: [0.9, 3.4],
  fcf_yield: [0.01, 0.055]
};

const SECTOR_METRIC_RANGES = {
  "Information Technology": {
    revenue_growth_yoy: [0.04, 0.24],
    gross_margin: [0.38, 0.8],
    operating_margin: [0.1, 0.38],
    pe_ttm: [20, 54],
    price_to_sales_ttm: [3, 15],
    peg: [1.1, 3.6]
  },
  "Communication Services": {
    revenue_growth_yoy: [0.03, 0.22],
    gross_margin: [0.32, 0.72],
    operating_margin: [0.08, 0.34],
    pe_ttm: [16, 34],
    price_to_sales_ttm: [2.2, 9.5]
  },
  "Consumer Discretionary": {
    revenue_growth_yoy: [0.02, 0.2],
    gross_margin: [0.18, 0.52],
    operating_margin: [0.04, 0.19],
    pe_ttm: [18, 60],
    current_ratio: [0.85, 1.9]
  },
  "Consumer Staples": {
    revenue_growth_yoy: [0.01, 0.12],
    gross_margin: [0.22, 0.48],
    operating_margin: [0.06, 0.21],
    pe_ttm: [15, 31],
    fcf_yield: [0.02, 0.06]
  },
  "Health Care": {
    revenue_growth_yoy: [0.03, 0.18],
    gross_margin: [0.42, 0.82],
    operating_margin: [0.08, 0.32],
    pe_ttm: [17, 45],
    current_ratio: [1, 2.8]
  },
  Financials: {
    revenue_growth_yoy: [0.01, 0.13],
    gross_margin: [0.28, 0.62],
    operating_margin: [0.12, 0.33],
    debt_to_equity: [0.4, 1.45],
    current_ratio: [0.85, 1.5],
    pe_ttm: [10, 23],
    fcf_yield: [0.025, 0.07]
  },
  Industrials: {
    revenue_growth_yoy: [0.01, 0.16],
    gross_margin: [0.18, 0.46],
    operating_margin: [0.05, 0.2],
    asset_turnover: [0.45, 1.18]
  },
  Energy: {
    revenue_growth_yoy: [-0.02, 0.18],
    gross_margin: [0.16, 0.42],
    operating_margin: [0.04, 0.22],
    pe_ttm: [8, 19],
    fcf_yield: [0.03, 0.09]
  },
  Materials: {
    revenue_growth_yoy: [0, 0.14],
    gross_margin: [0.17, 0.38],
    operating_margin: [0.04, 0.18]
  },
  Utilities: {
    revenue_growth_yoy: [0, 0.08],
    gross_margin: [0.18, 0.34],
    operating_margin: [0.07, 0.2],
    pe_ttm: [12, 27],
    current_ratio: [0.75, 1.5]
  },
  "Real Estate": {
    revenue_growth_yoy: [0, 0.09],
    gross_margin: [0.22, 0.5],
    operating_margin: [0.08, 0.24],
    debt_to_equity: [0.35, 1.5]
  }
};

const DEFAULT_QUALITY_FLAG_RANGES = {
  missing_fields_count: [2, 5],
  reporting_confidence_score: [0.72, 0.84],
  data_freshness_score: [0.69, 0.82],
  peer_comparability_score: [0.66, 0.8],
  rule_confidence: [0.7, 0.82],
  llm_confidence: [0.68, 0.78]
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

function deterministicUnit(value) {
  const hex = fingerprint(value).slice(0, 8);
  return parseInt(hex, 16) / 0xffffffff;
}

function rangeValue(seed, min, max, digits = 6) {
  return round(min + deterministicUnit(seed) * (max - min), digits);
}

function metricRangesForSector(sector) {
  return {
    ...DEFAULT_METRIC_RANGES,
    ...(SECTOR_METRIC_RANGES[sector] || {})
  };
}

function buildPlaceholderMetrics({ ticker, sector, inSp100, inQqq }) {
  const ranges = metricRangesForSector(sector);
  const sizeLift = inSp100 ? 0.01 : 0;
  const qqqGrowthLift = inQqq ? 0.015 : 0;

  return {
    revenue_growth_yoy: round(rangeValue(`${ticker}:revenue_growth`, ...ranges.revenue_growth_yoy) + qqqGrowthLift, 6),
    eps_growth_yoy: rangeValue(`${ticker}:eps_growth`, ...ranges.eps_growth_yoy),
    fcf_growth_yoy: rangeValue(`${ticker}:fcf_growth`, ...ranges.fcf_growth_yoy),
    gross_margin: rangeValue(`${ticker}:gross_margin`, ...ranges.gross_margin),
    operating_margin: rangeValue(`${ticker}:operating_margin`, ...ranges.operating_margin),
    net_margin: rangeValue(`${ticker}:net_margin`, ...ranges.net_margin),
    roe: rangeValue(`${ticker}:roe`, ...ranges.roe),
    roic: rangeValue(`${ticker}:roic`, ...ranges.roic),
    debt_to_equity: rangeValue(`${ticker}:debt_to_equity`, ...ranges.debt_to_equity),
    net_debt_to_ebitda: rangeValue(`${ticker}:net_debt_to_ebitda`, ...ranges.net_debt_to_ebitda),
    current_ratio: round(rangeValue(`${ticker}:current_ratio`, ...ranges.current_ratio) + sizeLift, 6),
    interest_coverage: rangeValue(`${ticker}:interest_coverage`, ...ranges.interest_coverage),
    fcf_margin: rangeValue(`${ticker}:fcf_margin`, ...ranges.fcf_margin),
    fcf_conversion: rangeValue(`${ticker}:fcf_conversion`, ...ranges.fcf_conversion),
    asset_turnover: rangeValue(`${ticker}:asset_turnover`, ...ranges.asset_turnover),
    margin_stability: rangeValue(`${ticker}:margin_stability`, ...ranges.margin_stability),
    revenue_consistency: rangeValue(`${ticker}:revenue_consistency`, ...ranges.revenue_consistency),
    pe_ttm: rangeValue(`${ticker}:pe_ttm`, ...ranges.pe_ttm),
    ev_to_ebitda_ttm: rangeValue(`${ticker}:ev_to_ebitda_ttm`, ...ranges.ev_to_ebitda_ttm),
    price_to_sales_ttm: rangeValue(`${ticker}:price_to_sales_ttm`, ...ranges.price_to_sales_ttm),
    peg: rangeValue(`${ticker}:peg`, ...ranges.peg),
    fcf_yield: rangeValue(`${ticker}:fcf_yield`, ...ranges.fcf_yield)
  };
}

function buildPlaceholderQualityFlags({ ticker, inSp100, inQqq }) {
  const missingFields = Math.round(
    rangeValue(`${ticker}:missing_fields_count`, ...DEFAULT_QUALITY_FLAG_RANGES.missing_fields_count, 0)
  );
  const anomalyFlags = ["awaiting_sec_refresh", "bootstrap_placeholder"];

  if (!inSp100 && inQqq) {
    anomalyFlags.push("qqq_seed_only");
  }

  return {
    restatement_flag: false,
    missing_fields_count: missingFields,
    anomaly_flags: anomalyFlags,
    reporting_confidence_score: rangeValue(`${ticker}:reporting_confidence`, ...DEFAULT_QUALITY_FLAG_RANGES.reporting_confidence_score),
    data_freshness_score: rangeValue(`${ticker}:data_freshness`, ...DEFAULT_QUALITY_FLAG_RANGES.data_freshness_score),
    peer_comparability_score: rangeValue(`${ticker}:peer_comparability`, ...DEFAULT_QUALITY_FLAG_RANGES.peer_comparability_score),
    rule_confidence: rangeValue(`${ticker}:rule_confidence`, ...DEFAULT_QUALITY_FLAG_RANGES.rule_confidence),
    llm_confidence: rangeValue(`${ticker}:llm_confidence`, ...DEFAULT_QUALITY_FLAG_RANGES.llm_confidence)
  };
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
  const sector = normalizeSectorLabel(sp100Record?.sector);

  return {
    ticker,
    company_name:
      QQQ_NAME_OVERRIDES.get(ticker) ||
      sp100Record?.company_name ||
      secRecord?.company_name ||
      ticker,
    sector,
    industry: sp100Record?.sector ? `${sector} Constituents` : "Pending SEC classification",
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
        ? "Bootstrapped into coverage from the S&P 100 and QQQ universe while the live SEC filing refresh catches up."
        : inSp100
          ? "Bootstrapped into coverage from the S&P 100 universe while the live SEC filing refresh catches up."
          : "Bootstrapped into coverage from the QQQ universe while the live SEC filing refresh catches up.",
    notes: [
      inSp100 && inQqq
        ? "This company sits in both the S&P 100 and QQQ coverage universes."
        : inSp100
          ? "This company is seeded from the S&P 100 coverage universe."
          : "This company is seeded from the QQQ coverage universe.",
      "Live SEC filings will replace this placeholder classification and metric pack after startup."
    ],
    data_source: "bootstrap_placeholder",
    metrics: buildPlaceholderMetrics({ ticker, sector, inSp100, inQqq }),
    quality_flags: buildPlaceholderQualityFlags({ ticker, inSp100, inQqq }),
    previous_composite_score: rangeValue(`${ticker}:previous_composite_score`, 0.36, 0.66, 3)
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
