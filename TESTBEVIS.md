# Testbevis före publik lansering (L20)

Varje kontrollpunkt i huvudplanen §13 ([implementera lobby.md](<implementera lobby.md>)) är här kopplad till de prov som visar den. Uppställningen gäller arbetskatalogen 2026-10-15, med rättningarna efter användarens granskning 2026-10-16, och följer på L00–L19.

**Så läses tabellen:**
- **Enhetsprov** anges som `fil: provets namn` och körs med `npm test`.
- **Webbläsar- och processprov** anges som `scripts/…` och körs ett i taget, enligt kommentaren överst i varje skript.
- **Status:** ✅ verifierad i L20 · ◐ delvis, där det som återstår anges · ⏭ hör till L21/L22.

## Körningar i L20

Allt kördes i molnmiljön (2 kärnor, Node 22, Chromium via Playwright), ett prov i taget, på arbetskatalogen med L19-rättningarna från användarens dator inlästa.

| Prov | Resultat | Anmärkning |
| --- | --- | --- |
| `npm test` | 275/275 (2026-10-16) | 274/274 också på användarens dator den 15:e |
| `scripts/prova-helflode.mjs --omgang 1` (duell + 8) | 13/13, 22 min | Före rättningen av duellbordets glöd |
| `scripts/prova-helflode.mjs --omgang 2` (4 + 6) | 12/12, 11 min | |
| `scripts/prova-belastning.mjs` (10 × 8) | 36/36 (2026-10-16) | Före serverrättningen 30/33; provet skärptes efter granskningen, se nedan |
| `scripts/prova-match.mjs` | 13/13 i 8 av 8 körningar | Före glödrättningen föll 6 av 9 |
| `scripts/prova-online.mjs` | 9/9 | |
| `scripts/prova-regressioner.mjs` | 5/5 | |
| `scripts/prova-lobby.mjs` | 24/24 | |
| `scripts/prova-lag.mjs 4` / `6` / `8` | 15/15, 18/18, 18/18 | |
| `scripts/prova-klockor.mjs` | 26/26 | |
| `scripts/prova-avbrott.mjs` | 21/21 | |
| `scripts/prova-omstart.mjs` | 15/15 | |
| `scripts/prova-aterkoppling.mjs` | 30/30 i 2 av 5 körningar, annars 29/30 | Se kvarvarande punkt 7 |

I helflödesproven slogs ingen ut på tid, och inget val dröjde mer än halva turtiden. De enda utslagningarna var på liv och den avsiktligt stängda webbläsaren.

### Lokal omkontroll efter granskningen, 2026-10-16

På användarens Mac med Node 26.3.1 passerade `npm test` **275/275** och `scripts/prova-belastning.mjs` **36/36** med tio matcher och 80 anslutningar. Alla 3 784 uppmätta godkända drag levererades, inget utskick saknades och alla anslutna fick sista händelsen. Matchkommandon hade p95 12 ms och max 25 ms; utskick p95 13 ms och max 25 ms. Minnesmätningen med `ps` gav 284 mätvärden utan fel, högst 194 MB (gräns 300 MB).

Inbjudan med ett extra `matchId` kontrollerades också separat: mottagaren fick den direkt över strömmen. Riktade kontroller av mätlogiken visade att gammalt händelse-ID inte godtas som leverans, en saknad mottagare lämnar utskicket väntande och utebliven eller felande minnesmätning underkänns. Dessa lokala prov ersätter inte kapacitetsprov på NAS:en eller prov på fysiska telefoner i L21/L22.

## Kontrollpunkter i §13

