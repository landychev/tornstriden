# Kontrakt för lobby och onlinespel

Källa: `kontrakt.js` (validering, importeras av server och klient) och `teststod.js` (bara tester).
Skapad i arbetsordning L01, 2026-10-13. Nycklar på engelska, värden på svenska, som i `match.js`.

## Räknare

| Räknare | Hör till | Ökar när | Används till |
| --- | --- | --- | --- |
| `rosterVersion` | rum | deltagare eller lagval ändras | Redo gäller en viss uppställning (`readyRosterVersion`) |
| `roomRevision` | rum | varje rumsändring, även anslutningsstatus | klienten vet att rumsvyn är nyare |
| `revision` | match | varje godkänt matchkommando | kommandon måste bära aktuell revision |
| `eventId` | match | varje händelse, löpnummer från 1 | ljud/animation högst en gång; `lastEventId` i vyn |
| `connectionGeneration` | session | varje ny styrande anslutning | ett sent close från gammal anslutning ignoreras |

## Objekt

- **Session** (serverintern): `playerId, nick, nickKey, tokenHash, createdAt, lastSeenAt, expiresAt, activity, connection, roomId, matchId, connectionGeneration`. Token i klartext lagras aldrig. `publicSession()` ger `{playerId, nick, activity, connection}` till lobbylistan.
- **Inbjudan:** `id, roomId, fromPlayerId, toPlayerId, expiresAt, status` (VÄNTAR/ACCEPTERAD/AVBÖJD/UTGÅNGEN/ÅTERKALLAD).
- **Rum:** `id, hostPlayerId, status, rosterVersion, roomRevision, matchId, players[]` där varje deltagare har `playerId, nick, teamId (A/B/null), connection, ready, readyRosterVersion, joinedAt`. Högst 8, unika spelare, värden är deltagare; ett tomt rum är STÄNGT.
- **Lag:** `TEAMS` = A ”Södra laget”, B ”Norra laget”. I duellen är spelare A lag A och spelare B lag B.
- **Kommando** (klient → server): `protocolVersion, commandId, type, payload` plus `matchId + revision` för matchkommandon och `roomId` för rumskommandon. Får aldrig innehålla `playerId`, `teamId` (utom VÄLJ_LAG i payload), `token`, `life` eller `winner` – identitet kommer från sessionen. Högst 2048 tecken. `commandFingerprint()` ger ett avtryck av innehållet så att samma `commandId` med annat innehåll avvisas.
- **Kvittens** (server → klient): `commandId, status (GODKÄND/AVVISAD/INTERNT_FEL/OKÄND), message, revision, roomRevision, eventId, fingerprint`. OKÄND är svaret på KOMMANDOSTATUS när servern inte känner till kommandot.
- **Händelse:** `eventId, matchId, revision, type, at, data, recipient`. `recipient = null` är offentlig och får inte innehålla någon hand; en händelse med `recipient` får bara innehålla den spelarens hand.
- **Privat vy** (server → en klient, eller lokaladapter → vyn): `protocolVersion, matchId, revision, lastEventId, rulesVersion, deckVersion, viewer, teamId, phase, me {id, name, life, hand[{instanceId, cardId}]}, players[{id, name, teamId, life, cardCount, status, connection}], allowed[], pending, deadline`. Övriga fält (`battle`, `lastResult`, `opponent`, `log` …) är tillåtna så länge de inte bryter hemlighetsregeln. Dagens `playerView()` passar med ett tunt omslag (se testet).

## Hemlighetsregel

`assertNoSecrets(objekt, viewerId)` körs på allt som lämnar servern: nycklarna i `SECRET_KEYS` (`token, tokenHash, secret, cookie, instances, drawPile, setAside, deckOrder`) är förbjudna på alla nivåer, och en `hand` med `cardId` får bara ligga på objektet vars `id === viewerId`. Hela matchobjektet från `match.js` faller på `instances`.

## Kommandotyper

Lobby: `SÄTT_NICK, SKAPA_RUM, BJUD_IN, ACCEPTERA, AVBÖJ, ÅTERKALLA, VÄLJ_LAG, REDO, STARTA, LÄMNA, KOMMANDOSTATUS`.
Match: dagens `ACTION` (`BEKRÄFTA_BYTE, SPELA_ATTACK, SPELA_FÖRSVAR, AVSTÅ_FÖRSVAR, FORTSÄTT, GE_UPP`) samt `VÄLJ_MÅL`, `BEKRÄFTA_START` och `AVSTÅ_ANFALL` för lagmatchen. I lagmatchen betyder `GE_UPP` "Lämna matchen": bara den egna spelaren slås ut och laget spelar vidare (8A); matchen avslutas först när ett lag saknar levande spelare (lagmatch.js, L13). Det är alltid tillåtet för en levande spelare medan matchen pågår: motorns `allowedActions` listar det inte, men serverns lagvy lägger till `{type: 'GE_UPP'}` i `allowed` (L14).

## Adaptergräns (L07/L09)

Matchvyn pratar bara med ett objekt som klarar `assertAdapter()`: `mode` (LOKAL/ONLINE), `viewer()`, `view()`, `send(command)`, `status(commandId)`, `subscribe(listener)`. `LokalMatch` kör `match.js`/`dator.js` i webbläsaren, `OnlineMatch` skickar kommandon och tar emot privata vyer. Duell/lag skiljs av `rulesVersion` i vyn.

