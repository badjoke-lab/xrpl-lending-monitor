# UI component inventory

## Purpose

This document defines reusable UI components, their responsibilities, required states, and milestone ownership. Components are contracts, not permission to introduce a design-system dependency. The initial implementation should use the existing React/Vite stack and ordinary CSS unless a separate decision approves otherwise.

## Application structure

### `AppShell`

Responsibilities:

- desktop sidebar;
- mobile app bar and navigation;
- persistent network-context region;
- main content landmark;
- route title, breadcrumbs, and page actions;
- footer;
- skip link and focus management.

Required states:

- desktop;
- tablet;
- mobile;
- network context available;
- network context stale;
- network context unavailable.

Milestone: M4-1.

### `Sidebar`

Responsibilities:

- Monitor, Audit, System, and Project groups;
- current-route state;
- repository, issue, and optional support links;
- collapsed behavior only if it remains accessible and understandable.

Rules:

- Support is omitted until enabled.
- Unimplemented routes are hidden or clearly marked unavailable.
- Active state is not conveyed by color alone.

Milestone: M4-1, extended as routes ship.

### `MobileNavigation`

Responsibilities:

- primary bottom navigation for Overview, Loans, Activity, Search, and More;
- More menu containing all remaining routes;
- current route and group indication;
- safe-area handling;
- keyboard and screen-reader support.

Milestone: M4-1.

### `NetworkContextBar`

Responsibilities:

- DEVNET badge;
- epoch;
- validated ledger;
- data age;
- collector status;
- stale or reset warning;
- link to Network Status.

It must never imply Mainnet or current data when context is unavailable.

Milestone: M4-1.

## Navigation and utility components

### `Breadcrumbs`

- route-backed links;
- concise identifiers;
- current page marked with `aria-current`;
- horizontal overflow handling on mobile.

### `PageHeader`

- title;
- short description;
- status badges;
- context actions such as export or API link;
- no write or wallet controls.

### `SectionNavigation`

Used for documentation tables of contents and entity-detail subviews. Supports stable anchors and active-section indication.

### `ExternalLink`

- external-link icon and accessible label;
- configurable new-tab behavior;
- no placeholder URL;
- safe `rel` values where needed.

### `CopyValue`

For accounts, object IDs, transaction hashes, issuance IDs, and support addresses.

Required behavior:

- visual truncation without truncating copied content;
- explicit copy label;
- accessible success message;
- no copying of hidden placeholder values.

## Data display components

### `MetricCard`

- label;
- value;
- unit;
- supporting context;
- provenance;
- loading, unavailable, stale, and error states.

A missing metric is not rendered as zero.

### `StatusBadge`

Semantic variants:

- neutral;
- positive;
- warning;
- negative;
- archived;
- unavailable.

On-ledger and schedule status badges are separate component instances with explicit labels.

### `ProvenanceBadge`

Canonical variants:

- Direct;
- Derived;
- Indexed;
- Unavailable.

It may open a tooltip or field-detail explanation. Derived values link to formula documentation where practical.

### `DefinitionList`

For key/value facts in Network Status, entity summaries, archive metadata, and project pages. Supports long values and grouped provenance.

### `DataTable`

Responsibilities:

- semantic table structure;
- bounded sorting and pagination;
- row links and optional row selection;
- long-value handling;
- loading, empty, unavailable, stale, partial, and error states;
- mobile transformation strategy defined per table.

No generic table may silently add USD columns, cross-asset totals, or unsupported filters.

### `FilterBar`

- search;
- documented filters;
- reset;
- applied-filter summary;
- URL synchronization where practical;
- accessible labels and keyboard flow.

### `Pagination`

- API contract-aligned limits and cursors;
- previous/next and result context;
- no fake page count when cursor pagination cannot provide one.

### `IdentifierLink`

- type-aware link to Vault, Loan Broker, Loan, account, transaction, issuance, or archive;
- truncated visual display;
- full accessible value;
- copy action where useful.

