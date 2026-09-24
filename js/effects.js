/*
 * SubFX Studio — Banco de efectos por palabra.
 *
 * Cada efecto modifica un objeto de transformación (T) en función del tiempo
 * local de la palabra `t` (segundos desde que la palabra empieza a decirse,
 * ya multiplicado por la velocidad). Las distancias van en "em" (múltiplos
 * del tamaño de fuente) para que escalen con cualquier resolución.
 *
 * Categorías:
 *   in   → Entrada: la palabra está oculta hasta que se dice y entra animada.
 *   hit  → Énfasis: animación puntual en el momento en que se dice.
 *   loop → Continuo: animación permanente mientras el subtítulo está en pantalla.
 */
(function (root) {
  'use strict';

  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const TAU = Math.PI * 2;

  const Ease = {
    cubic: x => 1 - Math.pow(1 - clamp(x), 3),
    back: x => {
      x = clamp(x);
      const c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
    },
    elastic: x => {
      x = clamp(x);
      if (x === 0 || x === 1) return x;
      return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * (TAU / 3)) + 1;
    },
    bounce: x => {
      x = clamp(x);
      const n1 = 7.5625, d1 = 2.75;
      if (x < 1 / d1) return n1 * x * x;
      if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
      if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
      return n1 * (x -= 2.625 / d1) * x + 0.984375;
    },
    bump: x => (x <= 0 || x >= 1) ? 0 : Math.sin(Math.PI * x)
  };

  // Pseudoaleatorio determinista: el mismo fotograma siempre da el mismo resultado.
  const rand = n => {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  };

  function identity() {
    return {
      sx: 1, sy: 1, dx: 0, dy: 0, rot: 0, skew: 0, alpha: 1, blur: 0,
      glow: 0, glowColor: null, flash: 0, flashColor: null, reveal: 1,
      box: null, line: null, split: 0, rainbow: null
    };
  }

  const LIST = [
    // ───────────── Entrada ─────────────
    {
      id: 'pop', name: 'Pop', cat: 'in', dur: 0.35, color: '#FFE600',
      desc: 'Crece desde pequeño con rebote',
      apply(T, t, k) {
        if (t < 0) { T.alpha = 0; return; }
        const x = t / this.dur;
        const s = 1 - (1 - Ease.back(x)) * Math.min(0.95, 0.8 * k);
        T.sx *= s; T.sy *= s; T.alpha = clamp(x * 5);
      }
    },
    {
      id: 'bounce', name: 'Rebote', cat: 'in', dur: 0.6, color: '#FFE600',
      desc: 'Cae y rebota en su sitio',
      apply(T, t, k) {
        if (t < 0) { T.alpha = 0; return; }
        const x = t / this.dur;
        T.dy -= (1 - Ease.bounce(x)) * 1.2 * k;
        T.alpha = clamp(x * 8);
      }
    },
    {
      id: 'zoom', name: 'Zoom', cat: 'in', dur: 0.3, color: '#FFE600',
      desc: 'Entra desde muy grande',
      apply(T, t, k) {
        if (t < 0) { T.alpha = 0; return; }
        const x = t / this.dur;
        const s = 1 + (1 - Ease.cubic(x)) * 1.5 * k;
        T.sx *= s; T.sy *= s; T.alpha = Ease.cubic(x);
      }
    },
    {
      id: 'slide', name: 'Deslizar', cat: 'in', dur: 0.3, color: '#FFE600',
      desc: 'Sube suavemente desde abajo',
      apply(T, t, k) {
        if (t < 0) { T.alpha = 0; return; }
        const x = t / this.dur;
        T.dy += (1 - Ease.cubic(x)) * 0.8 * k;
        T.alpha = Ease.cubic(x);
      }
    },
    {
      id: 'drop', name: 'Caída', cat: 'in', dur: 0.45, color: '#FFE600',
      desc: 'Cae desde arriba con giro',
      apply(T, t, k) {
        if (t < 0) { T.alpha = 0; return; }
        const x = t / this.dur;
        T.dy -= (1 - Ease.back(x)) * 1.0 * k;
        T.rot += (1 - Ease.cubic(x)) * 0.3 * k;
        T.alpha = clamp(x * 5);
      }
    },
    {
      id: 'fade', name: 'Fundido', cat: 'in', dur: 0.4, color: '#FFE600',
      desc: 'Aparece con transparencia',
      apply(T, t) {
        if (t < 0) { T.alpha = 0; return; }
        T.alpha = Ease.cubic(t / this.dur);
      }
    },
    {
      id: 'blur', name: 'Desenfoque', cat: 'in', dur: 0.4, color: '#FFE600',
      desc: 'Pasa de borroso a nítido',
      apply(T, t, k) {
        if (t < 0) { T.alpha = 0; return; }
        const x = t / this.dur, e = Ease.cubic(x);
        T.blur += (1 - e) * 0.25 * k;
        const s = 1 + (1 - e) * 0.15;
        T.sx *= s; T.sy *= s; T.alpha = clamp(x * 2);
      }
    },
    {
      id: 'spinIn', name: 'Giro', cat: 'in', dur: 0.45, color: '#FFE600',
      desc: 'Entra girando y creciendo',
      apply(T, t, k) {
        if (t < 0) { T.alpha = 0; return; }
        const x = t / this.dur, e = Ease.back(x);
        T.rot -= (1 - e) * 0.8 * k;
        const s = 0.3 + 0.7 * e;
        T.sx *= s; T.sy *= s; T.alpha = clamp(x * 4);
      }
    },
    {
      id: 'type', name: 'Máquina', cat: 'in', dur: 0.45, color: '#FFE600',
      desc: 'Letra por letra, como máquina de escribir',
      apply(T, t) {
        if (t < 0) { T.alpha = 0; return; }
        T.reveal = clamp(t / this.dur);
      }
    },
    {
      id: 'elastic', name: 'Elástico', cat: 'in', dur: 0.8, color: '#FFE600',
      desc: 'Se estira como goma',
      apply(T, t, k) {
        if (t < 0) { T.alpha = 0; return; }
        const x = t / this.dur, amt = Math.min(0.95, 0.9 * k);
        T.sx *= 1 - (1 - Ease.elastic(x)) * amt;
        T.sy *= 1 - (1 - Ease.elastic(clamp(x * 1.25))) * amt;
        T.alpha = clamp(x * 8);
      }
    },
    {
      id: 'flip', name: 'Voltear', cat: 'in', dur: 0.45, color: '#FFE600',
      desc: 'Se despliega verticalmente',
      apply(T, t) {
        if (t < 0) { T.alpha = 0; return; }
        const x = t / this.dur;
        T.sy *= Ease.back(x);
        T.alpha = clamp(x * 6);
      }
    },

    // ───────────── Énfasis ─────────────
    {
      id: 'punch', name: 'Golpe', cat: 'hit', dur: 0.35, color: '#FFE600',
      desc: 'Crece de golpe al decirse',
      apply(T, t, k) {
        const s = 1 + 0.45 * k * Ease.bump(t / this.dur);
        T.sx *= s; T.sy *= s;
      }
    },
    {
      id: 'shake', name: 'Temblor', cat: 'hit', dur: 0.5, color: '#FF3D3D',
      desc: 'Sacudida rápida',
      apply(T, t, k) {
        const x = t / this.dur;
        if (x < 0 || x > 1) return;
        const d = 1 - x;
        T.dx += Math.sin(t * 75) * 0.09 * k * d;
        T.rot += Math.sin(t * 55) * 0.05 * k * d;
      }
    },
    {
      id: 'jump', name: 'Salto', cat: 'hit', dur: 0.4, color: '#FFE600',
      desc: 'Salta hacia arriba',
      apply(T, t, k) {
        const b = Ease.bump(t / this.dur);
        T.dy -= 0.4 * k * b;
        T.sy *= 1 + 0.1 * k * b;
      }
    },
    {
      id: 'flash', name: 'Destello', cat: 'hit', dur: 0.6, color: '#FFFFFF',
      desc: 'Brilla con un destello de color',
      apply(T, t, k, color) {
        const x = t / this.dur;
        if (x < 0 || x > 1) return;
        const f = x < 0.15 ? x / 0.15 : 1 - (x - 0.15) / 0.85;
        T.flash = Math.max(T.flash, f);
        T.flashColor = color;
        T.glow += 0.5 * k * f;
        T.glowColor = color;
      }
    },
    {
      id: 'colorize', name: 'Colorear', cat: 'hit', dur: 0.25, color: '#FFE600',
      desc: 'Cambia de color al decirse y se queda',
      apply(T, t, k, color) {
        if (t < 0) return;
        T.flash = Ease.cubic(t / this.dur);
        T.flashColor = color;
      }
    },
    {
      id: 'spin', name: 'Girar 360', cat: 'hit', dur: 0.55, color: '#FFE600',
      desc: 'Vuelta completa',
      apply(T, t) {
        const x = t / this.dur;
        if (x < 0 || x > 1) return;
        T.rot += Ease.cubic(x) * TAU;
      }
    },
    {
      id: 'heartbeat', name: 'Latido', cat: 'hit', dur: 0.7, color: '#FF3D71',
      desc: 'Doble pulso como un corazón',
      apply(T, t, k) {
        const x = t / this.dur;
        const s = 1 + 0.3 * k * (Ease.bump(x / 0.4) + 0.7 * Ease.bump((x - 0.45) / 0.4));
        T.sx *= s; T.sy *= s;
      }
    },
    {
      id: 'highlight', name: 'Marcador', cat: 'hit', dur: 0.3, color: '#22C55E',
      desc: 'Caja de color que se dibuja detrás',
      apply(T, t, k, color) {
        if (t < 0) return;
        T.box = { color, p: Ease.cubic(t / this.dur) };
      }
    },
    {
      id: 'underline', name: 'Subrayado', cat: 'hit', dur: 0.35, color: '#FF3D71',
      desc: 'Línea que se dibuja debajo',
      apply(T, t, k, color) {
        if (t < 0) return;
        T.line = { color, p: Ease.cubic(t / this.dur) };
      }
    },

    // ───────────── Continuo ─────────────
    {
      id: 'neon', name: 'Neón', cat: 'loop', dur: 0, color: '#00E5FF',
      desc: 'Resplandor que parpadea', loop: true,
      apply(T, t, k, color) {
        T.glow += (0.35 + 0.2 * Math.sin(t * 7)) * k;
        T.glowColor = color;
        if (rand(Math.floor(t * 20)) > 0.96) T.alpha *= 0.55;
      }
    },
    {
      id: 'rainbow', name: 'Arcoíris', cat: 'loop', dur: 0, color: '#FF3D9A',
      desc: 'Colores que recorren la palabra', loop: true,
      apply(T, t, k) { T.rainbow = t * 0.8 * k; }
    },
    {
      id: 'wave', name: 'Ola', cat: 'loop', dur: 0, color: '#FFE600',
      desc: 'Sube y baja suavemente', loop: true,
      apply(T, t, k) { T.dy += Math.sin(t * 6) * 0.12 * k; }
    },
    {
      id: 'wiggle', name: 'Bamboleo', cat: 'loop', dur: 0, color: '#FFE600',
      desc: 'Se balancea de lado a lado', loop: true,
      apply(T, t, k) { T.rot += Math.sin(t * 9) * 0.12 * k; }
    },
    {
      id: 'pulse', name: 'Pulso', cat: 'loop', dur: 0, color: '#FFE600',
      desc: 'Respira creciendo y encogiendo', loop: true,
      apply(T, t, k) {
        const s = 1 + Math.sin(t * 7) * 0.08 * k;
        T.sx *= s; T.sy *= s;
      }
    },
    {
      id: 'jitter', name: 'Nervioso', cat: 'loop', dur: 0, color: '#FF3D3D',
      desc: 'Vibración constante', loop: true,
      apply(T, t, k) {
        const f = Math.floor(t * 24);
        T.dx += (rand(f) - 0.5) * 0.08 * k;
        T.dy += (rand(f + 99) - 0.5) * 0.08 * k;
      }
    },
    {
      id: 'glitch', name: 'Glitch', cat: 'loop', dur: 0, color: '#00E5FF',
      desc: 'Separación RGB digital', loop: true,
      apply(T, t, k) {
        const f = Math.floor(t * 14);
        if (rand(f) > 0.55) {
          T.split = 0.06 * k;
          T.dx += (rand(f + 7) - 0.5) * 0.12 * k;
          T.skew += (rand(f + 3) - 0.5) * 0.4 * k;
        } else {
          T.split = 0.015 * k;
        }
      }
    },
    {
      id: 'float', name: 'Flotar', cat: 'loop', dur: 0, color: '#FFE600',
      desc: 'Flota lentamente', loop: true,
      apply(T, t, k) {
        T.dy += Math.sin(t * 2.6) * 0.09 * k;
        T.rot += Math.sin(t * 1.7) * 0.04 * k;
      }
    }
  ];

  const MAP = {};
  LIST.forEach(fx => { MAP[fx.id] = fx; });

  root.SubFX_Effects = {
    list: LIST,
    cats: { in: 'Entrada', hit: 'Énfasis', loop: 'Continuo' },
    get: id => (id && MAP[id]) || null,
    identity,
    ease: Ease,
    clamp,
    /** true si en el instante `t` el efecto no cambia entre fotogramas. */
    isSettled(fx, t) {
      if (!fx) return true;
      if (fx.loop) return false;
      return t < 0 || t > fx.dur;
    }
  };
})(window);
