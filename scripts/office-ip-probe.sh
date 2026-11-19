#!/usr/bin/env bash
# Records the office's public IP so we can see how stable it is (attendance by office network, D51).
# Read-only and local: it only asks public "what is my IP" services. Appends to .run/office-ip.log.
# Usage: scripts/office-ip-probe.sh          one reading, printed and logged
#        scripts/office-ip-probe.sh report   summary of the log (distinct IPs, changes, longest stable run)
set -u
cd "$(dirname "$0")/.."
LOG=".run/office-ip.log"
mkdir -p .run

if [ "${1:-}" = "report" ]; then
  [ -s "$LOG" ] || { echo "No readings yet: run scripts/office-ip-probe.sh first."; exit 0; }
  awk -F'\t' '
    NR == 1 { first = $1 }
    { last = $1; n++; seen[$2]++
      if ($2 != prev && prev != "") { changes++; print "changed  " $1 "  " prev " -> " $2 }
      prev = $2 }
    END { print "readings " n "  from " first "  to " last
          print "distinct public IPs " length(seen) "  changes " (changes + 0)
          for (ip in seen) print "  " ip "  " seen[ip] " readings" }' "$LOG"
  exit 0
fi

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
v4=$(curl -4 -s --max-time 8 https://api.ipify.org || true)
[ -n "$v4" ] || v4=$(curl -4 -s --max-time 8 https://icanhazip.com | tr -d '[:space:]' || true)
v6=$(curl -6 -s --max-time 8 https://api64.ipify.org 2>/dev/null || true)
gw=$(ip route show default 2>/dev/null | awk '/default/ {print $3; exit}')
ssid=$(iw dev 2>/dev/null | awk '/ssid/ {print $2; exit}')

kind="public"
case "$v4" in
  "") kind="offline" ;;
  10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[0-1].*) kind="private" ;;
  100.6[4-9].*|100.[7-9][0-9].*|100.1[01][0-9].*|100.12[0-7].*) kind="cgnat" ;;
esac

printf '%s\t%s\t%s\t%s\t%s\n' "$(now)" "${v4:-none}" "${v6:-none}" "${ssid:-?}" "${gw:-?}" >> "$LOG"
echo "time    $(now)"
echo "ssid    ${ssid:-?}   gateway ${gw:-?}"
echo "ipv4    ${v4:-none}   ($kind)"
echo "ipv6    ${v6:-none}"
