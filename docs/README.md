# Documentation index

This directory is the source of truth for XRPL Lending Monitor and its approved XRPL Lending Observatory expansion path.

## Read order

1. [`product-spec.md`](product-spec.md) — product purpose, users, scope, pages, project pages, and release gates
2. [`architecture.md`](architecture.md) — verified base read model, D1 incremental overlay, runtime, deployment, and UI architecture
3. [`data-model.md`](data-model.md) — persistent entities, fields, relationships, and provenance
4. [`status-model.md`](status-model.md) — on-ledger and schedule-derived states
5. [`asset-model.md`](asset-model.md) — XRP, IOU, and MPT handling
6. [`collector-design.md`](collector-design.md) — complete base bootstrap, incremental collection, overlay resolution, idempotency, and reset handling
7. [`testing-strategy.md`](testing-strategy.md) — required validation and release tests
8. [`resource-envelope.md`](resource-envelope.md) — runtime, storage, collection, base-read, overlay, catch-up, and public-query limits
9. [`m6-integrity-reset-plan.md`](m6-integrity-reset-plan.md) — first post-M5-5 M6 integrity, replay, reset, epoch-transition, catch-up, and reconciliation baseline
10. [`m6-resource-guardrail-plan.md`](m6-resource-guardrail-plan.md) — early M6 runtime/resource measurement baseline and Explorer v1 guardrail harness contract
11. [`d1-migration-plan.md`](d1-migration-plan.md) — superseded D1-only full-snapshot evaluation retained as architecture and resource history
12. [`d1-command-interface.md`](d1-command-interface.md) — local non-public D1 evaluation actions, limits, evidence, and operation order
13. [`storage-artifact-format.md`](storage-artifact-format.md) — deterministic compressed complete-base artifact format
14. [`local-artifact-measurement.md`](local-artifact-measurement.md) — resumable local capacity measurement and evidence output
15. [`competitor-positioning.md`](competitor-positioning.md) — baseline parity and differentiators
16. [`explorer-spec.md`](explorer-spec.md) — Explorer v1 and v2 scope, data boundaries, page behavior, and completion gates
17. [`explorer-v1-visual-direction.md`](explorer-v1-visual-direction.md) — approved Guided Dashboard + Relationship Explorer visual composition and Hero restrictions
18. [`explorer-v1-contract-matrix.md`](explorer-v1-contract-matrix.md) — pre-entry section-to-data/state/load/resource mapping
19. [`explorer-v1-translation-dictionary.md`](explorer-v1-translation-dictionary.md) — pre-entry concept, field, and Activity plain-language translation rules
20. [`explorer-v1-relationship-contract.md`](explorer-v1-relationship-contract.md) — bounded relationship view, lazy loading, same-context, accessibility, and measurement contract
21. [`explorer-v1-static-api-shape-audit.md`](explorer-v1-static-api-shape-audit.md) — static audit of current list/detail response shapes and provisional low-fan-out relationship seed candidates
22. [`ui-information-architecture.md`](ui-information-architecture.md) — Monitor, Audit, System, Project, and approved Explore navigation relationships
23. [`ui-page-map.md`](ui-page-map.md) — canonical routes and route ownership
24. [`ui-page-specifications.md`](ui-page-specifications.md) — page responsibilities, API dependencies, unavailable behavior, and milestone assignment
25. [`ui-design-spec.md`](ui-design-spec.md) — visual system, state treatment, tables, charts, provenance, and accessibility
26. [`ui-component-inventory.md`](ui-component-inventory.md) — reusable UI component contracts and required states
27. [`ui-responsive-rules.md`](ui-responsive-rules.md) — desktop, tablet, mobile, zoom, and long-content behavior
28. [`ui-reference/README.md`](ui-reference/README.md) — approved mockup interpretation and prohibited invented data
29. [`development-roadmap.md`](development-roadmap.md) — active M0-M6 implementation order, dependencies, target dates, and exit conditions
30. [`observatory-roadmap.md`](observatory-roadmap.md) — approved Explorer v1 insertion and post-release Observatory O1-O3 expansion order
31. [`implementation-status.md`](implementation-status.md) — public implementation state, active unit, and current release blockers
32. [`operations-public-discovery.md`](operations-public-discovery.md) — final-host canonical, robots, sitemap, analytics, and Search Console operation
33. [`operations-unimpairment-witness.md`](operations-unimpairment-witness.md) — bounded external Devnet semantic-witness operation for the remaining M1 unimpairment path
34. [`decision-log.md`](decision-log.md) — accepted and superseded architectural and product decisions

## Authority rules

