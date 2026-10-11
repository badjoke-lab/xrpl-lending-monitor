import {
  compareExactDecimals,
  formatExactDecimal,
  parseExactDecimal,
  parseInteger,
  subtractExactDecimals,
  type ExactDecimal,
} from '../../domain/asset/decimal'
import type { VaultCurrentProjection } from '../../domain/lending/current-projections'
import type { NormalizedCandidateV1 } from '../../shared/portable-collector-payload'
import { openPublicGithubCurrentBase } from '../../shared/db-less/current-base-github-release'
import { asDbLessCompositeBaseReader } from '../../shared/db-less/current-base-reader'
import { DbLessCompositeCurrentReader } from '../../shared/db-less/current-composite-reader'
import { openPublicGithubCurrentOverlay } from '../../shared/db-less/current-overlay-github-public'
import { readPublicIndexedCurrentTailAfterCheckpoint } from '../../shared/db-less/current-tail-github-public'
import { buildDbLessCurrentProjectionCanonicalKey } from '../../shared/db-less/current-projection-identity'
import type { VaultDetailResponse, VaultRecord } from '../types/api'

const REPOSITORY = 'badjoke-lab/xrpl-lending-monitor'
const D4_CHANNEL = 'db-less-current-overlay-channel-v1'
const D3_CHANNEL = 'db-less-live-channel-candidate-v1'
const MAX_FRESHNESS_AGE_MS = 15 * 60 * 1000

export interface StaticVaultDetailRead {
  response: VaultDetailResponse
  committedLedger: number
  checkpointLedger: number
  publicationUpdatedAt: string
  freshness: 'fresh' | 'stale'
}

function coefficientAtScale(value: ExactDecimal, scale: number): bigint {
  return parseInteger(value.coefficient) * 10n ** BigInt(scale - value.scale)
}

function utilizationBps(total: ExactDecimal, used: ExactDecimal): number | null {
  const zero = parseExactDecimal('0')
  if (compareExactDecimals(total, zero) <= 0 || compareExactDecimals(used, zero) < 0) {
    return null
  }
  const scale = Math.max(total.scale, used.scale)
  return Number(
    (coefficientAtScale(used, scale) * 10_000n)
    / coefficientAtScale(total, scale),
  )
}

export function serializeStaticVault(projection: VaultCurrentProjection): VaultRecord {
  const formula = 'used_assets = AssetsTotal - AssetsAvailable; utilization_bps = floor(used_assets / AssetsTotal * 10000)'
  let derived: VaultRecord['derived'] = {
    used_assets: null,
    utilization_bps: null,
    formula,
    provenance: 'unavailable',
  }
  try {
    const total = parseExactDecimal(projection.assetsTotal)
    const available = parseExactDecimal(projection.assetsAvailable)
    const used = subtractExactDecimals(total, available)
    const bps = utilizationBps(total, used)
    if (bps !== null) {
      derived = {
        used_assets: formatExactDecimal(used),
        utilization_bps: bps,
        formula,
        provenance: 'derived',
      }
    }
  } catch {
    // Invalid ledger quantities never become invented derived values.
  }
  return {
    id: projection.id,
    owner: projection.owner,
    account: projection.account,
    asset: projection.asset,
    assets_total: projection.assetsTotal,
    assets_available: projection.assetsAvailable,
    assets_maximum: projection.assetsMaximum,
    loss_unrealized: projection.lossUnrealized,
    share_mpt_id: projection.shareMptId,
    domain_id: projection.domainId,
    withdrawal_policy: projection.withdrawalPolicy,
    scale: projection.scale,
    flags: projection.flags,
    previous_transaction_hash: projection.previousTxHash,
    previous_ledger_index: projection.previousLedgerIndex,
    derived,
    provenance: { object: 'direct', derived: derived.provenance },
    raw: projection.raw,
  }
}

