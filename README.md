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

Öppna `spelbord.html` direkt i en webbläsare, eller starta en lokal förhandsvisning från den här katalogen:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Öppna sedan [spelbordet](http://127.0.0.1:8765/spelbord.html), [kortöversikten](http://127.0.0.1:8765/textkort.html) eller [bildverkstaden](http://127.0.0.1:8765/effekter.html).

Om porten redan används av en tidigare förhandsvisning, avsluta den servern eller välj en annan port. Servern ska startas i repositoryts rot. Den lokala förhandsvisningen är ingen publicering på internet.

## Tester

Med Node.js installerat:

```sh
node --test strid.test.js
```

Prototypen kräver för närvarande inga externa JavaScript-paket.

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
| `kort.js` | Kortens namn, styrkor, texter och specialeffekter. |
| `strid.js` | Regelberäkning för en enskild duell. |
| `strid.test.js` | Tester för regelberäkningen. |
| `spelbord.html`, `spelbord.css`, `spelbord.js` | Spelbordets presentation och testkontroller. |
| `textkort.html`, `kortoversikt.js` | Kortkatalogen. |
| `effekter.html`, `effektverkstad.js`, `effektverkstad.css` | Bildverkstaden. |
| `bildeffekter.js`, `bildeffekter.css`, `assets/effekter/` | Återanvändbara visuella lager. |

Förhandsvisningsbilder och `bildeffekter.zip` är sparade leveranser. De behöver bara förnyas när motsvarande presentation eller bildlager ändras.

## GitHub

Repository: [landychev/tornstriden](https://github.com/landychev/tornstriden).

Arbeta från denna katalog, granska ändringarna, kör relevanta tester och skapa begripliga commits. GitHub lagrar versionshistoriken. Att pusha koden dit startar inte i sig någon spelserver.

Den befintliga licensen finns i [LICENSE](LICENSE).
