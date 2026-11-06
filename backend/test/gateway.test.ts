import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { encodeAbiParameters, parseAbi, type Address } from 'viem';
import { rpcGateway, rpcFailureKind, isRevert } from '../src/gateway.js';

test('RPC transport batches pinned reads, coalesces identical reads, matches out-of-order responses and retries a transient HTTP failure', async t => {
  const bodies: { id: number; method: string; params: unknown[] }[][] = [];
  let fail = true;
  const server = createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    const parsed = JSON.parse(body); const batch = Array.isArray(parsed) ? parsed : [parsed]; bodies.push(batch);
    if (fail) { fail = false; res.writeHead(503).end('temporarily unavailable'); return; }
    const responses = batch.map(({ id, method }: { id: number; method: string }) => ({ jsonrpc: '2.0', id, result: method === 'eth_chainId' ? '0xaa36a7' : method === 'eth_blockNumber' ? '0x7b' : method === 'eth_getCode' ? '0x6000' : encodeAbiParameters([{ type: 'uint256' }], [99n]) })).reverse();
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(Array.isArray(parsed) ? responses : responses[0]));
  }).listen(0, '127.0.0.1');
  t.after(() => server.close()); await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  const g = rpcGateway(`http://127.0.0.1:${port}`); const address = `0x${'12'.repeat(20)}` as Address;
  const tokenAbi = parseAbi(['function balanceOf(address) view returns (uint256)']);
  const [chain, block, code, balance, duplicate] = await Promise.all([g.chainId(), g.blockNumber(), g.code(address, 123n), g.read(address, tokenAbi, 'balanceOf', [address], 123n), g.read(address, tokenAbi, 'balanceOf', [address], 123n)]);
  assert.deepEqual([chain, block, code, balance], [11155111, 123n, '0x6000', 99n]);
  assert.equal(duplicate, 99n);
  assert.equal(bodies.length, 2); assert.equal(bodies[0]!.length, 4);
  for (const request of bodies.flat().filter(r => ['eth_call', 'eth_getCode'].includes(r.method))) assert.equal(request.params.at(-1), '0x7b');
  assert.ok(bodies.flat().every(r => !/send|sign/i.test(r.method)));
  await g.read(address, tokenAbi, 'balanceOf', [address], 123n);
  assert.equal(bodies.length, 3, 'completed reads must not become a result cache');
});

test('failure diagnostics traverse causes without disclosing provider details', () => {
  const secret = 'https://private.invalid/SECRET_KEY';
  for (const [cause, expected] of [[{ name: 'TimeoutError' }, 'timeout'], [{ status: 429 }, 'rate_limit'], [{ name: 'HttpRequestError', status: 502 }, 'http_502'], [{ name: 'ExecutionRevertedError' }, 'revert']] as const) {
    assert.equal(rpcFailureKind({ message: secret, cause: { ...cause, message: secret } }), expected);
  }
  assert.equal(rpcFailureKind(new Error(secret)), 'unavailable');
  assert.equal(isRevert({ cause: { name: 'ExecutionRevertedError' } }), true);
});
