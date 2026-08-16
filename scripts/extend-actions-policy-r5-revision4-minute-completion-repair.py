from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r5-revision4-minute-completion-repair.py <generated-policy>')
path = Path(sys.argv[1])
text = path.read_text()


def replace_once(name, old, new):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{name} expected exactly one occurrence, found {count}')
    text = text.replace(old, new)


replace_once(
    'minute completion repair allowlist',
    '  r5-revision4-db-footprint-probe.yml\n  r5-revision4-minute-successor.yml',
    '  r5-revision4-db-footprint-probe.yml\n  r5-revision4-minute-completion-repair.yml\n  r5-revision4-minute-successor.yml',
)
replace_once(
    'minute completion repair workflow count',
    'GitHub Actions workflow count must remain exactly twenty-nine while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly thirty while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'minute completion repair symbol',
    'r5_rev4_prepared_head_repair = "r5-revision4-prepared-head-repair.yml"',
    'r5_rev4_prepared_head_repair = "r5-revision4-prepared-head-repair.yml"\nr5_rev4_minute_completion_repair = "r5-revision4-minute-completion-repair.yml"',
)
replace_once(
    'minute completion repair trigger',
    '    r5_rev4_prepared_head_repair: ["issue_comment"],',
    '    r5_rev4_prepared_head_repair: ["issue_comment"],\n    r5_rev4_minute_completion_repair: ["issue_comment"],',
)

marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('minute completion repair policy insertion point is not unique')
block = r'''minute_completion_repair = (root / r5_rev4_minute_completion_repair).read_text()
minute_completion_manager = (root / "../../scripts/manage-r5-revision4-minute-completion-capture-guard.mjs").read_text()
minute_completion_inspector = (root / "../../scripts/inspect-r5-revision4-minute-failure-state.mjs").read_text()
for required in (
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-revision4-minute-completion-repair-prepare'",
    "startsWith(github.event.comment.body, '/r5-revision4-minute-completion-repair-apply ')",
    "ops/production-sql/20260816040000_xrpl_r5_revision4_minute_completion_capture_guard.sql",
    "scripts/manage-r5-revision4-minute-completion-capture-guard.mjs",
    "scripts/inspect-r5-revision4-minute-failure-state.mjs",
    "Audit exact completion wrapper and formal evidence read-only",
    "Apply exact completion capture predicate repair",
    "Prove scheduler unchanged",
    "formalEvidencePreservedExactly",
    "qualificationConstraintPreservedExactly",
    "publicReaderMutationPerformed",
    "No Mainnet, stabilization, soak, or history reduction is authorized.",
    "No history deletion or public-reader rewrite is authorized.",
):
    if required not in minute_completion_repair:
        raise SystemExit(f"revision-4 minute completion repair workflow missing fail-closed requirement: {required}")
for forbidden in (
    "  push:",
    "  schedule:",
    "workflow_dispatch",
    "pull_request_target",
    "contents: write",
    "supabase functions deploy",
    "supabase db push",
    "cron.schedule",
    "cron.unschedule",
    "wrangler deploy",
    "MAINNET_ENABLED: 'true'",
):
    if forbidden in minute_completion_repair:
        raise SystemExit(f"revision-4 minute completion repair workflow contains forbidden capability: {forbidden.strip()}")
if minute_completion_repair.count("issues: write") != 1:
    raise SystemExit("revision-4 minute completion repair workflow must have exactly one issue-write permission")
for required in (
    "const SQL_PATH = `ops/production-sql/${VERSION}_${NAME}.sql`",
    "read_only: readOnly",
    "classification !== 'unapplied_expected'",
    "insert into supabase_migrations.schema_migrations",
    "classification !== 'applied_consistent'",
    "formalEvidencePreservedExactly: true",
    "qualificationConstraintPreservedExactly: true",
    "formalRunPreservedExactly: true",
    "publicReaderMutationPerformed: false",
    "mainnetDisabled: true",
):
    if required not in minute_completion_manager:
        raise SystemExit(f"revision-4 minute completion repair manager missing guarded contract: {required}")
for forbidden in (
    "truncate table",
    "delete from xrpl_r5_v1.revision4_accounting_qualification_evidence",
    "alter table",
    "cron.schedule",
    "cron.unschedule",
):
    if forbidden in minute_completion_manager.lower():
        raise SystemExit(f"revision-4 minute completion repair manager contains forbidden operation: {forbidden}")
for required in (
    "read_only: true",
    "r5-recovery-selected-revision4-minute-entry",
    "r5-recovery-selected-revision4-entry",
    "revision4_accounting_qualification_evidence",
    "readOnly: true",
    "mainnetDisabled: true",
):
    if required not in minute_completion_inspector:
        raise SystemExit(f"revision-4 minute failure-state inspector missing read-only contract: {required}")

'''
text = text.replace(marker, block + marker)
path.write_text(text)
