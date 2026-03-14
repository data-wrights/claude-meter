import * as vscode from "vscode";
import { UsageSnapshot, AdminSnapshot, EnterpriseSnapshot, ExtensionError, ExtensionConfig, HistoryTuple } from "./types";
import { formatTokens } from "./adminApi";

export function parseResetAt(resetsAt: string): string {
  const d = new Date(resetsAt);
  return isNaN(d.getTime()) ? "Unknown" : d.toLocaleString();
}

// Returns a compact human-readable time until reset: "45m", "3h", "5d"
export function formatTimeRemaining(resetsAt: string): string {
  const diffMs = new Date(resetsAt).getTime() - Date.now();
  if (diffMs <= 0) return "now";
  const mins  = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days  = Math.floor(diffMs / 86_400_000);
  if (mins  < 60)  return `${mins}m`;
  if (hours < 24)  return `${hours}h`;
  return `${days}d`;
}

// Returns trend arrow (↑/↓/→) and signed delta vs ~1 hour ago, or empty string if no history
function trendInfo(
  history: HistoryTuple[],
  slotIndex: 1 | 2,
  currentPct: number
): { arrow: string; delta: number | null } {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  let past: HistoryTuple | undefined;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i][0] <= oneHourAgo) { past = history[i]; break; }
  }
  if (!past || past[slotIndex] === null) { return { arrow: "", delta: null }; }
  const delta = Math.round(currentPct - (past[slotIndex] as number));
  const arrow = delta > 2 ? "↑" : delta < -2 ? "↓" : "→";
  return { arrow, delta };
}

export interface BurnRateInfo {
  ratePctPerHour: number;
  hoursToExhaustion: number | null;
  onPaceToExceed: boolean;
}

/**
 * Calculate consumption rate from the last ~2 hours of history snapshots.
 * Returns null if insufficient data (need ≥2 points spanning ≥10 min).
 */
export function calcBurnRate(
  history: HistoryTuple[],
  slotIndex: 1 | 2,
  currentPct: number,
  resetsAt: string | undefined
): BurnRateInfo | null {
  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  let oldest: HistoryTuple | undefined;
  for (let i = 0; i < history.length; i++) {
    if (history[i][0] >= twoHoursAgo && history[i][slotIndex] !== null) {
      oldest = history[i];
      break;
    }
  }
  if (!oldest || oldest[slotIndex] === null) { return null; }

  const hoursDelta = (Date.now() - oldest[0]) / 3_600_000;
  if (hoursDelta < 10 / 60) { return null; } // need at least ~10 min span

  const pastPct = oldest[slotIndex] as number;
  const ratePctPerHour = (currentPct - pastPct) / hoursDelta;
  if (ratePctPerHour <= 0) { return null; }

  const remaining = 100 - currentPct;
  const hoursToExhaustion = remaining > 0 ? remaining / ratePctPerHour : null;

  let onPaceToExceed = false;
  if (hoursToExhaustion !== null && resetsAt) {
    const hoursToReset = (new Date(resetsAt).getTime() - Date.now()) / 3_600_000;
    onPaceToExceed = hoursToReset > 0 && hoursToExhaustion < hoursToReset;
  }

  return { ratePctPerHour, hoursToExhaustion, onPaceToExceed };
}

function buildProgressBar(utilization: number): string {
  const width = 10;
  const clamped = Math.min(utilization, 1.0);
  const filled = Math.round(clamped * width);
  const empty = width - filled;
  return `${"█".repeat(filled)}${"░".repeat(empty)}`;
}

export class ClaudeUsageStatusBar {
  private item: vscode.StatusBarItem;
  private cooldownTimer: ReturnType<typeof setInterval> | null = null;
  private cooldownResetAt: string | null = null;

  constructor(config: ExtensionConfig) {
    const alignment =
      config.statusBarPosition === "left"
        ? vscode.StatusBarAlignment.Left
        : vscode.StatusBarAlignment.Right;

    this.item = vscode.window.createStatusBarItem(
      alignment,
      config.statusBarPriority
    );
    this.item.command = "claudeMeter.showDetails";
    this.item.name = "Claude Meter";
    this.item.show();
  }

