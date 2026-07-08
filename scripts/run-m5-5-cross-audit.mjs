import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const baseUrl = (process.env.BASE_URL ?? 'https://xrpl-lending-monitor.badjoke-lab.workers.dev').replace(/\/$/, '')
const outputDir = process.env.M5_CROSS_AUDIT_OUTPUT_DIR ?? 'm5-5-cross-audit'
const requestTimeoutMs = Number(process.env.M5_CROSS_AUDIT_REQUEST_TIMEOUT_MS ?? 120000)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function asArray(value, label) {
  assert(Array.isArray(value), `${label} must be an array`)
  return value
}

async function request(relativePath, options = {}) {
  const url = `${baseUrl}${relativePath}`
  const maxAttempts = 3
  let lastResponse = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url, { signal: AbortSignal.timeout(requestTimeoutMs) })
    const contentType = response.headers.get('content-type') ?? ''
    const text = await response.text()
    let json = null
    if (contentType.includes('application/json')) {
      try {
        json = JSON.parse(text)
      } catch {
        throw new Error(`${relativePath} returned invalid JSON`)
      }
    }
    lastResponse = {
      path: relativePath,
      status: response.status,
      contentType,
      text,
      json,
    }
    const expectedStatusMatched = options.expectedStatus !== undefined && response.status === options.expectedStatus
    const successMatched = options.expectedStatus === undefined && response.ok
    if (expectedStatusMatched || successMatched) return lastResponse
    const retryable = response.status >= 500 && response.status <= 599
    if (!retryable || attempt === maxAttempts) break
    await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
  }
  if (options.expectedStatus !== undefined) {
    throw new Error(`${relativePath} returned ${lastResponse.status}, expected ${options.expectedStatus}`)
  }
  throw new Error(`${relativePath} returned ${lastResponse.status}: ${lastResponse.text.slice(0, 240)}`)
}

function requireAvailableCurrent(response, label, snapshotId = null) {
  assert(response.json?.availability?.state === 'available', `${label} must be available`)
  assert(response.json?.data && typeof response.json.data.id === 'string', `${label} must have an object id`)
  assert(response.json?.snapshot?.id, `${label} must expose snapshot identity`)
  if (snapshotId !== null) {
    assert(response.json.snapshot.id === snapshotId, `${label} snapshot identity differs from ${snapshotId}`)
  }
  return response.json.data
}

function requireCurrentList(response, label, snapshotId = null) {
  assert(response.json?.availability?.state === 'available', `${label} collection must be available`)
  const data = asArray(response.json?.data, `${label}.data`)
  assert(data.length > 0, `${label} collection must contain at least one object`)
  assert(response.json?.snapshot?.id, `${label} collection must expose snapshot identity`)
  if (snapshotId !== null) {
    assert(response.json.snapshot.id === snapshotId, `${label} snapshot identity differs from ${snapshotId}`)
  }
  return data
}

function archiveCurrentPath(objectType, objectId) {
  if (objectType === 'Vault') return `/api/vaults/${encodeURIComponent(objectId)}`
  if (objectType === 'LoanBroker') return `/api/loan-brokers/${encodeURIComponent(objectId)}`
  if (objectType === 'Loan') return `/api/loans/${encodeURIComponent(objectId)}`
  throw new Error(`unsupported archived object type: ${objectType}`)
}

function summarizeTechnicalEvidence(evidence) {
  return {
    recorded_at: new Date().toISOString(),
    base_url: baseUrl,
    collector: evidence.collector,
    snapshot: evidence.snapshot,
    relationships: evidence.relationships,
    current_history: evidence.currentHistory,
    lifecycle: evidence.lifecycle,
    archive_exclusion: evidence.archiveExclusion,
    audit_collections: evidence.auditCollections,
    exports: evidence.exports,
    result: {
      passed: true,
      requires_human_ui_review: true,
    },
  }
}

