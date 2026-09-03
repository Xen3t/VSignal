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
// Chemin absolu : l'hote d'extensions n'a pas toujours System32 dans son PATH,
// et un spawn qui echoue sur 'powershell.exe' ne remonte nulle part.
const POWERSHELL = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe'
);
const CLAUDE_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const CODEX_CONFIG = path.join(os.homedir(), '.codex', 'config.toml');
const MANAGED_FRAGMENTS = [
  '.vsignal\\agent-done.ps1',
  '.agent-notifications\\agent-done.ps1'
];
// ---------------------------------------------------------------------------
// Traductions. Les textes de popup partent aussi dans popup.json : le script
// PowerShell reste ainsi en ASCII pur et n'a pas sa propre copie a maintenir.
// ---------------------------------------------------------------------------
const LANGUAGES = ['fr', 'en'];
const LANGUAGE_CHOICES = ['auto', ...LANGUAGES];

const STRINGS = {
  fr: {
    // Popup
    titleDone: '{0} a terminé',
    titleQuestion: '{0} attend ta réponse',
    titleBlocked: '{0} a besoin de toi',
    titleQuota: '{0} : quota bas',
    titleReset: '{0} : quota réinitialisé',
    detailDone: 'La réponse est prête',
    detailCode: 'Le code a été modifié',
    detailTested: 'Tests validés',
    detailQuestion: 'Une question t’attend dans VS Code',
    detailBlocked: 'Tâche en pause',
    detailQuota: 'La limite approche',
    detailReset: 'La fenêtre est repartie à zéro',
    alertLow: 'Il reste {0} % sur la fenêtre {1}',
    alertReset: 'La fenêtre {0} est repartie à zéro',
    resetIn: 'reset dans {0}',
    unitMin: 'min',
    unitHour: 'h',
    unitDay: 'j',
    // Panneau
    statusOn: 'Actif',
    statusOff: 'En pause',
    sectionSettings: 'Paramètres',
    sectionActions: 'Actions',
    groupGeneral: 'Général',
    languageLabel: 'Langue',
    languageAuto: 'Automatique (langue de VS Code)',
    languageFrench: 'Français',
    languageEnglish: 'English',
    groupPopupQuotas: 'Quotas affichés dans les popups',
    taskPercentageLabel: 'Coût de la tâche',
    groupAlerts: 'Alertes',
    notifications: 'Notifications',
    lowQuotaLabel: 'Quota bas',
    resetLabel: 'Remise à zéro',
    testClaude: 'Tester Claude',
    testCodex: 'Tester Codex',
    repairHooks: 'Configurer / réparer les hooks',
    removeHooks: 'Retirer les hooks',
    refreshQuotas: 'Actualiser les quotas',
    loadingQuotas: 'Lecture des quotas…',
    waitingClaude: 'En attente d’une première réponse de Claude',
    noCodex: 'Compte Codex non détecté',
    freshNow: 'Actualisé à l’instant',
    freshMinutes: 'Actualisé il y a {0} min',
    freshHours: 'Actualisé il y a {0} h',
    // Messages
    windowsOnly: 'VSignal fonctionne uniquement sous Windows.',
    ready: 'VSignal est prêt pour Claude et Codex.',
    codexConflict: 'VSignal : un autre notify Codex existe déjà. Il a été conservé pour ne pas écraser ta configuration.',
    setupFailed: 'VSignal : configuration impossible — {0}',
    disabledWarning: 'VSignal est désactivé.',
    enableAndTest: 'Activer et tester',
    testFailed: 'VSignal : le test {0} a échoué — {1}',
    testSent: 'VSignal : test {0} envoyé',
    hooksRemoved: 'Hooks VSignal retirés.',
    noHooks: 'Aucun hook VSignal à retirer.',
    toggledOn: 'VSignal : notifications activées.',
    toggledOff: 'VSignal : notifications désactivées.',
    statusSummary: 'VSignal — notifications : {0}, script : {1}, Claude : {2}, Codex : {3}',
    stateEnabled: 'activées',
    stateDisabled: 'désactivées',
    stateMissing: 'absent',
    exitCode: 'code de sortie {0}'
  },
  en: {
    // Popup
    titleDone: '{0} is done',
    titleQuestion: '{0} is waiting for you',
    titleBlocked: '{0} needs you',
    titleQuota: '{0}: quota running low',
    titleReset: '{0}: quota reset',
    detailDone: 'The answer is ready',
    detailCode: 'The code has been changed',
    detailTested: 'Tests passed',
    detailQuestion: 'A question is waiting in VS Code',
    detailBlocked: 'Task on hold',
    detailQuota: 'The limit is getting close',
    detailReset: 'The window is back to zero',
    alertLow: '{0} % left on the {1} window',
    alertReset: 'The {0} window is back to zero',
    resetIn: 'resets in {0}',
    unitMin: 'min',
    unitHour: 'h',
    unitDay: 'd',
    // Panel
    statusOn: 'Active',
    statusOff: 'Paused',
    sectionSettings: 'Settings',
    sectionActions: 'Actions',
    groupGeneral: 'General',
    languageLabel: 'Language',
    languageAuto: 'Automatic (VS Code language)',
    languageFrench: 'Français',
    languageEnglish: 'English',
    groupPopupQuotas: 'Quotas shown in popups',
    taskPercentageLabel: 'Task cost',
    groupAlerts: 'Alerts',
    notifications: 'Notifications',
    lowQuotaLabel: 'Low quota',
    resetLabel: 'Quota reset',
    testClaude: 'Test Claude',
    testCodex: 'Test Codex',
    repairHooks: 'Set up / repair hooks',
    removeHooks: 'Remove hooks',
    refreshQuotas: 'Refresh quotas',
    loadingQuotas: 'Reading quotas…',
    waitingClaude: 'Waiting for a first reply from Claude',
    noCodex: 'No Codex account detected',
    freshNow: 'Updated just now',
    freshMinutes: 'Updated {0} min ago',
    freshHours: 'Updated {0} h ago',
    // Messages
    windowsOnly: 'VSignal only runs on Windows.',
    ready: 'VSignal is ready for Claude and Codex.',
    codexConflict: 'VSignal: another Codex notify entry already exists. It was kept so your configuration is not overwritten.',
    setupFailed: 'VSignal: setup failed — {0}',
    disabledWarning: 'VSignal is disabled.',
    enableAndTest: 'Enable and test',
    testFailed: 'VSignal: the {0} test failed — {1}',
    testSent: 'VSignal: {0} test sent',
    hooksRemoved: 'VSignal hooks removed.',
    noHooks: 'No VSignal hook to remove.',
    toggledOn: 'VSignal: notifications enabled.',
    toggledOff: 'VSignal: notifications disabled.',
    statusSummary: 'VSignal — notifications: {0}, script: {1}, Claude: {2}, Codex: {3}',
    stateEnabled: 'enabled',
    stateDisabled: 'disabled',
    stateMissing: 'missing',
    exitCode: 'exit code {0}'
  }
};

