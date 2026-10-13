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
Match: dagens `ACTION` (`BEKRÄFTA_BYTE, SPELA_ATTACK, SPELA_FÖRSVAR, AVSTÅ_FÖRSVAR, FORTSÄTT, GE_UPP`) samt reserverade `VÄLJ_MÅL` och `BEKRÄFTA_START` för lagmatchen.

## Adaptergräns (L07/L09)

Matchvyn pratar bara med ett objekt som klarar `assertAdapter()`: `mode` (LOKAL/ONLINE), `viewer()`, `view()`, `send(command)`, `status(commandId)`, `subscribe(listener)`. `LokalMatch` kör `match.js`/`dator.js` i webbläsaren, `OnlineMatch` skickar kommandon och tar emot privata vyer. Duell/lag skiljs av `rulesVersion` i vyn.

## Teststöd

`styrdKlocka()` (now/setTimeout/clearTimeout/advance/pending), `styrdSlump(frö)` (ersätter `Math.random`), `testSessioner(n)` (separata identiteter med token och sessionsobjekt åtskilda) och `samlare()`. Testhashen `test-…` är inte serverns riktiga tokenhash (väljs i L03).

## HTTP-gränssnitt (online/server.js, från L02–L03)

Alla svar är JSON utom händelseströmmen. Skrivande anrop (POST/DELETE) kräver `Origin` = egen host eller ett värde i `TORNSTRIDEN_ORIGINS`, annars 403. Sessionen ligger i kakan `tornstriden_session` (HttpOnly, SameSite=Lax, Secure bakom HTTPS); utan giltig kaka svarar skyddade adresser 401.

| Adress | Utan session | Gör |
| --- | --- | --- |
| `GET /api/halsa` | ja | `{tjanst, protocolVersion, schemaversion, matchtrafik{oppen, orsak}, tid}` |
| `POST /api/session` `{nick}` | ja | skapar gästsession (201 + kaka) eller återupptar befintlig (200); 409 vid upptaget nick, 400 vid ogiltigt |
| `GET /api/session` (200 med `{me: null}` utan session), `GET /api/lobby` | nej | `{me, players[], rum, start, inbjudningar{inkommande[], utgaende[]}}` – offentliga sessioner, eget rum (eller null), startstatus för rummet (`{kanStarta, skal[], antal{A,B}, format, tillganglig, tillgangligaFormat[]}`, null utanför förberedelse) och öppna inbjudningar |
| `DELETE /api/session` | – | lämnar lobbyn (bara när LEDIG), raderar kakan |
| `GET /api/handelser` | nej | SSE: `halsa`, därefter `lobby` (samma innehåll som `/api/lobby`) vid varje ändring i lobby, rum eller inbjudningar, `ersatt` om en annan flik tar över, `: puls` var 25 s |
| `POST /api/kommando` | nej | ett kommando enligt kontraktet → kvittens; 400 vid kontraktsfel |
| `GET /api/status?commandId=…&scope=…` | nej | kvittens eller OKÄND (scope default `spelare:<id>`; matchkommandon har scope `match:<matchId>`) |
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
- SSE: efter varje godkänt kommando får varje deltagare med en ström händelsen `match` med `{view, events, status}` där `events` är händelserna sedan strömmens senaste `lastEventId`; vid öppnad ström skickas aktuell vy med tom händelselista.
- Matchslut: matchen sparas AVSLUTAD, rummet STÄNGD och deltagarna FÖLJER_AVSLUT tills de skickar `LÄMNA` (rummets id) och blir LEDIG igen.

## Onlineadaptern i webbläsaren (från L09)

`onlinematch.js` exporterar `skapaOnlineMatch({ initial })` med samma sex metoder som LokalMatch och ingen `local`. `match.html?online=1` hämtar `/api/match`, öppnar strömmen och väljer onlineadaptern; utan match skickas man till `lobby.html`. Lobbyn navigerar automatiskt till matchsidan när `me.activity` blir SPELAR.

- `send()` sätter `pending {commandId, status: SKICKAR}` i vyn tills kvittensen kommit. Uteblir svaret frågas `/api/status` (status KONTROLLERAR) upp till fem gånger med växande paus; en känd kvittens används, OKÄND med oförändrad revision ger en omsändning av samma kommando, OKÄND med ändrad revision ger ”Matchläget har ändrats – välj igen”. 401 skickar till lobbyn, 400 visas som avvisning.
- `receive()` tar bara emot vyer med minst lika högt `lastEventId`/`revision` och levererar bara händelser med högre `eventId` än senast sedda – en gammal vy eller kvittens skriver aldrig över nyare läge.
- Egen plats visas alltid nederst (zon A på bordet) och motståndaren överst; namnen är nick. Startmeddelandet och resultatrutan skickar BEKRÄFTA_START respektive FORTSÄTT och visar ”Väntar på …” tills motståndaren bekräftat. ”Till lobbyn” skickar LÄMNA för det stängda rummet och går till `lobby.html`.
- Lokalt datorläge (`match.html` utan `?online`) är oförändrat; lägesväljaren och datorstrategin döljs online.
