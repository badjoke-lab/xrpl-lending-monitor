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

const loaderEndpoint = `https://${projectRef}.supabase.co/functions/v1/xrpl-historical-witness`
const readerEndpoint = `https://${projectRef}.supabase.co/functions/v1/xrpl-historical-witness-reader`
const evidenceDirectory = 'supabase-remote-probe-evidence'
const sourceId = 'supabase-r4c2c-historical-witness'
const purpose = 'r4c2c-historical-witness-qualification'
const expectedCounts = {
  'validated-ledger': 3,
  'protocol-event': 13,
  'object-change': 197,
  'loan-lifecycle': 3,
  'archived-object': 1,
  'balance-history': 2,
  'current-projection': 18,
}
const exactWitnesses = [
  ['validated-ledger', 'ledger:2776760'],
  ['protocol-event', 'event:29D0DC88D581400AFCF68F4B6F911503FC4AAFB8D466632E8EEFB4C8C157A14E'],
  ['object-change', 'change:29D0DC88D581400AFCF68F4B6F911503FC4AAFB8D466632E8EEFB4C8C157A14E:1:Account'],
  ['loan-lifecycle', 'lifecycle:7E1926826398D1AFB71B385CE2D40E0E0D80FCF11074AD90524CCB06D067BFF2:C3011CC8854440863E80DB1853EE06461E49BEB3A6C1BD680A96642AB3C6A1FC:created'],
  ['archived-object', 'archive:6A92B8369E0094FFBE1C7872858C30FE7F8C94B7FCAF297DD9DCB64E1C88FA82:Loan:FBD9559FBC50D3274AAD6495454E83E0FDB97DCE497D0423C1666641B2288718'],
  ['balance-history', 'balance:3A82A8A88F490BE5AFD0F72BBDC405B7D32BBF209C7E05B9A43516594E9A8D66:LoanBroker:3E4430C184C58ABE6D6B1C8C5CEAB85BCAE4DFC682A00C7639494A1FB0CB9F8B:cover_available'],
  ['current-projection', 'projection:loan:C3011CC8854440863E80DB1853EE06461E49BEB3A6C1BD680A96642AB3C6A1FC'],
]
const relationshipWitness = 'loan:FBD9559FBC50D3274AAD6495454E83E0FDB97DCE497D0423C1666641B2288718'

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