| # | Kontrollpunkt (§13, förkortad) | Bevis | Status |
| --- | --- | --- | --- |
| 1 | Duelltester, datorläge, ljud, långtryck och mobilvy fungerar | `match.test.js`, `strid.test.js`, `dator.test.js`, `matchregler.test.js` (alla prov); `ljud.test.js`; `scripts/prova-match.mjs` (datorläge och två spelare, långtryck; stabilt efter rättningen av bordets glöd i L20, se nedan); `scripts/prova-aterkoppling.mjs` (ljudinställningar, långtryck, lokalt mot datorn); `scripts/prova-lag.mjs` (mobilavstånd); `scripts/prova-helflode.mjs` (varannan deltagare som mobil) | ✅ |
| 2 | Nick med å/ä/ö, dubbletter, för lång text och HTML-liknande innehåll | `kontrakt.test.js: Nick trimmas, kontrolltecken avvisas …` (ÅSA = åsa, 21 tecken avvisas); `online/session.test.js: Nickkrock …`; `online/server.test.js: HTML-liknande nick lagras som text …`; `scripts/prova-lobby.mjs` (upptaget nick, HTML-nick som text); `scripts/prova-regressioner.mjs` (HTML-nick i matchvyn) | ✅ |
| 3 | Flera accepteranden till samma rum; första acceptansen återkallar inte övrigas | `online/rum.test.js: 1B: första acceptansen lämnar övrigas inbjudningar öppna …`; `scripts/prova-lobby.mjs` ("Cys inbjudan är kvar efter att Bo accepterat"); `scripts/prova-helflode.mjs` och `scripts/prova-belastning.mjs` (upp till sju accepterar samma rum) | ✅ |
| 4 | Två rum accepterade ger högst ett; obesvarad inbjudan låser ingen | `online/rum.test.js: Samtidig acceptans av två rum ger exakt ett medlemskap …`, `… Avböja, återkalla och utgång via klockan …` | ✅ |
| 5 | Start bara för 2/4/6/8, jämna lag, alla redo; ingen gammal laguppställning | `online/start.test.js: Startkontroll ger begripliga skäl …`, `… Start: bara värden, aktuell rosterVersion …`; `scripts/prova-lobby.mjs` ("ojämna lag förklaras") | ✅ |
| 6 | Samtidigt lagbyte, sent accepterande och Starta ger en konsekvent lista | `online/start.test.js: Start och sen acceptans kan inte ge olika deltagarlistor`; `online/tjanst.test.js: Två samtidiga kommandon …` | ✅ |
| 7 | 25A: värdens avhopp, tomma rum, värden vanlig spelare efter start | `online/start.test.js: 25A: värdavhopp …`; `online/rum.test.js: Lämna: … värdskap går till längst anslutna, tomt rum stängs`; `scripts/prova-lobby.mjs` (25A) | ✅ |
| 8 | Råa nätverkssvar har bara egen hand och offentlig information | `scripts/prova-belastning.mjs` (80 klienter: varje svar och strömhändelse mot hemlighetsregeln och mot de andras händer vid samma revision); `online/server.test.js: Lagmatch över HTTP …`; `online/lagspel.test.js: … vyerna läcker inga kort`; `scripts/prova-helflode.mjs`, `scripts/prova-online.mjs`, `scripts/prova-lag.mjs` (sidornas svar) | ✅ |
| 9 | Fel identitet, främmande match/kort, fel tur, falskt teamId, gammal revision avvisas | `online/duell.test.js: Fel tur, främmande kort och påstådd identitet avvisas …`; `online/lagspel.test.js: Identitet och lag kommer från sessionen …`; `match.test.js: Gammal revision, fel match-ID …`; `kontrakt.test.js: Kommando: klienten får inte påstå identitet …`; `scripts/prova-belastning.mjs` (missbruksdelen) | ✅ |
| 10 | Tappad kvittens och dubbelt commandId ger inte två drag; ändrat innehåll avvisas | `online/tjanst.test.js: Godkänt kommando … samma commandId ger samma kvittens en gång`; `online/duell.test.js: Samma kommando får effekt en gång …`; `onlinematch.test.js: Tappad kvittens …` (tre prov); `online/avbrott.test.js: Tappad kvittens …`; `online/omstart.test.js: SIGKILL under sparande …`; `scripts/prova-belastning.mjs` | ✅ |
| 11 | Animationer och ljud spelas en gång och inte vid återanslutning | `ljud.test.js` (L19-proven); `onlinematch.test.js: L19: historik efter (åter)anslutning …`; `scripts/prova-aterkoppling.mjs` (24 kontroller) | ✅ |
| 12 | Fulla matcher för 2/4/6/8; leken räcker till maximala startbyten; bokföringen stämmer | `lagkortlek.test.js: Maximala startbyten för 4/6/8 …`, `… Slumpad långkörning …`; `lagmatch.test.js: Hela lagmatcher 4/6/8 …`; `online/duell.test.js: En hel duell …`; `scripts/prova-helflode.mjs` (2/4/6/8 via gränssnittet); `scripts/prova-belastning.mjs` | ✅ |
| 13 | Specialkort i lagstrid: mål, ordning, hjälp, samtidiga effekter | `lagstrid.test.js` (23 prov, bl.a. räkneexemplen och slumpade strider); `lagmatch.test.js: Mål vid försvar …`; `scripts/prova-lag.mjs` (kortmål och spelarmål via gränssnittet) | ✅ |
| 14 | 14A/15A hjälpares försvarsspecial, Helande ljus läker hjälparen | `lagstrid.test.js: 14A/15A …` | ✅ |
| 15 | 16A Törnesköld | `lagstrid.test.js: 16A …`, `… två Törnesköldar mot samma spelare …` | ✅ |
| 16 | 17A inget omval vid borttaget mål | `lagavhopp.test.js: 17A …`; `lagstrid.test.js: … Spegelskölds valda magiska kort tas bort …` | ✅ |
| 17 | 18A summering per kort, stopp och 0-golv | `lagstrid.test.js: Exempel: två Stormning mot två Isrustningar …`, `… två Sprängladdningar …`, `… avdrag och motstötar går aldrig under 0`, `Frost är inget stopp …` | ✅ |
| 18 | 19A Spegelsköld före frost | `lagstrid.test.js: Exempel: Drakeld + Stormning mot Spegelsköld …`, `19A/20A …` | ✅ |
| 19 | 20A Drakeld mot blått försvar | `lagstrid.test.js: … två blå kort ger fortfarande bara +2`, `19A/20A …` | ✅ |
| 20 | 21A roterande målansvar och ordning | `lagmatch.test.js: Efter striden: … målansvaret roterar (21A)`, `… Anfallskö …`, `… Försvarskö …`; `lagmatch.test.js: En motstöt kan slå ut en anfallare …` | ✅ |
| 21 | 22A påfyllning av tomma händer | `lagkortlek.test.js: 22A …` (två prov) | ✅ |
| 22 | 23A enkel attack | `lagregler.test.js: 23A …`; `lagstrid.test.js: 23A …` | ✅ |
| 23 | 24B tomt anfall räknas försvarat; motstöt flyttas inte | `lagstrid.test.js: 24B …`; `lagavhopp.test.js: 24B: anfallaren lämnar under försvaret …` | ✅ |
| 24 | 24B går inte före matchslut eller 13A | `lagavhopp.test.js: Avhopp under anfallet: försvinner lagets enda kort …`, `Sista lagmedlemmen lämnar: matchslut prövas före 13A …` | ✅ |
| 25 | Räkneexemplen; liv ändras en gång; samtidiga motstötar | `lagstrid.test.js: Exempel: …` (8 prov); `lagstrid.test.js: Slumpade lagstrider …` | ✅ |
| 26 | Lämna, tidsutslagning och noll liv tar bort bara den spelaren; 1 mot 4 | `lagavhopp.test.js: Avhopp vid målval: … 1 mot 4 kan fortsätta (8A)`; `online/klockor.test.js` (tidsutslagning); `lagmatch.test.js: Livsbaserad utslagning …`; `scripts/prova-belastning.mjs` (två matcher 1 mot 4); `scripts/prova-helflode.mjs` (2 mot 3 efter stängd webbläsare); `scripts/prova-lag.mjs` (lämnare i 6 och 8) | ✅ |
| 27 | Utslagning i varje fas lämnar inga blockerade köer | `lagavhopp.test.js` (avhopp under byte, start, målval, anfall, försvar, resultat; slumpade hela matcher); `online/klockor.test.js: … den utslagna blockerar aldrig Fortsätt` | ✅ |
| 28 | 12B borttaget bidrag | `lagavhopp.test.js: Avhopp under anfallet: … attacken räknas om (3 + 2 → 2)`, `Avhopp under försvaret …`, `Avhopp i resultatläget: sparat resultat ändras inte …` | ✅ |
| 29 | 13A måltavlans avhopp | `lagavhopp.test.js: 13A …` (två prov); `lagstrid.test.js: 13A och matchslut …` | ✅ |
| 30 | Effekter räknas om från kvarvarande kort | `lagavhopp.test.js` (17A, 24B, 12B); `lagstrid.test.js: Stopp: … borttaget stoppkort återställer` | ✅ |
| 31 | Flikstängning, omladdning, hårt avslutad webbläsare, flygplansläge och dubbla flikar | `scripts/prova-helflode.mjs` (offline 25 s, hårt stängd webbläsare, omladdning, andra flik); `scripts/prova-avbrott.mjs` (stängd flik, omladdning, tyst avbrott); `online/server.test.js: Avbrott över HTTP …` (två prov); `scripts/prova-lobby.mjs` (extra flik) | ✅ |
| 32 | Avbrottsbudget 30/90 en gång; serverfel kostar ingen budget | `online/avbrott.test.js` (budget, sista resten, en debitering); `online/server.test.js: … omstart avbryter pågående matcher …` (inga liv eller budget) | ✅ |
| 33 | 26B övriga agerar under avbrott; bara nödvändigt val blockerar | `online/avbrott.test.js: Lagmatch: andra byter vidare under ett avbrott …`; `scripts/prova-avbrott.mjs`; `scripts/prova-belastning.mjs` (strömavbrott och tyst avbrott under belastning) | ✅ |
| 34 | 26B turtid bevaras, fristen startar inte om | `online/avbrott.test.js: Duell: fristen startar inte om …`, `Nåden för en stängd ström …`; `online/server.test.js: … strax före turtidens slut …` | ✅ |
| 35 | 26B given Fortsätt gäller; liv kan ändras; återkomst får aktuell vy | `online/avbrott.test.js: Lagmatch: liv ändras under avbrottet, Fortsätt väntar …` | ✅ |
| 36 | Flera/alla frånkopplade, samtidigt utslagna sista | `online/avbrott.test.js: Alla frånkopplade …`; `online/klockor.test.js: … går de sista spelarna i båda lagen ut samtidigt …`; `lagavhopp.test.js: slaUt: flera samtidigt …` | ✅ |
| 37 | Tidstabellens gränsfall; gammal timer och anslutningsgeneration | `online/klockor.test.js` (deadline − 1 ms, exakt deadline, försenad timer); `online/avbrott.test.js` (fristens slut, köad timer); `online/session.test.js: Anslutningsgeneration …` | ✅ |
| 38 | Samtidiga Fortsätt och utslagning startar nästa strid en gång | `online/duell.test.js: Två samtidiga Fortsätt …`; `lagavhopp.test.js: Avhopp i resultatläget …`; `online/lagspel.test.js: Samtidiga val …` | ✅ |
| 39 | Parallella matcher läcker inget | `online/lagspel.test.js: Samtidiga matcher läcker varken kort eller händelser …`; `scripts/prova-belastning.mjs` (tio matcher: inga kort, vyer eller händelser från en annan match) | ✅ |
| 40 | 27B serveromstart | `online/omstart.test.js: SIGKILL mitt i en duell …`; `online/server.test.js: … omstart avbryter pågående matcher …`; `scripts/prova-omstart.mjs` | ✅ |
| 41 | Upprepad omstart under uppstädning; inga dubbla sluthändelser; databasfel | `online/omstart.test.js: SIGKILL under uppstädningen …`, `SIGKILL under sparande …`; `online/server.test.js: Lagringsfel under uppstädningen …` | ✅ |
| 42 | Verklig deploykopia: versionsstämplar, HTTPS, gammal klient, underhållsläge | `klientfiler.test.js` (lobby och lagmatch i deploy.sh, inga serverfiler); `scripts/kontrollera-publicering.mjs --servera` mot en separat kopia från `deploy.sh` (88 filer, alla referenser stämplade, sidorna hämtade över HTTP); `online/server.test.js: Underhållsläge (L21) …` (STARTA avvisas med skäl, pågående match och lobby fortsätter, hälsningen växlar); webbläsarprov L21 (underhållsbesked i lobbyn, spärrad startknapp, gammal klient får dialogen Ladda om); `online/server.test.js: Bakom HTTPS-proxyn …` (kakan Secure). Riktig HTTPS/Apache-proxy på NAS:en verifierad i L22 (halsa, lobby 200, ström 401 utan session, hel duell mellan två webbläsare, planerad uppdatering med `uppdatera.sh`) | ✅ |
| 43 | Provspela på olika enheter/nät med mobil och åtta deltagare; fastställ kapacitetsmål | Kapacitetsmålet och mätningen nedan; `scripts/prova-helflode.mjs` (åtta deltagare, mobilemulering, offline). **På NAS:en (L22):** `prova-belastning.mjs` 36/36, 133 MB, CPU medel 40 %, 0 serverfel, 0 oväntade strömslut. Riktiga telefoner och lagmatch i drift återstår för provspel med människor | ◐ |

