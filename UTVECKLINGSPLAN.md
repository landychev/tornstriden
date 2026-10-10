# Tornstriden – från prototyp till ett spel som går att spela tillsammans

**Datum:** 9 oktober 2026 (ursprunglig plan 7 oktober 2026)

**Status:** Leverans 1 (fullständig lokal match) och 2 (datorstyrd motståndare) är klara. Avsnitt 1 sammanfattar det som är byggt; avsnitt 2–8 är fortfarande plan och inte implementerade om det inte uttryckligen står att de finns.

**Arbetskatalog:** Detta Git-repository, `tornstriden`.

## Nästa steg

Nästa huvudområde är att göra matchen gemensam: en spelserver som kör samma matchmotor, privata matcher 1 mot 1 från olika webbläsare och återanslutning. Därefter lagspel.

Det är en byggordning, inte en ändring av slutmålet. Slutmålet omfattar 1 mot datorn, 1 mot 1 och lagspel upp till 4 mot 4.

## Vad som redan finns

| Del | Nuvarande läge | Det som saknas |
| --- | --- | --- |
| Regler | Duellregler beslutade som `duell-v1`, kortlek `duell-50-v1` (SPELREGLER.md avsnitt 13, `matchregler.js`). | Beslut om lagregler och balans efter provspel. |
| Kort | 30 korttyper och en låst lek med 50 exemplar. | Balansprövning av fördelningen. |
| Stridsregler | `strid.js` avgör en duell, inklusive tio specialkort. | Lagregler för specialeffekter (t.ex. vem Törnesköld träffar). |
| Matchmotor | `match.js` kör en hel duell: utdelning, startbyten, anfall, försvar, påfyllning, omblandning, vinst, Ge upp. | Lagspel, flera torn per sida, val av måltavla. |
| Matchvy | `match.html` spelar hela matchen mot datorn eller mot en person vid samma skärm. | Startskärm med rum och deltagare. |
| Dator | `dator.js` väljer giltiga drag från en begränsad spelarvy (strategi `dator-v1`). | Provspelningsprotokoll, justerade vikter, svårighetsgrader. |
| Nätverk | Ingen spelserver. | Rum, deltagare, meddelanden och privata spelvyer. |
| Sparande | Projektfiler och Git-historik. | Sparat matchläge och återanslutning; matchen försvinner vid omladdning. |
| Tester | 56 automatiska tester: kort, strid, regler/kortlek, matchmotor (inklusive en referensmatch) och dator (inklusive 30 seedade hela matcher). | Tester för nätverk och återhämtning; mänsklig provspelning. |

Att en specialeffekt klarar tester betyder att programmet följer dess beskrivning. Det bevisar inte att kortet är lagom starkt eller att matchen blir rolig.

## 1. Genomfört: regler, matchmotor, matchvy och dator

Byggt 9 oktober 2026 i tre steg. Allt körs i webbläsaren utan server; Apache serverar statiska filer och `match.html` är startsida.

### Regelbeslut (`duell-v1`, `duell-50-v1`)

Besluten finns i SPELREGLER.md avsnitt 13 och som värden i `matchregler.js`:
3 liv (maxliv 3), 10 startkort, två bytesomgångar med 0–2 kort, lottad första anfallare, växlande anfallare efter varje strid, ett attackkort och högst ett försvarskort per strid, lika styrka stoppar, ett liv per träff, enkel attack 1 (valfritt kort som vanlig icke-magisk attack utan specialeffekt), fem nya kort endast vid helt tom hand, omblandning av slänghögen när draghögen är slut, matchslut kontrolleras före påfyllning, Ge upp ger motståndaren vinsten utan att liv ändras, omladdning förlorar den lokala matchen.
Kortleken är en uttrycklig lista kort-ID → antal: två exemplar av varje kort utan specialeffekt, ett av varje specialkort, summa 50. Nya katalogkort ändrar inte leken utan ett nytt beslut.

### Matchmotor (`match.js`)

- Matchobjektet beskriver läget ensamt: spelare, liv, händer, draghög, slänghög, undanlagda startkort, fas (KORTBYTE, ANFALL, FÖRSVAR, RESULTAT, AVSLUTAD, FEL), aktiv spelare, pågående strid, senaste resultat, vinnare och avslutsorsak.
- Varje kort är ett exemplar med egen identitet; en bokföringskontroll efter varje handling kräver att varje exemplar finns på exakt en plats och att summan är 50.
- `process(match, handling)` är enda vägen för alla drag, från människa och dator. Svaret är GODKÄND (ny match, revision + 1), AVVISAD (matchen orörd) eller INTERNT_FEL (fasen FEL utan delvisa ändringar). Match-ID och revision kontrolleras, så gamla eller dubbla handlingar avvisas.
- Stridens resultat räknas av `resolve` i `strid.js`; enkel attack blir ett tillfälligt attack 1-kort via `battleCard` i `matchregler.js`.
- `playerView` ger en spelare bara sin egen hand och offentlig information; `allowedActions` listar tillåtna handlingar.

