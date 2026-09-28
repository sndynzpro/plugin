/*
 * Comprobaciones estáticas antes de empaquetar:
 *  - manifiesto, .debug y package.json coherentes (ids y versiones)
 *  - todos los scripts de index.html existen y compilan
 *  - host.jsx es ExtendScript válido (ES3: sin let/const, flechas ni plantillas)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT, manifest, pkg, log } = require('./lib');

const errors = [];
const ok = msg => log('✓ ' + msg);
const bad = msg => errors.push(msg);

// Manifiesto
const m = manifest();
const p = pkg();
if (!m.bundleId || !m.extId) bad('No se pudieron leer los ids del manifiesto.');
if (!m.extId.startsWith(m.bundleId)) bad(`El id del panel (${m.extId}) no empieza por el del bundle (${m.bundleId}).`);
if (m.bundleVersion !== p.version) bad(`Versión del manifiesto (${m.bundleVersion}) ≠ package.json (${p.version}).`);
if (m.extVersion !== p.version) bad(`Versión del panel en el manifiesto (${m.extVersion}) ≠ package.json (${p.version}).`);
for (const rel of [m.mainPath, m.scriptPath]) {
  if (!rel || !fs.existsSync(path.join(ROOT, rel))) bad('No existe el archivo del manifiesto: ' + rel);
}
const debug = fs.readFileSync(path.join(ROOT, '.debug'), 'utf8');
if (debug.indexOf(`Id="${m.extId}"`) === -1) bad('.debug no usa el id del panel ' + m.extId);
const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : null;
if (tag && tag !== 'v' + p.version) bad(`El tag ${tag} no coincide con la versión ${p.version} (debería ser v${p.version}).`);
if (!errors.length) ok(`Manifiesto ${m.bundleId} v${m.bundleVersion} («${m.menu}»)`);

// Scripts del panel
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(x => x[1]);
scripts.forEach(src => {
  const file = path.join(ROOT, src);
  if (!fs.existsSync(file)) { bad('index.html carga un script que no existe: ' + src); return; }
  try { new vm.Script(fs.readFileSync(file, 'utf8'), { filename: src }); } catch (e) { bad(`${src}: ${e.message}`); }
});
if (!errors.length) ok(`${scripts.length} scripts del panel compilan`);

// ExtendScript (ES3)
const jsxPath = path.join(ROOT, m.scriptPath || 'jsx/host.jsx');
const jsx = fs.readFileSync(jsxPath, 'utf8');
try { new vm.Script(jsx, { filename: 'host.jsx' }); } catch (e) { bad('host.jsx no compila: ' + e.message); }
const code = jsx
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '')
  .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, '""')
  .replace(/\/(?:\\.|[^/\\\n])+\/[gimsuy]*/g, '/r/');
[[/\b(let|const)\s/, 'let/const'], [/=>/, 'funciones flecha'], [/`/, 'plantillas `...`'], [/\bclass\s+\w/, 'class'], [/\.\.\.\w/, 'spread']]
  .forEach(([re, what]) => { if (re.test(code)) bad(`host.jsx usa ${what}, que ExtendScript (ES3) no soporta.`); });
if (!errors.length) ok('host.jsx es compatible con ExtendScript');

if (errors.length) {
  errors.forEach(e => process.stderr.write('✗ ' + e + '\n'));
  process.exit(1);
}
log('Comprobaciones superadas.');
