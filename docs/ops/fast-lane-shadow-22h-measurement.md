# Fast lane shadow measurement

This run measures real XRPL Devnet Lending workload at a five-minute target cadence without writing production D1 or changing the production Worker.

The workflow runs four sequential blocks. Each block records 67 samples at a 300-second target interval, for 268 samples across approximately 22 hours. Every sample is committed immediately to fast-lane-shadow-22h-data so partial evidence survives workflow failure.

Each sample records validated ledgers read, inspected transactions, Lending transactions by type, successful Lending transactions, affected Vault, LoanBroker, and Loan object counts, a conservative minimum projection-write lower bound, scan elapsed time, backlog before the sample, and whether the sample reached the head.

The final decision must distinguish three outcomes: direct bounded persistence is viable; batched or coalesced persistence is required; or a five-minute fast lane is not viable in the free-tier envelope.

The measurement performs no production D1 write, Worker deployment, production cron change, branch promotion, or Mainnet enablement.
