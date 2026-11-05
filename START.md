# UniJar: backend first

Read `BACKEND.md` and `AZURE.md`, then paste the prompt below into local Codex in your UniJar repository. These three files replace the earlier pack as the instructions for this phase. Preserve existing work; the frontend is deferred.

This is a concise build specification. Application implementation, Sepolia transactions and Azure deployment have not been executed in preparing it.

## One starting prompt

```text
Build UniJar's complete backend using BACKEND.md and AZURE.md. Implement contracts, local tests, Sepolia deployment, the TypeScript API, Docker packaging and Azure deployment, then run the deployed smoke tests. Do not build the frontend yet.

Inspect the repository and preserve existing changes. Work autonomously through small functional milestones; run relevant checks and make honest, meaningful commits. Stage explicit files. Keep secrets, dependencies, generated builds and raw logs out of Git. Preserve source pins/licenses and lock resolved packages. Do not backdate commits or invent test results.

Start with real TokenJar custody and auction/refund/recovery, then real v3 reference pricing and direct sales. Prove both locally before public deployment. Contracts run on Sepolia; Azure hosts the noncustodial API, never private signing keys or a public Anvil node.

Continue through API, container and cloud verification when the required accounts are available. If RPC, faucet funds, Azure login/subscription or permissions are missing, complete every independent task and prepare exact commands; report only those external blockers. Never call an unexecuted deployment or test successful. Finish with actual test results, commit IDs, contract addresses, the HTTPS API URL and remaining limitations.
```

## Build order

1. Contracts and actual local EVM integration.
2. Contract tests, accounting checks and deployment scripts.
3. Sepolia fixture, real oracle history, contracts and smoke transactions.
4. API, API tests and production Docker image.
5. Azure deployment, live checks and reproducible handoff.

No CounterJar, CCA, agents, cross-chain support or frontend in this phase. The API is prepared for a later frontend; wallet signing remains outside the server.
