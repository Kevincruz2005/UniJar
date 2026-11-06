// SPDX-License-Identifier: AGPL-3.0-only
// Official SDK capability mocks: these tests do not contact a DON or Sepolia.
import { expect } from 'bun:test';
import { test, newTestRuntime, EvmMock, HttpActionsMock, addContractMock } from '@chainlink/cre-sdk/test';
import { blockNumber, hexToBase64, protoBigIntToBigint } from '@chainlink/cre-sdk';
import { decodeAbiParameters, parseAbiParameters, type Address, type Hex } from 'viem';
import { SEPOLIA_GENESIS } from '../../../backend/src/cre-domain';
import { configSchema, type Config } from '../src/config';
import { onSchedule, selector } from '../src/workflow';
import { receiverABI, saleABI } from '../src/abi';
const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address;
const hash = `0x${'ab'.repeat(32)}` as Hex;
const now = 1_793_980_000n;
const config: Config = { schedule: '0 */5 * * * *', chainName: 'ethereum-testnet-sepolia', chainId: 11155111,
  releaser: addr(1), receiver: addr(2), releaserCodeHash: hash, simulationOnly: true, gasBudgetWei: '1000000000000000', maxGasPriceWei: '200000000000',
  maxExternalAgeSeconds: 180, maxDeferralSeconds: 1800, reportLifetimeSeconds: 300, finalizeGasUnits: '650000', recoverGasUnits: '650000', deliveryGasLimit: '1000000' };
