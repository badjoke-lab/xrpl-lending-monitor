import { expect, type Page, test } from '@playwright/test'

const transactionHash = 'A'.repeat(64)

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

async function mockApis(page: Page) {
  await page.route('**/api/status', (route) => route.fulfill({ json: statusResponse }))
  await page.route('**/api/overview', (route) => route.fulfill({
    json: {
      network: 'devnet', epoch: { id: 'epoch-1', status: 'current' }, snapshot: null,
      freshness: { collector_status: 'healthy', latest_validated_ledger: 125, last_processed_ledger: 123, last_success_at: '2026-07-02T00:00:11.000Z' },
      counts: { vaults: null, loan_brokers: null, loans: null, current_objects: null },
      provenance: { counts: 'unavailable', freshness: 'direct' }, unavailable: ['snapshot unavailable'],
    },
  }))
  await page.route('**/api/activity?limit=6', (route) => route.fulfill({
    json: { network: 'devnet', data: [], page: { limit: 6, next_cursor: null } },
  }))
  await page.route('**/api/activity?limit=100', (route) => route.fulfill({
    json: {
      network: 'devnet',
      data: [{
        transaction_hash: transactionHash, epoch_id: 'epoch-1', ledger_index: 123, event_index: 1,
        close_time: 836_000_000, transaction_type: 'LoanSet', result_code: 'tesSUCCESS',
        payload_retained: true, source_json: null, metadata_json: null,
        created_at: '2026-07-02T00:00:11.000Z', provenance: 'indexed',
      }],
      page: { limit: 100, next_cursor: null },
    },
  }))
}

test('renders the Activity route and transaction link', async ({ page }) => {
  await mockApis(page)
  await page.goto('/activity')

  await expect(page.getByRole('heading', { level: 1, name: 'Protocol Activity' })).toBeVisible()
  await expect(page.locator('.activity-card')).toHaveCount(1)
  await expect(page.locator('a.activity-hash')).toHaveAttribute('href', `/transactions/${transactionHash}`)
  await expect(page.getByRole('link', { name: 'CSV export' })).toHaveAttribute(
    'href',
    '/api/exports/activity?format=csv&limit=100',
  )
})

test('marks Activity active on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockApis(page)
  await page.goto('/activity')

  await expect(page.locator('.sidebar')).toBeHidden()
  await expect(page.locator('.mobile-bottom-nav a[href="/activity"]')).toHaveAttribute('aria-current', 'page')
})
