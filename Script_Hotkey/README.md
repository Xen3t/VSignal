# ShortcutsAddict.ahk — script facultatif

Ce script associe la touche située sous `Échap` (`²` en AZERTY, `` ` `` en QWERTY) à l’échange des deux fenêtres au premier plan entre l’écran 1 et l’écran 2, et transforme `Verr. Maj` en touche de raccourcis pour lancer des applications ou piloter le son et la lecture. Il est totalement facultatif, indépendant de VSignal, absent du paquet VSIX, et n’exige qu’[AutoHotkey v2](https://www.autohotkey.com/).

La liste complète des raccourcis se trouve dans [SHORTCUTS.md](SHORTCUTS.md).

## Utilisation

1. Installez [AutoHotkey v2](https://www.autohotkey.com/).
2. Double-cliquez sur `ShortcutsAddict.ahk` — l’icône verte apparaît dans la zone de notification.
3. Appuyez sur la touche sous `Échap` pour permuter les fenêtres.

Pour le lancer à chaque démarrage de Windows, placez le fichier dans le dossier de démarrage :
`Win + R`, puis `shell:startup`.

## Détails

- Deux écrans minimum sont requis : sinon le script affiche un message et ne fait rien.
- La fenêtre retenue pour chaque écran est la première fenêtre visible dont le centre s’y trouve ; le bureau, les barres des tâches, les fenêtres minimisées et celles de moins de 100 px sont ignorés.
- Un double appui rapide sur `²` active ou coupe la gestion automatique de la vidéo, qui met en pause le média quittant l’écran principal et relance celui qui y arrive. Une voix annonce l’état.
- `Verr. Maj` ne verrouille plus les majuscules : la touche ne sert plus que de modificateur. Utilisez `Maj` pour les capitales.
- Pour changer le raccourci de permutation, remplacez `SC029` en tête de fichier par la touche voulue (voir la [documentation des hotkeys](https://www.autohotkey.com/docs/v2/Hotkeys.htm)).

## Licence

MIT, comme le reste du dépôt — voir [LICENSE](../LICENSE).
