# Tornstriden

Ett kortspel om två medeltidsborgar. Spelarna anfaller, försvarar sina torn och använder magi. Målet är att slå ut motståndarnas torn.

Detta repository är projektets huvudsakliga arbetskatalog. Nya filer och framtida ändringar hör hemma här.

## Nuvarande version

- 30 kortförslag, inklusive tio kort med specialeffekter.
- Ett spelbord med två torn och fristående teststrider.
- Beräkning av duellresultat, specialeffekter, läkning och livförlust.
- Sex transparenta bildlager och en verkstad där de kan provas på en egen bild.
- Automatiska tester för kort och stridsregler.

Det finns ännu ingen komplett match, datorstyrd motståndare eller server för onlinespel. Kortbalans och specialeffekter i lagspel behöver vidare arbete.

## Öppna prototypen

Prototypen är skriven som ES-moduler och behöver därför en lokal webbserver – att dubbelklicka på `spelbord.html` fungerar inte. Med Node.js installerat:

```sh
npm start
```

Öppna sedan [spelbordet](http://127.0.0.1:8765/spelbord.html), [kortöversikten](http://127.0.0.1:8765/textkort.html) eller [bildverkstaden](http://127.0.0.1:8765/effekter.html). Servern (`server.js`) har inga beroenden; en annan port väljs med `PORT=8080 npm start`. Den lokala förhandsvisningen är ingen publicering på internet.

## Uppdatera spelet på servern

Kör från Git-katalogen på servern efter att den senaste koden hämtats:

```sh
git pull --ff-only
./deploy.sh
```

Standardmålet är `/var/www/tornstriden`, bredvid de andra projekten på servern.
Katalogen skapas om den saknas. Git-utcheckningen ska ligga separat från målet.
För ett annat mål, kör `./deploy.sh /absolut/sökväg/till/webbkatalog`. Skriptet
kräver Bash och vanliga Unix-verktyg, men inga Node-paket eller byggsteg.
Använd ett konto som har skrivrättigheter i målkatalogen.
Webbservern behöver redan vara inställd att visa statiska filer därifrån.

Skriptet hittar källfilerna utifrån sin egen plats. Det kopierar spelets HTML,
CSS, JavaScript, bildresurser och licens samt skapar `index.html` från
spelbordet. Befintliga filer med samma namn skrivs över, inklusive `index.html`.
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

De tre `*-forhandsvisning.jpg` återskapas med:

```sh
npm install && npx playwright install chromium   # en gång
npm run preview
```

## Dokumentation

- [Utvecklingsplan och nästa steg](UTVECKLINGSPLAN.md)
- [Spelregler och öppna regelförslag](SPELREGLER.md)
- [Plan för webbspel och grafik](WEBBSPEL.md)
- [Prototypens funktioner](PROTOTYP.md)
- [Specialkort och bildlager](EFFEKTKORT.md)
- Ursprungligt arbetsmaterial: `kortspel.pptx`.

## Filer att börja i

| Fil | Ansvar |
| --- | --- |
| `kort.js` | Kortens namn, styrkor, texter och specialeffekter, samt bonuskonstanterna (`BONUS`) och maxliv. Kortets siffra härleds ur data. |
| `strid.js` | Regelberäkning för en enskild duell. Läser `BONUS` från `kort.js`. |
| `strid.test.js` | Tester för regelberäkningen. |
| `spelbord.html`, `spelbord.css`, `spelbord.js` | Spelbordet: ett `state`-objekt, en `render()` som målar allt, och handlingar som bara ändrar state. |
| `tokens.css` | Gemensamma färgtokens för ljust och mörkt läge. |
| `server.js`, `preview.js` | Lokal webbserver och skript som återskapar förhandsvisningsbilderna. |
| `textkort.html`, `kortoversikt.js` | Kortkatalogen. |
| `effekter.html`, `effektverkstad.js`, `effektverkstad.css` | Bildverkstaden. |
| `bildeffekter.js`, `bildeffekter.css`, `assets/effekter/` | Återanvändbara visuella lager. |

Förhandsvisningsbilder och `bildeffekter.zip` är sparade leveranser. Bilderna förnyas med `npm run preview` när motsvarande sida ändras; zip-filen när bildlagren ändras.

## GitHub

Repository: [landychev/tornstriden](https://github.com/landychev/tornstriden).

Arbeta från denna katalog, granska ändringarna, kör relevanta tester och skapa begripliga commits. GitHub lagrar versionshistoriken. Att pusha koden dit startar inte i sig någon spelserver.

Den befintliga licensen finns i [LICENSE](LICENSE).
