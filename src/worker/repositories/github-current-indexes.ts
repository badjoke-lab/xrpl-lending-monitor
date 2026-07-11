import type {
  AccountIndexValue,
  ObjectReference,
  RelationshipIndexValue,
  SearchIndexValue,
} from '../../shared/current-state/artifact-reader-types'
import type {
  ReleaseNativeIndexRecord,
  ReleaseNativeObjectReference,
} from '../../shared/current-state/release-native-reader'
import type { ReadModelKind } from '../../shared/current-state/github-read-model-reader'
import type { ActiveSnapshotRecord } from './core-api-repository'
import { CurrentStateObjectReadError } from './current-state-read-error'
import {
  isReleaseCurrentStateSource,
  type CurrentStateStorage,
  type ReleaseCurrentStateSource,
} from './release-current-state'
import { getThreeLayerCurrentProjection } from './three-layer-current-reader'

const MAX_INDEX_ASSET_READS = 16
const OBJECT_ID = /^[a-f0-9]{64}$/i

function sourceOf(storage: CurrentStateStorage): ReleaseCurrentStateSource {
  if (!isReleaseCurrentStateSource(storage)) {
    throw new CurrentStateObjectReadError('manifest_integrity_error', 'release source is unavailable')
  }
  return storage
}

function assertSnapshot(snapshot: ActiveSnapshotRecord, source: ReleaseCurrentStateSource): void {
  const manifest = source.opened.manifest
  if (
    snapshot.id !== manifest.snapshotId
    || snapshot.epochId !== manifest.epochId
    || snapshot.ledgerIndex !== manifest.ledgerIndex
    || snapshot.ledgerHash !== manifest.ledgerHash
  ) throw new CurrentStateObjectReadError('manifest_integrity_error', 'snapshot identity mismatch')
}

function storedReference(reference: ReleaseNativeObjectReference): ObjectReference {
  return { id: reference.id, kind: reference.kind, dataKey: reference.assetName }
}

function directReference(kind: ReadModelKind, objectId: string): ObjectReference {
  return { id: objectId, kind, dataKey: 'read-model' }
}

function accountValue(record: ReleaseNativeIndexRecord): AccountIndexValue | null {
  return record.lookupKind === 'account'
    ? { field: record.value.field, reference: storedReference(record.value.reference) }
    : null
}

function relationshipValue(record: ReleaseNativeIndexRecord): RelationshipIndexValue | null {
  return record.lookupKind === 'relationship'
    ? {
        relation: record.value.relation,
        source: record.value.source,
        target: storedReference(record.value.target),
      }
    : null
}

export async function findGithubAccountReferences(
  storage: CurrentStateStorage,
  snapshot: ActiveSnapshotRecord,
  account: string,
  options: { limit: number; cursor?: string; fields?: readonly ('Account' | 'Owner' | 'Borrower')[] },
): Promise<{ data: AccountIndexValue[]; nextCursor: string | null; complete: boolean; assetReads: number }> {
  const source = sourceOf(storage)
  assertSnapshot(snapshot, source)
  const result = await source.opened.reader.findAccounts(
    account,
    options.fields ?? ['Account', 'Owner', 'Borrower'],
    { limit: options.limit, cursor: options.cursor, maxAssetReads: MAX_INDEX_ASSET_READS },
  )
  return {
    data: result.items.map(accountValue).filter((value): value is AccountIndexValue => value !== null),
    nextCursor: result.nextCursor,
    complete: result.complete,
    assetReads: result.assetReads,
  }
}

export async function findGithubRelationships(
  storage: CurrentStateStorage,
  snapshot: ActiveSnapshotRecord,
  sourceId: string,
  options: { limit: number; cursor?: string; relation?: 'vault-loan-broker' | 'loan-broker-loan' },
): Promise<{ data: RelationshipIndexValue[]; nextCursor: string | null; complete: boolean; assetReads: number }> {
  const source = sourceOf(storage)
  assertSnapshot(snapshot, source)
  const result = await source.opened.reader.findRelationships(
    sourceId.toUpperCase(),
    options.relation ?? null,
    { limit: options.limit, cursor: options.cursor, maxAssetReads: MAX_INDEX_ASSET_READS },
  )
  return {
    data: result.items.map(relationshipValue).filter((value): value is RelationshipIndexValue => value !== null),
    nextCursor: result.nextCursor,
    complete: result.complete,
    assetReads: result.assetReads,
  }
}

async function searchCurrentObjectId(
  source: ReleaseCurrentStateSource,
  snapshot: ActiveSnapshotRecord,
  objectId: string,
): Promise<{ data: SearchIndexValue[]; nextCursor: null; complete: true; assetReads: number }> {
  const normalized = objectId.toUpperCase()
  const kinds: readonly ReadModelKind[] = ['vault', 'loan-broker', 'loan']
  const results = await Promise.all(kinds.map(async (kind) => ({
    kind,
    result: await getThreeLayerCurrentProjection({
      db: source.db,
      source,
      snapshot,
      kind,
      objectId: normalized,
    }),
  })))
  const found = results.find(({ result }) => result.item !== null)
  return {
    data: found
      ? [{ category: 'object-id', reference: directReference(found.kind, normalized) }]
      : [],
    nextCursor: null,
    complete: true,
    assetReads: results.reduce((total, { result }) => total + result.assetReads, 0),
  }
}

export async function searchGithubCurrentStateExact(
  storage: CurrentStateStorage,
  snapshot: ActiveSnapshotRecord,
  term: string,
  options: { limit: number; cursor?: string },
): Promise<{ data: SearchIndexValue[]; nextCursor: string | null; complete: boolean; assetReads: number }> {
  const source = sourceOf(storage)
  assertSnapshot(snapshot, source)
  if (OBJECT_ID.test(term)) {
    if (options.cursor) return { data: [], nextCursor: null, complete: true, assetReads: 0 }
    return searchCurrentObjectId(source, snapshot, term)
  }

  const result = await source.opened.reader.searchExact(term, {
    limit: options.limit,
    cursor: options.cursor,
    maxAssetReads: MAX_INDEX_ASSET_READS,
  })
  const data: SearchIndexValue[] = []
  let accountAdded = false
  for (const record of result.items) {
    if (record.lookupKind === 'object-id') {
      data.push({ category: 'object-id', reference: storedReference(record.value.reference) })
    } else if (record.lookupKind === 'account' && !accountAdded) {
      data.push({ category: 'account', account: record.term })
      accountAdded = true
    }
  }
  return { data, nextCursor: result.nextCursor, complete: result.complete, assetReads: result.assetReads }
}
