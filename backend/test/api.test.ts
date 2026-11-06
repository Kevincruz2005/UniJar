// SPDX-License-Identifier: AGPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContractFunctionRevertedError, encodeErrorResult, encodeFunctionData, keccak256, parseAbi, zeroAddress, type Address, type Hex } from 'viem';
import { buildApp, type Lot } from '../src/app.js';
import { loadAbis, manifestSchema, type Manifest } from '../src/manifest.js';
import { decodedRevert } from '../src/chain-data.js';
import type { Gateway } from '../src/gateway.js';

const addr = (i: number) => `0x${i.toString(16).padStart(40, '0')}` as Address;
const names = ['jar', 'releaser', 'payout', 'directAsset', 'auctionAsset', 'factory', 'pool', 'reader', 'fixture'];
const code: Hex = '0x60006000';
const addresses = Object.fromEntries(names.map((name, i) => [name, addr(i + 1)]));
const policy = { pool: addr(7), fee: 3000, window: 1800, maxAge: 600, minLiquidity: '1000000', maxQuantity: '100000000000000000000', maxTickDeviation: 100, discountBps: 100, maxDuration: 7200, version: '1' };
// Synthetic fixtures exist only in tests, never deployment outputs.
const manifest: Manifest = manifestSchema.parse({ chainId: 31337, sourceCommit: '1'.repeat(40), controlledFixture: true, toolchain: {}, addresses,
  roles: { operator: addr(20), treasury: addr(21), buyerA: addr(22), buyerB: addr(23) },
  deployments: Object.fromEntries(names.map(name => [name, { address: addresses[name], block: '1', transactionHash: `0x${'2'.repeat(64)}`, codeHash: keccak256(code) }])), transactions: {}, reviewAssets: [addr(10)], policy });
manifest.deployments.reviewAsset = { address: addr(10), block: '1', transactionHash: `0x${'2'.repeat(64)}`, codeHash: keccak256(code) };
const abis = loadAbis('public');
class Fake implements Gateway {
  chain = 31337; badCode = false; down = false; paused = false; revertQuote = false; revertSimulation = false;
  calls: { method: string; args: readonly unknown[]; block: bigint; sender?: Address }[] = [];
  simulationError: unknown; readerError: unknown;
  currentMode = 2; currentVersion = 9n; badCodeAddress?: Address;
  reference: readonly [bigint, number, number, bigint, number] = [0n, 0, 0, 1000000n, 2000];
  lot: Lot = { mode: 2, state: 1, asset: addr(4), quantity: 10n ** 18n, committedAt: 1000n, expiry: 10000n, reserve: 0n, increment: 0n, bidder: zeroAddress, recipient: zeroAddress, highest: 0n, policyHash: `0x${'3'.repeat(64)}`, policy: { ...policy, minLiquidity: 1000000n, maxQuantity: 100n * 10n ** 18n, version: 1n } };
  failure() { if (this.down) throw new Error('https://SECRET_RPC_KEY.invalid'); }
  async chainId() { this.failure(); return this.chain; }
  async blockNumber() { this.failure(); return 123n; }
  async timestamp() { this.failure(); return 2000n; }
  async code(address: Address) { this.failure(); return this.badCode || address === this.badCodeAddress ? '0x' as Hex : code; }
  async read(_address: Address, _abi: unknown, method: string, args: readonly unknown[], block: bigint) {
    this.failure(); this.calls.push({ method, args, block });
    if (method === 'name') return `Chain token ${_address}`;
    if (method === 'symbol') return 'CHAIN';
    if (method === 'decimals') return _address === addr(3) ? 6 : 18;
    if (method === 'assetModes') return args[0] === addr(4) ? this.currentMode : args[0] === addr(5) ? 1 : 0;
    if (method === 'getPolicy') return { ...this.lot.policy, version: this.currentVersion };
    if (method === 'owner' || method === 'operator') return addr(20);
    const roles: Record<string, Address> = { treasury: addr(21), payout: addr(3), jar: addr(1), reader: addr(8), factory: addr(6) };
    if (roles[method]) return roles[method];
    if (['activeId', 'directPayments'].includes(method)) return 1n;
    if (method === 'allowance') return 900719925474099300001n;
    if (method === 'read') { if (this.readerError) throw this.readerError; return this.reference; }
    if (method === 'nextId') return 2n;
    if (method === 'getLot') return this.lot;
    if (method === 'paused') return this.paused;
    if (method === 'releaser') return addr(2);
    if (method === 'credits') return 900719925474099300000n;
    if (['bidLiability', 'totalCredits'].includes(method)) return 0n;
    if (['balanceOf', 'inventory'].includes(method)) return 10n ** 18n;
    if (method === 'quoteDirect') { if (this.revertQuote) throw Object.assign(new Error('do not leak'), { name: 'ContractFunctionRevertedError' }); return [990000n, this.lot.policyHash]; }
    throw new Error('Unexpected read');
  }
  async simulate(_address: Address, _abi: unknown, method: string, args: readonly unknown[], sender: Address, block: bigint) {
    this.failure(); this.calls.push({ method, args, block, sender });
    if (this.simulationError) throw this.simulationError;
    if (this.revertSimulation) throw Object.assign(new Error('do not leak'), { name: 'ContractFunctionRevertedError' });
  }
}
const appFor = (gateway = new Fake(), extra = {}) => buildApp({ manifest, gateway, abis, readinessTtl: 0, ...extra });

