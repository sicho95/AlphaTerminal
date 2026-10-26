#!/bin/sh
# Git CLI éphémère pour QNAP sans git natif. Ne change ni QTS, ni Forgejo.
set -eu
: "${AT_DEPLOY_HOME:?AT_DEPLOY_HOME manquant}"
ROOT="${AT_DEPLOY_HOME%/}"
[ -d "$ROOT" ] || { echo "Répertoire AlphaTerminal introuvable: $ROOT" >&2;exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Docker introuvable" >&2;exit 1; }
IMG="${AT_GIT_IMAGE:-alpine/git:2.49.1}"
if [ -d "$ROOT/config/git-ssh" ]; then
  exec docker run --rm --network host \
    --mount "type=bind,src=$ROOT,dst=$ROOT" \
    --mount "type=bind,src=$ROOT/config/git-ssh,dst=/root/.ssh,readonly" \
    --workdir "$ROOT" "$IMG" "$@"
fi
exec docker run --rm --network host \
  --mount "type=bind,src=$ROOT,dst=$ROOT" \
  --workdir "$ROOT" "$IMG" "$@"
