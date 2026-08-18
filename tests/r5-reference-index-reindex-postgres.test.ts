import { execFileSync } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const proofUrl = new URL('../scripts/test-r5-reference-index-reindex-postgres.sh', import.meta.url)
const outputUrl = new URL('../r5-reference-index-reindex-evidence/', import.meta.url)

async function source() {
  return readFile(proofUrl, 'utf8')
}

describe('R5 reference index local reindex proof', () => {
  test('is production-isolated and pinned to the sanitized production shape', async () => {
    const proof = await source()

    expect(proof).toContain("image='postgres:15-alpine'")
    expect(proof).toContain('generate_series(1,87885)')
    expect(proof).toContain('production_database_bytes=405073043')
    expect(proof).toContain('production_pkey_bytes=42287104')
    expect(proof).toContain('production_lookup_bytes=14680064')
    expect(proof).toContain("repeat('w',194)")
    expect(proof).toContain("repeat('k',80)")
    expect(proof).toContain("repeat('k',153)")
    expect(proof).toContain('reindex index proof.${target}')
    expect(proof).toContain('injected_reference_pkey_reindex_failure')
    expect(proof).toContain('injected_reference_lookup_reindex_failure')
    expect(proof).toContain('productionDatabaseUsed')
    expect(proof).toContain('productionReindexAuthorized')

    for (const forbidden of [
      'SUPABASE_ACCESS_TOKEN',
      'SUPABASE_PROJECT_ID',
      'api.supabase.com',
      'cron.schedule',
      'cron.unschedule',
      'wrangler deploy',
      'supabase functions deploy',
      'MAINNET_ENABLED',
      'r5-revision4-resource-halt-rearm',
    ]) {
      expect(proof).not.toContain(forbidden)
    }
  })

  test(
    'measures conservative fresh btree size and verifies local REINDEX preservation',
    async () => {
      if (process.env.CI !== 'true') return

      await rm(outputUrl, { recursive: true, force: true })
      execFileSync('bash', [fileURLToPath(proofUrl)], {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        env: {
          ...process.env,
          R5_REFERENCE_INDEX_REINDEX_OUTPUT: 'r5-reference-index-reindex-evidence',
        },
        encoding: 'utf8',
        stdio: 'inherit',
        timeout: 240_000,
      })

      const metrics = JSON.parse(
        await readFile(new URL('metrics.json', outputUrl), 'utf8'),
      ) as Record<string, unknown>

      expect(metrics.productionDatabaseUsed).toBe(false)
      expect(metrics.productionReindexAuthorized).toBe(false)
      expect(metrics.productionReferenceRowsObserved).toBe(87885)
      expect(metrics.productionDatabaseBytesObserved).toBe(405073043)
      expect(metrics.productionPkeyBytesObserved).toBe(42287104)
      expect(metrics.productionLookupBytesObserved).toBe(14680064)
      expect(metrics.syntheticRows).toBe(87885)
      expect(metrics.syntheticWorkIdBytes).toBe(205)
      expect(metrics.syntheticCanonicalP95Bytes).toBe(91)
      expect(metrics.syntheticCanonicalMaxBytes).toBe(164)
      expect(metrics.syntheticShapeConservative).toBe(true)
      expect(metrics.rowDigestPreserved).toBe(true)
      expect(metrics.constraintDigestPreserved).toBe(true)
      expect(metrics.heapBytesPreserved).toBe(true)
      expect(metrics.pkeyOidPreserved).toBe(true)
      expect(metrics.lookupOidPreserved).toBe(true)
      expect(metrics.peerLookupBytesPreservedDuringPkey).toBe(true)
      expect(metrics.rollbackVerified).toBe(true)

      console.log('R5 reference index local proof metrics:', JSON.stringify(metrics))
    },
    260_000,
  )
})
