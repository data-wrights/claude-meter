import * as vscode from "vscode";
import { ExtensionConfig } from "./types";

const SECTION = "claudeMeter";

export function getConfig(): ExtensionConfig {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  return {
    refreshIntervalMinutes: cfg.get<number>("refreshIntervalMinutes", 5),
    manualToken: cfg.get<string>("manualToken", ""),
    accountUuid: cfg.get<string>("accountUuid", ""),
    statusBarPosition: cfg.get<"left" | "right">("statusBarPosition", "right"),
    statusBarPriority: cfg.get<number>("statusBarPriority", 100),
    showModelBreakdown: cfg.get<boolean>("showModelBreakdown", false),
    notifyAtThreshold: cfg.get<number>("notifyAtThreshold", 0.9),
  };
}

export function onConfigChange(
  callback: () => void,
  disposables: vscode.Disposable[]
): void {
  vscode.workspace.onDidChangeConfiguration(
    (e) => {
      if (e.affectsConfiguration(SECTION)) {
        callback();
      }
    },
    undefined,
    disposables
  );
}
