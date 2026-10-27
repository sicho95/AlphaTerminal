#!/usr/bin/env bash
set -euo pipefail
# Publication explicite depuis une machine avec git + gh authentifié.
# Ne supprime aucun dépôt, n'altère pas les données de l'iPhone et n'active pas le backend.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
command -v gh >/dev/null || { echo 'Installer GitHub CLI (gh)';exit 1; }
gh auth status >/dev/null
[[ -d .git ]] && { echo 'Ce script attend une copie candidate sans .git. Utiliser un dossier propre.';exit 1; }
[[ ! -e worker/state ]] || { echo 'Ne jamais publier worker/state (DB/VAPID)';exit 1; }
[[ ! -e worker/.env ]] || { echo 'Ne jamais publier worker/.env';exit 1; }
# Exige une confirmation après inspection des fichiers publics.
cat <<'MESSAGE'
ATTENTION : mise à jour potentiellement visible par la PWA existante.
Sauvegarder l'export JSON 1.0.0 de l'iPhone. Effectuer les tests NAS+iOS en staging d'abord.
Les fichiers de production actuels ne sont pas modifiés par ce script sans confirmation.
MESSAGE
read -r -p 'Confirmer la préparation de la branche de validation sur GitHub (taper OUI): ' reply
[[ "$reply" == 'OUI' ]] || exit 1
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
# Clone le dépôt existant, crée une branche dédiée, ne pousse JAMAIS directement main.
gh repo clone sicho95/AlphaTerminal "$TMP/repo"
cd "$TMP/repo"
git checkout -b feature/worker-v1.1.0
# Préserver l'index d'icônes et de fichiers d'une release actuelle si nécessaire.
rsync -a --exclude='.git' --exclude='worker/state' --exclude='worker/.env' --exclude='.DS_Store' "$ROOT/" "$TMP/repo/"
git add -A
git diff --cached --check
git commit -m 'feat: NAS worker, multi-device sync and targeted market news (1.1.0 candidate)'
git push -u origin feature/worker-v1.1.0
printf '\nBranche candidate publiée. Vérifier et ouvrir PR :\n'
gh pr create --base main --head feature/worker-v1.1.0 --title 'AlphaTerminal 1.1.0 — worker NAS (candidate)' --body 'Candidate pour recette NAS/iOS : NE PAS fusionner avant les tests Web Push, sync, sécurité et restauration.' || true