async function requestLoader() {
  const response = await fetch(loaderEndpoint, {
    method: 'POST',
    headers: headers(),
    body: '{}',
    signal: AbortSignal.timeout(90_000),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`historical loader failed (${response.status}): ${text.slice(0, 1_000)}`)
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
    throw new Error(`historical reader failed (${result.status}): ${JSON.stringify(result.body).slice(0, 1_000)}`)
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
  limit = 100,
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

function assertRows(rows, order) {
  if (!Array.isArray(rows)) throw new Error('reader rows are not an array')
  const identities = rows.map(rowIdentity)
  const expected = [...identities].sort((left, right) => left.localeCompare(right))
  if (order === 'desc') expected.reverse()
  if (canonicalJson(identities) !== canonicalJson(expected)) {
    throw new Error(`reader rows are not in ${order} canonical order`)
  }
  for (const row of rows) {
    if (![2_776_760, 2_980_845, 3_127_240].includes(row.sourceLedgerIndex)) {
      throw new Error(`reader exposed an unexpected ledger: ${row.sourceLedgerIndex}`)
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

async function readAll(request) {
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
    assertRows(result.rows, request.order)
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

async function verify() {
  await mkdir(evidenceDirectory, { recursive: true })
  const firstLoad = await requestLoader()
  if (
    firstLoad.recordCount !== 237 ||
    canonicalJson(firstLoad.semanticCounts) !== canonicalJson(expectedCounts) ||
    firstLoad.commit?.committed !== true
  ) {
    throw new Error('historical loader did not commit the exact 237-row witness')
  }
  const secondLoad = await requestLoader()
  if (secondLoad.commit?.committed !== true || secondLoad.commit?.duplicate !== true) {
    throw new Error('historical loader duplicate commit did not converge')
  }
  if (firstLoad.recordsDigest !== secondLoad.recordsDigest) {
    throw new Error('historical loader digest changed across duplicate execution')
  }

  const fenceResult = await requestReader({ kind: 'fence', sourceId })
  const fence = fenceResult.fence
  if (
    fence?.epochId !== 'supabase-r4c2c-historical-witness-v1' ||
    fence?.baseIdentity !== 'historical-witness-2776760-2980845-3127240' ||
    fence?.ledgerIndex !== 3_127_240 ||
    fence?.ledgerHash !== '6CDB77504546BE14D226CFFDFC61082EC73BF95191E5326536254903D87692B3'
  ) {
    throw new Error('historical reader fence is not the fixed witness fence')
  }

  const full = await readAll(
    pageRequest({
      kind: 'ledger_range',
      startLedgerIndex: 2_776_760,
      endLedgerIndex: 3_127_240,
      limit: 100,
    }),
  )
  if (full.rows.length !== 237 || canonicalJson(full.pageSizes) !== canonicalJson([100, 100, 37])) {
    throw new Error(`historical reader full pagination mismatch: ${full.rows.length}/${full.pageSizes}`)
  }
  if (canonicalJson(full.fence) !== canonicalJson(fence)) {
    throw new Error('historical full read fence differs from the fence endpoint')
  }

  const classCounts = {}
  for (const [semanticClass, expectedCount] of Object.entries(expectedCounts)) {
    const result = await readAll(
      pageRequest({ kind: 'semantic', semanticClass, limit: 100 }),
    )
    classCounts[semanticClass] = result.rows.length
    if (result.rows.length !== expectedCount) {
      throw new Error(`historical ${semanticClass} count mismatch: ${result.rows.length}/${expectedCount}`)
    }
  }

  const exactResults = []
  for (const [semanticClass, canonicalKey] of exactWitnesses) {
    const result = await requestReader({
      kind: 'exact',
      sourceId,
      semanticClass,
      canonicalKey,
    })
    if (result.row?.semanticClass !== semanticClass || result.row?.canonicalKey !== canonicalKey) {
      throw new Error(`historical exact lookup mismatch: ${semanticClass}/${canonicalKey}`)
    }
    exactResults.push({ semanticClass, canonicalKey, sourceLedgerIndex: result.row.sourceLedgerIndex })
  }

  const relationship = await readAll(
    pageRequest({ kind: 'relationship', relationshipId: relationshipWitness, limit: 100 }),
  )
  if (relationship.rows.length < 3) {
    throw new Error(`historical relationship witness is too small: ${relationship.rows.length}`)
  }
  if (relationship.rows.some((row) => !row.relationshipIds.includes(relationshipWitness))) {
    throw new Error('historical relationship query returned an unrelated row')
  }
  for (const semanticClass of ['loan-lifecycle', 'archived-object', 'current-projection']) {
    if (!relationship.rows.some((row) => row.semanticClass === semanticClass)) {
      throw new Error(`historical relationship query omitted ${semanticClass}`)
    }
  }

  const cursorSeed = await requestReader(
    pageRequest({ kind: 'semantic', semanticClass: 'object-change', limit: 2 }),
  )
  if (typeof cursorSeed.nextCursor !== 'string') throw new Error('historical cursor seed is unavailable')
  const cursor = cursorSeed.nextCursor
  const tampered = `${cursor.slice(0, -1)}${cursor.endsWith('0') ? '1' : '0'}`
  const cursorDigestTamperRejected = await expectError(
    pageRequest({ kind: 'semantic', semanticClass: 'object-change', limit: 2, cursor: tampered }),
    400,
    'invalid_cursor',
  )
  const cursorQueryOrderMismatchRejected = await expectError(
    pageRequest({
      kind: 'semantic',
      semanticClass: 'object-change',
      order: 'desc',
      limit: 2,
      cursor,
    }),
    400,
    'invalid_cursor',
  )
  const decoded = decodeCursorPayload(cursor)
  const sourceMismatchCursor = encodeCursorPayload({ ...decoded, sourceId: 'another-reader-source' })
  const cursorSourceMismatchRejected = await expectError(
    pageRequest({
      kind: 'semantic',
      semanticClass: 'object-change',
      limit: 2,
      cursor: sourceMismatchCursor,
    }),
    400,
    'invalid_cursor',
  )
  const staleCursor = encodeCursorPayload({
    ...decoded,
    fence: {
      ...decoded.fence,
      ledgerHash: '0'.repeat(64),
    },
  })
  const staleFenceRejected = await expectError(
    pageRequest({
      kind: 'semantic',
      semanticClass: 'object-change',
      limit: 2,
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
  if (missingToken.status !== 401) throw new Error('historical reader accepted a missing verifier token')
  const wrongPurpose = await requestReaderRaw(
    { kind: 'fence', sourceId },
    {
      'content-type': 'application/json',
      'x-xrpl-reader-purpose': 'wrong-purpose',
      'x-xrpl-reader-token': verifierToken,
    },
  )
  if (wrongPurpose.status !== 403) throw new Error('historical reader accepted the wrong purpose')

  const evidence = {
    schemaVersion: 1,
    purpose: 'r4c2c-historical-witness-remote-verification',
    verifiedAt: new Date().toISOString(),
    sourceId,
    loader: {
      profileId: firstLoad.profileId,
      epochId: firstLoad.epochId,
      baseIdentity: firstLoad.baseIdentity,
      setId: firstLoad.setId,
      recordCount: firstLoad.recordCount,
      semanticCounts: firstLoad.semanticCounts,
      recordsDigest: firstLoad.recordsDigest,
      firstCommitDuplicate: firstLoad.commit?.duplicate ?? null,
      secondCommitDuplicate: secondLoad.commit?.duplicate ?? null,
    },
    fence,
    fullPagination: {
      rowCount: full.rows.length,
      pageSizes: full.pageSizes,
      uniqueRows: new Set(full.rows.map(rowIdentity)).size,
    },
    classCounts,
    exactResults,
    relationship: {
      relationshipId: relationshipWitness,
      rowCount: relationship.rows.length,
      semanticClasses: [...new Set(relationship.rows.map((row) => row.semanticClass))].sort(),
    },
    rejectionChecks: {
      cursorDigestTamperRejected,
      cursorQueryOrderMismatchRejected,
      cursorSourceMismatchRejected,
      staleFenceRejected,
      missingTokenRejected: true,
      wrongPurposeRejected: true,
    },
  }
  await writeFile(
    `${evidenceDirectory}/verified-historical-witness.json`,
    `${JSON.stringify(evidence, null, 2)}\n`,
  )
  return evidence
}

verify()
  .then((evidence) => {
    console.log(JSON.stringify({
      verified: true,
      recordCount: evidence.fullPagination.rowCount,
      pageSizes: evidence.fullPagination.pageSizes,
      classCounts: evidence.classCounts,
      relationshipRows: evidence.relationship.rowCount,
    }))
  })
  .catch(async (error) => {
    await mkdir(evidenceDirectory, { recursive: true })
    const failure = {
      schemaVersion: 1,
      purpose: 'r4c2c-historical-witness-remote-verification',
      failedAt: new Date().toISOString(),
      reason: error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000),
    }
    await writeFile(
      `${evidenceDirectory}/failed-historical-witness-verification.json`,
      `${JSON.stringify(failure, null, 2)}\n`,
    )
    console.error(failure.reason)
    process.exitCode = 1
  })
