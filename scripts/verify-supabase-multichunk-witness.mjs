import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'

const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
if (!/^[a-z]{20}$/.test(projectRef)) {
  throw new Error('SUPABASE_PROJECT_ID must be an exact 20-character project ref')
}
const verifierToken = process.env.XRPL_READER_VERIFY_TOKEN ?? ''
if (!/^[a-f0-9]{64}$/.test(verifierToken)) {
  throw new Error('XRPL_READER_VERIFY_TOKEN must be an exact masked 64-character hex token')
}

const executorEndpoint = `https://${projectRef}.supabase.co/functions/v1/xrpl-multichunk-witness`
const readerEndpoint = `https://${projectRef}.supabase.co/functions/v1/xrpl-multichunk-witness-reader`
const evidenceDirectory = 'supabase-remote-probe-evidence'
const sourceId = 'supabase-r4c2c-multichunk-witness'
const purpose = 'r4c2c-multichunk-witness-qualification'
const expectedCounts = {
  'validated-ledger': 1,
  'protocol-event': 8,
  'object-change': 94,
  'loan-lifecycle': 1,
  'archived-object': 0,
  'balance-history': 2,
  'current-projection': 10,
}
const expectedChunkCounts = [40, 40, 36]

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalize(nested)]),
    )
  }
  return value
}

function canonicalJson(value) {
  return JSON.stringify(normalize(value))
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex')
}

function encodeCursorPayload(payload) {
  const json = canonicalJson(payload)
  const bytes = Buffer.from(json, 'utf8')
  return `pcr1.${bytes.toString('hex')}.${sha256Hex(bytes)}`
}

function decodeCursorPayload(cursor) {
  const parts = cursor.split('.')
  if (parts.length !== 3 || parts[0] !== 'pcr1') throw new Error('unexpected cursor envelope')
  return JSON.parse(Buffer.from(parts[1], 'hex').toString('utf8'))
}

function headers() {
  return {
    'content-type': 'application/json',
    'x-xrpl-reader-purpose': purpose,
    'x-xrpl-reader-token': verifierToken,
  }
}

async function requestExecutor() {
  const response = await fetch(executorEndpoint, {
    method: 'POST',
    headers: headers(),
    body: '{}',
    signal: AbortSignal.timeout(120_000),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`multi-chunk executor failed (${response.status}): ${text.slice(0, 1_000)}`)
  }
  return JSON.parse(text)
}

