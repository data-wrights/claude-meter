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
exports.fetchUsage = fetchUsage;
exports.isExtensionError = isExtensionError;
exports.normalizeResponse = normalizeResponse;
const https = __importStar(require("https"));
const USAGE_ENDPOINT_HOST = "api.anthropic.com";
const USAGE_ENDPOINT_PATH = "/api/oauth/usage";
const BETA_HEADER = "oauth-2025-04-20";
async function fetchUsage(token) {
    return new Promise((resolve) => {
        const options = {
            hostname: USAGE_ENDPOINT_HOST,
            path: USAGE_ENDPOINT_PATH,
            method: "GET",
            headers: {
                Authorization: `Bearer ${token}`,
                "anthropic-beta": BETA_HEADER,
                "Content-Type": "application/json",
                "User-Agent": "vscode-claude-usage-monitor/1.0.0",
            },
            timeout: 10000,
        };
        const req = https.request(options, (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => {
                body += chunk;
            });
            res.on("end", () => {
                const status = res.statusCode ?? 0;
                if (status === 401 || status === 403) {
                    resolve({
                        kind: "token-expired",
                        message: "Authentication failed. Token may be expired or invalid.",
                        httpStatus: status,
                    });
                    return;
                }
                if (status === 429) {
                    const retryAfterHeader = res.headers["retry-after"];
                    const retryAfterSec = retryAfterHeader
                        ? parseInt(String(retryAfterHeader), 10)
                        : 60;
                    resolve({
                        kind: "rate-limited",
                        message: "Rate limited by Anthropic API.",
                        retryAfter: new Date(Date.now() + retryAfterSec * 1000),
                        httpStatus: status,
                    });
                    return;
                }
                if (status < 200 || status >= 300) {
                    resolve({
                        kind: "api-error",
                        message: `Unexpected API response: HTTP ${status}`,
                        httpStatus: status,
                    });
                    return;
                }
                try {
                    const data = JSON.parse(body);
                    resolve(data);
                }
                catch {
                    resolve({
                        kind: "parse-error",
                        message: "Failed to parse API response as JSON.",
                    });
                }
            });
        });
        req.on("timeout", () => {
            req.destroy();
            resolve({ kind: "network-error", message: "Request timed out after 10s." });
        });
        req.on("error", (err) => {
            resolve({ kind: "network-error", message: `Network error: ${err.message}` });
        });
        req.end();
    });
}
function isExtensionError(value) {
    return typeof value.kind === "string";
}
function normalizeWindow(w) {
    if (!w)
        return null;
    // API returns utilization as a percentage (e.g. 15.0 = 15%), normalize to 0–1
    return { utilization: w.utilization / 100, resets_at: w.resets_at };
}
function normalizeResponse(raw) {
    return {
        fiveHour: normalizeWindow(raw.five_hour),
        sevenDay: normalizeWindow(raw.seven_day),
        sevenDayOpus: normalizeWindow(raw.seven_day_opus),
        sevenDaySonnet: normalizeWindow(raw.seven_day_sonnet),
        fetchedAt: new Date(),
    };
}
//# sourceMappingURL=usageApi.js.map