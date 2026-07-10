# T5 fixed-target canonical catch-up design — 2026-07-10

## Status

Design and deterministic planning work only. This document does not authorize production cutover, does not start M6, and does not change the M5-5 gate.

Production remains protected by the four-hour WSS32 window-4 schedule recorded in `docs/ops/t5-d1-persistence-bottleneck-2026-07-10.md`.

## Problem statement

T5-1 showed that transport is no longer the active bottleneck in the measured dense backlog region. One WSS32 run can read 32 validated ledgers through one WebSocket connection, but the guarded commit prefix reached configured row/statement ceilings after only 9–10 ledgers. Three retained runs wrote 2,493, 2,578, and 2,294 D1 rows while the cursor advanced 19 ledgers across a period in which the observed head advanced 199 ledgers.

The recovery path therefore must not assume that higher WebSocket scan capacity produces equivalent cursor throughput. The preferred next path is to generate a fixed immutable backlog range outside the Worker/D1 hot path, reconstruct current state at the same fixed terminal ledger, rehearse both candidate sources, and use the existing guarded same-epoch rebase before returning the Worker to bounded live-tail continuation.

## Existing reusable components

The repository already contains the following deterministic components.

1. History range planner
   - accepts arbitrary epoch, start ledger, end ledger, segment limit, and checkpoint cadence;
   - validates contiguous segment coverage and bounded segment size.
2. History segment generator and checkpoint updater
   - generates deterministic segment artifacts from validated ledgers;
   - links each segment to predecessor identity and predecessor terminal hash;
   - advances checkpoint state only after a complete manifest.
3. Full-chain verifier and publication builder
   - verifies ordered manifests, parent-hash continuity, exact start boundary, and exact terminal boundary;
   - builds publication identity and digest.
4. Exact history index builder and rehearsal
   - builds bounded exact-term buckets against a complete publication;
   - rehearses real exact lookups against generated artifacts.
5. Replacement current-state read-model compiler
   - starts from a complete verified source snapshot;
   - requires publication to begin immediately after that source base;
   - verifies publication digest and segment mutation assets;
   - applies globally ordered current-projection mutations;
   - emits paged current state and exact lookup buckets at the publication terminal ledger/hash.
6. Separate candidate publication workflows
   - history and current state are published independently to candidate branches.
7. Candidate source rehearsal
   - requires history terminal ledger/hash to equal current-state manifest ledger/hash;
   - exercises current list/exact reads and immutable exact/recent history reads.
8. Guarded replacement-base rebase
   - requires the target to remain in the active epoch;
   - rejects error/reset-suspected states and targets ahead of observed validated head;
   - requires exactly one overlay aligned with the active cursor;
   - inserts target overlay state and cursor compare-and-set inside one guarded D1 batch;
   - verifies the post-condition and supports aligned replay/no-op semantics.

## Missing orchestration

The old full-continuation and candidate-publication workflows are not reusable unchanged. They contain frozen values for:

- old Actions artifact run IDs;
- old range `3371676..3432924`;
- old segment ordinals `1..123`;
- old chain ID;
- old target snapshot ID and release tag;
- old candidate verification counts and terminal ledger values.

The first missing deterministic unit is a source-bound extension plan. The plan must bind:

- source chain ID;
- source publication SHA-256;
- source terminal ledger index/hash;
- source terminal segment ID;
- fixed target ledger index/hash;
- extension start/end and inclusive ledger count;
- segment limit and checkpoint cadence;
- ordered segment ranges;
- predecessor anchor identity/hash for the first extension segment.

No extension generation workflow may infer a different target after the plan is created.

## Fixed-target capture rule

The production extension workflow must capture one validated Devnet target identity before planning:

```text
ledger index
ledger hash
capture timestamp
endpoint identity
```

The target ledger index/hash must be written to retained evidence and passed into the extension planner. The planner then verifies the current source publication digest and derives extension start as exactly:

```text
source publication end ledger + 1
```

The target may not be `validated` as a moving alias during segment generation. Every segment and final chain verification is evaluated against the fixed numeric target and fixed terminal hash.

## Proposed extension workflow

### Stage E0 — source and target freeze

1. Open production `history-data` channel by exact commit.
2. Verify publication digest and exact-index binding.
3. Record current publication terminal identity.
4. Capture one validated Devnet target ledger index/hash.
5. Build and retain `HistoryExtensionPlan`.
6. Fail if source publication changes between source capture and extension generation start.

### Stage E1 — immutable extension generation

1. Materialize the existing production immutable history tree as the source prefix.
2. Generate only extension segments from `source.end + 1` through the fixed target.
3. Seed the first generated segment with:
   - `previousSegmentId = source.lastSegmentId`;
   - `previousSegmentEndHash = source.endLedgerHash`.
4. Continue bounded segment generation with retry ceilings and checkpoint persistence.
5. Fail closed on any ledger identity mismatch, parent-hash discontinuity, incomplete manifest, or checkpoint disagreement.

### Stage E2 — full-chain publication rebuild

The new production candidate publication represents the full immutable range, not only the extension suffix.

1. Combine the existing verified prefix segment manifests with new extension manifests in ledger order.
2. Verify the entire chain from the original immutable base parent hash through the fixed target hash.
3. Build a new full-chain publication with a new chain ID ending at the fixed target.
4. Build a new exact index over the complete publication.
5. Rehearse exact history lookups.
6. Retain generation metrics, publication digest, exact-index digest, total bytes, segment count, and fixed terminal identity.

