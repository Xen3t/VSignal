'use strict';

const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const SCRIPT_DIR = path.join(os.homedir(), '.vsignal');
const LEGACY_SCRIPT_DIR = path.join(os.homedir(), '.agent-notifications');
const SCRIPT_PATH = path.join(SCRIPT_DIR, 'agent-done.ps1');
const DISABLED_PATH = path.join(SCRIPT_DIR, 'disabled');
const PREFS_PATH = path.join(SCRIPT_DIR, 'popup.json');
const CLAUDE_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const CODEX_CONFIG = path.join(os.homedir(), '.codex', 'config.toml');
const MANAGED_FRAGMENTS = [
  '.vsignal\\agent-done.ps1',
  '.agent-notifications\\agent-done.ps1'
];
// Fenetres de quota affichables dans les popups. Le panneau, lui, montre tout.
const POPUP_PREFERENCES = [
  { key: 'popup.claude.fiveHours', field: 'ClaudeShort', agent: 'Claude', label: 'Claude — 5 h' },
  { key: 'popup.claude.weekly', field: 'ClaudeWeekly', agent: 'Claude', label: 'Claude — 7 j' },
  { key: 'popup.codex.fiveHours', field: 'CodexShort', agent: 'Codex', label: 'Codex — 5 h' },
  { key: 'popup.codex.weekly', field: 'CodexWeekly', agent: 'Codex', label: 'Codex — 7 j' }
];

let controlPanelProvider;

const claudeStopCommand = () =>
  `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${SCRIPT_PATH}" -Agent Claude -ReadStdin`;
const claudeQuestionCommand = () =>
  `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${SCRIPT_PATH}" -Agent Claude -State Question`;
const claudeQuotaCommand = () =>
  `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${SCRIPT_PATH}" -CacheClaudeQuota`;

