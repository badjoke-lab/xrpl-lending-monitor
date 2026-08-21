import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildPortableCollectorWorkId } from './portable-collector-planner'
import {
  resolveArchiveFirstDuplicateCompletion,
  resolveDurableDuplicateCompletion,
  type DurablePhaseWork,
} from './supabase-terminal-archive-durable-fallback'

const collector = readFileSync(
  resolve(process.cwd(), 'supabase/functions/xrpl-collector-tick/index.ts'),
  'utf8',
)
const archiveContract = readFileSync(
  resolve(process.cwd(), 'ops/production-sql/20260816183000_xrpl_phase_terminal_archive_contract.sql'),
  'utf8',
)
const basePhaseSql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260802095000_xrpl_remote_portable_phase_chain.sql'),
  'utf8',
)
const portableScanSql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260802104000_xrpl_remote_seven_class_payload.sql'),
  'utf8',
)
const portableCommitAdapter = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260803123600_xrpl_portable_retained_payload_reference_adapter.sql'),
  'utf8',
)

function work(overrides: Partial<DurablePhaseWork> = {}): DurablePhaseWork {
  const identity = {
    network: overrides.network ?? 'devnet',
    epochId: overrides.epochId ?? 'supabase-r4c2c-v1',
    baseIdentity: overrides.baseIdentity ?? 'base:v1:devnet:durable-proof',
    previousLedgerIndex: overrides.previousLedgerIndex ?? 4_200_000,
    expectedParentHash: overrides.expectedParentHash ?? 'A'.repeat(64),
  }
  return {
    workId: overrides.workId ?? buildPortableCollectorWorkId(identity),
    profileId: overrides.profileId ?? 'supabase-devnet',
    network: identity.network,
    epochId: identity.epochId,
    baseIdentity: identity.baseIdentity,
    previousLedgerIndex: identity.previousLedgerIndex,
    startLedgerIndex: overrides.startLedgerIndex ?? identity.previousLedgerIndex + 1,
    expectedParentHash: identity.expectedParentHash,
    scannedEndLedgerIndex: overrides.scannedEndLedgerIndex ?? identity.previousLedgerIndex + 1,
    finalLedgerHash: overrides.finalLedgerHash ?? 'B'.repeat(64),
    status: overrides.status ?? 'committed',
    payloadDigest: overrides.payloadDigest ?? 'c'.repeat(64),
    expectedPayloadChunks: overrides.expectedPayloadChunks ?? 3,
    expectedCommitChunks: overrides.expectedCommitChunks ?? 3,
    createdAt: overrides.createdAt ?? '2026-08-20T01:02:03.000Z',
    committedAt: overrides.committedAt === undefined
      ? '2026-08-20T01:02:05.000Z'
      : overrides.committedAt,
  }
}

function scanMessageId(item: DurablePhaseWork, sequence: number): string {
  return [
    'scan',
    'v1',
    encodeURIComponent(item.network),
    encodeURIComponent(item.epochId),
    encodeURIComponent(item.baseIdentity),
    String(item.previousLedgerIndex),
    encodeURIComponent(item.expectedParentHash.toUpperCase()),
    String(sequence),
  ].join(':')
}

function commitMessageId(item: DurablePhaseWork, chunkIndex: number): string {
  return `commit:v1:${item.workId.replaceAll(':', '%3A')}:${chunkIndex}`
}

function finalizeMessageId(item: DurablePhaseWork): string {
  return `finalize:v1:${item.workId.replaceAll(':', '%3A')}`
}

function successorScanMessageId(item: DurablePhaseWork): string {
  return [
    'scan',
    'v1',
    encodeURIComponent(item.network),
    encodeURIComponent(item.epochId),
    encodeURIComponent(item.baseIdentity),
    String(item.scannedEndLedgerIndex),
    encodeURIComponent(item.finalLedgerHash.toUpperCase()),
    '0',
  ].join(':')
}

