# XRPL Lending Monitor documentation

This directory defines the active product and DB-less implementation plan.

## Required read order

1. [Product specification](product-spec.md)
2. [DB-less runtime contract](db-less-runtime-contract.md)
3. [Architecture](architecture.md)
4. [Data model](data-model.md)
5. [Status model](status-model.md)
6. [Asset model](asset-model.md)
7. [Collector design](collector-design.md)
8. [Resource envelope](resource-envelope.md)
9. [Testing strategy](testing-strategy.md)
10. [Development roadmap](development-roadmap.md)
11. [Implementation status](implementation-status.md)

For user-visible work, also read the affected `ui-*.md` documents.

## Authority rules

- `product-spec.md` defines what the product is.
- `db-less-runtime-contract.md` defines the non-negotiable runtime and publication boundary.
- `architecture.md` defines system composition.
- `data-model.md`, `status-model.md`, and `asset-model.md` define data semantics.
- `collector-design.md` defines collection and publication behavior.
- `resource-envelope.md` defines measurable safety gates.
- `testing-strategy.md` defines required evidence.
- `development-roadmap.md` defines implementation order.
- `implementation-status.md` records what is actually implemented versus only planned.
- Root `AGENTS.md` defines contribution rules.

When documents conflict, stop and reconcile the conflict before dependent implementation.

## Active architecture in one diagram

```text
XRPL Devnet validated ledgers
          |
          v
GitHub Actions bounded collector
          |
          +----> Current base / current live artifacts
          |
          +----> History event / lifecycle artifacts
          |
          v
verified publication manifests
          |
          v
GitHub Release assets
          |
          v
static React application
```

There is no canonical runtime database.

## Legacy policy

The Cloudflare D1 / Queue / Worker-scheduled collector and Supabase recovery architecture is retired.

Historical versions remain available through Git history for forensic work, but they are not part of the active documentation set and must not be consulted as implementation guidance unless a task explicitly requests historical analysis.

The repository may temporarily contain legacy code while the migration roadmap removes it. Legacy code does not override this documentation.

## Retained UI/domain documentation

The following remain useful because they are not inherently tied to the retired persistence architecture:

- `status-model.md`
- `asset-model.md`
- `ui-information-architecture.md`
- `ui-page-map.md`
- `ui-page-specifications.md`
- `ui-design-spec.md`
- `ui-component-inventory.md`
- `ui-responsive-rules.md`
- Explorer visual/copy documents only where they do not contradict the active runtime contract

Future cleanup may consolidate these documents after the DB-less cutover is stable.
