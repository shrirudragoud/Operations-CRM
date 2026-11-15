#!/usr/bin/env bash
# Keeps the production app running on :3000 and restarts it if it crashes. Logs: .run/app.log
# Usage: scripts/serve.sh start|stop|redeploy|status   (redeploy = rebuild + restart, ~30s)
set -u
cd "$(dirname "$0")/.."
mkdir -p .run
PIDFILE=.run/supervisor.pid
loop() {
  while true; do
    npx next start -p 3000 >> .run/app.log 2>&1
    echo "[$(date -u +%FT%TZ)] app exited, restarting in 2s" >> .run/app.log
    sleep 2
  done
}
stop() {
  [ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null
  pkill -f "next start -p 3000" 2>/dev/null; pkill -f "next-server" 2>/dev/null
  rm -f "$PIDFILE"
}
case "${1:-status}" in
  start)    stop; sleep 1; (setsid bash -c "$(declare -f loop); loop" >/dev/null 2>&1 & echo $! > "$PIDFILE"); sleep 4; "$0" status ;;
  stop)     stop; echo stopped ;;
  redeploy) npm run -s build && "$0" start ;;
  status)   code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login); echo "app on :3000 -> HTTP $code" ;;
esac
