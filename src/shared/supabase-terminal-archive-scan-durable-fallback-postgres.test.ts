import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const stagedPath = resolve(
  process.cwd(),
  'ops/production-sql/20260823051500_xrpl_terminal_archive_scan_durable_fallback.sql',
)
const staged = readFileSync(stagedPath, 'utf8')

type Work = {
  workId: string
  network: string
  epochId: string
  baseIdentity: string
  previousLedgerIndex: number
  startLedgerIndex: number
  expectedParentHash: string
  scannedEndLedgerIndex: number | null
  finalLedgerHash: string | null
  status: string
  payloadDigest: string | null
  expectedPayloadChunks: number
  expectedCommitChunks: number
  sourceScanSequence: number
  createdAt: string
}

const POST_SCAN = new Set(['staged', 'committing', 'finalizing', 'committed', 'error'])

function scanId(work: Work, sequence = work.sourceScanSequence): string {
  return `scan:v1:${work.network}:${work.epochId}:${work.baseIdentity}:${work.previousLedgerIndex}:${work.expectedParentHash.toUpperCase()}:${sequence}`
}

function workId(work: Omit<Work, 'workId'>): string {
  return `collector-work-v1:${work.network}:${work.epochId}:${work.baseIdentity}:${work.previousLedgerIndex + 1}:${work.expectedParentHash.toUpperCase()}`
}

function commitId(id: string, chunk = 0): string {
  return `commit:v1:${id.replaceAll(':', '%3A')}:${chunk}`
}

function durableScanFallback(messageId: string, phase: string, live: Set<string>, works: Work[]) {
  if (live.has(messageId) || phase !== 'scan') return null
  const suffix = messageId.match(/:([0-9]+):([A-F0-9]{64}):([0-9]+)$/u)
  if (!suffix) return null
  const previous = Number(suffix[1])
  const parent = suffix[2]
  const sequence = Number(suffix[3])
  if (!Number.isSafeInteger(previous) || previous < 0 || !Number.isSafeInteger(sequence) || sequence < 0) return null
  const matches = works.filter((work) =>
    work.previousLedgerIndex === previous
    && work.expectedParentHash === parent
    && work.sourceScanSequence === sequence
    && work.startLedgerIndex === work.previousLedgerIndex + 1
    && work.scannedEndLedgerIndex !== null
    && work.scannedEndLedgerIndex >= work.startLedgerIndex
    && work.finalLedgerHash !== null
    && /^[A-F0-9]{64}$/u.test(work.finalLedgerHash)
    && work.payloadDigest !== null
    && /^[a-f0-9]{64}$/u.test(work.payloadDigest)
    && work.expectedPayloadChunks >= 1
    && work.expectedCommitChunks >= 1
    && POST_SCAN.has(work.status)
    && work.workId === workId(work)
    && messageId === scanId(work),
  )
  if (matches.length === 0) return null
  if (matches.length !== 1) throw new Error('ambiguous durable scan duplicate')
  return {
    completed: true,
    duplicate: true,
    derived: true,
    successor_message_id: commitId(matches[0].workId, 0),
    completed_at: matches[0].createdAt,
  }
}

function makeWork(overrides: Partial<Work> = {}): Work {
  const base: Omit<Work, 'workId'> = {
    network: 'devnet',
    epochId: 'epoch',
    baseIdentity: 'base:with:colon',
    previousLedgerIndex: 30,
    startLedgerIndex: 31,
    expectedParentHash: 'E'.repeat(64),
    scannedEndLedgerIndex: 31,
    finalLedgerHash: 'F'.repeat(64),
    status: 'committed',
    payloadDigest: 'c'.repeat(64),
    expectedPayloadChunks: 2,
    expectedCommitChunks: 2,
    sourceScanSequence: 7,
    createdAt: '2026-08-03T00:00:00.000Z',
  }
  const merged = { ...base, ...overrides } as Omit<Work, 'workId'>
  return { ...merged, workId: overrides.workId ?? workId(merged) }
}

