#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
QUEUE_ID = os.environ.get("QUEUE_ID", "")
DATABASE_ID = os.environ.get("DATABASE_ID", "")
SCRIPT_NAME = os.environ.get("SCRIPT_NAME", "xrpl-lending-monitor")
AUTHORIZED_STATE = os.environ.get("CURRENT_REPAIR_QUEUE_PAUSE_AUTHORIZED_STATE", "")
OUT = Path(os.environ.get("CURRENT_REPAIR_QUEUE_PAUSE_OUTPUT", "current-repair-queue-pause-evidence"))
OUT.mkdir(parents=True, exist_ok=True)
API_BASE = "https://api.cloudflare.com/client/v4"
HEADERS = {
    "Authorization": f"Bearer {API_TOKEN}",
    "Content-Type": "application/json",
}
QUEUE_LEASE_SECONDS = 15 * 60

if not all((ACCOUNT_ID, API_TOKEN, QUEUE_ID, DATABASE_ID)):
    raise SystemExit("Cloudflare credentials, Queue identity, and D1 identity are required")


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


def schedules() -> list[dict[str, Any]]:
    return api("GET", f"/accounts/{ACCOUNT_ID}/workers/scripts/{SCRIPT_NAME}/schedules")["result"]["schedules"]


def deployments() -> list[dict[str, Any]]:
    return api("GET", f"/accounts/{ACCOUNT_ID}/workers/scripts/{SCRIPT_NAME}/deployments")["result"]["deployments"]


def worker_settings() -> dict[str, Any]:
    return api("GET", f"/accounts/{ACCOUNT_ID}/workers/scripts/{SCRIPT_NAME}/settings")["result"]


def binding_value(bindings: list[dict[str, Any]], name: str) -> Any:
    for item in bindings:
        if item.get("name") == name:
            return item.get("text", item.get("value"))
    return None


def slot_state() -> dict[str, Any]:
    counts = d1_query(
        "SELECT status,COUNT(*) AS row_count FROM fast_lane_queue_slots GROUP BY status ORDER BY status"
    )
    summary = one(
        d1_query(
            "SELECT "
            "COALESCE(SUM(CASE WHEN status='processing' AND next_scheduled_time IS NULL "
            f"AND unixepoch(updated_at) > unixepoch('now')-{QUEUE_LEASE_SECONDS} THEN 1 ELSE 0 END),0) AS live_unstaged, "
            "COALESCE(SUM(CASE WHEN status='processing' AND next_scheduled_time IS NULL "
            f"AND unixepoch(updated_at) <= unixepoch('now')-{QUEUE_LEASE_SECONDS} THEN 1 ELSE 0 END),0) AS stale_reclaimable, "
            "COALESCE(SUM(CASE WHEN status='processing' AND next_scheduled_time IS NOT NULL THEN 1 ELSE 0 END),0) AS staged_successor "
            "FROM fast_lane_queue_slots"
        )
    )
    status_counts = {str(row.get("status")): int(row.get("row_count", 0)) for row in counts}
    return {
        "statusCounts": status_counts,
        "pending": status_counts.get("pending", 0),
        "liveUnstaged": int(summary.get("live_unstaged", -1)),
        "staleReclaimable": int(summary.get("stale_reclaimable", -1)),
        "stagedSuccessor": int(summary.get("staged_successor", -1)),
        "leaseSeconds": QUEUE_LEASE_SECONDS,
    }


def capture() -> dict[str, Any]:
    queue = queue_state()
    metrics = queue_metrics()
    cron = schedules()
    deployment_list = deployments()
    latest = deployment_list[0] if deployment_list else {}
    versions = latest.get("versions") or []
    settings = worker_settings()
    bindings = settings.get("bindings") or []
    slots = slot_state()
    paused = queue_paused(queue)

    checks = {
        "queueStateKnown": paused is not None,
        "queueCurrentlyActive": paused is False,
        "queueBacklogEmpty": metrics["backlogCount"] == 0 and metrics["backlogBytes"] == 0,
        "schedulerStillDisabled": cron == [],
        "singleDeploymentVersion": len(versions) == 1 and versions[0].get("percentage") == 100,
        "devnetOnly": binding_value(bindings, "APP_NETWORK") == "devnet" and binding_value(bindings, "MAINNET_ENABLED") == "false",
        "currentMaxLedgersBound": binding_value(bindings, "FAST_LANE_MAX_LEDGERS_PER_RUN") == "32",
        "noPendingQueueSlot": slots["pending"] == 0,
        "noLiveUnstagedProcessingSlot": slots["liveUnstaged"] == 0,
        "noStagedSuccessorSlot": slots["stagedSuccessor"] == 0,
    }
    authorization_state = {
        "queue": {
            "id": QUEUE_ID,
            "name": queue.get("queue_name"),
            "deliveryPaused": paused,
            "metrics": metrics,
        },
        "schedules": cron,
        "deploymentVersion": versions[0].get("version_id") if len(versions) == 1 else None,
        "appNetwork": binding_value(bindings, "APP_NETWORK"),
        "mainnetEnabled": binding_value(bindings, "MAINNET_ENABLED"),
        "maxLedgersPerRun": binding_value(bindings, "FAST_LANE_MAX_LEDGERS_PER_RUN"),
        "slots": slots,
    }
    digest = hashlib.sha256(
        json.dumps(authorization_state, separators=(",", ":"), sort_keys=True).encode()
    ).hexdigest()
    return {
        "safeToPause": all(checks.values()),
        "checks": checks,
        "failures": [name for name, passed in checks.items() if not passed],
        "stateDigest": digest,
        "state": authorization_state,
    }


