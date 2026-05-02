function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeFetchError(error, { label, timeoutMs }) {
  if (error?.name === "AbortError") {
    return new Error(`${label} timed out after ${timeoutMs}ms`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

function isRetryable(error) {
  const status = Number(error?.status || 0);
  return !status || status === 408 || status === 429 || status >= 500;
}

function summarizeResponseBody(body) {
  const normalized = String(body || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
}

async function fetchRawWithRetry(url, {
  timeoutMs = 12000,
  retries = 1,
  retryDelayMs = 400,
  headers = {},
  label = "request"
} = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers
      });

      if (!response.ok) {
        let body = "";
        try {
          body = summarizeResponseBody(await response.text());
        } catch {
          body = "";
        }
        const suffix = body ? `: ${body}` : "";
        const error = new Error(`${label} failed with HTTP ${response.status}${suffix}`);
        error.status = response.status;
        error.body = body;
        throw error;
      }

      return response;
    } catch (error) {
      lastError = normalizeFetchError(error, { label, timeoutMs });
      if (attempt >= retries || !isRetryable(lastError)) {
        break;
      }
      await wait(retryDelayMs * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error(`${label} failed`);
}

export async function fetchTextWithRetry(url, options = {}) {
  const response = await fetchRawWithRetry(url, options);
  return response.text();
}

export async function fetchJsonWithRetry(url, options = {}) {
  const text = await fetchTextWithRetry(url, options);
  return JSON.parse(text);
}
