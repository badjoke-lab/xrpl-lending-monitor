#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
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
EXPECTED_WORKER_VERSION = os.environ.get(
    "EXPECTED_WORKER_VERSION",
    "6141a09f-cf99-4098-a75b-145cef1b9e63",
)
AUTHORIZED_STATE_DIGEST = os.environ.get("AUTHORIZED_STATE_DIGEST", "")
AUTHORIZED_CONSUMER_ID = os.environ.get("AUTHORIZED_CONSUMER_ID", "")
OUT = Path(os.environ.get(
    "CURRENT_REPAIR_QUEUE_CONSUMER_OUTPUT",
    "current-repair-queue-consumer-evidence",
))
OUT.mkdir(parents=True, exist_ok=True)
API_BASE = "https://api.cloudflare.com/client/v4"
HEADERS = {
    "Authorization": f"Bearer {API_TOKEN}",
    "Content-Type": "application/json",
}
QUEUE_LEASE_SECONDS = 15 * 60
EXPECTED_QUEUE_NAME = "xrpl-lending-fast-lane"
EXPECTED_OLD_SETTINGS = {
    "batch_size": 1,
    "max_concurrency": 1,
    "max_retries": 3,
    "max_wait_time_ms": 1000,
    "retry_delay": 0,
}
EXPECTED_NEW_SETTINGS = {
    **EXPECTED_OLD_SETTINGS,
    "max_retries": 100,
}

if not all((ACCOUNT_ID, API_TOKEN, QUEUE_ID, DATABASE_ID)):
    raise SystemExit("Cloudflare credentials, Queue identity, and D1 identity are required")


