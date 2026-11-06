// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { keccak256, type Address } from 'viem';
import { loadManifest, loadAbis } from '../src/manifest.js';
import { root, client, chainId, assertChain } from './runtime.js';

export async function validateManifest() {
  await assertChain();
  const m = loadManifest(resolve(root, `deployments/${chainId === 31337 ? 'local' : 'sepolia'}.json`));
  assert.equal(m.chainId, chainId); const block = await client.getBlockNumber({ cacheTime: 0 });
  for (const deployment of Object.values(m.deployments)) {
    const code = await client.getCode({ address: deployment.address as Address, blockNumber: block });
    assert.ok(code && code !== '0x'); assert.equal(keccak256(code), deployment.codeHash);
    const receipt = await client.getTransactionReceipt({ hash: deployment.transactionHash as `0x${string}` }); assert.equal(receipt.status, 'success'); assert.equal(receipt.blockNumber.toString(), deployment.block);
  }
  const abis = loadAbis(resolve(root, 'backend/public'));
  for (const [method, expected] of Object.entries({ jar: m.addresses.jar, treasury: m.roles.treasury, operator: m.roles.operator, payout: m.addresses.payout, reader: m.addresses.reader, factory: m.addresses.factory })) {
    const actual = await client.readContract({ address: m.addresses.releaser as Address, abi: abis.sale, functionName: method, blockNumber: block }); assert.equal(String(actual).toLowerCase(), expected.toLowerCase());
  }
  const adopted = await client.readContract({ address: m.addresses.jar as Address, abi: abis.jar, functionName: 'releaser', blockNumber: block }); assert.equal(String(adopted).toLowerCase(), m.addresses.releaser.toLowerCase());
  return m;
}
if (process.argv[1]?.endsWith('validate-manifest.ts')) validateManifest().then(() => console.log('Manifest verified against actual chain code, receipts, roles and adoption')).catch(() => { console.error('Manifest validation failed (RPC details suppressed)'); process.exitCode = 1; });
