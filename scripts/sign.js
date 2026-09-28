/*
 * Firma dist/SubtitleEngine-Pro como .zxp con ZXPSignCmd (solo Windows y macOS).
 *
 * Variables de entorno opcionales:
 *   ZXP_SIGN_CMD       ruta a ZXPSignCmd (si no, se usa el del paquete zxp-provider)
 *   ZXP_CERT           certificado .p12 propio (si no, se crea uno autofirmado en certs/)
 *   ZXP_CERT_BASE64    el .p12 en base64 (útil en CI, como secreto)
 *   ZXP_CERT_PASSWORD  contraseña del certificado
 *   ZXP_TSA            servidor de sellado de tiempo ("none" para omitirlo)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT, DIST, NAME, manifest, log, fail } = require('./lib');

if (process.platform !== 'win32' && process.platform !== 'darwin') {
  fail('ZXPSignCmd solo existe para Windows y macOS. En Linux usa el .zip o firma en GitHub Actions (job «package», macOS).');
}

function signCmd() {
  if (process.env.ZXP_SIGN_CMD) return process.env.ZXP_SIGN_CMD;
  let p;
  try { p = require('zxp-provider')().replace(/^"|"$/g, ''); } catch (e) { fail('Instala las dependencias (npm install) o define ZXP_SIGN_CMD.'); }
  if (process.platform === 'darwin') { try { fs.chmodSync(p, 0o755); } catch (e) { /* sin permisos: se intenta igual */ } }
  return p;
}

const cmd = signCmd();
const run = args => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

const stage = path.join(DIST, NAME);
if (!fs.existsSync(stage)) fail('No existe dist/' + NAME + '. Ejecuta antes: npm run build');

const password = process.env.ZXP_CERT_PASSWORD || 'subtitleengine';
let cert = process.env.ZXP_CERT;
if (!cert && process.env.ZXP_CERT_BASE64) {
  cert = path.join(DIST, 'cert.p12');
  fs.writeFileSync(cert, Buffer.from(process.env.ZXP_CERT_BASE64, 'base64'));
}
if (!cert) {
  cert = path.join(ROOT, 'certs', 'selfsigned.p12');
  if (!fs.existsSync(cert)) {
    fs.mkdirSync(path.dirname(cert), { recursive: true });
    log('· Creando certificado autofirmado en certs/selfsigned.p12');
    run(['-selfSignedCert', 'MX', 'CDMX', 'SubtitleEngine', 'SubtitleEngine Pro', password, cert, '-validityDays', '3650']);
  }
  if (!process.env.ZXP_CERT_PASSWORD) log('! Usando la contraseña por defecto del certificado autofirmado. Define ZXP_CERT_PASSWORD para uno propio.');
}

const out = path.join(DIST, `${NAME}-${manifest().bundleVersion}.zxp`);
if (fs.existsSync(out)) fs.unlinkSync(out);
const tsa = process.env.ZXP_TSA || 'http://timestamp.digicert.com';
const args = ['-sign', stage, out, cert, password];
if (tsa !== 'none') args.push('-tsa', tsa);
try {
  run(args);
} catch (e) {
  if (tsa === 'none') throw e;
  log('! El sellado de tiempo falló; se firma sin TSA.');
  run(['-sign', stage, out, cert, password]);
}
log('✓ Firmado: dist/' + path.basename(out));
log(run(['-verify', out]).split('\n').map(l => '  ' + l).join('\n'));
if (cert === path.join(DIST, 'cert.p12')) fs.unlinkSync(cert);
