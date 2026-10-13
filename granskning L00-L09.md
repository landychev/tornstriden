# Granskning av L00–L09

Datum: 2026-10-13.
Granskad version: `cfa3a76` – Lägg till lobby och onlineduell (arbetsordning L00–L09).
Arbetskatalogen var ren när granskningen startade. Fynden nedan beskriver den ursprungliga granskningen; rättning och ny verifiering redovisas sist i filen.

## Bedömning

Det normala flödet från lobby till avslutad onlineduell fungerar i webbläsarprovet. Servern har transaktioner, privata spelarvyer, sessionsidentitet, startvillkor och deduplicering av matchkommandon. Det finns dock sex konkreta brister att hantera innan L00–L09 betraktas som genomgranskade.

P1 betyder hög prioritet: säkerhetsfel eller ett befintligt spelläge som inte fungerar. P2 betyder ett avgränsat beteende- eller testfel som bör rättas.

## R01 – P1: Nick tolkas som HTML och kan köra kod i motspelarens vy

**Berör:** L03, L07 och L09. `matchvy.js:282`, även namninterpoleringarna vid rad 272, 358 och 360 samt HTML-tilldelningarna.

Lobbyn använder textContent korrekt, men matchsidan infogar flera `nameOf(...)` direkt i HTML-mallar. Ett tillåtet nick kan därmed skapa element med händelsehanterare i den andra spelarens webbläsare. Säker hantering i själva lobbyn skyddar inte matchsidan.

**Bekräftat:** en isolerad gästs nick sattes till `<b onclick=top.z=1>` (19 tecken). Motspelaren öppnade matchsidan, stängde hjälprutan och klickade på den renderade väntetexten. `window.z` blev 1 i motspelarens webbläsare. Ingen skadlig åtgärd utfördes i provet.

**Rättningsförslag:** använd textContent för dynamiska namn eller den befintliga `html(...)`-funktionen vid varje namninterpolering i HTML. Granska alla namnvägar, inklusive väntetext, resultat, uppgiven match och nästa anfallare.

**Regressionstest:** nick med HTML visas bokstavligt på matchsidan under byte, väntan och resultat; inga nya HTML-element eller körbara händelseattribut skapas.

## R02 – P1: Lokalt tvåspelarläge kraschar efter första striden

**Berör:** L07. `matchvy.js:474–478`.

`syncViewer()` använder `adapter.local.activePlayer()` som betraktare i tvåspelarläget. Efter en avgjord strid sätter motorn `activePlayer` till null. Vyn skickar då null till `setViewer` och försöker hämta en spelarvy för en spelare som inte finns.

**Bekräftat i Chrome:** välj tvåspelarläge, behåll korten i samtliga bytesomgångar, börja striden, spela enkel attack och avstå försvar. Sidan kastar `Okänd spelare: null`. Resultatflödet kan inte fortsätta normalt. Befintligt webbläsarprov kontrollerar endast att handen byter spelare under kortbytet och missar detta.

**Rättningsförslag:** behåll en giltig betraktare under resultat, matchslut och felläge; byt handens ägare endast när nästa giltiga spelare ska agera.

**Regressionstest:** spela minst två strider samt matchslut och Ny match i lokalt tvåspelarläge. Kontrollera resultat/Fortsätt och frånvaro av sidfel. Datorläget ska fortfarande fungera.

## R03 – P1: Filspärren kan kringgås med kodade sökvägar

**Berör:** L02. `server.js:18–21`, som även används av onlineservern för lokala statiska filer.

Spärrkontrollen görs före normalisering av den avkodade sökvägen. En URL med kodade snedstreck kan därför passera spärren och sedan normaliseras till en förbjuden fil.

**Bekräftat mot serveFile:** `/online/server.js` gav 404, men `/x%2f..%2fonline/server.js` gav 200 och serverkoden. Även `/x%2f..%2f.git/HEAD` gav 200. Endast status och antal byte loggades för Git-filen.

**Rättningsförslag:** normalisera till en entydig sökväg innan åtkomst prövas; kontrollera även att upplöst fil ligger inom rätt rot. En uttrycklig lista över tillåtna klientfiler är säkrare än att försöka blockera vissa kataloger. Behåll separat datalagring och deploy-lista.

**Regressionstest:** råa och kodade varianter, dubbla snedstreck och normaliserade vägar mot serverkod, tester och Git-data ska avvisas. Giltiga klientfiler ska fortsätta fungera. Detta fynd avser utvecklingsservern; någon produktionsserver har inte granskats.

## R04 – P2: Städning av avslutade rum kan låsa spelare utanför lobbyn

**Berör:** L04, L08 och L09. `online/rum.js:325–326` samt återgången till lobbyn.

