#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
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
OUT = Path(os.environ.get("CURRENT_REPAIR_RAMP_OUTPUT", "current-repair-five-slot-ramp-evidence"))
OUT.mkdir(parents=True, exist_ok=True)
API_BASE = "https://api.cloudflare.com/client/v4"
EXPECTED_MAX_LEDGERS = 32
RAMP_SLOTS = 5
SLOT_START_TIMEOUT_SECONDS = 120
SLOT_TERMINAL_TIMEOUT_SECONDS = 120

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


def read_slot(scheduled_time: int) -> dict[str, Any] | None:
    rows = d1_query(
        "SELECT scheduled_time,status,message_id,started_at,completed_at,next_scheduled_time,next_cron,error_message,updated_at "
        f"FROM fast_lane_queue_slots WHERE scheduled_time={scheduled_time} LIMIT 1"
    )
    return rows[0] if rows else None


def proof_tip_candidates() -> list[dict[str, Any]]:
    return d1_query(
        "SELECT p.scheduled_time,p.status,p.message_id,p.started_at,p.completed_at,p.next_scheduled_time,p.next_cron,p.error_message,p.updated_at "
        "FROM fast_lane_queue_slots p "
        "LEFT JOIN fast_lane_queue_slots s ON s.scheduled_time=p.next_scheduled_time "
        "WHERE p.status='completed' AND p.error_message IS NULL "
        "AND p.next_scheduled_time IS NOT NULL AND p.next_scheduled_time>p.scheduled_time "
        "AND p.next_cron IS NOT NULL AND s.scheduled_time IS NULL "
        "ORDER BY p.completed_at DESC,p.scheduled_time DESC LIMIT 2"
    )


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
        "SELECT run_at,status,start_ledger_index,end_ledger_index,latest_observed_ledger,lag_ledgers,ledgers_processed,"
        "lending_transactions,coalesced_object_rows,persistence_rows_read,persistence_rows_written,error_message "
        "FROM fast_lane_shadow_run_metrics WHERE network='devnet' ORDER BY run_at DESC LIMIT 1"
    ))


def metrics_after(run_at: str) -> list[dict[str, Any]]:
    safe = run_at.replace("'", "''")
    return d1_query(
        "SELECT run_at,status,start_ledger_index,end_ledger_index,latest_observed_ledger,lag_ledgers,ledgers_processed,"
        "lending_transactions,coalesced_object_rows,persistence_rows_read,persistence_rows_written,error_message "
        "FROM fast_lane_shadow_run_metrics WHERE network='devnet' "
        f"AND run_at>'{safe}' ORDER BY run_at ASC"
    )


def current_deployment_version() -> tuple[str | None, dict[str, Any]]:
    deployment_list = deployments()
    latest = deployment_list[0] if deployment_list else {}
    versions = latest.get("versions") or []
    if len(versions) != 1 or versions[0].get("percentage") != 100:
        return None, latest
    return versions[0].get("version_id"), latest


