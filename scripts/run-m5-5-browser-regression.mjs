import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const baseUrl = (process.env.BASE_URL ?? 'https://xrpl-lending-monitor.badjoke-lab.workers.dev').replace(/\/$/, '')
const outputDir = process.env.M5_BROWSER_OUTPUT_DIR ?? 'm5-5-browser-regression'
const requestTimeoutMs = Number(process.env.M5_BROWSER_REQUEST_TIMEOUT_MS ?? 120000)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function requestJson(relativePath, options = {}) {
  const url = `${baseUrl}${relativePath}`
  const maxAttempts = options.maxAttempts ?? 3
  let last = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url, { signal: AbortSignal.timeout(requestTimeoutMs) })
    const text = await response.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      const retryable = response.status >= 500 && response.status <= 599
      if (retryable && attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
        continue
      }
      throw new Error(`${relativePath} returned invalid JSON with HTTP ${response.status}`)
    }

    last = { status: response.status, json, text }
    const accepted = options.acceptStatuses?.includes(response.status) ?? response.ok
    if (accepted) return last

    if (response.status < 500 || response.status > 599 || attempt === maxAttempts) break
    await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
  }

  throw new Error(`${relativePath} returned HTTP ${last?.status ?? 'unknown'}: ${(last?.text ?? '').slice(0, 240)}`)
}

function firstId(payload, label) {
  const id = payload?.data?.[0]?.id
  assert(typeof id === 'string' && id.length > 0, `${label} list did not provide an identifier`)
  return id
}

function archivedCurrentPath(objectType, objectId) {
  if (objectType === 'Vault') return `/vaults/${objectId}`
  if (objectType === 'LoanBroker') return `/loan-brokers/${objectId}`
  if (objectType === 'Loan') return `/loans/${objectId}`
  throw new Error(`Unsupported archived object type: ${objectType}`)
}

async function discoverLifecycleCurrentWitness(lifecycleRows) {
  const seen = new Set()
  for (const row of lifecycleRows) {
    if (!row?.loan_id || seen.has(row.loan_id) || row.event_type === 'deleted') continue
    seen.add(row.loan_id)
    if (seen.size > 12) break
    const response = await requestJson(`/api/loans/${encodeURIComponent(row.loan_id)}`, {
      acceptStatuses: [200, 404],
      maxAttempts: 2,
    })
    if (response.status === 200 && response.json?.availability?.state === 'available' && response.json?.data?.id === row.loan_id) {
      return row.loan_id
    }
  }
  throw new Error('No lifecycle-backed current Loan witness was found in the bounded lifecycle window')
}

async function waitForApplicationPage(page, route) {
  const response = await page.goto(`${baseUrl}${route}`, {
    waitUntil: 'domcontentloaded',
    timeout: requestTimeoutMs,
  })
  assert(response?.ok(), `${route} navigation returned HTTP ${response?.status() ?? 'no response'}`)

  await page.locator('#main-content').waitFor({ state: 'visible', timeout: 30000 })
  await page.waitForFunction(() => globalThis.document.querySelectorAll('.state-loading').length === 0, undefined, { timeout: 60000 })
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined)
  await page.evaluate(async () => {
    await globalThis.document.fonts.ready
  })
  await page.waitForTimeout(250)

  const errors = await page.locator('.state-error').allTextContents()
  assert(errors.length === 0, `${route} rendered state-error: ${errors.join(' | ').slice(0, 500)}`)
  const heading = (await page.locator('#main-content h1').first().textContent())?.trim() ?? ''
  assert(heading.length > 0, `${route} rendered without a primary heading`)
  return heading
}

async function checkExactHref(page, href, label) {
  const locator = page.locator(`a[href="${href}"]`)
  const count = await locator.count()
  assert(count > 0, `${label} exact href was not rendered: ${href}`)
  return count
}

await mkdir(outputDir, { recursive: true })

