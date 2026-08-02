import { canonicalPortableJson } from '../../../src/shared/portable-collector-reference-store'

const SOURCE_ID = 'supabase-r4c2c-historical-witness'
const EPOCH_ID = 'supabase-r4c2c-historical-witness-v1'
const PURPOSE = 'r4c2c-historical-witness-qualification'
const VERIFY_TOKEN_HEADER = 'x-xrpl-reader-token'
const PURPOSE_HEADER = 'x-xrpl-reader-purpose'
const CURSOR_PREFIX = 'pcr1'
const MAX_CURSOR_BYTES = 16_000
const MAX_LIMIT = 100

type Json = Record<string, unknown>
type Code = 'invalid_query' | 'invalid_cursor' | 'stale_cursor' | 'integrity_failure' | 'unavailable'
type SemanticClass =
  | 'validated-ledger'
  | 'protocol-event'
  | 'object-change'
  | 'loan-lifecycle'
  | 'archived-object'
  | 'balance-history'
  | 'current-projection'
type Order = 'asc' | 'desc'
type PageKind = 'semantic' | 'ledger_range' | 'relationship'
type Fence = {
  schemaVersion: 1
  network: 'devnet'
  epochId: string
  baseIdentity: string
  ledgerIndex: number
  ledgerHash: string
  workId: string
}
type Query = {
  schemaVersion: 1
  kind: PageKind
  semanticClass: SemanticClass | null
  startLedgerIndex: number | null
  endLedgerIndex: number | null
  relationshipId: string | null
  order: Order
}
type Cursor = {
  schemaVersion: 1
  sourceId: string
  fence: Fence
  query: Query
  offset: number
}
type Row = {
  workId: string
  semanticClass: SemanticClass
  canonicalKey: string
  sourceLedgerIndex: number
  sourceLedgerHash: string
  sourceTransactionHash: string | null
  objectId: string | null
  relationshipIds: string[]
  valueJson: string | null
  isTombstone: boolean
  createdAt: string
}

const CLASSES = new Set<SemanticClass>([
  'validated-ledger',
  'protocol-event',
  'object-change',
  'loan-lifecycle',
  'archived-object',
  'balance-history',
  'current-projection',
])

class ReaderError extends Error {
  constructor(readonly code: Code, message: string) {
    super(message)
    this.name = 'ReaderError'
  }
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function env(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function serviceKey(): string {
  const packed = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (packed) {
    const parsed = JSON.parse(packed) as Record<string, string>
    if (parsed.default) return parsed.default
  }
  return env('SUPABASE_SERVICE_ROLE_KEY')
}

function adminHeaders(key: string): HeadersInit {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
  }
}

function object(value: unknown, code: Code, name: string): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReaderError(code, `${name} must be an object`)
  }
  return value as Json
}

function exactKeys(value: Json, expected: readonly string[], code: Code, name: string): void {
  const actual = Object.keys(value).sort()
  const required = [...expected].sort()
  if (
    actual.length !== required.length ||
    actual.some((key, index) => key !== required[index])
  ) {
    throw new ReaderError(code, `${name} contains unexpected or missing fields`)
  }
}

function text(value: unknown, code: Code, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ReaderError(code, `${name} must be a non-empty string`)
  }
  return value.trim()
}

function integer(value: unknown, code: Code, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ReaderError(code, `${name} must be a non-negative safe integer`)
  }
  return value
}

function semantic(value: unknown, code: Code): SemanticClass {
  const result = text(value, code, 'semanticClass') as SemanticClass
  if (!CLASSES.has(result)) throw new ReaderError(code, `unknown semantic class: ${result}`)
  return result
}

