# R4F G10 revision-4 selection-decision contract

Date: 2026-08-08  
Issue: #1261  
Status: final decision verifier prepared; revision 4 remains not selected

## Purpose

G10 is the final revision-4 decision boundary. It may select revision 4 only after G1-G9 all pass, including both steady and moving-head catch-up convergence and the separately authorized G9 bounded proof unit. If a hard gate has terminally failed and no gate remains unresolved, G10 may reject revision 4 and return to architecture selection. While any gate remains unresolved, the only valid state is `not_selected` and G10 is not complete.

This change prepares an offline verifier only. It does not create a selection record and does not authorize R5 recovery mutation.

## Current formal state

The retained synthetic input reflects the current gate state:

- G1: pass;
- G2: pass;
- G3: unresolved;
- G4: pass;
- G5: unresolved;
- G6: unresolved;
- G7: unresolved;
- G8: unresolved;
- G9: unresolved;
- revision 4: `not_selected`.

Therefore current G10 evidence must return `decisionReady: false` and `proofReady: false`.

## Selection rule

`selected` is valid only when:

- G1-G9 are each present exactly once and all are `pass`;
- every retained gate evidence digest is valid;
- G5 is consistent with `steadyConvergenceProved: true`;
- G6 is consistent with `catchupConvergenceProved: true`;
- G9 is consistent with `boundedProofUnitPassed: true`;
- fixed 4 GiB / 400,000 invocation / 224 MiB / 12-ledger guards are unchanged;
- the decision has no rejected gate IDs;
- the next step is `r5_owner_authorization_required`;
- R5 recovery mutation remains unauthorized by G10 itself.

## Rejection rule

`rejected` is valid only when at least one G1-G9 gate has status `fail`, no gate remains `unresolved`, the decision lists exactly the failed gate IDs, and the next step is `return_to_architecture_selection`.

An unresolved gate is not a failure and cannot be used to force an early rejection.

## Not-selected rule

`not_selected` is valid only while at least one gate remains unresolved. Its next step is `continue_r4f_qualification`, it cannot list rejected gates, and it is never a completed G10 decision.

## R5 boundary

Unlike the earlier revision-3 selection path, revision-4 G10 does not itself authorize R5 mutation. A successful `selected` decision only moves the process to `r5_owner_authorization_required`. Issue #1175 must separately authorize any later R5 proof or recovery mutation.

This keeps qualification evidence separate from mutation authority.

## Release boundary

G10 cannot change the public reader, enable Mainnet, authorize stabilization or soak, restart the retired Cloudflare collector, or submit transactions. Those boundaries remain closed after selection and require their own later decisions.

## Offline verification

```bash
bash scripts/test-r4f-revision4-selection-decision-verifier.sh
```

The retained unresolved fixture must fail closed with exit status `2` in proof-required mode.

A future final decision uses:

```bash
node .tmp/r4f-revision4-selection-decision-verifier.mjs \
  --input <formal-g10-decision.json> \
  --output <verified.json> \
  --require-proof-ready
```

## Current conclusion

The final decision machinery is prepared, but no decision is made. Revision 4 remains `not_selected`; G3 is still the oldest unresolved hard gate; R5 recovery mutation remains unauthorized; public reader, Mainnet, stabilization, and soak remain unchanged.
