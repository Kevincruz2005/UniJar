# Local, Sepolia and Azure validation

## Local application and container

Validated API source: `a0c0c37949b280309416dbc435e331f547299806` (`local-backend-v2`).
`make container-smoke` completed with exit code 0:

- 27 contract tests and 11 API tests passed; TypeScript checks and build passed.
- Fuzz tests ran 256 cases each; the independent ledger checked 128 runs and 8,192 actions.
- Native and Docker APIs each completed 16 signed Anvil transactions, including
  self-outbid/outbid credits, refunds, settlement, recovery and real pool activity.
- Metadata, modes, held-for-review inventory and balances matched block-tagged
  independent reads. Integer amounts remained decimal strings.
- The image ran as UID 1000, excluded development/secrets/source trees, survived
  restart with identical chain-derived inventory and rejected wrong-chain startup.
- Client-quota tests cover Azure's appended address, changing spoofed prefixes,
  distinct client addresses and direct-server rejection of forwarded identity.

Image: `sha256:e43b077c96234921599ebe9b9902feecb1c63745d3b7d68206cddcbff77a14c2`. Evidence is in
[local-validation.json](../deployments/local-validation.json). These transactions
are isolated Anvil activity, not public deployments.

A slow initial clean dependency build exceeded the oracle's freshness bound;
the subsequent purchase correctly refused `STALE_OBSERVATION`. Smoke setup now
refreshes both local and Sepolia pools through signed in-range liquidity mints.
The passing rerun reused identical dependency layers and repackaged current inputs.
It did not weaken the freshness check or use a fixed substitute price.

## Public-chain evidence

Original contract source: `62ab1501d04a1febfc51042951c9480f9bfd786f`, retained by
`deployment-source-62ab150`. Existing TokenJar, sale, reader and pool contracts
were preserved. API versions have advanced separately; manifests retain the
original contract-source SHA, and images/health responses identify the API build.

- Initial `make deploy-sepolia`: exit 0, with a genuine 1,801-second lookback.
- `make review-asset`: exit 0; a restricted test ERC-20 was deployed and 25 tokens
  minted to the original jar. Its onchain mode is disabled/HeldForReview.
- Extended Sepolia smoke: exit 0; 16 confirmed transactions including direct
  purchase, rejected buyer maximum, self-outbid/outbid, refund withdrawal,
  settlement and permissionless no-bid recovery. API build tested:
  `aa078773371cdf668c390f25f6322c3a4f0bfb6a`.
- `make verify-sources`: exit 0; all ten configured contracts have confirmed
  Sourcify matches. No mainnet or official Uniswap deployment address is claimed.
- Recorded final state has no active lot, bid liability or refund liability.

Evidence: [manifest](../deployments/sepolia.json),
[smoke receipts](../deployments/sepolia-smoke.json), and
[source verification](../deployments/source-verification.json).

## Azure release gate

`make deploy-azure`: **exit 0**. API source: `85039ec0993e23885c5036e03572c8ab6a692745`.
The deployment uses the validated Sepolia manifest and original contracts.

- Sixteen additional real Sepolia transactions were prepared through the HTTPS
  API and signed locally. Direct purchase/buyer bounds, self-outbid/outbid,
  credit withdrawal, funded settlement and no-bid recovery passed.
- Original replicas were fully replaced before comparing identical inventory.
  Post-restore state still has no active lot or bid/refund liability, and the
  25-token held-for-review balance remains in the jar.
- The live rate test received HTTP 429 with exhausted quota headers after
  118 requests in 9.598 seconds. Earlier checks had already consumed some
  of the 120/minute quota. Changing untrusted forwarded prefixes did not bypass it.
- Denied-origin CORS, HTTP 413 request-size enforcement and sampled console-log
  credential checks passed. Allowed-origin behavior is unit-tested; the future
  frontend's actual origin has not yet been configured or browser-tested.
- Rollback served the recorded previous image/version (`eafc5c6`) successfully;
  restoration returned to the new digest/version and identical inventory.
- Health/readiness/OpenAPI returned HTTP 200 for the intended API version.
  Readiness passed within its bounded allowance; no standalone scale-to-zero
  latency benchmark is claimed.

The preceding release's transaction run passed but its rate test failed because
it counted ingress proxy connections. Explicit Azure ingress mode now keys quotas
from the validated rightmost address appended by Azure. Direct servers ignore
forwarded identity. Both spoof resistance and independent client quotas are tested.

