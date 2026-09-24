#!/bin/bash
# Instalador de SubFX Studio para Adobe Premiere Pro (macOS)
set -e
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/SubFX-Studio"

echo "Activando extensiones sin firmar (PlayerDebugMode)…"
for v in 9 10 11 12 13; do defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1; done

echo "Copiando archivos a: $DEST"
mkdir -p "$DEST"
rsync -a --delete --exclude ".git" --exclude "install" --exclude "node_modules" --exclude "*.zxp" "$SRC/" "$DEST/"

echo
echo "Listo. Reinicia Premiere Pro y abre: Ventana > Extensiones > SubFX Studio"
