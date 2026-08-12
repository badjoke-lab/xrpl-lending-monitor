from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


workflow_path = Path('.github/workflows/r4f-revision4-12-ledger-qualification.yml')
workflow = workflow_path.read_text()

workflow = replace_once(
    workflow,
    """      - name: Verify exact applied-clean revision-4 state read-only
        shell: bash
""",
    """      - name: Verify exact applied-clean or prepared-resume revision-4 state read-only
        id: qualification_state
        shell: bash
""",
    'prepare state header',
)
start = workflow.index('          preflight_query="select jsonb_build_object(')
end = workflow.index('\n\n      - name: Bind exact source content and create expiring proposal', start)
workflow = workflow[:start] + """          node scripts/inspect-r4f-revision4-qualification-state.mjs \\
            --output r4f-revision4-12-ledger-prepare-evidence/qualification-state.json
""" + workflow[end:]

workflow = replace_once(
    workflow,
    """          PREPARE_SOURCE_SHA: ${{ steps.scheduler.outputs.r5_prepare_source_sha256 }}
""",
    """          PREPARE_SOURCE_SHA: ${{ steps.scheduler.outputs.r5_prepare_source_sha256 }}
          QUALIFICATION_STATE_MODE: ${{ steps.qualification_state.outputs.state_mode }}
          QUALIFICATION_STATE_DIGEST: ${{ steps.qualification_state.outputs.state_digest }}
""",
    'proposal state env',
)
workflow = replace_once(
    workflow,
    """          auth_command="/r4f-revision4-12-ledger-authorize commit=${SOURCE_COMMIT} runtime=${runtime_sha} egress=${egress_sha} evidence=${evidence_sha} function=${function_sha} checkpoint=${checkpoint_sha} prepare_source=${PREPARE_SOURCE_SHA} project=${PROJECT_DIGEST} job=${JOB_ID} command=${COMMAND_DIGEST} migration_state=applied_clean prepare_run=${GITHUB_RUN_ID} expires=${expires} nonce=${nonce}"
""",
    """          [[ "$QUALIFICATION_STATE_MODE" =~ ^(clean|prepared_resume)$ ]]
          [[ "$QUALIFICATION_STATE_DIGEST" =~ ^[a-f0-9]{64}$ ]]
          auth_command="/r4f-revision4-12-ledger-authorize commit=${SOURCE_COMMIT} runtime=${runtime_sha} egress=${egress_sha} evidence=${evidence_sha} function=${function_sha} checkpoint=${checkpoint_sha} prepare_source=${PREPARE_SOURCE_SHA} project=${PROJECT_DIGEST} job=${JOB_ID} command=${COMMAND_DIGEST} migration_state=applied_clean state=${QUALIFICATION_STATE_MODE} state_digest=${QUALIFICATION_STATE_DIGEST} prepare_run=${GITHUB_RUN_ID} expires=${expires} nonce=${nonce}"
""",
    'authorization state binding',
)
workflow = replace_once(
    workflow,
    """          CHECKPOINT_SHA: ${{ steps.proposal.outputs.checkpoint_sha }}
          EXPIRES: ${{ steps.proposal.outputs.expires }}
""",
    """          CHECKPOINT_SHA: ${{ steps.proposal.outputs.checkpoint_sha }}
          QUALIFICATION_STATE_MODE: ${{ steps.qualification_state.outputs.state_mode }}
          QUALIFICATION_STATE_DIGEST: ${{ steps.qualification_state.outputs.state_digest }}
          EXPIRES: ${{ steps.proposal.outputs.expires }}
""",
    'publish state env',
)
workflow = replace_once(
    workflow,
    """          Migration state: \`applied_clean\`
          Authorization expires: \`${EXPIRES}\`
""",
    """          Migration state: \`applied_clean\`
          Qualification state: \`${QUALIFICATION_STATE_MODE}\`
          Qualification state digest: \`${QUALIFICATION_STATE_DIGEST}\`
          Authorization expires: \`${EXPIRES}\`
""",
    'publish state display',
)
workflow = replace_once(
    workflow,
    """          4. create one qualification-only compact revision-4 boundary checkpoint/run and invoke the temporary proof function exactly once; the compact checkpoint does not claim a complete recovery snapshot;
""",
    """          4. with the exact authorized qualification state, either create one qualification-only compact revision-4 boundary checkpoint/run when \`clean\`, or reuse only the exact digest-bound prebatch checkpoint/prepared run when \`prepared_resume\`; do not delete or recreate prepared residue; then invoke the temporary proof function exactly once;
""",
    'resume scope',
)

