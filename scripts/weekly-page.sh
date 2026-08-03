#!/bin/bash
# Weekly gauge → Page report. Sends the ranked per-project breakdown for the
# last 7 days to the Page inbox, so Monday morning opens with where the plan
# actually went.
#
# Cron gets a minimal PATH that does NOT include nvm's node, and a node-less
# cron job fails silently — see reference_cron_nvm_path. The absolute node
# path below is the fix; keep it in step with the installed version.
set -euo pipefail

NODE=/home/joseph/.nvm/versions/node/v22.22.2/bin/node
GAUGE=/home/joseph/Sites/burn/bin/burn.mjs

if [ ! -x "$NODE" ]; then
  echo "$(date -Is) FATAL: node not found at $NODE — nvm was upgraded, update this path" >&2
  exit 1
fi

# The token comes from ~/.config/pager/config.json, which `page login` wrote.
# HOME is not always set the way you expect under cron, so pin it.
export HOME=/home/joseph
export NODE_NO_WARNINGS=1

echo "$(date -Is) running weekly gauge page"
"$NODE" "$GAUGE" page --days 7
