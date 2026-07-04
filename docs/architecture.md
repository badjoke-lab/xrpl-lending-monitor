# Architecture

## Target stack

- TypeScript
- React
- Vite
- Cloudflare Workers
- Cloudflare Static Assets
- Cloudflare D1
- Hono or an equivalent small Worker router
- Vitest
- Playwright
- GitHub Actions or another bounded long-running bootstrap runner
- XRPL JSON-RPC over HTTPS and WebSocket where appropriate

The initial product uses a lightweight managed deployment model and does not require a continuously running application server or a self-hosted XRPL node.

No UI framework, design-system package, router, CMS, or content service is approved merely by being named in a mockup or planning document. The initial UI uses the existing React/Vite stack and ordinary CSS unless a focused decision justifies another dependency.

## System overview

```text
XRPL Lending Devnet
        |
        | validated ledger JSON-RPC
        |
        +-------------------------------+
        |                               |
        v                               v
Resumable bootstrap runner        Cloudflare Worker
  |- fixed validated ledger        |- network status refresh
  |- unfiltered binary scan        |- scheduled incremental collector
  |- exact marker checkpoints      |- bounded catch-up processor
  |- local object classification   |- transaction and metadata parser
  |- deterministic artifacts       |- status and lifecycle engine
  |- complete manifest             |- current overlay updates
  |- read-model compiler           |- read-only public API
        |                               |
        v                               v
Verified immutable base read model   Cloudflare D1
  |- active channel                  |- network epochs and sync cursor
  |- manifest                        |- processed ledgers
  |- current entity pages            |- protocol events
  |- exact lookup buckets            |- normalized object changes
  |- relationship/search data        |- lifecycle events
        |                             |- deleted-object archive
        |                             |- balance history
        |                             |- current-state overlay upserts
        |                             |- deletion tombstones
        |                             |- aggregates and health state
        +---------------+---------------+
                        |
                        v
              Public API merge layer
                |- base resolution
                |- overlay precedence
                |- tombstone suppression
                |- freshness metadata
                |- bounded pagination/search
                        |
                        v
              React/Vite static application
                |- application shell and navigation
                |- overview and entity pages
                |- search and activity
                |- history and audit views
                |- API and methodology documentation
                |- About and Contact
```

## Current-state model

The accepted current-state design is a verified immutable base read model plus bounded D1 incremental overlay.

A complete bootstrap:

1. fixes one validated Devnet ledger index and hash;
2. traverses `ledger_data` with the exact opaque server marker;
3. classifies Vault, LoanBroker, and Loan objects locally;
4. writes deterministic bounded artifacts and page manifests;
5. verifies object identity, counts, digests, manifest completeness, and relationships;
6. compiles a bounded lightweight read model for current list, detail, exact lookup, search, and relationship access;
7. publishes the new immutable base and updates the active channel only after verification.

The base read model does not change in place.

After a verified base exists, validated-ledger continuation begins at the ledger immediately after the base ledger. D1 stores only the bounded incremental evidence and current-state changes required after that base.

The public current-state resolution rule is:

1. a D1 overlay upsert overrides the corresponding base object;
2. a D1 deletion tombstone suppresses the corresponding base object from current routes;
3. absence of an overlay row falls back to the verified base object.

A complete base replacement is a separate explicit operation. It is not triggered by page traffic and does not happen on every scheduled collector run.

## Why the base and overlay are separate

Measured projection showed that a row-per-object complete current-state snapshot in D1 would exceed the project's documented storage safety envelope. The design therefore avoids duplicating the complete base dataset into D1 while preserving:

- one fixed validated ledger identity per complete bootstrap;
- exact opaque marker continuation;
- deterministic normalization and hashing;
- complete manifest verification;
- relationship checks;
- immutable verified base publication;
- contiguous incremental continuation;
- idempotent replay;
- explicit stale, gap, partial, unavailable, and error states.

## Runtime boundaries

### Bootstrap runner

Responsible for:

- selecting and persisting one validated ledger hash and index;
- performing one unfiltered binary `ledger_data` traversal;
- resuming from the exact opaque marker;
- decoding pages and classifying Vault, LoanBroker, and Loan objects locally;
- normalizing zero-omitted terminal Loan fields without inventing timestamps;
- writing deterministic bounded artifacts;
- generating and verifying page and snapshot manifests;
- compiling the lightweight current-state read model;
- publishing a new immutable base only after all verification passes;
- recording request, page, object, byte, memory, wall-time, and retry metrics.

The bootstrap runner is not a public request handler and is not triggered by page traffic. It is used for first base publication, new epochs, and explicitly initiated replacement scans.

