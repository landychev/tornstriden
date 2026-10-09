# Tornstriden – kort och spelbord

## Öppna prototypen

Starta `npm start` och öppna `spelbord.html` (ES-moduler kräver en lokal server). Sidan är ett testbord för enskilda strider; den riktiga matchen finns i `match.html`. Länken **Alla 30 kort** leder till kortöversikten `textkort.html`.

## Det som går att prova

- Två torn med tre synliga liv var, egna handkort och dolda motståndarkort.
- Trettio olika kort med en gemensam källa i `kort.js`.
- Växla mellan kort 1–10, kort 11–20 och de tio nya effektkorten. Testhanden har fortfarande tio kort, och byte av hand återställer teststriden. De senaste korten visas från början.
- Välj ett kort i handen för att läsa effekten och lägga det på stridsytan.
- **Testa attack:** motståndaren börjar med Sköldmur 3. Du kan välja ett annat försvar under Ställ in teststriden.
- **Testa försvar:** motståndaren börjar med Eldklot 4. Du kan välja en annan attack under Ställ in teststriden.
- **Avgör teststriden:** jämför styrkor, uppdatera liv och släng spelade kort.
- **Avstå försvar:** spara hela handen och förlora ett liv.
- **Återställ:** återgå till valda startliv och tio kort för att prova en ny strid. Byte mellan attack- och försvarstest återställer också situationen.

Detta är fristående teststrider, inte en fullständig match. Motdragen är förbestämda. En komplett lokal duell med startbyten, draghög, påfyllning, seger och datormotståndare finns i `match.html`; laghjälp och onlinespel är ännu inte implementerade. Kortleken på bordet är visuell. Slänghögens siffra visar korten som förbrukats i teststriden.

## Fem nya kortförslag

| Namn | Typ | Styrka | Effekt |
| --- | --- | ---: | --- |
| Spejare | Attack | 1 | Bidrar med 1 attackstyrka. |
| Armborst | Attack | 2 | Bidrar med 2 attackstyrka. |
| Katapult | Attack | 5 | Bidrar med 5 attackstyrka. Högst ett liv kan förloras; barriären kan stoppa kortet. |
| Tornvakt | Försvar | 2 | Bidrar med 2 försvarsstyrka. |
| Järnport | Försvar | 4 | Bidrar med 4 försvarsstyrka. |

## Ytterligare tio kortförslag

| Namn | Typ | Attack | Försvar | Effekt |
| --- | --- | ---: | ---: | --- |
| Murbräcka | Attack | 4 | – | Attack mot det valda tornet. |
| Ryttaranfall | Attack | 3 | – | Attack mot det valda tornet. |
| Belägringstorn | Attack | 6 | – | Stark attack, men kostar fortfarande högst ett liv vid träff. |
| Palissad | Försvar | – | 1 | Ett enkelt försvar som kan komplettera lagkamraternas kort. |
| Vallgrav | Försvar | – | 5 | Starkt försvar under den aktuella striden. |
| Fästningsmur | Försvar | – | 6 | Starkt försvar utan extra liv eller bestående effekt. |
| Riddare | Attack / försvar | 3 | 2 | Använder attackvärdet vid anfall och försvarsvärdet vid försvar. |
| Livvakt | Attack / försvar | 1 | 3 | Starkare i försvar. Flyttar inte livförlust till en annan spelare. |
| Eldstorm | Magi · attack | 5 | – | Magisk attack mot ett enda torn. |
| Runsköld | Magi · försvar | – | 5 | Försvar mot både vanliga och magiska attacker. |

Alla nya attackkort kan stoppas av Magisk barriär. Alla spelade kort slängs efter striden. De dubbla värdena på Riddare och Livvakt anges som **attack / försvar**.

Kortförslagen är inte balansprövade och ändrar ännu inte 120-kortslekens fördelning i spelreglerna. Varje testhand innehåller tio olika kort, så att alla trettio går att inspektera i tre omgångar. Startregeln om tio handkort är oförändrad.

## Grafik

Tornet är ett återanvändbart SVG-original i `assets/torn.svg`. Båda sidor använder samma tornbild med tydliga namn och bokstäverna N och S. Kortens text, styrkor, liv och spelbordets konturer skapas i gränssnittet och kan ändras utan att bilder görs om.

Layouten anpassar sig till mobil och dator. Korten väljs med knapptryck och fungerar även med tangentbord. Prototypen använder inga externa typsnitt, tjänster eller bildbibliotek.

## Specialkort och bildeffekter

Läs [EFFEKTKORT.md](EFFEKTKORT.md) för kort 21–30, effektordning och bildlager. Öppna `effekter.html` för att välja mellan sex transparenta lager och prova en egen bild. Effekternas duellregler är implementerade och testas med `npm test`. Lagregler och spelbalans behöver fortfarande provas.
