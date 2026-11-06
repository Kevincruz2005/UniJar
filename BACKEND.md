# UniJar backend specification

## Product

Sell exact batches of collected app fees for one payout token through either a funded auction or a guarded reference-priced buyer purchase. Record actual receipts; preserve refunds and recovery. The direct method does not automatically swap through its reference pool.

P0: one active single-asset lot, one approved direct asset, one approved auction asset, one payout token, one real TokenJar and one adopted custom releaser. Use plain exact-transfer ERC-20s. Buyers, liquidity, good execution and issuer-unrestricted transfers are not guaranteed.

## Source and compiler boundary

Reconstruct these public GitHub repositories into ignored `.deps/`; verify full commit SHAs and upstream submodules. Preserve their original licenses/notices. Use AGPL-3.0-only for original app code and retain the appropriate standard license text.

| Repository | Commit |
|---|---|
| `Uniswap/tjar` | `f7642c685c051badf3056c4d7e9ed4777222e1d9` |
| `Uniswap/v3-core` | `5ea68a77cb541c6b3812df783be71ba8c081e25f` |
| `Uniswap/v3-periphery` | `24ccf014fe7f81d74a14c1689d6fdf123f280e45` |
| `foundry-rs/forge-std` | `dc647cc030d9d65910d8f1172a0cde48d7106e32` |

Use Foundry v1.9.0 as the selected baseline. Main contracts/tests/scripts: Solidity 0.8.29/Cancun. Original v3 reader/factory graph: Solidity 0.7.6/Istanbul. Compile separately, then load old creation artifacts from the main tests/scripts. Do not port arithmetic by editing old pragmas or import forge-std into 0.7.6. Record tested optimizer/tool versions. Use Node 24, TypeScript, Fastify and viem for the API; lock the actual compatible package versions.

## Contract rules

- Immutable jar, treasury, operator, payout token, reader and expected factory; validate addresses/code. Treasury cannot be the jar/releaser. Inventory and payout tokens differ.
- One shared non-reentrancy boundary. Operator creates lots and future policies; anyone can execute permitted finalization/recovery. No proxy, arbitrary execution, administrative withdrawal of accounted funds or bidder loops.
- Exact intake: verify current adoption, read initial escrow balance, pull the jar's full selected-asset balance, retain the chosen quantity, atomically return observed surplus to the same jar, then verify/account the exact increase. Exclude pre-existing donations. Later deposits never enlarge a lot.
- Lot fields: unique ID, mode, asset, uint128 quantity, state, committed time, expiry, auction reserve/increment, highest bidder/recipient/amount and frozen policy hash/snapshot. One unresolved lot; old refund credits survive later lots.
- Auction: positive reserve and increment; first bid meets reserve, later bids meet highest plus increment with checked arithmetic. Transfer the entire new bid; replaced/self-outbid amounts become pull credits. Refund only the credited caller. Freeze accepted recipient; reject zero/jar/releaser recipients. No cancellation after a funded bid.
- At expiry, permissionless finalization either pays treasury and delivers inventory atomically or marks a no-bid lot unsold. Cancellation/unsold recovery returns only the exact quantity to the original jar. Failed transfers restore state/credits by reverting.
- Direct: freeze terms per lot; recompute price on fill; enforce expected policy hash, buyer maximum and buyer/lot deadlines. Transfer buyer payment directly to treasury, verify actual receipt and deliver exact inventory atomically. Reject treasury self-payment. A failed reference leaves the lot intact; auction conversion requires explicit recovery and a new approved lot.
- Admission pause stops new lots, bids and direct fills; refunds, permitted settlement, cancellation, expiry and recovery remain available. Jar rotation blocks new intake but cannot recall existing escrow.
- States: Open to Sold, or Open to Cancelled/Unsold to Recovered. Purchases/bids require time before expiry; finalization/expiration require time at or after expiry. Clear active ID only on Sold/Recovered. Validate existence and mode everywhere.
- Separately account highest bid, total refund credits, unresolved inventory per asset and direct payments. Payout escrow must cover bid/refund liabilities. Donations change balances, not claims. Check actual supported-token deltas rather than nominal transfer amounts.

Implement typed methods for asset modes, policy updates, pause, open/bid/finalize/cancel auction, withdraw refund, open/quote/fill/cancel/expire direct lot and recover. Emit IDs, frozen hashes, payment/delivery quantities and recipients. Contract access control remains authoritative; API preparation grants no authority.

## Reference policy

