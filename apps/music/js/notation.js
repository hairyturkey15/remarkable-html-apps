// Music notation core: score model, layout, drawing (to canvas or PDF
// through one small "pen" interface), PDF writer and MIDI writer.
var Notation = (function () {
  "use strict";

  var DUR = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25, t: 0.125 };
  var FLAGS = { w: 0, h: 0, q: 0, e: 1, s: 2, t: 3 };
  var LETTERS = "CDEFGAB";
  var SEMI = [0, 2, 4, 5, 7, 9, 11];
  var SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B (letter indexes)
  var FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3]; // B E A D G C F
  // Key-signature staff positions (diatonic numbers) for treble clef.
  var SHARP_POS = [38, 35, 39, 36, 33, 37, 34], FLAT_POS = [34, 37, 33, 36, 32, 35, 31];
  var CLEF = { treble: { bottom: 30, middle: 34 }, bass: { bottom: 18, middle: 22 } };
  var DYN_VEL = { ppp: 20, pp: 33, p: 45, mp: 60, mf: 75, f: 92, ff: 108, fff: 122 };

  function newScore() {
    return { title: "Untitled", composer: "", tempo: 100, time: [4, 4], key: 0, clef: "treble", events: [] };
  }

  function evDur(ev) { return DUR[ev.dur] * (ev.dots === 1 ? 1.5 : ev.dots === 2 ? 1.75 : 1); }

  // Diatonic number d = octave * 7 + letter index (C4 = 28).
  function pitchName(p) { return LETTERS[((p.d % 7) + 7) % 7] + Math.floor(p.d / 7); }

  // Key-signature alteration for a letter index.
  function keyAlter(key, letter) {
    if (key > 0) return SHARP_ORDER.slice(0, key).indexOf(letter) >= 0 ? 1 : 0;
    if (key < 0) return FLAT_ORDER.slice(0, -key).indexOf(letter) >= 0 ? -1 : 0;
    return 0;
  }

  // MIDI pitches for every event, applying key signature and accidentals
  // that carry to the end of the bar.
  function midiPitches(score) {
    var cap = score.time[0] * 4 / score.time[1], pos = 0, carry = {}, out = [];
    score.events.forEach(function (ev) {
      var ps = ev.rest ? [] : ev.pitches.map(function (p) {
        var letter = ((p.d % 7) + 7) % 7, oct = Math.floor(p.d / 7), alt;
        if (p.alt !== null && p.alt !== undefined) { alt = p.alt; carry[p.d] = p.alt; }
        else if (carry[p.d] !== undefined) alt = carry[p.d];
        else alt = keyAlter(score.key, letter);
        return 12 * (oct + 1) + SEMI[letter] + alt;
      });
      out.push(ps);
      pos += evDur(ev);
      if (pos >= cap - 1e-9) { pos -= cap; carry = {}; }
    });
    return out;
  }

  // --- Layout --------------------------------------------------------------
  // Splits events into measures, then measures into systems that fit width.
  function measures(score) {
    var cap = score.time[0] * 4 / score.time[1], out = [], cur = { events: [], full: false }, pos = 0;
    score.events.forEach(function (ev, i) {
      cur.events.push(i);
      pos += evDur(ev);
      if (pos >= cap - 1e-9) {
        cur.full = true;
        cur.over = pos > cap + 1e-9;
        out.push(cur);
        cur = { events: [], full: false };
        pos = 0;
      }
    });
    if (cur.events.length || !out.length) out.push(cur);
    return out;
  }

  function eventWidth(score, ev, u) {
    var w = u * (1.6 + 1.6 * Math.sqrt(evDur(ev)));
    if (!ev.rest && ev.pitches.some(function (p) { return p.alt !== null && p.alt !== undefined; })) w += u * 1.1;
    if (ev.dots) w += u * 0.6 * ev.dots;
    return w;
  }

  // u = staff space (distance between staff lines). An empty score lays
  // out as blank manuscript: `blank` full-width systems of empty bars.
  function layout(score, width, u, blank) {
    var ms = measures(score), systems = [], sys = null;
    var keyW = Math.abs(score.key) * u * 1.0;
    var headerW = function (first) { return u * 3.6 + keyW + (first ? u * 2.4 : 0) + u; };
    if (!score.events.length) {
      for (var b = 0; b < (blank || 6); b++) {
        var hw = headerW(b === 0), bars = 4, bw = (width - hw) / bars, ms0 = [];
        for (var k = 0; k < bars; k++) ms0.push({ index: k, events: [], positions: [], x: hw + k * bw, w: bw, width: bw, full: true, blank: true });
        systems.push({ measures: ms0, first: b === 0, headerW: hw, width: width, blank: true });
      }
      return systems;
    }
    ms.forEach(function (m, mi) {
      var mw = u * 1.2 + m.events.reduce(function (s, i) { return s + eventWidth(score, score.events[i], u); }, 0);
      if (!m.events.length) mw = u * 4;
      if (!sys || sys.used + mw > width) {
        sys = { measures: [], used: headerW(!systems.length), first: !systems.length };
        systems.push(sys);
      }
      sys.measures.push({ index: mi, events: m.events, width: mw, full: m.full, over: m.over });
      sys.used += mw;
    });
    // Stretch every system but the last to the full width.
    systems.forEach(function (s, si) {
      var hw = headerW(s.first), natural = s.used - hw;
      var scale = si < systems.length - 1 ? (width - hw) / natural : Math.min(1.25, (width - hw) / natural);
      var x = hw;
      s.headerW = hw;
      s.measures.forEach(function (m) {
        m.x = x;
        m.w = m.width * scale;
        var ex = x + u * 0.8;
        m.positions = m.events.map(function (i) {
          var ew = eventWidth(score, score.events[i], u) * scale, px = ex + (score.events[i].rest ? 0 : 0);
          ex += ew;
          return { index: i, x: px + u * 0.6 };
        });
        x += m.w;
      });
      s.width = x;
    });
    return systems;
  }

  // --- Drawing through a pen -----------------------------------------------------
  // pen: line(x1,y1,x2,y2,w) · fillPath(cmds) · strokePath(cmds,w) ·
  //      ellipse(cx,cy,rx,ry,rot,filled,w) · rect(x,y,w,h) · text(s,x,y,size,style,align)
  // cmds: [["M",x,y],["L",x,y],["C",x1,y1,x2,y2,x,y],["Z"]]

  function staffY(clef, d, top, u) {
    // top = y of the top staff line; bottom line is top + 4u.
    return top + 4 * u - (d - CLEF[clef].bottom) * u / 2;
  }

  function drawTrebleClef(pen, x, top, u) {
    var y = top;
    // A stylized G clef: spiral around the G line plus a long stem.
    pen.strokePath([
      ["M", x + u * 1.15, y + u * 3.2],
      ["C", x + u * 0.4, y + u * 3.3, x + u * 0.35, y + u * 2.3, x + u * 1.05, y + u * 2.05],
      ["C", x + u * 1.9, y + u * 1.85, x + u * 2.2, y + u * 3.2, x + u * 1.5, y + u * 3.75],
      ["C", x + u * 0.6, y + u * 4.4, x - u * 0.2, y + u * 3.3, x + u * 0.5, y + u * 2.2],
      ["C", x + u * 1.2, y + u * 1.2, x + u * 1.9, y + u * 0.4, x + u * 1.7, y - u * 0.6],
      ["C", x + u * 1.55, y - u * 1.4, x + u * 0.9, y - u * 1.0, x + u * 0.95, y - u * 0.2],
      ["L", x + u * 1.45, y + u * 5.3],
      ["C", x + u * 1.5, y + u * 6.0, x + u * 0.7, y + u * 6.1, x + u * 0.65, y + u * 5.5]
    ], Math.max(1.5, u * 0.18));
    pen.ellipse(x + u * 0.8, y + u * 5.45, u * 0.28, u * 0.28, 0, true);
  }

  function drawBassClef(pen, x, top, u) {
    var y = top;
    pen.strokePath([
      ["M", x + u * 0.3, y + u * 1.0],
      ["C", x + u * 0.6, y - u * 0.1, x + u * 2.3, y - u * 0.1, x + u * 2.2, y + u * 1.4],
      ["C", x + u * 2.1, y + u * 2.8, x + u * 1.1, y + u * 3.6, x + u * 0.1, y + u * 4.0]
    ], Math.max(1.5, u * 0.22));
    pen.ellipse(x + u * 0.55, y + u * 1.05, u * 0.32, u * 0.32, 0, true);
    pen.ellipse(x + u * 2.75, y + u * 0.55, u * 0.17, u * 0.17, 0, true);
    pen.ellipse(x + u * 2.75, y + u * 1.45, u * 0.17, u * 0.17, 0, true);
  }

  function drawAccidental(pen, kind, x, y, u) {
    var lw = Math.max(1, u * 0.12);
    if (kind === 1) {
      pen.line(x - u * 0.15, y - u * 1.1, x - u * 0.15, y + u * 0.9, lw);
      pen.line(x + u * 0.25, y - u * 0.9, x + u * 0.25, y + u * 1.1, lw);
      pen.line(x - u * 0.45, y - u * 0.25, x + u * 0.55, y - u * 0.45, lw * 2.4);
      pen.line(x - u * 0.45, y + u * 0.45, x + u * 0.55, y + u * 0.25, lw * 2.4);
    } else if (kind === -1) {
      pen.line(x - u * 0.3, y - u * 1.5, x - u * 0.3, y + u * 0.5, lw);
      pen.strokePath([["M", x - u * 0.3, y + u * 0.5], ["C", x + u * 0.6, y - u * 0.1, x + u * 0.5, y - u * 0.7, x - u * 0.3, y - u * 0.2]], lw * 1.8);
    } else {
      pen.line(x - u * 0.25, y - u * 1.2, x - u * 0.25, y + u * 0.5, lw);
      pen.line(x + u * 0.25, y - u * 0.5, x + u * 0.25, y + u * 1.2, lw);
      pen.line(x - u * 0.25, y - u * 0.3, x + u * 0.25, y - u * 0.45, lw * 2.2);
      pen.line(x - u * 0.25, y + u * 0.45, x + u * 0.25, y + u * 0.3, lw * 2.2);
    }
  }

  function drawRest(pen, dur, x, top, u) {
    var mid = top + 2 * u;
    if (dur === "w") pen.rect(x - u * 0.6, top + u, u * 1.2, u * 0.5);
    else if (dur === "h") pen.rect(x - u * 0.6, mid - u * 0.5, u * 1.2, u * 0.5);
    else if (dur === "q") {
      pen.strokePath([["M", x - u * 0.2, mid - u * 1.5], ["L", x + u * 0.35, mid - u * 0.7], ["L", x - u * 0.25, mid + u * 0.1], ["L", x + u * 0.35, mid + u * 0.8],
        ["C", x - u * 0.3, mid + u * 0.5, x - u * 0.4, mid + u * 1.2, x + u * 0.1, mid + u * 1.5]], Math.max(1.5, u * 0.22));
    } else {
      var n = FLAGS[dur];
      for (var k = 0; k < n; k++) {
        var yy = mid - u * 0.5 + k * u;
        pen.ellipse(x - u * 0.15, yy, u * 0.22, u * 0.22, 0, true);
        pen.strokePath([["M", x - u * 0.15, yy + u * 0.15], ["C", x + u * 0.15, yy + u * 0.3, x + u * 0.35, yy + u * 0.1, x + u * 0.45, yy - u * 0.1]], Math.max(1, u * 0.12));
      }
      pen.line(x + u * 0.45, mid - u * 0.6, x - u * 0.05 - (n - 1) * u * 0.15, mid + u * (0.4 + n * 0.9), Math.max(1, u * 0.12));
    }
  }

  // Draws systems; selected = event index to highlight (or -1).
  function draw(pen, score, systems, x0, y0, u, sysGap, selected, opts) {
    opts = opts || {};
    var clef = score.clef, ties = [], positions = {};
    systems.forEach(function (s, si) {
      var top = y0 + si * sysGap, right = x0 + s.width;
      for (var l = 0; l < 5; l++) pen.line(x0, top + l * u, right, top + l * u, Math.max(0.8, u * 0.09));
      pen.line(x0, top, x0, top + 4 * u, Math.max(1, u * 0.12));
      var hx = x0 + u * 0.4;
      if (clef === "treble") drawTrebleClef(pen, hx, top, u); else drawBassClef(pen, hx, top, u);
      hx += u * 3.4;
      // Key signature
      var n = Math.abs(score.key), posList = score.key > 0 ? SHARP_POS : FLAT_POS;
      for (var k = 0; k < n; k++) {
        var d = posList[k] - (clef === "bass" ? 14 : 0);
        drawAccidental(pen, score.key > 0 ? 1 : -1, hx + k * u * 1.0 + u * 0.4, staffY(clef, d, top, u), u);
      }
      hx += n * u * 1.0;
      if (s.first) {
        pen.text(String(score.time[0]), hx + u * 1.0, top + u * 1.0, u * 2.1, "bold", "center");
        pen.text(String(score.time[1]), hx + u * 1.0, top + u * 3.0, u * 2.1, "bold", "center");
      }
      s.measures.forEach(function (m, mi) {
        var mx = x0 + m.x;
        m.positions.forEach(function (p) {
          var ev = score.events[p.index], ex = mx + (p.x - m.x);
          positions[p.index] = { x: ex, top: top };
          if (p.index === selected) pen.rect(ex - u * 1.0, top - u * 2.6, u * 2.2, u * 0.35);
          if (ev.rest) {
            drawRest(pen, ev.dur, ex, top, u);
            for (var dd = 0; dd < (ev.dots || 0); dd++) pen.ellipse(ex + u * (0.9 + dd * 0.5), top + u * 1.5, u * 0.15, u * 0.15, 0, true);
          } else {
            drawChord(pen, score, ev, ex, top, u, ties, p.index);
          }
          if (ev.dyn) pen.text(ev.dyn, ex, top + u * 6.2, u * 1.6, "dyn", "center");
          if (ev.chord) pen.text(ev.chord, ex, top - u * 1.6, u * 1.3, "bold", "center");
        });
        var bx = mx + m.w;
        var last = si === systems.length - 1 && mi === s.measures.length - 1;
        if (m.blank) {
          pen.line(bx, top, bx, top + 4 * u, Math.max(1, u * 0.12));
        } else if (last && m.full) {
          pen.line(bx - u * 0.5, top, bx - u * 0.5, top + 4 * u, Math.max(1, u * 0.12));
          pen.rect(bx - u * 0.25, top, u * 0.35, 4 * u);
        } else if (m.full || !last) {
          pen.line(bx, top, bx, top + 4 * u, Math.max(1, u * 0.12));
        }
        if (m.over && opts.showErrors) pen.text("!", bx - u * 0.5, top - u * 0.8, u * 1.4, "bold", "center");
      });
    });
    // Ties: from a note to the same pitch in the next event.
    ties.forEach(function (t) {
      var a = positions[t.index], b = positions[t.index + 1];
      if (!a || !b) return;
      var y = t.y + (t.up ? -u * 0.7 : u * 0.7), dir = t.up ? -1 : 1;
      var x1 = a.x + u * 0.6, x2 = b.top === a.top ? b.x - u * 0.6 : a.x + u * 3;
      pen.strokePath([["M", x1, y], ["C", x1 + (x2 - x1) * 0.25, y + dir * u * 0.9, x2 - (x2 - x1) * 0.25, y + dir * u * 0.9, x2, y]], Math.max(1, u * 0.14));
    });
    return positions;
  }

  function drawChord(pen, score, ev, x, top, u, ties, index) {
    var clef = score.clef, ps = ev.pitches.slice().sort(function (a, b) { return a.d - b.d; });
    var ys = ps.map(function (p) { return staffY(clef, p.d, top, u); });
    var avg = ps.reduce(function (s, p) { return s + p.d; }, 0) / ps.length;
    var up = avg < CLEF[clef].middle;
    var rx = u * 0.62, ry = u * 0.45, hollow = ev.dur === "w" || ev.dur === "h";
    ps.forEach(function (p, i) {
      var y = ys[i];
      // Ledger lines
      var bottom = CLEF[clef].bottom;
      for (var d = bottom - 2; d >= p.d; d -= 2) { var ly = staffY(clef, d, top, u); pen.line(x - u * 1.0, ly, x + u * 1.0, ly, Math.max(0.8, u * 0.09)); }
      for (d = bottom + 10; d <= p.d; d += 2) { ly = staffY(clef, d, top, u); pen.line(x - u * 1.0, ly, x + u * 1.0, ly, Math.max(0.8, u * 0.09)); }
      // Seconds in a chord sit on the other side of the stem.
      var shift = i > 0 && ps[i].d - ps[i - 1].d === 1 && !ps[i - 1].shifted ? (up ? rx * 1.9 : -rx * 1.9) : 0;
      p.shifted = !!shift;
      pen.ellipse(x + shift, y, rx, ry, -0.35, !hollow, Math.max(1.2, u * 0.16));
      if (p.alt !== null && p.alt !== undefined) drawAccidental(pen, p.alt, x - u * 1.5, y, u);
      for (var dd = 0; dd < (ev.dots || 0); dd++) {
        var dy = p.d % 2 === (CLEF[clef].bottom % 2) ? -u * 0.5 : 0; // dots sit in spaces
        pen.ellipse(x + u * (1.15 + dd * 0.5), y + dy, u * 0.15, u * 0.15, 0, true);
      }
      if (ev.tie) ties.push({ index: index, y: y, up: !up });
    });
    if (ev.dur === "w") return;
    var stemX = up ? x + rx * 0.92 : x - rx * 0.92;
    var y1 = up ? ys[0] : ys[ys.length - 1], y2 = up ? ys[ys.length - 1] - u * 3.5 : ys[0] + u * 3.5;
    pen.line(stemX, y1, stemX, y2, Math.max(1, u * 0.12));
    for (var f = 0; f < FLAGS[ev.dur]; f++) {
      var fy = y2 + (up ? 1 : -1) * f * u * 0.8, s = up ? 1 : -1;
      pen.fillPath([["M", stemX, fy], ["C", stemX + u * 0.2, fy + s * u * 1.0, stemX + u * 1.4, fy + s * u * 1.3, stemX + u * 0.9, fy + s * u * 2.6],
        ["C", stemX + u * 1.1, fy + s * u * 1.6, stemX + u * 0.4, fy + s * u * 1.3, stemX, fy + s * u * 1.0], ["Z"]]);
    }
    // Articulations
    var artY = up ? ys[0] + u * 1.2 : ys[0] - u * 1.2;
    if (ev.art === "staccato") pen.ellipse(x, artY, u * 0.18, u * 0.18, 0, true);
    if (ev.art === "accent") { pen.line(x - u * 0.6, artY - u * 0.35, x + u * 0.6, artY, u * 0.14); pen.line(x + u * 0.6, artY, x - u * 0.6, artY + u * 0.35, u * 0.14); }
    if (ev.art === "tenuto") pen.line(x - u * 0.6, artY, x + u * 0.6, artY, u * 0.18);
    if (ev.art === "fermata") {
      var fy2 = top - u * 1.2;
      pen.strokePath([["M", x - u, fy2], ["C", x - u, fy2 - u * 1.2, x + u, fy2 - u * 1.2, x + u, fy2]], u * 0.18);
      pen.ellipse(x, fy2 - u * 0.25, u * 0.16, u * 0.16, 0, true);
    }
  }

  // --- Canvas pen ---------------------------------------------------------------------
  function canvasPen(ctx) {
    function path(cmds) {
      ctx.beginPath();
      cmds.forEach(function (c) {
        if (c[0] === "M") ctx.moveTo(c[1], c[2]);
        else if (c[0] === "L") ctx.lineTo(c[1], c[2]);
        else if (c[0] === "C") ctx.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
        else ctx.closePath();
      });
    }
    return {
      line: function (x1, y1, x2, y2, w) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineWidth = w; ctx.strokeStyle = "#000"; ctx.lineCap = "butt"; ctx.stroke(); },
      fillPath: function (cmds) { path(cmds); ctx.fillStyle = "#000"; ctx.fill(); },
      strokePath: function (cmds, w) { path(cmds); ctx.lineWidth = w; ctx.strokeStyle = "#000"; ctx.lineCap = "round"; ctx.stroke(); ctx.lineCap = "butt"; },
      ellipse: function (cx, cy, rx, ry, rot, filled, w) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot || 0);
        ctx.scale(1, ry / rx);
        ctx.beginPath();
        ctx.arc(0, 0, rx, 0, Math.PI * 2);
        ctx.restore();
        if (filled) { ctx.fillStyle = "#000"; ctx.fill(); } else { ctx.lineWidth = w || 1.5; ctx.strokeStyle = "#000"; ctx.stroke(); }
      },
      rect: function (x, y, w, h) { ctx.fillStyle = "#000"; ctx.fillRect(x, y, w, h); },
      text: function (s, x, y, size, style, align) {
        ctx.font = (style === "dyn" ? "italic bold " : style === "bold" ? "bold " : "") + Math.round(size) + "px " + (style === "dyn" ? "serif" : "sans-serif");
        ctx.fillStyle = "#000";
        ctx.textAlign = align || "left";
        ctx.textBaseline = "middle";
        ctx.fillText(s, x, y);
      }
    };
  }

  // --- PDF pen and writer (standard fonts, vector only) -------------------------------------
  // Helvetica widths (per 1000 em) for printable ASCII 32..126.
  var HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  function textWidth(s, size, bold) {
    var w = 0;
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); w += (c >= 32 && c <= 126 ? HELV[c - 32] : 556) * (bold ? 1.05 : 1); }
    return w * size / 1000;
  }
  // PDF string literal: escape specials; Latin-1 letters as octal codes
  // (WinAnsi encoding), anything else becomes "?".
  function pdfEscape(s) {
    return s.replace(/[\\()]/g, "\\$&").replace(/[^\x20-\x7e]/g, function (ch) {
      var c = ch.charCodeAt(0);
      // WinAnsi puts common typographic marks in 128–159.
      var win = { 8364: 128, 8230: 133, 8216: 145, 8217: 146, 8220: 147, 8221: 148, 8226: 149, 8211: 150, 8212: 151, 8482: 153 };
      if (win[c]) c = win[c];
      return (c >= 160 && c <= 255) || (c >= 128 && c < 160) ? "\\" + ("00" + c.toString(8)).slice(-3) : "?";
    });
  }

  function pdfPen(pageH) {
    var out = [];
    var f = function (n) { return (Math.round(n * 100) / 100).toString(); };
    var Y = function (y) { return pageH - y; };
    function path(cmds) {
      cmds.forEach(function (c) {
        if (c[0] === "M") out.push(f(c[1]) + " " + f(Y(c[2])) + " m");
        else if (c[0] === "L") out.push(f(c[1]) + " " + f(Y(c[2])) + " l");
        else if (c[0] === "C") out.push([c[1], Y(c[2]), c[3], Y(c[4]), c[5], Y(c[6])].map(f).join(" ") + " c");
        else out.push("h");
      });
    }
    return {
      ops: out,
      line: function (x1, y1, x2, y2, w) { out.push(f(w) + " w 0 J " + f(x1) + " " + f(Y(y1)) + " m " + f(x2) + " " + f(Y(y2)) + " l S"); },
      fillPath: function (cmds) { path(cmds); out.push("f"); },
      strokePath: function (cmds, w) { out.push(f(w) + " w 1 J"); path(cmds); out.push("S"); },
      ellipse: function (cx, cy, rx, ry, rot, filled, w) {
        // Four Bézier arcs, rotated.
        var k = 0.5523, c = Math.cos(-(rot || 0)), s = Math.sin(-(rot || 0));
        var P = function (px, py) { return [cx + px * c - py * s, Y(cy) + px * s + py * c]; };
        var pts = [[rx, 0], [rx, ry * k], [rx * k, ry], [0, ry], [-rx * k, ry], [-rx, ry * k], [-rx, 0], [-rx, -ry * k], [-rx * k, -ry], [0, -ry], [rx * k, -ry], [rx, -ry * k], [rx, 0]];
        var p0 = P(pts[0][0], pts[0][1]);
        out.push(f(p0[0]) + " " + f(p0[1]) + " m");
        for (var i = 1; i < pts.length; i += 3) {
          var a = P(pts[i][0], pts[i][1]), b = P(pts[i + 1][0], pts[i + 1][1]), e = P(pts[i + 2][0], pts[i + 2][1]);
          out.push([a[0], a[1], b[0], b[1], e[0], e[1]].map(f).join(" ") + " c");
        }
        out.push(filled ? "f" : f(w || 1) + " w S");
      },
      rect: function (x, y, w, h) { out.push(f(x) + " " + f(Y(y + h)) + " " + f(w) + " " + f(h) + " re f"); },
      text: function (str, x, y, size, style, align) {
        var font = style === "dyn" ? "/F3" : style === "bold" ? "/F2" : "/F1";
        var w = textWidth(str, size, style === "bold");
        var tx = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
        out.push("BT " + font + " " + f(size) + " Tf " + f(tx) + " " + f(Y(y) - size * 0.35) + " Td (" + pdfEscape(str) + ") Tj ET");
      }
    };
  }

  function buildPdf(pages, pageW, pageH, title) {
    var objs = [];
    var add = function (s) { objs.push(s); return objs.length; };
    var catalog = add(null), pagesObj = add(null);
    var fonts = [add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"),
      add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"),
      add("<< /Type /Font /Subtype /Type1 /BaseFont /Times-BoldItalic /Encoding /WinAnsiEncoding >>")];
    var kids = pages.map(function (ops) {
      var content = ops.join("\n");
      var c = add("<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream");
      return add("<< /Type /Page /Parent " + pagesObj + " 0 R /MediaBox [0 0 " + pageW + " " + pageH + "] /Resources << /Font << /F1 " + fonts[0] + " 0 R /F2 " + fonts[1] + " 0 R /F3 " + fonts[2] + " 0 R >> >> /Contents " + c + " 0 R >>");
    });
    objs[catalog - 1] = "<< /Type /Catalog /Pages " + pagesObj + " 0 R >>";
    objs[pagesObj - 1] = "<< /Type /Pages /Kids [" + kids.map(function (k) { return k + " 0 R"; }).join(" ") + "] /Count " + kids.length + " >>";
    var info = add("<< /Title (" + pdfEscape(title) + ") /Producer (reMarkable Score app) >>");
    var pdf = "%PDF-1.4\n", offsets = [];
    objs.forEach(function (o, i) { offsets.push(pdf.length); pdf += (i + 1) + " 0 obj\n" + o + "\nendobj\n"; });
    var xref = pdf.length;
    pdf += "xref\n0 " + (objs.length + 1) + "\n0000000000 65535 f \n";
    offsets.forEach(function (o) { pdf += ("0000000000" + o).slice(-10) + " 00000 n \n"; });
    pdf += "trailer\n<< /Size " + (objs.length + 1) + " /Root " + catalog + " 0 R /Info " + info + " 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
    return pdf;
  }

  // Lays the score out on pages (A4 or Letter) and returns the PDF text.
  function toPdf(score, paper) {
    var pageW = paper === "a4" ? 595.28 : 612, pageH = paper === "a4" ? 841.89 : 792;
    var margin = 50, u = 6.2, sysGap = u * 13, width = pageW - 2 * margin;
    // An empty score prints as one page of blank manuscript.
    var systems = layout(score, width, u, Math.floor((pageH - margin * 2 - 70) / sysGap));
    var pages = [], idx = 0, first = true;
    while (idx < systems.length || first) {
      var pen = pdfPen(pageH), y0 = margin + u * 3;
      if (first) {
        pen.text(score.title || "Untitled", pageW / 2, margin + 10, 22, "bold", "center");
        if (score.composer) pen.text(score.composer, pageW - margin, margin + 38, 11, "", "right");
        drawTempo(pen, score, margin, margin + 38, 11);
        y0 = margin + 70;
      }
      var per = Math.max(1, Math.floor((pageH - y0 - margin) / sysGap));
      var chunk = systems.slice(idx, idx + per);
      if (chunk.length) {
        // Each page draws its systems with their own vertical offsets.
        chunk.forEach(function (s, i) { s.first = idx + i === 0; });
        draw(pen, score, chunk, margin, y0, u, sysGap, -1, {});
      }
      pen.text(String(pages.length + 1), pageW / 2, pageH - margin / 2, 9, "", "center");
      pages.push(pen.ops);
      idx += per;
      first = false;
      if (!chunk.length) break;
    }
    return buildPdf(pages, pageW, pageH, score.title || "Score");
  }

  function drawTempo(pen, score, x, y, size) {
    var u = size * 0.45;
    pen.ellipse(x + u * 0.7, y + u * 0.3, u * 0.62, u * 0.45, -0.35, true);
    pen.line(x + u * 1.27, y + u * 0.3, x + u * 1.27, y - u * 2.8, Math.max(0.8, u * 0.12));
    pen.text("= " + score.tempo, x + u * 2.0, y - u * 0.4, size, "", "left");
  }

  // --- MIDI (Standard MIDI File, format 0) ---------------------------------------------
  function vlq(n) {
    var bytes = [n & 0x7f];
    while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
    return bytes;
  }

  function toMidi(score) {
    var PPQ = 480, track = [], pitches = midiPitches(score), vel = 80, pending = 0;
    var ev = function (delta, bytes) { track.push.apply(track, vlq(delta).concat(bytes)); };
    var tempo = Math.round(60000000 / score.tempo);
    ev(0, [0xFF, 0x51, 0x03, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255]);
    var dd = Math.round(Math.log2(score.time[1]));
    ev(0, [0xFF, 0x58, 0x04, score.time[0], dd, 24, 8]);
    ev(0, [0xFF, 0x59, 0x02, score.key & 255, 0]);
    var title = (score.title || "Score").split("").map(function (c) { return c.charCodeAt(0) & 0x7f; });
    ev(0, [0xFF, 0x03].concat(vlq(title.length), title));
    ev(0, [0xC0, 0]); // piano
    var held = []; // tied notes still sounding
    score.events.forEach(function (e, i) {
      var ticks = Math.round(evDur(e) * PPQ);
      if (e.dyn && DYN_VEL[e.dyn]) vel = DYN_VEL[e.dyn];
      if (e.rest) { pending += ticks; return; }
      var ps = pitches[i];
      ps.forEach(function (p) {
        if (held.indexOf(p) < 0) { ev(pending, [0x90, p, e.art === "accent" ? Math.min(127, vel + 20) : vel]); pending = 0; }
      });
      var len = e.art === "staccato" ? Math.round(ticks * 0.5) : ticks;
      var next = e.tie ? ps : [];
      var off = ps.filter(function (p) { return next.indexOf(p) < 0; });
      held = next;
      if (off.length) {
        off.forEach(function (p, k) { ev(k === 0 ? pending + len : 0, [0x80, p, 64]); });
        pending = ticks - len;
      } else {
        pending += ticks;
      }
    });
    held.forEach(function (p, k) { ev(k === 0 ? pending : 0, [0x80, p, 64]); pending = 0; });
    ev(pending, [0xFF, 0x2F, 0x00]);
    var header = [0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (PPQ >> 8) & 255, PPQ & 255];
    var len = track.length;
    return new Uint8Array(header.concat([0x4D, 0x54, 0x72, 0x6B, (len >> 24) & 255, (len >> 16) & 255, (len >> 8) & 255, len & 255], track));
  }

  return {
    DUR: DUR, LETTERS: LETTERS, CLEF: CLEF, newScore: newScore, evDur: evDur, pitchName: pitchName, measures: measures,
    layout: layout, draw: draw, drawTempo: drawTempo, staffY: staffY, canvasPen: canvasPen, toPdf: toPdf, toMidi: toMidi, midiPitches: midiPitches
  };
})();
