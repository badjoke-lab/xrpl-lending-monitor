from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-current-repair-deploy-only.py <generated-policy>')

path = Path(sys.argv[1])
text = path.read_text()

old_policy = '    "deploy-queue-minute-cadence-fix.yml": ["pull_request", "push"],'
new_policy = '    "current-repair-bounded-proof.yml": ["issue_comment"],\n    "deploy-queue-minute-cadence-fix.yml": ["issue_comment"],'
if text.count(old_policy) != 1:
    raise SystemExit(f'expected one legacy deploy trigger policy, found {text.count(old_policy)}')
text = text.replace(old_policy, new_policy)

old_allowlist = '  ci.yml\n  deploy-queue-minute-cadence-fix.yml'
new_allowlist = '  ci.yml\n  current-repair-bounded-proof.yml\n  deploy-queue-minute-cadence-fix.yml'
if text.count(old_allowlist) != 1:
    raise SystemExit(f'expected one Current repair allowlist insertion point, found {text.count(old_allowlist)}')
text = text.replace(old_allowlist, new_allowlist)

old_count = 'GitHub Actions workflow count must remain exactly forty-six while R4F qualification and the guarded R5 workflows are active.'
new_count = 'GitHub Actions workflow count must remain exactly forty-seven while R4F qualification, guarded R5 workflows, and the bounded Current repair proof are active.'
if text.count(old_count) != 1:
    raise SystemExit(f'expected one forty-six-workflow count guard, found {text.count(old_count)}')
text = text.replace(old_count, new_count)

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
    "RUNTIME_SHA: cf6cf39200e5384b4301aa3c0c0274f461a97c49",
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

current_repair_bounded = (root / "current-repair-bounded-proof.yml").read_text()
current_repair_bounded_manager = (root / "../../scripts/current-repair-bounded-proof.py").read_text()
compile(current_repair_bounded_manager, "current-repair-bounded-proof.py", "exec")
for required in (
    "name: Current repair bounded proof",
    "issue_comment:",
    "contents: read",
    "issues: write",
    "actions: read",
    "github.event.issue.number == 995",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/current-repair-bounded-proof-prepare'",
    "startsWith(github.event.comment.body, '/current-repair-bounded-proof-authorize ')",
    "REPAIRED_VERSION_ID: 75009b7d-f6f6-48dd-9350-1b44012b3553",
    "python scripts/current-repair-bounded-proof.py --prepare",
    "python scripts/current-repair-bounded-proof.py --execute",
    "AUTHORIZED_STATE_DIGEST",
    "AUTHORIZED_TARGET_SCHEDULED_TIME",
    "Verify exact prior proposal and unique authorization",
    "Execute exactly one bounded Current proof",
    "Continuous catch-up remains stopped",
):
    if required not in current_repair_bounded:
        raise SystemExit(f"Current repair bounded-proof workflow is missing guarded requirement: {required}")
for forbidden in (
    "  push:",
    "  pull_request:",
    "  schedule:",
    "workflow_dispatch:",
    "pull_request_target",
    "contents: write",
    "MAINNET_ENABLED: 'true'",
    "wrangler deploy",
    "delete_messages_permanently",
):
    if forbidden in current_repair_bounded:
        raise SystemExit(f"Current repair bounded-proof workflow contains forbidden capability: {forbidden.strip()}")
if current_repair_bounded.count("issues: write") != 1:
    raise SystemExit("Current repair bounded-proof workflow must have exactly one issue-write permission")

for required in (
    'REPAIRED_VERSION_ID = os.environ.get("REPAIRED_VERSION_ID", "c858ab5d-846e-4bd4-b26b-8f71c9382f8f")',
    'EXPECTED_MAX_LEDGERS = "32"',
    'PROOF_CRON = "queue-bounded-current-repair-proof"',
    '"queuePaused": paused is True',
    '"queueBacklogEmpty": metrics["backlogCount"] == 0 and metrics["backlogBytes"] == 0',
    '"schedulerDisabled": cron == []',
    '"repairedVersionActive": version == REPAIRED_VERSION_ID',
    '"noPendingSlot": slots["pending"] == 0',
    '"noLiveUnstagedSlot": slots["liveUnstaged"] == 0',
    '"noStagedSuccessorSlot": slots["stagedSuccessor"] == 0',
    'f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}/messages"',
    '{"body": message, "content_type": "json", "delay_seconds": delay_seconds}',
    'set_queue_paused(False)',
    'set_queue_paused(True)',
    '"successorNotDelivered": successor_slot is None',
    '"fastLaneAdvanced": 1 <= ledger_delta <= int(EXPECTED_MAX_LEDGERS)',
    '"queuePurged": False',
    '"schedulerMutation": False',
):
    if required not in current_repair_bounded_manager:
        raise SystemExit(f"Current repair bounded-proof manager is missing guard: {required}")
for forbidden in (
    'api("DELETE"',
    'api("PUT"',
    '/purge',
    'wrangler',
    'MAINNET_ENABLED = "true"',
):
    if forbidden in current_repair_bounded_manager:
        raise SystemExit(f"Current repair bounded-proof manager contains forbidden capability: {forbidden}")
if current_repair_bounded_manager.count('f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}/messages"') != 1:
    raise SystemExit("Current repair bounded-proof manager must contain exactly one Queue seed-message endpoint")
'''

text = text.replace(marker, '\n' + block + marker)
path.write_text(text)