Efter matchslut har deltagarna aktiviteten FÖLJER_AVSLUT och referenser till rum/match. Städningen raderar avslutade rum efter en timme, men nollställer inte referenserna hos de deltagare som fortfarande visar resultatet. Att lämna kräver därefter ett rum som inte längre finns.

**Bekräftat med styrd klocka:** avsluta en duell med Ge upp, flytta tiden en timme plus en millisekund och städa. Sessionen är fortfarande FÖLJER_AVSLUT med roomId, medan rumsvyn är null. Lämna ger `Rummet finns inte längre`; skapa nytt rum ger `Du är redan i ett rum eller en match. Lämna det först.` Matchvyn går fortfarande att hämta.

**Rättningsförslag:** frigör berörda sessioners aktuella medlemskap atomärt före radering, eller behåll rummet tills de är frigjorda. En gammal rumsstädning får aldrig nollställa medlemskap i en ny match. Gör återgång till lobbyn tålig för ett redan borttaget rum.

**Regressionstest:** en spelare återkommer till resultatsidan efter städning och kan lämna, skapa nytt rum och ta emot nya inbjudningar. Matchhistorik och andra pågående medlemskap påverkas inte.

## R05 – P2: Kvittenskontrollen startar inte om HTTP-anropet hänger

**Berör:** L09. `onlinematch.js:35–37` och send-funktionen.

`maxForsok` begränsar försöken efter ett avslutat eller avvisat fetch-anrop. Själva HTTP-anropet och läsningen av svarskroppen saknar tidsgräns. Om servern tar emot draget men aldrig avslutar svaret stannar klienten på SKICKAR och når aldrig statusfrågan. Även status- och uppdateringsanropen kan hänga på samma sätt.

**Bekräftat med injicerad fetch:** ett anrop som förblir väntande ger bara ett fetch-anrop och pending=SKICKAR trots maxForsok=1 och omedelbara väntesteg. Ingen statusfråga påbörjas; koden innehåller ingen egen tidsgräns som kan bryta detta läge.

**Rättningsförslag:** lägg en begränsad timeout med avbrytning runt både HTTP-anrop och svarsläsning. Vid okänd kvittens ska samma commandId kontrolleras och eventuellt skickas om enligt befintlig policy; timeout betyder inte att servern säkert avvisat draget.

**Regressionstest:** låt första anropet aldrig ge svar respektive bara ge svarshuvuden. Klienten ska gå över till kvittenskontroll och till slut lämna vänteläget utan att skapa ett nytt drag. Detta gäller L09:s kvittenshantering, inte den fullständiga återanslutningen i L17.

## R06 – P2: Händelseströmtestet förutsätter en viss nätverkspaketering

**Berör:** verifieringen av L02/L03/L08. `online/server.test.js:65–74`.

Testet antar att första `reader.read()` innehåller både halsa och lobby och att följande läsningar innehåller exakt en puls. HTTP/SSE garanterar inte att nätverksblock motsvarar hela händelser: de kan delas eller sammanfogas.

**Bekräftat:** `npm test` gav 147 godkända av 148. Testet vid rad 58 misslyckades på rad 69 eftersom första läsningen endast innehöll halsa. Det är inte i sig bevis för fel i serverns utskick.

**Rättningsförslag:** buffra text, avkoda strömmande och läs tills den förväntade kompletta SSE-händelsen finns. Skilj händelsegränser från nätverksblock. Använd testtimeout och säker uppstädning om förväntad händelse uteblir.

**Regressionstest:** halsa/lobby levererade både i separata block, sammanfogade och delade mitt i en rad. Samma test ska lyckas utan beroende av paketgränser.

## Verifiering och begränsningar

- `npm test`, Node v26.3.1: **147/148 godkända**, ett bekräftat testfel enligt R06. Första körningen i begränsad miljö kunde inte öppna lokala portar; siffrorna avser den efterföljande körningen med fungerande lokal serveråtkomst.
- Befintligt `scripts/prova-online.mjs`: **9/9 kontroller godkända**, inklusive en hel duell med två separata sessioner, personlig resultatruta och återgång till lobbyn.
- Befintligt `scripts/prova-lobby.mjs`: **23/24 kontroller godkända**. Den sista kontrollen rapporterade ett resursanrop med 404 i konsolen; inbjudningar, lagval, värdbyte, extra flik och omladdning passerade. Vilken resurs det gällde framgår inte av det befintliga testets logg och behöver preciseras innan testet räknas som helt grönt.
- Webbläsarproven kördes med installerade Chrome och den tillgängliga Playwright-körmiljön. Tillfälliga kopior av provskripten ändrade endast importsökväg, projektsökväg och val av Chrome. Projektets egna skript ändrades inte. Separata testdatabaser och webbläsarkontexter användes.
- R01 och R02 kontrollerades dessutom med riktade webbläsarprov. R03 verifierades via filserverfunktionen, R04 via riktiga sessions-/rums-/duellmoduler med minnesdatabas och styrd klocka, R05 via onlineadapterns injicerbara nätfunktion.
- Befintliga sekretesskontroller i webbläsarprovet är inte heltäckande: de granskar vissa HTTP-svar och kvarvarande handkort, och filtrerar bort svar med strängen `"attack"`. De ersätter inte kontroll av alla privata vyer och SSE-händelser över hela matchen. Detta är en rekommenderad testförbättring, inte ett ytterligare bekräftat kortläckage.
- Fullständiga 30/90-timers, lagmotor, automatisk hantering av serveromstart och publik drift hör till senare uppgifter. Att de ännu saknas räknas inte som fel i L00–L09.
- Produktionsdrift, Safari/Firefox, hörbar ljudkvalitet och en verklig fysisk mobil har inte verifierats.

