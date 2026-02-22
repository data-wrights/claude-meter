import * as vscode from "vscode";
import * as path from "path";
import { ClaudeUsageStatusBar } from "./statusBar";
import { fetchUsage, isExtensionError, normalizeResponse } from "./usageApi";
import { fetchAdminUsage, isAdminError } from "./adminApi";
import { resolveToken, promptForManualToken, getCredentialsFilePaths } from "./tokenProvider";
import { RefreshScheduler } from "./refreshScheduler";
import { DetailPanel } from "./detailPanel";
import { ErrorHandler } from "./errorHandler";
import { getConfig, onConfigChange } from "./config";
import { UsageSnapshot, AdminSnapshot } from "./types";

let statusBar: ClaudeUsageStatusBar;
let scheduler: RefreshScheduler;
let errorHandler: ErrorHandler;
let lastSnapshot: UsageSnapshot | null = null;
let lastAdminSnapshot: AdminSnapshot | null = null;
let extensionUri: vscode.Uri;

// Track whether we've shown a persistent error notification to avoid spamming
let lastErrorKind: string | null = null;

export function activate(context: vscode.ExtensionContext): void {
  extensionUri = context.extensionUri;
  errorHandler = new ErrorHandler();

  const config = getConfig();
  statusBar = new ClaudeUsageStatusBar(config);
  statusBar.showLoading();

  context.subscriptions.push(
    vscode.commands.registerCommand("claudeMeter.refresh", () => {
      void performRefresh();
    }),

    vscode.commands.registerCommand("claudeMeter.showDetails", () => {
      if (lastAdminSnapshot) {
        DetailPanel.show({ kind: "admin", data: lastAdminSnapshot }, extensionUri);
      } else {
        DetailPanel.show(lastSnapshot ? { kind: "oauth", data: lastSnapshot } : null, extensionUri);
      }
    }),

    vscode.commands.registerCommand("claudeMeter.configure", async () => {
      await promptForManualToken();
      lastErrorKind = null;
      void performRefresh();
    }),

    vscode.commands.registerCommand("claudeMeter.clearToken", async () => {
      await vscode.workspace
        .getConfiguration("claudeMeter")
        .update("manualToken", "", vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        "Claude Meter: Manual token cleared."
      );
    })
  );

  // Watch for config changes: restart scheduler and re-fetch
  onConfigChange(() => {
    const newConfig = getConfig();
    scheduler.start(newConfig);
    lastErrorKind = null;
    void performRefresh();
  }, context.subscriptions);

  scheduler = new RefreshScheduler(performRefresh);
  scheduler.start(config);

  // Watch credential files so a Claude Code token refresh triggers an immediate re-fetch
  for (const credPath of getCredentialsFilePaths()) {
    const pattern = new vscode.RelativePattern(
      vscode.Uri.file(path.dirname(credPath)),
      path.basename(credPath)
    );
    const watcher = vscode.workspace.createFileSystemWatcher(pattern, false, false, true);
    const onCredChange = () => {
      lastErrorKind = null; // allow errors to surface again after a credential update
      void performRefresh();
    };
    context.subscriptions.push(watcher, watcher.onDidCreate(onCredChange), watcher.onDidChange(onCredChange));
  }

  // Immediate fetch on activation
  void performRefresh();

  context.subscriptions.push(statusBar, scheduler);
}

async function performRefresh(): Promise<void> {
  const config = getConfig();
  statusBar.showLoading();

  // 1. Resolve token
  const tokenResult = await resolveToken(config.manualToken);
  if ("kind" in tokenResult) {
    statusBar.showError(tokenResult);
    if (lastErrorKind !== tokenResult.kind) {
      lastErrorKind = tokenResult.kind;
      await errorHandler.handleError(tokenResult);
    }
    return;
  }

  lastErrorKind = null;

  // 2. Branch by token type
  if (tokenResult.tokenType === "admin-key") {
    await performAdminRefresh(tokenResult.token);
  } else if (tokenResult.tokenType === "oauth") {
    await performOauthRefresh(tokenResult.token, config, tokenResult.source);
  } else {
    // Regular API key — no usage endpoint available
    statusBar.showError({
      kind: "api-error",
      message: "Regular API keys (sk-ant-...) cannot access usage data. Use an OAuth token (via Claude Code) or an admin key (sk-ant-admin-...).",
    });
  }
}

async function performOauthRefresh(token: string, config: ReturnType<typeof getConfig>, tokenSource: "auto-claude-code" | "manual-setting"): Promise<void> {
  const apiResult = await fetchUsage(token);
  if (isExtensionError(apiResult)) {
    statusBar.showError(apiResult);
    if (lastErrorKind !== apiResult.kind) {
      lastErrorKind = apiResult.kind;
      await errorHandler.handleError(apiResult);
    }
    // If the auto-detected token is expired, retry in 30 s — Claude Code may refresh it
    if (apiResult.kind === "token-expired" && tokenSource === "auto-claude-code") {
      scheduler.scheduleRetry(30_000);
    }
    return;
  }

  lastAdminSnapshot = null;
  lastSnapshot = normalizeResponse(apiResult);
  statusBar.showUsage(lastSnapshot, config);

  if (lastSnapshot.fiveHour) {
    errorHandler.notifyIfHighUsage(
      lastSnapshot.fiveHour.utilization,
      "five_hour",
      "Daily",
      config.notifyAtThreshold
    );
  }
  if (lastSnapshot.sevenDay) {
    errorHandler.notifyIfHighUsage(
      lastSnapshot.sevenDay.utilization,
      "seven_day",
      "Weekly",
      config.notifyAtThreshold
    );
  }

  DetailPanel.updateIfOpen({ kind: "oauth", data: lastSnapshot });
}

async function performAdminRefresh(adminKey: string): Promise<void> {
  const result = await fetchAdminUsage(adminKey);
  if (isAdminError(result)) {
    statusBar.showError(result);
    if (lastErrorKind !== result.kind) {
      lastErrorKind = result.kind;
      await errorHandler.handleError(result);
    }
    return;
  }

  lastSnapshot = null;
  lastAdminSnapshot = result;
  statusBar.showAdminUsage(lastAdminSnapshot);

  DetailPanel.updateIfOpen({ kind: "admin", data: lastAdminSnapshot });
}

export function deactivate(): void {
  scheduler?.dispose();
  statusBar?.dispose();
}
