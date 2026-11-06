import { useState } from 'react';
import { useConnection } from 'wagmi';
import { isAddress } from 'viem';
import { useConfig, useInventory } from './api';
import { amount, modeName, readable, same, units, type Policy } from './domain';
import { AddressLink, Badge, ErrorState, Loading, PageHeading } from './components';
import { Link, PageTitle, navigate } from './navigation';
import { chain, WalletButton, useTransaction } from './wallet';

export function Operator() {
  const config = useConfig(); const inventory = useInventory(); const { address, chainId } = useConnection(); const { run, busy } = useTransaction();
  const [selected, setSelected] = useState(''); const [quantity, setQuantity] = useState(''); const [duration, setDuration] = useState('30');
  const [reserve, setReserve] = useState(''); const [increment, setIncrement] = useState(''); const [error, setError] = useState('');
  const [policyDraft, setPolicyDraft] = useState<Policy | null>(null); const [mode, setMode] = useState('');
  if (config.isPending) return <Loading />;
  if (!config.data || config.isError) return <ErrorState error={config.error} retry={() => void config.refetch()} />;
  const cfg = config.data.data; const authorized = same(address, cfg.roles.operator);
  const assets = cfg.assets.filter(a => a.classification !== 'Payout');
  const asset = assets.find(a => same(a.asset, selected)) ?? assets[0];
  const payout = cfg.assets.find(a => a.classification === 'Payout');
  const balance = inventory.data?.data.find(a => same(a.asset, asset?.asset));
  const disabled = busy || chainId !== chain.id || !authorized;
  async function openLot() {
    setError('');
    try {
      if (!asset || !payout || !balance || inventory.isError || asset.mode === 0) throw new Error('Select an approved asset with verified inventory.');
      const qty = units(quantity, asset.decimals); const minutes = Number(duration);
      if (BigInt(qty) > BigInt(balance.jar) || BigInt(qty) >= 1n << 128n) throw new Error('Quantity exceeds the jar balance or contract limit.');
      if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 10080) throw new Error('Enter an expiry duration of 1 to 10,080 whole minutes.');
      if (asset.mode === 2 && minutes * 60 > asset.policy.maxDuration) throw new Error('Duration exceeds the direct policy maximum.');
      const expiry = String(Math.floor(Date.now() / 1000) + minutes * 60);
      const params = { asset: asset.asset, quantity: qty, expiry, ...(asset.mode === 1 ? { reserve: units(reserve, payout.decimals), increment: units(increment, payout.decimals) } : {}) };
      const confirmed = await run({ action: asset.mode === 2 ? 'openDirect' : 'openAuction', params });
      if (confirmed && confirmed.lotId) navigate(`/lots/${confirmed.lotId}`);
    } catch (e) { setError(readable(e)); }
  }
  async function updatePolicy() {
    setError('');
    try {
      const policy = policyDraft ?? asset!.policy;
      if (!isAddress(policy.pool, { strict: false })) throw new Error('Enter the approved reference pool address.');
      for (const key of ['fee', 'window', 'maxAge', 'maxTickDeviation', 'discountBps', 'maxDuration'] as const) if (!Number.isSafeInteger(policy[key]) || policy[key] < 0) throw new Error('Policy integer fields must be nonnegative whole numbers.');
      for (const key of ['minLiquidity', 'maxQuantity', 'version'] as const) if (!/^[1-9]\d*$/.test(policy[key])) throw new Error('Policy base-unit quantities and version must be positive integers.');
      await run({ action: 'setPolicy', params: { asset: asset!.asset, policy } });
    } catch (e) { setError(readable(e)); }
  }
  const policy = policyDraft ?? asset?.policy;
  return <><PageTitle title="Operator" /><PageHeading kicker="OPERATOR CONSOLE" title="A deliberate next step." description="Live roles, explicit policies and one unresolved lot." aside={<Badge tone={cfg.adopted ? 'green' : ''}>{cfg.adopted ? 'Releaser adopted' : 'Adoption required'}</Badge>} />
    <details className="details-panel operator-roles" open={!authorized}><summary>Deployment & roles <span>+</span></summary><dl className="key-values">{Object.entries(cfg.roles).map(([name, value]) => <div key={name}><dt>{name}</dt><dd><AddressLink value={value} /></dd></div>)}<div><dt>Current releaser</dt><dd><AddressLink value={cfg.currentReleaser} /></dd></div><div><dt>Admissions</dt><dd>{cfg.paused ? 'Paused' : 'Open'}</dd></div></dl></details>
    {!authorized ? <div className="notice"><strong>{address ? 'Read-only for this wallet.' : 'Connect the operator wallet to continue.'}</strong><p>Write controls require the live onchain operator address. Contract authorization still applies to every transaction.</p>{!address && <WalletButton />}</div> : <>
      {chainId !== chain.id && <div className="notice">Switch to {chain.name} to use operator controls. <WalletButton /></div>}
      <div className="operator-admission"><div><h2>New admissions</h2><p className="muted small">Pausing stops new buys and bids. Existing credits and permitted exits remain available.</p></div><button className="button secondary" disabled={disabled} onClick={() => void run({ action: 'setPaused', params: { paused: !cfg.paused } })}>{cfg.paused ? 'Resume admissions' : 'Pause admissions'}</button></div>
      {cfg.activeId !== '0' && <div className="notice">Lot #{cfg.activeId} is unresolved. <Link className="inline-link" href={`/lots/${cfg.activeId}`}>Open its lifecycle actions ↗</Link></div>}
      <div className="operator-grid"><section className="operator-form"><span className="eyebrow">LOT CREATION</span><h2>Commit an exact quantity.</h2><label className="field">Configured asset<select value={asset?.asset ?? ''} disabled={busy} onChange={e => { setSelected(e.target.value); setPolicyDraft(null); setMode(''); setError(''); }}>{assets.map(a => <option key={a.asset} value={a.asset}>{a.symbol} · {modeName(a.mode)}</option>)}</select></label>
      {asset && <><p className="small muted">Jar balance: {balance ? `${amount(balance.jar, asset.decimals)} ${asset.symbol}` : 'Unavailable'} · {modeName(asset.mode)}</p><label className="field">Quantity ({asset.symbol})<input inputMode="decimal" value={quantity} onChange={e => setQuantity(e.target.value)} disabled={busy} /></label><label className="field">Expires in (minutes)<input type="number" min="1" max="10080" step="1" value={duration} onChange={e => setDuration(e.target.value)} disabled={busy} /></label>{asset.mode === 1 && <div className="field-pair"><label className="field">Reserve ({payout?.symbol})<input inputMode="decimal" value={reserve} onChange={e => setReserve(e.target.value)} disabled={busy} /></label><label className="field">Increment ({payout?.symbol})<input inputMode="decimal" value={increment} onChange={e => setIncrement(e.target.value)} disabled={busy} /></label></div>}
      <div className="docs-callout small"><p>The entire selected quantity becomes the lot. Observed intake excess returns to the original jar. Sale proceeds go to <AddressLink value={cfg.roles.treasury!} />.</p></div><button className="button primary full-width" disabled={disabled || cfg.activeId !== '0' || cfg.paused || !cfg.adopted || asset.mode === 0 || !balance || inventory.isError} onClick={() => void openLot()}>Review & open {asset.mode === 1 ? 'auction' : 'direct lot'} ↗</button></>}
      </section><section className="operator-policy"><span className="eyebrow">FUTURE ADMISSIONS</span><h2>Asset policy.</h2><p className="muted small">This deployment allows one mode per configured asset. Existing lot terms stay frozen.</p><label className="field">Sale permission<select value={mode || String(asset?.mode ?? 0)} onChange={e => setMode(e.target.value)} disabled={busy}><option value="0">Held for review</option><option value="1">Auction approved</option><option value="2">Direct approved</option></select></label><button className="button secondary full-width" disabled={disabled || !asset || mode === '' || Number(mode) === asset.mode} onClick={() => void run({ action: 'setAssetMode', params: { asset: asset!.asset, mode: Number(mode) } })}>Update future sale permission ↗</button>
      {policy && <details className="details-panel"><summary>Direct reference settings <span>+</span></summary><p className="small muted">Amounts below use raw contract units. Review all bounds and the next policy version before signing.</p>{(Object.keys(policy) as (keyof Policy)[]).map(key => <label className="field" key={key}>{({ pool: 'Approved pool address', fee: 'Pool fee', window: 'TWAP window (seconds)', maxAge: 'Observation age bound (seconds)', minLiquidity: 'Minimum harmonic liquidity', maxQuantity: 'Maximum asset quantity (base units)', maxTickDeviation: 'Maximum tick deviation', discountBps: 'Discount (basis points)', maxDuration: 'Maximum lot duration (seconds)', version: 'Policy version' })[key]}<input value={String(policy[key])} disabled={busy} inputMode={key === 'pool' ? 'text' : 'numeric'} onChange={e => setPolicyDraft({ ...policy, [key]: ['fee', 'window', 'maxAge', 'maxTickDeviation', 'discountBps', 'maxDuration'].includes(key) ? Number(e.target.value) : e.target.value })} /></label>)}<button className="button secondary full-width" disabled={disabled} onClick={() => void updatePolicy()}>Review & update direct policy ↗</button></details>}
      </section></div>{error && <p className="notice error" role="alert">{error}</p>}
    </>}
  </>;
}
