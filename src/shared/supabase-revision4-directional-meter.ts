import { canonicalPortableJson } from './portable-collector-reference-store'
import {
  summarizeSupabaseRevision4DirectionalBytes,
  SUPABASE_REVISION4_PROFILE,
  SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST,
  type SupabaseRevision4BoundaryId,
  type SupabaseRevision4DirectionalByteObservation,
} from './supabase-revision4-directional-egress-contract'

const TEXT_ENCODER = new TextEncoder()

export type SupabaseRevision4AccountingDisposition =
  | 'shadow_completed'
  | 'shadow_failed'
  | 'shadow_retry'
  | 'shadow_repair'
  | 'shadow_adopted'

export interface SupabaseRevision4MeterObservation
  extends SupabaseRevision4DirectionalByteObservation {
  schemaVersion: 1
  sequence: number
  operationId: string
}

export interface SupabaseRevision4MemorySupplementalInput {
  canonicalJsonBytes: number
  payloadBytes: number
  normalizedObjectOverheadBytes: number
  allocatorReserveBytes: number
}

export interface SupabaseRevision4DirectionalAccountingInput {
  schemaVersion: 1
  observationId: string
  attemptId: string
  observedAt: string
  disposition: SupabaseRevision4AccountingDisposition
  observations: readonly SupabaseRevision4MeterObservation[]
  memorySupplemental: SupabaseRevision4MemorySupplementalInput
  unexplainedDirectionalDeltaReserveBytes: number
  recoveryMutationCommitted: false
  publicReaderUnchanged: true
  mainnetDisabled: true
  stabilizationAuthorized: false
  soakAuthorized: false
}

export interface SupabaseRevision4DirectionalAccounting {
  schemaVersion: 1
  profileId: typeof SUPABASE_REVISION4_PROFILE.profileId
  profileRevision: typeof SUPABASE_REVISION4_PROFILE.revision
  profileIdentityDigest: typeof SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST
  observationId: string
  attemptId: string
  observedAt: string
  disposition: SupabaseRevision4AccountingDisposition
  observations: SupabaseRevision4MeterObservation[]
  directionalSummary: ReturnType<typeof summarizeSupabaseRevision4DirectionalBytes>
  memorySupplemental: SupabaseRevision4MemorySupplementalInput
  unexplainedDirectionalDeltaReserveBytes: number
  rollingBillableEgressUpperBoundBytes: number
  memoryTransportUpperBoundBytes: number
  checks: {
    exactProfileIdentityBound: true
    canonicalAccountingJsonRetained: true
    everyObservationDirectionBoundByContract: true
    inboundBytesRemainInMemoryTransport: true
    blanketAllDirectionMultiplierUsed: false
    recoveryMutationCommitted: false
    publicReaderUnchanged: true
    mainnetDisabled: true
    stabilizationAuthorized: false
    soakAuthorized: false
  }
}

export interface SupabaseRevision4DirectionalAccountingEvidence {
  accounting: SupabaseRevision4DirectionalAccounting
  accountingJson: string
  accountingDigest: string
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
  return value
}

function safeAdd(name: string, values: readonly number[]): number {
  let result = 0
  for (const [index, value] of values.entries()) {
    nonNegativeInteger(value, `${name}[${index}]`)
    result += value
    if (!Number.isSafeInteger(result) || result < 0) {
      throw new Error(`${name} exceeds the safe integer range`)
    }
  }
  return result
}

function exactIdentifier(value: string, name: string): string {
  const normalized = value.trim()
  if (!/^[a-z0-9][a-z0-9._:-]{2,159}$/u.test(normalized)) {
    throw new Error(`${name} must be a stable non-secret identifier`)
  }
  return normalized
}

function exactObservedAt(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) {
    throw new Error('observedAt must be a canonical UTC timestamp')
  }
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error('observedAt must be a valid timestamp')
  }
  return value
}

function exactDisposition(
  value: SupabaseRevision4AccountingDisposition,
): SupabaseRevision4AccountingDisposition {
  if (![
    'shadow_completed',
    'shadow_failed',
    'shadow_retry',
    'shadow_repair',
    'shadow_adopted',
  ].includes(value)) {
    throw new Error('disposition is unsupported')
  }
  return value
}

function copyObservation(
  observation: SupabaseRevision4MeterObservation,
): SupabaseRevision4MeterObservation {
  return {
    schemaVersion: 1,
    sequence: nonNegativeInteger(observation.sequence, 'observation.sequence'),
    operationId: exactIdentifier(observation.operationId, 'observation.operationId'),
    boundaryId: observation.boundaryId,
    bodyBytes: nonNegativeInteger(observation.bodyBytes, 'observation.bodyBytes'),
    framingReserveBytes: nonNegativeInteger(
      observation.framingReserveBytes,
      'observation.framingReserveBytes',
    ),
  }
}