## Rekommenderad fortsättning

Rätta R01–R03 först, sedan R04–R06. Lägg regressionstesterna i samma ändringar som rättningarna och uppdatera L07/L09:s verifieringslogg med faktiska resultat. Fortsätt därefter med L10. Genomförandet av L00–L09 är omfattande, men nuvarande Klar-markering ska inte tolkas som att granskningen är utan anmärkning.


## Rättning efter granskningen – 2026-10-13

R01–R06 är rättade i arbetskatalogen:

- **R01:** samtliga namn som infogas i HTML-mallar skyddas, även etiketter på spelade kort. Riktigt webbläsarprov med både HTML-taggar och citattecken i nick kontrollerar väntan, två stridsresultat och uppgiven match.
- **R02:** tvåspelarläget behåller senaste giltiga betraktare när motorn saknar aktiv spelare under resultat och matchslut. Det lokala webbläsarprovet har utökats från ett kortbyte till flera strider, Fortsätt, matchslut och ny match.
- **R03:** filservern normaliserar innan åtkomstkontroll och tillåter bara uttryckliga klientfiler och media under assets. Upplösta symboliska länkar kontrolleras också. Tester täcker kodade sökvägar, felaktig URL-kodning och länkar till serverkod respektive utanför webbroten.
- **R04:** rumsstädningen frigör kvarvarande sessioner i samma transaktion som rummet raderas. Ett nytt medlemskap påverkas inte. Lobbyn får en uppdatering vid radering. Tester kontrollerar återgång, nytt rum, nya inbjudningar och bevarad matchhistorik.
- **R05:** varje HTTP-anrop får tio sekunders tidsgräns för både svarshuvuden och svarskropp. Därefter kontrolleras samma commandId enligt befintlig återförsökspolicy. Styrda tester täcker hängande anrop, statusfrågor, uppdateringar och sena svar utan extra effekt.
- **R06:** SSE-testet buffrar kompletta händelser och avkodar UTF-8 strömmande. Tester täcker separata, sammanfogade och bytevis delade block samt uteblivet svar med säker uppstädning.

Lobbyns tidigare 404-fel identifierades som `/favicon.ico`. Den statiska servern svarar nu 204 på detta automatiska anrop eftersom prototypen inte har en separat flikikon.

Ny verifiering:

- `npm test`: **155/155** godkända, Node v26.3.1.
- `scripts/prova-lobby.mjs`: **24/24** kontroller godkända.
- `scripts/prova-online.mjs`: **9/9** kontroller godkända, hel duell och återgång till lobbyn.
- `scripts/prova-regressioner.mjs`: samtliga kontroller godkända för HTML-liknande nick, kortetiketter, resultat och återgång efter städning. Inga sid- eller konsolfel.
- `scripts/prova-match.mjs`: **13/13** kontroller godkända: hel datormatch, fem strider i tvåspelarläge, Fortsätt, matchslut och ny match. Första körningen stannade i testverktygets klick på ”Enkel attack” (ett överlappande element rapporterades). Det riktade provet och omkörningen klarade samma klick och spelade färdigt utan ytterligare ändring i spelkoden; diagnostik har lagts till i skriptet om det återkommer.
- `deploy.sh` har körts mot en temporär katalog: rättade klientfiler kopieras med `?v=`-stämplade referenser. Källfiler och deploy-skriptets versionshantering är oförändrade av detta prov.
- Webbläsarproven använde installerade Chrome och separata testsessioner/minnesdatabaser. Tillfälliga skriptkopior pekade på den tillgängliga Playwright-installationen; projektets skript stödjer nu `PLAYWRIGHT_CHANNEL=chrome`.

Ändringarna är lokala. Ingen commit, push eller publicering har gjorts. Avgränsningarna för L10–L22 och plattformar som inte provats gäller fortsatt.