const collectorResponse = await requestJson('/api/status/collector')
const collector = collectorResponse.json
assert(collector?.status === 'healthy', 'Collector must be healthy before browser regression')
assert(collector?.cursor?.lag_ledgers === 0, 'Collector lag must be zero before browser regression')
assert(collector?.consecutive_failures === 0, 'Collector consecutive failures must be zero before browser regression')
assert(collector?.error === null, 'Collector current error must be null before browser regression')

const [vaultsResponse, brokersResponse, loansResponse, lifecycleResponse, archivedResponse, activityResponse] = await Promise.all([
  requestJson('/api/vaults?limit=25&sort=id_asc'),
  requestJson('/api/loan-brokers?limit=25&sort=id_asc'),
  requestJson('/api/loans?limit=25&sort=id_asc'),
  requestJson('/api/audit/lifecycle?limit=100'),
  requestJson('/api/audit/archived?limit=25'),
  requestJson('/api/activity?limit=25'),
])

const vaultId = firstId(vaultsResponse.json, 'Vault')
const brokerId = firstId(brokersResponse.json, 'Loan Broker')
const relationshipLoanId = firstId(loansResponse.json, 'Loan')
const relationshipLoanResponse = await requestJson(`/api/loans/${encodeURIComponent(relationshipLoanId)}`)
const relationshipLoan = relationshipLoanResponse.json?.data
assert(relationshipLoan?.related_loan_broker?.id, 'Relationship Loan detail did not expose a related Loan Broker')
assert(relationshipLoan?.related_vault?.id, 'Relationship Loan detail did not expose a related Vault')

const lifecycleRows = lifecycleResponse.json?.data
assert(Array.isArray(lifecycleRows) && lifecycleRows.length > 0, 'Lifecycle explorer did not provide evidence rows')
const lifecycleLoanId = await discoverLifecycleCurrentWitness(lifecycleRows)

const archivedRows = archivedResponse.json?.data
assert(Array.isArray(archivedRows) && archivedRows.length > 0, 'Archived Objects did not provide evidence rows')
const archivedWitness = archivedRows[0]
assert(typeof archivedWitness.object_type === 'string' && typeof archivedWitness.object_id === 'string', 'Archived witness identity is incomplete')

const activityRows = activityResponse.json?.data
assert(Array.isArray(activityRows) && activityRows.length > 0, 'Activity did not provide evidence rows')
const transactionHash = activityRows[0]?.transaction_hash
assert(typeof transactionHash === 'string' && transactionHash.length > 0, 'Activity witness did not provide a transaction hash')

const routeMatrix = [
  ['overview', '/'],
  ['vaults', '/vaults'],
  ['vault-detail', `/vaults/${encodeURIComponent(vaultId)}`],
  ['loan-brokers', '/loan-brokers'],
  ['loan-broker-detail', `/loan-brokers/${encodeURIComponent(brokerId)}`],
  ['loans', '/loans'],
  ['loan-detail', `/loans/${encodeURIComponent(lifecycleLoanId)}`],
  ['activity', '/activity'],
  ['transaction-detail', `/transactions/${encodeURIComponent(transactionHash)}`],
  ['lifecycle', `/audit/lifecycle?loan_id=${encodeURIComponent(lifecycleLoanId)}`],
  ['archived-objects', '/audit/archived'],
  ['archived-detail', `/audit/archived/${encodeURIComponent(archivedWitness.object_type)}/${encodeURIComponent(archivedWitness.object_id)}`],
  ['cover-loss', '/audit/cover-loss'],
  ['search', `/search?q=${encodeURIComponent(lifecycleLoanId)}`],
  ['network-status', '/network-status'],
]

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
})
const page = await context.newPage()
const findings = []
let activeRoute = null

