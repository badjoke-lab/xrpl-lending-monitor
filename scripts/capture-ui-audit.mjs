import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const baseUrl = (process.env.BASE_URL ?? '').replace(/\/$/, '')
const outputDir = process.env.OUTPUT_DIR ?? 'ui-screenshot-audit'

if (!/^https?:\/\//.test(baseUrl)) {
  throw new Error('BASE_URL must be an absolute http(s) URL')
}

async function fetchJson(route) {
  const response = await fetch(`${baseUrl}${route}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) {
    throw new Error(`${route} returned HTTP ${response.status}`)
  }
  return response.json()
}

function firstId(payload, label) {
  const id = payload?.data?.[0]?.id
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`No ${label} identifier is available for screenshot detail discovery`)
  }
  return id
}

async function waitForAuditPage(page, route) {
  await page.locator('#main-content').waitFor({ state: 'visible', timeout: 30_000 })

  try {
    await page.waitForFunction(() => document.querySelector('.state-loading') === null, undefined, {
      timeout: 60_000,
    })
  } catch {
    throw new Error(`${route} did not leave the loading state within 60 seconds`)
  }

  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined)
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await page.waitForTimeout(300)
}

const [vaults, brokers, loans] = await Promise.all([
  fetchJson('/api/vaults?limit=1'),
  fetchJson('/api/loan-brokers?limit=1'),
  fetchJson('/api/loans?limit=1'),
])

const vaultId = firstId(vaults, 'Vault')
const brokerId = firstId(brokers, 'Loan Broker')
const loanId = firstId(loans, 'Loan')

const routes = [
  ['overview', '/'],
  ['vaults', '/vaults'],
  ['vault-detail', `/vaults/${encodeURIComponent(vaultId)}`],
  ['loan-brokers', '/loan-brokers'],
  ['loan-broker-detail', `/loan-brokers/${encodeURIComponent(brokerId)}`],
  ['loans', '/loans'],
  ['loan-detail', `/loans/${encodeURIComponent(loanId)}`],
  ['activity', '/activity'],
  ['lifecycle', '/audit/lifecycle'],
  ['archived-objects', '/audit/archived'],
  ['cover-loss', '/audit/cover-loss'],
  ['search', '/search'],
  ['network-status', '/network-status'],
  ['api', '/api'],
  ['methodology', '/methodology'],
  ['about', '/about'],
  ['contact', '/contact'],
]

const profiles = [
  { name: 'desktop', viewport: { width: 1440, height: 1000 } },
  { name: 'mobile', viewport: { width: 390, height: 844 } },
]

await mkdir(outputDir, { recursive: true })
await writeFile(
  path.join(outputDir, 'manifest.json'),
  `${JSON.stringify(
    {
      captured_at: new Date().toISOString(),
      base_url: baseUrl,
      profiles,
      routes: routes.map(([name, route]) => ({ name, route })),
      detail_ids: {
        vault_id: vaultId,
        loan_broker_id: brokerId,
        loan_id: loanId,
      },
    },
    null,
    2,
  )}\n`,
  'utf8',
)

const browser = await chromium.launch({ headless: true })
try {
  for (const profile of profiles) {
    const profileDir = path.join(outputDir, profile.name)
    await mkdir(profileDir, { recursive: true })
    const context = await browser.newContext({
      viewport: profile.viewport,
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()

    for (const [name, route] of routes) {
      const response = await page.goto(`${baseUrl}${route}`, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      })
      if (!response || !response.ok()) {
        throw new Error(`${route} navigation failed with HTTP ${response?.status() ?? 'no response'}`)
      }
      await waitForAuditPage(page, route)
      await page.screenshot({
        path: path.join(profileDir, `${name}.png`),
        fullPage: true,
      })
    }

    if (profile.name === 'mobile') {
      await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await waitForAuditPage(page, '/')
      await page.locator('.mobile-bottom-nav').getByRole('button', { name: 'More' }).click()
      await page.locator('#mobile-more-panel').waitFor({ state: 'visible', timeout: 10_000 })
      await page.screenshot({
        path: path.join(profileDir, 'more-menu-open.png'),
        fullPage: true,
      })
    }

    await context.close()
  }
} finally {
  await browser.close()
}

console.log(`Captured ${routes.length * profiles.length + 1} full-page screenshots in ${outputDir}`)
