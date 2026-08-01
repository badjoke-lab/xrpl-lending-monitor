#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
from typing import Any, Callable

EVIDENCE = Path("continuous-catch-up-evidence")
EVIDENCE.mkdir(exist_ok=True)

ACCOUNT_ID = os.environ["CLOUDFLARE_ACCOUNT_ID"]
API_TOKEN = os.environ["CLOUDFLARE_API_TOKEN"]
SCRIPT_NAME = os.environ["SCRIPT_NAME"]
QUEUE_ID = os.environ["QUEUE_ID"]
DATABASE_ID = os.environ["DATABASE_ID"]
DATABASE_NAME = os.environ["DATABASE_NAME"]
RUNTIME_SHA = os.environ["RUNTIME_SHA"]
API_BASE = "https://api.cloudflare.com/client/v4"
HEADERS = {
    "Authorization": f"Bearer {API_TOKEN}",
    "Content-Type": "application/json",
}

EMPTY_METRICS = {
    "backlog_count": 0,
    "backlog_bytes": 0,
    "oldest_message_timestamp_ms": 0,
}


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def save(name: str, value: Any) -> Any:
    (EVIDENCE / name).write_text(
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


def d1(sql: str) -> list[dict[str, Any]]:
    result = api(
        "POST",
        f"/accounts/{ACCOUNT_ID}/d1/database/{DATABASE_ID}/query",
        {"sql": sql},
    )
    query = result["result"][0]
    if query.get("success") is not True:
        raise RuntimeError(result)
    return query.get("results", [])


def sql_quote(value: str) -> str:
    return value.replace("'", "''")


def queue_state() -> dict[str, Any]:
    return api("GET", f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}")["result"]


def queue_paused() -> bool:
    return queue_state().get("settings", {}).get("delivery_paused") is True


def pause_queue() -> None:
    api(
        "PATCH",
        f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}/settings",
        {"delivery_paused": True},
    )
    if not queue_paused():
        raise RuntimeError("Queue did not pause")


def resume_queue() -> None:
    api(
        "PATCH",
        f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}/settings",
        {"delivery_paused": False},
    )
    if queue_paused():
        raise RuntimeError("Queue did not resume")


def queue_metrics() -> dict[str, int]:
    result = api("GET", f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}/metrics")["result"]
    return {
        "backlog_count": int(result.get("backlog_count") or 0),
        "backlog_bytes": int(result.get("backlog_bytes") or 0),
        "oldest_message_timestamp_ms": int(result.get("oldest_message_timestamp_ms") or 0),
    }


def wait_for_metrics(
    predicate: Callable[[dict[str, int]], bool],
    description: str,
    attempts: int = 60,
) -> dict[str, int]:
    latest: dict[str, int] = {}
    for _ in range(attempts):
        latest = queue_metrics()
        if predicate(latest):
            return latest
        time.sleep(2)
    raise RuntimeError(f"Queue metrics did not reach {description}: {latest}")


def purge_queue(prefix: str) -> dict[str, int]:
    api(
        "POST",
        f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}/purge",
        {"delete_messages_permanently": True},
    )
    purge_status: dict[str, Any] | None = None
    for _ in range(90):
        purge_status = api(
            "GET",
            f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}/purge",
        )["result"]
        if purge_status.get("complete") is True:
            break
        time.sleep(2)
    else:
        raise RuntimeError("Queue purge did not complete")
    save(f"{prefix}-purge-status.json", purge_status)
    metrics = wait_for_metrics(lambda value: value == EMPTY_METRICS, "empty", 90)
    return save(f"{prefix}-queue-metrics.json", metrics)


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


def database() -> dict[str, Any]:
    return api("GET", f"/accounts/{ACCOUNT_ID}/d1/database/{DATABASE_ID}")["result"]