## Teststöd

`styrdKlocka()` (now/setTimeout/clearTimeout/advance/pending), `styrdSlump(frö)` (ersätter `Math.random`), `testSessioner(n)` (separata identiteter med token och sessionsobjekt åtskilda) och `samlare()`. Testhashen `test-…` är inte serverns riktiga tokenhash (väljs i L03).

## HTTP-gränssnitt (online/server.js, från L02–L03)

Alla svar är JSON utom händelseströmmen. Skrivande anrop (POST/DELETE) kräver `Origin` = egen host eller ett värde i `TORNSTRIDEN_ORIGINS`, annars 403. Sessionen ligger i kakan `tornstriden_session` (HttpOnly, SameSite=Lax, Secure bakom HTTPS); utan giltig kaka svarar skyddade adresser 401.

| Adress | Utan session | Gör |
| --- | --- | --- |
| `GET /api/halsa` | ja | `{tjanst, protocolVersion, schemaversion, matchtrafik{oppen, orsak}, nyaMatcher{oppna, orsak}, pagaende, tid}` – `nyaMatcher` är underhållsläget (L21: SIGUSR1 stänger nya starter, SIGUSR2 öppnar), `pagaende` antalet pågående matcher |
| `POST /api/session` `{nick}` | ja | skapar gästsession (201 + kaka) eller återupptar befintlig (200); 409 vid upptaget nick, 400 vid ogiltigt |
| `GET /api/session` (200 med `{me: null}` utan session), `GET /api/lobby` | nej | `{me, players[], rum, start, inbjudningar{inkommande[], utgaende[]}}` – offentliga sessioner, eget rum (eller null), startstatus för rummet (`{kanStarta, skal[], antal{A,B}, format, tillganglig, tillgangligaFormat[]}`, null utanför förberedelse) och öppna inbjudningar |
| `DELETE /api/session` | – | lämnar lobbyn (bara när LEDIG), raderar kakan |
| `GET /api/handelser` | nej | SSE: `halsa`, därefter `lobby` (samma innehåll som `/api/lobby`) vid varje ändring i lobby, rum eller inbjudningar – en ström får bara `lobby` när just dess innehåll ändrats (L20), `ersatt` om en annan flik tar över, `: puls` var 25 s |
| `POST /api/kommando` | nej | ett kommando enligt kontraktet → kvittens; 400 vid kontraktsfel |
| `GET /api/status?commandId=…&scope=…` | nej | kvittens eller OKÄND (scope default `spelare:<id>`; matchkommandon har scope `match:<matchId>`, rumskommandon `rum:<roomId>` – kommandotypen avgör, inte vilka fält som skickats med) |
| `GET /api/match?efterEventId=N` | nej | `{view, events, status}` för den egna pågående/avslutade matchen; 404 utan match. Utan `efterEventId` är `events` tom |

## Rumskommandon (från L04)

| Kommando | Fält | Svar vid fel |
| --- | --- | --- |
| `SKAPA_RUM` | – | ”Du är redan i ett rum eller en match.” |
| `BJUD_IN` | `roomId`, `payload.playerIds[]` | bara värden; per mottagare hoppas över med skäl i `message` (du själv, inte i lobbyn, redan i rum, inte ansluten, redan inbjuden, avböjde nyss, ingen plats); max 1 kommando/s; deltagare + öppna inbjudningar ≤ 8 |
| `ACCEPTERA` | `payload.invitationId` | ”Inbjudan har gått ut/återkallats/är avböjd/är redan accepterad”, ”Rummet är fullt”, ”Matchen har startat”, ”Rummet är stängt”, ”Du är redan i ett rum …”. Vid lyckat: andra egna inbjudningar stängs, övrigas till samma rum lever kvar (1B) |
| `AVBÖJ` / `ÅTERKALLA` | `payload.invitationId` (`ÅTERKALLA` även `roomId`) | bara mottagaren resp. värden, bara öppna inbjudningar |
| `LÄMNA` | `roomId` | tar bort deltagaren; tomt rum stängs; lämnar värden tar längst anslutna över (25A); Redo nollställs. Går inte efter start. |
| `VÄLJ_LAG` | `roomId`, `payload.teamId` (A/B/null) | högst 4 per lag; en faktisk ändring ökar `rosterVersion` och nollställer allas Redo (7B) |
| `REDO` | `roomId`, `payload.ready`, `payload.rosterVersion` | `true` kräver aktuell `rosterVersion`, egen anslutning och valt lag; `false` tar tillbaka när som helst |
| `STARTA` | `roomId`, `payload.rosterVersion` | bara värden (9B); kräver aktuell `rosterVersion`, 2/4/6/8 deltagare (6A), valt lag för alla, lika stora lag, alla anslutna och Redo för denna uppställning, samt en registrerad motor för antalet. Rummet blir STARTAD med `matchId`, matchen skapas i samma transaktion, öppna inbjudningar återkallas och alla blir SPELAR |

Motorer registreras med `rum.registreraMotor(antal, fabrik)`; `fabrik({ ops, room, players[{playerId, nick, teamId}], klocka, slump })` sparar matchen via `ops` och returnerar `{ matchId, rulesVersion, deckVersion }` (L08 för 2, L14 för 4/6/8).

