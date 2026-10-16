# Säkerhetsprov av Tornstridens produktionsserver

**Mål:** https://tornstriden.landychev.se/

**Utfört:** 16 oktober 2026, cirka 21:55–22:01 svensk tid.

**Metod:** försiktiga externa HTTP-/TLS-prov, egna tillfälliga gästsessioner och isolerade testrum/matcher. Kompletterande läsning av lokal serverkod. Inga andra spelares rum, inbjudningar eller matcher användes som testmål.

## Resultat

**Åtgärdsstatus efter granskningen:** rättningar har tagits fram och verifierats lokalt. Ursprungliga
produktionsobservationer nedan bevaras som testbevis. Servern har ännu inte uppdaterats med rättningarna.

Ingen kritisk eller hög sårbarhet bekräftades i de provade flödena. Åtkomstkontroll, sessionsskydd och sekretess för motståndarens kort fungerade i kontrollerna. Det finns däremot bekräftade brister i säkerhetsheaders, Origin-validering och hantering av felaktiga cookies.

De slutliga provomgångarna omfattar **90 kontroller: 82 godkända och 8 observationer**, grupperade nedan. Provskripten gjorde totalt 142 HTTP-anrop inklusive en omkontroll av kortsekretessen. Därutöver gjordes tre separata kontroller av HTTP-headers. Trafiken var sekventiell med korta pauser, med undantag för två egna händelseströmmar med normala livstecken under matchproven. Det var inget belastningsprov.

Alla åtta tillfälliga testgäster loggades ut. De två egna testmatcherna avslutades och testgästerna lämnade sina rum. Avslutade match-/rumsuppgifter kan finnas kvar tills serverns normala gallring körs. Tjänsten svarade normalt efter proven. Ingen driftkonfiguration eller programkod ändrades som del av säkerhetsprovet.

## 1. Säkerhetsheaders saknas — medel/låg prioritet

Startsidan och lobbyn svarade med HTTP 200 men utan följande headers:

| Header/skydd | Observation | Prioritet |
| --- | --- | --- |
| `Content-Security-Policy` | Saknas, inklusive `frame-ancestors` | Medel |
| `X-Frame-Options` | Saknas; inget observerat headerbaserat skydd mot inramning | Medel |
| `Strict-Transport-Security` | Saknas trots fungerande HTTPS-omdirigering | Medel |
| `X-Content-Type-Options` | Saknas | Låg |
| `Referrer-Policy` | Saknas; webbläsarens standard används | Låg |
| `Permissions-Policy` | Saknas | Låg |

**Åtgärd:** konfigurera headers i Apaches värd för denna webbplats. Prioritera skydd mot inramning och HSTS. Anpassa CSP till spelets faktiska skript, stilmallar, ljud, bilder och händelseströmmar och verifiera spelvyerna innan policyn verkställs. Avsaknad av CSP bevisar inte att en XSS-sårbarhet finns; någon sådan bekräftades inte här. Ett faktiskt klickkapningsförsök i webbläsare genomfördes inte.

Bakgrund: [OWASP HTTP Security Response Headers](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html).

## 2. Origin-kontrollen jämför inte alltid hela ursprunget — låg/medel prioritet

**Bekräftat mot produktion:** ett POST-anrop till `/api/session` med `Origin: http://tornstriden.landychev.se` och den avsiktligt ogiltiga kroppen `{"nick":"x"}` gick vidare till nickvalideringen och gav HTTP 400. Det avvisades alltså inte av Origin-kontrollen med HTTP 403.

Som jämförelse avvisades saknad Origin, ett främmande ursprung och ett värdnamn med ett tillagt angripardomänsuffix med HTTP 403. Ingen session skapades i dessa negativa prov.

**Kodorsak:** `tillatetUrsprung()` i `online/server.js` jämför även `new URL(origin).host` med begärans Host. Den jämförelsen skiljer inte HTTP från HTTPS. HTTPS-omdirigeringen och cookies med `SameSite=Lax` begränsar risken; provet visar inte att en godtycklig annan webbplats kan ta över en session.

