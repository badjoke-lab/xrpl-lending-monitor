#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request
from typing import Any

EVIDENCE = Path("fixed-runtime-deploy-evidence")
EVIDENCE.mkdir(exist_ok=True)

ACCOUNT_ID = os.environ["CLOUDFLARE_ACCOUNT_ID"]
API_TOKEN = os.environ["CLOUDFLARE_API_TOKEN"]
SCRIPT_NAME = os.environ["SCRIPT_NAME"]
QUEUE_ID = os.environ["QUEUE_ID"]
DATABASE_ID = os.environ["DATABASE_ID"]
PRODUCTION_BASE = os.environ["PRODUCTION_BASE"]
RUNTIME_SHA = os.environ["RUNTIME_SHA"]
API_BASE = "https://api.cloudflare.com/client/v4"
HEADERS = {
    "Authorization": f"Bearer {API_TOKEN}",
    "Content-Type": "application/json",
}


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


def binding_value(bindings: list[dict[str, Any]], name: str) -> Any:
    for item in bindings:
        if item.get("name") == name:
            return item.get("text", item.get("value"))
    return None


def validate_source() -> dict[str, Any]:
    subprocess.run(["git", "cat-file", "-e", f"{RUNTIME_SHA}^{{commit}}"], check=True)
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
        "entry": config["main"] == "src/worker/p0-redundant-scheduler-entry.ts",
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
    raise RuntimeError(f"version did not become 100%: {version_id}; latest={latest}")


def parse_version_id(output: str) -> str:
    match = re.search(
        r"(?:Worker Version ID|Version ID)\s*[:=]\s*([0-9a-f]{8}-[0-9a-f-]{27,})",
        output,
        flags=re.IGNORECASE,
    )
    if match:
        return match.group(1)
    ids = re.findall(r"[0-9a-f]{8}-[0-9a-f-]{27,}", output, flags=re.IGNORECASE)
    if not ids:
        raise RuntimeError("could not identify uploaded Worker version")
    return ids[-1]


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
        save("source-validation.json", validate_source())
        return 0

    old_version: str | None = None
    new_version: str | None = None
    deployed = False
    rolled_back = False
    result: dict[str, Any] = {
        "passed": False,
        "runtimeSha": RUNTIME_SHA,
        "oldVersionId": None,
        "newVersionId": None,
        "deployment": None,
        "queuePaused": None,
        "schedules": None,
        "databaseSize": None,
        "rollback": False,
        "failure": None,
    }

    try:
        save("source-validation.json", validate_source())
        pause_queue()
        if schedules():
            raise RuntimeError("Cron schedule is not empty")
        size = int(database().get("file_size") or 0)
        if not 0 < size < 350_000_000:
            raise RuntimeError(f"D1 size outside guard: {size}")

        old_deployment = deployments()[0]
        old_version = old_deployment["versions"][0]["version_id"]
        result["oldVersionId"] = old_version
        save(
            "pre-deploy.json",
            {
                "queue": queue_state(),
                "schedules": schedules(),
                "databaseSize": size,
                "deployment": old_deployment,
                "settings": worker_settings(),
            },
        )

        subprocess.run(["pnpm", "build:deploy-assets"], check=True)
        upload = subprocess.run(
            [
                "pnpm",
                "exec",
                "wrangler",
                "versions",
                "upload",
                "--message",
                f"continuous catch-up runtime {RUNTIME_SHA}",
            ],
            text=True,
            capture_output=True,
            check=True,
        )
        upload_output = upload.stdout + upload.stderr
        (EVIDENCE / "version-upload.txt").write_text(upload_output, encoding="utf-8")
        new_version = parse_version_id(upload_output)
        result["newVersionId"] = new_version

        deploy = subprocess.run(
            [
                "pnpm",
                "exec",
                "wrangler",
                "versions",
                "deploy",
                f"{new_version}@100%",
                "--yes",
            ],
            text=True,
            capture_output=True,
            check=True,
        )
        (EVIDENCE / "version-deploy.txt").write_text(
            deploy.stdout + deploy.stderr,
            encoding="utf-8",
        )
        deployed = True
        active_deployment = wait_for_version(new_version)

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
        }
        if not all(checks.values()):
            raise RuntimeError(f"post-deploy validation failed: {checks}")

        result.update(
            {
                "passed": True,
                "deployment": active_deployment,
                "queuePaused": queue_paused(),
                "schedules": schedules(),
                "databaseSize": int(database().get("file_size") or 0),
                "checks": checks,
                "smoke": smoke_test(),
            }
        )
    except Exception as exc:  # noqa: BLE001
        result["failure"] = repr(exc)
        try:
            pause_queue()
        except Exception as pause_exc:  # noqa: BLE001
            result["pauseFailure"] = repr(pause_exc)
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
                wait_for_version(old_version)
                rolled_back = True
            except Exception as rollback_exc:  # noqa: BLE001
                result["rollbackFailure"] = repr(rollback_exc)
        result.update(
            {
                "queuePaused": queue_paused(),
                "schedules": schedules(),
                "databaseSize": int(database().get("file_size") or 0),
            }
        )
    finally:
        result["rollback"] = rolled_back
        save("overall-result.json", result)
        status = "SUCCESS" if result["passed"] else "FAILURE"
        (EVIDENCE / "issue-comment.md").write_text(
            f"## Fixed runtime deployment before promotion: {status}\n\n```json\n"
            + json.dumps(result, indent=2, sort_keys=True)
            + "\n```\n",
            encoding="utf-8",
        )

    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
