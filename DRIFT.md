# Drift av Tornstriden online

Driftinstruktion för onlinespelet (arbetsordning L21). Spelet på `https://tornstriden.landychev.se`
består i drift av tre delar på Debian-servern (`debian-nas`):

| Del | Var | Sköts av |
| --- | --- | --- |
| Sidor, skript, bilder, ljud | `/var/www/tornstriden` (kopia från `./deploy.sh`) | Apache (HTTPS via Certbot) |
| Onlinetjänsten (`/api/`): lobby, matcher, händelseström | Node-process `tornstriden-online` på `127.0.0.1:8766`, körs som systemanvändaren `tornstriden` från dess egen Git-utcheckning `/opt/tornstriden` | systemd, Apache skickar `/api/` vidare |
| Databasen (SQLite, WAL) | `/var/lib/tornstriden/tornstriden.sqlite` – utanför webbrot och Git | tjänsten; säkerhetskopia med `drift/sakerhetskopia.mjs` |

Tjänsten har inga npm-beroenden och inga hemligheter (sessionstoken slumpas per session och lagras hashad).
Serverkoden i `online/`, lagmotorn och testerna publiceras aldrig till webbroten; `scripts/kontrollera-publicering.mjs`
kontrollerar det.

Filerna i det här paketet:

| Fil | Används till |
| --- | --- |
| `deploy.sh` | kopierar klientfilerna (nu även lobbyn och lagmatchen) till webbroten med versionsstämpel `?v=<hash>` |
| `scripts/kontrollera-publicering.mjs` | kontroll av en publiceringskopia: inga saknade filer, allt stämplat, inga serverfiler |
| `apache/tornstriden-online.conf` | Apache-proxy för `/api/` (inkluderas i tornstridens virtuella värdar) |
| `drift/tornstriden-online.service` | systemd-enhet för tjänsten |
| `drift/tornstriden-online.env` | tjänstens miljö (port, datakatalog, HTTPS-läge, tillåtet ursprung); mall som `installera.sh` fyller i |
| `drift/installera.sh` | installationen på en server i ett svep (avsnitt 1–3): systemanvändare, klon, tjänst, Apache, HTTPS; kan köras om |
| `drift/uppdatera.sh` | planerad uppdatering: underhållsläge → vänta ut matcher → säkerhetskopia → pull, deploy, omstart |
| `drift/sakerhetskopia.mjs` | konsekvent kopia av databasen medan tjänsten kör; gallrar gamla kopior |

## 1. Förutsättningar på servern

- **Node 22.5 eller nyare** (`node:sqlite` ingår), installerad för hela systemet (`/usr/bin/node`) så att
  tjänsteanvändaren kan köra den – Debians egna `nodejs`-paket är äldre, så installera från NodeSource
  (`https://deb.nodesource.com`, serien 22.x). En nvm-installation under ett hemkonto fungerar inte för tjänsten.
  Proven i L20–L22 kördes med Node 22.23.
- **Apache 2.4** med `proxy`, `proxy_http` och `headers` (skriptet aktiverar dem); HTTPS via Certbot.
- **git** och en nätväg till GitHub (för klon och `git pull`).
- **Systemanvändaren `tornstriden`** skapas av skriptet (`useradd --system`, ingen inloggning, hem = datakatalogen).
  Tjänsten, utcheckningen `/opt/tornstriden`, datakatalogen `/var/lib/tornstriden` och webbroten `/var/www/tornstriden`
  ägs av den – ditt eget konto används inte av tjänsten. systemd-enheten döljer dessutom hela `/home`.

## 2. Första installationen av onlinetjänsten