// Les textes que le script PowerShell doit connaitre pour composer ses popups.
const POPUP_STRING_KEYS = [
  'titleDone', 'titleQuestion', 'titleBlocked', 'titleQuota', 'titleReset',
  'detailDone', 'detailCode', 'detailTested', 'detailQuestion', 'detailBlocked',
  'detailQuota', 'detailReset', 'resetIn', 'unitMin', 'unitHour', 'unitDay'
];

function currentLanguage() {
  const choice = vscode.workspace.getConfiguration('vsignal').get('language', 'auto');
  if (LANGUAGES.includes(choice)) return choice;

  // « auto » suit la langue de VS Code, et retombe sur l'anglais ailleurs.
  const environment = String(vscode.env.language || '').toLowerCase();
  return environment.startsWith('fr') ? 'fr' : 'en';
}

function t() {
  return STRINGS[currentLanguage()] || STRINGS.en;
}

function format(template, ...values) {
  return values.reduce(
    (text, value, index) => text.split('{' + index + '}').join(String(value)),
    String(template)
  );
}

// '5 h', '1 j 10 h' ou '30 min' sont transportes en unites francaises : elles
// sont traduites au moment de l'affichage, pour ne pas casser les expressions
// qui analysent ce format.
function localizeDuration(text, strings) {
  return String(text)
    .replace(/\bmin\b/g, strings.unitMin)
    .replace(/\bh\b/g, strings.unitHour)
    .replace(/\bj\b/g, strings.unitDay);
}

// Fenetres de quota affichables dans les popups. Le panneau, lui, montre tout.
// Le libelle de fenetre reste en unites francaises : c'est le format de
// transport, traduit seulement a l'affichage.
const POPUP_PREFERENCES = [
  { key: 'popup.claude.fiveHours', field: 'ClaudeShort', agent: 'Claude', window: '5 h' },
  { key: 'popup.claude.weekly', field: 'ClaudeWeekly', agent: 'Claude', window: '7 j' },
  { key: 'popup.codex.fiveHours', field: 'CodexShort', agent: 'Codex', window: '5 h' },
  { key: 'popup.codex.weekly', field: 'CodexWeekly', agent: 'Codex', window: '7 j' }
];

const TASK_PERCENT_PREFERENCES = [
  { key: 'popup.claude.taskPercentage', field: 'ClaudeTaskPercent', agent: 'Claude' },
  { key: 'popup.codex.taskPercentage', field: 'CodexTaskPercent', agent: 'Codex' }
];

const ALERT_PREFERENCES = [
  { key: 'alert.lowQuota.claude', agent: 'Claude', label: 'lowQuotaLabel' },
  { key: 'alert.reset.claude', agent: 'Claude', label: 'resetLabel' },
  { key: 'alert.lowQuota.codex', agent: 'Codex', label: 'lowQuotaLabel' },
  { key: 'alert.reset.codex', agent: 'Codex', label: 'resetLabel' }
];

const SETTING_KEYS = ['enabled']
  .concat(POPUP_PREFERENCES.map(item => item.key))
  .concat(TASK_PERCENT_PREFERENCES.map(item => item.key))
  .concat(ALERT_PREFERENCES.map(item => item.key));

