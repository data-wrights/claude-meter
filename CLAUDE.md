# Claude Meter — Developer Guide

## What is this?

A VS Code extension that displays Claude subscription usage (daily/weekly percentages, token counts, or enterprise spend) in the status bar. Published as **DataWrights.claude-meter** on the VS Code Marketplace.

## Quick Reference

- **Language**: TypeScript (strict mode, ES2022 target, CommonJS modules)
- **Build**: `npm run compile` (runs `tsc -p ./`)
- **Watch**: `npm run watch`
- **Package**: `npx @vscode/vsce package`
- **Output**: compiled JS goes to `./out/`
- **No runtime dependencies** — only VS Code API and Node built-ins
- **No test framework** — no tests exist yet

## Architecture

```
extension.ts          Entry point. Orchestrates refresh cycle, manages history storage,
                      registers commands. All state lives here (snapshots, error tracking).

tokenProvider.ts      Resolves auth tokens. Auto-reads ~/.claude/.credentials.json
                      (platform-aware paths), or falls back to manual setting.
                      Returns TokenResult with type: "oauth" | "admin-key" | "api-key".

usageApi.ts           OAuth usage — GET /api/oauth/usage on api.anthropic.com.
                      Returns five_hour/seven_day utilization windows (0-100 scale).
                      normalizeResponse() divides by 100 to get 0-1 fractions.

adminApi.ts           Admin key usage — GET /v1/organizations/usage_report/messages.
                      Aggregates token buckets into today/week AdminSnapshot.

enterpriseApi.ts      Enterprise spend — fetches account UUID via multiple fallback
                      endpoints on claude.ai, then gets dollar-based spend/limit.

config.ts             Thin wrapper over vscode.workspace.getConfiguration("claudeMeter").
                      Returns typed ExtensionConfig. Watches for setting changes.

statusBar.ts          Renders the status bar item. Builds markdown tooltips with
                      progress bars, trend arrows, and reset countdowns. Color-codes
                      by severity (white → orange → red).

detailPanel.ts        Webview panel with HTML charts: sparklines, 30-day history,
                      model breakdown bars. Currently hardcoded dark theme.

refreshScheduler.ts   Manages the polling interval timer and one-shot retry scheduling.

errorHandler.ts       Shows VS Code notifications for errors and threshold alerts.
                      Tracks shown errors to avoid notification spam.

types.ts              All TypeScript interfaces — API responses, snapshots, config,
                      history tuples, error types.
```

## Data Flow

1. `activate()` → create status bar → start scheduler → immediate `performRefresh()`
2. `performRefresh()` → `resolveToken()` → branch by token type:
   - OAuth → `fetchUsage()` → if no five_hour/seven_day → try enterprise path
   - Admin → `fetchAdminUsage()`
   - Enterprise → `fetchAccountUuid()` + `fetchEnterpriseSpend()`
3. Update status bar → append to history → update daily aggregate → refresh detail panel if open
4. Check thresholds → notify if high usage

## Key Design Decisions

- **History uses compact tuples** (`[timestamp, slot1, slot2]`) instead of objects to minimize globalState JSON size. slot1/slot2 meaning depends on account type (see types.ts comments).
- **Utilization values**: API returns 0-100, internally normalized to 0-1 fractions after `normalizeResponse()`. Status bar displays as 0-100%.
- **Error deduplication**: `lastErrorKind` in extension.ts prevents showing the same error notification repeatedly. Reset on config change or credential file change.
- **Token-expired auto-retry**: For auto-detected Claude Code tokens, schedules a 30s retry (Claude Code may refresh the token in the background).
- **File watcher on credentials**: Monitors `~/.claude/.credentials.json` so token refreshes trigger immediate re-fetch without waiting for the next interval.

## Storage

Uses `extensionContext.globalState` with two keys:
- `claudeMeter.history` — rolling array of up to 60 `HistoryTuple` entries (~10h at 10-min intervals)
- `claudeMeter.daily` — up to 90 `DailyAggregate` entries (3 months of daily peaks)

## Settings (package.json `contributes.configuration`)

All under the `claudeMeter.*` namespace:
- `refreshIntervalMinutes` (10) — poll frequency, 1-60 min
- `manualToken` ("") — override auto-detected token
- `accountUuid` ("") — manual enterprise account UUID
- `statusBarPosition` ("right") — left or right side
- `statusBarPriority` (100) — position within side
- `showModelBreakdown` (false) — Opus/Sonnet sub-bars in tooltip
- `displayMode` ("used") — show used% or remaining%
- `notifyAtThreshold` (0.9) — warning notification threshold

## Commands

- `claudeMeter.refresh` — force immediate refresh
- `claudeMeter.showDetails` — open detail webview panel
- `claudeMeter.configure` — prompt for manual token
- `claudeMeter.clearToken` — clear manual token setting

## Common Patterns

- **Adding a new setting**: Add to `package.json` contributes.configuration, add field to `ExtensionConfig` in types.ts, read it in config.ts `getConfig()`, use it where needed.
- **Adding a new command**: Register in `package.json` contributes.commands, implement in `activate()` in extension.ts via `vscode.commands.registerCommand`.
- **Changing status bar display**: Edit `showUsage()` / `buildTooltip()` in statusBar.ts.
- **Changing detail panel**: Edit `buildHtml()` in detailPanel.ts (raw HTML string builder).
- **New API integration**: Create a new `*Api.ts` file following the pattern in usageApi.ts (fetch + type guard for errors), add a new branch in `performRefresh()`.

## Conventions

- No external runtime dependencies — keep it that way
- Strict TypeScript — no `any` types
- Error handling returns `ExtensionError` union types rather than throwing
- Status bar icons use VS Code codicons: `$(pulse)`, `$(warning)`, `$(alert)`, `$(error)`, `$(clock)`, `$(key)`, `$(loading~spin)`
- Tooltip content uses `vscode.MarkdownString` with `isTrusted = true`

## Roadmap

See [roadmap.md](roadmap.md) for planned features and release milestones.
