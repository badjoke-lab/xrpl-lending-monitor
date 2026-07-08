# M6 integrity and reset baseline plan

Last updated: 2026-07-08.

## Purpose

This document defines the first executable M6 hardening unit after M5-5 exits.

It does not start M6 early. Implementation and rehearsal begin only after:

1. retained M5-5 production cross-audit evidence remains passing;
2. the production-shaped browser regression passes;
3. the browser exit evaluator reports `ready_for_m5_5_exit_reconciliation=true`;
4. M5-5 exit is reconciled in the roadmap and implementation status.

The goal is to prove that the verified immutable base plus bounded D1 incremental overlay remains correct through replay, interruption, continuity failure, reset detection, epoch transition, catch-up, and reconciliation.

## Scope boundary

The baseline is deterministic and fail closed.

It may use:

- local D1 databases;
- fixtures derived from supported validated ledger and transaction shapes;
- deterministic simulated ledger sequences;
- bounded read-only Devnet checks where separately approved;
- existing current-state, history, lifecycle, archive, status, and reconciliation code paths.

It must not:

- deliberately reset XRPL Devnet;
- fabricate a real network reset claim;
- mutate production D1 for rehearsal convenience;
- skip ledgers or parent-hash checks to complete a scenario;
- reuse an old epoch base after a simulated confirmed reset;
- collapse schedule-derived Loan status into on-ledger status;
- treat missing evidence as zero or success;
- weaken collector, D1 headroom, or production audit gates.

## Baseline invariants

Every scenario must preserve the existing integrity rules.

1. Current objects are unique by network, epoch, active base identity, object type, and object ID.
2. Current relationships remain inside one network, epoch, and active base-plus-overlay context.
3. Overlay upsert overrides the matching base object.
4. A deletion tombstone suppresses base fallback in list, detail, search, relationship, count, and aggregate resolution.
5. Absence of an overlay record falls back to the verified base object.
6. Overlay watermark never exceeds the canonical incremental cursor.
7. Cursor gaps and parent-hash discontinuities fail closed.
8. Replay produces no duplicate canonical event, object change, lifecycle event, archive record, or conflicting overlay state.
9. History persistence, overlay mutation, and cursor movement cross the canonical commit boundary together or none advances.
10. Deleted objects remain absent from current truth and remain historically available where indexed.
11. Active base identity and overlay base identity must agree; mismatch never silently falls back.
12. Old and new epochs never join implicitly.
13. Unlike assets are never aggregated.
14. Stale, interrupted, partial, and unavailable states are explicit and never labeled fresh.
15. Time alone never changes on-ledger Loan status.

## Execution order

### M6-I1 — Deterministic integrity fixture matrix

Build a reusable deterministic fixture matrix covering:

- base-only current object;
- overlay-created object;
- overlay-modified base object;
- deleted base object with tombstone;
- deleted overlay-created object;
- same identifiers in different epochs;
- same object type and ID bound to different base identities;
- Loan -> Loan Broker -> Vault relationships inside one valid context;
- broken relationship references;
- asset-separated aggregate inputs;
- lifecycle, archive, balance, and current projection evidence for one canonical transaction sequence.

Required assertions:

- read precedence is deterministic;
- invalid cross-epoch or cross-base relationships fail or remain explicitly unresolved;
- current counts reconcile from base plus created/deleted overlay effects;
- archived/current exclusion holds;
- provenance and source identities remain attached.

Exit condition: the fixture matrix is reusable by later reset, replay, recovery, API, and Explorer guardrail tests.

### M6-I2 — Atomicity, interruption, and replay

Exercise deterministic interruption points around the incremental commit boundary.

At minimum:

1. fail before canonical persistence begins;
2. fail after derived effects are prepared but before commit;
3. fail inside a transaction and verify rollback;
4. complete commit, then replay the same ledger;
5. retry a transient fetch failure without advancing cursor;
6. reject a ledger gap;
7. reject a wrong parent hash;
8. reject overlay base identity mismatch.

Required evidence:

- cursor before and after;
- overlay watermark before and after;
- canonical event counts before and after;
- object-change counts before and after;
- lifecycle/archive/balance counts before and after;
- overlay and tombstone identities before and after;
- explicit failure classification.

Exit condition: every interrupted or rejected path leaves canonical state at the last committed boundary, and replay converges without duplicates or conflicting current state.

### M6-I3 — Reset signal classification

Exercise each documented potential reset signal independently:

- latest validated ledger index lower than committed cursor;
- known ledger index with a different hash;
- incompatible or unexpectedly changed server history boundary;
- configured reset marker.

The harness must distinguish:

- `no_reset` — evidence is consistent;
- `suspected_reset` — one or more signals require confirmation and continuation stops;
- `confirmed_reset` — approved deterministic evidence is sufficient to execute epoch transition logic in the rehearsal environment;
- `inconsistent` — evidence contradicts the expected scenario and the rehearsal fails.

A single test must not silently convert an ambiguous signal into a confirmed reset.

Exit condition: each signal produces the documented stop/continue behavior and a public-safe reason without cursor advancement past the uncertainty boundary.

### M6-I4 — Epoch transition rehearsal

Using local deterministic state, rehearse a confirmed reset transition.

Required order:

1. stop incremental processing for the old epoch;
2. record final old-epoch identity and reset reason;
3. mark the old epoch historical rather than deleting it;
4. create a distinct new epoch identity;
5. prohibit reuse of the prior epoch's active base as the new epoch base;
6. require a new verified base bootstrap/publication path before new-epoch incremental continuation;
7. start new continuation at new base ledger plus one;
8. keep old historical records queryable only through explicit epoch-aware history paths;
9. expose reset context without mixing current objects from both epochs.

Required checks:

- old epoch records remain unchanged;
- new epoch has distinct identity and base binding;
- active current reads resolve only the new active context;
- no relationship crosses epochs;
- no aggregate silently spans epochs;
- reset notice and freshness state are explicit.

Exit condition: epoch transition preserves old evidence, prevents base reuse, and establishes a clean new current-state boundary.

### M6-I5 — Catch-up, stale state, and reconciliation baseline

Simulate bounded downtime windows as ledger sequences; do not claim real elapsed soak from a simulation.

Required scenarios:

- short backlog processed in more than one bounded batch;
- larger backlog requiring repeated catch-up runs;
- interruption during catch-up and exact resume;
- stale presentation while cursor remains behind;
- transition back to fresh only after required cursor/watermark/head conditions agree;
- replay of an already committed catch-up range;
- reconciliation after catch-up.

Reconciliation must compare:

- verified base identity versus overlay base identity;
- overlay watermark versus canonical cursor;
- processed-ledger continuity and hashes;
- base counts plus created/deleted overlay effects versus resolved current counts;
- current spot checks versus resolved projections;
- Broker `OwnerCount` where supported versus indexed Loan relationships;
- Loan Broker -> Vault references against current or archived Vault evidence;
- Loan -> Broker references against current or archived Broker evidence;
- asset-separated aggregates versus object-level values;
- archived/current exclusion;
- active base manifest counts and digests.

Exit condition: bounded catch-up converges to the same canonical state as uninterrupted processing, stale/fresh state transitions are evidence-based, and reconciliation records zero unexplained differences.

## Evidence contract

Each executable rehearsal unit must write machine-readable JSON and human-readable Markdown.

Minimum JSON shape:

```json
{
  "recorded_at": "UTC timestamp",
  "scenario": "stable scenario identifier",
  "network": "devnet-or-local-fixture",
  "epoch_before": "identifier",
  "epoch_after": "identifier or null",
  "base_before": "identifier",
  "base_after": "identifier or null",
  "cursor_before": 0,
  "cursor_after": 0,
  "overlay_watermark_before": 0,
  "overlay_watermark_after": 0,
  "expected_outcome": "stable outcome identifier",
  "observed_outcome": "stable outcome identifier",
  "invariants": [],
  "differences": [],
  "result": {
    "passed": true
  }
}
```

Exact fields may expand, but evidence may not omit the identities needed to prove epoch, base, cursor, and watermark boundaries.

## Baseline exit gate

The M6 integrity/reset baseline is established only when:

- M6-I1 fixture matrix is merged and reusable;
- M6-I2 atomicity/interruption/replay scenarios pass;
- M6-I3 reset-signal classification passes;
- M6-I4 epoch-transition rehearsal passes;
- M6-I5 catch-up/stale/reconciliation baseline passes;
- no unexplained reconciliation difference remains;
- no test bypasses a continuity, base-identity, epoch, or atomicity guard;
- source-of-truth documents are reconciled with actual evidence.

This baseline is one of the Explorer v1 start gates. It does not by itself authorize Explorer v1; the runtime/resource guardrail baseline must also be available.

## Handoff to runtime/resource guardrails

After this baseline passes, resource measurement must use the same representative scenarios rather than a separate simplified happy path. In particular, measure:

- normal incremental run;
- replay/idempotent run;
- bounded catch-up run;
- reconciliation run;
- representative current list/detail/search/relationship reads;
- representative history/lifecycle/archive reads.

Resource optimization must not invalidate the integrity evidence in this plan.
