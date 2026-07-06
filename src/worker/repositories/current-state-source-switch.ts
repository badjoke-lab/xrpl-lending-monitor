import type { CurrentStateRuntimeConfig } from '../../shared/runtime-config'

interface ActiveOverlayBaseRow {
  base_snapshot_id: string
}

export interface CurrentStateSourceSelection {
  githubBranch: string
  activeBaseSnapshotId: string | null
}

export function selectCurrentStateSource(options: {
  config: CurrentStateRuntimeConfig
  activeBaseSnapshotId: string | null
}): CurrentStateSourceSelection {
  const replacement = options.config.replacement
  if (replacement && options.activeBaseSnapshotId === replacement.snapshotId) {
    return {
      githubBranch: replacement.githubBranch,
      activeBaseSnapshotId: options.activeBaseSnapshotId,
    }
  }
  return {
    githubBranch: options.config.githubBranch,
    activeBaseSnapshotId: options.activeBaseSnapshotId,
  }
}

export async function resolveCurrentStateSource(
  db: D1Database,
  config: CurrentStateRuntimeConfig,
): Promise<CurrentStateSourceSelection> {
  const active = await db.prepare(
    `SELECT base_snapshot_id
     FROM current_state_overlay_state
     WHERE network = 'devnet'
     ORDER BY updated_at DESC
     LIMIT 1`,
  ).first<ActiveOverlayBaseRow>()

  return selectCurrentStateSource({
    config,
    activeBaseSnapshotId: active?.base_snapshot_id ?? null,
  })
}

export function assertCurrentStateSourceBinding(options: {
  activeBaseSnapshotId: string | null
  manifestSnapshotId: string
}): void {
  if (
    options.activeBaseSnapshotId !== null
    && options.activeBaseSnapshotId !== options.manifestSnapshotId
  ) {
    throw new Error('current-state source snapshot does not match the active D1 overlay base')
  }
}
