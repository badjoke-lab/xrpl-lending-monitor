import type {
  PortableCollectorMaintenanceAdapter,
  PortableCollectorPublicationAdapter,
  PortableCollectorStorageAdapter,
  PortableMaintenanceMutationV1,
  PortableMaintenancePlanV1,
  PortablePublicationAssetV1,
  PortablePublicationCandidateV1,
  PortablePublicationWatermarkV1,
  PortablePublicationWorkIdentityV1,
  PortableVerifiedPublicationV1,
} from './portable-collector-adapters'
import {
  canonicalPortableJson,
  type PortableCollectorWorkSnapshot,
  type PortableReferenceRow,
  type PortableSqliteDatabase,
} from './portable-collector-reference-store'

interface PublicationCandidateRow {
  publication_id: string
  stream_id: string
  previous_publication_id: string | null
  status: string
  asset_json: string
  asset_digest: string
  manifest_json: string
  manifest_digest: string
  created_at: string
  verified_at: string | null
}

interface PublicationWorkRow {
  publication_id: string
  work_position: number
  work_id: string
  network: string
  epoch_id: string
  base_identity: string
  previous_ledger_index: number
  expected_parent_hash: string
  start_ledger_index: number
  end_ledger_index: number
  end_ledger_hash: string
  payload_digest: string
  semantic_counts_json: string
}

interface PublicationWatermarkRow {
  stream_id: string
  publication_id: string
  work_id: string
  ledger_index: number
  ledger_hash: string
  updated_at: string
}

interface MaintenancePlanRow {
  plan_id: string
  stream_id: string
  verified_publication_id: string
  status: string
  plan_json: string
  plan_digest: string
  created_at: string
  applied_at: string | null
}

interface MaintenanceMutationRow {
  plan_id: string
  mutation_index: number
  table_name: PortableMaintenanceMutationV1['table']
  work_id: string
  reason: PortableMaintenanceMutationV1['reason']
  status: string
  applied_at: string | null
}

interface CountRow {
  count: number
}

export interface SqlitePortablePublicationOptions {
  streamId: string
  network: string
  epochId: string
  baseIdentity: string
  initialPreviousLedgerIndex: number
  initialExpectedParentHash: string
  now: () => string
}

export class PortablePublicationMaintenanceError extends Error {
  constructor(
    readonly code:
      | 'invalid_configuration'
      | 'invalid_selection'
      | 'identity_conflict'
      | 'integrity_failure'
      | 'not_verified'
      | 'watermark_conflict'
      | 'invalid_plan',
    message: string,
  ) {
    super(message)
    this.name = 'PortablePublicationMaintenanceError'
  }
}

function requireString(value: string, name: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new PortablePublicationMaintenanceError(
      'invalid_configuration',
      `${name} is required`,
    )
  }
  return normalized
}

function requireSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PortablePublicationMaintenanceError(
      'invalid_configuration',
      `${name} must be a non-negative safe integer`,
    )
  }
  return value
}

function requirePositiveLimit(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new PortablePublicationMaintenanceError(
      'invalid_configuration',
      `${name} must be between 1 and ${maximum}`,
    )
  }
  return value
}

function requireHash(value: string, name: string): string {
  const normalized = requireString(value, name).toUpperCase()
  if (!/^[0-9A-F]{64}$/u.test(normalized)) {
    throw new PortablePublicationMaintenanceError(
      'integrity_failure',
      `${name} must be a 64-character hexadecimal hash`,
    )
  }
  return normalized
}

function requireTimestamp(value: string, name: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new PortablePublicationMaintenanceError(
      'invalid_configuration',
      `${name} must be a valid timestamp`,
    )
  }
  return parsed.toISOString()
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const input = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(input).set(bytes)
  return bytesToHex(
    new Uint8Array(await crypto.subtle.digest('SHA-256', input)),
  )
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return canonicalPortableJson(left) === canonicalPortableJson(right)
}

