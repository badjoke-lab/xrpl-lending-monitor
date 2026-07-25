#!/usr/bin/env python3
from __future__ import annotations

import base64
import gzip
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
DATABASE_ID = os.environ.get("DATABASE_ID", "bebc2c68-03d2-4a1c-98a7-46b34ee4e25d")
PRODUCTION = os.environ.get("PRODUCTION_BASE", "https://xrpl-lending-monitor.badjoke-lab.workers.dev")
MODE = os.environ.get("MODE", "probe")
START_MS_RAW = os.environ.get("START_MS", "")
ARM_EVIDENCE_DIR = Path(os.environ.get("ARM_EVIDENCE_DIR", "arm-evidence"))
FAIL_ON_UNHEALTHY = os.environ.get("FAIL_ON_UNHEALTHY", "true").lower() == "true"
OUT = Path(os.environ.get("EVIDENCE_DIR", "qualification-evidence"))
OUT.mkdir(parents=True, exist_ok=True)
SLOT_MS = 300_000
SEMANTIC_KEYS = ("protocolEvents", "objectChanges", "loanLifecycle", "archivedObjects", "balanceHistory")
HASH_RE = re.compile(r"^[A-Fa-f0-9]{64}$")
FIXED_OBJECT = {
    "transactionHash": "70A489701D68B89E04923A7845F81F2C615760992C55119A8FC0ED8C759DE684",
    "objectType": "Vault",
    "objectId": "AD0980A254BC7262C57001315A9B6C7C65A020F29FAB2D0A0915933C55FF3BB1",
    "action": "created",
    "transactionType": "VaultCreate",
}

if not ACCOUNT_ID or not TOKEN:
    raise SystemExit("Cloudflare read credentials are required")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def write_json(name: str, value: Any) -> None:
    (OUT / name).write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def request_json(url: str, payload: Any | None = None, headers: dict[str, str] | None = None, attempts: int = 5) -> tuple[int, Any]:
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            body = None if payload is None else json.dumps(payload).encode()
            merged = dict(headers or {})
            if payload is not None:
                merged.setdefault("Content-Type", "application/json")
            with urlopen(Request(url, data=body, headers=merged), timeout=75) as response:
                raw = response.read()
                return response.status, json.loads(raw) if raw else None
        except HTTPError as exc:
            last = exc
            try:
                raw = exc.read()
                parsed = json.loads(raw) if raw else {"error": str(exc)}
            except Exception:
                parsed = {"error": str(exc)}
            if attempt == attempts - 1:
                return exc.code, parsed
        except (URLError, TimeoutError, json.JSONDecodeError) as exc:
            last = exc
        time.sleep(1 + attempt * 2)
    raise RuntimeError(str(last))


def d1_query(name: str, sql: str) -> list[dict[str, Any]]:
    status, payload = request_json(
        f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/d1/database/{DATABASE_ID}/query",
        {"sql": sql},
        {"Authorization": f"Bearer {TOKEN}"},
    )
    write_json(name, {"http": status, "payload": payload})
    if status != 200 or not isinstance(payload, dict) or payload.get("success") is not True:
        raise RuntimeError(f"D1 query failed: {name}: HTTP {status}")
    result = (payload.get("result") or [{}])[0]
    if result.get("success") is not True:
        raise RuntimeError(f"D1 statement failed: {name}")
    return result.get("results") or []


def cf_get(name: str, path: str) -> Any:
    status, payload = request_json(
        f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}{path}",
        headers={"Authorization": f"Bearer {TOKEN}"},
    )
    write_json(name, {"http": status, "payload": payload})
    if status != 200 or not isinstance(payload, dict) or payload.get("success") is not True:
        raise RuntimeError(f"Cloudflare GET failed: {name}: HTTP {status}")
    return payload


def public_get(name: str, path: str) -> dict[str, Any]:
    status, payload = request_json(PRODUCTION + path)
    record = {"http": status, "payload": payload, "path": path}
    write_json(name, record)
    return record


