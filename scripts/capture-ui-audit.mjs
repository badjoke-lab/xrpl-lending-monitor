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
    await page.locator('.state-loading').waitFor({ state: 'hidden', timeout: 60_000 })
  } catch {
    throw new Error(`${route} did not leave the loading state within 60 seconds`)
  }

  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined)
  await page.evaluate(async () => {
    await globalThis.document.fonts.ready
  })
  await page.waitForTimeout(300)
}

async function captureLayoutDiagnostics(page) {
  return page.evaluate(() => {
    const documentElement = globalThis.document.documentElement
    const body = globalThis.document.body
    const viewportWidth = documentElement.clientWidth
    const pageScrollWidth = Math.max(documentElement.scrollWidth, body?.scrollWidth ?? 0)

    const overflowingElements = [...globalThis.document.querySelectorAll('*')]
      .filter((element) => element instanceof globalThis.HTMLElement)
      .map((element) => {
        const rect = element.getBoundingClientRect()
        const style = globalThis.getComputedStyle(element)
        const rightOverflow = Math.max(0, rect.right - viewportWidth)
        const leftOverflow = Math.max(0, -rect.left)
        const internalOverflow = Math.max(0, element.scrollWidth - element.clientWidth)
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id || null,
          class_name: typeof element.className === 'string' ? element.className : null,
          text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
          left: Math.round(rect.left * 100) / 100,
          right: Math.round(rect.right * 100) / 100,
          width: Math.round(rect.width * 100) / 100,
          right_overflow_px: Math.round(rightOverflow * 100) / 100,
          left_overflow_px: Math.round(leftOverflow * 100) / 100,
          internal_overflow_px: Math.round(internalOverflow * 100) / 100,
          overflow_x: style.overflowX,
        }
      })
      .filter(
        (item) =>
          item.right_overflow_px > 1 ||
          item.left_overflow_px > 1 ||
          (item.internal_overflow_px > 1 && !['auto', 'scroll'].includes(item.overflow_x)),
      )
      .sort(
        (left, right) =>
          Math.max(right.right_overflow_px, right.left_overflow_px, right.internal_overflow_px) -
          Math.max(left.right_overflow_px, left.left_overflow_px, left.internal_overflow_px),
      )
      .slice(0, 50)

    return {
      viewport_width: viewportWidth,
      page_scroll_width: pageScrollWidth,
      page_horizontal_overflow_px: Math.max(0, pageScrollWidth - viewportWidth),
      overflowing_elements: overflowingElements,
    }
  })
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
const diagnostics = []
try {
  for (const profile of profiles) {
    const profileDir = path.join(outputDir, profile.name)
    await mkdir(profileDir, { recursive: true })
    const context = await browser.newContext({
      viewport: profile.viewport,
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()
    const technicalFindings = []
    let activeRoute = null

    page.on('console', (message) => {
      if (message.type() === 'error') {
        technicalFindings.push({
          route: activeRoute,
          type: 'console_error',
          message: message.text().slice(0, 1000),
        })
      }
    })
    page.on('pageerror', (error) => {
      technicalFindings.push({
        route: activeRoute,
        type: 'page_error',
        message: error.message.slice(0, 1000),
      })
    })
    page.on('response', (response) => {
      if (response.status() >= 400) {
        technicalFindings.push({
          route: activeRoute,
          type: 'http_error',
          status: response.status(),
          url: response.url(),
        })
      }
    })

    for (const [name, route] of routes) {
      activeRoute = route
      const response = await page.goto(`${baseUrl}${route}`, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      })
      if (!response || !response.ok()) {
        throw new Error(`${route} navigation failed with HTTP ${response?.status() ?? 'no response'}`)
      }
      await waitForAuditPage(page, route)
      const layout = await captureLayoutDiagnostics(page)
      diagnostics.push({ profile: profile.name, name, route, layout })
      await page.screenshot({
        path: path.join(profileDir, `${name}.png`),
        fullPage: true,
      })
    }

    if (profile.name === 'mobile') {
      activeRoute = '/#mobile-more-open'
      await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await waitForAuditPage(page, '/')
      await page.locator('.mobile-bottom-nav').getByRole('button', { name: 'More' }).click()
      await page.locator('#mobile-more-panel').waitFor({ state: 'visible', timeout: 10_000 })
      const layout = await captureLayoutDiagnostics(page)
      diagnostics.push({
        profile: profile.name,
        name: 'more-menu-open',
        route: '/#mobile-more-open',
        layout,
      })
      await page.screenshot({
        path: path.join(profileDir, 'more-menu-open.png'),
        fullPage: true,
      })
    }

    diagnostics.push({
      profile: profile.name,
      technical_findings: technicalFindings,
    })
    await context.close()
  }
} finally {
  await browser.close()
}

await writeFile(
  path.join(outputDir, 'diagnostics.json'),
  `${JSON.stringify(diagnostics, null, 2)}\n`,
  'utf8',
)

console.log(`Captured ${routes.length * profiles.length + 1} full-page screenshots in ${outputDir}`)
