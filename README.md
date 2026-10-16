# Tornstriden

Ett kortspel om två medeltidsborgar. Spelarna anfaller, försvarar sina torn och använder magi. Målet är att slå ut motståndarnas torn.

Detta repository är projektets huvudsakliga arbetskatalog. Nya filer och framtida ändringar hör hemma här.

## Nuvarande version

- En komplett lokal duell i `match.html` (startsidan): startbyten, anfall, försvar, enkel attack, påfyllning vid tom hand, omblandning, vinst och Ge upp.
- Kompakt matchvy med tornen bredvid varandra och handen i samma skärmbild som striden. Startbyten ger korten extra utrymme; på smala skärmar bläddras handen i sidled. Specialkortens effektrad (t.ex. ”Bonus mot försvarskort”) syns direkt på korten i handen och försvararen ser det anfallande kortets effekt i textrutan. Ett långt tryck på ett kort – i handen eller på stridsplatsen, även under motståndarens tur – låter kortet flyga fram i en ruta med styrka, när det spelas och hela effekttexten (på tangentbord: håll in mellanslag på kortet). På mycket låga skärmar eller vid kraftig zoom får sidan växa för att hålla innehållet åtkomligt.
- Lugnare kortanimationer, startmeddelande om vem som anfaller först och visuella signaler för anfall/försvar.
- Dramatisk bakgrundsmusik och separata ljud för vanliga anfall, magiska anfall och spelade försvarskort. Ett mjukt glidljud hörs när ett anfalls- eller försvarskort spelas. Ett kort blandningsljud hörs vid utdelning, kortbyte och påfyllning. Egna resultatljud markerar förlorat liv, vunnen strid samt vunnen eller förlorad match. Knappen **Ljud** vid handen öppnar av/på och separata volymer. Inställningarna sparas lokalt, ljudet aktiveras efter första klicket och pausas när fliken lämnas. Musiken stannar vid matchslut. Spelet fungerar även om ljudstöd eller ljudfiler saknas.
- En datormotståndare (`dator.js`, strategi `dator-v1`) som spelar Norra tornet med samma regelkontroll som människan och bara ser sin egen hand och det öppna bordet. Läget Två spelare vid samma skärm finns också.
- Beslutade duellregler (`duell-v1`) och en låst kortlek på 50 kort (`duell-50-v1`) i `matchregler.js`.
- 30 korttyper, inklusive tio kort med specialeffekter, och en stridsberäkning för duellresultat, specialeffekter, läkning och livförlust.
- Ett testbord (`spelbord.html`) för fristående teststrider, en kortkatalog och sex transparenta bildlager med en verkstad.
- Automatiska tester för kort, strid, regler, matchmotor, dator och ljudets uppspelning/inställningar.

Den lokala matchen mot datorn sparas inte – om sidan laddas om försvinner den (onlinematcher ligger på servern och överlever en omladdning). Datorn följer en enkel grundstrategi (fasta försvarsexempel vid anfall, exakt beräkning vid försvar) och kan göra svaga val mot specialkort som Spegelsköld eller Törnesköld; vikterna ligger i `STRATEGY` i `dator.js`. Onlinespelet (lobby, duell och lagmatcher via servern) beskrivs under Onlineserver nedan. Kortbalans och specialeffekter i lagspel behöver vidare arbete.

## Öppna prototypen

Prototypen är skriven som ES-moduler och behöver därför en lokal webbserver – att dubbelklicka på `spelbord.html` fungerar inte. Med Node.js installerat:

```sh
npm start
```

