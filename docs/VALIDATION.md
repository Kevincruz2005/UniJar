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
  credential checks passed. Allowed-origin behavior was unit-tested at this
  backend release; actual frontend-origin verification is recorded below.
- Rollback served the recorded previous image/version (`eafc5c6`) successfully;
  restoration returned to the new digest/version and identical inventory.
- Health/readiness/OpenAPI returned HTTP 200 for the intended API version.
  Readiness passed within its bounded allowance; no standalone scale-to-zero
  latency benchmark is claimed.

The preceding release's transaction run passed but its rate test failed because
it counted ingress proxy connections. Explicit Azure ingress mode now keys quotas
from the validated rightmost address appended by Azure. Direct servers ignore
forwarded identity. Both spoof resistance and independent client quotas are tested.

Backend rollback-test restored revision: `unijar-api--restore-1793939188904`.
The current revision after the frontend CORS update is in [azure.json](../deployments/azure.json).
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

## Frontend Azure release

Live frontend: [UniJar](https://unijar-web.purplewater-5aec7560.centralindia.azurecontainerapps.io).
Initial frontend deployed source: `cbaab02c829cc983736bf577982e9043de1a870e`.
The [frontend manifest](../deployments/frontend.json) records the exact image
digest and ready revision. The existing API image and all original contracts
were preserved; only the actual frontend origin was added to API CORS.

- Six public browser checks passed against the HTTPS deployment, including
  mobile navigation and deep-link reloads of documentation pages.
- Four applicable wallet scenarios passed against real Sepolia through the
  deployed frontend/API: wallet/network/account-change/rejection handling,
  direct approval and purchase, fully funded self-outbid/outbid/refund/settlement,
  and no-bid recovery to the original jar.
- Sixteen transactions have independently confirmed successful receipts.
  Direct treasury/recipient transfers, funded auction proceeds and exact
  recovery matched separate onchain balance reads.
- Frontend health and API readiness returned 200 for their intended builds.
  The actual frontend origin and transaction preflight passed; an unrelated
  origin received no allowed-origin response header.
- Final block `12075348`: active lot, bid liability and refund liability were
  all zero; admissions were open, adoption valid and all 25 held-for-review
  tokens remained in the jar. API inventory matched independent block-tagged
  reads for every configured jar and releaser balance.

The [release evidence](../deployments/frontend-validation.json) contains the
transaction hashes, blocks, source identities and test counts. Reproduce public
checks with the live URL in `BROWSER_BASE_URL` and `public.spec.ts`. Replaying
`wallet.spec.ts` with `WALLET_TEST_NETWORK=sepolia` uses the locally encrypted,
funded disposable accounts and changes real testnet state.

The staleness time-advancement scenario passed on Anvil and was explicitly
skipped on Sepolia; no public-chain time manipulation or public staleness-browser
test is claimed. Browser wallet scenarios used the injected EIP-1193 test
adapter described above. Real wallet extensions and physical devices remain
manual acceptance items, so this release is not a claim that every PRD
acceptance criterion has been completed.

## Cream-and-pink visual release

The visual system introduced at `25144e3` applies the user-selected
Shelby reference from [DESIGN.md](../DESIGN.md). It uses warm cream surfaces,
brown reading text, plum links, heavy sans-serif headings, mono controls and an
original pink geometric collection illustration. Proprietary reference fonts
and source artwork are not copied.

Before Azure publishing, the complete local frontend gate passed: nine
unit/server tests, six public-page browser checks and five wallet scenarios
with 20 confirmed Anvil transactions. The exact production container passed
health, deep routes, build identity and UID 1000 checks before publication.

All six public browser checks passed against the updated Azure URL. Manual
visual inspection covered mobile and desktop landing pages, inventory, lot
details and docs. Reduced-motion preferences stop the decorative marquee;
the checked text color pairs exceed 4.5:1 contrast. The mobile wallet control
remains visible and the document fits the viewport.

Transient API 503 responses occurred after the browser suite; follow-up health,
readiness and config reads returned 200. The original API image, wallet signing,
transaction-intent checks and contracts remain unchanged. No additional Sepolia
transactions were needed for this visual release; earlier transaction evidence
remains in its separately dated record.

The [current frontend manifest](../deployments/frontend.json) records the image
digest and revision. [Design-release evidence](../deployments/frontend-design-validation.json)
records checks for this version. Real browser extensions and physical devices
remain manual acceptance items.


## Enlarged side-pattern release

Source `2a3ab46c53b1f31bac52a75fd978876aafd64e13` replaces the contained jar
illustration with original pink curves cropped against the viewport edge. The
pattern fills a 900px hero at the inspected 1440×900 viewport, while the main
call to action stays within that first viewport. The headline scales to 120px;
product and docs titles scale to 76px and 72px. Shared curved rails appear in
product headings, the documentation gutter and the footer.

The full local gate passed again: nine unit/server tests, six production-page
browser checks and five wallet scenarios with 20 confirmed Anvil transactions.
All six public checks also passed against the new Azure build. Manual layout
checks found no document overflow across landing, inventory, docs and funds
pages at 320px, 850px and 1440px. On mobile the landing curves move below the
primary actions and the documentation rail is hidden.

Wallet signing, transaction checks, API code and contracts remain unchanged.
An API readiness 503 was observed after browser validation; follow-up health,
readiness and config reads returned 200. This is retained as an operational
observation rather than hidden by the visual release. Current source/image
identity and results are in the frontend manifest and design-validation record.


## Receipt service and API reliability release

API source `d82d9cc7cb83563c5c1887ed3591818056d246da` adds bounded RPC
pacing, shared in-flight reads and safe diagnostic categories. The original
sale/oracle contracts are unchanged. The separate Sepolia receipt registry is
`0xa3854b05c6bc2384c15917914cd1afc1ecf248b9`; its constructor terms and runtime
hash are pinned in the Sepolia manifest, and its source match is recorded in
[source-verification.json](../deployments/source-verification.json).

Before publishing, 34 contract tests, 17 API/transport/queue tests and 12
frontend/server tests passed. Eight production-page browser checks and six
Anvil wallet scenarios passed, with 27 successful local transactions. The
wallet suite holds configuration refresh open to verify prompt receipt
confirmation/navigation while further writes stay locked. It also checks
paid receipt collection, exact-lot sale, refunds/recovery and stale-price refusal.

The production API container passed 16 local HTTP transactions after the
native 16-transaction run, non-root/isolation checks, restart persistence and
wrong-chain rejection. The new Azure image then passed 16 real Sepolia
transactions through HTTPS, replacement-replica persistence, CORS, request-size
and rate limits, log redaction, and rollback/restore. Current image and revision
are in [azure.json](../deployments/azure.json); live evidence and hashes are in
[azure-smoke.json](../deployments/azure-smoke.json).

An HTTP 429 was observed from the configured provider before pacing was added.
Historical Azure 503s lack enough diagnostics to attribute every failure to
that cause. The new log categories preserve provider-credential privacy.
Real MetaMask/Rabby extensions and physical devices remain manual acceptance
items; the automated signing adapter is not represented as an extension test.
