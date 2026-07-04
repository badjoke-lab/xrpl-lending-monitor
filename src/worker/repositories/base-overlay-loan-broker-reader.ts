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
import {
  getResolvedCurrentProjection,
  listResolvedCurrentProjections,
} from './base-overlay-current-reader'
import { CurrentStateObjectReadError } from './current-state-read-error'
import {
  isReleaseCurrentStateSource,
  type CurrentStateStorage,
  type ReleaseCurrentStateSource,
} from './release-current-state'

const MAX_LIST_ASSET_READS = 16

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

function matches(broker: LoanBrokerCurrentProjection, options: ListCurrentLoanBrokersOptions): boolean {
  const query = options.query?.toLowerCase()
  return !query || [broker.id, broker.owner, broker.account, broker.vaultId]
    .some((value) => value.toLowerCase().includes(query))
}

async function resolvedVault(
  db: D1Database,
  source: ReleaseCurrentStateSource,
  snapshot: ActiveSnapshotRecord,
  vaultId: string,
): Promise<VaultCurrentProjection> {
  const found = await getResolvedCurrentProjection({
    db,
    source,
    snapshot,
    kind: 'vault',
    objectId: vaultId,
  })
  if (!found.item) {
    throw new CurrentStateObjectReadError('manifest_integrity_error', 'broker Vault relationship is missing')
  }
  return found.item as VaultCurrentProjection
}

export async function listBaseOverlayLoanBrokers(
  db: D1Database,
  storage: CurrentStateStorage,
  snapshot: ActiveSnapshotRecord,
  options: ListCurrentLoanBrokersOptions,
): Promise<ListCurrentLoanBrokersResult> {
  const source = releaseSource(storage)
  validateSnapshot(snapshot, source)
  const result = await listResolvedCurrentProjections({
    db,
    source,
    snapshot,
    kind: 'loan-broker',
    list: {
      limit: options.limit,
      cursor: options.cursor,
      direction: (options.sort ?? 'id_asc') === 'id_desc' ? 'desc' : 'asc',
      scope: `loan-broker:${options.sort ?? 'id_asc'}:${options.query ?? ''}`,
      maxBasePageReads: MAX_LIST_ASSET_READS,
      predicate: (projection) => matches(projection as LoanBrokerCurrentProjection, options),
    },
  })

  const data: CurrentLoanBrokerRecord[] = []
  for (const projection of result.items) {
    const broker = projection as LoanBrokerCurrentProjection
    data.push({
      broker,
      vault: await resolvedVault(db, source, snapshot, broker.vaultId),
    })
  }

  return {
    data,
    nextCursor: result.nextCursor,
    brokerShardsRead: result.basePageReads,
    relationShardsRead: 0,
    objectsExamined: result.objectsExamined,
  }
}

export async function getBaseOverlayLoanBrokerById(
  db: D1Database,
  storage: CurrentStateStorage,
  snapshot: ActiveSnapshotRecord,
  brokerId: string,
): Promise<CurrentLoanBrokerRecord | null> {
  const source = releaseSource(storage)
  validateSnapshot(snapshot, source)
  const found = await getResolvedCurrentProjection({
    db,
    source,
    snapshot,
    kind: 'loan-broker',
    objectId: brokerId,
  })
  if (!found.item) return null
  const broker = found.item as LoanBrokerCurrentProjection
  return {
    broker,
    vault: await resolvedVault(db, source, snapshot, broker.vaultId),
  }
}
