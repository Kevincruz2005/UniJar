// SPDX-License-Identifier: AGPL-3.0-only
import {
  EVMClient, HTTPClient, CronCapability, handler, consensusIdenticalAggregation,
  blockNumber, LATEST_BLOCK_NUMBER, protoBigIntToBigint, bytesToHex,
  encodeCallMsg, prepareReportRequest, TxStatus, type Runtime, type HTTPSendRequester,
} from '@chainlink/cre-sdk';
import { encodeFunctionData, decodeFunctionResult, encodeAbiParameters, parseAbiParameters, keccak256, type Address, type Hex } from 'viem';
import { GAS_SOURCE_URL, GAS_IDENTITY_URL, SEPOLIA_GENESIS, validateGasResponse, gasFailure, settlementDecision, type AuctionSnapshot, type GasResult } from '../../../backend/src/cre-domain';
import { saleABI, receiverABI } from './abi';
import { type Config } from './config';

export const selector = EVMClient.SUPPORTED_CHAIN_SELECTORS['ethereum-testnet-sepolia'];
const reportTypes = parseAbiParameters('uint256,address,uint256,uint8,uint8,uint64,uint64,bytes32,uint64,uint64,bytes32,bytes32,bytes32,uint64,uint256');
const serialize = (v: unknown): string => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? x.toString() : x);

