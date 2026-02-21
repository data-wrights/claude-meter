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
exports.fetchAdminUsage = fetchAdminUsage;
exports.isAdminError = isAdminError;
exports.formatTokens = formatTokens;
const https = __importStar(require("https"));
const HOST = "api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
function sumBucket(bucket) {
    let inputTokens = 0;
    let outputTokens = 0;
    for (const r of bucket.results) {
        inputTokens += (r.uncached_input_tokens ?? 0)
            + (r.cache_read_input_tokens ?? 0);
        outputTokens += (r.output_tokens ?? 0);
    }
    return {
        startingAt: bucket.starting_at,
        endingAt: bucket.ending_at,
        inputTokens,
        outputTokens,
    };
}
function isoWeekAgo() {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 7);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
}
function todayUtcMidnight() {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10); // "YYYY-MM-DD" for comparison
}
async function callAdminApi(adminKey, startingAt) {
    return new Promise((resolve) => {
        const qs = `starting_at=${encodeURIComponent(startingAt)}&bucket_width=1d`;
        const options = {
            hostname: HOST,
            path: `/v1/organizations/usage_report/messages?${qs}`,
            method: "GET",
            headers: {
                "x-api-key": adminKey,
                "anthropic-version": ANTHROPIC_VERSION,
                "User-Agent": "vscode-claude-usage-monitor/1.0.0",
            },
            timeout: 15000,
        };
        const req = https.request(options, (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => { body += chunk; });
            res.on("end", () => {
                const status = res.statusCode ?? 0;
                if (status === 401 || status === 403) {
                    resolve({ kind: "token-expired", message: "Admin API key rejected (401/403). Ensure you are using an sk-ant-admin-... key.", httpStatus: status });
                    return;
                }
                if (status === 429) {
                    resolve({ kind: "rate-limited", message: "Admin API rate limited.", httpStatus: status });
                    return;
                }
                if (status < 200 || status >= 300) {
                    resolve({ kind: "api-error", message: `Admin API HTTP ${status}`, httpStatus: status });
                    return;
                }
                try {
                    resolve(JSON.parse(body));
                }
                catch {
                    resolve({ kind: "parse-error", message: "Failed to parse admin API response." });
                }
            });
        });
        req.on("timeout", () => { req.destroy(); resolve({ kind: "network-error", message: "Admin API request timed out." }); });
        req.on("error", (e) => resolve({ kind: "network-error", message: e.message }));
        req.end();
    });
}
function isError(v) {
    return typeof v.kind === "string";
}
async function fetchAdminUsage(adminKey) {
    const report = await callAdminApi(adminKey, isoWeekAgo());
    if (isError(report)) {
        return report;
    }
    const buckets = report.data ?? [];
    const todayPrefix = todayUtcMidnight();
    let todayBucket = null;
    const weekTotal = { startingAt: "", endingAt: "", inputTokens: 0, outputTokens: 0 };
    for (const b of buckets) {
        const summed = sumBucket(b);
        weekTotal.inputTokens += summed.inputTokens;
        weekTotal.outputTokens += summed.outputTokens;
        if (!weekTotal.startingAt) {
            weekTotal.startingAt = summed.startingAt;
        }
        weekTotal.endingAt = summed.endingAt;
        if (summed.startingAt.startsWith(todayPrefix)) {
            todayBucket = summed;
        }
    }
    return { today: todayBucket, week: weekTotal, fetchedAt: new Date() };
}
function isAdminError(v) {
    return typeof v.kind === "string";
}
// Format large token counts compactly: 1200000 → "1.2M", 45000 → "45k"
function formatTokens(n) {
    if (n >= 1_000_000) {
        return `${(n / 1_000_000).toFixed(1)}M`;
    }
    if (n >= 1_000) {
        return `${Math.round(n / 1_000)}k`;
    }
    return `${n}`;
}
//# sourceMappingURL=adminApi.js.map