# R4F G9 revision-4 bounded proof-unit contract

Date: 2026-08-08  
Updated: 2026-08-11  
Issue: #1261  
Status: authorization/execution verifier prepared; no G9 authorization exists

## Purpose

G9 permits exactly one production-shaped but separately bounded revision-4 proof unit after the required G1-G8 prerequisite evidence is satisfied. Preparing the verifier is not authorization. No one-shot marker, owner authorization comment, or execution request is created by this change.

## Preconditions

A qualifying G9 record requires retained SHA-256 evidence digests for G1-G8.

G1, G2, and G4-G8 remain strict pass prerequisites. G3 is represented separately because the bounded provider-isolation experiment reached a provider-observability limit rather than a protocol/runtime failure.

The owner decision on Issue #1261, comment `5235290732`, closes the live G3 isolation loop as **provider-surface unqualifiable**: the retained Usage interval was valid, but concurrent normal traffic and the provider dashboard/log resolution prevent attribution of the one-shot egress delta. The decision explicitly says not to rerun G3 and instead to continue with implementation/resource optimization and exact revision-4 accounting.

The verifier therefore permits G3 to satisfy the G9 prerequisite in exactly two mutually exclusive ways:

1. `g3Passed: true`, with no provider-surface disposition attached; or
2. `g3Passed: false` plus a `provider_surface_unqualifiable` disposition bound to all of:
   - Issue `1261`;
   - owner `badjoke-lab`;
   - decision comment `5235290732`;
   - SHA-256 of the exact UTF-8 markdown comment body: `3555fdf430271fa6611b473380499aa153610e96253f7fbf22b10885a5040ab5`.

This exception does **not** convert G3 into a pass. Machine output keeps `allEightPrerequisitesPassed: false` when the disposition path is used, while `allRequiredPrerequisitesSatisfied` can become true. `g3ProviderSurfaceUnqualifiableAccepted` records which path was used. An invalid, missing, or ambiguous disposition remains fail-closed.

This contract does not authorize another G3 pause, provider-isolation run, R5 mutation, deployment, public-reader change, Mainnet action, stabilization, or soak.

## Owner authorization

The one proof unit must still be separately authorized on Issue #1261 by repository owner `badjoke-lab`. Authorization is bound to:

- exact authorization comment ID and digest;
- exact source commit;
- revision `4` and the revision-4 profile identity digest;
- authorization timestamp and expiry;
- exactly one proof unit;
- exact start/end ledger range;
- explicit invocation budget;
- explicit billable-egress budget;
- explicit memory budget;
- unchanged 12-ledger claim cap.

The captured execution must fall inside the authorization time window. Authorization from another issue, owner, source commit, or profile identity is rejected.

The G3 disposition decision is not a G9 execution authorization. Comment `5235290732` explicitly authorizes no R5 mutation or deployment.

## Bounds

The authorized ledger range must be positive and no larger than the fixed 12-ledger claim cap. Invocation, egress, and memory budgets must each be positive and strictly below the project-wide invocation, 4 GiB rolling egress, and memory halts encoded by the revision-4 profile. This avoids turning a one-shot proof authorization into a relaxation of project guards.

## Execution evidence

A qualifying future proof unit must:

- be attempted and completed exactly once;
- match the authorized ledger range exactly;
- stay within all authorization budgets;
- preserve parent-hash continuity;
- contain zero duplicate or skipped ledgers;
- expose committed rows only with no partial commit;
- consume the authorization exactly once;
- reject duplicate execution;
- create no implicitly authorized successor.

The revision-4 accounting qualifier and transactional singleton capture remain separate evidence layers. A G3 provider-surface disposition does not waive exact 12-ledger accounting qualification.

## Release boundary

G9 does not authorize public-reader cutover, Mainnet, stabilization, soak, or transaction submission. These remain closed even after a successful one-shot proof unit.

## Offline verification

```bash
bash scripts/test-r4f-revision4-bounded-proof-unit-verifier.sh
```

The retained synthetic fixture has no owner authorization and no attempted execution. It must remain `proofReady: false` with proof-required exit status `2`.

## Current conclusion

The verifier now models the formal G3 provider-surface disposition without fabricating a G3 pass. There is still no G9 owner authorization, no proof-unit execution, no revision-4 selection, and no R5 recovery authorization.
