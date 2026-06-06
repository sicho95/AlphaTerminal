# AlphaTerminal — Pilotage Patrimonial PWA

AlphaTerminal est une application web progressive (PWA) de gestion de portefeuille financier, conçue pour être installable, rapide et centrée sur la visualisation de données.

## Fonctionnalités
- **Dashboard Global** : Vue d'ensemble multi-comptes (PEA, CTO) avec agrégation en temps réel.
- **Analyse & Profil** : Calcul de score de cohérence par rapport à votre profil investisseur (Prudent, Équilibré, Dynamique, Offensif).
- **Signaux Techniques** : RSI, MACD et alertes sur stops suiveurs calculés localement.
- **Gestion d'Inventaire** : Suivi détaillé des positions, filtres avancés et historique des versements.
- **Mode Sombre** : Support natif avec persistance.
- **Offline Capable** : Fonctionne sans réseau grâce aux Service Workers et LocalStorage.

## Tech Stack
- **Vanilla JS (ES6+)** : Pas de framework lourd pour une performance maximale.
- **Tailwind CSS** : Design system moderne via CDN.
- **Chart.js** : Visualisations interactives.
- **Yahoo Finance API** : Récupération des cours via proxy AllOrigins.
- **PWA** : Manifest JSON et Service Worker pour installation mobile/desktop.

## Déploiement
L'application est optimisée pour **GitHub Pages**.

1. Clonez le dépôt :
   ```bash
   git clone https://github.com/sicho96/AlphaTerminal.git
   ```
2. Activez GitHub Pages dans les paramètres du repo (Source : `main` branch, `/root`).
3. Accédez à `https://sicho96.github.io/AlphaTerminal/`.

## Architecture des fichiers
- `index.html` : Coquille SPA et navigation.
- `js/` : Logique métier (store, data, charts, notifications, app).
- `pages/` : Fragments HTML des différentes vues.
- `css/` : Styles personnalisés.
- `sw.js` : Service Worker pour le cache.

## Licence
MIT
