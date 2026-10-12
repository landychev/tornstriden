# Tornstridens ljud

Originala syntetiska ljud framtagna för spelet, utan externa samplingar.

- `strid-musik.mp3`: 72 sekunders slinga, dramatisk stråkmelodi och djupa trummor. Tre variationer på det godkända ljudprovet (alternativ 2). Efterklangen viks över början för en sammanhängande loop. Inga anfalls- eller försvarsljud ligger i musiken.
- `anfall.mp3`: svep, metall och dov trumma.
- `magi.mp3`: magiskt anfall med stigande klang och trumma.
- `forsvar.mp3`: sköldklang när ett försvarskort spelas.
- `kortlaggning.mp3`: 0,28 sekunders papperssvep och torrt flapp när ett kort spelas i anfall eller försvar, även av datorn. Hörs tillsammans med stridseffekten. Kortval, avstått försvar och ogiltiga drag ger inget kortläggningsljud.
- `kortblandning.mp3`: 1,9 sekunders sammanhängande blandning av en stor kortlek: täta, överlappande kortkanter och ett avslutande pappersprassel när leken skjuts ihop. Spelas vid första utdelningen, ny match, faktiska kortbyten och påfyllning av tom hand. Att behålla handen ger inget blandningsljud. En ny blandning ersätter den föregående om korten byts snabbt.

- `forlorat-liv.mp3`: 0,9 sekunders dov träff med fallande ton när det egna tornet tappar ett liv, även vid motstöt.
- `vunnen-strid.mp3`: 1,2 sekunders stigande plockade toner vid ett lyckat anfall eller försvar.
- `forlorad-match.mp3`: 2,7 sekunders fallande stråkfras vid matchförlust.
- `vunnen-match.mp3`: 3,2 sekunders stigande fanfar med ett avslutande durackord vid matchvinst.

Resultatljudet hörs en gång när resultatrutan visas, efter kortflygningen. Matchens slutljud ersätter livsförlust/stridsvinst i den avgörande striden och fungerar även vid uppgiven match. Mot datorn gäller ljuden människans resultat; i tvåspelarläget gäller de spelaren vars hand visas. Ett stoppat anfall utan livsförlust ger inget eget resultatljud för anfallaren. Alla effekter följer effektvolym, av/på och flikens synlighet. En ny match stoppar kvarvarande slutljud.

Ljuden följer projektets licens. Källan är `scripts/skapa-ljud.py` (Python med NumPy och FFmpeg behövs bara för att återskapa filerna). Spelet laddar färdiga MP3-filer och behöver inga externa ljudtjänster.
