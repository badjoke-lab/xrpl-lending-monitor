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
EXPECTED_VERSION_ID = os.environ.get("REPAIRED_VERSION_ID", "75009b7d-f6f6-48dd-9350-1b44012b3553")
PRODUCTION_BASE = os.environ.get("PRODUCTION_BASE", "https://xrpl-lending-monitor.badjoke-lab.workers.dev")
OUT = Path(os.environ.get("CURRENT_REPAIR_CONTINUOUS_OUTPUT", "current-repair-continuous-catchup-evidence"))
OUT.mkdir(parents=True, exist_ok=True)
API_BASE = "https://api.cloudflare.com/client/v4"
EXPECTED_MAX_LEDGERS = 32
EXPECTED_CADENCE_MS = 10_000
OBSERVE_SLOTS = 3
START_TIMEOUT_SECONDS = 120
TERMINAL_TIMEOUT_SECONDS = 120

if not all((ACCOUNT_ID, API_TOKEN, QUEUE_ID, DATABASE_ID)):
    raise SystemExit("Cloudflare credentials, Queue identity, and D1 identity are required")

HEADERS = {"Authorization": f"Bearer {API_TOKEN}", "Content-Type": "application/json"}
PUBLIC_HEADERS = {"User-Agent": "curl/8.5.0", "Accept": "application/json"}


def save(name: str, value: Any) -> Any:
    (OUT / name).write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return value


def api(method: str, path: str, body: Any | None = None) -> dict[str, Any]:
    data = None if body is None else json.dumps(body, separators=(",", ":")).encode()
    last: Exception | None = None
    for attempt in range(5):
        try:
            request = urllib.request.Request(API_BASE + path, data=data, headers=HEADERS, method=method)
            with urllib.request.urlopen(request, timeout=60) as response:
                payload = json.load(response)
            if payload.get("success") is not True:
                raise RuntimeError(payload.get("errors"))
            return payload
        except Exception as exc:  # noqa: BLE001
            last = exc
            if attempt == 4:
                raise
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(last)


def public_status(path: str) -> int:
    request = urllib.request.Request(PRODUCTION_BASE + path, headers=PUBLIC_HEADERS, method="GET")
    with urllib.request.urlopen(request, timeout=45) as response:
        return response.status


def d1_query(sql: str) -> list[dict[str, Any]]:
    payload = api("POST", f"/accounts/{ACCOUNT_ID}/d1/database/{DATABASE_ID}/query", {"sql": sql})
    result = (payload.get("result") or [{}])[0]
    if result.get("success") is not True:
        raise RuntimeError("D1 read failed")
    return result.get("results") or []


