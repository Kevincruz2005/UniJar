import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createPublicClient, http, type Address, type Abi, type Hex } from 'viem';
import { expect, type Page } from '@playwright/test';

export const root = resolve(import.meta.dirname, '../../..');
export const network = process.env.WALLET_TEST_NETWORK;
const local = network === 'local';
if (network === 'sepolia' && existsSync(resolve(root, '.local/sepolia.env'))) process.loadEnvFile(resolve(root, '.local/sepolia.env'));
export const manifest = JSON.parse(readFileSync(resolve(root, `deployments/${local ? 'local' : 'sepolia'}.json`), 'utf8'));
export const accounts = JSON.parse(readFileSync(resolve(root, local ? '.local/local-accounts.json' : 'deployments/accounts.json'), 'utf8')).accounts as Record<string, Address>;
export const chainId = local ? 31337 : 11155111;
const rpc = local ? 'http://127.0.0.1:18545' : process.env.SEPOLIA_RPC_URL;
export const client = createPublicClient({ transport: http(rpc, { timeout: 15000 }) });
export const saleAbi = JSON.parse(readFileSync(resolve(root, 'backend/public/UniJar.json'), 'utf8')) as Abi;
export const tokenAbi = JSON.parse(readFileSync(resolve(root, 'backend/public/IERC20.json'), 'utf8')) as Abi;
export const hashes: Hex[] = [];
export const readSale = (functionName: string, args: unknown[] = []) => client.readContract({ address: manifest.addresses.releaser, abi: saleAbi, functionName, args });
export const balance = (token: Address, who: Address) => client.readContract({ address: token, abi: tokenAbi, functionName: 'balanceOf', args: [who] }) as Promise<bigint>;
const execute = promisify(execFile);

async function sign(data: Hex, to: Address, alias: string): Promise<Hex> {
  if (!rpc || !accounts[alias]) throw new Error('Wallet test prerequisites unavailable.');
  const keyAlias = local ? `local-${alias}` : alias;
  try {
    const { stdout } = await execute(resolve(root, '.tools/cast'), ['send', '--async', '--chain', String(chainId), '--rpc-timeout', '20', '--keystore', resolve(root, '.local/keystores', keyAlias), '--password-file', resolve(root, '.local/account-password'), to, '--data', data], { env: { ...process.env, ETH_RPC_URL: rpc }, timeout: 90000, maxBuffer: 1024 * 1024 });
    const hash = stdout.match(/0x[a-fA-F0-9]{64}/)?.[0] as Hex | undefined;
    if (!hash) throw new Error('No transaction hash.'); hashes.push(hash); return hash;
  } catch { throw new Error('Encrypted test-wallet signing failed; sensitive details suppressed.'); }
}
export async function refreshReference() {
  const { encodeFunctionData } = await import('viem');
  const artifact = JSON.parse(readFileSync(resolve(root, 'oracle-contracts/out/LiquidityFixture.sol/LiquidityFixture.json'), 'utf8'));
  const hash = await sign(encodeFunctionData({ abi: artifact.abi, functionName: 'mint', args: [-887220, 887220, 1000000000n] }), manifest.addresses.fixture, 'operator');
  await client.waitForTransactionReceipt({ hash, timeout: 180000 });
}
export async function advanceTo(timestamp: bigint, page: Page) {
  if (local) {
    await client.request({ method: 'evm_setNextBlockTimestamp' as never, params: [Number(timestamp)] as never });
    await client.request({ method: 'evm_mine' as never, params: [] as never });
    await syncClock(page);
  } else {
    while ((await client.getBlock({ cacheTime: 0 })).timestamp < timestamp) await new Promise(r => setTimeout(r, 8000));
  }
  await page.reload();
}
export async function syncClock(page: Page) {
  if (local) { const timestamp = Number((await client.getBlock({ cacheTime: 0 })).timestamp) * 1000; await page.evaluate(time => { (window as any).__testClockOffset = time - (window as any).__originalNow(); }, timestamp); }
}

