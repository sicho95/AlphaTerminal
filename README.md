# AlphaTerminal

PWA mobile-first de suivi multi-portefeuilles, deployable sur GitHub Pages sans build step.

## Principes

- Donnees locales uniquement: LocalStorage + cache service worker.
- Demarrage vide: aucun portefeuille de demo n'est injecte automatiquement.
- Import/export JSON complet pour sauvegarde iCloud ou migration vers un autre appareil.
- Hierarchie de selection: Tous > Proprietaire > Portefeuille.
- Configuration dans l'app: fournisseur de cours, proxy CORS, plafond PEA, profil, multiplicateurs ATR14.

## Donnees de marche

Fournisseur prioritaire configurable:

- Twelve Data via `time_series` avec cle API stockee localement dans les settings.
- Fallback Yahoo Finance via proxy CORS.
- Proxy par defaut: `https://proxy.sicho95.workers.dev?url=`.

La cle API n'est pas commitee dans le depot public. Elle peut etre saisie dans `Inventaire > Configuration` ou importee via un JSON prive.

## Stops ATR

Le stop suggere est calcule avec:

```text
stop = dernier cours - ATR14 x multiplicateur
```

Multiplicateurs par defaut:

- Prudent: 2x
- Equilibre: 3x
- Dynamique: 3x
- Offensif: 4x
- DCA: 3x

Chaque position peut aussi definir un override.

## Import de test

Un fichier de test est fourni:

```text
examples/alphaterminal-sample-import.json
```

Depuis l'app: `Inventaire > Importer`.

## Structure

```text
/
├── index.html
├── 404.html
├── manifest.json
├── sw.js
├── icons/
├── css/app.css
├── js/
├── pages/
└── examples/
```

## Dev local

```bash
python3 -m http.server 8080
```

Puis ouvrir `http://localhost:8080`.
