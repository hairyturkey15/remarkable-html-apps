// Checkers (American / English draughts) with a bot and two-player mode.
// Rules: 8x8, dark squares only, Dark moves first, men move and capture
// diagonally forward, kings both ways (one square). Captures are compulsory
// (can be turned off) and a capture sequence must be finished; reaching the
// far row crowns a man and ends the move. A side with no moves loses.
(function () {
  "use strict";

  var DARK = 1, LIGHT = -1;
  var OPTS = Object.assign({ opponent: "bot", level: 2, play: DARK, forced: true, showMoves: true }, RM.load("checkers.options", {}));
  var LEVELS = { 1: { depth: 3, name: "Easy", noise: 60 }, 2: { depth: 6, name: "Medium", noise: 8 }, 3: { depth: 9, name: "Hard", noise: 0 } };

  // --- Rules -----------------------------------------------------------
  // board: Int8Array(64); +1/+2 dark man/king, -1/-2 light man/king.
  function startBoard() {
    var b = new Int8Array(64);
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        if ((r + c) % 2 === 0) continue;
        if (r < 3) b[r * 8 + c] = DARK;
        else if (r > 4) b[r * 8 + c] = LIGHT;
      }
    }
    return b;
  }

  function sideOf(p) { return p > 0 ? DARK : p < 0 ? LIGHT : 0; }
  function isKing(p) { return p === 2 || p === -2; }
  function dirs(p) {
    if (isKing(p)) return [[1, -1], [1, 1], [-1, -1], [-1, 1]];
    return p > 0 ? [[1, -1], [1, 1]] : [[-1, -1], [-1, 1]];
  }
  function inside(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
  function crownRow(p) { return p > 0 ? 7 : 0; }

  // Moves: { path: [squares...], caps: [captured squares] }
  function moves(b, side, forced) {
    var jumps = [], steps = [];
    for (var sq = 0; sq < 64; sq++) {
      var p = b[sq];
      if (sideOf(p) !== side) continue;
      collectJumps(b, sq, p, [sq], [], jumps);
      var r = sq >> 3, c = sq & 7;
      dirs(p).forEach(function (d) {
        var nr = r + d[0], nc = c + d[1];
        if (inside(nr, nc) && !b[nr * 8 + nc]) steps.push({ path: [sq, nr * 8 + nc], caps: [] });
      });
    }
    if (jumps.length && forced) return jumps;
    return jumps.concat(steps);
  }

  function collectJumps(b, sq, p, path, caps, out) {
    var r = sq >> 3, c = sq & 7, found = false;
    dirs(p).forEach(function (d) {
      var mr = r + d[0], mc = c + d[1], lr = r + 2 * d[0], lc = c + 2 * d[1];
      if (!inside(lr, lc)) return;
      var mid = mr * 8 + mc, land = lr * 8 + lc;
      if (sideOf(b[mid]) !== -sideOf(p) || caps.indexOf(mid) >= 0) return;
      if (b[land] && land !== path[0]) return;
      found = true;
      var np = path.concat([land]), nc = caps.concat([mid]);
      // Crowning ends the move.
      if (!isKing(p) && lr === crownRow(p)) out.push({ path: np, caps: nc });
      else collectJumps(b, land, p, np, nc, out);
    });
    if (!found && caps.length) out.push({ path: path, caps: caps });
  }

  function apply(b, m) {
    var nb = new Int8Array(b), from = m.path[0], to = m.path[m.path.length - 1], p = nb[from];
    nb[from] = 0;
    m.caps.forEach(function (sq) { nb[sq] = 0; });
    if (!isKing(p) && (to >> 3) === crownRow(p)) p *= 2;
    nb[to] = p;
    return nb;
  }

  // --- Bot -------------------------------------------------------------------
  function evaluate(b, side) {
    var s = 0;
    for (var sq = 0; sq < 64; sq++) {
      var p = b[sq];
      if (!p) continue;
      var r = sq >> 3, c = sq & 7;
      var v = isKing(p) ? 160 : 100;
      if (!isKing(p)) v += (p > 0 ? r : 7 - r) * 4; // advance
      if (c === 0 || c === 7) v += 4; // edges are safe
      if (!isKing(p) && r === (p > 0 ? 0 : 7)) v += 6; // back rank guard
      if (isKing(p)) v -= (Math.abs(3.5 - r) + Math.abs(3.5 - c)) * 2;
      s += sideOf(p) * v;
    }
    return s * side;
  }

  function search(b, side, depth, alpha, beta, ctx) {
    ctx.nodes++;
    var ms = moves(b, side, OPTS.forced);
    if (!ms.length) return -100000 + ctx.ply;
    // Keep following captures past the horizon (they're forced anyway).
    if (depth <= 0 && (!ms[0].caps.length || depth < -6)) return evaluate(b, side);
    if (ctx.nodes > ctx.limit) { ctx.stopped = true; return evaluate(b, side); }
    ms.sort(function (a, c) { return c.caps.length - a.caps.length; });
    var best = -Infinity;
    for (var i = 0; i < ms.length; i++) {
      ctx.ply++;
      var v = -search(apply(b, ms[i]), -side, depth - 1, -beta, -alpha, ctx);
      ctx.ply--;
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  // Iterative deepening: each depth searches every root move in full; if
  // the node budget runs out mid-depth, the last completed depth decides.
  function botMove(b, side) {
    var cfg = LEVELS[OPTS.level] || LEVELS[2];
    var ms = moves(b, side, OPTS.forced);
    if (ms.length <= 1) return ms[0] || null;
    var noise = ms.map(function () { return (Math.random() * 2 - 1) * cfg.noise; });
    var best = ms[0];
    for (var depth = 1; depth <= cfg.depth; depth++) {
      var ctx = { nodes: 0, ply: 1, limit: 80000, stopped: false };
      var bestV = -Infinity, bestHere = null;
      for (var i = 0; i < ms.length; i++) {
        var v = -search(apply(b, ms[i]), -side, depth - 1, -Infinity, Infinity, ctx) + noise[i];
        if (v > bestV) { bestV = v; bestHere = ms[i]; }
      }
      if (ctx.stopped) break;
      best = bestHere;
      if (bestV > 50000) break; // found a forced win
    }
    return best;
  }

  // --- Game state ------------------------------------------------------------
  var game = RM.load("checkers.game", null);
  var partial = null; // squares tapped so far for the human's move
  var thinking = false;

  function newGame() {
    game = {
      history: [{ board: Array.from(startBoard()), side: DARK, quiet: 0 }],
      ply: 0, vsBot: OPTS.opponent === "bot", human: OPTS.play, forced: OPTS.forced
    };
    partial = null;
    save();
    maybeBot();
  }

  function save() { RM.store("checkers.game", game); }
  function cur() { return game.history[game.ply]; }
  function board() { return Int8Array.from(cur().board); }
  function legal() { return moves(board(), cur().side, game.forced); }
  function humanTurn() { return !game.vsBot || cur().side === game.human; }

  function result() {
    var c = cur();
    if (!moves(board(), c.side, game.forced).length) return { winner: -c.side, reason: "no moves left" };
    if (c.quiet >= 80) return { winner: 0, reason: "40 moves each without a capture or a man moving" };
    return null;
  }

  function play(m) {
    var b = board(), p = b[m.path[0]];
    var nb = apply(b, m);
    var quiet = m.caps.length || !isKing(p) ? 0 : cur().quiet + 1;
    game.history.length = game.ply + 1;
    game.history.push({ board: Array.from(nb), side: -cur().side, quiet: quiet, last: m.path });
    game.ply++;
    partial = null;
    save();
    maybeBot();
  }

  function maybeBot() {
    if (!game.vsBot || result() || humanTurn() || game.ply !== game.history.length - 1 || thinking) return;
    thinking = true;
    RM.redraw();
    setTimeout(function () {
      var m = botMove(board(), cur().side);
      thinking = false;
      if (m) play(m);
      RM.redraw();
    }, 50);
  }

  function undo() {
    if (thinking || game.ply === 0) return;
    game.ply--;
    while (game.vsBot && game.ply > 0 && !humanTurn()) game.ply--;
    partial = null;
    save();
  }

  function redo() {
    if (thinking || game.ply >= game.history.length - 1) return;
    game.ply++;
    while (game.vsBot && game.ply < game.history.length - 1 && !humanTurn()) game.ply++;
    partial = null;
    save();
  }

  // --- Input -------------------------------------------------------------------
  function bottomSide() { return game.vsBot ? game.human : (OPTS.flip ? LIGHT : DARK); }

  function tapSquare(sq) {
    if (thinking || result() || !humanTurn()) return;
    var all = legal();
    if (partial) {
      var next = partial.concat([sq]);
      var cont = all.filter(function (m) { return prefix(next, m.path); });
      if (cont.length) {
        var done = cont.filter(function (m) { return m.path.length === next.length; });
        if (done.length && cont.length === done.length) play(done[0]);
        else partial = next;
        return;
      }
    }
    var mine = all.filter(function (m) { return m.path[0] === sq; });
    partial = mine.length ? [sq] : null;
    if (!mine.length && sideOf(board()[sq]) === cur().side && all.length && all[0].caps.length && game.forced) {
      RM.toast("A capture is available: you must take it.");
    }
  }

  function prefix(a, path) {
    if (a.length > path.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== path[i]) return false;
    return true;
  }

  function options() {
    var o = [
      { label: "Opponent: " + (OPTS.opponent === "bot" ? "Bot" : "Two players"), value: "opp" },
      { label: "Bot level: " + LEVELS[OPTS.level].name, value: "lvl" },
      { label: "Play as: " + (OPTS.play === DARK ? "Dark (moves first)" : "Light"), value: "side" },
      { label: (OPTS.forced ? "✓ " : "") + "Captures are compulsory", value: "forced" },
      { label: (OPTS.showMoves ? "✓ " : "") + "Show possible moves", value: "show" },
      { label: "Start a new game", value: "new" }
    ];
    RM.choose("Options (new game to apply)", o, function (v) {
      if (!v) return;
      if (v === "opp") OPTS.opponent = OPTS.opponent === "bot" ? "human" : "bot";
      if (v === "lvl") OPTS.level = OPTS.level % 3 + 1;
      if (v === "side") OPTS.play = -OPTS.play;
      if (v === "forced") OPTS.forced = !OPTS.forced;
      if (v === "show") OPTS.showMoves = !OPTS.showMoves;
      RM.store("checkers.options", OPTS);
      if (v === "new") newGame();
      else options();
    });
  }

  // --- Drawing -----------------------------------------------------------------
  function drawPiece(ctx, cx, cy, r, p) {
    var dark = p > 0;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = dark ? RM.INK : RM.PAPER;
    ctx.fill();
    ctx.lineWidth = Math.max(2, r * 0.1);
    ctx.strokeStyle = RM.INK;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.68, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1.5, r * 0.06);
    ctx.strokeStyle = dark ? RM.PAPER : RM.INK;
    ctx.stroke();
    if (isKing(p)) {
      // Crown
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.42, cy + r * 0.22);
      ctx.lineTo(cx - r * 0.45, cy - r * 0.25);
      ctx.lineTo(cx - r * 0.2, cy);
      ctx.lineTo(cx, cy - r * 0.35);
      ctx.lineTo(cx + r * 0.2, cy);
      ctx.lineTo(cx + r * 0.45, cy - r * 0.25);
      ctx.lineTo(cx + r * 0.42, cy + r * 0.22);
      ctx.closePath();
      ctx.fillStyle = dark ? RM.PAPER : RM.INK;
      ctx.fill();
    }
  }

  function draw(ctx, W, H) {
    var m = Math.min(W, H), pad = Math.round(m * 0.03);
    var toolH = RM.toolbar([
      { label: "New", icon: "plus", fn: function () { RM.confirm("Start a new game?", function (ok) { if (ok) newGame(); }); } },
      { label: "Undo", icon: "undo", fn: undo, disabled: game.ply === 0 || thinking },
      { label: "Redo", icon: "redo", fn: redo, disabled: game.ply >= game.history.length - 1 || thinking },
      { label: "Options", icon: "gear", fn: options }
    ]);
    var statusH = m * 0.08;
    var size = Math.floor(Math.min(W - 2 * pad, H - toolH - 2 * statusH - 2 * pad) / 8) * 8, sq = size / 8;
    var bx = (W - size) / 2, by = statusH + pad + (H - toolH - 2 * statusH - 2 * pad - size) / 2;
    var flip = bottomSide() === DARK; // dark starts at the top rows
    var pos = function (s) {
      var r = s >> 3, c = s & 7;
      if (flip) { r = 7 - r; c = 7 - c; }
      return { x: bx + c * sq, y: by + r * sq };
    };
    var b = board(), c = cur(), res = result();
    var all = res ? [] : legal();
    for (var s = 0; s < 64; s++) {
      var p0 = pos(s);
      if (((s >> 3) + (s & 7)) % 2) {
        ctx.fillStyle = "#9c9c9c";
        ctx.fillRect(p0.x, p0.y, sq, sq);
      } else {
        ctx.fillStyle = RM.PAPER;
        ctx.fillRect(p0.x, p0.y, sq, sq);
      }
    }
    if (c.last) {
      c.last.forEach(function (s2) {
        var lp = pos(s2);
        ctx.lineWidth = Math.max(3, sq * 0.06);
        ctx.strokeStyle = RM.PAPER;
        ctx.strokeRect(lp.x + ctx.lineWidth, lp.y + ctx.lineWidth, sq - 2 * ctx.lineWidth, sq - 2 * ctx.lineWidth);
      });
    }
    var movable = {};
    all.forEach(function (mv) { movable[mv.path[0]] = 1; });
    for (s = 0; s < 64; s++) {
      if (!b[s]) continue;
      var pp = pos(s);
      if (partial && partial[0] === s) {
        ctx.fillStyle = RM.PAPER;
        ctx.fillRect(pp.x + 3, pp.y + 3, sq - 6, sq - 6);
      }
      drawPiece(ctx, pp.x + sq / 2, pp.y + sq / 2, sq * 0.38, b[s]);
      if (OPTS.showMoves && !partial && movable[s] && humanTurn() && !thinking) {
        ctx.beginPath();
        ctx.arc(pp.x + sq / 2, pp.y + sq / 2, sq * 0.46, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = RM.INK;
        ctx.stroke();
      }
    }
    if (partial) {
      // Where the selected piece can go next.
      var nexts = {};
      all.forEach(function (mv) { if (prefix(partial, mv.path) && mv.path.length > partial.length) nexts[mv.path[partial.length]] = 1; });
      Object.keys(nexts).forEach(function (k) {
        var np = pos(+k);
        ctx.beginPath();
        ctx.arc(np.x + sq / 2, np.y + sq / 2, sq * 0.16, 0, Math.PI * 2);
        ctx.fillStyle = RM.INK;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = RM.PAPER;
        ctx.stroke();
      });
      partial.slice(1).forEach(function (s2) {
        var hp = pos(s2);
        ctx.beginPath();
        ctx.arc(hp.x + sq / 2, hp.y + sq / 2, sq * 0.2, 0, Math.PI * 2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = RM.INK;
        ctx.stroke();
      });
    }
    ctx.lineWidth = 3;
    ctx.strokeStyle = RM.INK;
    ctx.strokeRect(bx, by, size, size);
    RM.hit(bx, by, size, size, function (x, y) {
      var col = Math.floor((x - bx) / sq), row = Math.floor((y - by) / sq);
      if (flip) { row = 7 - row; col = 7 - col; }
      tapSquare(row * 8 + col);
    });

    // Players and status
    var count = function (side) { var n = 0; for (var i = 0; i < 64; i++) if (sideOf(b[i]) === side) n++; return n; };
    var name = function (side) {
      var label = side === DARK ? "Dark" : "Light";
      if (game.vsBot) label += side === game.human ? " (you)" : " (bot · " + LEVELS[OPTS.level].name + ")";
      return label + " · " + count(side) + " pieces";
    };
    var topSide = -bottomSide();
    RM.text(name(topSide), bx, statusH / 2 + pad / 2, statusH * 0.36, { bold: c.side === topSide && !res });
    RM.text(name(-topSide), bx, by + size + statusH * 0.5, statusH * 0.36, { bold: c.side === -topSide && !res });
    var msg;
    if (res) msg = res.winner === 0 ? "Draw: " + res.reason : (res.winner === DARK ? "Dark" : "Light") + " wins (" + res.reason + ")";
    else if (thinking) msg = "Bot is thinking…";
    else msg = (c.side === DARK ? "Dark" : "Light") + " to move" + (all.length && all[0].caps.length && game.forced ? " · capture!" : "");
    RM.text(msg, W - bx, by + size + statusH * 0.5, statusH * 0.34, { align: "right", bold: !!res });
  }

  if (!game || !game.history) newGame();
  RM.init({ draw: draw });
  maybeBot();
})();
