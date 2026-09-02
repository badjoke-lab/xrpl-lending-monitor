#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
import time
import urllib.request
from pathlib import Path
from typing import Any

ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
QUEUE_ID = os.environ.get("QUEUE_ID", "")
DATABASE_ID = os.environ.get("DATABASE_ID", "")
SCRIPT_NAME = os.environ.get("SCRIPT_NAME", "xrpl-lending-monitor")
REPAIRED_VERSION_ID = os.environ.get("REPAIRED_VERSION_ID", "")
OUT = Path(os.environ.get("CURRENT_REPAIR_EXISTING_RETRY_OUTPUT", "current-repair-existing-retry-evidence"))
OUT.mkdir(parents=True, exist_ok=True)
API_BASE = "https://api.cloudflare.com/client/v4"
EXPECTED_SCHEDULED_TIME = 1788260040000
EXPECTED_MESSAGE_ID = "3a504373e28bd9ae052f7091e2482c86"
EXPECTED_BACKLOG_COUNT = 1
EXPECTED_BACKLOG_BYTES = 118
EXPECTED_MAX_LEDGERS = "32"
START_TIMEOUT_SECONDS = 180
TERMINAL_TIMEOUT_SECONDS = 240

if not all((ACCOUNT_ID, API_TOKEN, QUEUE_ID, DATABASE_ID, REPAIRED_VERSION_ID)):
    raise SystemExit("exact Cloudflare identities and repaired version are required")

HEADERS = {"Authorization": f"Bearer {API_TOKEN}", "Content-Type": "application/json"}


def save(name: str, value: Any) -> Any:
    (OUT / name).write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return value


def api(method: str, path: str, body: Any | None = None) -> dict[str, Any]:
    data = None if body is None else json.dumps(body, separators=(",", ":")).encode()
    request = urllib.request.Request(API_BASE + path, data=data, headers=HEADERS, method=method)
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.load(response)
    if payload.get("success") is not True:
        raise RuntimeError(payload.get("errors"))
    return payload


def d1(sql: str) -> list[dict[str, Any]]:
    payload = api("POST", f"/accounts/{ACCOUNT_ID}/d1/database/{DATABASE_ID}/query", {"sql": sql})
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
    return {"backlogCount": int(result.get("backlog_count") or 0), "backlogBytes": int(result.get("backlog_bytes") or 0)}


def queue_paused(state: dict[str, Any]) -> bool | None:
    settings = state.get("settings")
    value = settings.get("delivery_paused") if isinstance(settings, dict) else None
    return value if isinstance(value, bool) else None


def set_queue_paused(paused: bool) -> None:
    api("PATCH", f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}", {"settings": {"delivery_paused": paused}})
    for _ in range(30):
        if queue_paused(queue_state()) is paused:
            return
        time.sleep(1)
    raise RuntimeError(f"Queue delivery_paused={paused} not observed")


def schedules() -> list[dict[str, Any]]:
    return api("GET", f"/accounts/{ACCOUNT_ID}/workers/scripts/{SCRIPT_NAME}/schedules")["result"]["schedules"]


def deployment_version() -> str | None:
    items = api("GET", f"/accounts/{ACCOUNT_ID}/workers/scripts/{SCRIPT_NAME}/deployments")["result"]["deployments"]
    latest = items[0] if items else {}
    versions = latest.get("versions") or []
    if len(versions) == 1 and versions[0].get("percentage") == 100:
        return versions[0].get("version_id")
    return None


def worker_bindings() -> list[dict[str, Any]]:
    return api("GET", f"/accounts/{ACCOUNT_ID}/workers/scripts/{SCRIPT_NAME}/settings")["result"].get("bindings") or []


def binding(bindings: list[dict[str, Any]], name: str) -> Any:
    for item in bindings:
        if item.get("name") == name:
            return item.get("text", item.get("value"))
    return None


def exact_slot() -> dict[str, Any]:
    return one(d1(
        "SELECT scheduled_time,status,message_id,started_at,completed_at,next_scheduled_time,next_cron,error_message,updated_at "
        f"FROM fast_lane_queue_slots WHERE scheduled_time={EXPECTED_SCHEDULED_TIME} LIMIT 1"
    ))


def fast_state() -> dict[str, Any]:
    return one(d1("SELECT last_processed_ledger,latest_observed_ledger,status,updated_at FROM fast_lane_shadow_state WHERE network='devnet'"))


def slot_summary() -> dict[str, int]:
    rows = d1("SELECT status,COUNT(*) AS row_count FROM fast_lane_queue_slots GROUP BY status")
    counts = {str(r.get('status')): int(r.get('row_count') or 0) for r in rows}
    extra = one(d1(
        "SELECT "
        "COALESCE(SUM(CASE WHEN status='processing' AND next_scheduled_time IS NULL AND unixepoch(updated_at) > unixepoch('now')-900 THEN 1 ELSE 0 END),0) AS live_unstaged, "
        "COALESCE(SUM(CASE WHEN status='processing' AND next_scheduled_time IS NOT NULL THEN 1 ELSE 0 END),0) AS staged_successor "
        "FROM fast_lane_queue_slots"
    ))
    return {"pending": counts.get("pending", 0), "liveUnstaged": int(extra.get("live_unstaged", -1)), "stagedSuccessor": int(extra.get("staged_successor", -1))}


