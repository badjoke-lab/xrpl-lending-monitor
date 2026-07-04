const RELEASE_CHANNEL_SCHEMA_VERSION = 1 as const

export interface CurrentStateReleasePointer {
  releaseTag: string
  manifestAssetName: string
  manifestSha256: string
}

export interface CurrentStateReleaseChannel {
  schemaVersion: typeof RELEASE_CHANNEL_SCHEMA_VERSION
  active: CurrentStateReleasePointer | null
  rollback: CurrentStateReleasePointer | null
  updatedAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function digest(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${field} must be a lowercase SHA-256 digest`)
  }
  return value
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be a non-empty string`)
  return value
}

function assetName(value: unknown, field: string): string {
  const name = text(value, field)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error(`${field} must be a flat release asset name`)
  return name
}

function channelPointer(value: unknown, field: string): CurrentStateReleasePointer | null {
  if (value === null) return null
  if (!isRecord(value)) throw new Error(`${field} must be null or an object`)
  return {
    releaseTag: text(value.releaseTag, `${field}.releaseTag`),
    manifestAssetName: assetName(value.manifestAssetName, `${field}.manifestAssetName`),
    manifestSha256: digest(value.manifestSha256, `${field}.manifestSha256`),
  }
}

export function parseReleaseChannel(value: unknown): CurrentStateReleaseChannel {
  if (!isRecord(value) || value.schemaVersion !== RELEASE_CHANNEL_SCHEMA_VERSION) {
    throw new Error('Release channel schema is invalid')
  }
  const updatedAt = text(value.updatedAt, 'updatedAt')
  if (!Number.isFinite(Date.parse(updatedAt))) throw new Error('updatedAt must be an ISO timestamp')
  const active = channelPointer(value.active, 'active')
  const rollback = channelPointer(value.rollback, 'rollback')
  if (active && rollback && active.releaseTag === rollback.releaseTag) {
    throw new Error('Active and rollback releases must be different')
  }
  return {
    schemaVersion: RELEASE_CHANNEL_SCHEMA_VERSION,
    active,
    rollback,
    updatedAt,
  }
}
