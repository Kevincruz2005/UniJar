# Azure deployment and completion gate

Azure hosts the HTTP API. Contracts stay on Sepolia. Do not expose Anvil publicly or deploy signing keys to Azure. No frontend is built in this phase.

## Deliverables to implement

- `contracts/`, `oracle-contracts/`, focused tests and local/Sepolia deployment scripts.
- `backend/` TypeScript API, OpenAPI, tests and a production multi-stage Dockerfile.
- Minimal infrastructure/deploy scripts for Azure Container Apps and its required image registry/environment.
- One repeatable verification command and a short factual final validation report.

Create a root task interface, such as Make targets, for `check`, `local-smoke`, `deploy-sepolia`, `azure-plan`, `deploy-azure` and `smoke-azure`. Implement each target before documenting it as usable. Do not create empty passing tasks. Local tests remain usable without Azure credentials.

## Deployment requirements

1. Confirm Azure login, selected subscription, allowed resource group, region, quotas and resource-provider availability. Use a project-specific group. Identify billable components; Container Apps, registry, logs and RPC are not assumed free. Do not delete/reconfigure unrelated resources.
2. Build/test contracts and API, generate only needed ABIs and validate the actual Sepolia manifest. Package ABI/manifest into the backend build so a clean Docker build reproduces it. Generate public configuration from real deployment outputs.
3. Build a small non-root Node runtime image listening on `0.0.0.0:8080`. Include production dependencies, compiled service, necessary public assets and license notices; exclude Foundry, source dependency trees, Git metadata, dotenv files, keystores, logs and local chain state. Test the image locally with the same configuration shape.
4. Deploy on Azure Container Apps Consumption with external HTTPS ingress to port 8080, minimum zero and maximum one replica for the initial demo. Configure an HTTP scale rule, startup/liveness probes and a readiness probe. Allow cold-start time in checks; temporary minimum one for a demo has additional cost.
5. Use repeatable CLI/Bicep provisioning. If using private ACR, configure managed identity and scoped pull permission; keep registry admin access disabled. Provision only necessary resources. Use a commit-tagged image and record the deployed digest/revision so rollback is reproducible.
6. Keep the RPC credential in an Azure secret referenced by the environment, preferably a Key Vault reference with scoped identity access. A direct Container Apps secret is acceptable for the test demo if handled through secure parameter input. Do not put secret values in tracked YAML, outputs, logs or copied command examples. Account signing keys stay only in local encrypted test keystores.
7. Deploy with the validated chain/manifest. Return the real HTTPS FQDN and run the live checks below. A successful cloud command or healthy TCP port alone is not completion.

The local account needs Azure provisioning permissions and, for managed-identity registry/Key Vault setup, the applicable role-assignment permission. If those inputs are missing, finish code, tests and the deployment plan; report the exact blocker instead of silently weakening authentication or claiming deployment.

## Deployed acceptance checks

- HTTPS `/healthz` and `/readyz` succeed; version/chain match the intended commit and Sepolia manifest. Wrong-chain or missing-code configuration must not report readiness. Bound dependency checks so an RPC outage does not restart a healthy process endlessly.
- Config/inventory/lot/credit/quote endpoints match independently read chain state at the reported blocks. A reference refusal is a valid business result, not invented successful pricing.
- Through the HTTPS API, prepare a direct purchase and auction/outbid/refund/recovery calls. Sign with local disposable test accounts and broadcast outside Azure. Verify actual receipts, lot changes and treasury/token deltas. Include a rejected bound and a no-bid recovery. Never infer success solely from HTTP 200.
- Invalid input/unknown action/arbitrary target requests are rejected. Responses and logs contain no RPC credential or signing key. Check rate limits, request limits and allowed CORS origins.
- Restart/redeploy the container and confirm state still comes from contracts; no local disk is authoritative. Test the configured cold-start allowance. Verify rollback to the recorded previous image/revision when one exists; do not invent a prior successful revision on the first deployment.

Use bounded retry/backoff for cloud readiness and confirmations. Report environment-dependent skips explicitly. Persist a compact `deployments/azure.json` only after deployment with URL, resource identifiers, source commit, image digest, revision and timestamp; keep full logs outside Git.

## Finish only with evidence

Run contract tests, independent accounting/integer vectors, API typecheck/tests, clean Docker build, local end-to-end smoke, real Sepolia smoke and the HTTPS Azure smoke. Record commands, exit codes, passed/failed/skipped results, actual transaction hashes and remaining limitations in a short validation report.

If cloud access or faucet funding is unavailable, label that gate pending. Do not label planned commands, mocked RPC responses or previous research results as deployed validation. Passing these checks does not constitute a production audit.

Return a short handoff: run commands, commit IDs, verified contract/manifest status, API URL/OpenAPI route, real test summary and outstanding blockers. The frontend starts only after this backend gate is satisfied or its external blockers are explicitly accepted.

## Official deployment references

- [Container Apps deployment](https://learn.microsoft.com/en-us/azure/container-apps/get-started)
- [Health probes](https://learn.microsoft.com/en-us/azure/container-apps/health-probes)
- [Secrets and Key Vault references](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets)
- [Scaling](https://learn.microsoft.com/en-us/azure/container-apps/scale-app)