workflow = replace_once(
    workflow,
    """          regex='^/r4f-revision4-12-ledger-authorize commit=([a-f0-9]{40}) runtime=([a-f0-9]{64}) egress=([a-f0-9]{64}) evidence=([a-f0-9]{64}) function=([a-f0-9]{64}) checkpoint=([a-f0-9]{64}) prepare_source=([a-f0-9]{64}) project=([a-f0-9]{64}) job=([0-9]+) command=([a-f0-9]{64}) migration_state=applied_clean prepare_run=([0-9]+) expires=([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z) nonce=([a-f0-9]{16})$'
""",
    """          regex='^/r4f-revision4-12-ledger-authorize commit=([a-f0-9]{40}) runtime=([a-f0-9]{64}) egress=([a-f0-9]{64}) evidence=([a-f0-9]{64}) function=([a-f0-9]{64}) checkpoint=([a-f0-9]{64}) prepare_source=([a-f0-9]{64}) project=([a-f0-9]{64}) job=([0-9]+) command=([a-f0-9]{64}) migration_state=applied_clean state=(clean|prepared_resume) state_digest=([a-f0-9]{64}) prepare_run=([0-9]+) expires=([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z) nonce=([a-f0-9]{16})$'
""",
    'authorization regex',
)
workflow = replace_once(
    workflow,
    """          prepare_run="${BASH_REMATCH[11]}"
          expires="${BASH_REMATCH[12]}"
          nonce="${BASH_REMATCH[13]}"
""",
    """          state_mode="${BASH_REMATCH[11]}"
          state_digest="${BASH_REMATCH[12]}"
          prepare_run="${BASH_REMATCH[13]}"
          expires="${BASH_REMATCH[14]}"
          nonce="${BASH_REMATCH[15]}"
""",
    'authorization capture indexes',
)
workflow = replace_once(
    workflow,
    """            "$commit" "$runtime_sha" "$egress_sha" "$evidence_sha" "$function_sha" "$checkpoint_sha" "$prepare_source_sha" "$project_digest" "$job_id" "$command_digest" "$prepare_run" "$expires" "$nonce" >> "$GITHUB_OUTPUT"
""",
    """            "$commit" "$runtime_sha" "$egress_sha" "$evidence_sha" "$function_sha" "$checkpoint_sha" "$prepare_source_sha" "$project_digest" "$job_id" "$command_digest" "$prepare_run" "$expires" "$nonce" >> "$GITHUB_OUTPUT"
          printf 'state_mode=%s\\nstate_digest=%s\\n' "$state_mode" "$state_digest" >> "$GITHUB_OUTPUT"
""",
    'authorization state outputs',
)

workflow = replace_once(
    workflow,
    """      - name: Reverify exact applied-clean revision-4 state read-only
        shell: bash
""",
    """      - name: Reverify exact authorized qualification state read-only
        id: qualification_state_before
        env:
          AUTHORIZED_STATE_MODE: ${{ steps.auth.outputs.state_mode }}
          AUTHORIZED_STATE_DIGEST: ${{ steps.auth.outputs.state_digest }}
        shell: bash
""",
    'execute state header',
)
execute_step = workflow.index('      - name: Reverify exact authorized qualification state read-only')
start = workflow.index('          query="select jsonb_build_object(', execute_step)
end = workflow.index('\n\n      - name: Set up Supabase CLI', start)
workflow = workflow[:start] + """          node scripts/inspect-r4f-revision4-qualification-state.mjs \\
            --output r4f-revision4-12-ledger-evidence/qualification-state-before.json
          test "$(jq -r '.mode' r4f-revision4-12-ledger-evidence/qualification-state-before.json)" = "$AUTHORIZED_STATE_MODE"
          test "$(jq -r '.digest' r4f-revision4-12-ledger-evidence/qualification-state-before.json)" = "$AUTHORIZED_STATE_DIGEST"
""" + workflow[end:]