function renderMarkdown(summary) {
  return [
    '# M5-5 production cross-audit summary',
    '',
    `- Result: **${summary.result.passed ? 'passed' : 'failed'}**`,
    `- Collector: **${summary.collector.status}**, cursor \`${summary.collector.cursor}\`, head \`${summary.collector.head}\`, lag \`${summary.collector.lag}\``,
    `- Snapshot: \`${summary.snapshot.id}\` at ledger \`${summary.snapshot.ledger_index}\``,
    `- Loan → Broker link: **${summary.relationships.loan_to_broker ? 'consistent' : 'inconsistent'}**`,
    `- Broker → Vault link: **${summary.relationships.broker_to_vault ? 'consistent' : 'inconsistent'}**`,
    `- Current Loan history rows checked: \`${summary.current_history.object_history_rows}\``,
    `- Current Loan lifecycle rows checked: \`${summary.lifecycle.current_loan_rows}\``,
    `- Lifecycle explorer rows checked: \`${summary.lifecycle.explorer_rows}\``,
    `- Archived object current exclusion: **${summary.archive_exclusion.current_excluded ? 'passed' : 'failed'}**`,
    `- Activity rows checked: \`${summary.audit_collections.activity_rows}\``,
    `- Activity success/non-success rows: \`${summary.audit_collections.activity_success_rows}\` / \`${summary.audit_collections.activity_non_success_rows}\``,
    `- Archived rows checked: \`${summary.audit_collections.archived_rows}\``,
    `- Cover/loss rows checked: \`${summary.audit_collections.cover_loss_rows}\``,
    `- Activity export JSON rows: \`${summary.exports.json_rows}\``,
    `- Activity export NDJSON rows: \`${summary.exports.ndjson_rows}\``,
    `- Activity export CSV data rows: \`${summary.exports.csv_rows}\``,
    '',
    'Human screenshot review remains a separate Track B requirement.',
    '',
  ].join('\n')
}

await mkdir(outputDir, { recursive: true })

const collectorResponse = await request('/api/status/collector')
const collector = collectorResponse.json
assert(collector?.status === 'healthy', 'collector must be healthy')
assert(collector?.cursor?.lag_ledgers === 0, 'collector lag must be zero')
assert(collector?.consecutive_failures === 0, 'collector consecutive failures must be zero')
assert(collector?.error === null, 'collector current error must be null')

const overview = await request('/api/overview')
const vaultListResponse = await request('/api/vaults?limit=25&sort=id_asc')
const snapshotId = vaultListResponse.json?.snapshot?.id
assert(typeof snapshotId === 'string' && snapshotId.length > 0, 'Vault collection snapshot identity is missing')
const vaultList = requireCurrentList(vaultListResponse, 'Vault', snapshotId)
const brokerListResponse = await request('/api/loan-brokers?limit=25&sort=id_asc')
const brokerList = requireCurrentList(brokerListResponse, 'Loan Broker', snapshotId)
const loanListResponse = await request('/api/loans?limit=25&sort=id_asc')
const loanList = requireCurrentList(loanListResponse, 'Loan', snapshotId)

const currentLoanId = loanList[0].id
const loanDetailResponse = await request(`/api/loans/${encodeURIComponent(currentLoanId)}`)
const loan = requireAvailableCurrent(loanDetailResponse, 'Loan detail', snapshotId)
assert(typeof loan.loan_broker_id === 'string', 'Loan detail is missing loan_broker_id')
assert(typeof loan.related_vault?.id === 'string', 'Loan detail is missing related Vault')

const brokerDetailResponse = await request(`/api/loan-brokers/${encodeURIComponent(loan.loan_broker_id)}`)
const broker = requireAvailableCurrent(brokerDetailResponse, 'Loan Broker detail', snapshotId)
const vaultDetailResponse = await request(`/api/vaults/${encodeURIComponent(broker.vault_id)}`)
const vault = requireAvailableCurrent(vaultDetailResponse, 'Vault detail', snapshotId)

