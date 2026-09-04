# VSignal

[Français](README.md) · [English](README.en.md)

> Models reply. VSignal lets you know.

VSignal displays a discreet Windows popup whenever a Claude Code or Codex task finishes in VS Code, and monitors Claude, Codex, and Gemini quotas. Notifications stay independent from the Windows Notification Center, adapt to the task outcome, and show available reset times.

[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
![Windows 11](https://img.shields.io/badge/Windows-11-0078D4.svg)
![VS Code](https://img.shields.io/badge/VS%20Code-1.85%2B-23A8F2.svg)

## Features

- Horizontal WPF popup in the upper-right corner: translucent dark surface, provider-colored glow and waveform, model brand, title, subtitle, and lifetime bar.
- Hovering pauses the close timer and restarts it from zero; only `Open` brings VS Code to the foreground, while clicking anywhere else simply dismisses the popup.
- **The brand identifies the model; the color indicates severity.** The Claude, Codex, or Gemini logo identifies the sender, while green, orange, and red remain reserved for quota status.
- A message adapted to the situation: task completed, question, blockage, code changed, or tests passed.
- `5 h` and `7 d` quota bars shown as **used** percentages, like Claude Code's `/usage`: green while there is plenty of headroom, orange from 60%, and red from 80%.
- A compact `+N%` indicator on the right side of the popup showing the completed task's `5 h` quota cost, which can be disabled separately for Claude and Codex.
- A dedicated VS Code panel: keep the Claude, Codex, and Gemini quotas you choose visible while everything else can be collapsed with one click.
- Automatic alerts when a quota window becomes low **or** resets, configurable separately for each model.
- Automatic setup whenever VS Code starts, regardless of which project is open.
- No VSignal server, telemetry, or native Windows notification.
- Interface and popups available in French and English, with automatic VS Code language detection.

## Requirements

- Windows 11
- VS Code 1.85 or later
- Claude Code, Codex, and/or Antigravity CLI (`agy`) installed and signed in

VSignal only uses Windows PowerShell 5.1 and WPF, which are already included with Windows.

## Installation

### From a VSIX file

1. Download the latest `vsignal-*.vsix` file from [Releases](https://github.com/Xen3t/VSignal/releases).
2. Open the VS Code Command Palette with `Ctrl+Shift+P`.
3. Run `Extensions: Install from VSIX...` and select the file.
4. Reload VS Code if prompted.

The VSignal icon then appears in the Activity Bar on the left. The extension installs its PowerShell script at `%USERPROFILE%\.vsignal\agent-done.ps1`, then merges its hooks into the existing Claude and Codex configurations without overwriting unrelated settings.

### Build from source

```powershell
git clone https://github.com/Xen3t/VSignal.git
cd VSignal
npm install
npm run check
npm run package
```

Then install the generated `vsignal-*.vsix` file from the project root.

## Usage

The VSignal panel in the Activity Bar brings everything together:

- **Quotas** occupy the top of the panel without a heading or collapse control: selected providers are shown in dedicated cards. Each card has its own refresh button; the button beside the `Active` status refreshes them all.
- **Settings** — one general group followed by a complete group for each provider (`Claude`, `Codex`, `Gemini`) containing its visibility, popup quotas, and alerts.
- **Actions** — test each model, repair hooks, or remove them.

`Settings` and `Actions` collapse when their headings are clicked, and their state is remembered. This lets the panel shrink to quotas only without making the controls inaccessible.

In a narrow column, the reset time does not disappear: it shortens from `resets in 27 min` to `27 min`, then to `27 m`. The percentage always remains fully visible.

Because hooks are reinstalled and repaired whenever VS Code starts, the panel does not dedicate space to their status. To check them occasionally, run `VSignal: Show status` for a summary of the script, Claude hooks, and Codex hook.

The same actions are available in the Command Palette:

- `VSignal: Enable / disable`
- `VSignal: Refresh quotas`
- `VSignal: Set up Claude and Codex`
- `VSignal: Test Claude`
- `VSignal: Test Codex`
- `VSignal: Test Gemini`
- `VSignal: Show status`
- `VSignal: Remove hooks`

### When are quotas refreshed?

As long as VS Code is open, VSignal reads **Claude and Codex every minute** while the panel is visible or at least one quota alert is enabled. It reads Gemini's weekly limit through the local `agy /quota` command when its card is visible or one of its alerts is enabled. The reads start together and are published once they return.

Additional reads, limited to once every 20 seconds, are triggered by changes to `~/.claude.json`—whose timestamp is polled to handle temporary-file writes followed by renames—and whenever the VS Code window regains focus. The refresh button forces a fresh Claude usage read; automatic reads reuse that result for up to five minutes to avoid saturating the OAuth endpoint.

Nothing moves while a read is in progress: the last known values remain visible, the DOM is not rebuilt, and only changed values are updated in place. The bars glide to their new lengths instead of restarting from zero. Each card discreetly shows the age of its own reading to the left of its refresh button.

The usage snapshot written by Claude Code can lag by a few minutes. If Claude logs a quota-exceeded refusal in the meantime, VSignal cross-checks that local log against the snapshot and immediately shows 100% for the affected window without reading account credentials.

A Codex read briefly starts a `codex app-server`. Event-driven Claude refreshes, suspension of unnecessary background reads, and early termination of log scanning limit the cost of the one-minute cadence.

### Quota alerts

VSignal monitors Claude and Codex's `5 h` and `7 d` windows, plus Gemini's `7 d` window, and reports two events:

- **Low quota** — the window crosses the usage threshold. A red popup reminds you how much remains.
- **Reset** — the window resets to zero. A green popup indicates that the model is available again.

Both alerts trigger on **transitions**, never continuously: the low-quota alert is not repeated while usage remains high, and restarting VS Code does not produce a burst of notifications.

| Setting | Purpose |
| --- | --- |
| `vsignal.alert.lowQuota.claude` | Notify when a Claude window becomes low |
| `vsignal.alert.lowQuota.codex` | Notify when a Codex window becomes low |
| `vsignal.alert.lowQuota.gemini` | Notify when the Gemini window becomes low |
| `vsignal.alert.reset.claude` | Notify when a Claude window resets |
| `vsignal.alert.reset.codex` | Notify when a Codex window resets |
| `vsignal.alert.reset.gemini` | Notify when the Gemini window resets |
| `vsignal.alert.threshold` | Triggering used percentage; defaults to `90`, meaning 10% remains |

These alerts ignore the five settings below: the relevant quota bar is always shown because it is the subject of the notification itself.

### Choose which quotas appear in popups

An overloaded popup is hard to read. The five settings below determine what it shows independently from the cards selected in the VSignal panel.

| Setting | Quota bar |
| --- | --- |
| `vsignal.popup.claude.fiveHours` | Claude, 5-hour window |
| `vsignal.popup.claude.weekly` | Claude, 7-day window |
| `vsignal.popup.codex.fiveHours` | Codex, 5-hour window |
| `vsignal.popup.codex.weekly` | Codex, 7-day window |
| `vsignal.popup.gemini.weekly` | Gemini, 7-day window in tests and alerts |

If every bar for a model is disabled, its test popup contains only the message. Values are copied to `%USERPROFILE%\.vsignal\popup.json`, which is read by the PowerShell script.

The `vsignal.panel.providers.claude`, `vsignal.panel.providers.codex`, and `vsignal.panel.providers.gemini` settings independently select the cards shown in the extension bar. Hiding a card does not disable that provider's alerts.

To test the popup engine directly from the repository:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\resources\agent-done.ps1 -Agent Codex -State Tested
```

## Optional dual-monitor script

The optional [ShortcutsAddict.ahk](Script_Hotkey/ShortcutsAddict.ahk) script maps the key below `Esc` (`²` on AZERTY, `` ` `` on QWERTY) to swapping the two foreground windows between two monitors. It also turns `Caps Lock` into a shortcut modifier for launching applications and controlling sound and media playback. It is entirely independent from VSignal, is not included in the VSIX, and only requires [AutoHotkey v2](https://www.autohotkey.com/). The complete shortcut list is available in [SHORTCUTS.md](Script_Hotkey/SHORTCUTS.md).

## Files and privacy

VSignal may create or update the following files:

- `%USERPROFILE%\.vsignal\agent-done.ps1`
- `%USERPROFILE%\.vsignal\popup.json`
- `%USERPROFILE%\.vsignal\disabled`
- `%USERPROFILE%\.vsignal\claude-quota.json`
- `%USERPROFILE%\.vsignal\task-quota-claude.txt`
- `%USERPROFILE%\.vsignal\task-quota-codex.txt`
- `%USERPROFILE%\.claude\settings.json`
- `%USERPROFILE%\.codex\config.toml`

To display Claude quotas, the extension queries `https://api.anthropic.com/api/oauth/usage` with Claude Code's OAuth token, which is kept in memory only. On failure, it falls back to `%USERPROFILE%\.claude.json` and the tails of `.jsonl` logs modified since the latest snapshot under `%USERPROFILE%\.claude\projects`. Codex quotas are read through the local Codex App Server, and Gemini's quota is read from the JSON output of the local `agy /quota` command. A `.before-vsignal.bak` backup is created before the first modification to an existing configuration. Messages are analyzed in memory to choose the popup label, but they are neither stored nor sent by VSignal. See [SECURITY.md](SECURITY.md) for details.

## Uninstallation

Before uninstalling the extension, run `VSignal: Remove hooks` if you also want to remove its entries from the Claude and Codex configurations. You can then uninstall VSignal normally from the VS Code Extensions panel.

## Trademarks

The Claude, Codex, and Gemini logos displayed by VSignal identify their providers. They belong to Anthropic, OpenAI, and Google respectively, are not covered by VSignal's MIT license, and do not imply affiliation or endorsement.

## License

VSignal is distributed under the [MIT License](LICENSE), which permits use, modification, and redistribution under its permissive terms.
