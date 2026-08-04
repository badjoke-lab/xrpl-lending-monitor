import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const migration = read(
  'supabase/migrations/20260803123600_xrpl_portable_retained_payload_reference_adapter.sql',
)
const portableNormalization = read(
  'src/collector/history-segments/portable-xrpl-normalization.ts',
)
const payloadTypes = read('src/shared/portable-collector-payload.ts')
const strictMigration = read(
  'supabase/migrations/20260802104000_xrpl_remote_seven_class_payload.sql',
)

describe('R5 retained payload reference-row adapter', () => {
  it('preserves the qualified portable commit implementation under a strict name', () => {
    for (const required of [
      'alter function public.xrpl_complete_portable_commit_phase(',
      'rename to xrpl_complete_portable_commit_phase_strict',
      'public.xrpl_complete_portable_commit_phase_strict(',
    ]) {
      expect(migration).toContain(required)
    }
    expect(migration.indexOf('rename to xrpl_complete_portable_commit_phase_strict')).toBeLessThan(
      migration.indexOf('create or replace function public.xrpl_complete_portable_commit_phase('),
    )
    expect(strictMigration).toContain("raise exception 'portable reference-row value is missing'")
    expect(strictMigration).toContain(
      "raise exception 'portable reference-row does not match payload chunk'",
    )
  })

  it('verifies the supplied retained-record bytes before any adaptation', () => {
    for (const required of [
      "p_reference_rows_digest !~ '^[a-f0-9]{64}$'",
      "extensions.digest(convert_to(p_reference_rows_json, 'UTF8'), 'sha256')",
      'v_actual_input_digest <> p_reference_rows_digest',
      "raise exception 'reference-row digest mismatch'",
      'v_input_rows := p_reference_rows_json::jsonb',
      "jsonb_typeof(v_input_rows) <> 'array'",
    ]) {
      expect(migration).toContain(required)
    }
    expect(migration.indexOf('v_actual_input_digest :=')).toBeLessThan(
      migration.indexOf('select coalesce('),
    )
  })

  it('passes the normal valueJson reference-row shape through unchanged', () => {
    for (const required of [
      "row_value ? 'valueJson' and not (row_value ? 'value')",
      'if coalesce(v_reference_shape, false) then',
      'p_reference_rows_json,',
      'p_reference_rows_digest',
    ]) {
      expect(migration).toContain(required)
    }
    expect(migration).toContain('if v_row_count = 0 then')
  })

  it('accepts only the exact retained payload value shape as the alternate input', () => {
    for (const required of [
      "row_value ? 'value' and not (row_value ? 'valueJson')",
      'if not coalesce(v_payload_shape, false) then',
      "raise exception 'portable commit rows use an unsupported or mixed shape'",
    ]) {
      expect(migration).toContain(required)
    }
    expect(migration).not.toContain("row_value ? 'value' or")
  })

  it('reconstructs the exact persisted reference-row fields in original record order', () => {
    for (const required of [
      "'semanticClass', row_value->'semanticClass'",
      "'canonicalKey', row_value->'canonicalKey'",
      "'sourceLedgerIndex', row_value->'sourceLedgerIndex'",
      "'sourceLedgerHash', row_value->'sourceLedgerHash'",
      "'sourceTransactionHash', row_value->'sourceTransactionHash'",
      "'objectId', row_value->'objectId'",
      "'relationshipIds', row_value->'relationshipIds'",
      "'valueJson', case",
      "'isTombstone', row_value->'isTombstone'",
      'order by row_ordinality',
      'jsonb_array_length(v_adapted_rows) <> v_row_count',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('matches the existing TypeScript tombstone/null conversion contract', () => {
    for (const required of [
      'record.isTombstone && record.value === null',
      '? null',
      ': canonicalPortableJson(record.value)',
    ]) {
      expect(portableNormalization).toContain(required)
    }
    expect(payloadTypes).toContain('export type PortableJsonPrimitive = null | boolean | number | string')
    for (const required of [
      "coalesce((row_value->>'isTombstone')::boolean, false)",
      "row_value->'value' = 'null'::jsonb then null",
      "else (row_value->'value')::text",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('digests the adapted reference rows and delegates all identity checks to strict commit', () => {
    for (const required of [
      'v_adapted_rows_json := v_adapted_rows::text',
      "extensions.digest(convert_to(v_adapted_rows_json, 'UTF8'), 'sha256')",
      'v_adapted_rows_json,',
      'v_adapted_rows_digest',
    ]) {
      expect(migration).toContain(required)
    }
    expect(migration.match(/xrpl_complete_portable_commit_phase_strict\(/gu)).toHaveLength(4)
  })

  it('exposes only the validating wrapper to the Edge service role', () => {
    for (const required of [
      'revoke all on function public.xrpl_complete_portable_commit_phase_strict(',
      ') from public, anon, authenticated, service_role;',
      'revoke all on function public.xrpl_complete_portable_commit_phase(',
      ') from public, anon, authenticated;',
      'grant execute on function public.xrpl_complete_portable_commit_phase(',
      ') to service_role;',
    ]) {
      expect(migration).toContain(required)
    }
    expect(migration).not.toContain('cascade')
    expect(migration).not.toContain('delete from')
    expect(migration).not.toContain('truncate ')
  })
})
