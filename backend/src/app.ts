// SPDX-License-Identifier: AGPL-3.0-only
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import { isIP } from 'node:net';
import { encodeFunctionData, keccak256, zeroAddress, type Address, type Abi, type Hex } from 'viem';
import { isRevert, rpcFailureKind, type Gateway } from './gateway.js';
import type { Manifest } from './manifest.js';
import * as s from './schemas.js';
import { registerCRERoutes } from './cre-routes.js';
import type { CREConfiguration } from './cre-config.js';
import type { GasResult } from './cre-domain.js';
import { assetInfo, referenceRefusal, simulationReason } from './chain-data.js';

export type Lot = { mode: number; state: number; asset: Address; quantity: bigint; committedAt: bigint; expiry: bigint; reserve: bigint; increment: bigint; bidder: Address; recipient: Address; highest: bigint; policyHash: Hex; policy: Record<string, unknown> };
type Params = Record<string, unknown>;
class HttpError extends Error { constructor(public statusCode: number, message: string) { super(message); } }
const clean = (value: unknown) => JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v));
const uint = (value: unknown, bits = 256): bigint => {
  const parsed = BigInt(String(value)); if (parsed < 0n || parsed >= 1n << BigInt(bits)) throw new HttpError(400, 'INTEGER_OUT_OF_RANGE'); return parsed;
};

