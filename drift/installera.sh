#!/usr/bin/env bash
# Första installationen av Tornstriden online på servern (DRIFT.md §1–3, arbetsordning L22). Körs som root:
#   sudo drift/installera.sh
# Idempotent: kan köras om. Gör i ordning: ägarskap (utcheckning, webbrot, datakatalog) → deploy.sh +
# kontroll av kopian → systemd-tjänst → Apache-proxy i båda värdarna → kontroller → daglig säkerhetskopia (cron).
set -euo pipefail

agare=landy
rot=/home/landy/github-proj/tornstriden
data=/home/landy/github-proj/tornstriden-data
webb=/var/www/tornstriden
doman=tornstriden.landychev.se
tjanst=tornstriden-online

[[ $EUID -eq 0 ]] || { echo "Kör som root (sudo)." >&2; exit 2; }
[[ -d $rot/.git ]] || { echo "Ingen Git-utcheckning i $rot" >&2; exit 1; }
cd "$rot"
som() { runuser -u "$agare" -- "$@"; }
steg() { printf '\n== %s\n' "$*"; }

steg "Förutsättningar"
node -v
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<22||(a===22&&b<5)) { console.error("Node 22.5 eller nyare krävs"); process.exit(1) }'
for m in proxy proxy_http headers; do a2enmod -q "$m" >/dev/null; done

steg "Ägarskap: utcheckning, webbrot och datakatalog ägs av $agare"
chown -R "$agare:$agare" "$rot"
install -d -m 700 -o "$agare" -g "$agare" "$data"
install -d -o "$agare" -g "$agare" "$webb"
chown -R "$agare:$agare" "$webb"
stat -c '%U %n' "$rot" "$data" "$webb"

steg "Statiska filer: deploy.sh och kontroll av kopian"
som ./deploy.sh "$webb"
som node scripts/kontrollera-publicering.mjs "$webb"

steg "Tjänsten $tjanst"
install -m 644 drift/tornstriden-online.service /etc/systemd/system/$tjanst.service
install -m 640 -o root -g "$agare" drift/tornstriden-online.env /etc/$tjanst.env
systemctl daemon-reload
systemctl enable --now "$tjanst"
systemctl restart "$tjanst"      # även om den redan körde: ny kod
for i in 1 2 3 4 5 6 7 8 9 10; do curl -sf --max-time 2 http://127.0.0.1:8766/api/halsa >/dev/null && break; sleep 1; done
systemctl is-active "$tjanst" >/dev/null || { systemctl status "$tjanst" --no-pager | head -15; journalctl -u "$tjanst" -n 30 --no-pager; exit 1; }
printf 'lokalt:  '; curl -s http://127.0.0.1:8766/api/halsa; echo

steg "Apache-proxy för /api/ i båda värdarna"
install -m 644 apache/tornstriden-online.conf /etc/apache2/conf-available/tornstriden-online.conf
for f in /etc/apache2/sites-available/$doman.conf /etc/apache2/sites-available/$doman-le-ssl.conf; do
  [[ -f $f ]] || { echo "Saknas: $f" >&2; continue; }
  grep -q 'conf-available/tornstriden-online.conf' "$f" || sed -i '/ErrorLog/i\    Include conf-available/tornstriden-online.conf' "$f"
  printf '%s: ' "$f"; grep -c 'conf-available/tornstriden-online.conf' "$f"
done
apache2ctl configtest 2>&1 | grep -v AH00558
systemctl reload apache2

steg "Kontroll via HTTPS"
printf 'https:   '; curl -s --max-time 5 "https://$doman/api/halsa"; echo
printf 'lobby:   '; curl -sI --max-time 5 "https://$doman/lobby.html" | head -1
printf 'ström:   '; curl -s --max-time 5 "https://$doman/api/handelser"; echo "   (401 utan session är rätt)"

steg "Daglig säkerhetskopia (crontab för $agare) och en första kopia"
rad="17 4 * * * /usr/bin/node $rot/drift/sakerhetskopia.mjs >> $data/sakerhetskopia.log 2>&1"
tmp="$(mktemp)"
# Inte i roots crontab (om raden råkat hamna där), utan i $agare:s – via tempfil så att en tom crontab inte stoppar skriptet.
if crontab -l >"$tmp" 2>/dev/null && grep -q sakerhetskopia.mjs "$tmp"; then grep -v sakerhetskopia.mjs "$tmp" | crontab - || true; fi
{ crontab -u "$agare" -l 2>/dev/null | grep -v sakerhetskopia.mjs || true; echo "$rad"; } >"$tmp"
crontab -u "$agare" "$tmp"
rm -f "$tmp"
crontab -u "$agare" -l | grep sakerhetskopia.mjs
som node --disable-warning=ExperimentalWarning drift/sakerhetskopia.mjs

steg "Klart"
echo "Öppna https://$doman/lobby.html i två webbläsare och spela en duell. Logg: journalctl -u $tjanst -f"
echo "Uppdatera senare med: sudo $rot/drift/uppdatera.sh"