export async function installWallet(page: Page, initial = 'operator') {
  if (!network || !rpc || await client.getChainId() !== chainId) throw new Error('Explicit wallet test network and matching RPC required.');
  const submitted: Hex[] = [];
  await page.exposeBinding('__testWalletRpc', async (_source, payload: { method: string; params: any[] }) => {
    try {
      if (payload.method === 'eth_sendTransaction') {
        const tx = payload.params[0];
        if (![manifest.addresses.releaser, manifest.addresses.payout].some(a => a.toLowerCase() === tx.to?.toLowerCase()) || BigInt(tx.value ?? '0x0') !== 0n) throw new Error('Test wallet refuses unexpected target or native value.');
        const alias = Object.entries(accounts).find(([, address]) => address.toLowerCase() === tx.from?.toLowerCase())?.[0];
        if (!alias) throw new Error('Unknown signer.');
        const result = await sign(tx.data, tx.to, alias); submitted.push(result); return { result };
      }
      const response = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...payload }), signal: AbortSignal.timeout(20000) });
      const body = await response.json();
      return body.error ? { error: { message: 'Chain request failed.', code: body.error.code } } : { result: body.result };
    } catch { return { error: { message: 'Wallet test request failed.', code: -32603 } }; }
  });
  const timestamp = Number((await client.getBlock({ cacheTime: 0 })).timestamp) * 1000;
  await page.addInitScript(({ addresses, selected, expectedChain, timestamp, local }) => {
    const w = window as any; const listeners: Record<string, Set<(...args: any[]) => void>> = {};
    let active = sessionStorage.getItem('testWalletAlias') || selected;
    let currentChain = expectedChain; let connected = sessionStorage.getItem('testWalletConnected') === 'yes';
    let rejectNext = false;
    const emit = (event: string, payload: unknown) => listeners[event]?.forEach(callback => callback(payload));
    w.__originalNow = Date.now.bind(Date); w.__testClockOffset = local ? timestamp - Date.now() : 0;
    Date.now = () => w.__originalNow() + w.__testClockOffset;
    w.__testWallet = {
      select(alias: string) { active = alias; sessionStorage.setItem('testWalletAlias', alias); emit('accountsChanged', connected ? [addresses[active]!] : []); },
      chain(id: number) { currentChain = id; emit('chainChanged', `0x${id.toString(16)}`); },
      reject() { rejectNext = true; },
    };
    w.ethereum = {
      isMetaMask: true,
      on(event: string, cb: (...args: any[]) => void) { (listeners[event] ??= new Set()).add(cb); },
      removeListener(event: string, cb: (...args: any[]) => void) { listeners[event]?.delete(cb); },
      async request({ method, params = [] }: { method: string; params?: any[] }) {
        if (method === 'eth_accounts') return connected ? [addresses[active]!] : [];
        if (method === 'eth_requestAccounts') { connected = true; sessionStorage.setItem('testWalletConnected', 'yes'); return [addresses[active]!]; }
        if (method === 'eth_chainId') return `0x${currentChain.toString(16)}`;
        if (method === 'net_version') return String(currentChain);
        if (method === 'wallet_switchEthereumChain') { currentChain = Number(params[0].chainId); emit('chainChanged', params[0].chainId); return null; }
        if (method === 'wallet_getCapabilities') return {};
        if (method === 'eth_sendTransaction' && rejectNext) { rejectNext = false; throw Object.assign(new Error('User rejected request'), { code: 4001 }); }
        const result = await w.__testWalletRpc({ method, params });
        if (result.error) throw Object.assign(new Error(result.error.message), { code: result.error.code });
        return result.result;
      },
    };
  }, { addresses: accounts, selected: initial, expectedChain: chainId, timestamp, local });
  return { submitted };
}
export async function connect(page: Page) {
  await page.locator('header .wallet-button').click();
  await page.getByRole('dialog').getByRole('button', { name: /Connect browser wallet|Connect MetaMask/ }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}
export async function selectWallet(page: Page, alias: string) {
  await page.evaluate(alias => (window as any).__testWallet.select(alias), alias);
  await expect(page.locator('header .wallet-button')).toContainText(accounts[alias]!.slice(0, 6));
}
export async function transact(page: Page, label: RegExp) {
  await page.getByRole('button', { name: label }).click();
  await expect(page.getByText('Transaction confirmed.', { exact: true })).toBeVisible({ timeout: 180000 });
}
export async function saveEvidence(baseURL: string) {
  const receipts = await Promise.all(hashes.map(async hash => { const r = await client.getTransactionReceipt({ hash }); if (r.status !== 'success') throw new Error('A recorded transaction reverted.'); return { hash, block: r.blockNumber.toString(), status: r.status }; }));
  writeFileSync(resolve(root, `.local/frontend-wallet-${network}.json`), JSON.stringify({ network, chainId, url: baseURL, sourceCommit: manifest.sourceCommit, testedAt: new Date().toISOString(), wallet: 'Browser-injected EIP-1193 test provider; signing uses encrypted disposable keystores in the Node test process. No real MetaMask/Rabby extension test is claimed.', transactions: receipts }, null, 2) + '\n');
}
