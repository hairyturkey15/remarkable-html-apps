// Chemistry engine: elements, electron configurations, formulas, molar
// mass, equation balancing, oxidation states, reaction typing, rule-based
// product prediction, reaction enthalpy and spectra.
//
// Honesty rule: balancing and molar masses are exact arithmetic; anything
// predicted from rules of thumb (products, oxidation states in unusual
// compounds, solubility) carries a confidence label for the user.
var Chem = (function () {
  "use strict";

  // --- Elements ------------------------------------------------------------
  var EL = ELEMENTS_RAW.map(function (r) {
    var w = r[3], isotope = w.charAt(0) === "[";
    return {
      Z: r[0], sym: r[1], name: r[2], weight: w, mass: parseFloat(w.replace(/[\[\]]/g, "")), isotopeMass: isotope,
      cat: r[4], year: r[5], by: r[6], known: r[7], uses: r[8], fact: r[9], en: r[10], state: r[11]
    };
  });
  var BY_SYM = {};
  EL.forEach(function (e) { BY_SYM[e.sym] = e; });

  // Group/period placement (lanthanides/actinides get their own rows).
  EL.forEach(function (e) {
    var Z = e.Z, p, g;
    if (Z <= 2) { p = 1; g = Z === 1 ? 1 : 18; }
    else if (Z <= 10) { p = 2; g = Z <= 4 ? Z - 2 : Z + 8; }
    else if (Z <= 18) { p = 3; g = Z <= 12 ? Z - 10 : Z; }
    else if (Z <= 36) { p = 4; g = Z - 18; }
    else if (Z <= 54) { p = 5; g = Z - 36; }
    else if (Z <= 86) { p = 6; g = Z <= 56 ? Z - 54 : Z <= 71 ? 3 : Z - 68; }
    else { p = 7; g = Z <= 88 ? Z - 86 : Z <= 103 ? 3 : Z - 100; }
    e.period = p;
    e.group = g;
    e.fblock = (Z >= 57 && Z <= 71) || (Z >= 89 && Z <= 103);
  });

  // --- Electron configuration -----------------------------------------------
  var ORDER = ["1s", "2s", "2p", "3s", "3p", "4s", "3d", "4p", "5s", "4d", "5p", "6s", "4f", "5d", "6p", "7s", "5f", "6d", "7p"];
  var CAP = { s: 2, p: 6, d: 10, f: 14 };
  // Measured ground states that break the Madelung filling order.
  var EXCEPTIONS = {
    24: { "3d": 5, "4s": 1 }, 29: { "3d": 10, "4s": 1 }, 41: { "4d": 4, "5s": 1 }, 42: { "4d": 5, "5s": 1 },
    44: { "4d": 7, "5s": 1 }, 45: { "4d": 8, "5s": 1 }, 46: { "4d": 10, "5s": 0 }, 47: { "4d": 10, "5s": 1 },
    57: { "4f": 0, "5d": 1 }, 58: { "4f": 1, "5d": 1 }, 64: { "4f": 7, "5d": 1 }, 78: { "5d": 9, "6s": 1 }, 79: { "5d": 10, "6s": 1 },
    89: { "5f": 0, "6d": 1 }, 90: { "5f": 0, "6d": 2 }, 91: { "5f": 2, "6d": 1 }, 92: { "5f": 3, "6d": 1 }, 93: { "5f": 4, "6d": 1 },
    96: { "5f": 7, "6d": 1 }, 103: { "6d": 0, "7p": 1 }
  };

  function config(Z) {
    var left = Z, occ = {};
    ORDER.forEach(function (o) {
      var n = Math.min(left, CAP[o.charAt(1)]);
      occ[o] = n;
      left -= n;
    });
    var ex = EXCEPTIONS[Z];
    if (ex) Object.keys(ex).forEach(function (k) { occ[k] = ex[k]; });
    // Rebalance any electrons moved by exceptions (keep the total = Z).
    var total = 0;
    Object.keys(occ).forEach(function (k) { total += occ[k]; });
    if (ex && total !== Z) {
      // Electrons come out of (or go into) the highest s orbital.
      var s = ["7s", "6s", "5s", "4s"].filter(function (o) { return occ[o] !== undefined && ex[o] === undefined; })[0];
      if (s) occ[s] += Z - total;
    }
    var list = ORDER.filter(function (o) { return occ[o] > 0; }).map(function (o) { return [o, occ[o]]; });
    // Display order by n then l.
    var lOrder = "spdf";
    list.sort(function (a, b) { return a[0].charAt(0) - b[0].charAt(0) || lOrder.indexOf(a[0].charAt(1)) - lOrder.indexOf(b[0].charAt(1)); });
    var shells = [];
    list.forEach(function (it) { var n = +it[0].charAt(0); shells[n - 1] = (shells[n - 1] || 0) + it[1]; });
    return { orbitals: list, shells: shells.map(function (x) { return x || 0; }), predicted: Z > 103 };
  }

  var NOBLE = [2, 10, 18, 36, 54, 86, 118];
  function configString(Z, short) {
    var c = config(Z), parts;
    if (short) {
      var core = 0;
      NOBLE.forEach(function (n) { if (n < Z) core = n; });
      if (core) {
        var coreOrbs = {};
        config(core).orbitals.forEach(function (o) { coreOrbs[o[0]] = o[1]; });
        parts = c.orbitals.filter(function (o) { return coreOrbs[o[0]] !== o[1]; });
        return "[" + EL[core - 1].sym + "] " + parts.map(fmtOrb).join(" ");
      }
    }
    return c.orbitals.map(fmtOrb).join(" ");
  }
  var SUP = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
  function sup(n) { return String(n).split("").map(function (d) { return SUP[d]; }).join(""); }
  function fmtOrb(o) { return o[0] + sup(o[1]); }

  // --- Formulas ----------------------------------------------------------------
  // "Fe2(SO4)3", "CuSO4·5H2O", "NH4+", "SO4^2-", "H2O(l)", "Cu2+"
  function parseFormula(str) {
    var s = str.trim(), state = null, charge = 0;
    var st = /\((s|l|g|aq)\)\s*$/.exec(s);
    if (st) { state = st[1]; s = s.slice(0, st.index).trim(); }
    if (s === "e-" || s === "e⁻") return { counts: {}, charge: -1, state: null, text: "e⁻" };
    // Charges: "Fe3+" and "S2-" (one element: digits are the charge),
    // "NH4+" (digits are a subscript), "SO4^2-" or "SO4 2-" (explicit).
    var ch = /^(.*?)(\^|\s+)?(\d*)([+-])$/.exec(s);
    if (ch && ch[1]) {
      var sign = ch[4] === "+" ? 1 : -1;
      if (ch[2] || (ch[3] && (/^[A-Z][a-z]?$/.test(ch[1]) || /\]$/.test(ch[1])))) {
        charge = (ch[3] ? parseInt(ch[3], 10) : 1) * sign;
        s = ch[1];
      } else {
        charge = sign;
        s = ch[1] + ch[3];
      }
    }
    var counts = {};
    s.split(/[·.*]/).forEach(function (part, idx) {
      var mult = 1, m = /^(\d+)(.*)$/.exec(part);
      if (m && idx > 0) { mult = parseInt(m[1], 10); part = m[2]; }
      var sub = parseGroup(part);
      Object.keys(sub).forEach(function (k) { counts[k] = (counts[k] || 0) + sub[k] * mult; });
    });
    if (!Object.keys(counts).length) throw new Error("empty formula");
    return { counts: counts, charge: charge, state: state, text: str.trim() };
  }

  function parseGroup(s) {
    var i = 0, stack = [{}];
    while (i < s.length) {
      var c = s[i];
      if (c === "(" || c === "[") { stack.push({}); i++; continue; }
      if (c === ")" || c === "]") {
        i++;
        var num = /^\d+/.exec(s.slice(i)), n = num ? parseInt(num[0], 10) : 1;
        if (num) i += num[0].length;
        var top = stack.pop();
        if (!stack.length) throw new Error("unbalanced parentheses");
        Object.keys(top).forEach(function (k) { stack[stack.length - 1][k] = (stack[stack.length - 1][k] || 0) + top[k] * n; });
        continue;
      }
      var m = /^([A-Z][a-z]?)(\d*)/.exec(s.slice(i));
      if (!m) throw new Error("can't read '" + s.slice(i) + "'");
      if (!BY_SYM[m[1]]) throw new Error("unknown element '" + m[1] + "'");
      var cur = stack[stack.length - 1];
      cur[m[1]] = (cur[m[1]] || 0) + (m[2] ? parseInt(m[2], 10) : 1);
      i += m[0].length;
    }
    if (stack.length !== 1) throw new Error("unbalanced parentheses");
    return stack[0];
  }

  function molarMass(f) {
    var total = 0, parts = [];
    Object.keys(f.counts).forEach(function (k) {
      var m = BY_SYM[k].mass * f.counts[k];
      total += m;
      parts.push({ sym: k, n: f.counts[k], mass: m });
    });
    parts.forEach(function (p) { p.pct = p.mass / total * 100; });
    return { mass: total, parts: parts, approximate: parts.some(function (p) { return BY_SYM[p.sym].isotopeMass; }) };
  }

  // --- Exact fractions for balancing -------------------------------------------
  function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { var t = b; b = a % b; a = t; } return a || 1; }
  function frac(n, d) { if (d < 0) { n = -n; d = -d; } var g = gcd(n, d); return [n / g, d / g]; }
  function fsub(a, b) { return frac(a[0] * b[1] - b[0] * a[1], a[1] * b[1]); }
  function fmul(a, b) { return frac(a[0] * b[0], a[1] * b[1]); }
  function fdiv(a, b) { return frac(a[0] * b[1], a[1] * b[0]); }

  function parseSide(side) {
    // Split on a "+" that starts the next species (a capital, digit or bracket
    // follows), so "Fe3+ + Cl-" and "H2+O2" both work.
    return side.split(/\s*\+\s*(?=[A-Z0-9(\[e])/).map(function (t) { return t.trim(); }).filter(Boolean).map(function (t) {
      var m = /^(\d+)\s*(.*)$/.exec(t);
      return parseFormula(m && /[A-Z(]/.test(m[2].charAt(0)) ? m[2] : t);
    });
  }

  function splitEquation(eq) {
    var m = /(.*?)\s*(->|→|=|⇌|<->|<=>)\s*(.*)/.exec(eq);
    if (!m) return null;
    return { left: parseSide(m[1]), right: parseSide(m[3]) };
  }

  // Smallest whole-number coefficients (null if impossible or ambiguous).
  function balance(left, right) {
    var species = left.concat(right), elems = {};
    species.forEach(function (sp) { Object.keys(sp.counts).forEach(function (k) { elems[k] = 1; }); });
    var rows = Object.keys(elems).map(function (el) {
      return species.map(function (sp, j) { var n = sp.counts[el] || 0; return frac(j < left.length ? n : -n, 1); });
    });
    if (species.some(function (sp) { return sp.charge; })) {
      rows.push(species.map(function (sp, j) { return frac(j < left.length ? sp.charge : -sp.charge, 1); }));
    }
    var nCols = species.length, r = 0, pivots = [];
    for (var c = 0; c < nCols && r < rows.length; c++) {
      var p = -1;
      for (var i = r; i < rows.length; i++) if (rows[i][c][0] !== 0) { p = i; break; }
      if (p < 0) continue;
      var tmp = rows[r]; rows[r] = rows[p]; rows[p] = tmp;
      var pv = rows[r][c];
      rows[r] = rows[r].map(function (x) { return fdiv(x, pv); });
      for (i = 0; i < rows.length; i++) {
        if (i === r || rows[i][c][0] === 0) continue;
        var f = rows[i][c];
        rows[i] = rows[i].map(function (x, k) { return fsub(x, fmul(f, rows[r][k])); });
      }
      pivots.push(c);
      r++;
    }
    var free = [];
    for (c = 0; c < nCols; c++) if (pivots.indexOf(c) < 0) free.push(c);
    if (free.length !== 1) return { ok: false, reason: free.length === 0 ? "These species can't be balanced (check the formulas)." : "More than one independent balance exists; split it into separate reactions." };
    var fc = free[0], sol = new Array(nCols);
    sol[fc] = [1, 1];
    pivots.forEach(function (pc, ri) { sol[pc] = frac(-rows[ri][fc][0], rows[ri][fc][1]); });
    var lcm = sol.reduce(function (l, x) { return l * x[1] / gcd(l, x[1]); }, 1);
    var ints = sol.map(function (x) { return x[0] * lcm / x[1]; });
    if (ints.some(function (x) { return x === 0; })) return { ok: false, reason: "A species drops out (coefficient 0): it doesn't take part as written." };
    if (ints[0] < 0) ints = ints.map(function (x) { return -x; });
    if (ints.some(function (x) { return x < 0; })) return { ok: false, reason: "No balance with all species on the sides given (try moving one to the other side)." };
    var g = ints.reduce(function (a, b) { return gcd(a, b); });
    ints = ints.map(function (x) { return x / g; });
    return { ok: true, left: ints.slice(0, left.length), right: ints.slice(left.length) };
  }

  // --- Oxidation states ---------------------------------------------------------
  var ALKALI = { Li: 1, Na: 1, K: 1, Rb: 1, Cs: 1, Fr: 1 }, ALKALINE = { Be: 1, Mg: 1, Ca: 1, Sr: 1, Ba: 1, Ra: 1 };
  var COMMON_NEG = { N: -3, P: -3, S: -2, Se: -2, Te: -2, C: -4, As: -3, Cl: -1, Br: -1, I: -1 };

  // Returns { states: {el: number}, note: "" | "average" | "estimated" }.
  function oxidationStates(sp) {
    // Salts: work out each ion on its own (keeps NO3- at N +5, NH4+ at N -3).
    var ion = sp.charge === 0 ? asIonic(sp) : null;
    if (ion && ion.cation[0] !== "H") {
      var cat = oxidationStatesSimple(withCharge(ion.cation[2], ion.cation[1]));
      var an = oxidationStatesSimple(withCharge(ion.anion[2], ion.anion[1]));
      var merged = {}, weight = {}, note0 = cat.note || an.note;
      [[cat, ion.nc, ion.cation[2]], [an, ion.na, ion.anion[2]]].forEach(function (part) {
        var cnt = parseGroup(part[2]);
        Object.keys(part[0].states).forEach(function (e) {
          var n = cnt[e] * part[1];
          if (merged[e] !== undefined && merged[e] / weight[e] !== part[0].states[e]) note0 = "average";
          merged[e] = (merged[e] || 0) + part[0].states[e] * n;
          weight[e] = (weight[e] || 0) + n;
        });
      });
      Object.keys(merged).forEach(function (e) { merged[e] /= weight[e]; });
      return { states: merged, note: note0, parts: [cat, an] };
    }
    return oxidationStatesSimple(sp);
  }

  function withCharge(formula, charge) {
    return { counts: parseGroup(formula), charge: charge, text: formula };
  }

  function oxidationStatesSimple(sp) {
    var els = Object.keys(sp.counts), states = {}, note = "";
    if (els.length === 1) {
      states[els[0]] = sp.charge / sp.counts[els[0]];
      return { states: states, note: "" };
    }
    var metalsOnlyWithH = els.every(function (e) { return e === "H" || ALKALI[e] || ALKALINE[e] || e === "Al"; });
    var rules = [
      ["F", -1],
      ["*alkali", 1], ["*alkaline", 2], ["Al", 3],
      ["H", metalsOnlyWithH ? -1 : 1],
      ["O", -2]
    ];
    rules.forEach(function (rule) {
      els.forEach(function (e) {
        if (states[e] !== undefined) return;
        if ((rule[0] === "*alkali" && ALKALI[e]) || (rule[0] === "*alkaline" && ALKALINE[e]) || rule[0] === e) states[e] = rule[1];
      });
    });
    // Halogens other than F are -1 unless bonded to O or F.
    ["Cl", "Br", "I"].forEach(function (h) {
      if (sp.counts[h] && states[h] === undefined && !sp.counts.O && !sp.counts.F) {
        var others = els.filter(function (e) { return states[e] === undefined && e !== h; });
        if (others.length) states[h] = -1;
      }
    });
    var unknown = els.filter(function (e) { return states[e] === undefined; });
    var sumKnown = function () { return els.reduce(function (s, e) { return s + (states[e] !== undefined ? states[e] * sp.counts[e] : 0); }, 0); };
    if (unknown.length > 1) {
      // Give the most electronegative unknown its usual negative state.
      unknown.sort(function (a, b) { return (BY_SYM[b].en || 0) - (BY_SYM[a].en || 0); });
      var e0 = unknown[0];
      if (COMMON_NEG[e0] !== undefined && (sp.counts.C ? e0 !== "C" : true)) states[e0] = COMMON_NEG[e0];
      else if (sp.counts.C && sp.counts.H) {
        // Organic: everything else at its common state, carbon averaged.
        unknown.forEach(function (e) { if (e !== "C" && COMMON_NEG[e] !== undefined) states[e] = COMMON_NEG[e]; });
      }
      note = "estimated";
      unknown = els.filter(function (e) { return states[e] === undefined; });
    }
    if (unknown.length === 1) {
      var u = unknown[0];
      states[u] = (sp.charge - sumKnown()) / sp.counts[u];
      if (states[u] !== Math.round(states[u])) note = note || "average";
    } else if (unknown.length === 0 && sumKnown() !== sp.charge) {
      // Peroxides/superoxides etc.: let oxygen (or H) absorb the difference.
      var adj = sp.counts.O ? "O" : sp.counts.H ? "H" : null;
      if (adj) {
        states[adj] = 0;
        states[adj] = (sp.charge - sumKnown()) / sp.counts[adj];
        note = "unusual";
      }
    } else if (unknown.length > 1) {
      unknown.forEach(function (e) { states[e] = NaN; });
      note = "unknown";
    }
    return { states: states, note: note };
  }

  // --- Ions, acids, solubility ------------------------------------------------------
  var CATIONS = [
    ["H", 1, "H"], ["Li", 1, "Li"], ["Na", 1, "Na"], ["K", 1, "K"], ["Rb", 1, "Rb"], ["Cs", 1, "Cs"], ["NH4", 1, "NH4"],
    ["Ag", 1, "Ag"], ["Cu", 2, "Cu"], ["Cu", 1, "Cu"], ["Mg", 2, "Mg"], ["Ca", 2, "Ca"], ["Sr", 2, "Sr"], ["Ba", 2, "Ba"],
    ["Zn", 2, "Zn"], ["Fe", 2, "Fe"], ["Fe", 3, "Fe"], ["Al", 3, "Al"], ["Pb", 2, "Pb"], ["Ni", 2, "Ni"], ["Co", 2, "Co"],
    ["Mn", 2, "Mn"], ["Cr", 3, "Cr"], ["Sn", 2, "Sn"], ["Hg", 2, "Hg"], ["Cd", 2, "Cd"]
  ];
  var ANIONS = [
    ["F", -1, "F"], ["Cl", -1, "Cl"], ["Br", -1, "Br"], ["I", -1, "I"], ["OH", -1, "OH"], ["NO3", -1, "NO3"], ["NO2", -1, "NO2"],
    ["SO4", -2, "SO4"], ["SO3", -2, "SO3"], ["CO3", -2, "CO3"], ["HCO3", -1, "HCO3"], ["PO4", -3, "PO4"], ["CH3COO", -1, "C2H3O2"],
    ["ClO3", -1, "ClO3"], ["ClO4", -1, "ClO4"], ["MnO4", -1, "MnO4"], ["CrO4", -2, "CrO4"], ["Cr2O7", -2, "Cr2O7"], ["S", -2, "S"],
    ["O", -2, "O"], ["CN", -1, "CN"]
  ];
  function ionCounts(f) { return parseGroup(f); }
  function sameCounts(a, b) {
    var ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(function (k) { return a[k] === b[k]; });
  }
  function addCounts(a, b, n) {
    var out = Object.assign({}, a);
    Object.keys(b).forEach(function (k) { out[k] = (out[k] || 0) + b[k] * n; });
    return out;
  }

  // Splits an ionic compound into cation/anion (null if it isn't one).
  function asIonic(sp) {
    if (sameCounts(sp.counts, { H: 2, O: 1 }) || sameCounts(sp.counts, { H: 2, O: 2 })) return null;
    for (var i = 0; i < CATIONS.length; i++) {
      for (var j = 0; j < ANIONS.length; j++) {
        var c = CATIONS[i], a = ANIONS[j];
        var nc = -a[1] / gcd(c[1], -a[1]), na = c[1] / gcd(c[1], -a[1]);
        var total = addCounts(addCounts({}, ionCounts(c[2]), nc), ionCounts(a[2]), na);
        if (sameCounts(total, sp.counts) && sp.charge === 0) return { cation: c, anion: a, nc: nc, na: na };
      }
    }
    return null;
  }

  function saltFormula(c, a) {
    var g = gcd(c[1], -a[1]), nc = -a[1] / g, na = c[1] / g;
    var part = function (ion, n) {
      var poly = /[A-Z].*[A-Z]|\d/.test(ion) && ion.length > 2 || ion === "OH" || ion === "CN";
      if (n === 1) return ion;
      return poly ? "(" + ion + ")" + n : ion + n;
    };
    if (c[0] === "H" && a[0] === "OH") return "H2O";
    if (a[0] === "CH3COO" && c[0] !== "H") return part(c[0], nc) + (na === 1 ? "CH3COO" : "(CH3COO)" + na);
    if (a[0] === "CH3COO") return "CH3COOH";
    return part(c[0], nc) + part(a[0], na);
  }

  // Common solubility rules (25 °C, water). Returns "soluble" | "insoluble" | "slightly soluble".
  function solubility(c, a) {
    var cat = c[0], an = a[0];
    if (ALKALI[cat] || cat === "NH4" || cat === "H") return "soluble";
    if (an === "NO3" || an === "CH3COO" || an === "ClO3" || an === "ClO4") return "soluble";
    if (an === "Cl" || an === "Br" || an === "I") return (cat === "Ag" || cat === "Pb" || (cat === "Hg" && c[1] === 1) || (cat === "Cu" && c[1] === 1)) ? (cat === "Pb" ? "slightly soluble" : "insoluble") : "soluble";
    if (an === "SO4") return (cat === "Ba" || cat === "Pb" || cat === "Sr") ? "insoluble" : (cat === "Ca" || cat === "Ag") ? "slightly soluble" : "soluble";
    if (an === "OH") return (cat === "Ba" || cat === "Sr") ? "soluble" : cat === "Ca" ? "slightly soluble" : "insoluble";
    if (an === "F") return (cat === "Ca" || cat === "Mg" || cat === "Sr" || cat === "Ba" || cat === "Pb") ? "insoluble" : "soluble";
    return "insoluble"; // CO3, PO4, S, SO3, CrO4, O, ...
  }

  var ACTIVITY = ["Li", "K", "Ba", "Sr", "Ca", "Na", "Mg", "Al", "Mn", "Zn", "Cr", "Fe", "Cd", "Co", "Ni", "Sn", "Pb", "H", "Cu", "Ag", "Hg", "Pt", "Au"];
  var HALOGEN_ACTIVITY = ["F", "Cl", "Br", "I"];
  var USUAL_CHARGE = { Li: 1, Na: 1, K: 1, Rb: 1, Cs: 1, Be: 2, Mg: 2, Ca: 2, Sr: 2, Ba: 2, Al: 3, Zn: 2, Fe: 3, Cu: 2, Ag: 1, Pb: 2, Ni: 2, Sn: 2, Mn: 2, Cr: 3, Co: 2, Cd: 2, Hg: 2 };
  // Charge a metal usually takes when it dissolves (displacement, acids).
  var SOLUTION_CHARGE = Object.assign({}, USUAL_CHARGE, { Fe: 2, Sn: 2, Cr: 2, Co: 2, Ni: 2, Mn: 2, Pb: 2, Cu: 2 });
  var DIATOMIC = { H: 1, N: 1, O: 1, F: 1, Cl: 1, Br: 1, I: 1 };

  function isElement(sp) { return Object.keys(sp.counts).length === 1 && !sp.charge; }
  function elementOf(sp) { return Object.keys(sp.counts)[0]; }
  function isMetal(sym) { var c = BY_SYM[sym].cat; return c === "alkali" || c === "alkaline" || c === "transition" || c === "post" || c === "lanthanide" || c === "actinide"; }
  function isCHO(sp) { var k = Object.keys(sp.counts); return sp.counts.C && sp.counts.H && k.every(function (e) { return e === "C" || e === "H" || e === "O"; }); }
  function elementFormula(sym) { return DIATOMIC[sym] ? sym + "2" : sym; }

  // --- Enthalpies of formation (kJ/mol, 298.15 K; NIST/CRC values) --------------
  var DHF = {
    "H2O(l)": -285.83, "H2O(g)": -241.82, "CO2(g)": -393.51, "CO(g)": -110.53, "CH4(g)": -74.87, "C2H6(g)": -84.0, "C3H8(g)": -104.7,
    "C4H10(g)": -125.6, "C8H18(l)": -250.1, "C2H4(g)": 52.4, "C2H2(g)": 227.4, "C6H6(l)": 49.0, "CH3OH(l)": -238.6, "C2H5OH(l)": -277.6,
    "C6H12O6(s)": -1273.3, "CH3COOH(l)": -484.3, "HCOOH(l)": -425.0, "NH3(g)": -45.9, "NO(g)": 91.3, "NO2(g)": 33.2, "N2O(g)": 81.6,
    "N2O4(g)": 11.1, "HNO3(l)": -174.1, "SO2(g)": -296.8, "SO3(g)": -395.7, "H2SO4(l)": -814.0, "H2S(g)": -20.6, "HCl(g)": -92.3,
    "HF(g)": -273.3, "HBr(g)": -36.3, "HI(g)": 26.5, "NaCl(s)": -411.2, "NaOH(s)": -425.8, "KCl(s)": -436.5, "KOH(s)": -424.6,
    "CaCO3(s)": -1207.6, "CaO(s)": -634.9, "Ca(OH)2(s)": -985.2, "MgO(s)": -601.6, "Al2O3(s)": -1675.7, "Fe2O3(s)": -824.2,
    "Fe3O4(s)": -1118.4, "FeO(s)": -272.0, "CuO(s)": -157.3, "Cu2O(s)": -168.6, "ZnO(s)": -350.5, "SiO2(s)": -910.7,
    "NaHCO3(s)": -950.8, "Na2CO3(s)": -1130.7, "H2O2(l)": -187.8, "O3(g)": 142.7, "NH4Cl(s)": -314.4, "NH4NO3(s)": -365.6,
    "AgCl(s)": -127.0, "BaSO4(s)": -1473.2, "CaCl2(s)": -795.4, "MgCl2(s)": -641.3, "CuSO4(s)": -771.4, "Na2SO4(s)": -1387.1,
    "KNO3(s)": -494.6, "KClO3(s)": -397.7, "KCl(aq)": -419.5, "CCl4(l)": -128.2, "P4O10(s)": -2984.0, "HgO(s)": -90.8,
    "HCl(aq)": -167.2, "NaOH(aq)": -470.1, "NaCl(aq)": -407.3, "KOH(aq)": -482.4, "HNO3(aq)": -207.4, "NH3(aq)": -80.3,
    "H2SO4(aq)": -909.3, "AgNO3(aq)": -101.8, "NaNO3(aq)": -447.5, "AgNO3(s)": -124.4, "NaNO3(s)": -467.9,
    "KMnO4(s)": -837.2, "MnCl2(s)": -481.3, "MnO2(s)": -520.0, "KBr(s)": -393.8, "NaBr(s)": -361.1, "KI(s)": -327.9,
    "Cu(NO3)2(s)": -302.9, "ZnCl2(s)": -415.1, "FeCl3(s)": -399.5, "FeCl2(s)": -341.8, "FeSO4(s)": -928.4, "ZnSO4(s)": -982.8,
    "MgSO4(s)": -1284.9, "CaSO4(s)": -1434.5, "NaF(s)": -576.6, "Na2O(s)": -414.2, "K2O(s)": -361.5, "Li2O(s)": -597.9
  };
  // Default state when none is written (the usual one at 25 °C).
  var DEFAULT_STATE = { H2O: "l", HCl: "aq", NaOH: "aq", KOH: "aq", HNO3: "aq", H2SO4: "aq", NH3: "g", AgNO3: "aq", NaNO3: "aq" };
  var ELEMENT_STANDARD = { H2: "g", O2: "g", N2: "g", F2: "g", Cl2: "g", Br2: "l", I2: "s", Hg: "l", C: "s", S: "s", P4: "s", P: "s" };

  function canonical(sp) {
    // Formula text without coefficients or state, reordered ions as typed.
    return sp.text.replace(/\((s|l|g|aq)\)\s*$/, "").trim();
  }

  function enthalpyOf(sp) {
    var f = canonical(sp), state = sp.state;
    if (isElement(sp)) {
      var std = ELEMENT_STANDARD[f] || (isMetal(elementOf(sp)) ? "s" : null);
      if (std && (!state || state === std)) return { value: 0 };
    }
    if (!state) state = DEFAULT_STATE[f];
    if (state && DHF[f + "(" + state + ")"] !== undefined) return { value: DHF[f + "(" + state + ")"], state: state };
    if (!state) {
      // Assume the first tabulated state (solid before liquid, gas, aqueous).
      var keys = ["s", "l", "g", "aq"].filter(function (s) { return DHF[f + "(" + s + ")"] !== undefined; });
      if (keys.length) return { value: DHF[f + "(" + keys[0] + ")"], state: keys[0], assumed: true };
    }
    return null;
  }

  // --- Reaction analysis ---------------------------------------------------------------
  function fmtCoef(n) { return n === 1 ? "" : n + " "; }
  function equationText(left, right, cl, cr) {
    return left.map(function (s, i) { return fmtCoef(cl[i]) + s.text; }).join(" + ") + "  →  " + right.map(function (s, i) { return fmtCoef(cr[i]) + s.text; }).join(" + ");
  }

  function classify(left, right) {
    var types = [];
    var hasO2 = left.some(function (s) { return canonical(s) === "O2"; });
    if (hasO2 && left.some(isCHO) && right.some(function (s) { return canonical(s) === "CO2"; })) types.push("combustion");
    if (left.length >= 2 && right.length === 1) types.push("synthesis (combination)");
    if (left.length === 1 && right.length >= 2) types.push("decomposition");
    var elL = left.filter(isElement).length, elR = right.filter(isElement).length;
    if (left.length === 2 && right.length === 2 && elL === 1 && elR === 1) types.push("single replacement");
    var ionicL = left.filter(asIonic).length;
    if (left.length === 2 && right.length === 2 && ionicL === 2 && elL === 0) types.push("double replacement");
    var acid = left.some(function (s) { var a = asIonic(s); return a && a.cation[0] === "H"; });
    var base = left.some(function (s) { var a = asIonic(s); return a && a.anion[0] === "OH"; });
    if (acid && base && right.some(function (s) { return canonical(s) === "H2O"; })) types.push("acid–base neutralization");
    return types;
  }

  function analyse(left, right, cl, cr) {
    var out = { lines: [], notes: [] };
    // Oxidation states of each element in each species, per side.
    var side = function (list) {
      var acc = {};
      list.forEach(function (sp) {
        var ox = oxidationStates(sp);
        sp.ox = ox;
        // Salts contribute each ion's states separately (NH4NO3: N -3 and +5).
        (ox.parts || [ox]).forEach(function (part) {
          Object.keys(part.states).forEach(function (e) {
            var v = part.states[e];
            if (isNaN(v)) return;
            (acc[e] = acc[e] || []).push({ v: v, sp: sp.text });
          });
        });
      });
      return acc;
    };
    var L = side(left), R = side(right);
    var oxidized = [], reduced = [], dispro = [];
    Object.keys(L).forEach(function (e) {
      if (!R[e]) return;
      // Compare the states that appear only on the right with the ones
      // that disappeared from the left (or all left states if none did).
      var key = function (x) { return Math.round(x.v * 1000); };
      var lset = L[e].map(key), rset = R[e].map(key);
      var fresh = R[e].filter(function (x) { return lset.indexOf(key(x)) < 0; });
      var lost = L[e].filter(function (x) { return rset.indexOf(key(x)) < 0; });
      var sources = lost.length ? lost : L[e];
      var ups = [], downs = [];
      fresh.forEach(function (b) {
        sources.forEach(function (a) {
          var txt = signed(a.v) + " (in " + a.sp + ") → " + signed(b.v) + " (in " + b.sp + ")";
          if (b.v > a.v + 1e-9 && ups.indexOf(txt) < 0) ups.push(txt);
          if (b.v < a.v - 1e-9 && downs.indexOf(txt) < 0) downs.push(txt);
        });
      });
      var up = ups, down = downs;
      if (up.length) oxidized.push(e + ": " + up.join("; "));
      if (down.length) reduced.push(e + ": " + down.join("; "));
      if (up.length && down.length) dispro.push(e);
    });
    if (dispro.length) out.notes.push("The same element is both oxidized and reduced (" + dispro.join(", ") + "): a disproportionation or comproportionation.");
    out.redox = oxidized.length > 0 && reduced.length > 0;
    out.oxidized = oxidized;
    out.reduced = reduced;
    var oxNotes = [];
    left.concat(right).forEach(function (sp) {
      var parts = Object.keys(sp.ox.states).map(function (e) { return e + " " + signed(sp.ox.states[e]); });
      out.lines.push(sp.text + ":  " + parts.join(", ") + (sp.ox.note ? "  (" + sp.ox.note + ")" : ""));
      if (sp.ox.note) oxNotes.push(sp.text);
    });
    if (oxNotes.length) out.notes.push("Oxidation states marked estimated/average/unusual come from rules of thumb: check them for " + oxNotes.join(", ") + ".");
    if (out.redox) {
      var agentsOx = left.filter(function (sp) { return Object.keys(sp.counts).some(function (e) { return oxidized.some(function (o) { return o.indexOf(e + ":") === 0; }); }); });
      var agentsRed = left.filter(function (sp) { return Object.keys(sp.counts).some(function (e) { return reduced.some(function (o) { return o.indexOf(e + ":") === 0; }); }); });
      out.reducingAgent = agentsOx.map(function (s) { return s.text; }).join(", ");
      out.oxidizingAgent = agentsRed.map(function (s) { return s.text; }).join(", ");
    }
    // Enthalpy
    var dh = 0, missing = [];
    var assumed = [];
    left.forEach(function (sp, i) { var h = enthalpyOf(sp); if (!h) missing.push(sp.text); else { dh -= cl[i] * h.value; if (h.assumed) assumed.push(sp.text + "(" + h.state + ")"); } });
    right.forEach(function (sp, i) { var h = enthalpyOf(sp); if (!h) missing.push(sp.text); else { dh += cr[i] * h.value; if (h.assumed) assumed.push(sp.text + "(" + h.state + ")"); } });
    var mixed = false;
    if (assumed.length && !missing.length) {
      out.notes.push("States assumed for the energy figure: " + assumed.join(", ") + ".");
      var states = left.concat(right).map(function (sp) { var h = enthalpyOf(sp); return h && h.state; });
      mixed = states.indexOf("aq") >= 0 && states.indexOf("s") >= 0;
    }
    out.types = classify(left, right);
    if (!missing.length) {
      out.dH = dh;
      out.thermo = dh < 0 ? "exothermic (releases heat)" : dh > 0 ? "endothermic (absorbs heat)" : "thermoneutral";
      if (mixed) {
        out.thermo += " — UNCERTAIN: the assumed states mix dissolved and solid species, which can change the size and even the sign. Add (aq)/(s) to each species for a meaningful figure";
        out.uncertain = true;
      }
    } else {
      out.thermo = "unknown: no formation-enthalpy data for " + missing.join(", ");
      if (out.types.indexOf("combustion") >= 0) out.thermo += " (combustion is virtually always exothermic)";
      else if (out.types.indexOf("acid–base neutralization") >= 0) out.thermo += " (neutralization is exothermic, about −56 kJ per mol of water for strong acid + strong base)";
    }
    return out;
  }

  function uniq(v, i, a) { return a.indexOf(v) === i; }

  function signed(x) {
    if (isNaN(x)) return "?";
    var r = Math.round(x * 100) / 100;
    return (r > 0 ? "+" : "") + r;
  }

  // --- Product prediction (rules of thumb) ---------------------------------------------
  // Returns { products: [formula strings], rule, confidence: "high"|"medium"|"low", note } or null.
  var KNOWN = [
    [["CH3COOH", "C2H5OH"], ["CH3COOC2H5", "H2O"], "Fischer esterification (needs an acid catalyst; it's an equilibrium)", "medium"],
    [["CH3COOH", "CH3OH"], ["CH3COOCH3", "H2O"], "Fischer esterification (needs an acid catalyst; it's an equilibrium)", "medium"],
    [["C2H4", "H2"], ["C2H6"], "Hydrogenation of an alkene (needs a Ni/Pt/Pd catalyst)", "high"],
    [["C2H4", "H2O"], ["C2H5OH"], "Hydration of ethene (acid catalyst, high temperature and pressure)", "high"],
    [["C2H4", "Br2"], ["C2H4Br2"], "Halogen addition to an alkene (bromine-water test)", "high"],
    [["C6H12O6"], ["C2H5OH", "CO2"], "Fermentation by yeast (anaerobic)", "high"],
    [["CO2", "H2O"], ["C6H12O6", "O2"], "Photosynthesis (needs light and chlorophyll)", "high"],
    [["CaCO3"], ["CaO", "CO2"], "Thermal decomposition (calcining limestone, ~900 °C)", "high"],
    [["KClO3"], ["KCl", "O2"], "Thermal decomposition (MnO2 catalyst)", "high"],
    [["H2O2"], ["H2O", "O2"], "Decomposition (catalyzed by MnO2, catalase, light)", "high"],
    [["HgO"], ["Hg", "O2"], "Thermal decomposition", "high"],
    [["NaHCO3"], ["Na2CO3", "H2O", "CO2"], "Thermal decomposition (baking soda)", "high"],
    [["H2O"], ["H2", "O2"], "Electrolysis (needs electrical energy)", "high"],
    [["N2", "H2"], ["NH3"], "Haber process (Fe catalyst, ~450 °C, 200 atm; equilibrium)", "high"],
    [["SO2", "O2"], ["SO3"], "Contact process (V2O5 catalyst; equilibrium)", "high"],
    [["NH3", "HCl"], ["NH4Cl"], "Acid–base reaction (white smoke)", "high"],
    [["CaO", "H2O"], ["Ca(OH)2"], "Slaking lime (strongly exothermic)", "high"]
  ];

  function sameSet(a, b) {
    if (a.length !== b.length) return false;
    var x = a.slice().sort(), y = b.slice().sort();
    return x.every(function (v, i) { return v === y[i]; });
  }

  function predict(reactants) {
    var names = reactants.map(canonical);
    for (var k = 0; k < KNOWN.length; k++) {
      if (sameSet(KNOWN[k][0], names)) return { products: KNOWN[k][1], rule: KNOWN[k][2] + " — a known textbook reaction", confidence: KNOWN[k][3] };
    }
    if (reactants.length === 1) return null;
    if (reactants.length !== 2) return null;
    var A = reactants[0], B = reactants[1];
    var pair = function (f) { return f(A, B) || f(B, A); };

    // Combustion of C/H/O compounds.
    var comb = pair(function (x, y) {
      if (isCHO(x) && canonical(y) === "O2") return { products: ["CO2", "H2O"], rule: "Complete combustion of a C/H/O compound", confidence: "high", note: "With too little oxygen, CO and soot form instead." };
      return null;
    });
    if (comb) return comb;

    // Element + element.
    if (isElement(A) && isElement(B)) {
      return pair(function (x, y) {
        var m = elementOf(x), n = elementOf(y);
        if (!isMetal(m) || isMetal(n)) return null;
        var q = USUAL_CHARGE[m];
        if (!q) return null;
        var anion = n === "O" ? ["O", -2, "O"] : n === "S" ? ["S", -2, "S"] : ["F", "Cl", "Br", "I"].indexOf(n) >= 0 ? [n, -1, n] : n === "N" ? ["N", -3, "N"] : null;
        if (!anion) return null;
        return { products: [saltFormula([m, q, m], anion)], rule: "Metal + nonmetal → ionic compound using the metal's usual charge (" + m + sup(q) + "⁺)", confidence: ALKALI[m] || ALKALINE[m] || m === "Al" ? "high" : "medium", note: ALKALI[m] || ALKALINE[m] || m === "Al" ? "" : m + " has more than one common charge; the product may differ." };
      });
    }

    // Metal + water.
    var mw = pair(function (x, y) {
      if (!isElement(x) || canonical(y) !== "H2O") return null;
      var m = elementOf(x);
      if (ALKALI[m] || m === "Ca" || m === "Sr" || m === "Ba") return { products: [saltFormula([m, USUAL_CHARGE[m], m], ["OH", -1, "OH"]), "H2"], rule: "Reactive metal + water → hydroxide + hydrogen", confidence: "high" };
      if (m === "Mg") return { products: ["MgO", "H2"], rule: "Magnesium reacts with steam (very slowly with cold water)", confidence: "medium" };
      if (ACTIVITY.indexOf(m) > ACTIVITY.indexOf("H")) return { products: [], rule: m + " is below hydrogen in the activity series: no reaction with water", confidence: "high" };
      return null;
    });
    if (mw) return mw;

    // Metal / halogen + ionic compound (single replacement), metal + acid.
    var single = pair(function (x, y) {
      if (!isElement(x)) return null;
      var ion = asIonic(y);
      if (!ion) return null;
      var m = elementOf(x);
      if (isMetal(m) && ACTIVITY.indexOf(m) >= 0) {
        var target = ion.cation[0];
        if (ACTIVITY.indexOf(target) < 0) return null;
        // Nitric acid oxidizes through the nitrate, not H+ (4: Cu + HNO3).
        if (target === "H" && ion.anion[0] === "NO3") {
          if (m === "Au" || m === "Pt") return { products: [], rule: m + " doesn't dissolve in nitric acid (it needs aqua regia)", confidence: "high" };
          var qn = SOLUTION_CHARGE[m] || 2;
          return { products: [saltFormula([m, qn, m], ion.anion), "NO", "H2O"], rule: "Metal + dilute nitric acid → metal nitrate + nitrogen monoxide + water", confidence: "low", note: "Concentrated nitric acid gives NO2 instead; very dilute acid with active metals can give N2O, N2 or NH4+." };
        }
        if (ACTIVITY.indexOf(m) < ACTIVITY.indexOf(target)) {
          var q = SOLUTION_CHARGE[m] || 2;
          var displaced = target === "H" ? "H2" : elementFormula(target);
          return {
            products: [saltFormula([m, q, m], ion.anion), displaced],
            rule: m + " is more reactive than " + target + " (activity series), so it displaces it",
            confidence: "medium",
            note: SOLUTION_CHARGE[m] ? (m === "Fe" ? "Iron gives Fe²⁺ here (Fe³⁺ only with strong oxidizers)." : "") : "Charge of " + m + " assumed 2+."
          };
        }
        return { products: [], rule: m + " is less reactive than " + target + ": no displacement expected", confidence: "medium" };
      }
      var hal = HALOGEN_ACTIVITY.indexOf(m);
      if (hal >= 0 && HALOGEN_ACTIVITY.indexOf(ion.anion[0]) >= 0) {
        if (hal < HALOGEN_ACTIVITY.indexOf(ion.anion[0])) return { products: [saltFormula(ion.cation, [m, -1, m]), elementFormula(ion.anion[0])], rule: "More reactive halogen displaces a less reactive halide", confidence: "high" };
        return { products: [], rule: "Less reactive halogen: no displacement", confidence: "high" };
      }
      return null;
    });
    if (single) return single;

    // Ionic + ionic: acid/base, carbonate + acid, precipitation.
    var a = asIonic(A), b = asIonic(B);
    if (a && b) {
      var acid = a.cation[0] === "H" ? a : b.cation[0] === "H" ? b : null, other = acid === a ? b : a;
      if (acid && (other.anion[0] === "CO3" || other.anion[0] === "HCO3")) {
        return { products: [saltFormula(other.cation, acid.anion), "H2O", "CO2"], rule: "Acid + carbonate → salt + water + carbon dioxide", confidence: "high" };
      }
      if (acid && other.anion[0] === "OH") {
        return { products: [saltFormula(other.cation, acid.anion), "H2O"], rule: "Acid + hydroxide → salt + water (neutralization)", confidence: "high" };
      }
      var p1 = saltFormula(a.cation, b.anion), p2 = saltFormula(b.cation, a.anion);
      var s1 = solubility(a.cation, b.anion), s2 = solubility(b.cation, a.anion);
      var gas = (a.cation[0] === "NH4" && b.anion[0] === "OH") || (b.cation[0] === "NH4" && a.anion[0] === "OH");
      if (gas) return { products: [a.cation[0] === "NH4" ? p2 : p1, "NH3", "H2O"], rule: "Ammonium salt + hydroxide → ammonia gas", confidence: "high" };
      if (s1 !== "soluble" || s2 !== "soluble") {
        return {
          products: [p1, p2],
          rule: "Double replacement: " + [s1 !== "soluble" ? p1 + " is " + s1 : "", s2 !== "soluble" ? p2 + " is " + s2 : ""].filter(Boolean).join("; ") + " in water, so it precipitates",
          confidence: "medium",
          note: "Based on general solubility rules, which have exceptions."
        };
      }
      return { products: [], rule: "Double replacement gives only soluble products (" + p1 + ", " + p2 + "): ions just stay mixed in solution", confidence: "medium" };
    }
    return null;
  }

  // --- Spectra -----------------------------------------------------------------
  var HC = 1239.84198; // eV·nm
  var R_INF = 10973731.568; // m⁻¹
  var M_E = 5.48579909e-4; // electron mass in u

  // Hydrogen-like ion lines (vacuum nm), reduced-mass corrected.
  function rydbergLines(Z, nucleusMass, lower, maxUpper) {
    var R = R_INF / (1 + M_E / nucleusMass), out = [];
    for (var n2 = lower + 1; n2 <= maxUpper; n2++) {
      var inv = R * Z * Z * (1 / (lower * lower) - 1 / (n2 * n2));
      out.push({ upper: n2, lower: lower, nm: 1e9 / inv });
    }
    return out;
  }

  // Vacuum → air wavelength (Edlén-style, valid > 200 nm).
  function vacToAir(nm) {
    if (nm < 200) return nm;
    var s2 = Math.pow(1000 / nm, 2);
    var n = 1 + 0.0000834254 + 0.02406147 / (130 - s2) + 0.00015998 / (38.9 - s2);
    return nm / n;
  }

  // Selected strong lines (air, nm) after the NIST Atomic Spectra Database.
  var LINES = {
    H: [656.28, 486.13, 434.05, 410.17, 397.01],
    He: [388.87, 447.15, 471.31, 492.19, 501.57, 587.56, 667.82, 706.52],
    Li: [460.29, 610.36, 670.78],
    Na: [568.82, 588.99, 589.59, 615.42, 818.33, 819.48],
    K: [404.41, 404.72, 766.49, 769.90],
    Ca: [393.37, 396.85, 422.67, 445.48, 558.88, 643.91],
    Sr: [407.77, 421.55, 460.73, 640.85],
    Ba: [455.40, 493.41, 553.55, 614.17],
    Cu: [324.75, 327.40, 510.55, 515.32, 521.82],
    Hg: [253.65, 365.02, 404.66, 407.78, 435.83, 546.07, 576.96, 579.07],
    Ne: [540.06, 585.25, 588.19, 594.48, 614.31, 616.36, 621.73, 626.65, 633.44, 638.30, 640.22, 650.65, 659.90, 692.95, 703.24],
    Ar: [415.86, 419.83, 696.54, 706.72, 738.40, 750.39, 763.51, 772.38, 811.53, 842.47],
    Kr: [427.40, 431.96, 437.61, 557.03, 587.09, 760.15, 811.29],
    Xe: [450.10, 462.43, 467.12, 473.42, 480.70, 492.32, 823.16, 828.01, 881.94],
    O: [557.73, 630.03, 777.19, 777.42, 777.54, 844.64],
    N: [746.83, 818.80, 821.63, 868.03],
    Fe: [373.49, 374.56, 382.04, 404.58, 438.35, 440.48, 527.04, 532.80]
  };

  // Kα1 X-ray energies (keV) for common elements; others use Moseley's law.
  var KALPHA = { C: 0.2774, N: 0.3924, O: 0.5249, Na: 1.04098, Mg: 1.25360, Al: 1.48670, Si: 1.73998, S: 2.30784, Cl: 2.62239, K: 3.3138, Ca: 3.69168, Ti: 4.51084, Cr: 5.41472, Mn: 5.89875, Fe: 6.40384, Co: 6.93032, Ni: 7.47815, Cu: 8.04778, Zn: 8.63886, Ga: 9.25174, Ge: 9.88642, Zr: 15.7751, Mo: 17.47934, Rh: 20.2161, Pd: 21.1771, Ag: 22.16292, Sn: 25.2713, W: 59.31824, Pt: 66.8311, Au: 68.8037, Pb: 74.9694, U: 98.439 };

  function kalpha(sym) {
    if (KALPHA[sym] !== undefined) return { keV: KALPHA[sym], exact: true };
    var Z = BY_SYM[sym].Z;
    if (Z < 4) return null;
    return { keV: 10.2e-3 * (Z - 1) * (Z - 1), exact: false };
  }

  function regionOf(nm) {
    if (nm < 0.01) return "gamma ray";
    if (nm < 10) return "X-ray";
    if (nm < 380) return "ultraviolet";
    if (nm <= 750) return "visible (" + colorName(nm) + ")";
    if (nm < 1e6) return "infrared";
    if (nm < 1e9) return "microwave";
    return "radio";
  }

  function colorName(nm) {
    if (nm < 450) return "violet";
    if (nm < 485) return "blue";
    if (nm < 500) return "cyan";
    if (nm < 565) return "green";
    if (nm < 590) return "yellow";
    if (nm < 625) return "orange";
    return "red";
  }

  return {
    EL: EL, BY_SYM: BY_SYM, config: config, configString: configString, sup: sup,
    parseFormula: parseFormula, molarMass: molarMass, splitEquation: splitEquation, parseSide: parseSide, balance: balance,
    oxidationStates: oxidationStates, analyse: analyse, equationText: equationText, predict: predict, asIonic: asIonic, solubility: solubility,
    rydbergLines: rydbergLines, vacToAir: vacToAir, LINES: LINES, kalpha: kalpha, regionOf: regionOf, HC: HC, enthalpyOf: enthalpyOf
  };
})();
