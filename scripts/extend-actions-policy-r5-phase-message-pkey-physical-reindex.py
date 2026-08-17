from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r5-phase-message-pkey-physical-reindex.py <generated-policy>')

path=Path(sys.argv[1])
text=path.read_text()

def replace_once(name,old,new):
    global text
    count=text.count(old)
    if count!=1:
        raise SystemExit(f'{name} expected exactly one generated-policy occurrence, found {count}')
    text=text.replace(old,new)

replace_once(
    'phase-message pkey workflow allowlist entry',
    '  r5-phase-message-ready-partial-index-apply.yml',
    '  r5-phase-message-pkey-physical-reindex.yml\n  r5-phase-message-ready-partial-index-apply.yml',
)
replace_once(
    'phase-message pkey workflow count',
    'GitHub Actions workflow count must remain exactly forty while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly forty-one while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'phase-message pkey workflow symbol',
    'r5_phase_ready_index_apply = "r5-phase-message-ready-partial-index-apply.yml"',
    'r5_phase_message_pkey_physical_reindex = "r5-phase-message-pkey-physical-reindex.yml"\nr5_phase_ready_index_apply = "r5-phase-message-ready-partial-index-apply.yml"',
)
replace_once(
    'phase-message pkey workflow trigger policy',
    '    r5_phase_ready_index_apply: ["issue_comment"],',
    '    r5_phase_message_pkey_physical_reindex: ["issue_comment"],\n    r5_phase_ready_index_apply: ["issue_comment"],',
)

marker='burst = (root / r5_burst).read_text()\n'
if text.count(marker)!=1:
    raise SystemExit('phase-message pkey policy insertion point is not unique')

block=r'''phase_message_pkey_reindex = (root / r5_phase_message_pkey_physical_reindex).read_text()
phase_message_pkey_manager = (root / "../../scripts/manage-r5-phase-message-pkey-physical-reindex.mjs").read_text()
for required in (
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-phase-message-pkey-reindex-prepare'",
    "startsWith(github.event.comment.body, '/r5-phase-message-pkey-reindex-authorize ')",
    "scripts/manage-r5-phase-message-pkey-physical-reindex.mjs",
    "Verify exact prior proposal and unique owner authorization",
    "Revalidate exact authorized state read-only",
    "Apply exact bounded phase-message pkey physical reindex",
    "Independent post-commit read-only verify",
    "rowMutationAuthorized",
    "vacuumAuthorized",
    "schedulerMutationAuthorized",
    "mainnetDisabled",
):
    if required not in phase_message_pkey_reindex:
        raise SystemExit(f"phase-message pkey workflow missing requirement: {required}")
for forbidden in (
    "  push:", "  schedule:", "workflow_dispatch", "pull_request_target",
    "contents: write", "supabase functions deploy", "supabase db push",
    "cron.schedule", "cron.unschedule", "wrangler deploy", "MAINNET_ENABLED: 'true'",
):
    if forbidden in phase_message_pkey_reindex:
        raise SystemExit(f"phase-message pkey workflow contains forbidden capability: {forbidden.strip()}")
if phase_message_pkey_reindex.count("issues: write") != 1:
    raise SystemExit("phase-message pkey workflow must have exactly one issue-write permission")

for required in (
    "const TABLE = 'public.xrpl_phase_messages'",
    "const PKEY = 'public.xrpl_phase_messages_pkey'",
    "const READY = 'public.xrpl_phase_messages_ready_idx'",
    "const EXPECTED_MIGRATION_HEAD = '20260816050000'",
    "const MAX_DATABASE_BYTES_BEFORE = 460_000_000",
    "const MIN_PKEY_BYTES_BEFORE = 30_000_000",
    "const MAX_PKEY_BYTES_BEFORE = 45_000_000",
    "const CONSERVATIVE_BUILD_OVERHEAD_BYTES = 16_000_000",
    "const MAX_CONSERVATIVE_PEAK_BYTES = 480_000_000",
    "lock table public.xrpl_phase_messages in share mode",
    "phase-message pkey authorized data drift under lock",
    "phase-message constraint state drift under lock",
    "phase-message pkey reindex safety ceiling exceeded under lock",
    "reindex index public.xrpl_phase_messages_pkey",
    "authorized structural state mismatch",
    "authorized data state mismatch",
    "authorized plan mismatch",
    "authorized mutation mismatch",
    "post-reindex phase-message row/constraint state mismatch",
    "post-reindex ready index changed",
    "phase-message pkey bytes were not reclaimed",
    "independent verify structural state mismatch",
    "productionReadOnly:true",
    "rowMutationPerformed:false",
    "vacuumPerformed:false",
    "schedulerMutationPerformed:false",
    "r5RearmPerformed:false",
):
    if required not in phase_message_pkey_manager:
        raise SystemExit(f"phase-message pkey manager missing guard: {required}")
lower=phase_message_pkey_manager.lower()
for forbidden in (
    "delete from public", "truncate table", "update public", "insert into public",
    "vacuum ", "cluster ", "cron.schedule", "cron.unschedule", "wrangler deploy",
):
    if forbidden in lower:
        raise SystemExit(f"phase-message pkey manager contains forbidden capability: {forbidden}")
if phase_message_pkey_manager.count("reindex index public.xrpl_phase_messages_pkey;") != 1:
    raise SystemExit("phase-message pkey manager must contain exactly one pkey REINDEX")
if "reindex index public.xrpl_phase_messages_ready_idx" in lower:
    raise SystemExit("phase-message pkey manager must not REINDEX ready index")

'''
text=text.replace(marker,block+marker)
path.write_text(text)
