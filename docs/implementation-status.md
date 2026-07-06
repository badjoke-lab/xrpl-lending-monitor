# Implementation status

Last updated: 2026-07-07.

## Current phase

The canonical-history and replacement-base cutover has completed on XRPL Devnet. Production history now runs in verified hybrid mode: immutable canonical history covers ledgers `3371676..3432924`, and D1 live continuation covers the boundary after ledger `3432924`. The canonical chain contains `61,249` ledgers in `123` immutable segments and is published through the exact-commit history channel with an exact index containing `280,454` records.

The active current-state base is now `devnet-3432924-canonical` at ledger `3432924`. The guarded replacement-base rebase completed successfully, the D1 cursor and replacement overlay watermark are aligned, and scheduled collection resumed from ledger `3432925`. A post-cutover production probe observed the cursor at `3433244`, the validated head at `3447507`, zero collector failures, and one successful 40-ledger run using 48 estimated rows, 47 estimated statements, and zero overlay mutations. The replacement-base operator now treats a correctly bound target snapshot with a later aligned live cursor as an idempotent replay/no-op.

Production current-state exact reads for a verified Vault, Loan Broker, and Loan all returned HTTP 200 from the replacement snapshot. Production history-source diagnostics report verified hybrid mode with canonical end ledger `3432924`, `123` segments, `61,249` ledgers, and the exact index present.

M1-HYB-7 verification is now boundary-aware. All continuation evidence is evaluated after the active replacement base, while processed-ledger continuity is anchored to the replacement base ledger/hash. Current post-cutover evidence already observes ledger continuity and cursor/overlay agreement. The remaining semantic paths are still `missing` because the corresponding live protocol events have not yet naturally appeared after the new boundary, and freshness remains incomplete until the collector reaches the observed validated head.

M5-5 and M6 remain gated behind M1 exit.

## Canonical history and replacement base

The production immutable history range is fixed to:

- epoch: `devnet-3371675`;
- start ledger: `3371676`;
- end ledger: `3432924`;
- ledger count: `61,249`;
- segment count: `123`;
- terminal ledger hash: `52C13CBFFC3433750DBBB986390C4C6E6F7CC82CF70B4B909C506536A8BD9218`.

The active replacement current-state base is:

- epoch: `devnet-3371675`;
- snapshot: `devnet-3432924-canonical`;
- ledger index: `3432924`;
- ledger hash: `52C13CBFFC3433750DBBB986390C4C6E6F7CC82CF70B4B909C506536A8BD9218`.

The previous verified base remains retained as historical architecture evidence:

- snapshot: `devnet-3371675-0ba2ed766c19`;
- ledger index: `3371675`;
- ledger hash: `0BA2ED766C190C733F8F26288785CBDF01D0FC26E1A6C03EDB7E9DFF6F8BCB90`;
- 797,550 Vault records;
- 528,228 Loan Broker records;
- 226,725 Loan records;
- 1,552,503 total current-state records.

## Completed path

The implemented and verified path now includes:

- verified immutable base publication and lightweight current-state reading;
- bounded D1 incremental history and current overlay;
- atomic history, overlay, watermark, and cursor advancement;
- base-plus-overlay current API resolution;
- bounded scheduled collection with RPC, transaction, row, statement, overlay, and execution-time ceilings;
- retry and fallback request accounting;
- collector cursor, lag, freshness, and run-usage status;
- guarded initial handover from the observation epoch to the original verified base;
- deterministic immutable history-segment generation;
- deterministic segment replay;
- exact adjacent-segment index and parent-hash continuity checks;
- checkpoint/resume state advancing only after complete validated manifests;
- ordered full-chain verification;
- canonical publication binding exact chain boundaries, ordered segment identities, manifest digests, predecessor linkage, and per-kind counts;
- exact-commit channel opening that pins publication, manifests, segment assets, and exact index to one immutable data commit;
- bounded immutable segment reads;
- boundary-aware D1 history reads;
- deterministic immutable-plus-live merge semantics with overlap suppression, deduplication, stable ordering, and post-merge truncation;
- hybrid Activity, Object History, Loan lifecycle, Archives, Balance History, Transaction Detail, and cross-history Search support;
- exact-index manifest binding and exact-term bucket routing;
- exact-index extraction for transaction hashes, object IDs, relationships, accounts, owners, borrowers, asset keys, lifecycle terms, and balance-history terms;
- canonical full-chain generation for `3371676..3432924`;
- successful verification of all `123` segments and the exact terminal boundary;
- canonical publication and exact index generation;
- exact lookup rehearsal against the published full chain;
- replacement current-state read-model reconstruction at ledger `3432924`;
- separate history and current-state candidate publication;
- production-reader remote candidate rehearsal for boundary identity, current-state list/exact reads, exact history references, and recent immutable history reads;
- guarded same-epoch replacement-base rebase planning and execution;
- pre/post sync, overlay, and epoch guards around the replacement rebase batch;
- read-only production D1 dry-run proving the live rebase plan was ready before activation;
- replacement rebase execution from cursor `3390079` to base ledger `3432924`;
- D1 continuation from ledger `3432925` onward;
- idempotent replacement-base replay semantics after the live cursor advances beyond the replacement target;
- production hybrid history activation;
- production replacement current-state promotion;
- successful post-cutover production exact reads for Vault, Loan Broker, and Loan;
- boundary-aware HYB-7 evidence and drilldown after the active replacement base;
- boundary-aware M1 exit evidence using the replacement target as authoritative expected base;
- permanent read-only runtime monitoring and explicit history-source diagnostics.

