#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  printf '需要官方 Node.js >=24.19.0；本启动器不会自动安装软件。\n' >&2
  exit 1
fi
# CLI chooses serve by default; preserve explicit restore/help/version and quoted paths.
# Installation is an explicit separate step: npm run install:world-runtime.
exec node "$ROOT/world-runtime/cli.mjs" "$@"
