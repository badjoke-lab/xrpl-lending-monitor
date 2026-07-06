function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Convert collector-domain values into JSON-safe artifact values without
 * weakening the canonical JSON serializer itself.
 *
 * XRPL change records use `undefined` internally to represent a field that did
 * not exist before creation or after deletion. Segment artifacts encode that
 * absence as JSON null; companion `beforeJson` / `afterJson` fields preserve
 * the distinction between absence (`null`) and an explicit XRPL null value
 * (`"null"`).
 */
export function historySegmentJsonValue(value: unknown): unknown {
  if (value === undefined) return null
  if (Array.isArray(value)) return value.map(historySegmentJsonValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, historySegmentJsonValue(entry)]),
  )
}
