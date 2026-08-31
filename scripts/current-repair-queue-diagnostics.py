#!/usr/bin/env python3
from __future__ import annotations

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
OUT = Path(os.environ.get(
    "CURRENT_REPAIR_QUEUE_DIAGNOSTICS_OUTPUT",
    "current-repair-queue-diagnostics-evidence",
))
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
    (OUT / name).write_text(
        json.dumps(value, indent=2, sort_keys=True, default=str) + "\n",
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


def quoted_identifier(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def main() -> int:
    result: dict[str, Any] = {
        "schemaVersion": 2,
        "mode": "read-only-diagnostics",
        "productionMutation": False,
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "passed": False,
        "failure": None,
    }
    try:
        queue = api("GET", f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}")["result"]
        metrics_raw = api(
            "GET",
            f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}/metrics",
        )["result"]
        consumer_list_raw = api(
            "GET",
            f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}/consumers",
        )["result"]
        if not isinstance(consumer_list_raw, list):
            raise RuntimeError("Queue consumer list response is invalid")

        list_consumer = (
            normalized_consumer(consumer_list_raw[0])
            if len(consumer_list_raw) == 1
            else {}
        )
        detail_consumer: dict[str, Any] = {}
        detail_error: str | None = None
        consumer_id = list_consumer.get("consumerId")
        if len(consumer_list_raw) == 1 and consumer_id:
            try:
                detail_raw = api(
                    "GET",
                    f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}/consumers/{consumer_id}",
                )["result"]
                if not isinstance(detail_raw, dict):
                    raise RuntimeError("Queue consumer detail response is invalid")
                detail_consumer = normalized_consumer(detail_raw)
            except Exception as exc:  # noqa: BLE001
                detail_error = repr(exc)
        elif len(consumer_list_raw) == 1:
            detail_error = "single Queue consumer has no consumer_id"

        schema_rows = d1_query("PRAGMA table_info(fast_lane_queue_slots)")
        schema_columns = [
            str(row.get("name"))
            for row in schema_rows
            if isinstance(row.get("name"), str) and row.get("name")
        ]
        required_columns = {"status", "next_scheduled_time", "updated_at"}
        if not required_columns.issubset(schema_columns):
            raise RuntimeError(
                "fast_lane_queue_slots is missing required diagnostic columns: "
                + repr(sorted(required_columns - set(schema_columns)))
            )

        stale_where = (
            "status='processing' AND next_scheduled_time IS NULL "
            f"AND unixepoch(updated_at) <= unixepoch('now')-{QUEUE_LEASE_SECONDS}"
        )
        slot_counts = one(d1_query(
            "SELECT "
            "COUNT(*) AS total, "
            "COALESCE(SUM(CASE WHEN status='processing' AND next_scheduled_time IS NULL "
            f"AND unixepoch(updated_at) > unixepoch('now')-{QUEUE_LEASE_SECONDS} THEN 1 ELSE 0 END),0) AS live_unstaged, "
            "COALESCE(SUM(CASE WHEN " + stale_where + " THEN 1 ELSE 0 END),0) AS stale_reclaimable, "
            "COALESCE(SUM(CASE WHEN status='processing' AND next_scheduled_time IS NOT NULL THEN 1 ELSE 0 END),0) AS staged_successor "
            "FROM fast_lane_queue_slots"
        ))
        stale_span = one(d1_query(
            "SELECT COUNT(*) AS count, MIN(updated_at) AS oldest_updated_at, "
            "MAX(updated_at) AS newest_updated_at "
            "FROM fast_lane_queue_slots WHERE " + stale_where
        ))
        status_counts = d1_query(
            "SELECT status, COUNT(*) AS count FROM fast_lane_queue_slots "
            "GROUP BY status ORDER BY status"
        )

        sample_columns = ", ".join(quoted_identifier(name) for name in schema_columns)
        oldest_sample = d1_query(
            "SELECT " + sample_columns + " FROM fast_lane_queue_slots WHERE "
            + stale_where
            + " ORDER BY unixepoch(updated_at) ASC LIMIT 5"
        )
        newest_sample = d1_query(
            "SELECT " + sample_columns + " FROM fast_lane_queue_slots WHERE "
            + stale_where
            + " ORDER BY unixepoch(updated_at) DESC LIMIT 5"
        )

        stale_run_evidence: dict[str, Any] = {
            "runIdColumnPresent": "run_id" in schema_columns,
            "distinctRunIdCount": None,
            "missingRunIdCount": None,
            "boundedRunIds": [],
            "relationTableCandidates": [],
        }
        if "run_id" in schema_columns:
            run_counts = one(d1_query(
                "SELECT COUNT(DISTINCT CASE WHEN run_id IS NOT NULL AND trim(run_id)<>'' "
                "THEN run_id END) AS distinct_run_ids, "
                "COALESCE(SUM(CASE WHEN run_id IS NULL OR trim(run_id)='' THEN 1 ELSE 0 END),0) "
                "AS missing_run_ids FROM fast_lane_queue_slots WHERE " + stale_where
            ))
            bounded_run_ids = d1_query(
                "SELECT run_id, COUNT(*) AS slot_count, MIN(updated_at) AS oldest_updated_at, "
                "MAX(updated_at) AS newest_updated_at "
                "FROM fast_lane_queue_slots WHERE " + stale_where
                + " AND run_id IS NOT NULL AND trim(run_id)<>'' "
                "GROUP BY run_id ORDER BY unixepoch(MAX(updated_at)) DESC, run_id LIMIT 25"
            )
            stale_run_evidence.update({
                "distinctRunIdCount": int(run_counts.get("distinct_run_ids", 0)),
                "missingRunIdCount": int(run_counts.get("missing_run_ids", 0)),
                "boundedRunIds": bounded_run_ids,
            })

        relation_table_candidates = d1_query(
            "SELECT name, sql FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%' "
            "AND (lower(name) LIKE '%run%' OR lower(name) LIKE '%fast_lane%' "
            "OR lower(name) LIKE '%queue%') ORDER BY name LIMIT 50"
        )
        stale_run_evidence["relationTableCandidates"] = relation_table_candidates

        fast_lane = one(d1_query(
            "SELECT last_processed_ledger, latest_observed_ledger, updated_at "
            "FROM fast_lane_shadow_state WHERE network='devnet'"
        ))

        queue_settings = queue.get("settings") if isinstance(queue.get("settings"), dict) else {}
        result.update({
            "passed": detail_error is None and len(consumer_list_raw) == 1,
            "queue": {
                "id": QUEUE_ID,
                "name": queue.get("queue_name"),
                "deliveryPaused": queue_settings.get("delivery_paused"),
                "metrics": {
                    "backlogCount": int(metrics_raw.get("backlog_count") or 0),
                    "backlogBytes": int(metrics_raw.get("backlog_bytes") or 0),
                    "oldestMessageTimestampMs": int(metrics_raw.get("oldest_message_timestamp_ms") or 0),
                },
            },
            "consumer": {
                "count": len(consumer_list_raw),
                "list": list_consumer,
                "detail": detail_consumer,
                "detailError": detail_error,
                "identityMatchesExpectedWorker": (
                    len(consumer_list_raw) == 1
                    and detail_error is None
                    and detail_consumer.get("type") == "worker"
                    and detail_consumer.get("scriptName") == SCRIPT_NAME
                ),
            },
            "slots": {
                "leaseSeconds": QUEUE_LEASE_SECONDS,
                "schemaColumns": schema_columns,
                "total": int(slot_counts.get("total", -1)),
                "liveUnstaged": int(slot_counts.get("live_unstaged", -1)),
                "staleReclaimable": int(slot_counts.get("stale_reclaimable", -1)),
                "stagedSuccessor": int(slot_counts.get("staged_successor", -1)),
                "statusCounts": status_counts,
                "staleSpan": {
                    "count": int(stale_span.get("count", -1)),
                    "oldestUpdatedAt": stale_span.get("oldest_updated_at"),
                    "newestUpdatedAt": stale_span.get("newest_updated_at"),
                },
                "oldestStaleSample": oldest_sample,
                "newestStaleSample": newest_sample,
                "staleRunEvidence": stale_run_evidence,
            },
            "fastLane": {
                "lastProcessedLedger": int(fast_lane.get("last_processed_ledger", 0)),
                "latestObservedLedger": int(fast_lane.get("latest_observed_ledger", 0)),
                "updatedAt": fast_lane.get("updated_at"),
            },
        })
    except Exception as exc:  # noqa: BLE001
        result["failure"] = repr(exc)
    finally:
        save("result.json", result)
        print(json.dumps({
            "passed": result["passed"],
            "failure": result["failure"],
            "consumerCount": result.get("consumer", {}).get("count"),
            "listScriptName": result.get("consumer", {}).get("list", {}).get("scriptName"),
            "detailScriptName": result.get("consumer", {}).get("detail", {}).get("scriptName"),
            "consumerIdentityMatchesExpectedWorker": result.get("consumer", {}).get("identityMatchesExpectedWorker"),
            "staleReclaimable": result.get("slots", {}).get("staleReclaimable"),
            "staleDistinctRunIds": result.get("slots", {}).get("staleRunEvidence", {}).get("distinctRunIdCount"),
            "staleMissingRunIds": result.get("slots", {}).get("staleRunEvidence", {}).get("missingRunIdCount"),
            "oldestStaleUpdatedAt": result.get("slots", {}).get("staleSpan", {}).get("oldestUpdatedAt"),
            "newestStaleUpdatedAt": result.get("slots", {}).get("staleSpan", {}).get("newestUpdatedAt"),
        }, sort_keys=True))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
