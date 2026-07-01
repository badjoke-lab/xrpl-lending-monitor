# Decision log

Public decisions are recorded in the product, architecture, roadmap, and implementation-status documents.

This file is reserved for concise public architecture decisions added by future changes.

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

Vault, LoanBroker, and Loan scans are fixed to one validated ledger and written to a `building` snapshot. The snapshot becomes `active` only after every marker page, object normalization, relationship check, and D1 write succeeds.

### Consequences

- opaque markers are preserved exactly;
- partial scans are not exposed as current totals;
- a failed replacement does not overwrite the previous active snapshot;
- cursor advancement occurs only in the final activation batch;
- current-state collection remains disabled by default until Checkpoint A approves runtime and cadence;
- page, request, object, write-batch, and elapsed-time measurements are recorded for the runtime decision.
