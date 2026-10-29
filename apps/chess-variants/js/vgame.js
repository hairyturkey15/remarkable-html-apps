// Chess Variants (black and white): the chess app's UI with the
// chess.com-style variant set from vengine.js.
//
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

  var INK = "#000000", PAPER = "#ffffff", MUTED = "#000000";
  var FONT = "sans-serif";

  var DEFAULTS = {
    variant: "standard", opponent: "bot", level: 2, playAs: "white",
    minutes: 0, increment: 0, liveClock: false,
    pieceSet: "bw", showMoves: true, coords: true, scale: 100, align: "center", flip: false,
    checksToWin: 3, pos960: -1
  };
  var VARIANTS = [
    ["standard", "Standard", "Normal chess."],
    ["chess960", "Chess960", "Back-rank pieces shuffled (one of 960 starts). Castling puts the king on g/c and the rook on f/d: tap the king, then its rook."],
    ["threecheck", "3-Check", "Normal rules, but giving check 3 times (or 5, in settings) also wins."],
    ["kingofthehill", "King of the Hill", "Normal rules, but walking your king onto one of the 4 center squares (framed) also wins."],
    ["crazyhouse", "Crazyhouse", "Captured pieces join your pocket; on your turn you may drop one on any empty square instead of moving. Tap the pocket piece, then a square."],
    ["atomic", "Atomic", "Every capture explodes: the capturer and all non-pawn pieces next to the square are destroyed. Blow up the enemy king to win. Kings can't capture."],
    ["horde", "Horde", "White has 36 pawns and no king; Black has a normal army. Black wins by capturing every White piece, White by checkmate."],
    ["fogofwar", "Fog of War", "You only see squares your pieces can move to. There is no check: capture the king to win. Two players get a hand-over screen between moves; the bot sees everything."],
    ["giveaway", "Giveaway", "Captures are compulsory and the king is an ordinary piece. Lose all your pieces, or get stalemated, to win. No castling; pawns may promote to a king."],
    ["torpedo", "Torpedo", "Pawns may move one or two squares forward from any rank."],
    ["sideways", "Sideways Pawns", "Pawns may also step one square sideways (without capturing)."],
    ["nocastling", "No Castling", "Normal chess with castling turned off."],
    ["captureanything", "Capture Anything", "You may also capture your own pieces (not the king)."],
    ["chaturanga", "Chaturanga", "Ancient rules: the counselor (in the queen's place) steps one square diagonally, the elephant (bishop's place) jumps exactly two diagonally, pawns step one square and promote to a counselor. No castling. Stalemate is a draw here."],
    ["duck", "Duck Chess", "After every move you must place the duck on an empty square. Nothing can pass or capture the duck. No check: capture the king to win; being stalemated wins."],
    ["blindfold", "Blindfold", "Normal chess with the pieces hidden. Hold Peek to look."]
  ];
  var VARIANT_NAMES = {};
  VARIANTS.forEach(function (v) { VARIANT_NAMES[v[0]] = v[1]; });

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

  var settings = Object.assign({}, DEFAULTS, load("chessv.settings", {}));
  if (!VARIANT_NAMES[settings.variant]) settings.variant = "standard";
  settings.pieceSet = "bw";
  function saveSettings() { store("chessv.settings", settings); }

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
  var peek = false, passScreen = false, variantPicker = false, last960 = 518;

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
    var opts = { checksToWin: settings.checksToWin };
    var s;
    if (!fen && variant === "chess960") {
      var n = settings.pos960 === -1 ? Math.floor(Math.random() * 960) : (settings.pos960 === -2 ? last960 : settings.pos960);
      last960 = n;
      fen = E.position960(n);
      notice = "Chess960 start #" + n;
    }
    try {
      s = E.fromFEN(fen || E.START_FEN[variant], variant, opts);
    } catch (e) {
      s = E.fromFEN(E.START_FEN[variant], variant, opts);
    }
    peek = passScreen = false;
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
      checksToWin: settings.checksToWin,
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
      vsBot: game.vsBot, botColor: game.botColor, level: game.level, flag: game.flag,
      checksToWin: game.checksToWin, last960: last960
    };
  }

  function restore(data) {
    var s = E.fromFEN(data.startFen, data.variant, { checksToWin: data.checksToWin || 3 });
    if (data.last960 !== undefined) last960 = data.last960;
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
      vsBot: data.vsBot, botColor: data.botColor, level: data.level, flag: data.flag,
      checksToWin: data.checksToWin || 3
    };
  }

  function saveGame() { store("chessv.game", serialize()); }

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
      if (!child.state.duckPending) clocks[s.turn] += game.increment * 1000;
    }
    game.history.length = game.ply + 1;
    game.history.push(makeEntry(s, child, clocks, view.children));
    game.ply++;
    game.flag = null;
    sel = promo = null;
    bannerHidden = false;
    notice = "";
    // Fog of War between two people: hide the board until the next player is ready.
    if (game.variant === "fogofwar" && !game.vsBot && !child.state.duckPending) passScreen = true;
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
    while (game.ply > 0 && ((game.vsBot && state().turn === game.botColor) || state().duckPending)) game.ply--;
    sel = promo = null;
    bannerHidden = false;
    onPositionChanged();
  }

  function redo() {
    if (view.thinking || atEnd()) return;
    game.ply++;
    while (!atEnd() && ((game.vsBot && state().turn === game.botColor) || state().duckPending)) game.ply++;
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
    // The runtime flashes natively without redrawing the board: fastest.
    if (onTablet && htmlload.refresh) {
      htmlload.refresh(80);
      return;
    }
    flashing = true;
    fillScreen(INK);
    timers.flash = setTimeout(function () {
      fillScreen(PAPER);
      timers.flash = setTimeout(function () {
        flashing = false;
        draw();
      }, 100);
    }, 100);
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
    ctx.strokeStyle = INK;
    ctx.stroke();
    var px = fitText(label, w * 0.86, opts.px || h * 0.4, opts.bold);
    text(label, x + w / 2, y + h / 2, px, { align: "center", bold: opts.bold, color: opts.active ? PAPER : INK });
    if (opts.disabled) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = INK;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.1, y + h * 0.5);
      ctx.lineTo(x + w * 0.9, y + h * 0.5);
      ctx.stroke();
    }
    if (fn && !opts.disabled) hit(x, y, w, h, fn);
  }

  function drawPiece(p, x, y, size) {
    if (p === E.DUCK) {
      drawDuck(x, y, size);
      return;
    }
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

  // Duck Chess's duck: white body, black outline and beak.
  function drawDuck(x, y, s) {
    ctx.lineWidth = Math.max(1.5, s * 0.045);
    ctx.strokeStyle = INK;
    ctx.fillStyle = PAPER;
    ctx.beginPath();
    ctx.moveTo(x + s * 0.18, y + s * 0.62);
    ctx.quadraticCurveTo(x + s * 0.2, y + s * 0.86, x + s * 0.5, y + s * 0.86);
    ctx.lineTo(x + s * 0.74, y + s * 0.86);
    ctx.quadraticCurveTo(x + s * 0.9, y + s * 0.82, x + s * 0.86, y + s * 0.6);
    ctx.lineTo(x + s * 0.7, y + s * 0.64);
    ctx.quadraticCurveTo(x + s * 0.5, y + s * 0.52, x + s * 0.18, y + s * 0.62);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + s * 0.68, y + s * 0.38, s * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + s * 0.8, y + s * 0.36);
    ctx.lineTo(x + s * 0.96, y + s * 0.42);
    ctx.lineTo(x + s * 0.8, y + s * 0.46);
    ctx.closePath();
    ctx.fillStyle = INK;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + s * 0.7, y + s * 0.34, s * 0.03, 0, Math.PI * 2);
    ctx.fill();
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
      if (passScreen && !view.result) drawPassScreen();
    }
    if (settingsOpen) drawSettings();
  }

  function drawPassScreen() {
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, L.topBarY, W, L.toolY - L.topBarY);
    var who = state().turn === WHITE ? "White" : "Black";
    text("Pass the tablet to " + who, W / 2, H * 0.42, Math.min(W, H) * 0.06, { align: "center", bold: true });
    text("tap anywhere when ready", W / 2, H * 0.5, Math.min(W, H) * 0.035, { align: "center" });
    hit(0, 0, W, L.toolY, function () { passScreen = false; });
  }

  function exitApp() {
    saveGame();
    if (onTablet) htmlload.close();
  }

  function drawSoon() {
    if (!timers.draw) timers.draw = setTimeout(draw, 30);
  }

  // Pure black and white: dark squares are hatched, never gray.
  function hatch(x, y, size, gap, lw, cross) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, size, size);
    ctx.clip();
    ctx.beginPath();
    for (var d = -size; d < size; d += gap) {
      ctx.moveTo(x + d, y + size);
      ctx.lineTo(x + d + size, y);
      if (cross) {
        ctx.moveTo(x + d, y);
        ctx.lineTo(x + d + size, y + size);
      }
    }
    ctx.lineWidth = lw;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.restore();
  }

  function corners(x, y, sz, lw) {
    var c = sz * 0.28, h = lw / 2;
    ctx.beginPath();
    ctx.moveTo(x + h, y + c); ctx.lineTo(x + h, y + h); ctx.lineTo(x + c, y + h);
    ctx.moveTo(x + sz - c, y + h); ctx.lineTo(x + sz - h, y + h); ctx.lineTo(x + sz - h, y + c);
    ctx.moveTo(x + sz - h, y + sz - c); ctx.lineTo(x + sz - h, y + sz - h); ctx.lineTo(x + sz - c, y + sz - h);
    ctx.moveTo(x + c, y + sz - h); ctx.lineTo(x + h, y + sz - h); ctx.lineTo(x + h, y + sz - c);
    ctx.lineWidth = lw;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }

  function ring(cx, cy, r, lw) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.lineWidth = lw * 1.8;
    ctx.strokeStyle = PAPER;
    ctx.stroke();
    ctx.lineWidth = lw;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }

  // Text that stays legible on hatched squares.
  function outlinedText(str, x, y, px) {
    font(px, true);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = Math.max(2, px * 0.3);
    ctx.strokeStyle = PAPER;
    ctx.strokeText(str, x, y);
    ctx.fillStyle = INK;
    ctx.fillText(str, x, y);
  }

  // Which squares the viewer may see: everything, except in Fog of War
  // (while the game runs) and Blindfold (pieces hidden unless peeking).
  function fogView(s) {
    if (game.variant !== "fogofwar" || view.result) return null;
    var viewer = game.vsBot ? 1 - game.botColor : s.turn;
    return E.visibleSquares(s, viewer);
  }

  function drawBoard(s, editing) {
    var b = s.board, sz = L.sq, entry = cur();
    var fog = editing ? null : fogView(s);
    var hidePieces = !editing && game.variant === "blindfold" && !peek && !view.result;
    hit(L.bx, L.by, L.S, L.S, editing ? editorTap : boardTap);
    var gap = Math.max(4, sz / 7), lw = Math.max(1, sz / 45);
    for (var sq = 0; sq < 64; sq++) {
      var p = squareXY(sq);
      ctx.fillStyle = PAPER;
      ctx.fillRect(p.x, p.y, sz, sz);
      if (fog && !fog[sq]) hatch(p.x, p.y, sz, gap * 0.55, lw * 1.4, true);
      else if (((sq >> 3) + (sq & 7)) % 2) hatch(p.x, p.y, sz, gap, lw, false);
    }
    if (!editing && game.variant === "kingofthehill") {
      var hp = squareXY(bottomColor() === WHITE ? 27 : 28);
      var hq = squareXY(bottomColor() === WHITE ? 36 : 35);
      var hx = Math.min(hp.x, hq.x), hy = Math.min(hp.y, hq.y);
      ctx.lineWidth = Math.max(3, sz * 0.06);
      ctx.strokeStyle = INK;
      ctx.strokeRect(hx + ctx.lineWidth / 2, hy + ctx.lineWidth / 2, sz * 2 - ctx.lineWidth, sz * 2 - ctx.lineWidth);
    }
    // In Duck Chess the last ply is often the duck; mark the piece move before it.
    var lastMove = entry.move && entry.move.duck && game.ply > 0 ? game.history[game.ply - 1].move : entry.move;
    if (!editing && lastMove && !lastMove.duck) {
      [lastMove.from, lastMove.to].forEach(function (sq2) {
        if (sq2 < 0 || (fog && !fog[sq2])) return;
        var lp = squareXY(sq2);
        corners(lp.x, lp.y, sz, Math.max(3, sz * 0.07));
      });
      entry.blast.forEach(function (sq2) { drawBlast(squareXY(sq2), sz); });
    }
    var mated = !editing && view.result && view.result.reason === "Checkmate";
    var checkSq = !editing && view.check ? s.kings[s.turn] : -1;
    if (checkSq >= 0) {
      var c = squareXY(checkSq);
      ctx.fillStyle = PAPER;
      ctx.fillRect(c.x, c.y, sz, sz);
      if (mated) {
        ctx.lineWidth = Math.max(4, sz * 0.1);
        ctx.strokeStyle = INK;
        ctx.strokeRect(c.x + ctx.lineWidth / 2, c.y + ctx.lineWidth / 2, sz - ctx.lineWidth, sz - ctx.lineWidth);
      }
    }
    if (!editing && sel && sel.sq >= 0) {
      var sp = squareXY(sel.sq);
      ctx.fillStyle = PAPER;
      ctx.fillRect(sp.x, sp.y, sz, sz);
      ctx.lineWidth = Math.max(3, sz * 0.08);
      ctx.strokeStyle = INK;
      ctx.strokeRect(sp.x + ctx.lineWidth / 2, sp.y + ctx.lineWidth / 2, sz - ctx.lineWidth, sz - ctx.lineWidth);
    }
    for (sq = 0; sq < 64; sq++) {
      if (!b[sq]) continue;
      if (fog && !fog[sq]) continue;
      if (hidePieces && b[sq] !== E.DUCK) continue;
      var pp = squareXY(sq);
      drawPiece(b[sq], pp.x, pp.y, sz);
    }
    if (checkSq >= 0) {
      var k = squareXY(checkSq);
      ring(k.x + sz / 2, k.y + sz / 2, sz * 0.45, Math.max(3, sz * 0.06));
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
        var capture = (b[m.to] && !(fog && !fog[m.to])) || m.flag === E.FLAG_EP;
        if (capture) {
          ring(t.x + sz / 2, t.y + sz / 2, sz * 0.43, Math.max(3, sz * 0.07));
        } else {
          ctx.beginPath();
          ctx.arc(t.x + sz / 2, t.y + sz / 2, sz * 0.15, 0, Math.PI * 2);
          ctx.fillStyle = INK;
          ctx.fill();
          ctx.lineWidth = Math.max(2, sz * 0.04);
          ctx.strokeStyle = PAPER;
          ctx.stroke();
        }
      });
    }
    if (!editing && s.duckPending && humanTurn() && !view.result) {
      // Show where the duck can go: every empty square but its current one.
      for (sq = 0; sq < 64; sq++) {
        if (b[sq] || sq === s.duck || (fog && !fog[sq])) continue;
        var dq = squareXY(sq);
        ctx.beginPath();
        ctx.arc(dq.x + sz / 2, dq.y + sz / 2, sz * 0.08, 0, Math.PI * 2);
        ctx.fillStyle = INK;
        ctx.fill();
      }
    }
    if (settings.coords) {
      var px = Math.max(9, sz * 0.18);
      for (var i = 0; i < 8; i++) {
        var fileSq = bottomColor() === WHITE ? 56 + i : 7 - i;
        var rankSq = bottomColor() === WHITE ? i * 8 : 63 - i * 8;
        var fp = squareXY(fileSq), rp = squareXY(rankSq);
        outlinedText("abcdefgh"[fileSq & 7], fp.x + sz - px * 0.45, fp.y + sz - px * 0.6, px);
        outlinedText(String(8 - (rankSq >> 3)), rp.x + px * 0.5, rp.y + px * 0.7, px);
      }
    }
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.strokeRect(L.bx - 1.5, L.by - 1.5, L.S + 3, L.S + 3);
  }

  function drawBlast(p, sz) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1.5, sz * 0.03);
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
          ctx.lineWidth = 3;
          ctx.strokeStyle = INK;
          ctx.stroke();
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
    if (s.variant === "threecheck") {
      // Checks given so far: filled boxes out of the target.
      var bs = h * 0.26;
      for (var ci = 0; ci < s.checksToWin && cx + bs < limit; ci++) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = INK;
        ctx.strokeRect(cx, cy - bs / 2, bs, bs);
        if (ci < s.checks[color]) { ctx.fillStyle = INK; ctx.fillRect(cx, cy - bs / 2, bs, bs); }
        cx += bs * 1.3;
      }
      cx += bs * 0.5;
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
    var line = s.duckPending ? who + ": place the duck" : (view.check ? "Check! " : "") + who + " to move";
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
      { label: newArmed ? "Sure?" : "New", icon: "new", fn: armNewGame, armed: newArmed },
      { label: "Exit", icon: "exit", fn: exitApp }
    ];
    if (game.variant === "blindfold") {
      items.splice(2, 0, { label: peek ? "Hide" : "Peek", icon: "peek", fn: function () { peek = !peek; }, armed: peek });
    }
    var x0 = L.pad + gearW + L.pad * 0.5, bw = (W - x0 - L.pad) / items.length;
    items.forEach(function (it, i) {
      var bx = x0 + i * bw, color = INK;
      if (it.armed) {
        roundRect(bx + bw * 0.08, y + h * 0.1, bw * 0.84, h * 0.8, 14);
        ctx.fillStyle = INK;
        ctx.fill();
        color = PAPER;
      }
      drawIcon(it.icon, bx + bw / 2, y + h * 0.38, h * 0.2, color);
      text(it.label, bx + bw / 2, y + h * 0.76, h * 0.2, { align: "center", color: color, bold: it.armed });
      // Unavailable: struck through (no gray in the black-and-white theme).
      if (it.off) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = INK;
        ctx.beginPath();
        ctx.moveTo(bx + bw * 0.3, y + h * 0.15);
        ctx.lineTo(bx + bw * 0.7, y + h * 0.62);
        ctx.stroke();
      }
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
    if (kind === "exit") {
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.6, cy - r * 0.6); ctx.lineTo(cx + r * 0.6, cy + r * 0.6);
      ctx.moveTo(cx + r * 0.6, cy - r * 0.6); ctx.lineTo(cx - r * 0.6, cy + r * 0.6);
      ctx.stroke();
    } else if (kind === "peek") {
      ctx.beginPath();
      ctx.moveTo(cx - r, cy);
      ctx.quadraticCurveTo(cx, cy - r * 1.1, cx + r, cy);
      ctx.quadraticCurveTo(cx, cy + r * 1.1, cx - r, cy);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === "undo" || kind === "redo") {
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
    var types = [E.Q, E.N, E.R, E.B, E.K].filter(function (tp) { return promo.moves.some(function (mm) { return mm.promo === tp; }); });
    var y0 = down ? t.y : t.y - (types.length - 1) * sz;
    roundRect(t.x - 4, y0 - 4, sz + 8, sz * types.length + 8, 12);
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
    if (s.duckPending) {
      var dm = view.legal.filter(function (m) { return m.duck && m.to === sq; })[0];
      if (dm) commitMove(dm);
      else notice = "Place the duck on an empty square (not where it is now).";
      return;
    }
    var moves = sel ? sel.targets.filter(function (m) { return m.to === sq; }) : [];
    if (moves.length) {
      tryMoves(moves);
      return;
    }
    var p = s.board[sq];
    if (p && p !== E.DUCK && E.colorOf(p) === s.turn && !(sel && sel.sq === sq)) {
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
    if (drag.sq < 0 || !sel || sel.sq !== drag.sq || settingsOpen || editor || promo || passScreen) return;
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
      { label: "Variant", picker: true },
      { label: "Opponent", key: "opponent", opts: [["bot", "Bot"], ["human", "Two players"]] },
      { label: "Bot level", key: "level", opts: [[1, "Easy"], [2, "Medium"], [3, "Hard"]], off: settings.opponent !== "bot" },
      { label: "Play as", key: "playAs", opts: [["white", "White"], ["black", "Black"]], off: settings.opponent !== "bot" },
      { label: "Timer (min)", key: "minutes", opts: TIMER_CHOICES },
      settings.variant === "threecheck" ? { label: "Checks to win", key: "checksToWin", opts: [[3, "3"], [5, "5"]] } : null,
      settings.variant === "chess960" ? { label: "960 start", key: "pos960", opts: [[-1, "Random"], [-2, "Same as last (#" + last960 + ")"], [518, "Classic #518"]] } : null,
      { label: "Increment", key: "increment", opts: INC_CHOICES, off: !settings.minutes },
      { section: "Display" },
      { label: "Live clock", key: "liveClock", opts: [[false, "Off"], [true, "Ticking"]], off: !game.minutes },
      { label: "Show moves", key: "showMoves", opts: [[true, "On"], [false, "Off"]] },
      { label: "Coordinates", key: "coords", opts: [[true, "On"], [false, "Off"]] },
      { label: "Board size", key: "scale", opts: [[100, "Fit"], [90, "90%"], [80, "80%"], [70, "70%"]] },
      { label: "Position", key: "align", opts: [["center", "Centered"], ["top", "Top"]] }
    ];
    return rows.filter(function (r) { return r; });
  }

  var NEXT_GAME_KEYS = { variant: 1, opponent: 1, level: 1, playAs: 1, minutes: 1, increment: 1, checksToWin: 1, pos960: 1 };

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
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, W, H);
    if (variantPicker) {
      drawVariantPicker();
      return;
    }
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
        ctx.fillStyle = INK;
        ctx.fillRect(inner, yy + rowH * 0.95, innerW, 1);
        yy += rowH;
        return;
      }
      text(row.label + (row.off ? " (n/a)" : ""), inner, yy + rowH / 2, fitText(row.label + (row.off ? " (n/a)" : ""), labelW * 0.95, rowH * 0.34), {});
      if (row.picker) {
        button(inner + labelW + 3, yy + rowH * 0.1, innerW - labelW - 6, rowH * 0.8, VARIANT_NAMES[settings.variant] + "  ▸",
          function () { variantPicker = true; }, { px: rowH * 0.34, bold: true });
        yy += rowH;
        return;
      }
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
      ["Set up position", function () { settingsOpen = false; openEditor(); }],
      ["Rules", function () { variantPicker = true; }],
      ["Exit", exitApp]
    ];
    var aw = innerW / actions.length;
    actions.forEach(function (a, i) {
      button(inner + i * aw + 4, yy, aw - 8, rowH * 0.95, a[0], a[1], { bold: i === 0, px: rowH * 0.34 });
    });
  }

  // Variant list with each variant's rules.
  function drawVariantPicker() {
    var m = Math.min(W, H), pad = L.pad;
    var rowH = Math.min(m * 0.09, (H - pad * 4) / (VARIANTS.length / 2 + 4.5));
    text("Variants", pad * 1.5, pad + rowH * 0.5, rowH * 0.45, { bold: true });
    button(W - pad * 1.5 - rowH * 2.6, pad + rowH * 0.1, rowH * 2.6, rowH * 0.8, "Back", function () { variantPicker = false; }, { bold: true });
    var colW = (W - pad * 3) / 2;
    VARIANTS.forEach(function (v, i) {
      var cx = pad * 1.5 + (i % 2) * colW, cy = pad + rowH * (1.3 + Math.floor(i / 2));
      button(cx + 3, cy, colW - 6, rowH * 0.86, v[1], function () { setSetting("variant", v[0]); }, { active: settings.variant === v[0], px: rowH * 0.34 });
    });
    var info = VARIANTS.filter(function (v) { return v[0] === settings.variant; })[0];
    var ty = pad + rowH * (1.5 + Math.ceil(VARIANTS.length / 2));
    text(info[1] + " rules", pad * 1.5, ty + rowH * 0.3, rowH * 0.36, { bold: true });
    var px = rowH * 0.32, lines = wrapText(info[2], W - pad * 3, px);
    lines.forEach(function (l, i) { text(l, pad * 1.5, ty + rowH * 0.85 + i * px * 1.35, px); });
    button(pad * 1.5, H - pad - rowH, W - pad * 3, rowH * 0.9, "Start a new " + info[1] + " game",
      function () { variantPicker = false; settingsOpen = false; newGame(); }, { bold: true, px: rowH * 0.36 });
  }

  function wrapText(str, maxW, px) {
    font(px);
    var out = [], line = "";
    str.split(" ").forEach(function (w) {
      var t = line ? line + " " + w : w;
      if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
    });
    out.push(line);
    return out;
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
    if (settings.variant !== "giveaway" && (kings[BLACK] !== 1 || (horde ? kings[WHITE] > 1 : kings[WHITE] !== 1))) {
      notice = horde ? "Black needs one king (White's horde has none)." : "Each side needs exactly one king.";
      return;
    }
    if (horde && E.countPieces(s, WHITE) === 0) {
      notice = "White needs at least one piece.";
      return;
    }
    if (!E.NO_CHECK[settings.variant] && E.inCheck(s, 1 - s.turn)) {
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
        ctx.fillStyle = PAPER;
        ctx.fillRect(x, y, c, c);
        ctx.lineWidth = 1;
        ctx.strokeStyle = INK;
        ctx.strokeRect(x, y, c, c);
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
  var saved = load("chessv.game", null);
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
