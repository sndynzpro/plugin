'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
require('../../js/proxy.js');
require('../../js/transcribe.js');
const P = globalThis.SubFX_Proxy;
const T = globalThis.SubFX_Transcribe;

test('fps exactos, tamaño y montaje con huecos', () => {
  assert.equal(P.fpsRational(29.97002997), '30000/1001');
  assert.equal(P.fpsRational(25), '25');
  assert.deepEqual(P.proxySize(1080, 1920), { w: 540, h: 960 });
  assert.deepEqual(P.proxySize(3840, 2160), { w: 960, h: 540 });
  const s = P.buildSegments([{ start: 3, end: 5, inPoint: 0, path: 'b' }, { start: 1, end: 2.5, inPoint: 0.5, path: 'a' }], 6, 30);
  assert.deepEqual(s.map(x => x.type + ':' + x.dur.toFixed(2)), ['gap:1.00', 'clip:1.50', 'gap:0.50', 'clip:2.00', 'gap:1.00']);
  assert.equal(s[1].inPoint, 0.5);
});

test('el comando de cada lote cabe en la línea de comandos de Windows', () => {
  const long = 'C:/Users/editor/Videos/Proyecto con un nombre bastante largo/Crudos/Camara A/'.padEnd(150, 'x') + '.mp4';
  const segs = Array.from({ length: P.BATCH }, (_, i) => ({ type: 'clip', path: long, inPoint: i, dur: 0.5 }));
  const { args } = P.batchArgs(segs, { w: 540, h: 960, fpsR: '30000/1001', fps: 29.97, codec: 'h264', out: 'C:/tmp/part_000.mp4' });
  const len = args.reduce((a, x) => a + String(x).length + 3, 0);
  assert.ok(len < 32000, 'longitud ' + len);
});

// Prueba con ffmpeg real (se omite si no hay ffmpeg)
function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return 'ffmpeg'; } catch (e) { return null; }
}
const FF = ffmpegPath();

test('genera el proxy real: fotogramas exactos, huecos y lotes', { skip: !FF && 'ffmpeg no disponible' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-proxy-'));
  const src = (name, color) => {
    const f = path.join(dir, name + '.mp4');
    execFileSync(FF, ['-hide_banner', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=1920x1080:r=30000/1001:d=10`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', f], { stdio: 'ignore' });
    return f;
  };
  const red = src('rojo', 'red'), blue = src('azul', 'blue');
  const fps = 30000 / 1001, duration = 9;
  const clips = [{ start: 1, end: 2.5, inPoint: 0.5, path: red }, { start: 3, end: 5, inPoint: 0, path: blue }];
  for (let i = 0; i < 35; i++) clips.push({ start: 5 + i * 0.1, end: 5.1 + i * 0.1, inPoint: 2 + i * 0.1, path: blue }); // montaje muy cortado: 2 lotes
  const mix = new Float32Array(16000 * duration).map((_, i) => 0.2 * Math.sin(i / 10));
  globalThis.require = require;
  let last = 0;
  const out = await P.makeProxy({ bin: FF, clips, wav: T.encodeWav(mix, 16000), W: 1920, H: 1080, fps, duration, codec: 'h264', dir, onProgress: p => { last = p; } });
  delete globalThis.require;
  assert.equal(last, 1);
  const probe = (() => { try { execFileSync(FF, ['-hide_banner', '-i', out]); } catch (e) { return String(e.stderr); } return ''; })();
  assert.match(probe, /960x540/);
  assert.match(probe, /Audio: aac/);
  // Fotogramas decodificados y su cadencia real (no la del encabezado)
  const shown = require('child_process').spawnSync(FF, ['-hide_banner', '-i', out, '-vf', 'showinfo', '-an', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const pts = [...shown.matchAll(/pts_time:([0-9.]+)/g)].map(m => +m[1]);
  const frames = pts.length;
  assert.ok(Math.abs((pts[1] - pts[0]) - 1001 / 30000) < 1e-4, 'cadencia ' + (pts[1] - pts[0]));
  assert.match(probe, /29\.97 fps/);
  assert.ok(Math.abs(frames - Math.round(duration * fps)) <= 1, `fotogramas ${frames}, esperados ${Math.round(duration * fps)}`);
  const colorAt = t => {
    const buf = execFileSync(FF, ['-hide_banner', '-ss', String(t), '-i', out, '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const [r, g, b] = buf;
    return r > 150 && b < 90 ? 'rojo' : b > 150 && r < 90 ? 'azul' : r < 40 && g < 40 && b < 40 ? 'negro' : `?${r},${g},${b}`;
  };
  assert.deepEqual([0.5, 1.7, 2.75, 4, 6.2, 8.8].map(colorAt), ['negro', 'rojo', 'negro', 'azul', 'azul', 'negro']);
});
