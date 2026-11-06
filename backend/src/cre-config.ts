// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { GAS_SOURCE_ID } from './cre-domain.js';
const address = z.string().regex(/^0x[\da-fA-F]{40}$/).refine(v => !/^0x0{40}$/.test(v));
const hash = z.string().regex(/^0x[\da-fA-F]{64}$/);
const decimal = z.string().regex(/^(0|[1-9]\d{0,29})$/);
export const creManifestSchema = z.object({
  chainId: z.union([z.literal(31337), z.literal(11155111)]),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  workflow: z.object({ name: z.literal('unijar-settlement'), version: z.literal('0.1.0'), sdk: z.literal('1.23.0'), cli: z.literal('1.39.0'), wasmHash: hash }),
  // This release does not verify a deployed DON. A JSON flag cannot claim one.
  simulationOnly: z.literal(true), releaser: address,
  receiver: z.object({ address, codeHash: hash, block: decimal, transactionHash: hash }),
  forwarder: z.object({ address, codeHash: hash }),
  sourceId: z.literal(GAS_SOURCE_ID),
  maxReportAge: z.number().int().min(30).max(3600),
  maxBlockLag: z.number().int().min(1).max(255),
  actionGasLimit: z.number().int().min(100000).max(500000),
  maxGasPriceWei: decimal.refine(v => BigInt(v) > 0n && BigInt(v) <= 1_000_000_000_000n),
  gasBudgetWei: decimal.refine(v => BigInt(v) > 0n),
  maxDeferralSeconds: z.number().int().min(60).max(86400),
  maxExternalAgeSeconds: z.number().int().min(1).max(300),
  finalizeGasUnits: z.literal('650000'), recoverGasUnits: z.literal('650000'),
}).strict();
export type CREManifest = z.infer<typeof creManifestSchema>;
export type CREConfiguration = { manifest?: CREManifest; invalid?: boolean };
export function loadCREConfiguration(path: string): CREConfiguration {
  if (!existsSync(path)) return {};
  try { return { manifest: creManifestSchema.parse(JSON.parse(readFileSync(path, 'utf8'))) }; }
  catch { return { invalid: true }; } // Failure affects CRE routes only, never existing exits.
}
