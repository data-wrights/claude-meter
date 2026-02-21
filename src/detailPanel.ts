import * as vscode from "vscode";
import { UsageSnapshot, AdminSnapshot } from "./types";
import { parseResetAt } from "./statusBar";
import { formatTokens } from "./adminApi";

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

function buildOauthHtml(snapshot: UsageSnapshot): string {
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

  return htmlShell("Claude Meter (Subscription)", `
    <div class="fetched">Last updated: ${snapshot.fetchedAt.toLocaleString()}</div>
    ${rows}
    <div class="tip">Run <em>Claude Meter: Refresh Now</em> from the command palette to update.</div>
  `);
}

function buildAdminHtml(snapshot: AdminSnapshot): string {
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

  return htmlShell("Claude Meter (Enterprise)", `
    <div class="fetched">Last updated: ${snapshot.fetchedAt.toLocaleString()}</div>
    ${cards}
    <div class="tip">
      Token counts include input (cached + uncached) and output tokens.<br>
      For cost breakdowns, visit the <strong>Anthropic Console</strong> usage dashboard.
    </div>
  `);
}

export class DetailPanel {
  private static currentPanel: DetailPanel | undefined;
  private readonly panel: vscode.WebviewPanel;

  static show(snapshot: AnySnapshot, extensionUri: vscode.Uri): void {
    if (DetailPanel.currentPanel) {
      DetailPanel.currentPanel.update(snapshot);
      DetailPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside, true);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "claudeMeterDetail",
      "Claude Meter Details",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: false, retainContextWhenHidden: false, localResourceRoots: [extensionUri] }
    );
    DetailPanel.currentPanel = new DetailPanel(panel, snapshot);
  }

  private constructor(panel: vscode.WebviewPanel, snapshot: AnySnapshot) {
    this.panel = panel;
    this.update(snapshot);
    panel.onDidDispose(() => { DetailPanel.currentPanel = undefined; });
  }

  update(snapshot: AnySnapshot): void {
    this.panel.webview.html = this.buildHtml(snapshot);
  }

  private buildHtml(snapshot: AnySnapshot): string {
    if (!snapshot) {
      return htmlShell("Claude Meter Details",
        `<p>No usage data available. Use <strong>Claude Meter: Refresh Now</strong> from the command palette.</p>`
      );
    }
    if (snapshot.kind === "admin") { return buildAdminHtml(snapshot.data); }
    return buildOauthHtml(snapshot.data);
  }

  dispose(): void { this.panel.dispose(); }
}
