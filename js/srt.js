/*
 * SubFX Studio — Lectura de subtítulos .srt / .vtt.
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

  /** Devuelve [{start, end, text}] ordenado por inicio. */
  function parse(text) {
    const src = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const blocks = src.split(/\n[ \t]*\n/);
    const cues = [];
    for (const block of blocks) {
      const lines = block.split('\n');
      const ti = lines.findIndex(l => l.indexOf('-->') !== -1);
      if (ti === -1) continue;
      const [a, b] = lines[ti].split('-->');
      const start = parseTime(a), end = parseTime(b);
      if (isNaN(start) || isNaN(end)) continue;
      const body = cleanText(lines.slice(ti + 1).join(' '));
      if (!body) continue;
      cues.push({ start, end: Math.max(end, start + 0.1), text: body });
    }
    cues.sort((x, y) => x.start - y.start);
    return cues;
  }

  const SAMPLE = `1
00:00:00,300 --> 00:00:02,600
Esto es SubFX Studio para Premiere Pro

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

  root.SubFX_SRT = { parse, parseTime, SAMPLE };
})(window);
