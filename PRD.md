# UniJar — Complete MVP Product Requirements Document

**Version:** 1.0 — 6 November 2026  
**Document type:** Standalone, full-stack MVP PRD  
**Project:** UniJar (the two-lane, exact-lot TokenJar fee-inventory sale product formerly described as LaneJar)  
**Target network:** Ethereum Sepolia (chain ID `11155111`); Anvil (`31337`) for local integration  
**Status:** Product specification, **not** a statement that any implementation, contract deployment, Azure service, or user flow has passed verification  
**Primary delivery:** A working, wallet-connected, browser-accessible Sepolia demo backed by real smart contracts and a noncustodial HTTPS API  
**Explicit exclusion:** No CounterJar implementation or integration

## 0. How this PRD applies to the project already started

This is **the complete MVP scope**, including the previously specified contracts/API/cloud backend **and** the previously deferred wallet-connected frontend. It is not an instruction to discard or restart work completed under the earlier `START.md`, `BACKEND.md`, and `AZURE.md` specifications.

When continuing implementation:

1. Inspect the actual repository, deployed manifests, transaction receipts, tests, and live endpoints; determine what really works before changing anything. Do not infer completion merely because an earlier Codex prompt was executed.
2. **Reuse and preserve** correct existing contract, API, Docker, Sepolia, Azure, configuration, tests, commit history and license work. Fix omissions or failures; do not rebuild working pieces without a reason.
3. Implement the remaining MVP features, especially the frontend, wallet signing, complete user journeys and integrated browser tests. Do not introduce a second custody/releaser system.
4. Record each acceptance criterion as **passed / failed / blocked / not tested**, with reproducible evidence. Never invent addresses, transaction hashes, URLs or successful results.
5. If actual deployed code or API behavior differs from this PRD, document the discrepancy and reconcile it explicitly. The deployed contracts remain the source of truth for the live demo; neither the UI nor API may silently bypass them.

The former LaneJar PRD is the conceptual baseline: exact-lot custody, explicit asset policy, reference-priced direct purchases and funded English auctions, with recovery and safe refusal. The name in the user interface and repository should be **UniJar**.

## 1. Product definition

### 1.1 Problem

Apps and protocols can collect fees in multiple ERC-20 tokens while needing one operating/treasury payout token. Selling accumulated inventory is not always straightforward: some supported assets have an acceptable onchain price reference, while others need a discretionary auction or must not be offered at all. Operators also need clearly bounded custody, transparent proceeds, bidder refunds and reliable exits when no sale happens.

### 1.2 Product promise

UniJar lets an authorized operator commit an **exact, single-asset batch** of tokens already held in a real Uniswap TokenJar and sell that batch for one approved payout ERC-20 using **one explicitly selected method**:

- **Direct lane:** A buyer purchases the *entire* batch at a contract-checked price derived from a designated Uniswap v3 TWAP reference, subject to frozen policy safeguards and the buyer's payment limit.
- **Auction lane:** Buyers fund competitive English-auction bids; the winning funded bid pays the treasury after expiry; unsuccessful bidders withdraw their own refundable credits.

The buyer receives actual tokens, the treasury receives actual payout tokens, and unsold/cancelled inventory has a defined return path to the **original TokenJar**.

**Not promised:** automatic swapping via the reference pool, automatic best-route selection, constant liquidity, a ready buyer, fair-market execution, market-price accuracy under all conditions, supported handling of arbitrary tokens, or production security certification.

### 1.3 Intended outcomes

- An authorized operator can classify configured inventory, create a permitted lot and understand its locked terms.
- A wallet-connected user can find a lot, determine eligibility, approve the right payout-token amount, buy or bid, and independently verify the resulting onchain transaction.
- A bidder can reclaim outbid funds, including credits surviving subsequent lots.
- An operator/user can settle or recover an expired lot as permitted **without depending on a backend keeper or the original operator remaining online**.
- Unsafe direct references cause a clear refusal rather than a fabricated price or an automatic auction fallback.

### 1.4 Evidence and value hypothesis

The project demonstrates a technically usable fee-inventory sale system; it does not establish customer demand, lower execution costs or improved realized proceeds. For a commercial claim, compare actual net treasury proceeds against a matched alternative, accounting for gas, waiting time, reference quality and actual buyer interest. The Sepolia fixture is a controlled demonstration, not live-market demand evidence.

## 2. Users, roles and permissions

