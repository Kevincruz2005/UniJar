# UniJar CRE settlement

This workflow services the existing, permissionless auction exits. It does not
open lots, change frozen terms, move refunds, or replace the adopted releaser.
CounterJar is excluded.

`src/workflow.ts` reads a pinned Sepolia block, checks the genesis hash, reads
`CRESettlementReceiver.readContext()` and the original `UniJar.getLot()`, obtains
real Sepolia Blockscout gas statistics and network identity through the HTTP
capability, and reaches consensus on their normalized fields. The portable
policy in `backend/src/cre-domain.ts` selects an exact exit or refuses/defers.
A report can invoke only `finalizeAuction` or `recover` through the restricted
receiver. No-bid auctions require two separate reports: Open → Unsold → Recovered.

Funded finalization takes priority over the nonurgent budget. A gas budget may
defer an unfunded exit until the maximum deferral age. Unavailable or implausible
data never becomes a zero-fee estimate. Manual wallet exits remain available.

## Build and unit tests

Pinned toolchain: CRE CLI **v1.39.0**, SDK **1.23.0**, Bun **1.4.4**, TypeScript
**5.9.3** (the SDK compiler uses its JavaScript compiler API). From the repository:

```sh
npm ci --prefix chainlink/cre-settlement
PATH="$PWD/.tools:$PATH" npm --prefix chainlink/cre-settlement run typecheck
PATH="$PWD/.tools:$PATH" npm --prefix chainlink/cre-settlement test
PATH="$PWD/.tools:$PATH" npm --prefix chainlink/cre-settlement run build
.tools/forge test --root cre-contracts -vv
```

The eight SDK tests use official capability mocks. They are **unit tests**, not
successful CLI simulations, DON runs, live HTTP evidence or onchain broadcasts.
The WASM build alone does not prove any of those execution modes either.

## External-data boundary

Allowlisted provider: [Sepolia Blockscout statistics](https://eth-sepolia.blockscout.com/api/v2/stats).
Identity: [Sepolia genesis block](https://eth-sepolia.blockscout.com/api/v2/blocks/0),
matched independently against the EVM capability. `gas_prices.average` is converted
from decimal gwei to wei with integer ceiling; a structured `average.wei` response
is accepted only as an explicit integer. The provider timestamp, network, units,
size, positive value and configured cap are checked. Two requests have eight-second
timeouts; there is no unbounded retry. Nodes must agree on normalized fee, timestamp
and genesis; changing or inconsistent responses fail safely.

`readContext()` supplies the EVM block's actual `block.basefee`, chain ID and target
code hash: SDK 1.23.0's header API does not expose base fee or `getCode`. An external
recommendation below base fee is refused; a recommendation over 100 times base fee
is prominently qualified. Sepolia recommendations can be far above a node's minimum;
these are conservative testnet native-fee estimates, with no dollar-savings claim.
The 650,000-gas policy constants are provisional conservative delivery bounds;
actual broadcast gas and their adequacy must be measured before acceptance.

## Trust and execution status

A simulation receiver trusts the exact verified **mock** forwarder and accepts no
production workflow identity configuration. A production receiver instead requires
all workflow identity fields and exactly 64 metadata bytes from the real forwarder.
Those trust modes cannot be changed after deployment. An operator circuit breaker
pauses only receiver automation. It cannot pause the original manual exits.

The API never signs, broadcasts, runs CRE, or stores a keeper key. Server gas reads
are ephemeral **advisory**, not signed CRE observations. Receiver events plus checked
receipts prove onchain execution, but a public mock-forwarder delivery alone does
not prove that the call originated in CRE CLI. Preserve the matching CLI trace and
independent transaction checks as separate evidence.

**No live DON deployment has been verified.** A CLI simulation, including a real
Sepolia broadcast, must remain labeled simulation-only. See
[baseline checkpoint](../../docs/CRE_BASELINE.md) for the preserved application.

## Reproduction and credentials

The eventual simulation helper generates private `project.yaml` and validated
`config.simulation.json` under ignored `.local/`; `workflow.yaml` defines only a
simulation target. Keep RPC credentials in ignored `.local/sepolia.env`. Authenticate
with `.tools/cre login` locally. Never commit credentials, keystores, WASM, dependencies,
raw logs or a project file containing a private endpoint. No backend execution API
is provided.

## Dependency limitation

The current official SDK pins Zod 3.25.76, which npm audit reports under
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
This workflow uses Zod only for small operator-controlled configuration, with no
collection schema. External HTTP responses use separate size-bounded validation.
No major-version dependency override is applied silently; upstream remediation is
still required. The SDK is a dependency under its own BUSL-1.1 license.

Official references: [configuration](https://docs.chain.link/cre/reference/project-configuration-ts),
[EVM SDK](https://docs.chain.link/cre/reference/sdk/evm-client-ts),
[forwarder directory](https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts),
[consumer authentication](https://docs.chain.link/cre/guides/workflow/using-evm-client/onchain-write/building-consumer-contracts).