workflow = replace_once(
    workflow,
    """          bun build "$PROOF_FUNCTION_PATH" \\
            --target=browser \\
            --format=esm \\
            --outfile="$bundle_path"
""",
    """          bun scripts/build-r4f-revision4-proof-bundle.ts \\
            "$PROOF_FUNCTION_PATH" "$bundle_path"
""",
    'isolated proof build',
)
workflow = replace_once(
    workflow,
    """          if (bundle.includes('cloudflare:')) {
            throw new Error('generated proof bundle contains a Cloudflare runtime import')
          }
          if (!bundle.includes('Deno.serve')) {
""",
    """          if (bundle.includes('cloudflare:')) {
            throw new Error('generated proof bundle contains a Cloudflare runtime import')
          }
          const denoEnvMutation = /\\bDeno\\.env\\.(?:set|delete)\\s*\\(/u
          if (denoEnvMutation.test(source) || denoEnvMutation.test(bundle)) {
            throw new Error('qualification proof may not mutate Deno.env')
          }
          if (!bundle.includes('__XRPL_R5_REVISION4_QUALIFICATION_OVERRIDE__')) {
            throw new Error('generated proof bundle is missing the qualification override')
          }
          if (!bundle.includes('Deno.serve')) {
""",
    'bundle mutation guard',
)
workflow = replace_once(
    workflow,
    """            cloudflareImports: 0,
            denoServeEntrypoint: true,
""",
    """            cloudflareImports: 0,
            denoEnvMutations: 0,
            qualificationOverrideBound: true,
            denoServeEntrypoint: true,
""",
    'bundle evidence fields',
)

workflow = replace_once(
    workflow,
    """        env:
          AUTHORIZED_CHECKPOINT_SHA: ${{ steps.auth.outputs.checkpoint_sha }}
        shell: bash
""",
    """        env:
          AUTHORIZED_CHECKPOINT_SHA: ${{ steps.auth.outputs.checkpoint_sha }}
          AUTHORIZED_STATE_MODE: ${{ steps.auth.outputs.state_mode }}
          AUTHORIZED_STATE_DIGEST: ${{ steps.auth.outputs.state_digest }}
          AUTHORIZED_CHECKPOINT_ID: ${{ steps.qualification_state_before.outputs.checkpoint_id }}
        shell: bash
""",
    'candidate authorized state env',
)
candidate_step = workflow.index('      - name: Execute exactly one production-shaped 12-ledger candidate batch')
create_start = workflow.index('          checkpoint_id="r5-checkpoint-revision4-proof-${GITHUB_RUN_ID}"', candidate_step)
end_line = '          test -n "$prepare_value"\n'
create_end = workflow.index(end_line, create_start) + len(end_line)
original_create = workflow[create_start:create_end]
indented_create = ''.join(('  ' + line if line.strip() else line) for line in original_create.splitlines(keepends=True))
guarded_create = """          node scripts/inspect-r4f-revision4-qualification-state.mjs \\
            --output r4f-revision4-12-ledger-evidence/qualification-state-before-proof.json
          test "$(jq -r '.mode' r4f-revision4-12-ledger-evidence/qualification-state-before-proof.json)" = "$AUTHORIZED_STATE_MODE"
          test "$(jq -r '.digest' r4f-revision4-12-ledger-evidence/qualification-state-before-proof.json)" = "$AUTHORIZED_STATE_DIGEST"

          if [ "$AUTHORIZED_STATE_MODE" = clean ]; then
""" + indented_create + """          elif [ "$AUTHORIZED_STATE_MODE" = prepared_resume ]; then
            checkpoint_id="$AUTHORIZED_CHECKPOINT_ID"
            [[ "$checkpoint_id" =~ ^r5-checkpoint-revision4-proof-[0-9]+$ ]]
            test "$checkpoint_id" = "$(jq -r '.checkpointId' r4f-revision4-12-ledger-evidence/qualification-state-before-proof.json)"
          else
            echo "unsupported authorized qualification state: $AUTHORIZED_STATE_MODE" >&2
            exit 1
          fi
"""
workflow = workflow[:create_start] + guarded_create + workflow[create_end:]
workflow_path.write_text(workflow)

