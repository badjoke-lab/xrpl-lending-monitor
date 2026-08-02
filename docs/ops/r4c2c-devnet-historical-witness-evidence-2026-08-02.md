# R4C2c Devnet historical witness evidence — 2026-08-02

Status: read-only historical discovery complete; committed persistence and reader parity still pending.

## Run identity

- workflow run: `30741004656`;
- main commit: `9139af3b4d677d5d70fcbae92052de892746ecfe`;
- verified at: `2026-08-02T09:03:58.826Z`;
- artifact ID: `8831279628`;
- artifact digest: `sha256:f0bbc12cf5b37fb87d03e7a2f865dd6b1647d2a0243ad6545ec2d1da693dffc2`;
- transaction submission: none;
- database mutation: none.

The first run `30740624055` did not reach any Devnet read because Bun was absent from the runner. PR #1120 added an explicit pinned Bun setup. The successful rerun is the only witness result credited below.

## Bundle identity

- source: `scripts/qualify-devnet-historical-witness.ts`;
- bytes: `82,340`;
- SHA-256: `df3007b6acecc5d7e32247f0dcaf19ec284c69391b56f195189910ea1d3b7e09`;
- unresolved relative imports: `0`;
- Cloudflare runtime imports: `0`.

## Bounded search result

The runner requested the five audit-derived exact ledger indices plus the fixed audit window `3,269,937`–`3,270,064`.

- requested ledgers: `133`;
- readable ledgers: `90`;
- unavailable ledgers: `43`;
- ledgers with Lending transactions: `3`.

The minimal sufficient real Devnet witness set is:

| Ledger | Lending transactions | Main contribution |
| --- | ---: | --- |
| `2,776,760` | `8` | protocol events, object changes, lifecycle, balance history, current projections |
| `2,980,845` | `3` | `LoanDelete`, archived Loan tombstone, deleted lifecycle and projection |
| `3,127,240` | `2` | additional Loan creation and relationship witness |

## Aggregate seven-class counts

- validated-ledger: `3`;
- protocol-event: `13`;
- object-change: `197`;
- loan-lifecycle: `3`;
- archived-object: `1`;
- balance-history: `2`;
- current-projection: `18`.

No non-ledger semantic class remained empty. `completeSixClassWitness` was `true`.

## Ledger `2,776,760`

- ledger hash: `83CD41036ADD7F9D8FA247F04BF5156B6826D95C4E6A346B9A5499BE90C43A9D`;
- parent hash: `E7E4E253C314D5EBD39E8C063415A99299E48FB23A0E613F1FE5CA534B0C0628`;
- Lending transactions: `8`;
- semantic counts: `1 / 8 / 94 / 1 / 0 / 2 / 10` in the canonical seven-class order.

Important transaction witnesses:

- `3A82A8A88F490BE5AFD0F72BBDC405B7D32BBF209C7E05B9A43516594E9A8D66` — `LoanBrokerCoverClawback`;
- `7E1926826398D1AFB71B385CE2D40E0E0D80FCF11074AD90524CCB06D067BFF2` — `LoanSet`;
- `C74B7A432178EB06913480289F4ACBAC833800F9642FCE5833D9D9385458F979` — `VaultCreate`.

This ledger supplies both retained balance-history rows. Example relationship witness: `loan:C3011CC8854440863E80DB1853EE06461E49BEB3A6C1BD680A96642AB3C6A1FC`.

## Ledger `2,980,845`

- ledger hash: `5BA95992F3E649752BBA5550EEEF79DEB535881E10FF7C1D4F9EF953340B0C40`;
- parent hash: `F193C199E54799140F552EF7F6D16FEFED39CF3F06799F25A34BE7D9791A9A81`;
- Lending transactions: `3`;
- semantic counts: `1 / 3 / 63 / 1 / 1 / 0 / 4`.

The critical transaction is:

- `6A92B8369E0094FFBE1C7872858C30FE7F8C94B7FCAF297DD9DCB64E1C88FA82` — `LoanDelete`.

It produces the only archived-object row and the canonical deleted lifecycle/tombstone witness for Loan `FBD9559FBC50D3274AAD6495454E83E0FDB97DCE497D0423C1666641B2288718`.

## Ledger `3,127,240`

- ledger hash: `6CDB77504546BE14D226CFFDFC61082EC73BF95191E5326536254903D87692B3`;
- parent hash: `072DEDC596274E711A246F93F7919100A16473D549AEA2C3CE4B7D2233BF903E`;
- Lending transactions: `2`;
- semantic counts: `1 / 2 / 40 / 1 / 0 / 0 / 4`.

The `LoanSet` transaction `AFD2701B067D576DAE0EB38A894ED01C72D20590EF6D3C2537B175A8DA4D1DDF` produces Loan `E10BADFD8F1672375BCAA3020902970E85EE5086C7991D02E9C013B963C3391C` and supplies an additional independent relationship witness.

## What this closes

This closes the R4C2c discovery requirement for **non-empty real Devnet source evidence** across all six non-ledger semantic classes. It also freezes an exact three-ledger fixture for the next qualification unit.

## What remains open

This run did not persist the historical witness set into Supabase and did not query it through the committed reader. It therefore does not yet prove:

- committed-only visibility for the six classes;
- exact class-count parity after persistence;
- canonical-key parity after persistence;
- non-empty relationship queries;
- cursor pagination across the 237 normalized records;
- isolated historical stream/watermark fencing;
- complete-state export or restore;
- interruption, retry, stale-lease, duplicate, or terminal behavior.

The next unit must use a separate qualification profile/epoch. It must not mix non-contiguous historical ledgers into the active `supabase-devnet` stream or alter the public reader.
