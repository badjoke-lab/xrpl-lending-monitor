# Documentation index

This directory is the source of truth for XRPL Lending Monitor.

## Read order

1. [`product-spec.md`](product-spec.md) — product purpose, users, scope, pages, project pages, and release gates
2. [`architecture.md`](architecture.md) — system, runtime, deployment, and UI architecture
3. [`data-model.md`](data-model.md) — persistent entities, fields, relationships, and provenance
4. [`status-model.md`](status-model.md) — on-ledger and schedule-derived states
5. [`asset-model.md`](asset-model.md) — XRP, IOU, and MPT handling
6. [`collector-design.md`](collector-design.md) — collection, backfill, idempotency, and reset handling
7. [`testing-strategy.md`](testing-strategy.md) — required validation and release tests
8. [`resource-envelope.md`](resource-envelope.md) — runtime, storage, and collection limits
9. [`competitor-positioning.md`](competitor-positioning.md) — baseline parity and differentiators
10. [`ui-information-architecture.md`](ui-information-architecture.md) — Monitor, Audit, System, and Project information groups and navigation
11. [`ui-page-map.md`](ui-page-map.md) — canonical routes and route ownership
12. [`ui-page-specifications.md`](ui-page-specifications.md) — page responsibilities, API dependencies, unavailable behavior, and milestone assignment
13. [`ui-design-spec.md`](ui-design-spec.md) — visual system, state treatment, tables, charts, provenance, and accessibility
14. [`ui-component-inventory.md`](ui-component-inventory.md) — reusable UI component contracts and required states
15. [`ui-responsive-rules.md`](ui-responsive-rules.md) — desktop, tablet, mobile, zoom, and long-content behavior
16. [`ui-reference/README.md`](ui-reference/README.md) — approved mockup interpretation and prohibited invented data
17. [`development-roadmap.md`](development-roadmap.md) — ordered implementation plan, dependencies, and target schedule
18. [`implementation-status.md`](implementation-status.md) — current state, active pull request, blockers, and exact resume point
19. [`decision-log.md`](decision-log.md) — accepted architectural and product decisions
20. [`codex-goal.md`](codex-goal.md) — durable long-running Codex objective and resume task
21. [`codex-master-task.md`](codex-master-task.md) — end-to-end execution instructions from the current state through public Devnet release
22. [`codex-ui-task.md`](codex-ui-task.md) — UI-specific execution order, checkpoint, design, data, testing, and approval boundaries

## Authority rules

- `product-spec.md` defines what the product is.
- Domain documents define how their data and behavior work.
- `ui-information-architecture.md`, `ui-page-map.md`, and `ui-page-specifications.md` define where product information appears and how pages relate.
- `ui-design-spec.md`, `ui-component-inventory.md`, and `ui-responsive-rules.md` define presentation, reusable states, accessibility, and responsive behavior.
- `ui-reference/README.md` interprets mockups but never overrides data or product specifications.
- `development-roadmap.md` defines implementation order and dependencies.
- `implementation-status.md` defines the current active work and resume point.
- `decision-log.md` records why material choices were made.
- `codex-goal.md`, `codex-master-task.md`, and `codex-ui-task.md` direct long-running execution but do not override product specifications, integrity rules, release gates, or human approval requirements.
- Root `AGENTS.md` defines mandatory repository operating rules.

When documents conflict, stop the conflicting implementation path and correct the conflict before proceeding.

## UI source-of-truth boundary

The generated UI mockups are visual references only. They are not fixtures or API contracts. Do not copy example counts, USD conversions, cross-asset totals, oracle claims, hashes, addresses, states, charts, or operational metrics unless the approved API and specifications support them.

The UI implementation must show explicit unavailable, stale, empty, partial, and error states rather than substituting zero or mock data.

## Update requirements

Every implementation pull request must update `implementation-status.md`. A pull request must also update the relevant specification, roadmap, resource envelope, UI document, or decision record when it changes behavior, scope, sequencing, routes, visual rules, resource use, or a previously accepted decision.

A UI pull request is incomplete unless its page specification, responsive behavior, data states, accessibility coverage, and API dependencies agree with the implementation.

Long-running agents must persist exact progress, evidence, blockers, and the first incomplete action in GitHub before a session ends so later work can resume without relying on conversation history.
