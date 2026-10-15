# Arbetsordning för AI-agent – lobby och onlinespel

Status: L00–L15 klara 2026-10-14 (granskningsfelen R01–R06 och de sex bristerna från granskningen av L10–L15 rättade) och L16 klar 2026-10-15 – etapp 1–4 är klara; separata webbläsare kan spela lagmatcher för 4/6/8 med egen vy för varje deltagare, och varje väntande val har 90 sekunders spelarklocka. L17 (återanslutning med fortsatt spel) är nästa.
Skapad: 2026-10-13.
Projekt: `/Users/landy/Documents/Claude/Projects/kort-spel/tornstriden`.
Regelunderlag: [implementera lobby.md](<implementera lobby.md>), beslut 1–27.

## Rekommenderat arbetssätt

Genomför en numrerad uppgift åt gången. Varje uppgift ska ge en avgränsad, granskbar ändring och dokumenterade kontroller. Gruppera uppgifterna i sex etapper med ett fungerande delresultat efter varje etapp. Börja med L00.

De 27 besluten beskriver spelets beteende, inte 27 fristående kodändringar. Flera beslut behöver samma kod, och vissa berör både regler, server och gränssnitt. Tabellen längst ned visar var varje beslut ska byggas och verifieras.

Det här dokumentet bryter ned arbetet; huvudplanen är fortsatt källa för spelreglerna. Vid skillnad mellan dokumenten ska agenten utgå från användarens senast bekräftade beslut och rätta dokumentationen. Äldre prototyptexter är bakgrund, inte nya krav. Att läsa detta dokument är inte i sig en beställning att genomföra alla uppgifter eller publicera spelet.

## Sex etapper

| Etapp | Uppgifter | Testbart delresultat |
| --- | --- | --- |
| 1. Grund och lobby | L00–L06 | Separata gäster kan gå in, bjuda in, välja lag och bli redo. Matchstart öppnas bara för färdiga matchformat. |
| 2. Onlineduell | L07–L09 | Två personer kan spela en hel match via servern med hemliga händer. Lokalt datorläge fungerar fortfarande. |
| 3. Lagregler | L10–L13 | Lagmatcher för 4/6/8 spelare kan köras i regeltester, inklusive specialkort och avhopp. |
| 4. Spelbart lagläge | L14–L15 | Separata webbläsare kan spela lagmatcher med rätt vy för varje deltagare. |
| 5. Avbrott och återkoppling | L16–L19 | Tidsgränser, återanslutning, serveromstart, ljud och animationer följer planen. |
| 6. Slutkontroll och drift | L20–L22 | Hela flödet är verifierat, publiceringspaketet kontrollerat och eventuell beställd lansering genomförd. |

Etapp 1–4 är utvecklingsleveranser. De är inte redo för publik användning innan avbrottshanteringen och slutkontrollerna är klara. Onlineduellen är ett tekniskt delmål; hela beställningen omfattar lagspel.

## Gemensamma instruktioner till kodagenten

1. Läs aktuell uppgift, dess hänvisade avsnitt och beroenden. Kontrollera aktuellt Git-läge och tillämpliga projektinstruktioner. Utgå från dagens filer, inte en gammal commit eller antagandet att arbetskatalogen är ren.
2. Bevara användarens egna ändringar. Radera eller återställ inte orelaterat arbete. Behåll dagens duellregler, datorläge, ljud, långtryck och versionsstämpling i `deploy.sh`.
3. Håll uppgiften avgränsad. Gör bara nödvändiga stödändringar och dokumentera dem. Om en uppgift blir för stor, dela den i exempelvis L11a/L11b med egna kontroller och beroenden.
4. Servern avgör drag, slump, liv, turer och vinnare. Klienten får bara sin privata spelarvy. Även felmeddelanden, loggar och utvecklingspaneler måste respektera dolda händer.
5. Använd testbar slump och klocka i regel-/servertester. Lägg inte långa verkliga väntetider i tester för 30/90 sekunder.
6. Kontrollera först befintliga skript i `package.json`. Dagens testkommando är `npm test` (`node --test`). Lägg meningsfulla tester för uppgiftens beteenden, fel och samtidiga händelser; kör relevanta regressionstester när gemensam kod berörs.
7. Redovisa vad som faktiskt körts och vad som inte gick att verifiera. Dokumentation, en skiss eller en startad server räcker inte som bevis på fungerande flerspelarläge.
8. Markera klart först när uppgiftens kriterier är uppfyllda och resultaten finns i överlämningen. Börja inte automatiskt på en annan uppgift när beställningen gäller en enda.
9. Commit, push och publicering följer den aktuella användarbeställningen. Den här planeringen beställer inga sådana åtgärder. När de är beställda behövs ingen extra bekräftelse enbart på grund av denna arbetsordning.

## Återstående detaljval

L00 samlar tekniska arbetsförslag och skiljer dem från beslut 1–27. Agenten kan föreslå och dokumentera vanliga tekniska lösningar inom den beställda uppgiften. Fråga användaren endast när ett olöst val faktiskt ändrar spelupplevelsen eller kräver information som saknas; gör då färdigt oberoende arbete under tiden.

Det som särskilt behöver få ett konkret värde eller beteende inför berörd uppgift:

| Detalj | Hanteras senast i | Underlag |
| --- | --- | --- |
| Node-stöd, lagring och WebSocket-bibliotek | L02 | Huvudplan §4 och §11. SQLite och separat Node-tjänst är förslag, inte redan installerade delar. |
| Nickregler, sessionslivslängd och flikhantering | L03 | Huvudplan §5. Dokumentera cookiehantering både lokalt och bakom HTTPS. |
| Inbjudningstid, gränser, frånkoppling före start och städning | L04–L05 | Huvudplan §6. 25A avser att lämna rummet; skilj detta från ett tillfälligt nätavbrott. |
| Första anfallande lag/spelare, fast platsordning och utdelningsordning | L10–L12 | Huvudplan §7. Rotationen enligt 21A är redan beslutad. |
| Ingen ansluten spelare kvar samt utslagens möjlighet att följa matchen | L15–L17 | Arbetsförslag i huvudplan §10. Dolda händer ska alltid förbli dolda. |
| Varningstid före 90-sekundersgränsen | L16 | Huvudplan §9. Själva 90-sekundersgränsen är fast. |
| Kapacitetsmål, gallring, övervakning och driftåtkomst | L20–L22 | Huvudplan §11–13. Åtta deltagare i en match säger inte hur många samtidiga matcher servern klarar. |

## Uppgiftslista och status

L00–L15 är klara; övriga uppgifter är **Ej startade**. Beroenden anger lägsta krav; rekommenderad körordning är nummerordning. Ingen parallell agentkörning behövs för detta upplägg.

| ID | Uppgift | Beroenden | Status |
| --- | --- | --- | --- |
| L00 | Nuläge och detaljval | Inga | Klar 2026-10-13 |
| L01 | Gemensamma kontrakt och teststöd | L00 | Klar 2026-10-13 |
| L02 | Spelserver och beständig lagring | L01 | Klar 2026-10-13 |
| L03 | Gästsession och lobbylista | L02 | Klar 2026-10-13 |
| L04 | Rum och inbjudningar | L03 | Klar 2026-10-13 |
| L05 | Lagval, Redo och startvillkor | L04 | Klar 2026-10-13 |
| L06 | Lobbygränssnitt | L05 | Klar 2026-10-13 |
| L07 | Privat spelarvy i befintligt spel | L01 | Klar 2026-10-13 |
| L08 | Serverstyrd duell och kommandon | L02, L03, L05, L07 | Klar 2026-10-13 |
| L09 | Spelbar onlineduell | L06, L08 | Klar 2026-10-13 |
| L10 | Lagkortlek och kortbokföring | L01 | Klar 2026-10-13 |
| L11 | Lagstridens effektberäkning | L10 | Klar 2026-10-13 |
| L12 | Lagmatchens faser och turordning | L11 | Klar 2026-10-13 |
| L13 | Individuell utslagning och avhopp | L12 | Klar 2026-10-13 |
| L14 | Lagmotor kopplad till servern | L08, L13 | Klar 2026-10-13 |
| L15 | Lagvy och val av mål | L09, L14 | Klar 2026-10-14 |
| L16 | Spelarklockor och gemensamma bekräftelser | L14, L15 | Klar 2026-10-15 |
| L17 | Återanslutning med fortsatt spel | L16 | Ej startad |
| L18 | Matchavbrott vid serveromstart | L02, L14, L17 | Ej startad |
| L19 | Ljud, animationer och tydliga besked | L15–L18 | Ej startad |
| L20 | Samlat flödes- och belastningstest | L03–L19 | Ej startad |
| L21 | Publiceringspaket och driftinstruktion | L20 | Ej startad |
| L22 | Beställd lansering och driftkontroll | L21 samt aktuell beställning av lansering | Ej startad |

### L00 – Nuläge och detaljval

**Mål:** ge nästa agent ett verifierat utgångsläge.
**Underlag:** huvudplan §1–2 och tabellen med detaljval ovan; `package.json`, projektinstruktioner och befintliga tester.
**Gör:** läs Git-status och aktuella moduler, kör befintliga tester och notera redan existerande fel. Samla berörda tekniska förslag med ansvarig uppgift. Verifiera lokal miljö; markera serverstöd som okänt om driftåtkomst saknas.
**Avgränsning:** ingen spelkod, installation, commit, push eller publicering i denna uppgift.
**Klart när:** baslinje, testresultat, relevanta lokala ändringar och verkliga frågor är dokumenterade. L01 kan starta utan att återupptäcka projektets struktur.

### L01 – Gemensamma kontrakt och teststöd

**Mål:** server, regler och vy använder samma tydliga gränser.
**Underlag:** huvudplan §4 och §8; `match.js` och dess befintliga privata vy.
**Gör:** definiera minsta nödvändiga format för session, rum, lag, kommando, kvittens, händelse och privat vy. Skilj `rosterVersion`, matchrevision och händelse-ID. Bestäm adaptergräns för lokal/online och duell/lag. Förbered teststöd med styrd klocka, slump och separata spelarsessioner.
**Avgränsning:** ingen stor omskrivning av spelmotorn eller nytt gränssnittsramverk.
**Klart när:** format och validering kan provas med konkreta meddelanden; inga hemliga händer ingår i offentliga objekt. Senare uppgifter vet vad de ska ta emot och returnera.

### L02 – Spelserver och beständig lagring

**Mål:** en lokal tjänst kan ta emot anslutningar och spara sammanhängande ändringar.
**Underlag:** huvudplan §4 och §11; dagens `server.js` är statisk server.
**Gör:** välj kompatibla beroenden, separat startkommando och lagring. Inför databasstruktur, migrering och transaktionsgränser för tillstånd, händelser och kvittenser. Håll lagring utanför statisk webbrot även lokalt. Förbered ordnade kommandoköer och injicerbar klocka/slump.
**Avgränsning:** ingen produktionsinstallation; återuppta inte gamla matcher efter omstart. Fram till L18 ska en start med gamla aktiva matcher blockera matchtrafik tydligt.
**Klart när:** tjänsten startar lokalt; sparat testdata överlever processomstart; misslyckad lagring ger varken delvis sparat drag eller godkänd kvittens. Serverkod/databas kan inte hämtas som statiska filer.

### L03 – Gästsession och lobbylista

**Mål:** varje gäst har en egen stabil identitet och ser tillgängliga spelare.
**Underlag:** huvudplan §5; beslut 4A.
**Gör:** nickval, session, aktuell lobbylista och anslutningsstatus. Hantera nickkrockar, säkra kakor, Origin-kontroll, sessionsutgång och extra flik. Identifiera genom sessionen, aldrig enbart nick.
**Avgränsning:** inga konton, chatt eller ranking.
**Klart när:** separata webbläsarsessioner får olika identiteter; omladdning behåller egen identitet; någon annans nick ger inte tillgång till dennes session. HTML-liknande nick visas som text och hemligheter saknas i lobby/loggar.

### L04 – Rum och inbjudningar

**Mål:** flera accepteranden går till samma rum utan dubbla medlemskap.
**Underlag:** huvudplan §3 och §6; beslut 1B.
**Gör:** skapa rum, bjuda in markerade personer, acceptera, avböja, återkalla och låta inbjudan löpa ut. Lägg till gränser mot spam. Spara medlemskap och inbjudningsändringar atomärt; deduplicera kommandon.
**Avgränsning:** ingen matchmotor kopplas in här.
**Klart när:** första acceptansen lämnar andras inbjudningar öppna; samtidig acceptans av två rum ger ett medlemskap; dubbelklick ger inte dubbla deltagare. Fullt/stängt rum och utgången inbjudan ger begripliga svar.

### L05 – Lagval, Redo och startvillkor

**Mål:** endast värden kan starta en giltig uppställning.
**Underlag:** huvudplan §6; beslut 6A, 7B, 9B, 25A.
**Gör:** två självvalda lag, Redo kopplat till aktuell uppställning, startvalidering och värdbyte vid avhopp. Förbered matchskapande bakom ett gränssnitt som L08/L14 implementerar. Rum och match ska senare sparas i samma starttransaktion.
**Avgränsning:** låtsas inte starta en spelbar match innan rätt motor är ansluten. Testdubbel är tillåten i tester; ofärdiga format är spärrade i användarflödet.
**Klart när:** 2/4/6/8, jämna lag och alla anslutna/redo krävs; gamla uppställningar avvisas. Värdavhopp väljer längst ansluten kvarvarande deltagare och nollställer Redo. Start och sen acceptans kan inte skapa olika deltagarlistor.

### L06 – Lobbygränssnitt

**Mål:** första etappen går att prova med riktiga separata gäster.
**Underlag:** huvudplan §3, §5–6; föreslagna filer `lobby.html`, `lobby.js`, `lobby.css`.
**Gör:** nickformulär, lista, markering, inbjudningsbesked, rum, lagval, Redo, värdstart och Lämna. Anslut till L03–L05 och visa serverbekräftat läge.
**Avgränsning:** ingen kopia av serverreglerna i klienten; ofärdiga matchformat visas som ännu ej tillgängliga.
**Klart när:** flödet fungerar i minst fyra separata sessioner och mobilbredd. Fokus överlever listuppdateringar, tangentbord fungerar och fel visar hur spelaren kommer vidare.

### L07 – Privat spelarvy i befintligt spel

**Mål:** matchvyn behöver inte läsa hela matchobjektet.
**Underlag:** huvudplan §2 och §8; `matchvy.js`, `match.js`, `dator.js`.
**Gör:** inför överenskommen adapter med privat vy, tillåtna val och händelser. Behåll lokal motor och datorlogik bakom lokaladapter. Egen identitet ska vara separat från aktiv spelare. Ta bort beroendet av dolda händer och `instances` i renderingen.
**Avgränsning:** behåll dagens spelregler och utseende. Utvecklingsverktyg som visar andra händer får inte följa med online.
**Klart när:** en hel lokal datormatch, kortbyte, långtryck, ljud och resultatruta fungerar; onlinelägets renderingsväg kan köras med endast en privat vy och innehåller inga dolda kortdata.

### L08 – Serverstyrd duell och kommandon

**Mål:** två sessioner kan spela med dagens duellmotor på servern.
**Underlag:** huvudplan §4, §6 och §8; `duell-v1`.
**Gör:** koppla starttransaktionen till duellmotor; mappa sessioner till motorplatser. Ordna handlingar, validera identitet/tur/revision och spara tillstånd, händelser och kvittens tillsammans. Inför privata svar, kommandofingeravtryck och statusfråga för okänd kvittens. Lägg in start-/Fortsätt-bekräftelser utan att klienten kan hoppa över motståndaren.
**Avgränsning:** ännu inga lagmatcher eller tidsförluster; ingen publik lansering.
**Klart när:** en hel duell kan styras av två testklienter; felaktig tur och främmande kort avvisas. Samma kommando får effekt en gång, ändrad nyttolast med samma ID avvisas och lagringsfel lämnar inget godkänt osparat drag. Två samtidiga Fortsätt ger en övergång.

### L09 – Spelbar onlineduell