page.on('console', (message) => {
  if (message.type() === 'error') {
    findings.push({ route: activeRoute, type: 'console_error', message: message.text().slice(0, 1000) })
  }
})
page.on('pageerror', (error) => {
  findings.push({ route: activeRoute, type: 'page_error', message: error.message.slice(0, 1000) })
})
page.on('response', (response) => {
  if (response.status() >= 500) {
    findings.push({ route: activeRoute, type: 'http_5xx', status: response.status(), url: response.url() })
  }
})

const routeResults = []
const behaviorChecks = []

try {
  for (const [name, route] of routeMatrix) {
    activeRoute = route
    const heading = await waitForApplicationPage(page, route)
    routeResults.push({ name, route, heading, passed: true })
  }

  activeRoute = `/loans/${relationshipLoanId}`
  await waitForApplicationPage(page, activeRoute)
  const brokerPath = `/loan-brokers/${relationshipLoan.related_loan_broker.id}`
  const vaultPath = `/vaults/${relationshipLoan.related_vault.id}`
  await checkExactHref(page, brokerPath, 'Loan → Loan Broker link')
  await checkExactHref(page, vaultPath, 'Loan → Vault link')
  behaviorChecks.push({ check: 'loan_relationship_links', passed: true, loan_id: relationshipLoanId, broker_id: relationshipLoan.related_loan_broker.id, vault_id: relationshipLoan.related_vault.id })

  await page.getByRole('link', { name: 'Open Broker' }).click()
  await page.waitForURL((url) => url.pathname === brokerPath, { timeout: 30000 })
  await waitForApplicationPage(page, brokerPath)
  await checkExactHref(page, vaultPath, 'Loan Broker → Vault link')
  behaviorChecks.push({ check: 'loan_broker_navigation', passed: true, route: brokerPath })

  await page.getByRole('link', { name: 'Open Vault' }).click()
  await page.waitForURL((url) => url.pathname === vaultPath, { timeout: 30000 })
  await waitForApplicationPage(page, vaultPath)
  behaviorChecks.push({ check: 'vault_navigation', passed: true, route: vaultPath })

  const lifecycleRoute = `/audit/lifecycle?loan_id=${encodeURIComponent(lifecycleLoanId)}`
  activeRoute = lifecycleRoute
  await waitForApplicationPage(page, lifecycleRoute)
  const lifecycleCards = await page.locator('.lifecycle-event-card').count()
  assert(lifecycleCards > 0, 'Filtered Lifecycle page did not render lifecycle events')
  const lifecycleLoanPath = `/loans/${lifecycleLoanId}`
  await checkExactHref(page, lifecycleLoanPath, 'Lifecycle → current Loan link')
  behaviorChecks.push({ check: 'lifecycle_current_link', passed: true, loan_id: lifecycleLoanId, event_cards: lifecycleCards })

  await page.locator(`a[href="${lifecycleLoanPath}"]`).first().click()
  await page.waitForURL((url) => url.pathname === lifecycleLoanPath, { timeout: 30000 })
  await waitForApplicationPage(page, lifecycleLoanPath)
  const lifecycleTimelineCount = await page.locator('[aria-label="Loan lifecycle timeline"] .lifecycle-event-card').count()
  const stateChangeCount = await page.locator('[aria-label="Loan state changes"] .state-change-card').count()
  assert(lifecycleTimelineCount > 0, 'Current Loan detail did not render indexed lifecycle events')
  assert(stateChangeCount > 0, 'Current Loan detail did not render indexed state changes')
  behaviorChecks.push({ check: 'loan_lifecycle_history_rendering', passed: true, loan_id: lifecycleLoanId, lifecycle_events: lifecycleTimelineCount, state_changes: stateChangeCount })

  const archiveRoute = `/audit/archived/${encodeURIComponent(archivedWitness.object_type)}/${encodeURIComponent(archivedWitness.object_id)}`
  activeRoute = archiveRoute
  await waitForApplicationPage(page, archiveRoute)
  await page.getByText('Archived context', { exact: true }).waitFor({ state: 'visible', timeout: 10000 })
  await page.getByText('Current existence is not implied.', { exact: false }).waitFor({ state: 'visible', timeout: 10000 })
  await page.getByRole('button', { name: 'Current lookup' }).waitFor({ state: 'visible', timeout: 10000 })
  behaviorChecks.push({ check: 'archived_context_presentation', passed: true, object_type: archivedWitness.object_type, object_id: archivedWitness.object_id, current_path: archivedCurrentPath(archivedWitness.object_type, archivedWitness.object_id) })

  const searchRoute = `/search?q=${encodeURIComponent(lifecycleLoanId)}`
  activeRoute = searchRoute
  await waitForApplicationPage(page, searchRoute)
  const queryText = await page.locator('.search-result-summary .mono').first().textContent()
  assert(queryText?.trim() === lifecycleLoanId, 'Search page did not preserve the exact Loan query')
  await checkExactHref(page, lifecycleLoanPath, 'Search → current Loan link')
  behaviorChecks.push({ check: 'search_current_loan_link', passed: true, query: lifecycleLoanId })

  activeRoute = '/network-status'
  await waitForApplicationPage(page, '/network-status')
  await page.getByRole('heading', { name: 'Network Status' }).waitFor({ state: 'visible' })
  const healthyStatusCount = await page.locator('.status-summary-card').filter({ hasText: 'Collector' }).getByText('Healthy', { exact: true }).count()
  assert(healthyStatusCount > 0, 'Network Status did not render collector Healthy state')
  await page.getByText('Last processed ledger', { exact: true }).waitFor({ state: 'visible' })
  behaviorChecks.push({ check: 'network_status_freshness_presentation', passed: true, collector_status: collector.status, collector_cursor: collector.cursor.last_processed_ledger, collector_head: collector.cursor.latest_observed_ledger })

  assert(findings.length === 0, `Browser regression collected technical findings: ${JSON.stringify(findings).slice(0, 1500)}`)
} finally {
  await context.close()
  await browser.close()
}

