from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-current-repair-queue-consumer.py <generated-policy>')

path = Path(sys.argv[1])
text = path.read_text()

old_policy = '    "current-repair-bounded-proof.yml": ["issue_comment"],\n    "deploy-queue-minute-cadence-fix.yml": ["issue_comment"],'
new_policy = '    "current-repair-bounded-proof.yml": ["issue_comment"],\n    "current-repair-queue-consumer.yml": ["issue_comment"],\n    "current-repair-queue-diagnostics.yml": ["issue_comment"],\n    "deploy-queue-minute-cadence-fix.yml": ["issue_comment"],'
if text.count(old_policy) != 1:
    raise SystemExit(f'expected one Current repair policy insertion point, found {text.count(old_policy)}')
text = text.replace(old_policy, new_policy)

old_allowlist = '  current-repair-bounded-proof.yml\n  deploy-queue-minute-cadence-fix.yml'
new_allowlist = '  current-repair-bounded-proof.yml\n  current-repair-queue-consumer.yml\n  current-repair-queue-diagnostics.yml\n  deploy-queue-minute-cadence-fix.yml'
if text.count(old_allowlist) != 1:
    raise SystemExit(f'expected one Current repair allowlist insertion point, found {text.count(old_allowlist)}')
text = text.replace(old_allowlist, new_allowlist)

old_count = 'GitHub Actions workflow count must remain exactly forty-seven while R4F qualification, guarded R5 workflows, and the bounded Current repair proof are active.'
new_count = 'GitHub Actions workflow count must remain exactly forty-nine while R4F qualification, guarded R5 workflows, and the bounded Current repair controls are active.'
if text.count(old_count) != 1:
    raise SystemExit(f'expected one forty-seven-workflow count guard, found {text.count(old_count)}')
text = text.replace(old_count, new_count)

marker = '\nscheduled = []\n'
if text.count(marker) != 1:
    raise SystemExit(f'expected one scheduled policy marker, found {text.count(marker)}')

