// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Address, Hex } from 'viem';
import { buildApp } from '../src/app.js';
import { rpcFailureKind, rpcGateway } from '../src/gateway.js';
import { loadManifest, loadAbis } from '../src/manifest.js';
import { root, chainId, rpc, client, accounts, artifact, assertChain, broadcast, confirm, read, write, json } from './runtime.js';

let stage = 'initialization';
async function main() {
  await assertChain();
  const manifest = loadManifest(resolve(root, `deployments/${chainId === 31337 ? 'local' : 'sepolia'}.json`));
  const abis = loadAbis(resolve(root, 'backend/public')); const a = manifest.addresses as Record<keyof typeof manifest.addresses, Address>;
  const local = process.env.API_URL ? undefined : await buildApp({ manifest, version: JSON.parse(readFileSync(resolve(root, 'backend/public/build.json'), 'utf8')).sourceCommit, gateway: rpcGateway(rpc!), abis, allowedOrigins: ['https://demo.example'] });
  const url = process.env.API_URL ?? await local!.listen({ host: '127.0.0.1', port: 0 });
  if (chainId === 11155111 && process.env.API_URL && !url.startsWith('https://')) throw new Error('Public smoke requires HTTPS');
  const hashes: Hex[] = [];
  async function api(path: string, payload?: unknown) {
    stage = payload && typeof payload === 'object' && 'action' in payload ? `prepare ${String(payload.action)}` : `read ${path}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      // Reads and unsigned preparation are safe to retry; signed broadcasts stay outside this helper.
      const response = await fetch(`${url}${path}`, { method: payload ? 'POST' : 'GET', headers: payload ? { 'content-type': 'application/json' } : {}, body: payload ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(20000) });
      const result = { status: response.status, body: await response.json() };
      if (response.status !== 503 || attempt === 2) return result;
      console.log(`Retrying unavailable read/preparation (${attempt + 1}/2)`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
    throw new Error('Unreachable retry state');
  }
  const tokenBalance = async (token: Address, address: Address) => await read(token, abis.token, 'balanceOf', [address]) as bigint;
  const lot = async (id: string) => {
    const response = await api(`/v1/lots/${id}`); assert.equal(response.status, 200);
    const independent = await client.readContract({ address: a.releaser, abi: abis.sale, functionName: 'getLot', args: [BigInt(id)], blockNumber: BigInt(response.body.block) });
    assert.deepEqual(response.body.data.lot, JSON.parse(json(independent))); return response.body.data.lot;
  };
  async function send(action: string, params: unknown, signer = 'operator') {
    const prepared = await api('/v1/transactions/prepare', { action, sender: accounts[signer], params });
    assert.equal(prepared.status, 200, `${action}: ${JSON.stringify(prepared.body)}`);
    const tx = prepared.body; assert.equal(tx.chainId, chainId); assert.equal(tx.from.toLowerCase(), accounts[signer]!.toLowerCase()); assert.equal(tx.value, '0');
    assert.ok([a.releaser, a.payout].some(x => x.toLowerCase() === tx.to.toLowerCase()));
    stage = `broadcast/confirm ${action}`;
    const receipt = await confirm(await broadcast(tx.data as Hex, tx.to as Address, signer)); hashes.push(receipt.transactionHash); return receipt;
  }
  async function advance(expiry: number) {
    stage = 'wait/advance lot expiry';
    if (chainId === 31337) {
      if ((await client.getBlock()).timestamp < BigInt(expiry)) {
        await client.request({ method: 'evm_setNextBlockTimestamp' as never, params: [expiry] as never });
        await client.request({ method: 'evm_mine' as never, params: [] as never });
      }
    } else while ((await client.getBlock()).timestamp < BigInt(expiry)) { console.log('Waiting for real lot expiry'); await new Promise(r => setTimeout(r, 15000)); }
  }
  try {
    {
      // Refresh both chains: an idle Docker build can outlast the observation age.
      // Controlled fixture maintenance is signed locally and never added to the API allowlist.
      const fixtureAbi = artifact('oracle-contracts/out/LiquidityFixture.sol/LiquidityFixture.json').abi;
      const activity = await write(a.fixture, fixtureAbi, 'mint', [-887220, 887220, 1000000000n]); hashes.push(activity.transactionHash);
    }
    const health = await api('/healthz'); assert.equal(health.status, 200); const apiSourceCommit = health.body.version;
    assert.equal(health.body.chainId, chainId); assert.equal((await api('/readyz')).status, 200);
    const cfg = await api('/v1/config'); assert.equal(cfg.body.data.manifest.sourceCommit, manifest.sourceCommit); assert.equal(cfg.body.data.adopted, true);
    const adopted = await client.readContract({ address: a.jar, abi: abis.jar, functionName: 'releaser', blockNumber: BigInt(cfg.body.block) }); assert.equal(String(adopted).toLowerCase(), cfg.body.data.currentReleaser.toLowerCase());
    const unauthorized = await api('/v1/transactions/prepare', { action: 'setPaused', sender: accounts['buyer-a'], params: { paused: false } }); assert.equal(unauthorized.status, 409);
    assert.equal(cfg.body.data.roles.operator.toLowerCase(), accounts.operator!.toLowerCase());
    const inv = await api('/v1/inventory'); assert.equal(inv.status, 200);
    for (const entry of inv.body.data) {
      const at = BigInt(inv.body.block);
      assert.equal(entry.symbol, await client.readContract({address:entry.asset,abi:abis.token,functionName:'symbol',blockNumber:at}));
      assert.equal(entry.decimals, Number(await client.readContract({address:entry.asset,abi:abis.token,functionName:'decimals',blockNumber:at})));
      const mode = await client.readContract({address:a.releaser,abi:abis.sale,functionName:'assetModes',args:[entry.asset],blockNumber:at}); assert.equal(entry.mode, mode);
      if (manifest.reviewAssets.some(address => address.toLowerCase() === entry.asset.toLowerCase())) { assert.equal(entry.classification, 'HeldForReview'); assert.deepEqual(entry.allowedModes, []); }
      const value = await client.readContract({ address: entry.asset, abi: abis.token, functionName: 'balanceOf', args: [a.jar], blockNumber: at }); assert.equal(String(value), entry.jar);
    }
    assert.equal(inv.body.data.length, 3 + manifest.reviewAssets.length);
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
    const auctionId = String(await read(a.releaser, abis.sale, 'nextId')); const expiry = await timestamp() + 300;
    await send('openAuction', { asset: a.auctionAsset, quantity: '1000000000000000000', expiry: String(expiry), reserve: '1000000', increment: '100000' });
    await send('approvePayout', { id: auctionId, amount: '1000000' }, 'buyer-a');
    await send('bid', { id: auctionId, amount: '1000000', recipient: accounts['buyer-a'] }, 'buyer-a');
    await send('approvePayout', { id: auctionId, amount: '1100000' }, 'buyer-a');
    await send('bid', { id: auctionId, amount: '1100000', recipient: accounts['buyer-a'] }, 'buyer-a');
    assert.equal(await read(a.releaser, abis.sale, 'credits', [accounts['buyer-a']]), 1000000n);
    await send('approvePayout', { id: auctionId, amount: '1200000' }, 'buyer-b');
    await send('bid', { id: auctionId, amount: '1200000', recipient: accounts['buyer-b'] }, 'buyer-b');
    const credit = await api(`/v1/credits/${accounts['buyer-a']}`); assert.equal(credit.body.data.credit, '2100000');
    const creditOnchain = await client.readContract({ address: a.releaser, abi: abis.sale, functionName: 'credits', args: [accounts['buyer-a']], blockNumber: BigInt(credit.body.block) }); assert.equal(String(creditOnchain), credit.body.data.credit);
    const refundedBefore = await tokenBalance(a.payout, accounts['buyer-a']!); await send('withdrawRefund', {}, 'buyer-a'); assert.equal(await tokenBalance(a.payout, accounts['buyer-a']!), refundedBefore + 2100000n);
    const treasuryBefore = await tokenBalance(a.payout, accounts.treasury!); const wonBefore = await tokenBalance(a.auctionAsset, accounts['buyer-b']!);
    await advance(expiry); await send('finalizeAuction', { id: auctionId }, 'buyer-b');
    assert.equal(await tokenBalance(a.payout, accounts.treasury!), treasuryBefore + 1200000n); assert.equal(await tokenBalance(a.auctionAsset, accounts['buyer-b']!), wonBefore + 10n ** 18n);
    const noBidId = String(await read(a.releaser, abis.sale, 'nextId')); const noBidExpiry = await timestamp() + (chainId === 31337 ? 120 : 60);
    const jarBefore = await tokenBalance(a.auctionAsset, a.jar);
    await send('openAuction', { asset: a.auctionAsset, quantity: '1000000000000000000', expiry: String(noBidExpiry), reserve: '1000000', increment: '100000' });
    await advance(noBidExpiry); await send('finalizeAuction', { id: noBidId }, 'buyer-a'); await send('recover', { id: noBidId }, 'buyer-b');
    assert.equal(await tokenBalance(a.auctionAsset, a.jar), jarBefore); assert.equal((await lot(noBidId)).state, 5);
    for (const payload of [{ action: 'unknown', sender: accounts.operator, params: {} }, { action: 'withdrawRefund', sender: accounts.operator, params: {}, to: accounts.treasury }]) assert.equal((await api('/v1/transactions/prepare', payload)).status, 400);
    assert.equal(hashes.length, 16);
    const report = { chainId, apiSourceCommit, expectedTransactionCount: hashes.length, sourceCommit: manifest.sourceCommit, api: process.env.API_URL ?? 'local ephemeral HTTP API', passed: ['chain/config/code', 'block-tagged reads', 'direct bounds and sale', 'auction self-outbid/outbid/refund/settlement', 'permissionless no-bid recovery', 'invalid action/target', 'live metadata/policies/review inventory'], transactions: hashes, timestamp: new Date().toISOString() };
    writeFileSync(resolve(root, chainId === 31337 ? '.local/local-smoke.json' : process.env.API_URL ? 'deployments/azure-smoke.json' : 'deployments/sepolia-smoke.json'), json(report));
    console.log(json(report));
  } finally { await local?.close(); }
}
main().catch(error => { console.error(error instanceof assert.AssertionError ? error.message : `Smoke failed during ${stage} (${rpcFailureKind(error)}); no deployed success claimed. RPC details suppressed.`); process.exitCode = 1; });
