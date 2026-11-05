SHELL := /bin/bash
.PHONY: bootstrap contracts check local-smoke accounts deploy-sepolia azure-plan deploy-azure smoke-azure
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
accounts:
	python3 scripts/accounts.py
deploy-sepolia: check
	CHAIN_ID=11155111 backend/node_modules/.bin/tsx backend/tools/deploy.ts
	python3 scripts/export-assets.py deployments/sepolia.json
	CHAIN_ID=11155111 backend/node_modules/.bin/tsx backend/tools/smoke.ts
azure-plan:
	bash scripts/azure.sh plan
deploy-azure:
	bash scripts/azure.sh deploy
smoke-azure:
	bash scripts/azure.sh smoke