function mapPublicationWork(row: PublicationWorkRow): PortablePublicationWorkIdentityV1 {
  return {
    schemaVersion: 1,
    network: row.network,
    epochId: row.epoch_id,
    baseIdentity: row.base_identity,
    workId: row.work_id,
    previousLedgerIndex: row.previous_ledger_index,
    expectedParentHash: row.expected_parent_hash,
    startLedgerIndex: row.start_ledger_index,
    endLedgerIndex: row.end_ledger_index,
    endLedgerHash: row.end_ledger_hash,
    payloadDigest: row.payload_digest,
    semanticCountsJson: row.semantic_counts_json,
  }
}

function mapPublicationWatermark(
  row: PublicationWatermarkRow,
): PortablePublicationWatermarkV1 {
  return {
    schemaVersion: 1,
    streamId: row.stream_id,
    publicationId: row.publication_id,
    workId: row.work_id,
    ledgerIndex: row.ledger_index,
    ledgerHash: row.ledger_hash,
    updatedAt: row.updated_at,
  }
}

function committedIdentity(work: PortableCollectorWorkSnapshot): PortablePublicationWorkIdentityV1 {
  if (
    work.status !== 'committed' ||
    work.committedAt === null ||
    work.scannedEndLedgerIndex === null ||
    work.finalLedgerHash === null ||
    work.payloadDigest === null ||
    work.semanticCountsJson === null
  ) {
    throw new PortablePublicationMaintenanceError(
      'integrity_failure',
      `work is not publication-complete: ${work.workId}`,
    )
  }
  return {
    schemaVersion: 1,
    network: work.network,
    epochId: work.epochId,
    baseIdentity: work.baseIdentity,
    workId: work.workId,
    previousLedgerIndex: work.previousLedgerIndex,
    expectedParentHash: requireHash(work.expectedParentHash, 'expectedParentHash'),
    startLedgerIndex: work.startLedgerIndex,
    endLedgerIndex: work.scannedEndLedgerIndex,
    endLedgerHash: requireHash(work.finalLedgerHash, 'finalLedgerHash'),
    payloadDigest: requireString(work.payloadDigest, 'payloadDigest'),
    semanticCountsJson: requireString(
      work.semanticCountsJson,
      'semanticCountsJson',
    ),
  }
}

function validateSequence(options: {
  works: readonly PortablePublicationWorkIdentityV1[]
  previousLedgerIndex: number
  expectedParentHash: string
}): void {
  let previousLedgerIndex = options.previousLedgerIndex
  let expectedParentHash = requireHash(
    options.expectedParentHash,
    'sequence expectedParentHash',
  )
  for (const work of options.works) {
    if (
      work.previousLedgerIndex !== previousLedgerIndex ||
      work.startLedgerIndex !== previousLedgerIndex + 1 ||
      requireHash(work.expectedParentHash, 'work expectedParentHash') !==
        expectedParentHash ||
      work.endLedgerIndex < work.startLedgerIndex
    ) {
      throw new PortablePublicationMaintenanceError(
        'invalid_selection',
        `publication work sequence is not contiguous at ${work.workId}`,
      )
    }
    previousLedgerIndex = work.endLedgerIndex
    expectedParentHash = requireHash(work.endLedgerHash, 'work endLedgerHash')
  }
}

function parseCanonicalJson<T>(value: string, name: string): T {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new PortablePublicationMaintenanceError(
      'integrity_failure',
      `${name} is not valid JSON`,
    )
  }
  if (canonicalPortableJson(parsed) !== value) {
    throw new PortablePublicationMaintenanceError(
      'integrity_failure',
      `${name} is not canonical JSON`,
    )
  }
  return parsed as T
}

