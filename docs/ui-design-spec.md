# UI design specification

## Purpose

This document is the visual source of truth for the XRPL Lending Monitor interface. It governs M4 and M5 implementation and applies to monitoring, audit, system, and project pages.

The interface is a read-only ledger observatory. It must look trustworthy, technical, and calm. It must not resemble a trading terminal, wallet, lending frontend, token promotion page, or generic neon crypto dashboard.

## Approved direction

- dark navy to near-black application surfaces;
- cyan as the primary interaction and emphasis color;
- green, amber, and red reserved for factual states, warnings, and errors;
- thin borders and restrained depth rather than heavy glow or glass effects;
- dense information presentation with clear grouping and hierarchy;
- human-readable summaries before technical detail and raw data;
- monospace treatment for ledger indexes, hashes, object IDs, accounts, issuance IDs, and exact machine values;
- explicit network, epoch, freshness, and provenance context;
- responsive desktop and mobile layouts designed separately rather than by shrinking desktop screens.

Generated mockups are visual references only. Their example values, USD conversions, pricing, totals, states, charts, and links are not product facts and must not be copied unless supported by the approved API and specifications.

## Design principles

1. **Facts before decoration.** Visual emphasis must follow factual importance.
2. **Unavailable is a first-class state.** Missing, uncollected, unsupported, and stale data must not be rendered as zero.
3. **Current state and history remain visually distinct.** Archived and historical information must not appear current.
4. **On-ledger and schedule states remain distinct.** They use separate labels and explanatory text.
5. **Assets remain separate.** No cross-asset total or fiat conversion is shown without an approved pricing subsystem.
6. **Provenance is inspectable.** Direct, derived, indexed, and unavailable values are identifiable without overwhelming the primary reading flow.
7. **Long identifiers remain usable.** Truncation is visual only; copy and full-value access remain available.
8. **The interface is read-only.** No control may imply signing, depositing, borrowing, repayment, or protocol administration.

## Color tokens

Exact values may be refined during implementation only if contrast tests remain compliant and the semantic roles below do not change.

| Token | Intended role |
|---|---|
| `--surface-canvas` | near-black page background |
| `--surface-sidebar` | sidebar and mobile navigation background |
| `--surface-panel` | primary card and table surface |
| `--surface-panel-raised` | selected, expanded, or modal surface |
| `--border-subtle` | normal panel and table separators |
| `--border-strong` | selected or focused boundaries |
| `--text-primary` | primary headings and values |
| `--text-secondary` | descriptions and labels |
| `--text-muted` | timestamps and secondary metadata |
| `--accent-primary` | cyan links, active navigation, selected controls |
| `--state-positive` | healthy, current, successful, enabled |
| `--state-warning` | stale, payment due, default eligible, incomplete |
| `--state-negative` | error, confirmed default, failed collection |
| `--state-archived` | deleted or archived historical state |
| `--state-unavailable` | unavailable or unsupported data |

State colors must never be the only carrier of meaning. Every colored state requires a text label, icon, or accessible description.

## Typography

- Use a readable system or approved sans-serif stack for navigation, prose, labels, and summaries.
- Use a monospace stack for identifiers, hashes, ledger numbers, exact machine values, raw JSON, and code examples.
- Avoid oversized marketing typography inside the application shell.
- Documentation pages may use larger headings and a narrower reading column.
- Table labels and metadata may be compact but must remain legible at 200% zoom.

Recommended hierarchy:

- page title;
- page description or network context;
- section heading;
- metric value;
- field label;
- helper or provenance text.

## Spacing and density

- Monitoring and audit pages use compact spacing with clear panel separation.
- Documentation and project pages use a wider vertical rhythm and a constrained text measure.
- Tables should favor scanability over decorative padding.
- Touch targets remain at least 44 by 44 CSS pixels on mobile.
- Dense desktop layouts must reflow rather than compress below usable widths.

## Borders, radii, and depth

- Use thin, visible borders to define panels and table regions.
- Use moderate radii consistently; avoid excessive pill-shaped containers.
- Shadows, if used, remain subtle and must not reduce text contrast.
- Selected rows and focused controls use border and background changes, not glow alone.

