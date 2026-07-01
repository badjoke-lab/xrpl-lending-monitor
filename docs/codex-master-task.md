# Codex master execution task

This is the initial task for the durable goal in `docs/codex-goal.md`.

## Mission

Execute the repository roadmap from the actual current GitHub state through the public read-only Devnet release. Work in dependency order. Do not treat this document as permission to weaken any specification, test, integrity invariant, resource limit, or human approval gate.

## Mandatory first actions

1. Read `AGENTS.md` and every document listed in its source-of-truth section.
2. Inspect `main`, open pull requests, branches, recent commits, changed files, review state, and all required CI checks.
3. Compare the repository state with `docs/implementation-status.md` and correct stale status in the active pull request.
4. Find the first incomplete dependency. Resume existing work rather than creating a duplicate implementation.
5. Before editing, write explicit acceptance criteria for the active roadmap unit in the pull-request description or implementation notes.

As of the baseline recorded on 2026-07-01, the expected continuation point is GitHub pull request #10, titled `Add validated ledger history foundation`, on branch `collector/incremental-ledger-foundation`. Do not assume this remains current: verify it first.

## Execution loop for every roadmap unit

For each unit, repeat this loop until the public Devnet release gates pass:

1. Verify predecessor work is merged and the active branch is based on the intended predecessor.
2. Read the relevant product, architecture, data-model, status-model, asset-model, collector, testing, resource, roadmap, and decision documents.
3. Inspect current implementation and tests before designing a replacement.
4. Define invariants, failure behavior, acceptance tests, live evidence, migration needs, rollback behavior, and documentation updates.
5. Implement the smallest coherent roadmap unit. Do not combine unrelated milestones.
6. Add unit, fixture, integration, migration, contract, browser, live-read, benchmark, interruption, or rollback tests as required by the changed surface.
7. Run focused checks during development and the complete relevant check set before merge.
8. Update `docs/implementation-status.md` with exact completed work, evidence, open questions, blockers, and first next action.
9. Update any specification, roadmap, resource, or decision document affected by the change.
10. Open or update a focused pull request. Include scope, invariants, migration impact, tests, live evidence, resource impact, failure behavior, rollback notes, and exclusions.
11. Resolve all required-check failures and material review findings without weakening invariants or tests.
12. Merge only when authorized, the branch is current, required checks pass, and documentation agrees with implementation.
13. Inspect the merged result and immediately continue to the next incomplete dependency.

If an execution limit interrupts work, commit and push coherent progress, update the pull request and `docs/implementation-status.md`, and record the first incomplete action. Never leave the only useful state in chat or an uncommitted workspace.

## Immediate unit: complete the incremental validated-ledger foundation

Resume the existing incremental collector pull request if it remains canonical.

### Required behavior

- Read explicitly validated ledgers by index.
- Request expanded transactions with metadata.
- Support the currently observed XRPL response shapes without silently accepting malformed data.
- Verify requested ledger index, ledger hash, parent hash, close time, transaction order, and metadata presence.
- Process bounded contiguous ranges.
- Reject gaps, unexpected parent links, and mismatched ledger identities.
- Recognize all approved Vault, LoanBroker, and Loan transaction types.
- Store processed ledgers and canonical protocol events idempotently.
- Make processed-ledger persistence, event persistence, and cursor advancement atomic.
- Detect concurrent cursor movement and roll back the complete commit rather than leaving partial history.
- Treat an ambiguous retry after a successful commit as already committed, without duplication.
- Keep raw payload retention configurable and bounded.
- Keep production scheduling and Mainnet disabled.

### Atomicity work at the recorded stop point

Inspect the current D1 migration and repository implementation. Close the race in which another collector can change the cursor between the initial read and the batch update while ledger or event inserts remain committed.

Implement a D1-compatible transaction guard or equivalent fail-closed mechanism inside the same atomic batch. The guard must cause the complete batch to fail when the expected cursor no longer matches. Confirm actual D1 batch semantics through tests rather than assumption.

Required tests include:

- expected cursor matches and the batch commits;
- expected cursor does not match and no processed ledger remains;
- expected cursor does not match and no protocol event remains;
- a mid-batch constraint failure leaves no partial records;
- reprocessing the same range creates no duplicate canonical events;
- retry after an already completed range returns a stable already-committed result;
- cursor gaps and parent-hash gaps are rejected;
- raw payload retention on and off behaves as documented.

Run the normal CI and the existing non-destructive live Devnet read workflow. Record ledger index, ledger hash, parent hash, transaction count, observed transaction types, recognized protocol-event count, and check results in bounded evidence.

Update `docs/implementation-status.md`, update the pull-request body, and merge only after every required check passes.

## Close M1: complete and activate the initial current-state snapshot

