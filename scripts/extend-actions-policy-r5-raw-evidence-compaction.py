from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r5-raw-evidence-compaction.py <generated-policy>')
path = Path(sys.argv[1])
text = path.read_text()


def replace_once(name, old, new):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{name} expected exactly one occurrence, found {count}')
    text = text.replace(old, new)


replace_once(
    'raw compaction allowlist',
    '  r5-phase-message-ready-partial-index-apply.yml\n  r5-raw-evidence-retention.yml\n  r5-retention-readonly-preflight.yml',
    '  r5-phase-message-ready-partial-index-apply.yml\n  r5-raw-evidence-compaction.yml\n  r5-raw-evidence-retention.yml\n  r5-retention-readonly-preflight.yml',
)
replace_once(
    'raw compaction workflow count',
    'GitHub Actions workflow count must remain exactly twenty-six while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly twenty-seven while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'raw compaction symbol',
    'r5_phase_ready_index_apply = "r5-phase-message-ready-partial-index-apply.yml"\nr5_raw_evidence_retention = "r5-raw-evidence-retention.yml"',
    'r5_phase_ready_index_apply = "r5-phase-message-ready-partial-index-apply.yml"\nr5_raw_evidence_compaction = "r5-raw-evidence-compaction.yml"\nr5_raw_evidence_retention = "r5-raw-evidence-retention.yml"',
)
replace_once(
    'raw compaction trigger',
    '    r5_phase_ready_index_apply: ["issue_comment"],\n    r5_raw_evidence_retention: ["issue_comment"],',
    '    r5_phase_ready_index_apply: ["issue_comment"],\n    r5_raw_evidence_compaction: ["issue_comment"],\n    r5_raw_evidence_retention: ["issue_comment"],',
)

marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('raw compaction insertion point is not unique')
block = r'''raw_evidence_compaction = (root / r5_raw_evidence_compaction).read_text()
raw_evidence_compaction_manager = (root.parent.parent / "scripts/manage-r5-raw-evidence-compaction.mjs").read_text()
for required in (
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-raw-evidence-compaction-prepare'",
    "startsWith(github.event.comment.body, '/r5-raw-evidence-compaction-authorize ')",
    "scripts/manage-r5-raw-evidence-compaction.mjs",
    "Inspect raw-evidence physical state read-only",
    "Publish expiring owner authorization proposal",
    "Parse exact owner authorization",
    "Revalidate exact authorized state read-only",
    "Apply exact bounded raw-evidence physical compaction",
):
    if required not in raw_evidence_compaction:
        raise SystemExit(f"raw-evidence compaction workflow missing requirement: {required}")
for forbidden in (
    "  push:", "  schedule:", "workflow_dispatch", "pull_request_target", "contents: write",
    "supabase db push", "supabase functions deploy", "wrangler deploy", "MAINNET_ENABLED: 'true'",
):
    if forbidden in raw_evidence_compaction:
        raise SystemExit(f"raw-evidence compaction workflow contains forbidden capability: {forbidden.strip()}")
if raw_evidence_compaction.count("issues: write") != 1:
    raise SystemExit("raw-evidence compaction workflow must have exactly one issue-write permission")
for required in (
    "managementQuery(inspectionSql(), true)",
    "await managementQuery(MUTATION_SQL, false)",
    "lock table public.xrpl_phase_payload_chunks, public.xrpl_phase_commit_chunks in access exclusive mode",
    "truncate table public.xrpl_phase_payload_chunks, public.xrpl_phase_commit_chunks",
    "insert into public.xrpl_phase_payload_chunks select * from r5_payload_chunks_copy",
    "insert into public.xrpl_phase_commit_chunks select * from r5_commit_chunks_copy",
    "payload row preservation mismatch",
    "commit row preservation mismatch",
    "mutationAuthorized: false",
    "schedulerMutationAuthorized: false",
    "vacuumAuthorized: false",
    "retentionPolicyMutationAuthorized: false",
):
    if required not in raw_evidence_compaction_manager:
        raise SystemExit(f"raw-evidence compaction manager missing contract: {required}")
if raw_evidence_compaction_manager.count("managementQuery(MUTATION_SQL, false)") != 1:
    raise SystemExit("raw-evidence compaction manager must have exactly one writable Management API call")

'''
text = text.replace(marker, block + marker)
replace_once(
    'raw compaction summary',
    'one owner-triggered read-only retention preflight, one authorization-gated bounded pg_cron history retention workflow, one authorization-gated 24h raw-evidence retention workflow, one owner-triggered read-only index-footprint probe, one authorization-gated work-status partial-index replacement, and one finite R5 recovery burst; no scheduled GitHub workflows.',
    'one owner-triggered read-only retention preflight, one authorization-gated bounded pg_cron history retention workflow, one authorization-gated 24h raw-evidence retention workflow, one authorization-gated row-preserving raw-evidence physical compaction workflow, one owner-triggered read-only index-footprint probe, one authorization-gated work-status partial-index replacement, and one finite R5 recovery burst; no scheduled GitHub workflows.',
)
path.write_text(text)
