#!/bin/bash
set -Eeuo pipefail
umask 077
base=/home/shopadmin/elektrikamarket-pricat
[[ $# = 1 && "$1" =~ ^(publish|check|status)$ ]] || exit 2
[[ -f "$base/runtime.env" && ! -L "$base/runtime.env" ]] || exit 2
# This file contains only the owner-pinned immutable image ID and network name.
# It must be owned by shopadmin, mode 0600, never writable by previewdeploy.
[[ $(stat -c '%u:%a' "$base/runtime.env") = 1001:600 ]] || exit 2
source "$base/runtime.env"
export PRICAT_IMAGE PRICAT_NETWORK
export PRICAT_BASE_DIRECTORY="$base"
exec "$base/run-update.sh" "$1"
