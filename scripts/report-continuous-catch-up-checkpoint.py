#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import time
import urllib.request
from typing import Any

EVIDENCE = Path("continuous-catch-up-checkpoint-evidence")
PROMOTION_START_MS = 1785551520000
PROMOTION_START_ISO = "2026-08-01T02:32:00Z"
EXPECTED_RUNTIME_SHA = "088cb45caff2a59511a7def65bd6517ff6a60399"
D1_GUARD_BYTES = 350_000_000
API_BASE = "https://api.cloudflare.com/client/v4"


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"missing environment variable: {name}")
    return value


def write_json(name: str, value: Any) -> None:
    EVIDENCE.mkdir(exist_ok=True)
    (EVIDENCE / name).write_text(
        json.dumps(value, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def api(
    method: str,
    path: str,
    token: str,
    body: Any | None = None,
) -> dict[str, Any]:
    data = None if body is None else json.dumps(body, separators=(",", ":")).encode()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    last_error: Exception | None = None
    for attempt in range(5):
        request = urllib.request.Request(
            API_BASE + path,
            data=data,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                result = json.load(response)
            if result.get("success") is not True:
                raise RuntimeError(result.get("errors"))
            return result
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt == 4:
                raise
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(last_error)


def d1(
    sql: str,
    account_id: str,
    database_id: str,
    token: str,
) -> list[dict[str, Any]]:
    result = api(
        "POST",
        f"/accounts/{account_id}/d1/database/{database_id}/query",
        token,
        {"sql": sql},
    )
    query = result["result"][0]
    if query.get("success") is not True:
        raise RuntimeError(result)
    return query.get("results", [])


def active_version(deployment: dict[str, Any]) -> str | None:
    versions = deployment.get("versions") or []
    if len(versions) != 1:
        return None
    if int(versions[0].get("percentage") or 0) != 100:
        return None
    value = versions[0].get("version_id")
    return str(value) if value else None


def validate_source_only() -> int:
    checks = {
        "promotionStartMinuteAligned": PROMOTION_START_MS % 60_000 == 0,
        "runtimeShaLength": len(EXPECTED_RUNTIME_SHA) == 40,
        "d1GuardPositive": D1_GUARD_BYTES > 0,
    }
    if not all(checks.values()):
        raise RuntimeError(f"source validation failed: {checks}")
    write_json("source-validation.json", checks)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--validate-source-only", action="store_true")
    args = parser.parse_args()
    if args.validate_source_only:
        return validate_source_only()

    account_id = require_env("CLOUDFLARE_ACCOUNT_ID")
    token = require_env("CLOUDFLARE_API_TOKEN")
    queue_id = require_env("QUEUE_ID")
    database_id = require_env("DATABASE_ID")
    script_name = require_env("SCRIPT_NAME")
    expected_version = require_env("EXPECTED_WORKER_VERSION")

    queue = api("GET", f"/accounts/{account_id}/queues/{queue_id}", token)["result"]
    queue_metrics_raw = api(
        "GET", f"/accounts/{account_id}/queues/{queue_id}/metrics", token
    )["result"]
    schedules = api(
        "GET",
        f"/accounts/{account_id}/workers/scripts/{script_name}/schedules",
        token,
    )["result"]["schedules"]
    deployments = api(
        "GET",
        f"/accounts/{account_id}/workers/scripts/{script_name}/deployments",
        token,
    )["result"]["deployments"]
    database = api(
        "GET", f"/accounts/{account_id}/d1/database/{database_id}", token
    )["result"]

    state_rows = d1(
        "SELECT network,epoch_id,last_processed_ledger,last_processed_hash,"
        "latest_observed_ledger,latest_observed_hash,status,lag_ledgers,updated_at "
        "FROM fast_lane_shadow_state WHERE network='devnet'",
        account_id,
        database_id,
        token,
    )
    latest_runs = d1(
        "SELECT run_at,status,start_ledger_index,end_ledger_index,"
        "latest_observed_ledger,lag_ledgers,ledgers_processed,error_message "
        "FROM fast_lane_shadow_run_metrics WHERE network='devnet' "
        "ORDER BY run_at DESC LIMIT 1",
        account_id,
        database_id,
        token,
    )
    error_summary = d1(
        "SELECT COUNT(*) AS error_count,MIN(run_at) AS first_error_at,"
        "MAX(run_at) AS last_error_at FROM fast_lane_shadow_run_metrics "
        f"WHERE network='devnet' AND run_at>='{PROMOTION_START_ISO}' "
        "AND (status='error' OR error_message IS NOT NULL)",
        account_id,
        database_id,
        token,
    )[0]
    slot_summary = d1(
        "SELECT COUNT(*) AS slot_count,"
        "SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed_count,"
        "SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS error_count,"
        "SUM(CASE WHEN status IN ('processing','running') THEN 1 ELSE 0 END) AS active_count,"
        "MIN(scheduled_time) AS first_scheduled_time,"
        "MAX(scheduled_time) AS last_scheduled_time "
        "FROM fast_lane_queue_slots "
        f"WHERE scheduled_time>={PROMOTION_START_MS}",
        account_id,
        database_id,
        token,
    )[0]
    recent_slots_desc = d1(
        "SELECT scheduled_time,status,started_at,completed_at,next_scheduled_time,"
        "next_cron,error_message,updated_at FROM fast_lane_queue_slots "
        f"WHERE scheduled_time>={PROMOTION_START_MS} "
        "ORDER BY scheduled_time DESC LIMIT 20",
        account_id,
        database_id,
        token,
    )
    recent_slots = list(reversed(recent_slots_desc))

    state = state_rows[0] if state_rows else None
    latest_run = latest_runs[0] if latest_runs else None
    deployment = deployments[0] if deployments else {}
    deployed_version = active_version(deployment)
    database_size = int(database.get("file_size") or 0)
    queue_paused = queue.get("settings", {}).get("delivery_paused") is True
    producers = queue.get("producers") or []
    consumers = queue.get("consumers") or []
    consumer_settings = consumers[0].get("settings", {}) if len(consumers) == 1 else {}

    transitions: list[dict[str, Any]] = []
    for previous, current in zip(recent_slots, recent_slots[1:]):
        previous_time = int(previous["scheduled_time"])
        current_time = int(current["scheduled_time"])
        transitions.append(
            {
                "from": previous_time,
                "to": current_time,
                "deltaMs": current_time - previous_time,
                "publishedSuccessor": int(previous.get("next_scheduled_time") or 0),
                "exactLink": int(previous.get("next_scheduled_time") or 0) == current_time,
            }
        )

    lag = int(state.get("lag_ledgers") or 0) if state else None
    latest_slot = recent_slots[-1] if recent_slots else None
    checkpoint_checks = {
        "statePresent": state is not None,
        "latestRunPresent": latest_run is not None,
        "latestRunTerminal": latest_run is not None
        and latest_run.get("status") in ("committed", "caught_up"),
        "latestRunErrorNull": latest_run is not None
        and latest_run.get("error_message") is None,
        "errorsSincePromotionZero": int(error_summary.get("error_count") or 0) == 0,
        "slotErrorsSincePromotionZero": int(slot_summary.get("error_count") or 0) == 0,
        "queueResumed": not queue_paused,
        "oneProducer": len(producers) == 1,
        "oneConsumer": len(consumers) == 1,
        "batchOne": int(consumer_settings.get("batch_size") or 0) == 1,
        "concurrencyOne": int(consumer_settings.get("max_concurrency") or 0) == 1,
        "cronEmpty": schedules == [],
        "deploymentFixed": deployed_version == expected_version,
        "databaseInsideGuard": 0 < database_size < D1_GUARD_BYTES,
        "recentSuccessorLinksExact": all(item["exactLink"] for item in transitions),
    }
    halted = not all(checkpoint_checks.values())
    self_schedule_observed = (
        latest_slot is not None and latest_slot.get("next_cron") == "queue-self-schedule"
    )
    if halted:
        phase = "halted"
    elif lag == 0 and self_schedule_observed:
        phase = "ready_for_stabilization"
    elif lag == 0:
        phase = "lag_zero_transition_pending"
    else:
        phase = "catching_up"

    result = {
        "checkedAt": now_iso(),
        "readOnly": True,
        "phase": phase,
        "runtimeSha": EXPECTED_RUNTIME_SHA,
        "expectedWorkerVersion": expected_version,
        "activeDeployment": deployment,
        "activeWorkerVersion": deployed_version,
        "state": state,
        "latestRun": latest_run,
        "errorsSincePromotion": error_summary,
        "slotsSincePromotion": slot_summary,
        "recentSlots": recent_slots,
        "recentTransitions": transitions,
        "queue": {
            "deliveryPaused": queue_paused,
            "producers": producers,
            "consumers": consumers,
            "metrics": {
                "backlog_count": int(queue_metrics_raw.get("backlog_count") or 0),
                "backlog_bytes": int(queue_metrics_raw.get("backlog_bytes") or 0),
                "oldest_message_timestamp_ms": int(
                    queue_metrics_raw.get("oldest_message_timestamp_ms") or 0
                ),
            },
        },
        "schedules": schedules,
        "databaseSize": database_size,
        "databaseGuard": D1_GUARD_BYTES,
        "checks": checkpoint_checks,
    }
    write_json("checkpoint.json", result)
    status = "HALTED" if phase == "halted" else phase.upper()
    lines = [
        f"## Continuous catch-up checkpoint: {status}",
        "",
        "```json",
        json.dumps(result, indent=2, sort_keys=True),
        "```",
    ]
    (EVIDENCE / "issue-comment.md").write_text(
        "\n".join(lines) + "\n", encoding="utf-8"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
