/*
 * SubtitleEngine Pro — Vídeo proxy del timeline para ver los subtítulos en tiempo real.
 *
 * Genera con ffmpeg un vídeo ligero (lado corto 540 px, un fotograma clave por segundo)
 * que reproduce el montaje de una pista de vídeo, con los huecos en negro y el audio
 * del timeline ya mezclado. El panel lo reproduce debajo de los subtítulos y dibuja cada
 * fotograma sobre el fotograma de vídeo presentado (requestVideoFrameCallback).
 *
 * Por lotes: evita el límite de la línea de comandos de Windows y el consumo de memoria
 * con cientos de clips; los lotes se unen sin recodificar.
 */
(function (root) {
  'use strict';

  const BATCH = 30; // ~15 000 caracteres de comando: holgado bajo el límite de 32 767 de Windows
  const IMAGE = /\.(png|jpe?g|gif|bmp|tiff?|psd|webp)$/i;

  /** Fotogramas como fracción exacta para ffmpeg (29.97 → 30000/1001). */
  function fpsRational(fps) {
    const known = { 23.976: '24000/1001', 29.97: '30000/1001', 59.94: '60000/1001', 47.952: '48000/1001', 119.88: '120000/1001' };
    const r = Math.round(fps * 1000) / 1000;
    if (known[r]) return known[r];
    return Number.isInteger(Math.round(fps * 1000) / 1000) ? String(Math.round(fps)) : `${Math.round(fps * 1000)}/1000`;
  }

  /** Tamaño del proxy: lado corto = `short`, dimensiones pares, misma proporción. */
  function proxySize(W, H, short) {
    short = short || 540;
    const k = short / Math.min(W, H);
    const even = v => Math.max(2, Math.round(v * k / 2) * 2);
    return { w: even(W), h: even(H) };
  }

  /**
   * Montaje de la pista: clips ordenados y huecos en negro de 0 a `duration`.
   * clips = [{ start, end, inPoint, path }] (segundos de secuencia / de media)
   */
  function buildSegments(clips, duration, fps) {
    const q = t => Math.round(t * fps) / fps; // al fotograma
    const list = clips.filter(c => c.path && c.end > c.start).slice().sort((a, b) => a.start - b.start);
    const segs = [];
    let cur = 0;
    list.forEach(c => {
      const s = q(Math.max(c.start, cur)), e = q(Math.min(c.end, duration));
      if (e - s < 0.5 / fps) return;
      if (s - cur >= 0.5 / fps) segs.push({ type: 'gap', dur: s - cur });
      segs.push({ type: 'clip', path: c.path, inPoint: c.inPoint + (s - c.start), dur: e - s, image: IMAGE.test(c.path) });
      cur = e;
    });
    if (duration - cur >= 0.5 / fps) segs.push({ type: 'gap', dur: q(duration) - cur });
    return segs;
  }

  const fmt = n => (Math.round(n * 1e6) / 1e6).toFixed(6);

  /** Argumentos y guion de filtros para renderizar un lote de segmentos. */
  function batchArgs(segs, o) {
    const args = ['-hide_banner', '-y', '-nostats', '-progress', 'pipe:1'];
    const lines = [];
    segs.forEach((s, k) => {
      if (s.type === 'gap') {
        args.push('-f', 'lavfi', '-t', fmt(s.dur), '-i', `color=c=black:s=${o.w}x${o.h}:r=${o.fpsR}`);
      } else if (s.image) {
        args.push('-loop', '1', '-framerate', o.fpsR, '-t', fmt(s.dur), '-i', s.path);
      } else {
        args.push('-ss', fmt(s.inPoint), '-t', fmt(s.dur), '-i', s.path);
      }
      lines.push(`[${k}:v]scale=${o.w}:${o.h}:force_original_aspect_ratio=decrease,pad=${o.w}:${o.h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${o.fpsR},format=yuv420p,trim=duration=${fmt(s.dur)},setpts=PTS-STARTPTS[v${k}]`);
    });
    // concat pierde la cadencia: se vuelve a fijar (si no, el codificador usa 25 fps)
    lines.push(segs.map((s, k) => `[v${k}]`).join('') + `concat=n=${segs.length}:v=1:a=0,fps=${o.fpsR}[vout]`);
    args.push('-filter_complex', lines.join(';'), '-map', '[vout]', '-an', '-r', o.fpsR, '-fps_mode', 'cfr');
    args.push(...videoCodec(o));
    args.push(o.out);
    return { args };
  }

  function videoCodec(o) {
    const g = String(Math.max(1, Math.round(o.fps || 30))); // un fotograma clave por segundo: saltos instantáneos
    return o.codec === 'vp8'
      ? ['-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '1500k', '-g', g]
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'fastdecode', '-crf', '26', '-g', g, '-pix_fmt', 'yuv420p'];
  }

  /** Une los lotes (sin recodificar) y añade el audio mezclado. */
  function muxArgs(listPath, wavPath, o) {
    const args = ['-hide_banner', '-y', '-nostats', '-f', 'concat', '-safe', '0', '-i', listPath];
    if (wavPath) args.push('-i', wavPath);
    args.push('-map', '0:v');
    if (wavPath) args.push('-map', '1:a');
    args.push('-c:v', 'copy');
    if (wavPath) args.push(...(o.codec === 'vp8' ? ['-c:a', 'libopus', '-b:a', '96k'] : ['-c:a', 'aac', '-b:a', '128k']));
    args.push('-t', fmt(o.duration));
    if (o.codec !== 'vp8') args.push('-movflags', '+faststart');
    args.push(o.out);
    return args;
  }

  const concatList = parts => parts.map(p => `file '${String(p).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n') + '\n';

  function batches(segs) {
    const out = [];
    for (let i = 0; i < segs.length; i += BATCH) out.push(segs.slice(i, i + BATCH));
    return out;
  }

  // ───────────── Ejecución (panel, con Node) ─────────────
  const nodeReq = () => (root.cep_node && root.cep_node.require) || (typeof root.require === 'function' ? root.require : null);

  function runFfmpeg(bin, args, total, onProgress) {
    const cp = nodeReq()('child_process');
    return new Promise((resolve, reject) => {
      const p = cp.spawn(bin, args, { windowsHide: true });
      let err = '';
      p.stdout.on('data', d => {
        const m = /out_time_(?:us|ms)=(\d+)/.exec(String(d));
        if (m && onProgress && total > 0) onProgress(Math.min(1, +m[1] / 1e6 / total));
      });
      p.stderr.on('data', d => { err += d; if (err.length > 20000) err = err.slice(-8000); });
      p.on('error', e => reject(new Error('No se pudo ejecutar ffmpeg: ' + e.message)));
      p.on('close', code => (code === 0 ? resolve() : reject(new Error('ffmpeg falló (' + code + '): ' + err.trim().split('\n').slice(-2).join(' ')))));
    });
  }

  /**
   * opts = { bin, clips, wav (ArrayBuffer|null), W, H, fps, duration, codec: 'h264'|'vp8', dir, onProgress }
   * Devuelve la ruta del proxy.
   */
  async function makeProxy(opts) {
    const req = nodeReq();
    if (!req) throw new Error('El proxy se genera dentro de Premiere (necesita Node.js y ffmpeg).');
    const fs = req('fs'), path = req('path');
    const B = (root.cep_node && root.cep_node.Buffer) || req('buffer').Buffer;
    const { w, h } = proxySize(opts.W, opts.H, opts.short);
    const fpsR = fpsRational(opts.fps);
    const ext = opts.codec === 'vp8' ? 'webm' : 'mp4';
    const work = path.join(opts.dir, 'proxy_' + Date.now());
    fs.mkdirSync(work, { recursive: true });
    const segs = buildSegments(opts.clips, opts.duration, opts.fps);
    if (!segs.length) throw new Error('La pista de vídeo está vacía');
    const groups = batches(segs);
    const parts = [];
    let doneDur = 0;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i], gDur = g.reduce((a, s) => a + s.dur, 0);
      const out = path.join(work, `part_${String(i).padStart(3, '0')}.${ext}`);
      const b = batchArgs(g, { w, h, fpsR, fps: opts.fps, codec: opts.codec, out });
      await runFfmpeg(opts.bin, b.args, gDur, p => opts.onProgress && opts.onProgress(0.95 * (doneDur + p * gDur) / opts.duration));
      doneDur += gDur;
      parts.push(out);
    }
    const list = path.join(work, 'list.txt');
    fs.writeFileSync(list, concatList(parts));
    let wavPath = null;
    if (opts.wav) { wavPath = path.join(work, 'audio.wav'); fs.writeFileSync(wavPath, B.from(opts.wav)); }
    const final = path.join(opts.dir, `proxy_${Date.now()}.${ext}`);
    await runFfmpeg(opts.bin, muxArgs(list, wavPath, { codec: opts.codec, duration: opts.duration, out: final }), 0);
    try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) { /* limpieza opcional */ }
    if (opts.onProgress) opts.onProgress(1);
    return final.replace(/\\/g, '/');
  }

  /** ffmpeg del sistema (o uno indicado). */
  function findFfmpeg(extra) {
    const req = nodeReq();
    if (!req) return null;
    const fs = req('fs'), path = req('path');
    const isWin = typeof navigator !== 'undefined' ? navigator.platform.indexOf('Win') === 0 : process.platform === 'win32';
    const dirs = [].concat(extra || [], ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', 'C:/ffmpeg/bin', 'C:/Program Files/ffmpeg/bin'],
      (typeof process !== 'undefined' && process.env && process.env.PATH ? process.env.PATH.split(isWin ? ';' : ':') : []));
    for (const d of dirs) {
      if (!d) continue;
      const p = path.join(d, 'ffmpeg' + (isWin ? '.exe' : ''));
      try { if (fs.statSync(p).isFile()) return p.replace(/\\/g, '/'); } catch (e) { /* sigue */ }
    }
    return null;
  }

  root.SubFX_Proxy = { fpsRational, proxySize, buildSegments, batchArgs, muxArgs, concatList, batches, makeProxy, findFfmpeg, BATCH };
})(typeof window !== 'undefined' ? window : globalThis);