The current-state scanner, resumable runner, shard format, checkpoint model, and two-batch interruption/resume evidence are foundations, not the M1 exit condition. M1 exits only after a complete marker traversal is stored, verified, and activated.

### Environment boundary

Before using external preview resources, inspect the accepted project configuration and determine whether isolated preview D1 and R2 access is already approved and available. Do not fabricate access or successful evidence.

When external preview access is unavailable, complete all independent work:

- binding and configuration validation;
- provisioning documentation;
- local D1 migrations;
- R2 adapter tests;
- checkpoint and manifest tests;
- interruption and retry tests;
- cleanup safety tests;
- activation and rollback tests;
- resource measurement tooling.

Record the exact external blocker and continue independent M2 work only where it does not make claims dependent on an active real snapshot.

### Preview bootstrap requirements

- Fix one validated Devnet ledger index and hash for the complete bootstrap attempt.
- Traverse all global markers exactly once using the approved unfiltered binary traversal and local classification.
- Persist the exact opaque continuation marker only after the corresponding shard is durable.
- Generate deterministic bounded gzip shards.
- Record shard sequence, decoded count, Lending-object count, compressed size, and SHA-256 digest.
- Upload idempotently.
- Generate a complete manifest with all shard identities and totals.
- Verify every shard and the complete manifest before activation.
- Store checkpoint, manifest digest, snapshot metadata, and active pointer in D1.
- Never publish partial counts as complete totals.
- Never activate an incomplete or digest-invalid attempt.
- Preserve the previous active snapshot until the replacement is verified.
- Demonstrate interruption and resume against the same fixed ledger.
- Demonstrate safe retry of shard and manifest writes.
- Demonstrate cleanup cannot target resumable, building, protected, or active snapshots.
- Measure requests, runtime, memory, compressed storage, object counts, and recovery behavior.

Use longer preview evidence to choose and document failed-prefix retention. Provision production-shaped storage and perform final activation only at the applicable human approval gate.

### M1 exit evidence

- complete marker traversal for Vault, LoanBroker, and Loan;
- relationship checks and terminal zero-omission handling pass;
- complete manifest verifies;
- active pointer references only the verified complete snapshot;
- interruption, resume, retry, cleanup, and rollback tests pass;
- incremental collector has a valid active snapshot predecessor;
- documentation and operational runbook are current.

## M2: event history and lifecycle

Complete these units in order unless the current roadmap has been formally changed.

### AffectedNodes normalization

Normalize CreatedNode, ModifiedNode, and DeletedNode metadata into deterministic object changes.

Required data:

- network, epoch, ledger, transaction hash, transaction order, transaction type, result, close time;
- affected object type and object ID;
- node action;
- before fields;
- after fields;
- changed fields;
- related Vault, LoanBroker, Loan, account, issuance, and asset identifiers where directly supported;
- safe unknown-field capture and reporting.

Add redacted fixtures for created, modified, deleted, omitted-zero, XRP, IOU, MPT, unknown-field, failed-transaction, and mixed-node cases. Reprocessing must be deterministic and idempotent.

### Loan lifecycle engine

Reconstruct lifecycle from canonical events rather than current-state guesswork.

Cover:

- creation and original terms;
- regular payment;
- full payment;
- verified overpayment behavior;
- impair;
- unimpair;
- default;
- delete;
- event ordering;
- terminal and final-state retention.

Do not infer `defaulted` from time. Keep on-ledger status and schedule-derived status separate. Obtain isolated evidence for any transaction shape that remains an open question before encoding it as supported behavior.

### Deleted-object archive

When Vault, LoanBroker, or Loan objects are deleted:

- remove them from current projections;
- preserve final state and deletion event;
- retain network and epoch identity;
- preserve historical relationships;
- keep them searchable by object ID, related account, and transaction where supported;
- classify deletion reason only when evidence supports the classification;
- use an explicit unknown classification instead of guessing.

### Cover, debt, and loss tracking

Build asset-separated histories and aggregates for:

- DebtTotal and DebtMaximum;
- CoverAvailable;
- cover deposits, withdrawals, and clawbacks;
- unrealized loss;
- required minimum cover;
- cover surplus or shortfall;
- related Vault, Broker, and Loan activity.

Never add unlike assets into one total without an approved pricing subsystem.

### Status engine and reconciliation

Implement and test:

- on-ledger status;
- schedule-derived status;
- due and grace boundary behavior;
- explicit default eligibility without false default claims;
- current-scan reconciliation;
- relationship reconciliation;
- aggregate reconciliation;
- cursor and hash continuity checks;
- repair reporting that does not silently rewrite history.

At Checkpoint B, prove indexed history is complete enough for the public lifecycle claims. If not, record the gap and correct collection or reconstruction before exposing those claims.

## M3: public API

Build bounded read-only APIs after M2 data contracts are stable.

### Core API

Provide status, overview, Vault, LoanBroker, and Loan list/detail endpoints with:

