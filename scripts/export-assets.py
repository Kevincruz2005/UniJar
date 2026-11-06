"""Export only runtime ABIs, licenses and a validated public deployment manifest."""
import json
import pathlib
import shutil
import sys
import subprocess

root = pathlib.Path(__file__).resolve().parent.parent
public = root / 'backend/public'
public.mkdir(exist_ok=True)
for name, path in {
    'UniJar': 'contracts/out/UniJar.sol/UniJar.json',
    'IERC20': 'contracts/out/FixtureToken.sol/FixtureToken.json',
    'TokenJar': 'contracts/out/TokenJar.sol/TokenJar.json',
    'CRESettlementReceiver': 'cre-contracts/out/CRESettlementReceiver.sol/CRESettlementReceiver.json',
    'ReceiptRegistry': 'fee-contracts/out/ReceiptRegistry.sol/ReceiptRegistry.json',
}.items():
    artifact = json.loads((root / path).read_text())
    abi = artifact['abi']
    if name == 'IERC20':
        abi = [item for item in abi if item.get('type') == 'function' and item.get('name') in ['approve', 'balanceOf', 'allowance', 'transfer', 'transferFrom', 'name', 'symbol', 'decimals']]
    (public / f'{name}.json').write_text(json.dumps(abi, separators=(',', ':')))
notices = public / 'licenses'
notices.mkdir(exist_ok=True)
shutil.copy(root / 'LICENSE', notices / 'UniJar-AGPL-3.0.txt')
for name in ['tjar', 'v3-core', 'v3-periphery', 'forge-std']:
    dependency = root / '.deps' / name
    for path in dependency.glob('*LICENSE*'):
        if path.is_file(): shutil.copy(path, notices / f'{name}-{path.name}')
if len(sys.argv) > 1:
    source = pathlib.Path(sys.argv[1])
    if not source.is_file(): raise SystemExit('A real deployment manifest is required')
    shutil.copy(source, public / 'manifest.json')
cre_manifest = root / ('deployments/cre-local.json' if len(sys.argv) > 1 and pathlib.Path(sys.argv[1]).name == 'local.json' else 'deployments/cre-sepolia.json')
if cre_manifest.is_file(): shutil.copy(cre_manifest, public / 'cre-manifest.json')
elif (public / 'cre-manifest.json').exists(): (public / 'cre-manifest.json').unlink()
(public / 'build.json').write_text(json.dumps({'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()}))
print('Exported runtime assets (not tracked)')
