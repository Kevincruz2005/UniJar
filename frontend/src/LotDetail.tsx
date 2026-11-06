import { useEffect, useState } from 'react';
import { useConnection } from 'wagmi';
import { formatUnits } from 'viem';
import { useConfig, useCredits, useLot, useQuote } from './api';
import { amount, minimumBid, modeName, readable, recipientAddress, same, states, units } from './domain';
import { AddressLink, Badge, ErrorState, Loading, PageHeading, ReadBlock } from './components';
import { Link, PageTitle } from './navigation';
import { chain, useTransaction, WalletButton } from './wallet';

export function LotDetail({ id }: { id: string }) {
  const config = useConfig(); const query = useLot(id);
  const lot = query.data?.data.lot; const { address, chainId } = useConnection();
  const credits = useCredits(address); const quote = useQuote(id, !!lot && lot.mode === 2 && lot.state === 1);
  const { run, busy } = useTransaction();
  const [recipient, setRecipient] = useState(address ?? '');
  const [bid, setBid] = useState(''); const [maximum, setMaximum] = useState(''); const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => { setRecipient(address ?? ''); setError(''); }, [address]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const cfg = config.data?.data;
  const asset = cfg?.assets.find(a => same(a.asset, lot?.asset)); const payout = cfg?.assets.find(a => a.classification === 'Payout');
  useEffect(() => { if (quote.data?.data.payment && payout) setMaximum(value => value || formatUnits(BigInt(quote.data!.data.payment!), payout.decimals)); }, [quote.data?.data.payment, payout]);
  if (!/^[1-9]\d{0,77}$/.test(id)) return <ErrorState error={new Error('Invalid lot ID.')} />;
  if (query.isPending || config.isPending) return <Loading />;
  if (!lot || query.isError || !cfg || config.isError || !asset || !payout) return <ErrorState error={query.error ?? config.error ?? new Error('Configured asset data is unavailable.')} retry={() => { void query.refetch(); void config.refetch(); }} />;
  const expired = BigInt(lot.expiry) * 1000n <= BigInt(now);
  const open = lot.state === 1 && !expired;
  const isDirect = lot.mode === 2;
  const quoteData = quote.data?.data;
  const canTrade = open && !cfg.paused && (isDirect ? !!quoteData?.eligible && !quote.isError : true);
  const nextMinimum = minimumBid(lot);
  const nextMinimumText = formatUnits(BigInt(nextMinimum), payout.decimals);
  let spend: string | undefined;
  try { spend = isDirect ? quoteData?.payment ?? undefined : units(bid || nextMinimumText, payout.decimals); } catch { /* user edits are validated on submit */ }
  const hasAllowance = !!spend && !!credits.data && BigInt(credits.data.data.allowance) >= BigInt(spend);
  const hasBalance = !!spend && !!credits.data && BigInt(credits.data.data.payoutBalance) >= BigInt(spend);
  const walletReady = !!address && chainId === chain.id;
  const actions = query.data!.data.nextActions;
  async function trade(approve: boolean) {
    setError('');
    try {
      if (!address || !spend || !canTrade || credits.isError) throw new Error('Refresh your wallet balance and the offer before continuing.');
      const recipientValue = recipientAddress(recipient, [cfg!.roles.jar!, cfg!.manifest.addresses.releaser!]);
      if (approve) { await run({ action: 'approvePayout', params: { id, amount: spend } }); return; }
      if (isDirect) {
        const max = units(maximum, payout!.decimals);
        if (BigInt(max) < BigInt(spend)) throw new Error('Your maximum is below the current quote. Review it before buying.');
        await run({ action: 'fillDirect', params: { id, maximum: max, deadline: String(Math.min(Math.floor(Date.now() / 1000) + 300, Number(lot!.expiry))), expectedPolicyHash: lot!.policyHash, recipient: recipientValue } });
      } else {
        if (BigInt(spend) < BigInt(nextMinimum)) throw new Error('Your bid must meet the displayed next minimum.');
        await run({ action: 'bid', params: { id, amount: spend, recipient: recipientValue } });
      }
    } catch (e) { setError(readable(e)); }
  }
  const remaining = Math.max(0, Math.ceil((Number(lot.expiry) * 1000 - now) / 60000));
  return <><PageTitle title={`Lot #${id}`} /><Link className="back-link" href="/lots">← All lots</Link><PageHeading kicker={`LOT / ${id.padStart(3, '0')}`} title={isDirect ? 'One lot. One clear offer.' : 'A lot worth bidding on.'} aside={<Badge tone={open ? 'green' : ''}>{states[lot.state]}{lot.state === 1 && expired ? ' · Expired' : ''}</Badge>} />
    <div className="lot-detail-grid"><section className="lot-overview"><div className="lot-quantity"><Badge>{modeName(lot.mode)}</Badge><h2>{amount(lot.quantity, asset.decimals)}<span>{asset.symbol}</span></h2><p className="muted">Entire lot · {asset.name} · Test token</p></div><dl className="key-values"><div><dt>{open ? 'Time remaining' : 'Expiry'}</dt><dd>{open ? `${remaining} min` : new Date(Number(lot.expiry) * 1000).toLocaleString()}</dd></div><div><dt>Settlement token</dt><dd>{payout.symbol} <Badge>Test token</Badge></dd></div><div><dt>Treasury</dt><dd><AddressLink value={cfg.roles.treasury!} /></dd></div>{!isDirect && <><div><dt>Reserve</dt><dd>{amount(lot.reserve, payout.decimals)} {payout.symbol}</dd></div><div><dt>Bid increment</dt><dd>{amount(lot.increment, payout.decimals)} {payout.symbol}</dd></div><div><dt>Highest funded bid</dt><dd>{amount(lot.highest, payout.decimals)} {payout.symbol}</dd></div>{BigInt(lot.highest) > 0n && <div><dt>Winning recipient</dt><dd><AddressLink value={lot.recipient} /></dd></div>}</>}</dl>
      <details className="details-panel"><summary>Onchain details <span>+</span></summary><dl className="key-values"><div><dt>Asset</dt><dd><AddressLink value={lot.asset} /></dd></div><div><dt>Original jar</dt><dd><AddressLink value={cfg.roles.jar!} /></dd></div><div><dt>Releaser</dt><dd><AddressLink value={cfg.manifest.addresses.releaser!} /></dd></div><div><dt>Frozen policy hash</dt><dd><code className="address-wrap">{lot.policyHash}</code></dd></div>{isDirect && <><div><dt>Reference pool</dt><dd><AddressLink value={lot.policy.pool} /></dd></div><div><dt>TWAP window</dt><dd>{lot.policy.window} seconds</dd></div><div><dt>Maximum observation age</dt><dd>{lot.policy.maxAge} seconds</dd></div><div><dt>Discount</dt><dd>{lot.policy.discountBps} bps</dd></div><div><dt>Minimum harmonic liquidity</dt><dd>{lot.policy.minLiquidity}</dd></div><div><dt>Maximum tick deviation</dt><dd>{lot.policy.maxTickDeviation}</dd></div><div><dt>Maximum quantity</dt><dd>{amount(lot.policy.maxQuantity, asset.decimals)} {asset.symbol}</dd></div><div><dt>Policy version</dt><dd>{lot.policy.version}</dd></div></>}</dl>{isDirect && <p className="small muted">The pool is a price reference. This purchase does not execute an AMM swap.</p>}</details><ReadBlock block={query.data!.block} stale={query.isRefetchError} /></section>
      <aside className="trade-panel"><span className="eyebrow">{open ? isDirect ? 'YOUR PURCHASE' : 'YOUR BID' : 'LOT OUTCOME'}</span>
        {open ? <><h2>{isDirect ? 'Take the whole lot.' : 'Make your move.'}</h2>{isDirect ? quote.isPending ? <Loading text="Checking reference…" /> : quote.isError ? <ErrorState error={quote.error} retry={() => void quote.refetch()} /> : !quoteData?.eligible ? <div className="notice" role="status"><strong>Quote unavailable</strong><p>{readable(new Error(quoteData?.reason ?? 'Reference unavailable'))}</p><button className="inline-link" onClick={() => void quote.refetch()}>Refresh quote ↗</button></div> : <div className="trade-price"><span className="muted small">Current quote</span><strong>{amount(quoteData.payment!, payout.decimals)} <span>{payout.symbol}</span></strong><span className="small muted">Preview at block {quote.data!.block}. Rechecked on execution.</span></div> : <div className="trade-price"><span className="muted small">Next minimum bid</span><strong>{amount(nextMinimum, payout.decimals)} <span>{payout.symbol}</span></strong></div>}
        {cfg.paused && <p className="notice">New bids and purchases are paused.</p>}
        {canTrade && <><label className="field">{isDirect ? `Maximum payment (${payout.symbol})` : `Your bid (${payout.symbol})`}<input inputMode="decimal" value={isDirect ? maximum : bid} placeholder={isDirect ? 'Review current quote' : nextMinimumText} onChange={e => { isDirect ? setMaximum(e.target.value) : setBid(e.target.value); setError(''); }} disabled={busy} /></label><label className="field">Receive tokens at<input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="0x… recipient wallet" spellCheck={false} autoComplete="off" disabled={busy} /></label><p className="small muted">{isDirect ? 'Default maximum equals your initial quote. Review it if the price changes. Purchase requests expire within 5 minutes.' : 'The full bid is funded now. Previous bids become separate refundable credits.'}</p></>}
        {!address ? <WalletButton /> : chainId !== chain.id ? <><p className="notice">Your wallet is on another network. Switch to {chain.name} before signing.</p><WalletButton /></> : canTrade && <>{credits.isPending ? <Loading text="Reading balance & allowance…" /> : credits.isError ? <ErrorState error={credits.error} retry={() => void credits.refetch()} /> : <><div className="trade-balance small"><span>Balance</span><span>{credits.data ? amount(credits.data.data.payoutBalance, payout.decimals) : '—'} {payout.symbol}</span></div>{!hasBalance && <p className="notice">Your wallet needs enough controlled {payout.symbol} test tokens for this amount.</p>}<button className="button secondary full-width" disabled={busy || !spend || !hasBalance || hasAllowance} onClick={() => void trade(true)}>{hasAllowance ? '✓ Allowance sufficient' : `1. Approve exact ${payout.symbol}`}</button><button className="button primary full-width" disabled={busy || !hasAllowance || !hasBalance || !spend} onClick={() => void trade(false)}>{isDirect ? '2. Buy entire lot' : '2. Place funded bid'} <span>↗</span></button></>}</>}
        {error && <p className="notice error" role="alert">{error}</p>}<Link className="inline-link trade-help" href={isDirect ? '/docs/buying' : '/docs/auctions'}>How this works ↗</Link></> : <><h2>{states[lot.state]}{lot.state === 1 ? ' · Expired' : ''}</h2><p className="muted">{lot.state === 2 ? 'The onchain sale has settled.' : lot.state === 5 ? 'The exact unsold inventory was recovered to the original jar.' : 'Follow the available onchain action to complete this lot’s lifecycle.'}</p></>}
        {actions.filter(a => ['finalizeAuction', 'expireDirect', 'recover'].includes(a)).map(action => <button key={action} className="button primary full-width" disabled={!walletReady || busy} onClick={() => void run({ action, params: { id } })}>{{ finalizeAuction: 'Finalize auction', expireDirect: 'Mark direct lot expired', recover: 'Recover exact inventory' }[action]} ↗</button>)}
        {!open && !address && actions.some(a => ['finalizeAuction', 'expireDirect', 'recover'].includes(a)) && <WalletButton />}
        {same(address, cfg.roles.operator) && actions.filter(a => a === 'cancelAuction' || a === 'cancelDirect').map(action => <details className="cancel-details" key={action}><summary>Operator cancellation</summary><p className="small muted">Cancel this eligible unfunded lot. Recovery to the original jar is a separate next action.</p><button className="button secondary full-width" disabled={!walletReady || busy} onClick={() => void run({ action, params: { id } })}>Cancel this lot</button></details>)}
      </aside>
    </div>
  </>;
}