- bounded pagination;
- documented filters and sorting;
- network and epoch identity;
- validated-ledger and freshness context;
- provenance categories;
- asset-safe serialization;
- stale and collection-error states;
- archived lookup where applicable.

### Activity, search, and history API

Provide:

- protocol activity;
- transaction detail;
- global identifier search;
- account relationships;
- epoch browsing;
- object history;
- Loan lifecycle;
- archived-object lookup.

### Exports and feeds

Provide bounded JSON, CSV, NDJSON, and activity-feed access only where the resource envelope permits. Document limits and unavailable data.

Add contract tests for pagination limits, filters, sorting, network and epoch metadata, provenance, archived lookup, stale warnings, malformed identifiers, injection attempts, and raw-retention boundaries.

## M4: baseline monitoring UI

Deliver the normal monitor before prioritizing differentiated audit views.

### App shell, Overview, and Network Status

Implement responsive navigation and visible network/epoch context. Show validated ledger, freshness, collector lag, current counts, asset-separated totals, recent activity, amendment state, reset notices, loading states, empty states, stale states, and errors.

### Vault UI

Implement Vault list and detail with search, bounded pagination, sorting, filtering, current fields, asset identity, utilization, relationships, activity, and history.

### LoanBroker UI

Implement Broker list and detail with related Vault, Loan book, debt, cover, required cover, surplus or shortfall, activity, and history.

### Loan UI

Implement Loan list and detail with terms, balances, payment schedule, on-ledger status, schedule status, related Broker and Vault, and clear unavailable data.

### Activity, transaction, search, and account UI

Implement activity list, transaction detail, global search, and account relationship views.

Use Playwright to cover core flows, responsive layouts, long identifiers, loading, empty, stale, archived, and error states. At Checkpoint C, verify baseline monitor completeness before promoting audit-only features.

## M5: differentiated audit UI

Add:

- Loan lifecycle and payment timeline;
- impair, unimpair, default, and delete events;
- normalized state changes with before and after values;
- source transactions and retained raw data;
- archived Vault, Broker, and Loan pages;
- Devnet epoch selection and reset context;
- cover, debt, and loss timelines;
- direct, derived, indexed, and unavailable provenance labels;
- formula, methodology, API, and data documentation pages.

Do not introduce proprietary risk scores, borrower identity claims, or unsupported financial conclusions.

## M6: hardening and public Devnet release

### Data integrity and reset simulation

Prove:

- Devnet reset creates a new epoch;
- old epochs remain intact;
- cursor gaps and hash discontinuities are rejected;
- current and archive projections reconcile;
- failed snapshot replacement rolls back safely;
- duplicate processing does not duplicate canonical data.

### Runtime benchmark and guardrails

Measure and document:

- runtime distribution;
- request count;
- D1 reads and writes;
- storage growth;
- shard growth;
- catch-up after controlled delay;
- endpoint outage and recovery;
- retry and backoff behavior;
- stale-data behavior;
- bounded scheduling behavior.

Activate guardrails required by `docs/resource-envelope.md`.

### Accessibility, performance, and browser coverage

Verify keyboard navigation, focus, semantics, contrast, responsive behavior, table usability, long identifiers, error recovery, major browser coverage, and performance budgets.

### Public documentation and deployment preparation

Prepare public documentation, methodology, provenance, API reference, operational runbook, backup/export procedure, and rollback procedure. Final public deployment, domain changes, production resource changes, and final legal text remain human approval gates.

### Multi-day soak

Run the required multi-day Devnet collector soak. Record bounded evidence for:

- no duplicate canonical events;
- no unexplained cursor or hash gaps;
- successful recovery from endpoint failures;
- catch-up within the accepted envelope;
- controlled database and object-storage growth;
- correct stale warnings;
- snapshot integrity;
- reset simulation;
- rollback.

### Final release gates

Do not declare the public Devnet release complete until every release gate in `docs/product-spec.md`, `docs/testing-strategy.md`, and `docs/development-roadmap.md` passes.

## Work that remains outside this goal

Do not add wallet connection, signing, transaction submission, deposit, withdrawal, borrowing, repayment, Broker management, user accounts, personal portfolios, push notifications, fiat aggregation, or unapproved pricing features.

Mainnet is a separate follow-on milestone. Do not enable it without the required amendment verification, starting-ledger and backfill decision, capacity review, production-shaped read soak, and explicit approval.

## Reporting format while executing

Keep repository records precise. For each completed unit, record:

- roadmap unit and GitHub pull request;
- branch and merge commit;
- files or contracts added;
- migrations;
- unit, integration, browser, and live checks run;
- exact bounded live evidence;
- resource measurements;
- remaining open questions;
- blockers and required human decision;
- first incomplete next action.

Do not mark a milestone complete because code exists. Mark it complete only when its documented exit condition and tests pass.
