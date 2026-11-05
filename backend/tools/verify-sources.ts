// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, chainId, rpc, assertChain } from './runtime.js';

async function main() {
  await assertChain(); if (chainId !== 11155111) throw new Error('Public source verification requires Sepolia');
  const path = existsSync(resolve(root, 'deployments/sepolia.json')) ? 'deployments/sepolia.json' : 'deployments/sepolia.pending.json';
  const m = JSON.parse(readFileSync(resolve(root, path), 'utf8'));
  const evidencePath = resolve(root, 'deployments/source-verification.json');
  const evidence = existsSync(evidencePath) ? JSON.parse(readFileSync(evidencePath, 'utf8')) : { chainId, sourceCommit: m.sourceCommit, contracts: {} };
  const sources: Record<string, [string, string]> = {
    payout: ['contracts', 'src/FixtureToken.sol:FixtureToken'], directAsset: ['contracts', 'src/FixtureToken.sol:FixtureToken'], auctionAsset: ['contracts', 'src/FixtureToken.sol:FixtureToken'],
    jar: ['contracts', '../.deps/tjar/src/TokenJar.sol:TokenJar'], releaser: ['contracts', 'src/UniJar.sol:UniJar'],
    factory: ['oracle-contracts', '../.deps/v3-core/contracts/UniswapV3Factory.sol:UniswapV3Factory'],
    pool: ['oracle-contracts', '../.deps/v3-core/contracts/UniswapV3Pool.sol:UniswapV3Pool'],
    reader: ['oracle-contracts', 'src/V3Reader.sol:V3Reader'], fixture: ['oracle-contracts', 'src/LiquidityFixture.sol:LiquidityFixture'],
  };
  mkdirSync(resolve(root, '.local/verification'), { recursive: true });
  for (const [name, [project, contract]] of Object.entries(sources)) {
    const deployment = m.deployments[name]; if (!deployment) continue;
    if (evidence.contracts[name]?.address === deployment.address && evidence.contracts[name]?.verified) continue;
    const result = spawnSync(resolve(root, '.tools/forge'), ['verify-contract', '--root', project, deployment.address, contract, '--chain', '11155111', '--verifier', 'sourcify', '--creation-transaction-hash', deployment.transactionHash, '--watch', '--retries', '2', '--delay', '3'], { cwd: root, env: { ...process.env, ETH_RPC_URL: rpc }, encoding: 'utf8', timeout: 150000 });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.replaceAll(rpc!, '[REDACTED_RPC]');
    writeFileSync(resolve(root, `.local/verification/${name}.log`), output);
    const verified = result.status === 0 && /successfully verified|already verified/i.test(output);
    evidence.contracts[name] = { address: deployment.address, codeHash: deployment.codeHash, verified, exitCode: result.status, jobUrl: output.match(/https:\/\/sourcify.dev\/server\/verify-ui\/jobs\/[a-z0-9-]+/)?.[0] ?? null };
    evidence.timestamp = new Date().toISOString(); writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
    console.log(`${name}: ${verified ? 'source verified' : 'verification pending; inspect ignored diagnostic'}`);
  }
}
main().catch(() => { console.error('Source verification prerequisite failed; no verification claimed'); process.exitCode = 1; });
