# Tio specialkort och sex bildlager

## Prova

- Öppna `spelbord.html` och välj **10 effektkort** för att prova kort 21–30.
- Under **Ställ in teststriden** väljer du motståndarens kort och bådas startliv. Inställningarna sparas under sidans session när du återställer en strid.
- Öppna `textkort.html#effektkort` för att läsa alla tio kort med exempelbilder.
- Öppna `effekter.html` för att jämföra bildlagren, ändra styrka, slå på lugn rörelse och prova en egen bild.

Kortleken har nu 30 olika kortförslag. Spelbordets hand innehåller fortfarande tio kort åt gången. Den tidigare fördelningen för en fysisk lek på 120 kort är inte ändrad.

## Kort 21–30

| Kort | Grundstyrka | Specialeffekt |
| --- | --- | --- |
| Sprängladdning | Attack 3 | Försvaret minskar med 2, lägst till 0. |
| Sista anfallet | Attack 2 | +3 attack om anfallaren börjar striden med exakt ett liv. |
| Drakeld | Magisk attack 4 | +2 attack mot ett vanligt blått försvarskort. Ingen bonus mot magi, flexibla kort eller avstående. |
| Vampyrbett | Magisk attack 3 | Vid träff återfår anfallaren ett liv, högst till tre. |
| Helande ljus | Magiskt försvar 3 | Efter lyckat försvar återfår försvararen ett liv, högst till tre. |
| Isrustning | Magiskt försvar 2 | Attacken minskar med 2, lägst till 0. |
| Törnesköld | Försvar 3 | Vid lyckat försvar förlorar anfallaren ett liv av motstöten. |
| Sista bastionen | Försvar 2 | +4 försvar om försvararen börjar striden med exakt ett liv. |
| Spegelsköld | Magiskt försvar 1 | Mot magisk attack kopieras attackstyrkan som försvar. Mot vanlig attack gäller försvar 1. |
| Försegling | Magiskt försvar 2 | Stoppar ett magiskt attackkort inklusive specialeffekten. Mot vanlig attack gäller försvar 2. |

Alla kort räknas som spelarens enda kort i striden och slängs efteråt. Effekterna gäller bara den pågående striden. Livändringar sker direkt efter resultatet, och ingen kan läkas över tre liv. Vid noll liv faller tornet och dess kvarvarande handkort slängs.

**De tio nya korten är duellprototyper och ännu inte balansprövade.** Effekter som sänker hela attacken/försvaret, kopierar styrka eller orsakar motstöt behöver egna målregler innan de används i lagmatcher. Exempelvis är det inte bestämt vem som träffas av Törnesköld när flera spelare anfaller. Testbordet stöder fortfarande bara en strid mellan två torn.

## Ordning för effekterna i en duell

1. Magisk barriär stoppar valfritt attackkort. Försegling stoppar ett magiskt attackkort. Stoppet tar bort både attackstyrka och attackkortets specialeffekt.
2. Räkna anfallarens bonusar från startliv och motståndarens korttyp.
3. Isrustning sänker attackstyrkan, lägst till noll.
4. Räkna försvararens bonus vid ett liv eller Spegelskölds kopierade magiska attackstyrka.
5. Ett ostoppat Sprängladdning sänker försvarsstyrkan, lägst till noll.
6. Jämför styrkorna. Lika räcker för lyckat försvar. Misslyckat försvar kostar ett liv.
7. Utför eventuell läkning eller motstöt enligt kortet. Lägg därefter spelade kort i slänghögen. Om ett torn faller slängs också dess kvarvarande handkort.

Regelmotorn finns i `strid.js`. Kör `npm test` för att kontrollera specialeffekter och kombinationer.

## Sex fristående bildlager

| Lager | Fil | Uttryck |
| --- | --- | --- |
| Eldglöd | `assets/effekter/eld.svg` | Lågor, varm glöd och gnistor vid kanterna. |
| Frost | `assets/effekter/frost.svg` | Iskristaller, sprickor och kallt sken. |
| Runmagi | `assets/effekter/runor.svg` | En lysande ring med fantasitecken. |
| Blixtar | `assets/effekter/blixt.svg` | Elektriska bågar runt bildens kanter. |
| Heligt ljus | `assets/effekter/ljus.svg` | Gyllene strålar, stjärnglitter och ljusring. |
| Skugga | `assets/effekter/skugga.svg` | Violett dimma och mörka slöjor. |

Lagren är skalbara SVG-bilder med en originalyta på **1024 × 1024** och verklig transparent bakgrund. De innehåller inget torn, ingen korttext och ingen regelinformation. De är skapade som vektorgrafik i projektet och har inga externa resurser.

### Användning i ett kort

Lägg motivbilden nederst i en avgränsad bildyta och effektlagret ovanpå. `bildeffekter.css` och `bildeffekter.js` visar hur lagren kan återanvändas. Låt namn, styrka och regeltext ligga utanför denna yta.

Förhandsvisningarna använder samma tornbild för att jämförelsen ska visa vad varje lager förändrar. Tornet är ett exempelmotiv, inte separata illustrationer av de tio korten.

Effektverkstaden tar emot PNG, JPG och WebP på högst 20 MB. Egna bilder behandlas enbart lokalt i webbläsaren. Återställning tar bort den tillfälliga bilden. Knappen för hämtning sparar det ursprungliga SVG-lagret, utan motiv och utan förhandsvisningens styrkeinställning. Funktionen exporterar inte en sammanslagen bild.

Lugn rörelse är avstängd från början och respekterar inställningen för minskad rörelse. Bildlagren påverkar aldrig kortens spelregler.
