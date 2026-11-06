// SPDX-License-Identifier: AGPL-3.0-only
// Portable decision logic shared by the API and the CRE WASM workflow. No IO.
import { keccak256, stringToHex, type Address, type Hex } from 'viem';

export const GAS_SOURCE_URL = 'https://eth-sepolia.blockscout.com/api/v2/stats';
export const GAS_IDENTITY_URL = 'https://eth-sepolia.blockscout.com/api/v2/blocks/0';
export const SEPOLIA_GENESIS = '0x25a5cc106eea7138acab33231d7160d69cb777ee0c2c553fcddf5138993e6dd9';
export const GAS_SOURCE_ID = keccak256(stringToHex(GAS_SOURCE_URL));
export type CREAction = 'FINALIZE_AUCTION' | 'RECOVER_UNSOLD';
export type AuctionSnapshot = { id: bigint; mode: number; state: number; expiry: bigint; committedAt: bigint; highest: bigint; quantity: bigint; asset: Address };
export type GasObservation = { status: 'VALID'; chainId: 11155111; source: string; sourceId: Hex; sourceDataHash: Hex; gasPriceWei: bigint; updatedAt: bigint; observedAt: bigint; unit: 'wei'; genesisHash: string };
export type GasFailure = { status: 'DATA_UNAVAILABLE'; reason: string; source: string; observedAt: bigint };
export type GasResult = GasObservation | GasFailure;
export type CostPolicy = { gasBudgetWei: bigint; finalizeGasUnits: bigint; recoverGasUnits: bigint; maxDeferralSeconds: bigint; maxGasPriceWei: bigint };
export type Decision = { status: 'NO_ACTIVE_LOT' | 'UNSUPPORTED_MODE' | 'COMPLETED' | 'WAITING_FOR_EXPIRY' | 'EXECUTE' | 'GAS_BUDGET_DEFERRAL' | 'DATA_UNAVAILABLE' | 'EXTERNAL_DATA_MISMATCH'; reason: string; action: CREAction | null; manualAction: 'finalizeAuction' | 'recover' | null; estimatedFeeWei: bigint | null; funded: boolean; warnings: string[] };

