# Security and privacy

VSignal is a local Windows extension. It has no telemetry, analytics endpoint, advertising SDK, or VSignal-operated server.

## Local files

The extension may read or update only these user-level integration files:

- `%USERPROFILE%\.vsignal\agent-done.ps1`
- `%USERPROFILE%\.vsignal\claude-quota.json`
- `%USERPROFILE%\.claude\settings.json`
- `%USERPROFILE%\.codex\config.toml`

Before its first configuration change, VSignal creates a local `.before-vsignal.bak` backup when the source file already exists. Existing unrelated settings and hooks are preserved.

## Data handling

- Hook payloads are processed in memory to classify the final state and are not persisted.
- Conversation text is not sent anywhere by VSignal.
- Only Claude quota percentages and reset timestamps can be cached locally.
- Codex quotas are read through the local Codex App Server using the account already connected to Codex. VSignal does not read or store authentication tokens.
- The popup is rendered locally with Windows PowerShell 5.1 and WPF.

## Reporting a vulnerability

Do not publish credentials or private conversation data in a public issue. Use the repository owner’s private security-reporting channel when one is available.
