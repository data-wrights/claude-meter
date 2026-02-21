# Claude Usage Monitor

A VS Code extension that shows your Claude subscription usage directly in the status bar — no browser required.

## Features

- **Status bar display** — live Daily and Weekly usage percentages at a glance
- **Countdown to reset** — shows time remaining (e.g. `Daily:26%·3h  Weekly:20%·5d`)
- **Color-coded alerts** — orange at ≥80%, red background at ≥100%
- **Hover tooltip** — ASCII progress bars with exact reset times per window
- **Detail panel** — click the status bar item for a full breakdown with bar charts
- **Model breakdown** — optional Opus/Sonnet sub-bars in the tooltip
- **Enterprise support** — admin API keys (`sk-ant-admin-...`) show token counts (Today/Week)
- **Auto token detection** — reads your Claude Code credentials automatically, no setup needed

## Status Bar

```
$(pulse) Daily:26%·3h  Weekly:20%·5d        ← normal (orange)
$(alert) Daily:81%·45m  Weekly:20%·5d       ← high usage ≥80%
$(warning) Daily:103%·now  Weekly:95%·2d    ← over limit ≥100%
$(pulse) Today:1.2M  Week:8.5M              ← enterprise / admin key
```

## Token Support

| Token type | Source | What you see |
|---|---|---|
| OAuth (auto) | `~/.claude/.credentials.json` | Daily % · Weekly % |
| OAuth (manual) | VS Code setting | Daily % · Weekly % |
| Admin key (`sk-ant-admin-...`) | VS Code setting | Token counts (Today / Week) |

Claude Code users are detected automatically — no configuration needed.

## Setup

### Claude Code users (automatic)
Install the extension and open any workspace. The extension reads your token from `~/.claude/.credentials.json` automatically.

### Manual token
1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run **Claude Usage: Enter Token**
3. Paste your OAuth bearer token

### Enterprise / Admin key
1. Open VS Code Settings (`Ctrl+,`)
2. Search for `claudeUsage.manualToken`
3. Paste your admin key (`sk-ant-admin-...`)

## Commands

| Command | Description |
|---|---|
| `Claude Usage: Refresh Now` | Force an immediate data refresh |
| `Claude Usage: Show Details` | Open the detail panel |
| `Claude Usage: Enter Token` | Paste a token manually (saved to settings) |
| `Claude Usage: Clear Cached Token` | Remove the manually saved token |

## Settings

| Setting | Default | Description |
|---|---|---|
| `claudeUsage.refreshIntervalMinutes` | `5` | How often to poll the API (1–60 min) |
| `claudeUsage.manualToken` | `""` | Override the auto-detected token |
| `claudeUsage.statusBarPosition` | `"right"` | `"left"` or `"right"` side of the status bar |
| `claudeUsage.statusBarPriority` | `100` | Position within the chosen side (higher = further left) |
| `claudeUsage.showModelBreakdown` | `false` | Show Opus/Sonnet sub-bars in the tooltip |
| `claudeUsage.notifyAtThreshold` | `0.9` | Notify when any window hits this fraction (set to `1.0` to silence) |

## Requirements

- VS Code 1.94 or later
- An active Claude subscription (Pro, Max, Teams, or Enterprise)
- Claude Code installed and authenticated, **or** a manually entered token
