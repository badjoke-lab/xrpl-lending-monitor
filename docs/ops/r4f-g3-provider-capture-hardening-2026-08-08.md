# R4F G3 provider-capture hardening

Date: 2026-08-08  
Issue: #1261  
Status: capture contract hardened; live G3 capture still not performed

## Purpose

The original G3B capture verifier correctly rejected synthetic evidence and modeled rounded Dashboard values as intervals, but it left several capture identities too weak for a live qualification. A positive comment ID alone was enough to mark authorization as verified, the Dashboard metric itself was not named in the input, and source artifacts were not digest-bound.

This hardening closes those gaps before any live provider reading is used.

## Provider surface

The bounded capture is now pinned to the Supabase organization Usage page with a specific project selected and the `Total Egress` metric for the billing-period window.

The capture input must state and verify:

- `source = organization_usage_page`;
- `metric = total_egress`;
- project filter applied;
- selected project identity digest equals the capture project identity digest;
- billing-period filter applied;
- cached egress is included in the displayed Total Egress surface.

An arbitrary Dashboard number, an organization-wide unfiltered value, a different project, or a different time window cannot qualify G3.

The application side still uses the revision-4 rolling billable-direction upper bound. Any provider delta above that application upper bound is carried into the selected unexplained-delta reserve. No exact provider-byte claim is made when the provider display is rounded.

## Authorization binding

The capture authorization must retain:

- Issue #1261 comment ID;
- actor `badjoke-lab`;
- exact scope `r4f_g3_dashboard_capture`;
- exact application source commit;
- sanitized authorization evidence artifact path;
- non-placeholder SHA-256 digest of that artifact.

The authorization source commit must equal the application-accounting source commit. This prevents an older generic authorization ID from being attached to a later workload implementation.

This change does not create an authorization comment and does not authorize a live experiment.

## Artifact integrity

The before and after provider readings each require a source-artifact SHA-256. Concurrent-traffic exclusion evidence requires one SHA-256 per retained artifact. Placeholder all-zero digests are rejected.

The capture input remains sanitized. Secret-bearing keys or values, PostgreSQL connection strings, bearer tokens, Supabase secret/token formats, session cookies, and password-like fields are rejected before reconciliation.

## Safety boundary

The capture continues to require:

- no provider mutation;
- no production migration;
- no R5 recovery mutation;
- public reader unchanged;
- Mainnet disabled;
- stabilization unauthorized;
- soak unauthorized.

Revision 4 remains `not_selected` even if a future G3 capture qualifies.

## Current blocker

The code-side capture contract and offline verifier are ready to consume real evidence, but the assistant has no authenticated Supabase Dashboard connector. G3 therefore remains `unresolved` until a real bounded before/after Dashboard reading and isolation evidence are captured and fed into the verifier.
