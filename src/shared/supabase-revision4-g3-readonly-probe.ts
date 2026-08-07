import { canonicalPortableJson } from './portable-collector-reference-store'
import {
  buildSupabaseRevision4DirectionalAccountingEvidence,
  SupabaseRevision4DirectionalMeter,
  utf8ByteLength,
  type SupabaseRevision4DirectionalAccountingEvidence,
  type SupabaseRevision4MeterObservation,
} from './supabase-revision4-directional-meter'
import {
  SUPABASE_REVISION4_PROFILE,
  SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST,
} from './supabase-revision4-directional-egress-contract'

export const SUPABASE_REVISION4_G3_PROBE_PURPOSE =
  'r4f-g3-directional-readonly-probe' as const
export const SUPABASE_REVISION4_G3_PROBE_NETWORK = 'devnet' as const
export const SUPABASE_REVISION4_G3_PROBE_MAX_XRPL_RESPONSE_BYTES =
  32 * 1024 * 1024
export const SUPABASE_REVISION4_G3_PROBE_ALLOCATOR_RESERVE_BYTES =
  8 * 1024 * 1024

const INVOKER_REQUEST_FRAMING_RESERVE_BYTES = 256
const XRPL_REQUEST_FRAMING_RESERVE_BYTES = 512
const XRPL_RESPONSE_FRAMING_RESERVE_BYTES = 1024
const INVOKER_RESPONSE_FRAMING_RESERVE_BYTES = 512
const SHA256_PATTERN = /^[a-f0-9]{64}$/u
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._:-]{2,159}$/u
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u
const TEXT_ENCODER = new TextEncoder()

export interface SupabaseRevision4G3ReadonlyProbeInput {
  observationId: string
  attemptId: string
  observedAt: string
  sourceCommit: string
  sourceRunId: number
  ledgerIndex: number
  invokerRequestBody: string
  xrplRequestBody: string
  xrplResponseBody: string
  xrplResponseDigest: string
}

export interface SupabaseRevision4G3ReadonlyProbeResponse {
  schemaVersion: 1
  purpose: typeof SUPABASE_REVISION4_G3_PROBE_PURPOSE
  profileId: typeof SUPABASE_REVISION4_PROFILE.profileId
  profileRevision: typeof SUPABASE_REVISION4_PROFILE.revision
  profileIdentityDigest: typeof SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST
  network: typeof SUPABASE_REVISION4_G3_PROBE_NETWORK
  ledgerIndex: number
  sourceCommit: string
  sourceRunId: number
  observedAt: string
  xrplRequestBytes: number
  xrplResponseBytes: number
  xrplResponseDigest: string
  responseBodyBytes: number
  fixedPointIterations: number
  accountingEvidence: SupabaseRevision4DirectionalAccountingEvidence
  checks: {
    exactRevision4Identity: true
    devnetOnly: true
    xrplReadOnly: true
    databaseRequestIssued: false
    recoveryMutationCommitted: false
    publicReaderUnchanged: true
    mainnetDisabled: true
    stabilizationAuthorized: false
    soakAuthorized: false
  }
}

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`)
  }
  return value
}

function exactIdentifier(value: string, name: string): string {
  const normalized = value.trim()
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${name} must be a stable non-secret identifier`)
  }
  return normalized
}

function exactCommit(value: string): string {
  if (!COMMIT_PATTERN.test(value)) {
    throw new Error('sourceCommit must be a 40-character lowercase SHA')
  }
  return value
}

function exactObservedAt(value: string): string {
  if (!UTC_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error('observedAt must be canonical UTC')
  }
  return value
}

function exactDigest(value: string, name: string): string {
  if (!SHA256_PATTERN.test(value) || value === '0'.repeat(64)) {
    throw new Error(`${name} must be a non-placeholder SHA-256`)
  }
  return value
}

function replaceInvokerResponseObservation(
  observations: readonly SupabaseRevision4MeterObservation[],
  bodyBytes: number,
): SupabaseRevision4MeterObservation[] {
  let replaced = false
  const result = observations.map((observation) => {
    if (observation.operationId !== 'edge.invoker.response.g3-probe') {
      return { ...observation }
    }
    replaced = true
    return { ...observation, bodyBytes }
  })
  if (!replaced) throw new Error('invoker response placeholder unavailable')
  return result
}

