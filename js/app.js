/*
 * SubtitleEngine Pro — Lógica de la interfaz.
 */
(function () {
  'use strict';

  const FX = window.SubFX_Effects;
  const ST = window.SubFX_Styles;
  const SRT = window.SubFX_SRT;
  const R = window.SubFX_Renderer;
  const CEP = window.SubFX_CEP;
  const EXP = window.SubFX_Exporter;
  const AU = window.SubFX_Audio;
  const ZM = window.SubFX_Zoom;
  const TR = window.SubFX_Transcribe;
  const PX = window.SubFX_Proxy;

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const LS_SESSION = 'subfx.session.v1';
  const LS_STYLES = 'subfx.styles.v1';
  const MAX_LAYERS = 4;
  const SWATCHES = ['#F6F5F0', '#FAFF96', '#FFE600', '#FF7A00', '#FF3D3D', '#FF3D9A', '#C13DFF',
    '#7C5CFF', '#3D8BFF', '#22D3EE', '#22C55E', '#A3E635', '#000000'];
  const STOP = new Set(('el la los las un una unos unas de del al a y o u e en con por para que se su sus lo le les ' +
    'mi tu es son fue ser muy mas más pero como este esta esto eso ya no si sí me te nos the and of to in is it you').split(' '));

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const debounce = (fn, ms) => { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; };
  const norm = s => String(s).toLocaleLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]/gu, '');

  // ───────────── Estado ─────────────
  let uid = 1;
  const newId = p => p + (uid++).toString(36);

  const DEFAULT_LAYERS = () => [
    { name: 'Principal', styleId: ST.DEFAULT_ID },
    { name: 'Speaker 2', styleId: 'x30-speaker2' }
  ];

  const S = {
    cues: [],
    layers: DEFAULT_LAYERS(),
    editLayer: 0,
    selection: new Set(),
    anchor: null,
    time: 0,
    playing: false,
    playEnd: null,
    fxCat: '',
    styleCat: '',
    seq: null,
    silences: [],
    settings: {
      replace: true, format: 'auto', fps: 'auto', track: -1, startMode: 'zero', offset: 0, outDir: '', bg: 'scene', mode: 'auto',
      safe: true,
      sil: { threshold: -38, minDur: 0.4, padIn: 0.06, padOut: 0.09, mode: 'ripple', track: 0, shift: true },
      tr: { engine: 'api', provider: 'openai', url: '', key: '', model: '', language: 'es', prompt: '', track: 0, range: 'all', snap: true, drop: true, binary: '', modelPath: '', dlModel: 'large-v3-turbo' },
      zoom: { min: 100, max: 120, trigger: 'cut', direction: 'in', easing: 'smooth', frames: 8, interval: 2.5, focal: 'face', fx: 50, fy: 33, scope: 'selected', track: 0, replace: true }
    },
    history: [],
    future: []
  };
  let styles = {};
  let layerData = [];          // [{ style, chunks }]
  let chunks = [];             // todos los bloques (ordenados)
  let duration = 10;
  const wordMap = new Map();   // id → { word, cue }
  let wordOrder = [];
  const chipEls = new Map();
  const cueEls = new Map();

  const layerStyle = i => styles[(S.layers[i] || S.layers[0]).styleId] || styles[ST.DEFAULT_ID] || Object.values(styles)[0];
  const style = () => layerStyle(S.editLayer);
  const seqFps = () => (S.settings.fps !== 'auto' ? +S.settings.fps : (S.seq && S.seq.fps) || 30);
  const fmtTC = t => SRT.toTC(t, seqFps());

  // ───────────── Persistencia ─────────────
  function loadStyles() {
    styles = {};
    ST.PRESETS.forEach(p => { styles[p.id] = ST.make(p); });
    try {
      const saved = JSON.parse(localStorage.getItem(LS_STYLES) || '{}');
      Object.keys(saved).forEach(id => { styles[id] = ST.make(saved[id]); });
    } catch (e) { /* ignorado */ }
  }
  const saveStyles = debounce(() => {
    const out = {};
    Object.keys(styles).forEach(id => {
      const preset = ST.PRESETS.find(p => p.id === id);
      if (!preset || JSON.stringify(styles[id]) !== JSON.stringify(ST.make(preset))) out[id] = styles[id];
    });
    try { localStorage.setItem(LS_STYLES, JSON.stringify(out)); } catch (e) { /* ignorado */ }
  }, 300);

  const saveSession = debounce(() => {
    try {
      localStorage.setItem(LS_SESSION, JSON.stringify({
        cues: S.cues, layers: S.layers, editLayer: S.editLayer, settings: S.settings, uid
      }));
    } catch (e) { /* ignorado */ }
  }, 400);

  function loadSession() {
    try {
      const d = JSON.parse(localStorage.getItem(LS_SESSION) || 'null');
      if (!d || !Array.isArray(d.cues)) return false;
      S.cues = d.cues;
      if (Array.isArray(d.layers) && d.layers.length) S.layers = d.layers;
      else if (d.styleId) S.layers[0].styleId = d.styleId; // sesiones de SubFX Studio
      S.layers.forEach(l => { if (!styles[l.styleId]) l.styleId = ST.DEFAULT_ID; });
      S.editLayer = Math.min(d.editLayer || 0, S.layers.length - 1);
      const set = d.settings || {};
      Object.assign(S.settings.sil, set.sil || {});
      Object.assign(S.settings.zoom, set.zoom || {});
      Object.assign(S.settings.tr, set.tr || {});
      delete set.sil; delete set.zoom; delete set.tr;
      Object.assign(S.settings, set);
      uid = d.uid || 1000;
      return true;
    } catch (e) { return false; }
  }

  // ───────────── Datos ─────────────
  const splitWords = text => String(text).split(/\s+/).filter(Boolean).map(t => ({ id: newId('w'), text: t, ovr: {} }));

  function cuesFromText(text) {
    const parsed = SRT.parse(text);
    // Hablantes distintos → capas (líneas paralelas)
    const speakers = [];
    parsed.forEach(c => { if (c.speaker && speakers.indexOf(c.speaker) === -1) speakers.push(c.speaker); });
    return {
      speakers,
      cues: parsed.map(c => ({
        id: newId('c'), start: c.start, end: c.end, speaker: c.speaker || '',
        layer: Math.min(MAX_LAYERS - 1, Math.max(0, speakers.indexOf(c.speaker))),
        words: c.words ? c.words.map(w => ({ id: newId('w'), text: w.text, ovr: {}, t0: w.t0, t1: w.t1 })) : splitWords(c.text)
      }))
    };
  }

  function indexWords() {
    wordMap.clear();
    wordOrder = [];
    S.cues.sort((a, b) => a.start - b.start || (a.layer || 0) - (b.layer || 0));
    S.cues.forEach(cue => cue.words.forEach(w => {
      if (!w.ovr) w.ovr = {};
      wordMap.set(w.id, { word: w, cue });
      wordOrder.push(w.id);
    }));
    for (const id of Array.from(S.selection)) if (!wordMap.has(id)) S.selection.delete(id);
  }

  function rebuild() {
    layerData = S.layers.map((l, i) => {
      const st = layerStyle(i);
      return { style: st, chunks: R.buildChunks(S.cues.filter(c => (c.layer || 0) === i), st, 0) };
    });
    chunks = [].concat(...layerData.map(l => l.chunks)).sort((a, b) => a.start - b.start);
    const last = S.cues.reduce((m, c) => Math.max(m, c.end), 0);
    duration = Math.max(1, last + 0.5);
    if (S.time > duration) S.time = 0;
  }

  function snapshot() {
    S.history.push(JSON.stringify(S.cues));
    if (S.history.length > 80) S.history.shift();
    S.future = [];
  }
  function undo() {
    if (!S.history.length) return toast('Nada que deshacer');
    S.future.push(JSON.stringify(S.cues));
    S.cues = JSON.parse(S.history.pop());
    onCuesReplaced();
  }
  function redo() {
    if (!S.future.length) return toast('Nada que rehacer');
    S.history.push(JSON.stringify(S.cues));
    S.cues = JSON.parse(S.future.pop());
    onCuesReplaced();
  }
  function onCuesReplaced() {
    indexWords();
    rebuild();
    renderCueList();
    renderTimelineCues();
    refreshSelectionUI();
    saveSession();
    markDirty();
  }

  // ───────────── Toasts ─────────────
  function toast(msg, kind, ms) {
    const t = el('div', 'toast ' + (kind || ''), msg);
    $('#toasts').appendChild(t);
    setTimeout(() => {
      t.style.transition = 'opacity .3s, transform .3s';
      t.style.opacity = '0';
      t.style.transform = 'translateY(6px)';
      setTimeout(() => t.remove(), 300);
    }, ms || 2600);
  }

  // ───────────── Vista previa ─────────────
  const canvas = $('#preview');
  const ctx = canvas.getContext('2d');
  let dirty = true;
  const markDirty = () => { dirty = true; };

  function frameSize() {
    const f = S.settings.format;
    if (f === 'auto') {
      if (S.seq && S.seq.width && S.seq.height) return { W: S.seq.width, H: S.seq.height };
      return { W: 1080, H: 1920 };
    }
    const [w, h] = f.split('x').map(Number);
    return { W: w, H: h };
  }

  function fitStage() {
    const { W, H } = frameSize();
    const stage = $('#stage');
    const inner = $('#stageInner');
    const sw = stage.clientWidth - 16, sh = stage.clientHeight - 16;
    const scale = Math.max(0.01, Math.min(sw / W, sh / H));
    inner.style.width = Math.floor(W * scale) + 'px';
    inner.style.height = Math.floor(H * scale) + 'px';
    const lim = Math.min(1, 1920 / Math.max(W, H));
    const cw = Math.round(W * lim), ch = Math.round(H * lim);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    markDirty();
  }

  function drawSafeGuides() {
    const st = style();
    const W = canvas.width, H = canvas.height, u = Math.min(W, H) / R.REF;
    const top = (st.safeTop || 0) * u, bottom = (st.safeBottom || 0) * u, side = (st.safeSide || 0) * u;
    if (!top && !bottom && !side) return;
    ctx.save();
    ctx.fillStyle = 'rgba(250,255,150,0.07)';
    if (top) ctx.fillRect(0, 0, W, top);
    if (bottom) ctx.fillRect(0, H - bottom, W, bottom);
    ctx.setLineDash([8 * u + 2, 6 * u + 2]);
    ctx.lineWidth = Math.max(1, 2 * u);
    ctx.strokeStyle = 'rgba(250,255,150,0.75)';
    ctx.strokeRect(side, top, W - side * 2, H - top - bottom);
    ctx.restore();
  }

  let liveCue = null, liveWord = null;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Se dibuja el fotograma exacto que muestra Premiere en ese instante (sin interpolar)
    const fps = seqFps();
    const tq = Math.floor(S.time * fps + 1e-6) / fps;
    const active = R.renderLayers(ctx, canvas.width, canvas.height, layerData, tq);
    if (S.settings.safe) drawSafeGuides();
    $('#timeLabel').textContent = fmtTC(tq);
    $('#tlHead').style.left = (S.time / duration * 100) + '%';

    const ch = active.find(c => c.layer === S.editLayer) || active[0];
    const cueId = ch ? ch.cueId : null;
    let wId = null;
    if (ch) for (const w of ch.words) if (S.time >= w.ws && S.time < w.we) wId = w.ref.id;
    if (cueId !== liveCue) {
      if (liveCue && cueEls.get(liveCue)) cueEls.get(liveCue).classList.remove('live');
      if (cueId && cueEls.get(cueId)) {
        const row = cueEls.get(cueId);
        row.classList.add('live');
        if (S.playing) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      liveCue = cueId;
      markTimelineLive();
    }
    if (wId !== liveWord) {
      if (liveWord && chipEls.get(liveWord)) chipEls.get(liveWord).classList.remove('live');
      if (wId && chipEls.get(wId)) chipEls.get(wId).classList.add('live');
      liveWord = wId;
    }
  }

  let lastTs = 0;
  function tick(ts) {
    const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0;
    lastTs = ts;
    if (VID.on && !VID.el.paused && (S.playing || (HOST.on && HOST.rate))) {
      // El vídeo manda (sin requestVideoFrameCallback se usa su currentTime)
      if (!VID.el.requestVideoFrameCallback) { S.time = VID.el.currentTime - hostOffset(); dirty = true; }
      if (S.playing) {
        const end = S.playEnd != null ? S.playEnd : duration;
        if (S.time >= end) { S.time = S.playEnd != null ? S.playEnd - 0.001 : S.time; setPlaying(false); }
      }
    } else if (followHost(ts)) dirty = true;
    else if (S.playing) {
      S.time += dt;
      const end = S.playEnd != null ? S.playEnd : duration;
      if (S.time >= end) {
        S.time = S.playEnd != null ? S.playEnd - 0.001 : 0;
        setPlaying(false);
      }
      dirty = true;
    }
    if (dirty) { dirty = false; draw(); }
    tickMiniPreviews(ts);
    requestAnimationFrame(tick);
  }

  function setPlaying(on, end) {
    S.playing = on;
    S.playEnd = on ? (end == null ? null : end) : null;
    document.body.classList.toggle('playing', on);
    if (on && S.time >= duration - 0.05) S.time = 0;
    if (VID.on) {
      const v = VID.el;
      if (on) {
        v.muted = VID.muted;
        v.playbackRate = 1;
        if (Math.abs(v.currentTime - (S.time + hostOffset())) > 0.02) v.currentTime = S.time + hostOffset();
        v.play().catch(() => { /* sin audio permitido: se reproduce en silencio */ v.muted = true; v.play().catch(() => {}); });
      } else {
        if (!v.paused) v.pause();
        // En pausa se muestra el fotograma de v.currentTime: el panel se alinea a él
        S.time = Math.max(0, Math.min(duration, v.currentTime - hostOffset()));
      }
    }
    markDirty();
  }
  function seek(t, fromHost) {
    S.time = Math.max(0, Math.min(duration, t));
    if (VID.on && !S.playing && !(HOST.on && HOST.rate)) VID.el.currentTime = S.time + hostOffset();
    markDirty();
    if (!fromHost) pushPlayhead();
  }

  // ───────────── Vídeo de referencia (proxy) ─────────────
  /*
   * El vídeo es el reloj maestro: requestVideoFrameCallback entrega el tiempo exacto del
   * fotograma que se está mostrando y en ese mismo instante se dibujan los subtítulos.
   */
  const VID = { el: document.getElementById('refVideo'), on: false, muted: false, path: null };
  function videoFrameLoop() {
    const v = VID.el;
    if (!v.requestVideoFrameCallback) return;
    const cb = (now, meta) => {
      if (VID.on && !v.paused && (S.playing || (HOST.on && HOST.rate))) {
        S.time = Math.max(0, Math.min(duration, meta.mediaTime - hostOffset()));
        dirty = false;
        draw();
      }
      v.requestVideoFrameCallback(cb);
    };
    v.requestVideoFrameCallback(cb);
  }

  function loadVideo(url, label, path) {
    const v = VID.el;
    v.src = url;
    v.hidden = false;
    v.muted = VID.muted;
    v.addEventListener('loadedmetadata', function once() {
      v.removeEventListener('loadedmetadata', once);
      VID.on = true;
      VID.path = path || null;
      document.body.classList.add('has-video');
      $('#stage').classList.add('has-video');
      v.currentTime = S.time + hostOffset();
      badge(`${label} · ${v.videoWidth}×${v.videoHeight}`, 3500);
      if (path) { S.settings.proxyPath = path; saveSession(); }
      markDirty();
    });
    v.addEventListener('error', function onerr() {
      v.removeEventListener('error', onerr);
      toast('Este vídeo no se puede reproducir en el panel. Prueba con H.264 (.mp4) o WebM.', 'err', 6000);
      unloadVideo();
    });
  }
  function unloadVideo() {
    const v = VID.el;
    v.pause();
    v.removeAttribute('src');
    v.load();
    v.hidden = true;
    VID.on = false;
    S.settings.proxyPath = '';
    saveSession();
    document.body.classList.remove('has-video');
    $('#stage').classList.remove('has-video');
    markDirty();
  }
  let badgeTimer = null;
  function badge(text, ms) {
    const b = $('#stageBadge');
    b.textContent = text;
    b.hidden = !text;
    clearTimeout(badgeTimer);
    if (ms) badgeTimer = setTimeout(() => { b.hidden = true; }, ms);
  }

  const fileUrl = p => 'file://' + (/^[A-Za-z]:/.test(p) ? '/' : '') + encodeURI(String(p).replace(/\\/g, '/')).replace(/#/g, '%23');

  let proxying = false;
  async function buildProxy() {
    if (!CEP.available) { toast('El proxy se crea dentro de Premiere. Aquí puedes «Cargar un vídeo exportado…»', 'warn', 5000); return; }
    if (proxying) return;
    const ff = S.settings.ffmpeg || PX.findFfmpeg();
    if (!ff) {
      toast('Instala ffmpeg (Mac: brew install ffmpeg · Windows: winget install ffmpeg) o exporta un .mp4 de baja calidad desde Premiere y usa «Cargar un vídeo exportado…»', 'warn', 9000);
      return;
    }
    proxying = true;
    const t0 = performance.now();
    try {
      badge('Proxy: leyendo el timeline…');
      const vt = S.settings.zoom.track || 0;
      const vi = await CEP.call('getVideoClips', 'track', String(vt));
      if (!vi || !vi.ok) throw new Error((vi && vi.error) || 'Premiere no respondió');
      const ai = await CEP.call('getAudioClips', String(S.settings.tr.track || 0));
      const aclips = ai && ai.ok ? ai.clips.filter(c => c.path) : [];
      const durationS = Math.max(0, ...vi.clips.map(c => c.end), ...aclips.map(c => c.end));
      if (!durationS) throw new Error('El timeline está vacío');
      let wav = null;
      if (aclips.length) {
        const decoded = {};
        const paths = Array.from(new Set(aclips.map(c => c.path)));
        for (let i = 0; i < paths.length; i++) { badge(`Proxy: audio ${i + 1}/${paths.length}…`); decoded[paths[i]] = await decodeMedia(paths[i]); }
        wav = TR.encodeWav(TR.mixTimeline(aclips, decoded, 0, durationS).samples, TR.SR);
      }
      const codec = VID.el.canPlayType('video/mp4; codecs="avc1.42E01E"') ? 'h264' : 'vp8';
      const dir = CEP.systemPath('userData') + '/SubtitleEngine/proxies';
      CEP.fs.mkdirp(dir);
      const out = await PX.makeProxy({
        bin: ff, clips: vi.clips, wav, W: vi.width || frameSize().W, H: vi.height || frameSize().H, fps: vi.fps || seqFps(),
        duration: durationS, codec, dir, onProgress: p => badge(`Proxy: ${Math.round(p * 100)} %`)
      });
      loadVideo(fileUrl(out), `Proxy listo en ${((performance.now() - t0) / 1000).toFixed(0)} s`, out);
      toast('Proxy listo: dale play en el panel para ver los subtítulos en tiempo real con el vídeo', 'ok', 4500);
    } catch (err) {
      badge('');
      toast('Proxy: ' + err.message, 'err', 7000);
    } finally { proxying = false; }
  }

  function bindVideo() {
    videoFrameLoop();
    const menu = $('#videoMenu');
    menu.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.v === 'proxy') buildProxy();
      else if (b.dataset.v === 'file') $('#videoFile').click();
      else if (b.dataset.v === 'mute') { VID.muted = !VID.muted; VID.el.muted = VID.muted; toast(VID.muted ? 'Audio del vídeo silenciado' : 'Audio del vídeo activado'); }
      else if (b.dataset.v === 'off') unloadVideo();
    });
    $('#videoFile').addEventListener('change', e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      const p = f.path || null; // CEP expone la ruta real del archivo
      loadVideo(URL.createObjectURL(f), f.name, p);
    });
    VID.el.addEventListener('ended', () => setPlaying(false));
    // Tras un salto (o una pausa desde Premiere) el fotograma mostrado es el de currentTime
    VID.el.addEventListener('seeked', () => {
      if (VID.el.paused) { S.time = Math.max(0, Math.min(duration, VID.el.currentTime - hostOffset())); markDirty(); }
    });
    // Recuperar el último proxy
    const last = S.settings.proxyPath;
    if (last && CEP.available && CEP.fs.exists(last)) loadVideo(fileUrl(last), 'Proxy anterior', last);
  }

  function previewSelection() {
    const id = wordOrder.find(i => S.selection.has(i));
    if (!id) return;
    const ch = chunks.find(c => c.words.some(w => w.ref.id === id));
    if (!ch) return;
    S.time = Math.max(0, ch.start - 0.05);
    setPlaying(true, ch.end);
  }

  // ───────────── Sincronía con el cabezal de Premiere ─────────────
  /*
   * Premiere no avisa cuando se mueve el cabezal: se pregunta cada 100 ms y, entre
   * muestras, se predice la posición con la velocidad medida (dead reckoning). Así el
   * panel se mueve a 60 fps junto a la reproducción. La latencia de cada consulta se
   * compensa tomando el instante medio entre envío y respuesta.
   */
  const SYNC_MS = 100;
  const HOST = { on: false, timer: null, t: null, wall: 0, rate: 0, pushing: 0, busy: false, still: 0, grabbedAt: null };
  const hostOffset = () => S.settings.offset / 1000 + (S.settings.startMode === 'playhead' && S.seq ? S.seq.anchor || 0 : 0);
  const pushPlayhead = debounce(() => {
    if (!HOST.on || !CEP.available) return;
    HOST.pushing = performance.now();
    CEP.call('setPlayhead', String(S.time + hostOffset())).catch(() => null);
  }, 40);

  async function pollHost() {
    if (HOST.busy || tlDrag || performance.now() - HOST.pushing < 250) return;
    HOST.busy = true;
    const sent = performance.now();
    const r = await CEP.call('getPlayhead').catch(() => null);
    const got = performance.now();
    HOST.busy = false;
    if (!r || !r.ok || !HOST.on) return;
    const wall = (sent + got) / 2;
    if (HOST.t !== null) {
      const dWall = (wall - HOST.wall) / 1000, dT = r.t - HOST.t;
      const rate = dWall > 0 ? dT / dWall : 0;
      // Reproducción: avanza a velocidad ~constante (J/K/L también: ±1, ±2, ±4…)
      HOST.rate = Math.abs(dT) < 1e-4 ? 0 : (Math.abs(rate) > 0.2 && Math.abs(rate) < 9 ? rate : 0);
    }
    HOST.still = HOST.rate === 0 ? HOST.still + 1 : 0;
    HOST.t = r.t;
    HOST.wall = wall;
    if (VID.on) {
      const v = VID.el;
      if (HOST.rate !== 0) {
        v.muted = true; // el audio ya suena en Premiere
        v.playbackRate = Math.max(0.25, Math.min(4, Math.abs(HOST.rate)));
        if (HOST.rate < 0 || Math.abs(v.currentTime - r.t) > 0.15) v.currentTime = r.t;
        if (v.paused && HOST.rate > 0) v.play().catch(() => {});
      } else if (!v.paused) v.pause();
    }
    if (HOST.rate === 0) {
      seek(r.t - hostOffset(), true);
      if (HOST.still === 2 && !VID.on && $('#chkLiveBg').checked && HOST.grabbedAt !== r.t) liveGrab(r.t);
    }
    document.body.classList.toggle('host-playing', HOST.rate !== 0);
  }

  /** Posición prevista del cabezal de Premiere (se llama en cada fotograma del panel). */
  function followHost(now) {
    if (!HOST.on || HOST.t === null || HOST.rate === 0 || S.playing) return false;
    const t = HOST.t + HOST.rate * Math.min(1, (now - HOST.wall) / 1000) - hostOffset();
    S.time = Math.max(0, Math.min(duration, t));
    return true;
  }

  function setSync(on) {
    clearInterval(HOST.timer);
    HOST.on = false;
    HOST.t = null;
    document.body.classList.remove('host-playing');
    if (!on) return;
    if (!CEP.available) {
      toast('«Seguir a Premiere» funciona dentro de Premiere Pro', 'warn');
      $('#chkSync').checked = false;
      const t = $('#chkSync').closest('.tgl');
      if (t && t._sync) t._sync();
      return;
    }
    HOST.on = true;
    HOST.timer = setInterval(pollHost, SYNC_MS);
    pollHost();
  }

  /** Fondo en vivo: fotograma real del timeline cada vez que el cabezal se detiene. */
  let liveFile = null;
  async function liveGrab(t) {
    HOST.grabbedAt = t;
    const path = `${CEP.fs.tmpDir()}/subtitleengine_live_${Date.now()}.png`;
    try {
      const r = await CEP.call('exportFrame', path);
      if (!r || !r.ok || !(await CEP.fs.waitStable(path, 3000))) return;
      if (HOST.t !== t) { CEP.fs.remove(path); return; } // el cabezal ya se movió
      setBgImage(CEP.fs.readDataURL(path));
      if (liveFile) CEP.fs.remove(liveFile);
      liveFile = path;
    } catch (e) { /* se intenta en la siguiente pausa */ }
  }

  // ───────────── Línea de tiempo (arrastrar y recortar) ─────────────
  function renderTimelineCues() {
    const box = $('#tlCues');
    box.innerHTML = '';
    const n = S.layers.length;
    S.cues.forEach(cue => {
      const b = el('div', 'tl-cue');
      b.dataset.cue = cue.id;
      b.style.left = (cue.start / duration * 100) + '%';
      b.style.width = Math.max(0.3, (cue.end - cue.start) / duration * 100) + '%';
      b.style.top = ((cue.layer || 0) / n * 100) + '%';
      b.style.height = (100 / n) + '%';
      if (cue.words.some(w => w.ovr && (w.ovr.fx || w.ovr.color))) b.classList.add('fx');
      if ((cue.layer || 0) > 0) b.classList.add('l' + cue.layer);
      box.appendChild(b);
    });
    renderSilences();
    markTimelineLive();
  }

  function renderSilences() {
    const box = $('#tlSil');
    box.innerHTML = '';
    S.silences.forEach(r => {
      const b = el('div', 'tl-s');
      b.style.left = ((r.start - hostOffset()) / duration * 100) + '%';
      b.style.width = Math.max(0.15, (r.end - r.start) / duration * 100) + '%';
      box.appendChild(b);
    });
  }

  function markTimelineLive() {
    $$('.tl-cue.live').forEach(e => e.classList.remove('live'));
    if (liveCue) { const b = $(`.tl-cue[data-cue="${liveCue}"]`); if (b) b.classList.add('live'); }
  }

  let tlDrag = null;
  function bindTimeline() {
    const tl = $('#timeline');
    const tAt = x => { const r = tl.getBoundingClientRect(); return (x - r.left) / r.width * duration; };
    tl.addEventListener('mousedown', e => {
      setPlaying(false);
      const blk = e.target.closest('.tl-cue');
      if (blk) {
        const cue = S.cues.find(c => c.id === blk.dataset.cue);
        const r = blk.getBoundingClientRect();
        const edge = Math.max(4, Math.min(8, r.width / 4));
        const mode = e.clientX - r.left < edge ? 'l' : r.right - e.clientX < edge ? 'r' : 'm';
        tlDrag = { cue, mode, t0: tAt(e.clientX), s: cue.start, e: cue.end, moved: false };
        return;
      }
      tlDrag = { seek: true };
      seek(tAt(e.clientX));
    });
    window.addEventListener('mousemove', e => {
      if (!tlDrag) return;
      const t = tAt(e.clientX);
      if (tlDrag.seek) { seek(t); return; }
      const d = t - tlDrag.t0;
      if (!tlDrag.moved) {
        if (Math.abs(d) < duration * 0.002) return;
        snapshot();
        tlDrag.moved = true;
      }
      const c = tlDrag.cue, fps = seqFps(), q = v => Math.round(v * fps) / fps;
      if (tlDrag.mode === 'm') { const len = tlDrag.e - tlDrag.s; c.start = q(Math.max(0, tlDrag.s + d)); c.end = c.start + len; }
      else if (tlDrag.mode === 'l') c.start = q(Math.max(0, Math.min(tlDrag.e - 0.1, tlDrag.s + d)));
      else c.end = q(Math.max(tlDrag.s + 0.1, tlDrag.e + d));
      rebuild();
      renderTimelineCues();
      updateCueTimes(c);
      markDirty();
    });
    window.addEventListener('mouseup', () => {
      if (tlDrag && tlDrag.moved) { onCuesReplaced(); }
      else if (tlDrag && tlDrag.cue) seek(tlDrag.cue.start + 0.01);
      tlDrag = null;
    });
    $('#btnPlay').addEventListener('click', () => setPlaying(!S.playing));

    const bg = $('#selBg');
    bg.value = S.settings.bg === 'image' ? 'scene' : S.settings.bg;
    applyBg(bg.value);
    bg.addEventListener('change', () => {
      if (bg.value === 'image') { $('#bgFile').click(); return; }
      S.settings.bg = bg.value;
      applyBg(bg.value);
      saveSession();
    });
    $('#bgFile').addEventListener('change', e => {
      const f = e.target.files[0];
      if (!f) return;
      setBgImage(URL.createObjectURL(f));
      e.target.value = '';
    });
    const safe = $('#chkSafe');
    safe.checked = S.settings.safe !== false;
    safe.addEventListener('change', () => { S.settings.safe = safe.checked; markDirty(); saveSession(); });
    $('#chkSync').addEventListener('change', e => setSync(e.target.checked));
    $('#btnGrab').addEventListener('click', grabFrame);
  }

  function applyBg(v) {
    $('#stage').className = 'stage bg-' + v;
    if (v !== 'image') $('#stageInner').style.backgroundImage = '';
  }
  function setBgImage(url) {
    applyBg('image');
    $('#selBg').value = 'image';
    $('#stageInner').style.backgroundImage = `url("${url}")`;
  }

  async function grabFrame() {
    if (!CEP.available) { toast('Captura el fotograma dentro de Premiere Pro. Aquí puedes elegir Fondo → Imagen…', 'warn', 4000); return; }
    try {
      const path = `${CEP.fs.tmpDir()}/subtitleengine_frame_${Date.now()}.png`;
      const r = await CEP.call('exportFrame', path);
      if (!r || !r.ok) throw new Error((r && r.error) || 'Premiere no respondió');
      if (!(await CEP.fs.waitStable(path, 5000))) throw new Error('Premiere no generó el fotograma');
      setBgImage(CEP.fs.readDataURL(path));
      toast('Fotograma de Premiere como fondo', 'ok');
    } catch (err) { toast('No se pudo capturar: ' + err.message, 'err', 5000); }
  }

  // ───────────── Lista de subtítulos ─────────────
  function renderCueList() {
    const list = $('#cueList');
    list.innerHTML = '';
    chipEls.clear();
    cueEls.clear();
    liveWord = null;
    liveCue = null;
    const frag = document.createDocumentFragment();
    S.cues.forEach((cue, i) => {
      const row = el('div', 'cue');
      row.dataset.cue = cue.id;
      row.style.setProperty('--i', Math.min(i, 18));

      const meta = el('div', 'cue-meta');
      meta.appendChild(el('span', 'cue-idx', '#' + String(i + 1).padStart(2, '0')));
      const tin = el('input', 'tc');
      tin.dataset.k = 'start';
      const tout = el('input', 'tc');
      tout.dataset.k = 'end';
      tin.title = 'Entrada (HH:MM:SS:FF). Enter para aplicar';
      tout.title = 'Salida (HH:MM:SS:FF). Enter para aplicar';
      const times = el('div', 'cue-times');
      times.appendChild(tin);
      times.appendChild(el('span', 'arrow', '→'));
      times.appendChild(tout);
      meta.appendChild(times);
      row.appendChild(meta);

      const words = el('div', 'cue-words');
      cue.words.forEach(w => {
        const c = el('span', 'chip');
        c.dataset.w = w.id;
        words.appendChild(c);
        chipEls.set(w.id, c);
        paintChip(w);
      });
      row.appendChild(words);

      const side = el('div', 'cue-side');
      const lay = el('button', 'layer-pill l' + (cue.layer || 0), 'C' + ((cue.layer || 0) + 1));
      lay.dataset.act = 'layer';
      lay.title = `Capa ${(cue.layer || 0) + 1} · ${(S.layers[cue.layer || 0] || S.layers[0]).name} (clic para cambiar)`;
      side.appendChild(lay);
      const ed = el('button', 'icon-btn', '✎');
      ed.dataset.act = 'edit';
      ed.title = 'Editar el texto completo';
      side.appendChild(ed);
      const del = el('button', 'icon-btn', '×');
      del.dataset.act = 'delete';
      del.title = 'Eliminar subtítulo';
      side.appendChild(del);
      row.appendChild(side);

      cueEls.set(cue.id, row);
      frag.appendChild(row);
      updateCueTimes(cue);
    });
    list.appendChild(frag);
    $('#emptyState').hidden = S.cues.length > 0;
    const nw = S.cues.reduce((a, c) => a + c.words.length, 0);
    $('#subsSummary').textContent = S.cues.length ? `${S.cues.length} líneas · ${nw} palabras · ${fmtTC(duration - 0.5)}` : 'Sin subtítulos';
  }

  function updateCueTimes(cue) {
    const row = cueEls.get(cue.id);
    if (!row) return;
    $$('input.tc', row).forEach(inp => { if (document.activeElement !== inp) inp.value = fmtTC(cue[inp.dataset.k]); });
  }

  function paintChip(w) {
    const c = chipEls.get(w.id);
    if (!c || c.isContentEditable) return;
    const o = w.ovr || {};
    const fx = FX.get(o.fx);
    c.innerHTML = '';
    c.appendChild(el('span', 'chip-text', w.text));
    c.classList.toggle('sel', S.selection.has(w.id));
    c.classList.toggle('has-color', !!o.color);
    c.classList.toggle('has-fx', !!fx);
    c.classList.toggle('key', !!o.key);
    c.classList.toggle('em', !!o.em);
    c.classList.toggle('br', !!o.br);
    c.classList.toggle('low', !!w.low);
    c.classList.toggle('cut', !!o.cut);
    c.classList.toggle('boxed', !!o.boxColor);
    c.style.setProperty('--bc', o.boxColor || 'transparent');
    if (o.em) {
      const info = wordMap.get(w.id);
      const ems = info ? info.cue.words.filter(x => x.ovr && x.ovr.em) : [];
      c.classList.toggle('em-b', ems.indexOf(w) % 2 === 1);
    } else c.classList.remove('em-b');
    c.style.setProperty('--wc', o.color || '');
    if (fx) c.appendChild(el('i', 'fx-tag', fx.name));
    const bits = [];
    if (w.low) bits.push('Whisper no estaba seguro: revísala');
    if (o.key) bits.push('Palabra clave');
    if (o.em) bits.push('Énfasis');
    if (o.boxColor) bits.push('Caja: ' + o.boxColor);
    if (o.br) bits.push('Salto de línea antes');
    if (o.cut) bits.push('Nuevo bloque desde aquí');
    if (fx) bits.push('Efecto: ' + fx.name);
    if (o.color) bits.push('Color: ' + o.color);
    if (o.scale && o.scale !== 1) bits.push('Tamaño: ' + Math.round(o.scale * 100) + '%');
    c.title = bits.join(' · ');
  }

  function editCueText(cue) {
    const row = cueEls.get(cue.id);
    const box = $('.cue-words', row);
    box.innerHTML = '';
    const inp = el('input', 'cue-edit');
    inp.type = 'text';
    inp.value = cue.words.map(w => w.text).join(' ');
    box.appendChild(inp);
    inp.focus();
    inp.select();
    let done = false;
    const finish = commit => {
      if (done) return;
      done = true;
      const val = inp.value.replace(/\s+/g, ' ').trim();
      if (commit && val && val !== cue.words.map(w => w.text).join(' ')) {
        snapshot();
        setCueText(cue, val);
        onCuesReplaced();
      } else renderCueList();
    };
    inp.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    inp.addEventListener('blur', () => finish(true));
  }

  /** Cambia el texto de un subtítulo conservando los ajustes de las palabras que no cambian. */
  function setCueText(cue, text) {
    const old = cue.words;
    const parts = text.split(' ').filter(Boolean);
    cue.words = parts.map((t, i) => {
      const prev = old.find((w, j) => w.text === t && Math.abs(j - i) <= 2);
      return prev ? prev : { id: newId('w'), text: t, ovr: {} };
    });
  }

  function bindCueList() {
    const list = $('#cueList');
    list.addEventListener('click', e => {
      const act = e.target.closest('[data-act]');
      if (act) {
        const cue = S.cues.find(c => c.id === act.closest('.cue').dataset.cue);
        if (!cue) return;
        if (act.dataset.act === 'layer') {
          snapshot();
          cue.layer = ((cue.layer || 0) + 1) % S.layers.length;
          onCuesReplaced();
        } else if (act.dataset.act === 'edit') editCueText(cue);
        else if (act.dataset.act === 'delete') {
          snapshot();
          S.cues = S.cues.filter(c => c !== cue);
          onCuesReplaced();
          toast('Subtítulo eliminado (Ctrl+Z para deshacer)');
        }
        return;
      }
      if (e.target.closest('input')) return;
      const chip = e.target.closest('.chip');
      if (!chip || chip.isContentEditable) {
        const row = e.target.closest('.cue');
        if (row && !chip) { const cue = S.cues.find(c => c.id === row.dataset.cue); if (cue) { setPlaying(false); seek(cue.start + 0.01); } }
        return;
      }
      const id = chip.dataset.w;
      if (e.shiftKey && S.anchor && wordMap.has(S.anchor)) {
        const a = wordOrder.indexOf(S.anchor), b = wordOrder.indexOf(id);
        const [lo, hi] = a < b ? [a, b] : [b, a];
        for (let i = lo; i <= hi; i++) S.selection.add(wordOrder[i]);
      } else if (S.selection.has(id)) {
        S.selection.delete(id);
      } else {
        S.selection.add(id);
      }
      S.anchor = id;
      const ch = chunks.find(c => c.words.some(w => w.ref.id === id));
      if (ch && !S.playing) {
        const w = ch.words.find(x => x.ref.id === id);
        seek(Math.min(w.we - 0.01, w.ws + 0.5));
      }
      refreshSelectionUI();
    });

    // Edición de timecodes
    list.addEventListener('change', e => {
      const inp = e.target.closest('input.tc');
      if (!inp) return;
      const cue = S.cues.find(c => c.id === inp.closest('.cue').dataset.cue);
      const v = SRT.fromTC(inp.value, seqFps());
      if (!cue || isNaN(v)) { if (cue) updateCueTimes(cue); toast('Timecode no válido. Usa HH:MM:SS:FF', 'warn'); return; }
      snapshot();
      if (inp.dataset.k === 'start') cue.start = Math.max(0, Math.min(v, cue.end - 0.05));
      else cue.end = Math.max(cue.start + 0.05, v);
      onCuesReplaced();
    });
    list.addEventListener('keydown', e => {
      if (e.target.matches('input.tc') && e.key === 'Enter') e.target.blur();
    });

    list.addEventListener('dblclick', e => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      const info = wordMap.get(chip.dataset.w);
      if (!info) return;
      chip.contentEditable = 'true';
      chip.textContent = info.word.text;
      chip.focus();
      document.getSelection().selectAllChildren(chip);
      const finish = commit => {
        chip.removeEventListener('blur', onBlur);
        chip.removeEventListener('keydown', onKey);
        chip.contentEditable = 'false';
        const val = chip.textContent.replace(/\s+/g, ' ').trim();
        if (commit && val && val !== info.word.text) {
          snapshot();
          const parts = val.split(' ');
          info.word.text = parts[0];
          delete info.word.low;
          if (parts.length > 1) {
            const idx = info.cue.words.indexOf(info.word);
            info.cue.words.splice(idx + 1, 0, ...splitWords(parts.slice(1).join(' ')));
          }
          onCuesReplaced();
        } else {
          paintChip(info.word);
        }
      };
      const onBlur = () => finish(true);
      const onKey = ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); chip.blur(); }
        if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
        ev.stopPropagation();
      };
      chip.addEventListener('blur', onBlur);
      chip.addEventListener('keydown', onKey);
    });

    $('#search').addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const q = norm(e.target.value);
      if (!q) return;
      let n = 0;
      wordOrder.forEach(id => {
        if (norm(wordMap.get(id).word.text).indexOf(q) !== -1) { S.selection.add(id); n++; }
      });
      toast(n ? `${n} coincidencia${n > 1 ? 's' : ''} seleccionada${n > 1 ? 's' : ''}` : 'Sin coincidencias', n ? 'ok' : 'warn');
      refreshSelectionUI();
    });
    $('#btnReplace').addEventListener('click', replaceAll);
    $('#replace').addEventListener('keydown', e => { if (e.key === 'Enter') replaceAll(); });

    $('#quick').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b) quickSelect(b.dataset.q);
    });

    $('#btnAddCue').addEventListener('click', addCue);
    $('#btnAddParallel').addEventListener('click', addParallel);
    $('#btnAutoKey').addEventListener('click', autoKeywords);
    $('#btnSplit').addEventListener('click', splitCue);
    $('#btnMerge').addEventListener('click', mergeCue);
    $('#btnShift').addEventListener('click', shiftAll);
    $('#btnRetime').addEventListener('click', retime);
    $('#btnBake').addEventListener('click', bakeChunks);
  }

  function replaceAll() {
    const q = $('#search').value.trim();
    const rep = $('#replace').value;
    if (!q) { toast('Escribe en el buscador lo que quieres reemplazar', 'warn'); return; }
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let n = 0;
    const touched = [];
    S.cues.forEach(cue => {
      const txt = cue.words.map(w => w.text).join(' ');
      const out = txt.replace(re, () => { n++; return rep; }).replace(/\s+/g, ' ').trim();
      if (out !== txt) touched.push([cue, out]);
    });
    if (!n) { toast('Sin coincidencias', 'warn'); return; }
    snapshot();
    touched.forEach(([cue, out]) => setCueText(cue, out));
    S.cues = S.cues.filter(c => c.words.length);
    onCuesReplaced();
    toast(`${n} reemplazo${n > 1 ? 's' : ''}`, 'ok');
  }

  function currentCue() {
    const id = wordOrder.find(i => S.selection.has(i));
    if (id) return wordMap.get(id).cue;
    return S.cues.find(c => S.time >= c.start && S.time < c.end) || null;
  }

  function addCue() {
    snapshot();
    const ref = currentCue();
    const start = ref ? ref.end + 0.05 : S.time;
    const cue = { id: newId('c'), start, end: start + 2, layer: S.editLayer, speaker: '', words: splitWords('Nuevo subtítulo') };
    S.cues.push(cue);
    onCuesReplaced();
    seek(start + 0.01);
    editCueText(cue);
  }

  function addParallel() {
    const ref = currentCue();
    if (!ref) { toast('Selecciona una palabra del subtítulo o coloca el cabezal sobre él', 'warn'); return; }
    if (S.layers.length < 2) addLayer(true);
    snapshot();
    const layer = ((ref.layer || 0) + 1) % S.layers.length;
    const cue = { id: newId('c'), start: ref.start, end: ref.end, layer, speaker: '', words: splitWords('Línea paralela') };
    S.cues.push(cue);
    onCuesReplaced();
    editCueText(cue);
    toast(`Línea paralela en la capa ${layer + 1} · ${S.layers[layer].name}`, 'ok');
  }

  /** Tiempo (en segundos) en que empieza a decirse una palabra, según los bloques actuales. */
  function wordStart(w) {
    for (const ch of chunks) for (const x of ch.words) if (x.ref === w) return x.ws;
    return typeof w.t0 === 'number' ? w.t0 : null;
  }

  function splitCue() {
    const id = wordOrder.find(i => S.selection.has(i));
    if (!id) { toast('Selecciona la palabra donde empieza el nuevo subtítulo', 'warn'); return; }
    const { word, cue } = wordMap.get(id);
    const idx = cue.words.indexOf(word);
    if (idx <= 0) { toast('Elige una palabra que no sea la primera del subtítulo', 'warn'); return; }
    const t = wordStart(word);
    snapshot();
    const cut = Math.max(cue.start + 0.05, Math.min(cue.end - 0.05, t == null ? (cue.start + cue.end) / 2 : t));
    const next = { id: newId('c'), start: cut, end: cue.end, layer: cue.layer || 0, speaker: cue.speaker || '', words: cue.words.slice(idx) };
    cue.words = cue.words.slice(0, idx);
    cue.end = cut;
    S.cues.push(next);
    onCuesReplaced();
    toast('Subtítulo dividido', 'ok', 1600);
  }

  function mergeCue() {
    const cue = currentCue();
    if (!cue) { toast('Selecciona una palabra del subtítulo que quieres unir', 'warn'); return; }
    const same = S.cues.filter(c => (c.layer || 0) === (cue.layer || 0));
    const next = same[same.indexOf(cue) + 1];
    if (!next) { toast('No hay un subtítulo siguiente en esta capa', 'warn'); return; }
    snapshot();
    cue.words = cue.words.concat(next.words);
    cue.end = Math.max(cue.end, next.end);
    S.cues = S.cues.filter(c => c !== next);
    onCuesReplaced();
    toast('Subtítulos unidos', 'ok', 1600);
  }

  function shiftAll() {
    const ms = +$('#tShift').value || 0;
    if (!ms || !S.cues.length) return;
    snapshot();
    const d = ms / 1000;
    S.cues.forEach(c => {
      c.start = Math.max(0, c.start + d);
      c.end = Math.max(c.start + 0.05, c.end + d);
      c.words.forEach(w => { if (typeof w.t0 === 'number') { w.t0 += d; w.t1 += d; } });
    });
    onCuesReplaced();
    toast(`Subtítulos desplazados ${ms > 0 ? '+' : ''}${ms} ms`, 'ok');
  }

  /** Duración mínima/máxima, separación y velocidad de lectura, por capa. */
  function retime() {
    if (!S.cues.length) return;
    const min = Math.max(0, +$('#tMin').value || 0), max = +$('#tMax').value || 0;
    const gap = Math.max(0, +$('#tGap').value || 0), cps = +$('#tCps').value || 0;
    snapshot();
    let changed = 0;
    S.layers.forEach((l, li) => {
      const list = S.cues.filter(c => (c.layer || 0) === li).sort((a, b) => a.start - b.start);
      list.forEach((c, i) => {
        const next = list[i + 1];
        const before = c.end;
        const chars = c.words.reduce((a, w) => a + w.text.length + 1, 0);
        let want = Math.max(c.end - c.start, min, cps ? chars / cps : 0);
        if (max) want = Math.min(want, max);
        let end = c.start + want;
        if (next) end = Math.min(end, next.start - gap);
        c.end = Math.max(c.start + 0.1, end);
        if (Math.abs(c.end - before) > 0.001) changed++;
      });
    });
    onCuesReplaced();
    toast(`${changed} subtítulo${changed === 1 ? '' : 's'} ajustado${changed === 1 ? '' : 's'}`, 'ok');
  }

  /** Convierte los bloques de cada capa en subtítulos independientes. */
  function bakeChunks() {
    if (!chunks.length) return;
    snapshot();
    const out = [];
    layerData.forEach((L, li) => L.chunks.forEach(ch => {
      const src = S.cues.find(c => c.id === ch.cueId);
      out.push({
        id: newId('c'), start: ch.start, end: ch.end, layer: li, speaker: src ? src.speaker : '',
        words: ch.words.map(x => Object.assign({}, x.ref, { t0: x.ws, t1: x.we, ovr: Object.assign({}, x.ref.ovr) }))
      });
    }));
    out.forEach(c => c.words.forEach(w => { delete w.ovr.cut; }));
    const before = S.cues.length;
    S.cues = out;
    onCuesReplaced();
    toast(`${before} subtítulos → ${out.length} (Ctrl+Z para deshacer)`, 'ok', 3500);
  }

  /** Palabra de mayor impacto: la más larga que no sea una palabra vacía (o con números). */
  function autoKeywords() {
    if (!S.cues.length) return;
    snapshot();
    S.cues.forEach(cue => {
      cue.words.forEach(w => { delete w.ovr.key; });
      let best = null, score = -1;
      cue.words.forEach(w => {
        const n = norm(w.text);
        if (!n || STOP.has(n)) return;
        const s = n.length + (/\d/.test(n) ? 6 : 0) + (/[!¡?¿]/.test(w.text) ? 2 : 0);
        if (s > score) { score = s; best = w; }
      });
      if (best) best.ovr.key = true;
    });
    onCuesReplaced();
    const st = style();
    toast(st.hlMode === 'keyword' ? 'Palabra clave marcada en cada subtítulo' : 'Palabras marcadas. Activa «Resaltar: palabra clave» en el estilo para verlas.', 'ok', 3600);
  }

  function quickSelect(q) {
    const sel = S.selection;
    const all = wordOrder;
    const text = id => wordMap.get(id).word.text;
    switch (q) {
      case 'all': all.forEach(id => sel.add(id)); break;
      case 'none': sel.clear(); break;
      case 'invert': all.forEach(id => (sel.has(id) ? sel.delete(id) : sel.add(id))); break;
      case 'same': {
        const keys = new Set(Array.from(sel).map(id => norm(text(id))));
        if (!keys.size) { toast('Selecciona primero una palabra', 'warn'); return; }
        all.forEach(id => { if (keys.has(norm(text(id)))) sel.add(id); });
        break;
      }
      case 'numbers': sel.clear(); all.forEach(id => { if (/\d/.test(text(id))) sel.add(id); }); break;
      case 'long': sel.clear(); all.forEach(id => { if (norm(text(id)).length >= 7) sel.add(id); }); break;
      case 'fx': sel.clear(); all.forEach(id => { const o = wordMap.get(id).word.ovr; if (o.fx || o.color) sel.add(id); }); break;
      case 'key': sel.clear(); all.forEach(id => { if (wordMap.get(id).word.ovr.key) sel.add(id); }); break;
      case 'low': sel.clear(); all.forEach(id => { if (wordMap.get(id).word.low) sel.add(id); }); if (!sel.size) toast('No hay palabras dudosas'); break;
      case 'em': sel.clear(); all.forEach(id => { if (wordMap.get(id).word.ovr.em) sel.add(id); }); break;
    }
    refreshSelectionUI();
  }

  // ───────────── Selección + inspector de efectos ─────────────
  function selectedWords() {
    return wordOrder.filter(id => S.selection.has(id)).map(id => wordMap.get(id).word);
  }

  function refreshSelectionUI() {
    chipEls.forEach((c, id) => c.classList.toggle('sel', S.selection.has(id)));
    const words = selectedWords();
    const n = words.length;
    const cnt = $('#selCount');
    const txtCount = n === 1 ? '1 seleccionada' : `${n} seleccionadas`;
    if (cnt.textContent !== txtCount) bump(cnt);
    cnt.textContent = txtCount;
    cnt.classList.toggle('on', n > 0);

    const banner = $('#fxSelInfo');
    banner.classList.toggle('on', n > 0);
    banner.innerHTML = '';
    if (n) {
      banner.appendChild(el('b', null, String(n)));
      const txt = el('div', 'words');
      txt.textContent = words.slice(0, 12).map(w => w.text).join(' · ') + (n > 12 ? ' …' : '');
      banner.appendChild(txt);
    } else {
      banner.textContent = 'Selecciona palabras en la lista de subtítulos para aplicarles un efecto.';
    }

    const counts = {};
    words.forEach(w => { if (w.ovr.fx) counts[w.ovr.fx] = (counts[w.ovr.fx] || 0) + 1; });
    $$('.fx-card').forEach(c => {
      const k = counts[c.dataset.fx] || 0;
      c.classList.toggle('on', n > 0 && k === n);
      c.classList.toggle('partial', k > 0 && k < n);
    });

    $('#wordProps').classList.toggle('disabled', n === 0);
    const o = n ? words[0].ovr : {};
    $('#ovKey').checked = n > 0 && words.every(w => w.ovr.key);
    $('#ovEm').checked = n > 0 && words.every(w => w.ovr.em);
    $('#ovBr').checked = n > 0 && words.every(w => w.ovr.br);
    $('#ovCut').checked = n > 0 && words.every(w => w.ovr.cut);
    paintSwatches('#swBox', o.boxColor || null, '#FAFF96');
    const bp = $('#ovBoxPad');
    bp.value = Math.round((o.boxPad != null ? o.boxPad : 0.16) * 100);
    updateRangeFill(bp);
    $('#ovBoxPadOut').textContent = o.boxPad != null ? bp.value + '%' : 'Auto';
    paintSwatches('#swText', o.color || null);
    const fx0 = FX.get(o.fx);
    paintSwatches('#swFx', o.fxColor || null, fx0 ? fx0.color : null);
    setRange('#ovScale', Math.round((o.scale || 1) * 100));
    setRange('#ovInt', Math.round((o.intensity == null ? 1 : o.intensity) * 100));
    setRange('#ovSpeed', Math.round((o.speed || 1) * 100));
  }

  function mutateSelection(fn, opts) {
    const words = selectedWords();
    if (!words.length) { toast('Primero selecciona palabras en la lista', 'warn'); return false; }
    if (!(opts && opts.noSnapshot)) snapshot();
    words.forEach(w => { fn(w.ovr, w); paintChip(w); });
    rebuild();
    renderTimelineCues();
    refreshSelectionUI();
    saveSession();
    markDirty();
    return true;
  }

  function setRange(sel, v) {
    const r = $(sel);
    r.value = v;
    updateRangeFill(r);
    const out = $(sel + 'Out');
    if (out) out.textContent = v + '%';
  }
  function updateRangeFill(r) {
    const p = (r.value - r.min) / (r.max - r.min) * 100;
    r.style.setProperty('--p', p + '%');
  }

  function buildSwatches(sel, onPick, autoLabel) {
    const box = $(sel);
    box.innerHTML = '';
    const auto = el('button', 'sw auto', autoLabel);
    auto.dataset.c = '';
    auto.title = 'Usar el color del estilo';
    box.appendChild(auto);
    SWATCHES.forEach(c => {
      const b = el('button', 'sw');
      b.style.setProperty('--c', c);
      b.dataset.c = c;
      b.title = c;
      box.appendChild(b);
    });
    const pick = el('label', 'sw pick');
    pick.title = 'Color personalizado';
    const inp = el('input');
    inp.type = 'color';
    pick.appendChild(inp);
    box.appendChild(pick);
    box.addEventListener('click', e => {
      const b = e.target.closest('button.sw');
      if (b) onPick(b.dataset.c || null);
    });
    let first = true;
    inp.addEventListener('input', () => { onPick(inp.value.toUpperCase(), !first); first = false; });
    inp.addEventListener('change', () => { first = true; });
  }
  function paintSwatches(sel, value, fallback) {
    $$(sel + ' .sw').forEach(b => {
      if (b.classList.contains('pick')) return;
      const c = b.dataset.c || null;
      b.classList.toggle('on', (c || null) === (value || null));
    });
    const pick = $(sel + ' .sw.pick');
    if (pick) {
      const custom = value && SWATCHES.indexOf(value) === -1;
      pick.classList.toggle('on', !!custom);
      pick.querySelector('input').value = /^#[0-9A-F]{6}$/i.test(value || fallback || '') ? (value || fallback) : '#FAFF96';
    }
  }

  function buildFxPanel() {
    const grid = $('#fxGrid');
    grid.innerHTML = '';
    FX.list.forEach(fx => {
      const card = el('button', 'fx-card');
      card.dataset.fx = fx.id;
      card.dataset.cat = fx.cat;
      card.title = fx.desc;
      const cv = el('canvas');
      cv.width = 184;
      cv.height = 115;
      card.appendChild(cv);
      const name = el('div', 'fx-name');
      name.appendChild(el('span', null, fx.name));
      name.appendChild(el('span', 'fx-cat', FX.cats[fx.cat]));
      card.appendChild(name);
      grid.appendChild(card);
    });
    grid.addEventListener('click', e => {
      const card = e.target.closest('.fx-card');
      if (!card) return;
      const fx = FX.get(card.dataset.fx);
      const ok = mutateSelection(o => { o.fx = fx.id; });
      if (ok) {
        toast(`Efecto «${fx.name}» aplicado`, 'ok', 1600);
        previewSelection();
      }
    });
    $('#fxCats').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      S.fxCat = b.dataset.cat;
      $$('#fxCats button').forEach(x => x.classList.toggle('active', x === b));
      $$('.fx-card').forEach(c => { c.hidden = !!S.fxCat && c.dataset.cat !== S.fxCat; });
    });

    buildSwatches('#swText', (c, live) => mutateSelection(o => { if (c) o.color = c; else delete o.color; }, { noSnapshot: live }), 'Estilo');
    buildSwatches('#swFx', (c, live) => mutateSelection(o => { if (c) o.fxColor = c; else delete o.fxColor; }, { noSnapshot: live }), 'Auto');

    const bindRange = (sel, key, def) => {
      const r = $(sel);
      let snapped = false;
      r.addEventListener('input', () => {
        updateRangeFill(r);
        $(sel + 'Out').textContent = r.value + '%';
        const v = r.value / 100;
        mutateSelection(o => { if (v === def) delete o[key]; else o[key] = v; }, { noSnapshot: snapped });
        snapped = true;
      });
      r.addEventListener('change', () => { snapped = false; });
    };
    bindRange('#ovScale', 'scale', 1);
    bindRange('#ovInt', 'intensity', 1);
    bindRange('#ovSpeed', 'speed', 1);

    $('#ovKey').addEventListener('change', e => {
      const on = e.target.checked;
      mutateSelection(o => { if (on) o.key = true; else delete o.key; });
    });
    buildSwatches('#swBox', (c, live) => mutateSelection(o => { if (c) o.boxColor = c; else delete o.boxColor; }, { noSnapshot: live }), 'Sin caja');
    {
      const bp = $('#ovBoxPad');
      let snapped = false;
      bp.addEventListener('input', () => {
        updateRangeFill(bp);
        $('#ovBoxPadOut').textContent = bp.value + '%';
        mutateSelection(o => { o.boxPad = bp.value / 100; }, { noSnapshot: snapped });
        snapped = true;
      });
      bp.addEventListener('change', () => { snapped = false; });
    }
    const flag = (id, key) => $(id).addEventListener('change', e => {
      const on = e.target.checked;
      if (mutateSelection(o => { if (on) o[key] = true; else delete o[key]; })) { rebuild(); markDirty(); }
    });
    flag('#ovBr', 'br');
    flag('#ovCut', 'cut');
    $('#ovEm').addEventListener('change', e => {
      const on = e.target.checked;
      if (mutateSelection(o => { if (on) o.em = true; else delete o.em; }) && (renderCueList(), refreshSelectionUI(), on) && style().emMode === 'none') {
        toast('Activa el modo de énfasis en Estilos → Énfasis para verlo', 'warn', 3500);
      }
    });
    $('#btnFxRemove').addEventListener('click', () => mutateSelection(o => { delete o.fx; delete o.fxColor; }));
    $('#btnWordReset').addEventListener('click', () => mutateSelection((o, w) => { w.ovr = {}; }));
    $('#btnPreviewSel').addEventListener('click', previewSelection);
  }

  // Miniaturas animadas del banco de efectos
  const miniStyle = ST.make({ font: 'Montserrat', weight: 900, size: 100, strokeWidth: 7, shadowOpacity: 0.5, shadowBlur: 0, shadowY: 5 });
  let lastMini = 0;
  function tickMiniPreviews(ts) {
    if (!$('#tab-fx').classList.contains('active') || ts - lastMini < 33) return;
    lastMini = ts;
    const now = ts / 1000;
    $$('.fx-card').forEach(card => {
      if (card.hidden) return;
      const fx = FX.get(card.dataset.fx);
      const cv = card.querySelector('canvas');
      const c = cv.getContext('2d');
      c.clearRect(0, 0, cv.width, cv.height);
      const u = Math.min(cv.width, cv.height) / R.REF * 3.2;
      const fs = 100 * u;
      c.font = R.fontStr(miniStyle, fs);
      const text = 'WOW';
      const width = R.measure(c, text, fs, 0);
      const T = FX.identity();
      const lt = fx.loop ? now : (now % 1.9) - 0.35;
      fx.apply(T, lt, 1, fx.color);
      R.drawWord(c, {
        text, x: cv.width / 2, y: cv.height / 2, fs, width,
        fill: '#FFFFFF', fill2: null, style: miniStyle, T, u, vis: 1
      });
    });
  }

  // ───────────── Style Engine: editor ─────────────
  const WEIGHTS = [[100, 'Thin 100'], [200, 'Extra light 200'], [300, 'Light 300'], [400, 'Regular 400'], [500, 'Medium 500'],
    [600, 'Semibold 600'], [700, 'Bold 700'], [800, 'Extra bold 800'], [900, 'Black 900']];
  const hasBg = s => s.bg !== 'none';
  const shadowFields = (p, label, show) => [
    { k: p + 'Opacity', label: label + ' · opacidad', type: 'range', min: 0, max: 1, step: 0.05, show },
    { k: p + 'Color', label: 'Color', type: 'color', show: s => (!show || show(s)) && s[p + 'Opacity'] > 0 },
    { k: p + 'Angle', label: 'Ángulo', type: 'range', min: 0, max: 360, step: 1, unit: '°', half: true, show: s => (!show || show(s)) && s[p + 'Opacity'] > 0 },
    { k: p + 'Dist', label: 'Distancia', type: 'range', min: 0, max: 150, step: 1, unit: 'px', half: true, show: s => (!show || show(s)) && s[p + 'Opacity'] > 0 },
    { k: p + 'Blur', label: 'Difuminado', type: 'range', min: 0, max: 80, step: 1, unit: 'px', show: s => (!show || show(s)) && s[p + 'Opacity'] > 0 }
  ];

  const EDITOR = [
    {
      title: 'Tipografía', open: true, sum: s => `${s.font} ${s.weight} / ${s.size}px`, fields: [
        { k: 'font', label: 'Familia', type: 'font' },
        { k: 'weight', label: 'Peso', type: 'select', half: true, options: WEIGHTS, num: true },
        { k: 'case', label: 'Casing', type: 'select', half: true, options: [['upper', 'MAYÚSCULAS'], ['lower', 'minúsculas'], ['title', 'Capitalizado'], ['none', 'Mixto (original)']] },
        { k: 'size', label: 'Tamaño', type: 'range', min: 20, max: 220, step: 1, unit: 'px' },
        { k: 'align', label: 'Alineación', type: 'select', options: [['center', 'Centrado'], ['left', 'Izquierda'], ['right', 'Derecha']] },
        { k: 'letterSpacing', label: 'Kerning / espaciado', type: 'range', min: -0.2, max: 0.3, step: 0.005 },
        { k: 'wordGap', label: 'Espacio entre palabras', type: 'range', min: 0.1, max: 1, step: 0.01 },
        { k: 'lineHeight', label: 'Line height', type: 'range', min: 0.8, max: 2, step: 0.05 },
        { k: 'italic', label: 'Cursiva', type: 'toggle' }
      ]
    },
    {
      title: 'Color, relleno y gradientes', sum: s => s.gradient ? `${s.color} → ${s.color2}` : s.color, fields: [
        { k: 'color', label: 'Color sólido', type: 'color' },
        { k: 'gradient', label: 'Gradiente de texto', type: 'toggle' },
        { k: 'gradType', label: 'Tipo', type: 'select', half: true, options: [['linear', 'Lineal'], ['radial', 'Radial']], show: s => s.gradient },
        { k: 'gradAngle', label: 'Ángulo', type: 'range', min: 0, max: 360, step: 1, unit: '°', half: true, show: s => s.gradient && s.gradType !== 'radial' },
        { k: 'color2', label: 'Color final', type: 'color', show: s => s.gradient },
        { k: 'opacity', label: 'Opacidad global', type: 'range', min: 0, max: 1, step: 0.01, unit: 'pct' }
      ]
    },
    {
      title: 'Palabra destacada / karaoke', open: true, sum: s => ({ current: 'Karaoke', spoken: 'Progresivo', keyword: 'Palabra clave', none: 'Off' })[s.hlMode], fields: [
        { k: 'hlMode', label: 'Resaltar', type: 'select', options: [['keyword', 'Palabra clave (Highlight word)'], ['current', 'La palabra que se dice'], ['spoken', 'Karaoke progresivo'], ['none', 'Nada']] },
        { k: 'hlColor', label: 'Color de resaltado', type: 'color', show: s => s.hlMode !== 'none' },
        { k: 'hlScale', label: 'Escala de la palabra', type: 'range', min: 1, max: 1.6, step: 0.01, show: s => s.hlMode !== 'none' },
        { k: 'hlBox', label: 'Caja detrás de la palabra', type: 'toggle', show: s => s.hlMode !== 'none' },
        { k: 'hlBoxColor', label: 'Color de la caja', type: 'color', show: s => s.hlMode !== 'none' && s.hlBox }
      ]
    },
    {
      title: 'Énfasis (cajas intercaladas)', open: true, sum: s => ({ alternate: 'Intercalado', dark: 'Fondo oscuro', light: 'Fondo claro', none: 'Off' })[s.emMode] + (s.emOnKey && s.emMode !== 'none' ? ' · clave' : ''), fields: [
        { k: 'emMode', label: 'Modo', type: 'select', options: [['alternate', 'Intercalado (negro/amarillo ↔ amarillo/negro)'], ['dark', 'Letra amarilla, fondo negro'], ['light', 'Fondo amarillo, letra negra'], ['none', 'Desactivado']] },
        { k: 'emColorA', label: 'Color A (amarillo)', type: 'color', half: true, show: s => s.emMode !== 'none' },
        { k: 'emColorB', label: 'Color B (negro)', type: 'color', half: true, show: s => s.emMode !== 'none' },
        { k: 'emOnKey', label: 'Aplicar a las palabras clave', type: 'toggle', show: s => s.emMode !== 'none' },
        { k: 'emScale', label: 'Escala', type: 'range', min: 1, max: 1.5, step: 0.01, half: true, show: s => s.emMode !== 'none' },
        { k: 'emRadius', label: 'Redondeo', type: 'range', min: 0, max: 40, step: 1, unit: 'px', half: true, show: s => s.emMode !== 'none' },
        { k: 'emPad', label: 'Margen de la caja', type: 'range', min: 0.04, max: 0.4, step: 0.01, show: s => s.emMode !== 'none' },
        { k: 'emPop', label: 'Rebote al decirla', type: 'toggle', show: s => s.emMode !== 'none' },
        { k: 'emPlain', label: 'Sin contorno ni sombra en el énfasis', type: 'toggle', show: s => s.emMode !== 'none' }
      ]
    },
    {
      title: 'Contorno (stroke múltiple)', sum: s => s.strokeWidth ? `${s.strokeWidth}px ${s.strokeAlign}` : 'Stroke 0', fields: [
        { k: 'strokeWidth', label: 'Capa 1 · grosor', type: 'range', min: 0, max: 30, step: 0.5, unit: 'px' },
        { k: 'strokeColor', label: 'Color', type: 'color', show: s => s.strokeWidth > 0 },
        { k: 'strokeAlign', label: 'Alineación', type: 'select', half: true, options: [['outside', 'Outside'], ['center', 'Centered'], ['inside', 'Inside']], show: s => s.strokeWidth > 0 },
        { k: 'strokeJoin', label: 'Unión', type: 'select', half: true, options: [['round', 'Round'], ['bevel', 'Bevel'], ['miter', 'Miter']], show: s => s.strokeWidth > 0 || s.stroke2Width > 0 },
        { k: 'stroke2Width', label: 'Capa 2 · grosor', type: 'range', min: 0, max: 30, step: 0.5, unit: 'px' },
        { k: 'stroke2Color', label: 'Color', type: 'color', show: s => s.stroke2Width > 0 },
        { k: 'stroke3Width', label: 'Capa 3 · grosor', type: 'range', min: 0, max: 30, step: 0.5, unit: 'px' },
        { k: 'stroke3Color', label: 'Color', type: 'color', show: s => s.stroke3Width > 0 }
      ]
    },
    {
      title: 'Sombra paralela y resplandor', sum: s => s.shadowOpacity ? `Sombra ${Math.round(s.shadowOpacity * 100)}% / Blur ${s.shadowBlur}px` : 'Sin sombra', fields: [
        ...shadowFields('shadow', 'Sombra 1'),
        ...shadowFields('shadow2', 'Sombra 2'),
        ...shadowFields('shadow3', 'Sombra 3', s => s.shadow2Opacity > 0 || s.shadow3Opacity > 0),
        { k: 'glow', label: 'Resplandor', type: 'range', min: 0, max: 80, step: 1, unit: 'px' },
        { k: 'glowColor', label: 'Color del resplandor', type: 'color', show: s => s.glow > 0 }
      ]
    },
    {
      title: 'Fondos, boxes y glass', sum: s => ({ none: 'Sin fondo', block: 'Frase', line: 'Por línea', word: 'Por palabra' })[s.bg] + (s.bgGlass && hasBg(s) ? ' · glass' : ''), fields: [
        { k: 'bg', label: 'Modo', type: 'select', options: [['none', 'Sin fondo'], ['block', 'Frase completa'], ['line', 'Por línea'], ['word', 'Caja por palabra']] },
        { k: 'bgColor', label: 'Color / tinte', type: 'color', show: hasBg },
        { k: 'bgOpacity', label: 'Opacidad', type: 'range', min: 0, max: 1, step: 0.05, show: hasBg },
        { k: 'bgPadX', label: 'Padding X', type: 'range', min: 0, max: 80, step: 1, unit: 'px', half: true, show: hasBg },
        { k: 'bgPadY', label: 'Padding Y', type: 'range', min: 0, max: 60, step: 1, unit: 'px', half: true, show: hasBg },
        { k: 'bgRadius', label: 'Radio (píldora ↔ cuadrado)', type: 'range', min: 0, max: 80, step: 1, unit: 'px', show: hasBg },
        { k: 'bgGlass', label: 'Efecto glassmorphism', type: 'toggle', show: hasBg },
        { k: 'glassBorder', label: 'Borde semitransparente', type: 'range', min: 0, max: 1, step: 0.05, half: true, show: s => hasBg(s) && s.bgGlass },
        { k: 'glassShine', label: 'Brillo frosted', type: 'range', min: 0, max: 0.6, step: 0.02, half: true, show: s => hasBg(s) && s.bgGlass }
      ]
    },
    {
      title: 'Diseño y márgenes de seguridad', sum: s => s.safeTop || s.safeBottom ? `Safe ${s.safeTop}/${s.safeBottom}px` : `Y ${s.posY}%`, fields: [
        { k: 'reveal', label: 'Aparición de palabras', type: 'select', options: [['all', 'Todas a la vez'], ['progressive', 'Progresiva (según se dicen)'], ['single', 'Una a una']] },
        { k: 'preAlpha', label: 'Opacidad de palabras aún no dichas', type: 'range', min: 0, max: 1, step: 0.05, show: s => s.reveal === 'all' },
        { k: 'maxWidth', label: 'Ancho máximo', type: 'range', min: 20, max: 100, step: 1, unit: '%' },
        { k: 'posY', label: 'Posición vertical', type: 'range', min: 5, max: 95, step: 1, unit: '%', half: true },
        { k: 'posX', label: 'Posición horizontal', type: 'range', min: 5, max: 95, step: 1, unit: '%', half: true },
        { k: 'safeTop', label: 'Margen superior', type: 'range', min: 0, max: 600, step: 5, unit: 'px', half: true },
        { k: 'safeBottom', label: 'Margen inferior', type: 'range', min: 0, max: 600, step: 5, unit: 'px', half: true },
        { k: 'safeSide', label: 'Margen lateral', type: 'range', min: 0, max: 200, step: 5, unit: 'px' }
      ]
    },
    {
      title: 'Segmentación y duración', open: true, sum: s => [s.maxWords ? s.maxWords + ' pal./bloque' : '', s.maxLines ? s.maxLines + ' líneas' : '', s.maxCharsLine ? s.maxCharsLine + ' car./línea' : ''].filter(Boolean).join(' · ') || 'Línea completa', fields: [
        { k: 'maxWords', label: 'Palabras por bloque (0 = sin límite)', type: 'range', min: 0, max: 16, step: 1 },
        { k: 'maxLines', label: 'Líneas por bloque (0 = sin límite)', type: 'range', min: 0, max: 4, step: 1 },
        { k: 'maxWordsLine', label: 'Palabras por línea', type: 'range', min: 0, max: 10, step: 1, half: true },
        { k: 'maxCharsLine', label: 'Caracteres por línea', type: 'range', min: 0, max: 60, step: 1, half: true },
        { k: 'maxChars', label: 'Caracteres por bloque (0 = sin límite)', type: 'range', min: 0, max: 120, step: 1 },
        { k: 'minChunk', label: 'Duración mínima del bloque', type: 'range', min: 0, max: 2, step: 0.05, unit: 's', half: true },
        { k: 'holdGap', label: 'Rellenar huecos de hasta', type: 'range', min: 0, max: 1.5, step: 0.05, unit: 's', half: true },
        { k: 'punct', label: 'Puntuación', type: 'select', options: [['keep', 'Mantener'], ['soft', 'Quitar comas y puntos'], ['all', 'Quitar toda']] }
      ]
    },
    {
      title: 'Animaciones y transiciones', sum: s => s.cueIn === 'none' ? 'Sin animación' : s.cueIn, fields: [
        { k: 'cueIn', label: 'Entrada del bloque', type: 'select', options: [['none', 'Ninguna'], ['pop', 'Pop / Scale in'], ['fade', 'Fade in'], ['bounce', 'Bounce'], ['typewriter', 'Typewriter'], ['glitch', 'Glitch sutil'], ['slide', 'Deslizar'], ['zoom', 'Zoom']] },
        { k: 'cueOut', label: 'Fundido de salida', type: 'toggle' },
        { k: 'wordFx', label: 'Efecto para todas las palabras', type: 'select', fxOptions: true }
      ]
    }
  ];

  function fmtVal(f, v) {
    if (f.unit === 'pct') return Math.round(v * 100) + '%';
    if (f.unit === '%') return Math.round(v) + '%';
    if (f.unit === '°') return Math.round(v) + '°';
    if (f.unit === 's') return Number(v).toFixed(2) + ' s';
    if (f.min === 0 && v === 0 && /(bloque|línea|sin límite)/.test(f.label)) return 'Libre';
    if (f.unit === 'px') return (Math.round(v * 10) / 10) + 'px';
    if (f.step < 1) return Number(v).toFixed(f.step < 0.01 ? 3 : 2);
    return String(v);
  }

  function buildStyleEditor() {
    const root = $('#styleEditor');
    root.innerHTML = '';
    const dl = el('datalist');
    dl.id = 'fontList';
    ST.FONTS.forEach(f => { const o = el('option'); o.value = f; dl.appendChild(o); });
    root.appendChild(dl);

    let openState = {};
    try { openState = JSON.parse(localStorage.getItem('subfx.sections') || '{}'); } catch (e) { /* ignorado */ }
    EDITOR.forEach((sec, si) => {
      const d = el('details', 'sec');
      d.open = openState[si] != null ? openState[si] : !!sec.open;
      d.addEventListener('toggle', () => {
        openState[si] = d.open;
        try { localStorage.setItem('subfx.sections', JSON.stringify(openState)); } catch (e) { /* ignorado */ }
      });
      const sum = el('summary');
      sum.appendChild(document.createTextNode(sec.title));
      const sv = el('span', 'sum-val');
      sv.dataset.sec = si;
      sum.appendChild(sv);
      d.appendChild(sum);
      const body = el('div', 'sec-body');
      let pair = null;
      sec.fields.forEach(f => {
        const field = buildField(f);
        if (f.half) {
          if (!pair) { pair = el('div', 'two'); body.appendChild(pair); }
          pair.appendChild(field);
          if (pair.children.length === 2) pair = null;
        } else {
          pair = null;
          body.appendChild(field);
        }
      });
      d.appendChild(body);
      root.appendChild(d);
    });
    smoothDetails(root);
    if (DD) enhanceSelects(root);
    syncStyleEditor();
  }

  function buildField(f) {
    const wrap = el('div', 'field' + (f.type === 'range' ? ' range' : '') + (f.type === 'toggle' ? ' inline' : ''));
    wrap.dataset.k = f.k;
    const lab = el('label', null, f.label);
    wrap.appendChild(lab);
    let input;
    const set = (v, live) => setStyleValue(f, v, live);

    if (f.type === 'range') {
      // Valor editable a mano (se admite «12px», «45°», «80 %») y etiqueta arrastrable
      const num = el('input', 'num');
      num.type = 'text';
      num.setAttribute('aria-label', f.label);
      lab.appendChild(num);
      input = el('input');
      input.type = 'range';
      input.min = f.min; input.max = f.max; input.step = f.step;
      input.setAttribute('aria-label', f.label);
      input.addEventListener('input', () => { num.value = fmtVal(f, +input.value); updateRangeFill(input); set(+input.value, true); });
      num.addEventListener('keydown', e => { if (e.key === 'Enter') num.blur(); if (e.key === 'Escape') { num.value = fmtVal(f, +input.value); num.blur(); } e.stopPropagation(); });
      num.addEventListener('change', () => {
        let v = parseFloat(String(num.value).replace(',', '.'));
        if (f.unit === 'pct' && isFinite(v)) v /= 100;
        if (!isFinite(v)) { num.value = fmtVal(f, +input.value); return; }
        v = Math.max(+f.min, Math.min(+f.max, v));
        input.value = v;
        input.dispatchEvent(new Event('input'));
      });
      scrubLabel(lab, input, num);
      wrap.appendChild(input);
    } else if (f.type === 'select') {
      input = el('select');
      const opts = f.fxOptions
        ? [['', 'Ninguno']].concat(FX.list.map(x => [x.id, `${x.name} · ${FX.cats[x.cat]}`]))
        : f.options;
      opts.forEach(([v, t]) => { const o = el('option', null, t); o.value = v; input.appendChild(o); });
      input.addEventListener('change', () => set(f.num ? +input.value : input.value));
      wrap.appendChild(input);
    } else if (f.type === 'toggle') {
      const tg = el('label', 'toggle');
      input = el('input');
      input.type = 'checkbox';
      tg.appendChild(input);
      tg.appendChild(el('span'));
      input.addEventListener('change', () => set(input.checked));
      wrap.appendChild(tg);
    } else if (f.type === 'color') {
      const row = el('div', 'color-field');
      const prev = el('label', 'cprev');
      const picker = el('input');
      picker.type = 'color';
      prev.appendChild(picker);
      const txt = el('input');
      txt.type = 'text';
      txt.maxLength = 7;
      row.appendChild(prev);
      row.appendChild(txt);
      picker.addEventListener('input', () => { txt.value = picker.value.toUpperCase(); prev.style.background = picker.value; set(picker.value.toUpperCase(), true); });
      txt.addEventListener('change', () => {
        let v = txt.value.trim();
        if (!v.startsWith('#')) v = '#' + v;
        if (/^#[0-9a-f]{6}$/i.test(v)) set(v.toUpperCase());
        else syncStyleEditor();
      });
      wrap.appendChild(row);
      input = txt;
    } else if (f.type === 'font') {
      input = el('input');
      input.type = 'text';
      input.setAttribute('list', 'fontList');
      input.placeholder = 'Sistema o Google Fonts';
      input.addEventListener('change', () => { if (input.value.trim()) set(input.value.trim()); });
      wrap.appendChild(input);
    }
    return wrap;
  }

  let styleSnapTimer = null;
  function setStyleValue(f, v, live) {
    const st = style();
    st[f.k] = v;
    rebuild();
    if (f.k === 'font' || f.k === 'weight' || f.k === 'italic') loadFont(st);
    saveStyles();
    markDirty();
    syncVisibility();
    clearTimeout(styleSnapTimer);
    styleSnapTimer = setTimeout(() => renderStyleThumb(st.id), live ? 120 : 0);
  }

  function syncStyleEditor() {
    const st = style();
    EDITOR.forEach(sec => sec.fields.forEach(f => {
      const wrap = $(`#styleEditor .field[data-k="${f.k}"]`);
      if (!wrap) return;
      const v = st[f.k];
      if (f.type === 'range') {
        const inp = wrap.querySelector('input[type=range]');
        inp.value = v;
        updateRangeFill(inp);
        const num = wrap.querySelector('.num');
        if (document.activeElement !== num) num.value = fmtVal(f, v);
      } else if (f.type === 'toggle') {
        wrap.querySelector('input').checked = !!v;
      } else if (f.type === 'color') {
        wrap.querySelector('input[type=text]').value = v;
        wrap.querySelector('input[type=color]').value = v;
        wrap.querySelector('.cprev').style.background = v;
      } else {
        const inp = wrap.querySelector('select, input');
        inp.value = v == null ? '' : String(v);
      }
    }));
    syncVisibility();
  }

  function syncVisibility() {
    const st = style();
    EDITOR.forEach((sec, si) => {
      sec.fields.forEach(f => {
        if (!f.show) return;
        const wrap = $(`#styleEditor .field[data-k="${f.k}"]`);
        if (wrap) wrap.hidden = !f.show(st);
      });
      const sv = $(`#styleEditor .sum-val[data-sec="${si}"]`);
      if (sv && sec.sum) sv.textContent = sec.sum(st);
    });
  }

  const thumbChunk = (() => {
    const mk = (text, ws, we, key) => ({ ref: { id: 'x' + text, text, ovr: key ? { key: true } : {} }, ws, we });
    const words = [mk('Cuidado', 0, 0.3), mk('con', 0.3, 0.5), mk('tu', 0.5, 0.7), mk('mejor', 0.7, 2, true), mk('empleado', 2, 3)];
    return { id: 'thumb', cueId: 'thumb', start: 0, end: 3, words };
  })();

  function renderStyleThumb(id) {
    const card = $(`.style-card[data-id="${id}"]`);
    if (!card || !styles[id]) return;
    const cv = card.querySelector('canvas');
    const c = cv.getContext('2d');
    c.clearRect(0, 0, cv.width, cv.height);
    const src = styles[id];
    const st = Object.assign({}, src, {
      size: src.size * 1.5, posY: 50, posX: src.align === 'left' ? 6 : 50, maxWidth: 94, maxWords: 0,
      safeTop: 0, safeBottom: 0, safeSide: 0, reveal: src.reveal === 'single' ? 'single' : 'all', preAlpha: 1, cueIn: 'none'
    });
    R.renderChunk(c, cv.width, cv.height, thumbChunk, 1.4, st);
  }

  function buildStyleCats() {
    const sel = $('#styleCats');
    sel.innerHTML = '';
    const count = cat => Object.values(styles).filter(st => (cat === 'mine' ? st.custom : (st.cat || 'viral') === cat)).length;
    [['', `Todos los presets (${Object.keys(styles).length})`]].concat(Object.entries(ST.CATS).map(([id, name]) => [id, `${name} (${count(id)})`]))
      .concat([['mine', `Míos (${count('mine')})`]]).forEach(([id, name]) => {
        const o = el('option', null, name);
        o.value = id;
        sel.appendChild(o);
      });
    sel.value = S.styleCat || '';
    if (!sel.dataset.bound) {
      sel.dataset.bound = '1';
      sel.addEventListener('change', () => { S.styleCat = sel.value; filterStyles(); });
    }
  }
  function filterStyles() {
    $$('.style-card').forEach(c => {
      const st = styles[c.dataset.id];
      const cat = S.styleCat;
      c.hidden = !!cat && (cat === 'mine' ? !st.custom : (st.cat || 'viral') !== cat);
    });
  }

  function buildStyleGallery() {
    const g = $('#styleGallery');
    g.innerHTML = '';
    $('#presetSum').textContent = style().name;
    if ($('#styleCats').options.length) buildStyleCats();
    Object.values(styles).forEach((st, gi) => {
      const card = el('button', 'style-card' + (st.id === style().id ? ' on' : ''));
      card.style.setProperty('--i', Math.min(gi, 16));
      card.dataset.id = st.id;
      const cv = el('canvas');
      cv.width = 480;
      cv.height = 270;
      card.appendChild(cv);
      const name = el('div', 'st-name');
      name.appendChild(el('span', null, st.name));
      name.appendChild(el('span', 'st-badge', st.custom ? 'Mío' : (ST.CATS[st.cat] || 'Viral')));
      card.appendChild(name);
      g.appendChild(card);
      renderStyleThumb(st.id);
    });
    filterStyles();
  }

  function selectStyle(id) {
    if (!styles[id]) return;
    S.layers[S.editLayer].styleId = id;
    $('#presetSum').textContent = styles[id].name;
    $$('.style-card').forEach(c => c.classList.toggle('on', c.dataset.id === id));
    loadFont(style());
    rebuild();
    syncStyleEditor();
    renderLayerBar();
    saveSession();
    markDirty();
  }

  // ───────────── Capas (líneas paralelas) ─────────────
  function renderLayerBar() {
    const bar = $('#layerBar');
    bar.innerHTML = '';
    bar.appendChild(el('span', 'layers-label', 'Capa'));
    S.layers.forEach((l, i) => {
      const b = el('button', 'layer-tab l' + i + (i === S.editLayer ? ' on' : ''));
      b.dataset.layer = i;
      b.appendChild(el('b', null, String(i + 1)));
      b.appendChild(el('span', null, l.name));
      b.appendChild(el('small', null, (styles[l.styleId] || {}).name || ''));
      b.title = 'Doble clic para renombrar';
      bar.appendChild(b);
    });
    if (S.layers.length < MAX_LAYERS) {
      const add = el('button', 'layer-add', '+');
      add.title = 'Añadir capa paralela';
      add.dataset.act = 'add';
      bar.appendChild(add);
    }
    if (S.layers.length > 1) {
      const rm = el('button', 'layer-add', '−');
      rm.title = 'Quitar la capa seleccionada (sus subtítulos pasan a la capa 1)';
      rm.dataset.act = 'remove';
      bar.appendChild(rm);
    }
  }

  function addLayer(silent) {
    if (S.layers.length >= MAX_LAYERS) return;
    S.layers.push({ name: 'Speaker ' + (S.layers.length + 1), styleId: S.layers.length === 1 ? 'x30-speaker2' : style().id });
    if (!silent) S.editLayer = S.layers.length - 1;
    rebuild();
    renderLayerBar();
    renderTimelineCues();
    saveSession();
  }

  function bindLayers() {
    const bar = $('#layerBar');
    bar.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'add') { addLayer(); selectStyle(style().id); return; }
      if (b.dataset.act === 'remove') {
        if (S.editLayer === 0) { toast('La capa 1 no se puede quitar', 'warn'); return; }
        snapshot();
        const rmIdx = S.editLayer;
        S.cues.forEach(c => { if ((c.layer || 0) === rmIdx) c.layer = 0; else if ((c.layer || 0) > rmIdx) c.layer--; });
        S.layers.splice(rmIdx, 1);
        S.editLayer = 0;
        onCuesReplaced();
        renderLayerBar();
        selectStyle(style().id);
        return;
      }
      S.editLayer = +b.dataset.layer;
      renderLayerBar();
      buildStyleGallery();
      syncStyleEditor();
      markDirty();
      saveSession();
    });
    bar.addEventListener('dblclick', e => {
      const b = e.target.closest('.layer-tab');
      if (!b) return;
      const l = S.layers[+b.dataset.layer];
      const name = window.prompt('Nombre de la capa:', l.name);
      if (name && name.trim()) { l.name = name.trim(); renderLayerBar(); saveSession(); }
    });
  }

  function bindStyles() {
    $('#styleGallery').addEventListener('click', e => {
      const card = e.target.closest('.style-card');
      if (card) selectStyle(card.dataset.id);
    });
    $('#styleActions').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const st = style();
      switch (b.dataset.act) {
        case 'dup': {
          const id = 'u' + Date.now().toString(36);
          styles[id] = Object.assign({}, st, { id, name: st.name + ' (mío)', custom: true });
          saveStyles();
          buildStyleGallery();
          selectStyle(id);
          toast('Preset guardado. Modifícalo a tu gusto', 'ok');
          break;
        }
        case 'assign': {
          const cues = new Set(selectedWords().map(w => wordMap.get(w.id).cue));
          if (!cues.size) { toast('Selecciona palabras de los subtítulos a los que quieres aplicar este estilo', 'warn'); return; }
          snapshot();
          cues.forEach(c => { c.layer = S.editLayer; });
          onCuesReplaced();
          toast(`${cues.size} subtítulo${cues.size > 1 ? 's' : ''} en la capa ${S.editLayer + 1} (${st.name})`, 'ok');
          break;
        }
        case 'rename': {
          const name = window.prompt('Nuevo nombre del preset:', st.name);
          if (name && name.trim()) { st.name = name.trim(); saveStyles(); buildStyleGallery(); renderLayerBar(); }
          break;
        }
        case 'reset': {
          const preset = ST.PRESETS.find(p => p.id === st.id);
          if (!preset) { toast('Solo los presets incluidos se pueden restablecer', 'warn'); return; }
          styles[st.id] = ST.make(preset);
          saveStyles();
          buildStyleGallery();
          selectStyle(st.id);
          toast('Preset restablecido', 'ok');
          break;
        }
        case 'delete': {
          if (!st.custom) { toast('Los presets incluidos no se pueden eliminar (puedes restablecerlos)', 'warn'); return; }
          if (!window.confirm(`¿Eliminar el preset «${st.name}»?`)) return;
          delete styles[st.id];
          saveStyles();
          S.layers.forEach(l => { if (!styles[l.styleId]) l.styleId = ST.DEFAULT_ID; });
          buildStyleGallery();
          selectStyle(style().id);
          break;
        }
        case 'export':
          saveText(`preset-${st.name.replace(/[^\w-]+/g, '_')}.json`, JSON.stringify(st, null, 2), 'application/json');
          break;
        case 'import': $('#styleFile').click(); break;
      }
    });
    $('#styleFile').addEventListener('change', async e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        const list = Array.isArray(data) ? data : [data];
        let last = null;
        list.forEach(d => {
          const id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
          styles[id] = ST.make(Object.assign({}, d, { id, custom: true, name: d.name || 'Importado' }));
          last = id;
        });
        saveStyles();
        buildStyleGallery();
        if (last) selectStyle(last);
        toast('Preset importado', 'ok');
      } catch (err) {
        toast('El archivo no es un preset válido', 'err');
      }
    });
  }

  function download(blob, name) {
    const a = el('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /** Guarda texto: diálogo nativo en Premiere, descarga en el navegador. */
  function saveText(name, text, mime) {
    const cepFs = window.cep && window.cep.fs;
    if (CEP.available && cepFs && cepFs.showSaveDialogEx) {
      const ext = name.split('.').pop();
      const r = cepFs.showSaveDialogEx('Guardar', CEP.systemPath('myDocuments'), [ext], name);
      if (!r || !r.data) return;
      const path = String(r.data).replace(/\\/g, '/');
      const w = cepFs.writeFile(path, text);
      if (w && w.err) toast('No se pudo guardar el archivo', 'err');
      else toast('Guardado: ' + path.split('/').pop(), 'ok');
      return;
    }
    download(new Blob([text], { type: mime || 'text/plain' }), name);
  }

  function loadFont(st) {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    const spec = `${st.italic ? 'italic ' : ''}${st.weight} 40px "${st.font}"`;
    return document.fonts.load(spec).then(() => { markDirty(); }).catch(() => {});
  }

  // ───────────── Importar / exportar subtítulos ─────────────
  function loadSrtText(text, name) {
    const { cues, speakers } = cuesFromText(text);
    if (!cues.length) { toast('No se encontraron subtítulos en el archivo', 'err'); return; }
    snapshot();
    S.cues = cues;
    // Un hablante por capa
    while (S.layers.length < Math.min(MAX_LAYERS, speakers.length)) addLayer(true);
    speakers.slice(0, MAX_LAYERS).forEach((sp, i) => { S.layers[i].name = sp; });
    S.selection.clear();
    S.time = 0;
    renderLayerBar();
    onCuesReplaced();
    const list = $('#cueList');
    list.classList.remove('enter');
    void list.offsetWidth;
    list.classList.add('enter');
    setTimeout(() => list.classList.remove('enter'), 1200);
    const words = cues.reduce((a, c) => a + c.words.length, 0);
    toast(`${name ? name + ': ' : ''}${cues.length} subtítulos · ${words} palabras${speakers.length > 1 ? ` · ${speakers.length} hablantes` : ''}`, 'ok');
  }

  function exportSubs(fmt) {
    if (!S.cues.length) { toast('No hay subtítulos que exportar', 'warn'); return; }
    const plain = S.cues.map(c => ({
      start: c.start, end: c.end, layer: c.layer || 0,
      speaker: S.layers.length > 1 && c.speaker ? c.speaker : '',
      text: c.words.map(w => w.text).join(' ')
    }));
    if (fmt === 'srt') saveText('subtitulos.srt', SRT.toSRT(plain.map(c => Object.assign({}, c, { speaker: '' }))), 'text/plain');
    else {
      const { W, H } = frameSize();
      saveText('subtitulos.ass', SRT.toASS(plain, S.layers.map((l, i) => ({ name: l.name, style: layerStyle(i) })), W, H), 'text/plain');
    }
  }

  function bindLoading() {
    $('#btnLoad').addEventListener('click', () => $('#fileSrt').click());
    $('#fileSrt').addEventListener('change', async e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) loadSrtText(await f.text(), f.name);
    });
    let depth = 0;
    window.addEventListener('dragenter', e => { e.preventDefault(); depth++; document.body.classList.add('dragging'); });
    window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; document.body.classList.remove('dragging'); } });
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', async e => {
      e.preventDefault();
      depth = 0;
      document.body.classList.remove('dragging');
      const f = e.dataTransfer.files[0];
      if (f) loadSrtText(await f.text(), f.name);
    });
    const menu = $('#subExportMenu');
    menu.addEventListener('click', e => {
      const b = e.target.closest('button[data-fmt]');
      if (b) exportSubs(b.dataset.fmt);
    });
  }

  // ───────────── Proyecto nuevo ─────────────
  const DEFAULT_SETTINGS = JSON.stringify(S.settings);

  function openNewProject() {
    setPlaying(false);
    $('#newModal').hidden = false;
    $('#newConfirm').focus();
  }
  function closeNewProject() { $('#newModal').hidden = true; }

  function resetProject() {
    const opts = {
      exportSettings: $('#rsExport').checked,
      style: $('#rsStyle').checked,
      presets: $('#rsPresets').checked,
      custom: $('#rsCustom').checked
    };
    closeNewProject();

    if (S.cues.length) snapshot();
    S.cues = [];
    S.selection.clear();
    S.anchor = null;
    S.time = 0;
    S.silences = [];
    $('#search').value = '';

    if (opts.exportSettings) {
      const keep = { bg: S.settings.bg, safe: S.settings.safe, sil: S.settings.sil, zoom: S.settings.zoom, tr: S.settings.tr };
      S.settings = Object.assign(JSON.parse(DEFAULT_SETTINGS), keep);
      syncExportUI();
    }
    if (opts.presets) ST.PRESETS.forEach(p => { styles[p.id] = ST.make(p); });
    if (opts.custom) Object.keys(styles).forEach(id => { if (styles[id].custom) delete styles[id]; });
    if (opts.style) { S.layers = DEFAULT_LAYERS(); S.editLayer = 0; }
    S.layers.forEach(l => { if (!styles[l.styleId]) l.styleId = ST.DEFAULT_ID; });
    if (opts.presets || opts.custom) saveStyles();

    renderLayerBar();
    buildStyleGallery();
    selectStyle(style().id);
    onCuesReplaced();
    fitStage();
    toast('Proyecto nuevo listo. Importa tu .srt para empezar.', 'ok', 3200);
  }

  function clearAllEffects() {
    const touched = S.cues.some(c => c.words.some(w => w.ovr && Object.keys(w.ovr).length));
    if (!touched) { toast('No hay efectos que quitar'); return; }
    snapshot();
    S.cues.forEach(c => c.words.forEach(w => { w.ovr = {}; }));
    onCuesReplaced();
    toast('Efectos quitados de todas las palabras (Ctrl+Z para deshacer)', 'ok');
  }

  function bindProject() {
    $('#btnNew').addEventListener('click', openNewProject);
    $('#newCancel').addEventListener('click', closeNewProject);
    $('#newConfirm').addEventListener('click', resetProject);
    $('#newModal').addEventListener('click', e => { if (e.target.id === 'newModal') closeNewProject(); });
    $('#newModal').addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeNewProject(); } });
    $('#btnClearFx').addEventListener('click', clearAllEffects);
    $('#btnEmptyLoad').addEventListener('click', () => $('#fileSrt').click());
    $('#btnSample').addEventListener('click', () => loadSrtText(SRT.SAMPLE, 'Ejemplo'));
  }

  // ───────────── Transcripción con Whisper ─────────────
  function trCfg() {
    const t = S.settings.tr;
    const prov = TR.PROVIDERS[t.provider] || TR.PROVIDERS.openai;
    return {
      provider: t.provider, url: t.provider === 'custom' ? t.url : prov.url, key: t.key,
      model: t.provider === 'custom' ? (t.model || 'whisper-1') : prov.model,
      language: t.language, prompt: t.prompt, binary: t.binary, modelPath: t.modelPath
    };
  }

  function trSync() {
    const t = S.settings.tr, m = $('#trModal');
    m.dataset.engine = t.engine;
    m.dataset.provider = t.provider;
    ['Engine', 'Lang', 'Provider', 'Key', 'Url', 'Model', 'Binary', 'ModelPath', 'Range', 'Prompt'].forEach(k => {
      const e = $('#tr' + k), key = k === 'Lang' ? 'language' : k.charAt(0).toLowerCase() + k.slice(1);
      if (e && document.activeElement !== e) e.value = t[key] == null ? '' : t[key];
    });
    $('#trSnap').checked = t.snap !== false;
    $('#trDrop').checked = t.drop !== false;
  }

  function openTranscribe() {
    const sel = $('#trTrack');
    sel.innerHTML = '';
    const at = S.seq && S.seq.audioTracks ? S.seq.audioTracks : [{ index: 0, name: 'A1' }, { index: 1, name: 'A2' }];
    at.forEach(t => { const o = el('option', null, `A${t.index + 1}${t.clips != null ? ` (${t.clips} clips)` : ''}`); o.value = t.index; sel.appendChild(o); });
    sel.value = String(S.settings.tr.track);
    if (sel.selectedIndex < 0) sel.selectedIndex = 0;
    const md = $('#trModelDl');
    if (!md.options.length) TR.MODELS.forEach(m => { const o = el('option', null, m.label); o.value = m.id; md.appendChild(o); });
    md.value = S.settings.tr.dlModel || 'large-v3-turbo';
    trSync();
    $('#trModal').hidden = false;
    refreshSeq(true).then(s => { if (s && s.audioTracks && sel.options.length !== s.audioTracks.length) openTranscribe(); });
  }

  function trProgress(p, msg) {
    $('#trProgress').hidden = false;
    if (p != null) $('#trBar').style.width = (Math.max(0, Math.min(1, p)) * 100).toFixed(1) + '%';
    if (msg) $('#trStatus').textContent = msg;
  }

  let transcribing = false;
  async function runTranscription(file) {
    if (transcribing) return;
    const t = S.settings.tr, cfg = trCfg();
    if (t.engine === 'api' && !cfg.key) { toast('Escribe la clave de API del proveedor', 'warn'); $('#trKey').focus(); return; }
    if (t.engine === 'api' && !cfg.url) { toast('Escribe la URL base del proveedor', 'warn'); return; }
    if (!file && !CEP.available) { toast('Fuera de Premiere, usa «Usar un archivo…»', 'warn'); return; }
    transcribing = true;
    $('#trRun').disabled = true;
    const t0 = performance.now();
    try {
      // 1. Audio en tiempo de secuencia (16 kHz mono)
      let mix;
      if (file) {
        trProgress(0.02, 'Decodificando ' + file.name + '…');
        const a = await AU.decodeArrayBuffer(await file.arrayBuffer());
        mix = { samples: TR.resample(a.samples, a.sampleRate, TR.SR), sampleRate: TR.SR, from: 0 };
      } else {
        trProgress(0.02, 'Leyendo la pista A' + (t.track + 1) + '…');
        const info = await CEP.call('getAudioClips', String(t.track));
        if (!info || !info.ok) throw new Error((info && info.error) || 'Premiere no respondió');
        const clips = info.clips.filter(c => c.path);
        if (!clips.length) throw new Error('La pista A' + (t.track + 1) + ' no tiene clips con audio');
        let from = null, to = null;
        if (t.range === 'inout') {
          const io = await CEP.call('getInOut');
          if (io && io.ok && io.outPoint > io.inPoint) { from = io.inPoint; to = io.outPoint; }
          else toast('No hay marcas de entrada/salida: se transcribe toda la pista', 'warn');
        }
        const decoded = {};
        const paths = Array.from(new Set(clips.map(c => c.path)));
        for (let i = 0; i < paths.length; i++) {
          trProgress(0.03 + 0.1 * i / paths.length, `Decodificando audio ${i + 1}/${paths.length}…`);
          decoded[paths[i]] = await decodeMedia(paths[i]);
        }
        mix = TR.mixTimeline(clips, decoded, from, to);
      }
      const dur = mix.samples.length / TR.SR;

      // 2. Voz real (para anclar palabras y descartar alucinaciones)
      trProgress(0.14, 'Detectando la voz…');
      const sil = AU.detect(mix.samples, TR.SR, { threshold: S.settings.sil.threshold, minDur: 0.2, padIn: 0.03, padOut: 0.05 });
      const speech = AU.speech(sil, 0, dur).map(r => ({ start: r.start + mix.from, end: r.end + mix.from }));
      if (!speech.length) throw new Error('No se detectó voz. Revisa la pista o baja el umbral de silencio en Herramientas.');

      // 3. Whisper
      let cues = [], dropped = [];
      if (t.engine === 'local') {
        trProgress(0.16, 'whisper.cpp está transcribiendo…');
        const r = await TR.transcribeLocal(TR.encodeWav(mix.samples, TR.SR), cfg, mix.from, p => trProgress(0.16 + 0.8 * p, `whisper.cpp: ${Math.round(p * 100)} %`));
        cues = r.cues; dropped = r.dropped;
      } else {
        const ranges = TR.chunkRanges(dur, 600, sil);
        let context = '';
        for (let i = 0; i < ranges.length; i++) {
          const rg = ranges[i];
          trProgress(0.16 + 0.8 * i / ranges.length, `Transcribiendo ${i + 1}/${ranges.length} (${Math.round(rg.end - rg.start)} s)…`);
          const slice = mix.samples.subarray(Math.floor(rg.start * TR.SR), Math.floor(rg.end * TR.SR));
          const prompt = [t.prompt, context].filter(Boolean).join(' ');
          const r = await TR.transcribeAPI(TR.encodeWav(slice, TR.SR), Object.assign({}, cfg, { prompt }), mix.from + rg.start);
          cues = cues.concat(r.cues);
          dropped = dropped.concat(r.dropped);
          context = r.cues.slice(-2).map(c => c.text).join(' ');
        }
      }
      if (!cues.length) throw new Error('Whisper no devolvió texto');

      // 4. Refinado contra la voz
      trProgress(0.97, 'Revisando contra la voz real…');
      const ref = TR.refine(cues, speech, { snap: t.snap !== false, dropSilent: t.drop !== false });

      // 5. Cargar: los tiempos ya están en segundos de secuencia → sin desfase
      snapshot();
      S.cues = ref.cues.map(c => ({
        id: newId('c'), start: c.start, end: c.end, layer: 0, speaker: '',
        words: c.words
          ? c.words.map(w => Object.assign({ id: newId('w'), text: w.text, ovr: {}, t0: w.t0, t1: w.t1 }, w.low ? { low: true } : {}))
          : splitWords(c.text)
      }));
      S.selection.clear();
      S.settings.startMode = 'zero';
      S.settings.offset = 0;
      syncExportUI();
      onCuesReplaced();
      seek(S.cues[0].start + 0.01);
      const nWords = S.cues.reduce((a, c) => a + c.words.length, 0);
      const secs = ((performance.now() - t0) / 1000).toFixed(0);
      const gone = dropped.concat(ref.removed).filter(Boolean);
      trProgress(1, `Listo en ${secs} s: ${S.cues.length} subtítulos · ${nWords} palabras · ${ref.low} dudosas · ${ref.snapped} ancladas a la voz`);
      $('#trNote').textContent = gone.length ? `Quitado por caer en silencio: «${gone.slice(0, 4).join('», «')}»${gone.length > 4 ? '…' : ''}` : 'No se encontró texto inventado en silencios.';
      toast(`✓ ${S.cues.length} subtítulos transcritos${ref.low ? ` · ${ref.low} palabras para revisar (filtro «Dudosas»)` : ''}`, 'ok', 5000);
      confetti();
    } catch (err) {
      trProgress(null, 'Error: ' + err.message);
      toast('Transcripción: ' + err.message, 'err', 7000);
    } finally {
      transcribing = false;
      $('#trRun').disabled = false;
    }
  }

  async function downloadWhisperModel() {
    if (!CEP.available) { toast('La descarga funciona dentro de Premiere', 'warn'); return; }
    const id = $('#trModelDl').value;
    const dest = `${CEP.systemPath('userData')}/SubtitleEngine/models/ggml-${id}.bin`;
    const btn = $('#btnTrDownload');
    btn.disabled = true;
    try {
      await TR.downloadModel(id, dest, p => trProgress(p, `Descargando ggml-${id}.bin: ${Math.round(p * 100)} %`));
      S.settings.tr.modelPath = dest;
      S.settings.tr.dlModel = id;
      saveSession();
      trSync();
      trProgress(1, 'Modelo listo: ' + dest);
    } catch (err) { trProgress(null, 'Error: ' + err.message); toast('Descarga: ' + err.message, 'err', 6000); }
    finally { btn.disabled = false; }
  }

  function bindTranscribe() {
    const t = S.settings.tr;
    const map = { trEngine: 'engine', trLang: 'language', trProvider: 'provider', trKey: 'key', trUrl: 'url', trModel: 'model', trBinary: 'binary', trModelPath: 'modelPath', trRange: 'range', trPrompt: 'prompt', trModelDl: 'dlModel' };
    Object.keys(map).forEach(id => {
      const e = $('#' + id);
      e.addEventListener(e.tagName === 'SELECT' ? 'change' : 'input', () => { t[map[id]] = e.value.trim(); saveSession(); trSync(); });
    });
    $('#trTrack').addEventListener('change', e => { t.track = +e.target.value; saveSession(); });
    $('#trSnap').addEventListener('change', e => { t.snap = e.target.checked; saveSession(); });
    $('#trDrop').addEventListener('change', e => { t.drop = e.target.checked; saveSession(); });
    $('#btnTrFind').addEventListener('click', () => {
      const b = TR.findWhisperBinary();
      if (b) { t.binary = b; saveSession(); trSync(); toast('Encontrado: ' + b, 'ok'); }
      else toast('No se encontró whisper.cpp. En Mac: brew install whisper-cpp. En Windows: descarga whisper-bin-x64.zip de github.com/ggml-org/whisper.cpp/releases', 'warn', 8000);
    });
    $('#btnTrDownload').addEventListener('click', downloadWhisperModel);
    $('#btnTrFile').addEventListener('click', () => $('#trFile').click());
    $('#trFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) runTranscription(f); });
    $('#trRun').addEventListener('click', () => runTranscription());
    $('#trCancel').addEventListener('click', () => { $('#trModal').hidden = true; });
    $('#trModal').addEventListener('click', e => { if (e.target.id === 'trModal' && !transcribing) $('#trModal').hidden = true; });
    $('#btnTranscribe').addEventListener('click', openTranscribe);
    $('#btnEmptyTranscribe').addEventListener('click', openTranscribe);
  }

  // ───────────── Herramientas: silencios ─────────────
  const audioCache = new Map();

  async function decodeMedia(path) {
    if (audioCache.has(path)) return audioCache.get(path);
    let res;
    try {
      res = await AU.decodeArrayBuffer(CEP.fs.readBinary(path));
    } catch (err) {
      // Códec no soportado por el panel → ffmpeg si está instalado
      const wav = `${CEP.fs.tmpDir()}/subtitleengine_${EXP.hash(path)}.wav`;
      await CEP.fs.ffmpegToWav(path, wav);
      res = await AU.decodeArrayBuffer(CEP.fs.readBinary(wav));
    }
    audioCache.set(path, res);
    return res;
  }

  function silOpts() {
    const s = S.settings.sil;
    return { threshold: s.threshold, minDur: s.minDur, padIn: s.padIn, padOut: s.padOut };
  }

  function showSilences(ranges, label) {
    S.silences = AU.merge(ranges);
    const total = S.silences.reduce((a, r) => a + r.end - r.start, 0);
    $('#silCount').textContent = String(S.silences.length);
    $('#silNote').textContent = S.silences.length
      ? `${label}: ${S.silences.length} silencios · ${total.toFixed(1)} s que se pueden quitar.`
      : `${label}: no se encontraron silencios con estos ajustes. Prueba a subir el umbral.`;
    renderSilences();
    drawZoomGraph();
  }

  async function analyzeTrack() {
    if (!CEP.available) { toast('En modo navegador usa «Analizar archivo…»', 'warn'); return null; }
    const btn = $('#btnSilAnalyze');
    btn.disabled = true;
    try {
      const info = await CEP.call('getAudioClips', String(S.settings.sil.track));
      if (!info || !info.ok) throw new Error((info && info.error) || 'Premiere no respondió');
      if (!info.clips.length) throw new Error('La pista de audio está vacía');
      const ranges = [];
      for (let i = 0; i < info.clips.length; i++) {
        const c = info.clips[i];
        $('#silNote').textContent = `Analizando ${i + 1}/${info.clips.length}: ${c.name}…`;
        if (!c.path) continue;
        const a = await decodeMedia(c.path);
        AU.detect(a.samples, a.sampleRate, Object.assign(silOpts(), { from: c.inPoint, to: c.outPoint }))
          .forEach(r => ranges.push({ start: c.start + r.start, end: c.start + r.end }));
      }
      showSilences(ranges, 'Pista A' + (S.settings.sil.track + 1));
      return S.silences;
    } catch (err) {
      $('#silNote').textContent = 'Error: ' + err.message;
      toast('No se pudo analizar el audio: ' + err.message, 'err', 6000);
      return null;
    } finally { btn.disabled = false; }
  }

  let fileAudio = null;
  async function analyzeFile(f) {
    try {
      $('#silNote').textContent = 'Decodificando ' + f.name + '…';
      fileAudio = { name: f.name, audio: await AU.decodeArrayBuffer(await f.arrayBuffer()) };
      reanalyzeFile();
    } catch (err) { toast('Este archivo no se puede decodificar en el panel', 'err'); }
  }
  function reanalyzeFile() {
    if (!fileAudio) return;
    const a = fileAudio.audio;
    showSilences(AU.detect(a.samples, a.sampleRate, silOpts()), fileAudio.name);
  }

  /** Tiempo tras quitar los rangos (para mover los subtítulos ya cargados). */
  function remapTime(t, ranges) {
    let shift = 0;
    for (const r of ranges) {
      if (r.end <= t) shift += r.end - r.start;
      else if (r.start < t) { shift += t - r.start; break; }
      else break;
    }
    return t - shift;
  }

  async function runSilences() {
    const s = S.settings.sil;
    if (!CEP.available) { toast('El corte se ejecuta dentro de Premiere Pro. Aquí puedes analizar y previsualizar.', 'warn', 4500); return; }
    let ranges = S.silences.length && !fileAudio ? S.silences : await analyzeTrack();
    if (!ranges || !ranges.length) { toast('No hay silencios que cortar', 'warn'); return; }
    if (s.mode === 'shorten') ranges = AU.shorten(ranges, 0.15);
    const total = ranges.reduce((a, r) => a + r.end - r.start, 0);
    const what = s.mode === 'markers' ? `crear ${ranges.length} marcadores` : `cortar ${ranges.length} silencios (${total.toFixed(1)} s) con ripple delete en todas las pistas desbloqueadas`;
    if (!window.confirm(`¿${what.charAt(0).toUpperCase() + what.slice(1)}? Puedes deshacerlo en Premiere con Ctrl+Z.`)) return;
    const btn = $('#btnSilRun');
    btn.disabled = true;
    try {
      const r = await CEP.call('cutRanges', { ranges, mode: s.mode === 'markers' ? 'markers' : 'ripple' });
      if (!r || !r.ok) throw new Error((r && r.error) || 'Premiere no respondió');
      (r.warnings || []).forEach(w => toast(w, 'warn', 5000));
      if (s.mode !== 'markers') {
        if (s.shift && S.cues.length) {
          snapshot();
          const off = hostOffset();
          const sorted = ranges.slice().sort((a, b) => a.start - b.start);
          S.cues.forEach(c => {
            c.start = remapTime(c.start + off, sorted) - off;
            c.end = Math.max(c.start + 0.1, remapTime(c.end + off, sorted) - off);
          });
          onCuesReplaced();
        }
        S.silences = [];
        audioCache.clear();
        renderSilences();
        toast(`✓ ${r.done} silencios eliminados (${total.toFixed(1)} s)`, 'ok', 4000);
        confetti();
      } else toast(`✓ ${r.done} marcadores creados`, 'ok');
      refreshSeq(true);
    } catch (err) {
      toast('Error al cortar: ' + err.message, 'err', 6000);
    } finally { btn.disabled = false; }
  }

  // ───────────── Herramientas: Auto-Zoom ─────────────
  function zoomParams(fps) {
    const z = S.settings.zoom;
    return { min: z.min, max: Math.max(z.min, z.max), direction: z.direction, easing: z.easing, frames: z.frames, fps: fps || seqFps(), trigger: z.trigger, interval: z.interval };
  }
  function focalPoint() {
    const z = S.settings.zoom;
    if (z.focal === 'center') return { x: 0.5, y: 0.5 };
    if (z.focal === 'face') return { x: 0.5, y: 1 / 3 };
    return { x: z.fx / 100, y: z.fy / 100 };
  }

  function drawZoomGraph() {
    const cv = $('#zoomGraph');
    const c = cv.getContext('2d');
    const W = cv.width, H = cv.height, css = getComputedStyle(document.body);
    const ink = css.getPropertyValue('--ink').trim() || '#1B1E1A';
    const faint = css.getPropertyValue('--line-soft').trim() || 'rgba(0,0,0,.15)';
    c.clearRect(0, 0, W, H);
    const p = zoomParams(30);
    const dur = 8;
    // Ejemplo: dos clips de 4 s, o la voz analizada
    // Voz de ejemplo, o los primeros 8 s del audio analizado
    let speech = [{ start: 0.6, end: 2.6 }, { start: 3.4, end: 7.2 }];
    if (S.silences.length) {
      const from = Math.max(0, S.silences[0].start - 0.5);
      speech = AU.speech(S.silences, from, from + dur).map(r => ({ start: r.start - from, end: r.end - from }));
    }
    const clips = p.trigger === 'cut' ? [{ start: 0, end: 4, index: 0 }, { start: 4, end: 8, index: 1 }] : [{ start: 0, end: dur, index: 0 }];
    const keys = [].concat(...clips.map(cl => ZM.planClip(cl, Object.assign({}, p, { speech })).map(k => Object.assign({ clip: cl }, k))));
    const lo = 100, hi = 140, pad = 14;
    const X = t => pad + t / dur * (W - pad * 2);
    const Y = s => H - pad - ((s * 100 - lo) / (hi - lo)) * (H - pad * 2);
    c.strokeStyle = faint;
    c.lineWidth = 1;
    for (let v = lo; v <= hi; v += 10) { c.beginPath(); c.moveTo(pad, Y(v / 100)); c.lineTo(W - pad, Y(v / 100)); c.stroke(); }
    if (p.trigger === 'cut') { c.setLineDash([4, 4]); c.beginPath(); c.moveTo(X(4), pad); c.lineTo(X(4), H - pad); c.stroke(); c.setLineDash([]); }
    c.fillStyle = ink;
    c.font = '500 18px "Spline Sans Mono", monospace';
    c.fillText(hi + '%', pad + 4, pad + 14);
    c.fillText(lo + '%', pad + 4, H - pad - 6);
    // Curva
    c.strokeStyle = ink;
    c.lineWidth = 3;
    c.beginPath();
    let prev = null;
    keys.forEach((k, i) => {
      const x = X(k.t), y = Y(k.s);
      if (!prev || (prev.clip !== k.clip)) { if (prev) c.lineTo(X(prev.clip.end), Y(prev.s)); c.moveTo(x, y); }
      else if (prev.interp === 'hold') { c.lineTo(x, Y(prev.s)); c.lineTo(x, y); }
      else if (prev.interp === 'bezier') { const mx = (X(prev.t) + x) / 2; c.bezierCurveTo(mx, Y(prev.s), mx, y, x, y); }
      else c.lineTo(x, y);
      prev = k;
      if (i === keys.length - 1) c.lineTo(X(k.clip.end), y);
    });
    c.stroke();
    c.fillStyle = ink;
    keys.forEach(k => { c.beginPath(); c.arc(X(k.t), Y(k.s), 4, 0, Math.PI * 2); c.fill(); });
  }

  async function runZoom() {
    if (!CEP.available) { toast('El Auto-Zoom se aplica dentro de Premiere Pro. La curva muestra el resultado.', 'warn', 4500); return; }
    const z = S.settings.zoom;
    const btn = $('#btnZoomRun');
    btn.disabled = true;
    try {
      const info = await CEP.call('getVideoClips', z.scope, String(z.track));
      if (!info || !info.ok) throw new Error((info && info.error) || 'Premiere no respondió');
      if (!info.clips.length) throw new Error(z.scope === 'selected' ? 'Selecciona clips de vídeo en la línea de tiempo' : 'La pista está vacía');
      let speech = [];
      if (z.trigger === 'silence') {
        const sil = S.silences.length ? S.silences : await analyzeTrack();
        if (!sil) return;
        const from = Math.min(...info.clips.map(c => c.start)), to = Math.max(...info.clips.map(c => c.end));
        speech = AU.speech(sil, from, to);
      }
      const p = Object.assign(zoomParams(info.fps), { speech });
      const clips = info.clips.map((c, i) => ({ track: c.track, index: c.index, keys: ZM.planClip({ start: c.start, end: c.end, index: i }, p) }))
        .filter(c => c.keys.length);
      const r = await CEP.call('applyZoom', { clips, focal: focalPoint(), replace: z.replace });
      if (!r || !r.ok) throw new Error((r && r.error) || 'Premiere no respondió');
      (r.warnings || []).forEach(w => toast(w, 'warn', 5000));
      toast(`✓ Zoom aplicado a ${r.clips} clip${r.clips === 1 ? '' : 's'}`, 'ok', 3500);
      confetti();
    } catch (err) {
      toast('Auto-Zoom: ' + err.message, 'err', 6000);
    } finally { btn.disabled = false; }
  }

  function bindTools() {
    const s = S.settings.sil, z = S.settings.zoom;
    const bindR = (id, obj, key, fmt, after) => {
      const r = $(id);
      const out = $(id + 'Out');
      r.value = obj[key];
      const paint = () => { updateRangeFill(r); if (out) out.textContent = fmt(+r.value); };
      paint();
      r.addEventListener('input', () => { obj[key] = +r.value; paint(); saveSession(); if (after) after(); });
    };
    const bindS = (id, obj, key, after) => {
      const e = $(id);
      e.value = String(obj[key]);
      e.addEventListener('change', () => { obj[key] = e.type === 'checkbox' ? e.checked : (isNaN(+e.value) || e.value === '' ? e.value : +e.value); saveSession(); if (after) after(); });
    };
    const silSum = () => {
      $('#silSummary').textContent = `${s.threshold} dB · ${Math.round(s.padIn * 1000)}/${Math.round(s.padOut * 1000)} ms`;
      $('#btnSilRun').textContent = s.mode === 'markers' ? '⚑ Insertar marcadores' : s.mode === 'shorten' ? '✂ Acortar silencios' : '✂ Ripple Cut';
    };
    const reSil = debounce(() => { if (fileAudio) reanalyzeFile(); else if (S.silences.length) { S.silences = []; renderSilences(); $('#silCount').textContent = '—'; $('#silNote').textContent = 'Ajustes cambiados: vuelve a analizar.'; } }, 250);
    bindR('#silThr', s, 'threshold', v => v + ' dB', () => { $('#silThrOut').textContent = s.threshold + ' dB'; silSum(); reSil(); });
    bindR('#silMin', s, 'minDur', v => v.toFixed(2) + ' s', () => { $('#silMinOut').textContent = s.minDur.toFixed(2) + ' s'; reSil(); });
    bindR('#silPadIn', s, 'padIn', v => Math.round(v * 1000) + ' ms', () => { silSum(); reSil(); });
    bindR('#silPadOut', s, 'padOut', v => Math.round(v * 1000) + ' ms', () => { silSum(); reSil(); });
    $('#silThrOut').textContent = s.threshold + ' dB';
    $('#silMinOut').textContent = s.minDur.toFixed(2) + ' s';
    bindS('#silMode', s, 'mode', silSum);
    const shift = $('#silShift');
    shift.checked = s.shift;
    shift.addEventListener('change', () => { s.shift = shift.checked; saveSession(); });
    silSum();
    $('#btnSilAnalyze').addEventListener('click', () => { fileAudio = null; analyzeTrack(); });
    $('#btnSilFile').addEventListener('click', () => $('#silFile').click());
    $('#silFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) analyzeFile(f); });
    $('#btnSilRun').addEventListener('click', runSilences);
    $('#silTrack').addEventListener('change', e => { s.track = +e.target.value; S.silences = []; renderSilences(); saveSession(); });

    const zSum = () => {
      $('#zoomSummary').textContent = `${z.min}% → ${z.max}%`;
      $('#zoomIntervalRow').hidden = z.trigger !== 'interval';
      $('#zoomFocalXY').hidden = z.focal !== 'custom';
      drawZoomGraph();
    };
    bindR('#zoomMin', z, 'min', v => v + '%', zSum);
    bindR('#zoomMax', z, 'max', v => v + '%', zSum);
    bindR('#zoomFrames', z, 'frames', v => v + ' fr', zSum);
    bindR('#zoomInterval', z, 'interval', v => v.toFixed(1) + ' s', zSum);
    bindR('#zoomFx', z, 'fx', v => v + '%');
    bindR('#zoomFy', z, 'fy', v => v + '%');
    bindS('#zoomTrigger', z, 'trigger', zSum);
    bindS('#zoomDir', z, 'direction', zSum);
    bindS('#zoomEase', z, 'easing', zSum);
    bindS('#zoomFocal', z, 'focal', zSum);
    bindS('#zoomScope', z, 'scope');
    $('#zoomTrack').addEventListener('change', e => { z.track = +e.target.value; saveSession(); });
    const rep = $('#zoomReplace');
    rep.checked = z.replace;
    rep.addEventListener('change', () => { z.replace = rep.checked; saveSession(); });
    zSum();
    $('#btnZoomRun').addEventListener('click', runZoom);
  }

  // ───────────── Render a Timeline ─────────────
  let cancelExport = false, exporting = false;

  async function refreshSeq(quiet) {
    const box = $('#seqInfo');
    if (!CEP.available) {
      box.innerHTML = '';
      const top = el('div', 'seq-top');
      top.appendChild(el('div', 'seq-name', 'Modo navegador'));
      box.appendChild(top);
      box.appendChild(el('p', null, 'Abre SubtitleEngine Pro desde Premiere Pro (Ventana → Extensiones) para insertar los subtítulos en tu secuencia. Aquí puedes diseñar y probar estilos.'));
      fillTracks();
      return null;
    }
    try {
      const info = await CEP.call('getSequenceInfo');
      S.seq = info && info.ok ? info : null;
      $('#connPill span').textContent = S.seq ? `${S.seq.name} · ${S.seq.width}×${S.seq.height} · ${S.seq.fpsLabel || S.seq.fps} fps` : 'Premiere conectado · sin secuencia';
      if (S.seq) S.seq.anchor = S.settings.startMode === 'playhead' ? S.seq.playhead : 0;
      box.innerHTML = '';
      const top = el('div', 'seq-top');
      top.appendChild(el('div', 'seq-name', S.seq ? S.seq.name : 'Sin secuencia activa'));
      const btn = el('button', 'btn small', '↻ Actualizar');
      btn.addEventListener('click', () => refreshSeq());
      top.appendChild(btn);
      box.appendChild(top);
      if (S.seq) {
        const meta = el('div', 'seq-meta');
        [['Resolución', `${S.seq.width}×${S.seq.height}`], ['Fps', String(S.seq.fpsLabel || S.seq.fps)], ['Pistas', `${S.seq.tracks.length}V · ${(S.seq.audioTracks || []).length}A`]]
          .forEach(([k, v]) => { const d = el('div', 'stat'); d.appendChild(el('small', null, k)); d.appendChild(el('b', null, v)); meta.appendChild(d); });
        box.appendChild(meta);
      } else {
        box.appendChild(el('p', null, (info && info.error) || 'Abre una secuencia en la línea de tiempo.'));
      }
      fillTracks();
      fitStage();
      if (!quiet && !S.seq) toast('No hay una secuencia activa en Premiere', 'warn');
      return S.seq;
    } catch (err) {
      if (!quiet) toast(err.message, 'err');
      return null;
    }
  }

  function fillTracks() {
    const add = (sel, v, t) => { const o = el('option', null, t); o.value = v; sel.appendChild(o); };
    const vt = S.seq ? S.seq.tracks : [{ index: 0, name: 'V1' }, { index: 1, name: 'V2' }, { index: 2, name: 'V3' }];
    const at = S.seq && S.seq.audioTracks ? S.seq.audioTracks : [{ index: 0, name: 'A1' }, { index: 1, name: 'A2' }];
    const label = (p, t) => `${p}${t.index + 1}${t.name && t.name !== p + (t.index + 1) ? ' · ' + t.name : ''}${t.clips != null ? (t.clips ? ` (${t.clips} clips)` : ' (vacía)') : ''}`;

    const sel = $('#expTrack');
    sel.innerHTML = '';
    add(sel, -1, '➕ Pista nueva «SubtitleEngine»');
    vt.forEach(t => add(sel, t.index, label('V', t)));
    sel.value = String(S.settings.track);
    if (sel.selectedIndex < 0) sel.value = '-1';

    const zt = $('#zoomTrack');
    zt.innerHTML = '';
    vt.forEach(t => add(zt, t.index, label('V', t)));
    zt.value = String(S.settings.zoom.track);
    if (zt.selectedIndex < 0) zt.selectedIndex = 0;

    const st = $('#silTrack');
    st.innerHTML = '';
    at.forEach(t => add(st, t.index, label('A', t)));
    st.value = String(S.settings.sil.track);
    if (st.selectedIndex < 0) st.selectedIndex = 0;
  }

  function syncExportUI() {
    const s = S.settings;
    $('#expFormat').value = s.format;
    $('#expFps').value = s.fps;
    $('#expMode').value = s.mode || 'auto';
    $('#expStart').value = s.startMode;
    $('#expDir').value = s.outDir;
    const off = $('#expOffset');
    off.value = s.offset;
    updateRangeFill(off);
    $('#expOffsetOut').textContent = s.offset + ' ms';
    fillTracks();
  }

  function bindExport() {
    syncExportUI();
    const off = $('#expOffset');

    $('#expFormat').addEventListener('change', e => { S.settings.format = e.target.value; fitStage(); buildStyleGallery(); saveSession(); });
    $('#expFps').addEventListener('change', e => { S.settings.fps = e.target.value; renderCueList(); saveSession(); markDirty(); });
    $('#expMode').addEventListener('change', e => { S.settings.mode = e.target.value; saveSession(); });
    $('#expTrack').addEventListener('change', e => { S.settings.track = +e.target.value; saveSession(); });
    $('#expStart').addEventListener('change', e => { S.settings.startMode = e.target.value; saveSession(); });
    $('#expDir').addEventListener('change', e => { S.settings.outDir = e.target.value.trim(); saveSession(); });
    off.addEventListener('input', () => {
      S.settings.offset = +off.value;
      updateRangeFill(off);
      $('#expOffsetOut').textContent = S.settings.offset + ' ms';
      renderSilences();
      saveSession();
    });
    $('#btnDir').addEventListener('click', () => {
      if (!CEP.available) { toast('Disponible dentro de Premiere Pro', 'warn'); return; }
      const dir = CEP.pickFolder('Carpeta de renderizado de SubtitleEngine', S.settings.outDir || CEP.systemPath('myDocuments'));
      if (dir) { S.settings.outDir = dir; $('#expDir').value = dir; saveSession(); }
    });
    $('#btnExport').addEventListener('click', () => runExport());
    $('#btnExportTop').addEventListener('click', () => { switchTab('export'); runExport(); });
    $('#btnDraft').addEventListener('click', () => runExport({ draft: true }));
    $('#btnDraftTop').addEventListener('click', () => runExport({ draft: true }));
    const rep = $('#expReplace');
    rep.checked = S.settings.replace !== false;
    rep.addEventListener('change', () => { S.settings.replace = rep.checked; saveSession(); });
    $('#btnCancel').addEventListener('click', () => { cancelExport = true; });
    $('#btnDiag').addEventListener('click', runDiagnostics);
    $('#btnDiagCopy').addEventListener('click', copyDiagnostics);
    $('#btnFrame').addEventListener('click', () => {
      const { W, H } = frameSize();
      const cv = el('canvas');
      cv.width = W;
      cv.height = H;
      R.renderLayers(cv.getContext('2d'), W, H, layerData, S.time);
      cv.toBlob(b => download(b, `subtitleengine_${fmtTC(S.time).replace(/:/g, '-')}.png`), 'image/png');
    });
  }

  /** Comprueba que las fuentes de las capas estén cargadas (si no, el render saldría con otra). */
  async function missingFonts() {
    if (!document.fonts) return [];
    const out = [];
    for (let i = 0; i < S.layers.length; i++) {
      const st = layerStyle(i);
      const spec = `${st.italic ? 'italic ' : ''}${st.weight} 40px "${st.font}"`;
      try { await document.fonts.load(spec); } catch (e) { /* sigue */ }
      if (!document.fonts.check(spec) && out.indexOf(st.font) === -1) out.push(st.font);
    }
    return out;
  }

  /**
   * Render a la línea de tiempo.
   *  draft = true → vista previa rápida: un PNG fijo por palabra en la pista «SubtitleEngine Preview»,
   *                  que se reemplaza en cada vista previa.
   */
  async function runExport(opts) {
    const draft = !!(opts && opts.draft);
    if (exporting) return;
    if (!S.cues.length) { toast('Importa primero un archivo .srt', 'warn'); return; }
    if (!CEP.available) {
      toast('Para insertar en la línea de tiempo abre el panel dentro de Premiere Pro. Aquí puedes descargar fotogramas PNG.', 'warn', 4500);
      return;
    }
    if (!CEP.canWrite) { toast('El panel no tiene acceso al disco (revisa la instalación).', 'err'); return; }
    const seq = await refreshSeq(true);
    if (!seq) { toast('Abre una secuencia en Premiere antes de exportar', 'err'); return; }

    const s = S.settings;
    let { W, H } = frameSize();
    // Sin deformaciones: los PNG deben medir exactamente lo mismo que la secuencia
    if (seq.width && seq.height && (W !== seq.width || H !== seq.height)) {
      const ok = window.confirm(`La resolución elegida (${W}×${H}) no coincide con la secuencia (${seq.width}×${seq.height}). Premiere escalaría los subtítulos.\n\n¿Renderizar a ${seq.width}×${seq.height}?`);
      if (!ok) return;
      W = seq.width; H = seq.height;
    }
    const lost = await missingFonts();
    if (lost.length && !window.confirm(`No se encontró la fuente ${lost.join(', ')}. El render usaría otra fuente.\n\n¿Continuar de todos modos?`)) return;

    // Fotogramas: siempre los exactos de la secuencia (29.97 = 30000/1001, no 29.97)
    const fps = seq.fps || 30;
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
    const outDir = (s.outDir || (CEP.systemPath('myDocuments') + '/SubtitleEngine Renders')).replace(/\/+$/, '') + (draft ? '/preview' : '');
    const anchorSec = Math.max(0, (s.startMode === 'playhead' ? seq.playhead : 0) + s.offset / 1000);
    const usedLayers = S.layers.map((l, i) => i).filter(i => S.cues.some(c => (c.layer || 0) === i));
    const maxLayer = Math.max(0, ...usedLayers);

    exporting = true;
    cancelExport = false;
    ['#btnExport', '#btnExportTop', '#btnDraft', '#btnDraftTop'].forEach(id => { const b = $(id); if (b) b.disabled = true; });
    $('#expProgress').hidden = false;
    const bar = $('#expBar'), status = $('#expStatus');
    bar.style.width = '0%';
    setPlaying(false);
    const t0 = performance.now();

    try {
      rebuild();
      const res = await EXP.render({
        layers: layerData, W, H, fps, outDir, mode: draft ? 'draft' : s.mode,
        namePrefix: draft ? 'SE·prev ' : 'SE· ',
        isCancelled: () => cancelExport,
        onProgress: (done, total, label) => {
          const p = done / total;
          bar.style.width = (p * 100).toFixed(1) + '%';
          const el2 = (performance.now() - t0) / 1000;
          const eta = p > 0.02 ? Math.max(0, el2 / p - el2) : 0;
          status.textContent = `${draft ? 'Vista previa' : 'Renderizando'} ${done}/${total}${eta ? ` · ~${Math.ceil(eta)} s` : ''}${label ? ' · ' + label.slice(0, 24) : ''}`;
        }
      });
      status.textContent = 'Insertando en la línea de tiempo…';
      const tracks = [];
      for (let i = 0; i <= maxLayer; i++) tracks.push(draft ? -2 : (s.track < 0 ? -1 : s.track + i));
      const payload = {
        binName: (draft ? 'SubtitleEngine Preview ' : 'SubtitleEngine ') + stamp,
        trackName: draft ? 'SubtitleEngine Preview' : 'SubtitleEngine',
        tracks, anchorSec, width: W, height: H,
        clearPrefix: draft ? 'SE·prev' : (s.replace !== false ? 'SE·' : ''),
        items: res.items.map(it => ({ path: it.path, f0: it.f0, frames: it.frames, name: it.name, layer: it.layer, still: it.still }))
      };
      const out = await CEP.call('importAndPlace', payload);
      if (!out || !out.ok) throw new Error((out && out.error) || 'Premiere no respondió');
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      const where = out.tracks.map(t => 'V' + (t + 1)).join(', ');
      const stills = res.items.filter(i => i.still).length;
      status.textContent = draft
        ? `Vista previa lista en ${where} (${secs} s). Dale play en Premiere.`
        : `Listo: ${out.placed} clips en ${where} · ${stills} PNG estáticos · ${res.cached} reutilizados (${secs} s)`;
      bar.style.width = '100%';
      toast(draft ? `▶ Vista previa en ${where}: reprodúcela en el monitor de programa` : `✓ ${out.placed} subtítulos insertados en ${where}`, 'ok', 4000);
      if (!draft) confetti();
      (out.warnings || []).forEach(w => toast(w, 'warn', 5000));
      refreshSeq(true);
    } catch (err) {
      if (err.message === 'CANCELLED') {
        status.textContent = 'Render cancelado';
        toast('Render cancelado', 'warn');
      } else {
        status.textContent = 'Error: ' + err.message;
        toast('Error al renderizar: ' + err.message, 'err', 6000);
      }
    } finally {
      exporting = false;
      ['#btnExport', '#btnExportTop', '#btnDraft', '#btnDraftTop'].forEach(id => { const b = $(id); if (b) b.disabled = false; });
    }
  }

  // ───────────── Diagnóstico ─────────────
  let diagReport = '';
  async function runDiagnostics() {
    const box = $('#diagBox'), list = $('#diagList');
    box.hidden = false;
    list.innerHTML = '';
    $('#diagSummary').textContent = 'Comprobando…';
    const items = [];
    const add = (name, state, detail) => {
      items.push({ name, state, detail: detail || '' });
      const li = el('li', state);
      li.appendChild(el('i', null, state === 'ok' ? '✓' : state === 'warn' ? '!' : '✗'));
      li.appendChild(el('span', null, name));
      li.appendChild(el('small', null, detail || ''));
      list.appendChild(li);
    };

    add('Panel', 'ok', `SubtitleEngine Pro · ${navigator.userAgent.match(/Chrome\/[\d.]+/) || 'navegador'}`);
    if (!CEP.available) add('Conexión con Premiere', 'warn', 'Modo navegador: abre el panel desde Premiere para el diagnóstico completo.');
    else {
      try {
        const r = await CEP.call('selfTest');
        if (!r || !r.ok) throw new Error((r && r.error) || 'sin respuesta');
        r.checks.forEach(c => add(c.name, c.ok ? 'ok' : 'bad', c.detail));
      } catch (err) { add('Conexión con Premiere', 'bad', err.message); }
    }

    // Disco
    if (!CEP.available) add('Acceso al disco', 'warn', 'Solo dentro de Premiere');
    else if (!CEP.canWrite) add('Acceso al disco', 'bad', 'Sin Node.js ni cep.fs: revisa CEFCommandLine en el manifiesto');
    else {
      try {
        const dir = (S.settings.outDir || (CEP.systemPath('myDocuments') + '/SubtitleEngine Renders')).replace(/\/+$/, '');
        CEP.fs.mkdirp(dir);
        const f = dir + '/.subtitleengine-test';
        CEP.fs.writeFile(f, 'b2s=');
        if (!CEP.fs.exists(f)) throw new Error('no se pudo leer lo escrito');
        add('Carpeta de render', 'ok', dir);
      } catch (err) { add('Carpeta de render', 'bad', err.message); }
      add('Node.js en el panel', CEP.hasNode ? 'ok' : 'warn', CEP.hasNode ? 'Disponible (lectura de audio y ffmpeg)' : 'No disponible: el análisis de silencios de la pista no funcionará');
    }

    // Audio y ffmpeg
    add('Decodificador de audio', (window.AudioContext || window.webkitAudioContext) ? 'ok' : 'bad', 'Web Audio');
    if (CEP.available) {
      const v = await CEP.fs.ffmpegVersion();
      add('ffmpeg (respaldo para códecs)', v ? 'ok' : 'warn', v || 'No instalado. Solo hace falta si el panel no puede leer el audio de tus clips.');
    }

    // Fuentes de los presets usados
    const fonts = Array.from(new Set(S.layers.map((l, i) => layerStyle(i).font)));
    await Promise.all(fonts.map(f => document.fonts.load(`700 40px "${f}"`).catch(() => null)));
    fonts.forEach(f => {
      const okFont = document.fonts.check(`700 40px "${f}"`);
      add(`Fuente «${f}»`, okFont ? 'ok' : 'warn', okFont ? 'Cargada' : 'No encontrada: se usará otra. Instálala o comprueba la conexión a Google Fonts.');
    });

    const bad = items.filter(i => i.state === 'bad').length, warn = items.filter(i => i.state === 'warn').length;
    $('#diagSummary').textContent = bad ? `${bad} error${bad > 1 ? 'es' : ''} · ${warn} aviso${warn === 1 ? '' : 's'}` : warn ? `Sin errores · ${warn} aviso${warn === 1 ? '' : 's'}` : 'Todo correcto';
    diagReport = [`SubtitleEngine Pro · diagnóstico ${new Date().toISOString()}`]
      .concat(items.map(i => `[${i.state === 'ok' ? 'OK' : i.state === 'warn' ? 'AVISO' : 'ERROR'}] ${i.name}: ${i.detail}`)).join('\n');
  }

  function copyDiagnostics() {
    const ta = el('textarea');
    ta.value = diagReport;
    document.body.appendChild(ta);
    ta.select();
    let done = false;
    try { done = document.execCommand('copy'); } catch (e) { /* sigue */ }
    ta.remove();
    if (!done && navigator.clipboard) navigator.clipboard.writeText(diagReport).then(() => toast('Informe copiado', 'ok'), () => toast('No se pudo copiar', 'err'));
    else toast(done ? 'Informe copiado' : 'No se pudo copiar', done ? 'ok' : 'err');
  }

  // ───────────── Movimiento de la interfaz ─────────────
  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function moveTabInk() {
    const tabs = $('.tabs'), a = $('.tab.active');
    if (!tabs || !a) return;
    tabs.style.setProperty('--tab-x', a.offsetLeft + 'px');
    tabs.style.setProperty('--tab-w', a.offsetWidth + 'px');
  }

  /** Abre y cierra los acordeones animando la altura. */
  function smoothDetails(root) {
    $$('details.sec', root).forEach(d => {
      if (d.dataset.smooth) return;
      d.dataset.smooth = '1';
      const sum = d.querySelector('summary'), body = d.querySelector('.sec-body');
      if (!sum || !body) return;
      sum.addEventListener('click', e => {
        if (reducedMotion() || !body.animate) return;
        e.preventDefault();
        if (d._anim) d._anim.cancel();
        if (!d.open) {
          d.open = true;
          const h = body.scrollHeight;
          d._anim = body.animate([{ height: '0px', opacity: 0 }, { height: h + 'px', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(.22,1,.36,1)' });
        } else {
          const h = body.scrollHeight;
          d._anim = body.animate([{ height: h + 'px', opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 240, easing: 'cubic-bezier(.22,1,.36,1)' });
          d._anim.onfinish = () => { d.open = false; };
        }
      });
    });
  }

  function bump(elm) {
    if (!elm) return;
    elm.classList.remove('bump');
    void elm.offsetWidth;
    elm.classList.add('bump');
  }

  /** Confeti amarillo y negro (celebración al terminar una tarea larga). */
  function confetti() {
    if (reducedMotion()) return;
    const cv = el('canvas', 'confetti');
    cv.width = window.innerWidth;
    cv.height = window.innerHeight;
    document.body.appendChild(cv);
    const c = cv.getContext('2d');
    const colors = ['#FAFF96', '#1B1E1A', '#F6F5F0', '#C9A227'];
    const parts = Array.from({ length: 90 }, () => ({
      x: cv.width * (0.3 + Math.random() * 0.4), y: cv.height * 0.35,
      vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 13 - 4,
      r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
      w: 6 + Math.random() * 7, h: 3 + Math.random() * 5, col: colors[(Math.random() * colors.length) | 0]
    }));
    const t0 = performance.now();
    (function frame(now) {
      const k = (now - t0) / 1600;
      c.clearRect(0, 0, cv.width, cv.height);
      parts.forEach(p => {
        p.vy += 0.45; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        c.save();
        c.globalAlpha = Math.max(0, 1 - k);
        c.translate(p.x, p.y);
        c.rotate(p.r);
        c.fillStyle = p.col;
        c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        c.restore();
      });
      if (k < 1) requestAnimationFrame(frame); else cv.remove();
    })(t0);
  }

  // ───────────── Componentes de interfaz ─────────────
  /** Arrastrar sobre la etiqueta cambia el valor (Shift ×10, Alt ×0.1), como en Adobe. */
  function scrubLabel(lab, range, num) {
    lab.addEventListener('pointerdown', e => {
      if (e.target === num || e.button !== 0) return;
      e.preventDefault();
      const x0 = e.clientX, v0 = +range.value, step = +range.step || 1, span = (+range.max - +range.min);
      let moved = false;
      lab.setPointerCapture(e.pointerId);
      const move = ev => {
        const dx = ev.clientX - x0;
        if (!moved && Math.abs(dx) < 3) return;
        moved = true;
        const k = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
        const perPx = Math.max(step, span / 300) * k;
        let v = v0 + dx * perPx;
        v = Math.round(v / step) * step;
        v = Math.max(+range.min, Math.min(+range.max, v));
        if (+range.value !== v) { range.value = v; range.dispatchEvent(new Event('input')); }
      };
      const up = () => {
        lab.removeEventListener('pointermove', move);
        lab.removeEventListener('pointerup', up);
        if (!moved) num.focus(), num.select();
        else range.dispatchEvent(new Event('change'));
      };
      lab.addEventListener('pointermove', move);
      lab.addEventListener('pointerup', up);
    });
  }

  /* Desplegables propios: el <select> original guarda el valor y dispara «change». */
  const DD = [];
  let ddOpen = null;
  function enhanceSelects(root) {
    $$('select', root || document).forEach(sel => {
      if (sel.closest('.dd') || sel.dataset.native) return;
      const wrap = el('div', 'dd' + (sel.classList.contains('mini-select') ? ' mini' : ''));
      sel.parentNode.insertBefore(wrap, sel);
      wrap.appendChild(sel);
      sel.tabIndex = -1;
      const btn = el('button', 'dd-btn');
      btn.type = 'button';
      if (sel.title) btn.title = sel.title;
      if (sel.id) btn.dataset.for = sel.id;
      wrap.appendChild(btn);
      const entry = { sel, btn, wrap, last: null };
      entry.sync = () => {
        const o = sel.options[sel.selectedIndex];
        btn.textContent = o ? o.textContent : '';
        entry.last = sel.value;
      };
      entry.sync();
      DD.push(entry);
      new MutationObserver(entry.sync).observe(sel, { childList: true, subtree: true, characterData: true });
      sel.addEventListener('change', entry.sync);
      btn.addEventListener('click', e => { e.stopPropagation(); openDD(entry); });
      btn.addEventListener('keydown', e => {
        if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); e.stopPropagation(); openDD(entry); }
      });
      if (sel.id) {
        const lab = document.querySelector(`label[for="${sel.id}"]`);
        if (lab) lab.addEventListener('click', e => { e.preventDefault(); btn.focus(); });
      }
    });
  }
  /** Los cambios hechos por código (sel.value = …) no disparan eventos: se comprueban cada poco. */
  function refreshSelects() { DD.forEach(d => { if (d.sel.value !== d.last) d.sync(); }); }

  function closeDD(focus) {
    if (!ddOpen) return;
    const d = ddOpen;
    ddOpen = null;
    d.menu.remove();
    d.entry.wrap.classList.remove('open');
    document.removeEventListener('keydown', d.onKey, true);
    if (focus) d.entry.btn.focus();
  }
  function openDD(entry) {
    if (ddOpen && ddOpen.entry === entry) { closeDD(true); return; }
    closeDD();
    closeMenus();
    const { sel, btn } = entry;
    const m = el('div', 'dd-menu');
    m.setAttribute('role', 'listbox');
    const items = Array.from(sel.options).map((o, i) => {
      const b = el('button', o.selected ? 'on' : '', o.textContent);
      b.type = 'button';
      b.dataset.i = i;
      b.disabled = o.disabled;
      m.appendChild(b);
      return b;
    });
    document.body.appendChild(m);
    const r = btn.getBoundingClientRect();
    m.style.minWidth = Math.max(r.width, 160) + 'px';
    const h = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 8)) + 'px';
    m.style.top = (window.innerHeight - r.bottom < h + 8 && r.top > h + 8 ? r.top - h - 4 : r.bottom + 4) + 'px';
    entry.wrap.classList.add('open');
    let kb = sel.selectedIndex;
    const mark = () => items.forEach((b, i) => { b.classList.toggle('kb', i === kb); if (i === kb) b.scrollIntoView({ block: 'nearest' }); });
    const choose = i => {
      if (i >= 0 && i < items.length && !items[i].disabled && sel.selectedIndex !== i) {
        sel.selectedIndex = i;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      closeDD(true);
    };
    m.addEventListener('click', e => { e.stopPropagation(); const b = e.target.closest('button'); if (b) choose(+b.dataset.i); });
    const onKey = e => {
      if (e.key === 'ArrowDown') kb = Math.min(items.length - 1, kb + 1);
      else if (e.key === 'ArrowUp') kb = Math.max(0, kb - 1);
      else if (e.key === 'Home') kb = 0;
      else if (e.key === 'End') kb = items.length - 1;
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); choose(kb); return; }
      else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); closeDD(true); return; }
      else if (e.key.length === 1) {
        const q = e.key.toLowerCase();
        const j = items.findIndex((b, i) => i > kb && b.textContent.trim().toLowerCase().startsWith(q));
        const k = j >= 0 ? j : items.findIndex(b => b.textContent.trim().toLowerCase().startsWith(q));
        if (k >= 0) kb = k;
      } else return;
      e.preventDefault();
      e.stopPropagation();
      mark();
    };
    document.addEventListener('keydown', onKey, true);
    ddOpen = { entry, menu: m, onKey };
    mark();
  }

  /* Menús de botón (Archivo, Apariencia, Seleccionar, Vídeo): uno abierto a la vez. */
  function closeMenus(except) { $$('.menu').forEach(m => { if (m !== except) m.hidden = true; }); }
  function bindMenus() {
    $$('.menu-wrap').forEach(w => {
      const btn = w.querySelector(':scope > button'), menu = w.querySelector(':scope > .menu');
      if (!btn || !menu) return;
      btn.addEventListener('click', e => {
        e.stopPropagation();
        closeDD();
        const open = menu.hidden;
        closeMenus(menu);
        menu.hidden = !open;
      });
      menu.addEventListener('click', e => {
        e.stopPropagation();
        if (e.target.closest('button') && !e.target.closest('.accent-row') && !e.target.closest('[data-density]')) menu.hidden = true;
      });
      menu.addEventListener('keydown', e => {
        const items = $$(':scope > button', menu);
        let i = items.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { items[(i + 1) % items.length].focus(); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { items[(i - 1 + items.length) % items.length].focus(); e.preventDefault(); }
        else if (e.key === 'Escape') { menu.hidden = true; btn.focus(); e.preventDefault(); }
        e.stopPropagation();
      });
    });
    document.addEventListener('click', () => { closeMenus(); closeDD(); });
    window.addEventListener('resize', () => closeDD());
    document.addEventListener('scroll', e => { if (ddOpen && !ddOpen.menu.contains(e.target)) closeDD(); }, true);
  }

  /* Apariencia: tema, acento y densidad (se guardan en este equipo). */
  const UI_KEY = 'subfx.ui';
  function applyUI(ui) {
    const r = document.documentElement;
    r.dataset.theme = ui.theme || 'dark';
    r.dataset.density = ui.density || 'comfortable';
    // Tonos derivados del acento (sin color-mix, que el Chromium de CEP no soporta)
    const acc = ui.accent || '#FAFF96';
    const [ar, ag, ab] = [1, 3, 5].map(i => parseInt(acc.slice(i, i + 2), 16));
    r.style.setProperty('--accent', acc);
    r.style.setProperty('--accent-soft', `rgba(${ar},${ag},${ab},.16)`);
    r.style.setProperty('--accent-wash', `rgba(${ar},${ag},${ab},.55)`);
    if (r.dataset.theme === 'dark') r.style.setProperty('--focus-ring', `rgba(${ar},${ag},${ab},.22)`);
    else r.style.removeProperty('--focus-ring');
    $$('#themeMenu [data-theme]').forEach(b => b.classList.toggle('on', b.dataset.theme === r.dataset.theme));
    $$('#themeMenu [data-density]').forEach(b => b.classList.toggle('on', b.dataset.density === r.dataset.density));
    $$('#accentRow [data-accent]').forEach(b => b.classList.toggle('on', b.dataset.accent === (ui.accent || '#FAFF96')));
    moveTabInk();
    drawZoomGraph();
  }
  /** Estado visual de los interruptores con icono (en lugar de :has(), no disponible en CEP). */
  function bindToggles() {
    $$('.tgl').forEach(t => {
      const inp = t.querySelector('input');
      const sync = () => t.classList.toggle('on', inp.checked);
      inp.addEventListener('change', sync);
      inp.addEventListener('focus', () => t.classList.add('kb-focus'));
      inp.addEventListener('blur', () => t.classList.remove('kb-focus'));
      sync();
      t._sync = sync;
    });
  }
  function loadUI() { try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}'); } catch (e) { return {}; } }
  function bindAppearance() {
    const ui = loadUI();
    applyUI(ui);
    $('#themeMenu').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.theme) ui.theme = b.dataset.theme;
      if (b.dataset.accent) ui.accent = b.dataset.accent;
      if (b.dataset.density) ui.density = b.dataset.density;
      applyUI(ui);
      try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (err) { /* sin almacenamiento */ }
    });
  }

  // ───────────── Pestañas y teclado ─────────────
  function switchTab(name) {
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
    moveTabInk();
    if (name === 'style') Object.keys(styles).forEach(renderStyleThumb);
    if (name === 'export' || name === 'tools') refreshSeq(true);
    if (name === 'tools') drawZoomGraph();
    try { localStorage.setItem('subfx.tab', name); } catch (e) { /* ignorado */ }
  }

  function bindKeys() {
    document.addEventListener('keydown', e => {
      if (!$('#newModal').hidden || !$('#trModal').hidden) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.target.isContentEditable) return;
      if (ddOpen || document.querySelector('.menu:not([hidden])')) return;
      if (tag === 'button' && (e.code === 'Space' || e.key === 'Enter')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.code === 'Space') { e.preventDefault(); setPlaying(!S.playing); }
      else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); quickSelect('all'); }
      else if (e.key === 'Escape') quickSelect('none');
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (S.selection.size) mutateSelection(o => { delete o.fx; delete o.fxColor; }); }
    });
  }

  // ───────────── Inicio ─────────────
  function init() {
    loadStyles();
    if (!loadSession()) {
      const d = cuesFromText(SRT.SAMPLE);
      S.cues = d.cues;
      // Ejemplo con palabras clave del preset 30X
      S.cues.forEach(c => {
        const best = c.words.slice().sort((a, b) => norm(b.text).length - norm(a.text).length)[0];
        if (best) best.ovr.key = true;
      });
    }
    indexWords();
    rebuild();

    const pill = $('#connPill');
    pill.classList.add(CEP.available ? 'ok' : 'web');
    pill.querySelector('span').textContent = CEP.available ? 'Premiere conectado' : 'Modo navegador · sin Premiere';
    CEP.registerKeys();

    renderLayerBar();
    renderCueList();
    renderTimelineCues();
    buildFxPanel();
    buildStyleEditor();
    buildStyleCats();
    buildStyleGallery();
    bindLayers();
    bindStyles();
    bindCueList();
    bindTimeline();
    bindLoading();
    bindExport();
    bindTools();
    bindTranscribe();
    bindVideo();
    bindProject();
    bindKeys();
    refreshSelectionUI();
    fillTracks();
    refreshSeq(true);

    $$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
    $('#btnUndo').addEventListener('click', undo);
    $('#btnRedo').addEventListener('click', redo);
    window.addEventListener('resize', fitStage);
    if (window.ResizeObserver) new ResizeObserver(fitStage).observe($('#stage'));

    const refreshFonts = () => { markDirty(); Object.keys(styles).forEach(renderStyleThumb); };
    Object.values(styles).forEach(loadFont);
    if (document.fonts) {
      document.fonts.ready.then(() => { refreshFonts(); drawZoomGraph(); });
      document.fonts.addEventListener && document.fonts.addEventListener('loadingdone', refreshFonts);
    }
    let tab = 'style';
    try { tab = localStorage.getItem('subfx.tab') || 'style'; } catch (e) { /* ignorado */ }
    if ($('#tab-' + tab)) switchTab(tab);
    smoothDetails($('#tab-tools'));
    bindMenus();
    bindAppearance();
    bindToggles();
    enhanceSelects();
    setInterval(refreshSelects, 250);
    fitStage();
    moveTabInk();
    window.addEventListener('resize', moveTabInk);
    if (document.fonts) document.fonts.ready.then(moveTabInk);
    S.time = 1.2;
    requestAnimationFrame(tick);
  }

  init();
})();