### Collector Worker

Responsible for:

- polling or receiving the latest validated ledger state at the approved cadence;
- reading the last committed cursor and active base identity;
- resuming from the ledger immediately after the committed cursor;
- processing a bounded contiguous ledger range per run;
- filtering supported Lending-related transactions;
- normalizing AffectedNodes;
- deriving current projection changes;
- recording protocol events, object changes, lifecycle events, archives, and balance history;
- writing current-state overlay upserts for created and modified objects;
- writing deletion tombstones for deleted objects;
- advancing the cursor only after the canonical persistence boundary succeeds;
- detecting Devnet resets and continuity failures;
- updating aggregates and health metrics.

The Collector Worker does not perform full global bootstrap scans. It must not depend on the web UI being active.

### Public API Worker

Responsible for:

- resolving the verified active base read model;
- reading bounded current Vault, Loan Broker, and Loan data from the base;
- reading bounded D1 overlay upserts and deletion tombstones;
- applying deterministic base-plus-overlay resolution;
- resolving same-epoch and same-base relationships;
- filtering, sorting, pagination, and search;
- attaching network, epoch, base, cursor, overlay watermark, and synchronization metadata;
- serving derived values with provenance;
- applying cache and abuse controls.

The public API never exposes secrets, transaction signing, payment operations, or write operations.

### Static web application

Responsible for presentation only. It consumes the public API and does not call privileged collector or bootstrap routes.

It must:

- preserve network, epoch, freshness, base, and provenance context;
- distinguish loading, empty, unavailable, stale, partial, error, archived, and invalid-route states;
- use only API-supported values;
- keep current and historical data separate;
- keep on-ledger and schedule status separate;
- preserve asset identity and avoid unsupported aggregation;
- provide responsive, accessible Monitor, Audit, System, and Project pages;
- keep raw data after human-readable summaries;
- never imply a wallet, funding, payment, signing, protocol-management, or transaction-submission capability.

## Data flow guarantees

1. Only validated ledgers become canonical.
2. A complete base is tied to one network, epoch, ledger index, and ledger hash.
3. A bootstrap marker advances only after the corresponding bounded artifact output is durable.
4. A base becomes active only after complete manifest and relationship verification.
5. A failed base replacement never replaces the previous verified base.
6. Incremental processing begins at the ledger after the base or committed incremental cursor.
7. Incremental ledger persistence, canonical event persistence, current overlay persistence, and cursor advancement share the documented atomic boundary.
8. Reprocessing produces no duplicate canonical events or conflicting current overlay state.
9. Current state is resolved from verified base plus applied overlay; transaction and lifecycle records are historical evidence.
10. Deletion hides an item from current projections but does not remove retained history.
11. Every query is scoped by network and epoch and tied to a base identity where current state is involved.
12. API responses report collector cursor, active base identity, overlay watermark, and data age.
13. A detected gap or parent-hash discontinuity stops continuation and is never skipped.
14. Stale or incomplete continuation is never presented as fresh.

## Overlay semantics

### Upsert

A supported CreatedNode or ModifiedNode may produce a normalized current projection upsert. The overlay record includes enough identity and provenance to prove:

- network and epoch;
- active base snapshot identity;
- object type and object ID;
- relevant relationships;
- canonical projection JSON;
- ledger index and hash;
- source transaction hash;
- update time.

A newer canonical overlay state replaces the older overlay state for the same object only through contiguous validated-ledger processing.

### Deletion tombstone

A supported DeletedNode produces a current-state tombstone and historical archive evidence where available.

A tombstone prevents the immutable base object from reappearing in current list, detail, search, count, or relationship results.

### Count and aggregate resolution

Overview counts and aggregates must be derived from a verified base plus bounded created, updated, and deleted overlay effects. Cross-asset totals remain prohibited without an approved pricing subsystem.

### Base replacement

When a new verified base is published:

1. fix and verify the replacement base ledger;
2. publish the immutable replacement read model;
3. bind subsequent continuation to the replacement base identity;
4. reconcile overlap and preserve indexed historical evidence;
5. retain explicit stale or partial state until the new continuation path is proven contiguous.

## UI architecture

### Source-of-truth documents

UI implementation follows:

- `ui-information-architecture.md`;
- `ui-page-map.md`;
- `ui-page-specifications.md`;
- `ui-design-spec.md`;
- `ui-component-inventory.md`;
- `ui-responsive-rules.md`;
- `ui-reference/README.md`.

Generated mockups are visual references only and do not define data, routes, or behavior.

### Application shell

The shell owns:

- desktop sidebar;
- mobile app bar, bottom navigation, and More menu;
- persistent network context bar;
- page heading and breadcrumbs;
- main content landmark;
- global footer;
- not-found and invalid-route handling;
- focus restoration after navigation.

The shell must not block successful panels because one API request failed. Page-level data loading permits partial success and component-level error states.

### Route model

Canonical routes are defined in `ui-page-map.md`.

Implementation requirements:

- deep links work in the Cloudflare Static Assets deployment;
- browser back and forward navigation restore route, filters, pagination, and meaningful subviews;
- static-asset fallback does not intercept `/api/*`;
- invalid identifiers fail explicitly;
- archived-only results link to archive routes rather than silently appearing current;
- no invalid Mainnet request falls back to Devnet data.

A lightweight routing implementation may use the platform History API or an approved router. Adding a router dependency requires checking bundle, accessibility, static-deployment, and maintenance impact.

### UI data boundary

UI components consume serialized API contracts. They do not import collector parsers, storage repositories, migration models, bootstrap internals, or base-read internals.

Fetching, formatting, page composition, and reusable components remain separated.

### Fetching and partial failure

- Network status and page data may load independently.
- One failed panel does not discard successful sibling data.
- Requests are abortable when routes change.
- Stale data remains visible with a warning when safe.
- Unavailable data uses the API reason rather than a fabricated fallback.
- Retry controls are bounded and user initiated.
- Error messages are public safe and do not expose stack traces or secrets.

### Display formatting

Formatting code must not alter canonical identity or precision.

- amounts retain exact asset unit and scale;
- accounts, IDs, hashes, and issuance IDs may be visually shortened but retain complete values and link targets;
- times identify timezone, normally UTC;
- derived values link to formula provenance;
- no fiat conversion or cross-asset total is introduced by display helpers.

### State model

Shared components represent loading, empty, unavailable, stale, partial, error, archived, not found, and invalid identifier states. These are not interchangeable. Zero is a data value, not an error or availability state.

### Responsive and accessibility architecture

- desktop uses a persistent sidebar and full context bar;
- compact layouts reduce columns and move secondary rails;
- tablet uses drawer navigation where needed;
- mobile uses app bar, bottom navigation, More menu, and mobile-specific information priority;
- tables use declared priority columns, row expansion, cards, or dedicated overflow rather than arbitrary shrinking;
- documentation pages use collapsible contents on mobile;
- semantic landmarks, headings, skip links, visible focus, keyboard access, non-color state labels, full identifier values, 200% zoom, reflow, and reduced motion are required.

## Project pages

About explains purpose, scope, users, independence, read-only boundaries, non-goals, repository, Methodology, and Contact.

Methodology is a long-form structured page with stable section anchors and a table of contents. Its content is repository controlled and reviewed with code.

API documentation is a human-readable route within the shell. Live JSON endpoints remain under `/api/*`.

Contact uses configured external destinations only. Missing values result in omitted or explicitly unavailable actions. Placeholder URLs are not shipped.

## Deployment model

Use one Cloudflare project with environment separation:

- `local` — local D1 and fixture data;
- `preview` — isolated validation where available;
- `production` — public Devnet monitor.

Mainnet is a data-source mode, not a separate codebase. It remains disabled by configuration until separately approved.

A successful web deployment does not imply that base publication, incremental catch-up, or collector continuation has occurred.

## Security posture

- No private keys, seeds, wallet sessions, or public write API.
- Strict validation of search and query inputs.
- Bounded pagination, exports, D1 queries, incremental batches, and bootstrap work.
- Separate bootstrap, collector, and public API responsibilities.
- Raw ledger payloads are treated as untrusted input.
- Public errors do not expose stack traces, credentials, provider account identifiers, or internal incident details.
- Public documentation does not include unpublished operational strategy or unrelated project context.

## Observability

Record at minimum:

- active base snapshot identity and ledger;
- base publication time and manifest identity;
- bootstrap status and continuation state during complete scans;
- bootstrap pages, decoded objects, relevant objects, bytes, retries, and wall time;
- latest validated ledger and last processed ledger;
- overlay watermark;
- lag in ledgers and seconds;
- transactions inspected and accepted;
- D1 rows read and written estimates;
- RPC and persistence errors in public-safe form;
- reset detections;
- parser failures and unrecognized fields;
- reconciliation results.

## Why bootstrap is separate from the Worker

Measured Devnet traversal requires thousands of requests and many minutes for a complete global marker pass. A resumable long-running runner provides the execution window and checkpoint model required for complete base generation without weakening Worker guardrails or exposing partial data.

The scheduled Worker performs only bounded incremental continuation and catch-up. It never rebuilds the complete global base state during ordinary scheduled execution.