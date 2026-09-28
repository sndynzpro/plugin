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

// Compatibilidad con el Chromium de CEP 11 (Premiere 2022-2023: Chromium 88)
const CSS_BANNED = [[/color-mix\(/, 'color-mix() (Chrome 111)'], [/:has\(/, ':has() (Chrome 105)'], [/@container/, '@container (Chrome 105)'],
  [/@layer/, '@layer (Chrome 99)'], [/text-wrap:/, 'text-wrap (Chrome 114)'], [/:is\(|:where\(/, ':is()/:where() (Chrome 88, dudoso en CEF)']];
const JS_BANNED = [[/\.at\(-?\d/, 'Array/String.at() (Chrome 92)'], [/Object\.hasOwn\(/, 'Object.hasOwn (Chrome 93)'], [/structuredClone\(/, 'structuredClone (Chrome 98)'],
  [/\.findLast(Index)?\(/, 'findLast (Chrome 97)'], [/\?\?=|\|\|=|&&=/, 'asignación lógica (Chrome 85, evitar)'], [/\.toSorted\(|\.toReversed\(|Object\.groupBy/, 'ES2023 (Chrome 110+)']];
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
for (const f of fs.readdirSync(path.join(ROOT, 'css'))) {
  const css = strip(fs.readFileSync(path.join(ROOT, 'css', f), 'utf8'));
  CSS_BANNED.forEach(([re, what]) => { if (re.test(css)) bad(`css/${f} usa ${what}, que el Chromium de Premiere no soporta.`); });
}
scripts.forEach(src => {
  const js = strip(fs.readFileSync(path.join(ROOT, src), 'utf8'));
  JS_BANNED.forEach(([re, what]) => { if (re.test(js)) bad(`${src} usa ${what}, que el Chromium de Premiere no soporta.`); });
});
if (!errors.length) ok('CSS y JS compatibles con el Chromium de CEP 11 (88)');

if (errors.length) {
  errors.forEach(e => process.stderr.write('✗ ' + e + '\n'));
  process.exit(1);
}
log('Comprobaciones superadas.');
