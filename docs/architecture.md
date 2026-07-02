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
- GitHub Actions or another approved long-running bootstrap runner
- External object storage for compressed bootstrap shards
- XRPL JSON-RPC over HTTPS and WebSocket where appropriate

The initial product uses a lightweight managed deployment model and does not require a continuously running application server or a self-hosted XRPL node.

No UI framework, design-system package, router, CMS, or content service is approved merely by being named in a mockup or planning document. The initial UI should use the existing React/Vite stack and ordinary CSS unless a focused decision justifies another dependency.

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
  |- compressed object shards     |- status and lifecycle engine
  |- complete manifest            |- public API
        |                              |
        v                              v
External object storage          Cloudflare D1
  |- current-state shards          |- network epochs and sync cursor
  |- manifests                     |- snapshot metadata and active pointer
  |- incomplete-attempt area       |- transactions and normalized changes
                                   |- lifecycle events
                                   |- deleted-object archive
                                   |- aggregate snapshots
        \                              /
         \                            /
          +------------+-------------+
                       |
                       v
              React/Vite static application
                |- application shell and navigation
                |- overview and entity pages
                |- search and activity
                |- history and audit views
                |- API and methodology documentation
                |- About, Contact, and optional Support section
```

## Runtime boundaries

### Bootstrap runner

Responsible for:

- selecting and persisting one validated ledger hash and index;
- performing one unfiltered binary `ledger_data` traversal;
- resuming from the exact opaque marker;
- decoding pages and classifying Vault, LoanBroker, and Loan objects locally;
- normalizing zero-omitted terminal Loan fields without inventing timestamps;
- writing bounded compressed shards;
- generating and verifying a complete manifest;
- activating snapshot metadata in D1 only after verification;
- preserving the previous active snapshot after failure;
- recording request, page, object, memory, wall-time, shard, and retry metrics.

The bootstrap runner is not a public request handler and is not triggered by page traffic. It is used for first activation, new epochs, and explicitly approved replacement scans.

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
- resolving the active snapshot manifest where current object data is required;
- filtering, sorting, pagination, and search;
- attaching network, epoch, cursor, snapshot, and synchronization metadata;
- serving derived values with provenance;
- applying cache and abuse controls.

The public API must never expose secrets, transaction signing, or write operations.

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
- never imply a write, wallet, signing, or protocol-management capability.

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

The shell must not block successful panels because one API request failed. Page-level data loading should permit partial success and component-level error states.

### Route model

Canonical routes are defined in `ui-page-map.md`.

Implementation requirements:

- deep links work in the Cloudflare Static Assets deployment;
- browser back and forward navigation restore route, filters, pagination, and meaningful subviews;
- static-asset fallback does not intercept `/api/*`;
- invalid identifiers fail explicitly;
- archived-only results link to archive routes rather than silently appearing current;
- no invalid Mainnet request falls back to Devnet data.

A lightweight routing implementation may be built with the platform History API or an approved router. Adding a router dependency requires checking bundle, accessibility, static-deployment, and maintenance impact.

### UI data boundary

UI components consume serialized API contracts. They do not import collector parsers, storage repositories, migration models, or bootstrap internals.

Recommended layers:

```text
src/ui/
  app and route composition
  components/
  pages/
  hooks/
  lib/api and formatting
  types/API response types
```

Exact folders may change through implementation, but the separation between fetching, formatting, page composition, and reusable components must remain.

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

Shared components represent:

- loading;
- empty;
- unavailable;
- stale;
- partial;
- error;
- archived;
- not found;
- invalid identifier.

These are not interchangeable. Zero is a data value, not an error or availability state.

### Page templates

- dashboard page;
- list page;
- entity detail page;
- transaction page;
- audit page;
- documentation/project page.

Templates share navigation and tokens but retain different density and reading behavior.

### Responsive architecture

- desktop uses persistent sidebar and full context bar;
- compact layouts reduce columns and move secondary rails;
- tablet uses drawer navigation where needed;
- mobile uses app bar, bottom navigation, More menu, and mobile-specific information priority;
- tables use declared priority columns, row expansion, cards, or dedicated overflow rather than arbitrary shrinking;
- documentation pages use collapsible contents on mobile.

### Accessibility architecture

- semantic landmarks and headings;
- skip link;
- visible focus;
- keyboard route and control access;
- non-color state labels;
- accessible loading and refresh announcements where appropriate;
- full values for truncated identifiers;
- 200% zoom and reflow;
- reduced-motion support.

## Project-page architecture

### About

About is a static project page rendered within the application shell. It explains purpose, scope, users, independence, read-only boundaries, non-goals, repository, Methodology, Contact, and optional Support.

### Methodology

Methodology is a long-form structured page with stable section anchors and a table of contents. Its content should be stored in repository-controlled source so changes are reviewed with code and specifications. A CMS is not required.

Implementation may use React content modules, Markdown compiled at build time, or another repository-local format. The chosen method must preserve static deployment, anchors, accessibility, code review, and link checking.

### API documentation

API documentation is a human-readable route within the shell. Live JSON endpoints remain under `/api/*`. The documentation route must not shadow Worker API routes.

### Contact

Contact uses configured external URLs:

- Google Form for general or private inquiries;
- GitHub Issues or issue templates for public technical reports.

External URLs are environment or repository configuration values. Missing values result in omitted or explicitly unavailable actions. Placeholder URLs are not shipped.

### Support

Support is optional and disabled by default. Its canonical location is `/about#support`.

Support configuration must include:

- address;
- payment network;
- accepted asset;
- destination-tag rule;
- QR payload;
- disclosure text;
- operational owner.

The monitor data network and payment network are separate concepts and must be displayed separately. The support configuration does not grant the public API or UI any signing or write capability.

## External-link safety

- Links are configured or derived from validated identifiers.
- Explorer links use the approved Devnet explorer pattern only.
- No untrusted API value becomes an arbitrary URL.
- External links have clear labels and safe `rel` behavior where required.
- Public issue links include a warning against secrets and private data.

## Deployment model

Use one Cloudflare project with environment separation:

- `local` — local D1, fixture data, and local shard fixtures;
- `preview` — pull-request or branch preview with isolated metadata and storage paths;
- `production` — public Devnet monitor.

Mainnet is a data-source mode, not a separate codebase. It remains disabled by configuration until explicitly approved.

Bootstrap execution is separately gated from normal application deployment. A successful web deployment does not imply that bootstrap storage or activation is enabled.

Contact URLs and optional Support configuration must be environment appropriate. Preview deployments must not accidentally publish unapproved production contact or payment information.

## Repository layout target

```text
/
|- AGENTS.md
|- README.md
|- docs/
|- src/
|  |- api/
|  |- bootstrap/
|  |- collector/
|  |- domain/
|  |- ui/
|  |  |- components/
|  |  |- pages/
|  |  |- hooks/
|  |  |- lib/
|  |  |- types/
|  |- worker/
|  |- shared/
|- migrations/
|- tests/
|  |- fixtures/
|  |- unit/
|  |- integration/
|  |- e2e/
|- scripts/
|- public/
|- wrangler.toml or wrangler.jsonc
|- package.json
|- vite.config.ts
|- vitest.config.ts
|- playwright.config.ts
```

Exact folders may change only through a documented decision.

## Domain separation

The codebase should use domain modules rather than page-specific parsing:

- `network`;
- `epoch`;
- `asset`;
- `vault`;
- `loan-broker`;
- `loan`;
- `transaction`;
- `lifecycle`;
- `status`;
- `provenance`;
- `snapshot`;
- `collector-health`.

Parsing, calculation, storage, API serialization, data fetching, and display formatting should not be mixed in one module.

## Data flow guarantees

1. Only validated ledgers become canonical.
2. A bootstrap snapshot is tied to one network, epoch, ledger index, and ledger hash.
3. A bootstrap continuation is persisted only after the corresponding shard is durable.
4. A snapshot becomes active only after its complete manifest is verified.
5. A failed snapshot never replaces the previous active snapshot.
6. An incremental ledger is committed only after all targeted transactions and object updates for that ledger are written successfully.
7. Reprocessing the same ledger produces no duplicate canonical events.
8. Current state is a projection; transaction and lifecycle records are the historical source.
9. Deletion removes an item from current projections but not from history.
10. Every query is scoped by network and epoch.
11. API responses report collector cursor, active snapshot identity, and data age.
12. UI display state cannot upgrade unavailable, stale, indexed, or derived data into direct current fact.

## Availability strategy

The UI may continue serving the latest active snapshot and committed history while bootstrap or incremental collection is temporarily unavailable. It must show stale-data or replacement-in-progress warnings based on collector lag and snapshot state.

The collector uses endpoint fallback, bounded retries, exponential backoff, and a recorded failure state. It must never silently skip a ledger.

The bootstrap runner uses exact marker checkpoints, idempotent shard names, content hashes, bounded retries, and manifest verification. It must never expose a partial traversal as complete current state.

## Security posture

- No private keys, seeds, or wallet sessions.
- No user authentication in the initial release.
- No public write API.
- Strict validation of search and query inputs.
- Bound pagination and export sizes.
- Separate bootstrap, internal collector, and public API permissions.
- Storage write access is not available to the public API.
- Secrets are environment bindings and never committed.
- Raw ledger payloads are treated as untrusted input.
- Manifest and shard paths are validated before activation.
- External Contact and Support configuration is validated and does not introduce signing.
- User-visible errors do not expose internal stack traces, bindings, or secrets.

## Observability

At minimum record:

- last attempted run;
- last successful run;
- last processed ledger;
- current validated ledger;
- active snapshot ID and ledger;
- bootstrap status and exact continuation marker;
- bootstrap pages, decoded objects, relevant objects, shard count, bytes, retries, and wall time;
- lag in ledgers and seconds;
- ledgers processed per incremental run;
- transactions inspected and accepted;
- D1 rows read and written estimates;
- RPC errors and endpoint used;
- storage upload and manifest verification errors;
- reset detections;
- parser failures and unrecognized fields.

UI error telemetry, if later added, must be separately specified and must not collect private user content by default.

## Why not Next.js SSR

The product is primarily a static read interface over a small read-only API. React/Vite plus Workers provides a smaller deployment surface, predictable runtime and storage use, simpler caching, and less runtime coupling than an SSR framework.

## Why not a permanent WebSocket server

Cloudflare Workers are not used as a permanently connected background process. Scheduled polling by ledger cursor is easier to resume, audit, and operate within a measured resource envelope. Browser-side WebSocket updates may be added later as a non-canonical enhancement, but committed API data remains the source served to users.

## Why bootstrap is separate from the Worker

Measured Devnet traversal required thousands of requests and many minutes for a complete global marker pass. A resumable long-running runner provides the execution window and checkpoint model required for first activation without weakening Worker guardrails or exposing partial data.
