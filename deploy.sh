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
  spelbord.css match.css bildeffekter.css effektverkstad.css tokens.css grafik.css popup.css
  spelbord.js kort.js strid.js matchregler.js match.js matchvy.js dator.js bildeffekter.js kortoversikt.js effektverkstad.js grafik.js popup.js ljud.js
  kontrakt.js lokalmatch.js onlinematch.js kortlupp.js nedrakning.js
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

# Versionsstämpel mot webbläsarnas cache: i de kopierade html-, css- och js-filerna får varje
# referens till skript, stilmallar, moduler och assets tillägget ?v=<version> (Git-hashen, med
# klockslag om utcheckningen har osparade ändringar). Nya adresser vid varje deploy gör att
# webbläsaren hämtar nya filer utan hård omladdning och aldrig blandar ny HTML med gamla moduler.
# HTML-sidorna själva valideras alltid mot servern (apache/tornstriden-cache.conf). Källfilerna rörs inte.
version="$(git -C "$source_dir" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
[[ -z "$(git -C "$source_dir" status --porcelain 2>/dev/null)" ]] || version="$version-$(date +%H%M%S)"
stamp() {   # stdin → stdout
  sed -E \
    -e "s~((href|src)=\"[A-Za-z0-9_-]+\.(css|js))\"~\1?v=$version\"~g" \
    -e "s~(from '\./[A-Za-z0-9_-]+\.js)'~\1?v=$version'~g" \
    -e "s~(assets/[^\"'\`)#[:space:]]+)([\"'\`)#])~\1?v=$version\2~g"
}
tmp="$(mktemp)"
trap 'rm -f -- "$tmp"' EXIT

printf 'Källa:   %s\nMål:     %s\nVersion: %s\n' "$source_dir" "$target" "$version"
for file in "${files[@]}"; do
  case "$file" in
    *.html|*.css|*.js) stamp < "$source_dir/$file" > "$tmp" && install -m 644 -- "$tmp" "$target/$file" ;;
    *) install -m 644 -- "$source_dir/$file" "$target/$file" ;;
  esac
done
while IFS= read -r -d '' asset; do
  relative="${asset#"$source_dir/"}"
  mkdir -p -- "$target/$(dirname -- "$relative")"
  install -m 644 -- "$asset" "$target/$relative"
done < <(find "$source_dir/assets" -type f ! -name '.DS_Store' ! -name '*.md' -print0)

# Gör matchen till startsida även när webbservern använder index.html.
install -m 644 -- "$target/match.html" "$target/index.html"
printf 'Klart! Webbspelsfilerna är uppdaterade i %s (version %s)\n' "$target" "$version"
