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
  separate real clients and direct-server rejection of forwarded identity.

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

The new API image is deployed and Sepolia readiness passed. Its HTTPS transaction
and platform checks are still running; full success is not yet claimed for this
revision. Deployment metadata is in [azure.json](../deployments/azure.json), and
[azure-progress.json](../deployments/azure-progress.json) identifies the pending gate.
The previously completed 16-transaction HTTPS record remains in
[azure-smoke.json](../deployments/azure-smoke.json) until replaced by the new run.

Live [health](https://unijar-api.purplewater-5aec7560.centralindia.azurecontainerapps.io/healthz),
[readiness](https://unijar-api.purplewater-5aec7560.centralindia.azurecontainerapps.io/readyz),
and [OpenAPI](https://unijar-api.purplewater-5aec7560.centralindia.azurecontainerapps.io/openapi.json).

The preceding release completed transactions but failed its rate-limit check.
Live headers showed alternating ingress-proxy counters. Explicit Azure ingress
mode now uses only the validated rightmost address appended by the platform;
caller-controlled prefixes cannot select a different quota. The new release must
pass that live test plus restart persistence, CORS, request limits, log redaction
and rollback before the gate is complete. Historical passing records remain in Git.

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
by Azure. Frontend, keepers, database, indexer, cross-chain support and production
economic/security validation are outside this phase.
