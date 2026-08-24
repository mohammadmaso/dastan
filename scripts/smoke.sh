#!/usr/bin/env bash
# Compose smoke: API + memory sidecar must be healthy.
set -euo pipefail
API="${API_URL:-http://localhost:3001}"
MEM="${MEMORY_URL:-http://localhost:8000}"

echo "GET $API/health"
curl -fsS "$API/health" | tee /tmp/sw-api-health.json
echo
echo "GET $MEM/health"
curl -fsS "$MEM/health" | tee /tmp/sw-mem-health.json
echo

node -e '
const api = JSON.parse(require("fs").readFileSync("/tmp/sw-api-health.json","utf8"));
const mem = JSON.parse(require("fs").readFileSync("/tmp/sw-mem-health.json","utf8"));
if (api.status !== "ok" && api.status !== "degraded") process.exit(1);
if (mem.status !== "ok" && mem.status !== "degraded") process.exit(1);
console.log("smoke ok", { api: api.status, memory: mem.status, indices: mem.indices });
'
