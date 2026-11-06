// SPDX-License-Identifier: AGPL-3.0-only
import { createPublicClient, encodeFunctionData, http, type Abi, type Address, type Hex, parseAbiItem } from 'viem';
import { rpcQueue } from './rpc-queue.js';

export type SettlementEvent = { lotId: bigint; action: number; requestId: Hex; resultingState: number; txBlock: bigint; sourceId: Hex; sourceDataHash: Hex; externalObservedAt: bigint; gasPriceWei: bigint; blockNumber: bigint; transactionHash: Hex; logIndex: number };
export interface Gateway {
  baseFee?(block: bigint): Promise<bigint>;
  settlementEvents?(receiver: Address, lotId: bigint, from: bigint, to: bigint): Promise<SettlementEvent[]>;
  successfulReceipt?(hash: Hex, block: bigint): Promise<boolean>;
  chainId(): Promise<number>;
  blockNumber(): Promise<bigint>;
  timestamp(block: bigint): Promise<bigint>;
  code(address: Address, block: bigint): Promise<Hex | undefined>;
  read(address: Address, abi: Abi, method: string, args: readonly unknown[], block: bigint): Promise<unknown>;
  simulate(address: Address, abi: Abi, method: string, args: readonly unknown[], sender: Address, block: bigint): Promise<void>;
}
export function rpcGateway(url: string, options: { requestsPerSecond?: number } = {}): Gateway {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid RPC protocol');
  // Batch JSON-RPC reads without relying on a Multicall deployment. Every call
  // retains its explicit block. Only reads/simulations are exposed by Gateway.
  const schedule = rpcQueue(options.requestsPerSecond);
  const pendingReads = new Map<string, Promise<unknown>>();
  const client = createPublicClient({ transport: http(url, { batch: { batchSize: 20, wait: 5 }, timeout: 8000, retryCount: 1, retryDelay: 1000 }), batch: { multicall: false } });
  return {
    baseFee: blockNumber => schedule(async () => { const b = await client.getBlock({ blockNumber }); if (b.baseFeePerGas === null) throw new Error('Missing base fee'); return b.baseFeePerGas; }),
    settlementEvents: (address, lotId, fromBlock, toBlock) => schedule(async () => {
      if (toBlock < fromBlock || toBlock - fromBlock > 9n) throw new Error('Unbounded log request');
      const logs = await client.getLogs({ address, fromBlock, toBlock, strict: true,
        event: parseAbiItem('event CREActionExecuted(uint256 indexed lotId,uint8 indexed action,bytes32 indexed requestId,uint8 resultingState,uint256 txBlock,bytes32 sourceId,bytes32 sourceDataHash,uint64 externalObservedAt,uint256 gasPriceWei)'), args: { lotId } });
      return logs.filter(log => !log.removed).map(log => ({ ...log.args, blockNumber: log.blockNumber, transactionHash: log.transactionHash, logIndex: log.logIndex }));
    }),
    successfulReceipt: (hash, block) => schedule(async () => { const receipt = await client.getTransactionReceipt({ hash }); return receipt.status === 'success' && receipt.blockNumber === block; }),
    chainId: () => schedule(() => client.getChainId(), true),
    blockNumber: () => schedule(() => client.getBlockNumber({ cacheTime: 0 }), true),
    timestamp: blockNumber => schedule(async () => (await client.getBlock({ blockNumber })).timestamp),
    code: (address, blockNumber) => schedule(() => client.getCode({ address, blockNumber }), true),
    read: (address, abi, functionName, args, blockNumber) => {
      const key = `${address.toLowerCase()}:${blockNumber}:${encodeFunctionData({ abi, functionName, args })}:${JSON.stringify(abi)}`;
      const pending = pendingReads.get(key);
      if (pending) return pending;
      // Share only work still in flight; never reuse a completed/stale result.
      const result = schedule(() => client.readContract({ address, abi, functionName, args, blockNumber })).finally(() => pendingReads.delete(key));
      pendingReads.set(key, result); return result;
    },
    simulate: (address, abi, functionName, args, account, blockNumber) => schedule(async () => { await client.simulateContract({ address, abi, functionName, args, account, blockNumber }); }),
  };
}
// Deliberately omit error messages, request bodies and provider URLs from logs.
export function rpcFailureKind(error: unknown): string {
  let current = error;
  for (let i = 0; i < 10 && current && typeof current === 'object'; i++) {
    const value = current as { name?: string; status?: number; code?: number; cause?: unknown };
    if (value.name === 'TimeoutError') return 'timeout';
    if (value.name === 'RpcQueueFullError') return 'queue_full';
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
