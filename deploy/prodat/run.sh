#!/bin/bash
set -euo pipefail
umask 077
base=/home/shopadmin/elektrikamarket-prodat
[[ $# = 1 && "$1" =~ ^(check|status|publish)$ ]] || exit 2
source "$base/runtime.env"
[[ "$PRODAT_IMAGE" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 2
mode="$1"
if [[ "$mode" != status ]]; then
 exec 9>"$base/check.lock"
 flock -n 9 || exit 75
fi
mounts=()
network=(--network bridge)
state_mode=
if [[ "$mode" = status ]]; then state_mode=,readonly; network=(--network none); fi
if [[ "$mode" = publish ]]; then
 python3 - "$base/runtime/config.json" <<'PY'
import json,sys
if json.load(open(sys.argv[1])).get('publicationEnabled') is not True:
 print('PUBLICATION_DISABLED', file=sys.stderr)
 sys.exit(78)
PY
 # Same flock as the unchanged PRICAT scheduler; held across the entire chain.
 exec 8>/home/shopadmin/elektrikamarket-pricat/update.lock
 flock -n 8 || exit 75
 [[ -n "${PRODAT_DATABASE_NETWORK:-}" ]] || exit 78
 network=(--network "$PRODAT_DATABASE_NETWORK")
 mounts+=(--mount "type=bind,source=$base/runtime/database_url,target=/run/config/database_url,readonly")
 mounts+=(--mount "type=bind,source=/home/shopadmin/elektrikamarket-pricat/state,target=/pricat-state")
fi
if [[ "$mode" != status && -d "$base/state/source.lock" ]]; then
 echo SOURCE_CHECK_LOCKED >&2; exit 75
fi
if [[ -f "$base/runtime/bootstrap-path" ]]; then
 read -r bootstrap <"$base/runtime/bootstrap-path"
 [[ "$bootstrap" = "$base/research/"* && -d "$bootstrap" ]] || exit 78
 mounts+=(--mount "type=bind,source=$bootstrap,target=/bootstrap,readonly")
fi
exec docker run --rm --init --name "elektrikamarket-prodat-$mode" --pull never \
 --user 1001:1001 --read-only --cap-drop ALL --security-opt no-new-privileges \
 --cpus 1.5 --memory 2g --pids-limit 128 "${network[@]}" \
 --tmpfs /tmp:rw,nosuid,noexec,size=1g,uid=1001,gid=1001 \
 --mount "type=bind,source=$base/runtime/config.json,target=/run/config.json,readonly" \
 --mount "type=bind,source=$base/runtime/ftp-credentials.json,target=/run/ftp/credentials.json,readonly" \
 --mount "type=bind,source=$base/state,target=/prodat-state$state_mode" \
 "${mounts[@]}" "$PRODAT_IMAGE" --config /run/config.json --mode "$mode"
