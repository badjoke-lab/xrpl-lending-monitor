import {
  normalizeLoan,
  normalizeLoanBroker,
  normalizeVault,
} from '../../collector/current-state/normalize-current-objects'
import type { ScannedLedgerObject } from '../../collector/current-state/scan-ledger-objects'
import type {
  LoanBrokerCurrentProjection,
  LoanCurrentProjection,
  VaultCurrentProjection,
} from '../../domain/lending/current-projections'
import { ROW_SIZE_LIMIT_BYTES, canonicalJson, digestHex, utf8Bytes } from './d1-snapshot'

export interface PreparedSnapshotObject {
  kind: 'vault' | 'loan_broker' | 'loan'
  objectId: string
  objectHash: string
  projectionJson: string
  rawJson: string
  normalizedBytes: number
  projection: VaultCurrentProjection | LoanBrokerCurrentProjection | LoanCurrentProjection
}

function withoutRaw<T extends { raw: Record<string, unknown> }>(projection: T): Omit<T, 'raw'> {
  const { raw: _raw, ...rest } = projection
  return rest
}

export function hasNonZeroAmount(value: string): boolean {
  return !/^[-+]?0(?:\.0+)?(?:[eE][+-]?\d+)?$/.test(value.trim())
}

export async function prepareSnapshotObject(
  object: ScannedLedgerObject,
): Promise<PreparedSnapshotObject> {
  let projection: VaultCurrentProjection | LoanBrokerCurrentProjection | LoanCurrentProjection
  if (object.LedgerEntryType === 'Vault') projection = normalizeVault(object)
  else if (object.LedgerEntryType === 'LoanBroker') projection = normalizeLoanBroker(object)
  else projection = normalizeLoan(object)

  const projectionJson = canonicalJson(withoutRaw(projection))
  const rawJson = canonicalJson(projection.raw)
  const normalizedBytes = utf8Bytes(projectionJson) + utf8Bytes(rawJson)
  if (normalizedBytes > ROW_SIZE_LIMIT_BYTES) {
    throw new Error(`Current-state object ${projection.id} exceeds the D1 row safety limit`)
  }

  return {
    kind: projection.kind,
    objectId: projection.id.toUpperCase(),
    objectHash: await digestHex(
      canonicalJson({ projection: withoutRaw(projection), raw: projection.raw }),
    ),
    projectionJson,
    rawJson,
    normalizedBytes,
    projection,
  }
}
