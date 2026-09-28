/*
 * SubtitleEngine Pro — Pipeline PNG-32 (módulo 08).
 *
 * Cada bloque de subtítulos se exporta como:
 *   · un PNG estático   [índice]_[tc]_[hash].png          si no tiene animación
 *   · una secuencia PNG [índice]_[tc]_[hash]/..._00000.png si se anima
 * El hash identifica el aspecto del bloque: si ya existe en la carpeta de
 * caché no se vuelve a renderizar.
 */
(function (root) {
  'use strict';

  const R = root.SubFX_Renderer;
  const CEP = root.SubFX_CEP;
  const SRT = root.SubFX_SRT;
  const pad = (n, l) => String(n).padStart(l, '0');
  const nextTick = () => new Promise(r => setTimeout(r, 0));

  /** FNV-1a de 32 bits en hexadecimal. */
  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  function chunkHash(ch, style, W, H, fps, n) {
    const words = ch.words.map(w => [w.ref.text, JSON.stringify(w.ref.ovr || {}), (w.ws - ch.start).toFixed(3)].join('~'));
    return hash([JSON.stringify(style), W, H, fps, n, (ch.end - ch.start).toFixed(3), words.join('|')].join('#'));
  }

  /**
   * opts = { layers: [{ chunks, style }], W, H, fps, outDir, mode: 'auto'|'sequence',
   *          onProgress(done,total,label), isCancelled() }
   * Devuelve { items: [{ path, start, dur, frames, name, layer, still }], total, encoded, cached }
   */
  async function render(opts) {
    const { W, H, fps, outDir } = opts;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const plan = [];
    opts.layers.forEach((L, layer) => {
      let prevEnd = -Infinity; // en fotogramas: nunca dos clips de la misma capa se solapan
      L.chunks.slice().sort((x, y) => x.start - y.start).forEach(ch => {
        const f0 = Math.max(prevEnd, Math.round(ch.start * fps));
        const f1 = Math.round(ch.end * fps);
        if (f1 <= f0) return;                 // bloque más corto que un fotograma
        prevEnd = f1;
        const n = f1 - f0;
        if (opts.mode === 'draft') {
          // Vista previa rápida: un PNG fijo por palabra (el karaoke se ve, sin animación)
          const cuts = [f0];
          ch.words.forEach(w => { const f = Math.round(w.ws * fps); if (f > cuts[cuts.length - 1] && f < f1) cuts.push(f); });
          // Se compara el final de cada tramo (animaciones ya asentadas); null = no se puede asegurar
          const keys = cuts.map((c, i) => R.frameKey(ch, ((cuts[i + 1] || f1) - 0.5) / fps, L.style));
          const staticChunk = keys.every(k => k !== null && k === keys[0]);
          (staticChunk ? [f0] : cuts).forEach((a, i, arr) => {
            const z = staticChunk ? f1 : (arr[i + 1] || f1);
            plan.push({ ch, style: L.style, layer, f0: a, n: z - a, still: true, t: Math.max(a, z - 1) / fps + 0.25 / fps, seg: i });
          });
          return;
        }
        // ¿Todos los fotogramas son idénticos? → PNG estático
        let still = opts.mode !== 'sequence';
        if (still) {
          const k0 = R.frameKey(ch, f0 / fps, L.style);
          for (let f = 1; still && f < n; f++) {
            const k = R.frameKey(ch, (f0 + f) / fps, L.style);
            if (k === null || k !== k0) still = false;
          }
          if (k0 === null) still = false;
        }
        plan.push({ ch, style: L.style, layer, f0, n, still, t: f0 / fps, seg: 0 });
      });
    });
    plan.sort((a, b) => a.f0 - b.f0 || a.layer - b.layer);

    const total = plan.reduce((a, p) => a + (p.still ? 1 : p.n), 0);
    let done = 0, encoded = 0, cached = 0;
    const items = [];
    const exists = CEP.fs.exists || (() => false);

    CEP.fs.mkdirp(outDir);
    for (let i = 0; i < plan.length; i++) {
      const { ch, style, layer, f0, n, still, t: tStill, seg } = plan[i];
      const tc = SRT.toTC(f0 / fps, fps).replace(/:/g, '-');
      const base = `${pad(i + 1, 4)}_${tc}_${hash(chunkHash(ch, style, W, H, fps, n) + '|' + (opts.mode === 'draft' ? 'd' + seg + ':' + tStill.toFixed(4) : ''))}`;
      const label = ch.words.map(w => w.ref.text).join(' ');
      const name = `${opts.namePrefix || 'SE· '}${layer ? 'L' + (layer + 1) + ' ' : ''}${pad(i + 1, 3)} · ${label.slice(0, 40)}`;

      if (still) {
        const path = `${outDir}/${base}.png`;
        if (exists(path)) cached++;
        else {
          if (opts.isCancelled && opts.isCancelled()) throw new Error('CANCELLED');
          ctx.clearRect(0, 0, W, H);
          R.renderChunk(ctx, W, H, ch, tStill, style);
          CEP.fs.writeFile(path, await CEP.fs.encodePNG(canvas));
          encoded++;
        }
        done++;
        items.push({ path, f0, frames: n, start: f0 / fps, dur: n / fps, name, layer, still: true });
        if (done % 4 === 0) { opts.onProgress && opts.onProgress(done, total, label); await nextTick(); }
        continue;
      }

      const dir = `${outDir}/${base}`;
      const first = `${dir}/${base}_${pad(0, 5)}.png`;
      const last = `${dir}/${base}_${pad(n - 1, 5)}.png`;
      if (exists(first) && exists(last)) {
        cached++;
        done += n;
      } else {
        CEP.fs.mkdirp(dir);
        let prevKey = null, prevData = null;
        for (let f = 0; f < n; f++) {
          if (opts.isCancelled && opts.isCancelled()) throw new Error('CANCELLED');
          const t = (f0 + f) / fps;
          const key = R.frameKey(ch, t, style);
          let data;
          if (key !== null && key === prevKey) {
            data = prevData;
          } else {
            ctx.clearRect(0, 0, W, H);
            R.renderChunk(ctx, W, H, ch, t, style);
            data = await CEP.fs.encodePNG(canvas);
            encoded++;
          }
          prevKey = key;
          prevData = data;
          CEP.fs.writeFile(`${dir}/${base}_${pad(f, 5)}.png`, data);
          done++;
          if (done % 6 === 0) {
            opts.onProgress && opts.onProgress(done, total, label);
            await nextTick();
          }
        }
      }
      items.push({ path: first, f0, frames: n, start: f0 / fps, dur: n / fps, name, layer, still: false });
    }
    opts.onProgress && opts.onProgress(total, total, '');
    return { items, total, encoded, cached };
  }

  root.SubFX_Exporter = { render, hash };
})(window);