## Kapacitet

**Mål** (arbetsordningen, beslutsraden för L20–L22): 10 samtidiga matcher med upp till 80 anslutningar.

**Godkänt när:**
- alla tio matcher spelas till slut och alla kommer tillbaka till lobbyn;
- matchkommandon har svarstid p95 ≤ 250 ms och max ≤ 2 s;
- händelsen från varje godkänt drag når alla anslutna i matchen inom p95 ≤ 500 ms och max ≤ 2 s, räknat på händelse-ID ur kvittensen (en bekräftelse ändrar händelse-ID men inte revision);
- inget utskick väntar kvar när matchen är slut, alla anslutna har fått matchens sista händelse, och en bekräftelse når båda strömmarna i en duell utan att något annat drag behövs;
- serverns minne är ≤ 300 MB, mätt ur `/proc` på Linux och med `ps` på andra system (macOS). Saknas mätvärden blir kontrollen "ej verifierat" och provet faller;
- inga 5xx, inga strömmar som servern stänger utan orsak och inga läckor.

Gränserna är valda för en NAS med marginal mot vad en spelare märker.

**Mätning:** `scripts/prova-belastning.mjs` mot en riktig serverprocess.
- Miljö: molnmiljön med 2 kärnor, där servern och alla 80 testklienter delade på kärnorna.
- Varje klient har egen kaka och egen SSE-ström, svarar på ping och väljer efter 150–600 ms betänketid.
- Två matcher spelades 1 mot 4. En spelare tappade strömmen i 6 s och en slutade svara på ping i 24 s.

