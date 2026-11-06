import { useQuery } from '@tanstack/react-query';
import { api, deployment, useConfig } from './api';
import { Badge, PageHeading, ReadBlock } from './components';
import { readable } from './domain';
import { Link, PageTitle } from './navigation';
import { chain } from './wallet';

type Health = { status: string; version: string; chainId: number };
export function Status() {
  const health = useQuery({ queryKey: ['health'], queryFn: ({ signal }) => api<Health>('/healthz', undefined, signal), retry: false, refetchInterval: 30000 });
  const ready = useQuery({ queryKey: ['ready'], queryFn: ({ signal }) => api<Health>('/readyz', undefined, signal), retry: false, refetchInterval: 30000 });
  const config = useConfig();
  const checks = [
    { name: 'API process', query: health, value: 'Reachable', expected: health.data?.status === 'ok' && health.data.chainId === deployment.chainId },
    { name: 'Chain & contract code', query: ready, value: 'Verified', expected: ready.data?.status === 'ready' && ready.data.chainId === deployment.chainId },
    { name: 'Deployment configuration', query: config, value: 'Verified', expected: !!config.data },
  ];
  return <><PageTitle title="Service status" /><PageHeading kicker="SERVICE STATUS" title="Know what’s available." description="Live checks, refreshed every 30 seconds. A running API alone does not verify chain data." />
    <section aria-label="Service checks" className="status-checks">{checks.map(({ name, query, value, expected }) => <div className="operator-admission" key={name}><div><h2>{name}</h2><p className="small muted">{query.isError ? readable(query.error) : query.isPending ? 'Waiting for a response…' : !expected ? 'Unexpected response. Transactions require verified configuration.' : `Checked ${new Date(query.dataUpdatedAt).toLocaleTimeString()}`}</p></div><Badge tone={!query.isError && expected ? 'green' : ''}>{query.isError ? 'Unavailable' : query.isPending ? 'Checking' : expected ? value : 'Mismatch'}</Badge></div>)}</section>
    <dl className="key-values"><div><dt>Target network</dt><dd>{chain.name} · {deployment.chainId}</dd></div><div><dt>Browser build</dt><dd><code className="address-wrap">{__BUILD_SHA__}</code></dd></div><div><dt>Backend build</dt><dd><code className="address-wrap">{health.isError ? 'Unavailable' : health.data?.version ?? 'Checking…'}</code></dd></div><div><dt>Jar adoption</dt><dd>{config.isError || !config.data ? 'Unverified' : config.data.data.adopted ? 'Adopted' : 'Revoked — new lots unavailable'}</dd></div><div><dt>New admissions</dt><dd>{config.isError || !config.data ? 'Unverified' : config.data.data.paused ? 'Paused' : 'Open'}</dd></div></dl>
    {config.data && <ReadBlock block={config.data.block} stale={config.isError} />}
    <div className="notice"><p>If Azure is starting or a chain check fails, wait and refresh. Previously confirmed transactions remain onchain. A pause stops new purchases and bids; permitted exits remain available.</p><div className="button-row"><button className="button secondary" disabled={health.isFetching || ready.isFetching || config.isFetching} onClick={() => { void health.refetch(); void ready.refetch(); void config.refetch(); }}>Refresh checks ↗</button><Link className="inline-link" href="/wallet/credits">My funds ↗</Link><Link className="inline-link" href="/lots">Lot lifecycle actions ↗</Link></div></div>
  </>;
}
