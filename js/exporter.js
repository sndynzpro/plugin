/*
 * SubFX Studio — Exporta cada bloque de subtítulos como una secuencia PNG
 * transparente (una carpeta por bloque) lista para importar en Premiere.
 */
(function (root) {
  'use strict';

  const R = root.SubFX_Renderer;
  const CEP = root.SubFX_CEP;
  const pad = (n, l) => String(n).padStart(l, '0');
  const nextTick = () => new Promise(r => setTimeout(r, 0));

  /**
   * opts = { chunks, style, W, H, fps, outDir, onProgress(done,total,label), isCancelled() }
   * Devuelve [{ path, start, frames, name }] — `start` en segundos relativos al SRT.
   */
  async function render(opts) {
    const { chunks, style, W, H, fps, outDir } = opts;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const plan = chunks.map(ch => {
      const f0 = Math.round(ch.start * fps);
      const f1 = Math.max(f0 + 1, Math.round(ch.end * fps));
      return { ch, f0, n: f1 - f0 };
    });
    const total = plan.reduce((a, p) => a + p.n, 0);
    let done = 0, encoded = 0;
    const items = [];

    CEP.fs.mkdirp(outDir);
    for (let i = 0; i < plan.length; i++) {
      const { ch, f0, n } = plan[i];
      const base = 'subfx_' + pad(i + 1, 4);
      const dir = outDir + '/' + base;
      CEP.fs.mkdirp(dir);
      const label = ch.words.map(w => w.ref.text).join(' ');

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
        CEP.fs.writeFile(dir + '/' + base + '_' + pad(f, 5) + '.png', data);
        done++;
        if (done % 6 === 0) {
          opts.onProgress && opts.onProgress(done, total, label);
          await nextTick();
        }
      }
      items.push({
        path: dir + '/' + base + '_' + pad(0, 5) + '.png',
        start: f0 / fps,
        frames: n,
        name: pad(i + 1, 3) + ' · ' + label.slice(0, 40)
      });
    }
    opts.onProgress && opts.onProgress(total, total, '');
    return { items, total, encoded };
  }

  root.SubFX_Exporter = { render };
})(window);
