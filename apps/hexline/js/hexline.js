// Hexline: an original hex-grid line puzzle.
// Place pieces from a tray of three onto a hexagonal board; any line that
// fills completely (along any of the three hex directions) clears. Pieces
// can be rotated. Clearing several lines with one piece multiplies the
// points. The game ends when no tray piece fits anywhere in any rotation.
(function () {
  "use strict";

  var RADIUS = 4; // 61 cells
  var cells = [];
  for (var q = -RADIUS; q <= RADIUS; q++) {
    for (var r = -RADIUS; r <= RADIUS; r++) {
      if (Math.abs(q + r) <= RADIUS) cells.push([q, r]);
    }
  }
  function key(q, r) { return q + "," + r; }
  function onBoard(q, r) { return Math.abs(q) <= RADIUS && Math.abs(r) <= RADIUS && Math.abs(q + r) <= RADIUS; }

  // Lines: every row along the three axes (q fixed, r fixed, q+r fixed).
  var LINES = [];
  for (var k = -RADIUS; k <= RADIUS; k++) {
    var a = [], b = [], c = [];
    cells.forEach(function (cl) {
      if (cl[0] === k) a.push(key(cl[0], cl[1]));
      if (cl[1] === k) b.push(key(cl[0], cl[1]));
      if (cl[0] + cl[1] === k) c.push(key(cl[0], cl[1]));
    });
    LINES.push(a, b, c);
  }

  // Piece shapes in axial offsets (rotations are generated).
  var SHAPES = [
    [[0, 0]],
    [[0, 0], [1, 0]],
    [[0, 0], [1, 0], [2, 0]],
    [[0, 0], [1, 0], [2, 0], [3, 0]],
    [[0, 0], [1, 0], [0, 1]], // triangle
    [[0, 0], [1, 0], [1, 1]], // bent
    [[0, 0], [1, 0], [0, 1], [1, 1]], // rhombus
    [[0, 0], [1, 0], [2, 0], [1, 1]], // T-ish
    [[0, 0], [1, 0], [1, 1], [2, 1]], // zig
    [[0, 0], [1, 0], [2, 0], [2, 1]], // hook
    [[0, 0], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0]] // ring of six (rare)
  ];
  var WEIGHTS = [5, 8, 7, 4, 6, 6, 5, 4, 4, 4, 1];

  function rotate(shape) {
    var out = shape.map(function (p) { return [-p[1], p[0] + p[1]]; });
    return normalize(out);
  }
  function normalize(shape) {
    var minQ = Infinity, minR = Infinity;
    shape.forEach(function (p) { minQ = Math.min(minQ, p[0]); minR = Math.min(minR, p[1]); });
    return shape.map(function (p) { return [p[0] - minQ, p[1] - minR]; });
  }

  function randomPiece() {
    var total = WEIGHTS.reduce(function (s, w) { return s + w; }, 0), x = Math.random() * total, i = 0;
    while (x >= WEIGHTS[i]) { x -= WEIGHTS[i]; i++; }
    var shape = normalize(SHAPES[i]);
    var turns = Math.floor(Math.random() * 6);
    for (var t = 0; t < turns; t++) shape = rotate(shape);
    return shape;
  }

  // --- State ------------------------------------------------------------
  var best = RM.load("hexline.best", 0);
  var game = RM.load("hexline.game", null);
  var selected = -1, preview = null, undoState = null;

  function newGame() {
    game = { filled: {}, tray: [randomPiece(), randomPiece(), randomPiece()], score: 0, over: false, lines: 0 };
    selected = -1;
    preview = null;
    undoState = null;
    save();
  }
  function save() { RM.store("hexline.game", game); }

  function fits(shape, q, r) {
    for (var i = 0; i < shape.length; i++) {
      var cq = q + shape[i][0], cr = r + shape[i][1];
      if (!onBoard(cq, cr) || game.filled[key(cq, cr)]) return false;
    }
    return true;
  }

  function fitsAnywhere(shape) {
    var s = shape;
    for (var t = 0; t < 6; t++) {
      for (var i = 0; i < cells.length; i++) if (fits(s, cells[i][0], cells[i][1])) return true;
      s = rotate(s);
    }
    return false;
  }

  // Anchor so the tapped cell sits at the piece's middle cell.
  function anchorFor(shape, q, r) {
    var mid = shape[Math.floor(shape.length / 2)];
    return [q - mid[0], r - mid[1]];
  }

  function place(i, q, r) {
    var shape = game.tray[i];
    if (!fits(shape, q, r)) return false;
    undoState = JSON.stringify(game);
    shape.forEach(function (p) { game.filled[key(q + p[0], r + p[1])] = 1; });
    var points = shape.length;
    var full = LINES.filter(function (line) { return line.every(function (kk) { return game.filled[kk]; }); });
    if (full.length) {
      var cleared = {};
      full.forEach(function (line) { line.forEach(function (kk) { cleared[kk] = 1; }); });
      var n = Object.keys(cleared).length;
      Object.keys(cleared).forEach(function (kk) { delete game.filled[kk]; });
      points += n * 10 * full.length; // combo multiplier
      game.lines += full.length;
      if (full.length > 1) RM.toast(full.length + " lines at once! ×" + full.length, 1500);
    }
    game.score += points;
    game.tray[i] = null;
    if (game.tray.every(function (t) { return !t; })) game.tray = [randomPiece(), randomPiece(), randomPiece()];
    selected = -1;
    preview = null;
    game.over = !game.tray.some(function (t) { return t && fitsAnywhere(t); });
    if (game.score > best) { best = game.score; RM.store("hexline.best", best); }
    save();
    return true;
  }

  function undo() {
    if (!undoState) return;
    game = JSON.parse(undoState);
    undoState = null;
    selected = -1;
    preview = null;
    save();
  }

  function rotateSelected() {
    if (selected < 0 || !game.tray[selected]) { RM.toast("Pick a piece first, then rotate it."); return; }
    game.tray[selected] = rotate(game.tray[selected]);
    if (preview) preview = null;
    save();
  }

  // --- Drawing ------------------------------------------------------------
  var geo = {};

  function hexPath(ctx, cx, cy, s) {
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var ang = Math.PI / 180 * (60 * i - 30);
      var x = cx + s * Math.cos(ang), y = cy + s * Math.sin(ang);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function cellXY(q, r, s, ox, oy) {
    return { x: ox + s * Math.sqrt(3) * (q + r / 2), y: oy + s * 1.5 * r };
  }

  function drawCell(ctx, cx, cy, s, style) {
    hexPath(ctx, cx, cy, s * 0.94);
    if (style === "filled") {
      ctx.fillStyle = RM.INK;
      ctx.fill();
      hexPath(ctx, cx, cy, s * 0.55);
      ctx.lineWidth = Math.max(1.5, s * 0.08);
      ctx.strokeStyle = RM.PAPER;
      ctx.stroke();
    } else if (style === "preview") {
      ctx.fillStyle = "#8a8a8a";
      ctx.fill();
      ctx.lineWidth = Math.max(2, s * 0.12);
      ctx.strokeStyle = RM.INK;
      ctx.stroke();
    } else if (style === "bad") {
      ctx.fillStyle = RM.PAPER;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = RM.INK;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.35, cy - s * 0.35); ctx.lineTo(cx + s * 0.35, cy + s * 0.35);
      ctx.moveTo(cx + s * 0.35, cy - s * 0.35); ctx.lineTo(cx - s * 0.35, cy + s * 0.35);
      ctx.stroke();
    } else {
      ctx.fillStyle = RM.PAPER;
      ctx.fill();
      ctx.lineWidth = Math.max(1, s * 0.05);
      ctx.strokeStyle = RM.INK;
      ctx.stroke();
    }
  }

  function boardCellAt(x, y) {
    // Inverse of cellXY with axial rounding.
    var px = (x - geo.ox) / geo.s, py = (y - geo.oy) / geo.s;
    var r = py / 1.5, q = px / Math.sqrt(3) - r / 2;
    var xq = q, zr = r, yy = -q - r;
    var rq = Math.round(xq), rr = Math.round(zr), ry = Math.round(yy);
    var dq = Math.abs(rq - xq), dr = Math.abs(rr - zr), dy = Math.abs(ry - yy);
    if (dq > dr && dq > dy) rq = -rr - ry;
    else if (dr > dy) rr = -rq - ry;
    return onBoard(rq, rr) ? [rq, rr] : null;
  }

  function draw(ctx, W, H) {
    var m = Math.min(W, H);
    var toolH = RM.toolbar([
      { label: "New", icon: "plus", fn: function () { RM.confirm("Start a new game?", function (ok) { if (ok) newGame(); }); } },
      { label: "Undo", icon: "undo", fn: undo, disabled: !undoState },
      { label: "Rotate", icon: "redo", fn: rotateSelected, disabled: selected < 0 },
      { label: "Help", fn: function () {
        RM.showText("How to play", "Tap a piece in the tray, then tap the board where it should go. A gray preview appears; tap the same spot again to drop it (or tap elsewhere to move the preview). You can also drag a piece straight onto the board.\n\nRotate turns the chosen piece 60°.\n\nFill a whole line in any of the three directions to clear it: 10 points per cleared cell, multiplied by the number of lines cleared at once. Every placed cell also scores 1.\n\nThe game ends when none of the tray pieces fits anywhere, in any rotation. Undo takes back your last placement.");
      } }
    ]);
    var headH = m * 0.08;
    RM.text("Hexline", m * 0.03, headH * 0.5, headH * 0.45, { bold: true });
    RM.text("Score " + game.score + "    Best " + best, W - m * 0.03, headH * 0.5, headH * 0.36, { align: "right" });

    var trayH = Math.min(m * 0.26, (H - toolH - headH) * 0.28);
    var areaH = H - toolH - headH - trayH;
    var s = Math.min(W * 0.94 / (Math.sqrt(3) * (2 * RADIUS + 1)), areaH * 0.95 / (3 * RADIUS + 2));
    geo = { s: s, ox: W / 2, oy: headH + areaH / 2 };

    var prevSet = {}, bad = false;
    if (preview && selected >= 0 && game.tray[selected]) {
      var ok = fits(game.tray[selected], preview[0], preview[1]);
      bad = !ok;
      game.tray[selected].forEach(function (p) { prevSet[key(preview[0] + p[0], preview[1] + p[1])] = 1; });
    }
    cells.forEach(function (cl) {
      var p = cellXY(cl[0], cl[1], s, geo.ox, geo.oy), kk = key(cl[0], cl[1]);
      var style = game.filled[kk] ? "filled" : "empty";
      if (prevSet[kk]) style = bad ? (game.filled[kk] ? "filled" : "bad") : "preview";
      drawCell(ctx, p.x, p.y, s, style);
    });
    RM.hit(0, headH, W, areaH, function (x, y) {
      if (selected < 0 || game.over) return;
      var c = boardCellAt(x, y);
      if (!c) { preview = null; return; }
      var anc = anchorFor(game.tray[selected], c[0], c[1]);
      if (preview && preview[0] === anc[0] && preview[1] === anc[1] && fits(game.tray[selected], anc[0], anc[1])) {
        place(selected, anc[0], anc[1]);
      } else {
        preview = anc;
      }
    });

    // Tray
    var ty = H - toolH - trayH, slotW = W / 3;
    RM.line(0, ty, W, ty, 1);
    game.tray.forEach(function (shape, i) {
      var cx = slotW * (i + 0.5), cy = ty + trayH / 2;
      if (i === selected) RM.box(slotW * i + 6, ty + 6, slotW - 12, trayH - 12, { lineWidth: 4 });
      if (!shape) return;
      var usable = fitsAnywhere(shape);
      var ts = Math.min(s * 0.8, trayH / 7);
      var pts = shape.map(function (p) { return cellXY(p[0], p[1], ts, 0, 0); });
      var minX = Math.min.apply(null, pts.map(function (p) { return p.x; })), maxX = Math.max.apply(null, pts.map(function (p) { return p.x; }));
      var minY = Math.min.apply(null, pts.map(function (p) { return p.y; })), maxY = Math.max.apply(null, pts.map(function (p) { return p.y; }));
      pts.forEach(function (p) { drawCell(ctx, cx + p.x - (minX + maxX) / 2, cy + p.y - (minY + maxY) / 2, ts, usable ? "filled" : "bad"); });
      RM.hit(slotW * i, ty, slotW, trayH, {
        down: function () { selected = i; preview = null; },
        move: function (x, y) {
          if (y >= ty) return;
          var c = boardCellAt(x, y);
          preview = c ? anchorFor(game.tray[i], c[0], c[1]) : null;
        },
        up: function (x, y) {
          if (y < ty && preview && fits(game.tray[i], preview[0], preview[1])) place(i, preview[0], preview[1]);
        }
      });
    });

    if (game.over) {
      var bw = W * 0.7, bh = m * 0.22;
      RM.box((W - bw) / 2, geo.oy - bh / 2, bw, bh, { lineWidth: 4 });
      RM.text("No more room", W / 2, geo.oy - bh * 0.18, bh * 0.22, { align: "center", bold: true });
      RM.text("Score " + game.score + " · " + game.lines + " lines", W / 2, geo.oy + bh * 0.18, bh * 0.15, { align: "center" });
    }
  }

  if (!game || !game.tray) newGame();
  RM.init({ draw: draw });
})();
