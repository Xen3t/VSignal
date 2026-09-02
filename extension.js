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
const CLAUDE_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const CODEX_CONFIG = path.join(os.homedir(), '.codex', 'config.toml');
const MANAGED_FRAGMENTS = [
  '.vsignal\\agent-done.ps1',
  '.agent-notifications\\agent-done.ps1'
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

function hasClaudeHook() {
  if (!fs.existsSync(CLAUDE_SETTINGS)) return false;
  return isManagedCommand(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'));
}

function hasCodexHook() {
  if (!fs.existsSync(CODEX_CONFIG)) return false;
  return isManagedCommand(fs.readFileSync(CODEX_CONFIG, 'utf8'));
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

class ControlPanelProvider {
  constructor() {
    this.changeEmitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.changeEmitter.event;
  }

  refresh() {
    this.changeEmitter.fire();
  }

  getTreeItem(item) {
    return item;
  }

  getChildren(element) {
    if (element && element.kind === 'quota') return this.getQuotaChildren(element.agent);

    const claudeReady = hasClaudeHook();
    const codexReady = hasCodexHook();

    return [
      this.statusItem(`Notifications : ${isEnabled() ? 'activées' : 'désactivées'}`, isEnabled()),
      this.actionItem(
        isEnabled() ? 'Désactiver les popups' : 'Activer les popups',
        'vsignal.toggle',
        isEnabled() ? 'mute' : 'unmute'
      ),
      this.statusItem(`Claude : ${claudeReady ? 'prêt' : 'à configurer'}`, claudeReady),
      this.statusItem(`Codex : ${codexReady ? 'prêt' : 'à configurer'}`, codexReady),
      this.quotaRoot('Codex'),
      this.quotaRoot('Claude'),
      this.actionItem('Actualiser les quotas', 'vsignal.refreshQuotas', 'refresh'),
      this.actionItem('Tester Claude', 'vsignal.testClaude', 'bell'),
      this.actionItem('Tester Codex', 'vsignal.testCodex', 'bell'),
      this.actionItem('Configurer / réparer', 'vsignal.setup', 'tools'),
      this.actionItem("Afficher l’état", 'vsignal.showStatus', 'info')
    ];
  }

  quotaRoot(agent) {
    const item = new vscode.TreeItem(`Quota ${agent}`, vscode.TreeItemCollapsibleState.Expanded);
    item.kind = 'quota';
    item.agent = agent;
    item.iconPath = new vscode.ThemeIcon(agent === 'Codex' ? 'hubot' : 'sparkle');
    return item;
  }

  async getQuotaChildren(agent) {
    const values = parseQuota(await readQuota(agent));
    if (!values.length) {
      const unavailable = new vscode.TreeItem('Quota indisponible', vscode.TreeItemCollapsibleState.None);
      unavailable.description = agent === 'Claude' ? 'attends une réponse Claude' : 'compte non détecté';
      unavailable.iconPath = new vscode.ThemeIcon('warning');
      return [unavailable];
    }

    return values.map(value => {
      const filled = Math.round(value.percent / 10);
      const bar = `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;
      const item = new vscode.TreeItem(
        `${value.window}  ${bar}  ${value.percent} %`,
        vscode.TreeItemCollapsibleState.None
      );
      item.description = value.reset ? `reset dans ${value.reset}` : '';
      item.tooltip = `${agent} — ${value.window} : ${value.percent} % restants${value.reset ? `, reset dans ${value.reset}` : ''}`;
      const color = value.percent < 20
        ? 'charts.red'
        : value.percent <= 40
          ? 'charts.orange'
          : agent === 'Claude' ? 'charts.orange' : 'charts.green';
      item.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor(color));
      return item;
    });
  }

  statusItem(label, ready) {
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon(ready ? 'pass-filled' : 'warning');
    item.tooltip = ready ? 'Hook global correctement installé' : 'Clique sur Configurer / réparer';
    return item;
  }

  actionItem(label, command, icon) {
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.command = { command, title: label };
    item.iconPath = new vscode.ThemeIcon(icon);
    return item;
  }

  dispose() {
    this.changeEmitter.dispose();
  }
}

function activate(context) {
  applyEnabledState(configuredEnabled());
  controlPanelProvider = new ControlPanelProvider();
  context.subscriptions.push(
    controlPanelProvider,
    vscode.window.registerTreeDataProvider('vsignal.controlPanel', controlPanelProvider),
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