const summary = {
  recorded_at: new Date().toISOString(),
  base_url: baseUrl,
  collector: {
    status: collector.status,
    cursor: collector.cursor.last_processed_ledger,
    head: collector.cursor.latest_observed_ledger,
    lag: collector.cursor.lag_ledgers,
    consecutive_failures: collector.consecutive_failures,
  },
  witnesses: {
    vault_id: vaultId,
    loan_broker_id: brokerId,
    relationship_loan_id: relationshipLoanId,
    lifecycle_loan_id: lifecycleLoanId,
    archived_object_type: archivedWitness.object_type,
    archived_object_id: archivedWitness.object_id,
    transaction_hash: transactionHash,
  },
  routes: routeResults,
  behavior_checks: behaviorChecks,
  technical_findings: findings,
  result: {
    passed: true,
    route_count: routeResults.length,
    behavior_check_count: behaviorChecks.length,
    human_visual_review_separate: true,
  },
}

const markdown = [
  '# M5-5 browser regression summary',
  '',
  `- Result: **${summary.result.passed ? 'passed' : 'failed'}**`,
  `- Routes checked: **${summary.result.route_count}**`,
  `- Behavior checks: **${summary.result.behavior_check_count}**`,
  `- Collector: **${summary.collector.status}**, cursor \`${summary.collector.cursor}\`, head \`${summary.collector.head}\`, lag \`${summary.collector.lag}\``,
  `- Technical findings: **${summary.technical_findings.length}**`,
  '',
  'Verified browser behaviors:',
  ...summary.behavior_checks.map((item) => `- ${item.check}: **passed**`),
  '',
  'Human screenshot review remains a separate Track B requirement.',
  '',
].join('\n')

await writeFile(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
await writeFile(path.join(outputDir, 'summary.md'), markdown, 'utf8')
console.log(markdown)
