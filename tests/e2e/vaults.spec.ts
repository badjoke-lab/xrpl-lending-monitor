import { expect, type Page, test } from '@playwright/test'

const vaultId = `${'A'.repeat(63)}1`

const statusResponse = {
  network: 'devnet',
  epoch: {
    id: 'epoch-1', status: 'current', first_ledger_index: 100, first_ledger_hash: 'FIRST',
    last_ledger_index: null, last_ledger_hash: null, started_at: '2026-07-02T00:00:00.000Z',
  },
  server: {
    endpoint: 'https://s.devnet.rippletest.net:51234/', version: '3.2.0', state: 'full',
    complete_ledgers: '100-125', latest_validated_ledger: 125, latest_validated_hash: 'LATEST',
    latest_ledger_age_seconds: 3,
  },
  amendments: {
    lending_protocol: { enabled: true, supported: true },
    single_asset_vault: { enabled: true, supported: true },
  },
  collector: {
    status: 'healthy', last_processed_ledger: 123, last_processed_hash: 'PROCESSED',
    last_attempt_at: '2026-07-02T00:00:10.000Z', last_success_at: '2026-07-02T00:00:11.000Z',
    data_age_seconds: 4, consecutive_failures: 0, reset_reason: null, error: null,
  },
}

const snapshot = {
  id: 'snapshot-1', epoch_id: 'epoch-1', ledger_index: 123,
  ledger_hash: 'SNAPSHOT', completed_at: '2026-07-02T00:00:20.000Z',
}

const vault = {
  id: vaultId,
  owner: 'rOwner',
  account: 'rVaultAccount',
  asset: { type: 'xrp', key: 'XRP', symbol: 'XRP', scale: 6 },
  assets_total: '10000000',
  assets_available: '7500000',
  assets_maximum: '20000000',
  loss_unrealized: '0',
  share_mpt_id: 'B'.repeat(48),
  domain_id: null,
  withdrawal_policy: 0,
  scale: 6,
  flags: 0,
  previous_transaction_hash: 'F'.repeat(64),
  previous_ledger_index: 120,
  derived: {
    used_assets: '2500000', utilization_bps: 2500,
    formula: 'used_assets = AssetsTotal - AssetsAvailable; utilization_bps = floor(used_assets / AssetsTotal * 10000)',
    provenance: 'derived',
  },
  provenance: { object: 'direct', derived: 'derived' },
  raw: { LedgerEntryType: 'Vault', index: vaultId, AssetsTotal: '10000000' },
}

async function mockBase(page: Page) {
  await page.route('**/api/status', (route) => route.fulfill({ json: statusResponse }))
  await page.route('**/api/overview', (route) => route.fulfill({
    json: {
      network: 'devnet', epoch: { id: 'epoch-1', status: 'current' }, snapshot,
      freshness: { collector_status: 'healthy', latest_validated_ledger: 125, last_processed_ledger: 123, last_success_at: '2026-07-02T00:00:11.000Z' },
      counts: { vaults: 1, loan_brokers: 0, loans: 0, current_objects: 1 },
      provenance: { counts: 'direct', freshness: 'direct' }, unavailable: [],
    },
  }))
  await page.route('**/api/activity?limit=6', (route) => route.fulfill({ json: { network: 'devnet', data: [], page: { limit: 6, next_cursor: null } } }))
}

test('renders current Vaults and opens verified detail', async ({ page }) => {
  await mockBase(page)
  await page.route('**/api/vaults?*', (route) => route.fulfill({
    json: {
      network: 'devnet', kind: 'vaults', epoch: { id: 'epoch-1', status: 'current' }, snapshot,
      data: [vault], page: { limit: 25, next_cursor: null, sort: 'id_asc', shards_read: 1, objects_examined: 1 },
      filters: { query: null, has_loss: null }, availability: { state: 'available', reason: null },
      provenance: { collection: 'direct' },
    },
  }))
  await page.route(`**/api/vaults/${vaultId}`, (route) => route.fulfill({
    json: {
      network: 'devnet', kind: 'vault', epoch: { id: 'epoch-1', status: 'current' }, snapshot,
      data: vault, availability: { state: 'available', reason: null }, provenance: { object: 'direct' },
    },
  }))

  await page.goto('/vaults')
  await expect(page.getByRole('heading', { level: 1, name: 'Vaults' })).toBeVisible()
  await expect(page.getByText('25.00%', { exact: true })).toBeVisible()
  await expect(page.getByText('10000000 XRP', { exact: true })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('USD')

  await page.getByRole('link', { name: /A{8}/ }).click()
  await expect(page).toHaveURL(new RegExp(`/vaults/${vaultId}$`))
  await expect(page.getByRole('heading', { level: 1 })).toContainText('…')
  await expect(page.getByText('Raw decoded object')).toBeVisible()
  await expect(page.locator('.raw-data-panel')).toContainText('LedgerEntryType')
  await expect(page.getByText('Relationship panels not yet available')).toBeVisible()
})

test('applies factual filters and keeps unavailable state explicit', async ({ page }) => {
  await mockBase(page)
  await page.route('**/api/vaults?*', (route) => route.fulfill({
    json: {
      network: 'devnet', kind: 'vaults', epoch: { id: 'epoch-1', status: 'current' }, snapshot: null,
      data: [], page: { limit: 25, next_cursor: null },
      availability: { state: 'unavailable', reason: 'active current-state snapshot has not been activated' },
      provenance: { collection: 'unavailable' },
    },
  }))

  await page.goto('/vaults')
  await expect(page.getByText('Vault collection unavailable')).toBeVisible()
  await expect(page.getByText('active current-state snapshot has not been activated')).toBeVisible()
  await page.getByLabel('Search').fill('rOwner')
  await page.getByLabel('Loss').selectOption('true')
  await page.getByLabel('Order').selectOption('id_desc')
  const request = page.waitForRequest((value) => value.url().includes('/api/vaults?') && value.url().includes('has_loss=true'))
  await page.getByRole('button', { name: 'Apply' }).click()
  await request
})

test('keeps Vault navigation available on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockBase(page)
  await page.route('**/api/vaults?*', (route) => route.fulfill({
    json: {
      network: 'devnet', kind: 'vaults', epoch: { id: 'epoch-1', status: 'current' }, snapshot,
      data: [], page: { limit: 25, next_cursor: null, sort: 'id_asc', shards_read: 1, objects_examined: 0 },
      filters: { query: null, has_loss: null }, availability: { state: 'available', reason: null },
      provenance: { collection: 'direct' },
    },
  }))

  await page.goto('/vaults')
  await expect(page.locator('.sidebar')).toBeHidden()
  await page.locator('.mobile-bottom-nav').getByRole('button', { name: 'More' }).click()
  await expect(page.locator('.mobile-more-panel').getByRole('link', { name: 'Vaults' })).toBeVisible()
  await expect(page.locator('.vault-filter-form')).toBeVisible()
})