**Mål:** två människor kan starta från lobbyn och spela till resultat.
**Underlag:** huvudplan §8–9; L06–L08.
**Gör:** onlineadapter, väntande drag, serverbekräftad vy, kvittenshantering och väg mellan lobby/match/resultat. En gammal kvittens får inte skriva över nyare läge. Stäng lokal datorstyrning online.
**Avgränsning:** robust nätåteranslutning färdigställs i L17; visa tydlig anslutningsstatus redan här.
**Klart när:** två separata webbläsarsessioner spelar hela matchen. Tappad kvittens kan kontrolleras utan extra drag; nätverkssvar innehåller endast rätt hand. Lokalt datorläge fungerar fortfarande.

### L10 – Lagkortlek och kortbokföring

**Mål:** lagmatcher har rätt antal unika kort och inga kort försvinner eller dupliceras.
**Underlag:** huvudplan §7; beslut 11A, 22A, 23A; `matchregler.js`, `kort.js`.
**Gör:** egen låst lagregel-/kortleksversion, 100/150/200 kort, startutdelning, två bytesomgångar och tomhands-påfyllning. Behåll duellens 50 kort. Normalisera enkel attack till vanlig attack 1 utan specialeffekt.
**Avgränsning:** ingen ändring av kortfördelning när en spelare slås ut; ingen stridsvy.
**Klart när:** 4/6/8 spelare kan göra maximala byten; varje exemplar finns på exakt ett ställe. Endast helt tomma levande händer får upp till fem kort, ett per varv, och slänghögen blandas vid behov. Enkel attack tappar kortets ursprungliga magi/bonus.

### L11 – Lagstridens effektberäkning

**Mål:** samma kvarvarande kort och startliv ger samma förklarbara resultat.
**Underlag:** hela effektordningen och räkneexemplen i huvudplan §7; beslut 14A–20A, 23A.
**Gör:** ren beräkningsfunktion för stopp, bonusar, spegling, summering, frost, genombrott, träff, läkning och motstöt. Bind kortmål till exemplar och spelarmål till person. Returnera resultat/händelser utan att ändra originalkorten.
**Avgränsning:** inga nätanrop, timers eller direkt ändring av levande matchdata. Duellens `strid.js` behåller sitt beteende.
**Klart när:** samtliga räkneexempel stämmer; kopiering sker före frost, Drakeld får rätt bonus och flera effekter summeras. Borttaget mål ger inget omval, stoppat Vampyrbett läker inte, motstötar summeras före utslagning och liv/styrka går inte under 0.

### L12 – Lagmatchens faser och turordning

**Mål:** en hel lagmatch kan spelas genom rena kommandon.
**Underlag:** huvudplan §7 och §9; beslut 6A, 10A, 21A–23A.
**Gör:** startbyten, startbekräftelser, roterande målansvar, anfallskö, försvarskö, stridsavgörande, kortslängning, påfyllning, resultat/Fortsätt och lagvinst. Koppla L10/L11. Välj och dokumentera första tur enligt detaljregistret.
**Avgränsning:** inga timers eller UI; externa avhopp tillkommer i L13.
**Klart när:** fulla matcher för 4/6/8 fungerar med högst ett kort per person, rätt hjälpordning och inga dubbla fasövergångar. Lag med kort måste bidra till anfallet; alla kan använda enkel attack. Normala livsbaserade utslagningar tas bort ur köer.

### L13 – Individuell utslagning och avhopp

**Mål:** en person kan lämna utan att felaktigt avsluta lagets match.
**Underlag:** huvudplan §7 och §10; beslut 8A, 12B, 13A, 17A, 24B.
**Gör:** gemensam utslagningsfunktion som senare timers kan använda. Släng hand/bordskort en gång, räkna om effekter och ta bort väntande val/bekräftelser. Hantera måltavlans avhopp, sista lagmedlemmen och slutligt tomt anfall.
**Avgränsning:** inget automatiskt lagbyte, ingen datorersättare eller retroaktiv ändring av sparat resultat.
**Klart när:** avhopp i alla faser lämnar inga låsta köer. 1 mot 4 kan fortsätta. 13A avbryter utan effekter; 24B ger lyckat försvar och giltig läkning. Matchslut prövas före fortsatt strid, och redan avgjort resultat ändras inte av sent Lämna.

### L14 – Lagmotor kopplad till servern

**Mål:** samma serverflöde kan välja duell eller lagmatch vid start.
**Underlag:** huvudplan §4, §6 och §8; L08 och L10–L13.
**Gör:** välj regelmotor utifrån 2/4/6/8 deltagare. Lås version, medlemskap och lag i starttransaktionen. Skicka privat vy till varje plats och låt samma kö/lagring hantera lagkommandon, avhopp och kvittenser.
**Avgränsning:** ingen ny parallell implementation av lagregler i nätlagret.
**Klart när:** separata testklienter kan spela 4/6/8; samtidiga matcher läcker inga kort eller händelser. Ett gammalt matchkommando påverkar inte en ny match. Påstående om eget teamId eller spelar-ID kringgår inte sessionen.

### L15 – Lagvy och val av mål

**Mål:** varje deltagare förstår sin roll och kan göra tillåtna val på mobil och dator.
**Underlag:** huvudplan §3, §7–9; befintliga `match.html`, `match.css`, `matchvy.js`.
**Gör:** visa eget torn och hand nära kontrollerna, lagkamrater och fiendetorn, turansvarig, vald måltavla och spelade bidrag. Lägg till målval för Barriär, Försegling, Spegelsköld och Törnesköld samt tydligt avstående. Visa utslagning och lagresultat separat.
**Avgränsning:** inga dolda lagkamratshänder. Behåll långtryck och tidigare lösning för lättillgänglig hand; ändra inte godkänd spelregel för att förenkla vyn.
**Klart när:** alla platser i 4/6/8-spelarmatch går att spela, inklusive ojämna lag. Mobilspelaren når kort och bekräftelse utan att växla mellan långt åtskilda delar av sidan. Giltiga mål och skillnaden mellan eget nederlag och lagets slutresultat är tydliga.

### L16 – Spelarklockor och gemensamma bekräftelser

**Mål:** obesvarade nödvändiga val kan inte stoppa matchen för alltid.
**Underlag:** huvudplan §9–10; beslut 3A, 8A.
**Gör:** serverstyrda deadlines på 90 sekunder, varning/nedräkning och individuell utslagning via L13. Omfatta kortbyte, målval, kortspel, avstående, startbekräftelse och Fortsätt. Serialisera timerhändelser med kommandon.
**Avgränsning:** vanlig väntan på andra förbrukar ingen turtid; markering, felaktiga drag och omladdning återställer inte klockan.
**Klart när:** styrd klocka visar korrekt beteende precis före/på deadline. Samtidiga förluster behandlas tillsammans; utslagna blockerar aldrig Fortsätt och dubbla timerhändelser får effekt en gång. Både onlineduell och lagmatch omfattas.

### L17 – Återanslutning med fortsatt spel

**Mål:** personligt nätavbrott följer 30/90-reglerna och 26B.
**Underlag:** huvudplan §8 och §10; beslut 2A, 8A, 26B.
**Gör:** livstecken, avbrottsidentifiering, anslutningsgeneration, egen deadline och sammanlagd budget. Pausa bara den frånkopplades vanliga turtid. Återställ aktuell privat vy och väntande kommandostatus; respektera redan utförda drag och bekräftelser.
**Avgränsning:** ingen global paus. Flikbyte/omladdning skickar inte automatiskt Ge upp. Serveromstart behandlas separat i L18.
**Klart när:** andra kan agera tills ett val från den frånkopplade krävs. Tiden startar inte om när turen kommer; gammal close får inte fälla ny anslutning. Sista budgetresten ger kortare frist. Testa tappad kvittens, två flikar, alla frånkopplade och återkomst på båda sidor om deadline. Kort/liv kan ändras under avbrottet och återkomst visar det nya läget.

### L18 – Matchavbrott vid serveromstart

**Mål:** ett serverfel ger ingen falsk vinst eller återupplivad match.
**Underlag:** huvudplan §11; beslut 27B.
**Gör:** innan speltrafik öppnas efter omstart, avbryt tidigare pågående matcher utan vinnare och frigör medlemskap. Behåll sparade slutresultat och kvittenshistorik. Visa avbrottsorsak och väg till lobbyn. Ta bort den tillfälliga startspärren från L02 när detta är verifierat.
**Avgränsning:** ingen 60-sekunders återkomstfrist och ingen återupptagning av gamla matcher. Inga budgetavdrag eller individuella förluster för serverfelet.
**Klart när:** verklig processomstart under match, under sparande och under uppstädning ger säkert terminalt läge. Gamla drag startar inte om något; lagringsfel blockerar öppning i stället för att ge falsk kvittens. Nya matcher kan skapas efter uppstädning.

### L19 – Ljud, animationer och tydliga besked

**Mål:** återkopplingen hör till rätt person, lag och händelse.
**Underlag:** huvudplan §2 och §8–10; befintliga ljud och animationer.
**Gör:** koppla kortbyte, kortspel, anfall/försvar, livsförlust, utslagning och lagvinst till serverbekräftade händelser. Visa startspelare, anslutningsväntan, tidsvarning och serveravbrott. Deduplicera effekter med händelse-ID.
**Avgränsning:** återanvänd godkända ljud; generera inga nya ljud i denna uppgift. Animationer får inte avgöra regler eller styra serverns klocka.
**Klart när:** varje ny händelse spelas upp högst en gång, återanslutning är tyst för historiken och gammal kvittens inte startar gammal animation. Lagkamrats avhopp ger inte ljudet för hela lagets förlust. Ljudinställningar och långtryck fungerar fortsatt.

### L20 – Samlat flödes- och belastningstest

**Mål:** verifiera hela beställningen, inte bara en lyckad duell.
**Underlag:** samtliga kontrollpunkter i huvudplan §13 och beslutstäckningen nedan.
**Gör:** testa hela lobby–match–resultat-flödet med 2/4/6/8 separata sessioner, flera samtidiga matcher, ojämna lag, mobilvy och verkliga nätavbrott. Inspektera nätverkssvar och statisk filåtkomst. Mät mot ett dokumenterat kapacitetsmål. Testa missbruk av kommandon och inställda begränsningar.
**Avgränsning:** belastning körs i lokal eller avsedd testmiljö; åtta flikar i samma session räknas inte som åtta spelare.
**Klart när:** kontrollpunkterna är kopplade till testbevis; relevanta befintliga tester är gröna och kvarvarande fel dokumenterade. Fel som hindrar korrekt spel, privat data eller avbrottshantering åtgärdas före färdigmarkering.

### L21 – Publiceringspaket och driftinstruktion

**Mål:** en granskbar release går att installera utan att exponera serverdata eller förstöra versionsstämplingen.
**Underlag:** huvudplan §11; `deploy.sh` och Apache-konfigurationen.
**Gör:** förbered serverstart, proxy, HTTPS, lagringsplats, loggning, migrering, säkerhetskopiering och återställning. Uppdatera klientfillistan och verifiera stämplingen av alla nya importer/assets, även eventuella underkataloger. Förbered kompatibilitetskontroll, stopp för nya matcher och dokumenterad återgång till tidigare release.
**Avgränsning:** använd en separat lokal publiceringskopia. Att förbereda release är inte att installera eller publicera på den riktiga servern.
**Klart när:** publiceringskopian går att öppna utan saknade filer; serverkod/databas/hemligheter ingår inte. En gammal klient får begripligt versionsbesked. Planerad uppdatering låter matcher bli klara; tvingad omstart följer 27B. Driftbehov som inte kunnat verifieras anges uttryckligen.

### L22 – Beställd lansering och driftkontroll

**Mål:** genomföra publicering när den ingår i användarens aktuella beställning.
**Underlag:** verifierad L21-leverans och åtkomst till den valda servern, beslut 5A.
**Gör:** verifiera driftstöd, installera release enligt instruktionen och prova via riktig HTTPS-adress. Kontrollera lobby, en hel duell/lagmatch, processövervakning, avbrottsbesked och säkerhetskopiering. Återgå enligt planen om kritiska kontroller misslyckas.
**Avgränsning:** saknad driftåtkomst hindrar endast denna uppgift och andra verkliga serverkontroller; den gör inte lokalt arbete ogjort. Genomför ingen lansering enbart för att uppgiften finns i dokumentet.
**Klart när:** publicerad version, driftkontroller, eventuella begränsningar och återgångsväg är dokumenterade. Kapacitet ska beskrivas utifrån mätning, inte antas från lokal provkörning.

## Spårbarhet – alla 27 beslut

| Beslut | Byggs främst i | Verifieras särskilt i |
| --- | --- | --- |
| 1B samma rum för flera inbjudna | L04 | L06, L20 |
| 2A återanslutning 30/90 | L17 | L17, L20 |
| 3A 90 sekunder per väntande val | L16 | L16, L20 |
| 4A nick utan konto | L03 | L03, L06 |
| 5A samma server | L02, L21 | L22 |
| 6A 2/4/6/8 deltagare | L05, L10, L14 | L20 |
| 7B självvalda jämna lag | L05, L06 | L20 |
| 8A individuell utslagning | L13, L16, L17 | L20 |
| 9B värden startar | L05, L08, L14 | L20 |
| 10A lagstrid och hjälp | L11, L12, L15 | L20 |
| 11A skalad kortlek | L10 | L10, L20 |
| 12B ta bort avhoppares kort | L13 | L13, L17 |
| 13A måltavlans avhopp | L13 | L13, L17 |
| 14A försvarsspecial vid hjälp | L11, L15 | L11, L20 |
| 15A läkning till ägaren | L11 | L11, L20 |
| 16A vald motstötsmottagare | L11, L15 | L11, L20 |
| 17A inget omval vid försvunnet mål | L11, L13, L15 | L13, L20 |
| 18A summera likadana effekter | L11 | L11, L20 |
| 19A spegling före frost | L11 | L11, L20 |
| 20A Drakeld mot valfritt blått försvar | L11 | L11, L13 |
| 21A roterande turordning | L12, L15 | L12, L20 |
| 22A fem kort till tom hand | L10, L12 | L12, L20 |
| 23A enkel attack | L10, L11, L15 | L11, L20 |
| 24B tomt anfall räknas försvarat | L11, L13 | L13, L20 |
| 25A ny värd före start | L05, L06 | L05, L20 |
| 26B övriga spelar under avbrott | L17 | L17, L20 |
| 27B avbryt vid serveromstart | L18 | L18, L21, L22 |

## Startinstruktion att ge kodagenten

Kopiera texten nedan för det första arbetspasset. Byt senare L00 till nästa uppgifts-ID vars beroenden är klara.

```text
Arbeta i /Users/landy/Documents/Claude/Projects/kort-spel/tornstriden.
Läs arbetsordning lobby.md och utför enbart L00 – Nuläge och detaljval.
Läs även de avsnitt i implementera lobby.md som uppgiften hänvisar till.
Bevara mina befintliga ändringar och följ beslut 1–27.
Kontrollera vad som faktiskt finns i projektet; anta inte att tidigare uppgifter är gjorda.
Dokumentera testresultat, kvarstående frågor och överlämning i arbetsordning lobby.md.
Markera L00 klar först när dess kriterier är uppfyllda.
Ändra ingen spelkod och gör ingen commit, push eller publicering i detta arbetspass.
```

För en senare koduppgift används samma upplägg med rätt ID och omfattning; ersätt sista raden med vad som faktiskt är beställt om kodändring, commit, push och publicering. Om användaren beställer en hel etapp kan agenten fortsätta uppgift för uppgift inom etappen när respektive kontroll är klar.

## Överlämning efter varje uppgift

Lägg en ny daterad post under loggen nedan. Håll den kort men tillräcklig för att en ny agent ska kunna fortsätta utan att läsa hela chatten.

```text
Uppgift och datum:
Status: Ej startad / Pågår / Blockerad / Klar
Genomfört och ändrade filer:
Verifiering: exakta kommandon/scenarier och deras resultat
Inte verifierat / återstående fel:
Tekniska val och eventuella användarsvar:
Beroenden som nu är klara:
Rekommenderad nästa uppgift:
Commit: endast om en commit faktiskt gjorts inom beställd omfattning
```

### Logg

2026-10-13: Arbetsordning skapad. L00–L22 är ej startade. Inga speltester har körts som del av denna dokumentuppdelning och ingen implementation eller publicering har gjorts.

