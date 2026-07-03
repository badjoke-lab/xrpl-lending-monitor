import { expect, type Page, test } from '@playwright/test'

const brokerId = `${'C'.repeat(63)}4`
const transactionHash = 'F'.repeat(64)

async function mockSharedState(page: Page) {
  await page.route('**/api/status', (route) => route.fulfill({
    json: {
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
    },
  }))
  await page.route('**/api/overview', (route) => route.fulfill({
    json: {
      network: 'devnet', epoch: { id: 'epoch-1', status: 'current' }, snapshot: null,
      freshness: { collector_status: 'healthy', latest_validated_ledger: 125, last_processed_ledger: 123, last_success_at: '2026-07-02T00:00:11.000Z' },
      counts: { vaults: null, loan_brokers: null, loans: null, current_objects: null },
      provenance: { counts: 'unavailable', freshness: 'direct' }, unavailable: ['current snapshot'],
    },
  }))
  await page.route('**/api/activity?limit=6', (route) => route.fulfill({
    json: { network: 'devnet', data: [], page: { limit: 6, next_cursor: null } },
  }))
}

function coverLossResponse() {
  return {
    network: 'devnet',
    kind: 'cover_debt_loss',
    data: [
      {
        epoch_id: 'epoch-1',
        subject_type: 'LoanBroker',
        subject_id: brokerId,
        transaction_hash: transactionHash,
        ledger_index: 122,
        transaction_index: 4,
        close_time: 831440100,
        metric_type: 'required_minimum_cover',
        asset_key: 'XRP',
        before_value: '10.00000',
        after_value: '18.00000',
        formula: 'required_minimum_cover = DebtTotal * CoverRateMinimum / 100000',
        source_fields_json: ['CoverAvailable', 'CoverRateMinimum', 'DebtTotal'],
        created_at: '2026-07-02T00:00:00.000Z',
        provenance: 'derived',
      },
      {
        epoch_id: 'epoch-1',
        subject_type: 'LoanBroker',
        subject_id: brokerId,
        transaction_hash: transactionHash,
        ledger_index: 122,
        transaction_index: 4,
        close_time: 831440100,
        metric_type: 'cover_available',
        asset_key: 'XRP',
        before_value: '80',
        after_value: '90',
        formula: null,
        source_fields_json: ['CoverAvailable'],
        created_at: '2026-07-02T00:00:00.000Z',
        provenance: 'indexed',
      },
    ],
    filters: { metric_type: null, subject_type: null, subject_id: null, asset_key: null },
    page: { limit: 100, next_cursor: null },
    provenance: { collection: 'indexed' },
    formulas: {
      required_minimum_cover: 'required_minimum_cover = DebtTotal * CoverRateMinimum / 100000',
      cover_surplus: 'cover_surplus = CoverAvailable - required_minimum_cover',
    },
  }
}

test('renders cover and loss audit without cross-asset aggregation', async ({ page }) => {
  await mockSharedState(page)
  await page.route('**/api/audit/cover-loss?*', (route) => route.fulfill({ json: coverLossResponse() }))

  await page.goto('/audit/cover-loss')
  await expect(page.getByRole('heading', { level: 1, name: 'Cover & Loss' })).toBeVisible()
  await expect(page.getByText('Unlike assets are never aggregated.')).toBeVisible()
  await expect(page.getByLabel('Cover and loss history').getByText('Required Minimum Cover')).toBeVisible()
  await expect(page.getByText('10.00000 XRP')).toBeVisible()
  await expect(page.getByText('18.00000 XRP')).toBeVisible()
  await expect(page.getByText('required_minimum_cover = DebtTotal * CoverRateMinimum / 100000')).toBeVisible()
  await expect(page.getByRole('link', { name: /F{8}/ }).first()).toHaveAttribute('href', `/transactions/${transactionHash}`)

  await page.getByLabel('Metric').selectOption('cover_available')
  await page.getByLabel('Subject type').selectOption('LoanBroker')
  await page.getByLabel('Subject ID').fill(brokerId)
  const request = page.waitForRequest((value) =>
    value.url().includes('/api/audit/cover-loss?') &&
    value.url().includes('metric_type=cover_available') &&
    value.url().includes('subject_type=LoanBroker') &&
    value.url().includes(`subject_id=${brokerId}`) &&
    value.url().includes('asset_key=XRP'),
  )
  await page.getByLabel('Asset key').fill('XRP')
  await page.getByRole('button', { name: 'Apply' }).click()
  await request
})

test('exposes cover and loss audit navigation on mobile without write controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockSharedState(page)
  await page.route('**/api/audit/cover-loss?*', (route) => route.fulfill({ json: coverLossResponse() }))

  await page.goto('/about')
  await page.locator('.mobile-bottom-nav details').click()
  await page.locator('.mobile-more-panel').getByRole('link', { name: 'Cover & Loss', exact: true }).click()
  await expect(page).toHaveURL(/\/audit\/cover-loss$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Cover & Loss' })).toBeVisible()
  const controlNames = await page.locator('button, a[href], input, select, textarea').evaluateAll((nodes) => (
    nodes.map((node) => `${node.textContent ?? ''} ${node.getAttribute('aria-label') ?? ''}`).join('\n')
  ))
  expect(controlNames).not.toMatch(/connect wallet|sign transaction|submit transaction|repay loan|make payment|usd total|risk score/i)
})
