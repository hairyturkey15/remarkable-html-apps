// Spider solitaire. Two decks, ten columns, five deals from the stock.
// Build down regardless of suit; only same-suit runs move together; a full
// King-to-Ace run of one suit is removed. Options: 1 suit (black), 2 suits
// (red and black) or 4 suits, and whether dealing needs every column filled.
(function () {
  "use strict";

  var OPTS = Object.assign({ suits: 1, mustFill: true }, RM.load("spider.options", {}));
  var game = RM.load("spider.game", null);
  var history = [];
  var sel = null; // { col, index }
  var layout = {};

  function suitSet(n) {
    if (n === 1) return ["S", "S", "S", "S"];
    if (n === 2) return ["S", "H", "S", "H"];
    return ["S", "H", "D", "C"];
  }

  function newGame(seed) {
    seed = seed === undefined ? Math.floor(Math.random() * 1e9) : seed;
    var cards = Cards.shuffle(Cards.deck(suitSet(OPTS.suits), 2), seed);
    var cols = [];
    for (var c = 0; c < 10; c++) cols.push([]);
    for (var i = 0; i < 54; i++) cols[i % 10].push(cards.pop());
    cols.forEach(function (col) { col[col.length - 1].up = true; });
    game = { seed: seed, suits: OPTS.suits, cols: cols, stock: cards, done: [], moves: 0, score: 500, won: false };
    history = [];
    sel = null;
    save();
  }

  function save() { RM.store("spider.game", game); }
  function snapshot() {
    history.push(JSON.stringify(game));
    if (history.length > 400) history.shift();
  }
  function undo() {
    if (!history.length) return;
    game = JSON.parse(history.pop());
    game.moves++;
    game.score = Math.max(0, game.score - 1);
    sel = null;
    save();
  }

  // --- Rules ------------------------------------------------------------
  function runStart(col) {
    // Index where the movable same-suit descending run at the bottom starts.
    var i = col.length - 1;
    if (i < 0) return -1;
    while (i > 0 && col[i - 1].up && col[i - 1].suit === col[i].suit && col[i - 1].rank === col[i].rank + 1) i--;
    return i;
  }

  function canPick(c, i) {
    var col = game.cols[c];
    return i >= 0 && i < col.length && col[i].up && i >= runStart(col);
  }

  function canDrop(card, c) {
    var col = game.cols[c];
    return col.length === 0 || col[col.length - 1].rank === card.rank + 1;
  }

  function moveRun(from, i, to) {
    snapshot();
    var run = game.cols[from].splice(i);
    game.cols[to] = game.cols[to].concat(run);
    game.moves++;
    game.score = Math.max(0, game.score - 1);
    afterMove(from);
    afterMove(to);
  }

  function afterMove(c) {
    var col = game.cols[c];
    if (col.length && !col[col.length - 1].up) col[col.length - 1].up = true;
    // A complete King-to-Ace run of one suit leaves the table.
    if (col.length >= 13) {
      var start = col.length - 13, ok = col[start].rank === 13 && col[start].up;
      for (var k = 1; ok && k < 13; k++) {
        var a = col[start + k - 1], b = col[start + k];
        ok = b.up && b.suit === a.suit && b.rank === a.rank - 1;
      }
      if (ok) {
        game.done.push(col[start].suit);
        col.splice(start);
        game.score += 100;
        if (col.length && !col[col.length - 1].up) col[col.length - 1].up = true;
        if (game.done.length === 8) game.won = true;
      }
    }
    save();
  }

  function deal() {
    if (!game.stock.length) return;
    if (OPTS.mustFill && game.cols.some(function (c) { return c.length === 0; })) {
      RM.toast("Fill every empty column before dealing (or turn this off in Options).");
      return;
    }
    snapshot();
    for (var c = 0; c < 10 && game.stock.length; c++) {
      var card = game.stock.pop();
      card.up = true;
      game.cols[c].push(card);
    }
    game.moves++;
    game.score = Math.max(0, game.score - 1);
    sel = null;
    for (c = 0; c < 10; c++) afterMove(c);
  }

  // Best place for a run: a same-suit parent, then any parent, then an
  // empty column (only if the run doesn't already head a column).
  function bestTarget(from, i) {
    var card = game.cols[from][i], fallback = -1, empty = -1;
    for (var c = 0; c < 10; c++) {
      if (c === from) continue;
      var col = game.cols[c];
      if (!col.length) { if (empty < 0 && i > 0) empty = c; continue; }
      var top = col[col.length - 1];
      if (top.rank === card.rank + 1) {
        if (top.suit === card.suit) return c;
        if (fallback < 0) fallback = c;
      }
    }
    return fallback >= 0 ? fallback : empty;
  }

  function hint() {
    var best = null;
    for (var c = 0; c < 10; c++) {
      var i = runStart(game.cols[c]);
      if (i < 0) continue;
      var t = bestTarget(c, i);
      if (t < 0) continue;
      var dest = game.cols[t], card = game.cols[c][i];
      var score = (dest.length && dest[dest.length - 1].suit === card.suit ? 4 : 1) + (i > 0 && !game.cols[c][i - 1].up ? 2 : 0) - (dest.length ? 0 : 3);
      if (!best || score > best.score) best = { c: c, i: i, t: t, score: score };
    }
    if (!best) {
      RM.toast(game.stock.length ? "No moves left on the table: deal from the stock." : "No moves left.");
      return;
    }
    var card2 = game.cols[best.c][best.i];
    sel = { col: best.c, index: best.i };
    RM.toast("Try moving " + Cards.RANKS[card2.rank] + " from column " + (best.c + 1) + " to column " + (best.t + 1) + ".", 2500);
  }

  // --- Input --------------------------------------------------------------
  function tapColumn(c, i) {
    if (game.won) return;
    if (sel) {
      if (sel.col === c && (i === sel.index || i === -2)) {
        // Second tap on the selection: send it to the best place.
        var t = bestTarget(sel.col, sel.index);
        if (t >= 0) moveRun(sel.col, sel.index, t);
        sel = null;
        return;
      }
      if (sel.col !== c && canDrop(game.cols[sel.col][sel.index], c)) {
        moveRun(sel.col, sel.index, c);
        sel = null;
        return;
      }
    }
    sel = canPick(c, i) ? { col: c, index: i } : null;
  }

  function options() {
    RM.choose("Options", [
      { label: "1 suit (black)" + (OPTS.suits === 1 ? "  ✓" : ""), value: "s1" },
      { label: "2 suits (red and black)" + (OPTS.suits === 2 ? "  ✓" : ""), value: "s2" },
      { label: "4 suits" + (OPTS.suits === 4 ? "  ✓" : ""), value: "s4" },
      { label: (OPTS.mustFill ? "✓ " : "  ") + "Fill empty columns before dealing", value: "fill" },
      { label: "Restart this deal", value: "restart" }
    ], function (v) {
      if (!v) return;
      if (v === "fill") {
        OPTS.mustFill = !OPTS.mustFill;
        RM.toast(OPTS.mustFill ? "Dealing needs every column filled." : "You may deal with empty columns.");
      } else if (v === "restart") {
        OPTS.suits = game.suits;
        newGame(game.seed);
      } else {
        OPTS.suits = parseInt(v.substring(1), 10);
        newGame();
        RM.toast("New game with " + OPTS.suits + (OPTS.suits === 1 ? " suit." : " suits."));
      }
      RM.store("spider.options", OPTS);
    });
  }

  // --- Drawing -------------------------------------------------------------
  function draw(ctx, W, H) {
    var m = Math.min(W, H), pad = Math.round(m * 0.015);
    var toolH = RM.toolbar([
      { label: "New", icon: "plus", fn: function () { RM.confirm("Start a new game?", function (ok) { if (ok) newGame(); }); } },
      { label: "Undo", icon: "undo", fn: undo, disabled: !history.length },
      { label: "Hint", fn: hint, bold: true },
      { label: "Options", icon: "gear", fn: options }
    ]);
    var gap = Math.max(3, W * 0.008);
    var cw = (W - 2 * pad - 9 * gap) / 10, ch = cw * 1.42;
    var headH = Math.max(40, m * 0.055);
    RM.text("Spider · " + game.suits + (game.suits === 1 ? " suit" : " suits"), pad, headH / 2, headH * 0.42, { bold: true });
    RM.text("Score " + game.score + "   Moves " + game.moves, W - pad, headH / 2, headH * 0.36, { align: "right" });

    // Completed runs (left) and the stock (right).
    var rowY = headH, fw = cw * 0.55;
    for (var k = 0; k < 8; k++) {
      var fx = pad + k * (fw + gap * 0.6);
      if (game.done[k]) Cards.draw(ctx, { rank: 13, suit: game.done[k], up: true }, fx, rowY, fw, fw * 1.42, { peek: true });
      else Cards.drawSlot(ctx, fx, rowY, fw, fw * 1.42);
    }
    var deals = Math.ceil(game.stock.length / 10);
    for (var d = 0; d < deals; d++) {
      Cards.draw(ctx, { up: false }, W - pad - cw - d * cw * 0.22, rowY, cw, ch);
    }
    if (deals) RM.hit(W - pad - cw - (deals - 1) * cw * 0.22, rowY, cw + (deals - 1) * cw * 0.22, ch, deal);
    else Cards.drawSlot(ctx, W - pad - cw, rowY, cw, ch);
    RM.text(deals + (deals === 1 ? " deal left" : " deals left"), W - pad - cw - (Math.max(deals, 1) - 1) * cw * 0.22 - gap * 2, rowY + ch / 2, headH * 0.3, { align: "right" });

    // Tableau
    var top = rowY + ch + pad * 2, bottom = H - toolH - pad;
    layout = { cw: cw, ch: ch, top: top };
    for (var c = 0; c < 10; c++) {
      var x = pad + c * (cw + gap), col = game.cols[c];
      var downs = 0;
      col.forEach(function (card) { if (!card.up) downs++; });
      var ups = col.length - downs;
      var downOff = ch * 0.12, upOff = ch * 0.3;
      var need = downs * downOff + Math.max(0, ups - 1) * upOff + ch;
      if (need > bottom - top) {
        var room = bottom - top - ch - downs * downOff;
        if (room < 0) { downOff = Math.max(3, (bottom - top - ch) / Math.max(1, col.length)); room = bottom - top - ch - downs * downOff; }
        upOff = Math.max(ch * 0.12, room / Math.max(1, ups - 1));
      }
      if (!col.length) Cards.drawSlot(ctx, x, top, cw, ch);
      var y = top, ys = [];
      for (var i = 0; i < col.length; i++) {
        ys.push(y);
        var selected = sel && sel.col === c && i >= sel.index;
        Cards.draw(ctx, col[i], x, y, cw, ch, { peek: i < col.length - 1, selected: selected });
        y += col[i].up ? upOff : downOff;
      }
      // Tap targets: each card's visible strip; below the column = the column.
      RM.hit(x, top, cw, bottom - top, (function (cc) { return function () { tapColumn(cc, -2); }; })(c));
      for (i = 0; i < col.length; i++) {
        var hh = i < col.length - 1 ? ys[i + 1] - ys[i] : ch;
        RM.hit(x, ys[i], cw, hh, (function (cc, ii) { return function () { tapColumn(cc, ii); }; })(c, i));
      }
    }
    if (game.won) {
      var bw = W * 0.7, bh = m * 0.2;
      RM.box((W - bw) / 2, H * 0.4 - bh / 2, bw, bh, { lineWidth: 4 });
      RM.text("You won!", W / 2, H * 0.4 - bh * 0.15, bh * 0.3, { align: "center", bold: true });
      RM.text("Score " + game.score + " in " + game.moves + " moves", W / 2, H * 0.4 + bh * 0.22, bh * 0.15, { align: "center" });
    }
  }

  if (!game || !game.cols) newGame();
  RM.init({ draw: draw });
})();
