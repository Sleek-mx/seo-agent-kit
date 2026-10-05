#!/bin/sh
# Disabled by default. Cron may invoke this hourly; it drafts only at 09:00
# Africa/Nairobi, and draft-core enforces one committed draft per Nairobi day.
set -eu

if [ "$(TZ=Africa/Nairobi /bin/date +%H)" != "09" ]; then
  exit 0
fi

KIT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
NODE_BIN=${SEO_NODE_BIN:-/opt/homebrew/bin/node}
cd "$KIT_DIR"
exec "$NODE_BIN" --env-file=.env .claude/skills/seo-engine/scripts/publish.mjs
