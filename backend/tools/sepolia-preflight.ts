// SPDX-License-Identifier: AGPL-3.0-only
import { formatEther } from 'viem';
import { accounts, assertChain, chainId, client } from './runtime.js';

async function main() {
  await assertChain();
  const balances = await Promise.all(['operator', 'buyer-a', 'buyer-b'].map(async name => ({ name, address: accounts[name], eth: formatEther(await client.getBalance({ address: accounts[name]! })) })));
  console.log(JSON.stringify({ chainId, balances }, null, 2));
  if (balances.some(x => Number(x.eth) === 0)) { console.error('Fund the listed zero-balance disposable accounts before public transactions.'); process.exitCode = 1; }
}
main().catch(() => { console.error('Sepolia preflight failed: check RPC configuration and chain. Endpoint details suppressed.'); process.exitCode = 1; });
