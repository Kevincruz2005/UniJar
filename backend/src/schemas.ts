// SPDX-License-Identifier: AGPL-3.0-only
export const decimal = { type: 'string', pattern: '^(0|[1-9][0-9]{0,77})$' };
export const positive = { type: 'string', pattern: '^[1-9][0-9]{0,77}$' };
export const address = { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' };
export const hash = { type: 'string', pattern: '^0x[0-9a-fA-F]{64}$' };
export const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const integer = (maximum: number) => ({ type: 'integer', minimum: 0, maximum });
export const policy = object({ pool: address, fee: integer(16777215), window: integer(4294967295), maxAge: integer(4294967295), minLiquidity: positive, maxQuantity: positive, maxTickDeviation: integer(16777215), discountBps: integer(100), maxDuration: integer(4294967295), version: positive });
export const actionParams = {
  approveFeeAsset: object({ amount: positive }),
  payForReceipt: object({ referenceHash: hash }),
  setAssetMode: object({ asset: address, mode: integer(2) }),
  setPolicy: object({ asset: address, policy }),
  setPaused: object({ paused: { type: 'boolean' } }),
  openAuction: object({ asset: address, quantity: positive, expiry: positive, reserve: positive, increment: positive }),
  openDirect: object({ asset: address, quantity: positive, expiry: positive }),
  bid: object({ id: positive, amount: positive, recipient: address }),
  fillDirect: object({ id: positive, maximum: positive, deadline: positive, expectedPolicyHash: hash, recipient: address }),
  finalizeAuction: object({ id: positive }), cancelAuction: object({ id: positive }),
  cancelDirect: object({ id: positive }), expireDirect: object({ id: positive }), recover: object({ id: positive }),
  withdrawRefund: object({}),
  approvePayout: object({ id: positive, amount: positive }),
};
export const prepareBody = { oneOf: Object.entries(actionParams).map(([action, params]) => object({ action: { const: action, type: 'string' }, sender: address, params })) };
export const errorResponse = object({ error: { type: 'string' } });
export const envelope = (data: unknown) => object({ block: decimal, data });
export const lot = object({ mode: integer(2), state: integer(5), asset: address, quantity: decimal, committedAt: decimal, expiry: decimal, reserve: decimal, increment: decimal, bidder: address, recipient: address, highest: decimal, policyHash: hash, policy: structuredClone(policy) });
// Disabled/auction policy snapshots contain zero fields; this output schema accepts them.
(lot.properties.policy as ReturnType<typeof object>).properties.minLiquidity = decimal;
(lot.properties.policy as ReturnType<typeof object>).properties.maxQuantity = decimal;
(lot.properties.policy as ReturnType<typeof object>).properties.version = decimal;
export const stringArray = { type: 'array', items: { type: 'string' } };
export const assetInfo = object({ asset: address, name: { type: 'string' }, symbol: { type: 'string' }, decimals: integer(255), mode: integer(2), classification: { enum: ['Payout', 'HeldForReview', 'AuctionApproved', 'DirectApproved'] }, allowedModes: stringArray, policy: lot.properties.policy });
export const reference = { anyOf: [{ type: 'null' }, object({ referenceQuote: decimal, averageTick: { type: 'integer' }, spotTick: { type: 'integer' }, harmonicLiquidity: decimal, latestObservation: integer(4294967295), observationAge: decimal })] };
