#!/bin/bash
# Start MindLoom dev servers (server + web) in foreground so the tool can
# monitor them as a watch service. Uses `pnpm start` (tsx, no watch) for the
# server to avoid stdin/EBADF issues when run headless.
set -m
cd /workspace/apps/server || exit 1
pnpm start &
SRV=$!
cd /workspace/apps/web || exit 1
pnpm dev &
WEB=$!
echo "server pid=$SRV web pid=$WEB"
wait
