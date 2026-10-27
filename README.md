> **Attention :** le dépôt officiel en production reste en v1.0.0 tant que la v1.1.0 n'a pas été déployée et testée sur NAS + iPhone. Les sources de ce lot sont une version candidate, pas une publication validée.

# AlphaTerminal v1.1.0 — code de développement (production actuelle 1.0.0)

Application PWA « local-first » de pilotage patrimonial, issue **directement de la v0.9.9** retrouvée le 26 octobre 2026.

## Déploiement canonique et données iPhone

- Dépôt cible : `sicho95/AlphaTerminal`, **branche `main`**, GitHub Pages à partir de `/`.
- URL *inchangée* : `https://sicho95.github.io/AlphaTerminal/index.html`.
- `manifest.json` conserve `start_url: "./index.html"` et le Service Worker reste au même emplacement `./sw.js` (scope `/AlphaTerminal/`).
- Clés `localStorage` **inchangées** : `alphaTerm_data`, `alphaTerm_portfolios`, `alphaTerm_alerts`, `alphaTerm_settings`, `alphaTerm_selectedScope`, `alphaTerm_orderBasket`.
- Sauvegarder/exporter les données depuis **Paramètres** de la PWA 0.9.9 *avant* la mise en production. Ne pas supprimer l'icône iOS ni vider les données du site.
- Les nouvelles clés (`alphaTerm_alertStates`, IndexedDB `AlphaTerminalPushV1`) servent uniquement au suivi des alertes, jamais aux positions.

## Améliorations v1.0.0

- Moteur de franchissements : stop atteint et stop proche de 3 % activés par défaut, performance +12 % et RSI extrême en opt-in.
- Contrôle anti-doublons par position + type, réarmement seulement après retour hors seuil ; jamais d'évaluation sur cotations marquées en erreur.
- Conservation de l'historique de notifications interne et de son bouton d'effacement.
- Permission de notification système demandée uniquement par clic dans Paramètres. `showNotification()` via le Service Worker si autorisé.
- Réception `push`/`notificationclick` prévue pour les notifications distantes et stockage IndexedDB en attente de réinjection vers le centre interne lors de la réouverture.
- L'application vérifie à nouveau la fraîcheur des cotations lors d'un retour au premier plan. La fréquence normale reste paramétrable (10 minutes par défaut).
- Aucune conversion serveur du portefeuille et aucun changement de l'interface des cinq pages.

## Production actuelle 1.0.0 et évolution candidate 1.1.0

**En production, AlphaTerminal 1.0.0 reste local et ne dispose pas du backend NAS.** Cette nouvelle archive candidate 1.1.0 fournit le worker NAS et l'interface de synchronisation, mais **aucune surveillance distante ne sera active tant que le conteneur, son HTTPS et les abonnements Push n'auront pas été effectivement déployés et vérifiés.** Ne considérer aucun stop boursier comme un ordre de vente ou une protection garantie.

Les cours via Yahoo/Cloudflare peuvent être différés, partiels ou erronés. **Une alerte ne passe aucun ordre chez le courtier.** Les sources macro et cours nécessitent la connexion internet. Sur iOS, le JavaScript d'une PWA fermée n'exécute pas la boucle d'actualisation.

## Sécurité

- Ce dépôt de livraison ne contient **ni l'historique Git ancien** ni l'exemple officiel d'import réel `examples/alphaterminal-official-import-2026-06-08.json`.
- `examples/alphaterminal-sample-import.json` est entièrement fictif.
- Ne jamais importer sur GitHub les sauvegardes de portefeuilles réels ni l'ancien `.git` : l'historique ancien contient des informations sensibles.
- Vérifier qu'aucune clé API personnelle ou jeton n'est inséré dans des fichiers de publication.

## Test local

```sh
python3 -m http.server 8080
```

Puis ouvrir `http://localhost:8080/AlphaTerminal-v1.0.0/` si le serveur est démarré dans son dossier parent, ou `http://localhost:8080/` s'il est démarré dans le dossier de l'application. Installer en contexte sécurisé pour tester les Service Workers (`localhost` ou HTTPS).

## Worker NAS et synchronisation v1.1.0 (expérimental)

Le dossier [`worker/`](worker/README.md) contient l'API Python/FastAPI + SQLite, Docker Compose, l'appairage sécurisé par appareil, la synchronisation incrémentale avec gestion de conflits, le moteur de stops et news, les abonnements Web Push.

Consulter [`docs/architecture-worker-sync-news-v1.1.md`](docs/architecture-worker-sync-news-v1.1.md) pour les choix et limites et [`RELEASE_NOTES_v1.1.0.md`](RELEASE_NOTES_v1.1.0.md) pour les nouveautés.

**Ne pas publier ni activer la surveillance NAS sans sauvegarde JSON des portefeuilles et validation du reverse proxy HTTPS.**

Pour le déploiement sur QNAP, voir [`docs/nas-qnap-deploiement-v1.1.md`](docs/nas-qnap-deploiement-v1.1.md).


## Forgejo, NAS et HTTPS Tailscale

Voir [`docs/forgejo-tailscale-cicd.md`](docs/forgejo-tailscale-cicd.md) : miroir **uniquement AlphaTerminal**, déploiement incrémental Docker avec volume SQLite/VAPID persistant, et HTTPS Tailscale Serve sans effacer les routes d’autres services.
