# XRPL.to provider evaluation

Status: **research / future-provider evaluation**
Date: **2026-10-04**
Current runtime effect: **none**

## Executive conclusion

XRPL.to is a credible future read provider for Mainnet and a useful Testnet compatibility source, but it MUST NOT replace the current XRPL Lending Monitor Devnet collector.

The active product scope is XRPL Lending Devnet and the active DB-less architecture depends on validated Devnet ledger reads. XRPL.to currently documents Mainnet and Testnet read surfaces; no documented Devnet endpoint was found. Therefore this evaluation does not change D4, D5, or the current Devnet publication chain.

If Mainnet is approved later, XRPL.to can be evaluated behind a provider adapter without changing the existing domain, continuity, deterministic artifact, or channel-last publication semantics.

## What XRPL.to currently exposes

Documented API version at evaluation time: **v1.20**.

Relevant Mainnet surfaces include:

- `GET /v1/ledger` — latest validated ledger metadata;
- `GET /v1/ledger/{index}` — a ledger by index, with transaction hashes by default and optional expansion;
- `POST /v1/rpc` — read-only XRPL RPC access, including `ledger`, `ledger_data`, `ledger_entry`, `account_objects`, `account_tx`, `feature`, `get_aggregate_price`, `mpt_holders`, `tx`, `transaction_entry`, and `vault_info`;
- `wss://api.xrpl.to/ws/ledger` — Mainnet ledger-close stream.

Relevant Testnet surfaces include:

- `POST /v1/testnet/rpc`;
- `wss://api.xrpl.to/v1/testnet/ws`;
- `GET /v1/testnet/fixtures`, which is intended to expose live reference objects and transactions on their Testnet environment.

No documented XRPL Devnet equivalent was found in the current API documentation.

Sources:

- https://xrpl.to/docs
- https://xrpl.to/docs/xrpl/post-rpc
- https://xrpl.to/docs/xrpl/get-ledger
- https://xrpl.to/docs/xrpl/get-ledger-index
- https://xrpl.to/docs/websocket/ws-ledger
- https://xrpl.to/docs/testnet
- https://xrpl.to/docs/testnet/post-testnet-rpc

## Current project boundary

The active repository contracts remain unchanged:

```text
XRPL Devnet validated ledgers
        |
        v
GitHub Actions bounded collector
        |
        +--> Current artifacts
        +--> History artifacts
        |
        v
verified GitHub Release publication
        |
        v
static React application
```

XRPL.to is not a dependency of this path.

Reasons:

1. The current release target is Devnet.
2. The documented XRPL.to network surfaces are Mainnet and Testnet, not Devnet.
3. D4/D5 work is already qualifying the DB-less Devnet artifact chain.
4. Changing source providers during that qualification would introduce unrelated variables and invalidate existing evidence.
5. The current product requires exact validated-ledger continuity and deterministic derivation; a new provider must prove compatibility before activation.

## Recommended roles

### Role A — current Devnet production

**Do not use XRPL.to.**

Keep the current direct Devnet endpoint path and existing DB-less collector.

### Role B — Testnet conformance probe

XRPL.to Testnet MAY be used in a separate, non-canonical test lane to compare:

- response envelope handling;
- supported transaction/object types;
- `vault_info` behavior;
- `ledger_data` pagination shape;
- expanded `ledger` transaction + metadata shape;
- binary/JSON decoding assumptions.

This must not become a substitute for Devnet fixtures or Devnet release evidence.

### Role C — future Mainnet read provider

If Mainnet scope is separately approved, XRPL.to is a candidate provider for:

- latest validated-ledger discovery;
- exact ledger-by-index catch-up;
- fixed-ledger `ledger_data` traversal;
- object lookup;
- amendment/status reads;
- transaction lookup.

It should be introduced behind a provider adapter so the existing parser/domain/publication layers remain provider-independent.

## Provider adapter requirement

The existing `XrplJsonRpcClient` sends the normal XRPL JSON-RPC envelope:

```json
{
  "method": "ledger",
  "params": [
    {
      "ledger_index": 123,
      "api_version": 2
    }
  ]
}
```

XRPL.to documents `POST /v1/rpc` with a different outer request shape:

```json
{
  "method": "ledger",
  "params": {
    "ledger_index": 123
  }
}
```

and wraps the node result in an XRPL.to response object.

Therefore future support should use a dedicated adapter rather than conditionals scattered through the existing direct-node client.

Target boundary:

```ts
interface XrplReadProvider {
  latestValidatedLedger(): Promise<ValidatedLedgerHead>
  readLedger(index: number): Promise<ValidatedLedgerEnvelope>
  rpc<T>(method: string, params: Record<string, unknown>): Promise<T>
}
```

Possible implementations:

```text
DirectXrplProvider   -> current Devnet path
XrplToProvider       -> future Mainnet/Testnet path
```

The domain layer must not know which provider was used.

## Future Mainnet ingestion shape

If Mainnet is approved and XRPL.to passes qualification, keep the existing five-minute GitHub Actions model. Do not introduce a continuously running WebSocket service merely because XRPL.to offers one.

A future run should be:

```text
load active channel
    |
read latest validated Mainnet ledger
    |
start = lastCommitted + 1
    |
bounded exact-ledger loop
    |
verify index + validated + parent hash
    |
reuse Lending transaction parser
    |
reuse AffectedNodes normalization
    |
derive Current + History once
    |
build deterministic artifacts
    |
upload + read-back verify
    |
switch channel LAST
```

For each ledger, the preferred qualification path is `POST /v1/rpc` using the XRPL `ledger` method with:

- exact `ledger_index`;
- `transactions: true`;
- `expand: true`;
- validated-ledger verification.

The XRPL protocol documentation confirms that expanded `ledger` output contains full transaction representations and transaction metadata required for `AffectedNodes`-based derivation.

The convenience `GET /v1/ledger/{index}` endpoint may still be useful for head/hash checks, but with its default `expand=false` it returns transaction hashes, which is insufficient by itself for the existing derivation pipeline.

Sources:

- https://xrpl.org/docs/references/http-websocket-apis/public-api-methods/ledger-methods/ledger
- https://xrpl.org/docs/references/protocol/transactions/metadata
- https://xrpl.to/docs/xrpl/get-ledger-index
- https://xrpl.to/docs/xrpl/post-rpc

## Future complete Current base

A Mainnet base would still use the repository's existing fixed-ledger rules:

1. resolve one validated ledger index/hash;
2. traverse `ledger_data` to marker exhaustion for relevant object types;
3. decode and normalize using the existing domain code;
4. reject duplicate identifiers;
5. validate relationships;
6. build deterministic shards/indexes;
7. independently verify all manifests and digests;
8. activate only after publication verification.

XRPL.to Partner limits do not waive these rules.

Before relying on XRPL.to for a complete base, a dedicated benchmark must measure:

- page/marker behavior;
- endpoint-specific limits;
- request count;
- decoded bytes;
- elapsed time;
- retry behavior;
- `429 Retry-After` handling;
- reproducibility against an independent XRPL source.

## Rate-limit and plan facts

At evaluation time, XRPL.to documents:

| Tier | Credits / 30 days | Requests / second |
| --- | ---: | ---: |
| Free | 1M | 10 |
| Partner | 20M | 100 |

Partner is invitation-based and free for credited integrations.

Endpoint-specific windows still apply, so global requests/second is not sufficient for capacity planning. Any future collector MUST honour `Retry-After` and fail closed rather than skipping ledgers.

Source:

- https://xrpl.to/docs/subscriptions

## Attribution and redistribution gate

This is the most important non-technical constraint.

XRPL.to currently requires:

- a visible, clickable **Data by xrpl.to** credit on the same screen as displayed XRPL.to data; and
- prior written permission before storing XRPL.to data and serving it again through an application's own API, dataset, or public dashboard.

XRPL Lending Monitor publishes stored static artifacts and serves them through a public dashboard. Therefore an XRPL.to-backed public generation MUST NOT be activated until written redistribution permission has been obtained.

Partner approval alone must not be treated as equivalent to written redistribution permission unless XRPL.to explicitly confirms that in writing.

Sources:

- https://xrpl.to/docs/terms
- https://xrpl.to/docs/tools/get-docs

## API-key handling

If a Partner key is used later:

- store it only as a GitHub Actions secret;
- never commit it;
- never put it in the static React bundle;
- never require the browser to call XRPL.to with the private key;
- keep public artifact reads provider-independent.

This preserves the current static application boundary.

## Qualification gates before any Mainnet activation

All of the following are required:

1. **Mainnet product approval** — Mainnet is currently excluded by the product specification.
2. **Written redistribution permission** from XRPL.to.
3. **Partner/API-key approval** if operationally required.
4. **Provider adapter implementation** with no domain-layer fork.
5. **Fixed-ledger parity test** against an independent XRPL source.
6. **Expanded-ledger metadata fixture replay** for every recognized Lending transaction class.
7. **Complete `ledger_data` traversal benchmark** to marker exhaustion.
8. **429/backoff/interruption/retry evidence**.
9. **Parent-hash continuity and idempotence evidence**.
10. **Artifact-byte and Actions-runtime measurements**.
11. **Attribution UI specification and browser evidence**.
12. **Multi-run soak** before changing a public channel.

Failure of any gate keeps the existing provider/publication path unchanged.

## Oracle and MPT note

XRPL.to also exposes methods relevant to future Oracle Health and MPT Lifecycle projects, including `get_aggregate_price` and `mpt_holders`.

Those projects are outside the current XRPL Lending Monitor product boundary. Their evaluation should occur in separate repositories or specifications rather than expanding this repository's release scope.

## Decision summary

For this repository:

- **KEEP** the current Devnet DB-less collector unchanged.
- **DO NOT** pivot D4/D5 to XRPL.to.
- **ALLOW** an isolated Testnet compatibility probe later.
- **PREPARE** XRPL.to as a future Mainnet provider candidate.
- **REQUIRE** written redistribution permission before public stored artifacts use XRPL.to-derived data.
- **PRESERVE** validated-ledger, parent-hash, deterministic derivation, and channel-last semantics regardless of provider.
