import type { CurrentStateScanMetrics } from './scan-current-state'

export interface CurrentStateShardSummary {
  key: string
  pageNumber: number
  firstLedgerIndex: string | null
  lastLedgerIndex: string | null
  decodedObjects: number
  vaultCount: number
  loanBrokerCount: number
  loanCount: number
  compressedBytes: number
  sha256: string
}

export interface CurrentStateManifest {
  schemaVersion: 1
  snapshotId: string
  network: 'devnet'
  epochId: string
  ledgerIndex: number
  ledgerHash: string
  generatedAt: string
  objectPrefix: string
  metrics: CurrentStateScanMetrics
  counts: {
    vaults: number
    loanBrokers: number
    loans: number
  }
  compressedBytes: number
  shards: readonly CurrentStateShardSummary[]
}

export function buildCurrentStateManifest(options: {
  snapshotId: string
  epochId: string
  ledgerIndex: number
  ledgerHash: string
  objectPrefix: string
  generatedAt: string
  metrics: CurrentStateScanMetrics
  shards: readonly CurrentStateShardSummary[]
}): CurrentStateManifest {
  const ordered = [...options.shards].sort((left, right) => left.pageNumber - right.pageNumber)
  for (let index = 0; index < ordered.length; index += 1) {
    if (ordered[index]?.pageNumber !== index + 1) {
      throw new Error(`Current-state shard sequence is incomplete at page ${index + 1}`)
    }
    if (!/^[a-f0-9]{64}$/.test(ordered[index]?.sha256 ?? '')) {
      throw new Error(`Current-state shard ${index + 1} has an invalid SHA-256 digest`)
    }
  }

  return {
    schemaVersion: 1,
    snapshotId: options.snapshotId,
    network: 'devnet',
    epochId: options.epochId,
    ledgerIndex: options.ledgerIndex,
    ledgerHash: options.ledgerHash,
    generatedAt: options.generatedAt,
    objectPrefix: options.objectPrefix,
    metrics: options.metrics,
    counts: {
      vaults: options.metrics.byType.vault.objects,
      loanBrokers: options.metrics.byType.loan_broker.objects,
      loans: options.metrics.byType.loan.objects,
    },
    compressedBytes: ordered.reduce((total, shard) => total + shard.compressedBytes, 0),
    shards: ordered,
  }
}

export function serializeCurrentStateManifest(manifest: CurrentStateManifest): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`)
}