| Mått | Före rättningen i L20 | Efter | Slutkörningen | Efter granskningen 16/10 |
| --- | --- | --- | --- | --- |
| Rummen ordnade (340 lobbykommandon på en gång) | 23,6 s | 9,5 s | 6,7 s | 5,4 s |
| Lobbykommandon p50 / p95 / max | – | – | 558 / 3 116 / 3 511 ms | 197 / 2 398 / 3 673 ms |
| Matchkommandon p50 / p95 / max | 470 / 1 752 / 14 571 ms | 18 / 105 / 778 ms | 16 / 101 / 1 120 ms | 10 / 51 / 363 ms |
| Ny vy till hela matchen p50 / p95 / max | 503 / 2 053 / 14 581 ms | 23 / 109 / 791 ms | 21 / 106 / 1 120 ms | 13 / 52 / 366 ms (per händelse-ID; 3 673 av 3 673 levererade, 0 saknade) |
| Svar på ping max | 16,1 s | 2,2 s | 2,0 s | 1,7 s |
| Strömmar som servern stängde utan orsak | 58 (spelarna räknades som frånkopplade, 14 slogs ut) | 0 | 0 | 0 |
| Serverns CPU medel / max | 89 / 112 % | 39 / 108 % | 36 / 106 % | 29 / 102 % |
| Serverns minne max | 153 MB | 125 MB | 134 MB | 137 MB (253 mätprov) |
| Kommandon totalt | – | 340 lobby, 4 139 match, 0 serverfel | 340 lobby, 3 648 match, 0 serverfel | 340 lobby, 3 680 match, 0 serverfel |

