/*
 * SubFX Studio — Motor de render.
 *
 * Convierte los subtítulos (cues) en "bloques" (chunks) con tiempos por
 * palabra y los dibuja sobre un canvas 2D. El mismo código se usa para la
 * vista previa y para exportar la secuencia PNG que se inserta en Premiere.
 */
(function (root) {
  'use strict';

  const FX = root.SubFX_Effects;
  const clamp = FX.clamp;
  const REF = 1080;          // lado corto de referencia
  const CUE_IN = 0.2;        // duración de la animación de entrada del bloque
  const CUE_OUT = 0.15;      // duración del fundido de salida
  const HL_EASE = 0.15;      // duración del escalado de la palabra activa

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

  // ───────────── Tiempos ─────────────
  /** Reparte la duración del subtítulo entre sus palabras según su longitud. */
  function timeCue(cue) {
    const words = cue.words;
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

  /** Divide cada subtítulo en bloques de como máximo `style.maxWords` palabras (equilibrados). */
  function buildChunks(cues, style, offset) {
    offset = offset || 0;
    const out = [];
    cues.forEach(cue => {
      const n = cue.words.length;
      if (!n) return;
      const times = timeCue(cue);
      let size = n;
      if (style.maxWords > 0 && n > style.maxWords) {
        const groups = Math.ceil(n / style.maxWords);
        size = Math.ceil(n / groups);
      }
      for (let i = 0; i < n; i += size) {
        const last = i + size >= n;
        const words = cue.words.slice(i, i + size).map((w, k) => ({
          ref: w, ws: times[i + k].ws + offset, we: times[i + k].we + offset
        }));
        words[words.length - 1].we = last ? cue.end + offset : times[i + size].ws + offset;
        out.push({
          id: cue.id + ':' + i,
          cueId: cue.id,
          start: (i === 0 ? cue.start : times[i].ws) + offset,
          end: last ? cue.end + offset : times[i + size].ws + offset,
          words
        });
      }
    });
    out.sort((a, b) => a.start - b.start);
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
      const text = applyCase(w.ref.text, style.case);
      return { w, ov, fs, text, width: measure(ctx, text, fs, style.letterSpacing) };
    });

    const maxW = W * style.maxWidth / 100;
    const lines = [];
    let line = null;
    items.forEach(it => {
      if (!line || (line.items.length && line.width + gap + it.width > maxW)) {
        line = { items: [], width: 0, fs: 0 };
        lines.push(line);
      }
      line.width += (line.items.length ? gap : 0) + it.width;
      line.fs = Math.max(line.fs, it.fs);
      line.items.push(it);
    });

    const totalH = lines.reduce((a, l) => a + l.fs * style.lineHeight, 0);
    const cx = W * style.posX / 100;
    const cy = H * style.posY / 100;
    let y = cy - totalH / 2;
    let minX = Infinity, maxX = -Infinity;
    lines.forEach(l => {
      const lh = l.fs * style.lineHeight;
      l.y = y + lh / 2;
      l.h = lh;
      let x = cx - l.width / 2;
      l.x = x;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + l.width);
      l.items.forEach(it => {
        it.x = x + it.width / 2;
        it.y = l.y;
        x += it.width + gap;
      });
      y += lh;
    });

    return { items, lines, u, cx, cy, bounds: { x: minX, y: cy - totalH / 2, w: maxX - minX, h: totalH } };
  }

  function cueTransform(style, rel, remain) {
    const r = { s: 1, dy: 0, alpha: 1 };
    const x = rel / CUE_IN;
    if (x < 1) {
      switch (style.cueIn) {
        case 'fade': r.alpha = FX.ease.cubic(x); break;
        case 'pop': r.s = 0.6 + 0.4 * FX.ease.back(x); r.alpha = clamp(x * 3); break;
        case 'zoom': r.s = 1 + 0.4 * (1 - FX.ease.cubic(x)); r.alpha = FX.ease.cubic(x); break;
        case 'slide': r.dy = 0.5 * (1 - FX.ease.cubic(x)); r.alpha = FX.ease.cubic(x); break;
      }
    }
    if (style.cueOut && remain < CUE_OUT) r.alpha *= clamp(remain / CUE_OUT);
    return r;
  }

  // ───────────── Dibujo ─────────────
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
    const k = Math.max(0.05, Math.abs(T.sx * hs)); // las sombras no siguen la matriz

    ctx.font = fontStr(st, fs);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;

    let text = o.text;
    if (T.reveal < 1) {
      const chars = Array.from(text);
      text = chars.slice(0, Math.ceil(chars.length * T.reveal)).join('');
    }
    const width = o.width;
    const x0 = -width / 2;
    const y0 = fs * 0.04;
    const padX = fs * 0.14;

    // Cajas detrás de la palabra
    if (o.box) {
      ctx.fillStyle = o.box;
      roundRect(ctx, x0 - padX, -fs * 0.6, width + padX * 2, fs * 1.2, fs * 0.2);
      ctx.fill();
    }
    if (T.box && T.box.p > 0) {
      ctx.fillStyle = T.box.color;
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

    // Resplandor
    const glow = (st.glow || 0) * u + (T.glow || 0) * fs;
    if (glow > 0.5) {
      const gc = T.glowColor || st.glowColor;
      ctx.shadowColor = gc;
      ctx.shadowBlur = glow * k;
      ctx.fillStyle = gc;
      run(ctx, text, x0, y0, ls, fs);
      run(ctx, text, x0, y0, ls, fs);
    }

    // Sombra + contorno
    const sw = (st.strokeWidth || 0) * u;
    const hasShadow = st.shadowOpacity > 0 && (st.shadowBlur > 0 || st.shadowX || st.shadowY);
    if (hasShadow) {
      ctx.shadowColor = rgba(st.shadowColor, st.shadowOpacity);
      ctx.shadowBlur = st.shadowBlur * u * k;
      ctx.shadowOffsetX = st.shadowX * u * k;
      ctx.shadowOffsetY = st.shadowY * u * k;
    } else {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
    }
    if (sw > 0) {
      ctx.strokeStyle = st.strokeColor;
      ctx.lineWidth = sw * 2;
      run(ctx, text, x0, y0, ls, fs, true);
    } else if (hasShadow) {
      ctx.fillStyle = st.shadowColor;
      run(ctx, text, x0, y0, ls, fs);
    }
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = ctx.shadowOffsetY = 0;

    // Separación RGB (glitch)
    if (T.split > 0) {
      const d = T.split * fs;
      ctx.globalAlpha *= 0.85;
      ctx.fillStyle = '#FF1F5A';
      run(ctx, text, x0 - d, y0, ls, fs);
      ctx.fillStyle = '#00E5FF';
      run(ctx, text, x0 + d, y0, ls, fs);
      ctx.globalAlpha /= 0.85;
    }

    // Relleno
    let paint = o.fill;
    if (T.flash > 0 && T.flashColor) paint = mix(o.fill, T.flashColor, clamp(T.flash));
    if (T.rainbow != null) {
      const g = ctx.createLinearGradient(x0, 0, x0 + width, 0);
      for (let i = 0; i <= 6; i++) {
        g.addColorStop(i / 6, `hsl(${(T.rainbow * 120 + i * 60) % 360},95%,62%)`);
      }
      paint = g;
    } else if (o.fill2 && !(T.flash > 0)) {
      const g = ctx.createLinearGradient(0, -fs * 0.45, 0, fs * 0.45);
      g.addColorStop(0, o.fill);
      g.addColorStop(1, o.fill2);
      paint = g;
    }
    ctx.fillStyle = paint;
    run(ctx, text, x0, y0, ls, fs);

    ctx.restore();
  }

  function phaseOf(w, t) { return t < w.ws ? 0 : (t < w.we ? 1 : 2); }

  function renderChunk(ctx, W, H, chunk, t, style) {
    const L = layout(ctx, chunk, style, W, H, t);
    const CA = cueTransform(style, t - chunk.start, chunk.end - t);
    if (CA.alpha <= 0) return;

    ctx.save();
    ctx.globalAlpha = CA.alpha;
    ctx.translate(L.cx, L.cy + CA.dy * style.size * L.u);
    ctx.scale(CA.s, CA.s);
    ctx.translate(-L.cx, -L.cy);

    // Fondo
    if (style.bg !== 'none' && L.items.length) {
      const pad = style.bgPad * L.u;
      ctx.fillStyle = rgba(style.bgColor, style.bgOpacity);
      const rects = style.bg === 'block'
        ? [L.bounds]
        : L.lines.map(l => ({ x: l.x, y: l.y - l.h / 2, w: l.width, h: l.h }));
      rects.forEach(r => {
        roundRect(ctx, r.x - pad, r.y - pad * 0.6, r.w + pad * 2, r.h + pad * 1.2, style.bgRadius * L.u);
        ctx.fill();
      });
    }

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
      let hs = 1, box = null;
      const hl = style.hlMode === 'current' ? phase === 1 : style.hlMode === 'spoken' ? phase >= 1 : false;
      if (hl) {
        fill = style.hlColor;
        fill2 = null;
        if (phase === 1 && style.hlScale !== 1) {
          hs = 1 + (style.hlScale - 1) * FX.ease.back((t - w.ws) / HL_EASE);
        }
        if (style.hlBox && phase === 1) box = style.hlBoxColor;
      }
      if (ov.color) { fill = ov.color; fill2 = null; }

      drawWord(ctx, {
        text: it.text, x: it.x, y: it.y, fs: it.fs, width: it.width,
        fill, fill2, style, T, hs, box, vis, u: L.u
      });
    });
    ctx.restore();
  }

  function renderFrame(ctx, W, H, chunks, t, style) {
    const ch = findChunk(chunks, t);
    if (ch) renderChunk(ctx, W, H, ch, t, style);
    return ch;
  }

  /**
   * Clave que identifica el aspecto de un fotograma. Si dos fotogramas
   * consecutivos tienen la misma clave (no nula) son idénticos y el
   * exportador reutiliza el PNG ya codificado.
   */
  function frameKey(chunk, t, style) {
    const rel = t - chunk.start;
    if (style.cueIn !== 'none' && rel < CUE_IN) return null;
    if (style.cueOut && chunk.end - t < CUE_OUT) return null;
    let key = chunk.id + '|';
    if (style.reveal === 'single') key += currentIndex(chunk.words, t) + '|';
    for (const w of chunk.words) {
      const ov = w.ref.ovr || {};
      const phase = phaseOf(w, t);
      if (phase === 1 && style.hlMode !== 'none' && style.hlScale !== 1 && t - w.ws < HL_EASE) return null;
      const fx = FX.get(ov.fx || style.wordFx);
      const lt = (t - w.ws) * (ov.speed || 1);
      if (fx && !FX.isSettled(fx, lt)) return null;
      key += phase + (lt < 0 ? 'a' : 'b');
    }
    return key;
  }

  root.SubFX_Renderer = {
    REF, buildChunks, findChunk, renderChunk, renderFrame, frameKey,
    drawWord, fontStr, measure, applyCase, rgba
  };
})(window);
