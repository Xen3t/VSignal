# SwitchDualWindow.ahk — script facultatif

Ce script associe la touche située sous `Échap` (`²` en AZERTY, `` ` `` en QWERTY) à l’échange des deux fenêtres au premier plan entre l’écran 1 et l’écran 2, chacune étant redimensionnée à la zone de travail de son nouvel écran puis maximisée, le focus revenant ensuite à la fenêtre qui arrive sur l’écran principal. Il est totalement facultatif, indépendant de VSignal, absent du paquet VSIX, et n’exige qu’[AutoHotkey v2](https://www.autohotkey.com/).

## Utilisation

1. Installez [AutoHotkey v2](https://www.autohotkey.com/).
2. Double-cliquez sur `SwitchDualWindow.ahk` — l’icône verte apparaît dans la zone de notification.
3. Appuyez sur la touche sous `Échap` pour permuter les fenêtres.

Pour le lancer à chaque démarrage de Windows, placez un raccourci vers le script dans
`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`.

## Détails

- Deux écrans minimum sont requis : sinon le script affiche un message et ne fait rien.
- La fenêtre retenue pour chaque écran est la première fenêtre visible dont le centre s’y trouve ; le bureau, les barres des tâches, les fenêtres minimisées et celles de moins de 100 px sont ignorés.
- Pour changer le raccourci, remplacez `SC029` en tête de fichier par la touche voulue, par exemple `F12` ou `#Left` (voir la [documentation des hotkeys](https://www.autohotkey.com/docs/v2/Hotkeys.htm)).

## Licence

MIT, comme le reste du dépôt — voir [LICENSE](../LICENSE).