**Åtgärd:** jämför exakt ursprung, inklusive protokoll och port, mot en uttrycklig lista. Lägg till ett regressionstest för samma värdnamn med fel protokoll. Se [OWASP om verifiering av ursprung](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#using-standard-headers-to-verify-origin).

## 3. Felaktig cookie ger HTTP 500 — låg prioritet

**Bekräftat mot produktion:** `GET /api/session` med `Cookie: tornstriden_session=%ZZ` gav HTTP 500 och det generiska svaret `{"message":"Internt fel."}`. Ingen stacktrace eller hemlig information lämnades ut. Tjänsten fortsatte svara normalt.

**Kodorsak:** cookietolkningen i `online/server.js` anropar `decodeURIComponent()` utan att fånga ogiltig procentkodning.

**Åtgärd:** behandla en sådan cookie som ogiltig eller avvisa begäran med HTTP 400. Lägg till test för felaktig procentkodning även i en cookie som inte är sessionskakan.

## 4. Trafikbegränsning bör verifieras separat — kodobservation

`online/session.js` tillåter högst 200 levande gästsessioner totalt. Den granskade Node-koden innehåller ingen begränsning per IP för att skapa sessioner. En aktör som kan fylla den gemensamma kvoten kan hindra nya gäster från att komma in.

Detta provocerades **inte** på produktionsservern. Eventuellt skydd i Apache eller annan nätutrustning verifierades inte, så frånvaro av sådant externt skydd är inte fastställd. Rekommendationen är att kontrollera den effektiva trafikbegränsningen och lägga till en måttlig begränsning som fungerar även för flera spelare bakom samma adress. Betrodda proxyheaders måste hanteras korrekt om IP-baserat skydd införs.

## Godkända kontroller

- HTTPS-certifikatet är giltigt och betrott. TLS 1.3 förhandlades. Certifikatet gäller till 7 januari 2027.
- HTTP omdirigerar med 301 till HTTPS. TRACE gav HTTP 405.
- Den kända Node-porten 8766 avvisade anslutning från testdatorn. Detta är ingen generell brandväggsgranskning.
- 20 provade interna fil-/katalogvägar och kodade sökvägsvarianter gav HTTP 400, 403 eller 404. Bland dem fanns Git-data, miljöfil, serverkod, SQLite-filer och drift-/testskript. Ingen kataloglista visades för `/assets/`.
- `/api/lobby`, `/api/match`, `/api/status` och `/api/handelser` krävde en giltig session. En påhittad token gav HTTP 401.
- Gästerna fick separata identiteter och tokens. Sessionscookies hade `Secure`, `HttpOnly` och `SameSite=Lax`. Utloggning gjorde de första testgästernas cookies ogiltiga.
- Främmande ursprung och vilseledande värdnamn avvisades. Ingen CORS-behörighet lämnades till testets främmande ursprung.
- Felaktig JSON gav HTTP 400. Små anrop som överskred applikationens tillåtna storlek gav HTTP 413, även med giltig session.
- En utomstående testgäst kunde inte välja lag, sätta Redo, starta eller lämna en annan testgästs rum. Den kunde inte heller acceptera en inbjudan adresserad till någon annan.
- En deltagare som inte var värd kunde inte starta testrummet. Identitetsförfalskning i kommandon och försök att läsa en annan gästs kvittens avvisades.
- Upprepning av ett redan godkänt kommando skapade inte ett nytt rum. Okända kommandon, inklusive `__proto__` och `constructor`, gav HTTP 400.
- I den isolerade duellen fick varje deltagare sina egna tio kort. Motståndarens handexemplar, sessionshemligheter och draghögens ordning saknades i de kontrollerade privata HTTP-svaren och matchhändelserna.
- Utomstående kunde inte hämta eller ge upp testmatchen. Drag utanför turordningen och användning av motståndarens kortexemplar avvisades utan ändrad matchrevision.

## Provnotering och underlag

Den första kortkontrollen jämförde delsträngar och gav två falska larm för liknande kort-ID. Kontrollen ändrades till jämförelse av hela JSON-strängvärden och kördes om i en ny isolerad match. Samtliga 23 matchkontroller passerade då. Inget kortläckage bekräftades.

Sanerade lokala provresultat, utan sessionscookies eller handkort:

- `/tmp/tornstriden-security-results.json` — 67 kontroller, 59 godkända, 8 observationer; 62 anrop.
- `/tmp/tornstriden-security-match-initial-results.json` — första matchprovet med de två falska larmen; 40 anrop.
- `/tmp/tornstriden-security-match-results.json` — omkontroll med exakt kort-ID-jämförelse; 23 av 23 godkända; 40 anrop.
- `/tmp/tornstriden-lobby-security-headers.txt` och `/tmp/tornstriden-api-security-headers.txt` — separata headersvar. API:ets hälsosvar använder `Cache-Control: no-store`.

Ingen överbelastning, massregistrering, lösenordsprovning eller påverkan på befintliga spelares matcher ingick. Operativsystemets patchnivå, SSH, filrättigheter, återläsning av säkerhetskopior, alla TLS-varianter och en fullständig XSS-/injektionsgranskning omfattas inte av detta prov. De godkända kontrollerna är därför avgränsade observationer, inte en garanti för hela serverns säkerhet.

## Åtgärder framtagna lokalt

- Origin jämförs nu exakt med den konfigurerade listan, eller med det egna fullständiga ursprunget när listan är tom. Fel protokoll, port eller värd kan inte använda den tidigare reservvägen.
- Ogiltig procentkodning i cookies ignoreras utan HTTP 500. En felaktig annan cookie stör inte en giltig spelarsession.
- Apache-konfigurationen innehåller CSP, skydd mot inramning, HSTS för HTTPS, `nosniff`, Referrer-Policy och Permissions-Policy. Inline-stilar behövs för befintlig kortgrafik; inline-skript tillåts inte.
- Nya gästsessioner begränsas till 20 försök per klientadress och minut, med HTTP 429 och `Retry-After`. Befintliga sessioner, livstecken och speldrag räknas inte. Kvoten kan anpassas för många spelare bakom samma IP.
- Apache skriver över `X-Tornstriden-Client-IP`, som Node bara betror från loopback. Ett prov genom den riktiga lokala proxyn visade att en förfalskad klientheader inte ger nya kvoter.
- `drift/sakra-apache.sh` installerar den uppdaterade proxyfilen på en befintlig server, bevarar API-porten, tar kopia, testar konfigurationen och återställer filen vid fel. Certbots värdar ändras inte. Installationsstegen finns i `DRIFT.md`.

**Lokal verifiering:** hela testsviten 286/286. Apache 2.4.67 godkände konfigurationen och skickade HTTP 200 med säkerhetsheaders, samt HSTS endast över HTTPS. Origin- och cookieproven passerade genom proxyn. Registreringsprovet gav HTTP 429 även när klienten försökte byta den betrodda IP-headern.

I webbläsaren kontrollerades startbyten, anfall, resultatdialog, ljudinställningar och lobbyns inloggning/händelseström med CSP aktiverat. Även kortöversikten, testbordet och effektverkstaden öppnades utan konsolfel; inga trasiga bilder hittades där. Själva installationsskriptet har syntaxkontrollerats, men installationen och efterkontrollen på Debian-servern återstår.
