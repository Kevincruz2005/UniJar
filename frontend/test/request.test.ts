import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { request } from '../src/request';

test('query cancellation and request deadlines both bound a stalled fetch', async t => {
  const server = createServer(() => {}).listen(0, '127.0.0.1');
  t.after(() => { server.closeAllConnections(); server.close(); });
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const query = new AbortController();
  await assert.rejects(request(url, undefined, query.signal, 30), { name: 'TimeoutError' });
  const pending = request(url, undefined, query.signal, 5000); query.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});
