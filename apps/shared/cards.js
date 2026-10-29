// Playing cards for the card games: deck building, seeded shuffles and
// e-ink friendly drawing. Black suits are solid; red suits are drawn as
// outlines so the two colors stay distinct without color.
var Cards = (function () {
  "use strict";

  var SUITS = ["S", "H", "D", "C"]; // spades, hearts, diamonds, clubs
  var RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

  function isRed(suit) { return suit === "H" || suit === "D"; }

  // card: { rank: 1-13, suit: "S"|"H"|"D"|"C", up: bool }
  function deck(suits, copies) {
    var out = [];
    for (var c = 0; c < (copies || 1); c++) {
      suits.forEach(function (s) {
        for (var r = 1; r <= 13; r++) out.push({ rank: r, suit: s, up: false });
      });
    }
    return out;
  }

  // Small deterministic PRNG (mulberry32) so a deal can be replayed.
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(cards, seed) {
    var r = rng(seed);
    for (var i = cards.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var t = cards[i];
      cards[i] = cards[j];
      cards[j] = t;
    }
    return cards;
  }

  // --- Drawing ---------------------------------------------------------
  function suitPath(ctx, suit, cx, cy, s) {
    ctx.beginPath();
    if (suit === "H") {
      ctx.moveTo(cx, cy + s * 0.45);
      ctx.bezierCurveTo(cx - s * 0.6, cy, cx - s * 0.5, cy - s * 0.5, cx, cy - s * 0.2);
      ctx.bezierCurveTo(cx + s * 0.5, cy - s * 0.5, cx + s * 0.6, cy, cx, cy + s * 0.45);
    } else if (suit === "D") {
      ctx.moveTo(cx, cy - s * 0.5);
      ctx.lineTo(cx + s * 0.36, cy);
      ctx.lineTo(cx, cy + s * 0.5);
      ctx.lineTo(cx - s * 0.36, cy);
    } else if (suit === "S") {
      ctx.moveTo(cx, cy - s * 0.5);
      ctx.bezierCurveTo(cx + s * 0.6, cy - s * 0.05, cx + s * 0.45, cy + s * 0.4, cx + s * 0.05, cy + s * 0.15);
      ctx.lineTo(cx + s * 0.15, cy + s * 0.5);
      ctx.lineTo(cx - s * 0.15, cy + s * 0.5);
      ctx.lineTo(cx - s * 0.05, cy + s * 0.15);
      ctx.bezierCurveTo(cx - s * 0.45, cy + s * 0.4, cx - s * 0.6, cy - s * 0.05, cx, cy - s * 0.5);
    } else {
      var r = s * 0.2;
      ctx.moveTo(cx + r, cy - s * 0.25);
      ctx.arc(cx, cy - s * 0.25, r, 0, Math.PI * 2);
      ctx.moveTo(cx - s * 0.05 + r, cy + s * 0.05);
      ctx.arc(cx - s * 0.22, cy + s * 0.05, r, 0, Math.PI * 2);
      ctx.moveTo(cx + s * 0.22 + r, cy + s * 0.05);
      ctx.arc(cx + s * 0.22, cy + s * 0.05, r, 0, Math.PI * 2);
      ctx.moveTo(cx + s * 0.08, cy);
      ctx.lineTo(cx + s * 0.15, cy + s * 0.5);
      ctx.lineTo(cx - s * 0.15, cy + s * 0.5);
      ctx.lineTo(cx - s * 0.08, cy);
    }
    ctx.closePath();
  }

  function drawSuit(ctx, suit, cx, cy, s) {
    suitPath(ctx, suit, cx, cy, s);
    if (isRed(suit)) {
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = Math.max(1.2, s * 0.09);
      ctx.strokeStyle = "#000000";
      ctx.stroke();
    } else {
      ctx.fillStyle = "#000000";
      ctx.fill();
    }
  }

  function outline(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Draws a face-up card, or its back if !card.up. opts.selected adds a
  // heavy frame; opts.peek limits detail to the top strip (overlapped cards).
  function draw(ctx, card, x, y, w, h, opts) {
    opts = opts || {};
    var r = w * 0.09;
    outline(ctx, x, y, w, h, r);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, w * 0.025);
    ctx.strokeStyle = "#000000";
    ctx.stroke();
    if (!card.up) {
      drawBack(ctx, x, y, w, h);
    } else {
      var px = Math.max(9, w * 0.3);
      ctx.fillStyle = "#000000";
      ctx.font = "bold " + Math.round(px) + "px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      var label = RANKS[card.rank];
      ctx.fillText(label, x + w * 0.08, y + w * 0.06);
      var lw = ctx.measureText(label).width;
      drawSuit(ctx, card.suit, x + w * 0.08 + lw + px * 0.42, y + w * 0.06 + px * 0.48, px * 0.8);
      if (!opts.peek) {
        drawSuit(ctx, card.suit, x + w / 2, y + h * 0.58, w * 0.5);
        if (card.rank > 10) {
          ctx.font = "bold " + Math.round(w * 0.22) + "px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = isRed(card.suit) ? "#000000" : "#ffffff";
          ctx.fillText(label, x + w / 2, y + h * 0.6);
        }
      }
    }
    if (opts.selected) {
      ctx.lineWidth = Math.max(3, w * 0.07);
      ctx.strokeStyle = "#000000";
      outline(ctx, x + ctx.lineWidth / 2, y + ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth, r);
      ctx.stroke();
    }
  }

  function drawBack(ctx, x, y, w, h) {
    var m = w * 0.1;
    ctx.save();
    outline(ctx, x + m, y + m, w - 2 * m, h - 2 * m, w * 0.05);
    ctx.clip();
    ctx.beginPath();
    var gap = Math.max(4, w * 0.11);
    for (var d = -h; d < w + h; d += gap) {
      ctx.moveTo(x + d, y);
      ctx.lineTo(x + d - h, y + h);
      ctx.moveTo(x + d - h, y);
      ctx.lineTo(x + d, y + h);
    }
    ctx.lineWidth = Math.max(1, w * 0.02);
    ctx.strokeStyle = "#000000";
    ctx.stroke();
    ctx.restore();
  }

  // An empty pile slot; optional label (e.g. "K" or a suit letter).
  function drawSlot(ctx, x, y, w, h, label) {
    outline(ctx, x + 2, y + 2, w - 4, h - 4, w * 0.09);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#000000";
    if (ctx.setLineDash) ctx.setLineDash([6, 6]);
    ctx.stroke();
    if (ctx.setLineDash) ctx.setLineDash([]);
    if (label) {
      if (SUITS.indexOf(label) >= 0) {
        drawSuit(ctx, label, x + w / 2, y + h / 2, w * 0.4);
      } else {
        ctx.fillStyle = "#000000";
        ctx.font = Math.round(w * 0.3) + "px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, x + w / 2, y + h / 2);
      }
    }
  }

  return { SUITS: SUITS, RANKS: RANKS, isRed: isRed, deck: deck, shuffle: shuffle, rng: rng, draw: draw, drawBack: drawBack, drawSlot: drawSlot, drawSuit: drawSuit };
})();
