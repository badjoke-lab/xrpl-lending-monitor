#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path
from typing import Any

ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
QUEUE_ID = os.environ.get("QUEUE_ID", "")
SCRIPT_NAME = os.environ.get("SCRIPT_NAME", "xrpl-lending-monitor")
REPAIRED_VERSION_ID = os.environ.get("REPAIRED_VERSION_ID", "")
EXPECTED_MESSAGE_ID = os.environ.get("EXPECTED_MESSAGE_ID", "")
EXPECTED_SCHEDULED_TIME = int(os.environ.get("EXPECTED_SCHEDULED_TIME", "0"))
OUT = Path(os.environ.get("CURRENT_REPAIR_STALE_RETRY_PURGE_OUTPUT", "current-repair-stale-retry-purge-evidence"))
OUT.mkdir(parents=True, exist_ok=True)
API_BASE = "https://api.cloudflare.com/client/v4"
HEADERS = {"Authorization": f"Bearer {API_TOKEN}", "Content-Type": "application/json"}

if not all((ACCOUNT_ID, API_TOKEN, QUEUE_ID, REPAIRED_VERSION_ID, EXPECTED_MESSAGE_ID)) or EXPECTED_SCHEDULED_TIME <= 0:
    raise SystemExit("required exact production identities are missing")


def api(method: str, path: str, body: Any | None = None) -> dict[str, Any]:
    data = None if body is None else json.dumps(body, separators=(",", ":")).encode()
    req = urllib.request.Request(API_BASE + path, data=data, headers=HEADERS, method=method)
    with urllib.request.urlopen(req, timeout=60) as response:
        payload = json.load(response)
    if payload.get("success") is not True:
        raise RuntimeError(payload.get("errors"))
    return payload


def queue_state() -> dict[str, Any]:
    return api("GET", f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}")["result"]


def queue_metrics() -> dict[str, int]:
    result = api("GET", f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}/metrics")["result"]
    return {"backlogCount": int(result.get("backlog_count") or 0), "backlogBytes": int(result.get("backlog_bytes") or 0)}


def paused() -> bool:
    return (queue_state().get("settings") or {}).get("delivery_paused") is True


def schedules() -> list[dict[str, Any]]:
    return api("GET", f"/accounts/{ACCOUNT_ID}/workers/scripts/{SCRIPT_NAME}/schedules")["result"]["schedules"]


def deployment_version() -> str | None:
    deployments = api("GET", f"/accounts/{ACCOUNT_ID}/workers/scripts/{SCRIPT_NAME}/deployments")["result"]["deployments"]
    versions = (deployments[0] if deployments else {}).get("versions") or []
    if len(versions) != 1 or versions[0].get("percentage") != 100:
        return None
    return versions[0].get("version_id")


def peek_one() -> dict[str, Any]:
    result = api("POST", f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}/messages/peek", {"batch_size": 1})["result"]
    messages = result.get("messages") or []
    if len(messages) != 1:
        raise RuntimeError(f"expected exactly one peeked message, found {len(messages)}")
    return messages[0]


def normalized_body(message: dict[str, Any]) -> dict[str, Any]:
    body = message.get("body")
    if isinstance(body, dict):
        return body
    if isinstance(body, str):
        try:
            value = json.loads(body)
            return value if isinstance(value, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def capture(include_peek: bool = True) -> dict[str, Any]:
    metrics = queue_metrics()
    state = {
        "queuePaused": paused(),
        "metrics": metrics,
        "schedules": schedules(),
        "deploymentVersion": deployment_version(),
    }
    message = None
    if include_peek and metrics["backlogCount"] == 1:
        message = peek_one()
        body = normalized_body(message)
        state["peek"] = {
            "id": message.get("id"),
            "attempts": message.get("attempts"),
            "timestamp_ms": message.get("timestamp_ms"),
            "body": body,
            "hasRef": isinstance(message.get("ref"), str) and bool(message.get("ref")),
        }
    checks = {
        "queuePaused": state["queuePaused"] is True,
        "exactBacklog": metrics == {"backlogCount": 1, "backlogBytes": 118},
        "schedulerDisabled": state["schedules"] == [],
        "repairedVersionActive": state["deploymentVersion"] == REPAIRED_VERSION_ID,
        "exactMessageId": bool(message) and message.get("id") == EXPECTED_MESSAGE_ID,
        "exactScheduledTime": bool(message) and normalized_body(message).get("scheduledTime") == EXPECTED_SCHEDULED_TIME,
        "peekRefPresent": bool(message) and isinstance(message.get("ref"), str) and bool(message.get("ref")),
    }
    digest_state = dict(state)
    if message:
        digest_state["peekRefHash"] = hashlib.sha256(str(message.get("ref")).encode()).hexdigest()
    digest = hashlib.sha256(json.dumps(digest_state, separators=(",", ":"), sort_keys=True).encode()).hexdigest()
    return {"safeToPurgeExactRetry": all(checks.values()), "checks": checks, "failures": [k for k, v in checks.items() if not v], "state": state, "stateDigest": digest, "message": message}


def prepare() -> int:
    pre = capture()
    result = {k: v for k, v in pre.items() if k != "message"}
    result.update({"schemaVersion": 1, "mode": "prepare", "productionMutation": False})
    (OUT / "result.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"safeToPurgeExactRetry": result["safeToPurgeExactRetry"], "failures": result["failures"], "stateDigest": result["stateDigest"]}, sort_keys=True))
    return 0 if result["safeToPurgeExactRetry"] else 1


def execute() -> int:
    authorized = os.environ.get("AUTHORIZED_STATE_DIGEST", "")
    result: dict[str, Any] = {"schemaVersion": 1, "mode": "execute", "productionMutation": False, "passed": False, "exactMessagePurged": False, "queueResumed": False, "failure": None}
    try:
        pre = capture()
        pre_public = {k: v for k, v in pre.items() if k != "message"}
        (OUT / "pre-state.json").write_text(json.dumps(pre_public, indent=2, sort_keys=True) + "\n")
        if not pre["safeToPurgeExactRetry"]:
            raise RuntimeError(f"unsafe exact purge pre-state: {pre['failures']}")
        if not authorized or pre["stateDigest"] != authorized:
            raise RuntimeError("exact purge state digest changed after preparation")
        ref = pre["message"].get("ref")
        purge = api("POST", f"/accounts/{ACCOUNT_ID}/queues/{QUEUE_ID}/messages/purge", {"refs": [{"ref": ref}]})
        result["productionMutation"] = True
        errors = purge.get("result", {}).get("errors") or purge.get("errors") or []
        warnings = purge.get("result", {}).get("warnings") or purge.get("warnings") or {}
        if errors:
            raise RuntimeError(f"peek-ref purge returned errors: {errors}")
        result["purgeWarnings"] = warnings
        result["exactMessagePurged"] = True
        post = capture(include_peek=False)
        result["postState"] = post["state"]
        metrics = post["state"]["metrics"]
        if post["state"]["queuePaused"] is not True or metrics["backlogCount"] != 0 or metrics["backlogBytes"] != 0:
            raise RuntimeError(f"post-purge Queue state unexpected: {post['state']}")
        result["passed"] = True
    except Exception as exc:
        result["failure"] = repr(exc)
    (OUT / "result.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(json.dumps(result, sort_keys=True))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in {"--prepare", "--execute"}:
        raise SystemExit("usage: current-repair-stale-retry-purge.py --prepare|--execute")
    raise SystemExit(prepare() if sys.argv[1] == "--prepare" else execute())
