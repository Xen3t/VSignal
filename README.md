# VSignal

[Français](README.md) · [English](README.en.md)

> Les modèles répondent. VSignal vous prévient.

VSignal affiche une popup Windows discrète lorsqu’une tâche Claude ou Codex se termine dans VS Code. La notification reste indépendante du Centre de notifications Windows, s’adapte au résultat de la tâche et peut afficher les quotas restants avec leur délai de réinitialisation.

[![Licence MIT](https://img.shields.io/badge/licence-MIT-green.svg)](LICENSE)
![Windows 11](https://img.shields.io/badge/Windows-11-0078D4.svg)
![VS Code](https://img.shields.io/badge/VS%20Code-1.85%2B-23A8F2.svg)

## Fonctionnalités

- Popup WPF toujours visible, dans le coin haut droit de l’écran : marque du modèle, titre, sous-titre explicatif et ligne de vie indiquant le temps restant avant fermeture.
- Le survol met la fermeture en pause et la relance à zéro ; un clic ferme la popup immédiatement.
- **La marque dit le modèle, la couleur dit la gravité.** Le logo Claude ou Codex identifie l’émetteur ; le vert, l’orange et le rouge sont réservés à l’état du quota, jamais à l’identité.
- Message adapté à la situation : tâche terminée, question, blocage, code modifié ou tests validés.
- Barres de quota `5 h` et `7 j` en pourcentage **consommé**, comme `/usage` de Claude Code : vert tant qu’il reste de la marge, orange à partir de 60 %, rouge à partir de 80 %.
- Indicateur compact `+N%` à droite de la popup pour le coût en quota `5 h` de la tâche terminée, désactivable séparément pour Claude et Codex.
- Panneau VS Code dédié : les quotas des deux modèles en permanence sous les yeux, le reste replié d’un clic.
- Alertes automatiques quand une fenêtre de quota devient basse **ou** repart à zéro, activables modèle par modèle.
- Configuration automatique à chaque démarrage de VS Code, quel que soit le projet ouvert.
- Aucun serveur VSignal, aucune télémétrie et aucune notification Windows native.
- Interface et popups disponibles en français et en anglais, avec détection automatique de la langue de VS Code.

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

- **Les quotas** occupent le haut du panneau, sans titre ni repli : les fenêtres `5 h` et `7 j` des deux modèles y sont toujours affichées en entier, chacune sous une pastille aux couleurs de son fournisseur. Le bouton d’actualisation se tient dans leur coin haut droit et tourne pendant la lecture.
- **Paramètres** — langue `Automatique / Français / English`, `Notifications`, contenu des popups et alertes modèle par modèle.
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
- `VSignal: Afficher l’état`
- `VSignal: Retirer les hooks`

### Quand les quotas sont-ils actualisés ?

Tant que VS Code est ouvert, VSignal relit **Claude et Codex toutes les minutes**, que le panneau soit ouvert ou fermé. Les deux lectures partent ensemble et ne sont publiées qu’une fois toutes deux revenues, si bien que le panneau et les alertes partagent toujours le même relevé.

S’y ajoutent, limités à une lecture toutes les 20 s : toute modification de `~/.claude.json`, surveillée par sondage de son horodatage pour résister aux écritures par fichier temporaire suivies d’un renommage, et le retour du focus sur la fenêtre VS Code. Le bouton d’actualisation force une relecture immédiate.

Rien ne bouge pendant une lecture : les valeurs affichées restent les dernières connues, le DOM n’est pas reconstruit, et seules les valeurs changées sont corrigées sur place. Les barres glissent vers leur nouvelle longueur au lieu de repartir de zéro. La ligne `Actualisé il y a…` indique l’âge réel de la donnée la plus ancienne affichée, et non l’heure à laquelle VSignal a relu le cache.

Le snapshot d’usage écrit par Claude Code peut avoir quelques minutes de retard. Si Claude consigne entre-temps un refus pour quota atteint, VSignal recoupe ce journal local avec le snapshot et affiche immédiatement 100 % pour la fenêtre concernée, sans lire les identifiants du compte.

Une lecture Codex démarre un `codex app-server`, soit environ 0,7 s de processeur : à raison d’une par minute, comptez près d’un quart d’heure de processeur par jour lorsque VS Code reste ouvert toute la journée.

### Alertes de quota

VSignal surveille les deux fenêtres, `5 h` et `7 j`, pour chaque modèle, et signale deux moments :

- **Quota bas** — la fenêtre franchit le seuil de consommation. Popup rouge rappelant ce qu’il reste.
- **Remise à zéro** — la fenêtre repart de zéro. Popup verte : le modèle est de nouveau disponible.

Les deux se déclenchent sur **transition**, jamais en continu : l’alerte de quota bas ne se répète pas tant que le quota reste haut, et redémarrer VS Code ne provoque aucune volée de notifications.

| Réglage | Rôle |
| --- | --- |
| `vsignal.alert.lowQuota.claude` | Prévenir quand une fenêtre Claude devient basse |
| `vsignal.alert.lowQuota.codex` | Prévenir quand une fenêtre Codex devient basse |
| `vsignal.alert.reset.claude` | Prévenir quand une fenêtre Claude repart à zéro |
| `vsignal.alert.reset.codex` | Prévenir quand une fenêtre Codex repart à zéro |
| `vsignal.alert.threshold` | Pourcentage consommé déclencheur, `90` par défaut, soit 10 % restants |

Ces alertes ignorent les quatre réglages ci-dessous : la barre concernée est toujours affichée, puisque c’est l’objet même de la notification.

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
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\resources\agent-done.ps1 -Agent Codex -State Tested
```

## Script facultatif pour deux écrans

Le script facultatif [ShortcutsAddict.ahk](Script_Hotkey/ShortcutsAddict.ahk) associe la touche située sous `Échap` (`²` en AZERTY, `` ` `` en QWERTY) à l’échange des deux fenêtres au premier plan entre les deux écrans, et transforme `Verr. Maj` en touche de raccourcis pour lancer des applications ou piloter le son et la lecture. Il est totalement indépendant de VSignal, n’est pas inclus dans le VSIX et demande uniquement [AutoHotkey v2](https://www.autohotkey.com/) ; la liste complète des raccourcis est dans [SHORTCUTS.md](Script_Hotkey/SHORTCUTS.md).

## Fichiers et confidentialité

VSignal peut créer ou mettre à jour les fichiers suivants :

- `%USERPROFILE%\.vsignal\agent-done.ps1`
- `%USERPROFILE%\.vsignal\claude-quota.json`
- `%USERPROFILE%\.claude\settings.json`
- `%USERPROFILE%\.codex\config.toml`

Une sauvegarde `.before-vsignal.bak` est créée avant la première modification d’une configuration existante. Les messages sont analysés en mémoire afin de choisir le libellé de la popup, mais ils ne sont ni enregistrés ni envoyés par VSignal ; consultez [SECURITY.md](SECURITY.md) pour le détail.

## Désinstallation

Avant de désinstaller l’extension, lancez `VSignal: Retirer les hooks` si vous souhaitez aussi retirer ses entrées des configurations Claude et Codex. Vous pouvez ensuite désinstaller VSignal normalement depuis le panneau Extensions de VS Code.

## Marques

Les logos Claude et Codex affichés dans les popups servent à identifier le modèle à l’origine de la notification. Ils appartiennent respectivement à Anthropic et à OpenAI, ne sont pas couverts par la licence MIT de VSignal, et leur présence ne vaut ni affiliation ni approbation.

## Licence

VSignal est distribué sous [licence MIT](LICENSE) : utilisation, modification et redistribution sont autorisées sous les conditions très permissives de cette licence.
