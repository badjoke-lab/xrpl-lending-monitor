#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"
SOURCE = SCRIPTS / "check-actions-workflow-allowlist.sh"
EXPECTED_SHA256 = "354d4cd5402ff44aa0dd661e036550c66b89ef67c88921a1cad95aebf75fd93c"

TRANSFORMS = [
    "generate-actions-policy-r4f-g3-dual.py",
    "normalize-actions-policy-r4f-g3-dual.py",
    "extend-actions-policy-r4f-revision4-proof.py",
    "normalize-actions-policy-r4f-revision4-resume.py",
    "extend-actions-policy-r4f-revision4-cleanup.py",
    "extend-actions-policy-r4f-revision4-invocation-probe.py",
    "extend-actions-policy-r4f-revision4-resource-snapshot-refresh.py",
    "extend-actions-policy-r5-revision4-minute-activation.py",
    "extend-actions-policy-r5-revision4-db-footprint-probe.py",
    "extend-actions-policy-r5-phase-message-ready-partial-index-apply.py",
    "extend-actions-policy-r5-retention-readonly-preflight.py",
    "extend-actions-policy-r5-cron-history-retention.py",
    "extend-actions-policy-r5-index-footprint-readonly-probe.py",
    "extend-actions-policy-r5-work-status-partial-index-apply.py",
    "extend-actions-policy-r5-raw-evidence-retention.py",
    "extend-actions-policy-r5-raw-evidence-compaction.py",
    "extend-actions-policy-r5-revision4-resource-halt-rearm.py",
    "extend-actions-policy-r5-revision4-prepared-head-repair.py",
    "extend-actions-policy-r5-revision4-minute-completion-repair.py",
    "extend-actions-policy-r5-terminal-archive-phase-a-apply.py",
    "extend-actions-policy-r5-legacy-rev3-execution-retirement.py",
    "extend-actions-policy-r5-terminal-archive-phase-b-tranche.py",
    "extend-actions-policy-r5-terminal-archive-phase-b-500-ramp.py",
    "extend-actions-policy-r5-terminal-transport-compaction-preflight.py",
    "extend-actions-policy-r5-terminal-archive-v2-preflight.py",
    "extend-actions-policy-r5-collector-runs-retention-preflight.py",
    "extend-actions-policy-r5-collector-runs-retention-rewrite.py",
    "extend-actions-policy-r5-phase-ready-index-physical-reindex.py",
    "extend-actions-policy-current-repair-deploy-only.py",
    "extend-actions-policy-current-repair-queue-consumer.py",
]


def main() -> int:
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if output is None:
        raise SystemExit("usage: compile-current-actions-policy.py OUTPUT")

    with tempfile.TemporaryDirectory() as tmpdir:
        generated = Path(tmpdir) / "generated-actions-policy.sh"
        subprocess.run(
            [sys.executable, str(SCRIPTS / TRANSFORMS[0]), str(SOURCE), str(generated)],
            check=True,
            cwd=ROOT,
        )
        for name in TRANSFORMS[1:]:
            subprocess.run([sys.executable, str(SCRIPTS / name), str(generated)], check=True, cwd=ROOT)

        data = generated.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if digest != EXPECTED_SHA256:
            raise SystemExit(
                "generated Actions policy drift: "
                f"expected {EXPECTED_SHA256}, got {digest}"
            )
        output.write_bytes(data)
        print(f"Actions policy compiler matched canonical sha256 {digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
