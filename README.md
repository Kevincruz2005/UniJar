# UniJar

Backend for the ETHGlobal Mumbai 2026 controlled demo. UniJar sells exact batches
of fees held in the original Uniswap TokenJar through funded auctions or guarded,
v3-reference-priced direct purchases. The reference pool supplies a price; a
direct purchase transfers payment straight to treasury and does not swap.

The authoritative scope and acceptance requirements are [START.md](START.md),
[BACKEND.md](BACKEND.md), and [AZURE.md](AZURE.md). No frontend is included.

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


This milestone is locally runnable without Azure credentials. Public deployment
records and Azure deployment tooling are introduced in later commits.
