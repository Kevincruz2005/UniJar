// SPDX-License-Identifier: AGPL-3.0-only
import { createPublicClient, http, type Abi, type Address, type Hex } from 'viem';

export interface Gateway {
  chainId(): Promise<number>;
  blockNumber(): Promise<bigint>;
  timestamp(block: bigint): Promise<bigint>;
  code(address: Address, block: bigint): Promise<Hex | undefined>;
  read(address: Address, abi: Abi, method: string, args: readonly unknown[], block: bigint): Promise<unknown>;
  simulate(address: Address, abi: Abi, method: string, args: readonly unknown[], sender: Address, block: bigint): Promise<void>;
}
export function rpcGateway(url: string): Gateway {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid RPC protocol');
  // Batch JSON-RPC reads without relying on a Multicall deployment. Every call
  // retains its explicit block. Only reads/simulations are exposed by Gateway.
  const client = createPublicClient({ transport: http(url, { batch: { batchSize: 20, wait: 5 }, timeout: 8000, retryCount: 1, retryDelay: 250 }), batch: { multicall: false } });
  return {
    chainId: () => client.getChainId(),
    blockNumber: () => client.getBlockNumber({ cacheTime: 0 }),
    timestamp: async blockNumber => (await client.getBlock({ blockNumber })).timestamp,
    code: (address, blockNumber) => client.getCode({ address, blockNumber }),
    read: (address, abi, functionName, args, blockNumber) => client.readContract({ address, abi, functionName, args, blockNumber }),
    simulate: async (address, abi, functionName, args, account, blockNumber) => { await client.simulateContract({ address, abi, functionName, args, account, blockNumber }); },
  };
}
// Deliberately omit error messages, request bodies and provider URLs from logs.
export function rpcFailureKind(error: unknown): string {
  let current = error;
  for (let i = 0; i < 10 && current && typeof current === 'object'; i++) {
    const value = current as { name?: string; status?: number; code?: number; cause?: unknown };
    if (value.name === 'TimeoutError') return 'timeout';
    if (value.status === 429 || value.code === -32005) return 'rate_limit';
    if (value.name === 'HttpRequestError' && value.status) return `http_${value.status}`;
    if (value.name === 'ContractFunctionRevertedError' || value.name === 'ExecutionRevertedError') return 'revert';
    current = value.cause;
  }
  return 'unavailable';
}
export function isRevert(error: unknown): boolean {
  let current = error;
  for (let i = 0; i < 10 && current && typeof current === 'object'; i++) {
    const value = current as { name?: string; cause?: unknown };
    if (['ContractFunctionRevertedError', 'ExecutionRevertedError'].includes(value.name ?? '')) return true;
    current = value.cause;
  }
  return false;
}
