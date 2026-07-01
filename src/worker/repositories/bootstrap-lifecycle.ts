import type {
  BootstrapIdentity,
  BootstrapLifecycle,
} from '../../collector/current-state/bootstrap-runner'
import {
  activateCurrentSnapshot,
  beginCurrentSnapshot,
  type CurrentSnapshotIdentity,
} from './current-state-repository'

function snapshotIdentity(
  identity: BootstrapIdentity,
  startedAt: string,
): CurrentSnapshotIdentity {
  return {
    id: identity.snapshotId,
    network: 'devnet',
    epochId: identity.epochId,
    ledgerIndex: identity.ledgerIndex,
    ledgerHash: identity.ledgerHash,
    endpoint: identity.endpoint,
    objectPrefix: identity.objectPrefix,
    startedAt,
  }
}

export function createD1BootstrapLifecycle(
  db: D1Database,
  now: () => string = () => new Date().toISOString(),
): BootstrapLifecycle {
  return {
    async begin(identity) {
      await beginCurrentSnapshot(db, snapshotIdentity(identity, now()))
    },

    async activate(options) {
      const completedAt = now()
      await activateCurrentSnapshot({
        db,
        snapshot: snapshotIdentity(options.identity, completedAt),
        metrics: options.manifest.metrics,
        manifest: {
          manifestKey: options.manifestKey,
          manifestSha256: options.manifestSha256,
          shardCount: options.manifest.shards.length,
          compressedBytes: options.manifest.compressedBytes,
          vaultCount: options.manifest.counts.vaults,
          loanBrokerCount: options.manifest.counts.loanBrokers,
          loanCount: options.manifest.counts.loans,
        },
        completedAt,
      })
    },
  }
}
