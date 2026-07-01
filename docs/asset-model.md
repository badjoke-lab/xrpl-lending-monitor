# Asset model

## Supported asset classes

### XRP

Canonical identity:

```text
asset_type = xrp
asset_key = XRP
```

Store ledger amounts in drops when received as drops. API display fields may provide XRP conversion with explicit provenance.

### IOU

Canonical identity:

```text
asset_type = iou
asset_key = IOU:<currency>:<issuer>
```

Required fields:

- currency
- issuer
- raw amount value
- display label

Two IOUs with the same currency code but different issuers are different assets.

### MPT

Canonical identity:

```text
asset_type = mpt
asset_key = MPT:<mpt_issuance_id>
```

Required fields where available:

- MPT issuance ID
- issuer
- ticker
- name
- asset scale
- metadata source
- relevant transfer, lock, clawback, or authorization properties

Metadata absence must not prevent the asset from being displayed by issuance ID.

## Prohibited aggregation

Do not sum unlike assets.

Prohibited examples:

- XRP + RLUSD + MPT as one quantity
- different IOU issuers under one currency total without issuer-aware grouping
- a USD TVL without a documented and timestamped price source

Allowed examples:

```text
XRP: 1,250,000 XRP
RLUSD issued by r...: 430,000 RLUSD
MPT 0000...ABCD: 100,000 units
```

## Amount representation

Canonical storage:

- preserve raw amount JSON or exact string;
- store asset identity separately;
- never use binary floating point for canonical arithmetic;
- use decimal-safe calculations;
- retain scale information.

API representation should include:

```json
{
  "asset": {
    "type": "mpt",
    "key": "MPT:...",
    "issuance_id": "...",
    "ticker": "AUDT",
    "scale": 6
  },
  "amount": {
    "raw": "10000000",
    "display": "10.000000",
    "provenance": "direct"
  }
}
```

## Asset resolution

Resolution order:

1. Direct Vault Asset field
2. MPT issuance ledger object and metadata
3. Known issuer or token metadata maintained from verifiable sources
4. Fallback raw identity

A friendly label is presentation metadata, not canonical identity.

## Asset-separated aggregates

All aggregate tables and APIs group by `network + epoch_id + asset_key`.

Required aggregate measures may include:

- AssetsTotal
- AssetsAvailable
- DebtTotal
- CoverAvailable
- LossUnrealized
- Vault count
- Broker count
- Loan count

## Future price layer

A price layer is outside the initial release. Adding it requires:

- a new specification;
- source-quality rules;
- timestamp and staleness handling;
- price provenance;
- stablecoin depeg handling;
- user-visible separation between native quantity and converted value;
- free-tier impact analysis.
