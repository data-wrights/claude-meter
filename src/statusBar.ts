import * as vscode from "vscode";
import { UsageSnapshot, AdminSnapshot, ExtensionError, ExtensionConfig, HistoryTuple } from "./types";
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

function buildProgressBar(utilization: number): string {
  const width = 10;
  const clamped = Math.min(utilization, 1.0);
  const filled = Math.round(clamped * width);
  const empty = width - filled;
  return `${"█".repeat(filled)}${"░".repeat(empty)}`;
}

export class ClaudeUsageStatusBar {
  private item: vscode.StatusBarItem;

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

    const isOverLimit = (fivePct ?? 0) >= 100 || (sevenPct ?? 0) >= 100;
    const isHighUsage = (fivePct ?? 0) >= 80 || (sevenPct ?? 0) >= 80;

    const icon = isOverLimit
      ? "$(warning)"
      : isHighUsage
      ? "$(alert)"
      : "$(pulse)";

    // Trend arrows — only ↑/↓ shown in status bar (→ omitted to keep it compact)
    const dailyArrow  = fivePct  !== null ? trendInfo(history, 1, fivePct).arrow  : "";
    const weeklyArrow = sevenPct !== null ? trendInfo(history, 2, sevenPct).arrow : "";
    const compactArrow = (a: string) => (a === "→" ? "" : a);

    const parts: string[] = [];
    if (fivePct !== null && fiveH) {
      parts.push(`Daily:${fivePct}%${compactArrow(dailyArrow)}·${formatTimeRemaining(fiveH.resets_at)}`);
    }
    if (sevenPct !== null && sevenD) {
      parts.push(`Weekly:${sevenPct}%${compactArrow(weeklyArrow)}·${formatTimeRemaining(sevenD.resets_at)}`);
    }

    this.item.text = `${icon} ${parts.join("  ")}`;
    // Claude brand orange for normal state; shift to warning/error colors as usage rises
    this.item.color = isOverLimit
      ? new vscode.ThemeColor("statusBarItem.errorForeground")
      : isHighUsage
      ? new vscode.ThemeColor("statusBarItem.warningForeground")
      : "#E87B39";

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
    this.item.color = "#E87B39";
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

  showLoading(): void {
    this.item.text = "$(loading~spin) Claude";
    this.item.tooltip = "Fetching Claude usage data...";
    this.item.color = "#E87B39";
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

    const fmt = (
      w: { utilization: number; resets_at: string } | null,
      label: string,
      slotIndex: 1 | 2
    ) => {
      if (!w) { return; }
      const pct = Math.round(w.utilization * 100);
      const bar = buildProgressBar(w.utilization);
      const reset = parseResetAt(w.resets_at);
      const remaining = formatTimeRemaining(w.resets_at);
      const { arrow, delta } = trendInfo(history, slotIndex, pct);
      const trendStr = delta !== null
        ? ` ${arrow} ${delta >= 0 ? "+" : ""}${delta}% vs 1h ago`
        : "";
      md.appendMarkdown(
        `**${label}**: \`${bar}\` ${pct}%${trendStr}  \nResets in **${remaining}** (${reset})\n\n`
      );
    };

    fmt(snapshot.fiveHour, "Daily", 1);
    fmt(snapshot.sevenDay, "Weekly", 2);

    if (config.showModelBreakdown) {
      // Model breakdown windows don't have dedicated history slots — show without trend
      const fmtNoTrend = (w: { utilization: number; resets_at: string } | null, label: string) => {
        if (!w) { return; }
        const pct = Math.round(w.utilization * 100);
        const bar = buildProgressBar(w.utilization);
        md.appendMarkdown(
          `**${label}**: \`${bar}\` ${pct}%  \nResets in **${formatTimeRemaining(w.resets_at)}** (${parseResetAt(w.resets_at)})\n\n`
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

  dispose(): void {
    this.item.dispose();
  }
}
