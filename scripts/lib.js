/*
 * Utilidades compartidas por los scripts de build, firma e instalación.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const NAME = 'SubtitleEngine-Pro';
const OLD_NAME = 'SubFX-Studio';

/** Archivos y carpetas que forman la extensión instalada. */
const RUNTIME = ['CSXS', 'index.html', 'css', 'js', 'jsx', 'assets'];

function manifest() {
  const xml = fs.readFileSync(path.join(ROOT, 'CSXS', 'manifest.xml'), 'utf8');
  const attr = re => { const m = re.exec(xml); return m ? m[1] : null; };
  return {
    xml,
    bundleId: attr(/ExtensionBundleId="([^"]+)"/),
    bundleVersion: attr(/ExtensionBundleVersion="([^"]+)"/),
    extId: attr(/<Extension Id="([^"]+)" Version=/),
    extVersion: attr(/<Extension Id="[^"]+" Version="([^"]+)"/),
    mainPath: attr(/<MainPath>([^<]+)<\/MainPath>/),
    scriptPath: attr(/<ScriptPath>([^<]+)<\/ScriptPath>/),
    menu: attr(/<Menu>([^<]+)<\/Menu>/)
  };
}

const pkg = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }

function copyRecursive(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(src)) {
      if (f === '.DS_Store' || f === 'Thumbs.db') continue;
      copyRecursive(path.join(src, f), path.join(dest, f));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

function walk(dir, base) {
  base = base || dir;
  let out = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) out = out.concat(walk(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

// ───────────── ZIP mínimo (deflate + CRC32, sin dependencias) ─────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** entries = [{ name, data: Buffer, mode }] → Buffer .zip (permisos Unix conservados). */
function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  const d = new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const raw = e.data;
    const comp = zlib.deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE((3 << 8) | 20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10); ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(((0o100000 | (e.mode || 0o644)) << 16) >>> 0, 38); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += lh.length + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat(locals.concat([cd, end]));
}

/** Carpeta de extensiones CEP del usuario. */
function cepExtensionsDir() {
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Adobe', 'CEP', 'extensions');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions');
  return null;
}

function log(msg) { process.stdout.write(msg + '\n'); }
function fail(msg) { process.stderr.write('✗ ' + msg + '\n'); process.exit(1); }

module.exports = { ROOT, DIST, NAME, OLD_NAME, RUNTIME, manifest, pkg, rmrf, copyRecursive, walk, zip, crc32, cepExtensionsDir, log, fail };