function normalizeCommand(value) {
  return String(value || '').replace(/\//g, '\\').toLowerCase();
}

function isManagedCommand(value) {
  const normalized = normalizeCommand(value);
  return MANAGED_FRAGMENTS.some(fragment => normalized.includes(fragment.toLowerCase()));
}

function configuredEnabled() {
  const current = vscode.workspace.getConfiguration('vsignal');
  const currentValue = current.inspect('enabled').globalValue;
  if (currentValue !== undefined) return currentValue;

  const legacyValue = vscode.workspace
    .getConfiguration('agentFinishPopup')
    .inspect('enabled').globalValue;
  if (legacyValue !== undefined) {
    void current.update('enabled', legacyValue, vscode.ConfigurationTarget.Global);
    return legacyValue;
  }

  return !fs.existsSync(path.join(LEGACY_SCRIPT_DIR, 'disabled'));
}

function writePopupPreferences() {
  const config = vscode.workspace.getConfiguration('vsignal');
  const wanted = {};
  for (const preference of POPUP_PREFERENCES) {
    wanted[preference.field] = config.get(preference.key, true);
  }

  const serialized = `${JSON.stringify(wanted, null, 2)}
`;
  const current = fs.existsSync(PREFS_PATH) ? fs.readFileSync(PREFS_PATH, 'utf8') : '';
  if (current === serialized) return;

  fs.mkdirSync(SCRIPT_DIR, { recursive: true });
  writeAtomic(PREFS_PATH, serialized);
}

function isEnabled() {
  return !fs.existsSync(DISABLED_PATH);
}

function applyEnabledState(enabled) {
  fs.mkdirSync(SCRIPT_DIR, { recursive: true });
  if (enabled) {
    if (fs.existsSync(DISABLED_PATH)) fs.unlinkSync(DISABLED_PATH);
  } else {
    fs.writeFileSync(DISABLED_PATH, 'Popups désactivées depuis VS Code.\n', 'utf8');
  }
  if (controlPanelProvider) controlPanelProvider.refresh();
}

async function toggleEnabled() {
  const enabled = !isEnabled();
  await vscode.workspace
    .getConfiguration('vsignal')
    .update('enabled', enabled, vscode.ConfigurationTarget.Global);
  applyEnabledState(enabled);
  vscode.window.showInformationMessage(`VSignal : notifications ${enabled ? 'activées' : 'désactivées'}.`);
}

function writeAtomic(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.vsignal.tmp`;
  fs.writeFileSync(temporary, content, 'utf8');
  try {
    fs.renameSync(temporary, filePath);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
    fs.copyFileSync(temporary, filePath);
    fs.unlinkSync(temporary);
  }
}

function backupOnce(filePath) {
  if (!fs.existsSync(filePath)) return;
  const backup = `${filePath}.before-vsignal.bak`;
  if (!fs.existsSync(backup)) fs.copyFileSync(filePath, backup);
}

function installPowerShellScript(context) {
  const legacyCache = path.join(LEGACY_SCRIPT_DIR, 'claude-quota.json');
  const currentCache = path.join(SCRIPT_DIR, 'claude-quota.json');
  fs.mkdirSync(SCRIPT_DIR, { recursive: true });
  if (fs.existsSync(legacyCache) && !fs.existsSync(currentCache)) {
    fs.copyFileSync(legacyCache, currentCache);
  }

  const source = path.join(context.extensionPath, 'resources', 'agent-done.ps1');
  const bundled = fs.readFileSync(source, 'utf8');
  const current = fs.existsSync(SCRIPT_PATH) ? fs.readFileSync(SCRIPT_PATH, 'utf8') : '';
  if (current === bundled) return false;
  writeAtomic(SCRIPT_PATH, bundled);
  return true;
}

function ensureHookGroup(groups, matcher, command, predicate) {
  let changed = false;
  let found = false;

  for (const group of groups) {
    if (matcher !== undefined && group.matcher !== matcher) continue;
    if (!Array.isArray(group.hooks)) continue;

    for (const hook of group.hooks) {
      if (hook && hook.type === 'command' && predicate(hook.command)) {
        found = true;
        if (hook.command !== command) {
          hook.command = command;
          changed = true;
        }
      }
    }
  }

  if (!found) {
    const group = { hooks: [{ type: 'command', command }] };
    if (matcher !== undefined) group.matcher = matcher;
    groups.push(group);
    changed = true;
  }

  return changed;
}

function configureClaude() {
  let settings = {};
  if (fs.existsSync(CLAUDE_SETTINGS)) {
    const raw = fs.readFileSync(CLAUDE_SETTINGS, 'utf8').replace(/^\uFEFF/, '');
    settings = raw.trim() ? JSON.parse(raw) : {};
  }

  if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
    settings.hooks = {};
  }
  if (!Array.isArray(settings.hooks.Stop)) settings.hooks.Stop = [];
  if (!Array.isArray(settings.hooks.PreToolUse)) settings.hooks.PreToolUse = [];

  let changed = false;
  changed = ensureHookGroup(
    settings.hooks.Stop,
    undefined,
    claudeStopCommand(),
    command => isManagedCommand(command) && /-agent\s+claude\b/i.test(command)
  ) || changed;
  changed = ensureHookGroup(
    settings.hooks.PreToolUse,
    'AskUserQuestion',
    claudeQuestionCommand(),
    command => isManagedCommand(command) && /-state\s+question\b/i.test(command)
  ) || changed;

  if (!settings.statusLine) {
    settings.statusLine = { type: 'command', command: claudeQuotaCommand() };
    changed = true;
  } else if (settings.statusLine.type === 'command' && isManagedCommand(settings.statusLine.command)) {
    const wanted = claudeQuotaCommand();
    if (settings.statusLine.command !== wanted) {
      settings.statusLine.command = wanted;
      changed = true;
    }
  }

  if (changed) {
    backupOnce(CLAUDE_SETTINGS);
    writeAtomic(CLAUDE_SETTINGS, `${JSON.stringify(settings, null, 2)}\n`);
  }
  return changed;
}

function codexNotifyLine() {
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const args = [
    powershell,
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    SCRIPT_PATH,
    '-Agent',
    'Codex'
  ].map(value => JSON.stringify(value.replace(/\\/g, '/')));
  return `notify = [${args.join(', ')}]`;
}

function configureCodex() {
  let content = fs.existsSync(CODEX_CONFIG) ? fs.readFileSync(CODEX_CONFIG, 'utf8') : '';
  const wanted = codexNotifyLine();
  const notifyPattern = /^\s*notify\s*=\s*\[[^\r\n]*\]\s*$/m;
  const match = content.match(notifyPattern);

  if (match && !isManagedCommand(match[0])) {
    return { changed: false, conflict: true };
  }
  if (match && match[0].trim() === wanted) {
    return { changed: false, conflict: false };
  }

  if (match) {
    content = content.replace(notifyPattern, wanted);
  } else {
    content = content ? `${wanted}${os.EOL}${content}` : `${wanted}${os.EOL}`;
  }

  backupOnce(CODEX_CONFIG);
  writeAtomic(CODEX_CONFIG, content);
  return { changed: true, conflict: false };
}

async function setup(context, interactive = false) {
  if (process.platform !== 'win32') {
    if (interactive) vscode.window.showErrorMessage('VSignal fonctionne uniquement sous Windows.');
    return;
  }

  try {
    const scriptChanged = installPowerShellScript(context);
    writePopupPreferences();
    const claudeChanged = configureClaude();
    const codex = configureCodex();
    if (controlPanelProvider) controlPanelProvider.refresh();

    if (codex.conflict) {
      vscode.window.showWarningMessage(
        'VSignal : un autre notify Codex existe déjà. Il a été conservé pour ne pas écraser ta configuration.'
      );
    } else if (interactive || scriptChanged || claudeChanged || codex.changed) {
      vscode.window.showInformationMessage('VSignal est prêt pour Claude et Codex.');
    }
  } catch (error) {
    vscode.window.showErrorMessage(`VSignal : configuration impossible — ${error.message}`);
  }
}

function showTest(agent) {
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      SCRIPT_PATH,
      '-Agent',
      agent,
      '-State',
      'Done'
    ],
    { detached: true, windowsHide: true, stdio: 'ignore' }
  );
  child.unref();
}

async function runTest(context, agent) {
  if (!isEnabled()) {
    const choice = await vscode.window.showWarningMessage(
      'VSignal est désactivé.',
      'Activer et tester'
    );
    if (choice !== 'Activer et tester') return;
    await vscode.workspace
      .getConfiguration('vsignal')
      .update('enabled', true, vscode.ConfigurationTarget.Global);
    applyEnabledState(true);
  }
  await setup(context, false);
  showTest(agent);
}

function readQuota(agent) {
  return new Promise(resolve => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        SCRIPT_PATH,
        '-Agent',
        agent,
        '-PrintQuota'
      ],
      { windowsHide: true, timeout: 9000, encoding: 'utf8' },
      (error, stdout) => resolve(error ? '' : String(stdout || '').trim())
    );
  });
}

function parseQuota(text) {
  const values = [];
  const pattern = /(\d+\s*(?:min|h|j))\s+(\d+)\s*%(?:\s+reset\s+([^|]+))?/g;
  for (const match of String(text || '').matchAll(pattern)) {
    values.push({
      window: match[1],
      percent: Math.max(0, Math.min(100, Number(match[2]))),
      reset: String(match[3] || '').trim()
    });
  }
  return values;
}

// Le JSON echappe les antislashs des chemins Windows : chercher le fragment
// dans le texte brut du fichier ne marche jamais. Il faut comparer les
// commandes une fois decodees.
function hasClaudeHook() {
  if (!fs.existsSync(CLAUDE_SETTINGS)) return false;

  try {
    const raw = fs.readFileSync(CLAUDE_SETTINGS, 'utf8').replace(/^\uFEFF/, '');
    const settings = raw.trim() ? JSON.parse(raw) : {};
    if (!settings.hooks || typeof settings.hooks !== 'object') return false;

    return Object.values(settings.hooks).some(groups =>
      Array.isArray(groups) &&
      groups.some(group =>
        group &&
        Array.isArray(group.hooks) &&
        group.hooks.some(hook => hook && isManagedCommand(hook.command))));
  } catch {
    return false;
  }
}

// Seule la ligne notify active compte : un chemin VSignal cite ailleurs dans
// le fichier ne doit pas faire croire que le hook est en place.
function hasCodexHook() {
  if (!fs.existsSync(CODEX_CONFIG)) return false;

  const match = fs.readFileSync(CODEX_CONFIG, 'utf8').match(/^\s*notify\s*=\s*\[[^\r\n]*\]\s*$/m);
  return Boolean(match && isManagedCommand(match[0]));
}

function removeManagedHooks() {
  let changed = false;

  if (fs.existsSync(CLAUDE_SETTINGS)) {
    const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8').replace(/^\uFEFF/, ''));
    if (settings.hooks && typeof settings.hooks === 'object') {
      for (const event of ['Stop', 'PreToolUse']) {
        if (!Array.isArray(settings.hooks[event])) continue;
        const groups = [];
        for (const group of settings.hooks[event]) {
          if (!Array.isArray(group.hooks)) {
            groups.push(group);
            continue;
          }
          const hooks = group.hooks.filter(hook => !isManagedCommand(hook && hook.command));
          if (hooks.length) groups.push({ ...group, hooks });
        }
        settings.hooks[event] = groups;
      }
    }
    if (settings.statusLine && isManagedCommand(settings.statusLine.command)) delete settings.statusLine;
    writeAtomic(CLAUDE_SETTINGS, `${JSON.stringify(settings, null, 2)}\n`);
    changed = true;
  }

  if (fs.existsSync(CODEX_CONFIG)) {
    const content = fs.readFileSync(CODEX_CONFIG, 'utf8');
    const lines = content.split(/\r?\n/);
    const filtered = lines.filter(line => !( /^\s*notify\s*=/.test(line) && isManagedCommand(line) ));
    if (filtered.length !== lines.length) {
      writeAtomic(CODEX_CONFIG, filtered.join(os.EOL));
      changed = true;
    }
  }

  vscode.window.showInformationMessage(changed ? 'Hooks VSignal retirés.' : 'Aucun hook VSignal à retirer.');
  if (controlPanelProvider) controlPanelProvider.refresh();
}

function createNonce() {
  let value = '';
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let index = 0; index < 32; index++) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}

const PANEL_STYLE = `
:root {
  --vsignal-claude: #d97757;
  --vsignal-codex: #10a37f;
  --vsignal-ok: #3fb950;
  --vsignal-warn: #d29922;
  --vsignal-alert: #f85149;
  --vsignal-radius: 10px;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 14px 14px 20px;
  font-family: var(--vscode-font-family);
  font-size: 13px;
  line-height: 1.45;
  color: var(--vscode-foreground);
  background: transparent;
}

.masthead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 14px;
}

.wordmark {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.2px;
}

.wordmark svg { width: 17px; height: 17px; flex: none; }

.pill {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid transparent;
  white-space: nowrap;
}

.pill.on {
  color: var(--vsignal-ok);
  border-color: rgba(63, 185, 80, 0.42);
  background: rgba(63, 185, 80, 0.14);
  border-color: color-mix(in srgb, var(--vsignal-ok) 42%, transparent);
  background: color-mix(in srgb, var(--vsignal-ok) 14%, transparent);
}

.pill.off {
  color: var(--vscode-descriptionForeground);
  border-color: var(--vscode-widget-border, rgba(128, 128, 128, 0.35));
}

.card {
  border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.25));
  border-radius: var(--vsignal-radius);
  background: var(--vscode-editorWidget-background, rgba(128, 128, 128, 0.06));
  padding: 12px 13px;
  margin-bottom: 12px;
}

