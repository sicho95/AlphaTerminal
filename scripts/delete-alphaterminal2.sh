#!/usr/bin/env bash
# Destructive step, strictly separated from publication and never run automatically.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v gh >/dev/null || { echo 'gh absent' >&2; exit 1; }
gh auth status >/dev/null
SITE='https://sicho95.github.io/AlphaTerminal'
if ! curl --fail --silent --show-error "$SITE/js/store.js" | grep -q "APP_VERSION = '1.0.0'"; then
  echo 'ARRÊT : la v1.0.0 ne semble pas servie sur GitHub Pages.' >&2
  exit 1
fi
if ! curl --fail --silent --show-error "$SITE/sw.js" | grep -q "alphaterminal-v19"; then
  echo 'ARRÊT : le nouveau Service Worker ne semble pas publié.' >&2
  exit 1
fi
gh repo view sicho95/AlphaTerminal >/dev/null
gh repo view sicho95/AlphaTerminal2 >/dev/null
backup="$HOME/Documents/AlphaTerminal2-ARCHIVE-$(date +%Y%m%d-%H%M%S).git"
echo 'Sauvegarde miroir (y compris historique) d’AlphaTerminal2 :'
git clone --mirror https://github.com/sicho95/AlphaTerminal2.git "$backup"
[[ -f "$backup/HEAD" ]] || { echo 'Sauvegarde miroir incomplète' >&2; exit 1; }
cat <<'EOF'

ATTENTION : suppression définitive du dépôt GitHub sicho95/AlphaTerminal2.
Vérifie manuellement au préalable :
 - AlphaTerminal v1.0.0 fonctionne sur GitHub Pages ;
 - ta PWA iPhone voit la version 1.0.0 ;
 - tes portefeuilles et préférences sont intacts ;
 - tu possèdes un export JSON récent de tes données.
EOF
printf 'Si TOUS ces points sont validés, tape SUPPRIMER AlphaTerminal2 : '
read -r answer
[[ "$answer" == 'SUPPRIMER AlphaTerminal2' ]] || { echo 'Suppression annulée.'; exit 1; }
gh repo delete sicho95/AlphaTerminal2 --yes
printf 'Suppression demandée. Copie de sauvegarde du dépôt : %s\n' "$backup"
