import { Link, PageTitle } from './navigation';
import { useConfig, useLot } from './api';
import { amount, states } from './domain';
import { Badge } from './components';
import { chain } from './wallet';
import { SidePattern } from './SidePattern';

function SettlementMarquee() {
  const labels = ['EXACT LOTS', 'DIRECT PURCHASES', 'FUNDED AUCTIONS', 'ONCHAIN SETTLEMENT'];
  return <div className="settlement-marquee" aria-hidden="true"><div className="marquee-track">{[0, 1].map(copy => <div className="marquee-group" key={copy}>{labels.map(label => <span key={label}><i>✳</i>{label}</span>)}</div>)}</div></div>;
}

function CurrentLotLink() {
  const cfg = useConfig(); const id = cfg.data?.data.activeId ?? '0'; const lot = useLot(id);
  if (!cfg.data || cfg.isError) return <Link className="landing-live-link" href="/lots"><span>Explore the onchain demo</span><span>View lots ↗</span></Link>;
  if (id === '0') return <Link className="landing-live-link" href="/inventory"><span><span className="live-dot" /> The jar is ready. No active lot.</span><span>Explore inventory ↗</span></Link>;
  const asset = cfg.data.data.assets.find(a => a.asset.toLowerCase() === lot.data?.data.lot.asset.toLowerCase());
  return <Link className="landing-live-link" href={`/lots/${id}`}><span><span className="live-dot" /> Lot #{id}{lot.data && asset ? ` · ${amount(lot.data.data.lot.quantity, asset.decimals)} ${asset.symbol}` : ''}</span><span>{lot.data ? states[lot.data.data.lot.state] : 'View lot'} ↗</span></Link>;
}
export function Landing() {
  return <><PageTitle title="Make collected fees useful" />
    <section className="landing-hero"><div className="hero-copy"><Badge tone="network"><span className="live-dot" /> LIVE ON {chain.name.toUpperCase()}</Badge><h1>Make collected<br/>fees<br/><span className="hero-emphasis">useful.</span></h1><p className="hero-detail">Buy exact token lots from collected protocol fees. Pay directly or place a funded bid. Every sale settles onchain.</p><div className="hero-facts" aria-label="Sale methods and network"><span>DIRECT LOTS</span><span>FUNDED AUCTIONS</span><span>SEPOLIA TESTNET</span></div><div className="hero-actions"><Link className="button primary" href="/lots">Explore lots <span>↗</span></Link><Link className="hero-docs-link" href="/docs">Read the docs <span>↗</span></Link></div></div><SidePattern className="hero-pattern" /></section>
    <CurrentLotLink />
    <SettlementMarquee />
    <section className="methods-section"><div className="section-intro"><span className="eyebrow">TWO WAYS TO SETTLE</span><h2>Same jar.<br/><span>Your approach.</span></h2><p className="muted">One complete lot, one payout token.<br/>The sale method is set before it opens.</p></div><div className="method-row"><div className="method-number">01 /</div><div><h3>Buy directly <span>↗</span></h3><p>A reference-priced lot. Review the current quote and buy the entire amount in one transaction.</p><Link href="/docs/buying" className="inline-link">How direct purchases work ↗</Link></div></div><div className="method-row"><div className="method-number">02 /</div><div><h3>Place a bid <span>↗</span></h3><p>A funded auction with a fixed end time. If you’re outbid, your previous bid becomes withdrawable.</p><Link href="/docs/auctions" className="inline-link">How auctions work ↗</Link></div></div></section>
    <section className="landing-last"><span className="eyebrow">OPEN BY DESIGN</span><h2>Follow the tokens.<br/>See the <span>whole picture.</span></h2><div><p>Browse the jar, inspect each lot’s terms and verify the outcome onchain. Connecting a wallet is only needed to take action.</p><Link className="button secondary" href="/inventory">See the inventory ↗</Link></div></section>
    <p className="demo-note">{chain.name} demo · Controlled test tokens · No mainnet funds · Unaudited</p>
  </>;
}
