# Read-only immutable-history measurement harness

This fixture-tested harness measures only reconstruction segment IDs `000`, `001`, `032`, `064`, `096`, `128`, `160`, `192`, `224`, `240`, `261`, and `262`. It uses the canonical segment builder and exact-index record extraction contracts. It is not a reconstruction executor and does not establish reconstruction readiness.

Each canonical builder invocation uses a read window of 16, within the builder's supported maximum. This bounds concurrent ledger reads while avoiding the sequential window-size-one default; the fixed twelve-segment run remains subject to the existing 30-minute workflow timeout and fails closed rather than expanding its segment scope.

The harness is available only through the explicit `measure` choice of the existing manually dispatched read-only qualification workflow. Pull requests validate the workflow but never run the measurement mode. The mode has `contents: read`, `actions: read`, and `issues: write`; it has no ref-write or production-write permission. Generated data is kept in runner-local storage and one Actions evidence artifact. A temporary Git repository is created only beneath `RUNNER_TEMP`, has no remote, and is never pushed.

## Evidence schema version 1

`summary.json` is a strict `read-only-history-reconstruction-measurement` object with `productionMutation: false`. It contains:

- exactly the 12 fixed segment identities and ledger ranges;
- first-parent and terminal hashes, elapsed/CPU/RSS observations, redacted endpoint and RPC counters;
- all seven canonical manifest file entries plus compressed/decompressed byte and record measurements;
- explicit counts for all five semantic classes;
- the fixed transaction and Vault object-change witness result for segment `224`;
- exact-index entry totals, semantic amplification, all 256 bucket counts, all 16 super-bucket counts, serialized bytes, and peak RSS;
- temporary local-Git loose/pack statistics and largest blob size;
- status and redacted response evidence for the four approved GitHub GET endpoints.

Any incomplete or malformed segment, wrong fixed range, invalid manifest, missing witness, failed evidence validation, or production-mutation signal fails the measurement. HTTP 403/404 protection responses remain explicit unavailable evidence and do not cause permission broadening. The mode does not publish history, create a ref, deploy a Worker, write D1, arm qualification, or start soak.
