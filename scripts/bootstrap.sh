#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .deps .tools
repositories=(Uniswap/tjar Uniswap/v3-core Uniswap/v3-periphery foundry-rs/forge-std)
commits=(f7642c685c051badf3056c4d7e9ed4777222e1d9 5ea68a77cb541c6b3812df783be71ba8c081e25f 24ccf014fe7f81d74a14c1689d6fdf123f280e45 dc647cc030d9d65910d8f1172a0cde48d7106e32)
for i in "${!repositories[@]}"; do
  path=".deps/${repositories[$i]##*/}"
  if [[ ! -d "$path/.git" ]]; then
    git init "$path"
    git -C "$path" remote add origin "https://github.com/${repositories[$i]}.git"
  fi
  git -C "$path" fetch --depth 1 origin "${commits[$i]}"
  git -C "$path" checkout --detach "${commits[$i]}"
  test "$(git -C "$path" rev-parse HEAD)" = "${commits[$i]}"
  git -C "$path" submodule update --init --recursive --depth 1
  if git -C "$path" submodule status --recursive | rg '^[+-U]'; then
    echo 'Unverified submodule state' >&2; exit 1
  fi
done
python3 scripts/install-foundry.py