// Tout ce que le panneau expose sous « Paramètres ».
function settingGroups(strings) {
  const forAgent = agent => ALERT_PREFERENCES
    .filter(item => item.agent === agent)
    .map(item => ({ key: item.key, agent, label: strings[item.label] }));

  return [
    // L'interrupteur general n'a pas a occuper le haut du panneau : on l'ouvre
    // rarement, et il n'apprend rien tant que tout va bien.
    {
      caption: strings.groupGeneral,
      items: [
        { key: 'enabled', label: strings.notifications },
        {
          key: 'language',
          kind: 'select',
          label: strings.languageLabel,
          options: [
            { value: 'auto', label: strings.languageAuto },
            { value: 'fr', label: strings.languageFrench },
            { value: 'en', label: strings.languageEnglish }
          ]
        }
      ]
    },
    {
      caption: strings.groupPopupQuotas,
      items: POPUP_PREFERENCES.map(item => ({
        key: item.key,
        agent: item.agent,
        label: item.agent + ' — ' + localizeDuration(item.window, strings)
      })).concat(TASK_PERCENT_PREFERENCES.map(item => ({
        key: item.key,
        agent: item.agent,
        label: item.agent + ' — ' + strings.taskPercentageLabel
      })))
    },
    // Regroupees par modele : le libelle reste court, donc lisible en colonne
    // etroite, la ou « Remise à zéro — Claude » se faisait tronquer.
    { caption: strings.groupAlerts + ' — Claude', items: forAgent('Claude') },
    { caption: strings.groupAlerts + ' — Codex', items: forAgent('Codex') }
  ];
}

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
  for (const preference of TASK_PERCENT_PREFERENCES) {
    wanted[preference.field] = config.get(preference.key, true);
  }

  // Le script PowerShell reste en ASCII pur : plutot que d'y dupliquer les
  // traductions, on lui livre les phrases dont il a besoin.
  const strings = t();
  wanted.Lang = currentLanguage();
  wanted.Strings = {};
  for (const key of POPUP_STRING_KEYS) wanted.Strings[key] = strings[key];

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
    fs.writeFileSync(DISABLED_PATH, 'Disabled by VSignal.\n', 'utf8');
  }
  if (controlPanelProvider) controlPanelProvider.refresh();
}

async function toggleEnabled() {
  const enabled = !isEnabled();
  await vscode.workspace
    .getConfiguration('vsignal')
    .update('enabled', enabled, vscode.ConfigurationTarget.Global);
  applyEnabledState(enabled);
  vscode.window.showInformationMessage(enabled ? t().toggledOn : t().toggledOff);
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
  const args = [
    POWERSHELL,
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
    if (interactive) vscode.window.showErrorMessage(t().windowsOnly);
    return;
  }

  try {
    const scriptChanged = installPowerShellScript(context);
    writePopupPreferences();
    const claudeChanged = configureClaude();
    const codex = configureCodex();
    if (controlPanelProvider) controlPanelProvider.refresh();

    if (codex.conflict) {
      vscode.window.showWarningMessage(t().codexConflict);
    } else if (interactive || scriptChanged || claudeChanged || codex.changed) {
      vscode.window.showInformationMessage(t().ready);
    }
  } catch (error) {
    vscode.window.showErrorMessage(format(t().setupFailed, error.message));
  }
}

// Le processus lance ici rend la main tout de suite : c'est lui qui demarre
// la fenetre WPF dans un processus separe. On garde donc stderr sous la main
// pour pouvoir dire pourquoi une popup n'est pas apparue.
function runPopup(args, onFailure) {
  let child;
  try {
    child = spawn(
      POWERSHELL,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT_PATH, ...args],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] }
    );
  } catch (error) {
    if (onFailure) onFailure(error.message);
    return;
  }

  let stderr = '';
  child.stderr.on('data', chunk => {
    stderr += chunk;
  });
  child.on('error', error => {
    if (onFailure) onFailure(error.message);
  });
  child.on('exit', code => {
    if (!onFailure || (code === 0 && !stderr.trim())) return;
    onFailure(stderr.trim().split(/\r?\n/)[0] || format(t().exitCode, code));
  });
}

function showTest(agent) {
  runPopup(['-Agent', agent, '-State', 'Done'], message => {
    vscode.window.showErrorMessage(format(t().testFailed, agent, message));
  });
  vscode.window.setStatusBarMessage(format(t().testSent, agent), 3000);
}

async function runTest(context, agent) {
  if (!isEnabled()) {
    const strings = t();
    const choice = await vscode.window.showWarningMessage(strings.disabledWarning, strings.enableAndTest);
    if (choice !== strings.enableAndTest) return;
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
      POWERSHELL,
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
      (error, stdout) => {
        if (error) {
          resolve({ text: '', sourceAt: 0 });
          return;
        }

        const text = String(stdout || '').trim();
        const marker = text.match(/^VSignal-Source-At:\s*(\d+)\s*$/m);
        resolve({
          text,
          // Codex vient d'une lecture directe. Pour Claude, le script fournit
          // l'heure de la donnee elle-meme, pas celle de cette relecture.
          sourceAt: marker ? Number(marker[1]) : Date.now()
        });
      }
    );
  });
}

function snapshotTaskQuota(agent) {
  if (!fs.existsSync(SCRIPT_PATH)) return;
  const child = spawn(
    POWERSHELL,
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      SCRIPT_PATH,
      '-Agent',
      agent,
      '-SnapshotQuota'
    ],
    { windowsHide: true, stdio: 'ignore' }
  );
  child.on('error', () => {});
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

const QUOTA_REFRESH_INTERVAL_MS = 60 * 1000;
const QUOTA_TRIGGER_THROTTLE_MS = 20 * 1000;
let quotaRefreshInFlight;
let quotaRefreshQueued = false;
let quotaTriggeredAt = 0;

