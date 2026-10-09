# Tornstriden – webbspel och grafikplan

**Datum:** 7 oktober 2026

**Status:** Ursprunglig plan för webbversionen. Kort, spelbord, bildlager, en komplett lokal duell och läget 1 mot datorn finns nu (byggordningens punkt 1–2). Onlinespel, lagspel och grafikpaketet återstår. Se [utvecklingsplanen](UTVECKLINGSPLAN.md) för aktuell arbetsordning.

**Regelunderlag:** [SPELREGLER.md](SPELREGLER.md)

## Spellägen

| Läge | Deltagare | Hur det fungerar |
| --- | --- | --- |
| 1 mot datorn | En människa och en datorstyrd motståndare | Spelaren kan starta själv utan att bjuda in någon. |
| 1 mot 1 | Två människor | En privat match som den andra spelaren ansluter till med länk eller rumskod. |
| 2 mot 2 | Fyra deltagare | Varje lag har två torn och spelarna kan hjälpa varandra. |
| 3 mot 3 | Sex deltagare | Samma grundregler, med tre torn per lag. |
| 4 mot 4 | Åtta deltagare | Samma grundregler, med fyra torn per lag. |

Förslag till utökning: låt värden fylla lediga platser i lagmatcher med datorstyrda spelare. Då kan en människa exempelvis spela tillsammans med en dator mot två datorer. Varje datorplats ska vara tydligt märkt.

Första leveransen bör innehålla 1 mot datorn, 1 mot 1 och 2 mot 2. Större lag och datorer på valfria lagplatser kan följa efter att regler och väntetider har provspelats.

## Regler i en duell

- Varje sida har ett torn, tre liv och tio startkort.
- Båda deltagarna får de två kortbytena före start enligt grundreglerna.
- Hjälp från lagkamrater faller bort. Varje strid består av en spelares attack och den andras försvar eller avstående.
- Samma kortfunktioner, regler för tom hand och växling av anfall används som i lagspel.
- När en deltagare når noll liv faller borgen och den andra vinner.

En dator räknas som en vanlig deltagare och följer exakt samma regler. Kortbalansen behöver testas separat för dueller: en barriär stoppar hela attacken när bara ett attackkort spelas.

Duellreglerna är beslutade som `duell-v1` med kortleken `duell-50-v1`; se SPELREGLER.md avsnitt 13. Lagreglerna i SPELREGLER.md är fortfarande förslag.

## Datorns beteende

Första versionen använder en regelstyrd dator. Någon språkmodell eller extern AI-tjänst behövs inte för kortbesluten.

Datorn ska kunna:

1. Bedöma sin starthand och välja kortbyten.
2. Välja ett giltigt mål när flera motståndare finns.
3. Välja ett attackkort eller avstå när en lagkamrat redan anfaller.
4. Försvara med ett tillräckligt kort, använda barriär eller spara kort och acceptera en livförlust.
5. Hjälpa en lagkamrat när det går att rädda dennes torn eller bidra till en attack.
6. Hantera alla val genom samma regelkontroll som används för mänskliga spelare.

**Rättvis information:** datorns beslutsfunktion får bara den egna handen och offentlig information: liv, handstorlekar, spelade kort och pågående strid. Den får inte läsa andra spelares händer eller draghögens ordning. Det gäller även datorns lagkamrater.

Förslag på svårighetsgrader:

- **Lätt:** väljer mellan tillåtna handlingar med mycket slump, men gör inga otillåtna drag.
- **Normal:** försöker använda ett tillräckligt försvar utan onödig överstyrka, spara flexibla kort och prioritera torn med få liv kvar.
- **Svår, senare:** väger in offentligt spelade kort och tänkbara framtida drag. Svårighetsgraden ska komma från bättre beslut, inte hemlig information eller extra liv.

Börja med Normal. Visa kort att datorn funderar, men låt inte varje datorplats orsaka långa väntetider. Datorn får inte automatiskt ersätta en frånkopplad människa utan en bestämd regel för detta.

