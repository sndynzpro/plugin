# SubFX Studio · Subtítulos animados para Premiere Pro

Panel para Adobe Premiere Pro que convierte un archivo **.srt** en subtítulos con estilo y **efectos por palabra**. Eliges las palabras que quieres destacar, les aplicas un efecto del banco, cambias los colores a tu gusto y lo envías directamente a la línea de tiempo.

## Funciones

- **Carga de .srt / .vtt**: con el botón o arrastrando el archivo al panel.
- **Selección por palabras**: haz clic en cada palabra para seleccionarla, `Shift` + clic para un rango, o usa la selección rápida (Todas, Invertir, Iguales, Números, Palabras largas, Con efecto, buscador).
- **Banco de 28 efectos** con vista previa animada:
  - *Entrada*: Pop, Rebote, Zoom, Deslizar, Caída, Fundido, Desenfoque, Giro, Máquina de escribir, Elástico, Voltear.
  - *Énfasis*: Golpe, Temblor, Salto, Destello, Colorear, Girar 360, Latido, Marcador, Subrayado.
  - *Continuo*: Neón, Arcoíris, Ola, Bamboleo, Pulso, Nervioso, Glitch, Flotar.
- **Ajustes por palabra**: color del texto, color del efecto, tamaño, intensidad y velocidad.
- **9 estilos incluidos** (Hormozi, Beast, Caja viral, Neón, Karaoke, Minimal, Retro pop, Fuego y Cine). Todos se pueden modificar:
  - Tipografía: fuente (cualquiera instalada), grosor, mayúsculas, tamaño, espaciado e interlineado.
  - Color sólido o degradado, contorno, sombra y resplandor.
  - Resaltado tipo karaoke de la palabra que se está diciendo, con color, escala y caja de fondo.
  - Fondo por bloque o por línea, posición, ancho máximo y palabras por bloque.
  - Animación de entrada o salida del bloque y un efecto aplicado a todas las palabras.
  - Duplicar, renombrar, restablecer, eliminar, exportar e importar estilos (.json).
- **Vista previa en tiempo real** con línea de tiempo, fondo transparente, oscuro, escena, croma o una imagen tuya.
- **Deshacer y rehacer** (`Ctrl+Z` / `Ctrl+Shift+Z`) y **autoguardado** de la sesión.
- **Exportación a Premiere**: renderiza cada bloque como una secuencia PNG con transparencia a la resolución y los fps de tu secuencia, y la coloca en la pista que elijas (o en una pista nueva), sincronizada con el .srt.

## Instalación

Requiere Premiere Pro 2021 (v15) o posterior, en Windows o macOS.

### Windows
1. Descarga o clona esta carpeta.
2. Ejecuta `install/instalar-windows.bat` (doble clic).
3. Reinicia Premiere Pro y abre **Ventana → Extensiones → SubFX Studio**.

### macOS
1. Descarga o clona esta carpeta.
2. En Terminal: `bash install/instalar-mac.sh`
3. Reinicia Premiere Pro y abre **Ventana → Extensiones → SubFX Studio**.

El instalador activa `PlayerDebugMode` para que Premiere cargue extensiones sin firmar y copia el panel a la carpeta de extensiones CEP de tu usuario. Para distribuirlo sin ese paso, empaquétalo como `.zxp` firmado con [ZXPSignCmd](https://github.com/Adobe-CEP/CEP-Resources/tree/master/ZXPSignCMD).

## Cómo se usa

1. **Carga tu .srt** (en `assets/ejemplo.srt` hay uno de prueba).
2. **Elige un estilo** en la pestaña *Estilos* y ajústalo como quieras.
3. **Selecciona palabras** en la lista de subtítulos y haz clic en un efecto de la pestaña *Efectos*. Cámbiales el color, el tamaño o la intensidad.
4. En *Exportar*, elige la pista y pulsa **Renderizar e insertar en Premiere**.

> Consejo: el `.srt` solo trae el tiempo de cada subtítulo, no el de cada palabra. SubFX reparte el tiempo entre las palabras según su longitud. Si notas desfase, usa **Desfase de sincronía** en la pestaña Exportar.

Las secuencias PNG se guardan en `Documentos/SubFX Renders/<fecha>` (se puede cambiar) y se importan en una bandeja `SubFX <fecha>` del proyecto.

## Estructura

```
CSXS/manifest.xml     Manifiesto de la extensión CEP
index.html            Interfaz del panel
css/style.css         Diseño
js/effects.js         Banco de efectos por palabra
js/styles.js          Estilos incluidos y valores base
js/srt.js             Lector de .srt / .vtt
js/renderer.js        Motor de render (vista previa y exportación)
js/exporter.js        Render de secuencias PNG
js/cep.js             Puente con Premiere y sistema de archivos
js/app.js             Lógica de la interfaz
jsx/host.jsx          ExtendScript: lee la secuencia, importa y coloca los clips
install/              Instaladores para Windows y macOS
```

### Añadir un efecto propio
Agrega un objeto a `LIST` en `js/effects.js`:

```js
{
  id: 'miEfecto', name: 'Mi efecto', cat: 'hit', dur: 0.4, color: '#FFE600',
  desc: 'Descripción corta',
  apply(T, t, k, color) {
    // t = segundos desde que se dice la palabra, k = intensidad
    const s = 1 + 0.3 * k * Math.sin(Math.PI * Math.min(1, Math.max(0, t / this.dur)));
    T.sx *= s; T.sy *= s;
  }
}
```

Aparecerá automáticamente en el banco de efectos.

## Depuración

Con la extensión instalada, abre `http://localhost:8098` en Chrome para ver la consola del panel (el puerto se configura en `.debug`). También puedes abrir `index.html` en un navegador: todo el editor funciona en *modo navegador*, salvo la exportación a Premiere.