.card.flush { padding: 11px 13px; }

.section {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: var(--vscode-descriptionForeground);
  margin: 18px 2px 8px;
}

.section:first-of-type { margin-top: 4px; }

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 26px;
}

.row + .row { margin-top: 2px; }

.row .name { display: flex; align-items: center; gap: 8px; min-width: 0; }

.row .name span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
  background: var(--vscode-descriptionForeground);
}

.dot.ok { background: var(--vsignal-ok); }
.dot.todo { background: var(--vsignal-warn); }
.dot.claude { background: var(--vsignal-claude); }
.dot.codex { background: var(--vsignal-codex); }

.muted { color: var(--vscode-descriptionForeground); font-size: 11.5px; }

.linky {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-size: 11.5px;
  color: var(--vscode-textLink-foreground);
  cursor: pointer;
}

.linky:hover { text-decoration: underline; }

.toggle {
  position: relative;
  width: 32px;
  height: 18px;
  flex: none;
  border-radius: 999px;
  border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.4));
  background: var(--vscode-input-background, rgba(128, 128, 128, 0.2));
  cursor: pointer;
  padding: 0;
  transition: background 140ms ease, border-color 140ms ease;
}

.toggle::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--vscode-descriptionForeground);
  transition: transform 140ms ease, background 140ms ease;
}

