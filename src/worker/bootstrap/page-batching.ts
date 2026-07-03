import type { ScannedLedgerObject } from '../../collector/current-state/scan-ledger-objects'
import type { CurrentStatePage, CurrentStateScanMetrics } from '../../collector/current-state/scan-current-state'
import { MAX_BATCH_OBJECTS } from '../repositories/d1-snapshot'
import { writeSnapshotBatch } from '../repositories/d1-snapshot-batch'

export const PAGE_OBJECT_LIMIT = 2_048

interface PageChunk {
  vaults: ScannedLedgerObject[]
  loanBrokers: ScannedLedgerObject[]
  loans: ScannedLedgerObject[]
}

function splitPage(page: CurrentStatePage): PageChunk[] {
  const tagged = [
    ...page.vaults.map((object) => ({ kind: 'vault' as const, object })),
    ...page.loanBrokers.map((object) => ({ kind: 'loan_broker' as const, object })),
    ...page.loans.map((object) => ({ kind: 'loan' as const, object })),
  ]
  if (tagged.length === 0) return [{ vaults: [], loanBrokers: [], loans: [] }]

  const chunks: PageChunk[] = []
  for (let offset = 0; offset < tagged.length; offset += MAX_BATCH_OBJECTS) {
    const chunk: PageChunk = { vaults: [], loanBrokers: [], loans: [] }
    for (const taggedObject of tagged.slice(offset, offset + MAX_BATCH_OBJECTS)) {
      if (taggedObject.kind === 'vault') chunk.vaults.push(taggedObject.object)
      else if (taggedObject.kind === 'loan_broker') chunk.loanBrokers.push(taggedObject.object)
      else chunk.loans.push(taggedObject.object)
    }
    chunks.push(chunk)
  }
  return chunks
}

export async function persistPageBatches(options: {
  db: D1Database
  snapshotId: string
  page: CurrentStatePage
  cumulativeMetrics: CurrentStateScanMetrics
  nextSequence: number
  now: () => string
  writeBatch?: typeof writeSnapshotBatch
}): Promise<{ nextSequence: number; updatedAt: string }> {
  const writeBatch = options.writeBatch ?? writeSnapshotBatch
  const chunks = splitPage(options.page)
  let nextSequence = options.nextSequence
  let updatedAt = ''

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex]
    if (!chunk) continue
    const finalChunk = chunkIndex === chunks.length - 1
    updatedAt = options.now()
    await writeBatch(options.db, {
      snapshotId: options.snapshotId,
      sequence: nextSequence,
      markerBefore: options.page.markerBefore,
      markerAfter: finalChunk ? options.page.markerAfter : options.page.markerBefore,
      decodedObjectCount: finalChunk ? options.page.decodedObjects : 0,
      vaults: chunk.vaults,
      loanBrokers: chunk.loanBrokers,
      loans: chunk.loans,
      cumulativeMetrics: options.cumulativeMetrics as unknown as Record<string, unknown>,
      writtenAt: updatedAt,
      advanceCheckpoint: finalChunk,
    })
    nextSequence += 1
  }

  return { nextSequence, updatedAt }
}
