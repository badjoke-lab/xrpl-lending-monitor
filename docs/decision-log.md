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