Uppgift och datum: L00 – Nuläge och detaljval, 2026-10-13
Status: Klar
Genomfört och ändrade filer: endast detta dokument (statusrad för L00 och denna loggpost). Ingen spelkod, installation, commit, push eller publicering.
Verifiering:
- `git status --short --branch` på Macen: `main...origin/main`, ren utcheckning förutom de ospårade filerna `arbetsordning lobby.md` och `implementera lobby.md`. HEAD = `b6c6bf9` (Använd godkänt glidljud när ett kort spelas), samma utgångspunkt som huvudplanen anger.
- `npm test` (node --test): 65 tester, 65 godkända, 0 fel, ca 120 ms. Fördelning: dator.test.js 18, strid.test.js 15, match.test.js 14, matchregler.test.js 9, ljud.test.js 9. Inga redan existerande fel.
- Lokal miljö (Mac): Node v22.23.2, npm 10.9.8. `node_modules` saknas – `playwright` i devDependencies är inte installerat och används bara av `preview.js`, inte av testerna. Inbyggda `node:sqlite` finns i Node 22 (ExperimentalWarning vid import). `sqlite3`-kommandot saknas lokalt.
- `package.json`: scripts `start` (statisk server.js på 127.0.0.1:8765), `test`, `preview`. `"type": "module"`, inga runtime-beroenden.
- `server.js` är en ren statisk filserver (ingen WebSocket, ingen lagring). `deploy.sh` publicerar en uttrycklig fillista plus `assets/` med `?v=<githash>`-stämpling; serverkod ingår inte i listan.
- Projektinstruktioner: ingen CLAUDE.md/AGENTS.md finns; README.md, UTVECKLINGSPLAN.md, SPELREGLER.md och WEBBSPEL.md är de styrande texterna utöver huvudplanen.
Inte verifierat / återstående fel:
- Driftmiljön på `debian-nas` (Node-version, processövervakning, `mod_proxy_wstunnel`, skrivbar katalog utanför webbrot) kunde inte nås från arbetspasset. Serverstöd markeras **okänt** tills användaren bekräftar; påverkar L02 (val av SQLite-bindning) och L21–L22.
- Inga webbläsartester kördes; befintliga tester är rena enhetstester.
Nulägesobservationer för L01/L07 (ingen ändring gjord):
- `match.js` har redan `playerView(match, playerId)`, `allowedActions`, `process`, `audit`, `revision` och injicerbar `random`/`shuffleFn` – rätt grund för privat vy och server.
- `matchvy.js` läser fortfarande hela matchobjektet: `match.instances` (rad 66, 431), `match.players[*].hand` (rad 161, 447, 579), `match.phase`, `match.activePlayer`, `match.lastResult` samt utvecklingspanelen `other-hand` som renderar motståndarens hand. Det är de beroenden L07 ska ta bort.
- `opponentOf` och `PLAYERS` (A/B) är hårdkodade i `match.js`; duellmotorn behålls, lagmotorn blir egen modul enligt huvudplan §2.
- `matchregler.js` exporterar `RULES_VERSION = 'duell-v1'` och `DECK_VERSION = 'duell-50-v1'`; lagversioner läggs bredvid i L10.
Tekniska val (förslag, inte beslut 1–27) och ansvarig uppgift:
- L02: Node ≥ 22 krävs lokalt redan i dag. Förslag: inbyggt `node:sqlite` (inget npm-beroende, WAL-läge, transaktioner) om servern också kör Node ≥ 22.5; annars `better-sqlite3`. WebSocket: `ws` (etablerat, litet). Separat startkommando `npm run online` → `online/server.js` (lyssnar på egen port, Apache proxar `/ws` med mod_proxy_wstunnel). Databasfil i `TORNSTRIDEN_DATA_DIR` (standard `../tornstriden-data`, aldrig i webbrot eller Git; läggs i `.gitignore`).
- L03: nick 2–20 synliga tecken efter trim, inga kontrolltecken, unikhet skiftlägesokänsligt bland aktiva sessioner; session = slumpad 256-bitars token i HttpOnly-cookie, `SameSite=Lax`, `Secure` när `X-Forwarded-Proto: https` eller `TORNSTRIDEN_SECURE=1`; endast token-hash i databasen; livslängd 24 h glidande; Origin kontrolleras mot tillåten lista; en styrande anslutning per session, extra flik får besked.
- L04–L05: inbjudan löper ut efter 120 s; högst 8 öppna inbjudningar per avsändare och högst 1 inbjudan per sekund; att lämna rummet (25A) är ett uttryckligt kommando, nätavbrott före start markeras FRÅNKOPPLAD och tas bort ur rummet efter 60 s; tomma rum stängs direkt; stängda rum/utgångna inbjudningar gallras efter 1 h.
- L10–L12: första anfallande lag lottas av servern med injicerbar slump; platsordning = ordningen spelarna gick med i laget; utdelning ett kort i taget med start hos första anfallaren. Dokumenteras i L12.
- L15–L17: om ingen ansluten spelare finns kvar avbryts matchen efter 90 s utan vinnare; utslagna får följa matchen med samma publika vy som övriga (inga händer) tills resultatet visas.
- L16: varning vid 30 s kvar, nedräkning de sista 10 s; 90-sekundersgränsen är fast.
- L20–L22: kapacitetsmål föreslås till 10 samtidiga matcher (upp till 80 anslutningar) på NAS:en, att mätas i L20; gallring av avslutade matcher efter 7 dagar; drift via systemd-tjänst med `Restart=on-failure`.
Beroenden som nu är klara: L00.
Rekommenderad nästa uppgift: L01 – Gemensamma kontrakt och teststöd. Innan L02 bör användaren bekräfta Node-version och Apache-moduler på servern (se Inte verifierat).
Commit: ingen.

Uppgift och datum: L01 – Gemensamma kontrakt och teststöd, 2026-10-13
Status: Klar
Genomfört och ändrade filer:
- Nya: `kontrakt.js` (format och validering för session, inbjudan, rum/lag, kommando, kvittens, händelse, privat vy; hemlighetsregel; adaptergräns), `teststod.js` (styrd klocka, styrd slump, separata testsessioner, samlare), `kontrakt.test.js` (18 tester), `KONTRAKT.md` (sammanfattning för senare uppgifter).
- Oförändrade: all befintlig spelkod, `matchvy.js`, `deploy.sh`, `package.json`. `kontrakt.js` finns ännu inte i deploy-listan; läggs till när första klientfilen importerar den (L06/L09). `teststod.js` ska aldrig publiceras.
Verifiering:
- `npm test`: 83 tester, 83 godkända (65 befintliga + 18 nya), 0 fel.
- Konkreta meddelanden provas i `kontrakt.test.js`: giltiga/ogiltiga kommandon (fel protokollversion, saknad revision/roomId, påstådd identitet, för stort), kvittens med/utan fingeravtryck, offentlig/privat händelse, rum med dubbletter/okänd värd/nio deltagare, privat vy med annans hand. Hela matchobjektet från `newMatch` faller på `instances`; dagens `playerView` passerar för rätt spelare och faller för fel spelare.
- Fingeravtryck: samma innehåll med annat commandId eller annan nyckelordning ger samma avtryck; annat exemplar eller annan revision ger annat.
- Styrd klocka: timers vid 30 s och 90 s körs i rätt ordning utan verklig väntan, timer registrerad inuti en timer hinner förfalla, avbokad timer körs inte.
Inte verifierat / återstående fel: inga kända. Kontraktet är ännu inte kopplat till någon server eller vy (det är L02/L07).
Tekniska val och eventuella användarsvar:
- ID-format: sessions-, rums-, match- och kommando-ID matchar `[A-Za-z0-9_-]{1,64}`; kortexemplar får kolon (`m1:kort:48`) som i `matchregler.js`.
- Lagnamn föreslås ”Södra laget”/”Norra laget” (A/B) för att följa duellens torn; kan bytas i `TEAMS` utan andra ändringar.
- Kommandostorlek högst 2048 tecken; fingeravtryck med FNV-1a (jämförelse, inte säkerhet). Reserverade lagkommandon `VÄLJ_MÅL` och `BEKRÄFTA_START` ingår i formatet men har ingen motor ännu.
- Privat vy tillåter extra fält utöver minimum så att duellens `battle`/`lastResult`/`log` kan återanvändas i L07 utan omskrivning.
- Inga användarfrågor behövdes.
Beroenden som nu är klara: L00, L01 (därmed kan L02, L07 och L10 starta; rekommenderad ordning är nummerordning).
Rekommenderad nästa uppgift: L02 – Spelserver och beständig lagring. Serverns Node-version och Apache-moduler (se L00) bör bekräftas innan lagringsbindning väljs; standardval om svar saknas: inbyggt `node:sqlite` med krav Node ≥ 22.5.
Commit: ingen.

Uppgift och datum: L02 – Spelserver och beständig lagring, 2026-10-13
Status: Klar
Genomfört och ändrade filer:
- Nya: `online/lagring.js` (node:sqlite, migreringar, transaktion(), match/händelser/kvittenser/meta), `online/ko.js` (ordnad kö per rum/match), `online/tjanst.js` (kommandomottagning, dedup på commandId + fingeravtryck, transaktion runt hanterare, startspärr), `online/server.js` (HTTP + SSE, `/api/halsa`, `/api/handelser`, `/api/kommando`), tester `online/lagring.test.js`, `online/tjanst.test.js`, `online/server.test.js`.
- Stödändringar: `server.js` exporterar `serveFile`/`isBlocked` och startar bara när den körs direkt; spärrar `/online/`, `/scripts/`, `/node_modules/`, `/.git/`, `*.test.js`, `teststod.js`, `deploy.sh`, `package.json`. `package.json`: script `online`, `engines.node >= 22.5`. `.gitignore`: `tornstriden-data/`, `*.sqlite*`. README: kort avsnitt om `npm run online`.
- Oförändrade: all spelkod, `matchvy.js`, `deploy.sh` (serverkoden ligger i `online/` och hamnar aldrig i klientfillistan).
Verifiering:
- `npm test`: 99 tester, 99 godkända (65 ursprungliga + 18 L01 + 16 L02), 0 fel.
- Lagring: migrering idempotent och vägrar nyare schemaversion; transaktion rullar tillbaka match + kvittens när en händelse krockar på PRIMARY KEY; nästlad transaktion binder inte om; testdata skrivet av en separat Node-process (spawnSync) läses efter "omstart".
- Tjänst: samma commandId → samma kvittens, effekten en gång; samma commandId med annat innehåll → AVVISAD; avvisat kommando lämnar matchen orörd men får sparad kvittens; lagringsfel (duplicerat eventId) och kraschande hanterare ger INTERNT_FEL utan sparat drag och utan kvittens (status → OKÄND); startspärr vid pågående match stänger matchkommandon men inte lobbykommandon; två samtidiga kommandon på samma match ger exakt en övergång; kön håller ordning per nyckel även efter fel.
- HTTP (riktig port): `/api/halsa` 200; `/online/*`, tester, `package.json`, `deploy.sh`, `.git` ger 404 från både onlineservern och `npm start`; klientfiler 200; dålig JSON 400, > 2048 tecken 413, utan session 401; SSE-strömmen skickar `halsa` först, puls var 25 s via injicerad klocka och städas vid stängning; databas i webbrot avvisas; start med pågående match ger `matchtrafik.oppen=false`.
- Manuellt i terminal: `npm run online` startar på 8766/8799; omstart av processen med sparad pågående match loggar VARNING och stänger matchtrafik; data från första körningen kvar efter andra.
Inte verifierat / återstående fel:
- Serverns Node-version är fortfarande obekräftad (`node:sqlite` kräver ≥ 22.5; på Debian stable kan apt-Node vara äldre). Om servern inte kan uppgraderas byts `online/lagring.js` till `better-sqlite3` med samma API – resten rörs inte.
- SIGINT via `npm run online` tar någon sekund (npm vidarebefordrar); direkt `node online/server.js` stänger direkt. Ingen produktionsinstallation.
Tekniska val och eventuella användarsvar:
- Inga npm-beroenden: inbyggt `node:sqlite` (WAL, `busy_timeout`) och HTTP + Server-Sent Events i stället för WebSocket. Skäl: EventSource har inbyggd återanslutning och `Last-Event-ID`, Apache behöver bara `ProxyPass /api/` (ingen `mod_proxy_wstunnel`), och deploy/drift slipper `npm install`. Alternativ om tvåvägs-realtid senare krävs: `ws`; tjänstelagret är oberoende av transporten.
- Lokalt serverar onlineservern även statiska filer från samma port (8766) så att kakor och EventSource får samma ursprung; i drift sköter Apache statiska filer och `TORNSTRIDEN_STATIC=0` stänger av dem.
- Databas: `TORNSTRIDEN_DATA_DIR` (standard `../tornstriden-data`, katalog med 0700), fil `tornstriden.sqlite`; en sökväg i webbroten vägras vid start. Schemaversion i `meta`; migreringar läggs sist i `MIGRERINGAR`.
- Kvittenser sparas för GODKÄND (i samma transaktion som läget) och AVVISAD (egen transaktion efter rollback); INTERNT_FEL sparas inte så att klienten kan fråga status (OKÄND) och skicka om.
- Hanterare är synkrona inom transaktionen; scope för kö/kvittens = `match:<id>`, `rum:<id>` eller `spelare:<id>`. Loggar innehåller typ, scope och status – aldrig nyttolast, händer eller token.
- Inga användarfrågor behövdes.
Beroenden som nu är klara: L00–L02.
Rekommenderad nästa uppgift: L03 – Gästsession och lobbylista (kräver L02). L07 och L10 kan också startas oberoende.
Commit: ingen.

Uppgift och datum: L03 – Gästsession och lobbylista, 2026-10-13
Status: Klar
Genomfört och ändrade filer:
- Nya: `online/session.js` (skapa/hämta/byt nick/anslut/koppla från/lobbylista/lämna, SÄTT_NICK som tjänsthanterare), `online/session.test.js` (8 tester).
- Ändrade: `online/lagring.js` (migrering 2: tabellen `sessioner` med UNIQUE på nick_key och token_hash; sessionsoperationer), `online/server.js` (kakor, Origin-kontroll, `/api/session` GET/POST/DELETE, `/api/lobby`, `/api/status`, SSE knuten till session med lobbyutskick och ersättning av extra flik), `online/server.test.js` (+4 tester, +Origin i befintliga), `KONTRAKT.md` (avsnitt HTTP-gränssnitt).
- Oförändrade: all spelkod och vy, `deploy.sh`.
Verifiering:
- `npm test`: 111 tester, 111 godkända, 0 fel.
- Modultester: två gäster får olika playerId/token; databasen innehåller bara SHA-256 av token; nick "ANNA"/"  anna " krockar med "Anna" (409) tills sessionen gått ut; ett utgånget nick ger ny identitet, aldrig den gamla sessionen; glidande 24 h-utgång med styrd klocka; nickbyte vägras i rum/match och till någon annans nick; anslutningsgeneration: gammal generation kan inte koppla från den nya; `markeraAllaFrankopplade` efter start; lobbylistan har bara `playerId, nick, activity, connection`; tak på 200 sessioner (503); SÄTT_NICK via tjänstens kö/kvittens.
- HTTP-tester (riktig port, separata kakburkar): kakan är `HttpOnly; SameSite=Lax` (+`Secure` bakom `X-Forwarded-Proto: https`); omladdning med kaka återupptar sessionen i stället för att ta nytt nick; annans nick → 409 utan kaka; påhittad token → 401; POST utan/med främmande Origin → 403; `<b>Anna</b>` lagras och returneras som text; strömmen kräver session, alla får `lobby` vid anslutning/frånkoppling/nickbyte, extra flik ger `ersatt` till den gamla fliken utan att fälla den nya, `DELETE /api/session` tar bort gästen och kakan.
- Manuellt med curl mot `node online/server.js` (port 8796): samma flöde; loggen innehåller bara playerId, kommandotyp, scope och status – ingen token eller nyttolast.
Inte verifierat / återstående fel:
- Ingen webbläsarkörning ännu (lobby.html kommer i L06). curl-anrop behöver `Origin`-header eftersom servern kräver Origin på alla skrivande anrop.
- Gallring av utgångna sessioner sker vid nickreservation (`rensaUtgangna` finns för en periodisk städning i L04–L05).
Tekniska val och eventuella användarsvar:
- Nick 2–20 synliga tecken, trimmat, kontrolltecken förbjudna, unikt skiftlägesokänsligt (NFKC + `sv`-gemener) bland levande sessioner. Sessionslivslängd 24 h glidande (skrivs högst en gång per minut). Token 32 slumpbyte från `crypto`, aldrig spelslumpen.
- Kakan `tornstriden_session`: `Path=/; Max-Age=86400; HttpOnly; SameSite=Lax`, `Secure` när `TORNSTRIDEN_SECURE=1` eller proxyn sätter `X-Forwarded-Proto: https` (Apache: `RequestHeader set X-Forwarded-Proto https` i L21). Lokalt över http saknas Secure med avsikt.
- Origin: tillåts när Origin-host = Host-header eller finns i `TORNSTRIDEN_ORIGINS`; saknad Origin tillåts bara med `Sec-Fetch-Site: same-origin`. Gäller POST/DELETE; GET skyddas av SameSite=Lax.
- Extra flik: den senast öppnade fliken blir styrande, den gamla får `ersatt` och stängs (visas som ”Spelet är öppet i en annan flik” i L06). Anslutningsgenerationen ökar per ny ström så att ett sent close ignoreras.
- Lobbylistan skickas i sin helhet vid varje ändring (liten lista, enkelt att resonera om); differentiella uppdateringar behövs inte vid 200 sessioner.
- Inga användarfrågor behövdes.
Beroenden som nu är klara: L00–L03.
Rekommenderad nästa uppgift: L04 – Rum och inbjudningar.
Commit: ingen.

