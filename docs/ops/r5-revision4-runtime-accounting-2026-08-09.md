# R5 revision-4 runtime accounting — 2026-08-09

Issue: `#1261`.

This branch converts the R5 recovery executor away from revision-3 blanket all-direction egress accounting without changing the user-visible monitoring specification.

## Runtime envelope

- memory-qualified claim cap: 12 ledgers;
- steady target: 2 claims/minute = 24 ledgers/minute;
- catch-up floor: 3 claims/minute = 36 ledgers/minute;
- 31-day steady invocations: 89,280;
- 31-day catch-up invocations: 133,920;
- existing invocation halt: 400,000 / 31 days;
- existing egress halt: 4 GiB / 31 days;
- maximum integer average billable egress at the required 21 ledgers/minute: 4,581 bytes/ledger.

The retained network-inclusive throughput proof already demonstrated 24 ledgers/minute steady operation and catch-up above the required 30 ledgers/minute. This branch does not repeat that proof.

## Directional accounting

The source executor now uses the revision-4 directional contract before atomic completion:

- XRPL -> Edge response bytes remain in memory/transport but are excluded from rolling billable egress;
- Edge -> XRPL, Edge -> database, database -> Edge and Edge -> invoker bytes are metered explicitly under the current conservative contract;
- per-operation framing reserve is multiplied by the actual operation count;
- the old revision-3 128 KiB function-response reservation is not charged as transmitted egress;
- the 2 MiB completion value remains only a hard transport cap, not a billable-egress assumption;
- accounting JSON and the completion request are solved to an exact byte fixed point before the commit RPC;
- the caller success response is byte-stabilized before accounting finalization.

## Fail-closed activation boundary

`supabase/functions/xrpl-r5-recovery-batch/index.ts` is wired to revision 4 in repository source but cannot activate merely by merging code:

- `XRPL_R5_REVISION4_SELECTION_DIGEST` is mandatory and no value is invented in this branch;
- `XRPL_R5_REVISION4_UNEXPLAINED_EGRESS_RESERVE_BYTES` is mandatory;
- the claim must carry revision 4 and the locked profile digest;
- claim size is capped at 12;
- projected invocations must remain below 400,000 / 31 days;
- projected egress must remain below 4 GiB / 31 days;
- memory/transport must remain below the 224 MiB project halt.

The currently deployed trigger source still carries the revision-3 run identity, so it cannot successfully invoke the repository-only revision-4 executor path. Trigger conversion follows the dedicated revision-4 DB RPC migration and remains code-only until a separate live authorization.

## Database boundary still to complete

The executor calls dedicated revision-4 RPC names:

- `xrpl_claim_r5_revision4_recovery_batch_from_prepared_head`;
- `xrpl_complete_r5_revision4_recovery_batch`;
- `xrpl_fail_r5_revision4_recovery_batch`.

Those RPCs must be added as a repository migration and validated by empty-database replay before this PR is ready to merge. Existing revision-3 control records remain historical and must not be relabeled as revision 4.

The first executor-wiring CI failure was caused by obsolete tests that explicitly required the executor to remain revision 3. Those assertions were updated to the new code-only, selection-gated revision-4 boundary. The underlying reserve-before-read, continuity, terminal-failure and service-key safeguards remain required.

## Live boundary

This work is repository-only. It does not deploy an Edge Function or migration, pause the collector, authorize R5 mutation, change the public reader, enable Mainnet, or authorize stabilization/soak. A future live R5 recovery remains separately owner-authorized.
