#!/bin/bash
set -Eeuo pipefail
umask 077
[[ $# = 1 && "$1" =~ ^(check|publish)$ ]] || exit 2
[[ "$PRICAT_IMAGE" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 2
[[ "$PRICAT_NETWORK" =~ ^[a-zA-Z0-9_.-]+$ ]] || exit 2
exec 9>/var/lib/elektrikamarket-pricat/update.lock
flock -n 9
exec /usr/bin/docker run --rm --init --pull never --user 1001:1001 --read-only \
 --cap-drop ALL --security-opt no-new-privileges \
 --network "$PRICAT_NETWORK" --cpus 1.5 --memory 2g --pids-limit 128 \
 --tmpfs /tmp:rw,nosuid,noexec,size=32m,uid=1001,gid=1001 \
 --env TMPDIR=/state/tmp \
 --mount type=bind,source=/etc/elektrikamarket-pricat/runtime,target=/run/config,readonly \
 --mount type=bind,source=/var/lib/elektrikamarket-pricat/state,target=/state \
 "$PRICAT_IMAGE" --config /run/config/config.json --mode "$1"
