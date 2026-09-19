# Testing strategy

## Principle

Tests prove semantic integrity and publication integrity independently from any storage provider.

## Required suites

### Domain/unit

- asset normalization;
- exact decimal calculations;
- Vault/LoanBroker/Loan normalization;
- on-ledger status;
- schedule-derived status;
- relationship validation.

### Ledger parsing

- validated flag required;
- requested ledger identity required;
- parent-hash continuity;
- transaction metadata parsing;
- recognized Lending transaction filtering;
- malformed AffectedNodes rejection.

### Derivation

- before/after object changes;
- Current upsert/delete mutations;
- lifecycle events;
- archived deleted objects;
- balance/cover/loss series;
- deterministic repeated derivation.

### Artifact contract

- canonical encoding;
- digest verification;
- manifest schema validation;
- duplicate ID rejection;
- missing shard rejection;
- generation boundary validation;
- history range validation.

### Collector behavior

- no-op when caught up;
- bounded partial catch-up;
- multi-run catch-up;
- interruption before upload;
- interruption after upload/before channel;
- retry from committed cursor;
- duplicate run idempotence;
- parent-hash mismatch fail-closed;
- concurrent publisher exclusion.

### Compaction

- base + deltas == compacted Current;
- tombstones remain absent from Current;
- counts remain equivalent;
- exact lookups remain equivalent;
- history records remain unchanged;
- interrupted compaction preserves prior channel.

### UI data source

- channel unavailable;
- stale Current;
- explicit history gap;
- exact entity lookup;
- list pagination;
- deletion/archived transition;
- provenance mapping;
- old channel fallback after invalid new publication.

### E2E/browser

Representative routes:

- Overview;
- Vault list/detail;
- LoanBroker list/detail;
- Loan list/detail;
- Activity;
- archived object;
- Network Status.

Validate desktop/mobile, long identifiers, keyboard navigation, zoom, stale/unavailable/error/gap states.

## Live evidence

Before cutover capture non-destructive Devnet evidence for:

- one fresh complete base;
- one five-minute no-op or small run;
- one bounded catch-up;
- one interruption/retry drill;
- one compaction;
- one production-shaped static UI session;
- one multi-hour then multi-day soak.

## Legacy tests

D1, Queue, Supabase, Worker-Cron, and recovery tests may remain temporarily while legacy code exists.

They are migration cleanup targets and do not define the target release gate.
