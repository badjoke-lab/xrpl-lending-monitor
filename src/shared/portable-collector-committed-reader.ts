import type { NormalizedSemanticClassV1 } from './portable-collector-payload'
import {
  canonicalPortableJson,
  type PortableCollectorWorkSnapshot,
  type PortableReferenceRow,
} from './portable-collector-reference-store'
import type { PortableCollectorStorageAdapter } from './portable-collector-adapters'

const CURSOR_PREFIX = 'pcr1'
const CURSOR_MAX_BYTES = 16_000
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

const SEMANTIC_CLASSES = new Set<NormalizedSemanticClassV1>([
  'validated-ledger',
  'protocol-event',
  'object-change',
  'loan-lifecycle',
  'archived-object',
  'balance-history',
  'current-projection',
])

export interface PortableReadFenceV1 {
  schemaVersion: 1
  network: string
  epochId: string
  baseIdentity: string
  ledgerIndex: number
  ledgerHash: string
  workId: string
}

export interface PortableReaderSourceV1 {
  schemaVersion: 1
  sourceId: string
  mode: 'portable'
}

export interface PortableCommittedReaderOptions {
  sourceId: string
  network: string
  epochId: string
  baseIdentity: string
}

export interface PortableCommittedPageV1 {
  schemaVersion: 1
  source: PortableReaderSourceV1
  fence: PortableReadFenceV1
  rows: PortableReferenceRow[]
  nextCursor: string | null
}

interface PortableReaderQueryV1 {
  schemaVersion: 1
  kind: 'semantic' | 'ledger_range' | 'relationship'
  semanticClass: NormalizedSemanticClassV1 | null
  startLedgerIndex: number | null
  endLedgerIndex: number | null
  relationshipId: string | null
  order: 'asc' | 'desc'
}

interface PortableReaderCursorV1 {
  schemaVersion: 1
  sourceId: string
  fence: PortableReadFenceV1
  query: PortableReaderQueryV1
  offset: number
}

export class PortableCommittedReaderError extends Error {
  constructor(
    readonly code:
      | 'unavailable'
      | 'integrity_failure'
      | 'invalid_query'
      | 'invalid_cursor'
      | 'stale_cursor',
    message: string,
  ) {
    super(message)
    this.name = 'PortableCommittedReaderError'
  }
}

function requireString(value: string, name: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new PortableCommittedReaderError('invalid_query', `${name} is required`)
  }
  return normalized
}

function requireSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PortableCommittedReaderError(
      'invalid_query',
      `${name} must be a non-negative safe integer`,
    )
  }
  return value
}

function requireLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_LIMIT
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new PortableCommittedReaderError(
      'invalid_query',
      `limit must be between 1 and ${MAX_LIMIT}`,
    )
  }
  return limit
}

function requireSemanticClass(value: string): NormalizedSemanticClassV1 {
  if (!SEMANTIC_CLASSES.has(value as NormalizedSemanticClassV1)) {
    throw new PortableCommittedReaderError(
      'invalid_query',
      `unknown semantic class: ${value}`,
    )
  }
  return value as NormalizedSemanticClassV1
}

