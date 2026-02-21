import * as https from "https";
import { AdminSnapshot, AdminUsageBucket, ExtensionError } from "./types";

const HOST = "api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";

interface RawResult {
  uncached_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
  [key: string]: unknown;
}

interface RawBucket {
  starting_at: string;
  ending_at: string;
  results: RawResult[];
}

interface RawUsageReport {
  data: RawBucket[];
  has_more?: boolean;
}

function sumBucket(bucket: RawBucket): AdminUsageBucket {
  let inputTokens = 0;
  let outputTokens = 0;
  for (const r of bucket.results) {
    inputTokens  += (r.uncached_input_tokens    ?? 0)
                  + (r.cache_read_input_tokens  ?? 0);
    outputTokens += (r.output_tokens ?? 0);
  }
  return {
    startingAt:   bucket.starting_at,
    endingAt:     bucket.ending_at,
    inputTokens,
    outputTokens,
  };
}

function isoWeekAgo(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 7);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function todayUtcMidnight(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10); // "YYYY-MM-DD" for comparison
}

async function callAdminApi(
  adminKey: string,
  startingAt: string
): Promise<RawUsageReport | ExtensionError> {
  return new Promise((resolve) => {
    const qs = `starting_at=${encodeURIComponent(startingAt)}&bucket_width=1d`;
    const options: https.RequestOptions = {
      hostname: HOST,
      path: `/v1/organizations/usage_report/messages?${qs}`,
      method: "GET",
      headers: {
        "x-api-key": adminKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "User-Agent": "vscode-claude-usage-monitor/1.0.0",
      },
      timeout: 15000,
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        const status = res.statusCode ?? 0;
        if (status === 401 || status === 403) {
          resolve({ kind: "token-expired", message: "Admin API key rejected (401/403). Ensure you are using an sk-ant-admin-... key.", httpStatus: status });
          return;
        }
        if (status === 429) {
          resolve({ kind: "rate-limited", message: "Admin API rate limited.", httpStatus: status });
          return;
        }
        if (status < 200 || status >= 300) {
          resolve({ kind: "api-error", message: `Admin API HTTP ${status}`, httpStatus: status });
          return;
        }
        try {
          resolve(JSON.parse(body) as RawUsageReport);
        } catch {
          resolve({ kind: "parse-error", message: "Failed to parse admin API response." });
        }
      });
    });

    req.on("timeout", () => { req.destroy(); resolve({ kind: "network-error", message: "Admin API request timed out." }); });
    req.on("error", (e: Error) => resolve({ kind: "network-error", message: e.message }));
    req.end();
  });
}

function isError(v: RawUsageReport | ExtensionError): v is ExtensionError {
  return typeof (v as ExtensionError).kind === "string";
}

export async function fetchAdminUsage(
  adminKey: string
): Promise<AdminSnapshot | ExtensionError> {
  const report = await callAdminApi(adminKey, isoWeekAgo());
  if (isError(report)) { return report; }

  const buckets = report.data ?? [];
  const todayPrefix = todayUtcMidnight();

  let todayBucket: AdminUsageBucket | null = null;
  const weekTotal: AdminUsageBucket = { startingAt: "", endingAt: "", inputTokens: 0, outputTokens: 0 };

  for (const b of buckets) {
    const summed = sumBucket(b);
    weekTotal.inputTokens  += summed.inputTokens;
    weekTotal.outputTokens += summed.outputTokens;
    if (!weekTotal.startingAt) { weekTotal.startingAt = summed.startingAt; }
    weekTotal.endingAt = summed.endingAt;

    if (summed.startingAt.startsWith(todayPrefix)) {
      todayBucket = summed;
    }
  }

  return { today: todayBucket, week: weekTotal, fetchedAt: new Date() };
}

export function isAdminError(
  v: AdminSnapshot | ExtensionError
): v is ExtensionError {
  return typeof (v as ExtensionError).kind === "string";
}

// Format large token counts compactly: 1200000 → "1.2M", 45000 → "45k"
export function formatTokens(n: number): string {
  if (n >= 1_000_000) { return `${(n / 1_000_000).toFixed(1)}M`; }
  if (n >= 1_000)     { return `${Math.round(n / 1_000)}k`; }
  return `${n}`;
}
