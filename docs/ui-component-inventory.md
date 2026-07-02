# UI component inventory

## Purpose

This document defines reusable UI components, responsibilities, required states, and milestone ownership. Components are contracts, not permission to add a design-system dependency.

## Application structure

### `AppShell`

Responsibilities:

- desktop sidebar;
- mobile app bar and navigation;
- persistent network context;
- main content landmark;
- route title, breadcrumbs, and page actions;
- footer;
- skip link and focus management.

Required states: desktop, tablet, mobile, network available, network stale, and network unavailable.

### `Sidebar`

Responsibilities:

- Monitor, Audit, System, and Project groups;
- current-route state;
- repository and issue links;
- accessible collapsed behavior when used.

Unimplemented routes are hidden or clearly marked planned. Active state is not conveyed by color alone.

### `MobileNavigation`

Responsibilities:

- bottom navigation for Overview, Loans, Activity, Search, and More;
- More menu for remaining routes;
- current route and group indication;
- safe-area handling;
- keyboard and screen-reader support.

### `NetworkContextBar`

Responsibilities:

- DEVNET badge;
- epoch;
- validated ledger;
- data age;
- collector status;
- stale or reset warning;
- Network Status link.

It never implies Mainnet or current data when context is unavailable.

## Navigation and utility components

### `Breadcrumbs`

- route-backed links;
- concise visual identifiers with complete accessible values;
- current page marked with `aria-current`;
- mobile overflow handling.

### `PageHeader`

- title;
- description;
- status badges;
- read-oriented actions such as export or API links;
- no wallet or write controls.

### `SectionNavigation`

Used for documentation contents and entity subviews. Supports stable anchors and active-section indication.

### `ExternalLink`

- accessible external-link label;
- safe target and `rel` behavior;
- no placeholder destination.

### `CopyValue`

For accounts, object IDs, transaction hashes, issuance IDs, and other exact identifiers.

Required behavior:

- visual truncation without changing copied content;
- explicit copy label;
- accessible success message;
- no hidden placeholder value.

## Data display components

### `MetricCard`

- label, value, unit, context, and provenance;
- loading, unavailable, stale, and error states;
- missing values are never rendered as zero.

### `StatusBadge`

Semantic variants:

- neutral;
- positive;
- warning;
- negative;
- archived;
- unavailable.

On-ledger and schedule states are separate labelled instances.

### `ProvenanceBadge`

Canonical variants:

- Direct;
- Derived;
- Indexed;
- Unavailable.

Derived values link to formulas where practical.

### `DefinitionList`

For key/value facts in operational, entity, archive, and project pages. Supports long values and grouped provenance.

### `DataTable`

Responsibilities:

- semantic table structure;
- bounded sorting and pagination;
- row links and optional row selection;
- long-value handling;
- loading, empty, unavailable, stale, partial, and error states;
- declared mobile transformation strategy.

A generic table never adds unsupported fiat columns, cross-asset totals, or filters.

### `FilterBar`

- search;
- documented filters;
- reset;
- applied-filter summary;
- URL synchronization where practical;
- accessible labels and keyboard flow.

### `Pagination`

- API-aligned limits and cursors;
- Previous and Next controls;
- result context;
- no invented page count.

### `IdentifierLink`

- type-aware links to Vault, Loan Broker, Loan, account, transaction, issuance, or archive;
- truncated visual display with complete accessible value;
- copy action where useful.

### `AssetIdentity`

- XRP, IOU currency plus issuer, or MPT issuance identity;
- exact unit beside amounts;
- no unsupported symbol substitution or fiat price.

## State components

### `LoadingState`

Appropriate skeleton or message. Previous values are not shown as current without stale labelling.

### `EmptyState`

Successful request with no matching records. Explains active scope or filters and may offer reset.

### `UnavailableState`

Shows an explicit reason and distinguishes unsupported, uncollected, and pre-activation conditions.

### `StaleWarning`

Shows age, threshold, and last success while preserving safe last-known values.

### `ErrorState`

Shows a public-safe message and bounded retry control. It exposes no internal diagnostic detail.

### `ArchiveBanner`

Explains that an object is absent from current state and preserved in history. It does not infer cause.

### `DevnetNotice`

Explains reset possibility, links to epoch history, and never implies Mainnet data.

## Monitoring components

### `OverviewMetrics`

Uses only API-supported counts and availability.

### `CollectorHealthPanel`

Shows collector status, validated and processed ledgers, lag, attempts, success time, failure count, and safe error summary when supported.

### `AmendmentStatusPanel`

Shows enabled and supported states independently.

### `ActivityPreview`

Shows bounded recent records and explicit empty or unavailable states.

### `RecentChangesPanel`

May exist only when normalized changes are available through an approved API.

## Entity components

### `EntitySummaryHeader`

- type and identifier;
- current or archived state;
- network, epoch, ledger, and update time;
- primary relationships;
- copy controls.

### `RelatedEntitiesPanel`

- relationship type;
- identifier;
- current or archived context;
- explicit missing relationship.

### `HistorySeries`

- exact asset and unit;
- time or ledger axis;
- provenance;
- accessible table or summary;
- no unsupported interpolation.

### `LifecycleTimeline`

- canonical event order;
- ledger, transaction, time, type, and provenance;
- explicit gaps;
- no inferred event.

### `StateChangeDiff`

- field;
- before and after values;
- action;
- ledger and transaction context;
- raw versus normalized distinction.

### `RawDataPanel`

- last in the information hierarchy;
- monospace and copy support;
- retained data only;
- API-aligned truncation and download behavior.

## Documentation and project components

### `DocumentationLayout`

- constrained reading width;
- on-page contents;
- stable anchors;
- previous or next section navigation where useful;
- collapsible contents on mobile;
- reduced density within the same application identity.

### `ContactOptionCard`

Variants:

- general/private configured form;
- public GitHub Issue.

Required behavior:

- describes appropriate use;
- warns about public disclosure for Issues;
- handles missing configuration explicitly.

### `MethodologySection`

- stable anchor;
- summary and detailed explanation;
- formula or algorithm where relevant;
- evidence, limitation, and source links.

Funding, donation, payment, and promotional components are outside the current release scope.

## Testing expectations

Each reusable component is tested for the states it owns. At minimum cover:

- keyboard focus;
- accessible name or landmark;
- loading;
- unavailable;
- stale or warning where applicable;
- long identifiers;
- narrow viewport;
- no unsupported value invention.

## Change control

A component may be added, renamed, or merged during implementation, but its responsibilities and state coverage remain represented. Material changes require updates to this document and the relevant page specification.