Allt i detta avsnitt och avsnitt 3 görs i ett svep av `sudo drift/installera.sh` (idempotent: kan köras om). Skriptet
sätter ägarskapet (utcheckning, webbrot, datakatalog → ägaren), kör `deploy.sh` och kontrollen, fyller i mallarna
`drift/tornstriden-online.service` och `.env` med sökvägar/ägare/domän och installerar tjänsten, lägger in Apaches
cache-regler, skapar den virtuella värden för port 80 om den saknas, inkluderar proxyn för `/api/` i port 80- och
Certbots 443-värd, kontrollerar via webbadressen och tar en första säkerhetskopia (en daglig cron-rad bara med `--cron`).

**Ny server** (Debian/Ubuntu med Apache 2.4, git och Node ≥ 22.5 – se §1): klona var som helst och kör skriptet –
det klonar själv tjänstens egen utcheckning till `/opt/tornstriden` från samma fjärr.

```sh
git clone https://github.com/landychev/tornstriden.git ~/tornstriden
sudo ~/tornstriden/drift/installera.sh --doman spel.example.org --certbot
```

Flaggor (alla har standardvärden): `--doman` (`tornstriden.landychev.se`), `--agare` (`tornstriden`), `--rot`
(`/opt/tornstriden`), `--data` (`/var/lib/tornstriden`), `--webb` (`/var/www/tornstriden`), `--repo` (fjärren att
klona; annars samma som skriptets utcheckning), `--fran-data <katalog>` (kopierar en befintlig databas in i den nya
datakatalogen, t.ex. vid byte av tjänsteanvändare), `--certbot` (kör `certbot --apache -d <domän> --redirect`;
kräver att DNS pekar på servern och att port 80 är öppen – utan flaggan skrivs kommandot ut och skriptet körs om
efteråt så att proxyn hamnar i 443-värden), `--cron` (daglig säkerhetskopia 04:17).

**Byte från en installation som körde som ett vanligt konto** (så gjordes på `debian-nas` 2026-10-16: tjänsten körde
först som `landy` från `/home/landy/github-proj/tornstriden`):

```sh
sudo /home/landy/github-proj/tornstriden/drift/installera.sh --fran-data /home/landy/github-proj/tornstriden-data
```

Det stoppar tjänsten, kopierar databasen till `/var/lib/tornstriden`, klonar `/opt/tornstriden`, skriver om
enheten och miljöfilen för användaren `tornstriden` och startar om. Den gamla utcheckningen och datakatalogen i
hemkatalogen rörs inte och kan tas bort efteråt (`rm -r /home/landy/github-proj/tornstriden-data`).

Stegen nedan är samma sak för hand.

Som root (stegen som skriptet gör):

```sh
useradd --system --user-group --home-dir /var/lib/tornstriden --no-create-home --shell /usr/sbin/nologin tornstriden
install -d -m 700 -o tornstriden -g tornstriden /var/lib/tornstriden
install -d -o tornstriden -g tornstriden /opt/tornstriden /var/www/tornstriden
runuser -u tornstriden -- env HOME=/var/lib/tornstriden git clone https://github.com/landychev/tornstriden.git /opt/tornstriden
cd /opt/tornstriden
runuser -u tornstriden -- env HOME=/var/lib/tornstriden ./deploy.sh /var/www/tornstriden
node scripts/kontrollera-publicering.mjs /var/www/tornstriden
```

Tjänsten:

```sh
cd /opt/tornstriden
install -m 644 drift/tornstriden-online.service /etc/systemd/system/tornstriden-online.service   # mallarna gäller som de är för standardvärdena
install -m 640 -o root -g tornstriden drift/tornstriden-online.env /etc/tornstriden-online.env
systemctl daemon-reload
systemctl enable --now tornstriden-online
systemctl status tornstriden-online --no-pager
curl -s http://127.0.0.1:8766/api/halsa; echo
```

`halsa` ska svara med `"tjanst":"tornstriden-online"`, `"protocolVersion":1` och `"pagaende":0`.
Startar tjänsten inte: `journalctl -u tornstriden-online -n 50`. Vanliga orsaker: för gammal Node
(`node:sqlite` saknas), fel sökväg till `node` i `ExecStart`, datakatalogen saknas eller ägs av fel användare,
porten upptagen (en `npm run online` som redan kör).

