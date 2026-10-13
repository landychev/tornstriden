# Implementera lobby

Status: lokal plan och pseudokod. Ingen spelkod är ändrad och ingen onlinefunktion är implementerad.
Uppdaterad: 2026-10-13. Utgångspunkt: Tornstriden efter `b6c6bf9`, inklusive långtryck och versionsstämpling i `deploy.sh`.

## Snabböversikt

Spelaren anger ett nick, går in i en gemensam lobby och markerar namn för att bjuda in till **samma match**. Matchen har **2, 4, 6 eller 8 spelare i två lika stora lag vid start**. Spelarna väljer lag själva. Värden startar när alla anslutna deltagare är redo och fördelningen är giltig; återstående inbjudningar stängs då.

Den som lämnar eller förlorar på tid **slås ut individuellt**. Övriga fortsätter, även om lagen blir olika stora. Vid avbrott får varje spelare högst 30 sekunder att återansluta och totalt 90 sekunders återanslutningstid per match. Vid ett obesvarat spelarval ges varning och nedräkning, sedan utslagning efter 90 sekunder.

Första versionen använder nick utan konto och kör spelservern på samma server som Tornstriden. Första testbara leveransen är lobby, inbjudningsrum, lagval, redo och värdens startknapp. Därefter byggs den gemensamma matchen, återanslutning och drift.

Valen 1–27 är beslutade, inklusive specialeffekter, roterande turordning, påfyllning av tomma händer, enkel attack och lyckat försvar när alla anfallskort försvinner genom avhopp. Avsnitt 7 sammanställer reglerna i en effektordning med pseudokod och räkneexempel. Värdbyte, fortsatt spel under personliga anslutningsavbrott och avbruten match vid serveromstart är också beslutade. Återstående tekniska arbetsförslag är markerade som förslag. Dokumentets pseudokod är en målbild, inte färdiga funktioner som redan finns.

## 1. Beslutslista

| Val | Beslut |
| --- | --- |
| Lobby och nick | Gemensam lobby. Markera namn och bjud in. Gästsession utan konto. |
| 1B – flera inbjudna | Alla som accepterar en giltig inbjudan ansluter till samma matchrum. Första acceptansen stänger inte övrigas inbjudningar. |
| 2A – avbrott | Högst 30 sekunder per upptäckt avbrott, totalt 90 sekunder per spelare och match. |
| 3A – inaktivitet | Varning och nedräkning, sedan individuell förlust efter 90 sekunder vid ett väntande val, även Fortsätt. |
| 4A – konto | Nick räcker i första versionen. Nicket bevisar inte identitet; sessionen identifierar spelaren. |
| 5A – drift | Samma server som Tornstriden. Tekniska förutsättningar för Node-tjänst, lagring och proxy ska verifieras. |
| 6A – matchformat | Två lag, totalt 2, 4, 6 eller 8 deltagare. Lagen är lika stora när matchen startar. |
| 7B – lagindelning | Spelarna väljer själva lag före start. Start blockeras vid ojämna lag. |
| 8A – lämna/tidsförlust | Bara den berörda spelaren slås ut. Lagkamraterna fortsätter utan ersättare eller automatisk dator. |
| 9B – matchstart | Värden väljer Starta när alla i rummet är redo och antalet passar spelformen. Kvarvarande inbjudningar stängs. |
| 10A – lagstrid | Turansvarig väljer fiendetorn. Varje anfallare får lägga högst ett kort eller avstå. Måltavlan försvarar först, därefter får lagkamrater hjälpa med högst ett kort var. Styrkor summeras; en träff kostar måltavlan ett liv. Lagen växlar anfallsroll. |
| 11A – lagkortlek | Skala dagens fördelning: 100 kort för 4, 150 för 6 och 200 för 8 deltagare. Duellen behåller 50 kort. |
| 12B – spelat kort vid avhopp | Om ägaren lämnar under en ännu inte avgjord strid tas även det spelade kortet bort direkt. Dess styrka och kvarvarande effekt räknas inte längre. |
| 13A – måltavlan lämnar | Avsluta striden utan ytterligare skada eller resultateffekter, släng spelade kort och byt anfallande lag om matchen fortsätter. |
| 14A – försvarsspecialkort | Får användas både till eget försvar och som hjälp när en lagkamrats torn försvaras. |
| 15A – läkning | Vampyrbett läker kortets ägare vid lyckat anfall. Helande ljus läker kortets ägare vid lyckat försvar, även vid laghjälp. Högst tre liv, ingen återupplivning. |
| 16A – Törnesköld | Ägaren väljer en levande fiende som lagt ett attackkort i striden. Vid lyckat försvar förlorar den utvalda spelaren ett liv. |
| 17A – försvunnet effektmål | Inget nytt kortmål får väljas om målkortet tas bort. Måleffekten upphör; annan grundstyrka finns kvar. Spegelsköld återgår till försvar 1. |
| 18A – flera likadana effekter | Varje kvarvarande giltigt kort bidrar. Två Isrustningar sänker lagets attack med 4; två ostoppade Sprängladdningar sänker försvaret med 4. Två Törnesköldar kan ge två motstötar mot samma spelare. Styrkor och liv blir aldrig negativa. |
| 19A – Spegelsköld | Kopierar ett valt, ostoppat magiskt attackkort inklusive dess bonusar, före Isrustningens avdrag från lagets attack. Utan giltigt mål ger kortet försvar 1. |
| 20A – Drakeld | Varje ostoppad Drakeld får +2 om någon försvarare eller hjälpare har lagt ett vanligt blått försvarskort. Bonusen ges högst en gång per Drakeld, oavsett antalet blå kort. |
| 21A – turordning | Fast ordning inom laget, med nästa levande lagkamrat som målansvarig och första anfallare nästa gång laget anfaller. Måltavlan försvarar först, sedan lagkamrater i turordning. |
| 22A – påfyllning | Efter striden får endast levande spelare med helt tom hand fem nya kort, så långt korten räcker. Dela ut ett kort i taget runt bordet; blanda slänghögen när draghögen tar slut. |
| 23A – enkel attack | Valfritt kort får användas som vanlig attack 1 utan sin specialeffekt, även i lagspel. |
| 24B – alla anfallskort försvinner | Om alla lagda anfallskort försvinner genom avhopp men båda lagen och måltavlan finns kvar räknas försvaret som lyckat. Försvarets läkning och eventuella giltiga motstötar genomförs. |
| 25A – värden lämnar före start | Den längst anslutna kvarvarande deltagaren blir värd. Alla bekräftar Redo igen; ett tomt rum stängs. |
| 26B – personligt anslutningsavbrott | Övriga fortsätter så länge de kan agera. Vänta när den frånkopplade behöver göra ett val; ingen global paus enbart på grund av frånkoppling. Återanslutningsgränserna 30/90 sekunder gäller fortfarande. |
| 27B – oväntad serveromstart | Pågående matcher avbryts utan vinnare. Spelarna får starta en ny match. Ingen individuell förlust eller förbrukad avbrottsbudget på grund av serverfelet. |

**Konsekvens av 8A:** matchen avslutas inte automatiskt för att en deltagare lämnar. Det andra laget vinner när det lämnande laget saknar kvarvarande spelare. I en duell innebär detta fortfarande direkt vinst för motståndaren. Lagen balanseras inte om efter start.

Värden administrerar rummet före start; värden bestämmer inte matchdata eller vinnare. Servern kontrollerar varje handling. Äldre dokument är regelunderlag, inte nya instruktioner eller beslut som ersätter svaren ovan.

## 2. Vad som kan återanvändas

| Del | Anpassning |
| --- | --- |
| `match.js` | Mönstren `newMatch`, `process`, privata spelarvyer, tillåtna handlingar och revisioner återanvänds. Hårdkodade A/B och `opponentOf` räcker inte för lagspel. |
| `strid.js` | Den befintliga beräkningen gäller ett anfallskort mot ett försvarskort. Lagstrid med flera kort och riktade effekter behöver en egen specificerad beräkning. |
| `matchregler.js` | Behåll `duell-v1` och dess 50-kortslek för nuvarande duell. Inför separat regel- och kortleksversion för lagspel. |
| `matchvy.js` | Refaktorera till privat spelarvy i stället för direkt åtkomst till hela matchen. Visa eget torn och egen hand nederst, lagkamrater bredvid och fiendelaget ovanför. |
| Kortdialog, animationer och ljud | Behåll långtryck och befintliga ljud. Knyt dem till serverbekräftade händelser och spelarens lag/identitet. |
| Utvecklingspanelen | Motståndarens och lagkamraternas dolda händer får inte skickas till klienten. Att bara dölja knappar är otillräckligt. |
| `server.js` | Är en lokal statisk server. Lägg till separat onlineserver; nuvarande filserver är inte en matchserver. |
| `deploy.sh` | Behåll versionsstämplingen och den uttryckliga klientfillistan. Databas, sessioner och serverhemligheter ska ligga utanför webbrot. |

