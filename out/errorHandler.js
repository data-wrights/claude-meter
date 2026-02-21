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
exports.ErrorHandler = void 0;
const vscode = __importStar(require("vscode"));
class ErrorHandler {
    thresholdNotifiedWindows = new Set();
    async handleError(error) {
        switch (error.kind) {
            case "no-token": {
                const choice = await vscode.window.showWarningMessage("Claude Usage Monitor: No authentication token found.", "Enter Token", "Open Settings");
                if (choice === "Enter Token") {
                    await vscode.commands.executeCommand("claudeUsage.configure");
                }
                else if (choice === "Open Settings") {
                    await vscode.commands.executeCommand("workbench.action.openSettings", "claudeUsage.manualToken");
                }
                break;
            }
            case "token-expired": {
                const choice = await vscode.window.showWarningMessage("Claude Usage Monitor: Token expired or invalid. Re-authenticate Claude Code or update your token.", "Enter New Token");
                if (choice === "Enter New Token") {
                    await vscode.commands.executeCommand("claudeUsage.configure");
                }
                break;
            }
            case "rate-limited": {
                const retryStr = error.retryAfter
                    ? ` Retry after ${error.retryAfter.toLocaleTimeString()}.`
                    : "";
                vscode.window.showInformationMessage(`Claude Usage Monitor: Rate limited by Anthropic API.${retryStr}`);
                break;
            }
            // network-error, api-error, parse-error: surface in status bar tooltip only
            default:
                break;
        }
    }
    // Notify once when a window crosses the threshold; reset when it drops below
    notifyIfHighUsage(utilization, windowKey, windowLabel, threshold) {
        if (utilization >= threshold) {
            if (!this.thresholdNotifiedWindows.has(windowKey)) {
                this.thresholdNotifiedWindows.add(windowKey);
                vscode.window.showWarningMessage(`Claude Usage Monitor: ${windowLabel} utilization is at ` +
                    `${Math.round(utilization * 100)}% ` +
                    `(threshold: ${Math.round(threshold * 100)}%).`);
            }
        }
        else {
            this.thresholdNotifiedWindows.delete(windowKey);
        }
    }
}
exports.ErrorHandler = ErrorHandler;
//# sourceMappingURL=errorHandler.js.map