describe('terminal archive productive-scan durable fallback staging', () => {
  it('is transactionally staged outside Supabase migrations', () => {
    expect(staged.trimStart().startsWith('begin;')).toBe(true)
    expect(staged.trimEnd().endsWith('commit;')).toBe(true)
    expect(staged).toContain('Merge does not apply this file')
    expect(staged).toContain('Issue #1261 prepare -> exact OWNER authorization -> bounded apply -> independent read-only verify')
    expect(staged).not.toContain('supabase/migrations/')
  })

  it('pins exact production archive and identity helper fingerprints', () => {
    expect(staged).toContain('170c7ff6069ae9dd9a272a04dd839a2d575c9e9b4055b121149a13dda6467044')
    expect(staged).toContain('cd79dde7fc5fd160acecda28b0f1355245765cbd041cb70423b5b3119748a0a4')
    expect(staged).toContain('6650d4e5e70bceafc035fe467d1ae7b0e1c40e487ad9b92108aa1ebba02a0308')
    expect(staged).toContain('c3d965bd154c933a355c68097e4ca2f52c75a0a83b121ccd3d2eee366a3c3b79')
    expect(staged).toContain('run 32618515092')
  })

  it('requires the complete scan-certificate closure first', () => {
    for (const sha of [
      '0a37e55b8881847a61cf95f78746039fd6967571721aa50b5a0f1baff62fd1c6',
      '5e9cb3bfea6126c1d436ffb15fee5e8aaf6f2da3e0f83bf048d9cbdcf35040b0',
      'daf97c6858300a2ec4a00eb24f60b53936dc4aa56200accc16e098c64e8f37b7',
      '907e4c741ba065ffcb2ddd0a7358f83737c737673ca1fa6d371710f96e5a62ff',
      'cfbc2dde88dc7026621193d2b970a1fdd35b7f9f7a248a7ef0035f1f87cae446',
      '8c810628d2bf0be9aa25e8aab2a60a23912563e7524f177c35a4f261ca7c0eec',
    ]) expect(staged).toContain(sha)
    expect(staged).toContain('source_scan_sequence')
    expect(staged).toContain('next_scan_sequence')
  })

  it('keeps archive/live fast paths ahead of durable work lookup', () => {
    const archiveLookup = staged.indexOf('from xrpl_phase_archive_v1.terminal_messages')
    const liveLookup = staged.indexOf('select 1 from public.xrpl_phase_messages where message_id = p_message_id')
    const durableLookup = staged.indexOf('from public.xrpl_phase_work as work')
    expect(archiveLookup).toBeGreaterThan(-1)
    expect(liveLookup).toBeGreaterThan(archiveLookup)
    expect(durableLookup).toBeGreaterThan(liveLookup)
  })

  it('pins the exact staged function body source hash', () => {
    const marker = 'create or replace function xrpl_phase_archive_v1.duplicate_completion('
    const start = staged.indexOf(marker)
    const bodyStart = staged.indexOf('as $function$', start) + 'as $function$'.length
    const bodyEnd = staged.indexOf('$function$;', bodyStart)
    const body = staged.slice(bodyStart, bodyEnd)
    expect(createHash('sha256').update(body).digest('hex')).toBe(
      '5ca60025c49a205de120c352ecef9d48ac18db566515b6595fe93909958098b4',
    )
  })

  it('derives productive scan with production raw-colon and commit escaping rules', () => {
    const work = makeWork()
    const result = durableScanFallback(scanId(work), 'scan', new Set(), [work])
    expect(result).toEqual({
      completed: true,
      duplicate: true,
      derived: true,
      successor_message_id: commitId(work.workId, 0),
      completed_at: work.createdAt,
    })
    expect(result?.successor_message_id).toContain('%3A')
    expect(result).not.toHaveProperty('result_digest')
  })

  it('rejects wrong sequence, planned/noncanonical work, caught-up no-work, and commit fallback', () => {
    const work = makeWork()
    expect(durableScanFallback(scanId(work, 8), 'scan', new Set(), [work])).toBeNull()
    expect(durableScanFallback(scanId({ ...work, status: 'planned' }), 'scan', new Set(), [{ ...work, status: 'planned' }])).toBeNull()
    expect(durableScanFallback(scanId(work), 'scan', new Set(), [{ ...work, workId: 'bad-work' }])).toBeNull()
    expect(durableScanFallback('scan:v1:devnet:epoch:caught:60:' + '5'.repeat(64) + ':9', 'scan', new Set(), [])).toBeNull()
    expect(durableScanFallback(commitId(work.workId, 0), 'commit', new Set(), [work])).toBeNull()
  })

  it('returns null for a live message before durable derivation', () => {
    const work = makeWork()
    const id = scanId(work)
    expect(durableScanFallback(id, 'scan', new Set([id]), [work])).toBeNull()
  })

  it('does not stage history/archive/scheduler/R5 mutations', () => {
    expect(staged).not.toMatch(/\b(delete|truncate|vacuum|reindex)\b/iu)
    expect(staged).not.toMatch(/update\s+public\.xrpl_phase_work/iu)
    expect(staged).not.toMatch(/insert\s+into\s+xrpl_phase_archive_v1\.terminal_messages/iu)
    expect(staged).not.toContain('xrpl_r5_v1.recovery_runs')
    expect(staged).not.toContain('wrangler')
  })
})
