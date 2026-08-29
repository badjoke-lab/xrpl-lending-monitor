#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
DATABASE_ID = os.environ.get("DATABASE_ID", "bebc2c68-03d2-4a1c-98a7-46b34ee4e25d")
PRODUCTION = os.environ.get("PRODUCTION_BASE", "https://xrpl-lending-monitor.badjoke-lab.workers.dev")
OUT = Path(os.environ.get("CURRENT_RESTART_PREFLIGHT_OUTPUT", "current-restart-preflight-evidence"))
OUT.mkdir(parents=True, exist_ok=True)

EXPECTED_ERROR_FRAGMENT = "too many subrequests by single worker invocation"
EXPECTED_MAX_LEDGERS = "32"
QUEUE_LEASE_SECONDS = 15 * 60

if not ACCOUNT_ID or not TOKEN:
    raise SystemExit("Cloudflare read credentials are required")


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def write_json(name: str, value: Any) -> None:
    (OUT / name).write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def request_json(url: str, payload: Any | None = None, headers: dict[str, str] | None = None) -> tuple[int, Any]:
    body = None if payload is None else json.dumps(payload).encode()
    merged = dict(headers or {})
    if payload is not None:
        merged.setdefault("Content-Type", "application/json")
    try:
        with urlopen(Request(url, data=body, headers=merged), timeout=75) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except HTTPError as exc:
        raw = exc.read()
        try:
            parsed = json.loads(raw) if raw else {"error": str(exc)}
        except Exception:
            parsed = {"error": str(exc)}
        return exc.code, parsed
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError(str(exc)) from exc


def d1_query(name: str, sql: str) -> list[dict[str, Any]]:
    status, payload = request_json(
        f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/d1/database/{DATABASE_ID}/query",
        {"sql": sql},
        {"Authorization": f"Bearer {TOKEN}"},
    )
    write_json(name, {"http": status, "payload": payload})
    if status != 200 or not isinstance(payload, dict) or payload.get("success") is not True:
        raise RuntimeError(f"D1 read failed: {name}: HTTP {status}")
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
        raise RuntimeError(f"Cloudflare read failed: {name}: HTTP {status}")
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


