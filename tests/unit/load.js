/* Carga los módulos del panel que no necesitan DOM (se registran en globalThis). */
'use strict';
const path = require('path');
const js = f => path.join(__dirname, '..', '..', 'js', f);
['srt.js', 'styles.js', 'audio.js', 'zoom.js'].forEach(f => require(js(f)));
module.exports = {
  SRT: globalThis.SubFX_SRT, ST: globalThis.SubFX_Styles,
  AU: globalThis.SubFX_Audio, ZM: globalThis.SubFX_Zoom,
  fixture: f => require('fs').readFileSync(path.join(__dirname, '..', 'fixtures', f), 'utf8')
};
