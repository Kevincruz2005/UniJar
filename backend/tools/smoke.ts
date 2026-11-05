// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Address, Hex } from 'viem';
import { buildApp } from '../src/app.js';
import { rpcGateway } from '../src/gateway.js';
import { loadManifest, loadAbis } from '../src/manifest.js';
import { root, chainId, rpc, client, accounts, artifact, assertChain, broadcast, confirm, read, write, json } from './runtime.js';

async function main() {
  await assertChain();
  const manifest = loadManifest(resolve(root, `deployments/${chainId === 31337 ? 'local' : 'sepolia'}.json`));
  const abis = loadAbis(resolve(root, 'backend/public')); const a = manifest.addresses as Record<keyof typeof manifest.addresses, Address>;
  const local = process.env.API_URL ? undefined : await buildApp({ manifest, gateway: rpcGateway(rpc!), abis, allowedOrigins: ['https://demo.example'] });
  const url = process.env.API_URL ?? await local!.listen({ host: '127.0.0.1', port: 0 });
  if (chainId === 11155111 && process.env.API_URL && !url.startsWith('https://')) throw new Error('Public smoke requires HTTPS');
  const hashes: Hex[] = [];
  async function api(path: string, payload?: unknown) {
    const response = await fetch(`${url}${path}`, { method: payload ? 'POST' : 'GET', headers: payload ? { 'content-type': 'application/json' } : {}, body: payload ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(20000) });
    return { status: response.status, body: await response.json() };
  }
  const tokenBalance = async (token: Address, address: Address) => await read(token, abis.token, 'balanceOf', [address]) as bigint;
  const lot = async (id: string) => (await api(`/v1/lots/${id}`)).body.data.lot;
  async function send(action: string, params: unknown, signer = 'operator') {
    const prepared = await api('/v1/transactions/prepare', { action, sender: accounts[signer], params });
    assert.equal(prepared.status, 200, `${action}: ${JSON.stringify(prepared.body)}`);
    const tx = prepared.body; assert.equal(tx.chainId, chainId); assert.equal(tx.from.toLowerCase(), accounts[signer]!.toLowerCase()); assert.equal(tx.value, '0');
    assert.ok([a.releaser, a.payout].some(x => x.toLowerCase() === tx.to.toLowerCase()));
    const receipt = await confirm(await broadcast(tx.data as Hex, tx.to as Address, signer)); hashes.push(receipt.transactionHash); return receipt;
  }
  async function advance(expiry: number) {
    if (chainId === 31337) {
      await client.request({ method: 'evm_setNextBlockTimestamp' as never, params: [expiry] as never });
      await client.request({ method: 'evm_mine' as never, params: [] as never });
    } else while ((await client.getBlock()).timestamp < BigInt(expiry)) { console.log('Waiting for real lot expiry'); await new Promise(r => setTimeout(r, 15000)); }
  }
  try {
    if (chainId === 11155111) {
      // Controlled fixture maintenance is signed locally and never added to the API allowlist.
      const fixtureAbi = artifact('oracle-contracts/out/LiquidityFixture.sol/LiquidityFixture.json').abi;
      const activity = await write(a.fixture, fixtureAbi, 'mint', [-887220, 887220, 1000000000n]); hashes.push(activity.transactionHash);
    }
    assert.equal((await api('/healthz')).status, 200); assert.equal((await api('/readyz')).status, 200);
    const cfg = await api('/v1/config'); assert.equal(cfg.body.data.manifest.sourceCommit, manifest.sourceCommit); assert.equal(cfg.body.data.adopted, true);
    const inv = await api('/v1/inventory'); assert.equal(inv.status, 200);
    for (const entry of inv.body.data) {
      const at = BigInt(inv.body.block);
      const value = await client.readContract({ address: entry.asset, abi: abis.token, functionName: 'balanceOf', args: [a.jar], blockNumber: at }); assert.equal(String(value), entry.jar);
    }
    assert.equal(await read(a.releaser, abis.sale, 'activeId'), 0n, 'Smoke requires no unresolved lot');
    const timestamp = async () => Number((await client.getBlock()).timestamp);
    const directId = String(await read(a.releaser, abis.sale, 'nextId'));
    await send('openDirect', { asset: a.directAsset, quantity: '1000000000000000000', expiry: String(await timestamp() + 1800) });
    const quote = await api(`/v1/lots/${directId}/quote`); assert.equal(quote.status, 200); assert.equal(quote.body.data.eligible, true, JSON.stringify(quote.body));
    const payment = BigInt(quote.body.data.payment); const frozen = quote.body.data.policyHash;
    const independent = await client.readContract({ address: a.releaser, abi: abis.sale, functionName: 'quoteDirect', args: [BigInt(directId)], blockNumber: BigInt(quote.body.block) }) as readonly [bigint, Hex]; assert.equal(independent[0], payment); assert.equal(independent[1], frozen);
    await send('approvePayout', { id: directId, amount: payment.toString() }, 'buyer-a');
    const bounds = { id: directId, maximum: (payment - 1n).toString(), deadline: String(await timestamp() + 600), expectedPolicyHash: frozen, recipient: accounts['buyer-a'] };
    const rejected = await api('/v1/transactions/prepare', { action: 'fillDirect', sender: accounts['buyer-a'], params: bounds }); assert.equal(rejected.status, 409);
    const before = await tokenBalance(a.payout, accounts.treasury!); const inventoryBefore = await tokenBalance(a.directAsset, accounts['buyer-a']!);
    await send('fillDirect', { ...bounds, maximum: payment.toString() }, 'buyer-a');
    assert.equal(await tokenBalance(a.payout, accounts.treasury!), before + payment); assert.equal(await tokenBalance(a.directAsset, accounts['buyer-a']!), inventoryBefore + 10n ** 18n); assert.equal((await lot(directId)).state, 2);
    const auctionId = String(await read(a.releaser, abis.sale, 'nextId')); const expiry = await timestamp() + (chainId === 31337 ? 30 : 300);
    await send('openAuction', { asset: a.auctionAsset, quantity: '1000000000000000000', expiry: String(expiry), reserve: '1000000', increment: '100000' });
    await send('approvePayout', { id: auctionId, amount: '1000000' }, 'buyer-a');
    await send('bid', { id: auctionId, amount: '1000000', recipient: accounts['buyer-a'] }, 'buyer-a');
    await send('approvePayout', { id: auctionId, amount: '1100000' }, 'buyer-b');
    await send('bid', { id: auctionId, amount: '1100000', recipient: accounts['buyer-b'] }, 'buyer-b');
    const credit = await api(`/v1/credits/${accounts['buyer-a']}`); assert.equal(credit.body.data.credit, '1000000');
    const refundedBefore = await tokenBalance(a.payout, accounts['buyer-a']!); await send('withdrawRefund', {}, 'buyer-a'); assert.equal(await tokenBalance(a.payout, accounts['buyer-a']!), refundedBefore + 1000000n);
    const treasuryBefore = await tokenBalance(a.payout, accounts.treasury!); const wonBefore = await tokenBalance(a.auctionAsset, accounts['buyer-b']!);
    await advance(expiry); await send('finalizeAuction', { id: auctionId }, 'buyer-b');
    assert.equal(await tokenBalance(a.payout, accounts.treasury!), treasuryBefore + 1100000n); assert.equal(await tokenBalance(a.auctionAsset, accounts['buyer-b']!), wonBefore + 10n ** 18n);
    const noBidId = String(await read(a.releaser, abis.sale, 'nextId')); const noBidExpiry = await timestamp() + (chainId === 31337 ? 10 : 60);
    const jarBefore = await tokenBalance(a.auctionAsset, a.jar);
    await send('openAuction', { asset: a.auctionAsset, quantity: '1000000000000000000', expiry: String(noBidExpiry), reserve: '1000000', increment: '100000' });
    await advance(noBidExpiry); await send('finalizeAuction', { id: noBidId }, 'buyer-a'); await send('recover', { id: noBidId }, 'buyer-b');
    assert.equal(await tokenBalance(a.auctionAsset, a.jar), jarBefore); assert.equal((await lot(noBidId)).state, 5);
    for (const payload of [{ action: 'unknown', sender: accounts.operator, params: {} }, { action: 'withdrawRefund', sender: accounts.operator, params: {}, to: accounts.treasury }]) assert.equal((await api('/v1/transactions/prepare', payload)).status, 400);
    const report = { chainId, sourceCommit: manifest.sourceCommit, api: process.env.API_URL ?? 'local ephemeral HTTP API', passed: ['chain/config/code', 'block-tagged reads', 'direct bounds and sale', 'auction outbid/refund/settlement', 'permissionless no-bid recovery', 'invalid action/target'], transactions: hashes, timestamp: new Date().toISOString() };
    writeFileSync(resolve(root, chainId === 31337 ? '.local/local-smoke.json' : process.env.API_URL ? 'deployments/azure-smoke.json' : 'deployments/sepolia-smoke.json'), json(report));
    console.log(json(report));
  } finally { await local?.close(); }
}
main().catch(error => { console.error(error instanceof assert.AssertionError ? error.message : 'Smoke failed; no deployed success claimed. Verify manifest, fresh oracle, funding and RPC.'); process.exitCode = 1; });
