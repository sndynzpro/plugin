/*
 * SubtitleEngine Pro — Script de host para Premiere Pro (ExtendScript, ES3).
 * Timeline API: secuencia activa, cabezal, captura de fotograma, importación
 * de PNG, Auto-Zoom (keyframes de Movimiento) y eliminación de silencios.
 */
/* global app, qe, $, Time */
var SubFX = (function () {

    // ───── JSON mínimo (ExtendScript no siempre trae JSON) ─────
    function esc(s) {
        return '"' + String(s)
            .replace(/\\/g, '\\\\').replace(/"/g, '\\"')
            .replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
    }
    function toJSON(v) {
        var i, out, k;
        if (v === null || v === undefined) return 'null';
        if (typeof v === 'number') return isFinite(v) ? String(v) : 'null';
        if (typeof v === 'boolean') return v ? 'true' : 'false';
        if (typeof v === 'string') return esc(v);
        if (v instanceof Array) {
            out = [];
            for (i = 0; i < v.length; i++) out.push(toJSON(v[i]));
            return '[' + out.join(',') + ']';
        }
        out = [];
        for (k in v) if (v.hasOwnProperty(k)) out.push(esc(k) + ':' + toJSON(v[k]));
        return '{' + out.join(',') + '}';
    }
    function parse(s) { return eval('(' + s + ')'); }
    function fail(msg) { return toJSON({ ok: false, error: msg }); }

    var TICKS = 254016000000;
    var EPS = 0.002;
    var isWin = $.os.indexOf('Windows') !== -1;

    function nativePath(p) { return isWin ? p.replace(/\//g, '\\') : p; }
    function normPath(p) { return String(p || '').replace(/\\/g, '/').toLowerCase(); }
    function mkTime(sec) { var t = new Time(); t.seconds = sec; return t; }
    function secs(t) { return t ? Number(t.seconds) : 0; }

    function activeSeq() {
        var seq = app.project.activeSequence;
        if (!seq) throw new Error('No hay una secuencia activa. Abre una secuencia en la línea de tiempo.');
        return seq;
    }

    function seqFps(seq) {
        try { return TICKS / Number(seq.timebase); } catch (e) { return 30; }
    }

    /** Timecode en el formato de visualización de la secuencia (lo que espera QE). */
    function qeTC(seq, sec) {
        var st = seq.getSettings();
        return mkTime(sec).getFormatted(st.videoFrameRate, st.videoDisplayFormat);
    }

    // ───────────── Secuencia y cabezal ─────────────
    function getSequenceInfo() {
        try {
            var seq = app.project.activeSequence;
            if (!seq) return fail('No hay una secuencia activa. Abre una secuencia en la línea de tiempo.');
            var fps = seqFps(seq);
            var w = 0, h = 0;
            try { w = seq.frameSizeHorizontal; h = seq.frameSizeVertical; } catch (e2) {}
            if (!w || !h) {
                try { var st = seq.getSettings(); w = st.videoFrameWidth; h = st.videoFrameHeight; } catch (e3) {}
            }
            var tracks = [], atracks = [], i;
            for (i = 0; i < seq.videoTracks.numTracks; i++) {
                tracks.push({ index: i, name: seq.videoTracks[i].name || ('V' + (i + 1)), clips: seq.videoTracks[i].clips.numItems });
            }
            for (i = 0; i < seq.audioTracks.numTracks; i++) {
                atracks.push({ index: i, name: seq.audioTracks[i].name || ('A' + (i + 1)), clips: seq.audioTracks[i].clips.numItems });
            }
            var playhead = 0;
            try { playhead = seq.getPlayerPosition().seconds; } catch (e4) {}
            return toJSON({
                ok: true, name: seq.name, width: w, height: h,
                fps: fps, fpsLabel: Math.round(fps * 1000) / 1000, timebase: Number(seq.timebase),
                playhead: playhead, tracks: tracks, audioTracks: atracks
            });
        } catch (e) {
            return fail(e.toString());
        }
    }

    /** Puntos de entrada/salida de la secuencia (segundos). */
    function getInOut() {
        try {
            var seq = activeSeq(), a = null, b = null;
            try { a = seq.getInPointAsTime().seconds; b = seq.getOutPointAsTime().seconds; } catch (e1) {
                try { a = Number(seq.getInPoint()); b = Number(seq.getOutPoint()); } catch (e2) {}
            }
            return toJSON({ ok: true, inPoint: a, outPoint: b });
        } catch (e) { return fail(e.toString()); }
    }

    function getPlayhead() {
        try { return toJSON({ ok: true, t: activeSeq().getPlayerPosition().seconds }); } catch (e) { return fail(e.toString()); }
    }

    function setPlayhead(sec) {
        try {
            activeSeq().setPlayerPosition(String(Math.round(Number(sec) * TICKS)));
            return toJSON({ ok: true });
        } catch (e) { return fail(e.toString()); }
    }

    /** Exporta el fotograma bajo el cabezal a un PNG (para la vista previa). */
    function exportFrame(path) {
        try {
            var seq = activeSeq();
            app.enableQE();
            var t = seq.getPlayerPosition().seconds;
            qe.project.getActiveSequence().exportFramePNG(qeTC(seq, t), nativePath(path));
            return toJSON({ ok: true, path: path });
        } catch (e) { return fail(e.toString()); }
    }

    // ───────────── Importación de PNG ─────────────
    function findOrCreateBin(name) {
        var root = app.project.rootItem;
        for (var i = 0; i < root.children.numItems; i++) {
            var c = root.children[i];
            if (c.name === name && c.type === 2 /* BIN */) return c;
        }
        var bin = root.createBin(name);
        if (bin) return bin;
        for (var j = 0; j < root.children.numItems; j++) {
            if (root.children[j].name === name) return root.children[j];
        }
        return root;
    }

    function findItem(bin, path) {
        var target = normPath(path);
        var fileName = target.substring(target.lastIndexOf('/') + 1);
        var byName = null;
        for (var i = bin.children.numItems - 1; i >= 0; i--) {
            var it = bin.children[i];
            var mp = '';
            try { mp = normPath(it.getMediaPath()); } catch (e) {}
            if (mp === target) return it;
            if (!byName && String(it.name).toLowerCase() === fileName) byName = it;
        }
        return byName;
    }

    function addVideoTrack(name) {
        var seq = app.project.activeSequence;
        var n = seq.videoTracks.numTracks;
        try {
            app.enableQE();
            qe.project.getActiveSequence().addTracks(1, n, 0);
        } catch (e) {}
        seq = app.project.activeSequence;
        if (seq.videoTracks.numTracks <= n) return -1;
        var idx = seq.videoTracks.numTracks - 1;
        try { if (name) seq.videoTracks[idx].name = name; } catch (e2) {}
        return idx;
    }

    function mkTicks(ticks) { var t = new Time(); t.ticks = String(Math.round(ticks)); return t; }
    function ticksOf(t) { return t ? Number(t.ticks) : 0; }

    function placeAt(track, item, ticks) {
        try { track.overwriteClip(item, mkTicks(ticks)); return true; } catch (e) {}
        try { track.overwriteClip(item, ticks / TICKS); return true; } catch (e2) { return false; }
    }

    /** Clip de la pista que empieza exactamente en `ticks` (tolerancia: medio fotograma). */
    function clipAt(track, ticks, tb) {
        for (var i = track.clips.numItems - 1; i >= 0; i--) {
            var c = track.clips[i];
            if (Math.abs(ticksOf(c.start) - ticks) < tb / 2) return c;
        }
        return null;
    }

    /** Quita de la pista los clips cuyo nombre empieza por `prefix` (vista previa anterior). */
    function removeByPrefix(track, prefix) {
        var n = 0;
        for (var i = track.clips.numItems - 1; i >= 0; i--) {
            var c = track.clips[i];
            if (String(c.name).indexOf(prefix) === 0) { try { c.remove(false, false); n++; } catch (e) {} }
        }
        return n;
    }

    /**
     * Pista propia de la vista previa: por nombre o porque ya contiene clips de vista previa
     * de esa capa («SE·prev 001…» para la capa 1, «SE·prev L2 001…» para la 2). -1 si no hay.
     */
    function findOwnTrack(seq, name, prefix, layer) {
        var i, j, t, n;
        for (i = 0; i < seq.videoTracks.numTracks; i++) if (seq.videoTracks[i].name === name) return i;
        if (!prefix) return -1;
        var tag = prefix + ' ' + (layer ? 'L' + (layer + 1) + ' ' : '');
        for (i = 0; i < seq.videoTracks.numTracks; i++) {
            t = seq.videoTracks[i];
            for (j = 0; j < t.clips.numItems; j++) {
                n = String(t.clips[j].name);
                if (n.indexOf(tag) === 0 && (layer || /^[0-9]/.test(n.substring(tag.length)))) return i;
            }
        }
        return -1;
    }

    /**
     * Coloca los PNG al fotograma exacto (en ticks de la secuencia).
     * payload = { binName, tracks: [índice por capa, -1 = nueva], trackName, anchorSec, clearPrefix,
     *             width, height, items: [{ path, f0, frames, name, layer, still }] }
     * f0 y frames son fotogramas de la secuencia contados desde anchorSec.
     */
    function importAndPlace(payloadStr) {
        try {
            var p = parse(payloadStr);
            var seq = activeSeq();
            var warnings = [];
            var tb = Number(seq.timebase);          // ticks por fotograma
            var fps = TICKS / tb;
            var anchor = Math.round((p.anchorSec || 0) * fps);
            var sameSize = !p.width || (p.width === seq.frameSizeHorizontal && p.height === seq.frameSizeVertical);
            if (!sameSize) warnings.push('Los PNG (' + p.width + 'x' + p.height + ') no miden lo mismo que la secuencia; Premiere los escalará.');

            var tracks = p.tracks || [p.trackIndex];
            var resolved = [];
            for (var l = 0; l < tracks.length; l++) {
                var ti = tracks[l];
                if (ti === -2) ti = findOwnTrack(seq, p.trackName + (l ? ' ' + (l + 1) : ''), p.clearPrefix, l);
                if (ti < 0) {
                    ti = addVideoTrack(p.trackName ? p.trackName + (l ? ' ' + (l + 1) : '') : '');
                    if (ti < 0) {
                        ti = app.project.activeSequence.videoTracks.numTracks - 1;
                        warnings.push('No se pudo crear una pista nueva; se usó V' + (ti + 1) + '.');
                    }
                }
                seq = app.project.activeSequence;
                if (ti >= seq.videoTracks.numTracks) ti = seq.videoTracks.numTracks - 1;
                resolved.push(ti);
            }
            var removed = 0;
            if (p.clearPrefix) for (var r = 0; r < resolved.length; r++) removed += removeByPrefix(seq.videoTracks[resolved[r]], p.clearPrefix);

            var bin = findOrCreateBin(p.binName);
            var placed = 0, offFrame = 0;
            for (var i = 0; i < p.items.length; i++) {
                var item = p.items[i];
                var track = seq.videoTracks[resolved[item.layer || 0] != null ? resolved[item.layer || 0] : resolved[0]];
                var path = nativePath(item.path);
                app.project.importFiles([path], true, bin, !item.still); // secuencia numerada salvo PNG estático
                var pi = findItem(bin, path);
                if (!pi) { warnings.push('No se encontró el clip importado: ' + item.name); continue; }
                try {
                    var interp = pi.getFootageInterpretation();
                    if (!item.still) interp.frameRate = fps;   // fps exacto de la secuencia (29.97002997…)
                    interp.pixelAspectRatio = 1;
                    pi.setFootageInterpretation(interp);
                } catch (e1) { /* versiones antiguas */ }
                if (item.still) { try { pi.setInPoint(0, 4); pi.setOutPoint(item.frames / fps, 4); } catch (e0) {} }
                try { pi.name = item.name; } catch (e2) {}

                var startT = (anchor + item.f0) * tb, endT = (anchor + item.f0 + item.frames) * tb;
                if (!placeAt(track, pi, startT)) { warnings.push('No se pudo colocar: ' + item.name); continue; }
                placed++;
                var c = clipAt(track, startT, tb);
                if (!c) { offFrame++; continue; }
                try { c.name = item.name; } catch (e3) {}
                if (Math.abs(ticksOf(c.end) - endT) >= tb / 2) {
                    try { c.end = mkTicks(endT); } catch (e4) {}
                    if (Math.abs(ticksOf(c.end) - endT) >= tb / 2) offFrame++;
                }
                if (sameSize) {
                    // 1:1 con la secuencia: escala 100 y centrado (evita «Escalar al tamaño del fotograma»)
                    try { var m = motionOf(c); if (m && Number(m.properties[1].getValue()) !== 100) m.properties[1].setValue(100, true); } catch (e5) {}
                }
            }
            if (offFrame) warnings.push(offFrame + ' clip(s) no quedaron en el fotograma exacto; revísalos.');
            return toJSON({ ok: true, placed: placed, removed: removed, tracks: resolved, fps: fps, warnings: warnings });
        } catch (e) {
            return fail(e.toString());
        }
    }

    // ───────────── Clips (Auto-Zoom y silencios) ─────────────
    function clipInfo(c, index, trackIndex) {
        var path = '';
        try { path = c.projectItem ? c.projectItem.getMediaPath() : ''; } catch (e) {}
        return {
            track: trackIndex, index: index, name: c.name,
            start: secs(c.start), end: secs(c.end),
            inPoint: secs(c.inPoint), outPoint: secs(c.outPoint), path: path
        };
    }

    /** scope: 'selected' | 'track' ; trackIndex para 'track'. */
    function getVideoClips(scope, trackIndex) {
        try {
            var seq = activeSeq();
            var out = [], t, i;
            if (scope === 'selected') {
                var sel = seq.getSelection();
                for (t = 0; t < seq.videoTracks.numTracks; t++) {
                    var tr = seq.videoTracks[t];
                    for (i = 0; i < tr.clips.numItems; i++) {
                        var c = tr.clips[i];
                        for (var s = 0; s < sel.length; s++) {
                            if (sel[s].nodeId === c.nodeId) { out.push(clipInfo(c, i, t)); break; }
                        }
                    }
                }
            } else {
                var track = seq.videoTracks[Number(trackIndex) || 0];
                for (i = 0; i < track.clips.numItems; i++) out.push(clipInfo(track.clips[i], i, Number(trackIndex) || 0));
            }
            return toJSON({ ok: true, clips: out, width: seq.frameSizeHorizontal, height: seq.frameSizeVertical, fps: seqFps(seq) });
        } catch (e) { return fail(e.toString()); }
    }

    function getAudioClips(trackIndex) {
        try {
            var seq = activeSeq();
            var track = seq.audioTracks[Number(trackIndex) || 0];
            if (!track) return fail('No existe la pista de audio A' + (Number(trackIndex) + 1) + '.');
            var out = [];
            for (var i = 0; i < track.clips.numItems; i++) out.push(clipInfo(track.clips[i], i, Number(trackIndex) || 0));
            return toJSON({ ok: true, clips: out, fps: seqFps(seq) });
        } catch (e) { return fail(e.toString()); }
    }

    function motionOf(clip) {
        for (var i = 0; i < clip.components.numItems; i++) {
            var c = clip.components[i];
            if (c.matchName === 'AE.ADBE Motion' || c.displayName === 'Motion' || c.displayName === 'Movimiento') return c;
        }
        return null;
    }

    var INTERP = { linear: 0, hold: 4, bezier: 5 };

    function keyAt(param, t, value, interp) {
        var tm = mkTime(t);
        try { param.addKey(tm); } catch (e) { param.addKey(t); }
        try { param.setValueAtKey(tm, value, true); } catch (e2) { param.setValueAtKey(t, value, true); }
        try { param.setInterpolationTypeAtKey(tm, INTERP[interp] || 0, true); } catch (e3) {}
    }

    /**
     * payload = { clips: [{ track, index, keys: [{ t, s, interp }] }], focal: { x, y } (0-1), replace }
     * Los tiempos de los keyframes van en segundos de secuencia.
     */
    function applyZoom(payloadStr) {
        try {
            var p = parse(payloadStr);
            var seq = activeSeq();
            var W = seq.frameSizeHorizontal, H = seq.frameSizeVertical;
            var done = 0, warnings = [];
            for (var i = 0; i < p.clips.length; i++) {
                var cd = p.clips[i];
                var clip = seq.videoTracks[cd.track].clips[cd.index];
                if (!clip) continue;
                var motion = motionOf(clip);
                if (!motion) { warnings.push('Sin efecto Movimiento: ' + clip.name); continue; }
                var pos = motion.properties[0], scale = motion.properties[1];
                if (p.replace) {
                    try { scale.setTimeVarying(false); } catch (e1) {}
                    try { pos.setTimeVarying(false); } catch (e2) {}
                }
                var base = Number(scale.getValue()) || 100;
                var P = pos.getValue();
                var norm = P[0] <= 2 && P[1] <= 2; // Premiere reciente usa posición normalizada 0-1
                var F = norm ? [p.focal.x, p.focal.y] : [p.focal.x * W, p.focal.y * H];
                var moveFocal = Math.abs(p.focal.x - 0.5) > 0.001 || Math.abs(p.focal.y - 0.5) > 0.001;
                scale.setTimeVarying(true);
                if (moveFocal) pos.setTimeVarying(true);
                var cStart = secs(clip.start), cIn = secs(clip.inPoint);
                for (var k = 0; k < cd.keys.length; k++) {
                    var key = cd.keys[k];
                    var mt = cIn + (key.t - cStart); // tiempo de media del clip
                    keyAt(scale, mt, base * key.s, key.interp);
                    if (moveFocal) keyAt(pos, mt, [F[0] - (F[0] - P[0]) * key.s, F[1] - (F[1] - P[1]) * key.s], key.interp);
                }
                done++;
            }
            return toJSON({ ok: true, clips: done, warnings: warnings });
        } catch (e) { return fail(e.toString()); }
    }

    // ───────────── Eliminación de silencios ─────────────
    function allTracks(seq) {
        var out = [], i;
        for (i = 0; i < seq.videoTracks.numTracks; i++) out.push({ t: seq.videoTracks[i], video: true, i: i });
        for (i = 0; i < seq.audioTracks.numTracks; i++) out.push({ t: seq.audioTracks[i], video: false, i: i });
        return out;
    }

    function isLocked(track) { try { return track.isLocked(); } catch (e) { return false; } }

    function razorAll(seq, sec) {
        var qs = qe.project.getActiveSequence();
        var tc = qeTC(seq, sec);
        var i;
        for (i = 0; i < qs.numVideoTracks; i++) { try { if (!isLocked(seq.videoTracks[i])) qs.getVideoTrackAt(i).razor(tc); } catch (e) {} }
        for (i = 0; i < qs.numAudioTracks; i++) { try { if (!isLocked(seq.audioTracks[i])) qs.getAudioTrackAt(i).razor(tc); } catch (e2) {} }
    }

    /**
     * payload = { ranges: [{ start, end }] (segundos de secuencia), mode: 'ripple' | 'markers' }
     */
    function cutRanges(payloadStr) {
        try {
            var p = parse(payloadStr);
            var seq = activeSeq();
            var fps = seqFps(seq);
            var ranges = p.ranges.slice(0).sort(function (a, b) { return b.start - a.start; });
            var warnings = [], done = 0, removed = 0, r, i, j;

            if (p.mode === 'markers') {
                for (r = 0; r < ranges.length; r++) {
                    var m = seq.markers.createMarker(ranges[r].start);
                    try { m.end = mkTime(ranges[r].end); } catch (e0) {}
                    try { m.name = 'Silencio'; m.comments = 'SubtitleEngine Pro'; } catch (e1) {}
                    try { m.setColorByIndex(1); } catch (e2) {}
                    done++;
                }
                return toJSON({ ok: true, done: done, removed: 0, warnings: warnings });
            }

            app.enableQE();
            for (r = 0; r < ranges.length; r++) {
                // Redondear al fotograma para evitar clips de menos de un cuadro
                var a = Math.round(ranges[r].start * fps) / fps;
                var b = Math.round(ranges[r].end * fps) / fps;
                if (b - a < 1 / fps) continue;
                razorAll(seq, b);
                razorAll(seq, a);
                seq = app.project.activeSequence;
                var tracks = allTracks(seq);
                var touched = [];
                for (i = 0; i < tracks.length; i++) {
                    var tr = tracks[i].t;
                    touched.push(false);
                    if (isLocked(tr)) continue;
                    for (j = tr.clips.numItems - 1; j >= 0; j--) {
                        var c = tr.clips[j];
                        var cs = secs(c.start), ce = secs(c.end);
                        if (cs >= a - EPS && ce <= b + EPS) {
                            c.remove(true, true); // borrado con rizo
                            removed++;
                            touched[i] = true;
                        }
                    }
                }
                // Pistas sin contenido en el rango: desplazar lo que viene después para no desincronizar
                for (i = 0; i < tracks.length; i++) {
                    if (touched[i] || isLocked(tracks[i].t)) continue;
                    var t2 = tracks[i].t;
                    for (j = 0; j < t2.clips.numItems; j++) {
                        var c2 = t2.clips[j];
                        if (secs(c2.start) >= b - EPS) {
                            try { c2.move(mkTime(-(b - a))); } catch (e3) {
                                if (warnings.length < 5) warnings.push('No se pudo desplazar un clip en ' + (tracks[i].video ? 'V' : 'A') + (tracks[i].i + 1) + '.');
                            }
                        }
                    }
                }
                done++;
            }
            return toJSON({ ok: true, done: done, removed: removed, warnings: warnings });
        } catch (e) { return fail(e.toString()); }
    }

    // ───────────── Diagnóstico (solo lectura) ─────────────
    function selfTest() {
        var checks = [];
        function add(name, fn) {
            try {
                var d = fn();
                checks.push({ name: name, ok: true, detail: d === undefined ? '' : String(d) });
            } catch (e) {
                checks.push({ name: name, ok: false, detail: e.message || e.toString() });
            }
        }
        add('Premiere Pro', function () { return app.version + ' · ' + $.os; });
        add('Proyecto abierto', function () {
            if (!app.project || !app.project.rootItem) throw new Error('No hay un proyecto abierto.');
            return app.project.name;
        });
        var seq = app.project ? app.project.activeSequence : null;
        add('Secuencia activa', function () {
            if (!seq) throw new Error('Abre una secuencia en la línea de tiempo.');
            return seq.name + ' · ' + seq.frameSizeHorizontal + 'x' + seq.frameSizeVertical + ' · ' + (Math.round(seqFps(seq) * 1000) / 1000) + ' fps';
        });
        if (seq) {
            add('Leer el cabezal', function () { return seq.getPlayerPosition().seconds.toFixed(3) + ' s'; });
            add('Timecode de la secuencia', function () { return qeTC(seq, 1); });
            add('API QE (cuchilla, pistas nuevas)', function () {
                app.enableQE();
                var q = qe.project.getActiveSequence();
                if (!q) throw new Error('QE no devuelve la secuencia activa.');
                return q.numVideoTracks + ' pistas de vídeo · ' + q.numAudioTracks + ' de audio';
            });
            add('Marcadores', function () { return seq.markers.numMarkers + ' en la secuencia'; });
            add('Selección de clips', function () { return seq.getSelection().length + ' seleccionados'; });
            add('Efecto Movimiento (primer clip de vídeo)', function () {
                for (var t = 0; t < seq.videoTracks.numTracks; t++) {
                    if (seq.videoTracks[t].clips.numItems) {
                        var c = seq.videoTracks[t].clips[0];
                        var m = motionOf(c);
                        if (!m) throw new Error('El clip «' + c.name + '» no tiene Movimiento.');
                        var pos = m.properties[0].getValue();
                        return 'Escala ' + m.properties[1].getValue() + ' · Posición ' + (pos[0] <= 2 && pos[1] <= 2 ? 'normalizada' : 'en píxeles');
                    }
                }
                return 'Sin clips de vídeo para comprobar';
            });
            add('Pistas bloqueadas', function () {
                var n = 0, i;
                for (i = 0; i < seq.videoTracks.numTracks; i++) if (isLocked(seq.videoTracks[i])) n++;
                for (i = 0; i < seq.audioTracks.numTracks; i++) if (isLocked(seq.audioTracks[i])) n++;
                return n ? n + ' bloqueadas: el corte de silencios no las toca' : 'Ninguna';
            });
        }
        return toJSON({ ok: true, checks: checks });
    }

    return {
        ping: function () { return toJSON({ ok: true, version: app.version }); },
        getSequenceInfo: getSequenceInfo,
        getPlayhead: getPlayhead,
        getInOut: getInOut,
        setPlayhead: setPlayhead,
        exportFrame: exportFrame,
        importAndPlace: importAndPlace,
        getVideoClips: getVideoClips,
        getAudioClips: getAudioClips,
        applyZoom: applyZoom,
        cutRanges: cutRanges,
        selfTest: selfTest
    };
})();
