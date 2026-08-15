# Implementation status update

Last updated: 2026-08-15.

This file is the short-form execution pointer. Before any new implementation unit or production operation, reconcile it with `development-roadmap.md`, `implementation-status.md`, the controlling GitHub issues, current `main`, and retained production evidence. Do not advance from an older chat summary.

## Current front

XRPL Lending Monitor is **not formally released**.

The current engineering front is **R5 revision-4 one-minute Devnet activation / continuation**, not early R4F G3-G10 qualification.

Revision-4 qualification progressed beyond the stale status previously recorded in `implementation-status.md`: an authorized one-minute activation path was prepared and attempted on 2026-08-13. The target normal scheduler cadence is `* * * * *` (once per minute). The observed activation attempt failed closed and retained the existing scheduler instead of claiming success.

A later database-capacity blocker was repaired on 2026-08-15. Authorized raw-evidence retention, cron-history physical compaction, and row-preserving raw-evidence physical compaction reduced the production database below the internal 400,000,000-byte stop line. Independent post-retention verification passed with approximately 30 MB of headroom and preserved current/predecessor raw integrity.

## Current execution order

1. Reconcile the current `main`, Issue #1261, Issue #1175, scheduler identity, recovery watermark, validated Devnet head, and resource state with a fresh read-only preflight.
2. Re-prepare the revision-4 one-minute activation against the current `main`; never reuse an expired authorization or an authorization bound to an older commit/state.
3. Execute only the exact fresh authorization if every preflight and state digest still matches.
4. Require an actual revision-4 R5 history batch to succeed and require the scheduler switch to the one-minute R5 driver to be observed. A prepared command or successful workflow invocation alone is not activation success.
5. Observe natural pg_cron executions and prove canonical watermark advancement, parent-hash continuity, committed-only visibility, retry/lease safety, and no duplicate or skipped ledger.
6. Reach and hold Devnet lag zero through the selected R5 path; retain terminal recovery evidence and complete the R5 exit decision.
7. Separately authorize stabilization. Do not call the service operational merely because one activation run passes.
8. Complete stabilization, remaining M5/M6 release evidence, backup/restore verification, and a real multi-day Devnet soak.
9. Perform final Devnet release verification and public-reader/release checks. Mainnet remains a separate later decision and is not authorized by this schedule.

## Definition of operational Devnet release

For schedule tracking, `operational` means the production Devnet monitor is automatically collecting on the selected once-per-minute R5 schedule, continuously advancing verified canonical state/history, preserving integrity and resource guards, and serving the resulting public read model without per-run manual authorization. It must have passed the required stabilization and soak gates. A one-shot proof, a database cleanup, a scheduler prepare step, or a single successful batch is not sufficient.

## Documentation debt discovered 2026-08-15

`implementation-status.md` still says R4F G3 is the oldest unresolved gate and `development-roadmap.md` was last recalibrated on 2026-07-08. Those statements are stale relative to the retained August R5/revision-4 production evidence. They must be reconciled before further roadmap-dependent implementation is treated as authoritative.

Until that reconciliation is merged, this file plus the controlling Issue #1261/#1175 evidence identifies the active execution front above. No Mainnet, retired Cloudflare collector restart, or history-destructive shortcut is authorized.