| Role | MVP capabilities | Enforcement |
|---|---|---|
| Visitor | Browse configured inventory, active/past lot details and sale/refusal status without a wallet | Public reads |
| Wallet-connected buyer | Connect/switch to Sepolia; view payout balance and allowance; buy an eligible direct lot, bid, and withdraw personal credits | User wallet signs; contracts decide |
| Operator wallet | Maintain future asset/direct-sale policies; open permitted lots; pause new admission; cancel eligible lots | Onchain operator authorization |
| Jar owner/administrator | Adopt the one custom UniJar releaser during setup; inspect adoption/rotation status | Actual TokenJar owner permissions |
| Treasury | Receive verified sale proceeds in the designated payout token | Immutable destination enforced onchain |
| Anyone | Execute contract-permitted permissionless finalization, expiry and recovery | Contract state and time restrictions |

Do **not** interpret seeing an operator button in the UI as granting operator authority. The connected address must be checked against live roles, and every transaction must still be rejected by the contract when unauthorized.

## 3. Non-negotiable P0 constraints

| Dimension | MVP limit |
|---|---|
| Custody | One real TokenJar, one adopted UniJar releaser; do not substitute a mock custody path for the final demo |
| Active inventory | At most **one unresolved** lot at a time; unique ID for every lot; lots are single-asset and exact-quantity |
| Assets | At least one approved direct asset and one approved auction asset; one payout ERC-20; also show one configured held-for-review asset |
| Tokens | Plain exact-transfer ERC-20s; fee-on-transfer, rebasing, restricted/hostile behavior unsupported |
| Sales | Whole-lot direct purchase or fully funded fixed-end English auction; no partial fill |
| Reference | One operator-approved **canonical Uniswap v3 pool** for the direct asset/payout pair; genuine historical observations |
| Direct execution | Buyer-to-treasury token payment and inventory delivery atomically; **no AMM swap** |
| Auction execution | Fully escrowed bids, pull refunds, expiry settlement and no-bid recovery |
| Chain | Local Anvil and real Sepolia; **no mainnet** |
| API | Read endpoints and allowlisted **unsigned** transaction preparation; no custody or signing keys |
| Web app | Responsive desktop/mobile browser experience with injected EVM wallet support |
| Cloud | Previously specified Azure-hosted HTTPS API, plus a deployed HTTPS frontend |
| Data | Onchain contracts are authoritative; no mandatory database, indexer or background worker |

### 3.1 Explicit asset classification

The operator assigns each **configured token address** exactly one current sale method (`DirectApproved` or `AuctionApproved`); unsupported assets remain held for review.

| Classification | Allowed action | If unavailable |
|---|---|---|
| `DirectApproved` | Open direct lot under approved pool/reference policy | Ineligible quote/fill; retain lot and allow permitted cancellation/recovery |
| `AuctionApproved` | Open funded English-auction lot under explicit reserve/increment/expiry | No-bid lot becomes unsold/recoverable |
| `HeldForReview` | Display configured jar balance and caution/explanation | **No** new sale or automatic movement |

The deployed immutable MVP stores one exclusive mode per asset; simultaneous dual approval is outside this deployment. The operator may update the future mode after closing and recovering an existing lot. A failed direct quote must **never silently switch** to auction, change price/reserve or move inventory. To use another permitted mode, close/recover the original lot first and open a **new** lot. Removing future approval must not erase existing bidder credits or enable confiscation. “Held for review” means configured addresses only: TokenJar does not supply an automatically enumerable list of every token ever deposited.

## 4. Core objects and lifecycle

### 4.1 Configuration

Public chain ID, verified contract addresses/code hashes, TokenJar adoption/roles, payout token, supported assets/modes, reference pool/fee/factory, policy versions, treasury and the current public build version must be visible via API and relevant UI. The frontend must use the **validated deployment manifest**, not hardcoded guesses or arbitrary user-supplied contract targets.

### 4.2 Lot

A lot stores: unique ID; mode; asset and `uint128` quantity in token base units; originating jar; created/expiry time; frozen policy snapshot/hash; current state; and, for auctions, reserve, minimum increment, highest funded bidder/recipient/amount. Store/emit actual transfers and recipients. Future jar deposits and unrelated donations **never enlarge** a committed lot.

**State transitions:**