function hash(value: unknown, code: Code, name: string): string {
  const result = text(value, code, name).toUpperCase()
  if (!/^[A-F0-9]{64}$/u.test(result)) {
    throw new ReaderError(code, `${name} is not canonical`)
  }
  return result
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(value: string): Uint8Array {
  if (!value || value.length % 2 !== 0 || !/^[0-9a-f]+$/u.test(value)) {
    throw new ReaderError('invalid_cursor', 'cursor payload is not valid hex')
  }
  return Uint8Array.from(
    { length: value.length / 2 },
    (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  )
}

async function digest(bytes: Uint8Array): Promise<string> {
  const input = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(input).set(bytes)
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', input)))
}

function parseFence(value: unknown, code: Code): Fence {
  const raw = object(value, code, 'fence')
  exactKeys(
    raw,
    ['schemaVersion', 'network', 'epochId', 'baseIdentity', 'ledgerIndex', 'ledgerHash', 'workId'],
    code,
    'fence',
  )
  if (raw.schemaVersion !== 1 || raw.network !== 'devnet' || raw.epochId !== EPOCH_ID) {
    throw new ReaderError(code, 'fence source identity is invalid')
  }
  const ledgerIndex = integer(raw.ledgerIndex, code, 'ledgerIndex')
  if (ledgerIndex !== 3_127_240) throw new ReaderError(code, 'historical fence ledger is invalid')
  return {
    schemaVersion: 1,
    network: 'devnet',
    epochId: EPOCH_ID,
    baseIdentity: text(raw.baseIdentity, code, 'baseIdentity'),
    ledgerIndex,
    ledgerHash: hash(raw.ledgerHash, code, 'ledgerHash'),
    workId: text(raw.workId, code, 'workId'),
  }
}

function parseQuery(value: unknown): Query {
  const raw = object(value, 'invalid_cursor', 'cursor query')
  exactKeys(
    raw,
    [
      'schemaVersion',
      'kind',
      'semanticClass',
      'startLedgerIndex',
      'endLedgerIndex',
      'relationshipId',
      'order',
    ],
    'invalid_cursor',
    'cursor query',
  )
  if (
    raw.schemaVersion !== 1 ||
    !['semantic', 'ledger_range', 'relationship'].includes(String(raw.kind)) ||
    !['asc', 'desc'].includes(String(raw.order))
  ) {
    throw new ReaderError('invalid_cursor', 'cursor query identity is invalid')
  }
  return {
    schemaVersion: 1,
    kind: raw.kind as PageKind,
    semanticClass:
      raw.semanticClass === null ? null : semantic(raw.semanticClass, 'invalid_cursor'),
    startLedgerIndex:
      raw.startLedgerIndex === null
        ? null
        : integer(raw.startLedgerIndex, 'invalid_cursor', 'startLedgerIndex'),
    endLedgerIndex:
      raw.endLedgerIndex === null
        ? null
        : integer(raw.endLedgerIndex, 'invalid_cursor', 'endLedgerIndex'),
    relationshipId:
      raw.relationshipId === null
        ? null
        : text(raw.relationshipId, 'invalid_cursor', 'relationshipId'),
    order: raw.order as Order,
  }
}

async function encodeCursor(value: Cursor): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalPortableJson(value))
  if (bytes.byteLength > MAX_CURSOR_BYTES) {
    throw new ReaderError('invalid_cursor', 'cursor payload exceeds limit')
  }
  return `${CURSOR_PREFIX}.${bytesToHex(bytes)}.${await digest(bytes)}`
}

async function decodeCursor(value: unknown): Promise<Cursor> {
  const parts = text(value, 'invalid_cursor', 'cursor').split('.')
  if (parts.length !== 3 || parts[0] !== CURSOR_PREFIX) {
    throw new ReaderError('invalid_cursor', 'cursor envelope is invalid')
  }
  const bytes = hexToBytes(parts[1] ?? '')
  if (
    bytes.byteLength > MAX_CURSOR_BYTES ||
    (await digest(bytes)) !== parts[2]
  ) {
    throw new ReaderError('invalid_cursor', 'cursor digest mismatch')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new ReaderError('invalid_cursor', 'cursor payload is not valid JSON')
  }
  const raw = object(parsed, 'invalid_cursor', 'cursor')
  exactKeys(raw, ['schemaVersion', 'sourceId', 'fence', 'query', 'offset'], 'invalid_cursor', 'cursor')
  if (raw.schemaVersion !== 1) throw new ReaderError('invalid_cursor', 'cursor schema is invalid')
  return {
    schemaVersion: 1,
    sourceId: text(raw.sourceId, 'invalid_cursor', 'sourceId'),
    fence: parseFence(raw.fence, 'invalid_cursor'),
    query: parseQuery(raw.query),
    offset: integer(raw.offset, 'invalid_cursor', 'offset'),
  }
}