const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('MALFORMED_RESPONSE');
  return v as Record<string, unknown>;
};
export function gweiToWeiCeiling(value: unknown): bigint {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('INVALID_FEE_UNIT');
  if (typeof value === 'number' && (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER)) throw new Error('INVALID_FEE_VALUE');
  const text = String(value); if (text.length > 100) throw new Error('INVALID_FEE_VALUE');
  const m = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d{1,2}))?$/.exec(text);
  if (!m) throw new Error('INVALID_FEE_VALUE');
  const n = BigInt(m[1]! + (m[2] ?? '')); const shift = 9 + Number(m[3] ?? 0) - (m[2]?.length ?? 0);
  if (shift > 30) throw new Error('FEE_OUT_OF_RANGE');
  if (shift >= 0) return n * 10n ** BigInt(shift);
  const denominator = 10n ** BigInt(-shift); return (n + denominator - 1n) / denominator;
}
export function gasFailure(reason: string, observedAt: bigint): GasFailure {
  return { status: 'DATA_UNAVAILABLE', reason, source: GAS_SOURCE_URL, observedAt };
}
export function validateGasResponse(statsValue: unknown, identityValue: unknown, now: bigint, maxAgeSeconds: bigint, maxGasPriceWei: bigint): GasResult {
  try {
    const stats = object(statsValue); const identity = object(identityValue);
    if (String(identity.height) !== '0' || String(identity.hash).toLowerCase() !== SEPOLIA_GENESIS) throw new Error('WRONG_EXTERNAL_NETWORK');
    if (typeof stats.gas_price_updated_at !== 'string' || !/^\d{4}-\d\d-\d\dT.*Z$/.test(stats.gas_price_updated_at)) throw new Error('MISSING_PROVIDER_TIMESTAMP');
    const milliseconds = Date.parse(stats.gas_price_updated_at);
    if (!Number.isFinite(milliseconds)) throw new Error('MALFORMED_PROVIDER_TIMESTAMP');
    const updatedAt = BigInt(Math.floor(milliseconds / 1000));
    if (updatedAt > now + 30n) throw new Error('FUTURE_EXTERNAL_DATA');
    if (now > updatedAt && now - updatedAt > maxAgeSeconds) throw new Error('STALE_EXTERNAL_DATA');
    const average = object(stats.gas_prices).average;
    let gasPriceWei: bigint;
    if (average && typeof average === 'object') {
      const wei = object(average).wei;
      if (typeof wei !== 'string' || !/^\d{1,30}$/.test(wei)) throw new Error('INVALID_FEE_UNIT');
      gasPriceWei = BigInt(wei);
    } else gasPriceWei = gweiToWeiCeiling(average);
    if (gasPriceWei <= 0n || gasPriceWei > maxGasPriceWei) throw new Error('FEE_OUT_OF_RANGE');
    const canonical = JSON.stringify({ source: GAS_SOURCE_URL, chainId: 11155111, genesisHash: SEPOLIA_GENESIS, gasPriceWei: gasPriceWei.toString(), updatedAt: updatedAt.toString() });
    return { status: 'VALID', chainId: 11155111, source: GAS_SOURCE_URL, sourceId: GAS_SOURCE_ID, sourceDataHash: keccak256(stringToHex(canonical)), gasPriceWei, updatedAt, observedAt: now, unit: 'wei', genesisHash: SEPOLIA_GENESIS };
  } catch (error) {
    const reason = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'MALFORMED_RESPONSE';
    return gasFailure(reason, now);
  }
}
export function manualEligibility(lot: AuctionSnapshot | undefined, now: bigint): Decision {
  const base = { action: null, manualAction: null, estimatedFeeWei: null, funded: !!lot && lot.highest > 0n, warnings: [] };
  if (!lot) return { ...base, status: 'NO_ACTIVE_LOT', reason: 'No unresolved lot is selected.' };
  if (lot.mode !== 1) return { ...base, status: 'UNSUPPORTED_MODE', reason: 'CRE settlement supports auctions only; direct-lot controls remain unchanged.' };
  if (lot.state === 1 && now < lot.expiry) return { ...base, status: 'WAITING_FOR_EXPIRY', reason: 'The auction has not expired.' };
  if (lot.state === 1) return { ...base, status: 'EXECUTE', reason: lot.highest > 0n ? 'Funded settlement is eligible.' : 'No-bid finalization to Unsold is eligible.', action: 'FINALIZE_AUCTION', manualAction: 'finalizeAuction' };
  if (lot.state === 3 || lot.state === 4) return { ...base, status: 'EXECUTE', reason: 'Exact inventory recovery to the original jar is eligible.', action: 'RECOVER_UNSOLD', manualAction: 'recover' };
  return { ...base, status: 'COMPLETED', reason: 'This lot has no remaining auction exit.' };
}
export function settlementDecision(lot: AuctionSnapshot | undefined, now: bigint, baseFeeWei: bigint, gas: GasResult, policy: CostPolicy): Decision {
  const eligible = manualEligibility(lot, now);
  if (!eligible.action || !lot) return eligible;
  if (gas.status !== 'VALID') return { ...eligible, status: 'DATA_UNAVAILABLE', action: null, reason: gas.reason };
  if (gas.gasPriceWei < baseFeeWei || gas.gasPriceWei > policy.maxGasPriceWei) return { ...eligible, status: 'EXTERNAL_DATA_MISMATCH', action: null, reason: 'External fee is below the EVM base fee or above the configured upper bound.' };
  const gasUnits = eligible.action === 'FINALIZE_AUCTION' ? policy.finalizeGasUnits : policy.recoverGasUnits;
  const estimatedFeeWei = gasUnits * gas.gasPriceWei;
  const warnings = gas.gasPriceWei > baseFeeWei * 100n ? ['External recommendation is substantially above the EVM base fee; priority-fee recommendations are not the node minimum.'] : [];
  const evaluated = { ...eligible, estimatedFeeWei, warnings };
  if (eligible.action === 'FINALIZE_AUCTION' && eligible.funded) return { ...evaluated, reason: 'Funded settlement has priority; a valid high-cost estimate does not delay treasury payment.' };
  const deferralStart = lot.state === 3 ? lot.committedAt : lot.expiry;
  const age = now > deferralStart ? now - deferralStart : 0n;
  if (estimatedFeeWei <= policy.gasBudgetWei) return { ...evaluated, reason: 'The nonurgent action is within the configured native-fee budget.' };
  if (age >= policy.maxDeferralSeconds) return { ...evaluated, reason: 'The maximum nonurgent deferral age was reached; complete the authorized exit.' };
  return { ...evaluated, status: 'GAS_BUDGET_DEFERRAL', action: null, reason: 'The external native-fee estimate exceeds the nonurgent budget. Manual exit remains available.' };
}
