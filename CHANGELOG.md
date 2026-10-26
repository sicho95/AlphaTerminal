## [1.1.0] — 2026-10-26 (développement, pas encore publié)
- Worker Python SQLite/FastAPI : profils, appareils, synchronisation bidirectionnelle avec conflits, alertes stops et news filtrées, Web Push VAPID.
- Interface PWA d'appairage, import profil, sync automatique, sans casser les données 1.0.0.
- Retrait des fournisseurs Marketaux et Finnhub avec clé, maintien Yahoo et OKSURF local.
- Documentation d'architecture, déploiement, tests, sécurité.

# Versions

## 1.0.0 — Consolidation préparée, 26 octobre 2026

- Base exacte des sources AlphaTerminal 0.9.9 récupérées sur iMac ; aucune transplantation d'écrans AlphaTerminal2.
- Conservation de la structure de cinq pages, de l'URL d'installation, des clés de stockage et du manifeste PWA.
- Arrêt des permissions de notifications demandées au démarrage, préférences explicites dans Paramètres.
- Détection et anti-doublons des seuils de stops et performances / RSI facultatifs, seulement après un rafraîchissement effectif des cours.
- Service Worker prêt à réceptionner le futur Web Push NAS et ouvrir le centre de notifications avec événement ciblé.
- Migration d'un message SW vers l'historique local via IndexedDB et identifiant unique.
- Reprise de la vérification de fraîcheur des cours après retour de l'app au premier plan.
- Retrait de l'exemple de portefeuille réel et de l'ancien historique Git du paquet publiable.

### Validation

- Vérification de syntaxe JavaScript statique, y compris modules intégrés dans les pages : OK.
- Tests unitaires du moteur d'alertes et du modèle de stockage local : OK.
- Tests de bout en bout navigateur, déploiement GitHub Pages et test iPhone réels : **non réalisés**.
- Web Push distant impossible avant implémentation NAS / VAPID / abonnements.
- AlphaTerminal2 non supprimé à la livraison du paquet : suppression seulement après déploiement et contrôle sur l'iPhone.


### Préparation déploiement Forgejo / QNAP (non activée)
- Miroir GitHub → Forgejo limité à **AlphaTerminal**, avec refus si le dépôt Forgejo cible existe déjà.
- Déploiement par tâche NAS dédiée, limité à `worker/` depuis `main` et à un unique projet Compose `alphaterminal`; sauvegardes de profils, SQLite et clés Web Push hors du dépôt.
- Documentation Tailscale Serve HTTPS sur port libre, sans modifier les routes des autres conteneurs.
