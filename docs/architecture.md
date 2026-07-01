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
- GitHub Actions
- XRPL JSON-RPC over HTTPS and WebSocket where appropriate

The initial product uses a lightweight managed deployment model and does not require a continuously running server or a self-hosted XRPL node.

## System overview

```text
XRPL Lending Devnet
        |
        | validated ledger JSON-RPC
        v
Cloudflare Worker
  |- scheduled collector
  |- catch-up processor
  |- current-object scanner
  |- transaction and metadata parser
  |- status and lifecycle engine
  |- public API
        |
        v
Cloudflare D1
  |- network epochs and sync cursor
  |- current Vault/Broker/Loan state
  |- transactions and normalized changes
  |- lifecycle events
  |- deleted-object archive
  |- aggregate snapshots
        |
        v
React/Vite static application
  |- overview and entity pages
  |- search and activity
  |- history and audit views
  |- API/data documentation
```

## Runtime boundaries

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

The collector must not depend on the web UI being active.

### Public API Worker

Responsible for:

- read-only D1 queries;
- filtering, sorting, pagination, and search;
- attaching network, epoch, cursor, and synchronization metadata;
- serving derived values with provenance;
- applying cache and abuse controls.

The public API must never expose secrets, transaction signing, or write operations.

### Static web application

Responsible for presentation only. It consumes the public API and does not call privileged internal endpoints.

## Deployment model

Use one Cloudflare project with environment separation:

- `local` — local D1 and fixture data;
- `preview` — pull-request or branch preview;
- `production` — public Devnet monitor.

Mainnet is a data-source mode, not a separate codebase. It remains disabled by configuration until explicitly approved.

## Repository layout target

```text
/
|- AGENTS.md
|- README.md
|- docs/
|- src/
|  |- api/
|  |- collector/
|  |- domain/
|  |- ui/
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
- `collector-health`

Parsing, calculation, storage, API serialization, and display formatting should not be mixed in one module.

## Data flow guarantees

1. Only validated ledgers become canonical.
2. A ledger is committed only after all targeted transactions and object updates for that ledger are written successfully.
3. Reprocessing the same ledger produces no duplicate canonical events.
4. Current tables are projections; transaction and lifecycle tables are the historical source.
5. Deletion removes an item from current projections but not from history.
6. Every query is scoped by network and epoch.
7. API responses report the collector cursor and data age.

## Availability strategy

The UI may continue serving the latest committed data while the collector is temporarily unavailable. It must show a stale-data warning based on collector lag.

The collector uses endpoint fallback, bounded retries, exponential backoff, and a recorded failure state. It must never silently skip a ledger.

## Security posture

- No private keys, seeds, or wallet sessions.
- No user authentication in the initial release.
- No public write API.
- Strict validation of search and query inputs.
- Bound pagination and export sizes.
- Separate internal collector routes from public API routes.
- Secrets are Cloudflare environment bindings and never committed.
- Raw ledger payloads are treated as untrusted input.

## Observability

At minimum record:

- last attempted run;
- last successful run;
- last processed ledger;
- current validated ledger;
- lag in ledgers and seconds;
- ledgers processed per run;
- transactions inspected and accepted;
- D1 rows read and written estimates;
- RPC errors and endpoint used;
- reset detections;
- parser failures and unrecognized fields.

## Why not Next.js SSR

The product is primarily a static read interface over a small read-only API. React/Vite plus Workers provides a smaller deployment surface, predictable runtime and storage use, simpler caching, and less runtime coupling than an SSR framework.

## Why not a permanent WebSocket server

Cloudflare Workers are not used as a permanently connected background process. Scheduled polling by ledger cursor is easier to resume, audit, and operate within a measured resource envelope. Browser-side WebSocket updates may be added later as a non-canonical enhancement, but D1 remains the source served to users.
