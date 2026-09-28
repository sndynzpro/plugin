#!/bin/bash
# Instalador de SubtitleEngine Pro para Adobe Premiere Pro (macOS)
set -e
SRC="$(cd "$(dirname "$0")/.." && pwd)"
EXT="$HOME/Library/Application Support/Adobe/CEP/extensions"
DEST="$EXT/SubtitleEngine-Pro"

if [ ! -f "$SRC/CSXS/manifest.xml" ]; then
  echo "ERROR: no encuentro CSXS/manifest.xml junto a la carpeta install."
  echo "Descomprime el .zip completo y ejecuta este script desde dentro de esa carpeta."
  exit 1
fi

echo "Activando extensiones sin firmar (PlayerDebugMode)…"
for v in 9 10 11 12 13 14 15 16; do defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1; done
# macOS guarda las preferencias en caché: se refrescan para que Premiere lea el cambio
killall cfprefsd 2>/dev/null || true

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
echo "Comprobación:"
MENU=$(sed -n 's:.*<Menu>\(.*\)</Menu>.*:\1:p' "$DEST/CSXS/manifest.xml")
VER=$(sed -n 's:.*ExtensionBundleVersion="\([^"]*\)".*:\1:p' "$DEST/CSXS/manifest.xml")
[ -f "$DEST/index.html" ] && echo "  ✓ Panel instalado: $MENU $VER" || echo "  ✗ Falta index.html en $DEST"
echo "  ✓ PlayerDebugMode (CSXS.12): $(defaults read com.adobe.CSXS.12 PlayerDebugMode 2>/dev/null || echo '?')"
echo
echo "Listo. CIERRA Premiere Pro por completo (Cmd+Q) y ábrelo de nuevo."
echo "Luego: Ventana > Extensiones > $MENU"
echo "(en algunas versiones el menú se llama «Extensiones (heredadas)»)"
