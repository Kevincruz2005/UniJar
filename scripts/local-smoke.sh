#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/accounts.py --local
mkdir -p .local
if curl -fsS --max-time 1 http://127.0.0.1:18545 >/dev/null 2>&1; then echo 'Port 18545 is already in use; refusing to replace an existing chain' >&2; exit 1; fi
.tools/anvil --accounts 0 --host 127.0.0.1 --port 18545 --chain-id 31337 --hardfork cancun --silent > .local/anvil.log 2>&1 &
anvil_pid=$!
trap 'kill "$anvil_pid" 2>/dev/null || true' EXIT
for attempt in $(seq 1 40); do
  if .tools/cast chain-id --rpc-url http://127.0.0.1:18545 >/dev/null 2>&1; then break; fi
  sleep 0.25
done
python3 - <<'PY'
import json,urllib.request,pathlib
for account in json.loads(pathlib.Path('.local/local-accounts.json').read_text())['accounts'].values():
 data=json.dumps({'jsonrpc':'2.0','id':1,'method':'anvil_setBalance','params':[account,hex(100*10**18)]}).encode()
 with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:18545',data,{'Content-Type':'application/json'}),timeout=3) as r:
  result=json.load(r)
  if 'error' in result:raise RuntimeError('Local funding failed')
PY
rm -f .local/local.pending.json deployments/local.json
CHAIN_ID=31337 backend/node_modules/.bin/tsx backend/tools/deploy.ts
python3 scripts/export-assets.py deployments/local.json
CHAIN_ID=31337 backend/node_modules/.bin/tsx backend/tools/smoke.ts
if [[ "${LOCAL_CONTAINER:-0}" == 1 ]]; then bash scripts/container-smoke.sh; fi
