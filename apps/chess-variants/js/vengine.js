// Chess rules for the chess.com-style variant set.
//
// Board: Int8Array(64), square = row * 8 + file, row 0 is rank 8 (top).
// Piece = type | color << 3 (white 1-6, black 9-14). The duck in Duck
// Chess is piece 7: it blocks squares and can't be captured.
// States are immutable: makeMove() returns a new state.
//
// Variants: standard, chess960, threecheck, kingofthehill, crazyhouse,
// atomic, horde, fogofwar, giveaway, torpedo, sideways, nocastling,
// captureanything, chaturanga, duck, blindfold.
var ChessEngine = (function () {
  "use strict";

  var P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6, DUCK = 7;
  var WHITE = 0, BLACK = 1;
  var FLAG_DOUBLE = 1, FLAG_EP = 2, FLAG_CASTLE_K = 3, FLAG_CASTLE_Q = 4;
  var LETTERS = " PNBRQK*";
  var VALUES = [0, 1, 3, 3, 5, 9, 0, 0];
  var HILL = [27, 28, 35, 36]; // d5 e5 d4 e4

  var STANDARD_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  var START_FEN = {
    standard: STANDARD_FEN, threecheck: STANDARD_FEN, kingofthehill: STANDARD_FEN,
    crazyhouse: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR[] w KQkq - 0 1",
    atomic: STANDARD_FEN, fogofwar: STANDARD_FEN, torpedo: STANDARD_FEN, sideways: STANDARD_FEN,
    captureanything: STANDARD_FEN, duck: STANDARD_FEN, blindfold: STANDARD_FEN,
    giveaway: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1",
    nocastling: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1",
    chaturanga: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1",
    horde: "rnbqkbnr/pppppppp/8/1PP2PP1/PPPPPPPP/PPPPPPPP/PPPPPPPP/PPPPPPPP w kq - 0 1"
  };

  // Rules that differ between variants.
  var NO_CHECK = { fogofwar: 1, duck: 1, giveaway: 1 }; // kings can be captured
  var KING_CAPTURE_WINS = { fogofwar: 1, duck: 1 };
  var NO_CASTLING = { giveaway: 1, nocastling: 1, chaturanga: 1 };
  var CLASSIC_DRAWS = { standard: 1, chess960: 1, nocastling: 1, torpedo: 1, sideways: 1, blindfold: 1 };

  function pc(color, type) { return type | (color << 3); }
  function typeOf(p) { return p & 7; }
  function colorOf(p) { return p >> 3; }
  function sqName(sq) { return "abcdefgh"[sq & 7] + (8 - (sq >> 3)); }
  function parseSq(s) { return (8 - parseInt(s[1], 10)) * 8 + "abcdefgh".indexOf(s[0]); }

  // --- Precomputed tables ----------------------------------------------
  var KNIGHT_TO = [], KING_TO = [], FERZ_TO = [], ALFIL_TO = [], RAYS = [];
  var DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
  (function () {
    var kn = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
    var steps = function (sq, deltas) {
      var r = sq >> 3, f = sq & 7, out = [];
      deltas.forEach(function (d) {
        var nr = r + d[0], nf = f + d[1];
        if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) out.push(nr * 8 + nf);
      });
      return out;
    };
    for (var d = 0; d < 8; d++) RAYS.push([]);
    for (var sq = 0; sq < 64; sq++) {
      KNIGHT_TO.push(steps(sq, kn));
      KING_TO.push(steps(sq, DIRS));
      FERZ_TO.push(steps(sq, DIRS.slice(4)));
      ALFIL_TO.push(steps(sq, [[-2, -2], [-2, 2], [2, -2], [2, 2]]));
      for (d = 0; d < 8; d++) {
        var ray = [], rr = (sq >> 3) + DIRS[d][0], ff = (sq & 7) + DIRS[d][1];
        while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) {
          ray.push(rr * 8 + ff);
          rr += DIRS[d][0];
          ff += DIRS[d][1];
        }
        RAYS[d].push(ray);
      }
    }
  })();

  // --- Chess960 ---------------------------------------------------------
  // Scharnagl numbering: 0..959, 518 is the standard position.
  function position960(n) {
    var rank = new Array(8), free = [0, 1, 2, 3, 4, 5, 6, 7];
    var place = function (idx, piece) { rank[free[idx]] = piece; free.splice(idx, 1); };
    var b1 = n % 4; n = Math.floor(n / 4);
    var b2 = n % 4; n = Math.floor(n / 4);
    rank[b1 * 2 + 1] = "b";
    rank[b2 * 2] = "b";
    free = free.filter(function (f) { return !rank[f]; });
    var q = n % 6; n = Math.floor(n / 6);
    place(q, "q");
    var KN = [[0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4]][n];
    var nf = [free[KN[0]], free[KN[1]]];
    rank[nf[0]] = rank[nf[1]] = "n";
    free = free.filter(function (f) { return !rank[f]; });
    rank[free[0]] = "r";
    rank[free[1]] = "k";
    rank[free[2]] = "r";
    var back = rank.join("");
    var files = "ABCDEFGH";
    var rooks = [rank.indexOf("r"), rank.lastIndexOf("r")];
    var castle = files[rooks[1]] + files[rooks[0]] + files[rooks[1]].toLowerCase() + files[rooks[0]].toLowerCase();
    return back + "/pppppppp/8/8/8/8/PPPPPPPP/" + back.toUpperCase() + " w " + castle + " - 0 1";
  }

  // --- State ------------------------------------------------------------
  function emptyState(variant) {
    return {
      variant: variant || "standard",
      board: new Int8Array(64),
      turn: WHITE,
      castling: 0, // 1 = white king side, 2 = white queen side, 4/8 = black
      // Per color: [king file, king-side rook file, queen-side rook file].
      // Chess960 and custom setups can differ between the two colors.
      castleFiles: [[4, 7, 0], [4, 7, 0]],
      ep: -1,
      halfmove: 0,
      fullmove: 1,
      kings: [-1, -1],
      pockets: [[0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]],
      promoted: null,
      checks: [0, 0], // 3-check: checks given by each side
      checksToWin: 3,
      duck: -1,
      duckPending: false, // Duck Chess: mover still has to place the duck
      removed: null
    };
  }

  function clone(s) {
    return {
      variant: s.variant,
      board: new Int8Array(s.board),
      turn: s.turn,
      castling: s.castling,
      castleFiles: s.castleFiles,
      ep: s.ep,
      halfmove: s.halfmove,
      fullmove: s.fullmove,
      kings: [s.kings[0], s.kings[1]],
      pockets: s.variant === "crazyhouse" ? [s.pockets[0].slice(), s.pockets[1].slice()] : s.pockets,
      promoted: s.promoted ? new Uint8Array(s.promoted) : null,
      checks: [s.checks[0], s.checks[1]],
      checksToWin: s.checksToWin,
      duck: s.duck,
      duckPending: s.duckPending,
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

  function fromFEN(fen, variant, opts) {
    var s = emptyState(variant);
    opts = opts || {};
    if (opts.checksToWin) s.checksToWin = opts.checksToWin;
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
        } else if (ch === "*") {
          s.board[r * 8 + f] = DUCK;
          s.duck = r * 8 + f;
          f++;
        } else {
          var t = LETTERS.indexOf(ch.toUpperCase());
          if (t <= 0 || t > 6 || f > 7) throw new Error("bad FEN");
          s.board[r * 8 + f] = pc(ch === ch.toUpperCase() ? WHITE : BLACK, t);
          f++;
        }
      }
    }
    for (i = 0; i < pocket.length; i++) {
      var pt = LETTERS.indexOf(pocket[i].toUpperCase());
      if (pt > 0 && pt < 6) s.pockets[pocket[i] === pocket[i].toUpperCase() ? WHITE : BLACK][pt]++;
    }
    s.turn = parts[1] === "b" ? BLACK : WHITE;
    findKings(s);
    // Castling: KQkq, or file letters (Shredder-FEN, used for Chess960).
    var c = parts[2] || "-";
    var files = [[4, 7, 0], [4, 7, 0]];
    for (var col = 0; col < 2; col++) {
      var ks = s.kings[col], home = col === WHITE ? 7 : 0;
      if (ks >= 0 && (ks >> 3) === home) files[col][0] = ks & 7;
    }
    for (i = 0; i < c.length; i++) {
      var ch2 = c[i], white = ch2 === ch2.toUpperCase(), color = white ? WHITE : BLACK;
      var up = ch2.toUpperCase(), row = white ? 7 : 0, kf = files[color][0], file = -1;
      var rook = pc(color, R);
      if (up === "K") {
        for (var ff = 7; ff > kf; ff--) if (s.board[row * 8 + ff] === rook) { file = ff; break; }
      } else if (up === "Q") {
        for (ff = 0; ff < kf; ff++) if (s.board[row * 8 + ff] === rook) { file = ff; break; }
      } else if (up >= "A" && up <= "H") {
        file = up.charCodeAt(0) - 65;
      }
      if (file < 0) continue;
      if (file > kf) { files[color][1] = file; s.castling |= white ? 1 : 4; }
      else { files[color][2] = file; s.castling |= white ? 2 : 8; }
    }
    s.castleFiles = files;
    if (NO_CASTLING[variant]) s.castling = 0;
    s.ep = parts[3] && parts[3] !== "-" ? parseSq(parts[3]) : -1;
    s.halfmove = parseInt(parts[4] || "0", 10) || 0;
    s.fullmove = parseInt(parts[5] || "1", 10) || 1;
    if (parts[6] && /^\+?\d\+\d$/.test(parts[6])) {
      var cc = parts[6].replace("+", "").split("+");
      s.checks = [parseInt(cc[0], 10), parseInt(cc[1], 10)];
    }
    fixCastling(s);
    return s;
  }

  function standardLayout(s, color) {
    var f = s.castleFiles[color];
    return f[0] === 4 && f[1] === 7 && f[2] === 0;
  }

  function toFEN(s) {
    var out = "";
    for (var r = 0; r < 8; r++) {
      var empty = 0;
      for (var f = 0; f < 8; f++) {
        var p = s.board[r * 8 + f];
        if (!p) { empty++; continue; }
        if (empty) { out += empty; empty = 0; }
        if (p === DUCK) { out += "*"; continue; }
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
    var cs;
    if (s.variant === "chess960" || !standardLayout(s, WHITE) || !standardLayout(s, BLACK)) {
      var F = "ABCDEFGH", w = s.castleFiles[WHITE], bl = s.castleFiles[BLACK];
      cs = (s.castling & 1 ? F[w[1]] : "") + (s.castling & 2 ? F[w[2]] : "") +
        (s.castling & 4 ? F[bl[1]].toLowerCase() : "") + (s.castling & 8 ? F[bl[2]].toLowerCase() : "");
    } else {
      cs = (s.castling & 1 ? "K" : "") + (s.castling & 2 ? "Q" : "") + (s.castling & 4 ? "k" : "") + (s.castling & 8 ? "q" : "");
    }
    var fen = out + " " + (s.turn === WHITE ? "w" : "b") + " " + (cs || "-") + " " + (s.ep >= 0 ? sqName(s.ep) : "-") + " " + s.halfmove + " " + s.fullmove;
    if (s.variant === "threecheck") fen += " +" + s.checks[0] + "+" + s.checks[1];
    return fen;
  }

  function positionKey(s) {
    return toFEN(s).split(" ").slice(0, 4).join(" ") + (s.duckPending ? " d" : "") + (s.variant === "threecheck" ? " " + s.checks.join("/") : "");
  }

  // Rights survive only while king and rook stay on their start squares.
  function fixCastling(s) {
    var b = s.board, w = s.castleFiles[WHITE], bl = s.castleFiles[BLACK];
    if (b[56 + w[0]] !== pc(WHITE, K)) s.castling &= ~3;
    if (b[56 + w[1]] !== pc(WHITE, R)) s.castling &= ~1;
    if (b[56 + w[2]] !== pc(WHITE, R)) s.castling &= ~2;
    if (b[bl[0]] !== pc(BLACK, K)) s.castling &= ~12;
    if (b[bl[1]] !== pc(BLACK, R)) s.castling &= ~4;
    if (b[bl[2]] !== pc(BLACK, R)) s.castling &= ~8;
  }

  // --- Attacks -------------------------------------------------------------
  function attacked(b, sq, by, variant) {
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
    if (variant === "chaturanga") {
      // Ferz (in the queen's slot) steps one diagonal; elephant jumps two.
      list = FERZ_TO[sq];
      for (i = 0; i < list.length; i++) if (b[list[i]] === queen) return true;
      list = ALFIL_TO[sq];
      for (i = 0; i < list.length; i++) if (b[list[i]] === bishop) return true;
      for (var d0 = 0; d0 < 4; d0++) {
        var ray0 = RAYS[d0][sq];
        for (i = 0; i < ray0.length; i++) {
          var p0 = b[ray0[i]];
          if (!p0) continue;
          if (p0 === rook) return true;
          break;
        }
      }
      return false;
    }
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

  function kingAttacked(s, sq, color) {
    if (s.variant === "atomic") {
      var ek = s.kings[1 - color];
      if (ek >= 0 && adjacent(ek, sq)) return false;
    }
    return attacked(s.board, sq, 1 - color, s.variant);
  }

  function inCheck(s, color) {
    if (NO_CHECK[s.variant]) return false;
    var k = s.kings[color];
    return k >= 0 && kingAttacked(s, k, color);
  }

  // --- Move generation -----------------------------------------------------
  function mv(from, to, promo, flag, drop) {
    return { from: from, to: to, promo: promo || 0, flag: flag || 0, drop: drop || 0, duck: false };
  }

  function promoTypes(variant) {
    if (variant === "chaturanga") return [Q];
    if (variant === "giveaway") return [Q, N, R, B, K];
    return [Q, N, R, B];
  }

  function pseudoMoves(s) {
    var out = [], b = s.board, us = s.turn, them = 1 - us, v = s.variant;
    if (s.duckPending) {
      // The duck must move to a different empty square.
      for (var dsq = 0; dsq < 64; dsq++) {
        if (!b[dsq] && dsq !== s.duck) {
          var dm = mv(-1, dsq);
          dm.duck = true;
          out.push(dm);
        }
      }
      return out;
    }
    var atomic = v === "atomic", ownCaptures = v === "captureanything";
    var promos = promoTypes(v);
    // Can a piece of ours land on `occ`? (empty, enemy, or own in Capture Anything)
    var target = function (occ) {
      if (!occ) return 1;
      if (occ === DUCK) return 0;
      if (colorOf(occ) === them) return 2;
      return ownCaptures && typeOf(occ) !== K ? 2 : 0;
    };
    for (var sq = 0; sq < 64; sq++) {
      var p = b[sq];
      if (!p || p === DUCK || colorOf(p) !== us) continue;
      var t = typeOf(p), r = sq >> 3, f = sq & 7, i, to, list;
      if (t === P) {
        var dir = us === WHITE ? -8 : 8;
        var lastRow = us === WHITE ? 0 : 7;
        var startRow = us === WHITE ? 6 : 1;
        to = sq + dir;
        if (to >= 0 && to < 64 && !b[to]) {
          pushPawn(out, sq, to, lastRow, 0, promos);
          var canDouble = v !== "chaturanga" && (r === startRow || v === "torpedo" || (v === "horde" && us === WHITE && r === 7));
          var two = to + dir;
          if (canDouble && two >= 0 && two < 64 && (two >> 3) !== lastRow && !b[two]) {
            out.push(mv(sq, two, 0, r === startRow || v === "torpedo" ? FLAG_DOUBLE : 0));
          }
        }
        if (v === "sideways") {
          if (f > 0 && !b[sq - 1]) out.push(mv(sq, sq - 1));
          if (f < 7 && !b[sq + 1]) out.push(mv(sq, sq + 1));
        }
        for (i = -1; i <= 1; i += 2) {
          if (f + i < 0 || f + i > 7) continue;
          to = sq + dir + i;
          if (to < 0 || to >= 64) continue;
          if (b[to] && target(b[to]) === 2) pushPawn(out, sq, to, lastRow, 0, promos);
          else if (to === s.ep && !b[to]) out.push(mv(sq, to, 0, FLAG_EP));
        }
      } else if (t === N || t === K || (v === "chaturanga" && (t === Q || t === B))) {
        list = t === N ? KNIGHT_TO[sq] : t === K ? KING_TO[sq] : t === Q ? FERZ_TO[sq] : ALFIL_TO[sq];
        for (i = 0; i < list.length; i++) {
          to = list[i];
          var tg = target(b[to]);
          if (tg === 1 || (tg === 2 && !(atomic && t === K))) out.push(mv(sq, to));
        }
      } else {
        var d0 = t === B ? 4 : 0, d1 = t === R ? 4 : 8;
        for (var d = d0; d < d1; d++) {
          var ray = RAYS[d][sq];
          for (i = 0; i < ray.length; i++) {
            to = ray[i];
            var tg2 = target(b[to]);
            if (tg2 === 1) { out.push(mv(sq, to)); continue; }
            if (tg2 === 2) out.push(mv(sq, to));
            break;
          }
        }
      }
    }
    addCastling(s, out);
    if (v === "crazyhouse") addDrops(s, out);
    return out;
  }

  function pushPawn(out, from, to, lastRow, flag, promos) {
    if ((to >> 3) === lastRow) {
      for (var i = 0; i < promos.length; i++) out.push(mv(from, to, promos[i], flag));
    } else {
      out.push(mv(from, to, 0, flag));
    }
  }

  // Chess960-aware castling: king ends on g/c, rook on f/d. Every square
  // either piece crosses must be empty (apart from the two of them), and
  // the king may not start in, cross or land on an attacked square (except
  // in variants without check). The move's `to` is the king's destination
  // in the standard layout and the rook's square otherwise (tap the rook).
  function addCastling(s, out) {
    var us = s.turn, b = s.board, row = us === WHITE ? 56 : 0;
    var cf = s.castleFiles[us];
    var kSq = row + cf[0];
    if (b[kSq] !== pc(us, K)) return;
    var checks = !NO_CHECK[s.variant];
    if (checks && kingAttacked(s, kSq, us)) return;
    var sides = [[us === WHITE ? 1 : 4, cf[1], 6, 5, FLAG_CASTLE_K], [us === WHITE ? 2 : 8, cf[2], 2, 3, FLAG_CASTLE_Q]];
    for (var i = 0; i < 2; i++) {
      var sd = sides[i];
      if (!(s.castling & sd[0])) continue;
      var rSq = row + sd[1], kDest = row + sd[2], rDest = row + sd[3];
      if (b[rSq] !== pc(us, R)) continue;
      var lo = Math.min(kSq, rSq, kDest, rDest), hi = Math.max(kSq, rSq, kDest, rDest), ok = true;
      for (var x = lo; x <= hi && ok; x++) {
        if (x !== kSq && x !== rSq && b[x]) ok = false;
      }
      if (!ok) continue;
      var step = kDest >= kSq ? 1 : -1;
      for (x = kSq; checks && ok; x += step) {
        if (x !== kSq && kingAttackedWithout(s, x, us, kSq, rSq)) ok = false;
        if (x === kDest) break;
      }
      if (!ok) continue;
      var standard = standardLayout(s, us);
      out.push(mv(kSq, standard ? kDest : rSq, 0, sd[4]));
    }
  }

  // Attack test with the castling king and rook lifted off the board.
  function kingAttackedWithout(s, sq, color, kSq, rSq) {
    var b = s.board, kp = b[kSq], rp = b[rSq];
    b[kSq] = 0;
    b[rSq] = 0;
    var res = kingAttacked(s, sq, color);
    b[kSq] = kp;
    b[rSq] = rp;
    return res;
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

  // --- Making moves ----------------------------------------------------------
  function makeMove(s, m) {
    var ns = clone(s), b = ns.board, us = s.turn, them = 1 - us;
    var removed = [];
    if (m.duck) {
      if (ns.duck >= 0) b[ns.duck] = 0;
      b[m.to] = DUCK;
      ns.duck = m.to;
      ns.duckPending = false;
      ns.turn = them;
      if (us === BLACK) ns.fullmove++;
      ns.removed = removed;
      return ns;
    }
    ns.ep = -1;
    if (m.drop) {
      b[m.to] = pc(us, m.drop);
      ns.pockets[us][m.drop]--;
      ns.halfmove++;
    } else if (m.flag === FLAG_CASTLE_K || m.flag === FLAG_CASTLE_Q) {
      var row = us === WHITE ? 56 : 0;
      var rSq = row + s.castleFiles[us][m.flag === FLAG_CASTLE_K ? 1 : 2];
      b[m.from] = 0;
      b[rSq] = 0;
      b[row + (m.flag === FLAG_CASTLE_K ? 6 : 2)] = pc(us, K);
      b[row + (m.flag === FLAG_CASTLE_K ? 5 : 3)] = pc(us, R);
      ns.kings[us] = row + (m.flag === FLAG_CASTLE_K ? 6 : 2);
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
      if (m.promo === K) ns.kings[us] = m.to; // giveaway: promoting to a king
      if (m.flag === FLAG_DOUBLE) ns.ep = (m.from + m.to) >> 1;
      if (captured) {
        removed.push(captured);
        if (typeOf(captured) === K && colorOf(captured) === them) ns.kings[them] = -1;
        if (s.variant === "crazyhouse") ns.pockets[us][wasPromoted ? P : typeOf(captured)]++;
        if (s.variant === "atomic") explode(ns, m.to, removed);
      }
      ns.halfmove = captured || typeOf(piece) === P ? 0 : ns.halfmove + 1;
    }
    if (s.variant === "giveaway") findKings(ns);
    fixCastling(ns);
    if (s.variant === "threecheck" && inCheck(ns, them)) ns.checks[us]++;
    if (s.variant === "duck" && ns.kings[them] >= 0) {
      ns.duckPending = true; // same player now places the duck
    } else {
      ns.turn = them;
      if (us === BLACK) ns.fullmove++;
    }
    ns.removed = removed;
    return ns;
  }

  function explode(ns, center, removed) {
    var b = ns.board;
    removed.push(b[center]);
    b[center] = 0;
    var list = KING_TO[center];
    for (var i = 0; i < list.length; i++) {
      var p = b[list[i]];
      if (p && p !== DUCK && typeOf(p) !== P) {
        removed.push(p);
        b[list[i]] = 0;
      }
    }
    for (var c = 0; c < 2; c++) {
      if (ns.kings[c] >= 0 && typeOf(b[ns.kings[c]]) !== K) ns.kings[c] = -1;
    }
  }

  function isLegalResult(s, ns) {
    var us = s.turn, them = 1 - us, v = s.variant;
    if (NO_CHECK[v]) return true;
    if (v === "atomic") {
      if (s.kings[us] >= 0 && ns.kings[us] < 0) return false;
      if (s.kings[them] >= 0 && ns.kings[them] < 0) return true;
      return !inCheck(ns, us);
    }
    var k = ns.kings[us];
    return k < 0 || !attacked(ns.board, k, them, v);
  }

  function legalChildren(s) {
    var pseudo = pseudoMoves(s), out = [];
    for (var i = 0; i < pseudo.length; i++) {
      var ns = makeMove(s, pseudo[i]);
      if (isLegalResult(s, ns)) out.push({ move: pseudo[i], state: ns });
    }
    // Giveaway: capturing is compulsory.
    if (s.variant === "giveaway") {
      var caps = out.filter(function (c) { return c.state.removed.length > 0; });
      if (caps.length) return caps;
    }
    return out;
  }

  function legalMoves(s) {
    return legalChildren(s).map(function (c) { return c.move; });
  }

  // --- Game end ----------------------------------------------------------------
  function countPieces(s, color) {
    var n = 0;
    for (var sq = 0; sq < 64; sq++) {
      var p = s.board[sq];
      if (p && p !== DUCK && colorOf(p) === color) n++;
    }
    return n;
  }

  function insufficientMaterial(s) {
    if (!CLASSIC_DRAWS[s.variant]) return false;
    var minors = 0;
    for (var sq = 0; sq < 64; sq++) {
      var p = s.board[sq], t = typeOf(p);
      if (!p || t === K) continue;
      if (t === N || t === B) minors++;
      else return false;
    }
    return minors <= 1;
  }

  // Results that don't depend on the legal move count (cheap).
  function variantResult(s) {
    var v = s.variant;
    if (v === "atomic") {
      if (s.kings[WHITE] < 0) return { winner: BLACK, reason: "King exploded" };
      if (s.kings[BLACK] < 0) return { winner: WHITE, reason: "King exploded" };
    }
    if (KING_CAPTURE_WINS[v]) {
      if (s.kings[WHITE] < 0) return { winner: BLACK, reason: "King captured" };
      if (s.kings[BLACK] < 0) return { winner: WHITE, reason: "King captured" };
    }
    if (v === "horde" && countPieces(s, WHITE) === 0) return { winner: BLACK, reason: "Horde destroyed" };
    if (v === "threecheck") {
      for (var c = 0; c < 2; c++) if (s.checks[c] >= s.checksToWin) return { winner: c, reason: s.checksToWin + " checks" };
    }
    if (v === "kingofthehill") {
      for (c = 0; c < 2; c++) if (s.kings[c] >= 0 && HILL.indexOf(s.kings[c]) >= 0) return { winner: c, reason: "King of the Hill" };
    }
    if (v === "giveaway") {
      for (c = 0; c < 2; c++) if (countPieces(s, c) === 0) return { winner: c, reason: "All pieces given away" };
    }
    return null;
  }

  function outcome(s, legalCount) {
    var v = variantResult(s);
    if (v) return v;
    if (legalCount === 0) {
      if (s.variant === "giveaway" || s.variant === "duck") return { winner: s.turn, reason: "Stalemated (wins)" };
      return inCheck(s, s.turn) ? { winner: 1 - s.turn, reason: "Checkmate" } : { winner: -1, reason: "Stalemate" };
    }
    if (s.halfmove >= 100) return { winner: -1, reason: "50-move rule" };
    if (insufficientMaterial(s)) return { winner: -1, reason: "Insufficient material" };
    return null;
  }

  // --- Notation ------------------------------------------------------------------
  function uci(m) {
    if (m.duck) return "@" + sqName(m.to);
    if (m.drop) return LETTERS[m.drop] + "@" + sqName(m.to);
    return sqName(m.from) + sqName(m.to) + (m.promo ? LETTERS[m.promo].toLowerCase() : "");
  }

  function san(s, m, legal) {
    var text;
    if (m.duck) return "@" + sqName(m.to);
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
          if (o.drop || o.duck || o.from === m.from || o.to !== m.to || o.flag >= FLAG_CASTLE_K || typeOf(s.board[o.from]) !== t) continue;
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
    var opp = ns.duckPending ? 1 - ns.turn : ns.turn;
    if (inCheck(ns, opp)) text += (!ns.duckPending && legalChildren(ns).length === 0) ? "#" : "+";
    return text;
  }

  function materialOf(s, color) {
    var sum = 0;
    for (var sq = 0; sq < 64; sq++) {
      var p = s.board[sq];
      if (p && p !== DUCK && colorOf(p) === color) sum += VALUES[typeOf(p)];
    }
    return sum;
  }

  // Squares a side can see in Fog of War: its own pieces plus every square
  // its pieces could move to (pawns see diagonals only when capturing).
  function visibleSquares(s, color) {
    var view = new Uint8Array(64);
    var probe = clone(s);
    probe.turn = color;
    probe.duckPending = false;
    var moves = pseudoMoves(probe);
    for (var i = 0; i < moves.length; i++) if (moves[i].to >= 0) view[moves[i].to] = 1;
    for (var sq = 0; sq < 64; sq++) {
      var p = s.board[sq];
      if (p && p !== DUCK && colorOf(p) === color) view[sq] = 1;
    }
    return view;
  }

  return {
    P: P, N: N, B: B, R: R, Q: Q, K: K, DUCK: DUCK, WHITE: WHITE, BLACK: BLACK, HILL: HILL,
    FLAG_DOUBLE: FLAG_DOUBLE, FLAG_EP: FLAG_EP, FLAG_CASTLE_K: FLAG_CASTLE_K, FLAG_CASTLE_Q: FLAG_CASTLE_Q,
    LETTERS: LETTERS, VALUES: VALUES, START_FEN: START_FEN, KING_TO: KING_TO, NO_CHECK: NO_CHECK,
    pc: pc, typeOf: typeOf, colorOf: colorOf, sqName: sqName, parseSq: parseSq, position960: position960,
    emptyState: emptyState, clone: clone, fromFEN: fromFEN, toFEN: toFEN, positionKey: positionKey,
    findKings: findKings, fixCastling: fixCastling, attacked: attacked, inCheck: inCheck,
    pseudoMoves: pseudoMoves, makeMove: makeMove, legalChildren: legalChildren, legalMoves: legalMoves,
    variantResult: variantResult, outcome: outcome, uci: uci, san: san, materialOf: materialOf,
    countPieces: countPieces, visibleSquares: visibleSquares
  };
})();
