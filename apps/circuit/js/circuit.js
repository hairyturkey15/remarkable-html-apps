// Circuit and logic diagram editor with live logic simulation.
// Modes: Select (tap a part; tap a switch to flip it; drag parts or the
// sheet), Wire (tap a pin, then another), Delete (tap a part or wire) and
// Place (after choosing a part, tap the sheet).
(function () {
  "use strict";

  var P = Parts.P;
  var EXAMPLES = {
    "Half adder": {
      parts: [{ id: 1, type: "SWITCH", x: 2, y: 2, rot: 0, on: false, text: "A" }, { id: 2, type: "SWITCH", x: 2, y: 8, rot: 0, on: false, text: "B" },
        { id: 3, type: "XOR", x: 10, y: 2, rot: 0 }, { id: 4, type: "AND", x: 10, y: 8, rot: 0 },
        { id: 5, type: "LAMP_LOGIC", x: 17, y: 2, rot: 0, text: "Sum" }, { id: 6, type: "LAMP_LOGIC", x: 17, y: 8, rot: 0, text: "Carry" }],
      wires: [{ a: [1, 0], b: [3, 0] }, { a: [1, 0], b: [4, 0] }, { a: [2, 0], b: [3, 1] }, { a: [2, 0], b: [4, 1] }, { a: [3, 2], b: [5, 0] }, { a: [4, 2], b: [6, 0] }]
    },
    "SR latch (NAND)": {
      parts: [{ id: 1, type: "SWITCH", x: 2, y: 2, rot: 0, on: true, text: "S̄" }, { id: 2, type: "SWITCH", x: 2, y: 10, rot: 0, on: true, text: "R̄" },
        { id: 3, type: "NAND", x: 10, y: 3, rot: 0 }, { id: 4, type: "NAND", x: 10, y: 9, rot: 0 },
        { id: 5, type: "LAMP_LOGIC", x: 17, y: 3, rot: 0, text: "Q" }, { id: 6, type: "LAMP_LOGIC", x: 17, y: 9, rot: 0, text: "Q̄" }],
      wires: [{ a: [1, 0], b: [3, 0] }, { a: [4, 2], b: [3, 1] }, { a: [2, 0], b: [4, 1] }, { a: [3, 2], b: [4, 0] }, { a: [3, 2], b: [5, 0] }, { a: [4, 2], b: [6, 0] }]
    },
    "LED with resistor": {
      parts: [{ id: 1, type: "BATTERY", x: 2, y: 4, rot: 1 }, { id: 2, type: "RESISTOR", x: 6, y: 1, rot: 0, text: "" }, { id: 3, type: "LED", x: 12, y: 1, rot: 0 },
        { id: 4, type: "GROUND", x: 15, y: 6, rot: 0 }, { id: 5, type: "TEXT", x: 6, y: 8, rot: 0, text: "R = (Vs − Vf) / I" }],
      wires: [{ a: [1, 0], b: [2, 0] }, { a: [2, 1], b: [3, 0] }, { a: [3, 1], b: [4, 0] }, { a: [1, 1], b: [4, 0] }]
    }
  };

  var lib = RM.load("circuit.library", null);
  if (!lib || !lib.designs || !lib.designs.length) {
    lib = { designs: [{ name: "Half adder", parts: EXAMPLES["Half adder"].parts, wires: EXAMPLES["Half adder"].wires, view: { ox: 0, oy: 0, z: 1 } }], current: 0 };
  }
  var design = lib.designs[lib.current];
  if (!design.view) design.view = { ox: 0, oy: 0, z: 1 };
  var mode = "select", placing = null, wireFrom = null, selected = null, exporting = false;
  var netState = {}, sim = { values: {}, conflict: {}, unstable: false };

  function save() { RM.store("circuit.library", lib); }
  function nextId() { return design.parts.reduce(function (m, p) { return Math.max(m, p.id); }, 0) + 1; }
  function part(id) { return design.parts.filter(function (p) { return p.id === id; })[0]; }

  // --- Geometry ------------------------------------------------------------------
  function pivot(def) { return [Math.floor(def.w / 2), Math.floor(def.h / 2)]; }
  function rotate(x, y, k) {
    for (var i = 0; i < k; i++) { var t = x; x = -y; y = t; }
    return [x, y];
  }
  function pinPos(p, i) {
    var def = P[p.type], pv = pivot(def), pin = def.pins[i];
    var r = rotate(pin.x - pv[0], pin.y - pv[1], p.rot || 0);
    return [p.x + pv[0] + r[0], p.y + pv[1] + r[1]];
  }
  function bbox(p) {
    var def = P[p.type], pv = pivot(def), xs = [], ys = [];
    [[0, 0], [def.w, 0], [0, def.h], [def.w, def.h]].forEach(function (c) {
      var r = rotate(c[0] - pv[0], c[1] - pv[1], p.rot || 0);
      xs.push(p.x + pv[0] + r[0]);
      ys.push(p.y + pv[1] + r[1]);
    });
    var pad = def.w === 0 ? 0.4 : 0;
    return { x0: Math.min.apply(null, xs) - pad, y0: Math.min.apply(null, ys) - pad, x1: Math.max.apply(null, xs) + pad, y1: Math.max.apply(null, ys) + pad };
  }

  // --- Nets and logic simulation --------------------------------------------------------
  function buildNets() {
    var parent = {};
    var find = function (k) { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
    var union = function (a, b) { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
    var at = {};
    design.parts.forEach(function (p) {
      P[p.type].pins.forEach(function (pin, i) {
        var k = p.id + ":" + i;
        parent[k] = k;
        var pos = pinPos(p, i).join(",");
        if (at[pos]) union(k, at[pos]); else at[pos] = k; // touching pins connect
      });
    });
    design.wires.forEach(function (w) {
      var a = w.a.join(":"), b = w.b.join(":");
      if (parent[a] !== undefined && parent[b] !== undefined) union(a, b);
    });
    return find;
  }

  // Gates update one at a time (asynchronously) until nothing changes, so
  // feedback circuits like latches settle and remember their state.
  function simulate() {
    var find = buildNets();
    var drivers = {};
    var gates = design.parts.filter(function (p) { return P[p.type].logic; });
    var value = function (net) { return netState[net] === 1 ? 1 : 0; };
    var drive = function (p, i, v) {
      var net = find(p.id + ":" + i);
      (drivers[net] = drivers[net] || {})[p.id + ":" + i] = v;
    };
    var resolve = function (net) {
      var d = drivers[net];
      if (!d) return undefined;
      var vals = Object.keys(d).map(function (k) { return d[k]; });
      if (vals.indexOf(1) >= 0 && vals.indexOf(0) >= 0) { sim.conflict[net] = true; return 1; }
      return vals[0];
    };
    sim.conflict = {};
    design.parts.forEach(function (p) {
      var def = P[p.type];
      if (def.source) drive(p, 0, def.constant !== undefined ? def.constant : (p.on ? 1 : 0));
    });
    Object.keys(drivers).forEach(function (n) { netState[n] = resolve(n); });
    var changed = true, rounds = 0;
    while (changed && rounds < 100) {
      changed = false;
      rounds++;
      gates.forEach(function (g) {
        var def = P[g.type], ins = [], outIdx = -1;
        def.pins.forEach(function (pin, i) {
          if (pin.dir === "in") ins.push(value(find(g.id + ":" + i)));
          else if (pin.dir === "out") outIdx = i;
        });
        var out = def.logic(ins), net = find(g.id + ":" + outIdx);
        drive(g, outIdx, out);
        var v = resolve(net);
        if (netState[net] !== v) { netState[net] = v; changed = true; }
      });
    }
    sim.unstable = changed;
    sim.find = find;
    sim.driven = drivers;
  }

  function netValue(p, i) {
    if (!sim.find) return undefined;
    var net = sim.find(p.id + ":" + i);
    return sim.driven[net] ? netState[net] : undefined;
  }

  // --- Editing -----------------------------------------------------------------------
  function addPart(type, gx, gy) {
    var p = { id: nextId(), type: type, x: gx, y: gy, rot: 0 };
    if (type === "SWITCH") {
      var n = design.parts.filter(function (q) { return q.type === "SWITCH"; }).length;
      p.text = String.fromCharCode(65 + (n % 26));
      p.on = false;
    }
    if (type === "LAMP_LOGIC" || type === "PROBE") p.text = "Q" + (design.parts.filter(function (q) { return q.type === "LAMP_LOGIC" || q.type === "PROBE"; }).length + 1);
    if (type === "TEXT") {
      RM.prompt({ title: "Text" }, function (t) { if (t) { p.text = t; design.parts.push(p); changed(); } });
      return;
    }
    design.parts.push(p);
    changed();
  }

  function removePart(p) {
    design.parts = design.parts.filter(function (q) { return q !== p; });
    design.wires = design.wires.filter(function (w) { return w.a[0] !== p.id && w.b[0] !== p.id; });
    if (selected === p) selected = null;
    changed();
  }

  function changed() { simulate(); save(); }

  function partMenu(p) {
    var opts = [{ label: "Rotate 90°", value: "rot" }, { label: "Label…", value: "label" }, { label: "Delete", value: "del" }];
    if (p.type === "SWITCH" || p.type === "SPST") opts.unshift({ label: p.on ? "Switch off" : "Switch on", value: "toggle" });
    RM.choose((P[p.type].label || p.type) + (p.text ? " · " + p.text : ""), opts, function (v) {
      if (v === "rot") { p.rot = ((p.rot || 0) + 1) % 4; changed(); }
      if (v === "toggle") { p.on = !p.on; changed(); }
      if (v === "del") removePart(p);
      if (v === "label") RM.prompt({ title: "Label", value: p.text || "" }, function (t) { if (t !== null) { p.text = t; changed(); } });
    });
  }

  function choosePart() {
    var groups = {};
    Object.keys(P).forEach(function (k) { (groups[P[k].group] = groups[P[k].group] || []).push(k); });
    RM.choose("Part group", Object.keys(groups), function (gname) {
      if (!gname) return;
      RM.choose(gname, groups[gname].map(function (k) { return { label: P[k].label || k, value: k }; }), function (k) {
        if (!k) return;
        placing = k;
        mode = "place";
        RM.toast("Tap the sheet to place " + (P[k].label || k) + ". Tap Select when done.", 2500);
      });
    });
  }

  function truthTable() {
    var ins = design.parts.filter(function (p) { return p.type === "SWITCH"; });
    var outs = design.parts.filter(function (p) { return p.type === "LAMP_LOGIC" || p.type === "PROBE"; });
    if (!ins.length || !outs.length) { RM.toast("Add input switches and output LEDs/probes first."); return; }
    if (ins.length > 6) { RM.toast("Truth tables are limited to 6 inputs (64 rows)."); return; }
    var saved = ins.map(function (p) { return p.on; }), savedState = Object.assign({}, netState);
    var name = function (p, i) { return p.text || ("in" + i); };
    var header = ins.map(name).concat(["│"], outs.map(name));
    var widths = header.map(function (h) { return Math.max(3, h.length + 1); });
    var pad = function (s, w) { s = String(s); while (s.length < w) s += " "; return s; };
    var lines = [header.map(function (h, i) { return pad(h, widths[i]); }).join(" ")];
    for (var row = 0; row < (1 << ins.length); row++) {
      ins.forEach(function (p, i) { p.on = !!(row & (1 << (ins.length - 1 - i))); });
      netState = Object.assign({}, savedState);
      simulate();
      var cells = ins.map(function (p) { return p.on ? 1 : 0; }).concat(["│"], outs.map(function (p) { var v = netValue(p, 0); return v === undefined ? "?" : v; }));
      lines.push(cells.map(function (c, i) { return pad(c, widths[i]); }).join(" ") + (sim.unstable ? "  (oscillates)" : ""));
    }
    ins.forEach(function (p, i) { p.on = saved[i]; });
    netState = savedState;
    simulate();
    RM.showText("Truth table", lines.join("\n") + "\n\nRows follow the switch order " + ins.map(name).join(", ") + ". Circuits with memory (latches) depend on their previous state.", { mono: true });
  }

  function fileMenu() {
    var opts = [{ label: "New design", value: "new" }, { label: "Rename…", value: "rename" }, { label: "Export PNG", value: "png" }];
    Object.keys(EXAMPLES).forEach(function (k) { opts.push({ label: "Example: " + k, value: "ex:" + k }); });
    lib.designs.forEach(function (d, i) { opts.push({ label: (i === lib.current ? "● " : "Open: ") + d.name, value: "open:" + i }); });
    opts.push({ label: "Delete this design", value: "del" });
    RM.choose("Designs", opts, function (v) {
      if (!v) return;
      if (v === "new") { lib.designs.push({ name: "Design " + (lib.designs.length + 1), parts: [], wires: [], view: { ox: 0, oy: 0, z: 1 } }); lib.current = lib.designs.length - 1; }
      else if (v === "rename") { RM.prompt({ title: "Design name", value: design.name }, function (t) { if (t) { design.name = t; save(); } }); return; }
      else if (v === "png") { exportPng(); return; }
      else if (v === "del") {
        RM.confirm("Delete \"" + design.name + "\"?", function (ok) {
          if (!ok) return;
          lib.designs.splice(lib.current, 1);
          if (!lib.designs.length) lib.designs.push({ name: "Design 1", parts: [], wires: [], view: { ox: 0, oy: 0, z: 1 } });
          lib.current = 0;
          design = lib.designs[0];
          netState = {};
          changed();
        });
        return;
      } else if (v.indexOf("ex:") === 0) {
        var ex = JSON.parse(JSON.stringify(EXAMPLES[v.slice(3)]));
        lib.designs.push({ name: v.slice(3), parts: ex.parts, wires: ex.wires, view: { ox: 0, oy: 0, z: 1 } });
        lib.current = lib.designs.length - 1;
      } else lib.current = parseInt(v.split(":")[1], 10);
      design = lib.designs[lib.current];
      if (!design.view) design.view = { ox: 0, oy: 0, z: 1 };
      netState = {};
      selected = null;
      changed();
    });
  }

  function exportPng() {
    exporting = true;
    RM.redraw();
    var name = (design.name || "circuit").replace(/[^A-Za-z0-9 _-]+/g, "").replace(/\s+/g, "_") + "_" + RM.stamp() + ".png";
    RM.saveCanvas(name).then(function (p) {
      exporting = false;
      RM.redraw();
      RM.toast("Saved " + p);
    }, function (e) { exporting = false; RM.redraw(); RM.toast("Couldn't save: " + e.message); });
  }

  // --- Drawing ----------------------------------------------------------------------------
  function draw(ctx, W, H) {
    var m = Math.min(W, H);
    var toolH = exporting ? 0 : RM.toolbar([
      { label: "Select", fn: function () { mode = "select"; placing = null; wireFrom = null; }, active: mode === "select" },
      { label: "Parts +", fn: choosePart, active: mode === "place", bold: true },
      { label: "Wire", fn: function () { mode = "wire"; wireFrom = null; }, active: mode === "wire" },
      { label: "Delete", fn: function () { mode = "delete"; }, active: mode === "delete" },
      { label: "Table", fn: truthTable },
      { label: "File", fn: fileMenu }
    ]);
    var view = design.view, g = Math.max(14, m * 0.028) * view.z;
    var ox = view.ox, oy = view.oy, areaH = H - toolH;
    var toScreen = function (gx, gy) { return [ox + gx * g, oy + gy * g + (exporting ? 0 : m * 0.07)]; };
    var top = exporting ? 0 : m * 0.07;
    // Grid dots
    if (!exporting) {
      ctx.fillStyle = "#b8b8b8";
      var gx0 = Math.floor(-ox / g), gy0 = Math.floor(-(oy) / g);
      for (var gx = gx0; gx * g + ox < W; gx++) {
        for (var gy = gy0; gy * g + oy + top < areaH; gy++) {
          var s = toScreen(gx, gy);
          if (s[1] < top) continue;
          ctx.fillRect(s[0] - 1, s[1] - 1, 2, 2);
        }
      }
    }
    // Wires run horizontal → vertical → horizontal, bending just before
    // the second pin (offset by its pin number so neighbours don't overlap).
    // Logic 1 = thick. Junction dots where a net branches.
    var dirs = {};
    design.wires.forEach(function (w) {
      var pa = part(w.a[0]), pb = part(w.b[0]);
      if (!pa || !pb) return;
      var A = pinPos(pa, w.a[1]), Bp = pinPos(pb, w.b[1]), pts;
      if (A[1] === Bp[1] || A[0] === Bp[0]) pts = [A, Bp];
      else {
        var mx = Bp[0] > A[0] ? Bp[0] - 1 - (w.b[1] % 3) : Bp[0] + 1 + (w.b[1] % 3);
        if ((Bp[0] > A[0] && mx <= A[0]) || (Bp[0] < A[0] && mx >= A[0])) mx = Math.round((A[0] + Bp[0]) / 2);
        pts = [A, [mx, A[1]], [mx, Bp[1]], Bp];
      }
      var v = netValue(pa, w.a[1]), net = sim.find ? sim.find(w.a.join(":")) : "";
      var sp = pts.map(function (q) { return toScreen(q[0], q[1]); });
      ctx.beginPath();
      ctx.moveTo(sp[0][0], sp[0][1]);
      for (var i = 1; i < sp.length; i++) ctx.lineTo(sp[i][0], sp[i][1]);
      ctx.lineWidth = v === 1 ? Math.max(3, g * 0.22) : Math.max(1.5, g * 0.08);
      ctx.strokeStyle = "#000";
      ctx.lineJoin = "round";
      ctx.stroke();
      for (i = 1; i < pts.length; i++) {
        var a0 = pts[i - 1], a1 = pts[i];
        if (a0[0] === a1[0] && a0[1] === a1[1]) continue;
        var d = a0[0] === a1[0] ? (a1[1] > a0[1] ? "D" : "U") : (a1[0] > a0[0] ? "R" : "L");
        var back = { D: "U", U: "D", R: "L", L: "R" }[d];
        var k0 = net + "@" + a0.join(","), k1 = net + "@" + a1.join(",");
        (dirs[k0] = dirs[k0] || {})[d] = 1;
        (dirs[k1] = dirs[k1] || {})[back] = 1;
      }
      if (!exporting && (v === 1 || v === 0)) RM.text(String(v), sp[sp.length - 1][0] - g * 0.6, sp[sp.length - 1][1] - g * 0.35, g * 0.42, { bold: v === 1 });
      if (mode === "delete") {
        for (i = 1; i < sp.length; i++) {
          var x0 = Math.min(sp[i - 1][0], sp[i][0]) - 8, y0 = Math.min(sp[i - 1][1], sp[i][1]) - 8;
          RM.hit(x0, y0, Math.abs(sp[i][0] - sp[i - 1][0]) + 16, Math.abs(sp[i][1] - sp[i - 1][1]) + 16, function () { design.wires.splice(design.wires.indexOf(w), 1); changed(); });
        }
      }
    });
    Object.keys(dirs).forEach(function (k) {
      if (Object.keys(dirs[k]).length < 3) return;
      var xy = k.split("@")[1].split(",").map(Number), sc = toScreen(xy[0], xy[1]);
      ctx.beginPath();
      ctx.arc(sc[0], sc[1], Math.max(3, g * 0.16), 0, Math.PI * 2);
      ctx.fillStyle = "#000";
      ctx.fill();
    });
    // Parts
    design.parts.forEach(function (p) {
      var def = P[p.type], pv = pivot(def), s = toScreen(p.x + pv[0], p.y + pv[1]);
      ctx.save();
      ctx.translate(s[0], s[1]);
      ctx.rotate((p.rot || 0) * Math.PI / 2);
      ctx.translate(-pv[0] * g, -pv[1] * g);
      var val = def.sink ? netValue(p, 0) : undefined;
      def.draw(ctx, g, p, val);
      ctx.restore();
      var bb = bbox(p), b0 = toScreen(bb.x0, bb.y0), b1 = toScreen(bb.x1, bb.y1);
      if (p.text && p.type !== "TEXT") RM.text(p.text, (b0[0] + b1[0]) / 2, b0[1] - g * 0.35, g * 0.5, { align: "center", bold: true });
      if (!exporting && selected === p) { ctx.lineWidth = 2; ctx.strokeStyle = "#000"; ctx.strokeRect(b0[0] - 4, b0[1] - 4, b1[0] - b0[0] + 8, b1[1] - b0[1] + 8); }
      // Pins (wire mode shows them as circles)
      if (!exporting && mode === "wire") {
        def.pins.forEach(function (pin, i) {
          var pp = toScreen.apply(null, pinPos(p, i));
          var active = wireFrom && wireFrom[0] === p.id && wireFrom[1] === i;
          ctx.beginPath();
          ctx.arc(pp[0], pp[1], g * 0.28, 0, Math.PI * 2);
          ctx.fillStyle = active ? "#000" : "#fff";
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = "#000";
          ctx.stroke();
          RM.hit(pp[0] - g * 0.5, pp[1] - g * 0.5, g, g, function () {
            if (!wireFrom) { wireFrom = [p.id, i]; return; }
            if (wireFrom[0] === p.id && wireFrom[1] === i) { wireFrom = null; return; }
            design.wires.push({ a: wireFrom, b: [p.id, i] });
            wireFrom = null;
            changed();
          });
        });
      }
      if (exporting || mode === "wire") return;
      // Part hit area: tap = select/menu (switch toggles), drag = move.
      var start = null;
      RM.hit(b0[0] - 6, b0[1] - 6, b1[0] - b0[0] + 12, b1[1] - b0[1] + 12, {
        down: function (x, y) { start = { x: x, y: y, px: p.x, py: p.y, moved: false }; },
        move: function (x, y) {
          if (!start || mode !== "select") return;
          var dx = Math.round((x - start.x) / g), dy = Math.round((y - start.y) / g);
          if (dx || dy) start.moved = true;
          p.x = start.px + dx;
          p.y = start.py + dy;
        },
        up: function () {
          if (!start) return;
          var moved = start.moved;
          start = null;
          if (moved) { changed(); return; }
          if (mode === "delete") { removePart(p); return; }
          if (p.type === "SWITCH" || p.type === "SPST") { if (selected === p) partMenu(p); else { p.on = !p.on; selected = p; changed(); } return; }
          if (selected === p) partMenu(p); else selected = p;
        }
      });
    });
    if (exporting) return;
    // Sheet: place parts, or drag to pan.
    var startPan = null;
    // Header
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, top);
    RM.line(0, top, W, top, 1);
    var status = design.name + " · " + ({ select: "Select: tap a part (switches toggle), drag to move; drag the sheet to pan", wire: wireFrom ? "Wire: now tap the second pin" : "Wire: tap a pin, then another pin", delete: "Delete: tap a part or wire", place: "Place: tap the sheet to add " + (placing ? (P[placing].label || placing) : "") })[mode];
    if (sim.unstable) status += " · ⚠ oscillating";
    if (Object.keys(sim.conflict).length) status += " · ⚠ conflicting outputs";
    RM.text(status, m * 0.02, top / 2, RM.fitPx(status, W - m * 0.26, top * 0.36), { bold: true });
    RM.button(W - m * 0.22, top * 0.12, m * 0.1, top * 0.76, "−", function () { view.z = Math.max(0.4, view.z / 1.25); save(); }, { px: top * 0.5 });
    RM.button(W - m * 0.11, top * 0.12, m * 0.1, top * 0.76, "+", function () { view.z = Math.min(3, view.z * 1.25); save(); }, { px: top * 0.5 });
    sheetHit = { x: 0, y: top, w: W, h: areaH - top, g: g, ox: ox, oy: oy, top: top };
  }

  // The sheet sits under everything else, so its hit box is registered at
  // the start of the next draw (see drawWithSheet).
  var sheetHit = null;
  function drawWithSheet(ctx, W, H) {
    if (sheetHit && !exporting) {
      var sh = sheetHit, start = null;
      RM.hit(sh.x, sh.y, sh.w, sh.h, {
        down: function (x, y) { start = { x: x, y: y, ox: design.view.ox, oy: design.view.oy, moved: false }; },
        move: function (x, y) {
          if (!start) return;
          if (Math.abs(x - start.x) + Math.abs(y - start.y) > 12) start.moved = true;
          if (start.moved && mode !== "place") { design.view.ox = start.ox + (x - start.x); design.view.oy = start.oy + (y - start.y); }
        },
        up: function (x, y) {
          if (!start) return;
          var s = start;
          start = null;
          if (s.moved) { save(); return; }
          if (mode === "place" && placing) {
            addPart(placing, Math.round((x - sh.ox) / sh.g), Math.round((y - sh.oy - sh.top) / sh.g));
          } else {
            selected = null;
            wireFrom = null;
          }
        }
      });
    }
    draw(ctx, W, H);
  }

  RM.onPinch(function (e) {
    if (e.phase === "start") pinch0 = design.view.z;
    else if (pinch0) {
      design.view.z = Math.max(0.4, Math.min(3, pinch0 * e.scale));
      if (e.phase === "end") { pinch0 = null; save(); }
    }
  });
  var pinch0 = null;

  simulate();
  RM.init({ draw: drawWithSheet, beforeExit: save });
  RM.redraw(); // second pass registers the sheet's hit box
})();
