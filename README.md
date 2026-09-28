# SubtitleEngine Pro · Subtítulos de alta fidelidad para Premiere Pro

Panel CEP para Adobe Premiere Pro que convierte un **.srt / .ass** en subtítulos renderizados como **PNG-32 transparentes** (Canvas 2D → PNG) y los coloca sincronizados en la timeline. Incluye los presets del Playbook **30X Media**, un paquete de presets virales, **Auto-Zoom** paramétrico y **eliminación de silencios**.

La implementación sigue `SubtitleEngine_Pro_Plan_Arquitectura.pdf`.

## Módulos

| Módulo | Qué hace |
| --- | --- |
| **01 · SRT Engine** | Importa `.srt`, `.vtt`, `.ass` y `.ssa` (parser tolerante, milisegundos, hablantes `NOMBRE:`, `[Nombre]`, `<v Nombre>` o campo *Name* de ASS). Exporta `.srt` y `.ass` con estilos. Timecodes `HH:MM:SS:FF` según los fps de la secuencia (24, 25, 29.97, 30, 59.94, 60…). |
| **02 · Editor y timeline** | Lista editable: timecodes de entrada/salida, texto completo o palabra a palabra (doble clic), agregar y eliminar líneas, buscar y reemplazar. Mini-timeline con bloques que se arrastran y se recortan por los bordes. **Sync TC**: cabezal sincronizado con Premiere en ambos sentidos. |
| **03 · Style Engine** | Menús abatibles con memoria: tipografía (peso 100-900, casing, kerning, line height, alineación), color sólido o gradiente lineal/radial con ángulo, opacidad, **3 capas de contorno** (outside / inside / centered, round / bevel / miter), **3 sombras** (ángulo, distancia, blur, opacidad, color), resplandor, fondos por frase / línea / palabra con **glassmorphism**, márgenes de seguridad y animaciones (Pop, Fade, Bounce, Typewriter, Glitch, Slide, Zoom). |
| **03B · Líneas paralelas** | Hasta 4 capas simultáneas, cada una con su propio preset (p. ej. Speaker 1 blanco, Speaker 2 amarillo). Cada capa va a su propia pista de vídeo. |
| **04 · Preview en vivo** | Canvas a la resolución de la secuencia (9:16, 16:9, 1:1, 4:5, 4K), guías de zona segura y **captura del fotograma actual de Premiere** como fondo. |
| **05 · Preset Manager** | Galería por categorías (Virales, 30X Media, Social, Cine, Minimal, Míos), guardar como nuevo preset, aplicar a subtítulos seleccionados, importar/exportar JSON. |
| **06 · Auto-Zoom** | Keyframes de Escala (y Posición según el punto focal) en el efecto Movimiento: zoom base y máximo, dirección, curva (Smooth, Linear, Exponential snappy), 6-15 fotogramas de transición, disparadores por corte, silencio o intervalo, punto focal centrado / tercio superior / personalizado. |
| **07 · Silence Remover** | Umbral -50 a -25 dB, pausa mínima 0.25-0.8 s, padding in/out. Acciones: ripple delete, acortar pausas a 0.15 s o solo marcadores. Opcionalmente reajusta los subtítulos ya cargados. |
| **08 · PNG Renderer** | Bloques sin animación → **un único PNG**; bloques animados → secuencia PNG. Nombres `[índice]_[timecode]_[hash].png`; si el hash ya existe en la carpeta no se vuelve a renderizar. Todo se importa en una bandeja del proyecto y se coloca en una pista «SubtitleEngine». |

### Presets incluidos

- **30X Media** (Playbook): *30X Default* (Inter Bold, `#F6F5F0`, minúsculas, centrado, sombra negra 65 %, palabra clave `#FAFF96`, márgenes 250 / 380 px en 1080×1920), *30X Hook* (MAYÚSCULAS, alineado a la izquierda), *30X Speaker 2* (amarillo, para clips bicolor) y *30X Portada*.
- **Virales**: Hormozi, Hormozi verde, Beast, Caja viral, Iman, Ali Abdaal, Devin, TikTok clásico, Pop 3D, Gaming.
- **Social / Cine / Minimal**: Glass, Neón, Karaoke, Podcast 2 voces, Lujo, Cine, Minimal, Retro pop, Fuego.