Apache-proxyn, som root:

```sh
install -m 644 apache/tornstriden-online.conf /etc/apache2/conf-available/tornstriden-online.conf
a2enmod proxy proxy_http headers
```

Lägg sedan raden `Include conf-available/tornstriden-online.conf` inuti `<VirtualHost>` i **båda** värdarna:
`/etc/apache2/sites-available/tornstriden.landychev.se.conf` (port 80; repots kopia har redan raden) och
Certbots `/etc/apache2/sites-available/tornstriden.landychev.se-le-ssl.conf` (port 443 – den som faktiskt
används). Filen aktiveras inte globalt (`a2enconf`), så andra webbplatser på servern får ingen proxy.

```sh
apache2ctl configtest && systemctl reload apache2
```

## 3. Kontroll efter installation

```sh
curl -s https://tornstriden.landychev.se/api/halsa; echo          # samma svar som lokalt, via HTTPS
curl -sI https://tornstriden.landychev.se/lobby.html | head -1      # HTTP/1.1 200 (eller HTTP/2 200)
curl -sN --max-time 8 -H 'Cookie: x=y' https://tornstriden.landychev.se/api/handelser   # 401 utan session: {"message":"Ingen session…"}
```

Öppna sedan `https://tornstriden.landychev.se/lobby.html` i två webbläsare (eller ett privat fönster), välj
nick i båda, bjud in, välj lag, Redo, Starta – en duell via servern. Kontrollera i lobbyn att
anslutningsstatus står på "Ansluten" och ligger kvar (strömmen går genom proxyn och pingas var 5:e sekund).
Med fyra deltagare startar en lagmatch på `lagmatch.html`. Loggen (`journalctl -u tornstriden-online -f`)
visar kommandotyp, kö och status – aldrig kort, händer eller token.

Säkerhetskopian, som `tornstriden` (tas också automatiskt av `uppdatera.sh` före varje uppdatering; ingen cron används):

```sh
node drift/sakerhetskopia.mjs
```

## 4. Uppdatera (planerad publicering)

Huvudregel (huvudplan §11): stoppa nya matcher, låt pågående bli klara, uppdatera, öppna igen. Som root:

```sh
sudo /opt/tornstriden/drift/uppdatera.sh            # väntar högst 30 min på pågående matcher
sudo /opt/tornstriden/drift/uppdatera.sh --vanta 5  # kortare tålamod
sudo /opt/tornstriden/drift/uppdatera.sh --tvinga   # ingen väntan (27B: pågående matcher avbryts utan vinnare)
```

Skriptet gör i tur och ordning: `SIGUSR1` till tjänsten (underhållsläge – lobbyn visar
"Servern uppdateras snart …" på startknappen, pågående matcher spelas klart), väntar tills `/api/halsa` visar
`"pagaende":0`, tar en säkerhetskopia, `git pull --ff-only`, `./deploy.sh`, `systemctl restart`, och kontrollerar
att tjänsten svarar. Avbryts det (Ctrl+C) före uppdateringen skickas `SIGUSR2` så att starter öppnas igen.
Underhållsläget är inte beständigt: en omstart öppnar alltid. Manuellt motsvarar det:

```sh
systemctl kill -s SIGUSR1 tornstriden-online      # inga nya matcher
watch -n 20 'curl -s http://127.0.0.1:8766/api/halsa'   # tills "pagaende":0
runuser -u tornstriden -- env HOME=/var/lib/tornstriden node drift/sakerhetskopia.mjs
runuser -u tornstriden -- env HOME=/var/lib/tornstriden git pull --ff-only && runuser -u tornstriden -- env HOME=/var/lib/tornstriden ./deploy.sh
systemctl restart tornstriden-online
```

