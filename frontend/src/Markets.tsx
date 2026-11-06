import { useConnection } from 'wagmi';
import { useState } from 'react';
import { useConfig, useCredits, useInventory, useLot } from './api';
import { amount, modeName, same, states } from './domain';
import { Link, PageTitle } from './navigation';
import { AddressLink, Badge, Empty, ErrorState, Loading, PageHeading, ReadBlock } from './components';
import { chain, WalletButton, useTransaction } from './wallet';

function LotRow({ id }: { id: string }) {
  const cfg = useConfig(); const query = useLot(id);
  if (query.isPending) return <div className="lot-row"><Loading text={`Reading lot #${id}…`} /></div>;
  if (!query.data || query.isError) return <div className="lot-row"><ErrorState error={query.error} retry={() => void query.refetch()} /></div>;
  const { lot } = query.data.data; const asset = cfg.data?.data.assets.find(a => same(a.asset, lot.asset));
  return <Link className="lot-row" href={`/lots/${id}`}><div className="lot-row-id">#{id.padStart(3, '0')}</div><div className="lot-row-asset"><strong>{asset ? `${amount(lot.quantity, asset.decimals)} ${asset.symbol}` : 'Token lot'}</strong><span className="muted small">{modeName(lot.mode)} · Entire lot</span></div><Badge tone={lot.state === 1 ? 'green' : ''}>{states[lot.state]}</Badge><span className="lot-row-expiry muted small">{new Date(Number(lot.expiry) * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span><span className="row-arrow">↗</span></Link>;
}
export function Lots() {
  const cfg = useConfig(); const [page, setPage] = useState(0);
  if (cfg.isPending) return <Loading />;
  if (!cfg.data || cfg.isError) return <ErrorState error={cfg.error} retry={() => void cfg.refetch()} />;
  const { activeId, nextId } = cfg.data.data; const last = BigInt(nextId) - 1n;
  const start = last - BigInt(page * 5);
  const ids = Array.from({ length: 5 }, (_, i) => start - BigInt(i)).filter(id => id > 0n && id.toString() !== activeId).map(String);
  return <><PageTitle title="Lots" /><PageHeading kicker="THE MARKET" title="A lot to work with." description="Exact quantities. Explicit terms. Every outcome onchain." aside={<Badge tone="network">{chain.name} · Test tokens</Badge>} />
    {cfg.data.data.paused && <p className="notice">New bids and purchases are paused. Refunds and permitted exits remain available.</p>}
    <div className="section-label"><h2>Current lot</h2><span>ONE UNRESOLVED LOT AT A TIME</span></div>
    {activeId !== '0' ? <div className="active-lot-list"><LotRow id={activeId} /></div> : <Empty title="The next lot starts here."><p>No lot is active right now. Explore what’s in the jar.</p><Link className="button secondary" href="/inventory">View inventory ↗</Link></Empty>}
    <div className="section-label history-label"><h2>Recent lots</h2><span>DIRECT CONTRACT READS</span></div>
    {ids.length ? <div className="lot-list">{ids.map(id => <LotRow key={id} id={id} />)}</div> : <p className="muted">No previous lots on this page.</p>}
    {last > 5n && <div className="pagination"><button className="button secondary" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Newer</button><button className="button secondary" disabled={start <= 5n} onClick={() => setPage(p => p + 1)}>Older →</button></div>}
    <ReadBlock block={cfg.data.block} stale={cfg.isRefetchError} />
  </>;
}
export function InventoryPage() {
  const query = useInventory();
  return <><PageTitle title="Inventory" /><PageHeading kicker="INSIDE THE JAR" title="Every token, accounted for." description="Configured assets held in the jar and in the UniJar releaser." aside={<Link className="inline-link" href="/docs/operator">About asset policies ↗</Link>} />
    {query.isPending ? <Loading /> : !query.data || query.isError ? <ErrorState error={query.error} retry={() => void query.refetch()} /> : <><div className="inventory-table table-wrap"><table><thead><tr><th>Asset</th><th>Available in jar</th><th>In releaser</th><th>Policy</th></tr></thead><tbody>{query.data.data.map((asset, i) => <tr key={asset.asset}><td><div className="asset-cell"><span className={`token-icon token-color-${i % 4}`}>{asset.symbol.slice(0, 1)}</span><div><strong>{asset.symbol}</strong><span className="small muted">{asset.name} · Test token</span><AddressLink value={asset.asset} /></div></div></td><td className="numeric">{amount(asset.jar, asset.decimals)}</td><td className="numeric">{amount(asset.escrow, asset.decimals)}<span className="small muted accounting">{amount(asset.accounted, asset.decimals)} accounted</span></td><td><Badge tone={asset.mode === 0 ? '' : 'green'}>{asset.classification === 'Payout' ? 'Payout token' : modeName(asset.mode)}</Badge></td></tr>)}</tbody></table></div><div className="inventory-notes"><p><strong>Jar and escrow stay separate.</strong> Later deposits do not enlarge an existing lot. Releaser balances can include liabilities or unsolicited tokens.</p><p><strong>Held for review means held.</strong> These configured assets have no sale action. This list does not discover every token deposited.</p></div><ReadBlock block={query.data.block} stale={query.isRefetchError} /></>}
  </>;
}
export function Funds() {
  const { address, chainId } = useConnection(); const cfg = useConfig(); const credits = useCredits(address); const { run, busy } = useTransaction();
  const payout = cfg.data?.data.assets.find(a => a.classification === 'Payout');
  return <><PageTitle title="My funds" /><PageHeading kicker="YOUR WALLET" title="Your funds. Your call." description="Refunds are yours to withdraw, even after the next lot opens." />
    {!address ? <Empty title="See what’s yours."><p>Connect your wallet to view your payout balance and refundable credits.</p><WalletButton /></Empty> : credits.isPending ? <Loading /> : !credits.data || credits.isError || !payout ? <ErrorState error={credits.error ?? cfg.error ?? new Error('Token configuration unavailable.')} retry={() => void credits.refetch()} /> : <><div className="funds-grid"><section className="funds-primary"><span className="eyebrow">READY TO WITHDRAW</span><h2>{amount(credits.data.data.credit, payout.decimals)} <span>{payout.symbol}</span></h2><p className="muted">Credit from outbid or self-outbid funded bids.</p><button className="button primary" disabled={busy || BigInt(credits.data.data.credit) === 0n || chainId !== chain.id || cfg.isError} onClick={() => { void run({ action: 'withdrawRefund', params: {} }); }}>Withdraw my credit ↗</button>{chainId !== chain.id && <p className="notice">Switch your wallet to {chain.name} to withdraw.</p>}</section><section className="funds-secondary"><dl className="key-values"><div><dt>Payout balance</dt><dd>{amount(credits.data.data.payoutBalance, payout.decimals)} {payout.symbol}</dd></div><div><dt>Current allowance</dt><dd>{amount(credits.data.data.allowance, payout.decimals)} {payout.symbol}</dd></div><div><dt>Connected wallet</dt><dd><AddressLink value={address} /></dd></div><div><dt>Approved spender</dt><dd><AddressLink value={credits.data.data.spender} /></dd></div></dl><Link className="inline-link" href="/docs/auctions">Understand bids & refunds ↗</Link></section></div><ReadBlock block={credits.data.block} stale={credits.isRefetchError} /></>}
  </>;
}
