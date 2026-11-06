// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { encodeDeployData, encodeFunctionData, keccak256, type Address, type Hex } from 'viem';
import { loadManifest } from '../src/manifest.js';
import { root, chainId, client, accounts, artifact, assertChain, broadcast, confirm, read, json } from './runtime.js';

async function main() {
  await assertChain(); assert.equal(chainId, 11155111, 'Supplement existing Sepolia fixtures only');
  const manifestPath = resolve(root, 'deployments/sepolia.json'); const m = loadManifest(manifestPath);
  execFileSync('git', ['diff', '--quiet', m.sourceCommit, 'HEAD', '--', 'contracts', 'oracle-contracts'], { cwd: root });
  const token = artifact('contracts/out/FixtureToken.sol/FixtureToken.json');
  const sale = artifact('contracts/out/UniJar.sol/UniJar.json').abi;
  const pendingPath = resolve(root, '.local/review-asset.pending.json');
  const pending: { jar: string; hashes: Record<string, Hex> } = existsSync(pendingPath) ? JSON.parse(readFileSync(pendingPath, 'utf8')) : { jar: m.addresses.jar, hashes: {} };
  assert.equal(pending.jar, m.addresses.jar);
  async function transaction(stage: string, data: Hex, to?: Address) {
    if (!pending.hashes[stage]) {
      pending.hashes[stage] = await broadcast(data, to);
      writeFileSync(pendingPath, json(pending), { mode: 0o600 });
    }
    return confirm(pending.hashes[stage]!);
  }
  const receipt = await transaction('deploy:reviewAsset', encodeDeployData({ abi: token.abi, bytecode: token.bytecode.object, args: ['Mock Review', 'mREVIEW', 18] }));
  const address = receipt.contractAddress; assert.ok(address);
  const code = await client.getCode({ address }); assert.ok(code && code !== '0x');
  const mint = await transaction('jarREVIEW', encodeFunctionData({ abi: token.abi, functionName: 'mint', args: [m.addresses.jar, 25n * 10n ** 18n] }), address);
  assert.equal(await read(address, token.abi, 'balanceOf', [m.addresses.jar]), 25n * 10n ** 18n);
  assert.equal(await read(address, token.abi, 'minter'), accounts.operator);
  assert.equal(await read(m.addresses.releaser as Address, sale, 'assetModes', [address]), 0);
  m.reviewAssets = [address];
  m.deployments.reviewAsset = { address, block: receipt.blockNumber.toString(), transactionHash: receipt.transactionHash, codeHash: keccak256(code) };
  m.transactions['deploy:reviewAsset'] = receipt.transactionHash; m.transactions.jarREVIEW = mint.transactionHash;
  writeFileSync(`${manifestPath}.tmp`, json(m)); renameSync(`${manifestPath}.tmp`, manifestPath);
  loadManifest(manifestPath);
  console.log(json({ chainId, reviewAsset: address, mode: 'HeldForReview', transactions: [receipt.transactionHash, mint.transactionHash] }));
}
main().catch(() => { console.error('Review fixture stopped; confirmed hashes retained locally. Verify chain, funding and manifest.'); process.exitCode = 1; });
