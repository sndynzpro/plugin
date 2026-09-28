/*
 * SubtitleEngine Pro — Puente con Premiere Pro (CEP) y sistema de archivos.
 * Fuera de Premiere (abriendo index.html en un navegador) funciona en
 * "modo navegador": todo el editor funciona pero no se puede exportar.
 */
(function (root) {
  'use strict';

  const host = root.__adobe_cep__ || null;
  const cepFs = root.cep && root.cep.fs;
  const nodeRequire = (root.cep_node && root.cep_node.require) || (typeof root.require === 'function' ? root.require : null);
  let nodeFs = null, NodeBuffer = null;
  try {
    if (nodeRequire) {
      nodeFs = nodeRequire('fs');
      NodeBuffer = (root.cep_node && root.cep_node.Buffer) || nodeRequire('buffer').Buffer;
    }
  } catch (e) { nodeFs = null; }

  function evalScript(script) {
    return new Promise((resolve, reject) => {
      if (!host) { reject(new Error('Premiere Pro no está conectado.')); return; }
      host.evalScript(script, res => {
        if (res === 'EvalScript error.') reject(new Error('Error al ejecutar el script en Premiere.'));
        else resolve(res);
      });
    });
  }

  /** Llama a SubFX.<fn>(args...) en host.jsx y devuelve el JSON ya interpretado. */
  async function call(fn, ...args) {
    const argStr = args.map(a => JSON.stringify(typeof a === 'string' ? a : JSON.stringify(a))).join(',');
    let res = await evalScript(`typeof SubFX === 'undefined' ? 'NO_HOST' : SubFX.${fn}(${argStr})`);
    if (res === 'NO_HOST') {
      // El script de host no se cargó automáticamente: lo cargamos a mano.
      const jsx = extensionPath() + '/jsx/host.jsx';
      await evalScript(`$.evalFile(${JSON.stringify(jsx)})`);
      res = await evalScript(`SubFX.${fn}(${argStr})`);
    }
    try { return JSON.parse(res); } catch (e) { return { ok: false, error: String(res) }; }
  }

  function toPath(url) {
    let p = decodeURIComponent(String(url || '').replace(/^file:\/\//, ''));
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1); // /C:/... → C:/...
    return p.replace(/\\/g, '/');
  }

  function systemPath(name) { return host ? toPath(host.getSystemPath(name)) : ''; }
  function extensionPath() { return systemPath('extension'); }

  function mkdirp(dir) {
    if (nodeFs) { nodeFs.mkdirSync(dir, { recursive: true }); return; }
    if (!cepFs) throw new Error('Sin acceso al sistema de archivos.');
    const parts = dir.split('/');
    let cur = '';
    parts.forEach((part, i) => {
      cur += (i ? '/' : '') + part;
      if (!part || /^[A-Za-z]:$/.test(part)) return;
      cepFs.makedir(cur);
    });
  }

  /** Codifica el canvas a PNG. Devuelve un Buffer (Node) o base64 (cep.fs). */
  function encodePNG(canvas) {
    if (nodeFs && NodeBuffer && canvas.toBlob) {
      return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
          if (!blob) { reject(new Error('No se pudo codificar el PNG.')); return; }
          blob.arrayBuffer().then(ab => resolve(NodeBuffer.from(ab)), reject);
        }, 'image/png');
      });
    }
    return Promise.resolve(canvas.toDataURL('image/png').split(',')[1]);
  }

  function writeFile(path, data) {
    if (nodeFs && typeof data !== 'string') { nodeFs.writeFileSync(path, data); return; }
    if (nodeFs) { nodeFs.writeFileSync(path, NodeBuffer.from(data, 'base64')); return; }
    const r = cepFs.writeFile(path, data, root.cep.encoding.Base64);
    if (r && r.err) throw new Error('No se pudo escribir ' + path + ' (código ' + r.err + ')');
  }

  function exists(path) {
    if (nodeFs) { try { return nodeFs.existsSync(path); } catch (e) { return false; } }
    if (cepFs) { const r = cepFs.stat(path); return !!(r && r.err === 0); }
    return false;
  }

  /** Lee un archivo binario como ArrayBuffer (requiere Node). */
  function readBinary(path) {
    if (!nodeFs) throw new Error('Sin acceso a Node.js para leer ' + path);
    const b = nodeFs.readFileSync(path);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  }

  /** Lee una imagen como data URL (para usar el fotograma de Premiere de fondo). */
  function readDataURL(path, mime) {
    if (nodeFs) return 'data:' + (mime || 'image/png') + ';base64,' + nodeFs.readFileSync(path).toString('base64');
    const r = cepFs.readFile(path, root.cep.encoding.Base64);
    if (r.err) throw new Error('No se pudo leer ' + path);
    return 'data:' + (mime || 'image/png') + ';base64,' + r.data;
  }

  function tmpDir() {
    if (nodeRequire) { try { return nodeRequire('os').tmpdir().replace(/\\/g, '/'); } catch (e) { /* sigue */ } }
    return systemPath('userData') + '/SubtitleEngine';
  }

  /** Extrae el audio a WAV mono 16 kHz con ffmpeg (si está instalado). */
  function ffmpegToWav(src, dest) {
    return new Promise((resolve, reject) => {
      if (!nodeRequire) { reject(new Error('Node.js no disponible')); return; }
      const cp = nodeRequire('child_process');
      cp.execFile('ffmpeg', ['-y', '-v', 'error', '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', dest],
        { maxBuffer: 1 << 24 }, err => (err ? reject(new Error('ffmpeg no disponible o falló: ' + err.message)) : resolve(dest)));
    });
  }

  /** Espera a que exista un archivo (p. ej. el fotograma que exporta Premiere). */
  async function waitFile(path, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 4000)) {
      if (exists(path)) return true;
      await new Promise(r => setTimeout(r, 120));
    }
    return false;
  }

  function pickFolder(title, initial) {
    if (!cepFs || !cepFs.showOpenDialogEx) return null;
    const r = cepFs.showOpenDialogEx(false, true, title || 'Elegir carpeta', initial || '', []);
    return r && r.data && r.data.length ? r.data[0].replace(/\\/g, '/') : null;
  }

  function openFolder(dir) {
    if (!nodeRequire) return;
    try {
      const cp = nodeRequire('child_process');
      const isWin = navigator.platform.indexOf('Win') === 0;
      cp.exec(isWin ? `explorer "${dir.replace(/\//g, '\\')}"` : `open "${dir}"`);
    } catch (e) { /* opcional */ }
  }

  function registerKeys() {
    if (!host || !host.registerKeyEventsInterest) return;
    // Barra espaciadora, Z, A, Supr y Esc (códigos Windows y macOS)
    const isMac = navigator.platform.indexOf('Mac') === 0;
    const keys = isMac
      ? [{ keyCode: 49 }, { keyCode: 6, metaKey: true }, { keyCode: 6, metaKey: true, shiftKey: true }, { keyCode: 0, metaKey: true }, { keyCode: 51 }, { keyCode: 117 }, { keyCode: 53 }]
      : [{ keyCode: 32 }, { keyCode: 90, ctrlKey: true }, { keyCode: 90, ctrlKey: true, shiftKey: true }, { keyCode: 65, ctrlKey: true }, { keyCode: 46 }, { keyCode: 27 }];
    try { host.registerKeyEventsInterest(JSON.stringify(keys)); } catch (e) { /* opcional */ }
  }

  root.SubFX_CEP = {
    available: !!host,
    canWrite: !!(nodeFs || cepFs),
    evalScript, call, systemPath, extensionPath,
    fs: { mkdirp, encodePNG, writeFile, exists, readBinary, readDataURL, tmpDir, waitFile, ffmpegToWav },
    pickFolder, openFolder, registerKeys
  };
})(window);
