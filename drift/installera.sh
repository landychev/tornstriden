#!/usr/bin/env bash
# Installera Tornstriden online på en Debian/Ubuntu-server med Apache (DRIFT.md §1–3). Körs som root och kan köras om.
#
#   sudo drift/installera.sh [--doman tornstriden.landychev.se] [--agare tornstriden] [--rot /opt/tornstriden]
#                            [--data /var/lib/tornstriden] [--webb /var/www/tornstriden] [--repo <git-url>]
#                            [--fran-data <gammal datakatalog>] [--certbot] [--cron]
#
# Tjänsten körs som en egen systemanvändare (standard `tornstriden`, skapas utan inloggning om den saknas) från sin egen
# Git-utcheckning (standard /opt/tornstriden – klonas från --repo, eller från samma fjärr som detta skripts utcheckning,
# om den saknas) med databasen i /var/lib/tornstriden. Ditt eget konto och hem rörs inte. Ny server: git clone var som
# helst och kör skriptet därifrån; det räcker att Node ≥ 22.5, Apache 2.4 och git finns (Node från NodeSource, se
# DRIFT.md §1). Certbot körs bara med --certbot (DNS måste peka hit och port 80 vara öppen); annars skrivs
# instruktionen ut. --fran-data kopierar en befintlig databas (t.ex. från en installation som körde som annan
# användare) om den nya datakatalogen ännu saknar databas.
#
# Gör i ordning: förutsättningar → systemanvändare, utcheckning (klon/pull), datakatalog, webbrot → deploy.sh + kontroll
# av kopian → systemd-tjänst (mallarna drift/tornstriden-online.service och .env ifyllda) → Apache: cache-conf, virtuell
# värd för port 80 om den saknas, proxy-conf inkluderad i port 80 och Certbots 443 → kontroller → säkerhetskopia.
set -euo pipefail

har=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
rot=/opt/tornstriden
doman=tornstriden.landychev.se
agare=tornstriden
webb=/var/www/tornstriden
data=/var/lib/tornstriden
repo=""
frandata=""
certbot=0
cron=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --doman) doman=$2; shift 2 ;;
    --agare) agare=$2; shift 2 ;;
    --rot) rot=$2; shift 2 ;;
    --data) data=$2; shift 2 ;;
    --webb) webb=$2; shift 2 ;;
    --repo) repo=$2; shift 2 ;;
    --fran-data) frandata=$2; shift 2 ;;
    --certbot) certbot=1; shift ;;
    --cron) cron=1; shift ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *) echo "Okänt argument: $1" >&2; exit 2 ;;
  esac
done
[[ $EUID -eq 0 ]] || { echo "Kör som root (sudo)." >&2; exit 2; }
[[ $agare != root ]] || { echo "Tjänsten ska inte köras som root." >&2; exit 2; }
tjanst=tornstriden-online
steg() { printf '\n== %s\n' "$*"; }

steg "Förutsättningar (Node ≥ 22.5, Apache 2.4, git)"
command -v node >/dev/null || { echo "node saknas. Installera Node 22 (NodeSource: https://deb.nodesource.com, serien 22.x) och kör igen." >&2; exit 1; }
node -v
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<22||(a===22&&b<5)) { console.error("Node 22.5 eller nyare krävs (node:sqlite)."); process.exit(1) }'
command -v apache2ctl >/dev/null || { echo "Apache saknas: apt install apache2" >&2; exit 1; }
command -v git >/dev/null || { echo "git saknas: apt install git" >&2; exit 1; }
for m in proxy proxy_http headers; do a2enmod -q "$m" >/dev/null; done
nodebin=$(command -v node)
[[ -x $nodebin && -r $nodebin ]] || { echo "$nodebin måste kunna köras av $agare (nvm under ett hem fungerar inte – använd NodeSource)." >&2; exit 1; }

steg "Systemanvändare $agare, datakatalog $data"
if ! id "$agare" >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "$data" --no-create-home --shell /usr/sbin/nologin "$agare"
  echo "skapade systemanvändaren $agare (ingen inloggning)"