Uppgift och datum: L04 – Rum och inbjudningar, 2026-10-13
Status: Klar
Genomfört och ändrade filer:
- Nya: `online/rum.js` (skapa, bjud in, acceptera, avböj, återkalla, lämna, anslutningsspegling, utgång via klocka, städning, återställning av timers efter start, tjänsthanterare för SKAPA_RUM/BJUD_IN/ACCEPTERA/AVBÖJ/ÅTERKALLA/LÄMNA), `online/rum.test.js` (9 tester).
- Ändrade: `online/lagring.js` (migrering 3: tabellerna `rum` och `inbjudningar` + operationer), `online/server.js` (rum i `lobby`-vyn/strömmen, utskick efter kommandon och timers, anslutningsstatus speglas i rummet, periodisk städning var 60 s, `DELETE /api/session` lämnar rummet först), `online/server.test.js` (+1 HTTP-test, justerad timerräkning), `KONTRAKT.md` (rumskommandon och tider).
- Oförändrade: all spelkod och vy, `deploy.sh`.
Verifiering:
- `npm test`: 121 tester, 121 godkända, 0 fel.
- Modultester (styrd klocka, tjänstens kö och kvittenser): dubbelklick på SKAPA_RUM ger ett rum och samma kvittens; bara värden kan bjuda in; dedup av mottagare; hopp med skäl (du själv, ej ansluten, redan i rum, finns inte); deltagare + öppna inbjudningar ≤ 8; högst ett inbjudningskommando per sekund; 1B – Bos acceptans lämnar Cys inbjudan öppen och alla hamnar i samma rum; dubbelklick på ACCEPTERA ger samma kvittens och en deltagare; samtidig acceptans av två rum (Promise.all) ger ett medlemskap och stänger den andra inbjudan; fullt rum/startat/stängt/utgången/återkallad/avböjd ger begripliga svar; 30 s karens efter avböjande; utgång efter 120 s utan kommando (timer i rummets kö, servern meddelas en gång); lämna nollställer Redo och ökar rosterVersion; 25A – längst anslutna tar över värdskapet; tomt rum stängs och återkallar sina inbjudningar; frånkopplad före start tas bort efter 60 s om ingen återanslutning; städning stänger inaktiva rum (2 h) och raderar gamla (1 h); omstart planerar om öppna inbjudningar.
- HTTP-test med tre kakburkar och tre SSE-strömmar: skapa rum, bjud in (svaret listar vem som hoppades över och varför), inbjudan syns i Bos ström men inte Cys, acceptans ger båda rummet med anslutningsstatus, stängd ström visar FRÅNKOPPLAD i rummet, `DELETE /api/session` tar bort deltagaren ur rummet.
- Manuellt med curl (port 8795): samma flöde inklusive dubbel ACCEPTERA med samma commandId → identisk kvittens.
Inte verifierat / återstående fel:
- Ingen webbläsarkörning (L06). Frekvensgränsen för inbjudningar ligger i processminne (nollställs vid omstart) – avsiktligt enkelt.
- En avvisning rullar tillbaka alla skrivningar, även en samtidig markering ”utgången”; markeringen görs i stället av timern/vyn. Dokumenterat i test.
Tekniska val och eventuella användarsvar:
- Tider: inbjudan 120 s, karens efter avböjande 30 s, max 1 inbjudningskommando/s per värd, frånkopplad före start 60 s, inaktivt rum 2 h, radering av stängda rum/besvarade inbjudningar efter 1 h, städning var 60 s. Allt är konstanter i `online/rum.js`.
- Rummet lagras som JSON i `rum.state` med kolumner för status/värd/revision; medlemskap garanteras genom sessionens `roomId`/`activity` i samma transaktion.
- När en spelare accepterar ett rum markeras dennes övriga öppna inbjudningar UTGÅNGEN (avsändaren ser att den inte längre gäller).
- Kö: ACCEPTERA/AVBÖJ saknar roomId och serialiseras per spelare, BJUD_IN/ÅTERKALLA/LÄMNA per rum; databastransaktionen (BEGIN IMMEDIATE) gör att rum och spelare aldrig ändras i två kommandon samtidigt.
- Hela lobbyvyn (lobby + rum + inbjudningar) skickas till varje ström vid varje ändring; enkelt och tillräckligt för 200 sessioner.
- Inga användarfrågor behövdes.
Beroenden som nu är klara: L00–L04.
Rekommenderad nästa uppgift: L05 – Lagval, Redo och startvillkor.
Commit: ingen.

Uppgift och datum: L05 – Lagval, Redo och startvillkor, 2026-10-13
Status: Klar
Genomfört och ändrade filer:
- Ändrade: `online/rum.js` (valjLag, redo, startkontroll, registreraMotor, starta, tjänsthanterare för VÄLJ_LAG/REDO/STARTA, `start` i vyn, spärr mot LÄMNA efter start), `online/server.test.js` (+1 HTTP-test), `KONTRAKT.md` (kommandon, startstatus, motorgränssnitt).
- Nya: `online/start.test.js` (8 tester).
- Oförändrade: all spelkod och vy, `online/server.js` (vyn får `start` via rum.vyFor), `deploy.sh`.
Verifiering:
- `npm test`: 130 tester, 130 godkända, 0 fel.
- Lagval: A/B/null, högst 4 per lag ("Södra laget är fullt"), samma lag igen är ingen ändring, byte ökar rosterVersion och nollställer allas Redo.
- Redo: gammal rosterVersion avvisas, frånkopplad kan inte bli redo, lag krävs, bara avsändaren markeras, kan tas tillbaka.
- Startkontroll: udda antal ("Vi är 5 …"), saknat lag, ojämna lag ("3 mot 1"), frånkopplad, inte redo ("Väntar på …"), format utan motor ("ännu inte tillgängligt"); `tillgangligaFormat` listar registrerade antal.
- Start med testdubbel som motor: bara värden; gammal/saknad rosterVersion avvisas; matchen sparas i samma transaktion som rummet blir STARTAD; motorn får serverns slump och deltagare med lag; öppna inbjudningar återkallas; sessioner blir SPELAR med matchId; dubbelklick ger samma kvittens (ingen andra match); LÄMNA efter start avvisas. Kraschande motor rullar tillbaka match, rum och sessioner (INTERNT_FEL). Stängd matchtrafik (startspärr från L02) spärrar STARTA.
- Start/sen acceptans samtidigt (Promise.all) i båda ordningarna: antingen avvisas starten på rosterVersion eller acceptansen på STARTAD – aldrig olika deltagarlistor.
- 25A: värd som lämnar eller tas bort av frånkopplingsfristen ersätts av längst anslutna; Redo nollställs.
- HTTP: två kakburkar går igenom lagval → ojämna lag → Redo med fel/rätt rosterVersion → STARTA avvisas med "ännu inte tillgängligt" och rummet förblir FÖRBEREDELSE; `start` i lobbyvyn ger skälen för gränssnittet.
Inte verifierat / återstående fel: ingen webbläsarkörning (L06). Ingen riktig motor är kopplad – `tillgangligaFormat` är tom tills L08/L14 registrerar.
Tekniska val och eventuella användarsvar:
- Högst 4 per lag i rummet (huvudplan §6); tillfälligt ojämna lag tillåts fram till start.
- `startkontroll(room)` är en ren funktion som både STARTA och vyn använder, så gränssnittet visar exakt samma skäl som servern avvisar med.
- Motorgränssnitt: `registreraMotor(antal, fabrik)`; fabriken kör inuti starttransaktionen och sparar matchen själv via `ops`. Rum och match sparas därmed atomärt redan nu.
- Vid start återkallas kvarvarande öppna inbjudningar (ÅTERKALLAD); en sen acceptans ser "Inbjudan har återkallats" eller "Matchen har startat".
- Inga användarfrågor behövdes.
Beroenden som nu är klara: L00–L05 (etapp 1 på serversidan).
Rekommenderad nästa uppgift: L06 – Lobbygränssnitt (lobby.html/lobby.js/lobby.css), därefter L07.
Commit: ingen.

Uppgift och datum: L06 – Lobbygränssnitt, 2026-10-13
Status: Klar
Genomfört och ändrade filer:
- Nya: `lobby.html`, `lobby.css`, `lobby.js` (nickformulär, spelarlista med markering, inbjudningsbesked med nedräkning, rum med lagkolumner, lagval, Redo, värdens start, utgående inbjudningar med Återkalla, Lämna rummet/lobbyn, anslutningsstatus, dialog för extra flik), `scripts/prova-lobby.mjs` (Playwright-prov med fyra sessioner varav en mobil).
- Ändrade: `online/server.js` (`GET /api/session` svarar 200 med `me: null` utan session, så sidladdning inte loggar 401), `KONTRAKT.md`, `README.md` (lobbyadress och provskript).
- Oförändrade: spelmotor, `matchvy.js`, `match.html`, `deploy.sh` (lobbyfilerna läggs i klientfillistan när onlinespel ska publiceras, L21). Ingen länk till lobbyn från match.html ännu – den går inte att spela från.
Verifiering:
- `npm test`: 130 tester, 130 godkända.
- `scripts/prova-lobby.mjs` (Chromium, fyra separata kontexter + en femte för nickkrock, Cy på iPhone 13-bredd): 23/23 kontroller OK – upptaget nick ger fel i formuläret med fokus kvar; `<b>Eva</b>` visas som text; alla ser varandra; markering med Tab + mellanslag; fokus och markering överlever listuppdatering från en annan spelare; ”Skapa rum och bjud in (3)” skapar rum och bjuder in; mottagare ser inbjudan; Bos acceptans lämnar Cys kvar (1B); Daniel avböjer; inbjudningsknappen dold för vanlig deltagare; Redo spärrat utan lag; startknappen dold för icke-värd, spärrad för värden med serverns skäl ordagrant (”Vi är 3 …”, ”Lagen är ojämna: 2 mot 1 …”); lagbyte nollställer allas Redo; med två spelare och alla redo visas ”Matchformatet för 2 spelare är ännu inte tillgängligt.”; 25A – Bo blir värd när Anna lämnar; extra flik ger ”Spelet är öppet i en annan flik” och ”Använd den här fliken” tar över; omladdning behåller nick och rum; Lämna lobbyn tar bort spelaren hos andra; inga konsolfel.
- Skärmdumpar granskade på desktop (1280 px) och mobil (390 px): paneler staplas, lagkolumner staplas, knappar fyller bredden, status alltid i text (inte bara färg).
Inte verifierat / återstående fel:
- Provet kördes i Chromium (Playwright) i molnmiljön mot samma kod; Safari/Firefox och riktig mobil är inte provade. Skärmläsare är inte provad; aria-live finns på status, notis och fel.
- Inbjudan löper ut hos mottagaren utan särskilt besked (raden försvinner); värden ser att raden försvinner. Ett tydligare ”utgången”-besked kan läggas till i L19.
Tekniska val och eventuella användarsvar:
- Ingen ramverkskod: `lobby.js` bygger DOM med `createElement`/`textContent` (aldrig innerHTML med användardata) och renderar om hela vyn vid varje `lobby`-händelse; fokus bevaras via stabila id:n, markeringar i en `Set` som rensas med notis när en markerad spelare inte längre kan bjudas in.
- Klienten speglar bara serverns vy: startstatus, skäl och knappars spärr kommer från `start` i vyn; inga regler dubbleras.
- Kommandon får `crypto.randomUUID()` som commandId; dubbla klick spärras tills kvittensen kommit. 401 på kommando visar nickformuläret igen.
- Extra flik: den nyaste fliken tar över (serverns beteende); den gamla får en modal med ”Använd den här fliken”.
- Nedräkningen för inbjudningar använder serverns klocka (`tid` i `halsa`) för att inte bero på klientens klocka.
- Inga användarfrågor behövdes.
Beroenden som nu är klara: L00–L06 (etapp 1 komplett).
Rekommenderad nästa uppgift: L07 – Privat spelarvy i befintligt spel (kan göras oberoende av servern), därefter L08.
Commit: ingen.

Uppgift och datum: L07 – Privat spelarvy i befintligt spel, 2026-10-13
Status: Klar
Genomfört och ändrade filer:
- Nya: `lokalmatch.js` (LokalMatch-adaptern: motor och dator bakom kontraktets sex metoder; `privatVy()`; typade händelser; lokala extrametoder under `local`), `lokalmatch.test.js` (4 tester), `scripts/prova-match.mjs` (Playwright spelar en hel datormatch i match.html).
- Ändrade: `match.js` (`playerView` får `battleNumber` och offentlig `players[]` utan händer – inga regeländringar), `match.test.js` (vy-testet uppdaterat för de nya fälten), `matchvy.js` (läser bara `adapter.view()`, skickar kommandon enligt kontraktet, ljud från händelser, dator via `adapter.local`, utvecklingspanel via `adapter.local.revealHand`), `KONTRAKT.md`.
- Oförändrade: `match.html`, `match.css`, `dator.js`, `ljud.js` (`resultEffect` fungerar oförändrad på vyn), alla regler.
Verifiering:
- `npm test`: 134 tester, 134 godkända.
- `grep` i `matchvy.js`: inga läsningar av `match.`, `instances`, `process`, `playerView` eller `allowedActions` – endast `cardType()` (statisk kortkatalog) och `canAttack/canDefend` i kortrutans beskrivningstext.
- Modultester: `privatVy` klarar `validatePrivateView` för båda spelarna och `assertNoSecrets` faller för fel spelare; adaptern klarar `assertAdapter`; kommandon får identitet från adaptern; avvisning ger ingen ny vy; samma commandId kan frågas med `status`; en hel datormatch (styrd slump) spelas genom adaptern där varje vy valideras och varje händelse är hemlighetsfri med löpnummer utan luckor; `local` saknas i den publika formen.
- Webbläsare (Chromium, `scripts/prova-match.mjs`, två körningar): byte av två kort med flygande kort, "Behåll handen", startrutan, långtryck öppnar kortet förstorat, utvecklingspanelen visar motståndarens hand lokalt, en hel match till resultatrutan (13 strider: anfall, försvar, enkel attack vid behov, Fortsätt), "Spela igen" ger ny hand, tvåspelarläget visar nästa spelares hand; inga konsolfel (de enda 404 är bilder/ljud som inte följde med provkopian).
Inte verifierat / återstående fel:
- Ljudet hörs inte i headless-provet; ljudanropen går samma väg som förut men nu från händelser (`KORT_SPELAT`, `BYTE`, `PÅFYLLNING`) – lyssna gärna en gång manuellt.
- Safari/Firefox ej provade.
Tekniska val och eventuella användarsvar:
- Adaptern har de sex kontraktsmetoderna plus `local` (setViewer, newMatch, computerDecision, computerSend, revealHand). Onlineadaptern får ingen `local`, och vyn kontrollerar alltid `adapter.local` innan den används – datorn och utvecklingspanelen kan därmed inte följa med online.
- `send()` i vyn är nu asynkron (`await adapter.send`), vilket är det som onlineläget kräver; animationerna mäter sina källrektanglar före anropet som förut.
- Ljud spelas av händelser i stället för av vyns egen jämförelse av händer – samma ljud som tidigare, men utan att vyn behöver se några kort.
- Kortens användbarhet i handen hämtas ur `allowed` i vyn (inte via egna regelanrop), så onlinevyn följer serverns bedömning.
- Inga användarfrågor behövdes.
Beroenden som nu är klara: L00–L07.
Rekommenderad nästa uppgift: L08 – Serverstyrd duell och kommandon.
Commit: ingen.

