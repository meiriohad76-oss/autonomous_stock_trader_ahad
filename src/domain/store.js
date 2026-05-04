import { EventEmitter } from "node:events";
import { createEmptyFundamentalsState } from "./fundamentals.js";
import { createEmptyFundamentalPersistence } from "./fundamental-persistence.js";

export function createStore(config) {
  return {
    config,
    bus: new EventEmitter(),
    rawDocuments: [],
    normalizedDocuments: [],
    documentEntities: [],
    documentScores: [],
    sentimentStates: [],
    sourceStats: new Map(),
    dedupeClusters: new Map(),
    seenExternalDocuments: new Set(),
    externalLookups: {
      secTickerMap: {
        data: null,
        fetchedAt: 0
      }
    },
    alertHistory: [],
    eventOutcomes: [],
    evidenceQuality: {
      items: [],
      summary: null
    },
    fundamentals: createEmptyFundamentalsState(),
    fundamentalWarehouse: createEmptyFundamentalPersistence(),
    macroRegimeHistory: [],
    tradeSetupHistory: [],
    macroRegime: null,
    tradeSetups: [],
    sectorEtfReferences: new Map(),
    earningsCalendar: new Map(),
    pendingApprovals: new Map(),
    positions: new Map(),
    orders: new Map(),
    fundamentalUniverse: null,
    agencyCycleLog: [],
    agencyCycleHistory: [],
    llmSelectionHistory: [],
    finalSelectionHistory: [],
    tradingSelectionPassHistory: [],
    riskSnapshotHistory: [],
    positionMonitorHistory: [],
    executionIntentHistory: [],
    executionState: {
      enabled: false,
      killSwitch: false,
      killSwitchReason: null,
      dailyPnl: 0,
      dailyPnlResetAt: new Date().toISOString(),
      highWaterMark: 0,
      accountEquity: 0,
      lastSyncAt: null
    },
    executionLog: [],
    health: {
      systemStatus: "green",
      queueDepth: 0,
      llmLatencyMs: 18,
      documentsProcessedToday: 0,
      fundamentalCompaniesScored: 0,
      fundamentalSectorsCovered: 0,
      lastUpdate: null,
      lastReplayAt: null,
      liveSources: {},
      databaseBackup: null
    }
  };
}

export function resetStore(store) {
  store.rawDocuments = [];
  store.normalizedDocuments = [];
  store.documentEntities = [];
  store.documentScores = [];
  store.sentimentStates = [];
  store.sourceStats = new Map();
  store.dedupeClusters = new Map();
  store.seenExternalDocuments = new Set();
  store.externalLookups = {
    secTickerMap: {
      data: null,
      fetchedAt: 0
    }
  };
  store.alertHistory = [];
  store.eventOutcomes = [];
  store.evidenceQuality = {
    items: [],
    summary: null
  };
  store.fundamentals = createEmptyFundamentalsState();
  store.fundamentalWarehouse = createEmptyFundamentalPersistence();
  store.macroRegimeHistory = [];
  store.tradeSetupHistory = [];
  store.macroRegime = null;
  store.tradeSetups = [];
  store.sectorEtfReferences = new Map();
  store.earningsCalendar = new Map();
  store.pendingApprovals = new Map();
  store.positions = new Map();
  store.orders = new Map();
  store.fundamentalUniverse = null;
  store.agencyCycleLog = [];
  store.agencyCycleHistory = [];
  store.llmSelectionHistory = [];
  store.finalSelectionHistory = [];
  store.tradingSelectionPassHistory = [];
  store.riskSnapshotHistory = [];
  store.positionMonitorHistory = [];
  store.executionIntentHistory = [];
  store.executionState = {
    enabled: false,
    killSwitch: false,
    killSwitchReason: null,
    dailyPnl: 0,
    dailyPnlResetAt: new Date().toISOString(),
    highWaterMark: 0,
    accountEquity: 0,
    lastSyncAt: null
  };
  store.executionLog = [];
  store.health = {
    ...store.health,
    queueDepth: 0,
    documentsProcessedToday: 0,
    fundamentalCompaniesScored: 0,
    fundamentalSectorsCovered: 0,
    lastUpdate: null,
    lastReplayAt: new Date().toISOString(),
    liveSources: {},
    databaseBackup: store.health.databaseBackup || null
  };
}
