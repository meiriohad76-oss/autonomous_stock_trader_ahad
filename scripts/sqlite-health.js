import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../src/config.js";

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return null;
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function listBackups() {
  if (!config.sqliteBackupDir || !existsSync(config.sqliteBackupDir)) {
    return [];
  }

  return readdirSync(config.sqliteBackupDir)
    .filter((name) => /^sentiment-analyst-\d{8}-\d{6}-\d{3}Z\.sqlite$/i.test(name))
    .map((name) => {
      const filePath = path.join(config.sqliteBackupDir, name);
      const stats = statSync(filePath);
      return {
        name,
        path: filePath,
        size_bytes: stats.size,
        size_label: formatBytes(stats.size),
        modified_at: stats.mtime.toISOString(),
        modified_at_ms: stats.mtimeMs
      };
    })
    .sort((a, b) => b.modified_at_ms - a.modified_at_ms);
}

function readPragmaRows(db, pragma) {
  return db.prepare(`PRAGMA ${pragma};`).all().map((row) => Object.values(row)[0]);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\"'\"'")}'`;
}

function powershellQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function powershellDoubleQuote(value) {
  return `"${String(value).replace(/`/g, "``").replace(/"/g, '`"')}"`;
}

function normalizeMessages(messages, limit = 40) {
  return messages
    .flatMap((message) => String(message).split(/\r?\n/))
    .filter(Boolean)
    .slice(0, limit);
}

function buildRestoreCommands(newestBackup) {
  const dbPath = config.databasePath;
  const backupPath = newestBackup?.path || "<backup-file>";
  if (process.platform === "win32") {
    return [
      "$stamp = Get-Date -Format yyyyMMdd-HHmmss",
      `Rename-Item -LiteralPath ${powershellQuote(dbPath)} -NewName ${powershellDoubleQuote(`${path.basename(dbPath)}.bad-$stamp`)}`,
      `Copy-Item -LiteralPath ${powershellQuote(backupPath)} -Destination ${powershellQuote(dbPath)}`,
      "npm run sqlite:health"
    ];
  }

  return [
    "sudo systemctl stop sentiment-analyst.service",
    `mv ${shellQuote(dbPath)} ${shellQuote(`${dbPath}.bad-`)}$(date +%Y%m%d-%H%M%S)`,
    `cp ${shellQuote(backupPath)} ${shellQuote(dbPath)}`,
    `sudo chown ahad:ahad ${shellQuote(dbPath)}`,
    "npm run sqlite:health",
    "sudo systemctl start sentiment-analyst.service"
  ];
}

function checkSqliteDatabase() {
  const backups = listBackups();
  const newestBackup = backups[0] || null;
  const dbExists = existsSync(config.databasePath);
  const dbStats = dbExists ? statSync(config.databasePath) : null;
  const checkMode = process.argv.includes("--full") ? "integrity_check" : "quick_check";
  const result = {
    status: dbExists ? "unknown" : "missing",
    check: checkMode,
    database_enabled: config.databaseEnabled,
    database_provider: config.databaseProvider,
    database_path: config.databasePath,
    database_exists: dbExists,
    database_size_bytes: dbStats?.size ?? null,
    database_size_label: dbStats ? formatBytes(dbStats.size) : null,
    backup_dir: config.sqliteBackupDir || null,
    backup_count: backups.length,
    message_count: 0,
    newest_backup: newestBackup
      ? {
          path: newestBackup.path,
          size_bytes: newestBackup.size_bytes,
          size_label: newestBackup.size_label,
          modified_at: newestBackup.modified_at
        }
      : null,
    messages: [],
    restore_commands: []
  };

  if (config.databaseProvider !== "sqlite") {
    result.status = "skipped";
    result.messages.push(`SQLite health skipped because provider is ${config.databaseProvider}.`);
    return result;
  }

  if (!dbExists) {
    result.messages.push("SQLite database file does not exist yet.");
    return result;
  }

  let db = null;
  try {
    db = new DatabaseSync(config.databasePath, { readOnly: true });
    const rows = readPragmaRows(db, checkMode);
    result.message_count = rows.flatMap((message) => String(message).split(/\r?\n/)).filter(Boolean).length;
    result.messages = normalizeMessages(rows);
    result.status = rows.length === 1 && rows[0] === "ok" ? "ok" : "malformed";
  } catch (error) {
    result.status = /malformed|corrupt|not a database/i.test(error.message) ? "malformed" : "error";
    result.messages.push(error.message);
  } finally {
    try {
      db?.close();
    } catch {
      // The original health error is more useful than a close failure.
    }
  }

  if (result.status === "malformed" || result.status === "error") {
    result.restore_commands = buildRestoreCommands(newestBackup);
  }

  return result;
}

const result = checkSqliteDatabase();
console.log(JSON.stringify(result, null, 2));

if (["malformed", "error"].includes(result.status)) {
  process.exitCode = 2;
}