En match med två deltagare ska behålla nuvarande duellregler. Matcherna med 4, 6 och 8 deltagare använder lagregler. Befintligt lokalt datorläge ska fortsätta fungera och ingår i regressionstesterna.

## 3. Spelarflöde och skiss

```text
Startsida -> Spela online -> Ange nick -> Gemensam lobby
  -> Skapa rum och markera namn att bjuda in
  -> Inbjudna accepterar och ansluter till samma rum
  -> Varje deltagare väljer lag och trycker Redo
  -> Värden trycker Starta
  -> Servern kontrollerar 2/4/6/8 deltagare, lika stora lag och allas redo
  -> Deltagarlistan låses och öppna inbjudningar stängs
  -> Kortbyte -> startmeddelande -> strider -> matchresultat
  -> Till lobbyn
```

```text
TORNSTRIDEN · LOBBY                   Ansluten
Ditt nick: Landy                      [Ändra nick]

Spelare online
[x] Mira            Ledig
[x] Alex            Ledig
[ ] Sam             Ledig
[–] Kim             Spelar
[Bjud in till mitt rum (2)]

INKOMMANDE: Sam bjuder in dig till sitt rum
[Acceptera] [Avböj]

RUMSVY SENARE, EFTER ATT INBJUDNINGARNA ACCEPTERATS
Landy är värd · 4 av högst 8 deltagare
Lag Sol                 Lag Måne
Landy  Redo             Alex  Redo
Mira   Redo             Sam   Inte redo
[Välj Lag Sol] [Välj Lag Måne] [Redo / Inte redo]

Väntar på Sam. Lagen är lika stora: 2 mot 2.
[Starta matchen – endast värden, aktiveras när alla är redo]
[Lämna rummet]
```

Spelaren kan tillhöra högst ett förberedelserum eller en aktiv match. Att skapa ett eget rum reserverar värdens egen plats, men en obesvarad inbjudan reserverar aldrig mottagaren. För att acceptera ett annat rum lämnar man först det nuvarande, utan förlust före matchstart.

| Situation | Återkoppling |
| --- | --- |
| Ingen annan i lobbyn | ”Du är först här. Vänta på fler spelare.” |
| Inbjudan väntar | Visa mottagare, giltighetstid och Återkalla. Mottagaren kan fortfarande välja ett annat rum. |
| Avböjd eller utgången | Visa besked utan automatisk återinbjudan. Andra inbjudningar till samma rum fortsätter gälla. |
| Rummet fylls eller hinner starta | Ett sent accepterande avvisas med ”Rummet är fullt” eller ”Matchen har startat”. |
| Udda deltagarantal | ”Vi är 5. Matchen kan starta med 2, 4, 6 eller 8 spelare.” |
| Ojämna lag | Visa antal per lag och förklara att någon behöver byta lag. Ingen automatisk flytt. |
| Alla redo men värden väntar | ”Alla är redo. Väntar på att värden startar.” |
| Ny deltagare eller ändrat lag | Uppdatera laguppställningen och begär ny redo-bekräftelse. |
| Tappad anslutning i lobbyn | ”Återansluter …” Inaktivera inbjudningar tills aktuell lista har hämtats. |

På mobil staplas sektionerna. Namnmarkering, lagval och knappar ska fungera med tangentbord. Listuppdateringar behåller fokus. Färg kompletteras alltid med text. En markering som blivit ogiltig tas bort med ett begripligt besked.

## 4. Spelserver och datamodell

```text
2–8 webbläsare, var och en med egen privat spelarvy
                         |
              HTTPS / säker WebSocket
                         |
                Befintlig Apache
           statiska filer + nätverksproxy
                         |
               En Node-spelserver
       sessioner / rum / matchkö / regelmotor
                         |
              Beständig lokal lagring
```