Uppgift och datum: L08 – Serverstyrd duell och kommandon, 2026-10-13
Status: Klar
Genomfört och ändrade filer:
- Nya: `online/duell.js` (motorfabrik för 2 deltagare registrerad i rummet, platsmappning A/B från lagvalet, hanterare för alla matchkommandon med identitet från sessionen, start-/Fortsätt-bekräftelser, privata vyer per plats, händelser, matchslut stänger rummet), `online/duell.test.js` (6 tester).
- Ändrade: `lokalmatch.js` (`typadeHandelser` utbruten och exporterad så servern och lokaladaptern ger samma händelser), `online/rum.js` (`markeraMatchAvslutad`, LÄMNA efter avslutad match ger LEDIG och nollställer matchId), `online/server.js` (`GET /api/match`, SSE-händelsen `match` till deltagarna efter varje godkänt kommando och vid öppnad ström), `online/server.test.js` (+1 HTTP-test, L05-testet uppdaterat eftersom duellformatet nu är tillgängligt), `scripts/prova-lobby.mjs` (samma anledning), `KONTRAKT.md`.
- Oförändrade: `match.js`-reglerna, `matchvy.js`, `lobby.*`.
Verifiering:
- `npm test`: 141 tester, 141 godkända på Macen (i molnmiljön 141/141 tre gånger; en första körning där fick ett enstaka fel som inte gick att upprepa – trolig tidsflakighet i ett kö-/SSE-test under last, bevakas i L20).
- Kriterier: en hel duell spelas av två testklienter genom tjänsten (styrd slump) med startbekräftelse, drag och Fortsätt-bekräftelser till matchslut; fel tur ("Det är inte din tur"), främmande kort ("Kortet finns inte på din hand"), okänd match, gammal revision och spelare utanför matchen avvisas utan att motorn ändras; identiskt kommando ger samma kvittens och effekt en gång; samma commandId med annat innehåll avvisas; lagringsfel (upptaget händelse-ID) ger INTERNT_FEL, draget sparas inte och statusfrågan ger OKÄND; två samtidiga Fortsätt (Promise.all) ger exakt en ny strid och motorns FORTSÄTT körs en gång; ingen kan anfalla före båda startbekräftelserna; upprepad bekräftelse är ofarlig och ändrar inte revisionen; alla händelser är hemlighetsfria med löpnummer utan luckor; matchslut ger AVSLUTAD match, STÄNGT rum, FÖLJER_AVSLUT och LÄMNA → LEDIG.
- HTTP: lobby → start ger `match`-händelse med privat vy per spelare (Bos kort finns inte i Annas vy), fel tur avvisas, ett byte ger båda ny vy och händelser, `/api/match?efterEventId=0` återger händelserna, `/api/status` med scope `match:<id>` ger kvittensen.
- Webbläsare: `scripts/prova-lobby.mjs` 23/23 med den nya koden (värden kan nu starta med två spelare; själva matchsidan kopplas i L09).
Inte verifierat / återstående fel:
- Ingen människa har ännu spelat via webbläsaren – det är L09 (onlineadapter + matchvy). Inga tidsgränser (L16) och ingen återanslutning (L17).
Tekniska val och eventuella användarsvar:
- Matchen lagras som `{ id, revision, rulesVersion, deckVersion, roomId, seats, engine, lastEventId, confirm }`; `engine` är motorns objekt oförändrat, `revision` = motorns. Bekräftelser ligger i `confirm` och ändrar inte revisionen (huvudplan §9: beredskap skild från spelrevision).
- Vyn använder platser (A/B) som identitet och bifogar `seats`/`mySeat`; klienten slipper översätta motorns alla id-fält.
- Motorns FORTSÄTT är inte ett klientkommando online; kommandot FORTSÄTT är en bekräftelse som servern löser ut när den sista levande spelaren bekräftat. BEKRÄFTA_START på samma sätt utan motorsteg.
- Ett motorfel (INTERNT_FEL i motorn) kastar i transaktionen så att inget sparas och ingen får en falsk vinst.
- Inga användarfrågor behövdes.
Beroenden som nu är klara: L00–L08.
Rekommenderad nästa uppgift: L09 – Spelbar onlineduell (onlineadapter, lobby → match → resultat i webbläsaren).
Commit: ingen.

Uppgift och datum: L09 – Spelbar onlineduell, 2026-10-13
Status: Klar
Genomfört och ändrade filer:
- Nya: `onlinematch.js` (OnlineMatch-adaptern: väntande drag, kvittenskontroll via /api/status, omsändning bara vid OKÄND och oförändrad revision, gamla vyer/kvittenser avvisas, EventSource), `onlinematch.test.js` (7 tester), `scripts/prova-online.mjs` (två webbläsare spelar en hel duell från lobbyn).
- Ändrade: `matchvy.js` (`?online=1` väljer adapter i `boot()`, bekräftelser via start-/resultatrutan, egen plats nederst, anslutningsstatus, väntande drag som notis, ”Till lobbyn”, lokal datorstyrning dold), `match.html` (id:n för namn/etikett, `#connection`), `match.css`, `lobby.js` (går till matchsidan vid SPELAR; stängt rum visas som ”Matchen är slut” med ”Tillbaka till lobbyn”), `lobby.css`, `deploy.sh` (klientfillistan får `kontrakt.js lokalmatch.js onlinematch.js` som match.html nu importerar – nödvändigt för att det lokala spelet ska fungera vid nästa deploy), `README.md`, `KONTRAKT.md`, `scripts/prova-lobby.mjs` (tåligare Redo-kontroll).
Verifiering:
- `npm test`: 148 tester, 148 godkända (tre körningar i rad).
- Den enstaka flakigheten från L08 är hittad och rättad: två tester kontrollerade ”Bos kort syns inte i Annas vy” med en substrängsökning där `…:kort:1` även matchade `…:kort:10` – beroende på blandningen. Kontrollen är nu exakt (med citattecken) i `online/server.test.js` och `online/duell.test.js`; 24 körningar därefter utan fel. Ingen verklig läcka.
- `onlinematch.test.js`: gränssnittet uppfyllt utan `local`; gammal vy och annan match ignoreras, bara nya händelser levereras; drag ger SKICKAR→kvittens→vyhämtning; tappad kvittens → statusfrågan hittar draget utan omsändning; OKÄND + oförändrad revision → exakt en omsändning; OKÄND + ändrad revision → ”välj igen” utan omsändning; servern onåbar → INTERNT_FEL efter begränsat antal försök; 401/400 ger direkta svar; två drag samtidigt → det andra avvisas lokalt.
- Webbläsare (`scripts/prova-online.mjs`, Chromium, två separata kontexter varav Bo på iPhone-bredd, tre körningar 9/9): lobby → värdens start → båda på `match.html?online=1`, egen plats nederst med nick, lägesväljaren dold, byten, startbekräftelser, en hel match (6 anfall, 4 försvar, 2 avstådda, 10 Fortsätt-bekräftelser) till resultatrutan som är personlig och motsatt (”Du vinner”/”Bo vinner”), Bos handkorts-ID förekommer inte i något nätverkssvar till Anna och tvärtom, ”Till lobbyn” tar båda tillbaka som lediga; inga konsolfel.
- `scripts/prova-match.mjs` (lokalt datorläge): 10/10 spelkontroller som förut (den enda anmärkningen var att tornbilderna saknades i provkopian). `scripts/prova-lobby.mjs`: 24/24 tre gånger.
- `./deploy.sh <tmp>`: publiceringskopian innehåller de nya modulerna med `?v=`-stämplade importer.
Inte verifierat / återstående fel:
- Ingen riktig nätstörning är provad i webbläsare (kvittenskontrollen är provad med fejkad server); återanslutning med fortsatt spel är L17. Inga tidsgränser (L16). Lobbyn och matchsidan ingår inte i deploy-listan förrän L21 (onlinetjänsten behöver driftsättas först). Sidfotstexten i match.html säger fortfarande ”Onlinespel kommer senare” – uppdateras i L21.
- Tornbilderna/emblemen (röd S/blå N) följer zonen, inte platsen: online ser spelaren på plats B sitt torn som det röda nederst. Avsiktligt enkelt; kan göras platsberoende senare.
Tekniska val och eventuella användarsvar:
- Onlineläget väljs med `?online=1` så att `match.html` utan parameter är exakt det gamla lokala spelet.
- Bekräftelser återanvänder befintliga rutor: start-rutans ”Börja striden” skickar BEKRÄFTA_START och blir ”Väntar …” tills båda bekräftat; resultatrutans ”Fortsätt” skickar FORTSÄTT (samma typ som motorns, men servern löser ut övergången). Escape stänger inte startrutan online.
- Händelser från strömmen renderar direkt; den egna markeringen behålls bara för kort som fortfarande finns på handen.
- Inga användarfrågor behövdes.
Beroenden som nu är klara: L00–L09 (etapp 1 och 2).
Rekommenderad nästa uppgift: L10 – Lagkortlek och kortbokföring (etapp 3, ren regelkod utan server).
Commit: ingen.


### Rättning av granskningsfynd R01–R06 – 2026-10-13

Uppgift: rätta de sex bekräftade felen från granskningen av L00–L09.
Status: rättat och verifierat i arbetskatalogen.

- L02: statiska filer tillåts först efter normalisering och kontroll av upplöst sökväg. Serverkod, Git-data och filer utanför webbroten kan inte hämtas genom kodade sökvägar eller symboliska länkar.
- L03/L07/L09: nick skyddas i matchsidan, inklusive kortetiketter och resultat. Inga HTML-element eller händelseattribut skapas av nick.
- L07: lokalt tvåspelarläge behåller giltig betraktare vid resultat och matchslut.
- L04/L08/L09: städning av avslutade rum frigör kvarvarande deltagare atomärt, bevarar nya medlemskap och uppdaterar lobbyn.
- L09: HTTP-anrop och svarsläsning har tio sekunders tidsgräns; kvittenskontrollen använder fortsatt samma commandId.
- L02/L03: SSE-testet läser hela händelser oberoende av nätverksblock och har testtidsgräns med uppstädning.

Verifiering: `npm test` **155/155**, lobbyprov **24/24**, onlineduell **9/9**, lokalt matchprov **13/13**, samt nytt riktat `scripts/prova-regressioner.mjs` för nick och återgång efter rumsstädning. Webbläsarproven kördes i Chrome. `deploy.sh` provades mot temporär katalog med fungerande versionsstämpling. Se [granskning L00-L09.md](<granskning L00-L09.md>) för detaljer och den första lokala provkörningens klickstopp som inte återkom i det riktade provet eller omkörningen.

Ingen commit, push eller publicering ingick. L10 är fortsatt nästa planerade implementation; L16–L18:s fullständiga avbrottshantering återstår enligt planen.

Uppgift och datum: L10 – Lagkortlek och kortbokföring, 2026-10-13
Status: Klar
Genomfört och ändrade filer:
- Nya: `lagregler.js` (låst regelversion `lag-v1`, låst baslista enligt 11A, kortlekarna `lag-100-v1`/`lag-150-v1`/`lag-200-v1`, minsta behov 56/84/112, `buildTeamDeck`, `teamBattleCard` för 23A, `teamCanAttack`/`teamCanDefend`), `lagkortlek.js` (lagens fasta ordning och bordsordning, utdelning, startbyten, påfyllning enligt 22A, bordsprimitiver, `auditTeam`), `lagregler.test.js` (5 tester), `lagkortlek.test.js` (10 tester).
- Stödändring utanför L10: `server.js` fick `skapaFilserver(root)` och symlänktestet i `online/server.test.js` bygger nu en egen webbrot i en temporär katalog. Det tidigare testet skapade länkar i projektets `assets/` och lämnade kvar `assets/static-test-*` när borttagning av symlänkar nekades (som i den länkade sandlådan); en sådan katalog (`static-test-1GkRmr`) finns kvar och behöver tas bort för hand. Spärren själv är oförändrad.
- Oförändrade: `matchregler.js`, `match.js`, duellens 50-kortslek, all server- och vykod.
Verifiering:
- `npm test`: 170 tester, 170 godkända, tre körningar i rad. Inga nya filer i `assets/`.
- Kortlek: 30 korttyper; vanliga kort 4/6/8 och specialkort 2/3/4 exemplar för 4/6/8 deltagare; summa 100/150/200; baslistan är identisk med duellens fördelning vid låsningen; duellen har fortfarande 50 kort; unika exemplar-ID; samma slump ger samma lek; okända kort och för små lekar avvisas.
- 23A: för alla 30 kort blir enkel attack `{type: 'attack', attack: 1}` utan ability, cancel, försvar eller magisk typ; Drakeld tappar både magi och +2; katalogen ändras inte.
- Startbyten för 4/6/8 med maximala byten (två kort, båda omgångarna, i omvänd bordsordning): varje exemplar på exakt ett ställe efter varje steg, undanlagda kort delas inte ut i omgång 2, blandas tillbaka efter sista omgången, alla har 10 kort och draghögen har `lek − 10 × deltagare`. Omgång 2 öppnar först när alla levande bekräftat omgång 1. Ogiltiga byten (tre kort, dubblett, annans kort, okänd spelare, efter bytena) avvisas utan ändring.
- 22A: bara levande spelare med exakt noll kort får kort; en hand med tre kort och en utslagen spelare får inget; ett kort i taget runt bordet från angiven startspelare (b3 får översta, tredje, femte … kortet); högst fem; tom draghög blandar bara slänghögen – bordskort ligger kvar; med för få kort får den ursprungliga mottagarlistan 2 + 1 och utdelningen slutar; samma påfyllnings-ID ger ingen ny påfyllning.
- Slumpad långkörning (3 frön × 4/6/8, 300 steg vardera med kortspel, slängning, utslagning och påfyllning): kortbokföringen håller efter varje steg och lekens storlek är oförändrad.
Inte verifierat / återstående fel: ingen stridsberäkning, inga faser efter bytena, ingen turordning och ingen server- eller vykoppling – det är L11–L15. Balansen i 100/150/200-lekarna är inte provspelad (huvudplanen §7).
Tekniska val och eventuella användarsvar:
- **Startbyten i lagmatch sker samtidigt inom en omgång** (vem som helst kan bekräfta i valfri ordning), och omgång 2 öppnar när alla levande bekräftat omgång 1. Duellen byter turvis; med 8 spelare och 90 sekunder per val (L16) hade turvisa byten gett upp till 16 väntelägen. Ändras lätt till turvis om du hellre vill det.
- **Fast ordning inom laget** = ordningen i rummets deltagarlista vid start (den ordning lobbyn visar). **Bordsordning** = lagen flätade A1, B1, A2, B2 … och används för utdelning och påfyllning. Startutdelningen börjar vid A1; påfyllningen börjar hos den spelare L12 anger (nästa anfallande lags startspelare, 21A). Första anfallande lag lottas i L12.
- Kortbokföringens funktioner ändrar matchobjektet direkt och kastar `Avvisning` före varje ändring vid spelarfel; lagmotorn i L12 arbetar på en kopia som i duellens `process()`. Revision, händelser och faser efter `BYTEN_KLARA` hör till L12.
- Bordskort sparas som frysta poster `{instanceId, playerId, role, usage}`, så att vald användning inte kan ändras efter ett godkänt drag (23A). Primitiverna `discardTableCardsOf` och `discardHand` finns för L13 men ingen avhoppsregel är implementerad.
- Baslistan i `lagregler.js` är en egen låst kopia; ett test larmar om den skiljer sig från duellens lek, så att en ändring av duellen kräver ett uttryckligt beslut om lagleken.
- Inga användarfrågor behövdes.
Beroenden som nu är klara: L00–L10.
Rekommenderad nästa uppgift: L11 – Lagstridens effektberäkning (ren funktion med räkneexemplen i huvudplan §7).
Commit: ingen.

