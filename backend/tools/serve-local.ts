// SPDX-License-Identifier: AGPL-3.0-only
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app.js';
import { rpcGateway } from '../src/gateway.js';
import { loadAbis, loadManifest } from '../src/manifest.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const manifest = loadManifest(resolve(root, 'deployments/local.json'));
if (manifest.chainId !== 31337) throw new Error('Local browser tests require Anvil.');
const app = await buildApp({ manifest, gateway: rpcGateway('http://127.0.0.1:18545'), abis: loadAbis(resolve(root, 'backend/public')), version: manifest.sourceCommit, rateMax: 10000 });
await app.listen({ host: '127.0.0.1', port: 18081 });
for (const event of ['SIGTERM', 'SIGINT']) process.on(event, () => { void app.close(); });
console.log('Local test API: http://127.0.0.1:18081 (Anvil only)');
