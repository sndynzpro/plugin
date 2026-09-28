/*
 * SubtitleEngine Pro — Motor de render (módulos 03, 03B y 08).
 *
 * Convierte los subtítulos (cues) en "bloques" (chunks) con tiempos por
 * palabra y los dibuja sobre un canvas 2D. El mismo código se usa para la
 * vista previa y para exportar los PNG que se insertan en Premiere.
 */
(function (root) {
  'use strict';

  const FX = root.SubFX_Effects;
  const clamp = FX.clamp;
  const REF = 1080;          // lado corto de referencia
  const CUE_OUT = 0.15;      // duración del fundido de salida
  const HL_EASE = 0.15;      // duración del escalado de la palabra activa
  const OFF = 20000;         // desplazamiento para dibujar solo la sombra
  const CUE_DUR = { none: 0, pop: 0.2, fade: 0.2, zoom: 0.2, slide: 0.2, bounce: 0.5, glitch: 0.3 };

  const rand = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  // ───────────── Utilidades de color ─────────────
  function hexToRgb(hex) {
    let h = String(hex || '#000').replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgba = (hex, a) => {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  };
  const mix = (a, b, t) => {
    const A = hexToRgb(a), B = hexToRgb(b);
    const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  };

  function applyCase(text, mode) {
    if (mode === 'upper') return text.toLocaleUpperCase();
    if (mode === 'lower') return text.toLocaleLowerCase();
    if (mode === 'title') return text.charAt(0).toLocaleUpperCase() + text.slice(1).toLocaleLowerCase();
    return text;
  }

  /** keep: tal cual · soft: quita , . ; : … (deja ¿? ¡!) · all: quita toda la puntuación. */
  function cleanPunct(text, mode) {
    if (!mode || mode === 'keep') return text;
    if (mode === 'soft') return text.replace(/[.,;:…]+/g, '') || text;
    return text.replace(/[^\p{L}\p{N}'’%$€#@+\-]/gu, '') || text;
  }

  const fontStr = (st, px) =>
    `${st.italic ? 'italic ' : ''}${st.weight} ${px.toFixed(2)}px "${st.font}", "Arial Black", Arial, sans-serif`;

  function measure(ctx, text, fs, ls) {
    const w = ctx.measureText(text).width;
    return ls ? w + ls * fs * Math.max(0, Array.from(text).length - 1) : w;
  }

  function run(ctx, text, x, y, ls, fs, stroke) {
    if (!ls) {
      if (stroke) ctx.strokeText(text, x, y); else ctx.fillText(text, x, y);
      return;
    }
    let cx = x;
    for (const ch of text) {
      if (stroke) ctx.strokeText(ch, cx, y); else ctx.fillText(ch, cx, y);
      cx += ctx.measureText(ch).width + ls * fs;
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Caja de fondo (sólida o glass). b = { fill, glass, border, shine } */
  function paintBox(ctx, x, y, w, h, r, b, lw) {
    roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = b.fill;
    ctx.fill();
    if (!b.glass) return;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, `rgba(255,255,255,${b.shine || 0})`);
    g.addColorStop(0.55, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fill();
    if (b.border > 0) {
      ctx.lineWidth = Math.max(1, lw || 1.5);
      ctx.strokeStyle = `rgba(255,255,255,${b.border})`;
      ctx.stroke();
    }
  }

  function boxOf(style) {
    return { fill: rgba(style.bgColor, style.bgOpacity), glass: !!style.bgGlass, border: style.glassBorder, shine: style.glassShine };
  }

  // Lienzo auxiliar reutilizable (sombras múltiples y contorno interior)
  let spriteCanvas = null;
  function sprite(w, h) {
    if (!spriteCanvas) spriteCanvas = document.createElement('canvas');
    const c = spriteCanvas;
    if (c.width < w || c.height < h) { c.width = Math.max(c.width, w); c.height = Math.max(c.height, h); }
    const x = c.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'source-over';
    x.clearRect(0, 0, c.width, c.height);
    return { c, x };
  }

  // ───────────── Tiempos ─────────────
  /** Reparte la duración del subtítulo entre sus palabras según su longitud. */
  /**
   * Tiempo de cada palabra. Si el subtítulo trae tiempos reales (Whisper JSON:
   * w.t0), se usan; si no, se reparte la duración según la longitud de cada palabra.
   */
  function timeCue(cue) {
    const words = cue.words;
    if (words.some(w => typeof w.t0 === 'number')) {
      // Tiempos reales; las palabras sin tiempo (editadas después) se interpolan entre sus vecinas
      const st = words.map(w => (typeof w.t0 === 'number' ? Math.min(cue.end, Math.max(cue.start, w.t0)) : null));
      for (let i = 0; i < st.length; i++) {
        if (st[i] != null) continue;
        let j = i;
        while (j < st.length && st[j] == null) j++;
        const a = i === 0 ? cue.start : st[i - 1], b = j < st.length ? st[j] : cue.end;
        for (let k = i; k < j; k++) st[k] = a + (b - a) * (k - i + (i === 0 ? 0 : 1)) / (j - i + (i === 0 ? 0 : 1));
        i = j;
      }
      return st.map((ws, i) => ({ ws, we: i === st.length - 1 ? cue.end : Math.max(ws + 0.01, st[i + 1]) }));
    }
    const weights = words.map(w => Math.max(2, w.text.replace(/[^\p{L}\p{N}]/gu, '').length) + 1.5);
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    const dur = cue.end - cue.start;
    let acc = cue.start;
    return weights.map((wt, i) => {
      const ws = acc;
      acc += dur * wt / total;
      return { ws, we: i === words.length - 1 ? cue.end : acc };
    });
  }

  const charLen = w => Array.from(String(w.text || '')).length;

  /**
   * Agrupa las palabras de un subtítulo en bloques respetando:
   * palabras por bloque, caracteres por bloque, líneas por bloque,
   * palabras/caracteres por línea, saltos de línea forzados (ovr.br)
   * y cortes de bloque forzados (ovr.cut). Devuelve [[inicio, fin)].
   */
  function groupWords(words, style) {
    const n = words.length;
    const mw = style.maxWords | 0, mc = style.maxChars | 0, ml = style.maxLines | 0;
    const wl = style.maxWordsLine | 0, cl = style.maxCharsLine | 0;
    const forced = words.some(w => w.ovr && (w.ovr.cut || w.ovr.br));
    if (!mc && !ml && !forced) {
      // Solo palabras por bloque: bloques equilibrados (4+3 mejor que 6+1)
      const groups = mw > 0 ? Math.ceil(n / mw) : 1;
      const base = Math.floor(n / groups), extra = n % groups;
      const out = [];
      for (let g = 0, i = 0; g < groups; g++) {
        const size = base + (g < extra ? 1 : 0);
        out.push([i, i + size]);
        i += size;
      }
      return out;
    }
    const out = [];
    let cur = null;
    words.forEach((w, i) => {
      const ov = w.ovr || {}, len = charLen(w);
      const newLine = cur && (ov.br || (wl && cur.lw >= wl) || (cl && cur.lc + 1 + len > cl));
      const close = !cur || ov.cut || (mw && cur.n >= mw) || (mc && cur.chars + 1 + len > mc) ||
        (ml && cur.lines + (newLine ? 1 : 0) > ml);
      if (close) {
        if (cur) cur.end = i;
        cur = { start: i, end: n, n: 0, chars: -1, lines: 1, lw: 0, lc: -1 };
        out.push(cur);
      } else if (newLine) {
        cur.lines++; cur.lw = 0; cur.lc = -1;
      }
      cur.n++; cur.chars += 1 + len; cur.lw++; cur.lc += 1 + len;
    });
    return out.map(g => [g.start, g.end]);
  }

  /** Divide los subtítulos en bloques y aplica las reglas de duración del estilo. */
  function buildChunks(cues, style, offset) {
    offset = offset || 0;
    const out = [];
    cues.forEach(cue => {
      const n = cue.words.length;
      if (!n) return;
      const times = timeCue(cue);
      groupWords(cue.words, style).forEach(([a, z], gi, groups) => {
        const last = gi === groups.length - 1;
        const words = cue.words.slice(a, z).map((w, k) => ({
          ref: w, ws: times[a + k].ws + offset, we: times[a + k].we + offset
        }));
        const end = last ? cue.end + offset : times[z].ws + offset;
        words[words.length - 1].we = end;
        out.push({
          id: cue.id + ':' + a,
          cueId: cue.id,
          layer: cue.layer || 0,
          start: (gi === 0 ? cue.start : times[a].ws) + offset,
          end,
          words
        });
      });
    });
    out.sort((a, b) => a.start - b.start);
    // Duración mínima y relleno de huecos cortos (evita parpadeos entre bloques)
    const minD = +style.minChunk || 0, hold = +style.holdGap || 0;
    if (minD || hold) {
      out.forEach((c, i) => {
        const next = out[i + 1];
        if (minD && c.end - c.start < minD) c.end = next ? Math.max(c.end, Math.min(c.start + minD, next.start)) : c.start + minD;
        if (hold && next && next.start > c.end && next.start - c.end <= hold) c.end = next.start;
        c.words[c.words.length - 1].we = Math.max(c.words[c.words.length - 1].we, c.end);
      });
    }
    return out;
  }

  function findChunk(chunks, t) {
    let lo = 0, hi = chunks.length - 1, idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (chunks[mid].start <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    for (let i = idx; i >= 0 && i > idx - 4; i--) {
      if (t >= chunks[i].start && t < chunks[i].end) return chunks[i];
    }
    return null;
  }

  function currentIndex(words, t) {
    let idx = 0;
    for (let i = 0; i < words.length; i++) if (words[i].ws <= t) idx = i;
    return idx;
  }

  // ───────────── Maquetación ─────────────
  function layout(ctx, chunk, style, W, H, t) {
    const u = Math.min(W, H) / REF;
    let words = chunk.words;
    if (style.reveal === 'single') words = [words[currentIndex(words, t)]];

    const baseFs = style.size * u;
    ctx.font = fontStr(style, baseFs);
    const gap = baseFs * (style.wordGap == null ? 0.32 : style.wordGap) + (style.letterSpacing || 0) * baseFs;

    const items = words.map(w => {
      const ov = w.ref.ovr || {};
      const fs = baseFs * (ov.scale || 1);
      ctx.font = fontStr(style, fs);
      const text = applyCase(cleanPunct(w.ref.text, style.punct), style.case);
      return { w, ov, fs, text, width: measure(ctx, text, fs, style.letterSpacing) };
    });

    const side = (style.safeSide || 0) * u;
    const maxW = Math.min(W * style.maxWidth / 100, W - side * 2);
    const lines = [];
    let line = null;
    const wl = style.maxWordsLine | 0, cl = style.maxCharsLine | 0;
    items.forEach(it => {
      const len = Array.from(it.text).length;
      const brk = line && line.items.length && (
        it.ov.br || (wl && line.items.length >= wl) || (cl && line.chars + 1 + len > cl) ||
        line.width + gap + it.width > maxW);
      if (!line || brk) {
        line = { items: [], width: 0, fs: 0, chars: -1 };
        lines.push(line);
      }
      line.chars += 1 + len;
      line.width += (line.items.length ? gap : 0) + it.width;
      line.fs = Math.max(line.fs, it.fs);
      line.items.push(it);
    });

    const totalH = lines.reduce((a, l) => a + l.fs * style.lineHeight, 0);
    const ax = W * style.posX / 100;
    let y0 = H * style.posY / 100 - totalH / 2;

    // Zona segura vertical
    const top = (style.safeTop || 0) * u, bottom = H - (style.safeBottom || 0) * u;
    if (y0 + totalH > bottom) y0 = bottom - totalH;
    if (y0 < top) y0 = top;

    const lineX = l => style.align === 'left' ? ax : style.align === 'right' ? ax - l.width : ax - l.width / 2;
    let minX = Infinity, maxX = -Infinity;
    lines.forEach(l => { minX = Math.min(minX, lineX(l)); maxX = Math.max(maxX, lineX(l) + l.width); });
    // Zona segura horizontal
    let dx = 0;
    if (maxX > W - side) dx = W - side - maxX;
    if (minX + dx < side) dx = side - minX;

    let y = y0;
    lines.forEach(l => {
      const lh = l.fs * style.lineHeight;
      l.y = y + lh / 2;
      l.h = lh;
      let x = lineX(l) + dx;
      l.x = x;
      l.items.forEach(it => {
        it.x = x + it.width / 2;
        it.y = l.y;
        x += it.width + gap;
      });
      y += lh;
    });

    const bounds = { x: minX + dx, y: y0, w: maxX - minX, h: totalH };
    return { items, lines, u, cx: bounds.x + bounds.w / 2, cy: y0 + totalH / 2, bounds };
  }

  function cueInDur(style, chunk) {
    if (style.cueIn === 'typewriter') return clamp((chunk.end - chunk.start) * 0.45, 0.2, 0.8);
    return CUE_DUR[style.cueIn] || 0;
  }

  function cueTransform(style, chunk, t) {
    const rel = t - chunk.start, remain = chunk.end - t;
    const r = { s: 1, dx: 0, dy: 0, alpha: 1, type: 1, split: 0 };
    const dur = cueInDur(style, chunk);
    const x = dur ? rel / dur : 1;
    if (x < 1) {
      switch (style.cueIn) {
        case 'fade': r.alpha = FX.ease.cubic(x); break;
        case 'pop': r.s = 0.6 + 0.4 * FX.ease.back(x); r.alpha = clamp(x * 3); break;
        case 'zoom': r.s = 1 + 0.4 * (1 - FX.ease.cubic(x)); r.alpha = FX.ease.cubic(x); break;
        case 'slide': r.dy = 0.5 * (1 - FX.ease.cubic(x)); r.alpha = FX.ease.cubic(x); break;
        case 'bounce': r.dy = -0.9 * (1 - FX.ease.bounce(x)); r.alpha = clamp(x * 6); break;
        case 'typewriter': r.type = clamp(x); break;
        case 'glitch': {
          const f = Math.floor(rel * 30);
          r.split = 0.07 * (1 - x);
          r.dx = (rand(f) - 0.5) * 0.25 * (1 - x);
          r.alpha = rand(f + 5) > 0.3 ? 1 : 0.35;
          break;
        }
      }
    }
    if (style.cueOut && remain < CUE_OUT) r.alpha *= clamp(remain / CUE_OUT);
    return r;
  }

  // ───────────── Dibujo ─────────────
  function shadowsOf(st) {
    const out = [];
    ['shadow', 'shadow2', 'shadow3'].forEach(p => {
      const op = st[p + 'Opacity'];
      if (!(op > 0)) return;
      const a = (st[p + 'Angle'] || 0) * Math.PI / 180, d = st[p + 'Dist'] || 0;
      out.push({ color: rgba(st[p + 'Color'], op), blur: st[p + 'Blur'] || 0, dx: Math.cos(a) * d, dy: Math.sin(a) * d });
    });
    return out;
  }

  function makePaint(c, st, o, T, x0, width, fs) {
    let paint = o.fill;
    if (T.flash > 0 && T.flashColor) paint = mix(o.fill, T.flashColor, clamp(T.flash));
    if (T.rainbow != null) {
      const g = c.createLinearGradient(x0, 0, x0 + width, 0);
      for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${(T.rainbow * 120 + i * 60) % 360},95%,62%)`);
      return g;
    }
    if (o.fill2 && !(T.flash > 0)) {
      let g;
      if (st.gradType === 'radial') {
        g = c.createRadialGradient(0, 0, 0, 0, 0, Math.max(width / 2, fs * 0.5));
      } else {
        const a = (st.gradAngle == null ? 90 : st.gradAngle) * Math.PI / 180;
        const dx = Math.cos(a), dy = Math.sin(a);
        const L = Math.abs(width / 2 * dx) + Math.abs(fs * 0.45 * dy) || 1;
        g = c.createLinearGradient(-dx * L, -dy * L, dx * L, dy * L);
      }
      g.addColorStop(0, o.fill);
      g.addColorStop(1, o.fill2);
      return g;
    }
    return paint;
  }

  /**
   * Dibuja una palabra centrada en (o.x, o.y).
   * o = { text, x, y, fs, width, fill, fill2, style, T, hs, box, vis, u }
   */
  function drawWord(ctx, o) {
    const T = o.T || FX.identity();
    const st = o.style;
    const alpha = clamp(T.alpha * (o.vis == null ? 1 : o.vis));
    if (alpha <= 0.001) return;
    const fs = o.fs, u = o.u, ls = st.letterSpacing || 0;
    const hs = o.hs || 1;

    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(o.x + T.dx * fs, o.y + T.dy * fs);
    if (T.rot) ctx.rotate(T.rot);
    if (T.skew) ctx.transform(1, 0, T.skew, 1, 0, 0);
    ctx.scale(T.sx * hs, T.sy * hs);
    const M = ctx.getTransform();
    const k = Math.max(0.05, Math.hypot(M.a, M.b)); // píxeles reales por unidad local

    const font = fontStr(st, fs);
    const join = st.strokeJoin || 'round';
    ctx.font = font;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.lineJoin = join;
    ctx.miterLimit = 2;

    let text = o.text;
    const reveal = Math.min(T.reveal, o.reveal == null ? 1 : o.reveal);
    if (reveal < 1) {
      const chars = Array.from(text);
      text = chars.slice(0, Math.ceil(chars.length * reveal - 1e-6)).join('');
    }
    const width = o.width;
    const x0 = -width / 2;
    const y0 = fs * 0.04;

    // Cajas detrás de la palabra
    if (o.box) {
      const b = o.box;
      paintBox(ctx, x0 - b.padX, -fs * 0.5 - b.padY, width + b.padX * 2, fs + b.padY * 2, b.r, b, u * 1.5);
    }
    if (T.box && T.box.p > 0) {
      ctx.fillStyle = T.box.color;
      const padX = fs * 0.14;
      roundRect(ctx, x0 - padX, -fs * 0.58, (width + padX * 2) * T.box.p, fs * 1.16, fs * 0.16);
      ctx.fill();
    }
    if (T.line && T.line.p > 0) {
      ctx.fillStyle = T.line.color;
      roundRect(ctx, x0, fs * 0.44, width * T.line.p, fs * 0.1, fs * 0.05);
      ctx.fill();
    }
    if (!text) { ctx.restore(); return; }
    if (T.blur > 0) ctx.filter = `blur(${(T.blur * fs).toFixed(1)}px)`;

    // Contornos (3 capas): extensión de cada una fuera del borde de la letra
    const align = st.strokeAlign || 'outside';
    const sw1 = (st.strokeWidth || 0) * u, sw2 = (st.stroke2Width || 0) * u, sw3 = (st.stroke3Width || 0) * u;
    const ext1 = sw1 <= 0 ? 0 : align === 'outside' ? sw1 : align === 'center' ? sw1 / 2 : 0;
    const ext2 = ext1 + Math.max(0, sw2);
    const ext3 = ext2 + Math.max(0, sw3);

    // Sombras múltiples: se rasteriza la silueta una vez y se proyecta cada sombra
    const shadows = shadowsOf(st);
    if (shadows.length) {
      const m = ext3 + 2;
      const lw = width + m * 2, lh = fs * 1.7 + m * 2;
      const pw = Math.ceil(lw * k), ph = Math.ceil(lh * k);
      const sp = sprite(pw, ph);
      sp.x.setTransform(k, 0, 0, k, (m - x0) * k, lh / 2 * k);
      sp.x.font = font;
      sp.x.textBaseline = 'middle';
      sp.x.lineJoin = join;
      sp.x.miterLimit = 2;
      sp.x.fillStyle = sp.x.strokeStyle = '#000';
      if (ext3 > 0) { sp.x.lineWidth = ext3 * 2; run(sp.x, text, x0, y0, ls, fs, true); }
      run(sp.x, text, x0, y0, ls, fs);
      shadows.forEach(s => {
        ctx.shadowColor = s.color;
        ctx.shadowBlur = s.blur * u * k;
        ctx.shadowOffsetX = s.dx * u * k + M.a * OFF;
        ctx.shadowOffsetY = s.dy * u * k + M.b * OFF;
        ctx.drawImage(sp.c, 0, 0, pw, ph, x0 - m - OFF, -lh / 2, lw, lh);
      });
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
    }

    // Resplandor
    const glow = (st.glow || 0) * u + (T.glow || 0) * fs;
    if (glow > 0.5) {
      const gc = T.glowColor || st.glowColor;
      ctx.shadowColor = gc;
      ctx.shadowBlur = glow * k;
      ctx.fillStyle = gc;
      run(ctx, text, x0, y0, ls, fs);
      run(ctx, text, x0, y0, ls, fs);
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
    }

    // Contornos exteriores (de fuera hacia dentro)
    if (sw3 > 0) { ctx.strokeStyle = st.stroke3Color; ctx.lineWidth = ext3 * 2; run(ctx, text, x0, y0, ls, fs, true); }
    if (sw2 > 0) { ctx.strokeStyle = st.stroke2Color; ctx.lineWidth = ext2 * 2; run(ctx, text, x0, y0, ls, fs, true); }
    if (sw1 > 0 && align === 'outside') { ctx.strokeStyle = st.strokeColor; ctx.lineWidth = sw1 * 2; run(ctx, text, x0, y0, ls, fs, true); }

    // Separación RGB (glitch)
    const split = (T.split || 0) + (o.split || 0);
    if (split > 0) {
      const d = split * fs;
      ctx.globalAlpha *= 0.85;
      ctx.fillStyle = '#FF1F5A';
      run(ctx, text, x0 - d, y0, ls, fs);
      ctx.fillStyle = '#00E5FF';
      run(ctx, text, x0 + d, y0, ls, fs);
      ctx.globalAlpha /= 0.85;
    }

    // Relleno (+ contorno interior o centrado)
    if (sw1 > 0 && align === 'inside') {
      const m = 2;
      const lw = width + m * 2, lh = fs * 1.7;
      const pw = Math.ceil(lw * k), ph = Math.ceil(lh * k);
      const sp = sprite(pw, ph);
      sp.x.setTransform(k, 0, 0, k, (m - x0) * k, lh / 2 * k);
      sp.x.font = font;
      sp.x.textBaseline = 'middle';
      sp.x.lineJoin = join;
      sp.x.fillStyle = makePaint(sp.x, st, o, T, x0, width, fs);
      run(sp.x, text, x0, y0, ls, fs);
      sp.x.globalCompositeOperation = 'source-atop';
      sp.x.strokeStyle = st.strokeColor;
      sp.x.lineWidth = sw1 * 2;
      run(sp.x, text, x0, y0, ls, fs, true);
      ctx.drawImage(sp.c, 0, 0, pw, ph, x0 - m, -lh / 2, lw, lh);
    } else {
      ctx.fillStyle = makePaint(ctx, st, o, T, x0, width, fs);
      run(ctx, text, x0, y0, ls, fs);
      if (sw1 > 0 && align === 'center') {
        ctx.strokeStyle = st.strokeColor;
        ctx.lineWidth = sw1;
        run(ctx, text, x0, y0, ls, fs, true);
      }
    }

    ctx.restore();
  }

  function phaseOf(w, t) { return t < w.ws ? 0 : (t < w.we ? 1 : 2); }

  function renderChunk(ctx, W, H, chunk, t, style) {
    const L = layout(ctx, chunk, style, W, H, t);
    const CA = cueTransform(style, chunk, t);
    const opacity = style.opacity == null ? 1 : style.opacity;
    if (CA.alpha * opacity <= 0) return;

    ctx.save();
    ctx.globalAlpha = CA.alpha * opacity;
    ctx.translate(L.cx + CA.dx * style.size * L.u, L.cy + CA.dy * style.size * L.u);
    ctx.scale(CA.s, CA.s);
    ctx.translate(-L.cx, -L.cy);

    // Fondo por bloque o por línea
    if ((style.bg === 'block' || style.bg === 'line') && L.items.length) {
      const px = (style.bgPadX == null ? 20 : style.bgPadX) * L.u;
      const py = (style.bgPadY == null ? 12 : style.bgPadY) * L.u;
      const rects = style.bg === 'block'
        ? [L.bounds]
        : L.lines.map(l => ({ x: l.x, y: l.y - l.h / 2, w: l.width, h: l.h }));
      const b = boxOf(style);
      rects.forEach(r => paintBox(ctx, r.x - px, r.y - py, r.w + px * 2, r.h + py * 2, style.bgRadius * L.u, b, 1.5 * L.u));
    }
    const wordBox = style.bg === 'word' ? Object.assign(boxOf(style), {
      padX: (style.bgPadX == null ? 20 : style.bgPadX) * L.u * 0.6,
      padY: (style.bgPadY == null ? 12 : style.bgPadY) * L.u * 0.6,
      r: style.bgRadius * L.u
    }) : null;

    // Máquina de escribir a nivel de bloque
    let charsLeft = Infinity;
    if (CA.type < 1) {
      const total = L.items.reduce((a, it) => a + Array.from(it.text).length, 0);
      charsLeft = CA.type * total;
    }

    const EM_POP = 0.18;
    let emIndex = 0;
    L.items.forEach(it => {
      const w = it.w, ov = it.ov;
      const phase = phaseOf(w, t);
      let vis = 1;
      if (phase === 0) {
        if (style.reveal === 'progressive') vis = 0;
        else if (style.reveal === 'all') vis = style.preAlpha;
      }

      const T = FX.identity();
      const fx = FX.get(ov.fx || style.wordFx);
      if (fx) {
        const k = ov.intensity == null ? 1 : ov.intensity;
        fx.apply(T, (t - w.ws) * (ov.speed || 1), k, ov.fxColor || fx.color);
      }

      let fill = style.color;
      let fill2 = style.gradient ? style.color2 : null;
      let hs = 1, box = wordBox;
      const hl = style.hlMode === 'current' ? phase === 1
        : style.hlMode === 'spoken' ? phase >= 1
          : style.hlMode === 'keyword' ? !!ov.key : false;
      if (hl) {
        fill = style.hlColor;
        fill2 = null;
        if (phase === 1 && style.hlScale !== 1 && style.hlMode !== 'keyword') {
          hs = 1 + (style.hlScale - 1) * FX.ease.back((t - w.ws) / HL_EASE);
        } else if (style.hlMode === 'keyword' && style.hlScale !== 1) {
          hs = style.hlScale;
        }
        if (style.hlBox && (phase === 1 || style.hlMode === 'keyword')) {
          box = { fill: style.hlBoxColor, padX: it.fs * 0.14, padY: it.fs * 0.1, r: it.fs * 0.2 };
        }
      }
      // Énfasis: caja negra con letra amarilla / caja amarilla con letra negra, intercaladas
      let wordStyle = style;
      const em = style.emMode !== 'none' && (ov.em || (style.emOnKey && ov.key));
      if (em) {
        const dark = style.emMode === 'dark' || (style.emMode === 'alternate' && emIndex % 2 === 0);
        emIndex++;
        fill = dark ? style.emColorA : style.emColorB;
        fill2 = null;
        box = {
          fill: dark ? style.emColorB : style.emColorA,
          padX: it.fs * (style.emPad == null ? 0.16 : style.emPad), padY: it.fs * 0.08, r: (style.emRadius || 0) * L.u
        };
        hs *= style.emScale || 1;
        if (style.emPop && phase === 1 && t - w.ws < EM_POP) hs *= 1 + 0.18 * FX.ease.bump((t - w.ws) / EM_POP);
      }
      // Caja propia de la palabra (color y ancho elegidos a mano)
      if (ov.boxColor) {
        box = { fill: ov.boxColor, padX: 0, padY: it.fs * 0.08, r: (style.emRadius == null ? 10 : style.emRadius) * L.u };
      }
      if (box && (em || ov.boxColor)) box.padX = it.fs * (ov.boxPad != null ? ov.boxPad : (style.emPad == null ? 0.16 : style.emPad));
      if ((em || ov.boxColor) && style.emPlain !== false) {
        wordStyle = Object.assign({}, style, {
          strokeWidth: 0, stroke2Width: 0, stroke3Width: 0, glow: 0,
          shadowOpacity: 0, shadow2Opacity: 0, shadow3Opacity: 0
        });
      }
      if (ov.color) { fill = ov.color; fill2 = null; }

      let reveal = 1;
      if (charsLeft !== Infinity) {
        const n = Array.from(it.text).length;
        reveal = clamp(charsLeft / n);
        charsLeft = Math.max(0, charsLeft - n);
      }

      drawWord(ctx, {
        text: it.text, x: it.x, y: it.y, fs: it.fs, width: it.width,
        fill, fill2, style: wordStyle, T, hs, box, vis, u: L.u, reveal, split: CA.split
      });
    });
    ctx.restore();
  }

  function renderFrame(ctx, W, H, chunks, t, style) {
    const ch = findChunk(chunks, t);
    if (ch) renderChunk(ctx, W, H, ch, t, style);
    return ch;
  }

  /** layers = [{ chunks, style }] — dibuja todas las líneas paralelas activas. */
  function renderLayers(ctx, W, H, layers, t) {
    const active = [];
    layers.forEach(l => {
      const ch = findChunk(l.chunks, t);
      if (ch) { renderChunk(ctx, W, H, ch, t, l.style); active.push(ch); }
    });
    return active;
  }

  /** ¿El aspecto de las palabras depende de si ya se han dicho? */
  function phaseMatters(style) {
    return style.reveal !== 'all' || style.preAlpha < 1 || style.hlMode === 'current' || style.hlMode === 'spoken';
  }

  /**
   * Clave que identifica el aspecto de un fotograma. Si dos fotogramas
   * tienen la misma clave (no nula) son idénticos y el exportador reutiliza
   * el PNG ya codificado. Si todo un bloque tiene la misma clave se exporta
   * como un único PNG estático.
   */
  function frameKey(chunk, t, style) {
    const rel = t - chunk.start;
    if (style.cueIn !== 'none' && rel < cueInDur(style, chunk)) return null;
    if (style.cueOut && chunk.end - t < CUE_OUT) return null;
    const pm = phaseMatters(style);
    let key = chunk.id + '|';
    if (style.reveal === 'single') key += currentIndex(chunk.words, t) + '|';
    for (const w of chunk.words) {
      const ov = w.ref.ovr || {};
      const phase = phaseOf(w, t);
      if (phase === 1 && (style.hlMode === 'current' || style.hlMode === 'spoken') && style.hlScale !== 1 && t - w.ws < HL_EASE) return null;
      if (style.emPop && style.emMode !== 'none' && (ov.em || (style.emOnKey && ov.key)) && t >= w.ws && t - w.ws < 0.18) return null;
      const fx = FX.get(ov.fx || style.wordFx);
      const lt = (t - w.ws) * (ov.speed || 1);
      if (fx && !FX.isSettled(fx, lt)) return null;
      key += (pm ? phase : '') + (fx ? (lt < 0 ? 'a' : 'b') : '');
    }
    return key;
  }

  root.SubFX_Renderer = {
    REF, buildChunks, groupWords, cleanPunct, findChunk, renderChunk, renderFrame, renderLayers, frameKey,
    drawWord, fontStr, measure, applyCase, rgba
  };
})(window);