Uppgift och datum: L11 – Lagstridens effektberäkning, 2026-10-13
Status: Klar
Genomfört och ändrade filer:
- Nya: `lagstrid.js` (`beraknaLagstrid` – ren beräkning enligt effektordningens steg 1–8; `giltigaKortmal`/`giltigaSpelarmal` för målval vid spel; `underlagFranMatch` som bygger indata från en lagmatch i `lagkortlek.js`), `lagstrid.test.js` (23 tester).
- Stödändring: `lagkortlek.playToTable` tar emot och låser `targetCard` (exemplar-ID för Barriär/Försegling/Spegelsköld) och `targetPlayer` (spelar-ID för Törnesköld) i den frysta bordsposten; för anfallskort är båda alltid null. Ett L10-test uppdaterat för de nya fälten.
- Oförändrade: `strid.js` och hela duellen, `match.js`, server och vyer.
Verifiering:
- `npm test`: 193 tester, 193 godkända, tre körningar i rad.
- Samtliga åtta räkneexempel i huvudplan §7 ger exakt de angivna talen och utfallen: 3+3−2−2 = 2 mot 4; Drakeld 6, Spegelsköld kopierar 6 före frost, 7 mot 9; 6 mot 3+3−2−2 = 2 och ett liv; 5 mot 6 med två motstötar som tar Stormnings ägare från 2 till 0 medan lagkamraten klarar sig; stoppat Vampyrbett läker inte trots träff (5 mot 2); Drakeld + Armborst 8 mot 6 med bara en +2; borttaget speglingsmål ger 1 utan omval trots att annan magi finns kvar; avdrag och motstötar stannar vid 0.
- Specialregler: hjälparens Helande ljus läker hjälparen, inte måltavlan (Mira-exemplet), och läkning stannar vid 3; hjälparens Isrustning sänker lagets attack; Sista anfallet/Sista bastionen läser startliv, även vid laghjälp; Drakeld får +2 av Törnesköld men inte av hybrid eller magi, och tappar bonusen när det blå kortet tas bort; två Spegelsköldar kopierar samma kort var för sig; Försegling stoppar bara magi och behåller försvar 2, Barriär ger 0; stoppad Sprängladdning sänker inte försvaret; ett borttaget stoppkort gör målet aktivt igen; frost tar inte bort Sprängladdningens avdrag; enkel attack (23A) stoppas av Barriär men kan varken förseglas eller speglas och får ingen Drakeld-bonus; Törnesköld kräver ett levande mål som lagt ett attackkort (stoppat räcker); träff kostar exakt ett liv oavsett överskott.
- 24B: utan kvarvarande anfallskort är attacken 0 och försvaret håller även med försvar 0; Helande ljus läker; motstöt mot den som lämnat flyttas inte. 13A: saknad måltavla eller ett lag utan levande spelare ger AVBRUTEN utan livsändringar (lag utan spelare prövas först).
- Korsprov: för en anfallare mot en försvarare ger lagberäkningen exakt duellens `strid.resolve` för alla 7 452 kombinationer (16 anfallskort + 30 enkla attacker, 17 försvarskort + avstående, alla 9 startlivspar) – attack, försvar, utfall, stopp och båda livsvärdena.
- Slumpprov: 3 000 strider 2 mot 2 till 4 mot 4 med slumpade kort, mål och borttagna spelare; styrkor ≥ 0, liv 0–3, måltavlan förlorar högst ett liv, utslagna exakt de med 0 liv, borttagna spelare opåverkade, rätt sida läks/skadas.
- Funktionen är ren: djupfryst indata går att använda, indata och kortkatalog är oförändrade och två anrop ger identiskt resultat.
Inte verifierat / återstående fel: ingen faslogik, turordning, målvalsvalidering vid spel eller lagring av resultat – det är L12 (resultatet tillämpas där) och L13 (avhopp). Balansen är inte provspelad.
Tekniska val och eventuella användarsvar:
- Indata: `{ targetPlayerId, attacks, defences, players, startLife }`; utdata: `{ outcome, reason, attack, defence, defended, cards, stopped, deductions, lifeDelta, life, eliminated, events }`. `cards` förklarar varje korts värde, bonus, stopp och spegling för förhandsvisning och resultatvy (L15). `events` är svenska förklaringsrader utan dolda kort.
- Kort vars ägare inte längre är med räknas inte (12B) även om de skulle ligga kvar i indata; L13 tar dessutom bort dem från bordet.
- En Barriär, Försegling eller Spegelsköld utan giltigt mål ger bara sitt grundförsvar (0, 2 respektive 1). Om Barriär får spelas utan mål avgör L12 med hjälp av `giltigaKortmal`.
- Flera stoppkort på samma mål är tillåtna i beräkningen; att målet inte får vara redan stoppat vid spel prövas i L12 via `giltigaKortmal`.
- Inga användarfrågor behövdes.
Beroenden som nu är klara: L00–L11.
Rekommenderad nästa uppgift: L12 – Lagmatchens faser och turordning.
Commit: ingen.

Uppgift och datum: L12 – Lagmatchens faser och turordning, 2026-10-13
Status: Klar
Genomfört och ändrade filer:
- Nya: `lagmatch.js` (`newLagmatch`, `processLag` – kopia, kortbokföringskontroll och en revision per godkänd handling som duellens `process()`; `allowedActions`; `leaderOf`/`nextAlive` för 21A), `lagmatch.test.js` (12 tester).
- Ändrad: `kontrakt.js` – nytt matchkommando `AVSTÅ_ANFALL` (lagmatchen har avstående både i anfall och försvar). Duellen påverkas inte; den avvisar okända handlingar som tidigare.
- Oförändrade: `lagregler.js`, `lagkortlek.js`, `lagstrid.js` (används som de är), duellen, server och vyer.
Verifiering:
- `npm test`: 205 tester, 205 godkända, tre körningar i rad.
- Start: alla levande byter samtidigt; lotten ger första lag (styrd slump: 0.1 → Södra laget, 0.9 → Norra laget); startbekräftelse från alla levande, en per person; övergången till första striden sker exakt en gång, en sen bekräftelse avvisas.
- Målval: bara startspelaren; bara levande fiendetorn; ett fallet torn kan inte väljas.
- Anfallskö: startspelaren och sedan levande lagkamrater med kort i fast ordning; högst ett kort per person; fel tur avvisas; den sista i kön får inte avstå om laget inte lagt något kort; ett rent försvarskort avvisas som vanlig attack men går som enkel attack 1.
- Försvarskö: måltavlan först, sedan levande lagkamrater i fast ordning efter måltavlan (6 spelare, måltavla b2: b2, b3, b1); alla får avstå; en tom hand kan bara avstå.
- Mål vid försvar: Försegling kräver valt magiskt kort när ett sådant finns; Barriär väljer bara ostoppade attackkort och kan inte spelas när inget finns; Törnesköld kräver en anfallare som lagt kort; resultatet (0 mot 5, motstöt mot a1) kommer oförändrat från `lagstrid.js`.
- Efter striden: liv sparas, bordet slängs, tomma händer fylls med början hos nästa anfallande lags startspelare, alla levande bekräftar Fortsätt en gång, andra laget anfaller och 21A roterar (strid 3: a2 börjar).
- Livsbaserad utslagning: den utslagne får 0 liv, UTSLAGEN, tom hand, inga val, behövs inte för Fortsätt, hoppas över som startspelare och i köer; när sista tornet faller vinner det andra laget utan påfyllning och alla vidare handlingar avvisas. En motstöt som slår ut en anfallare flyttar lagets målansvar till nästa levande.
- Skyddsregel: ett lag utan handkort lämnar turen till det andra laget; om inget lag har kort blir det INTERNT_FEL med fasen FEL och ingen vinnare.
- Hela matcher: 4 frön × 4/6/8 spelare med slumpade byten, mål, kort, enkla attacker, specialkortsmål och avstående. Varje steg höjer revisionen exakt en gång. Startspelare, anfallsordning och försvarsordning kontrolleras mot en oberoende beräkning i testet; högst ett kort per person; varje strid har minst ett anfallskort; utslagna agerar aldrig igen; varje match slutar med ett vinnande lag. Exempel: 13–40 strider per match, 117–568 steg, 15–30 olika korttyper använda.
Inte verifierat / återstående fel:
- Avhopp, Lämna/Ge upp i lagmatch och tidsförluster (L13, L16). Ingen server- eller vykoppling (L14, L15).
- Under granskningen av testet hittades och rättades ett fel i själva testet: det jämförde resultatobjekt i stället för stridsnummer och kontrollerade därför samma strid flera gånger. Testet räknar nu att varje avgjord strid kontrolleras exakt en gång.
Tekniska val och eventuella användarsvar:
- **Första anfallande lag lottas** med serverns slump efter startbytena; lagets första spelare i fast ordning är dess första startspelare.
- **Försvarskön** går från måltavlan vidare runt lagets fasta ordning (b2, b3, b1 – inte b2, b1, b3).
- **Anfallskön** innehåller bara levande spelare med minst ett kort (kortantal är offentligt). Försvarskön innehåller alla levande, även de utan försvarskort, så att ingen avslöjar sin hand genom att hoppas över.
- **Bidragskravet** (laget måste lägga minst ett kort): den sista i anfallskön kan inte avstå om inget kort lagts. Alla kort duger som enkel attack, så det går alltid.
- **Mål vid försvar:** Barriär kräver ett ostoppat attackkort och kan annars inte spelas. Försegling och Spegelsköld kräver ett valt mål när det finns giltig magi och spelas annars utan mål. Törnesköld kräver en anfallare när någon har anfallit.
- Start- och Fortsätt-bekräftelser ligger i lagmotorn själv, till skillnad från duellen där serverlagret (L08) lägger dem ovanpå motorn. Ingen handling kan gå förbi de andra, och övergången sker när den sista levande bekräftar.
- `lastResult` sparar hela beräkningen från L11 plus bordet, turerna och liven, för resultatvyn (L15) och händelser (L14/L19).
- Inga användarfrågor behövdes.
Beroenden som nu är klara: L00–L12.
Rekommenderad nästa uppgift: L13 – Individuell utslagning och avhopp.
Commit: ingen.

Uppgift och datum: L13 – Individuell utslagning och avhopp, 2026-10-13
Status: Klar
Genomfört och ändrade filer:
- Ändrad: `lagmatch.js` – individuell utslagning. Ny `slaUt(match, spelarIds, orsak, random)` är den gemensamma utslagningsvägen som servern ska använda för tidsgräns (L16) och avbrott (L17); flera spelare i samma anrop är en händelse. `LAG_HANDLING.leave` (= `GE_UPP`) betyder "Lämna matchen" och slår bara ut den egna spelaren. Nytt: `UTSLAG` (`LIV`, `LÄMNADE`, `TIDSGRÄNS`, `AVBROTT`) sparas per spelare som `eliminationReason`; `LAG_SLUT.noPlayers` när båda lagen försvinner i samma händelse. `processLag` och `slaUt` delar samma körning (kopia, kortbokföringskontroll, en revision per godkänd händelse; avvisning lämnar matchen orörd; annat fel ger FEL utan vinnare). Stridsslut och matchslut är gemensamma för vanlig strid, avbruten strid och avhopp.
- Ändrad: `lagkortlek.js` – `advanceSwapRound` är utbruten ur `confirmSwap`, så att ett avhopp kan avsluta en bytesomgång.
- Ändrad: `KONTRAKT.md` – `AVSTÅ_ANFALL` (från L12) och lagmatchens betydelse av `GE_UPP`.
- Ny: `lagavhopp.test.js` (15 tester).
- Oförändrade: `lagregler.js`, `lagstrid.js` (L11 räknar redan om utan borttagna kort, 12B/17A/24B), `lagmatch.test.js`, duellen, server och vyer.
Verifiering:
- `npm test`: 220 tester, 220 godkända, tre körningar i rad. De 12 L12-testerna passerar oförändrade efter omskrivningen av `lagmatch.js`.
- Startbyten: den som lämnar räknas inte i omgången – är hen den sista som saknas går omgången vidare, och efter sista omgången lottas första lag. Handen slängs, undanlagda bytesskort blandas tillbaka som vanligt. Sena byten och ett andra Lämna avvisas.
- Startbekräftelse och Fortsätt: den sista som saknas lämnar → nästa strid startar exakt en gång (en loggrad "Strid N"); startspelaren som lämnar ersätts av nästa levande lagkamrat.
- Målval: startspelaren lämnar → nästa levande tar över samma strid; 8 spelare ned till 1 mot 4 spelar vidare (ensam anfallare måste lägga kort, försvarskön b1–b4). Har resten av laget inga handkort startar striden om med samma nummer och skyddsregeln ger det andra laget turen.
- Anfall: den aktiva lämnar → nästa i kön. Ett spelat kort tas bort (12B): 3 + 2 blir 2 när treans ägare lämnar. Försvinner lagets enda kort måste den sista i kön nu bidra (Avstå avvisas). Finns ingen kvar som kan bidra låses anfallet tomt, försvararna slutför sina val och försvaret håller (24B, attack 0).
- Försvar: den aktiva hjälparen lämnar → nästa; ett spelat försvarskort tas bort och försvaret räknas om (Järnport bort: 3 mot 0, träff). Lämnar den sista i försvarskön avgörs striden.
- 24B (Mira-exemplet): anfallaren lämnar under försvaret → attack 0, försvaret håller, Helande ljus läker måltavlan från 2 till 3, och en Törnesköld riktad mot den som lämnat skadar ingen annan.
- 17A: en Barriär bunden till ett Eldklot som försvinner byter inte mål; Stormning går igenom (3 mot 0).
- 13A: måltavlan lämnar under anfallet (Vampyrbett läker inte) eller under försvaret (ingen läkning, motstöt eller skada) → striden sparas som AVBRUTEN/MÅLTAVLAN_BORTA utan livsändringar, bordet slängs, tomma händer fylls, startspelaren roteras, alla levande bekräftar Fortsätt och det andra laget anfaller.
- Resultatläget: ett Lämna ändrar inte det sparade resultatet.
- Matchslut prövas först: lämnar försvarande lagets sista spelare (som också är måltavlan) blir det lagvinst, inte 13A; lämnar anfallande lagets sista mitt i striden slängs bordet och det andra laget vinner utan påfyllning. Efter matchslut avvisas sent Lämna ("Matchen är avslutad.") och sen `slaUt` ("Matchen är redan avgjord."), och matchen lämnas orörd.
- `slaUt`: båda lagens sista samtidigt → AVSLUTAD utan vinnare (`INGA_SPELARE`); måltavla och lagkamrat samtidigt → en avbruten strid; dubbletter räknas en gång; redan utslagna hoppas över (orsaken skrivs inte om); bara redan utslagna eller okänd spelare avvisas.
- Hela matcher: 6 frön × 4/6/8 spelare (18 matcher) med slumpade spelval, Lämna (2,5 % per steg) och gruppvisa tidsgränser/avbrott (1 %). Totalt 42 avhopp, 11 grupputslagningar och 2 avbrutna strider. Efter varje steg kontrolleras: ingen låst kö (aktiv spelare lever och har val; i byte och bekräftelser finns någon levande som saknas), måltavlan lever under öppen strid, utslagna har inga val, ingen hand och inga bordskort, och avhopp utanför en öppen strid ändrar aldrig sparat resultat. Varje match tar slut med rätt vinnare, tomt bord och korrekt kortbokföring.
Inte verifierat / återstående fel:
- Ingen server- eller vykoppling: `GE_UPP` från en lagmatch når ännu inte servern (L14), och knappen "Lämna matchen" finns inte i lagvyn (L15). Tidsgränser och avbrott (L16, L17) ska anropa `slaUt` men är inte byggda.
- "Ingen vinnare" kan bara uppstå genom samtidig utslagning; det slumpade provet träffade det inte, men det fasta testet täcker fallet.
- Vad utslagna ser (offentlig matchinformation eller lobbyn) hör till L14/L15.
Tekniska val och eventuella användarsvar:
- **`GE_UPP` = Lämna matchen** i lagmatch. Det är alltid tillåtet för en levande spelare medan matchen pågår och listas därför inte i `allowedActions`. Duellens `GE_UPP` är oförändrat.
- **Ordning vid utslagning:**
  1. Markera spelaren och släng hennes egna bordskort (12B) och hand, en gång per spelare.
  2. Pröva matchslut.
  3. Om måltavlan lämnade en öppen strid gäller 13A.
  4. Annars fortsätter fasen med omräknade köer.
