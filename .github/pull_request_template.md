## Summary

Describe what changes and why.

## Roadmap alignment

- Milestone:
- Planned PR slot:
- Relevant specification documents read:
  - [ ] `docs/product-spec.md`
  - [ ] `docs/development-roadmap.md`
  - [ ] `docs/implementation-status.md`
  - [ ] Relevant domain documents

## Scope

- In scope:
- Explicitly out of scope:

## Data and product integrity

- [ ] Network and epoch boundaries are preserved.
- [ ] XRP, IOU, and MPT identities remain distinct.
- [ ] On-ledger and schedule-derived state are not conflated.
- [ ] Derived values expose documented formulas and provenance.
- [ ] Deleted-object behavior is preserved where relevant.
- [ ] No wallet, signing, seed, or transaction-submission behavior was added.
- [ ] No invented risk score, LTV, collateral value, borrower identity, or cross-asset TVL was added.

## Resource impact

- Worker requests/CPU impact:
- D1 rows read/written impact:
- Storage impact:
- Cache or batching changes:

## Tests

- [ ] Lint
- [ ] Type-check
- [ ] Unit tests
- [ ] Integration tests
- [ ] D1 migration checks
- [ ] Build
- [ ] Browser tests, when applicable
- [ ] Live Devnet read smoke test, when applicable

Evidence:

## Documentation updates

- [ ] `docs/implementation-status.md` updated.
- [ ] `docs/development-roadmap.md` updated if schedule, status, dependency, or scope changed.
- [ ] Relevant specification updated if behavior or data changed.
- [ ] `docs/decision-log.md` updated for a material decision.
- [ ] `docs/resource-envelope.md` updated for material resource-impact changes.

## Publication review

- [ ] Repository text contains only information needed to understand, operate, test, or maintain the public product.
- [ ] Non-public strategy, personal constraints, unpublished continuation criteria, and unrelated project context are excluded.
- [ ] Decisions are explained through product, safety, reliability, maintainability, or measurable resource reasons.

## Risks and rollback

- Risks:
- Rollback plan:

## Completion check

- [ ] Implementation and documentation agree.
- [ ] No unresolved assumption is hidden in code.
- [ ] The next active work is recorded in `docs/implementation-status.md`.
