#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request
from typing import Any

EVIDENCE = Path(os.environ.get("CURRENT_REPAIR_DEPLOY_OUTPUT", "current-repair-deploy-evidence"))
EVIDENCE.mkdir(exist_ok=True)
EXPECTED_RUNTIME_SHA = "4f3f185da6e5093d0a5ce13b43b22f3070e630b3"
EXPECTED_ENTRY = "src/worker/p0-redundant-scheduler-entry.ts"
EXPECTED_QUEUE_NAME = "xrpl-lending-fast-lane"
EXPECTED_MAX_LEDGERS = "32"
MAX_DATABASE_BYTES = 350_000_000


def save(name: str, value: Any) -> Any:
    (EVIDENCE / name).write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return value


def validate_source(runtime_sha: str) -> dict[str, Any]:
    if runtime_sha != EXPECTED_RUNTIME_SHA:
        raise RuntimeError(f"unexpected runtime SHA: {runtime_sha}")
    subprocess.run(["git", "cat-file", "-e", f"{runtime_sha}^{{commit}}"], check=True)
    subprocess.run(
        [
            "git", "diff", "--quiet", runtime_sha, "--",
            "src", "wrangler.jsonc", "package.json", "pnpm-lock.yaml",
        ],
        check=True,
    )
    config = json.loads(Path("wrangler.jsonc").read_text(encoding="utf-8"))
    consumers = config.get("queues", {}).get("consumers", [])
    producers = config.get("queues", {}).get("producers", [])
    retry_source = Path("src/worker/fast-lane-transient-retry.ts").read_text(encoding="utf-8")
    fallback_source = Path("src/collector/incremental/fast-lane-resilient-ledger-reader.ts").read_text(encoding="utf-8")
    persistence_source = Path("src/worker/repositories/fast-lane-compact-shadow-repository.ts").read_text(encoding="utf-8")
    checks = {
        "runtimePinned": runtime_sha == EXPECTED_RUNTIME_SHA,
        "entryExact": config.get("main") == EXPECTED_ENTRY,
        "cronEmpty": config.get("triggers", {}).get("crons") == [],
        "devnetOnly": config.get("vars", {}).get("APP_NETWORK") == "devnet",
        "mainnetDisabled": config.get("vars", {}).get("MAINNET_ENABLED") == "false",
        "maxLedgers32": config.get("vars", {}).get("FAST_LANE_MAX_LEDGERS_PER_RUN") == EXPECTED_MAX_LEDGERS,
        "oneProducer": producers == [{"binding": "FAST_LANE_QUEUE", "queue": EXPECTED_QUEUE_NAME}],
        "oneConsumer": len(consumers) == 1 and consumers[0].get("queue") == EXPECTED_QUEUE_NAME,
        "batchOne": len(consumers) == 1 and consumers[0].get("max_batch_size") == 1,
        "concurrencyOne": len(consumers) == 1 and consumers[0].get("max_concurrency") == 1,
        "sameInvocationRetryOne": "const DEFAULT_MAX_ATTEMPTS = 1" in retry_source,
        "fallbackBudgetFour": "FAST_LANE_HTTP_FALLBACK_REQUEST_LIMIT = 4" in fallback_source,
        "persistenceBudget24": "FAST_LANE_MAX_PERSISTENCE_D1_QUERIES = 24" in persistence_source,
        "groupedMutation256": "MUTATIONS_PER_D1_QUERY = 256" in persistence_source,
        "groupedHistoryEight": "HISTORY_WINDOWS_PER_D1_QUERY = 8" in persistence_source,
    }
    if not all(checks.values()):
        raise RuntimeError(f"source validation failed: {checks}")
    return checks


if "--validate-source-only" in sys.argv:
    runtime_sha = os.environ.get("RUNTIME_SHA", EXPECTED_RUNTIME_SHA)
    save("source-validation.json", validate_source(runtime_sha))
    print(json.dumps({"validated": True, "runtimeSha": runtime_sha}, sort_keys=True))
    raise SystemExit(0)

ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
SCRIPT_NAME = os.environ.get("SCRIPT_NAME", "xrpl-lending-monitor")
QUEUE_ID = os.environ.get("QUEUE_ID", "")
DATABASE_ID = os.environ.get("DATABASE_ID", "")
PRODUCTION_BASE = os.environ.get("PRODUCTION_BASE", "https://xrpl-lending-monitor.badjoke-lab.workers.dev")
RUNTIME_SHA = os.environ.get("RUNTIME_SHA", "")
AUTHORIZATION = os.environ.get("CURRENT_REPAIR_DEPLOY_AUTHORIZATION", "")
EXPECTED_AUTHORIZATION = f"deploy-current-repair-only:{EXPECTED_RUNTIME_SHA}"
API_BASE = "https://api.cloudflare.com/client/v4"

