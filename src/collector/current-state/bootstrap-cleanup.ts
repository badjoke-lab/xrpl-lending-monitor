export interface BootstrapCleanupPlanOptions {
  snapshotId: string
  objectPrefix: string
  listedKeys: readonly string[]
  protectedKeys: ReadonlySet<string>
  checkpointExists: boolean
  snapshotStatus: 'building' | 'active' | 'failed' | 'superseded'
}

export interface BootstrapCleanupPlan {
  snapshotId: string
  objectPrefix: string
  deleteKeys: readonly string[]
  retainedKeys: readonly string[]
}

function normalizedPrefix(prefix: string): string {
  return prefix.endsWith('/') ? prefix : `${prefix}/`
}

function assertCleanupBoundary(snapshotId: string, objectPrefix: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(snapshotId)) {
    throw new Error('Bootstrap cleanup snapshot ID is invalid')
  }
  const prefix = normalizedPrefix(objectPrefix)
  const segments = prefix.split('/').filter(Boolean)
  if (segments.length < 3 || !segments.includes(snapshotId)) {
    throw new Error('Bootstrap cleanup prefix is not scoped to the snapshot ID')
  }
  return prefix
}

export function planBootstrapCleanup(
  options: BootstrapCleanupPlanOptions,
): BootstrapCleanupPlan {
  const prefix = assertCleanupBoundary(options.snapshotId, options.objectPrefix)
  if (options.checkpointExists) {
    throw new Error('Bootstrap cleanup is prohibited while a resumable checkpoint exists')
  }
  if (options.snapshotStatus === 'building' || options.snapshotStatus === 'active') {
    throw new Error(`Bootstrap cleanup is prohibited for ${options.snapshotStatus} snapshots`)
  }

  const deleteKeys: string[] = []
  const retainedKeys: string[] = []
  const seen = new Set<string>()
  for (const key of options.listedKeys) {
    if (seen.has(key)) continue
    seen.add(key)
    if (!key.startsWith(prefix)) {
      throw new Error(`Bootstrap cleanup key is outside the snapshot prefix: ${key}`)
    }
    if (options.protectedKeys.has(key)) retainedKeys.push(key)
    else deleteKeys.push(key)
  }

  deleteKeys.sort()
  retainedKeys.sort()
  return {
    snapshotId: options.snapshotId,
    objectPrefix: prefix,
    deleteKeys,
    retainedKeys,
  }
}

export async function executeBootstrapCleanup(options: {
  plan: BootstrapCleanupPlan
  deleteObjects: (keys: readonly string[]) => Promise<void>
  batchSize?: number
}): Promise<{ deletedObjects: number }> {
  const batchSize = options.batchSize ?? 500
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0 || batchSize > 1_000) {
    throw new Error('Bootstrap cleanup batch size must be between 1 and 1000')
  }
  let deletedObjects = 0
  for (let offset = 0; offset < options.plan.deleteKeys.length; offset += batchSize) {
    const batch = options.plan.deleteKeys.slice(offset, offset + batchSize)
    if (batch.length === 0) continue
    await options.deleteObjects(batch)
    deletedObjects += batch.length
  }
  return { deletedObjects }
}