  showUsage(snapshot: UsageSnapshot, config: ExtensionConfig, history: HistoryTuple[] = []): void {
    const fiveH = snapshot.fiveHour;
    const sevenD = snapshot.sevenDay;

    const fivePct = fiveH ? Math.round(fiveH.utilization * 100) : null;
    const sevenPct = sevenD ? Math.round(sevenD.utilization * 100) : null;
    const remaining = config.displayMode === "remaining";
    const displayPct = (pct: number) => remaining ? Math.max(0, 100 - pct) : pct;

    const isOverLimit = (fivePct ?? 0) >= 100 || (sevenPct ?? 0) >= 100;
    const isHighUsage = (fivePct ?? 0) >= 80 || (sevenPct ?? 0) >= 80;

    // Cooldown: when at 100%, show live countdown instead of normal text
    if (isOverLimit) {
      // Pick the earliest reset time among exhausted windows
      const candidates: string[] = [];
      if ((fivePct ?? 0) >= 100 && fiveH) { candidates.push(fiveH.resets_at); }
      if ((sevenPct ?? 0) >= 100 && sevenD) { candidates.push(sevenD.resets_at); }
      const earliest = candidates.sort()[0];
      if (earliest) {
        this.startCooldown(earliest);
      }
    } else {
      this.stopCooldown();
    }

    const icon = isOverLimit
      ? "$(warning)"
      : isHighUsage
      ? "$(alert)"
      : "$(pulse)";

    // Trend arrows — only ↑/↓ shown in status bar (→ omitted to keep it compact)
    const dailyArrow  = fivePct  !== null ? trendInfo(history, 1, fivePct).arrow  : "";
    const weeklyArrow = sevenPct !== null ? trendInfo(history, 2, sevenPct).arrow : "";
    const compactArrow = (a: string) => (a === "→" ? "" : a);

    // In cooldown mode, the timer keeps the text updated between refreshes.
    // On each refresh we still set the text so it's immediately correct.
    if (isOverLimit && this.cooldownResetAt) {
      this.updateCooldownText();
    } else {
      const parts: string[] = [];
      if (fivePct !== null && fiveH) {
        parts.push(`Daily:${displayPct(fivePct)}%${compactArrow(dailyArrow)}·${formatTimeRemaining(fiveH.resets_at)}`);
      }
      if (sevenPct !== null && sevenD) {
        parts.push(`Weekly:${displayPct(sevenPct)}%${compactArrow(weeklyArrow)}·${formatTimeRemaining(sevenD.resets_at)}`);
      }
      this.item.text = `${icon} ${parts.join("  ")}`;
    }

    // Shift to warning/error colors as usage rises; default (white) for normal state
    this.item.color = isOverLimit
      ? new vscode.ThemeColor("statusBarItem.errorForeground")
      : isHighUsage
      ? new vscode.ThemeColor("statusBarItem.warningForeground")
      : undefined;

    this.item.tooltip = this.buildTooltip(snapshot, config, history);
    this.item.backgroundColor = isOverLimit
      ? new vscode.ThemeColor("statusBarItem.errorBackground")
      : undefined;
  }

  showAdminUsage(snapshot: AdminSnapshot): void {
    const todayTok = snapshot.today
      ? formatTokens(snapshot.today.inputTokens + snapshot.today.outputTokens)
      : "—";
    const weekTok = formatTokens(snapshot.week.inputTokens + snapshot.week.outputTokens);

    this.item.text = `$(pulse) Today:${todayTok}  Week:${weekTok}`;
    this.item.color = undefined;
    this.item.backgroundColor = undefined;
    this.item.tooltip = this.buildAdminTooltip(snapshot);
  }

