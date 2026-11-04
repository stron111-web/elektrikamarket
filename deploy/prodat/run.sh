#!/bin/bash
set -euo pipefail
umask 077
base=/home/shopadmin/elektrikamarket-prodat
[[ $# = 1 && "$1" =~ ^(check|status)$ ]] || exit 2
# This release has NO publication command and receives NO database credential.
source "$base/runtime.env"
[[ "$PRODAT_IMAGE" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 2
state_mode=
if [[ "$1" = status ]]; then state_mode=,readonly; fi
exec 9>"$base/check.lock"
flock -n 9
if [[ "$1" = check && -d "$base/state/check.lock" ]]; then
 if docker container inspect elektrikamarket-prodat-check >/dev/null 2>&1; then exit 75; fi
 # Only an empty lock can be released, never journals or uncertain publications.
 rmdir -- "$base/state/check.lock"
fi
exec docker run --rm --init --name elektrikamarket-prodat-check --pull never \
 --user 1001:1001 --read-only --cap-drop ALL --security-opt no-new-privileges \
 --cpus 0.5 --memory 384m --pids-limit 64 \
 --tmpfs /tmp:rw,nosuid,noexec,size=16m,uid=1001,gid=1001 \
 --mount "type=bind,source=$base/runtime/config.json,target=/run/config.json,readonly" \
 --mount "type=bind,source=$base/runtime/ftp-credentials.json,target=/run/ftp/credentials.json,readonly" \
 --mount "type=bind,source=$base/state,target=/state$state_mode" \
 "$PRODAT_IMAGE" --config /run/config.json --mode "$1"
