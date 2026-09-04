# VSignal

[Français](README.md) · [English](README.en.md)

> Les modèles répondent. VSignal vous prévient.

VSignal affiche une popup Windows discrète lorsqu’une tâche Claude ou Codex se termine dans VS Code. La notification reste indépendante du Centre de notifications Windows, s’adapte au résultat de la tâche et peut afficher les quotas restants avec leur délai de réinitialisation.

[![Licence MIT](https://img.shields.io/badge/licence-MIT-green.svg)](LICENSE)
![Windows 11](https://img.shields.io/badge/Windows-11-0078D4.svg)
![VS Code](https://img.shields.io/badge/VS%20Code-1.85%2B-23A8F2.svg)

## Fonctionnalités

- Popup WPF horizontale dans le coin haut droit de l’écran : fond sombre translucide, lueur et onde aux couleurs du fournisseur, marque du modèle, titre, sous-titre et ligne de vie.
- Le survol met la fermeture en pause et la relance à zéro ; un clic ou le bouton `Voir` remet VS Code au premier plan, tandis que la croix ferme uniquement la popup.
- **La marque dit le modèle, la couleur dit la gravité.** Le logo Claude, Codex ou Gemini identifie l’émetteur ; le vert, l’orange et le rouge restent réservés à l’état du quota.
- Message adapté à la situation : tâche terminée, question, blocage, code modifié ou tests validés.
- Barres de quota `5 h` et `7 j` en pourcentage **consommé**, comme `/usage` de Claude Code : vert tant qu’il reste de la marge, orange à partir de 60 %, rouge à partir de 80 %.
- Indicateur compact `+N%` à droite de la popup pour le coût en quota `5 h` de la tâche terminée, désactivable séparément pour Claude et Codex.
- Panneau VS Code dédié : les quotas Claude, Codex et Gemini de votre choix sous les yeux, le reste replié d’un clic.
- Alertes automatiques quand une fenêtre de quota devient basse **ou** repart à zéro, activables modèle par modèle.
- Configuration automatique à chaque démarrage de VS Code, quel que soit le projet ouvert.
- Aucun serveur VSignal, aucune télémétrie et aucune notification Windows native.
- Interface et popups disponibles en français et en anglais, avec détection automatique de la langue de VS Code.

## Prérequis

- Windows 11
- VS Code 1.85 ou version ultérieure
- Claude Code, Codex et/ou Antigravity CLI (`agy`) installé et connecté

VSignal utilise seulement Windows PowerShell 5.1 et WPF, déjà présents dans Windows.

## Installation

### Depuis un fichier VSIX

1. Téléchargez le dernier fichier `vsignal-*.vsix` depuis les [Releases](https://github.com/Xen3t/VSignal/releases).
2. Dans VS Code, ouvrez la palette avec `Ctrl+Shift+P`.
3. Lancez `Extensions: Install from VSIX...` et sélectionnez le fichier.
4. Rechargez VS Code si demandé.

L’icône VSignal apparaît alors dans la barre d’activité à gauche. L’extension installe son script PowerShell dans `%USERPROFILE%\.vsignal\agent-done.ps1`, puis fusionne ses hooks avec les configurations existantes de Claude et Codex sans écraser les autres réglages.

### Construire depuis les sources

```powershell
git clone https://github.com/Xen3t/VSignal.git
cd VSignal
npm install
npm run check
npm run package
```

Installez ensuite le fichier `vsignal-*.vsix` produit à la racine du projet.

## Utilisation

Le panneau VSignal, dans la barre d’activité, regroupe tout :

- **Les quotas** occupent le haut du panneau, sans titre ni repli : les fournisseurs sélectionnés sont affichés dans des cartes dédiées. Chaque carte possède son propre bouton d’actualisation ; celui placé à côté de l’état `Actif` les actualise toutes.
- **Paramètres** — un groupe général, puis un groupe complet par fournisseur (`Claude`, `Codex`, `Gemini`) réunissant sa visibilité, ses quotas de popup et ses alertes.
- **Actions** — tester chaque modèle, réparer ou retirer les hooks.

`Paramètres` et `Actions` se replient d’un clic sur leur titre, et l’état est mémorisé : le panneau peut se réduire aux seuls quotas sans que les réglages deviennent inaccessibles.

En colonne étroite, le délai avant réinitialisation ne disparaît pas : il se condense, de `reset dans 27 min` à `27 min` puis à `27 m`. Le pourcentage, lui, reste toujours affiché en entier.
Les hooks étant réinstallés et réparés à chaque démarrage de VS Code, le panneau ne consacre pas de place à leur état. Pour le vérifier ponctuellement, `VSignal: Afficher l’état` récapitule le script, les hooks Claude et le hook Codex.

Les mêmes actions restent disponibles dans la palette de commandes :

- `VSignal: Activer / désactiver`
- `VSignal: Actualiser les quotas`
- `VSignal: Configurer Claude et Codex`
- `VSignal: Tester Claude`
- `VSignal: Tester Codex`
- `VSignal: Tester Gemini`
- `VSignal: Afficher l’état`
- `VSignal: Retirer les hooks`

### Quand les quotas sont-ils actualisés ?

Tant que VS Code est ouvert, VSignal relit **Claude et Codex toutes les minutes** lorsque le panneau est visible ou qu’au moins une alerte de quota est active. Il lit la limite hebdomadaire Gemini avec la commande locale `agy /quota` quand sa carte est visible ou qu’une de ses alertes est active. Les lectures partent ensemble et sont publiées une fois revenues.

S’y ajoutent, limités à une lecture toutes les 20 s : toute modification de `~/.claude.json`, surveillée par sondage de son horodatage pour résister aux écritures par fichier temporaire suivies d’un renommage, et le retour du focus sur la fenêtre VS Code. Le bouton d’actualisation force une lecture fraîche de l’usage Claude ; les lectures automatiques réutilisent ce relevé jusqu’à cinq minutes pour ne pas saturer l’endpoint OAuth.

Rien ne bouge pendant une lecture : les valeurs affichées restent les dernières connues, le DOM n’est pas reconstruit, et seules les valeurs changées sont corrigées sur place. Les barres glissent vers leur nouvelle longueur au lieu de repartir de zéro. Chaque carte affiche discrètement l’âge de son propre relevé à gauche de son bouton d’actualisation.

Le snapshot d’usage écrit par Claude Code peut avoir quelques minutes de retard. Si Claude consigne entre-temps un refus pour quota atteint, VSignal recoupe ce journal local avec le snapshot et affiche immédiatement 100 % pour la fenêtre concernée, sans lire les identifiants du compte.

Une lecture Codex démarre brièvement un `codex app-server`. Les événements Claude, l’arrêt des lectures de fond quand elles sont inutiles et l’interruption anticipée du parcours des journaux limitent le coût de la cadence d’une minute.

### Alertes de quota

VSignal surveille les fenêtres `5 h` et `7 j` de Claude et Codex, ainsi que la fenêtre `7 j` de Gemini, et signale deux moments :

- **Quota bas** — la fenêtre franchit le seuil de consommation. Popup rouge rappelant ce qu’il reste.
- **Remise à zéro** — la fenêtre repart de zéro. Popup verte : le modèle est de nouveau disponible.

Les deux se déclenchent sur **transition**, jamais en continu : l’alerte de quota bas ne se répète pas tant que le quota reste haut, et redémarrer VS Code ne provoque aucune volée de notifications.

| Réglage | Rôle |
| --- | --- |
| `vsignal.alert.lowQuota.claude` | Prévenir quand une fenêtre Claude devient basse |
| `vsignal.alert.lowQuota.codex` | Prévenir quand une fenêtre Codex devient basse |
| `vsignal.alert.lowQuota.gemini` | Prévenir quand la fenêtre Gemini devient basse |
| `vsignal.alert.reset.claude` | Prévenir quand une fenêtre Claude repart à zéro |
| `vsignal.alert.reset.codex` | Prévenir quand une fenêtre Codex repart à zéro |
| `vsignal.alert.reset.gemini` | Prévenir quand la fenêtre Gemini repart à zéro |
| `vsignal.alert.threshold` | Pourcentage consommé déclencheur, `90` par défaut, soit 10 % restants |

Ces alertes ignorent les cinq réglages ci-dessous : la barre concernée est toujours affichée, puisque c’est l’objet même de la notification.

### Choisir les quotas affichés dans les popups

Une popup surchargée se lit mal. Les cinq réglages ci-dessous décident de ce qu’elle montre indépendamment des cartes choisies dans le panneau VSignal.

| Réglage | Barre concernée |
| --- | --- |
| `vsignal.popup.claude.fiveHours` | Claude, fenêtre de 5 h |
| `vsignal.popup.claude.weekly` | Claude, fenêtre de 7 j |
| `vsignal.popup.codex.fiveHours` | Codex, fenêtre de 5 h |
| `vsignal.popup.codex.weekly` | Codex, fenêtre de 7 j |
| `vsignal.popup.gemini.weekly` | Gemini, fenêtre de 7 j dans les tests et alertes |

Si toutes les barres d’un modèle sont désactivées, sa popup de test se limite au message. Les valeurs sont recopiées dans `%USERPROFILE%\.vsignal\popup.json`, que lit le script PowerShell.

Les réglages `vsignal.panel.providers.claude`, `vsignal.panel.providers.codex` et `vsignal.panel.providers.gemini` choisissent séparément les cartes visibles dans la barre d’extension. Masquer une carte ne désactive pas les alertes de son fournisseur.

Pour tester directement le moteur de popup depuis le dépôt :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\resources\agent-done.ps1 -Agent Codex -State Tested
```

## Script facultatif pour deux écrans

Le script facultatif [ShortcutsAddict.ahk](Script_Hotkey/ShortcutsAddict.ahk) associe la touche située sous `Échap` (`²` en AZERTY, `` ` `` en QWERTY) à l’échange des deux fenêtres au premier plan entre les deux écrans, et transforme `Verr. Maj` en touche de raccourcis pour lancer des applications ou piloter le son et la lecture. Il est totalement indépendant de VSignal, n’est pas inclus dans le VSIX et demande uniquement [AutoHotkey v2](https://www.autohotkey.com/) ; la liste complète des raccourcis est dans [SHORTCUTS.md](Script_Hotkey/SHORTCUTS.md).

## Fichiers et confidentialité

VSignal peut créer ou mettre à jour les fichiers suivants :

- `%USERPROFILE%\.vsignal\agent-done.ps1`
- `%USERPROFILE%\.vsignal\popup.json`
- `%USERPROFILE%\.vsignal\disabled`
- `%USERPROFILE%\.vsignal\claude-quota.json`
- `%USERPROFILE%\.vsignal\task-quota-claude.txt`
- `%USERPROFILE%\.vsignal\task-quota-codex.txt`
- `%USERPROFILE%\.claude\settings.json`
- `%USERPROFILE%\.codex\config.toml`

Pour afficher les quotas Claude, l’extension interroge `https://api.anthropic.com/api/oauth/usage` avec le jeton OAuth de Claude Code, gardé uniquement en mémoire. En cas d’échec, elle se replie sur `%USERPROFILE%\.claude.json` et les fins des journaux `.jsonl` modifiés depuis le dernier snapshot dans `%USERPROFILE%\.claude\projects`. Les quotas Codex sont lus via le serveur local de l’application Codex, et Gemini via la sortie JSON de la commande locale `agy /quota`. Une sauvegarde `.before-vsignal.bak` est créée avant la première modification d’une configuration existante. Les messages sont analysés en mémoire afin de choisir le libellé de la popup, mais ils ne sont ni enregistrés ni envoyés par VSignal ; consultez [SECURITY.md](SECURITY.md) pour le détail.

## Désinstallation

Avant de désinstaller l’extension, lancez `VSignal: Retirer les hooks` si vous souhaitez aussi retirer ses entrées des configurations Claude et Codex. Vous pouvez ensuite désinstaller VSignal normalement depuis le panneau Extensions de VS Code.

## Marques

Les logos Claude, Codex et Gemini affichés par VSignal servent à identifier leur fournisseur. Ils appartiennent respectivement à Anthropic, OpenAI et Google, ne sont pas couverts par la licence MIT de VSignal, et leur présence ne vaut ni affiliation ni approbation.

## Licence

VSignal est distribué sous [licence MIT](LICENSE) : utilisation, modification et redistribution sont autorisées sous les conditions très permissives de cette licence.
