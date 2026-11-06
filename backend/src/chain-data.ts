// SPDX-License-Identifier: AGPL-3.0-only
import { parseAbi, type Address, type Abi } from 'viem';
import { isRevert, type Gateway } from './gateway.js';

export const metadataAbi = parseAbi([
  'function name() view returns (string)', 'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
]);
const readerAbi = parseAbi(['function read(address pool,address factory,address asset,address payout,uint24 fee,uint128 quantity,uint32 window) view returns (uint256 quote,int24 averageTick,int24 spotTick,uint128 harmonicLiquidity,uint32 latest)']);

// Only known decoded contract errors become public messages. Never return RPC text.
export function decodedRevert(error: unknown): { name: string; args: readonly unknown[] } | undefined {
  let current = error;
  for (let i = 0; i < 10 && current && typeof current === 'object'; i++) {
    const value = current as { data?: { errorName?: string; args?: readonly unknown[] }; cause?: unknown };
    if (value.data?.errorName) return { name: value.data.errorName, args: value.data.args ?? [] };
    current = value.cause;
  }
}
export function simulationReason(error: unknown) {
  const reasons: Record<string, string> = { Unauthorized: 'UNAUTHORIZED', AdmissionPaused: 'ADMISSION_PAUSED', WrongState: 'WRONG_STATE', TransferMismatch: 'TRANSFER_MISMATCH', Reentered: 'REENTRANCY_REFUSED', ReferenceRefused: 'REFERENCE_REFUSED' };
  return reasons[decodedRevert(error)?.name ?? ''] ?? 'SIMULATION_REVERTED';
}
export async function assetInfo(g: Gateway, sale: Address, saleAbi: Abi, asset: Address, payout: Address, block: bigint) {
  const [name, symbol, decimals, mode, policy] = await Promise.all([
    g.read(asset, metadataAbi, 'name', [], block), g.read(asset, metadataAbi, 'symbol', [], block),
    g.read(asset, metadataAbi, 'decimals', [], block),
    g.read(sale, saleAbi, 'assetModes', [asset], block), g.read(sale, saleAbi, 'getPolicy', [asset], block),
  ]);
  if (![0, 1, 2].includes(Number(mode))) throw new Error('Unsupported deployed asset mode');
  const classification = asset.toLowerCase() === payout.toLowerCase() ? 'Payout' : Number(mode) === 1 ? 'AuctionApproved' : Number(mode) === 2 ? 'DirectApproved' : 'HeldForReview';
  return { asset, name, symbol, decimals, mode, classification, allowedModes: classification === 'AuctionApproved' ? ['Auction'] : classification === 'DirectApproved' ? ['Direct'] : [], policy };
}
export async function referenceRefusal(g: Gateway, reader: Address, factory: Address, payout: Address, lot: { asset: Address; quantity: bigint; policy: Record<string, unknown> }, block: bigint, originalError: unknown) {
  const p = lot.policy;
  try {
    const [referenceQuote, averageTick, spotTick, harmonicLiquidity, latest] = await g.read(reader, readerAbi, 'read', [p.pool, factory, lot.asset, payout, p.fee, lot.quantity, p.window], block) as readonly [bigint, number, number, bigint, number];
    const now = await g.timestamp(block);
    const age = ((now & 0xffffffffn) - BigInt(latest) + 0x100000000n) % 0x100000000n;
    const reference = { referenceQuote, averageTick, spotTick, harmonicLiquidity, latestObservation: latest, observationAge: age };
    const reason = referenceQuote === 0n ? 'ZERO_REFERENCE_QUOTE' : age > BigInt(String(p.maxAge)) ? 'STALE_OBSERVATION' : harmonicLiquidity < BigInt(String(p.minLiquidity)) ? 'INSUFFICIENT_LIQUIDITY' : Math.abs(spotTick - averageTick) > Number(p.maxTickDeviation) ? 'EXCESSIVE_DEVIATION' : 'REFERENCE_REFUSED';
    return { reason, reference };
  } catch (error) {
    const revert = decodedRevert(error) ?? decodedRevert(originalError);
    const message = revert?.name === 'Error' ? revert.args[0] : undefined;
    const reasons: Record<string, string> = { OLD: 'INCOMPLETE_HISTORY', PAIR: 'INVALID_REFERENCE_PAIR', IDENTITY: 'INVALID_REFERENCE_IDENTITY', FACTORY: 'INVALID_REFERENCE_FACTORY' };
    // Dependency failures are not business refusals and must remain unavailable.
    if (!isRevert(error)) throw error;
    return { reason: typeof message === 'string' ? reasons[message] ?? 'REFERENCE_REFUSED' : 'REFERENCE_REFUSED', reference: null };
  }
}
