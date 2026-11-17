#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PAGE_DIR="$ROOT/assets/exams/2026_suneung_english_odd/pages"
AUDIO_DIR="$ROOT/assets/audio"
AUDIO_FILE="$AUDIO_DIR/2026_suneung_english_listening.mp3"
KICE_PDF="https://cdn.kice.re.kr/suneung-26/suneung-26_3.pdf"
EBSI_AUDIO="https://wdown.ebsi.co.kr/W61001/01exam/20251113/go3/eng_1_mp3_83X8155G.mp3"

mkdir -p "$PAGE_DIR" "$AUDIO_DIR"

complete=1
for number in $(seq 1 8); do
  n="$(printf '%02d' "$number")"
  [[ -s "$PAGE_DIR/page-$n.jpg" ]] || complete=0
done
[[ -s "$AUDIO_FILE" ]] || complete=0

if [[ "$complete" -eq 1 && "${FORCE_REFRESH_ENGLISH_ASSETS:-0}" != "1" ]]; then
  echo "Official English CSAT source pages and listening audio already exist; keeping the checked-in assets."
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading the official KICE 2026 CSAT English question paper..."
curl --fail --location --retry 3 --retry-delay 2 \
  --user-agent "Mozilla/5.0 (compatible; StudyAppAssetBuilder/1.0)" \
  "$KICE_PDF" -o "$TMP/english-odd-even.pdf"

command -v pdfinfo >/dev/null 2>&1 || {
  echo "pdfinfo is required. Install poppler-utils before running this script." >&2
  exit 1
}
command -v pdftoppm >/dev/null 2>&1 || {
  echo "pdftoppm is required. Install poppler-utils before running this script." >&2
  exit 1
}

page_count="$(pdfinfo "$TMP/english-odd-even.pdf" | awk '/^Pages:/ {print $2}')"
if [[ -z "$page_count" || "$page_count" -lt 8 ]]; then
  echo "Unexpected page count in KICE English PDF: ${page_count:-unknown}" >&2
  exit 1
fi

echo "Rendering the eight odd-form pages (1–8) as local JPEG assets..."
pdftoppm -f 1 -l 8 -jpeg -scale-to-x 1600 -scale-to-y -1 \
  -jpegopt quality=86 "$TMP/english-odd-even.pdf" "$TMP/english-page"

for number in $(seq 1 8); do
  n="$(printf '%02d' "$number")"
  source="$TMP/english-page-$n.jpg"
  if [[ ! -s "$source" ]]; then
    source="$TMP/english-page-$number.jpg"
  fi
  target="$PAGE_DIR/page-$n.jpg"
  [[ -s "$source" ]] || {
    echo "Missing rendered page $n from the KICE PDF." >&2
    find "$TMP" -maxdepth 1 -type f -name 'english-page-*.jpg' -print >&2
    exit 1
  }
  mv "$source" "$target"
done

echo "Downloading the 2026 CSAT English listening recording from EBSi..."
curl --fail --location --retry 3 --retry-delay 2 \
  --referer "https://www.ebsi.co.kr/" \
  --user-agent "Mozilla/5.0 (compatible; StudyAppAssetBuilder/1.0)" \
  "$EBSI_AUDIO" -o "$AUDIO_FILE"

audio_type="$(file --brief --mime-type "$AUDIO_FILE")"
if [[ "$audio_type" != "audio/mpeg" ]]; then
  echo "Unexpected EBSi listening file type: $audio_type" >&2
  exit 1
fi

for number in $(seq 1 8); do
  n="$(printf '%02d' "$number")"
  [[ -s "$PAGE_DIR/page-$n.jpg" ]] || exit 1
done
[[ -s "$AUDIO_FILE" ]] || exit 1

echo "Prepared 8 official KICE page images and the EBSi listening MP3."
du -h "$PAGE_DIR"/*.jpg "$AUDIO_FILE"