### Matchvy (`match.html`, `matchvy.js`, `match.css`)

Återanvänder spelbordets design. Fasta torn (Södra = A nederst, Norra = B överst), markera kort och bekräfta, uttryckligt val av enkel attack, Fortsätt som läspaus efter varje strid, Ny match och Ge upp med bekräftelse i sidan, matchlogg, knappar bundna till revisionen. Presentation: ett valt kort dras upp till sin ruta på stridsplatsen och sidan scrollar med, knapparna för anfall/försvar ligger på stridsplatsen (bytesknappen vid handen), bortbytta kort flyger till draghögen och nya kort delas ut med animation, stridsresultatet visas i en dialogruta med Fortsätt. Lägen: **Datorn** (standard) eller **Två spelare vid samma skärm**. Utvecklingsläget kan visa båda händerna, välja strategi och visa datorns beslut med skäl. Fungerar med tangentbord, i 360 px bredd och i mörkt läge.

### Dator (`dator.js`, strategi `dator-v1`)

- Får bara sin egen spelarvy och en egen beslutsslump; ändrar aldrig matchen.
- Startbyten: mål minst tre naturliga anfall och tre försvar; byter aldrig bort det som saknas.
- Anfall: varje giltigt kort (även enkel attack) bedöms med `resolve` mot inget försvar, Sköldmur, Runsköld och Magisk barriär; poäng = medelnytta − sparvärde. Avsiktligt begränsad: kan göra svaga val mot t.ex. Spegelsköld eller Törnesköld.
- Försvar: exakt beräkning av alla giltiga försvar och avstående mot det öppna anfallet med stridens startliv.
- Vikter i `STRATEGY`: vinst/förlust ±10000, eget liv 100, motståndarskada 80, flexibelt kort 2, specialförmåga 2, barriär 5. Påfyllningsbonus (`valueNewHand`) finns men är avstängd.
- Slumpstrategin finns kvar som utvecklingsalternativ.
- I matchvyn spelar datorn efter en 600 ms paus med högst ett väntande jobb per matchläge; beslutsfel ger Försök igen utan att matchen ändras.

### Öppet efter leverans 2

- Provspela mot datorn (förslag: tio matcher, fem med vardera startspelare) och anteckna matchlängd, svaga datorval och tekniska problem innan vikterna ändras.
- Bedöm om påfyllningsbonusen förbättrar spelet; håll den separat från grundstrategin.
- Balansprövning av 50-kortsleken.

## 2. Gör matchen gemensam med en spelserver

För en lokal duell kan allt köras i en webbläsare. För två personer på olika enheter behöver det finnas en gemensam instans som bestämmer vad som gäller.

Jag föreslår att servern använder samma JavaScript-baserade matchmotor som den lokala prototypen. Då slipper vi skriva en andra uppsättning regler för onlinespelet. Vi behöver inte byta ut hela gränssnittet för att göra detta.

Servern ska ansvara för:

- Att skapa och hålla igång matcher.
- Att dela ut kort och hålla draghögens ordning hemlig.
- Att koppla varje ansluten deltagare till rätt plats i rätt match.
- Att kontrollera varje handling innan något ändras.
- Att behandla matchens handlingar i en bestämd ordning.
- Att spara och skicka ut det godkända resultatet.

### En handling från klick till resultat

1. Spelaren väljer ett kort på spelbordet.
2. Webbläsaren skickar kortexemplarets identitet, eventuellt mål, ett unikt handlings-ID och den matchrevision spelaren såg.
3. Servern identifierar spelaren genom den giltiga sessionen, inte genom att lita på ett inskickat spelarnamn.
4. Servern kontrollerar att handlingen passar det aktuella matchläget.
5. Matchmotorn räknar fram resultatet.
6. Servern sparar det nya läget och registrerar att handlingen är behandlad.
7. Varje deltagare får sin egen tillåtna vy av resultatet.

### Dubbelklick och samtidiga handlingar

Om samma handlings-ID kommer två gånger ska ett kort bara spelas en gång. Servern återanvänder svaret från första gången. Om handlingen bygger på ett för gammalt läge behöver klienten få aktuell information och välja om vid behov.

Att bara gråa ut knappen i webbläsaren räcker inte: det kan fortfarande komma omförsök eller två meddelanden nära varandra. Uppdateringen och registreringen av handlingen behöver göras tillsammans.

**Klart när:** två webbläsare kan delta i samma match och servern avvisar dubbelspel, drag i fel fas och handlingar från fel deltagare.

## 3. Skicka uppdateringar och skydda hemliga händer

