import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createConfig, http, useConnect, useConnection, useDisconnect, useSwitchChain } from 'wagmi';
import { getConnectorClient } from 'wagmi/actions';
import { injected } from 'wagmi/connectors';
import { sepolia, foundry } from 'wagmi/chains';
import { createPublicClient, createWalletClient, custom, type Hex } from 'viem';
import { useQueryClient } from '@tanstack/react-query';
import { api, deployment, useConfig } from './api';
import { createdLotId, readable, short, validatePrepared, type Intent, type Prepared } from './domain';
import { Link } from './navigation';

export const chain = deployment.chainId === 31337 ? foundry : sepolia;
export const walletConfig = createConfig({ chains: [chain], connectors: [injected()], transports: { [sepolia.id]: http(), [foundry.id]: http() } });
type TxState = { status: 'idle' | 'preparing' | 'wallet' | 'pending' | 'confirmed' | 'failed'; hash?: Hex; message?: string; action?: string };
type Confirmed = { hash: Hex; lotId?: string };
const TxContext = createContext<{ tx: TxState; run: (intent: Intent) => Promise<Confirmed | false>; busy: boolean; refreshing: boolean }>({ tx: { status: 'idle' }, run: async () => false, busy: false, refreshing: false });
export const useTransaction = () => useContext(TxContext);
export function TransactionProvider({ children }: { children: ReactNode }) {
  const connection = useConnection();
  const config = useConfig();
  const query = useQueryClient();
  const [tx, setTx] = useState<TxState>({ status: 'idle' });
  const [refreshing, setRefreshing] = useState(false);
  const lock = useRef(false);
  async function run(intent: Intent) {
    if (lock.current) return false;
    lock.current = true;
    let hash: Hex | undefined;
    let backgroundRefresh = false;
    try {
      if (!connection.address || connection.chainId !== chain.id || !connection.connector) throw new Error(`Connect your wallet to ${chain.name} before continuing.`);
      if (!config.data || config.isError) throw new Error('Verified configuration is unavailable. Refresh before signing.');
      const sender = connection.address;
      setTx({ status: 'preparing', action: intent.action });
      const prepared = validatePrepared(await api<Prepared>('/v1/transactions/prepare', { ...intent, sender }), intent, sender, deployment);
      // Obtain live wallet context after the API request; account/chain may have changed.
      const client = await getConnectorClient(walletConfig, { connector: connection.connector, chainId: chain.id });
      const accounts = await client.request({ method: 'eth_accounts' });
      const currentChain = await client.request({ method: 'eth_chainId' });
      if (accounts[0]?.toLowerCase() !== sender.toLowerCase() || Number(currentChain) !== chain.id) throw new Error('Wallet or network changed. Review and retry.');
      setTx({ status: 'wallet', action: intent.action });
      const signer = createWalletClient({ account: sender, chain, transport: custom(client) });
      hash = await signer.sendTransaction({ to: prepared.to, data: prepared.data, value: 0n });
      setTx({ status: 'pending', hash, action: intent.action });
      const reader = createPublicClient({ chain, transport: custom(client) });
      const receipt = await reader.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 180000, pollingInterval: chain.id === 31337 ? 100 : 4000 });
      hash = receipt.transactionHash;
      const confirmed = await reader.getTransaction({ hash });
      if (confirmed.from.toLowerCase() !== sender.toLowerCase() || confirmed.to?.toLowerCase() !== prepared.to.toLowerCase() || confirmed.input.toLowerCase() !== prepared.data.toLowerCase() || confirmed.value !== 0n) throw new Error('The transaction was replaced by a different request. Inspect the transaction before continuing.');
      if (receipt.status !== 'success') throw new Error('The transaction reverted. No changes from this transaction were applied.');
      const lotId = createdLotId(intent, receipt.logs, deployment);
      setTx({ status: 'confirmed', hash, action: intent.action });
      // Confirmation is a receipt fact. Refreshing balances must not delay it
      // or navigation to the actual created lot. Keep writes locked meanwhile.
      backgroundRefresh = true;
      setRefreshing(true);
      void query.invalidateQueries().catch(() => undefined).finally(() => { lock.current = false; setRefreshing(false); });
      return { hash, lotId };
    } catch (error) {
      setTx({ status: 'failed', hash, action: intent.action, message: hash ? `Confirmation could not be completed: ${readable(error)} Check the transaction before retrying.` : readable(error) });
      void query.invalidateQueries();
      return false;
    } finally { if (!backgroundRefresh) lock.current = false; }
  }
  return <TxContext.Provider value={{ tx, run, refreshing, busy: refreshing || ['preparing', 'wallet', 'pending'].includes(tx.status) }}>{children}</TxContext.Provider>;
}
export const explorer = (kind: 'address' | 'tx', value: string) => chain.id === 11155111 ? `https://sepolia.etherscan.io/${kind}/${value}` : undefined;
export function WalletButton() {
  const { address, chainId, isConnected } = useConnection();
  const connect = useConnect(); const disconnect = useDisconnect(); const switchChain = useSwitchChain();
  const [open, setOpen] = useState(false);
  const { busy } = useTransaction();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  return <>
    <button className={`wallet-button ${isConnected && chainId !== chain.id ? 'wrong-network' : ''}`} onClick={() => setOpen(true)} aria-haspopup="dialog">{isConnected ? chainId !== chain.id ? 'Wrong network' : short(address!) : 'Connect wallet'}<span className="wallet-dot" /></button>
    <dialog ref={dialog} className="wallet-dialog" aria-labelledby="wallet-panel-title" onCancel={() => setOpen(false)} onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <button className="dialog-close icon-button" onClick={() => setOpen(false)} aria-label="Close wallet panel">×</button>
      <span className="eyebrow">YOUR WALLET</span><h2 id="wallet-panel-title">{isConnected ? 'You’re connected.' : 'Connect to UniJar.'}</h2>
      <p className="muted">{isConnected ? `${chain.name} · ${short(address!)}` : 'Browse freely. Connect when you’re ready to buy, bid or withdraw.'}</p>
      {isConnected ? <div className="stack">
        <code className="address-wrap">{address}</code>
        {chainId !== chain.id && <button className="button primary" disabled={switchChain.isPending || busy} onClick={() => switchChain.mutate({ chainId: chain.id })}>Switch to {chain.name}</button>}
        <Link className="button secondary" href="/wallet/credits" onClick={() => setOpen(false)}>View my funds ↗</Link>
        <button className="button text-button" disabled={busy} onClick={() => { disconnect.mutate(); setOpen(false); }}>Disconnect wallet</button>
      </div> : <div className="stack">
        {connect.connectors.map(connector => <button className="button secondary" key={connector.uid} disabled={connect.isPending} onClick={async () => { try { await connect.mutateAsync({ connector }); setOpen(false); } catch { /* rendered below */ } }}>{connect.isPending ? 'Waiting for wallet…' : `Connect ${connector.name === 'Injected' ? 'browser wallet' : connector.name}`}<span>↗</span></button>)}
        <p className="small muted">Use MetaMask, Rabby or another injected EVM wallet. On mobile, open UniJar in your wallet’s browser.</p>
        <a className="inline-link" href="https://metamask.io/download/" target="_blank" rel="noreferrer">Get a browser wallet ↗</a>
      </div>}
      {(connect.error || switchChain.error) && <p className="notice error" role="alert">{readable(connect.error || switchChain.error)}</p>}
    </dialog>
  </>;
}
export function TransactionNotice() {
  const { tx, refreshing } = useTransaction();
  if (tx.status === 'idle') return null;
  const text = { preparing: 'Checking your transaction…', wallet: 'Review the request in your wallet.', pending: 'Submitted. Waiting for onchain confirmation…', confirmed: 'Transaction confirmed.', failed: tx.message }[tx.status];
  return <aside className={`transaction-notice ${tx.status}`} role={tx.status === 'failed' ? 'alert' : 'status'} aria-live="polite"><span className="status-indicator" /><div><strong>{text}</strong>{refreshing && <span className="small">Refreshing verified balances…</span>}{tx.hash && (explorer('tx', tx.hash) ? <a href={explorer('tx', tx.hash)} target="_blank" rel="noreferrer">View transaction ↗</a> : <code>{short(tx.hash)}</code>)}</div></aside>;
}
