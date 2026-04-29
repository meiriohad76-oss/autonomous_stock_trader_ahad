import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../src/config.js";
import { RUNTIME_PROFILES } from "../src/domain/runtime-reliability.js";

function usage() {
  return `
Runtime profile helper

Usage:
  node scripts/runtime-profile.js list
  node scripts/runtime-profile.js preview <profile>
  node scripts/runtime-profile.js apply <profile> --yes

Profiles:
  ${Object.keys(RUNTIME_PROFILES).join(", ")}
`.trim();
}

function parseEnv(raw) {
  const values = new Map();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    values.set(trimmed.slice(0, separatorIndex).trim(), trimmed.slice(separatorIndex + 1).trim());
  }
  return values;
}

function renderDiff(envValues, profile) {
  return Object.entries(profile.env).map(([key, desired]) => {
    const current = envValues.has(key) ? envValues.get(key) : "(unset)";
    return {
      key,
      current,
      desired,
      matches: current === desired
    };
  });
}

function renderProfile(profileKey, profile, diff) {
  const changed = diff.filter((item) => !item.matches);
  console.log(`Profile: ${profile.label} (${profileKey})`);
  console.log(profile.description);
  console.log(`Changes: ${changed.length}`);
  console.log("");

  if (!changed.length) {
    console.log("Current .env already matches this profile.");
    return;
  }

  for (const item of changed) {
    console.log(`${item.key}: ${item.current} -> ${item.desired}`);
  }
}

async function writeEnvProfile(profile) {
  const raw = await readFile(config.envPath, "utf8");
  const lines = raw.split(/\r?\n/);
  const seen = new Set();
  const nextLines = lines.map((line) => {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      return line;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!(key in profile.env)) {
      return line;
    }

    seen.add(key);
    return `${key}=${profile.env[key]}`;
  });

  for (const [key, value] of Object.entries(profile.env)) {
    if (!seen.has(key)) {
      nextLines.push(`${key}=${value}`);
    }
  }

  const backupDir = path.join(config.dataDir, "env-backups");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(".", "-");
  const backupPath = path.join(backupDir, `.env-${stamp}`);
  await mkdir(backupDir, { recursive: true });
  await copyFile(config.envPath, backupPath);
  await writeFile(config.envPath, nextLines.join("\n"), "utf8");
  return backupPath;
}

async function main() {
  const [, , command, profileKey, ...flags] = process.argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(usage());
    return;
  }

  if (command === "list") {
    for (const [key, profile] of Object.entries(RUNTIME_PROFILES)) {
      console.log(`${key}: ${profile.label} - ${profile.description}`);
    }
    return;
  }

  const profile = RUNTIME_PROFILES[profileKey];
  if (!profile) {
    throw new Error(`Unknown profile "${profileKey}".\n\n${usage()}`);
  }

  const raw = await readFile(config.envPath, "utf8");
  const diff = renderDiff(parseEnv(raw), profile);
  renderProfile(profileKey, profile, diff);

  if (command === "preview") {
    return;
  }

  if (command === "apply") {
    if (!flags.includes("--yes")) {
      throw new Error("Refusing to write .env without --yes. Run preview first, then apply <profile> --yes.");
    }
    const backupPath = await writeEnvProfile(profile);
    console.log("");
    console.log(`Applied ${profileKey}. Backup saved to ${backupPath}`);
    console.log("Restart the service so timers and startup behavior reload:");
    console.log("  sudo systemctl restart sentiment-analyst.service");
    return;
  }

  throw new Error(`Unknown command "${command}".\n\n${usage()}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
