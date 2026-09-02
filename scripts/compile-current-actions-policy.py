#!/usr/bin/env python3
from __future__ import annotations

import base64
import gzip
import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT_DIR = ROOT / "scripts" / "actions-policy-canonical"
SNAPSHOT_PARTS = [SNAPSHOT_DIR / f"part-{index:02d}.b64" for index in range(4)]
EXPECTED_SHA256 = "354d4cd5402ff44aa0dd661e036550c66b89ef67c88921a1cad95aebf75fd93c"


def main() -> int:
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if output is None:
        raise SystemExit("usage: compile-current-actions-policy.py OUTPUT")

    encoded = "".join(part.read_text(encoding="ascii") for part in SNAPSHOT_PARTS)
    data = gzip.decompress(base64.b64decode(encoded))
    digest = hashlib.sha256(data).hexdigest()
    if digest != EXPECTED_SHA256:
        raise SystemExit(
            "canonical Actions policy snapshot drift: "
            f"expected {EXPECTED_SHA256}, got {digest}"
        )

    output.write_bytes(data)
    print(f"Actions policy snapshot matched canonical sha256 {digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
