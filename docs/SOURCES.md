# Source and tool boundary

Original UniJar code: AGPL-3.0-only; see LICENSE. Dependencies are reconstructed by
`scripts/bootstrap.sh`, never rewritten or relicensed. Their notices remain in
their checked out trees and are copied into runtime packages when applicable.

| Repository | Required commit |
| --- | --- |
| Uniswap/tjar | f7642c685c051badf3056c4d7e9ed4777222e1d9 |
| Uniswap/v3-core | 5ea68a77cb541c6b3812df783be71ba8c081e25f |
| Uniswap/v3-periphery | 24ccf014fe7f81d74a14c1689d6fdf123f280e45 |
| foundry-rs/forge-std | dc647cc030d9d65910d8f1172a0cde48d7106e32 |

Upstream submodules use their parent commits' gitlink pins. Bootstrap verifies all
four HEADs and recursively checks submodule status. Foundry 1.9.0 release binaries
are checked against GitHub's published SHA256 digest. Application compilation is
Solidity 0.8.29/Cancun, optimizer 200; original v3 compilation is separately
Solidity 0.7.6/Istanbul, optimizer 200. Node baseline: 24.
