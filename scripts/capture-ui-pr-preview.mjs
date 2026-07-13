import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

const UI_BASE_URL = process.env.UI_BASE_URL ?? 'http://127.0.0.1:4173'
const API_BASE_URL = process.env.API_BASE_URL ?? 'https://xrpl-lending-monitor.badjoke-lab.workers.dev'
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? 'ui-pr-preview'

const desktopRoutes = [
  ['overview', '/'],
  ['vaults', '/vaults'],
  ['lifecycle', '/audit/lifecycle'],
  ['archived-objects', '/audit/archived'],
  ['cover-loss', '/audit/cover-loss'],
  ['search', '/search'],
  ['network-status', '/network-status'],
]

function safeName(value) {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
}

async function installApiProxy(page) {
  await page.route('**/api/**', async (route) => {
    const requestUrl = new URL(route.request().url())
    const upstream = new URL(`${requestUrl.pathname}${requestUrl.search}`, API_BASE_URL)
    const response = await fetch(upstream, {
      headers: { accept: route.request().headers().accept ?? 'application/json' },
    })
    const body = await response.arrayBuffer()
    await route.fulfill({
      status: response.status,
      headers: {
        'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
      body: Buffer.from(body),
    })
  })
}

async function settle(page) {
  await page.waitForLoadState('domcontentloaded')
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
  await page.locator('.state-loading').first().waitFor({ state: 'detached', timeout: 60_000 }).catch(() => {})
  await page.evaluate(async () => { await document.fonts?.ready })
  await page.waitForTimeout(400)
}

async function capture(page, manifest, name, path, viewport) {
  const consoleErrors = []
  const pageErrors = []
  const onConsole = (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) }
  const onPageError = (error) => pageErrors.push(error.message)
  page.on('console', onConsole)
  page.on('pageerror', onPageError)

  const response = await page.goto(new URL(path, UI_BASE_URL).toString(), { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await settle(page)
  await page.evaluate(() => window.scrollTo(0, 0))
  const metrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    documentHeight: document.documentElement.scrollHeight,
    bodyPaddingBottom: Number.parseFloat(getComputedStyle(document.querySelector('.application-body') ?? document.body).paddingBottom) || 0,
    mobileNavHeight: document.querySelector('.mobile-bottom-nav')?.getBoundingClientRect().height ?? 0,
  }))
  const prefix = `${safeName(name)}-${viewport}`
  await page.screenshot({ path: `${OUTPUT_DIR}/${prefix}-fold.png`, fullPage: false, animations: 'disabled' })
  await page.screenshot({ path: `${OUTPUT_DIR}/${prefix}-full.png`, fullPage: true, animations: 'disabled' })
  manifest.pages.push({
    name,
    path,
    viewport,
    status: response?.status() ?? null,
    title: await page.title(),
    metrics,
    consoleErrors,
    pageErrors,
  })
  page.off('console', onConsole)
  page.off('pageerror', onPageError)
}

async function discoverLoanPath(page) {
  await page.goto(new URL('/loans', UI_BASE_URL).toString(), { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await settle(page)
  return page.locator('a[href^="/loans/"]').first().getAttribute('href')
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true })
  const manifest = {
    generatedAt: new Date().toISOString(),
    uiBaseUrl: UI_BASE_URL,
    apiBaseUrl: API_BASE_URL,
    productionMutations: false,
    pages: [],
  }
  const browser = await chromium.launch({ headless: true })
  try {
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 })
    const desktopPage = await desktop.newPage()
    await installApiProxy(desktopPage)
    for (const [name, path] of desktopRoutes) await capture(desktopPage, manifest, name, path, 'desktop')
    const loanPath = await discoverLoanPath(desktopPage)
    if (loanPath) await capture(desktopPage, manifest, 'loan-detail', loanPath, 'desktop')
    await desktop.close()

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true })
    const mobilePage = await mobile.newPage()
    await installApiProxy(mobilePage)
    for (const [name, path] of [['overview', '/'], ['vaults', '/vaults'], ['network-status', '/network-status']]) {
      await capture(mobilePage, manifest, name, path, 'mobile')
    }
    if (loanPath) await capture(mobilePage, manifest, 'loan-detail', loanPath, 'mobile')
    await mobile.close()
  } finally {
    await browser.close()
  }

  manifest.summary = {
    pages: manifest.pages.length,
    httpFailures: manifest.pages.filter((page) => page.status === null || page.status >= 400).length,
    horizontalOverflow: manifest.pages.filter((page) => page.metrics.documentWidth > page.metrics.viewportWidth).map((page) => `${page.name}:${page.viewport}`),
    mobileNavOverlapRisk: manifest.pages.filter((page) => page.viewport === 'mobile' && page.metrics.bodyPaddingBottom < page.metrics.mobileNavHeight).map((page) => page.name),
    consoleErrors: manifest.pages.reduce((sum, page) => sum + page.consoleErrors.length, 0),
    pageErrors: manifest.pages.reduce((sum, page) => sum + page.pageErrors.length, 0),
  }
  await writeFile(`${OUTPUT_DIR}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(manifest.summary, null, 2))
  if (manifest.summary.httpFailures || manifest.summary.horizontalOverflow.length || manifest.summary.mobileNavOverlapRisk.length || manifest.summary.consoleErrors || manifest.summary.pageErrors) {
    process.exitCode = 1
  }
}

main().catch(async (error) => {
  await mkdir(OUTPUT_DIR, { recursive: true }).catch(() => {})
  await writeFile(`${OUTPUT_DIR}/fatal-error.txt`, `${error?.stack ?? error}\n`, 'utf8').catch(() => {})
  console.error(error)
  process.exitCode = 1
})
