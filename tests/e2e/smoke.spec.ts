import { expect, test } from '@playwright/test'

test('renders the read-only foundation shell', async ({ page }) => {
  await page.goto('/')

  await expect(
    page.getByRole('heading', { level: 1, name: 'XRPL Lending Monitor' }),
  ).toBeVisible()
  await expect(page.getByText('Foundation ready')).toBeVisible()
  await expect(
    page.getByText('No wallet connection, signing, lending, repayment, or investment advice.'),
  ).toBeVisible()
})