def one(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return rows[0] if rows else {}


def queue_state() -> dict[str, Any]:
    return api("GET", f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}")["result"]


def queue_paused(state: dict[str, Any]) -> bool | None:
    settings = state.get("settings")
    if not isinstance(settings, dict):
        return None
    value = settings.get("delivery_paused")
    return value if isinstance(value, bool) else None


def set_queue_paused(paused: bool) -> dict[str, Any]:
    payload = api("PATCH", f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}", {"settings": {"delivery_paused": paused}})
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


def binding_value(bindings: list[dict[str, Any]], name: str) -> Any:
    for item in bindings:
        if item.get("name") == name:
            return item.get("text", item.get("value"))
    return None


def current_version() -> str | None:
    deployments_list = deployments()
    latest = deployments_list[0] if deployments_list else {}
    versions = latest.get("versions") or []
    if len(versions) != 1 or versions[0].get("percentage") != 100:
        return None
    return versions[0].get("version_id")


def read_slot(scheduled_time: int) -> dict[str, Any] | None:
    rows = d1_query(
        "SELECT scheduled_time,status,started_at,completed_at,next_scheduled_time,next_cron,error_message,updated_at "
        f"FROM fast_lane_queue_slots WHERE scheduled_time={scheduled_time} LIMIT 1"
    )
    return rows[0] if rows else None


def proof_tip_candidates() -> list[dict[str, Any]]:
    return d1_query(
        "SELECT p.scheduled_time,p.status,p.started_at,p.completed_at,p.next_scheduled_time,p.next_cron,p.error_message,p.updated_at "
        "FROM fast_lane_queue_slots p "
        "LEFT JOIN fast_lane_queue_slots s ON s.scheduled_time=p.next_scheduled_time "
        "WHERE p.status='completed' AND p.error_message IS NULL "
        "AND p.next_scheduled_time IS NOT NULL AND p.next_scheduled_time>p.scheduled_time "
        "AND p.next_cron='queue-catch-up' AND s.scheduled_time IS NULL "
        "ORDER BY p.completed_at DESC,p.scheduled_time DESC LIMIT 2"
    )


def slot_summary() -> dict[str, int]:
    counts = d1_query("SELECT status,COUNT(*) AS row_count FROM fast_lane_queue_slots GROUP BY status")
    status_counts = {str(row.get("status")): int(row.get("row_count", 0)) for row in counts}
    processing = one(d1_query(
        "SELECT "
        "COALESCE(SUM(CASE WHEN status='processing' AND next_scheduled_time IS NULL AND unixepoch(updated_at)>unixepoch('now')-900 THEN 1 ELSE 0 END),0) AS live_unstaged, "
        "COALESCE(SUM(CASE WHEN status='processing' AND next_scheduled_time IS NOT NULL THEN 1 ELSE 0 END),0) AS staged_successor "
        "FROM fast_lane_queue_slots"
    ))
    return {
        "pending": status_counts.get("pending", 0),
        "liveUnstaged": int(processing.get("live_unstaged", -1)),
        "stagedSuccessor": int(processing.get("staged_successor", -1)),
    }


def fast_state() -> dict[str, Any]:
    return one(d1_query(
        "SELECT last_processed_ledger,last_processed_hash,latest_observed_ledger,latest_observed_hash,status,updated_at "
        "FROM fast_lane_shadow_state WHERE network='devnet'"
    ))


def latest_metric() -> dict[str, Any]:
    return one(d1_query(
        "SELECT run_at,status,start_ledger_index,end_ledger_index,latest_observed_ledger,lag_ledgers,ledgers_processed,"
        "persistence_rows_read,persistence_rows_written,error_message "
        "FROM fast_lane_shadow_run_metrics WHERE network='devnet' ORDER BY run_at DESC LIMIT 1"
    ))


def capture() -> dict[str, Any]:
    queue = queue_state()
    paused = queue_paused(queue)
    cron = schedules()
    version = current_version()
    settings = worker_settings()
    bindings = settings.get("bindings") or []
    slots = slot_summary()
    candidates = proof_tip_candidates()
    anchor = candidates[0] if len(candidates) == 1 else {}
    successor = int(anchor.get("next_scheduled_time") or 0)
    fast = fast_state()
    metric = latest_metric()
    public = {
        "/api/overview": public_status("/api/overview"),
        "/api/status/fast-lane-diff?limit=1": public_status("/api/status/fast-lane-diff?limit=1"),
    }
    checks = {
        "queuePaused": paused is True,
        "schedulerDisabled": cron == [],
        "expectedWorkerActive": version == EXPECTED_VERSION_ID,
        "devnetOnly": binding_value(bindings, "APP_NETWORK") == "devnet" and binding_value(bindings, "MAINNET_ENABLED") == "false",
        "maxLedgers32": binding_value(bindings, "FAST_LANE_MAX_LEDGERS_PER_RUN") == str(EXPECTED_MAX_LEDGERS),
        "singleQueueBinding": len([item for item in bindings if item.get("name") == "FAST_LANE_QUEUE" and item.get("type") == "queue"]) == 1,
        "proofTipUnique": len(candidates) == 1,
        "anchorCompleted": bool(anchor) and anchor.get("status") == "completed" and anchor.get("error_message") is None,
        "successorStaged": successor > int(anchor.get("scheduled_time") or 0) and anchor.get("next_cron") == "queue-catch-up",
        "successorUndelivered": successor > 0 and read_slot(successor) is None,
        "noPendingSlot": slots["pending"] == 0,
        "noLiveProcessing": slots["liveUnstaged"] == 0,
        "noStagedProcessing": slots["stagedSuccessor"] == 0,
        "latestMetricCommitted": metric.get("status") == "committed" and metric.get("error_message") is None and int(metric.get("end_ledger_index") or 0) == int(fast.get("last_processed_ledger") or -1),
        "publicSmoke": all(status == 200 for status in public.values()),
    }
    state = {
        "proofTipCandidateCount": len(candidates),
        "queuePaused": paused,
        "schedules": cron,
        "deploymentVersion": version,
        "appNetwork": binding_value(bindings, "APP_NETWORK"),
        "mainnetEnabled": binding_value(bindings, "MAINNET_ENABLED"),
        "maxLedgersPerRun": binding_value(bindings, "FAST_LANE_MAX_LEDGERS_PER_RUN"),
        "slots": slots,
        "anchor": anchor,
        "successor": successor,
        "fastLane": fast,
        "latestMetric": metric,
        "public": public,
    }
    digest = hashlib.sha256(json.dumps(state, separators=(",", ":"), sort_keys=True).encode()).hexdigest()
    return {"safeToStartContinuous": all(checks.values()), "checks": checks, "failures": [k for k, v in checks.items() if not v], "stateDigest": digest, "state": state}


def prepare() -> int:
    result = {"schemaVersion": 1, "mode": "prepare", "productionMutation": False, **capture()}
    save("result.json", result)
    print(json.dumps({"safeToStartContinuous": result["safeToStartContinuous"], "failures": result["failures"], "stateDigest": result["stateDigest"], "proofTipCandidateCount": result["state"]["proofTipCandidateCount"], "slots": result["state"]["slots"], "anchor": result["state"]["anchor"], "successor": result["state"]["successor"], "preLedger": result["state"]["fastLane"].get("last_processed_ledger")}, sort_keys=True))
    return 0 if result["safeToStartContinuous"] else 1


def wait_terminal(scheduled_time: int) -> dict[str, Any]:
    start_deadline = time.time() + START_TIMEOUT_SECONDS
    while time.time() < start_deadline:
        slot = read_slot(scheduled_time)
        if slot and slot.get("status") in {"processing", "completed", "error"}:
            break
        time.sleep(0.25)
    else:
        raise RuntimeError(f"continuous slot {scheduled_time} did not start")
    terminal_deadline = time.time() + TERMINAL_TIMEOUT_SECONDS
    while time.time() < terminal_deadline:
        slot = read_slot(scheduled_time)
        if slot and slot.get("status") in {"completed", "error"}:
            return slot
        time.sleep(0.5)
    raise RuntimeError(f"continuous slot {scheduled_time} did not reach terminal state")


def execute() -> int:
    authorized_state = os.environ.get("AUTHORIZED_STATE_DIGEST", "")
    authorized_successor = int(os.environ.get("AUTHORIZED_SUCCESSOR", "0"))
    result: dict[str, Any] = {
        "schemaVersion": 1,
        "mode": "execute",
        "passed": False,
        "productionMutation": False,
        "queueResumed": False,
        "queueLeftActive": False,
        "failSafePaused": False,
        "queueMessageSent": False,
        "queuePurged": False,
        "schedulerMutation": False,
        "failure": None,
    }
    terminals: list[dict[str, Any]] = []
    metrics: list[dict[str, Any]] = []
    try:
        if not authorized_state or authorized_successor <= 0:
            raise RuntimeError("exact continuous catch-up authorization inputs are required")
        pre = capture()
        save("pre-state.json", pre)
        if not pre["safeToStartContinuous"]:
            raise RuntimeError(f"continuous catch-up pre-state unsafe: {pre['failures']}")
        if pre["stateDigest"] != authorized_state or int(pre["state"]["successor"]) != authorized_successor:
            raise RuntimeError("authorized continuous catch-up state changed")
        pre_ledger = int(pre["state"]["fastLane"].get("last_processed_ledger") or 0)

        set_queue_paused(False)
        result["productionMutation"] = True
        result["queueResumed"] = True

        expected = authorized_successor
        for index in range(OBSERVE_SLOTS):
            terminal = wait_terminal(expected)
            save(f"slot-{index + 1}.json", terminal)
            if terminal.get("status") != "completed" or terminal.get("error_message") is not None:
                raise RuntimeError(f"continuous slot failed: {terminal}")
            terminals.append(terminal)
            metric = latest_metric()
            save(f"metric-{index + 1}.json", metric)
            if metric.get("status") != "committed" or metric.get("error_message") is not None:
                raise RuntimeError(f"continuous metric not committed: {metric}")
            metrics.append(metric)
            next_scheduled = int(terminal.get("next_scheduled_time") or 0)
            if next_scheduled <= expected or terminal.get("next_cron") != "queue-catch-up":
                raise RuntimeError(f"continuous slot did not stage successor: {terminal}")
            expected = next_scheduled

        ledger_ranges_ok = True
        expected_start = pre_ledger + 1
        for metric in metrics:
            start = int(metric.get("start_ledger_index") or 0)
            end = int(metric.get("end_ledger_index") or 0)
            ledgers = int(metric.get("ledgers_processed") or 0)
            if start != expected_start or end < start or end - start + 1 != ledgers or not (1 <= ledgers <= EXPECTED_MAX_LEDGERS):
                ledger_ranges_ok = False
                break
            expected_start = end + 1
        scheduled_times = [int(terminal.get("scheduled_time") or 0) for terminal in terminals]
        cadence_deltas = [later - earlier for earlier, later in zip(scheduled_times, scheduled_times[1:])]
        cadence_ok = (
            len(scheduled_times) == OBSERVE_SLOTS
            and all(scheduled > 0 and scheduled % EXPECTED_CADENCE_MS == 0 for scheduled in scheduled_times)
            and all(delta >= EXPECTED_CADENCE_MS and delta % EXPECTED_CADENCE_MS == 0 for delta in cadence_deltas)
        )
        fresh_lag_decreased = int(metrics[-1].get("lag_ledgers") or 0) < int(metrics[0].get("lag_ledgers") or 0)
        final_fast = fast_state()
        final_version = current_version()
        post_checks = {
            "queueStillActive": queue_paused(queue_state()) is False,
            "schedulerStillDisabled": schedules() == [],
            "workerUnchanged": final_version == EXPECTED_VERSION_ID,
            "threeSlotsCompleted": len(terminals) == OBSERVE_SLOTS,
            "contiguousBoundedCoverage": ledger_ranges_ok,
            "catchUpCadenceContract": cadence_ok,
            "freshLagDecreased": fresh_lag_decreased,
            "cursorAdvanced": int(final_fast.get("last_processed_ledger") or 0) >= int(metrics[-1].get("end_ledger_index") or 0) > pre_ledger,
            "publicOverviewReachable": public_status("/api/overview") == 200,
        }
        if not all(post_checks.values()):
            raise RuntimeError(f"continuous catch-up post-check failed: {post_checks}")
        result.update({
            "passed": True,
            "queueLeftActive": True,
            "preLedger": pre_ledger,
            "observedTerminalSlots": terminals,
            "observedMetrics": metrics,
            "nextSuccessor": expected,
            "postChecks": post_checks,
            "finalFastLane": final_fast,
        })
    except Exception as exc:  # noqa: BLE001
        result["failure"] = repr(exc)
        if result["queueResumed"]:
            try:
                set_queue_paused(True)
                result["failSafePaused"] = True
            except Exception as pause_exc:  # noqa: BLE001
                result["failSafePauseFailure"] = repr(pause_exc)
    finally:
        try:
            result["finalQueuePaused"] = queue_paused(queue_state())
            result["finalSchedules"] = schedules()
            result["finalVersion"] = current_version()
            result["finalFastLaneReadback"] = fast_state()
            result["finalLatestMetric"] = latest_metric()
        except Exception as exc:  # noqa: BLE001
            result["finalReadFailure"] = repr(exc)
        save("result.json", result)
        print(json.dumps({"passed": result["passed"], "queueResumed": result["queueResumed"], "queueLeftActive": result["queueLeftActive"], "failSafePaused": result["failSafePaused"], "failure": result["failure"]}, sort_keys=True))
    return 0 if result["passed"] else 1


if "--prepare" in sys.argv:
    raise SystemExit(prepare())
if "--execute" in sys.argv:
    raise SystemExit(execute())
raise SystemExit("use --prepare or --execute")
