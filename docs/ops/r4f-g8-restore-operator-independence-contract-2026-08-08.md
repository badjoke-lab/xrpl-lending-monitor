# R4F G8 revision-4 restore and operator-independence contract

Date: 2026-08-08  
Issue: #1261  
Status: fail-closed verifier prepared; G8 remains unresolved

## Purpose

G8 must reprove the operational recovery properties for the revision-4 identity instead of inheriting revision-3 qualification by name. The required proof surface is complete-state export and restore, post-restore continuation, credential rotation, rollback, terminal halt, sanitized evidence publication, and operator independence.

This unit prepares only an offline aggregate verifier, synthetic non-qualifying fixture, tests, and CLI. It performs no remote qualification and does not qualify G8.

## Preceding gates

Proof-ready G8 evidence requires G3 through G7 to have passed and requires retained SHA-256 evidence digests for each preceding gate. The current state has G3, G5, G6, and G7 unresolved, so current G8 evidence cannot qualify.

## Revision-4 identity binding

Every G8 sub-proof independently retains:

- evidence digest;
- source commit;
- profile revision;
- profile identity digest.

Every sub-proof must bind to revision `4` and identity digest `39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5`.

A revision-3 proof with otherwise identical booleans is rejected.

## Complete-state export and restore

The proof must include collection, scheduler, publication, and maintenance state and must demonstrate:

- restore into an empty typed target;
- canonical-text parity;
- canonical digest parity;
- exact duplicate restore convergence;
- digest-tamper rejection;
- active-profile isolation.

## Post-restore continuation

A successful restore without continuation is insufficient. The restored target must prove:

- exactly one watermark advance;
- durable-source watermark parity;
- committed work and committed-only visibility;
- row-count and row-digest parity;
- explicit source rebinding;
- duplicate phase replay convergence;
- active-profile isolation.

## Credential rotation

The scripted qualification must rotate both reader and recovery verifier tokens exactly once, generate exactly two one-run tokens, mask both, scope both to the exact project, reject the previous tokens after rotation, and retain no credential material in evidence.

Credential rotation is an operational proof action; it does not authorize recovery data mutation.

## Rollback and terminal halt

Rollback proof requires interruption rollback, no partial committed visibility, retained failed-attempt accounting from G7, and successful bounded retry convergence after rollback.

Terminal halt proof requires durable fail-closed halt state, no successor after halt, and retained failed-attempt accounting. A halt that silently drops the failed-attempt directional accounting is not qualifying.

## Evidence publication

Both success and failure paths must publish sanitized evidence automatically. The proof requires artifact upload, Issue locator publication, explicit secret absence, and automatic publication rather than a manual copy step.

## Operator independence

The reproof must be executable from one guarded scripted workflow with:

- no routine Dashboard step;
- no scheduled normal-collection workflow;
- exact scripted deployment set;
- scripted migration application;
- scripted credential rotation;
- scripted export/restore and continuation;
- scripted rollback and halt qualification;
- scripted evidence publication.

This does not prohibit the separately authorized G3 Dashboard reconciliation experiment. It prevents G8 operational recovery from depending on a human Dashboard action.

## Fixed guards and release boundary

G8 keeps the revision-4 project guards unchanged:

- 4 GiB rolling egress halt;
- 400,000 invocation halt;
- 224 MiB memory halt;
- 12-ledger claim cap.

The proof is invalid if it commits R5 recovery mutation, submits a transaction, changes the public reader, enables Mainnet, authorizes stabilization, or authorizes soak.

## Offline verification

```bash
bash scripts/test-r4f-revision4-restore-operator-verifier.sh
```

The retained synthetic fixture must remain `proofReady: false` and proof-required mode must exit `2` because preceding hard gates remain unresolved.

Future bounded evidence uses:

```bash
node .tmp/r4f-revision4-restore-operator-verifier.mjs \
  --input <bounded-g8-reproof.json> \
  --output <verified.json> \
  --require-proof-ready
```

## Current conclusion

G8 preparation does not select revision 4. G8 remains `unresolved`; R5 mutation remains unauthorized; public reader remains unchanged; Mainnet remains disabled; stabilization and soak remain unauthorized.
