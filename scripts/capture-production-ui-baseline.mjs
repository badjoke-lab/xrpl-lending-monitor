import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import process from 'node:process'

const BASE_URL = process.env.BASE_URL ?? 'https://xrpl-lending-monitor.badjoke-lab.workers.dev'
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? 'ui-visual-baseline'

const desktopTargets = [
  { name: 'overview', candidates: ['/'], patterns: [/^\/$/] },
  { name: 'vaults', candidates: ['/vaults'], patterns: [/^\/vaults\/?$/] },
  { name: 'loan-brokers', candidates: ['/loan-brokers'], patterns: [/^\/loan-brokers\/?$/] },
  { name: 'loans', candidates: ['/loans'], patterns: [/^\/loans\/?$/] },
  { name: 'activity', candidates: ['/activity'], patterns: [/activity/i] },
  { name: 'lifecycle', candidates: ['/lifecycle', '/audit/lifecycle'], patterns: [/lifecycle/i] },
  { name: 'archived-objects', candidates: ['/archived-objects', '/audit/archived'], patterns: [/archiv/i] },
  { name: 'cover-loss', candidates: ['/cover-loss'], patterns: [/cover.*loss|loss.*cover/i] },
  { name: 'search', candidates: ['/search'], patterns: [/search/i] },
  { name: 'network-status', candidates: ['/network-status', '/status'], patterns: [/network.*status|status.*network/i] },
]

