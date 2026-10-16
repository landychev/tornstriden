#!/usr/bin/env bash
# Installera Tornstriden online på en Debian/Ubuntu-server med Apache (DRIFT.md §1–3). Körs som root och kan köras om.
#
#   sudo drift/installera.sh [--doman tornstriden.landychev.se] [--agare landy] [--webb /var/www/tornstriden]
#                            [--data <utcheckning>-data] [--certbot] [--cron]
#
# Standardvärden: utcheckningen är katalogen ovanför detta skript, ägaren är den som äger utcheckningen (eller
# SUDO_USER), domänen tornstriden.landychev.se, webbroten /var/www/tornstriden och databasen i ../tornstriden-data.
# Ny server: klona repot dit tjänsten ska köra och kör skriptet därifrån – det räcker att Node ≥ 22.5, Apache 2.4
# och git finns (Node från NodeSource eller nvm; se DRIFT.md §1). Certbot körs bara med --certbot (kräver att
# DNS pekar på servern och att port 80 är öppen); annars skrivs instruktionen ut.
#
# Gör i ordning: förutsättningar → ägarskap (utcheckning, webbrot, datakatalog) → deploy.sh + kontroll av kopian →
# systemd-tjänst (mallarna drift/tornstriden-online.service och .env med sökvägar/ägare/domän ifyllda) →
# Apache: cache-conf, virtuell värd för port 80 om den saknas, proxy-conf inkluderad i port 80 och Certbots 443 →
# kontroller → en första säkerhetskopia (daglig cron-rad bara med --cron; annars tas kopior av uppdatera.sh och för hand).
set -euo pipefail

har=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
rot=$har
doman=tornstriden.landychev.se
agare=""
webb=/var/www/tornstriden
data=""
certbot=0
cron=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --doman) doman=$2; shift 2 ;;
    --agare) agare=$2; shift 2 ;;
    --webb) webb=$2; shift 2 ;;
    --data) data=$2; shift 2 ;;
    --certbot) certbot=1; shift ;;
    --cron) cron=1; shift ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "Okänt argument: $1" >&2; exit 2 ;;
  esac
done
[[ $EUID -eq 0 ]] || { echo "Kör som root (sudo)." >&2; exit 2; }
[[ -d $rot/.git ]] || { echo "Ingen Git-utcheckning i $rot" >&2; exit 1; }
[[ -n $agare ]] || agare=$(stat -c %U "$rot")
[[ $agare != root ]] || agare=${SUDO_USER:-}
[[ -n $agare && $agare != root ]] || { echo "Ange vem tjänsten ska köras som: --agare <användare> (inte root)." >&2; exit 2; }
id "$agare" >/dev/null 2>&1 || { echo "Användaren $agare finns inte." >&2; exit 1; }
[[ -n $data ]] || data=$rot-data
tjanst=tornstriden-online
som() { runuser -u "$agare" -- "$@"; }
steg() { printf '\n== %s\n' "$*"; }
cd "$rot"

steg "Förutsättningar (Node ≥ 22.5, Apache 2.4, git)"
command -v node >/dev/null || { echo "node saknas. Installera Node 22 (NodeSource: https://deb.nodesource.com, serien 22.x) och kör igen." >&2; exit 1; }
node -v
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<22||(a===22&&b<5)) { console.error("Node 22.5 eller nyare krävs (node:sqlite)."); process.exit(1) }'
command -v apache2ctl >/dev/null || { echo "Apache saknas: apt install apache2" >&2; exit 1; }
command -v git >/dev/null || { echo "git saknas: apt install git" >&2; exit 1; }
for m in proxy proxy_http headers; do a2enmod -q "$m" >/dev/null; done
nodebin=$(command -v node)

steg "Ägarskap: utcheckning, webbrot och datakatalog ägs av $agare"
chown -R "$agare:$agare" "$rot"
install -d -m 700 -o "$agare" -g "$agare" "$data"
install -d -o "$agare" -g "$agare" "$webb"
chown -R "$agare:$agare" "$webb"
stat -c '%U %n' "$rot" "$data" "$webb"

steg "Statiska filer: deploy.sh → $webb och kontroll av kopian"
som ./deploy.sh "$webb"
som node scripts/kontrollera-publicering.mjs "$webb"

