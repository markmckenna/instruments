#!/usr/bin/env bash
# Starts/stops a persistent `playwright run-server` in the background --
# see ../Makefile ("Browser server") for why this exists and how it's used.
set -uo pipefail
cd "$(dirname "$0")/.."

mkdir -p build
pid_file="build/browser-server.pid"
log_file="build/browser-server.log"
port="${BROWSER_SERVER_PORT:-4175}"

is_running() {
  [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null
}

case "${1:-}" in
  start)
    if is_running; then
      echo "Already running (pid $(cat "$pid_file")). Endpoint:"
      grep -o 'ws://[^[:space:]]*' "$log_file" | tail -1
      exit 0
    fi
    nohup npx playwright run-server --port "$port" > "$log_file" 2>&1 &
    echo $! > "$pid_file"
    for _ in $(seq 1 20); do
      grep -q 'ws://' "$log_file" 2>/dev/null && break
      sleep 0.25
    done
    if ! grep -q 'ws://' "$log_file" 2>/dev/null; then
      echo "Server didn't report a ws endpoint within 5s -- see $log_file"
      exit 1
    fi
    echo "Started (pid $(cat "$pid_file"), port $port). Endpoint:"
    grep -o 'ws://[^[:space:]]*' "$log_file" | tail -1
    ;;
  stop)
    if is_running; then
      kill "$(cat "$pid_file")"
      echo "Stopped (was pid $(cat "$pid_file"))."
    else
      echo "Not running."
    fi
    rm -f "$pid_file"
    ;;
  *)
    echo "Usage: $0 {start|stop}" >&2
    exit 2
    ;;
esac
