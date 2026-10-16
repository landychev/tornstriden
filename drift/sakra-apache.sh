#!/usr/bin/env bash
# Installera uppdaterade säkerhetsheaders och den betrodda klientadressen i befintlig Apache-proxy.
# Certbots virtuella värdar ändras inte. Den tidigare proxyfilen sparas och återställs vid fel.
set -euo pipefail
[[ $# -eq 0 ]] || { echo "Användning: sudo drift/sakra-apache.sh" >&2; exit 2; }
[[ $EUID -eq 0 ]] || { echo "Kör som root: sudo drift/sakra-apache.sh" >&2; exit 2; }
rot="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
mal=/etc/apache2/conf-available/tornstriden-online.conf
[[ -f "$mal" ]] || { echo "Apache-proxyn saknas. Följ först DRIFT.md om installation." >&2; exit 1; }
if [[ -r /etc/tornstriden-online.env ]]; then . /etc/tornstriden-online.env; fi
port="${PORT:-8766}"
[[ "$port" =~ ^[0-9]{1,5}$ ]] && (( 10#$port >= 1 && 10#$port <= 65535 )) || { echo "Ogiltig API-port." >&2; exit 1; }
backup="$(mktemp /etc/apache2/conf-available/tornstriden-online.conf.backup.XXXXXX)"
cp -p -- "$mal" "$backup"
tmp="$(mktemp)"
aterstall=0
omladdning=0
avsluta() {
  local status=$?
  trap - EXIT
  rm -f -- "$tmp"
  if [[ $aterstall -eq 1 ]]; then
    cp -p -- "$backup" "$mal"
    if [[ $omladdning -eq 1 ]]; then apache2ctl configtest && systemctl reload apache2 || true; fi
    echo "Den tidigare konfigurationsfilen har återställts. Säkerhetskopia: $backup" >&2
  fi
  exit "$status"
}
trap avsluta EXIT
sed "s#127.0.0.1:8766#127.0.0.1:$port#g" "$rot/apache/tornstriden-online.conf" > "$tmp"
a2enmod -q headers >/dev/null
aterstall=1
install -m 644 -- "$tmp" "$mal"
if ! apache2ctl configtest; then
  echo "Konfigurationen underkändes. Apache laddades inte om." >&2
  exit 1
fi
omladdning=1
if ! systemctl reload apache2; then
  echo "Omladdningen misslyckades." >&2
  exit 1
fi
aterstall=0
echo "Säkerhetsheaders och klientadress installerade. Föregående fil: $backup"
