# Implementation status

Last updated: 2026-07-05.

## Current phase

M1 incremental continuation is active. M1-HYB-6 guarded catch-up handover implementation is ready and green. The actual production catch-up execution has not started. M5-5 and M6 remain gated behind M1 exit.

## Verified base

The active Devnet base is fixed to ledger `3371675` and contains:

- 797,550 Vault records;
- 528,228 Loan Broker records;
- 226,725 Loan records;
- 1,552,503 total current-state records.

## Completed continuation path

The implemented path now includes:

- verified immutable base read model publication;
- bounded D1 incremental history and current overlay;
- atomic history, overlay, watermark, and cursor advancement;
- base-plus-overlay current API resolution;
- bounded scheduled collection with deadline and work limits;
- retry and fallback request accounting;
- collector cursor, lag, freshness, and run-usage status;
- rehearsal evidence for interruption, resume, replay, and rejected gaps;
- cursor and overlay watermark checkpoint agreement;
- base-count plus create/delete delta reconciliation;
- relationship reconciliation issue propagation;
- deleted-object current exclusion and archive-presence checks;
- guarded one-time handover planning from the observation epoch to the verified base epoch;
- dry-run inspection, exact replay/no-op handling, and progressed-state no-op handling;
- pre/post sync, overlay, history, and epoch guards around the handover batch;
- fail-closed rejection for reset suspicion, unavailable network state, existing conflicting cursor/history/overlay state, and epoch mismatch;
- scheduled-path gating behind an explicit catch-up initialization flag that defaults to disabled.

Mainnet remains disabled.

## HYB-6 readiness

The guarded handover implementation is validated by lint, type-check, unit tests, local D1 migrations, application build, browser smoke test, and release-native checks.

The implementation is ready to:

1. inspect the remote Devnet sync, epoch, overlay, and processed-ledger state;
2. dry-run the verified-base handover decision;
3. refuse any conflicting existing state;
4. initialize the sync cursor and overlay watermark at the verified base ledger in one guarded D1 batch;
5. preserve the latest observed validated head;
6. allow the bounded scheduled collector to continue from base ledger plus one;
7. become a safe no-op after successful initialization or later aligned catch-up progress.

## Active unit

M1-HYB-6 production execution and verification remains active.

## Next order

1. Merge the green HYB-3 through HYB-6 implementation chain into `main` in dependency order.
2. Deploy the merged migrations and Worker code through a verified remote execution path.
3. Inspect remote Devnet state and run the guarded handover dry-run.
4. Execute the guarded handover only if the remote evidence matches the fresh-initialization or aligned-replay contract.
5. Start bounded catch-up from ledger `3371676`.
6. Verify real Devnet created, modified, paid, impaired, defaulted, and deleted objects.
7. Complete continuous-monitoring verification and M1 exit review.
8. Complete M5-5, then begin M6 hardening and multi-day Devnet soak.

## Remaining blockers

- The stacked HYB-3 through HYB-6 PR chain is not yet merged to `main`.
- Remote migrations and Worker deployment for the catch-up path are not yet verified.
- Production catch-up has not started.
- Continuous Devnet monitoring verification is not complete.
- M1 exit reconciliation evidence is incomplete.
- M5-5 and M6 remain incomplete.
