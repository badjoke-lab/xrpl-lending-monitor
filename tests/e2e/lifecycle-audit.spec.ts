import { expect, type Page, test } from '@playwright/test'

const loanId = `${'C'.repeat(63)}1`
const transactionHash = 'E'.repeat(64)

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

function lifecycleResponse() {
  return {
    network: 'devnet',
    kind: 'loan_lifecycle',
    data: [
      {
        loan_id: loanId,
        epoch_id: 'epoch-1',
        transaction_hash: transactionHash,
        ledger_index: 121,
        transaction_index: 2,
        close_time: 831440100,
        event_type: 'payment',
        transaction_type: 'LoanPay',
        result_code: 'tesSUCCESS',
        status_before: 'active',
        status_after: 'active',
        principal_before: '11000',
        principal_after: '10000',
        total_value_before: '11500',
        total_value_after: '10500',
        payment_remaining_before: 2,
        payment_remaining_after: 1,
        details_json: { payment: '1000' },
        created_at: '2026-07-02T00:00:00.000Z',
        provenance: 'indexed',
      },
    ],
    filters: { event_type: null, loan_id: null },
    page: { limit: 25, next_cursor: null },
    provenance: { collection: 'indexed' },
  }
}

test('renders the protocol-wide lifecycle explorer with indexed event evidence', async ({ page }) => {
  await mockSharedState(page)
  await page.route('**/api/audit/lifecycle?*', (route) => route.fulfill({ json: lifecycleResponse() }))

  const initialRequest = page.waitForRequest((value) =>
    value.url().includes('/api/audit/lifecycle?') && value.url().includes('limit=25'),
  )
  await page.goto('/audit/lifecycle')
  await initialRequest
  await expect(page.getByRole('heading', { level: 1, name: 'Loan Lifecycle' })).toBeVisible()
  await expect(page.getByText('Events are not inferred when source evidence is unavailable.')).toBeVisible()
  await expect(page.getByText('LoanPay')).toBeVisible()
  const principalDelta = page.locator('.lifecycle-delta-row').filter({ hasText: 'Principal' })
  await expect(principalDelta.getByText('11000', { exact: true })).toBeVisible()
  await expect(principalDelta.getByText('10000', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /C{8}/ })).toHaveAttribute('href', `/loans/${loanId}`)
  await expect(page.getByRole('link', { name: /E{8}/ })).toHaveAttribute('href', `/transactions/${transactionHash}`)

  await page.getByLabel('Event type').selectOption('payment')
  const request = page.waitForRequest((value) =>
    value.url().includes('/api/audit/lifecycle?') &&
    value.url().includes('limit=25') &&
    value.url().includes('event_type=payment') &&
    value.url().includes(`loan_id=${loanId}`),
  )
  await page.getByLabel('Loan ID').fill(loanId)
  await page.getByRole('button', { name: 'Apply' }).click()
  await request
})

test('exposes lifecycle audit navigation on mobile without write controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockSharedState(page)
  await page.route('**/api/audit/lifecycle?*', (route) => route.fulfill({ json: lifecycleResponse() }))

  await page.goto('/about')
  await page.locator('.mobile-bottom-nav').getByRole('button', { name: 'More' }).click()
  await page.locator('.mobile-more-panel').getByRole('link', { name: 'Lifecycle', exact: true }).click()
  await expect(page).toHaveURL(/\/audit\/lifecycle$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Loan Lifecycle' })).toBeVisible()
  const controlNames = await page.locator('button, a[href], input, select, textarea').evaluateAll((nodes) => (
    nodes.map((node) => `${node.textContent ?? ''} ${node.getAttribute('aria-label') ?? ''}`).join('\n')
  ))
  expect(controlNames).not.toMatch(/connect wallet|sign transaction|submit transaction|repay loan|make payment/i)
})