function canonicalHash(value: string, name: string): string {
  const normalized = requireString(value, name).toUpperCase()
  if (!/^[0-9A-F]+$/u.test(normalized)) {
    throw new PortableCommittedReaderError(
      'integrity_failure',
      `${name} is not a canonical hexadecimal hash`,
    )
  }
  return normalized
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  name: string,
): void {
  const actual = Object.keys(value).sort()
  const required = [...expected].sort()
  if (
    actual.length !== required.length ||
    actual.some((key, index) => key !== required[index])
  ) {
    throw new PortableCommittedReaderError(
      'invalid_cursor',
      `${name} contains unexpected or missing fields`,
    )
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new PortableCommittedReaderError('invalid_cursor', 'cursor payload is not base64url')
  }
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') +
    '='.repeat((4 - (value.length % 4)) % 4)
  let binary: string
  try {
    binary = atob(padded)
  } catch {
    throw new PortableCommittedReaderError('invalid_cursor', 'cursor payload is not valid base64url')
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function parseFence(value: unknown): PortableReadFenceV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PortableCommittedReaderError('invalid_cursor', 'cursor fence must be an object')
  }
  const fence = value as Record<string, unknown>
  exactKeys(
    fence,
    [
      'schemaVersion',
      'network',
      'epochId',
      'baseIdentity',
      'ledgerIndex',
      'ledgerHash',
      'workId',
    ],
    'cursor fence',
  )
  if (fence.schemaVersion !== 1) {
    throw new PortableCommittedReaderError('invalid_cursor', 'unsupported cursor fence version')
  }
  if (
    typeof fence.network !== 'string' ||
    typeof fence.epochId !== 'string' ||
    typeof fence.baseIdentity !== 'string' ||
    typeof fence.ledgerHash !== 'string' ||
    typeof fence.workId !== 'string' ||
    typeof fence.ledgerIndex !== 'number' ||
    !Number.isSafeInteger(fence.ledgerIndex) ||
    fence.ledgerIndex < 0
  ) {
    throw new PortableCommittedReaderError('invalid_cursor', 'cursor fence fields are invalid')
  }
  return {
    schemaVersion: 1,
    network: fence.network,
    epochId: fence.epochId,
    baseIdentity: fence.baseIdentity,
    ledgerIndex: fence.ledgerIndex,
    ledgerHash: fence.ledgerHash,
    workId: fence.workId,
  }
}

function parseQuery(value: unknown): PortableReaderQueryV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PortableCommittedReaderError('invalid_cursor', 'cursor query must be an object')
  }
  const query = value as Record<string, unknown>
  exactKeys(
    query,
    [
      'schemaVersion',
      'kind',
      'semanticClass',
      'startLedgerIndex',
      'endLedgerIndex',
      'relationshipId',
      'order',
    ],
    'cursor query',
  )
  if (
    query.schemaVersion !== 1 ||
    !['semantic', 'ledger_range', 'relationship'].includes(String(query.kind)) ||
    !['asc', 'desc'].includes(String(query.order)) ||
    (query.semanticClass !== null && typeof query.semanticClass !== 'string') ||
    (query.relationshipId !== null && typeof query.relationshipId !== 'string') ||
    (query.startLedgerIndex !== null &&
      (typeof query.startLedgerIndex !== 'number' ||
        !Number.isSafeInteger(query.startLedgerIndex) ||
        query.startLedgerIndex < 0)) ||
    (query.endLedgerIndex !== null &&
      (typeof query.endLedgerIndex !== 'number' ||
        !Number.isSafeInteger(query.endLedgerIndex) ||
        query.endLedgerIndex < 0))
  ) {
    throw new PortableCommittedReaderError('invalid_cursor', 'cursor query fields are invalid')
  }
  if (
    query.semanticClass !== null &&
    !SEMANTIC_CLASSES.has(query.semanticClass as NormalizedSemanticClassV1)
  ) {
    throw new PortableCommittedReaderError('invalid_cursor', 'cursor semantic class is invalid')
  }
  return query as unknown as PortableReaderQueryV1
}

async function encodeCursor(cursor: PortableReaderCursorV1): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalPortableJson(cursor))
  if (bytes.byteLength > CURSOR_MAX_BYTES) {
    throw new PortableCommittedReaderError('invalid_cursor', 'cursor payload exceeds limit')
  }
  return `${CURSOR_PREFIX}.${bytesToBase64Url(bytes)}.${await sha256Hex(bytes)}`
}

