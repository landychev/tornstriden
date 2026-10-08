# Tornstriden

Ett kortspel om två medeltidsborgar. Spelarna anfaller, försvarar sina torn och använder magi. Målet är att slå ut motståndarnas torn.

Detta repository är projektets huvudsakliga arbetskatalog. Nya filer och framtida ändringar hör hemma här.

## Nuvarande version

- 30 kortförslag, inklusive tio kort med specialeffekter.
- Ett spelbord med två torn och fristående teststrider.
- Beräkning av duellresultat, specialeffekter, läkning och livförlust.
- Sex transparenta bildlager och en verkstad där de kan provas på en egen bild.
- Automatiska tester för kort och stridsregler.

Det finns ännu ingen komplett match, datorstyrd motståndare eller server för onlinespel. Kortbalans och specialeffekter i lagspel behöver vidare arbete.

## Öppna prototypen

Prototypen är skriven som ES-moduler och behöver därför en lokal webbserver – att dubbelklicka på `spelbord.html` fungerar inte. Med Node.js installerat:

```sh
npm start
```

Öppna sedan [spelbordet](http://127.0.0.1:8765/spelbord.html), [kortöversikten](http://127.0.0.1:8765/textkort.html) eller [bildverkstaden](http://127.0.0.1:8765/effekter.html). Servern (`server.js`) har inga beroenden; en annan port väljs med `PORT=8080 npm start`. Den lokala förhandsvisningen är ingen publicering på internet.

## Tester

```sh
npm test
```

Testerna körs också automatiskt på GitHub vid varje push (`.github/workflows/test.yml`). Prototypen kräver inga externa paket; enbart `npm run preview` behöver Playwright.

## Förhandsvisningsbilder

De tre `*-forhandsvisning.jpg` återskapas med:

```sh
npm install && npx playwright install chromium   # en gång
npm run preview
```

## Dokumentation

- [Utvecklingsplan och nästa steg](UTVECKLINGSPLAN.md)
- [Spelregler och öppna regelförslag](SPELREGLER.md)
- [Plan för webbspel och grafik](WEBBSPEL.md)
- [Prototypens funktioner](PROTOTYP.md)
- [Specialkort och bildlager](EFFEKTKORT.md)
- Ursprungligt arbetsmaterial: `kortspel.pptx`.

## Filer att börja i

| Fil | Ansvar |
| --- | --- |
| `kort.js` | Kortens namn, styrkor, texter och specialeffekter, samt bonuskonstanterna (`BONUS`) och maxliv. Kortets siffra härleds ur data. |
| `strid.js` | Regelberäkning för en enskild duell. Läser `BONUS` från `kort.js`. |
| `strid.test.js` | Tester för regelberäkningen. |
| `spelbord.html`, `spelbord.css`, `spelbord.js` | Spelbordet: ett `state`-objekt, en `render()` som målar allt, och handlingar som bara ändrar state. |
| `tokens.css` | Gemensamma färgtokens för ljust och mörkt läge. |
| `server.js`, `preview.js` | Lokal webbserver och skript som återskapar förhandsvisningsbilderna. |
| `textkort.html`, `kortoversikt.js` | Kortkatalogen. |
| `effekter.html`, `effektverkstad.js`, `effektverkstad.css` | Bildverkstaden. |
| `bildeffekter.js`, `bildeffekter.css`, `assets/effekter/` | Återanvändbara visuella lager. |

Förhandsvisningsbilder och `bildeffekter.zip` är sparade leveranser. Bilderna förnyas med `npm run preview` när motsvarande sida ändras; zip-filen när bildlagren ändras.

## GitHub

Repository: [landychev/tornstriden](https://github.com/landychev/tornstriden).

Arbeta från denna katalog, granska ändringarna, kör relevanta tester och skapa begripliga commits. GitHub lagrar versionshistoriken. Att pusha koden dit startar inte i sig någon spelserver.

Den befintliga licensen finns i [LICENSE](LICENSE).