export async function sha256HexBytes(value: string): Promise<string> {
  const bytes = TEXT_ENCODER.encode(value)
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function buildSupabaseRevision4G3ReadonlyProbeResponse(
  raw: SupabaseRevision4G3ReadonlyProbeInput,
): Promise<{ response: SupabaseRevision4G3ReadonlyProbeResponse; responseBody: string }> {
  const observationId = exactIdentifier(raw.observationId, 'observationId')
  const attemptId = exactIdentifier(raw.attemptId, 'attemptId')
  const observedAt = exactObservedAt(raw.observedAt)
  const sourceCommit = exactCommit(raw.sourceCommit)
  const sourceRunId = positiveSafeInteger(raw.sourceRunId, 'sourceRunId')
  const ledgerIndex = positiveSafeInteger(raw.ledgerIndex, 'ledgerIndex')
  const xrplResponseDigest = exactDigest(raw.xrplResponseDigest, 'xrplResponseDigest')

  const xrplResponseBytes = utf8ByteLength(raw.xrplResponseBody)
  if (xrplResponseBytes <= 0) throw new Error('xrplResponseBody must be non-empty')
  if (xrplResponseBytes > SUPABASE_REVISION4_G3_PROBE_MAX_XRPL_RESPONSE_BYTES) {
    throw new Error('xrplResponseBody exceeds the bounded G3 probe limit')
  }
  const actualXrplResponseDigest = await sha256HexBytes(raw.xrplResponseBody)
  if (actualXrplResponseDigest !== xrplResponseDigest) {
    throw new Error('xrplResponseDigest does not match the retained XRPL response body')
  }

  const meter = new SupabaseRevision4DirectionalMeter()
  meter.recordUtf8({
    operationId: 'invoker.edge.request.g3-probe',
    boundaryId: 'invoker_to_edge_request',
    body: raw.invokerRequestBody,
    framingReserveBytes: INVOKER_REQUEST_FRAMING_RESERVE_BYTES,
  })
  meter.recordUtf8({
    operationId: 'edge.xrpl.request.g3-probe-ledger',
    boundaryId: 'edge_to_xrpl_request',
    body: raw.xrplRequestBody,
    framingReserveBytes: XRPL_REQUEST_FRAMING_RESERVE_BYTES,
  })
  meter.recordUtf8({
    operationId: 'xrpl.edge.response.g3-probe-ledger',
    boundaryId: 'xrpl_to_edge_response',
    body: raw.xrplResponseBody,
    framingReserveBytes: XRPL_RESPONSE_FRAMING_RESERVE_BYTES,
  })
  meter.recordBytes({
    operationId: 'edge.invoker.response.g3-probe',
    boundaryId: 'edge_to_invoker_response',
    bodyBytes: 0,
    framingReserveBytes: INVOKER_RESPONSE_FRAMING_RESERVE_BYTES,
  })
  const baseObservations = meter.snapshot()

  let responseBodyBytes = 0
  let canonicalJsonBytes = 0
  for (let iteration = 1; iteration <= 32; iteration += 1) {
    const accountingEvidence =
      await buildSupabaseRevision4DirectionalAccountingEvidence({
        schemaVersion: 1,
        observationId,
        attemptId,
        observedAt,
        disposition: 'shadow_completed',
        observations: replaceInvokerResponseObservation(
          baseObservations,
          responseBodyBytes,
        ),
        memorySupplemental: {
          canonicalJsonBytes,
          payloadBytes: 0,
          normalizedObjectOverheadBytes: 0,
          allocatorReserveBytes:
            SUPABASE_REVISION4_G3_PROBE_ALLOCATOR_RESERVE_BYTES,
        },
        unexplainedDirectionalDeltaReserveBytes: 0,
        recoveryMutationCommitted: false,
        publicReaderUnchanged: true,
        mainnetDisabled: true,
        stabilizationAuthorized: false,
        soakAuthorized: false,
      })

    const response: SupabaseRevision4G3ReadonlyProbeResponse = {
      schemaVersion: 1,
      purpose: SUPABASE_REVISION4_G3_PROBE_PURPOSE,
      profileId: SUPABASE_REVISION4_PROFILE.profileId,
      profileRevision: SUPABASE_REVISION4_PROFILE.revision,
      profileIdentityDigest: SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST,
      network: SUPABASE_REVISION4_G3_PROBE_NETWORK,
      ledgerIndex,
      sourceCommit,
      sourceRunId,
      observedAt,
      xrplRequestBytes: utf8ByteLength(raw.xrplRequestBody),
      xrplResponseBytes,
      xrplResponseDigest,
      responseBodyBytes,
      fixedPointIterations: iteration,
      accountingEvidence,
      checks: {
        exactRevision4Identity: true,
        devnetOnly: true,
        xrplReadOnly: true,
        databaseRequestIssued: false,
        recoveryMutationCommitted: false,
        publicReaderUnchanged: true,
        mainnetDisabled: true,
        stabilizationAuthorized: false,
        soakAuthorized: false,
      },
    }
    const responseBody = canonicalPortableJson(response)
    const nextResponseBodyBytes = utf8ByteLength(responseBody)
    const nextCanonicalJsonBytes = utf8ByteLength(accountingEvidence.accountingJson)

    if (
      nextResponseBodyBytes === responseBodyBytes
      && nextCanonicalJsonBytes === canonicalJsonBytes
    ) {
      return {
        response: { ...response, responseBodyBytes: nextResponseBodyBytes },
        responseBody,
      }
    }

    responseBodyBytes = nextResponseBodyBytes
    canonicalJsonBytes = nextCanonicalJsonBytes
  }

  throw new Error('G3 probe response byte fixed point did not converge')
}