function validateObservationSequence(
  observations: readonly SupabaseRevision4MeterObservation[],
): SupabaseRevision4MeterObservation[] {
  const operationIds = new Set<string>()
  return observations.map((raw, index) => {
    const observation = copyObservation(raw)
    if (observation.sequence !== index) {
      throw new Error('observation sequence must be contiguous from zero')
    }
    if (operationIds.has(observation.operationId)) {
      throw new Error(`operationId is duplicated: ${observation.operationId}`)
    }
    operationIds.add(observation.operationId)
    return observation
  })
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = TEXT_ENCODER.encode(value)
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function utf8ByteLength(value: string): number {
  return TEXT_ENCODER.encode(value).byteLength
}

export class SupabaseRevision4DirectionalMeter {
  readonly #observations: SupabaseRevision4MeterObservation[] = []
  readonly #operationIds = new Set<string>()

  recordUtf8(options: {
    operationId: string
    boundaryId: SupabaseRevision4BoundaryId
    body: string
    framingReserveBytes: number
  }): SupabaseRevision4MeterObservation {
    return this.recordBytes({
      operationId: options.operationId,
      boundaryId: options.boundaryId,
      bodyBytes: utf8ByteLength(options.body),
      framingReserveBytes: options.framingReserveBytes,
    })
  }

  recordBytes(options: {
    operationId: string
    boundaryId: SupabaseRevision4BoundaryId
    bodyBytes: number
    framingReserveBytes: number
  }): SupabaseRevision4MeterObservation {
    const operationId = exactIdentifier(options.operationId, 'operationId')
    if (this.#operationIds.has(operationId)) {
      throw new Error(`operationId is duplicated: ${operationId}`)
    }
    const observation: SupabaseRevision4MeterObservation = {
      schemaVersion: 1,
      sequence: this.#observations.length,
      operationId,
      boundaryId: options.boundaryId,
      bodyBytes: nonNegativeInteger(options.bodyBytes, 'bodyBytes'),
      framingReserveBytes: nonNegativeInteger(
        options.framingReserveBytes,
        'framingReserveBytes',
      ),
    }
    summarizeSupabaseRevision4DirectionalBytes([observation])
    this.#operationIds.add(operationId)
    this.#observations.push(observation)
    return { ...observation }
  }

  snapshot(): SupabaseRevision4MeterObservation[] {
    return this.#observations.map((observation) => ({ ...observation }))
  }
}

export async function buildSupabaseRevision4DirectionalAccountingEvidence(
  input: SupabaseRevision4DirectionalAccountingInput,
): Promise<SupabaseRevision4DirectionalAccountingEvidence> {
  if (input.schemaVersion !== 1) {
    throw new Error('schemaVersion must be 1')
  }
  if (input.recoveryMutationCommitted !== false) {
    throw new Error('G2 accounting must not commit recovery mutation')
  }
  if (
    input.publicReaderUnchanged !== true
    || input.mainnetDisabled !== true
    || input.stabilizationAuthorized !== false
    || input.soakAuthorized !== false
  ) {
    throw new Error('G2 safety boundary changed')
  }

  const observations = validateObservationSequence(input.observations)
  const directionalSummary = summarizeSupabaseRevision4DirectionalBytes(observations)
  const memorySupplemental = {
    canonicalJsonBytes: nonNegativeInteger(
      input.memorySupplemental.canonicalJsonBytes,
      'memorySupplemental.canonicalJsonBytes',
    ),
    payloadBytes: nonNegativeInteger(
      input.memorySupplemental.payloadBytes,
      'memorySupplemental.payloadBytes',
    ),
    normalizedObjectOverheadBytes: nonNegativeInteger(
      input.memorySupplemental.normalizedObjectOverheadBytes,
      'memorySupplemental.normalizedObjectOverheadBytes',
    ),
    allocatorReserveBytes: nonNegativeInteger(
      input.memorySupplemental.allocatorReserveBytes,
      'memorySupplemental.allocatorReserveBytes',
    ),
  }
  const unexplainedDirectionalDeltaReserveBytes = nonNegativeInteger(
    input.unexplainedDirectionalDeltaReserveBytes,
    'unexplainedDirectionalDeltaReserveBytes',
  )
  const rollingBillableEgressUpperBoundBytes = safeAdd(
    'rollingBillableEgressUpperBoundBytes',
    [
      directionalSummary.rollingBillableEgressUpperBoundBytes,
      unexplainedDirectionalDeltaReserveBytes,
    ],
  )
  const memoryTransportUpperBoundBytes = safeAdd('memoryTransportUpperBoundBytes', [
    directionalSummary.memoryTransportBytes,
    memorySupplemental.canonicalJsonBytes,
    memorySupplemental.payloadBytes,
    memorySupplemental.normalizedObjectOverheadBytes,
    memorySupplemental.allocatorReserveBytes,
  ])

  const accounting: SupabaseRevision4DirectionalAccounting = {
    schemaVersion: 1,
    profileId: SUPABASE_REVISION4_PROFILE.profileId,
    profileRevision: SUPABASE_REVISION4_PROFILE.revision,
    profileIdentityDigest: SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST,
    observationId: exactIdentifier(input.observationId, 'observationId'),
    attemptId: exactIdentifier(input.attemptId, 'attemptId'),
    observedAt: exactObservedAt(input.observedAt),
    disposition: exactDisposition(input.disposition),
    observations,
    directionalSummary,
    memorySupplemental,
    unexplainedDirectionalDeltaReserveBytes,
    rollingBillableEgressUpperBoundBytes,
    memoryTransportUpperBoundBytes,
    checks: {
      exactProfileIdentityBound: true,
      canonicalAccountingJsonRetained: true,
      everyObservationDirectionBoundByContract: true,
      inboundBytesRemainInMemoryTransport: true,
      blanketAllDirectionMultiplierUsed: false,
      recoveryMutationCommitted: false,
      publicReaderUnchanged: true,
      mainnetDisabled: true,
      stabilizationAuthorized: false,
      soakAuthorized: false,
    },
  }
  const accountingJson = canonicalPortableJson(accounting)
  return {
    accounting,
    accountingJson,
    accountingDigest: await sha256Hex(accountingJson),
  }
}
