import type {
  LoanBrokerCurrentProjection,
  LoanCurrentProjection,
  VaultCurrentProjection,
} from '../../domain/lending/current-projections'
import {
  GithubCurrentStateReadModelReader,
  type ReadModelBrokerRecord,
  type ReadModelKind,
  type ReadModelLoanRecord,
} from '../../shared/current-state/github-read-model-reader'
import type {
  ReleaseNativeDataRecord,
  ReleaseNativeIndexRecord,
  ReleaseNativeObjectReference,
} from '../../shared/current-state/release-native-reader'
import type { RuntimeConfig } from '../../shared/runtime-config'
import { getActiveSnapshot, type ActiveSnapshotRecord } from './core-api-repository'
import { CurrentStateObjectReadError } from './current-state-read-error'

type Projection = VaultCurrentProjection | LoanBrokerCurrentProjection | LoanCurrentProjection

type AdapterListOptions = {
  limit: number
  cursor?: string
  maxAssetReads?: number
  direction: 'asc' | 'desc'
}

type AdapterReadOptions = {
  limit: number
  cursor?: string
  maxAssetReads?: number
}

type AdapterIndexCursor = {
  v: 1
  mode: string
  kindIndex: number
  inner: string | null
}

const SEARCH_ACCOUNT_START = '__read_model_search_account_start__'

function fakeRecord(kind: ReadModelKind, projection: Projection): ReleaseNativeDataRecord {
  return {
    schemaVersion: 1,
    segmentId: 'read-model',
    sourcePage: 0,
    id: projection.id,
    kind,
    valueSha256: '0'.repeat(64),
    value: { __readModelProjection: projection } as unknown as Record<string, unknown>,
  }
}

function objectReference(kind: ReadModelKind, projection: Projection): ReleaseNativeObjectReference {
  return {
    segmentId: 'read-model',
    assetName: 'read-model',
    id: projection.id,
    kind,
  }
}

function projectionFromPage(kind: ReadModelKind, item: unknown): Projection {
  if (kind === 'vault') return item as VaultCurrentProjection
  if (kind === 'loan-broker') return (item as ReadModelBrokerRecord).broker
  return (item as ReadModelLoanRecord).loan
}