Förslag: ett etablerat WebSocket-bibliotek och en serverinstans med lokal transaktionsdatabas, exempelvis SQLite. Versioner och driftstöd väljs vid implementation. Se [MDN om WebSocket-servrar](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_servers) och [Apache om WebSocket-proxy](https://httpd.apache.org/docs/2.4/mod/mod_proxy_wstunnel.html).

```text
Session:
  internt spelar-ID, nick, normaliserat nick
  hash av hemlig sessionstoken och giltighetstid
  aktivitet = LEDIG | I_RUM | SPELAR | FÖLJER_AVSLUT
  anslutning = ANSLUTEN | FRÅNKOPPLAD
  aktuellt rum/match, anslutningsgeneration och senaste kontakt

Inbjudan:
  ID, roomId, avsändare, mottagare, utgångstid
  status = VÄNTAR | ACCEPTERAD | AVBÖJD | UTGÅNGEN | ÅTERKALLAD

Rum:
  ID, hostPlayerId, högst 8 deltagare
  deltagare[] med spelar-ID, valt teamId eller inget lag, anslutning, redo
  rosterVersion för ändringar i deltagare/lag
  roomRevision för alla rumsuppdateringar
  status = FÖRBEREDELSE | STARTAD | STÄNGD

Match:
  ID, revision, rulesVersion, deckVersion
  players[] med ID, teamId, liv, privat hand, LEVANDE/UTSLAGEN och utslagsorsak
  teams[] med ID och fast turordning
  komplett kortbokföring och draghög (endast servern)
  fas, attackTeamId, targetPlayerId, aktiva val och spelade kort[]
  fortsätt-bekräftelser och tidsgränser för berörda spelare
  återanslutningsdeadline och förbrukad budget per spelare
  winnerTeamId eller inget vinnande lag, samt slutorsak
  senaste händelse-ID och anslutnings-/pausstatus

Behandlat kommando:
  unik nyckel (session, rum/match, commandId)
  fingeravtryck av innehåll, sparad kvittens och revision/händelse-ID
```

Lagra matchändring, nya händelser och kommandokvittens i samma transaktion. Kvittera godkänt först efter lyckad lagring. Spara inte hemliga sessionstoken i lobbylistor, URL:er eller loggar. Ingen klient får hela matchobjektet.

## 5. Etapp 1 – nick och session

Nick utan konto är beslutat. Förslag: 2–20 synliga tecken, trimma blanksteg, avvisa kontrolltecken och reservera unika aktiva nick utan skillnad mellan stora/små bokstäver. Återanslutning använder sessionen och behåller nicket. Nickbyte tillåts bara utanför rum och match.

```text
gåOnline(nick):
  om giltig session redan finns:
    återuppta sessionen och eventuell match innan ny nickreservation prövas
  annars:
    validera nick och skapa slumpad gästsession
    reservera nick atomärt och spara sessionen
  öppna anslutning och skicka aktuell lobby/rum/matchvy
```

Sessionen lagras i en säker HttpOnly-cookie med lämplig SameSite-inställning. Servern kontrollerar Origin, session och behörighet. Visa nick som text eller HTML-escapa dem överallt, särskilt i befintliga mallar med `nameOf(...)`.

Tillåt en aktiv styrande anslutning per session. En extra flik visar ”Spelet är öppet i en annan flik”. Vid riktig återanslutning byts anslutningsgenerationen atomärt; ett sent close från den gamla anslutningen får inte fälla den nya.

**Klart när:** separata webbläsarsessioner kan ansluta med olika nick, återkomma med samma identitet och inte ta över en annans plats genom att ange samma namn.

## 6. Etapp 2 – inbjudningsrum, lagval och start

### Skapa rum och bjuda in

Värden ingår själv i rummet. Övriga accepteras individuellt till samma roomId, oavsett vilket lag de senare väljer. Öppna inbjudningar ska inte låsa mottagarna eller stängas när den första accepterar.

```text
skapaRum(session, commandId):
  kräv att spelaren är ledig
  skapa rum och lägg in värden utan valt lag och med redo = falskt
  reservera bara värdens eget medlemskap

bjudIn(session, roomId, mottagarlista, commandId):
  kräv värdbehörighet, öppet rum och aktuell anslutning
  deduplicera namn/ID och kommandot; begränsa anropsfrekvens
  för varje mottagare:
    kontrollera ledig, ansluten, inte värden och inte redan inbjuden
    skapa inbjudan kopplad till samma roomId
  meddela mottagarna; kvittera fel per ogiltig mottagare
```

Förslag: högst så många öppna inbjudningar som ryms tillsammans med redan anslutna deltagare, totalt högst åtta inklusive värden. Inbjudan gäller exempelvis 30 sekunder. Gränser mot spam och en väntetid efter avböjande behövs. Ett avböjande eller återkallande påverkar bara en ännu obesvarad inbjudan.

```text
acceptera(session, invitationId, commandId):
  atomär transaktion för medlemskap och rum:
    kontrollera rätt mottagare, giltighetstid och öppet rum
    kräv att spelaren inte redan tillhör ett annat rum/aktiv match
    kräv färre än 8 deltagare
    lägg till spelaren i det inbjudna rummet, utan lag och med redo = falskt
    markera just denna inbjudan ACCEPTERAD
    stäng spelarens inbjudningar till andra rum
    behåll övriga mottagares inbjudningar till detta rum
    öka rosterVersion; nollställ allas redo
  skicka uppdaterat rum till alla deltagare

väljLag(session, teamId):
  kräv medlemskap, förberedelserum och tillåtet lag
  tillåt högst 4 deltagare per lag; tillfälligt ojämna lag är tillåtna i rummet
  vid faktisk ändring: byt eget lag, öka rosterVersion, nollställ allas redo

redo(session, rosterVersion):
  kräv egen anslutning, valt lag och samma laguppställning som på skärmen
  markera bara avsändaren redo för denna rosterVersion
  starta inte matchen automatiskt

starta(session, roomId, rosterVersion, commandId):
  atomär rums-/matchtransaktion:
    kräv att avsändaren är nuvarande värd och att rummet inte redan startat
    kräv aktuell rosterVersion
    kräv deltagarantal i {2, 4, 6, 8}
    kräv valt lag för alla och lika många i varje lag
    kräv att samtliga deltagare är anslutna och redo för denna uppställning
    skapa match med servervald slump, deltagare och låsta lag
    välj duellregler för 2, godkänd lagregelversion för 4/6/8
    stäng återstående obesvarade inbjudningar
    spara STARTAD och matchen tillsammans
  skicka individuell matchvy till varje deltagare
```

Redo-status kan tas tillbaka före start. Lag och deltagarlista låses vid start; ingen ansluter som ny spelare mitt i matchen. En sen acceptans och ett startkommando får inte båda använda samma platslista: serverns transaktion avgör vilken händelse som skedde först, och värden får vid behov bekräfta den nya uppställningen.

### Om någon lämnar före start

Ingen förlust utdelas före matchstart. Ta bort deltagaren, uppdatera rosterVersion och nollställ redo. **Beslutat 25A:** om värden lämnar övertar den längst anslutna kvarvarande deltagaren värdrollen; visa vem som blev värd och begär ny Redo-bekräftelse från alla. Använd medlemskapets anslutningsordning i rummet, inte senaste nätåteranslutning, för att välja efterträdaren. Stäng tomma rum. Ett längre inaktivt förberedelserum kan stängas utan förlust; exakt städtid väljs vid implementation. Nätavbrott i förberedelserummet är inte samma sak som tidsförlust i en startad match.

**Klart när:** 2/4/6/8 personer kan ansluta, själva välja jämna lag och bli startade av värden. Udda antal, ojämna lag, saknat lag eller någon som inte är redo blockerar start med tydlig förklaring.

## 7. Etapp 3 – regelmotor för lagspel

### Omfattning och kvarvarande preciseringar

Beslut 6A och 10A fastställer lagformatet och det gemensamma anfalls-/försvarsflödet. Nedan konkretiseras detta. Startvärden återanvänder duellens grundupplägg. Turordning, påfyllning och enkel attack är fastställda genom 21A–23A; 24B gäller när alla anfallskort försvinner genom avhopp. Specialkortens lageffekter preciseras av besluten 14A–20A nedan; övriga grundvärden hämtas från dagens kortregler.

- Ett torn per spelare, tre liv, tio startkort och två startbyten med högst två kort per omgång.
- **21A:** lagen växlar anfallsroll. En fast turordning inom laget avgör vem som väljer målet och börjar anfallet; nästa gång samma lag anfaller börjar nästa levande lagkamrat. Utslagna hoppas över utan att ordningen mellan övriga ändras.
- Anfallet riktas mot en levande spelare i fiendelaget. Varje levande anfallare spelar högst ett kort eller avstår i turordning; laget måste bidra med minst ett kort om det har kort.
- **23A:** valfritt handkort kan spelas som enkel attack med styrka 1, utan specialeffekt eller magisk egenskap. Användningen väljs med kortet och kan inte ändras efter godkänt drag. Ett lag med kort kan alltså alltid anfalla.
- Måltavlan försvarar först; levande lagkamrater kan därefter hjälpa till i turordning med högst ett kort var, eller avstå.
- Jämför sammanlagd attack och försvar efter tillåtna effekter. En genomsläppt attack kostar måltavlan ett liv. Matchens vinst avgörs på lagnivå.
- **22A:** släng spelade kort och fyll endast levande spelares helt tomma händer med fem kort, eller så många som finns tillgängliga. En hand med ett till fyra kort fylls inte på. Dela ut ett kort i taget runt bordet och blanda slänghögen när draghögen tar slut. Byt anfallande lag. Händer hålls hemliga även för lagkamrater.

```text
startaLagstrid(match):
  kontrollera först om något lag saknar levande spelare
  välj nästa levande startspelare i anfallande laget
  om laget saknar handkort efter påfyllning: använd skyddsregeln nedan
  annars kan varje kort användas som enkel attack enligt 23A
  be startspelaren välja ett levande fiendetorn
  bygg anfallskö av levande lagkamrater
  låt en spelare i taget lägga kort eller avstå
  lås anfallet när kön är klar
  bygg försvarskö: måltavlan först, sedan levande lagkamrater
  låt en spelare i taget försvara eller avstå
  beräkna lagstriden enligt beslutad effektordning
  släng spelade kort och registrera utslagna
  kontrollera vinnande lag
  annars: fyll tomma händer en gång enligt 22A
          visa resultat och invänta kvarvarande spelares Fortsätt
```

### Turordning och påfyllning

Spara lagens fasta ordning samt nästa startspelare per lag. Måltavlan står först i försvarskön, därefter följer övriga levande lagkamrater i den fasta ordningen. **Tekniskt arbetsförslag:** använd den visade platsordningen vid matchstart som fast ordning och visa turmarkeringen för alla. Vid utdelning växlar platserna mellan lagen; börja på nästa anfallande lags startplats och hoppa över dem som inte ska få kort.

```text
fyllTommaHänderEfterStrid(match, stridId):
  om matchen är slut eller påfyllningen redan sparats för stridId: returnera
  mottagare = levande spelare med exakt noll handkort före påfyllningen
  ordna mottagarna enligt bordets utdelningsordning
  upprepa högst fem varv:
    för varje mottagare:
      om draghögen är tom: blanda tillgänglig slänghög till ny draghög
      om inga kort finns i någon av högarna: avsluta utdelningen
      flytta ett kort till mottagarens hand
  spara kortbokföring och att denna påfyllning är genomförd
```

Kort på bordet, i andra händer eller undanlagda för pågående startbyte får inte blandas in. Det är den ursprungliga mottagarlistan som får upp till fem kort; en mottagare tas inte bort när det första kortet kommit. Ett upprepat Fortsätt eller en återanslutning ger ingen ny påfyllning.

**Teknisk skyddsregel, arbetsförslag:** om ett helt lag ändå saknar handkort efter påfyllning går turen till det andra laget. Om båda saknar kort och ingen hög kan fyllas på ska servern hantera detta som ett fel i kortbokföringen och pausa matchen för återhämtning, utan att ge en vinnare eller växla tur i en oändlig loop. Detta är inget automatiskt kortbyte för spelare som har kvar försvarskort; de kan använda enkel attack.

### Beslutad kortfördelning – egen version för varje matchstorlek

Nuvarande 50-kortslek räcker inte till större matcher med dagens utdelning. Minsta antal före start är `antalSpelare × (10 + 2 × 2)` när bortbytta kort ligger undan under båda omgångarna: **56 för fyra, 84 för sex och 112 för åtta**. Detta är bara ett minimikrav, inte en balanserad kortlek.

**Beslut 11A:** använd samma 30 korttyper och proportioner som dagens duell. De 20 korttyperna utan `ability` (inklusive vanliga magikort) har dubbelt så många exemplar som var och en av de tio specialkortstyperna.

| Deltagare | Varje vanlig korttyp (20 typer) | Varje specialkortstyp (10 typer) | Totalt | Minsta behov för start/byten |
| --- | ---: | ---: | ---: | ---: |
| 2 | 2 | 1 | 50 | 28 |
| 4 | 4 | 2 | 100 | 56 |
| 6 | 6 | 3 | 150 | 84 |
| 8 | 8 | 4 | 200 | 112 |

```text
byggKortlek(antalSpelare):
  kräv antal i {2, 4, 6, 8}
  faktor = antalSpelare / 2
  använd en låst kopia av duellens nuvarande fördelningslista
  multiplicera varje korttyps exemplarantal med faktor
  skapa unika exemplar och blanda på servern
```

Fördelningslistan låses och versionsmärks; framtida katalogtillägg får inte automatiskt ändra lagleken. Lekens storlek bestäms vid matchstart och krymper inte när någon slås ut. Beslutet fastställer första fördelningen, inte att balansen redan är provad. Påfyllning följer 22A; föreslagen utdelningsordning och skydd mot tomma övergångsloopar beskrivs ovan.

### Beslutade specialkortsregler för lagspel

| Område | Regel |
| --- | --- |
| Försvarsspecialkort (14A) | Alla sådana kort får spelas både för det egna tornet och som laghjälp. Villkorstexter som i dag säger ”när ditt eget torn blir attackerat” behöver en lagversion. |
| Vampyrbett (15A) | Ett kvarvarande, ostoppat Vampyrbett läker sin ägare ett liv om laganfallet lyckas. Ett stoppat eller borttaget kort ger ingen läkning. |
| Helande ljus (15A) | Vid lyckat försvar läks kortets ägare ett liv, även om en annan spelare var stridens måltavla. |
| Läkningens gränser (15A) | Högst tre liv och ingen återupplivning av utslagen spelare. Avbruten strid enligt 13A ger ingen läkning. |
| Törnesköld (16A) | Ägaren väljer en levande fiende som lagt ett attackkort i den aktuella striden. Målet väljs med kortet och sparas som spelar-ID. Lyckat försvar ger ett livs motstöt till detta mål. |
| Kortmål som försvinner (17A) | Målet binds till kortets unika exemplar. Försvinner exemplaret upphör måleffekten utan omval. Övrig grundstyrka ligger kvar; Spegelsköld återgår till 1. |
| Summering (18A) | Räkna varje kvarvarande giltig effekt en gång. Isrustning och Sprängladdning ger avdrag från respektive lags total; Törnesköld ger en motstöt per kort även när flera har samma spelarmål. |
| Spegelsköld (19A) | Ersätt kortets grundförsvar med det valda magiska attackkortets styrka inklusive bonusar, före lagets frost-avdrag. Lägg inte till grundförsvaret 1 ovanpå kopian. Om målet saknas eller är stoppat används i stället försvar 1, utan omval. |
| Drakeld (20A) | +2 per kvarvarande ostoppad Drakeld när minst ett kvarvarande blått försvarskort finns på försvarssidan, även hos en hjälpare. Flera blå kort ger inte ytterligare bonus. |

Ett spelar-ID och ett kortexemplar-ID är olika slags mål. Törnesköld pekar på en spelare, medan exempelvis Barriär pekar på ett attackkort. Om Törneskölds valda spelare har lämnat är personen redan utslagen; ingen skada flyttas till en annan fiende. Ägaren får inte använda avhoppet för ett nytt målval.

```text
spelaFörsvarsspecial(session, cardId, targetId):
  kräv levande deltagare, rätt försvarsfas och eget kort
  tillåt spelaren som försvarare även när måltavlan är en lagkamrat
  om Törnesköld:
    kräv levande fiende som lagt ett attackkort i denna strid
    bind effekten till fiendens spelar-ID
  om kortet kräver ett kortmål:
    validera enligt kortets regel och bind till exemplarets ID
  spara kortet och målvalet; utför inte resultateffekter ännu

vid slutligt resultat:
  lyckat anfall -> läkning för ägarna till giltiga ostoppade Vampyrbett
  lyckat försvar -> läkning för ägarna till kvarvarande Helande ljus
                       och motstöt från kvarvarande Törnesköldar
  begränsa läkning till tre liv och uteslut redan utslagna
  om striden avbrutits enligt 13A: inga resultateffekter
```

**Exempel:** Mira hjälper Alex med Helande ljus. Försvaret lyckas och Mira har två liv: Mira går till tre, Alex läks inte av hennes kort. En Isrustning som Mira spelar bidrar med försvar 2 och sänker det anfallande lagets sammanlagda attack med 2.

### Effektordning för lagstrid

Följande ordning konkretiserar besluten 12B–24B och dagens grundvärden. Den gäller lagmatcher med 4/6/8 deltagare; tvåspelarläget behåller `duell-v1` och sin befintliga beräkning. Laglägets Spegelsköld läser uttryckligen styrkan före lagets frost-avdrag.

1. **Utgå från kvarvarande kort.** Hantera redan godkända avhopp först. Saknas måltavlan gäller 13A; en avbruten strid får inga resultateffekter. Spara varje ägares liv vid stridens början för kortens sista-livet-bonusar. Normalisera enkel attack till vanlig attack 1 utan specialeffekter innan stopp och bonusar beräknas; kortets ursprungliga magityp ska inte kunna speglas eller förseglas i denna användning.
2. **Beräkna stopp.** Magisk barriär stoppar sitt valda attackkort. Försegling stoppar sitt valda magiska attackkort. Ett stoppat kort bidrar varken med attack, bonus, försvarsavdrag eller läkning. Försegling behåller försvar 2; Barriär ger försvar 0. Försvunna mål ger inget omval. Räkna om stoppen från kvarvarande kort varje gång någon lämnar.
3. **Beräkna varje ostoppat attackkort före frost.** Grundattack plus eventuell bonus: Sista anfallet får +3 om dess ägare hade ett liv vid stridens början. Varje Drakeld får +2 om minst ett kvarvarande försvarskort har `type === 'defence'`. Detta motsvarar dagens blå försvarskategori, inklusive blå specialkort som Törnesköld; magi och hybridkort utlöser inte bonusen.
4. **Beräkna varje försvarskort.** Grundförsvar plus Sista bastionens +4 om ägaren hade ett liv vid stridens början, även vid laghjälp. Spegelsköld använder sitt valda, kvarvarande och ostoppade magiska attackkorts värde från steg 3, annars 1. Kopiering förbrukar inte målkortet; flera Spegelsköldar kan kopiera samma giltiga kort, var och en en gång.
5. **Summera och sänk lagens styrkor.** Attack = summan från steg 3 minus 2 per Isrustning. Försvar = summan från steg 4 minus 2 per ostoppad Sprängladdning. Begränsa båda totalerna till lägst 0. Avdragen görs från totalerna, inte separat från varje kort. En Sprängladdnings effekt finns kvar även om frost sänker attacktotalen till 0; frost är inget stoppkort.
6. **Avgör striden en gång.** Försvaret håller om försvar är större än eller lika med attack. Enligt 24B gäller detta även när alla lagda anfallskort har försvunnit genom avhopp: attacken är då 0 och försvaret lyckas, även vid försvar 0. Matchslut och måltavlans avhopp enligt 13A prövas alltid först. Om attacken överstiger försvaret träffas det valda tornet och förlorar exakt ett liv, oavsett antalet anfallskort eller attackens överskott.
7. **Samla resultateffekterna.** Vid träff läker varje giltigt Vampyrbett sin ägare ett liv. Vid lyckat försvar läker varje Helande ljus sin ägare och varje Törnesköld skadar sitt valda levande spelarmål ett liv. Törneskölds mål måste ha lagt ett attackkort; kortet behöver inte vara ostoppat. Summera motstötar mot samma spelare innan utslagning prövas.
8. **Spara resultatet gemensamt.** Tillämpa livsförändringarna en gång, med liv inom 0–3 och utan återupplivning. Registrera samtliga utslagna innan lagets vinst prövas. Släng stridens kort exakt en gång och gå till resultat/Fortsätt om matchen fortsätter. En utslagning som orsakas av detta resultat ändrar inte stridens redan beräknade styrkor.

Barriärens mål måste vara ett attackkort som inte redan stoppats. Försegling väljer ett ostoppat magiskt attackkort när ett sådant finns; annars bidrar den bara med försvar 2. Spegelsköld väljer ett ostoppat magiskt attackkort när ett sådant finns; annars används grundförsvaret 1. Målval binds när kortet spelas. Om en senare Försegling eller Barriär stoppar Spegelskölds mål återgår speglingen till 1. Om stoppkortet därefter tas bort återberäknas samma bundna mål; inget nytt mål väljs.

```text
beräknaLagstrid(strid):
  kräv färdig anfalls- och försvarskö samt levande måltavla
  kräv att båda lagen fortfarande har levande spelare
  tillåt tom lista av anfallskort efter avhopp enligt 24B
  normalisera enkel attack till vanlig attack 1 utan specialeffekt
  använd kvarvarande bordskort och sparade startliv; ändra inte originalkorten
  stoppade = beräknaGiltigaStopp(kvarvarande försvarskort)
  aktivaAnfall = kvarvarande attackkort utan stoppade kort
  blåttFörsvarFinns = något kvarvarande försvarskort har typ defence

  för varje kort i aktivaAnfall:
    attackFöreFrost[kort.id] = kortets grundattack
    lägg till sista-livet-bonus utifrån ägarens startliv
    lägg till Drakelds +2 om blåttFörsvarFinns

  för varje kvarvarande försvarskort:
    försvar[kort.id] = grundförsvar plus eventuell sista-livet-bonus
    om Spegelsköld:
      giltigtMål = bundet kort finns i aktivaAnfall och är magiskt
      försvar[kort.id] = giltigtMål ? attackFöreFrost[mål.id] : 1

  attack = max(0, summa(attackFöreFrost) - 2 * antalIsrustningar)
  försvar = max(0, summa(försvar) - 2 * antalAktivaSprängladdningar)
  försvarHöll = försvar >= attack  // även 0 mot 0 efter avhopp enligt 24B
  livsändringar = noll per kvarvarande levande spelare
  om försvarHöll:
    samla ägarnas läkning och valda spelares motstötsskador, en gång per kort
  annars:
    livsändringar[måltavla] -= 1
    samla läkning för ägarna till aktiva Vampyrbett
  returnera styrkor, utfall, livsändringar och förklarande händelser

avgörOchSparaStrid(strid):
  kräv att denna strid inte redan avgjorts eller avbrutits
  beräkna resultat från en sammanhängande serverversion
  tillämpa livsändringar, begränsa liv till 0–3 och registrera alla utslagna
  pröva lagvinst och spara resultat, kortbokföring och händelser atomärt
```

Under kortval används samma styrkeberäkning som förhandsvisning, utan att ändra liv eller markera striden avgjord. Visa vilka bonusar, stopp och avdrag som ligger bakom totalerna. Borttagna kort kan även ta bort Drakelds bonus eller göra ett tidigare stoppat kort aktivt igen.

### Räkneexempel att använda i regeltester

Alla kort nedan spelas av olika deltagare, högst ett kort per person. Exemplen ryms i 2 mot 2, utom speglingsexemplet som använder 3 mot 3 med en anfallare som avstår.

| Kombination | Beräkning och resultat |
| --- | --- |
| Två Stormning mot två Isrustningar | Attack `3 + 3 − 2 − 2 = 2`. Försvar `2 + 2 = 4`. Försvaret håller. |
| Drakeld + Stormning mot Spegelsköld + Isrustning + Palissad | Palissaden ger Drakeld bonus: `4 + 2 = 6`. Spegelsköld väljer Drakeld och kopierar **6**, före frost. Attack `6 + 3 − 2 = 7`; försvar `6 + 2 + 1 = 9`. Försvaret håller. |
| Två Sprängladdningar mot två Sköldmurar | Attack `3 + 3 = 6`. Försvar `3 + 3 − 2 − 2 = 2`. Måltavlan förlorar ett liv. |
| Stormning + Armborst mot två Törnesköldar | Attack `3 + 2 = 5`; försvar `3 + 3 = 6`. Båda sköldarna har valt Stormnings ägare, som har två liv. Försvaret håller, två motstötar ger `2 − 2 = 0` och personen slås ut. Lagkamraten tar ingen motstöt. |
| Vampyrbett + Katapult mot Barriär + Tornvakt | Barriären stoppar Vampyrbett. Attack `0 + 5 = 5`; försvar `0 + 2 = 2`. Måltavlan förlorar ett liv, men Vampyrbetts ägare läks inte trots lagets träff. |
| Drakeld + Armborst mot två Sköldmurar | Attack `(4 + 2) + 2 = 8`; försvar `3 + 3 = 6`. Två blå kort ger fortfarande bara +2 till Drakeld. |
| Spegelskölds valda magiska kort tas bort | Kopian upphör och Spegelsköld ger 1. Ett annat magiskt kort får inte väljas i efterhand. Övriga kvarvarande bidrag räknas om. |
| Avdrag eller motstöt överstiger värdet | Två Isrustningar mot attack 3 ger `max(0, 3 − 4) = 0`. Två motstötar mot en spelare med ett liv ger 0 liv, aldrig −1. |

### När alla anfallskort har försvunnit – 24B

Ingen ny måltavla utses och de borttagna korten ersätts inte. Kvarvarande val slutförs enligt den vanliga turordningen; om anfallskön ännu är öppen kan de som inte agerat fortfarande lägga sitt eget kort. Finns inga anfallskort kvar vid avgörandet blir attacken 0 och försvaret räknas som lyckat. Kvarvarande Helande ljus läker sin ägare. Bara fortfarande giltiga motstötar kan skada någon; ett mål som lämnat får inte ersättas av en annan spelare. Därefter slängs bordskorten, tomma händer fylls och lagen växlar anfallsroll som efter en vanlig strid.

**Exempel:** Alex är ensam om att ha lagt ett anfallskort; lagkamraten Sam avstod. Mira har försvarat med Helande ljus och har två liv. Alex lämnar före avgörandet. Sam finns kvar, så matchen fortsätter. Attacken blir 0 och Mira läks till tre liv. En Törnesköld riktad mot Alex skadar däremot ingen annan: Alex är redan utslagen. Om Mira i stället var måltavlan och lämnade gäller 13A, alltså avbruten strid utan läkning.

### Återstående arbetsförslag

Valen 1–27 behöver inte frågas igen. Kvar finns tekniska arbetsförslag om plats-/utdelningsordning och skydd vid felaktig kortbokföring, samt städning av förberedelserum och drift i senare avsnitt. Värdbyte och hanteringen av personliga avbrott respektive serveromstart är beslutade genom 25A–27B. Balansen behöver provspelas; den valda kortfördelningen och summeringen kan ge starka kombinationer.

**Klart när:** rena tester utan webbläsare kan köra hela lagmatcher, kontrollera kortbokföring och avgöra vinster med ojämnt antal kvarvarande spelare. Detaljer ovan som ännu är förslag ska beslutas innan den motsvarande regeln kodas.

## 8. Etapp 4 – gemensam match och privata vyer

```text
klientens kommando:
  protocolVersion, matchId, revision, commandId
  typ och endast tillåtna val: kortexemplar, användning, eventuell måltavla

servern:
  validera format, storlek, Origin, session och anslutningsgeneration
  identifiera spelar-ID och teamId genom medlemskapet, inte klientens påstående
  i matchens seriella kö + databastransaktion:
    vid känt commandId: kontrollera samma innehåll och returnera kvittensen
    kräv rätt fas, rätt revision och att spelaren fortfarande får agera
    kontrollera mottagningstid mot aktuell tidsgräns
    kör rätt versions regelmotor på validerade fält och serverns slump
    vid avvisning: ändra inte matchen, ge begriplig orsak och aktuell privat vy
    vid internt fel: pausa/avbryt utan att tilldela felaktig seger
    vid godkänt: spara ändring, händelser och kvittens atomärt
  skicka separat till varje behörig mottagare:
    egen hand, offentliga torn/kortantal, lag, bord och tillåtna egna val
```

Skicka aldrig det fullständiga motorsvaret eller hemliga kort genom loggar/fel. Tillåtna handlingar ska beräknas på servern. Klienten får inte välja spelaridentitet, lag efter start, liv, vinnare eller draghögens ordning.

Refaktorera matchvyn till ett gemensamt kontrakt: `LokalMatch` kör befintlig motor lokalt; `OnlineMatch` skickar kommandon och tar emot privat vy. Egen identitet är fast hela matchen och är inte samma sak som den spelare vars tur det är. Stäng lokal datorstyrning i onlineläget.

### När ett drag väntar eller svaret försvinner

| Läge | Vad spelaren ser |
| --- | --- |
| Drag skickat | ”Skickar ditt drag …” Bekräfta är spärrat, men det går att läsa kort. Kortet är väntande tills servern har godkänt. |
| Godkänt | Uppdatera från servervyn och spela händelsens ljud/animation en gång. |
| Avvisat | Visa orsaken och låt spelaren välja på nytt från aktuell vy. |
| Kvittensen dröjer | ”Kontrollerar om draget registrerades …” Använd samma commandId. |
| Egen anslutning försvinner | ”Återansluter …” Inga nya drag innan aktuell vy hämtats. |
| Någon annan försvinner | Visa nick, lag och återstående återanslutningstid. Låt övriga göra tillåtna val; visa ”Väntar på att [nick] återansluter” först när just den personens val behövs. |
| Servern har startat om | ”Matchen avbröts på grund av ett serveravbrott. Ingen vann.” Visa Till lobbyn för att kunna ordna en ny match. |
| En deltagare slås ut | Visa vem och varför; visa lagets matchvinst endast om matchen verkligen avslutats. |

```text
bekräftaVal:
  spara oföränderligt kommando med nytt commandId och skicka

om svar uteblir:
  fråga servern om samma commandId med begränsad återförsöksfrekvens
  registrerat -> kvittens + aktuell privat vy
  okänt -> skicka samma kommando igen om det fortfarande är giltigt
  utgånget/inaktuellt -> synkronisera och be om nytt val

vid återanslutning:
  byt anslutningsgeneration säkert
  hämta en sammanhängande privat vy med matchrevision, rumsrevision,
    händelsegräns och status för väntande kommando
  ersätt gamla data; spela inte upp äldre ljud/animationer
```

En gammal kvittens får aldrig skriva över en nyare vy. Bevara ID för väntande kommando över omladdning i samma flik, men betrakta den informationen som opålitlig på servern. Nick och resultattexter ska HTML-escapas eller renderas som text.

### Ljud, liv och matchslut

Skilj på egen livsförlust, egen utslagning, lagets vunna strid och lagets matchresultat. Om lagkamraten lämnar ska man inte höra att hela laget förlorat. En utslagen deltagare kan se ”Du är utslagen – laget spelar vidare”. Spela lagets slutljud endast när servern meddelar matchslut; gamla händelser vid återanslutning ska vara tysta. Granska befintliga `resultEffect`, fasta A/B-referenser och resultatrutans Ge upp-text.

**Klart när:** samtliga platser i en åttaspelarmatch får rätt hand och lagperspektiv, utan hemliga kort i nätverkssvaren. Separata matcher påverkar inte varandra.

## 9. Etapp 5 – start, turklocka och Fortsätt

Efter startbytena visas vilket lag och vilken spelare som börjar. Levande deltagare bekräftar startmeddelandet. Efter varje strid bekräftar alla kvarvarande levande deltagare Fortsätt. Utslagna personer får aldrig blockera start av nästa strid.

```text
fortsätt(session, battleId, resultRevision, commandId):
  kräv behörig levande deltagare och rätt resultat
  deduplicera och markera enbart den egna bekräftelsen
  meddela vilka som fortfarande behöver bekräfta
  om alla nu levande har bekräftat:
    kör nästa strid exakt en gång på servern
    nollställ bekräftelser och spara nya vyer
```

En frånkopplad spelare som redan bekräftat Fortsätt blockerar inte övergången enbart genom sin frånkoppling. Saknas personens bekräftelse väntar övergången på återanslutning eller utslagning; övriga kan fortfarande bekräfta. Samma princip gäller startmeddelandet.

Redo/Fortsätt är egna meddelanden; klienten får inte anropa ett generellt `ACTION.next` för att gå förbi andra. Medlems- och beredskapsändringar hanteras separat från spelrevisionen. En utslagning ska omedelbart ta bort kravet på den personens kvittens och pröva om väntan nu är klar.

**90 sekunder är beslutat.** Klockan går bara när servern kräver ett val av just den spelaren: kortbyte, målval, kortspel, avstående eller bekräftelse. Vanlig väntan på andra kostar ingen turtid. Starta inte om klockan när ett kort markeras, ett ogiltigt kommando skickas eller en ruta öppnas. Visa varning före utgången. Vid utgång slås personen ut enligt avsnitt 10; övriga spelar vidare.

Vid en gemensam Fortsätt-fas har de väntande spelarna varsin deadline. Samtidigt utgående tidsgränser avgörs tillsammans innan matchvinst prövas, så att timerordningen inte ger ett lag en slumpmässig seger.

## 10. Etapp 6 – utslagning, avbrott och återanslutning

### Gemensam utslagningsregel

Lämna, slut återanslutningstid och 90 sekunders inaktivitet ger individuell utslagning. Beslut 12B, 13A och 24B fastställer kortborttagning, hantering när måltavlan lämnar och lyckat försvar när alla anfallskort försvinner. Övriga fasdetaljer nedan är arbetsförslag tills de preciserats.

```text
slåUtSpelare(match, playerId, orsak):
  om redan utslagen eller matchen avslutad: returnera befintligt resultat
  markera UTSLAGEN och spara orsak; tillåt inga fler egna val
  släng återstående handkort enligt lagreglernas kortbokföring
  ta bort spelaren ur väntande turer, kvittenser och väntan på återanslutning
  hantera eventuella kort på bordet och förlorad måltavla enligt fasregeln
  pröva matchslut efter samtliga utslagningar i samma händelsegrupp:
    inga levande lag -> AVBRUTEN utan vinnare
    om ingen levande är ansluten och återanslutningsfrister återstår:
      avvakta segerprövning enligt avbrottspolicyn nedan
    annars exakt ett levande lag -> det laget vinner
    två levande lag -> fortsätt med kvarvarande spelare
  spara och meddela alla berörda
```

**Beslut och arbetsförslag för faserna:**

| När spelaren lämnar | Fortsättning och beslutsstatus |
| --- | --- |
| Under startbyte | Släng den utslagnes hand, ta bort personen från byteskön och fortsätt för övriga. |
| Innan eget kort eller mål är valt | Hoppa över personen. Nästa behöriga lagkamrat tar nästa nödvändiga val. |
| Efter ett godkänt bidrag på bordet | **Beslutat 12B:** ta bort kortet från striden direkt och lägg det i slänghögen en gång. Räkna om kvarvarande styrkor och effekter. Kortet får inte ersättas och ägaren förblir utslagen. |
| Måltavlan lämnar mitt i striden | **Beslutat 13A:** avbryt striden utan ytterligare skada eller resultateffekter, släng redan spelade kort och byt anfallande lag om matchen fortsätter. Ingen ny måltavla utses i samma strid. |
| Alla lagda anfallskort försvinner, men båda lagen och måltavlan finns kvar | **Beslutat 24B:** räkna ett slutligt tomt anfall som lyckat försvar, med läkning och giltiga motstötar. Inget omval av försvunna effektmål. |
| Under resultatrutan | Ta bort kvittenskravet och kontrollera om övriga redan är klara. |
| Sista levande spelaren i laget | Det andra laget vinner. I en duell motsvarar detta direkt vinst för motståndaren. |

**Prioritet vid avhopp:** kontrollera först om matchen avslutas genom utslagningen. Om den fortsätter och den utslagne var måltavla gäller 13A framför vanlig omräkning. Annars gäller 12B för ett eventuellt spelat kort, och 24B om inga anfallskort finns kvar vid avgörandet. Har striden redan avgjorts och sparats görs ingen retroaktiv ändring av dess resultat.

```text
vid avhopp i ännu öppen strid:
  slå ut spelaren och släng handkort
  flytta eventuellt eget bordskort till slänghögen en gång
  om ett lag nu saknar spelare: avsluta matchen
  annars om spelaren var måltavla:
    släng återstående bordskort; inga skade-, läknings- eller motstötseffekter
    markera striden AVBRUTEN och gå vidare med turväxling
  annars:
    räkna om bidrag från kvarvarande kort enligt effektreglerna
    ta bort ägarens väntande val och fortsätt den återstående kön
    om inget anfallskort finns kvar när köerna är klara:
      avgör som lyckat försvar enligt 24B, inklusive giltiga resultateffekter
```

**Beslutat genom 17A:** kortmål binds till unika exemplar. Försvinner målkortet upphör den riktade effekten och inget nytt mål väljs. Övrig grundstyrka finns kvar; Spegelsköld återgår till försvar 1. Om ett stoppkort självt tas bort genom 12B kan dess tidigare stoppade attackkort åter bidra vid omräkningen, förutsatt att det finns kvar och inte stoppas av något annat giltigt kort. Styrkor räknas om från kvarvarande kort, inte genom permanenta avdrag på originalkorten. Inga liv ändras under uppbyggnaden; resultateffekter utförs vid det slutliga serverbeslutet.

**Exempel:** två anfallskort med styrka 3 och 2 ger 5. Ägaren till trean lämnar före avgörandet: trean slängs och attacken blir 2. Om måltavlan i stället lämnar räknas striden inte som en vunnen attack; spelaren är utslagen, men ingen annan får skada, läkning eller motstöt från den avbrutna striden.

Kör inte dagens duell-`surrender` oförändrat för en lagmatch: den skulle avsluta hela matchen när bara en person lämnar. Den första seriellt godkända sluthändelsen gäller; senare meddelanden får inte ändra ett redan fastställt resultat.

Utslagna kan enligt arbetsförslag följa enbart offentlig matchinformation eller gå till lobbyn; inga extra händer avslöjas och de omfattas inte längre av matchens timers. De får inte återta sin plats. Om de går vidare till en ny match ska ett gammalt kommando inte påverka den nya. Allmän åskådaranslutning ingår inte.

### Vad servern faktiskt kan upptäcka

En stängd flik, ett nätavbrott och en avstängd telefon kan inte säkert särskiljas. `beforeunload` körs inte alltid, särskilt på mobil. Använd därför anslutningens livstecken, inte ett sista meddelande från fliken. Se [MDN om beforeunload](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event) och [MDN om WebSocket ping/pong](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_servers#pings_and_pongs_the_heartbeat_of_websockets).

Tekniskt förslag: ping ungefär var femte sekund och upptäckt tyst avbrott efter cirka 15 sekunder utan svar, justerat efter mobiltester. De 30 sekunderna räknas från upptäckt avbrott; det kan alltså ta cirka 15 + 30 sekunder från ett tyst nätfel till utslagning. Ett upptäckt stängt uttag startar fristen tidigare.

Skicka inte automatiskt Ge upp från `beforeunload`, `pagehide` eller flikbyte. Omladdning ska kunna återansluta. Flikbyte i sig är ingen förlust; om anslutningen faktiskt försvinner gäller avbrottsregeln.

### Budget och flera frånkopplade

Beslutat: högst 30 sekunder per avbrott och sammanlagt 90 sekunder per spelare och match. Mindre kvarvarande budget ger en kortare sista frist. Serveravbrott kostar ingen budget.

**Beslutat 26B:** fortsätt med övriga spelares tillåtna handlingar under ett personligt anslutningsavbrott. En turordning får inte hoppas över: när den frånkopplade spelarens val krävs väntar just det steget tills personen återkommer eller slås ut. Under gemensamma val, exempelvis startbyte eller Fortsätt, får anslutna spelare fortfarande lämna sina egna svar. Nästa fas väntar bara på de svar som faktiskt saknas.

Återanslutningsfristen börjar vid upptäckt avbrott, även om spelarens tur kommer senare. Den startas inte om när turen kommer. Varje frånkopplad har egen deadline och budget; en ny frånkoppling förlänger inte andras frister. Redan godkända kort och effekter ligger kvar medan personen har tid att återkomma. En frånkopplad spelare kan därför förlora liv eller slås ut genom ett giltigt stridsresultat medan andra spelar; ingen särskild immunitet ges av avbrottet.

**Timerhantering för 26B:** bevara den frånkopplades återstående vanliga turtid och låt återanslutningsfristen styra väntan under avbrottet. Övrigas aktiva turklockor fortsätter. Om ett nytt val blir aktuellt under frånkopplingen startar dess vanliga 90-sekundersklocka först vid giltig återkomst; återanslutningsfristen förlängs inte. Efter återkomst återupptas ett redan väntande val med den sparade tiden, aldrig nya 90 sekunder. Läsning av kort och uttryckligt Lämna är fortsatt tillåtna för anslutna deltagare.

```text
vid upptäckt avbrott(playerId, generation):
  ignorera gammal generation och redan utslagen spelare
  om redan registrerat samma avbrott: skapa inte en ny frist
  markera frånkopplad
  frist = min(30 sekunder, 90 sekunder - förbrukadBudget)
  spara avbrottets start, deadline och unikt avbrotts-ID
  bevara endast denna spelares återstående tid för ett väntande val
  fortsätt övrigas tillåtna handlingar och aktiva turklockor

när ett val krävs av en frånkopplad spelare:
  registrera väntan på just det valet, utan att ändra avbrottets deadline
  gå inte förbi spelaren i en sekventiell kö
  tillåt fortfarande oberoende svar i en gemensam valfas

vid återanslutning eller fristkontroll, i samma matchkö:
  hantera giltiga tidigare köade återanslutningar
  debitera varje avslutat avbrott exakt en gång med faktisk väntetid
  hitta alla levande spelare vars avbrottsfrist nu är förbrukad
  slå ut dessa som en grupp innan matchvinst prövas
  om matchen fortsätter:
    vid giltig återkomst: skicka aktuell privat vy, inte läget före avbrottet
    återuppta spelarens eventuella väntande val med rätt återstående tid
    pröva nästa giltiga steg och vänta bara på nödvändiga saknade val
```

**Exempel:** Mira tappar anslutningen medan Alex väljer sitt anfallskort. Alex får slutföra sitt drag med sin vanliga turklocka. Om Mira ska agera därefter väntar spelet på henne med det som återstår av hennes befintliga återanslutningsfrist. Om Mira redan spelat sitt kort kan andra fortsätta striden; först ett senare nödvändigt val från Mira blockerar flödet. Tar hennes frist slut gäller vanlig individuell utslagning och kortborttagning enligt 12B/13A/24B.

Om ingen levande spelare alls är ansluten: använd arbetsförslaget att vänta in kvarvarande frister innan vinnare fastställs. Om alla förbrukar tiden avbryts matchen utan vinnare. Den som återkommer före egen deadline kan fortsätta med andra berättigade spelare; återkomst efter egen deadline ger aldrig rätt att spela vidare. En tillfälligt frånkopplad spelare med tid kvar räknas fortfarande som kvar i sitt lag.

En ny anslutning, flik eller återanslutning ger inte ny turtid eller ny budget. Efter utslagning kan lagen vara 1 mot 4, 2 mot 3 och så vidare; inga lagbyten eller ersättare sker mitt i matchen.

### En gemensam ordning för kommandon och timers

Tekniskt förslag: ett komplett meddelande får serverns mottagningstid och ett stigande sekvensnummer när det läggs i kön. Tid som förbrukas av serverns kö eller databas ska inte räknas som att klienten kom för sent. Meddelandet måste ändå klara alla behörighetskontroller.

```text
nätmeddelanden, återanslutningar och timerhändelser -> samma ordnade matchkö

ny handling är i tid om mottagningstid < den gällande deadlinen
exakt på deadline räknas som för sent
redan behandlat commandId -> tidigare kvittens, även efter deadline
vid timer -> kontrollera timer-ID, fas, spelarstatus och paus igen
bearbeta samtliga nu utgående utslagningar innan vinnare väljs
```

| Fall för test med styrd klocka | Förväntat enligt förslaget |
| --- | --- |
| Deadline 12:00:30; giltig återkomst 12:00:29.999 | Återanslut även om databasen blir klar efter deadline. |
| Giltig återkomst 12:00:30.000 | För sent; spelaren förblir utslagen när fristen avgörs. |
| Drag köat i tid, långsam lagring | Ingen tidsförlust enbart för att servern arbetade långsamt. |
| Samma sparade drag skickas igen | Gammal kvittens, ingen ny effekt eller extra utslagning. |
| Lämna behandlas före spelarens nya drag | Slå ut spelaren och avvisa draget; övriga fortsätter om matchen lever. |
| Avgörande strid behandlas före Lämna | Behåll det redan avgjorda lagresultatet. |
| Sista spelarna i båda lagens deadlines löper ut samtidigt | Avbruten match utan vinnare, inte seger utifrån timerordning. |

Använd en klocka som inte hoppar med systemtidsjusteringar för intervall under normal drift. Spara budget- och tidsunderlag beständigt. Efter serveromstart ska gamla timers inte återupptas eller slå ut spelare: pågående matcher avbryts enligt 27B innan nya anslutningar får skicka matchdrag.

## 11. Etapp 7 – drift, lagring och publicering

- Kör en separat Node-tjänst på den befintliga servern bakom Apache/HTTPS. Verifiera installerat stöd och processövervakning innan implementationens driftval låses.
- Spara matcher, medlemskap, sessioner, händelser, kvittenser, budgetsaldon och tidsunderlag. Lagringsfel får inte ge kvittens för osparade drag.
- **Beslutat 27B:** vid oväntad serveromstart markeras alla tidigare pågående matcher AVBRUTEN med orsaken SERVERAVBROTT och utan vinnare. Återuppta inte matcherna och ge ingen återkomstfrist på 60 sekunder. Avbryt gamla timers och frigör deltagarnas aktiva matchmedlemskap. Bevara redan sparade slutresultat. Serverfelet ger ingen individuell förlust eller nytt budgetavdrag; gamla matchkommandon får aldrig starta om matchen. Spelarna kan gå till lobbyn och själva ordna en ny match.
- Vid planerad deploy: stoppa nya matcher, låt pågående bli färdiga, uppdatera och öppna lobbyn igen. Dokumentera eventuell tvingad avstängning.
- Lägg databas, sessionshemligheter och säkerhetskopior utanför webbrot och Git. Välj gallringstid för inaktiva sessioner, tomma rum och avslutade matcher.
- Begränsa meddelandestorlek, antal anslutningar och anropsfrekvens. Håll privata händer och sessionstoken borta från felloggar.
- Ha nätprotokollversion och regel-/kortleksversion. En inkompatibel klient får uppdateringsbesked före matchstart; tvinga inte fram omladdning mitt i matchen.

### Uppstart efter serveravbrott – 27B

```text
innan spelservern öppnar för anslutningar:
  läs beständigt sparade matcher
  för varje match som fortfarande är pågående från föregående körning:
    i en transaktion:
      markera AVBRUTEN, slutorsak SERVERAVBROTT, winnerTeamId = inget
      avsluta väntande val, avbrottsfrister och matchmedlemskap
      spara en sluthändelse utan livsförlust eller budgetdebitering
  behåll redan avslutade matchers resultat oförändrade
  öppna för klientanslutningar först när avbrotten har sparats

vid återkomst till en avbruten match:
  skicka slutstatus och orsak; erbjud Till lobbyn
  avvisa nya spelhandlingar och ge ingen ny plats i den gamla matchen
  kända commandId kan få tidigare kvittens men aldrig utföras igen
```

Om lagringen är otillgänglig ska servern inte låtsas ha sparat avbrotten eller öppna för nya matchdrag. Hanteringen måste tåla att servern startas om igen under uppstädningen utan dubbla sluthändelser. Pågående matcher från en tvingad tjänsteomstart kan hanteras med samma avbrottsregel; planerad publicering ska i första hand vänta tills matcherna är färdiga.

### `deploy.sh` och versionsstämpling

Behåll stämplingen av HTML, CSS, modulimporter och assets. Lägg kommande klientfiler i den uttryckliga listan och testa genererade adresser i en verklig deploykopia. API-/WebSocket-adresser är inte cachade assets. Serverkod, installation, databasändringar och tjänsteomstart behöver ett eget driftsteg; dagens skript publicerar bara statiska filer.

`?v=...` ger nya adresser men bevarar inte gamla filinnehåll. Nuvarande deploy skriver stegvis över filer. Föreslå en färdig releasekatalog och atomärt byte av aktiv katalog för onlinedrift, alternativt underhållsläge under uppdateringen. Klient/server-kompatibilitet behöver kontrolleras även när filerna versionsstämplas.

## 12. Arbetsordning och avgränsning

| Steg | Leverans | Klart när |
| --- | --- | --- |
| 1 | Session, lobby och rum | Flera separata gäster kan bjudas in till samma rum utan att låsas av obesvarade inbjudningar. |
| 2 | Lagval, redo och värdstart | 2/4/6/8 deltagare och jämna självvalda lag valideras atomärt; all redo gäller samma uppställning. |
| 3 | Regel- och kortleksspecifikation | Lagstridens effektmål, lek, turordning och utslagning mitt i strid är preciserade. |
| 4 | Gemensamt vy-/anslutningslager | Lokalt datorläge fungerar fortfarande; onlineklienten behöver aldrig hela matchen. |
| 5 | Onlineduell som tekniskt deltest | Två personer spelar hela matchen via servern; detta är ett deltest, inte hela beställningen. |
| 6 | Lagmotor och lagvy | Hela matcher för 4/6/8 personer fungerar, inklusive laghjälp och ojämna lag efter utslagning. |
| 7 | Återanslutning, tidsförlust och beständig lagring | Rätt person slås ut en gång; laget fortsätter tills matchen är avgjord. |
| 8 | Drift och belastningstest | Publiceringskopian, avbrottshanteringen och överenskommen kapacitet är verifierade före publik lansering. |

Möjliga nya delar: `lobby.html`, `lobby.js`, `lobby.css`, `online.js` samt servermoduler för sessioner, rum, matchkö och lagring. Lagregler kan få egna moduler och tester för att skydda den befintliga duellen. Filnamnen är förslag.

Konton, chatt, ranking, turneringar, allmänna åskådare och flera serverinstanser ingår inte. Ett utökat lagläge mot datorer ingår inte heller; det nuvarande datorläget ska bevaras. En senare revansch behöver nytt samtycke från deltagarna.

## 13. Tester före publik lansering

- [ ] Befintliga duelltester, datorläge, ljud, långtryck och mobilvy fortsätter fungera.
- [ ] Nick med å/ä/ö, dubbletter, för lång text och HTML-liknande innehåll hanteras säkert.
- [ ] Flera accepteranden går till samma rum; första acceptansen återkallar inte övrigas inbjudningar.
- [ ] Samma person som accepterar två olika rum hamnar i högst ett. En obesvarad inbjudan låser ingen mottagare.
- [ ] Start accepteras bara för 2/4/6/8, jämna lag och alla redo. Värden kan inte starta med en gammal laguppställning.
- [ ] Samtidigt lagbyte, sent accepterande och Starta ger en enda konsekvent deltagarlista.
- [ ] 25A: värdens avhopp före start ger värdrollen till den längst anslutna kvarvarande deltagaren och nollställer allas Redo. Tomma rum stängs; efter start är värden en vanlig spelare.
- [ ] Råa nätverkssvar innehåller bara egen hand och offentlig information, även för lagkamrater och utslagna.
- [ ] Fel identitet, främmande match/kort, fel tur, falskt teamId och gammal revision avvisas.
- [ ] Tappad kvittens och dubbelt commandId gör inte två drag; ändrat innehåll med samma ID avvisas.
- [ ] Serverbekräftade animationer och ljud spelas en gång och återspelas inte vid återanslutning.
- [ ] Fulla matcher för 2, 4, 6 och 8 deltagare; kortlek räcker till maximala startbyten och bokföringen stämmer.
- [ ] Alla godkända specialkort i lagstrid har exempeltester för mål, ordning, hjälp och flera samtidiga effekter.
- [ ] 14A/15A: hjälpare får använda försvarsspecialkort och Helande ljus läker hjälparen, inte automatiskt måltavlan; maxliv och utslagning respekteras.
- [ ] 16A: Törnesköld kräver en levande fiende som lagt attackkort; motstöten träffar bara vald person vid lyckat försvar.
- [ ] 17A: borttaget kortmål ger inget omval; Spegelsköld återgår till 1 och övriga kort behåller sin grundstyrka.
- [ ] 18A: flera Isrustningar, Sprängladdningar och Törnesköldar summeras per kort; stoppade eller borttagna effekter räknas inte. Styrka/liv stannar vid 0.
- [ ] 19A: Spegelsköld kopierar ett valt magiskt kort inklusive bonus före frost, ersätter grundförsvaret och ger 1 vid saknat/stoppat mål.
- [ ] 20A: en hjälpares blå kort utlöser Drakelds +2; flera blå kort ger inte flera bonusar till samma Drakeld. Magi/hybrid utlöser ingen bonus.
- [ ] 21A: målansvar och första anfall roterar till nästa levande lagkamrat; måltavlan försvarar först och utslagna hoppas över.
- [ ] 22A: endast helt tomma händer får upp till fem kort, ett i taget runt bordet; slänghögen blandas vid behov och påfyllning sker en gång per strid.
- [ ] 23A: valfritt kort ger enkel attack 1 utan bonus eller specialeffekt; ursprunglig magi kan då varken speglas eller förseglas, men Barriär kan stoppa kortet.
- [ ] 24B: alla anfallskort borttagna ger lyckat försvar och ägarens läkning; motstöt flyttas aldrig från en utslagen spelare till en annan. 0 mot 0 är också lyckat försvar.
- [ ] 24B går inte före matchslut eller 13A; kvarvarande anfallsval hanteras innan det slutliga anfallet bedöms som tomt.
- [ ] Räkneexemplen i avsnitt 7 stämmer; liv ändras först vid avgörandet, exakt en gång, och samtidiga motstötar avgörs tillsammans.
- [ ] Att lämna, bli tidsutslagen eller nå noll liv tar bort bara den spelaren; 1 mot 4 och andra ojämna lägen fungerar.
- [ ] Utslagning under byte, målval, anfall, försvar och Fortsätt lämnar inga blockerade köer eller kvittenser.
- [ ] 12B: ett borttaget bidrag minskar styrkan, räknas inte två gånger och ersätts inte; redan avgjorda resultat ändras aldrig.
- [ ] 13A: avhopp från måltavlan avbryter striden utan skada, läkning eller motstöt och utan nytt mål.
- [ ] Riktade effekter, stopp, spegling och Drakelds bonus räknas om från kvarvarande kort enligt effektordningen i avsnitt 7.
- [ ] Flikstängning, omladdning, hårt avslutad webbläsare, flygplansläge och dubbla flikar testas.
- [ ] Avbrottsbudget 30/90 räknas exakt en gång och återställer inte turtid; serverfel kostar ingen budget.
- [ ] 26B: andra spelare kan agera och deras turklockor går vidare vid ett personligt avbrott; endast ett nödvändigt saknat val blockerar flödet.
- [ ] 26B: den frånkopplades vanliga turtid bevaras, avbrottsfristen startas inte om vid nästa val och gemensamma bekräftelser från övriga tillåts.
- [ ] 26B: en redan given Fortsätt-bekräftelse gäller även under avbrott; giltiga stridsresultat kan påverka den frånkopplades liv och återkomst får aktuell vy.
- [ ] Flera frånkopplade, alla frånkopplade och samtidigt utslagna sista lagmedlemmar ger konsekvent resultat.
- [ ] Testa tidstabellens gränsfall med styrd klocka samt gammal timer/anslutningsgeneration.
- [ ] Samtidiga Fortsätt och utslagning startar nästa strid exakt en gång och väntar inte på utslagna.
- [ ] Flera parallella matcher läcker inga händer, resultat eller meddelanden till andra rum.
- [ ] 27B: serveromstart avbryter pågående matcher utan vinnare, individuell förlust, budgetavdrag eller återupptagning. Sparade slutresultat bevaras och spelarna kan skapa en ny match.
- [ ] Upprepad serveromstart under uppstädning ger inga dubbla sluthändelser; gamla kommandon återupplivar ingen match och databasfel ger inget godkänt osparat drag.
- [ ] Verklig deploykopia: rätt versionsstämplar, nätanslutning via HTTPS, gammal klient och underhållsläge.
- [ ] Provspela på olika enheter/nät, inklusive mobil och åtta samtidiga deltagare; fastställ kapacitetsmål för lobbyn.

## 14. Nästa steg

Genomförandet är nu uppdelat i separata agentuppgifter i [arbetsordning lobby.md](<arbetsordning lobby.md>). Börja med L00 och följ dess beroenden, färdigkriterier och överlämningsmall. Den här huvudplanen behåller de beslutade reglerna; arbetsordningen anger hur de byggs stegvis.

Valen 1–27 är införda; inga av dem behöver frågas igen. Spelreglerna finns samlade i avsnitt 7. Värdbyte före start följer 25A, personliga avbrott följer 26B och oväntad serveromstart följer 27B. De tidigare alternativen om global anslutningspaus och återupptagning efter serveromstart gäller inte.

Nästa planeringssteg är en samlad genomgång av scenarierna och tekniska arbetsförslag: bland annat nickgränser, inbjudningars giltighetstid, städning av rum och sessioner, plats-/utdelningsordning samt kapacitetsmål. Serverns driftstöd kan undersökas när tillgång finns. Balansen behöver därefter provspelas. Den här filen är fortsatt en lokal plan, inte en order att börja implementera eller publicera onlinespelet.
