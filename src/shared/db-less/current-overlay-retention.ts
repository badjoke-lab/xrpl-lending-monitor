const CHECKPOINT_TAG = /^db-less-current-overlay-v1-(\d+)$/
const DEFAULT_KEEP_COUNT = 3

export interface DbLessCurrentOverlayReleaseRefV1 {
  id: number
  tagName: string
  draft: boolean
  prerelease: boolean
}

export interface DbLessCurrentOverlayRetentionPlanV1 {
  schemaVersion: 1
  activeTag: string
  activeThroughLedgerIndex: number
  keepCount: number
  keep: DbLessCurrentOverlayReleaseRefV1[]
  deleteCandidates: DbLessCurrentOverlayReleaseRefV1[]
  protected: DbLessCurrentOverlayReleaseRefV1[]
  ignored: DbLessCurrentOverlayReleaseRefV1[]
}

function safeRelease(value: DbLessCurrentOverlayReleaseRefV1): DbLessCurrentOverlayReleaseRefV1 {
  if (!Number.isSafeInteger(value.id) || value.id < 1) {
    throw new Error('D4 retention Release id must be a positive safe integer')
  }
  if (typeof value.tagName !== 'string' || value.tagName.length === 0) {
    throw new Error('D4 retention Release tag must be non-empty')
  }
  if (typeof value.draft !== 'boolean' || typeof value.prerelease !== 'boolean') {
    throw new Error('D4 retention Release flags are invalid')
  }
  return { ...value }
}

export function currentOverlayCheckpointLedger(tagName: string): number | null {
  const match = CHECKPOINT_TAG.exec(tagName)
  if (!match) return null
  const ledger = Number(match[1])
  if (!Number.isSafeInteger(ledger) || ledger < 1) {
    throw new Error('D4 Current overlay checkpoint tag ledger is invalid')
  }
  return ledger
}

export function planDbLessCurrentOverlayRetention(options: {
  releases: readonly DbLessCurrentOverlayReleaseRefV1[]
  activeTag: string
  keepCount?: number
}): DbLessCurrentOverlayRetentionPlanV1 {
  const keepCount = options.keepCount ?? DEFAULT_KEEP_COUNT
  if (!Number.isSafeInteger(keepCount) || keepCount < 2) {
    throw new Error('D4 retention keepCount must be an integer of at least 2')
  }

  const activeLedger = currentOverlayCheckpointLedger(options.activeTag)
  if (activeLedger === null) {
    throw new Error('D4 retention active tag is not a Current overlay checkpoint tag')
  }

  const seenIds = new Set<number>()
  const seenTags = new Set<string>()
  const checkpoint: Array<{
    release: DbLessCurrentOverlayReleaseRefV1
    ledger: number
  }> = []
  const ignored: DbLessCurrentOverlayReleaseRefV1[] = []

  for (const raw of options.releases) {
    const release = safeRelease(raw)
    if (seenIds.has(release.id) || seenTags.has(release.tagName)) {
      throw new Error('D4 retention input contains duplicate Release identity')
    }
    seenIds.add(release.id)
    seenTags.add(release.tagName)

    const ledger = currentOverlayCheckpointLedger(release.tagName)
    if (ledger === null) {
      ignored.push(release)
      continue
    }
    checkpoint.push({ release, ledger })
  }

  const activeMatches = checkpoint.filter(({ release }) => release.tagName === options.activeTag)
  if (activeMatches.length !== 1) {
    throw new Error('D4 retention active checkpoint Release must exist exactly once')
  }
  const active = activeMatches[0]!
  if (active.release.draft || !active.release.prerelease) {
    throw new Error('D4 retention active checkpoint must be a published prerelease')
  }

  const future = checkpoint.filter(({ ledger }) => ledger > activeLedger)
  if (future.length > 0) {
    throw new Error('D4 retention found a newer unactivated checkpoint Release')
  }

  const eligible = checkpoint
    .filter(({ release }) => !release.draft && release.prerelease)
    .sort((left, right) =>
      right.ledger - left.ledger || right.release.id - left.release.id)

  if (eligible[0]?.release.tagName !== options.activeTag) {
    throw new Error('D4 retention active checkpoint is not the newest eligible checkpoint')
  }

  const keep = eligible.slice(0, keepCount).map(({ release }) => release)
  const keepTags = new Set(keep.map((release) => release.tagName))
  const deleteCandidates = eligible
    .filter(({ release }) => !keepTags.has(release.tagName))
    .map(({ release }) => release)

  const protectedReleases = checkpoint
    .filter(({ release }) => release.draft || !release.prerelease)
    .map(({ release }) => release)

  return {
    schemaVersion: 1,
    activeTag: options.activeTag,
    activeThroughLedgerIndex: activeLedger,
    keepCount,
    keep,
    deleteCandidates,
    protected: protectedReleases,
    ignored,
  }
}