export class SqlitePortableCollectorPublicationMaintenanceAdapter
implements PortableCollectorPublicationAdapter, PortableCollectorMaintenanceAdapter {
  private readonly streamId: string
  private readonly network: string
  private readonly epochId: string
  private readonly baseIdentity: string
  private readonly initialPreviousLedgerIndex: number
  private readonly initialExpectedParentHash: string

  constructor(
    private readonly db: PortableSqliteDatabase,
    private readonly storage: PortableCollectorStorageAdapter,
    private readonly options: SqlitePortablePublicationOptions,
  ) {
    this.streamId = requireString(options.streamId, 'streamId')
    this.network = requireString(options.network, 'network')
    this.epochId = requireString(options.epochId, 'epochId')
    this.baseIdentity = requireString(options.baseIdentity, 'baseIdentity')
    this.initialPreviousLedgerIndex = requireSafeInteger(
      options.initialPreviousLedgerIndex,
      'initialPreviousLedgerIndex',
    )
    this.initialExpectedParentHash = requireHash(
      options.initialExpectedParentHash,
      'initialExpectedParentHash',
    )
    requireTimestamp(options.now(), 'now')
  }

  getPublicationWatermark(): PortablePublicationWatermarkV1 | undefined {
    const row = this.db.get<PublicationWatermarkRow>(
      `SELECT stream_id, publication_id, work_id, ledger_index, ledger_hash, updated_at
       FROM collector_publication_watermarks
       WHERE stream_id = ?`,
      [this.streamId],
    )
    return row ? mapPublicationWatermark(row) : undefined
  }

  selectCommittedAfter(options: {
    publicationWatermarkWorkId: string | null
    limit: number
  }): PortablePublicationWorkIdentityV1[] {
    const limit = requirePositiveLimit(options.limit, 'limit', 1_000)
    const watermark = this.getPublicationWatermark()
    if ((watermark?.workId ?? null) !== options.publicationWatermarkWorkId) {
      throw new PortablePublicationMaintenanceError(
        'watermark_conflict',
        'requested publication watermark does not match stored state',
      )
    }

    const rows = this.db.all<{ work_id: string }>(
      `SELECT work_id
       FROM collector_work
       WHERE network = ? AND epoch_id = ? AND base_identity = ?
         AND status = 'committed'
       ORDER BY scanned_end_ledger_index, work_id`,
      [this.network, this.epochId, this.baseIdentity],
    )
    const works = rows.map((row) => {
      const work = this.storage.getWork(row.work_id)
      if (!work) {
        throw new PortablePublicationMaintenanceError(
          'integrity_failure',
          `committed work is missing: ${row.work_id}`,
        )
      }
      return committedIdentity(work)
    })

    validateSequence({
      works,
      previousLedgerIndex: this.initialPreviousLedgerIndex,
      expectedParentHash: this.initialExpectedParentHash,
    })

    let start = 0
    if (watermark) {
      start = works.findIndex((work) => work.workId === watermark.workId) + 1
      if (start === 0) {
        throw new PortablePublicationMaintenanceError(
          'integrity_failure',
          `publication watermark work is missing: ${watermark.workId}`,
        )
      }
    }
    return works.slice(start, start + limit)
  }

  async buildCandidate(
    works: readonly PortablePublicationWorkIdentityV1[],
  ): Promise<PortablePublicationCandidateV1> {
    if (works.length === 0) {
      throw new PortablePublicationMaintenanceError(
        'invalid_selection',
        'publication candidate requires at least one work',
      )
    }
    const watermark = this.getPublicationWatermark()
    const selected = this.selectCommittedAfter({
      publicationWatermarkWorkId: watermark?.workId ?? null,
      limit: works.length,
    })
    if (!canonicalEqual(selected, works)) {
      throw new PortablePublicationMaintenanceError(
        'identity_conflict',
        'publication candidate works do not match committed selection',
      )
    }

    const asset = this.buildAsset(selected)
    const assetJson = canonicalPortableJson(asset)
    const assetDigest = await sha256Hex(assetJson)
    const previousPublicationId = watermark?.publicationId ?? null
    const manifestJson = canonicalPortableJson({
      schemaVersion: 1,
      streamId: this.streamId,
      previousPublicationId,
      works: selected,
      assetDigest,
    })
    const manifestDigest = await sha256Hex(manifestJson)
    const publicationId = `publication:v1:${manifestDigest}`
    const createdAt = requireTimestamp(this.options.now(), 'createdAt')

    this.db.transaction(() => {
      this.db.run(
        `INSERT OR IGNORE INTO collector_publication_candidates (
           publication_id, stream_id, previous_publication_id, status,
           asset_json, asset_digest, manifest_json, manifest_digest,
           created_at, verified_at
         ) VALUES (?, ?, ?, 'candidate', ?, ?, ?, ?, ?, NULL)`,
        [
          publicationId,
          this.streamId,
          previousPublicationId,
          assetJson,
          assetDigest,
          manifestJson,
          manifestDigest,
          createdAt,
        ],
      )
      for (const [position, work] of selected.entries()) {
        this.db.run(
          `INSERT OR IGNORE INTO collector_publication_works (
             publication_id, work_position, work_id, network, epoch_id,
             base_identity, previous_ledger_index, expected_parent_hash,
             start_ledger_index, end_ledger_index, end_ledger_hash,
             payload_digest, semantic_counts_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            publicationId,
            position,
            work.workId,
            work.network,
            work.epochId,
            work.baseIdentity,
            work.previousLedgerIndex,
            work.expectedParentHash,
            work.startLedgerIndex,
            work.endLedgerIndex,
            work.endLedgerHash,
            work.payloadDigest,
            work.semanticCountsJson,
          ],
        )
      }
    })

    const stored = this.getCandidate(publicationId)
    if (!stored) {
      throw new PortablePublicationMaintenanceError(
        'integrity_failure',
        `publication candidate was not stored: ${publicationId}`,
      )
    }
    const expected = {
      schemaVersion: 1 as const,
      publicationId,
      previousPublicationId,
      works: selected,
      assetJson,
      assetDigest,
      manifestJson,
      manifestDigest,
      createdAt: stored.createdAt,
    }
    if (!canonicalEqual(stored, expected)) {
      throw new PortablePublicationMaintenanceError(
        'identity_conflict',
        `publication candidate identity conflict: ${publicationId}`,
      )
    }
    return stored
  }

  getCandidate(publicationId: string): PortablePublicationCandidateV1 | undefined {
    const row = this.db.get<PublicationCandidateRow>(
      `SELECT publication_id, stream_id, previous_publication_id, status,
              asset_json, asset_digest, manifest_json, manifest_digest,
              created_at, verified_at
       FROM collector_publication_candidates
       WHERE publication_id = ? AND stream_id = ?`,
      [publicationId, this.streamId],
    )
    if (!row) return undefined
    const works = this.db.all<PublicationWorkRow>(
      `SELECT publication_id, work_position, work_id, network, epoch_id,
              base_identity, previous_ledger_index, expected_parent_hash,
              start_ledger_index, end_ledger_index, end_ledger_hash,
              payload_digest, semantic_counts_json
       FROM collector_publication_works
       WHERE publication_id = ?
       ORDER BY work_position`,
      [publicationId],
    ).map(mapPublicationWork)
    return {
      schemaVersion: 1,
      publicationId: row.publication_id,
      previousPublicationId: row.previous_publication_id,
      works,
      assetJson: row.asset_json,
      assetDigest: row.asset_digest,
      manifestJson: row.manifest_json,
      manifestDigest: row.manifest_digest,
      createdAt: row.created_at,
    }
  }

  async verifyCandidate(
    candidate: PortablePublicationCandidateV1,
  ): Promise<PortableVerifiedPublicationV1> {
    const stored = this.getCandidate(candidate.publicationId)
    if (!stored || !canonicalEqual(stored, candidate)) {
      throw new PortablePublicationMaintenanceError(
        'identity_conflict',
        `publication candidate does not match stored artifact: ${candidate.publicationId}`,
      )
    }

    const rebuiltAssetJson = canonicalPortableJson(this.buildAsset(stored.works))
    if (rebuiltAssetJson !== stored.assetJson) {
      throw new PortablePublicationMaintenanceError(
        'integrity_failure',
        'reopened publication asset does not match committed source rows',
      )
    }
    parseCanonicalJson<PortablePublicationAssetV1>(stored.assetJson, 'assetJson')
    if ((await sha256Hex(stored.assetJson)) !== stored.assetDigest) {
      throw new PortablePublicationMaintenanceError(
        'integrity_failure',
        'publication asset digest mismatch',
      )
    }

    const expectedManifestJson = canonicalPortableJson({
      schemaVersion: 1,
      streamId: this.streamId,
      previousPublicationId: stored.previousPublicationId,
      works: stored.works,
      assetDigest: stored.assetDigest,
    })
    if (stored.manifestJson !== expectedManifestJson) {
      throw new PortablePublicationMaintenanceError(
        'integrity_failure',
        'publication manifest does not match candidate identity',
      )
    }
    parseCanonicalJson<Record<string, unknown>>(stored.manifestJson, 'manifestJson')
    const manifestDigest = await sha256Hex(stored.manifestJson)
    if (
      manifestDigest !== stored.manifestDigest ||
      stored.publicationId !== `publication:v1:${manifestDigest}`
    ) {
      throw new PortablePublicationMaintenanceError(
        'integrity_failure',
        'publication manifest digest or ID mismatch',
      )
    }

    const current = this.db.get<PublicationCandidateRow>(
      `SELECT publication_id, stream_id, previous_publication_id, status,
              asset_json, asset_digest, manifest_json, manifest_digest,
              created_at, verified_at
       FROM collector_publication_candidates
       WHERE publication_id = ?`,
      [stored.publicationId],
    )
    if (!current) {
      throw new PortablePublicationMaintenanceError(
        'integrity_failure',
        'publication candidate disappeared during verification',
      )
    }
    const verifiedAt = current.verified_at ?? requireTimestamp(this.options.now(), 'verifiedAt')
    this.db.run(
      `UPDATE collector_publication_candidates
       SET status = 'verified', verified_at = COALESCE(verified_at, ?)
       WHERE publication_id = ? AND status IN ('candidate', 'verified')`,
      [verifiedAt, stored.publicationId],
    )
    return { ...stored, verifiedAt }
  }

  advancePublicationWatermark(
    publication: PortableVerifiedPublicationV1,
  ): PortablePublicationWatermarkV1 {
    const candidate = this.db.get<PublicationCandidateRow>(
      `SELECT publication_id, stream_id, previous_publication_id, status,
              asset_json, asset_digest, manifest_json, manifest_digest,
              created_at, verified_at
       FROM collector_publication_candidates
       WHERE publication_id = ? AND stream_id = ?`,
      [publication.publicationId, this.streamId],
    )
    if (
      !candidate ||
      candidate.status !== 'verified' ||
      candidate.verified_at === null ||
      candidate.verified_at !== publication.verifiedAt
    ) {
      throw new PortablePublicationMaintenanceError(
        'not_verified',
        `publication is not independently verified: ${publication.publicationId}`,
      )
    }
    const stored = this.getCandidate(publication.publicationId)
    if (!stored || !canonicalEqual({ ...stored, verifiedAt: publication.verifiedAt }, publication)) {
      throw new PortablePublicationMaintenanceError(
        'identity_conflict',
        'verified publication identity does not match stored candidate',
      )
    }

    const current = this.getPublicationWatermark()
    if (current?.publicationId === publication.publicationId) return current
    if ((current?.publicationId ?? null) !== publication.previousPublicationId) {
      throw new PortablePublicationMaintenanceError(
        'watermark_conflict',
        'publication does not extend the current publication watermark',
      )
    }
    const last = publication.works.at(-1)
    if (!last) {
      throw new PortablePublicationMaintenanceError(
        'invalid_selection',
        'verified publication contains no work',
      )
    }
    const collection = this.storage.getWatermark(
      this.network,
      this.epochId,
      this.baseIdentity,
    )
    if (
      !collection ||
      collection.ledgerIndex < last.endLedgerIndex ||
      (collection.ledgerIndex === last.endLedgerIndex &&
        collection.ledgerHash !== last.endLedgerHash)
    ) {
      throw new PortablePublicationMaintenanceError(
        'watermark_conflict',
        'collection watermark does not cover the verified publication',
      )
    }
    const updatedAt = requireTimestamp(this.options.now(), 'publication updatedAt')
    this.db.run(
      `INSERT INTO collector_publication_watermarks (
         stream_id, publication_id, work_id, ledger_index, ledger_hash, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (stream_id) DO UPDATE SET
         publication_id = excluded.publication_id,
         work_id = excluded.work_id,
         ledger_index = excluded.ledger_index,
         ledger_hash = excluded.ledger_hash,
         updated_at = excluded.updated_at`,
      [
        this.streamId,
        publication.publicationId,
        last.workId,
        last.endLedgerIndex,
        last.endLedgerHash,
        updatedAt,
      ],
    )
    const watermark = this.getPublicationWatermark()
    if (!watermark || watermark.publicationId !== publication.publicationId) {
      throw new PortablePublicationMaintenanceError(
        'integrity_failure',
        'publication watermark did not advance',
      )
    }
    return watermark
  }

  getPlan(planId: string): PortableMaintenancePlanV1 | undefined {
    const row = this.db.get<MaintenancePlanRow>(
      `SELECT plan_id, stream_id, verified_publication_id, status,
              plan_json, plan_digest, created_at, applied_at
       FROM collector_maintenance_plans
       WHERE plan_id = ? AND stream_id = ?`,
      [planId, this.streamId],
    )
    if (!row) return undefined
    const mutations = this.db.all<MaintenanceMutationRow>(
      `SELECT plan_id, mutation_index, table_name, work_id, reason, status, applied_at
       FROM collector_maintenance_mutations
       WHERE plan_id = ?
       ORDER BY mutation_index`,
      [planId],
    ).map((mutation) => ({
      table: mutation.table_name,
      workId: mutation.work_id,
      reason: mutation.reason,
    }))
    return {
      schemaVersion: 1,
      planId: row.plan_id,
      verifiedPublicationId: row.verified_publication_id,
      planJson: row.plan_json,
      planDigest: row.plan_digest,
      mutations,
      createdAt: row.created_at,
    }
  }

  async buildPlan(options: {
    verifiedPublication: PortableVerifiedPublicationV1
    retainCommittedWorks: number
    maxMutations: number
  }): Promise<PortableMaintenancePlanV1> {
    const retainCommittedWorks = requireSafeInteger(
      options.retainCommittedWorks,
      'retainCommittedWorks',
    )
    const maxMutations = requirePositiveLimit(
      options.maxMutations,
      'maxMutations',
      1_000,
    )
    const watermark = this.getPublicationWatermark()
    if (
      !watermark ||
      watermark.publicationId !== options.verifiedPublication.publicationId
    ) {
      throw new PortablePublicationMaintenanceError(
        'watermark_conflict',
        'maintenance requires the verified publication to be the publication watermark',
      )
    }
    const candidate = this.db.get<PublicationCandidateRow>(
      `SELECT publication_id, stream_id, previous_publication_id, status,
              asset_json, asset_digest, manifest_json, manifest_digest,
              created_at, verified_at
       FROM collector_publication_candidates
       WHERE publication_id = ? AND stream_id = ?`,
      [options.verifiedPublication.publicationId, this.streamId],
    )
    if (
      !candidate ||
      candidate.status !== 'verified' ||
      candidate.verified_at !== options.verifiedPublication.verifiedAt
    ) {
      throw new PortablePublicationMaintenanceError(
        'not_verified',
        'maintenance publication is not independently verified',
      )
    }

    const committedWorkIds = this.db.all<{ work_id: string; end_ledger_index: number }>(
      `SELECT work_id, scanned_end_ledger_index AS end_ledger_index
       FROM collector_work
       WHERE network = ? AND epoch_id = ? AND base_identity = ?
         AND status = 'committed'
       ORDER BY scanned_end_ledger_index, work_id`,
      [this.network, this.epochId, this.baseIdentity],
    )
    const retained = new Set(
      committedWorkIds.slice(Math.max(0, committedWorkIds.length - retainCommittedWorks))
        .map((work) => work.work_id),
    )
    const eligible = committedWorkIds.filter(
      (work) => work.end_ledger_index <= watermark.ledgerIndex && !retained.has(work.work_id),
    )

    const mutations: PortableMaintenanceMutationV1[] = []
    for (const work of eligible) {
      for (const table of [
        'collector_payload_chunks',
        'collector_commit_chunks',
      ] as const) {
        if (mutations.length >= maxMutations) break
        const count = this.db.get<CountRow>(
          `SELECT COUNT(*) AS count FROM ${table} WHERE work_id = ?`,
          [work.work_id],
        )?.count ?? 0
        if (count > 0) {
          mutations.push({
            table,
            workId: work.work_id,
            reason: 'verified_publication_retention',
          })
        }
      }
      if (mutations.length >= maxMutations) break
    }

    const planJson = canonicalPortableJson({
      schemaVersion: 1,
      streamId: this.streamId,
      verifiedPublicationId: options.verifiedPublication.publicationId,
      mutations,
    })
    const planDigest = await sha256Hex(planJson)
    const planId = `maintenance:v1:${planDigest}`
    const createdAt = requireTimestamp(this.options.now(), 'maintenance createdAt')

    this.db.transaction(() => {
      this.db.run(
        `INSERT OR IGNORE INTO collector_maintenance_plans (
           plan_id, stream_id, verified_publication_id, status,
           plan_json, plan_digest, created_at, applied_at
         ) VALUES (?, ?, ?, 'planned', ?, ?, ?, NULL)`,
        [
          planId,
          this.streamId,
          options.verifiedPublication.publicationId,
          planJson,
          planDigest,
          createdAt,
        ],
      )
      for (const [index, mutation] of mutations.entries()) {
        this.db.run(
          `INSERT OR IGNORE INTO collector_maintenance_mutations (
             plan_id, mutation_index, table_name, work_id, reason,
             status, applied_at
           ) VALUES (?, ?, ?, ?, ?, 'planned', NULL)`,
          [
            planId,
            index,
            mutation.table,
            mutation.workId,
            mutation.reason,
          ],
        )
      }
    })

    const stored = this.getPlan(planId)
    if (!stored) {
      throw new PortablePublicationMaintenanceError(
        'integrity_failure',
        'maintenance plan was not stored',
      )
    }
    const expected = {
      schemaVersion: 1 as const,
      planId,
      verifiedPublicationId: options.verifiedPublication.publicationId,
      planJson,
      planDigest,
      mutations,
      createdAt: stored.createdAt,
    }
    if (!canonicalEqual(stored, expected)) {
      throw new PortablePublicationMaintenanceError(
        'identity_conflict',
        `maintenance plan identity conflict: ${planId}`,
      )
    }
    return stored
  }

  applyPlan(plan: PortableMaintenancePlanV1): { appliedMutations: number } {
    const stored = this.getPlan(plan.planId)
    if (!stored || !canonicalEqual(stored, plan)) {
      throw new PortablePublicationMaintenanceError(
        'identity_conflict',
        `maintenance plan does not match stored plan: ${plan.planId}`,
      )
    }
    const row = this.db.get<MaintenancePlanRow>(
      `SELECT plan_id, stream_id, verified_publication_id, status,
              plan_json, plan_digest, created_at, applied_at
       FROM collector_maintenance_plans
       WHERE plan_id = ?`,
      [plan.planId],
    )
    if (!row) {
      throw new PortablePublicationMaintenanceError(
        'invalid_plan',
        `maintenance plan is missing: ${plan.planId}`,
      )
    }
    if (row.status === 'applied') return { appliedMutations: 0 }
    const parsed = parseCanonicalJson<Record<string, unknown>>(plan.planJson, 'planJson')
    if (
      canonicalPortableJson(parsed) !== plan.planJson ||
      !plan.planId.endsWith(plan.planDigest)
    ) {
      throw new PortablePublicationMaintenanceError(
        'invalid_plan',
        'maintenance plan digest identity is invalid',
      )
    }

    const watermark = this.getPublicationWatermark()
    if (!watermark) {
      throw new PortablePublicationMaintenanceError(
        'watermark_conflict',
        'maintenance requires a publication watermark',
      )
    }
    const publication = this.db.get<PublicationCandidateRow>(
      `SELECT publication_id, stream_id, previous_publication_id, status,
              asset_json, asset_digest, manifest_json, manifest_digest,
              created_at, verified_at
       FROM collector_publication_candidates
       WHERE publication_id = ? AND stream_id = ?`,
      [plan.verifiedPublicationId, this.streamId],
    )
    if (!publication || publication.status !== 'verified') {
      throw new PortablePublicationMaintenanceError(
        'not_verified',
        'maintenance plan publication is not verified',
      )
    }

    let appliedMutations = 0
    const appliedAt = requireTimestamp(this.options.now(), 'maintenance appliedAt')
    this.db.transaction(() => {
      for (const [index, mutation] of plan.mutations.entries()) {
        const work = this.storage.getWork(mutation.workId)
        if (
          !work ||
          work.status !== 'committed' ||
          work.scannedEndLedgerIndex === null ||
          work.scannedEndLedgerIndex > watermark.ledgerIndex
        ) {
          throw new PortablePublicationMaintenanceError(
            'watermark_conflict',
            `publication watermark does not cover maintenance work: ${mutation.workId}`,
          )
        }
        const mutationRow = this.db.get<MaintenanceMutationRow>(
          `SELECT plan_id, mutation_index, table_name, work_id, reason, status, applied_at
           FROM collector_maintenance_mutations
           WHERE plan_id = ? AND mutation_index = ?`,
          [plan.planId, index],
        )
        if (
          !mutationRow ||
          mutationRow.table_name !== mutation.table ||
          mutationRow.work_id !== mutation.workId ||
          mutationRow.reason !== mutation.reason
        ) {
          throw new PortablePublicationMaintenanceError(
            'identity_conflict',
            `maintenance mutation identity conflict at index ${index}`,
          )
        }
        if (mutationRow.status === 'applied') continue
        if (mutation.table === 'collector_payload_chunks') {
          this.db.run(
            'DELETE FROM collector_payload_chunks WHERE work_id = ?',
            [mutation.workId],
          )
        } else if (mutation.table === 'collector_commit_chunks') {
          this.db.run(
            'DELETE FROM collector_commit_chunks WHERE work_id = ?',
            [mutation.workId],
          )
        } else {
          throw new PortablePublicationMaintenanceError(
            'invalid_plan',
            `unsupported maintenance table: ${String(mutation.table)}`,
          )
        }
        this.db.run(
          `UPDATE collector_maintenance_mutations
           SET status = 'applied', applied_at = ?
           WHERE plan_id = ? AND mutation_index = ? AND status = 'planned'`,
          [appliedAt, plan.planId, index],
        )
        appliedMutations += 1
      }
      this.db.run(
        `UPDATE collector_maintenance_plans
         SET status = 'applied', applied_at = ?
         WHERE plan_id = ? AND status = 'planned'`,
        [appliedAt, plan.planId],
      )
    })
    return { appliedMutations }
  }

  private buildAsset(
    works: readonly PortablePublicationWorkIdentityV1[],
  ): PortablePublicationAssetV1 {
    const entries = works.map((identity) => {
      const current = this.storage.getWork(identity.workId)
      if (!current || !canonicalEqual(committedIdentity(current), identity)) {
        throw new PortablePublicationMaintenanceError(
          'identity_conflict',
          `publication work no longer matches committed identity: ${identity.workId}`,
        )
      }
      const rows = this.storage.listReferenceRowsForWork(identity.workId)
      for (const row of rows) {
        if (row.workId !== identity.workId) {
          throw new PortablePublicationMaintenanceError(
            'integrity_failure',
            `publication row belongs to another work: ${row.canonicalKey}`,
          )
        }
      }
      return {
        work: identity,
        rows: rows.map((row: PortableReferenceRow) => structuredClone(row)),
      }
    })
    return { schemaVersion: 1, works: entries }
  }
}