def validate_source() -> dict[str, Any]:
    subprocess.run(["git", "cat-file", "-e", f"{RUNTIME_SHA}^{{commit}}"], check=True)
    trigger = Path(".github/start-continuous-fast-lane-catch-up-trigger").read_text(
        encoding="utf-8"
    ).strip()
    if trigger != f"promote-{RUNTIME_SHA}":
        raise RuntimeError("trigger mismatch")
    subprocess.run(
        [
            "git",
            "diff",
            "--quiet",
            RUNTIME_SHA,
            "--",
            "src",
            "wrangler.jsonc",
            "package.json",
            "pnpm-lock.yaml",
        ],
        check=True,
    )
    config = json.loads(Path("wrangler.jsonc").read_text(encoding="utf-8"))
    consumers = config["queues"]["consumers"]
    checks = {
        "main": config["main"] == "src/worker/p0-redundant-scheduler-entry.ts",
        "cronEmpty": config["triggers"]["crons"] == [],
        "devnet": config["vars"]["APP_NETWORK"] == "devnet",
        "mainnetDisabled": config["vars"]["MAINNET_ENABLED"] == "false",
        "maxLedgers32": config["vars"]["FAST_LANE_MAX_LEDGERS_PER_RUN"] == "32",
        "oneConsumer": len(consumers) == 1,
        "batchOne": len(consumers) == 1 and consumers[0]["max_batch_size"] == 1,
        "concurrencyOne": len(consumers) == 1 and consumers[0]["max_concurrency"] == 1,
    }
    if not all(checks.values()):
        raise RuntimeError(f"source validation failed: {checks}")
    return checks


def binding_value(bindings: list[dict[str, Any]], name: str) -> Any:
    for item in bindings:
        if item.get("name") == name:
            return item.get("text", item.get("value"))
    return None


def validate_production() -> dict[str, Any]:
    pause_queue()
    if schedules():
        raise RuntimeError("Cron schedule is not empty")
    size = int(database().get("file_size") or 0)
    if not 0 < size < 350_000_000:
        raise RuntimeError(f"D1 size outside guard: {size}")
    migrations = subprocess.run(
        [
            "pnpm",
            "exec",
            "wrangler",
            "d1",
            "migrations",
            "list",
            DATABASE_NAME,
            "--remote",
        ],
        text=True,
        capture_output=True,
        check=True,
    ).stdout
    if "No migrations to apply" not in migrations:
        raise RuntimeError("unapplied migrations exist")
    settings = worker_settings()
    bindings = settings.get("bindings", [])
    checks = {
        "queuePaused": queue_paused(),
        "cronEmpty": schedules() == [],
        "devnet": binding_value(bindings, "APP_NETWORK") == "devnet",
        "mainnetDisabled": binding_value(bindings, "MAINNET_ENABLED") == "false",
        "maxLedgers32": binding_value(bindings, "FAST_LANE_MAX_LEDGERS_PER_RUN") == "32",
        "queueBinding": len(
            [
                item
                for item in bindings
                if item.get("name") == "FAST_LANE_QUEUE" and item.get("type") == "queue"
            ]
        )
        == 1,
        "d1Guard": 0 < size < 350_000_000,
        "migrationsCurrent": True,
    }
    if not all(checks.values()):
        raise RuntimeError(f"production preflight failed: {checks}")
    return save(
        "preflight-production.json",
        {
            "checkedAt": now_iso(),
            "checks": checks,
            "databaseSize": size,
            "deployment": deployments()[0],
            "queue": queue_state(),
            "queueMetrics": queue_metrics(),
            "schedules": schedules(),
        },
    )


