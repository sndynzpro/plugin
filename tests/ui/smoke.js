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

  // 2b. Énfasis intercalado: caja negra/letra amarilla, caja amarilla/letra negra, caja negra…
  await check('énfasis con cajas intercaladas', () => page.evaluate(() => {
    const R = window.SubFX_Renderer, ST = window.SubFX_Styles;
    const st = ST.make(Object.assign({}, ST.PRESETS.find(p => p.id === 'enfasis'), { cueIn: 'none', emPop: false, maxWords: 0, maxWidth: 100, posY: 50, shadowOpacity: 0 }));
    const words = ['yo', 'quiero', 'que', 'te', 'lo', 'supere'].map((t, i) => ({ ref: { id: 'w' + i, text: t, ovr: [1, 3, 5].includes(i) ? { em: true } : {} }, ws: i * 0.3, we: i * 0.3 + 0.3 }));
    const W = 2400, H = 600;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    R.renderChunk(x, W, H, { id: 'e', cueId: 'e', start: 0, end: 2, words }, 1.9, st);
    const d = x.getImageData(0, H / 2, W, 1).data;
    const boxes = [];
    for (let X = 1; X < W - 6; X++) {
      const i = X * 4;
      if (d[i - 1] < 200 && d[i + 3] >= 200) {          // entra en algo opaco
        const j = (X + 4) * 4, r = d[j], g = d[j + 1], b = d[j + 2];
        if (r < 30 && g < 30 && b < 30) boxes.push('negra');
        else if (r > 230 && g > 230 && b < 190) boxes.push('amarilla');
      }
    }
    if (boxes.join() !== 'negra,amarilla,negra') throw new Error('cajas: ' + boxes.join(','));
    return boxes.join(' → ');
  }));

  // 2c. Segmentación: palabras/caracteres por línea, líneas por bloque, cortes forzados, tiempos reales
  await check('segmentación y duración', () => page.evaluate(() => {
    const R = window.SubFX_Renderer, ST = window.SubFX_Styles;
    const W = t => t.split(' ').map((x, i) => ({ id: 'w' + i, text: x, ovr: {} }));
    const cue = (txt, extra) => Object.assign({ id: 'c', start: 0, end: 4, words: W(txt) }, extra);
    const sizes = (c, st) => R.buildChunks([c], ST.make(st)).map(ch => ch.words.length);
    const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m + ': ' + JSON.stringify(a)); };
    eq(sizes(cue('a b c d e f g'), { maxWords: 3 }), [3, 2, 2], 'palabras por bloque equilibradas');
    eq(sizes(cue('a b c d e f g'), { maxWords: 0, maxLines: 2, maxWordsLine: 2 }), [4, 3], 'líneas × palabras por línea');
    eq(sizes(cue('uno dos tres cuatro'), { maxWords: 0, maxChars: 8 }), [2, 1, 1], 'caracteres por bloque');
    const c = cue('a b c d e'); c.words[3].ovr.cut = true;
    eq(sizes(c, { maxWords: 0 }), [3, 2], 'nuevo bloque forzado');
    const t = cue('a b c', { start: 0, end: 3 }); t.words[0].t0 = 0; t.words[1].t0 = 2; t.words[2].t0 = 2.5;
    const ws = R.buildChunks([t], ST.make({ maxWords: 0 }))[0].words.map(w => w.ws);
    eq(ws, [0, 2, 2.5], 'tiempos reales por palabra');
    const g = [cue('a', { start: 0, end: 1 }), cue('b', { id: 'c2', start: 1.2, end: 2 })];
    const ends = R.buildChunks(g, ST.make({ maxWords: 0, holdGap: 0.3 })).map(ch => ch.end);
    eq(ends, [1.2, 2], 'rellena huecos cortos');
    if (R.cleanPunct('hola, mundo.', 'soft') !== 'hola mundo' || R.cleanPunct('¿qué?', 'soft') !== '¿qué?') throw new Error('puntuación');
    return 'ok';
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
    Object.assign(CEP.fs, {
      mkdirp() {}, writeFile(p) { files[p] = 1; }, exists: p => !!files[p], encodePNG: async () => 'x',
      list: dir => Array.from(new Set(Object.keys(files).filter(f => f.startsWith(dir + '/')).map(f => f.slice(dir.length + 1).split('/')[0])))
    });
    const R = window.SubFX_Renderer, ST = window.SubFX_Styles, EXP = window.SubFX_Exporter;
    const cues = [{ id: 'c1', start: 0, end: 2, words: 'uno dos tres cuatro'.split(' ').map((t, i) => ({ id: 'w' + i, text: t, ovr: {} })) }];
    const run = async id => { const st = ST.make(ST.PRESETS.find(p => p.id === id)); return EXP.render({ layers: [{ style: st, chunks: R.buildChunks(cues, st) }], W: 1080, H: 1920, fps: 30, outDir: '/o', mode: 'auto' }); };
    const a = await run('x30-default');
    if (a.items.length !== 1 || !a.items[0].still || Math.abs(a.items[0].dur - 2) > 1e-6) throw new Error('30X Default debería ser 1 PNG estático de 2 s');
    if (!/^\d{4}_\d\d-\d\d-\d\d-\d\d_[0-9a-f]{8}\.png$/.test(a.items[0].path.split('/').pop())) throw new Error('nombre inesperado ' + a.items[0].path);
    if ((await run('x30-default')).cached !== 1) throw new Error('no reutiliza el PNG ya renderizado');
    // Un subtítulo nuevo ANTES de otro desplaza su posición en la lista: la caché debe seguir sirviendo
    const st0 = ST.make(ST.PRESETS.find(p => p.id === 'x30-default'));
    const later = [{ id: 'L', start: 5, end: 7, words: 'caché por contenido'.split(' ').map((t, i) => ({ id: 'l' + i, text: t, ovr: {} })) }];
    const r1 = await EXP.render({ layers: [{ style: st0, chunks: R.buildChunks(later, st0) }], W: 1080, H: 1920, fps: 30, outDir: '/k', mode: 'auto' });
    const withNew = [{ id: 'N', start: 1, end: 3, words: [{ id: 'nw', text: 'nuevo', ovr: {} }] }].concat(later);
    const r2 = await EXP.render({ layers: [{ style: st0, chunks: R.buildChunks(withNew, st0) }], W: 1080, H: 1920, fps: 30, outDir: '/k', mode: 'auto' });
    if (!/^0001_/.test(r1.items[0].path.split('/').pop())) throw new Error('índice inesperado');
    if (r2.cached !== 1 || r2.encoded !== 1) throw new Error(`caché dependiente de la posición: ${r2.cached} reutilizados, ${r2.encoded} codificados`);
    const h = await run('hormozi');
    if (!h.items.every(i => !i.still) || h.total < 50) throw new Error('Hormozi debería exportarse como secuencia');
    return `${a.items.length} estático · ${h.items.length} secuencias (${h.total} fotogramas)`;
  }));

  // 4b. Sincronía: fotogramas enteros, sin solapes, fps no enteros y vista previa rápida
  await check('fotogramas exactos y vista previa rápida', () => page.evaluate(async () => {
    const files = {}, CEP = window.SubFX_CEP;
    Object.assign(CEP.fs, { mkdirp() {}, writeFile(p) { files[p] = 1; }, exists: p => !!files[p], encodePNG: async () => 'x' });
    const R = window.SubFX_Renderer, ST = window.SubFX_Styles, EXP = window.SubFX_Exporter;
    const W = t => t.split(' ').map((x, i) => ({ id: 'w' + i + x, text: x, ovr: {} }));
    const cues = [
      { id: 'a', start: 0.013, end: 1.4671, words: W('uno dos tres') },
      { id: 'b', start: 1.4671, end: 1.4801, words: W('corto') },          // menos de un fotograma
      { id: 'c', start: 1.49, end: 3.333, words: W('cuatro cinco seis siete') }
    ];
    const fps = 30000 / 1001;
    const check = items => {
      items.forEach(i => { if (!Number.isInteger(i.f0) || !Number.isInteger(i.frames) || i.frames < 1) throw new Error('fotogramas no enteros'); });
      const s = items.slice().sort((a, b) => a.f0 - b.f0);
      for (let i = 1; i < s.length; i++) if (s[i].f0 < s[i - 1].f0 + s[i - 1].frames) throw new Error(`solape ${s[i - 1].f0}+${s[i - 1].frames} > ${s[i].f0}`);
      return s;
    };
    const st = ST.make(ST.PRESETS.find(p => p.id === 'hormozi'));
    const chunks = R.buildChunks(cues, st);
    const full = check((await EXP.render({ layers: [{ style: st, chunks }], W: 1080, H: 1920, fps, outDir: '/f', mode: 'auto' })).items);
    const draft = check((await EXP.render({ layers: [{ style: st, chunks }], W: 1080, H: 1920, fps, outDir: '/d', mode: 'draft', namePrefix: 'SE·prev ' })).items);
    if (!draft.every(i => i.still)) throw new Error('la vista previa debe ser solo PNG fijos');
    const endF = a => a[a.length - 1].f0 + a[a.length - 1].frames;
    if (draft[0].f0 !== full[0].f0 || endF(draft) !== endF(full)) throw new Error('la vista previa no cubre el mismo rango que el render final');
    if (draft.length <= full.length) throw new Error('la vista previa debería tener un PNG por palabra');
    if (!/^SE·prev \d{3} · /.test(draft[0].name)) throw new Error('nombre de vista previa: ' + draft[0].name);
    return `${full.length} clips finales · ${draft.length} PNG de vista previa · 29.97 fps`;
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

  // 6b. Marcar énfasis desde el panel
  await check('marca palabras con énfasis', async () => {
    await page.click('.tab[data-tab="fx"]');
    await page.click('.cue:first-child .chip:nth-child(4)');
    await page.click('label.toggle:has(#ovEm)');
    const n = await page.$$eval('.chip.em', e => e.length);
    expect(n === 1, 'chips con énfasis: ' + n);
    await page.keyboard.press('Escape');
  });

  // 6b2. Palabras repetidas al editar el texto: cada una conserva su identidad
  await check('palabras repetidas no comparten identidad', async () => {
    await page.click('.cue:first-child [data-act="edit"]');
    await page.fill('.cue:first-child .cue-edit', 'no no no quiero');
    await page.press('.cue:first-child .cue-edit', 'Enter');
    await page.click('.cue:first-child [data-act="edit"]');
    await page.fill('.cue:first-child .cue-edit', 'no no no quiero ya');
    await page.press('.cue:first-child .cue-edit', 'Enter');
    const ids = await page.$$eval('.cue:first-child .chip', e => e.map(x => x.dataset.w));
    expect(ids.length === 5 && new Set(ids).size === 5, 'ids repetidos: ' + ids.join(','));
  });

  // 6c. Dividir y unir subtítulos
  await check('divide y une subtítulos', async () => {
    const before = await page.$$eval('.cue', e => e.length);
    await page.click('.cue:first-child .chip:nth-child(3)');
    await page.click('#btnSplit');
    const mid = await page.$$eval('.cue', e => e.length);
    await page.click('.cue:first-child .chip:nth-child(1)');
    await page.click('#btnMerge');
    const after = await page.$$eval('.cue', e => e.length);
    expect(mid === before + 1 && after === before, `${before} → ${mid} → ${after}`);
    await page.keyboard.press('Escape');
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

  // 11. Transcripción: diálogo → WAV → API compatible OpenAI simulada → refinado → subtítulos
  await check('transcribe con Whisper (API simulada)', async () => {
    const http = require('http');
    const fixture = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'openai-verbose.json'));
    let got = '';
    const srv = await new Promise(res => {
      const s = http.createServer((req, rs) => {
        const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
        if (req.method === 'OPTIONS') { rs.writeHead(204, cors); rs.end(); return; }
        const ch = []; req.on('data', d => ch.push(d));
        req.on('end', () => { got = Buffer.concat(ch).toString('latin1') + ' ' + req.headers.authorization; rs.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, cors)); rs.end(fixture); });
      }).listen(0, '127.0.0.1', () => res(s));
    });
    try {
      const f = path.join(os.tmpdir(), 'subtitleengine-voz.wav');
      wav(f, 7, [[0.3, 2.5]]);                      // voz solo al principio: lo de 4-6.5 s es silencio
      await page.click('#btnTranscribe');
      await page.selectOption('#trEngine', 'api');
      await page.selectOption('#trProvider', 'custom');
      await page.fill('#trUrl', `http://127.0.0.1:${srv.address().port}/v1`);
      await page.fill('#trKey', 'sk-prueba');
      await page.selectOption('#trLang', 'es');
      await page.setInputFiles('#trFile', f);
      await page.waitForFunction(() => /Listo|Error/.test(document.querySelector('#trStatus').textContent), null, { timeout: 15000 });
      const status = await page.textContent('#trStatus');
      expect(/^Listo/.test(status), status);
      expect(got.includes('Bearer sk-prueba') && got.includes('verbose_json') && got.includes('RIFF'), 'petición incompleta');
      const words = await page.$$eval('.cue .chip-text', e => e.map(x => x.textContent).join(' '));
      expect(words === 'Cuidado con tu mejor empleado.', 'subtítulos: ' + words);
      await page.screenshot({ path: path.join(OUT, 'transcripcion.png') });
      await page.click('#trCancel');
      return status.replace(/^Listo en \d+ s: /, '');
    } finally { srv.close(); }
  });

  // 12. Vídeo de referencia: los subtítulos siguen al fotograma presentado
  const FF = process.env.FFMPEG_PATH || (() => { try { require('child_process').execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return 'ffmpeg'; } catch (e) { return null; } })();
  if (FF) await check('vídeo de referencia sincronizado al fotograma', async () => {
    const f = path.join(os.tmpdir(), 'subtitleengine-ref.webm');
    require('child_process').execFileSync(FF, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=540x960:r=30:d=12', '-c:v', 'libvpx', '-deadline', 'realtime', '-g', '30', f], { stdio: 'ignore' });
    await page.click('#btnVideo');
    await page.click('#videoMenu [data-v="file"]');
    await page.setInputFiles('#videoFile', f);
    await page.waitForFunction(() => document.body.classList.contains('has-video'), null, { timeout: 8000 });
    await page.click('#btnPlay');
    await page.waitForTimeout(1500);
    await page.click('#btnPlay');
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const v = document.getElementById('refVideo');
      const [h, m, sec, fr] = document.getElementById('timeLabel').textContent.split(':').map(Number);
      return { video: v.currentTime, panel: (h * 3600 + m * 60 + sec) + fr / 30, rvfc: !!v.requestVideoFrameCallback, paused: v.paused };
    });
    expect(r.paused, 'el vídeo sigue reproduciéndose');
    expect(r.video > 0.8, 'el vídeo no avanzó: ' + r.video);
    expect(Math.abs(r.video - r.panel) <= 1 / 30 + 1e-3, `desfase ${(r.video - r.panel).toFixed(3)} s`);
    await page.screenshot({ path: path.join(OUT, 'video-referencia.png') });
    return `vídeo ${r.video.toFixed(3)} s · panel ${r.panel.toFixed(3)} s · rVFC ${r.rvfc ? 'sí' : 'no'}`;
  });

  await check('sin errores de JavaScript', async () => { expect(!errors.length, errors.join(' | ')); });

  await browser.close();
  results.forEach(r => console.log(r));
  console.log(failed ? `\n${failed} prueba(s) fallaron. Capturas en test-results/` : '\nTodo correcto. Capturas en test-results/');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
