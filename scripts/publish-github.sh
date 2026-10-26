#!/usr/bin/env bash
# Only publishes the sanitised v1.0.0 tree with a FRESH Git history.
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v gh >/dev/null 2>&1; then
  echo 'GitHub CLI absent. Installer via "brew install gh" puis "gh auth login".' >&2
  exit 1
fi
gh auth status >/dev/null
if [[ -d .git ]]; then
  echo 'ABANDON : un .git est déjà présent. Éviter de publier un ancien historique.' >&2
  exit 1
fi
if [[ -e examples/alphaterminal-official-import-2026-06-08.json ]]; then
  echo 'ABANDON : exemple contenant potentiellement des données réelles.' >&2
  exit 1
fi
if gh repo view sicho95/AlphaTerminal >/dev/null 2>&1; then
  echo 'ABANDON : le dépôt AlphaTerminal existe déjà. Aucune réécriture sans contrôle.' >&2
  exit 1
fi
if ! grep -q "APP_VERSION = '1.0.0'" js/store.js; then
  echo 'ABANDON : source différente de la v1.0.0.' >&2
  exit 1
fi
printf 'Le dépôt PUBLIC sicho95/AlphaTerminal sera créé depuis ce dossier.\nConfirmer en saisissant PUBLIER : '
read -r confirmation
[[ "$confirmation" == 'PUBLIER' ]] || { echo 'Annulé.'; exit 1; }
git init -b main
git add .
git commit -m 'AlphaTerminal v1.0.0: restaurer 0.9.9, consolider alertes et préparer Web Push'
gh repo create sicho95/AlphaTerminal --public --source=. --remote=origin --push
printf '{"build_type":"legacy","source":{"branch":"main","path":"/"}}' | gh api --method POST repos/sicho95/AlphaTerminal/pages --input - || {
  echo 'Dépôt créé, mais configuration Pages à vérifier manuellement dans Settings > Pages.' >&2
  exit 1
}
gh api repos/sicho95/AlphaTerminal/pages --jq '{site: .html_url, source: .source, status: .status}'
echo 'Site attendu : https://sicho95.github.io/AlphaTerminal/index.html'
echo 'Vérifier le site, la PWA installée et les données sur iPhone AVANT de supprimer AlphaTerminal2.'
