"""Create locally encrypted disposable test accounts without printing secret material."""
import json
import os
import pathlib
import secrets
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parent.parent
os.chdir(root)
directory = root / '.local/keystores'
directory.mkdir(parents=True, exist_ok=True)
os.chmod(directory.parent, 0o700)
os.chmod(directory, 0o700)
password = root / '.local/account-password'
if not password.exists():
    fd = os.open(password, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as file:
        file.write(secrets.token_urlsafe(48))
local = '--local' in sys.argv
accounts = {}
for name in ['operator', 'treasury', 'buyer-a', 'buyer-b']:
    alias = f'local-{name}' if local else name
    path = directory / alias
    if not path.exists():
        subprocess.run([str(root / '.tools/cast'), 'wallet', 'new', str(directory), alias],
                       env=dict(os.environ, CAST_PASSWORD=password.read_text()), check=True, capture_output=True)
    os.chmod(path, 0o600)
    accounts[name] = subprocess.check_output([str(root / '.tools/cast'), 'wallet', 'address', '--keystore', str(path),
                                            '--password-file', str(password)], text=True).strip()
result = {'network': 'Anvil controlled test fixtures' if local else 'Sepolia controlled test fixtures', 'accounts': accounts}
output = root / ('.local/local-accounts.json' if local else 'deployments/accounts.json')
output.write_text(json.dumps(result, indent=2) + '\n')
rpc = root / '.local/sepolia.env'
if not rpc.exists():
    descriptor = os.open(rpc, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, 'w') as file:
        file.write('# Sepolia endpoint; never commit this file.\nSEPOLIA_RPC_URL=\n')
print(json.dumps(accounts, indent=2))
