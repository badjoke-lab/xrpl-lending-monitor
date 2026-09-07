#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

CATCH_UP_INTERVAL_MS = 4 * 60 * 60 * 1000
DELAYED_SUCCESSOR_BYTES = 95
PREPARE_MIN_LEAD_MS = 30 * 60 * 1000
EXECUTE_MIN_LEAD_MS = 15 * 60 * 1000
CHAIN_ROWS = 3


def fail(message: str) -> None:
    raise SystemExit(f"fresh cutover Queue proof failed: {message}")


def load(path: str) -> Any:
    try:
        return json.loads(Path(path).read_text())
    except Exception as exc:
        fail(f"cannot read {path}: {exc}")


def as_int(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        fail(f"{name} must be an integer")
    return value


def parse_time(value: Any, name: str) -> datetime:
    if not isinstance(value, str) or not value:
        fail(f"{name} must be a timestamp")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        fail(f"{name} is not ISO-8601")


def peek_messages(payload: Any) -> list[Any]:
    if not isinstance(payload, dict) or payload.get("success") is not True:
        fail("Queue peek response is not successful")
    result = payload.get("result")
    if isinstance(result, dict):
        messages = result.get("messages", [])
    elif isinstance(result, list):
        messages = result
    elif result is None:
        messages = []
    else:
        fail("Queue peek result has an unexpected shape")
    if not isinstance(messages, list):
        fail("Queue peek messages are not a list")
    return messages


def prove_delayed_successor(preflight: dict[str, Any], now_ms: int, min_lead_ms: int) -> dict[str, Any]:
    state = preflight.get("state")
    if not isinstance(state, dict):
        fail("preflight state is missing")
    fast = state.get("fastLane")
    metric = state.get("latestMetric")
    slots = state.get("latestSlots")
    if not isinstance(fast, dict) or not isinstance(metric, dict) or not isinstance(slots, list):
        fail("preflight fastLane/latestMetric/latestSlots shape mismatch")
    if fast.get("status") != "behind":
        fail("fast lane is not in behind/catch-up state")
    last_processed = as_int(fast.get("last_processed_ledger"), "fastLane.last_processed_ledger")
    latest_observed = as_int(fast.get("latest_observed_ledger"), "fastLane.latest_observed_ledger")
    if latest_observed <= last_processed:
        fail("fast lane is not actually behind")
    if metric.get("status") != "committed" or metric.get("error_message") is not None:
        fail("latest metric is not a clean committed run")
    if as_int(metric.get("end_ledger_index"), "latestMetric.end_ledger_index") != last_processed:
        fail("latest metric is not bound to the current fast cursor")
    if len(slots) < CHAIN_ROWS:
        fail(f"need at least {CHAIN_ROWS} latest Queue slots")

    chain = slots[:CHAIN_ROWS]
    for index, slot in enumerate(chain):
        if not isinstance(slot, dict):
            fail(f"latestSlots[{index}] is not an object")
        if slot.get("status") != "completed" or slot.get("error_message") is not None:
            fail(f"latestSlots[{index}] is not a clean completed slot")
        scheduled = as_int(slot.get("scheduled_time"), f"latestSlots[{index}].scheduled_time")
        successor = as_int(slot.get("next_scheduled_time"), f"latestSlots[{index}].next_scheduled_time")
        if successor - scheduled != CATCH_UP_INTERVAL_MS:
            fail(f"latestSlots[{index}] is not the protected four-hour cadence")
        if index + 1 < CHAIN_ROWS:
            previous_successor = as_int(
                chain[index + 1].get("next_scheduled_time"),
                f"latestSlots[{index + 1}].next_scheduled_time",
            )
            if scheduled != previous_successor:
                fail(f"latestSlots[{index}] does not continue the prior successor chain")

    newest = chain[0]
    metric_at = parse_time(metric.get("run_at"), "latestMetric.run_at")
    started_at = parse_time(newest.get("started_at"), "latestSlots[0].started_at")
    completed_at = parse_time(newest.get("completed_at"), "latestSlots[0].completed_at")
    if not (started_at <= metric_at <= completed_at):
        fail("latest metric timestamp is not inside the newest Queue slot execution window")

    successor_ms = as_int(newest.get("next_scheduled_time"), "latestSlots[0].next_scheduled_time")
    lead_ms = successor_ms - now_ms
    if lead_ms < min_lead_ms:
        fail(f"delayed successor lead time is too short ({lead_ms}ms < {min_lead_ms}ms)")

    return {
        "delayedSuccessorRecognized": True,
        "successorScheduledTime": successor_ms,
        "successorLeadMs": lead_ms,
        "chainRows": CHAIN_ROWS,
        "catchUpIntervalMs": CATCH_UP_INTERVAL_MS,
        "metricRunAt": metric.get("run_at"),
        "fastLedger": last_processed,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("prepare", "execute"), required=True)
    parser.add_argument("--preflight", required=True)
    parser.add_argument("--metrics", required=True)
    parser.add_argument("--peek", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    preflight = load(args.preflight)
    metrics = load(args.metrics)
    peek = load(args.peek)
    if not isinstance(preflight, dict) or preflight.get("productionMutation") is not False:
        fail("preflight is not an explicit read-only result")
    if not isinstance(metrics, dict) or metrics.get("success") is not True:
        fail("Queue metrics response is not successful")
    metric_result = metrics.get("result")
    if not isinstance(metric_result, dict):
        fail("Queue metrics result has an unexpected shape")

    backlog_count = as_int(metric_result.get("backlog_count"), "backlog_count")
    backlog_bytes = as_int(metric_result.get("backlog_bytes"), "backlog_bytes")
    if backlog_count != 0:
        fail(f"Queue backlog_count is {backlog_count}, expected 0")
    messages = peek_messages(peek)
    if messages:
        fail(f"Queue peek exposed {len(messages)} visible message(s)")

    now_ms = time.time_ns() // 1_000_000
    min_lead_ms = PREPARE_MIN_LEAD_MS if args.mode == "prepare" else EXECUTE_MIN_LEAD_MS
    if backlog_bytes == 0:
        delayed = {
            "delayedSuccessorRecognized": False,
            "successorScheduledTime": 0,
            "successorLeadMs": 0,
            "chainRows": 0,
            "catchUpIntervalMs": CATCH_UP_INTERVAL_MS,
            "metricRunAt": (preflight.get("state") or {}).get("latestMetric", {}).get("run_at"),
            "fastLedger": (preflight.get("state") or {}).get("fastLane", {}).get("last_processed_ledger"),
        }
    elif backlog_bytes == DELAYED_SUCCESSOR_BYTES:
        delayed = prove_delayed_successor(preflight, now_ms, min_lead_ms)
    else:
        fail(f"Queue backlog_bytes is unexpected: {backlog_bytes}")

    output = {
        "passed": True,
        "productionMutation": False,
        "mode": args.mode,
        "backlogCount": backlog_count,
        "backlogBytes": backlog_bytes,
        "visibleMessages": 0,
        **delayed,
    }
    Path(args.output).write_text(json.dumps(output, indent=2, sort_keys=True) + "\n")
    print(json.dumps(output, sort_keys=True))


if __name__ == "__main__":
    main()