def save(name: str, value: Any) -> Any:
    (OUT / name).write_text(
        json.dumps(value, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return value


def api(method: str, path: str, body: Any | None = None) -> dict[str, Any]:
    data = None if body is None else json.dumps(body, separators=(",", ":")).encode()
    last_error: Exception | None = None
    for attempt in range(5):
        request = urllib.request.Request(
            API_BASE + path,
            data=data,
            headers=HEADERS,
            method=method,
        )
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


def consumers() -> list[dict[str, Any]]:
    result = api(
        "GET",
        f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}/consumers",
    )["result"]
    if not isinstance(result, list):
        raise RuntimeError("Queue consumer list response is invalid")
    return result


def schedules() -> list[dict[str, Any]]:
    return api(
        "GET",
        f"/accounts/{ACCOUNT_ID}/workers/scripts/{SCRIPT_NAME}/schedules",
    )["result"]["schedules"]


def deployments() -> list[dict[str, Any]]:
    return api(
        "GET",
        f"/accounts/{ACCOUNT_ID}/workers/scripts/{SCRIPT_NAME}/deployments",
    )["result"]["deployments"]


def worker_settings() -> dict[str, Any]:
    return api(
        "GET",
        f"/accounts/{ACCOUNT_ID}/workers/scripts/{SCRIPT_NAME}/settings",
    )["result"]


def binding_value(bindings: list[dict[str, Any]], name: str) -> Any:
    for item in bindings:
        if item.get("name") == name:
            return item.get("text", item.get("value"))
    return None


def normalized_consumer(consumer: dict[str, Any]) -> dict[str, Any]:
    settings = consumer.get("settings") or {}
    return {
        "consumerId": consumer.get("consumer_id"),
        "queueName": consumer.get("queue_name"),
        "scriptName": consumer.get("script_name"),
        "type": consumer.get("type"),
        "deadLetterQueue": consumer.get("dead_letter_queue") or "",
        "settings": {
            "batch_size": settings.get("batch_size"),
            "max_concurrency": settings.get("max_concurrency"),
            "max_retries": settings.get("max_retries"),
            "max_wait_time_ms": settings.get("max_wait_time_ms"),
            "retry_delay": settings.get("retry_delay"),
        },
    }


def slot_state() -> dict[str, int]:
    row = one(d1_query(
        "SELECT "
        "COALESCE(SUM(CASE WHEN status='processing' AND next_scheduled_time IS NULL "
        f"AND unixepoch(updated_at) > unixepoch('now')-{QUEUE_LEASE_SECONDS} THEN 1 ELSE 0 END),0) AS live_unstaged, "
        "COALESCE(SUM(CASE WHEN status='processing' AND next_scheduled_time IS NULL "
        f"AND unixepoch(updated_at) <= unixepoch('now')-{QUEUE_LEASE_SECONDS} THEN 1 ELSE 0 END),0) AS stale_reclaimable, "
        "COALESCE(SUM(CASE WHEN status='processing' AND next_scheduled_time IS NOT NULL THEN 1 ELSE 0 END),0) AS staged_successor "
        "FROM fast_lane_queue_slots"
    ))
    return {
        "liveUnstaged": int(row.get("live_unstaged", -1)),
        "staleReclaimable": int(row.get("stale_reclaimable", -1)),
        "stagedSuccessor": int(row.get("staged_successor", -1)),
    }


def fast_lane_state() -> dict[str, Any]:
    row = one(d1_query(
        "SELECT last_processed_ledger, latest_observed_ledger, updated_at "
        "FROM fast_lane_shadow_state WHERE network='devnet'"
    ))
    return {
        "lastProcessedLedger": int(row.get("last_processed_ledger", 0)),
        "latestObservedLedger": int(row.get("latest_observed_ledger", 0)),
        "updatedAt": row.get("updated_at"),
    }


def capture(expected_settings: dict[str, Any]) -> dict[str, Any]:
    queue = queue_state()
    metrics = queue_metrics()
    consumer_list = consumers()
    cron = schedules()
    deployment_list = deployments()
    latest_deployment = deployment_list[0] if deployment_list else {}
    versions = latest_deployment.get("versions") or []
    settings = worker_settings()
    bindings = settings.get("bindings") or []
    slots = slot_state()
    fast_lane = fast_lane_state()
    paused = queue_paused(queue)
    consumer = normalized_consumer(consumer_list[0]) if len(consumer_list) == 1 else {}

    checks = {
        "queuePaused": paused is True,
        "queueBacklogEmpty": metrics["backlogCount"] == 0 and metrics["backlogBytes"] == 0,
        "oneWorkerConsumer": len(consumer_list) == 1
            and consumer.get("type") == "worker"
            and consumer.get("scriptName") == SCRIPT_NAME,
        "queueNameExact": consumer.get("queueName") == EXPECTED_QUEUE_NAME,
        "consumerSettingsExact": consumer.get("settings") == expected_settings,
        "deadLetterQueueAbsent": consumer.get("deadLetterQueue") == "",
        "schedulerDisabled": cron == [],
        "singleExpectedWorkerVersion": len(versions) == 1
            and versions[0].get("version_id") == EXPECTED_WORKER_VERSION
            and versions[0].get("percentage") == 100,
        "devnetOnly": binding_value(bindings, "APP_NETWORK") == "devnet"
            and binding_value(bindings, "MAINNET_ENABLED") == "false",
        "maxLedgers32": binding_value(bindings, "FAST_LANE_MAX_LEDGERS_PER_RUN") == "32",
        "noLiveUnstagedSlot": slots["liveUnstaged"] == 0,
        "oneStaleReclaimableSlot": slots["staleReclaimable"] == 1,
        "noStagedSuccessor": slots["stagedSuccessor"] == 0,
        "fastLaneBehind": 0 < fast_lane["lastProcessedLedger"] < fast_lane["latestObservedLedger"],
    }
    state = {
        "queue": {
            "id": QUEUE_ID,
            "name": queue.get("queue_name"),
            "deliveryPaused": paused,
            "metrics": metrics,
        },
        "consumer": consumer,
        "schedules": cron,
        "workerVersion": versions[0].get("version_id") if len(versions) == 1 else None,
        "appNetwork": binding_value(bindings, "APP_NETWORK"),
        "mainnetEnabled": binding_value(bindings, "MAINNET_ENABLED"),
        "maxLedgersPerRun": binding_value(bindings, "FAST_LANE_MAX_LEDGERS_PER_RUN"),
        "slots": slots,
        "fastLane": fast_lane,
    }
    digest = hashlib.sha256(
        json.dumps(state, separators=(",", ":"), sort_keys=True).encode()
    ).hexdigest()
    return {
        "safe": all(checks.values()),
        "checks": checks,
        "failures": [name for name, passed in checks.items() if not passed],
        "stateDigest": digest,
        "state": state,
    }


def do_prepare() -> int:
    pre = capture(EXPECTED_OLD_SETTINGS)
    result = {
        "schemaVersion": 1,
        "mode": "prepare",
        "productionMutation": False,
        "targetMaxRetries": 100,
        **pre,
    }
    save("result.json", result)
    print(json.dumps({
        "safe": result["safe"],
        "failures": result["failures"],
        "stateDigest": result["stateDigest"],
        "consumerId": result["state"].get("consumer", {}).get("consumerId"),
        "lastProcessedLedger": result["state"].get("fastLane", {}).get("lastProcessedLedger"),
    }, sort_keys=True))
    return 0 if result["safe"] else 1


def do_execute() -> int:
    result: dict[str, Any] = {
        "schemaVersion": 1,
        "mode": "execute",
        "passed": False,
        "productionMutation": False,
        "consumerUpdatePerformed": False,
        "queueMessageSent": False,
        "queuePurged": False,
        "queueResumed": False,
        "workerDeploymentMutation": False,
        "d1Mutation": False,
        "schedulerMutation": False,
        "failure": None,
    }
    try:
        if not AUTHORIZED_STATE_DIGEST or not AUTHORIZED_CONSUMER_ID:
            raise RuntimeError("exact authorized state digest and consumer id are required")
        pre = capture(EXPECTED_OLD_SETTINGS)
        save("pre-state.json", pre)
        if not pre["safe"]:
            raise RuntimeError(f"Queue consumer pre-state is not safe: {pre['failures']}")
        if pre["stateDigest"] != AUTHORIZED_STATE_DIGEST:
            raise RuntimeError("Queue consumer authorized state digest changed")
        if pre["state"]["consumer"]["consumerId"] != AUTHORIZED_CONSUMER_ID:
            raise RuntimeError("Queue consumer identity changed")

        mutation = api(
            "PUT",
            f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}/consumers/{AUTHORIZED_CONSUMER_ID}",
            {
                "script_name": SCRIPT_NAME,
                "type": "worker",
                "settings": EXPECTED_NEW_SETTINGS,
            },
        )
        result["productionMutation"] = True
        result["consumerUpdatePerformed"] = True
        save("mutation-response.json", mutation)

        post = capture(EXPECTED_NEW_SETTINGS)
        save("post-state.json", post)
        if not post["safe"]:
            raise RuntimeError(f"Queue consumer post-state is not safe: {post['failures']}")
        post_checks = {
            "consumerIdentityUnchanged": post["state"]["consumer"]["consumerId"] == AUTHORIZED_CONSUMER_ID,
            "queueStillPaused": post["state"]["queue"]["deliveryPaused"] is True,
            "queueBacklogUnchanged": post["state"]["queue"]["metrics"] == pre["state"]["queue"]["metrics"],
            "workerUnchanged": post["state"]["workerVersion"] == pre["state"]["workerVersion"] == EXPECTED_WORKER_VERSION,
            "networkBoundaryUnchanged": post["state"]["appNetwork"] == pre["state"]["appNetwork"] == "devnet"
                and post["state"]["mainnetEnabled"] == pre["state"]["mainnetEnabled"] == "false",
            "maxLedgersUnchanged": post["state"]["maxLedgersPerRun"] == pre["state"]["maxLedgersPerRun"] == "32",
            "schedulerStillDisabled": post["state"]["schedules"] == pre["state"]["schedules"] == [],
            "fastLaneCursorUnchanged": post["state"]["fastLane"]["lastProcessedLedger"] == pre["state"]["fastLane"]["lastProcessedLedger"],
            "queueSlotsUnchanged": post["state"]["slots"] == pre["state"]["slots"],
            "maxRetries100": post["state"]["consumer"]["settings"]["max_retries"] == 100,
        }
        if not all(post_checks.values()):
            raise RuntimeError(f"Queue consumer post-check failed: {post_checks}")
        result.update({
            "passed": True,
            "pre": pre,
            "post": post,
            "postChecks": post_checks,
        })
    except Exception as exc:  # noqa: BLE001
        result["failure"] = repr(exc)
        try:
            save("final-state.json", capture(EXPECTED_NEW_SETTINGS))
        except Exception as final_exc:  # noqa: BLE001
            result["finalStateFailure"] = repr(final_exc)
    finally:
        save("result.json", result)
        print(json.dumps({
            "passed": result["passed"],
            "consumerUpdatePerformed": result["consumerUpdatePerformed"],
            "queueMessageSent": result["queueMessageSent"],
            "queuePurged": result["queuePurged"],
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
