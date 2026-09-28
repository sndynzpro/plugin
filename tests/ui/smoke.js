/*
 * Prueba de humo del panel en Chromium (modo navegador, sin Premiere).
 * Guarda capturas en test-results/. Usa CHROMIUM_PATH si Playwright no trae su navegador.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'test-results');
const URL = 'file://' + path.join(ROOT, 'index.html').split(path.sep).join('/').replace(/^\/?/, '/');
fs.mkdirSync(OUT, { recursive: true });

let failed = 0;
const results = [];
async function check(name, fn) {
  try { const extra = await fn(); results.push(`✓ ${name}${extra ? ' · ' + extra : ''}`); }
  catch (e) { failed++; results.push(`✗ ${name}: ${e.message}`); }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

/** WAV mono 16 kHz: tono en `spans`, silencio fuera. */
function wav(file, secs, spans) {
  const sr = 16000, n = sr * secs, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    b.writeInt16LE(spans.some(([a, z]) => t > a && t < z) ? Math.round(9000 * Math.sin(2 * Math.PI * 180 * t)) : 0, 44 + i * 2);
  }
  fs.writeFileSync(file, b);
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];
  const open = async (w, h) => {
    const page = await browser.newPage({ viewport: { width: w, height: h }, ignoreHTTPSErrors: true, acceptDownloads: true });
    page.on('pageerror', e => errors.push(`${w}px: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${w}px: ${m.text()}`); });
    await page.addInitScript(() => { try { localStorage.clear(); } catch (e) { /* ignorado */ } });
    await page.goto(URL);
    await page.waitForTimeout(1200);
    return page;
  };

  // 1. Carga en las tres disposiciones
  for (const [w, h, name] of [[1440, 900, 'ancho'], [1000, 800, 'medio'], [420, 900, 'estrecho']]) {
    await check(`carga el panel (${name}, ${w}px)`, async () => {
      const p = await open(w, h);
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow <= 1, `scroll horizontal de ${overflow}px`);
      await p.screenshot({ path: path.join(OUT, `panel-${name}.png`), fullPage: name === 'estrecho' });
      await p.close();
    });
  }

  const page = await open(1440, 900);

  // 2. Todos los presets dibujan texto
  await check('todos los presets se renderizan', () => page.evaluate(() => {
    const R = window.SubFX_Renderer, ST = window.SubFX_Styles;
    const ch = { id: 'a', cueId: 'a', start: 0, end: 3, words: 'Cuidado con tu mejor empleado'.split(' ').map((t, i) => ({ ref: { id: 'w' + i, text: t, ovr: i === 3 ? { key: true } : {} }, ws: i * 0.5, we: i * 0.5 + 0.5 })) };
    const empty = [];
    ST.PRESETS.forEach(p => {
      const c = document.createElement('canvas'); c.width = 540; c.height = 960;
      const x = c.getContext('2d');
      R.renderChunk(x, 540, 960, ch, 2.9, ST.make(p));
      const d = x.getImageData(0, 0, 540, 960).data; let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 128) n++;
      if (n < 500) empty.push(p.id);
    });
    if (empty.length) throw new Error('sin píxeles: ' + empty.join(', '));
    return ST.PRESETS.length + ' presets';
  }));

  // 3. Sombras múltiples, contornos y contorno interior
  await check('sombras y contornos', () => page.evaluate(() => {
    const R = window.SubFX_Renderer, ST = window.SubFX_Styles;
    const count = over => {
      const c = document.createElement('canvas'); c.width = 1080; c.height = 1080; const x = c.getContext('2d');
      const st = ST.make(Object.assign({ font: 'Arial', weight: 900, size: 200, strokeWidth: 0, shadowOpacity: 1, shadowBlur: 0, shadowAngle: 90, shadowDist: 60, shadowColor: '#FF0000', posY: 50, hlMode: 'none', cueIn: 'none', color: '#FFFFFF' }, over));
      R.renderChunk(x, 1080, 1080, { id: 'a', cueId: 'a', start: 0, end: 2, words: [{ ref: { id: 'w', text: 'H', ovr: {} }, ws: 0, we: 2 }] }, 1, st);
      const d = x.getImageData(0, 0, 1080, 1080).data; let white = 0, red = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 200 && d[i + 1] > 200 && d[i + 3] > 200) white++;
        if (d[i] > 200 && d[i + 1] < 60 && d[i + 3] > 200) red++;
      }
      return { white, red };
    };
    const plain = count({}), stroked = count({ strokeWidth: 10, strokeColor: '#0000FF', stroke2Width: 8, stroke2Color: '#00FF00' });
    const inside = count({ strokeWidth: 10, strokeAlign: 'inside', strokeColor: '#0000FF', shadowOpacity: 0 });
    if (!(plain.red > 1000)) throw new Error('la sombra no se dibuja');
    if (!(stroked.red > plain.red)) throw new Error('los contornos no amplían la sombra');
    if (!(inside.white < plain.white * 0.5 && inside.red === 0)) throw new Error('contorno interior incorrecto');
  }));

  // 4. Pipeline PNG (sistema de archivos simulado)
  await check('render PNG: estático, secuencia y caché', () => page.evaluate(async () => {
    const files = {}, CEP = window.SubFX_CEP;
    Object.assign(CEP.fs, { mkdirp() {}, writeFile(p) { files[p] = 1; }, exists: p => !!files[p], encodePNG: async () => 'x' });
    const R = window.SubFX_Renderer, ST = window.SubFX_Styles, EXP = window.SubFX_Exporter;
    const cues = [{ id: 'c1', start: 0, end: 2, words: 'uno dos tres cuatro'.split(' ').map((t, i) => ({ id: 'w' + i, text: t, ovr: {} })) }];
    const run = async id => { const st = ST.make(ST.PRESETS.find(p => p.id === id)); return EXP.render({ layers: [{ style: st, chunks: R.buildChunks(cues, st) }], W: 1080, H: 1920, fps: 30, outDir: '/o', mode: 'auto' }); };
    const a = await run('x30-default');
    if (a.items.length !== 1 || !a.items[0].still || Math.abs(a.items[0].dur - 2) > 1e-6) throw new Error('30X Default debería ser 1 PNG estático de 2 s');
    if (!/^\d{4}_\d\d-\d\d-\d\d-\d\d_[0-9a-f]{8}\.png$/.test(a.items[0].path.split('/').pop())) throw new Error('nombre inesperado ' + a.items[0].path);
    if ((await run('x30-default')).cached !== 1) throw new Error('no reutiliza el PNG ya renderizado');
    const h = await run('hormozi');
    if (!h.items.every(i => !i.still) || h.total < 50) throw new Error('Hormozi debería exportarse como secuencia');
    return `${a.items.length} estático · ${h.items.length} secuencias (${h.total} fotogramas)`;
  }));

  // 5. Importar ASS con dos hablantes → dos capas
  await check('importa .ass con 2 hablantes en 2 capas', async () => {
    await page.setInputFiles('#fileSrt', path.join(ROOT, 'tests', 'fixtures', 'dos-hablantes.ass'));
    await page.waitForTimeout(300);
    const layers = await page.$$eval('.layer-tab span', e => e.map(x => x.textContent));
    const pills = await page.$$eval('.layer-pill', e => e.map(x => x.textContent));
    expect(layers.join() === 'Dylan,Andrés', 'capas: ' + layers);
    expect(pills.join() === 'C1,C2', 'subtítulos: ' + pills);
  });

  // 6. Edición: timecode, reemplazar, palabra clave
  await check('edita timecode, reemplaza y marca palabra clave', async () => {
    await page.fill('input.tc', '00:00:01:00');
    await page.press('input.tc', 'Enter');
    expect(await page.$eval('input.tc', i => i.value) === '00:00:01:00', 'el timecode no se aplicó');
    await page.fill('#search', 'mejor'); await page.fill('#replace', 'peor'); await page.click('#btnReplace');
    const words = await page.$$eval('.cue:first-child .chip-text', e => e.map(x => x.textContent).join(' '));
    expect(words === 'Cuidado con tu peor empleado', 'reemplazo: ' + words);
    await page.click('#btnAutoKey');
    expect((await page.$$eval('.chip.key', e => e.length)) === 2, 'debería haber 1 palabra clave por línea');
  });

  // 7. Exportar ASS
  await check('exporta .ass', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), (async () => { await page.click('#btnSubExport'); await page.click('#subExportMenu [data-fmt="ass"]'); })()]);
    const file = path.join(OUT, 'export.ass');
    await dl.saveAs(file);
    const txt = fs.readFileSync(file, 'utf8');
    expect(/^Style: Dylan,/m.test(txt) && /^Style: Andrés,/m.test(txt), 'faltan estilos por capa');
    expect((txt.match(/^Dialogue:/gm) || []).length === 2, 'faltan diálogos');
  });

  // 8. Silencios desde un archivo de audio
  await check('detecta silencios en un WAV', async () => {
    const f = path.join(os.tmpdir(), 'subtitleengine-test.wav');
    wav(f, 6, [[0.5, 2.0], [2.9, 4.2], [5.0, 5.8]]);
    await page.click('.tab[data-tab="tools"]');
    await page.setInputFiles('#silFile', f);
    await page.waitForTimeout(1500);
    const n = await page.textContent('#silCount');
    expect(n === '3', 'silencios detectados: ' + n);
    expect((await page.$$eval('.tl-s', e => e.length)) === 3, 'no se marcan en la línea de tiempo');
    await page.selectOption('#zoomTrigger', 'silence');
    await page.screenshot({ path: path.join(OUT, 'herramientas.png') });
  });

  // 9. Arrastrar un bloque en la mini-timeline
  await check('arrastra un bloque en la línea de tiempo', async () => {
    const before = await page.$eval('input.tc', i => i.value);
    const bb = await (await page.$('.tl-cue')).boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.mouse.down();
    await page.mouse.move(bb.x + bb.width / 2 + 40, bb.y + bb.height / 2, { steps: 5 });
    await page.mouse.up();
    const after = await page.$eval('input.tc', i => i.value);
    expect(after > before, `${before} → ${after}`);
  });

  // 10. Diagnóstico en modo navegador
  await check('diagnóstico del panel', async () => {
    await page.click('.tab[data-tab="export"]');
    await page.click('#btnDiag');
    await page.waitForSelector('#diagList li');
    await page.waitForFunction(() => !/Comprobando/.test(document.querySelector('#diagSummary').textContent));
    const rows = await page.$$eval('#diagList li', e => e.map(x => x.className + ':' + x.children[1].textContent));
    expect(rows.some(r => /^warn:Conexión con Premiere/.test(r)), 'debería avisar de que no hay Premiere: ' + rows.join(' | '));
    expect(!rows.some(r => /^bad:/.test(r)), 'errores: ' + rows.filter(r => /^bad:/.test(r)).join(' | '));
    await page.screenshot({ path: path.join(OUT, 'diagnostico.png') });
    return rows.length + ' comprobaciones';
  });

  await check('sin errores de JavaScript', async () => { expect(!errors.length, errors.join(' | ')); });

  await browser.close();
  results.forEach(r => console.log(r));
  console.log(failed ? `\n${failed} prueba(s) fallaron. Capturas en test-results/` : '\nTodo correcto. Capturas en test-results/');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