## Skärmar och spelhandlingar

### Start och spelrum

- Knapparna Spela mot datorn, Skapa match och Anslut till match.
- Spelarnamn, val av spelläge och lag, samt rumskod eller inbjudningslänk.
- Redo-status före start och tydlig markering av datorplatser.
- En första version kan använda gästnamn utan kontoregistrering.

### Kortbyte

- Visa den egna starthanden.
- Tillåt val av högst två kort per byte.
- Visa hur många byten som återstår samt möjligheten att behålla handen.
- Börja matchen först när samtliga deltagare är klara.

### Spelbord

- Motståndarnas borg upptill och det egna lagets borg nedtill.
- Ett torn per deltagare, med namn, liv, handstorlek och status.
- Den egna handen och möjlighet att förstora ett kort för att läsa effekten.
- Gemensam stridsyta med måltavla, attackstyrka och försvarsstyrka.
- Tydlig markering av aktuell fas och vem som får agera.
- Tryck på kort och sedan bekräfta. Drag och släpp kan vara ett komplement.
- Spela kort, välj mål och avstå. Otillåtna handlingar ska inte gå att genomföra.
- Händelselogg som förklarar exempelvis varför barriären tog bort styrka eller varför ett liv förlorades.
- Slutsida med vinnare och möjlighet att spela igen.

På mobil behöver handkort kunna rullas i sidled och torn visas kompakt. Viktiga värden och handlingar ska förbli läsbara utan att hela spelbordet krymps till skrivbordets layout.

## Teknik som behöver skapas

- En gemensam spelmotor för regler, faser, kort, liv och vinst.
- En spelserver som kontrollerar varje drag och håller matchens korrekta tillstånd.
- Separata vyer av matchdata per spelare, så att hemliga händer aldrig skickas till fel webbläsare.
- Uppdateringar i realtid för människomatcher och datorns drag.
- Återanslutning till samma plats och sparat matchläge vid omladdning.
- Skydd mot dubbla handlingar, exempelvis dubbelklick eller försenade meddelanden.
- En datorfunktion som tar emot tillåten information och föreslår en handling som spelmotorn kontrollerar.
- Tester för dueller, laghjälp, barriärer, lika styrka, tom hand, omblandning, utslagning och avslutad match.

Samma motor bör driva alla spellägen, så att datorläget och människomatcherna inte får olika regler. En första lokal prototyp mot datorn kan köras i webbläsaren. När privata onlinematcher tillkommer behöver servern bestämma det giltiga matchläget.

## Grafikstil och principer

**Föreslagen riktning:** illustrerad medeltida fantasy med tydliga silhuetter. Stenborgar, trä, stål och diskreta magiska effekter. Håll spelbordets bakgrund lugn så att handkort och styrkevärden syns.

Använd färg, symbol och text tillsammans för att skilja attack, försvar och magi. Skilj lagen med namnskyltar och emblem, inte enbart röd respektive blå färg, eftersom dessa färger även används för korttyper.

Kortnamn, siffror, regeltext, liv och spelarnamn ska vara vanlig text i gränssnittet, inte inbakade i illustrationerna. Då kan regler och språk ändras utan att bilderna behöver göras om.

## Bildlista: 17 grafiska original

Detta är ett föreslaget bildpaket för en första illustrerad version, inte ett tekniskt minimum. En spelbar prototyp kan använda enkla textkort och former utan specialritade bilder.

Storlekarna nedan avser original och största tänkta webbresurs, inte den fasta storleken på skärmen. Skapa mindre exportvarianter för mobil. Antalet avser unika motiv, inte extra filer för olika upplösningar.