Restored revision: `unijar-api--restore-1793939188904`.
Image: `sha256:00f8a39aac4b8bf77fc040a9b4a420a3fa0b809a2595ee6be81202d76a29dcd0`.
Verified at: `2026-11-06T04:27:30.916Z`.

Evidence: [deployment](../deployments/azure.json),
[transactions and platform checks](../deployments/azure-smoke.json), and
[completed checkpoint](../deployments/azure-progress.json).
Live [health](https://unijar-api.purplewater-5aec7560.centralindia.azurecontainerapps.io/healthz),
[readiness](https://unijar-api.purplewater-5aec7560.centralindia.azurecontainerapps.io/readyz),
and [OpenAPI](https://unijar-api.purplewater-5aec7560.centralindia.azurecontainerapps.io/openapi.json).

`make verify-azure` rechecks the saved receipts and repeats platform checks without
signing more transactions. `make smoke-azure` replays testnet transaction flows.

## Additional static review

Slither 0.11.6 analyzed the main project with 102 detectors (exit 255 because
findings are reported). It emitted 28 findings: 5 high, 5 medium, 17 low and
1 informational. No findings were hidden through detector suppression.

- Five high balance/reentrancy warnings identify the intentional pre/post token
  balance comparisons in `_move` and `_open`. Every mutating entry point shares
  the `lock` boundary, private helpers have no unguarded external entry, and
  callbacks cannot change UniJar accounting. Hostile-token tests verify the
  actual `Reentered` selector and rollback on balance mismatches.
- Three medium reentrancy warnings identify intake before lot fields are
  committed; the same shared lock prevents cross-function mutation. The other
  medium warnings are enum equality used to reject missing IDs and the intentional
  quotient/remainder pricing formula. Independent arbitrary-precision vectors,
  including uint256 maximum, verify the formula without multiplication overflow.
- Low/informational warnings cover guarded external calls, event ordering,
  explicit expiry/deadline/freshness timestamps, and the checked low-level token
  call used to support standard ERC-20 return conventions.

These findings were reviewed against the guarded exact-transfer-token design;
this review and passing demo tests do not constitute a production audit.

## Tested toolchain and limits

Foundry 1.9.0 (`6056c5845d34205a83cf7108042adb137325c9df`), Solidity
0.8.29/Cancun and 0.7.6/Istanbul, optimizer 200 runs; Node 24.19.0;
Fastify 5.12.8; viem 2.57.16; TypeScript 7.0.2; Docker 29.9.1;
Azure CLI 2.90.0; Bicep 0.45.15. Actual package resolutions are locked.

Assets, pool, liquidity and buyers are controlled fixtures. Pricing policy is a
demo configuration; idle observations can become stale and correctly refuse a
direct fill. The public smoke tool refreshes observations through a real,
locally signed fixture liquidity mint. No signing key or Anvil service is hosted
by Azure. Keepers, database, indexer, cross-chain support and production
economic/security validation are outside this phase.

The deployed sale contract supports one approval mode per asset at a time; the
API reports that exclusive capability and actual classifications. Simultaneous
dual-mode approval would require a separately tested contract change/deployment.
The subsequent frontend evidence below extends this backend baseline.

## Frontend local gate

Frontend source `cbaab02c829cc983736bf577982e9043de1a870e` passed
`npm --prefix frontend run validate:local` before its Azure release:

- TypeScript and the production build passed; nine amount, intent-validation
  and production-host tests passed.
- Six production-bundle browser checks passed: navigation/deep reloads, real
  inventory and held assets, disconnected access, mobile layout, keyboard
  dismissal and truthful inventory outage handling.
- Five browser wallet scenarios passed against actual local TokenJar/v3/UniJar
  contracts, with 20 confirmed transactions including fixture observations.
  Independently read balances verify direct treasury payment/delivery, fully
  funded bids, self-outbid/outbid credits, withdrawal, expiry settlement and
  exact no-bid recovery. A stale reference refuses purchase without fallback.
- Wrong network, unauthorized controls, account changes during preparation
  and rejected signatures were exercised. The browser compares encoded intent
  and deployment identity, and checks the actual confirmed transaction before
  showing success. Failed requests release their lock before background reads.

Reproduce with `bash scripts/web-local.sh` running in another terminal, then
`npm --prefix frontend run validate:local`. The validator saves ignored evidence;
`make deploy-web` gates publishing on that evidence and an unchanged runtime.

Wallet scenarios inject an EIP-1193 test provider. Encrypted disposable
keystores sign in the Node test process; browser bundles and traces receive no
private keys. Actual MetaMask/Rabby extension and physical-device tests remain
manual acceptance items. QR WalletConnect is not implemented or claimed.
