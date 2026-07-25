#!/usr/bin/env python3
import json
from datetime import datetime, timezone
from pathlib import Path

SOURCE = Path('.github/workflows/complete-history-12-slot-qualification-995-v3.yml')
TARGET = Path('.github/workflows/complete-history-12-slot-qualification-995-v4.yml')
TRIGGER = Path('.github/complete-history-12-slot-qualification-995-v4-trigger')
PLAN = Path('.github/complete-history-12-slot-qualification-995-v4-plan.json')
RUNTIME_SHA = '5b56de459e97495a9358f0e203c056d2a99afc6b'
ARM_CRON = '5 8 25 7 *'
PREPARE_UTC = '2026-07-25T08:25:00Z'
START_UTC = '2026-07-25T08:30:00Z'
END_UTC = '2026-07-25T09:25:00Z'
EVALUATE_UTC = '2026-07-25T09:30:30Z'
START_MS = '1784968200000'
END_MS = '1784971500000'
TIMEOUT_MINUTES = 180
FINALIZATION_BUDGET_SECONDS = 1200


def replace_once(text: str, old: str, new: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'expected one replacement anchor, found {count}: {old!r}')
    return text.replace(old, new, 1)


def main() -> None:
    text = SOURCE.read_text()
    replacements = {
        'Complete-history 12-slot qualification 995 v3': 'Complete-history 12-slot qualification 995 v4',
        'complete-history-12-slot-qualification-995-v3': 'complete-history-12-slot-qualification-995-v4',
        'pre-soak qualification v3': 'pre-soak qualification v4',
        'qualification v3': 'qualification v4',
        'qualify-v3': 'qualify-v4',
        "PREPARE_UTC: '2026-07-25T04:05:00Z'": f"PREPARE_UTC: '{PREPARE_UTC}'",
        "START_UTC: '2026-07-25T04:10:00Z'": f"START_UTC: '{START_UTC}'",
        "END_UTC: '2026-07-25T05:05:00Z'": f"END_UTC: '{END_UTC}'",
        "EVALUATE_UTC: '2026-07-25T05:10:30Z'": f"EVALUATE_UTC: '{EVALUATE_UTC}'",
        '1784952600000': START_MS,
        '1784955900000': END_MS,
        '2026-07-25T04:10:00+00:00': '2026-07-25T08:30:00+00:00',
        '2026-07-25T05:05:00+00:00': '2026-07-25T09:25:00+00:00',
        '2026-07-25T05:10:30+00:00': '2026-07-25T09:30:30+00:00',
        '2026-07-25T13:10:00+09:00': '2026-07-25T17:30:00+09:00',
        '2026-07-25T14:05:00+09:00': '2026-07-25T18:25:00+09:00',
        '2026-07-25 13:10 JST': '2026-07-25 17:30 JST',
        '2026-07-25 14:05 JST': '2026-07-25 18:25 JST',
        '2026-07-25 14:10:30 JST': '2026-07-25 18:30:30 JST',
        'timeout-minutes: 115': f'timeout-minutes: {TIMEOUT_MINUTES}',
    }
    for old, new in replacements.items():
        if old not in text:
            raise SystemExit(f'missing replacement anchor: {old}')
        text = text.replace(old, new)

    text = replace_once(
        text,
        'on:\n',
        f"on:\n  workflow_dispatch:\n  schedule:\n    - cron: '{ARM_CRON}'\n",
    )
    text = replace_once(
        text,
        "    if: github.event_name == 'push'\n    runs-on: ubuntu-latest\n    timeout-minutes: 180\n",
        "    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'\n    runs-on: ubuntu-latest\n    timeout-minutes: 180\n",
    )
    text = replace_once(
        text,
        f"  END_MS: '{END_MS}'\n",
        f"  END_MS: '{END_MS}'\n  QUALIFY_TIMEOUT_MINUTES: '{TIMEOUT_MINUTES}'\n  FINALIZATION_BUDGET_SECONDS: '{FINALIZATION_BUDGET_SECONDS}'\n",
    )
    arm_anchor = (
        '          set -euo pipefail\n'
        '          start_epoch="$(date -u -d "$START_UTC" +%s)"\n'
    )
    guard = (
        '          set -euo pipefail\n'
        '          now_epoch="$(date -u +%s)"\n'
        '          evaluate_epoch="$(date -u -d "$EVALUATE_UTC" +%s)"\n'
        '          budget_seconds="$((QUALIFY_TIMEOUT_MINUTES * 60))"\n'
        '          required_seconds="$((evaluate_epoch - now_epoch + FINALIZATION_BUDGET_SECONDS))"\n'
        '          test "$required_seconds" -gt 0\n'
        '          if [ "$required_seconds" -ge "$((budget_seconds - 300))" ]; then\n'
        '            echo "::error::Qualification time budget invalid: required=${required_seconds}s budget=${budget_seconds}s"\n'
        '            exit 1\n'
        '          fi\n'
        '          start_epoch="$(date -u -d "$START_UTC" +%s)"\n'
    )
    text = replace_once(text, arm_anchor, guard)

    validation_anchor = '          assert (evaluate-end).total_seconds()>=300\n'
    validation = (
        validation_anchor
        + "          prepare=datetime.fromisoformat('2026-07-25T08:25:00+00:00')\n"
        + f'          timeout_seconds={TIMEOUT_MINUTES}*60\n'
        + f'          finalization_seconds={FINALIZATION_BUDGET_SECONDS}\n'
        + '          assert (evaluate-prepare).total_seconds()+finalization_seconds < timeout_seconds-300\n'
    )
    text = replace_once(text, validation_anchor, validation)

    forbidden = [
        'timeout-minutes: 115',
        'qualification v3',
        'qualify-v3',
        '1784952600000',
        '1784955900000',
    ]
    required = [
        "START_UTC: '2026-07-25T08:30:00Z'",
        "END_UTC: '2026-07-25T09:25:00Z'",
        "EVALUATE_UTC: '2026-07-25T09:30:30Z'",
        'timeout-minutes: 180',
        'Qualification time budget invalid',
        f"cron: '{ARM_CRON}'",
        "github.event_name == 'schedule'",
        '.github/complete-history-12-slot-qualification-995-v4.json',
    ]
    missing = [value for value in required if value not in text]
    remained = [value for value in forbidden if value in text]
    if missing or remained:
        raise SystemExit(f'generated workflow validation failed: missing={missing} remained={remained}')

    TARGET.write_text(text)
    TRIGGER.write_text(f'qualify-v4-{START_MS}-{END_MS}-{RUNTIME_SHA}\n')
    PLAN.write_text(json.dumps({
        'generatedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'workflowArmUtc': '2026-07-25T08:05:00Z',
        'prepareUtc': PREPARE_UTC,
        'startUtc': START_UTC,
        'endUtc': END_UTC,
        'evaluateUtc': EVALUATE_UTC,
        'startJst': '2026-07-25T17:30:00+09:00',
        'endJst': '2026-07-25T18:25:00+09:00',
        'evaluateJst': '2026-07-25T18:30:30+09:00',
        'timeoutMinutes': TIMEOUT_MINUTES,
        'finalizationBudgetSeconds': FINALIZATION_BUDGET_SECONDS,
        'runtimeSha': RUNTIME_SHA,
        'status': 'staged',
    }, indent=2) + '\n')


if __name__ == '__main__':
    main()