### `AssetIdentity`

- XRP, IOU currency plus issuer, or MPT issuance identity;
- no unsupported symbol substitution;
- exact unit displayed beside amounts;
- no fiat price unless separately approved.

## State components

### `LoadingState`

- skeleton or message appropriate to the component;
- no misleading stale value without stale labeling.

### `EmptyState`

- successful request with no records;
- explains current filters and scope;
- offers safe filter reset where appropriate.

### `UnavailableState`

- explicit reason;
- distinguishes unsupported, uncollected, and pre-activation conditions;
- may link to Network Status or Methodology.

### `StaleWarning`

- displays age, threshold, and last success;
- does not remove last known values;
- links to Network Status.

### `ErrorState`

- public-safe error message;
- retry control where appropriate;
- no stack trace or secret;
- component-level use for partial page failure.

### `ArchiveBanner`

- explains that the object is deleted from current state and preserved in history;
- shows epoch and deletion context;
- does not classify cause without evidence.

### `DevnetNotice`

- explains reset possibility;
- links to epoch history;
- distinguishes Devnet monitoring from optional Mainnet support payments.

## Monitoring components

### `OverviewMetrics`

Uses API-supported counts and availability only.

### `CollectorHealthPanel`

- collector status;
- validated and processed ledger;
- lag;
- last attempt and success;
- failure count;
- error summary.

### `AmendmentStatusPanel`

Shows enabled and supported states independently where API-supported.

### `ActivityPreview`

- bounded recent records;
- ledger, type, result, transaction hash;
- route to full Activity and Transaction detail;
- explicit no-data and unavailable states.

### `RecentChangesPanel`

May be introduced only when normalized change data is available through an approved API.

## Entity components

### `EntitySummaryHeader`

- type and identifier;
- current/archive state;
- network, epoch, ledger, and update time;
- primary related entities;
- copy controls.

### `RelatedEntitiesPanel`

- relationship type;
- identifier;
- current/archive context;
- explicit missing relationship.

### `HistorySeries`

- exact unit and asset identity;
- time or ledger axis;
- provenance;
- accessible table or summary;
- no unsupported interpolation.

### `LifecycleTimeline`

- canonical event order;
- ledger, transaction, time, event type, and provenance;
- explicit gaps and unavailable values;
- no inferred event.

### `StateChangeDiff`

- field;
- before;
- after;
- action;
- ledger and transaction context;
- raw versus normalized distinction.

### `RawDataPanel`

- last in information hierarchy;
- monospace and copy support;
- retained data only;
- truncation and download rules aligned with API limits.

## Documentation and project components

### `DocumentationLayout`

- constrained reading width;
- on-page table of contents;
- stable anchors;
- previous/next section navigation where useful;
- mobile collapsible contents;
- same application identity with reduced density.

### `ContactOptionCard`

Variants:

- private/general Google Form;
- public GitHub Issue.

Required behavior:

- describes appropriate use;
- warns about public disclosure for GitHub Issues;
- handles missing configuration explicitly.

### `SupportAddressPanel`

Disabled by default. When enabled, it includes:

- approved address;
- network;
- accepted asset;
- destination-tag instruction;
- copy control;
- QR code;
- voluntary/no-entitlement disclosure;
- explicit Devnet-monitor versus Mainnet-payment distinction.

It must never appear inside monitoring data panels.

### `MethodologySection`

- stable anchor;
- summary;
- detailed explanation;
- formula or algorithm where relevant;
- evidence, limitation, and source links.

## Component testing expectations

Each reusable component must be tested for the states it owns. At minimum:

- keyboard focus;
- accessible name or landmark;
- loading;
- unavailable;
- stale or warning where applicable;
- long identifiers;
- narrow viewport;
- no unsupported value invention.

## Component change control

A component may be added, renamed, or merged during implementation, but its responsibilities and state coverage must remain represented. Material changes require updates to this document and the relevant page specification.
