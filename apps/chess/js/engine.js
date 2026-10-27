// Chess rules: standard, atomic, crazyhouse and horde.
//
// Board: Int8Array(64), square = row * 8 + file, row 0 is rank 8 (top).
// Piece = type | color << 3, so white pieces are 1-6 and black are 9-14.
// States are immutable: makeMove() returns a new state, which keeps undo,
// redo and the bot's search simple.
var ChessEngine = (function () {
  "use strict";

  var P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
  var WHITE = 0, BLACK = 1;
  var FLAG_DOUBLE = 1, FLAG_EP = 2, FLAG_CASTLE_K = 3, FLAG_CASTLE_Q = 4;
  var LETTERS = " PNBRQK";
  var VALUES = [0, 1, 3, 3, 5, 9, 0];

  var START_FEN = {
    standard: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    atomic: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    crazyhouse: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR[] w KQkq - 0 1",
    horde: "rnbqkbnr/pppppppp/8/1PP2PP1/PPPPPPPP/PPPPPPPP/PPPPPPPP/PPPPPPPP w kq - 0 1"
  };

  function pc(color, type) { return type | (color << 3); }
  function typeOf(p) { return p & 7; }
  function colorOf(p) { return p >> 3; }
  function sqName(sq) { return "abcdefgh"[sq & 7] + (8 - (sq >> 3)); }
  function parseSq(s) { return (8 - parseInt(s[1], 10)) * 8 + "abcdefgh".indexOf(s[0]); }

  // --- Precomputed attack tables -------------------------------------
  var KNIGHT_TO = [], KING_TO = [], RAYS = [];
  var DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
  (function () {
    var kn = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
    for (var d = 0; d < 8; d++) RAYS.push([]);
    for (var sq = 0; sq < 64; sq++) {
      var r = sq >> 3, f = sq & 7, list, i;
      list = [];
      for (i = 0; i < 8; i++) {
        var nr = r + kn[i][0], nf = f + kn[i][1];
        if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) list.push(nr * 8 + nf);
      }
      KNIGHT_TO.push(list);
      list = [];
      for (i = 0; i < 8; i++) {
        var kr = r + DIRS[i][0], kf = f + DIRS[i][1];
        if (kr >= 0 && kr < 8 && kf >= 0 && kf < 8) list.push(kr * 8 + kf);
      }
      KING_TO.push(list);
      for (d = 0; d < 8; d++) {
        var ray = [], rr = r + DIRS[d][0], ff = f + DIRS[d][1];
        while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) {
          ray.push(rr * 8 + ff);
          rr += DIRS[d][0];
          ff += DIRS[d][1];
        }
        RAYS[d].push(ray);
      }
    }
  })();

  // --- State ----------------------------------------------------------
  function emptyState(variant) {
    return {
      variant: variant || "standard",
      board: new Int8Array(64),
      turn: WHITE,
      castling: 0, // 1 = white O-O, 2 = white O-O-O, 4 = black O-O, 8 = black O-O-O
      ep: -1,
      halfmove: 0,
      fullmove: 1,
      kings: [-1, -1],
      pockets: [[0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]],
      promoted: null, // crazyhouse: promoted pieces drop back as pawns
      removed: null // pieces taken off the board by the move that made this state
    };
  }

  function clone(s) {
    return {
      variant: s.variant,
      board: new Int8Array(s.board),
      turn: s.turn,
      castling: s.castling,
      ep: s.ep,
      halfmove: s.halfmove,
      fullmove: s.fullmove,
      kings: [s.kings[0], s.kings[1]],
      pockets: s.variant === "crazyhouse" ? [s.pockets[0].slice(), s.pockets[1].slice()] : s.pockets,
      promoted: s.promoted ? new Uint8Array(s.promoted) : null,
      removed: null
    };
  }

  function findKings(s) {
    s.kings[0] = s.kings[1] = -1;
    for (var sq = 0; sq < 64; sq++) {
      var p = s.board[sq];
      if (typeOf(p) === K) s.kings[colorOf(p)] = sq;
    }
  }

  function fromFEN(fen, variant) {
    var s = emptyState(variant);
    if (variant === "crazyhouse") s.promoted = new Uint8Array(64);
    var parts = fen.trim().split(/\s+/);
    var placement = parts[0], pocket = "";
    var bracket = placement.indexOf("[");
    if (bracket >= 0) {
      pocket = placement.substring(bracket + 1, placement.indexOf("]"));
      placement = placement.substring(0, bracket);
    }
    var rows = placement.split("/");
    if (rows.length !== 8) throw new Error("bad FEN");
    for (var r = 0; r < 8; r++) {
      var f = 0;
      for (var i = 0; i < rows[r].length; i++) {
        var ch = rows[r][i];
        if (ch === "~") {
          if (s.promoted && f > 0) s.promoted[r * 8 + f - 1] = 1;
        } else if (ch >= "1" && ch <= "8") {
          f += parseInt(ch, 10);
        } else {
          var t = LETTERS.indexOf(ch.toUpperCase());
          if (t <= 0 || f > 7) throw new Error("bad FEN");
          s.board[r * 8 + f] = pc(ch === ch.toUpperCase() ? WHITE : BLACK, t);
          f++;
        }
      }
    }
    for (i = 0; i < pocket.length; i++) {
      var pt = LETTERS.indexOf(pocket[i].toUpperCase());
      if (pt > 0) s.pockets[pocket[i] === pocket[i].toUpperCase() ? WHITE : BLACK][pt]++;
    }
    s.turn = parts[1] === "b" ? BLACK : WHITE;
    var c = parts[2] || "-";
    s.castling = (c.indexOf("K") >= 0 ? 1 : 0) | (c.indexOf("Q") >= 0 ? 2 : 0) | (c.indexOf("k") >= 0 ? 4 : 0) | (c.indexOf("q") >= 0 ? 8 : 0);
    s.ep = parts[3] && parts[3] !== "-" ? parseSq(parts[3]) : -1;
    s.halfmove = parseInt(parts[4] || "0", 10) || 0;
    s.fullmove = parseInt(parts[5] || "1", 10) || 1;
    findKings(s);
    fixCastling(s);
    return s;
  }

  function toFEN(s) {
    var out = "";
    for (var r = 0; r < 8; r++) {
      var empty = 0;
      for (var f = 0; f < 8; f++) {
        var p = s.board[r * 8 + f];
        if (!p) { empty++; continue; }
        if (empty) { out += empty; empty = 0; }
        var l = LETTERS[typeOf(p)];
        out += colorOf(p) === WHITE ? l : l.toLowerCase();
        if (s.promoted && s.promoted[r * 8 + f]) out += "~";
      }
      if (empty) out += empty;
      if (r < 7) out += "/";
    }
    if (s.variant === "crazyhouse") {
      out += "[";
      for (var c = 0; c < 2; c++) {
        for (var t = Q; t >= P; t--) {
          for (var n = 0; n < s.pockets[c][t]; n++) out += c === WHITE ? LETTERS[t] : LETTERS[t].toLowerCase();
        }
      }
      out += "]";
    }
    var cs = (s.castling & 1 ? "K" : "") + (s.castling & 2 ? "Q" : "") + (s.castling & 4 ? "k" : "") + (s.castling & 8 ? "q" : "");
    return out + " " + (s.turn === WHITE ? "w" : "b") + " " + (cs || "-") + " " + (s.ep >= 0 ? sqName(s.ep) : "-") + " " + s.halfmove + " " + s.fullmove;
  }

  // Repetition key: placement, side, castling, e.p. square and pockets.
  function positionKey(s) {
    return toFEN(s).split(" ").slice(0, 4).join(" ");
  }

  // Castling rights only survive while king and rook stay on their
  // original squares; checking the board covers moves, captures,
  // explosions and custom setups in one place.
  function fixCastling(s) {
    var b = s.board;
    if (b[60] !== pc(WHITE, K)) s.castling &= ~3;
    if (b[63] !== pc(WHITE, R)) s.castling &= ~1;
    if (b[56] !== pc(WHITE, R)) s.castling &= ~2;
    if (b[4] !== pc(BLACK, K)) s.castling &= ~12;
    if (b[7] !== pc(BLACK, R)) s.castling &= ~4;
    if (b[0] !== pc(BLACK, R)) s.castling &= ~8;
  }

  // --- Attacks ----------------------------------------------------------
  function attacked(b, sq, by) {
    var r = sq >> 3, f = sq & 7;
    var pr = by === WHITE ? r + 1 : r - 1;
    var pawn = pc(by, P);
    if (pr >= 0 && pr < 8) {
      if (f > 0 && b[pr * 8 + f - 1] === pawn) return true;
      if (f < 7 && b[pr * 8 + f + 1] === pawn) return true;
    }
    var i, list = KNIGHT_TO[sq], knight = pc(by, N);
    for (i = 0; i < list.length; i++) if (b[list[i]] === knight) return true;
    list = KING_TO[sq];
    var king = pc(by, K);
    for (i = 0; i < list.length; i++) if (b[list[i]] === king) return true;
    var rook = pc(by, R), bishop = pc(by, B), queen = pc(by, Q);
    for (var d = 0; d < 8; d++) {
      var ray = RAYS[d][sq];
      for (i = 0; i < ray.length; i++) {
        var p = b[ray[i]];
        if (!p) continue;
        if (p === queen || (d < 4 ? p === rook : p === bishop)) return true;
        break;
      }
    }
    return false;
  }

  function adjacent(a, b) {
    return Math.abs((a >> 3) - (b >> 3)) <= 1 && Math.abs((a & 7) - (b & 7)) <= 1;
  }

  // Would a king of `color` standing on `sq` be in check? In atomic chess
  // a king touching the enemy king can't be checked: capturing it would
  // blow up the capturer's own king too.
  function kingAttacked(s, sq, color) {
    if (s.variant === "atomic") {
      var ek = s.kings[1 - color];
      if (ek >= 0 && adjacent(ek, sq)) return false;
    }
    return attacked(s.board, sq, 1 - color);
  }

  function inCheck(s, color) {
    var k = s.kings[color];
    return k >= 0 && kingAttacked(s, k, color);
  }

  // --- Move generation -------------------------------------------------
  function mv(from, to, promo, flag, drop) {
    return { from: from, to: to, promo: promo || 0, flag: flag || 0, drop: drop || 0 };
  }

  function pseudoMoves(s) {
    var out = [], b = s.board, us = s.turn, them = 1 - us;
    var atomic = s.variant === "atomic";
    for (var sq = 0; sq < 64; sq++) {
      var p = b[sq];
      if (!p || colorOf(p) !== us) continue;
      var t = typeOf(p), r = sq >> 3, f = sq & 7, i, to, q;
      if (t === P) {
        var dir = us === WHITE ? -8 : 8;
        var lastRow = us === WHITE ? 0 : 7;
        var startRow = us === WHITE ? 6 : 1;
        to = sq + dir;
        if (to >= 0 && to < 64 && !b[to]) {
          pushPawn(out, sq, to, lastRow, 0);
          // Horde: white pawns on the first rank may also advance two.
          var canDouble = r === startRow || (s.variant === "horde" && us === WHITE && r === 7);
          var two = to + dir;
          if (canDouble && two >= 0 && two < 64 && !b[two]) out.push(mv(sq, two, 0, r === startRow ? FLAG_DOUBLE : 0));
        }
        for (i = -1; i <= 1; i += 2) {
          if (f + i < 0 || f + i > 7) continue;
          to = sq + dir + i;
          if (to < 0 || to >= 64) continue;
          if (b[to] && colorOf(b[to]) === them) pushPawn(out, sq, to, lastRow, 0);
          else if (to === s.ep && !b[to]) out.push(mv(sq, to, 0, FLAG_EP));
        }
      } else if (t === N || t === K) {
        var list = t === N ? KNIGHT_TO[sq] : KING_TO[sq];
        for (i = 0; i < list.length; i++) {
          to = list[i];
          var occ = b[to];
          if (!occ) out.push(mv(sq, to));
          else if (colorOf(occ) === them && !(atomic && t === K)) out.push(mv(sq, to));
        }
      } else {
        var d0 = t === B ? 4 : 0, d1 = t === R ? 4 : 8;
        for (var d = d0; d < d1; d++) {
          var ray = RAYS[d][sq];
          for (i = 0; i < ray.length; i++) {
            to = ray[i];
            q = b[to];
            if (!q) { out.push(mv(sq, to)); continue; }
            if (colorOf(q) === them) out.push(mv(sq, to));
            break;
          }
        }
      }
    }
    addCastling(s, out);
    if (s.variant === "crazyhouse") addDrops(s, out);
    return out;
  }

  function pushPawn(out, from, to, lastRow, flag) {
    if ((to >> 3) === lastRow) {
      out.push(mv(from, to, Q, flag));
      out.push(mv(from, to, N, flag));
      out.push(mv(from, to, R, flag));
      out.push(mv(from, to, B, flag));
    } else {
      out.push(mv(from, to, 0, flag));
    }
  }

  function addCastling(s, out) {
    var us = s.turn, b = s.board;
    var home = us === WHITE ? 60 : 4;
    var kRight = us === WHITE ? 1 : 4, qRight = us === WHITE ? 2 : 8;
    if (!(s.castling & (kRight | qRight)) || b[home] !== pc(us, K)) return;
    if (kingAttacked(s, home, us)) return;
    if ((s.castling & kRight) && !b[home + 1] && !b[home + 2] &&
        !kingAttacked(s, home + 1, us) && !kingAttacked(s, home + 2, us)) {
      out.push(mv(home, home + 2, 0, FLAG_CASTLE_K));
    }
    if ((s.castling & qRight) && !b[home - 1] && !b[home - 2] && !b[home - 3] &&
        !kingAttacked(s, home - 1, us) && !kingAttacked(s, home - 2, us)) {
      out.push(mv(home, home - 2, 0, FLAG_CASTLE_Q));
    }
  }

  function addDrops(s, out) {
    var pocket = s.pockets[s.turn];
    for (var t = P; t <= Q; t++) {
      if (!pocket[t]) continue;
      for (var sq = 0; sq < 64; sq++) {
        if (s.board[sq]) continue;
        if (t === P && (sq < 8 || sq >= 56)) continue;
        out.push(mv(-1, sq, 0, 0, t));
      }
    }
  }

  // --- Making moves ----------------------------------------------------
  function makeMove(s, m) {
    var ns = clone(s), b = ns.board, us = s.turn, them = 1 - us;
    var removed = [];
    ns.ep = -1;
    if (m.drop) {
      b[m.to] = pc(us, m.drop);
      ns.pockets[us][m.drop]--;
      ns.halfmove++;
    } else {
      var piece = b[m.from], capSq = m.to, captured = b[m.to];
      if (m.flag === FLAG_EP) {
        capSq = m.to + (us === WHITE ? 8 : -8);
        captured = b[capSq];
        b[capSq] = 0;
      }
      var wasPromoted = ns.promoted ? ns.promoted[capSq] : 0;
      b[m.to] = m.promo ? pc(us, m.promo) : piece;
      b[m.from] = 0;
      if (ns.promoted) {
        ns.promoted[m.to] = m.promo ? 1 : ns.promoted[m.from];
        ns.promoted[m.from] = 0;
        if (capSq !== m.to) ns.promoted[capSq] = 0;
      }
      if (typeOf(piece) === K) ns.kings[us] = m.to;
      if (m.flag === FLAG_CASTLE_K) {
        b[m.from + 1] = b[m.from + 3];
        b[m.from + 3] = 0;
      } else if (m.flag === FLAG_CASTLE_Q) {
        b[m.from - 1] = b[m.from - 4];
        b[m.from - 4] = 0;
      } else if (m.flag === FLAG_DOUBLE) {
        ns.ep = (m.from + m.to) >> 1;
      }
      if (captured) {
        removed.push(captured);
        if (s.variant === "crazyhouse") ns.pockets[us][wasPromoted ? P : typeOf(captured)]++;
        if (s.variant === "atomic") explode(ns, m.to, removed);
      }
      ns.halfmove = captured || typeOf(piece) === P ? 0 : ns.halfmove + 1;
    }
    fixCastling(ns);
    ns.turn = them;
    if (us === BLACK) ns.fullmove++;
    ns.removed = removed;
    return ns;
  }

  // Atomic capture: the capturing piece and every non-pawn piece around
  // the target square are destroyed along with the captured piece.
  function explode(ns, center, removed) {
    var b = ns.board;
    removed.push(b[center]);
    b[center] = 0;
    var list = KING_TO[center];
    for (var i = 0; i < list.length; i++) {
      var p = b[list[i]];
      if (p && typeOf(p) !== P) {
        removed.push(p);
        b[list[i]] = 0;
      }
    }
    for (var c = 0; c < 2; c++) {
      if (ns.kings[c] >= 0 && typeOf(b[ns.kings[c]]) !== K) ns.kings[c] = -1;
    }
  }

  function isLegalResult(s, ns) {
    var us = s.turn, them = 1 - us;
    if (s.variant === "atomic") {
      if (s.kings[us] >= 0 && ns.kings[us] < 0) return false;
      if (s.kings[them] >= 0 && ns.kings[them] < 0) return true;
      return !inCheck(ns, us);
    }
    var k = ns.kings[us];
    return k < 0 || !attacked(ns.board, k, them);
  }

  // Legal moves paired with the states they lead to (the bot reuses them).
  function legalChildren(s) {
    var pseudo = pseudoMoves(s), out = [];
    for (var i = 0; i < pseudo.length; i++) {
      var ns = makeMove(s, pseudo[i]);
      if (isLegalResult(s, ns)) out.push({ move: pseudo[i], state: ns });
    }
    return out;
  }

  function legalMoves(s) {
    return legalChildren(s).map(function (c) { return c.move; });
  }

  // --- Game end --------------------------------------------------------
  function countPieces(s, color) {
    var n = 0;
    for (var sq = 0; sq < 64; sq++) if (s.board[sq] && colorOf(s.board[sq]) === color) n++;
    return n;
  }

  function insufficientMaterial(s) {
    if (s.variant !== "standard") return false;
    var minors = [0, 0];
    for (var sq = 0; sq < 64; sq++) {
      var p = s.board[sq], t = typeOf(p);
      if (!p || t === K) continue;
      if (t === N || t === B) minors[colorOf(p)]++;
      else return false;
    }
    return minors[0] + minors[1] <= 1;
  }

  // Result before considering legal moves (cheap; used by the bot too).
  function variantResult(s) {
    if (s.variant === "atomic") {
      if (s.kings[WHITE] < 0) return { winner: BLACK, reason: "King exploded" };
      if (s.kings[BLACK] < 0) return { winner: WHITE, reason: "King exploded" };
    }
    if (s.variant === "horde" && countPieces(s, WHITE) === 0) return { winner: BLACK, reason: "Horde destroyed" };
    return null;
  }

  // { winner: 0 | 1 | -1 (draw), reason } or null while the game goes on.
  function outcome(s, legalCount) {
    var v = variantResult(s);
    if (v) return v;
    if (legalCount === 0) {
      return inCheck(s, s.turn) ? { winner: 1 - s.turn, reason: "Checkmate" } : { winner: -1, reason: "Stalemate" };
    }
    if (s.halfmove >= 100) return { winner: -1, reason: "50-move rule" };
    if (insufficientMaterial(s)) return { winner: -1, reason: "Insufficient material" };
    return null;
  }

  // --- Notation ---------------------------------------------------------
  function uci(m) {
    if (m.drop) return LETTERS[m.drop] + "@" + sqName(m.to);
    return sqName(m.from) + sqName(m.to) + (m.promo ? LETTERS[m.promo].toLowerCase() : "");
  }

  function san(s, m, legal) {
    var text;
    if (m.drop) {
      text = LETTERS[m.drop] + "@" + sqName(m.to);
    } else if (m.flag === FLAG_CASTLE_K) {
      text = "O-O";
    } else if (m.flag === FLAG_CASTLE_Q) {
      text = "O-O-O";
    } else {
      var t = typeOf(s.board[m.from]);
      var capture = !!s.board[m.to] || m.flag === FLAG_EP;
      if (t === P) {
        text = (capture ? "abcdefgh"[m.from & 7] + "x" : "") + sqName(m.to) + (m.promo ? "=" + LETTERS[m.promo] : "");
      } else {
        var sameFile = false, sameRank = false, ambiguous = false;
        legal = legal || legalMoves(s);
        for (var i = 0; i < legal.length; i++) {
          var o = legal[i];
          if (o.drop || o.from === m.from || o.to !== m.to || typeOf(s.board[o.from]) !== t) continue;
          ambiguous = true;
          if ((o.from & 7) === (m.from & 7)) sameFile = true;
          if ((o.from >> 3) === (m.from >> 3)) sameRank = true;
        }
        var dis = "";
        if (ambiguous) {
          if (!sameFile) dis = "abcdefgh"[m.from & 7];
          else if (!sameRank) dis = String(8 - (m.from >> 3));
          else dis = sqName(m.from);
        }
        text = LETTERS[t] + dis + (capture ? "x" : "") + sqName(m.to);
      }
    }
    var ns = makeMove(s, m);
    var end = variantResult(ns);
    if (end) return text + (end.winner === s.turn ? "#" : "");
    if (inCheck(ns, ns.turn)) text += legalChildren(ns).length === 0 ? "#" : "+";
    return text;
  }

  function materialOf(s, color) {
    var sum = 0;
    for (var sq = 0; sq < 64; sq++) {
      var p = s.board[sq];
      if (p && colorOf(p) === color) sum += VALUES[typeOf(p)];
    }
    return sum;
  }

  return {
    P: P, N: N, B: B, R: R, Q: Q, K: K, WHITE: WHITE, BLACK: BLACK,
    FLAG_DOUBLE: FLAG_DOUBLE, FLAG_EP: FLAG_EP, FLAG_CASTLE_K: FLAG_CASTLE_K, FLAG_CASTLE_Q: FLAG_CASTLE_Q,
    LETTERS: LETTERS, VALUES: VALUES, START_FEN: START_FEN, KING_TO: KING_TO,
    pc: pc, typeOf: typeOf, colorOf: colorOf, sqName: sqName, parseSq: parseSq,
    emptyState: emptyState, clone: clone, fromFEN: fromFEN, toFEN: toFEN, positionKey: positionKey,
    findKings: findKings, fixCastling: fixCastling,
    attacked: attacked, inCheck: inCheck, pseudoMoves: pseudoMoves, makeMove: makeMove,
    legalChildren: legalChildren, legalMoves: legalMoves, variantResult: variantResult, outcome: outcome,
    uci: uci, san: san, materialOf: materialOf, countPieces: countPieces
  };
})();
