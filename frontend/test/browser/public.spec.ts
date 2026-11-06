import { test, expect } from '@playwright/test';

test('landing, navigation and docs work without a connected wallet', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Make collected/ })).toBeVisible();
  const wallet = page.locator('header').getByRole('button', { name: 'Connect wallet' });
  await expect(wallet).toBeVisible();
  await page.getByRole('link', { name: 'Read the docs' }).click();
  await expect(page).toHaveURL(/\/docs$/);
  await expect(page.getByRole('heading', { name: /A clear path/ })).toBeVisible();
  await page.getByRole('link', { name: 'Buying a lot', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Buying an exact lot.' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Buying an exact lot.' })).toBeVisible();
  await page.goBack();
  await expect(wallet).toBeVisible();
  expect(errors).toEqual([]);
});
test('inventory is readable with real held assets and no connection requirement', async ({ page }) => {
  await page.goto('/inventory');
  await expect(page.getByRole('heading', { name: 'Every token, accounted for.' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Held for review', exact: true })).toBeVisible({ timeout: 40000 });
  await expect(page.getByRole('cell', { name: 'Direct purchase', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Auction', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Buy|Bid/ })).toHaveCount(0);
});
test('funds and operator pages explain disconnected and unauthorized access', async ({ page }) => {
  await page.goto('/wallet/credits'); await expect(page.getByRole('heading', { name: 'See what’s yours.' })).toBeVisible();
  await page.goto('/operator'); await expect(page.getByText('Connect the operator wallet to continue.')).toBeVisible({ timeout: 40000 });
  await expect(page.getByRole('button', { name: /Review & open/ })).toHaveCount(0);
});
test('mobile navigation keeps the wallet visible and prevents horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/', '/inventory', '/wallet/credits', '/docs', '/docs/api']) {
    await page.goto(path); await expect(page.locator('header').getByRole('button', { name: 'Connect wallet' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Lots', exact: true }).click();
  await expect(page).toHaveURL(/\/lots$/);
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
});
test('wallet dialog is keyboard dismissible and unknown routes have a recovery link', async ({ page }) => {
  await page.goto('/'); await page.locator('header').getByRole('button', { name: 'Connect wallet' }).click();
  await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.goto('/not-a-page'); await expect(page.getByRole('link', { name: 'Back to home' })).toBeVisible();
});
test('an inventory outage shows an error rather than fabricated zero balances', async ({ page }) => {
  await page.route('**/v1/inventory', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'RPC_UNAVAILABLE' }) }));
  await page.goto('/inventory');
  await expect(page.getByText('Unable to load verified data.', { exact: true })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('status distinguishes process liveness from failed chain readiness', async ({ page }) => {
  await page.route('**/healthz', route => route.fulfill({ json: { status: 'ok', version: 'backend-test-build', chainId: 11155111 } }));
  await page.route('**/readyz', route => route.fulfill({ status: 503, json: { error: 'CODE_MISMATCH' } }));
  await page.route('**/v1/config', route => route.fulfill({ status: 503, json: { error: 'RPC_UNAVAILABLE' } }));
  await page.goto('/status');
  await expect(page.getByRole('heading', { name: 'Know what’s available.' })).toBeVisible();
  const checks = page.getByRole('region', { name: 'Service checks' });
  await expect(checks.getByText('Reachable', { exact: true })).toBeVisible();
  await expect(checks.getByText('Unavailable', { exact: true })).toHaveCount(2);
  await expect(checks.getByText('Verified', { exact: true })).toHaveCount(0);
  await expect(page.getByText('backend-test-build', { exact: true })).toBeVisible();
  await expect(page.locator('main').getByRole('link', { name: 'My funds' })).toBeVisible();
  await expect(page.locator('main').getByRole('link', { name: 'Lot lifecycle actions' })).toBeVisible();
});