function assertVaultProjection(value: unknown, expectedId: string): VaultCurrentProjection {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || (value as Record<string, unknown>).kind !== 'vault'
    || (value as Record<string, unknown>).id !== expectedId
  ) {
    throw new Error('Verified static Vault projection does not match its identity')
  }
  return value as VaultCurrentProjection
}

export function resolveVaultTail(
  vaultId: string,
  generations: readonly { records: readonly NormalizedCandidateV1[] }[],
): { present: boolean; value: VaultCurrentProjection | null } {
  const key = buildDbLessCurrentProjectionCanonicalKey('vault', vaultId)
  let present = false
  let value: VaultCurrentProjection | null = null
  for (const generation of generations) {
    for (const record of generation.records) {
      if (record.semanticClass !== 'current-projection' || record.canonicalKey !== key) continue
      if (record.objectId !== vaultId) throw new Error('D3 Current Vault identity mismatch')
      present = true
      value = record.isTombstone ? null : assertVaultProjection(record.value, vaultId)
    }
  }
  return { present, value }
}

export async function loadStaticVaultDetail(
  vaultId: string,
  options: { fetcher?: typeof fetch; now?: () => number } = {},
): Promise<StaticVaultDetailRead> {
  if (!/^[A-Fa-f0-9]{64}$/.test(vaultId)) {
    throw new Error('Vault ID must be a 64-digit hexadecimal identifier')
  }
  const id = vaultId.toUpperCase()
  const overlay = await openPublicGithubCurrentOverlay({
    repository: REPOSITORY,
    channelReleaseTag: D4_CHANNEL,
    fetcher: options.fetcher,
  })
  const [base, tail] = await Promise.all([
    openPublicGithubCurrentBase({
      repository: REPOSITORY,
      releaseTag: overlay.channel.active.location.releaseTag.replace(
        /^db-less-current-overlay-v1-\d+$/,
        'd2-current-base-35558034659',
      ),
      fetcher: options.fetcher,
    }),
    readPublicIndexedCurrentTailAfterCheckpoint({
      repository: REPOSITORY,
      channelReleaseTag: D3_CHANNEL,
      checkpoint: overlay.manifest,
      fetcher: options.fetcher,
      maxMutationGenerations: 128,
    }),
  ])
  if (base.manifest.generationId !== overlay.manifest.baseIdentity) {
    throw new Error('D2 base identity does not match the verified D4 checkpoint')
  }
  if (tail.channel.base.generationId !== base.manifest.generationId) {
    throw new Error('D3 and D2 base identities do not match')
  }

  const recent = resolveVaultTail(id, tail.source.generations)
  let vault: VaultCurrentProjection | null = recent.value
  if (!recent.present) {
    const composite = new DbLessCompositeCurrentReader({
      overlay: overlay.reader,
      base: asDbLessCompositeBaseReader(base.reader),
    })
    const current = await composite.get('vault', id)
    vault = current.item
      ? assertVaultProjection(current.item.value, id)
      : null
  }

  const updatedMs = Date.parse(tail.channel.updatedAt)
  if (!Number.isFinite(updatedMs)) throw new Error('D3 channel publication timestamp is invalid')
  const ageMs = (options.now ?? Date.now)() - updatedMs
  const freshness = ageMs >= 0 && ageMs <= MAX_FRESHNESS_AGE_MS ? 'fresh' : 'stale'

  return {
    response: {
      network: 'devnet',
      kind: 'vault',
      epoch: { id: tail.channel.epochId, status: 'current' },
      snapshot: {
        id: base.manifest.snapshotId,
        epoch_id: base.manifest.epochId,
        ledger_index: base.manifest.ledgerIndex,
        ledger_hash: base.manifest.ledgerHash,
        completed_at: null,
      },
      data: vault ? serializeStaticVault(vault) : null,
      availability: { state: 'available', reason: null },
      provenance: { object: vault ? 'direct' : 'unavailable' },
    },
    committedLedger: tail.channel.lastCommittedLedgerIndex,
    checkpointLedger: overlay.manifest.throughLedgerIndex,
    publicationUpdatedAt: tail.channel.updatedAt,
    freshness,
  }
}
