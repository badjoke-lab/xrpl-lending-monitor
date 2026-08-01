# R3A adapter conformance evidence — 2026-08-01

Status: R3A implementation and validation evidence for PR #1097. R3 remains local and provider-neutral.

## Delivered interfaces

- `PortableCollectorStorageAdapter`;
- `PortableCollectorSchedulerAdapter`;
- `PortableCollectorExecutionAdapter`;
- `PortableCollectorFinalizeExecutionAdapter`;
- `PortableCollectorPublicationAdapter`;
- `PortableCollectorMaintenanceAdapter`.

The interfaces import only relative provider-neutral modules. They contain no Cloudflare, Wrangler, D1, Queue, GitHub, or other hosted-provider package dependency.

## SQLite reference wrappers

`SqlitePortableCollectorStorageAdapter` and `SqlitePortableCollectorSchedulerAdapter` delegate to the proven SQLite reference store and durable scheduler without changing R2 behavior.

The wrappers preserve:

- complete candidate identity;
- committed-only visibility;
- exact work and chunk reads;
- transaction-aware finalization;
- immutable scheduler message identity;
- retry and stale-lease identity;
- atomic phase completion and successor outbox reservation;
- duplicate convergence.

## Interface-driven runtime bridge

`PortableCollectorAdapterRuntime` composes the existing scan, commit, and finalize runtimes through interface-typed storage, scheduler, execution, and finalize-execution adapters.

The bridge does not create a second transaction boundary. The SQLite storage and scheduler wrappers share the same reference database, so scheduler-owned phase transactions retain the R2 atomicity contract.

## Conformance evidence

The R3A suite proves:

1. a full sparse seven-class `scan -> commit -> finalize -> next scan` chain through interface-typed adapters;
2. no committed rows or watermark before finalize;
3. complete committed rows and watermark after finalize;
4. next scan uses the new committed boundary and `scanSequence = 0`;
5. an injected finalize storage interruption rolls back work status, visibility, watermark, message completion, and successor outbox through the interface bridge;
6. retry completes with the exact same finalize message identity;
7. publication and maintenance remain separate contracts from collection;
8. every R3A source import is relative and provider-neutral.

The first CI run failed only because a source-text regex treated the word `Queue` in a type/interface context as a hosted-provider dependency. The guard was corrected to inspect import specifiers only. No adapter or runtime behavior changed.

## Retained validation

CI run `30699452781` passed:

- Actions workflow-surface guard;
- lint;
- TypeScript type-check;
- production runner bundle and configuration validation;
- complete unit-test suite;
- complete clean local migration sequence, including migration `10006`;
- application build;
- browser smoke.

## Boundary

R3A changes no public reader, production Worker, D1 database, Queue, Cron, Mainnet flag, deployment profile, recovery state, qualification, or soak state.

R3B is next: committed generic reader, immutable read fences, exact lookup, semantic and ledger-range listing, relationship lookup, and source-bound cursors. No public route is authorized by R3B.
