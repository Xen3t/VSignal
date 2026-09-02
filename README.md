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
- Barres de quota `5 h` et `7 j` avec pourcentage consommé et temps avant réinitialisation, comme `/usage` de Claude Code : la barre se remplit et passe à l’orange puis au rouge à mesure que la limite approche.
- Panneau VS Code dédié : interrupteur général, quotas des deux modèles et choix des quotas affichés dans les popups.
- Alerte automatique quand le quota hebdomadaire de Claude ou de Codex devient bas, une seule fois par fenêtre.
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
- **Quotas consommés** — les fenêtres `5 h` et `7 j` des deux modèles, toujours affichées ici en entier.
- **Alerte** — la popup de fin de quota hebdomadaire, à activer ou couper.
- **Quotas affichés dans les popups** — quatre interrupteurs indépendants pour choisir ce qui apparaît dans la popup.
- **Actions** — tester chaque modèle, actualiser les quotas, réparer ou retirer les hooks.

Les hooks étant réinstallés et réparés à chaque démarrage de VS Code, le panneau ne consacre pas de place à leur état. Pour le vérifier ponctuellement, `VSignal: Afficher l’état` récapitule le script, les hooks Claude et le hook Codex.

Les mêmes actions restent disponibles dans la palette de commandes :

- `VSignal: Activer / désactiver`
- `VSignal: Actualiser les quotas`
- `VSignal: Configurer Claude et Codex`
- `VSignal: Tester Claude`
- `VSignal: Tester Codex`
- `VSignal: Afficher l’état`
- `VSignal: Retirer les hooks`

### Quand les quotas sont-ils actualisés ?

Les quotas Claude viennent de `~/.claude.json`, que Claude Code met à jour de son côté ; ceux de Codex sont demandés à `codex app-server`. VSignal les relit :

- à l’ouverture du panneau ;
- toutes les cinq minutes tant que le panneau reste visible ;
- sur `Actualiser les quotas`, dans le panneau ou dans la barre de titre de la vue ;
- juste avant chaque popup, pour que les barres qu’elle affiche soient à jour.

Le panneau fermé, rien n’est relu : seule la surveillance du quota hebdomadaire continue, toutes les quinze minutes.

### Alerte de quota hebdomadaire

Quand la fenêtre `7 j` de Claude ou de Codex dépasse le seuil, VSignal affiche une popup rouge rappelant ce qu’il reste. Elle ne se déclenche qu’au **franchissement** du seuil : elle ne se répète pas tant que le quota reste haut, et se réarme d’elle-même après la réinitialisation de la fenêtre.

| Réglage | Rôle |
| --- | --- |
| `vsignal.weeklyAlert.enabled` | Active ou coupe l’alerte |
| `vsignal.weeklyAlert.threshold` | Pourcentage consommé déclencheur, `90` par défaut, soit 10 % restants |

Cette alerte ignore les quatre réglages ci-dessous : la barre concernée est toujours affichée, puisque c’est l’objet même de la notification.

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