- Direct: `Open → Sold`, or `Open → Cancelled → Recovered`, or `Open → Unsold/Expired → Recovered` as supported by the deployed contract's actual explicit state model.
- Auction: `Open → Sold` on successful eligible expiry settlement, or `Open → Unsold → Recovered`; pre-funded cancellation is permitted only if the contract allows it. **Funded auctions cannot be cancelled.**
- Only `Sold` or `Recovered` clears the active-lot slot. Old refund credits remain claimable after that slot is cleared.

The frontend must display the **actual deployed state names**, not invent a state-changing action merely because the UI label sounds convenient. At or after expiry, buying and bidding must stop; permissionless finalization/expiry/recovery actions become available according to contract rules.

### 4.3 Money and liability separation

Differentiate jar inventory, lot escrow, winning bid liability, credited refunds, direct treasury payments and unsolicited donations. Payout escrow must cover accepted bid plus refund liabilities; credits are withdrawable **only by their owner**. Refunds are pull-based, not loops over bidders. Exact amounts must use token-base-unit math and measured token deltas, not floating-point approximations or displayed decimals.

## 5. Functional requirements and user journeys

### F-01 — Public dashboard and inventory

**Surface:** `/` and `/inventory`.

- Display product purpose, Sepolia/demo environment, current chain health, active lot with mode/status, configured balances in TokenJar and where applicable amounts reserved in the lot, and payment token.
- Display configured token address, symbol, decimals and asset policy. Mark fixture tokens as **test tokens**; label `HeldForReview` clearly, not “worthless.”
- Distinguish jar balance from escrow balance; show correct value after late jar deposits or token donations.
- Provide clear routes to active lot, wallet refunds and authorized operator console.
- A disconnected wallet must still be able to read all public information. RPC/API outage shows a clear unavailable/stale state, not zeros.

**Accept:** Inventory reads agree with chain state for the displayed block; held asset has no sale call-to-action; late deposits never change the live lot amount.

### F-02 — Connect wallet and select network

**Surface:** Persistent header/navigation, wallet panel.

- Connect/disconnect EVM wallet using **wagmi + viem**, with a small compatible wallet UI (RainbowKit is acceptable). Support injected wallets such as MetaMask and Rabby. WalletConnect QR is optional if a legitimate project ID is configured; do not label it supported unless tested.
- Show shortened address, wallet availability, active chain, relevant mUSDC/other payout balance and allowance when connected.
- Prompt for a user-approved switch to **Sepolia 11155111**; never sign when the connected network is wrong. No auto-signing, private-key import, hosted custody or silent chain switch.
- Wallet state and displayed permissions update after account/chain changes and reloads. Addresses must not be treated as authentication secrets.
- Show a readable pending → confirmed/reverted/failed transaction lifecycle with chain explorer link and refreshed onchain state.

**Accept:** Two different injected wallets/accounts work in a manual test; wrong-chain operation is blocked; no private key enters app/backend logs.

### F-03 — Operator configuration and adoption visibility

**Surface:** `/operator` (only write controls for actual authorized operator).

- Show real TokenJar address, adopted releaser and current owner/operator/treasury/payout roles, pause status, configured asset policies and direct reference parameters.
- Adoption itself may have been done through an existing privileged script/owner wallet. The MVP must **show adoption status**, but need not create a new public adoption method or generic arbitrary-contract UI.
- Allow supported onchain operator actions: choose/update permitted future asset policies, pause/unpause admission, open a direct or auction lot and permitted cancellation. Use only actual contract/API supported ABI calls.
- Separate immutable deployment parameters from operator-updatable policies; never expose a fake “edit treasury” control.
- Prevent opening a new lot while another unresolved lot exists; show why an action is unavailable.

**Accept:** An unauthorized wallet cannot execute a write; changes to future policies do not mutate open lot terms; jar rotation blocks new intake but preserves existing exits.

### F-04 — Exact lot creation

**Surface:** `/operator/new-lot` or modal in `/operator`.

- Select a configured sale-approved asset; show its current exclusive `Direct` or `Auction` mode and validate active-lot status. Changing the future mode is a separate operator transaction.
- Display current TokenJar inventory, required quantity, exact token units, immutable destination, expiry and frozen terms before wallet confirmation.
- Onchain intake verifies current adoption, pulls the jar's full selected-asset balance as necessary for the real releaser integration, retains exactly the committed quantity, returns observed excess to the **same jar** atomically, and excludes pre-existing donations from lot accounting.
- Support positive quantities within approved bounds; never treat a future jar deposit as additional committed inventory.
- The operator signs the transaction with their wallet; the app displays returned lot ID/hash/receipt and refreshes.

