// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { encodeDeployData, keccak256, type Address, type Hex } from 'viem';
import { loadManifest } from '../src/manifest.js';
import { root, chainId, client, artifact, assertChain, broadcast, confirm, json } from './runtime.js';

async function main() {
  await assertChain();
  execFileSync('git', ['diff', '--quiet', 'HEAD'], { cwd: root });
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const network = chainId === 31337 ? 'local' : 'sepolia';
  const path = resolve(root, `deployments/${network}.json`); const m = loadManifest(path);
  const terms = JSON.parse(readFileSync(resolve(root, 'config/receipt-service.json'), 'utf8')) as { price: string; feeBps: number };
  assert.match(terms.price, /^[1-9]\d*$/); assert.ok(BigInt(terms.price) < 1n << 128n);
  assert.ok(Number.isInteger(terms.feeBps) && terms.feeBps > 0 && terms.feeBps < 10000);
  const config = { asset: m.addresses.auctionAsset, jar: m.addresses.jar, merchant: m.roles.treasury, ...terms };
  const pendingPath = resolve(root, `.local/fee-source-${network}.json`);
  type Pending = { chainId: number; sourceCommit: string; config: typeof config; hash: Hex };
  let pending: Pending | undefined = existsSync(pendingPath) ? JSON.parse(readFileSync(pendingPath, 'utf8')) : undefined;
  // A fresh local core fixture must not reuse an earlier fixture's receipt service.
  if (chainId === 31337 && pending && pending.config.jar !== config.jar) pending = undefined;
  if (pending) {
    assert.equal(pending.chainId, chainId); assert.deepEqual(pending.config, config);
    execFileSync('git', ['diff', '--quiet', pending.sourceCommit, 'HEAD', '--', 'fee-contracts', 'config/receipt-service.json'], { cwd: root });
  } else {
    const { abi, bytecode } = artifact('fee-contracts/out/ReceiptRegistry.sol/ReceiptRegistry.json');
    const data = encodeDeployData({ abi, bytecode: bytecode.object, args: [config.asset, config.jar, config.merchant, BigInt(config.price), config.feeBps] });
    pending = { chainId, sourceCommit, config, hash: await broadcast(data, undefined) };
    writeFileSync(pendingPath, json(pending), { mode: 0o600 });
  }
  const receipt = await confirm(pending.hash); assert.ok(receipt.contractAddress);
  const address = receipt.contractAddress as Address;
  const code = await client.getCode({ address }); assert.ok(code && code !== '0x');
  const { abi } = artifact('fee-contracts/out/ReceiptRegistry.sol/ReceiptRegistry.json');
  for (const [method, expected] of Object.entries(config)) {
    const actual: unknown = await client.readContract({ address, abi, functionName: method });
    assert.equal(String(actual).toLowerCase(), String(expected).toLowerCase());
  }
  m.addresses.feeSource = address;
  m.feeSource = { sourceCommit: pending.sourceCommit, asset: config.asset, merchant: config.merchant, price: config.price, feeBps: config.feeBps };
  m.deployments.feeSource = { address, block: receipt.blockNumber.toString(), transactionHash: receipt.transactionHash, codeHash: keccak256(code) };
  writeFileSync(`${path}.tmp`, json(m)); renameSync(`${path}.tmp`, path); loadManifest(path);
  console.log(`Verified ${network} paid receipt service: ${address}`);
}
main().catch(() => { console.error('Fee source deployment stopped. Confirmed hashes are retained locally; RPC and signing details are suppressed.'); process.exitCode = 1; });
