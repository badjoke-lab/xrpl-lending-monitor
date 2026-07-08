function validLoanId(value) {
  return typeof value === 'string' && value.length > 0
}

export function selectLifecycleCurrentWitness(lifecycleRows, currentLoanRows) {
  const currentIds = new Set(
    currentLoanRows
      .map((row) => row?.id)
      .filter(validLoanId),
  )

  for (const row of lifecycleRows) {
    if (row?.event_type === 'deleted') continue
    if (!validLoanId(row?.loan_id)) continue
    if (currentIds.has(row.loan_id)) return row.loan_id
  }

  return null
}

export function lifecycleFallbackCandidates(lifecycleRows, currentLoanRows, limit = 4) {
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new Error('Lifecycle fallback candidate limit must be a non-negative safe integer')
  }

  const seen = new Set(
    currentLoanRows
      .map((row) => row?.id)
      .filter(validLoanId),
  )
  const candidates = []

  for (const row of lifecycleRows) {
    if (candidates.length >= limit) break
    if (row?.event_type === 'deleted') continue
    if (!validLoanId(row?.loan_id) || seen.has(row.loan_id)) continue
    seen.add(row.loan_id)
    candidates.push(row.loan_id)
  }

  return candidates
}
