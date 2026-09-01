#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import urllib.request
from pathlib import Path
from typing import Any

ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
DATABASE_ID = os.environ.get("DATABASE_ID", "")
OUT = Path(os.environ.get(
    "CURRENT_REPAIR_QUEUE_DIAGNOSTICS_OUTPUT",
    "current-repair-queue-diagnostics-evidence",
))
API_BASE = "https://api.cloudflare.com/client/v4"
HEADERS = {
    "Authorization": f"Bearer {API_TOKEN}",
    "Content-Type": "application/json",
}

if not all((ACCOUNT_ID, API_TOKEN, DATABASE_ID)):
    raise SystemExit("Cloudflare credentials and D1 identity are required")

OUT.mkdir(parents=True, exist_ok=True)


def query(sql: str) -> dict[str, Any]:
    request = urllib.request.Request(
        f"{API_BASE}/accounts/{ACCOUNT_ID}/d1/database/{DATABASE_ID}/query",
        data=json.dumps({"sql": sql}, separators=(",", ":")).encode(),
        headers=HEADERS,
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.load(response)
    if payload.get("success") is not True:
        raise RuntimeError(payload.get("errors"))
    result = (payload.get("result") or [{}])[0]
    if result.get("success") is not True:
        raise RuntimeError(result.get("error") or "D1 query failed")
    return result


def rows(sql: str) -> list[dict[str, Any]]:
    return query(sql).get("results") or []


def first(sql: str) -> dict[str, Any]:
    values = rows(sql)
    return values[0] if values else {}


def try_rows(sql: str) -> dict[str, Any]:
    try:
        return {"supported": True, "rows": rows(sql), "error": None}
    except Exception as exc:  # noqa: BLE001
        return {"supported": False, "rows": [], "error": repr(exc)}


def main() -> int:
    result: dict[str, Any] = {
        "schemaVersion": 1,
        "mode": "read-only-d1-storage-diagnostics",
        "productionMutation": False,
        "databaseId": DATABASE_ID,
        "databaseSizeBytes": None,
        "pragmas": {},
        "tables": {},
    }

    size_probe = query("SELECT 1 AS ok")
    result["databaseSizeBytes"] = (size_probe.get("meta") or {}).get("size_after")

    for key, sql in {
        "pageCount": "PRAGMA page_count",
        "freelistCount": "PRAGMA freelist_count",
        "pageSize": "PRAGMA page_size",
    }.items():
        result["pragmas"][key] = try_rows(sql)

    for table in (
        "fast_lane_history_windows",
        "fast_lane_shadow_windows",
        "fast_lane_shadow_run_metrics",
        "fast_lane_shadow_objects_compact",
        "current_state_overlay_objects",
        "fast_lane_queue_slots",
    ):
        try:
            row = first(f'SELECT COUNT(*) AS row_count FROM "{table}"')
            result["tables"][table] = {
                "available": True,
                "rowCount": int(row.get("row_count") or 0),
                "error": None,
            }
        except Exception as exc:  # noqa: BLE001
            result["tables"][table] = {
                "available": False,
                "rowCount": None,
                "error": repr(exc),
            }

    for table in ("fast_lane_shadow_objects_compact", "current_state_overlay_objects"):
        entry = result["tables"].setdefault(table, {})
        try:
            row = first(
                f'SELECT COUNT(*) AS devnet_rows, '
                f'COALESCE(SUM(LENGTH(projection_json)),0) AS payload_bytes '
                f'FROM "{table}" WHERE network=\'devnet\''
            )
            entry["devnetRows"] = int(row.get("devnet_rows") or 0)
            entry["payloadBytes"] = int(row.get("payload_bytes") or 0)
        except Exception as exc:  # noqa: BLE001
            entry["payloadError"] = repr(exc)

    (OUT / "d1-storage.json").write_text(
        json.dumps(result, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
