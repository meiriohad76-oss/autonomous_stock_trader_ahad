import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

export function makeId() {
  return randomUUID();
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export const SAFE_TICKER_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,15}$/;

export function normalizeTickerSymbol(value) {
  const ticker = normalizeWhitespace(value).toUpperCase();
  return SAFE_TICKER_PATTERN.test(ticker) ? ticker : "";
}

export function isSafeTickerSymbol(value) {
  return Boolean(normalizeTickerSymbol(value));
}

export function toIsoString(value = new Date()) {
  return new Date(value).toISOString();
}

export function differenceInHours(earlier, later = Date.now()) {
  return Math.max(0, (new Date(later).getTime() - new Date(earlier).getTime()) / 3_600_000);
}

export function safeSlug(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function fingerprint(value) {
  return createHash("sha1").update(normalizeWhitespace(value).toLowerCase()).digest("hex");
}

export function dedupeKey(parts) {
  return fingerprint(parts.filter(Boolean).join("|"));
}

export async function readJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export function summarizeArray(items, limit = 3) {
  return items.slice(0, limit);
}

export function parseJsonBody(body = "") {
  if (!body) {
    return null;
  }

  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload, null, 2));
}

export function sendText(response, statusCode, payload, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  response.end(payload);
}

export function scoreToLabel(score) {
  if (score >= 0.2) {
    return "bullish";
  }

  if (score <= -0.2) {
    return "bearish";
  }

  return "neutral";
}