function fixture(options: { state?: number; highest?: bigint; expiry?: bigint; mode?: number; active?: bigint; budget?: string; httpStatus?: number; stats?: unknown; genesis?: Hex; paused?: boolean; chainId?: bigint; writeStatus?: 'TX_STATUS_SUCCESS' | 'TX_STATUS_REVERTED'; receiverStatus?: 'RECEIVER_CONTRACT_EXECUTION_STATUS_REVERTED' } = {}) {
  const c = { ...config, gasBudgetWei: options.budget ?? config.gasBudgetWei };
  const runtime = newTestRuntime(null, { timeProvider: () => Number(now) * 1000 }, c);
  const evm = EvmMock.testInstance(selector);
  evm.headerByNumber = input => {
    const zero = input.blockNumber && protoBigIntToBigint(input.blockNumber) === 0n;
    return { header: { timestamp: String(now), blockNumber: blockNumber(zero ? 0n : 100n), hash: hexToBase64(zero ? options.genesis ?? SEPOLIA_GENESIS : hash) } };
  };
  const receiver = addContractMock(evm, { address: c.receiver as Address, abi: receiverABI });
  receiver.readContext = () => [options.chainId ?? 11155111n, 100n, now, 17n, hash, options.active ?? 27n];
  receiver.releaser = () => c.releaser; receiver.simulationOnly = () => true; receiver.automationPaused = () => options.paused ?? false;
  const sale = addContractMock(evm, { address: c.releaser as Address, abi: saleABI });
  sale.getLot = () => ({ mode: options.mode ?? 1, state: options.state ?? 1, asset: addr(3), quantity: 10n, committedAt: now - 400n,
    expiry: options.expiry ?? now - 60n, reserve: 1n, increment: 1n, bidder: addr(4), recipient: addr(4), highest: options.highest ?? 100n,
    policyHash: hash, policy: { pool: addr(5), fee: 3000, window: 60, maxAge: 300, minLiquidity: 1n, maxQuantity: 100n, maxTickDeviation: 100,
      discountBps: 0, maxDuration: 1000, version: 1n } });
  let writes = 0; let body: Uint8Array | undefined; let requests = 0;
  receiver.writeReport = input => { writes++; body = input.report.rawReport.slice(109); return { txStatus: options.writeStatus ?? 'TX_STATUS_SUCCESS',
    receiverContractExecutionStatus: options.receiverStatus ?? 'RECEIVER_CONTRACT_EXECUTION_STATUS_SUCCESS', txHash: hexToBase64(hash) }; };
  HttpActionsMock.testInstance().sendRequest = input => {
    requests++; const data = input.url.endsWith('/blocks/0') ? { height: 0, hash: SEPOLIA_GENESIS } : options.stats ?? { gas_price_updated_at: new Date(Number(now) * 1000).toISOString(), gas_prices: { average: 0.33 } };
    return { statusCode: options.httpStatus ?? 200, body: Buffer.from(JSON.stringify(data)).toString('base64') };
  };
  return { runtime, run: () => onSchedule(runtime), writes: () => writes, body: () => body, requests: () => requests };
}
test('funded expiry uses the real SDK report and write capabilities despite a small nonurgent budget', () => {
  const f = fixture({ budget: '1' }); expect(f.run()).toBe('WRITE_CAPABILITY_SUCCEEDED'); expect(f.writes()).toBe(1); expect(f.requests()).toBe(2);
  const report = decodeAbiParameters(parseAbiParameters('uint256,address,uint256,uint8,uint8,uint64,uint64,bytes32,uint64,uint64,bytes32,bytes32,bytes32,uint64,uint256'), `0x${Buffer.from(f.body()!).toString('hex')}`);
  expect(report[0]).toBe(11155111n); expect(report[2]).toBe(27n); expect(report[3]).toBe(1); expect(report[14]).toBe(330000000n);
});
test('no-bid finalization and Unsold recovery produce distinct authorized actions', () => {
  const a = fixture({ highest: 0n }); expect(a.run()).toBe('WRITE_CAPABILITY_SUCCEEDED');
  const b = fixture({ state: 4, highest: 0n }); expect(b.run()).toBe('WRITE_CAPABILITY_SUCCEEDED'); expect(a.body()).not.toEqual(b.body());
});
test('pre-expiry, completed and empty active slots do not request writes', () => {
  for (const options of [{ expiry: now + 30n }, { state: 2 }, { state: 5 }, { active: 0n }, { mode: 2 }]) {
    const f = fixture(options); f.run(); expect(f.writes()).toBe(0);
  }
});
test('nonurgent gas budget defers safely and maximum deferral completes', () => {
  const f = fixture({ state: 4, highest: 0n, budget: '1' }); expect(f.run()).toBe('GAS_BUDGET_DEFERRAL'); expect(f.writes()).toBe(0);
  const old = fixture({ state: 4, highest: 0n, budget: '1', expiry: now - 2000n }); expect(old.run()).toBe('WRITE_CAPABILITY_SUCCEEDED');
});
test('bad HTTP, rate limiting, malformed and stale data refuse without a report', () => {
  for (const options of [{ httpStatus: 429 }, { httpStatus: 503 }, { stats: {} }, { stats: { gas_price_updated_at: '2020-01-01T00:00:00Z', gas_prices: { average: 0.33 } } }]) {
    const f = fixture(options); expect(f.run()).toBe('DATA_UNAVAILABLE'); expect(f.writes()).toBe(0);
  }
});
test('wrong EVM network, wrong receiver chain and failed delivery cannot claim success', () => {
  expect(() => fixture({ genesis: hash }).run()).toThrow('WRONG_EVM_NETWORK');
  expect(() => fixture({ chainId: 1n }).run()).toThrow('PINNED_DEPLOYMENT_MISMATCH');
  expect(() => fixture({ writeStatus: 'TX_STATUS_REVERTED' }).run()).toThrow('CRE_WRITE_FAILED');
  expect(() => fixture({ receiverStatus: 'RECEIVER_CONTRACT_EXECUTION_STATUS_REVERTED' }).run()).toThrow('CRE_WRITE_FAILED');
});
test('paused automation makes no HTTP or write call', () => {
  const f = fixture({ paused: true }); expect(f.run()).toBe('AUTOMATION_PAUSED'); expect(f.requests()).toBe(0); expect(f.writes()).toBe(0);
});
test('configuration rejects mainnet, arbitrary hosts and unbounded delivery gas', () => {
  expect(configSchema.safeParse(config).success).toBe(true);
  for (const bad of [{ chainId: 1 }, { gasSource: 'https://example.com' }, { deliveryGasLimit: '9999999' }, { maxExternalAgeSeconds: 99999 }]) expect(configSchema.safeParse({ ...config, ...bad }).success).toBe(false);
});