**Accept:** Real jar custody path works, observed surplus is returned, one active lot restriction holds, and actual balances match the created lot.

### F-05 — Direct-lane quote and complete purchase

**Surface:** `/lots/:id` when mode is Direct.

- Display exact available quantity and asset, payout token, reference pool (as a reference **not a swap route**), TWAP window, fixed discount, expiry and quote status/reason.
- Read the approved v3 pool using the actual original Uniswap v3 reference; validate factory/pair/fee identity, full history, bounded age of latest configured observation, sufficient harmonic liquidity, maximum spot/TWAP deviation, maximum lot quantity and nonzero quote.
- Compute base-unit reference quote correctly for either token-address order and 6/18 token decimals, including negative-tick rounding and full-precision integer discount rounding:

  `payment = ceil(referenceQuote × (10,000 − discountBps) / 10,000)`

- Buyer chooses a supported recipient, sees estimated payout amount and configured maximum-payment protection (no unlimited slippage by default), then approves **only the required payout-token spend** to the validated spender if allowance is insufficient.
- Next, buyer signs the prepared **fill** with lot ID, expected policy hash, maximum spend and deadline. Contract **recomputes** the reference in the execution transaction; a preview is **not** a guaranteed reservation.
- Successful purchase atomically verifies actual buyer payment **directly to treasury** and exact inventory delivery to recipient; UI verifies transaction receipt and updated chain balances. Treasury self-payment and invalid recipients must be rejected.
- When reference fails or terms move, show the precise business refusal (stale/incomplete history, liquidity, deviation, policy mismatch, expiry, balance, allowance, max bound, chain outage). Existing lot remains intact; never silently create an auction.

**Accept:** At least one genuine local v3 full flow and one real Sepolia direct purchase; bad-reference and buyer-maximum refusals are evidenced. Browser shows both success and refusal honestly.

### F-06 — Auction-lane bids, refunds and settlement

**Surface:** `/lots/:id` when mode is Auction; `/wallet/credits`.

- Show lot quantity, reserve, minimum increment, actual highest amount, recipient, expiry and current user refundable credit. Do not present a fixed-end English auction as a CCA auction.
- Validate first bid >= reserve; subsequent bids >= highest + increment; require full fresh bid funding and the user's explicit recipient.
- If payout-token allowance is too low, request precise approval to the validated spender before bidding. Pending transactions must not be shown as winning bids until confirmed.
- On outbid **or self-outbid**, previous bid becomes separately withdrawable credit. Each credited wallet can withdraw **its own** refundable amount even if the lot is now Sold or another lot has opened.
- Funded auction cannot be cancelled. At expiry, anyone can call permitted finalization; successful finalization atomically sends payout to treasury and exact lot inventory to the frozen winning recipient.
- If there was no bid, expire/finalize to unsold state and return exactly that lot inventory to the original TokenJar through the permitted recovery call. Show distinct UI for “no bidders,” “has funds,” “finalize now” and “recover.”
- Contract failures revert the whole operation; no automated refund enumeration, keeper or trusted backend signer is required.

**Accept:** Real bid, outbid, self-outbid, credit withdrawal, funded settlement and no-bid recovery are all demonstrated; amounts match independent onchain state.

### F-07 — Lot details, historic access and recoveries

**Surface:** `/lots/:id`, accessible for previously known IDs even after a new lot opens.

- Always show mode, asset, frozen terms and policy hash, status, expiry, actual settlement/recovery results and next permissible actions from contract state.
- Provide canceled/expired direct-lot exit and unsold-auction recovery where the contract permits. Pause must not block authorized refunds, settlement, cancellation, expiry or recovery.
- In a stale quote or jar-rotation situation, maintain access to existing lot and credits rather than treating the entire product as unavailable.
- MVP does **not** require a general historical event indexer; recent/known IDs can be navigated from the current ID, explicitly entered ID, or bounded chain/API enumeration only if actually implemented. Do not claim comprehensive history if it is absent.

**Accept:** No withdrawal, settlement or refund is hidden solely due to app admission pause; a former bidder can access credit after a later lot opens.

### F-08 — Transaction preparation and signing separation

