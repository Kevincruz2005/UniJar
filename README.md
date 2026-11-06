# UniJar

Web application and backend for the ETHGlobal Mumbai 2026 controlled demo. UniJar sells exact batches
of fees held in the original Uniswap TokenJar through funded auctions or guarded,
v3-reference-priced direct purchases. The reference pool supplies a price; a
direct purchase transfers payment straight to treasury and does not swap.

The complete MVP requirements are in [PRD.md](PRD.md). The cream-and-pink frontend
includes a landing page, separate lot/inventory/funds pages, documentation and
live-role operator controls. Wallet actions use injected EVM wallets and verified
unsigned API preparations. [Validation evidence](docs/VALIDATION.md)
and [testnet data sources](docs/TESTNET.md) describe the current implementation.

**Live app:** [UniJar on Azure](https://unijar-web.purplewater-5aec7560.centralindia.azurecontainerapps.io)
· [Documentation](https://unijar-web.purplewater-5aec7560.centralindia.azurecontainerapps.io/docs)

## Validation order and current status

1. Local application and Docker validation passed at `local-backend-v2` (`a0c0c37`): 27 contract tests, 11 API tests and 32 confirmed local transactions.
2. Ten source-verified Sepolia contracts, including the held-for-review token, and 16 successful expanded smoke transactions are recorded in `deployments/`.
3. Azure validation passed for API build `85039ec`: 16 confirmed HTTPS-prepared transactions, restart persistence, client rate limits, request-size enforcement, log redaction and rollback/restore. Live endpoints: [health](https://unijar-api.purplewater-5aec7560.centralindia.azurecontainerapps.io/healthz) and [OpenAPI](https://unijar-api.purplewater-5aec7560.centralindia.azurecontainerapps.io/openapi.json).
4. Frontend source `cbaab02` passed nine unit/server tests, six production-page browser checks and five local wallet scenarios with 20 confirmed Anvil transactions before deployment.
5. The deployed HTTPS frontend passed all six public browser checks and four applicable Sepolia wallet scenarios with 16 confirmed transactions. Receipts and final zero-liability state are in [frontend-validation.json](deployments/frontend-validation.json). Actual MetaMask/Rabby extension and physical-device tests remain manual checks.
6. The enlarged Shelby-inspired visual update at `2a3ab46` passed nine unit/server tests, six production-page checks, five local wallet scenarios and six Azure browser checks. [DESIGN.md](DESIGN.md) records the reference and adaptations; [design-release evidence](deployments/frontend-design-validation.json) records the current visual release. Wallet, backend and contract logic are unchanged.

The main history was consolidated into substantial local-to-cloud milestones at
the user's request. Original history is retained on
`archive/before-local-first-rewrite`; the original deployed source is retained by
`deployment-source-62ab150`. Public manifests retain that original source SHA.
The deployed-source and local/Azure validation tags are published with `main`
so provenance remains resolvable. No remote history has been force-pushed.

## Run locally

Requirements: Linux, Node 24, npm, Git, Python 3, curl, make; Docker for container
checks. Foundry 1.9.0 is installed into ignored `.tools/` with a verified upstream
digest. Dependencies are reconstructed at the specified source pins.

```sh
make bootstrap
make check
make local-smoke
make container-smoke
```

`check` builds the two compiler projects, runs contract/fuzz/stateful ledger tests,
exports runtime ABIs/licenses, checks TypeScript (including tooling), tests the
API, and builds it. It needs no cloud credentials.

`local-smoke` owns an ephemeral, loopback-only Anvil on port 18545, deploys actual
TokenJar/v3 sources and fixture tokens, and prepares transactions through the API.
Local scripts sign using encrypted disposable keystores. Receipts, balances,
refunds and recovery are asserted. The chain is stopped on exit; local manifests
and logs are ignored. `container-smoke` repeats transactions through a clean
non-root image, verifies restart persistence and rejects a wrong-chain runtime.
It uses `DOCKER_HOST`, or the task-local rootless socket when present.

## Frontend development

```sh
npm ci --prefix frontend --legacy-peer-deps
make web-dev
```

Open `http://localhost:5173`. The development proxy reads the existing Azure
Sepolia API. No private RPC URL or `.env` file is required in the frontend.
Only `VITE_API_URL`, a public HTTPS API URL, may be configured through
`frontend/.env.example`; the default uses a same-origin development proxy.

```sh
make web-check
# In a clean checkout, with contracts/ABIs built and .tools/ available:
bash scripts/web-local.sh
# In another terminal, while the Anvil browser demo serves on port 5174:
WALLET_TEST_NETWORK=local BROWSER_BASE_URL=http://localhost:5174 \
  npm --prefix frontend run test:browser -- wallet.spec.ts
```

The local runner owns a loopback-only chain and API, deploys the real contracts,
creates genuine local v3 observations and starts the browser app. Stop it with
Ctrl+C. Wallet integration tests sign through encrypted disposable keystores
in the Node test process; no private key is injected into the browser. These
tests do not substitute for manual MetaMask/Rabby extension checks.
Install the matching Chromium with `npx playwright install chromium` from
`frontend/`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an existing compatible
Chromium. Public browser checks use `make web-browser` with the dev server running.

With the local demo running, `npm --prefix frontend run validate:local` runs
the complete frontend gate and writes the ignored local validation evidence.
It starts a production preview if one is not already running.

`make deploy-web` requires the existing Azure resources and that successful
local validation evidence. It compiles the locked production bundle, packages
only static files and the non-root host, checks the image locally, publishes its
exact digest and adds the actual HTTPS frontend origin to the API's CORS list.
No RPC credential or signing key enters the frontend image.

## Sepolia contracts

```sh
make accounts
# In the ignored, mode-0600 .local/sepolia.env file:
# SEPOLIA_RPC_URL=your endpoint
CHAIN_ID=11155111 backend/node_modules/.bin/tsx backend/tools/sepolia-preflight.ts
make deploy-sepolia
```

Only the disposable public addresses in `deployments/accounts.json` should be
used for the fixture roles. Fund the operator and both buyers with faucet ETH.
`make accounts` creates encrypted keystores under `.local/keystores/`; the locally
generated password file is `.local/account-password`. Both stay outside Git and
outside the container. Do not place signing keys in the backend environment.

Public deployment asserts chain 11155111, records submitted hashes before waiting
for confirmation, and resumes confirmed stages from ignored pending state. The
30-minute oracle lookback uses real elapsed chain time. A fresh, nonzero in-range
liquidity mint writes a new observation after that history exists. Final public
manifests are written only after code, adoption and reference checks pass.

```sh
CHAIN_ID=11155111 backend/node_modules/.bin/tsx backend/tools/validate-manifest.ts
make oracle-status
make verify-sources
```

All tokens (including mREVIEW held for review), liquidity, buyers and the pool are
controlled fixtures. `make review-asset` adds the recorded review fixture to the
existing Sepolia deployment without replacing custody or sale contracts. Raw liquidity
minimum is `1000000000000`; max lot quantity is `100e18`; TWAP window 1,800s;
max observation age 600s; max deviation 100 ticks; discount 100bps; max direct lot
duration 7,200s. These are demo parameters. After idle time, the quote may refuse
stale history until another real in-range mint or swap updates observations.

## API

The service listens on `0.0.0.0:8080`. Configure `RPC_URL`, `EXPECTED_CHAIN_ID`,
and optionally `CORS_ORIGINS` (comma-separated exact origins; default permits no
browser origins). Public runtime assets are generated by
`python3 scripts/export-assets.py deployments/sepolia.json` and packaged into
the image. Production mode permits only Sepolia. Local container checks use
`NODE_ENV=test` explicitly with chain 31337. The deployed Azure configuration sets
`INGRESS_MODE=azure` to count client quotas using only the rightmost, Azure-appended
forwarded address. Direct/local servers ignore forwarded headers by default.

| Route | Purpose |
| --- | --- |
| `/healthz` | RPC-independent process liveness and source version |
| `/readyz` | Bounded, cached chain and deployed-code validation |
| `/v1/config` | Live roles, adoption, policies, active ID, liabilities, build version |
| `/v1/inventory` | Token metadata, current sale classifications, jar/escrow/accounted balances |
| `/v1/lots/:id` | Lot, frozen policy, currently permitted actions |
| `/v1/credits/:address` | Actual refund credit, payout balance and spender allowance |
| `/v1/lots/:id/quote` | Eligibility, refusal reason, payment, policy hash |
| `/v1/transactions/prepare` | Typed action simulation and unsigned calldata |
| `/openapi.json` | Request and response schemas |

Preparation is a POST with `action`, `sender`, and action-specific `params`. The
OpenAPI document lists every allowed action. Responses include chain/from/to/data,
zero value, simulation block, frozen hash and supplied limits. Targets come from
the validated manifest. Approval is limited to the configured payout/releaser and
the exact direct quote or proposed auction bid. The server never signs, sends,
stores signing keys, or accepts arbitrary calldata, targets or RPC URLs.

Current asset approvals and future direct policies are read from contracts; open
lots retain their frozen snapshots. The deployed contract supports one sale mode
per asset at a time (`capabilities.assetApproval: exclusive`). `HeldForReview`
assets have no allowed sale mode until the operator explicitly approves one.
Quote diagnostics distinguish stale observations, incomplete history, low liquidity
and excessive deviation; unavailable RPC data never becomes a fallback price.

Amounts are decimal strings in token base units. Reads carry their coherent
reference block. Reference refusals and jar rotation are business states;
refund/exit reads remain available. Simulation describes a particular block and
does not guarantee a later wallet transaction will succeed.

## Azure

```sh
make azure-plan
make deploy-azure
make smoke-azure
# Recheck saved receipts and platform behavior without signing more transactions:
make verify-azure
```

The default target is `unijar-demo-rg` in Central India on the selected Azure
subscription. Plan validates providers, region policy, quota, resource ownership,
current retail prices, Bicep and subscription what-if without provisioning.
Deployment requires real Sepolia smoke evidence, a successful local container
check and a matching source tree before it provisions resources.

Resources: Consumption environment, 0–1 API replicas at 0.25 vCPU/0.5GiB, Basic
ACR, scoped image-pull identity and Log Analytics with a 0.1GB/day ingestion cap.
Registry admin access stays disabled. RPC is passed through a protected temporary
secure-parameter file into a Container Apps secret, then the file is removed.
Signed transaction keys remain local. Images are commit-tagged and deployed by
digest; actual resource IDs, digest, revision and HTTPS URL are recorded only
after deployment.

Infrastructure explicitly selects `environmentMode: WorkloadProfiles` with one
Consumption profile through the 2026-07-01 environment API. Restoring an archived
environment can take 15–30 minutes; provisioning has a bounded 35-minute allowance.
After an interrupted cloud deployment, `make resume-azure` reuses the existing
published image only when its digest matches the previously tested local image,
its packaged Sepolia manifest matches, and the application source is unchanged.

Basic ACR's Central India retail rate checked on 2026-11-06 UTC was US$0.1666/day
(about US$5 per 30 days). Compute, logs, HTTP requests, transfer and an external
RPC may add charges. Free grants, student credit and taxes are not included in
that estimate. See the [official pricing](https://azure.microsoft.com/en-us/pricing/details/container-apps/)
and [Azure Retail Prices API](https://prices.azure.com/api/retail/prices).

Live smoke signs locally through the HTTPS preparation endpoint, verifies chain
outcomes, restarts the revision, and checks readiness, state persistence, CORS and
limits. Verification waits until the original replicas are gone before comparing
inventory. `verify-azure` rechecks the saved successful receipts and repeats
these platform checks without replaying signed transactions. Rollback is exercised
when a previous successful image exists. Results and remaining limitations belong
in [docs/VALIDATION.md](docs/VALIDATION.md).

Original app code is AGPL-3.0-only. Dependency licenses and source/tool pins are
described in [docs/SOURCES.md](docs/SOURCES.md). Passing the demo checks does not
constitute a production security audit.

### Receipt fees and service checks

`/fees` registers paid reference receipts on the selected test network. A
reference hash, payer and timestamp are recorded onchain; each payer/reference
pair can be charged once. The separate, noncustodial `ReceiptRegistry` transfers
the service fee to the original TokenJar and the remainder to the merchant.
The operator can then auction an exact quantity of collected fees for the
configured payout token. Receipt payment and sale settlement are separate
transactions; a receipt does not guarantee a sale or buyer.

The controlled deployment terms are explicit in
[config/receipt-service.json](config/receipt-service.json): a price of 10 mALT
and a 10% service fee, using the fixture token's 18 decimals. These are fixed
sample service terms, not market data. Runtime balances, receipt counts, total
fees and sale results come from the chain. Test-token minting is restricted to
the local operator tooling; the public API and browser cannot mint.

`fee-contracts/` is compiled and tested separately from the immutable deployed
sale and original Uniswap contracts. `make check` includes both suites.
`CHAIN_ID=11155111 backend/node_modules/.bin/tsx backend/tools/deploy-fee-source.ts`
deploys only this additional service, saves its transaction hash before waiting,
and pins its source commit, receipt, runtime hash and immutable terms in the
Sepolia manifest. Local fixture scripts deploy an independent Anvil instance.

`/status` reports the browser/backend builds, API liveness, chain/code readiness,
adoption and admission state independently. It retains links to credits and lot
lifecycle actions during failures. RPC transport batches block-pinned JSON-RPC
reads in groups of at most 20 and retries transient failures once, with an
8-second per-attempt timeout. A shared bounded queue starts at most four calls
per half-second by default (eight calls/second); production
`RPC_REQUESTS_PER_SECOND` accepts an explicit rate from 1 to 20. Up to 128
waiting calls are retained; overload fails honestly rather than growing an
unbounded queue. Identical reads share only a pending request; completed
results are never reused as a cache. Confirmed wallet receipts are displayed
before background refresh finishes, while additional writes remain locked.
Failure logs contain only a category, route
template and request ID; provider URLs, RPC messages and request bodies are
excluded. The browser applies a 25-second deadline even when a query supplies
its own cancellation signal. An HTTP 429 was observed from the configured provider during a burst of Sepolia
reads. The past Azure 503s lack detailed historical diagnostics, so that
observation does not establish the cause of every earlier failure.
