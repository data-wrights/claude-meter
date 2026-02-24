import * as vscode from "vscode";
import { ExtensionError } from "./types";

export class ErrorHandler {
  private thresholdNotifiedWindows = new Set<string>();

  async handleError(error: ExtensionError): Promise<void> {
    switch (error.kind) {
      case "no-token": {
        const choice = await vscode.window.showWarningMessage(
          "Claude Meter: No authentication token found.",
          "Enter Token",
          "Open Settings"
        );
        if (choice === "Enter Token") {
          await vscode.commands.executeCommand("claudeMeter.configure");
        } else if (choice === "Open Settings") {
          await vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "claudeMeter.manualToken"
          );
        }
        break;
      }

      case "token-expired":
        // Status bar already shows "Auth expired" — no popup to avoid repeated notifications
        // while waiting for Claude Code to auto-refresh the token.
        break;

      case "rate-limited": {
        const retryStr = error.retryAfter
          ? ` Retry after ${error.retryAfter.toLocaleTimeString()}.`
          : "";
        vscode.window.showInformationMessage(
          `Claude Meter: Rate limited by Anthropic API.${retryStr}`
        );
        break;
      }

      // network-error, api-error, parse-error: surface in status bar tooltip only
      default:
        break;
    }
  }

  // Notify once when a window crosses the threshold; reset when it drops below
  notifyIfHighUsage(
    utilization: number,
    windowKey: string,
    windowLabel: string,
    threshold: number
  ): void {
    if (utilization >= threshold) {
      if (!this.thresholdNotifiedWindows.has(windowKey)) {
        this.thresholdNotifiedWindows.add(windowKey);
        vscode.window.showWarningMessage(
          `Claude Meter: ${windowLabel} utilization is at ` +
            `${Math.round(utilization * 100)}% ` +
            `(threshold: ${Math.round(threshold * 100)}%).`
        );
      }
    } else {
      this.thresholdNotifiedWindows.delete(windowKey);
    }
  }
}
