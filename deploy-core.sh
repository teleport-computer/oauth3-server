#!/usr/bin/env bash
# Redeploy the prod oauth3 CORE with the local server/ tree, preserving the live manifest
# (env, env_passthrough, egress, volumes — everything) and swapping ONLY the code.
#
# The core's code lives under server/ and the daemon expects the entry file (handler.ts) at the
# tarball root, so the payload is `tar -C server .`. (A git-ref swap instead 500s with
# "Module not found files/handler.ts" because it clones the repo root, which has no handler.ts.)
#
#   bash deploy-core.sh
set -euo pipefail

CVM="${CVM:-https://pod.dstack.soc1024.com}"
ENVF="${ENVF:-$HOME/projects/hermes-agent/deploy-notes/.env.hermes-prod}"
DIR="$(cd "$(dirname "$0")" && pwd)"

T=$(grep -m1 '^TEE_DAEMON_TOKEN=' "$ENVF" | cut -d= -f2-)
: "${T:?no TEE_DAEMON_TOKEN in $ENVF}"

echo "· packing server/ (entry at root) …"
TG=$(mktemp --suffix=.tgz)
tar czf "$TG" -C "$DIR/server" .

echo "· preserving the live manifest (secrets stay in place) …"
M=$(curl -sf "$CVM/_api/projects" -H "Authorization: Bearer $T" \
  | jq -c '.[]|select(.name=="oauth3")|del(.container_id,.image_digest,.deployed_at,.commit_sha,.tree_hash)')
: "${M:?could not read current oauth3 manifest}"

echo "· deploying …"
RESP=$(mktemp)
CODE=$(curl -s -o "$RESP" -w '%{http_code}' -X POST "$CVM/_api/projects" \
  -H "Authorization: Bearer $T" \
  -F "manifest=$M;type=application/json" -F "files=@$TG")

if [[ "$CODE" != 200 && "$CODE" != 201 && "$CODE" != 202 ]]; then
  echo "✗ deploy failed (HTTP $CODE):"
  jq -c '{error,message}' "$RESP" 2>/dev/null || head -c 500 "$RESP"; echo
  rm -f "$TG" "$RESP"; exit 1
fi

echo -n "✓ deployed: "; jq -c '{name,ref,mode,tree:.tree_hash}' "$RESP" 2>/dev/null || cat "$RESP"
rm -f "$TG" "$RESP"
echo "  wait ~30s for restart, then reload the app and click Connect."