async function decodeCursor(value: string): Promise<PortableReaderCursorV1> {
  const parts = value.split('.')
  if (parts.length !== 3 || parts[0] !== CURSOR_PREFIX) {
    throw new PortableCommittedReaderError('invalid_cursor', 'cursor envelope is invalid')
  }
  const bytes = base64UrlToBytes(parts[1] ?? '')
  if (bytes.byteLength > CURSOR_MAX_BYTES) {
    throw new PortableCommittedReaderError('invalid_cursor', 'cursor payload exceeds limit')
  }
  const digest = await sha256Hex(bytes)
  if (digest !== parts[2]) {
    throw new PortableCommittedReaderError('invalid_cursor', 'cursor digest mismatch')
  }
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new PortableCommittedReaderError('invalid_cursor', 'cursor payload is not valid JSON')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PortableCommittedReaderError('invalid_cursor', 'cursor payload must be an object')
  }
  const cursor = raw as Record<string, unknown>
  exactKeys(cursor, ['schemaVersion', 'sourceId', 'fence', 'query', 'offset'], 'cursor')
  if (
    cursor.schemaVersion !== 1 ||
    typeof cursor.sourceId !== 'string' ||
    typeof cursor.offset !== 'number' ||
    !Number.isSafeInteger(cursor.offset) ||
    cursor.offset < 0
  ) {
    throw new PortableCommittedReaderError('invalid_cursor', 'cursor fields are invalid')
  }
  return {
    schemaVersion: 1,
    sourceId: cursor.sourceId,
    fence: parseFence(cursor.fence),
    query: parseQuery(cursor.query),
    offset: cursor.offset,
  }
}

function compareFence(left: PortableReadFenceV1, right: PortableReadFenceV1): boolean {
  return canonicalPortableJson(left) === canonicalPortableJson(right)
}

function compareRows(
  left: PortableReferenceRow,
  right: PortableReferenceRow,
  order: 'asc' | 'desc',
): number {
  const direction = order === 'asc' ? 1 : -1
  return direction * (
    left.sourceLedgerIndex - right.sourceLedgerIndex ||
    left.semanticClass.localeCompare(right.semanticClass) ||
    left.canonicalKey.localeCompare(right.canonicalKey) ||
    left.workId.localeCompare(right.workId)
  )
}

function validateRow(row: PortableReferenceRow, work: PortableCollectorWorkSnapshot): void {
  if (!SEMANTIC_CLASSES.has(row.semanticClass as NormalizedSemanticClassV1)) {
    throw new PortableCommittedReaderError(
      'integrity_failure',
      `committed row has unknown semantic class: ${row.semanticClass}`,
    )
  }
  if (work.status !== 'committed') {
    throw new PortableCommittedReaderError(
      'integrity_failure',
      `committed view exposed non-committed work: ${work.workId}`,
    )
  }
  if (
    work.scannedEndLedgerIndex === null ||
    row.sourceLedgerIndex < work.startLedgerIndex ||
    row.sourceLedgerIndex > work.scannedEndLedgerIndex
  ) {
    throw new PortableCommittedReaderError(
      'integrity_failure',
      `committed row is outside work range: ${row.workId}/${row.canonicalKey}`,
    )
  }
  canonicalHash(row.sourceLedgerHash, 'sourceLedgerHash')
  if (
    row.sourceTransactionHash !== null &&
    canonicalHash(row.sourceTransactionHash, 'sourceTransactionHash') !==
      row.sourceTransactionHash
  ) {
    throw new PortableCommittedReaderError(
      'integrity_failure',
      `committed row transaction hash is not canonical: ${row.canonicalKey}`,
    )
  }
  const normalizedRelationships = [...new Set(row.relationshipIds)].sort((left, right) =>
    left.localeCompare(right),
  )
  if (
    normalizedRelationships.some((relationshipId) => !relationshipId.trim()) ||
    canonicalPortableJson(normalizedRelationships) !== canonicalPortableJson(row.relationshipIds)
  ) {
    throw new PortableCommittedReaderError(
      'integrity_failure',
      `committed row relationships are not canonical: ${row.canonicalKey}`,
    )
  }
}

export class PortableCollectorCommittedReader {
  private readonly source: PortableReaderSourceV1
  private readonly network: string
  private readonly epochId: string
  private readonly baseIdentity: string

