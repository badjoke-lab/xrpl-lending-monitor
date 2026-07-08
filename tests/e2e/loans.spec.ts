import { expect, type Page, test } from '@playwright/test'

const loanId = `${'C'.repeat(63)}1`
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

const loan = {
  id: loanId,
  loan_broker_id: brokerId,
  borrower: 'rBorrower',
  loan_sequence: 1,
  asset: { type: 'xrp', key: 'XRP', symbol: 'XRP', scale: 6 },
  loan_origination_fee: '10', loan_service_fee: '20', late_payment_fee: '30', close_payment_fee: '40',
  overpayment_fee_rate: 500, interest_rate: 1000, late_interest_rate: 2000,
  close_interest_rate: 3000, overpayment_interest_rate: 4000,
  start_date_ripple_time: 831439690, start_date: '2026-05-08T00:48:10.000Z',
  payment_interval_seconds: 400, grace_period_seconds: 60,
  previous_payment_due_ripple_time: 831439690, previous_payment_due: '2026-05-08T00:48:10.000Z',
  next_payment_due_ripple_time: 831440090, next_payment_due: '2026-05-08T00:54:50.000Z',
  default_eligible_ripple_time: 831440150, default_eligible_at: '2026-05-08T00:55:50.000Z',
  payment_remaining: 1, principal_outstanding: '10000', total_value_outstanding: '10500',
  management_fee_outstanding: '100', periodic_payment: '1000', loan_scale: null,
  on_ledger_status: 'active', schedule_status: 'default_eligible',
  status_source: {
    flags: 0, next_payment_due_ripple_time: 831440090, next_payment_due: '2026-05-08T00:54:50.000Z',
    grace_period_seconds: 60, default_eligible_ripple_time: 831440150,
    default_eligible_at: '2026-05-08T00:55:50.000Z', evaluated_at_ripple_time: 831440200,
    evaluated_at: '2026-05-08T00:56:40.000Z',
  },
  supports_overpayment: false, flags: 0,
  previous_transaction_hash: 'F'.repeat(64), previous_ledger_index: 122,
  related_loan_broker: { id: brokerId, vault_id: vaultId, owner: 'rBrokerOwner', account: 'rBrokerAccount' },
  related_vault: {
    id: vaultId, owner: 'rVaultOwner', account: 'rVaultAccount',
    asset: { type: 'xrp', key: 'XRP', symbol: 'XRP', scale: 6 },
  },
  provenance: {
    object: 'direct', asset: 'direct', relationships: 'direct',
    on_ledger_status: 'direct', schedule_status: 'derived',
  },
  raw: { LedgerEntryType: 'Loan', index: loanId, PrincipalOutstanding: '10000' },
}

const lifecycleEvent = {
  loan_id: loanId,
  epoch_id: 'epoch-1',
  transaction_hash: 'E'.repeat(64),
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
}

const objectChange = {
  transaction_hash: lifecycleEvent.transaction_hash,
  epoch_id: 'epoch-1',
  ledger_index: 121,
  transaction_index: 2,
  transaction_type: 'LoanPay',
  result_code: 'tesSUCCESS',
  close_time: 831440100,
  node_index: 0,
  object_type: 'Loan',
  object_id: loanId,
  action: 'modified',
  field_name: 'PrincipalOutstanding',
  before_json: '11000',
  after_json: '10000',
  value_type: 'string',
  unsupported_field: false,
  relationships: {
    vault_id: vaultId,
    loan_broker_id: brokerId,
    loan_id: loanId,
    account: null,
    owner: null,
    borrower: 'rBorrower',
    asset_key: 'XRP',
    mpt_issuance_id: null,
  },
  created_at: '2026-07-02T00:00:00.000Z',
  provenance: 'indexed',
}

async function mockBase(page: Page) {
  await page.route('**/api/status', (route) => route.fulfill({ json: statusResponse }))
  await page.route('**/api/overview', (route) => route.fulfill({
    json: {
      network: 'devnet', epoch: { id: 'epoch-1', status: 'current' }, snapshot,
      freshness: { collector_status: 'healthy', latest_validated_ledger: 125, last_processed_ledger: 123, last_success_at: '2026-07-02T00:00:11.000Z' },
      counts: { vaults: 1, loan_brokers: 1, loans: 1, current_objects: 3 },
      provenance: { counts: 'direct', freshness: 'direct' }, unavailable: [],
    },
  }))
  await page.route('**/api/activity?limit=6', (route) => route.fulfill({
    json: { network: 'devnet', data: [], page: { limit: 6, next_cursor: null } },
  }))
}

