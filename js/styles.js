/*
 * SubFX Studio — Estilos base y preajustes.
 * Todos los tamaños están en píxeles de referencia para un lado corto de 1080 px.
 */
(function (root) {
  'use strict';

  const BASE = {
    id: '', name: 'Estilo', custom: false,
    // Tipografía
    font: 'Montserrat', weight: 900, italic: false, size: 80, case: 'upper',
    letterSpacing: 0, wordGap: 0.32, lineHeight: 1.15,
    // Color
    color: '#FFFFFF', gradient: false, color2: '#FFD000',
    // Contorno, sombra, resplandor
    strokeColor: '#000000', strokeWidth: 8,
    shadowColor: '#000000', shadowOpacity: 0.55, shadowBlur: 8, shadowX: 0, shadowY: 6,
    glowColor: '#00E5FF', glow: 0,
    // Palabra activa (karaoke)
    hlMode: 'current', hlColor: '#FFE600', hlScale: 1.1, hlBox: false, hlBoxColor: '#7C3AED',
    // Fondo
    bg: 'none', bgColor: '#000000', bgOpacity: 0.55, bgRadius: 18, bgPad: 20,
    // Diseño
    reveal: 'all', preAlpha: 1, maxWords: 4, maxWidth: 82, posX: 50, posY: 72,
    // Animación
    cueIn: 'pop', cueOut: false, wordFx: ''
  };

  const PRESETS = [
    {
      id: 'hormozi', name: 'Hormozi', font: 'Montserrat', weight: 900, size: 84,
      strokeWidth: 9, shadowOpacity: 0.5, shadowBlur: 0, shadowY: 7,
      hlMode: 'current', hlColor: '#FFE600', hlScale: 1.1, maxWords: 3, cueIn: 'pop', posY: 70
    },
    {
      id: 'beast', name: 'Beast', font: 'Luckiest Guy', weight: 400, size: 104,
      strokeWidth: 12, shadowOpacity: 1, shadowBlur: 0, shadowY: 10,
      reveal: 'single', hlMode: 'none', wordFx: 'pop', maxWords: 3, posY: 62, cueIn: 'none'
    },
    {
      id: 'capcut', name: 'Caja viral', font: 'Montserrat', weight: 800, size: 76,
      strokeWidth: 6, shadowOpacity: 0.35, shadowBlur: 10, shadowY: 4,
      hlMode: 'current', hlColor: '#FFFFFF', hlBox: true, hlBoxColor: '#7C3AED', hlScale: 1.06, maxWords: 3
    },
    {
      id: 'neon', name: 'Neón', font: 'Poppins', weight: 800, size: 74, color: '#F5F3FF',
      strokeWidth: 0, glow: 30, glowColor: '#A855F7', shadowOpacity: 0,
      hlMode: 'current', hlColor: '#22D3EE', maxWords: 4
    },
    {
      id: 'karaoke', name: 'Karaoke', font: 'Poppins', weight: 700, size: 62, case: 'none',
      strokeWidth: 0, shadowOpacity: 0, bg: 'block', bgOpacity: 0.62,
      hlMode: 'spoken', hlColor: '#22D3EE', hlScale: 1, maxWords: 6, posY: 82, cueIn: 'fade'
    },
    {
      id: 'minimal', name: 'Minimal', font: 'Inter', weight: 600, size: 56, case: 'none',
      strokeWidth: 0, shadowOpacity: 0.6, shadowBlur: 18, shadowY: 4,
      hlMode: 'none', reveal: 'progressive', wordFx: 'fade', cueIn: 'none', maxWords: 7, posY: 84
    },
    {
      id: 'retro', name: 'Retro pop', font: 'Bebas Neue', weight: 400, size: 116, letterSpacing: 0.03,
      gradient: true, color: '#FFD23F', color2: '#FF3D7F', strokeColor: '#2B0B3F', strokeWidth: 10,
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
      id: 'cine', name: 'Cine', font: 'Georgia', weight: 400, italic: true, size: 52, case: 'none',
      color: '#F8F5EE', strokeWidth: 0, shadowOpacity: 0.85, shadowBlur: 6, shadowY: 2,
      hlMode: 'none', maxWords: 0, cueIn: 'fade', cueOut: true, posY: 86, maxWidth: 75
    }
  ];

  const FONTS = [
    'Montserrat', 'Poppins', 'Inter', 'Bebas Neue', 'Anton', 'Luckiest Guy', 'Bangers',
    'Archivo Black', 'Oswald', 'Permanent Marker', 'Arial', 'Arial Black', 'Impact',
    'Helvetica', 'Verdana', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Comic Sans MS'
  ];

  const make = p => Object.assign({}, BASE, p);

  root.SubFX_Styles = { BASE, PRESETS, FONTS, make };
})(window);
