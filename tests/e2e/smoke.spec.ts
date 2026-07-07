import { expect, type Page, test } from '@playwright/test'

const statusResponse = {
  network: 'devnet',
  epoch: {
    id: 'epoch-32',
    status: 'current',
    first_ledger_index: 5_400_000,
    first_ledger_hash: 'FIRSTHASH000000000000000000000000000000000000000000000000000001',
    last_ledger_index: null,
    last_ledger_hash: null,
    started_at: '2026-07-02T00:00:00.000Z',
  },
  server: {
    endpoint: 'https://s.devnet.rippletest.net:51234/',
    version: '3.2.0',
    state: 'full',
    complete_ledgers: '5400000-5432109',
    latest_validated_ledger: 5_432_109,
    latest_validated_hash: 'LATESTHASH0000000000000000000000000000000000000000000000000001',
    latest_ledger_age_seconds: 3,
  },
  amendments: {
    lending_protocol: { enabled: true, supported: true },
    single_asset_vault: { enabled: true, supported: true },
  },
  collector: {
    status: 'healthy',
    last_processed_ledger: 5_432_107,
    last_processed_hash: 'PROCESSEDHASH000000000000000000000000000000000000000000000001',
    last_attempt_at: '2026-07-02T01:02:03.000Z',
    last_success_at: '2026-07-02T01:02:03.000Z',
    data_age_seconds: 4,
    consecutive_failures: 0,
    reset_reason: null,
    error: null,
  },
}

const overviewResponse = {
  network: 'devnet',
  epoch: { id: 'epoch-32', status: 'current' },
  snapshot: {
    id: 'snapshot-1',
    epoch_id: 'epoch-32',
    ledger_index: 5_432_100,
    ledger_hash: 'SNAPSHOTHASH000000000000000000000000000000000000000000000001',
    completed_at: '2026-07-02T01:01:00.000Z',
  },
  freshness: {
    collector_status: 'healthy',
    latest_validated_ledger: 5_432_109,
    last_processed_ledger: 5_432_107,
    last_success_at: '2026-07-02T01:02:03.000Z',
  },
  counts: {
    vaults: 12,
    loan_brokers: 4,
    loans: 31,
    current_objects: 47,
  },
  provenance: { counts: 'direct', freshness: 'direct' },
  unavailable: [],
}

const activityResponse = {
  network: 'devnet',
  data: [
    {
      transaction_hash: 'ABCDEF000000000000000000000000000000000000000000000000000001',
      epoch_id: 'epoch-32',
      ledger_index: 5_432_107,
      event_index: 0,
      close_time: 836_269_320,
      transaction_type: 'LoanPay',
      result_code: 'tesSUCCESS',
      payload_retained: false,
      source_json: null,
      metadata_json: null,
      created_at: '2026-07-02T01:02:03.000Z',
      provenance: 'indexed',
    },
  ],
  page: { limit: 6, next_cursor: null },
}

async function mockDashboardApi(
  page: Page,
  options: { snapshot?: boolean; activityFailure?: boolean } = {},
) {
  await page.route('**/api/status', async (route) => {
    await route.fulfill({ json: statusResponse })
  })

  await page.route('**/api/overview', async (route) => {
    if (options.snapshot === false) {
      await route.fulfill({
        json: {
          ...overviewResponse,
          snapshot: null,
          counts: { vaults: null, loan_brokers: null, loans: null, current_objects: null },
          provenance: { counts: 'unavailable', freshness: 'direct' },
          unavailable: ['active current-state snapshot has not been activated'],
        },
      })
      return
    }
    await route.fulfill({ json: overviewResponse })
  })

  await page.route('**/api/activity?limit=6', async (route) => {
    if (options.activityFailure) {
      await route.fulfill({ status: 500, json: { error: 'internal_error' } })
      return
    }
    await route.fulfill({ json: activityResponse })
  })
}

test('renders the approved observatory Overview and navigates to Network Status', async ({ page }) => {
  await mockDashboardApi(page)
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1, name: 'XRPL Lending Monitor' })).toBeVisible()
  await expect(page.locator('.sidebar')).toBeVisible()
  await expect(page.locator('.network-context').getByText('DEVNET', { exact: true })).toBeVisible()
  await expect(
    page.locator('.network-context').getByText('5,432,109', { exact: true }),
  ).toBeVisible()
  await expect(page.locator('.metrics-grid').getByText('12', { exact: true })).toBeVisible()
  await expect(page.getByText('LoanPay', { exact: true })).toBeVisible()
  await expect(page.getByText(/02 Jul 2026, 01:02:00 UTC/)).toBeVisible()
  await expect(page.locator('.activity-panel tbody a.identifier-link')).toHaveAttribute(
    'href',
    '/transactions/ABCDEF000000000000000000000000000000000000000000000000000001',
  )
  await expect(page.locator('body')).not.toContainText('USD')

  await page.locator('.sidebar').getByRole('link', { name: 'Network Status' }).click()
  await expect(page).toHaveURL(/\/network-status$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Network Status' })).toBeVisible()
  await expect(page.getByText('Complete ledgers')).toBeVisible()
  await expect(page.getByText('Single Asset Vault')).toBeVisible()
})

test('shows snapshot unavailability without substituting mock counts', async ({ page }) => {
  await mockDashboardApi(page, { snapshot: false })
  await page.goto('/')

  await expect(page.getByText('Current-state snapshot unavailable')).toBeVisible()
  await expect(page.getByText('active current-state snapshot has not been activated').first()).toBeVisible()
  await expect(page.locator('.metrics-grid').getByText('Unavailable', { exact: true }).first()).toBeVisible()
})

test('preserves successful panels when the activity API fails', async ({ page }) => {
  await mockDashboardApi(page, { activityFailure: true })
  await page.goto('/')

  await expect(page.getByText('Partial data')).toBeVisible()
  await expect(page.locator('.metrics-grid').getByText('12', { exact: true })).toBeVisible()
  await expect(page.getByText('/api/activity?limit=6 returned HTTP 500')).toBeVisible()
})

test('uses mobile navigation, toggles More, and closes it after navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockDashboardApi(page)
  await page.goto('/')

  const mobileNav = page.locator('.mobile-bottom-nav')
  const more = mobileNav.locator('details')
  const summary = more.locator('summary')
  const panel = page.locator('.mobile-more-panel')

  await expect(page.locator('.sidebar')).toBeHidden()
  await expect(page.locator('.mobile-appbar')).toBeVisible()
  await expect(mobileNav).toBeVisible()
  await expect(page.locator('.network-context').getByText('DEVNET', { exact: true })).toBeVisible()

  await summary.click()
  await expect(panel.getByText('Network Status', { exact: true })).toBeVisible()

  await summary.click()
  await expect(panel).toBeHidden()

  await summary.click()
  await panel.getByRole('link', { name: 'Network Status' }).click()
  await expect(page).toHaveURL(/\/network-status$/)
  await expect(more).not.toHaveAttribute('open', '')
  await expect(panel).toBeHidden()
})
