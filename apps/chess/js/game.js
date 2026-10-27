// Chess UI for a canvas: drawn from scratch on every change, and only on a
// change. Nothing ticks unless the player turns on the live clock in
// settings, which matters on e-ink.
(function () {
  "use strict";

  var E = ChessEngine, Bot = ChessBot;
  var WHITE = E.WHITE, BLACK = E.BLACK;
  var onTablet = typeof htmlload !== "undefined" && !!htmlload;
  var canvas = document.getElementById("board");
  var ctx = canvas.getContext("2d");
  var DPR = 1, W = 0, H = 0;

  var INK = "#111111", PAPER = "#ffffff", LIGHT_SQ = "#ffffff", DARK_SQ = "#b4b4b4", MUTED = "#6a6a6a";
  var FONT = "sans-serif";

  var DEFAULTS = {
    variant: "standard", opponent: "bot", level: 2, playAs: "white",
    minutes: 0, increment: 0, liveClock: false,
    pieceSet: "2d", showMoves: true, coords: true, scale: 100, align: "center", flip: false
  };
  var VARIANT_NAMES = { standard: "Standard", atomic: "Atomic", crazyhouse: "Crazyhouse", horde: "Horde" };

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

  var settings = Object.assign({}, DEFAULTS, load("chess.settings", {}));
  function saveSettings() { store("chess.settings", settings); }

  // ------------------------------------------------------------------
  // Piece images: pieces/<set>/<w|b><K|Q|R|B|N|P>.png next to index.html
  // ------------------------------------------------------------------
  var images = {};
  function pieceKey(p) { return (E.colorOf(p) === WHITE ? "w" : "b") + E.LETTERS[E.typeOf(p)]; }
  function loadPieceSet(set) {
    if (images[set]) return;
    images[set] = {};
    "KQRBNP".split("").forEach(function (t) {
      ["w", "b"].forEach(function (c) {
        var img = new Image();
        img.onload = drawSoon;
        img.onerror = function () { img.broken = true; };
        img.src = "pieces/" + set + "/" + c + t + ".png";
        images[set][c + t] = img;
      });
    });
  }

  // ------------------------------------------------------------------
  // Game model. history[i].state is the position after i plies; undo and
  // redo just move `ply`. Clocks are stored per entry so they rewind too.
  // ------------------------------------------------------------------
  var game = null;
  var view = { children: [], legal: [], result: null, check: false, thinking: false };
  var sel = null; // { sq, drop, targets }
  var promo = null; // { to, moves }
  var settingsOpen = false, editor = null, bannerHidden = false, newArmed = false, notice = "";
  var turnStart = Date.now();
  var timers = { flag: 0, tick: 0, newArm: 0, draw: 0, flash: 0 };
  var flashing = false;
  var drag = { sq: -1 };

  function cur() { return game.history[game.ply]; }
  function state() { return cur().state; }
  function timed() { return game.minutes > 0; }
  function humanTurn() { return !game.vsBot || state().turn !== game.botColor; }
  function atEnd() { return game.ply === game.history.length - 1; }

  function clockRunning() {
    return timed() && game.ply >= 1 && !view.result;
  }

  function remaining(color) {
    var t = cur().clocks[color];
    if (clockRunning() && color === state().turn) t -= Date.now() - turnStart;
    return Math.max(0, t);
  }

  function newGame(fen) {
    var variant = settings.variant;
    var ms = settings.minutes * 60000;
    var s;
    try {
      s = E.fromFEN(fen || E.START_FEN[variant], variant);
    } catch (e) {
      s = E.fromFEN(E.START_FEN[variant], variant);
    }
    game = {
      variant: variant,
      startFen: E.toFEN(s),
      history: [{ state: s, move: null, san: "", key: E.positionKey(s), clocks: [ms, ms], blast: [] }],
      ply: 0,
      minutes: settings.minutes,
      increment: settings.increment,
      vsBot: settings.opponent === "bot",
      botColor: settings.playAs === "white" ? BLACK : WHITE,
      level: settings.level,
      flag: null
    };
    sel = promo = null;
    bannerHidden = false;
    onPositionChanged();
  }

  function serialize() {
    return {
      variant: game.variant, startFen: game.startFen, ply: game.ply,
      moves: game.history.slice(1).map(function (h) { return E.uci(h.move); }),
      clocks: game.history.map(function (h) { return h.clocks; }),
      minutes: game.minutes, increment: game.increment,
      vsBot: game.vsBot, botColor: game.botColor, level: game.level, flag: game.flag
    };
  }

  function restore(data) {
    var s = E.fromFEN(data.startFen, data.variant);
    var hist = [{ state: s, move: null, san: "", key: E.positionKey(s), clocks: data.clocks[0], blast: [] }];
    for (var i = 0; i < data.moves.length; i++) {
      var children = E.legalChildren(s);
      var child = null;
      for (var j = 0; j < children.length; j++) if (E.uci(children[j].move) === data.moves[i]) child = children[j];
      if (!child) break;
      hist.push(makeEntry(s, child, data.clocks[i + 1], children));
      s = child.state;
    }
    game = {
      variant: data.variant, startFen: data.startFen, history: hist,
      ply: Math.min(data.ply, hist.length - 1),
      minutes: data.minutes, increment: data.increment,
      vsBot: data.vsBot, botColor: data.botColor, level: data.level, flag: data.flag
    };
  }

  function saveGame() { store("chess.game", serialize()); }

  function makeEntry(prev, child, clocks, siblings) {
    var m = child.move, blast = [];
    if (prev.variant === "atomic" && child.state.removed.length) {
      blast = [m.to].concat(E.KING_TO[m.to]);
    }
    return {
      state: child.state, move: m,
      san: E.san(prev, m, siblings.map(function (c) { return c.move; })),
      key: E.positionKey(child.state), clocks: clocks, blast: blast
    };
  }

  // Recomputes everything derived from the current position.
  function onPositionChanged() {
    var s = state();
    view.children = E.legalChildren(s);
    view.legal = view.children.map(function (c) { return c.move; });
    var res = E.outcome(s, view.legal.length);
    if (!res) {
      var reps = 0, key = cur().key;
      for (var i = 0; i <= game.ply; i++) if (game.history[i].key === key) reps++;
      if (reps >= 3) res = { winner: -1, reason: "Threefold repetition" };
    }
    if (!res && game.flag && game.flag.ply === game.ply) res = { winner: 1 - game.flag.loser, reason: "Time" };
    view.result = res;
    view.check = !!((!res && E.inCheck(s, s.turn)) || (res && res.reason === "Checkmate"));
    turnStart = Date.now();
    armClock();
    saveGame();
    draw();
    maybeBotMove();
  }

  function commitMove(move) {
    var s = state();
    var child = null;
    for (var i = 0; i < view.children.length; i++) if (view.children[i].move === move) child = view.children[i];
    if (!child) return;
    var clocks = cur().clocks.slice();
    if (timed()) {
      if (clockRunning()) {
        clocks[s.turn] -= Date.now() - turnStart;
        if (clocks[s.turn] <= 0) {
          flagFall(s.turn);
          return;
        }
      }
      clocks[s.turn] += game.increment * 1000;
    }
    game.history.length = game.ply + 1;
    game.history.push(makeEntry(s, child, clocks, view.children));
    game.ply++;
    game.flag = null;
    sel = promo = null;
    bannerHidden = false;
    notice = "";
    onPositionChanged();
  }

  function flagFall(color) {
    cur().clocks = cur().clocks.slice();
    cur().clocks[color] = 0;
    game.flag = { ply: game.ply, loser: color };
    sel = promo = null;
    onPositionChanged();
  }

  // One timeout at the exact moment the side to move would run out, rather
  // than polling. The per-second redraw only exists with "Live clock" on.
  function armClock() {
    clearTimeout(timers.flag);
    clearInterval(timers.tick);
    timers.flag = timers.tick = 0;
    if (!clockRunning() || !atEnd()) return;
    var turn = state().turn;
    timers.flag = setTimeout(function () {
      if (remaining(turn) <= 0 && state().turn === turn) flagFall(turn);
      else armClock();
    }, remaining(turn) + 25);
    if (settings.liveClock) timers.tick = setInterval(draw, 1000);
  }

  function maybeBotMove() {
    if (!game.vsBot || view.result || view.thinking || !atEnd() || state().turn !== game.botColor) return;
    view.thinking = true;
    draw();
    // Let the "thinking" frame reach the screen before the CPU is busy.
    setTimeout(function () {
      var keys = game.history.slice(0, game.ply + 1).map(function (h) { return h.key; });
      var move = Bot.chooseMove(state(), game.level, keys);
      view.thinking = false;
      if (move) {
        for (var i = 0; i < view.legal.length; i++) if (E.uci(view.legal[i]) === E.uci(move)) move = view.legal[i];
        commitMove(move);
      } else {
        draw();
      }
    }, 60);
  }

  function undo() {
    if (view.thinking || game.ply === 0) return;
    game.ply--;
    // Against the bot, step back to the player's own turn.
    while (game.vsBot && game.ply > 0 && state().turn === game.botColor) game.ply--;
    sel = promo = null;
    bannerHidden = false;
    onPositionChanged();
  }

  function redo() {
    if (view.thinking || atEnd()) return;
    game.ply++;
    while (game.vsBot && !atEnd() && state().turn === game.botColor) game.ply++;
    sel = promo = null;
    bannerHidden = false;
    onPositionChanged();
  }

  // ------------------------------------------------------------------
  // Full-screen refresh: black, then white, then the board again. E-ink
  // only clears ghosting when every pixel is driven hard, so each frame
  // stays up long enough for the panel to finish its update.
  // ------------------------------------------------------------------
  function flashRefresh() {
    if (flashing) return;
    flashing = true;
    fillScreen(INK);
    timers.flash = setTimeout(function () {
      fillScreen(PAPER);
      timers.flash = setTimeout(function () {
        flashing = false;
        draw();
      }, 350);
    }, 350);
  }

  function fillScreen(color) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, W, H);
  }

  // ------------------------------------------------------------------
  // Layout
  // ------------------------------------------------------------------
  var L = {};
  function layout() {
    var m = Math.min(W, H);
    L.pad = Math.round(m * 0.025);
    L.toolH = Math.round(Math.max(56, m * 0.1));
    L.barH = Math.round(Math.max(40, m * 0.075));
    L.statusH = Math.round(Math.max(26, m * 0.05));
    L.cell = Math.round(Math.min((W - 2 * L.pad) / 7, m * 0.085));
    var below = editor ? 2 * L.cell + L.statusH : L.barH + L.statusH;
    var availW = W - 2 * L.pad;
    var availH = H - L.toolH - L.barH - below - 3 * L.pad;
    var size = Math.max(64, Math.min(availW, availH)) * settings.scale / 100;
    L.sq = Math.floor(size / 8);
    L.S = L.sq * 8;
    L.bx = Math.round((W - L.S) / 2);
    var block = L.barH + L.S + below;
    var top = settings.align === "top" ? L.pad : Math.max(L.pad, Math.round((H - L.toolH - block) / 2));
    L.topBarY = top;
    L.by = top + L.barH;
    L.botBarY = L.by + L.S;
    L.statusY = L.botBarY + (editor ? 2 * L.cell : L.barH);
    L.toolY = H - L.toolH;
    L.barX = Math.min(L.bx, Math.max(L.pad, Math.round((W - Math.max(L.S, Math.min(W - 2 * L.pad, 9 * L.barH))) / 2)));
    L.barW = W - 2 * L.barX;
  }

  function bottomColor() {
    var base = game.vsBot ? 1 - game.botColor : WHITE;
    return settings.flip ? 1 - base : base;
  }

  function squareXY(sq) {
    var r = sq >> 3, f = sq & 7;
    if (bottomColor() === BLACK) { r = 7 - r; f = 7 - f; }
    return { x: L.bx + f * L.sq, y: L.by + r * L.sq };
  }

  function squareAt(x, y) {
    if (x < L.bx || y < L.by || x >= L.bx + L.S || y >= L.by + L.S) return -1;
    var f = Math.floor((x - L.bx) / L.sq), r = Math.floor((y - L.by) / L.sq);
    if (bottomColor() === BLACK) { r = 7 - r; f = 7 - f; }
    return r * 8 + f;
  }

  // ------------------------------------------------------------------
  // Drawing helpers. Every tappable thing registers a hit box while it is
  // drawn; the last one drawn is on top.
  // ------------------------------------------------------------------
  var hits = [];
  function hit(x, y, w, h, fn) { hits.push({ x: x, y: y, w: w, h: h, fn: fn }); }

  function font(px, bold) { ctx.font = (bold ? "bold " : "") + Math.round(px) + "px " + FONT; }

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function text(str, x, y, px, opts) {
    opts = opts || {};
    font(px, opts.bold);
    ctx.fillStyle = opts.color || INK;
    ctx.textAlign = opts.align || "left";
    ctx.textBaseline = "middle";
    ctx.fillText(str, x, y);
  }

  function fitText(str, maxW, px, bold) {
    font(px, bold);
    while (px > 8 && ctx.measureText(str).width > maxW) {
      px *= 0.9;
      font(px, bold);
    }
    return px;
  }

  function button(x, y, w, h, label, fn, opts) {
    opts = opts || {};
    roundRect(x, y, w, h, Math.min(h * 0.22, 16));
    ctx.fillStyle = opts.active ? INK : PAPER;
    ctx.fill();
    ctx.lineWidth = Math.max(2, h * 0.04);
    ctx.strokeStyle = opts.disabled ? "#bdbdbd" : INK;
    ctx.stroke();
    var px = fitText(label, w * 0.86, opts.px || h * 0.4, opts.bold);
    text(label, x + w / 2, y + h / 2, px, { align: "center", bold: opts.bold, color: opts.active ? PAPER : (opts.disabled ? "#a0a0a0" : INK) });
    if (fn && !opts.disabled) hit(x, y, w, h, fn);
  }

  function drawPiece(p, x, y, size) {
    var set = images[settings.pieceSet];
    var img = set && set[pieceKey(p)];
    if (img && img.complete && !img.broken && (onTablet || img.naturalWidth > 0)) {
      ctx.drawImage(img, x, y, size, size);
      return;
    }
    // Fallback until the images load (or if they are missing).
    var white = E.colorOf(p) === WHITE;
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size * 0.36, 0, Math.PI * 2);
    ctx.fillStyle = white ? PAPER : INK;
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, size * 0.04);
    ctx.strokeStyle = INK;
    ctx.stroke();
    text(E.LETTERS[E.typeOf(p)], x + size / 2, y + size / 2, size * 0.42, { align: "center", bold: true, color: white ? INK : PAPER });
  }

  // ------------------------------------------------------------------
  // Main draw
  // ------------------------------------------------------------------
  function draw() {
    clearTimeout(timers.draw);
    timers.draw = 0;
    if (!game || W <= 0 || H <= 0 || flashing) return;
    hits = [];
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, W, H);
    layout();
    if (editor) {
      drawEditor();
    } else {
      drawBar(1 - bottomColor(), L.topBarY);
      drawBar(bottomColor(), L.botBarY);
      drawBoard(state());
      drawStatus();
      drawToolbar();
      drawBanner();
      drawPromotion();
    }
    if (settingsOpen) drawSettings();
  }

  function drawSoon() {
    if (!timers.draw) timers.draw = setTimeout(draw, 30);
  }

  function drawBoard(s, editing) {
    var b = s.board, sz = L.sq, entry = cur();
    hit(L.bx, L.by, L.S, L.S, editing ? editorTap : boardTap);
    for (var sq = 0; sq < 64; sq++) {
      var p = squareXY(sq);
      ctx.fillStyle = ((sq >> 3) + (sq & 7)) % 2 ? DARK_SQ : LIGHT_SQ;
      ctx.fillRect(p.x, p.y, sz, sz);
    }
    if (!editing && entry.move) {
      ctx.fillStyle = "rgba(0,0,0,0.16)";
      [entry.move.from, entry.move.to].forEach(function (sq) {
        if (sq < 0) return;
        var p = squareXY(sq);
        ctx.fillRect(p.x, p.y, sz, sz);
      });
      entry.blast.forEach(function (sq) { drawBlast(squareXY(sq), sz); });
    }
    var mated = !editing && view.result && view.result.reason === "Checkmate";
    var checkSq = !editing && view.check ? s.kings[s.turn] : -1;
    if (checkSq >= 0) {
      var c = squareXY(checkSq);
      if (mated) {
        ctx.fillStyle = "#7c7c7c";
        ctx.fillRect(c.x, c.y, sz, sz);
      } else {
        ctx.beginPath();
        ctx.arc(c.x + sz / 2, c.y + sz / 2, sz * 0.45, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.30)";
        ctx.fill();
      }
    }
    if (!editing && sel && sel.sq >= 0) {
      var sp = squareXY(sel.sq);
      ctx.lineWidth = Math.max(3, sz * 0.08);
      ctx.strokeStyle = INK;
      ctx.strokeRect(sp.x + ctx.lineWidth / 2, sp.y + ctx.lineWidth / 2, sz - ctx.lineWidth, sz - ctx.lineWidth);
    }
    for (sq = 0; sq < 64; sq++) {
      if (!b[sq]) continue;
      var pp = squareXY(sq);
      drawPiece(b[sq], pp.x, pp.y, sz);
    }
    if (checkSq >= 0) {
      var k = squareXY(checkSq);
      ctx.lineWidth = Math.max(3, sz * 0.07);
      ctx.strokeStyle = INK;
      ctx.beginPath();
      ctx.arc(k.x + sz / 2, k.y + sz / 2, sz * 0.46, 0, Math.PI * 2);
      ctx.stroke();
      if (mated) {
        ctx.beginPath();
        ctx.arc(k.x + sz * 0.8, k.y + sz * 0.2, sz * 0.17, 0, Math.PI * 2);
        ctx.fillStyle = INK;
        ctx.fill();
        text("#", k.x + sz * 0.8, k.y + sz * 0.21, sz * 0.24, { align: "center", bold: true, color: PAPER });
      }
    }
    if (!editing && sel && settings.showMoves) {
      var done = {};
      sel.targets.forEach(function (m) {
        if (done[m.to]) return;
        done[m.to] = 1;
        var t = squareXY(m.to);
        var capture = b[m.to] || m.flag === E.FLAG_EP;
        ctx.beginPath();
        if (capture) {
          ctx.arc(t.x + sz / 2, t.y + sz / 2, sz * 0.44, 0, Math.PI * 2);
          ctx.lineWidth = Math.max(3, sz * 0.08);
          ctx.strokeStyle = "rgba(0,0,0,0.6)";
          ctx.stroke();
        } else {
          ctx.arc(t.x + sz / 2, t.y + sz / 2, sz * 0.16, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(0,0,0,0.5)";
          ctx.fill();
        }
      });
    }
    if (settings.coords) {
      var px = Math.max(9, sz * 0.18);
      for (var i = 0; i < 8; i++) {
        var fileSq = bottomColor() === WHITE ? 56 + i : 7 - i;
        var rankSq = bottomColor() === WHITE ? i * 8 : 63 - i * 8;
        var fp = squareXY(fileSq), rp = squareXY(rankSq);
        text("abcdefgh"[fileSq & 7], fp.x + sz - px * 0.45, fp.y + sz - px * 0.6, px, { align: "center", bold: true, color: (fileSq % 2 === (fileSq >> 3) % 2) ? "#7a7a7a" : PAPER });
        text(String(8 - (rankSq >> 3)), rp.x + px * 0.5, rp.y + px * 0.7, px, { align: "center", bold: true, color: ((rankSq >> 3) + (rankSq & 7)) % 2 ? PAPER : "#7a7a7a" });
      }
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = INK;
    ctx.strokeRect(L.bx - 1, L.by - 1, L.S + 2, L.S + 2);
  }

  function drawBlast(p, sz) {
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = Math.max(1.5, sz * 0.025);
    var cx = p.x + sz / 2, cy = p.y + sz / 2;
    ctx.beginPath();
    for (var i = 0; i < 8; i++) {
      var a = i * Math.PI / 4;
      ctx.moveTo(cx + Math.cos(a) * sz * 0.12, cy + Math.sin(a) * sz * 0.12);
      ctx.lineTo(cx + Math.cos(a) * sz * 0.3, cy + Math.sin(a) * sz * 0.3);
    }
    ctx.stroke();
  }

  function formatClock(ms) {
    var total = Math.ceil(ms / 1000);
    var h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60;
    return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }

  // Pieces a side has taken off the board (in atomic, including blasts).
  function lostPieces(color) {
    var counts = [0, 0, 0, 0, 0, 0, 0];
    for (var i = 1; i <= game.ply; i++) {
      var rem = game.history[i].state.removed;
      for (var j = 0; j < rem.length; j++) if (E.colorOf(rem[j]) === color) counts[E.typeOf(rem[j])]++;
    }
    return counts;
  }

  function materialBalance(s) {
    var d = E.materialOf(s, WHITE) - E.materialOf(s, BLACK);
    if (s.variant === "crazyhouse") {
      for (var t = 1; t <= 5; t++) d += (s.pockets[WHITE][t] - s.pockets[BLACK][t]) * E.VALUES[t];
    }
    return d;
  }

  function drawBar(color, y) {
    var s = state(), h = L.barH, x = L.barX, w = L.barW;
    var toMove = !view.result && s.turn === color;
    var name = game.vsBot && color === game.botColor ? "Bot · " + Bot.LEVELS[game.level].name : (color === WHITE ? "White" : "Black");
    if (game.vsBot && color !== game.botColor) name = "You";
    var cy = y + h / 2;

    // Turn marker + name
    ctx.beginPath();
    ctx.arc(x + h * 0.18, cy, h * 0.12, 0, Math.PI * 2);
    ctx.fillStyle = color === WHITE ? PAPER : INK;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = INK;
    ctx.stroke();
    if (toMove) {
      ctx.beginPath();
      ctx.arc(x + h * 0.18, cy, h * 0.2, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(2, h * 0.05);
      ctx.stroke();
    }
    var namePx = h * 0.3;
    text(name, x + h * 0.48, cy, namePx, { bold: toMove });
    font(namePx, toMove);
    var cx = x + h * 0.48 + ctx.measureText(name).width + h * 0.25;

    var clockW = timed() ? h * 1.9 : 0;
    var limit = x + w - clockW - h * 0.2;

    if (s.variant === "crazyhouse") {
      // The pocket: tap a piece to drop it.
      var cs = h * 0.66;
      for (var t = E.P; t <= E.Q; t++) {
        var n = s.pockets[color][t];
        if (!n || cx + cs > limit) continue;
        var picked = sel && sel.drop === t && color === s.turn;
        if (picked) {
          roundRect(cx - 2, cy - cs / 2 - 2, cs + 4, cs + 4, 8);
          ctx.fillStyle = "rgba(0,0,0,0.2)";
          ctx.fill();
        }
        drawPiece(E.pc(color, t), cx, cy - cs / 2, cs);
        if (n > 1) text("×" + n, cx + cs * 0.98, cy + cs * 0.32, h * 0.22, { bold: true, align: "right" });
        if (color === s.turn && canAct()) hit(cx, y, cs, h, pickDrop.bind(null, t));
        cx += cs + h * 0.08;
      }
    } else {
      var lost = lostPieces(1 - color), ics = h * 0.48;
      for (var tt = E.P; tt <= E.Q; tt++) {
        for (var k = 0; k < lost[tt]; k++) {
          if (cx + ics > limit) break;
          drawPiece(E.pc(1 - color, tt), cx, cy - ics / 2, ics);
          cx += ics * 0.48;
        }
        if (lost[tt]) cx += ics * 0.58;
      }
    }
    var bal = materialBalance(s) * (color === WHITE ? 1 : -1);
    if (bal > 0 && cx + h * 0.4 < limit) text("+" + bal, cx + h * 0.05, cy, h * 0.28, { bold: true, color: MUTED });

    if (timed()) {
      var bx = x + w - clockW, by = y + h * 0.12, bh = h * 0.76;
      var running = clockRunning() && toMove;
      roundRect(bx, by, clockW, bh, 10);
      ctx.fillStyle = running ? INK : PAPER;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = INK;
      ctx.stroke();
      text(formatClock(remaining(color)), bx + clockW / 2, by + bh / 2, bh * 0.52, { align: "center", bold: true, color: running ? PAPER : INK });
    }
  }

  function statusText() {
    if (editor) return notice;
    var s = state();
    if (view.result) {
      var r = view.result;
      if (r.winner === -1) return "Draw · " + r.reason;
      return (r.winner === WHITE ? "White" : "Black") + " wins · " + (r.reason === "Time" ? "on time" : r.reason);
    }
    if (view.thinking) return "Bot is thinking…";
    if (notice) return notice;
    var who = s.turn === WHITE ? "White" : "Black";
    var line = (view.check ? "Check! " : "") + who + " to move";
    if (cur().san) line += "   ·   " + Math.ceil(game.ply / 2) + (game.ply % 2 ? ". " : "… ") + cur().san;
    if (game.variant !== "standard") line = VARIANT_NAMES[game.variant] + "   ·   " + line;
    return line;
  }

  function drawStatus() {
    var str = statusText();
    var px = fitText(str, W - 2 * L.pad, L.statusH * 0.55, !!view.result || view.check);
    text(str, W / 2, L.statusY + L.statusH / 2, px, { align: "center", bold: !!view.result || view.check });
  }

  // --- Toolbar: settings gear in the bottom-left corner --------------
  function drawToolbar() {
    var h = L.toolH, y = L.toolY;
    ctx.fillStyle = INK;
    ctx.fillRect(0, y, W, 2);
    var gearW = h * 1.1;
    drawGear(L.pad + gearW / 2 - h * 0.05, y + h / 2, h * 0.3);
    hit(0, y, gearW + L.pad, h, function () { settingsOpen = true; });

    var items = [
      { label: "Undo", icon: "undo", fn: undo, off: game.ply === 0 || view.thinking },
      { label: "Redo", icon: "redo", fn: redo, off: atEnd() || view.thinking },
      { label: "Flip", icon: "flip", fn: function () { settings.flip = !settings.flip; saveSettings(); } },
      { label: "Refresh", icon: "refresh", fn: flashRefresh },
      { label: newArmed ? "Sure?" : "New", icon: "new", fn: armNewGame, armed: newArmed }
    ];
    var x0 = L.pad + gearW + L.pad * 0.5, bw = (W - x0 - L.pad) / items.length;
    items.forEach(function (it, i) {
      var bx = x0 + i * bw, color = it.off ? "#b0b0b0" : INK;
      if (it.armed) {
        roundRect(bx + bw * 0.08, y + h * 0.1, bw * 0.84, h * 0.8, 14);
        ctx.fillStyle = INK;
        ctx.fill();
        color = PAPER;
      }
      drawIcon(it.icon, bx + bw / 2, y + h * 0.38, h * 0.2, color);
      text(it.label, bx + bw / 2, y + h * 0.76, h * 0.2, { align: "center", color: color, bold: it.armed });
      if (!it.off) hit(bx, y, bw, h, it.fn);
    });
  }

  function armNewGame() {
    if (newArmed) {
      newArmed = false;
      clearTimeout(timers.newArm);
      newGame();
      return;
    }
    newArmed = true;
    clearTimeout(timers.newArm);
    timers.newArm = setTimeout(function () { newArmed = false; draw(); }, 3000);
  }

  function drawGear(cx, cy, r) {
    ctx.beginPath();
    var teeth = 8;
    for (var i = 0; i < teeth * 2; i++) {
      var a0 = (i / (teeth * 2)) * Math.PI * 2 - Math.PI / (teeth * 2);
      var a1 = a0 + Math.PI / teeth;
      var rad = i % 2 === 0 ? r : r * 0.76;
      ctx.arc(cx, cy, rad, a0, a1, false);
    }
    ctx.closePath();
    ctx.fillStyle = INK;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.32, 0, Math.PI * 2);
    ctx.fillStyle = PAPER;
    ctx.fill();
  }

  function drawIcon(kind, cx, cy, r, color) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(2, r * 0.22);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (kind === "undo" || kind === "redo") {
      var dir = kind === "undo" ? -1 : 1;
      ctx.beginPath();
      ctx.arc(cx, cy + r * 0.25, r * 0.8, Math.PI * 1.05, Math.PI * 1.95, false);
      ctx.stroke();
      // Arrowhead at the leading end.
      var ex = cx + dir * r * 0.8 * Math.cos(Math.PI * 0.05), ey = cy + r * 0.25 - r * 0.8 * Math.sin(Math.PI * 0.05);
      ctx.beginPath();
      ctx.moveTo(ex + dir * r * 0.32, ey - r * 0.05);
      ctx.lineTo(ex - dir * r * 0.05, ey + r * 0.42);
      ctx.lineTo(ex - dir * r * 0.4, ey - r * 0.12);
      ctx.closePath();
      ctx.fill();
    } else if (kind === "flip") {
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.45, cy + r * 0.9);
      ctx.lineTo(cx - r * 0.45, cy - r * 0.7);
      ctx.moveTo(cx - r * 0.85, cy - r * 0.3);
      ctx.lineTo(cx - r * 0.45, cy - r * 0.8);
      ctx.lineTo(cx - r * 0.05, cy - r * 0.3);
      ctx.moveTo(cx + r * 0.45, cy - r * 0.9);
      ctx.lineTo(cx + r * 0.45, cy + r * 0.7);
      ctx.moveTo(cx + r * 0.05, cy + r * 0.3);
      ctx.lineTo(cx + r * 0.45, cy + r * 0.8);
      ctx.lineTo(cx + r * 0.85, cy + r * 0.3);
      ctx.stroke();
    } else if (kind === "refresh") {
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.75, Math.PI * 0.15, Math.PI * 1.75, false);
      ctx.stroke();
      // Arrowhead at the end of the arc, pointing clockwise.
      var ax = cx + r * 0.75 * Math.cos(Math.PI * 1.75), ay = cy + r * 0.75 * Math.sin(Math.PI * 1.75);
      ctx.beginPath();
      ctx.moveTo(ax + r * 0.42, ay - r * 0.05);
      ctx.lineTo(ax - r * 0.05, ay - r * 0.42);
      ctx.lineTo(ax - r * 0.02, ay + r * 0.28);
      ctx.closePath();
      ctx.fill();
    } else if (kind === "new") {
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.8, cy);
      ctx.lineTo(cx + r * 0.8, cy);
      ctx.moveTo(cx, cy - r * 0.8);
      ctx.lineTo(cx, cy + r * 0.8);
      ctx.stroke();
    }
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
  }

  // --- Result banner and promotion picker -----------------------------
  function drawBanner() {
    if (!view.result || bannerHidden) return;
    var r = view.result;
    var w = Math.min(L.S * 0.8, W - 2 * L.pad), h = L.sq * 2.2;
    var x = L.bx + (L.S - w) / 2, y = L.by + (L.S - h) / 2;
    roundRect(x, y, w, h, 18);
    ctx.fillStyle = PAPER;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = INK;
    ctx.stroke();
    var title = r.reason === "Time" ? "Time out" : r.reason;
    var sub = r.winner === -1 ? "Draw" : (r.winner === WHITE ? "White wins" : "Black wins");
    if (game.vsBot && r.winner !== -1) sub = r.winner === game.botColor ? "The bot wins" : "You win!";
    text(title, x + w / 2, y + h * 0.3, fitText(title, w * 0.9, h * 0.24, true), { align: "center", bold: true });
    text(sub, x + w / 2, y + h * 0.58, h * 0.17, { align: "center" });
    text("tap to see the board", x + w / 2, y + h * 0.82, h * 0.1, { align: "center", color: MUTED });
    hit(x, y, w, h, function () { bannerHidden = true; });
  }

  function drawPromotion() {
    if (!promo) return;
    hit(0, 0, W, H, function () { promo = null; });
    var s = state(), t = squareXY(promo.to), sz = L.sq;
    var down = t.y < L.by + L.S / 2;
    var types = [E.Q, E.N, E.R, E.B];
    var y0 = down ? t.y : t.y - 3 * sz;
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillRect(L.bx, L.by, L.S, L.S);
    roundRect(t.x - 4, y0 - 4, sz + 8, sz * 4 + 8, 12);
    ctx.fillStyle = PAPER;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.stroke();
    var order = down ? types : types.slice().reverse();
    order.forEach(function (tp, i) {
      var yy = y0 + i * sz;
      drawPiece(E.pc(s.turn, tp), t.x, yy, sz);
      var m = promo.moves.filter(function (mm) { return mm.promo === tp; })[0];
      hit(t.x, yy, sz, sz, function () { commitMove(m); });
    });
  }

  // ------------------------------------------------------------------
  // Input
  // ------------------------------------------------------------------
  function canAct() {
    return !view.result && !view.thinking && humanTurn();
  }

  function pickDrop(type) {
    if (sel && sel.drop === type) { sel = null; return; }
    sel = { sq: -1, drop: type, targets: view.legal.filter(function (m) { return m.drop === type; }) };
  }

  function boardTap(x, y) {
    var sq = squareAt(x, y), s = state();
    if (sq < 0) return;
    if (!canAct()) {
      if (view.result) bannerHidden = !bannerHidden;
      return;
    }
    var moves = sel ? sel.targets.filter(function (m) { return m.to === sq; }) : [];
    if (moves.length) {
      tryMoves(moves);
      return;
    }
    var p = s.board[sq];
    if (p && E.colorOf(p) === s.turn && !(sel && sel.sq === sq)) {
      sel = { sq: sq, drop: 0, targets: view.legal.filter(function (m) { return !m.drop && m.from === sq; }) };
      drag.sq = sq;
    } else {
      sel = null;
    }
  }

  function tryMoves(moves) {
    if (moves.length > 1) promo = { to: moves[0].to, moves: moves };
    else commitMove(moves[0]);
  }

  function onDown(x, y) {
    drag.sq = -1;
    if (flashing) return;
    for (var i = hits.length - 1; i >= 0; i--) {
      var h = hits[i];
      if (x >= h.x && y >= h.y && x < h.x + h.w && y < h.y + h.h) {
        h.fn(x, y);
        draw();
        return;
      }
    }
  }

  // Lifting the pen on another square after touching a piece moves it, so
  // drag-and-drop works without drawing the drag (cheap on e-ink).
  function onUp(x, y) {
    if (drag.sq < 0 || !sel || sel.sq !== drag.sq || settingsOpen || editor || promo) return;
    var sq = squareAt(x, y);
    drag.sq = -1;
    if (sq < 0 || sq === sel.sq) return;
    var moves = sel.targets.filter(function (m) { return m.to === sq; });
    if (moves.length) {
      tryMoves(moves);
      draw();
    }
  }

  canvas.addEventListener("pointerdown", function (e) {
    if (e.preventDefault) e.preventDefault();
    onDown(e.offsetX, e.offsetY);
  });
  canvas.addEventListener("pointerup", function (e) { onUp(e.offsetX, e.offsetY); });

  // ------------------------------------------------------------------
  // Settings panel
  // ------------------------------------------------------------------
  var TIMER_CHOICES = [[0, "Off"], [1, "1"], [3, "3"], [5, "5"], [10, "10"], [15, "15"], [30, "30"]];
  var INC_CHOICES = [[0, "+0"], [2, "+2"], [5, "+5"], [10, "+10"]];

  function settingRows() {
    var rows = [
      { section: "New game" },
      { label: "Variant", key: "variant", opts: [["standard", "Standard"], ["atomic", "Atomic"], ["crazyhouse", "Crazy-house"], ["horde", "Horde"]] },
      { label: "Opponent", key: "opponent", opts: [["bot", "Bot"], ["human", "Two players"]] },
      { label: "Bot level", key: "level", opts: [[1, "Easy"], [2, "Medium"], [3, "Hard"]], off: settings.opponent !== "bot" },
      { label: "Play as", key: "playAs", opts: [["white", "White"], ["black", "Black"]], off: settings.opponent !== "bot" },
      { label: "Timer (min)", key: "minutes", opts: TIMER_CHOICES },
      { label: "Increment", key: "increment", opts: INC_CHOICES, off: !settings.minutes },
      { section: "Display" },
      { label: "Live clock", key: "liveClock", opts: [[false, "Off"], [true, "Ticking"]], off: !game.minutes },
      { label: "Pieces", key: "pieceSet", opts: [["2d", "2D flat"], ["3d", "3D"]] },
      { label: "Show moves", key: "showMoves", opts: [[true, "On"], [false, "Off"]] },
      { label: "Coordinates", key: "coords", opts: [[true, "On"], [false, "Off"]] },
      { label: "Board size", key: "scale", opts: [[100, "Fit"], [90, "90%"], [80, "80%"], [70, "70%"]] },
      { label: "Position", key: "align", opts: [["center", "Centered"], ["top", "Top"]] }
    ];
    return rows;
  }

  var NEXT_GAME_KEYS = { variant: 1, opponent: 1, level: 1, playAs: 1, minutes: 1, increment: 1 };

  function setSetting(key, value) {
    settings[key] = value;
    saveSettings();
    if (key === "pieceSet") loadPieceSet(value);
    if (key === "liveClock") armClock();
    // Level and side apply to the running game too when it's against the bot.
    if (key === "level" && game.vsBot) { game.level = value; saveGame(); }
  }

  function drawSettings() {
    hit(0, 0, W, H, function () {});
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(0, 0, W, H);
    var rows = settingRows();
    var m = Math.min(W, H);
    var x = L.pad, w = W - 2 * L.pad;
    var units = rows.length + 3.6;
    var rowH = Math.min(m * 0.085, (H - 2 * L.pad) / units);
    var h = rowH * units;
    var y = Math.max(L.pad, (H - h) / 2);
    roundRect(x, y, w, h, 20);
    ctx.fillStyle = PAPER;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = INK;
    ctx.stroke();

    var inner = x + rowH * 0.4, innerW = w - rowH * 0.8;
    text("Settings", inner, y + rowH * 0.6, rowH * 0.5, { bold: true });
    button(x + w - rowH * 2.6 - rowH * 0.3, y + rowH * 0.15, rowH * 2.6, rowH * 0.8, "Done", function () { settingsOpen = false; }, { bold: true });

    var yy = y + rowH * 1.3;
    var labelW = innerW * 0.3;
    rows.forEach(function (row) {
      if (row.section) {
        text(row.section.toUpperCase(), inner, yy + rowH * 0.55, rowH * 0.3, { bold: true, color: MUTED });
        if (row.section === "New game") text("applies when you start a new game", inner + innerW, yy + rowH * 0.55, rowH * 0.26, { align: "right", color: MUTED });
        ctx.fillStyle = "#cfcfcf";
        ctx.fillRect(inner, yy + rowH * 0.95, innerW, 2);
        yy += rowH;
        return;
      }
      var color = row.off ? "#a8a8a8" : INK;
      text(row.label, inner, yy + rowH / 2, fitText(row.label, labelW * 0.95, rowH * 0.34), { color: color });
      var ox = inner + labelW, ow = (innerW - labelW) / row.opts.length;
      row.opts.forEach(function (opt, i) {
        var active = settings[row.key] === opt[0];
        button(ox + i * ow + 3, yy + rowH * 0.1, ow - 6, rowH * 0.8, opt[1],
          row.off ? null : function () { setSetting(row.key, opt[0]); },
          { active: active, disabled: row.off && !active, px: rowH * 0.32 });
      });
      yy += rowH;
    });

    yy += rowH * 0.3;
    var actions = [
      ["Start new game", function () { settingsOpen = false; newGame(); }],
      ["Set up position", function () { settingsOpen = false; openEditor(); }]
    ];
    if (onTablet) actions.push(["Exit", function () { saveGame(); htmlload.close(); }]);
    var aw = innerW / actions.length;
    actions.forEach(function (a, i) {
      button(inner + i * aw + 4, yy, aw - 8, rowH * 0.95, a[0], a[1], { bold: i === 0, px: rowH * 0.34 });
    });
  }

  // ------------------------------------------------------------------
  // Board editor ("Set up position")
  // ------------------------------------------------------------------
  function openEditor() {
    var s = state();
    editor = { board: new Int8Array(s.board), turn: s.turn, tool: E.pc(WHITE, E.P) };
    notice = "Tap a piece below, then tap squares. Tap a piece again to remove it.";
    sel = promo = null;
  }

  function editorTap(x, y) {
    var sq = squareAt(x, y);
    if (sq < 0) return;
    var b = editor.board, tool = editor.tool;
    if (!tool || b[sq] === tool) {
      b[sq] = 0;
      return;
    }
    if (E.typeOf(tool) === E.P && (sq < 8 || (sq >= 56 && !(settings.variant === "horde" && E.colorOf(tool) === WHITE)))) {
      notice = "Pawns can't stand on the first or last rank.";
      return;
    }
    if (E.typeOf(tool) === E.K) {
      // Only one king per side: moving it is friendlier than an error.
      for (var i = 0; i < 64; i++) if (b[i] === tool) b[i] = 0;
    }
    b[sq] = tool;
    notice = "";
  }

  function editorState() {
    var s = E.emptyState(settings.variant);
    s.board = new Int8Array(editor.board);
    s.turn = editor.turn;
    s.castling = 15;
    if (s.variant === "crazyhouse") s.promoted = new Uint8Array(64);
    E.findKings(s);
    E.fixCastling(s);
    return s;
  }

  function finishEditor() {
    var s = editorState();
    var kings = [0, 0];
    for (var i = 0; i < 64; i++) if (E.typeOf(s.board[i]) === E.K) kings[E.colorOf(s.board[i])]++;
    var horde = settings.variant === "horde";
    if (kings[BLACK] !== 1 || (horde ? kings[WHITE] > 1 : kings[WHITE] !== 1)) {
      notice = horde ? "Black needs one king (White's horde has none)." : "Each side needs exactly one king.";
      return;
    }
    if (horde && E.countPieces(s, WHITE) === 0) {
      notice = "White needs at least one piece.";
      return;
    }
    if (E.inCheck(s, 1 - s.turn)) {
      notice = (s.turn === WHITE ? "Black" : "White") + " is in check, so it must be their move.";
      return;
    }
    editor = null;
    notice = "";
    newGame(E.toFEN(s));
  }

  function drawEditor() {
    var s = editorState();
    text("Set up position · " + VARIANT_NAMES[settings.variant], L.barX, L.topBarY + L.barH / 2, L.barH * 0.3, { bold: true });
    var tw = L.barH * 2.6;
    button(L.barX + L.barW - tw, L.topBarY + L.barH * 0.15, tw, L.barH * 0.7, (editor.turn === WHITE ? "White" : "Black") + " to move",
      function () { editor.turn = 1 - editor.turn; }, { px: L.barH * 0.24 });
    var savedSel = sel;
    sel = null;
    drawBoard(s, true);
    sel = savedSel;

    // Palette: one row per color, last cell is the eraser.
    var c = L.cell, px0 = Math.round((W - 7 * c) / 2), py0 = L.botBarY;
    for (var color = 0; color < 2; color++) {
      for (var i = 0; i < 7; i++) {
        var x = px0 + i * c, y = py0 + color * c;
        var tool = i < 6 ? E.pc(color, [E.K, E.Q, E.R, E.B, E.N, E.P][i]) : 0;
        if (i === 6 && color === 1) {
          button(x + 4, y + 4, c - 8, c - 8, "Clear", function () { editor.board = new Int8Array(64); }, { px: c * 0.22 });
          continue;
        }
        var active = editor.tool === tool;
        ctx.fillStyle = active ? "#9a9a9a" : ((i + color) % 2 ? "#e6e6e6" : PAPER);
        ctx.fillRect(x, y, c, c);
        if (active) {
          ctx.lineWidth = 4;
          ctx.strokeStyle = INK;
          ctx.strokeRect(x + 2, y + 2, c - 4, c - 4);
        }
        if (tool) drawPiece(tool, x + c * 0.06, y + c * 0.06, c * 0.88);
        else text("Erase", x + c / 2, y + c / 2, c * 0.22, { align: "center", bold: active });
        hit(x, y, c, c, (function (t) { return function () { editor.tool = t; }; })(tool));
      }
    }
    var str = notice || "";
    text(str, W / 2, L.statusY + L.statusH / 2, fitText(str, W - 2 * L.pad, L.statusH * 0.5), { align: "center" });

    // Editor toolbar
    var h = L.toolH, y0 = L.toolY;
    ctx.fillStyle = INK;
    ctx.fillRect(0, y0, W, 2);
    var acts = [
      ["Cancel", function () { editor = null; notice = ""; }],
      ["Start position", function () { editor.board = E.fromFEN(E.START_FEN[settings.variant], settings.variant).board; editor.turn = WHITE; }],
      ["Done", finishEditor]
    ];
    var bw = (W - 2 * L.pad) / acts.length;
    acts.forEach(function (a, i) {
      button(L.pad + i * bw + 6, y0 + h * 0.18, bw - 12, h * 0.64, a[0], a[1], { bold: i === 2, px: h * 0.24 });
    });
  }

  // ------------------------------------------------------------------
  // Startup
  // ------------------------------------------------------------------
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
    draw();
  }

  if (onTablet) htmlload.setCloseButtonVisible(false);
  loadPieceSet(settings.pieceSet);
  var saved = load("chess.game", null);
  try {
    if (saved && saved.startFen) restore(saved);
  } catch (e) {
    game = null;
  }
  window.addEventListener("resize", resize);
  W = window.innerWidth;
  H = window.innerHeight;
  if (game) onPositionChanged();
  else newGame();
  resize();

  // Exposed for testing in a desktop browser console.
  window.chessDebug = {
    get game() { return game; },
    get view() { return view; },
    get layout() { return L; },
    newGame: newGame, settings: settings, draw: draw,
    tap: function (x, y) { onDown(x, y); onUp(x, y); },
    tapSquare: function (name) {
      var p = squareXY(E.parseSq(name));
      this.tap(p.x + L.sq / 2, p.y + L.sq / 2);
    }
  };
})();
