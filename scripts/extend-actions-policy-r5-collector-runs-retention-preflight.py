from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r5-collector-runs-retention-preflight.py <generated-policy>')

path = Path(sys.argv[1])
text = path.read_text()


def replace_once(name: str, old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{name} expected exactly one occurrence, found {count}')
    text = text.replace(old, new)


replace_once(
    'collector retention preflight allowlist entry',
    '  r5-bounded-recovery-burst.yml\n  r5-cron-history-retention.yml\n',
    '  r5-bounded-recovery-burst.yml\n  r5-collector-runs-retention-preflight.yml\n  r5-cron-history-retention.yml\n',
)
replace_once(
    'collector retention preflight workflow count',
    'GitHub Actions workflow count must remain exactly thirty-six while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly thirty-seven while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'collector retention preflight workflow symbol',
    'r5_terminal_archive_v2_preflight = "r5-terminal-archive-v2-preflight.yml"',
    'r5_terminal_archive_v2_preflight = "r5-terminal-archive-v2-preflight.yml"\nr5_collector_runs_retention_preflight = "r5-collector-runs-retention-preflight.yml"',
)
replace_once(
    'collector retention preflight trigger policy',
    '    r5_terminal_archive_v2_preflight: ["issue_comment"],',
    '    r5_terminal_archive_v2_preflight: ["issue_comment"],\n    r5_collector_runs_retention_preflight: ["issue_comment"],',
)

marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('collector retention preflight insertion point is not unique')

block = r'''collector_runs_retention_preflight = (root / r5_collector_runs_retention_preflight).read_text()
collector_runs_retention_probe = (root / "../../scripts/r5-collector-runs-retention-readonly-preflight.mjs").read_text()
for required in (
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-collector-runs-retention-preflight'",
    "scripts/r5-collector-runs-retention-readonly-preflight.mjs",
    "retentionMutationAuthorized",
    "physicalRewriteAuthorized",
    "sequenceMutationAuthorized",
    "r5RearmAuthorized",
):
    if required not in collector_runs_retention_preflight:
        raise SystemExit(f"collector retention preflight workflow missing read-only requirement: {required}")
for forbidden in (
    "  push:", "  schedule:", "workflow_dispatch", "pull_request_target",
    "contents: write", "supabase functions deploy", "supabase db push",
    "cron.schedule", "cron.unschedule", "wrangler deploy", "MAINNET_ENABLED: 'true'",
    "- name: Apply", "- name: Execute", "startsWith(github.event.comment.body",
):
    if forbidden in collector_runs_retention_preflight:
        raise SystemExit(f"collector retention preflight workflow contains forbidden capability: {forbidden.strip()}")
if collector_runs_retention_preflight.count("issues: write") != 1:
    raise SystemExit("collector retention preflight must have exactly one issue-write permission")

for required in (
    "const ACTIVE_RUN_ID = 'r5-recovery-selected-revision4-minute2-entry'",
    "const RETAIN_LATEST_ROWS = 256",
    "public.xrpl_collector_runs",
    "row_number() over (order by completed_at desc nulls last, id desc)",
    "candidateLogicalBytes",
    "candidateDigest",
    "inboundForeignKeys",
    "sequence_state",
    "routine_consumers",
    "read_only: true",
    "retentionMutationAuthorized',false",
    "physicalRewriteAuthorized',false",
    "sequenceMutationAuthorized',false",
    "r5RearmAuthorized',false",
):
    if required not in collector_runs_retention_probe:
        raise SystemExit(f"collector retention preflight probe missing read-only guard: {required}")
for forbidden in (
    "read_only: false", "truncate table", "vacuum full", "reindex index",
    "delete from public.", "update public.", "insert into public.", "setval(",
):
    if forbidden in collector_runs_retention_probe.lower():
        raise SystemExit(f"collector retention preflight probe contains mutation capability: {forbidden}")

'''
text = text.replace(marker, block + marker)
path.write_text(text)
