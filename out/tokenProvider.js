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
exports.detectTokenType = detectTokenType;
exports.resolveToken = resolveToken;
exports.promptForManualToken = promptForManualToken;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const vscode = __importStar(require("vscode"));
function detectTokenType(token) {
    if (token.startsWith("sk-ant-admin-")) {
        return "admin-key";
    }
    if (token.startsWith("sk-ant-")) {
        return "api-key";
    }
    return "oauth";
}
function getCredentialsFilePaths() {
    const home = os.homedir();
    const candidates = [
        // Claude Code standard path (confirmed on Windows)
        path.join(home, ".claude", ".credentials.json"),
    ];
    if (process.platform === "win32" && process.env.APPDATA) {
        candidates.push(path.join(process.env.APPDATA, "Claude", ".credentials.json"), path.join(process.env.APPDATA, "claude", ".credentials.json"));
    }
    else if (process.platform === "darwin") {
        candidates.push(path.join(home, "Library", "Application Support", "Claude", ".credentials.json"));
    }
    else if (process.platform === "linux") {
        candidates.push(path.join(home, ".config", "claude", ".credentials.json"));
    }
    return candidates;
}
function tryReadCredentialsFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            return null;
        }
        const raw = fs.readFileSync(filePath, "utf8");
        const data = JSON.parse(raw);
        const oauth = data.claudeAiOauth;
        if (!oauth?.accessToken) {
            return null;
        }
        return {
            token: oauth.accessToken,
            source: "auto-claude-code",
            tokenType: detectTokenType(oauth.accessToken),
            expiresAt: oauth.expiresAt,
        };
    }
    catch {
        return null;
    }
}
async function resolveToken(manualToken) {
    // 1. Manual override takes highest priority
    if (manualToken && manualToken.trim().length > 0) {
        const token = manualToken.trim();
        return { token, source: "manual-setting", tokenType: detectTokenType(token) };
    }
    // 2. Auto-detect from Claude Code credentials file
    for (const credPath of getCredentialsFilePaths()) {
        const result = tryReadCredentialsFile(credPath);
        if (result) {
            return result;
        }
    }
    // 3. No token found
    return {
        kind: "no-token",
        message: "Could not find a Claude OAuth token. " +
            "Set claudeUsage.manualToken in VS Code settings, " +
            "or ensure Claude Code is installed and authenticated.",
    };
}
async function promptForManualToken() {
    const value = await vscode.window.showInputBox({
        title: "Claude Usage Monitor: Enter Token",
        prompt: "Paste your Claude OAuth bearer token. " +
            "This will be saved to claudeUsage.manualToken in your VS Code settings.",
        password: true,
        placeHolder: "Bearer token from ~/.claude/.credentials.json",
        ignoreFocusOut: true,
    });
    if (value) {
        await vscode.workspace
            .getConfiguration("claudeUsage")
            .update("manualToken", value, vscode.ConfigurationTarget.Global);
    }
    return value;
}
//# sourceMappingURL=tokenProvider.js.map