#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
exec backend/node_modules/.bin/tsx backend/tools/azure.ts "${1:?Use plan, deploy, resume, smoke or verify}"