.toggle[aria-checked='true'] {
  background: var(--vscode-button-background);
  border-color: var(--vscode-button-background);
}

.toggle[aria-checked='true']::after {
  transform: translateX(14px);
  background: var(--vscode-button-foreground);
}

.toggle:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }

.master { display: flex; align-items: center; justify-content: space-between; gap: 12px; }

.master .title { font-weight: 600; }

.quota-agent + .quota-agent { margin-top: 14px; }

.quota-head {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11.5px;
  font-weight: 600;
  margin-bottom: 8px;
}

.quota-line + .quota-line { margin-top: 9px; }

.quota-meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  margin-bottom: 4px;
}

.quota-meta .value { font-variant-numeric: tabular-nums; font-weight: 600; }

.track {
  height: 6px;
  border-radius: 3px;
  background: rgba(128, 128, 128, 0.28);
  background: color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
  overflow: hidden;
}

.fill {
  height: 100%;
  border-radius: 3px;
  width: 0;
  transition: width 420ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

.skeleton {
  height: 6px;
  border-radius: 3px;
  background: rgba(128, 128, 128, 0.28);
  background: color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
  animation: pulse 1.3s ease-in-out infinite;
}

@keyframes pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 0.75; } }

.actions { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-top: 4px; }

button.action {
  font-family: inherit;
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid var(--vscode-button-border, transparent);
  background: var(--vscode-button-secondaryBackground, rgba(128, 128, 128, 0.16));
  color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
}

