#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
from pathlib import Path
import time

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


def pause_queue_with_polling() -> None:
    MODULE.api(
        "PATCH",
        f"/accounts/{MODULE.ACCOUNT_ID}/queues/{MODULE.QUEUE_ID}/settings",
        {"delivery_paused": True},
    )
    wait_for_paused(True)


def resume_queue_with_polling() -> None:
    MODULE.api(
        "PATCH",
        f"/accounts/{MODULE.ACCOUNT_ID}/queues/{MODULE.QUEUE_ID}/settings",
        {"delivery_paused": False},
    )
    wait_for_paused(False)


MODULE.pause_queue = pause_queue_with_polling
MODULE.resume_queue = resume_queue_with_polling
raise SystemExit(MODULE.main() if hasattr(MODULE, "main") else MODULE.run())
