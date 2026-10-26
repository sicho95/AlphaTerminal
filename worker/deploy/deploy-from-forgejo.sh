#!/usr/bin/env bash
set -euo pipefail
# Cible UNIQUE: alphaterminal-worker. Nécessite git, curl, Docker Compose.
# Exécuter sur l'hôte NAS après configuration de AT_DEPLOY_HOME/AT_FORGEJO_GIT_URL.
: "${AT_DEPLOY_HOME:?Indiquer le chemin absolu du dossier AlphaTerminal sur le NAS}"
: "${AT_FORGEJO_GIT_URL:?Indiquer URL clone AlphaTerminal sur Forgejo}"
[[ "$AT_DEPLOY_HOME" = /* ]] || { echo 'AT_DEPLOY_HOME doit être un chemin absolu';exit 1; }
[[ "$AT_FORGEJO_GIT_URL" == *AlphaTerminal.git || "$AT_FORGEJO_GIT_URL" == *AlphaTerminal ]] || {
  echo 'Refus : URL Forgejo ne désigne pas un dépôt AlphaTerminal'; exit 1;
}
root="${AT_DEPLOY_HOME%/}"
mkdir -p "$root" "$root/releases" "$root/config" "$root/logs"
lock="$root/.rollout-lock"
mkdir "$lock" 2>/dev/null || { echo 'Un déploiement AlphaTerminal est déjà en cours (ou verrou périmé).';exit 1; }
trap 'rmdir "$lock" 2>/dev/null || :' EXIT
config="$root/config/worker.env"
[[ -f "$config" ]] || { echo "Créer $config à partir de worker/.env.example et protéger avec chmod 600"; exit 1; }
chmod 600 "$config"
set -a
# Seuls les paramètres du fichier administrateur NAS sont chargés.
# NE PAS utiliser de fichier .env issu d'un dépôt non fiable.
# shellcheck disable=SC1090
source "$config"
set +a
: "${AT_HOST_DATA_DIR:?Renseigner AT_HOST_DATA_DIR hors des releases}"
[[ "$AT_HOST_DATA_DIR" = /* ]] || { echo 'AT_HOST_DATA_DIR doit être absolu';exit 1; }
[[ "$AT_HOST_DATA_DIR" != "$root/releases"* ]] || { echo 'Données persistantes interdites dans releases/'; exit 1; }
[[ -d "$AT_HOST_DATA_DIR" ]] || { echo "Créer le dossier de données : $AT_HOST_DATA_DIR, puis chown 10001:10001";exit 1; }
command -v docker >/dev/null;command -v curl >/dev/null;command -v tar >/dev/null
# Sur QNAP, git peut être fourni par un conteneur éphémère Alpine Git, SANS toucher Forgejo.
# Le wrapper root/bin/git reprend les chemins absolus du NAS dans un bind mount Docker.
if ! command -v git >/dev/null 2>&1; then
  [[ -x "$root/bin/git" ]] || { echo "Git absent. Installer le wrapper $root/bin/git depuis worker/deploy/git-docker-shim.sh";exit 1; }
  export PATH="$root/bin:$PATH"
fi
: "${AT_DEPLOY_BRANCH:=main}"
[[ "$AT_DEPLOY_BRANCH" =~ ^[a-zA-Z0-9][a-zA-Z0-9._/-]*$ && "$AT_DEPLOY_BRANCH" != *..* ]] || { echo 'Nom de branche invalide';exit 1; }
bare="$root/source.git"
if [[ ! -d "$bare" ]]; then
  git init --bare -q "$bare"
  git --git-dir="$bare" remote add origin "$AT_FORGEJO_GIT_URL"
else
  origin=$(git --git-dir="$bare" remote get-url origin)
  [[ "$origin" == "$AT_FORGEJO_GIT_URL" ]] || { echo 'Origine Git a changé : refus de déployer';exit 1; }
fi
# Branche main par défaut, candidate SEULEMENT sur demande explicite en exécution manuelle.
git --git-dir="$bare" fetch -q --depth=2 origin "refs/heads/$AT_DEPLOY_BRANCH"
sha=$(git --git-dir="$bare" rev-parse FETCH_HEAD)
tree=$(git --git-dir="$bare" rev-parse "${sha}:worker")
if [[ -f "$root/current-worker.tree" ]] && [[ "$(cat "$root/current-worker.tree")" == "$tree" ]]; then
  if curl -fsS --max-time 3 http://127.0.0.1:${AT_HOST_PORT:-18878}/health | grep -q '"status":"ok"'; then
    echo "AlphaTerminal worker actif et inchangé ($sha) : aucun redéploiement."; exit 0
  fi
  echo "Même version worker, mais healthcheck KO : tentative de réparation si AT_AUTO_DEPLOY=1." >&2
fi
release="$root/releases/$sha"
if [[ ! -d "$release/worker" ]]; then
  mkdir -p "$release"
  git --git-dir="$bare" archive "$sha" worker | tar -x -C "$release"
fi
compose="$release/worker/docker-compose.yml"
[[ -f "$compose" ]] || { echo 'Aucun fichier docker-compose dans le projet';exit 1; }
[[ "${AT_AUTO_DEPLOY:-0}" = 1 ]] || { echo "MODE CONTRÔLE : dépôt et version vérifiés ($sha). Configurer AT_AUTO_DEPLOY=1 pour autoriser le lancement."; exit 0; }
previous=''
[[ -f "$root/current-release" ]] && previous=$(cat "$root/current-release")
run_compose(){ docker compose -p alphaterminal --env-file "$config" -f "$1" "$@"; }
# Projet Compose explicite, distinct de Forgejo et de tous les autres conteneurs.
# Aucun --remove-orphans global, pas de docker system prune.
docker compose -p alphaterminal --env-file "$config" -f "$compose" config >/dev/null
if ! docker compose -p alphaterminal --env-file "$config" -f "$compose" up -d --build --no-deps alphaterminal-worker; then
  echo 'Échec Docker; tentative de restauration de la version précédente.' >&2
  if [[ -n "$previous" && -f "$root/releases/$previous/worker/docker-compose.yml" ]]; then
    docker compose -p alphaterminal --env-file "$config" -f "$root/releases/$previous/worker/docker-compose.yml" up -d --build --no-deps alphaterminal-worker || :
  fi
  exit 1
fi
ok=0
for _ in $(seq 1 20); do
  if curl -fsS --max-time 3 http://127.0.0.1:${AT_HOST_PORT:-18878}/health | grep -q '"status":"ok"'; then ok=1;break;fi
  sleep 2
done
if [[ "$ok" != 1 ]]; then
  echo 'Healthcheck worker KO, tentative de retour arrière.' >&2
  if [[ -n "$previous" && -f "$root/releases/$previous/worker/docker-compose.yml" ]]; then
    docker compose -p alphaterminal --env-file "$config" -f "$root/releases/$previous/worker/docker-compose.yml" up -d --build --no-deps alphaterminal-worker || :
  fi
  exit 1
fi
printf '%s\n' "$sha" > "$root/current-release"
printf '%s\n' "$tree" > "$root/current-worker.tree"
echo "Déploiement AlphaTerminal Worker OK : $sha (branche $AT_DEPLOY_BRANCH) ; SQLite + VAPID restent dans $AT_HOST_DATA_DIR"
