import { expect, type Page, test } from '@playwright/test'

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

test('renders complete About and Methodology routes with stable anchors', async ({ page }) => {
  await mockBase(page)

  await page.goto('/about')
  await expect(page.getByRole('heading', { level: 1, name: 'About XRPL Lending Monitor' })).toBeVisible()
  await expect(page.getByText('An independent, read-only monitor and historical audit layer', { exact: false })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open Methodology' })).toHaveAttribute('href', '/methodology')
  await expect(page.getByText('What this project does not provide')).toBeVisible()

  await page.getByRole('link', { name: 'Methodology', exact: true }).click()
  await expect(page).toHaveURL(/\/methodology$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Methodology' })).toBeVisible()
  await expect(page.locator('.documentation-toc a')).toHaveCount(20)
  await expect(page.locator('#validated-ledgers')).toBeVisible()
  await expect(page.locator('#affected-nodes')).toBeVisible()
  await expect(page.locator('#status')).toContainText('default_eligible')
  await expect(page.locator('#limitations')).toContainText('Devnet')
})

test('documents current endpoints, limits, unavailable semantics, and examples', async ({ page }) => {
  await mockBase(page)

  await page.goto('/api#exports')
  await expect(page.getByRole('heading', { level: 1, name: 'Read-only API' })).toBeVisible()
  await expect(page.locator('#exports')).toBeVisible()
  await expect(page.getByText('/api/loans/{loanId}', { exact: true })).toBeVisible()
  await expect(page.getByText('/api/transactions/{hash}', { exact: true })).toBeVisible()
  await expect(page.getByText('Collection limits are validated from 1 through 100.')).toBeVisible()
  await expect(page.getByText('Illustrative shape only.', { exact: false })).toBeVisible()
  await expect(page.locator('#current-state')).toContainText('CURRENT_STATE')
  await expect(page.locator('body')).not.toContainText('Connect wallet')
})

test('keeps private contact unavailable and exposes only configured public issues', async ({ page }) => {
  await mockBase(page)

  await page.goto('/contact')
  await expect(page.getByRole('heading', { level: 1, name: 'Contact' })).toBeVisible()
  await expect(page.getByText('Private contact form unavailable')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open GitHub Issues' })).toHaveAttribute(
    'href',
    'https://github.com/badjoke-lab/xrpl-lending-monitor/issues',
  )
  await expect(page.getByRole('heading', { name: 'Do not publish confidential or personal information' })).toBeVisible()
  await expect(page.getByText('Never post wallet seeds, private keys, credentials, access tokens', { exact: false })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open contact form' })).toHaveCount(0)
})

test('exposes documentation routes through the mobile More navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockBase(page)

  await page.goto('/methodology#provenance')
  await expect(page.locator('.sidebar')).toBeHidden()
  await page.locator('.mobile-bottom-nav details').click()
  await expect(page.locator('.mobile-more-panel').getByRole('link', { name: 'Methodology' })).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.mobile-more-panel').getByRole('link', { name: 'API' })).toHaveAttribute('href', '/api')
  await expect(page.locator('.mobile-more-panel').getByRole('link', { name: 'About' })).toHaveAttribute('href', '/about')
  await expect(page.locator('.mobile-more-panel').getByRole('link', { name: 'Contact' })).toHaveAttribute('href', '/contact')
})
