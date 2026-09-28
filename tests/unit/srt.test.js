'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SRT, ST, fixture } = require('./load');

test('lee SRT con milisegundos, etiquetas y CRLF', () => {
  const c = SRT.parse('﻿1\r\n00:00:01,250 --> 00:00:03,000\r\n<i>Hola</i> {\\an8}mundo\r\n\r\n2\r\n00:00:03,5 --> 00:00:04,000\r\nadiós\r\n');
  assert.equal(c.length, 2);
  assert.deepEqual([c[0].start, c[0].end, c[0].text], [1.25, 3, 'Hola mundo']);
  assert.equal(c[1].start, 3.5);
});

test('ignora bloques rotos sin detenerse', () => {
  const c = SRT.parse('1\nsin tiempo\n\n2\n00:00:01,000 --> xx\nroto\n\n3\n00:00:02,000 --> 00:00:03,000\nbien\n');
  assert.equal(c.length, 1);
  assert.equal(c[0].text, 'bien');
});

test('detecta hablantes en MAYÚSCULAS o entre corchetes, no frases normales', () => {
  const c = SRT.parse('1\n00:00:01,000 --> 00:00:02,000\nJUAN: hola\n\n2\n00:00:02,000 --> 00:00:03,000\n[Ana] qué tal\n\n3\n00:00:03,000 --> 00:00:04,000\nMira: esto no es un hablante\n');
  assert.deepEqual(c.map(x => x.speaker), ['JUAN', 'Ana', '']);
  assert.equal(c[2].text, 'Mira: esto no es un hablante');
});

test('lee WebVTT con <v Nombre>', () => {
  const c = SRT.parse('WEBVTT\n\n00:01.000 --> 00:02.000\n<v Dylan>Hola equipo\n');
  assert.equal(c[0].speaker, 'Dylan');
  assert.equal(c[0].text, 'Hola equipo');
});

test('lee ASS: hablantes, \\N y etiquetas de estilo', () => {
  const c = SRT.parse(fixture('dos-hablantes.ass'));
  assert.equal(c.length, 2);
  assert.deepEqual(c.map(x => x.speaker), ['Dylan', 'Andrés']);
  assert.equal(c[0].text, 'Cuidado con tu mejor empleado');
  assert.equal(c[1].text, 'que necesitas retener hoy');
  assert.deepEqual([c[1].start, c[1].end], [2.9, 4.2]);
});

test('SRT exportado se vuelve a leer igual', () => {
  const cues = [{ start: 1, end: 2.5, text: 'uno' }, { start: 3.004, end: 4, text: 'dos' }];
  const back = SRT.parse(SRT.toSRT(cues));
  assert.deepEqual(back.map(c => [c.start, c.end, c.text]), [[1, 2.5, 'uno'], [3.004, 4, 'dos']]);
});

test('ASS exportado: un estilo por capa y colores &HAABBGGRR', () => {
  const st = ST.make(ST.PRESETS.find(p => p.id === 'x30-default'));
  const ass = SRT.toASS([{ start: 0, end: 1, text: 'hola', layer: 0 }], [{ name: '30X', style: st }], 1080, 1920);
  assert.match(ass, /^Style: 30X,Inter,62,&H00F0F5F6,/m);
  assert.match(ass, /^Dialogue: 0,0:00:00\.00,0:00:01\.00,30X,,0,0,0,,hola$/m);
  const back = SRT.parse(ass);
  assert.equal(back[0].text, 'hola');
});

test('timecodes de secuencia (NDF) ida y vuelta', () => {
  for (const fps of [23.976, 24, 25, 29.97, 30, 59.94, 60]) {
    for (const f of [0, 1, 59, 1799, 10000]) {
      const t = f / fps;
      const tc = SRT.toTC(t, fps);
      assert.ok(Math.abs(SRT.fromTC(tc, fps) - t) < 1e-6, `${fps} fps, cuadro ${f}: ${tc}`);
    }
  }
  assert.equal(SRT.toTC(3.5, 29.97), '00:00:03:15');
  assert.equal(SRT.fromTC('1:02.5'), 62.5);
  assert.equal(SRT.fromTC('00:00:01,500'), 1.5);
  assert.ok(Number.isNaN(SRT.fromTC('abc', 30)));
});

test('lee JSON de Whisper con tiempos por palabra', () => {
  const c = SRT.parse(JSON.stringify({ segments: [{ start: 0.5, end: 2, text: ' Hola equipo', words: [{ word: ' Hola', start: 0.5, end: 0.9 }, { word: ' equipo', start: 1.0, end: 1.8 }] }] }));
  assert.equal(c.length, 1);
  assert.equal(c[0].text, 'Hola equipo');
  assert.deepEqual(c[0].words, [{ text: 'Hola', t0: 0.5, t1: 0.9 }, { text: 'equipo', t0: 1, t1: 1.8 }]);
});

test('agrupa una lista de palabras por pausas y fin de frase', () => {
  const c = SRT.parse(JSON.stringify([{ word: 'a', start: 0, end: 0.2 }, { word: 'b.', start: 0.3, end: 0.5 }, { word: 'c', start: 0.6, end: 0.8 }, { word: 'd', start: 2, end: 2.2 }]));
  assert.deepEqual(c.map(x => x.text), ['a b.', 'c', 'd']);
});
