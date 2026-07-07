import { expect, type Page, test } from '@playwright/test'

const brokerId = `${'B'.repeat(63)}1`
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

const broker = {
  id: brokerId,
  vault_id: vaultId,
  owner: 'rBrokerOwner',
  account: 'rBrokerAccount',
  asset: { type: 'xrp', key: 'XRP', symbol: 'XRP', scale: 6 },
  sequence: 1,
  loan_sequence: 2,
  management_fee_rate: 250,
  owner_count: 1,
  debt_total: '5000000',
  debt_maximum: '10000000',
  cover_available: '600000',
  cover_rate_minimum: 10000,
  cover_rate_liquidation: 15000,
  flags: 0,
  previous_transaction_hash: 'F'.repeat(64),
  previous_ledger_index: 122,
  related_vault: {
    id: vaultId,
    asset: { type: 'xrp', key: 'XRP', symbol: 'XRP', scale: 6 },
    owner: 'rVaultOwner',
    account: 'rVaultAccount',
  },
  derived: {
    debt_utilization_bps: 5000,
    required_minimum_cover: '500000',
    cover_surplus: '100000',
    cover_ratio_bps: 12000,
    formulas: {
      debt_utilization: 'debt_utilization_bps = floor(DebtTotal / DebtMaximum * 10000)',
      required_cover: 'required_minimum_cover = DebtTotal * CoverRateMinimum / 100000',
      cover_surplus: 'cover_surplus = CoverAvailable - required_minimum_cover',
    },
    provenance: 'derived',
  },
  provenance: {
    object: 'direct', asset: 'direct', relationship: 'direct', derived: 'derived',
  },
  raw: { LedgerEntryType: 'LoanBroker', index: brokerId, DebtTotal: '5000000' },
}

async function mockBase(page: Page) {
  await page.route('**/api/status', (route) => route.fulfill({ json: statusResponse }))
  await page.route('**/api/overview', (route) => route.fulfill({
    json: {
      network: 'devnet', epoch: { id: 'epoch-1', status: 'current' }, snapshot,
      freshness: { collector_status: 'healthy', latest_validated_ledger: 125, last_processed_ledger: 123, last_success_at: '2026-07-02T00:00:11.000Z' },
      counts: { vaults: 1, loan_brokers: 1, loans: 0, current_objects: 2 },
      provenance: { counts: 'direct', freshness: 'direct' }, unavailable: [],
    },
  }))
  await page.route('**/api/activity?limit=6', (route) => route.fulfill({
    json: { network: 'devnet', data: [], page: { limit: 6, next_cursor: null } },
  }))
}

test('renders Broker debt and cover facts and opens detail', async ({ page }) => {
  await mockBase(page)
  await page.route('**/api/loan-brokers?*', (route) => route.fulfill({
    json: {
      network: 'devnet', kind: 'loan_brokers', epoch: { id: 'epoch-1', status: 'current' }, snapshot,
      data: [broker],
      page: { limit: 25, next_cursor: null, sort: 'id_asc', broker_shards_read: 2, relation_shards_read: 1, objects_examined: 1 },
      filters: { query: null }, availability: { state: 'available', reason: null },
      provenance: { collection: 'direct', asset_relationship: 'direct' },
    },
  }))
  await page.route(`**/api/loan-brokers/${brokerId}`, (route) => route.fulfill({
    json: {
      network: 'devnet', kind: 'loan_broker', epoch: { id: 'epoch-1', status: 'current' }, snapshot,
      data: broker, availability: { state: 'available', reason: null },
      provenance: { object: 'direct', asset_relationship: 'direct' },
    },
  }))

  await page.goto('/loan-brokers')
  await expect(page.getByRole('heading', { level: 1, name: 'Loan Brokers' })).toBeVisible()
  await expect(page.locator('.broker-table').getByText('5000000 XRP', { exact: true })).toBeVisible()
  await expect(page.locator('.broker-table').getByText('50.00%', { exact: true })).toBeVisible()
  await expect(page.locator('.broker-table').getByText('Surplus', { exact: true })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('USD')

  await page.locator('.broker-table').getByRole('link', { name: /B{8}/ }).click()
  await expect(page).toHaveURL(new RegExp(`/loan-brokers/${brokerId}$`))
  await expect(page.getByRole('heading', { level: 2, name: 'Debt and first-loss cover' })).toBeVisible()
  await expect(page.locator('.broker-summary-grid').getByText('Cover surplus', { exact: true })).toBeVisible()
  await expect(page.getByText('Loan book and Broker history not yet available', { exact: true })).toBeVisible()
  await expect(page.locator('.raw-data-panel')).toContainText('LoanBroker')
  await expect(page.getByRole('link', { name: 'Open Vault' })).toHaveAttribute('href', `/vaults/${vaultId}`)
})

test('keeps unavailable Broker state explicit and applies factual query parameters', async ({ page }) => {
  await mockBase(page)
  await page.route('**/api/loan-brokers?*', (route) => route.fulfill({
    json: {
      network: 'devnet', kind: 'loan_brokers', epoch: { id: 'epoch-1', status: 'current' }, snapshot: null,
      data: [], page: { limit: 25, next_cursor: null },
      availability: { state: 'unavailable', reason: 'active current-state snapshot has not been activated' },
      provenance: { collection: 'unavailable' },
    },
  }))

  await page.goto('/loan-brokers')
  await expect(page.getByText('Loan Broker collection unavailable')).toBeVisible()
  await expect(page.getByText('active current-state snapshot has not been activated')).toBeVisible()

  await page.getByLabel('Search').fill('rBrokerOwner')
  await page.getByLabel('Order').selectOption('id_desc')
  const request = page.waitForRequest((value) =>
    value.url().includes('/api/loan-brokers?') &&
    value.url().includes('q=rBrokerOwner') &&
    value.url().includes('sort=id_desc'),
  )
  await page.getByRole('button', { name: 'Apply' }).click()
  await request
})

test('exposes Loan Broker navigation on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockBase(page)
  await page.route('**/api/loan-brokers?*', (route) => route.fulfill({
    json: {
      network: 'devnet', kind: 'loan_brokers', epoch: { id: 'epoch-1', status: 'current' }, snapshot,
      data: [], page: { limit: 25, next_cursor: null, sort: 'id_asc', broker_shards_read: 1, relation_shards_read: 0, objects_examined: 0 },
      filters: { query: null }, availability: { state: 'available', reason: null },
      provenance: { collection: 'direct', asset_relationship: 'direct' },
    },
  }))

  await page.goto('/loan-brokers')
  await expect(page.locator('.sidebar')).toBeHidden()
  await page.locator('.mobile-bottom-nav').getByRole('button', { name: 'More' }).click()
  await expect(page.locator('.mobile-more-panel').getByRole('link', { name: 'Loan Brokers' })).toBeVisible()
  await expect(page.locator('.broker-filter-form')).toBeVisible()
})