block = r'''
current_repair_queue_consumer = (root / "current-repair-queue-consumer.yml").read_text()
current_repair_queue_consumer_manager = (root / "../../scripts/current-repair-queue-consumer.py").read_text()
compile(current_repair_queue_consumer_manager, "current-repair-queue-consumer.py", "exec")
for required in (
    "name: Current repair Queue consumer settings",
    "issue_comment:",
    "contents: read",
    "issues: write",
    "actions: read",
    "github.event.issue.number == 995",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/current-repair-queue-consumer-prepare'",
    "startsWith(github.event.comment.body, '/current-repair-queue-consumer-authorize ')",
    "EXPECTED_WORKER_VERSION: 6141a09f-cf99-4098-a75b-145cef1b9e63",
    "python scripts/current-repair-queue-consumer.py --prepare",
    "python scripts/current-repair-queue-consumer.py --execute",
    "AUTHORIZED_STATE_DIGEST",
    "AUTHORIZED_CONSUMER_ID",
    "current-repair-queue-consumer-prepare",
    "current-repair-queue-consumer",
    "changes only the existing Queue consumer retry setting",
):
    if required not in current_repair_queue_consumer:
        raise SystemExit(f"Current repair Queue consumer workflow is missing guarded requirement: {required}")
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
    if forbidden in current_repair_queue_consumer:
        raise SystemExit(f"Current repair Queue consumer workflow contains forbidden capability: {forbidden.strip()}")
if current_repair_queue_consumer.count("issues: write") != 1:
    raise SystemExit("Current repair Queue consumer workflow must have exactly one issue-write permission")

for required in (
    'EXPECTED_OLD_SETTINGS = {',
    '"max_retries": 3',
    '"max_retries": 100',
    '"batch_size": 1',
    '"max_concurrency": 1',
    '"max_wait_time_ms": 1000',
    '"retry_delay": 0',
    '"queuePaused": paused is True',
    '"queueBacklogEmpty": metrics["backlogCount"] == 0 and metrics["backlogBytes"] == 0',
    '"149852ab52d548fea9e6b1d377d28fc1"',
    'EXPECTED_STALE_SLOT_COUNT = int(os.environ.get("EXPECTED_STALE_SLOT_COUNT", "58"))',
    '"pinnedWorkerConsumer": len(consumer_list) == 1',
    '"exactKnownStaleSnapshot": slots["staleReclaimable"] == EXPECTED_STALE_SLOT_COUNT',
    '"staleSnapshotFingerprint": fingerprint',
    '"noLiveUnstagedSlot": slots["liveUnstaged"] == 0',
    '"noStagedSuccessor": slots["stagedSuccessor"] == 0',
    'f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}/consumers/{AUTHORIZED_CONSUMER_ID}"',
    '"type": "worker"',
    '"script_name": SCRIPT_NAME',
    '"consumerUpdatePerformed": False',
    '"queueMessageSent": False',
    '"queuePurged": False',
    '"queueResumed": False',
    '"workerDeploymentMutation": False',
    '"d1Mutation": False',
    '"schedulerMutation": False',
):
    if required not in current_repair_queue_consumer_manager:
        raise SystemExit(f"Current repair Queue consumer manager is missing guard: {required}")
for forbidden in (
    '/messages',
    '/purge',
    'wrangler',
    'MAINNET_ENABLED = "true"',
    '{"settings": {"delivery_paused": False}}',
    'api("DELETE"',
    'api("PATCH"',
):
    if forbidden in current_repair_queue_consumer_manager:
        raise SystemExit(f"Current repair Queue consumer manager contains forbidden capability: {forbidden}")
if current_repair_queue_consumer_manager.count('"PUT",') != 1:
    raise SystemExit("Current repair Queue consumer manager must contain exactly one PUT mutation")

current_repair_queue_diagnostics = (root / "current-repair-queue-diagnostics.yml").read_text()
current_repair_queue_diagnostics_manager = (root / "../../scripts/current-repair-queue-diagnostics.py").read_text()
compile(current_repair_queue_diagnostics_manager, "current-repair-queue-diagnostics.py", "exec")
for required in (
    "name: Current repair Queue blocker diagnostics",
    "issue_comment:",
    "contents: read",
    "issues: write",
    "github.event.issue.number == 995",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/current-repair-queue-diagnostics'",
    "python scripts/current-repair-queue-diagnostics.py",
    "current-repair-queue-diagnostics",
    "This workflow is read-only.",
):
    if required not in current_repair_queue_diagnostics:
        raise SystemExit(f"Current repair Queue diagnostics workflow is missing guarded requirement: {required}")
for forbidden in (
    "  push:",
    "  pull_request:",
    "  schedule:",
    "workflow_dispatch:",
    "pull_request_target",
    "contents: write",
    "wrangler deploy",
    "delete_messages_permanently",
):
    if forbidden in current_repair_queue_diagnostics:
        raise SystemExit(f"Current repair Queue diagnostics workflow contains forbidden capability: {forbidden.strip()}")
if current_repair_queue_diagnostics.count("issues: write") != 1:
    raise SystemExit("Current repair Queue diagnostics workflow must have exactly one issue-write permission")
for required in (
    '"mode": "read-only-diagnostics"',
    '"productionMutation": False',
    'f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}/consumers/{consumer_id}"',
    'PRAGMA table_info(fast_lane_queue_slots)',
    'QUEUE_LEASE_SECONDS = 15 * 60',
    'oldestStaleSample',
    'newestStaleSample',
    'LIMIT 5',
):
    if required not in current_repair_queue_diagnostics_manager:
        raise SystemExit(f"Current repair Queue diagnostics manager is missing read-only guard: {required}")
for forbidden in (
    'api("PUT"',
    'api("DELETE"',
    'api("PATCH"',
    '/messages',
    '/purge',
    'wrangler',
    'INSERT ',
    'UPDATE ',
    'DELETE ',
    'DROP ',
    'ALTER ',
    'CREATE ',
):
    if forbidden in current_repair_queue_diagnostics_manager:
        raise SystemExit(f"Current repair Queue diagnostics manager contains forbidden mutation capability: {forbidden}")
'''

text = text.replace(marker, '\n' + block + marker)
path.write_text(text)