  private buildAdminTooltip(snapshot: AdminSnapshot): vscode.MarkdownString {
    const md = new vscode.MarkdownString("", true);
    md.isTrusted = true;
    md.appendMarkdown("**Claude Meter (Enterprise)**\n\n");

    const fmtBucket = (label: string, b: { inputTokens: number; outputTokens: number } | null) => {
      if (!b) { return; }
      md.appendMarkdown(
        `**${label}**: ${formatTokens(b.inputTokens + b.outputTokens)} tokens  \n` +
        `In: ${formatTokens(b.inputTokens)} · Out: ${formatTokens(b.outputTokens)}\n\n`
      );
    };

    fmtBucket("Today", snapshot.today);
    fmtBucket("Past 7 Days", snapshot.week);

    const ago = Math.round((Date.now() - snapshot.fetchedAt.getTime()) / 1000);
    md.appendMarkdown(`---\n_Updated ${ago}s ago · Click for details_`);
    return md;
  }

  showEnterpriseUsage(snapshot: EnterpriseSnapshot, config: ExtensionConfig): void {
    const pct = snapshot.monthlyLimit > 0
      ? Math.round((snapshot.usageCredits / snapshot.monthlyLimit) * 100)
      : 0;
    const remaining = config.displayMode === "remaining";
    const shownPct = remaining ? Math.max(0, 100 - pct) : pct;
    const label = remaining ? "remaining" : "used";
    const isOverLimit = pct >= 100;
    const isHighUsage = pct >= 80;

    const icon = isOverLimit ? "$(warning)" : isHighUsage ? "$(alert)" : "$(pulse)";
    const spent = snapshot.usageCredits.toFixed(2);
    const limit = snapshot.monthlyLimit.toFixed(0);

    this.item.text = `${icon} $${spent}/$${limit} (${shownPct}%)`;
    this.item.color = isOverLimit
      ? new vscode.ThemeColor("statusBarItem.errorForeground")
      : isHighUsage
      ? new vscode.ThemeColor("statusBarItem.warningForeground")
      : undefined;
    this.item.backgroundColor = isOverLimit
      ? new vscode.ThemeColor("statusBarItem.errorBackground")
      : undefined;

    const md = new vscode.MarkdownString("", true);
    md.appendMarkdown("**Claude Meter (Enterprise)**\n\n");
    md.appendMarkdown(`**Spend**: $${spent} of $${limit} (${shownPct}% ${label})\n\n`);
    const ago = Math.round((Date.now() - snapshot.fetchedAt.getTime()) / 1000);
    md.appendMarkdown(`---\n_Updated ${ago}s ago · Click for details_`);
    this.item.tooltip = md;
  }

  showEnterpriseUnavailable(): void {
    this.item.text = "$(pulse) Claude: Enterprise";
    this.item.color = undefined;
    this.item.backgroundColor = undefined;
    this.item.tooltip =
      "Enterprise account detected — click for details on how to enable spend tracking.";
  }

  showLoading(): void {
    this.item.text = "$(loading~spin) Claude";
    this.item.tooltip = "Fetching Claude usage data...";
    this.item.color = undefined;
    this.item.backgroundColor = undefined;
  }

  showError(error: ExtensionError): void {
    const messages: Record<ExtensionError["kind"], string> = {
      "no-token": "$(key) Claude: No token",
      "token-expired": "$(warning) Claude: Auth expired",
      "api-error": "$(error) Claude: API error",
      "rate-limited": "$(clock) Claude: Rate limited",
      "network-error": "$(warning) Claude: Offline",
      "parse-error": "$(error) Claude: Parse error",
    };
    this.item.text = messages[error.kind] ?? "$(error) Claude: Error";
    this.item.color = new vscode.ThemeColor("statusBarItem.errorForeground");
    this.item.backgroundColor = undefined;

    if (error.kind === "token-expired") {
      const md = new vscode.MarkdownString("", true);
      md.appendMarkdown(`${error.message}\n\n`);
      md.appendMarkdown("_Will auto-refresh once Claude Code renews your credentials._");
      this.item.tooltip = md;
    } else {
      this.item.tooltip = error.message;
    }
  }

