# R3E complete state transfer evidence — 2026-08-01

Status: R3E implementation and parent R3 exit evidence for PR #1101. R3 remains local and provider-neutral.

## Complete-state contract

R3E adds `PortableCollectorCompleteStateTransferAdapter` with:

- `exportCompleteState()`;
- `restoreCompleteState(exportedState)`.

The outer complete-state envelope is schema version 1. The existing collection and scheduler runtime envelope remains schema version 3 unchanged inside it.

The envelope includes:

- collector work;
- payload chunks;
- commit chunks;
- reference rows;
- committed collection watermarks;
- scheduler messages;
- scheduler outbox entries;
- publication candidates;
- ordered publication work membership;
- publication watermarks;
- maintenance plans;
- maintenance mutations.

## Canonical export

The SQLite reference adapter exports every table in deterministic identity order and serializes the complete envelope through canonical JSON.

Repeated export of unchanged state produces identical bytes.

The transfer contract does not reinterpret or rewrite runtime version 3 collection identity.

## Empty-target restore

Restore requires every collection, scheduler, publication, and maintenance table to be empty.

The adapter:

1. validates the outer schema and exact field set;
2. validates inner runtime schema version 3;
3. validates deterministic payload encoding;
4. restores collection and scheduler rows in dependency order;
5. restores publication candidates in parent-before-child order;
6. rejects a missing publication parent or candidate cycle;
7. restores publication watermarks, maintenance plans, and mutations;
8. exports the restored target again;
9. compares exact canonical bytes with the source envelope;
10. commits only when parity is exact.

All restore work runs inside one transaction. Any identity, foreign-key, publication-chain, or parity failure rolls the target back to empty.

## Transferred lifecycle states

The parent suite transfers together:

- three committed works;
- a staged work;
- a committing work at a distinct ledger boundary;
- committed rows after maintenance removed old payload and commit chunks;
- a completed scheduler message;
- a dispatched successor outbox entry;
- a pending successor message;
- an independently verified publication candidate;
- a publication watermark;
- an applied maintenance plan and mutations.

## Reader parity

Before export, the suite obtains a committed-reader page and source-bound cursor.

After restore it proves:

- the committed read fence is identical;
- the same source/query/order/fence cursor continues deterministically;
- the next row is identical;
- using that cursor with another source ID fails `invalid_cursor`;
- staged and committing rows remain excluded from committed reads.

## Scheduler parity

After restore the suite proves:

- the current message remains completed;
- the successor remains pending after outbox dispatch;
- the outbox remains dispatched;
- message and outbox identities are unchanged.

## Publication and maintenance parity

After restore the suite proves:

- verified publication identity and publication watermark are unchanged;
- the applied maintenance plan reopens identically;
- replay applies zero additional mutations;
- compacted old chunks remain absent while committed work and rows remain present;
- the next unpublished committed work can form, verify, and advance the next publication;
- collection watermark remains unchanged by publication continuation.

## Failure evidence

The suite proves:

- a non-empty restore target is rejected without changing its existing state;
- an unsupported outer schema version is rejected;
- a publication candidate with a missing parent is rejected;
- failed restore leaves collection, scheduler, publication, and maintenance target tables empty.

The first CI run exposed a fixture collision because staged and committing fixtures used the same unique ledger boundary. They were separated into ledger 104 and ledger 105 fixtures. The next run exposed only an incorrect test expectation: a successor after outbox dispatch is `pending`, not `queued`. The expectation was corrected to the existing scheduler contract. Runtime behavior was not weakened.

## Retained validation

Latest implementation head: `0fbe87426d6f6e22d8cc1404abd5ed8653639967`.

CI run `30702565940` passed:

- Actions workflow-surface guard;
- lint;
- D1 headroom and live-cutover shell syntax validation;
- canonical production base identity validation;
- TypeScript type-check;
- production runner bundle and configuration validation;
- complete unit-test suite;
- complete clean local migration sequence through migration `10007`;
- application build;
- browser smoke.

## Parent R3 exit

R3A through R3E now have implementation and validation evidence in PR #1101.

The parent R3 exit is satisfied only after PR #1101 merges to `main` with the final documentation head passing ordinary CI.

## Boundary

R3E selects no hosted provider and performs no remote deployment, production mutation, public-reader switch, Queue or Cron change, Mainnet change, recovery, qualification, or soak work.

R4 is the next phase after merge: local and read-only deployment-profile qualification against cost, portability, transactional, scheduler, export, restore, throughput, and fail-closed gates.
