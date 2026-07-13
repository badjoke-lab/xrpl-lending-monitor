import { expect, type Page, test } from '@playwright/test'

const loanId = `${'B'.repeat(63)}2`
const transactionHash = 'D'.repeat(64)

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

function archiveRecord() {
  return {
    epoch_id: 'epoch-1',
    object_type: 'Loan',
    object_id: loanId,
    deletion_transaction_hash: transactionHash,
    deletion_ledger_index: 125,
    deletion_transaction_index: 3,
    deletion_close_time: 831440100,
    deletion_reason: 'loan_delete',
    final_state_json: { LedgerEntryType: 'Loan', LoanID: loanId, PrincipalOutstanding: '0' },
    relationships: {
      vault_id: `${'A'.repeat(63)}1`,
      loan_broker_id: `${'C'.repeat(63)}3`,
      loan_id: loanId,
      owner: null,
      account: null,
      borrower: 'rBorrowerArchive',
      asset_key: 'XRP',
    },
    archived_at: '2026-07-02T00:00:00.000Z',
    provenance: 'indexed',
  }
}

function archivedListResponse() {
  return {
    network: 'devnet',
    kind: 'archived_objects',
    data: [archiveRecord()],
    filters: { object_type: null, query: null },
    page: { limit: 25, next_cursor: null },
    provenance: { collection: 'indexed' },
  }
}

function archivedDetailResponse() {
  return {
    network: 'devnet',
    kind: 'archived_object',
    object_type: 'Loan',
    object_id: loanId,
    data: archiveRecord(),
    availability: { state: 'available', reason: null },
    provenance: { object: 'indexed' },
  }
}

test('renders archived object explorer and filters bounded archive evidence', async ({ page }) => {
  await mockSharedState(page)
  await page.route('**/api/audit/archived?*', (route) => route.fulfill({ json: archivedListResponse() }))
  await page.route(`**/api/audit/archived/Loan/${loanId}`, (route) => route.fulfill({ json: archivedDetailResponse() }))

  const initialRequest = page.waitForRequest((value) =>
    value.url().includes('/api/audit/archived?') && value.url().includes('limit=25'),
  )
  await page.goto('/audit/archived')
  await initialRequest
  await expect(page.getByRole('heading', { level: 1, name: 'Archived Objects' })).toBeVisible()
  await expect(page.getByText('Archived records are not current objects.')).toBeVisible()
  await expect(page.getByText('Loan Delete')).toBeVisible()
  await expect(page.getByText('latest bounded 25-record window')).toBeVisible()
  await expect(page.getByRole('link', { name: /B{8}/ })).toHaveAttribute('href', `/audit/archived/Loan/${loanId}`)

  await page.getByLabel('Object type').selectOption('Loan')
  const request = page.waitForRequest((value) =>
    value.url().includes('/api/audit/archived?') &&
    value.url().includes('limit=25') &&
    value.url().includes('object_type=Loan') &&
    value.url().includes(`q=${loanId}`),
  )
  await page.getByLabel('Exact identifier').fill(loanId)
  await page.getByRole('button', { name: 'Apply' }).click()
  await request

  await page.getByRole('link', { name: /B{8}/ }).click()
  await expect(page).toHaveURL(new RegExp(`/audit/archived/Loan/${loanId}$`))
  await expect(page.getByRole('heading', { level: 1, name: /Loan/ })).toBeVisible()
  await expect(page.getByText('Current existence is not implied.')).toBeVisible()
})

test('renders archived detail with deletion source, final state, and no write controls', async ({ page }) => {
  await mockSharedState(page)
  await page.route(`**/api/audit/archived/Loan/${loanId}`, (route) => route.fulfill({ json: archivedDetailResponse() }))

  await page.goto(`/audit/archived/Loan/${loanId}`)
  await expect(page.getByRole('heading', { level: 1, name: /Loan/ })).toBeVisible()
  await expect(page.getByText('Loan Delete')).toBeVisible()
  await expect(page.getByRole('link', { name: /D{8}/ })).toHaveAttribute('href', `/transactions/${transactionHash}`)
  await expect(page.getByText('rBorrowerArchive')).toBeVisible()
  await expect(page.getByText('PrincipalOutstanding')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Current lookup' })).toBeVisible()

  const controlNames = await page.locator('button, a[href], input, select, textarea').evaluateAll((nodes) => (
    nodes.map((node) => `${node.textContent ?? ''} ${node.getAttribute('aria-label') ?? ''}`).join('\n')
  ))
  expect(controlNames).not.toMatch(/connect wallet|sign transaction|submit transaction|repay loan|make payment/i)
})

test('exposes archived object navigation on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockSharedState(page)
  await page.route('**/api/audit/archived?*', (route) => route.fulfill({ json: archivedListResponse() }))

  await page.goto('/about')
  await page.locator('.mobile-bottom-nav').getByRole('button', { name: 'More' }).click()
  await page.locator('.mobile-more-panel').getByRole('link', { name: 'Archived Objects', exact: true }).click()
  await expect(page).toHaveURL(/\/audit\/archived$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Archived Objects' })).toBeVisible()
})
