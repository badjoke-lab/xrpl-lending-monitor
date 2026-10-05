# XRPL.to Testnet qualification

Status: **X1/X2/X3 evidence collected; keyed/Partner qualification pending**  
Lane issue: **#1740**  
Runtime effect: **none**

## Purpose

This lane evaluates XRPL.to independently from the active direct-XRPL Devnet runtime.

It answers three questions before any provider integration is considered:

1. Can XRPL.to Testnet return the validated-ledger shapes required by the existing collector?
2. Do those responses normalize to the same canonical semantics as an independent direct XRPL Testnet source?
3. What throughput is available before keyed/Partner access?

This evidence does not modify the D3/D4 active channels and does not make XRPL.to a production dependency.

## X1 — Transport and API compatibility

Final X1 evidence is included in Actions run `37262172730`.

Observed successfully through `https://api.xrpl.to/v1/testnet`:

- fixtures;
- health;
- `server_info`;
- `feature`;
- exact validated `ledger` with `transactions=true` and `expand=true`;
- two sequential `ledger_data` pages with opaque string markers;
- type-filtered `ledger_data` requests for `Vault`, `LoanBroker`, and `Loan`.

The expanded-ledger response contained full transaction entries with:

- `tx_json`;
- `meta`;
- transaction hash;
- ledger hash/index;
- validation state.

At ledger `21,289,323`, all 12 transactions were expanded; no hash-only entries were returned.

The two generic `ledger_data` pages each returned 64 rows and a continuation marker.

The first typed page for each of `Vault`, `LoanBroker`, and `Loan` returned zero matching rows but still returned a marker. This is **not** an exhaustive proof that Testnet contains zero such objects.

### Observed Testnet amendment state

The X1 `feature` response reported:

- `LendingProtocol`: supported=true, enabled=false;
- `LendingProtocolV1_1`: supported=true, enabled=false;
- `SingleAssetVault`: supported=true, enabled=false;
- `DynamicMPT`: supported=true, enabled=false;
- `MPTokensV1`: supported=true, enabled=true;
- `PriceOracle`: supported=true, enabled=true.

No Lending/Vault fixture was found in the 97-entry Testnet fixture catalogue, so `vault_info` could not be meaningfully exercised against a known live Vault in this lane.

### Transport hardening observation

The first Actions request to the Testnet fixtures endpoint returned HTTP 403 with a non-JSON body when Node's default request headers were used.

After the probe supplied an explicit project User-Agent, the same endpoint and subsequent Testnet requests succeeded.

This is recorded as an observed operational compatibility requirement, not as an XRPL.to documented contract.

## X2 — Canonical parser parity

Actions run: `37262008027`

The parity probe reuses the repository's existing:

`src/collector/incremental/validated-ledger-parser.ts`

No second ledger parser was introduced.

Exact ledger compared:

- ledger: `21,289,389`;
- XRPL.to latest observed at probe time: `21,289,394`;
- independent direct source: `https://s.altnet.rippletest.net:51234/`.

Results:

- ledger index: equal;
- ledger hash: equal;
- parent hash: equal;
- close time: equal;
- transaction count: `24 / 24`;
- transaction-hash order: equal;
- canonical normalized semantic SHA-256: equal.

Semantic SHA-256 on both paths:

`6c68c0566650e1abdae8d84c31ff24c0496544da458df5ed5740b92e2922a932`

Observed single-ledger latency in this run:

- XRPL.to: `643.496 ms`;
- direct Testnet: `407.816 ms`.

One sample is not a performance conclusion.

## X3 — Pre-key contiguous benchmark

Actions run: `37262172730`

Range:

`21,289,399 → 21,289,428`

Thirty contiguous ledgers were read from both XRPL.to and the independent direct Testnet source and normalized through the same canonical parser.

Results:

- ledgers compared: `30`;
- semantic mismatches: `0`;
- all canonical semantic digests equal: `true`;
- transactions compared in aggregate: `412` on each path.

Combined with X2, this provides **31 unique exact-ledger semantic comparisons with zero observed mismatches**.

### Anonymous XRPL.to measurements

