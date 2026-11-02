#!/bin/bash
set -Eeuo pipefail
umask 077
[[ $# = 1 && "$1" =~ ^(check|publish|status)$ ]] || exit 2
[[ "$PRICAT_IMAGE" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 2
[[ "$PRICAT_NETWORK" =~ ^[a-zA-Z0-9_.-]+$ ]] || exit 2
runtime=/etc/elektrikamarket-pricat/runtime
state=/var/lib/elektrikamarket-pricat/state
lock=/var/lib/elektrikamarket-pricat/update.lock
if [[ -n "${PRICAT_BASE_DIRECTORY:-}" ]]; then
 [[ "$PRICAT_BASE_DIRECTORY" = /home/shopadmin/elektrikamarket-pricat ]] || exit 2
 runtime="$PRICAT_BASE_DIRECTORY/runtime"
 state="$PRICAT_BASE_DIRECTORY/state"
 lock="$PRICAT_BASE_DIRECTORY/update.lock"
fi
if [[ "$1" = status ]]; then
 exec /usr/bin/docker run --rm --pull never --user 1001:1001 --read-only \
  --cap-drop ALL --security-opt no-new-privileges --network none --pids-limit 64 --memory 256m \
  --mount "type=bind,source=$runtime,target=/run/config,readonly" \
  --mount "type=bind,source=$state,target=/state,readonly" \
  --entrypoint node "$PRICAT_IMAGE" scripts/pricat-update/status.cjs --config /run/config/config.json
fi
exec 9>"$lock"
flock -n 9
# A fixed Docker name + host flock exclude every supported updater invocation.
# Empty stale directory locks can then be released after a host crash. Never
# remove uncertain-publication markers or retained input/report data.
if /usr/bin/docker container inspect elektrikamarket-pricat-update >/dev/null 2>&1; then exit 75; fi
[[ ! -e "$state/needs-review.json" && ! -e "$state/ftp/needs-review.json" ]] || exit 75
for stale in "$state/run.lock" "$state/ftp/sync.lock"; do
 if [[ -d "$stale" ]]; then rmdir -- "$stale"; fi
done
exec /usr/bin/docker run --rm --init --name elektrikamarket-pricat-update --pull never --user 1001:1001 --read-only \
 --cap-drop ALL --security-opt no-new-privileges \
 --network "$PRICAT_NETWORK" --cpus 1.5 --memory 2g --pids-limit 128 \
 --tmpfs /tmp:rw,nosuid,noexec,size=32m,uid=1001,gid=1001 \
 --env TMPDIR=/state/tmp \
 --mount "type=bind,source=$runtime,target=/run/config,readonly" \
 --mount "type=bind,source=$state,target=/state" \
 "$PRICAT_IMAGE" --config /run/config/config.json --mode "$1"