Freeze pool, fee identity, TWAP window, latest-observation age limit, minimum harmonic liquidity, maximum lot quantity, maximum spot/average tick deviation, fixed discount, maximum duration and version. Bind the full snapshot hash to chain, releaser, asset and payout.

Validate factory/pair and `factory.getPool`; buyers cannot choose a pool. Use original OracleLibrary consult/quote, correct token ordering, negative-tick rounding and uint128 quantity bounds. Gates reject incomplete history, stale configured observation, low liquidity, excessive deviation, reader errors and zero quotes. Compute tick differences in a wide signed type.

Payment is `ceil(referenceQuote * (10_000 - discountBps) / 10_000)` using full-precision integer arithmetic. Reader quantities/results are already token base units; do not divide by decimals again. Test both address orders and 6/18 decimals. Example fixture settings: 1,800-second window, 600-second observation-age limit, 100-tick deviation and at most 100-bps discount; these are not production security parameters. Explicitly set/test raw liquidity and quantity limits.

## Local and public chain setup

Use Anvil 31337 first. Deploy original TokenJar source and adopt your custom releaser; no stock factory/fee-controller deployment is required. Deploy actual v3 factory/pool, reader, restricted mint/swap callback fixture and three test tokens: mUSDC(6), mFEE(18), mALT(18). Initialize token0/token1 pricing correctly and seed recorded liquidity.

For Sepolia 11155111, deploy your own source-based environment, use faucet gas and encrypted local test accounts. Never assume official TJAR Sepolia addresses. Build the full lookback in real elapsed time, then perform genuine nonzero in-range liquidity activity and verify fresh observations. Capacity alone is not history; local time cheats do not work publicly.

Scripts must assert chain ID, reject mainnet, validate prerequisites, resume confirmed stages and export a compact public manifest: source commit, addresses, creation blocks, code hashes, roles/adoption, policy, compiler settings and actual transaction hashes. No placeholders presented as deployments. Label the pool/assets/buyers as controlled fixtures; verify source on the explorer where possible.

## API for the later frontend

| Route | Behavior |
|---|---|
| `GET /healthz` | Process liveness, independent of RPC |
| `GET /readyz` | Bounded/cached RPC, chain and required-code checks; 503 when unavailable |
| `GET /v1/config` | Chain, contracts, roles, live adoption status, public settings, source version |
| `GET /v1/inventory` | Configured assets and balances |
| `GET /v1/lots/:id` | Current state, frozen terms, next permitted actions |
| `GET /v1/credits/:address` | Actual refundable credit |
| `GET /v1/lots/:id/quote` | Direct payment/eligibility/reason, hash and reference block |
| `POST /v1/transactions/prepare` | Validate an allowlisted action, simulate from supplied sender, return unsigned transaction data |
| `GET /openapi.json` | Documented request/response schemas |

Preparation supports actual UniJar actions and exact payout-token approval only, with targets from the validated manifest. Return chainId/from/to/data/value, simulation block and relevant expected hash/limits. Never sign, broadcast, store a key, accept arbitrary targets/calldata/RPC URLs or expose a general RPC proxy. Signing happens locally for scripts and later in the frontend wallet.

Use decimal strings for bigint amounts and coherent block-tagged reads. Validate inputs, limit request size/rate, bound timeouts/log queries, redact RPC credentials and configure CORS for permitted future origins. No database, indexer, redis or background keeper is required. A reference refusal or jar rotation is reported as business state, not process death; preserve access to existing exit information.

## Required tests and Git hygiene

Prove actual jar intake, surplus return, late deposits, rotation, both sale methods, funded/outbid/self-outbid refunds, exact settlement, no-bid/cancel recovery, mode isolation, frozen policies, all reference gates, independent integer vectors, buyer bounds, unsupported transfers, pause, donations and callback protection. Use actual v3 source for one full direct flow; an independent stateful ledger checks liabilities and per-asset conservation across mixed actions.

API tests cover schemas, unknown IDs, sender/target/action restrictions, bigint serialization, wrong chain/code, RPC outage, business refusals and no signing/broadcasting side effects. Compare prepared calldata to actual contract encoding. Integration scripts call the API, sign locally and verify onchain receipt/balance outcomes.

Commit real milestones with their checks: dependencies/custody; auction/exits; oracle/direct; accounting; API; deployment; Azure/live tests. Keep secrets, `.deps`, node_modules, out/cache/broadcast, generated ABIs, raw logs and images out of Git. Track original source, necessary lockfiles, concise docs and compact real manifests. Preserve existing history; do not fabricate development activity.
