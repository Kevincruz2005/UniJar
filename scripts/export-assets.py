"""Export only runtime ABIs, licenses and a validated public deployment manifest."""
import json
import pathlib
import shutil
import sys

root = pathlib.Path(__file__).resolve().parent.parent
public = root / 'backend/public'
public.mkdir(exist_ok=True)
for name, path in {
    'UniJar': 'contracts/out/UniJar.sol/UniJar.json',
    'IERC20': 'contracts/out/UniJar.sol/IERC20.json',
    'TokenJar': 'contracts/out/TokenJar.sol/TokenJar.json',
}.items():
    artifact = json.loads((root / path).read_text())
    (public / f'{name}.json').write_text(json.dumps(artifact['abi'], separators=(',', ':')))
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
print('Exported runtime assets (not tracked)')
