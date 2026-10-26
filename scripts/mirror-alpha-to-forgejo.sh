#!/usr/bin/env bash
set -euo pipefail
# UN SEUL miroir AlphaTerminal Github -> Forgejo. Aucun autre dépôt touché.
: "${FORGEJO_URL:?Indiquer l'URL de Forgejo}"
: "${FORGEJO_USER:?Indiquer le compte Forgejo}"
: "${FORGEJO_TOKEN:?Exporter le jeton API Forgejo (ne pas l'écrire dans le dépôt)}"
case "$FORGEJO_URL" in
  https://*|http://localhost*|http://127.0.0.1*) ;;
  http://nas-damien*|http://100.*)
    [[ "${FORGEJO_ALLOW_TAILNET_HTTP:-0}" = 1 ]] || { echo 'Forgejo HTTP via Tailscale : confirmer avec FORGEJO_ALLOW_TAILNET_HTTP=1 ou activer HTTPS';exit 1; };;
  *) echo 'Refus : URL Forgejo sans HTTPS et hors du NAS Tailscale connu.'; exit 1;;
esac
[[ "$FORGEJO_USER" =~ ^[a-zA-Z0-9._-]+$ ]] || { echo 'Compte Forgejo non valide';exit 1; }
command -v curl >/dev/null
command -v python3 >/dev/null
base="${FORGEJO_URL%/}"
repo_url="$base/api/v1/repos/$FORGEJO_USER/AlphaTerminal"
# Authentification fournie par stdin, non sur la ligne de commande curl.
code=$(curl -sS -o /dev/null -w '%{http_code}' --config - <<CONFIG
url = "$repo_url"
header = "Authorization: token $FORGEJO_TOKEN"
CONFIG
)
case "$code" in
  404) ;;
  200) echo 'Refus : dépôt AlphaTerminal déjà présent dans Forgejo. Aucun écrasement.'; exit 2;;
  *) echo "Erreur API Forgejo HTTP $code. Aucun dépôt créé."; exit 3;;
esac
payload=$(python3 - <<'PY'
import json,os
print(json.dumps({'clone_addr':'https://github.com/sicho95/AlphaTerminal.git',
 'repo_owner':os.environ['FORGEJO_USER'],'repo_name':'AlphaTerminal','service':'git',
 'mirror':True,'private':True,'mirror_interval':'10m',
 'description':'Miroir GitHub AlphaTerminal uniquement, lecture seule'}))
PY
)
echo "Miroir ciblé $FORGEJO_USER/AlphaTerminal vers GitHub sicho95/AlphaTerminal."
if [[ "${AT_DRY_RUN:-0}" = 1 ]]; then echo 'AT_DRY_RUN=1 : pas de création'; exit 0; fi
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
chmod 600 "$tmp"
printf '%s' "$payload" > "$tmp"
curl -sS --fail-with-body --config - --data-binary "@$tmp" <<CONFIG
url = "$base/api/v1/repos/migrate"
request = "POST"
header = "Authorization: token $FORGEJO_TOKEN"
header = "Content-Type: application/json"
CONFIG
printf '\nMiroir créé (en attente de synchronisation initiale) : %s/%s/AlphaTerminal\n' "$base" "$FORGEJO_USER"
