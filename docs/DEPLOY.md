# Deploy: generar, instalar y probar

Todo el proceso en tres pasos. Requiere [Node.js 18+](https://nodejs.org) solo para generar y probar; quien instala el panel no lo necesita.

```bash
npm install          # una vez
npm run test:all     # comprobar
npm run build        # generar el .zip instalable
npm run sign         # firmar el .zxp (Windows o macOS)
```

## 1. Generar

| Comando | Qué hace |
| --- | --- |
| `npm run check` | Manifiesto, `.debug` y `package.json` con los mismos ids y versión; todos los scripts compilan; `host.jsx` sin sintaxis que ExtendScript no entiende (`let`, `const`, flechas…). |
| `npm run build` | Crea `dist/SubtitleEngine-Pro/` (la extensión limpia), `dist/SubtitleEngine-Pro-<versión>.zip` (extensión + instaladores + `LEEME.txt`) y `dist/build-info.json` (SHA-256 de cada archivo). |
| `npm run sign` | Firma `dist/SubtitleEngine-Pro` como `dist/SubtitleEngine-Pro-<versión>.zxp` y lo verifica. Sin certificado propio crea uno autofirmado en `certs/` (no se sube al repositorio). |
| `npm run release` | `check` + `test` + `build` + `sign` seguidos. |

Certificado propio para firmar: define `ZXP_CERT` (ruta al `.p12`) y `ZXP_CERT_PASSWORD`.

### Publicar una versión

1. Sube la versión en `package.json` y en `CSXS/manifest.xml` (`ExtensionBundleVersion` y `Extension Version`). `npm run check` avisa si no coinciden.
2. `git tag v2.0.1 && git push origin v2.0.1`
3. GitHub Actions prueba, genera el `.zip`, firma el `.zxp` en macOS y crea la release con los dos archivos.

Para firmar en CI con tu certificado, añade en *Settings → Secrets and variables → Actions*: `ZXP_CERT_BASE64` (el `.p12` en base64: `base64 -i cert.p12`) y `ZXP_CERT_PASSWORD`. Sin ellos se firma con un certificado autofirmado.

## 2. Instalar

Elige una opción. Después reinicia Premiere Pro y abre **Ventana → Extensiones → SubtitleEngine Pro**.

**A. Paquete `.zip` (recomendado para probar)**
Descomprime `SubtitleEngine-Pro-<versión>.zip` y ejecuta:
- Windows: doble clic en `install\instalar-windows.bat`
- macOS: `bash install/instalar-mac.sh`

Activa `PlayerDebugMode`, copia el panel a la carpeta de extensiones de tu usuario y quita la versión antigua *SubFX Studio*. Para desinstalar: `desinstalar-windows.bat` / `desinstalar-mac.sh`.

**B. Archivo `.zxp` firmado**
Con el instalador de Adobe (Creative Cloud 2022 o posterior):
- Windows: `"C:\Program Files\Common Files\Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe" /install "SubtitleEngine-Pro-2.0.0.zxp"`
- macOS: `"/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent" --install "SubtitleEngine-Pro-2.0.0.zxp"`

También sirve cualquier instalador de ZXP (por ejemplo *ZXP Installer* de aescripts).

**C. Desarrollo (desde el repositorio)**
- `npm run install:local` — build y copia a la carpeta de extensiones.
- `npm run dev` — enlaza la carpeta del repositorio: cada cambio se ve al cerrar y abrir el panel.
- `npm run uninstall:local` — lo quita.

Consola del panel: con Premiere abierto, entra en `http://localhost:8098` desde Chrome.

## 3. Probar

### Automático (sin Premiere)

| Comando | Cubre |
| --- | --- |
| `npm test` | Lectura/escritura SRT, VTT y ASS; hablantes; timecodes a 23.976–60 fps; presets 30X; migración de estilos antiguos; detección de silencios; curvas de Auto-Zoom. |
| `npm run test:ui` | Abre el panel en Chromium a 1440, 1000 y 420 px; renderiza los 23 presets; sombras y contornos; PNG estático vs. secuencia y caché; importar `.ass` con 2 hablantes; editar timecode, reemplazar, palabra clave; exportar `.ass`; silencios en un WAV; arrastrar bloques; diagnóstico. Capturas en `test-results/`. |

Si Playwright no tiene navegador: `npx playwright install chromium` (o define `CHROMIUM_PATH`).

GitHub Actions ejecuta todo en cada push, en cada pull request y **cada día a las 06:17 UTC**, para detectar a tiempo si algo se rompe.

### Diagnóstico dentro de Premiere

Pestaña **Render → Diagnóstico**. No modifica el proyecto. Comprueba versión de Premiere, proyecto y secuencia, lectura del cabezal, timecode, API QE (necesaria para la cuchilla y las pistas nuevas), marcadores, selección, efecto Movimiento, pistas bloqueadas, carpeta de render, Node.js, decodificador de audio, ffmpeg y fuentes. **Copiar informe** copia el resultado para compartirlo.

### Lista de pruebas manuales

Usa una secuencia de prueba (duplica la tuya). Todo se deshace con `Ctrl+Z` en Premiere.

| # | Prueba | Resultado esperado |
| --- | --- | --- |
| 1 | Diagnóstico | Sin errores (✗). |
| 2 | Importar `assets/ejemplo.srt`, preset *30X Default*, **Render a Timeline** en pista nueva | Pista «SubtitleEngine» con un PNG por bloque, alineado con el audio, duración correcta. |
| 3 | Preset *Hormozi* y render | Clips de secuencia PNG con la palabra activa animada. |
| 4 | Importar `tests/fixtures/dos-hablantes.ass` y render | Dos pistas (una por hablante), blanco y amarillo. |
| 5 | Repetir el render sin cambios | Mensaje «N reutilizados»: no vuelve a generar PNG. |
| 6 | **Seguir a Premiere** activado: reproducir en Premiere (también con J/K/L) y mover el cabezal desde el panel | El panel avanza fluido junto a Premiere, muestra «● EN VIVO» y el timecode coincide al fotograma. |
| 6b | **Timeline en vivo**: pausar en varios puntos | El fondo del panel pasa a ser el fotograma real del timeline en menos de un segundo. |
| 6c | **Vista previa** (botón de arriba) dos veces seguidas | Se crea la pista «SubtitleEngine Preview» y la segunda vez se reemplaza, sin pistas duplicadas. |
| 6d | Render final en una secuencia de 29.97 fps de más de 10 min | Cada clip empieza y termina en un fotograma entero; al final no hay deriva respecto al audio. |
| 6e | Elegir una resolución distinta a la de la secuencia y renderizar | Aviso que ofrece usar la resolución de la secuencia (sin escalado ni deformación). |
| 7 | **Capturar fotograma** | El fotograma de Premiere aparece de fondo en la vista previa. |
| 8 | Herramientas → Silencios → **Analizar** (acción *Solo marcadores*) | Marcadores «Silencio» en las pausas reales. |
| 9 | Silencios con *Ripple delete* | Pausas eliminadas en todas las pistas sin desincronizar vídeo y audio; subtítulos reajustados. |
| 10 | Seleccionar clips → Auto-Zoom *Por corte*, *Smooth* | Keyframes de Escala 100 % → 120 % al inicio de cada clip. |
| 11 | Auto-Zoom con punto focal *Tercio superior* | Además keyframes de Posición: el rostro no se sale del cuadro. |
| 12 | Exportar `.srt` y `.ass` | Se abren en Premiere / VLC con los tiempos correctos. |
| 13 | **Transcribir** con la API (clave de OpenAI o Groq) una secuencia con pausas largas | Subtítulos con tiempo por palabra; nada inventado en los silencios; al reproducir, el karaoke coincide con la voz. |
| 14 | **Transcribir** con whisper.cpp local (Buscar → Descargar modelo) | Igual que la 13 sin conexión; barra de progreso de whisper.cpp. |
| 15 | Transcribir solo entre marcas de entrada/salida | Solo aparece el texto de ese tramo, en su tiempo de secuencia. |
| 16 | **Vídeo → Crear proxy del timeline** y reproducir en el panel | Vídeo con audio bajo los subtítulos; al pausar, texto e imagen coinciden en el mismo fotograma. Cambiar el estilo se ve al instante. |
| 17 | Proxy + **Seguir a Premiere** y reproducir en Premiere | El proxy del panel sigue la reproducción (silenciado) sin derivar. |
| 18 | Quitar silencios con clips enlazados y un título en V2 que cubre parte de una pausa | Vídeo, audio y V2 siguen sincronizados después de cada corte. |
| 19 | Apariencia: cambiar tema, acento y densidad | Todo el panel cambia al instante y se recuerda al reabrir. |

Si algo falla, copia el informe del diagnóstico y la consola (`http://localhost:8098`) y compártelos.
