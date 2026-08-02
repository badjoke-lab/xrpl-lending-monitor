import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'

const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
if (!/^[a-z]{20}$/.test(projectRef)) {
  throw new Error('SUPABASE_PROJECT_ID must be an exact 20-character project ref')
}

const endpoint = `https://${projectRef}.supabase.co/functions/v1/xrpl-committed-reader`
const evidenceDirectory = 'supabase-remote-probe-evidence'
const sourceId = 'supabase-r4c2c-qualification'
const phaseEpochId = 'supabase-r4c2c-v1'
const maximumAttempts = 12
const delayMilliseconds = 10_000

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
  const hex = Buffer.from(json, 'utf8').toString('hex')
  return `pcr1.${hex}.${sha256Hex(Buffer.from(json, 'utf8'))}`
}

function decodeCursorPayload(cursor) {
  const parts = cursor.split('.')
  if (parts.length !== 3 || parts[0] !== 'pcr1') throw new Error('unexpected cursor envelope')
  return JSON.parse(Buffer.from(parts[1], 'hex').toString('utf8'))
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function pageRequest({ order = 'asc', cursor = null, limit = 1 } = {}) {
  return {
    kind: 'semantic',
    sourceId,
    semanticClass: 'validated-ledger',
    startLedgerIndex: null,
    endLedgerIndex: null,
    relationshipId: null,
    order,
    limit,
    cursor,
  }
}

async function requestReader(body) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-xrpl-reader-purpose': 'r4c2c-qualification',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  const text = await response.text()
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`reader returned non-JSON status ${response.status}: ${text.slice(0, 300)}`)
  }
  return { status: response.status, payload }
}

function requireSuccess(result, context) {
  if (result.status !== 200 || result.payload?.ok !== true) {
    throw new Error(
      `${context} failed (${result.status}): ${String(result.payload?.code ?? result.payload?.error ?? 'unknown')}`,
    )
  }
  return result.payload
}

async function requireRejection(body, expectedCode) {
  const result = await requestReader(body)
  if (result.payload?.ok !== false || result.payload?.code !== expectedCode) {
    throw new Error(
      `expected ${expectedCode}, received ${result.status}/${String(result.payload?.code ?? 'unknown')}`,
    )
  }
  return result.status
}

function isLedgerHash(value) {
  return typeof value === 'string' && /^[A-F0-9]{64}$/.test(value)
}

function validateSourceAndFence(payload) {
  if (payload?.profileId !== 'supabase-devnet') throw new Error('reader profile mismatch')
  if (payload?.source?.sourceId !== sourceId) throw new Error('reader source mismatch')
  if (payload?.source?.mode !== 'portable') throw new Error('reader mode mismatch')
  if (payload?.source?.purpose !== 'r4-qualification-only') {
    throw new Error('reader purpose boundary mismatch')
  }
  const fence = payload?.fence
  if (
    fence?.schemaVersion !== 1 ||
    fence?.network !== 'devnet' ||
    fence?.epochId !== phaseEpochId ||
    typeof fence?.baseIdentity !== 'string' ||
    fence.baseIdentity.length === 0 ||
    !Number.isSafeInteger(fence?.ledgerIndex) ||
    fence.ledgerIndex <= 0 ||
    !isLedgerHash(fence?.ledgerHash) ||
    typeof fence?.workId !== 'string' ||
    fence.workId.length === 0
  ) {
    throw new Error('reader fence is invalid')
  }
  return fence
}

function validateRow(row, fence) {
  if (
    row?.semanticClass !== 'validated-ledger' ||
    typeof row?.workId !== 'string' ||
    typeof row?.canonicalKey !== 'string' ||
    !Number.isSafeInteger(row?.sourceLedgerIndex) ||
    row.sourceLedgerIndex <= 0 ||
    row.sourceLedgerIndex > fence.ledgerIndex ||
    !isLedgerHash(row?.sourceLedgerHash) ||
    row?.sourceTransactionHash !== null ||
    row?.objectId !== null ||
    !Array.isArray(row?.relationshipIds) ||
    typeof row?.valueJson !== 'string' ||
    row?.isTombstone !== false ||
    typeof row?.createdAt !== 'string'
  ) {
    throw new Error('validated-ledger reader row is invalid')
  }
  if (canonicalJson([...new Set(row.relationshipIds)].sort()) !== canonicalJson(row.relationshipIds)) {
    throw new Error('reader relationships are not canonical')
  }
  const value = JSON.parse(row.valueJson)
  if (canonicalJson(value) !== row.valueJson) throw new Error('reader value is not canonical')
  return row
}

