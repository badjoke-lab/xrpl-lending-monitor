from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: normalize-actions-policy-r4f-g3-dual.py <generated-policy>')

path = Path(sys.argv[1])
text = path.read_text()

old = '''  r4c2c-devnet-historical-witness.yml
  r4f-g3-isolated-window.yml
  r4f-g3-one-shot-probe.yml
  r4f-g3-dual-provider-verdict.yml
  r5-bounded-recovery-burst.yml'''
new = '''  r4c2c-devnet-historical-witness.yml
  r4f-g3-dual-provider-verdict.yml
  r4f-g3-isolated-window.yml
  r4f-g3-one-shot-probe.yml
  r5-bounded-recovery-burst.yml'''
if text.count(old) != 1:
    raise SystemExit('generated G3 workflow allowlist block is not uniquely patchable')
text = text.replace(old, new)

old_trigger = '    supabase_remote: ["workflow_dispatch"],'
new_trigger = '    supabase_remote: ["issue_comment"],'
if text.count(old_trigger) != 1:
    raise SystemExit('generated halted Supabase trigger policy is not uniquely patchable')
text = text.replace(old_trigger, new_trigger)

supabase_start = text.index('supabase = (root / supabase_remote).read_text()')
g3_start = text.index('\ng3 = (root / g3_probe).read_text()', supabase_start)
replacement = r'''supabase = (root / supabase_remote).read_text()
for required in (
    "issue_comment:",
    "contents: read",
    "issues: write",
    "cancel-in-progress: false",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r4f-steady-reclaim-prepare'",
    "startsWith(github.event.comment.body, '/r4f-steady-reclaim-authorize ')",
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_PROJECT_ID",
    "SUPABASE_DB_PASSWORD",
    "supabase link --project-ref",
    "supabase db push --linked --dry-run",
    "supabase db push --linked --yes",
    "20260811012000",
    "api-keys?reveal=true",
    "database/query",
    "xrpl_preview_steady_qualification_reclaim",
    "xrpl_execute_steady_qualification_reclaim",
    "r4f-steady-qualification-reclaim-evidence",
    "retention-days: 14",
    "R5 live execution: \\`not authorized / not executed\\`",
    "gh issue comment",
):
    if required not in supabase:
        raise SystemExit(f"bounded steady reclaim workflow is missing fail-closed requirement: {required}")
for forbidden in (
    "  push:",
    "  schedule:",
    "pull_request_target",
    "contents: write",
    "supabase functions deploy",
    "supabase functions delete",
    "wrangler deploy",
    "xrpl-r5-recovery-batch",
    "MAINNET_ENABLED: 'true'",
    "/r4f-g3-",
):
    if forbidden in supabase:
        raise SystemExit(f"bounded steady reclaim workflow contains forbidden capability: {forbidden.strip()}")
if supabase.count("issues: write") != 1:
    raise SystemExit("bounded steady reclaim issue-write capability must remain exactly one permission")
if supabase.count("rest/v1/rpc/xrpl_execute_steady_qualification_reclaim") != 1:
    raise SystemExit("bounded steady reclaim workflow must contain exactly one destructive RPC invocation locator")
'''
text = text[:supabase_start] + replacement + text[g3_start:]

path.write_text(text)
