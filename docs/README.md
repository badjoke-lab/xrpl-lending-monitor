# Documentation index

This directory is the source of truth for XRPL Lending Monitor.

## Read order

1. [`product-spec.md`](product-spec.md) — product purpose, users, scope, pages, and release gates
2. [`architecture.md`](architecture.md) — system structure and technology choices
3. [`data-model.md`](data-model.md) — persistent entities, fields, relationships, and provenance
4. [`status-model.md`](status-model.md) — on-ledger and schedule-derived states
5. [`asset-model.md`](asset-model.md) — XRP, IOU, and MPT handling
6. [`collector-design.md`](collector-design.md) — collection, backfill, idempotency, and reset handling
7. [`testing-strategy.md`](testing-strategy.md) — required validation and release tests
8. [`resource-envelope.md`](resource-envelope.md) — runtime, storage, and collection limits
9. [`competitor-positioning.md`](competitor-positioning.md) — baseline parity and differentiators
10. [`development-roadmap.md`](development-roadmap.md) — ordered implementation plan and target schedule
11. [`implementation-status.md`](implementation-status.md) — current state, next PR, blockers, and open questions
12. [`decision-log.md`](decision-log.md) — accepted architectural and product decisions

## Authority rules

- `product-spec.md` defines what the product is.
- Domain documents define how that part works.
- `development-roadmap.md` defines implementation order and dependencies.
- `implementation-status.md` defines the current active work.
- `decision-log.md` records why material choices were made.

When documents conflict, stop implementation and correct the conflict before proceeding.

## Update requirements

Every implementation PR must update `implementation-status.md`. A PR must also update the relevant specification, roadmap, resource envelope, or decision record when it changes behavior, scope, sequencing, resource use, or a previously accepted decision.