// Only static, public Sepolia hosts. Two requests, no retry loop or API credentials.
// Return a canonical string so every node must agree on the same meaningful observation.
export function fetchGas(send: HTTPSendRequester, nowText: string, maxAge: number, maxPrice: string): string {
  const now = BigInt(nowText);
  try {
    const get = (url: string): unknown => {
      const response = send.sendRequest({ url, method: 'GET', timeout: '8s',
        multiHeaders: { Accept: { values: ['application/json'] }, 'User-Agent': { values: ['Mozilla/5.0 UniJar-CRE/0.1'] } },
        cacheSettings: { store: false },
      }).result();
      if (response.statusCode !== 200) throw new Error(`HTTP_${response.statusCode}`);
      if (response.body.length > 100_000) throw new Error('OVERSIZED_RESPONSE');
      return JSON.parse(new TextDecoder().decode(response.body));
    };
    return serialize(validateGasResponse(get(GAS_SOURCE_URL), get(GAS_IDENTITY_URL), now, BigInt(maxAge), BigInt(maxPrice)));
  } catch {
    return serialize(gasFailure('HTTP_UNAVAILABLE_OR_MALFORMED', now));
  }
}
export function restoreGas(text: string): GasResult {
  const gas = JSON.parse(text);
  gas.observedAt = BigInt(gas.observedAt);
  if (gas.status === 'VALID') { gas.gasPriceWei = BigInt(gas.gasPriceWei); gas.updatedAt = BigInt(gas.updatedAt); }
  return gas as GasResult;
}
export function encodeActionReport(c: Config, lot: AuctionSnapshot, action: 1 | 2, height: bigint, hash: Hex, observedAt: bigint, gas: Extract<GasResult, { status: 'VALID' }>): { payload: Hex; requestId: Hex } {
  const deadline = observedAt + BigInt(c.reportLifetimeSeconds);
  // Bind request identity to this receiver, observation, state and external-data evidence.
  const requestId = keccak256(encodeAbiParameters(parseAbiParameters('address,uint256,address,uint256,uint8,uint8,uint64,uint64,bytes32,bytes32'),
    [c.receiver as Address, BigInt(c.chainId), c.releaser as Address, lot.id, action, lot.state, lot.expiry, height, hash, gas.sourceDataHash]));
  return { requestId, payload: encodeAbiParameters(reportTypes, [BigInt(c.chainId), c.releaser as Address, lot.id, action, lot.state, lot.expiry, height, hash,
    observedAt, deadline, requestId, gas.sourceId, gas.sourceDataHash, gas.updatedAt, gas.gasPriceWei]) };
}
export function onSchedule(runtime: Runtime<Config>): string {
  const c = runtime.config;
  const evm = new EVMClient(selector);
  const genesis = evm.headerByNumber(runtime, { blockNumber: blockNumber(0n) }).result().header;
  if (!genesis || bytesToHex(genesis.hash).toLowerCase() !== SEPOLIA_GENESIS) throw new Error('WRONG_EVM_NETWORK');
  const header = evm.headerByNumber(runtime, { blockNumber: LATEST_BLOCK_NUMBER }).result().header;
  if (!header?.blockNumber) throw new Error('MISSING_EVM_HEADER');
  const height = protoBigIntToBigint(header.blockNumber);
  const read = (to: Address, data: Hex): Hex => bytesToHex(evm.callContract(runtime, {
    call: encodeCallMsg({ from: '0x0000000000000000000000000000000000000000', to, data }), blockNumber: blockNumber(height),
  }).result().data) as Hex;
  const receiver = (name: 'readContext' | 'releaser' | 'simulationOnly' | 'automationPaused') => decodeFunctionResult({ abi: receiverABI, functionName: name,
    data: read(c.receiver as Address, encodeFunctionData({ abi: receiverABI, functionName: name })) });
  const context = receiver('readContext') as readonly [bigint, bigint, bigint, bigint, Hex, bigint];
  const [chainId, contextHeight, observedAt, baseFeeWei, codeHash, activeId] = context;
  if (chainId !== 11155111n || contextHeight !== height || observedAt !== header.timestamp || codeHash.toLowerCase() !== c.releaserCodeHash.toLowerCase()
    || String(receiver('releaser')).toLowerCase() !== c.releaser.toLowerCase() || receiver('simulationOnly') !== c.simulationOnly) throw new Error('PINNED_DEPLOYMENT_MISMATCH');
  const now = BigInt(Math.floor(runtime.now().getTime() / 1000));
  if (observedAt > now + 30n || now - observedAt > 120n) throw new Error('STALE_EVM_HEAD');
  if (receiver('automationPaused')) { runtime.log('AUTOMATION_PAUSED: manual UniJar exits remain available.'); return 'AUTOMATION_PAUSED'; }
  let lot: AuctionSnapshot | undefined;
  if (activeId !== 0n) {
    const value = decodeFunctionResult({ abi: saleABI, functionName: 'getLot', data: read(c.releaser as Address, encodeFunctionData({ abi: saleABI, functionName: 'getLot', args: [activeId] })) });
    lot = { id: activeId, mode: value.mode, state: value.state, expiry: value.expiry, committedAt: value.committedAt, highest: value.highest, quantity: value.quantity, asset: value.asset };
  }
  // HTTP is a genuine capability call, including no-active-lot runs used to inspect connectivity.
  const gas = restoreGas(new HTTPClient().sendRequest(runtime, fetchGas, consensusIdenticalAggregation<string>())(now.toString(), c.maxExternalAgeSeconds, c.maxGasPriceWei).result());
  const decision = settlementDecision(lot, observedAt, baseFeeWei, gas, {
    gasBudgetWei: BigInt(c.gasBudgetWei), finalizeGasUnits: BigInt(c.finalizeGasUnits), recoverGasUnits: BigInt(c.recoverGasUnits),
    maxDeferralSeconds: BigInt(c.maxDeferralSeconds), maxGasPriceWei: BigInt(c.maxGasPriceWei),
  });
  runtime.log(serialize({ kind: 'DECISION', trust: c.simulationOnly ? 'SIMULATION_ONLY' : 'PRODUCTION_RECEIVER_CONFIGURED', chainId, block: height, observedAt, activeId, baseFeeWei, gas, decision }));
  if (decision.status !== 'EXECUTE' || !decision.action || !lot || gas.status !== 'VALID') return decision.status;
  const encoded = encodeActionReport(c, lot, decision.action === 'FINALIZE_AUCTION' ? 1 : 2, height, bytesToHex(header.hash) as Hex, observedAt, gas);
  const report = runtime.report(prepareReportRequest(encoded.payload)).result();
  const result = evm.writeReport(runtime, { receiver: c.receiver, report, gasConfig: { gasLimit: c.deliveryGasLimit } }).result();
  // A CLI dry-run can return success without an onchain broadcast. Receipt verification is separate.
  runtime.log(serialize({ kind: 'WRITE_CAPABILITY_RESULT', requestId: encoded.requestId, txStatus: result.txStatus,
    receiverExecutionStatus: result.receiverContractExecutionStatus ?? null, txHash: result.txHash?.length ? bytesToHex(result.txHash) : null,
    verification: 'Independently verify receipt, receiver event, final state and balances before claiming onchain success.' }));
  if (result.txStatus !== TxStatus.SUCCESS || result.receiverContractExecutionStatus === 1) throw new Error('CRE_WRITE_FAILED');
  return 'WRITE_CAPABILITY_SUCCEEDED';
}
export const initWorkflow = (config: Config) => [handler(new CronCapability().trigger({ schedule: config.schedule }), onSchedule)];
