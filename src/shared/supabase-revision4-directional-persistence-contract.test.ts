import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260806120000_xrpl_r4f_revision4_directional_accounting_evidence.sql',
  ),
  'utf8',
)
const lower = migration.toLowerCase()

describe('revision-4 G2B directional persistence contract', () => {
  it('creates a private candidate-only schema and two retained evidence tables', () => {
    for (const required of [
      'create schema if not exists xrpl_r4f_v1',
      'xrpl_r4f_v1.directional_accounting_evidence',
      'xrpl_r4f_v1.directional_accounting_observations',
      'accounting_json text not null',
      'accounting_digest text not null',
      'source_run_id bigint not null',
      'source_commit text not null',
      'recovery_mutation_committed boolean not null default false',
      'public_reader_unchanged boolean not null default true',
      'mainnet_disabled boolean not null default true',
      'stabilization_authorized boolean not null default false',
      'soak_authorized boolean not null default false',
      'primary key (observation_id, sequence)',
      'unique (observation_id, operation_id)',
    ]) {
      expect(lower).toContain(required)
    }
  })

  it('binds exact revision-4 identity and all G1 byte directions', () => {
    expect(migration).toContain(
      '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5',
    )
    expect(migration).toContain('profile_revision integer not null check (profile_revision = 4)')
    for (const boundary of [
      'invoker_to_edge_request',
      'edge_to_invoker_response',
      'edge_to_xrpl_request',
      'xrpl_to_edge_response',
      'edge_to_database_request',
      'database_to_edge_response',
      'edge_to_edge_request',
      'edge_to_edge_response',
    ]) {
      expect(migration).toContain(`'${boundary}'`)
    }
  })

  it('recomputes digest, sequence, directional totals, and memory totals in the database', () => {
    for (const required of [
      "extensions.digest(convert_to(p_accounting_json, 'UTF8'), 'sha256')",
      'accounting_digest_mismatch',
      'observation_sequence_invalid',
      'operation_id_duplicated',
      'directional_total_exceeds_safe_integer',
      'accounting_total_mismatch',
      'v_expected_rolling := v_rolling_directional + v_unexplained',
      'v_expected_memory := v_memory_directional',
      "v_rolling_included := v_boundary_id not in (\n      'invoker_to_edge_request',\n      'xrpl_to_edge_response'",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('supports exact idempotency and rejects observation identity conflicts', () => {
    expect(migration).toContain('observation_identity_conflict')
    expect(migration).toContain("'idempotent', true")
    expect(migration).toContain("'idempotent', false")
    expect(migration).toContain(
      'where observation_id = v_observation_id',
    )
  })

  it('keeps schema, tables, and RPCs inaccessible to public roles', () => {
    for (const role of ['public', 'anon', 'authenticated']) {
      expect(lower).toContain(`revoke all on schema xrpl_r4f_v1 from ${role}`)
      expect(lower).toContain(
        `revoke all on table xrpl_r4f_v1.directional_accounting_evidence from ${role}`,
      )
      expect(lower).toContain(
        `revoke all on table xrpl_r4f_v1.directional_accounting_observations from ${role}`,
      )
      expect(lower).toContain(
        `revoke all on function public.xrpl_record_r4f_revision4_directional_accounting(text, text, bigint, text) from ${role}`,
      )
      expect(lower).toContain(
        `revoke all on function public.xrpl_read_r4f_revision4_directional_accounting(text) from ${role}`,
      )
    }
    expect(lower).toContain(
      'grant execute on function public.xrpl_record_r4f_revision4_directional_accounting(text, text, bigint, text) to service_role',
    )
    expect(lower).toContain(
      'grant execute on function public.xrpl_read_r4f_revision4_directional_accounting(text) to service_role',
    )
  })

  it('does not reference or mutate active R5, phase, cursor, reader, or deployment state', () => {
    for (const forbidden of [
      'xrpl_r5_v1',
      'xrpl_phase_work',
      'xrpl_phase_payload_chunks',
      'xrpl_phase_reference_rows',
      'collector_cursor',
      'public_reader',
      'wrangler',
      'supabase functions deploy',
    ]) {
      expect(lower).not.toContain(forbidden)
    }

    const writer = lower.slice(
      lower.indexOf('create or replace function public.xrpl_record_r4f_revision4_directional_accounting'),
      lower.indexOf('create or replace function public.xrpl_read_r4f_revision4_directional_accounting'),
    )
    expect(writer).not.toContain('update ')
    expect(writer).not.toContain('delete from')
    expect(writer).not.toContain('truncate ')
    expect(writer).toContain(
      'insert into xrpl_r4f_v1.directional_accounting_evidence',
    )
    expect(writer).toContain(
      'insert into xrpl_r4f_v1.directional_accounting_observations',
    )
  })
})