"Efter" är den första körningen efter rättningen och "Slutkörningen" körningen i den samlade sviten på den slutliga koden; antalet drag skiljer eftersom korten och botarnas val är slumpade. "Efter granskningen" är körningen med det skärpta provet efter rättningarna den 16 oktober; utskicken mäts där per händelse-ID och inte per revision.

**Felet som mätningen hittade:**
- Varje godkänt matchdrag skickade hela lobbyn till alla 80 strömmar, med en egen databastransaktion per spelare. Dessutom byggdes en matchvy för varje ström, också för spelare i andra matcher.
- Vid målet blev servern så upptagen att svaren på ping dröjde över 15 s. Servern stängde då strömmar för spelare som var anslutna. Avbrottshanteringen slog till fel: frister, budgetavdrag och utslagningar.

**Rättningen** (`online/server.js`, `online/rum.js`):
- Ett matchdrag skickar bara matchens strömmar, och bara till dem som saknar senaste händelsen. Lobbyn skickas bara om lobbylistan ändrats, t.ex. vid matchslut, avhopp eller avbrott.
- Alla lobbyvyer byggs i en transaktion, och en ström får bara en lobbyvy som skiljer sig från den förra.
- `online/server.test.js: Utskick (L20) …` faller mot koden före rättningen.

