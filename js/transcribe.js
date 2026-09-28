/*
 * SubtitleEngine Pro — Transcripción con Whisper.
 *
 * 1. Mezcla el audio de una pista del timeline en tiempo de secuencia (16 kHz mono).
 * 2. Lo transcribe con una API compatible con OpenAI (OpenAI, Groq…) o con whisper.cpp local.
 * 3. Refina el resultado contra la voz real detectada: ancla las palabras al inicio de la
 *    voz, elimina lo que Whisper «inventa» en los silencios y marca las palabras dudosas.
 *
 * Las funciones puras (mezcla, WAV, cortes, lectura de respuestas, refinado) no dependen
 * del DOM y se prueban en Node.
 */
(function (root) {
  'use strict';

  const SR = 16000;

  // ───────────── Audio ─────────────
  /** Remuestreo lineal (suficiente para voz a 16 kHz). */
  function resample(samples, from, to) {
    if (from === to) return samples;
    const ratio = from / to;
    const n = Math.floor(samples.length / ratio);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i * ratio, i0 = Math.floor(x), f = x - i0;
      const a = samples[i0] || 0, b = samples[i0 + 1] == null ? a : samples[i0 + 1];
      out[i] = a + (b - a) * f;
    }
    return out;
  }

  /**
   * Reconstruye el audio de la pista en tiempo de secuencia.
   * clips = [{ start, end, inPoint, path }] (segundos de secuencia / de media)
   * decoded = { [path]: { samples, sampleRate } }
   * Devuelve { samples (16 kHz), sampleRate, from } — `from` = segundo de secuencia de la muestra 0.
   */
  function mixTimeline(clips, decoded, from, to) {
    from = from == null ? Math.min(...clips.map(c => c.start)) : from;
    to = to == null ? Math.max(...clips.map(c => c.end)) : to;
    const out = new Float32Array(Math.max(1, Math.ceil((to - from) * SR)));
    const cache = new Map();
    clips.forEach(c => {
      const d = decoded[c.path];
      if (!d) return;
      let s = cache.get(c.path);
      if (!s) { s = resample(d.samples, d.sampleRate, SR); cache.set(c.path, s); }
      const a = Math.max(c.start, from), z = Math.min(c.end, to);
      if (z <= a) return;
      const src0 = Math.round((c.inPoint + (a - c.start)) * SR);
      const dst0 = Math.round((a - from) * SR);
      const n = Math.min(Math.round((z - a) * SR), out.length - dst0, s.length - src0);
      for (let i = 0; i < n; i++) {
        const v = out[dst0 + i] + s[src0 + i];
        out[dst0 + i] = v > 1 ? 1 : v < -1 ? -1 : v;
      }
    });
    return { samples: out, sampleRate: SR, from };
  }

  /** WAV PCM 16 bits mono. */
  function encodeWav(samples, sampleRate) {
    const n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const x = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7FFF, true);
    }
    return buf;
  }

  /**
   * Trozos para subir a la API (límite de 25 MB ≈ 13 min a 16 kHz): cortes de ~maxSec
   * desplazados al silencio más cercano para no partir palabras.
   */
  function chunkRanges(duration, maxSec, silences) {
    const out = [];
    let a = 0;
    while (duration - a > maxSec) {
      const target = a + maxSec;
      let cut = target;
      const cands = (silences || []).filter(r => r.end > a + maxSec * 0.6 && r.start < target);
      if (cands.length) {
        const best = cands.reduce((m, r) => (Math.abs((r.start + r.end) / 2 - target) < Math.abs((m.start + m.end) / 2 - target) ? r : m));
        cut = Math.min(target, (best.start + best.end) / 2);
      }
      out.push({ start: a, end: cut });
      a = cut;
    }
    out.push({ start: a, end: duration });
    return out;
  }

  // ───────────── Lectura de respuestas ─────────────
  const cleanWord = s => String(s || '').replace(/\s+/g, ' ').trim();

  /** Reparte palabras [{text,t0,t1,conf}] en subtítulos usando los segmentos (o pausas). */
  function wordsToCues(words, segments) {
    const cues = [];
    if (segments && segments.length) {
      segments.forEach(sg => {
        const ws = words.filter(w => w.t0 >= sg.start - 0.05 && w.t0 < sg.end + 0.05 && !w.used);
        ws.forEach(w => { w.used = true; });
        if (ws.length) cues.push({ start: Math.min(sg.start, ws[0].t0), end: Math.max(sg.end, ws[ws.length - 1].t1), words: ws });
        else if (cleanWord(sg.text)) cues.push({ start: sg.start, end: sg.end, text: cleanWord(sg.text) });
      });
      const rest = words.filter(w => !w.used);
      if (rest.length) cues.push(...wordsToCues(rest, null));
      cues.forEach(c => c.words && c.words.forEach(w => { delete w.used; }));
    } else {
      let cur = null;
      words.forEach((w, i) => {
        const prev = words[i - 1];
        if (!cur || w.t0 - prev.t1 > 0.7 || cur.words.length >= 12 || /[.?!…]$/.test(prev.text)) {
          cur = { start: w.t0, end: w.t1, words: [] };
          cues.push(cur);
        }
        cur.words.push(w);
        cur.end = w.t1;
      });
    }
    cues.forEach(c => {
      if (c.words) c.text = c.words.map(w => w.text).join(' ');
      c.end = Math.max(c.end, c.start + 0.1);
    });
    return cues.sort((a, b) => a.start - b.start);
  }

  /** Respuesta verbose_json de OpenAI / Groq. `offset` = segundo de secuencia del trozo. */
  function parseOpenAI(json, offset) {
    offset = offset || 0;
    const words = (json.words || []).map(w => ({ text: cleanWord(w.word), t0: +w.start + offset, t1: +w.end + offset, conf: w.probability != null ? +w.probability : null }))
      .filter(w => w.text && isFinite(w.t0));
    const segs = (json.segments || []).map(s => ({
      start: +s.start + offset, end: +s.end + offset, text: s.text,
      // no_speech_prob alto + logprob bajo = probable alucinación
      suspect: (s.no_speech_prob > 0.6 && s.avg_logprob < -1) || s.compression_ratio > 2.4
    }));
    const bad = segs.filter(s => s.suspect);
    const inBad = w => bad.some(s => w.t0 >= s.start - 0.02 && w.t0 < s.end);
    const cues = wordsToCues(words.filter(w => !inBad(w)), segs.filter(s => !s.suspect));
    return { cues, dropped: bad.map(s => cleanWord(s.text)) };
  }

  /** Salida -ojf de whisper.cpp (tokens con offsets en ms y probabilidad p). */
  function parseWhisperCpp(json, offset) {
    offset = offset || 0;
    const words = [];
    const segs = [];
    (json.transcription || []).forEach(sg => {
      segs.push({ start: sg.offsets.from / 1000 + offset, end: sg.offsets.to / 1000 + offset, text: sg.text });
      (sg.tokens || []).forEach(tk => {
        const txt = String(tk.text || '');
        if (!txt || /^\[_|^\[/.test(txt.trim()) || /^<\|/.test(txt)) return; // tokens especiales
        const t0 = (tk.t_dtw != null && tk.t_dtw >= 0 ? tk.t_dtw * 10 : tk.offsets.from) / 1000 + offset;
        const t1 = tk.offsets.to / 1000 + offset;
        const p = tk.p != null ? +tk.p : null;
        const last = words[words.length - 1];
        if (!last || /^\s/.test(txt) || last.seg !== segs.length) {
          words.push({ text: txt.trim(), t0, t1, conf: p, seg: segs.length });
        } else {
          last.text += txt;
          last.t1 = t1;
          if (p != null) last.conf = last.conf == null ? p : Math.min(last.conf, p);
        }
      });
    });
    const clean = words.filter(w => cleanWord(w.text)).map(w => ({ text: cleanWord(w.text), t0: w.t0, t1: Math.max(w.t1, w.t0 + 0.02), conf: w.conf }));
    return { cues: wordsToCues(clean, segs), dropped: [] };
  }

  // ───────────── Refinado contra la voz real ─────────────
  // Frases que Whisper suele inventar sobre silencio o música
  const HALLUCINATIONS = [
    /subt[ií]tulos (realizados )?por la comunidad de amara/i, /amara\.org/i,
    /gracias por (ver|mirar)( el v[ií]deo)?/i, /suscr[ií]bete/i, /no olvides suscribirte/i,
    /thanks? (you )?for watching/i, /subtitles by/i, /^[.…\s]*$/, /^\s*(m[uú]sica|music)\s*$/i
  ];

  /**
   * cues con words [{text,t0,t1,conf}] + speech [{start,end}] (voz detectada, segundos de secuencia).
   * opts = { snap: true, dropSilent: true, lowConf: 0.5 }
   * Devuelve { cues, removed: [texto], snapped: n, low: n }.
   */
  function refine(cues, speech, opts) {
    const o = Object.assign({ snap: true, dropSilent: true, lowConf: 0.5 }, opts);
    const sp = (speech || []).slice().sort((a, b) => a.start - b.start);
    const overlap = (a, b) => sp.reduce((acc, r) => acc + Math.max(0, Math.min(b, r.end) - Math.max(a, r.start)), 0);
    const removed = [];
    let snapped = 0, low = 0;
    const out = [];
    cues.forEach(c => {
      const text = c.text || (c.words || []).map(w => w.text).join(' ');
      // 1. Alucinaciones conocidas en zonas sin voz
      const voiced = sp.length ? overlap(c.start, c.end) / Math.max(0.01, c.end - c.start) : 1;
      if (o.dropSilent && sp.length && voiced < 0.15) { removed.push(text); return; }
      if (HALLUCINATIONS.some(re => re.test(text)) && voiced < 0.5) { removed.push(text); return; }
      if (!c.words || !c.words.length) { out.push(c); return; }
      // 2. Palabras: se quitan las que caen del todo en silencio y se anclan al inicio de la voz
      const words = [];
      c.words.forEach(w => {
        if (o.dropSilent && sp.length && overlap(w.t0 - 0.08, w.t1 + 0.08) <= 0) { removed.push(w.text); return; }
        if (o.snap && sp.length) {
          const inside = sp.find(r => w.t0 >= r.start && w.t0 < r.end);
          if (!inside) {
            const next = sp.find(r => r.start >= w.t0);
            if (next && next.start - w.t0 < 0.35 && next.start < w.t1) { w.t0 = next.start; snapped++; }
          }
        }
        if (o.lowConf && w.conf != null && w.conf < o.lowConf) { w.low = true; low++; }
        words.push(w);
      });
      if (!words.length) { removed.push(text); return; }
      // Tiempos crecientes y dentro del subtítulo
      for (let i = 1; i < words.length; i++) if (words[i].t0 < words[i - 1].t0) words[i].t0 = words[i - 1].t0 + 0.01;
      out.push({ start: words[0].t0, end: Math.max(words[words.length - 1].t1, Math.min(c.end, words[words.length - 1].t1 + 0.5)), words, text: words.map(w => w.text).join(' ') });
    });
    // Sin solapes entre subtítulos consecutivos
    out.sort((a, b) => a.start - b.start);
    for (let i = 1; i < out.length; i++) if (out[i].start < out[i - 1].end) out[i - 1].end = Math.max(out[i - 1].start + 0.1, out[i].start);
    return { cues: out, removed, snapped, low };
  }

  // ───────────── Motores (solo en el panel) ─────────────
  const nodeReq = () => (root.cep_node && root.cep_node.require) || (typeof root.require === 'function' ? root.require : null);

  /** multipart/form-data como Buffer (para Node) o FormData (navegador). */
  function multipart(fields, file) {
    const req = nodeReq();
    if (req) {
      const B = (root.cep_node && root.cep_node.Buffer) || req('buffer').Buffer;
      const boundary = '----SubtitleEngine' + Date.now().toString(16);
      const parts = [];
      fields.forEach(([k, v]) => parts.push(B.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`)));
      parts.push(B.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: audio/wav\r\n\r\n`));
      parts.push(B.from(file.data));
      parts.push(B.from(`\r\n--${boundary}--\r\n`));
      return { body: B.concat(parts), type: 'multipart/form-data; boundary=' + boundary };
    }
    const fd = new FormData();
    fields.forEach(([k, v]) => fd.append(k, v));
    fd.append('file', new Blob([file.data], { type: 'audio/wav' }), file.name);
    return { body: fd, type: null };
  }

  function post(url, headers, mp) {
    const req = nodeReq();
    if (req) {
      // Node (dentro de Premiere): sin CORS y sin límites del navegador
      const Buf = (root.cep_node && root.cep_node.Buffer) || req('buffer').Buffer;
      return new Promise((resolve, reject) => {
        const u = new URL(url);
        const lib = req(u.protocol === 'http:' ? 'http' : 'https');
        const r = lib.request({
          method: 'POST', hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search,
          headers: Object.assign({ 'Content-Type': mp.type, 'Content-Length': mp.body.length }, headers)
        }, res => {
          const chunks = [];
          res.on('data', d => chunks.push(d));
          res.on('end', () => resolve({ status: res.statusCode, text: Buf.concat(chunks).toString('utf8') }));
        });
        r.on('error', reject);
        r.setTimeout(10 * 60 * 1000, () => r.destroy(new Error('Tiempo de espera agotado')));
        r.end(mp.body);
      });
    }
    const h = Object.assign({}, headers);
    if (mp.type) h['Content-Type'] = mp.type;
    return fetch(url, { method: 'POST', headers: h, body: mp.body }).then(async r => ({ status: r.status, text: await r.text() }));
  }

  const PROVIDERS = {
    openai: { name: 'OpenAI', url: 'https://api.openai.com/v1', model: 'whisper-1' },
    groq: { name: 'Groq', url: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3' },
    custom: { name: 'Otro (compatible OpenAI)', url: '', model: 'whisper-1' }
  };

  /** Transcribe un trozo WAV con una API compatible con OpenAI. */
  async function transcribeAPI(wav, cfg, offset) {
    const base = (cfg.url || PROVIDERS[cfg.provider || 'openai'].url).replace(/\/+$/, '');
    const fields = [['model', cfg.model || 'whisper-1'], ['response_format', 'verbose_json'],
      ['timestamp_granularities[]', 'word'], ['timestamp_granularities[]', 'segment'], ['temperature', '0']];
    if (cfg.language && cfg.language !== 'auto') fields.push(['language', cfg.language]);
    if (cfg.prompt) fields.push(['prompt', cfg.prompt.slice(-800)]);
    const res = await post(base + '/audio/transcriptions', { Authorization: 'Bearer ' + cfg.key }, multipart(fields, { name: 'audio.wav', data: wav }));
    let json = null;
    try { json = JSON.parse(res.text); } catch (e) { /* abajo */ }
    if (res.status >= 400 || !json) {
      const msg = json && json.error ? (json.error.message || json.error) : res.text.slice(0, 200);
      throw new Error(res.status === 401 ? 'Clave de API no válida' : `La API respondió ${res.status}: ${msg}`);
    }
    if (!json.words || !json.words.length) throw new Error('La API no devolvió tiempos por palabra (el modelo debe admitir timestamp_granularities=word).');
    return parseOpenAI(json, offset);
  }

  const WHISPER_BINS = ['whisper-cli', 'whisper-cpp', 'whisper', 'main'];
  const WHISPER_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', 'C:/whisper.cpp', 'C:/Program Files/whisper.cpp'];

  /** Busca el ejecutable de whisper.cpp en las rutas habituales. */
  function findWhisperBinary(extra) {
    const req = nodeReq();
    if (!req) return null;
    const fs = req('fs'), path = req('path');
    const isWin = typeof navigator !== 'undefined' ? navigator.platform.indexOf('Win') === 0 : process.platform === 'win32';
    const dirs = [].concat(extra || [], WHISPER_DIRS, (typeof process !== 'undefined' && process.env && process.env.PATH ? process.env.PATH.split(isWin ? ';' : ':') : []));
    for (const d of dirs) {
      if (!d) continue;
      for (const b of WHISPER_BINS) {
        const p = path.join(d, b + (isWin ? '.exe' : ''));
        try { if (fs.statSync(p).isFile()) return p.replace(/\\/g, '/'); } catch (e) { /* sigue */ }
      }
    }
    return null;
  }

  /** Preset de alineación DTW de whisper.cpp según el nombre del modelo (mejora los tiempos por palabra). */
  function dtwPreset(modelPath) {
    const m = /ggml-(tiny|base|small|medium|large-v1|large-v2|large-v3-turbo|large-v3)(\.en)?[.-]/i.exec(String(modelPath).split(/[\\/]/).pop() + '.');
    if (!m) return null;
    return (m[1] + (m[2] || '')).replace(/-/g, '.').toLowerCase();
  }

  function whisperArgs(cfg, wavPath, outBase) {
    const args = ['-m', cfg.modelPath, '-f', wavPath, '-ojf', '-of', outBase, '-pp', '-l', cfg.language || 'auto', '-bs', '5', '-mc', '64'];
    if (cfg.threads) args.push('-t', String(cfg.threads));
    if (cfg.prompt) args.push('--prompt', cfg.prompt.slice(-800));
    const dtw = cfg.dtw === false ? null : dtwPreset(cfg.modelPath);
    if (dtw) args.push('-dtw', dtw);
    return args;
  }

  /** Transcribe con whisper.cpp local. onProgress(0..1). */
  function transcribeLocal(wav, cfg, offset, onProgress) {
    const req = nodeReq();
    if (!req) return Promise.reject(new Error('whisper.cpp local necesita el panel dentro de Premiere (Node.js).'));
    const fs = req('fs'), os = req('os'), path = req('path'), cp = req('child_process');
    const B = (root.cep_node && root.cep_node.Buffer) || req('buffer').Buffer;
    const bin = cfg.binary || findWhisperBinary();
    if (!bin) return Promise.reject(new Error('No se encontró whisper.cpp. Instálalo (brew install whisper-cpp o el .zip de GitHub) o indica la ruta.'));
    if (!cfg.modelPath || !fs.existsSync(cfg.modelPath)) return Promise.reject(new Error('Falta el modelo ggml (.bin). Descárgalo desde el panel o indica la ruta.'));
    const tmp = path.join(os.tmpdir(), 'subtitleengine_' + Date.now());
    const wavPath = tmp + '.wav';
    fs.writeFileSync(wavPath, B.from(wav));
    return new Promise((resolve, reject) => {
      const p = cp.spawn(bin, whisperArgs(cfg, wavPath, tmp), { windowsHide: true });
      let err = '';
      const onData = d => {
        const s = String(d);
        err += s;
        if (err.length > 20000) err = err.slice(-10000);
        const m = /progress\s*=\s*(\d+)%/.exec(s);
        if (m && onProgress) onProgress(+m[1] / 100);
      };
      p.stdout.on('data', onData);
      p.stderr.on('data', onData);
      p.on('error', e => reject(new Error('No se pudo ejecutar whisper.cpp: ' + e.message)));
      p.on('close', code => {
        try { fs.unlinkSync(wavPath); } catch (e) { /* sigue */ }
        const jsonPath = tmp + '.json';
        if (code !== 0 || !fs.existsSync(jsonPath)) {
          reject(new Error('whisper.cpp terminó con error ' + code + ': ' + err.trim().split('\n').slice(-3).join(' ')));
          return;
        }
        try {
          const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
          fs.unlinkSync(jsonPath);
          resolve(parseWhisperCpp(json, offset));
        } catch (e) { reject(new Error('No se pudo leer la salida de whisper.cpp: ' + e.message)); }
      });
    });
  }

  const MODELS = [
    { id: 'large-v3-turbo', label: 'large-v3-turbo · 1.6 GB · la mejor relación precisión/velocidad' },
    { id: 'large-v3', label: 'large-v3 · 3.1 GB · la más precisa, lenta' },
    { id: 'medium', label: 'medium · 1.5 GB' },
    { id: 'small', label: 'small · 488 MB · rápida' },
    { id: 'base', label: 'base · 148 MB · pruebas' }
  ];
  const modelUrl = id => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${id}.bin`;

  /** Descarga un modelo ggml siguiendo redirecciones, con progreso. */
  function downloadModel(id, dest, onProgress) {
    const req = nodeReq();
    if (!req) return Promise.reject(new Error('La descarga necesita el panel dentro de Premiere.'));
    const fs = req('fs'), https = req('https'), path = req('path');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const part = dest + '.part';
    return new Promise((resolve, reject) => {
      const get = (url, hops) => https.get(url, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 6) {
          res.resume();
          get(new URL(res.headers.location, url).toString(), hops + 1);
          return;
        }
        if (res.statusCode !== 200) { res.resume(); reject(new Error('Descarga fallida (' + res.statusCode + ')')); return; }
        const total = +res.headers['content-length'] || 0;
        let got = 0;
        const out = fs.createWriteStream(part);
        res.on('data', d => { got += d.length; if (onProgress && total) onProgress(got / total); });
        res.pipe(out);
        out.on('finish', () => out.close(() => { fs.renameSync(part, dest); resolve(dest); }));
        out.on('error', reject);
      }).on('error', reject);
      get(modelUrl(id), 0);
    });
  }

  root.SubFX_Transcribe = {
    SR, resample, mixTimeline, encodeWav, chunkRanges, wordsToCues, parseOpenAI, parseWhisperCpp, refine,
    PROVIDERS, MODELS, modelUrl, transcribeAPI, transcribeLocal, findWhisperBinary, whisperArgs, dtwPreset, downloadModel, HALLUCINATIONS
  };
})(typeof window !== 'undefined' ? window : globalThis);