function encodeIndexCursor(cursor: AdapterIndexCursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function decodeIndexCursor(value: string | undefined, mode: string): AdapterIndexCursor {
  if (!value) return { v: 1, mode, kindIndex: 0, inner: null }
  if (value.length % 2 !== 0 || !/^[a-f0-9]+$/i.test(value)) throw new Error('Adapter cursor is invalid')
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<AdapterIndexCursor>
  if (
    parsed.v !== 1
    || parsed.mode !== mode
    || !Number.isSafeInteger(parsed.kindIndex)
    || Number(parsed.kindIndex) < 0
    || (parsed.inner !== null && typeof parsed.inner !== 'string')
  ) throw new Error('Adapter cursor does not match the query')
  return {
    v: 1,
    mode,
    kindIndex: Number(parsed.kindIndex),
    inner: parsed.inner ?? null,
  }
}

function accountFieldMatches(
  kind: ReadModelKind,
  projection: Projection,
  account: string,
  fields: readonly ('Account' | 'Owner' | 'Borrower')[],
): ('Account' | 'Owner' | 'Borrower')[] {
  const matches: ('Account' | 'Owner' | 'Borrower')[] = []
  if (kind === 'vault') {
    const vault = projection as VaultCurrentProjection
    if (fields.includes('Account') && vault.account === account) matches.push('Account')
    if (fields.includes('Owner') && vault.owner === account) matches.push('Owner')
  } else if (kind === 'loan-broker') {
    const broker = projection as LoanBrokerCurrentProjection
    if (fields.includes('Account') && broker.account === account) matches.push('Account')
    if (fields.includes('Owner') && broker.owner === account) matches.push('Owner')
  } else {
    const loan = projection as LoanCurrentProjection
    if (fields.includes('Borrower') && loan.borrower === account) matches.push('Borrower')
  }
  return matches
}

function createReadModelAdapter(readModel: GithubCurrentStateReadModelReader) {
  const cache = new Map<string, { kind: ReadModelKind; projection: Projection }>()

  function remember(kind: ReadModelKind, projection: Projection): void {
    cache.set(projection.id, { kind, projection })
  }

  function rememberPageItem(kind: ReadModelKind, item: unknown): void {
    if (kind === 'vault') {
      remember('vault', item as VaultCurrentProjection)
      return
    }
    if (kind === 'loan-broker') {
      const record = item as ReadModelBrokerRecord
      remember('loan-broker', record.broker)
      remember('vault', record.vault)
      return
    }
    const record = item as ReadModelLoanRecord
    remember('loan', record.loan)
    remember('loan-broker', record.broker)
    remember('vault', record.vault)
  }

  async function loadAny(objectId: string): Promise<{ kind: ReadModelKind; projection: Projection } | null> {
    const id = objectId.toUpperCase()
    const cached = cache.get(id)
    if (cached) return cached

    for (const kind of ['vault', 'loan-broker', 'loan'] as const) {
      try {
        if (kind === 'vault') {
          const item = await readModel.get<VaultCurrentProjection>(id, kind)
          if (item) {
            remember(kind, item)
            return { kind, projection: item }
          }
        } else if (kind === 'loan-broker') {
          const item = await readModel.get<ReadModelBrokerRecord>(id, kind)
          if (item) {
            rememberPageItem(kind, item)
            return { kind, projection: item.broker }
          }
        } else {
          const item = await readModel.get<ReadModelLoanRecord>(id, kind)
          if (item) {
            rememberPageItem(kind, item)
            return { kind, projection: item.loan }
          }
        }
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('object kind mismatch')) throw error
      }
    }
    return null
  }

  async function findAccounts(
    account: string,
    fields: readonly ('Account' | 'Owner' | 'Borrower')[],
    options: AdapterReadOptions,
  ) {
    const kinds: readonly ReadModelKind[] = ['vault', 'loan-broker', 'loan']
    const mode = `account:${account}:${fields.join(',')}`
    const cursor = decodeIndexCursor(options.cursor, mode)
    const items: ReleaseNativeIndexRecord[] = []
    let assetReads = 0
    let kindIndex = cursor.kindIndex
    let inner = cursor.inner
    const maxAssetReads = Math.max(1, options.maxAssetReads ?? 16)

    while (kindIndex < kinds.length && items.length < options.limit && assetReads < maxAssetReads) {
      const kind = kinds[kindIndex]!
      const remainingReads = maxAssetReads - assetReads
      const remainingItems = options.limit - items.length
      const result = await readModel.list<unknown>(kind, {
        limit: remainingItems,
        cursor: inner ?? undefined,
        direction: 'asc',
        scope: `${mode}:${kind}`,
        maxPageReads: remainingReads,
        predicate: (item) => {
          rememberPageItem(kind, item)
          const projection = projectionFromPage(kind, item)
          return accountFieldMatches(kind, projection, account, fields).length > 0
        },
      })
      assetReads += result.pageReads
      for (const item of result.items) {
        const projection = projectionFromPage(kind, item)
        const field = accountFieldMatches(kind, projection, account, fields)[0]
        if (!field) continue
        items.push({
          schemaVersion: 1,
          bucket: 0,
          term: account,
          lookupKind: 'account',
          value: { field, reference: objectReference(kind, projection) },
        })
      }
      if (result.nextCursor) {
        inner = result.nextCursor
        break
      }
      kindIndex += 1
      inner = null
    }

    const complete = kindIndex >= kinds.length
    const nextCursor = complete
      ? null
      : encodeIndexCursor({ v: 1, mode, kindIndex, inner })
    return { items, nextCursor, complete, assetReads }
  }

  async function findRelationships(
    sourceId: string,
    relation: 'vault-loan-broker' | 'loan-broker-loan' | null,
    options: AdapterReadOptions,
  ) {
    const scans = relation === 'vault-loan-broker'
      ? (['loan-broker'] as const)
      : relation === 'loan-broker-loan'
        ? (['loan'] as const)
        : (['loan-broker', 'loan'] as const)
    const mode = `relationship:${sourceId}:${relation ?? '*'}`
    const cursor = decodeIndexCursor(options.cursor, mode)
    const items: ReleaseNativeIndexRecord[] = []
    let assetReads = 0
    let kindIndex = cursor.kindIndex
    let inner = cursor.inner
    const maxAssetReads = Math.max(1, options.maxAssetReads ?? 16)

    while (kindIndex < scans.length && items.length < options.limit && assetReads < maxAssetReads) {
      const kind = scans[kindIndex]!
      const remainingReads = maxAssetReads - assetReads
      const remainingItems = options.limit - items.length
      const result = await readModel.list<unknown>(kind, {
        limit: remainingItems,
        cursor: inner ?? undefined,
        direction: 'asc',
        scope: `${mode}:${kind}`,
        maxPageReads: remainingReads,
        predicate: (item) => {
          rememberPageItem(kind, item)
          if (kind === 'loan-broker') return (item as ReadModelBrokerRecord).broker.vaultId === sourceId
          return (item as ReadModelLoanRecord).loan.loanBrokerId === sourceId
        },
      })
      assetReads += result.pageReads
      for (const item of result.items) {
        if (kind === 'loan-broker') {
          const projection = (item as ReadModelBrokerRecord).broker
          items.push({
            schemaVersion: 1,
            bucket: 0,
            term: sourceId,
            lookupKind: 'relationship',
            value: {
              relation: 'vault-loan-broker',
              source: { id: sourceId, kind: 'vault' },
              target: objectReference('loan-broker', projection),
            },
          })
        } else {
          const projection = (item as ReadModelLoanRecord).loan
          items.push({
            schemaVersion: 1,
            bucket: 0,
            term: sourceId,
            lookupKind: 'relationship',
            value: {
              relation: 'loan-broker-loan',
              source: { id: sourceId, kind: 'loan-broker' },
              target: objectReference('loan', projection),
            },
          })
        }
      }
      if (result.nextCursor) {
        inner = result.nextCursor
        break
      }
      kindIndex += 1
      inner = null
    }

    const complete = kindIndex >= scans.length
    const nextCursor = complete
      ? null
      : encodeIndexCursor({ v: 1, mode, kindIndex, inner })
    return { items, nextCursor, complete, assetReads }
  }

  async function searchExact(term: string, options: AdapterReadOptions) {
    const items: ReleaseNativeIndexRecord[] = []
    let assetReads = 0
    let accountCursor = options.cursor
    if (!options.cursor || options.cursor === SEARCH_ACCOUNT_START) {
      if (!options.cursor) {
        const found = await loadAny(term)
        assetReads += found ? 2 : 1
        if (found) {
          items.push({
            schemaVersion: 1,
            bucket: 0,
            term,
            lookupKind: 'object-id',
            value: { reference: objectReference(found.kind, found.projection) },
          })
          if (items.length >= options.limit) {
            return { items, nextCursor: SEARCH_ACCOUNT_START, complete: false, assetReads }
          }
        }
      }
      accountCursor = undefined
    }

    const accountResult = await findAccounts(
      term,
      ['Account', 'Owner', 'Borrower'],
      {
        limit: options.limit - items.length,
        cursor: accountCursor,
        maxAssetReads: Math.max(1, (options.maxAssetReads ?? 16) - assetReads),
      },
    )
    items.push(...accountResult.items)
    assetReads += accountResult.assetReads
    return {
      items,
      nextCursor: accountResult.nextCursor,
      complete: accountResult.complete,
      assetReads,
    }
  }

  return {
    async listObjects(
      kind: ReadModelKind,
      options: AdapterListOptions,
      predicate?: (record: ReleaseNativeDataRecord) => boolean,
    ) {
      const result = await readModel.list<unknown>(kind, {
        limit: options.limit,
        cursor: options.cursor,
        direction: options.direction,
        scope: `${kind}:${options.direction}`,
        maxPageReads: Math.max(1, Math.min(options.maxAssetReads ?? 4, 4)),
        predicate: (item) => {
          rememberPageItem(kind, item)
          const projection = projectionFromPage(kind, item)
          return predicate ? predicate(fakeRecord(kind, projection)) : true
        },
      })
      return {
        items: result.items.map((item) => fakeRecord(kind, projectionFromPage(kind, item))),
        nextCursor: result.nextCursor,
        assetReads: result.pageReads,
      }
    },

    async getObject(objectId: string, _options: { maxAssetReads: number }) {
      const found = await loadAny(objectId)
      return {
        item: found ? fakeRecord(found.kind, found.projection) : null,
        complete: true,
        assetReads: found ? 2 : 1,
      }
    },

    findAccounts,
    findRelationships,
    searchExact,
  }
}

