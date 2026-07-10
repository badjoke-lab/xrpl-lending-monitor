# Cloudflare Free collector throughput design — 2026-07-10

## Purpose

This document records the retained 64-ledger/run failure, the verified 32-ledger/run recovery baseline, and the approved investigation order for increasing collector throughput without repeating the per-invocation subrequest failure.

This is an M5-5 recovery and runtime-design unit. It does not start M6, Explorer v1, or Observatory work.

## Retained production evidence

### 64-ledger HTTP profile failure

Runtime monitor run `29060806372` captured the 64-ledger/run production profile failure.

The first lightweight artifact recorded three samples with:

- `cursor_delta=0`;
- `head_delta=175`;
- `lag_delta=+175`;
- `samples_with_failures=3`;
- three consecutive collector samples reporting `Too many subrequests by single Worker invocation`.

The cursor remained at ledger `3501250` while observed head advanced from `3531143` to `3531318`.

The failure mode was a Cloudflare Worker per-invocation subrequest limit, not a CPU exhaustion result.

### Emergency rollback and recovery

PR #301 restored the last retained passing five-minute 32-ledger/run profile.

The rerun of runtime monitor run `29060806372` then passed both `deep-diagnostics` and `lightweight-monitor`.

The retained rerun lightweight artifact recorded:

- first cursor/head/lag: `3501282 / 3532832 / 31550`;
- last cursor/head/lag: `3501346 / 3533007 / 31661`;
- `cursor_delta=64`;
- `head_delta=175`;
- `lag_delta=+111`;
- `samples=3`;
- `samples_with_failures=0`;
- `ledgers_processed=32` and `rpc_requests=32` in both first and last samples;
- run duration approximately `6.8s` in both first and last samples;
- current UTC-day D1 usage at artifact capture: `2,429,539 / 5,000,000` rows read and `404 / 100,000` rows written.

This proves collector recovery at the 32-ledger profile. It does not prove catch-up capacity: observed head growth still exceeds cursor growth in the retained monitor window.

## Current production baseline

Until a replacement transport profile passes production-shaped evidence:

- cron remains `*/5 * * * *`;
- `INCREMENTAL_MAX_LEDGERS_PER_RUN=32`;
- `INCREMENTAL_MAX_LEDGER_RPC_REQUESTS_PER_RUN=40`;
- the existing HTTP ledger reader remains the production path;
- M5-5 remains blocked on collector health and production-shaped browser evidence;
- M6 remains unstarted.

No configuration-only increase above the retained safe 32-ledger HTTP profile is authorized.

## Why the current HTTP shape cannot scale by ledger-count tuning alone

The current incremental path performs one expanded `ledger` RPC read for each ledger. `scanValidatedLedgerRange` walks the requested range in order and awaits one reader call per ledger. `readValidatedLedger` performs one JSON-RPC `ledger` call with expanded transactions for that ledger.

Therefore the current transport shape has approximately one external XRPL request per ledger before retries and other scheduled work are considered.

Cloudflare Workers Free currently allows 50 subrequests per invocation. The 64-ledger HTTP profile therefore cannot be made safe by increasing only the configured ledger and RPC caps.

HTTP keep-alive can reduce connection setup cost but does not reduce Worker `fetch()` subrequest count. Parallel HTTP reads can reduce wall time but also do not reduce subrequest count. Neither is the primary solution to the observed failure.

## Primary design candidate — one XRPL WebSocket session per collector cycle

XRPL WebSocket requests support request IDs and repeated API requests on one persistent connection. Cloudflare Workers can act as a WebSocket client and send multiple messages through an established connection.

The primary design candidate is therefore a collector-cycle-scoped WebSocket ledger session:

```text
scheduled invocation
  -> refresh network head
  -> open one XRPL WebSocket session
  -> send bounded ledger requests over that session
  -> parse each response into ValidatedLedgerRead
  -> preserve existing contiguous parent-hash validation
  -> preserve existing budget selection
  -> commit one guarded contiguous prefix to D1
  -> close session in finally
```

The first implementation must preserve the existing domain and persistence pipeline. Only the ledger transport boundary should change.

### Required invariants

A WebSocket transport implementation must:

