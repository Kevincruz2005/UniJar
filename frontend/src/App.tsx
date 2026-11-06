import { useEffect, useState } from 'react';
import { useConnection } from 'wagmi';
import { Link, usePath, PageTitle } from './navigation';
import { Logo, Empty } from './components';
import { WalletButton, TransactionNotice, chain } from './wallet';
import { useConfig } from './api';
import { same } from './domain';
import { Landing } from './Landing';
import { Docs } from './Docs';
import { Lots, InventoryPage, Funds } from './Markets';
import { LotDetail } from './LotDetail';
import { Operator } from './Operator';
import { SidePattern } from './SidePattern';
import { Status } from './Status';

export function App() {
  const path = usePath(); const [menu, setMenu] = useState(false);
  const { address } = useConnection(); const cfg = useConfig();
  const isOperator = same(address, cfg.data?.data.roles.operator);
  useEffect(() => { setMenu(false); }, [path]);
  const links = [['/lots', 'Lots'], ['/inventory', 'Inventory'], ['/wallet/credits', 'My funds'], ['/docs', 'Docs'], ...(isOperator ? [['/operator', 'Operator']] : [])];
  let view;
  if (path === '/') view = <Landing />;
  else if (path === '/lots') view = <Lots />;
  else if (path.startsWith('/lots/')) view = <LotDetail key={path} id={path.split('/')[2]!} />;
  else if (path === '/inventory') view = <InventoryPage />;
  else if (path === '/wallet/credits') view = <Funds />;
  else if (path === '/operator') view = <Operator />;
  else if (path === '/status') view = <Status />;
  else if (path === '/docs' || path.startsWith('/docs/')) view = <Docs slug={path.split('/')[2] || 'overview'} />;
  else view = <><PageTitle title="Not found" /><Empty title="This page isn’t in the jar."><Link className="button primary" href="/">Back to home ↗</Link></Empty></>;
  return <><a className="skip-link" href="#main-content">Skip to content</a><header className="site-header"><Link href="/" aria-label="UniJar home"><Logo /></Link><nav id="main-navigation" className={`site-nav ${menu ? 'is-open' : ''}`} aria-label="Main navigation">{links.map(([href, label]) => <Link key={href} href={href} aria-current={path === href || path.startsWith(`${href}/`) ? 'page' : undefined}>{label}</Link>)}</nav><div className="header-wallet"><span className="network-label"><span className="live-dot" />{chain.name}</span><WalletButton /><button className="menu-button icon-button" aria-label={menu ? 'Close navigation' : 'Open navigation'} aria-expanded={menu} aria-controls="main-navigation" onClick={() => setMenu(v => !v)}>{menu ? '×' : '☰'}</button></div></header><main id="main-content" className={`site-main ${path !== '/' && !path.startsWith('/docs') ? 'product-main' : ''}`} tabIndex={-1}>{view}</main><footer className="site-footer"><SidePattern className="footer-pattern" /><Link href="/" aria-label="UniJar home"><Logo small /></Link><span className="footer-note">Made for transparent settlement.</span><div className="footer-links"><Link href="/status">Service status</Link><Link href="/docs/limits">Testnet demo</Link><Link href="/docs">Docs</Link><a href="https://github.com/Kevincruz2005/UniJar" target="_blank" rel="noreferrer">GitHub ↗</a></div></footer><TransactionNotice /></>;
}