def capture() -> dict[str, Any]:
    proof_candidates = proof_tip_candidates()
    proof = proof_candidates[0] if len(proof_candidates) == 1 else None
    proof_slot = int((proof or {}).get("scheduled_time") or 0)
    first_successor = int((proof or {}).get("next_scheduled_time") or 0)
    queue = queue_state()
    qmetrics = queue_metrics()
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
        "schedulerDisabled": cron == [],
        "repairedVersionActive": version == REPAIRED_VERSION_ID,
        "devnetOnly": binding_value(bindings, "APP_NETWORK") == "devnet" and binding_value(bindings, "MAINNET_ENABLED") == "false",
        "maxLedgers32": binding_value(bindings, "FAST_LANE_MAX_LEDGERS_PER_RUN") == str(EXPECTED_MAX_LEDGERS),
        "singleQueueBinding": len([item for item in bindings if item.get("name") == "FAST_LANE_QUEUE" and item.get("type") == "queue"]) == 1,
        "proofTipUnique": len(proof_candidates) == 1,
        "proofSlotCompleted": bool(proof) and proof.get("status") == "completed" and proof.get("error_message") is None,
        "proofSuccessorStaged": first_successor > proof_slot and bool((proof or {}).get("next_cron")),
        "successorNotYetDelivered": first_successor > 0 and read_slot(first_successor) is None,
        "noPendingSlot": slots["pending"] == 0,
        "noLiveUnstagedSlot": slots["liveUnstaged"] == 0,
        "noStagedProcessingSlot": slots["stagedSuccessor"] == 0,
        "proofMetricCommitted": metric.get("status") == "committed" and metric.get("error_message") is None and int(metric.get("end_ledger_index") or 0) == int(fast.get("last_processed_ledger") or -1),
        "publicSmoke": all(status == 200 for status in public.values()),
    }
    state = {
        "proofTipCandidateCount": len(proof_candidates),
        "proofSlot": proof,
        "firstSuccessor": first_successor,
        "queue": {"deliveryPaused": paused, "metrics": qmetrics},
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
        "safeToRunFiveSlotRamp": all(checks.values()),
        "checks": checks,
        "failures": [name for name, passed in checks.items() if not passed],
        "stateDigest": digest,
        "state": state,
    }


def iso_epoch(value: str) -> float:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def do_prepare() -> int:
    pre = capture()
    result = {
        "schemaVersion": 1,
        "mode": "prepare",
        "productionMutation": False,
        "rampSlots": RAMP_SLOTS,
        **pre,
    }
    save("result.json", result)
    print(json.dumps({
        "safeToRunFiveSlotRamp": result["safeToRunFiveSlotRamp"],
        "failures": result["failures"],
        "stateDigest": result["stateDigest"],
        "firstSuccessor": result["state"]["firstSuccessor"],
        "preLedger": result["state"]["fastLane"].get("last_processed_ledger"),
        "preLag": result["state"]["latestMetric"].get("lag_ledgers"),
    }, sort_keys=True))
    return 0 if result["safeToRunFiveSlotRamp"] else 1


