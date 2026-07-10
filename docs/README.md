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
10. [`m6-i1-fixture-catalog.md`](m6-i1-fixture-catalog.md) — deterministic M6-I1 F00-F14 scenario catalog, evidence snapshot shape, and later M6 reuse map
11. [`m6-resource-guardrail-plan.md`](m6-resource-guardrail-plan.md) — early M6 runtime/resource measurement baseline and Explorer v1 guardrail harness contract
12. [`d1-migration-plan.md`](d1-migration-plan.md) — superseded D1-only full-snapshot evaluation retained as architecture and resource history
13. [`d1-command-interface.md`](d1-command-interface.md) — local non-public D1 evaluation actions, limits, evidence, and operation order
14. [`storage-artifact-format.md`](storage-artifact-format.md) — deterministic compressed complete-base artifact format
15. [`local-artifact-measurement.md`](local-artifact-measurement.md) — resumable local capacity measurement and evidence output
16. [`competitor-positioning.md`](competitor-positioning.md) — baseline parity and differentiators
17. [`explorer-spec.md`](explorer-spec.md) — Explorer v1 and v2 scope, data boundaries, page behavior, and completion gates
18. [`explorer-v1-visual-direction.md`](explorer-v1-visual-direction.md) — approved Guided Dashboard + Relationship Explorer visual composition and Hero restrictions
19. [`explorer-v1-contract-matrix.md`](explorer-v1-contract-matrix.md) — pre-entry section-to-data/state/load/resource mapping
20. [`explorer-v1-translation-dictionary.md`](explorer-v1-translation-dictionary.md) — pre-entry concept, field, and Activity plain-language translation rules
21. [`explorer-v1-content-copy.md`](explorer-v1-content-copy.md) — baseline English Hero, section, state, Loan-summary, Activity, glossary, and technical-transition copy
22. [`explorer-v1-relationship-contract.md`](explorer-v1-relationship-contract.md) — bounded relationship view, lazy loading, same-context, accessibility, and measurement contract
23. [`explorer-v1-static-api-shape-audit.md`](explorer-v1-static-api-shape-audit.md) — static audit of current list/detail response shapes and provisional low-fan-out relationship seed candidates
24. [`ui-information-architecture.md`](ui-information-architecture.md) — Monitor, Audit, System, Project, and approved Explore navigation relationships
25. [`ui-page-map.md`](ui-page-map.md) — canonical routes and route ownership
26. [`ui-page-specifications.md`](ui-page-specifications.md) — page responsibilities, API dependencies, unavailable behavior, and milestone assignment
27. [`ui-design-spec.md`](ui-design-spec.md) — visual system, state treatment, tables, charts, provenance, and accessibility
28. [`ui-component-inventory.md`](ui-component-inventory.md) — reusable UI component contracts and required states
29. [`ui-responsive-rules.md`](ui-responsive-rules.md) — desktop, tablet, mobile, zoom, and long-content behavior
30. [`ui-reference/README.md`](ui-reference/README.md) — approved mockup interpretation and prohibited invented data
31. [`development-roadmap.md`](development-roadmap.md) — active M0-M6 implementation order, dependencies, target dates, and exit conditions
32. [`observatory-roadmap.md`](observatory-roadmap.md) — approved Explorer v1 insertion and post-release Observatory O1-O3 expansion order
33. [`implementation-status.md`](implementation-status.md) — public implementation state, active unit, and current release blockers
34. [`ops/free-tier-collector-recovery-2026-07-09.md`](ops/free-tier-collector-recovery-2026-07-09.md) — retained Cloudflare Worker Free collector CPU blocker evidence and recovery boundary
35. [`ops/free-tier-collector-throughput-design-2026-07-10.md`](ops/free-tier-collector-throughput-design-2026-07-10.md) — HTTP subrequest failure evidence, 32-ledger production baseline, and staged WebSocket transport validation plan
36. [`operations-public-discovery.md`](operations-public-discovery.md) — final-host canonical, robots, sitemap, analytics, and Search Console operation
37. [`operations-unimpairment-witness.md`](operations-unimpairment-witness.md) — bounded external Devnet semantic-witness operation for the remaining M1 unimpairment path
38. [`decision-log.md`](decision-log.md) — accepted and superseded architectural and product decisions

## Authority rules

- `product-spec.md` defines the current Monitor product boundary.
- `explorer-spec.md` defines approved Explorer v1 and Explorer v2 scope, behavior, data boundaries, and sequencing requirements.
- `architecture.md` defines the active system and runtime architecture.
- Domain documents define how their data and behavior work.
- `collector-design.md` defines complete base bootstrap, incremental continuation, current overlay behavior, and reset handling.
- `resource-envelope.md` defines measurable runtime, storage, public-query, and evidence gates.
- `m6-integrity-reset-plan.md` defines the first executable M6 integrity/reset baseline after M5-5 exit; it does not authorize early M6 implementation.
- `m6-i1-fixture-catalog.md` prepares deterministic M6-I1 scenario IDs, shared context/object/asset families, evidence snapshot requirements, and M6-I2-I5 reuse; the catalog is not passing implementation evidence.
- `m6-resource-guardrail-plan.md` defines the early M6 measurement order, evidence contract, budget-approval process, and Explorer v1 resource-harness gate.
- `development-roadmap.md` defines the active M0-M6 implementation order, dependencies, and target dates.
- `observatory-roadmap.md` defines the approved product-evolution order from Explorer v1 through XRPL Lending Observatory O1-O3 and may not be used to bypass active M5-5 or M6 gates.
- `implementation-status.md` records the current public implementation state.
- `ops/free-tier-collector-recovery-2026-07-09.md` records the production Cloudflare Worker CPU blocker and the free-tier recovery boundary; it does not by itself prove recovery.
- `ops/free-tier-collector-throughput-design-2026-07-10.md` records the 64-ledger HTTP subrequest failure, the restored 32-ledger HTTP production baseline, and the T1-T5 transport-validation order; it does not authorize production transport or batch-size changes without measured evidence.
- `operations-public-discovery.md` defines final-host, canonical, sitemap, analytics, and Search Console launch operation.
- `operations-unimpairment-witness.md` defines the custody boundary, protocol preconditions, abort conditions, and evidence order for any separately controlled external Devnet unimpairment witness.
- `development-roadmap.md`, `observatory-roadmap.md`, `explorer-spec.md`, and `implementation-status.md` must be re-read at the start of each Explorer or Observatory implementation unit and reconciled with newly captured evidence before dependent work proceeds.
- Before Explorer E1-1, also re-read the Explorer v1 pre-entry design, copy, and static-audit documents and reconcile unresolved endpoint, translation, relationship-bound, copy, static API-shape, and visual decisions with the M6 resource harness evidence.
- `development-roadmap.md`, `implementation-status.md`, `m6-integrity-reset-plan.md`, and `m6-resource-guardrail-plan.md` must be re-read before the first M6 integrity/reset or runtime/resource implementation unit.
- Before M6-I1 implementation, also re-read `m6-i1-fixture-catalog.md` and issue #283, then inventory existing helpers before writing new fixture abstractions.
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
