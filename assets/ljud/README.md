# Tornstridens ljud

Originala syntetiska ljud framtagna för spelet, utan externa samplingar.

- `strid-musik.mp3`: 72 sekunders slinga, dramatisk stråkmelodi och djupa trummor. Tre variationer på det godkända ljudprovet (alternativ 2). Efterklangen viks över början för en sammanhängande loop. Inga anfalls- eller försvarsljud ligger i musiken.
- `anfall.mp3`: svep, metall och dov trumma.
- `magi.mp3`: magiskt anfall med stigande klang och trumma.
- `forsvar.mp3`: sköldklang när ett försvarskort spelas.

Ljuden följer projektets licens. Källan är `scripts/skapa-ljud.py` (Python med NumPy och FFmpeg behövs bara för att återskapa filerna). Spelet laddar färdiga MP3-filer och behöver inga externa ljudtjänster.