- Reuse the existing Fastify/viem API for known reads and **allowlisted** unsigned prepare operations. It must return the correct chain ID, `from`, manifest-derived `to`, calldata, zero/native value where applicable, simulation/reference block and relevant expected IDs/hashes/limits.
- The web application validates connected chain/addresses, shows transaction intent, obtains user approval and signs/broadcasts through the user wallet only. Where supported, simulate again from the connected account immediately before asking the wallet to send.
- Server/API never accepts a private key, signs, broadcasts on behalf of the wallet, allows arbitrary transaction targets/calldata/RPC URL or becomes a generic transaction relay.
- Allow **actual** UniJar methods plus exact payout-token approvals. If an operator method is missing from the API, add it only with explicit schema, allowlist and simulation tests; do not work around controls with arbitrary calldata.
- Display explorer links based on the validated target chain; after each receipt, re-fetch the contract's authoritative state.

**Accept:** Prepared calldata matches contract encoding; attempts at an arbitrary target/action are rejected; no backend signing/broadcasting side effects.

### F-09 — Service and degraded-state UI

**Surface:** `/status` or footer status popover; every transaction screen.

- Show browser build version, backend health/readiness, target chain, manifest/code mismatch, adoption status and configured explorer/network.
- `/healthz` means process liveness, **not** proof the RPC is correct; `/readyz` must fail when critical RPC, chain or code checks fail.
- Handle wallet absent, wrong chain, denied signatures, pending confirmations, changed prices, unknown lot, failed token transfer, insufficient faucet ETH, insufficient allowance, frozen lot, paused admissions, backend rate-limit, RPC unavailability and Azure cold start.
- Business refusals (including invalid TWAP or revoked jar adoption) are meaningful state, not reason to falsify a process crash or a successful quote.

**Accept:** All failures are honest, explain the next possible action and preserve access to refunds/exits when possible.

## 6. UI and navigation specification

**Required browser views (may be consolidated into fewer pages without losing features):**

| View | Minimum visible elements | Main interaction |
|---|---|---|
| Landing / dashboard | Product explanation; Sepolia badge; active lot summary; both modes; connected wallet; service status | Browse or connect |
| Inventory | Configured tokens; TokenJar balance; escrow separately; classification and availability | Navigate to lot / operator |
| Lot detail — Direct | Quantity, frozen policy, reference status/quote, expiry, treasury, allowance/balance, purchase form | Approve then buy |
| Lot detail — Auction | Reserve, highest bid, increment, expiry, recipient, bidder credit, settlement state | Approve, bid, settle, recover |
| Operator console | Role/adoption display, active slot, configured policies, pause, lot creation/cancellation | Sign authorized writes |
| My refunds | Connected address, each claimable credit (or truthful aggregate), exact amounts and receipt state | Withdraw |
| Status/help | Public chain/contract/API links, known limitations, how test tokens/ETH are obtained | Diagnose blockers |

**Presentation requirements:** mobile-responsive; readable short explanations of both sale modes; explicit network and test-token labels; distinguish **preview / pending / confirmed / refused**; show quantities without losing bigint precision; text alternatives to color; keyboard-operable controls; clear inline confirmations of wallet actions. Avoid polished visuals that obscure genuine safety or test status. No authentication beyond wallet connection is necessary for this public demo; wallet address is not a substitute for onchain authorization.

## 7. Technical architecture and compatibility

```text
Browser (responsive UI; wagmi / viem; injected wallet)
  ├── public reads / unsigned prepares ──> Azure HTTPS Fastify API
  │                                          ├── Sepolia RPC (secret stored in Azure)
  │                                          └── validated chain/deployment manifest
  └── wallet-signed transactions ──────────> Ethereum Sepolia
                                               ├── Real TokenJar (adopted releaser)
                                               ├── UniJarReleaser (both modes)
                                               ├── V3ReferenceReader
                                               ├── Actual Uniswap v3 pool/factory
                                               └── approved ERC-20 fixture tokens
```

### 7.1 Existing backend baseline to preserve

