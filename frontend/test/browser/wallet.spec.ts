import { test, expect, type Page } from '@playwright/test';
import { network, chainId, accounts, client, manifest, readSale, balance, installWallet, connect, selectWallet, transact, advanceTo, syncClock, refreshReference, saveEvidence, fundReceiptPayment } from './wallet-harness';

test.describe('real-chain browser wallet journeys', () => {
  test.skip(!network, 'Set WALLET_TEST_NETWORK=local or sepolia explicitly.');
  test.describe.configure({ mode: 'serial', timeout: 480000 });
  test.beforeAll(async () => { expect(await client.getChainId()).toBe(chainId); expect(await readSale('activeId')).toBe(0n); });
  test.afterAll(async ({ baseURL }) => { if (network) await saveEvidence(baseURL!); });
  async function open(page: Page, mode: 'direct' | 'auction', minutes = '2') {
    await page.goto('/operator'); await syncClock(page);
    await page.getByLabel('Configured asset').selectOption(mode === 'direct' ? manifest.addresses.directAsset : manifest.addresses.auctionAsset);
    await page.getByLabel(/^Quantity \(/).fill('1');
    await page.getByLabel('Expires in (minutes)').fill(minutes);
    if (mode === 'auction') { await page.getByLabel('Reserve (', { exact: false }).fill('1'); await page.getByLabel('Increment (', { exact: false }).fill('0.1'); }
    await page.getByRole('button', { name: mode === 'direct' ? /Review & open direct lot/ : /Review & open auction/ }).click();
    await expect(page).toHaveURL(/\/lots\/\d+$/, { timeout: 180000 });
    return BigInt(page.url().split('/').at(-1)!);
  }
  async function approveAndBid(page: Page, amount: string) {
    await page.getByLabel('Your bid (', { exact: false }).fill(amount);
    await transact(page, /1\. Approve exact/);
    await transact(page, /2\. Place funded bid/);
  }
  test('connection, account changes, wrong chain and rejected signatures are safe', async ({ page }) => {
    const wallet = await installWallet(page, 'buyer-a'); await page.goto('/operator'); await connect(page);
    await expect(page.getByText('Read-only for this wallet.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Review & open/ })).toHaveCount(0);
    await selectWallet(page, 'operator'); await expect(page.getByRole('button', { name: 'Pause admissions' })).toBeVisible();
    await page.evaluate(() => (window as any).__testWallet.chain(1));
    await expect(page.locator('header .wallet-button')).toHaveText('Wrong network');
    await expect(page.getByRole('button', { name: 'Pause admissions' })).toBeDisabled();
    await page.locator('header .wallet-button').click();
    await page.getByRole('button', { name: /Switch to/ }).click();
    await expect(page.locator('header .wallet-button')).toContainText(accounts.operator!.slice(0, 6));
    await page.getByRole('button', { name: 'Close wallet panel' }).click();
    await page.route('**/v1/transactions/prepare', async route => {
      const response = await route.fetch();
      await page.evaluate(() => (window as any).__testWallet.select('buyer-a'));
      await route.fulfill({ response });
    });
    await page.getByRole('button', { name: 'Pause admissions' }).click();
    await expect(page.getByText(/Wallet or network changed/)).toBeVisible();
    expect(wallet.submitted).toHaveLength(0);
    await page.unroute('**/v1/transactions/prepare');
    await selectWallet(page, 'operator');
    await page.evaluate(() => (window as any).__testWallet.reject());
    await page.getByRole('button', { name: 'Pause admissions' }).click();
    await expect(page.getByText(/You declined the wallet request/)).toBeVisible();
    expect(await readSale('paused')).toBe(false); expect(wallet.submitted).toHaveLength(0);
    await page.locator('header .wallet-button').click(); await page.getByRole('button', { name: 'Disconnect wallet' }).click();
    await expect(page.locator('header .wallet-button')).toHaveText('Connect wallet');
  });
  test('operator opens a direct lot; buyer approves and buys; exact transfers agree', async ({ page }) => {
    await refreshReference(); await installWallet(page); await page.goto('/operator'); await connect(page);
    const treasuryBefore = await balance(manifest.addresses.payout, accounts.treasury!);
    const buyerBefore = await balance(manifest.addresses.directAsset, accounts['buyer-a']!);
    let holdRefresh = false;
    let releaseRefresh!: () => void;
    const barrier = new Promise<void>(resolve => { releaseRefresh = resolve; });
    await page.route('**/v1/config', async route => { if (holdRefresh) await barrier; await route.continue(); });
    await page.route('**/v1/transactions/prepare', async route => { if (route.request().postDataJSON()?.action === 'openDirect') holdRefresh = true; await route.continue(); });
    let id: bigint;
    try {
      id = await open(page, 'direct', '30');
      await expect(page.getByText('Transaction confirmed.', { exact: true })).toBeVisible();
      await expect(page.getByText('Refreshing verified balances…', { exact: true })).toBeVisible();
    } finally {
      holdRefresh = false; releaseRefresh();
      await page.unroute('**/v1/config'); await page.unroute('**/v1/transactions/prepare');
    }
    await selectWallet(page, 'buyer-a');
    await expect(page.getByText('Current quote', { exact: true })).toBeVisible();
    const [payment] = await readSale('quoteDirect', [id]) as [bigint, string];
    await transact(page, /1\. Approve exact/);
    await transact(page, /2\. Buy entire lot/);
    expect(await readSale('activeId')).toBe(0n);
    expect(await balance(manifest.addresses.payout, accounts.treasury!)).toBe(treasuryBefore + payment);
    expect(await balance(manifest.addresses.directAsset, accounts['buyer-a']!)).toBe(buyerBefore + 10n ** 18n);
    await expect(page.getByRole('heading', { name: 'Sold', exact: true })).toBeVisible();
  });
  test('funded bids, self-outbid, competing outbid, refund and expiry settlement work', async ({ page }) => {
    await installWallet(page); await page.goto('/operator'); await connect(page);
    const id = await open(page, 'auction', network === 'local' ? '2' : '3');
    await selectWallet(page, 'buyer-a'); await approveAndBid(page, '1');
    await approveAndBid(page, '1.1');
    expect(await readSale('credits', [accounts['buyer-a']])).toBe(1000000n);
    await selectWallet(page, 'buyer-b'); await approveAndBid(page, '1.2');
    expect(await readSale('credits', [accounts['buyer-a']])).toBe(2100000n);
    await selectWallet(page, 'buyer-a'); await page.goto('/wallet/credits');
    await transact(page, /Withdraw my credit/);
    expect(await readSale('credits', [accounts['buyer-a']])).toBe(0n);
    const lot = await readSale('getLot', [id]) as { expiry: bigint };
    const treasuryBefore = await balance(manifest.addresses.payout, accounts.treasury!);
    const buyerBefore = await balance(manifest.addresses.auctionAsset, accounts['buyer-b']!);
    await advanceTo(lot.expiry + 1n, page); await page.goto(`/lots/${id}`);
    await transact(page, /Finalize auction/);
    expect(await balance(manifest.addresses.payout, accounts.treasury!)).toBe(treasuryBefore + 1200000n);
    expect(await balance(manifest.addresses.auctionAsset, accounts['buyer-b']!)).toBe(buyerBefore + 10n ** 18n);
    expect(await readSale('activeId')).toBe(0n);
  });
  test('no-bid expiry returns only the committed lot to the original jar', async ({ page }) => {
    await installWallet(page); await page.goto('/operator'); await connect(page);
    const jarBefore = await balance(manifest.addresses.auctionAsset, manifest.addresses.jar);
    const id = await open(page, 'auction', '1');
    const lot = await readSale('getLot', [id]) as { expiry: bigint };
    await advanceTo(lot.expiry + 1n, page); await page.goto(`/lots/${id}`);
    await transact(page, /Finalize auction/); await transact(page, /Recover exact inventory/);
    expect(await balance(manifest.addresses.auctionAsset, manifest.addresses.jar)).toBe(jarBefore);
    expect(await readSale('activeId')).toBe(0n);
  });
  test('a paid receipt generates jar fees which sell through to the treasury', async ({ page }) => {
    await fundReceiptPayment();
    const feeAbi = [{ type: 'function', name: 'totalFees', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const;
    const source = manifest.addresses.feeSource;
    const asset = manifest.feeSource.asset;
    const price = BigInt(manifest.feeSource.price);
    const fee = price * BigInt(manifest.feeSource.feeBps) / 10000n;
    const jarBefore = await balance(asset, manifest.addresses.jar);
    const merchantBefore = await balance(asset, manifest.feeSource.merchant);
    const payerBefore = await balance(asset, accounts['buyer-a']!);
    const feesBefore = await client.readContract({ address: source, abi: feeAbi, functionName: 'totalFees' });
    await installWallet(page, 'buyer-a'); await page.goto('/fees'); await connect(page);
    await page.getByLabel('Receipt reference').fill(`acceptance-${chainId}-${await client.getBlockNumber()}`);
    await transact(page, /1\. Approve exact service payment/);
    await transact(page, /2\. Pay & register receipt/);
    await expect(page.getByText(/is registered for this reference/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Pay & register/ })).toHaveCount(0);
    expect(await balance(asset, manifest.addresses.jar)).toBe(jarBefore + fee);
    expect(await balance(asset, manifest.feeSource.merchant)).toBe(merchantBefore + price - fee);
    expect(await balance(asset, accounts['buyer-a']!)).toBe(payerBefore - price);
    expect(await balance(asset, source)).toBe(0n);
    expect(await client.readContract({ address: source, abi: feeAbi, functionName: 'totalFees' })).toBe(feesBefore + fee);
    await selectWallet(page, 'operator'); const id = await open(page, 'auction', network === 'local' ? '1' : '3');
    expect(await balance(asset, manifest.addresses.jar)).toBe(jarBefore);
    await selectWallet(page, 'buyer-b'); await approveAndBid(page, '1');
    const lot = await readSale('getLot', [id]) as { expiry: bigint };
    const treasuryBefore = await balance(manifest.addresses.payout, accounts.treasury!);
    const buyerBefore = await balance(asset, accounts['buyer-b']!);
    await advanceTo(lot.expiry + 1n, page); await page.goto(`/lots/${id}`);
    await transact(page, /Finalize auction/);
    expect(await balance(manifest.addresses.payout, accounts.treasury!)).toBe(treasuryBefore + 1000000n);
    expect(await balance(asset, accounts['buyer-b']!)).toBe(buyerBefore + fee);
    expect(await balance(asset, manifest.addresses.jar)).toBe(jarBefore);
    expect(await readSale('activeId')).toBe(0n);
  });
  test('a stale direct reference shows refusal without auction fallback', async ({ page }) => {
    test.skip(network !== 'local', 'Staleness time travel is isolated to Anvil; public-chain refusal is checked separately.');
    await refreshReference(); await installWallet(page); await page.goto('/operator'); await connect(page);
    const id = await open(page, 'direct', '60');
    const now = (await client.getBlock()).timestamp;
    await advanceTo(now + 601n, page); await page.goto(`/lots/${id}`);
    await expect(page.getByText('Quote unavailable', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /2\. Buy entire lot/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Place funded bid/ })).toHaveCount(0);
    const lot = await readSale('getLot', [id]) as { mode: number; state: number };
    expect(lot.mode).toBe(2); expect(lot.state).toBe(1);
    await page.getByText('Operator cancellation', { exact: true }).click();
    await transact(page, /Cancel this lot/); await transact(page, /Recover exact inventory/);
    expect(await readSale('activeId')).toBe(0n);
  });
});
