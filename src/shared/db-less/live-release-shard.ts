const TAG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export interface DbLessLiveReleaseShardPlanV1 {
  schemaVersion: 1
  bucketHours: number
  bucketStart: string
  baseTag: string
  rotationIndex: number
  releaseTag: string
  existingAssets: number
  plannedArtifacts: number
  maxAssets: number
  projectedAssets: number
  fits: boolean
}

function positiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive safe integer`)
  }
}

function nonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`)
  }
}

function bucketStart(timestamp: string, bucketHours: number): Date {
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) throw new Error('timestamp must be an ISO-compatible date')
  const hour = parsed.getUTCHours()
  const bucketHour = Math.floor(hour / bucketHours) * bucketHours
  return new Date(Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
    bucketHour,
    0,
    0,
    0,
  ))
}

function compactUtc(value: Date): string {
  const yyyy = String(value.getUTCFullYear()).padStart(4, '0')
  const mm = String(value.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(value.getUTCDate()).padStart(2, '0')
  const hh = String(value.getUTCHours()).padStart(2, '0')
  return `${yyyy}${mm}${dd}-${hh}`
}

export function planDbLessLiveReleaseShard(options: {
  timestamp: string
  existingAssets: number
  plannedArtifacts: number
  rotationIndex?: number
  bucketHours?: number
  maxAssets?: number
  tagPrefix?: string
}): DbLessLiveReleaseShardPlanV1 {
  const bucketHours = options.bucketHours ?? 6
  const maxAssets = options.maxAssets ?? 720
  const rotationIndex = options.rotationIndex ?? 0
  const tagPrefix = options.tagPrefix ?? 'db-less-live-data-v1'

  positiveInteger(bucketHours, 'bucketHours')
  if (24 % bucketHours !== 0) {
    throw new Error('bucketHours must divide 24 exactly')
  }
  positiveInteger(maxAssets, 'maxAssets')
  if (maxAssets > 1_000) throw new Error('maxAssets must not exceed GitHub Release asset ceiling')
  nonNegativeInteger(rotationIndex, 'rotationIndex')
  nonNegativeInteger(options.existingAssets, 'existingAssets')
  positiveInteger(options.plannedArtifacts, 'plannedArtifacts')

  if (!TAG.test(tagPrefix)) throw new Error('tagPrefix is invalid')

  const start = bucketStart(options.timestamp, bucketHours)
  const baseTag = `${tagPrefix}-${compactUtc(start)}`
  const releaseTag = rotationIndex === 0 ? baseTag : `${baseTag}-r${rotationIndex}`
  const projectedAssets = options.existingAssets + options.plannedArtifacts

  return {
    schemaVersion: 1,
    bucketHours,
    bucketStart: start.toISOString(),
    baseTag,
    rotationIndex,
    releaseTag,
    existingAssets: options.existingAssets,
    plannedArtifacts: options.plannedArtifacts,
    maxAssets,
    projectedAssets,
    fits: projectedAssets <= maxAssets,
  }
}

export function nextDbLessLiveReleaseRotation(
  plan: DbLessLiveReleaseShardPlanV1,
): DbLessLiveReleaseShardPlanV1 {
  if (plan.fits) throw new Error('Rotation is only valid when the current shard does not fit')
  return planDbLessLiveReleaseShard({
    timestamp: plan.bucketStart,
    existingAssets: 0,
    plannedArtifacts: plan.plannedArtifacts,
    rotationIndex: plan.rotationIndex + 1,
    bucketHours: plan.bucketHours,
    maxAssets: plan.maxAssets,
    tagPrefix: plan.baseTag.replace(/-\d{8}-\d{2}$/, ''),
  })
}