Tider: inbjudan löper ut efter 120 s, karens 30 s efter avböjande, frånkopplad i rum tas bort efter 60 s, inaktivt rum stängs efter 2 h, stängda rum/besvarade inbjudningar raderas efter 1 h. `DELETE /api/session` lämnar först rummet.

## Adaptern i praktiken (från L07)

`lokalmatch.js` exporterar `skapaLokalMatch()` som uppfyller `assertAdapter()` och dessutom har ett `local`-objekt som bara finns lokalt: `setViewer` (två spelare vid samma skärm), `newMatch`, `computerDecision`/`computerSend` (datorn tar sitt beslut på sin egen vy inne i adaptern) och `revealHand` (utvecklingspanelen). `matchvy.js` läser bara `adapter.view()` (privat vy enligt kontraktet, byggd av `playerView` + `allowedActions`), skickar kommandon med `instanceId`/`usage`/`cards` i `payload` och spelar ljud på händelserna från `subscribe`. Händelsetyper (`EVENT` i lokalmatch.js): `KORT_SPELAT {playerId, cardId, usage, role, cardType}`, `AVSTÅ`, `BYTE {count}`, `PÅFYLLNING {playerId, count}`, `STARTSPELARE {playerId}`, `RESULTAT`, `MATCHSLUT {winner, endReason}`, `GE_UPP`, `FORTSÄTT`, `LOGG {text}`. Onlineadaptern (L09) ger samma vy och händelser från servern och saknar `local`.

## Onlineduell (från L08)

När rummet startas med 2 deltagare skapar `online/duell.js` en match med `duell-v1` på servern. Lag A sitter på plats `A`, lag B på plats `B`; `seats` i vyn mappar plats → spelar-ID och `mySeat` är den egna platsen. Vyn är `privatVy()` för platsen (samma form som lokalt, `viewer` = platsen, `players[].name` = nick) plus `confirm` och `matchStatus`.

- Matchkommandon bär `matchId` och motorns `revision`; identiteten (platsen) kommer från sessionens medlemskap. Fel tur och främmande kort avvisas av motorn med dess egna meddelanden.
- **Bekräftelser:** efter startbytena (`confirm.kind = BEKRÄFTA_START`) och efter varje strid (`confirm.kind = FORTSÄTT`) måste båda levande spelare skicka bekräftelsen; `confirm.waitingFor` listar vilka som saknas, `confirm.mine` om jag redan bekräftat. Bekräftelser ändrar inte `revision`. Övergången (motorns FORTSÄTT) körs exakt en gång av servern när den sista bekräftar; `allowed` innehåller aldrig motorns FORTSÄTT direkt, bara bekräftelsen när den är min att ge. Under en väntande bekräftelse är bara `GE_UPP` möjligt utöver bekräftelsen.
- Händelser: samma typer som lokalt (`KORT_SPELAT`, `BYTE`, `PÅFYLLNING`, `STARTSPELARE`, `RESULTAT`, `MATCHSLUT`, `LOGG` …) plus `BEKRÄFTELSE {kind, playerId, waitingFor}`. Alla är offentliga (`recipient: null`) och utan kortdata för händer.
- SSE: efter varje godkänt kommando får varje deltagare med en ström händelsen `match` med `{view, events, status}` där `events` är händelserna sedan strömmens senaste `lastEventId`; vid öppnad ström skickas aktuell vy med tom händelselista. Ett matchdrag går bara till den matchens strömmar som saknar den senaste händelsen (L20) – andra matcher och lobbyn får inget. Kommandotypen avgör utskicket: ett lobbykommando med ett extra `matchId` är fortfarande en lobbyändring och når alla berörda. Lobbyn uppdateras efter ett matchdrag bara om spelarlistan ändrats (t.ex. vid matchslut, när deltagarna blir FÖLJER_AVSLUT).
- Matchslut: matchen sparas AVSLUTAD, rummet STÄNGD och deltagarna FÖLJER_AVSLUT tills de skickar `LÄMNA` (rummets id) och blir LEDIG igen.

## Onlineadaptern i webbläsaren (från L09)

`onlinematch.js` exporterar `skapaOnlineMatch({ initial })` med samma sex metoder som LokalMatch och ingen `local`. `match.html?online=1` hämtar `/api/match`, öppnar strömmen och väljer onlineadaptern; utan match skickas man till `lobby.html`. Lobbyn navigerar automatiskt till matchsidan när `me.activity` blir SPELAR.

- `send()` sätter `pending {commandId, status: SKICKAR}` i vyn tills kvittensen kommit. Uteblir svaret frågas `/api/status` (status KONTROLLERAR) upp till fem gånger med växande paus; en känd kvittens används, OKÄND med oförändrad revision ger en omsändning av samma kommando, OKÄND med ändrad revision ger ”Matchläget har ändrats – välj igen”. 401 skickar till lobbyn, 400 visas som avvisning.
- `receive()` tar bara emot vyer med minst lika högt `lastEventId`/`revision` och levererar bara händelser med högre `eventId` än senast sedda – en gammal vy eller kvittens skriver aldrig över nyare läge.
- Egen plats visas alltid nederst (zon A på bordet) och motståndaren överst; namnen är nick. Startmeddelandet och resultatrutan skickar BEKRÄFTA_START respektive FORTSÄTT och visar ”Väntar på …” tills motståndaren bekräftat. ”Till lobbyn” skickar LÄMNA för det stängda rummet och går till `lobby.html`.
- Lokalt datorläge (`match.html` utan `?online`) är oförändrat; lägesväljaren och datorstrategin döljs online.

