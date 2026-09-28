/*
 * Instalación local para desarrollo y pruebas (Windows y macOS).
 *   npm run install:local     copia dist/SubtitleEngine-Pro (hace build antes)
 *   npm run dev               enlaza la carpeta del repo: los cambios se ven al recargar el panel
 *   npm run uninstall:local   quita la extensión (y la antigua SubFX Studio)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT, DIST, NAME, OLD_NAME, rmrf, copyRecursive, cepExtensionsDir, manifest, log, fail } = require('./lib');

const mode = process.argv.includes('--uninstall') ? 'uninstall' : process.argv.includes('--link') ? 'link' : 'copy';
const extDir = cepExtensionsDir();
if (!extDir) fail('Premiere Pro solo existe en Windows y macOS.');
const dest = path.join(extDir, NAME);

function removeInstalled() {
  for (const n of [NAME, OLD_NAME]) {
    const p = path.join(extDir, n);
    let st = null;
    try { st = fs.lstatSync(p); } catch (e) { continue; }
    if (st.isSymbolicLink()) fs.unlinkSync(p); else rmrf(p);
    log('· Quitado ' + p);
  }
}

if (mode === 'uninstall') {
  removeInstalled();
  log('✓ Desinstalado.');
  process.exit(0);
}

// PlayerDebugMode: permite cargar extensiones sin firmar
for (const v of [9, 10, 11, 12, 13]) {
  try {
    if (process.platform === 'win32') execFileSync('reg', ['add', `HKCU\\Software\\Adobe\\CSXS.${v}`, '/v', 'PlayerDebugMode', '/t', 'REG_SZ', '/d', '1', '/f'], { stdio: 'ignore' });
    else execFileSync('defaults', ['write', `com.adobe.CSXS.${v}`, 'PlayerDebugMode', '1'], { stdio: 'ignore' });
  } catch (e) { log(`! No se pudo activar PlayerDebugMode para CSXS.${v}`); }
}
log('✓ PlayerDebugMode activado');

fs.mkdirSync(extDir, { recursive: true });
removeInstalled();
if (mode === 'link') {
  fs.symlinkSync(ROOT, dest, process.platform === 'win32' ? 'junction' : 'dir');
  log(`✓ Enlazado ${dest} → ${ROOT}`);
} else {
  execFileSync(process.execPath, [path.join(__dirname, 'build.js')], { stdio: 'inherit' });
  copyRecursive(path.join(DIST, NAME), dest);
  fs.copyFileSync(path.join(ROOT, '.debug'), path.join(dest, '.debug'));
  log('✓ Copiado en ' + dest);
}
log(`Reinicia Premiere Pro y abre Ventana > Extensiones > ${manifest().menu}. Consola: http://localhost:8098`);
