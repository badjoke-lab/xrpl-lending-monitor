export const HISTORY_RECONSTRUCTION_ID = 'devnet-3371675-3800886-3932301-v1'
export const HISTORY_RECONSTRUCTION_NETWORK = 'devnet'
export const HISTORY_RECONSTRUCTION_EPOCH_ID = 'devnet-3371675'
export const HISTORY_RECONSTRUCTION_START_LEDGER = 3_800_886
export const HISTORY_RECONSTRUCTION_ACTIVE_END_HASH = 'EAA0D29666E73D7594A52DF8000B07F346CD4DA24A9A07549612CDC7D727B700'
export const HISTORY_RECONSTRUCTION_TARGET_LEDGER = 3_932_301
export const HISTORY_RECONSTRUCTION_TARGET_HASH = '7D026FED85BCA2BDCFE450A0F3537707A43B4D08E1D2AE57AFBC54D88EBE1828'
export const HISTORY_RECONSTRUCTION_SEGMENT_SIZE = 500
export const HISTORY_RECONSTRUCTION_SEGMENT_COUNT = 263
export const HISTORY_RECONSTRUCTION_EXACT_BUCKET_COUNT = 256
export const HISTORY_RECONSTRUCTION_SUPER_BUCKET_COUNT = 16

export interface ReconstructionSegmentRange {
  id: number
  startLedgerIndex: number
  endLedgerIndex: number
  ledgerCount: number
}

export function reconstructionSegmentRange(id: number): ReconstructionSegmentRange {
  if (!Number.isSafeInteger(id) || id < 0 || id >= HISTORY_RECONSTRUCTION_SEGMENT_COUNT) {
    throw new Error('Reconstruction segment ID is out of range')
  }
  const startLedgerIndex = HISTORY_RECONSTRUCTION_START_LEDGER + id * HISTORY_RECONSTRUCTION_SEGMENT_SIZE
  const endLedgerIndex = Math.min(
    HISTORY_RECONSTRUCTION_TARGET_LEDGER,
    startLedgerIndex + HISTORY_RECONSTRUCTION_SEGMENT_SIZE - 1,
  )
  return { id, startLedgerIndex, endLedgerIndex, ledgerCount: endLedgerIndex - startLedgerIndex + 1 }
}

export function reconstructionSegmentPlan(): ReconstructionSegmentRange[] {
  return Array.from({ length: HISTORY_RECONSTRUCTION_SEGMENT_COUNT }, (_, id) => reconstructionSegmentRange(id))
}
