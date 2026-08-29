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
current_repair_queue_pause_manager = (root / "../../scripts/current-repair-queue-pause.py").read_text()
compile(current_repair_queue_pause_manager, "current-repair-queue-pause.py", "exec")
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
    "startsWith(github.event.comment.body, '/current-repair-queue-pause-authorize ')",
    "RUNTIME_SHA: 4f3f185da6e5093d0a5ce13b43b22f3070e630b3",
    "python scripts/current-restart-preflight.py",
    "python scripts/deploy-current-repair-only.py --validate-source-only",
    "safeToDeployRepair",
    "safeToRestart",
    "CURRENT_REPAIR_DEPLOY_AUTHORIZATION",
    "python scripts/deploy-current-repair-only.py",
    "python scripts/current-repair-queue-pause.py --prepare",
    "python scripts/current-repair-queue-pause.py --execute",
    "current-repair-deploy-prepare",
    "current-repair-deploy-only",
    "current-repair-queue-pause-only",
    "This operation does not authorize or perform Queue reseed/restart.",
    "This operation authorizes Queue delivery pause only.",
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

for required in (
    '"queueCurrentlyActive": paused is False',
    '"queueBacklogEmpty": metrics["backlogCount"] == 0 and metrics["backlogBytes"] == 0',
    '"schedulerStillDisabled": cron == []',
    '"noPendingQueueSlot": slots["pending"] == 0',
    '"noLiveUnstagedProcessingSlot": slots["liveUnstaged"] == 0',
    '"noStagedSuccessorSlot": slots["stagedSuccessor"] == 0',
    'f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}"',
    '{"settings": {"delivery_paused": True}}',
    '"queuePauseRequestAccepted": False',
    'result["queuePauseRequestAccepted"] = queue_paused(mutation_queue) is True',
    'wait_for_paused()',
    'result["queuePausePerformed"] = True',
    '"queueResumed": False',
    '"workerDeploymentMutation": False',
    '"d1Mutation": False',
    '"schedulerMutation": False',
):
    if required not in current_repair_queue_pause_manager:
        raise SystemExit(f"Current repair Queue-pause manager is missing guarded requirement: {required}")
for forbidden in (
    'f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}/settings"',
    '{"delivery_paused": False}',
    'api("DELETE"',
    'api("PUT"',
    'wrangler',
    'delete_messages_permanently',
    '/purge',
):
    if forbidden in current_repair_queue_pause_manager:
        raise SystemExit(f"Current repair Queue-pause manager contains forbidden capability: {forbidden}")
if current_repair_queue_pause_manager.count('api(\n            "PATCH",') != 1:
    raise SystemExit("Current repair Queue-pause manager must contain exactly one Queue PATCH mutation")
'''

text = text.replace(marker, '\n' + block + marker)
path.write_text(text)