if not all((ACCOUNT_ID, API_TOKEN, QUEUE_ID, DATABASE_ID, RUNTIME_SHA)):
    raise SystemExit("Cloudflare deploy credentials and exact runtime identity are required")
if AUTHORIZATION != EXPECTED_AUTHORIZATION:
    raise SystemExit("exact Current repair deploy authorization is required")

HEADERS = {"Authorization": f"Bearer {API_TOKEN}", "Content-Type": "application/json"}


def api(method: str, path: str, body: Any | None = None) -> dict[str, Any]:
    data = None if body is None else json.dumps(body, separators=(",", ":")).encode()
    request = urllib.request.Request(API_BASE + path, data=data, headers=HEADERS, method=method)
    with urllib.request.urlopen(request, timeout=60) as response:
        result = json.load(response)
    if result.get("success") is not True:
        raise RuntimeError(result.get("errors"))
    return result


def queue_state() -> dict[str, Any]:
    return api("GET", f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}")["result"]


def queue_metrics() -> dict[str, int]:
    result = api("GET", f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}/metrics")["result"]
    return {
        "backlog_count": int(result.get("backlog_count") or 0),
        "backlog_bytes": int(result.get("backlog_bytes") or 0),
        "oldest_message_timestamp_ms": int(result.get("oldest_message_timestamp_ms") or 0),
    }


def schedules() -> list[dict[str, Any]]:
    return api("GET", f"/accounts/{ACCOUNT_ID}/workers/scripts/{SCRIPT_NAME}/schedules")["result"]["schedules"]


def deployments() -> list[dict[str, Any]]:
    return api("GET", f"/accounts/{ACCOUNT_ID}/workers/scripts/{SCRIPT_NAME}/deployments")["result"]["deployments"]


def worker_settings() -> dict[str, Any]:
    return api("GET", f"/accounts/{ACCOUNT_ID}/workers/scripts/{SCRIPT_NAME}/settings")["result"]


def database_size() -> int:
    result = api("GET", f"/accounts/{ACCOUNT_ID}/d1/database/{DATABASE_ID}")["result"]
    return int(result.get("file_size") or 0)


def binding_value(bindings: list[dict[str, Any]], name: str) -> Any:
    for item in bindings:
        if item.get("name") == name:
            return item.get("text", item.get("value"))
    return None


def parse_version_id(output: str) -> str:
    match = re.search(r"(?:Worker Version ID|Version ID)\s*[:=]\s*([0-9a-f-]{36})", output, flags=re.IGNORECASE)
    if match:
        return match.group(1)
    ids = re.findall(r"[0-9a-f]{8}-[0-9a-f-]{27,}", output, flags=re.IGNORECASE)
    if not ids:
        raise RuntimeError("could not identify uploaded Worker version")
    return ids[-1]


def wait_for_version(version_id: str, attempts: int = 60) -> dict[str, Any]:
    latest: dict[str, Any] = {}
    for _ in range(attempts):
        latest = deployments()[0]
        versions = latest.get("versions", [])
        if len(versions) == 1 and versions[0].get("version_id") == version_id and versions[0].get("percentage") == 100:
            return latest
        time.sleep(2)
    raise RuntimeError(f"version did not become 100%: {version_id}; latest={latest}")


def public_smoke() -> dict[str, int]:
    statuses: dict[str, int] = {}
    for path in ("/api/overview", "/api/status/history-source", "/api/status/fast-lane-diff?limit=1"):
        with urllib.request.urlopen(PRODUCTION_BASE + path, timeout=45) as response:
            statuses[path] = response.status
    if any(status != 200 for status in statuses.values()):
        raise RuntimeError(f"public smoke failed: {statuses}")
    return statuses


def assert_runtime_still_stopped(stage: str) -> dict[str, Any]:
    queue = queue_state()
    metrics = queue_metrics()
    cron = schedules()
    if queue.get("settings", {}).get("delivery_paused") is not True:
        raise RuntimeError(f"{stage}: Queue must already be paused")
    if cron != []:
        raise RuntimeError(f"{stage}: Cron schedules must remain empty")
    return {"queue": queue, "metrics": metrics, "schedules": cron}


source_checks = save("source-validation.json", validate_source(RUNTIME_SHA))
pre_stop = assert_runtime_still_stopped("pre-deploy")
size_before = database_size()
if not 0 < size_before < MAX_DATABASE_BYTES:
    raise RuntimeError(f"D1 size outside deploy-only guard: {size_before}")
