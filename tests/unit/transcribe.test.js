'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
require('../../js/transcribe.js');
const T = globalThis.SubFX_Transcribe;
const fx = f => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', f), 'utf8'));

test('mezcla la pista en tiempo de secuencia (recorte, posición y remuestreo)', () => {
  const sr = 48000;
  const src = new Float32Array(sr * 4);
  for (let i = sr; i < sr * 2; i++) src[i] = 0.5;                  // media: 1-2 s con señal
  const m = T.mixTimeline([{ start: 10, end: 11.5, inPoint: 0.5, path: 'a' }], { a: { samples: src, sampleRate: sr } }, 10, 12);
  assert.equal(m.sampleRate, 16000);
  assert.equal(m.samples.length, 32000);
  const at = s => m.samples[Math.round(s * 16000)];
  assert.equal(at(0.2), 0);        // secuencia 10.2 → media 0.7: silencio
  assert.ok(at(0.8) > 0.49);       // secuencia 10.8 → media 1.3: señal
  assert.equal(at(1.7), 0);        // después del clip
});

test('WAV de 16 bits válido', () => {
  const buf = Buffer.from(T.encodeWav(new Float32Array([0, 1, -1, 0.5]), 16000));
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buf.readUInt32LE(24), 16000);
  assert.equal(buf.readInt16LE(46), 32767);
  assert.equal(buf.readInt16LE(48), -32768);
});

test('los trozos para la API se cortan en silencios', () => {
  const r = T.chunkRanges(1500, 600, [{ start: 580, end: 584 }, { start: 1150, end: 1156 }]);
  assert.deepEqual(r.map(x => Math.round(x.end)), [582, 1153, 1500]);
});

test('lee verbose_json y descarta el segmento que parece alucinación', () => {
  const r = T.parseOpenAI(fx('openai-verbose.json'), 100);
  assert.equal(r.cues.length, 1);
  assert.equal(r.cues[0].text, 'Cuidado con tu mejor empleado.');
  assert.equal(r.cues[0].words[0].t0, 100.3);
  assert.deepEqual(r.dropped, ['Gracias por ver el video.']);
});

test('lee whisper.cpp -ojf: une tokens en palabras, usa DTW y la probabilidad mínima', () => {
  const r = T.parseWhisperCpp(fx('whispercpp-full.json'), 10);
  const w = r.cues[0].words;
  assert.deepEqual(w.map(x => x.text), ['Hola', 'equipo']);
  assert.ok(Math.abs(w[0].t0 - 10.32) < 1e-9);
  assert.ok(Math.abs(w[1].t0 - 10.75) < 1e-9);
  assert.equal(w[1].conf, 0.4);
});

test('refinado: ancla a la voz, quita lo que cae en silencio y marca dudosas', () => {
  const cues = [
    { start: 0.9, end: 3, words: [{ text: 'hola', t0: 0.9, t1: 1.4, conf: 0.9 }, { text: 'mundo', t0: 1.5, t1: 2, conf: 0.3 }] },
    { start: 5, end: 6, words: [{ text: 'Suscríbete', t0: 5, t1: 6, conf: 0.9 }] }
  ];
  const r = T.refine(cues, [{ start: 1.1, end: 2.2 }], {});
  assert.equal(r.cues.length, 1);
  assert.equal(r.cues[0].words[0].t0, 1.1);          // anclada al inicio real de la voz
  assert.equal(r.cues[0].start, 1.1);
  assert.equal(r.cues[0].words[1].low, true);
  assert.deepEqual(r.removed, ['Suscríbete']);
});

test('modelos: preset DTW y argumentos de whisper.cpp', () => {
  assert.equal(T.dtwPreset('/m/ggml-large-v3-turbo.bin'), 'large.v3.turbo');
  assert.equal(T.dtwPreset('C:\\m\\ggml-small.en.bin'), 'small.en');
  assert.equal(T.dtwPreset('/m/otro.bin'), null);
  const a = T.whisperArgs({ modelPath: '/m/ggml-base.bin', language: 'es', prompt: '30X, Bilbao' }, '/t/a.wav', '/t/a');
  assert.ok(a.join(' ').includes('-ojf -of /t/a'));
  assert.ok(a.join(' ').includes('-l es'));
  assert.ok(a.join(' ').includes('-dtw base'));
  assert.equal(a[a.indexOf('--prompt') + 1], '30X, Bilbao');
});

