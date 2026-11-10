#!/usr/bin/env bash
# inbox/ の写真を公開用に整える:
#   - HEIC → JPG 変換
#   - 向きを正しくし、EXIF (位置情報など) を削除
#   - 長辺 1600px に縮小、JPG 品質 85
#   - 拡張子を小文字 .jpg に統一
set -euo pipefail
cd "$(dirname "$0")/.."
shopt -s nullglob nocaseglob

heics=(inbox/*.heic inbox/*.heif)
if [ ${#heics[@]} -gt 0 ]; then
  sudo apt-get update -qq && sudo apt-get install -y -qq libheif-examples >/dev/null
  for f in "${heics[@]}"; do
    heif-convert -q 92 "$f" "${f%.*}.jpg" >/dev/null
    rm -f "$f"
  done
fi

for f in inbox/*.jpg inbox/*.jpeg inbox/*.png inbox/*.webp; do
  out="${f%.*}.jpg"
  tmp="${f%.*}.tmp.jpg"
  convert "$f" -auto-orient -strip -resize '1600x1600>' -quality 85 "$tmp"
  rm -f "$f"
  mv "$tmp" "$out"
done

echo "inbox/ の写真:"; ls -la inbox | grep -v README.md || true