def wait_for_paused(attempts: int = 30) -> None:
    for _ in range(attempts):
        state = queue_state()
        if queue_paused(state) is True:
            return
        time.sleep(1)
    raise RuntimeError(f"Queue delivery did not become paused: {queue_state()}")


def do_prepare() -> int:
    pre = capture()
    result = {
        "schemaVersion": 1,
        "mode": "prepare",
        "productionMutation": False,
        **pre,
    }
    save("result.json", result)
    print(json.dumps({"safeToPause": result["safeToPause"], "failures": result["failures"], "stateDigest": result["stateDigest"]}, sort_keys=True))
    return 0 if result["safeToPause"] else 1


def do_execute() -> int:
    if not re.fullmatch(r"[0-9a-f]{64}", AUTHORIZED_STATE):
        raise SystemExit("exact authorized Queue-pause state digest is required")

    result: dict[str, Any] = {
        "schemaVersion": 1,
        "mode": "execute",
        "passed": False,
        "productionMutation": False,
        "queuePausePerformed": False,
        "queueResumed": False,
        "workerDeploymentMutation": False,
        "d1Mutation": False,
        "schedulerMutation": False,
        "failure": None,
    }
    try:
        pre = capture()
        save("pre-state.json", pre)
        if not pre["safeToPause"]:
            raise RuntimeError(f"Queue pause pre-state is not safe: {pre['failures']}")
        if pre["stateDigest"] != AUTHORIZED_STATE:
            raise RuntimeError("authorized Queue-pause state digest changed")

        api(
            "PATCH",
            f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}/settings",
            {"delivery_paused": True},
        )
        result["productionMutation"] = True
        result["queuePausePerformed"] = True
        wait_for_paused()

        post = capture()
        save("post-state.json", post)
        post_checks = {
            "queuePaused": post["state"]["queue"]["deliveryPaused"] is True,
            "queueBacklogStillEmpty": post["state"]["queue"]["metrics"]["backlogCount"] == 0 and post["state"]["queue"]["metrics"]["backlogBytes"] == 0,
            "schedulerStillDisabled": post["state"]["schedules"] == [],
            "deploymentUnchanged": post["state"]["deploymentVersion"] == pre["state"]["deploymentVersion"],
            "networkBoundaryUnchanged": post["state"]["appNetwork"] == pre["state"]["appNetwork"] == "devnet" and post["state"]["mainnetEnabled"] == pre["state"]["mainnetEnabled"] == "false",
            "maxLedgersUnchanged": post["state"]["maxLedgersPerRun"] == pre["state"]["maxLedgersPerRun"] == "32",
            "queueSlotsUnchanged": post["state"]["slots"] == pre["state"]["slots"],
        }
        if not all(post_checks.values()):
            raise RuntimeError(f"Queue pause post-check failed: {post_checks}")
        result.update({"passed": True, "pre": pre, "post": post, "postChecks": post_checks})
    except Exception as exc:  # noqa: BLE001
        result["failure"] = repr(exc)
        try:
            final_queue = queue_state()
            result["queuePausedAfterFailure"] = queue_paused(final_queue)
            save("final-queue-state.json", final_queue)
        except Exception as final_exc:  # noqa: BLE001
            result["finalStateFailure"] = repr(final_exc)
    finally:
        save("result.json", result)
        print(json.dumps({
            "passed": result["passed"],
            "queuePausePerformed": result["queuePausePerformed"],
            "queueResumed": result["queueResumed"],
            "workerDeploymentMutation": result["workerDeploymentMutation"],
            "d1Mutation": result["d1Mutation"],
            "schedulerMutation": result["schedulerMutation"],
            "failure": result["failure"],
        }, sort_keys=True))
    return 0 if result["passed"] else 1


if "--prepare" in sys.argv:
    raise SystemExit(do_prepare())
if "--execute" in sys.argv:
    raise SystemExit(do_execute())
raise SystemExit("use --prepare or --execute")
