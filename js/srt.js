/*
 * SubtitleEngine Pro — Motor de subtítulos (módulo 01).
 * Lee .srt / .vtt / .ass / .ssa y exporta .srt / .ass.
 * También convierte segundos ↔ timecode de secuencia (HH:MM:SS:FF).
 */
(function (root) {
  'use strict';

  const TIME_RE = /(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/;

  function parseTime(s) {
    const m = TIME_RE.exec(s);
    if (!m) return NaN;
    const h = m[1] ? +m[1] : 0;
    return h * 3600 + +m[2] * 60 + +m[3] + +(m[4] + '00').slice(0, 3) / 1000;
  }

  function cleanText(s) {
    return s
      .replace(/<[^>]+>/g, '')        // <i>, <b>, <font ...>
      .replace(/\{\\[^}]*\}/g, '')    // {\an8}
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Separa "NOMBRE: texto" o "[Nombre] texto" (marca de hablante habitual en transcripciones). */
  function splitSpeaker(text) {
    const m = /^\s*(?:\[([^\]]{1,24})\]|([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9 .]{0,22}):)\s+(.+)$/.exec(text);
    if (!m) return { speaker: '', text };
    return { speaker: (m[1] || m[2]).trim(), text: m[3] };
  }

  /** SRT y WebVTT. Devuelve [{start, end, text, speaker}] ordenado por inicio. */
  function parseSRT(src) {
    const blocks = src.split(/\n[ \t]*\n/);
    const cues = [];
    for (const block of blocks) {
      const lines = block.split('\n');
      const ti = lines.findIndex(l => l.indexOf('-->') !== -1);
      if (ti === -1) continue;
      const [a, b] = lines[ti].split('-->');
      const start = parseTime(a), end = parseTime(b);
      if (isNaN(start) || isNaN(end)) continue;
      let raw = lines.slice(ti + 1).join(' ');
      let speaker = '';
      const v = /^<v(?:\.[^ >]*)?\s+([^>]+)>/.exec(raw.trim()); // <v Nombre> de WebVTT
      if (v) speaker = v[1].trim();
      let body = cleanText(raw);
      if (!speaker) { const sp = splitSpeaker(body); speaker = sp.speaker; body = sp.text; }
      if (!body) continue;
      cues.push({ start, end: Math.max(end, start + 0.1), text: body, speaker });
    }
    return cues;
  }

  /** Advanced SubStation Alpha (.ass / .ssa): usa la sección [Events]. */
  function parseASS(src) {
    const cues = [];
    let format = null, inEvents = false;
    src.split('\n').forEach(line => {
      const t = line.trim();
      if (/^\[.*\]$/.test(t)) { inEvents = /^\[events\]$/i.test(t); return; }
      if (!inEvents) return;
      const m = /^(\w+):\s*(.*)$/.exec(t);
      if (!m) return;
      if (/^format$/i.test(m[1])) { format = m[2].split(',').map(s => s.trim().toLowerCase()); return; }
      if (!/^dialogue$/i.test(m[1])) return;
      const f = format || ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
      const parts = m[2].split(',');
      const vals = parts.slice(0, f.length - 1).concat(parts.slice(f.length - 1).join(','));
      const get = k => { const i = f.indexOf(k); return i === -1 ? '' : (vals[i] || '').trim(); };
      const start = parseTime(get('start').replace(/\.(\d{2})$/, '.$10'));
      const end = parseTime(get('end').replace(/\.(\d{2})$/, '.$10'));
      if (isNaN(start) || isNaN(end)) return;
      const body = cleanText(get('text').replace(/\\[Nn]/g, ' ').replace(/\\h/g, ' '));
      if (!body) return;
      cues.push({ start, end: Math.max(end, start + 0.1), text: body, speaker: get('name') || get('actor') });
    });
    return cues;
  }

  function parse(text) {
    const src = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const cues = /^\s*\[script info\]/i.test(src) || /^\s*dialogue:/im.test(src) ? parseASS(src) : parseSRT(src);
    cues.sort((x, y) => x.start - y.start);
    return cues;
  }

  // ───────────── Exportación ─────────────
  const pad = (n, l) => String(Math.floor(n)).padStart(l, '0');

  function srtTime(s) {
    const ms = Math.max(0, Math.round(s * 1000));
    return `${pad(ms / 3600000, 2)}:${pad(ms / 60000 % 60, 2)}:${pad(ms / 1000 % 60, 2)},${pad(ms % 1000, 3)}`;
  }
  function assTime(s) {
    const cs = Math.max(0, Math.round(s * 100));
    return `${Math.floor(cs / 360000)}:${pad(cs / 6000 % 60, 2)}:${pad(cs / 100 % 60, 2)}.${pad(cs % 100, 2)}`;
  }

  /** cues = [{start, end, text, speaker?}] */
  function toSRT(cues) {
    return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.speaker ? c.speaker + ': ' : ''}${c.text}\n`).join('\n');
  }

  function assColor(hex, alpha) {
    const h = String(hex || '#FFFFFF').replace('#', '').padEnd(6, '0');
    const a = Math.round((1 - (alpha == null ? 1 : alpha)) * 255);
    return '&H' + [a, parseInt(h.slice(4, 6), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(0, 2), 16)]
      .map(v => v.toString(16).toUpperCase().padStart(2, '0')).join('');
  }

  /**
   * layers = [{ name, style }] — un estilo ASS por capa/hablante.
   * cues   = [{start, end, text, layer}]
   */
  function toASS(cues, layers, W, H) {
    const styleLine = (name, st) => {
      const scale = Math.min(W, H) / 1080;
      const an = st.align === 'left' ? 1 : st.align === 'right' ? 3 : 2;
      return 'Style: ' + [
        name.replace(/,/g, ' '), st.font, Math.round(st.size * scale),
        assColor(st.color, st.opacity), assColor(st.hlColor), assColor(st.strokeColor),
        assColor(st.bg !== 'none' ? st.bgColor : st.shadowColor, st.bg !== 'none' ? st.bgOpacity : st.shadowOpacity),
        st.weight >= 600 ? -1 : 0, st.italic ? -1 : 0, 0, 0, 100, 100,
        Math.round((st.letterSpacing || 0) * st.size * scale), 0,
        st.bg !== 'none' ? 3 : 1, Math.round((st.strokeWidth || 0) * scale),
        Math.round((st.shadowOpacity > 0 ? st.shadowDist : 0) * scale), an,
        Math.round((st.safeSide || 40) * scale), Math.round((st.safeSide || 40) * scale),
        Math.round(H * (100 - st.posY) / 100 * 0.9), 1
      ].join(',');
    };
    const out = [
      '[Script Info]', '; SubtitleEngine Pro', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`,
      'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding'
    ];
    layers.forEach(l => out.push(styleLine(l.name, l.style)));
    out.push('', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');
    cues.forEach(c => {
      const l = layers[c.layer || 0] || layers[0];
      const text = l.style.case === 'upper' ? c.text.toLocaleUpperCase() : l.style.case === 'lower' ? c.text.toLocaleLowerCase() : c.text;
      out.push(`Dialogue: ${c.layer || 0},${assTime(c.start)},${assTime(c.end)},${l.name.replace(/,/g, ' ')},${(c.speaker || '').replace(/,/g, ' ')},0,0,0,,${text}`);
    });
    return out.join('\n') + '\n';
  }

  // ───────────── Timecode de secuencia ─────────────
  /** 29.97 / 59.94 se muestran con cuadros nominales (30 / 60) como hace Premiere en NDF. */
  function toTC(s, fps) {
    const nominal = Math.round(fps || 30);
    const total = Math.max(0, Math.round(s * (fps || 30)));
    const f = total % nominal;
    const secs = Math.floor(total / nominal);
    return `${pad(secs / 3600, 2)}:${pad(secs / 60 % 60, 2)}:${pad(secs % 60, 2)}:${pad(f, 2)}`;
  }

  /** Acepta HH:MM:SS:FF, HH:MM:SS,mmm, MM:SS.s o segundos. */
  function fromTC(str, fps) {
    const s = String(str || '').trim().replace(/;/g, ':');
    if (/^\d+(\.\d+)?$/.test(s)) return +s;
    let m = /^(\d+):(\d{1,2}):(\d{1,2}):(\d{1,3})$/.exec(s);
    if (m) {
      const nominal = Math.round(fps || 30);
      return ((+m[1] * 3600 + +m[2] * 60 + +m[3]) * nominal + +m[4]) / (fps || 30);
    }
    m = /^(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(s);
    if (m) return +m[1] * 60 + +m[2];
    return parseTime(s);
  }

  const SAMPLE = `1
00:00:00,300 --> 00:00:02,600
Esto es SubtitleEngine Pro para Premiere

2
00:00:02,700 --> 00:00:05,200
Selecciona cualquier palabra y dale un efecto increíble

3
00:00:05,300 --> 00:00:07,900
Cambia colores, fuentes y estilos a tu gusto

4
00:00:08,000 --> 00:00:10,600
Gana 10000 seguidores con subtítulos virales

5
00:00:10,700 --> 00:00:13,200
Y exporta todo directo a tu línea de tiempo
`;

  root.SubFX_SRT = { parse, parseTime, toSRT, toASS, toTC, fromTC, SAMPLE };
})(typeof window !== 'undefined' ? window : globalThis);