## Lagmatch online (från L14)

När rummet startas med 4, 6 eller 8 deltagare skapar `online/lagspel.js` en lagmatch med `lag-v1` och kortleken `lag-100-v1`/`lag-150-v1`/`lag-200-v1`. `online/matcher.js` väljer motor efter antalet och skickar sedan varje matchkommando och vyhämtning till den modul som skapade matchen; kö, transaktion, kvittenser och lagring är desamma som för duellen. Lagformaten är öppna i lobbyn sedan lagvyn finns (L15); `TORNSTRIDEN_LAGSPEL=0` (eller `startaServer({ lagspel: false })`) stänger dem.

- **Start:** starttransaktionen låser regel- och kortleksversion, medlemskap och lag. Rummets ordning blir lagens fasta ordning; motorns spelar-ID är sessionernas `playerId`. Den sparade matchen har `format: 'lag'`.
- **Vy** (`lagVy()` i `lagvy.js`, klarar `validatePrivateView`): `format: 'lag'`, `viewer` = eget spelar-ID, `teamId`, `phase`, `matchStatus`, `me {id, name, teamId, life, status, eliminationReason, hand[{instanceId, cardId}]}`, `players[{id, name, teamId, life, cardCount, status, eliminationReason, connection}]`, `teams {A[], B[]}` (fast ordning), `seats[]`, `rules`, `swap {round, rounds, maxCards, confirmed[], waitingFor[], mine}` under startbytena, `attackingTeam`, `battleNumber`, `activePlayer`, `nextLeader`, `battle {number, attackingTeam, leader, target, attackQueue[], attackIndex, defenceQueue[], defenceIndex, turns[], startLife, table[{instanceId, cardId, playerId, role, usage, targetCard, targetPlayer}], preview}` där `preview` (när måltavlan är vald) är `{attack, defence, defended, cards{instanceId: {value, bonus, stoppedBy[], mirrorOf, …}}, stopped[], deductions{frost, pierce}}` – samma beräkning som avgörandet på bordets kort just nu, utan livsändringar, `confirm {kind, confirmed[], waitingFor[], mine}`, `drawPileCount`, `discardPileCount`, `lastResult` (hela stridsresultatet inklusive bordet), `winnerTeam`, `endReason`, `log` (senaste 40 raderna), `allowed`. Bordskort och resultat är offentliga; ingen annans hand finns i vyn.
- **allowed:** motorns `allowedActions` (med kort, giltiga kortmål `cardTargets` och spelarmål `playerTargets`) plus `{type: 'GE_UPP'}` för en levande spelare medan matchen pågår.
- **Kommandon och payload:** `BEKRÄFTA_BYTE {cards[]}` (högst 2 egna exemplar per omgång), `BEKRÄFTA_START`, `VÄLJ_MÅL {targetPlayerId}`, `SPELA_ATTACK {instanceId, usage?}` (`usage: 'simple'` = enkel attack 1), `AVSTÅ_ANFALL`, `SPELA_FÖRSVAR {instanceId, targetInstanceId?, targetPlayerId?}` (kortmål för Barriär, Försegling och Spegelsköld; spelarmål för Törnesköld), `AVSTÅ_FÖRSVAR`, `FORTSÄTT`, `GE_UPP` (Lämna matchen). Kontraktet kontrollerar formen på `cards`, `targetInstanceId` och `targetPlayerId`; allt annat prövas av lagmotorn.
- **Revision:** varje godkänt lagkommando, även en bekräftelse, ökar `revision`. Turval (mål, kort, avstående) kräver exakt revision. Byten och bekräftelser är samtidiga val: de godtas med vilken revision som helst från den pågående samlingen (samma fas, bytesomgång och strid), så att alla kan välja ur samma vy. `GE_UPP` godtas med vilken tidigare revision som helst. En upprepad bekräftelse är ofarlig (GODKÄND utan ändring); en bekräftelse eller ett byte från en tidigare samling avvisas med "Matchläget har ändrats".
- **Händelser** (alla offentliga, inga exemplar ur någon hand): `BYTE {playerId, count, round}`, `BEKRÄFTELSE {kind, playerId, waitingFor}`, `MÅLVAL {playerId, target}`, `KORT_SPELAT {playerId, cardId, usage, role, cardType, targetCard, targetPlayer}`, `AVSTÅ {playerId, role}`, `GE_UPP {playerId}`, `RESULTAT {battleNumber, attackingTeam, leader, target, outcome, reason, attack, defence, defended, lifeDelta, life, startLife, eliminated}`, `UTSLAGEN {playerId, reason}`, `PÅFYLLNING {playerId, count}` (antalet läses ur motorns `lastRefill`, inte ur handstorlekar), `FORTSÄTT {battleNumber}`, `STARTSPELARE {playerId, teamId, battleNumber}` (ny strid eller ny startspelare), `MATCHSLUT {winnerTeam, endReason}`, `LOGG {text}`.
- **Utslagen:** sessionen blir `FÖLJER_AVSLUT` direkt. Vyn finns kvar, utan hand och utan val. `LÄMNA` med rummets id tar spelaren till lobbyn (LEDIG) utan att rummet eller matchen ändras; ett senare kommando till den gamla matchen avvisas med "Du deltar inte i den här matchen.". Vid matchslut sparas matchen AVSLUTAD, rummet STÄNGD och alla som fortfarande hör till matchen blir FÖLJER_AVSLUT.
- **Motorfel:** ingenting sparas, kvittensen blir INTERNT_FEL och ingen vinnare utses.