Klienter som har en gammal sida öppen efter uppdateringen: versionsstämplingen gör att nästa sidladdning
hämtar rätt filer. Skulle protokollversionen (`PROTOCOL_VERSION` i `kontrakt.js`) ha höjts får en öppen lobby
dialogen "Spelet har uppdaterats – Ladda om", och en öppen matchsida ett tydligt besked utan tvingad omladdning.

Tvingad omstart (`systemctl restart` med pågående matcher, eller en krasch): tjänsten avbryter alla matcher som
pågick innan den öppnar igen, utan vinnare (SERVERAVBROTT, beslut 27B); spelarna ser "Matchen avbröts på grund
av ett serveravbrott" och vägen till lobbyn. Misslyckas uppstädningen (lagringsfel) startar tjänsten inte alls –
den låtsas aldrig ha sparat.

## 5. Återgång till föregående version

`uppdatera.sh` skriver ut föregående commit, t.ex. `Uppdaterat 04400bb → 1a2b3c4. Återgång: …`:

```sh
sudo drift/uppdatera.sh --till 04400bb --tvinga
```

Det gör `git reset --hard` till den versionen, kör `deploy.sh` (nya stämplar, så webbläsarna hämtar de gamla
filerna igen) och startar om tjänsten. Nästa `git pull --ff-only` går framåt igen när felet är rättat.

Databasen följer inte med tillbaka. Har den nya versionen höjt schemaversionen (`schemaversion` i `halsa`)
vägrar den gamla koden starta ("Databasen har schemaversion N, programmet kan högst M"). Återställ då
säkerhetskopian som `uppdatera.sh` tog före uppdateringen (avsnitt 6); matcher som spelats däremellan försvinner,
och spelarna väljer nick på nytt. Inget konto eller resultat av värde finns i databasen – den är spelets
arbetsminne.

## 6. Säkerhetskopiering och återställning

`drift/sakerhetskopia.mjs` tar en konsekvent kopia med SQLites backup-funktion medan tjänsten kör (ingen
`sqlite3`-binär behövs), lägger den i `<data>/sakerhetskopior/tornstriden-ÅÅÅÅMMDD-HHMMSS.sqlite` som en enda fil,
kontrollerar att den går att öppna och behåller de 14 senaste (`--behall N`). Den körs av `uppdatera.sh` före varje
uppdatering och annars för hand; vill du ha en daglig kopia: `installera.sh --cron` (04:17 i ägarens crontab).
Databasen är spelets arbetsminne (sessioner, rum, matcher), inget av bestående värde. Kopiera gärna katalogen vidare
med NAS:ens vanliga backup.

Återställning, som root:

```sh
systemctl stop tornstriden-online
cd /var/lib/tornstriden
mv tornstriden.sqlite tornstriden.sqlite.trasig; rm -f tornstriden.sqlite-wal tornstriden.sqlite-shm
runuser -u tornstriden -- env HOME=/var/lib/tornstriden cp sakerhetskopior/tornstriden-<datum>.sqlite tornstriden.sqlite
systemctl start tornstriden-online
```

Tjänsten avbryter vid starten de matcher som var pågående i kopian (27B) och öppnar sedan.

## 7. Loggar, övervakning och gränser

- Tjänsten: `journalctl -u tornstriden-online -f`. Raderna innehåller typ, scope (`rum:<id>`, `match:<id>`) och
  status – aldrig nyttolast, händer eller sessionstoken. `VARNING … avbröts utan vinnare` efter en omstart är
  väntat, inte ett fel.
- Apache: `/var/log/apache2/tornstriden-access.log` och `-error.log`. `502`/`503` på `/api/` betyder att tjänsten
  inte svarar; klienterna återansluter själva (var 3:e sekund, med växande paus) när den är uppe igen.
- `/api/halsa` (utan session): `protocolVersion`, `schemaversion`, `nyaMatcher` (underhållsläge), `pagaende`
  (antal pågående matcher) och serverns tid. Lämplig för en enkel övervakning (t.ex. `curl -sf … || larm`).