const loanToBroker = loan.related_loan_broker?.id === broker.id && loan.loan_broker_id === broker.id
const brokerToVault = broker.related_vault?.id === vault.id && broker.vault_id === vault.id && loan.related_vault.id === vault.id
assert(loanToBroker, 'Loan → Loan Broker relationship is inconsistent')
assert(brokerToVault, 'Loan Broker → Vault relationship is inconsistent')

const lifecycleExplorer = await request('/api/audit/lifecycle?limit=100')
assert(lifecycleExplorer.json?.network === 'devnet', 'Lifecycle explorer must be Devnet')
const lifecycleExplorerRows = asArray(lifecycleExplorer.json?.data, 'Lifecycle explorer data')
assert(lifecycleExplorerRows.length > 0, 'Lifecycle explorer must contain indexed evidence')
const seenLifecycleLoans = new Set()
const lifecycleCurrentCandidate = lifecycleExplorerRows.find((row) => {
  if (seenLifecycleLoans.has(row.loan_id)) return false
  seenLifecycleLoans.add(row.loan_id)
  return row.event_type !== 'deleted'
})
assert(lifecycleCurrentCandidate?.loan_id, 'Lifecycle explorer must expose a latest non-deleted Loan witness')
const lifecycleCurrentDetailResponse = await request(`/api/loans/${encodeURIComponent(lifecycleCurrentCandidate.loan_id)}`)
const lifecycleCurrentLoan = requireAvailableCurrent(lifecycleCurrentDetailResponse, 'Lifecycle current Loan detail', snapshotId)
assert(lifecycleCurrentLoan.id === lifecycleCurrentCandidate.loan_id, 'Lifecycle/current Loan identity mismatch')
const currentLoanLifecycleRows = lifecycleExplorerRows.filter((row) => row.loan_id === lifecycleCurrentLoan.id)
assert(currentLoanLifecycleRows.every((row) => row.loan_id === lifecycleCurrentLoan.id), 'Lifecycle explorer contains mismatched Loan identity')

const objectHistory = await request(`/api/objects/Loan/${encodeURIComponent(lifecycleCurrentLoan.id)}/history?limit=1`)
assert(objectHistory.json?.network === 'devnet', 'Loan object history must be Devnet')
const objectHistoryRows = asArray(objectHistory.json?.data, 'Loan object history data')
assert(objectHistoryRows.length === 1, 'Lifecycle-backed current Loan must expose one bounded newest history row')
assert(objectHistoryRows.every((row) => row.object_type === 'Loan' && row.object_id === lifecycleCurrentLoan.id), 'Loan object history contains mismatched object identity')

const activity = await request('/api/activity?limit=100')
assert(activity.json?.network === 'devnet', 'Activity must be Devnet')
const activityRows = asArray(activity.json?.data, 'Activity data')
assert(activityRows.length > 0, 'Activity must contain protocol events')
assert(activityRows.every((row) => typeof row.result_code === 'string' && row.result_code.length > 0), 'Activity contains an event without a result code')
const activitySuccessRows = activityRows.filter((row) => row.result_code === 'tesSUCCESS').length
const activityNonSuccessRows = activityRows.length - activitySuccessRows

const archived = await request('/api/audit/archived?limit=25')
assert(archived.json?.network === 'devnet', 'Archived Objects must be Devnet')
const archivedRows = asArray(archived.json?.data, 'Archived Objects data')
assert(archivedRows.length > 0, 'Archived Objects must contain indexed evidence')
const archivedObject = archivedRows[0]
const exactArchive = await request(`/api/audit/archived/${encodeURIComponent(archivedObject.object_type)}/${encodeURIComponent(archivedObject.object_id)}`)
assert(exactArchive.json?.availability?.state === 'available', 'Exact archived object must be available')
assert(exactArchive.json?.data?.object_id === archivedObject.object_id, 'Exact archived object identity mismatch')
const currentArchivedPath = archiveCurrentPath(archivedObject.object_type, archivedObject.object_id)
const currentArchivedResponse = await request(currentArchivedPath, { expectedStatus: 404 })

