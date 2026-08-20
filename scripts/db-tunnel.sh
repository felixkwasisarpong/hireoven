#!/usr/bin/env bash
# Open an SSH tunnel to the production database.
#
# Port 5432 is firewalled off from the internet (only the harvester box is
# allowlisted), so local tooling reaches it through SSH instead of over the
# public interface. Postgres never leaves the encrypted channel, and this keeps
# working when your home IP changes — an allowlist entry would not.
#
#   ./scripts/db-tunnel.sh          # foreground, Ctrl-C to close
#   ./scripts/db-tunnel.sh --status # is a tunnel already up?
#
# With it running, point local tooling at 127.0.0.1:
#   DATABASE_URL=postgres://hireoven:<password>@127.0.0.1:5433/hireoven
#
# 5433 locally on purpose: it will not collide with a Postgres you run yourself,
# and it makes "am I on prod?" unambiguous in a connection string.
set -euo pipefail

WEB_BOX="${WEB_BOX:-root@5.161.53.248}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/hetzner}"
LOCAL_PORT="${LOCAL_PORT:-5433}"

if [ "${1:-}" = "--status" ]; then
  if lsof -nP -iTCP:"$LOCAL_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "tunnel is UP on 127.0.0.1:$LOCAL_PORT"
  else
    echo "no tunnel on 127.0.0.1:$LOCAL_PORT"
  fi
  exit 0
fi

if lsof -nP -iTCP:"$LOCAL_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Something already listens on 127.0.0.1:$LOCAL_PORT — reusing it."
  exit 0
fi

echo "Tunnelling 127.0.0.1:$LOCAL_PORT -> production postgres (via $WEB_BOX)"
echo "Ctrl-C to close."
exec ssh -i "$SSH_KEY" -N \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -L "${LOCAL_PORT}:127.0.0.1:5432" \
  "$WEB_BOX"
