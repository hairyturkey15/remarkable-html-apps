// rmkit: shared toolkit for the canvas apps in html-apps/.
//
// One full-screen <canvas>; the app supplies draw(ctx, W, H) and calls
// RM.redraw() whenever its state changes. The kit owns input (tap targets
// registered while drawing, optional drags, pinch), the standard
// Refresh/Exit buttons, an on-screen keyboard, simple dialogs, storage and
// file export. Nothing runs on a timer unless something asked for it, so
// the e-ink screen only updates after a touch.
var RM = (function () {
  "use strict";

  var onTablet = typeof htmlload !== "undefined" && !!htmlload;
  var canvas = document.getElementById("app") || document.querySelector("canvas");
  var ctx = canvas.getContext("2d");
  var DPR = 1, W = 0, H = 0;
  var app = null;
  var hits = [];
  var drag = null;
  var overlay = null; // keyboard / dialog
  var toastMsg = "", toastTimer = 0, redrawTimer = 0;

  var INK = "#000000", PAPER = "#ffffff", GRAY = "#8c8c8c", LIGHT = "#d9d9d9";
  var FONT = "sans-serif";

  // ------------------------------------------------------------------
  // Drawing helpers
  // ------------------------------------------------------------------
  function font(px, bold, family) {
    ctx.font = (bold ? "bold " : "") + Math.max(6, Math.round(px)) + "px " + (family || FONT);
  }

  function text(str, x, y, px, o) {
    o = o || {};
    font(px, o.bold, o.family);
    ctx.fillStyle = o.color || INK;
    ctx.textAlign = o.align || "left";
    ctx.textBaseline = o.baseline || "middle";
    ctx.fillText(String(str), x, y);
  }

  function measure(str, px, bold, family) {
    font(px, bold, family);
    return ctx.measureText(String(str)).width;
  }

  function fitPx(str, maxW, px, bold, family) {
    while (px > 8 && measure(str, px, bold, family) > maxW) px *= 0.92;
    return px;
  }

  // Word-wraps text into lines that fit maxW. Honors "\n".
  function wrap(str, maxW, px, bold, family) {
    var out = [];
    String(str).split("\n").forEach(function (para) {
      var words = para.split(" "), line = "";
      words.forEach(function (w) {
        var t = line ? line + " " + w : w;
        if (measure(t, px, bold, family) > maxW && line) {
          out.push(line);
          line = w;
        } else {
          line = t;
        }
      });
      out.push(line);
    });
    return out;
  }

  function paragraph(str, x, y, maxW, px, o) {
    o = o || {};
    var lh = px * (o.lineHeight || 1.3);
    var lines = wrap(str, maxW, px, o.bold, o.family);
    lines.forEach(function (l, i) { text(l, x, y + lh * (i + 0.5), px, o); });
    return lines.length * lh;
  }

  function roundRect(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function box(x, y, w, h, o) {
    o = o || {};
    roundRect(x, y, w, h, o.radius === undefined ? Math.min(14, h * 0.2) : o.radius);
    if (o.fill !== null) {
      ctx.fillStyle = o.fill || PAPER;
      ctx.fill();
    }
    if (o.stroke !== null) {
      ctx.lineWidth = o.lineWidth || Math.max(2, Math.min(4, h * 0.04));
      ctx.strokeStyle = o.stroke || INK;
      ctx.stroke();
    }
  }

  function line(x1, y1, x2, y2, w, color) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineWidth = w || 2;
    ctx.strokeStyle = color || INK;
    ctx.stroke();
  }

  // A tap target drawn as a button. o: {active, disabled, bold, px, radius}
  function button(x, y, w, h, label, fn, o) {
    o = o || {};
    box(x, y, w, h, { fill: o.active ? INK : PAPER, stroke: o.disabled ? LIGHT : INK, radius: o.radius, lineWidth: o.lineWidth });
    var color = o.active ? PAPER : (o.disabled ? GRAY : INK);
    if (o.icon && ICONS[o.icon] && o.iconInline) {
      // Icon then a word, side by side (for short keys).
      var ri = h * 0.26, lpx = fitPx(label, w * 0.9 - ri * 3.4, h * 0.36, true);
      var tw = ri * 3 + measure(label, lpx, true), sx = x + (w - tw) / 2;
      ICONS[o.icon](sx + ri * 1.1, y + h / 2, ri, color, o.iconFilled);
      text(label, sx + ri * 3, y + h / 2, lpx, { bold: true, color: color });
    } else if (o.icon && ICONS[o.icon]) {
      // Icon with a small word under it (keyboard keys like delete/enter).
      var r = Math.min(h * 0.22, w * 0.2);
      ICONS[o.icon](x + w / 2, y + h * (label ? 0.38 : 0.5), r, color, o.iconFilled);
      if (label) text(label, x + w / 2, y + h * 0.78, fitPx(label, w * 0.9, h * 0.2, true), { align: "center", bold: true, color: color });
    } else {
      var px = fitPx(label, w * 0.88, o.px || h * 0.42, o.bold, o.family);
      text(label, x + w / 2, y + h / 2, px, { align: "center", bold: o.bold, family: o.family, color: color });
    }
    if (fn && !o.disabled) hit(x, y, w, h, fn);
  }

  // Row of segmented choices; returns nothing, calls fn(value) on tap.
  function segmented(x, y, w, h, opts, current, fn, o) {
    o = o || {};
    var bw = w / opts.length;
    opts.forEach(function (opt, i) {
      var v = Array.isArray(opt) ? opt[0] : opt, label = Array.isArray(opt) ? opt[1] : String(opt);
      button(x + i * bw + 2, y, bw - 4, h, label, function () { fn(v); }, { active: v === current, px: o.px, disabled: o.disabled });
    });
  }

  // ------------------------------------------------------------------
  // Hit testing. fn(x, y) runs on tap; a {down, move, up} object gets
  // the whole gesture (used for dragging).
  // ------------------------------------------------------------------
  function hit(x, y, w, h, fn) {
    hits.push({ x: x, y: y, w: w, h: h, fn: fn });
  }

  function findHit(x, y) {
    for (var i = hits.length - 1; i >= 0; i--) {
      var t = hits[i];
      if (x >= t.x && y >= t.y && x < t.x + t.w && y < t.y + t.h) return t;
    }
    return null;
  }

  function onDown(x, y) {
    var t = findHit(x, y);
    if (!t) return;
    if (typeof t.fn === "function") {
      t.fn(x, y);
      redraw();
    } else if (t.fn && t.fn.down) {
      drag = t.fn;
      drag.down(x, y);
      redraw();
    }
  }

  var lastMoveDraw = 0;
  function onMove(x, y) {
    if (!drag || !drag.move) return;
    drag.move(x, y);
    // Throttle redraws while dragging: e-ink can't keep up anyway.
    var now = Date.now();
    if (now - lastMoveDraw > 90) {
      lastMoveDraw = now;
      redraw();
    } else {
      redrawSoon(90);
    }
  }

  function onUp(x, y) {
    if (!drag) return;
    var d = drag;
    drag = null;
    if (d.up) d.up(x, y);
    redraw();
  }

  canvas.addEventListener("pointerdown", function (e) { if (e.preventDefault) e.preventDefault(); onDown(e.offsetX, e.offsetY); });
  canvas.addEventListener("pointermove", function (e) { onMove(e.offsetX, e.offsetY); });
  canvas.addEventListener("pointerup", function (e) { onUp(e.offsetX, e.offsetY); });
  canvas.addEventListener("pointercancel", function () { if (drag) { drag = null; redraw(); } });

  // ------------------------------------------------------------------
  // Pinch: the tablet runtime sends "htmlpinch"; browsers get the same
  // from two-finger touches or ctrl + mouse wheel.
  // ------------------------------------------------------------------
  var pinchHandler = null;
  function onPinch(fn) { pinchHandler = fn; }
  function emitPinch(phase, scale, cx, cy) {
    if (!pinchHandler) return;
    drag = null;
    pinchHandler({ phase: phase, scale: scale, centerX: cx, centerY: cy });
    redraw();
  }
  window.addEventListener("htmlpinch", function (e) { emitPinch(e.phase, e.scale, e.centerX, e.centerY); });
  if (!onTablet) {
    var touchStart = null;
    var dist = function (t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); };
    canvas.addEventListener("touchstart", function (e) {
      if (e.touches.length === 2) {
        touchStart = dist(e.touches);
        emitPinch("start", 1, (e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2);
      }
    });
    canvas.addEventListener("touchmove", function (e) {
      if (touchStart && e.touches.length === 2) {
        e.preventDefault();
        emitPinch("move", dist(e.touches) / touchStart, (e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2);
      }
    }, { passive: false });
    canvas.addEventListener("touchend", function () {
      if (touchStart) { touchStart = null; emitPinch("end", 1, 0, 0); }
    });
    canvas.addEventListener("wheel", function (e) {
      if (!e.ctrlKey || !pinchHandler) return;
      e.preventDefault();
      var s = Math.exp(-e.deltaY / 200);
      emitPinch("start", 1, e.offsetX, e.offsetY);
      emitPinch("end", s, e.offsetX, e.offsetY);
    }, { passive: false });
  }

  // ------------------------------------------------------------------
  // Redraw
  // ------------------------------------------------------------------
  function redraw() {
    clearTimeout(redrawTimer);
    redrawTimer = 0;
    if (!app || W <= 0 || H <= 0) return;
    hits = [];
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, W, H);
    app.draw(ctx, W, H);
    if (overlay) overlay.draw();
    if (toastMsg) drawToast();
  }

  function redrawSoon(ms) {
    if (!redrawTimer) redrawTimer = setTimeout(redraw, ms || 30);
  }

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    if (!onTablet) {
      DPR = window.devicePixelRatio || 1;
      canvas.width = Math.round(W * DPR);
      canvas.height = Math.round(H * DPR);
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
    }
    if (app && app.resize) app.resize(W, H);
    redraw();
  }

  // ------------------------------------------------------------------
  // Standard buttons
  // ------------------------------------------------------------------
  // Clears e-ink ghosting: the runtime flashes the screen natively; in a
  // browser a quick black/white canvas flash stands in for it.
  function refresh() {
    if (onTablet && htmlload.refresh) {
      htmlload.refresh(80);
      return;
    }
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, W, H);
    setTimeout(function () {
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, W, H);
      setTimeout(redraw, 80);
    }, 80);
  }

  function exit() {
    if (app && app.beforeExit) app.beforeExit();
    if (onTablet) htmlload.close();
    else toast("Exit closes the app on the tablet");
  }

  var ICONS = {
    refresh: function (cx, cy, r, c) {
      ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = Math.max(2, r * 0.22);
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.72, Math.PI * 0.15, Math.PI * 1.75); ctx.stroke();
      var ax = cx + r * 0.72 * Math.cos(Math.PI * 1.75), ay = cy + r * 0.72 * Math.sin(Math.PI * 1.75);
      ctx.beginPath(); ctx.moveTo(ax + r * 0.42, ay - r * 0.05); ctx.lineTo(ax - r * 0.05, ay - r * 0.42); ctx.lineTo(ax - r * 0.02, ay + r * 0.28); ctx.closePath(); ctx.fill();
    },
    exit: function (cx, cy, r, c) {
      ctx.strokeStyle = c; ctx.lineWidth = Math.max(2, r * 0.22); ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(cx - r * 0.6, cy - r * 0.6); ctx.lineTo(cx + r * 0.6, cy + r * 0.6);
      ctx.moveTo(cx + r * 0.6, cy - r * 0.6); ctx.lineTo(cx - r * 0.6, cy + r * 0.6); ctx.stroke(); ctx.lineCap = "butt";
    },
    undo: function (cx, cy, r, c, dir) {
      dir = dir || -1;
      ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = Math.max(2, r * 0.22);
      ctx.beginPath(); ctx.arc(cx, cy + r * 0.25, r * 0.8, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
      var ex = cx + dir * r * 0.8 * Math.cos(Math.PI * 0.05), ey = cy + r * 0.25 - r * 0.8 * Math.sin(Math.PI * 0.05);
      ctx.beginPath(); ctx.moveTo(ex + dir * r * 0.32, ey - r * 0.05); ctx.lineTo(ex - dir * r * 0.05, ey + r * 0.42); ctx.lineTo(ex - dir * r * 0.4, ey - r * 0.12); ctx.closePath(); ctx.fill();
    },
    redo: function (cx, cy, r, c) { ICONS.undo(cx, cy, r, c, 1); },
    gear: function (cx, cy, r, c) {
      ctx.beginPath();
      for (var i = 0; i < 16; i++) {
        var a0 = (i / 16) * Math.PI * 2 - Math.PI / 16;
        ctx.arc(cx, cy, i % 2 === 0 ? r : r * 0.76, a0, a0 + Math.PI / 8);
      }
      ctx.closePath(); ctx.fillStyle = c; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.32, 0, Math.PI * 2); ctx.fillStyle = PAPER; ctx.fill();
    },
    // Keyboard keys: drawn, because the tablet's font renders ⌫ ↵ ⇧ small.
    backspace: function (cx, cy, r, c) {
      var w = r * 1.9, h = r * 1.25, x = cx - w / 2 + r * 0.15, t = cy - h / 2;
      ctx.strokeStyle = c; ctx.lineWidth = Math.max(2, r * 0.16); ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(x, t); ctx.lineTo(x + w, t); ctx.lineTo(x + w, t + h); ctx.lineTo(x, t + h);
      ctx.lineTo(x - r * 0.62, cy); ctx.closePath(); ctx.stroke();
      var mx = x + w * 0.5, d = h * 0.24;
      ctx.beginPath(); ctx.moveTo(mx - d, cy - d); ctx.lineTo(mx + d, cy + d); ctx.moveTo(mx + d, cy - d); ctx.lineTo(mx - d, cy + d); ctx.stroke();
      ctx.lineJoin = "miter"; ctx.lineCap = "butt";
    },
    enter: function (cx, cy, r, c) {
      ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = Math.max(2, r * 0.2); ctx.lineJoin = "round";
      var right = cx + r * 0.85, top = cy - r * 0.7, base = cy + r * 0.25, tip = cx - r * 0.95;
      ctx.beginPath(); ctx.moveTo(right, top); ctx.lineTo(right, base); ctx.lineTo(tip + r * 0.45, base); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(tip, base); ctx.lineTo(tip + r * 0.55, base - r * 0.42); ctx.lineTo(tip + r * 0.55, base + r * 0.42); ctx.closePath(); ctx.fill();
      ctx.lineJoin = "miter";
    },
    shift: function (cx, cy, r, c, filled) {
      var hw = r * 0.85, sw = r * 0.38, top = cy - r * 0.85, mid = cy - r * 0.05, bot = cy + r * 0.75;
      ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx + hw, mid); ctx.lineTo(cx + sw, mid); ctx.lineTo(cx + sw, bot);
      ctx.lineTo(cx - sw, bot); ctx.lineTo(cx - sw, mid); ctx.lineTo(cx - hw, mid); ctx.closePath();
      ctx.lineJoin = "round"; ctx.strokeStyle = c; ctx.lineWidth = Math.max(2, r * 0.16); ctx.stroke(); ctx.lineJoin = "miter";
      if (filled) { ctx.fillStyle = c; ctx.fill(); }
    },
    plus: function (cx, cy, r, c) {
      ctx.strokeStyle = c; ctx.lineWidth = Math.max(2, r * 0.22);
      ctx.beginPath(); ctx.moveTo(cx - r * 0.75, cy); ctx.lineTo(cx + r * 0.75, cy); ctx.moveTo(cx, cy - r * 0.75); ctx.lineTo(cx, cy + r * 0.75); ctx.stroke();
    }
  };

  // Bottom toolbar: the app's items, then Refresh and Exit on the right.
  // items: [{label, fn, icon?, disabled?, active?}]. Returns its height.
  function toolbar(items, o) {
    o = o || {};
    var m = Math.min(W, H);
    var h = o.height || Math.round(Math.max(54, m * 0.085));
    var y = H - h;
    var all = (items || []).concat([
      { label: "Refresh", icon: "refresh", fn: refresh },
      { label: "Exit", icon: "exit", fn: exit }
    ]);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, y, W, h);
    line(0, y + 1, W, y + 1, 2);
    var bw = W / all.length;
    all.forEach(function (it, i) {
      var bx = i * bw, color = it.disabled ? "#b0b0b0" : (it.active ? PAPER : INK);
      if (it.active) {
        box(bx + bw * 0.06, y + h * 0.1, bw * 0.88, h * 0.8, { fill: INK, stroke: INK });
      }
      if (it.icon && ICONS[it.icon]) {
        ICONS[it.icon](bx + bw / 2, y + h * 0.36, h * 0.2, color);
        text(it.label, bx + bw / 2, y + h * 0.76, fitPx(it.label, bw * 0.92, h * 0.2), { align: "center", color: color });
      } else {
        text(it.label, bx + bw / 2, y + h / 2, fitPx(it.label, bw * 0.9, h * 0.3), { align: "center", color: color, bold: it.bold });
      }
      if (!it.disabled) hit(bx, y, bw, h, it.fn);
    });
    return h;
  }

  // ------------------------------------------------------------------
  // Toast (one timeout, then gone)
  // ------------------------------------------------------------------
  function toast(msg, ms) {
    toastMsg = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastMsg = ""; redraw(); }, ms || 3500);
    redraw();
  }

  function drawToast() {
    var m = Math.min(W, H), px = m * 0.032;
    var lines = wrap(toastMsg, W * 0.8, px);
    var h = lines.length * px * 1.35 + px * 1.4, w = W * 0.86;
    var x = (W - w) / 2, y = H * 0.42 - h / 2;
    box(x, y, w, h, { fill: PAPER, lineWidth: 4 });
    lines.forEach(function (l, i) { text(l, W / 2, y + px * 0.7 + px * 1.35 * (i + 0.5), px, { align: "center" }); });
    hit(x, y, w, h, function () { toastMsg = ""; });
  }

  // ------------------------------------------------------------------
  // On-screen keyboard. RM.prompt({title, value, mode: "text"|"number"|
  // "math", multiline}, function (value) {...}); value is null on cancel.
  // ------------------------------------------------------------------
  var LAYOUTS = {
    text: [["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
           ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
           ["a", "s", "d", "f", "g", "h", "j", "k", "l", "'"],
           ["⇧", "z", "x", "c", "v", "b", "n", "m", ",", "⌫"],
           ["#+=", "◀", "space", ".", "▶", "↵"]],
    symbols: [["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
              ["+", "-", "*", "/", "=", "(", ")", "[", "]", "^"],
              ["@", "#", "$", "%", "&", "_", ":", ";", "\"", "!"],
              ["<", ">", "{", "}", "|", "~", "?", "\\", "°", "⌫"],
              ["abc", "◀", "space", ",", "▶", "↵"]],
    number: [["7", "8", "9", "⌫"], ["4", "5", "6", "-"], ["1", "2", "3", "e"], ["0", ".", "◀", "▶"], ["↵"]]
  };

  var SPECIAL_KEYS = {
    "⌫": { icon: "backspace", label: "delete" },
    "↵": { icon: "enter", label: "enter" },
    "⇧": { icon: "shift", label: "shift" }
  };
  function keyUnits(k) { return k === "space" ? 4 : (k === "↵" ? 2 : (k === "⌫" || k === "⇧" ? 1.5 : 1)); }

  function prompt(opts, cb) {
    var st = {
      title: opts.title || "", value: String(opts.value === undefined ? "" : opts.value),
      layout: opts.mode === "number" ? "number" : (opts.mode === "math" ? "symbols" : "text"),
      shift: false, multiline: !!opts.multiline, mono: !!opts.mono
    };
    st.cursor = st.value.length;
    function finish(v) { overlay = null; cb(v); redraw(); }
    function key(k) {
      var v = st.value, c = st.cursor;
      if (k === "⌫") { if (c > 0) { st.value = v.slice(0, c - 1) + v.slice(c); st.cursor--; } }
      else if (k === "◀") st.cursor = Math.max(0, c - 1);
      else if (k === "▶") st.cursor = Math.min(v.length, c + 1);
      else if (k === "⇧") st.shift = !st.shift;
      else if (k === "#+=") st.layout = "symbols";
      else if (k === "abc") st.layout = "text";
      else if (k === "↵") { if (st.multiline) insert("\n"); else finish(st.value); }
      else insert(k === "space" ? " " : (st.shift ? k.toUpperCase() : k));
      function insert(s) { st.value = v.slice(0, c) + s + v.slice(c); st.cursor = c + s.length; if (st.shift) st.shift = false; }
    }
    overlay = {
      draw: function () {
        hit(0, 0, W, H, function () {});
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.fillRect(0, 0, W, H);
        var m = Math.min(W, H), rows = LAYOUTS[st.layout];
        var keyH = Math.min(m * 0.1, H * 0.085), panelH = keyH * (rows.length + 2.6) + (st.multiline ? keyH * 2 : 0);
        var y0 = H - panelH, pad = m * 0.02;
        box(pad / 2, y0, W - pad, panelH - pad / 2, { fill: PAPER, lineWidth: 4 });
        var titleW = W - pad * 4.5 - keyH * 4.6;
        text(st.title, pad * 1.5, y0 + keyH * 0.45, fitPx(st.title, titleW, keyH * 0.32, true), { bold: true });
        button(W - pad * 1.5 - keyH * 2.2, y0 + keyH * 0.1, keyH * 2.2, keyH * 0.7, "Cancel", function () { finish(null); }, { px: keyH * 0.28 });
        button(W - pad * 2.5 - keyH * 4.6, y0 + keyH * 0.1, keyH * 2.2, keyH * 0.7, "Done", function () { finish(st.value); }, { px: keyH * 0.28, bold: true });
        // Value with a caret.
        var fieldH = keyH * (st.multiline ? 3 : 1.1), fy = y0 + keyH * 0.95;
        box(pad * 1.5, fy, W - pad * 3, fieldH, { radius: 8, lineWidth: 2 });
        var px = keyH * 0.4, fam = st.mono ? "monospace" : FONT;
        var shown = st.value.slice(0, st.cursor) + "│" + st.value.slice(st.cursor);
        if (st.multiline) {
          var ls = shown.split("\n").slice(-Math.floor(fieldH / (px * 1.2)));
          ls.forEach(function (l, i) { text(l, pad * 2.2, fy + px * 0.8 + i * px * 1.2, px, { family: fam }); });
        } else {
          var maxW = W - pad * 5;
          while (shown.length > 1 && measure(shown, px, false, fam) > maxW) shown = shown.slice(1);
          text(shown, pad * 2.2, fy + fieldH / 2, px, { family: fam });
        }
        var ky = fy + fieldH + keyH * 0.25;
        rows.forEach(function (row, r) {
          var units = row.reduce(function (s, k) { return s + keyUnits(k); }, 0);
          var kw = (W - pad * 3) / Math.max(units, 10);
          var x = (W - kw * units) / 2;
          row.forEach(function (k) {
            var w = kw * keyUnits(k), bx = x + 3, by = ky + r * keyH + 3;
            var special = SPECIAL_KEYS[k];
            if (special) {
              var on = k === "⇧" && st.shift;
              button(bx, by, w - 6, keyH - 6, k === "↵" && st.multiline ? "new line" : special.label, function () { key(k); },
                { icon: special.icon, active: k === "↵", iconFilled: on, lineWidth: 3 });
            } else {
              var label = k === "space" ? "space" : (st.shift && k.length === 1 ? k.toUpperCase() : k);
              button(bx, by, w - 6, keyH - 6, label, function () { key(k); },
                { px: keyH * (label.length > 2 ? 0.28 : 0.42), family: fam });
            }
            x += w;
          });
        });
      }
    };
    redraw();
  }

  // ------------------------------------------------------------------
  // Dialogs: choose from a list, confirm, show text
  // ------------------------------------------------------------------
  function choose(title, options, cb, o) {
    o = o || {};
    var page = 0;
    overlay = {
      draw: function () {
        hit(0, 0, W, H, function () { overlay = null; cb(null); });
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.fillRect(0, 0, W, H);
        var m = Math.min(W, H), rowH = Math.min(m * 0.085, H * 0.07);
        var perPage = Math.max(3, Math.floor((H * 0.8) / rowH) - 2);
        var pages = Math.ceil(options.length / perPage);
        var shown = options.slice(page * perPage, (page + 1) * perPage);
        var w = Math.min(W * 0.9, m * 0.9), h = rowH * (shown.length + 1.6 + (pages > 1 ? 1.1 : 0));
        var x = (W - w) / 2, y = (H - h) / 2;
        box(x, y, w, h, { fill: PAPER, lineWidth: 4 });
        hit(x, y, w, h, function () {});
        text(title, x + rowH * 0.4, y + rowH * 0.6, fitPx(title, w - rowH, rowH * 0.36, true), { bold: true });
        shown.forEach(function (opt, i) {
          var label = typeof opt === "string" ? opt : opt.label, value = typeof opt === "string" ? opt : opt.value;
          button(x + rowH * 0.3, y + rowH * (1.2 + i), w - rowH * 0.6, rowH * 0.88, label,
            function () { overlay = null; cb(value); }, { px: rowH * 0.34, active: o.current !== undefined && value === o.current });
        });
        if (pages > 1) {
          var py = y + rowH * (1.3 + shown.length);
          button(x + rowH * 0.3, py, w * 0.3, rowH * 0.85, "◀ Prev", function () { page = (page + pages - 1) % pages; });
          text((page + 1) + " / " + pages, x + w / 2, py + rowH * 0.42, rowH * 0.32, { align: "center" });
          button(x + w * 0.7 - rowH * 0.3, py, w * 0.3, rowH * 0.85, "Next ▶", function () { page = (page + 1) % pages; });
        }
      }
    };
    redraw();
  }

  function confirm(msg, cb, yes, no) {
    choose(msg, [{ label: yes || "Yes", value: true }, { label: no || "Cancel", value: false }], function (v) { cb(!!v); });
  }

  // Scrollable text panel (paged with buttons, no scrolling animation).
  // o.mono: monospace (tables line up).
  function showText(title, body, o) {
    o = o || {};
    var page = 0, fam = o.mono ? "monospace" : undefined;
    overlay = {
      draw: function () {
        hit(0, 0, W, H, function () {});
        var m = Math.min(W, H), px = m * 0.03, pad = m * 0.04;
        box(pad / 2, pad / 2, W - pad, H - pad, { fill: PAPER, lineWidth: 4 });
        text(title, pad * 1.5, pad * 1.6, px * 1.3, { bold: true });
        button(W - pad * 1.5 - m * 0.18, pad, m * 0.18, px * 2.2, "Close", function () { overlay = null; });
        var lines = wrap(body, W - pad * 3.4, px, false, fam);
        var lh = px * 1.4, perPage = Math.floor((H - pad * 6.5) / lh), pages = Math.max(1, Math.ceil(lines.length / perPage));
        page = Math.min(page, pages - 1);
        lines.slice(page * perPage, (page + 1) * perPage).forEach(function (l, i) { text(l, pad * 1.7, pad * 3.6 + lh * (i + 0.5), px, { family: fam }); });
        if (pages > 1) {
          var by = H - pad * 2.6;
          button(pad * 1.5, by, m * 0.22, px * 2.2, "◀ Prev", function () { page = Math.max(0, page - 1); });
          text((page + 1) + " / " + pages, W / 2, by + px * 1.1, px, { align: "center" });
          button(W - pad * 1.5 - m * 0.22, by, m * 0.22, px * 2.2, "Next ▶", function () { page = Math.min(pages - 1, page + 1); });
        }
      }
    };
    redraw();
  }

  function closeOverlay() { overlay = null; redraw(); }

  // ------------------------------------------------------------------
  // Storage and export
  // ------------------------------------------------------------------
  function load(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  // data: string, Uint8Array or ArrayBuffer. Resolves with where it went.
  function saveFile(name, data, mime) {
    if (onTablet && htmlload.saveFile) return htmlload.saveFile(name, data);
    var blob = new Blob([data], { type: mime || "application/octet-stream" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return Promise.resolve("Downloads/" + name);
  }

  // Saves the whole canvas as it is now (PNG or JPEG by extension).
  function saveCanvas(name) {
    if (onTablet && htmlload.saveCanvas) return htmlload.saveCanvas(name);
    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) {
        saveFile(name, blob).then(resolve);
      }, /\.jpe?g$/i.test(name) ? "image/jpeg" : "image/png", 0.95);
    });
  }

  function importPdf(name, title) {
    if (onTablet && htmlload.importPdf) return htmlload.importPdf(name, title);
    return Promise.reject(new Error("only on the tablet"));
  }

  function stamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  // ------------------------------------------------------------------
  function init(a) {
    app = a;
    if (onTablet && htmlload.setCloseButtonVisible) htmlload.setCloseButtonVisible(false);
    window.addEventListener("resize", resize);
    resize();
  }

  return {
    init: init, redraw: redraw, redrawSoon: redrawSoon, refresh: refresh, exit: exit,
    get W() { return W; }, get H() { return H; }, ctx: ctx, canvas: canvas, onTablet: onTablet,
    INK: INK, PAPER: PAPER, GRAY: GRAY, LIGHT: LIGHT,
    font: font, text: text, measure: measure, fitPx: fitPx, wrap: wrap, paragraph: paragraph,
    roundRect: roundRect, box: box, line: line, button: button, segmented: segmented, hit: hit,
    toolbar: toolbar, icons: ICONS, toast: toast,
    prompt: prompt, choose: choose, confirm: confirm, showText: showText, closeOverlay: closeOverlay,
    get overlayOpen() { return !!overlay; },
    onPinch: onPinch, load: load, store: store, saveFile: saveFile, saveCanvas: saveCanvas, importPdf: importPdf, stamp: stamp
  };
})();
