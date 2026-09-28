/*
 * SubtitleEngine Pro — Auto-Zoom paramétrico (módulo 06).
 * Calcula los keyframes de Escala para cada clip; host.jsx los aplica al
 * efecto Movimiento (y compensa la Posición según el punto focal).
 */
(function (root) {
  'use strict';

  const EXPO = [0.2, 0.45, 0.7];            // puntos intermedios de la curva «Snappy»
  const expoOut = x => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));

  /**
   * Transición de v0 a v1 que empieza en t y dura d segundos.
   * Devuelve keyframes { t, s, interp } (s = factor de zoom, 1 = 100 %).
   */
  function transition(t, d, v0, v1, easing) {
    if (d <= 0 || v0 === v1) return [{ t, s: v1, interp: 'hold' }];
    if (easing === 'snappy') {
      return [{ t, s: v0, interp: 'linear' }]
        .concat(EXPO.map(p => ({ t: t + d * p, s: v0 + (v1 - v0) * expoOut(p), interp: 'linear' })))
        .concat([{ t: t + d, s: v1, interp: 'linear' }]);
    }
    const interp = easing === 'linear' ? 'linear' : 'bezier';
    return [{ t, s: v0, interp }, { t: t + d, s: v1, interp }];
  }

  /**
   * clip   = { start, end, index }   (segundos de secuencia)
   * p      = { min, max (%), direction: in|out|alternate, easing: smooth|linear|snappy,
   *            frames, fps, trigger: cut|interval|silence, interval, speech: [{start,end}] }
   */
  function planClip(clip, p) {
    const lo = p.min / 100, hi = p.max / 100;
    const d = (p.frames || 8) / (p.fps || 30);
    const keys = [];
    const push = arr => arr.forEach(k => { if (k.t >= clip.start - 1e-6 && k.t <= clip.end + 1e-6) keys.push(k); });

    if (p.trigger === 'cut') {
      if (p.direction === 'alternate') {
        keys.push({ t: clip.start, s: clip.index % 2 ? hi : lo, interp: 'hold' });
      } else {
        const [a, b] = p.direction === 'out' ? [hi, lo] : [lo, hi];
        push(transition(clip.start, Math.min(d, (clip.end - clip.start) * 0.5), a, b, p.easing));
      }
    } else if (p.trigger === 'interval') {
      const step = Math.max(0.5, p.interval || 2.5);
      let zoomed = p.direction === 'out';
      keys.push({ t: clip.start, s: zoomed ? hi : lo, interp: 'hold' });
      for (let t = clip.start + step; t < clip.end - d; t += step) {
        push(transition(t, d, zoomed ? hi : lo, zoomed ? lo : hi, p.easing));
        zoomed = !zoomed;
      }
    } else if (p.trigger === 'silence') {
      // Zoom in cuando se habla, zoom out en las pausas
      keys.push({ t: clip.start, s: lo, interp: 'hold' });
      (p.speech || []).forEach(r => {
        const a = Math.max(r.start, clip.start), b = Math.min(r.end, clip.end);
        if (b - a < d * 2) return;
        push(transition(a, d, lo, hi, p.easing));
        push(transition(b - d, d, hi, lo, p.easing));
      });
    }
    keys.sort((x, y) => x.t - y.t);
    // Quitar keyframes duplicados en el mismo instante (se queda el último)
    return keys.filter((k, i) => !keys[i + 1] || Math.abs(keys[i + 1].t - k.t) > 1e-4);
  }

  root.SubFX_Zoom = { planClip, transition };
})(typeof window !== 'undefined' ? window : globalThis);
