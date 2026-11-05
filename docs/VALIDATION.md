# UniJar validation evidence

Application source deployed: `62ab1501d04a1febfc51042951c9480f9bfd786f`.
Later commits add operational tooling and documentation without changing contract
or API runtime source. All times in public manifests are UTC.

## Executed checks

| Command | Exit | Observed result |
| --- | --- | --- |
| `make check` | 0 | 27 contract tests; 256 cases per fuzz test; independent ledger: 128 runs, 8,192 calls; six API tests; application and tooling typechecks; backend build |
| `LOCAL_CONTAINER=1 bash scripts/local-smoke.sh` | 0 | Clean Docker build; non-root UID 1000; API-prepared, locally signed direct sale and auction/outbid/refund/settlement; no-bid recovery; restart state equality; wrong-chain rejection |
| `bash scripts/local-smoke.sh` | 0 | Repeated against isolated local accounts, including independently block-tagged lot/adoption/credit checks and unauthorized-sender refusal |
| `make azure-plan` | 0 | Enabled Students subscription, registered providers, Central India policy/quota, Bicep compilation and subscription what-if; no resources created by this command |
| `make verify-sources` | 0 | Nine Sepolia contracts have independently confirmed Sourcify source matches; see `deployments/source-verification.json` |
| `make deploy-sepolia` | running | Nine deployed addresses confirmed; real liquidity seeded; waiting for the full 1,801-second lookback before final manifest and transaction smoke |
| `make deploy-azure` / `make smoke-azure` | pending | Require completed public-chain validation |

Local container image tested:
`sha256:0f49a78d032d0cf951e749767237fdcd19805305a3301c1b1cb2589eb3cce338`
(290,718,338 bytes). Its manifest describes the local test chain; it is not a
public deployment. Production is rebuilt with the actual Sepolia manifest.

Public seed transaction:
`0xf27b0bf4a1ac7c29b40eec2347f0530c8c812edaf35afd1cb1f96e18781cc76f`.
No public lookback uses local timestamp cheats. `make oracle-status` reports
elapsed time from actual confirmed block timestamps.

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
