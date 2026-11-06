# ETHGlobal provenance and AI assistance

Checked against the [Mumbai submission rules](https://ethglobal.com/events/mumbai/info/details)
and [ETHGlobal general rules](https://ethglobal.com/rules) on 6 November 2026.
The user selected **Classic / From Scratch** in this session. This document is a
factual disclosure, not a certification of prize or track eligibility.

## Git history

The first preserved UniJar commit is `9f7fdd2`, timestamped
`2026-11-06T01:08:20+05:30`. The original implementation/deployment sequence is
retained on `archive/before-local-first-rewrite`, ending at `4d7e7e5`.
The original deployed contract/API source is retained by
`deployment-source-62ab150` (`62ab1501d04a1febfc51042951c9480f9bfd786f`).

At the user's request, the main branch was consolidated into larger local-to-Azure
milestones. The first four consolidated commits share
`2026-11-06T07:08:13+05:30`, when that consolidation was performed. Those times
are not presented as the original code-writing times. Original commits were
preserved; no backdated development or test results are claimed. Later work is
committed incrementally. Compare the archive, deployment-source tag and `main`
when inspecting provenance rather than relying only on the consolidated branch.

Git timestamps record commits, not proof of when ideas, designs or uncommitted
code were first created. The actual kickoff boundary and any work predating it
must be confirmed by the team. No rewriting can make earlier work eligible for
a Classic submission. This repository does not claim organizer approval.

## AI involvement

OpenAI Codex substantially generated and edited the project's application code,
tests, scripts, deployment tooling and documentation under user direction.
This includes the following first-party paths:

| Paths | Assistance |
| --- | --- |
| `contracts/src/`, `contracts/test/` | Contract implementation, test vectors and accounting/integration tests |
| `oracle-contracts/src/` | Original-v3 integration reader and controlled liquidity fixture |
| `backend/src/`, `backend/test/`, `backend/tools/` | API, schemas, chain reads, tests, deployment and smoke tools |
| `scripts/`, `Makefile`, build/compiler/container configuration | Dependency reconstruction, local validation, packaging and release commands |
| `infra/` | Azure provisioning, secrets/identity configuration and deployment checks |
| `README.md`, `docs/`, `deployments/` records | Explanations and evidence extraction from actually executed commands/receipts |

Pinned upstream Uniswap/Foundry sources and npm packages are reused third-party
code, not claimed as team-authored or AI-authored. Pins and licenses are in
[SOURCES.md](SOURCES.md). Synthetic test inputs are separate from recorded local
and public-chain execution results. No generated frontend exists at this point.

The user supplied project specifications/instructions, requested implementation
and validation, directed the commit/deployment sequence, supplied access and
funded test accounts. The authorship/timing of supplied specifications outside
this session, any additional human engineering/design work, and the extent of
human code review have not been independently established. These unknowns must
not be filled in with invented contributions. AI-generated code and automated
tests alone do not establish meaningful human contribution or eligibility under
the event rules.

## Specification and prompt artifacts

Project specifications supplied to this workflow are tracked in
[START.md](../START.md), [BACKEND.md](../BACKEND.md), [AZURE.md](../AZURE.md) and
[PRD.md](../PRD.md). The prompt in START.md is retained verbatim in that file.
The continuation plan is [PRD-GAP-ASSESSMENT.md](PRD-GAP-ASSESSMENT.md).
[BUILD-PROMPTS.md](BUILD-PROMPTS.md) records available user directives; it is
explicitly an extract rather than a claim to contain a complete chat transcript.
The team must add any additional relevant prompts/planning artifacts and confirm
pre-event work and human contributions before submitting its final disclosure.

The Classic rules require project-specific work after kickoff, transparent
reuse, meaningful version control and AI attribution. The Mumbai AI rules also
require meaningful team involvement. A clean Git history or passing deployment
does not independently satisfy those conditions. No disclosure has been sent to
the organizers by this agent.