- **13A följer samma flöde som en vanlig strid**: resultatrutan, Fortsätt, påfyllning, rotation av startspelare och lagbyte. Resultatet saknar livsändringar och räknas inte som en vunnen attack.
- **Bidragskravet prövas om efter varje borttagning.** Ett tomt anfall låses ändå om ingen kvar kan bidra, så att försvararnas giltiga resultateffekter (24B) kan slutföras.
- **Avhopp under målval:** samma strid fortsätter med nästa startspelare. Saknar laget handkort startas striden om utan nytt stridsnummer, så att påfyllning och turordning inte hoppar.
- **`slaUt` har ingen revisionskontroll**; servern kör den i matchens kö efter tidigare kommandon. Orsaken `LIV` sätts bara av stridsavgörandet.
- Inga användarfrågor behövdes.
Beroenden som nu är klara: L00–L13 (etapp 1–3).
Rekommenderad nästa uppgift: L14 – Lagmotor kopplad till servern (etapp 4).
Commit: ingen.

Uppgift och datum: L14 – Lagmotor kopplad till servern, 2026-10-13
Status: Klar
Genomfört och ändrade filer:
- Ny: `online/matcher.js` – väljer regelmotor efter deltagarantal (2 → duell, 4/6/8 → lag) och skickar varje matchkommando och vyhämtning till den modul som skapade matchen. Kö, transaktion, kvittenser och lagring är gemensamma.
- Ny: `online/lagspel.js` – motorfabrik för starttransaktionen, kommandohantering och `matchFor`. Ingen spelregel finns här; allt avgörs av `lagmatch.js`.
- Ny: `lagvy.js` – `lagVy()` (privat vy enligt kontraktet) och `lagHandelser()` (typade, offentliga händelser). Ren data utan Node-beroenden, så att lagvyn i webbläsaren (L15) kan använda samma form.
- Ändrad: `online/server.js` – använder `matcher.js`; ny inställning `lagspel` (`TORNSTRIDEN_LAGSPEL=1`) som öppnar lagformaten i lobbyn, avstängd som standard.
- Ändrad: `online/rum.js` – den som slagits ut ur en pågående lagmatch (FÖLJER_AVSLUT) kan gå till lobbyn med LÄMNA utan att rum eller match ändras.
- Ändrad: `kontrakt.js` – formkontroll av `cards` (byte) och `targetInstanceId`/`targetPlayerId` (försvar).
- Ändrad: `KONTRAKT.md` (nytt avsnitt "Lagmatch online") och `README.md`.
- Tester: ny `online/lagspel.test.js` (9 tester) och ett nytt HTTP-prov i `online/server.test.js`.
- Oförändrade: lagmotorn (`lagmatch.js`, `lagkortlek.js`, `lagstrid.js`, `lagregler.js`), `online/duell.js`, `online/tjanst.js`, lagringen och alla webbläsarfiler.
Verifiering:
- `npm test`: 230 tester, 230 godkända, tre körningar i rad.
- Webbläsarprov i molnmiljön (Playwright/Chromium mot en kopia av arbetskatalogen): `prova-lobby.mjs` 24/24, `prova-online.mjs` 9/9, `prova-regressioner.mjs` 5/5. Onlineduellen fungerar som förut genom den nya motorväljaren.
- Start: 4/6/8 deltagare ger `format: 'lag'`, `lag-v1` och rätt kortlek. Lagens ordning är rummets ordning, och motorns spelar-ID och namn kommer från sessionerna. Alla blir SPELAR med matchens id. Efter start avvisas lagbyte och LÄMNA ("Matchen har startat").
- Varje plats får en privat vy som klarar `validatePrivateView`: egen hand (10 kort) stämmer med servern, andra visas bara med kortantal, och `assertNoSecrets` fäller vyn för en annan läsare.
- Separata testklienter (en per deltagare, som bara väljer ur sin egen vy och skickar samtidigt) spelade hela matcher:
  - 4 spelare: 153 kommandon, 19 strider.
  - 6 spelare: 322 kommandon, 26 strider.
  - 8 spelare: 450 kommandon, 30 strider.
  - Alla samtidiga byten och bekräftelser godkändes, utan en enda krock.
  - Efter varje omgång kontrollerades att ingen annans aktuella hand fanns någonstans i någon vy, utom kort som redan visats i senaste resultatet.
  - Händelserna saknar luckor, klarar `validateEvent` och bär ingen hand.
  - Matchslut gav AVSLUTAD, ett stängt rum och FÖLJER_AVSLUT för alla.
- Avhopp via servern (4 matcher, 16 avhopp, 5 avbrutna strider enligt 13A): den som lämnar blir FÖLJER_AVSLUT direkt, behåller en vy utan hand och val, och laget spelar vidare tills matchen tar slut.
- Samtidiga matcher (4 och 6 spelare spelade sammanflätat): varje vy, händelse och kortexemplar hör till den egna matchen; inget från den andra matchen finns i händelserna.
- Samtidiga val:
  - Alla byter och bekräftar ur samma vy och godkänns.
  - En upprepad Fortsätt är GODKÄND utan ändring.
  - En Fortsätt från ett äldre resultat, ett byte från en tidigare omgång och ett turval med gammal revision avvisas ("Matchläget har ändrats").
  - Övergången till nästa strid sker exakt en gång.
- Identitet: `playerId` eller `teamId` i kommandot eller i payload avvisas av kontraktet. Fel tur, utomstående spelare, mål i eget lag och okänd match avvisas, och matchen är orörd.
- Gamla kommandon: den som lämnat går till lobbyn och startar en ny duell. Ett nytt kommando till den gamla matchen avvisas ("Du deltar inte"). Samma gamla Lämna-kommando ger samma kvittens utan ny effekt. Den nya matchen är orörd, och den gamla spelar klart utan att röra spelarens nya session.
- Motorfel (trasig kortbokföring): INTERNT_FEL, ingenting sparat, inga händelser, ingen vinnare.
- HTTP: fyra separata klienter med egna kakor och SSE-strömmar startade och spelade en hel 4-spelarmatch över `/api/kommando` och `/api/match`. Inget svar innehöll en annan spelares aktuella hand, varje ström fick bara den egna vyn, slutläget nådde alla och alla kom tillbaka till lobbyn som lediga.
Inte verifierat / återstående fel:
- Ingen lagvy i webbläsaren än (L15). Därför är lagformaten stängda i lobbyn som standard. Startar man en lagmatch med `TORNSTRIDEN_LAGSPEL=1` kan den bara spelas med testklienter; dagens `match.html` förstår inte lagvyn.
- Anslutningsstatus i lagvyn är sessionens (ANSLUTEN/FRÅNKOPPLAD); återanslutningsfrister och tidsgränser kommer i L16/L17.
- `lagvy.js` finns inte i `deploy.sh` eller i `CLIENT_FILES`. Webbläsaren behöver den först i L15.
Tekniska val och eventuella användarsvar:
- **Motorns spelar-ID = sessionens `playerId`** (redan offentligt i lobbylistan). Ingen platsmappning behövs, till skillnad från duellens A/B.
- **Samtidiga val:** byten och bekräftelser prövas mot början av den pågående samlingen (fas + bytesomgång + strid) i stället för exakt revision, enligt huvudplanens "rätt resultat" för Fortsätt. Utan detta skulle 4–8 samtidiga bekräftelser krocka. Lämna godtas med vilken tidigare revision som helst. Turval kräver exakt revision. Lagmotorns egen revisionskontroll är oförändrad.
- **Bekräftelser ökar revisionen i lagmatchen**, eftersom de ligger i motorn (L12). I duellen gör de det inte. Kontraktet beskriver båda.
- **Lagformaten stängda som standard:** `startaServer({ lagspel })` / `TORNSTRIDEN_LAGSPEL=1`, så att en publicering före L15 inte leder till en matchsida som inte förstår lagvyn. L15 tar bort spärren.
- **Utslagna:** blir FÖLJER_AVSLUT direkt, ser offentlig information och kan gå till lobbyn med LÄMNA. Därefter kan de spela en ny match, och gamla kommandon påverkar den inte.
- **Motorfel** rullar tillbaka allt (som i duellen) i stället för att spara fasen FEL.
- Inga användarfrågor behövdes.
Beroenden som nu är klara: L00–L14.
Rekommenderad nästa uppgift: L15 – Lagvy och val av mål (avslutar etapp 4).
Commit: ingen.

Uppgift och datum: L15 – Lagvy och val av mål, 2026-10-14
Status: Klar
Genomfört och ändrade filer:
- Nya: `lagmatch.html`, `lagmatch.css`, `lagmatchvy.js` – lagmatchens sida. Bordet har fiendelaget överst, stridsplatsen med anfalls- och försvarskön i mitten och det egna laget nederst, närmast handen. Alla val görs i knappraden direkt ovanför handen: byten, Börja striden, måltavla, kort, vanlig/enkel attack, kortmål, spelarmål, avstående och Fortsätt. Resultatrutan visar lagets resultat och den egna utslagningen på var sin rad. Lämna matchen frågar först.
- Ny: `kortlupp.js` – långtrycket, kortrutan och kortflygningarna, flyttade ur `matchvy.js` oförändrade och delade av duellen och lagvyn. Lagvyn lägger till en rad "I lagmatch" för specialkorten (14A–20A).
- Nytt test: `klientfiler.test.js` (2 tester). Det följer varje sidas script, stilmallar och importer. Publicerade sidor får bara ladda filer som finns i `deploy.sh` och släpps igenom av servern. Onlinesidorna får aldrig ladda lagmotorn.
- Nytt prov: `scripts/prova-lag.mjs` – hela lagmatcher 4/6/8 i separata webbläsarkontexter (varannan i mobilvy), bara via gränssnittet.
- Ändrade:
  - `matchvy.js`: använder `kortlupp.js`; skickar vidare till `lagmatch.html` när vyn är en lagmatch.
  - `onlinematch.js`: `viewer()` blir eget spelar-ID i lagmatchen.
  - `kontrakt.js`: `TEAM_FORMAT`, `TEAM_MATCH_PHASE`, `TEAM_OUTCOME`, `TEAM_END`, `ELIMINATION`. `lagmatch.js`, `lagstrid.js` och `lagvy.js` använder samma objekt, så det finns en källa.
  - `online/server.js`: lagformaten öppna som standard; `TORNSTRIDEN_LAGSPEL=0` stänger dem.
  - `online/matcher.js`: kommentar.
  - `server.js`: `CLIENT_FILES` med lagsidan och `kortlupp.js`.
  - `deploy.sh`: `kortlupp.js`, som den lokala matchsidan nu importerar.
  - `lobby.js`: rubriken "Matchen pågår – du är utslagen" för den som slagits ut ur en pågående match.
  - `online/server.test.js`: lagfilerna serveras, lagmotorn ger 404, lagformaten är tillgängliga.
  - `KONTRAKT.md`, `README.md`.
- Oförändrade: lagmotorns regler, servern i övrigt, `match.html`, `match.css` och lobbyflödet.
Verifiering:
- `npm test`: 232 tester, 232 godkända, tre körningar i rad.
- `scripts/prova-lag.mjs` i molnmiljön (Playwright/Chromium mot en kopia av arbetskatalogen; varannan deltagare emulerad iPhone 13):
  - 4 spelare: 9/9 kontroller, 18 strider.
  - 6 spelare: 11/11, 23 strider. En deltagare lämnade efter strid 2 och följde resten av matchen; laget spelade vidare med 2 mot 3.
  - 8 spelare: 12/12, 20 strider. En deltagare lämnade och gick till lobbyn medan matchen pågick.
  - Kontrollerna i varje match:
    - Matchsidan skickar alla till lagvyn; egen hand och båda lagens torn syns.
    - Långtryck öppnar kortet.
    - Hela matchen spelades bara via gränssnittet: enkel attack, kortmål (6 val) och spelarmål (4 val) användes.
    - De andra ser "Lämnade matchen".
    - Den som lämnat ser "Du är utslagen – laget spelar vidare" och vid slutet lagets resultat separat ("Ditt lag vinner matchen! … Du var utslagen, men laget tog hem segern").
    - Resultatet är personligt per lag.
    - Inga andras handkort i nätverkssvaren; inga sid- eller konsolfel.
  - Mobilen: bekräftelseknappen ligger 23 px ovanför handen, knapp och kort ryms inom 241 px av 664, och korten är 174 px höga.
  - 8-spelarmatchen kördes två gånger. Första gången kraschade provskriptet när det mätte mobilavståndet medan mobilspelaren hade tom hand. Det var ett fel i provet, inte i vyn, och det är rättat; omkörningen gav 12/12.
- Duellens webbläsarprov efter flytten av långtrycket: `prova-match.mjs` 13/13 (långtryck, datormatch, tvåspelarläge), `prova-online.mjs` 9/9, `prova-regressioner.mjs` 5/5, `prova-lobby.mjs` 24/24.
- `./deploy.sh` mot en temporär katalog: `kortlupp.js` publiceras och importeras med `?v=`-stämpel. Lagsidan och lobbyn publiceras inte ännu (L21).
- Att `klientfiler.test.js` fångar en saknad fil prövades: med `kortlupp.js` borttagen ur `deploy.sh` föll testet med "match.html laddar kortlupp.js, som saknas i deploy.sh".
Inte verifierat / återstående fel:
- Bara Chromium (dator och emulerad iPhone 13). Riktiga telefoner, Safari/WebKit och skärmläsare är inte provade.
- På en mobil i 8-spelarmatch fyller bordet ungefär en skärmhöjd. Knappraden och handen ligger alltid intill varandra, men bordet och handen syns inte samtidigt.
- Ljud provades inte (huvudlös webbläsare). Lagspecifika ljud och animationer hör till L19.
- Inga tidsgränser eller återanslutningsfrister ännu (L16, L17).
Tekniska val och eventuella användarsvar:
- **Egen sida för lagmatchen** i stället för förgreningar i hela `matchvy.js`. Duellvyn är nästan orörd. `match.html?online=1` är fortfarande den enda adressen lobbyn behöver känna till.
- **Delad `kortlupp.js`** så att långtrycket är samma kod i båda vyerna.
- **Konstanterna i `kontrakt.js`** så att webbläsaren inte behöver lagmotorn (den spärras också av servern).
- **Alla val i knappraden ovanför handen** för mobilkravet. Måltavlan kan också väljas genom att trycka på ett fiendetorn. Finns bara ett giltigt kortmål eller spelarmål väljs det direkt, och det syns.
- **Lagformaten öppna som standard** nu när vyn finns, med samma status som onlineduellen: utvecklingsleverans tills L16–L22 är klara.
- **`deploy.sh` får bara `kortlupp.js`.** Lobbyn och lagsidan läggs till när onlinespelet ska publiceras (L21), enligt tidigare beslut.
- Under arbetet tappade `deploy.sh` sin körbarhetsbit när jag provade testet; den är återställd (`git diff --summary` visar inga lägesändringar).
- Inga användarfrågor behövdes.
Beroenden som nu är klara: L00–L15 (etapp 1–4).
Rekommenderad nästa uppgift: L16 – Spelarklockor och gemensamma bekräftelser.
Commit: ingen.


### Rättning av granskningsfynd L10–L15 – 2026-10-14

Uppgift: rätta de sex bristerna från granskningen av L10–L15.
Status: rättat och verifierat i arbetskatalogen. Varje brist fick först ett test som visade felet.