function parseRow(value: unknown, at: Fence): Row {
  const raw = object(value, 'integrity_failure', 'row')
  const sourceLedgerIndex = integer(raw.sourceLedgerIndex, 'integrity_failure', 'sourceLedgerIndex')
  if (![2_776_760, 2_980_845, 3_127_240].includes(sourceLedgerIndex)) {
    throw new ReaderError('integrity_failure', 'row is outside the fixed historical witness set')
  }
  if (sourceLedgerIndex > at.ledgerIndex) {
    throw new ReaderError('integrity_failure', 'row exceeds its fence')
  }
  if (!Array.isArray(raw.relationshipIds) || raw.relationshipIds.some((entry) => typeof entry !== 'string')) {
    throw new ReaderError('integrity_failure', 'relationshipIds must be a string array')
  }
  const relationships = raw.relationshipIds as string[]
  const canonicalRelationships = [...new Set(relationships)].sort((left, right) =>
    left.localeCompare(right),
  )
  if (
    canonicalRelationships.some((entry) => !entry.trim()) ||
    canonicalPortableJson(canonicalRelationships) !== canonicalPortableJson(relationships)
  ) {
    throw new ReaderError('integrity_failure', 'relationshipIds are not canonical')
  }
  const valueJson = raw.valueJson === null ? null : text(raw.valueJson, 'integrity_failure', 'valueJson')
  if (valueJson !== null) {
    let parsed: unknown
    try {
      parsed = JSON.parse(valueJson)
    } catch {
      throw new ReaderError('integrity_failure', 'valueJson is not valid JSON')
    }
    if (canonicalPortableJson(parsed) !== valueJson) {
      throw new ReaderError('integrity_failure', 'valueJson is not canonical')
    }
  }
  const semanticClass = semantic(raw.semanticClass, 'integrity_failure')
  if (typeof raw.isTombstone !== 'boolean' || typeof raw.createdAt !== 'string') {
    throw new ReaderError('integrity_failure', 'row state is invalid')
  }
  if (semanticClass === 'current-projection' && raw.isTombstone && valueJson !== null) {
    throw new ReaderError('integrity_failure', 'current-projection tombstone exposes a value')
  }
  return {
    workId: text(raw.workId, 'integrity_failure', 'workId'),
    semanticClass,
    canonicalKey: text(raw.canonicalKey, 'integrity_failure', 'canonicalKey'),
    sourceLedgerIndex,
    sourceLedgerHash: hash(raw.sourceLedgerHash, 'integrity_failure', 'sourceLedgerHash'),
    sourceTransactionHash:
      raw.sourceTransactionHash === null
        ? null
        : hash(raw.sourceTransactionHash, 'integrity_failure', 'sourceTransactionHash'),
    objectId: raw.objectId === null ? null : text(raw.objectId, 'integrity_failure', 'objectId'),
    relationshipIds: canonicalRelationships,
    valueJson,
    isTombstone: raw.isTombstone,
    createdAt: raw.createdAt,
  }
}

function compareRows(left: Row, right: Row, order: Order): number {
  const result =
    left.sourceLedgerIndex - right.sourceLedgerIndex ||
    left.semanticClass.localeCompare(right.semanticClass) ||
    left.canonicalKey.localeCompare(right.canonicalKey) ||
    left.workId.localeCompare(right.workId)
  return order === 'asc' ? result : -result
}

