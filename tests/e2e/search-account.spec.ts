import { expect, type Page, test } from '@playwright/test'

const account = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
const vaultId = `${'A'.repeat(63)}1`
const brokerId = `${'B'.repeat(63)}1`
const loanId = `${'C'.repeat(63)}1`
const transactionHash = 'D'.repeat(64)

async function mockBase(page: Page) {
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

function collection(kind: 'vaults' | 'loan_brokers' | 'loans', data: unknown[]) {
  return {
    network: 'devnet', kind, epoch: { id: 'epoch-1', status: 'current' },
    snapshot: { id: 'snapshot-1', epoch_id: 'epoch-1', ledger_index: 123, ledger_hash: 'SNAPSHOT', completed_at: '2026-07-02T00:00:20.000Z' },
    data, page: { limit: 100, next_cursor: null }, filters: { query: account },
    availability: { state: 'available', reason: null }, provenance: { collection: 'direct' },
  }
}

const searchResponse = {
  network: 'devnet', query: account,
  data: [
    {
      kind: 'transaction', epoch_id: 'epoch-1', ledger_index: 122,
      transaction_hash: transactionHash, object_type: null, object_id: null, loan_id: null,
      provenance: 'indexed',
    },
    {
      kind: 'object_change', epoch_id: 'epoch-1', ledger_index: 122,
      transaction_hash: transactionHash, object_type: 'Loan', object_id: loanId, loan_id: loanId,
      provenance: 'indexed',
    },
    {
      kind: 'archived_object', epoch_id: 'epoch-0', ledger_index: 99,
      transaction_hash: 'E'.repeat(64), object_type: 'Vault', object_id: 'F'.repeat(64), loan_id: null,
      provenance: 'indexed',
    },
  ],
  page: { limit: 25, next_cursor: null },
}

test('searches exact indexed records and opens separated account relationships', async ({ page }) => {
  await mockBase(page)
  await page.route('**/api/search?*', (route) => route.fulfill({ json: searchResponse }))
  await page.route('**/api/vaults?*', (route) => route.fulfill({
    json: collection('vaults', [{ id: vaultId, owner: account, account: 'rVaultPseudo' }]),
  }))
  await page.route('**/api/loan-brokers?*', (route) => route.fulfill({
    json: collection('loan_brokers', [{ id: brokerId, owner: account, account: 'rBrokerPseudo' }]),
  }))
  await page.route('**/api/loans?*', (route) => route.fulfill({
    json: collection('loans', [{ id: loanId, borrower: account }]),
  }))

  const searchRequest = page.waitForRequest((value) =>
    value.url().includes('/api/search?') && value.url().includes('limit=25'),
  )
  await page.goto(`/search?q=${account}`)
  await searchRequest
  await expect(page.getByRole('heading', { level: 1, name: 'Global Search' })).toBeVisible()
  await expect(page.getByText('Archived context only. Current-state existence is not implied.')).toBeVisible()
  await expect(page.getByText('3', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Open account relationships' }).click()
  await expect(page).toHaveURL(new RegExp(`/accounts/${account}$`))
  await expect(page.getByRole('heading', { level: 1, name: 'Protocol Account Relationships' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 3, name: 'Owned or controlled Vault records' })).toBeVisible()
  await expect(page.getByRole('link', { name: /A{8}/ })).toHaveAttribute('href', `/vaults/${vaultId}`)
  await expect(page.getByRole('link', { name: /B{8}/ })).toHaveAttribute('href', `/loan-brokers/${brokerId}`)
  await expect(page.getByRole('link', { name: /C{8}/ }).first()).toHaveAttribute('href', `/loans/${loanId}`)
  await expect(page.locator('body')).not.toContainText('USD')
  await expect(page.getByText(/no off-chain identity/i)).toBeVisible()
})

test('rejects a malformed account route without issuing relationship queries', async ({ page }) => {
  await mockBase(page)
  let relationshipRequests = 0
  await page.route('**/api/search?*', (route) => { relationshipRequests += 1; return route.abort() })
  await page.route('**/api/vaults?*', (route) => { relationshipRequests += 1; return route.abort() })
  await page.route('**/api/loan-brokers?*', (route) => { relationshipRequests += 1; return route.abort() })
  await page.route('**/api/loans?*', (route) => { relationshipRequests += 1; return route.abort() })

  await page.goto('/accounts/rInvalid0')
  await expect(page.getByRole('heading', { level: 1, name: 'Invalid XRPL account' })).toBeVisible()
  await expect(page.getByText('No API request was made.')).toBeVisible()
  expect(relationshipRequests).toBe(0)
})

test('explains accepted Search formats on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockBase(page)
  await page.goto('/search')
  await expect(page.locator('.sidebar')).toBeHidden()
  await expect(page.locator('.mobile-bottom-nav').getByRole('link', { name: 'Search' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByLabel('Exact identifier or relationship value')).toBeVisible()
  await expect(page.getByText('64 hexadecimal characters')).toBeVisible()
  await expect(page.getByText('Classic address beginning with r')).toBeVisible()
  await expect(page.getByText('Search does not accept shortened IDs containing an ellipsis.')).toBeVisible()
})
