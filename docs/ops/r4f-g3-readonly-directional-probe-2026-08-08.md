# R4F G3 revision-4 read-only directional probe

Date: 2026-08-08  
Issue: #1261  
Status: implementation prepared but intentionally undeployed; G3 remains unresolved

## Purpose

G3 needs one bounded application action between the provider `Total Egress` before/after observations so that the provider delta can be compared with revision-4 directional accounting. Existing remote qualification functions were built for earlier revision-3 accounting and are not valid revision-4 directional evidence.

This unit prepares a dedicated revision-4 Edge Function and shared accounting helper for that future bounded action. It does **not** add the function to `supabase/config.toml`, does **not** add deployment or invocation to a GitHub Actions workflow, creates no token or source-commit secret, and does not authorize execution.

## Probe shape

A future separately authorized invocation reads exactly one explicit XRPL Devnet validated ledger from the public Devnet JSON-RPC server.

The JSON-RPC request uses:

- method `ledger`;
- exact requested ledger index;
- `transactions: true`;
- `expand: true`;
- API version 1.

The Edge Function rejects an unvalidated response or a returned ledger index that does not equal the requested ledger. The XRPL response body is bounded to at most 32 MiB.

The large XRPL body is not returned to the caller. The function computes its SHA-256 and returns compact accounting evidence instead.

## Directional accounting

The probe meters exactly four boundaries:

1. invoker -> Edge request;
2. Edge -> XRPL request;
3. XRPL -> Edge response;
4. Edge -> invoker compact response.

Under the locked revision-4 G1 contract, the large `xrpl_to_edge_response` body is inbound to Supabase. It remains fully present in memory/transport accounting but contributes zero bytes to the rolling billable-direction egress upper bound. The outbound XRPL request and compact Edge response remain included according to the locked boundary contract.

The helper uses the existing revision-4 directional meter and canonical accounting JSON. The compact Edge response size is solved by a bounded fixed-point loop so the response's own byte count is included consistently in the accounting evidence.

The XRPL response SHA-256 supplied to the shared helper must match the actual retained response body; a valid-looking but mismatched digest is rejected.

## No database or R5 path

The prepared Edge Function contains no:

- Supabase service-role key lookup;
- `SUPABASE_URL` usage;
- PostgREST or database RPC call;
- revision-5 schema or recovery writer;
- transaction signing or submission.

Its retained safety flags state:

- database request issued: `false`;
- recovery mutation committed: `false`;
- public reader unchanged: `true`;
- Mainnet disabled: `true`;
- stabilization authorized: `false`;
- soak authorized: `false`.

## Future authorization boundary

A future live G3 experiment requires a separate exact authorization that covers both the provider Usage-page before/after capture and this one bounded probe. That authorization must bind the exact source commit, revision-4 profile identity, project identity, Dashboard billing period/filter, one ledger index, and the temporary probe credentials.

The current implementation is intentionally not deployable through the repository's existing Supabase config or guarded remote-probe workflow. Preparing this source code does not satisfy or bypass that future authorization.

## Required future evidence

A live run must retain, without secrets:

- the exact source commit and one-run source-run ID;
- requested and returned ledger identity;
- XRPL response byte count and SHA-256;
- canonical revision-4 accounting JSON and digest;
- rolling billable-direction upper bound;
- memory/transport upper bound;
- compact response byte count;
- provider before/after `Total Egress` source artifacts and digests;
- concurrent-traffic exclusion evidence;
- owner authorization evidence.

Only then may the existing hardened G3 provider-capture verifier reconcile the application upper bound with the rounded provider interval and select a conservative unexplained-delta reserve.

## Current conclusion

The application-side read-only probe shape is prepared, but it is undeployed and unexecuted. G3 remains `unresolved`, revision 4 remains `not_selected`, and R5 recovery mutation remains unauthorized.
