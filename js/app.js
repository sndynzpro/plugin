/*
 * SubFX Studio — Lógica de la interfaz.
 */
(function () {
  'use strict';

  const FX = window.SubFX_Effects;
  const ST = window.SubFX_Styles;
  const SRT = window.SubFX_SRT;
  const R = window.SubFX_Renderer;
  const CEP = window.SubFX_CEP;
  const EXP = window.SubFX_Exporter;

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const LS_SESSION = 'subfx.session.v1';
  const LS_STYLES = 'subfx.styles.v1';
  const SWATCHES = ['#FFFFFF', '#FFE600', '#FFB800', '#FF7A00', '#FF3D3D', '#FF3D9A', '#C13DFF',
    '#7C5CFF', '#3D8BFF', '#22D3EE', '#22C55E', '#A3E635', '#000000'];

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const debounce = (fn, ms) => { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; };
  const norm = s => String(s).toLocaleLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]/gu, '');
  const fmtTime = s => {
    s = Math.max(0, s);
    const m = Math.floor(s / 60), sec = s - m * 60;
    return String(m).padStart(2, '0') + ':' + sec.toFixed(1).padStart(4, '0');
  };

  // ───────────── Estado ─────────────
  let uid = 1;
  const newId = p => p + (uid++).toString(36);

  const S = {
    cues: [],
    styleId: 'hormozi',
    selection: new Set(),
    anchor: null,
    time: 0,
    playing: false,
    playEnd: null,
    fxCat: '',
    seq: null,
    settings: { format: 'auto', fps: 'auto', track: -1, startMode: 'zero', offset: 0, outDir: '', bg: 'scene' },
    history: [],
    future: []
  };
  let styles = {};
  let chunks = [];
  let duration = 10;
  const wordMap = new Map();     // id → { word, cue }
  let wordOrder = [];            // ids en orden
  const chipEls = new Map();
  const cueEls = new Map();

  const style = () => styles[S.styleId] || styles.hormozi || Object.values(styles)[0];

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
        cues: S.cues, styleId: S.styleId, settings: S.settings, uid
      }));
    } catch (e) { /* ignorado */ }
  }, 400);

  function loadSession() {
    try {
      const d = JSON.parse(localStorage.getItem(LS_SESSION) || 'null');
      if (!d || !Array.isArray(d.cues)) return false;
      S.cues = d.cues;
      if (d.styleId && styles[d.styleId]) S.styleId = d.styleId;
      Object.assign(S.settings, d.settings || {});
      uid = d.uid || 1000;
      return true;
    } catch (e) { return false; }
  }

  // ───────────── Datos ─────────────
  function cuesFromText(text) {
    const parsed = SRT.parse(text);
    return parsed.map(c => ({
      id: newId('c'),
      start: c.start,
      end: c.end,
      words: c.text.split(' ').filter(Boolean).map(t => ({ id: newId('w'), text: t, ovr: {} }))
    }));
  }

  function indexWords() {
    wordMap.clear();
    wordOrder = [];
    S.cues.forEach(cue => cue.words.forEach(w => {
      if (!w.ovr) w.ovr = {};
      wordMap.set(w.id, { word: w, cue });
      wordOrder.push(w.id);
    }));
    for (const id of Array.from(S.selection)) if (!wordMap.has(id)) S.selection.delete(id);
  }

  function rebuild() {
    chunks = R.buildChunks(S.cues, style(), 0);
    const last = S.cues.length ? S.cues[S.cues.length - 1].end : 0;
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
      return { W: 1920, H: 1080 };
    }
    const [w, h] = f.split('x').map(Number);
    return { W: w, H: h };
  }

  function fitStage() {
    const { W, H } = frameSize();
    const stage = $('#stage');
    const inner = $('#stageInner');
    const sw = stage.clientWidth - 16, sh = stage.clientHeight - 16;
    const scale = Math.min(sw / W, sh / H);
    inner.style.width = Math.floor(W * scale) + 'px';
    inner.style.height = Math.floor(H * scale) + 'px';
    // Resolución interna: la de exportación, limitada para no saturar la vista previa.
    const lim = Math.min(1, 1920 / Math.max(W, H));
    const cw = Math.round(W * lim), ch = Math.round(H * lim);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    markDirty();
  }

  let liveCue = null, liveWord = null;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const ch = R.renderFrame(ctx, canvas.width, canvas.height, chunks, S.time, style());
    $('#timeLabel').textContent = fmtTime(S.time);
    $('#tlHead').style.left = (S.time / duration * 100) + '%';

    // Resaltar subtítulo y palabra en curso en la lista
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
    if (S.playing) {
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
    markDirty();
  }
  function seek(t) {
    S.time = Math.max(0, Math.min(duration, t));
    markDirty();
  }

  /** Reproduce el bloque donde está la primera palabra seleccionada. */
  function previewSelection() {
    const id = wordOrder.find(i => S.selection.has(i));
    if (!id) return;
    const ch = chunks.find(c => c.words.some(w => w.ref.id === id));
    if (!ch) return;
    S.time = Math.max(0, ch.start - 0.05);
    setPlaying(true, ch.end);
  }

  function renderTimelineCues() {
    const box = $('#tlCues');
    box.innerHTML = '';
    S.cues.forEach(cue => {
      const b = el('div', 'tl-cue');
      b.dataset.cue = cue.id;
      b.style.left = (cue.start / duration * 100) + '%';
      b.style.width = Math.max(0.3, (cue.end - cue.start) / duration * 100) + '%';
      if (cue.words.some(w => w.ovr && (w.ovr.fx || w.ovr.color))) b.classList.add('fx');
      box.appendChild(b);
    });
    markTimelineLive();
  }

  function markTimelineLive() {
    $$('.tl-cue.live').forEach(e => e.classList.remove('live'));
    if (liveCue) { const b = $(`.tl-cue[data-cue="${liveCue}"]`); if (b) b.classList.add('live'); }
  }

  function bindTimeline() {
    const tl = $('#timeline');
    let drag = false;
    const at = e => {
      const r = tl.getBoundingClientRect();
      seek((e.clientX - r.left) / r.width * duration);
    };
    tl.addEventListener('mousedown', e => { drag = true; setPlaying(false); at(e); });
    window.addEventListener('mousemove', e => { if (drag) at(e); });
    window.addEventListener('mouseup', () => { drag = false; });
    $('#btnPlay').addEventListener('click', () => setPlaying(!S.playing));

    const bg = $('#selBg');
    bg.value = S.settings.bg === 'image' ? 'scene' : S.settings.bg;
    const applyBg = v => {
      const stage = $('#stage');
      stage.className = 'stage bg-' + v;
      if (v !== 'image') $('#stageInner').style.backgroundImage = '';
    };
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
      const url = URL.createObjectURL(f);
      applyBg('image');
      $('#stageInner').style.backgroundImage = `url("${url}")`;
      e.target.value = '';
    });
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
      const meta = el('div', 'cue-meta');
      meta.appendChild(el('span', 'cue-idx', '#' + (i + 1)));
      const tb = el('button', 'cue-time', fmtTime(cue.start));
      tb.dataset.seek = cue.start;
      tb.title = 'Ir a este subtítulo';
      meta.appendChild(tb);
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
      cueEls.set(cue.id, row);
      frag.appendChild(row);
    });
    list.appendChild(frag);
    $('#emptyState').hidden = S.cues.length > 0;
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
    c.style.setProperty('--wc', o.color || '');
    if (fx) {
      c.style.setProperty('--fc', o.fxColor || fx.color);
      c.appendChild(el('i', 'fx-tag', fx.name));
    }
    const bits = [];
    if (fx) bits.push('Efecto: ' + fx.name);
    if (o.color) bits.push('Color: ' + o.color);
    if (o.scale && o.scale !== 1) bits.push('Tamaño: ' + Math.round(o.scale * 100) + '%');
    c.title = bits.join(' · ');
  }

  function bindCueList() {
    const list = $('#cueList');
    list.addEventListener('click', e => {
      const t = e.target.closest('.cue-time');
      if (t) { setPlaying(false); seek(+t.dataset.seek); return; }
      const chip = e.target.closest('.chip');
      if (!chip || chip.isContentEditable) return;
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
      // Llevar la vista previa a la palabra
      const ch = chunks.find(c => c.words.some(w => w.ref.id === id));
      if (ch && !S.playing) {
        const w = ch.words.find(x => x.ref.id === id);
        seek(Math.min(w.we - 0.01, w.ws + 0.5));
      }
      refreshSelectionUI();
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
          if (parts.length > 1) {
            const idx = info.cue.words.indexOf(info.word);
            const extra = parts.slice(1).map(t => ({ id: newId('w'), text: t, ovr: {} }));
            info.cue.words.splice(idx + 1, 0, ...extra);
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

    $('#quick').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b) quickSelect(b.dataset.q);
    });
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
    cnt.textContent = n === 1 ? '1 seleccionada' : `${n} seleccionadas`;
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

    // Estado de las tarjetas de efectos
    const counts = {};
    words.forEach(w => { if (w.ovr.fx) counts[w.ovr.fx] = (counts[w.ovr.fx] || 0) + 1; });
    $$('.fx-card').forEach(c => {
      const k = counts[c.dataset.fx] || 0;
      c.classList.toggle('on', n > 0 && k === n);
      c.classList.toggle('partial', k > 0 && k < n);
    });

    // Propiedades de palabra
    $('#wordProps').classList.toggle('disabled', n === 0);
    const o = n ? words[0].ovr : {};
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
      pick.querySelector('input').value = /^#[0-9A-F]{6}$/i.test(value || fallback || '') ? (value || fallback) : '#FFE600';
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

  // ───────────── Estilos ─────────────
  const EDITOR = [
    {
      title: 'Tipografía', open: true, fields: [
        { k: 'font', label: 'Fuente', type: 'font' },
        { k: 'weight', label: 'Grosor', type: 'select', half: true, options: [[400, 'Normal'], [500, 'Medio'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra bold'], [900, 'Black']], num: true },
        { k: 'case', label: 'Mayúsculas', type: 'select', half: true, options: [['upper', 'MAYÚSCULAS'], ['none', 'Original'], ['lower', 'minúsculas'], ['title', 'Tipo título']] },
        { k: 'size', label: 'Tamaño', type: 'range', min: 20, max: 220, step: 1, unit: 'px' },
        { k: 'letterSpacing', label: 'Espaciado entre letras', type: 'range', min: -0.05, max: 0.4, step: 0.01 },
        { k: 'wordGap', label: 'Espacio entre palabras', type: 'range', min: 0.1, max: 1, step: 0.01 },
        { k: 'lineHeight', label: 'Interlineado', type: 'range', min: 0.8, max: 2, step: 0.05 },
        { k: 'italic', label: 'Cursiva', type: 'toggle' }
      ]
    },
    {
      title: 'Color', open: true, fields: [
        { k: 'color', label: 'Color del texto', type: 'color' },
        { k: 'gradient', label: 'Degradado', type: 'toggle' },
        { k: 'color2', label: 'Color inferior del degradado', type: 'color', show: s => s.gradient }
      ]
    },
    {
      title: 'Palabra activa (karaoke)', open: true, fields: [
        { k: 'hlMode', label: 'Resaltar', type: 'select', options: [['current', 'La palabra que se dice'], ['spoken', 'Palabras ya dichas'], ['none', 'Nada']] },
        { k: 'hlColor', label: 'Color de resaltado', type: 'color', show: s => s.hlMode !== 'none' },
        { k: 'hlScale', label: 'Escala de la palabra activa', type: 'range', min: 1, max: 1.6, step: 0.01, show: s => s.hlMode !== 'none' },
        { k: 'hlBox', label: 'Caja detrás de la palabra activa', type: 'toggle', show: s => s.hlMode !== 'none' },
        { k: 'hlBoxColor', label: 'Color de la caja', type: 'color', show: s => s.hlMode !== 'none' && s.hlBox }
      ]
    },
    {
      title: 'Contorno, sombra y brillo', fields: [
        { k: 'strokeWidth', label: 'Grosor del contorno', type: 'range', min: 0, max: 30, step: 0.5, unit: 'px' },
        { k: 'strokeColor', label: 'Color del contorno', type: 'color', show: s => s.strokeWidth > 0 },
        { k: 'shadowOpacity', label: 'Opacidad de la sombra', type: 'range', min: 0, max: 1, step: 0.05 },
        { k: 'shadowColor', label: 'Color de la sombra', type: 'color', show: s => s.shadowOpacity > 0 },
        { k: 'shadowBlur', label: 'Desenfoque', type: 'range', min: 0, max: 60, step: 1, unit: 'px', show: s => s.shadowOpacity > 0 },
        { k: 'shadowX', label: 'Desplazamiento X', type: 'range', min: -30, max: 30, step: 1, unit: 'px', half: true, show: s => s.shadowOpacity > 0 },
        { k: 'shadowY', label: 'Desplazamiento Y', type: 'range', min: -30, max: 30, step: 1, unit: 'px', half: true, show: s => s.shadowOpacity > 0 },
        { k: 'glow', label: 'Resplandor', type: 'range', min: 0, max: 80, step: 1, unit: 'px' },
        { k: 'glowColor', label: 'Color del resplandor', type: 'color', show: s => s.glow > 0 }
      ]
    },
    {
      title: 'Fondo', fields: [
        { k: 'bg', label: 'Fondo', type: 'select', options: [['none', 'Sin fondo'], ['block', 'Bloque'], ['line', 'Por línea']] },
        { k: 'bgColor', label: 'Color', type: 'color', show: s => s.bg !== 'none' },
        { k: 'bgOpacity', label: 'Opacidad', type: 'range', min: 0, max: 1, step: 0.05, show: s => s.bg !== 'none' },
        { k: 'bgRadius', label: 'Redondeo', type: 'range', min: 0, max: 60, step: 1, unit: 'px', half: true, show: s => s.bg !== 'none' },
        { k: 'bgPad', label: 'Relleno', type: 'range', min: 0, max: 60, step: 1, unit: 'px', half: true, show: s => s.bg !== 'none' }
      ]
    },
    {
      title: 'Diseño y posición', fields: [
        { k: 'reveal', label: 'Aparición de palabras', type: 'select', options: [['all', 'Todas a la vez'], ['progressive', 'Progresiva (según se dicen)'], ['single', 'Una a una']] },
        { k: 'preAlpha', label: 'Opacidad de palabras aún no dichas', type: 'range', min: 0, max: 1, step: 0.05, show: s => s.reveal === 'all' },
        { k: 'maxWords', label: 'Palabras por bloque (0 = subtítulo completo)', type: 'range', min: 0, max: 12, step: 1, rebuild: true },
        { k: 'maxWidth', label: 'Ancho máximo', type: 'range', min: 20, max: 100, step: 1, unit: '%' },
        { k: 'posY', label: 'Posición vertical', type: 'range', min: 5, max: 95, step: 1, unit: '%', half: true },
        { k: 'posX', label: 'Posición horizontal', type: 'range', min: 5, max: 95, step: 1, unit: '%', half: true }
      ]
    },
    {
      title: 'Animación', fields: [
        { k: 'cueIn', label: 'Entrada del bloque', type: 'select', options: [['none', 'Ninguna'], ['pop', 'Pop'], ['fade', 'Fundido'], ['slide', 'Deslizar'], ['zoom', 'Zoom']] },
        { k: 'cueOut', label: 'Fundido de salida', type: 'toggle' },
        { k: 'wordFx', label: 'Efecto para todas las palabras', type: 'select', fxOptions: true }
      ]
    }
  ];

  function fmtVal(f, v) {
    if (f.unit === '%') return Math.round(v) + '%';
    if (f.unit === 'px') return (Math.round(v * 10) / 10) + 'px';
    if (f.step < 1) return Number(v).toFixed(2);
    return String(v);
  }

  function buildStyleEditor() {
    const root = $('#styleEditor');
    root.innerHTML = '';
    const dl = el('datalist');
    dl.id = 'fontList';
    ST.FONTS.forEach(f => { const o = el('option'); o.value = f; dl.appendChild(o); });
    root.appendChild(dl);

    EDITOR.forEach(sec => {
      const d = el('details', 'sec');
      if (sec.open) d.open = true;
      const sum = el('summary');
      sum.appendChild(el('span', 'dot'));
      sum.appendChild(document.createTextNode(sec.title));
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
      const out = el('output');
      lab.appendChild(out);
      input = el('input');
      input.type = 'range';
      input.min = f.min; input.max = f.max; input.step = f.step;
      input.addEventListener('input', () => { out.textContent = fmtVal(f, +input.value); updateRangeFill(input); set(+input.value, true); });
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
      input.placeholder = 'Cualquier fuente instalada';
      input.addEventListener('change', () => { if (input.value.trim()) set(input.value.trim()); });
      wrap.appendChild(input);
    }
    return wrap;
  }

  let styleSnapTimer = null;
  function setStyleValue(f, v, live) {
    const st = style();
    st[f.k] = v;
    if (f.rebuild) rebuild();
    if (f.k === 'font' || f.k === 'weight' || f.k === 'italic') loadFont(st);
    saveStyles();
    markDirty();
    syncVisibility();
    clearTimeout(styleSnapTimer);
    styleSnapTimer = setTimeout(() => renderStyleThumb(S.styleId), live ? 120 : 0);
  }

  function syncStyleEditor() {
    const st = style();
    EDITOR.forEach(sec => sec.fields.forEach(f => {
      const wrap = $(`#styleEditor .field[data-k="${f.k}"]`);
      if (!wrap) return;
      const v = st[f.k];
      if (f.type === 'range') {
        const inp = wrap.querySelector('input');
        inp.value = v;
        updateRangeFill(inp);
        wrap.querySelector('output').textContent = fmtVal(f, v);
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
    EDITOR.forEach(sec => sec.fields.forEach(f => {
      if (!f.show) return;
      const wrap = $(`#styleEditor .field[data-k="${f.k}"]`);
      if (wrap) wrap.hidden = !f.show(st);
    }));
  }

  const thumbChunk = (() => {
    const mk = (text, ws, we) => ({ ref: { id: 'x' + text, text, ovr: {} }, ws, we });
    const words = [mk('Esto', 0, 0.3), mk('es', 0.3, 0.5), mk('increíble', 0.5, 2)];
    return { id: 'thumb', cueId: 'thumb', start: 0, end: 2, words };
  })();

  function renderStyleThumb(id) {
    const card = $(`.style-card[data-id="${id}"]`);
    if (!card) return;
    const cv = card.querySelector('canvas');
    const c = cv.getContext('2d');
    c.clearRect(0, 0, cv.width, cv.height);
    const src = styles[id];
    const st = Object.assign({}, src, { size: src.size * 2.1, posY: 50, maxWidth: 94, reveal: src.reveal === 'single' ? 'single' : 'all', preAlpha: 1 });
    R.renderChunk(c, cv.width, cv.height, thumbChunk, 1.4, st);
  }

  function buildStyleGallery() {
    const g = $('#styleGallery');
    g.innerHTML = '';
    Object.values(styles).forEach(st => {
      const card = el('button', 'style-card' + (st.id === S.styleId ? ' on' : ''));
      card.dataset.id = st.id;
      const cv = el('canvas');
      cv.width = 480;
      cv.height = 270;
      card.appendChild(cv);
      const name = el('div', 'st-name');
      name.appendChild(el('span', null, st.name));
      if (st.custom) name.appendChild(el('span', 'st-badge', 'Mío'));
      card.appendChild(name);
      g.appendChild(card);
      renderStyleThumb(st.id);
    });
  }

  function selectStyle(id) {
    if (!styles[id]) return;
    S.styleId = id;
    $$('.style-card').forEach(c => c.classList.toggle('on', c.dataset.id === id));
    loadFont(style());
    rebuild();
    syncStyleEditor();
    saveSession();
    markDirty();
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
          styles[id] = Object.assign({}, st, { id, name: st.name + ' (copia)', custom: true });
          saveStyles();
          buildStyleGallery();
          selectStyle(id);
          toast('Estilo duplicado. ¡Modifícalo a tu gusto!', 'ok');
          break;
        }
        case 'rename': {
          const name = window.prompt('Nuevo nombre del estilo:', st.name);
          if (name && name.trim()) { st.name = name.trim(); saveStyles(); buildStyleGallery(); }
          break;
        }
        case 'reset': {
          const preset = ST.PRESETS.find(p => p.id === st.id);
          if (!preset) { toast('Solo los estilos incluidos se pueden restablecer', 'warn'); return; }
          styles[st.id] = ST.make(preset);
          saveStyles();
          buildStyleGallery();
          selectStyle(st.id);
          toast('Estilo restablecido', 'ok');
          break;
        }
        case 'delete': {
          if (!st.custom) { toast('Los estilos incluidos no se pueden eliminar (puedes restablecerlos)', 'warn'); return; }
          if (!window.confirm(`¿Eliminar el estilo «${st.name}»?`)) return;
          delete styles[st.id];
          saveStyles();
          S.styleId = 'hormozi';
          buildStyleGallery();
          selectStyle(S.styleId);
          break;
        }
        case 'export': {
          const blob = new Blob([JSON.stringify(st, null, 2)], { type: 'application/json' });
          download(blob, `estilo-${st.name.replace(/[^\w-]+/g, '_')}.json`);
          break;
        }
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
        toast('Estilo importado', 'ok');
      } catch (err) {
        toast('El archivo no es un estilo válido', 'err');
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

  function loadFont(st) {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    const spec = `${st.italic ? 'italic ' : ''}${st.weight} 40px "${st.font}"`;
    return document.fonts.load(spec).then(() => { markDirty(); }).catch(() => {});
  }

  // ───────────── Carga de SRT ─────────────
  function loadSrtText(text, name) {
    const cues = cuesFromText(text);
    if (!cues.length) { toast('No se encontraron subtítulos en el archivo', 'err'); return; }
    snapshot();
    S.cues = cues;
    S.selection.clear();
    S.time = 0;
    onCuesReplaced();
    const words = cues.reduce((a, c) => a + c.words.length, 0);
    toast(`${name ? name + ': ' : ''}${cues.length} subtítulos · ${words} palabras`, 'ok');
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
  }

  // ───────────── Exportar ─────────────
  let cancelExport = false, exporting = false;

  async function refreshSeq(quiet) {
    const box = $('#seqInfo');
    if (!CEP.available) {
      box.innerHTML = '';
      const top = el('div', 'seq-top');
      top.appendChild(el('div', 'seq-name', 'Modo navegador'));
      box.appendChild(top);
      box.appendChild(el('p', null, 'Abre SubFX Studio desde Premiere Pro (Ventana → Extensiones → SubFX Studio) para insertar los subtítulos en tu secuencia. Aquí puedes diseñar y probar estilos.'));
      fillTracks();
      return null;
    }
    try {
      const info = await CEP.call('getSequenceInfo');
      S.seq = info && info.ok ? info : null;
      box.innerHTML = '';
      const top = el('div', 'seq-top');
      top.appendChild(el('div', 'seq-name', S.seq ? S.seq.name : 'Sin secuencia activa'));
      const btn = el('button', 'btn small', '↻ Actualizar');
      btn.addEventListener('click', () => refreshSeq());
      top.appendChild(btn);
      box.appendChild(top);
      if (S.seq) {
        const meta = el('div', 'seq-meta');
        meta.appendChild(el('span', null, `${S.seq.width} × ${S.seq.height}`));
        meta.appendChild(el('span', null, `${S.seq.fps} fps`));
        meta.appendChild(el('span', null, `${S.seq.tracks.length} pistas de vídeo`));
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
    const sel = $('#expTrack');
    sel.innerHTML = '';
    const add = (v, t) => { const o = el('option', null, t); o.value = v; sel.appendChild(o); };
    add(-1, '➕ Nueva pista encima de todo');
    const tracks = S.seq ? S.seq.tracks : [{ index: 0, name: 'V1' }, { index: 1, name: 'V2' }, { index: 2, name: 'V3' }];
    tracks.forEach(t => add(t.index, `V${t.index + 1}${t.name && t.name !== 'V' + (t.index + 1) ? ' · ' + t.name : ''}${t.clips ? ` (${t.clips} clips)` : ' (vacía)'}`));
    sel.value = String(S.settings.track);
    if (sel.selectedIndex < 0) sel.value = '-1';
  }

  function bindExport() {
    const s = S.settings;
    $('#expFormat').value = s.format;
    $('#expFps').value = s.fps;
    $('#expStart').value = s.startMode;
    $('#expDir').value = s.outDir;
    const off = $('#expOffset');
    off.value = s.offset;
    updateRangeFill(off);
    $('#expOffsetOut').textContent = s.offset + ' ms';

    $('#expFormat').addEventListener('change', e => { s.format = e.target.value; fitStage(); saveSession(); });
    $('#expFps').addEventListener('change', e => { s.fps = e.target.value; saveSession(); });
    $('#expTrack').addEventListener('change', e => { s.track = +e.target.value; saveSession(); });
    $('#expStart').addEventListener('change', e => { s.startMode = e.target.value; saveSession(); });
    $('#expDir').addEventListener('change', e => { s.outDir = e.target.value.trim(); saveSession(); });
    off.addEventListener('input', () => {
      s.offset = +off.value;
      updateRangeFill(off);
      $('#expOffsetOut').textContent = s.offset + ' ms';
      saveSession();
    });
    $('#btnDir').addEventListener('click', () => {
      if (!CEP.available) { toast('Disponible dentro de Premiere Pro', 'warn'); return; }
      const dir = CEP.pickFolder('Carpeta de renderizado de SubFX', s.outDir || CEP.systemPath('myDocuments'));
      if (dir) { s.outDir = dir; $('#expDir').value = dir; saveSession(); }
    });
    $('#btnExport').addEventListener('click', runExport);
    $('#btnExportTop').addEventListener('click', () => { switchTab('export'); runExport(); });
    $('#btnCancel').addEventListener('click', () => { cancelExport = true; });
    $('#btnFrame').addEventListener('click', () => {
      const { W, H } = frameSize();
      const cv = el('canvas');
      cv.width = W;
      cv.height = H;
      R.renderFrame(cv.getContext('2d'), W, H, chunks, S.time, style());
      cv.toBlob(b => download(b, `subfx_${fmtTime(S.time).replace(/[:.]/g, '-')}.png`), 'image/png');
    });
  }

  async function runExport() {
    if (exporting) return;
    if (!S.cues.length) { toast('Carga primero un archivo .srt', 'warn'); return; }
    if (!CEP.available) {
      toast('Para insertar en la línea de tiempo abre el panel dentro de Premiere Pro. Aquí puedes descargar fotogramas PNG.', 'warn', 4500);
      return;
    }
    if (!CEP.canWrite) { toast('El panel no tiene acceso al disco (revisa la instalación).', 'err'); return; }
    const seq = await refreshSeq(true);
    if (!seq) { toast('Abre una secuencia en Premiere antes de exportar', 'err'); return; }

    const s = S.settings;
    const { W, H } = frameSize();
    const fps = s.fps === 'auto' ? (seq.fps || 30) : +s.fps;
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
    const baseDir = (s.outDir || (CEP.systemPath('myDocuments') + '/SubFX Renders')).replace(/\/+$/, '');
    const outDir = baseDir + '/' + stamp;
    const startAt = (s.startMode === 'playhead' ? seq.playhead : 0) + s.offset / 1000;

    exporting = true;
    cancelExport = false;
    $('#btnExport').disabled = true;
    $('#btnExportTop').disabled = true;
    $('#expProgress').hidden = false;
    const bar = $('#expBar'), status = $('#expStatus');
    bar.style.width = '0%';
    setPlaying(false);
    const t0 = performance.now();

    try {
      await loadFont(style());
      const res = await EXP.render({
        chunks, style: style(), W, H, fps, outDir,
        isCancelled: () => cancelExport,
        onProgress: (done, total, label) => {
          const p = done / total;
          bar.style.width = (p * 100).toFixed(1) + '%';
          const el2 = (performance.now() - t0) / 1000;
          const eta = p > 0.02 ? Math.max(0, el2 / p - el2) : 0;
          status.textContent = `Renderizando ${done}/${total}${eta ? ` · ~${Math.ceil(eta)} s` : ''}${label ? ' · ' + label.slice(0, 24) : ''}`;
        }
      });
      status.textContent = 'Insertando en la línea de tiempo…';
      const payload = {
        binName: 'SubFX ' + stamp,
        fps,
        trackIndex: s.track,
        items: res.items.map(it => ({ path: it.path, start: Math.max(0, it.start + startAt), name: it.name }))
      };
      const out = await CEP.call('importAndPlace', payload);
      if (!out || !out.ok) throw new Error((out && out.error) || 'Premiere no respondió');
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      status.textContent = `Listo: ${out.placed} clips en V${out.trackIndex + 1} (${secs} s)`;
      bar.style.width = '100%';
      toast(`✓ ${out.placed} subtítulos insertados en V${out.trackIndex + 1}`, 'ok', 4000);
      (out.warnings || []).forEach(w => toast(w, 'warn', 5000));
      refreshSeq(true);
    } catch (err) {
      if (err.message === 'CANCELLED') {
        status.textContent = 'Exportación cancelada';
        toast('Exportación cancelada', 'warn');
      } else {
        status.textContent = 'Error: ' + err.message;
        toast('Error al exportar: ' + err.message, 'err', 6000);
      }
    } finally {
      exporting = false;
      $('#btnExport').disabled = false;
      $('#btnExportTop').disabled = false;
    }
  }

  // ───────────── Pestañas y teclado ─────────────
  function switchTab(name) {
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
    if (name === 'style') Object.keys(styles).forEach(renderStyleThumb);
    if (name === 'export') refreshSeq(true);
  }

  function bindKeys() {
    document.addEventListener('keydown', e => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.target.isContentEditable) return;
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
    if (!loadSession()) S.cues = cuesFromText(SRT.SAMPLE);
    indexWords();
    rebuild();

    const pill = $('#connPill');
    pill.classList.add(CEP.available ? 'ok' : 'web');
    pill.querySelector('span').textContent = CEP.available ? 'Premiere Pro conectado' : 'Modo navegador';
    CEP.registerKeys();

    renderCueList();
    renderTimelineCues();
    buildFxPanel();
    buildStyleEditor();
    buildStyleGallery();
    bindStyles();
    bindCueList();
    bindTimeline();
    bindLoading();
    bindExport();
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
      document.fonts.ready.then(refreshFonts);
      document.fonts.addEventListener && document.fonts.addEventListener('loadingdone', refreshFonts);
    }
    fitStage();
    S.time = 1.2;
    requestAnimationFrame(tick);
  }

  init();
})();