def do_execute() -> int:
    authorized_state = os.environ.get("AUTHORIZED_STATE_DIGEST", "")
    authorized_first = int(os.environ.get("AUTHORIZED_FIRST_SUCCESSOR", "0"))
    result: dict[str, Any] = {
        "schemaVersion": 1,
        "mode": "execute",
        "passed": False,
        "productionMutation": False,
        "queueResumed": False,
        "queueRepaused": False,
        "rampSlots": RAMP_SLOTS,
        "schedulerMutation": False,
        "queuePurged": False,
        "failure": None,
    }
    pre: dict[str, Any] | None = None
    terminals: list[dict[str, Any]] = []
    try:
        if not authorized_state or authorized_first <= 0:
            raise RuntimeError("exact five-slot ramp authorization inputs are required")
        pre = capture()
        save("pre-state.json", pre)
        if not pre["safeToRunFiveSlotRamp"]:
            raise RuntimeError(f"five-slot ramp pre-state is unsafe: {pre['failures']}")
        if pre["stateDigest"] != authorized_state:
            raise RuntimeError("five-slot ramp state digest changed after authorization")
        if int(pre["state"]["firstSuccessor"]) != authorized_first:
            raise RuntimeError("authorized first successor no longer matches staged successor")

        pre_metric = pre["state"]["latestMetric"]
        pre_metric_at = str(pre_metric.get("run_at") or "")
        pre_ledger = int(pre["state"]["fastLane"].get("last_processed_ledger") or 0)
        pre_lag = int(pre_metric.get("lag_ledgers") or 0)
        pre_db_size = int(pre["state"]["databaseSize"] or 0)

        set_queue_paused(False)
        result["productionMutation"] = True
        result["queueResumed"] = True

        expected = authorized_first
        pause_trigger_status: str | None = None
        for index in range(RAMP_SLOTS):
            start_deadline = time.time() + SLOT_START_TIMEOUT_SECONDS
            observed: dict[str, Any] | None = None
            while time.time() < start_deadline:
                observed = read_slot(expected)
                if observed and observed.get("status") in {"processing", "completed", "error"}:
                    if index == RAMP_SLOTS - 1:
                        pause_trigger_status = str(observed.get("status"))
                        set_queue_paused(True)
                        result["queueRepaused"] = True
                    break
                time.sleep(0.25)
            if not observed:
                raise RuntimeError(f"ramp slot {expected} did not start before timeout")

            terminal_deadline = time.time() + SLOT_TERMINAL_TIMEOUT_SECONDS
            terminal: dict[str, Any] | None = None
            while time.time() < terminal_deadline:
                slot = read_slot(expected)
                if slot and slot.get("status") in {"completed", "error"}:
                    terminal = slot
                    break
                time.sleep(0.5)
            if terminal is None:
                raise RuntimeError(f"ramp slot {expected} did not reach terminal state")
            terminals.append(terminal)
            save(f"slot-{index + 1}.json", terminal)
            if terminal.get("status") != "completed" or terminal.get("error_message") is not None:
                raise RuntimeError(f"ramp slot {expected} failed: {terminal}")
            next_scheduled = int(terminal.get("next_scheduled_time") or 0)
            if next_scheduled <= expected or not terminal.get("next_cron"):
                raise RuntimeError(f"ramp slot {expected} did not stage a successor")
            expected = next_scheduled

        if not result["queueRepaused"]:
            raise RuntimeError("Queue was not re-paused at the fifth ramp slot")

        new_metrics = metrics_after(pre_metric_at)
        save("new-metrics.json", new_metrics)
        if len(new_metrics) != RAMP_SLOTS:
            raise RuntimeError(f"expected exactly {RAMP_SLOTS} new metrics, found {len(new_metrics)}")

        expected_start = pre_ledger + 1
        total_ledgers = 0
        total_rows_read = 0
        total_rows_written = 0
        total_transactions = 0
        total_coalesced = 0
        metric_checks: list[dict[str, Any]] = []
        for index, metric in enumerate(new_metrics):
            start = int(metric.get("start_ledger_index") or 0)
            end = int(metric.get("end_ledger_index") or 0)
            ledgers = int(metric.get("ledgers_processed") or 0)
            status_ok = metric.get("status") == "committed" and metric.get("error_message") is None
            contiguous = start == expected_start and end >= start and end - start + 1 == ledgers
            bounded = 1 <= ledgers <= EXPECTED_MAX_LEDGERS
            metric_checks.append({
                "index": index + 1,
                "statusCommitted": status_ok,
                "contiguous": contiguous,
                "boundedLedgers": bounded,
                "startLedger": start,
                "endLedger": end,
                "ledgersProcessed": ledgers,
                "lagLedgers": int(metric.get("lag_ledgers") or 0),
            })
            if not status_ok or not contiguous or not bounded:
                raise RuntimeError(f"ramp metric {index + 1} failed validation: {metric_checks[-1]}")
            expected_start = end + 1
            total_ledgers += ledgers
            total_rows_read += int(metric.get("persistence_rows_read") or 0)
            total_rows_written += int(metric.get("persistence_rows_written") or 0)
            total_transactions += int(metric.get("lending_transactions") or 0)
            total_coalesced += int(metric.get("coalesced_object_rows") or 0)

        slot_durations = []
        for terminal in terminals:
            started = terminal.get("started_at")
            completed = terminal.get("completed_at")
            if not started or not completed:
                raise RuntimeError(f"ramp terminal slot lacks timestamps: {terminal}")
            duration = iso_epoch(str(completed)) - iso_epoch(str(started))
            slot_durations.append(duration)
            if duration < 0 or duration > 45:
                raise RuntimeError(f"ramp slot duration exceeded 45s envelope: {duration}")

        final_fast = fast_state()
        final_metric = latest_metric()
        final_ledger = int(final_fast.get("last_processed_ledger") or 0)
        final_lag = int(final_metric.get("lag_ledgers") or 0)
        final_db_size = database_size()
        final_queue = queue_state()
        final_qmetrics = queue_metrics()
        final_schedules = schedules()
        final_version, final_deployment = current_deployment_version()
        sixth_successor = int(terminals[-1].get("next_scheduled_time") or 0)
        sixth_slot = read_slot(sixth_successor) if sixth_successor > 0 else None
        ledger_delta = final_ledger - pre_ledger
        post_checks = {
            "queuePausedAgain": queue_paused(final_queue) is True,
            "schedulerStillDisabled": final_schedules == [],
            "repairedVersionUnchanged": final_version == REPAIRED_VERSION_ID,
            "fiveSlotsCompleted": len(terminals) == RAMP_SLOTS and all(slot.get("status") == "completed" and slot.get("error_message") is None for slot in terminals),
            "fiveMetricsCommitted": len(new_metrics) == RAMP_SLOTS and all(item["statusCommitted"] for item in metric_checks),
            "contiguousCoverage": all(item["contiguous"] for item in metric_checks),
            "perInvocationBounded": all(item["boundedLedgers"] for item in metric_checks),
            "cursorMatchesMetrics": ledger_delta == total_ledgers and final_ledger == int(new_metrics[-1].get("end_ledger_index") or -1),
            "lagDecreased": final_lag < pre_lag,
            "sixthSuccessorStaged": sixth_successor > int(terminals[-1].get("scheduled_time") or 0),
            "sixthSuccessorNotDelivered": sixth_slot is None,
            "publicOverviewReachable": public_status("/api/overview") == 200,
        }
        if not all(post_checks.values()):
            raise RuntimeError(f"five-slot ramp post-check failed: {post_checks}")

        result.update({
            "passed": True,
            "pauseTriggerStatus": pause_trigger_status,
            "preLedger": pre_ledger,
            "finalLedger": final_ledger,
            "ledgerDelta": ledger_delta,
            "preLag": pre_lag,
            "finalLag": final_lag,
            "lagDelta": final_lag - pre_lag,
            "preDatabaseSize": pre_db_size,
            "finalDatabaseSize": final_db_size,
            "databaseSizeDelta": final_db_size - pre_db_size,
            "slotDurationsSeconds": slot_durations,
            "maxSlotDurationSeconds": max(slot_durations),
            "totalPersistenceRowsRead": total_rows_read,
            "totalPersistenceRowsWritten": total_rows_written,
            "totalLendingTransactions": total_transactions,
            "totalCoalescedObjectRows": total_coalesced,
            "terminalSlots": terminals,
            "newMetrics": new_metrics,
            "metricChecks": metric_checks,
            "sixthSuccessor": sixth_successor,
            "sixthSuccessorSlotObserved": sixth_slot,
            "finalQueueMetrics": final_qmetrics,
            "finalDeployment": final_deployment,
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
            result["finalSchedules"] = schedules()
            result["finalFastLane"] = fast_state()
            result["finalLatestMetric"] = latest_metric()
            result["finalQueueMetricsReadback"] = queue_metrics()
        except Exception as final_exc:  # noqa: BLE001
            result["finalReadFailure"] = repr(final_exc)
        save("result.json", result)
        print(json.dumps({
            "passed": result["passed"],
            "queueResumed": result["queueResumed"],
            "queueRepaused": result["queueRepaused"],
            "ledgerDelta": result.get("ledgerDelta"),
            "lagDelta": result.get("lagDelta"),
            "failure": result["failure"],
        }, sort_keys=True))
    return 0 if result["passed"] else 1


if "--prepare" in sys.argv:
    raise SystemExit(do_prepare())
if "--execute" in sys.argv:
    raise SystemExit(do_execute())
raise SystemExit("use --prepare or --execute")
