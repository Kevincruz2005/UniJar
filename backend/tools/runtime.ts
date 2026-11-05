// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createPublicClient, http, encodeFunctionData, type Abi, type Address, type Hex } from 'viem';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
if (existsSync(resolve(root, '.local/sepolia.env'))) process.loadEnvFile(resolve(root, '.local/sepolia.env'));
export const chainId = Number(process.env.CHAIN_ID ?? 11155111);
if (![31337, 11155111].includes(chainId)) throw new Error('Only Anvil 31337 and Sepolia 11155111 are permitted');
export const rpc = chainId === 31337 ? process.env.RPC_URL ?? 'http://127.0.0.1:18545' : process.env.SEPOLIA_RPC_URL;
if (!rpc) throw new Error('Missing SEPOLIA_RPC_URL in .local/sepolia.env');
export const client = createPublicClient({ transport: http(rpc, { timeout: 10000, retryCount: 1 }) });
export const accounts = JSON.parse(readFileSync(resolve(root, chainId === 31337 ? '.local/local-accounts.json' : 'deployments/accounts.json'), 'utf8')).accounts as Record<string, Address>;
export function artifact(path: string): { abi: Abi; bytecode: { object: Hex } } { return JSON.parse(readFileSync(resolve(root, path), 'utf8')); }
export const saleArtifact = () => artifact('contracts/out/UniJar.sol/UniJar.json');
export const tokenArtifact = () => artifact('contracts/out/FixtureToken.sol/FixtureToken.json');
export async function assertChain() { if (await client.getChainId() !== chainId) throw new Error('RPC chain mismatch'); }
export async function broadcast(data: Hex, to: Address | undefined, signer = 'operator'): Promise<Hex> {
  await assertChain();
  const alias = chainId === 31337 ? `local-${signer}` : signer;
  const args = ['send', '--async', '--chain', String(chainId), '--rpc-timeout', '15', '--keystore', resolve(root, '.local/keystores', alias), '--password-file', resolve(root, '.local/account-password')];
  if (to) args.push(to, '--data', data); else args.push('--create', data);
  try {
    const output = execFileSync(resolve(root, '.tools/cast'), args, { env: { ...process.env, ETH_RPC_URL: rpc }, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const hash = output.match(/0x[0-9a-fA-F]{64}/)?.[0]; if (!hash) throw new Error('No transaction hash'); return hash as Hex;
  } catch { throw new Error('Local signing/broadcast failed; verify funding, keystore and RPC (details suppressed to protect credentials)'); }
}
export async function confirm(hash: Hex) {
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: chainId === 31337 ? 1 : 2, timeout: 180000, pollingInterval: chainId === 31337 ? 50 : 4000 });
  if (receipt.status !== 'success') throw new Error(`Transaction reverted: ${hash}`); return receipt;
}
export async function write(to: Address, abi: Abi, functionName: string, args: readonly unknown[], signer = 'operator') {
  return confirm(await broadcast(encodeFunctionData({ abi, functionName, args }), to, signer));
}
export const read = (address: Address, abi: Abi, functionName: string, args: readonly unknown[] = []) => client.readContract({ address, abi, functionName, args });
export const json = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n';
