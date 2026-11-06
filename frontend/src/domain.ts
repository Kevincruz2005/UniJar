import { decodeEventLog, encodeFunctionData, isAddress, parseAbi, parseUnits, formatUnits, type Address, type Hex, type Log } from 'viem';

export type Policy = { pool: Address; fee: number; window: number; maxAge: number; minLiquidity: string; maxQuantity: string; maxTickDeviation: number; discountBps: number; maxDuration: number; version: string };
export type Asset = { asset: Address; name: string; symbol: string; decimals: number; mode: number; classification: string; allowedModes: string[]; policy: Policy };
export type Inventory = Asset & { jar: string; escrow: string; accounted: string };
export type Lot = { mode: number; state: number; asset: Address; quantity: string; committedAt: string; expiry: string; reserve: string; increment: string; bidder: Address; recipient: Address; highest: string; policyHash: Hex; policy: Policy };
export type Deployment = { chainId: number; sourceCommit: string; addresses: Record<string, Address>; deployments: Record<string, { address: Address; codeHash: Hex }>; feeSource?: { sourceCommit: string; asset: Address; merchant: Address; price: string; feeBps: number } };
export type FeeSource = { service: Address; asset: Address; jar: Address; merchant: Address; price: string; feeBps: number; feePerReceipt: string; nextReceiptId: string; totalFees: string; symbol: string; decimals: number };
export type Config = { manifest: Deployment; version: string; adopted: boolean; currentReleaser: Address; paused: boolean; roles: Record<string, Address>; activeId: string; nextId: string; assets: Asset[]; bidLiability: string; refundLiability: string; directPayments: string; capabilities: { assetApproval: string } };
export type Credits = { credit: string; payoutBalance: string; allowance: string; payout: Address; spender: Address };
export type Quote = { eligible: boolean; reason: string; payment: string | null; policyHash: Hex; reference: Record<string, unknown> | null };
export type Envelope<T> = { block: string; data: T };
export type Prepared = { chainId: number; from: Address; to: Address; data: Hex; value: string; expectedPolicyHash: Hex | null; simulationBlock: string; limits: Record<string, unknown> };
export type Intent = { action: string; params: Record<string, unknown> };

