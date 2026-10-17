/**
 * Decision-only D4 upkeep policy. NEVER writes to GitHub or selects a target
 * beyond the cryptographically verified live D3 channel.
 *
 * D3's public 128-entry Current index is a HEADROOM signal, not the
 * authoritative full historical chain. Missing index coverage does not prove
 * old immutable generation assets were deleted.
 */
const positive = x => Number.isSafeInteger(x) && x > 0
const SHA = /^[a-f0-9]{64}$/
const HASH = /^[A-F0-9]{64}$/

export function decideDbLessD4AutoUpdate({
  d3, d4, nowMs, dueGenerations = 36, urgentGenerations = 80,
  maxD3AgeSeconds = 900, maxCheckpointAgeSeconds = 21600,
}) {
  if (!Number.isFinite(nowMs) || nowMs < 0 || !positive(dueGenerations)
    || !positive(urgentGenerations) || urgentGenerations <= dueGenerations
    || urgentGenerations > 128 || !positive(maxD3AgeSeconds)
    || !positive(maxCheckpointAgeSeconds)) {
    throw new Error('D4 automatic update policy bounds invalid')
  }
  if (d3?.schemaVersion !== 1 || d4?.schemaVersion !== 1
    || d3.network !== 'devnet' || d4.network !== 'devnet'
    || !d3.epochId || d3.epochId !== d4.epochId
    || !d3.base?.generationId || d3.base.generationId !== d4.active?.baseIdentity) {
    throw new Error('D4 automatic update source/seed epoch identity mismatch')
  }
  if (!SHA.test(d3.channelSha256) || !SHA.test(d4.channelSha256)
    || !HASH.test(d3.lastCommittedLedgerHash)
    || !HASH.test(d4.active.throughLedgerHash)) {
    throw new Error('D4 automatic update channel or ledger digest malformed')
  }
  const d3Head = d3.lastCommittedLedgerIndex
  const d4Head = d4.active.throughLedgerIndex
  const tail = d3.currentProjectionTail
  const generations = tail?.generations
  const tailStart = tail?.coverageStartLedgerIndex
  if (!positive(d3Head) || !positive(d4Head) || d3Head < d4Head
    || !positive(tailStart) || tailStart > d3Head
    || !Array.isArray(generations) || generations.length > 128
    || !HASH.test(tail?.coverageStartLedgerHash)) {
    throw new Error('D4 automatic update head/index shape invalid')
  }
  let previousEnd = tailStart
  for (const gen of generations) {
    if (!positive(gen.startLedgerIndex) || !positive(gen.endLedgerIndex)
      || gen.startLedgerIndex <= previousEnd || gen.endLedgerIndex < gen.startLedgerIndex
      || gen.endLedgerIndex > d3Head) {
      throw new Error('D4 automatic update Current generations overlap or reverse')
    }
    previousEnd = gen.endLedgerIndex
  }
  if (d4Head === tailStart
    && d4.active.throughLedgerHash !== tail.coverageStartLedgerHash) {
    throw new Error('D4 automatic update exact Current index boundary hash mismatch')
  }
  const ageD3 = Math.floor((nowMs - Date.parse(d3.updatedAt)) / 1000)
  const ageD4 = Math.floor((nowMs - Date.parse(d4.updatedAt)) / 1000)
  if (!Number.isFinite(ageD3) || !Number.isFinite(ageD4)
    || ageD3 < -60 || ageD4 < -60) {
    throw new Error('D4 automatic update channel clock invalid')
  }
  const behindIndex = d4Head < tailStart
  const newGenerations = generations.filter(g => g.endLedgerIndex > d4Head).length
  const headroom = behindIndex ? 0 : 128 - newGenerations
  const fresh = ageD3 <= maxD3AgeSeconds
  let decision = 'SKIP'
  if (!fresh) decision = 'SOURCE_STALE'
  else if (d4Head === d3Head) decision = 'UP_TO_DATE'
  else if (behindIndex) decision = 'EMERGENCY_REPLAY'
  else if (newGenerations >= urgentGenerations) decision = 'URGENT'
  else if (newGenerations >= dueGenerations || ageD4 >= maxCheckpointAgeSeconds) decision = 'MAINTENANCE_DUE'
  return {
    schemaVersion: 1, decision,
    shouldBuild: ['EMERGENCY_REPLAY','URGENT','MAINTENANCE_DUE'].includes(decision),
    frozenD3ChannelSha256: d3.channelSha256,
    frozenD4ChannelSha256: d4.channelSha256,
    d3Head, d4Head, tailStart,
    newIndexedGenerations: newGenerations,
    indexedHeadroomGenerations: headroom,
    indexCoverageOk: !behindIndex,
    historicalChainStillNeedsVerification: behindIndex,
    sourceFresh: fresh,
    d3AgeSeconds: ageD3,
    d4AgeSeconds: ageD4,
    candidateReleaseMutation: false,
  }
}
