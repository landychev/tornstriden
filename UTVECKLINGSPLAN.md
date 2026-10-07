# Tornstriden – från prototyp till ett spel som går att spela tillsammans

**Datum:** 7 oktober 2026

**Status:** Plan och rekommenderad arbetsordning. Delarna nedan är inte implementerade om det inte uttryckligen står att de finns.

**Arbetskatalog:** Detta Git-repository, `tornstriden`.

## Nästa steg

Ja: nästa huvudområde är det som behöver fungera bakom spelbordet. Vi har nu tillräckligt mycket presentation för att börja bygga riktiga matcher.

Den första leveransen bör vara **en komplett lokal duell mot datorn**, från kortutdelning till vinst och omstart. Därefter använder vi samma regler på en server för privata matcher mellan människor. Till sist lägger vi till lagspel.

Det är en byggordning, inte en ändring av slutmålet. Slutmålet omfattar 1 mot datorn, 1 mot 1 och lagspel upp till 4 mot 4.

## Vad som redan finns

| Del | Nuvarande läge | Det som saknas |
| --- | --- | --- |
| Spelbord och torn | En fungerande förhandsvisning med klickbara kort och liv. | Visning av en hel pågående match. |
| Kort | 30 kortdefinitioner och tre olika testhänder. | En beslutad fördelning av korten i en riktig lek. |
| Stridsregler | `strid.js` avgör en duell, inklusive tio specialkort. | Matchens faser, draghögen, turordning och alla lagregler. |
| Kortbyten före start | Beskrivna i spelreglerna. | Utdelning och byte i programmet. |
| Dator | Förberedda motdrag går att välja manuellt. | En dator som själv väljer giltiga handlingar. |
| Nätverk | Ingen spelserver. | Rum, deltagare, meddelanden och privata spelvyer. |
| Sparande | Projektfiler och Git-historik. | Sparat matchläge och återanslutning. |
| Tester | 13 automatiska tester för kort och strid, inklusive många kombinationer. | Tester för hela matcher, nätverk och återhämtning. |

Att en specialeffekt klarar tester betyder att programmet följer dess beskrivning. Det bevisar inte att kortet är lagom starkt eller att matchen blir rolig.

## 1. Bestäm en första exakt regelversion

En dator kan inte resonera fram en ny regel när något oklart inträffar. Därför behöver varje situation som kan uppstå ha ett bestämt resultat.

Vi utgår från `SPELREGLER.md` och `EFFEKTKORT.md`, men håller deras öppna förslag synliga. Tidigare skisser räknas inte automatiskt som godkända regler bara för att en testvy använder dem.

### Regler som första matchversionen behöver låsa

1. Tre startliv och tio startkort per spelare.
2. Högst två bytestillfällen före start, med högst två kort varje gång.
3. Ett spelat kort per deltagare och strid i duellen.
4. Försvar lika med eller högre än attack stoppar anfallet.
5. Ett misslyckat försvar kostar ett liv; högre överstyrka ger inte mer skada.
6. Spelade kort slängs och ersätts inte ett och ett.
7. Vad som händer vid helt tom hand. Det nuvarande förslaget är fem nya kort efter striden.
8. Vem som anfaller efter striden. Prototypförslaget är att turas om oavsett resultat.
9. Vad en anfallare med enbart försvarskort får göra. Ett tidigare förslag är att använda ett valfritt kort som attack 1. Detta finns ännu inte i testbordet.
10. Exakt vad som händer när draghögen och slänghögen inte kan ge tillräckligt många kort.
11. När ett fallande torn avslutar matchen, i förhållande till läkning, motstöt och påfyllning.

### Trettio korttyper är inte en färdig kortlek

Kortkatalogen beskriver typerna. En riktig lek behöver också ange hur många exemplar av varje typ som finns.

Vi behöver en separat kortleksdefinition: exempelvis ett bestämt antal Stormning, Sköldmur, barriärer och varje specialkort. Det tidigare förslaget om 120 kort gäller inte automatiskt alla 30 nya typer. Att bara ta lika många av alla kort kan göra starka specialeffekter för vanliga.

