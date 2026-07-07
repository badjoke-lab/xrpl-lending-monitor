# M1 exit review operation

## Purpose

The M1 exit review workflow captures one reproducible, read-only evidence package for the active XRPL Devnet runtime. It does not change collector state, current-state publication, history publication, replacement-base configuration, or D1 contents.

The workflow is manual-only because the permanent catch-up monitor already owns scheduled operational monitoring. The exit review is a bounded review unit, not a second monitor.

## Workflow

Use `.github/workflows/m1-exit-review.yml`.

The workflow has one boolean input:

- `require_ready=false` captures evidence and enforces non-contradiction invariants without requiring M1 completion;
- `require_ready=true` additionally requires every HYB-7 path and every M1 gate to be `observed`, zero reported collector lag, and zero consecutive collector failures.

## Evidence captured

The artifact contains:

- collector cursor, observed head, lag, run usage, and failure state;
- HYB-7 continuation diagnostics and path states;
- M1 exit diagnostics and gate states;
- replacement-base replay status and target identity;
- hybrid history-source identity and exact-index presence;
- Overview output bound to the active replacement snapshot;
- one current Vault list sample and exact detail read;
- one current Loan Broker list sample and exact detail read;
- one current Loan list sample and exact detail read;
- a compact `summary.json` joining the review state.

## Invariants

Every run fails when:

- a HYB-7 path is `inconsistent`;
- an M1 gate is `inconsistent`;
- the collector reports consecutive failures;
- the replacement-base status is not the expected replay state;
- the active replacement snapshot identity differs from `devnet-3432924-canonical` at ledger `3432924`;
- hybrid history does not end at canonical ledger `3432924` or has no exact index;
- current Vault, Loan Broker, or Loan list/detail reads are unavailable, empty at the sample boundary, or bound to another snapshot.

When `require_ready=true`, the run additionally fails unless:

- HYB-7 has passed and every path is `observed`;
- M1 exit is ready and every gate is `observed`;
- collector lag is zero;
- consecutive collector failures are zero.

## Evidence interpretation

A successful `require_ready=false` run means the reviewed sources agree and no contradiction was detected at review time. It does not mean M1 is complete.

A successful `require_ready=true` run is the bounded runtime evidence package required for the M1 exit review. Repository status documentation must still be updated from the captured evidence before M1 is marked complete.

## Safety boundary

- Devnet only.
- Read-only HTTP requests only.
- No wallet connection.
- No signing or transaction submission.
- No D1 mutation.
- No publication or channel mutation.
- No Mainnet access.
