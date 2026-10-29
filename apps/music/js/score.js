// Score: a music-notation editor for the tablet. Enter notes with the
// music keypad (pick a duration, then a letter) or by tapping the staff;
// export to PDF (vector) or MIDI.
(function () {
  "use strict";

  var N = Notation;
  var lib = RM.load("score.library", null);
  if (!lib || !lib.scores || !lib.scores.length) {
    var demo = N.newScore();
    demo.title = "Ode to Joy (opening)";
    demo.composer = "L. van Beethoven";
    demo.key = 0;
    var tune = [30, 30, 31, 32, 32, 31, 30, 29, 28, 28, 29, 30];
    demo.events = tune.map(function (d) { return { dur: "q", dots: 0, pitches: [{ d: d, alt: null }] }; });
    demo.events.push({ dur: "q", dots: 1, pitches: [{ d: 30, alt: null }], dyn: "" }, { dur: "e", dots: 0, pitches: [{ d: 29, alt: null }] }, { dur: "h", dots: 0, pitches: [{ d: 29, alt: null }] });
    demo.events[0].dyn = "mf";
    lib = { scores: [demo], current: 0, paper: "letter" };
  }
  var score = lib.scores[lib.current];
  var sel = score.events.length - 1; // selected event (new notes go after it)
  var inputDur = "q", chordMode = false, viewTop = 0, undoStack = [];

  function save() { RM.store("score.library", lib); }
  function snapshot() {
    undoStack.push(JSON.stringify(score.events));
    if (undoStack.length > 100) undoStack.shift();
  }
  function undo() {
    if (!undoStack.length) return;
    score.events = JSON.parse(undoStack.pop());
    sel = Math.min(sel, score.events.length - 1);
    save();
  }

  // --- Editing --------------------------------------------------------------
  function prevPitch() {
    for (var i = sel; i >= 0; i--) {
      var ev = score.events[i];
      if (ev && !ev.rest && ev.pitches.length) return ev.pitches[ev.pitches.length - 1].d;
    }
    return score.clef === "treble" ? 32 : 20; // G4 / B2
  }

  // Letter entry picks the octave closest to the previous note.
  function letterPitch(letter) {
    var prev = prevPitch(), best = null;
    for (var oct = 1; oct <= 7; oct++) {
      var d = oct * 7 + letter;
      if (best === null || Math.abs(d - prev) < Math.abs(best - prev)) best = d;
    }
    return best;
  }

  function insertNote(d) {
    snapshot();
    if (chordMode && sel >= 0 && !score.events[sel].rest) {
      var ps = score.events[sel].pitches;
      if (!ps.some(function (p) { return p.d === d; })) ps.push({ d: d, alt: null });
    } else {
      score.events.splice(sel + 1, 0, { dur: inputDur, dots: 0, pitches: [{ d: d, alt: null }] });
      sel++;
    }
    save();
  }

  function insertRest() {
    snapshot();
    score.events.splice(sel + 1, 0, { dur: inputDur, dots: 0, rest: true, pitches: [] });
    sel++;
    save();
  }

  function selected() { return sel >= 0 ? score.events[sel] : null; }

  function modify(fn) {
    var ev = selected();
    if (!ev) { RM.toast("Select a note first (tap it, or use ◀ ▶)."); return; }
    snapshot();
    fn(ev);
    save();
  }

  function setAccidental(a) {
    modify(function (ev) {
      if (ev.rest) return;
      var p = ev.pitches[ev.pitches.length - 1];
      p.alt = p.alt === a ? null : a;
    });
  }

  function shift(steps) {
    modify(function (ev) { if (!ev.rest) ev.pitches.forEach(function (p) { p.d += steps; }); });
  }

  // --- Menus ---------------------------------------------------------------------
  function marksMenu() {
    RM.choose("Marks for the selected note", [
      { label: "Dynamic: pp", value: "dyn:pp" }, { label: "Dynamic: p", value: "dyn:p" }, { label: "Dynamic: mp", value: "dyn:mp" },
      { label: "Dynamic: mf", value: "dyn:mf" }, { label: "Dynamic: f", value: "dyn:f" }, { label: "Dynamic: ff", value: "dyn:ff" },
      { label: "Staccato", value: "art:staccato" }, { label: "Accent", value: "art:accent" }, { label: "Tenuto", value: "art:tenuto" },
      { label: "Fermata", value: "art:fermata" }, { label: "Chord symbol…", value: "chord" }, { label: "Remove all marks", value: "clear" }
    ], function (v) {
      if (!v) return;
      if (v === "chord") {
        var ev = selected();
        if (!ev) { RM.toast("Select a note first."); return; }
        RM.prompt({ title: "Chord symbol (e.g. C, Am7, G/B)", value: ev.chord || "" }, function (t) { if (t !== null) modify(function (e) { e.chord = t.trim(); }); });
        return;
      }
      modify(function (ev) {
        if (v === "clear") { ev.dyn = ""; ev.art = ""; ev.chord = ""; return; }
        var kv = v.split(":");
        if (kv[0] === "dyn") ev.dyn = ev.dyn === kv[1] ? "" : kv[1];
        else ev.art = ev.art === kv[1] ? "" : kv[1];
      });
    });
  }

  var DUR_NAMES = { w: "whole", h: "half", q: "quarter", e: "eighth", s: "16th", t: "32nd" };
  function editMenu() {
    RM.choose("Edit", [
      { label: "Make selected a " + DUR_NAMES[inputDur], value: "dur" },
      { label: "Add/remove a dot", value: "dot" },
      { label: "Note ↔ rest", value: "rest" },
      { label: "Move up a step", value: "up" }, { label: "Move down a step", value: "down" },
      { label: "Delete selected", value: "del" }, { label: "Clear all notes", value: "clear" }
    ], function (v) {
      if (!v) return;
      if (v === "clear") { RM.confirm("Delete every note in this score?", function (ok) { if (ok) { snapshot(); score.events = []; sel = -1; save(); } }); return; }
      if (v === "del") { deleteSel(); return; }
      if (v === "up") { shift(1); return; }
      if (v === "down") { shift(-1); return; }
      modify(function (ev) {
        if (v === "dur") ev.dur = inputDur;
        if (v === "dot") ev.dots = ev.dots ? 0 : 1;
        if (v === "rest") {
          if (ev.rest) { ev.rest = false; ev.pitches = [{ d: prevPitch(), alt: null }]; }
          else { ev.rest = true; ev.pitches = []; ev.tie = false; }
        }
      });
    });
  }

  function deleteSel() {
    if (sel < 0) return;
    snapshot();
    score.events.splice(sel, 1);
    sel = Math.min(sel, score.events.length - 1);
    if (sel < 0 && score.events.length) sel = -1;
    save();
  }

  var KEYS = [["C major / A minor", 0], ["G major / E minor (1♯)", 1], ["D major / B minor (2♯)", 2], ["A major / F♯ minor (3♯)", 3], ["E major / C♯ minor (4♯)", 4],
    ["B major / G♯ minor (5♯)", 5], ["F♯ major (6♯)", 6], ["C♯ major (7♯)", 7], ["F major / D minor (1♭)", -1], ["B♭ major / G minor (2♭)", -2],
    ["E♭ major / C minor (3♭)", -3], ["A♭ major / F minor (4♭)", -4], ["D♭ major (5♭)", -5], ["G♭ major (6♭)", -6], ["C♭ major (7♭)", -7]];
  var TIMES = ["2/4", "3/4", "4/4", "5/4", "6/8", "3/8", "9/8", "12/8", "2/2"];

  function settingsMenu() {
    RM.choose("Score settings", [
      { label: "Title: " + score.title, value: "title" }, { label: "Composer: " + (score.composer || "—"), value: "composer" },
      { label: "Tempo: ♩ = " + score.tempo, value: "tempo" }, { label: "Time signature: " + score.time.join("/"), value: "time" },
      { label: "Key: " + KEYS.filter(function (k) { return k[1] === score.key; })[0][0], value: "key" },
      { label: "Clef: " + score.clef, value: "clef" }, { label: "Paper for PDF: " + (lib.paper === "a4" ? "A4" : "US Letter"), value: "paper" }
    ], function (v) {
      if (v === "title" || v === "composer") {
        RM.prompt({ title: v === "title" ? "Title" : "Composer", value: score[v] }, function (t) { if (t !== null) { score[v] = t; save(); } settingsMenu(); });
      } else if (v === "tempo") {
        RM.prompt({ title: "Tempo (quarter notes per minute)", value: String(score.tempo), mode: "number" }, function (t) { var n = parseInt(t, 10); if (n > 0 && n < 400) { score.tempo = n; save(); } settingsMenu(); });
      } else if (v === "time") {
        RM.choose("Time signature", TIMES, function (t) { if (t) { score.time = t.split("/").map(Number); save(); } settingsMenu(); }, { current: score.time.join("/") });
      } else if (v === "key") {
        RM.choose("Key signature", KEYS.map(function (k) { return { label: k[0], value: String(k[1]) }; }), function (k) { if (k !== null) { score.key = parseInt(k, 10); save(); } settingsMenu(); }, { current: String(score.key) });
      } else if (v === "clef") {
        score.clef = score.clef === "treble" ? "bass" : "treble"; save(); settingsMenu();
      } else if (v === "paper") {
        lib.paper = lib.paper === "a4" ? "letter" : "a4"; save(); settingsMenu();
      }
    });
  }

  // Blank scores: no notes, just clef, time and tempo set up.
  var TEMPLATES = [
    { label: "Empty — treble clef, 4/4", clef: "treble", time: [4, 4], tempo: 100 },
    { label: "Empty — bass clef, 4/4", clef: "bass", time: [4, 4], tempo: 100 },
    { label: "Empty — treble clef, 3/4 (waltz)", clef: "treble", time: [3, 4], tempo: 120 },
    { label: "Empty — treble clef, 6/8", clef: "treble", time: [6, 8], tempo: 80 },
    { label: "Empty — treble clef, 2/4 (march)", clef: "treble", time: [2, 4], tempo: 110 }
  ];
  function templateMenu() {
    RM.choose("New empty score", TEMPLATES.map(function (t, i) { return { label: t.label, value: String(i) }; }), function (v) {
      if (v === null || v === undefined) return;
      var t = TEMPLATES[+v], s = N.newScore();
      s.clef = t.clef; s.time = t.time.slice(); s.tempo = t.tempo;
      lib.scores.push(s);
      lib.current = lib.scores.length - 1;
      score = s;
      sel = -1;
      undoStack = [];
      save();
    });
  }

  function fileMenu() {
    var opts = [{ label: "New empty score…", value: "new" }, { label: "Duplicate this score", value: "dup" }];
    lib.scores.forEach(function (s, i) { opts.push({ label: (i === lib.current ? "● " : "Open: ") + (s.title || "Untitled"), value: "open:" + i }); });
    opts.push({ label: "Delete this score", value: "del" });
    RM.choose("Scores", opts, function (v) {
      if (!v) return;
      if (v === "new") { templateMenu(); return; }
      else if (v === "dup") { var c = JSON.parse(JSON.stringify(score)); c.title += " (copy)"; lib.scores.push(c); lib.current = lib.scores.length - 1; }
      else if (v === "del") {
        RM.confirm("Delete \"" + score.title + "\"?", function (ok) {
          if (!ok) return;
          lib.scores.splice(lib.current, 1);
          if (!lib.scores.length) lib.scores.push(N.newScore());
          lib.current = 0;
          score = lib.scores[0];
          sel = score.events.length - 1;
          save();
        });
        return;
      } else lib.current = parseInt(v.split(":")[1], 10);
      score = lib.scores[lib.current];
      sel = score.events.length - 1;
      undoStack = [];
      save();
    });
  }

  function fileBase() {
    return (score.title || "score").replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "_") || "score";
  }

  function exportMenu() {
    RM.choose("Export", [
      { label: "PDF (" + (lib.paper === "a4" ? "A4" : "Letter") + ")", value: "pdf" },
      { label: "PDF and add it to My Files", value: "pdflib" },
      { label: "MIDI file (.mid)", value: "midi" }
    ], function (v) {
      if (!v) return;
      var name = fileBase() + "_" + RM.stamp();
      if (v === "midi") {
        RM.saveFile(name + ".mid", N.toMidi(score), "audio/midi").then(function (p) { RM.toast("Saved MIDI to " + p); }, function (e) { RM.toast("Couldn't save: " + e.message); });
        return;
      }
      var pdf = N.toPdf(score, lib.paper);
      RM.saveFile(name + ".pdf", pdf, "application/pdf").then(function (p) {
        if (v === "pdflib") {
          RM.importPdf(name + ".pdf", score.title || "Score").then(function () {
            RM.toast("Saved " + p + " and added it to My Files. It appears there after the tablet restarts.", 6000);
          }, function (e) { RM.toast("Saved " + p + ", but adding to My Files failed: " + e.message, 6000); });
        } else {
          RM.toast("Saved PDF to " + p, 5000);
        }
      }, function (e) { RM.toast("Couldn't save: " + e.message); });
    });
  }

  // --- Drawing -------------------------------------------------------------------------
  function draw(ctx, W, H) {
    var m = Math.min(W, H), pad = m * 0.03;
    var toolH = RM.toolbar([
      { label: "Scores", fn: fileMenu },
      { label: "Settings", icon: "gear", fn: settingsMenu },
      { label: "Export", fn: exportMenu, bold: true },
      { label: "Undo", icon: "undo", fn: undo, disabled: !undoStack.length }
    ]);
    var keyH = Math.min(m * 0.075, H * 0.065), padH = keyH * 3.4;
    var padY = H - toolH - padH;
    // Title block (tap to edit)
    RM.text(score.title || "Untitled", W / 2, pad * 1.1, m * 0.04, { align: "center", bold: true });
    RM.text(score.composer || "", W - pad, pad * 2.3, m * 0.022, { align: "right" });
    RM.hit(0, 0, W, pad * 2.8, function () { RM.prompt({ title: "Title", value: score.title }, function (t) { if (t !== null) { score.title = t; save(); } }); });
    var pen = N.canvasPen(ctx);
    N.drawTempo(pen, score, pad, pad * 2.4, m * 0.022);

    // Score systems
    var u = Math.max(8, m * 0.0145), sysGap = u * 13, width = W - 2 * pad;
    var areaTop = pad * 3.6 + u * 3, areaH = padY - areaTop - u * 4;
    var visible = Math.max(1, Math.floor(areaH / sysGap));
    var systems = N.layout(score, width, u, visible);
    var selSys = 0;
    systems.forEach(function (s, i) { s.measures.forEach(function (mm) { if (mm.events.indexOf(sel) >= 0) selSys = i; }); });
    if (selSys < viewTop) viewTop = selSys;
    if (selSys >= viewTop + visible) viewTop = selSys - visible + 1;
    viewTop = Math.max(0, Math.min(viewTop, Math.max(0, systems.length - visible)));
    var shown = systems.slice(viewTop, viewTop + visible);
    shown.forEach(function (s, i) { s.first = viewTop + i === 0; });
    var positions = N.draw(pen, score, shown, pad, areaTop, u, sysGap, sel, { showErrors: true });
    if (!score.events.length) RM.text("Pick a duration, then tap a letter (or tap the staff) to add notes.", W / 2, areaTop + u * 9, m * 0.026, { align: "center" });
    // Insertion cursor after the selected event (or at the start).
    var cur = sel >= 0 && positions[sel] ? positions[sel] : null;
    var cx = cur ? cur.x + u * 1.6 : pad + u * 7, ctop = cur ? cur.top : areaTop;
    if (cur || !score.events.length) {
      ctx.fillStyle = "#000";
      ctx.fillRect(cx, ctop - u * 1.4, 3, u * 6.8);
    }
    // Tap a note to select it; tap the staff elsewhere to add a note there.
    shown.forEach(function (s, i) {
      var top = areaTop + i * sysGap;
      RM.hit(pad, top - u * 3, width, u * 10, function (x, y) {
        var d = N.CLEF[score.clef].bottom + Math.round((top + 4 * u - y) / (u / 2));
        insertNote(d);
      });
      s.measures.forEach(function (mm) {
        mm.events.forEach(function (ei) {
          var p = positions[ei];
          if (p) RM.hit(p.x - u * 1.1, top - u * 3, u * 2.2, u * 10, function () { sel = ei; });
        });
      });
    });
    if (systems.length > visible) {
      RM.text("Lines " + (viewTop + 1) + "–" + Math.min(systems.length, viewTop + visible) + " of " + systems.length, W - pad, padY - u * 2, m * 0.02, { align: "right" });
      RM.button(pad, padY - u * 3.6, m * 0.12, u * 3, "▲", function () { viewTop = Math.max(0, viewTop - 1); sel = systems[viewTop].measures[0].events[0] - 1; }, { px: u * 1.6 });
      RM.button(pad + m * 0.13, padY - u * 3.6, m * 0.12, u * 3, "▼", function () {
        var t = Math.min(systems.length - 1, viewTop + visible);
        var evs = systems[t].measures[0].events;
        if (evs.length) sel = evs[0];
      }, { px: u * 1.6 });
    }

    // Status line
    var ev = selected();
    var info = "Input: " + DUR_NAMES[inputDur] + (chordMode ? " · CHORD MODE" : "") + "   ·   Selected: " +
      (ev ? (ev.rest ? DUR_NAMES[ev.dur] + " rest" : ev.pitches.map(N.pitchName).join("+") + " " + DUR_NAMES[ev.dur]) + (ev.dots ? " dotted" : "") + (ev.tie ? ", tied" : "") : "start");
    RM.text(info, W / 2, padY + keyH * 0.18, RM.fitPx(info, W - 2 * pad, keyH * 0.32), { align: "center" });

    // Music keypad
    var rows = [
      [["whole", function () { inputDur = "w"; }, inputDur === "w"], ["half", function () { inputDur = "h"; }, inputDur === "h"], ["quarter", function () { inputDur = "q"; }, inputDur === "q"],
       ["8th", function () { inputDur = "e"; }, inputDur === "e"], ["16th", function () { inputDur = "s"; }, inputDur === "s"], ["32nd", function () { inputDur = "t"; }, inputDur === "t"],
       ["rest", insertRest], ["dot", function () { modify(function (e) { e.dots = ((e.dots || 0) + 1) % 3; }); }]],
      [["C", function () { insertNote(letterPitch(0)); }], ["D", function () { insertNote(letterPitch(1)); }], ["E", function () { insertNote(letterPitch(2)); }],
       ["F", function () { insertNote(letterPitch(3)); }], ["G", function () { insertNote(letterPitch(4)); }], ["A", function () { insertNote(letterPitch(5)); }],
       ["B", function () { insertNote(letterPitch(6)); }], ["♯", function () { setAccidental(1); }], ["♭", function () { setAccidental(-1); }], ["♮", function () { setAccidental(0); }]],
      [["◀", function () { sel = Math.max(-1, sel - 1); }], ["▶", function () { sel = Math.min(score.events.length - 1, sel + 1); }], ["⌫", deleteSel],
       ["oct −", function () { shift(-7); }], ["oct +", function () { shift(7); }], ["tie", function () { modify(function (e) { if (!e.rest) e.tie = !e.tie; }); }],
       ["chord", function () { chordMode = !chordMode; }, chordMode], ["marks", marksMenu], ["edit", editMenu]]
    ];
    rows.forEach(function (row, r) {
      // The delete key gets double width so it's easy to find.
      var units = row.reduce(function (n, k) { return n + (k[0] === "⌫" ? 2 : 1); }, 0);
      var kw = (W - 2 * pad) / units, ky = padY + keyH * (0.4 + r), kx = pad;
      row.forEach(function (k) {
        var w = kw * (k[0] === "⌫" ? 2 : 1);
        if (k[0] === "⌫") RM.button(kx + 3, ky + 3, w - 6, keyH - 6, "delete", k[1], { icon: "backspace", iconInline: true, lineWidth: 4 });
        else RM.button(kx + 3, ky + 3, w - 6, keyH - 6, k[0], k[1], { active: !!k[2], bold: r === 1, px: keyH * (k[0].length > 3 ? 0.3 : 0.42) });
        kx += w;
      });
    });
  }

  RM.init({ draw: draw, beforeExit: save });
})();