Mitt förslag är en första fast testlek med större andel grundkort och färre specialkort. Antalen ska gå att ändra på ett ställe och kortleken ska ha en versionsbeteckning. Då går två provspelningar att jämföra.

**Klart när:** vi har en namngiven regelversion och en kortleksfördelning som täcker alla start-, strids- och slutsituationer i en duell.

## 2. Bygg ett gemensamt matchläge

Matchläget är spelets minne. Det beskriver exakt vad som är sant just nu, även om ingen sida för tillfället visar informationen.

Det ska bland annat innehålla:

- Matchens identitet, regelversion och kortleksversion.
- Spelläge, lag och deltagare.
- Varje spelares identitet, torn, liv, hand och status.
- Draghögen i dess aktuella ordning och alla kort i slänghögen.
- Aktuell fas: kortbyte, anfall, försvar, avgörande eller avslutad match.
- Vems tur det är och vilket torn som är målet.
- Kort som redan ligger i den pågående striden.
- Hur många startbyten varje spelare har använt.
- Matchens löpnummer eller revision, som ökar vid godkända förändringar.
- Vinnande lag om matchen är avslutad.

### Varje fysiskt kort behöver en egen identitet

Om leken innehåller tolv Stormning-kort måste programmet kunna skilja exemplaren åt. Typen kan heta `stormning`, men exemplaren behöver olika identiteter.

Annars finns risk att programmet tar bort fel kort, accepterar samma kort två gånger eller blandar ihop två likadana kort på handen.

### Grundkrav för matchläget

Ett exemplar får bara finnas på ett ställe åt gången: hand, draghög, stridsyta eller slänghög. Liv ska alltid ligga mellan noll och tre. En avslutad match får inte ta emot nya spelhandlingar.

**Klart när:** en match kan skapas, sparas som data och läsas tillbaka utan att kort eller turordning förändras.

## 3. Utöka stridsberäkningen till en matchmotor

Vi behåller `strid.js` som en byggsten. En ny matchmotor ansvarar för det som händer före och efter en enskild strid.

Spelmotorn ska ta emot en handling och antingen godkänna den eller förklara varför den inte är tillåten. Exempel är att byta två kort, välja ett mål, spela ett kort eller avstå försvar.

### Faser i en fullständig match

1. Skapa leken, blanda den och dela ut tio kort till varje spelare.
2. Genomför första och andra bytesmöjligheten. Kortbyten avslutas innan striden börjar.
3. Bestäm vem som anfaller först.
4. Ta emot anfallarens val av mål och kort.
5. Ta emot försvararens kort eller avstående.
6. Beräkna specialeffekter och resultat med stridsreglerna.
7. Uppdatera liv, släng spelade kort och hantera utslagna spelare.
8. Kontrollera om matchen är över. Om den är över sker ingen ny påfyllning eller ny tur.
9. Hantera tomma händer och eventuell omblandning enligt regelversionen.
10. Växla anfallare och börja nästa strid.

### Exempel på validering

Om en spelare försöker spela Eldklot ska motorn kontrollera att matchen pågår, att spelaren lever, att rätt fas pågår, att spelaren får agera och att just detta kortexemplar finns på spelarens hand.

Webbsidan ska alltså inte kunna skicka ”motståndaren förlorade ett liv” som en godkänd spelhandling. Den skickar sitt kortval. Motorn beräknar följden.

### Håll reglerna åtskilda från presentationen

Matchmotorn ska inte leta efter knappar, ändra HTML eller starta animationer. Den returnerar ett nytt matchläge och tydliga händelser, exempelvis ”kort spelat”, ”barriär stoppade attack” och ”torn förlorade ett liv”.

Slump, klocka och schemaläggning hanteras utanför den rena regelberäkningen. I tester kan vi ange en förutbestämd kortordning; i riktiga matcher blandar den ansvariga värden leken. En blandningsnyckel som kan avslöja framtida kort ska aldrig skickas till onlinespelarna.

