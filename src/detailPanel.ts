import * as vscode from "vscode";
import { UsageSnapshot, AdminSnapshot, HistoryTuple, DailyAggregate } from "./types";
import { parseResetAt } from "./statusBar";
import { formatTokens } from "./adminApi";

type HistoryData = { recent: HistoryTuple[]; daily: DailyAggregate[] };

type AnySnapshot =
  | { kind: "oauth";  data: UsageSnapshot }
  | { kind: "admin";  data: AdminSnapshot }
  | null;

const SHARED_CSS = `
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); padding: 24px; color: var(--vscode-foreground); background: var(--vscode-editor-background); max-width: 600px; }
  h2 { margin-top: 0; font-size: 1.2em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 8px; }
  .fetched { font-size: 0.8em; color: var(--vscode-descriptionForeground); margin-bottom: 20px; }
  .window-row { margin-bottom: 24px; }
  .window-label { font-weight: 600; margin-bottom: 6px; }
  .bar-track { background: var(--vscode-input-background); border-radius: 4px; height: 18px; width: 100%; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 4px; transition: width 0.3s ease; min-width: 2px; }
  .window-meta { display: flex; justify-content: space-between; margin-top: 4px; font-size: 0.85em; }
  .pct { font-weight: 600; color: #4ec9b0; }
  .pct.warn { color: #ff8c00; }
  .pct.danger { color: #f44747; }
  .reset { color: var(--vscode-descriptionForeground); }
  .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  .stat-card { background: var(--vscode-input-background); border-radius: 6px; padding: 12px; }
  .stat-label { font-size: 0.75em; color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
  .stat-value { font-size: 1.4em; font-weight: 600; color: #E87B39; }
  .stat-sub { font-size: 0.75em; color: var(--vscode-descriptionForeground); margin-top: 2px; }
  .tip { margin-top: 16px; font-size: 0.8em; color: var(--vscode-descriptionForeground); border-top: 1px solid var(--vscode-panel-border); padding-top: 12px; }
  .history-section { margin-top: 24px; border-top: 1px solid var(--vscode-panel-border); padding-top: 16px; }
  .history-section h3 { margin-top: 0; margin-bottom: 12px; font-size: 0.95em; }
  .chart-label { font-size: 0.8em; color: var(--vscode-descriptionForeground); margin-bottom: 4px; margin-top: 14px; }
  .sparkline, .daily-chart { display: flex; align-items: flex-end; gap: 2px; margin-bottom: 4px; }
  .sparkline { height: 48px; }
  .daily-chart { height: 64px; padding-bottom: 18px; box-sizing: content-box; }
  .spark-bar, .day-bar { flex: 1; background: #4ec9b0; border-radius: 2px 2px 0 0; min-height: 2px; position: relative; }
  .spark-bar.warn, .day-bar.warn { background: #ff8c00; }
  .spark-bar.danger, .day-bar.danger { background: #f44747; }
  .day-label { position: absolute; bottom: -16px; left: 0; right: 0; font-size: 8px; text-align: center; color: var(--vscode-descriptionForeground); overflow: hidden; }
`;

function htmlShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <style>${SHARED_CSS}</style>
</head>
<body>
  <h2>${title}</h2>
  ${body}
