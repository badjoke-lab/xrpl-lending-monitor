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
const portableScanSql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260802104000_xrpl_remote_seven_class_payload.sql'),
  'utf8',
)
const certificateRuntimeSql = readFileSync(
  resolve(process.cwd(), 'ops/production-sql/20260823013000_xrpl_terminal_scan_certificate_runtime.sql'),
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
    sourceScanSequence: overrides.sourceScanSequence ?? 0,
    createdAt: overrides.createdAt ?? '2026-08-20T01:02:03.000Z',
    committedAt: overrides.committedAt === undefined
      ? '2026-08-20T01:02:05.000Z'
      : overrides.committedAt,
  }
}

function scanMessageId(item: DurablePhaseWork, sequence = item.sourceScanSequence): string {
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

  it('derives the exact productive scan only from the durable source sequence certificate', () => {
    const item = work({ status: 'staged', sourceScanSequence: 7 })
    const messageId = scanMessageId(item)
    const result = resolveDurableDuplicateCompletion({
      messageId,
      phase: 'scan',
      works: [item],
    })

    expect(result?.phase).toBe('scan')
    expect(result?.payload).toEqual({
      schemaVersion: 1,
      phase: 'scan',
      messageId,
      network: item.network,
      epochId: item.epochId,
      baseIdentity: item.baseIdentity,
      expectedPreviousLedgerIndex: item.previousLedgerIndex,
      expectedPreviousLedgerHash: item.expectedParentHash,
      scanSequence: 7,
    })
    expect(result?.successorMessageId).toBe(commitMessageId(item, 0))
    expect(result?.completedAt).toBe(item.createdAt)
    expect(result?.completedAtProven).toBe(true)
    expect(result?.resultDigestProven).toBe(false)
    expect(result?.completion).toEqual({
      completed: true,
      duplicate: true,
      derived: true,
      successor_message_id: commitMessageId(item, 0),
      completed_at: item.createdAt,
    })

    for (const wrongSequence of [0, 1, 6, 8, 123]) {
      expect(resolveDurableDuplicateCompletion({
        messageId: scanMessageId(item, wrongSequence),
        phase: 'scan',
        works: [item],
      })).toBeNull()
    }
  })

  it('accepts every post-scan durable work state but still rejects a fabricated source sequence', () => {
    for (const status of ['planned', 'staged', 'committing', 'finalizing', 'committed', 'error']) {
      const item = work({ status, sourceScanSequence: 2 })
      expect(resolveDurableDuplicateCompletion({
        messageId: scanMessageId(item),
        phase: 'scan',
        works: [item],
      })?.successorMessageId).toBe(commitMessageId(item, 0))
    }

    const item = work({ sourceScanSequence: -1 })
    expect(() => resolveDurableDuplicateCompletion({
      messageId: scanMessageId(item, 0),
      phase: 'scan',
      works: [item],
    })).toThrow('sourceScanSequence must be a non-negative safe integer')
  })

  it('pins the staged runtime certificate and scan completion timestamp provenance', () => {
    expect(certificateRuntimeSql).toContain(
      'add column source_scan_sequence integer not null default 0',
    )
    expect(certificateRuntimeSql).toContain(
      'add column next_scan_sequence integer not null default 0',
    )
    expect(certificateRuntimeSql).toContain('source_scan_sequence = v_stream.next_scan_sequence')
    expect(certificateRuntimeSql).toContain("raise exception 'portable scan sequence certificate conflict'")

    const insertStart = portableScanSql.indexOf('insert into public.xrpl_phase_work (')
    const successorStart = portableScanSql.indexOf('v_commit_id :=', insertStart)
    expect(insertStart).toBeGreaterThan(-1)
    expect(successorStart).toBeGreaterThan(insertStart)
    const productiveCompletion = portableScanSql.slice(insertStart, successorStart)
    expect(productiveCompletion).toContain('created_at, updated_at')
    expect(productiveCompletion).toContain('p_completed_at, p_completed_at')
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

  it('fails closed for non-committed commit/finalize, non-canonical, or ambiguous durable work', () => {
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
      messageId: scanMessageId(item),
      phase: 'scan',
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
