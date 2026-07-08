# Explorer v1 bounded relationship contract

Last updated: 2026-07-08.

## Purpose

This document defines the pre-entry interaction and data-safety contract for the Explorer v1 relationship view.

The relationship view is the distinguishing part of the approved Guided Dashboard + Relationship Explorer direction. It shows bounded observed Vault -> Loan Broker -> Loan relationships without turning Explorer v1 into an unbounded graph product, an N+1 detail loader, or a historical analytics system.

This document does not start E1-3 implementation. Exact endpoint and query-shape selection remains an E1-1 measured contract decision.

## User question

The relationship view should answer:

> How are some of the currently observed Vaults, Loan Brokers, and Loans connected?

It does not claim:

- complete protocol-wide relationship coverage unless the approved bounded contract explicitly proves completeness;
- historical relationship reconstruction;
- ownership or control beyond protocol fields;
- borrower identity;
- risk, safety, collateral quality, or investment conclusion.

## Approved v1 shape

Explorer v1 uses a bounded progressive structure.

Preferred visual model:

```text
Selected or sampled Vault
  |- Loan Broker A
  |    |- Loan 1
  |    |- Loan 2
  |
  |- Loan Broker B
       |- Loan 3
```

Equivalent visual forms may use:

- grouped columns;
- a compact tree;
- bounded node-link connectors;
- cards with directional relationship lines;
- a semantic list presented beside or beneath the visual form.

The view must not use an unlimited force-directed graph on page load.

## Conceptual flow versus observed relationships

The page contains two different ideas and must not visually merge them.

### Conceptual flow

```text
Vault -> Loan Broker -> Loan -> payment/management activity
```

This is educational copy describing the protocol model.

### Observed relationship view

This shows only relationships returned by approved bounded current data contracts in the active network, epoch, and base-plus-overlay context.

Visual rules:

- conceptual flow uses explanatory labels and does not imply actual object completeness;
- observed relationship edges use real object IDs and supported relationship evidence;
- partial or unavailable observed data is labelled explicitly;
- graph connectors never imply causation beyond the documented relationship.

## Anchor selection models

E1-1 must choose one measured initial-load model.

### Model A — bounded sample anchor

1. request a bounded current seed set;
2. select one deterministic representative Vault anchor from that bounded response;
3. show a capped set of related Loan Brokers;
4. show a capped set of related Loans for the displayed Brokers;
5. mark the view as a bounded sample unless the contract proves the displayed relationship set is complete for the anchor.

Advantages:

- beginner sees a working relationship view immediately;
- deterministic screenshot and browser evidence is easier.

Risks:

- initial query may need careful composition to avoid fan-out;
- deterministic sample selection must not favor a misleading state.

### Model B — user-selected anchor

1. page loads bounded current summaries and a bounded Vault seed list;
2. user selects a Vault;
3. fetch bounded related Loan Brokers;
4. fetch bounded Loans only for the selected or expanded Broker context;
5. exact detail remains lazy.

Advantages:

- lower initial relationship work;
- clear user control over expansion.

Risks:

- empty first impression unless the seed selection is well designed;
- more interaction steps for newcomers.

### Decision rule

E1-1 selects A, B, or a measured hybrid only after request-count, D1-read, base-read, response-size, and interaction evidence is available.

The pre-entry preference is a lightweight deterministic bounded sample plus user-driven lazy expansion, but this is not a final endpoint decision.

## Bounds

Every relationship request must have explicit limits.

The implementation must define and test:

- maximum Vault anchors shown initially;
- maximum Loan Brokers shown per visible Vault context;
- maximum Loans shown per visible Broker context;
- maximum expansion depth;
- pagination or `show more` behavior;
- whether caps are server-enforced, client-enforced, or both;
- partial/at-least wording when additional relationships exist or completeness is unknown.

Numeric limits are not invented in this pre-entry document. E1-1 must use approved API limits and M6 resource evidence to select them.

## Fetch contract

### Initial load

Allowed:

- one bounded relationship seed path;
- already-required status/overview context;
- bounded Activity request shared with other page sections.

Prohibited:

```text
bounded list
  -> detail for every Vault
  -> detail for every Broker
  -> history for every Loan
```

