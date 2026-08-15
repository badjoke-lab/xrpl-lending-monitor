import { readFile } from 'node:fs/promises'
import { describe, expect, test } from 'vitest'

const managerPath = new URL('../scripts/manage-r5-raw-evidence-compaction.mjs', import.meta.url)
const workflowPath = new URL('../.github/workflows/r5-raw-evidence-compaction.yml', import.meta.url)

async function source(url: URL) {
  return readFile(url, 'utf8')
}

describe('R5 raw evidence physical compaction contract', () => {
  test('mutation is row-preserving and scoped to only the two raw evidence tables', async () => {
    const manager = await source(managerPath)

    expect(manager).toContain("'public.xrpl_phase_payload_chunks'")
    expect(manager).toContain("'public.xrpl_phase_commit_chunks'")
    expect(manager).toContain("lock table public.xrpl_phase_payload_chunks, public.xrpl_phase_commit_chunks in access exclusive mode")
    expect(manager).toContain('create temporary table r5_payload_chunks_copy on commit drop as table public.xrpl_phase_payload_chunks')
    expect(manager).toContain('create temporary table r5_commit_chunks_copy on commit drop as table public.xrpl_phase_commit_chunks')
    expect(manager).toContain('truncate table public.xrpl_phase_payload_chunks, public.xrpl_phase_commit_chunks')
    expect(manager).toContain('insert into public.xrpl_phase_payload_chunks select * from r5_payload_chunks_copy')
    expect(manager).toContain('insert into public.xrpl_phase_commit_chunks select * from r5_commit_chunks_copy')
    expect(manager).toContain('payload row preservation mismatch')
    expect(manager).toContain('commit row preservation mismatch')

    const mutationStart = manager.indexOf('const MUTATION_SQL')
    const mutationEnd = manager.indexOf('\n\nfor (const required', mutationStart)
    expect(mutationStart).toBeGreaterThanOrEqual(0)
    expect(mutationEnd).toBeGreaterThan(mutationStart)
    const mutation = manager.slice(mutationStart, mutationEnd)

    expect(mutation.match(/\btruncate\s+table\b/giu)).toHaveLength(1)
    expect(mutation).not.toMatch(/\bdelete\s+from\b/iu)
    expect(mutation).not.toMatch(/\bupdate\s+public\b/iu)
    expect(mutation).not.toMatch(/(?:^|;)\s*(?:drop|alter|vacuum|reindex|cluster)\b/iu)
    expect(mutation).not.toMatch(/\bcascade\b/iu)
    expect(mutation).not.toMatch(/\bcron\./iu)
    expect(mutation).not.toMatch(/\bxrpl_phase_work\b/iu)
    expect(mutation).not.toMatch(/\bxrpl_phase_watermarks\b/iu)
    expect(mutation).not.toMatch(/\bxrpl_phase_messages\b/iu)
    expect(mutation).toContain('on commit drop')
  })

  test('prepare remains read-only and apply revalidates the exact authorized state and mutation', async () => {
    const manager = await source(managerPath)

    expect(manager).toContain('mutationAuthorized: false')
    expect(manager).toContain('schedulerMutationAuthorized: false')
    expect(manager).toContain('vacuumAuthorized: false')
    expect(manager).toContain('retentionPolicyMutationAuthorized: false')
    expect(manager).toContain("if (before.structuralStateSha256 !== authorizedState) fail('authorized structural state mismatch')")
    expect(manager).toContain("if (before.mutation.sha256 !== authorizedMutation) fail('authorized mutation mismatch')")
    expect(manager).toContain("if (after.structuralStateSha256 !== authorizedState) fail('post-compaction structural state mismatch')")
    expect(manager).toContain("if (after.payloadRows !== before.payloadRows || after.payloadDigest !== before.payloadDigest) fail('post-compaction payload preservation mismatch')")
    expect(manager).toContain("if (after.commitRows !== before.commitRows || after.commitDigest !== before.commitDigest) fail('post-compaction commit preservation mismatch')")
  })

  test('workflow requires an exact expiring owner authorization tied to commit, manager, state, project and mutation', async () => {
    const workflow = await source(workflowPath)

    expect(workflow).toContain("github.event.comment.body == '/r5-raw-evidence-compaction-prepare'")
    expect(workflow).toContain("startsWith(github.event.comment.body, '/r5-raw-evidence-compaction-authorize ')")
    expect(workflow).toContain("date -u -d '+2 hours'")
    expect(workflow).toContain('commit=${SOURCE_COMMIT}')
    expect(workflow).toContain('manager=${MANAGER_SHA}')
    expect(workflow).toContain('state=${STATE_SHA}')
    expect(workflow).toContain('project=${PROJECT_DIGEST}')
    expect(workflow).toContain('mutation=${MUTATION_SHA}')
    expect(workflow).toContain('prepare_run=${GITHUB_RUN_ID}')
    expect(workflow).toContain('expires=${expires}')
    expect(workflow).toContain('nonce=${nonce}')
    expect(workflow).toContain('authorization shape mismatch')
  })

  test('workflow proposal output preserves the complete prepared measurement tuple', async () => {
    const workflow = await source(workflowPath)

    for (const output of [
      'source_commit',
      'manager_sha',
      'state_sha',
      'project_digest',
      'mutation_sha',
      'database_bytes',
      'payload_rows',
      'commit_rows',
      'payload_digest',
      'commit_digest',
      'payload_bytes',
      'commit_bytes',
    ]) {
      expect(workflow).toContain(`${output}=%s`)
    }

    expect(workflow).toContain('Payload rows / relation bytes / digest:')
    expect(workflow).toContain('Commit rows / relation bytes / digest:')
  })
})
