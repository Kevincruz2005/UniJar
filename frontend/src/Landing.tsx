import { Link, PageTitle } from './navigation';
import { useConfig, useLot } from './api';
import { amount, states, modeName } from './domain';
import { Badge } from './components';
import { chain } from './wallet';

function JarGraphic() {
  return <div className="jar-scene" aria-label="Illustration: collected fee tokens become an exact lot, exchanged for treasury funds" role="img">
    <svg className="scene-lines" viewBox="0 0 620 530" fill="none" aria-hidden="true"><defs><linearGradient id="lineFade"><stop stopColor="#6487ec" stopOpacity="0"/><stop offset=".5" stopColor="#6487ec" stopOpacity=".4"/><stop offset="1" stopColor="#6487ec" stopOpacity="0"/></linearGradient></defs>{Array.from({ length: 9 }, (_, i) => <path key={i} d={`M${30 + i * 12} 0 C${100 + i * 15} 180 ${400 - i * 8} 240 ${580 - i * 13} 530`} stroke="url(#lineFade)" />)}<ellipse cx="310" cy="436" rx="156" ry="23" fill="#d9e3fb" opacity=".6"/></svg>
    <div className="scene-caption top"><span className="live-dot" /> COLLECTED FEES</div>
    <div className="floating-token token-one">↗</div><div className="floating-token token-two">Ξ</div><div className="floating-token token-three">✳</div>
    <div className="jar-object"><div className="jar-rim" /><div className="jar-neck" /><div className="jar-body"><span className="jar-reflection"/><span className="jar-wordmark">u<span>.</span></span><div className="jar-fill"><span/><span/><span/><span/></div></div><div className="jar-base" /></div>
    <div className="scene-tag tag-left"><span className="tiny-mark">01</span><span>One exact lot</span></div>
    <div className="scene-tag tag-right"><span className="tiny-mark">↗</span><span>One treasury token</span></div>
    <span className="scene-caption bottom">A SMALL JAR. A CLEAR PURPOSE.</span>
  </div>;
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
    <section className="landing-hero"><div className="hero-copy"><Badge tone="network"><span className="live-dot" /> LIVE ON {chain.name.toUpperCase()}</Badge><h1>Make collected<br/>fees <span className="serif-word">useful.</span></h1><p>Collected in many tokens.<br/>Settled in one.</p><p className="hero-detail">Buy an exact token lot directly, or place a funded bid. Every sale settles onchain.</p><div className="hero-actions"><Link className="button primary" href="/lots">Explore lots <span>↗</span></Link><Link className="hero-docs-link" href="/docs">Read the docs <span>↗</span></Link></div></div><JarGraphic /></section>
    <CurrentLotLink />
    <section className="methods-section"><div className="section-intro"><span className="eyebrow">TWO WAYS TO SETTLE</span><h2>Same jar.<br/><span className="serif-word">Your approach.</span></h2><p className="muted">One complete lot, one payout token.<br/>The sale method is set before it opens.</p></div><div className="method-row"><div className="method-number">01 /</div><div><h3>Buy directly <span>↗</span></h3><p>A reference-priced lot. Review the current quote and buy the entire amount in one transaction.</p><Link href="/docs/buying" className="inline-link">How direct purchases work ↗</Link></div></div><div className="method-row"><div className="method-number">02 /</div><div><h3>Place a bid <span>↗</span></h3><p>A funded auction with a fixed end time. If you’re outbid, your previous bid becomes withdrawable.</p><Link href="/docs/auctions" className="inline-link">How auctions work ↗</Link></div></div></section>
    <section className="landing-last"><span className="eyebrow">OPEN BY DESIGN</span><h2>Follow the tokens.<br/>See the <span className="serif-word">whole picture.</span></h2><div><p>Browse the jar, inspect each lot’s terms and verify the outcome onchain. Connecting a wallet is only needed to take action.</p><Link className="button secondary" href="/inventory">See the inventory ↗</Link></div></section>
    <p className="demo-note">{chain.name} demo · Controlled test tokens · No mainnet funds · Unaudited</p>
  </>;
}
