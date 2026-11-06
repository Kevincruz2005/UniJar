# UniJar

Backend for the ETHGlobal Mumbai 2026 controlled demo. UniJar sells exact batches
of fees held in the original Uniswap TokenJar through funded auctions or guarded,
v3-reference-priced direct purchases. The reference pool supplies a price; a
direct purchase transfers payment straight to treasury and does not swap.

The complete MVP requirements are in [PRD.md](PRD.md), including the next
wallet-connected frontend phase. [START.md](START.md), [BACKEND.md](BACKEND.md),
and [AZURE.md](AZURE.md) describe the validated backend baseline. No frontend has
been implemented yet. The [PRD gap assessment](docs/PRD-GAP-ASSESSMENT.md) separates
existing evidence from remaining full-stack acceptance work.

## Validation order and current status

1. Local application and Docker validation passed at `local-validated-v1` (`008d267`): 27 contract tests, six API tests, and 26 confirmed local transactions.
2. Existing Sepolia fixtures and 14 successful smoke transactions are recorded separately in `deployments/`.
3. Azure validation passed: 14 additional Sepolia transactions through the HTTPS API, restart persistence, readiness, CORS, request-size enforcement, log redaction and rate limiting. Live endpoints: [health](https://unijar-api.purplewater-5aec7560.centralindia.azurecontainerapps.io/healthz) and [OpenAPI](https://unijar-api.purplewater-5aec7560.centralindia.azurecontainerapps.io/openapi.json).

The main history was consolidated into substantial local-to-cloud milestones at
the user's request. Original history is retained on
`archive/before-local-first-rewrite`; the original deployed source is retained by
`deployment-source-62ab150`. Public manifests retain that original source SHA.
When publishing the repository, publish the deployed-source tag with `main` so
that provenance remains resolvable. No remote history has been force-pushed.

## Hackathon provenance

The selected track is Classic / From Scratch. [AI use and original history](docs/AI-USAGE.md)
are disclosed explicitly, including the prior history consolidation. Original
commits remain on `archive/before-local-first-rewrite`. Track eligibility and
meaningful human contributions are not certified by passing tests or Git dates.

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

## Sepolia

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

All tokens, liquidity, buyers and the pool are controlled fixtures. Raw liquidity
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
`NODE_ENV=test` explicitly with chain 31337.

| Route | Purpose |
| --- | --- |
| `/healthz` | RPC-independent process liveness and source version |
| `/readyz` | Bounded, cached chain and deployed-code validation |
| `/v1/config` | Public manifest, current adoption, admission pause |
| `/v1/inventory` | Configured assets/payout, jar balances, escrow and liabilities |
| `/v1/lots/:id` | Lot, frozen policy, currently permitted actions |
| `/v1/credits/:address` | Actual refund credit |
| `/v1/lots/:id/quote` | Eligibility, refusal reason, payment, policy hash |
| `/v1/transactions/prepare` | Typed action simulation and unsigned calldata |
| `/openapi.json` | Request and response schemas |

Preparation is a POST with `action`, `sender`, and action-specific `params`. The
OpenAPI document lists every allowed action. Responses include chain/from/to/data,
zero value, simulation block, frozen hash and supplied limits. Targets come from
the validated manifest. Approval is limited to the configured payout/releaser and
the exact direct quote or proposed auction bid. The server never signs, sends,
stores signing keys, or accepts arbitrary calldata, targets or RPC URLs.

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
inventory. `verify-azure` rechecks the saved 14 successful receipts and repeats
these platform checks without replaying signed transactions. Rollback is exercised
when a previous successful image exists. Results and remaining limitations belong
in [docs/VALIDATION.md](docs/VALIDATION.md).

Original app code is AGPL-3.0-only. Dependency licenses and source/tool pins are
described in [docs/SOURCES.md](docs/SOURCES.md). Passing the demo checks does not
constitute a production security audit.