- L10: `confirmSwap` kräver en lista (en utelämnad lista är fortfarande "behåll handen"); `null`, text, tal och objekt avvisas i stället för att tolkas som ett tomt byte.
- L10: `validateTeamDeck` kräver 4, 6 eller 8 deltagare även när egna antal kopior anges. Tidigare gav ett ogiltigt antal (t.ex. `undefined`) en jämförelse mot `NaN` som alltid släppte igenom leken.
- L12: handlingar slås upp med `Object.hasOwn`, så `toString`, `constructor`, `__proto__` med flera avvisas som okända. Före rättelsen godkändes de och höjde revisionen. Samma rättelse i duellmotorn `match.js`, som hade samma uppslagning; regeln påverkas inte.
- L14: påfyllningshändelsen läses ur motorns redovisning (`lastRefill` i lagmatchen) i stället för ur skillnaden i handstorlek. Den som spelar sitt sista kort och får fem nya i samma steg får nu "5", inte "4". Duellen berördes inte: där fylls handen vid Fortsätt, när den redan är tom.
- L15: valda mål (måltavla, kortmål, spelarmål) prövas mot varje ny vy och innan draget skickas. Ett mål som servern inte längre erbjuder släpps, och finns bara ett giltigt mål väljs det.
- L15: förhandsvisning enligt huvudplanen ("Under kortval används samma styrkeberäkning som förhandsvisning"). Vyn får `battle.preview` från samma beräkning som avgörandet, utan livsändringar. Bordet visar lagens summor och avdrag (Isrustning, Sprängladdning), och per kort bonus, stopp och spegling. Fastexten och knappraden säger "Just nu: attack X mot försvar Y – försvaret håller/anfallet går igenom om inget mer läggs". Resultatrutan visar samma uppgifter i efterhand.

Ändrade filer: `lagkortlek.js`, `lagregler.js`, `lagmatch.js`, `match.js`, `lagvy.js`, `lagmatchvy.js`, `lagmatch.html`, `lagmatch.css`, `KONTRAKT.md`. Nya tester: ett per brist i `lagkortlek.test.js`, `lagregler.test.js`, `lagmatch.test.js` och `match.test.js`, samt ny `lagvy.test.js` (påfyllningshändelsen och förhandsvisningen). `scripts/prova-lag.mjs` har ett nytt riktat webbläsarprov och tålig mobilmätning, och första anfallet i varje match görs med enkel attack.

Verifiering:
- `npm test`: **238/238**, tre körningar i rad. De sex nya testerna fallerade före rättelserna.
- Webbläsarprov i molnmiljön (Chromium, varannan deltagare emulerad iPhone 13): `prova-lag.mjs` 4 spelare **15/15**, 6 spelare **18/18**, 8 spelare **18/18**.
- Det riktade provet:
  1. Försvararen väljer Spegelsköld, och målet Drakeld väljs automatiskt.
  2. Drakelds ägare lämnar.
  3. Försvaret godkänns utan mål, och summorna 5 → 1 och försvar 1 visas medan striden pågår.
- Samma prov mot lagvyn från före rättelsen återskapade felet: draget avvisades med "Det finns inget magiskt attackkort att spegla.", och förhandsvisningen saknades.
- Duellen: `prova-match.mjs` 13/13, `prova-online.mjs` 9/9, `prova-regressioner.mjs` 5/5.

Provskriptet hade två egna kapplöpningar: mobilmätningen när vyn ritades om, och en läsning av serverns läge innan draget sparats. Båda är rättade. En kontroll som summerade enkla attacker över alla storlekar fallerade när 4 spelare kördes ensam; den är nu deterministisk.

Ingen commit, push eller publicering ingick. L16 är fortsatt nästa planerade implementation.

Uppgift och datum: L16 – Spelarklockor och gemensamma bekräftelser, 2026-10-15
Status: Klar
Genomfört och ändrade filer:
- Ny: `online/klockor.js`.
  - Varje val som servern kräver av en viss spelare har 90 sekunder: kortbyte, startbekräftelse, målval, kortspel, avstående och Fortsätt.
  - Klockorna sparas med matchen (`klockor {spelare: {nyckel, start, deadline}}`) och räknas om efter varje ändring. Samma val behåller sin deadline, ett nytt val får nya 90 sekunder, och den som bara väntar på andra har ingen klocka.
  - En timer per match går vid tidigaste deadline och körs i matchens kö.
- `online/tjanst.js`: mottagningstiden tas innan kommandot köas och skickas till hanteraren (`mottagen`). `efterGodkand(fn)` anropas efter varje sparat godkänt kommando.
- `online/matcher.js`: skapar timern och planerar om den efter varje godkänt kommando, även STARTA. Timern går till rätt modul (`tidsgrans`); `pa(fn)` meddelar servern och `stang()` tar bort timers.
- `online/lagspel.js`:
  - Den som har val enligt motorns `allowedActions` har en klocka.
  - Ett kommando på eller efter spelarens deadline avvisas med "Tiden för ditt val har gått ut.".
  - Timern slår ut alla vars tid gått ut i en och samma händelse med `slaUt` (orsak TIDSGRÄNS).
  - Sparandet är samlat i `spara()` för både drag och tidsgräns.
  - En match utan levande lag sparas AVBRUTEN (huvudplan §10).
- `online/duell.js` och `match.js`:
  - Den som är på tur eller ska bekräfta har klockan.
  - Ny `tidsgrans(match, platser)` i duellmotorn: den vars tid gått ut förlorar (`TIDSGRÄNS`).
  - Går båda ut samtidigt vinner ingen (`INGEN_VINNARE`), och matchen sparas AVBRUTEN.
- `online/server.js`: en tidsgräns skickar nya vyer till alla deltagare; timers tas bort vid avstängning.
- `lagvy.js` och duellens vy: `deadline` (egen), `clocks` (alla väntade spelares deadlines, offentligt) och `serverTime`.
- `onlinematch.js`: `serverNu()` räknar ned mot serverns tid enligt skillnaden när vyn togs emot.
- Ny: `nedrakning.js`, delad av båda vyerna.
  - Den som har ett val ser "1:30 kvar att välja" överst i knappraden, i resultatrutan och i duellens startruta.
  - Under 20 sekunder visas en varning med text, tecken och färg: "… kvar – välj nu, annars slås du ut" i lagmatchen och "annars förlorar du matchen" i duellen. Skärmläsare får "Mindre än 20 sekunder kvar att välja." en gång.
  - Lagvyns torn visar varje väntad spelares tid på statusraden ("10 kort · Inte klar · ⏱ 1:12"). Duellen visar motståndarens tid vid motståndarens torn.
- `matchvy.js`: förlust på tid ("Du hann inte välja i tid.") och matchslut utan vinnare ("Ingen vinner matchen").
- `lagmatchvy.js`, `lagmatch.html`, `match.html`, `match.css`: nedräkning, varning och skärmläsarrad. Lagvyn säger "Matchen avbröts utan vinnare" när inget lag finns kvar.
- `server.js` (`CLIENT_FILES`) och `deploy.sh`: `nedrakning.js`. Duellsidan importerar den, så den publiceras med `?v=`-stämpel.
- Tester och prov:
  - Ny: `online/klockor.test.js` (10 tester).
  - `online/server.test.js`: en tidsgräns i en duell når båda strömmarna utan något kommando.
  - `online/lagspel.test.js`: en match utan vinnare ska vara AVBRUTEN.
  - Nytt prov: `scripts/prova-klockor.mjs`.
- `KONTRAKT.md` (avsnittet "Spelarklockor"), `README.md`.
Verifiering:
- `npm test`: **248/248** (238 tidigare och 10 nya) efter alla rättningar; 246 före granskningarna, tre körningar i rad.
- `online/klockor.test.js` (styrd klocka, inga verkliga väntetider):
  - Deadline − 1 ms godtas och exakt deadline avvisas, i både lagmatch och duell.
  - Ett avvisat drag och en omladdning ändrar inte deadline. Väntan på andra ger ingen klocka.
  - Ett drag köat 1 ms före deadline bakom en spärrad kö godtas, trots att servern blir klar 5 s efter deadline. Ett drag mottaget exakt på deadline avvisas.
  - Tre samtidiga utgångar slås ut i samma händelse, och vinnaren prövas efter hela gruppen.
  - Alla sex i en 6-spelarmatch slås ut samtidigt: matchen blir AVBRUTEN utan vinnare, rummet stängs och alla blir FÖLJER_AVSLUT.
  - Startbekräftelse, målval, kortspel, försvar och Fortsätt har klockor. Den som inte bekräftar Fortsätt slås ut, och nästa strid startar direkt.
  - En dubbel timer har ingen effekt (oförändrad revision och händelser).
  - Duellen: förlust på tid, och båda startbekräftelserna ute samtidigt ger ingen vinnare.
  - Timern stoppas i stället för att snurra när en utgången klocka inte får effekt (motorfel), och efter `stang()` planeras inget nytt. Testet föll mot koden före rättningen (timer med 0 ms kvar) och passerar efter.
- Webbläsarprov i molnmiljön (Chromium, varannan deltagare emulerad iPhone 13), körda ett i taget:
  - `prova-klockor.mjs`: **17/17**.
    - Fyra deltagare ser 1:30, och tornen visar tiden.
    - Den som behållit handen har ingen klocka.
    - Efter 75 s visas en varning med text och ett skärmläsarbesked.
    - Efter 90 s slås två ut tillsammans, med besked "Tiden för ditt val tog slut". De två andra får nya 90 s i omgång 2.
    - Duell: egen och motståndarens nedräkning. Efter 90 s visar resultatrutan "Du hann inte välja i tid" respektive "Du vinner matchen".
  - `prova-lag.mjs 4 6 8` i en körning: **37/37**. 12, 21 och 18 strider; kortmål 3, spelarmål 3, enkel attack 10.
  - `prova-match.mjs` 13/13, `prova-online.mjs` 9/9, `prova-regressioner.mjs` 5/5, `prova-lobby.mjs` 24/24.
- Fel som provet hittade och som är rättat: först låg tornens klocka på en egen rad. Det gjorde bordet så högt i 6- och 8-spelarmatcher på mobilen att handen hamnade under skärmkanten, och långtryckskontrollen föll. Klockan står nu på tornets statusrad, och mobilmåtten är oförändrade (23 px mellan knapp och kort).
- En första omgång där proven kördes samtidigt gav tidtagningsfel av överbelastning (belastning 36 på 2 kärnor). Den räknas inte; alla resultat ovan är från körningar ett i taget.
- **Oberoende granskning 2026-10-15** (en separat agent som inte sett arbetet, mot kravtexten och huvudplan §9–10, med egna prov med styrd klocka). Bekräftat korrekt: tidsregeln (mottagen före kön, dedupe före tidskontroll, < i tid, == för sent), klocka ⇔ val i alla faser, nycklarna i `kravLag` vid avhopp, ny ledare, `pruneQueue` och omstart av strid, duellens nycklar, grupputslagning, AVBRUTEN utan vinnare, dubbel timer, hemligheter, klientens nedräkning och `deploy.sh`. Ett fynd rättat:
  - `online/klockor.js`: om tidsgränsen kastade (motorfel, rullas tillbaka) eller inte fick effekt fast en klocka gått ut, planerades timern om med 0 ms och servern snurrade i en tät slinga med full CPU. Nu stoppas matchens timer och felet loggas; nästa godkända kommando planerar den igen.
  - `online/matcher.js`, `online/server.js`: `stang()` väntar in en redan köad timerkontroll innan lagringen stängs, och efter avstängning planeras inga nya timers.
  - Efter rättningen: `npm test` 247/247, `prova-klockor.mjs` 17/17, `prova-online.mjs` 9/9.
- **Användarens granskning 2026-10-15** fann två brister till, båda återskapade och rättade:
  - *En fördröjd timer kunde ge fel vinnare.* Deadlinekontrollen gällde bara avsändaren: A hade bekräftat starten, B:s 90 sekunder gick ut medan timern var sen, A lämnade – och B vann. Nu behandlas alla klockor som gått ut vid kommandots mottagningstid före kommandot (`tjanst.foreHantering` → `klockor.kontrollera(matchId, mottagen)`, i egen transaktion som står kvar även om kommandot avvisas). I scenariot förlorar B på tid först, A vinner, och A:s Lämna avvisas eftersom matchen redan är avgjord. Nytt test i `online/klockor.test.js` för både duell och lagmatch; två äldre tester uppdaterade (avsändaren som är för sent slås nu ut direkt, med beskedet "Tiden för ditt val har gått ut.").
  - *Spelförklaringen dolde varningen och slutbeskedet.* Nedräkningen ligger nu som en fast rad överst i alla öppna rutor (spelförklaring, bytesförklaring, kortruta, ljud- och bekräftelseruta), och vid matchslut – samt när jag själv slås ut i lagmatchen – stängs öppna hjälprutor så att resultatet eller utslagningen syns direkt. `prova-klockor.mjs` har fyra nya kontroller där en deltagare i varje match låter spelförklaringen ligga öppen hela tiden (21 kontroller). `prova-regressioner.mjs` tål nu att spelförklaringen redan är stängd när sidan laddas om efter matchslut.
  - Efter båda rättningarna, ett prov i taget i molnet: `prova-klockor.mjs` 21/21, `prova-lag.mjs 4 6 8` 37/37, `prova-match.mjs` 13/13, `prova-online.mjs` 9/9, `prova-regressioner.mjs` 5/5, `prova-lobby.mjs` 24/24.
Inte verifierat / återstående fel:
- Bara Chromium (dator och emulerad iPhone 13). Riktiga telefoner, Safari och riktiga skärmläsare är inte provade.
- Klientens nedräkning utgår från serverns tid när vyn togs emot. Nätfördröjning gör att den visar lite mindre tid än servern, aldrig mer.
- Frånkoppling påverkar inte klockan ännu. Pausen och återanslutningsfristen under avbrott hör till L17 (26B).
Tekniska val och eventuella användarsvar:
- **Ett kommando som tas emot efter avsändarens deadline** leder till att avsändaren slås ut på tid innan kommandot prövas (huvudplan §10: "ny handling är i tid om mottagningstid < deadline"); kommandot avvisas med "Tiden för ditt val har gått ut.". Det gäller även Lämna, som då ger orsak TIDSGRÄNS i stället för LÄMNADE.
- **Klientens nedräkning** mäts från serverns tid i den senaste vyn, utan nätfördröjning, och kan därför visa något mer tid än servern har kvar. Servern avgör; en spelare kan se 0:01 och ändå få "Tiden för ditt val har gått ut".
- **Första klockan startar i starttransaktionen**, innan sidan hunnit laddas och spelförklaringen lästs. 90 sekunder räcker, men den som läser länge ser en kortare nedräkning.
- **Mottagningstiden avgör.** Den tas innan kommandot köas, så kö- och databastid räknas aldrig mot spelaren. Timern ligger i samma kö som kommandona och prövar om vilka klockor som verkligen gått ut. Därför har en sen eller dubbel timer ingen effekt.
- **Klockorna räknas om ur motorns läge** efter varje ändring i stället för att startas och stoppas för hand. Ett val kan inte glömmas, och den som väntar får ingen klocka.
- **Avbruten utan vinnare** när inget lag finns kvar, både vid tidsgräns och när de sista har lämnat (huvudplan §10). I duellen gäller samma sak när båda tiderna går ut samtidigt. Tidigare sparades en lagmatch utan lag som AVSLUTAD.
- Varningen kommer vid 20 sekunder kvar (beslutspunkten "Varningstid före 90-sekundersgränsen").
- Inga användarfrågor behövdes.
Beroenden som nu är klara: L00–L16.
Rekommenderad nästa uppgift: L17 – Återanslutning med fortsatt spel.
Commit: ingen.

### Rättning av duellens ljudruta – 2026-10-15

- `match.html`: ljudrutan visar nu den egna nedräkningen och varningen under 20 sekunder med samma komponent som övriga rutor. Den som väntar på motståndaren har ingen egen klocka.
- `matchvy.js`: ljudrutan stängs vid matchslut. Ett vanligt stridsresultat väntar tills ljudrutan stängs och öppnas då via samma stängningshantering som övriga hjälprutor.
- `scripts/prova-klockor.mjs`: fem nya kontroller för ljudrutans nedräkning, väntande motståndare, varning utan återställd deadline, mobilutrymme och stängning vid tidsförlust.
- Verifierat lokalt i Chrome: **26/26** webbläsarkontroller. Varningsraden granskad visuellt vid 390 × 664 pixlar. `klientfiler.test.js` och `ljud.test.js`: **11/11**. `git diff --check`: utan anmärkning.
- Ingen commit eller publicering.