export interface ReleaseCurrentStateSource {
  kind: 'release'
  readModel: GithubCurrentStateReadModelReader
  opened: {
    manifest: GithubCurrentStateReadModelReader['manifest']
    reader: ReturnType<typeof createReadModelAdapter>
  }
}

export type CurrentStateStorage = D1Database | ReleaseCurrentStateSource

export interface ResolvedCurrentStateStorage {
  source: CurrentStateStorage
  snapshot: ActiveSnapshotRecord | null
  releaseUnavailable: boolean
}

export function isReleaseCurrentStateSource(value: CurrentStateStorage): value is ReleaseCurrentStateSource {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'release'
}

export function normalizeReleaseRecord(record: ReleaseNativeDataRecord): Projection {
  const projection = record.value.__readModelProjection
  if (!projection || typeof projection !== 'object') {
    throw new CurrentStateObjectReadError('manifest_integrity_error', 'read-model projection is unavailable')
  }
  return projection as Projection
}

export async function openConfiguredReleaseCurrentState(
  config: RuntimeConfig,
): Promise<{
  source: ReleaseCurrentStateSource
  snapshot: ActiveSnapshotRecord
} | null> {
  if (!config.currentState.githubRepository) return null
  try {
    const readModel = await GithubCurrentStateReadModelReader.open({
      githubRepository: config.currentState.githubRepository,
      githubBranch: 'current-state-data',
    })
    const manifest = readModel.manifest
    const objectCount = manifest.counts.vaults + manifest.counts.loanBrokers + manifest.counts.loans
    const shardCount = manifest.pageCounts.vaults
      + manifest.pageCounts.loanBrokers
      + manifest.pageCounts.loans
      + 16 ** manifest.lookupPrefixLength
    const reader = createReadModelAdapter(readModel)
    return {
      source: {
        kind: 'release',
        readModel,
        opened: { manifest, reader },
      },
      snapshot: {
        id: manifest.snapshotId,
        epochId: manifest.epochId,
        ledgerIndex: manifest.ledgerIndex,
        ledgerHash: manifest.ledgerHash,
        objectPrefix: 'read-model/',
        manifestKey: 'read-model/manifest.json',
        manifestSha256: manifest.manifestSha256,
        vaultCount: manifest.counts.vaults,
        loanBrokerCount: manifest.counts.loanBrokers,
        loanCount: manifest.counts.loans,
        objectCount,
        shardCount,
        compressedBytes: 0,
        completedAt: readModel.updatedAt,
      },
    }
  } catch (error) {
    throw new CurrentStateObjectReadError(
      'manifest_integrity_error',
      error instanceof Error ? error.message : 'read-model current-state source is invalid',
    )
  }
}

export async function resolveCurrentStateStorage(
  config: RuntimeConfig,
  db: D1Database,
): Promise<ResolvedCurrentStateStorage> {
  const releaseConfigured = Boolean(config.currentState.githubRepository)
  if (releaseConfigured) {
    try {
      const release = await openConfiguredReleaseCurrentState(config)
      if (!release) return { source: db, snapshot: null, releaseUnavailable: true }
      return { source: release.source, snapshot: release.snapshot, releaseUnavailable: false }
    } catch {
      return { source: db, snapshot: null, releaseUnavailable: true }
    }
  }
  return {
    source: db,
    snapshot: await getActiveSnapshot(db),
    releaseUnavailable: false,
  }
}
