/*
 * SubtitleEngine Pro — Detección de silencios (módulo 07).
 * Decodifica el audio de los clips y encuentra las pausas por debajo de un
 * umbral en dB. El corte lo ejecuta host.jsx (cuchilla + borrado con rizo).
 */
(function (root) {
  'use strict';

  const WIN = 0.01; // ventana de análisis: 10 ms

  /** Nivel RMS en dBFS por ventana. */
  function levels(samples, sampleRate, from, to) {
    const n = Math.max(1, Math.round(sampleRate * WIN));
    const i0 = Math.max(0, Math.floor((from || 0) * sampleRate));
    const i1 = Math.min(samples.length, to == null ? samples.length : Math.ceil(to * sampleRate));
    const out = new Float32Array(Math.max(0, Math.ceil((i1 - i0) / n)));
    for (let w = 0; w < out.length; w++) {
      let sum = 0;
      const a = i0 + w * n, b = Math.min(i1, a + n);
      for (let i = a; i < b; i++) sum += samples[i] * samples[i];
      out[w] = 20 * Math.log10(Math.sqrt(sum / Math.max(1, b - a)) + 1e-9);
    }
    return out;
  }

  /**
   * Devuelve [{start, end}] (segundos relativos a `from`) de las pausas a cortar.
   * opts = { threshold (dB), minDur (s), padIn (s), padOut (s), from, to }
   *   padOut: margen que se conserva tras el final de una frase (no corta terminaciones)
   *   padIn:  margen que se conserva antes de que empiece la siguiente (no corta consonantes)
   */
  function detect(samples, sampleRate, opts) {
    const o = Object.assign({ threshold: -38, minDur: 0.4, padIn: 0.06, padOut: 0.09 }, opts);
    const lv = levels(samples, sampleRate, o.from, o.to);
    const total = lv.length * WIN;
    const out = [];
    let start = -1;
    for (let w = 0; w <= lv.length; w++) {
      const silent = w < lv.length && lv[w] < o.threshold;
      if (silent && start < 0) start = w;
      if (!silent && start >= 0) {
        const s = start * WIN, e = Math.min(total, w * WIN);
        if (e - s >= o.minDur) {
          const a = s === 0 ? 0 : s + o.padOut;
          const b = e >= total ? total : e - o.padIn;
          if (b - a > 0.02) out.push({ start: a, end: b });
        }
        start = -1;
      }
    }
    return out;
  }

  /** Reduce cada pausa dejando `keep` segundos de silencio (modo «Acortar silencios»). */
  function shorten(ranges, keep) {
    return ranges
      .map(r => ({ start: r.start + keep / 2, end: r.end - keep / 2 }))
      .filter(r => r.end - r.start > 0.02);
  }

  /** Une rangos solapados o casi contiguos. */
  function merge(ranges, gap) {
    const s = ranges.slice().sort((a, b) => a.start - b.start);
    const out = [];
    s.forEach(r => {
      const last = out[out.length - 1];
      if (last && r.start <= last.end + (gap || 0)) last.end = Math.max(last.end, r.end);
      else out.push({ start: r.start, end: r.end });
    });
    return out;
  }

  /** Complemento: tramos con voz entre `from` y `to` (para el Auto-Zoom por silencio). */
  function speech(silences, from, to) {
    const out = [];
    let cur = from;
    merge(silences).forEach(r => {
      if (r.start > cur) out.push({ start: cur, end: Math.min(r.start, to) });
      cur = Math.max(cur, r.end);
    });
    if (cur < to) out.push({ start: cur, end: to });
    return out.filter(r => r.end - r.start > 0.05);
  }

  // ───────────── Decodificación (solo en el panel) ─────────────
  let actx = null;
  function mono(buf) {
    if (buf.numberOfChannels === 1) return buf.getChannelData(0);
    const out = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) out[i] += d[i] / buf.numberOfChannels;
    }
    return out;
  }

  async function decodeArrayBuffer(ab) {
    const Ctx = root.AudioContext || root.webkitAudioContext;
    if (!actx) actx = new Ctx();
    const buf = await new Promise((resolve, reject) => {
      const p = actx.decodeAudioData(ab, resolve, reject);
      if (p && p.then) p.then(resolve, reject);
    });
    return { samples: mono(buf), sampleRate: buf.sampleRate };
  }

  root.SubFX_Audio = { detect, shorten, merge, speech, levels, decodeArrayBuffer, WIN };
})(typeof window !== 'undefined' ? window : globalThis);
