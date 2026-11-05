"""Install the selected upstream release, verifying its published SHA256."""
import hashlib
import io
import json
import pathlib
import platform
import subprocess
import tarfile
import urllib.request

destination = pathlib.Path('.tools')
destination.mkdir(exist_ok=True)
if (destination / 'forge').exists():
    import subprocess
    if '1.9.0' in subprocess.check_output([str(destination.resolve() / 'forge'), '--version'], text=True):
        raise SystemExit(0)
arch = {'x86_64': 'amd64', 'aarch64': 'arm64'}[platform.machine()]
name = f'foundry_v1.9.0_linux_{arch}.tar.gz'
with urllib.request.urlopen('https://api.github.com/repos/foundry-rs/foundry/releases/tags/v1.9.0', timeout=30) as r:
    release = json.load(r)
asset = next(x for x in release['assets'] if x['name'] == name)
cached = destination / 'foundry.tar.gz'
if not cached.exists():
    subprocess.run(['curl', '-fL', '--connect-timeout', '15', '--max-time', '180', '--retry', '2', asset['browser_download_url'], '-o', str(cached)], check=True)
data = cached.read_bytes()
digest = asset.get('digest')
if not digest or digest != 'sha256:' + hashlib.sha256(data).hexdigest():
    raise SystemExit('Missing or mismatched upstream SHA256')
with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
    archive.extractall(destination, filter='data')
print(f'Installed {name}; {digest}')
