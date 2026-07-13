import { expect, test } from '@playwright/test'

test('discloses that indexed history is not as fresh as current state', async ({ page }) => {
  await page.route('**/api/status', async (route) => {
    await route.fulfill({
      json: {
        network: 'devnet',
        epoch: null,
        server: {
          endpoint: null,
          version: null,
          state: null,
          complete_ledgers: null,
          latest_validated_ledger: null,
          latest_validated_hash: null,
          latest_ledger_age_seconds: null,
        },
        amendments: {
          lending_protocol: { enabled: null, supported: null },
          single_asset_vault: { enabled: null, supported: null },
        },
        collector: {
          status: 'unavailable',
          last_processed_ledger: null,
          last_processed_hash: null,
          last_attempt_at: null,
          last_success_at: null,
          data_age_seconds: null,
          consecutive_failures: 0,
          reset_reason: null,
          error: null,
        },
      },
    })
  })
  await page.route('**/api/overview', async (route) => {
    await route.fulfill({
      json: {
        network: 'devnet',
        epoch: null,
        snapshot: null,
        freshness: null,
        counts: { vaults: null, loan_brokers: null, loans: null, current_objects: null },
        provenance: { counts: 'unavailable', freshness: 'unavailable' },
        unavailable: ['recovery in progress'],
      },
    })
  })
  await page.route('**/api/activity?limit=6', async (route) => {
    await route.fulfill({ json: { network: 'devnet', data: [], page: { limit: 6, next_cursor: null } } })
  })

  await page.goto('/')

  const banner = page.getByRole('status', { name: 'Degraded data notice' })
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('History, activity, audit records, and indexed counts are under recovery')
  await expect(banner).toContainText('Do not treat them as equally fresh')
})
