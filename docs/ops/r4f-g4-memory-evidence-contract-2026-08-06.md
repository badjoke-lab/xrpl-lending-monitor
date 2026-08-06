# R4F G4 revision-4 memory evidence contract

Date: 2026-08-06
Issue: #1261
Status: contract satisfied by the retained authorized bounded replay; G4 formally closed as pass on 2026-08-07

The closure is recorded in [`r4f-g4-memory-gate-closure-2026-08-07.md`](r4f-g4-memory-gate-closure-2026-08-07.md) and [`../../ops/r4f/revision4-memory-gate-closure.json`](../../ops/r4f/revision4-memory-gate-closure.json). The historical sections below describe the verifier-preparation change before the authorized replay ran.

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

An authorized replay invokes the bundled CLI with a separately captured JSON input:

```bash
node .tmp/r4f-revision4-memory-evidence-verifier.mjs \
  --input <authorized-memory-evidence.json> \
  --output <verified-memory-evidence.json> \
  --require-proof-ready
```

## Closure conclusion

Actions run `31086304493` executed the authorized bounded offline replay at source commit `5a25d091919dc2d90116ca9cc4e92335031be9f2`. Artifact `8961530550` retained both required shapes and verified with `proofReady: true` and no blocking reasons.

The maximum measured RSS was `77430784` bytes, leaving a minimum `157450240` bytes of headroom below the unchanged `234881024`-byte halt. The claim cap remained `12` ledgers and no override or memory-halt recurrence occurred.

G4 is therefore `pass`. This closure does not satisfy G3 or G5-G10, select revision 4, authorize R5 recovery mutation, or change the public reader, Mainnet, stabilization, or soak state.
