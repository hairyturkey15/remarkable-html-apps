// A small, frugal chess bot: iterative-deepening alpha-beta with a capture
// search, material + piece-square evaluation, and a hard node budget so a
// move never costs more than a fraction of a second of CPU. It only ever
// runs when it is the bot's turn - no pondering, no background work.
var ChessBot = (function (E) {
  "use strict";

  var VAL = [0, 100, 320, 330, 500, 900, 0];
  var MATE = 100000;

  var LEVELS = {
    1: { depth: 1, nodes: 2500, noise: 140, name: "Easy" },
    2: { depth: 2, nodes: 12000, noise: 20, name: "Medium" },
    3: { depth: 3, nodes: 45000, noise: 0, name: "Hard" }
  };

  // Piece-square bonuses from white's point of view (row 0 = rank 8).
  function centerDist(sq) {
    return Math.abs(3.5 - (sq >> 3)) + Math.abs(3.5 - (sq & 7));
  }
  var PST = [null, [], [], [], [], [], []];
  (function () {
    for (var sq = 0; sq < 64; sq++) {
      var r = sq >> 3, f = sq & 7, cd = centerDist(sq);
      PST[1][sq] = (6 - r) * 7 + (f >= 2 && f <= 5 && r >= 3 && r <= 5 ? 10 : 0);
      PST[2][sq] = -cd * 9 + 20;
      PST[3][sq] = -cd * 4 + 10;
      PST[4][sq] = r === 1 ? 15 : 0;
      PST[5][sq] = -cd * 2;
      PST[6][sq] = (r === 7 ? 15 : -10) + (f === 1 || f === 6 ? 10 : 0);
    }
  })();

  function evaluate(s) {
    var b = s.board, score = 0;
    var endgame = E.materialOf(s, 0) + E.materialOf(s, 1) <= 26;
    for (var sq = 0; sq < 64; sq++) {
      var p = b[sq];
      if (!p) continue;
      var t = p & 7, c = p >> 3;
      var psq = c === 0 ? sq : sq ^ 56; // mirror rows for black
      var v = VAL[t] + (t === 6 && endgame ? -centerDist(sq) * 8 : PST[t][psq]);
      score += c === 0 ? v : -v;
    }
    if (s.variant === "crazyhouse") {
      for (var t2 = 1; t2 <= 5; t2++) score += (s.pockets[0][t2] - s.pockets[1][t2]) * VAL[t2] * 0.9;
    }
    return s.turn === 0 ? score : -score;
  }

  function moveScore(s, child) {
    var m = child.move;
    if (m.promo) return 8000 + VAL[m.promo];
    if (child.state.removed.length) {
      // Most valuable victim, least valuable attacker. In atomic every
      // removed piece counts, ours negatively.
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

  function terminalScore(s, children, ply) {
    var res = E.variantResult(s);
    if (!res && children !== null && children.length === 0) {
      res = E.inCheck(s, s.turn) ? { winner: 1 - s.turn } : { winner: -1 };
    }
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
    var children = E.legalChildren(s);
    if (children.length === 0) return terminalScore(s, children, ply);
    var caps = [];
    for (var i = 0; i < children.length; i++) {
      if (children[i].state.removed.length || children[i].move.promo) caps.push(children[i]);
    }
    ordered(s, caps);
    for (i = 0; i < caps.length; i++) {
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
    var children = E.legalChildren(s);
    var term = terminalScore(s, children, ply);
    if (term !== null) return term;
    ordered(s, children);
    var best = -Infinity;
    for (var i = 0; i < children.length; i++) {
      var score = -search(children[i].state, depth - 1, -beta, -alpha, ply + 1, ctx);
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta || ctx.nodes > ctx.limit) break;
    }
    return best;
  }

  // historyKeys: position keys of the game so far, to steer away from
  // repeating positions when the bot is not worse.
  function chooseMove(s, level, historyKeys) {
    var cfg = LEVELS[level] || LEVELS[2];
    var root = ordered(s, E.legalChildren(s));
    if (root.length === 0) return null;
    if (root.length === 1) return root[0].move;

    var seen = {};
    (historyKeys || []).forEach(function (k) { seen[k] = (seen[k] || 0) + 1; });

    // Drops make crazyhouse nodes several times more expensive.
    var ctx = { nodes: 0, limit: s.variant === "crazyhouse" ? cfg.nodes / 2 : cfg.nodes };
    var bestMove = root[0].move;
    for (var depth = 1; depth <= cfg.depth; depth++) {
      var scored = [];
      var alpha = -Infinity;
      var completed = true;
      for (var i = 0; i < root.length; i++) {
        var c = root[i];
        var score = -search(c.state, depth - 1, -Infinity, -alpha + (cfg.noise ? cfg.noise : 0), 1, ctx);
        if (seen[E.positionKey(c.state)] && score > -50) score = Math.min(score, 0) - 5;
        if (cfg.noise) score += (Math.random() * 2 - 1) * cfg.noise;
        c.rootScore = score;
        scored.push(c);
        if (score > alpha) alpha = score;
        if (ctx.nodes > ctx.limit) { completed = i === root.length - 1; break; }
      }
      scored.sort(function (a, b) { return b.rootScore - a.rootScore; });
      // A partial iteration still searched the previous best move first,
      // so its top choice is at least as informed as the last full pass.
      if (completed || depth === 1 || scored[0].rootScore > -MATE / 2) bestMove = scored[0].move;
      if (!completed || scored[0].rootScore > MATE / 2) break;
      // Search the best moves first next iteration.
      var rest = root.filter(function (c) { return scored.indexOf(c) < 0; });
      root = scored.concat(rest);
    }
    return bestMove;
  }

  return { chooseMove: chooseMove, evaluate: evaluate, LEVELS: LEVELS };
})(ChessEngine);
