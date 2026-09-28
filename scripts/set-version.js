/*
 * Cambia la versión en package.json, package-lock.json y CSXS/manifest.xml (solo esos campos).
 *   npm run set-version -- 2.1.1
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT, fail, log } = require('./lib');

const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v || '')) fail('Uso: npm run set-version -- X.Y.Z');
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['version', v, '--no-git-tag-version', '--allow-same-version'], { cwd: ROOT, stdio: 'ignore' });
const mf = path.join(ROOT, 'CSXS', 'manifest.xml');
fs.writeFileSync(mf, fs.readFileSync(mf, 'utf8')
  .replace(/ExtensionBundleVersion="[^"]+"/, `ExtensionBundleVersion="${v}"`)
  .replace(/(<Extension Id="[^"]+" Version=")[^"]+"/, `$1${v}"`));
log(`✓ Versión ${v} (package.json, package-lock.json, manifest)`);
