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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const statusBar_1 = require("./statusBar");
const usageApi_1 = require("./usageApi");
const adminApi_1 = require("./adminApi");
const tokenProvider_1 = require("./tokenProvider");
const refreshScheduler_1 = require("./refreshScheduler");
const detailPanel_1 = require("./detailPanel");
const errorHandler_1 = require("./errorHandler");
const config_1 = require("./config");
let statusBar;
let scheduler;
let errorHandler;
let lastSnapshot = null;
let lastAdminSnapshot = null;
let extensionUri;
// Track whether we've shown a persistent error notification to avoid spamming
let lastErrorKind = null;
function activate(context) {
    extensionUri = context.extensionUri;
    errorHandler = new errorHandler_1.ErrorHandler();
    const config = (0, config_1.getConfig)();
    statusBar = new statusBar_1.ClaudeUsageStatusBar(config);
    statusBar.showLoading();
    context.subscriptions.push(vscode.commands.registerCommand("claudeUsage.refresh", () => {
        void performRefresh();
    }), vscode.commands.registerCommand("claudeUsage.showDetails", () => {
        if (lastAdminSnapshot) {
            detailPanel_1.DetailPanel.show({ kind: "admin", data: lastAdminSnapshot }, extensionUri);
        }
        else {
            detailPanel_1.DetailPanel.show(lastSnapshot ? { kind: "oauth", data: lastSnapshot } : null, extensionUri);
        }
    }), vscode.commands.registerCommand("claudeUsage.configure", async () => {
        await (0, tokenProvider_1.promptForManualToken)();
        lastErrorKind = null;
        void performRefresh();
    }), vscode.commands.registerCommand("claudeUsage.clearToken", async () => {
        await vscode.workspace
            .getConfiguration("claudeUsage")
            .update("manualToken", "", vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage("Claude Usage Monitor: Manual token cleared.");
    }));
    // Watch for config changes: restart scheduler and re-fetch
    (0, config_1.onConfigChange)(() => {
        const newConfig = (0, config_1.getConfig)();
        scheduler.start(newConfig);
        lastErrorKind = null;
        void performRefresh();
    }, context.subscriptions);
    scheduler = new refreshScheduler_1.RefreshScheduler(performRefresh);
    scheduler.start(config);
    // Immediate fetch on activation
    void performRefresh();
    context.subscriptions.push(statusBar, scheduler);
}
async function performRefresh() {
    const config = (0, config_1.getConfig)();
    statusBar.showLoading();
    // 1. Resolve token
    const tokenResult = await (0, tokenProvider_1.resolveToken)(config.manualToken);
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
    }
    else if (tokenResult.tokenType === "oauth") {
        await performOauthRefresh(tokenResult.token, config);
    }
    else {
        // Regular API key — no usage endpoint available
        statusBar.showError({
            kind: "api-error",
            message: "Regular API keys (sk-ant-...) cannot access usage data. Use an OAuth token (via Claude Code) or an admin key (sk-ant-admin-...).",
        });
    }
}
async function performOauthRefresh(token, config) {
    const apiResult = await (0, usageApi_1.fetchUsage)(token);
    if ((0, usageApi_1.isExtensionError)(apiResult)) {
        statusBar.showError(apiResult);
        if (lastErrorKind !== apiResult.kind) {
            lastErrorKind = apiResult.kind;
            await errorHandler.handleError(apiResult);
        }
        return;
    }
    lastAdminSnapshot = null;
    lastSnapshot = (0, usageApi_1.normalizeResponse)(apiResult);
    statusBar.showUsage(lastSnapshot, config);
    if (lastSnapshot.fiveHour) {
        errorHandler.notifyIfHighUsage(lastSnapshot.fiveHour.utilization, "five_hour", "Daily", config.notifyAtThreshold);
    }
    if (lastSnapshot.sevenDay) {
        errorHandler.notifyIfHighUsage(lastSnapshot.sevenDay.utilization, "seven_day", "Weekly", config.notifyAtThreshold);
    }
    detailPanel_1.DetailPanel.show({ kind: "oauth", data: lastSnapshot }, extensionUri);
}
async function performAdminRefresh(adminKey) {
    const result = await (0, adminApi_1.fetchAdminUsage)(adminKey);
    if ((0, adminApi_1.isAdminError)(result)) {
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
    detailPanel_1.DetailPanel.show({ kind: "admin", data: lastAdminSnapshot }, extensionUri);
}
function deactivate() {
    scheduler?.dispose();
    statusBar?.dispose();
}
//# sourceMappingURL=extension.js.map