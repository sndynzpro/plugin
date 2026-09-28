/*
 * SubtitleEngine Pro — Estilos base y presets (módulos 03 y 05).
 * Todos los tamaños están en píxeles de referencia para un lado corto de 1080 px
 * (en un vertical 1080×1920 coinciden con los píxeles reales).
 */
(function (root) {
  'use strict';

  const BASE = {
    id: '', name: 'Estilo', custom: false, cat: 'viral',
    // Tipografía
    font: 'Montserrat', weight: 900, italic: false, size: 80, case: 'upper',
    letterSpacing: 0, wordGap: 0.32, lineHeight: 1.15, align: 'center',
    // Color, relleno y gradientes
    color: '#FFFFFF', gradient: false, gradType: 'linear', gradAngle: 90, color2: '#FFD000',
    opacity: 1,
    // Contorno (hasta 3 capas)
    strokeColor: '#000000', strokeWidth: 8, strokeAlign: 'outside', strokeJoin: 'round',
    stroke2Color: '#FFFFFF', stroke2Width: 0,
    stroke3Color: '#000000', stroke3Width: 0,
    // Sombras (hasta 3)
    shadowColor: '#000000', shadowOpacity: 0.55, shadowBlur: 8, shadowAngle: 90, shadowDist: 6,
    shadow2Color: '#000000', shadow2Opacity: 0, shadow2Blur: 20, shadow2Angle: 90, shadow2Dist: 12,
    shadow3Color: '#000000', shadow3Opacity: 0, shadow3Blur: 40, shadow3Angle: 90, shadow3Dist: 24,
    // Resplandor
    glowColor: '#00E5FF', glow: 0,
    // Palabra destacada / karaoke
    hlMode: 'current', hlColor: '#FFE600', hlScale: 1.1, hlBox: false, hlBoxColor: '#7C3AED',
    // Énfasis con cajas: A = amarillo, B = negro. Intercalado: B/A, A/B, B/A…
    emMode: 'alternate', emColorA: '#FAFF96', emColorB: '#000000', emOnKey: false,
    emScale: 1, emRadius: 10, emPad: 0.16, emPlain: true, emPop: true,
    // Fondos, cajas y glass
    bg: 'none', bgColor: '#000000', bgOpacity: 0.55, bgRadius: 18, bgPadX: 20, bgPadY: 12,
    bgGlass: false, glassBorder: 0.35, glassShine: 0.18,
    // Diseño y zonas seguras
    reveal: 'all', preAlpha: 1, maxWords: 4, maxWidth: 82, posX: 50, posY: 72,
    // Segmentación: 0 = sin límite
    maxLines: 0, maxWordsLine: 0, maxCharsLine: 0, maxChars: 0,
    // Duración: mínima por bloque y huecos que se rellenan para evitar parpadeos
    minChunk: 0, holdGap: 0.25,
    // Puntuación: keep | soft (quita , . ; :) | all
    punct: 'keep',
    safeTop: 0, safeBottom: 0, safeSide: 0,
    // Animación
    cueIn: 'pop', cueOut: false, wordFx: ''
  };

  const CATS = { viral: 'Virales', '30x': '30X Media', social: 'Social', cine: 'Cine', minimal: 'Minimal' };

  // Colores oficiales del Playbook 30X Media
  const X30 = { white: '#F6F5F0', yellow: '#FAFF96' };
  const X30_BASE = {
    cat: '30x', font: 'Inter', weight: 700, size: 62, case: 'lower', align: 'center',
    color: X30.white, strokeWidth: 0,
    shadowColor: '#000000', shadowOpacity: 0.65, shadowBlur: 6, shadowAngle: 90, shadowDist: 4,
    hlMode: 'keyword', hlColor: X30.yellow, hlScale: 1,
    maxWords: 5, maxWidth: 80, posY: 72, safeTop: 250, safeBottom: 380, safeSide: 60,
    cueIn: 'none', lineHeight: 1.2
  };

  const PRESETS = [
    Object.assign({}, X30_BASE, { id: 'x30-default', name: '30X Default' }),
    Object.assign({}, X30_BASE, {
      id: 'x30-hook', name: '30X Hook', case: 'upper', align: 'left', size: 78, posX: 8, posY: 30,
      hlMode: 'none', maxWords: 0, maxWidth: 84
    }),
    Object.assign({}, X30_BASE, { id: 'x30-speaker2', name: '30X Speaker 2', color: X30.yellow, hlColor: X30.white }),
    Object.assign({}, X30_BASE, {
      id: 'x30-cover', name: '30X Portada', case: 'upper', align: 'left', size: 96, posX: 8, posY: 50,
      hlMode: 'none', maxWords: 0, maxWidth: 84, shadowOpacity: 0.5
    }),
    {
      id: 'enfasis', punct: 'soft', name: 'Énfasis intercalado', font: 'Montserrat', weight: 800, size: 72, case: 'upper',
      strokeWidth: 0, shadowOpacity: 0.6, shadowBlur: 10, shadowY: 4,
      hlMode: 'none', emMode: 'alternate', emOnKey: true, emColorA: '#FAFF96', emColorB: '#000000', emRadius: 8,
      maxWords: 4, cueIn: 'pop', posY: 70
    },
    {
      id: 'x30-enfasis', name: '30X Énfasis', cat: '30x', font: 'Inter', weight: 700, size: 62, case: 'lower',
      color: '#F6F5F0', strokeWidth: 0, shadowOpacity: 0.65, shadowBlur: 6, shadowAngle: 90, shadowDist: 4,
      hlMode: 'none', emMode: 'alternate', emOnKey: true, emColorA: '#FAFF96', emColorB: '#000000', emRadius: 6, emPop: false,
      maxWords: 5, maxWidth: 80, posY: 72, safeTop: 250, safeBottom: 380, safeSide: 60, cueIn: 'none', lineHeight: 1.3
    },
    {
      id: 'hormozi', punct: 'soft', name: 'Hormozi', font: 'Montserrat', weight: 900, size: 84,
      strokeWidth: 9, shadowOpacity: 0.5, shadowBlur: 0, shadowY: 7,
      hlMode: 'current', hlColor: '#FFE600', hlScale: 1.1, maxWords: 3, cueIn: 'pop', posY: 70
    },
    {
      id: 'beast', punct: 'soft', name: 'Beast', font: 'Luckiest Guy', weight: 400, size: 104,
      strokeWidth: 12, shadowOpacity: 1, shadowBlur: 0, shadowY: 10,
      reveal: 'single', hlMode: 'none', wordFx: 'pop', maxWords: 3, posY: 62, cueIn: 'none'
    },
    {
      id: 'capcut', name: 'Caja viral', font: 'Montserrat', weight: 800, size: 76,
      strokeWidth: 6, shadowOpacity: 0.35, shadowBlur: 10, shadowY: 4,
      hlMode: 'current', hlColor: '#FFFFFF', hlBox: true, hlBoxColor: '#7C3AED', hlScale: 1.06, maxWords: 3
    },
    {
      id: 'hormozi2', punct: 'soft', name: 'Hormozi verde', font: 'Montserrat', weight: 900, size: 84,
      strokeWidth: 9, shadowOpacity: 0.5, shadowBlur: 0, shadowY: 7,
      hlMode: 'current', hlColor: '#4ADE80', hlScale: 1.12, maxWords: 3, cueIn: 'pop', posY: 70
    },
    {
      id: 'iman', punct: 'soft', name: 'Iman', font: 'Montserrat', weight: 800, size: 66,
      strokeWidth: 0, shadowOpacity: 0.55, shadowBlur: 14, shadowY: 4,
      hlMode: 'current', hlColor: '#FDE047', hlScale: 1, maxWords: 3, cueIn: 'fade', posY: 74
    },
    {
      id: 'ali', name: 'Ali Abdaal', font: 'Poppins', weight: 700, size: 64, case: 'none',
      strokeWidth: 0, shadowOpacity: 0.4, shadowBlur: 10, shadowY: 3,
      hlMode: 'current', hlColor: '#FFFFFF', hlBox: true, hlBoxColor: '#6366F1', hlScale: 1.04, maxWords: 4, cueIn: 'pop'
    },
    {
      id: 'devin', punct: 'soft', name: 'Devin', font: 'Montserrat', weight: 900, italic: true, size: 86,
      strokeWidth: 7, shadowOpacity: 0.6, shadowBlur: 0, shadowY: 6,
      reveal: 'progressive', hlMode: 'current', hlColor: '#39FF88', hlScale: 1.08, wordFx: 'pop', maxWords: 3, cueIn: 'none'
    },
    {
      id: 'tiktok', name: 'TikTok clásico', font: 'Montserrat', weight: 700, size: 58, case: 'none',
      color: '#111111', strokeWidth: 0, shadowOpacity: 0,
      bg: 'line', bgColor: '#FFFFFF', bgOpacity: 1, bgRadius: 12, bgPadX: 16, bgPadY: 6,
      hlMode: 'none', maxWords: 0, maxWidth: 76, cueIn: 'none'
    },
    {
      id: 'pop3d', punct: 'soft', name: 'Pop 3D', font: 'Luckiest Guy', weight: 400, size: 100,
      strokeColor: '#000000', strokeWidth: 6, stroke2Color: '#FF3D7F', stroke2Width: 6, stroke3Color: '#000000', stroke3Width: 5,
      shadowOpacity: 1, shadowBlur: 0, shadowAngle: 90, shadowDist: 12,
      hlMode: 'current', hlColor: '#FFE600', hlScale: 1.12, maxWords: 3, cueIn: 'bounce'
    },
    {
      id: 'gaming', punct: 'soft', name: 'Gaming', font: 'Bangers', weight: 400, size: 108, letterSpacing: 0.04,
      gradient: true, color: '#E6FF3D', color2: '#22C55E', strokeColor: '#000000', strokeWidth: 9,
      stroke2Color: '#FFFFFF', stroke2Width: 4, shadowOpacity: 0.9, shadowBlur: 0, shadowY: 8,
      hlMode: 'none', reveal: 'single', wordFx: 'punch', maxWords: 2, cueIn: 'none'
    },
    {
      id: 'lujo', name: 'Lujo', cat: 'cine', font: 'Playfair Display', weight: 700, size: 64, letterSpacing: 0.08,
      gradient: true, gradAngle: 60, color: '#FFF4C2', color2: '#C9A227', strokeWidth: 0,
      shadowOpacity: 0.6, shadowBlur: 16, shadowY: 4, hlMode: 'none', maxWords: 4, cueIn: 'fade', cueOut: true
    },
    {
      id: 'podcast', name: 'Podcast 2 voces', cat: 'social', font: 'Inter', weight: 800, size: 64, case: 'none',
      strokeWidth: 0, shadowOpacity: 0.7, shadowBlur: 8, shadowY: 4,
      hlMode: 'spoken', hlColor: '#FDE047', hlScale: 1, maxWords: 5, cueIn: 'fade'
    },
    {
      id: 'glass', name: 'Glass', cat: 'social', font: 'Inter', weight: 700, size: 60, case: 'none',
      strokeWidth: 0, shadowOpacity: 0.3, shadowBlur: 12, shadowY: 3,
      bg: 'block', bgGlass: true, bgColor: '#FFFFFF', bgOpacity: 0.16, bgRadius: 28, bgPadX: 28, bgPadY: 16,
      hlMode: 'current', hlColor: '#FFE08A', hlScale: 1, maxWords: 5, cueIn: 'fade'
    },
    {
      id: 'neon', name: 'Neón', cat: 'social', font: 'Poppins', weight: 800, size: 74, color: '#F5F3FF',
      strokeWidth: 0, glow: 30, glowColor: '#A855F7', shadowOpacity: 0,
      hlMode: 'current', hlColor: '#22D3EE', maxWords: 4
    },
    {
      id: 'karaoke', name: 'Karaoke', cat: 'social', font: 'Poppins', weight: 700, size: 62, case: 'none',
      strokeWidth: 0, shadowOpacity: 0, bg: 'block', bgOpacity: 0.62,
      hlMode: 'spoken', hlColor: '#22D3EE', hlScale: 1, maxWords: 6, posY: 82, cueIn: 'fade'
    },
    {
      id: 'minimal', name: 'Minimal', cat: 'minimal', font: 'Inter', weight: 600, size: 56, case: 'none',
      strokeWidth: 0, shadowOpacity: 0.6, shadowBlur: 18, shadowY: 4,
      hlMode: 'none', reveal: 'progressive', wordFx: 'fade', cueIn: 'none', maxWords: 7, posY: 84
    },
    {
      id: 'retro', name: 'Retro pop', font: 'Bebas Neue', weight: 400, size: 116, letterSpacing: 0.03,
      gradient: true, color: '#FFD23F', color2: '#FF3D7F', strokeColor: '#2B0B3F', strokeWidth: 10,
      stroke2Width: 6, stroke2Color: '#FFD23F',
      shadowColor: '#2B0B3F', shadowOpacity: 1, shadowBlur: 0, shadowX: 7, shadowY: 8,
      hlMode: 'none', wordFx: 'drop', reveal: 'progressive', maxWords: 3, cueIn: 'none'
    },
    {
      id: 'fuego', name: 'Fuego', font: 'Anton', weight: 400, size: 104,
      gradient: true, color: '#FFF200', color2: '#FF4D00', strokeColor: '#1A0500', strokeWidth: 8,
      glow: 22, glowColor: '#FF5500', shadowOpacity: 0,
      hlMode: 'none', reveal: 'single', wordFx: 'punch', maxWords: 2, cueIn: 'none'
    },
    {
      id: 'cine', name: 'Cine', cat: 'cine', font: 'Georgia', weight: 400, italic: true, size: 52, case: 'none',
      color: '#F8F5EE', strokeWidth: 0, shadowOpacity: 0.85, shadowBlur: 6, shadowY: 2,
      hlMode: 'none', maxWords: 0, cueIn: 'fade', cueOut: true, posY: 86, maxWidth: 75
    }
  ];

  const DEFAULT_ID = 'x30-default';

  const FONTS = [
    'Inter', 'Montserrat', 'Poppins', 'Bebas Neue', 'The Bold Font', 'Anton', 'Luckiest Guy', 'Bangers',
    'Archivo Black', 'Oswald', 'Permanent Marker', 'Playfair Display', 'Arial', 'Arial Black', 'Impact',
    'Helvetica', 'Verdana', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Comic Sans MS'
  ];

  /** Convierte estilos guardados con el formato anterior (sombra X/Y, relleno único). */
  function migrate(p) {
    const o = Object.assign({}, p);
    if ((o.shadowX != null || o.shadowY != null) && o.shadowAngle == null) {
      const x = o.shadowX || 0, y = o.shadowY || 0;
      o.shadowDist = Math.round(Math.hypot(x, y) * 10) / 10;
      o.shadowAngle = o.shadowDist ? Math.round((Math.atan2(y, x) * 180 / Math.PI + 360) % 360) : 90;
    }
    delete o.shadowX;
    delete o.shadowY;
    if (o.bgPad != null && o.bgPadX == null) { o.bgPadX = o.bgPad; o.bgPadY = Math.round(o.bgPad * 0.6); }
    delete o.bgPad;
    return o;
  }

  const make = p => Object.assign({}, BASE, migrate(p));

  root.SubFX_Styles = { BASE, PRESETS, FONTS, CATS, DEFAULT_ID, make, migrate };
})(typeof window !== 'undefined' ? window : globalThis);