För realtidsöverföringen är WebSocket ett rimligt förstaval för detta turbaserade spel. Det ger en tvåvägsförbindelse där servern kan meddela webbläsarna när något har hänt. Detta är teknikvalet i planen, inte en redan byggd anslutning. [MDN:s beskrivning av WebSocket](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API).

Vårt spel kräver inga kontinuerliga positionsuppdateringar. Uppdateringar behövs främst vid anslutning, kortbyte, spelad handling, turbyte och matchslut.

### Tre nivåer av information

| Information | Vilka får se den? |
| --- | --- |
| Liv, lag, fas, antal handkort och öppet spelade kort | Matchens deltagare. |
| Kortexemplaren på en viss hand | Bara spelaren som äger handen. |
| Draghögens ordning och alla spelares fullständiga händer | Bara den ansvariga spelservern. |

Motståndarens hemliga kort ska inte finnas i meddelandet till webbläsaren. Det räcker inte att skicka dem och sedan rita baksidor ovanpå.

Samma försiktighet behövs i felmeddelanden, händelseloggar och felsökningsutskrifter. Ett kortbyte före start får exempelvis inte råka publicera vilka kort en spelare drog.

### Anslutningen är inte samma sak som behörighet

En öppen anslutning bevisar inte att personen får spela i vilken match som helst. Varje handling behöver kontrolleras mot deltagarens session och match. För publik drift behöver vi även krypterad anslutning, kontroll av meddelandenas format och storlek samt begränsningar för orimligt många anrop. Dessa principer stöds av [OWASP:s vägledning för WebSocket](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html).

**Klart när:** båda spelarna ser rätt resultat i rätt ordning, men en kontroll av den egna webbläsarens mottagna information inte avslöjar motståndarens hand.

## 4. Bygg privata spelrum

Första onlineläget behöver inte konton, ranking eller offentlig matchmaking. Ett privat rum räcker.

Flödet kan vara:

1. Värden väljer Skapa match och anger ett spelarnamn.
2. Servern skapar ett rum med en inbjudningskod eller länk.
3. En annan spelare ansluter och får den lediga platsen.
4. Båda markerar Redo.
5. Servern låser deltagarplatserna och startar utdelningen.

En rumskod hjälper en person att hitta matchen. Den ska inte i sig ge rätt att ta över en redan upptagen spelarplats. Återanslutning använder en separat sessionsidentitet.

Vi behöver också svar på vad som händer om rummet är fullt, koden är fel, värden lämnar innan start eller någon försöker ansluta efter start. Första versionen kan avvisa sena nyanslutningar men tillåta att tidigare deltagare kommer tillbaka.

**Klart när:** två personer på olika enheter kan skapa, ansluta till och avsluta en privat 1-mot-1-match utan manuella ingrepp.

## 5. Spara matchen och hantera avbrott

Två olika avbrott behöver lösas: en spelares webbläsare försvinner, eller själva servern startar om.

### Om en spelare laddar om eller tappar nätverket

- Servern behåller matchläget och spelarens plats.
- Återvändande spelare identifieras med sin session.
- Klienten får en ny, filtrerad ögonblicksbild av matchen.
- Spelaren fortsätter från rätt fas, med samma kort och liv.
- Ett drag som skickades precis före avbrottet får inte genomföras två gånger.

Vi bör börja med att pausa matchen under en kort återanslutningsperiod. Periodens längd och vad som händer därefter måste bestämmas. Att automatiskt låta en frånkopplad spelare förlora liv kan annars avgöra en match av tekniska skäl. En dator ska inte oväntat ta över utan en bestämd regel.

### Om servern startar om

Att bara hålla matchen i serverns minne räcker inte. För återhämtning behöver det finnas beständigt sparade matcher.

Vi behöver lagra exempelvis matchidentitet, regelversion, revision, kortordning, händer, fas, deltagarplatser och redan behandlade handlings-ID:n. Känsliga återanslutningsuppgifter ska hanteras separat från offentlig matchinformation.

För en första server på en enda instans kan en liten databas vara tillräcklig. Databasvalet bör bestämmas tillsammans med driftsmiljön. Flera serverinstanser kräver även samordning om vilken instans som äger en match; det behöver vi inte börja med.

**Klart när:** omladdning, tillfälligt avbrott och en kontrollerad serveromstart kan provas utan att handen delas om eller matchresultatet ändras.

## 6. Utöka till 2 mot 2 och större lag

Lagspel ska byggas på den fungerande duellmotorn, men laghjälp kräver flera nya beslut.

- Varje lag har ett torn per spelare.
- Anfallslaget väljer ett levande motståndartorn.
- Varje levande anfallare spelar högst ett kort eller avstår, i bestämd ordning.
- Den angripna spelaren och lagkamraterna väljer sina försvar i bestämd ordning.
- Alla bidrag räknas ihop först när deltagarna har agerat.
- Spelare med noll liv hoppas över och kan inte hjälpa till.