async function performQuotaRefresh(context) {
  // Claude et Codex partent toujours ensemble. Le releve n'est publie qu'une
  // fois les deux reponses revenues, ce qui donne un instantane coherent.
  const [claude, codex] = await Promise.all([readQuota('Claude'), readQuota('Codex')]);
  const snapshot = {
    Claude: { values: parseQuota(claude.text), sourceAt: claude.sourceAt },
    Codex: { values: parseQuota(codex.text), sourceAt: codex.sourceAt }
  };

  if (controlPanelProvider) controlPanelProvider.applyQuotaSnapshot(snapshot);
  await checkQuotaEvents(context, snapshot);
  return snapshot;
}

// Tous les declencheurs partagent la meme lecture. Si Claude change pendant
// une lecture deja lancee, un unique second passage est mis en attente ; les
// clics, le minuteur et le panneau ne peuvent donc jamais empiler les process.
function refreshAllQuotas(context, rerunIfBusy = false) {
  if (quotaRefreshInFlight) {
    if (rerunIfBusy) quotaRefreshQueued = true;
    return quotaRefreshInFlight;
  }

  quotaRefreshInFlight = (async () => {
    do {
      quotaRefreshQueued = false;
      try {
        await performQuotaRefresh(context);
      } catch (error) {
        // Le minuteur doit survivre a toute erreur inattendue de stockage ou
        // de publication. Les erreurs normales de lecture sont deja converties
        // en resultat vide par readQuota et conservent les dernieres valeurs.
        console.error('VSignal quota refresh failed:', error);
        if (controlPanelProvider) controlPanelProvider.postQuotas(false);
      }
    } while (quotaRefreshQueued);
  })().finally(() => {
    quotaRefreshInFlight = undefined;
  });

  return quotaRefreshInFlight;
}

function refreshAllQuotasThrottled(context) {
  const now = Date.now();
  if (now - quotaTriggeredAt < QUOTA_TRIGGER_THROTTLE_MS) return;
  quotaTriggeredAt = now;
  void refreshAllQuotas(context, true);
}

// Le JSON echappe les antislashs des chemins Windows : chercher le fragment
// dans le texte brut du fichier ne marche jamais. Il faut comparer les
// commandes une fois decodees.
function showQuotaAlert(agent, value) {
  const strings = t();
  const remaining = Math.max(0, 100 - value.percent);
  const window = localizeDuration(value.window, strings);
  runPopup(['-Agent', agent, '-State', 'Quota', '-Detail', format(strings.alertLow, remaining, window)]);
}

function showResetAlert(agent, value) {
  const strings = t();
  const window = localizeDuration(value.window, strings);
  runPopup(['-Agent', agent, '-State', 'Reset', '-Detail', format(strings.alertReset, window)]);
}

// Un pourcentage consomme ne peut que monter a l'interieur d'une fenetre :
// une baisse nette signe donc une remise a zero. La marge evite de reagir a
// un simple arrondi.
const RESET_MARGIN = 5;

// Les deux evenements se declenchent sur transition, jamais en continu. Le
// dernier releve est conserve d'une session a l'autre pour que redemarrer VS
// Code ne provoque pas une volee de notifications.
async function checkQuotaEvents(context, snapshot) {
  if (!isEnabled()) return;

  const config = vscode.workspace.getConfiguration('vsignal');
  const threshold = Math.min(100, Math.max(50, Number(config.get('alert.threshold', 90))));

  for (const agent of ['Claude', 'Codex']) {
    const suffix = agent.toLowerCase();
    const wantsLow = config.get(`alert.lowQuota.${suffix}`, true);
    const wantsReset = config.get(`alert.reset.${suffix}`, true);

    const values = snapshot[agent].values;
    if (!values.length) continue;

    const key = `quotaSeen.${agent}`;
    const seen = { ...(context.globalState.get(key) || {}) };
    const next = {};

    for (const value of values) {
      const previous = seen[value.window];
      next[value.window] = value.percent;
      if (previous === undefined) continue;

      if (value.percent <= previous - RESET_MARGIN) {
        if (wantsReset) showResetAlert(agent, value);
        continue;
      }
      if (wantsLow && previous < threshold && value.percent >= threshold) {
        showQuotaAlert(agent, value);
      }
    }

    await context.globalState.update(key, next);
  }
}

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

  vscode.window.showInformationMessage(changed ? t().hooksRemoved : t().noHooks);
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
  --vsignal-codex: #000000;
  --vsignal-ok: #3fb950;
  --vsignal-warn: #d29922;
  --vsignal-alert: #f85149;
  --vsignal-radius: 10px;
}

* { box-sizing: border-box; }

/* Une regle d'auteur comme .actions { display: grid } l'emporte sinon sur le
   [hidden] de la feuille du navigateur, et la section repliee reste visible. */
[hidden] { display: none !important; }

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

.section { display: flex; align-items: center; justify-content: space-between; gap: 8px; }

/* Chaque section se replie : on peut ne garder que les quotas sous les yeux
   sans perdre l'acces aux reglages. */
.section-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 1 1 auto;
  min-width: 0;
  border: none;
  background: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  font: inherit;
  color: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  text-align: left;
}

.section-toggle:hover { color: var(--vscode-foreground); }

.section-toggle:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }

.section-toggle .chevron {
  width: 9px;
  height: 9px;
  flex: none;
  transition: transform 130ms ease;
}

.section-toggle[aria-expanded='false'] .chevron { transform: rotate(-90deg); }

.section-toggle span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.section.with-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.icon-button {
  border: none;
  background: none;
  padding: 3px;
  margin: -3px -3px -3px 0;
  border-radius: 4px;
  cursor: pointer;
  line-height: 0;
  color: var(--vscode-descriptionForeground);
}

