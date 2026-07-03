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
9. [`d1-migration-plan.md`](d1-migration-plan.md) — current-state D1 evaluation, bootstrap, verification, activation, and rollback sequence
10. [`d1-command-interface.md`](d1-command-interface.md) — local non-public D1 actions, limits, evidence, and required operation order
11. [`storage-artifact-format.md`](storage-artifact-format.md) — deterministic compressed current-state artifact format
12. [`local-artifact-measurement.md`](local-artifact-measurement.md) — resumable local capacity measurement and evidence output
13. [`competitor-positioning.md`](competitor-positioning.md) — baseline parity and differentiators
14. [`ui-information-architecture.md`](ui-information-architecture.md) — Monitor, Audit, System, and Project information groups and navigation
15. [`ui-page-map.md`](ui-page-map.md) — canonical routes and route ownership
16. [`ui-page-specifications.md`](ui-page-specifications.md) — page responsibilities, API dependencies, unavailable behavior, and milestone assignment
17. [`ui-design-spec.md`](ui-design-spec.md) — visual system, state treatment, tables, charts, provenance, and accessibility
18. [`ui-component-inventory.md`](ui-component-inventory.md) — reusable UI component contracts and required states
19. [`ui-responsive-rules.md`](ui-responsive-rules.md) — desktop, tablet, mobile, zoom, and long-content behavior
20. [`ui-reference/README.md`](ui-reference/README.md) — approved mockup interpretation and prohibited invented data
21. [`development-roadmap.md`](development-roadmap.md) — ordered implementation plan, dependencies, and target schedule
22. [`implementation-status.md`](implementation-status.md) — public implementation state and current release blockers
23. [`decision-log.md`](decision-log.md) — accepted architectural and product decisions

## Authority rules

- `product-spec.md` defines what the product is.
- Domain documents define how their data and behavior work.
- `d1-migration-plan.md` records the current-state D1 evaluation and remote-operation boundaries.
- `d1-command-interface.md` defines the local D1 action boundary and public-safe evidence contract.
- `storage-artifact-format.md` defines the compressed artifact format.
- `local-artifact-measurement.md` defines the local measurement command, resume behavior, and evidence fields.
- UI information-architecture, page, design, component, responsive, and reference documents define presentation and interaction behavior.
- `development-roadmap.md` defines implementation order and dependencies.
- `implementation-status.md` records the current public implementation state.
- `decision-log.md` records why material architecture and product choices were made.
- Root `AGENTS.md` defines repository contribution rules.

When documents conflict, correct the conflict before merging the affected implementation.

## UI source-of-truth boundary

Generated UI mockups are visual references only. They are not fixtures or API contracts. Do not copy example counts, USD conversions, cross-asset totals, oracle claims, hashes, addresses, states, charts, or operational metrics unless the approved API and specifications support them.

The UI must show explicit unavailable, stale, empty, partial, and error states rather than substituting zero or mock data.

## Update requirements

Every implementation pull request must update `implementation-status.md`. Update the relevant specification, roadmap, D1 migration plan, resource envelope, UI document, or decision record when a change affects behavior, scope, sequencing, routes, visual rules, resource use, or a previously accepted decision.

A UI pull request is incomplete unless its page specification, responsive behavior, data states, accessibility coverage, and API dependencies agree with the implementation.
