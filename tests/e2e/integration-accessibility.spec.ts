import { expect, type Page, test } from '@playwright/test'

async function mockSharedState(page: Page) {
  await page.route('**/api/status', (route) => route.fulfill({
    json: {
      network: 'devnet',
      epoch: {
        id: 'epoch-integration', status: 'current', first_ledger_index: 100, first_ledger_hash: 'FIRST',
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
      network: 'devnet', epoch: { id: 'epoch-integration', status: 'current' }, snapshot: null,
      freshness: { collector_status: 'healthy', latest_validated_ledger: 125, last_processed_ledger: 123, last_success_at: '2026-07-02T00:00:11.000Z' },
      counts: { vaults: null, loan_brokers: null, loans: null, current_objects: null },
      provenance: { counts: 'unavailable', freshness: 'direct' }, unavailable: ['current snapshot'],
    },
  }))
  await page.route('**/api/activity?limit=6', (route) => route.fulfill({
    json: { network: 'devnet', data: [], page: { limit: 6, next_cursor: null } },
  }))
}

async function expectNoHorizontalOverflow(page: Page) {
  const report = await page.evaluate(() => {
    const root = document.documentElement
    const viewportWidth = root.clientWidth
    const offenders = Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .map((element) => {
        const rect = element.getBoundingClientRect()
        return {
          element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${element.className ? `.${String(element.className).trim().replace(/\s+/g, '.')}` : ''}`,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          text: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
        }
      })
      .filter((item) => item.right > viewportWidth + 1 || item.left < -1)
      .sort((a, b) => b.right - a.right)
      .slice(0, 20)

    return {
      pageOverflow: root.scrollWidth - viewportWidth,
      viewportWidth,
      rootScrollWidth: root.scrollWidth,
      offenders,
    }
  })

  expect(report.pageOverflow, JSON.stringify(report, null, 2)).toBeLessThanOrEqual(1)
}

test('preserves breadcrumb hierarchy, history, deep links, and focus', async ({ page }) => {
  await mockSharedState(page)
  await page.goto('/methodology#provenance')

  const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' })
  await expect(breadcrumb.getByText('Methodology', { exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('#provenance')).toBeFocused()
  await expect(page.getByRole('main')).toHaveCount(1)
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)

  await page.locator('.sidebar').getByRole('link', { name: 'About', exact: true }).click()
  await expect(page).toHaveURL(/\/about$/)
  await expect(page.locator('#main-content')).toBeFocused()
  await expect(breadcrumb.getByText('About', { exact: true })).toHaveAttribute('aria-current', 'page')

  await page.goBack()
  await expect(page).toHaveURL(/\/methodology#provenance$/)
  await expect(page.locator('#provenance')).toBeFocused()
  await expect(page.getByText('epoch-integration', { exact: true })).toBeVisible()
})

test('supports keyboard skip navigation and keeps context stable across SPA routes', async ({ page }) => {
  await mockSharedState(page)
  await page.goto('/about')

  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#main-content')).toBeFocused()

  const context = page.getByRole('region', { name: 'Network context' })
  await expect(context).toContainText('DEVNET')
  await expect(context).toContainText('Read-only')
  await expect(context).toContainText('epoch-integration')

  await page.locator('.sidebar').getByRole('link', { name: 'Methodology', exact: true }).click()
  await expect(context).toContainText('epoch-integration')
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Methodology')
})

test('keeps documentation usable at mobile width and increased text size', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockSharedState(page)

  for (const path of ['/about', '/methodology', '/contact']) {
    await page.goto(path)
    await expect(page.locator('.sidebar')).toBeHidden()
    await expectNoHorizontalOverflow(page)
  }

  await page.goto('/about')
  await page.locator('.mobile-bottom-nav').getByRole('button', { name: 'More' }).click()
  await page.locator('.mobile-more-panel').getByRole('link', { name: 'API', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Read-only API' })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/methodology')
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  await expect(page.getByRole('heading', { level: 1, name: 'Methodology' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('does not expose unsupported financial or write controls', async ({ page }) => {
  await mockSharedState(page)
  await page.goto('/about')
  await page.locator('.sidebar').getByRole('link', { name: 'API', exact: true }).click()

  const controlNames = await page.locator('button, a[href], input, select, textarea').evaluateAll((nodes) => (
    nodes.map((node) => `${node.textContent ?? ''} ${node.getAttribute('aria-label') ?? ''}`).join('\n')
  ))

  expect(controlNames).not.toMatch(/connect wallet|sign transaction|submit transaction|donate|donation|payment|risk score|usd total/i)
  await expect(page.locator('form')).toHaveCount(0)
  await expect(page.locator('[data-testid="risk-score"], [data-testid="usd-total"], [data-wallet-control]')).toHaveCount(0)
})