  constructor(
    private readonly storage: PortableCollectorStorageAdapter,
    options: PortableCommittedReaderOptions,
  ) {
    this.source = {
      schemaVersion: 1,
      sourceId: requireString(options.sourceId, 'sourceId'),
      mode: 'portable',
    }
    this.network = requireString(options.network, 'network')
    this.epochId = requireString(options.epochId, 'epochId')
    this.baseIdentity = requireString(options.baseIdentity, 'baseIdentity')
  }

  getFence(): PortableReadFenceV1 {
    const watermark = this.storage.getWatermark(
      this.network,
      this.epochId,
      this.baseIdentity,
    )
    if (!watermark) {
      throw new PortableCommittedReaderError(
        'unavailable',
        'portable committed watermark is unavailable',
      )
    }
    const work = this.storage.getWork(watermark.workId)
    if (
      !work ||
      work.status !== 'committed' ||
      work.network !== this.network ||
      work.epochId !== this.epochId ||
      work.baseIdentity !== this.baseIdentity ||
      work.scannedEndLedgerIndex !== watermark.ledgerIndex ||
      work.finalLedgerHash !== watermark.ledgerHash
    ) {
      throw new PortableCommittedReaderError(
        'integrity_failure',
        'portable committed watermark does not match its work',
      )
    }
    return {
      schemaVersion: 1,
      network: watermark.network,
      epochId: watermark.epochId,
      baseIdentity: watermark.baseIdentity,
      ledgerIndex: watermark.ledgerIndex,
      ledgerHash: canonicalHash(watermark.ledgerHash, 'watermark ledgerHash'),
      workId: watermark.workId,
    }
  }

  exact(options: {
    semanticClass: NormalizedSemanticClassV1
    canonicalKey: string
  }): { source: PortableReaderSourceV1; fence: PortableReadFenceV1; row: PortableReferenceRow | null } {
    const semanticClass = requireSemanticClass(options.semanticClass)
    const canonicalKey = requireString(options.canonicalKey, 'canonicalKey')
    const fence = this.getFence()
    const rows = this.rowsAtFence(fence)
      .filter(
        (row) =>
          row.semanticClass === semanticClass && row.canonicalKey === canonicalKey,
      )
      .sort((left, right) => compareRows(left, right, 'desc'))
    return {
      source: this.source,
      fence,
      row: rows[0] ?? null,
    }
  }

  listBySemanticClass(options: {
    semanticClass: NormalizedSemanticClassV1
    order?: 'asc' | 'desc'
    limit?: number
    cursor?: string
  }): Promise<PortableCommittedPageV1> {
    const query: PortableReaderQueryV1 = {
      schemaVersion: 1,
      kind: 'semantic',
      semanticClass: requireSemanticClass(options.semanticClass),
      startLedgerIndex: null,
      endLedgerIndex: null,
      relationshipId: null,
      order: options.order ?? 'asc',
    }
    return this.page(query, requireLimit(options.limit), options.cursor)
  }

  listByLedgerRange(options: {
    startLedgerIndex: number
    endLedgerIndex: number
    semanticClass?: NormalizedSemanticClassV1
    order?: 'asc' | 'desc'
    limit?: number
    cursor?: string
  }): Promise<PortableCommittedPageV1> {
    const startLedgerIndex = requireSafeInteger(
      options.startLedgerIndex,
      'startLedgerIndex',
    )
    const endLedgerIndex = requireSafeInteger(options.endLedgerIndex, 'endLedgerIndex')
    if (endLedgerIndex < startLedgerIndex) {
      throw new PortableCommittedReaderError(
        'invalid_query',
        'endLedgerIndex must not precede startLedgerIndex',
      )
    }
    const query: PortableReaderQueryV1 = {
      schemaVersion: 1,
      kind: 'ledger_range',
      semanticClass:
        options.semanticClass === undefined
          ? null
          : requireSemanticClass(options.semanticClass),
      startLedgerIndex,
      endLedgerIndex,
      relationshipId: null,
      order: options.order ?? 'asc',
    }
    return this.page(query, requireLimit(options.limit), options.cursor)
  }