### Selection

When a user selects a displayed object, Explorer may:

- show already-fetched summary fields;
- issue one exact detail request when additional fields are needed;
- replace the selected summary panel;
- route directly to the canonical technical detail page.

### Expansion

Bounded expansion may request the next approved relationship page or one approved related-object query.

Every expansion path must:

- retain the active network and epoch context;
- retain base/current freshness semantics;
- preserve current versus archived distinction;
- expose Loading, Empty, Unavailable, Stale, Partial, and Error states;
- record request deltas in the Explorer production evidence harness.

## Same-context rules

Observed relationship edges are valid only when the implementation preserves:

- same network;
- same epoch;
- current-state base identity and overlay compatibility;
- canonical object type and ID;
- documented relationship source.

A relationship mismatch or unresolved related object must not silently link to an object from another epoch or base context.

Allowed presentation:

```text
Related Loan Broker unavailable in the current context
```

Prohibited presentation:

- linking to a same-looking identifier from another epoch;
- inventing a relationship from name or asset similarity;
- using archive evidence as current relationship truth without explicit archived context.

## Selected object behavior

### Selected Vault

May show:

- Vault ID;
- canonical asset;
- supported current amounts;
- number of displayed related Brokers in the bounded view;
- technical detail link.

Do not show a total relationship count unless the approved contract proves the count is complete.

### Selected Loan Broker

May show:

- Broker ID;
- related Vault;
- supported debt and cover values;
- number of displayed Loans in the bounded view;
- technical detail link.

Do not turn cover values into safety grades.

### Selected Loan

May show the approved human-readable Loan summary from the Explorer translation dictionary and a technical detail link.

## Empty and partial states

Examples:

### Empty

```text
No related Loans were returned in this bounded current view.
```

### Partial

```text
Showing a bounded sample of observed relationships.
```

or, when pagination evidence supports it:

```text
Showing the first page of observed relationships. More are available.
```

### Unavailable

```text
Relationship data is currently unavailable for this context.
```

### Stale

```text
Relationship data is shown from the latest available monitored state, which is currently stale.
```

Do not replace any of these with `0 related objects` unless zero is an exact supported fact.

## Accessibility contract

A visual relationship diagram must have an equivalent semantic structure.

Minimum requirements:

- keyboard-reachable selectable objects;
- visible focus;
- selected object indicated by text/state, not color alone;
- no hover-only disclosure;
- meaningful DOM reading order independent of connector lines;
- text/list alternative with the same object identities and parent/child relationships;
- full accessible identifiers even when visually shortened;
- copy access for identifiers;
- reduced-motion compliance;
- usable reflow at 200% zoom;
- connectors hidden or simplified when they obstruct mobile/reflow reading order.

## Mobile and narrow layout

The v1 mobile relationship view should prefer ordered grouped cards or a semantic tree/list over a squeezed desktop node graph.

Recommended narrow order:

```text
Vault summary
  -> related Broker cards
       -> selected Broker Loan cards
```

The same data contract may power desktop and mobile, but layout may differ substantially.

## Technical transitions

Every displayed object must provide one of:

- direct canonical technical link;
- selected summary panel with a technical link;
- expandable technical-data disclosure plus canonical route.

Explorer does not create duplicate entity-detail routes.

## Resource evidence requirements

Before E1-3 exits, retain:

- initial relationship seed logical request count;
- HTTP attempt count;
- browser API request count;
- D1 rows read where attributable;
- immutable base pages or exact lookups where measurable;
- response bytes;
- one representative Vault/Broker/Loan selection delta;
- one representative bounded expansion delta;
- duplicate fetch findings;
- error/retry behavior;
- desktop and mobile relationship evidence.

## Completion condition

The relationship contract is satisfied when:

- the initial view is bounded;
- expansion is bounded;
- no page-load N+1 detail fan-out occurs;
- observed edges are same-context and evidence-backed;
- conceptual and observed relationships are visually distinct;
- partial and unavailable states are explicit;
- exact technical detail remains reachable;
- the visual form has an equivalent semantic alternative;
- resource cost is measured with the M6 Explorer harness;
- no new collector, scheduled job, or request-time historical aggregation is introduced.