def one(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return rows[0] if rows else {}


def binding(settings: dict[str, Any], name: str) -> Any:
    items = ((settings.get("result") or {}).get("bindings") or [])
    values = [item.get("text", item.get("value")) for item in items if item.get("name") == name]
    return values[0] if values else None


def capture_state(prefix: str) -> dict[str, Any]:
    fast = one(d1_query(f"{prefix}-fast.json", "SELECT epoch_id,last_processed_ledger,last_processed_hash,latest_observed_ledger,latest_observed_hash,status,(latest_observed_ledger-last_processed_ledger) AS lag_ledgers,updated_at FROM fast_lane_shadow_state WHERE network='devnet'"))
    overlay = one(d1_query(f"{prefix}-overlay.json", "SELECT epoch_id,base_snapshot_id,base_ledger_index,base_ledger_hash,overlay_ledger_index,overlay_ledger_hash,updated_at FROM current_state_overlay_state WHERE network='devnet' ORDER BY base_ledger_index DESC,updated_at DESC LIMIT 1"))
    base_binding = one(d1_query(f"{prefix}-base-binding.json", "SELECT * FROM fast_lane_shadow_base_binding WHERE network='devnet'"))
    metric = one(d1_query(f"{prefix}-metric.json", "SELECT network,run_at,status,start_ledger_index,end_ledger_index,latest_observed_ledger,lag_ledgers,ledgers_processed,persistence_rows_read,persistence_rows_written,error_message FROM fast_lane_shadow_run_metrics WHERE network='devnet' ORDER BY run_at DESC LIMIT 1"))
    slots = d1_query(f"{prefix}-slots.json", "SELECT scheduled_time,status,started_at,completed_at,next_scheduled_time,error_message,updated_at FROM fast_lane_queue_slots ORDER BY scheduled_time DESC LIMIT 12")
    compact = int(one(d1_query(f"{prefix}-compact.json", "SELECT COUNT(*) AS value FROM fast_lane_shadow_objects_compact WHERE network='devnet'")).get("value", -1))
    foldable = int(one(d1_query(f"{prefix}-foldable.json", "SELECT COUNT(*) AS value FROM fast_lane_shadow_objects_compact c WHERE c.network='devnet' AND EXISTS (SELECT 1 FROM fast_lane_shadow_base_binding b JOIN current_state_overlay_objects o ON o.network='devnet' AND o.epoch_id=b.base_epoch_id AND o.base_snapshot_id=b.base_snapshot_id AND o.object_type=c.object_type AND o.object_id=c.object_id WHERE b.network='devnet' AND (o.source_ledger_index>c.source_ledger_index OR (o.source_ledger_index=c.source_ledger_index AND o.source_transaction_index>=c.source_transaction_index)))")).get("value", -1))
    stale = int(one(d1_query(f"{prefix}-stale.json", "SELECT COUNT(*) AS value FROM current_state_overlay_objects o WHERE o.network='devnet' AND NOT EXISTS (SELECT 1 FROM fast_lane_shadow_base_binding b WHERE b.network=o.network AND b.base_epoch_id=o.epoch_id AND b.base_snapshot_id=o.base_snapshot_id)")).get("value", -1))
    queue_retention = one(d1_query(f"{prefix}-queue-retention.json", "SELECT COUNT(*) AS retained_queue_slots,MIN(scheduled_time) AS first_slot,MAX(scheduled_time) AS last_slot FROM fast_lane_queue_slots WHERE status='completed'"))
    metric_retention = one(d1_query(f"{prefix}-metric-retention.json", "SELECT COUNT(*) AS retained_metrics,MIN(run_at) AS first_metric,MAX(run_at) AS last_metric FROM fast_lane_shadow_run_metrics WHERE network='devnet'"))
    window_retention = one(d1_query(f"{prefix}-window-retention.json", "SELECT COUNT(*) AS retained_windows,MIN(start_ledger_index) AS first_ledger,MAX(end_ledger_index) AS last_ledger,COALESCE(SUM(LENGTH(bundle_json)),0) AS payload_bytes FROM fast_lane_history_windows WHERE network='devnet'"))
    deployments = cf_get(f"{prefix}-deployments.json", "/workers/scripts/xrpl-lending-monitor/deployments")
    settings = cf_get(f"{prefix}-settings.json", "/workers/scripts/xrpl-lending-monitor/settings")
    schedules = cf_get(f"{prefix}-schedules.json", "/workers/scripts/xrpl-lending-monitor/schedules")
    apis = {
        "overview": public_get(f"{prefix}-overview.json", "/api/overview"),
        "historySource": public_get(f"{prefix}-history-source.json", "/api/status/history-source"),
        "fastLaneDiff": public_get(f"{prefix}-fast-lane-diff.json", "/api/status/fast-lane-diff?limit=500"),
        "replacementBase": public_get(f"{prefix}-replacement-base.json", "/api/status/replacement-base-rebase"),
        "preSoakReadiness": public_get(f"{prefix}-pre-soak-readiness.json", "/api/status/pre-soak-readiness"),
    }
    dep_list = (deployments.get("result") or {}).get("deployments") or []
    latest_dep = dep_list[0] if dep_list else {}
    versions = latest_dep.get("versions") or []
    settings_bindings = (settings.get("result") or {}).get("bindings") or []
    state = {
        "checkedAt": now_utc().isoformat().replace("+00:00", "Z"),
        "fastLane": fast,
        "overlay": overlay,
        "baseBinding": base_binding,
        "latestMetric": metric,
        "recentSlots": slots,
        "compactRows": compact,
        "foldableRows": foldable,
        "staleRows": stale,
        "retention": {"queue": queue_retention, "metrics": metric_retention, "windows": window_retention},
        "deployment": latest_dep,
        "versionId": (versions[0].get("version_id") or versions[0].get("id")) if len(versions) == 1 else None,
        "appNetwork": binding(settings, "APP_NETWORK"),
        "mainnetEnabled": binding(settings, "MAINNET_ENABLED"),
        "maxLedgersPerRun": binding(settings, "FAST_LANE_MAX_LEDGERS_PER_RUN"),
        "queueBindings": [item for item in settings_bindings if item.get("type") == "queue"],
        "schedules": (schedules.get("result") or {}).get("schedules") or [],
        "apis": apis,
    }
    checks = {
        "fastHealthy": fast.get("status") == "healthy",
        "lagZero": int(fast.get("lag_ledgers", -1)) == 0,
        "metricCommitted": metric.get("status") == "committed" and metric.get("error_message") in (None, "") and int(metric.get("lag_ledgers", -1)) == 0,
        "fastCanonicalAligned": int(fast.get("last_processed_ledger", -1)) == int(overlay.get("overlay_ledger_index", -2)) and str(fast.get("last_processed_hash", "")).upper() == str(overlay.get("overlay_ledger_hash", "")).upper(),
        "activeBaseAligned": base_binding.get("base_epoch_id") == overlay.get("epoch_id") and base_binding.get("base_snapshot_id") == overlay.get("base_snapshot_id") and int(base_binding.get("base_ledger_index", -1)) == int(overlay.get("base_ledger_index", -2)) and str(base_binding.get("base_ledger_hash", "")).upper() == str(overlay.get("base_ledger_hash", "")).upper(),
        "latestThreeSlotsCompleted": len(slots) >= 3 and all(row.get("status") == "completed" and row.get("error_message") in (None, "") for row in slots[:3]),
        "compactZero": compact == 0,
        "foldableZero": foldable == 0,
        "staleZero": stale == 0,
        "devnetOnly": state["appNetwork"] == "devnet" and state["mainnetEnabled"] == "false",
        "maxLedgers96": state["maxLedgersPerRun"] == "96",
        "oneQueueBinding": len(state["queueBindings"]) == 1,
        "singleFiveMinuteCron": len(state["schedules"]) == 1 and state["schedules"][0].get("cron") == "*/5 * * * *",
        "singleVersion100Percent": len(versions) == 1 and versions[0].get("percentage") == 100,
        "publicApis200": all(item["http"] == 200 for item in apis.values()),
        "fastLaneDiffPassed": isinstance(apis["fastLaneDiff"]["payload"], dict) and apis["fastLaneDiff"]["payload"].get("passed") is True and ((apis["fastLaneDiff"]["payload"].get("sample") or {}).get("exactProjectionMismatches") == 0),
        "replacementBaseReplayed": isinstance(apis["replacementBase"]["payload"], dict) and apis["replacementBase"]["payload"].get("status") == "replayed",
        "historySourceOk": isinstance(apis["historySource"]["payload"], dict) and apis["historySource"]["payload"].get("status") == "ok",
    }
    state["checks"] = checks
    state["healthy"] = all(checks.values())
    state["failures"] = [name for name, passed in checks.items() if not passed]
    write_json(f"{prefix}-state.json", state)
    return state


def protected_boundaries(start: datetime, end: datetime) -> list[str]:
    cursor = start.replace(minute=0, second=0, microsecond=0)
    if cursor < start:
        cursor += timedelta(hours=1)
    found: list[str] = []
    while cursor <= end:
        if cursor.hour % 4 == 0:
            found.append(cursor.isoformat())
        cursor += timedelta(hours=1)
    return found


def require_start() -> tuple[int, int, datetime, datetime]:
    if not START_MS_RAW.isdigit():
        raise SystemExit("START_MS must be an integer millisecond timestamp")
    start_ms = int(START_MS_RAW)
    if start_ms % SLOT_MS != 0:
        raise SystemExit("START_MS must be aligned to a five-minute boundary")
    end_ms = start_ms + 11 * SLOT_MS
    start = datetime.fromtimestamp(start_ms / 1000, timezone.utc)
    end = datetime.fromtimestamp(end_ms / 1000, timezone.utc)
    return start_ms, end_ms, start, end


def identity_from_state(state: dict[str, Any]) -> dict[str, Any]:
    overlay = state.get("overlay") or {}
    return {
        "deploymentId": (state.get("deployment") or {}).get("id"),
        "versionId": state.get("versionId"),
        "deploymentCreatedOn": (state.get("deployment") or {}).get("created_on"),
        "appNetwork": state.get("appNetwork"),
        "mainnetEnabled": state.get("mainnetEnabled"),
        "maxLedgersPerRun": state.get("maxLedgersPerRun"),
        "queueBindings": state.get("queueBindings"),
        "schedules": state.get("schedules"),
        "baseBinding": state.get("baseBinding"),
        "overlayBase": {key: overlay.get(key) for key in ("epoch_id", "base_snapshot_id", "base_ledger_index", "base_ledger_hash")},
        "fastEpoch": (state.get("fastLane") or {}).get("epoch_id"),
        "historySource": ((state.get("apis") or {}).get("historySource") or {}).get("payload"),
    }


def rpc(method: str, params: dict[str, Any]) -> tuple[dict[str, Any], str]:
    errors: list[str] = []
    for endpoint in ("https://devnet.honeycluster.io/", "https://s.devnet.rippletest.net:51234/", "https://s.altnet.rippletest.net:51234/"):
        try:
            status, payload = request_json(endpoint, {"method": method, "params": [params]})
            result = (payload or {}).get("result") or {}
            if status == 200 and "error" not in result:
                return result, endpoint
            errors.append(f"{endpoint}:{status}:{result.get('error')}")
        except Exception as exc:
            errors.append(f"{endpoint}:{exc}")
    raise RuntimeError("; ".join(errors))


def contains_hash(value: Any, target: str) -> bool:
    if isinstance(value, str):
        return value.upper() == target
    if isinstance(value, list):
        return any(contains_hash(item, target) for item in value)
    if isinstance(value, dict):
        return any(contains_hash(item, target) for item in value.values())
    return False


def internal_hash(kind: str, record: dict[str, Any]) -> str | None:
    key = {"protocolEvents": "eventHash", "objectChanges": "transactionHash", "loanLifecycle": "transactionHash", "archivedObjects": "deletionTransactionHash", "balanceHistory": "transactionHash"}[kind]
    value = record.get(key)
    return value.upper() if isinstance(value, str) and HASH_RE.fullmatch(value) else None


def retained_candidate(kind: str) -> dict[str, Any]:
    if kind == "protocolEvents":
        _, payload = request_json(PRODUCTION + "/api/activity?limit=1")
        value = payload["data"][0]
        return {"eventHash": value["transaction_hash"], "eventType": value["transaction_type"]}
    if kind == "objectChanges":
        return dict(FIXED_OBJECT)
    if kind == "loanLifecycle":
        _, payload = request_json(PRODUCTION + "/api/audit/lifecycle?limit=1")
        value = payload["data"][0]
        return {"transactionHash": value["transaction_hash"], "loanId": value["loan_id"], "transactionType": value["transaction_type"]}
    if kind == "archivedObjects":
        _, payload = request_json(PRODUCTION + "/api/audit/archived?limit=1")
        value = payload["data"][0]
        return {"deletionTransactionHash": value["deletion_transaction_hash"], "objectType": value["object_type"], "objectId": value["object_id"]}
    _, payload = request_json(PRODUCTION + "/api/audit/cover-loss?limit=1")
    value = payload["data"][0]
    return {"transactionHash": value["transaction_hash"], "metricType": value["metric_type"], "subjectType": value["subject_type"], "subjectId": value["subject_id"], "assetKey": value.get("asset_key")}


def evaluate(start_ms: int, end_ms: int, start: datetime, end: datetime) -> dict[str, Any]:
    arm_path = ARM_EVIDENCE_DIR / "arm.json"
    if not arm_path.exists():
        raise SystemExit(f"missing arm evidence: {arm_path}")
    arm = json.loads(arm_path.read_text())
    if int(arm.get("startMs", -1)) != start_ms or int(arm.get("endMs", -1)) != end_ms:
        raise SystemExit("arm evidence window does not match evaluate window")
    if now_utc().timestamp() * 1000 < end_ms + 60_000:
        raise SystemExit("evaluation is too early; final slot has not had a completion allowance")

    expected = [start_ms + index * SLOT_MS for index in range(12)]
    slots = d1_query("slots.json", f"SELECT scheduled_time,message_id,status,started_at,completed_at,next_scheduled_time,error_message,updated_at FROM fast_lane_queue_slots WHERE scheduled_time BETWEEN {start_ms} AND {end_ms} ORDER BY scheduled_time")
    metric_rows = d1_query("slot-metrics.json", f"SELECT s.scheduled_time,s.started_at AS slot_started_at,s.completed_at AS slot_completed_at,m.run_at,m.status AS metric_status,m.start_ledger_index,m.end_ledger_index,m.latest_observed_ledger,m.lag_ledgers,m.ledgers_processed,m.persistence_rows_read,m.persistence_rows_written,m.error_message AS metric_error FROM fast_lane_queue_slots s LEFT JOIN fast_lane_shadow_run_metrics m ON m.network='devnet' AND m.run_at>=s.started_at AND m.run_at<=s.completed_at WHERE s.scheduled_time BETWEEN {start_ms} AND {end_ms} ORDER BY s.scheduled_time,m.run_at")
    windows = d1_query("slot-windows.json", f"SELECT s.scheduled_time,s.started_at AS slot_started_at,s.completed_at AS slot_completed_at,h.start_ledger_index,h.end_ledger_index,h.end_ledger_hash,h.created_at,LENGTH(h.bundle_json) AS encoded_bytes,h.bundle_json FROM fast_lane_queue_slots s JOIN fast_lane_history_windows h ON h.network='devnet' AND h.created_at>=s.started_at AND h.created_at<=s.completed_at WHERE s.scheduled_time BETWEEN {start_ms} AND {end_ms} ORDER BY h.start_ledger_index,h.end_ledger_index,h.created_at")
    final = capture_state("final")

    slot_times = [int(row.get("scheduled_time", -1)) for row in slots]
    slots_completed = slot_times == expected and len(slots) == 12 and all(row.get("status") == "completed" and row.get("started_at") and row.get("completed_at") and row.get("error_message") in (None, "") for row in slots)

    grouped: dict[int, list[dict[str, Any]]] = {slot: [] for slot in expected}
    for row in metric_rows:
        slot = int(row.get("scheduled_time", -1))
        if slot in grouped and row.get("run_at"):
            grouped[slot].append(row)
    metric_errors: list[dict[str, Any]] = []
    slot_resource: list[dict[str, Any]] = []
    accepted_start: int | None = None
    accepted_end: int | None = None
    for slot in expected:
        group = sorted(grouped[slot], key=lambda row: row["run_at"])
        if not group:
            metric_errors.append({"slot": slot, "reason": "missing_metrics"})
            continue
        if any(row.get("metric_status") != "committed" or row.get("metric_error") not in (None, "") for row in group):
            metric_errors.append({"slot": slot, "reason": "non_committed_or_error"})
        terminal = group[-1]
        if int(terminal.get("lag_ledgers", -1)) != 0:
            metric_errors.append({"slot": slot, "reason": "terminal_lag_nonzero", "lag": terminal.get("lag_ledgers")})
        starts = [int(row["start_ledger_index"]) for row in group if row.get("start_ledger_index") is not None]
        ends = [int(row["end_ledger_index"]) for row in group if row.get("end_ledger_index") is not None]
        if starts:
            accepted_start = min(starts) if accepted_start is None else min(accepted_start, min(starts))
        if ends:
            accepted_end = max(ends) if accepted_end is None else max(accepted_end, max(ends))
        slot_resource.append({"slot": slot, "metricCount": len(group), "rowsRead": sum(int(row.get("persistence_rows_read") or 0) for row in group), "rowsWritten": sum(int(row.get("persistence_rows_written") or 0) for row in group), "terminalLag": int(terminal.get("lag_ledgers", -1))})
    metrics_ok = not metric_errors

    decoded: list[dict[str, Any]] = []
    bundles: list[dict[str, Any]] = []
    decode_errors: list[dict[str, Any]] = []
    totals = {key: 0 for key in SEMANTIC_KEYS}
    max_encoded = 0
    for row in windows:
        window_start = int(row["start_ledger_index"])
        window_end = int(row["end_ledger_index"])
        max_encoded = max(max_encoded, int(row.get("encoded_bytes") or 0))
        try:
            raw = row["bundle_json"]
            if not isinstance(raw, str) or not raw.startswith("gzip-base64-v1:"):
                raise ValueError("unexpected_encoding")
            bundle = json.loads(gzip.decompress(base64.b64decode(raw.split(":", 1)[1])))
            if bundle.get("schemaVersion") != 1:
                raise ValueError("invalid_schema_version")
            counts: dict[str, int] = {}
            for key in SEMANTIC_KEYS:
                records = bundle.get(key)
                if not isinstance(records, list):
                    raise ValueError(f"missing_array:{key}")
                counts[key] = len(records)
                totals[key] += len(records)
            if int(bundle.get("startLedgerIndex", -1)) != window_start or int(bundle.get("endLedgerIndex", -1)) != window_end:
                raise ValueError("bundle_window_identity_mismatch")
            if str(bundle.get("endLedgerHash", "")).upper() != str(row.get("end_ledger_hash", "")).upper():
                raise ValueError("bundle_end_hash_mismatch")
            bundles.append(bundle)
            decoded.append({"slot": int(row["scheduled_time"]), "startLedgerIndex": window_start, "endLedgerIndex": window_end, "endLedgerHash": str(row["end_ledger_hash"]).upper(), "encodedBytes": int(row.get("encoded_bytes") or 0), "counts": counts})
        except Exception as exc:
            decode_errors.append({"startLedgerIndex": window_start, "endLedgerIndex": window_end, "error": str(exc)})
    decoded.sort(key=lambda row: (row["startLedgerIndex"], row["endLedgerIndex"]))
    bundles.sort(key=lambda row: (int(row["startLedgerIndex"]), int(row["endLedgerIndex"])))
    coverage_ok = bool(decoded) and not decode_errors and len(decoded) == len(windows)
    for previous, current in zip(decoded, decoded[1:]):
        if current["startLedgerIndex"] != previous["endLedgerIndex"] + 1:
            coverage_ok = False
    if accepted_start is None or accepted_end is None:
        coverage_ok = False
    elif decoded:
        coverage_ok = coverage_ok and decoded[0]["startLedgerIndex"] == accepted_start and decoded[-1]["endLedgerIndex"] == accepted_end

    ledger_checks: list[dict[str, Any]] = []
    hash_continuity_ok = coverage_ok
    if coverage_ok:
        try:
            for index, row in enumerate(decoded):
                result, endpoint = rpc("ledger", {"ledger_index": row["endLedgerIndex"], "transactions": False, "expand": False})
                obj = result.get("ledger") or {}
                ledger_hash = str(result.get("ledger_hash") or obj.get("hash") or "").upper()
                end_match = bool(result.get("validated")) and ledger_hash == row["endLedgerHash"]
                parent_match = True
                if index:
                    start_result, start_endpoint = rpc("ledger", {"ledger_index": row["startLedgerIndex"], "transactions": False, "expand": False})
                    start_obj = start_result.get("ledger") or {}
                    parent_match = bool(start_result.get("validated")) and str(start_obj.get("parent_hash") or "").upper() == decoded[index - 1]["endLedgerHash"]
                else:
                    start_endpoint = None
                ledger_checks.append({"startLedgerIndex": row["startLedgerIndex"], "endLedgerIndex": row["endLedgerIndex"], "endHashMatch": end_match, "parentHashMatch": parent_match, "endpoint": endpoint, "startEndpoint": start_endpoint})
                if not end_match or not parent_match:
                    hash_continuity_ok = False
        except Exception as exc:
            hash_continuity_ok = False
            ledger_checks.append({"error": str(exc)})

    class_records = {key: [] for key in SEMANTIC_KEYS}
    for bundle in bundles:
        for key in SEMANTIC_KEYS:
            class_records[key].extend(bundle[key])
    witnesses: dict[str, Any] = {}
    witnesses_ok = True
    for kind in SEMANTIC_KEYS:
        source = "window"
        record = None
        for candidate in class_records[kind]:
            if internal_hash(kind, candidate) and (kind != "objectChanges" or (candidate.get("objectType") in ("Vault", "LoanBroker", "Loan") and candidate.get("objectId"))):
                record = candidate
                break
        if record is None:
            source = "retained"
            try:
                record = retained_candidate(kind)
            except Exception as exc:
                witnesses[kind] = {"observedWindowCount": totals[kind], "source": source, "passed": False, "error": str(exc)}
                witnesses_ok = False
                continue
        hash_value = internal_hash(kind, record)
        witness: dict[str, Any] = {"observedWindowCount": totals[kind], "source": source, "hash": hash_value, "record": record}
        if not hash_value:
            witness.update({"passed": False, "reason": "invalid_hash"})
            witnesses[kind] = witness
            witnesses_ok = False
            continue
        try:
            if kind == "protocolEvents":
                path = f"/api/transactions/{hash_value}"
            elif kind == "objectChanges":
                path = f"/api/objects/{quote(str(record['objectType']))}/{quote(str(record['objectId']))}/history?limit=100"
            elif kind == "loanLifecycle":
                path = f"/api/loans/{quote(str(record['loanId']))}/lifecycle?limit=100"
            elif kind == "archivedObjects":
                path = f"/api/audit/archived/{quote(str(record['objectType']))}/{quote(str(record['objectId']))}"
            else:
                params = {"metric_type": record.get("metricType"), "subject_type": record.get("subjectType"), "subject_id": record.get("subjectId"), "asset_key": record.get("assetKey"), "limit": "100"}
                path = "/api/audit/cover-loss?" + urlencode({key: value for key, value in params.items() if value not in (None, "")})
            status, public = request_json(PRODUCTION + path)
            public_match = status == 200 and contains_hash(public, hash_value)
            tx, endpoint = rpc("tx", {"transaction": hash_value, "binary": False})
            returned = str(tx.get("hash") or (tx.get("tx_json") or {}).get("hash") or "").upper()
            source_match = bool(tx.get("validated")) and returned == hash_value
            transaction_type_match = True
            affected_match = True
            if kind == "protocolEvents":
                tx_json = tx.get("tx_json") or tx
                transaction_type_match = tx_json.get("TransactionType") == record.get("eventType")
            if kind == "objectChanges":
                nodes = (tx.get("meta") or tx.get("metaData") or {}).get("AffectedNodes") or []
                expected_node = {"created": "CreatedNode", "modified": "ModifiedNode", "deleted": "DeletedNode"}.get(record.get("action"))
                affected_match = any(isinstance(wrapper, dict) and isinstance(wrapper.get(expected_node), dict) and str(wrapper[expected_node].get("LedgerIndex", "")).upper() == str(record.get("objectId", "")).upper() and wrapper[expected_node].get("LedgerEntryType") == record.get("objectType") for wrapper in nodes) if expected_node else False
            witness.update({"path": path, "publicHttp": status, "publicMatch": public_match, "sourceValidated": source_match, "rpcEndpoint": endpoint, "transactionTypeMatch": transaction_type_match, "affectedNodeMatch": affected_match, "passed": public_match and source_match and transaction_type_match and affected_match})
        except Exception as exc:
            witness.update({"passed": False, "error": str(exc)})
        if not witness.get("passed"):
            witnesses_ok = False
        witnesses[kind] = witness

    pre_identity = arm["identity"]
    post_identity = identity_from_state(final)
    stable_overlay_keys = ("epoch_id", "base_snapshot_id", "base_ledger_index", "base_ledger_hash")
    identity_checks = {
        "deploymentId": pre_identity.get("deploymentId") == post_identity.get("deploymentId"),
        "versionId": pre_identity.get("versionId") == post_identity.get("versionId"),
        "baseBinding": pre_identity.get("baseBinding") == post_identity.get("baseBinding"),
        "overlayBase": all((pre_identity.get("overlayBase") or {}).get(key) == (post_identity.get("overlayBase") or {}).get(key) for key in stable_overlay_keys),
        "fastEpoch": pre_identity.get("fastEpoch") == post_identity.get("fastEpoch"),
        "historySource": pre_identity.get("historySource") == post_identity.get("historySource"),
        "appNetwork": post_identity.get("appNetwork") == "devnet",
        "mainnetDisabled": post_identity.get("mainnetEnabled") == "false",
        "maxLedgers": post_identity.get("maxLedgersPerRun") == "96",
        "oneQueueBinding": len(post_identity.get("queueBindings") or []) == 1,
        "oneCron": len(post_identity.get("schedules") or []) == 1 and post_identity["schedules"][0].get("cron") == "*/5 * * * *",
    }
    identity_ok = all(identity_checks.values())
    max_writes = max((row["rowsWritten"] for row in slot_resource), default=-1)
    total_writes = sum(row["rowsWritten"] for row in slot_resource)
    total_reads = sum(row["rowsRead"] for row in slot_resource)
    resource = {"perSlot": slot_resource, "maxWritesPerSlot": max_writes, "projectedDailyRowsWritten": total_writes * 24, "projectedDailyRowsRead": total_reads * 24, "maxEncodedBytes": max_encoded}
    resource["passed"] = max_writes <= 300 and resource["projectedDailyRowsWritten"] < 100000 and resource["projectedDailyRowsRead"] < 4000000 and max_encoded <= 131072
    retention = final["retention"]
    retention_ok = int((retention.get("queue") or {}).get("retained_queue_slots", 0)) >= 288 and int((retention.get("metrics") or {}).get("retained_metrics", 0)) >= 288 and isinstance(post_identity.get("historySource"), dict) and post_identity["historySource"].get("status") == "ok"
    final_fast = final["fastLane"]
    final_overlay = final["overlay"]
    final_alignment = int(final_fast.get("last_processed_ledger", -1)) == int(final_overlay.get("overlay_ledger_index", -2)) and str(final_fast.get("last_processed_hash", "")).upper() == str(final_overlay.get("overlay_ledger_hash", "")).upper() and int(final_fast.get("lag_ledgers", -1)) == 0 and final_fast.get("status") == "healthy"
    api_http_ok = all(item["http"] == 200 for item in final["apis"].values())
    boundaries = protected_boundaries(start, end)
    checks = {
        "exact12CompletedQueueSlots": slots_completed,
        "metricsExactlyAttributedCommittedTerminalLagZero": metrics_ok,
        "ledgerWindowCoverageExact": coverage_ok,
        "ledgerHashAndParentContinuity": hash_continuity_ok,
        "allBundlesDecodedWithFiveSemanticArrays": bool(decoded) and not decode_errors,
        "semanticOccurrenceOrZeroAndRetainedWitnessesVerified": witnesses_ok,
        "fastLaneCanonicalFinalAlignment": final_alignment,
        "compactZero": final["compactRows"] == 0,
        "foldableCompactZero": final["foldableRows"] == 0,
        "staleZero": final["staleRows"] == 0,
        "deploymentBaseEpochPublicationIdentityStable": identity_ok,
        "resourceEnvelope": resource["passed"],
        "retentionFor24HourAudit": retention_ok,
        "publicStatusApis": api_http_ok,
        "protectedCollectorBoundaryRule": len(boundaries) == 0,
    }
    passed = all(checks.values())
    summary = {
        "checkedAt": now_utc().isoformat().replace("+00:00", "Z"),
        "status": "passed" if passed else "failed",
        "passed": passed,
        "fixedWindow": {"startMs": start_ms, "endMs": end_ms, "startUtc": start.isoformat(), "endUtc": end.isoformat(), "expectedSlots": 12, "spacingMs": SLOT_MS},
        "checks": checks,
        "failures": [key for key, value in checks.items() if not value],
        "slots": slots,
        "metricErrors": metric_errors,
        "metricsBySlot": slot_resource,
        "history": {"windowCount": len(windows), "decodedWindowCount": len(decoded), "acceptedStartLedger": accepted_start, "acceptedEndLedger": accepted_end, "coverageFirstLedger": decoded[0]["startLedgerIndex"] if decoded else None, "coverageLastLedger": decoded[-1]["endLedgerIndex"] if decoded else None, "semanticTotals": totals, "maxEncodedBytes": max_encoded, "decodeErrors": decode_errors, "ledgerContinuity": ledger_checks},
        "semanticWitnesses": witnesses,
        "preIdentity": pre_identity,
        "postIdentity": post_identity,
        "identityChecks": identity_checks,
        "finalState": final,
        "resource": resource,
        "retention": retention,
        "protectedCollectorBoundariesInWindow": boundaries,
        "qualificationScope": {"releaseCertification": False, "note": "A pass qualifies only this 12-slot pre-soak window; it does not certify the later 24-hour soak or Mainnet."},
    }
    write_json("qualification-result.json", summary)
    return summary


if MODE == "probe":
    state = capture_state("probe")
    write_json("result.json", state)
    print(json.dumps({"mode": MODE, "healthy": state["healthy"], "failures": state["failures"], "ledger": (state.get("fastLane") or {}).get("last_processed_ledger")}))
    if not state["healthy"] and FAIL_ON_UNHEALTHY:
        raise SystemExit(1)
elif MODE == "arm":
    start_ms, end_ms, start, end = require_start()
    if start < now_utc() + timedelta(minutes=2):
        raise SystemExit("arm start must be at least two minutes in the future")
    boundaries = protected_boundaries(start, end)
    if boundaries:
        raise SystemExit(f"qualification window crosses a protected four-hour boundary: {boundaries}")
    state = capture_state("arm")
    if not state["healthy"]:
        raise SystemExit(f"production is not healthy: {state['failures']}")
    arm = {"schemaVersion": 1, "armedAt": now_utc().isoformat().replace("+00:00", "Z"), "startMs": start_ms, "endMs": end_ms, "startUtc": start.isoformat(), "endUtc": end.isoformat(), "identity": identity_from_state(state), "healthChecks": state["checks"], "productionState": state}
    write_json("arm.json", arm)
    print(json.dumps({"mode": MODE, "armed": True, "startMs": start_ms, "endMs": end_ms, "deploymentId": arm["identity"]["deploymentId"]}))
elif MODE == "evaluate":
    start_ms, end_ms, start, end = require_start()
    summary = evaluate(start_ms, end_ms, start, end)
    print(json.dumps({"mode": MODE, "passed": summary["passed"], "failures": summary["failures"]}))
    if not summary["passed"]:
        raise SystemExit(1)
else:
    raise SystemExit(f"unsupported MODE: {MODE}")