- `Restart=on-failure` i enheten startar om tjänsten efter en krasch; pågående matcher avbryts då (27B).
- Gränser i tjänsten: kommandon högst 2 kB (Apache stoppar vid 64 kB), en styrande ström per session (en extra
  flik tar över), högst ett inbjudningskommando per sekund och värd, sessioner utan aktivitet gallras efter
  5 min (en pågående match hinner aldrig drabbas: dess frister är högst 90 s), obesvarade inbjudningar efter 2 min, inaktiva rum efter 2 h. Avslutade och avbrutna matcher tas bort ur databasen (händelser och kvittenser också) ett dygn efter att de sist rördes.
- Tidsgränser: 90 s per väntande val (varning vid 30 s), 30 s återanslutningsfrist per avbrott och högst 90 s
  sammanlagt per match; 15 s utan livstecken räknas som avbrott, 3 s nåd för omladdning/sidbyte.

## 8. Kapacitet

Målet 10 samtidiga matcher med 80 anslutningar (p95 ≤ 250 ms för matchkommandon, p95 ≤ 500 ms för utskick,
≤ 300 MB minne) är uppfyllt i molnet (L20, `TESTBEVIS.md`). På NAS:en mäts det i L22 med samma skript, som bara
behöver Node (ingen webbläsare):

```sh
node scripts/prova-belastning.mjs        # startar en egen serverprocess på en ledig port; rör inte driftdatabasen
```

Mätt på NAS:en 2026-10-16 (L22): **36/36 kontroller**, minne 133 MB, CPU medel 40 % (max 128 %), 0 serverfel på 7 720 svar,
0 oväntat stängda strömmar, en skur av 200 gamla drag på 258 ms, sessionstaket 200. Målet är alltså uppfyllt på driftmaskinen.

En motståndare när ingen annan är inne: `scripts/lobbybot.mjs` går in i lobbyn, accepterar inbjudningar, fyller laget
och spelar slumpade giltiga drag. På servern (vilken användare som helst som kan läsa utcheckningen):

```sh
node scripts/lobbybot.mjs --nick Datorn --bas http://127.0.0.1:8766 --origin https://tornstriden.landychev.se
```

Ctrl+C lämnar lobbyn. (Vill du ha den igång jämt: en systemd-enhet med samma kommando, `Restart=always`.)

## 9. Känt och inte verifierat (L21)

- Installerat och provat på NAS:en 2026-10-16 (L22) med `drift/installera.sh`: tjänsten med härdningen, Apache-proxyn
  med Certbots HTTPS, en hel duell mellan två webbläsare, `uppdatera.sh` skarpt och kapacitetsmätningen. Går tjänsten
  inte att starta efter en ändring, prova först att ta bort raderna `ProtectHome`/`ReadWritePaths` och se `journalctl`.
- Inte provat i drift: riktiga telefoner, Safari/Firefox, nätbyten och lagmatcher (4/6/8) – görs vid provspel med
  människor.
- Databasen hålls liten: avslutade matcher gallras efter ett dygn, sessioner efter fem minuter utan aktivitet, rum efter
  två timmar. `sakerhetskopia.mjs` skriver ut antalet matcher i kopian.
- Underhållsläget stoppar bara nya starter. Rum som redan är fulla och redo väntar med beskedet på startknappen.
  Efter omstarten står rummen kvar; deltagarna återansluter automatiskt (webbläsaren öppnar strömmen igen) och
  värden kan starta när alla åter visas som anslutna. Den som är frånkopplad längre än 60 s tas ur rummet som
  vanligt.
- `index.html` är fortfarande datormatchen (`match.html`); lobbyn nås på `/lobby.html`. Vill du göra lobbyn till
  startsida: byt `match.html` mot `lobby.html` på raden som skapar `index.html` i `deploy.sh`.
