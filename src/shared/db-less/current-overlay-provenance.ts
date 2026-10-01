import { sha256Hex } from '../current-state/canonical-json'

const SHA256 = /^[a-f0-9]{64}$/
const SCHEME = 'rolling-sha256-v1' as const
const DOMAIN = 'db-less-current-overlay-generation-provenance-v1'

export interface DbLessCurrentOverlayGenerationProvenanceV2 {
  scheme: typeof SCHEME
  generationCount: number
  firstGenerationId: string
  lastGenerationId: string
  digestSha256: string
}

function nonEmpty(value: string, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} must be non-empty`)
  }
  return value
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive safe integer`)
  }
  return value
}

export function assertDbLessCurrentOverlayGenerationProvenance(
  provenance: DbLessCurrentOverlayGenerationProvenanceV2,
): void {
  if (provenance.scheme !== SCHEME) {
    throw new Error('D4 Current overlay provenance scheme is invalid')
  }
  positiveInteger(provenance.generationCount, 'provenance.generationCount')
  nonEmpty(provenance.firstGenerationId, 'provenance.firstGenerationId')
  nonEmpty(provenance.lastGenerationId, 'provenance.lastGenerationId')
  if (!SHA256.test(provenance.digestSha256)) {
    throw new Error('D4 Current overlay provenance digest is invalid')
  }
}

async function appendDigest(
  previousDigest: string | null,
  generationId: string,
): Promise<string> {
  return sha256Hex(
    `${DOMAIN}\n${previousDigest ?? '-'}\n${nonEmpty(generationId, 'generationId')}\n`,
  )
}

export async function buildDbLessCurrentOverlayGenerationProvenance(options: {
  generationIds: readonly string[]
  seed?: DbLessCurrentOverlayGenerationProvenanceV2 | null
}): Promise<DbLessCurrentOverlayGenerationProvenanceV2> {
  const seed = options.seed ?? null
  if (seed) assertDbLessCurrentOverlayGenerationProvenance(seed)
  if (options.generationIds.length === 0) {
    if (!seed) {
      throw new Error('D4 Current overlay provenance requires at least one generation')
    }
    return { ...seed }
  }

  const seen = new Set<string>()
  let digest = seed?.digestSha256 ?? null
  let generationCount = seed?.generationCount ?? 0
  let firstGenerationId = seed?.firstGenerationId ?? ''
  let lastGenerationId = seed?.lastGenerationId ?? ''

  for (const raw of options.generationIds) {
    const generationId = nonEmpty(raw, 'generationId')
    if (seen.has(generationId)) {
      throw new Error('D4 Current overlay provenance contains duplicate new generation IDs')
    }
    seen.add(generationId)
    digest = await appendDigest(digest, generationId)
    generationCount += 1
    if (!firstGenerationId) firstGenerationId = generationId
    lastGenerationId = generationId
  }

  const provenance: DbLessCurrentOverlayGenerationProvenanceV2 = {
    scheme: SCHEME,
    generationCount,
    firstGenerationId,
    lastGenerationId,
    digestSha256: digest!,
  }
  assertDbLessCurrentOverlayGenerationProvenance(provenance)
  return provenance
}