## Lagvyn i webbläsaren (från L15)

`lagmatch.html` med `lagmatchvy.js` och `lagmatch.css` är lagmatchens sida. `match.html?online=1` skickar vidare dit när vyn har `format: 'lag'`, och lagsidan skickar en duell tillbaka; lobbyn behöver inte veta formatet. Sidan använder samma onlineadapter (`onlinematch.js`, där `viewer()` är `mySeat` i duellen och eget spelar-ID i lagmatchen) och laddar aldrig lagmotorn: faser, utfall, slutorsaker och utslagsorsaker finns i `kontrakt.js` (`TEAM_FORMAT`, `TEAM_MATCH_PHASE`, `TEAM_OUTCOME`, `TEAM_END`, `ELIMINATION`) och används av både motorn och vyn.

- **Bordet:** fiendelaget överst, stridsplatsen med anfalls- och försvarskön i mitten (vem som lagt vilket kort, vem som avstod, vem som väljer nu, kortmål och spelarmål) och det egna laget nederst. Varje torn visar namn, liv, kortantal och läge i text: Måltavla, Väljer måltavla/anfall/hjälp, Försvarar, Startspelare, Inte klar, Frånkopplad, Utslagen eller Lämnade matchen. Lagens ordning är turordningen.
- **Val:** allt görs i knappraden direkt ovanför handen – byten, Börja striden, måltavla (även genom att trycka på ett fiendetorn), kort, vanlig eller enkel attack, kortmål för Barriär/Försegling/Spegelsköld, spelarmål för Törnesköld, Avstå anfall, Avstå försvar / Avstå – hjälp inte och Fortsätt. Finns bara ett giltigt mål väljs det direkt. Knapparna visar bara det som finns i serverns `allowed`.
- **Förhandsvisning:** under striden visar bordet lagens summor, avdrag (Isrustning, Sprängladdning) och per kort vad det räknas som – bonus, stopp och spegling – ur `battle.preview`. Fastexten säger "Just nu: attack X mot försvar Y".
- **Mål som försvinner:** valda mål (måltavla, kortmål, spelarmål) prövas mot varje ny vy och innan draget skickas; ett mål som servern inte längre erbjuder släpps, och finns bara ett giltigt mål väljs det.
- **Resultat:** resultatrutan visar lagens summor, vem som lade vad (stoppade kort markerade), livsändringar, utslagna och hela beräkningen. Den egna utslagningen ("Du är utslagen – laget spelar vidare") står på en egen rad och i knappraden; matchslutet visar lagets resultat ("Ditt lag vinner matchen!" eller "<lag> vinner matchen", "Ingen vann matchen") även för den som redan var utslagen.
- **Lämna matchen** (sidhuvudet) frågar först och skickar `GE_UPP`. En utslagen kan följa matchen eller gå till lobbyn.
- **Långtryck** på ett kort i handen eller på bordet öppnar kortet förstorat; lagvyn lägger till en rad "I lagmatch" för specialkorten (14A–20A). Långtrycket, kortrutan och kortflygningarna ligger i `kortlupp.js` och delas med duellvyn.
- `deploy.sh` publicerar `kortlupp.js` (duellen importerar den). Lobbyn och lagsidan läggs i publiceringslistan först när onlinespelet publiceras (L21); utvecklingsservern släpper igenom dem. `klientfiler.test.js` kontrollerar att varje sida bara laddar filer som får hämtas.

## Spelarklockor (från L16)

Varje val som servern kräver av en viss spelare har 90 sekunder (`online/klockor.js`, `TURTID_MS`): kortbyte, startbekräftelse, målval, kortspel, avstående och Fortsätt – i duellen och i lagmatchen. Klockorna sparas med matchen som `klockor {spelar-ID: {nyckel, start, deadline}}` och räknas om efter varje ändring. Nyckeln beskriver valet: samma val behåller sin deadline, ett nytt val får nya 90 sekunder, och den som bara väntar på andra har ingen klocka. Markering, avvisade drag och omladdning ändrar inte matchen och återställer därför inte klockan.

