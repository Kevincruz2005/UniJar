import { Link, PageTitle } from './navigation';
import { useConfig, useLot } from './api';
import { amount, states } from './domain';
import { Badge } from './components';
import { chain } from './wallet';

function JarGraphic() {
  return (
    <div className="jar-scene" role="img" aria-label="Geometric illustration of separate fee tokens collected into one exact lot">
      <div className="scene-topline"><span>COLLECT / COMMIT / SETTLE</span><span>UJ—01</span></div>
      <svg className="lot-sculpture" viewBox="0 0 520 520" fill="none" aria-hidden="true">
        <defs>
          <pattern id="lotGrid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0H0V40" stroke="currentColor" strokeOpacity=".12" />
          </pattern>
          <mask id="jarCutout">
            <rect width="520" height="520" fill="white" />
            <path d="M176 163V308C176 354 204 383 250 383C296 383 324 354 324 308V163" stroke="black" strokeWidth="56" />
          </mask>
        </defs>
        <rect x="20" y="20" width="480" height="480" fill="url(#lotGrid)" />
        <path className="sculpture-shadow" d="M88 163H412V310C412 405 349 468 250 468C151 468 88 405 88 310V163Z" />
        <path className="sculpture-main" d="M88 143H412V290C412 385 349 448 250 448C151 448 88 385 88 290V143Z" mask="url(#jarCutout)" />
        <path className="sculpture-light" d="M88 143H148V290C148 358 188 404 250 404V448C151 448 88 385 88 290V143Z" />
        <rect className="sculpture-main" x="88" y="55" width="80" height="62" />
        <rect className="sculpture-main" x="210" y="55" width="80" height="62" />
        <rect className="sculpture-light" x="332" y="55" width="80" height="62" />
        <path d="M20 20H42M20 20V42M500 20H478M500 20V42M20 500H42M20 500V478M500 500H478M500 500V478" stroke="currentColor" />
        <path d="M250 226V304M218 272L250 304L282 272" stroke="currentColor" strokeWidth="3" />
      </svg>
      <div className="scene-bottomline"><span>MANY TOKENS IN.</span><span>ONE EXACT LOT OUT. ↗</span></div>
    </div>
  );
}

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
    <section className="landing-hero"><div className="hero-copy"><Badge tone="network"><span className="live-dot" /> LIVE ON {chain.name.toUpperCase()}</Badge><h1>Make collected<br/>fees <span className="hero-emphasis">useful.</span></h1><p>Collected in many tokens.<br/>Settled in one.</p><p className="hero-detail">Buy an exact token lot directly, or place a funded bid. Every sale settles onchain.</p><div className="hero-actions"><Link className="button primary" href="/lots">Explore lots <span>↗</span></Link><Link className="hero-docs-link" href="/docs">Read the docs <span>↗</span></Link></div></div><JarGraphic /></section>
    <CurrentLotLink />
    <SettlementMarquee />
    <section className="methods-section"><div className="section-intro"><span className="eyebrow">TWO WAYS TO SETTLE</span><h2>Same jar.<br/><span>Your approach.</span></h2><p className="muted">One complete lot, one payout token.<br/>The sale method is set before it opens.</p></div><div className="method-row"><div className="method-number">01 /</div><div><h3>Buy directly <span>↗</span></h3><p>A reference-priced lot. Review the current quote and buy the entire amount in one transaction.</p><Link href="/docs/buying" className="inline-link">How direct purchases work ↗</Link></div></div><div className="method-row"><div className="method-number">02 /</div><div><h3>Place a bid <span>↗</span></h3><p>A funded auction with a fixed end time. If you’re outbid, your previous bid becomes withdrawable.</p><Link href="/docs/auctions" className="inline-link">How auctions work ↗</Link></div></div></section>
    <section className="landing-last"><span className="eyebrow">OPEN BY DESIGN</span><h2>Follow the tokens.<br/>See the <span>whole picture.</span></h2><div><p>Browse the jar, inspect each lot’s terms and verify the outcome onchain. Connecting a wallet is only needed to take action.</p><Link className="button secondary" href="/inventory">See the inventory ↗</Link></div></section>
    <p className="demo-note">{chain.name} demo · Controlled test tokens · No mainnet funds · Unaudited</p>
  </>;
}
