# AlphaTerminal 1.1.0 — Version de développement (non déployée)

Basée sur AlphaTerminal 1.0.0, issue du projet AlphaTerminal 0.9.9.

### Nouveau
- Worker NAS Python 3.12 + FastAPI + SQLite WAL, conteneur unique `worker/`.
- Profils isolés, appairage d'autres appareils par code 6 chiffres à durée limitée validé sur un appareil reconnu.
- Synchronisation opt-in des paramètres et positions ; historique de versions par type de données, gestion de conflits, fonctionnement local maintenu.
- Surveillance de stops au NAS, Web Push ciblés par appareil, réarmement et déduplication.
- Actualités ciblées par portefeuille : OKSURF, Yahoo Search, GDELT, Café de la Bourse, AMF, BCE ; filtrage et impact thématique sur titres et ETF.
- Liens vers les sources depuis le centre de notifications ; préparation Web Push NAS.
- Retrait des écrans de configuration Marketaux/Finnhub, sans suppression des autres paramètres personnels.

### Compatibilité
- Même URL GitHub Pages `/AlphaTerminal/index.html`, mêmes clés localStorage et schéma `2` ; SW `alphaterminal-v20` (v19 pour la 1.0.0).
- Aucune connexion NAS nécessaire si le mode dynamique n'est pas activé ; fonctionnement local conservé.
- La synchro transporte les structures de portefeuilles **sans les historiques de cotations temporaires**.

### Tests et réserves
- Tests unitaires Python et Node locaux effectués ; pas de tests réels QNAP/Safari Web Push ni de connexion à l'API publique dans cet environnement.
- Publication GitHub, déploiement NAS, appairage multi-appareils réel et validation de non-régression en production non effectués.
- Voir `docs/architecture-worker-sync-news-v1.1.md` et `worker/README.md`.


### Miroir Forgejo et déploiement NAS (préparation)

Scripts `scripts/mirror-alpha-to-forgejo.sh` (miroir mono-dépôt sans écrasement) et `worker/deploy/deploy-from-forgejo.sh` (deploy `worker/` sur `main`, volume externe persistant, healthcheck et tentative de rollback). Procédure dans `docs/forgejo-tailscale-cicd.md`. Non exécutés sur le NAS ni activés en production.
