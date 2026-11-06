# PRD continuation assessment

Assessment date: 6 November 2026. Requirements: [PRD.md](../PRD.md), version 1.0.
This assessment preserves the completed backend and identifies remaining MVP
work. It does not claim that the wallet-connected full-stack MVP is complete.

## Product understanding

UniJar commits one exact single-token lot from the original-source TokenJar.
The operator explicitly chooses guarded v3-reference-priced direct purchase or
funded fixed-end English auction. Direct payments go to treasury without an AMM
swap. Auction funds are escrowed, outbid credits are withdrawn by their owners,
and unsold inventory returns to the original jar. One unresolved lot is allowed.
Reference failure must refuse execution without switching lanes. Contracts are
authoritative; the API prepares unsigned transactions and user wallets sign.

The next phase adds public inventory/lot views, injected-wallet connection and
Sepolia switching, approval and purchase/bid flows, refunds, permitted
settlement/recovery, operator controls and service status. It must preserve exact
integer amounts, frozen terms, actual roles, explicit refusals and pending versus
confirmed results. No CounterJar, keeper, database or mainnet work is required.

## Baseline inspected

- Contracts, API schemas, deployment manifests, tests and committed validation
  records were inspected. Existing tests were not rerun for this documentation
  change. Prior execution evidence is in [VALIDATION.md](VALIDATION.md).
- The live Azure API was queried again: health/readiness succeeded with source
  `62ab1501d04a1febfc51042951c9480f9bfd786f` and chain `11155111`.
  Config and inventory returned HTTP 200 at block `12073635`; adoption was true,
  admissions were unpaused, and inventory contained three configured assets.
- Source matches for nine Sepolia contracts, 27 contract tests, six API tests,
  26 local transactions, 14 Sepolia smoke transactions and a further 14
  Azure-API-prepared transactions have recorded evidence. This inspection did
  not replay transactions or reverify source submissions.
- The existing non-root Docker image and Azure API remain the backend baseline.
  No contracts, deployment configuration or runtime source were changed here.

## Acceptance matrix

“Passed” below applies only to the stated evidence and layer. “Not tested” means
the complete criterion has not been demonstrated; it is not a passing result.

| ID | Status | Evidence or remaining gap |
| --- | --- | --- |
| A-01 | Passed | Original-source deployments/code hashes and roles recorded; live API confirms adoption. See deployment and source-verification records. |
| A-02 | Passed | Local custody/surplus/donation/late-deposit/rotation tests recorded. |
| A-03 | Passed | Local active-slot, frozen-policy, lifecycle, expiry and authorization tests recorded. |
| A-04 | Passed | Real-v3 local integration and integer/order/decimal vectors; genuine Sepolia history and purchase recorded. |
| A-05 | Passed | Public direct purchase and rejected maximum; local policy/reference rejection tests recorded. Browser evidence remains separate. |
| A-06 | Not tested | Local self-outbid plus public bid/outbid/refund/settlement/recovery recorded; a public self-outbid demonstration is not recorded. |
| A-07 | Passed | Independent stateful ledger: 128 runs/8,192 calls, plus pause/reentrancy/transfer-failure tests. |
| A-08 | Passed | Existing API typecheck/tests cover schemas, allowlisting, preparation and readiness failures. Frontend-driven extensions need their own checks. |
| A-09 | Passed | Local Docker validation and live Azure transactions/platform checks recorded; readiness reconfirmed in this assessment. |
| A-10 | Not tested | Browser views and dedicated configured held-for-review asset are absent. |
| A-11 | Not tested | Injected wallet/account/network behavior has not been implemented or manually verified. |
| A-12 | Not tested | Backend-driven direct flow exists; browser wallet approval/fill evidence is absent. |
| A-13 | Not tested | Backend-driven auction/refund flow exists; browser wallet journey is absent. |
| A-14 | Not tested | Backend recovery/refusal evidence exists; browser presentation and actions are absent. |
| A-15 | Not tested | Contract authorization is tested; operator UI and connected-role behavior are absent. |
| A-16 | Not tested | No frontend production build/HTTPS deployment, responsive browser QA or real frontend-origin CORS check. |
| A-17 | Not tested | Backend handoff exists; complete frontend URLs/browser evidence/full-stack handoff remain missing. |

Evidence: [local validation](../deployments/local-validation.json),
[Sepolia manifest](../deployments/sepolia.json),
[Sepolia smoke](../deployments/sepolia-smoke.json),
[source verification](../deployments/source-verification.json),
[Azure deployment](../deployments/azure.json), and
[Azure smoke](../deployments/azure-smoke.json).

## Discrepancies to reconcile before frontend completion

1. The manifest defines payout, direct and auction assets; there is no dedicated
   configured held-for-review fixture. Add explicit configuration and real
   evidence without inventing an existing address or misclassifying a sale asset.
2. Inventory exposes balances, escrow and accounting but not token symbols,
   decimals or current policy classifications. Config exposes a deployment
   snapshot; live operator policy changes need authoritative reads.
3. Deployed asset mode is a mutually exclusive enum: disabled, auction or direct.
   PRD permits approval for both methods. The UI must show deployed capabilities;
   any required contract extension needs an explicit decision and new deployment
   validation, not a frontend workaround.
4. Quote refusal currently returns generic `REFERENCE_REFUSED`, and transaction
   simulation returns generic `SIMULATION_REVERTED`. Precise business reasons
   require a focused, tested API extension.
5. Operator preparation methods already exist (`setAssetMode`, `setPolicy`,
   `setPaused`, lot opening/cancellation). Reuse their constrained schemas rather
   than adding arbitrary execution. Owner/adoption and live policy visibility
   still need checking against all frontend display requirements.
6. CORS defaults to no browser origins. A denied-origin test passed, but the real
   frontend origin must be explicitly configured and tested after hosting exists.
7. Public self-outbid evidence, two injected-wallet/manual account tests, full
   browser journeys and frontend deployment are unverified. Controlled fixture
   liquidity can become stale; refresh through legitimate onchain activity and
   show refusal honestly while stale.

No new external blocker was established by this read-only assessment. Wallet
availability, funded browser test accounts and frontend hosting prerequisites
must be checked when that phase begins. Preserve deployed source provenance and
both local/Azure validation tags when publishing the repository.
