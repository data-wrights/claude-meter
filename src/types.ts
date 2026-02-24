// Raw API response shape from GET /api/oauth/usage
export interface UsageWindow {
  utilization: number; // percentage value e.g. 26 = 26%
  resets_at: string;   // ISO 8601 string e.g. "2026-02-21T09:00:00.134611+00:00"
}

export interface UsageApiResponse {
  five_hour?: UsageWindow;
  seven_day?: UsageWindow;
  seven_day_opus?: UsageWindow | null;
  seven_day_sonnet?: UsageWindow | null;
  extra_usage?: {
    is_enabled: boolean;
    monthly_limit: number;
    used_credits: number;
    utilization: number;
  } | null;
  [key: string]: unknown;
}

// Internal normalized representation
export interface UsageSnapshot {
  fiveHour: UsageWindow | null;
  sevenDay: UsageWindow | null;
  sevenDayOpus: UsageWindow | null;
  sevenDaySonnet: UsageWindow | null;
  fetchedAt: Date;
}

// Enterprise dollar-based usage (for enterprise OAuth accounts)
export interface EnterpriseSnapshot {
  usageCredits: number;   // dollars spent this billing period
  monthlyLimit: number;   // dollar limit for this billing period
  fetchedAt: Date;
}

// Authentication result from tokenProvider
export type TokenSource = "auto-claude-code" | "manual-setting";
export type TokenType = "oauth" | "admin-key" | "api-key";

export interface TokenResult {
  token: string;
  source: TokenSource;
  tokenType: TokenType;
  expiresAt?: number; // Unix ms
  orgUuid?: string;   // organization UUID from credentials file
}

// Admin API snapshot (enterprise accounts with sk-ant-admin- keys)
export interface AdminUsageBucket {
  startingAt: string;
  endingAt: string;
  inputTokens: number;  // uncached_input + cache_read
  outputTokens: number;
}

export interface AdminSnapshot {
  today: AdminUsageBucket | null;  // today's UTC bucket
  week: AdminUsageBucket;          // rolling 7-day sum
  fetchedAt: Date;
}

// Structured error types
export type ExtensionErrorKind =
  | "no-token"
  | "token-expired"
  | "api-error"
  | "rate-limited"
  | "network-error"
  | "parse-error";

export interface ExtensionError {
  kind: ExtensionErrorKind;
  message: string;
  retryAfter?: Date;
  httpStatus?: number;
}

// Extension configuration (mirrors package.json schema)
export interface ExtensionConfig {
  refreshIntervalMinutes: number;
  manualToken: string;
  accountUuid: string;   // manual override for enterprise account UUID
  statusBarPosition: "left" | "right";
  statusBarPriority: number;
  showModelBreakdown: boolean;
  notifyAtThreshold: number;
}

// Compact history tuple types for globalState storage (no key names = smaller JSON)
// OAuth:  slot1 = fiveHour utilization % (0-100), slot2 = sevenDay utilization % (0-100)
// Admin:  slot1 = today tokens / 1000, slot2 = null
export type HistoryTuple = [
  number,       // [0] Unix ms timestamp
  number | null, // [1] slot1
  number | null  // [2] slot2
];

// Daily aggregate — one entry per calendar day (local time)
// OAuth:  slot1 = peak fiveHour % seen that day, slot2 = final sevenDay % that day
// Admin:  slot1 = final today tokens / 1000, slot2 = null
export type DailyAggregate = [
  string,        // [0] "YYYY-MM-DD"
  number | null, // [1] slot1
  number | null  // [2] slot2
];
