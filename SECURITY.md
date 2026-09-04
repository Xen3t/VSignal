# Security and privacy

VSignal is a local Windows extension. It has no telemetry, analytics endpoint, advertising SDK, or VSignal-operated server.

## Local files and state

The extension may create or update these user-level files:

- `%USERPROFILE%\.vsignal\agent-done.ps1`
- `%USERPROFILE%\.vsignal\popup.json`
- `%USERPROFILE%\.vsignal\disabled`
- `%USERPROFILE%\.vsignal\claude-quota.json`
- `%USERPROFILE%\.vsignal\task-quota-claude.txt`
- `%USERPROFILE%\.vsignal\task-quota-codex.txt`
- `%USERPROFILE%\.claude\settings.json`
- `%USERPROFILE%\.codex\config.toml`

Before its first change to an existing Claude or Codex configuration, VSignal creates a sibling `.before-vsignal.bak` backup. Existing unrelated settings, comments, tables, and hooks are preserved. VSignal also stores the last percentages used for transition-based quota alerts in VS Code's extension global state.

For migration only, VSignal may read `%USERPROFILE%\.agent-notifications\disabled` and `%USERPROFILE%\.agent-notifications\claude-quota.json`.

## Quota sources

- Claude quota snapshots are read from `%USERPROFILE%\.claude.json`.
- For a fresh manual reading, VSignal reads Claude Code's OAuth access token from `%USERPROFILE%\.claude\.credentials.json` in memory and sends it only to `https://api.anthropic.com/api/oauth/usage`. The token is never logged or stored by VSignal. Automatic calls reuse a local result for up to five minutes and fall back to local snapshots on authentication, rate-limit, or network errors.
- To account for a snapshot that lags behind a quota refusal, VSignal enumerates `%USERPROFILE%\.claude\projects`, opens only `.jsonl` files modified after that snapshot, and parses at most the last 300 lines of each candidate until both quota windows are found.
- Codex quotas are read by starting the locally installed `codex app-server` and requesting `account/rateLimits/read` through its standard input and output. VSignal does not read or store authentication tokens.
- Gemini's weekly quota is read from the JSON output of the locally installed Antigravity CLI command `agy /quota`. Authentication and the request to Google's quota service are handled by `agy`; VSignal does not read its credentials.

## Data handling

- Hook payloads are processed in memory to classify the final state and are not persisted.
- Conversation text is not sent anywhere by VSignal.
- Cached local state is limited to quota percentages, reset timestamps, task baselines, popup preferences, and alert-transition baselines.
- VSignal's only direct network request is the Claude usage read described above, sent to Anthropic. Codex and Gemini usage are read through their locally installed command-line applications.
- The popup is rendered locally with Windows PowerShell 5.1 and WPF.

## Reporting a vulnerability

Do not publish credentials or private conversation data in a public issue. Use the repository owner’s private security-reporting channel when one is available.