**Begränsningar:**
- Mätningen är gjord i molnmiljön, inte på NAS:en. Där ska den göras om (L21/L22), med samma skript.
- Lobbykommandon i en extrem skur (340 på några sekunder) har p95 3–4 s, eftersom varje lobbyändring fortfarande ger en lobbyvy per ström. Verkliga spelare sprider sina klick över minuter. Blir lobbyn trög på NAS:en är nästa steg att slå ihop utskick som sker tätt efter varandra.

## Rättat i L20

- **Servern skickade för mycket vid varje drag** (se Kapacitet): rättat i `online/server.js` och `online/rum.js`.
- **Duellbordet kunde bli oklickbart.** `prova-match.mjs` föll sedan L15 i ungefär två av tre körningar, i L20 sex av nio: klicket på "Enkel attack 1" träffade `.game-view` i stället för knappen. Webbläsarens eget träffprov (`elementsFromPoint`) missade hela bordet, också efter väntan, musrörelse och skrollning, tills bordets stil ändrades.
  - Orsak: turbeskedets glöd animerade `box-shadow` på själva bordet (`.table`, som har `overflow: hidden`). Utan den animationen föll provet 0 av 6 gånger.
  - Rättning (`matchvy.js`, `match.html`, `match.css`): glöden ligger i ett eget lager under bordets innehåll (`.table-glow`) som tonas in och ut. Bordet animeras inte längre. Glöden ser likadan ut (jämförda skärmdumpar).
  - Efter rättningen: `prova-match.mjs` 8 av 8 gröna.
  - Felet är sett i Chromium, både i molnet och i användarens Chrome-körning. Att ett manuellt klick påverkades är inte provat, men webbläsarens eget träffprov var fel.
- **Efter användarens granskning 2026-10-16** (tre brister):
  - *Godkända lobbyändringar kunde bli osynliga.* Servern valde utskick efter om klienten skickat med ett `matchId`, inte efter kommandotypen. En inbjudan med ett extra `matchId` godkändes och sparades, men mottagaren fick inget besked. Nu avgör kommandotypen utskicket (`online/server.js`), och likaså kön och kvittensens scope (`online/tjanst.js`). Nytt prov: `online/server.test.js: Utskick (L20): kommandotypen avgör utskicket …`, som faller mot den gamla koden.
  - *Minnesprovet kunde bli falskt godkänt.* Mätningen läste bara `/proc`; på macOS misslyckades den tyst och gav 0 MB, godkänt. Nu används `ps` där `/proc` saknas. Ett misslyckat mätprov räknas, och utan mätvärden blir kontrollen "EJ VERIFIERAT" och provet faller. Provat med `TORNSTRIDEN_MATNING=ps` (godkänt, 78 MB) och `=ingen` (FEL, ej verifierat).
  - *Uteblivna utskick kunde döljas.* Provet mätte bara utskick som kom fram och nycklade på revision. Nu nycklas det på händelse-ID ur kvittensen. Varje godkänt drag räknas som levererat, släppt (alla väntade mottagare lämnade eller tappade strömmen avsiktligt) eller saknat. Saknade utskick och en saknad sista vy fäller provet, och max ≤ 2 s gäller också utskick. En duell prövar dessutom att en bekräftelse når båda strömmarna utan att något annat händer.
  - Två felinjicerade servrar (mutationer) visar skillnaden:

    | Mutation | Gamla provet | Nya provet |
    | --- | --- | --- |
    | A: bekräftelser hålls kvar till nästa händelse | 33/33, godkänt | FEL: bekräftelsen når inte fram inom 1 s; i en liten körning även utskick max 90 s |
    | B: en spelare per match får aldrig sista vyn | FEL bara indirekt (654 avvisade drag från en bot med gammal vy) | FEL: 10 utskick saknas, och 10 spelare saknar matchens sista händelse |
