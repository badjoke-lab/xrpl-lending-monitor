import { expect, type Page, test } from '@playwright/test'

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

function epochRecord(id = 'epoch-1', status: 'current' | 'archived' = 'current') {
  return {
    id,
    network: 'devnet',
    status,
    first_ledger_index: 100,
    first_ledger_hash: 'FIRST',
    last_ledger_index: status === 'archived' ? 199 : null,
    last_ledger_hash: status === 'archived' ? 'LAST' : null,
    started_at: '2026-07-02T00:00:00.000Z',
    ended_at: status === 'archived' ? '2026-07-02T01:00:00.000Z' : null,
    reset_reason: status === 'archived' ? 'ledger_gap' : null,
    provenance: 'direct',
  }
}

test('renders epoch list and opens scoped detail', async ({ page }) => {
  await mockSharedState(page)
  await page.route('**/api/epochs', (route) => route.fulfill({ json: { network: 'devnet', data: [epochRecord(), epochRecord('epoch-0', 'archived')] } }))
  await page.route('**/api/epochs/epoch-1', (route) => route.fulfill({
    json: {
      network: 'devnet',
      kind: 'epoch',
      epoch_id: 'epoch-1',
      data: epochRecord(),
      scoped_counts: {
        protocol_events: 4,
        object_changes: 9,
        archived_objects: 1,
        loan_lifecycle_events: 2,
        balance_history_rows: 3,
        current_objects: null,
      },
      availability: { state: 'available', reason: null, current_objects: 'unavailable until a verified active snapshot is activated' },
      provenance: { epoch: 'direct', scoped_counts: 'indexed', current_objects: 'unavailable' },
    },
  }))

  await page.goto('/epochs')
  await expect(page.getByRole('heading', { level: 1, name: 'Devnet Epochs' })).toBeVisible()
  await expect(page.getByText('Records from different epochs are never silently combined.')).toBeVisible()
  await page.getByRole('link', { name: 'epoch-1' }).click()
  await expect(page).toHaveURL(/\/epochs\/epoch-1$/)
  await expect(page.getByRole('heading', { level: 2, name: 'Epoch-scoped indexed evidence' })).toBeVisible()
  await expect(page.getByText('Protocol events')).toBeVisible()
  await expect(page.getByText('unavailable until a verified active snapshot is activated')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open Methodology' })).toBeVisible()
})

test('exposes Devnet Epochs navigation on mobile without write controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockSharedState(page)
  await page.route('**/api/epochs', (route) => route.fulfill({ json: { network: 'devnet', data: [epochRecord()] } }))

  await page.goto('/about')
  await page.locator('.mobile-bottom-nav details').click()
  await page.locator('.mobile-more-panel').getByRole('link', { name: 'Devnet Epochs', exact: true }).click()
  await expect(page).toHaveURL(/\/epochs$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Devnet Epochs' })).toBeVisible()
  const controlNames = await page.locator('button, a[href], input, select, textarea').evaluateAll((nodes) => (
    nodes.map((node) => `${node.textContent ?? ''} ${node.getAttribute('aria-label') ?? ''}`).join('\n')
  ))
  expect(controlNames).not.toMatch(/connect wallet|sign transaction|submit transaction|repay loan|make payment/i)
})
