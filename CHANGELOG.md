# Changelog

Toutes les modifications importantes de VSignal sont documentées ici.

## 1.6.1 — 2026-09-03

- Le titre des popups passe de 16,5 à 21 px, le sous-titre de 11,5 à 12,5. La pastille du modèle et son logo grandissent en proportion pour ne pas paraître rabougris à côté.

## 1.6.0 — 2026-09-03

- Les deux quotas sont relus **toutes les minutes** quand le panneau est ouvert, Codex compris. Les deux lectures partent ensemble et ne sont publiées qu’une fois toutes deux revenues.
- L’affichage ne bouge plus pendant une lecture. Le panneau reconstruisait son DOM à chaque cycle, ce qui faisait repartir les barres de zéro ; il ne rebâtit désormais que si la structure change, et corrige sinon les valeurs sur place. Vérifié : hauteur de la carte identique avant, pendant et après un cycle.
- Plus de squelette de chargement une fois les premières valeurs connues.

## 1.5.2 — 2026-09-03

- La cadence de surveillance des alertes devient réglable par `vsignal.alert.intervalMinutes`, de 1 à 60 minutes, et s’applique que le panneau soit ouvert ou fermé. L’écart de charge entre cinq et quinze minutes s’étant révélé négligeable à la mesure — 2,3 minutes de processeur par jour — l’adaptation automatique introduite en 1.5.1 n’avait plus de justification.

## 1.5.1 — 2026-09-03

- La surveillance des alertes s’adapte : toutes les cinq minutes quand le panneau est ouvert, puisque les quotas y sont déjà relus en continu, et toutes les quinze minutes une fois le panneau fermé, où chaque tour démarre un `codex app-server` pour un événement qui survient quelques fois par jour.

## 1.5.0 — 2026-09-03

- Actualisation nettement plus soutenue, et à cadence adaptée au coût de chaque source : Claude toutes les 30 s panneau ouvert, Codex au plus toutes les 3 minutes puisque sa lecture démarre un `app-server`.
- Deux déclencheurs s’ajoutent à l’horloge : toute modification de `~/.claude.json` et le retour du focus sur la fenêtre VS Code, l’un comme l’autre limités à une lecture toutes les 20 s.
- La surveillance des alertes passe de quinze à cinq minutes.
- Une ligne `Actualisé il y a…` sous les quotas rend l’actualisation vérifiable au lieu d’être à croire sur parole.
- Le fournisseur s’affiche sur une pastille à ses couleurs — corail pour Claude, noir pour Codex, comme leurs marques — au lieu d’un point de sept pixels. Les points disparaissent aussi des réglages, dont les libellés nomment déjà le modèle.
- La popup n’affiche plus le titre « Quota consommé » : les barres se suffisent.
- L’interrupteur général s’appelle simplement `Notifications`.

## 1.4.1 — 2026-09-03

- Suppression de l’action dans la barre de titre de la vue : elle n’ajoutait rien, `Configurer / réparer les hooks` restant disponible dans « Actions » et dans la palette de commandes.
- L’interrupteur général s’appelle `Activer les notifications` plutôt que `Popups`, qui ne disait pas ce qu’il faisait.

## 1.4.0 — 2026-09-03

- Les quotas ne sont plus une section repliable : ils occupent le haut du panneau, sans titre, et ne peuvent plus être masqués. C’est la raison d’être du panneau.
- Le bouton d’actualisation se pose dans le coin haut droit de la carte des quotas.
- L’interrupteur général quitte le haut du panneau pour un sous-groupe « Général » sous « Paramètres » : on l’ouvre rarement, et il n’apprend rien tant que tout va bien. La pastille « Actif / En pause » de l’en-tête continue d’indiquer l’état.

## 1.3.1 — 2026-09-03

- Le délai avant réinitialisation ne disparaît plus en colonne étroite : il se condense en `27 min` puis en `27 m` plutôt que d’être masqué.
- Les sections du panneau se replient d’un clic, l’état étant mémorisé : on peut ne garder que les quotas visibles tout en gardant les réglages accessibles.
- Le bouton d’actualisation quitte la barre de titre de la vue pour l’en-tête « Quotas consommés », et tourne pendant la lecture.
- Les réglages d’alerte sont regroupés par modèle, ce qui raccourcit les libellés et évite leur troncature en colonne étroite.

