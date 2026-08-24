import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const managerPath = resolve(
  process.cwd(),
  'scripts/manage-r5-terminal-certificate-archive-bounded-apply.mjs',
)
const guardPath = resolve(
  process.cwd(),
  'ops/production-sql/20260824031500_xrpl_terminal_certificate_archive_stable_safety_guard.json',
)
const manifestPath = resolve(
  process.cwd(),
  'ops/production-sql/20260823053000_xrpl_terminal_certificate_archive_atomic_manifest.json',
)

const manager = readFileSync(managerPath, 'utf8')
const guard = JSON.parse(readFileSync(guardPath, 'utf8'))
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

describe('terminal certificate/archive bounded apply manager', () => {
  it('binds the stable no-expiry guard and reviewed exact atomic bundle', () => {
    expect(manager).toContain(
      'ops/production-sql/20260824031500_xrpl_terminal_certificate_archive_stable_safety_guard.json',
    )
    expect(manager).toContain(
      'ops/production-sql/20260823053000_xrpl_terminal_certificate_archive_atomic_manifest.json',
    )
    expect(guard.bundleSha256).toBe(manifest.bundleSha256)
    expect(guard.command).not.toContain('expires=')
    expect(guard.validity.volatileMeasurementDriftInvalidatesAuthorization).toBe(false)
  })

  it('runs all safety inspection through read-only access before the single mutation request', () => {
    expect(manager).toContain('managementQuery(functionInspectionSql(), true)')
    expect(manager).toContain('r5-terminal-scan-sequence-readonly-audit.mjs')
    expect(manager).toContain("body: JSON.stringify({ query, parameters: [], read_only: readOnly })")
    expect(manager).toContain('const response = await managementQuery(result.bundle, false)')
    expect(manager.match(/managementQuery\([^\n]+, false\)/gu)).toHaveLength(1)
    expect(manager).not.toMatch(/managementQuery\([^\n]*options\.(sql|query)/u)
  })

  it('requires the exact owner command and refuses state drift before mutation', () => {
    const authCheck = manager.indexOf("authorization !== result.guard.command")
    const eligibleCheck = manager.indexOf("!result.eligible")
    const mutation = manager.indexOf('managementQuery(result.bundle, false)')
    expect(authCheck).toBeGreaterThan(-1)
    expect(eligibleCheck).toBeGreaterThan(-1)
    expect(mutation).toBeGreaterThan(authCheck)
    expect(mutation).toBeGreaterThan(eligibleCheck)
    expect(manager).toContain('certificateColumns.absent')
    expect(manager).toContain('duplicateCompletion.sourceSha256')
    expect(manager).toContain('scan.productiveMappingDigest')
    expect(manager).toContain('scan.activeSequences')
  })

  it('regenerates the reviewed bundle locally and permits no extra SQL or runtime rearm surface', () => {
    for (const stage of manifest.orderedStages) {
      expect(manager).toContain('atomic stage ${stage.order}: ${stage.path}')
      expect(stage.sha256).toMatch(/^[a-f0-9]{64}$/u)
    }
    expect(manager).toContain("if (digest !== guard.bundleSha256)")
    expect(manager).toContain("(bundle.match(/^begin;$/gmu)?.length ?? 0) !== 1")
    expect(manager).toContain("(bundle.match(/^commit;$/gmu)?.length ?? 0) !== 1")
    expect(manager).not.toContain('wrangler deploy')
    expect(manager).not.toContain('supabase db push')
    expect(manager).not.toContain('cron.schedule')
    expect(manager).not.toContain('r5-rearm-authorize')
    expect(manager).not.toContain('mainnetEnabled: true')
  })

  it('keeps volatile measurements as evidence instead of validity inputs', () => {
    for (const key of guard.volatileEvidenceExcludedFromAuthorizationValidity) {
      expect(manager).toContain(`${key}: scanSequence.${key}`)
      expect(guard.stableSafetyGuard).not.toHaveProperty(key)
    }
    expect(manager).toContain('volatileEvidence')
  })
})