  listByRelationship(options: {
    relationshipId: string
    semanticClass?: NormalizedSemanticClassV1
    order?: 'asc' | 'desc'
    limit?: number
    cursor?: string
  }): Promise<PortableCommittedPageV1> {
    const query: PortableReaderQueryV1 = {
      schemaVersion: 1,
      kind: 'relationship',
      semanticClass:
        options.semanticClass === undefined
          ? null
          : requireSemanticClass(options.semanticClass),
      startLedgerIndex: null,
      endLedgerIndex: null,
      relationshipId: requireString(options.relationshipId, 'relationshipId'),
      order: options.order ?? 'asc',
    }
    return this.page(query, requireLimit(options.limit), options.cursor)
  }

  private rowsAtFence(fence: PortableReadFenceV1): PortableReferenceRow[] {
    const workCache = new Map<string, PortableCollectorWorkSnapshot>()
    const rows: PortableReferenceRow[] = []
    for (const row of this.storage.listCommittedReferenceRows()) {
      let work = workCache.get(row.workId)
      if (!work) {
        const loaded = this.storage.getWork(row.workId)
        if (!loaded) {
          throw new PortableCommittedReaderError(
            'integrity_failure',
            `committed row references missing work: ${row.workId}`,
          )
        }
        work = loaded
        workCache.set(row.workId, work)
      }
      validateRow(row, work)
      if (
        work.network === fence.network &&
        work.epochId === fence.epochId &&
        work.baseIdentity === fence.baseIdentity &&
        work.scannedEndLedgerIndex !== null &&
        work.scannedEndLedgerIndex <= fence.ledgerIndex
      ) {
        rows.push(structuredClone(row))
      }
    }
    return rows
  }

  private async page(
    query: PortableReaderQueryV1,
    limit: number,
    cursorValue?: string,
  ): Promise<PortableCommittedPageV1> {
    const currentFence = this.getFence()
    let offset = 0
    if (cursorValue !== undefined) {
      const cursor = await decodeCursor(cursorValue)
      if (cursor.sourceId !== this.source.sourceId) {
        throw new PortableCommittedReaderError(
          'invalid_cursor',
          'cursor belongs to another reader source',
        )
      }
      if (!compareFence(cursor.fence, currentFence)) {
        throw new PortableCommittedReaderError(
          'stale_cursor',
          'cursor read fence is no longer current',
        )
      }
      if (canonicalPortableJson(cursor.query) !== canonicalPortableJson(query)) {
        throw new PortableCommittedReaderError(
          'invalid_cursor',
          'cursor query identity does not match the request',
        )
      }
      offset = cursor.offset
    }

    const filtered = this.rowsAtFence(currentFence)
      .filter((row) => {
        if (query.semanticClass !== null && row.semanticClass !== query.semanticClass) {
          return false
        }
        if (
          query.kind === 'ledger_range' &&
          (row.sourceLedgerIndex < query.startLedgerIndex! ||
            row.sourceLedgerIndex > query.endLedgerIndex!)
        ) {
          return false
        }
        if (
          query.kind === 'relationship' &&
          !row.relationshipIds.includes(query.relationshipId!)
        ) {
          return false
        }
        return true
      })
      .sort((left, right) => compareRows(left, right, query.order))

    if (offset > filtered.length) {
      throw new PortableCommittedReaderError(
        'invalid_cursor',
        'cursor offset exceeds the result set',
      )
    }
    const rows = filtered.slice(offset, offset + limit)
    const nextOffset = offset + rows.length
    const nextCursor =
      nextOffset < filtered.length
        ? await encodeCursor({
            schemaVersion: 1,
            sourceId: this.source.sourceId,
            fence: currentFence,
            query,
            offset: nextOffset,
          })
        : null

    return {
      schemaVersion: 1,
      source: this.source,
      fence: currentFence,
      rows,
      nextCursor,
    }
  }
}
