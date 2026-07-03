export type SnapshotKind = 'vault' | 'loan-broker' | 'loan'

export interface SnapshotIdentity {
  network: 'devnet'
  epochId: string
  snapshotId: string
  ledgerIndex: number
  ledgerHash: string
}
