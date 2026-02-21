"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClaudeUsageStatusBar = void 0;
exports.parseResetAt = parseResetAt;
exports.formatTimeRemaining = formatTimeRemaining;
const vscode = __importStar(require("vscode"));
const adminApi_1 = require("./adminApi");
function parseResetAt(resetsAt) {
    const d = new Date(resetsAt);
    return isNaN(d.getTime()) ? "Unknown" : d.toLocaleString();
}
// Returns a compact human-readable time until reset: "45m", "3h", "5d"
function formatTimeRemaining(resetsAt) {
    const diffMs = new Date(resetsAt).getTime() - Date.now();
    if (diffMs <= 0)
        return "now";
    const mins = Math.floor(diffMs / 60_000);
    const hours = Math.floor(diffMs / 3_600_000);
    const days = Math.floor(diffMs / 86_400_000);
    if (mins < 60)
        return `${mins}m`;
    if (hours < 24)
        return `${hours}h`;
    return `${days}d`;
}
function buildProgressBar(utilization) {
    const width = 10;
    const clamped = Math.min(utilization, 1.0);
    const filled = Math.round(clamped * width);
    const empty = width - filled;
    return `${"█".repeat(filled)}${"░".repeat(empty)}`;
}
class ClaudeUsageStatusBar {
    item;
    constructor(config) {
        const alignment = config.statusBarPosition === "left"
            ? vscode.StatusBarAlignment.Left
            : vscode.StatusBarAlignment.Right;
        this.item = vscode.window.createStatusBarItem(alignment, config.statusBarPriority);
        this.item.command = "claudeUsage.showDetails";
        this.item.name = "Claude Usage";
        this.item.show();
    }
    showUsage(snapshot, config) {
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
        const parts = [];
        if (fivePct !== null && fiveH) {
            parts.push(`Daily:${fivePct}%·${formatTimeRemaining(fiveH.resets_at)}`);
        }
        if (sevenPct !== null && sevenD) {
            parts.push(`Weekly:${sevenPct}%·${formatTimeRemaining(sevenD.resets_at)}`);
        }
        this.item.text = `${icon} ${parts.join("  ")}`;
        // Claude brand orange for normal state; shift to warning/error colors as usage rises
        this.item.color = isOverLimit
            ? new vscode.ThemeColor("statusBarItem.errorForeground")
            : isHighUsage
                ? new vscode.ThemeColor("statusBarItem.warningForeground")
                : "#E87B39";
        this.item.tooltip = this.buildTooltip(snapshot, config);
        this.item.backgroundColor = isOverLimit
            ? new vscode.ThemeColor("statusBarItem.errorBackground")
            : undefined;
    }
    showAdminUsage(snapshot) {
        const todayTok = snapshot.today
            ? (0, adminApi_1.formatTokens)(snapshot.today.inputTokens + snapshot.today.outputTokens)
            : "—";
        const weekTok = (0, adminApi_1.formatTokens)(snapshot.week.inputTokens + snapshot.week.outputTokens);
        this.item.text = `$(pulse) Today:${todayTok}  Week:${weekTok}`;
        this.item.color = "#E87B39";
        this.item.backgroundColor = undefined;
        this.item.tooltip = this.buildAdminTooltip(snapshot);
    }
    buildAdminTooltip(snapshot) {
        const md = new vscode.MarkdownString("", true);
        md.isTrusted = true;
        md.appendMarkdown("**Claude Usage (Enterprise)**\n\n");
        const fmtBucket = (label, b) => {
            if (!b) {
                return;
            }
            md.appendMarkdown(`**${label}**: ${(0, adminApi_1.formatTokens)(b.inputTokens + b.outputTokens)} tokens  \n` +
                `In: ${(0, adminApi_1.formatTokens)(b.inputTokens)} · Out: ${(0, adminApi_1.formatTokens)(b.outputTokens)}\n\n`);
        };
        fmtBucket("Today", snapshot.today);
        fmtBucket("Past 7 Days", snapshot.week);
        const ago = Math.round((Date.now() - snapshot.fetchedAt.getTime()) / 1000);
        md.appendMarkdown(`---\n_Updated ${ago}s ago · Click for details_`);
        return md;
    }
    showLoading() {
        this.item.text = "$(loading~spin) Claude";
        this.item.tooltip = "Fetching Claude usage data...";
        this.item.color = "#E87B39";
        this.item.backgroundColor = undefined;
    }
    showError(error) {
        const messages = {
            "no-token": "$(key) Claude: No token",
            "token-expired": "$(warning) Claude: Auth expired",
            "api-error": "$(error) Claude: API error",
            "rate-limited": "$(clock) Claude: Rate limited",
            "network-error": "$(warning) Claude: Offline",
            "parse-error": "$(error) Claude: Parse error",
        };
        this.item.text = messages[error.kind] ?? "$(error) Claude: Error";
        this.item.tooltip = error.message;
        this.item.color = new vscode.ThemeColor("statusBarItem.errorForeground");
        this.item.backgroundColor = undefined;
    }
    buildTooltip(snapshot, config) {
        const md = new vscode.MarkdownString("", true);
        md.isTrusted = true;
        md.supportHtml = true;
        md.appendMarkdown("**Claude Usage**\n\n");
        const fmt = (w, label) => {
            if (!w) {
                return;
            }
            const pct = Math.round(w.utilization * 100);
            const bar = buildProgressBar(w.utilization);
            const reset = parseResetAt(w.resets_at);
            const remaining = formatTimeRemaining(w.resets_at);
            md.appendMarkdown(`**${label}**: \`${bar}\` ${pct}%  \nResets in **${remaining}** (${reset})\n\n`);
        };
        fmt(snapshot.fiveHour, "Daily");
        fmt(snapshot.sevenDay, "Weekly");
        if (config.showModelBreakdown) {
            fmt(snapshot.sevenDayOpus, "Weekly (Opus)");
            fmt(snapshot.sevenDaySonnet, "Weekly (Sonnet)");
        }
        const fetchedAgo = Math.round((Date.now() - snapshot.fetchedAt.getTime()) / 1000);
        md.appendMarkdown(`---\n_Updated ${fetchedAgo}s ago · Click for details_`);
        return md;
    }
    dispose() {
        this.item.dispose();
    }
}
exports.ClaudeUsageStatusBar = ClaudeUsageStatusBar;
//# sourceMappingURL=statusBar.js.map