steg "Tjänsten $tjanst (mallar i drift/ med sökvägar, ägare och domän ifyllda)"
# Datakatalogen byts före utcheckningen, eftersom standardnamnet innehåller utcheckningens sökväg.
fyll() { sed -e "s#/home/landy/github-proj/tornstriden-data#$data#g" -e "s#/home/landy/github-proj/tornstriden#$rot#g" -e "s#/var/www/tornstriden#$webb#g" -e "s#tornstriden\.landychev\.se#$doman#g" -e "s#^User=landy#User=$agare#" -e "s#^Group=landy#Group=$agare#" -e "s#^ExecStart=/usr/bin/node#ExecStart=$nodebin#" "$1"; }
fyll drift/tornstriden-online.service > /etc/systemd/system/$tjanst.service
fyll drift/tornstriden-online.env > /etc/$tjanst.env
chmod 644 /etc/systemd/system/$tjanst.service; chmod 640 /etc/$tjanst.env; chgrp "$agare" /etc/$tjanst.env
systemctl daemon-reload
systemctl enable --now "$tjanst" >/dev/null
systemctl restart "$tjanst"      # även om den redan körde: ny kod
port=$(sed -n 's/^PORT=//p' /etc/$tjanst.env); port=${port:-8766}
for i in $(seq 1 10); do curl -sf --max-time 2 "http://127.0.0.1:$port/api/halsa" >/dev/null && break; sleep 1; done
systemctl is-active "$tjanst" >/dev/null || { systemctl status "$tjanst" --no-pager | head -15; journalctl -u "$tjanst" -n 30 --no-pager; exit 1; }
printf 'lokalt:  '; curl -s "http://127.0.0.1:$port/api/halsa"; echo

steg "Apache: cache-regler, virtuell värd för $doman och proxy för /api/"
install -m 644 apache/tornstriden-cache.conf /etc/apache2/conf-available/tornstriden-cache.conf
sed -i "s#/var/www/tornstriden#$webb#g" /etc/apache2/conf-available/tornstriden-cache.conf
a2enconf -q tornstriden-cache >/dev/null
fyll apache/tornstriden-online.conf > /etc/apache2/conf-available/tornstriden-online.conf
sed -i "s#127.0.0.1:8766#127.0.0.1:$port#g" /etc/apache2/conf-available/tornstriden-online.conf
vhost=/etc/apache2/sites-available/$doman.conf
if [[ ! -f $vhost ]]; then
  fyll apache/tornstriden.landychev.se.conf > "$vhost"      # port 80; Certbot lägger till 443 och omdirigering
  a2ensite -q "$doman.conf" >/dev/null
  echo "ny virtuell värd: $vhost"
fi
for f in "$vhost" "/etc/apache2/sites-available/$doman-le-ssl.conf"; do
  [[ -f $f ]] || continue
  grep -q 'conf-available/tornstriden-online.conf' "$f" || sed -i '/ErrorLog/i\    Include conf-available/tornstriden-online.conf' "$f"
  printf '%s: proxy-include %s\n' "$f" "$(grep -c 'conf-available/tornstriden-online.conf' "$f")"
done
apache2ctl configtest 2>&1 | grep -v AH00558
systemctl reload apache2

steg "HTTPS"
if [[ -f /etc/apache2/sites-available/$doman-le-ssl.conf ]]; then
  echo "Certbots HTTPS-värd finns."
elif [[ $certbot -eq 1 ]]; then
  command -v certbot >/dev/null || { echo "certbot saknas: apt install certbot python3-certbot-apache" >&2; exit 1; }
  certbot --apache -d "$doman" --redirect
  f=/etc/apache2/sites-available/$doman-le-ssl.conf
  grep -q 'conf-available/tornstriden-online.conf' "$f" || { sed -i '/ErrorLog/i\    Include conf-available/tornstriden-online.conf' "$f"; apache2ctl configtest 2>&1 | grep -v AH00558; systemctl reload apache2; }
else
  echo "Ingen HTTPS-värd ännu. När DNS pekar hit och port 80 är öppen: kör om med --certbot, eller"
  echo "  certbot --apache -d $doman --redirect   och sedan   sudo $rot/drift/installera.sh   (lägger in proxyn i 443-värden)."
fi

steg "Kontroll via webbadressen"
adress="https://$doman"; [[ -f /etc/apache2/sites-available/$doman-le-ssl.conf ]] || adress="http://$doman"
printf '%s/api/halsa:  ' "$adress"; curl -s --max-time 5 "$adress/api/halsa" || echo "(inget svar – stämmer DNS/brandvägg?)"; echo
printf '%s/lobby.html: ' "$adress"; curl -sI --max-time 5 "$adress/lobby.html" | head -1 || echo
printf '%s/api/handelser (401 utan session är rätt): ' "$adress"; curl -s --max-time 5 "$adress/api/handelser"; echo

steg "Säkerhetskopia"
som "$nodebin" --disable-warning=ExperimentalWarning drift/sakerhetskopia.mjs
if [[ $cron -eq 1 ]]; then
  rad="17 4 * * * $nodebin $rot/drift/sakerhetskopia.mjs >> $data/sakerhetskopia.log 2>&1"
  tmp=$(mktemp)
  { crontab -u "$agare" -l 2>/dev/null | grep -v sakerhetskopia.mjs || true; echo "$rad"; } >"$tmp"
  crontab -u "$agare" "$tmp"; rm -f "$tmp"
  echo "daglig kopia 04:17 i $agare:s crontab"
else
  echo "Ingen cron-rad (lägg till med --cron om du vill ha en daglig kopia). uppdatera.sh tar alltid en kopia före varje uppdatering."
fi

steg "Klart"
echo "Spelet: $adress/  Lobbyn: $adress/lobby.html  Logg: journalctl -u $tjanst -f"
echo "Uppdatera senare med: sudo $rot/drift/uppdatera.sh"
