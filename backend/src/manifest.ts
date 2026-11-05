// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { isAddress, type Abi } from 'viem';

const address = z.string().refine(v => isAddress(v, { strict: false }));
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/);
const record = z.object({ address, block: decimal, transactionHash: hash, codeHash: hash });
export const manifestSchema = z.object({
  chainId: z.union([z.literal(31337), z.literal(11155111)]),
  sourceCommit: z.string().regex(/^[0-9a-f]{40}$/),
  controlledFixture: z.literal(true),
  toolchain: z.record(z.string(), z.string()),
  addresses: z.object({ jar: address, releaser: address, payout: address, directAsset: address, auctionAsset: address, factory: address, pool: address, reader: address, fixture: address }),
  roles: z.object({ operator: address, treasury: address, buyerA: address, buyerB: address }),
  deployments: z.record(z.string(), record),
  transactions: z.record(z.string(), hash),
  policy: z.object({ pool: address, fee: z.number().int(), window: z.number().int(), maxAge: z.number().int(), minLiquidity: decimal, maxQuantity: decimal, maxTickDeviation: z.number().int(), discountBps: z.number().int(), maxDuration: z.number().int(), version: decimal }),
});
export type Manifest = z.infer<typeof manifestSchema>;
export function loadManifest(path: string): Manifest {
  const manifest = manifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  for (const [name, value] of Object.entries(manifest.addresses)) {
    if (manifest.deployments[name]?.address.toLowerCase() !== value.toLowerCase()) throw new Error('Manifest deployment mismatch');
  }
  if (new Set(Object.values(manifest.addresses).map(x => x.toLowerCase())).size !== 9) throw new Error('Manifest addresses must be distinct');
  return manifest;
}
export function loadAbis(directory: string): { sale: Abi; token: Abi; jar: Abi } {
  const load = (name: string) => JSON.parse(readFileSync(`${directory}/${name}.json`, 'utf8')) as Abi;
  return { sale: load('UniJar'), token: load('IERC20'), jar: load('TokenJar') };
}
