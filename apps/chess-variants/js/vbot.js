// Frugal variant-aware bot: iterative-deepening alpha-beta with a capture
// search and a hard node budget. It only runs on its own turn.
// Fog of War: the bot sees the whole board (it doesn't model hidden info).
var ChessBot = (function (E) {
  "use strict";

  var MATE = 100000;
  var LEVELS = {
    1: { depth: 1, nodes: 2500, noise: 140, name: "Easy" },
    2: { depth: 2, nodes: 12000, noise: 20, name: "Medium" },
    3: { depth: 3, nodes: 40000, noise: 0, name: "Hard" }
  };

  function values(variant) {
    if (variant === "chaturanga") return [0, 100, 320, 160, 500, 180, 0, 0];
    return [0, 100, 320, 330, 500, 900, 0, 0];
  }

  function centerDist(sq) {
    return Math.abs(3.5 - (sq >> 3)) + Math.abs(3.5 - (sq & 7));
  }
  var PST = [null, [], [], [], [], [], [], []];
  (function () {
    for (var sq = 0; sq < 64; sq++) {
      var r = sq >> 3, f = sq & 7, cd = centerDist(sq);
      PST[1][sq] = (6 - r) * 7 + (f >= 2 && f <= 5 && r >= 3 && r <= 5 ? 10 : 0);
      PST[2][sq] = -cd * 9 + 20;
      PST[3][sq] = -cd * 4 + 10;
      PST[4][sq] = r === 1 ? 15 : 0;
      PST[5][sq] = -cd * 2;
      PST[6][sq] = (r === 7 ? 15 : -10) + (f === 1 || f === 6 ? 10 : 0);
      PST[7][sq] = 0;
    }
  })();

  function evaluate(s) {
    var b = s.board, v = s.variant, VAL = values(v), score = 0;
    var endgame = E.materialOf(s, 0) + E.materialOf(s, 1) <= 26;
    for (var sq = 0; sq < 64; sq++) {
      var p = b[sq];
      if (!p || p === E.DUCK) continue;
      var t = p & 7, c = p >> 3;
      var psq = c === 0 ? sq : sq ^ 56;
      var val;
      if (v === "giveaway") val = -100 - PST[t][psq] * 0.2; // fewer pieces is better
      else if (t === 6 && v === "kingofthehill") val = -centerDist(sq) * 40;
      else val = VAL[t] + (t === 6 && endgame ? -centerDist(sq) * 8 : PST[t][psq]);
      score += c === 0 ? val : -val;
    }
    if (v === "crazyhouse") {
      for (var t2 = 1; t2 <= 5; t2++) score += (s.pockets[0][t2] - s.pockets[1][t2]) * VAL[t2] * 0.9;
    }
    if (v === "threecheck") score += (s.checks[0] - s.checks[1]) * 250;
    return s.turn === 0 ? score : -score;
  }

  function moveScore(s, child) {
    var m = child.move, VAL = values(s.variant);
    if (m.promo) return 8000 + VAL[m.promo];
    if (child.state.removed.length) {
      var gain = 0;
      for (var i = 0; i < child.state.removed.length; i++) {
        var p = child.state.removed[i];
        gain += (p >> 3) === s.turn ? -VAL[p & 7] : VAL[p & 7];
        if ((p & 7) === 6) gain += (p >> 3) === s.turn ? -MATE : MATE;
      }
      return 5000 + gain - (m.drop ? 0 : VAL[s.board[m.from] & 7] / 10);
    }
    return m.drop ? -VAL[m.drop] / 10 : 0;
  }

  function ordered(s, children) {
    for (var i = 0; i < children.length; i++) children[i].score = moveScore(s, children[i]);
    children.sort(function (a, b) { return b.score - a.score; });
    return children;
  }

  // Inside the search the duck goes somewhere harmless and quick to pick,
  // so every ply stays one player's move.
  function autoDuck(state) {
    if (!state.duckPending) return state;
    var order = [0, 7, 56, 63, 1, 6, 57, 62, 8, 15, 48, 55];
    for (var i = 0; i < order.length; i++) {
      var sq = order[i];
      if (!state.board[sq] && sq !== state.duck) return E.makeMove(state, { from: -1, to: sq, promo: 0, flag: 0, drop: 0, duck: true });
    }
    for (sq = 0; sq < 64; sq++) {
      if (!state.board[sq] && sq !== state.duck) return E.makeMove(state, { from: -1, to: sq, promo: 0, flag: 0, drop: 0, duck: true });
    }
    return state;
  }

  function children(s) {
    var c = E.legalChildren(s);
    if (s.variant === "duck") for (var i = 0; i < c.length; i++) c[i].state = autoDuck(c[i].state);
    return c;
  }

  function terminalScore(s, kids, ply) {
    var res = kids === null ? E.variantResult(s) : E.outcome(s, kids.length);
    if (!res) return null;
    if (res.winner === -1) return 0;
    return res.winner === s.turn ? MATE - ply : -MATE + ply;
  }

  function quiesce(s, alpha, beta, ply, qdepth, ctx) {
    ctx.nodes++;
    var early = terminalScore(s, null, ply);
    if (early !== null) return early;
    var stand = evaluate(s);
    if (stand >= beta || qdepth <= 0 || ctx.nodes > ctx.limit) return stand;
    if (stand > alpha) alpha = stand;
    var kids = children(s);
    if (kids.length === 0) return terminalScore(s, kids, ply);
    var caps = kids.filter(function (c) { return c.state.removed.length || c.move.promo; });
    ordered(s, caps);
    for (var i = 0; i < caps.length; i++) {
      var score = -quiesce(caps[i].state, -beta, -alpha, ply + 1, qdepth - 1, ctx);
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  function search(s, depth, alpha, beta, ply, ctx) {
    ctx.nodes++;
    var early = terminalScore(s, null, ply);
    if (early !== null) return early;
    if (depth <= 0) return quiesce(s, alpha, beta, ply, 3, ctx);
    var kids = children(s);
    var term = terminalScore(s, kids, ply);
    if (term !== null) return term;
    ordered(s, kids);
    var best = -Infinity;
    for (var i = 0; i < kids.length; i++) {
      var score = -search(kids[i].state, depth - 1, -beta, -alpha, ply + 1, ctx);
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta || ctx.nodes > ctx.limit) break;
    }
    return best;
  }

  // Duck placement: the empty square that leaves the opponent the least
  // valuable capture (and never lets them take our king).
  function chooseDuck(s) {
    var placements = E.legalMoves(s), best = placements[0], bestScore = Infinity;
    var VAL = values(s.variant);
    for (var i = 0; i < placements.length; i++) {
      var ns = E.makeMove(s, placements[i]);
      var threat = 0, moves = E.pseudoMoves(ns);
      for (var j = 0; j < moves.length; j++) {
        var victim = ns.board[moves[j].to];
        if (victim && victim !== E.DUCK && (victim >> 3) === s.turn) {
          threat = Math.max(threat, (victim & 7) === 6 ? MATE : VAL[victim & 7]);
        }
      }
      // Small preference for squares near the enemy king (gets in its way).
      var ek = ns.kings[1 - s.turn];
      var tie = ek >= 0 ? Math.abs((ek >> 3) - (placements[i].to >> 3)) + Math.abs((ek & 7) - (placements[i].to & 7)) : 0;
      var score = threat * 100 + tie;
      if (score < bestScore) { bestScore = score; best = placements[i]; }
    }
    return best;
  }

  function chooseMove(s, level, historyKeys) {
    if (s.duckPending) return chooseDuck(s);
    var cfg = LEVELS[level] || LEVELS[2];
    var root = ordered(s, children(s));
    if (root.length === 0) return null;
    if (root.length === 1) return root[0].move;
    var seen = {};
    (historyKeys || []).forEach(function (k) { seen[k] = (seen[k] || 0) + 1; });
    var scale = s.variant === "crazyhouse" || s.variant === "duck" ? 0.5 : 1;
    var ctx = { nodes: 0, limit: cfg.nodes * scale };
    var bestMove = root[0].move;
    for (var depth = 1; depth <= cfg.depth; depth++) {
      var scored = [], alpha = -Infinity, completed = true;
      for (var i = 0; i < root.length; i++) {
        var c = root[i];
        var score = -search(c.state, depth - 1, -Infinity, -alpha + (cfg.noise || 0), 1, ctx);
        if (seen[E.positionKey(c.state)] && score > -50) score = Math.min(score, 0) - 5;
        if (cfg.noise) score += (Math.random() * 2 - 1) * cfg.noise;
        c.rootScore = score;
        scored.push(c);
        if (score > alpha) alpha = score;
        if (ctx.nodes > ctx.limit) { completed = i === root.length - 1; break; }
      }
      scored.sort(function (a, b) { return b.rootScore - a.rootScore; });
      if (completed || depth === 1 || scored[0].rootScore > -MATE / 2) bestMove = scored[0].move;
      if (!completed || scored[0].rootScore > MATE / 2) break;
      var rest = root.filter(function (c2) { return scored.indexOf(c2) < 0; });
      root = scored.concat(rest);
    }
    return bestMove;
  }

  return { chooseMove: chooseMove, evaluate: evaluate, LEVELS: LEVELS };
})(ChessEngine);
