import * as vscode from "vscode";
import { ExtensionError } from "./types";

export class ErrorHandler {
  private thresholdNotifiedWindows = new Set<string>();

  async handleError(error: ExtensionError): Promise<void> {
    switch (error.kind) {
      case "no-token": {
        const choice = await vscode.window.showWarningMessage(
          "Claude Usage Monitor: No authentication token found.",
          "Enter Token",
          "Open Settings"
        );
        if (choice === "Enter Token") {
          await vscode.commands.executeCommand("claudeUsage.configure");
        } else if (choice === "Open Settings") {
          await vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "claudeUsage.manualToken"
          );
        }
        break;
      }

      case "token-expired": {
        const choice = await vscode.window.showWarningMessage(
          "Claude Usage Monitor: Token expired or invalid. Re-authenticate Claude Code or update your token.",
          "Enter New Token"
        );
        if (choice === "Enter New Token") {
          await vscode.commands.executeCommand("claudeUsage.configure");
        }
        break;
      }

      case "rate-limited": {
        const retryStr = error.retryAfter
          ? ` Retry after ${error.retryAfter.toLocaleTimeString()}.`
          : "";
        vscode.window.showInformationMessage(
          `Claude Usage Monitor: Rate limited by Anthropic API.${retryStr}`
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
          `Claude Usage Monitor: ${windowLabel} utilization is at ` +
            `${Math.round(utilization * 100)}% ` +
            `(threshold: ${Math.round(threshold * 100)}%).`
        );
      }
    } else {
      this.thresholdNotifiedWindows.delete(windowKey);
    }
  }
}
