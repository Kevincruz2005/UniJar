# Testnet data and configuration

Public contracts and transactions use Ethereum Sepolia (`11155111`). Local
integration uses isolated Anvil (`31337`). Deployment/signing tools reject other
chain IDs. Production API startup requires the Sepolia manifest, and readiness
checks the RPC chain ID and deployed runtime code hashes. `/healthz` alone is
process liveness, not evidence of the upstream network.

## Where values come from

| Value | Source |
| --- | --- |
| Contract addresses, creation blocks, transaction hashes, code hashes | Confirmed deployment receipts and actual chain code, recorded in the public manifest |
| Roles, adoption, active lot, liabilities, asset modes and future policies | Contract reads at the API response block |
| Token name/symbol/decimals, jar/escrow balances, wallet payout balance and allowance | ERC-20 reads at the API response block |
| Lot quantity, expiry, winning bid, recipient and frozen policy | Stored onchain lot |
| Direct purchase amount | Contract `quoteDirect`, recomputed on fill using genuine v3 historical observations and integer discount arithmetic |
| Quote refusal details | Same-block contract/reader results checked against the lot's actual frozen policy |
| API build version | Generated from the source commit packaged into the image; separate from original contract-source provenance |

Missing RPC/metadata/code is an unavailable/error result. The service does not
substitute example balances, fallback prices or invented successful transactions.
Synthetic data in `backend/test/` is isolated unit-test input; native/Docker smoke
flows use real locally deployed contracts, and Sepolia/Azure smoke flows verify
actual public testnet receipts.

## Deliberately configured demo values

Deployment needs explicit parameters: operator/treasury, permitted assets,
reference pool/fee, TWAP lookback, freshness/liquidity/deviation/quantity bounds,
discount, initial pool price and test-token mint amounts. These are chosen demo
settings, not discovered market facts. Their recorded values remain visible in
the manifest and live policies. A hardcoded expected amount in a test is a test
vector; production pricing does not return that amount as a constant.

The mUSDC, mFEE, mALT and mREVIEW tokens are controlled ERC-20 test fixtures.
They are not mainnet USDC or market assets. The factory/pool and TokenJar were
self-deployed from pinned original Uniswap sources; they are not claimed to be
official Uniswap Sepolia deployments. Pool initialization deliberately sets a
demo starting price. Later quotes follow actual observations and safety gates,
not an independent market-price feed or an AMM swap.

Local funding and timestamp RPC methods are used only on Anvil. Public oracle
history and lot expiry require real Sepolia elapsed time; fixture maintenance
requires locally signed, confirmed testnet transactions. Idle oracle activity
can become stale and correctly refuse a fill. No automatic auction fallback
exists.

The deployed contract permits one sale method per asset at a time. The API
reports `capabilities.assetApproval = exclusive` and derives each current
classification from `assetModes`; it does not advertise dual approval. Existing
contract addresses and custody remain intact. Adding simultaneous approval for
both methods would require separately tested contract changes and deployment.

RPC credentials remain in ignored local configuration and an Azure secret.
Signing keys remain in local encrypted keystores/user wallets. The hosted API
only reads and simulates allowlisted unsigned transactions.

Azure rate limits use the validated rightmost address appended by managed ingress
only when `INGRESS_MODE=azure` is enabled. Caller-supplied prefixes are ignored;
other deployments default to socket addresses. Do not enable Azure ingress mode
on a server exposed directly to arbitrary clients. See Microsoft's
[ingress header contract](https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview).