### Specialeffekterna behöver särskilda lagregler

Här finns verkliga designfrågor, inte bara programmering:

- Ska Isrustning minska ett utvalt attackkort eller hela lagets attack?
- Vems liv används för Sista anfallet om en lagkamrat lägger kortet?
- Vem återfår liv om någon hjälper till med Helande ljus?
- Vem förlorar liv av Törnesköld när flera spelare anfaller?
- Vilken styrka kopierar Spegelsköld när attacken består av flera kort?
- Hur hanteras flera barriärer utan att samma attackkort stoppas två gånger?

Det är därför specialkorten för närvarande är märkta som duellprototyper. Vi bör bestämma och testa lagversionerna innan de görs tillgängliga i 2-mot-2-läget.

**Klart när:** en hel 2-mot-2-match fungerar, alla bidrag räknas exakt en gång och utslagning inte låser turordningen. Först därefter testar vi 3 mot 3 och 4 mot 4.

## 7. Testa mer än enskilda kort

Vi bygger vidare på de tester som redan finns, i stället för att kasta bort dem.

### Regel- och matchtester

- Startbyten kan inte överstiga två tillfällen eller två kort per tillfälle.
- Ingen kortinstans dupliceras eller försvinner genom utdelning, strid och omblandning.
- Fel spelare eller fel korttyp kan inte agera i en fas.
- Påfyllning sker bara när den fastställda regeln tillåter det.
- Ett torn med noll liv kan inte återaktiveras av ett senare drag.
- Matchen slutar vid rätt tidpunkt.

### Nätverkstester

- Samma handling som levereras två gånger ger bara ett resultat.
- En gammal klient får rätt uppdatering när dess handling inte längre är giltig.
- Ett avbrott efter godkänd handling men före svaret leder inte till dubbelspel.
- Rätt spelare återfår sin plats, medan en annan session inte kan ta över den.
- Två matcher påverkar inte varandras spelare eller kort.
- Privata händer saknas i andra spelares meddelanden.

### Spelprovning och balans

Mät matchlängd, hur ofta kort tar slut, vilka kort som nästan alltid spelas direkt och hur ofta någon saknar meningsfulla val. Dator-mot-dator-matcher kan hitta tekniska låsningar, men mänskliga provspelningar behövs för att bedöma upplevelsen.

**Klart när:** varje leverans har relevanta automatiska tester och ett beskrivet manuellt provspel. Vi testar inte hela världen på nytt efter varje liten textändring.

## 8. GitHub och publicering

GitHub är platsen för källkod, historik och samarbete. Det är ett separat steg att köra webbsidan och spelservern på internet.

### Arbetssätt i repositoryt

1. Gör en avgränsad förändring.
2. Granska skillnaderna och kör de tester som förändringen berör.
3. Spara förändringen i en commit med ett begripligt namn.
4. Skicka den till GitHub.
5. Låt automatiska kontroller verifiera testerna när vi lägger till ett sådant arbetsflöde.

Den här importen görs till `main` enligt önskemålet. När utvecklingen växer kan större förändringar göras på arbetsgrenar och granskas innan de förs in i `main`.

### När vi är redo att publicera

Vi behöver välja var webbsidan, den långlivade spelservern och eventuell databas ska köras. Driftmiljön måste stödja den valda realtidsanslutningen och det sparande vi behöver.

Vi behöver också en fungerande adress med krypterad anslutning, separata inställningar för test och publik drift, synliga serverfel utan hemliga händer i loggarna samt möjlighet att återgå till en tidigare fungerande version.

Inget driftabonnemang, publik publicering eller ny tjänst ingår i denna planändring.

## Rekommenderade leveranser i ordning

| Leverans | Vad ni kan göra när den är klar |
| --- | --- |
| 1. Fullständig lokal match – **klar** | Dela ut, byta kort, spela flera strider, fylla på enligt reglerna och nå ett riktigt slut. |
| 2. Datorstyrd motståndare – **klar** | Spela en hel duell ensam utan manuella motdrag. |
| 3. Privat 1 mot 1 online | Bjuda in en annan person och spela från olika webbläsare. |
| 4. Pålitlig återanslutning | Fortsätta efter omladdning eller nätavbrott och återhämta sparad match efter serveromstart. |
| 5. Lagspel | Hjälpa lagkamrater i fullständiga 2-mot-2-matcher, därefter större lag. |
| 6. Publik version | Låta andra spela via en stabil adress med kontrollerad drift. |

**Nästa konkreta koduppgift är leverans 3:** en spelserver som kör samma `match.js`, privata rum och en spelarvy per webbläsare. Börja med avsnitt 2 och 3 ovan; matchmotorn behöver inte skrivas om.
