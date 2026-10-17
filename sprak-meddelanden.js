/* Explicit protocol message templates. Only localize marked card/team/message parameters.
   Player nicknames are always preserved, even when they match a Swedish card name. */
export const templates = [
  {
    "key": "{0} lämnade striden – striden avbryts utan skada, läkning eller motstöt.",
    "localize": []
  },
  {
    "key": "För många nya gäster från samma anslutning. Försök igen om {0} sekunder.",
    "localize": []
  },
  {
    "key": "{0} kan inte spelas som vanlig attack. Välj enkel attack 1 i stället.",
    "localize": [
      0
    ]
  },
  {
    "key": "{0} har lämnat – striden avbryts utan skada eller läkning.",
    "localize": []
  },
  {
    "key": "Vi är {0}. Matchen kan starta med 2, 4, 6 eller 8 spelare.",
    "localize": []
  },
  {
    "key": "Högst {0} kort per bytesomgång. Avmarkera ett kort först.",
    "localize": []
  },
  {
    "key": "Matchformatet för {0} spelare är ännu inte tillgängligt.",
    "localize": []
  },
  {
    "key": "{0} har inga kort att anfalla med – turen går vidare.",
    "localize": []
  },
  {
    "key": "Försvararen har redan {0} liv; ingen läkning behövs.",
    "localize": []
  },
  {
    "key": "Anfallaren har redan {0} liv; {1} ger inget extra liv.",
    "localize": [
      1
    ]
  },
  {
    "key": "{0} kan inte längre bjudas in och har avmarkerats.",
    "localize": []
  },
  {
    "key": "{0} ({1}) har inget giltigt mål kvar – ingen motstöt.",
    "localize": [
      0
    ]
  },
  {
    "key": "Lagen är ojämna: {0} mot {1}. Någon behöver byta lag.",
    "localize": []
  },
  {
    "key": "Lotten ger {0} första anfallet. {1} väljer måltavla.",
    "localize": [
      0
    ]
  },
  {
    "key": "{0} gör en motstöt: anfallaren förlorar ett liv.",
    "localize": [
      0
    ]
  },
  {
    "key": "{0} saknar giltigt magiskt mål och ger försvar {1}.",
    "localize": [
      0
    ]
  },
  {
    "key": "{0} stoppar {1} och dess eventuella specialeffekt.",
    "localize": [
      0,
      1
    ]
  },
  {
    "key": "Isrustning sänker lagets attack med {0}: {1} → {2}.",
    "localize": []
  },
  {
    "key": "Sprängladdning sänker försvaret med {0}: {1} → {2}.",
    "localize": []
  },
  {
    "key": "{0} kopierar den magiska attackens styrka: {1}.",
    "localize": [
      0
    ]
  },
  {
    "key": "Det finns inget magiskt attackkort att {0}.",
    "localize": [
      0
    ]
  },
  {
    "key": "{0} faller – {1} kvarvarande handkort slängs.",
    "localize": []
  },
  {
    "key": "{0} ({1}) stoppar {2} ({3}) och dess specialeffekt.",
    "localize": [
      0,
      2
    ]
  },
  {
    "key": "{0} sänker försvaret med {1}, lägst till 0.",
    "localize": [
      0
    ]
  },
  {
    "key": "{0} återställer ett liv hos försvararen.",
    "localize": [
      0
    ]
  },
  {
    "key": "Välj vilket magiskt attackkort {0} ska {1}.",
    "localize": [
      0,
      1
    ]
  },
  {
    "key": "{0} har inga torn kvar. {1} vinner matchen.",
    "localize": [
      0,
      1
    ]
  },
  {
    "key": "{0} får +{1} mot ett vanligt försvarskort.",
    "localize": [
      0
    ]
  },
  {
    "key": "{0} sänker attacken med {1}, lägst till 0.",
    "localize": [
      0
    ]
  },
  {
    "key": "{0} återställer ett liv hos anfallaren.",
    "localize": [
      0
    ]
  },
  {
    "key": "Strid {0}: {1} anfaller. {2} väljer måltavla.",
    "localize": [
      1
    ]
  },
  {
    "key": "Du får byta högst {0} kort per omgång.",
    "localize": []
  },
  {
    "key": "{0} saknar handkort – turen går till {1}.",
    "localize": [
      0,
      1
    ]
  },
  {
    "key": "Anfallet är låst. {0} försvarar först.",
    "localize": []
  },
  {
    "key": "{0} får +{1} mot ett blått försvarskort.",
    "localize": [
      0
    ]
  },
  {
    "key": "{0} hade tom hand och drar {1} nya kort.",
    "localize": []
  },
  {
    "key": "Oväntat fel i beslutsfunktionen: {0}",
    "localize": []
  },
  {
    "key": "{0} kan inte användas som försvar.",
    "localize": [
      0
    ]
  },
  {
    "key": "{0} har inga liv kvar och slås ut.",
    "localize": []
  },
  {
    "key": " – {0} kvarvarande handkort slängs",
    "localize": []
  },
  {
    "key": "{0} får +{1} eftersom {2} hade ett liv.",
    "localize": [
      0
    ]
  },
  {
    "key": "{0} tar över och väljer måltavla.",
    "localize": []
  },
  {
    "key": "Ny match. {0} kort och {1} liv var.",
    "localize": []
  },
  {
    "key": "{0} har fallit. {1} vinner matchen.",
    "localize": []
  },
  {
    "key": "Lotten ger {0} första anfallet.",
    "localize": []
  },
  {
    "key": "Nicket måste vara {0}–{1} tecken.",
    "localize": []
  },
  {
    "key": "{0} får +{1} försvar vid ett liv.",
    "localize": [
      0
    ]
  },
  {
    "key": "{0} behåller handen (omgång {1}).",
    "localize": []
  },
  {
    "key": "{0} får +{1} attack vid ett liv.",
    "localize": [
      0
    ]
  },
  {
    "key": "{0} ger upp. {1} vinner matchen.",
    "localize": []
  },
  {
    "key": "{0} avstår från att anfalla.",
    "localize": []
  },
  {
    "key": "Ingen kunde bjudas in. {0}: {1}",
    "localize": [
      1
    ]
  },
  {
    "key": "{0} ({1}) gör en motstöt mot {2}.",
    "localize": [
      0
    ]
  },
  {
    "key": "{0} byter {1} kort (omgång {2}).",
    "localize": []
  },
  {
    "key": "Inbjudan skickad till {0}.",
    "localize": []
  },
  {
    "key": "Attack {0} mot försvar {1}: {2}",
    "localize": [
      2
    ]
  },
  {
    "key": "{0} väljer {1} som måltavla.",
    "localize": []
  },
  {
    "key": "{0} avstår från försvar.",
    "localize": []
  },
  {
    "key": "{0} är fullt (högst {1}).",
    "localize": [
      0
    ]
  },
  {
    "key": "{0} har inte valt lag.",
    "localize": []
  },
  {
    "key": "{0} {1}. {2} vinner matchen.",
    "localize": [
      1
    ]
  },
  {
    "key": "Strid {0}: {1} anfaller.",
    "localize": []
  },
  {
    "key": "{0} förlorar ett liv.",
    "localize": []
  },
  {
    "key": " {0} handkort slängs.",
    "localize": []
  },
  {
    "key": "{0} avstår från att {1}.",
    "localize": [
      1
    ]
  },
  {
    "key": "{0} är inte ansluten.",
    "localize": []
  },
  {
    "key": "Servern svarade {0}.",
    "localize": []
  },
  {
    "key": "{0} försvarar med {1}.",
    "localize": [
      1
    ]
  },
  {
    "key": "{0} läker {1} ett liv.",
    "localize": [
      0
    ]
  },
  {
    "key": "{0} anfaller med {1}{2}.",
    "localize": [
      1,
      2
    ]
  },
  {
    "key": "{0} anfaller med {1}.",
    "localize": [
      1
    ]
  },
  {
    "key": "{0} {1} och slås ut.{2}{3}",
    "localize": [
      1,
      2,
      3
    ]
  },
  {
    "key": "Internt fel: {0}",
    "localize": [
      0
    ]
  },
  {
    "key": "{0} kopierar {1}: {2}.",
    "localize": [
      0,
      1
    ]
  },
  {
    "key": "Väntar på {0}.",
    "localize": []
  },
  {
    "key": "{0} ({1}) mot {2}: {3}",
    "localize": [
      0,
      2,
      3
    ]
  },
  {
    "key": "{0} slås ut{1}.",
    "localize": [
      1
    ]
  },
  {
    "key": "{0} {1} med {2}.",
    "localize": [
      1,
      2
    ]
  },
  {
    "key": "Ny lagmatch {0} mot {1}. {2} kort och {3} liv var. Kortlek {4}.",
    "localize": []
  },
  {
    "key": "Bytesomgång {0} börjar.",
    "localize": []
  },
  {
    "key": "Högst {0} deltagare.",
    "localize": []
  },
  {
    "key": "Protokollversion {0} krävs.",
    "localize": []
  },
  {
    "key": "Kommandot får vara högst {0} tecken.",
    "localize": []
  },
  {
    "key": "Adaptern saknar {0}().",
    "localize": []
  },
  {
    "key": "{0} (enkel attack)",
    "localize": [
      0
    ]
  },
  {
    "key": "{0} ({1})",
    "localize": [
      0
    ]
  },
  {
    "key": "{0}: {1}",
    "localize": [
      1
    ]
  },
  {
    "key": "{0} {1}.",
    "localize": [
      1
    ]
  }
];
