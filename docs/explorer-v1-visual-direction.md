# Explorer v1 visual direction

Last updated: 2026-07-08.

## Status

Approved as the visual direction for Explorer v1 pre-entry design preparation.

This document records the accepted design direction. It does not start E1 implementation and does not override the Explorer start gate.

## Approved concept

Explorer v1 uses a **Guided Dashboard + Relationship Explorer hybrid**.

The design combines:

- the approachability and reading order of a guided dashboard;
- the project-specific value of a bounded Vault -> Loan Broker -> Loan relationship explorer.

The visual objective is:

> explain first, show bounded current facts second, then let the user inspect real observed relationships and one understandable Loan without losing access to technical evidence.

## Product identity

Explorer is part of XRPL Lending Monitor.

It uses the same product identity as the current application:

- dark navy to near-black application surfaces;
- restrained cyan emphasis;
- thin borders;
- minimal depth;
- readable sans-serif text;
- monospace identifiers and exact values;
- calm technical tone;
- visible network, freshness, state, and provenance context;
- no trading-terminal, wallet, token-promotion, or generic neon-crypto aesthetic.

Explorer lowers cognitive load through spacing, explanation, grouping, progressive disclosure, and bounded visual relationships. It does not create a separate consumer-finance brand.

## Approved desktop composition

Preferred section order:

```text
1. Header / navigation
2. Hero and scope
3. Three concepts
4. Current snapshot
5. Conceptual protocol flow
6. Bounded Relationship Explorer
7. Selected Loan
8. Recent Activity translation
9. How to read this page / glossary
10. Technical view transition
```

### Header / navigation

Use the existing product navigation language and interaction style.

Explore becomes visibly active only after the approved E1 navigation integration. Technical Monitor and Audit destinations remain first-class.

### Hero

Hero requirements:

- title such as `Explore XRPL Lending` or an approved equivalent;
- one short explanation of the page purpose;
- clear Devnet/read-only context;
- freshness or stale context when dynamic evidence is available;
- restrained application-style background treatment.

Hero prohibited decoration:

- lighthouse imagery;
- observatory building imagery;
- scenic landscape illustration;
- hills, mountains, night-sky scenes, or decorative architecture;
- large unrelated product illustration;
- promotional visual metaphor that makes Explorer look like a separate campaign page.

Allowed treatment:

- dark application surface;
- subtle gradient;
- low-contrast abstract texture;
- restrained grid or technical pattern where it does not reduce readability;
- compact status or scope callout.

The Hero should look like the current XRPL Lending Monitor product, not a decorative landing page.

### Three concepts

Show Vault, Loan Broker, and Loan in three concise explanatory cards.

The cards:

- teach vocabulary before data relationships;
- use one or two short plain-language lines;
- link to technical pages or Methodology where appropriate;
- do not contain invented metrics or investment claims.

### Current snapshot

Use a restrained summary grid with supported current facts only.

Candidate cards:

- Vaults observed;
- Loan Brokers observed;
- Loans observed;
- latest validated ledger;
- collector freshness;
- bounded recent protocol activity summary where supported.

Do not visually imitate market dashboards with:

- USD TVL;
- APR/APY;
- 24-hour price-style changes;
- unsupported sparklines;
- health gauges;
- liquidation risk meters;
- cross-asset totals.

### Conceptual protocol flow

Show a simple educational relationship:

```text
Vault
  -> Loan Broker
  -> Loan
  -> payment and management activity
```

This section is explanatory and must look different from the real observed relationship section.

### Bounded Relationship Explorer

This is the primary project-specific visual feature of Explorer v1.

Use one of:

- grouped columns;
- compact tree;
- bounded node-link card layout;
- relationship lanes.

The view should make one bounded relationship sample immediately understandable.

Visual objectives:

- clear parent/child relationship hierarchy;
- visible selected object;
- restrained connector lines;
- no uncontrolled node cloud;
- no force-directed graph chaos;
- semantic list alternative;
- technical links for every displayed object.

The exact data and expansion contract is defined in `explorer-v1-relationship-contract.md`.

### Selected Loan

Use a readable summary panel rather than raw field-first presentation.

Preferred emphasis:

- Loan ID;
- on-ledger state;
- schedule state;
- outstanding principal;
- payments remaining;
- regular payment amount;
- next payment due;
- grace period;
- related Loan Broker;
- related Vault.

Technical field names and exact evidence remain reachable.

### Recent Activity

Use a readable feed rather than a dense transaction table.

Each item pairs:

- plain-language summary;
- canonical transaction type;
- result;
- ledger/time context;
- hash or technical transition.

Non-success activity remains visible and uses attempt wording.

### Glossary / How to read this page

Use compact cards, disclosure panels, or a concise terminology block.

Do not turn the lower page into a long tutorial article. Methodology remains the full technical reference.

### Technical view transition

End with a clear transition to exact Monitor/Audit surfaces.

This should feel like:

> Ready for the technical details? Open the Monitor view.

It should not imply that Explorer is less trustworthy or that Monitor is obsolete.

## Density model

Explorer v1 should be visibly calmer than the technical Monitor while still feeling like the same application.

Use:

- more vertical spacing between major sections;
- fewer simultaneous columns in explanatory areas;
- plain-language headings;
- progressive disclosure;
- bounded relationship focus;
- selected-detail emphasis.

Do not use:

- oversized marketing typography;
- large empty decorative hero space;
- excessive glow;
- glassmorphism-heavy panels;
- animation required for understanding;
- decorative charts without stable data series.

## Responsive direction

Desktop may use visual relationship lanes or grouped columns.

Tablet should reduce simultaneous horizontal lanes.

Mobile should prefer ordered semantic structure:

```text
Vault summary
  -> Broker cards
       -> selected Broker Loan cards
```

Do not squeeze the desktop relationship graph into a narrow viewport.

## Mockup boundary

The approved mockup establishes:

- section hierarchy;
- Guided Dashboard + Relationship Explorer composition;
- lower initial cognitive load;
- strong relationship section;
- readable Loan summary;
- Activity translation pattern;
- technical transition pattern;
- restrained visual direction consistent with the current site.

The mockup does not authorize:

- example numeric values;
- fiat values;
- TVL;
- APR;
- 24-hour change;
- unsupported charts;
- invented asset names or Broker names;
- unsupported activity counts;
- health, collateral, LTV, liquidation-risk, or credit-risk visuals.

Implementation values come only from approved contracts and measured bounded data access.

## Relationship to other documents

- `explorer-spec.md` controls Explorer product behavior and boundaries.
- `explorer-v1-contract-matrix.md` maps sections to data/state/resource contracts.
- `explorer-v1-translation-dictionary.md` controls pre-entry plain-language wording.
- `explorer-v1-relationship-contract.md` controls bounded relationship behavior.
- `ui-design-spec.md` controls shared product-wide visual and accessibility rules.
- `observatory-roadmap.md` controls start gates and implementation sequence.

## Acceptance condition

The visual direction remains accepted when implementation:

- follows the Guided Dashboard + Relationship Explorer composition;
- remains visually consistent with the current Monitor;
- uses no scenic/lighthouse Hero illustration;
- shows only approved data;
- keeps relationship visualization bounded and accessible;
- preserves technical evidence access;
- passes the M6 Explorer resource harness and later E1 production evidence gates.
