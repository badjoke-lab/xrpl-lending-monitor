# Implementation status update

Last updated: 2026-08-15.

This file is the short-form execution pointer. Before any new implementation unit or production operation, reconcile it with `development-roadmap.md`, `implementation-status.md`, the controlling GitHub issues, current `main`, and retained production evidence. Do not advance from an older chat summary.

## Current front

XRPL Lending Monitor is **not formally released**.

The current engineering front is **R5 revision-4 one-minute Devnet activation / continuation**, not early R4F G3-G10 qualification.

The target normal scheduler cadence is `* * * * *` (once per minute). Revision-4 qualification and the authorized activation path have progressed to a real Devnet smoke, but the R5 minute driver is **not active yet**.

On 2026-08-15 the retained zero-progress `revision4_resource_halt` batch was rearmed through the dedicated expiring owner-authorization path. A subsequent activation reached all of the following successfully: exact authorization verification, old-collector pause, quiescent-boundary verification, exact revision-4 R5 executor deployment, exact minute-driver deployment, and API-key resolution. The real Devnet history smoke then failed before scheduler promotion because the revision-4 prepared-head RPC entered the revision-3-only memory-retry claim and raised `r5_memory_retry_claim_run_invalid`.

The activation workflow failed closed and rolled back. The existing one-minute scheduler was **not switched** to `xrpl-r5-minute-driver`; the prior `xrpl-collector-tick` collector was restored as pg_cron job 324 on `* * * * *`. No Mainnet, stabilization, soak, public-reader, or history-reduction action was authorized by that attempt.

Root cause is now source-proven: `20260805083000_xrpl_r5_retry_memory_halt_with_half_batch.sql` added a revision-3 running-recovery memory-retry branch to the progressive prepared-head wrapper. `20260809151000_xrpl_r5_revision4_runtime_rpcs.sql` later cloned that wrapper into revision 4 while rewriting the normal claim/rebind/adoption RPCs, but the revision-3-only `xrpl_claim_r5_memory_retry_batch()` call remained. A follow-up migration on the current repair branch removes exactly that branch from the revision-4 wrapper while leaving revision 3 and all revision-4 guards intact.

The earlier database-capacity blocker was repaired on 2026-08-15. Authorized raw-evidence retention, cron-history physical compaction, and row-preserving raw-evidence physical compaction reduced the production database below the internal 400,000,000-byte stop line. Independent post-retention verification passed with approximately 30 MB of headroom and preserved current/predecessor raw integrity.

## Current execution order

1. Merge and locally/CI-verify the revision-4 prepared-head memory-retry routing fix. Do not modify the historical revision-3 retry path.
2. Apply the new migration only through the repository's existing production migration authorization path; bind exact current `main`, migration identity, and production state. No direct production SQL.
3. Re-run a fresh read-only minute-activation prepare against the post-migration production state. Never reuse a prior activation authorization.
4. Execute only the exact fresh activation authorization if every preflight, bundle digest, migration max, scheduler identity, resource snapshot, and state digest still matches.
5. Require an actual revision-4 R5 history batch to succeed before switching the scheduler to `xrpl-r5-minute-driver`.
6. Observe natural pg_cron executions and prove canonical watermark advancement, parent-hash continuity, committed-only visibility, retry/lease safety, and no duplicate or skipped ledger.
7. Reach and hold Devnet lag zero through the selected R5 path; retain terminal recovery evidence and complete the R5 exit decision.
8. Separately authorize stabilization. Do not call the service operational merely because one activation run passes.
9. Complete stabilization, remaining M5/M6 release evidence, backup/restore verification, and a real multi-day Devnet soak.
10. Perform final Devnet release verification and public-reader/release checks. Mainnet remains a separate later decision and is not authorized by this schedule.

## Definition of operational Devnet release

For schedule tracking, `operational` means the production Devnet monitor is automatically collecting on the selected once-per-minute R5 schedule, continuously advancing verified canonical state/history, preserving integrity and resource guards, and serving the resulting public read model without per-run manual authorization. It must have passed the required stabilization and soak gates. A one-shot proof, a database cleanup, a scheduler prepare step, a deployed-but-unscheduled driver, or a single successful batch is not sufficient.

## Documentation debt discovered 2026-08-15

`implementation-status.md` and `development-roadmap.md` contain older phase prose that predates the current R5 revision-4 activation front. They must not override this short-form execution pointer or the controlling Issue #1261/#1175 production evidence. Their top-level current-state sections must be reconciled with this file as part of the current repair work rather than left as a later chat-only correction.

Until that reconciliation is merged, this file plus the controlling Issue #1261/#1175 evidence identifies the active execution front above. No Mainnet, retired Cloudflare collector restart, or history-destructive shortcut is authorized.