old_deployment = deployments()[0]
old_versions = old_deployment.get("versions", [])
if len(old_versions) != 1 or old_versions[0].get("percentage") != 100:
    raise RuntimeError("pre-deploy Worker must have one 100% version")
old_version = old_versions[0]["version_id"]
pre_settings = worker_settings()
save("pre-deploy.json", {
    "sourceChecks": source_checks,
    "stoppedState": pre_stop,
    "databaseSize": size_before,
    "deployment": old_deployment,
    "settings": pre_settings,
})

new_version: str | None = None
deployed = False
rolled_back = False
result: dict[str, Any] = {
    "passed": False,
    "runtimeSha": RUNTIME_SHA,
    "productionMutation": "worker_version_deploy_only",
    "queueMessageSent": False,
    "queueResumed": False,
    "queuePurged": False,
    "cronChanged": False,
    "d1Mutation": False,
    "oldVersionId": old_version,
    "newVersionId": None,
    "rollback": False,
    "failure": None,
}

try:
    subprocess.run(["pnpm", "build:deploy-assets"], check=True)
    upload = subprocess.run(
        ["pnpm", "exec", "wrangler", "versions", "upload", "--message", f"Current repair deploy-only {RUNTIME_SHA}"],
        text=True,
        capture_output=True,
        check=True,
    )
    upload_output = upload.stdout + upload.stderr
    (EVIDENCE / "version-upload.txt").write_text(upload_output, encoding="utf-8")
    new_version = parse_version_id(upload_output)
    result["newVersionId"] = new_version

    deploy = subprocess.run(
        ["pnpm", "exec", "wrangler", "versions", "deploy", f"{new_version}@100%", "--yes"],
        text=True,
        capture_output=True,
        check=True,
    )
    (EVIDENCE / "version-deploy.txt").write_text(deploy.stdout + deploy.stderr, encoding="utf-8")
    deployed = True
    active = wait_for_version(new_version)

    post_stop = assert_runtime_still_stopped("post-deploy")
    settings = worker_settings()
    bindings = settings.get("bindings", [])
    size_after = database_size()
    checks = {
        "queueStillPaused": post_stop["queue"].get("settings", {}).get("delivery_paused") is True,
        "cronStillEmpty": post_stop["schedules"] == [],
        "queueBacklogUnchanged": post_stop["metrics"] == pre_stop["metrics"],
        "databaseSizeUnchanged": size_after == size_before,
        "devnetOnly": binding_value(bindings, "APP_NETWORK") == "devnet",
        "mainnetDisabled": binding_value(bindings, "MAINNET_ENABLED") == "false",
        "maxLedgers32": binding_value(bindings, "FAST_LANE_MAX_LEDGERS_PER_RUN") == EXPECTED_MAX_LEDGERS,
        "queueBindingPresent": len([item for item in bindings if item.get("name") == "FAST_LANE_QUEUE" and item.get("type") == "queue"]) == 1,
    }
    if not all(checks.values()):
        raise RuntimeError(f"post-deploy invariant failed: {checks}")
    result.update({
        "passed": True,
        "checks": checks,
        "deployment": active,
        "stoppedState": post_stop,
        "databaseSizeBefore": size_before,
        "databaseSizeAfter": size_after,
        "publicSmoke": public_smoke(),
    })
except Exception as exc:  # noqa: BLE001
    result["failure"] = repr(exc)
    if deployed:
        try:
            rollback = subprocess.run(
                ["pnpm", "exec", "wrangler", "versions", "deploy", f"{old_version}@100%", "--yes"],
                text=True,
                capture_output=True,
                check=True,
            )
            (EVIDENCE / "rollback-deploy.txt").write_text(rollback.stdout + rollback.stderr, encoding="utf-8")
            wait_for_version(old_version)
            assert_runtime_still_stopped("rollback")
            rolled_back = True
        except Exception as rollback_exc:  # noqa: BLE001
            result["rollbackFailure"] = repr(rollback_exc)
finally:
    result["rollback"] = rolled_back
    save("result.json", result)

print(json.dumps({
    "passed": result["passed"],
    "runtimeSha": result["runtimeSha"],
    "newVersionId": result["newVersionId"],
    "queueMessageSent": result["queueMessageSent"],
    "queueResumed": result["queueResumed"],
    "cronChanged": result["cronChanged"],
    "d1Mutation": result["d1Mutation"],
    "rollback": result["rollback"],
}, sort_keys=True))
raise SystemExit(0 if result["passed"] else 1)