async function verifyReader() {
  const fencePayload = requireSuccess(
    await requestReader({ kind: 'fence', sourceId }),
    'fence read',
  )
  validateSourceAndFence(fencePayload)

  const firstPayload = requireSuccess(await requestReader(pageRequest()), 'first page')
  const firstFence = validateSourceAndFence(firstPayload)
  if (!Array.isArray(firstPayload.rows) || firstPayload.rows.length !== 1) {
    throw new Error('first page does not contain exactly one row')
  }
  const firstRow = validateRow(firstPayload.rows[0], firstFence)
  if (typeof firstPayload.nextCursor !== 'string') {
    throw new Error('reader has fewer than two committed validated-ledger rows')
  }

  const secondResult = await requestReader(pageRequest({ cursor: firstPayload.nextCursor }))
  if (secondResult.payload?.code === 'stale_cursor') {
    throw new Error('reader fence advanced during cursor verification')
  }
  const secondPayload = requireSuccess(secondResult, 'second page')
  const secondFence = validateSourceAndFence(secondPayload)
  if (canonicalJson(secondFence) !== canonicalJson(firstFence)) {
    throw new Error('cursor continuation changed the immutable fence')
  }
  if (!Array.isArray(secondPayload.rows) || secondPayload.rows.length !== 1) {
    throw new Error('second page does not contain exactly one row')
  }
  const secondRow = validateRow(secondPayload.rows[0], secondFence)
  if (
    secondRow.sourceLedgerIndex < firstRow.sourceLedgerIndex ||
    (secondRow.sourceLedgerIndex === firstRow.sourceLedgerIndex &&
      secondRow.canonicalKey.localeCompare(firstRow.canonicalKey) <= 0)
  ) {
    throw new Error('cursor continuation is not strictly ordered')
  }

  const exactPayload = requireSuccess(
    await requestReader({
      kind: 'exact',
      sourceId,
      semanticClass: firstRow.semanticClass,
      canonicalKey: firstRow.canonicalKey,
    }),
    'exact lookup',
  )
  const exactFence = validateSourceAndFence(exactPayload)
  const exactRow = validateRow(exactPayload.row, exactFence)
  if (
    exactRow.canonicalKey !== firstRow.canonicalKey ||
    exactRow.sourceLedgerIndex !== firstRow.sourceLedgerIndex ||
    exactRow.sourceLedgerHash !== firstRow.sourceLedgerHash
  ) {
    throw new Error('exact lookup does not match the paginated row')
  }

  const rangePayload = requireSuccess(
    await requestReader({
      kind: 'ledger_range',
      sourceId,
      semanticClass: 'validated-ledger',
      startLedgerIndex: firstRow.sourceLedgerIndex,
      endLedgerIndex: secondRow.sourceLedgerIndex,
      relationshipId: null,
      order: 'asc',
      limit: 100,
      cursor: null,
    }),
    'ledger range lookup',
  )
  const rangeFence = validateSourceAndFence(rangePayload)
  if (!Array.isArray(rangePayload.rows) || rangePayload.rows.length < 2) {
    throw new Error('ledger range lookup did not return the cursor rows')
  }
  rangePayload.rows.forEach((row) => validateRow(row, rangeFence))
  const rangeKeys = new Set(rangePayload.rows.map((row) => row.canonicalKey))
  if (!rangeKeys.has(firstRow.canonicalKey) || !rangeKeys.has(secondRow.canonicalKey)) {
    throw new Error('ledger range lookup omitted a cursor row')
  }

  const tampered = `${firstPayload.nextCursor.slice(0, -1)}${
    firstPayload.nextCursor.endsWith('0') ? '1' : '0'
  }`
  const tamperStatus = await requireRejection(pageRequest({ cursor: tampered }), 'invalid_cursor')
  const queryMismatchStatus = await requireRejection(
    pageRequest({ order: 'desc', cursor: firstPayload.nextCursor }),
    'invalid_cursor',
  )

  const sourcePayload = decodeCursorPayload(firstPayload.nextCursor)
  sourcePayload.sourceId = 'other-source'
  const sourceMismatchStatus = await requireRejection(
    pageRequest({ cursor: encodeCursorPayload(sourcePayload) }),
    'invalid_cursor',
  )

  const stalePayload = decodeCursorPayload(firstPayload.nextCursor)
  stalePayload.fence = {
    ...stalePayload.fence,
    workId: `${stalePayload.fence.workId}:stale`,
  }
  const staleStatus = await requireRejection(
    pageRequest({ cursor: encodeCursorPayload(stalePayload) }),
    'stale_cursor',
  )

  return {
    schemaVersion: 1,
    verifiedAt: new Date().toISOString(),
    endpointIdentity: 'xrpl-committed-reader',
    source: firstPayload.source,
    fence: firstFence,
    firstRow: {
      workId: firstRow.workId,
      semanticClass: firstRow.semanticClass,
      canonicalKey: firstRow.canonicalKey,
      sourceLedgerIndex: firstRow.sourceLedgerIndex,
      sourceLedgerHash: firstRow.sourceLedgerHash,
    },
    secondRow: {
      workId: secondRow.workId,
      semanticClass: secondRow.semanticClass,
      canonicalKey: secondRow.canonicalKey,
      sourceLedgerIndex: secondRow.sourceLedgerIndex,
      sourceLedgerHash: secondRow.sourceLedgerHash,
    },
    checks: {
      immutableFenceContinuation: true,
      deterministicOrdering: true,
      exactLookupParity: true,
      ledgerRangeParity: true,
      cursorDigestTamperRejected: true,
      cursorQueryOrderMismatchRejected: true,
      cursorSourceMismatchRejected: true,
      staleFenceRejected: true,
      boundedLimit: 100,
      rejectionStatuses: {
        tamper: tamperStatus,
        queryMismatch: queryMismatchStatus,
        sourceMismatch: sourceMismatchStatus,
        staleFence: staleStatus,
      },
    },
  }
}

await mkdir(evidenceDirectory, { recursive: true })
let lastError = null
for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
  try {
    const evidence = await verifyReader()
    const retained = { ...evidence, attempt }
    await writeFile(
      `${evidenceDirectory}/verified-reader.json`,
      `${JSON.stringify(retained, null, 2)}\n`,
    )
    console.log(JSON.stringify(retained, null, 2))
    process.exit(0)
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error)
    if (attempt < maximumAttempts) await delay(delayMilliseconds)
  }
}

const failure = {
  schemaVersion: 1,
  failedAt: new Date().toISOString(),
  attempts: maximumAttempts,
  reason: lastError ?? 'reader verification failed without an error',
}
await writeFile(
  `${evidenceDirectory}/failed-reader-verification.json`,
  `${JSON.stringify(failure, null, 2)}\n`,
)
throw new Error(failure.reason)
