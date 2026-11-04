#!/bin/bash
set -euo pipefail
umask 077
base=/home/shopadmin/elektrikamarket-prodat
fixture=elektrikamarket-prodat-rehearsal-20261104t185439z
out="$base/rehearsal-final-20261104"
mkdir -p "$out/config" "$out/prodat-state" "$out/pricat-state/ftp"
docker exec "$fixture" createdb -U fixture_admin prodat_rehearsal_final
docker exec -i "$fixture" pg_restore -U fixture_admin -d prodat_rehearsal_final --no-owner --no-acl --exit-on-error --single-transaction < "$base/rehearsal-20261104T185439Z/database.dump"
printf '%s\n' 'postgres://fixture_admin@127.0.0.1:5432/prodat_rehearsal_final' > "$out/config/database_url"
cp /home/shopadmin/elektrikamarket-pricat/state/ftp/state.json "$out/pricat-state/ftp/state.json"
chmod 600 "$out/config/database_url" "$out/pricat-state/ftp/state.json"
source /home/shopadmin/elektrikamarket-pricat/runtime.env
source_dir=$(cat "$base/research/tver-latest-path")
docker run --rm --init --name elektrikamarket-prodat-rehearsal-final --network "container:$fixture" \
 --user 1001:1001 --memory 2g --cpus 1.5 --pids-limit 128 --read-only --cap-drop ALL --security-opt no-new-privileges \
 --tmpfs /tmp:rw,size=1g,uid=1001,gid=1001 -e PRODAT_REHEARSAL_DATABASE=prodat_rehearsal_final --entrypoint node \
 --mount "type=bind,source=$out/config,target=/run/config,readonly" \
 --mount "type=bind,source=$out/prodat-state,target=/prodat-state" \
 --mount "type=bind,source=$out/pricat-state,target=/state" \
 --mount "type=bind,source=/home/shopadmin/elektrikamarket-pricat/state/ftp/versions,target=/state/ftp/versions,readonly" \
 --mount "type=bind,source=$source_dir,target=/source,readonly" \
 --mount "type=bind,source=$base/build-preparation/scripts/prodat-update/rehearse.cjs,target=/work/scripts/prodat-update/rehearse.cjs,readonly" \
 elektrikamarket-prodat-update:tests-preparation scripts/prodat-update/rehearse.cjs > "$out/publication.ndjson" 2>&1
