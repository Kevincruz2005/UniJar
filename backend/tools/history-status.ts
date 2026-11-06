// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, chainId, client, assertChain } from './runtime.js';

async function main() {
  await assertChain();
  const pending = JSON.parse(readFileSync(resolve(root, chainId === 31337 ? '.local/local.pending.json' : 'deployments/sepolia.pending.json'), 'utf8'));
  if (!pending.transactions.seedLiquidity) { console.log('Waiting for the initial liquidity seed transaction'); return; }
  const receipt = await client.getTransactionReceipt({ hash: pending.transactions.seedLiquidity });
  const [seed, latest] = await Promise.all([client.getBlock({ blockNumber: receipt.blockNumber }), client.getBlock()]);
  const elapsed = latest.timestamp - seed.timestamp;
  console.log(JSON.stringify({ chainId, seedTransaction: receipt.transactionHash, seedTimestamp: seed.timestamp.toString(), latestTimestamp: latest.timestamp.toString(), elapsedSeconds: Number(elapsed), requiredSeconds: 1801, remainingSeconds: Number(elapsed >= 1801n ? 0n : 1801n - elapsed) }, null, 2));
}
main().catch(() => { console.error('History status unavailable; check confirmed seed, chain and RPC'); process.exitCode = 1; });
