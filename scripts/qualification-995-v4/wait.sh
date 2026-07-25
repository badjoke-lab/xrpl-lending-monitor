#!/usr/bin/env bash
set -euo pipefail
target="$(date -u -d "$EVALUATE_UTC" +%s)"
now="$(date -u +%s)"
if [ "$now" -lt "$target" ]; then sleep "$((target-now))"; fi