fast = one(d1_query(
    "fast-lane-state.json",
    "SELECT epoch_id,last_processed_ledger,last_processed_hash,latest_observed_ledger,latest_observed_hash,status,updated_at FROM fast_lane_shadow_state WHERE network='devnet'",
))
overlay = one(d1_query(
    "overlay-state.json",
    "SELECT epoch_id,base_snapshot_id,base_ledger_index,base_ledger_hash,overlay_ledger_index,overlay_ledger_hash,updated_at FROM current_state_overlay_state WHERE network='devnet' ORDER BY base_ledger_index DESC,updated_at DESC LIMIT 1",
))
base = one(d1_query(
    "base-binding.json",
    "SELECT network,shadow_epoch_id,base_epoch_id,base_snapshot_id,base_ledger_index,base_ledger_hash,bound_at FROM fast_lane_shadow_base_binding WHERE network='devnet'",
))
latest_metric = one(d1_query(
    "latest-metric.json",
    "SELECT run_at,status,start_ledger_index,end_ledger_index,latest_observed_ledger,lag_ledgers,ledgers_processed,error_message FROM fast_lane_shadow_run_metrics WHERE network='devnet' ORDER BY run_at DESC LIMIT 1",
))
slot_counts = d1_query(
    "queue-slot-counts.json",
    "SELECT status,COUNT(*) AS row_count FROM fast_lane_queue_slots GROUP BY status ORDER BY status",
)
processing_summary = one(d1_query(
    "processing-slot-summary.json",
    f"SELECT COALESCE(SUM(CASE WHEN status='processing' AND next_scheduled_time IS NULL AND unixepoch(updated_at) > unixepoch('now')-{QUEUE_LEASE_SECONDS} THEN 1 ELSE 0 END),0) AS live_unstaged, COALESCE(SUM(CASE WHEN status='processing' AND next_scheduled_time IS NULL AND unixepoch(updated_at) <= unixepoch('now')-{QUEUE_LEASE_SECONDS} THEN 1 ELSE 0 END),0) AS stale_reclaimable, COALESCE(SUM(CASE WHEN status='processing' AND next_scheduled_time IS NOT NULL THEN 1 ELSE 0 END),0) AS staged_successor FROM fast_lane_queue_slots",
))
latest_slots = d1_query(
    "latest-slots.json",
    "SELECT scheduled_time,status,started_at,completed_at,next_scheduled_time,error_message,updated_at FROM fast_lane_queue_slots ORDER BY updated_at DESC LIMIT 8",
)
compact = one(d1_query(
    "compact.json",
    "SELECT COUNT(*) AS row_count,COALESCE(SUM(LENGTH(projection_json)),0) AS payload_bytes,MIN(source_ledger_index) AS first_ledger,MAX(source_ledger_index) AS last_ledger FROM fast_lane_shadow_objects_compact WHERE network='devnet'",
))
foldable = one(d1_query(
    "foldable.json",
    "SELECT COUNT(*) AS row_count FROM fast_lane_shadow_objects_compact c WHERE c.network='devnet' AND EXISTS (SELECT 1 FROM fast_lane_shadow_base_binding b JOIN current_state_overlay_objects o ON o.network='devnet' AND o.epoch_id=b.base_epoch_id AND o.base_snapshot_id=b.base_snapshot_id AND o.object_type=c.object_type AND o.object_id=c.object_id WHERE b.network='devnet' AND (o.source_ledger_index>c.source_ledger_index OR (o.source_ledger_index=c.source_ledger_index AND o.source_transaction_index>=c.source_transaction_index)))",
))
stale = one(d1_query(
    "stale-overlay.json",
    "SELECT COUNT(*) AS row_count FROM current_state_overlay_objects o WHERE o.network='devnet' AND NOT EXISTS (SELECT 1 FROM fast_lane_shadow_base_binding b WHERE b.network=o.network AND b.base_epoch_id=o.epoch_id AND b.base_snapshot_id=o.base_snapshot_id)",
))
settings = cf_get("worker-settings.json", "/workers/scripts/xrpl-lending-monitor/settings")
deployments = cf_get("worker-deployments.json", "/workers/scripts/xrpl-lending-monitor/deployments")
schedules = cf_get("worker-schedules.json", "/workers/scripts/xrpl-lending-monitor/schedules")
overview = public_get("overview.json", "/api/overview")
replacement = public_get("replacement-base.json", "/api/status/replacement-base-rebase")

bindings = (settings.get("result") or {}).get("bindings") or []
queue_bindings = [item for item in bindings if item.get("type") == "queue"]
cron_schedules = (schedules.get("result") or {}).get("schedules") or []
deployment_list = (deployments.get("result") or {}).get("deployments") or []
latest_deployment = deployment_list[0] if deployment_list else {}
versions = latest_deployment.get("versions") or []

status_counts = {str(row.get("status")): int(row.get("row_count", 0)) for row in slot_counts}
pending_slots = status_counts.get("pending", 0)
live_unstaged = int(processing_summary.get("live_unstaged", -1))
stale_reclaimable = int(processing_summary.get("stale_reclaimable", -1))
staged_successor = int(processing_summary.get("staged_successor", -1))

base_aligned = (
    base.get("base_epoch_id") == overlay.get("epoch_id")
    and base.get("base_snapshot_id") == overlay.get("base_snapshot_id")
    and int(base.get("base_ledger_index", -1)) == int(overlay.get("base_ledger_index", -2))
    and str(base.get("base_ledger_hash", "")).upper() == str(overlay.get("base_ledger_hash", "")).upper()
)
fast_at_or_after_base = int(fast.get("last_processed_ledger", -1)) >= int(base.get("base_ledger_index", 10**18))
compact_within_fast_cursor = int(compact.get("last_ledger") or -1) <= int(fast.get("last_processed_ledger", -2))
latest_error = str(latest_metric.get("error_message") or "").lower()

