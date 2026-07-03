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
- missing or malformed MPT metadata does not hide or alter issuance identity.

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

The full current-state bootstrap uses a resumable long-running runner and one unfiltered binary ledger traversal. It writes bounded snapshot batches and publishes a verified manifest. The scheduled Worker handles bounded status and incremental ledger processing after bootstrap.

### Consequences

- repeated filtered traversals are rejected;
- full in-memory accumulation is rejected;
- production bootstrap remains disabled until resume, persistence, manifest, cleanup, and activation tests pass;
- an initial active snapshot is required before incremental maintenance begins.

## D-018 — Checkpoint B history boundary

- Date: 2026-07-02
- Status: accepted

### Decision

M2 history data contracts are stable enough to begin M3 public API contract implementation for current indexed data, object changes, lifecycle events, archives, balance history, and reconciliation reports.

Public lifecycle completeness claims are not yet approved. They remain gated on a complete active bootstrap snapshot, fixture-ledger replay coverage for supported transaction shapes, and later release-gate soak and reconciliation evidence.

### Consequences

- M3 API work may begin without reworking M2 table identities;
- API responses expose provenance, freshness, and unavailable or incomplete states;
- UI and public documentation do not claim complete pre-snapshot history;
- deleted-object, lifecycle, cover, debt, loss, and status data are exposed only as indexed data bounded by collected evidence;
- public release remains blocked until M1 active snapshot and M6 integrity evidence pass.

## D-019 — Ledger-observatory UI architecture

- Date: 2026-07-02
- Status: accepted

### Decision

The public interface uses a dark ledger-observatory design with a persistent desktop sidebar, mobile app bar and bottom navigation, visible Devnet, epoch, and freshness context, summary-first entity pages, monospace identifiers, and explicit loading, empty, unavailable, stale, partial, error, archived, and invalid-route states.

The approved mockup set is a visual and information-density reference only. API contracts and product specifications remain the sole authority for displayed values.

### Consequences

- the light simplified WIP shell at `ui/overview-status-shell` commit `aa623b9` is a historical checkpoint, not a merge-ready design;
- no USD conversion, oracle pricing, cross-asset total, unsupported chart, operational metric, state, or example value is copied from mockups;
- desktop and mobile behavior are separately specified and tested;
- raw data follows human-readable summaries;
- shared state components and provenance treatment are required before page expansion.

## D-020 — Project pages and external contact

- Date: 2026-07-02
- Status: accepted

### Decision

About, Methodology, Contact, and API documentation are required baseline pages.

Methodology is a separate comprehensive technical page rather than content compressed into About. Contact offers a configured Google Form for general or private inquiries and configured GitHub Issues for public technical reports and data corrections.

Funding, donation, payment, and promotional surfaces are not part of the current release scope.

### Consequences

- no placeholder form, issue, explorer, payment, or promotional URL is published;
- public-issue privacy warnings are required;
- Project navigation contains About and Contact;
- documentation and project pages remain read-only;
- later commercial or funding functionality requires a separate specification and approval.

## D-021 — D1-only current-state snapshots

- Date: 2026-07-03
- Status: accepted

### Decision

The earlier external object-storage design for current-state snapshot artifacts is superseded. Current-state bootstrap, verification, activation, rollback, and public reads will use versioned D1 snapshot rows and an atomic D1 active-snapshot pointer.

This change is based on architecture simplification, a single measured persistence boundary, atomic activation requirements, and the observed Devnet data envelope. It does not weaken the fixed-ledger, exact-marker, deterministic-hash, manifest-verification, rollback, or fail-closed guarantees.

### Consequences

- snapshot construction writes only to an inactive snapshot ID;
- bounded object batches, typed current rows, hashes, manifest metadata, checkpoints, cleanup eligibility, and the active pointer are stored in D1;
- completed snapshots are immutable;
- activation changes only the active pointer after complete verification;
- the previous active snapshot is retained for rollback;
- incomplete attempts are never exposed as current state;
- current-state reads no longer depend on a separate object-storage binding;
- active-plus-rollback storage, index overhead, row size, write count, and query count must be measured before remote bootstrap;
- the design stops before production use if the documented D1 safety threshold is exceeded.
