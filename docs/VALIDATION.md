# Local validation gate

Validated source: `008d267b85b6800b42b24d1a93731a72d722bfa7` (`local-validated-v1`).

`make container-smoke` completed with exit code 0 after the history rewrite:

- 27 contract tests and six API tests passed.
- Fuzz tests ran 256 cases each; the independent ledger checked 128 runs and 8,192 actions.
- Native and Docker APIs each prepared 13 locally signed transactions; receipts, balances, refunds, settlement and recovery were checked.
- The clean image ran as UID 1000, survived restart with identical chain-derived inventory, and rejected wrong-chain configuration.

Image: `sha256:f8112381947e32ad11cb556fe26323425ad7bd8c931709def9c85054f9d94feb`. Detailed compact evidence is in
[local-validation.json](../deployments/local-validation.json). These are ephemeral
Anvil transactions, not public-chain deployments.

## Public-chain evidence

The original deployed source is `62ab1501d04a1febfc51042951c9480f9bfd786f`,
retained by `deployment-source-62ab150`. Contract/API sources and compiler/package
configuration are byte-identical to that source; history consolidation changes
commit identities, not those runtime files.

- `make deploy-sepolia`: exit 0; full real 1,801-second oracle history and fresh in-range activity verified.
- Fourteen genuine Sepolia transactions passed direct-sale bounds, payment/delivery, auction outbid/refund/settlement and no-bid recovery checks.
- Nine contracts have confirmed Sourcify source matches.
- Evidence: `deployments/sepolia.json`, `deployments/sepolia-smoke.json`, and `deployments/source-verification.json`.

## Azure gate

Azure deployment and HTTPS liveness/readiness/OpenAPI checks passed at
`https://unijar-api.purplewater-5aec7560.centralindia.azurecontainerapps.io`. Full transaction and restart validation is in progress; no full
Azure smoke success is claimed yet.
The registry, identity, logs workspace and environment were provisioned. The
initial app attempt failed because the older API defaulted the environment to
Express. Infrastructure now explicitly requests WorkloadProfiles with a
Consumption profile using API 2026-07-01. The platform restoration can take
15–30 minutes.

The earlier orchestration was cancelled at the user pause request. The platform
restoration subsequently completed, and deployment resumed after local validation
and history consolidation as authorized. The actual image digest, revision and
URL are in `deployments/azure.json`; HTTPS transaction tests are still required.


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
