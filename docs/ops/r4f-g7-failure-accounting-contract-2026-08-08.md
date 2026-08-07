# R4F G7 revision-4 failure accounting contract

Date: 2026-08-08  
Issue: #1261  
Status: fail-closed verifier prepared; G7 remains unresolved

## Purpose

G7 must prove that revision-4 directional billable-output accounting remains conservative across failure paths. A later successful attempt must never erase billable output or a retained failure reservation from an earlier failed, rolled-back, or reclaimed attempt.

This unit prepares an offline verifier, synthetic non-qualifying fixture, regression tests, and CLI only. It does not run a provider experiment, qualify G7, select revision 4, authorize R5 recovery, or mutate production.

## Preceding gates

Proof-ready G7 evidence requires all of the following before failure accounting can qualify:

- G3 provider reconciliation: `pass`;
- G4 memory requalification: `pass`;
- G5 steady convergence: `pass`;
- G6 moving-head catch-up convergence: `pass`;
- retained SHA-256 evidence digests for G3 through G6.

The current formal state has G3, G5, and G6 unresolved. Therefore the retained synthetic fixture and any current G7 preparation remain non-qualifying by construction.

## Fixed policy

G7 inherits the unchanged revision-4 project guards:

- rolling billable-egress halt: `4,294,967,296` bytes / 31 days;
- invocation halt: `400,000` / 31 days;
- memory halt: `234,881,024` bytes / 224 MiB;
- maximum claim: `12` ledgers.

Changing a guard is a verifier blocker, not a way to make evidence pass.

## Attempt-level accounting

Every retained attempt has a stable attempt ID and a distinct revision-4 directional accounting digest. The verifier retains three separate byte values:

1. `measuredBillableEgressUpperBoundBytes` — the directional application upper bound measured for that attempt;
2. `failureReservationUpperBoundBytes` — a whole-attempt conservative reservation used when the failure path can leave incomplete output measurement;
3. `retainedBillableEgressUpperBoundBytes` — the value carried into historical accounting.

For a failed, rolled-back, reclaimed-source, or repair-only attempt:

```text
retained = max(measured directional upper bound, failure reservation)
```

The reservation is a whole-attempt ceiling, not an additive duplicate of already measured bytes. A successful attempt has no failure reservation and retains its measured directional upper bound exactly.

This prevents two opposite errors: dropping failure output after a successful retry, and double-counting the same attempt by blindly adding a full reservation on top of a measurement the reservation already covers.

## Required failure paths

One proof-ready evidence bundle must contain each path exactly once.

### 1. Failed attempt -> retry success

- failed and retry attempts have distinct IDs and accounting digests;
- the failed attempt retains `max(measured, reservation)`;
- the retry retains its own measured upper bound;
- historical accounting is the sum of both attempts.

A retry cannot replace the failed attempt row or digest.

### 2. Rollback -> retry success

Rollback restores transactional state, not network history. Any billable output emitted before rollback remains retained. The retry appends a new accounting identity and cannot zero the rolled-back attempt.

### 3. Lease reclaim -> successor success

A reclaimed/stale attempt and its successor are distinct attempts. The reclaimed attempt keeps its failure reservation and measured output upper bound; the successor appends its own accounting. Reclaiming a lease cannot transfer or erase prior egress.

### 4. Adopted descendant

The source committed work keeps its original revision-4 accounting. The adoption operation has a separate `shadow_adopted` accounting digest. The historical total contains both source accounting and any billable output from the adoption operation.

This replaces the old revision-3 shorthand where adopted recovery rows could carry zero additional recovery egress only because standard accounting was already retained elsewhere. G7 requires that retained source accounting to be explicit in the proof bundle.

### 5. Repair-only separation

A repair-only retained reservation remains part of historical safety accounting but must not be included in the ordinary successful-batch cost baseline. The verifier computes and checks separately:

- historical retained billable upper bound;
- ordinary successful billable upper bound;
- failure-path retained billable upper bound;
- repair-only retained billable upper bound;
- adoption-operation billable upper bound.

This preserves failure history without repeating the revision-3 mistake of treating repair-only full reservations as ordinary successful workload cost.

## Directional disposition binding

Attempt roles are bound to revision-4 directional meter dispositions:

| Attempt role | Required disposition |
| --- | --- |
| ordinary success | `shadow_completed` |
| failed | `shadow_failed` |
| retry success | `shadow_retry` |
| rolled back | `shadow_failed` |
| reclaimed source | `shadow_failed` |
| reclaim success | `shadow_retry` |
| source committed | `shadow_completed` |
| adoption | `shadow_adopted` |
| repair only | `shadow_repair` |

A role/disposition mismatch is rejected.

## Resource and identity checks

Every attempt also retains invocation count, maximum peak memory, and maximum claim size. G7 rejects:

- an attempt at or above the 224 MiB project memory halt;
- a claim above 12 ledgers;
- invalid or duplicate attempt identities;
- invalid or duplicate accounting digests;
- missing path evidence digests;
- changed revision/profile identity;
- secret-bearing evidence.

## Safety boundary

Proof evidence remains invalid if it uses production credentials or production mutation, commits R5 recovery mutation, submits a transaction, changes the public reader, enables Mainnet, authorizes stabilization, or authorizes soak.

## Offline verification

```bash
bash scripts/test-r4f-revision4-failure-accounting-verifier.sh
```

The retained synthetic fixture must return `proofReady: false` and proof-required mode must exit with status `2` because G3, G5, and G6 remain unresolved.

A future bounded G7 replay uses:

```bash
node .tmp/r4f-revision4-failure-accounting-verifier.mjs \
  --input <bounded-failure-accounting.json> \
  --output <verified.json> \
  --require-proof-ready
```

## Current conclusion

The G7 failure-accounting verifier is prepared only. G7 remains `unresolved`; revision 4 remains `not_selected`; R5 recovery mutation remains unauthorized; the public reader remains unchanged; Mainnet remains disabled; stabilization and soak remain unauthorized.
