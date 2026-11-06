// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync, cpSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const run = (file: string, args: string[], options: { env?: NodeJS.ProcessEnv; input?: string; timeout?: number } = {}) => execFileSync(file, args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: options.timeout ?? 180000, ...options }).trim();
const az = (args: string[], timeout?: number) => JSON.parse(run('az', [...args, '--only-show-errors', '-o', 'json'], { timeout }) || 'null');
const api = JSON.parse(readFileSync(resolve(root, 'deployments/azure.json'), 'utf8'));
const resourceGroup = api.resourceGroup;
assert.equal(resourceGroup, 'unijar-demo-rg');
const version = run('git', ['rev-parse', 'HEAD']);
run('git', ['diff', '--quiet', 'HEAD']);
assert.equal(run('git', ['ls-files', '--others', '--exclude-standard', '--', 'frontend', 'infra/frontend.bicep']), '', 'Commit frontend source first.');
const validation = JSON.parse(readFileSync(resolve(root, '.local/frontend-local-validation.json'), 'utf8'));
assert.equal(validation.status, 'passed');
run('git', ['diff', '--quiet', validation.sourceCommit, 'HEAD', '--', 'frontend/src', 'frontend/package.json', 'frontend/package-lock.json', 'frontend/server.mjs', 'frontend/Dockerfile']);
assert.equal(az(['account', 'show']).id, api.subscription);
const existing = az(['containerapp', 'show', '--name', 'unijar-api', '--resource-group', resourceGroup]);
const registry = existing.properties.configuration.registries[0].server.split('.')[0];
const dockerEnv = { ...process.env, DOCKER_HOST: process.env.DOCKER_HOST ?? (existsSync('/run/user/1000/unijar-docker.sock') ? 'unix:///run/user/1000/unijar-docker.sock' : undefined) };
const tag = `${registry}.azurecr.io/unijar-web:${version}`;
console.log('Building the tested Sepolia frontend container.');
run('npm', ['--prefix', 'frontend', 'run', 'build'], { env: { ...process.env, VITE_API_URL: api.url }, timeout: 180000 });
const context = mkdtempSync(resolve(root, '.local/frontend-context-'));
try {
  mkdirSync(resolve(context, 'frontend')); mkdirSync(resolve(context, 'deployments'));
  for (const name of ['dist', 'server.mjs', 'Dockerfile']) cpSync(resolve(root, 'frontend', name), resolve(context, 'frontend', name), { recursive: true });
  cpSync(resolve(root, 'frontend/Dockerfile.dockerignore'), resolve(context, '.dockerignore'));
  cpSync(resolve(root, 'deployments/sepolia.json'), resolve(context, 'deployments/sepolia.json'));
  run('docker', ['build', '--network', 'host', '-f', resolve(context, 'frontend/Dockerfile'), '--build-arg', `API_URL=${api.url}`, '--build-arg', `SOURCE_COMMIT=${version}`, '-t', tag, context], { env: dockerEnv, timeout: 900000 });
} finally { rmSync(context, { recursive: true, force: true }); }
// A local production container must pass before its image is published.
const container = run('docker', ['run', '-d', '--rm', '-p', '127.0.0.1:18082:8080', tag], { env: dockerEnv });
try {
  for (let i = 0; i < 30; i++) {
    try { const health = await (await fetch('http://127.0.0.1:18082/healthz')).json(); assert.equal(health.version, version); break; }
    catch { if (i === 29) throw new Error('Production container failed local health.'); await new Promise(r => setTimeout(r, 500)); }
  }
  assert.equal(run('docker', ['exec', container, 'id', '-u'], { env: dockerEnv }), '1000');
  assert.equal((await fetch('http://127.0.0.1:18082/docs/buying')).status, 200);
} finally { run('docker', ['stop', container], { env: dockerEnv }); }
const login = az(['acr', 'login', '--name', registry, '--expose-token']);
const auth = mkdtempSync(resolve(root, '.local/frontend-acr-'));
try {
  const env = { ...dockerEnv, DOCKER_CONFIG: auth };
  run('docker', ['login', login.loginServer, '--username', '00000000-0000-0000-0000-000000000000', '--password-stdin'], { env, input: login.accessToken + '\n' });
  console.log('Publishing the locally verified image.');
  run('docker', ['push', tag], { env, timeout: 900000 });
} finally { rmSync(auth, { recursive: true, force: true }); }
const digest = az(['acr', 'repository', 'show', '--name', registry, '--image', `unijar-web:${version}`]).digest;
assert.match(digest, /^sha256:[a-f0-9]{64}$/);
console.log('Deploying frontend into the existing Consumption environment.');
const deployed = az(['deployment', 'group', 'create', '--resource-group', resourceGroup, '--name', 'unijar-frontend', '--template-file', 'infra/frontend.bicep', '--parameters', `registryName=${registry}`, `imageDigest=${digest}`, `sourceCommit=${version}`, `apiUrl=${api.url}`], 900000);
const url = deployed.properties.outputs.url.value;
assert.ok(url.startsWith('https://unijar-web.'));
// Add only the actual frontend origin; preserve any previously authorized origins.
const oldOrigins = existing.properties.template.containers[0].env.find((v: any) => v.name === 'CORS_ORIGINS')?.value ?? '';
const corsOrigins = [...new Set([...oldOrigins.split(',').filter(Boolean), url])].join(',');
az(['containerapp', 'update', '--name', 'unijar-api', '--resource-group', resourceGroup, '--set-env-vars', `CORS_ORIGINS=${corsOrigins}`], 600000);
let verified = false;
for (let i = 0; i < 50; i++) {
  try {
    const web = await (await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(15000) })).json();
    const ready = await fetch(`${api.url}/readyz`, { signal: AbortSignal.timeout(15000) });
    const cors = await fetch(`${api.url}/v1/credits/not-an-address`, { headers: { Origin: url }, signal: AbortSignal.timeout(15000) });
    if (web.version === version && ready.ok && cors.headers.get('access-control-allow-origin') === url) { verified = true; break; }
  } catch { /* bounded cold-start allowance */ }
  await new Promise(r => setTimeout(r, 4000));
}
assert.ok(verified, 'Frontend/API/CORS verification failed.');
const updatedApi = az(['containerapp', 'show', '--name', 'unijar-api', '--resource-group', resourceGroup]);
assert.equal(updatedApi.properties.template.containers[0].image, api.image, 'CORS update must preserve the API image.');
api.revision = updatedApi.properties.latestReadyRevisionName; api.corsOrigins = corsOrigins.split(',');
writeFileSync(resolve(root, 'deployments/azure.json'), JSON.stringify(api, null, 2) + '\n');
const webApp = az(['containerapp', 'show', '--name', 'unijar-web', '--resource-group', resourceGroup]);
writeFileSync(resolve(root, 'deployments/frontend.json'), JSON.stringify({ url, api: api.url, resourceGroup, sourceCommit: version, image: `${registry}.azurecr.io/unijar-web@${digest}`, imageDigest: digest, revision: webApp.properties.latestReadyRevisionName, deployedAt: new Date().toISOString(), chainId: 11155111, localValidation: validation.sourceCommit }, null, 2) + '\n');
console.log(`Frontend HTTPS and API CORS verified: ${url}`);