async function rpc(
  url: string,
  key: string,
  body: Json,
): Promise<{ fence: unknown; rows: unknown; hasMore: unknown }> {
  let result: Response
  try {
    result = await fetch(`${url}/rest/v1/rpc/xrpl_read_historical_witness_page`, {
      method: 'POST',
      headers: adminHeaders(key),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    throw new ReaderError(
      'unavailable',
      `historical reader RPC failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const textBody = await result.text()
  if (!result.ok) {
    for (const code of ['stale_cursor', 'invalid_query', 'integrity_failure', 'unavailable'] as const) {
      if (textBody.includes(`${code}:`)) throw new ReaderError(code, textBody.slice(0, 500))
    }
    throw new ReaderError('unavailable', `historical reader RPC failed (${result.status})`)
  }
  return JSON.parse(textBody) as { fence: unknown; rows: unknown; hasMore: unknown }
}

function rpcBody(options: {
  kind: 'fence' | 'exact' | PageKind
  semanticClass: SemanticClass | null
  canonicalKey: string | null
  start: number | null
  end: number | null
  relationshipId: string | null
  order: Order
  offset: number
  limit: number
  expected: Fence | null
}): Json {
  return {
    p_kind: options.kind,
    p_semantic_class: options.semanticClass,
    p_canonical_key: options.canonicalKey,
    p_start_ledger_index: options.start,
    p_end_ledger_index: options.end,
    p_relationship_id: options.relationshipId,
    p_order: options.order,
    p_offset: options.offset,
    p_limit: options.limit,
    p_expected_epoch_id: options.expected?.epochId ?? null,
    p_expected_base_identity: options.expected?.baseIdentity ?? null,
    p_expected_ledger_index: options.expected?.ledgerIndex ?? null,
    p_expected_ledger_hash: options.expected?.ledgerHash ?? null,
    p_expected_work_id: options.expected?.workId ?? null,
  }
}

function source() {
  return {
    schemaVersion: 1,
    sourceId: SOURCE_ID,
    mode: 'portable',
    purpose: 'r4-qualification-only',
  } as const
}

function pageLimit(value: unknown): number {
  const result = value ?? 50
  if (
    typeof result !== 'number' ||
    !Number.isSafeInteger(result) ||
    result < 1 ||
    result > MAX_LIMIT
  ) {
    throw new ReaderError('invalid_query', `limit must be between 1 and ${MAX_LIMIT}`)
  }
  return result
}

function optionalInteger(value: unknown, name: string): number | null {
  return value === null ? null : integer(value, 'invalid_query', name)
}

function optionalText(value: unknown, name: string): string | null {
  return value === null ? null : text(value, 'invalid_query', name)
}

function optionalSemantic(value: unknown): SemanticClass | null {
  return value === null ? null : semantic(value, 'invalid_query')
}

function sameQuery(left: Query, right: Query): boolean {
  return canonicalPortableJson(left) === canonicalPortableJson(right)
}

function sameFence(left: Fence, right: Fence): boolean {
  return canonicalPortableJson(left) === canonicalPortableJson(right)
}

async function execute(body: Json, url: string, key: string): Promise<Json> {
  if (body.sourceId !== SOURCE_ID) {
    throw new ReaderError('invalid_query', 'reader source identity does not match')
  }
  const kind = text(body.kind, 'invalid_query', 'kind')
  if (kind === 'fence') {
    exactKeys(body, ['kind', 'sourceId'], 'invalid_query', 'fence request')
    const result = await rpc(
      url,
      key,
      rpcBody({
        kind: 'fence',
        semanticClass: null,
        canonicalKey: null,
        start: null,
        end: null,
        relationshipId: null,
        order: 'asc',
        offset: 0,
        limit: 1,
        expected: null,
      }),
    )
    return { schemaVersion: 1, source: source(), fence: parseFence(result.fence, 'integrity_failure') }
  }
  if (kind === 'exact') {
    exactKeys(body, ['kind', 'sourceId', 'semanticClass', 'canonicalKey'], 'invalid_query', 'exact request')
    const result = await rpc(
      url,
      key,
      rpcBody({
        kind: 'exact',
        semanticClass: semantic(body.semanticClass, 'invalid_query'),
        canonicalKey: text(body.canonicalKey, 'invalid_query', 'canonicalKey'),
        start: null,
        end: null,
        relationshipId: null,
        order: 'desc',
        offset: 0,
        limit: 1,
        expected: null,
      }),
    )
    const at = parseFence(result.fence, 'integrity_failure')
    if (!Array.isArray(result.rows)) throw new ReaderError('integrity_failure', 'exact rows are unavailable')
    return {
      schemaVersion: 1,
      source: source(),
      fence: at,
      row: result.rows.length === 0 ? null : parseRow(result.rows[0], at),
    }
  }
  if (!['semantic', 'ledger_range', 'relationship'].includes(kind)) {
    throw new ReaderError('invalid_query', `unknown reader kind: ${kind}`)
  }
  exactKeys(
    body,
    [
      'kind',
      'sourceId',
      'semanticClass',
      'startLedgerIndex',
      'endLedgerIndex',
      'relationshipId',
      'order',
      'limit',
      'cursor',
    ],
    'invalid_query',
    'page request',
  )
  const requested: Query = {
    schemaVersion: 1,
    kind: kind as PageKind,
    semanticClass: optionalSemantic(body.semanticClass),
    startLedgerIndex: optionalInteger(body.startLedgerIndex, 'startLedgerIndex'),
    endLedgerIndex: optionalInteger(body.endLedgerIndex, 'endLedgerIndex'),
    relationshipId: optionalText(body.relationshipId, 'relationshipId'),
    order: body.order === 'desc' ? 'desc' : body.order === 'asc' ? 'asc' : (() => {
      throw new ReaderError('invalid_query', 'order must be asc or desc')
    })(),
  }
  if (requested.kind === 'semantic' && requested.semanticClass === null) {
    throw new ReaderError('invalid_query', 'semantic lookup requires a class')
  }
  if (
    requested.kind === 'ledger_range' &&
    (
      requested.startLedgerIndex === null ||
      requested.endLedgerIndex === null ||
      requested.endLedgerIndex < requested.startLedgerIndex
    )
  ) {
    throw new ReaderError('invalid_query', 'ledger range is invalid')
  }
  if (requested.kind === 'relationship' && requested.relationshipId === null) {
    throw new ReaderError('invalid_query', 'relationship lookup requires an identity')
  }
  const limit = pageLimit(body.limit)
  let offset = 0
  let expected: Fence | null = null
  if (body.cursor !== null) {
    const cursor = await decodeCursor(body.cursor)
    if (cursor.sourceId !== SOURCE_ID) {
      throw new ReaderError('invalid_cursor', 'cursor belongs to another reader source')
    }
    if (!sameQuery(cursor.query, requested)) {
      throw new ReaderError('invalid_cursor', 'cursor query identity does not match the request')
    }
    offset = cursor.offset
    expected = cursor.fence
  }
  const result = await rpc(
    url,
    key,
    rpcBody({
      kind: requested.kind,
      semanticClass: requested.semanticClass,
      canonicalKey: null,
      start: requested.startLedgerIndex,
      end: requested.endLedgerIndex,
      relationshipId: requested.relationshipId,
      order: requested.order,
      offset,
      limit,
      expected,
    }),
  )
  const at = parseFence(result.fence, 'integrity_failure')
  if (expected !== null && !sameFence(expected, at)) {
    throw new ReaderError('stale_cursor', 'cursor read fence is no longer current')
  }
  if (!Array.isArray(result.rows) || typeof result.hasMore !== 'boolean') {
    throw new ReaderError('integrity_failure', 'page shape is invalid')
  }
  const rows = result.rows.map((entry) => parseRow(entry, at))
  for (let index = 1; index < rows.length; index += 1) {
    if (compareRows(rows[index - 1]!, rows[index]!, requested.order) >= 0) {
      throw new ReaderError('integrity_failure', 'reader rows are not deterministically ordered')
    }
  }
  const nextCursor = result.hasMore
    ? await encodeCursor({
        schemaVersion: 1,
        sourceId: SOURCE_ID,
        fence: at,
        query: requested,
        offset: offset + rows.length,
      })
    : null
  return {
    schemaVersion: 1,
    source: source(),
    fence: at,
    query: requested,
    rows,
    nextCursor,
  }
}

Deno.serve(async (request) => {
  try {
    if (request.method !== 'POST') return response({ error: 'method_not_allowed' }, 405)
    if (request.headers.get(PURPOSE_HEADER) !== PURPOSE) {
      return response({ error: 'invalid_purpose' }, 403)
    }
    const expectedToken = env('XRPL_READER_VERIFY_TOKEN')
    if (request.headers.get(VERIFY_TOKEN_HEADER) !== expectedToken) {
      return response({ error: 'unauthorized' }, 401)
    }
    const parsed = await request.json()
    return response(await execute(object(parsed, 'invalid_query', 'request'), env('SUPABASE_URL'), serviceKey()))
  } catch (error) {
    if (error instanceof ReaderError) {
      const status = error.code === 'invalid_query' || error.code === 'invalid_cursor' ? 400 : error.code === 'stale_cursor' ? 409 : 503
      return response({ schemaVersion: 1, code: error.code, error: error.message }, status)
    }
    return response(
      {
        schemaVersion: 1,
        code: 'unavailable',
        error: error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000),
      },
      503,
    )
  }
})