.icon-button:hover {
  color: var(--vscode-foreground);
  background: rgba(128, 128, 128, 0.16);
}

.icon-button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }

.icon-button svg { width: 13px; height: 13px; display: block; }

/* Les quotas sont la raison d'etre du panneau : ils ne se replient pas et
   n'ont pas besoin d'un titre. L'actualisation se pose dans leur coin. */
.quota-card { position: relative; padding-top: 11px; }

.icon-button.floating {
  position: absolute;
  top: 9px;
  right: 9px;
  margin: 0;
}

.quota-card .quota-agent:first-child .quota-head { padding-right: 22px; }

.icon-button.busy svg { animation: spin 0.9s linear infinite; }

@keyframes spin { to { transform: rotate(360deg); } }

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 26px;
}

.row + .row { margin-top: 2px; }

.row .name { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 auto; }

.group-caption {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--vscode-descriptionForeground);
  margin: 0 0 6px;
}

.group + .group {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.22));
}

.row .name span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.language-select {
  flex: 0 1 154px;
  min-width: 0;
  max-width: 58%;
  height: 25px;
  padding: 1px 22px 1px 7px;
  color: var(--vscode-settings-dropdownForeground, var(--vscode-foreground));
  background: var(--vscode-settings-dropdownBackground, var(--vscode-dropdown-background));
  border: 1px solid var(--vscode-settings-dropdownBorder, var(--vscode-dropdown-border));
  border-radius: 3px;
  font: inherit;
}

.language-select:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }

/* Le fournisseur se lit sur une pastille a ses couleurs plutot que sur un
   point de sept pixels que rien n'explique. */
.badge {
  flex: none;
  padding: 2px 7px;
  border-radius: 5px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.2px;
  color: #ffffff;
  border: 1px solid transparent;
}

.badge.claude { background: var(--vsignal-claude); }

/* Le noir d'OpenAI a besoin d'un filet pour exister sur fond sombre. */
.badge.codex {
  background: var(--vsignal-codex);
  border-color: rgba(255, 255, 255, 0.28);
}

.muted { color: var(--vscode-descriptionForeground); font-size: 11.5px; }


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

.quota-agent + .quota-agent { margin-top: 14px; }

.quota-head {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 9px;
}

