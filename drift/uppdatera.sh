#!/usr/bin/env bash
# Planerad uppdatering av Tornstriden på servern (arbetsordning L21, huvudplan §11):
#   1. underhållsläge: inga nya matcher kan startas (lobbyn och pågående matcher fortsätter)
#   2. vänta tills pågående matcher är klara (högst --vanta minuter, standard 30)
#   3. säkerhetskopiera databasen
#   4. git pull --ff-only, ./deploy.sh (statiska filer med nya versionsstämplar), systemctl restart
#   5. kontrollera att tjänsten svarar
# Körs som root på servern:  sudo drift/uppdatera.sh [--vanta MIN] [--tvinga] [--till COMMIT]
#   --tvinga  vänta inte: starta om direkt. Pågående matcher avbryts då utan vinnare (beslut 27B) och spelarna
#             får "Matchen avbröts på grund av ett serveravbrott" med vägen till lobbyn.
#   --till    återgång/återställning till en tidigare commit (git reset --hard) i stället för git pull.
#             Databasen följer inte med tillbaka: har den nya versionen höjt schemaversionen vägrar den gamla
#             koden starta – återställ då säkerhetskopian från före uppdateringen (se DRIFT.md).
# Avbryts skriptet före steg 4 öppnas underhållsläget igen; efter steg 4 står instruktionen för återgång i DRIFT.md.
set -euo pipefail

tjanst=tornstriden-online
# Samma miljö som tjänsten (port och datakatalog), så att hälsokontrollen och säkerhetskopian träffar rätt.
if [[ -r /etc/tornstriden-online.env ]]; then set -a; . /etc/tornstriden-online.env; set +a; fi
halsa_url="http://127.0.0.1:${PORT:-8766}/api/halsa"
vanta_min=30
tvinga=0
till=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --vanta) vanta_min="$2"; shift 2 ;;
    --tvinga) tvinga=1; shift ;;
    --till) till="$2"; shift 2 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "Okänt argument: $1" >&2; exit 2 ;;
  esac
done
[[ $EUID -eq 0 ]] || { echo "Kör som root (sudo): systemctl och deploy.sh behöver det." >&2; exit 2; }
rot="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
agare="$(stat -c %U "$rot")"
# Allt utom systemctl körs som utcheckningens ägare (git vägrar annars "dubious ownership", och deploy.sh
# skriver till /var/www/tornstriden som ska ägas av samma konto – se DRIFT.md).
som_agare() { runuser -u "$agare" -- "$@"; }
cd "$rot"

pagaende() { curl -sf --max-time 5 "$halsa_url" | sed -n 's/.*"pagaende":\([0-9]*\).*/\1/p'; }
fore="$(som_agare git rev-parse --short HEAD)"
[[ -z "$(som_agare git status --porcelain)" ]] || { echo "Utcheckningen har lokala ändringar – rätta det först (git status)." >&2; exit 1; }
if ! systemctl is-active --quiet "$tjanst"; then
  echo "Tjänsten $tjanst kör inte; uppdaterar utan väntan."
  tvinga=1
fi

# 1–2. Underhållsläge och väntan.
if [[ $tvinga -eq 0 ]]; then
  systemctl kill -s SIGUSR1 "$tjanst"
  trap 'echo "Avbrutet – öppnar för nya matcher igen."; systemctl kill -s SIGUSR2 "$tjanst" || true' EXIT
  echo "Underhållsläge: inga nya matcher. Väntar på pågående (högst $vanta_min min) …"
  slut=$(( $(date +%s) + vanta_min * 60 ))
  while :; do
    n="$(pagaende || echo '?')"
    [[ "$n" == "0" ]] && { echo "Inga pågående matcher."; break; }
    if (( $(date +%s) >= slut )); then
      echo "Fortfarande $n pågående match(er) efter $vanta_min min – startar om ändå (27B: de avbryts utan vinnare)."
      break
    fi
    printf '  %s pågående match(er) … (%s)\n' "$n" "$(date +%H:%M:%S)"
    sleep 20
  done
fi

# 3. Säkerhetskopia (medan tjänsten kör – SQLite backup är konsekvent).
som_agare node --disable-warning=ExperimentalWarning drift/sakerhetskopia.mjs || { echo "Säkerhetskopian misslyckades – avbryter före uppdatering." >&2; exit 1; }

# 4. Kod, statiska filer, omstart.
trap - EXIT
if [[ -n "$till" ]]; then
  som_agare git fetch --quiet origin || true
  som_agare git reset --hard "$till"
else
  som_agare git pull --ff-only
fi
efter="$(som_agare git rev-parse --short HEAD)"
som_agare ./deploy.sh
systemctl restart "$tjanst"

# 5. Kontroll.
for i in 1 2 3 4 5 6 7 8 9 10; do
  if svar="$(curl -sf --max-time 3 "$halsa_url")"; then
    echo "Tjänsten svarar: $svar"
    echo "Uppdaterat $fore → $efter. Återgång: sudo drift/uppdatera.sh --till $fore --tvinga"
    exit 0
  fi
  sleep 1
done
echo "Tjänsten svarar inte på $halsa_url efter omstarten. Se: journalctl -u $tjanst -n 50" >&2
echo "Återgång till förra versionen: sudo drift/uppdatera.sh --till $fore --tvinga" >&2
exit 1
