# Repository operating instructions

These instructions apply to every contributor and coding agent working in this repository.

## Source of truth

Before planning, editing, testing, or reviewing any change, read:

1. `docs/README.md`
2. `docs/product-spec.md`
3. `docs/development-roadmap.md`
4. `docs/implementation-status.md`
5. Every domain document linked from the roadmap item being implemented

The repository documents are authoritative. Conversation history, old mockups, temporary audit code, and assumptions are not authoritative when they conflict with the current documents.

## Mandatory work sequence

For every change:

1. Identify the active milestone and PR slot in `docs/development-roadmap.md`.
2. Confirm the task appears in `docs/implementation-status.md` as current or next work.
3. Read the relevant specification documents.
4. Implement only the agreed scope.
5. Add or update tests and data-integrity checks.
6. Update `docs/implementation-status.md` in the same PR.
7. Update the roadmap when dates, dependencies, scope, or completion state change.
8. Record a material design change in `docs/decision-log.md`.

Do not silently diverge from the specifications. Change the specification first or in the same PR.

## Non-negotiable product rules

- The initial product is read-only.
- No wallet connection, signing, seed handling, transaction submission, lending, repayment, or deposit UI is allowed in the initial release.
- Devnet and Mainnet data must never be mixed.
- Every stored record must include network and epoch identity.
- XRP, IOU, and MPT assets must remain distinct.
- Unlike assets must not be combined into a synthetic TVL without an explicit, documented pricing layer.
- On-ledger state and schedule-derived state must be stored and displayed separately.
- A late loan must not be labelled defaulted unless the ledger state says it is defaulted.
- Deleted Vault, LoanBroker, and Loan objects must remain searchable through indexed history.
- Derived values must expose their formula and provenance.
- Do not invent LTV, collateral value, credit score, borrower identity, protocol risk score, or investment recommendations.
- All collection must be restartable, idempotent, marker-aware, and bounded for Cloudflare free-tier operation.
- Mainnet support must remain disabled until the amendment state and starting ledger are explicitly approved in the specifications.

## Documentation gates

A PR is incomplete when any of the following is true:

- implementation and docs disagree;
- roadmap status is stale;
- a new table, field, state, API, or page is undocumented;
- a calculation lacks a formula and provenance category;
- a free-tier cost implication is not recorded;
- a new unresolved assumption is not listed in `docs/implementation-status.md`.

## Current phase

The project is in **Milestone 0: foundation and specification lock**. The next implementation work is defined in `docs/implementation-status.md`.
