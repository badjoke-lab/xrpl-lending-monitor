import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const audit = readFileSync(
  resolve(process.cwd(), 'scripts/r5-terminal-scan-sequence-readonly-audit.mjs'),
  'utf8',
)
const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/r5-index-footprint-readonly-probe.yml'),
  'utf8',
)

describe('terminal scan sequence read-only audit contract', () => {
  it('uses only the existing owner-only Issue #1261 read-only workflow', () => {
    expect(workflow).toContain("github.event.issue.number == 1261")
    expect(workflow).toContain("github.event.comment.user.login == 'badjoke-lab'")
    expect(workflow).toContain(
      "github.event.comment.body == '/r5-index-footprint-readonly-probe'",
    )
    expect(workflow).toContain('Read terminal scan sequence classification only')
    expect(workflow).toContain('node scripts/r5-terminal-scan-sequence-readonly-audit.mjs')
    expect(workflow).toContain('cat r5-index-footprint-readonly-probe/scan-sequence-summary.md')
    expect(workflow).not.toContain('schedule:')
    expect(workflow).not.toContain('workflow_dispatch:')
  })

  it('keeps the provider query explicitly SELECT/read_only only', () => {
    expect(audit).toContain("const SQL = String.raw`with transport as (")
    expect(audit).toContain('body: JSON.stringify({ query: SQL, read_only: true })')
    expect(audit).toContain("productionDatabaseReadOnly:true")
    expect(audit).toContain("productionMutationAuthorized:false")
    expect(audit).toContain("archiveMutationAuthorized:false")
    expect(audit).toContain("phaseBMutationAuthorized:false")
    expect(audit).toContain("r5RearmAuthorized:false")
    expect(audit).toContain("mainnetAuthorized:false")
  })

  it('classifies actual stored successor records instead of treating work presence as productive', () => {
    expect(audit).toContain("from xrpl_phase_archive_v1.terminal_messages a")
    expect(audit).toContain("from public.xrpl_phase_messages m")
    expect(audit).toContain("where x.message_id=s.successor_message_id")
    expect(audit).toContain("when r.successor_phase='commit'")
    expect(audit).toContain("and r.successor_payload->>'chunkIndex'='0'")
    expect(audit).toContain("when r.successor_phase='scan'")
    expect(audit).toContain("and r.successor_scan_sequence=r.scan_sequence+1")
    expect(audit).toContain('workPresenceAloneIsNotProductiveEvidence:true')
    expect(audit).not.toContain("when r.successor_work_id is not null then 'productive'")
  })

  it('does not depend on private message-ID helper execution or historical encoding guesses', () => {
    expect(audit).toContain(
      'scan-sequence audit must classify stored successor records, not invoke message-ID helpers',
    )
    expect(audit).not.toContain('public.xrpl_phase_scan_message_id(')
    expect(audit).not.toContain('public.xrpl_phase_commit_message_id(')
    expect(audit).not.toContain('public.xrpl_phase_finalize_message_id(')
  })

  it('proves sequence continuity, productive work mapping, and current active sequence separately', () => {
    for (const required of [
      'distinct_sequence_count<>b.row_count',
      'b.max_sequence+1<>b.row_count',
      'b.productive_sequence=b.max_sequence',
      "string_agg(work_id||':'||source_scan_sequence::text",
      "unmappedCommittedWorkCount",
      "activeScanSequences",
      "activeSequenceConsistent",
      "historicalSequenceMappingProven",
      "activeSequenceCertificateProven",
    ]) {
      expect(audit).toContain(required)
    }
  })

  it('does not fabricate unresolved historical fields', () => {
    expect(audit).toContain("completedAtDerivability:{caughtUp:false,commit:false}")
    expect(audit).toContain("resultDigestDerivabilityClaimed:false")
    expect(audit).toContain("appendOnlyScanCertificateRowsRequired:false")
  })
})
