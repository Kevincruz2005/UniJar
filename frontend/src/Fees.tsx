import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useConnection } from 'wagmi';
import { keccak256, stringToHex } from 'viem';
import { api, deployment } from './api';
import { amount, validateFeeSource, type Envelope, type FeeSource } from './domain';
import { AddressLink, Badge, ErrorState, Loading, PageHeading, ReadBlock } from './components';
import { Link, PageTitle } from './navigation';
import { chain, WalletButton, useTransaction } from './wallet';

export function Fees() {
  const { address, chainId } = useConnection(); const { run, busy } = useTransaction();
  const [reference, setReference] = useState('');
  const currentHash = reference.trim() ? keccak256(stringToHex(reference.trim())) : undefined;
  const [referenceHash, setReferenceHash] = useState(currentHash);
  useEffect(() => { const timer = setTimeout(() => setReferenceHash(currentHash), 350); return () => clearTimeout(timer); }, [currentHash]);
  const fee = useQuery({ queryKey: ['fee-source'], queryFn: async ({ signal }) => { const r = await api<Envelope<FeeSource>>('/v1/fee-source', undefined, signal); validateFeeSource(r.data, deployment); return r; }, retry: 1, refetchInterval: 30000 });
  const account = useQuery({ queryKey: ['fee-account', address, referenceHash], enabled: !!address && !!fee.data, queryFn: ({ signal }) => api<Envelope<{ balance: string; allowance: string; receiptId: string }>>(`/v1/fee-source/accounts/${address}${referenceHash ? `?referenceHash=${referenceHash}` : ''}`, undefined, signal), retry: 1, refetchInterval: 15000 });
  const data = fee.data?.data;
  const known = account.data?.data;
  const allowed = referenceHash === currentHash && !busy && chainId === chain.id && !fee.isError && !account.isError && !!known && !!data;
  const approved = !!known && !!data && BigInt(known.allowance) >= BigInt(data.price);
  const funded = !!known && !!data && BigInt(known.balance) >= BigInt(data.price);
  const paid = referenceHash === currentHash && !!referenceHash && !!known && known.receiptId !== '0';
  return <><PageTitle title="Generate fees" /><PageHeading kicker="FROM PAYMENT TO JAR" title="Give fees a starting point." description="Register a reference receipt onchain. Its service fee goes straight to TokenJar." aside={<Badge>Test tokens · {chain.name}</Badge>} />
    {fee.isPending ? <Loading /> : fee.isError || !data ? <ErrorState error={fee.error} retry={() => void fee.refetch()} /> : <>
      <div className="operator-grid"><section className="operator-form"><span className="eyebrow">PAID RECEIPT</span><h2>A record, with a fee.</h2><p className="muted">Your reference is saved as a hash with your address and the block timestamp. Each wallet can register a given reference once.</p>
        <label className="field">Receipt reference<input maxLength={160} value={reference} disabled={busy} placeholder="e.g. order-1042" onChange={e => setReference(e.target.value)} /></label>
        <dl className="key-values"><div><dt>Total payment</dt><dd>{amount(data.price, data.decimals)} {data.symbol}</dd></div><div><dt>Service fee → jar</dt><dd>{amount(data.feePerReceipt, data.decimals)} {data.symbol} · {data.feeBps / 100}%</dd></div><div><dt>Merchant receives</dt><dd>{amount(BigInt(data.price) - BigInt(data.feePerReceipt), data.decimals)} {data.symbol}</dd></div></dl>
        {!address ? <WalletButton /> : <><p className="small muted">Your balance: {known && !account.isError ? `${amount(known.balance, data.decimals)} ${data.symbol}` : 'Unavailable'}</p>{chainId !== chain.id && <div className="notice">Switch to {chain.name} using the wallet menu.</div>}{account.isError && <ErrorState error={account.error} retry={() => void account.refetch()} />}{paid ? <div className="notice" role="status">Receipt #{known!.receiptId} is registered for this reference. It cannot be charged again.</div> : <><button className="button secondary full-width" disabled={!allowed || !funded || approved || !referenceHash} onClick={() => void run({ action: 'approveFeeAsset', params: { amount: data.price } })}>1. Approve exact service payment ↗</button><button className="button primary full-width" disabled={!allowed || !funded || !approved || !referenceHash} onClick={() => void run({ action: 'payForReceipt', params: { referenceHash } })}>2. Pay & register receipt ↗</button>{known && !funded && <p className="small muted">You need {amount(data.price, data.decimals)} {data.symbol} and {chain.name} ETH for gas. These are controlled test tokens; no public mint is enabled.</p>}</>}</>}
        <p className="small muted">This is a controlled testnet service. Its fixed price and fee are demonstration terms, not a market quote or evidence of customer demand.</p>
      </section><section className="operator-policy"><span className="eyebrow">FOLLOW THE PAYMENT</span><h2>Collected. Then converted.</h2><ol><li>Pay the receipt service. It sends the fee directly into the original TokenJar.</li><li>The operator commits an exact quantity to a UniJar auction.</li><li>A funded buyer receives the lot. The treasury receives the winning payout.</li></ol><dl className="key-values"><div><dt>Receipts registered</dt><dd>{(BigInt(data.nextReceiptId) - 1n).toString()}</dd></div><div><dt>Fees collected, lifetime</dt><dd>{amount(data.totalFees, data.decimals)} {data.symbol}</dd></div><div><dt>Receipt service</dt><dd><AddressLink value={data.service} /></dd></div><div><dt>Fee asset</dt><dd><AddressLink value={data.asset} /></dd></div><div><dt>TokenJar</dt><dd><AddressLink value={data.jar} /></dd></div><div><dt>Merchant</dt><dd><AddressLink value={data.merchant} /></dd></div></dl><p className="small muted">Lifetime fees measure collection, not the jar’s current balance. Sale proceeds are paid in the configured payout token.</p><Link className="button secondary" href="/inventory">See collected inventory ↗</Link><Link className="inline-link" href="/lots">Browse sales ↗</Link></section></div><ReadBlock block={fee.data!.block} />
    </>}
  </>;
}