- **Provens egna fel** (inte spelfel):
  - `prova-match.mjs` kunde klicka bordets Fortsätt just när resultatrutan öppnades. Klicket försöker nu i 2 s och tar annars rutans knapp.
  - Den första versionen av `prova-helflode.mjs` lät tre datorspelare slås ut på tid. Boten valde om måltavla eller kort i varje varv, så knappen ritades om och gungade hela tiden. Klickväntan (2,5 s) var också kortare än gungningen. Boten väljer nu en gång och bekräftar i nästa steg, och alla sidor agerar samtidigt. En vakt läser serverns deadline och fäller provet om ett val dröjer mer än halva turtiden.

## Besluten 1–27

| Beslut | Prov |
| --- | --- |
| 1B samma rum för flera inbjudna | `online/rum.test.js: 1B …`; `scripts/prova-lobby.mjs`; `scripts/prova-helflode.mjs`, `scripts/prova-belastning.mjs` (upp till sju accepterar samma rum) |
| 2A återanslutning 30/90 | `online/avbrott.test.js` (13 prov); `scripts/prova-avbrott.mjs`; `scripts/prova-helflode.mjs` (offline 25 s, stängd webbläsare); `scripts/prova-belastning.mjs` |
| 3A 90 sekunder per väntande val | `online/klockor.test.js` (10 prov); `scripts/prova-klockor.mjs`; `online/server.test.js: Onlineduell över HTTP … tidsgräns …` |
| 4A nick utan konto | `online/session.test.js`; `kontrakt.test.js: Nick …`; `scripts/prova-lobby.mjs`; `scripts/prova-helflode.mjs` |
| 5A samma server | `online/server.test.js: Hälsokontrollen …` (klientfiler och API från samma server); `scripts/prova-belastning.mjs` (statisk filåtkomst); driften i L21/L22 |
| 6A 2/4/6/8 deltagare | `online/start.test.js`; `online/lagspel.test.js: Separata testklienter spelar hela matcher 4/6/8 …`; `online/duell.test.js: En hel duell …`; `scripts/prova-helflode.mjs` (2/4/6/8 via gränssnittet) |
| 7B självvalda jämna lag | `online/start.test.js: Lagval …`, `Startkontroll … ojämna lag …`; `scripts/prova-lobby.mjs` |
| 8A individuell utslagning | `lagavhopp.test.js`; `online/klockor.test.js`; `online/avbrott.test.js`; `scripts/prova-belastning.mjs` (1 mot 4); `scripts/prova-helflode.mjs` (2 mot 3) |
| 9B värden startar | `online/start.test.js: Start: bara värden …`; `scripts/prova-helflode.mjs` (värden startar via gränssnittet) |
| 10A lagstrid och hjälp | `lagmatch.test.js`; `lagstrid.test.js`; `scripts/prova-lag.mjs` |
| 11A skalad kortlek | `lagregler.test.js: 11A …`; `lagkortlek.test.js` |
| 12B ta bort avhoppares kort | `lagavhopp.test.js` |
| 13A måltavlans avhopp | `lagavhopp.test.js: 13A …`; `lagstrid.test.js: 13A …` |
| 14A försvarsspecial vid hjälp | `lagstrid.test.js: 14A/15A …` |
| 15A läkning till ägaren | `lagstrid.test.js: 14A/15A …` |
| 16A vald motstötsmottagare | `lagstrid.test.js: 16A …`; `scripts/prova-lag.mjs` (spelarmål) |
| 17A inget omval vid försvunnet mål | `lagavhopp.test.js: 17A …` |
| 18A summera likadana effekter | `lagstrid.test.js` (räkneexemplen) |
| 19A spegling före frost | `lagstrid.test.js: … Spegelsköld …`, `19A/20A …` |
| 20A Drakeld mot valfritt blått försvar | `lagstrid.test.js: 19A/20A …` |
| 21A roterande turordning | `lagmatch.test.js: Efter striden … (21A)` |
| 22A fem kort till tom hand | `lagkortlek.test.js: 22A …` |
| 23A enkel attack | `lagregler.test.js: 23A …`; `lagstrid.test.js: 23A …`; `match.test.js: Enkel attack …` |
| 24B tomt anfall räknas försvarat | `lagstrid.test.js: 24B …`; `lagavhopp.test.js: 24B …` |
| 25A ny värd före start | `online/start.test.js: 25A …`; `online/rum.test.js: Lämna …`; `scripts/prova-lobby.mjs` |
| 26B övriga spelar under avbrott | `online/avbrott.test.js`; `scripts/prova-avbrott.mjs`; `scripts/prova-belastning.mjs` |
| 27B avbryt vid serveromstart | `online/omstart.test.js`; `online/server.test.js` (L18-proven); `scripts/prova-omstart.mjs`; i drift: L21/L22 |