### Stage E3 — replacement current-state reconstruction

The current replacement compiler consumes a release-native base snapshot plus a publication that starts immediately after that source base. Therefore the first safe implementation reuses the original complete release-native base and replays the new full publication through the fixed target.

This is intentionally preferred over inventing a second read-model-to-read-model mutation compiler during recovery.

Required checks:

1. source snapshot is complete and remains the expected epoch/base identity;
2. publication starts at source base ledger + 1;
3. publication start parent hash equals source base hash;
4. publication digest passes;
5. all current-projection mutation assets pass digest/count checks;
6. mutation stream remains globally ordered;
7. emitted current-state manifest terminal ledger/hash equals fixed target;
8. history publication terminal ledger/hash equals current-state manifest terminal ledger/hash.

### Stage E4 — candidate publication and remote rehearsal

Publish separately to:

- `history-candidate-data`;
- `current-state-candidate-data`.

Then run remote-reader rehearsal requiring:

- same epoch;
- exact same terminal ledger/hash;
- current Vault/Broker/Loan list reads;
- current exact reads;
- history exact-index reads;
- recent immutable history reads;
- bounded asset/segment read counts.

No production branch is changed in this stage.

## Production cutover order

The old cutover proved the components separately but relied on several operational steps. T5-2 should make the order explicit and retained.

### C0 — freeze and preflight

- keep four-hour protection cadence;
- ensure no other recovery/deploy workflow can write the same branches or change the rebase target;
- confirm current D1 cursor/overlay alignment;
- confirm network state is not error/reset-suspected;
- confirm observed validated head is at or beyond target;
- run replacement-base dry-run and require `status=ready`, `action=rebase`;
- re-run candidate source rehearsal immediately before cutover.

### C1 — activate immutable history source

Promote the exact rehearsed history candidate commit/channel to `history-data` without rebuilding artifacts.

Postcondition:

- production history-source diagnostics open the exact expected publication digest;
- chain terminal equals fixed target;
- exact index is available.

If this fails, do not continue to D1 rebase.

### C2 — guarded D1 rebase

Deploy/configure the fixed replacement target identity and execute the existing guarded same-epoch rebase.

Required evidence:

- preflight plan still refers to the same old cursor/overlay identity or a new dry-run is taken;
- target is not ahead of observed validated head;
- D1 batch completes;
- post-plan returns aligned replay/no-op state;
- cursor and target overlay watermark equal target ledger/hash.

If this fails, do not promote current-state data.

### C3 — promote replacement current state

Promote the exact rehearsed current-state candidate commit/channel to `current-state-data` without rebuilding.

Required evidence:

- production current-state manifest snapshot ID equals target snapshot ID;
- manifest ledger/hash equals target;
- Vault/Broker/Loan exact reads succeed;
- active D1 overlay base identity equals the same target snapshot/ledger/hash.

### C4 — resume bounded live tail

Only after C1–C3 pass:

- return scheduled collector cadence to an explicitly approved live-tail profile;
- live collector starts from `target + 1`;
- retain cursor/head/lag, persistence D1 metrics, Worker outcome, continuity, and current/history boundary evidence;
- do not call M5-5 browser evidence until freshness and D1 headroom gates pass.

## Rollback and fail-closed rules

1. Before D1 rebase, candidate/history activation failures are branch-source failures; do not move cursor.
2. After D1 rebase but before current-state promotion, public current-state integrity must be treated as cutover-in-progress and production verification must fail closed rather than silently mix an old base reader with a new D1 base identity.
3. Candidate commits are immutable inputs to promotion. Never rebuild during production cutover.
4. A failed current-state promotion after successful rebase requires restoring the exact prior D1/base/source alignment using a separately rehearsed recovery procedure; do not attempt an ad hoc backward cursor move.
5. No two independent writers may advance or rebase the D1 cursor concurrently.
6. WSS64, window-8, and 128-ledger production experiments remain blocked until the new fixed-target path is rehearsed or D1 headroom evidence materially changes.

## Resource boundary

Heavy backlog work runs in GitHub Actions and Git-backed immutable data branches:

- ledger reads and segment generation;
- chain verification;
- publication build;
- exact-index build;
- replacement current-state reconstruction;
- candidate rehearsal.

D1 is reserved for:

- guarded rebase metadata update;
- bounded live-tail history/current overlay continuation after the new boundary;
- operational status and diagnostics.

This design avoids replaying the measured dense backlog through D1 history/index writes.

## Implementation sequence

1. Add and test the fixed-target extension plan contract and CLI.
2. Add a non-production extension rehearsal workflow using a small fixed range and retained evidence.
3. Add generic full-extension orchestration that consumes the frozen plan rather than old hard-coded ordinals/run IDs.
4. Add dynamic candidate publication/promotion inputs bound to artifact digests and candidate commit SHAs.
5. Rehearse a full candidate pair and remote reads.
6. Add a retained cutover preflight bundle and explicit promotion/rebase sequencing harness.
7. Only then authorize a production fixed-target catch-up cutover.

## Gates

- M5-5 remains incomplete.
- M5-5 browser evidence remains blocked while production freshness is inadequate.
- M6 has not started and remains blocked behind M5-5 exit.
- Mainnet remains disabled.
