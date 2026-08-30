#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import math
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
QUEUE_ID = os.environ.get("QUEUE_ID", "")
DATABASE_ID = os.environ.get("DATABASE_ID", "")
SCRIPT_NAME = os.environ.get("SCRIPT_NAME", "xrpl-lending-monitor")
REPAIRED_VERSION_ID = os.environ.get("REPAIRED_VERSION_ID", "c858ab5d-846e-4bd4-b26b-8f71c9382f8f")
PRODUCTION_BASE = os.environ.get("PRODUCTION_BASE", "https://xrpl-lending-monitor.badjoke-lab.workers.dev")
OUT = Path(os.environ.get("CURRENT_REPAIR_BOUNDED_PROOF_OUTPUT", "current-repair-bounded-proof-evidence"))
OUT.mkdir(parents=True, exist_ok=True)
API_BASE = "https://api.cloudflare.com/client/v4"
EXPECTED_MAX_LEDGERS = "32"
PROOF_CRON = "queue-bounded-current-repair-proof"
MIN_LEAD_SECONDS = 30
TARGET_LEAD_SECONDS = 120
SLOT_START_TIMEOUT_SECONDS = 180
SLOT_TERMINAL_TIMEOUT_SECONDS = 240

if not all((ACCOUNT_ID, API_TOKEN, QUEUE_ID, DATABASE_ID)):
    raise SystemExit("Cloudflare credentials, Queue identity, and D1 identity are required")