</body>
</html>`;
}

function pctBarClass(val: number): string {
  return val >= 90 ? "danger" : val >= 70 ? "warn" : "";
}

function buildSparkline(recent: HistoryTuple[], slotIndex: 1 | 2, label: string): string {
  const entries = recent.slice(-24);
  if (entries.length < 2) { return ""; }
  const bars = entries.map(e => {
    const val = e[slotIndex];
    if (val === null) { return `<div class="spark-bar" style="height:2px;" title="No data"></div>`; }
    const h = Math.max(2, val);
    const time = new Date(e[0]).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `<div class="spark-bar ${pctBarClass(val)}" style="height:${h}%;" title="${val}% @ ${time}"></div>`;
  }).join("");
  return `<div class="chart-label">${label}</div><div class="sparkline">${bars}</div>`;
}

function buildDailyChart(daily: DailyAggregate[], slotIndex: 1 | 2, label: string): string {
  const entries = daily.slice(-30);
  if (entries.length < 2) { return ""; }
  const bars = entries.map(e => {
    const val = e[slotIndex];
    const day = e[0].slice(8); // "DD"
    if (val === null) {
      return `<div class="day-bar" style="height:2px;" title="${e[0]}: No data"><span class="day-label">${day}</span></div>`;
    }
    const h = Math.max(2, val);
    return `<div class="day-bar ${pctBarClass(val)}" style="height:${h}%;" title="${e[0]}: peak ${val}%"><span class="day-label">${day}</span></div>`;
  }).join("");
  return `<div class="chart-label">${label}</div><div class="daily-chart">${bars}</div>`;
}

function buildAdminDailyChart(daily: DailyAggregate[]): string {
  const entries = daily.slice(-30);
  if (entries.length < 2) { return ""; }
  const maxVal = Math.max(...entries.map(e => e[1] ?? 0), 1);
  const bars = entries.map(e => {
    const val = e[1];
    const day = e[0].slice(8);
    if (val === null) {
      return `<div class="day-bar" style="height:2px;" title="${e[0]}: No data"><span class="day-label">${day}</span></div>`;
    }
    const h = Math.max(2, Math.round((val / maxVal) * 100));
    const tok = val >= 1000 ? `${(val / 1000).toFixed(1)}M` : `${val}k`;
    return `<div class="day-bar" style="height:${h}%;" title="${e[0]}: ${tok} tokens"><span class="day-label">${day}</span></div>`;
  }).join("");
  return `<div class="chart-label">Daily tokens (last 30 days, scaled to peak)</div><div class="daily-chart">${bars}</div>`;
}

function buildOauthHtml(snapshot: UsageSnapshot, history?: HistoryData): string {
  const windows = [
    { label: "Daily",           data: snapshot.fiveHour },
    { label: "Weekly",          data: snapshot.sevenDay },
    { label: "Weekly (Opus)",   data: snapshot.sevenDayOpus },
    { label: "Weekly (Sonnet)", data: snapshot.sevenDaySonnet },
  ].filter((w) => w.data !== null);

  const rows = windows.map((w) => {
    const d = w.data!;
    const rawPct = Math.round(d.utilization * 100);
    const displayPct = Math.min(rawPct, 100);
    const color = rawPct >= 90 ? "#f44747" : rawPct >= 70 ? "#ff8c00" : "#4ec9b0";
    const reset = parseResetAt(d.resets_at);
    return `
    <div class="window-row">
      <div class="window-label">${w.label}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${displayPct}%;background:${color}"></div></div>
      <div class="window-meta">
        <span class="pct ${rawPct >= 90 ? "danger" : rawPct >= 70 ? "warn" : ""}">${rawPct}% used</span>
        <span class="reset">Resets: ${reset}</span>
      </div>
    </div>`;
  }).join("");

  const recent = history?.recent ?? [];
  const daily  = history?.daily  ?? [];
  const sparklineSection = (recent.length >= 2 || daily.length >= 2) ? `
    <section class="history-section">
      <h3>Usage History</h3>
      ${buildSparkline(recent, 1, "Daily — last 2 hours")}
      ${buildSparkline(recent, 2, "Weekly — last 2 hours")}
      ${buildDailyChart(daily, 1, "Peak daily usage — last 30 days")}
    </section>` : "";

  return htmlShell("Claude Meter (Subscription)", `
    <div class="fetched">Last updated: ${snapshot.fetchedAt.toLocaleString()}</div>
    ${rows}
    ${sparklineSection}
    <div class="tip">Run <em>Claude Meter: Refresh Now</em> from the command palette to update.</div>
  `);
}

function buildAdminHtml(snapshot: AdminSnapshot, history?: HistoryData): string {
  const today = snapshot.today;
  const week  = snapshot.week;

  const todayTotal = today ? today.inputTokens + today.outputTokens : 0;
  const weekTotal  = week.inputTokens + week.outputTokens;

  const statCard = (label: string, total: number, input: number, output: number) => `
    <div class="stat-card">
      <div class="stat-label">${label}</div>
      <div class="stat-value">${formatTokens(total)}</div>
      <div class="stat-sub">In: ${formatTokens(input)} · Out: ${formatTokens(output)}</div>
    </div>`;

  const cards = `
    <div class="stat-grid">
      ${today ? statCard("Today", todayTotal, today.inputTokens, today.outputTokens) : ""}
      ${statCard("Past 7 Days", weekTotal, week.inputTokens, week.outputTokens)}
    </div>`;

  const daily = history?.daily ?? [];
  const adminChartSection = daily.length >= 2 ? `
    <section class="history-section">
      <h3>Usage History</h3>
      ${buildAdminDailyChart(daily)}
    </section>` : "";

  return htmlShell("Claude Meter (Enterprise)", `
    <div class="fetched">Last updated: ${snapshot.fetchedAt.toLocaleString()}</div>
    ${cards}
    ${adminChartSection}
    <div class="tip">
      Token counts include input (cached + uncached) and output tokens.<br>
      For cost breakdowns, visit the <strong>Anthropic Console</strong> usage dashboard.
    </div>
  `);
}

export class DetailPanel {
  private static currentPanel: DetailPanel | undefined;
  private readonly panel: vscode.WebviewPanel;

  static updateIfOpen(snapshot: AnySnapshot, history?: HistoryData): void {
    if (DetailPanel.currentPanel) {
      DetailPanel.currentPanel.update(snapshot, history);
    }
  }

  static show(snapshot: AnySnapshot, extensionUri: vscode.Uri, history?: HistoryData): void {
    if (DetailPanel.currentPanel) {
      DetailPanel.currentPanel.update(snapshot, history);
      DetailPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside, true);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "claudeMeterDetail",
      "Claude Meter Details",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: false, retainContextWhenHidden: false, localResourceRoots: [extensionUri] }
    );
    DetailPanel.currentPanel = new DetailPanel(panel, snapshot, history);
  }

  private constructor(panel: vscode.WebviewPanel, snapshot: AnySnapshot, history?: HistoryData) {
    this.panel = panel;
    this.update(snapshot, history);
    panel.onDidDispose(() => { DetailPanel.currentPanel = undefined; });
  }

  update(snapshot: AnySnapshot, history?: HistoryData): void {
    this.panel.webview.html = this.buildHtml(snapshot, history);
  }

  private buildHtml(snapshot: AnySnapshot, history?: HistoryData): string {
    if (!snapshot) {
      return htmlShell("Claude Meter Details",
        `<p>No usage data available. Use <strong>Claude Meter: Refresh Now</strong> from the command palette.</p>`
      );
    }
    if (snapshot.kind === "admin") { return buildAdminHtml(snapshot.data, history); }
    return buildOauthHtml(snapshot.data, history);
  }

  dispose(): void { this.panel.dispose(); }
}
