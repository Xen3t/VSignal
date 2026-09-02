# VSignal

> Les modèles répondent. VSignal vous prévient.

VSignal affiche une popup Windows discrète lorsqu’une tâche Claude ou Codex se termine dans VS Code. La notification reste indépendante du Centre de notifications Windows, s’adapte au résultat de la tâche et peut afficher les quotas restants avec leur délai de réinitialisation.

[![Licence MIT](https://img.shields.io/badge/licence-MIT-green.svg)](LICENSE)
![Windows 11](https://img.shields.io/badge/Windows-11-0078D4.svg)
![VS Code](https://img.shields.io/badge/VS%20Code-1.85%2B-23A8F2.svg)

## Fonctionnalités

- Popup WPF toujours visible, centrée en bas de l’écran : pastille d’état colorée, titre, sous-titre explicatif et ligne de vie indiquant le temps restant avant fermeture.
- Le survol met la fermeture en pause et la relance à zéro ; un clic ferme la popup immédiatement.
- Message adapté à la situation : tâche terminée, question, blocage, code modifié ou tests validés, chaque état ayant sa couleur.
- Barres de quota `5 h` et `7 j` avec pourcentage restant et temps avant réinitialisation, en vert, orange ou rouge selon ce qu’il reste.
- Panneau VS Code dédié : interrupteur général, état des intégrations, quotas des deux modèles et choix des quotas affichés dans les popups.
- Configuration automatique à chaque démarrage de VS Code, quel que soit le projet ouvert.
- Aucun serveur VSignal, aucune télémétrie et aucune notification Windows native.

## Prérequis

- Windows 11
- VS Code 1.85 ou version ultérieure
- Claude Code et/ou Codex installé et connecté dans VS Code

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

- **Popups** — l’interrupteur général, qui coupe ou rallume toutes les notifications.
- **Intégrations** — l’état des hooks Claude et Codex, avec un lien de réparation quand l’un manque.
- **Quotas restants** — les fenêtres `5 h` et `7 j` des deux modèles, toujours affichées ici en entier.
- **Quotas affichés dans les popups** — quatre interrupteurs indépendants pour choisir ce qui apparaît dans la popup.
- **Actions** — tester chaque modèle, actualiser les quotas, réparer ou retirer les hooks.

Les mêmes actions restent disponibles dans la palette de commandes :

- `VSignal: Activer / désactiver`
- `VSignal: Actualiser les quotas`
- `VSignal: Configurer Claude et Codex`
- `VSignal: Tester Claude`
- `VSignal: Tester Codex`
- `VSignal: Afficher l’état`
- `VSignal: Retirer les hooks`

### Choisir les quotas affichés dans les popups

Une popup surchargée se lit mal. Les quatre réglages ci-dessous décident de ce qu’elle montre ; le panneau VSignal, lui, continue d’afficher les quatre fenêtres quoi qu’il arrive.

| Réglage | Barre concernée |
| --- | --- |
| `vsignal.popup.claude.fiveHours` | Claude, fenêtre de 5 h |
| `vsignal.popup.claude.weekly` | Claude, fenêtre de 7 j |
| `vsignal.popup.codex.fiveHours` | Codex, fenêtre de 5 h |
| `vsignal.popup.codex.weekly` | Codex, fenêtre de 7 j |

Si les deux barres d’un modèle sont désactivées, sa popup se limite au message. Les valeurs sont recopiées dans `%USERPROFILE%.vsignalpopup.json`, que lit le script PowerShell.

Pour tester directement le moteur de popup depuis le dépôt :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .esourcesagent-done.ps1 -Agent Codex -State Tested
```

## Script facultatif pour deux écrans

Le script facultatif [SwitchDualWindow.ahk](Script_Hotkey/SwitchDualWindow.ahk) associe la touche située sous `Échap` (`²` en AZERTY, `` ` `` en QWERTY) à l’échange des deux fenêtres au premier plan entre l’écran 1 et l’écran 2, chacune étant redimensionnée à la zone de travail de son nouvel écran puis maximisée, le focus revenant ensuite à la fenêtre qui arrive sur l’écran principal. Il est totalement indépendant de VSignal, n’est pas inclus dans le VSIX et demande uniquement [AutoHotkey v2](https://www.autohotkey.com/).

## Fichiers et confidentialité

VSignal peut créer ou mettre à jour les fichiers suivants :

- `%USERPROFILE%\.vsignal\agent-done.ps1`
- `%USERPROFILE%\.vsignal\claude-quota.json`
- `%USERPROFILE%\.claude\settings.json`
- `%USERPROFILE%\.codex\config.toml`

Une sauvegarde `.before-vsignal.bak` est créée avant la première modification d’une configuration existante. Les messages sont analysés en mémoire afin de choisir le libellé de la popup, mais ils ne sont ni enregistrés ni envoyés par VSignal ; consultez [SECURITY.md](SECURITY.md) pour le détail.

## Désinstallation

Avant de désinstaller l’extension, lancez `VSignal: Retirer les hooks` si vous souhaitez aussi retirer ses entrées des configurations Claude et Codex. Vous pouvez ensuite désinstaller VSignal normalement depuis le panneau Extensions de VS Code.

## Licence

VSignal est distribué sous [licence MIT](LICENSE) : utilisation, modification et redistribution sont autorisées sous les conditions très permissives de cette licence.