describe('terminal archive durable duplicate fallback proof', () => {
  it('preserves an archive hit exactly and does not consult durable reconstruction', () => {
    const item = work({ workId: 'intentionally-non-canonical' })
    const archived = Object.freeze({
      archived: true,
      completed: true,
      duplicate: true,
      successor_message_id: 'archive-successor',
      completed_at: '2026-08-19T00:00:00.000Z',
    })

    const result = resolveArchiveFirstDuplicateCompletion({
      archiveResult: archived,
      messageId: 'archive-message',
      phase: 'finalize',
      works: [item],
    })

    expect(result?.source).toBe('archive')
    expect(result?.completion).toBe(archived)
    expect(result?.derived).toBeNull()
  })

  it('fails closed for every scan archive miss because durable work does not certify scanSequence', () => {
    const item = work()

    for (const sequence of [0, 1, 7, 123]) {
      expect(resolveDurableDuplicateCompletion({
        messageId: scanMessageId(item, sequence),
        phase: 'scan',
        works: [item],
      })).toBeNull()
    }

    expect(resolveArchiveFirstDuplicateCompletion({
      archiveResult: null,
      messageId: scanMessageId(item, 0),
      phase: 'scan',
      works: [item],
    })).toBeNull()
  })

  it('pins the missing durable scan-sequence certificate in the current schema and completion path', () => {
    const workTableStart = basePhaseSql.indexOf('create table if not exists public.xrpl_phase_work (')
    const payloadTableStart = basePhaseSql.indexOf(
      'create table if not exists public.xrpl_phase_payload_chunks (',
    )
    expect(workTableStart).toBeGreaterThan(-1)
    expect(payloadTableStart).toBeGreaterThan(workTableStart)
    const workTable = basePhaseSql.slice(workTableStart, payloadTableStart)
    expect(workTable).toContain('plan_json text not null')
    expect(workTable).not.toContain('scan_sequence')
    expect(workTable).not.toContain('scanSequence')

    const caughtUpStart = basePhaseSql.indexOf(
      'create or replace function public.xrpl_complete_caught_up_scan(',
    )
    const legacyScanStart = basePhaseSql.indexOf(
      'create or replace function public.xrpl_complete_scan_phase(',
    )
    expect(caughtUpStart).toBeGreaterThan(-1)
    expect(legacyScanStart).toBeGreaterThan(caughtUpStart)
    const caughtUpFunction = basePhaseSql.slice(caughtUpStart, legacyScanStart)
    expect(caughtUpFunction).toContain("(v_message.payload->>'scanSequence')::integer + 1")
    expect(caughtUpFunction).toContain("'successorScanSequence'")

    const planStart = portableScanSql.indexOf('v_plan_json := jsonb_build_object(')
    const planEnd = portableScanSql.indexOf('for v_chunk in', planStart)
    expect(planStart).toBeGreaterThan(-1)
    expect(planEnd).toBeGreaterThan(planStart)
    const durablePlan = portableScanSql.slice(planStart, planEnd)
    expect(durablePlan).toContain("'previousLedgerIndex', v_previous_index")
    expect(durablePlan).toContain("'expectedParentHash', v_previous_hash")
    expect(durablePlan).not.toContain('scanSequence')
  })

  it('derives every canonical commit chunk but refuses to invent historical completion time', () => {
    const item = work({ expectedCommitChunks: 3 })

    const middle = resolveDurableDuplicateCompletion({
      messageId: commitMessageId(item, 1),
      phase: 'commit',
      works: [item],
    })
    expect(middle?.payload).toEqual({
      schemaVersion: 1,
      phase: 'commit',
      messageId: commitMessageId(item, 1),
      workId: item.workId,
      chunkIndex: 1,
    })
    expect(middle?.successorMessageId).toBe(commitMessageId(item, 2))
    expect(middle?.completedAt).toBeNull()
    expect(middle?.completedAtProven).toBe(false)
    expect(middle?.completion.completed_at).toBeNull()
    expect(middle?.resultDigestProven).toBe(false)

    const last = resolveDurableDuplicateCompletion({
      messageId: commitMessageId(item, 2),
      phase: 'commit',
      works: [item],
    })
    expect(last?.successorMessageId).toBe(finalizeMessageId(item))

    expect(resolveDurableDuplicateCompletion({
      messageId: commitMessageId(item, 3),
      phase: 'commit',
      works: [item],
    })).toBeNull()
  })

  it('derives finalize identity, exact successor scan, and durable committed timestamp', () => {
    const item = work()
    const result = resolveDurableDuplicateCompletion({
      messageId: finalizeMessageId(item),
      phase: 'finalize',
      works: [item],
    })

    expect(result?.payload).toEqual({
      schemaVersion: 1,
      phase: 'finalize',
      messageId: finalizeMessageId(item),
      workId: item.workId,
    })
    expect(result?.successorMessageId).toBe(successorScanMessageId(item))
    expect(result?.completedAt).toBe(item.committedAt)
    expect(result?.completedAtProven).toBe(true)
    expect(result?.resultDigestProven).toBe(false)
  })

  it('fails closed for non-committed, non-canonical, or ambiguous durable work', () => {
    const item = work()
    expect(resolveDurableDuplicateCompletion({
      messageId: finalizeMessageId(item),
      phase: 'finalize',
      works: [{ ...item, status: 'committing' }],
    })).toBeNull()

    expect(() => resolveDurableDuplicateCompletion({
      messageId: finalizeMessageId(item),
      phase: 'finalize',
      works: [{ ...item, workId: `${item.workId}-drift` }],
    })).toThrow('durable work identity is non-canonical')

    expect(() => resolveDurableDuplicateCompletion({
      messageId: finalizeMessageId(item),
      phase: 'finalize',
      works: [item, { ...item }],
    })).toThrow('durable duplicate completion identity is ambiguous')
  })

  it('proves current repo runtime does not branch on duplicate completion completed_at', () => {
    for (const functionName of [
      'xrpl_complete_caught_up_scan',
      'xrpl_complete_portable_scan_phase',
      'xrpl_complete_portable_commit_phase',
      'xrpl_complete_portable_finalize_phase',
    ]) {
      expect(collector).toContain(`'${functionName}'`)
    }
    expect(collector).not.toContain('completion.completedAt')
    expect(collector).not.toContain('completion.completed_at')
    expect(collector).toContain("return { phase: 'scan', status: 'caught_up', completion }")
    expect(collector).toContain("status: 'committing',")
    expect(collector).toContain("status: 'committed', completion")

    expect(portableCommitAdapter).toContain(
      'return public.xrpl_complete_portable_commit_phase_strict(',
    )
    expect(portableCommitAdapter).not.toContain("->>'completed_at'")
    expect(portableCommitAdapter).not.toContain("->'completed_at'")
  })

  it('keeps result_digest outside the duplicate runtime response contract', () => {
    const duplicateStart = archiveContract.indexOf(
      'create or replace function xrpl_phase_archive_v1.duplicate_completion(',
    )
    const terminalizeStart = archiveContract.indexOf(
      'create or replace function xrpl_phase_archive_v1.terminalize_message(',
    )
    expect(duplicateStart).toBeGreaterThan(-1)
    expect(terminalizeStart).toBeGreaterThan(duplicateStart)
    const duplicateFunction = archiveContract.slice(duplicateStart, terminalizeStart)

    expect(duplicateFunction).toContain("'completed', true")
    expect(duplicateFunction).toContain("'duplicate', true")
    expect(duplicateFunction).toContain("'successor_message_id', v_archived.successor_message_id")
    expect(duplicateFunction).toContain("'completed_at', v_archived.completed_at")
    expect(duplicateFunction).not.toContain('result_digest')
  })
})