  private buildTooltip(
    snapshot: UsageSnapshot,
    config: ExtensionConfig,
    history: HistoryTuple[]
  ): vscode.MarkdownString {
    const md = new vscode.MarkdownString("", true);
    md.isTrusted = true;
    md.supportHtml = true;
    md.appendMarkdown("**Claude Meter**\n\n");

    const isRemaining = config.displayMode === "remaining";
    const modeLabel = isRemaining ? "remaining" : "used";

    const fmt = (
      w: { utilization: number; resets_at: string } | null,
      label: string,
      slotIndex: 1 | 2
    ) => {
      if (!w) { return; }
      const pct = Math.round(w.utilization * 100);
      const shownPct = isRemaining ? Math.max(0, 100 - pct) : pct;
      const bar = buildProgressBar(w.utilization);
      const reset = parseResetAt(w.resets_at);
      const remaining = formatTimeRemaining(w.resets_at);
      const { arrow, delta } = trendInfo(history, slotIndex, pct);
      const displayDelta = delta !== null ? (isRemaining ? -delta : delta) : null;
      const trendStr = displayDelta !== null
        ? ` ${arrow} ${displayDelta >= 0 ? "+" : ""}${displayDelta}% vs 1h ago`
        : "";
      // Burn rate / pacing line
      const burn = calcBurnRate(history, slotIndex, pct, w.resets_at);
      let burnStr = "";
      if (burn && pct < 100) {
        const rateStr = `~${burn.ratePctPerHour.toFixed(1)}%/hr`;
        if (burn.hoursToExhaustion !== null) {
          const exhaust = burn.hoursToExhaustion < 1
            ? `${Math.round(burn.hoursToExhaustion * 60)}m`
            : `${burn.hoursToExhaustion.toFixed(1)}h`;
          burnStr = burn.onPaceToExceed
            ? `  \n$(watch) ${rateStr} · Exhausted in ~${exhaust} (before reset)`
            : `  \n$(watch) ${rateStr} · Exhausted in ~${exhaust}`;
        } else {
          burnStr = `  \n$(watch) ${rateStr}`;
        }
      }

      md.appendMarkdown(
        `**${label}**: \`${bar}\` ${shownPct}% ${modeLabel}${trendStr}${burnStr}  \nResets in **${remaining}** (${reset})\n\n`
      );
    };

    fmt(snapshot.fiveHour, "Daily", 1);
    fmt(snapshot.sevenDay, "Weekly", 2);

    if (config.showModelBreakdown) {
      // Model breakdown windows don't have dedicated history slots — show without trend
      const fmtNoTrend = (w: { utilization: number; resets_at: string } | null, label: string) => {
        if (!w) { return; }
        const pct = Math.round(w.utilization * 100);
        const shownPct = isRemaining ? Math.max(0, 100 - pct) : pct;
        const bar = buildProgressBar(w.utilization);
        md.appendMarkdown(
          `**${label}**: \`${bar}\` ${shownPct}% ${modeLabel}  \nResets in **${formatTimeRemaining(w.resets_at)}** (${parseResetAt(w.resets_at)})\n\n`
        );
      };
      fmtNoTrend(snapshot.sevenDayOpus, "Weekly (Opus)");
      fmtNoTrend(snapshot.sevenDaySonnet, "Weekly (Sonnet)");
    }

    const fetchedAgo = Math.round(
      (Date.now() - snapshot.fetchedAt.getTime()) / 1000
    );
    md.appendMarkdown(`---\n_Updated ${fetchedAgo}s ago · Click for details_`);
    return md;
  }

  private startCooldown(resetsAt: string): void {
    // Avoid restarting if already counting down to the same target
    if (this.cooldownResetAt === resetsAt && this.cooldownTimer !== null) { return; }
    this.stopCooldown();
    this.cooldownResetAt = resetsAt;
    this.cooldownTimer = setInterval(() => { this.updateCooldownText(); }, 60_000);
  }

  private updateCooldownText(): void {
    if (!this.cooldownResetAt) { return; }
    const remaining = formatTimeRemaining(this.cooldownResetAt);
    if (remaining === "now") {
      this.item.text = "$(clock) Claude: Resetting...";
      this.stopCooldown();
    } else {
      this.item.text = `$(clock) Claude: Resets in ${remaining}`;
    }
  }

  private stopCooldown(): void {
    if (this.cooldownTimer !== null) {
      clearInterval(this.cooldownTimer);
      this.cooldownTimer = null;
    }
    this.cooldownResetAt = null;
  }

  dispose(): void {
    this.stopCooldown();
    this.item.dispose();
  }
}
