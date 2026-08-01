#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import time
from typing import Any

MODULE_PATH = Path(__file__).with_name("start-continuous-fast-lane-catch-up.py")
SPEC = importlib.util.spec_from_file_location("continuous_catch_up", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"could not load promotion module: {MODULE_PATH}")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def wait_for_paused(expected: bool, attempts: int = 30) -> None:
    for _ in range(attempts):
        if MODULE.queue_paused() is expected:
            return
        time.sleep(1)
    state = MODULE.queue_state()
    raise RuntimeError(
        f"Queue delivery state did not become {'paused' if expected else 'resumed'}: {state}"
    )


def update_queue_delivery_paused(value: bool) -> None:
    MODULE.api(
        "PATCH",
        f"/accounts/{MODULE.ACCOUNT_ID}/queues/{MODULE.QUEUE_ID}",
        {"settings": {"delivery_paused": value}},
    )


def pause_queue_with_polling() -> None:
    update_queue_delivery_paused(True)
    wait_for_paused(True)


def resume_queue_with_polling() -> None:
    update_queue_delivery_paused(False)
    wait_for_paused(False)


ORIGINAL_CHOOSE_SEED = MODULE.choose_seed


def choose_non_five_minute_seed() -> int:
    seed = int(ORIGINAL_CHOOSE_SEED())
    if seed % 300_000 == 0:
        raise RuntimeError(f"seed unexpectedly landed on a five-minute boundary: {seed}")
    return seed


def validate_exact_minute_slot(row: dict[str, Any], expected: int) -> dict[str, Any]:
    runs = MODULE.slot_runs(row)
    checks = {
        "exactScheduledTime": int(row["scheduled_time"]) == expected,
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


MODULE.pause_queue = pause_queue_with_polling
MODULE.resume_queue = resume_queue_with_polling
MODULE.choose_seed = choose_non_five_minute_seed
MODULE.validate_slot = validate_exact_minute_slot

if "--validate-source-only" in sys.argv:
    MODULE.save("source-validation.json", MODULE.validate_source())
    raise SystemExit(0)

raise SystemExit(MODULE.run())
