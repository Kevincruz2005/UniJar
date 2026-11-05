// SPDX-License-Identifier: AGPL-3.0-only
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import { encodeFunctionData, keccak256, zeroAddress, type Address, type Abi, type Hex } from 'viem';
import { isRevert, type Gateway } from './gateway.js';
import type { Manifest } from './manifest.js';
import * as s from './schemas.js';

export type Lot = { mode: number; state: number; asset: Address; quantity: bigint; committedAt: bigint; expiry: bigint; reserve: bigint; increment: bigint; bidder: Address; recipient: Address; highest: bigint; policyHash: Hex; policy: Record<string, unknown> };
type Params = Record<string, unknown>;
class HttpError extends Error { constructor(public statusCode: number, message: string) { super(message); } }
const clean = (value: unknown) => JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v));
const uint = (value: unknown, bits = 256): bigint => {
  const parsed = BigInt(String(value)); if (parsed < 0n || parsed >= 1n << BigInt(bits)) throw new HttpError(400, 'INTEGER_OUT_OF_RANGE'); return parsed;
};

export async function buildApp(options: { manifest: Manifest; gateway: Gateway; abis: { sale: Abi; token: Abi; jar: Abi }; allowedOrigins?: string[]; rateMax?: number; readinessTtl?: number; logger?: boolean }) {
  const { manifest: m, gateway: g, abis } = options;
  const a = m.addresses as Record<keyof Manifest['addresses'], Address>;
  const app = Fastify({ logger: options.logger ? { redact: ['req.headers.authorization', 'req.headers.cookie'], serializers: { req: r => ({ method: r.method, path: r.url?.split('?')[0] }) } } : false,
    bodyLimit: 16384, requestTimeout: 10000, ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  await app.register(cors, { origin: options.allowedOrigins ?? [], methods: ['GET', 'POST', 'OPTIONS'], credentials: false });
  await app.register(rateLimit, { max: options.rateMax ?? 120, timeWindow: '1 minute', cache: 10000 });
  await app.register(swagger, { openapi: { info: { title: 'UniJar noncustodial API', version: m.sourceCommit } } });
  app.setErrorHandler((error, _request, reply) => {
    const e = error as { validation?: unknown; statusCode?: number };
    const status = e.validation ? 400 : e.statusCode && e.statusCode >= 400 && e.statusCode < 500 ? e.statusCode : 503;
    const message = error instanceof HttpError ? error.message : status === 400 ? 'INVALID_REQUEST' : status === 413 ? 'REQUEST_TOO_LARGE' : status === 429 ? 'RATE_LIMITED' : 'RPC_UNAVAILABLE';
    reply.code(status).send({ error: message });
  });
  let lastReady = 0;
  let readyCheck: Promise<void> | undefined;
  async function ready() {
    if (Date.now() - lastReady < (options.readinessTtl ?? 5000)) return;
    if (!readyCheck) readyCheck = (async () => {
      if (await g.chainId() !== m.chainId) throw new HttpError(503, 'CHAIN_MISMATCH');
      const block = await g.blockNumber();
      await Promise.all(Object.entries(a).map(async ([name, address]) => {
        const code = await g.code(address, block);
        if (!code || code === '0x' || keccak256(code) !== m.deployments[name]?.codeHash) throw new HttpError(503, 'CODE_MISMATCH');
      }));
      lastReady = Date.now();
    })().finally(() => { readyCheck = undefined; });
    await readyCheck;
  }
  const read = (target: Address, abi: Abi, method: string, args: readonly unknown[], block: bigint) => g.read(target, abi, method, args, block);
  const sale = (method: string, args: readonly unknown[], block: bigint) => read(a.releaser, abis.sale, method, args, block);
  async function context() { await ready(); return g.blockNumber(); }
  async function getLot(id: bigint, block: bigint): Promise<Lot> {
    if (id === 0n || id >= (await sale('nextId', [], block) as bigint)) throw new HttpError(404, 'LOT_NOT_FOUND');
    return await sale('getLot', [id], block) as Lot;
  }
  const errors = { 400: s.errorResponse, 404: s.errorResponse, 409: s.errorResponse, 413: s.errorResponse, 429: s.errorResponse, 503: s.errorResponse };
  app.get('/healthz', { config: { rateLimit: false }, schema: { response: { 200: s.object({ status: { const: 'ok' }, version: { type: 'string' }, chainId: { type: 'integer' } }) } } }, async () => ({ status: 'ok', version: m.sourceCommit, chainId: m.chainId }));
  app.get('/readyz', { config: { rateLimit: false }, schema: { response: { 200: s.object({ status: { const: 'ready' }, version: { type: 'string' }, chainId: { type: 'integer' } }), 503: s.errorResponse } } }, async () => { await ready(); return { status: 'ready', version: m.sourceCommit, chainId: m.chainId }; });
  app.get('/v1/config', { schema: { response: { 200: s.envelope(s.object({ manifest: { type: 'object', additionalProperties: true }, adopted: { type: 'boolean' }, currentReleaser: s.address, paused: { type: 'boolean' } })), ...errors } } }, async () => {
    const block = await context(); const [current, paused] = await Promise.all([read(a.jar, abis.jar, 'releaser', [], block), sale('paused', [], block)]);
    return clean({ block, data: { manifest: m, currentReleaser: current, adopted: String(current).toLowerCase() === a.releaser.toLowerCase(), paused } });
  });
  app.get('/v1/inventory', { schema: { response: { 200: s.envelope({ type: 'array', items: s.object({ asset: s.address, jar: s.decimal, escrow: s.decimal, accounted: s.decimal }) }), ...errors } } }, async () => {
    const block = await context();
    const data = await Promise.all([a.directAsset, a.auctionAsset].map(async asset => {
      const [jar, escrow, accounted] = await Promise.all([read(asset, abis.token, 'balanceOf', [a.jar], block), read(asset, abis.token, 'balanceOf', [a.releaser], block), sale('inventory', [asset], block)]);
      return { asset, jar, escrow, accounted };
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
  app.get<{ Params: { address: string } }>('/v1/credits/:address', { schema: { params: s.object({ address: s.address }), response: { 200: s.envelope(s.object({ credit: s.decimal })), ...errors } } }, async request => {
    const block = await context(); return clean({ block, data: { credit: await sale('credits', [request.params.address], block) } });
  });
  app.get<{ Params: { id: string } }>('/v1/lots/:id/quote', { schema: { params: s.object({ id: s.positive }), response: { 200: s.envelope(s.object({ eligible: { type: 'boolean' }, reason: { type: 'string' }, policyHash: s.hash, payment: { anyOf: [s.decimal, { type: 'null' }] } })), ...errors } } }, async request => {
    const block = await context(); const id = uint(request.params.id); const lot = await getLot(id, block);
    const result = (eligible: boolean, reason: string, payment: unknown = null) => clean({ block, data: { eligible, reason, policyHash: lot.policyHash, payment } });
    if (lot.mode !== 2) return result(false, 'WRONG_MODE');
    if (lot.state !== 1 || await g.timestamp(block) >= lot.expiry) return result(false, 'LOT_CLOSED');
    if (await sale('paused', [], block)) return result(false, 'ADMISSION_PAUSED');
    try { const [payment] = await sale('quoteDirect', [id], block) as [bigint, Hex]; return result(true, 'OK', payment); }
    catch (error) { if (isRevert(error)) return result(false, 'REFERENCE_REFUSED'); throw error; }
  });
  app.post<{ Body: { action: keyof typeof s.actionParams; sender: Address; params: Params } }>('/v1/transactions/prepare', { schema: { body: s.prepareBody, response: { 200: s.object({ chainId: { type: 'integer' }, from: s.address, to: s.address, data: { type: 'string', pattern: '^0x[0-9a-fA-F]+$' }, value: s.decimal, simulationBlock: s.decimal, expectedPolicyHash: { anyOf: [s.hash, { type: 'null' }] }, limits: { type: 'object', additionalProperties: true } }), ...errors } } }, async request => {
    const block = await context(); const { action, sender, params: p } = request.body;
    if ([zeroAddress, a.jar, a.releaser].some(x => x.toLowerCase() === sender.toLowerCase())) throw new HttpError(400, 'INVALID_SENDER');
    let target = a.releaser; let abi = abis.sale; let method: string = action; let args: unknown[] = []; let expectedPolicyHash: Hex | null = null;
    const id = p.id === undefined ? undefined : uint(p.id);
    if (id !== undefined) expectedPolicyHash = (await getLot(id, block)).policyHash;
    switch (action) {
      case 'approvePayout': {
        const lot = await getLot(id!, block); const amount = uint(p.amount);
        if (amount === (1n << 256n) - 1n || lot.state !== 1 || await g.timestamp(block) >= lot.expiry) throw new HttpError(400, 'INVALID_APPROVAL');
        if (lot.mode === 2) { const [quote] = await sale('quoteDirect', [id], block) as [bigint, Hex]; if (amount !== quote) throw new HttpError(400, 'APPROVAL_MUST_EQUAL_QUOTE'); }
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
    if ('asset' in p && ![a.directAsset, a.auctionAsset].some(x => x.toLowerCase() === String(p.asset).toLowerCase())) throw new HttpError(400, 'UNCONFIGURED_ASSET');
    try { await g.simulate(target, abi, method, args, sender, block); }
    catch (error) { if (isRevert(error)) throw new HttpError(409, 'SIMULATION_REVERTED'); throw error; }
    return clean({ chainId: m.chainId, from: sender, to: target, data: encodeFunctionData({ abi, functionName: method, args }), value: 0n, simulationBlock: block, expectedPolicyHash, limits: p });
  });
  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());
  await app.ready(); return app;
}