- Existing intended source boundaries: `Uniswap/tjar` commit `f7642c685c051badf3056c4d7e9ed4777222e1d9`; `Uniswap/v3-core` `5ea68a77cb541c6b3812df783be71ba8c081e25f`; `Uniswap/v3-periphery` `24ccf014fe7f81d74a14c1689d6fdf123f280e45`; `foundry-rs/forge-std` `dc647cc030d9d65910d8f1172a0cde48d7106e32`.
- Previously selected build targets: Foundry `1.9.0`; core Solidity `0.8.29`/Cancun; separate original v3 Solidity `0.7.6`/Istanbul artifacts; Node 24, TypeScript, Fastify and viem. Preserve actual compatible dependency locks and record actual versions tested. Do **not** rewrite historical v3 math or pragmas just to unify compilation.
- Immutable jar/treasury/operator/payout/reference/factory deployment authority, shared non-reentrancy, real TokenJar adoption, frozen policy hash bound to chain/releaser/asset/payout, genuine OracleLibrary quote/consult semantics, full-precision arithmetic, atomic exact-token transfers and accounting invariants.
- Local Anvil with original TokenJar, factory/pool, liquidity/swap fixture and mUSDC (6 decimals), mFEE (18), mALT (18). Sepolia deployment **must not claim official Uniswap TokenJar addresses unless independently verified**; the intended fixture is self-deployed from the original source.
- A real 1,800-second TWAP history, 600-second latest-observation age bound, 100-tick maximum deviation and 100-bps maximum discount were **example fixture controls only** in the earlier build specification—not production safety guarantees. Preserve explicitly tested liquidity and lot size thresholds. Creating pool observation capacity does not create elapsed history on Sepolia.

### 7.2 Required API surface

| Endpoint | Contract with frontend |
|---|---|
| `GET /healthz` | Liveness independent of upstream RPC |
| `GET /readyz` | Bounded chain/RPC/code readiness; nonready status when invalid |
| `GET /v1/config` | Chain ID, public manifest/roles/adoption/settings/build |
| `GET /v1/inventory` | Configured assets, jar balances, policy status, compatible amount fields |
| `GET /v1/lots/:id` | Authoritative lot and frozen terms/current next actions |
| `GET /v1/credits/:address` | Actually refundable amounts |
| `GET /v1/lots/:id/quote` | Eligibility and reference reason, amount/hash/block when eligible |
| `POST /v1/transactions/prepare` | Only validated allowlisted action with sender and constrained parameters; unsigned simulation result |
| `GET /openapi.json` | Auditable request/response contract |

Avoid breaking already deployed client/API behavior; extend documented schemas only when needed for policy classification, frontend readability or missing allowlisted methods. Bigint fields are **decimal strings**, never unsafe JS numbers. Publicly expose only necessary config; keep RPC credentials and encrypted signing keys out of repo, API responses and browser bundles.

### 7.3 Hosting and integrations

- **Onchain:** Sepolia smart contracts; local chain only for development. Account signing keys are local user wallets/disposable encrypted testing accounts, never placed on Azure.
- **Backend:** Existing intended Azure Container Apps HTTPS endpoint with non-root Docker image, managed secrets, proper health/readiness and validated Sepolia manifest. Do not replace a working deployment merely to alter visual presentation.
- **Frontend:** New separate **HTTPS** deployment (for example Azure Static Web Apps for a client-rendered/static Next.js build, or another reproducible supported host). Pick one and document actual deploy commands and URL. Do not require server-side rendering for MVP; if using Next.js, ensure the chosen build mode is supported by the selected host.
- **CORS:** Allow the actual frontend origin(s) in the API configuration; do not use indiscriminate cross-origin access where credentials might be exposed. Only public blockchain addresses/ABIs/env-safe values reach browser builds.
- **No indexer/DB/keeper:** Fetch bounded live chain reads and sufficient historical lot IDs for the demo. Do not invent indexed history or autonomous auction settlement.

## 8. Security, correctness and operational requirements

1. **Authorization and fund movement:** Immutable roles/destinations as implemented; only operator updates policies/opens lots; no arbitrary execution, no admin escape hatch for accounted funds, no arbitrary approval spender or transaction target.
2. **Atomic settlement:** Actual treasury receipt and exact asset delivery, or revert everything. Verify before and after balances; unsupported token semantics reject rather than underpaying recipients.
3. **Refund isolation:** Outbid/self-outbid credits separately reserved, withdrawable only by their owner and preserved across new lots; payout balance covers outstanding liabilities.
4. **Frozen policy and race protection:** Full hash snapshot and buyer bounds, deadlines, actual execution-time direct quote; no frontend-only access control.
5. **Reference safety:** Pool/factory/pair verification, correct address order, 6/18 decimals, valid OracleLibrary arithmetic/history and explicit freshness/liquidity/deviation gates. A v3 TWAP is not an independent external oracle or proof of manipulation immunity.
6. **Denial/failure handling:** Pause only new admissions; maintain exits. Failed RPC/reader leaves lot unchanged. Reference failures never auto-switch modes.
7. **Web safety:** User-signed only; test against wrong chain, wallet change mid-flow, rejected wallet prompt, stale quote, spender mismatch, approval race, double clicks and display precision errors.
8. **Infrastructure:** No publicly exposed Anvil, secretless browser bundle, bounded API rates/timeouts/log queries, redacted logs, repeatable Docker/cloud builds, Azure warm/cold start checks. Protect upstream RPC credentials in cloud secrets.
9. **Supply-chain/Git:** Preserve upstream copyright notices/licenses, keep app's selected AGPL-3.0-only license, pin source revisions, track lockfiles, exclude `.deps`, generated builds/ABIs where appropriate, private keys, `.env`, raw logs and cloud credentials. Meaningful real commits; do not fabricate results.
10. **Financial qualification:** Sepolia demo is not a security audit, production deployment, live-market proof or guaranteed sale. Do not market it as such.