const coverLoss = await request('/api/audit/cover-loss?limit=100')
assert(coverLoss.json?.network === 'devnet', 'Cover & Loss must be Devnet')
const coverLossRows = asArray(coverLoss.json?.data, 'Cover & Loss data')
assert(coverLossRows.length > 0, 'Cover & Loss must contain indexed evidence')

const exportJson = await request('/api/exports/activity?limit=25&format=json')
const exportJsonRows = asArray(exportJson.json?.data, 'Activity JSON export data')
assert(exportJsonRows.length > 0 && exportJsonRows.length <= 25, 'Activity JSON export row count is outside bounds')

const exportNdjson = await request('/api/exports/activity?limit=25&format=ndjson')
assert(exportNdjson.contentType.includes('application/x-ndjson'), 'Activity NDJSON export content type mismatch')
const ndjsonLines = exportNdjson.text.split('\n').filter(Boolean)
assert(ndjsonLines.length > 0 && ndjsonLines.length <= 25, 'Activity NDJSON export row count is outside bounds')
for (const line of ndjsonLines) JSON.parse(line)

const exportCsv = await request('/api/exports/activity?limit=25&format=csv')
assert(exportCsv.contentType.includes('text/csv'), 'Activity CSV export content type mismatch')
const csvLines = exportCsv.text.split(/\r?\n/).filter(Boolean)
assert(csvLines.length >= 2 && csvLines.length <= 26, 'Activity CSV export row count is outside bounds')
assert(csvLines[0].startsWith('transaction_hash,'), 'Activity CSV export header mismatch')

const feedNdjson = await request('/api/feeds/activity.ndjson?limit=25')
assert(feedNdjson.contentType.includes('application/x-ndjson'), 'Activity feed content type mismatch')
const feedLines = feedNdjson.text.split('\n').filter(Boolean)
assert(feedLines.length > 0 && feedLines.length <= 25, 'Activity feed row count is outside bounds')
for (const line of feedLines) JSON.parse(line)

const summary = summarizeTechnicalEvidence({
  collector: {
    status: collector.status,
    cursor: collector.cursor.last_processed_ledger,
    head: collector.cursor.latest_observed_ledger,
    lag: collector.cursor.lag_ledgers,
    consecutive_failures: collector.consecutive_failures,
  },
  snapshot: {
    id: snapshotId,
    ledger_index: vaultListResponse.json.snapshot.ledger_index,
    overview_snapshot_match: JSON.stringify(overview.json).includes(snapshotId),
    current_list_counts: {
      vaults: vaultList.length,
      loan_brokers: brokerList.length,
      loans: loanList.length,
    },
  },
  relationships: {
    loan_id: loan.id,
    loan_broker_id: broker.id,
    vault_id: vault.id,
    loan_to_broker: loanToBroker,
    broker_to_vault: brokerToVault,
  },
  currentHistory: {
    loan_id: lifecycleCurrentLoan.id,
    object_history_rows: objectHistoryRows.length,
  },
  lifecycle: {
    current_loan_rows: currentLoanLifecycleRows.length,
    explorer_rows: lifecycleExplorerRows.length,
  },
  archiveExclusion: {
    object_type: archivedObject.object_type,
    object_id: archivedObject.object_id,
    exact_archive_available: true,
    current_status: currentArchivedResponse.status,
    current_excluded: currentArchivedResponse.status === 404,
  },
  auditCollections: {
    activity_rows: activityRows.length,
    activity_success_rows: activitySuccessRows,
    activity_non_success_rows: activityNonSuccessRows,
    archived_rows: archivedRows.length,
    cover_loss_rows: coverLossRows.length,
  },
  exports: {
    json_rows: exportJsonRows.length,
    ndjson_rows: ndjsonLines.length,
    csv_rows: csvLines.length - 1,
    feed_ndjson_rows: feedLines.length,
  },
})

assert(summary.snapshot.overview_snapshot_match, 'Overview does not expose the active snapshot identity')

const markdown = renderMarkdown(summary)
await writeFile(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
await writeFile(path.join(outputDir, 'summary.md'), markdown, 'utf8')
console.log(markdown)