Mainnet remains disabled.

## Latest live evidence

The guarded replacement-base cutover was executed after a production D1 dry-run returned `status: ready` and `action: rebase`. At dry-run time the old cursor was `3390079`, the old overlay watermark matched that cursor, sync health was healthy, and the validated head was already beyond the replacement target.

After cutover, the first probe showed that the rebase had completed and the collector had advanced to `3432964`. That probe also exposed an idempotency gap: the original rebase planner rejected a later cursor even when the replacement target overlay was correctly bound and aligned with the cursor. The planner was corrected so a bound target snapshot with an aligned later cursor returns `replay` rather than attempting another rebase or blocking scheduled collection.

The successful post-fix probe then observed:

- replacement target: `devnet-3432924-canonical`;
- replacement target ledger: `3432924`;
- replacement rebase status: `replayed`;
- live cursor: `3433244`;
- validated head: `3447507`;
- lag: `14,263` ledgers;
- sync health: healthy;
- collector status: behind;
- latest run: 40 ledgers processed;
- estimated rows: 48;
- estimated statements: 47;
- overlay mutations: 0;
- consecutive failures: 0;
- history mode: hybrid;
- canonical history end: `3432924`;
- exact index records: `280,454`;
- active current-state snapshot: `devnet-3432924-canonical`;
- Vault exact read: HTTP 200;
- Loan Broker exact read: HTTP 200;
- Loan exact read: HTTP 200.

The current HYB-7 report after the replacement boundary has:

- `ledgerContinuity`: observed;
- `cursorOverlay`: observed;
- `createdCurrent`: missing;
- `modifiedCurrent`: missing;
- `loanPayment`: missing;
- `impaired`: missing;
- `unimpaired`: missing;
- `defaulted`: missing;
- `deletionArchive`: missing;
- `activityHistoryBalance`: missing;
- `freshness`: missing while the collector remains behind the validated head.

The current M1 gates have:

- `verifiedBaseBinding`: observed;
- `catchUpStart`: observed;
- `validatedHeadReached`: missing;
- `liveContinuation`: missing.

## Collector budgets

The original 128-row ceiling was too low for observed dense ledgers. Full canonical history analysis found an estimated 143 derived rows at ledger `3390080`, the exact ledger where the previous live collector stopped under the generic run-budget guard. Earlier live benchmarking of 2048 statement / 2048 row / 128 overlay-mutation ceilings completed six samples with zero failures, processed 40 ledgers on every sampled run, and showed negative lag slope.

Production cutover therefore uses:

- max ledgers per run: 40;
- max statements per run: 2048;
- max rows per run: 2048;
- max overlay mutations per run: 128;
- max ledger RPC requests per run: 44;
- max inspected transactions per run: 12,000;
- execution budget: 45 seconds;
- deadline margin: 5 seconds.

These are ceilings, not write targets. Runtime monitoring must continue to observe actual D1 write volume and lag slope.

## HYB-7 verification semantics

The verifier exposes each required live path as `observed`, `missing`, or `inconsistent`.

- zero required evidence remains `missing` and never passes by default;
- contradictory source/projection evidence is `inconsistent`;
- the overall report passes only when every required path is `observed`;
- processed-ledger continuity begins at the active replacement base boundary and validates parent-hash linkage from that anchor;
- object changes, protocol activity, lifecycle, archives, balance history, managed transitions, loan activity, and drilldown linkage are evaluated only after the active base boundary;
- archive and tombstone evidence is checked in both directions;
- cursor and overlay watermark must agree;
- freshness passes only at healthy zero reported lag.

The verification and diagnostics endpoints are read-only. They do not create live evidence or infer success from the target schedule.

## Active unit

The active implementation unit is no longer historical backfill. Canonical immutable history, exact index, hybrid history activation, replacement current-state reconstruction, guarded D1 rebase, and production current-state promotion are complete.

The active operational unit is now:

1. continue bounded D1 collection from `3432925` toward the validated head;
2. verify sustained zero-failure operation and actual D1 write usage under the 2048/2048/128 ceilings;
3. observe natural post-boundary HYB-7 evidence for the remaining protocol paths;
4. confirm `validatedHeadReached` and freshness at zero lag;
5. complete M1 exit review;
6. proceed to M5-5 and M6 hardening.

## Next order

1. Monitor collector lag slope and write usage while the replacement-base continuation advances.
2. Keep replacement-base replay status, cursor/overlay agreement, and history-source diagnostics under permanent monitoring.
3. Re-evaluate HYB-7 paths as real post-boundary LoanPay, LoanManage, deletion, and balance-changing activity appears.
4. Confirm the collector reaches the observed validated head and freshness becomes observed.
5. Complete M1 exit review and reconciliation.
6. Complete M5-5 and M6 hardening.

## Remaining blockers

- The production cursor has not yet reached the validated head.
- Real post-replacement-boundary HYB-7 evidence has not yet naturally appeared for created/modified current objects, LoanPay, impairment, unimpairment, default, deletion/archive, and activity/lifecycle/balance consistency paths.
- Freshness remains missing until collector lag reaches zero with healthy status.
- M1 exit remains incomplete until `validatedHeadReached` and all required live continuation paths are observed and consistent.
- M5-5 and M6 remain incomplete.