- **Vy:** `deadline` är `{playerId, at}` när servern väntar på mig (i duellen är `playerId` platsen `A`/`B`), annars `null`. `clocks {spelare: at}` är alla väntade spelares deadlines (offentligt – alla ser vem som väntas på). `serverTime` är serverns tid när vyn byggdes; klienten räknar ned mot den (`onlinematch.js`: `serverNu()`), aldrig mot sin egen klocka.
- **I tid:** ett kommando är i tid om serverns mottagningstid (tagen innan kommandot köas) är mindre än deadline; exakt på deadline är för sent och avvisas med "Tiden för ditt val har gått ut.". Tid i kö eller databas räknas inte mot spelaren. Ett redan behandlat `commandId` ger sin gamla kvittens även efter deadline.
- **Timer:** matchens timer planeras efter varje godkänt kommando (även STARTA) och körs i matchens kö, samma ordning som kommandona. Den prövar vad som gått ut vid tiden då den lades i kön, inte när kön hinner fram. En återkomst eller ett drag som togs emot i tid men köades efter timern godtas därför alltid. En deadline som redan passerats när timern planeras läggs direkt i kön. Före varje nytt matchkommando (efter dedupe på `commandId`) behandlas dessutom de klockor som gått ut vid kommandots mottagningstid, i en egen transaktion som står kvar även om kommandot sedan avvisas – en försenad timer kan därför aldrig låta ett senare Lämna eller ett avgörande drag ge fel vinnare. Den vars tid gick ut strax före sitt eget kommando får "Tiden för ditt val har gått ut.". Den prövar på nytt vilka klockor som verkligen gått ut; en dubbel eller sen timer gör ingenting. Får en utgången klocka ingen effekt (motorfel, som rullas tillbaka) stoppas matchens timer och felet loggas; nästa godkända kommando planerar den igen. Vid avstängning väntar servern in en redan köad kontroll innan lagringen stängs. Ingen timer överlever en serveromstart; matcher som pågick avbryts vid nästa start (se Serveromstart).
- **Lagmatch:** alla vars tid gått ut vid samma tidpunkt slås ut i en och samma händelse (`slaUt`, orsak `TIDSGRÄNS`, en `UTSLAGEN`-händelse per spelare och samma revision) innan vinnaren prövas. Utslagna blockerar aldrig Fortsätt eller startbekräftelsen. Finns inget levande lag kvar avslutas matchen utan vinnare (`endReason: INGA_SPELARE`) och sparas **AVBRUTEN**.
- **Duell:** den vars tid går ut förlorar (`endReason: TIDSGRÄNS`, matchen AVSLUTAD). Går båda bekräftelseklockorna ut samtidigt vinner ingen (`winner: null`, `endReason: INGEN_VINNARE`) och matchen sparas AVBRUTEN. `MATCHSLUT {winner, endReason}` skickas som vanligt.
- **Vyerna:** den som har ett val ser "1:30 kvar att välja" överst i knappraden (och i resultatrutan respektive startrutan); under 20 sekunder byts texten till en varning ("… kvar – välj nu, annars slås du ut" / "annars förlorar du matchen") med tecken och färg, och skärmläsare får "Mindre än 20 sekunder kvar att välja." en gång. Lagvyns torn visar varje väntad spelares tid; duellen visar motståndarens tid vid motståndarens torn. Nedräkningen ligger i `nedrakning.js` (delas av båda vyerna och publiceras av `deploy.sh`). Vid 0:00 väntar sidan på serverns besked. Nedräkningen visas också som en fast rad överst i öppna rutor (spelförklaringen, bytesförklaringen, kortrutan, ljud- och bekräftelserutan), och när matchen är slut – eller jag själv slås ut i lagmatchen – stängs öppna hjälprutor så att beskedet syns direkt.

## Anslutningsavbrott (från L17)

Ett personligt nätavbrott följer 2A och 26B: högst 30 sekunder per upptäckt avbrott och sammanlagt 90 sekunder per spelare och match, utan global paus (`online/klockor.js`, `AVBROTT_MS`, `AVBROTT_BUDGET_MS`).