1. use a configured Devnet WSS endpoint and keep Mainnet disabled;
2. assign a unique request ID to every `ledger` command and reject mismatched responses;
3. request `transactions=true`, `expand=true`, `owner_funds=false`, and the approved API version;
4. parse into the existing `ValidatedLedgerRead` contract rather than create a parallel normalization path;
5. preserve exact requested-ledger equality checks;
6. preserve parent-hash continuity checks across the full scanned range;
7. preserve `selectIncrementalCommitPrefix` row, statement, transaction, lending-transaction, and overlay limits;
8. preserve the existing guarded D1 commit and cursor atomicity;
9. close the WebSocket in `finally` on success, timeout, parse failure, continuity failure, or persistence failure;
10. fail closed on incomplete or ambiguous response correlation;
11. record transport connection count separately from logical XRPL message count so logical RPC work is not mislabeled as Worker subrequest count;
12. retain the HTTP 32-ledger profile as the rollback baseline until WebSocket production evidence passes.

## Implementation order

### T1 — transport seam and deterministic tests

Add a transport/session abstraction at the ledger reader boundary without changing production configuration.

Required tests:

- request ID correlation;
- out-of-order response handling or explicit single-in-flight enforcement;
- timeout;
- close/error event handling;
- malformed JSON;
- XRPL error response;
- wrong ledger index;
- parent-hash discontinuity through the existing scan path;
- guaranteed close in success and failure paths;
- no D1 commit after an incomplete WebSocket scan.

### T2 — non-production Devnet probe

Run a bounded Devnet WSS probe before production wiring.

Capture:

- connection count;
- logical ledger messages;
- successful ledgers;
- retries or reconnects;
- elapsed wall time;
- transaction count inspected;
- response parse failures;
- continuity result.

The probe must not advance the production cursor.

### T3 — production 32-ledger transport canary

Switch only the ledger transport while keeping the production work cap at 32 ledgers/run.

Accept only when retained evidence shows:

- zero collector failures;
- cursor advancement;
- no continuity or response-correlation failure;
- no CPU exhaustion;
- no subrequest-limit failure;
- D1 usage remains within the existing gate;
- output metrics agree with the existing HTTP semantics.

### T4 — 64-ledger WebSocket throughput test

Only after T3 passes, test 64 ledgers/run with one retained runtime monitor artifact.

This test must be treated as a measurement unit, not a health claim.

### T5 — capacity target based on measured head slope

The retained monitor windows observed head growth of 175 ledgers while a 32-ledger profile advanced the cursor by 64 ledgers across the same three-sample window. A stable production profile therefore needs measured sustained cursor growth at least equal to measured head growth, plus recovery margin for missed runs.

Do not select 96 or another cap merely because it is numerically larger. Increase only after measured WebSocket transport wall time, CPU outcome, response size behavior, D1 usage, and retained runtime evidence support the next profile.

## Secondary options

### Shorter cadence with a smaller per-run HTTP batch

A one-minute cadence with a smaller batch can increase aggregate daily throughput without exceeding the per-invocation subrequest limit. It remains a fallback, not the primary design, because:

- the previous one-minute 40-ledger profile produced repeated `exceededCpu` outcomes;
- more frequent invocations repeat fixed network-status, preflight, state-read, and state-write work;
- a near-head-capacity profile has little recovery margin after missed or failed runs;
- it does not improve transport efficiency.

Any cadence experiment requires its own UTC-day resource measurement and production runtime evidence.

### Persistent HTTP over raw socket

The repository already contains a non-standard-port socket HTTP fallback. Reusing one raw TLS socket with HTTP keep-alive could reduce connection/subrequest pressure, but correct multi-response framing, chunked-body handling, timeout recovery, and partial-response semantics are more complex than the XRPL-supported WebSocket request model.

Keep this as a fallback only if the Worker WebSocket client path cannot pass the Devnet probe.

### Fan-out across Workers or parallel cursor writers

Do not use parallel independent cursor writers or partition the contiguous range across concurrent writers. The current collector depends on exact parent-hash continuity and one guarded contiguous cursor advance. Any future fan-out design would require a separate ordered assembly and commit architecture and is outside this recovery unit.

## Decision

The active next unit is T1: add a tested WebSocket ledger-transport seam without changing production behavior.

The production collector remains on the verified five-minute 32-ledger HTTP rollback baseline until T1-T3 evidence exists.

M5-5 remains incomplete. M6 must not start.
