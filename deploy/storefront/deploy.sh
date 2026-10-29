#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
# Usage: bash deploy.sh /absolute/path/release.env /absolute/path/smoke.curl
# release.env contains image pins/secret directory/network only, never credentials.
[[ $# == 2 && $1 = /* && $2 = /* ]] || { echo 'Two absolute paths required: release.env and private smoke.curl' >&2; exit 2; }
cd -- "$(dirname -- "$0")"
[[ -f $1 && -f $2 ]] || exit 2
exec 9>deploy.lock
flock -n 9 || { echo 'Another deployment is running' >&2; exit 2; }
compose=(docker compose --env-file "$1" -f compose.yaml)
"${compose[@]}" config --quiet
previous=$("${compose[@]}" images -q web)
printf '%s\n' "$previous" > previous-image-id
case "${DEPLOY_PULL:-always}" in
  always) "${compose[@]}" pull web caddy ;;
  never) : ;; # Images were loaded locally by docker load.
  *) echo 'DEPLOY_PULL must be always or never' >&2; exit 2 ;;
esac
# No database service is defined in this project. Never run compose down -v.
"${compose[@]}" up -d --pull never --wait --wait-timeout 180 web caddy
# Authenticated full-page check, using a private curl config (not a password argument).
curl --config "$2" --fail --silent --show-error --max-time 60 \
  https://test.elektro-24.ru/catalog -o /dev/null
code=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 15 https://test.elektro-24.ru/catalog)
[[ $code = 401 ]] || { echo 'Anonymous access must return 401' >&2; exit 1; }
echo 'Deployment and protected catalog verified'
