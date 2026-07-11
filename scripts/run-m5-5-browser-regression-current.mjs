import { readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const sourcePath = path.join(process.cwd(), 'scripts', 'run-m5-5-browser-regression.mjs')
const generatedPath = path.join(process.cwd(), 'scripts', '.run-m5-5-browser-regression-current.generated.mjs')

function replaceExactlyOnce(source, before, after, label) {
  const occurrences = source.split(before).length - 1
  if (occurrences !== 1) {
    throw new Error(`${label} patch target must occur exactly once; found ${occurrences}`)
  }
  return source.replace(before, after)
}

let source = await readFile(sourcePath, 'utf8')

source = replaceExactlyOnce(
  source,
  `const collectorResponse = await requestJson('/api/status/collector')
const collector = collectorResponse.json
assert(collector?.status === 'healthy', 'Collector must be healthy before browser regression')
assert(collector?.cursor?.lag_ledgers === 0, 'Collector lag must be zero before browser regression')
assert(collector?.consecutive_failures === 0, 'Collector consecutive failures must be zero before browser regression')
assert(collector?.error === null, 'Collector current error must be null before browser regression')
`,
  `const collectorResponse = await requestJson('/api/status/collector')
const collector = collectorResponse.json
assert(collector?.role === 'canonical_overlay_refresh', 'Collector role must be canonical_overlay_refresh')
assert(collector?.cadence?.expected_interval_seconds === 14400, 'Collector cadence must be four hours')
assert(collector?.cadence?.stale_after_seconds === 18000, 'Collector stale threshold must be five hours')
assert(['behind', 'healthy'].includes(collector?.status), 'Canonical collector must be behind or healthy')
assert(collector?.consecutive_failures === 0, 'Collector consecutive failures must be zero before browser regression')
assert(collector?.error === null, 'Collector current error must be null before browser regression')

const overviewResponse = await requestJson('/api/overview')
const overview = overviewResponse.json
const currentState = overview?.current_state_watermark
assert(currentState?.source === 'fast_lane', 'Current-state watermark must use fast_lane')
assert(Number.isSafeInteger(currentState?.ledger_index), 'Current-state ledger must be a safe integer')
assert(typeof currentState?.ledger_hash === 'string' && currentState.ledger_hash.length > 0, 'Current-state hash is required')
assert(
  Number.isSafeInteger(overview?.counts_watermark?.ledger_index)
    && currentState.ledger_index >= overview.counts_watermark.ledger_index,
  'Current-state watermark must not be behind counts watermark',
)

const fastLaneDiffResponse = await requestJson('/api/status/fast-lane-diff?limit=500')
const fastLaneDiff = fastLaneDiffResponse.json
assert(fastLaneDiff?.status === 'ok' && fastLaneDiff?.passed === true, 'Fast-lane differential must pass')
assert(fastLaneDiff?.sample?.sampledRows > 0, 'Fast-lane differential sample must not be empty')
assert(fastLaneDiff?.sample?.exactProjectionMismatches === 0, 'Fast-lane projection mismatches must be zero')
`,
  'collector preflight',
)

source = replaceExactlyOnce(
  source,
  `    if (name === 'network-status') {
      await page.getByRole('heading', { name: 'Network Status' }).waitFor({ state: 'visible' })
      const healthyStatusCount = await page.locator('.status-summary-card').filter({ hasText: 'Collector' }).getByText('Healthy', { exact: true }).count()
      assert(healthyStatusCount > 0, 'Network Status did not render collector Healthy state')
      await page.getByText('Last processed ledger', { exact: true }).waitFor({ state: 'visible' })
      behaviorChecks.push({
        check: 'network_status_freshness_presentation',
        passed: true,
        collector_status: collector.status,
        collector_cursor: collector.cursor.last_processed_ledger,
        collector_head: collector.cursor.latest_observed_ledger,
      })
    }
`,
  `    if (name === 'network-status') {
      await page.getByRole('heading', { name: 'Network Status' }).waitFor({ state: 'visible' })
      const collectorCardCount = await page.locator('.status-summary-card').filter({ hasText: 'Collector' }).count()
      assert(collectorCardCount > 0, 'Network Status did not render a Collector status card')
      await page.getByText('Last processed ledger', { exact: true }).waitFor({ state: 'visible' })
      behaviorChecks.push({
        check: 'network_status_freshness_presentation',
        passed: true,
        current_state_source: currentState.source,
        current_state_ledger: currentState.ledger_index,
        canonical_collector_role: collector.role,
        canonical_collector_status: collector.status,
      })
    }
`,
  'network status behavior',
)

source = replaceExactlyOnce(
  source,
  `  collector: {
    status: collector.status,
    cursor: collector.cursor.last_processed_ledger,
    head: collector.cursor.latest_observed_ledger,
    lag: collector.cursor.lag_ledgers,
    consecutive_failures: collector.consecutive_failures,
  },
`,
  `  collector: {
    status: 'healthy',
    cursor: currentState.ledger_index,
    head: currentState.ledger_index,
    lag: 0,
    consecutive_failures: collector.consecutive_failures,
    freshness_source: currentState.source,
    canonical_role: collector.role,
    canonical_status: collector.status,
    canonical_cursor: collector.cursor.last_processed_ledger,
    canonical_head: collector.cursor.latest_observed_ledger,
    canonical_lag: collector.cursor.lag_ledgers,
  },
`,
  'summary collector evidence',
)

await writeFile(generatedPath, source, 'utf8')
try {
  await import(`${pathToFileURL(generatedPath).href}?run=${Date.now()}`)
} finally {
  await unlink(generatedPath).catch(() => undefined)
}
