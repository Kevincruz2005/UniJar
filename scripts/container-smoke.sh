#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -z "${DOCKER_HOST:-}" && -S /run/user/1000/unijar-docker.sock ]]; then export DOCKER_HOST=unix:///run/user/1000/unijar-docker.sock; fi
docker info >/dev/null
container_rpc=http://127.0.0.1:18545
api_url=http://127.0.0.1:8080
if [[ "${DOCKER_HOST:-}" == *unijar-docker* ]]; then container_rpc=http://10.0.2.2:18545; api_url=http://127.0.0.1:18080; fi
# Dependency layers may be cached; package locks and source/public inputs determine the image.
docker build --network host -f backend/Dockerfile -t unijar:local .
docker run -d --rm --name unijar-local-smoke --network host -e NODE_ENV=test -e EXPECTED_CHAIN_ID=31337 -e "RPC_URL=$container_rpc" unijar:local >/dev/null
trap 'docker stop unijar-local-smoke >/dev/null 2>&1 || true' EXIT
wait_ready() {
  for attempt in $(seq 1 60); do
    if curl -fsS --max-time 5 "$api_url/readyz" >/dev/null; then return; fi
    sleep 1
  done
  echo 'Container readiness failed' >&2; return 1
}
wait_ready
test "$(docker exec unijar-local-smoke id -u)" = 1000
docker exec unijar-local-smoke sh -c 'test ! -e /app/.git && test ! -e /app/.deps && test ! -e /app/.local && test ! -e /app/src && test ! -e /app/node_modules/typescript'
CHAIN_ID=31337 API_URL="$api_url" backend/node_modules/.bin/tsx backend/tools/smoke.ts
curl -fsS "$api_url/v1/inventory" > .local/container-before.json
docker restart unijar-local-smoke >/dev/null
wait_ready
curl -fsS "$api_url/v1/inventory" > .local/container-after.json
python3 - <<'PY'
import json,pathlib
before=json.loads(pathlib.Path('.local/container-before.json').read_text())
after=json.loads(pathlib.Path('.local/container-after.json').read_text())
assert before['data']==after['data']
PY
docker stop unijar-local-smoke >/dev/null
if docker run --rm --network host -e EXPECTED_CHAIN_ID=1 -e "RPC_URL=$container_rpc" unijar:local > .local/wrong-chain.log 2>&1; then
  echo 'Wrong-chain configuration unexpectedly started' >&2; exit 1
fi
docker image inspect unijar:local --format '{{.Id}}' > .local/docker-image-id
python3 - <<'PYREPORT'
import json,pathlib,subprocess,datetime
root=pathlib.Path('.')
flow=json.loads((root/'.local/local-smoke.json').read_text())
native=json.loads((root/'.local/native-smoke.json').read_text())
assert flow['apiSourceCommit']==native['apiSourceCommit']
report={'sourceCommit':flow['apiSourceCommit'],'verificationSourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'imageId':(root/'.local/docker-image-id').read_text().strip(),'chainId':31337,'status':'passed','timestamp':datetime.datetime.now(datetime.timezone.utc).isoformat()}
(root/'.local/container-validation.json').write_text(json.dumps(report,indent=2)+'\n')
PYREPORT
printf 'Clean image build, non-root isolation, transactions, restart persistence and wrong-chain rejection passed.\n'