The anonymous path was intentionally paced at 2.1 seconds between requests to stay within the observed/documented no-key request window.

Measured:

- 30-ledger wall time: `76,675.725 ms`;
- effective rate: `0.391 req/s`;
- latency min: `299.551 ms`;
- p50: `474.281 ms`;
- p95: `701.143 ms`;
- max: `831.334 ms`;
- mean: `515.811 ms`;
- response bytes: `1,002,196`;
- transactions: `412`.

Final observed rate-limit headers included:

- `x-ratelimit-limit: 30`;
- `x-ratelimit-reset: 60`;
- `x-ratelimit-daily-remaining: 290`.

### Direct Testnet comparison

The direct path used the existing production-shaped concurrent read style with a window of 16.

Measured:

- 30-ledger wall time: `1,257.545 ms`;
- effective rate: `23.856 req/s`;
- latency min: `81.756 ms`;
- p50: `330.839 ms`;
- p95: `851.068 ms`;
- max: `926.214 ms`;
- mean: `407.754 ms`;
- response bytes: `995,506`;
- transactions: `412`.

The wall-time comparison is intentionally **not** treated as evidence that Partner-tier XRPL.to is slower: the anonymous XRPL.to lane was rate-limited and serialized, while the direct lane used a 16-read window.

## Current classification

**SECONDARY / PARTNER-GATED**

Reason:

- transport compatibility: PASS;
- generic validated-ledger parser compatibility: PASS;
- exact semantic parity: PASS on 31 unique ledgers observed so far;
- anonymous catch-up throughput: insufficient for production-shaped catch-up;
- keyed/Partner throughput: unmeasured;
- 100-ledger catch-up: unqualified;
- 1,000-ledger catch-up: unqualified;
- Lending-specific live-object parity: currently unqualified because the observed XRPL.to Testnet has Lending/Vault amendments disabled and no live fixture was available;
- redistribution/attribution permission: still a separate activation gate.

This classification is not `PRIMARY_CANDIDATE`.

## Keyed-access contract

The current XRPL.to documentation specifies API-key use as:

`X-Api-Key: xrpl_…`

The key can be created from the dashboard or through `POST /v1/keys` with an XRPL wallet signature. The returned API key is shown once and must be saved by the operator.

This lane now contains a **manual-only** keyed benchmark workflow:

`.github/workflows/xrplto-keyed-benchmark.yml`

It reads only the GitHub Actions secret:

`XRPLTO_API_KEY`

The key is sent only in the `X-Api-Key` request header and is not written to evidence artifacts.

The manual benchmark defaults to:

- 100 contiguous ledgers;
- 125 ms request spacing, below the documented Free-key 10 req/s limit.

A 1,000-ledger option is also available. Tighter spacing must not be used merely to force a rate-limit test; it is appropriate only after the key's actual tier/limits are known.

Official references:

- https://xrpl.to/docs/api-keys
- https://xrpl.to/docs/subscriptions

## Next qualification gate

Do not broaden the anonymous benchmark further merely to spend daily request allowance.

The next useful evidence requires keyed/Partner access:

1. create a project-scoped XRPL.to API key and store it as the GitHub Actions secret `XRPLTO_API_KEY`;
2. run the manual 100-ledger keyed benchmark;
3. if that passes, run the 1,000-ledger keyed benchmark;
4. measure 100-ledger and 1,000-ledger bounded catch-up;
5. measure keyed `ledger_data` traversal behavior;
6. record 429 / `Retry-After` behavior without intentionally violating provider policy;
7. classify as `REJECT`, `SECONDARY`, or `PRIMARY_CANDIDATE`.

Public stored XRPL.to-backed artifacts remain prohibited until the separate redistribution/attribution gate is satisfied.

## Evidence links

- X1/X2/X3 qualification run: https://github.com/badjoke-lab/xrpl-lending-monitor/actions/runs/37262172730
- X2 parity run: https://github.com/badjoke-lab/xrpl-lending-monitor/actions/runs/37262008027
- lane issue: https://github.com/badjoke-lab/xrpl-lending-monitor/issues/1740
