import test from 'node:test';
import assert from 'node:assert/strict';
import { rpcQueue } from '../src/rpc-queue.js';

test('a concurrent RPC burst is paced across windows and failed work does not stall the queue', async () => {
  const schedule = rpcQueue(8); const starts: number[] = [];
  const jobs = Array.from({ length: 12 }, (_, i) => schedule(async () => {
    starts.push(Date.now()); if (i === 3) throw new Error('provider unavailable'); return i;
  }));
  const results = await Promise.allSettled(jobs);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 11);
  assert.equal(starts.length, 12);
  assert.ok(starts[4]! - starts[0]! >= 480);
  assert.ok(starts[8]! - starts[4]! >= 480);
  assert.equal(await schedule(async () => 123), 123);
});

test('queue capacity and invalid configuration fail without unbounded pending work', async () => {
  for (const rate of [0, 21, NaN, 1.5]) assert.throws(() => rpcQueue(rate));
  const schedule = rpcQueue(20, 1);
  const first = schedule(async () => 1);
  await assert.rejects(schedule(async () => 2), { name: 'RpcQueueFullError' });
  assert.equal(await first, 1);
});

test('readiness work can pass queued data reads without bypassing pacing', async () => {
  const schedule = rpcQueue(20); const order: string[] = [];
  const jobs = Array.from({ length: 8 }, () => schedule(async () => { order.push('data'); }));
  const ready = schedule(async () => { order.push('ready'); }, true);
  await Promise.all([...jobs, ready]);
  assert.equal(order[0], 'ready'); assert.equal(order.length, 9);
});