**Klart när:** en hel duell går att spela via motorn utan spelbordets HTML och samma handlingar alltid ger samma resultat från samma startläge.

## 4. Koppla spelbordet till den riktiga matchen

Den nuvarande vyn har tre färdiga testhänder och manuella startliv. De är bra för att granska kort, men en riktig match ska visa motorns tillstånd.

Vi behöver därför lägga till:

- Startskärm med Ny match och val av läge.
- En riktig utdelad hand, inte ett av varje demonstrationskort.
- Kortbyte där högst två kort kan väljas och antalet återstående byten visas.
- Tydlig text om aktuell fas och vems tur det är.
- Bara de spelhandlingar som faktiskt är tillåtna just nu.
- Kort som försvinner från handen när deras spel har godkänts.
- Synlig återkoppling om varför en attack stoppades eller ett torn förlorade liv.
- En vinnarskärm och en funktion som startar en helt ny match.

Animationerna följer ett redan godkänt resultat. De ska inte avgöra vem som får agera eller hur mycket skada som sker. Den som stänger av animationer ska få exakt samma spel.

Kortkatalogen, bildverkstaden och testbordet kan behållas som egna sidor för utveckling och regelprovning.

**Klart när:** en spelare kan starta, spela och avsluta en hel match utan att justera startliv eller välja motståndarens drag manuellt.

## 5. Låt datorn fatta egna beslut

Datorn ska använda samma handlingar och samma regelkontroll som en människa. Den behöver ingen extern språkmodell.

Den får känna till sin egen hand, offentliga liv, handstorlekar, aktuella spelade kort och synliga slängda kort. Den får inte läsa spelarens hand eller ordningen i draghögen. Beslutsfunktionen ska få en begränsad spelvy, inte hela matchobjektet.

### Första datorn

- Vid startbyten: försök få en användbar blandning av attack och försvar.
- Vid anfall: välj ett giltigt kort och bedöm om ett värdefullt specialkort bör sparas.
- Vid försvar: välj ett kort som stoppar attacken om det är rimligt, och undvik onödigt hög försvarsstyrka.
- Bedöm läkning, sista-livet-bonus och barriärer utifrån den information datorn faktiskt ser.
- Om inget bra försvar finns: avstå enligt reglerna.

Vid anfall känner datorn inte till människans kommande försvar. Den får därför inte ”välja det perfekta kortet” genom att läsa motståndarens hand i bakgrunden.

Svårighetsgrader kan senare skilja sig genom mer genomtänkta beslut. De ska inte kräva extra liv, bättre kort eller dold information.

**Klart när:** en människa kan spela flera hela matcher mot datorn, och datorn varken fastnar, agerar efter matchslut eller gör otillåtna drag.

## 6. Gör matchen gemensam med en spelserver

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

## 7. Skicka uppdateringar och skydda hemliga händer

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

## 8. Bygg privata spelrum

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

## 9. Spara matchen och hantera avbrott

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

## 10. Utöka till 2 mot 2 och större lag

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

## 11. Testa mer än enskilda kort

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

## 12. GitHub och publicering

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
| 1. Fullständig lokal match | Dela ut, byta kort, spela flera strider, fylla på enligt reglerna och nå ett riktigt slut. |
| 2. Datorstyrd motståndare | Spela en hel duell ensam utan manuella motdrag. |
| 3. Privat 1 mot 1 online | Bjuda in en annan person och spela från olika webbläsare. |
| 4. Pålitlig återanslutning | Fortsätta efter omladdning eller nätavbrott och återhämta sparad match efter serveromstart. |
| 5. Lagspel | Hjälpa lagkamrater i fullständiga 2-mot-2-matcher, därefter större lag. |
| 6. Publik version | Låta andra spela via en stabil adress med kontrollerad drift. |

**Nästa konkreta koduppgift är leverans 1:** bygg matchläget, utdelningen, kortbytena och hela turordningen runt den befintliga stridsberäkningen. Börja med regel- och kortleksbesluten som krävs för just den leveransen.
