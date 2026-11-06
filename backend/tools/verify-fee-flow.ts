// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeEventLog, type Abi, type Address, type Hex, type TransactionReceipt } from 'viem';
import { loadManifest, loadAbis } from '../src/manifest.js';
import { rpcGateway } from '../src/gateway.js';
import { root, chainId, client, rpc, assertChain, json } from './runtime.js';

async function main() {
  await assertChain(); assert.equal(chainId, 11155111);
  const m = loadManifest(resolve(root, 'deployments/sepolia.json')); assert.ok(m.feeSource && m.addresses.feeSource);
  const abis = loadAbis(resolve(root, 'backend/public'));
  const wallet = JSON.parse(readFileSync(resolve(root, process.argv[2] ?? '.local/frontend-wallet-sepolia.json'), 'utf8'));
  assert.equal(wallet.chainId, chainId);
  const web = JSON.parse(readFileSync(resolve(root, 'deployments/frontend.json'), 'utf8'));
  const api = JSON.parse(readFileSync(resolve(root, 'deployments/azure.json'), 'utf8'));
  assert.equal(wallet.url, web.url);
  const receipts: TransactionReceipt[] = [];
  // Sequential reads avoid turning verification itself into another RPC burst.
  for (const { hash } of wallet.transactions as { hash: Hex }[]) {
    const receipt = await client.getTransactionReceipt({ hash }); assert.equal(receipt.status, 'success');
    receipts.push(receipt); await new Promise(r => setTimeout(r, 150));
  }
  function event(receipt: TransactionReceipt, address: string, abi: Abi, name: string): Record<string, any> | undefined {
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== address.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({ abi, topics: log.topics, data: log.data, strict: true });
        if (decoded.eventName === name) return decoded.args as Record<string, any>;
      } catch { /* Other logs are not evidence for this event. */ }
    }
  }
  const paymentReceipt = receipts.find(r => event(r, m.addresses.feeSource!, abis.fee, 'ReceiptPaid')); assert.ok(paymentReceipt);
  const payment = event(paymentReceipt, m.addresses.feeSource, abis.fee, 'ReceiptPaid')!;
  const openedReceipt = receipts.find(r => r.blockNumber >= paymentReceipt.blockNumber && event(r, m.addresses.releaser, abis.sale, 'Opened')?.asset.toLowerCase() === m.feeSource!.asset.toLowerCase()); assert.ok(openedReceipt);
  const opened = event(openedReceipt, m.addresses.releaser, abis.sale, 'Opened')!;
  const settledReceipt = receipts.find(r => event(r, m.addresses.releaser, abis.sale, 'Sale')?.id === opened.id); assert.ok(settledReceipt);
  const settled = event(settledReceipt, m.addresses.releaser, abis.sale, 'Sale')!;
  assert.equal(payment.price, BigInt(m.feeSource.price));
  assert.equal(payment.jarFee, payment.price * BigInt(m.feeSource.feeBps) / 10000n);
  assert.equal(payment.merchantPayment + payment.jarFee, payment.price);
  assert.equal(opened.mode, 1); assert.equal(opened.quantity, payment.jarFee); assert.equal(settled.delivered, opened.quantity);
  const gateway = rpcGateway(rpc!);
  async function balances(token: string, account: string, at: bigint) {
    return await gateway.read(token as Address, abis.token, 'balanceOf', [account], at) as bigint;
  }
  const asset = m.feeSource.asset; const before = paymentReceipt.blockNumber - 1n; const after = paymentReceipt.blockNumber;
  const observed = {
    payerBefore: await balances(asset, payment.payer, before), payerAfter: await balances(asset, payment.payer, after),
    jarBefore: await balances(asset, m.addresses.jar, before), jarAfterCollection: await balances(asset, m.addresses.jar, after),
    merchantBefore: await balances(asset, m.feeSource.merchant, before), merchantAfter: await balances(asset, m.feeSource.merchant, after),
    jarAfterOpening: await balances(asset, m.addresses.jar, openedReceipt.blockNumber),
    jarAfterSettlement: await balances(asset, m.addresses.jar, settledReceipt.blockNumber),
    buyerBeforeSettlement: await balances(asset, settled.recipient, settledReceipt.blockNumber - 1n), buyerAfterSettlement: await balances(asset, settled.recipient, settledReceipt.blockNumber),
    treasuryBeforeSettlement: await balances(m.addresses.payout, m.roles.treasury, settledReceipt.blockNumber - 1n), treasuryAfterSettlement: await balances(m.addresses.payout, m.roles.treasury, settledReceipt.blockNumber),
    serviceBalance: await balances(asset, m.addresses.feeSource, settledReceipt.blockNumber),
  };
  assert.equal(observed.payerBefore - observed.payerAfter, payment.price);
  assert.equal(observed.jarAfterCollection - observed.jarBefore, payment.jarFee);
  assert.equal(observed.merchantAfter - observed.merchantBefore, payment.merchantPayment);
  assert.equal(observed.jarAfterOpening, observed.jarBefore); assert.equal(observed.jarAfterSettlement, observed.jarBefore);
  assert.equal(observed.buyerAfterSettlement - observed.buyerBeforeSettlement, payment.jarFee);
  assert.equal(observed.treasuryAfterSettlement - observed.treasuryBeforeSettlement, settled.payment);
  assert.equal(observed.serviceBalance, 0n);
  const report = { status: 'passed', chainId, verifiedAt: new Date().toISOString(), webSourceCommit: web.sourceCommit, apiSourceCommit: api.sourceCommit, url: web.url, feeSource: { address: m.addresses.feeSource, ...m.feeSource },
    receipt: { hash: paymentReceipt.transactionHash, block: paymentReceipt.blockNumber, ...payment }, lot: { id: opened.id, openedHash: openedReceipt.transactionHash, settledHash: settledReceipt.transactionHash, ...settled }, observed,
    assertions: ['successful real Sepolia receipts', 'exact payer debit and merchant/jar split', 'collected fee quantity committed to the original releaser', 'original jar balance preserved after fee sale', 'buyer receives the exact collected fee quantity', 'funded payout reaches treasury', 'receipt service holds zero tokens'],
    scope: 'Controlled test-token payments and disposable wallets; no production revenue or real browser-extension validation claimed.' };
  writeFileSync(resolve(root, 'deployments/fee-source-validation.json'), json(report));
  console.log('Receipt payment → original TokenJar → exact lot → treasury verified from Sepolia receipts and block-pinned balances.');
}
main().catch(() => { console.error('Fee-flow verification failed; RPC details suppressed. No successful verification claimed.'); process.exitCode = 1; });
