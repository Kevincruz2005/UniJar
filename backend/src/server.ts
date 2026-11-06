// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { loadCREConfiguration } from './cre-config.js';
import { buildApp } from './app.js';
import { rpcGateway } from './gateway.js';
import { loadAbis, loadManifest } from './manifest.js';

try {
  const manifest = loadManifest(process.env.MANIFEST_PATH ?? 'public/manifest.json');
  const expectedChain = Number(process.env.EXPECTED_CHAIN_ID ?? 11155111);
  if (manifest.chainId !== expectedChain || (process.env.NODE_ENV === 'production' && expectedChain !== 11155111)) throw new Error('Unexpected manifest chain');
  if (!process.env.RPC_URL) throw new Error('RPC_URL is required');
  const version = JSON.parse(readFileSync('public/build.json', 'utf8')).sourceCommit;
  if (typeof version !== 'string' || !/^[0-9a-f]{40}$/.test(version)) throw new Error('Invalid build provenance');
  if (process.env.INGRESS_MODE && process.env.INGRESS_MODE !== 'azure') throw new Error('Unknown ingress mode');
  const cre = loadCREConfiguration(process.env.CRE_MANIFEST_PATH ?? 'public/cre-manifest.json');
  const creAbi = JSON.parse(readFileSync('public/CRESettlementReceiver.json', 'utf8'));
  const app = await buildApp({ manifest, version, cre, creAbi, azureIngress: process.env.INGRESS_MODE === 'azure', gateway: rpcGateway(process.env.RPC_URL, { requestsPerSecond: Number(process.env.RPC_REQUESTS_PER_SECOND ?? 8) }), abis: loadAbis('public'), allowedOrigins: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean), logger: true });
  const shutdown = () => { void app.close(); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
  await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 8080) });
} catch {
  console.error('UniJar startup failed: verify public manifest, ABI assets, chain and RPC configuration.');
  process.exitCode = 1;
}
