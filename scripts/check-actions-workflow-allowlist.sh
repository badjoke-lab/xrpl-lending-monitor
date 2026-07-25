#!/usr/bin/env bash
set -euo pipefail

root="${1:-.github/workflows}"
mapfile -t actual < <(
  find "$root" -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) \
    -printf '%f\n' | LC_ALL=C sort
)

printf 'Detected workflow files (%s):\n' "${#actual[@]}"
printf '  %s\n' "${actual[@]}"

expected=(
  ci.yml
  rolling-checkpoint-candidate.yml
  rolling-checkpoint-live-cutover.yml
)

if [[ "${#actual[@]}" -ne "${#expected[@]}" ]]; then
  echo "GitHub Actions workflow count must remain exactly three." >&2
  exit 1
fi

for index in "${!expected[@]}"; do
  if [[ "${actual[$index]}" != "${expected[$index]}" ]]; then
    echo "Unexpected workflow file: expected ${expected[$index]}, found ${actual[$index]}." >&2
    exit 1
  fi
done

python - "$root" <<'PY'
from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
manual = [
    root / "rolling-checkpoint-candidate.yml",
    root / "rolling-checkpoint-live-cutover.yml",
]

for path in manual:
    lines = path.read_text().splitlines()
    try:
        start = lines.index("on:") + 1
    except ValueError as exc:
        raise SystemExit(f"{path} has no top-level on block") from exc

    triggers: list[str] = []
    for line in lines[start:]:
        if line and not line.startswith(" "):
            break
        match = re.match(r"^  ([A-Za-z_]+):", line)
        if match:
            triggers.append(match.group(1))

    if triggers != ["workflow_dispatch"]:
        raise SystemExit(
            f"{path} must remain workflow_dispatch-only; found triggers={triggers}"
        )

for path in root.glob("*.y*ml"):
    if re.search(r"^  schedule:", path.read_text(), flags=re.MULTILINE):
        raise SystemExit(f"scheduled workflow is forbidden: {path}")
PY

echo "Actions workflow allowlist passed: CI plus two manual checkpoint workflows."
