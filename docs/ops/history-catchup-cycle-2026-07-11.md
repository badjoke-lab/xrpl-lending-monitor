# History catch-up cycle — 2026-07-11

This operational branch starts the first bounded rolling checkpoint recovery cycle after the live-source freshness audit withdrew public-release acceptance.

## Source pair

- history branch: `history-rolling-next-candidate-data`
- current-state branch: `current-state-rolling-next-candidate-data`
- aligned source ledger: `3,540,657`

## Output pair

- history branch: `history-rolling-recovery-b-data`
- current-state branch: `current-state-rolling-recovery-b-data`

## Bounds

- maximum delta: `5,000` ledgers
- segment size: `500` ledgers
- read window: `4`
- Mainnet: disabled
- production D1 writes: none
- production branch promotion: none
- Worker deploy or cron change: none

The temporary workflow dispatches the already merged rolling checkpoint candidate workflow, waits for completion, verifies that the history and current-state outputs advance together to the same ledger and hash, compares the result with the live Devnet head, and retains evidence.

This file and the temporary workflow are operational scaffolding and are not intended to remain after the catch-up cycle evidence is reconciled.
