'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ST } = require('./load');

test('los ids de los presets son únicos y el preset por defecto existe', () => {
  const ids = ST.PRESETS.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes(ST.DEFAULT_ID));
  assert.ok(ids.includes('x30-speaker2'));
});

test('cada preset tiene todos los campos base y una categoría válida', () => {
  ST.PRESETS.forEach(p => {
    const s = ST.make(p);
    Object.keys(ST.BASE).forEach(k => assert.ok(k in s, `${p.id}: falta ${k}`));
    assert.ok(ST.CATS[s.cat], `${p.id}: categoría ${s.cat}`);
    assert.ok(!('shadowX' in s) && !('bgPad' in s), `${p.id}: quedan campos antiguos`);
  });
});

test('30X Default cumple el Playbook', () => {
  const s = ST.make(ST.PRESETS.find(p => p.id === 'x30-default'));
  assert.equal(s.font, 'Inter');
  assert.equal(s.weight, 700);
  assert.equal(s.color, '#F6F5F0');
  assert.equal(s.hlColor, '#FAFF96');
  assert.equal(s.case, 'lower');
  assert.equal(s.shadowOpacity, 0.65);
  assert.equal(s.safeTop, 250);
  assert.ok(s.safeBottom >= 350 && s.safeBottom <= 380);
});

test('migra estilos guardados con el formato de SubFX Studio', () => {
  const s = ST.make({ shadowX: 0, shadowY: 7, bgPad: 20 });
  assert.equal(s.shadowAngle, 90);
  assert.equal(s.shadowDist, 7);
  assert.equal(s.bgPadX, 20);
  assert.equal(s.bgPadY, 12);
});
