#!/usr/bin/env node
/**
 * Daily backup script — safe SQLite snapshot → gzip → Google Drive via rclone
 *
 * Usage:  node scripts/backup.js
 * Cron:   0 2 * * * cd /opt/sentiment-analyst && node scripts/backup.js >> logs/backup.log 2>&1
 *
 * Env vars (all optional, override via .env or shell):
 *   DATABASE_PATH          path to SQLite file  (default: data/sentiment-analyst.sqlite)
 *   BACKUP_RCLONE_REMOTE   rclone remote name   (default: gdrive)
 *   BACKUP_GDRIVE_FOLDER   folder on Drive      (default: sentiment-backups)
 *   BACKUP_KEEP_DAYS       days to retain       (default: 30)
 */

import { DatabaseSync } from "node:sqlite";
import { createGzip } from "node:zlib";
import { createReadStream, createWriteStream, existsSync, unlinkSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── config ──────────────────────────────────────────────────────────────────

const rootDir = fileURLToPath(new URL("../", import.meta.url));

// Load .env without importing the full app config
const envPath = path.join(rootDir, ".env");
if (existsSync(envPath)) {
  const { readFileSync } = await import("node:fs");
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const sep = trimmed.indexOf("=");
    if (sep <= 0) continue;
    const key = trimmed.slice(0, sep).trim();
    const val = trimmed.slice(sep + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && !Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = val;
    }
  }
}

const DB_PATH      = process.env.DATABASE_PATH       || path.join(rootDir, "data", "sentiment-analyst.sqlite");
const RCLONE_REMOTE = process.env.BACKUP_RCLONE_REMOTE || "gdrive";
const GDRIVE_FOLDER = process.env.BACKUP_GDRIVE_FOLDER || "sentiment-backups";
const KEEP_DAYS    = Number(process.env.BACKUP_KEEP_DAYS || 30);

// ── helpers ──────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[backup] ${new Date().toISOString()}  ${msg}`);
}

function silentUnlink(...files) {
  for (const f of files) {
    try { if (existsSync(f)) unlinkSync(f); } catch { /* best-effort */ }
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

const datestamp   = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const backupName  = `sentiment-analyst-${datestamp}.sqlite.gz`;
const tmpSqlite   = path.join(rootDir, "data", `_backup-${datestamp}.sqlite`);
const tmpGz       = path.join(rootDir, "data", backupName);

async function run() {
  if (!existsSync(DB_PATH)) {
    log(`ERROR: database not found at ${DB_PATH}`);
    process.exit(1);
  }

  await mkdir(path.join(rootDir, "data"), { recursive: true });

  // 1. Safe snapshot — VACUUM INTO copies the live DB atomically
  log(`Snapshotting ${DB_PATH} …`);
  const db = new DatabaseSync(DB_PATH, { open: true });
  try {
    db.exec(`VACUUM INTO '${tmpSqlite.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  log("Snapshot done.");

  // 2. Gzip compress
  log("Compressing …");
  await pipeline(
    createReadStream(tmpSqlite),
    createGzip({ level: 6 }),
    createWriteStream(tmpGz)
  );
  silentUnlink(tmpSqlite);
  log(`Compressed → ${backupName}`);

  // 3. Upload to Google Drive
  const remotePath = `${RCLONE_REMOTE}:${GDRIVE_FOLDER}`;
  log(`Uploading to ${remotePath} …`);
  execFileSync("rclone", ["copy", tmpGz, remotePath], { stdio: "inherit" });
  silentUnlink(tmpGz);
  log("Upload complete.");

  // 4. Prune backups older than KEEP_DAYS from Drive
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - KEEP_DAYS);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  log(`Pruning backups older than ${cutoffDate} from ${remotePath} …`);
  let listing = "";
  try {
    listing = execFileSync("rclone", ["lsf", remotePath, "--files-only"], { encoding: "utf8" });
  } catch {
    log("Could not list remote files — skipping prune.");
  }

  const toDelete = listing
    .split("\n")
    .map(f => f.trim())
    .filter(f => /^sentiment-analyst-(\d{4}-\d{2}-\d{2})\.sqlite\.gz$/.test(f))
    .filter(f => f.slice("sentiment-analyst-".length, "sentiment-analyst-".length + 10) < cutoffDate);

  for (const old of toDelete) {
    log(`Deleting old backup: ${old}`);
    execFileSync("rclone", ["deletefile", `${remotePath}/${old}`], { stdio: "inherit" });
  }

  log(`Done. ${toDelete.length} old backup(s) removed. Current archive: ${remotePath}`);
}

run().catch(err => {
  console.error("[backup] FAILED:", err.message);
  silentUnlink(tmpSqlite, tmpGz);
  process.exit(1);
});