const detailTargets = [
  { name: 'vault-detail', patterns: [/^\/vaults\/[^/?#]+\/?$/] },
  { name: 'loan-broker-detail', patterns: [/^\/loan-brokers\/[^/?#]+\/?$/] },
  { name: 'loan-detail', patterns: [/^\/loans\/[^/?#]+\/?$/] },
  { name: 'transaction-detail', patterns: [/^\/transactions\/[^/?#]+\/?$/] },
  { name: 'archived-detail', patterns: [/archiv.*\/[^/?#]+(?:\/[^/?#]+)?\/?$/i] },
]

function normalizePath(rawHref) {
  try {
    const url = new URL(rawHref, BASE_URL)
    if (url.origin !== new URL(BASE_URL).origin) return null
    return `${url.pathname}${url.search}`
  } catch {
    return null
  }
}

function safeName(value) {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
}

function uniqueLinks(links) {
  const seen = new Set()
  return links.filter((link) => {
    const key = `${link.path}|${link.text}`
    if (!link.path || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function matchingPath(target, links) {
  const matching = links.find((link) => target.patterns.some((pattern) => pattern.test(link.path) || pattern.test(link.text)))
  return matching?.path ?? null
}

async function collectLinks(page) {
  const rawLinks = await page.locator('a[href]').evaluateAll((anchors) => anchors.map((anchor) => ({
    href: anchor.getAttribute('href') ?? '',
    text: (anchor.textContent ?? '').replace(/\s+/g, ' ').trim(),
  })))
  return uniqueLinks(rawLinks.map((link) => ({ ...link, path: normalizePath(link.href) })).filter((link) => link.path))
}

async function settle(page) {
  await page.waitForLoadState('domcontentloaded')
  await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {})
  await page.waitForTimeout(1_500)
}

async function openPath(page, path) {
  const response = await page.goto(new URL(path, BASE_URL).toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  })
  await settle(page)
  const bodyText = await page.locator('body').innerText().catch(() => '')
  const title = await page.title().catch(() => '')
  const status = response?.status() ?? null
  const missing = status !== null && status >= 400
    || /page not found|404 not found|route not found/i.test(`${title}\n${bodyText.slice(0, 800)}`)
  return { status, title, bodyText, missing }
}

async function capturePage({ page, name, path, viewportName, manifest, sharedLinks }) {
  const consoleErrors = []
  const pageErrors = []
  const onConsole = (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  }
  const onPageError = (error) => pageErrors.push(error.message)
  page.on('console', onConsole)
  page.on('pageerror', onPageError)

  const openedAt = new Date().toISOString()
  const started = Date.now()
  let opened
  try {
    opened = await openPath(page, path)
  } catch (error) {
    manifest.pages.push({
      name,
      path,
      viewport: viewportName,
      openedAt,
      elapsedMs: Date.now() - started,
      captured: false,
      error: error instanceof Error ? error.message : String(error),
      consoleErrors,
      pageErrors,
    })
    page.off('console', onConsole)
    page.off('pageerror', onPageError)
    return null
  }

  if (opened.missing) {
    manifest.pages.push({
      name,
      path,
      viewport: viewportName,
      openedAt,
      elapsedMs: Date.now() - started,
      status: opened.status,
      title: opened.title,
      captured: false,
      missing: true,
      consoleErrors,
      pageErrors,
    })
    page.off('console', onConsole)
    page.off('pageerror', onPageError)
    return null
  }

  const prefix = `${safeName(name)}-${viewportName}`
  const foldFile = `${prefix}-fold.png`
  const fullFile = `${prefix}-full.png`
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `${OUTPUT_DIR}/${foldFile}`, fullPage: false, animations: 'disabled' })
  await page.screenshot({ path: `${OUTPUT_DIR}/${fullFile}`, fullPage: true, animations: 'disabled' })
  const links = await collectLinks(page)
  sharedLinks.push(...links)

  const entry = {
    name,
    path,
    url: new URL(path, BASE_URL).toString(),
    viewport: viewportName,
    openedAt,
    elapsedMs: Date.now() - started,
    status: opened.status,
    title: opened.title,
    bodyTextPreview: opened.bodyText.replace(/\s+/g, ' ').trim().slice(0, 500),
    captured: true,
    foldFile,
    fullFile,
    linkCount: links.length,
    consoleErrors,
    pageErrors,
  }
  manifest.pages.push(entry)
  page.off('console', onConsole)
  page.off('pageerror', onPageError)
  return entry
}

async function resolveAndCaptureDesktop(page, manifest) {
  const sharedLinks = []
  const resolved = new Map()

  for (const target of desktopTargets) {
    const discovered = matchingPath(target, uniqueLinks(sharedLinks))
    const candidates = [...new Set([discovered, ...target.candidates].filter(Boolean))]
    for (const candidate of candidates) {
      const result = await capturePage({
        page,
        name: target.name,
        path: candidate,
        viewportName: 'desktop',
        manifest,
        sharedLinks,
      })
      if (result) {
        resolved.set(target.name, candidate)
        break
      }
    }
  }

  const allLinks = uniqueLinks(sharedLinks)
  for (const target of detailTargets) {
    const path = matchingPath(target, allLinks)
    if (!path) continue
    const result = await capturePage({
      page,
      name: target.name,
      path,
      viewportName: 'desktop',
      manifest,
      sharedLinks,
    })
    if (result) resolved.set(target.name, path)
  }
  return resolved
}

async function captureMobile(browser, resolved, manifest) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  })
  const page = await context.newPage()
  const sharedLinks = []
  const names = ['overview', 'vaults', 'loan-detail', 'network-status']
  for (const name of names) {
    const path = resolved.get(name)
    if (!path) continue
    await capturePage({ page, name, path, viewportName: 'mobile', manifest, sharedLinks })
  }
  await context.close()
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true })
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    sourceCommit: process.env.GITHUB_SHA ?? null,
    readOnlyProductionCapture: true,
    productionMutations: false,
    pages: [],
  }

  const browser = await chromium.launch({ headless: true })
  try {
    const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 })
    const desktopPage = await desktopContext.newPage()
    const resolved = await resolveAndCaptureDesktop(desktopPage, manifest)
    await desktopContext.close()
    await captureMobile(browser, resolved, manifest)
    manifest.resolvedRoutes = Object.fromEntries(resolved)
  } finally {
    await browser.close()
  }

  manifest.summary = {
    attempted: manifest.pages.length,
    captured: manifest.pages.filter((page) => page.captured).length,
    missing: manifest.pages.filter((page) => page.missing).length,
    consoleErrors: manifest.pages.reduce((sum, page) => sum + page.consoleErrors.length, 0),
    pageErrors: manifest.pages.reduce((sum, page) => sum + page.pageErrors.length, 0),
  }
  await writeFile(`${OUTPUT_DIR}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await writeFile(`${OUTPUT_DIR}/routes.txt`, `${Object.entries(manifest.resolvedRoutes ?? {}).map(([name, path]) => `${name}\t${path}`).join('\n')}\n`, 'utf8')
  console.log(JSON.stringify(manifest.summary, null, 2))
  if (manifest.summary.captured < 8) process.exitCode = 1
}

main().catch(async (error) => {
  await mkdir(OUTPUT_DIR, { recursive: true }).catch(() => {})
  await writeFile(`${OUTPUT_DIR}/fatal-error.txt`, `${error?.stack ?? error}\n`, 'utf8').catch(() => {})
  console.error(error)
  process.exitCode = 1
})
