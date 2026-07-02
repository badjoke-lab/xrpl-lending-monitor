# Cloudflare deployment

XRPL Lending Monitor is deployed as a Cloudflare Worker with static assets and a D1 database binding.

## Production configuration

- Production branch: `main`
- Worker name: `xrpl-lending-monitor`
- D1 binding: `DB`
- D1 database: `xrpl-lending-monitor`
- Network: XRPL Devnet only
- Mainnet: disabled

Non-production branch builds are disabled. Deployment remains read-only and does not add wallet, signing, transaction submission, payment, pricing, or Mainnet functionality.
