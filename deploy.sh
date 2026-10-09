#!/usr/bin/env bash
# Kopiera webbspelsfiler från denna utcheckning till webbserverns katalog.
set -euo pipefail
umask 022

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  printf 'Användning: %s [/absolut/sökväg/till/webbkatalog]\n' "$0"
  printf 'Standardmål: /var/www/tornstriden (skapas om det saknas).\n'
  printf 'Alternativt: DEPLOY_DIR=/absolut/sökväg %s\n' "$0"
  exit 0
fi

fail() { printf 'Fel: %s\n' "$*" >&2; exit 1; }
[[ $# -le 1 ]] || fail 'Ange endast en målkatalog.'
target="${1:-${DEPLOY_DIR:-/var/www/tornstriden}}"
[[ "$target" == /* ]] || fail 'Ange en absolut målkatalog, exempelvis /var/www/tornstriden.'
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

# Explicit lista: Git-data, lokala inställningar och utvecklingsverktyg publiceras inte.
files=(
  spelbord.html match.html textkort.html effekter.html
  spelbord.css match.css bildeffekter.css effektverkstad.css tokens.css
  spelbord.js kort.js strid.js matchregler.js match.js matchvy.js dator.js bildeffekter.js kortoversikt.js effektverkstad.js
  LICENSE
)
for file in "${files[@]}"; do
  [[ -f "$source_dir/$file" ]] || fail "Källfil saknas: $file"
done
[[ -d "$source_dir/assets" ]] || fail 'Katalogen assets saknas.'

mkdir -p -- "$target"
target="$(cd -- "$target" && pwd -P)"
[[ "$target" != / ]] || fail 'Rotkatalogen får inte användas som mål.'
[[ "$target" != "$source_dir" ]] || fail 'Målet måste vara en annan katalog än Git-utcheckningen.'
[[ "$source_dir/" != "$target/"* ]] || fail 'Målet får inte vara en överordnad katalog till Git-utcheckningen.'
[[ "$target/" != "$source_dir/"* ]] || fail 'Målet får inte ligga inuti Git-utcheckningen.'

printf 'Källa: %s\nMål:   %s\n' "$source_dir" "$target"
for file in "${files[@]}"; do
  install -m 644 -- "$source_dir/$file" "$target/$file"
done
while IFS= read -r -d '' asset; do
  relative="${asset#"$source_dir/"}"
  mkdir -p -- "$target/$(dirname -- "$relative")"
  install -m 644 -- "$asset" "$target/$relative"
done < <(find "$source_dir/assets" -type f ! -name '.DS_Store' -print0)

# Gör matchen till startsida även när webbservern använder index.html.
install -m 644 -- "$source_dir/match.html" "$target/index.html"
printf 'Klart! Webbspelsfilerna är uppdaterade i %s\n' "$target"