.freshness {
  margin-top: 11px;
  font-size: 10.5px;
  color: var(--vscode-descriptionForeground);
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

/* laisser le pourcentage toujours visible : c'est le seul chiffre qui compte,
// le libelle de reinitialisation peut etre tronque sans perte. */
.quota-meta .left {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quota-meta .value {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

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

/* Colonne etroite : on retire le superflu plutot que de laisser deborder. */
/* Le delai avant reinitialisation ne disparait jamais : il se condense. */
.reset .mid,
.reset .tight { display: none; }

@media (max-width: 300px) {
  .reset .full { display: none; }
  .reset .mid { display: inline; }
}

@media (max-width: 240px) {
  .reset .mid { display: none; }
  .reset .tight { display: inline; }
}

@media (max-width: 260px) {
  body { padding: 12px 9px 18px; }
  .card { padding: 10px; }
  .actions { grid-template-columns: 1fr; }
}
`;

const PANEL_SCRIPT = `
const vscode = acquireVsCodeApi();

// Textes fournis par l'extension : le panneau n'en connait aucun en dur.
let T = {};

function fmt(template, ...values) {
  return values.reduce(
    (text, value, index) => text.split('{' + index + '}').join(String(value)),
    String(template || '')
  );
}

function applyText(selector, text) {
  for (const node of document.querySelectorAll(selector)) node.textContent = text;
}

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

function languagePicker(value, options) {
  const picker = el('select', 'language-select');
  for (const entry of options || []) {
    const option = el('option', null, entry.label);
    option.value = entry.value;
    option.selected = entry.value === value;
    picker.appendChild(option);
  }
  picker.addEventListener('change', () => send({ type: 'language', value: picker.value }));
  return picker;
}

// Pourcentage consomme : la couleur dit la gravite, pas le modele. Peindre la
// bande confortable aux couleurs de l'agent faisait passer un quota sain pour
// une alerte.
// Les durees circulent en unites francaises : c'est le format de transport,
// traduit au seul moment de l'affichage.
function localize(text) {
  return String(text)
    .replace(/\bmin\b/g, T.unitMin || 'min')
    .replace(/\bh\b/g, T.unitHour || 'h')
    .replace(/\bj\b/g, T.unitDay || 'j');
}

// '1 j 10 h' devient '1j10h', '27 min' devient '27m' : de quoi garder le
// delai lisible meme dans une colonne tres etroite.
function tighten(reset) {
  return String(reset).replace(/\s+/g, '').replace(/min/g, 'm');
}

function barColor(percent) {
  if (percent >= 80) return 'var(--vsignal-alert)';
  if (percent >= 60) return 'var(--vsignal-warn)';
  return 'var(--vsignal-ok)';
}

function renderStatus(state) {
  T = state.strings || T;
  document.documentElement.lang = state.language || 'en';

  const pill = document.getElementById('status-pill');
  pill.textContent = state.enabled ? T.statusOn : T.statusOff;
  pill.className = 'pill ' + (state.enabled ? 'on' : 'off');

  applyText('[data-text="sectionSettings"]', T.sectionSettings);
  applyText('[data-text="sectionActions"]', T.sectionActions);
  applyText('[data-text="testClaude"]', T.testClaude);
  applyText('[data-text="testCodex"]', T.testCodex);
  applyText('[data-text="repairHooks"]', T.repairHooks);
  applyText('[data-text="removeHooks"]', T.removeHooks);

  const refreshButton = document.getElementById('refresh');
  if (refreshButton) {
    refreshButton.title = T.refreshQuotas;
    refreshButton.setAttribute('aria-label', T.refreshQuotas);
  }

  const prefs = document.getElementById('prefs');
  prefs.innerHTML = '';
  for (const group of state.groups) {
    const block = el('div', 'group');
    block.appendChild(el('div', 'group-caption', group.caption));
    for (const item of group.items) {
      const row = el('div', 'row');
      const name = el('div', 'name');
      name.appendChild(el('span', null, item.label));
      row.appendChild(name);
      if (item.kind === 'select') {
        row.appendChild(languagePicker(item.value, item.options));
      } else {
        row.appendChild(toggle(item.value, value => send({ type: 'pref', key: item.key, value })));
      }
      block.appendChild(row);
    }
    prefs.appendChild(block);
  }

}

// Le panneau se recharge toutes les minutes : reconstruire le DOM a chaque
// fois ferait repartir les barres de zero et sauter la mise en page. On ne
// rebatit donc que si la structure change, sinon on corrige les valeurs sur
// place et la transition CSS fait le reste.
let quotaShape = '';
const quotaCells = new Map();

function shapeOf(agents) {
  return agents.map(entry => entry.agent + ':' + entry.values.map(v => v.window).join(',')).join('|');
}

function renderQuotas(payload) {
  const refresh = document.getElementById('refresh');
  if (refresh) refresh.classList.toggle('busy', Boolean(payload.loading));

  // Une lecture en cours ne doit rien changer a l'ecran : les valeurs
  // affichees restent les dernieres connues jusqu'a l'arrivee des nouvelles.
  if (!payload.agents) {
    if (payload.loading && !quotaCells.size) showSkeleton();
    return;
  }
  if (payload.loading && quotaCells.size) return;

  lastQuotaAt = payload.at || lastQuotaAt;

  const shape = shapeOf(payload.agents);
  if (shape !== quotaShape || !quotaCells.size) {
    buildQuotas(payload.agents);
    quotaShape = shape;
  }

  updateQuotas(payload.agents);
}

function showSkeleton() {
  const host = document.getElementById('quotas');
  host.innerHTML = '';
  for (let index = 0; index < 2; index++) {
    const block = el('div', 'quota-agent');
    block.appendChild(el('div', 'muted', T.loadingQuotas || ''));
    const skeleton = el('div', 'skeleton');
    skeleton.style.marginTop = '8px';
    block.appendChild(skeleton);
    host.appendChild(block);
  }
}

function buildQuotas(agents) {
  const host = document.getElementById('quotas');
  host.innerHTML = '';
  quotaCells.clear();

  for (const entry of agents) {
    const block = el('div', 'quota-agent');
    const head = el('div', 'quota-head');
    head.appendChild(el('span', 'badge ' + entry.agent.toLowerCase(), entry.agent));
    block.appendChild(head);

    if (!entry.values.length) {
      block.appendChild(el('div', 'muted', entry.agent === 'Claude' ? T.waitingClaude : T.noCodex));
      host.appendChild(block);
      continue;
    }

    for (const value of entry.values) {
      const line = el('div', 'quota-line');
      const meta = el('div', 'quota-meta');
      const left = el('span', 'muted left');
      left.appendChild(el('span', 'window'));

      const reset = el('span', 'reset');
      const full = el('span', 'full');
      const mid = el('span', 'mid');
      const tight = el('span', 'tight');
      reset.appendChild(full);
      reset.appendChild(mid);
      reset.appendChild(tight);
      left.appendChild(reset);

      const right = el('span', 'value');
      meta.appendChild(left);
      meta.appendChild(right);
      line.appendChild(meta);

      const track = el('div', 'track');
      const fill = el('div', 'fill');
      track.appendChild(fill);
      line.appendChild(track);
      block.appendChild(line);

      quotaCells.set(entry.agent + '|' + value.window, {
        window: left.querySelector('.window'), reset, full, mid, tight, right, fill
      });
    }

    host.appendChild(block);
  }

  host.appendChild(freshnessLine());
}

function updateQuotas(agents) {
  for (const entry of agents) {
    for (const value of entry.values) {
      const cell = quotaCells.get(entry.agent + '|' + value.window);
      if (!cell) continue;

      cell.window.textContent = localize(value.window);
      cell.right.textContent = value.percent + ' %';
      cell.fill.style.background = barColor(value.percent);
      cell.fill.style.width = value.percent + '%';

      if (value.reset) {
        const delay = localize(value.reset);
        const full = fmt(T.resetIn, delay);
        cell.reset.hidden = false;
        cell.reset.title = full;
        cell.full.textContent = '  ·  ' + full;
        cell.mid.textContent = '  ·  ' + delay;
        cell.tight.textContent = ' · ' + tighten(delay);
      } else {
        cell.reset.hidden = true;
      }
    }
  }

  const line = document.getElementById('freshness');
  if (line) line.textContent = freshnessText();
}

// Sans repere, rien ne distingue un panneau a jour d'un panneau fige.
let lastQuotaAt = 0;

function freshnessLine() {
  const line = el('div', 'freshness');
  line.id = 'freshness';
  line.textContent = freshnessText();
  return line;
}

function freshnessText() {
  if (!lastQuotaAt) return '';
  const seconds = Math.max(0, Math.round((Date.now() - lastQuotaAt) / 1000));
  if (seconds < 45) return T.freshNow || '';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return fmt(T.freshMinutes, minutes);
  return fmt(T.freshHours, Math.round(minutes / 60));
}

setInterval(() => {
  const line = document.getElementById('freshness');
  if (line) line.textContent = freshnessText();
}, 10000);

window.addEventListener('message', event => {
  const message = event.data;
  if (message.type === 'state') renderStatus(message);
  if (message.type === 'quotas') renderQuotas(message);
});

for (const button of document.querySelectorAll('[data-command]')) {
  button.addEventListener('click', () => send({ type: 'command', command: button.dataset.command }));
}

// L'etat replie survit aux fermetures du panneau et aux rechargements.
const folded = new Set((vscode.getState() || {}).folded || []);

function applyFold(toggle) {
  const target = document.getElementById(toggle.dataset.target);
  const open = !folded.has(toggle.dataset.target);
  toggle.setAttribute('aria-expanded', String(open));
  if (target) target.hidden = !open;
}

for (const toggle of document.querySelectorAll('.section-toggle')) {
  applyFold(toggle);
  toggle.addEventListener('click', () => {
    const id = toggle.dataset.target;
    if (folded.has(id)) folded.delete(id); else folded.add(id);
    vscode.setState({ folded: [...folded] });
    applyFold(toggle);
  });
}
`;

class ControlPanelProvider {
  constructor(context) {
    this.context = context;
    this.view = undefined;
    this.values = { Claude: null, Codex: null };
    this.sourceAt = { Claude: 0, Codex: 0 };
  }

  isVisible() {
    return Boolean(this.view && this.view.visible);
  }

  dispose() {}

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

    if (message.type === 'pref' && SETTING_KEYS.includes(message.key)) {
      void vscode.workspace
        .getConfiguration('vsignal')
        .update(message.key, Boolean(message.value), vscode.ConfigurationTarget.Global);
      return;
    }

    if (message.type === 'language' && LANGUAGE_CHOICES.includes(message.value)) {
      void vscode.workspace
        .getConfiguration('vsignal')
        .update('language', message.value, vscode.ConfigurationTarget.Global);
    }
  }

  post(payload) {
    if (this.view) void this.view.webview.postMessage(payload);
  }

  refresh(force = false) {
    if (!this.view) return;

    const config = vscode.workspace.getConfiguration('vsignal');
    this.post({
      type: 'state',
      enabled: isEnabled(),
      language: currentLanguage(),
      strings: t(),
      groups: settingGroups(t()).map(group => ({
        caption: group.caption,
        items: group.items.map(item => ({
          key: item.key,
          label: item.label,
          agent: item.agent,
          kind: item.kind,
          options: item.options,
          // Pour les popups, le marqueur sur disque fait foi, pas le reglage.
          value: item.key === 'enabled'
            ? isEnabled()
            : item.key === 'language'
              ? config.get('language', 'auto')
              : config.get(item.key, true)
        }))
      }))
    });

    if (force || (!this.values.Claude && !this.values.Codex)) this.showQuotaLoading();
    else this.postQuotas(false);
    void refreshAllQuotas(this.context, force);
  }

  postQuotas(loading) {
    const sourceTimes = Object.entries(this.values)
      .filter(([, values]) => Array.isArray(values) && values.length)
      .map(([agent]) => this.sourceAt[agent])
      .filter(value => Number.isFinite(value) && value > 0);

    this.post({
      type: 'quotas',
      loading: Boolean(loading),
      // La ligne de fraicheur indique la donnee la plus ancienne affichee.
      // Relire un cache ne le fait donc plus passer pour une donnee instantanee.
      at: sourceTimes.length ? Math.min(...sourceTimes) : 0,
      // Le panneau montre toujours les quatre fenetres, meme celles masquees
      // dans les popups.
      agents: [
        { agent: 'Claude', values: this.values.Claude || [] },
        { agent: 'Codex', values: this.values.Codex || [] }
      ]
    });
  }

  showQuotaLoading() {
    const first = !this.values.Claude && !this.values.Codex;
    if (first) this.post({ type: 'quotas', loading: true });
    else this.postQuotas(true);
  }

  applyQuotaSnapshot(snapshot) {
    for (const agent of ['Claude', 'Codex']) {
      const next = snapshot[agent];
      // Une panne ponctuelle de PowerShell ou de l'app-server ne doit pas
      // effacer une valeur connue. Au premier passage seulement, l'etat vide
      // reste utile pour afficher le message de compte non detecte.
      if (next.values.length || this.values[agent] === null) {
        this.values[agent] = next.values;
        this.sourceAt[agent] = next.sourceAt;
      }
    }
    this.postQuotas(false);
  }

  render(webview) {
    const nonce = createNonce();
    return [
      '<!DOCTYPE html>',
      `<html lang="${currentLanguage()}"><head><meta charset="UTF-8">`,
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">`,
      `<style>${PANEL_STYLE}</style></head><body>`,
      '<div class="masthead">',
      '<div class="wordmark">',
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M4 4.5 12 21 20 4.5"/><circle fill="currentColor" cx="12" cy="10" r="1.6"/><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M8.7 7.7a4.7 4.7 0 0 1 6.6 0M6.2 5.3a8.2 8.2 0 0 1 11.6 0"/></svg>',
      'VSignal</div>',
      '<span id="status-pill" class="pill off">…</span>',
      '</div>',
      '<div class="card quota-card">',
      '<button class="icon-button floating" id="refresh" type="button" data-command="vsignal.refreshQuotas"',
      ' title="Refresh quotas" aria-label="Refresh quotas">',
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">',
      '<path d="M13.6 7a5.7 5.7 0 1 0-.5 3.4"/><path d="M13.9 3.1v3.6h-3.6"/>',
      '</svg></button>',
      '<div id="quotas"></div>',
      '</div>',
      '<div class="section">',
      '<button class="section-toggle" type="button" data-target="prefs" aria-expanded="true">',
      '<svg class="chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5"/></svg>',
      '<span data-text="sectionSettings"></span>',
      '</button>',
      '</div>',
      '<div class="card flush" id="prefs"></div>',
      '<div class="section">',
      '<button class="section-toggle" type="button" data-target="actions" aria-expanded="true">',
      '<svg class="chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5"/></svg>',
      '<span data-text="sectionActions"></span>',
      '</button>',
      '</div>',
      '<div class="actions" id="actions">',
      '<button class="action primary" data-command="vsignal.testClaude" type="button" data-text="testClaude"></button>',
      '<button class="action primary" data-command="vsignal.testCodex" type="button" data-text="testCodex"></button>',
      '<button class="action wide" data-command="vsignal.setup" type="button" data-text="repairHooks"></button>',
      '<button class="action quiet" data-command="vsignal.removeHooks" type="button" data-text="removeHooks"></button>',
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
    vscode.commands.registerCommand('vsignal.refreshQuotas', () => {
      if (controlPanelProvider) controlPanelProvider.showQuotaLoading();
      void refreshAllQuotas(context, true);
    }),
    vscode.commands.registerCommand('vsignal.setup', () => setup(context, true)),
    vscode.commands.registerCommand('vsignal.testClaude', () => runTest(context, 'Claude')),
    vscode.commands.registerCommand('vsignal.testCodex', () => runTest(context, 'Codex')),
    vscode.commands.registerCommand('vsignal.showStatus', () => {
      const strings = t();
      vscode.window.showInformationMessage(
        format(
          strings.statusSummary,
          isEnabled() ? strings.stateEnabled : strings.stateDisabled,
          fs.existsSync(SCRIPT_PATH) ? 'OK' : strings.stateMissing,
          hasClaudeHook() ? 'OK' : strings.stateMissing,
          hasCodexHook() ? 'OK' : strings.stateMissing
        )
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
      if (event.affectsConfiguration('vsignal.alert')) {
        if (controlPanelProvider) controlPanelProvider.refresh();
      }
      if (event.affectsConfiguration('vsignal.language')) {
        writePopupPreferences();
        if (controlPanelProvider) controlPanelProvider.refresh();
      }
    })
  );

  // La surveillance tourne meme panneau ferme : c'est tout son interet.
  // Claude Code reecrit ~/.claude.json des qu'il rafraichit ses compteurs :
  // c'est un signal bien plus rapide que d'attendre le prochain tour d'horloge.
  // watchFile sonde l'horodatage plutot que de suivre le descripteur, ce qui
  // survit aux ecritures par fichier temporaire suivies d'un renommage.
  const claudeState = path.join(os.homedir(), '.claude.json');
  fs.watchFile(claudeState, { interval: 5000 }, (current, previous) => {
    if (current.mtimeMs === previous.mtimeMs) return;
    refreshAllQuotasThrottled(context);
  });
  context.subscriptions.push({ dispose: () => fs.unwatchFile(claudeState) });

  // Un refus de quota est plus recent que le snapshot d'usage et se trouve
  // dans le journal de session. Le suivre permet au panneau de passer a 100 %
  // aussitot, meme si ~/.claude.json n'a pas ete reecrit.
  const claudeProjects = path.join(os.homedir(), '.claude', 'projects');
  try {
    const claudeLogWatcher = fs.watch(claudeProjects, { recursive: true }, (_event, filename) => {
      if (!filename || !String(filename).toLowerCase().endsWith('.jsonl')) return;
      refreshAllQuotasThrottled(context);
    });
    context.subscriptions.push({ dispose: () => claudeLogWatcher.close() });
  } catch {
    // Le dossier n'existe pas avant la premiere session Claude.
  }

  context.subscriptions.push(
    vscode.window.onDidChangeWindowState(windowState => {
      if (windowState.focused) refreshAllQuotasThrottled(context);
    })
  );

  // Boucle unique pendant toute la vie de l'hote d'extensions. Elle ne depend
  // ni de la creation du panneau ni de sa visibilite.
  const quotaRefreshTimer = setInterval(
    () => void refreshAllQuotas(context),
    QUOTA_REFRESH_INTERVAL_MS
  );

  context.subscriptions.push(
    controlPanelProvider,
    { dispose: () => clearInterval(quotaRefreshTimer) }
  );

  const prepare = vscode.workspace.getConfiguration('vsignal').get('autoConfigure', true)
    ? setup(context, false)
    : Promise.resolve();
  void prepare.then(() => {
    snapshotTaskQuota('Claude');
    snapshotTaskQuota('Codex');
    void refreshAllQuotas(context);
  });
}

function deactivate() {
  controlPanelProvider = undefined;
}

module.exports = { activate, deactivate };
