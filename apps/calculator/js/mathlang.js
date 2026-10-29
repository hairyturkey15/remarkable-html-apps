// A small, safe math language (no eval): expressions, variables, user
// functions and a light scripting layer (print / if / for / while).
//
//   2x + 3(4 - 1)^2      implicit multiplication
//   f(x) = x^2 + 1       define a function
//   a = sqrt(2); a^2     several statements per line with ;
//   5!   10 mod 3   nCr(5, 2)
var MathLang = (function () {
  "use strict";

  var settings = { degrees: false };

  // --- Tokenizer ----------------------------------------------------------
  function tokenize(src) {
    var toks = [], i = 0;
    while (i < src.length) {
      var ch = src[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (/[0-9.]/.test(ch)) {
        var m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
        if (!m) throw new Error("bad number at " + i);
        toks.push({ t: "num", v: parseFloat(m[0]) });
        i += m[0].length;
        continue;
      }
      if (/[A-Za-z_π]/.test(ch)) {
        var id = /^[A-Za-z_π][A-Za-z_0-9]*/.exec(src.slice(i))[0];
        toks.push({ t: "id", v: id === "π" ? "pi" : id });
        i += id.length;
        continue;
      }
      var two = src.substr(i, 2);
      if (["==", "!=", "<=", ">=", "**"].indexOf(two) >= 0) {
        toks.push({ t: "op", v: two === "**" ? "^" : two });
        i += 2;
        continue;
      }
      if ("+-*/^%()!,=<>×÷−√".indexOf(ch) >= 0) {
        var v = ch === "×" ? "*" : ch === "÷" ? "/" : ch === "−" ? "-" : ch;
        if (v === "√") { toks.push({ t: "id", v: "sqrt" }); i++; continue; }
        toks.push({ t: "op", v: v });
        i++;
        continue;
      }
      throw new Error("unexpected '" + ch + "'");
    }
    return toks;
  }

  // --- Parser (precedence climbing) -> AST ----------------------------------
  // AST: {k:"num",v} {k:"var",n} {k:"call",n,args} {k:"un",op,a} {k:"bin",op,a,b} {k:"fact",a}
  function parse(src) {
    var toks = tokenize(src), pos = 0;
    function peek() { return toks[pos]; }
    function isOp(v) { var t = peek(); return t && t.t === "op" && t.v === v; }
    function expect(v) {
      if (!isOp(v)) throw new Error("expected '" + v + "'");
      pos++;
    }
    function startsOperand(t) { return t && (t.t === "num" || t.t === "id" || (t.t === "op" && t.v === "(")); }

    var BIN = {
      "or": [1, "L"], "and": [2, "L"],
      "==": [3, "L"], "!=": [3, "L"], "<": [4, "L"], "<=": [4, "L"], ">": [4, "L"], ">=": [4, "L"],
      "+": [5, "L"], "-": [5, "L"], "*": [6, "L"], "/": [6, "L"], "%": [6, "L"], "mod": [6, "L"],
      "^": [8, "R"]
    };

    function binOp() {
      var t = peek();
      if (!t) return null;
      if (t.t === "op" && BIN[t.v]) return t.v;
      if (t.t === "id" && (t.v === "and" || t.v === "or" || t.v === "mod")) return t.v;
      return null;
    }

    function expr(minPrec) {
      var left = unary();
      for (;;) {
        var op = binOp();
        var prec, assoc;
        if (op) {
          prec = BIN[op][0];
          assoc = BIN[op][1];
        } else if (startsOperand(peek())) {
          // Implicit multiplication: 2x, 3(4), (a)(b), 2pi
          op = "*";
          prec = 7;
          assoc = "L";
          if (prec < minPrec) break;
          var right0 = expr(prec + 1);
          left = { k: "bin", op: "*", a: left, b: right0 };
          continue;
        } else {
          break;
        }
        if (prec < minPrec) break;
        pos++;
        var right = expr(assoc === "L" ? prec + 1 : prec);
        left = { k: "bin", op: op, a: left, b: right };
      }
      return left;
    }

    function unary() {
      if (isOp("-")) { pos++; return { k: "un", op: "-", a: expr(7) }; }
      if (isOp("+")) { pos++; return expr(7); }
      var t = peek();
      if (t && t.t === "id" && t.v === "not") { pos++; return { k: "un", op: "not", a: expr(3) }; }
      return postfix(primary());
    }

    function postfix(node) {
      while (isOp("!")) { pos++; node = { k: "fact", a: node }; }
      if (isOp("^")) {
        pos++;
        node = { k: "bin", op: "^", a: node, b: unary() };
      }
      return node;
    }

    function primary() {
      var t = peek();
      if (!t) throw new Error("unexpected end");
      if (t.t === "num") { pos++; return { k: "num", v: t.v }; }
      if (t.t === "id") {
        pos++;
        // A built-in function without parentheses takes the next operand: √9, sqrt 2
        if (!isOp("(") && FUNCS.hasOwnProperty(t.v) && startsOperand(peek())) {
          return { k: "call", n: t.v, args: [postfix(primary())] };
        }
        if (isOp("(") && !CONSTS.hasOwnProperty(t.v)) {
          pos++;
          var args = [];
          if (!isOp(")")) {
            args.push(expr(1));
            while (isOp(",")) { pos++; args.push(expr(1)); }
          }
          expect(")");
          return { k: "call", n: t.v, args: args };
        }
        return { k: "var", n: t.v };
      }
      if (isOp("(")) {
        pos++;
        var e = expr(1);
        expect(")");
        return e;
      }
      throw new Error("unexpected '" + t.v + "'");
    }

    var node = expr(1);
    if (pos < toks.length) throw new Error("unexpected '" + toks[pos].v + "'");
    return node;
  }

  // --- Evaluation -------------------------------------------------------------
  var CONSTS = { pi: Math.PI, e: Math.E, phi: (1 + Math.sqrt(5)) / 2, tau: 2 * Math.PI, inf: Infinity, g0: 9.80665, c: 299792458 };

  function toRad(x) { return settings.degrees ? x * Math.PI / 180 : x; }
  function fromRad(x) { return settings.degrees ? x * 180 / Math.PI : x; }

  function gamma(z) {
    if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
    z -= 1;
    var g = 7, p = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
      12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    var x = p[0];
    for (var i = 1; i < g + 2; i++) x += p[i] / (z + i);
    var t = z + g + 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
  }
  function factorial(n) {
    if (n === Math.floor(n) && n >= 0 && n <= 170) {
      var r = 1;
      for (var i = 2; i <= n; i++) r *= i;
      return r;
    }
    return gamma(n + 1);
  }
  function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { var t = b; b = a % b; a = t; } return a; }

  var FUNCS = {
    sin: function (x) { return Math.sin(toRad(x)); },
    cos: function (x) { return Math.cos(toRad(x)); },
    tan: function (x) { return Math.tan(toRad(x)); },
    asin: function (x) { return fromRad(Math.asin(x)); },
    acos: function (x) { return fromRad(Math.acos(x)); },
    atan: function (x) { return fromRad(Math.atan(x)); },
    atan2: function (y, x) { return fromRad(Math.atan2(y, x)); },
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
    sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, exp: Math.exp,
    ln: Math.log, log: function (x, b) { return b === undefined ? Math.log10(x) : Math.log(x) / Math.log(b); }, log2: Math.log2, log10: Math.log10,
    floor: Math.floor, ceil: Math.ceil, round: function (x, d) { var f = Math.pow(10, d || 0); return Math.round(x * f) / f; },
    trunc: Math.trunc, sign: Math.sign,
    min: Math.min, max: Math.max, hypot: Math.hypot,
    root: function (x, n) { return x < 0 && n % 2 === 1 ? -Math.pow(-x, 1 / n) : Math.pow(x, 1 / n); },
    nCr: function (n, r) { return Math.round(factorial(n) / (factorial(r) * factorial(n - r))); },
    nPr: function (n, r) { return Math.round(factorial(n) / factorial(n - r)); },
    gcd: gcd, lcm: function (a, b) { return Math.abs(a * b) / gcd(a, b); },
    gamma: gamma, fact: factorial,
    rad: function (d) { return d * Math.PI / 180; }, deg: function (r) { return r * 180 / Math.PI; },
    mean: function () { var a = Array.prototype.slice.call(arguments); return a.reduce(function (s, v) { return s + v; }, 0) / a.length; },
    sum: function () { return Array.prototype.slice.call(arguments).reduce(function (s, v) { return s + v; }, 0); },
    rand: function () { return Math.random(); }
  };

  // Compiles an AST to a JS closure (fast enough for graphing).
  function compile(node, env) {
    switch (node.k) {
      case "num": return function () { return node.v; };
      case "var":
        return function (scope) {
          if (scope && scope.hasOwnProperty(node.n)) return scope[node.n];
          if (env.vars.hasOwnProperty(node.n)) return env.vars[node.n];
          if (CONSTS.hasOwnProperty(node.n)) return CONSTS[node.n];
          throw new Error("unknown name '" + node.n + "'");
        };
      case "un": {
        var a = compile(node.a, env);
        if (node.op === "not") return function (s) { return a(s) ? 0 : 1; };
        return function (s) { return -a(s); };
      }
      case "fact": { var f = compile(node.a, env); return function (s) { return factorial(f(s)); }; }
      case "bin": {
        var l = compile(node.a, env), r = compile(node.b, env);
        switch (node.op) {
          case "+": return function (s) { return l(s) + r(s); };
          case "-": return function (s) { return l(s) - r(s); };
          case "*": return function (s) { return l(s) * r(s); };
          case "/": return function (s) { return l(s) / r(s); };
          case "%": case "mod": return function (s) { var b = r(s), v = l(s) % b; return v < 0 ? v + Math.abs(b) : v; };
          case "^": return function (s) { return Math.pow(l(s), r(s)); };
          case "==": return function (s) { return Math.abs(l(s) - r(s)) < 1e-12 ? 1 : 0; };
          case "!=": return function (s) { return Math.abs(l(s) - r(s)) >= 1e-12 ? 1 : 0; };
          case "<": return function (s) { return l(s) < r(s) ? 1 : 0; };
          case "<=": return function (s) { return l(s) <= r(s) ? 1 : 0; };
          case ">": return function (s) { return l(s) > r(s) ? 1 : 0; };
          case ">=": return function (s) { return l(s) >= r(s) ? 1 : 0; };
          case "and": return function (s) { return l(s) && r(s) ? 1 : 0; };
          case "or": return function (s) { return l(s) || r(s) ? 1 : 0; };
        }
        break;
      }
      case "call": {
        var args = node.args.map(function (x) { return compile(x, env); });
        return function (s) {
          var vals = args.map(function (g) { return g(s); });
          var uf = env.funcs[node.n];
          if (uf) {
            if (env.depth > 200) throw new Error("recursion too deep in " + node.n);
            var local = {};
            uf.params.forEach(function (p, i) { local[p] = vals[i]; });
            env.depth++;
            try { return uf.body(local); } finally { env.depth--; }
          }
          if (FUNCS[node.n]) return FUNCS[node.n].apply(null, vals);
          throw new Error("unknown function '" + node.n + "'");
        };
      }
    }
    throw new Error("bad expression");
  }

  function makeEnv() { return { vars: { ans: 0 }, funcs: {}, depth: 0 }; }

  // Runs one line: a definition, an assignment or an expression.
  // Returns { value, text } (value undefined for definitions).
  function runLine(line, env) {
    var src = line.trim();
    if (!src) return { text: "" };
    var def = /^([A-Za-z_][A-Za-z_0-9]*)\s*\(([^)]*)\)\s*=(?!=)(.*)$/.exec(src);
    if (def && !FUNCS[def[1]]) {
      var params = def[2].split(",").map(function (p) { return p.trim(); }).filter(Boolean);
      env.funcs[def[1]] = { params: params, src: def[3].trim(), body: compile(parse(def[3]), env) };
      return { text: def[1] + "(" + params.join(", ") + ") defined" };
    }
    var asg = /^([A-Za-z_][A-Za-z_0-9]*)\s*=(?!=)(.*)$/.exec(src);
    if (asg) {
      if (CONSTS.hasOwnProperty(asg[1]) || FUNCS[asg[1]]) throw new Error("'" + asg[1] + "' is built in");
      var v = compile(parse(asg[2]), env)();
      env.vars[asg[1]] = v;
      return { value: v, text: asg[1] + " = " + format(v) };
    }
    var val = compile(parse(src), env)();
    env.vars.ans = val;
    return { value: val, text: format(val) };
  }

  // Script: lines with print / if / else / for / while / end. Indentation
  // is optional. Returns printed output lines.
  function runScript(text, env, maxSteps) {
    var lines = text.split("\n").map(function (l) { return l.replace(/#.*$/, "").trim(); });
    var out = [], steps = 0, limit = maxSteps || 200000;
    // Pair blocks with their 'end'.
    var stack = [], match = {};
    lines.forEach(function (l, i) {
      if (/^(if|for|while)\b/.test(l)) stack.push(i);
      else if (/^else\b/.test(l)) { if (!stack.length) throw new Error("line " + (i + 1) + ": else without if"); match["else" + stack[stack.length - 1]] = i; }
      else if (/^end\b/.test(l)) { if (!stack.length) throw new Error("line " + (i + 1) + ": end without block"); match[stack.pop()] = i; }
    });
    if (stack.length) throw new Error("line " + (stack[0] + 1) + ": block is missing 'end'");

    function evalExpr(src, i) {
      try { return compile(parse(src), env)(); } catch (e) { throw new Error("line " + (i + 1) + ": " + e.message); }
    }
    function run(from, to) {
      for (var i = from; i < to; i++) {
        if (++steps > limit) throw new Error("stopped after " + limit + " steps (infinite loop?)");
        var l = lines[i], m;
        if (!l) continue;
        if ((m = /^print\s+(.*)$/.exec(l))) {
          out.push(splitArgs(m[1]).map(function (a) {
            var q = /^"(.*)"$/.exec(a.trim());
            return q ? q[1] : format(evalExpr(a, i));
          }).join(" "));
        } else if ((m = /^if\s+(.*)$/.exec(l))) {
          var end = match[i], els = match["else" + i];
          if (evalExpr(m[1], i)) run(i + 1, els !== undefined ? els : end);
          else if (els !== undefined) run(els + 1, end);
          i = end;
        } else if ((m = /^for\s+([A-Za-z_]\w*)\s*=\s*(.+?)\s+to\s+(.+?)(?:\s+step\s+(.+))?$/.exec(l))) {
          var endF = match[i], a = evalExpr(m[2], i), b = evalExpr(m[3], i), st = m[4] ? evalExpr(m[4], i) : 1;
          if (!st) throw new Error("line " + (i + 1) + ": step can't be 0");
          for (var v = a; st > 0 ? v <= b + 1e-12 : v >= b - 1e-12; v += st) {
            env.vars[m[1]] = v;
            run(i + 1, endF);
            if (++steps > limit) throw new Error("stopped after " + limit + " steps");
          }
          i = endF;
        } else if ((m = /^while\s+(.*)$/.exec(l))) {
          var endW = match[i];
          while (evalExpr(m[1], i)) {
            run(i + 1, endW);
            if (++steps > limit) throw new Error("stopped after " + limit + " steps");
          }
          i = endW;
        } else if (/^(end|else)\b/.test(l)) {
          continue;
        } else {
          try { runLine(l, env); } catch (e) { throw new Error("line " + (i + 1) + ": " + e.message); }
        }
      }
    }
    run(0, lines.length);
    return out;
  }

  function splitArgs(s) {
    var out = [], depth = 0, cur = "", inStr = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch === '"') inStr = !inStr;
      if (!inStr && ch === "(") depth++;
      if (!inStr && ch === ")") depth--;
      if (!inStr && depth === 0 && ch === ",") { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  }

  function format(v) {
    if (typeof v !== "number") return String(v);
    if (isNaN(v)) return "undefined";
    if (!isFinite(v)) return v > 0 ? "∞" : "-∞";
    if (v === 0) return "0";
    var a = Math.abs(v);
    if (a >= 1e12 || a < 1e-6) {
      var s = v.toExponential(9).replace(/\.?0+e/, "e");
      return s.replace("e+", "e");
    }
    var r = parseFloat(v.toPrecision(12));
    return String(r);
  }

  // Function of x for graphing.
  function compileFn(src, env, varName) {
    var f = compile(parse(src), env), scope = {};
    varName = varName || "x";
    return function (x) {
      scope[varName] = x;
      try { return f(scope); } catch (e) { return NaN; }
    };
  }

  return { parse: parse, compile: compile, runLine: runLine, runScript: runScript, compileFn: compileFn, format: format, makeEnv: makeEnv, settings: settings, FUNCS: FUNCS, CONSTS: CONSTS };
})();
