// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loadManifest } from '../src/manifest.js';

const root = resolve(import.meta.dirname, '../..');
const location = process.env.AZURE_LOCATION ?? 'centralindia';
const groupName = process.env.AZURE_RESOURCE_GROUP ?? 'unijar-demo-rg';
if (!groupName.startsWith('unijar-')) throw new Error('Only a project-specific unijar-* resource group is allowed');
mkdirSync(resolve(root, '.local'), { recursive: true });
const dockerEnv = { ...process.env };
if (!dockerEnv.DOCKER_HOST && existsSync('/run/user/1000/unijar-docker.sock')) dockerEnv.DOCKER_HOST = 'unix:///run/user/1000/unijar-docker.sock';
function run(file: string, args: string[], options: { timeout?: number; env?: NodeJS.ProcessEnv; input?: string } = {}) {
  return execFileSync(file, args, { cwd: root, encoding: 'utf8', stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], input: options.input, timeout: options.timeout ?? 180000, env: options.env ?? process.env }).trim();
}
const az = (args: string[], timeout?: number): any => JSON.parse(run('az', [...args, '--only-show-errors', '-o', 'json'], { timeout }) || 'null');
async function preflight() {
  const account = az(['account', 'show']); assert.equal(account.state, 'Enabled', 'Azure subscription is disabled');
  for (const namespace of ['Microsoft.App', 'Microsoft.ContainerRegistry', 'Microsoft.ManagedIdentity', 'Microsoft.OperationalInsights']) assert.equal(az(['provider', 'show', '--namespace', namespace]).registrationState, 'Registered', `Register ${namespace}`);
  const assignments = az(['policy', 'assignment', 'list']) as any[];
  for (const assignment of assignments) {
    const allowed = assignment.parameters?.listOfAllowedLocations?.value;
    if (Array.isArray(allowed)) assert.ok(allowed.includes(location), 'Region excluded by subscription policy');
  }
  const existing = az(['group', 'exists', '--name', groupName]);
  if (existing) assert.equal(az(['group', 'show', '--name', groupName]).tags?.project, 'UniJar', 'Resource group belongs to another project');
  const usage = az(['rest', '--method', 'get', '--url', `https://management.azure.com/subscriptions/${account.id}/providers/Microsoft.App/locations/${location}/usages?api-version=2025-01-01`]);
  const quota = usage.value.find((x: any) => x.name.value === 'ManagedEnvironmentCount');
  assert.ok(quota && (existing || quota.currentValue < quota.limit), 'No Container Apps environment quota');
  run('az', ['bicep', 'build', '--file', 'infra/main.bicep', '--outfile', '.local/azure-template.json']);
  const services = ['Container Registry', 'Azure Container Apps', 'Log Analytics'];
  const snapshotPath = resolve(root, '.local/azure-price-snapshot.json');
  let snapshot: { location?: string; checkedAt?: string; prices?: Record<string, unknown[]> } = {};
  try { snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')); } catch { /* obtain fresh rates below */ }
  const snapshotAge = Date.now() - Date.parse(snapshot.checkedAt ?? '');
  const reusable = snapshot.location === location && snapshotAge >= 0 && snapshotAge < 86400000
    && services.every(service => Array.isArray(snapshot.prices?.[service]) && snapshot.prices![service]!.length > 0);
  const prices: Record<string, unknown[]> = reusable ? snapshot.prices! : {};
  if (reusable) console.log(`Using regional retail quotes checked at ${snapshot.checkedAt} (maximum cache age: 24 hours)`);
  for (const service of reusable ? [] : services) {
    const url = new URL('https://prices.azure.com/api/retail/prices'); url.searchParams.set('$filter', `serviceName eq '${service}' and armRegionName eq '${location}' and priceType eq 'Consumption'`);
    let data: { Items: any[] } | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(30000) }); assert.ok(response.ok, 'Pricing lookup failed');
        data = await response.json() as { Items: any[] }; break;
      } catch {
        if (attempt === 2) throw new Error(`Pricing lookup unavailable for ${service} after three bounded attempts`);
        console.log(`Retrying ${service} retail pricing lookup`);
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    assert.ok(data, 'Pricing lookup returned no data');
    prices[service] = data.Items.filter(x => x.retailPrice > 0 && (x.meterName === 'Basic Registry Unit' || ['Standard vCPU Active Usage', 'Standard Memory Active Usage', 'Analytics Logs Data Ingestion'].includes(x.meterName))).map(({ meterName, retailPrice, unitOfMeasure, currencyCode }) => ({ meterName, retailPrice, unitOfMeasure, currencyCode }));
  }
  if (!reusable) writeFileSync(snapshotPath, JSON.stringify({ location, checkedAt: new Date().toISOString(), prices }, null, 2));
  writeFileSync(resolve(root, '.local/azure-prices.json'), JSON.stringify(prices, null, 2));
  console.log(JSON.stringify({ subscription: account.name, groupName, location, quota: { current: quota.currentValue, limit: quota.limit }, prices }, null, 2));
  console.log('Cost model: Basic ACR runs continuously; compute scales 0–1 (0.25 vCPU/0.5 GiB); logs capped at 0.1 GB/day; requests, data transfer and external RPC can add charges. Free grants and student credits are not assumed.');
  return account.id as string;
}
async function waitReady(url: string, version?: string) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { const r = await fetch(`${url}/readyz`, { signal: AbortSignal.timeout(15000) }); if (r.ok) { const body = await r.json(); if (!version || body.version === version) return; } } catch { /* bounded cold-start retry */ }
    await new Promise(r => setTimeout(r, Math.min(2000 + attempt * 500, 10000)));
  }
  throw new Error('HTTPS readiness did not pass within the cold-start allowance');
}
async function smoke(runTransactions = true) {
  if (existsSync(resolve(root, '.local/sepolia.env'))) process.loadEnvFile(resolve(root, '.local/sepolia.env'));
  const deployed = JSON.parse(readFileSync(resolve(root, 'deployments/azure.json'), 'utf8'));
  await waitReady(deployed.url, deployed.sourceCommit);
  const reportPath = resolve(root, 'deployments/azure-smoke.json');
  if (runTransactions) {
    run(resolve(root, 'backend/node_modules/.bin/tsx'), ['backend/tools/smoke.ts'], { timeout: 1200000, env: { ...process.env, CHAIN_ID: '11155111', API_URL: deployed.url } });
  } else {
    const existing = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.equal(existing.sourceCommit, deployed.contractSourceCommit ?? deployed.sourceCommit);
    assert.equal(existing.apiSourceCommit ?? existing.sourceCommit, deployed.sourceCommit); assert.equal(existing.api, deployed.url);
    assert.equal(existing.chainId, 11155111); assert.equal(existing.transactions.length, existing.expectedTransactionCount ?? 14);
    const { client, assertChain } = await import('./runtime.js'); await assertChain();
    for (const hash of existing.transactions) assert.equal((await client.getTransactionReceipt({ hash })).status, 'success');
    console.log(`Reconfirmed the existing ${existing.transactions.length} transaction receipts; no transactions replayed`);
  }
  const beforeResponse = await fetch(`${deployed.url}/v1/inventory`); assert.equal(beforeResponse.status, 200);
  const before = await beforeResponse.json();
  const replicaState = () => (az(['containerapp', 'replica', 'list', '--name', 'unijar-api', '--resource-group', groupName, '--revision', deployed.revision]) as any[])
    .map(replica => ({ name: replica.name, containers: (replica.properties?.containers ?? []).map((container: any) => ({ name: container.name, ready: container.ready, restarts: container.restartCount })) }));
  const replicasBefore = replicaState();
  assert.ok(replicasBefore.length > 0, 'Capture a running replica before restart');
  const originalNames = new Set(replicasBefore.map(replica => replica.name));
  const replacementReady = (replicas: ReturnType<typeof replicaState>) => replicas.length > 0
    && replicas.every(replica => !originalNames.has(replica.name) && replica.containers.length > 0
      && replica.containers.every((container: any) => container.ready));
  az(['containerapp', 'revision', 'restart', '--name', 'unijar-api', '--resource-group', groupName, '--revision', deployed.revision]);
  let replicasAfter = replicasBefore;
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise(r => setTimeout(r, 2000)); replicasAfter = replicaState();
    if (replacementReady(replicasAfter)) break;
  }
  assert.ok(replacementReady(replicasAfter), 'Original replicas must be gone and every replacement ready before checking persisted state');
  await waitReady(deployed.url, deployed.sourceCommit);
  const afterResponse = await fetch(`${deployed.url}/v1/inventory`); assert.equal(afterResponse.status, 200);
  const after = await afterResponse.json(); assert.deepEqual(after.data, before.data);
  const health = await (await fetch(`${deployed.url}/healthz`)).json(); assert.equal(health.version, deployed.sourceCommit); assert.equal(health.chainId, 11155111);
  const denied = await fetch(`${deployed.url}/v1/config`, { headers: { origin: 'https://untrusted.example' } }); assert.equal(denied.headers.get('access-control-allow-origin'), null);
  const tooLarge = await fetch(`${deployed.url}/v1/transactions/prepare`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ padding: 'x'.repeat(17000) }) }); assert.equal(tooLarge.status, 413);
  const consoleLogs = run('az', ['containerapp', 'logs', 'show', '--name', 'unijar-api', '--resource-group', groupName, '--type', 'console', '--tail', '100', '--format', 'json', '--only-show-errors']);
  if (process.env.SEPOLIA_RPC_URL) {
    const endpoint = new URL(process.env.SEPOLIA_RPC_URL);
    const credentials = [process.env.SEPOLIA_RPC_URL, endpoint.username, endpoint.password, ...endpoint.searchParams.values()].filter(v => v.length > 4);
    for (const value of credentials) assert.ok(!consoleLogs.includes(value), 'RPC credential appeared in console logs');
  }
  assert.ok(!/"privateKey"\s*:|BEGIN .*PRIVATE KEY/.test(consoleLogs), 'Signing key field appeared in console logs');
  writeFileSync(resolve(root, '.local/azure-console.log'), consoleLogs, { mode: 0o600 });
  let limited = false;
  const burstStart = Date.now(); let rateLimitProof: Record<string, unknown> = {};
  for (let i = 0; i < 125; i++) {
    // Invalid addresses fail before RPC reads. Consume bodies to reuse connections.
    const response = await fetch(`${deployed.url}/v1/credits/not-an-address`, { headers: { 'x-forwarded-for': `198.51.100.${i % 200 + 1}` }, signal: AbortSignal.timeout(10000) });
    const body = await response.text();
    if (response.status === 429) {
      assert.equal(JSON.parse(body).error, 'RATE_LIMITED');
      assert.equal(response.headers.get('x-ratelimit-remaining'), '0'); limited = true;
      rateLimitProof = { requestCount: i + 1, elapsedMs: Date.now() - burstStart, status: 429, limit: response.headers.get('x-ratelimit-limit'), variedUntrustedForwardedPrefixes: true }; break;
    }
    assert.equal(response.status, 400);
  }
  assert.ok(limited, 'Live rate limit was not observed');
  let rollbackEvidence: Record<string, unknown> | null = null;
  if (deployed.previous?.revision && deployed.previous.revision !== deployed.revision) {
    // Single mode safely rolls traffic to each newly ready revision.
    try {
      const rolled = az(['containerapp', 'update', '--name', 'unijar-api', '--resource-group', groupName, '--image', deployed.previous.image, '--revision-suffix', `rollback-${Date.now()}`], 600000);
      assert.equal(rolled.properties.template.containers[0].image, deployed.previous.image);
      await waitReady(deployed.url, deployed.previous.sourceCommit);
      const oldHealth = await (await fetch(`${deployed.url}/healthz`)).json(); assert.equal(oldHealth.version, deployed.previous.sourceCommit);
      rollbackEvidence = { image: deployed.previous.image, version: oldHealth.version, checkedAt: new Date().toISOString() };
    } finally {
      az(['containerapp', 'update', '--name', 'unijar-api', '--resource-group', groupName, '--image', deployed.image, '--revision-suffix', `restore-${Date.now()}`], 600000);
      await waitReady(deployed.url, deployed.sourceCommit);
      const restored = az(['containerapp', 'show', '--name', 'unijar-api', '--resource-group', groupName]);
      assert.equal(restored.properties.template.containers[0].image, deployed.image);
      deployed.revision = restored.properties.latestReadyRevisionName;
      assert.equal(deployed.revision, restored.properties.latestRevisionName);
      deployed.restoredAt = new Date().toISOString();
      writeFileSync(resolve(root, 'deployments/azure.json'), JSON.stringify(deployed, null, 2) + '\n');
    }
  }
  const restoredHealth = await (await fetch(`${deployed.url}/healthz`)).json(); assert.equal(restoredHealth.version, deployed.sourceCommit);
  const restoredInventory = await (await fetch(`${deployed.url}/v1/inventory`)).json(); assert.deepEqual(restoredInventory.data, before.data);
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  report.restartEvidence = { before: replicasBefore, after: replicasAfter };
  report.rateLimitEvidence = rateLimitProof;
  report.rollbackEvidence = rollbackEvidence;
  report.verificationCommand = runTransactions ? 'make deploy-azure / make smoke-azure' : 'make verify-azure';
  report.verificationSourceCommit = run('git', ['rev-parse', 'HEAD']);
  report.verificationExitCode = 0;
  report.verifiedAt = new Date().toISOString();
  report.azureChecks = { restartPersistence: 'passed', cors: 'passed', requestSize: 'passed', rateLimit: 'passed', logRedaction: 'passed', rollback: deployed.previous ? 'passed' : 'not applicable: first deployment', coldStartReadiness: 'passed within bounded readiness allowance' };
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log('Azure transaction smoke, restart persistence, CORS and rate limiting passed');
}
async function main() {
  const mode = process.argv[2];
  if (mode === 'smoke' || mode === 'verify') { await smoke(mode === 'smoke'); return; }
  if (!['plan', 'deploy', 'resume'].includes(mode ?? '')) throw new Error('Use plan, deploy, resume, smoke or verify');
  const resuming = mode === 'resume';
  const subscription = await preflight();
  if (mode === 'plan') {
    const result = az(['deployment', 'sub', 'what-if', '--name', 'unijar-plan', '--location', location, '--template-file', 'infra/main.bicep', '--parameters', `location=${location}`, `groupName=${groupName}`, 'deployApplication=false', '--result-format', 'ResourceIdOnly', '--no-pretty-print', '--no-prompt', 'true']);
    writeFileSync(resolve(root, '.local/azure-what-if.json'), JSON.stringify(result, null, 2)); console.log('Azure foundation what-if validated; no resources provisioned'); return;
  }
  // No Azure mutation until actual Sepolia and local verification prerequisites exist.
  if (!resuming) run('make', ['check'], { timeout: 300000 });
  if (existsSync(resolve(root, '.local/sepolia.env'))) process.loadEnvFile(resolve(root, '.local/sepolia.env'));
  assert.ok(process.env.SEPOLIA_RPC_URL, 'SEPOLIA_RPC_URL is missing');
  const m = loadManifest(resolve(root, 'deployments/sepolia.json')); assert.equal(m.chainId, 11155111);
  const sourceCommit = run('git', ['rev-parse', 'HEAD']);
  const runtimePaths = ['backend/src', 'backend/test', 'backend/Dockerfile', 'backend/tsconfig.json', 'backend/package.json', 'backend/package-lock.json', 'scripts/export-assets.py'];
  run('git', ['diff', '--quiet', 'HEAD', '--', ...runtimePaths]);
  assert.equal(run('git', ['ls-files', '--others', '--exclude-standard', '--', ...runtimePaths]), '', 'Commit runtime files first');
  const localValidation = JSON.parse(readFileSync(resolve(root, '.local/container-validation.json'), 'utf8'));
  assert.equal(localValidation.status, 'passed'); assert.equal(localValidation.chainId, 31337);
  run('git', ['diff', '--quiet', localValidation.sourceCommit, 'HEAD', '--', ...runtimePaths]);
  const chainSmoke = JSON.parse(readFileSync(resolve(root, 'deployments/sepolia-smoke.json'), 'utf8')); assert.equal(chainSmoke.sourceCommit, m.sourceCommit);
  assert.ok(chainSmoke.passed.includes('auction self-outbid/outbid/refund/settlement'), 'Run the extended Sepolia smoke before deploying');
  assert.ok(existsSync(resolve(root, '.local/docker-image-id')), 'Complete make container-smoke before Azure deployment');
  run('git', ['diff', '--quiet', m.sourceCommit, 'HEAD', '--', 'contracts', 'oracle-contracts']);
  run('python3', ['scripts/export-assets.py', 'deployments/sepolia.json']);
  run(resolve(root, 'backend/node_modules/.bin/tsx'), ['backend/tools/validate-manifest.ts'], { env: { ...process.env, CHAIN_ID: '11155111' } });
  // This local build/run gate precedes paid provisioning and image upload.
  if (!resuming) {
  run('docker', ['build', '--network', 'host', '--no-cache', '-f', 'backend/Dockerfile', '-t', `unijar:${sourceCommit}`, '.'], { timeout: 600000, env: dockerEnv });
  const envFile = resolve(root, '.local/container.env');
  writeFileSync(envFile, `RPC_URL=${process.env.SEPOLIA_RPC_URL}\nEXPECTED_CHAIN_ID=11155111\n`, { mode: 0o600 }); chmodSync(envFile, 0o600);
  try {
    run('docker', ['run', '-d', '--rm', '--name', 'unijar-preflight', '--network', 'host', '--env-file', envFile, `unijar:${sourceCommit}`], { env: dockerEnv });
    const localUrl = dockerEnv.DOCKER_HOST?.includes('unijar-docker') ? 'http://127.0.0.1:18080' : 'http://127.0.0.1:8080';
    await waitReady(localUrl, sourceCommit); assert.equal(run('docker', ['exec', 'unijar-preflight', 'id', '-u'], { env: dockerEnv }), '1000');
  } finally { try { run('docker', ['stop', 'unijar-preflight'], { env: dockerEnv }); } catch { /* may not have started */ } unlinkSync(envFile); }
  }
  const parameters = ['--location', location, '--template-file', 'infra/main.bicep', '--parameters', `location=${location}`, `groupName=${groupName}`];
  const foundation = resuming ? az(['deployment', 'sub', 'show', '--name', 'unijar-foundation']) : az(['deployment', 'sub', 'create', '--name', 'unijar-foundation', ...parameters, 'deployApplication=false'], 2100000);
  assert.equal(foundation.properties.provisioningState, 'Succeeded', 'Foundation must finish before resuming');
  const registry = foundation.properties.outputs.registryName.value;
  const environment = az(['rest', '--method', 'get', '--url', `https://management.azure.com/subscriptions/${subscription}/resourceGroups/${groupName}/providers/Microsoft.App/managedEnvironments/unijar-env?api-version=2026-07-01`]);
  assert.equal(environment.properties.environmentMode, 'WorkloadProfiles', 'Apply the explicit WorkloadProfiles foundation before deploying the app');
  // Push the exact locally tested image; no registry admin password or ACR build worker.
  if (!resuming) {
  const login = az(['acr', 'login', '--name', registry, '--expose-token']);
  const authDirectory = mkdtempSync(resolve(root, '.local/acr-auth-')); chmodSync(authDirectory, 0o700);
  const authEnv = { ...dockerEnv, DOCKER_CONFIG: authDirectory };
  try {
    run('docker', ['login', login.loginServer, '--username', '00000000-0000-0000-0000-000000000000', '--password-stdin'], { env: authEnv, input: `${login.accessToken}\n` });
    const image = `${login.loginServer}/unijar:${sourceCommit}`;
    run('docker', ['tag', `unijar:${sourceCommit}`, image], { env: authEnv });
    run('docker', ['push', image], { env: authEnv, timeout: 900000 });
  } finally { rmSync(authDirectory, { recursive: true, force: true }); }
  }
  const digest = az(['acr', 'repository', 'show', '--name', registry, '--image', `unijar:${sourceCommit}`]).digest;
  assert.match(digest, /^sha256:[a-f0-9]{64}$/);
  if (resuming) {
    const inspected = JSON.parse(run('docker', ['image', 'inspect', `unijar:${sourceCommit}`], { env: dockerEnv }));
    assert.ok(inspected[0].RepoDigests.includes(`${registry}.azurecr.io/unijar@${digest}`), 'The previously tested local image must match the published digest');
    const packedManifest = JSON.parse(run('docker', ['run', '--rm', '--network', 'host', '--entrypoint', 'node', `unijar:${sourceCommit}`, '-e', "console.log(require('node:fs').readFileSync('public/manifest.json','utf8'))"], { env: dockerEnv }));
    assert.deepEqual(packedManifest, m, 'The previously tested image must contain this exact Sepolia manifest');
    console.log('Resuming with matching source, chain, tested image digest and packaged manifest');
  }
  let previous: any;
  if (existsSync(resolve(root, 'deployments/azure.json'))) previous = JSON.parse(readFileSync(resolve(root, 'deployments/azure.json'), 'utf8'));
  const secure = resolve(root, '.local/azure-secure-parameters.json');
  writeFileSync(secure, JSON.stringify({ '$schema': 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#', contentVersion: '1.0.0.0', parameters: { rpcUrl: { value: process.env.SEPOLIA_RPC_URL } } }), { mode: 0o600 }); chmodSync(secure, 0o600);
  try {
    const result = az(['deployment', 'sub', 'create', '--name', 'unijar-api', ...parameters, `@${secure}`, 'deployApplication=true', `imageDigest=${digest}`, `sourceCommit=${sourceCommit}`, `corsOrigins=${process.env.CORS_ORIGINS ?? ''}`], 900000);
    const url = `https://${result.properties.outputs.fqdn.value}`; await waitReady(url, sourceCommit);
    const app = az(['containerapp', 'show', '--name', 'unijar-api', '--resource-group', groupName]);
    const deployment = { url, resourceGroup: groupName, subscription, resourceId: app.id, location, sourceCommit, contractSourceCommit: m.sourceCommit, imageDigest: digest, image: `${registry}.azurecr.io/unijar@${digest}`, revision: app.properties.latestReadyRevisionName, timestamp: new Date().toISOString(), previous: previous ? { image: previous.image, revision: previous.revision, sourceCommit: previous.sourceCommit } : null };
    writeFileSync(resolve(root, 'deployments/azure.json'), JSON.stringify(deployment, null, 2) + '\n');
  } finally { unlinkSync(secure); }
  await smoke();
  console.log('Azure deployment and live checks completed');
}
main().catch(error => {
  let detail = error instanceof Error ? error.message : 'Unknown failure';
  if (error && typeof error === 'object' && 'stderr' in error) detail = String(error.stderr);
  for (const secret of [process.env.SEPOLIA_RPC_URL, process.env.RPC_URL]) if (secret) detail = detail.replaceAll(secret, '[REDACTED_RPC]');
  // Never persist deployment parameter payloads or tokens in diagnostic summaries.
  detail = detail.replace(/https?:\/\/[^\s"']+/g, '[REDACTED_URL]').slice(0, 2000);
  writeFileSync(resolve(root, '.local/azure-error.log'), detail, { mode: 0o600 });
  console.error(`Azure gate failed: ${detail}`);
  process.exitCode = 1;
});