- **Livstecken:** strömmen skickar `event: ping` med `{n}` var 5:e sekund (`PING_MS`). Klienten svarar med `POST /api/livstecken` och kroppen `{n}` (kräver session och rätt ursprung, svar 204). Har ingen ping besvarats på 15 sekunder (`TYST_MS`, räknat från när den senast besvarade pingen skickades) räknas anslutningen som avbruten. Strömmen stängs då och spelaren blir frånkopplad, precis som när klienten stänger strömmen. Både lobbyn och matchsidorna svarar på ping. Ger webbläsarens ström upp för gott (t.ex. 502 från proxyn) öppnar sidan en ny med växande paus. Flikbyte eller omladdning skickar aldrig Ge upp.
- **Nåd för en stängd ström:** en stängd ström blir ett avbrott i matchen först efter 3 sekunder (`OMLADDNING_MS`), men fristen räknas från stängningen. En omladdning eller ett sidbyte (lobbyn → matchsidan → lagsidan) som hinner ansluta inom nåden blir därför inget avbrott alls och kostar ingen budget. Tar bytet längre (långsam enhet eller nät; i L20:s helflödesprov med tio webbläsare på två kärnor 3,7–5,5 s) blir det ett kort avbrott, och tiden från stängningen dras från budgeten. Undantaget är när spelarens löpande turklocka går ut före nådens slut: då registreras avbrottet direkt vid stängningen och den kvarvarande turtiden sparas. Stängs strömmen 1 s före turtidens slut får spelaren alltså sin frist och behåller sekunden. En omladdning så nära slutet syns som ett kort avbrott och kostar sin faktiska tid i budgeten. Ett tyst avbrott registreras direkt, eftersom det redan tagit 15 sekunder att upptäcka.
- **Generation:** varje ny ström ökar sessionens `connectionGeneration`. Ett avbrott gäller bara den generation det upptäcktes för; en sen stängning av en gammal ström (en ny flik har tagit över, eller sidan laddats om) markerar ingenting.
- **Avbrott i matchen:** för en levande deltagare i en pågående match registreras i matchens kö `avbrott {spelare: {id, generation, start, deadline}}` med frist min(30 s, 90 s − förbrukad budget). Samma avbrott ger ingen ny frist. Bara den frånkopplades turklocka pausas (`deadline: null`, `kvar`); övrigas klockor går vidare och de kan göra alla val som inte kräver den frånkopplade. I gemensamma val (byte, start, Fortsätt) väntar nästa fas bara på saknade svar.
- **Återkomst:** en ny ström är en återkomst, i tid om mottagningstiden är mindre än fristens deadline. Den som kommer tillbaka eller skickar ett drag efter sin frist får aldrig spela vidare, inte ens medan avgörandet väntar på andra ("Du kom inte tillbaka i tid efter avbrottet."). En turklocka som redan gått ut pausas inte av ett senare avbrott; den tidsgränsen gäller. Den faktiska väntetiden dras från budgeten (`avbrottsbudget`) en gång, och turklockan återupptas med sparad tid. Ett val som blev aktuellt under avbrottet får sina 90 sekunder från återkomsten. Strömmen skickar direkt aktuell privat vy; en ny flik eller anslutning ger varken ny turtid eller ny budget.
- **Utgång:** alla vars frist eller turklocka gått ut slås ut i en och samma händelse, i lagmatchen med orsak `AVBROTT` respektive `TIDSGRÄNS`. I duellen förlorar den frånkopplade med `endReason: AVBROTT`. Är alla levande utanför den gruppen frånkopplade väntar avgörandet in deras frister. Kommer någon tillbaka avgörs det då; går alla ut avbryts matchen utan vinnare. Återkomst efter egen deadline ger aldrig tillbaka platsen.
- **Vy och händelser:** `disconnects {spelare: deadline}` (i duellen per plats) är offentligt. `players[].connection` är `FRÅNKOPPLAD` under ett avbrott, och en pausad turklocka saknas i `clocks`. Händelserna `AVBROTT {playerId, deadline}` och `ÅTERANSLUTEN {playerId}` ändrar inte `revision`.
- **Sidorna:** tornet för en frånkopplad visar "Frånkopplad · ⏳ 0:24". När just hens val behövs säger bordet "Väntar på att … återansluter", också i gemensamma val som byten och Fortsätt; duellen visar motståndarens återstående tid vid motståndarens torn. Den egna anslutningen visas i sidhuvudet ("Återansluter …"). Medan strömmen är borta skickas inga nya drag; efter återkomsten kommer aktuell vy innan något kan väljas.

## Serveromstart (från L18)

En serveromstart ger ingen falsk vinst och ingen återupplivad match (27B, huvudplan §11). Ingen 60-sekunders återkomstfrist, ingen återupptagning och inga budgetavdrag eller individuella förluster för serverfelet.

- **Uppstädning före första begäran:** servern tar porten först och städar sedan, synkront i `listening` (`forbered()` i `online/server.js`). Ingen begäran hanteras innan städningen är sparad. Sessionerna markeras frånkopplade, rummens timers återställs och varje match med status PÅGÅR avbryts i en egen transaktion (`matcher.avbrytEfterOmstart()`):
  - Status **AVBRUTEN**, `phase: AVSLUTAD` och ingen vinnare (`winner: null` i duellen, `winnerTeam: null` i lagmatchen). `endReason: SERVERAVBROTT`, revision + 1 och en loggrad.
  - Motorerna gör avslutet (`serveravbrott` i `match.js` och `lagmatch.js`). Kort på bordet slängs, och undanlagda startbyteskort går till slänghögen i duellen och tillbaka till draghögen i lagmatchen, som vid ett vanligt slut. Kortbokföringen stämmer alltså. Liv, händer och utslagningar står kvar. Är bokföringen redan trasig lämnas korten där de låg, men matchen avslutas ändå.
  - Matchen får händelserna `MATCHSLUT {winner|winnerTeam: null, endReason: SERVERAVBROTT}` och `LOGG`. Klockor, avbrott och väntande bekräftelser töms.
  - Rummet stängs och deltagarnas sessioner blir `FÖLJER_AVSLUT`. Därifrån går de till lobbyn med Lämna, som efter ett vanligt matchslut.
  - Varningen i loggen är `[server] servern startades om: N pågående match(er) avbröts utan vinnare (SERVERAVBROTT).`.
- **En gång per match:** statusen prövas inne i transaktionen. En match som redan är AVBRUTEN eller AVSLUTAD rörs aldrig. Dör processen mitt i uppstädningen städar nästa start bara resten, och varje match får exakt en `MATCHSLUT`. Sparade slutresultat och hela kvittenshistoriken finns kvar. Ett känt `commandId` ger samma kvittens som förut men utförs inte igen, och nya drag avvisas med "Matchen avbröts. Gå till lobbyn.".
- **Startfel:** är porten upptagen startar servern inte och rör ingenting. En andra instans på samma port kan därför inte avbryta en körande servers matcher. Misslyckas uppstädningen avvisas `klar` med `Uppstädningen efter omstart misslyckades – servern startar inte: …` (ursprungsfelet i `cause`). Porten stängs då innan någon begäran hanterats, och processen avslutas med kod 1. Det som redan sparats står kvar; inget svar eller kvitto låtsas att resten är gjort.
  - Två instanser på olika portar med samma datakatalog skyddas inte. Det hör till driften (L21).
