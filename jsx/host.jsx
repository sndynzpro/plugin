/*
 * SubFX Studio — Script de host para Premiere Pro (ExtendScript, ES3).
 * Lee la secuencia activa e importa/coloca las secuencias PNG renderizadas.
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
    var isWin = $.os.indexOf('Windows') !== -1;

    function nativePath(p) { return isWin ? p.replace(/\//g, '\\') : p; }
    function normPath(p) { return String(p || '').replace(/\\/g, '/').toLowerCase(); }

    function getSequenceInfo() {
        try {
            var seq = app.project.activeSequence;
            if (!seq) return fail('No hay una secuencia activa. Abre una secuencia en la línea de tiempo.');
            var fps = 0;
            try { fps = TICKS / Number(seq.timebase); } catch (e1) {}
            var w = 0, h = 0;
            try { w = seq.frameSizeHorizontal; h = seq.frameSizeVertical; } catch (e2) {}
            if (!w || !h) {
                try { var st = seq.getSettings(); w = st.videoFrameWidth; h = st.videoFrameHeight; } catch (e3) {}
            }
            var tracks = [];
            for (var i = 0; i < seq.videoTracks.numTracks; i++) {
                tracks.push({ index: i, name: seq.videoTracks[i].name || ('V' + (i + 1)), clips: seq.videoTracks[i].clips.numItems });
            }
            var playhead = 0;
            try { playhead = seq.getPlayerPosition().seconds; } catch (e4) {}
            return toJSON({
                ok: true, name: seq.name, width: w, height: h,
                fps: Math.round(fps * 1000) / 1000, playhead: playhead, tracks: tracks
            });
        } catch (e) {
            return fail(e.toString());
        }
    }

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

    function addVideoTrack() {
        var seq = app.project.activeSequence;
        var n = seq.videoTracks.numTracks;
        try {
            app.enableQE();
            qe.project.getActiveSequence().addTracks(1, n, 0);
        } catch (e) {}
        seq = app.project.activeSequence;
        return seq.videoTracks.numTracks > n ? seq.videoTracks.numTracks - 1 : -1;
    }

    function placeAt(track, item, seconds) {
        try { track.overwriteClip(item, seconds); return true; } catch (e) {}
        try {
            var tm = new Time();
            tm.seconds = seconds;
            track.overwriteClip(item, tm);
            return true;
        } catch (e2) { return false; }
    }

    /**
     * payload = { binName, fps, trackIndex (-1 = nueva pista), items: [{ path, start, name }] }
     */
    function importAndPlace(payloadStr) {
        try {
            var p = parse(payloadStr);
            var seq = app.project.activeSequence;
            if (!seq) return fail('No hay una secuencia activa.');

            var warnings = [];
            var trackIndex = p.trackIndex;
            if (trackIndex < 0) {
                trackIndex = addVideoTrack();
                if (trackIndex < 0) {
                    trackIndex = seq.videoTracks.numTracks - 1;
                    warnings.push('No se pudo crear una pista nueva; se usó V' + (trackIndex + 1) + '.');
                }
            }
            seq = app.project.activeSequence;
            if (trackIndex >= seq.videoTracks.numTracks) trackIndex = seq.videoTracks.numTracks - 1;
            var track = seq.videoTracks[trackIndex];

            var bin = findOrCreateBin(p.binName);
            var placed = 0;
            for (var i = 0; i < p.items.length; i++) {
                var item = p.items[i];
                var path = nativePath(item.path);
                app.project.importFiles([path], true, bin, true); // true = secuencia de imágenes numeradas
                var pi = findItem(bin, path);
                if (!pi) { warnings.push('No se encontró el clip importado: ' + item.name); continue; }
                try {
                    var interp = pi.getFootageInterpretation();
                    interp.frameRate = p.fps;
                    pi.setFootageInterpretation(interp);
                } catch (e1) { /* versiones antiguas */ }
                try { pi.name = 'SubFX ' + item.name; } catch (e2) {}
                if (placeAt(track, pi, item.start)) placed++;
                else warnings.push('No se pudo colocar: ' + item.name);
            }
            return toJSON({ ok: true, placed: placed, trackIndex: trackIndex, warnings: warnings });
        } catch (e) {
            return fail(e.toString());
        }
    }

    return {
        ping: function () { return toJSON({ ok: true, version: app.version }); },
        getSequenceInfo: getSequenceInfo,
        importAndPlace: importAndPlace
    };
})();
