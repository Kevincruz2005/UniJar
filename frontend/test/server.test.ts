import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// The production host uses Node built-ins and is deliberately shared with this test.
// @ts-expect-error JavaScript production entrypoint has no generated declaration.
import { createSiteServer } from '../server.mjs';

test('production hosting supports deep routes, immutable assets, gzip and health provenance', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'unijar-site-'));
  writeFileSync(join(directory, 'index.html'), '<html>UniJar</html>'); mkdirSync(join(directory, 'assets'));
  writeFileSync(join(directory, 'assets/test.js'), 'console.log("UniJar")');
  const server = createSiteServer({ directory, version: 'tested-commit', apiUrl: 'https://api.example' });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const deep = await fetch(`${base}/docs/buying`); assert.equal(deep.status, 200); assert.equal(await deep.text(), '<html>UniJar</html>');
    assert.ok(deep.headers.get('content-security-policy')?.includes('https://api.example'));
    const asset = await fetch(`${base}/assets/test.js`); assert.match(asset.headers.get('cache-control')!, /immutable/); assert.equal(asset.headers.get('content-encoding'), 'gzip');
    const health = await (await fetch(`${base}/healthz`)).json(); assert.equal(health.version, 'tested-commit'); assert.equal(health.chainId, 11155111);
    assert.equal((await fetch(`${base}/missing.js`)).status, 404);
    assert.equal((await fetch(`${base}/docs`, { method: 'HEAD' })).status, 200);
    assert.equal((await fetch(`${base}/`, { method: 'POST' })).status, 405);
  } finally { await new Promise<void>(done => server.close(done)); rmSync(directory, { recursive: true }); }
});
