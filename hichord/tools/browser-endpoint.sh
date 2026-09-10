#!/usr/bin/env bash
# Sets PW_TEST_CONNECT_WS_ENDPOINT if a `make test-host-start` browser server
# is currently running (see ../Makefile "Browser server") -- shared by
# check.sh and test-one.sh so both connect to it the same way instead of each
# reimplementing the same liveness check.
#
# Liveness is checked by whether the port is listening (lsof), not by
# signaling the recorded pid (kill -0): a sandboxed agent process is denied
# permission to signal a pid outside its own process tree even to just probe
# existence, which would otherwise make the server look dead here even while
# it's running fine in the caller's own shell.
#
# Meant to be sourced (not executed) from a script that already `cd`'d to the
# hichord root, so build/browser-server.log resolves relative to that.
endpoint=$(grep -o 'ws://[^[:space:]]*' build/browser-server.log 2>/dev/null | tail -1)
port=$(echo "$endpoint" | sed -E 's#.*:([0-9]+)/?$#\1#')
if [ -n "$port" ] && lsof -ti "tcp:$port" >/dev/null 2>&1; then
  export PW_TEST_CONNECT_WS_ENDPOINT="$endpoint"
fi