| Grafik | Antal | Originalstorlek | Format i spelet | Innehåll |
| --- | ---: | --- | --- | --- |
| Kortillustrationer | 5 | 768 × 768 px per bild | WebP | Stormning, Sköldmur, Bågskytt, Eldklot och Magisk barriär. Utan namn, siffror eller regeltext. |
| Gemensam kortbaksida | 1 | 750 × 1050 px | WebP | Ett symmetriskt motiv som inte avslöjar korttyp. |
| Spelbakgrund | 1 | 2560 × 1440 px | WebP | Lugn belägringsmiljö. Inga viktiga detaljer vid kanterna eftersom bilden beskärs på mobil. |
| Borgar | 2 | 1024 × 1024 px per bild | WebP med transparens | Två olika borgmotiv, ett för vardera sidan, utan individuella spelartorn eller fasta lagfärger. |
| Återanvändbart spelartorn | 1 | 512 × 768 px | WebP med transparens | Ett fristående torn som återanvänds en gång per deltagare. |
| Gränssnittssymboler | 6 | SVG med 64 × 64 viewBox | SVG | Attack, försvar, magi, liv, kort och datormotståndare. |
| Namnlogotyp | 1 | SVG med cirka 800 × 240 viewBox | SVG | Tornstriden, läsbar även i mindre storlek. |
| **Totalt** | **17** | | | |

Spara gärna rasteroriginal som PNG eller i redigerbart originalformat och exportera WebP för spelet. Transparenta objekt måste ha verklig transparens, inte en inbakad rutig bakgrund. Behåll redigerbara vektororiginal för symboler och logotyp.

### Kortens proportioner

- Hela kortet har proportionen **5:7**, exempelvis 250 × 350 CSS-pixlar när det visas stort.
- Den kvadratiska illustrationen ligger i en egen yta på kortet. Gränssnittet lägger till rubrik, värde, symbol och regeltext.
- Stormning 1, 2 och 3 använder samma illustration. Samma princip gäller Sköldmur.
- Kortlekens 120 kort behöver alltså **inte 120 bilder**. De fem illustrationerna återanvänds med olika text och siffror.
- Förstorad kortvisning behövs på små skärmar. Regeltext ska inte bara krympas tills den blir oläslig.

### Export och filstorlek

Föreslagna prestandamål, att kontrollera mot bildkvaliteten efter export:

- Kortillustration: cirka 50–150 kB per bild.
- Kortbaksida: cirka 50–150 kB.
- Bakgrund: cirka 200–500 kB.
- Borg: cirka 100–250 kB per bild.
- Torn: cirka 50–150 kB.
- Symboler: helst under 10 kB per SVG.

Skapa exempelvis kortbilder i 384 och 768 px samt bakgrunden i 1280 och 2560 px bredd. Låt webbsidan välja lämplig storlek. Ladda illustrationerna en gång och återanvänd dem mellan kort och matcher.

### Sådant som inte kräver fler bilder i första versionen

- Tre, två eller ett liv visas med upprepade livsymboler och en siffra.
- Ett utslaget torn kan tonas ned och märkas Utslagen. Separata skadesteg behövs inte från början.
- Aktiv spelare och vald måltavla visas med konturer och text.
- Kortens ramar, knappar och paneler byggs i gränssnittet.
- Attackrörelse, skakning, glöd och kortvändning kan animeras utan separata bildrutor. Erbjud minskad rörelse.
- Datorn använder datorsymbolen. Separata karaktärsporträtt är valfria.

## Föreslagen byggordning

1. Fastställ de öppna reglerna och bygg en spelbar duell mot en enkel dator med textkort.
2. Kontrollera att en hel match går att spela och avsluta, inklusive kortbyten och omblandning.
3. Lägg till privata matcher 1 mot 1 och sedan 2 mot 2 med återanslutning.
4. Lägg in det föreslagna grafikpaketet och anpassa spelbordet för mobil och dator.
5. Testa 3 mot 3 och 4 mot 4, datorer på lagplatser och ytterligare svårighetsgrader.

Grafiken kan produceras när kortytornas proportioner och spelbordets disposition har provats. Då slipper man göra om färdiga illustrationer för att de inte passar spelvyn.
