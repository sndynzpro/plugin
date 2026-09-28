#!/bin/bash
# Instalador de SubtitleEngine Pro para Adobe Premiere Pro (macOS)
set -e
SRC="$(cd "$(dirname "$0")/.." && pwd)"
EXT="$HOME/Library/Application Support/Adobe/CEP/extensions"
DEST="$EXT/SubtitleEngine-Pro"

echo "Activando extensiones sin firmar (PlayerDebugMode)…"
for v in 9 10 11 12 13; do defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1; done

if [ -d "$EXT/SubFX-Studio" ]; then
  echo "Quitando la versión anterior (SubFX Studio)…"
  rm -rf "$EXT/SubFX-Studio"
fi

echo "Copiando archivos a: $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
(cd "$SRC" && tar cf - --exclude ".git" --exclude "./install" --exclude "./docs" --exclude "./dist" --exclude "./tests" \
  --exclude "./scripts" --exclude "./node_modules" --exclude "*.zxp" --exclude "*.pdf" .) | (cd "$DEST" && tar xf -)

echo
echo "Listo. Reinicia Premiere Pro y abre: Ventana > Extensiones > SubtitleEngine Pro"