- `product-spec.md` defines the current Monitor product boundary.
- `explorer-spec.md` defines approved Explorer v1 and Explorer v2 scope, behavior, data boundaries, and sequencing requirements.
- `explorer-v1-visual-direction.md` defines the approved Guided Dashboard + Relationship Explorer composition, same-product visual treatment, and Hero restrictions.
- `explorer-v1-contract-matrix.md` defines pre-entry section mapping to candidate data sources, states, initial/lazy loading, provenance, technical transitions, and measurement hooks.
- `explorer-v1-translation-dictionary.md` defines pre-entry plain-language concept, field, status, and Activity wording rules; implementation must revalidate the dictionary against final API and normalized event semantics.
- `explorer-v1-relationship-contract.md` defines bounded observed relationship behavior, progressive loading, same-context rules, accessible alternatives, and measurement requirements.
- `explorer-v1-static-api-shape-audit.md` records current static response/route capabilities and provisional composition candidates; it does not replace M6 resource measurement or E1-1 contract decisions.
- `architecture.md` defines the active system and runtime architecture.
- Domain documents define how their data and behavior work.
- `collector-design.md` defines complete base bootstrap, incremental continuation, current overlay behavior, and reset handling.
- `resource-envelope.md` defines measurable runtime, storage, public-query, and evidence gates.
- `m6-integrity-reset-plan.md` defines the first executable M6 integrity/reset baseline after M5-5 exit; it does not authorize early M6 implementation.
- `m6-resource-guardrail-plan.md` defines the early M6 measurement order, evidence contract, budget-approval process, and Explorer v1 resource-harness gate.
- `d1-migration-plan.md` records the superseded D1-only full-snapshot evaluation and retained lessons; it does not control active M1 order.
- `d1-command-interface.md` defines the local D1 evaluation action boundary and public-safe evidence contract.
- `storage-artifact-format.md` defines the compressed artifact format used by complete base generation.
- `local-artifact-measurement.md` defines local measurement commands, resume behavior, and evidence fields.
- UI information-architecture, page, design, component, responsive, and reference documents define presentation and interaction behavior.
- `development-roadmap.md` defines the active M0-M6 implementation order, dependencies, and target dates.
- `observatory-roadmap.md` defines the approved product-evolution order from Explorer v1 through XRPL Lending Observatory O1-O3 and may not be used to bypass active M5-5 or M6 gates.
- `implementation-status.md` records the current public implementation state.
- `operations-public-discovery.md` defines final-host, canonical, sitemap, analytics, and Search Console launch operation.
- `operations-unimpairment-witness.md` defines the custody boundary, protocol preconditions, abort conditions, and evidence order for any separately controlled external Devnet unimpairment witness.
- `development-roadmap.md`, `observatory-roadmap.md`, `explorer-spec.md`, and `implementation-status.md` must be re-read at the start of each Explorer or Observatory implementation unit and reconciled with newly captured evidence before dependent work proceeds.
- Before Explorer E1-1, also re-read the five Explorer v1 pre-entry design/audit documents and reconcile unresolved endpoint, translation, relationship-bound, static API-shape, and visual decisions with the M6 resource harness evidence.
- `development-roadmap.md`, `implementation-status.md`, `m6-integrity-reset-plan.md`, and `m6-resource-guardrail-plan.md` must be re-read before the first M6 integrity/reset or runtime/resource implementation unit.
- `development-roadmap.md` and `implementation-status.md` must also be re-read at the start of each implementation, operational, UI-audit, SEO, or release-preparation unit.
- `decision-log.md` records why material architecture and product choices were accepted or superseded.
- Root `AGENTS.md` defines repository contribution rules.

When documents conflict, correct the conflict before merging affected implementation.

## Active current-state architecture

The active current-state path is:

```text
verified immutable base read model
+
bounded D1 incremental history and current-state overlay
=
public current-state API
```

Current read precedence is:

1. D1 overlay upsert overrides base;
2. D1 deletion tombstone hides base from current routes;
3. otherwise the verified base object is returned.

The earlier D1-only complete row-per-object snapshot plan is historical and superseded.

## Approved product evolution

The approved sequence is:

```text
XRPL Lending Monitor
  -> Explorer v1
  -> XRPL Lending Observatory data foundation
  -> Observatory monitoring view
  -> Explorer v2
```

Explorer v1 is a bounded presentation layer over approved current contracts. It does not add a separate collector or historical analytics system. Explorer v2 is gated behind stable Observatory data contracts and the Observatory monitoring view.

## UI source-of-truth boundary

Generated UI mockups are visual references only. They are not fixtures or API contracts. Do not copy example counts, USD conversions, cross-asset totals, oracle claims, hashes, addresses, states, charts, or operational metrics unless the approved API and specifications support them.

The approved Explorer v1 mockup direction is captured textually in `explorer-v1-visual-direction.md`; implementation follows the documented composition and restrictions, not the mockup's example values.

The UI must show explicit unavailable, stale, empty, partial, and error states rather than substituting zero or mock data.

## Update requirements

Every implementation pull request must update `implementation-status.md`. Update the relevant specification, roadmap status, resource envelope, UI document, or decision record when a change affects behavior, scope, sequencing, routes, visual rules, resource use, or a previously accepted decision.

Explorer and Observatory work must also update `explorer-spec.md` or `observatory-roadmap.md` when behavior, scope, sequencing, metric dependencies, or resource assumptions change.

A UI pull request is incomplete unless its page specification, responsive behavior, data states, accessibility coverage, and API dependencies agree with the implementation.
