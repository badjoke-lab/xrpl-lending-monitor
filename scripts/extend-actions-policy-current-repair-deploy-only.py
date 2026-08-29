from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-current-repair-deploy-only.py <generated-policy>')

path = Path(sys.argv[1])
text = path.read_text()

old_policy = '    "deploy-queue-minute-cadence-fix.yml": ["pull_request", "push"],'
new_policy = '    "deploy-queue-minute-cadence-fix.yml": ["issue_comment"],'
if text.count(old_policy) != 1:
    raise SystemExit(f'expected one legacy deploy trigger policy, found {text.count(old_policy)}')
text = text.replace(old_policy, new_policy)

marker = '\nscheduled = []\n'
if text.count(marker) != 1:
    raise SystemExit(f'expected one scheduled policy marker, found {text.count(marker)}')

block = r'''
current_repair_deploy = (root / "deploy-queue-minute-cadence-fix.yml").read_text()
for required in (
    "name: Deploy Current repair only",
    "issue_comment:",
    "contents: read",
    "issues: write",
    "actions: read",
    "github.event.issue.number == 995",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/current-repair-deploy-prepare'",
    "startsWith(github.event.comment.body, '/current-repair-deploy-authorize ')",
    "RUNTIME_SHA: 4f3f185da6e5093d0a5ce13b43b22f3070e630b3",
    "python scripts/current-restart-preflight.py",
    "python scripts/deploy-current-repair-only.py --validate-source-only",
    "safeToDeployRepair",
    "safeToRestart",
    "CURRENT_REPAIR_DEPLOY_AUTHORIZATION",
    "python scripts/deploy-current-repair-only.py",
    "current-repair-deploy-prepare",
    "current-repair-deploy-only",
    "This operation does not authorize or perform Queue reseed/restart.",
):
    if required not in current_repair_deploy:
        raise SystemExit(f"Current repair deploy workflow is missing guarded requirement: {required}")
for forbidden in (
    "  push:",
    "  pull_request:",
    "  schedule:",
    "workflow_dispatch:",
    "pull_request_target",
    "contents: write",
    "MAINNET_ENABLED: 'true'",
    "wrangler deploy",
    "delivery_paused: false",
    "delete_messages_permanently",
):
    if forbidden in current_repair_deploy:
        raise SystemExit(f"Current repair deploy workflow contains forbidden capability: {forbidden.strip()}")
if current_repair_deploy.count("issues: write") != 1:
    raise SystemExit("Current repair deploy issue-write capability must remain exactly one permission")
'''

text = text.replace(marker, '\n' + block + marker)
path.write_text(text)
