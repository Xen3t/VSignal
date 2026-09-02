# Changelog

Toutes les modifications importantes de VSignal sont documentées ici.

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
