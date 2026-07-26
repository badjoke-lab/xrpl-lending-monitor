#!/usr/bin/env python3
"""Run the read-only qualifier with deterministic headers and an internal readiness gate."""
from __future__ import annotations

import json
import runpy
from pathlib import Path
from urllib.request import build_opener, install_opener

opener = build_opener()
opener.addheaders = [
    ("User-Agent", "curl/8.5.0"),
    ("Accept", "application/json"),
]
install_opener(opener)

exit_code = 0
try:
    runpy.run_path(str(Path(__file__).with_name("run.py")), run_name="__main__")
except SystemExit as exc:
    exit_code = int(exc.code or 0) if isinstance(exc.code, int) else 1

out = Path("qualification-evidence")
readiness_files = sorted(out.glob("*-pre-soak-readiness.json"))
readiness_records: list[dict[str, object]] = []
for path in readiness_files:
    try:
        record = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        record = {"http": None, "payload": None, "path": str(path)}
    readiness_records.append(record)

readiness_passed = bool(readiness_records) and all(
    record.get("http") == 200
    and isinstance(record.get("payload"), dict)
    and record["payload"].get("passed") is True
    for record in readiness_records
)


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


result_path = out / "result.json"
if result_path.exists():
    result = json.loads(result_path.read_text())
    checks = dict(result.get("checks") or {})
    checks["preSoakReadinessInternalPassed"] = readiness_passed
    result["checks"] = checks
    result["healthy"] = all(checks.values())
    result["failures"] = [name for name, passed in checks.items() if not passed]
    write_json(result_path, result)

qualification_path = out / "qualification-result.json"
if qualification_path.exists():
    qualification = json.loads(qualification_path.read_text())
    checks = dict(qualification.get("checks") or {})
    checks["preSoakReadinessInternalPassed"] = readiness_passed
    qualification["checks"] = checks
    qualification["passed"] = all(checks.values())
    qualification["status"] = "passed" if qualification["passed"] else "failed"
    qualification["failures"] = [name for name, passed in checks.items() if not passed]
    write_json(qualification_path, qualification)

if not readiness_passed:
    arm_path = out / "arm.json"
    if arm_path.exists():
        rejected = json.loads(arm_path.read_text())
        rejected["armed"] = False
        rejected["rejection"] = "preSoakReadinessInternalPassed"
        write_json(out / "arm-rejected.json", rejected)
        arm_path.unlink()
    write_json(
        out / "pre-soak-readiness-gate.json",
        {
            "passed": False,
            "reason": "pre-soak readiness payload did not pass every internal check",
            "evidenceFiles": [str(path) for path in readiness_files],
        },
    )
    exit_code = exit_code or 1
else:
    write_json(
        out / "pre-soak-readiness-gate.json",
        {
            "passed": True,
            "reason": "pre-soak readiness payload passed every internal check",
            "evidenceFiles": [str(path) for path in readiness_files],
        },
    )

if exit_code:
    raise SystemExit(exit_code)
