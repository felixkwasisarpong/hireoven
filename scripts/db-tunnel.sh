#!/usr/bin/env bash
# Open an SSH tunnel to the production database.
#
# Port 5432 is firewalled off from the internet (only the harvester box is
# allowlisted), so local tooling reaches it through SSH instead of over the
# public interface. Postgres never leaves the encrypted channel, and this keeps
# working when your home IP changes — an allowlist entry would not.
#
#   ./scripts/db-tunnel.sh            # foreground, Ctrl-C to close
#   ./scripts/db-tunnel.sh --daemon   # background, survives this shell, self-heals
#   ./scripts/db-tunnel.sh --status
#   ./scripts/db-tunnel.sh --stop
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
PID_FILE="${TMPDIR:-/tmp}/hireoven-db-tunnel.pid"
LOG_FILE="${TMPDIR:-/tmp}/hireoven-db-tunnel.log"

listening() { lsof -nP -iTCP:"$LOCAL_PORT" -sTCP:LISTEN >/dev/null 2>&1; }

# ssh flags shared by both modes.
#   ExitOnForwardFailure — fail loudly instead of sitting there with no forward
#   ServerAlive*         — notice a dead link rather than hanging on a stale one
ssh_tunnel() {
  ssh -i "$SSH_KEY" -N \
    -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=15 \
    -o ServerAliveCountMax=3 \
    -o StrictHostKeyChecking=no \
    -L "${LOCAL_PORT}:127.0.0.1:5432" \
    "$WEB_BOX"
}

case "${1:-}" in
  --status)
    if listening; then
      echo "tunnel is UP on 127.0.0.1:$LOCAL_PORT"
      [ -f "$PID_FILE" ] && echo "supervisor pid $(cat "$PID_FILE")"
    else
      echo "no tunnel on 127.0.0.1:$LOCAL_PORT"
      exit 1
    fi
    exit 0
    ;;
  --stop)
    # Kill the supervisor first, or it will faithfully restart the tunnel we
    # are trying to stop.
    if [ -f "$PID_FILE" ]; then
      kill "$(cat "$PID_FILE")" 2>/dev/null || true
      rm -f "$PID_FILE"
    fi
    pkill -f "${LOCAL_PORT}:127.0.0.1:5432" 2>/dev/null || true
    echo "tunnel stopped"
    exit 0
    ;;
esac

if listening; then
  echo "Something already listens on 127.0.0.1:$LOCAL_PORT — reusing it."
  exit 0
fi

if [ "${1:-}" = "--daemon" ]; then
  # A bare `ssh -f` backgrounds the process but nothing brings it back after a
  # dropped link, a laptop sleep or a network change — which is why the tunnel
  # kept turning up dead. This supervisor reconnects instead.
  nohup bash -c "
    while true; do
      $(declare -f ssh_tunnel)
      SSH_KEY='$SSH_KEY' LOCAL_PORT='$LOCAL_PORT' WEB_BOX='$WEB_BOX' ssh_tunnel
      echo \"[\$(date -u +%H:%M:%S)] tunnel dropped — reconnecting in 5s\"
      sleep 5
    done
  " >>"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"

  for _ in $(seq 1 20); do
    listening && break
    sleep 0.5
  done

  if listening; then
    echo "tunnel is UP on 127.0.0.1:$LOCAL_PORT (supervisor pid $(cat "$PID_FILE"))"
    echo "log: $LOG_FILE   stop: ./scripts/db-tunnel.sh --stop"
  else
    echo "tunnel failed to come up — see $LOG_FILE" >&2
    exit 1
  fi
  exit 0
fi

echo "Tunnelling 127.0.0.1:$LOCAL_PORT -> production postgres (via $WEB_BOX)"
echo "Ctrl-C to close.  (--daemon keeps it up across shells and reconnects.)"
exec ssh -i "$SSH_KEY" -N \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=15 \
  -o ServerAliveCountMax=3 \
  -o StrictHostKeyChecking=no \
  -L "${LOCAL_PORT}:127.0.0.1:5432" \
  "$WEB_BOX"