## Navigation states

Navigation must provide:

- active page indication;
- keyboard-visible focus;
- hover feedback where hover exists;
- section labels for Monitor, Audit, System, and Project;
- a clear mobile alternative to the desktop sidebar;
- no disabled route presented as operational without an explanation.

## Status presentation

### Network and collection

Required labels include, where supported:

- healthy;
- stale;
- delayed;
- unavailable;
- error;
- replacement in progress;
- current epoch;
- archived epoch.

### Loan status

On-ledger and schedule status must be shown in separate fields. `default_eligible` must never be styled or worded as confirmed `defaulted`.

### Archive state

Archived pages use a persistent banner explaining that the object is deleted from current state but retained in history. Archive styling must not imply failure unless the evidence supports that classification.

## Provenance presentation

The canonical categories are:

- **Direct** — read from a validated ledger object or transaction;
- **Derived** — calculated from direct values using a documented formula;
- **Indexed** — reconstructed from collected historical records;
- **Unavailable** — not available or not supported as fact.

Use small badges, icons, tooltips, or field-detail drawers. Do not place a large badge beside every value when a grouped provenance explanation is sufficient. Derived values must expose their formula in the interface or link directly to the relevant methodology section.

## Data states

Every data-bearing component must support the following distinct states:

### Loading

Use skeletons or a clear loading message. Do not display previous values as current without a stale indication.

### Empty

The request succeeded and returned no matching records. Explain the applied scope or filters.

### Unavailable

The requested value or collection is not available, such as before current-snapshot activation. Show the reason returned by the API when present.

### Stale

Data exists but freshness exceeds the documented threshold. Preserve the last known values with a visible warning and timestamp.

### Error

The request failed. Show a bounded, user-safe message and a retry action where appropriate. Do not expose secrets or internal stack traces.

### Partial

Some panels succeeded and others did not. Preserve successful data and mark failed panels independently rather than replacing the whole page with one error.

## Tables

- Keep headers visible where practical on long desktop tables.
- Support keyboard focus and meaningful row links.
- Use visual truncation for identifiers while preserving accessible full values and copy controls.
- Sorting state must be explicit.
- Pagination and result limits must match API contracts.
- Mobile behavior follows `ui-responsive-rules.md`; not every desktop table becomes horizontal scrolling by default.
- Avoid fiat columns or asset aggregation unless an approved pricing subsystem exists.

## Charts and timelines

Charts are allowed only when a stable, documented data series exists. They must:

- preserve asset separation;
- identify units and time range;
- distinguish missing values from zero;
- provide accessible summaries or tabular alternatives;
- avoid fabricated interpolation;
- expose source and provenance.

Lifecycle timelines must preserve ledger and transaction ordering and must not infer unsupported intermediate states.

## Forms and controls

The initial product contains only read-oriented controls such as search, filtering, sorting, copy, pagination, export, and external links.

There are no wallet, signing, deposit, withdrawal, borrowing, repayment, or protocol-management controls.

## Project pages

About, Methodology, Contact, API documentation, and related project pages use the same color and navigation system but a lower-density documentation layout.

- About explains purpose and boundaries.
- Methodology supports long-form technical disclosure with a table of contents.
- Contact separates private/general contact from public technical issues.
- Support, if enabled, is a section at `/about#support`, not a promotional data-page interruption.

## Accessibility minimums

- WCAG AA contrast for text and interactive states;
- complete keyboard navigation;
- visible focus indication;
- semantic landmarks and headings;
- non-color status labels;
- accessible names for copy and external-link controls;
- reduced-motion support;
- usable zoom at 200%;
- screen-reader announcements for loading, error, and refreshed data where appropriate.

## Prohibited visual behavior

- token-price or trading-screen aesthetics;
- animated price tickers;
- unsupported fiat totals;
- cross-asset totals without pricing inputs;
- risk grades or proprietary safety scores;
- promotional urgency, countdowns, or yield claims;
- donation prompts inside data tables or primary monitoring cards;
- presenting Devnet data as Mainnet data;
- hiding stale or unavailable states to make the interface appear complete.
