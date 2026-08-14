from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r5-cron-history-retention.py <generated-policy>')
path = Path(sys.argv[1])
text = path.read_text()

def replace_once(name, old, new):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{name} expected exactly one occurrence, found {count}')
    text = text.replace(old, new)

replace_once('cron retention allowlist', '  r5-bounded-recovery-burst.yml\n  r5-phase-message-ready-partial-index-apply.yml', '  r5-bounded-recovery-burst.yml\n  r5-cron-history-retention.yml\n  r5-phase-message-ready-partial-index-apply.yml')
replace_once('cron retention workflow count', 'GitHub Actions workflow count must remain exactly twenty-two while R4F qualification and the guarded R5 workflows are active.', 'GitHub Actions workflow count must remain exactly twenty-three while R4F qualification and the guarded R5 workflows are active.')
replace_once('cron retention symbol', 'r5_phase_ready_index_apply = "r5-phase-message-ready-partial-index-apply.yml"\nr5_retention_preflight = "r5-retention-readonly-preflight.yml"', 'r5_cron_history_retention = "r5-cron-history-retention.yml"\nr5_phase_ready_index_apply = "r5-phase-message-ready-partial-index-apply.yml"\nr5_retention_preflight = "r5-retention-readonly-preflight.yml"')
replace_once('cron retention trigger', '    r5_phase_ready_index_apply: ["issue_comment"],\n    r5_retention_preflight: ["issue_comment"],', '    r5_cron_history_retention: ["issue_comment"],\n    r5_phase_ready_index_apply: ["issue_comment"],\n    r5_retention_preflight: ["issue_comment"],')

marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('cron retention insertion point is not unique')
block = r'''cron_history_retention = (root / r5_cron_history_retention).read_text()
cron_history_manager = (root.parent.parent / "scripts/manage-r5-cron-history-retention.mjs").read_text()
for required in (
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-cron-history-retention-prepare'",
    "startsWith(github.event.comment.body, '/r5-cron-history-retention-authorize ')",
    "scripts/manage-r5-cron-history-retention.mjs",
    "Inspect retention and compaction pre-state read-only",
    "prepare.stderr.log",
    "if: always()",
    "Exact physical-compaction mutation SHA-256",
    "mutation=${MUTATION_SHA}",
    "Run-ID sequence / last value / current max runid",
    "Revalidate authorized structural state read-only",
    "Apply exact bounded cron physical compaction",
    "--authorized-mutation \"$MUTATION_SHA\"",
    "physical compaction performed",
    "VACUUM performed",
    "payload/commit deletion: `none`",
    "public XRPL row mutation: `none`",
    "stabilization/soak/R5 restart: `not authorized`",
):
    if required not in cron_history_retention:
        raise SystemExit(f"cron history retention workflow missing requirement: {required}")
for forbidden in (
    "  push:",
    "  schedule:",
    "workflow_dispatch",
    "pull_request_target",
    "contents: write",
    "supabase db push",
    "supabase functions deploy",
    "wrangler deploy",
    "MAINNET_ENABLED: 'true'",
    "VACUUM cron.job_run_details",
    "vacuum cron.job_run_details",
):
    if forbidden in cron_history_retention:
        raise SystemExit(f"cron history retention workflow contains forbidden capability: {forbidden.strip()}")
if cron_history_retention.count("issues: write") != 1:
    raise SystemExit("cron history retention workflow must have exactly one issue-write permission")
for required in (
    "const RUN_ID_SEQUENCE = 'cron.runid_seq'",
    "pgCronExtension",
    "runIdSequenceContractSha256",
    "cron runid sequence moved backward during compaction",
    "cron runid sequence fell behind pre-compaction max runid",
    "managementQuery(MUTATION_SQL, false)",
):
    if required not in cron_history_manager:
        raise SystemExit(f"cron history retention manager missing run-ID safeguard: {required}")
for forbidden in (
    "pg_get_serial_sequence('cron.job_run_details','runid')",
    'pg_get_serial_sequence("cron.job_run_details","runid")',
):
    if forbidden in cron_history_manager:
        raise SystemExit(f"cron history retention manager retains invalid serial assumption: {forbidden}")
if "setval(" in cron_history_manager.lower():
    raise SystemExit("cron history retention manager must never reset cron.runid_seq with setval")

'''
text = text.replace(marker, block + marker)
replace_once('cron retention summary', 'one owner-triggered read-only retention preflight, and one finite R5 recovery burst; no scheduled GitHub workflows.', 'one owner-triggered read-only retention preflight, one authorization-gated bounded pg_cron history retention workflow, and one finite R5 recovery burst; no scheduled GitHub workflows.')
path.write_text(text)