/** Servidor que imita /audio/transcriptions y comprueba lo que recibe. */
function mockServer(check) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', d => chunks.push(d));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('latin1');
        const problem = check(req, body);
        res.writeHead(problem ? 400 : 200, { 'Content-Type': 'application/json' });
        res.end(problem ? JSON.stringify({ error: { message: problem } }) : fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'openai-verbose.json')));
      });
    }).listen(0, '127.0.0.1', () => resolve(srv));
  });
}
const expectForm = (req, body) => {
  if (req.headers.authorization !== 'Bearer sk-test') return 'auth';
  for (const f of ['name="model"', 'verbose_json', 'timestamp_granularities[]', 'name="language"', 'RIFF']) if (!body.includes(f)) return 'falta ' + f;
  return null;
};

for (const mode of ['fetch (navegador)', 'Node (Premiere)']) {
  test(`API compatible OpenAI por ${mode}`, async () => {
    const srv = await mockServer(expectForm);
    const had = globalThis.require;
    if (mode.startsWith('Node')) globalThis.require = require; else delete globalThis.require;
    try {
      const wav = T.encodeWav(new Float32Array(1600), 16000);
      const r = await T.transcribeAPI(wav, { url: `http://127.0.0.1:${srv.address().port}/v1`, key: 'sk-test', model: 'whisper-1', language: 'es' }, 5);
      assert.equal(r.cues[0].words[0].t0, 5.3);
      await assert.rejects(T.transcribeAPI(wav, { url: `http://127.0.0.1:${srv.address().port}/v1`, key: 'mala', language: 'es' }, 0), /400|auth/);
    } finally {
      if (had) globalThis.require = had; else delete globalThis.require;
      srv.close();
    }
  });
}

test('whisper.cpp local de principio a fin (ejecutable simulado)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-whisper-'));
  const model = path.join(dir, 'ggml-base.bin');
  fs.writeFileSync(model, 'x');
  const fake = path.join(dir, 'whisper-cli');
  // Imita whisper.cpp: escribe <of>.json con la salida -ojf y muestra progreso
  fs.writeFileSync(fake, `#!${process.execPath}
const a = process.argv.slice(2), of = a[a.indexOf('-of') + 1];
if (!require('fs').existsSync(a[a.indexOf('-f') + 1])) process.exit(3);
console.error('progress = 50%');
require('fs').writeFileSync(of + '.json', require('fs').readFileSync(${JSON.stringify(path.join(__dirname, '..', 'fixtures', 'whispercpp-full.json'))}));
`);
  fs.chmodSync(fake, 0o755);
  globalThis.require = require;
  const prog = [];
  try {
    const r = await T.transcribeLocal(T.encodeWav(new Float32Array(1600), 16000), { binary: fake, modelPath: model, language: 'es' }, 2, p => prog.push(p));
    assert.deepEqual(r.cues[0].words.map(w => w.text), ['Hola', 'equipo']);
    assert.ok(Math.abs(r.cues[0].words[0].t0 - 2.32) < 1e-9);
    assert.deepEqual(prog, [0.5]);
  } finally { delete globalThis.require; }
});

test('los cortes avanzan siempre, incluso con un silencio enorme (antes: bucle infinito)', () => {
  const r = T.chunkRanges(2000, 600, [{ start: 500, end: 1300 }]);
  assert.ok(r.length <= 6, 'demasiados trozos: ' + r.length);
  for (let i = 0; i < r.length; i++) {
    assert.ok(r[i].end > r[i].start, 'trozo vacío');
    assert.ok(r[i].end - r[i].start <= 600 + 1e-9, 'trozo mayor que el límite');
    if (i) assert.equal(r[i].start, r[i - 1].end);
  }
  assert.equal(r[r.length - 1].end, 2000);
});

test('la descarga de modelos no guarda archivos truncados', async () => {
  const srv = await new Promise(res => {
    const s = http.createServer((req, rs) => {
      rs.writeHead(200, { 'Content-Length': 1000 });
      rs.write(Buffer.alloc(300));
      setTimeout(() => rs.destroy(), 50);          // corta la conexión a mitad
    }).listen(0, '127.0.0.1', () => res(s));
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-dl-'));
  const dest = path.join(dir, 'ggml-base.bin');
  globalThis.require = require;
  const https = require('https'), get = https.get;
  // Se descarga desde el servidor local sustituyendo el https por http
  https.get = (url, cb) => http.get(`http://127.0.0.1:${srv.address().port}/m`, cb);
  try {
    await assert.rejects(T.downloadModel('base', dest), /interrump|incompleta|aborted|socket|ECONNRESET/i);
    assert.equal(fs.existsSync(dest), false);
    assert.equal(fs.existsSync(dest + '.part'), false);
  } finally { https.get = get; delete globalThis.require; srv.close(); }
});

test('el corte elige el silencio más cercano al límite, no el último evaluado', () => {
  const r = T.chunkRanges(1000, 600, [{ start: 590, end: 700 }, { start: 400, end: 420 }]);
  assert.equal(r[0].end, 600);
});
