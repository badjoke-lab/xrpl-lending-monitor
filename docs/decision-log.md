# Decision log

Public decisions are recorded in the product, architecture, roadmap, and implementation-status documents.

This file records concise public architecture and product decisions that materially constrain later implementation.

## D-014 — Canonical asset identity and exact arithmetic

- Date: 2026-07-01
- Status: accepted

### Decision

Canonical asset identity is `XRP`, `IOU:<currency>:<issuer>`, or `MPT:<issuance_id>`. Friendly labels, ticker symbols, names, and other metadata never replace the canonical key.

Canonical amount arithmetic uses exact integer coefficients, explicit decimal scales, and `BigInt`. Binary floating point is not used for stored or derived protocol quantities.

### Consequences

- IOUs with different issuers cannot be combined;
- MPTs with different issuance IDs cannot be combined even when their tickers match;
- XRP drops and MPT integer units are displayed using explicit scales;
- exponent-form IOU values normalize deterministically;
- aggregation fails before combining unlike asset keys;
- missing or malformed MPT metadata does not hide or alter the issuance identity.

## D-015 — Complete scans activate through staged snapshots

- Date: 2026-07-01
- Status: accepted

### Decision

Vault, LoanBroker, and Loan scans are fixed to one validated ledger and written to a `building` snapshot. The snapshot becomes `active` only after every marker page, object normalization, relationship check, and persistence step succeeds.

### Consequences

- opaque markers are preserved exactly;
- partial scans are not exposed as current totals;
- a failed replacement does not overwrite the previous active snapshot;
- cursor advancement occurs only after a complete manifest exists;
- current-state collection remains disabled by default until runtime and storage integration pass their checks;
- page, request, object, write-batch, and elapsed-time measurements are recorded.

## D-016 — Terminal Loan zero fields

- Date: 2026-07-01
- Status: accepted

### Decision

Numeric Loan fields omitted by canonical XRPL binary decoding are treated as zero where the protocol uses zero defaults. `NextPaymentDueDate` is nullable because it is removed when a Loan reaches a terminal paid or defaulted state. A Loan with payments remaining but no next due date is rejected.

### Consequences

- paid and defaulted Loan objects remain visible;
- missing terminal zero fields do not fail collection;
- no timestamp is invented;
- inconsistent active schedule state still fails closed;
- raw decoded fields remain available for audit.

## D-017 — Resumable bootstrap runner

- Date: 2026-07-01
- Status: accepted

### Decision

The full current-state bootstrap uses a resumable long-running runner and one unfiltered binary ledger traversal. It writes bounded compressed shards and publishes a verified manifest. The scheduled Worker handles bounded status and incremental ledger processing after bootstrap.

### Consequences

- repeated filtered traversals are rejected;
- full in-memory accumulation is rejected;
- production bootstrap remains disabled until resume, upload, manifest, cleanup, and activation tests pass;
- an initial active snapshot is required before incremental maintenance begins.

## D-018 — Checkpoint B history boundary

- Date: 2026-07-02
- Status: accepted

### Decision

M2 history data contracts are stable enough to begin M3 public API contract implementation for current indexed data, object changes, lifecycle events, archives, balance history, and reconciliation reports.

Public lifecycle completeness claims are not yet approved. They remain gated on a complete active bootstrap snapshot, fixture-ledger replay coverage for supported transaction shapes, and later release-gate soak/reconciliation evidence.

### Consequences

- M3 API work may begin without reworking M2 table identities;
- API responses must expose provenance, freshness, and unavailable or incomplete states;
- UI and public documentation must not claim complete pre-snapshot history;
- deleted-object, lifecycle, cover, debt, loss, and status data may be exposed only as indexed data bounded by collected evidence;
- public release remains blocked until M1 active snapshot and M6 integrity evidence pass.

## D-019 — Ledger-observatory UI architecture

- Date: 2026-07-02
- Status: accepted

### Decision

The public interface uses a dark ledger-observatory design with a persistent desktop sidebar, mobile app bar and bottom navigation, visible Devnet/epoch/freshness context, summary-first entity pages, monospace identifiers, and explicit loading, empty, unavailable, stale, partial, error, archived, and invalid-route states.

The approved mockup set is a visual and information-density reference only. API contracts and product specifications remain the sole authority for displayed values.

### Consequences

- the light simplified WIP shell at `ui/overview-status-shell` commit `aa623b9` is a resumable checkpoint, not a merge-ready design;
- M4 UI code cannot resume until the UI architecture documentation is merged;
- no USD conversion, oracle pricing, cross-asset total, unsupported chart, operational metric, state, or example value may be copied from mockups;
- desktop and mobile behavior are separately specified and tested;
- raw data follows human-readable summaries;
- shared state components and provenance treatment are required before page expansion.

## D-020 — Project pages and optional support placement

- Date: 2026-07-02
- Status: accepted

### Decision

About, Methodology, Contact, and API documentation are required baseline pages.

Methodology is a separate comprehensive technical page rather than content compressed into About. Contact offers a configured Google Form for general/private inquiries and configured GitHub Issues for public technical reports and data corrections.

Support, if enabled, is a section at `/about#support`, not a standalone page. It is disabled by default until its address, payment network, accepted asset, destination-tag rule, QR payload, disclosure text, and operational ownership receive explicit approval.

### Consequences

- no placeholder form, issue, explorer, or payment URL is published;
- public-issue privacy warnings are required;
- support links may appear in Project navigation, mobile More, footer, and Contact, but point to `/about#support`;
- support prompts do not appear inside monitoring cards, data tables, warnings, entity details, or audit results;
- Devnet monitoring and any Mainnet support-payment network are displayed as separate concepts;
- support provides no entitlement, influence, listing benefit, investment return, or service level.