## 9. Explicit out-of-scope items

**Not part of this MVP:** CounterJar; Uniswap CCA backend; permissionless automatic auction fallback; multi-lot concurrency; partial fills; arbitrary asset swaps through a router; autonomous agents; Chainlink integration; bridges/cross-chain; mainnet deployment; upgrades/proxies; onchain governance; multiple payout currencies; interest/yield generation; future-fee sales; price ramps/age-based discounts; generic token support (tax/rebasing/hook-heavy); fake buyer demand; keeper bots; account-password login; full historical indexing/database; production audit; guaranteed PnL, market depth or execution quality.

A later release can consider those separately. Do **not** add any as a dependency for claiming the present MVP is complete.

## 10. Acceptance test matrix and definition of done

| ID | Acceptance evidence required | Layer |
|---|---|---|
| A-01 | Original-source TokenJar deployed, releaser actually adopted, correct owner/operator roles and code hashes shown | Onchain/setup |
| A-02 | Exact intake/return of surplus, late jar deposit isolation, donations/rotation boundaries tested | Contract |
| A-03 | One unresolved lot, frozen policy, state transitions, expiry boundaries and role restrictions tested | Contract |
| A-04 | Direct fill using actual v3 source/history; amount/rounding/decimals/token-order test vectors and all refusal gates | Contract/oracle |
| A-05 | Actual direct payout to treasury and exact delivery, plus rejected buyer maximum/policy mismatch/unsafe quote | Contract/testnet |
| A-06 | Funded auction, outbid, self-outbid, independent refunds, no-bid recovery and funded settlement | Contract/testnet |
| A-07 | Independent stateful liability/conservation model; pause/reentrancy/unsupported transfer checks | Contract |
| A-08 | API schemas/typecheck/contract encoding and allowlist checks; wrong-chain/RPC-outage/readiness behavior | API |
| A-09 | Clean Docker build, actual Azure API HTTPS endpoint, version/chain/code validation, live prepare-and-verify flows | Cloud |
| A-10 | Frontend browser reads inventory/lot without connected wallet; configured held asset not offered for sale | UI |
| A-11 | Injected wallet connect/disconnect/account change/Sepolia switch; wrong-chain tx blocked | UI/wallet |
| A-12 | UI performs allowance → signed direct fill; Sepolia receipt, treasury amount and buyer asset balance checked | End-to-end |
| A-13 | UI performs allowance → bid/outbid → refund → expiry settlement, with actual transaction links/balance checks | End-to-end |
| A-14 | UI performs no-bid recovery and an unsafe direct quote refusal without fallback or false success state | End-to-end |
| A-15 | Operator controls shown only to authorized address; unauthorized writes rejected by chain | UI/contract |
| A-16 | HTTPS frontend production build, verified CORS, responsive layout and wallet-safe secrets check | Release |
| A-17 | Documentation includes source/commit IDs, verified manifest, contract addresses, frontend/API URLs, test commands, passed/failed/blocked items, executed tx hashes and known gaps | Handoff |

**MVP is complete only when:** both sale methods work end-to-end with wallet signatures and genuine Sepolia onchain outcomes, refunds/recovery/unsafe-refusal are demonstrated, and the deployed browser UI talks to the validated API/contracts. A successful build, endpoint response, faucet funding, or a local mocked test alone does not meet this bar. If external prerequisites block a gate, mark it **blocked** and do not call the complete MVP fully verified.

