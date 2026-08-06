# R4F G4 revision-4 memory evidence contract

Date: 2026-08-06
Issue: #1261
Status: evidence contract and offline verifier prepared; G4 remains unresolved

## Purpose

G4 requalifies the revision-4 background-recovery memory envelope without weakening the existing safety boundary or treating synthetic values as operational evidence.

The verifier locks:

- memory metric: process RSS bytes;
- memory halt: 224 MiB (`234881024` bytes);
- claim cap: 12 ledgers;
- exactly one replay of the prior exact 12-ledger halt shape;
- exactly one heavier retained sample;
- strict headroom: every peak must be lower than the halt, not equal to it;
- no memory-halt recurrence and no claim-cap override.

The heavier sample is defined by retaining more ledgers than the exact halt-shape sample. A higher peak is not required because the evidence must report observed values rather than manufacture an ordering.

## Evidence classes

`synthetic_test_only` exercises the schema and verifier. It can never satisfy G4.

`bounded_offline_replay` is the only potentially qualifying class. It also requires an explicit Issue #1261 authorization comment, the exact revision-4 profile identity, both required replay shapes, artifact digests, and unchanged safety state.

The verifier rejects secret-bearing fields and prohibits production credentials, production mutation, committed recovery mutation, public-reader changes, Mainnet, stabilization, and soak.

## Offline verification

```bash
bash scripts/test-r4f-revision4-memory-evidence-verifier.sh
```

The harness bundles the verifier, saves a synthetic result, verifies the locked guard and cap, then runs proof-required mode. Synthetic evidence must exit with code `2`.

A future authorized replay should invoke the bundled CLI with a separately captured JSON input:

```bash
node .tmp/r4f-revision4-memory-evidence-verifier.mjs \
  --input <authorized-memory-evidence.json> \
  --output <verified-memory-evidence.json> \
  --require-proof-ready
```

## Current conclusion

No real revision-4 memory replay was performed by this change. No historical peak values were inferred. G4 remains unresolved until an authorized bounded replay supplies both required shapes and the verifier returns `proofReady: true`.