button.action:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128, 128, 128, 0.26)); }

button.action.primary {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

button.action.primary:hover { background: var(--vscode-button-hoverBackground); }

button.action.wide { grid-column: 1 / -1; }

button.action.quiet {
  grid-column: 1 / -1;
  background: none;
  border-color: transparent;
  color: var(--vscode-descriptionForeground);
}

button.action.quiet:hover { color: var(--vscode-foreground); background: rgba(128, 128, 128, 0.12); }

.paused { opacity: 0.5; }
`;

const PANEL_SCRIPT = `
const vscode = acquireVsCodeApi();

function send(message) { vscode.postMessage(message); }

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function toggle(checked, onChange) {
  const button = el('button', 'toggle');
  button.type = 'button';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-checked', String(checked));
  button.addEventListener('click', () => onChange(button.getAttribute('aria-checked') !== 'true'));
  return button;
}

function barColor(percent, agent) {
  if (percent < 20) return 'var(--vsignal-alert)';
  if (percent <= 40) return 'var(--vsignal-warn)';
  return agent === 'Codex' ? 'var(--vsignal-codex)' : 'var(--vsignal-claude)';
}

function renderStatus(state) {
  const pill = document.getElementById('status-pill');
  pill.textContent = state.enabled ? 'Actif' : 'En pause';
  pill.className = 'pill ' + (state.enabled ? 'on' : 'off');

  const master = document.getElementById('master');
  master.innerHTML = '';
  const label = el('div');
  label.appendChild(el('div', 'title', 'Popups'));
  label.appendChild(el('div', 'muted', state.enabled ? 'Claude et Codex te préviennent' : 'Aucune popup ne sera affichée'));
  master.appendChild(label);
  master.appendChild(toggle(state.enabled, () => send({ type: 'command', command: 'vsignal.toggle' })));

  const hooks = document.getElementById('hooks');
  hooks.innerHTML = '';
  for (const item of [
    { name: 'Claude', ready: state.claudeReady },
    { name: 'Codex', ready: state.codexReady }
  ]) {
    const row = el('div', 'row');
    const name = el('div', 'name');
    name.appendChild(el('span', 'dot ' + (item.ready ? 'ok' : 'todo')));
    name.appendChild(el('span', null, item.name));
    row.appendChild(name);
    if (item.ready) {
      row.appendChild(el('span', 'muted', 'Prêt'));
    } else {
      const fix = el('button', 'linky', 'Configurer');
      fix.type = 'button';
      fix.addEventListener('click', () => send({ type: 'command', command: 'vsignal.setup' }));
      row.appendChild(fix);
    }
    hooks.appendChild(row);
  }

  const prefs = document.getElementById('prefs');
  prefs.innerHTML = '';
  for (const pref of state.prefs) {
    const row = el('div', 'row');
    const name = el('div', 'name');
    name.appendChild(el('span', 'dot ' + pref.agent.toLowerCase()));
    name.appendChild(el('span', null, pref.label));
    row.appendChild(name);
    row.appendChild(toggle(pref.value, value => send({ type: 'pref', key: pref.key, value })));
    prefs.appendChild(row);
  }

  document.getElementById('master-card').classList.toggle('paused', !state.enabled);
}

function renderQuotas(payload) {
  const host = document.getElementById('quotas');
  host.innerHTML = '';

  if (payload.loading) {
    for (let index = 0; index < 2; index++) {
      const block = el('div', 'quota-agent');
      block.appendChild(el('div', 'muted', 'Lecture des quotas…'));
      const skeleton = el('div', 'skeleton');
      skeleton.style.marginTop = '8px';
      block.appendChild(skeleton);
      host.appendChild(block);
    }
    return;
  }

  for (const entry of payload.agents) {
    const block = el('div', 'quota-agent');
    const head = el('div', 'quota-head');
    head.appendChild(el('span', 'dot ' + entry.agent.toLowerCase()));
    head.appendChild(el('span', null, entry.agent));
    block.appendChild(head);

    if (!entry.values.length) {
      block.appendChild(el('div', 'muted', entry.agent === 'Claude'
        ? 'En attente d’une première réponse de Claude'
        : 'Compte Codex non détecté'));
      host.appendChild(block);
      continue;
    }

    for (const value of entry.values) {
      const line = el('div', 'quota-line');
      const meta = el('div', 'quota-meta');
      const left = el('span', 'muted', value.window + (value.reset ? '  ·  reset dans ' + value.reset : ''));
      const right = el('span', 'value', value.percent + ' %');
      meta.appendChild(left);
      meta.appendChild(right);
      line.appendChild(meta);

      const track = el('div', 'track');
      const fill = el('div', 'fill');
      fill.style.background = barColor(value.percent, entry.agent);
      track.appendChild(fill);
      line.appendChild(track);
      block.appendChild(line);
      requestAnimationFrame(() => { fill.style.width = value.percent + '%'; });
    }

    host.appendChild(block);
  }
}

window.addEventListener('message', event => {
  const message = event.data;
  if (message.type === 'state') renderStatus(message);
  if (message.type === 'quotas') renderQuotas(message);
});

for (const button of document.querySelectorAll('[data-command]')) {
  button.addEventListener('click', () => send({ type: 'command', command: button.dataset.command }));
}
`;

class ControlPanelProvider {
  constructor(context) {
    this.context = context;
    this.view = undefined;
    this.quotaToken = 0;
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.context.extensionUri] };
    view.webview.html = this.render(view.webview);
    view.webview.onDidReceiveMessage(message => this.receive(message));
    view.onDidChangeVisibility(() => {
      if (view.visible) this.refresh();
    });
    view.onDidDispose(() => {
      this.view = undefined;
    });
    this.refresh();
  }

  receive(message) {
    if (!message || typeof message !== 'object') return;

    if (message.type === 'command') {
      const allowed = new Set([
        'vsignal.toggle',
        'vsignal.setup',
        'vsignal.testClaude',
        'vsignal.testCodex',
        'vsignal.refreshQuotas',
        'vsignal.removeHooks'
      ]);
      if (allowed.has(message.command)) void vscode.commands.executeCommand(message.command);
      return;
    }

    if (message.type === 'pref' && POPUP_PREFERENCES.some(pref => pref.key === message.key)) {
      void vscode.workspace
        .getConfiguration('vsignal')
        .update(message.key, Boolean(message.value), vscode.ConfigurationTarget.Global);
    }
  }

  post(payload) {
    if (this.view) void this.view.webview.postMessage(payload);
  }

  refresh() {
    if (!this.view) return;

    const config = vscode.workspace.getConfiguration('vsignal');
    this.post({
      type: 'state',
      enabled: isEnabled(),
      claudeReady: hasClaudeHook(),
      codexReady: hasCodexHook(),
      prefs: POPUP_PREFERENCES.map(pref => ({
        key: pref.key,
        label: pref.label,
        agent: pref.agent,
        value: config.get(pref.key, true)
      }))
    });

    void this.loadQuotas();
  }

  async loadQuotas() {
    const token = ++this.quotaToken;
    this.post({ type: 'quotas', loading: true });

    // Le panneau montre toujours les quatre fenetres, meme celles masquees dans les popups.
    const [claude, codex] = await Promise.all([readQuota('Claude'), readQuota('Codex')]);
    if (token !== this.quotaToken) return;

    this.post({
      type: 'quotas',
      loading: false,
      agents: [
        { agent: 'Claude', values: parseQuota(claude) },
        { agent: 'Codex', values: parseQuota(codex) }
      ]
    });
  }

  render(webview) {
    const nonce = createNonce();
    return [
      '<!DOCTYPE html>',
      '<html lang="fr"><head><meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">`,
      `<style>${PANEL_STYLE}</style></head><body>`,
      '<div class="masthead">',
      '<div class="wordmark">',
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M4 4.5 12 21 20 4.5"/><circle fill="currentColor" cx="12" cy="10" r="1.6"/><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M8.7 7.7a4.7 4.7 0 0 1 6.6 0M6.2 5.3a8.2 8.2 0 0 1 11.6 0"/></svg>',
      'VSignal</div>',
      '<span id="status-pill" class="pill off">…</span>',
      '</div>',
      '<div class="card" id="master-card"><div class="master" id="master"></div></div>',
      '<div class="section">Intégrations</div>',
      '<div class="card flush" id="hooks"></div>',
      '<div class="section">Quotas restants</div>',
      '<div class="card" id="quotas"></div>',
      '<div class="section">Quotas affichés dans les popups</div>',
      '<div class="card flush" id="prefs"></div>',
      '<div class="section">Actions</div>',
      '<div class="actions">',
      '<button class="action primary" data-command="vsignal.testClaude" type="button">Tester Claude</button>',
      '<button class="action primary" data-command="vsignal.testCodex" type="button">Tester Codex</button>',
      '<button class="action wide" data-command="vsignal.refreshQuotas" type="button">Actualiser les quotas</button>',
      '<button class="action wide" data-command="vsignal.setup" type="button">Configurer / réparer les hooks</button>',
      '<button class="action quiet" data-command="vsignal.removeHooks" type="button">Retirer les hooks</button>',
      '</div>',
      `<script nonce="${nonce}">${PANEL_SCRIPT}</script>`,
      '</body></html>'
    ].join('\n');
  }
}