async function requestReaderRaw(body, customHeaders = headers()) {
  const response = await fetch(readerEndpoint, {
    method: 'POST',
    headers: customHeaders,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  const text = await response.text()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = { raw: text.slice(0, 1_000) }
  }
  return { status: response.status, ok: response.ok, body: parsed }
}

async function requestReader(body) {
  const result = await requestReaderRaw(body)
  if (!result.ok) {
    throw new Error(
      `multi-chunk reader failed (${result.status}): ${JSON.stringify(result.body).slice(0, 1_000)}`,
    )
  }
  return result.body
}

function pageRequest({
  kind,
  semanticClass = null,
  startLedgerIndex = null,
  endLedgerIndex = null,
  relationshipId = null,
  order = 'asc',
  limit = 40,
  cursor = null,
}) {
  return {
    kind,
    sourceId,
    semanticClass,
    startLedgerIndex,
    endLedgerIndex,
    relationshipId,
    order,
    limit,
    cursor,
  }
}

function rowIdentity(row) {
  return `${row.sourceLedgerIndex}\u0000${row.semanticClass}\u0000${row.canonicalKey}\u0000${row.workId}`
}

function assertRows(rows, order, expectedWorkId) {
  if (!Array.isArray(rows)) throw new Error('reader rows are not an array')
  const identities = rows.map(rowIdentity)
  const expected = [...identities].sort((left, right) => left.localeCompare(right))
  if (order === 'desc') expected.reverse()
  if (canonicalJson(identities) !== canonicalJson(expected)) {
    throw new Error(`reader rows are not in ${order} canonical order`)
  }
  for (const row of rows) {
    if (row.workId !== expectedWorkId || row.sourceLedgerIndex !== 2_776_760) {
      throw new Error('reader exposed a row outside the fixed multi-chunk work')
    }
    const relationships = [...new Set(row.relationshipIds)].sort((left, right) =>
      left.localeCompare(right),
    )
    if (canonicalJson(relationships) !== canonicalJson(row.relationshipIds)) {
      throw new Error(`reader exposed non-canonical relationships: ${row.canonicalKey}`)
    }
    if (row.valueJson !== null && canonicalJson(JSON.parse(row.valueJson)) !== row.valueJson) {
      throw new Error(`reader exposed non-canonical valueJson: ${row.canonicalKey}`)
    }
  }
}

async function readAll(request, expectedWorkId) {
  const rows = []
  const pageSizes = []
  let cursor = null
  let fence = null
  for (let page = 0; page < 10; page += 1) {
    const result = await requestReader({ ...request, cursor })
    if (result.source?.sourceId !== sourceId) throw new Error('reader source changed')
    if (fence === null) fence = result.fence
    else if (canonicalJson(fence) !== canonicalJson(result.fence)) {
      throw new Error('cursor continuation changed the immutable fence')
    }
    assertRows(result.rows, request.order, expectedWorkId)
    pageSizes.push(result.rows.length)
    rows.push(...result.rows)
    if (result.nextCursor === null) return { fence, rows, pageSizes }
    if (typeof result.nextCursor !== 'string') throw new Error('reader returned an invalid next cursor')
    cursor = result.nextCursor
  }
  throw new Error('reader pagination exceeded the bounded page count')
}

async function expectError(body, expectedStatus, expectedCode, customHeaders = headers()) {
  const result = await requestReaderRaw(body, customHeaders)
  if (result.status !== expectedStatus || result.body?.code !== expectedCode) {
    throw new Error(
      `expected ${expectedStatus}/${expectedCode}, received ${result.status}/${String(result.body?.code)}`,
    )
  }
  return true
}

function verifyActiveIsolation(execution) {
  const before = execution.activeWatermarkBefore
  const after = execution.activeWatermarkAfter
  if (
    execution.activeWatermarkIsolated !== true
    || execution.activeWatermarkIsolation?.isolatedWorkExcluded !== true
    || execution.activeWatermarkIsolation?.nonRegressing !== true
    || before?.profileId !== 'supabase-devnet'
    || after?.profileId !== 'supabase-devnet'
    || before?.network !== 'devnet'
    || after?.network !== 'devnet'
    || before?.epochId !== 'supabase-r4c2c-v1'
    || after?.epochId !== 'supabase-r4c2c-v1'
    || before?.baseIdentity !== after?.baseIdentity
    || !Number.isSafeInteger(before?.ledgerIndex)
    || !Number.isSafeInteger(after?.ledgerIndex)
    || after.ledgerIndex < before.ledgerIndex
    || before.workId === execution.workId
    || after.workId === execution.workId
  ) {
    throw new Error('multi-chunk executor did not preserve active watermark isolation')
  }
  if (
    after.ledgerIndex === before.ledgerIndex
    && (after.ledgerHash !== before.ledgerHash || after.workId !== before.workId)
  ) {
    throw new Error('active watermark changed identity without advancing')
  }
}

function verifyExecutor(execution) {
  if (
    execution.profileId !== 'supabase-devnet-multichunk-witness'
    || execution.sourceLedger?.ledgerIndex !== 2_776_760
    || execution.sourceLedger?.ledgerHash !== '83CD41036ADD7F9D8FA247F04BF5156B6826D95C4E6A346B9A5499BE90C43A9D'
    || execution.work?.status !== 'committed'
    || execution.work?.expected_payload_chunks !== 3
    || execution.work?.expected_commit_chunks !== 3
    || execution.referenceRowCount !== 116
  ) {
    throw new Error('multi-chunk executor did not retain the exact committed witness')
  }
  verifyActiveIsolation(execution)
  const payloadCounts = execution.payloadChunks?.map((chunk) => chunk.record_count)
  const commitCounts = execution.commitChunks?.map((chunk) => chunk.row_mutation_count)
  if (
    canonicalJson(payloadCounts) !== canonicalJson(expectedChunkCounts)
    || canonicalJson(commitCounts) !== canonicalJson(expectedChunkCounts)
    || canonicalJson(execution.semanticCounts) !== canonicalJson(expectedCounts)
  ) {
    throw new Error('multi-chunk executor chunk or semantic counts changed')
  }
  if (execution.phaseSequence?.length > 0) {
    const phases = execution.phaseSequence.map((phase) =>
      phase.phase === 'commit' ? `commit:${phase.chunkIndex}` : phase.phase,
    )
    if (canonicalJson(phases) !== canonicalJson(['scan', 'commit:0', 'commit:1', 'commit:2', 'finalize'])) {
      throw new Error(`multi-chunk phase sequence changed: ${phases.join(',')}`)
    }
    if (execution.phaseSequence.some((phase) => phase.attemptCount !== 1)) {
      throw new Error('multi-chunk first-run phase did not complete on attempt 1')
    }
  }
}

async function verify() {
  await mkdir(evidenceDirectory, { recursive: true })
  const execution = await requestExecutor()
  verifyExecutor(execution)

  const fenceResult = await requestReader({ kind: 'fence', sourceId })
  const fence = fenceResult.fence
  if (
    fence?.epochId !== 'supabase-r4c2c-v1'
    || fence?.baseIdentity !== 'multichunk-witness-2776760'
    || fence?.ledgerIndex !== 2_776_760
    || fence?.ledgerHash !== '83CD41036ADD7F9D8FA247F04BF5156B6826D95C4E6A346B9A5499BE90C43A9D'
    || fence?.workId !== execution.workId
  ) {
    throw new Error('multi-chunk reader fence is not the committed witness work')
  }

  const full = await readAll(
    pageRequest({
      kind: 'ledger_range',
      startLedgerIndex: 2_776_760,
      endLedgerIndex: 2_776_760,
      limit: 40,
    }),
    execution.workId,
  )
  if (
    full.rows.length !== 116
    || canonicalJson(full.pageSizes) !== canonicalJson(expectedChunkCounts)
    || canonicalJson(full.fence) !== canonicalJson(fence)
  ) {
    throw new Error(
      `multi-chunk reader continuation mismatch: ${full.rows.length}/${full.pageSizes}`,
    )
  }

  const classCounts = {}
  for (const [semanticClass, expectedCount] of Object.entries(expectedCounts)) {
    const result = await readAll(
      pageRequest({ kind: 'semantic', semanticClass, limit: 40 }),
      execution.workId,
    )
    classCounts[semanticClass] = result.rows.length
    if (result.rows.length !== expectedCount) {
      throw new Error(`multi-chunk ${semanticClass} count mismatch: ${result.rows.length}/${expectedCount}`)
    }
  }

  const exact = await requestReader({
    kind: 'exact',
    sourceId,
    semanticClass: 'loan-lifecycle',
    canonicalKey: 'lifecycle:7E1926826398D1AFB71B385CE2D40E0E0D80FCF11074AD90524CCB06D067BFF2:C3011CC8854440863E80DB1853EE06461E49BEB3A6C1BD680A96642AB3C6A1FC:created',
  })
  if (
    exact.row?.workId !== execution.workId
    || exact.row?.semanticClass !== 'loan-lifecycle'
    || exact.row?.sourceLedgerIndex !== 2_776_760
  ) {
    throw new Error('multi-chunk exact lookup did not match the committed work')
  }

  const cursorSeed = await requestReader(
    pageRequest({
      kind: 'ledger_range',
      startLedgerIndex: 2_776_760,
      endLedgerIndex: 2_776_760,
      limit: 40,
    }),
  )
  if (typeof cursorSeed.nextCursor !== 'string') throw new Error('multi-chunk cursor seed is unavailable')
  const cursor = cursorSeed.nextCursor
  const tampered = `${cursor.slice(0, -1)}${cursor.endsWith('0') ? '1' : '0'}`
  const cursorDigestTamperRejected = await expectError(
    pageRequest({
      kind: 'ledger_range',
      startLedgerIndex: 2_776_760,
      endLedgerIndex: 2_776_760,
      limit: 40,
      cursor: tampered,
    }),
    400,
    'invalid_cursor',
  )
  const cursorQueryOrderMismatchRejected = await expectError(
    pageRequest({
      kind: 'ledger_range',
      startLedgerIndex: 2_776_760,
      endLedgerIndex: 2_776_760,
      order: 'desc',
      limit: 40,
      cursor,
    }),
    400,
    'invalid_cursor',
  )
  const decoded = decodeCursorPayload(cursor)
  const sourceMismatchCursor = encodeCursorPayload({ ...decoded, sourceId: 'another-source' })
  const cursorSourceMismatchRejected = await expectError(
    pageRequest({
      kind: 'ledger_range',
      startLedgerIndex: 2_776_760,
      endLedgerIndex: 2_776_760,
      limit: 40,
      cursor: sourceMismatchCursor,
    }),
    400,
    'invalid_cursor',
  )
  const staleCursor = encodeCursorPayload({
    ...decoded,
    fence: { ...decoded.fence, ledgerHash: '0'.repeat(64) },
  })
  const staleFenceRejected = await expectError(
    pageRequest({
      kind: 'ledger_range',
      startLedgerIndex: 2_776_760,
      endLedgerIndex: 2_776_760,
      limit: 40,
      cursor: staleCursor,
    }),
    409,
    'stale_cursor',
  )

  const missingToken = await requestReaderRaw(
    { kind: 'fence', sourceId },
    {
      'content-type': 'application/json',
      'x-xrpl-reader-purpose': purpose,
    },
  )
  if (missingToken.status !== 401) throw new Error('multi-chunk reader accepted a missing token')
  const wrongPurpose = await requestReaderRaw(
    { kind: 'fence', sourceId },
    {
      'content-type': 'application/json',
      'x-xrpl-reader-purpose': 'wrong-purpose',
      'x-xrpl-reader-token': verifierToken,
    },
  )
  if (wrongPurpose.status !== 403) throw new Error('multi-chunk reader accepted the wrong purpose')

  const evidence = {
    schemaVersion: 1,
    purpose: 'r4c2c-multichunk-witness-remote-verification',
    verifiedAt: new Date().toISOString(),
    sourceId,
    profileId: execution.profileId,
    sourceLedger: execution.sourceLedger,
    workId: execution.workId,
    fence,
    phaseSequence: execution.phaseSequence,
    payloadChunks: execution.payloadChunks,
    commitChunks: execution.commitChunks,
    fullPagination: {
      rowCount: full.rows.length,
      pageSizes: full.pageSizes,
      uniqueRows: new Set(full.rows.map(rowIdentity)).size,
    },
    classCounts,
    exact: {
      semanticClass: exact.row.semanticClass,
      canonicalKey: exact.row.canonicalKey,
      sourceLedgerIndex: exact.row.sourceLedgerIndex,
    },
    checks: {
      standardPhaseTables: true,
      threePayloadChunks: true,
      threeCommitChunks: true,
      exactCommitOrder: true,
      immutableFenceContinuation: true,
      deterministicOrdering: true,
      cursorDigestTamperRejected,
      cursorQueryOrderMismatchRejected,
      cursorSourceMismatchRejected,
      staleFenceRejected,
      missingTokenRejected: true,
      wrongPurposeRejected: true,
      activeWatermarkIsolated: execution.activeWatermarkIsolated,
      boundedLimit: 100,
    },
    activeWatermarkIsolation: execution.activeWatermarkIsolation,
    activeWatermarkBefore: execution.activeWatermarkBefore,
    activeWatermarkAfter: execution.activeWatermarkAfter,
  }
  await writeFile(
    `${evidenceDirectory}/verified-multichunk-witness.json`,
    `${JSON.stringify(evidence, null, 2)}\n`,
  )
  console.log(JSON.stringify(evidence))
}

try {
  await verify()
} catch (error) {
  await mkdir(evidenceDirectory, { recursive: true })
  const failure = {
    schemaVersion: 1,
    purpose: 'r4c2c-multichunk-witness-remote-verification',
    failedAt: new Date().toISOString(),
    reason: error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000),
  }
  await writeFile(
    `${evidenceDirectory}/failed-multichunk-witness-verification.json`,
    `${JSON.stringify(failure, null, 2)}\n`,
  )
  throw error
}
