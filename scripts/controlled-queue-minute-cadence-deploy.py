#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request
from typing import Any, Callable

EVIDENCE = Path("queue-minute-cadence-evidence")
EVIDENCE.mkdir(exist_ok=True)

ACCOUNT_ID = os.environ["CLOUDFLARE_ACCOUNT_ID"]
API_TOKEN = os.environ["CLOUDFLARE_API_TOKEN"]
SCRIPT_NAME = os.environ["SCRIPT_NAME"]
QUEUE_ID = os.environ["QUEUE_ID"]
DATABASE_ID = os.environ["DATABASE_ID"]
DATABASE_NAME = os.environ["DATABASE_NAME"]
PRODUCTION_BASE = os.environ["PRODUCTION_BASE"]
RUNTIME_SHA = os.environ["RUNTIME_SHA"]
API_BASE = "https://api.cloudflare.com/client/v4"
HEADERS = {
    "Authorization": f"Bearer {API_TOKEN}",
    "Content-Type": "application/json",
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
        except Exception as exc:  # noqa: BLE001 - retry external API failures
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
    query_result = result["result"][0]
    if query_result.get("success") is not True:
        raise RuntimeError(result)
    return query_result.get("results", [])


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


def purge_queue(evidence_name: str) -> dict[str, int]:
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
    save(f"{evidence_name}-purge-status.json", purge_status)
    metrics = wait_for_metrics(
        lambda value: value
        == {
            "backlog_count": 0,
            "backlog_bytes": 0,
            "oldest_message_timestamp_ms": 0,
        },
        "count=0, bytes=0, oldest=0",
    )
    return save(f"{evidence_name}-queue-metrics.json", metrics)


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


def wait_for_version(version_id: str, attempts: int = 60) -> dict[str, Any]:
    latest: dict[str, Any] = {}
    for _ in range(attempts):
        latest = deployments()[0]
        versions = latest.get("versions", [])
        if (
            len(versions) == 1
            and versions[0].get("version_id") == version_id
            and versions[0].get("percentage") == 100
        ):
            return latest
        time.sleep(2)
    raise RuntimeError(f"Version {version_id} did not become 100% deployment: {latest}")


def validate_source() -> dict[str, Any]:
    subprocess.run(["git", "cat-file", "-e", f"{RUNTIME_SHA}^{{commit}}"], check=True)
    trigger = Path(".github/queue-minute-cadence-deploy-trigger").read_text(
        encoding="utf-8"
    ).strip()
    if trigger != f"deploy-{RUNTIME_SHA}":
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
    if config["main"] != "src/worker/p0-redundant-scheduler-entry.ts":
        raise RuntimeError("unexpected Worker entry")
    if config["triggers"]["crons"] != []:
        raise RuntimeError("wrangler Cron configuration is not empty")
    if config["vars"]["APP_NETWORK"] != "devnet":
        raise RuntimeError("APP_NETWORK is not devnet")
    if config["vars"]["MAINNET_ENABLED"] != "false":
        raise RuntimeError("MAINNET_ENABLED is not false")
    if config["vars"]["FAST_LANE_MAX_LEDGERS_PER_RUN"] != "32":
        raise RuntimeError("fast-lane ledger bound is not 32")
    consumers = config["queues"]["consumers"]
    if len(consumers) != 1:
        raise RuntimeError("unexpected Queue consumer count")
    consumer = consumers[0]
    if consumer["max_batch_size"] != 1 or consumer["max_concurrency"] != 1:
        raise RuntimeError("Queue consumer bounds are not 1/1")
    return config


def assert_no_pending_migrations() -> None:
    completed = subprocess.run(
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
    )
    output = completed.stdout + completed.stderr
    (EVIDENCE / "remote-migrations.txt").write_text(output, encoding="utf-8")
    if "no migrations to apply" not in output.lower():
        raise RuntimeError("unapplied migrations exist or migration state is ambiguous")


def smoke_test() -> dict[str, int]:
    statuses: dict[str, int] = {}
    for path in (
        "/api/overview",
        "/api/status/history-source",
        "/api/status/fast-lane-diff?limit=1",
    ):
        with urllib.request.urlopen(PRODUCTION_BASE + path, timeout=45) as response:
            statuses[path] = response.status
    if set(statuses.values()) != {200}:
        raise RuntimeError(f"smoke failed: {statuses}")
    return statuses


def main() -> int:
    if "--validate-source-only" in sys.argv:
        save("source-validation.json", {"runtime": RUNTIME_SHA, "config": validate_source()})
        return 0

    old_version: str | None = None
    old_deployment: dict[str, Any] | None = None
    new_version: str | None = None
    deployed = False
    rolled_back = False
    seed: int | None = None
    baseline_run_count: int | None = None
    failure: str | None = None
    success = False

    try:
        config = validate_source()
        if not queue_paused():
            raise RuntimeError("Queue delivery is not paused")
        if schedules():
            raise RuntimeError("Cron schedule is not empty")
        size = int(database().get("file_size") or 0)
        if not 0 < size < 350_000_000:
            raise RuntimeError(f"D1 size outside guard: {size}")
        assert_no_pending_migrations()

        old_deployment = deployments()[0]
        old_version = old_deployment["versions"][0]["version_id"]
        save(
            "preflight-production-snapshot.json",
            {
                "checkedAt": now_iso(),
                "sourceCommit": RUNTIME_SHA,
                "config": config,
                "queue": queue_state(),
                "queueMetrics": queue_metrics(),
                "schedules": schedules(),
                "databaseSize": size,
                "deployment": old_deployment,
                "settings": worker_settings(),
                "unappliedMigrations": 0,
            },
        )

        pause_queue()
        purge_queue("initial")
        subprocess.run(["pnpm", "build:deploy-assets"], check=True)
        upload = subprocess.run(
            [
                "pnpm",
                "exec",
                "wrangler",
                "versions",
                "upload",
                "--message",
                f"controlled queue cadence {RUNTIME_SHA}",
                "--tag",
                RUNTIME_SHA,
            ],
            text=True,
            capture_output=True,
            check=True,
        )
        upload_output = upload.stdout + upload.stderr
        (EVIDENCE / "version-upload.txt").write_text(upload_output, encoding="utf-8")
        version_ids = re.findall(r"[0-9a-f]{8}-[0-9a-f-]{27,}", upload_output, re.I)
        if not version_ids:
            raise RuntimeError("Could not identify uploaded Worker version")
        new_version = version_ids[-1]
        subprocess.run(
            [
                "pnpm",
                "exec",
                "wrangler",
                "versions",
                "deploy",
                f"{new_version}@100%",
                "--yes",
            ],
            check=True,
        )
        deployed = True
        new_deployment = wait_for_version(new_version)

        active = worker_settings()
        bindings = active.get("bindings", [])

        def binding(name: str) -> Any:
            return next(
                (
                    item.get("text", item.get("value"))
                    for item in bindings
                    if item.get("name") == name
                ),
                None,
            )

        if binding("APP_NETWORK") != "devnet":
            raise RuntimeError("active APP_NETWORK is not devnet")
        if binding("MAINNET_ENABLED") != "false":
            raise RuntimeError("active MAINNET_ENABLED is not false")
        if binding("FAST_LANE_MAX_LEDGERS_PER_RUN") != "32":
            raise RuntimeError("active fast-lane ledger bound is not 32")
        if len(
            [
                item
                for item in bindings
                if item.get("name") == "FAST_LANE_QUEUE" and item.get("type") == "queue"
            ]
        ) != 1:
            raise RuntimeError("active Queue binding is invalid")
        if schedules() or not queue_paused():
            raise RuntimeError("post-deploy Cron/Queue state is unsafe")

        save(
            "deployment-identity.json",
            {
                "sourceCommit": RUNTIME_SHA,
                "oldVersionId": old_version,
                "oldDeploymentId": old_deployment["id"],
                "newVersionId": new_version,
                "newDeploymentId": new_deployment["id"],
                "bindings": bindings,
                "smoke": smoke_test(),
            },
        )

        before_cursor = int(
            d1(
                "SELECT last_processed_ledger FROM fast_lane_shadow_state "
                "WHERE network='devnet'"
            )[0]["last_processed_ledger"]
        )
        baseline_run_count = int(
            d1(
                "SELECT COUNT(*) AS n FROM fast_lane_shadow_run_metrics "
                "WHERE network='devnet'"
            )[0]["n"]
        )
        existing = {
            int(row["scheduled_time"])
            for row in d1("SELECT scheduled_time FROM fast_lane_queue_slots")
        }
        candidate = (int(time.time() // 60) + 1) * 60_000
        while candidate % 300_000 == 0 or candidate in existing:
            candidate += 60_000
        seed = candidate
        seed_iso = dt.datetime.fromtimestamp(
            seed / 1000, dt.timezone.utc
        ).isoformat().replace("+00:00", "Z")
        save("selected-seed-slot.json", {"scheduledTime": seed, "iso": seed_iso})
        save("queue-metrics-before-seed.json", queue_metrics())

        enqueued_at = now_iso()
        message_body = {
            "scheduledTime": seed,
            "cron": "queue-catch-up",
            "enqueuedAt": enqueued_at,
        }
        push_response = api(
            "POST",
            f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}/messages",
            {"body": message_body, "content_type": "json"},
        )
        save("seed-push-response.json", push_response)
        queued_metrics = wait_for_metrics(
            lambda value: value["backlog_bytes"] > 0,
            "backlog_bytes > 0",
        )
        save("queue-metrics-after-seed.json", queued_metrics)
        if (
            int(
                d1(
                    "SELECT COUNT(*) AS n FROM fast_lane_queue_slots "
                    f"WHERE scheduled_time={seed}"
                )[0]["n"]
            )
            != 0
        ):
            raise RuntimeError("seed mutated while Queue paused")
        if (
            int(
                d1(
                    "SELECT COUNT(*) AS n FROM fast_lane_shadow_run_metrics "
                    "WHERE network='devnet'"
                )[0]["n"]
            )
            != baseline_run_count
        ):
            raise RuntimeError("run appeared while Queue paused")

        resume_queue()
        row: dict[str, Any] | None = None
        for _ in range(100):
            exact_rows = d1(
                "SELECT scheduled_time,status,started_at,completed_at,"
                "next_scheduled_time,next_cron,error_message,updated_at "
                "FROM fast_lane_queue_slots "
                f"WHERE scheduled_time={seed}"
            )
            unexpected = d1(
                "SELECT scheduled_time,status,started_at,completed_at,updated_at "
                "FROM fast_lane_queue_slots "
                f"WHERE updated_at>='{sql_quote(enqueued_at)}' "
                f"AND scheduled_time!={seed} ORDER BY updated_at"
            )
            if unexpected:
                raise RuntimeError(f"unexpected slot processed: {unexpected}")
            if exact_rows:
                status = exact_rows[0]["status"]
                if status == "completed":
                    row = exact_rows[0]
                    pause_queue()
                    break
                if status == "error":
                    raise RuntimeError(f"exact seed slot failed: {exact_rows[0]}")
            time.sleep(0.5)
        if row is None:
            raise RuntimeError("exact seed slot did not complete")
        pause_queue()

        runs = d1(
            "SELECT run_at,status,start_ledger_index,end_ledger_index,"
            "latest_observed_ledger,lag_ledgers,ledgers_processed,error_message "
            "FROM fast_lane_shadow_run_metrics "
            "WHERE network='devnet' "
            f"AND run_at>='{sql_quote(row['started_at'])}' "
            f"AND run_at<='{sql_quote(row['completed_at'])}' ORDER BY run_at"
        )
        after_cursor = int(
            d1(
                "SELECT last_processed_ledger FROM fast_lane_shadow_state "
                "WHERE network='devnet'"
            )[0]["last_processed_ledger"]
        )
        successor_metrics = wait_for_metrics(
            lambda value: value["backlog_bytes"] > 0,
            "successor backlog_bytes > 0",
        )
        successor_evidence = {
            "scheduledTime": row["next_scheduled_time"],
            "cron": row["next_cron"],
            "queueMetrics": successor_metrics,
        }
        checks = {
            "exactSeed": int(row["scheduled_time"]) == seed,
            "notFiveMinute": seed % 300_000 != 0,
            "slotCompleted": row["status"] == "completed",
            "slotErrorNull": row["error_message"] is None,
            "oneRun": len(runs) == 1,
            "runStatus": len(runs) == 1
            and runs[0]["status"] in ("committed", "caught_up"),
            "boundedLedgers": len(runs) == 1
            and 1 <= int(runs[0]["ledgers_processed"]) <= 32,
            "runErrorNull": len(runs) == 1 and runs[0]["error_message"] is None,
            "nextTime": int(row["next_scheduled_time"]) == seed + 60_000,
            "nextCron": row["next_cron"] == "queue-catch-up",
            "successorQueued": successor_metrics["backlog_bytes"] > 0,
            "cursorBounded": 0 < after_cursor - before_cursor <= 32,
        }
        if not all(checks.values()):
            raise RuntimeError(f"controlled test failed: {checks}")
        save("exact-slot-row.json", row)
        save("corresponding-run-metrics.json", runs)
        save("successor-evidence.json", successor_evidence)
        save("controlled-checks.json", checks)

        time.sleep(65)
        quiet_run_count = int(
            d1(
                "SELECT COUNT(*) AS n FROM fast_lane_shadow_run_metrics "
                "WHERE network='devnet'"
            )[0]["n"]
        )
        unexpected_after_pause = d1(
            "SELECT scheduled_time,status,started_at,completed_at,updated_at "
            "FROM fast_lane_queue_slots "
            f"WHERE updated_at>'{sql_quote(row['completed_at'])}' "
            f"AND scheduled_time!={seed} ORDER BY updated_at"
        )
        quiet_passed = (
            quiet_run_count == baseline_run_count + 1 and not unexpected_after_pause
        )
        save(
            "post-pause-quiet-window.json",
            {
                "seconds": 65,
                "runCount": quiet_run_count,
                "expectedRunCount": baseline_run_count + 1,
                "unexpectedSlots": unexpected_after_pause,
                "passed": quiet_passed,
            },
        )
        if not quiet_passed:
            raise RuntimeError("additional activity occurred after pause")
        success = True
    except Exception as exc:  # noqa: BLE001 - fail closed and preserve evidence
        failure = repr(exc)
        try:
            pause_queue()
        except Exception as pause_exc:  # noqa: BLE001
            failure += f"; emergency pause failed: {pause_exc!r}"
        if deployed and old_version:
            try:
                subprocess.run(
                    [
                        "pnpm",
                        "exec",
                        "wrangler",
                        "versions",
                        "deploy",
                        f"{old_version}@100%",
                        "--yes",
                    ],
                    check=True,
                )
                rollback_deployment = wait_for_version(old_version)
                save(
                    "rollback-confirmation.json",
                    {
                        "oldVersionId": old_version,
                        "deployment": rollback_deployment,
                        "confirmedAt": now_iso(),
                    },
                )
                rolled_back = True
            except Exception as rollback_exc:  # noqa: BLE001
                failure += f"; rollback failed: {rollback_exc!r}"
    finally:
        cleanup_error: str | None = None
        try:
            pause_queue()
            final_queue = purge_queue("final")
            final_schedules = schedules()
            if final_schedules:
                raise RuntimeError("Cron exists during cleanup")
            final_runs = int(
                d1(
                    "SELECT COUNT(*) AS n FROM fast_lane_shadow_run_metrics "
                    "WHERE network='devnet'"
                )[0]["n"]
            )
            final_database_size = int(database().get("file_size") or 0)
            final_deployment = deployments()[0]
            if final_database_size >= 350_000_000:
                raise RuntimeError("final D1 size outside guard")
            if rolled_back and old_version:
                versions = final_deployment.get("versions", [])
                if not (
                    len(versions) == 1
                    and versions[0].get("version_id") == old_version
                    and versions[0].get("percentage") == 100
                ):
                    raise RuntimeError("rollback is not the active 100% deployment")
            save(
                "final-state.json",
                {
                    "queuePaused": queue_paused(),
                    "queue": final_queue,
                    "schedules": final_schedules,
                    "databaseSize": final_database_size,
                    "deployment": final_deployment,
                    "runCount": final_runs,
                },
            )
        except Exception as exc:  # noqa: BLE001
            cleanup_error = repr(exc)
            success = False

        result = {
            "checkedAt": now_iso(),
            "passed": bool(success),
            "sourceCommit": RUNTIME_SHA,
            "oldVersionId": old_version,
            "newVersionId": new_version,
            "seedScheduledTime": seed,
            "rollback": rolled_back,
            "failure": None if success else failure,
            "cleanupError": cleanup_error,
        }
        save("overall-result.json", result)
        if not success:
            print(json.dumps(result, sort_keys=True), file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
