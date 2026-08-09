# R5 revision-4 runtime accounting

Date: `2026-08-09`.
Issue: `#1261`.

## Purpose

Move R5 runtime accounting away from the rejected revision-3 blanket all-direction egress model without weakening product behavior, history retention, memory guards, invocation guards, or the 12-ledger memory-qualified claim cap.

## Runtime cadence

The candidate runtime keeps the 12-ledger maximum per claim and uses capacity rather than larger claims:

- steady capacity: 2 claims/minute × 12 ledgers = 24 ledgers/minute;
- required steady rate: greater than 21 ledgers/minute;
- catch-up capacity: 3 claims/minute × 12 ledgers = 36 ledgers/minute;
- required catch-up rate: greater than 30 ledgers/minute;
- steady invocation projection: 89,280 / 31 days;
- catch-up invocation projection: 133,920 / 31 days;
- project invocation halt remains 400,000 / 31 days.

The existing retained network-inclusive evidence already demonstrated 24 real expanded Devnet ledgers per minute for six consecutive minute buckets. This change does not claim a new live throughput proof.

## Directional accounting boundary

`src/shared/supabase-revision4-r5-runtime-accounting.ts` converts actual runtime wire measurements into the revision-4 directional contract.

It intentionally separates:

- inbound XRPL response bytes: memory/transport only, zero rolling billable egress;
- outbound XRPL request bytes: rolling billable egress plus memory/transport;
- database request/response bytes: conservatively included until G3 resolves their provider treatment;
- caller response bytes: measured body bytes plus bounded per-operation framing, not the revision-3 fixed 128 KiB function-response reservation;
- canonical JSON, payload, normalized-object overhead, and allocator reserve: memory/transport only.

Framing reserves are multiplied by the actual operation count so aggregation does not undercount repeated requests.

## Fixed free-operation boundary

The 31-day project egress halt remains 4 GiB. At the required 21 ledgers/minute, the exact integer average ceiling is 4,581 billable bytes per ledger before intervention headroom.

No feature, indexed semantic class, history row, target monitoring interval, public-reader behavior, or Mainnet boundary is reduced by this accounting change.

## Safety

This branch changes repository code only.

- revision 4 remains not selected;
- R5 recovery mutation remains unauthorized;
- no Supabase deployment or database mutation is performed;
- public reader remains unchanged;
- Mainnet remains disabled;
- no stabilization or soak is authorized;
- live G3 isolation still requires separate contemporaneous operator authorization.

## Next code step

Replace the revision-3 evaluator call inside the R5 batch executor with this measured directional runtime input, preserving pre-commit fail-closed checks and atomic completion. The old 2 MiB completion-request and 128 KiB function-response values may remain as transport/memory caps where useful, but must not be added blindly to rolling billable egress.
