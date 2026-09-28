'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AU, ZM } = require('./load');

/** Tono de 180 Hz en los tramos indicados; silencio fuera. */
function tone(sr, secs, spans) {
  const s = new Float32Array(sr * secs);
  for (let i = 0; i < s.length; i++) {
    const t = i / sr;
    if (spans.some(([a, b]) => t > a && t < b)) s[i] = 0.3 * Math.sin(2 * Math.PI * 180 * t);
  }
  return s;
}

test('detecta silencios y respeta el padding', () => {
  const sr = 8000;
  const r = AU.detect(tone(sr, 4, [[0.5, 1.5], [2.5, 3.5]]), sr, { threshold: -38, minDur: 0.3, padIn: 0.06, padOut: 0.09 });
  assert.equal(r.length, 3);
  const near = (a, b) => Math.abs(a - b) < 0.015;
  assert.ok(near(r[0].start, 0) && near(r[0].end, 0.44), JSON.stringify(r[0]));
  assert.ok(near(r[1].start, 1.59) && near(r[1].end, 2.44), JSON.stringify(r[1]));
  assert.ok(near(r[2].start, 3.59) && near(r[2].end, 4), JSON.stringify(r[2]));
});

test('no corta pausas más cortas que la duración mínima', () => {
  const sr = 8000;
  const r = AU.detect(tone(sr, 3, [[0, 1.2], [1.4, 3]]), sr, { minDur: 0.3 });
  assert.equal(r.length, 0);
});

test('un umbral más alto encuentra más silencio', () => {
  const sr = 8000, s = tone(sr, 2, [[0, 2]]);
  for (let i = sr / 2; i < sr; i++) s[i] *= 0.02; // tramo a unos -47 dB
  assert.equal(AU.detect(s, sr, { threshold: -50, minDur: 0.25 }).length, 0);
  assert.equal(AU.detect(s, sr, { threshold: -38, minDur: 0.25 }).length, 1);
});

test('acortar deja 0.15 s de pausa y merge/speech son complementarios', () => {
  const sh = AU.shorten([{ start: 1, end: 2 }], 0.15);
  assert.ok(Math.abs((sh[0].end - sh[0].start) - 0.85) < 1e-9);
  assert.deepEqual(AU.merge([{ start: 2, end: 3 }, { start: 0, end: 1 }, { start: 0.9, end: 1.5 }]), [{ start: 0, end: 1.5 }, { start: 2, end: 3 }]);
  assert.deepEqual(AU.speech([{ start: 1, end: 2 }], 0, 3), [{ start: 0, end: 1 }, { start: 2, end: 3 }]);
});

const P = { min: 100, max: 120, direction: 'in', easing: 'smooth', frames: 8, fps: 30, trigger: 'cut' };

test('zoom por corte: de 100 % a 120 % en la duración pedida', () => {
  const k = ZM.planClip({ start: 10, end: 14, index: 0 }, P);
  assert.equal(k[0].t, 10);
  assert.equal(k[0].s, 1);
  assert.ok(Math.abs(k[k.length - 1].t - (10 + 8 / 30)) < 1e-9);
  assert.equal(k[k.length - 1].s, 1.2);
  assert.ok(k.every(x => x.interp === 'bezier'));
});

test('zoom out y alternado', () => {
  const out = ZM.planClip({ start: 0, end: 4, index: 0 }, Object.assign({}, P, { direction: 'out' }));
  assert.deepEqual([out[0].s, out[out.length - 1].s], [1.2, 1]);
  const alt = [0, 1].map(i => ZM.planClip({ start: i * 4, end: i * 4 + 4, index: i }, Object.assign({}, P, { direction: 'alternate' })));
  assert.deepEqual(alt.map(k => k[0].s), [1, 1.2]);
});

test('snappy añade keyframes intermedios crecientes', () => {
  const k = ZM.planClip({ start: 0, end: 4, index: 0 }, Object.assign({}, P, { easing: 'snappy' }));
  assert.equal(k.length, 5);
  for (let i = 1; i < k.length; i++) assert.ok(k[i].t > k[i - 1].t && k[i].s >= k[i - 1].s);
});

test('zoom por silencio: entra al hablar y sale en la pausa, dentro del clip', () => {
  const k = ZM.planClip({ start: 0, end: 6, index: 0 }, Object.assign({}, P, { trigger: 'silence', speech: [{ start: 1, end: 3 }, { start: 5.9, end: 8 }] }));
  assert.ok(k.every(x => x.t >= 0 && x.t <= 6));
  assert.equal(Math.max(...k.map(x => x.s)), 1.2);
  assert.equal(k[k.length - 1].s, 1); // termina fuera de la voz
});

test('zoom por intervalo alterna cada N segundos sin salirse del clip', () => {
  const k = ZM.planClip({ start: 0, end: 10, index: 0 }, Object.assign({}, P, { trigger: 'interval', interval: 2.5 }));
  assert.ok(k.every(x => x.t <= 10));
  assert.equal(k.filter((x, i) => x.s === 1.2 && (!k[i - 1] || k[i - 1].s !== 1.2)).length, 2); // dos subidas: 2.5 s y 7.5 s
});
