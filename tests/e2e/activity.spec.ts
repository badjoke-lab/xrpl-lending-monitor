import { expect, type Page, test } from '@playwright/test'

const transactionHash = 'A'.repeat(64)
const secondHash = 'B'.repeat(64)
const loanId = 'C'.repeat(64)
const brokerId = 'D'.repeat(64)
const vaultId = 'E'.repeat(64)

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

const events = [
  {
    transaction_hash: transactionHash, epoch_id: 'epoch-1', ledger_index: 123, event_index: 1,
    close_time: 836_000_000, transaction_type: 'LoanSet', result_code: 'tesSUCCESS',
    payload_retained: true, source_json: null, metadata_json: null,
    created_at: '2026-07-02T00:00:11.000Z', provenance: 'indexed',
  },
  {
    transaction_hash: secondHash, epoch_id: 'epoch-1', ledger_index: 122, event_index: 2,
    close_time: 835_999_900, transaction_type: 'LoanPay', result_code: 'tecFAILED',
    payload_retained: false, source_json: null, metadata_json: null,
    created_at: '2026-07-02T00:00:10.000Z', provenance: 'indexed',
  },
]

async function mockBase(page: Page) {
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
}

function transactionResponse() {
  return {
    network: 'devnet', transaction_hash: transactionHash, found: true,
    event: {
      ...events[0],
      source_json: { TransactionType: 'LoanSet', Account: 'rInitiator', Fee: '12', Sequence: 7 },
      metadata_json: { TransactionResult: 'tesSUCCESS', AffectedNodes: [] },
    },
    object_changes: [
      {
        transaction_hash: transactionHash, epoch_id: 'epoch-1', ledger_index: 123,
        transaction_index: 1, transaction_type: 'LoanSet', result_code: 'tesSUCCESS',
        close_time: 836_000_000, node_index: 0, object_type: 'Loan', object_id: loanId,
        action: 'modified', field_name: 'PrincipalOutstanding', before_json: '1000', after_json: '900',
        value_type: 'string', unsupported_field: false,
        relationships: {
          vault_id: vaultId, loan_broker_id: brokerId, loan_id: loanId,
          account: null, owner: null, borrower: 'rBorrower', asset_key: 'XRP', mpt_issuance_id: null,
        },
        created_at: '2026-07-02T00:00:11.000Z', provenance: 'indexed',
      },
    ],
  }
}

test('filters bounded Activity and opens normalized transaction detail', async ({ page }) => {
  await mockBase(page)
  await page.route('**/api/activity?limit=100', (route) => route.fulfill({
    json: { network: 'devnet', data: events, page: { limit: 100, next_cursor: null } },
  }))
  await page.route(`**/api/transactions/${transactionHash}`, (route) => route.fulfill({ json: transactionResponse() }))

  await page.goto('/activity')
  await expect(page.getByRole('heading', { level: 1, name: 'Protocol Activity' })).toBeVisible()
  await expect(page.locator('.activity-card')).toHaveCount(2)
  await expect(page.getByRole('link', { name: 'CSV export' })).toHaveAttribute('href', '/api/exports/activity?format=csv&limit=100')

  await page.getByLabel('Transaction type').fill('LoanSet')
  await page.getByRole('button', { name: 'Apply' }).click()
  await expect(page.locator('.activity-card')).toHaveCount(1)
  await expect(page).toHaveURL(/\/activity\?type=LoanSet/)

  await page.locator('.activity-card').getByRole('link', { name: /A{12}/ }).click()
  await expect(page).toHaveURL(new RegExp(`/transactions/${transactionHash}$`))
  await expect(page.getByRole('heading', { level: 2, name: 'Affected nodes' })).toBeVisible()
  await expect(page.getByText('PrincipalOutstanding')).toBeVisible()
  await expect(page.getByText('rInitiator')).toBeVisible()
  await expect(page.getByRole('link', { name: /Loan:/ })).toHaveAttribute('href', `/loans/${loanId}`)
  await expect(page.locator('.raw-data-panel')).toContainText('TransactionType')
})

test('keeps malformed transaction identifiers explicit', async ({ page }) => {
  await mockBase(page)
  await page.goto('/transactions/not-a-hash')
  await expect(page.getByText('Invalid transaction hash')).toBeVisible()
  await expect(page.getByText('64-character hexadecimal XRPL transaction hash')).toBeVisible()
})

test('exposes Activity as a primary mobile destination', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockBase(page)
  await page.route('**/api/activity?limit=100', (route) => route.fulfill({
    json: { network: 'devnet', data: [], page: { limit: 100, next_cursor: null } },
  }))

  await page.goto('/activity')
  await expect(page.locator('.sidebar')).toBeHidden()
  await expect(page.locator('.mobile-bottom-nav').getByRole('link', { name: 'Activity' })).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.activity-filter-form')).toBeVisible()
})