fi
install -d -m 700 -o "$agare" -g "$agare" "$data"
som() { runuser -u "$agare" -- env HOME="$data" "$@"; }
if [[ -n $frandata && ! -f $data/tornstriden.sqlite && -f $frandata/tornstriden.sqlite ]]; then
  systemctl stop "$tjanst" 2>/dev/null || true
  # En konsekvent kopia av den gamla databasen (WAL-filen följer inte med annars).
  node --disable-warning=ExperimentalWarning -e "const {backup,DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(process.argv[1],{readOnly:true}); backup(db,process.argv[2]).then(()=>{db.close(); const k=new DatabaseSync(process.argv[2]); k.exec('PRAGMA journal_mode = DELETE'); k.close(); console.log('kopierade databasen från', process.argv[1]);});" "$frandata/tornstriden.sqlite" "$data/tornstriden.sqlite"
  chown "$agare:$agare" "$data/tornstriden.sqlite"
fi

steg "Utcheckning $rot (ägd av $agare)"
if [[ ! -d $rot/.git ]]; then
  [[ -n $repo ]] || repo=$(git -c safe.directory='*' -C "$har" remote get-url origin 2>/dev/null || true)
  [[ -n $repo ]] || { echo "Ingen utcheckning i $rot och ingen --repo att klona från." >&2; exit 1; }
  repo=${repo/#git@github.com:/https://github.com/}   # tjänsteanvändaren har ingen SSH-nyckel: klona över HTTPS
  install -d -o "$agare" -g "$agare" "$rot"
  som git clone --quiet "$repo" "$rot"
  echo "klonade $repo"
else
  chown -R "$agare:$agare" "$rot"
  if [[ $rot != "$har" ]] && som git -C "$rot" remote get-url origin >/dev/null 2>&1; then som git -C "$rot" pull --ff-only --quiet || echo "git pull i $rot misslyckades – fortsätter med det som finns"; fi
fi
cd "$rot"
install -d -o "$agare" -g "$agare" "$webb"
chown -R "$agare:$agare" "$webb"
stat -c '%U %n' "$rot" "$data" "$webb"

steg "Statiska filer: deploy.sh → $webb och kontroll av kopian"
som ./deploy.sh "$webb"
som node scripts/kontrollera-publicering.mjs "$webb"

steg "Tjänsten $tjanst (mallar i drift/ med sökvägar, användare och domän ifyllda)"
fyll() { sed -e "s#/var/lib/tornstriden#$data#g" -e "s#/opt/tornstriden#$rot#g" -e "s#/var/www/tornstriden#$webb#g" -e "s#tornstriden\.landychev\.se#$doman#g" -e "s#^User=tornstriden#User=$agare#" -e "s#^Group=tornstriden#Group=$agare#" -e "s#^ExecStart=/usr/bin/node#ExecStart=$nodebin#" "$1"; }
fyll drift/tornstriden-online.service > /etc/systemd/system/$tjanst.service
fyll drift/tornstriden-online.env > /etc/$tjanst.env
chmod 644 /etc/systemd/system/$tjanst.service; chmod 640 /etc/$tjanst.env; chgrp "$agare" /etc/$tjanst.env
systemctl daemon-reload
systemctl enable --now "$tjanst" >/dev/null
systemctl restart "$tjanst"      # även om den redan körde: ny kod och ny konfiguration
port=$(sed -n 's/^PORT=//p' /etc/$tjanst.env); port=${port:-8766}
for i in $(seq 1 10); do curl -sf --max-time 2 "http://127.0.0.1:$port/api/halsa" >/dev/null && break; sleep 1; done
systemctl is-active "$tjanst" >/dev/null || { systemctl status "$tjanst" --no-pager | head -15; journalctl -u "$tjanst" -n 30 --no-pager; exit 1; }
printf 'lokalt:  '; curl -s "http://127.0.0.1:$port/api/halsa"; echo

steg "Apache: cache-regler, virtuell värd för $doman och proxy för /api/"
fyll apache/tornstriden-cache.conf > /etc/apache2/conf-available/tornstriden-cache.conf
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
