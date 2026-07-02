# UI design specification

## Purpose

This document is the visual source of truth for XRPL Lending Monitor. It applies to monitoring, audit, system, and project pages.

The interface is a read-only ledger observatory. It looks trustworthy, technical, and calm. It does not resemble a trading terminal, wallet, lending frontend, token promotion page, or generic neon crypto dashboard.

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

Generated mockups are visual references only. Example values, pricing, totals, states, charts, and links are not facts unless supported by the approved API and specifications.

## Design principles

1. **Facts before decoration.** Visual emphasis follows factual importance.
2. **Unavailable is a first-class state.** Missing, uncollected, unsupported, and stale data are not rendered as zero.
3. **Current and historical state remain distinct.** Archived information does not appear current.
4. **On-ledger and schedule states remain distinct.** They use separate labels and explanations.
5. **Assets remain separate.** No cross-asset total or fiat conversion appears without an approved pricing subsystem.
6. **Provenance is inspectable.** Direct, Derived, Indexed, and Unavailable values are identifiable.
7. **Long identifiers remain usable.** Truncation is visual only; full-value access remains available.
8. **The interface is read-only.** No control implies wallet, funding, transfer, signing, borrowing, repayment, or protocol administration.

## Visual tokens

Exact token values may be refined only when contrast and semantic roles remain correct.

| Token | Intended role |
|---|---|
| `--surface-canvas` | near-black page background |
| `--surface-sidebar` | sidebar and mobile navigation background |
| `--surface-panel` | primary card and table surface |
| `--surface-panel-raised` | selected or expanded surface |
| `--border-subtle` | normal separators |
| `--border-strong` | selected or focused boundaries |
| `--text-primary` | headings and values |
| `--text-secondary` | descriptions and labels |
| `--text-muted` | timestamps and metadata |
| `--accent-primary` | links and active navigation |
| `--state-positive` | current, healthy, successful |
| `--state-warning` | stale, due, default eligible, incomplete |
| `--state-negative` | error, confirmed default, failed collection |
| `--state-archived` | deleted or archived state |
| `--state-unavailable` | unavailable or unsupported data |

Color is never the only carrier of meaning.

## Typography and density

- Use a readable sans-serif stack for navigation, prose, labels, and summaries.
- Use monospace for identifiers, hashes, ledger numbers, exact values, raw JSON, and code examples.
- Avoid oversized marketing typography.
- Documentation pages use a constrained reading width and wider vertical rhythm.
- Monitoring tables remain compact but legible at 200% zoom.
- Mobile touch targets remain at least 44 by 44 CSS pixels.

## Navigation

Navigation provides active-page indication, visible keyboard focus, section labels for Monitor, Audit, System, and Project, a clear mobile alternative, and explicit treatment of planned routes.

## Status presentation

### Network and collection

Use factual labels such as healthy, stale, delayed, unavailable, error, replacement in progress, current epoch, and archived epoch when supported.

### Loan status

On-ledger and schedule status appear in separate fields. `default_eligible` is never styled or worded as confirmed `defaulted`.

### Archive state

Archived pages use a persistent banner explaining that the object is absent from current state but retained in history. Archive styling does not imply failure without evidence.

## Provenance

Canonical categories:

- **Direct** — validated ledger object or transaction;
- **Derived** — calculated from direct values with a documented formula;
- **Indexed** — reconstructed from collected history;
- **Unavailable** — not available or not supported as fact.

Derived values expose their formula in the interface or link to Methodology.

## Data states

Every data-bearing component supports:

- Loading;
- Empty;
- Unavailable;
- Stale;
- Error;
- Partial.

Successful sibling panels remain visible during partial failure. Public errors do not expose internal details.

## Tables

- semantic headers and row links;
- visible sorting state;
- API-aligned limits and pagination;
- full accessible identifier values;
- declared mobile strategy;
- no unsupported fiat columns or asset aggregation.

## Charts and timelines

Charts are used only for stable documented series. They preserve asset separation, identify units and range, distinguish missing from zero, provide an accessible alternative, avoid fabricated interpolation, and expose provenance.

Lifecycle timelines preserve ledger and transaction order and do not infer missing events.

## Forms and controls

The initial product contains read-oriented controls only: search, filters, sorting, copy, pagination, export, and configured external links.

There are no wallet, funding, transfer, signing, deposit, withdrawal, borrowing, repayment, or protocol-management controls.

## Project pages

About, Methodology, Contact, and API documentation use the same application identity with a lower-density documentation layout.

- About explains purpose and boundaries.
- Methodology provides comprehensive technical disclosure with a table of contents.
- Contact separates general/private contact from public technical issues.

## Accessibility minimums

- WCAG AA contrast;
- complete keyboard navigation;
- visible focus;
- semantic landmarks and headings;
- non-color state labels;
- accessible copy and external-link controls;
- reduced-motion support;
- usable reflow at 200%;
- appropriate announcements for loading, error, and refreshed data.

## Prohibited visual behavior

- token-price or trading-screen aesthetics;
- animated price tickers;
- unsupported fiat or cross-asset totals;
- risk grades or proprietary safety scores;
- promotional urgency, countdowns, or yield claims;
- commercial prompts inside monitoring surfaces;
- presenting Devnet data as Mainnet data;
- hiding stale or unavailable states to make the interface appear complete.