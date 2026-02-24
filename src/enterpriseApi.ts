import * as https from "https";
import { EnterpriseSnapshot, ExtensionError } from "./types";

const CLAUDE_HOST = "claude.ai";

interface OverageResponse {
  monthly_credit_limit?: number;
  usage_credits?: number;
  [key: string]: unknown;
}

interface AccountResponse {
  uuid?: string;
  id?: string;
  account_uuid?: string;
  [key: string]: unknown;
}

async function fetchJson<T>(
  token: string,
  path: string
): Promise<T | ExtensionError> {
  return new Promise((resolve) => {
    const options: https.RequestOptions = {
      hostname: CLAUDE_HOST,
      path,
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "vscode-claude-usage-monitor/1.0.0",
      },
      timeout: 10000,
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        const status = res.statusCode ?? 0;
        if (status === 401 || status === 403) {
          resolve({ kind: "token-expired", message: `claude.ai returned HTTP ${status} — Bearer token auth may not be supported on this endpoint.`, httpStatus: status });
          return;
        }
        if (status < 200 || status >= 300) {
          resolve({ kind: "api-error", message: `claude.ai HTTP ${status}`, httpStatus: status });
          return;
        }
        try {
          resolve(JSON.parse(body) as T);
        } catch {
          resolve({ kind: "parse-error", message: "Failed to parse claude.ai response." });
        }
      });
    });

    req.on("timeout", () => { req.destroy(); resolve({ kind: "network-error", message: "claude.ai request timed out." }); });
    req.on("error", (e: Error) => resolve({ kind: "network-error", message: e.message }));
    req.end();
  });
}

function isError(v: unknown): v is ExtensionError {
  return typeof (v as ExtensionError).kind === "string";
}

// Try to discover the account UUID from a few common claude.ai profile endpoints.
// Returns null if none respond with a recognisable UUID field.
export async function fetchAccountUuid(token: string): Promise<string | null> {
  const candidates = [
    "/api/account",
    "/api/auth/current_user",
    "/api/bootstrap",
  ];

  for (const path of candidates) {
    const result = await fetchJson<AccountResponse>(token, path);
    if (isError(result)) { continue; }
    const uuid = result.uuid ?? result.id ?? result.account_uuid;
    if (typeof uuid === "string" && uuid.length > 0) { return uuid; }
  }

  return null;
}

export async function fetchEnterpriseSpend(
  token: string,
  orgUuid: string,
  accountUuid: string
): Promise<EnterpriseSnapshot | ExtensionError> {
  const path =
    `/api/organizations/${encodeURIComponent(orgUuid)}/overage_spend_limit` +
    `?account_uuid=${encodeURIComponent(accountUuid)}`;

  const result = await fetchJson<OverageResponse>(token, path);
  if (isError(result)) { return result; }

  const { usage_credits, monthly_credit_limit } = result;
  if (typeof usage_credits !== "number" || typeof monthly_credit_limit !== "number") {
    return {
      kind: "parse-error",
      message: "Enterprise usage response is missing expected fields (usage_credits / monthly_credit_limit).",
    };
  }

  return {
    usageCredits: usage_credits,
    monthlyLimit: monthly_credit_limit,
    fetchedAt: new Date(),
  };
}

export function isEnterpriseError(
  v: EnterpriseSnapshot | ExtensionError
): v is ExtensionError {
  return typeof (v as ExtensionError).kind === "string";
}
