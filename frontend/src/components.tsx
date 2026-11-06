import type { ReactNode } from 'react';
import { readable, short } from './domain';
import { explorer } from './wallet';
import { SidePattern } from './SidePattern';
export function Arrow({ diagonal = false }: { diagonal?: boolean }) { return <span aria-hidden="true">{diagonal ? '↗' : '↗'}</span>; }
export function Logo({ small = false }: { small?: boolean }) { return <span className={`brand ${small ? 'small-brand' : ''}`}><svg width="30" height="32" viewBox="0 0 36 38" fill="none" aria-hidden="true"><path d="M6 7v16a12 12 0 0024 0V7M13 7h10" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"/><circle cx="18" cy="23" r="3" fill="currentColor"/></svg>UniJar<span className="brand-period">.</span></span>; }
export function Badge({ children, tone = '' }: { children: ReactNode; tone?: string }) { return <span className={`badge ${tone}`}>{children}</span>; }
export function AddressLink({ value, full = false }: { value: string; full?: boolean }) { const url = explorer('address', value); return url ? <a className="address-link" href={url} target="_blank" rel="noreferrer" title={value}>{full ? value : short(value)} ↗</a> : <code title={value}>{full ? value : short(value)}</code>; }
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) { return <div className="notice error" role="alert"><strong>Unable to load verified data.</strong><p>{readable(error)}</p>{retry && <button className="inline-link" onClick={retry}>Try again ↗</button>}</div>; }
export function Loading({ text = 'Reading onchain data…' }: { text?: string }) { return <div className="loading-state" role="status"><span className="spinner" />{text}</div>; }
export function Empty({ title, children }: { title: string; children: ReactNode }) { return <div className="empty-state"><span className="empty-glyph" aria-hidden="true">∪</span><h2>{title}</h2><div className="muted">{children}</div></div>; }
export function PageHeading({ kicker, title, description, aside }: { kicker: string; title: string; description?: string; aside?: ReactNode }) { return <div className="page-heading"><div><span className="eyebrow">{kicker}</span><h1>{title}</h1>{description && <p className="muted">{description}</p>}</div>{aside}<SidePattern className="heading-pattern" /></div>; }
export function ReadBlock({ block, stale }: { block: string; stale?: boolean }) { return <p className={`read-block ${stale ? 'stale' : ''}`}><span className="live-dot" />{stale ? 'Refresh failed. Last read at' : 'Read at'} block {block}{stale && ' · Treat this data as stale.'}</p>; }