## Kvarvarande fel och begränsningar

1. **Kapaciteten är inte mätt på NAS:en.** Mätningen ovan gjordes i molnmiljön. I L21/L22 körs `node scripts/prova-belastning.mjs` på NAS:en (eller i den avsedda testmiljön) och jämförs med målet.
2. **Riktiga telefoner och nät är inte provade.** Proven emulerar en iPhone 13 och kopplar bort nätet med Playwright. Provspel med riktiga enheter görs av användaren.
3. **Lobbyn är långsam i en extrem skur.** 340 lobbykommandon på några sekunder gav p95 3–4 s (se Kapacitet). Verkliga spelare sprider sina klick.
4. **Ett långsamt sidbyte vid matchstart blir ett kort avbrott.** Nåden för en stängd ström är 3 s (`OMLADDNING_MS`). I helflödesprovet, med tio webbläsare på två kärnor, tog bytet från lobbyn till matchsidan 3,7–5,5 s. Varje deltagare fick då ett AVBROTT som följdes av ÅTERANSLUTEN inom 2,5 s. De andra såg "Frånkopplad" en kort stund, och bytets tid drogs från avbrottsbudgeten (90 s). Spelet påverkades inte. Händer det på riktiga telefoner kan nåden höjas till 5–8 s; det ändrar bara hur snabbt de andra ser ett verkligt avbrott, eftersom fristen redan räknas från stängningen.
5. **Handlingsknapparna ritas om vid varje ny vy.** `matchvy.js` och `lagmatchvy.js` skriver om knappraden vid varje ny vy från servern. En primärknapp i knappraden börjar då om sin korta gungning (2 × 1,4 s), och en knapp med tangentbordsfokus tappar fokus när en annan spelare gör ett drag. Klick fungerar. Testboten i `prova-helflode.mjs` väljer därför en gång och bekräftar i nästa steg, som en människa. Förslag: skriv bara om knappraden när innehållet ändrats, som tornen i L19.
6. **Kontrollpunkt 42 (verklig deploykopia, HTTPS, gammal klient, underhållsläge)** är verifierad: lokalt i L21 (deploykopia, gammal klient, underhållsläge) och på NAS:en i L22 (Apache-proxy med Certbots HTTPS, hel duell mellan två webbläsare, planerad uppdatering). Kapaciteten på NAS:en: 36/36, 133 MB, 0 serverfel.
7. **`prova-aterkoppling.mjs` är tidskänsligt i molnet.** Kontrollen "bekräftelserna kommer inom hjärtanimationens tidsfönster" kräver att två bekräftelser hinner fram inom 900 ms. Den föll i 3 av 5 körningar, men den är en förutsättning för provet, inte ett spelfel. Med servern från före L20 föll den 4 av 4 gånger. Själva beteendet ("snabba Fortsätt startar inte om hjärtanimationen") godkändes i alla körningar. Användarens körning i Chrome gav 30/30.