function activate(context) {
  applyEnabledState(configuredEnabled());
  writePopupPreferences();
  controlPanelProvider = new ControlPanelProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('vsignal.controlPanel', controlPanelProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand('vsignal.toggle', toggleEnabled),
    vscode.commands.registerCommand('vsignal.refreshQuotas', () => controlPanelProvider.refresh()),
    vscode.commands.registerCommand('vsignal.setup', () => setup(context, true)),
    vscode.commands.registerCommand('vsignal.testClaude', () => runTest(context, 'Claude')),
    vscode.commands.registerCommand('vsignal.testCodex', () => runTest(context, 'Codex')),
    vscode.commands.registerCommand('vsignal.showStatus', () => {
      vscode.window.showInformationMessage(
        `VSignal — notifications: ${isEnabled() ? 'activées' : 'désactivées'}, script: ${fs.existsSync(SCRIPT_PATH) ? 'OK' : 'absent'}, Claude: ${hasClaudeHook() ? 'OK' : 'absent'}, Codex: ${hasCodexHook() ? 'OK' : 'absent'}`
      );
    }),
    vscode.commands.registerCommand('vsignal.removeHooks', removeManagedHooks),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('vsignal.enabled')) {
        applyEnabledState(vscode.workspace.getConfiguration('vsignal').get('enabled', true));
      }
      if (event.affectsConfiguration('vsignal.popup')) {
        writePopupPreferences();
        if (controlPanelProvider) controlPanelProvider.refresh();
      }
    })
  );

  if (vscode.workspace.getConfiguration('vsignal').get('autoConfigure', true)) {
    void setup(context, false);
  }
}

function deactivate() {
  controlPanelProvider = undefined;
}

module.exports = { activate, deactivate };