export async function buildApp(options: { manifest: Manifest; gateway: Gateway; abis: { sale: Abi; token: Abi; jar: Abi; fee: Abi }; cre?: CREConfiguration; creAbi?: Abi; creGas?: (age: number, max: bigint) => Promise<GasResult>; version?: string; azureIngress?: boolean; allowedOrigins?: string[]; rateMax?: number; readinessTtl?: number; logger?: boolean }) {
  const { manifest: m, gateway: g, abis } = options;
  const a = m.addresses as Record<keyof Manifest['addresses'], Address>;
  const assets = [...new Set([a.directAsset, a.auctionAsset, ...m.reviewAssets as Address[], a.payout])];
  const version = options.version ?? m.sourceCommit;
  const app = Fastify({ logger: options.logger ? { redact: ['req.headers.authorization', 'req.headers.cookie'], serializers: { req: r => ({ method: r.method, path: r.url?.split('?')[0] }) } } : false,
    bodyLimit: 16384, requestTimeout: 10000, ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  await app.register(cors, { origin: options.allowedOrigins ?? [], methods: ['GET', 'POST', 'OPTIONS'], credentials: false });
  await app.register(rateLimit, { max: options.rateMax ?? 120, timeWindow: '1 minute', cache: 10000,
    keyGenerator: request => {
      // ACA appends the actual client at the right; caller-controlled prefixes are ignored.
      // Enable only behind ACA's managed ingress. Direct/local servers ignore forwarded headers.
      const forwarded = request.headers['x-forwarded-for'];
      const client = options.azureIngress && typeof forwarded === 'string' ? forwarded.split(',').at(-1)?.trim() : undefined;
      return client && isIP(client) ? client : request.ip;
    },
  });
  await app.register(swagger, { openapi: { info: { title: 'UniJar noncustodial API', version } } });
  app.setErrorHandler((error, _request, reply) => {
    const e = error as { validation?: unknown; statusCode?: number };
    const status = e.validation ? 400 : e.statusCode && e.statusCode >= 400 && e.statusCode < 500 ? e.statusCode : 503;
    const message = error instanceof HttpError ? error.message : status === 400 ? 'INVALID_REQUEST' : status === 413 ? 'REQUEST_TOO_LARGE' : status === 429 ? 'RATE_LIMITED' : 'RPC_UNAVAILABLE';
    if (status === 503) app.log.error({ category: error instanceof HttpError ? message : rpcFailureKind(error), route: _request.routeOptions.url, requestId: _request.id }, 'Chain request unavailable');
    reply.code(status).send({ error: message });
  });
  let lastReady = 0;
  let readyCheck: Promise<void> | undefined;
  async function ready() {
    if (Date.now() - lastReady < (options.readinessTtl ?? 5000)) return;
    if (!readyCheck) readyCheck = (async () => {
      if (await g.chainId() !== m.chainId) throw new HttpError(503, 'CHAIN_MISMATCH');
      const block = await g.blockNumber();
      await Promise.all(Object.values(m.deployments).map(async deployment => {
        const code = await g.code(deployment.address as Address, block);
        if (!code || code === '0x' || keccak256(code) !== deployment.codeHash) throw new HttpError(503, 'CODE_MISMATCH');
      }));
      lastReady = Date.now();
    })().finally(() => { readyCheck = undefined; });
    await readyCheck;
  }
  const read = (target: Address, abi: Abi, method: string, args: readonly unknown[], block: bigint) => g.read(target, abi, method, args, block);
  const sale = (method: string, args: readonly unknown[], block: bigint) => read(a.releaser, abis.sale, method, args, block);
  async function context() { await ready(); return g.blockNumber(); }
  async function feeConfig(block: bigint) {
    if (!a.feeSource || !m.feeSource) throw new HttpError(404, 'FEE_SOURCE_NOT_CONFIGURED');
    const [asset, jar, merchant, price, feeBps, feePerReceipt, nextReceiptId, totalFees] = await Promise.all(['asset', 'jar', 'merchant', 'price', 'feeBps', 'feePerReceipt', 'nextReceiptId', 'totalFees'].map(method => read(a.feeSource!, abis.fee, method, [], block)));
    if (String(asset).toLowerCase() !== m.feeSource.asset.toLowerCase() || String(jar).toLowerCase() !== a.jar.toLowerCase() || String(merchant).toLowerCase() !== m.feeSource.merchant.toLowerCase() || String(price) !== m.feeSource.price || Number(feeBps) !== m.feeSource.feeBps || feePerReceipt !== BigInt(m.feeSource.price) * BigInt(m.feeSource.feeBps) / 10000n) throw new HttpError(503, 'FEE_SOURCE_MISMATCH');
    const [symbol, decimals] = await Promise.all(['symbol', 'decimals'].map(method => read(asset as Address, abis.token, method, [], block)));
    return { service: a.feeSource, asset: asset as Address, jar, merchant, price: price as bigint, feeBps, feePerReceipt, nextReceiptId, totalFees, symbol, decimals };
  }
  async function getLot(id: bigint, block: bigint): Promise<Lot> {
    if (id === 0n || id >= (await sale('nextId', [], block) as bigint)) throw new HttpError(404, 'LOT_NOT_FOUND');
    return await sale('getLot', [id], block) as Lot;
  }
  async function quoteForPreparation(id: bigint, lot: Lot, block: bigint): Promise<[bigint, Hex]> {
    try { return await sale('quoteDirect', [id], block) as [bigint, Hex]; }
    catch (error) {
      if (!isRevert(error)) throw error;
      if (lot.mode !== 2 || lot.state !== 1 || await g.timestamp(block) >= lot.expiry) throw new HttpError(409, 'WRONG_STATE');
      const refused = await referenceRefusal(g, a.reader, a.factory, a.payout, lot, block, error);
      throw new HttpError(409, refused.reason);
    }
  }
  registerCRERoutes(app, { manifest: m, gateway: g, config: options.cre, abi: options.creAbi, saleAbi: abis.sale, context, lot: getLot, clean, error: (status, message) => new HttpError(status, message), gas: options.creGas });
  const errors = { 400: s.errorResponse, 404: s.errorResponse, 409: s.errorResponse, 413: s.errorResponse, 429: s.errorResponse, 503: s.errorResponse };
  const feeResponse = s.object({ service: s.address, asset: s.address, jar: s.address, merchant: s.address, price: s.decimal, feeBps: { type: 'integer' }, feePerReceipt: s.decimal, nextReceiptId: s.decimal, totalFees: s.decimal, symbol: { type: 'string' }, decimals: { type: 'integer' } });
  app.get('/v1/fee-source', { schema: { response: { 200: s.envelope(feeResponse), ...errors } } }, async () => {
    const block = await context(); return clean({ block, data: await feeConfig(block) });
  });
  app.get<{ Params: { address: string }; Querystring: { referenceHash?: Hex } }>('/v1/fee-source/accounts/:address', { schema: { params: s.object({ address: s.address }), querystring: s.object({ referenceHash: s.hash }, []), response: { 200: s.envelope(s.object({ balance: s.decimal, allowance: s.decimal, receiptId: s.decimal })), ...errors } } }, async request => {
    const block = await context(); const fee = await feeConfig(block); const account = request.params.address;
    const [balance, allowance, receiptId] = await Promise.all([read(fee.asset, abis.token, 'balanceOf', [account], block), read(fee.asset, abis.token, 'allowance', [account, fee.service], block), request.query.referenceHash ? read(fee.service, abis.fee, 'receiptIdOf', [account, request.query.referenceHash], block) : 0n]);
    return clean({ block, data: { balance, allowance, receiptId } });
  });
  app.get('/healthz', { config: { rateLimit: false }, schema: { response: { 200: s.object({ status: { const: 'ok' }, version: { type: 'string' }, chainId: { type: 'integer' } }) } } }, async () => ({ status: 'ok', version, chainId: m.chainId }));
  app.get('/readyz', { config: { rateLimit: false }, schema: { response: { 200: s.object({ status: { const: 'ready' }, version: { type: 'string' }, chainId: { type: 'integer' } }), 503: s.errorResponse } } }, async () => { await ready(); return { status: 'ready', version, chainId: m.chainId }; });
  app.get('/v1/config', { schema: { response: { 200: s.envelope(s.object({ manifest: { type: 'object', additionalProperties: true }, version: { type: 'string' }, adopted: { type: 'boolean' }, currentReleaser: s.address, paused: { type: 'boolean' }, roles: s.object({ owner: s.address, operator: s.address, treasury: s.address, payout: s.address, jar: s.address, reader: s.address, factory: s.address }), activeId: s.decimal, nextId: s.decimal, bidLiability: s.decimal, refundLiability: s.decimal, directPayments: s.decimal, assets: { type: 'array', items: s.assetInfo }, capabilities: s.object({ assetApproval: { const: 'exclusive' } }) })), ...errors } } }, async () => {
    const block = await context();
    const [current, paused, owner, roleValues, counters, configuredAssets] = await Promise.all([
      read(a.jar, abis.jar, 'releaser', [], block), sale('paused', [], block), read(a.jar, abis.jar, 'owner', [], block),
      Promise.all(['operator', 'treasury', 'payout', 'jar', 'reader', 'factory'].map(method => sale(method, [], block))),
      Promise.all(['activeId', 'nextId', 'bidLiability', 'totalCredits', 'directPayments'].map(method => sale(method, [], block))),
      Promise.all(assets.map(asset => assetInfo(g, a.releaser, abis.sale, asset, a.payout, block))),
    ]);
    const roles = { owner, ...Object.fromEntries(['operator', 'treasury', 'payout', 'jar', 'reader', 'factory'].map((name, i) => [name, roleValues[i]])) };
    const [activeId, nextId, bidLiability, refundLiability, directPayments] = counters;
    return clean({ block, data: { manifest: m, version, currentReleaser: current, adopted: String(current).toLowerCase() === a.releaser.toLowerCase(), paused, roles, activeId, nextId, bidLiability, refundLiability, directPayments, assets: configuredAssets, capabilities: { assetApproval: 'exclusive' } } });
  });
  app.get('/v1/inventory', { schema: { response: { 200: s.envelope({ type: 'array', items: s.object({ ...s.assetInfo.properties, jar: s.decimal, escrow: s.decimal, accounted: s.decimal }) }), ...errors } } }, async () => {
    const block = await context();
    const data = await Promise.all(assets.map(async asset => {
      const accounting = asset === a.payout ? Promise.all([sale('bidLiability', [], block), sale('totalCredits', [], block)]).then(([bid, credit]) => (bid as bigint) + (credit as bigint)) : sale('inventory', [asset], block);
      const [jar, escrow, accounted, info] = await Promise.all([read(asset, abis.token, 'balanceOf', [a.jar], block), read(asset, abis.token, 'balanceOf', [a.releaser], block), accounting, assetInfo(g, a.releaser, abis.sale, asset, a.payout, block)]);
      return { ...info, jar, escrow, accounted };
    })); return clean({ block, data });
  });
  app.get<{ Params: { id: string } }>('/v1/lots/:id', { schema: { params: s.object({ id: s.positive }), response: { 200: s.envelope(s.object({ lot: s.lot, nextActions: s.stringArray })), ...errors } } }, async request => {
    const block = await context(); const lot = await getLot(uint(request.params.id), block);
    const [now, paused] = await Promise.all([g.timestamp(block), sale('paused', [], block)]);
    const nextActions: string[] = [];
    if (lot.state === 1) {
      if (now < lot.expiry) {
        if (!paused) {
          if (lot.mode === 1) nextActions.push('bid');
          else try { await sale('quoteDirect', [uint(request.params.id)], block); nextActions.push('fillDirect'); }
          catch (error) { if (!isRevert(error)) throw error; }
        }
        if (lot.highest === 0n) nextActions.push(lot.mode === 1 ? 'cancelAuction' : 'cancelDirect');
      }
      else nextActions.push(lot.mode === 1 ? 'finalizeAuction' : 'expireDirect');
    } else if ([3, 4].includes(lot.state)) nextActions.push('recover');
    return clean({ block, data: { lot, nextActions } });
  });
  app.get<{ Params: { address: string } }>('/v1/credits/:address', { schema: { params: s.object({ address: s.address }), response: { 200: s.envelope(s.object({ credit: s.decimal, payoutBalance: s.decimal, allowance: s.decimal, payout: s.address, spender: s.address })), ...errors } } }, async request => {
    const block = await context(); const account = request.params.address;
    const [credit, payoutBalance, allowance] = await Promise.all([sale('credits', [account], block), read(a.payout, abis.token, 'balanceOf', [account], block), read(a.payout, abis.token, 'allowance', [account, a.releaser], block)]);
    return clean({ block, data: { credit, payoutBalance, allowance, payout: a.payout, spender: a.releaser } });
  });
  app.get<{ Params: { id: string } }>('/v1/lots/:id/quote', { schema: { params: s.object({ id: s.positive }), response: { 200: s.envelope(s.object({ eligible: { type: 'boolean' }, reason: { type: 'string' }, policyHash: s.hash, payment: { anyOf: [s.decimal, { type: 'null' }] }, reference: s.reference })), ...errors } } }, async request => {
    const block = await context(); const id = uint(request.params.id); const lot = await getLot(id, block);
    const result = (eligible: boolean, reason: string, payment: unknown = null, reference: unknown = null) => clean({ block, data: { eligible, reason, policyHash: lot.policyHash, payment, reference } });
    if (lot.mode !== 2) return result(false, 'WRONG_MODE');
    if (lot.state !== 1 || await g.timestamp(block) >= lot.expiry) return result(false, 'LOT_CLOSED');
    if (await sale('paused', [], block)) return result(false, 'ADMISSION_PAUSED');
    try { const [payment] = await sale('quoteDirect', [id], block) as [bigint, Hex]; return result(true, 'OK', payment); }
    catch (error) {
      if (!isRevert(error)) throw error;
      const refused = await referenceRefusal(g, a.reader, a.factory, a.payout, lot, block, error);
      return result(false, refused.reason, null, refused.reference);
    }
  });
  app.post<{ Body: { action: keyof typeof s.actionParams; sender: Address; params: Params } }>('/v1/transactions/prepare', { schema: { body: s.prepareBody, response: { 200: s.object({ chainId: { type: 'integer' }, from: s.address, to: s.address, data: { type: 'string', pattern: '^0x[0-9a-fA-F]+$' }, value: s.decimal, simulationBlock: s.decimal, expectedPolicyHash: { anyOf: [s.hash, { type: 'null' }] }, limits: { type: 'object', additionalProperties: true } }), ...errors } } }, async request => {
    const block = await context(); const { action, sender, params: p } = request.body;
    if ([zeroAddress, a.jar, a.releaser].some(x => x.toLowerCase() === sender.toLowerCase())) throw new HttpError(400, 'INVALID_SENDER');
    let target = a.releaser; let abi = abis.sale; let method: string = action; let args: unknown[] = []; let expectedPolicyHash: Hex | null = null;
    const id = p.id === undefined ? undefined : uint(p.id);
    const preparedLot = id === undefined ? undefined : await getLot(id, block);
    if (preparedLot) expectedPolicyHash = preparedLot.policyHash;
    if (action === 'fillDirect') {
      if (String(p.expectedPolicyHash).toLowerCase() !== expectedPolicyHash?.toLowerCase()) throw new HttpError(409, 'POLICY_MISMATCH');
      if (uint(p.deadline, 64) < await g.timestamp(block)) throw new HttpError(409, 'DEADLINE_EXPIRED');
      if (sender.toLowerCase() === String(await sale('treasury', [], block)).toLowerCase()) throw new HttpError(409, 'TREASURY_SELF_PAYMENT');
      const [payment] = await quoteForPreparation(id!, preparedLot!, block);
      if (payment > uint(p.maximum)) throw new HttpError(409, 'MAXIMUM_EXCEEDED');
    }
    switch (action) {
      case 'approveFeeAsset': {
        const fee = await feeConfig(block);
        if (uint(p.amount) !== fee.price) throw new HttpError(400, 'APPROVAL_MUST_EQUAL_PRICE');
        target = fee.asset; abi = abis.token; method = 'approve'; args = [fee.service, fee.price]; break;
      }
      case 'payForReceipt': {
        const fee = await feeConfig(block);
        if (/^0x0{64}$/i.test(String(p.referenceHash))) throw new HttpError(400, 'INVALID_REFERENCE');
        target = fee.service; abi = abis.fee; method = 'pay'; args = [p.referenceHash]; break;
      }
      case 'approvePayout': {
        const lot = await getLot(id!, block); const amount = uint(p.amount);
        if (amount === (1n << 256n) - 1n || lot.state !== 1 || await g.timestamp(block) >= lot.expiry) throw new HttpError(400, 'INVALID_APPROVAL');
        if (lot.mode === 2) { const [quote] = await quoteForPreparation(id!, lot, block); if (amount !== quote) throw new HttpError(400, 'APPROVAL_MUST_EQUAL_QUOTE'); }
        else if (amount < (lot.highest === 0n ? lot.reserve : lot.highest + lot.increment)) throw new HttpError(400, 'APPROVAL_BELOW_BID');
        target = a.payout; abi = abis.token; method = 'approve'; args = [a.releaser, amount]; break;
      }
      case 'setAssetMode': args = [p.asset, p.mode]; break;
      case 'setPaused': args = [p.paused]; break;
      case 'setPolicy': {
        const q = { ...(p.policy as Params) };
        for (const k of ['minLiquidity', 'maxQuantity']) q[k] = uint(q[k], 128);
        q.version = uint(q.version, 64); args = [p.asset, q]; break;
      }
      case 'openAuction': args = [p.asset, uint(p.quantity, 128), uint(p.expiry, 64), uint(p.reserve), uint(p.increment)]; break;
      case 'openDirect': args = [p.asset, uint(p.quantity, 128), uint(p.expiry, 64)]; break;
      case 'bid': args = [id, uint(p.amount), p.recipient]; break;
      case 'fillDirect': args = [id, uint(p.maximum), uint(p.deadline, 64), p.expectedPolicyHash, p.recipient]; break;
      case 'withdrawRefund': break;
      default: args = [id];
    }
    if ('asset' in p && !assets.filter(asset => asset !== a.payout).some(x => x.toLowerCase() === String(p.asset).toLowerCase())) throw new HttpError(400, 'UNCONFIGURED_ASSET');
    try { await g.simulate(target, abi, method, args, sender, block); }
    catch (error) { if (isRevert(error)) throw new HttpError(409, simulationReason(error)); throw error; }
    return clean({ chainId: m.chainId, from: sender, to: target, data: encodeFunctionData({ abi, functionName: method, args }), value: 0n, simulationBlock: block, expectedPolicyHash, limits: p });
  });
  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());
  await app.ready(); return app;
}