## Generar, instalar y probar

```bash
npm install && npm run test:all   # comprobaciones + tests unitarios + pruebas de interfaz
npm run build                      # dist/SubtitleEngine-Pro-<versión>.zip con instaladores
npm run sign                       # .zxp firmado (Windows o macOS)
```

Guía completa, lista de pruebas en Premiere y publicación de versiones: [docs/DEPLOY.md](docs/DEPLOY.md). Dentro del panel, **Render → Diagnóstico** comprueba Premiere, disco, audio y fuentes sin tocar el proyecto.

## Instalación

Requiere Premiere Pro 2021 (v15) o posterior, en Windows o macOS.

- **Windows**: ejecuta `install/instalar-windows.bat`.
- **macOS**: `bash install/instalar-mac.sh`.

Reinicia Premiere Pro y abre **Ventana → Extensiones → SubtitleEngine Pro**. El instalador activa `PlayerDebugMode` (extensiones sin firmar) y, si existe, retira la versión anterior *SubFX Studio*. Para distribuirlo sin ese paso, empaquétalo como `.zxp` firmado con [ZXPSignCmd](https://github.com/Adobe-CEP/CEP-Resources/tree/master/ZXPSignCMD).

## Flujo de trabajo

1. **Crudo y limpieza**: *Herramientas → Eliminación de silencios*. Pulsa **Analizar**: los silencios aparecen en rojo sobre la mini-timeline. Luego **Ripple Cut**.
2. **Ingesta**: importa el `.srt` de Whisper / Premiere Transcribe o crea líneas con **+ Agregar línea**.
3. **Estilo**: elige *30X Default* (o un preset viral), pulsa **Palabra clave auto** para destacar la palabra de mayor impacto de cada frase y ajusta lo que quieras.
4. **Ritmo**: selecciona clips en Premiere y aplica **Auto-Zoom**. La gráfica muestra la curva antes de aplicarla.
5. **Render a Timeline**: genera los PNG y los coloca sincronizados.

> El `.srt` solo trae el tiempo de cada subtítulo, no de cada palabra: el karaoke reparte el tiempo según la longitud de cada palabra. Si notas desfase, usa **Desfase de sincronía** en *Render*.

### Notas

- La **decodificación de audio** usa el decodificador del panel. Si el códec del clip no es compatible, se usa `ffmpeg` cuando está instalado en el sistema. También puedes analizar un archivo de audio de tu equipo con **Analizar archivo…**.
- El **ripple delete** corta en todas las pistas desbloqueadas y desplaza también las pistas que no tenían contenido en el silencio, para no desincronizarlas. Se deshace con `Ctrl+Z` en Premiere.
- El efecto **glass** se simula (tinte, borde y brillo) porque un PNG transparente no puede desenfocar el vídeo que tiene detrás.

## Estructura

```
CSXS/manifest.xml     Manifiesto de la extensión CEP
index.html            Interfaz del panel
css/style.css         Diseño
js/srt.js             01 · Lectura/escritura .srt/.vtt/.ass y timecodes
js/styles.js          03/05 · Parámetros de estilo y presets
js/effects.js         Banco de 28 efectos por palabra
js/renderer.js        03/03B · Motor Canvas 2D (vista previa y render)
js/exporter.js        08 · Pipeline PNG-32
js/audio.js           07 · Detección de silencios
js/zoom.js            06 · Plan de keyframes del Auto-Zoom
js/cep.js             Puente con Premiere y sistema de archivos
js/app.js             Lógica de la interfaz
jsx/host.jsx          ExtendScript: secuencia, cabezal, importación, zoom y cortes
install/              Instaladores para Windows y macOS
scripts/              check, build, sign e instalación local
tests/                Tests unitarios (node:test) y de interfaz (Playwright)
.github/workflows/    CI: pruebas en cada push y cada día, release firmada con cada tag
```

## Depuración

Con la extensión instalada, abre `http://localhost:8098` en Chrome para ver la consola del panel. También puedes abrir `index.html` en un navegador: el editor, los estilos, la vista previa y el análisis de silencios de un archivo local funcionan en *modo navegador*; lo que toca la timeline necesita Premiere.
