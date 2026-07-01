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
                |- overview and entity pages
                |- search and activity
                |- history and audit views
                |- API/data documentation
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

## Deployment model

Use one Cloudflare project with environment separation:

- `local` — local D1, fixture data, and local shard fixtures;
- `preview` — pull-request or branch preview with isolated metadata and storage paths;
- `production` — public Devnet monitor.

Mainnet is a data-source mode, not a separate codebase. It remains disabled by configuration until explicitly approved.

Bootstrap execution is separately gated from normal application deployment. A successful web deployment does not imply that bootstrap storage or activation is enabled.

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
|- wrangler.toml
|- package.json
|- vite.config.ts
|- vitest.config.ts
|- playwright.config.ts
```

Exact folders may change only through a documented decision.

## Domain separation

The codebase should use domain modules rather than page-specific parsing:

- `network`
- `epoch`
- `asset`
- `vault`
- `loan-broker`
- `loan`
- `transaction`
- `lifecycle`
- `status`
- `provenance`
- `snapshot`
- `collector-health`

Parsing, calculation, storage, API serialization, and display formatting should not be mixed in one module.

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

## Why not Next.js SSR

The product is primarily a static read interface over a small read-only API. React/Vite plus Workers provides a smaller deployment surface, predictable runtime and storage use, simpler caching, and less runtime coupling than an SSR framework.

## Why not a permanent WebSocket server

Cloudflare Workers are not used as a permanently connected background process. Scheduled polling by ledger cursor is easier to resume, audit, and operate within a measured resource envelope. Browser-side WebSocket updates may be added later as a non-canonical enhancement, but committed API data remains the source served to users.

## Why bootstrap is separate from the Worker

Measured Devnet traversal required thousands of requests and many minutes for a complete global marker pass. A resumable long-running runner provides the execution window and checkpoint model required for first activation without weakening Worker guardrails or exposing partial data.
