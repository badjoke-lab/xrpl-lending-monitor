export async function loadD1DatabaseSizeBytes(db: D1Database): Promise<number> {
  const result = await db.prepare('SELECT 1 AS size_probe').run()
  const sizeAfter = Number(result.meta.size_after)
  if (!Number.isSafeInteger(sizeAfter) || sizeAfter < 0) {
    throw new Error('D1 did not return a valid database size')
  }
  return sizeAfter
}
