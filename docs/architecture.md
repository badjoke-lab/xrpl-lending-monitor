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
        +------------------------------+
        |                              |
        v                              v
Resumable bootstrap runner       Cloudflare Worker
  |- fixed validated ledger       |- network status refresh
  |- unfiltered binary scan       |- incremental ledger collector
  |- exact marker checkpoints     |- catch-up processor
  |- local object classification  |- transaction and metadata parser
  |- bounded D1 snapshot writes   |- status and lifecycle engine
  |- complete manifest            |- read-only public API
        |                              |
        +---------------+--------------+
                        |
                        v
                 Cloudflare D1
                   |- network epochs and sync cursor
                   |- immutable current-state snapshots
                   |- snapshot manifests and checkpoints
                   |- active snapshot pointer
                   |- current Vault/Broker/Loan rows
                   |- transactions and normalized changes
                   |- lifecycle events
                   |- deleted-object archive
                   |- aggregate and balance history
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

## Current-state snapshot model

The accepted current-state design is D1-only. An earlier external object-storage design is superseded.

A bootstrap attempt:

1. fixes one validated Devnet ledger index and hash;
2. traverses `ledger_data` with the exact opaque server marker;
3. classifies Vault, LoanBroker, and Loan objects locally;
4. writes bounded rows into an inactive snapshot ID;
5. records deterministic object and batch hashes;
6. advances the checkpoint only after the corresponding D1 batch is durable;
7. verifies counts, hashes, manifest completeness, and same-snapshot relationships;
8. atomically switches the active pointer only after complete verification.

Completed snapshots are immutable. A failed replacement cannot overwrite the prior active snapshot. One prior verified snapshot is retained as the rollback target. Cleanup is limited to explicitly eligible incomplete attempts.

## Runtime boundaries

### Bootstrap runner

Responsible for:

- selecting and persisting one validated ledger hash and index;
- performing one unfiltered binary `ledger_data` traversal;
- resuming from the exact opaque marker;
- decoding pages and classifying Vault, LoanBroker, and Loan objects locally;
- normalizing zero-omitted terminal Loan fields without inventing timestamps;
- writing bounded inactive D1 snapshot batches;
- generating and verifying a complete manifest;
- activating the snapshot pointer only after verification;
- preserving the previous active snapshot after failure;
- recording request, page, object, row, byte, memory, wall-time, and retry metrics.

The bootstrap runner is not a public request handler and is not triggered by page traffic. It is used for first activation, new epochs, and explicitly initiated replacement scans.

### Collector Worker

Responsible for:

- polling the latest validated ledger;
- resuming from the last committed cursor;
- processing a bounded number of ledgers per run;
- filtering Lending-related transactions;
- normalizing AffectedNodes;
- refreshing affected objects;
- recording lifecycle events and deletions;
- detecting Devnet resets;
- updating aggregate data;
- recording health metrics.

The Collector Worker does not perform full global bootstrap scans. It must not depend on the web UI being active.

### Public API Worker

Responsible for:

- read-only D1 queries;
- resolving the verified active snapshot pointer;
- reading bounded current Vault, Loan Broker, and Loan rows from that snapshot;
- resolving same-snapshot relationships;
- filtering, sorting, pagination, and search;
- attaching network, epoch, cursor, snapshot, and synchronization metadata;
- serving derived values with provenance;
- applying cache and abuse controls.

The public API never exposes secrets, transaction signing, payment operations, or write operations.

### Static web application

Responsible for presentation only. It consumes the public API and does not call privileged collector or bootstrap routes.

It must:

- preserve network, epoch, freshness, and provenance context;
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
2. A bootstrap snapshot is tied to one network, epoch, ledger index, and ledger hash.
3. A continuation marker advances only after the corresponding bounded D1 write is durable.
4. A snapshot becomes active only after its complete manifest and relationships verify.
5. A failed snapshot never replaces the previous active snapshot.
6. Incremental ledger persistence, canonical event persistence, and cursor advancement are atomic at the documented boundary.
7. Reprocessing produces no duplicate canonical events.
8. Current state is a projection; transaction and lifecycle records are historical evidence.
9. Deletion removes an item from current projections but not from retained history.
10. Every query is scoped by network and epoch.
11. API responses report collector cursor, active snapshot identity, and data age.

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

UI components consume serialized API contracts. They do not import collector parsers, storage repositories, migration models, or bootstrap internals.

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

A successful web deployment does not imply that bootstrap, migration, or snapshot activation has occurred.

## Security posture

- No private keys, seeds, wallet sessions, or public write API.
- Strict validation of search and query inputs.
- Bounded pagination, exports, D1 queries, and bootstrap batches.
- Separate bootstrap, collector, and public API responsibilities.
- Raw ledger payloads are treated as untrusted input.
- Public errors do not expose stack traces, credentials, provider account identifiers, or internal incident details.

## Observability

Record at minimum:

- active snapshot ID and ledger;
- bootstrap status and continuation state;
- bootstrap pages, decoded objects, relevant objects, rows, bytes, retries, and wall time;
- latest validated ledger and last processed ledger;
- lag in ledgers and seconds;
- transactions inspected and accepted;
- D1 rows read and written estimates;
- RPC and persistence errors in public-safe form;
- reset detections;
- parser failures and unrecognized fields.

## Why bootstrap is separate from the Worker

Measured Devnet traversal requires thousands of requests and many minutes for a complete global marker pass. A resumable long-running runner provides the execution window and checkpoint model required for first activation without weakening Worker guardrails or exposing partial data.