Öppna sedan [matchen](http://127.0.0.1:8765/match.html), [spelbordet](http://127.0.0.1:8765/spelbord.html), [kortöversikten](http://127.0.0.1:8765/textkort.html) eller [bildverkstaden](http://127.0.0.1:8765/effekter.html). Servern (`server.js`) har inga beroenden; en annan port väljs med `PORT=8080 npm start`. Den lokala förhandsvisningen är ingen publicering på internet.

### Onlineserver

Onlinespelet (lobby, dueller och lagmatcher via servern) är byggt enligt `arbetsordning lobby.md` (L00–L20 klara) och publiceras enligt `DRIFT.md`. Dess server startas separat och kräver Node 22.5 eller nyare:

```sh
npm run online
```

Den lyssnar på <http://127.0.0.1:8766/>, serverar samma statiska filer lokalt och svarar på `/api/halsa`. Lobbyn finns på <http://127.0.0.1:8766/lobby.html> – öppna den i två webbläsare (eller privata fönster), bjud in, välj lag, tryck Redo och låt värden starta: en duell för två spelare spelas då via servern på `match.html?online=1`. Med 4, 6 eller 8 deltagare startar en lagmatch på `lagmatch.html` (matchsidan skickar vidare automatiskt); `TORNSTRIDEN_LAGSPEL=0` stänger lagformaten. `node scripts/prova-lag.mjs` spelar hela lagmatcher för 4/6/8 i separata webbläsarkontexter. Varje val som servern väntar på har 90 sekunder med nedräkning och varning; den som inte hinner slås ut (lagmatch) eller förlorar (duell) – `node scripts/prova-klockor.mjs` provar det med styrd serverklocka. Tappar någon anslutningen får hen 30 sekunder att komma tillbaka (högst 90 sekunder sammanlagt per match) medan de andra spelar vidare – `node scripts/prova-avbrott.mjs` provar det. Startas servern om avbryts matcher som pågick innan den öppnar igen, utan vinnare; sidorna visar "Matchen avbröts på grund av ett serveravbrott" och vägen till lobbyn – `node scripts/prova-omstart.mjs` provar det med en riktig process som dödas. Ljud och animationer följer serverns händelser: varje händelse hörs högst en gång, och en omladdning eller återanslutning är tyst för det som redan hänt – `node scripts/prova-aterkoppling.mjs` provar det. `node scripts/prova-lobby.mjs`, `scripts/prova-online.mjs` och `scripts/prova-match.mjs` kör flödena automatiskt med Playwright (`npm install` först). `node scripts/prova-helflode.mjs` spelar lobby → match → resultat → lobby via gränssnittet med 2+8 och 4+6 deltagare samtidigt (varannan med mobilvy, avbrott med riktigt nätverksbortfall), och `node scripts/prova-belastning.mjs` mäter kapaciteten mot målet 10 samtidiga matcher med 80 anslutningar och provar missbruk och gränser (serverns minne mäts ur `/proc` på Linux och med `ps` på macOS; utan mätvärden faller provet); resultaten och vilka prov som täcker vilken kontrollpunkt står i `TESTBEVIS.md`. Finns Chromium på en egen plats anges den med `PLAYWRIGHT_EXECUTABLE`. Databasen (SQLite, inbyggt i Node) skapas i `../tornstriden-data/` utanför Git-katalogen; `TORNSTRIDEN_DATA_DIR` väljer en annan plats. Serverkoden i `online/` och testfilerna kan inte hämtas via någon av servrarna och ingår inte i `deploy.sh`. I drift kör tjänsten bakom Apache med `TORNSTRIDEN_STATIC=0` (bara `/api/`), `SIGUSR1`/`SIGUSR2` växlar underhållsläge (inga nya matcher) och `drift/sakerhetskopia.mjs` kopierar databasen – allt i `DRIFT.md`.

## Uppdatera spelet på servern

Sedan onlinetjänsten finns görs en planerad uppdatering med `sudo drift/uppdatera.sh` (underhållsläge → väntar ut pågående matcher → säkerhetskopia → `git pull --ff-only` → `./deploy.sh` → omstart av tjänsten), se `DRIFT.md`. Enbart de statiska filerna uppdateras från Git-katalogen på servern med:

```sh
git pull --ff-only
./deploy.sh
node scripts/kontrollera-publicering.mjs /var/www/tornstriden   # inga saknade filer, allt stämplat, inga serverfiler
```

Standardmålet är `/var/www/tornstriden`, bredvid de andra projekten på servern.
Katalogen skapas om den saknas. Git-utcheckningen ska ligga separat från målet.
För ett annat mål, kör `./deploy.sh /absolut/sökväg/till/webbkatalog`. Skriptet
kräver Bash och vanliga Unix-verktyg, men inga Node-paket eller byggsteg.
Använd ett konto som har skrivrättigheter i målkatalogen.
Webbservern behöver redan vara inställd att visa statiska filer därifrån.

Skriptet hittar källfilerna utifrån sin egen plats. Det kopierar spelets HTML,
CSS, JavaScript (även lobbyn `lobby.html` och lagmatchen `lagmatch.html`, men aldrig
serverkoden i `online/` eller lagmotorn), bildresurser och licens samt skapar `index.html` från
matchen (`match.html`). I de kopierade html-, css- och js-filerna får varje referens
till skript, stilmallar, moduler och assets tillägget `?v=<Git-hash>` (se
avsnittet om cachning); källfilerna i Git rörs inte. Befintliga filer med samma namn skrivs över, inklusive `index.html`.
Andra filer i målkatalogen lämnas kvar. Uppdateringen sker fil för fil.
Git-historik, lokala inställningar och utvecklingsverktyg kopieras inte.

Du kan också ange målet via en miljövariabel:

```sh
export DEPLOY_DIR=/var/www/tornstriden
./deploy.sh
```

## Apache2 och HTTPS – första installationen

Webbadress: `https://tornstriden.landychev.se`.
Konfigurationen finns i `apache/tornstriden.landychev.se.conf` och använder
`/var/www/tornstriden` som webbrot. Apache serverar filerna direkt;
`npm start` behövs inte på servern.

Peka först domänens DNS-post (A och eventuell AAAA) på serverns publika IP-adress.
Port 80 och 443 behöver nå Apache utifrån, inklusive eventuell portvidarebefordran
till NAS:en. Certbot använder port 80 för domänkontrollen med Apache-pluginen.

Kör följande som root från Git-utcheckningen på Debian-servern när dessa filer
har hämtats dit. Installationen av konfigurationen görs en gång:

```sh
./deploy.sh /var/www/tornstriden
install -m 644 apache/tornstriden.landychev.se.conf /etc/apache2/sites-available/tornstriden.landychev.se.conf
a2ensite tornstriden.landychev.se.conf
apache2ctl configtest && systemctl reload apache2
```

Fortsätt när konfigurationstestet visar `Syntax OK` och omladdningen lyckas.
Kontrollera att `http://tornstriden.landychev.se` visar spelet.
Utfärda sedan certifikatet och aktivera omdirigering till HTTPS:

```sh
certbot --apache -d tornstriden.landychev.se --redirect
```

Certbot konfigurerar HTTPS i Apache. Om Apache-pluginen saknas i en
apt-installerad Certbot, installera den med `apt install python3-certbot-apache`
och kör kommandot igen.

Kontrollera förnyelsen för just detta certifikat:

```sh
certbot certificates
certbot renew --cert-name tornstriden.landychev.se --dry-run
systemctl list-timers --all | grep -i certbot
```

Använd certifikatnamnet som `certbot certificates` visar om det skiljer sig
från domännamnet. Certbot kan vara schemalagd via systemd eller cron beroende
på hur den installerats; om ingen timer visas, kontrollera den befintliga
installationsmetodens förnyelseschema.

### Cachning av spelets filer

Utan egna cachningsregler kan webbläsare återanvända gamla `.js`-, `.css`-, bild- och
ljudfiler i timmar efter en deploy (en vanlig omladdning kontrollerar bara själva
HTML-sidan mot servern) och blanda dem med nya. Två saker samverkar:

- `deploy.sh` versionsstämplar alla referenser i de kopierade filerna med `?v=<Git-hash>`
  (klockslag läggs till om utcheckningen har osparade ändringar). Varje deploy ger därmed
  nya adresser för skript, moduler, stilmallar, bilder och ljud, så webbläsaren hämtar
  dem på nytt utan hård omladdning och kan inte blanda ny HTML med gamla moduler.
- `apache/tornstriden-cache.conf` gör att HTML-sidorna (liksom skript och stilmallar)
  alltid valideras mot servern (oförändrade filer svarar med 304), så att den nya
  sidan med de nya adresserna visas direkt. Filen är fristående från de
  virtuella värdarna, gäller både HTTP och Certbots HTTPS-värd och rör inte deras
  inställningar. Installera en gång som root:

```sh
install -m 644 apache/tornstriden-cache.conf /etc/apache2/conf-available/tornstriden-cache.conf
a2enmod headers && a2enconf tornstriden-cache
apache2ctl configtest && systemctl reload apache2
```

Kontrollera med `curl -sI https://tornstriden.landychev.se/matchvy.js | grep -i cache-control`.

Vid kommande koduppdateringar räcker `git pull --ff-only` följt av `./deploy.sh`.
Kopiera inte om Apache-konfigurationen efter Certbot-körningen, eftersom det
kan skriva över Certbots HTTPS-omdirigering. Deployskriptet ändrar inte
Apache-konfigurationen eller certifikaten.

Referenser: [Apache VirtualHost](https://httpd.apache.org/docs/2.4/vhosts/)
och [Certbots Apache-instruktioner](https://certbot.eff.org/instructions?os=pip&ws=apache).

## Manuellt körda tester

```sh
npm test
```

Tester körs vid behov med kommandot ovan; ingen automatisk testkörning på GitHub är konfigurerad. Prototypen kräver inga externa paket; enbart `npm run preview` behöver Playwright.

## Förhandsvisningsbilder

De fyra `*-forhandsvisning.jpg` återskapas med:

```sh
npm install && npx playwright install chromium   # en gång
npm run preview
```

## Dokumentation

- [Drift av onlinespelet: installation, uppdatering, återgång, säkerhetskopior](DRIFT.md)
- [Utvecklingsplan: vad som är gjort och nästa steg](UTVECKLINGSPLAN.md)
- [Spelregler, inklusive de beslutade duellreglerna i avsnitt 13](SPELREGLER.md)
- [Plan för webbspel och grafik](WEBBSPEL.md)
- [Testbordets funktioner](PROTOTYP.md)
- [Specialkort och bildlager](EFFEKTKORT.md)
- [Målade kort, 3D-torn och bildprompter](GRAFIK.md)
- Ursprungligt arbetsmaterial: `kortspel.pptx`.

## Filer att börja i

| Fil | Ansvar |
| --- | --- |
| `kort.js` | Kortens namn, styrkor, texter och specialeffekter, samt bonuskonstanterna (`BONUS`) och maxliv. Kortets siffra härleds ur data. |
| `strid.js` | Regelberäkning för en enskild duell. Läser `BONUS` från `kort.js`. |
| `strid.test.js` | Tester för regelberäkningen. |
| `matchregler.js` | Beslutade duellregler, versionsbeteckningar, den låsta kortleken (kort-ID → antal), `buildDeck` och `battleCard` för enkel attack. |
| `matchregler.test.js` | Tester för kortlek, enkel attack och regelbesluten i del 1. |
| `match.js` | Matchmotorn: matchobjekt, kortexemplar, `newMatch`, `process` (alla handlingar med match-ID och revision), `playerView` och `allowedActions`. Läser aldrig HTML. |
| `match.test.js` | Tester för motorn, bland annat en hel referensmatch med förutbestämd lek. |
| `match.html`, `matchvy.js`, `match.css` | Matchvyn: visningsläge, `render()` från spelarvyn, handlingar som bara går genom `process()`, samt datorns avbrytbara paus och beslutsfel. |
| `dator.js` | Datormotståndaren: giltiga val ur spelarvyn, slump- och grundstrategi, strategivikter (`STRATEGY`). Ändrar aldrig matchen. |
| `dator.test.js` | Tester för datorns beslut och hela seedade matcher dator mot dator. |
| `ljud.js`, `ljud.test.js`, `assets/ljud/` | Musik, händelsestyrda effekter, ljudreglage och tester av uppspelningens livscykel. Ljudkällan finns i `scripts/skapa-ljud.py`. |
| `spelbord.html`, `spelbord.css`, `spelbord.js` | Spelbordet: ett `state`-objekt, en `render()` som målar allt, och handlingar som bara ändrar state. |
| `tokens.css` | Gemensamma färgtokens för ljust och mörkt läge. |
| `server.js`, `preview.js` | Lokal webbserver och skript som återskapar förhandsvisningsbilderna. |
| `online/server.js`, `online/*.js` | Onlinetjänsten: HTTP/SSE, sessioner, rum, duell- och lagmotor på servern, klockor, lagring (SQLite). Publiceras aldrig. |
| `lobby.html`, `lobby.js`, `lobby.css` | Lobbyn: nick, inbjudningar, lag, Redo, start – speglar serverns vy. |
| `lagmatch.html`, `lagmatchvy.js`, `lagmatch.css`, `onlinematch.js` | Lagmatchens vy och adaptern mot servern (kommandon, kvittenser, återanslutning). |
| `deploy.sh`, `scripts/kontrollera-publicering.mjs`, `drift/`, `apache/` | Publicering och drift: se `DRIFT.md`. |
| `textkort.html`, `kortoversikt.js` | Kortkatalogen. |
| `effekter.html`, `effektverkstad.js`, `effektverkstad.css` | Bildverkstaden. |
| `bildeffekter.js`, `bildeffekter.css`, `assets/effekter/` | Återanvändbara visuella lager. |

Förhandsvisningsbilderna förnyas med `npm run preview` när motsvarande sida ändras.

## GitHub

Repository: [landychev/tornstriden](https://github.com/landychev/tornstriden).

Arbeta från denna katalog, granska ändringarna, kör relevanta tester och skapa begripliga commits. GitHub lagrar versionshistoriken. Att pusha koden dit startar inte i sig någon spelserver.

Den befintliga licensen finns i [LICENSE](LICENSE).
