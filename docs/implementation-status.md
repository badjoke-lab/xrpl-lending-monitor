# Implementation status

Last updated: 2026-07-01.

## Current milestone

**M0 — Foundation and specification lock**

## Current branch

`foundation/spec-roadmap`

## Current work

Repository source-of-truth documents and operating rules are being established.

## Completed

- Repository created: `badjoke-lab/xrpl-lending-monitor`
- Initial README on `main`
- Repository operating rules
- Documentation index
- Product specification
- Architecture specification
- Data model
- Loan status model
- Asset model
- Collector design
- Testing strategy
- Free-tier operating budget and benchmark gate
- Competitor positioning
- Dated development roadmap

## Next PR

### PR 1 — Foundation specifications and roadmap

Expected contents:

- all M0 source-of-truth documents;
- pull-request checklist enforcing document review and status updates;
- initial decision log;
- README links to the documentation set.

Completion condition:

- PR reviewed and merged;
- this document moved to PR 3 as the next active work;
- no implementation code is added before the documentation source of truth exists on `main`.

## Following PR

### PR 3 — Project skeleton

Planned scope:

- Node and pnpm version pinning;
- TypeScript;
- React and Vite;
- Cloudflare Worker and D1 configuration;
- router;
- Vitest and Playwright;
- ESLint and formatting;
- local/preview/production environment boundaries;
- GitHub Actions;
- migrations folder;
- Mainnet disabled by default.

## Known open questions

These do not block the current documentation PR. They must be resolved in the assigned implementation checkpoint.

| Question | Required evidence | Assigned point |
|---|---|---|
| Can the collector remain under the Workers Free 10 ms CPU limit? | p50, p95, and max CPU benchmark with production-shaped payloads | PR 6 / Checkpoint A |
| What exact schedule-state boundary labels should be public? | unit tests against due time and grace-end boundaries | PR 12 |
| What is the confirmed successful overpayment transaction shape? | isolated Devnet fixture and validated metadata | PR 9 |
| How should each deletion reason be classified? | transaction and DeletedNode fixtures for full payment, default, Broker delete, and Vault delete | PR 10 |
| What MPT metadata is reliably available from public RPC? | live and fixture tests with missing and complete metadata | PR 5 |
| What signals reliably identify a Devnet reset? | simulated reset fixtures plus live observation | PR 4 and PR 25 |
| Is GitHub Actions required as the collector fallback? | Worker benchmark failure or insufficient catch-up capacity | Checkpoint A |

## Current blockers

None for M0.

Implementation is intentionally blocked until the specification PR is merged.

## Risks being watched

- Free Worker CPU limit may be too low for the collector.
- Devnet can reset and erase current public history.
- Public RPC behavior and available history may change.
- MPT metadata may be incomplete.
- Mainnet activation timing is unknown.
- A direct competitor may expand into full lifecycle history.

## Operational rule

Every future PR must update this file with:

- current milestone;
- completed work;
- next PR;
- new blockers or resolved blockers;
- open questions created or closed;
- schedule drift.