test('all reads are coherent, bigint strings, config and OpenAPI documented', async t => {
  const fake = new Fake(); const app = await appFor(fake); t.after(() => app.close());
  for (const path of ['/healthz', '/readyz', '/v1/config', '/v1/inventory', '/v1/lots/1', `/v1/credits/${addr(22)}`, '/v1/lots/1/quote', '/openapi.json']) {
    const response = await app.inject(path); assert.equal(response.statusCode, 200, `${path}: ${response.body}`);
  }
  assert.equal((await app.inject(`/v1/credits/${addr(22)}`)).json().data.credit, '900719925474099300000');
  assert.ok(fake.calls.every(c => c.block === 123n));
  const spec = (await app.inject('/openapi.json')).json(); assert.ok(spec.paths['/v1/transactions/prepare'].post.requestBody);
});
test('unknown IDs and invalid schemas reject before arbitrary requests', async t => {
  const app = await appFor(); t.after(() => app.close());
  assert.equal((await app.inject('/v1/lots/99')).statusCode, 404);
  assert.equal((await app.inject('/v1/lots/0')).statusCode, 400);
  assert.equal((await app.inject('/v1/credits/not-an-address')).statusCode, 400);
  for (const payload of [
    { action: 'arbitrary', sender: addr(22), params: {} },
    { action: 'withdrawRefund', sender: addr(22), params: {}, to: addr(88) },
    { action: 'withdrawRefund', sender: addr(22), params: { calldata: '0x' } },
    { action: 'withdrawRefund', sender: zeroAddress, params: {} },
    { action: 'bid', sender: addr(22), params: { id: '1', amount: '-1', recipient: addr(22) } },
    { action: 'openDirect', sender: addr(20), params: { asset: addr(4), quantity: (1n << 128n).toString(), expiry: '3000' } },
  ]) assert.equal((await app.inject({ method: 'POST', url: '/v1/transactions/prepare', payload })).statusCode, 400);
});
test('prepared calldata equals actual contract encoding, targets fixed, no broadcasting interface', async t => {
  const fake = new Fake(); const app = await appFor(fake); t.after(() => app.close());
  const payload = { action: 'fillDirect', sender: addr(22), params: { id: '1', maximum: '990000', deadline: '9000', expectedPolicyHash: fake.lot.policyHash, recipient: addr(23) } };
  const response = await app.inject({ method: 'POST', url: '/v1/transactions/prepare', payload }); assert.equal(response.statusCode, 200, response.body);
  const result = response.json(); assert.equal(result.to, addr(2)); assert.equal(result.value, '0'); assert.equal(result.from, addr(22));
  assert.equal(result.data, encodeFunctionData({ abi: abis.sale, functionName: 'fillDirect', args: [1n, 990000n, 9000n, fake.lot.policyHash, addr(23)] }));
  assert.equal(fake.calls.at(-1)?.sender, addr(22));
  for (const amount of ['990000', '990001', ((1n << 256n) - 1n).toString()]) {
    const r = await app.inject({ method: 'POST', url: '/v1/transactions/prepare', payload: { action: 'approvePayout', sender: addr(22), params: { id: '1', amount } } });
    assert.equal(r.statusCode, amount === '990000' ? 200 : 400);
    if (r.statusCode === 200) assert.equal(r.json().to, addr(3));
  }
  fake.revertSimulation = true;
  assert.equal((await app.inject({ method: 'POST', url: '/v1/transactions/prepare', payload })).statusCode, 409);
});
test('wrong chain/code and RPC outage fail readiness while liveness survives without secrets', async t => {
  for (const mode of ['chain', 'code', 'down']) {
    const fake = new Fake(); if (mode === 'chain') fake.chain = 1; if (mode === 'code') fake.badCode = true; if (mode === 'down') fake.down = true;
    const app = await appFor(fake); t.after(() => app.close());
    assert.equal((await app.inject('/healthz')).statusCode, 200);
    const response = await app.inject('/readyz'); assert.equal(response.statusCode, 503); assert.ok(!response.body.includes('SECRET_RPC_KEY'));
  }
});
test('reference refusal is business state, outage is 503, pauses retain refunds', async t => {
  const fake = new Fake(); fake.revertQuote = true; const app = await appFor(fake); t.after(() => app.close());
  const refused = await app.inject('/v1/lots/1/quote'); assert.equal(refused.statusCode, 200); assert.equal(refused.json().data.reason, 'ZERO_REFERENCE_QUOTE');
  const next = (await app.inject('/v1/lots/1')).json().data.nextActions;
  assert.ok(!next.includes('fillDirect')); assert.ok(next.includes('cancelDirect'));
  fake.paused = true; assert.equal((await app.inject('/v1/lots/1/quote')).json().data.reason, 'ADMISSION_PAUSED');
  assert.equal((await app.inject(`/v1/credits/${addr(22)}`)).statusCode, 200);
  fake.down = true; assert.equal((await app.inject('/v1/lots/1/quote')).statusCode, 503);
});
test('request size, rate limit and explicit CORS allowlist', async t => {
  const app = await appFor(new Fake(), { rateMax: 2, allowedOrigins: ['https://demo.example'] }); t.after(() => app.close());
  const allowed = await app.inject({ url: '/v1/config', headers: { origin: 'https://demo.example' } }); assert.equal(allowed.headers['access-control-allow-origin'], 'https://demo.example');
  const denied = await app.inject({ url: '/v1/config', headers: { origin: 'https://evil.example' } }); assert.equal(denied.headers['access-control-allow-origin'], undefined);
  assert.equal((await app.inject('/v1/config')).statusCode, 429);
  assert.equal((await app.inject('/healthz')).statusCode, 200);
  const other = await appFor(); t.after(() => other.close());
  const large = await other.inject({ method: 'POST', url: '/v1/transactions/prepare', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ padding: 'x'.repeat(17000) }) }); assert.equal(large.statusCode, 413);
});