def choose_seed() -> int:
    existing = {
        int(row["scheduled_time"])
        for row in d1("SELECT scheduled_time FROM fast_lane_queue_slots")
    }
    candidate = ((int(time.time() // 60) + 1) * 60) * 1000
    while candidate % 300_000 == 0 or candidate in existing:
        candidate += 60_000
    return candidate


def exact_slot(slot: int) -> list[dict[str, Any]]:
    return d1(
        "SELECT scheduled_time,message_id,status,started_at,completed_at,"
        "next_scheduled_time,next_cron,error_message,updated_at "
        f"FROM fast_lane_queue_slots WHERE scheduled_time={slot}"
    )


def slot_runs(row: dict[str, Any]) -> list[dict[str, Any]]:
    started = sql_quote(str(row["started_at"]))
    completed = sql_quote(str(row["completed_at"]))
    return d1(
        "SELECT run_at,status,start_ledger_index,end_ledger_index,"
        "latest_observed_ledger,lag_ledgers,ledgers_processed,error_message "
        "FROM fast_lane_shadow_run_metrics "
        "WHERE network='devnet' "
        f"AND run_at>='{started}' AND run_at<='{completed}' ORDER BY run_at"
    )


def validate_slot(row: dict[str, Any], expected: int) -> dict[str, Any]:
    runs = slot_runs(row)
    checks = {
        "exactScheduledTime": int(row["scheduled_time"]) == expected,
        "notFiveMinute": expected % 300_000 != 0,
        "completed": row["status"] == "completed",
        "slotErrorNull": row.get("error_message") is None,
        "oneRun": len(runs) == 1,
        "runStatus": len(runs) == 1
        and runs[0].get("status") in ("committed", "caught_up"),
        "boundedLedgers": len(runs) == 1
        and 1 <= int(runs[0].get("ledgers_processed") or 0) <= 32,
        "runErrorNull": len(runs) == 1 and runs[0].get("error_message") is None,
        "nextMinute": int(row.get("next_scheduled_time") or 0) == expected + 60_000,
        "catchUpCron": row.get("next_cron") == "queue-catch-up",
    }
    if not all(checks.values()):
        raise RuntimeError(f"slot {expected} failed: {checks}; runs={runs}")
    return {"slot": row, "runs": runs, "checks": checks}


def wait_for_completed_slot(
    expected: int,
    started_at: str,
    allowed_slots: set[int],
    attempts: int = 180,
) -> dict[str, Any]:
    quoted = sql_quote(started_at)
    for _ in range(attempts):
        wrong = d1(
            "SELECT scheduled_time,status,started_at,completed_at,updated_at "
            "FROM fast_lane_queue_slots "
            f"WHERE updated_at>='{quoted}' "
            "AND status IN ('processing','running','completed') "
            f"AND scheduled_time NOT IN ({','.join(str(value) for value in sorted(allowed_slots))}) "
            "ORDER BY updated_at"
        )
        if wrong:
            raise RuntimeError(f"unexpected slot processed: {wrong}")
        rows = exact_slot(expected)
        if rows and rows[0].get("status") == "completed":
            return rows[0]
        if rows and rows[0].get("status") == "error":
            raise RuntimeError(f"slot entered error state: {rows[0]}")
        time.sleep(1)
    raise RuntimeError(f"exact slot did not complete: {expected}")


def write_issue_comment(result: dict[str, Any]) -> None:
    status = "SUCCESS" if result.get("passed") else "FAILURE"
    lines = [
        f"## Continuous catch-up promotion: {status}",
        "",
        "```json",
        json.dumps(result, indent=2, sort_keys=True),
        "```",
    ]
    (EVIDENCE / "issue-comment.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def run() -> int:
    result: dict[str, Any] = {
        "checkedAt": now_iso(),
        "passed": False,
        "runtimeSha": RUNTIME_SHA,
        "seedScheduledTime": None,
        "seedIso": None,
        "verifiedSlots": [],
        "queuePaused": None,
        "queueMetrics": None,
        "schedules": None,
        "databaseSize": None,
        "deployment": None,
        "failure": None,
        "cleanupError": None,
    }
    resumed = False
    baseline_run_count: int | None = None
    baseline_cursor: int | None = None
    try:
        save("source-validation.json", validate_source())
        validate_production()
        purge_queue("initial")

        baseline_run_count = int(
            d1("SELECT COUNT(*) AS n FROM fast_lane_shadow_run_metrics WHERE network='devnet'")[0]["n"]
        )
        baseline_cursor = int(
            d1("SELECT last_processed_ledger FROM fast_lane_shadow_state WHERE network='devnet'")[0][
                "last_processed_ledger"
            ]
        )
        seed = choose_seed()
        result["seedScheduledTime"] = seed
        result["seedIso"] = dt.datetime.fromtimestamp(
            seed / 1000, dt.timezone.utc
        ).isoformat().replace("+00:00", "Z")
        save(
            "seed.json",
            {
                "scheduledTime": seed,
                "iso": result["seedIso"],
                "createdAt": now_iso(),
            },
        )
        body = {
            "scheduledTime": seed,
            "cron": "queue-catch-up",
            "enqueuedAt": now_iso(),
        }
        api(
            "POST",
            f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}/messages",
            {"body": body, "content_type": "json"},
        )
        queued = wait_for_metrics(
            lambda value: value["backlog_bytes"] > 0,
            "backlog bytes greater than zero",
            60,
        )
        save("queue-after-seed.json", queued)
        if exact_slot(seed):
            raise RuntimeError("seed slot changed while Queue paused")
        current_runs = int(
            d1("SELECT COUNT(*) AS n FROM fast_lane_shadow_run_metrics WHERE network='devnet'")[0]["n"]
        )
        if current_runs != baseline_run_count:
            raise RuntimeError("run appeared while Queue paused")

        allowed = {seed + offset * 60_000 for offset in range(4)}
        resume_queue()
        resumed = True
        verified: list[dict[str, Any]] = []
        for offset in range(3):
            expected = seed + offset * 60_000
            row = wait_for_completed_slot(expected, body["enqueuedAt"], allowed)
            evidence = validate_slot(row, expected)
            verified.append(evidence)
            save(f"slot-{offset + 1}.json", evidence)

        final_run_count = int(
            d1("SELECT COUNT(*) AS n FROM fast_lane_shadow_run_metrics WHERE network='devnet'")[0]["n"]
        )
        final_cursor = int(
            d1("SELECT last_processed_ledger FROM fast_lane_shadow_state WHERE network='devnet'")[0][
                "last_processed_ledger"
            ]
        )
        if final_run_count != baseline_run_count + 3:
            raise RuntimeError(
                f"expected exactly three new runs: baseline={baseline_run_count}, final={final_run_count}"
            )
        cursor_delta = final_cursor - baseline_cursor
        if not 3 <= cursor_delta <= 96:
            raise RuntimeError(f"cursor delta outside three-run bound: {cursor_delta}")
        if queue_paused():
            raise RuntimeError("Queue unexpectedly paused after promotion")
        if schedules():
            raise RuntimeError("Cron appeared during promotion")
        size = int(database().get("file_size") or 0)
        if not 0 < size < 350_000_000:
            raise RuntimeError(f"final D1 size outside guard: {size}")

        result.update(
            {
                "passed": True,
                "verifiedSlots": [
                    {
                        "scheduledTime": int(item["slot"]["scheduled_time"]),
                        "startedAt": item["slot"]["started_at"],
                        "completedAt": item["slot"]["completed_at"],
                        "nextScheduledTime": int(item["slot"]["next_scheduled_time"]),
                        "ledgersProcessed": int(item["runs"][0]["ledgers_processed"]),
                        "startLedgerIndex": int(item["runs"][0]["start_ledger_index"]),
                        "endLedgerIndex": int(item["runs"][0]["end_ledger_index"]),
                    }
                    for item in verified
                ],
                "baselineRunCount": baseline_run_count,
                "finalRunCount": final_run_count,
                "baselineCursor": baseline_cursor,
                "finalCursor": final_cursor,
                "cursorDelta": cursor_delta,
                "queuePaused": queue_paused(),
                "queueMetrics": queue_metrics(),
                "schedules": schedules(),
                "databaseSize": size,
                "deployment": deployments()[0],
            }
        )
    except Exception as exc:  # noqa: BLE001
        result["failure"] = repr(exc)
        try:
            pause_queue()
            purge_queue("failure-cleanup")
        except Exception as cleanup_exc:  # noqa: BLE001
            result["cleanupError"] = repr(cleanup_exc)
        result.update(
            {
                "queuePaused": queue_paused() if API_TOKEN else None,
                "queueMetrics": queue_metrics() if API_TOKEN else None,
                "schedules": schedules() if API_TOKEN else None,
                "databaseSize": int(database().get("file_size") or 0) if API_TOKEN else None,
                "deployment": deployments()[0] if API_TOKEN else None,
                "resumedBeforeFailure": resumed,
            }
        )
    finally:
        result["checkedAt"] = now_iso()
        save("overall-result.json", result)
        write_issue_comment(result)

    return 0 if result["passed"] else 1


if __name__ == "__main__":
    if "--validate-source-only" in sys.argv:
        save("source-validation.json", validate_source())
        raise SystemExit(0)
    raise SystemExit(run())
