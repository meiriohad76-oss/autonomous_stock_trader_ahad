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
