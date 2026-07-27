import { canonicalJson } from '../current-state/canonical-json'
import {
  assertHistoryExactIndexRecord,
  historyExactIndexBucket,
  type HistoryExactIndexRecord,
} from '../history-segments/exact-index'
import { HISTORY_RECONSTRUCTION_EXACT_BUCKET_COUNT, HISTORY_RECONSTRUCTION_SUPER_BUCKET_COUNT } from './identity'

export interface PlannedExactRecord {
  record: HistoryExactIndexRecord
  superBucket: number
}

export async function planExactSpill(records: readonly Omit<HistoryExactIndexRecord, 'bucket'>[]): Promise<PlannedExactRecord[]> {
  const planned: PlannedExactRecord[] = []
  for (const input of records) {
    const bucket = await historyExactIndexBucket(input.term, HISTORY_RECONSTRUCTION_EXACT_BUCKET_COUNT)
    const record: HistoryExactIndexRecord = { ...input, bucket }
    assertHistoryExactIndexRecord(record, HISTORY_RECONSTRUCTION_EXACT_BUCKET_COUNT)
    planned.push({ record, superBucket: Math.floor(bucket / (HISTORY_RECONSTRUCTION_EXACT_BUCKET_COUNT / HISTORY_RECONSTRUCTION_SUPER_BUCKET_COUNT)) })
  }
  return planned.sort((left, right) => left.superBucket - right.superBucket
    || left.record.bucket - right.record.bucket
    || left.record.term.localeCompare(right.record.term)
    || right.record.reference.ledgerIndex - left.record.reference.ledgerIndex
    || canonicalJson(left.record.reference).localeCompare(canonicalJson(right.record.reference)))
}

export function splitExactSuperBuckets(records: readonly PlannedExactRecord[]): Map<number, HistoryExactIndexRecord[]> {
  const result = new Map<number, HistoryExactIndexRecord[]>()
  for (let bucket = 0; bucket < HISTORY_RECONSTRUCTION_SUPER_BUCKET_COUNT; bucket += 1) result.set(bucket, [])
  for (const planned of records) result.get(planned.superBucket)!.push(planned.record)
  return result
}
