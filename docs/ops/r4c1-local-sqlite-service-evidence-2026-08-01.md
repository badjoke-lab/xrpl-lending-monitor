# R4C1 local SQLite service evidence — 2026-08-01

Status: R4C1 implementation and validation evidence for PR #1104. R4 remains local and read-only.

## Scope

R4C1 evaluates the cardless self-hosted SQLite candidate at the local service-supervision boundary.

It does not claim that a production host exists. It proves only that a file-backed SQLite process and the portable durable scheduler can survive simulated process closure and reopening while preserving exact lease and message identities.

## Durable supervisor state

Migration `10008_local_sqlite_service_supervisor.sql` adds:

- one durable supervisor row per profile;
- process generation;
- stopped, running, and terminally halted states;
- owner ID and lease expiry;
- last heartbeat;
- restart count;
- explicit next-start time;
- last error code and message;
- canonical append-only supervisor events.

The supervisor lease controls local process ownership. It is separate from collector scheduler message leases.

An active local process lease is intentionally not part of the cross-host portable complete-state envelope. A new host must establish its own process generation rather than inheriting ownership from another machine.

## File-backed harness

The harness uses a temporary file-backed SQLite database with:

- foreign keys enabled;
- WAL journal mode;
- `synchronous = FULL`;
- migrations through `10008`;
- the portable durable scheduler in the same database.

The suite closes the database handle to simulate process termination and reopens the same database file as another process.

## Proven behavior

### Initialization and normal start

- initialization is idempotent;
- the first start creates a new generation;
- a duplicate start by the same active owner converges without changing identity;
- graceful stop clears ownership without counting a failure;
- the next clean start creates a new generation.

### Crash and reclaim

- queued scheduler state survives database close and reopen;
- another owner cannot take a process lease before expiry;
- exact-expiry reclaim creates a new process generation;
- stale reclaim records the previous owner, generation, and lease;
- the scheduler message remains unchanged and can be claimed after process reclaim;
- scheduler message ownership persists independently across another reopen.

### Heartbeat and backoff

- only the active owner can extend a process lease;
- heartbeat state persists across reopen;
- retryable process failure clears active ownership;
- retryable failure records an explicit next-start time and error identity;
- restart before the configured time is rejected;
- restart at the configured time creates a new generation;
- retryable failure increases restart evidence without changing scheduler message identity.

### Terminal halt

- identity failure can terminally halt the local profile;
- terminal halt clears owner and process lease;
- no next-start time is retained;
- automatic restart is rejected after terminal halt.

### Fail-closed input and ownership

The supervisor rejects:

- malformed profile, owner, and error identifiers;
- start before initialization;
- fresh-lease theft;
- heartbeat or failure reporting by a non-owner;
- operation after process lease expiry;
- retry timing that is not later than the failure time;
- automatic restart after terminal halt.

## R4B decision

`r4c1-local-sqlite-profile-evidence.ts` binds the harness to the R4B evaluator.

The retained decision is:

- classification: `conditional_candidate`;
- selection: `not_selected`;
- eligible for scoring: `false`;
- passed gates: `7`;
- failed gates: `0`;
- unresolved gates: `3`;
- unresolved gate IDs: `G7`, `G8`, `G9`.

### Passed

- G1 — no mandatory payment or card;
- G2 — no automatic paid overage;
- G3 — durable internal scheduler and local process reclaim;
- G4 — transactional phase completion;
- G5 — committed-only reads;
- G6 — exact portable complete-state transfer;
- G10 — no production mutation during R4C1.

### Unresolved

- G7 — no retained service-managed throughput run proves steady p95 above 21 committed ledgers/minute and catch-up above 30;
- G8 — CPU, memory, disk, database growth, network, and sustained resource stop thresholds are not yet measured;
- G9 — no actual always-on host, OS service manager, unattended boot restart, automated deploy/rollback, power/network continuity, or off-host evidence retention is proven.

Local crash recovery does not satisfy the always-on production-host gate.

## CI corrections

The first test run exposed an identifier-regex error that rejected underscore-separated error codes. The separator set was corrected without changing lease behavior.

The next test run exposed only an incorrect scheduler-state expectation. A claimed portable scheduler message is `leased`, not `processing`; the test was aligned with the existing scheduler contract.

## Retained validation

Implementation and R4B evidence head `0b9cf6b7f42aee4ac1fb93758d8c5cbfedff0f1a` passed CI run `30704517323`:

- Actions workflow-surface guard;
- lint;
- D1 headroom and live-cutover shell syntax validation;
- canonical production base identity validation;
- TypeScript type-check;
- production runner bundle and configuration validation;
- complete unit-test suite;
- complete clean migration sequence through migration `10008`;
- application build;
- browser smoke.

## Boundary

R4C1 installs no OS service, assumes no always-on host, and creates no credential, hosted resource, payment method, billing state, remote deployment, production mutation, public-reader switch, Queue, Cron, Mainnet state, recovery window, qualification slot, or soak.

The self-hosted SQLite profile remains conditional and unselected.

R4C2 is next: local Postgres transaction and scheduler-semantics qualification without a hosted Supabase project or credential.