def capture() -> dict[str, Any]:
    q = queue_state()
    metrics = queue_metrics()
    slot = exact_slot()
    fast = fast_state()
    slots = slot_summary()
    bindings = worker_bindings()
    version = deployment_version()
    checks = {
        "queuePaused": queue_paused(q) is True,
        "exactSingleBacklogMessage": metrics["backlogCount"] == EXPECTED_BACKLOG_COUNT and metrics["backlogBytes"] == EXPECTED_BACKLOG_BYTES,
        "exactFailedSlotPresent": int(slot.get("scheduled_time") or 0) == EXPECTED_SCHEDULED_TIME and slot.get("status") == "error" and slot.get("message_id") == EXPECTED_MESSAGE_ID,
        "failedSlotHasNoSuccessor": slot.get("next_scheduled_time") is None,
        "schedulerDisabled": schedules() == [],
        "repairedVersionActive": version == REPAIRED_VERSION_ID,
        "devnetOnly": binding(bindings, "APP_NETWORK") == "devnet" and binding(bindings, "MAINNET_ENABLED") == "false",
        "maxLedgers32": binding(bindings, "FAST_LANE_MAX_LEDGERS_PER_RUN") == EXPECTED_MAX_LEDGERS,
        "noPendingSlot": slots["pending"] == 0,
        "noLiveUnstagedSlot": slots["liveUnstaged"] == 0,
        "noStagedSuccessorSlot": slots["stagedSuccessor"] == 0,
    }
    state = {"queuePaused": queue_paused(q), "metrics": metrics, "slot": slot, "fastLane": fast, "slots": slots, "deploymentVersion": version}
    digest = hashlib.sha256(json.dumps(state, separators=(",", ":"), sort_keys=True).encode()).hexdigest()
    return {"safeToRunExistingRetryProof": all(checks.values()), "checks": checks, "failures": [k for k,v in checks.items() if not v], "stateDigest": digest, "state": state}


def prepare() -> int:
    result = {"schemaVersion": 1, "mode": "prepare", "productionMutation": False, **capture()}
    save("result.json", result)
    print(json.dumps({"safeToRunExistingRetryProof": result["safeToRunExistingRetryProof"], "failures": result["failures"], "stateDigest": result["stateDigest"], "slot": result["state"]["slot"], "deploymentVersion": result["state"]["deploymentVersion"]}, sort_keys=True))
    return 0 if result["safeToRunExistingRetryProof"] else 1


def execute() -> int:
    authorized = os.environ.get("AUTHORIZED_STATE_DIGEST", "")
    result: dict[str, Any] = {"schemaVersion": 1, "mode": "execute", "productionMutation": False, "queueResumed": False, "queueRepaused": False, "seedMessageSent": False, "queuePurged": False, "passed": False, "failure": None}
    pre = None
    try:
        pre = capture()
        save("pre-state.json", pre)
        if not authorized or pre["stateDigest"] != authorized:
            raise RuntimeError("existing retry state digest changed after authorization")
        if not pre["safeToRunExistingRetryProof"]:
            raise RuntimeError(f"existing retry pre-state unsafe: {pre['failures']}")
        old_slot = pre["state"]["slot"]
        old_updated = old_slot.get("updated_at")
        pre_ledger = int(pre["state"]["fastLane"].get("last_processed_ledger") or 0)

        set_queue_paused(False)
        result["productionMutation"] = True
        result["queueResumed"] = True

        changed = None
        deadline = time.time() + START_TIMEOUT_SECONDS
        while time.time() < deadline:
            slot = exact_slot()
            if slot.get("updated_at") != old_updated:
                changed = slot
                set_queue_paused(True)
                result["queueRepaused"] = True
                break
            time.sleep(0.5)
        if changed is None:
            raise RuntimeError("existing retry message was not redelivered before timeout")

        terminal = changed
        deadline = time.time() + TERMINAL_TIMEOUT_SECONDS
        while time.time() < deadline and terminal.get("status") == "processing":
            time.sleep(1)
            terminal = exact_slot()
        save("terminal-slot.json", terminal)
        if terminal.get("status") != "completed":
            raise RuntimeError(f"existing retry slot did not complete: {terminal}")

        post = capture()
        save("post-state.json", post)
        post_ledger = int(post["state"]["fastLane"].get("last_processed_ledger") or 0)
        delta = post_ledger - pre_ledger
        result["ledgerDelta"] = delta
        result["terminalSlot"] = terminal
        result["postBacklog"] = post["state"]["metrics"]
        result["passed"] = 0 < delta <= 32 and result["queueRepaused"] and terminal.get("next_scheduled_time") is not None
        if not result["passed"]:
            raise RuntimeError("existing retry completed without bounded successor/ledger proof")
        return 0
    except Exception as exc:
        result["failure"] = repr(exc)
        return 1
    finally:
        if result["queueResumed"] and not result["queueRepaused"]:
            try:
                set_queue_paused(True)
                result["queueRepaused"] = True
            except Exception as pause_exc:
                result["pauseFailure"] = repr(pause_exc)
        save("result.json", result)
        print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    if len(os.sys.argv) != 2 or os.sys.argv[1] not in {"--prepare", "--execute"}:
        raise SystemExit("usage: current-repair-existing-retry-proof.py --prepare|--execute")
    raise SystemExit(prepare() if os.sys.argv[1] == "--prepare" else execute())
