import * as https from "https";
import { UsageApiResponse, UsageSnapshot, UsageWindow, ExtensionError } from "./types";

const USAGE_ENDPOINT_HOST = "api.anthropic.com";
const USAGE_ENDPOINT_PATH = "/api/oauth/usage";
const BETA_HEADER = "oauth-2025-04-20";

export async function fetchUsage(
  token: string
): Promise<UsageApiResponse | ExtensionError> {
  return new Promise((resolve) => {
    const options: https.RequestOptions = {
      hostname: USAGE_ENDPOINT_HOST,
      path: USAGE_ENDPOINT_PATH,
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": BETA_HEADER,
        "Content-Type": "application/json",
        "User-Agent": "vscode-claude-usage-monitor/1.0.0",
      },
      timeout: 10000,
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        const status = res.statusCode ?? 0;

        if (status === 401 || status === 403) {
          resolve({
            kind: "token-expired",
            message: "Authentication failed. Token may be expired or invalid.",
            httpStatus: status,
          });
          return;
        }

        if (status === 429) {
          const retryAfterHeader = res.headers["retry-after"];
          const retryAfterSec = retryAfterHeader
            ? parseInt(String(retryAfterHeader), 10)
            : 60;
          resolve({
            kind: "rate-limited",
            message: "Rate limited by Anthropic API.",
            retryAfter: new Date(Date.now() + retryAfterSec * 1000),
            httpStatus: status,
          });
          return;
        }

        if (status < 200 || status >= 300) {
          resolve({
            kind: "api-error",
            message: `Unexpected API response: HTTP ${status}`,
            httpStatus: status,
          });
          return;
        }

        try {
          const data = JSON.parse(body) as UsageApiResponse;
          resolve(data);
        } catch {
          resolve({
            kind: "parse-error",
            message: "Failed to parse API response as JSON.",
          });
        }
      });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({ kind: "network-error", message: "Request timed out after 10s." });
    });

    req.on("error", (err: Error) => {
      resolve({ kind: "network-error", message: `Network error: ${err.message}` });
    });

    req.end();
  });
}

export function isExtensionError(
  value: UsageApiResponse | ExtensionError
): value is ExtensionError {
  return typeof (value as ExtensionError).kind === "string";
}

function normalizeWindow(
  w: UsageWindow | null | undefined
): UsageWindow | null {
  if (!w) return null;
  // API returns utilization as a percentage (e.g. 15.0 = 15%), normalize to 0–1
  return { utilization: w.utilization / 100, resets_at: w.resets_at };
}

export function normalizeResponse(raw: UsageApiResponse): UsageSnapshot {
  return {
    fiveHour: normalizeWindow(raw.five_hour),
    sevenDay: normalizeWindow(raw.seven_day),
    sevenDayOpus: normalizeWindow(raw.seven_day_opus),
    sevenDaySonnet: normalizeWindow(raw.seven_day_sonnet),
    fetchedAt: new Date(),
  };
}