- **Startspärren från L02 är borttagen.** `matchtrafik` är alltid öppen efter en lyckad start. Strömbrytaren finns kvar i tjänsten men stängs inte av någon kod i dag. Stängd avvisar den matchkommandon och STARTA med sin orsak, men inte lobbyn.
- **Underhållsläge (L21).** `tjanst.nyaMatcher` stänger bara STARTA: startkontrollen får orsaken som enda skäl (så att lobbyn visar den på startknappen), STARTA avvisas med samma orsak, och pågående matcher och alla lobbykommandon fortsätter. Läget syns i `halsa` (även i strömmens hälsning) och är inte beständigt. Klienten jämför `halsa.protocolVersion` med sin egen: skiljer de sig visar lobbyn "Spelet har uppdaterats – Ladda om" och slutar skicka kommandon, och matchsidan visar ett besked utan att ladda om själv (huvudplan §11).
- **Sidorna:** sidan ansluter igen av sig själv och får den avbrutna matchens vy. Resultatrutan har rubriken SERVERAVBROTT, titeln "Matchen avbröts" och ett neutralt emblem (`data-outcome="aborted"`).
  - Texten är "Matchen avbröts på grund av ett serveravbrott. Ingen vann.". I lagmatchen står även "Gå till lobbyn för att ordna en ny match.", och den sista striden visas inte, eftersom dess förluster kom före avbrottet.
  - Knappen är Till lobbyn. Ingen förlusttext eller förlustljud.

## Ljud, animationer och besked (från L19)

Återkopplingen kommer ur serverns bekräftade händelser, inte ur vyns läge (`ljud.js`). Samma vägar används lokalt mot datorn, där händelserna kommer från den lokala adaptern.

- **Högst en gång per händelse:** sidan håller en händelsevakt (`skapaHandelsevakt`) som släpper igenom varje händelse en gång, i stigande `eventId` per match. Samma händelse via strömmen och via en hämtning ger alltså en effekt.
- **Historik är tyst:** det som fanns när sidan laddades är historik, och det som hämtas efter en (åter)anslutning eller medan strömmen är borta likaså. `onlinematch.js` levererar sådana vyer utan händelser, så inget ljud spelas, inga torn skakar och inga hjärtan brister. Utdelningsljudet spelas en gång per match och flik (sessionStorage), även över omladdningar.
- **Direkta ljud** (`handelseljud`): `KORT_SPELAT` ger kortljud plus anfall, magi eller försvar (enkel attack låter som anfall). `BYTE` med kort och `PÅFYLLNING` ger blandning.
- **Resultatljud** (`resultatljud`, spelas när resultatrutan öppnas):
  - `MATCHSLUT` går före allt annat: det egna laget vann → `matchWon`, det andra laget vann → `matchLost`, ingen vinnare (t.ex. serveravbrott) → inget.
  - Annars gäller `RESULTAT`. Egen livsförlust ger `lifeLost`. Har det egna laget vunnit striden ges `battleWon`, även till lagkamrater som inte spelade. En avbruten strid (måltavlan lämnade) ger inget.
  - En lagkamrats utslagning eller avhopp ger aldrig något ljud. Lagets förlust hörs först när servern meddelar matchslut.
- **Animationer:** skakande torn, glöd och brustna hjärtan visas bara för ett resultat som kom som ny händelse. Hjärtana brister strax efter händelsen (0,9 s). Lagets torn uppdateras på plats i fast platsordning: text, attribut och ändrade delar justeras utan att befintliga hjärtan flyttas eller ersätts. Varken den egna kvittensen, en snabb Fortsätt-bekräftelse eller ändrad anslutningsstatus startar därför om hjärtanimationen. Duellens hjärtan skrivs bara om när de ändrats. En ny strid nollställer läget, och ett senare matchslut utan ny strid (t.ex. Ge upp) animerar alltså inte den gamla striden igen. Bytets kortflygning startas av en ny `BYTE`-händelse för det egna väntande bytet, med rätt match, spelare och revision. Kortkopiorna förbrukas vid händelsen och släpps vid statuskontroll, anslutningsavbrott eller avslutat kommando. Kvittensen startar aldrig en animation, även om dess revision fortfarande är aktuell. Animationer avgör aldrig regler eller tider.
- **Besked:** i lagmatchen ger en annan spelares utslagning utanför en strid ett besked om vem och varför: "Cy lämnade matchen.", "… är utslagen – tiden tog slut." eller "… är utslagen – kom inte tillbaka i tid.". Den egna utslagningen visas i knappraden.
  - Startspelaren visas i duellens startruta och i lagmatchens start- och målvalstext.
  - Anslutningsväntan (L17), tidsvarning (L16) och serveravbrott (L18) visas som tidigare.
- **För prov:** `GameAudio.playEffect` skickar fönsterhändelsen `tornstriden:ljud` med ljudets namn för varje begärt effektljud, även när ljudet är avstängt.
