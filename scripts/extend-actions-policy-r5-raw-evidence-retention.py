from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r5-raw-evidence-retention.py <generated-policy>')
path = Path(sys.argv[1])
text = path.read_text()

def replace_once(name, old, new):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{name} expected exactly one occurrence, found {count}')
    text = text.replace(old, new)

replace_once(
    'raw retention allowlist',
    '  r5-phase-message-ready-partial-index-apply.yml\n  r5-retention-readonly-preflight.yml',
    '  r5-phase-message-ready-partial-index-apply.yml\n  r5-raw-evidence-retention.yml\n  r5-retention-readonly-preflight.yml',
)
replace_once(
    'raw retention workflow count',
    'GitHub Actions workflow count must remain exactly twenty-five while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly twenty-six while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'raw retention symbol',
    'r5_phase_ready_index_apply = "r5-phase-message-ready-partial-index-apply.yml"\nr5_work_status_index_apply = "r5-work-status-partial-index-apply.yml"',
    'r5_phase_ready_index_apply = "r5-phase-message-ready-partial-index-apply.yml"\nr5_raw_evidence_retention = "r5-raw-evidence-retention.yml"\nr5_work_status_index_apply = "r5-work-status-partial-index-apply.yml"',
)
replace_once(
    'raw retention trigger',
    '    r5_phase_ready_index_apply: ["issue_comment"],\n    r5_work_status_index_apply: ["issue_comment"],',
    '    r5_phase_ready_index_apply: ["issue_comment"],\n    r5_raw_evidence_retention: ["issue_comment"],\n    r5_work_status_index_apply: ["issue_comment"],',
)

marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('raw retention insertion point is not unique')
block = r'''raw_evidence_retention = (root / r5_raw_evidence_retention).read_text()
raw_evidence_manager = (root.parent.parent / "scripts/manage-r5-raw-evidence-retention.mjs").read_text()
for required in (
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-raw-evidence-retention-prepare'",
    "startsWith(github.event.comment.body, '/r5-raw-evidence-retention-authorize ')",
    "scripts/manage-r5-raw-evidence-retention.mjs",
    "Inspect raw-evidence retention pre-state read-only",
    "prepare.stderr.log",
    "if: always()",
    "Revalidate exact authorized state read-only",
    "Apply exact bounded raw-evidence retention",
    "--authorized-mutation \"$MUTATION_SHA\"",
    "writable targets: `xrpl_phase_payload_chunks / xrpl_phase_commit_chunks only`",
    "VACUUM/TRUNCATE/schema DDL: `none`",
    "deployment/Mainnet/stabilization/soak/R5 restart: `not authorized`",
):
    if required not in raw_evidence_retention:
        raise SystemExit(f"raw-evidence retention workflow missing requirement: {required}")
for forbidden in (
    "  push:", "  schedule:", "workflow_dispatch", "pull_request_target", "contents: write",
    "supabase db push", "supabase functions deploy", "wrangler deploy", "MAINNET_ENABLED: 'true'",
):
    if forbidden in raw_evidence_retention:
        raise SystemExit(f"raw-evidence retention workflow contains forbidden capability: {forbidden.strip()}")
if raw_evidence_retention.count("issues: write") != 1:
    raise SystemExit("raw-evidence retention workflow must have exactly one issue-write permission")
for required in (
    "const JOB_NAME = 'xrpl-r5-raw-evidence-retention-v1'",
    "const JOB_SCHEDULE = '47 */6 * * *'",
    "const RETENTION_HOURS = 24",
    "managementQuery(inspectionSql(), true)",
    "managementQuery(MUTATION_SQL, false)",
    "delete from public.xrpl_phase_payload_chunks",
    "delete from public.xrpl_phase_commit_chunks",
    "protected_integrity as materialized",
    "current payload evidence is incomplete",
    "predecessor payload evidence is incomplete",
    "rowMutationTargets: ['public.xrpl_phase_payload_chunks', 'public.xrpl_phase_commit_chunks']",
    "vacuumPerformed: false",
    "mainnetDisabled: true",
    "r5RestartAuthorized: false",
):
    if required not in raw_evidence_manager:
        raise SystemExit(f"raw-evidence retention manager missing contract: {required}")
if raw_evidence_manager.count("managementQuery(MUTATION_SQL, false)") != 1:
    raise SystemExit("raw-evidence retention manager must have exactly one writable Management API call")

'''
text = text.replace(marker, block + marker)
replace_once(
    'raw retention summary',
    'one owner-triggered read-only retention preflight, one authorization-gated bounded pg_cron history retention workflow, one owner-triggered read-only index-footprint probe, one authorization-gated work-status partial-index replacement, and one finite R5 recovery burst; no scheduled GitHub workflows.',
    'one owner-triggered read-only retention preflight, one authorization-gated bounded pg_cron history retention workflow, one authorization-gated 24h raw-evidence retention workflow, one owner-triggered read-only index-footprint probe, one authorization-gated work-status partial-index replacement, and one finite R5 recovery burst; no scheduled GitHub workflows.',
)
path.write_text(text)
