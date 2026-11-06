import test from 'node:test';
import assert from 'node:assert/strict';
import { amount, units, minimumBid, recipientAddress, validateConfig, expectedTransaction, validatePrepared, type Config, type Deployment, type Lot, type Prepared, type Intent } from '../src/domain';
import manifest from '../../deployments/sepolia.json';
import type { Address, Hex } from 'viem';
const deployment = manifest as unknown as Deployment;
const sender = manifest.roles.buyerA as Address;
const hash = `0x${'ab'.repeat(32)}` as Hex;
const intent: Intent = { action: 'fillDirect', params: { id: '1', maximum: '1234567', deadline: '1900000000', expectedPolicyHash: hash, recipient: sender } };
const prepared = (): Prepared => ({ chainId: deployment.chainId, from: sender, ...expectedTransaction(intent, deployment), value: '0', expectedPolicyHash: hash, simulationBlock: '1', limits: intent.params });

test('token display preserves full bigint precision and significant fractional digits', () => {
  assert.equal(amount('90071992547409931234567890123456789', 18), '90,071,992,547,409,931.234567890123456789');
  assert.equal(amount('1', 18), '0.000000000000000001');
  assert.equal(amount('1000000', 6), '1');
});
test('amount input rejects precision loss, exponents, signs and out-of-range values', () => {
  assert.equal(units('1.000001', 6), '1000001');
  for (const input of ['1.0000001', '1e6', '-1', '+1', '0', '01', 'Infinity', '', '1,000']) assert.throws(() => units(input, 6));
  assert.throws(() => units((1n << 256n).toString(), 0));
});
test('minimum bids use full reserve or full highest plus increment, never net of credits', () => {
  assert.equal(minimumBid({ highest: '0', reserve: '10', increment: '3' } as Lot), '10');
  assert.equal(minimumBid({ highest: '9007199254740993', reserve: '10', increment: '3' } as Lot), '9007199254740996');
});
test('recipient validation rejects zero and custody targets', () => {
  assert.equal(recipientAddress(sender, [manifest.addresses.jar]), sender);
  for (const bad of ['0x' + '0'.repeat(40), 'bad', manifest.addresses.jar]) assert.throws(() => recipientAddress(bad, [manifest.addresses.jar]));
});
test('deployment validation rejects source, contract and code mismatches', () => {
  const config = { manifest: structuredClone(deployment), roles: { jar: manifest.addresses.jar, payout: manifest.addresses.payout } } as unknown as Config;
  assert.equal(validateConfig(config, deployment), config);
  const changed = structuredClone(config); changed.manifest.chainId = 1; assert.throws(() => validateConfig(changed, deployment));
  const code = structuredClone(config); code.manifest.deployments.releaser!.codeHash = hash; assert.throws(() => validateConfig(code, deployment));
  const target = structuredClone(config); target.manifest.addresses.releaser = sender; assert.throws(() => validateConfig(target, deployment));
});
test('valid preparation matches the exact encoded intent', () => {
  assert.equal(validatePrepared(prepared(), intent, sender, deployment).chainId, 11155111);
  const approval = expectedTransaction({ action: 'approvePayout', params: { amount: '123', id: '1' } }, deployment);
  assert.equal(approval.to, manifest.addresses.payout);
  assert.ok(approval.data.endsWith(BigInt(123).toString(16).padStart(64, '0')));
});
test('wallet guard refuses altered chain, sender, native value, calldata and targets', () => {
  for (const patch of [{ chainId: 1 }, { from: manifest.addresses.jar }, { to: sender }, { value: '1' }, { data: '0x1234' }]) assert.throws(() => validatePrepared({ ...prepared(), ...patch } as Prepared, intent, sender, deployment));
  const otherAmount = { ...intent, params: { ...intent.params, maximum: '999999999' } };
  assert.throws(() => validatePrepared(prepared(), otherAmount, sender, deployment));
});
test('wallet guard binds the frozen policy and refuses unsupported calls', () => {
  assert.throws(() => validatePrepared({ ...prepared(), expectedPolicyHash: null }, intent, sender, deployment));
  assert.throws(() => expectedTransaction({ action: 'transfer', params: {} }, deployment));
});
