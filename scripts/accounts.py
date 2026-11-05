"""Create locally encrypted disposable test accounts without printing secret material."""
import json
import os
import pathlib
import secrets
import subprocess

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
accounts = {}
for name in ['operator', 'treasury', 'buyer-a', 'buyer-b']:
    path = directory / name
    if not path.exists():
        subprocess.run([str(root / '.tools/cast'), 'wallet', 'new', str(directory), name],
                       env=dict(os.environ, CAST_PASSWORD=password.read_text()), check=True, capture_output=True)
    os.chmod(path, 0o600)
    accounts[name] = subprocess.check_output([str(root / '.tools/cast'), 'wallet', 'address', '--keystore', str(path),
                                            '--password-file', str(password)], text=True).strip()
result = {'network': 'Sepolia controlled test fixtures', 'accounts': accounts}
(root / 'deployments/accounts.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(accounts, indent=2))
