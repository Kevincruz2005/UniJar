// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';
const address = z.string().regex(/^0x[\da-fA-F]{40}$/).refine(v => !/^0x0{40}$/.test(v));
const hash = z.string().regex(/^0x[\da-fA-F]{64}$/);
const positiveWei = z.string().regex(/^\d{1,30}$/).refine(v => BigInt(v) > 0n);
export const configSchema = z.object({
  schedule: z.string().min(9).max(64),
  chainName: z.literal('ethereum-testnet-sepolia'),
  chainId: z.literal(11155111),
  // Separate, verified receiver manifest supplies these; no deployment addresses in source.
  releaser: address, releaserCodeHash: hash, receiver: address,
  simulationOnly: z.boolean(),
  gasBudgetWei: positiveWei,
  maxGasPriceWei: positiveWei.refine(v => BigInt(v) <= 1_000_000_000_000n),
  maxExternalAgeSeconds: z.number().int().min(1).max(300),
  maxDeferralSeconds: z.number().int().min(60).max(86400),
  reportLifetimeSeconds: z.number().int().min(30).max(300),
  // Conservative delivery bounds, including forwarder/receiver overhead; not actual gas spent.
  finalizeGasUnits: z.literal('650000'), recoverGasUnits: z.literal('650000'),
  deliveryGasLimit: z.literal('1000000'),
}).strict();
export type Config = z.infer<typeof configSchema>;