test('live policies, review classification, metadata and wallet funding remain block coherent', async t => {
  const fake = new Fake(); const app = await appFor(fake, { version: 'a'.repeat(40) }); t.after(() => app.close());
  const config = (await app.inject('/v1/config')).json();
  assert.equal(config.data.version, 'a'.repeat(40)); assert.equal(config.data.roles.owner, addr(20));
  assert.equal(config.data.activeId, '1'); assert.equal(config.data.assets[0].policy.version, '9');
  assert.equal((await app.inject('/v1/lots/1')).json().data.lot.policy.version, '1', 'live policy cannot overwrite frozen lot terms');
  let inventory = (await app.inject('/v1/inventory')).json();
  const held = inventory.data.find((x: {asset: string}) => x.asset === addr(10));
  assert.equal(held.classification, 'HeldForReview'); assert.deepEqual(held.allowedModes, []);
  assert.equal(held.symbol, 'CHAIN'); assert.equal(held.decimals, 18); assert.equal(held.jar, '1000000000000000000');
  fake.currentMode = 0; fake.currentVersion = 10n;
  inventory = (await app.inject('/v1/inventory')).json();
  assert.equal(inventory.data[0].classification, 'HeldForReview'); assert.equal(inventory.data[0].policy.version, '10');
  const wallet = (await app.inject(`/v1/credits/${addr(22)}`)).json().data;
  assert.equal(wallet.allowance, '900719925474099300001'); assert.equal(wallet.payoutBalance, '1000000000000000000');
  assert.equal(wallet.spender, addr(2)); assert.equal(wallet.payout, addr(3));
  assert.ok(fake.calls.every(c => c.block === 123n));
  fake.badCodeAddress = addr(10); assert.equal((await app.inject('/readyz')).statusCode, 503);
});

