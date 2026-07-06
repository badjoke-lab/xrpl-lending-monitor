interface EpochRow {
  epoch_id: string | null
}

interface ManagedTransitionSourceRow {
  impaired: number
  impaired_latest_ledger: number | null
  unimpaired: number
  unimpaired_latest_ledger: number | null
  defaulted: number
  defaulted_latest_ledger: number | null
}

function numberValue(value: number | null | undefined): number {
  return Number(value ?? 0)
}

export interface ManagedTransitionSourceDiagnostics {
  epochId: string | null
  impaired: number
  impairedLatestLedger: number | null
  unimpaired: number
  unimpairedLatestLedger: number | null
  defaulted: number
  defaultedLatestLedger: number | null
}

export async function readManagedTransitionSourceDiagnostics(
  db: D1Database,
): Promise<ManagedTransitionSourceDiagnostics> {
  const epoch = await db.prepare(
    `SELECT epoch_id
     FROM sync_state
     WHERE network = 'devnet'
     LIMIT 1`,
  ).first<EpochRow>()
  const epochId = epoch?.epoch_id ?? null

  if (!epochId) {
    return {
      epochId: null,
      impaired: 0,
      impairedLatestLedger: null,
      unimpaired: 0,
      unimpairedLatestLedger: null,
      defaulted: 0,
      defaultedLatestLedger: null,
    }
  }

  const row = await db.prepare(
    `WITH flag_changes AS (
       SELECT ledger_index,
              CAST(json_extract(before_json, '$') AS INTEGER) AS before_flags,
              CAST(json_extract(after_json, '$') AS INTEGER) AS after_flags
       FROM object_changes
       WHERE network = 'devnet'
         AND epoch_id = ?1
         AND transaction_type = 'LoanManage'
         AND object_type = 'Loan'
         AND action = 'modified'
         AND field_name = 'Flags'
         AND before_json IS NOT NULL
         AND after_json IS NOT NULL
     )
     SELECT
       COALESCE(SUM(CASE
         WHEN (after_flags & 65536) = 0
          AND (after_flags & 131072) != 0
          AND NOT ((before_flags & 65536) = 0 AND (before_flags & 131072) != 0)
         THEN 1 ELSE 0 END), 0) AS impaired,
       MAX(CASE
         WHEN (after_flags & 65536) = 0
          AND (after_flags & 131072) != 0
          AND NOT ((before_flags & 65536) = 0 AND (before_flags & 131072) != 0)
         THEN ledger_index END) AS impaired_latest_ledger,
       COALESCE(SUM(CASE
         WHEN (before_flags & 65536) = 0
          AND (before_flags & 131072) != 0
          AND (after_flags & 65536) = 0
          AND (after_flags & 131072) = 0
         THEN 1 ELSE 0 END), 0) AS unimpaired,
       MAX(CASE
         WHEN (before_flags & 65536) = 0
          AND (before_flags & 131072) != 0
          AND (after_flags & 65536) = 0
          AND (after_flags & 131072) = 0
         THEN ledger_index END) AS unimpaired_latest_ledger,
       COALESCE(SUM(CASE
         WHEN (after_flags & 65536) != 0
          AND (before_flags & 65536) = 0
         THEN 1 ELSE 0 END), 0) AS defaulted,
       MAX(CASE
         WHEN (after_flags & 65536) != 0
          AND (before_flags & 65536) = 0
         THEN ledger_index END) AS defaulted_latest_ledger
     FROM flag_changes`,
  ).bind(epochId).first<ManagedTransitionSourceRow>()

  return {
    epochId,
    impaired: numberValue(row?.impaired),
    impairedLatestLedger: row?.impaired_latest_ledger ?? null,
    unimpaired: numberValue(row?.unimpaired),
    unimpairedLatestLedger: row?.unimpaired_latest_ledger ?? null,
    defaulted: numberValue(row?.defaulted),
    defaultedLatestLedger: row?.defaulted_latest_ledger ?? null,
  }
}
