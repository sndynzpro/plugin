/*
 * Genera el paquete de la extensión en dist/:
 *   dist/SubtitleEngine-Pro/               extensión lista para firmar (.zxp)
 *   dist/SubtitleEngine-Pro-<versión>.zip  extensión + instaladores para Windows y macOS
 *   dist/build-info.json                   versión, archivos y SHA-256
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROOT, DIST, NAME, RUNTIME, manifest, rmrf, copyRecursive, walk, zip, log, fail } = require('./lib');

const m = manifest();
const version = m.bundleVersion;
if (!version) fail('No se encontró ExtensionBundleVersion en CSXS/manifest.xml');

const stage = path.join(DIST, NAME);
rmrf(DIST);
fs.mkdirSync(stage, { recursive: true });
RUNTIME.forEach(rel => {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) fail('Falta ' + rel);
  copyRecursive(src, path.join(stage, rel));
});
const files = walk(stage);
log(`✓ Extensión preparada: dist/${NAME} (${files.length} archivos)`);

// .zip instalable: <carpeta>/{extensión, .debug, install/, README.md, LEEME.txt}
const top = `${NAME}-${version}`;
const entries = files.map(f => ({ name: `${top}/${f}`, data: fs.readFileSync(path.join(stage, f)) }));
entries.push({ name: `${top}/.debug`, data: fs.readFileSync(path.join(ROOT, '.debug')) });
entries.push({ name: `${top}/README.md`, data: fs.readFileSync(path.join(ROOT, 'README.md')) });
for (const f of fs.readdirSync(path.join(ROOT, 'install'))) {
  let data = fs.readFileSync(path.join(ROOT, 'install', f), 'utf8');
  const isBat = f.endsWith('.bat');
  data = data.replace(/\r\n/g, '\n');
  if (isBat) data = data.replace(/\n/g, '\r\n');
  entries.push({ name: `${top}/install/${f}`, data: Buffer.from(data, 'utf8'), mode: f.endsWith('.sh') ? 0o755 : 0o644 });
}
entries.push({
  name: `${top}/LEEME.txt`,
  data: Buffer.from([
    `SubtitleEngine Pro ${version}`,
    '',
    'Windows: doble clic en install\\instalar-windows.bat',
    'macOS:   abre Terminal y ejecuta: bash install/instalar-mac.sh',
    '',
    `Después reinicia Premiere Pro y abre Ventana > Extensiones > ${m.menu}.`,
    'Guía completa: docs/DEPLOY.md en el repositorio.',
    ''
  ].join('\r\n'), 'utf8')
});
const zipPath = path.join(DIST, `${top}.zip`);
fs.writeFileSync(zipPath, zip(entries));
log(`✓ Paquete instalable: dist/${top}.zip (${(fs.statSync(zipPath).size / 1024).toFixed(0)} KB)`);

const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
fs.writeFileSync(path.join(DIST, 'build-info.json'), JSON.stringify({
  name: m.menu, bundleId: m.bundleId, version, builtAt: new Date().toISOString(),
  zip: { file: path.basename(zipPath), sha256: sha(zipPath) },
  files: files.map(f => ({ file: f, sha256: sha(path.join(stage, f)) }))
}, null, 2));
log('✓ dist/build-info.json');
