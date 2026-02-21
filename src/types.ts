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

// Authentication result from tokenProvider
export type TokenSource = "auto-claude-code" | "manual-setting";
export type TokenType = "oauth" | "admin-key" | "api-key";

export interface TokenResult {
  token: string;
  source: TokenSource;
  tokenType: TokenType;
  expiresAt?: number; // Unix ms
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
  statusBarPosition: "left" | "right";
  statusBarPriority: number;
  showModelBreakdown: boolean;
  notifyAtThreshold: number;
}
