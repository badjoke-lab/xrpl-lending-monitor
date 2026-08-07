# R4F G9 revision-4 bounded proof-unit contract

Date: 2026-08-08  
Issue: #1261  
Status: authorization/execution verifier prepared; no G9 authorization exists

## Purpose

G9 permits exactly one production-shaped but separately bounded revision-4 proof unit only after G1-G8 pass. Preparing the verifier is not authorization. No one-shot marker, owner authorization comment, or execution request is created by this change.

## Preconditions

A qualifying G9 record requires all G1-G8 states to be `pass` plus a retained SHA-256 digest for every gate. Current G3 and G5-G8 states are unresolved, so G9 cannot execute or qualify.

## Owner authorization

The one proof unit must be authorized on Issue #1261 by repository owner `badjoke-lab`. Authorization is bound to:

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

## Bounds

The authorized ledger range must be positive and no larger than the fixed 12-ledger claim cap. Invocation, egress, and memory budgets must each be positive and strictly below the project-wide 400,000 invocation, 4 GiB rolling egress, and 224 MiB memory halts. This avoids turning a one-shot proof authorization into a relaxation of the project guards.

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

## Release boundary

G9 does not authorize public-reader cutover, Mainnet, stabilization, soak, or transaction submission. These remain closed even after a successful one-shot proof unit.

## Offline verification

```bash
bash scripts/test-r4f-revision4-bounded-proof-unit-verifier.sh
```

The retained synthetic fixture has no owner authorization and no attempted execution. It must remain `proofReady: false` with proof-required exit status `2`.

## Current conclusion

Only the verifier is prepared. There is no G9 owner authorization, no proof-unit execution, no revision-4 selection, and no R5 recovery authorization.
