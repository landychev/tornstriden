# Grafik för Tornstriden

Vald riktning: målade fantasykaraktärer på korten (alternativ B) och skulpterade, stiliserade 3D-torn (alternativ A). Godkänd konceptbild finns i `design/grafik-koncept.png`.

## Bilder

- `assets/kort/`: 30 separata illustrationer. Filnamnet är kortets ID från `kort.js`. Karaktärer, byggnader, belägringsvapen och magi har egna motiv.
- `assets/torn/torn-bla.png`: Norra tornet.
- `assets/torn/torn-rod.png`: Södra tornet.
- Kortbilderna har inga inbakade namn eller siffror. Spelet visar riktiga namn och värden ovanpå eller under bilden.
- Kort levereras som JPEG i 600 pixlars bredd. Tornen levereras som PNG med transparent bakgrund. Inga externa bildtjänster behövs under spel.

Bilderna skapades med det inbyggda verktyget **imagegen**, med konceptbilden som stilreferens. De fullständiga genereringsprompterna finns i `grafik-prompter.json`. Originalbilderna har exporterats till webbformat utan att ändra motivet.

## Koppling till spelet

`grafik.js` används av matchen, testbordet och kortkatalogen. `cardArt()` väljer bilden utifrån kortets ID; `cardFace()` bygger kortets bild, styrka, namn och typ. Enkel attack behåller motivet men visar styrka 1 och tar bort specialeffektens bildlager. Kortens regler och värden ändras inte.

`grafik.css` innehåller bildramar, styrkemärken, läsbara namnfält, mobilanpassning och tornens visuella skadelägen. Tornen mörknar vid två liv och får rök/glöd vid ett liv; befintlig fall- och träffanimation behålls. Skadeläget följer de aktuella liven och återställs också vid läkning eller ny match.

Kortkatalogen visar hela regeltexten och laddar bilderna först när de närmar sig skärmen. Matchen visar kortets effekt när det väljs. Bilderna är dekorativa för skärmläsare; namn, typ, styrka och liv finns fortsatt som text.

`deploy.sh` inkluderar grafikmodulen, stilmallen och alla bilder vid nästa vanliga publicering. De tidigare hjälprutorna, kortbytena och kortanimationerna finns kvar.

## Popup-rutor: Smaragd & guld

Välkomst-, bytes-, resultat- och bekräftelserutorna har gemensamma smaragdgröna rubriker, ljusa textytor, guldramar och tydliga knappar. Fullständiga spelregler går att fälla ut i välkomstrutan. Resultatet visar de slutliga attack- och försvarsstyrkorna från matchmotorn, inklusive specialeffekter.

- `popup.css` ger samtliga dialoger samma utseende och anpassar dem till små och låga skärmar.
- `popup.js` skapar resultatets emblem och styrkeuppställning.
- `assets/popup/valkommen.jpg` är borgillustrationen, skapad med det inbyggda **imagegen**-verktyget. Prompten finns i `popup-prompter.json` och den valda stilreferensen i `design/popup-smaragd-guld.png`.
- `assets/popup/emblem.svg` innehåller skalbara symboler för kort, svärd, försvar, tornskada, seger och kapitulation.
- `popup-forhandsvisning.jpg` visar den implementerade välkomstrutan.

Dialogerna fungerar med tangentbord och Escape. Datorns tur pausas under bekräftelse av ny match eller kapitulation och återupptas om frågan avbryts. Stridsresultat väntar tills en öppen hjälpruta har stängts, så att dialoger inte staplas.

Kontrollerat i webbläsare vid 1366 × 1000, 390 × 844, 320 × 640 och 844 × 390, inklusive ljust/mörkt systemläge, fokus, Escape, avbryt, nya matcher samt verkliga strider med försvar, träff, seger och nederlag. De 56 befintliga regeltesterna passerar.