export const saleAbi = parseAbi([
  'event Opened(uint256 indexed id,uint8 mode,address indexed asset,uint128 quantity,uint64 expiry,bytes32 policyHash)',
  'function openDirect(address asset,uint128 quantity,uint64 expiry)',
  'function openAuction(address asset,uint128 quantity,uint64 expiry,uint256 reserve,uint256 increment)',
  'function bid(uint256 id,uint256 amount,address recipient)',
  'function fillDirect(uint256 id,uint256 maximum,uint64 deadline,bytes32 expectedPolicyHash,address recipient)',
  'function withdrawRefund()', 'function finalizeAuction(uint256 id)',
  'function expireDirect(uint256 id)', 'function recover(uint256 id)',
  'function cancelAuction(uint256 id)', 'function cancelDirect(uint256 id)',
  'function setPaused(bool paused)', 'function setAssetMode(address asset,uint8 mode)',
  'function setPolicy(address asset,(address pool,uint24 fee,uint32 window,uint32 maxAge,uint128 minLiquidity,uint128 maxQuantity,uint24 maxTickDeviation,uint16 discountBps,uint32 maxDuration,uint64 version) policy)',
]);
export const tokenAbi = parseAbi(['function approve(address spender,uint256 amount) returns (bool)', 'function balanceOf(address account) view returns (uint256)', 'function allowance(address owner,address spender) view returns (uint256)']);
export const receiptAbi = parseAbi(['function pay(bytes32 referenceHash) returns (uint256)']);
export const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
// Read the ID from this receipt, never from a configuration snapshot's nextId.
export function createdLotId(intent: Intent, logs: Pick<Log, 'address' | 'data' | 'topics'>[], deployment: Deployment): string | undefined {
  if (!['openDirect', 'openAuction'].includes(intent.action)) return undefined;
  const matches: bigint[] = [];
  for (const log of logs) {
    if (!same(log.address, deployment.addresses.releaser)) continue;
    try {
      const { args } = decodeEventLog({ abi: saleAbi, eventName: 'Opened', topics: log.topics, data: log.data, strict: true });
      if (args.mode === (intent.action === 'openDirect' ? 2 : 1) && same(args.asset, String(intent.params.asset)) && args.quantity === BigInt(String(intent.params.quantity)) && args.expiry === BigInt(String(intent.params.expiry)) && args.id > 0n) matches.push(args.id);
    } catch { /* Unrelated or malformed logs are not evidence of lot creation. */ }
  }
  if (matches.length !== 1) throw new Error('Confirmed receipt does not identify exactly one matching lot. Inspect the transaction before retrying.');
  return matches[0]!.toString();
}
export const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
export const states = ['Missing', 'Open', 'Sold', 'Cancelled', 'Unsold', 'Recovered'];
export const modeName = (mode: number) => mode === 2 ? 'Direct purchase' : mode === 1 ? 'Auction' : 'Held for review';
export function amount(raw: string | bigint, decimals: number) {
  const [whole, fraction] = formatUnits(BigInt(raw), decimals).split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? `.${fraction}` : '');
}
export function units(text: string, decimals: number): string {
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(text) || (text.split('.')[1]?.length ?? 0) > decimals) throw new Error(`Enter a positive amount with at most ${decimals} decimal places.`);
  const value = parseUnits(text, decimals);
  if (value <= 0n || value >= 1n << 256n) throw new Error('Amount is outside the supported range.');
  return value.toString();
}
export function recipientAddress(text: string, forbidden: string[]) {
  if (!isAddress(text, { strict: false }) || /^0x0{40}$/i.test(text) || forbidden.some(a => same(a, text))) throw new Error('Enter a valid recipient outside the jar and releaser contracts.');
  return text as Address;
}
export function minimumBid(lot: Lot) { return BigInt(lot.highest) === 0n ? lot.reserve : (BigInt(lot.highest) + BigInt(lot.increment)).toString(); }
export function validateConfig(config: Config, pinned: Deployment) {
  if (config.manifest.chainId !== pinned.chainId || config.manifest.sourceCommit !== pinned.sourceCommit) throw new Error('Deployment verification failed. Transactions are disabled.');
  for (const [name, address] of Object.entries(pinned.addresses)) if (!same(config.manifest.addresses[name], address)) throw new Error('Contract address mismatch. Transactions are disabled.');
  for (const [name, deployment] of Object.entries(pinned.deployments)) {
    const live = config.manifest.deployments[name];
    if (!live || !same(live.address, deployment.address) || !same(live.codeHash, deployment.codeHash)) throw new Error('Contract code identity mismatch.');
  }
  for (const name of ['jar', 'payout']) if (!same(config.roles[name], pinned.addresses[name])) throw new Error('Live role does not match deployment.');
  if (JSON.stringify(config.manifest.feeSource) !== JSON.stringify(pinned.feeSource)) throw new Error('Fee service deployment mismatch.');
  return config;
}
export function validateFeeSource(fee: FeeSource, deployment: Deployment) {
  const pinned = deployment.feeSource;
  if (!pinned || !same(fee.service, deployment.addresses.feeSource) || !same(fee.asset, pinned.asset) || !same(fee.jar, deployment.addresses.jar) || !same(fee.merchant, pinned.merchant) || fee.price !== pinned.price || fee.feeBps !== pinned.feeBps || BigInt(fee.feePerReceipt) !== BigInt(pinned.price) * BigInt(pinned.feeBps) / 10000n) throw new Error('Fee service terms differ from the verified deployment.');
  return fee;
}
export function expectedTransaction(intent: Intent, deployment: Deployment): { to: Address; data: Hex } {
  const p = intent.params;
  const n = (key: string) => BigInt(String(p[key]));
  let args: unknown[];
  switch (intent.action) {
    case 'approveFeeAsset': {
      if (!deployment.feeSource || !deployment.addresses.feeSource || String(p.amount) !== deployment.feeSource.price) throw new Error('Fee approval must match the verified service price.');
      return { to: deployment.feeSource.asset, data: encodeFunctionData({ abi: tokenAbi, functionName: 'approve', args: [deployment.addresses.feeSource, n('amount')] }) };
    }
    case 'payForReceipt': {
      if (!deployment.feeSource || !deployment.addresses.feeSource) throw new Error('Fee service is not configured.');
      return { to: deployment.addresses.feeSource, data: encodeFunctionData({ abi: receiptAbi, functionName: 'pay', args: [p.referenceHash as Hex] }) };
    }
    case 'approvePayout': return { to: deployment.addresses.payout!, data: encodeFunctionData({ abi: tokenAbi, functionName: 'approve', args: [deployment.addresses.releaser!, n('amount')] }) };
    case 'openDirect': args = [p.asset, n('quantity'), n('expiry')]; break;
    case 'openAuction': args = [p.asset, n('quantity'), n('expiry'), n('reserve'), n('increment')]; break;
    case 'bid': args = [n('id'), n('amount'), p.recipient]; break;
    case 'fillDirect': args = [n('id'), n('maximum'), n('deadline'), p.expectedPolicyHash, p.recipient]; break;
    case 'withdrawRefund': args = []; break;
    case 'setPaused': args = [p.paused]; break;
    case 'setAssetMode': args = [p.asset, p.mode]; break;
    case 'setPolicy': {
      const policy = p.policy as Policy;
      args = [p.asset, { ...policy, minLiquidity: BigInt(policy.minLiquidity), maxQuantity: BigInt(policy.maxQuantity), version: BigInt(policy.version) }]; break;
    }
    case 'cancelDirect': case 'cancelAuction': case 'expireDirect': case 'finalizeAuction': case 'recover': args = [n('id')]; break;
    default: throw new Error('Unsupported wallet action.');
  }
  return { to: deployment.addresses.releaser!, data: encodeFunctionData({ abi: saleAbi, functionName: intent.action as never, args: args as never }) };
}
export function validatePrepared(tx: Prepared, intent: Intent, sender: Address, deployment: Deployment) {
  const expected = expectedTransaction(intent, deployment);
  if (tx.chainId !== deployment.chainId || !same(tx.from, sender) || tx.value !== '0' || !same(tx.to, expected.to) || !same(tx.data, expected.data)) throw new Error('Prepared transaction differs from your request. Nothing was signed.');
  if (intent.action === 'fillDirect' && !same(tx.expectedPolicyHash ?? undefined, String(intent.params.expectedPolicyHash))) throw new Error('Frozen policy changed. Refresh this lot.');
  return tx;
}
const reasons: Record<string, string> = {
  STALE_OBSERVATION: 'The price reference is too old. The operator must refresh the test pool before a direct purchase can proceed.',
  INCOMPLETE_HISTORY: 'The reference pool has not accumulated enough price history.',
  LOW_LIQUIDITY: 'The reference pool does not meet the required liquidity.',
  INSUFFICIENT_LIQUIDITY: 'The reference pool does not meet the required liquidity.',
  TICK_DEVIATION: 'The current price has moved too far from the time-weighted reference.',
  EXCESSIVE_DEVIATION: 'The current price has moved too far from the time-weighted reference.',
  ADMISSION_PAUSED: 'New purchases and bids are paused. Existing refunds and permitted exits remain available.',
  LOT_CLOSED: 'This lot is closed or has expired.', WRONG_STATE: 'This action is no longer available. Refresh the lot.',
  CODE_MISMATCH: 'Deployed contract code does not match the verified deployment. Transactions are disabled.',
  CHAIN_MISMATCH: 'The API reached an unexpected network. Transactions are disabled.',
  RPC_UNAVAILABLE: 'Chain data is temporarily unavailable. Try again shortly.', RATE_LIMITED: 'Too many requests. Please wait a minute before refreshing.',
  POLICY_MISMATCH: 'The frozen policy does not match this quote. Refresh before signing.',
  MAXIMUM_EXCEEDED: 'The current price exceeds your maximum payment. Review a fresh quote.',
  TREASURY_SELF_PAYMENT: 'The treasury wallet cannot buy a direct lot from itself.',
};
export function readable(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && [4001, 'ACTION_REJECTED'].includes(error.code as never)) return 'You declined the wallet request. No transaction was confirmed.';
  const text = error instanceof Error ? error.message : String(error);
  if (/rejected|denied/i.test(text)) return 'You declined the wallet request. No transaction was confirmed.';
  return reasons[text] ?? (/^[A-Z_]+$/.test(text) ? text.toLowerCase().replaceAll('_', ' ') : text.slice(0, 220));
}