test('reference diagnostics distinguish chain gates and never turn an RPC failure into a price', async t => {
  const fake = new Fake(); fake.revertQuote = true; const app = await appFor(fake); t.after(() => app.close());
  for (const [reference, reason] of [
    [[1n, 0, 0, 1000000n, 1000], 'STALE_OBSERVATION'],
    [[1n, 0, 0, 1n, 2000], 'INSUFFICIENT_LIQUIDITY'],
    [[1n, -100, 1, 1000000n, 2000], 'EXCESSIVE_DEVIATION'],
  ] as const) {
    fake.reference = reference;
    const response = await app.inject('/v1/lots/1/quote'); const data = response.json().data;
    assert.equal(response.statusCode, 200); assert.equal(data.reason, reason);
    assert.equal(data.eligible, false); assert.equal(data.payment, null);
  }
  const errorAbi = parseAbi(['error Error(string)']);
  fake.readerError = new ContractFunctionRevertedError({ abi: errorAbi, data: encodeErrorResult({ abi: errorAbi, errorName: 'Error', args: ['OLD'] }), functionName: 'read' });
  assert.equal((await app.inject('/v1/lots/1/quote')).json().data.reason, 'INCOMPLETE_HISTORY');
  fake.readerError = new Error('https://SECRET_RPC_KEY.invalid');
  const unavailable = await app.inject('/v1/lots/1/quote'); assert.equal(unavailable.statusCode, 503);
  assert.ok(!unavailable.body.includes('SECRET_RPC_KEY'));
});

test('decoded custom errors and direct bounds preserve contract authority without leaking RPC details', async t => {
  const fake = new Fake(); const app = await appFor(fake); t.after(() => app.close());
  const prepare = (params: Record<string, unknown>) => app.inject({ method: 'POST', url: '/v1/transactions/prepare', payload: { action: 'fillDirect', sender: addr(22), params: { id: '1', maximum: '990000', deadline: '9000', expectedPolicyHash: fake.lot.policyHash, recipient: addr(22), ...params } } });
  for (const [params, reason] of [[{maximum:'989999'},'MAXIMUM_EXCEEDED'],[{deadline:'1999'},'DEADLINE_EXPIRED'],[{expectedPolicyHash:`0x${'4'.repeat(64)}`},'POLICY_MISMATCH']] as const) {
    const response = await prepare(params); assert.equal(response.statusCode, 409); assert.equal(response.json().error, reason);
  }
  const error = new ContractFunctionRevertedError({ abi: abis.sale, data: encodeErrorResult({ abi: abis.sale, errorName: 'Unauthorized' }), functionName: 'setPaused' });
  assert.equal(decodedRevert(new Error('RPC key', { cause: error }))?.name, 'Unauthorized');
  fake.simulationError = new Error('RPC key', { cause: error });
  const response = await app.inject({method:'POST',url:'/v1/transactions/prepare',payload:{action:'setPaused',sender:addr(22),params:{paused:true}}});
  assert.equal(response.statusCode,409); assert.deepEqual(response.json(),{error:'UNAUTHORIZED'});
});
