import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const script = readFileSync(
  resolve(process.cwd(), 'scripts/r5-resource-restore-readonly-preflight.mjs'),
  'utf8',
)
const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/r5-retention-readonly-preflight.yml'),
  'utf8',
)

describe('R5 resource restore read-only preflight contract', () => {
  it('uses only Supabase Management API read-only queries', () => {
    expect(script).toContain("const RELATION = 'public.xrpl_resource_restore_v1'")
    expect(script).toContain('body: JSON.stringify({ query, parameters: [], read_only: true })')

    const queries = [...script.matchAll(/managementQuery\(String\.raw`([\s\S]*?)`\.trim\(\)\)/gu)]
      .map((match) => match[1].trim())
    expect(queries.length).toBe(2)
    for (const query of queries) {
      expect(query.toLowerCase().startsWith('select ')).toBe(true)
      expect(query).not.toMatch(/\b(?:delete|truncate|drop|alter|update|insert|vacuum|reindex|create|grant|revoke)\b/iu)
    }
  })

  it('collects storage, schema, dependency, and exact row-count evidence without publishing rows', () => {
    expect(script).toContain("'exactRowCount', (select count(*)::bigint from ${RELATION})")
    expect(script).toContain("'logicalRowBytes', (select coalesce(sum(pg_column_size(r)), 0)::bigint from ${RELATION} r)")
    expect(script).toContain("'totalRelationBytes', pg_total_relation_size(c.oid)::bigint")
    expect(script).toContain("'heapBytes', pg_relation_size(c.oid)::bigint")
    expect(script).toContain("'indexBytes', pg_indexes_size(c.oid)::bigint")
    expect(script).toContain("'columns', (")
    expect(script).toContain("'constraints', (")
    expect(script).toContain("'indexes', (")
    expect(script).toContain("'userTriggers', (")
    expect(script).toContain("'routineMentions', (")
    expect(script).toContain("'viewMentions', (")
    expect(script).toContain('rowContentsPublished: false')
  })

  it('does not turn inventory evidence into reclaim or rearm authorization', () => {
    expect(script).toContain('reconstructabilityProven: false')
    expect(script).toContain('safeToDeleteProven: false')
    expect(script).toContain("reclaimCandidateStatus: 'needs-reviewed-provenance-and-reconstruction-proof'")
    expect(script).toContain('productionMutationAuthorized: false')
    expect(script).toContain('deleteAuthorized: false')
    expect(script).toContain('truncateAuthorized: false')
    expect(script).toContain('dropAuthorized: false')
    expect(script).toContain('vacuumAuthorized: false')
    expect(script).toContain('schedulerMutationAuthorized: false')
    expect(script).toContain('deploymentAuthorized: false')
    expect(script).toContain('publicReaderMutationAuthorized: false')
    expect(script).toContain('r5RearmAuthorized: false')
    expect(script).toContain('r5RestartPerformed: false')
    expect(script).toContain('mainnetEnabled: false')
  })

  it('extends the existing owner-gated retention probe rather than adding a mutation trigger', () => {
    expect(workflow).toContain("github.event.comment.body == '/r5-retention-readonly-preflight'")
    expect(workflow).toContain('node scripts/r5-resource-restore-readonly-preflight.mjs')
    expect(workflow).toContain("test \"$(jq -r '.boundary.productionDatabaseReadOnly' /tmp/r5-resource-restore-readonly-preflight.json)\" = true")
    expect(workflow).toContain("test \"$(jq -r '.boundary.productionMutationAuthorized' /tmp/r5-resource-restore-readonly-preflight.json)\" = false")
    expect(workflow).toContain("test \"$(jq -r '.assessment.reconstructabilityProven' /tmp/r5-resource-restore-readonly-preflight.json)\" = false")
    expect(workflow).toContain("test \"$(jq -r '.assessment.safeToDeleteProven' /tmp/r5-resource-restore-readonly-preflight.json)\" = false")
    expect(workflow).not.toContain('workflow_dispatch:')
    expect(workflow).not.toContain('schedule:')
  })
})
