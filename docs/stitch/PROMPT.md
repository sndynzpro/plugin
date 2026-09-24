# Rediseño en Google Stitch — guía rápida

1. Entra en https://stitch.withgoogle.com e inicia sesión.
2. Elige **Web** y el modo **Experimental** (permite subir imágenes).
3. Sube las capturas de esta carpeta (`1-efectos.png`, `2-estilos.png`, `3-exportar.png`, `4-panel-estrecho.png`).
4. Pega el prompt de abajo (en inglés, porque Stitch responde mejor así).
5. Cuando te guste un resultado: **Export → Code (HTML/CSS)** o descarga las imágenes, y pásamelas. Yo adapto el diseño al plugin sin romper la funcionalidad.

---

## Prompt (copiar y pegar)

```
Redesign the UI of "SubFX Studio", a docked extension panel inside Adobe Premiere Pro
(dark app, video editors, used for hours). Keep ALL existing features; improve visual
hierarchy, clarity and UX. Attached screenshots show the current version.

What the panel does:
- Loads an .srt subtitle file. Each subtitle is shown as a row of clickable word chips.
- The user selects individual words (click toggles, Shift+click = range, quick-select
  filters: All, None, Invert, Same words, Numbers, Long words, With effect, search box).
- Applies animated effects from a bank of 28 effects in 3 categories
  (Entrance, Emphasis, Continuous). Each effect card shows a small animated preview "WOW".
- Per-word overrides: text color, effect color (swatches + custom), size, intensity, speed.
- Caption styles: gallery of 9 presets with thumbnails (Hormozi, Beast, Viral box, Neon,
  Karaoke, Minimal, Retro pop, Fire, Cinema) + a long editor (typography, color/gradient,
  karaoke active-word highlight, stroke/shadow/glow, background box, layout/position,
  block animation). Actions: duplicate, rename, reset, delete, export, import.
- Live video preview (16:9 or 9:16) with play button, timecode and a mini timeline
  with subtitle blocks.
- Export tab: active sequence info, resolution, fps, target video track, start position,
  sync offset, output folder, big "Render & insert into Premiere" button with progress bar.

Layout constraints:
- Must work from 380 px wide (narrow docked panel) up to ~1400 px (two columns:
  preview + subtitles on the left, inspector tabs on the right).
- Dark theme that fits Premiere Pro (#1d1d1d-ish surroundings), one strong accent
  (current: violet→pink gradient). High contrast text, 12–13 px base size, compact density.
- The selected-words state and "which words already have an effect" must be obvious at a glance.
- The main flow must feel like 1-2-3: load SRT → select words → apply effect → send to Premiere.

Please deliver: the wide two-column layout, the narrow 380 px layout, and the Styles
editor screen. Spanish UI labels.
```

## Qué pedirle a Stitch si quieres variantes

- "Make it feel more premium, like CapCut / Submagic, but still compact."
- "Show a version with the inspector as a bottom sheet in narrow mode."
- "Make the effect bank a horizontal carousel grouped by category."
- "Add an onboarding empty state for when no SRT is loaded."
