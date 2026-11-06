SHELL := /bin/bash
.PHONY: bootstrap contracts check local-smoke container-smoke accounts
bootstrap:
	bash scripts/bootstrap.sh
	npm ci --prefix backend
contracts:
	.tools/forge build --root oracle-contracts
	.tools/forge test --root contracts -vv
check: contracts
	python3 scripts/export-assets.py
	npm --prefix backend run typecheck
	npm --prefix backend test
	npm --prefix backend run build
local-smoke: check
	bash scripts/local-smoke.sh
container-smoke: check
	LOCAL_CONTAINER=1 bash scripts/local-smoke.sh
accounts:
	python3 scripts/accounts.py
