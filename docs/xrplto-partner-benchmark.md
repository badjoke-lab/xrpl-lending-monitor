# XRPL.to Partner benchmark gate

Status: **prepared; Partner approval not assumed**  
Lane issue: **#1740**  
Runtime effect: **none**

## Purpose

This branch prepares the exact benchmark sequence that will run only after the existing XRPL.to API key has actually been upgraded to Partner-class limits.

Application submission alone is not sufficient.

## Preflight gate

Every Partner benchmark begins with one authenticated `server_info` request.

The workflow requires:

- a valid XRPL.to response;
- `X-RateLimit-Limit` to be present;
- the observed limit to be at least the configured Partner minimum, default `100`.

If this evidence is not present, the workflow stops before the performance benchmark.

This avoids treating an application submission or an unchanged Free key as Partner approval.

## Catch-up benchmark

Manual workflow:

`.github/workflows/xrplto-partner-qualification.yml`

Available stages:

- `100-ledger`;
- `1000-ledger`;
- `ledger-data`;
- `all`.

The XRPL.to read window can be selected as:

- 8;
- 16;
- 32.

The direct comparison path remains at window 16.

Each exact ledger is normalized through the existing repository `parseValidatedLedgerResult`, and the benchmark compares:

- ledger hash;
- canonical normalized semantic digest;
- transaction count;
- wall time;
- request rate;
- latency p50/p95;
- response bytes.

## ledger_data benchmark

The Partner state traversal uses:

- `binary=true`;
- page limit `2048`;
- 100 pages by default.

It compares XRPL.to and the independent direct Testnet source for:

- ledger hash;
- row count;
- canonical row digest;
- first and last object index;
- wall time;
- rows/sec;
- p50/p95;
- response bytes.

## Safety

- `XRPLTO_API_KEY` is read only from GitHub Actions secrets.
- The key is sent only in the `X-Api-Key` header.
- The key is not written to artifacts.
- The workflow is manual-only.
- No active Devnet collector or D3/D4 channel is changed.
- No XRPL.to-backed canonical publication is activated.
- Mainnet remains separately gated.
- Redistribution permission remains separately gated.

## Promotion rule

Partner approval does not automatically promote XRPL.to.

`PRIMARY_CANDIDATE` still requires:

1. semantic parity;
2. stable Partner-tier execution;
3. operational performance competitive enough with direct reads;
4. later Mainnet qualification;
5. Lending-specific live-object parity;
6. separate redistribution/attribution permission where required.

Until then, classification remains:

**SECONDARY / PARTNER-GATED**
