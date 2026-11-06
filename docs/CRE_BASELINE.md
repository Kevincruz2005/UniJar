# UniJar baseline before CRE

Checkpoint: `pre-cre-settlement-20261106`, commit
`33a0922` on `main`. CRE work is isolated on `feat/cre-settlement`.
The original tracked files and deployed contracts were unchanged during these checks.

| Check | Actual result |
|---|---|
| Foundry contracts | Passed: 27 original sale/oracle tests and 7 receipt-service tests |
| API, RPC transport and queue | Passed: 17 tests, typecheck and build |
| Frontend unit/server/build | Passed: 12 tests, typecheck and production build |
| Native and production container transactions | Passed: 16 each on Anvil, plus non-root/isolation, restart and wrong-chain checks |
| Production-preview pages | Passed on unchanged rerun: 8 checks |
| Local browser wallet scenarios | Passed: 6 scenarios, 27 Anvil transactions |
| Actual Sepolia code, roles, adoption and deployment receipts | Passed via `validate-manifest.ts` |
| Existing signed Sepolia evidence | Reconfirmed: 40 successful receipts, including the manual payment |
| Azure frontend/API liveness and readiness | Passed; versions match deployment manifests |
| Active sale slot | Read from chain: zero; no unresolved lot |
| Real MetaMask receipt payment | Previously user-reported and independently verified; evidence retained |
| Rabby, physical mobile devices | Unverified |
| CRE CLI simulation / live DON | Not run at baseline; no CRE deployment claimed |

The first production-preview inventory check timed out at 40 seconds. All
other page checks passed. The cause is unverified. A subsequent direct inventory
read returned HTTP 200 with four assets in 4993ms, and the complete unchanged
browser rerun passed. This initial failure is retained in
[cre-baseline.json](../deployments/cre-baseline.json); uninterrupted external RPC
or cloud availability is not guaranteed by passing regression tests.

Reproduction: `make container-smoke`, `make web-check`,
`bash scripts/web-local.sh`, then `npm --prefix frontend run validate:local`
with the configured Playwright Chromium executable. Public code/role checks:
`CHAIN_ID=11155111 backend/node_modules/.bin/tsx backend/tools/validate-manifest.ts`.

## Actual permission and lifecycle inspection

`contracts/src/UniJar.sol` exposes `finalizeAuction(uint256)` and
`recover(uint256)` without an operator modifier. Finalization requires an
expired Open auction. A funded winner receives the exact inventory and the
immutable treasury receives the bid. With no bid, finalization only changes
Open to Unsold; recovery is a second call returning the exact inventory to
the original immutable jar and freeing the active slot. Cancelled lots can
also be recovered. These exits remain available during admission pause and
jar adoption changes. Refund withdrawal belongs to each caller and is excluded
from the receiver.

The new receiver will target the existing Sepolia releaser
`0x64af2a1567ce1f0ebc84144542b945655980381d`. Its original source commit is
`62ab1501d04a1febfc51042951c9480f9bfd786f`. No releaser replacement, admission
gate, price-policy change, custody migration or CounterJar is planned.