HEADERS = {
    "Authorization": f"Bearer {API_TOKEN}",
    "Content-Type": "application/json",
}
PUBLIC_HEADERS = {
    "User-Agent": "curl/8.5.0",
    "Accept": "application/json",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def save(name: str, value: Any) -> Any:
    (OUT / name).write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return value


def api(method: str, path: str, body: Any | None = None) -> dict[str, Any]:
    data = None if body is None else json.dumps(body, separators=(",", ":")).encode()
    last_error: Exception | None = None
    for attempt in range(5):
        request = urllib.request.Request(API_BASE + path, data=data, headers=HEADERS, method=method)
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                payload = json.load(response)
            if payload.get("success") is not True:
                raise RuntimeError(payload.get("errors"))
            return payload
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt == 4:
                raise
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(last_error)


def public_status(path: str) -> int:
    request = urllib.request.Request(PRODUCTION_BASE + path, headers=PUBLIC_HEADERS, method="GET")
    with urllib.request.urlopen(request, timeout=45) as response:
        return response.status


def d1_query(sql: str) -> list[dict[str, Any]]:
    payload = api(
        "POST",
        f"/accounts/{ACCOUNT_ID}/d1/database/{DATABASE_ID}/query",
        {"sql": sql},
    )
    result = (payload.get("result") or [{}])[0]
    if result.get("success") is not True:
        raise RuntimeError("D1 read failed")
    return result.get("results") or []


def one(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return rows[0] if rows else {}


def queue_state() -> dict[str, Any]:
    return api("GET", f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}")["result"]


def queue_metrics() -> dict[str, int]:
    result = api("GET", f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}/metrics")["result"]
    return {
        "backlogCount": int(result.get("backlog_count") or 0),
        "backlogBytes": int(result.get("backlog_bytes") or 0),
        "oldestMessageTimestampMs": int(result.get("oldest_message_timestamp_ms") or 0),
    }


def queue_paused(state: dict[str, Any]) -> bool | None:
    settings = state.get("settings")
    if not isinstance(settings, dict):
        return None
    value = settings.get("delivery_paused")
    return value if isinstance(value, bool) else None


def set_queue_paused(paused: bool) -> dict[str, Any]:
    payload = api(
        "PATCH",
        f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}",
        {"settings": {"delivery_paused": paused}},
    )
    state = payload.get("result") or {}
    if queue_paused(state) is not paused:
        raise RuntimeError(f"Queue update response did not report delivery_paused={paused}")
    for _ in range(30):
        observed = queue_state()
        if queue_paused(observed) is paused:
            return observed
        time.sleep(1)
    raise RuntimeError(f"Queue delivery_paused={paused} was not independently observed")


def schedules() -> list[dict[str, Any]]:
    return api("GET", f"/accounts/{ACCOUNT_ID}/workers/scripts/{SCRIPT_NAME}/schedules")["result"]["schedules"]


def deployments() -> list[dict[str, Any]]:
    return api("GET", f"/accounts/{ACCOUNT_ID}/workers/scripts/{SCRIPT_NAME}/deployments")["result"]["deployments"]


def worker_settings() -> dict[str, Any]:
    return api("GET", f"/accounts/{ACCOUNT_ID}/workers/scripts/{SCRIPT_NAME}/settings")["result"]


def database_size() -> int:
    return int(api("GET", f"/accounts/{ACCOUNT_ID}/d1/database/{DATABASE_ID}")["result"].get("file_size") or 0)


def binding_value(bindings: list[dict[str, Any]], name: str) -> Any:
    for item in bindings:
        if item.get("name") == name:
            return item.get("text", item.get("value"))
    return None


def slot_summary() -> dict[str, Any]:
    counts = d1_query("SELECT status,COUNT(*) AS row_count FROM fast_lane_queue_slots GROUP BY status ORDER BY status")
    summary = one(d1_query(
        "SELECT "
        "COALESCE(SUM(CASE WHEN status='processing' AND next_scheduled_time IS NULL AND unixepoch(updated_at) > unixepoch('now')-900 THEN 1 ELSE 0 END),0) AS live_unstaged, "
        "COALESCE(SUM(CASE WHEN status='processing' AND next_scheduled_time IS NULL AND unixepoch(updated_at) <= unixepoch('now')-900 THEN 1 ELSE 0 END),0) AS stale_reclaimable, "
        "COALESCE(SUM(CASE WHEN status='processing' AND next_scheduled_time IS NOT NULL THEN 1 ELSE 0 END),0) AS staged_successor "
        "FROM fast_lane_queue_slots"
    ))
    status_counts = {str(row.get("status")): int(row.get("row_count", 0)) for row in counts}
    return {
        "statusCounts": status_counts,
        "pending": status_counts.get("pending", 0),
        "liveUnstaged": int(summary.get("live_unstaged", -1)),
        "staleReclaimable": int(summary.get("stale_reclaimable", -1)),
        "stagedSuccessor": int(summary.get("staged_successor", -1)),
    }


def fast_state() -> dict[str, Any]:
    return one(d1_query(
        "SELECT epoch_id,last_processed_ledger,last_processed_hash,latest_observed_ledger,latest_observed_hash,status,updated_at "
        "FROM fast_lane_shadow_state WHERE network='devnet'"
    ))


def latest_metric() -> dict[str, Any]:
    return one(d1_query(
        "SELECT run_at,status,start_ledger_index,end_ledger_index,latest_observed_ledger,lag_ledgers,ledgers_processed,error_message "
        "FROM fast_lane_shadow_run_metrics WHERE network='devnet' ORDER BY run_at DESC LIMIT 1"
    ))


def read_slot(scheduled_time: int) -> dict[str, Any] | None:
    rows = d1_query(
        "SELECT scheduled_time,status,message_id,started_at,completed_at,next_scheduled_time,next_cron,error_message,updated_at "
        f"FROM fast_lane_queue_slots WHERE scheduled_time={scheduled_time} LIMIT 1"
    )
    return rows[0] if rows else None


def current_deployment_version() -> tuple[str | None, dict[str, Any]]:
    deployment_list = deployments()
    latest = deployment_list[0] if deployment_list else {}
    versions = latest.get("versions") or []
    if len(versions) != 1 or versions[0].get("percentage") != 100:
        return None, latest
    return versions[0].get("version_id"), latest


def capture() -> dict[str, Any]:
    queue = queue_state()
    metrics = queue_metrics()
    cron = schedules()
    version, deployment = current_deployment_version()
    settings = worker_settings()
    bindings = settings.get("bindings") or []
    slots = slot_summary()
    fast = fast_state()
    metric = latest_metric()
    paused = queue_paused(queue)
    public = {
        "/api/overview": public_status("/api/overview"),
        "/api/status/history-source": public_status("/api/status/history-source"),
        "/api/status/fast-lane-diff?limit=1": public_status("/api/status/fast-lane-diff?limit=1"),
    }
    checks = {
        "queuePaused": paused is True,
        "queueBacklogEmpty": metrics["backlogCount"] == 0 and metrics["backlogBytes"] == 0,
        "schedulerDisabled": cron == [],
        "repairedVersionActive": version == REPAIRED_VERSION_ID,
        "devnetOnly": binding_value(bindings, "APP_NETWORK") == "devnet" and binding_value(bindings, "MAINNET_ENABLED") == "false",
        "maxLedgers32": binding_value(bindings, "FAST_LANE_MAX_LEDGERS_PER_RUN") == EXPECTED_MAX_LEDGERS,
        "singleQueueBinding": len([item for item in bindings if item.get("name") == "FAST_LANE_QUEUE" and item.get("type") == "queue"]) == 1,
        "noPendingSlot": slots["pending"] == 0,
        "noLiveUnstagedSlot": slots["liveUnstaged"] == 0,
        "noStagedSuccessorSlot": slots["stagedSuccessor"] == 0,
        "publicSmoke": all(status == 200 for status in public.values()),
    }
    state = {
        "queue": {"deliveryPaused": paused, "metrics": metrics},
        "schedules": cron,
        "deployment": deployment,
        "deploymentVersion": version,
        "appNetwork": binding_value(bindings, "APP_NETWORK"),
        "mainnetEnabled": binding_value(bindings, "MAINNET_ENABLED"),
        "maxLedgersPerRun": binding_value(bindings, "FAST_LANE_MAX_LEDGERS_PER_RUN"),
        "slots": slots,
        "fastLane": fast,
        "latestMetric": metric,
        "databaseSize": database_size(),
        "public": public,
    }
    digest = hashlib.sha256(json.dumps(state, separators=(",", ":"), sort_keys=True).encode()).hexdigest()
    return {
        "safeToRunBoundedProof": all(checks.values()),
        "checks": checks,
        "failures": [name for name, passed in checks.items() if not passed],
        "stateDigest": digest,
        "state": state,
    }


def next_target_scheduled_time() -> int:
    now_ms = int(time.time() * 1000)
    return math.ceil((now_ms + TARGET_LEAD_SECONDS * 1000) / 60_000) * 60_000


def do_prepare() -> int:
    pre = capture()
    target = next_target_scheduled_time()
    if read_slot(target) is not None:
        pre["safeToRunBoundedProof"] = False
        pre["failures"].append("targetSlotAlreadyExists")
    result = {
        "schemaVersion": 1,
        "mode": "prepare",
        "productionMutation": False,
        "targetScheduledTime": target,
        **pre,
    }
    save("result.json", result)
    print(json.dumps({
        "safeToRunBoundedProof": result["safeToRunBoundedProof"],
        "failures": result["failures"],
        "stateDigest": result["stateDigest"],
        "targetScheduledTime": target,
        "deploymentVersion": result["state"]["deploymentVersion"],
    }, sort_keys=True))
    return 0 if result["safeToRunBoundedProof"] else 1


def do_execute() -> int:
    authorized_state = os.environ.get("AUTHORIZED_STATE_DIGEST", "")
    authorized_target = int(os.environ.get("AUTHORIZED_TARGET_SCHEDULED_TIME", "0"))
    result: dict[str, Any] = {
        "schemaVersion": 1,
        "mode": "execute",
        "passed": False,
        "productionMutation": False,
        "seedMessageSent": False,
        "queueResumed": False,
        "queueRepaused": False,
        "d1MutationExpectedFromSingleWorkerInvocation": False,
        "schedulerMutation": False,
        "queuePurged": False,
        "targetScheduledTime": authorized_target,
        "failure": None,
    }
    pre: dict[str, Any] | None = None
    terminal_slot: dict[str, Any] | None = None
    pause_trigger_status: str | None = None
    try:
        if not authorized_state or authorized_target <= 0:
            raise RuntimeError("exact bounded-proof authorization inputs are required")
        pre = capture()
        save("pre-state.json", pre)
        if not pre["safeToRunBoundedProof"]:
            raise RuntimeError(f"bounded proof pre-state is unsafe: {pre['failures']}")
        if pre["stateDigest"] != authorized_state:
            raise RuntimeError("bounded proof state digest changed after authorization")
        if read_slot(authorized_target) is not None:
            raise RuntimeError("authorized target Queue slot already exists")
        now_ms = int(time.time() * 1000)
        if authorized_target - now_ms < MIN_LEAD_SECONDS * 1000:
            raise RuntimeError("authorized target no longer has enough lead time")

        delay_seconds = max(0, math.ceil((authorized_target - now_ms) / 1000))
        message = {
            "scheduledTime": authorized_target,
            "cron": PROOF_CRON,
            "enqueuedAt": now_iso(),
        }
        push = api(
            "POST",
            f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}/messages",
            {"body": message, "content_type": "json", "delay_seconds": delay_seconds},
        )
        result["productionMutation"] = True
        result["seedMessageSent"] = True
        result["seedDelaySeconds"] = delay_seconds
        result["seedResponse"] = push.get("result")
        save("seed-message.json", {"message": message, "delaySeconds": delay_seconds, "response": push})

        if queue_paused(queue_state()) is not True:
            raise RuntimeError("Queue unexpectedly unpaused before bounded delivery")

        set_queue_paused(False)
        result["queueResumed"] = True

        start_deadline = time.time() + SLOT_START_TIMEOUT_SECONDS
        while time.time() < start_deadline:
            slot = read_slot(authorized_target)
            if slot and slot.get("status") in {"processing", "completed", "error"}:
                pause_trigger_status = str(slot.get("status"))
                set_queue_paused(True)
                result["queueRepaused"] = True
                break
            time.sleep(0.5)
        if not result["queueRepaused"]:
            raise RuntimeError("authorized Queue slot did not start before timeout")

        terminal_deadline = time.time() + SLOT_TERMINAL_TIMEOUT_SECONDS
        while time.time() < terminal_deadline:
            slot = read_slot(authorized_target)
            if slot and slot.get("status") in {"completed", "error"}:
                terminal_slot = slot
                break
            time.sleep(1)
        if terminal_slot is None:
            raise RuntimeError("authorized Queue slot did not reach terminal state")
        save("terminal-slot.json", terminal_slot)
        if terminal_slot.get("status") != "completed" or terminal_slot.get("error_message") is not None:
            raise RuntimeError(f"bounded proof Queue slot failed: {terminal_slot}")

        after_fast = fast_state()
        after_metric = latest_metric()
        next_scheduled_time = int(terminal_slot.get("next_scheduled_time") or 0)
        successor_slot = read_slot(next_scheduled_time) if next_scheduled_time > 0 else None
        post_queue = queue_state()
        post_metrics = queue_metrics()
        post_cron = schedules()
        post_version, post_deployment = current_deployment_version()
        pre_ledger = int(pre["state"]["fastLane"].get("last_processed_ledger") or 0)
        post_ledger = int(after_fast.get("last_processed_ledger") or 0)
        ledger_delta = post_ledger - pre_ledger
        post_checks = {
            "queuePausedAgain": queue_paused(post_queue) is True,
            "schedulerStillDisabled": post_cron == [],
            "repairedVersionUnchanged": post_version == REPAIRED_VERSION_ID,
            "targetSlotCompleted": terminal_slot.get("status") == "completed" and terminal_slot.get("error_message") is None,
            "successorWasStaged": next_scheduled_time > authorized_target and bool(terminal_slot.get("next_cron")),
            "successorNotDelivered": successor_slot is None,
            "fastLaneAdvanced": 1 <= ledger_delta <= int(EXPECTED_MAX_LEDGERS),
            "latestMetricCommitted": after_metric.get("status") == "committed" and after_metric.get("error_message") is None,
            "publicOverviewReachable": public_status("/api/overview") == 200,
        }
        if not all(post_checks.values()):
            raise RuntimeError(f"bounded proof post-check failed: {post_checks}")
        result.update({
            "passed": True,
            "d1MutationExpectedFromSingleWorkerInvocation": True,
            "pauseTriggerStatus": pause_trigger_status,
            "preFastLedger": pre_ledger,
            "postFastLedger": post_ledger,
            "ledgerDelta": ledger_delta,
            "terminalSlot": terminal_slot,
            "successorSlotObserved": successor_slot,
            "latestMetric": after_metric,
            "postQueueMetrics": post_metrics,
            "postDeployment": post_deployment,
            "postChecks": post_checks,
        })
    except Exception as exc:  # noqa: BLE001
        result["failure"] = repr(exc)
    finally:
        try:
            if queue_paused(queue_state()) is not True:
                set_queue_paused(True)
            result["queueRepaused"] = queue_paused(queue_state()) is True
        except Exception as pause_exc:  # noqa: BLE001
            result["finalPauseFailure"] = repr(pause_exc)
            result["queueRepaused"] = False
            result["passed"] = False
        try:
            result["finalQueueMetrics"] = queue_metrics()
            result["finalSchedules"] = schedules()
            result["finalSlot"] = read_slot(authorized_target) if authorized_target > 0 else None
            result["finalFastLane"] = fast_state()
        except Exception as final_exc:  # noqa: BLE001
            result["finalReadFailure"] = repr(final_exc)
        save("result.json", result)
        print(json.dumps({
            "passed": result["passed"],
            "seedMessageSent": result["seedMessageSent"],
            "queueResumed": result["queueResumed"],
            "queueRepaused": result["queueRepaused"],
            "ledgerDelta": result.get("ledgerDelta"),
            "failure": result["failure"],
        }, sort_keys=True))
    return 0 if result["passed"] else 1


if "--prepare" in sys.argv:
    raise SystemExit(do_prepare())
if "--execute" in sys.argv:
    raise SystemExit(do_execute())
raise SystemExit("use --prepare or --execute")