contract_path = Path('scripts/test-r4f-revision4-12-ledger-qualification-contract.sh')
contract = contract_path.read_text()
contract = replace_once(
    contract,
    """prepare='scripts/prepare-r4f-g3-isolated-window.mjs'
workflow='.github/workflows/r4f-revision4-12-ledger-qualification.yml'
""",
    """prepare='scripts/prepare-r4f-g3-isolated-window.mjs'
qualification_state='scripts/inspect-r4f-revision4-qualification-state.mjs'
proof_builder='scripts/build-r4f-revision4-proof-bundle.ts'
workflow='.github/workflows/r4f-revision4-12-ledger-qualification.yml'
""",
    'contract helper paths',
)
contract = replace_once(
    contract,
    'for path in "$runtime" "$egress" "$evidence" "$wrapper" "$executor" "$qualifier" "$capture" "$prepare" "$workflow" "$checkpoint_sql" "$compact_checkpoint_contract"; do\n',
    'for path in "$runtime" "$egress" "$evidence" "$wrapper" "$executor" "$qualifier" "$capture" "$prepare" "$qualification_state" "$proof_builder" "$workflow" "$checkpoint_sql" "$compact_checkpoint_contract"; do\n',
    'contract required paths',
)
contract = replace_once(
    contract,
    'grep -Fq "XRPL_R5_REVISION4_UNEXPLAINED_EGRESS_RESERVE_BYTES\', \'0\'" "$wrapper"\n',
    """grep -Fq "unexplainedDirectionalReserveBytes: '0'" "$wrapper"
grep -Fq '__XRPL_R5_REVISION4_QUALIFICATION_OVERRIDE__' "$wrapper"
if grep -Eq '\\bDeno\\.env\\.(set|delete)[[:space:]]*\\(' "$wrapper"; then
  echo 'qualification wrapper mutates Deno.env' >&2
  exit 1
fi
""",
    'contract wrapper guard',
)
contract = replace_once(
    contract,
    """grep -Fq 'xrpl_complete_r5_revision4_recovery_batch' "$executor"

""",
    """grep -Fq 'xrpl_complete_r5_revision4_recovery_batch' "$executor"

grep -Fq "const RUN_ID = 'r5-recovery-selected-revision4-entry'" "$qualification_state"
grep -Fq "mode = 'clean'" "$qualification_state"
grep -Fq "mode = 'prepared_resume'" "$qualification_state"
grep -Fq 'state.batchRows === 0' "$qualification_state"
grep -Fq "resume.runStatus === 'prepared'" "$qualification_state"
grep -Fq 'resume.runCompletedBatches === 0' "$qualification_state"
grep -Fq 'resume.runCommittedLedgers === 0' "$qualification_state"
grep -Fq 'resume.runLastAccountingDigest === null' "$qualification_state"
grep -Fq 'resume.runStartedAt === null' "$qualification_state"
grep -Fq 'resume.runCompletedAt === null' "$qualification_state"
grep -Fq 'resume.checkpointStateDigest === resume.checkpointStateDigestRecomputed' "$qualification_state"
grep -Fq 'r4f-revision4-qualification-runtime-override' "$proof_builder"
grep -Fq "?? env('XRPL_R5_REVISION4_SELECTION_DIGEST')" "$proof_builder"
grep -Fq "?? env('XRPL_R5_REVISION4_UNEXPLAINED_EGRESS_RESERVE_BYTES')" "$proof_builder"

""",
    'contract resume/build guards',
)
contract = replace_once(
    contract,
    """grep -Fq 'migration_state=applied_clean prepare_run=${GITHUB_RUN_ID}' "$workflow"
grep -Fq 'migration_state=applied_clean prepare_run=([0-9]+)' "$workflow"
""",
    """grep -Fq 'migration_state=applied_clean state=${QUALIFICATION_STATE_MODE} state_digest=${QUALIFICATION_STATE_DIGEST} prepare_run=${GITHUB_RUN_ID}' "$workflow"
grep -Fq 'migration_state=applied_clean state=(clean|prepared_resume) state_digest=([a-f0-9]{64}) prepare_run=([0-9]+)' "$workflow"
""",
    'contract authorization state',
)
contract = replace_once(
    contract,
    """grep -Fq 'Migration state: `applied_clean`' "$workflow"
grep -Fq 'Revision-3 runtime source-set SHA-256' "$workflow"
""",
    """grep -Fq 'Migration state: `applied_clean`' "$workflow"
grep -Fq 'Qualification state: `${QUALIFICATION_STATE_MODE}`' "$workflow"
grep -Fq 'Qualification state digest: `${QUALIFICATION_STATE_DIGEST}`' "$workflow"
grep -Fq 'Revision-3 runtime source-set SHA-256' "$workflow"
""",
    'contract proposal state',
)
contract = replace_once(
    contract,
    """grep -Fq 'bun build "$PROOF_FUNCTION_PATH"' "$workflow"
grep -Fq -- '--target=browser' "$workflow"
grep -Fq -- '--format=esm' "$workflow"
""",
    """grep -Fq 'bun scripts/build-r4f-revision4-proof-bundle.ts' "$workflow"
grep -Fq "target: 'browser'" "$proof_builder"
grep -Fq "format: 'esm'" "$proof_builder"
""",
    'contract proof builder',
)
contract = replace_once(
    contract,
    """grep -Fq "bundle.includes('cloudflare:')" "$workflow"
grep -Fq "bundle.includes('Deno.serve')" "$workflow"
""",
    """grep -Fq "bundle.includes('cloudflare:')" "$workflow"
grep -Fq 'qualification proof may not mutate Deno.env' "$workflow"
grep -Fq "bundle.includes('__XRPL_R5_REVISION4_QUALIFICATION_OVERRIDE__')" "$workflow"
grep -Fq "bundle.includes('Deno.serve')" "$workflow"
""",
    'contract bundle guard',
)
contract = replace_once(
    contract,
    """grep -Fq 'AUTHORIZED_CHECKPOINT_SHA' "$workflow"
grep -Fq 'invalid compact checkpoint id' "$workflow"
""",
    """grep -Fq 'AUTHORIZED_CHECKPOINT_SHA' "$workflow"
grep -Fq 'AUTHORIZED_STATE_MODE' "$workflow"
grep -Fq 'AUTHORIZED_STATE_DIGEST' "$workflow"
grep -Fq 'AUTHORIZED_CHECKPOINT_ID' "$workflow"
grep -Fq 'qualification-state-before-proof.json' "$workflow"
grep -Fq 'if [ "$AUTHORIZED_STATE_MODE" = clean ]; then' "$workflow"
grep -Fq 'elif [ "$AUTHORIZED_STATE_MODE" = prepared_resume ]; then' "$workflow"
grep -Fq 'checkpoint_id="$AUTHORIZED_CHECKPOINT_ID"' "$workflow"
grep -Fq 'do not delete or recreate prepared residue' "$workflow"
grep -Fq 'invalid compact checkpoint id' "$workflow"
""",
    'contract candidate resume',
)
contract_path.write_text(contract)
