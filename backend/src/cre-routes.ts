// SPDX-License-Identifier: AGPL-3.0-only
import type { FastifyInstance } from 'fastify';
import { keccak256, type Address, type Abi } from 'viem';
import type { Manifest } from './manifest.js';
import type { Gateway } from './gateway.js';
import type { Lot } from './app.js';
import type { CREConfiguration } from './cre-config.js';
import { GAS_SOURCE_URL, GAS_SOURCE_ID, gasFailure, settlementDecision, manualEligibility, type GasResult } from './cre-domain.js';
import { advisoryGas } from './cre-gas.js';
import * as s from './schemas.js';

type Deps = { manifest: Manifest; gateway: Gateway; config?: CREConfiguration; abi?: Abi; saleAbi: Abi; context(): Promise<bigint>; lot(id: bigint, block: bigint): Promise<Lot>;
  error(status: number, message: string): Error; clean(value: unknown): unknown; gas?: (age: number, max: bigint) => Promise<GasResult> };
export function registerCRERoutes(app: FastifyInstance, d: Deps) {
  const { manifest: m, gateway: g } = d; const c = d.config?.manifest;
  const gas = d.gas ?? advisoryGas();
  const errors = { 400: s.errorResponse, 404: s.errorResponse, 429: s.errorResponse, 503: s.errorResponse };
  const response = { 200: s.envelope({ type: 'object', additionalProperties: true }), ...errors };
  const params = s.object({ id: s.positive });
  const routeConfig = { rateLimit: { max: 30, timeWindow: '1 minute' } };
  async function status(block: bigint) {
    const common = { chainId: m.chainId, workflow: c?.workflow ?? null, persistentAutomation: false,
      externalSource: GAS_SOURCE_URL, manualExitsAvailable: true, receiver: null as string | null, forwarder: null as string | null };
    if (d.config?.invalid) return { ...common, mode: 'DISABLED', reason: 'CRE_CONFIGURATION_INVALID', automationPaused: null };
    if (!c || !d.abi) return { ...common, mode: 'DISABLED', reason: 'NO_VERIFIED_CRE_RECEIVER', automationPaused: null };
    if (c.chainId !== m.chainId || c.releaser.toLowerCase() !== m.addresses.releaser.toLowerCase() || c.sourceId !== GAS_SOURCE_ID || BigInt(c.receiver.block) > block) throw d.error(503, 'CRE_DEPLOYMENT_MISMATCH');
    const [receiverCode, forwarderCode, context, actualTarget, actualForwarder, simulation, source, maxPrice, paused] = await Promise.all([
      g.code(c.receiver.address as Address, block), g.code(c.forwarder.address as Address, block),
      ...['readContext', 'releaser', 'forwarder', 'simulationOnly', 'sourceId', 'maxGasPriceWei', 'automationPaused'].map(method => g.read(c.receiver.address as Address, d.abi!, method, [], block)),
    ]);
    const ctx = context as readonly [bigint, bigint, bigint, bigint, string, bigint];
    if (!receiverCode || receiverCode === '0x' || keccak256(receiverCode) !== c.receiver.codeHash || !forwarderCode || forwarderCode === '0x' || keccak256(forwarderCode) !== c.forwarder.codeHash
      || String(actualTarget).toLowerCase() !== c.releaser.toLowerCase() || String(actualForwarder).toLowerCase() !== c.forwarder.address.toLowerCase() || simulation !== true || source !== GAS_SOURCE_ID
      || maxPrice !== BigInt(c.maxGasPriceWei) || ctx[0] !== BigInt(m.chainId) || ctx[1] !== block || ctx[4] !== m.deployments.releaser?.codeHash) throw d.error(503, 'CRE_DEPLOYMENT_MISMATCH');
    return { ...common, mode: 'SIMULATION_ONLY', reason: 'CLI_TRIGGER_REQUIRED_NO_DEPLOYED_DON', receiver: c.receiver.address, forwarder: c.forwarder.address,
      automationPaused: paused as boolean, receiverDeployment: c.receiver, policy: { gasBudgetWei: c.gasBudgetWei, maxGasPriceWei: c.maxGasPriceWei, maxDeferralSeconds: c.maxDeferralSeconds,
        maxExternalAgeSeconds: c.maxExternalAgeSeconds, finalizeGasUnits: c.finalizeGasUnits, recoverGasUnits: c.recoverGasUnits },
      reproductionCommand: 'bash scripts/cre-simulate.sh', trust: 'Test-only mock forwarder; this is not production DON authentication.' };
  }
  app.get('/v1/cre/status', { config: routeConfig, schema: { summary: 'Verify CRE receiver configuration; never infer live DON deployment', response } }, async () => {
    const block = await d.context(); return d.clean({ block, data: await status(block) });
  });
  app.get<{ Params: { id: string } }>('/v1/cre/lots/:id/eligibility', { config: routeConfig, schema: { summary: 'Read current auction eligibility and ephemeral server gas advisory', params, response } }, async request => {
    const id = BigInt(request.params.id); if (id >= 1n << 256n) throw d.error(400, 'INTEGER_OUT_OF_RANGE');
    const block = await d.context();
    const [lot, now, activeId] = await Promise.all([d.lot(id, block), g.timestamp(block), g.read(m.addresses.releaser as Address, d.saleAbi, 'activeId', [], block)]);
    const manual = manualEligibility({ ...lot, id }, now);
    const receiverStatus = await status(block);
    let observation: GasResult = gasFailure(m.chainId === 11155111 ? 'NOT_EVALUATED' : 'NO_LOCAL_CHAIN_EXTERNAL_GAS_PROVIDER', now);
    let baseFeeWei: bigint | null = null;
    if (m.chainId === 11155111 && manual.action) {
      [observation, baseFeeWei] = await Promise.all([gas(c?.maxExternalAgeSeconds ?? 180, BigInt(c?.maxGasPriceWei ?? '200000000000')), g.baseFee ? g.baseFee(block) : Promise.resolve(null)]);
    }
    const policy = { gasBudgetWei: BigInt(c?.gasBudgetWei ?? '1000000000000000'), maxGasPriceWei: BigInt(c?.maxGasPriceWei ?? '200000000000'),
      maxDeferralSeconds: BigInt(c?.maxDeferralSeconds ?? 1800), finalizeGasUnits: 650000n, recoverGasUnits: 650000n };
    const decision = settlementDecision({ ...lot, id }, now, baseFeeWei ?? 0n, baseFeeWei === null && manual.action ? gasFailure('EVM_BASE_FEE_UNAVAILABLE', now) : observation, policy);
    return d.clean({ block, data: { id, lot, observedAt: now, activeId, mode: receiverStatus.mode, automationPaused: receiverStatus.automationPaused,
      manualAction: manual.manualAction, decision, external: { ...observation, provenance: 'SERVER_ADVISORY_NOT_A_SIGNED_CRE_REPORT', cacheMaxSeconds: 15 }, baseFeeWei,
      policy, treasury: m.roles.treasury, jar: m.addresses.jar, execution: 'No action is signed or broadcast by this API.' } });
  });
  app.get<{ Params: { id: string } }>('/v1/cre/lots/:id/history', { config: routeConfig, schema: { summary: 'Bounded recent receiver execution events with successful receipt checks', params, response } }, async request => {
    const id = BigInt(request.params.id); if (id >= 1n << 256n) throw d.error(400, 'INTEGER_OUT_OF_RANGE');
    const block = await d.context(); await d.lot(id, block); const current = await status(block);
    if (!c || current.mode === 'DISABLED') return d.clean({ block, data: { mode: 'DISABLED', events: [], coverage: 'NO_VERIFIED_RECEIVER', offchainRuns: 'NOT_INDEXED' } });
    if (!g.settlementEvents || !g.successfulReceipt) throw d.error(503, 'CRE_HISTORY_UNAVAILABLE');
    const oldest = block > 99n ? block - 99n : 0n; const deployed = BigInt(c.receiver.block); const from = oldest > deployed ? oldest : deployed;
    const events = [];
    for (let start = from; start <= block; start += 10n) {
      const end = start + 9n > block ? block : start + 9n;
      const found = await g.settlementEvents(c.receiver.address as Address, id, start, end);
      for (const event of found) {
        if (events.length >= 10) throw d.error(503, 'CRE_HISTORY_RESULT_LIMIT');
        if (event.lotId !== id || event.blockNumber < start || event.blockNumber > end || event.txBlock !== event.blockNumber
          || event.sourceId !== GAS_SOURCE_ID || !await g.successfulReceipt(event.transactionHash, event.blockNumber)) throw d.error(503, 'CRE_EVENT_UNVERIFIED');
        events.push({ ...event, receiptVerified: true, executionKind: 'SIMULATION_FORWARDER_DELIVERY' });
      }
    }
    return d.clean({ block, data: { mode: current.mode, events, fromBlock: from, toBlock: block, coverage: 'RECENT_100_BLOCKS_MAXIMUM', offchainRuns: 'NOT_INDEXED',
      note: 'An empty recent window does not prove no earlier executions. Deferred and failed CLI runs are not onchain success events. A mock-forwarder receipt alone does not prove CRE CLI origin.' } });
  });
}
