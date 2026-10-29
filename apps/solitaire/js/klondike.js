// Klondike solitaire: draw 1 or draw 3, unlimited passes through the
// stock, unlimited undo. Tap a card to send it to its foundation when it
// can go there; otherwise tap to select, then tap where it should go.
// Tapping a selected card again moves it to the best tableau spot.
(function () {
  "use strict";

  var OPTS = Object.assign({ draw: 1 }, RM.load("klondike.options", {}));
  var game = RM.load("klondike.game", null);
  var history = [];
  var sel = null; // { from: "waste" | "tab" | "found", col, index }
  var SUIT_ORDER = ["S", "H", "D", "C"];

  function newGame(seed) {
    seed = seed === undefined ? Math.floor(Math.random() * 1e9) : seed;
    var cards = Cards.shuffle(Cards.deck(SUIT_ORDER, 1), seed);
    var tab = [];
    for (var c = 0; c < 7; c++) {
      tab.push([]);
      for (var k = 0; k <= c; k++) tab[c].push(cards.pop());
      tab[c][c].up = true;
    }
    game = { seed: seed, draw: OPTS.draw, stock: cards, waste: [], found: [[], [], [], []], tab: tab, moves: 0, score: 0, won: false };
    history = [];
    sel = null;
    save();
  }

  function save() { RM.store("klondike.game", game); }
  function snapshot() {
    history.push(JSON.stringify(game));
    if (history.length > 400) history.shift();
  }
  function undo() {
    if (!history.length) return;
    game = JSON.parse(history.pop());
    sel = null;
    save();
  }

  // --- Rules --------------------------------------------------------------
  function fIndex(card) { return SUIT_ORDER.indexOf(card.suit); }

  function canFound(card) {
    var f = game.found[fIndex(card)];
    return f.length === card.rank - 1;
  }

  function canStack(card, c) {
    var col = game.tab[c];
    if (!col.length) return card.rank === 13;
    var top = col[col.length - 1];
    return top.up && top.rank === card.rank + 1 && Cards.isRed(top.suit) !== Cards.isRed(card.suit);
  }

  // Cards a selection refers to (top of waste, foundation top, or a run).
  function picked(s) {
    if (s.from === "waste") return [game.waste[game.waste.length - 1]];
    if (s.from === "found") { var f = game.found[s.col]; return [f[f.length - 1]]; }
    return game.tab[s.col].slice(s.index);
  }

  function take(s) {
    if (s.from === "waste") return [game.waste.pop()];
    if (s.from === "found") return [game.found[s.col].pop()];
    var run = game.tab[s.col].splice(s.index);
    var col = game.tab[s.col];
    if (col.length && !col[col.length - 1].up) {
      col[col.length - 1].up = true;
      game.score += 5;
    }
    return run;
  }

  function toFoundation(s) {
    var cards = picked(s);
    if (cards.length !== 1 || !cards[0] || !canFound(cards[0])) return false;
    snapshot();
    var card = take(s)[0];
    game.found[fIndex(card)].push(card);
    game.score += 10;
    game.moves++;
    finish();
    return true;
  }

  function toTableau(s, c) {
    var cards = picked(s);
    if (!cards.length || !cards[0] || (s.from === "tab" && s.col === c) || !canStack(cards[0], c)) return false;
    snapshot();
    var run = take(s);
    game.tab[c] = game.tab[c].concat(run);
    if (s.from === "waste") game.score += 5;
    if (s.from === "found") game.score = Math.max(0, game.score - 15);
    game.moves++;
    finish();
    return true;
  }

  function bestTableau(s) {
    var cards = picked(s);
    if (!cards.length || !cards[0]) return -1;
    var empty = -1;
    for (var c = 0; c < 7; c++) {
      if (s.from === "tab" && s.col === c) continue;
      if (!canStack(cards[0], c)) continue;
      if (game.tab[c].length) return c;
      // Moving a king from the bottom of a column to another empty one is pointless.
      if (empty < 0 && !(s.from === "tab" && s.index === 0)) empty = c;
    }
    return empty;
  }

  function drawStock() {
    snapshot();
    if (!game.stock.length) {
      game.stock = game.waste.reverse().map(function (c) { c.up = false; return c; });
      game.waste = [];
      if (game.draw === 1) game.score = Math.max(0, game.score - 100);
    } else {
      for (var i = 0; i < game.draw && game.stock.length; i++) {
        var card = game.stock.pop();
        card.up = true;
        game.waste.push(card);
      }
    }
    game.moves++;
    sel = null;
    save();
  }

  function finish() {
    sel = null;
    game.won = game.found.every(function (f) { return f.length === 13; });
    save();
  }

  function canAutoComplete() {
    return !game.won && !game.stock.length && !game.waste.length && game.tab.every(function (col) { return col.every(function (c) { return c.up; }); });
  }

  function autoComplete() {
    var guard = 60;
    while (!game.won && guard-- > 0) {
      var moved = false;
      for (var c = 0; c < 7 && !moved; c++) {
        var col = game.tab[c];
        if (col.length && canFound(col[col.length - 1])) moved = toFoundation({ from: "tab", col: c, index: col.length - 1 });
      }
      if (!moved) break;
    }
  }

  function hint() {
    // Foundation moves first, then moves that uncover a face-down card.
    var cands = [];
    if (game.waste.length) cands.push({ from: "waste" });
    for (var c = 0; c < 7; c++) {
      var col = game.tab[c];
      for (var i = 0; i < col.length; i++) if (col[i].up) { cands.push({ from: "tab", col: c, index: i }); break; }
      if (col.length) cands.push({ from: "tab", col: c, index: col.length - 1 });
    }
    for (var k = 0; k < cands.length; k++) {
      var p = picked(cands[k]);
      if (p.length === 1 && canFound(p[0])) { sel = cands[k]; RM.toast("This card can go to its foundation: tap it."); return; }
    }
    for (k = 0; k < cands.length; k++) {
      var t = bestTableau(cands[k]);
      if (t < 0) continue;
      // Worth suggesting only if it plays the waste or uncovers something.
      var reveals = cands[k].from === "waste" || cands[k].index > 0 || game.tab[t].length > 0;
      if (reveals) { sel = cands[k]; RM.toast("Move the selected card(s) to column " + (t + 1) + "."); return; }
    }
    RM.toast(game.stock.length || game.waste.length ? "Turn over the stock." : "No moves found.");
  }

  // --- Input ----------------------------------------------------------------
  function tapCard(s) {
    if (game.won) return;
    if (sel && sameSel(sel, s)) {
      var t = bestTableau(sel);
      if (t >= 0) toTableau(sel, t);
      sel = null;
      return;
    }
    if (sel && s.from === "tab" && toTableau(sel, s.col)) return;
    if (sel && s.from === "foundSlot" && toFoundation(sel)) return;
    if (s.from === "foundSlot") { sel = null; return; }
    // A fresh tap on a top card goes straight to its foundation if it can.
    var cards = picked(s);
    if (!cards.length || !cards[0] || !cards[0].up) { sel = null; return; }
    if (cards.length === 1 && s.from !== "found" && toFoundation(s)) return;
    sel = s;
  }

  function sameSel(a, b) {
    return a.from === b.from && a.col === b.col && a.index === b.index;
  }

  function options() {
    RM.choose("Options", [
      { label: "Draw 1" + (OPTS.draw === 1 ? "  ✓" : ""), value: 1 },
      { label: "Draw 3" + (OPTS.draw === 3 ? "  ✓" : ""), value: 3 },
      { label: "Restart this deal", value: "restart" }
    ], function (v) {
      if (!v) return;
      if (v === "restart") { OPTS.draw = game.draw; newGame(game.seed); }
      else { OPTS.draw = v; newGame(); RM.toast("New game: draw " + v + "."); }
      RM.store("klondike.options", OPTS);
    });
  }

  // --- Drawing ----------------------------------------------------------------
  function draw(ctx, W, H) {
    var m = Math.min(W, H), pad = Math.round(m * 0.02);
    var items = [
      { label: "New", icon: "plus", fn: function () { RM.confirm("Start a new game?", function (ok) { if (ok) newGame(); }); } },
      { label: "Undo", icon: "undo", fn: undo, disabled: !history.length },
      { label: "Hint", fn: hint, bold: true },
      { label: "Options", icon: "gear", fn: options }
    ];
    if (canAutoComplete()) items.splice(3, 0, { label: "Finish", fn: autoComplete, bold: true, active: true });
    var toolH = RM.toolbar(items);
    var headH = Math.max(40, m * 0.055);
    RM.text("Klondike · draw " + game.draw, pad, headH / 2, headH * 0.42, { bold: true });
    RM.text("Score " + game.score + "   Moves " + game.moves, W - pad, headH / 2, headH * 0.36, { align: "right" });

    var gap = Math.max(4, W * 0.015);
    var cw = Math.min((W - 2 * pad - 6 * gap) / 7, (H - toolH - headH) / 5.2), ch = cw * 1.42;
    var x0 = (W - (7 * cw + 6 * gap)) / 2;
    var colX = function (c) { return x0 + c * (cw + gap); };
    var rowY = headH;

    // Stock
    if (game.stock.length) Cards.draw(ctx, { up: false }, colX(0), rowY, cw, ch);
    else Cards.drawSlot(ctx, colX(0), rowY, cw, ch, "↺");
    RM.hit(colX(0), rowY, cw, ch, drawStock);

    // Waste: the last few cards fanned (draw 3), top one tappable.
    var shown = game.waste.slice(game.draw === 3 ? -3 : -1);
    shown.forEach(function (card, i) {
      var top = i === shown.length - 1;
      Cards.draw(ctx, card, colX(1) + i * cw * 0.28, rowY, cw, ch, { peek: !top, selected: top && sel && sel.from === "waste" });
    });
    if (shown.length) RM.hit(colX(1) + (shown.length - 1) * cw * 0.28, rowY, cw, ch, function () { tapCard({ from: "waste" }); });

    // Foundations
    for (var f = 0; f < 4; f++) {
      var fx = colX(3 + f), pile = game.found[f];
      if (pile.length) Cards.draw(ctx, pile[pile.length - 1], fx, rowY, cw, ch, { selected: sel && sel.from === "found" && sel.col === f });
      else Cards.drawSlot(ctx, fx, rowY, cw, ch, SUIT_ORDER[f]);
      RM.hit(fx, rowY, cw, ch, (function (ff) {
        return function () {
          if (sel && sel.from !== "found") tapCard({ from: "foundSlot" });
          else if (game.found[ff].length) tapCard({ from: "found", col: ff });
        };
      })(f));
    }

    // Tableau
    var top = rowY + ch + pad * 1.5, bottom = H - toolH - pad;
    for (var c = 0; c < 7; c++) {
      var x = colX(c), col = game.tab[c];
      var downs = col.filter(function (k) { return !k.up; }).length, ups = col.length - downs;
      var downOff = ch * 0.14, upOff = ch * 0.3;
      var need = downs * downOff + Math.max(0, ups - 1) * upOff + ch;
      if (need > bottom - top) upOff = Math.max(ch * 0.12, (bottom - top - ch - downs * downOff) / Math.max(1, ups - 1));
      if (!col.length) Cards.drawSlot(ctx, x, top, cw, ch, "K");
      RM.hit(x, top, cw, bottom - top, (function (cc) { return function () { tapCard({ from: "tab", col: cc, index: game.tab[cc].length }); }; })(c));
      var y = top;
      for (var i = 0; i < col.length; i++) {
        var isSel = sel && sel.from === "tab" && sel.col === c && i >= sel.index;
        Cards.draw(ctx, col[i], x, y, cw, ch, { peek: i < col.length - 1, selected: isSel });
        var next = y + (col[i].up ? upOff : downOff);
        var hh = i < col.length - 1 ? next - y : ch;
        if (col[i].up) RM.hit(x, y, cw, hh, (function (cc, ii) { return function () { tapCard({ from: "tab", col: cc, index: ii }); }; })(c, i));
        y = next;
      }
    }
    if (game.won) {
      var bw = W * 0.7, bh = m * 0.2;
      RM.box((W - bw) / 2, H * 0.45 - bh / 2, bw, bh, { lineWidth: 4 });
      RM.text("You won!", W / 2, H * 0.45 - bh * 0.15, bh * 0.3, { align: "center", bold: true });
      RM.text("Score " + game.score + " in " + game.moves + " moves", W / 2, H * 0.45 + bh * 0.22, bh * 0.15, { align: "center" });
    }
  }

  if (!game || !game.tab) newGame();
  RM.init({ draw: draw });
})();