function collection(data: unknown[], availability: 'available' | 'unavailable' = 'available') {
  return {
    network: 'devnet', kind: 'loans', epoch: { id: 'epoch-1', status: 'current' },
    snapshot: availability === 'available' ? snapshot : null,
    data,
    page: { limit: 25, next_cursor: null, sort: 'id_asc', loan_shards_read: 1, relation_shards_read: 2, objects_examined: data.length },
    filters: { query: null, on_ledger_status: null, schedule_status: null },
    availability: {
      state: availability,
      reason: availability === 'available' ? null : 'active current-state snapshot has not been activated',
    },
    provenance: { collection: availability === 'available' ? 'direct' : 'unavailable', asset_relationship: 'direct', schedule_status: 'derived' },
  }
}

test('renders independent Loan states and opens verified detail relationships', async ({ page }) => {
  await mockBase(page)
  await page.route('**/api/loans?*', (route) => route.fulfill({ json: collection([loan]) }))
  await page.route(`**/api/loans/${loanId}`, (route) => route.fulfill({
    json: {
      network: 'devnet', kind: 'loan', epoch: { id: 'epoch-1', status: 'current' }, snapshot,
      data: loan, availability: { state: 'available', reason: null },
      provenance: { object: 'direct', asset_relationship: 'direct', schedule_status: 'derived' },
    },
  }))
  await page.route(`**/api/loans/${loanId}/lifecycle?limit=25`, (route) => route.fulfill({
    json: { network: 'devnet', loan_id: loanId, data: [lifecycleEvent], page: { limit: 25, next_cursor: null } },
  }))
  await page.route(`**/api/objects/Loan/${loanId}/history?limit=25`, (route) => route.fulfill({
    json: { network: 'devnet', object_type: 'Loan', object_id: loanId, data: [objectChange], page: { limit: 25, next_cursor: null } },
  }))

  await page.goto('/loans')
  await expect(page.getByRole('heading', { level: 1, name: 'Loans' })).toBeVisible()
  await expect(page.locator('.loan-table').getByText('Active', { exact: true })).toBeVisible()
  await expect(page.locator('.loan-table').getByText('Default Eligible', { exact: true })).toBeVisible()
  await expect(page.locator('.loan-table').getByText('10000 XRP', { exact: true })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('USD')

  await page.locator('.loan-table').getByRole('link', { name: /C{8}/ }).click()
  await expect(page).toHaveURL(new RegExp(`/loans/${loanId}$`))
  await expect(page.getByRole('heading', { level: 2, name: 'Payment schedule' })).toBeVisible()
  await expect(page.getByText('Default eligibility is a schedule calculation. It does not mean the on-ledger Loan is defaulted.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open Broker' })).toHaveAttribute('href', `/loan-brokers/${brokerId}`)
  await expect(page.getByRole('link', { name: 'Open Vault' })).toHaveAttribute('href', `/vaults/${vaultId}`)
  await expect(page.getByRole('heading', { level: 2, name: 'Payment history and lifecycle' })).toBeVisible()
  await expect(page.locator('.lifecycle-timeline').getByText('LoanPay', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'State changes' })).toBeVisible()
  await expect(page.locator('.state-change-list').getByRole('heading', { name: 'PrincipalOutstanding' })).toBeVisible()
  await expect(page.locator('.raw-data-panel')).toContainText('PrincipalOutstanding')
})

test('keeps unavailable Loan state explicit and sends both status filters', async ({ page }) => {
  await mockBase(page)
  await page.route('**/api/loans?*', (route) => route.fulfill({ json: collection([], 'unavailable') }))

  await page.goto('/loans')
  await expect(page.getByText('Loan collection unavailable')).toBeVisible()
  await expect(page.getByText('active current-state snapshot has not been activated')).toBeVisible()

  await page.getByLabel('Search').fill('rBorrower')
  await page.getByLabel('On-ledger').selectOption('active')
  await page.getByLabel('Schedule').selectOption('default_eligible')
  const request = page.waitForRequest((value) =>
    value.url().includes('/api/loans?') &&
    value.url().includes('q=rBorrower') &&
    value.url().includes('on_ledger_status=active') &&
    value.url().includes('schedule_status=default_eligible'),
  )
  await page.getByRole('button', { name: 'Apply' }).click()
  await request
})

test('exposes Loans as a primary mobile destination', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockBase(page)
  await page.route('**/api/loans?*', (route) => route.fulfill({ json: collection([]) }))

  await page.goto('/loans')
  await expect(page.locator('.sidebar')).toBeHidden()
  await expect(page.locator('.mobile-bottom-nav').getByRole('link', { name: 'Loans' })).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.loan-filter-form')).toBeVisible()
})
