#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const MIGRATION_PATH = 'supabase/migrations/20260814130000_xrpl_phase_messages_ready_partial_index.sql'
const EVIDENCE_PATH = 'ops/r5-phase-ready-native-history-audit.json'

function fail(message) {
  throw new Error(message)
}

function sha256(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex')
}

function stripStatementTerminator(statement) {
  const trimmed = statement.trim()
  return trimmed.endsWith(';') ? trimmed.slice(0, -1) : trimmed
}

function splitNativeStatements(migration) {
  const normalized = migration.replaceAll('\r\n', '\n').trim()
  const boundaries = [
    '\n\ncreate index xrpl_phase_messages_ready_claimable_idx',
    '\n\ndrop index public.xrpl_phase_messages_ready_idx;',
    '\n\nalter index public.xrpl_phase_messages_ready_claimable_idx',
    '\n\ndo $$\ndeclare\n  v_predicate text;',
  ]

  const statements = []
  let remainder = normalized
  for (const boundary of boundaries) {
    const index = remainder.indexOf(boundary)
    if (index < 0) fail(`migration native-statement boundary missing: ${boundary.replaceAll('\n', '\\n')}`)
    statements.push(stripStatementTerminator(remainder.slice(0, index)))
    remainder = remainder.slice(index + 2)
  }
  statements.push(stripStatementTerminator(remainder))
  return statements
}

const migration = await readFile(MIGRATION_PATH, 'utf8')
const evidence = JSON.parse(await readFile(EVIDENCE_PATH, 'utf8'))

const migrationSha = sha256(migration)
if (migrationSha !== evidence.migrationSha256) {
  fail(`migration SHA-256 drifted: expected=${evidence.migrationSha256} actual=${migrationSha}`)
}

const statements = splitNativeStatements(migration)
if (statements.length !== evidence.productionMigrationHistoryStatementCount) {
  fail(`native statement count mismatch: expected=${evidence.productionMigrationHistoryStatementCount} actual=${statements.length}`)
}

const requiredStarts = [
  '-- R5 storage headroom:',
  'create index xrpl_phase_messages_ready_claimable_idx',
  'drop index public.xrpl_phase_messages_ready_idx',
  'alter index public.xrpl_phase_messages_ready_claimable_idx',
  'do $$\ndeclare\n  v_predicate text;',
]
for (let index = 0; index < requiredStarts.length; index += 1) {
  if (!statements[index].startsWith(requiredStarts[index])) {
    fail(`unexpected native statement ${index + 1} prefix`)
  }
}

const nativeRecord = {
  name: evidence.productionMigrationHistoryName,
  version: evidence.migrationVersion,
  statements,
}
const nativeRecordSha = sha256(JSON.stringify(nativeRecord))
if (nativeRecordSha !== evidence.productionMigrationHistoryRecordSha256) {
  fail(`Supabase native migration-history record mismatch: expected=${evidence.productionMigrationHistoryRecordSha256} actual=${nativeRecordSha}`)
}

if (evidence.reconciliationVerdict !== 'supabase_native_exact_sql_record') {
  fail(`unexpected reconciliation verdict: ${evidence.reconciliationVerdict}`)
}
if (evidence.formalOwnerAuthorizationSatisfied !== false) fail('formal owner authorization must remain false')
if (evidence.authorizationCommandEmittedByAudit !== false) fail('audit must not claim an authorization command was emitted')
if (evidence.executeJobRanInAudit !== false) fail('audit must not claim execute ran')
if (evidence.productionMutationDuringAudit !== false) fail('audit must remain read-only')
if (evidence.r5RestartAuthorized !== false) fail('audit must not authorize R5 restart')

console.log(`R5 phase ready native migration history record: PASS (${nativeRecordSha})`)
