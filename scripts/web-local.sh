#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if .tools/cast chain-id --rpc-url http://127.0.0.1:18545 >/dev/null 2>&1; then
  echo 'Port 18545 is occupied. Stop the existing local chain before starting a fresh browser fixture.' >&2
  exit 1
fi
mkdir -p .local
python3 scripts/accounts.py --local
archive=".local/web-run-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$archive"
for file in .local/local.pending.json .local/fee-source-local.json deployments/local.json; do
  if [[ -f "$file" ]]; then mv "$file" "$archive/$(basename "$file")"; fi
done
.tools/anvil --accounts 0 --host 127.0.0.1 --port 18545 --chain-id 31337 --timestamp "$(($(date +%s) - 1900))" --hardfork cancun --silent > "$archive/anvil.log" 2>&1 &
anvil_pid=$!
api_pid=''
web_pid=''
cleanup() { for pid in "$web_pid" "$api_pid" "$anvil_pid"; do if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; fi; done; }
trap cleanup EXIT
for attempt in $(seq 1 40); do
  if .tools/cast chain-id --rpc-url http://127.0.0.1:18545 >/dev/null 2>&1; then break; fi
  sleep 0.25
done
python3 - <<'PY'
import json,pathlib,urllib.request
for address in json.loads(pathlib.Path('.local/local-accounts.json').read_text())['accounts'].values():
    data=json.dumps({'jsonrpc':'2.0','id':1,'method':'anvil_setBalance','params':[address,hex(100*10**18)]}).encode()
    with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:18545',data,{'Content-Type':'application/json'}),timeout=3) as response:
        assert 'error' not in json.load(response)
PY
CHAIN_ID=31337 backend/node_modules/.bin/tsx backend/tools/deploy.ts
CHAIN_ID=31337 backend/node_modules/.bin/tsx backend/tools/deploy-fee-source.ts
python3 scripts/export-assets.py deployments/local.json
python3 - <<'PY'
import json,time,urllib.request
def request(method,params):
    data=json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':params}).encode()
    with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:18545',data,{'Content-Type':'application/json'}),timeout=3) as response:
        result=json.load(response)
        assert 'error' not in result
        return result['result']
now=int(time.time())
if int(request('eth_getBlockByNumber',['latest',False])['timestamp'],16)<now:
    request('evm_setNextBlockTimestamp',[now])
    request('evm_mine',[])
PY
backend/node_modules/.bin/tsx backend/tools/serve-local.ts &
api_pid=$!
(cd frontend; exec env UNIJAR_MANIFEST=../deployments/local.json API_PROXY_TARGET=http://127.0.0.1:18081 node_modules/.bin/vite --host 0.0.0.0 --mode test --port 5174) &
web_pid=$!
echo 'Anvil-only browser demo: http://localhost:5174. Production builds remain Sepolia-only.'
wait "$web_pid"
