// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sourceCommit = git('rev-parse', 'HEAD'); git('diff', '--quiet', 'HEAD');
const localUrl = 'http://localhost:5174'; const previewUrl = 'http://localhost:4173';
const local = await (await fetch(`${localUrl}/api/healthz`)).json();
assert.equal(local.chainId, 31337, 'Start bash scripts/web-local.sh first.');
const env = { ...process.env, VITE_API_URL: '' };
function run(script: string, args: string[] = [], extraEnv: NodeJS.ProcessEnv = {}) {
  execFileSync('npm', ['--prefix', 'frontend', 'run', script, ...args], { cwd: root, env: { ...env, ...extraEnv }, stdio: 'inherit', timeout: 300000 });
}
run('typecheck'); run('test'); run('build');
let preview: ReturnType<typeof spawn> | undefined;
try {
  try { assert.ok((await fetch(previewUrl)).ok); }
  catch {
    preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1'], { cwd: resolve(root, 'frontend'), env, stdio: 'inherit' });
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try { if ((await fetch(previewUrl)).ok) { ready = true; break; } } catch { /* bounded preview startup */ }
      await new Promise(r => setTimeout(r, 300));
    }
    assert.ok(ready, 'Production preview did not start.');
  }
  run('test:browser', ['--', 'public.spec.ts'], { BROWSER_BASE_URL: previewUrl, WALLET_TEST_NETWORK: '' });
  copyFileSync(resolve(root, '.local/frontend-browser-report.json'), resolve(root, '.local/frontend-public-local-report.json'));
  const publicReport = JSON.parse(readFileSync(resolve(root, '.local/frontend-browser-report.json'), 'utf8'));
  run('test:browser', ['--', 'wallet.spec.ts'], { BROWSER_BASE_URL: localUrl, WALLET_TEST_NETWORK: 'local' });
  copyFileSync(resolve(root, '.local/frontend-browser-report.json'), resolve(root, '.local/frontend-wallet-local-report.json'));
  const walletReport = JSON.parse(readFileSync(resolve(root, '.local/frontend-browser-report.json'), 'utf8'));
  assert.equal(publicReport.stats.unexpected, 0); assert.equal(walletReport.stats.unexpected, 0);
  assert.equal(git('rev-parse', 'HEAD'), sourceCommit); git('diff', '--quiet', 'HEAD');
  const transactions = JSON.parse(readFileSync(resolve(root, '.local/frontend-wallet-local.json'), 'utf8')).transactions;
  writeFileSync(resolve(root, '.local/frontend-local-validation.json'), JSON.stringify({ status: 'passed', sourceCommit, testedAt: new Date().toISOString(), typecheck: 'passed', unitAndServerTests: 'passed', productionBuild: 'passed', publicProductionBrowserTests: publicReport.stats.expected, localWalletBrowserScenarios: walletReport.stats.expected, localWalletTransactions: transactions.length, chainId: 31337, wallet: 'Injected EIP-1193 test provider with encrypted signing outside the browser; real wallet extensions remain a manual check.' }, null, 2) + '\n');
  console.log('Local validation evidence saved. Azure publishing gate is ready.');
} finally { preview?.kill(); }