### 10.1 Specific browser/demo acceptance scenario

1. Open UniJar public HTTPS app; display configured real TokenJar inventory, held-for-review token and existing active lot if any.
2. Connect an injected Sepolia wallet; observe correct payout balance/allowance, chain and role.
3. Authorized operator opens a direct lot from real jar custody; excess goes back to jar. Buyer reads current reference quote, approves amount, confirms fill; show real tx and verified exact treasury receipt/delivery.
4. Demonstrate a configured local fixture or Sepolia-supported test condition where reference history/liquidity/deviation policy rejects a fill; clearly show why and do not secretly auction the lot.
5. With active slot cleared through legitimate sale/recovery, operator opens an auction-approved asset lot. Bid from wallet A, outbid with wallet B, reclaim A's credit, finalize at/after expiry and verify treasury and recipient balances.
6. Separately replay a no-bid auction to expiry and permissionlessly recover exactly the committed inventory. Verify late jar deposits and held assets remain outside the lot.
7. Show wrong-chain/wrong-role refusal, frontend/cloud status, actual source contract addresses and transaction receipts.

If a complete real Sepolia TWAP lookback or another live prerequisite is not yet met, complete it without substituting time-cheated public-chain results. Local demonstrations may be shown as local only, separately from Sepolia evidence.

## 11. Implementation continuation and deliverables

### 11.1 Resume, do not restart

First produce a factual gap assessment of existing files and live artifacts: **contracts**, **local tests**, **Sepolia source/addresses/transactions**, **oracle-history evidence**, **API/tests**, **Docker image**, **Azure API URL**, **CORS**, and **missing wallet/frontend flows**. Report confirmed versus planned versus blocked. Make targeted repairs and preserve working code, commits and deployment state.

### 11.2 Finish the full-stack MVP

- Implement the minimal frontend described in Sections 5–6; use existing OpenAPI/manifest. Only patch backend methods strictly needed for the documented user journeys.
- Add focused unit/integration tests for amount formatting, allowance/approval, policy status, wallet/network changes and pending/failed transactions.
- Run real browser wallet integration on Sepolia using disposable funded accounts; compare wallet-visible results with independently read chain receipts and balances.
- Deploy the frontend over HTTPS; validate its connection to the existing Azure API and correct CORS/origin configuration. Keep private cloud and RPC values out of the browser bundle.
- Perform the scenario in Section 10.1; preserve nonsecret evidence in concise validation records.

### 11.3 Deliverables

1. Running Sepolia contract set and genuine source/manifest/receipt record (or explicit external blocker).
2. Existing, verified Fastify API on HTTPS Azure Container Apps, with OpenAPI (or explicit external blocker).
3. Wallet-connected, mobile-responsive UniJar web application hosted at an actual HTTPS URL.
4. Reproducible local/deployment commands, contract/API/frontend tests, and end-to-end scripted/manual checks.
5. Short `VALIDATION.md` or equivalent with evidence for A-01 through A-17, **real** commit SHAs/transaction hashes, sources, passed/failed/blocked/not-tested classifications, and limitations.
6. Clear demo instructions identifying controlled Sepolia tokens, test-only trading, lack of guaranteed buyers and lack of audit.

## 12. Failure conditions and release decisions

- **Auction-only application:** Not the UniJar two-lane MVP; label as partial functionality.
- **Direct quote from hardcoded number or mocked pool only:** Not acceptable; use actual v3 source and live-observation evidence.
- **Frontend without connected-wallet signing:** Not the full-stack MVP, even if API can prepare transactions.
- **API running but no confirmed Sepolia transactions:** Infrastructure stage, not end-to-end completion.
- **Inability to create real TWAP history:** Block direct-sale testnet acceptance explicitly; do not fake elapsed time on Sepolia.
- **Buyer demand or price gains not established:** No commercial-performance claim; this does **not** block the technical demo when clearly disclosed.
- **Missing Azure account, faucet funds, wallet connector project ID or RPC permissions:** Complete independent components, record exact pending prerequisites and keep assertions limited to demonstrated behavior.

---

**Final release statement to earn:** “UniJar is a testnet MVP with an adopted TokenJar releaser, explicit reference-priced direct sales and fully funded English auctions, real receipts/refunds/recovery, a noncustodial Azure API and a wallet-connected HTTPS frontend. Both sales and safety refusals have been exercised with real Sepolia transactions.”

Do **not** use that statement until the evidence above supports each part.