## 1.3.0 — 2026-09-03

- Les popups s’affichent dans le coin **haut droit** et entrent par la droite.
- Code couleur revu : la **marque** du modèle identifie l’émetteur, la **couleur** ne dit plus que la gravité. Un quota confortable s’affichait dans l’orange de Claude et se lisait comme une alerte ; il est désormais vert.
- Les popups portent les logos officiels Claude et Codex, dessinés en vectoriel.
- Nouvelle alerte de **remise à zéro** : une popup verte prévient quand une fenêtre de quota repart de zéro.
- Les alertes couvrent maintenant les deux fenêtres, `5 h` et `7 j`, et s’activent modèle par modèle. Les réglages `vsignal.weeklyAlert.*` sont remplacés par `vsignal.alert.*`.
- Panneau : l’interrupteur principal tient sur une ligne, et les réglages sont réunis dans une seule section « Paramètres ».
- Panneau : les quotas restent lisibles en colonne étroite, le pourcentage ne disparaissant jamais au profit du libellé de réinitialisation.

## 1.2.0 — 2026-09-03

- Nouvelle alerte : une popup prévient quand le quota hebdomadaire de Claude ou de Codex franchit le seuil, `90 %` consommé par défaut. Elle ne se répète pas tant que le quota reste haut et se réarme après la réinitialisation de la fenêtre.
- Correction : les boutons « Tester » pouvaient rester sans effet et sans message. `powershell.exe` était lancé via le `PATH`, que l’hôte d’extensions ne fournit pas toujours, et l’événement `error` du processus n’était écouté nulle part. Le chemin absolu est désormais utilisé et tout échec est signalé.
- Le panneau relit les quotas toutes les cinq minutes tant qu’il est visible ; la surveillance hebdomadaire tourne toutes les quinze minutes, même panneau fermé.
- Correction : l’ajout du paramètre `-Detail` masquait la variable locale du sous-titre, PowerShell ne distinguant pas la casse des noms de variables, ce qui empêchait toute popup de s’afficher.

## 1.1.2 — 2026-09-03

- Correction majeure : les quotas Claude étaient figés. Ils venaient d’un cache alimenté par le hook `statusLine`, qui ne s’exécute jamais dans l’extension VS Code — les chiffres affichés dataient de la dernière session en terminal. VSignal lit désormais `~/.claude.json`, que Claude Code tient à jour lui-même.
- Ce fichier ne peut pas être parsé en entier par PowerShell 5.1 (des chemins de projet n’y diffèrent que par la casse, ce qui déclenche une erreur de clés en double) : seul le bloc `cachedUsageUtilization` est extrait.
- Les barres affichent maintenant le quota **consommé** et non le restant, comme `/usage` de Claude Code. Les seuils de couleur suivent : orange à partir de 60 %, rouge à partir de 80 %.
- Correction du champ `utilization`, qui est déjà un pourcentage et était multiplié par cent.
- La section « Intégrations » disparaît du panneau : `autoConfigure` réparant les hooks à chaque démarrage, elle restait verte en permanence. Le diagnostic reste disponible via `VSignal: Afficher l’état`.

## 1.1.1 — 2026-09-03

- Correction : le panneau annonçait « Claude : à configurer » alors que le hook était bien installé. La détection lisait le texte brut de `settings.json`, où les antislashs des chemins Windows sont échappés, et ne pouvait donc jamais correspondre.
- La présence du hook Codex est désormais jugée sur la ligne `notify` active plutôt que sur le fichier entier.

## 1.1.0 — 2026-09-02

- Popup redessinée : pastille d’état colorée, titre et sous-titre séparés, quotas alignés en grille et ligne de vie indiquant le temps restant.
- Survol de la popup pour suspendre sa fermeture, clic pour la fermer tout de suite.
- Panneau VS Code reconstruit en vue web : interrupteur général, état des intégrations, quotas des deux modèles et actions groupées.
- Quatre réglages pour choisir les fenêtres de quota affichées dans les popups, indépendamment du panneau.

## 1.0.0 — 2026-09-02

- Première version publique.
- Popups Windows pour les fins de tâche Claude et Codex.
- Détection des questions, blocages, modifications de code et tests validés.
- Affichage des quotas et des délais de réinitialisation.
- Panneau VS Code pour configurer, tester, activer ou désactiver VSignal.
