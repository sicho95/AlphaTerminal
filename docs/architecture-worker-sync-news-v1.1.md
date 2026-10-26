# ADR-AT-2026-10-26 — AlphaTerminal Worker, synchronisation et news

**État : implémenté localement, tests initiaux validés, déploiement non validé.**

## Intentions

Rester sur AlphaTerminal 0.9.9 → 1.0.0 comme interface officielle ; une seule PWA `sicho95/AlphaTerminal` (ne pas ressusciter AlphaTerminal2). Ajouter des profils par personne et appareils : Damien, Jean peuvent détenir des listes distinctes ; les mêmes titres ont des seuils distincts. Permettre modification depuis iPhone et récupération sur Mac, et inversement, sans abandonner le hors-ligne.

## Analyse du socle avant modification

`js/data.js` v1.0.0 possède déjà `fetchMacroNews`, `fetchMacroFeeds`, des règles de thème/sentiment/impact (`MACRO_TOPICS`, `MACRO_SENTIMENT_RULES`), `fetchPositionNews` et un cache `alphaTerm_macroCache`. La conservation de cette voie est volontaire : **la PWA reste autonome**. La partie serveur ajoute le rapprochement événement ↔ titres/ISIN/ETF du profil, et l'envoi d'alertes pendant la fermeture de la PWA. Pas de LLM ni de scraping Boursorama.

## Architecture

- **Frontend** : vanilla JS, GitHub Pages `/AlphaTerminal/`, service worker `alphaterminal-v20`, `js/sync-client.js` et `js/sync-ui.js`. Clés `alphaTerm_data`, `alphaTerm_settings`, `alphaTerm_alerts`, `alphaTerm_portfolios` conservées. Jeton par installation dans `alphaTerm_workerSession` local et jamais transmis à d'autres appareils.
- **Backend** : un conteneur Python 3.12/FastAPI, SQLite WAL, un processus Uvicorn ; endpoints REST HTTPS derrière proxy. Seuls les profils autorisés ont accès aux données ; code administrateur de création fourni par variable d'environnement ; appairage avec code court + secret de claim, validation sur ancien appareil.
- **Sync** : patch par clé de paramètres, versionnement et CAS pour données de portefeuille ; file de changements persistée localement ; conflit explicite (choisir NAS/appareil). Les champs de cours/indicateurs temporaires ne sont pas propagés afin de réduire le trafic. Les autres appareils tirent les versions à l'ouverture, au retour au premier plan et toutes les 60 s lorsqu'ils sont actifs. Sur iOS l'application suspendue ne peut garantir les sync périodiques.
- **Alerts** : collecte Yahoo mutualisée par cycle, alertes de franchissement/proximité de stops avec anti-doublons et réarmement ; Web Push VAPID par appareil, centre interne alimenté par les événements serveur et la boîte IndexedDB SW.
- **News** : OKSURF + Yahoo Search (ciblé, opportuniste) + GDELT DOC + RSS Café de la Bourse/AMF/BCE. Classement conservateur : correspondance exacte entreprise/ISIN/ticker, ou thème macro croisé avec champ `sector` d'un ETF ; priorité critique/important, pas de Push pour simple cooccurrence sans lien. Dédoublonnage URL par profil ; référence silencieuse au premier balayage ; liens sources préservés.

## Décisions et raisons

1. **Python plutôt que Node.js** : serveur réseau léger sans duplication de toute la logique financière ; un seul processus et SQLite embarqué, pas de Redis/PostgreSQL.
2. **Compte logique / profil ≠ appareil ≠ abonnement Push** : plusieurs appareils par profil, chacun peut être révoqué ; données isolées entre profils.
3. **Local-first** : toute sauvegarde sur l'appareil s'effectue avant synchronisation ; le NAS ne réinitialise pas les données si non joignable ; une première restauration nécessite consentement explicite.
4. **Déconnexion / conflits** : le journal des changements local n'est pas effacé avant acquittement serveur ; opérations concurrentes refusées lorsque mêmes données ont changé, sans écrasement silencieux.
5. **Sources sans clés** : suppression de Marketaux/Finnhub/TwelveData des interfaces et de la config active. Yahoo Finance reste non officiel et peut être indisponible ; sources news publiques prioritaires et liens directs.
6. **Sécurité** : URL worker HTTPS, CORS restreint à l'origine PWA, jetons hachés au NAS, codes éphémères, endpoint Push limité aux domaines Apple/Google/Mozilla, données privées uniquement dans volume NAS (et navigateur), jamais GitHub.
7. **Pas de transfert d'ordres** ; chaque alerte est une aide indicative, jamais un déclencheur de trading.

## Limites / recette restant à faire

Vérifier lancement sur TS-253B (RAM ~4 Go), reverse proxy HTTPS, CORS, Safari iOS Home Screen, abonnements VAPID, déduplication, réveils, cache SW, changement simultané iPhone/Mac et restauration en situation réelle. Mesurer les APIs d'actualité et corriger leurs formats éventuels ; vérifier les limites et droits des sources. Sauvegarder DB + clés VAPID avec les snapshots NAS. La v1.1.0 de développement ne doit pas remplacer la 1.0.0 fonctionnelle avant ces essais.

## Tests disponibles

Python : profils, appairage, ACL, synchronisation/révisions CAS, filtrage des news, seuils de stops ; Node : non-régression stockage et moteur d'alertes PWA ; JavaScript syntax check. Tests réels réseau et iOS restent non exécutés.
