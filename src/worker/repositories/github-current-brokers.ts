import type {
  LoanBrokerCurrentProjection,
  VaultCurrentProjection,
} from '../../domain/lending/current-projections'
import type { ActiveSnapshotRecord } from './core-api-repository'
import type {
  CurrentLoanBrokerRecord,
  ListCurrentLoanBrokersOptions,
  ListCurrentLoanBrokersResult,
} from './d1-current-loan-broker-reader'
import { CurrentStateObjectReadError } from './current-state-read-error'
import {
  isReleaseCurrentStateSource,
  normalizeReleaseRecord,
  type CurrentStateStorage,
  type ReleaseCurrentStateSource,
} from './release-current-state'

const MAX_LIST_ASSET_READS = 16
const MAX_REQUEST_ASSET_READS = 512

function releaseSource(storage: CurrentStateStorage): ReleaseCurrentStateSource {
  if (!isReleaseCurrentStateSource(storage)) {
    throw new CurrentStateObjectReadError('manifest_integrity_error', 'release source is unavailable')
  }
  return storage
}

function validateSnapshot(snapshot: ActiveSnapshotRecord, source: ReleaseCurrentStateSource): void {
  const manifest = source.opened.manifest
  if (
    snapshot.id !== manifest.snapshotId
    || snapshot.epochId !== manifest.epochId
    || snapshot.ledgerIndex !== manifest.ledgerIndex
    || snapshot.ledgerHash !== manifest.ledgerHash
  ) throw new CurrentStateObjectReadError('manifest_integrity_error', 'snapshot identity mismatch')
}

function queryMatches(values: readonly string[], query: string | undefined): boolean {
  if (!query) return true
  const needle = query.toLowerCase()
  return values.some((value) => value.toLowerCase().includes(needle))
}

async function objectById<T>(
  source: ReleaseCurrentStateSource,
  objectId: string,
  expectedKind: 'vault' | 'loan-broker',
  maxAssetReads: number,
): Promise<{ item: T | null; assetReads: number }> {
  if (maxAssetReads < 1) throw new CurrentStateObjectReadError('relationship_read_limit', 'asset read limit exceeded')
  const found = await source.opened.reader.getObject(objectId, { maxAssetReads })
  if (!found.complete) throw new CurrentStateObjectReadError('relationship_read_limit', 'asset read limit exceeded')
  if (!found.item) return { item: null, assetReads: found.assetReads }
  if (found.item.kind !== expectedKind) throw new CurrentStateObjectReadError('manifest_integrity_error', 'object kind mismatch')
  return { item: normalizeReleaseRecord(found.item) as T, assetReads: found.assetReads }
}

export async function listGithubLoanBrokers(
  storage: CurrentStateStorage,
  snapshot: ActiveSnapshotRecord,
  options: ListCurrentLoanBrokersOptions,
): Promise<ListCurrentLoanBrokersResult> {
  const source = releaseSource(storage)
  validateSnapshot(snapshot, source)
  const query = options.query?.toLowerCase()
  const result = await source.opened.reader.listObjects('loan-broker', {
    limit: options.limit,
    cursor: options.cursor,
    maxAssetReads: MAX_LIST_ASSET_READS,
    direction: (options.sort ?? 'id_asc') === 'id_desc' ? 'desc' : 'asc',
  }, (record) => {
    const broker = normalizeReleaseRecord(record) as LoanBrokerCurrentProjection
    return !query || [broker.id, broker.owner, broker.account, broker.vaultId]
      .some((value) => value.toLowerCase().includes(query))
  })
  const data: CurrentLoanBrokerRecord[] = []
  let relationReads = 0
  for (const item of result.items) {
    const broker = normalizeReleaseRecord(item) as LoanBrokerCurrentProjection
    const vault = await objectById<VaultCurrentProjection>(
      source,
      broker.vaultId,
      'vault',
      MAX_REQUEST_ASSET_READS - result.assetReads - relationReads,
    )
    relationReads += vault.assetReads
    if (!vault.item) throw new CurrentStateObjectReadError('manifest_integrity_error', 'broker vault is missing')
    data.push({ broker, vault: vault.item })
  }
  return {
    data,
    nextCursor: result.nextCursor,
    brokerShardsRead: result.assetReads,
    relationShardsRead: relationReads,
    objectsExamined: result.items.length,
  }
}

export async function getGithubLoanBrokerById(
  storage: CurrentStateStorage,
  snapshot: ActiveSnapshotRecord,
  brokerId: string,
): Promise<CurrentLoanBrokerRecord | null> {
  const source = releaseSource(storage)
  validateSnapshot(snapshot, source)
  const broker = await objectById<LoanBrokerCurrentProjection>(source, brokerId.toUpperCase(), 'loan-broker', MAX_REQUEST_ASSET_READS)
  if (!broker.item) return null
  const vault = await objectById<VaultCurrentProjection>(source, broker.item.vaultId, 'vault', MAX_REQUEST_ASSET_READS - broker.assetReads)
  if (!vault.item) throw new CurrentStateObjectReadError('manifest_integrity_error', 'broker vault is missing')
  return { broker: broker.item, vault: vault.item }
}
