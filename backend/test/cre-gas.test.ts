// SPDX-License-Identifier: AGPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advisoryGas } from '../src/cre-gas.js';
import { SEPOLIA_GENESIS } from '../src/cre-domain.js';

test('server gas advisory uses bounded static Sepolia endpoints, authenticates network and coalesces concurrent work', async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input, options) => {
    const url = String(input); calls.push(url); assert.equal(options?.redirect, 'error'); assert.ok(options?.signal);
    return new Response(JSON.stringify(url.endsWith('/0') ? { height: 0, hash: SEPOLIA_GENESIS } : { gas_price_updated_at: new Date().toISOString(), gas_prices: { average: 0.33 } }));
  };
  const get = advisoryGas(fetcher); const results = await Promise.all([get(180, 200000000000n), get(180, 200000000000n)]);
  assert.equal(calls.length, 2); assert.ok(calls.every(u => u.startsWith('https://eth-sepolia.blockscout.com/')));
  assert.equal(results[0].status, 'VALID'); assert.deepEqual(results[0], results[1]);
});
test('HTTP failures, redirects, oversize and malformed responses cannot yield a cheap-fee conclusion or leak errors', async () => {
  for (const fetcher of [
    async () => new Response('', { status: 429 }),
    async () => new Response('x'.repeat(100001)),
    async () => new Response('{broken'),
    async () => { throw new Error('https://SECRET_RPC_KEY.invalid'); },
  ]) {
    const result = await advisoryGas(fetcher)(180, 200000000000n);
    assert.equal(result.status, 'DATA_UNAVAILABLE'); assert.ok(!JSON.stringify(result, (_, v) => typeof v === 'bigint' ? String(v) : v).includes('SECRET_RPC_KEY'));
  }
});
