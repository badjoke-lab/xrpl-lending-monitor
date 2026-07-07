import { expect, test } from '@playwright/test'

test('applies route metadata and keeps final-host metadata absent until configured', async ({ page }) => {
  await page.goto('/methodology')

  await expect(page).toHaveTitle('Methodology | XRPL Lending Monitor')
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    /collects validated ledger data/,
  )
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index,follow')
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    'content',
    'Methodology | XRPL Lending Monitor',
  )
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0)
  await expect(page.locator('meta[property="og:url"]')).toHaveCount(0)
  await expect(page.locator('script[data-analytics-provider="ga4"]')).toHaveCount(0)
})

test('keeps volatile details and unknown routes out of the index', async ({ page }) => {
  await page.goto(`/loans/${'A'.repeat(64)}`)
  await expect(page).toHaveTitle('Loan Detail | XRPL Lending Monitor')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,follow')

  await page.goto('/not-a-route')
  await expect(page).toHaveTitle('Page Not Found | XRPL Lending Monitor')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow')
})
