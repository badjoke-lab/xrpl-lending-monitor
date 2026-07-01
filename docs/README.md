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
11. [`implementation-status.md`](implementation-status.md) — current state, active pull request, blockers, and exact resume point
12. [`decision-log.md`](decision-log.md) — accepted architectural and product decisions
13. [`codex-goal.md`](codex-goal.md) — durable long-running Codex objective and resume task
14. [`codex-master-task.md`](codex-master-task.md) — end-to-end execution instructions from the current state through public Devnet release

## Authority rules

- `product-spec.md` defines what the product is.
- Domain documents define how that part works.
- `development-roadmap.md` defines implementation order and dependencies.
- `implementation-status.md` defines the current active work and resume point.
- `decision-log.md` records why material choices were made.
- `codex-goal.md` and `codex-master-task.md` direct long-running execution but do not override product specifications, integrity rules, release gates, or human approval requirements.
- Root `AGENTS.md` defines mandatory repository operating rules.

When documents conflict, stop the conflicting implementation path and correct the conflict before proceeding.

## Update requirements

Every implementation pull request must update `implementation-status.md`. A pull request must also update the relevant specification, roadmap, resource envelope, or decision record when it changes behavior, scope, sequencing, resource use, or a previously accepted decision.

Long-running agents must persist exact progress, evidence, blockers, and the first incomplete action in GitHub before a session ends so later work can resume without relying on conversation history.
