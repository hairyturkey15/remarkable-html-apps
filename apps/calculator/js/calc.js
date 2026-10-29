// Calculator: keypad calculator, function graphing, unit converter,
// formula table and a small scripting language (see mathlang.js).
(function () {
  "use strict";

  var M = MathLang;
  var TABS = ["Calc", "Graph", "Units", "Formulas", "Script"];
  var st = Object.assign({
    tab: "Calc", degrees: false, history: [], defs: [],
    fns: ["sin(x)", "x^2/4", "", ""], fnOn: [true, true, true, true],
    view: { cx: 0, cy: 0, scale: 40 },
    unitCat: "Length", unitFrom: "m", unitVal: 1,
    formula: 0, formVals: {},
    script: "# Light scripting: =, print, if/else, for/while ... end\ntotal = 0\nfor i = 1 to 10\n  total = total + i^2\nend\nprint \"sum of squares 1..10 =\", total\n\nf(r) = pi r^2\nprint \"area of r=3:\", f(3)"
  }, RM.load("calc.state", {}));
  var input = "", cursor = 0, shift = false, scriptOut = [], trace = null;
  var env = M.makeEnv();
  M.settings.degrees = st.degrees;
  st.defs.forEach(function (d) { try { M.runLine(d, env); } catch (e) {} });
  if (st.history.length) env.vars.ans = st.history[st.history.length - 1].value || 0;

  function save() { RM.store("calc.state", st); }

  // ------------------------------------------------------------------
  // Calc tab
  // ------------------------------------------------------------------
  function insert(s) {
    input = input.slice(0, cursor) + s + input.slice(cursor);
    cursor += s.length;
  }

  function evaluate() {
    if (!input.trim()) return;
    try {
      var r = M.runLine(input, env);
      if (/^\s*[A-Za-z_]\w*\s*(\([^)]*\))?\s*=(?!=)/.test(input)) {
        // Keep definitions so they survive restarts.
        var name = /^\s*([A-Za-z_]\w*)/.exec(input)[1];
        st.defs = st.defs.filter(function (d) { return /^\s*([A-Za-z_]\w*)/.exec(d)[1] !== name; });
        st.defs.push(input);
      }
      st.history.push({ expr: input, text: r.text, value: r.value });
      if (st.history.length > 60) st.history.shift();
      input = "";
      cursor = 0;
    } catch (e) {
      RM.toast("Error: " + e.message, 2500);
    }
    save();
  }

  var KEYS = [
    ["2nd", "sin", "cos", "tan", "ln", "log"],
    ["√", "^", "x²", "(", ")", "π"],
    ["7", "8", "9", "÷", "⌫", "AC"],
    ["4", "5", "6", "×", "ans", "abc"],
    ["1", "2", "3", "−", ",", "!"],
    ["0", ".", "E", "+", "x", "="]
  ];
  var SHIFTED = { sin: "asin", cos: "acos", tan: "atan", ln: "eˣ", log: "10ˣ", "√": "∛", "^": "ⁿ√", "x²": "x³", "π": "e", "!": "mod", ",": "◀", "x": "▶", "ans": "abs" };

  function key(k) {
    var label = shift && SHIFTED[k] ? SHIFTED[k] : k;
    if (k !== "2nd") shift = false;
    switch (label) {
      case "2nd": shift = !shift; return;
      case "AC": input = ""; cursor = 0; return;
      case "⌫": if (cursor > 0) { input = input.slice(0, cursor - 1) + input.slice(cursor); cursor--; } return;
      case "=": evaluate(); return;
      case "◀": cursor = Math.max(0, cursor - 1); return;
      case "▶": cursor = Math.min(input.length, cursor + 1); return;
      case "abc":
        RM.prompt({ title: "Expression (e.g. f(x) = x^2 + 1, a = 3)", value: input, mode: "math", mono: true }, function (v) {
          if (v !== null) { input = v; cursor = v.length; }
        });
        return;
      case "x²": insert("^2"); return;
      case "x³": insert("^3"); return;
      case "eˣ": insert("exp("); return;
      case "10ˣ": insert("10^("); return;
      case "∛": insert("cbrt("); return;
      case "ⁿ√": insert("root("); return;
      case "√": insert("sqrt("); return;
      case "E": insert("e"); return;
      case "mod": insert(" mod "); return;
      case "÷": insert("/"); return;
      case "×": insert("*"); return;
      case "−": insert("-"); return;
      case "π": insert("π"); return;
      case "abs": insert("abs("); return;
      default:
        if (/^[a-z]+$/.test(label) && label.length > 1 && label !== "ans") insert(label + "(");
        else insert(label);
    }
  }

  function drawCalc(ctx, x, y, w, h) {
    var m = Math.min(RM.W, RM.H);
    var keyH = Math.min(h * 0.09, m * 0.1), padH = keyH * 6 + keyH * 0.4;
    var lineH = m * 0.045;
    var histH = h - padH - lineH * 2.2;
    // History (latest at the bottom); tap an entry to reuse its result.
    var rows = Math.floor(histH / (lineH * 1.6));
    var shown = st.history.slice(-rows);
    shown.forEach(function (e, i) {
      var yy = y + histH - (shown.length - i) * lineH * 1.6;
      RM.text(fitStr(e.expr, w * 0.55, lineH * 0.55), x + m * 0.02, yy + lineH * 0.5, lineH * 0.55, { family: "monospace" });
      RM.text(e.text, x + w - m * 0.02, yy + lineH * 1.1, lineH * 0.7, { align: "right", bold: true, family: "monospace" });
      RM.hit(x, yy, w, lineH * 1.6, function () { insert(e.value !== undefined ? M.format(e.value) : ""); });
    });
    // Input line
    var iy = y + histH;
    RM.box(x + m * 0.02, iy, w - m * 0.04, lineH * 2, { radius: 8 });
    var shownIn = input.slice(0, cursor) + "│" + input.slice(cursor);
    var px = lineH * 0.9;
    while (shownIn.length > 1 && RM.measure(shownIn, px, false, "monospace") > w - m * 0.1) shownIn = shownIn.slice(1);
    RM.text(shownIn, x + w - m * 0.04, iy + lineH, px, { align: "right", family: "monospace" });
    RM.text(st.degrees ? "DEG" : "RAD", x + m * 0.035, iy + lineH * 0.45, lineH * 0.4, { bold: true });
    if (shift) RM.text("2nd", x + m * 0.035, iy + lineH * 1.45, lineH * 0.4, { bold: true });
    // Keypad
    var ky = y + h - padH + keyH * 0.2, kw = w / 6;
    KEYS.forEach(function (row, r) {
      row.forEach(function (k, c) {
        var label = shift && SHIFTED[k] ? SHIFTED[k] : k;
        var strong = /^[0-9.]$/.test(k) || k === "=";
        var bx = x + c * kw + 3, by = ky + r * keyH + 3;
        if (k === "⌫") {
          RM.button(bx, by, kw - 6, keyH - 6, "delete", function () { key(k); }, { icon: "backspace", lineWidth: 3 });
        } else if (k === "2nd") {
          RM.button(bx, by, kw - 6, keyH - 6, "2nd", function () { key(k); }, { icon: "shift", iconFilled: shift, lineWidth: 3 });
        } else if (k === "=") {
          RM.button(bx, by, kw - 6, keyH - 6, "", function () { key(k); }, { active: true });
          RM.text("=", bx + (kw - 6) / 2, by + (keyH - 6) * 0.4, keyH * 0.42, { align: "center", bold: true, color: "#ffffff" });
          RM.text("enter", bx + (kw - 6) / 2, by + (keyH - 6) * 0.8, keyH * 0.18, { align: "center", bold: true, color: "#ffffff" });
        } else {
          RM.button(bx, by, kw - 6, keyH - 6, label, function () { key(k); },
            { bold: strong, active: k === "2nd" && shift, px: keyH * (label.length > 3 ? 0.3 : 0.42) });
        }
      });
    });
  }

  function fitStr(s, maxW, px) {
    while (s.length > 1 && RM.measure(s, px, false, "monospace") > maxW) s = s.slice(0, -2) + "…";
    return s;
  }

  // ------------------------------------------------------------------
  // Graph tab
  // ------------------------------------------------------------------
  var DASHES = [[], [14, 8], [3, 6], [16, 6, 3, 6]];
  var pinchStart = null;

  // Manual dashes (the tablet's canvas has no setLineDash).
  function strokeDashed(ctx, pts, pattern, width) {
    ctx.lineWidth = width;
    ctx.strokeStyle = RM.INK;
    ctx.beginPath();
    if (!pattern.length) {
      var pen = false;
      pts.forEach(function (p) {
        if (!p) { pen = false; return; }
        if (pen) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
        pen = true;
      });
      ctx.stroke();
      return;
    }
    var idx = 0, left = pattern[0], on = true;
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i];
      if (!a || !b) continue;
      var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy), t = 0;
      while (t < len) {
        var step = Math.min(left, len - t);
        if (on) {
          ctx.moveTo(a[0] + dx * t / len, a[1] + dy * t / len);
          ctx.lineTo(a[0] + dx * (t + step) / len, a[1] + dy * (t + step) / len);
        }
        t += step;
        left -= step;
        if (left <= 0) { idx = (idx + 1) % pattern.length; left = pattern[idx]; on = !on; }
      }
    }
    ctx.stroke();
  }

  function niceStep(range) {
    var raw = range / 8, p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p;
    return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
  }

  function drawGraph(ctx, x, y, w, h) {
    var m = Math.min(RM.W, RM.H), rowH = Math.min(m * 0.065, h * 0.08);
    // Function list
    for (var i = 0; i < 4; i++) {
      var ry = y + i * rowH;
      (function (i) {
        RM.button(x + m * 0.02, ry + 3, rowH * 1.4, rowH - 6, st.fnOn[i] ? "y" + (i + 1) : "off", function () { st.fnOn[i] = !st.fnOn[i]; save(); }, { active: st.fnOn[i], px: rowH * 0.36 });
        var fx = x + m * 0.02 + rowH * 1.6;
        RM.box(fx, ry + 3, w * 0.62, rowH - 6, { radius: 6, lineWidth: 1.5 });
        RM.text("= " + (st.fns[i] || "(tap to enter)"), fx + 8, ry + rowH / 2, rowH * 0.38, { family: "monospace" });
        RM.hit(fx, ry, w * 0.62, rowH, function () {
          RM.prompt({ title: "y" + (i + 1) + " = f(x)", value: st.fns[i], mode: "math", mono: true }, function (v) {
            if (v === null) return;
            try { if (v.trim()) M.parse(v); st.fns[i] = v.trim(); save(); } catch (e) { RM.toast("Error: " + e.message); }
          });
        });
        // Line style sample
        var sx = fx + w * 0.64, sy = ry + rowH / 2;
        strokeDashed(ctx, [[sx, sy], [x + w - m * 0.03, sy]], DASHES[i], 3);
      })(i);
    }
    var gy = y + rowH * 4 + 6, gh = h - rowH * 4 - 6;
    var v = st.view;
    var toX = function (vx) { return x + w / 2 + (vx - v.cx) * v.scale; };
    var toY = function (vy) { return gy + gh / 2 - (vy - v.cy) * v.scale; };
    var fromX = function (px) { return v.cx + (px - x - w / 2) / v.scale; };
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, gy, w, gh);
    ctx.clip();
    // Grid and axes
    var step = niceStep(w / v.scale);
    var x0 = Math.floor(fromX(x) / step) * step, x1 = fromX(x + w);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#c8c8c8";
    ctx.beginPath();
    for (var gx = x0; gx <= x1; gx += step) { ctx.moveTo(toX(gx), gy); ctx.lineTo(toX(gx), gy + gh); }
    var yTop = v.cy + gh / 2 / v.scale, yBot = v.cy - gh / 2 / v.scale;
    for (var gyy = Math.floor(yBot / step) * step; gyy <= yTop; gyy += step) { ctx.moveTo(x, toY(gyy)); ctx.lineTo(x + w, toY(gyy)); }
    ctx.stroke();
    RM.line(x, toY(0), x + w, toY(0), 2);
    RM.line(toX(0), gy, toX(0), gy + gh, 2);
    var lpx = Math.max(10, m * 0.022);
    for (gx = x0; gx <= x1; gx += step) if (Math.abs(gx) > step / 2) RM.text(M.format(+gx.toPrecision(6)), toX(gx), Math.min(gy + gh - lpx, Math.max(gy + lpx, toY(0) + lpx)), lpx, { align: "center" });
    for (gyy = Math.floor(yBot / step) * step; gyy <= yTop; gyy += step) if (Math.abs(gyy) > step / 2) RM.text(M.format(+gyy.toPrecision(6)), Math.min(x + w - 4, Math.max(x + 4, toX(0) + 6)), toY(gyy), lpx, {});
    // Curves
    for (i = 0; i < 4; i++) {
      if (!st.fns[i] || !st.fnOn[i]) continue;
      var f;
      try { f = M.compileFn(st.fns[i], env); } catch (e) { continue; }
      var pts = [], prev = null;
      for (var px = x; px <= x + w; px += 2) {
        var yv = f(fromX(px));
        var py = toY(yv);
        // Break the line at gaps and vertical asymptotes.
        if (!isFinite(yv) || Math.abs(py - gy) > gh * 20 || (prev !== null && Math.abs(py - prev) > gh * 2)) { pts.push(null); prev = null; continue; }
        pts.push([px, py]);
        prev = py;
      }
      strokeDashed(ctx, pts, DASHES[i], 3);
    }
    // Trace marker
    if (trace !== null) {
      RM.line(toX(trace), gy, toX(trace), gy + gh, 1);
      var info = ["x = " + M.format(+trace.toPrecision(8))];
      for (i = 0; i < 4; i++) {
        if (!st.fns[i] || !st.fnOn[i]) continue;
        try {
          var val = M.compileFn(st.fns[i], env)(trace);
          info.push("y" + (i + 1) + " = " + M.format(val));
          if (isFinite(val)) { ctx.beginPath(); ctx.arc(toX(trace), toY(val), 6, 0, Math.PI * 2); ctx.fillStyle = RM.INK; ctx.fill(); }
        } catch (e) {}
      }
      var bw = Math.max.apply(null, info.map(function (s) { return RM.measure(s, lpx * 1.2); })) + 20;
      RM.box(x + 8, gy + 8, bw, info.length * lpx * 1.5 + 12, { radius: 6 });
      info.forEach(function (s, k) { RM.text(s, x + 18, gy + 14 + lpx * 0.75 + k * lpx * 1.5, lpx * 1.2, { family: "monospace" }); });
    }
    ctx.restore();
    RM.line(x, gy, x + w, gy, 2);
    // Drag to pan; a tap (no movement) traces.
    var start = null;
    RM.hit(x, gy, w, gh, {
      down: function (px, py) { start = { px: px, py: py, cx: v.cx, cy: v.cy, moved: false }; },
      move: function (px, py) {
        if (!start) return;
        if (Math.abs(px - start.px) + Math.abs(py - start.py) > 10) start.moved = true;
        if (start.moved) { v.cx = start.cx - (px - start.px) / v.scale; v.cy = start.cy + (py - start.py) / v.scale; }
      },
      up: function (px) { if (start && !start.moved) trace = fromX(px); start = null; save(); }
    });
    RM.onPinch(function (e) {
      if (st.tab !== "Graph") return;
      if (e.phase === "start") pinchStart = v.scale;
      else if (pinchStart) {
        v.scale = Math.min(1e7, Math.max(1e-4, pinchStart * e.scale));
        if (e.phase === "end") { pinchStart = null; save(); }
      }
    });
  }

  function zoom(f) { st.view.scale = Math.min(1e7, Math.max(1e-4, st.view.scale * f)); save(); }

  // ------------------------------------------------------------------
  // Units tab
  // ------------------------------------------------------------------
  function drawUnits(ctx, x, y, w, h) {
    var m = Math.min(RM.W, RM.H), rowH = Math.min(m * 0.07, h / 14), cat = UnitData.CATEGORIES[st.unitCat];
    if (!cat.units.some(function (u) { return u[0] === st.unitFrom; })) st.unitFrom = cat.units[0][0];
    RM.button(x + m * 0.02, y, w * 0.45, rowH * 0.9, st.unitCat + " ▾", function () {
      RM.choose("Category", Object.keys(UnitData.CATEGORIES), function (c) { if (c) { st.unitCat = c; st.unitFrom = UnitData.CATEGORIES[c].units[0][0]; save(); } }, { current: st.unitCat });
    }, { bold: true });
    RM.button(x + w * 0.5, y, w * 0.48 - m * 0.02, rowH * 0.9, M.format(st.unitVal) + "  " + st.unitFrom, function () {
      RM.prompt({ title: "Value in " + st.unitFrom, value: String(st.unitVal), mode: "number" }, function (v) {
        if (v === null) return;
        try { st.unitVal = M.compile(M.parse(v), env)(); save(); } catch (e) { RM.toast("Error: " + e.message); }
      });
    }, { bold: true });
    RM.text("Tap a row to convert from that unit", x + m * 0.02, y + rowH * 1.35, rowH * 0.32, {});
    var ly = y + rowH * 1.8;
    cat.units.forEach(function (u, i) {
      var val = UnitData.convert(st.unitCat, st.unitVal, st.unitFrom, u[0]);
      var yy = ly + i * rowH * 0.95;
      var from = u[0] === st.unitFrom;
      if (from) RM.box(x + m * 0.01, yy, w - m * 0.02, rowH * 0.9, { fill: RM.LIGHT, stroke: null, radius: 6 });
      RM.text(u[0], x + m * 0.03, yy + rowH * 0.45, rowH * 0.38, { bold: from });
      RM.text(M.format(val), x + w - m * 0.03, yy + rowH * 0.45, rowH * 0.42, { align: "right", family: "monospace", bold: from });
      RM.line(x + m * 0.02, yy + rowH * 0.92, x + w - m * 0.02, yy + rowH * 0.92, 1, "#c8c8c8");
      RM.hit(x, yy, w, rowH * 0.9, function () { st.unitVal = val; st.unitFrom = u[0]; save(); });
    });
  }

  // ------------------------------------------------------------------
  // Formulas tab
  // ------------------------------------------------------------------
  function drawFormulas(ctx, x, y, w, h) {
    var m = Math.min(RM.W, RM.H), rowH = Math.min(m * 0.075, h / 12);
    var F = UnitData.FORMULAS[st.formula];
    RM.button(x + m * 0.02, y, w - m * 0.04, rowH * 0.9, F.name + "  ▾", function () {
      RM.choose("Formula", UnitData.FORMULAS.map(function (f, i) { return { label: f.name, value: i }; }), function (i) {
        if (i !== null && i !== undefined) { st.formula = i; save(); }
      }, { current: st.formula });
    }, { bold: true });
    RM.text(F.text, x + w / 2, y + rowH * 1.5, rowH * 0.42, { align: "center", family: "monospace" });
    var vals = {}, saved = st.formVals[F.name] || {};
    var yy = y + rowH * 2.3;
    RM.text("Inputs (tap to change)", x + m * 0.03, yy, rowH * 0.32, { bold: true });
    yy += rowH * 0.4;
    F.inputs.forEach(function (inp) {
      var v = saved[inp[0]] !== undefined ? saved[inp[0]] : inp[2];
      vals[inp[0]] = v;
      RM.text(inp[1], x + m * 0.03, yy + rowH * 0.45, rowH * 0.38, {});
      RM.button(x + w * 0.55, yy + 3, w * 0.43 - m * 0.02, rowH * 0.8, M.format(v), function () {
        RM.prompt({ title: inp[1], value: String(v), mode: "number" }, function (s) {
          if (s === null) return;
          try {
            var nv = M.compile(M.parse(s), env)();
            st.formVals[F.name] = Object.assign({}, saved, (function () { var o = {}; o[inp[0]] = nv; return o; })());
            save();
          } catch (e) { RM.toast("Error: " + e.message); }
        });
      }, { px: rowH * 0.4 });
      yy += rowH;
    });
    yy += rowH * 0.3;
    RM.text("Results", x + m * 0.03, yy, rowH * 0.32, { bold: true });
    yy += rowH * 0.4;
    F.outputs.forEach(function (out) {
      var r;
      try { r = out[1](vals); } catch (e) { r = NaN; }
      RM.text(out[0], x + m * 0.03, yy + rowH * 0.45, rowH * 0.38, {});
      RM.text(M.format(r), x + w - m * 0.03, yy + rowH * 0.45, rowH * 0.48, { align: "right", bold: true, family: "monospace" });
      RM.line(x + m * 0.02, yy + rowH * 0.92, x + w - m * 0.02, yy + rowH * 0.92, 1, "#c8c8c8");
      yy += rowH;
    });
    RM.text("Tip: inputs accept expressions, e.g. 3/8 or 2.5*12", x + m * 0.03, yy + rowH * 0.5, rowH * 0.3, {});
  }

  // ------------------------------------------------------------------
  // Script tab
  // ------------------------------------------------------------------
  var EXAMPLES = {
    "Sum of squares": st.script,
    "Collatz steps": "n = 27\nsteps = 0\nwhile n != 1\n  if n mod 2 == 0\n    n = n / 2\n  else\n    n = 3n + 1\n  end\n  steps = steps + 1\nend\nprint \"27 reaches 1 after\", steps, \"steps\"",
    "Table of values": "f(x) = x^3 - 2x\nfor x = -2 to 2 step 0.5\n  print x, f(x)\nend",
    "Newton's method": "# root of x^2 - 2\nf(x) = x^2 - 2\nd(x) = 2x\nx = 1\nfor i = 1 to 6\n  x = x - f(x) / d(x)\n  print i, x\nend",
    "Pipe sizing": "# flow (L/s) for pipe sizes at 2 m/s\nv = 2\nfor d = 20 to 100 step 20\n  q = pi (d/1000)^2 / 4 * v * 1000\n  print \"d =\", d, \"mm  Q =\", round(q, 2), \"L/s\"\nend"
  };

  function runScript() {
    var local = M.makeEnv();
    local.vars = Object.assign({}, env.vars);
    local.funcs = Object.assign({}, env.funcs);
    try {
      scriptOut = M.runScript(st.script, local);
      if (!scriptOut.length) scriptOut = ["(ran with no output: use print)"];
    } catch (e) {
      scriptOut = ["Error: " + e.message];
    }
  }

  function drawScript(ctx, x, y, w, h) {
    var m = Math.min(RM.W, RM.H), px = Math.min(m * 0.028, 22), lh = px * 1.35;
    var bw = (w - m * 0.04) / 3;
    RM.button(x + m * 0.02, y, bw - 6, lh * 1.8, "Edit", function () {
      RM.prompt({ title: "Script", value: st.script, multiline: true, mono: true, mode: "math" }, function (v) { if (v !== null) { st.script = v; save(); } });
    }, { bold: true });
    RM.button(x + m * 0.02 + bw, y, bw - 6, lh * 1.8, "▶ Run", function () { runScript(); }, { bold: true, active: true });
    RM.button(x + m * 0.02 + 2 * bw, y, bw - 6, lh * 1.8, "Examples", function () {
      RM.choose("Load an example", Object.keys(EXAMPLES), function (k) { if (k) { st.script = EXAMPLES[k]; scriptOut = []; save(); } });
    });
    var codeY = y + lh * 2.4, codeH = (h - lh * 2.4) * 0.55;
    RM.box(x + m * 0.02, codeY, w - m * 0.04, codeH, { radius: 6, lineWidth: 1.5 });
    var lines = st.script.split("\n"), maxLines = Math.floor((codeH - 10) / lh);
    lines.slice(0, maxLines).forEach(function (l, i) {
      RM.text(String(i + 1), x + m * 0.05, codeY + 8 + lh * (i + 0.5), px * 0.8, { align: "right", color: RM.GRAY, family: "monospace" });
      RM.text(l, x + m * 0.065, codeY + 8 + lh * (i + 0.5), px, { family: "monospace" });
    });
    if (lines.length > maxLines) RM.text("… " + (lines.length - maxLines) + " more lines (Edit to see all)", x + m * 0.065, codeY + codeH - lh * 0.5, px * 0.8, {});
    RM.hit(x, codeY, w, codeH, function () {
      RM.prompt({ title: "Script", value: st.script, multiline: true, mono: true, mode: "math" }, function (v) { if (v !== null) { st.script = v; save(); } });
    });
    var outY = codeY + codeH + lh * 0.6;
    RM.text("Output", x + m * 0.02, outY, px, { bold: true });
    var outLines = Math.floor((y + h - outY - lh) / lh);
    scriptOut.slice(-outLines).forEach(function (l, i) { RM.text(l, x + m * 0.03, outY + lh * (i + 1.2), px, { family: "monospace" }); });
  }

  // ------------------------------------------------------------------
  function draw(ctx, W, H) {
    var m = Math.min(W, H);
    var items = [{ label: st.degrees ? "DEG" : "RAD", fn: function () { st.degrees = !st.degrees; M.settings.degrees = st.degrees; save(); }, bold: true }];
    if (st.tab === "Graph") {
      items.push({ label: "Zoom +", fn: function () { zoom(1.6); } }, { label: "Zoom −", fn: function () { zoom(1 / 1.6); } },
        { label: "Reset", fn: function () { st.view = { cx: 0, cy: 0, scale: 40 }; trace = null; save(); } });
    } else if (st.tab === "Calc") {
      items.push({ label: "Clear history", fn: function () { st.history = []; save(); } });
    }
    var toolH = RM.toolbar(items);
    var tabH = Math.round(Math.max(44, m * 0.07));
    RM.segmented(m * 0.015, m * 0.015, W - m * 0.03, tabH - m * 0.015, TABS, st.tab, function (t) { st.tab = t; trace = null; save(); }, { px: tabH * 0.36 });
    var y = tabH + m * 0.02, h = H - toolH - y - m * 0.01;
    if (st.tab === "Calc") drawCalc(ctx, 0, y, W, h);
    else if (st.tab === "Graph") drawGraph(ctx, 0, y, W, h);
    else if (st.tab === "Units") drawUnits(ctx, 0, y, W, h);
    else if (st.tab === "Formulas") drawFormulas(ctx, 0, y, W, h);
    else drawScript(ctx, 0, y, W, h);
  }

  RM.init({ draw: draw });
})();