checks = {
    "devnetOnly": binding(settings, "APP_NETWORK") == "devnet" and binding(settings, "MAINNET_ENABLED") == "false",
    "currentMaxLedgersBound": binding(settings, "FAST_LANE_MAX_LEDGERS_PER_RUN") == EXPECTED_MAX_LEDGERS,
    "singleQueueBinding": len(queue_bindings) == 1,
    "schedulerStillDisabled": len(cron_schedules) == 0,
    "singleDeploymentVersion": len(versions) == 1 and versions[0].get("percentage") == 100,
    "baseBindingAligned": base_aligned,
    "fastCursorAtOrAfterBase": fast_at_or_after_base,
    "noLiveUnstagedProcessingSlot": live_unstaged == 0,
    "noStagedSuccessorSlot": staged_successor == 0,
    "noPendingQueueSlot": pending_slots == 0,
    "staleOverlayZero": int(stale.get("row_count", -1)) == 0,
    "foldableCompactZero": int(foldable.get("row_count", -1)) == 0,
    "compactRowsDoNotExceedFastCursor": compact_within_fast_cursor,
    "expectedTerminalFailureRetained": latest_metric.get("status") == "error" and EXPECTED_ERROR_FRAGMENT in latest_error,
    "replacementBaseReplaySafe": replacement.get("http") == 200 and isinstance(replacement.get("payload"), dict) and replacement["payload"].get("status") == "replayed",
    "publicOverviewReachable": overview.get("http") == 200 and isinstance(overview.get("payload"), dict) and overview["payload"].get("network") == "devnet",
}

result = {
    "schemaVersion": 1,
    "checkedAt": now_utc(),
    "sourceCommit": os.environ.get("GITHUB_SHA"),
    "productionMutation": False,
    "safeToDeployRepair": all(checks.values()),
    "safeToRestart": False,
    "restartRequiresSeparateAuthorization": True,
    "checks": checks,
    "failures": [name for name, passed in checks.items() if not passed],
    "state": {
        "fastLane": fast,
        "overlay": overlay,
        "baseBinding": base,
        "latestMetric": latest_metric,
        "queueSlotCounts": status_counts,
        "processingSlots": {
            "liveUnstaged": live_unstaged,
            "staleReclaimable": stale_reclaimable,
            "stagedSuccessor": staged_successor,
            "leaseSeconds": QUEUE_LEASE_SECONDS,
        },
        "latestSlots": latest_slots,
        "compact": compact,
        "foldableCompactRows": int(foldable.get("row_count", -1)),
        "staleOverlayRows": int(stale.get("row_count", -1)),
        "deployment": latest_deployment,
        "appNetwork": binding(settings, "APP_NETWORK"),
        "mainnetEnabled": binding(settings, "MAINNET_ENABLED"),
        "maxLedgersPerRun": binding(settings, "FAST_LANE_MAX_LEDGERS_PER_RUN"),
        "queueBindings": queue_bindings,
        "schedules": cron_schedules,
        "overviewCurrentStateWatermark": (overview.get("payload") or {}).get("current_state_watermark") if isinstance(overview.get("payload"), dict) else None,
    },
}
write_json("result.json", result)

print(json.dumps({
    "safeToDeployRepair": result["safeToDeployRepair"],
    "safeToRestart": result["safeToRestart"],
    "failures": result["failures"],
    "fastLedger": fast.get("last_processed_ledger"),
    "compactRows": compact.get("row_count"),
    "liveProcessingSlots": live_unstaged,
    "staleReclaimableProcessingSlots": stale_reclaimable,
    "stagedSuccessorSlots": staged_successor,
    "pendingSlots": pending_slots,
}, sort_keys=True))

if not result["safeToDeployRepair"]:
    raise SystemExit(1)
