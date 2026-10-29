// Interactive periodic table: element details with orbital pictures, a
// reaction calculator and spectra (see chem.js for the science).
(function () {
  "use strict";

  var st = Object.assign({ tab: "Table", z: 26, cat: null, eq: "KMnO4 + HCl -> KCl + MnCl2 + H2O + Cl2", specEl: "H", series: 2, conv: 589.0 }, RM.load("periodic.state", {}));
  var result = null, resultPage = 0;
  function save() { RM.store("periodic.state", st); }

  var CATS = {
    alkali: { label: "Alkali metal", fill: "#4d4d4d", text: "#ffffff" },
    alkaline: { label: "Alkaline earth", fill: "#8a8a8a", text: "#ffffff" },
    transition: { label: "Transition metal", fill: "#ffffff", text: "#000000" },
    post: { label: "Post-transition metal", fill: "#e2e2e2", text: "#000000" },
    metalloid: { label: "Metalloid", fill: "#c4c4c4", text: "#000000" },
    nonmetal: { label: "Reactive nonmetal", fill: "#ffffff", text: "#000000", pattern: "dots" },
    halogen: { label: "Halogen", fill: "#ffffff", text: "#000000", pattern: "diag" },
    noble: { label: "Noble gas", fill: "#ffffff", text: "#000000", pattern: "cross" },
    lanthanide: { label: "Lanthanide", fill: "#ffffff", text: "#000000", pattern: "hlines" },
    actinide: { label: "Actinide", fill: "#ffffff", text: "#000000", pattern: "vlines" },
    unknown: { label: "Properties unknown", fill: "#ffffff", text: "#000000", pattern: "dash" }
  };

  function pattern(ctx, kind, x, y, w, h) {
    if (!kind) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.strokeStyle = "#9a9a9a";
    ctx.fillStyle = "#9a9a9a";
    ctx.lineWidth = 1;
    var g = Math.max(4, w / 6);
    ctx.beginPath();
    if (kind === "dots") {
      for (var px = x + g / 2; px < x + w; px += g) for (var py = y + g / 2; py < y + h; py += g) { ctx.moveTo(px + 1, py); ctx.arc(px, py, 1, 0, Math.PI * 2); }
      ctx.fill();
    } else {
      for (var d = -h; d < w + h; d += g) {
        if (kind === "diag" || kind === "cross") { ctx.moveTo(x + d, y + h); ctx.lineTo(x + d + h, y); }
        if (kind === "cross") { ctx.moveTo(x + d, y); ctx.lineTo(x + d + h, y + h); }
      }
      if (kind === "hlines") for (var yy = y + g / 2; yy < y + h; yy += g) { ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); }
      if (kind === "vlines") for (var xx = x + g / 2; xx < x + w; xx += g) { ctx.moveTo(xx, y); ctx.lineTo(xx, y + h); }
      if (kind === "dash") for (yy = y + g / 2; yy < y + h; yy += g) for (xx = x; xx < x + w; xx += g) { ctx.moveTo(xx, yy); ctx.lineTo(xx + g / 2, yy); }
      ctx.stroke();
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------
  // Table
  // ------------------------------------------------------------------
  function cellPos(e) {
    if (e.fblock) {
      var row = e.Z <= 71 ? 8.5 : 9.5;
      return { col: (e.Z <= 71 ? e.Z - 57 : e.Z - 89) + 2, row: row };
    }
    return { col: e.group - 1, row: e.period - 1 };
  }

  function drawTable(ctx, x, y, w, h) {
    var m = Math.min(RM.W, RM.H);
    var legendH = Math.min(h * 0.16, m * 0.13);
    var cs = Math.min(w / 18.4, (h - legendH) / 10.8);
    var x0 = x + (w - cs * 18) / 2, y0 = y + cs * 0.1;
    Chem.EL.forEach(function (e) {
      var p = cellPos(e), cx = x0 + p.col * cs, cy = y0 + p.row * cs;
      var c = CATS[e.cat] || CATS.unknown, dim = st.cat && st.cat !== e.cat;
      ctx.fillStyle = dim ? "#ffffff" : c.fill;
      ctx.fillRect(cx + 1, cy + 1, cs - 2, cs - 2);
      if (!dim) pattern(ctx, c.pattern, cx + 1, cy + 1, cs - 2, cs - 2);
      ctx.lineWidth = e.Z === st.z ? 4 : 1;
      ctx.strokeStyle = dim ? "#c8c8c8" : "#000000";
      ctx.strokeRect(cx + 1, cy + 1, cs - 2, cs - 2);
      var col = dim ? "#a0a0a0" : c.text;
      RM.text(e.sym, cx + cs / 2, cy + cs * 0.56, cs * 0.4, { align: "center", bold: true, color: col });
      if (cs > 26) RM.text(String(e.Z), cx + cs * 0.1, cy + cs * 0.18, cs * 0.2, { color: col });
      RM.hit(cx, cy, cs, cs, function () { st.z = e.Z; st.tab = "Element"; save(); });
    });
    // f-block markers
    RM.text("57–71", x0 + 2.5 * cs, y0 + 5.55 * cs, cs * 0.2, { align: "center" });
    RM.text("89–103", x0 + 2.5 * cs, y0 + 6.55 * cs, cs * 0.2, { align: "center" });
    // Legend (tap to highlight a category)
    var keys = Object.keys(CATS), lw = w / 4, lh = legendH / 3, ly = y + h - legendH;
    keys.forEach(function (k, i) {
      var lx = x + (i % 4) * lw, yy = ly + Math.floor(i / 4) * lh, c = CATS[k];
      ctx.fillStyle = c.fill;
      ctx.fillRect(lx + 6, yy + lh * 0.2, lh * 0.6, lh * 0.6);
      pattern(ctx, c.pattern, lx + 6, yy + lh * 0.2, lh * 0.6, lh * 0.6);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#000";
      ctx.strokeRect(lx + 6, yy + lh * 0.2, lh * 0.6, lh * 0.6);
      RM.text(c.label, lx + 12 + lh * 0.6, yy + lh / 2, RM.fitPx(c.label, lw - lh, lh * 0.36), { bold: st.cat === k });
      RM.hit(lx, yy, lw, lh, function () { st.cat = st.cat === k ? null : k; save(); });
    });
  }

  // ------------------------------------------------------------------
  // Element detail with orbital pictures
  // ------------------------------------------------------------------
  function drawBohr(ctx, cx, cy, r, shells) {
    var n = shells.length;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.12, 0, Math.PI * 2);
    ctx.fillStyle = "#000";
    ctx.fill();
    shells.forEach(function (count, i) {
      var rr = r * (0.22 + 0.78 * (i + 1) / n);
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#000";
      ctx.stroke();
      for (var k = 0; k < count; k++) {
        var a = (k / count) * Math.PI * 2 - Math.PI / 2;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, Math.max(1.5, r * 0.025), 0, Math.PI * 2);
        ctx.fillStyle = "#000";
        ctx.fill();
      }
      RM.text(String(count), cx + rr + 3, cy - 4, Math.max(9, r * 0.07), {});
    });
  }

  // Valence subshells as boxes with up/down arrows (Hund's rule).
  function drawBoxes(ctx, x, y, w, Z) {
    var orbs = Chem.config(Z).orbitals;
    var maxN = Math.max.apply(null, orbs.map(function (o) { return +o[0][0]; }));
    // Outer shell plus any partly filled inner d/f subshells.
    var shown = orbs.filter(function (o) {
      var n = +o[0][0], l = o[0][1], cap = { s: 2, p: 6, d: 10, f: 14 }[l];
      return n === maxN || o[1] < cap;
    });
    var bs = Math.min(w / 9.5, 46), yy = y;
    shown.forEach(function (o) {
      var l = o[0][1], boxes = { s: 1, p: 3, d: 5, f: 7 }[l], e = o[1];
      RM.text(o[0], x, yy + bs / 2, bs * 0.55, { bold: true });
      for (var b = 0; b < boxes; b++) {
        var bx = x + bs * 1.6 + b * bs;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#000";
        ctx.strokeRect(bx, yy, bs, bs);
        var up = b < e, down = b + boxes < e;
        if (up) arrow(ctx, bx + bs * (down ? 0.32 : 0.5), yy + bs * 0.12, yy + bs * 0.88, true);
        if (down) arrow(ctx, bx + bs * 0.68, yy + bs * 0.12, yy + bs * 0.88, false);
      }
      yy += bs * 1.3;
    });
    return yy - y;
  }

  function arrow(ctx, x, y1, y2, up) {
    ctx.beginPath();
    ctx.moveTo(x, y1);
    ctx.lineTo(x, y2);
    var tip = up ? y1 : y2, d = up ? 1 : -1, s = (y2 - y1) * 0.25;
    ctx.moveTo(x - s * 0.6, tip + d * s);
    ctx.lineTo(x, tip);
    ctx.lineTo(x + s * 0.6, tip + d * s);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#000";
    ctx.stroke();
  }

  // Sketch of the outermost occupied orbital type (2D projection).
  function drawOrbitalShape(ctx, cx, cy, r, l) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#000";
    var lobe = function (ang, len, wid, filled) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(len * 0.35, -wid, len, -wid, len, 0);
      ctx.bezierCurveTo(len, wid, len * 0.35, wid, 0, 0);
      ctx.fillStyle = filled ? "#9a9a9a" : "#ffffff";
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };
    if (l === "s") {
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = "#d0d0d0";
      ctx.fill();
      ctx.stroke();
    } else if (l === "p") {
      lobe(0, r * 0.9, r * 0.32, true);
      lobe(Math.PI, r * 0.9, r * 0.32, false);
      RM.line(cx - r, cy, cx + r, cy, 1, "#808080");
    } else if (l === "d") {
      for (var i = 0; i < 4; i++) lobe(Math.PI / 4 + i * Math.PI / 2, r * 0.85, r * 0.26, i % 2 === 0);
    } else {
      for (i = 0; i < 6; i++) lobe(i * Math.PI / 3, r * 0.85, r * 0.2, i % 2 === 0);
    }
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#000";
    ctx.fill();
    RM.text(l + " orbital", cx, cy + r * 1.05, Math.max(10, r * 0.16), { align: "center", bold: true });
    RM.text("(shaded/unshaded = opposite phase)", cx, cy + r * 1.25, Math.max(8, r * 0.1), { align: "center" });
  }

  function drawElement(ctx, x, y, w, h) {
    var e = Chem.EL[st.z - 1], m = Math.min(RM.W, RM.H), pad = m * 0.025, c = CATS[e.cat] || CATS.unknown;
    var bs = Math.min(w * 0.26, h * 0.2);
    ctx.fillStyle = c.fill;
    ctx.fillRect(x + pad, y + pad, bs, bs);
    pattern(ctx, c.pattern, x + pad, y + pad, bs, bs);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#000";
    ctx.strokeRect(x + pad, y + pad, bs, bs);
    RM.text(String(e.Z), x + pad + bs * 0.08, y + pad + bs * 0.14, bs * 0.14, { color: c.text, bold: true });
    RM.text(e.sym, x + pad + bs / 2, y + pad + bs * 0.52, bs * 0.42, { align: "center", bold: true, color: c.text });
    RM.text(e.weight, x + pad + bs / 2, y + pad + bs * 0.86, bs * 0.13, { align: "center", color: c.text });
    var tx = x + pad * 2 + bs, tw = w - bs - pad * 3, px = Math.min(m * 0.03, 24);
    RM.text(e.name, tx, y + pad + px * 0.9, px * 1.5, { bold: true });
    var lines = [
      c.label + (e.fblock ? "" : " · group " + e.group) + " · period " + e.period,
      "Protons " + e.Z + " · electrons " + e.Z + " (neutral atom) · atomic weight " + e.weight + " u" + (e.isotopeMass ? " (most stable isotope)" : ""),
      "State at 0 °C, 1 atm: " + e.state + (e.en !== null ? " · electronegativity " + e.en : ""),
      "Discovered: " + e.year + " · " + e.by
    ];
    var yy = y + pad + px * 2.2;
    lines.forEach(function (l) { yy += RM.paragraph(l, tx, yy, tw, px * 0.8); });
    var cfg = Chem.config(e.Z);
    yy = Math.max(yy, y + pad + bs) + px * 0.6;
    RM.text("Electron configuration" + (cfg.predicted ? " (predicted)" : ""), x + pad, yy + px * 0.5, px * 0.85, { bold: true });
    yy += px * 1.2;
    yy += RM.paragraph(Chem.configString(e.Z, true) + "    shells: " + cfg.shells.join(", "), x + pad, yy, w - 2 * pad, px * 0.9);
    if (e.Z > 2) yy += RM.paragraph("Full: " + Chem.configString(e.Z, false), x + pad, yy, w - 2 * pad, px * 0.7);
    yy += px * 0.3;
    [["Known for", e.known], ["Used today in", e.uses], ["Neat fact", e.fact]].forEach(function (s) {
      RM.text(s[0], x + pad, yy + px * 0.5, px * 0.85, { bold: true });
      yy += px * 1.1;
      yy += RM.paragraph(s[1], x + pad, yy, w - 2 * pad, px * 0.85);
      yy += px * 0.2;
    });
    // Pictures
    var picH = y + h - yy - pad;
    if (picH > m * 0.15) {
      var r = Math.min(picH * 0.42, w * 0.15);
      var cy = yy + picH / 2;
      drawBohr(ctx, x + pad + r * 1.1, cy, r, cfg.shells);
      RM.text("Bohr shells", x + pad + r * 1.1, cy + r * 1.12, Math.max(10, r * 0.13), { align: "center", bold: true });
      var outer = cfg.orbitals[cfg.orbitals.length - 1];
      // The highest-energy orbital type (d/f fill late) for the picture.
      var lHighest = cfg.orbitals.reduce(function (best, o) { return "spdf".indexOf(o[0][1]) > "spdf".indexOf(best) && o[1] > 0 && (+o[0][0] >= +outer[0][0] - 2) ? o[0][1] : best; }, "s");
      var bx = x + pad + r * 2.5;
      drawBoxes(ctx, bx, yy + pad, w * 0.42, e.Z);
      drawOrbitalShape(ctx, x + w - pad - r * 0.9, cy - r * 0.15, r * 0.85, lHighest);
    }
  }

  // ------------------------------------------------------------------
  // Reactions
  // ------------------------------------------------------------------
  var EXAMPLES = [
    "Fe + O2 -> Fe2O3", "C3H8 + O2 -> CO2 + H2O", "KMnO4 + HCl -> KCl + MnCl2 + H2O + Cl2", "Cu + HNO3 -> Cu(NO3)2 + NO + H2O",
    "MnO4- + Fe2+ + H+ -> Mn2+ + Fe3+ + H2O", "HCl(aq) + NaOH(aq) -> NaCl(aq) + H2O(l)", "CaCO3 -> CaO + CO2", "NH4NO3 -> N2O + H2O",
    "Zn + HCl", "AgNO3 + NaCl", "CaCO3 + HCl", "Na + H2O", "Cl2 + KBr", "C2H5OH + O2", "CH3COOH + C2H5OH", "KNO3 + NaCl"
  ];

  function runReaction(mode) {
    var out = [];
    try {
      if (mode === "mass") {
        st.eq.split(/\s*\+\s*(?=[A-Z0-9(\[])|->|→|=/).map(function (t) { return t.trim(); }).filter(Boolean).forEach(function (t) {
          var f = Chem.parseFormula(t.replace(/^\d+\s*/, "")), mm = Chem.molarMass(f);
          out.push(t + ":  " + mm.mass.toFixed(3) + " g/mol" + (mm.approximate ? " (uses isotope mass numbers)" : ""));
          mm.parts.forEach(function (p) { out.push("    " + p.sym + " × " + p.n + " = " + p.mass.toFixed(3) + " g  (" + p.pct.toFixed(2) + "%)"); });
        });
        result = { title: "Molar mass", lines: out };
        return;
      }
      var sp = Chem.splitEquation(st.eq), left, right, pred = null;
      if (!sp || mode === "predict") {
        left = sp ? sp.left : Chem.parseSide(st.eq);
        pred = Chem.predict(left);
        if (!pred) {
          result = { title: "Prediction", lines: ["Not predicted: these reactants aren't covered by the built-in rules.", "", "Type the full equation (with ->) to balance it and analyse it.", "", "Rules cover: combustion, metal + nonmetal, metal + water/acid, displacement (activity series), halogen displacement, neutralization, acid + carbonate, precipitation (solubility rules), and a list of known textbook reactions."] };
          return;
        }
        if (!pred.products.length) {
          result = { title: "Prediction", lines: ["No reaction expected.", "Why: " + pred.rule + ".", "Confidence: " + pred.confidence].concat(pred.note ? ["Note: " + pred.note] : []) };
          return;
        }
        right = pred.products.map(function (p) { return Chem.parseFormula(p); });
        out.push("PREDICTED PRODUCTS (" + pred.confidence + " confidence)");
        out.push("Rule: " + pred.rule);
        if (pred.note) out.push("Note: " + pred.note);
        out.push("Predictions come from rules of thumb, not a simulation: verify before relying on them.");
        out.push("");
      } else {
        left = sp.left;
        right = sp.right;
      }
      var b = Chem.balance(left, right);
      if (!b.ok) {
        out.push("Can't balance: " + b.reason);
        result = { title: "Balance", lines: out };
        return;
      }
      out.push("BALANCED (exact)");
      out.push(Chem.equationText(left, right, b.left, b.right));
      out.push("");
      var a = Chem.analyse(left, right, b.left, b.right);
      out.push("TYPE: " + (a.types.length ? a.types.join(", ") : "not one of the simple textbook types") + (a.redox ? " · redox" : ""));
      if (a.redox) {
        a.oxidized.forEach(function (o) { out.push("Oxidized: " + o); });
        a.reduced.forEach(function (o) { out.push("Reduced: " + o); });
        if (a.reducingAgent) out.push("Reducing agent: " + a.reducingAgent + " · oxidizing agent: " + a.oxidizingAgent);
      } else {
        out.push("No change in oxidation states: not a redox reaction.");
      }
      out.push("");
      out.push("ENERGY: " + (a.dH !== undefined ? "ΔH° ≈ " + a.dH.toFixed(1) + " kJ (for the equation as written), " + a.thermo : a.thermo));
      if (a.dH !== undefined) out.push("From standard enthalpies of formation at 25 °C (Hess's law). States assumed where not given: add (s), (l), (g) or (aq) to be specific.");
      out.push("");
      out.push("OXIDATION STATES");
      a.lines.forEach(function (l) { out.push("  " + l); });
      a.notes.forEach(function (n) { out.push("Note: " + n); });
      result = { title: pred ? "Prediction" : "Analysis", lines: out };
    } catch (e) {
      result = { title: "Error", lines: ["Couldn't read that: " + e.message, "", "Examples: Fe + O2 -> Fe2O3,  Cu(NO3)2,  SO4^2-,  Fe3+,  CuSO4·5H2O,  H2O(l)"] };
    }
  }

  function drawReactions(ctx, x, y, w, h) {
    var m = Math.min(RM.W, RM.H), pad = m * 0.025, px = Math.min(m * 0.028, 22), bh = px * 2.2;
    RM.box(x + pad, y, w - 2 * pad, bh * 1.2, { radius: 8 });
    RM.text(st.eq || "(tap to type an equation or reactants)", x + pad * 1.5, y + bh * 0.6, RM.fitPx(st.eq, w - 4 * pad, px * 1.1, false, "monospace"), { family: "monospace" });
    RM.hit(x + pad, y, w - 2 * pad, bh * 1.2, editEq);
    var btns = [["Edit", editEq], ["Balance & analyse", function () { runReaction("analyse"); resultPage = 0; }], ["Predict products", function () { runReaction("predict"); resultPage = 0; }], ["Molar mass", function () { runReaction("mass"); resultPage = 0; }], ["Examples", function () {
      RM.choose("Examples", EXAMPLES, function (v) { if (v) { st.eq = v; save(); runReaction(/->/.test(v) ? "analyse" : "predict"); resultPage = 0; } });
    }]];
    var bw = (w - 2 * pad) / btns.length, by = y + bh * 1.4;
    btns.forEach(function (b, i) { RM.button(x + pad + i * bw + 3, by, bw - 6, bh, b[0], b[1], { px: px * 0.75, bold: i === 1 || i === 2 }); });
    var ty = by + bh * 1.3;
    if (!result) {
      RM.paragraph("Type an equation with -> (or =) to balance and analyse it, or just the reactants (e.g. Zn + HCl) to predict products.\n\nFormulas: parentheses, hydrates (CuSO4·5H2O), charges (Fe3+, SO4^2-, NH4+), states (H2O(l), NaCl(aq)).\n\nExact: balancing, molar masses, ΔH from tabulated data. Rules of thumb (always labeled): predicted products, solubility, oxidation states in unusual compounds.", x + pad, ty, w - 2 * pad, px * 0.9);
      return;
    }
    RM.text(result.title, x + pad, ty + px * 0.6, px * 1.1, { bold: true });
    var lines = [];
    result.lines.forEach(function (l) { RM.wrap(l, w - 3 * pad, px * 0.85, false, "monospace").forEach(function (s) { lines.push(s); }); });
    var lh = px * 1.15, per = Math.floor((y + h - ty - px * 3) / lh), pages = Math.max(1, Math.ceil(lines.length / per));
    resultPage = Math.min(resultPage, pages - 1);
    lines.slice(resultPage * per, (resultPage + 1) * per).forEach(function (l, i) {
      var bold = /^[A-Z][A-Z ()]+[A-Z)]( |:|$)/.test(l) || /^PREDICTED|^BALANCED|^TYPE|^ENERGY|^OXIDATION/.test(l);
      RM.text(l, x + pad, ty + px * 1.6 + lh * (i + 0.5), px * 0.85, { family: "monospace", bold: bold });
    });
    if (pages > 1) {
      var py = y + h - px * 1.8;
      RM.button(x + pad, py, w * 0.25, px * 1.7, "◀ Prev", function () { resultPage = Math.max(0, resultPage - 1); }, { px: px * 0.8 });
      RM.text((resultPage + 1) + " / " + pages, x + w / 2, py + px * 0.85, px * 0.8, { align: "center" });
      RM.button(x + w - pad - w * 0.25, py, w * 0.25, px * 1.7, "Next ▶", function () { resultPage = Math.min(pages - 1, resultPage + 1); }, { px: px * 0.8 });
    }
  }

  function editEq() {
    RM.prompt({ title: "Equation (A + B -> C) or reactants (A + B)", value: st.eq, mode: "text", mono: true }, function (v) {
      if (v !== null) { st.eq = v; result = null; save(); }
    });
  }

  // ------------------------------------------------------------------
  // Spectra
  // ------------------------------------------------------------------
  var SERIES = { 1: "Lyman (n→1, UV)", 2: "Balmer (n→2, visible)", 3: "Paschen (n→3, IR)", 4: "Brackett (n→4, IR)" };

  function drawSpectrum(ctx, x, y, w, h, lines) {
    var lo = 380, hi = 750;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#000";
    ctx.strokeRect(x, y, w, h);
    lines.forEach(function (nm) {
      if (nm < lo || nm > hi) return;
      var px = x + (nm - lo) / (hi - lo) * w;
      RM.line(px, y, px, y + h, 3);
    });
    for (var t = 400; t <= 750; t += 50) {
      var tx = x + (t - lo) / (hi - lo) * w;
      RM.line(tx, y + h, tx, y + h + 6, 1);
      RM.text(String(t), tx, y + h + 16, 12, { align: "center" });
    }
    ["violet", "blue", "green", "yellow", "orange", "red"].forEach(function (c, i) {
      var nm = [415, 470, 530, 578, 605, 690][i];
      RM.text(c, x + (nm - lo) / (hi - lo) * w, y - 10, 11, { align: "center" });
    });
  }

  function drawSpectra(ctx, x, y, w, h) {
    var m = Math.min(RM.W, RM.H), pad = m * 0.025, px = Math.min(m * 0.027, 21);
    var els = Object.keys(Chem.LINES);
    RM.button(x + pad, y, w * 0.45, px * 2.1, "Element: " + st.specEl + " ▾", function () {
      RM.choose("Emission lines for", els.map(function (s) { return { label: s + " · " + Chem.BY_SYM[s].name, value: s }; }), function (v) { if (v) { st.specEl = v; save(); } }, { current: st.specEl });
    }, { bold: true, px: px * 0.85 });
    RM.button(x + w * 0.5, y, w * 0.5 - pad, px * 2.1, "H series: " + SERIES[st.series].split(" ")[0] + " ▾", function () {
      RM.choose("Hydrogen series (Rydberg formula)", Object.keys(SERIES).map(function (k) { return { label: SERIES[k], value: +k }; }), function (v) { if (v) { st.series = v; save(); } }, { current: st.series });
    }, { px: px * 0.85 });
    var yy = y + px * 3.3;
    var lines = Chem.LINES[st.specEl];
    RM.text("Visible emission lines of " + Chem.BY_SYM[st.specEl].name + " (selected strong lines, air wavelengths, NIST ASD)", x + pad, yy, px * 0.75, { bold: true });
    drawSpectrum(ctx, x + pad, yy + px * 1.4, w - 2 * pad, px * 2.2, lines);
    yy += px * 5.6;
    yy += RM.paragraph(lines.map(function (l) { return l.toFixed(2) + " nm (" + Chem.regionOf(l).replace(/^visible \((.*)\)$/, "$1") + ")"; }).join(",  "), x + pad, yy, w - 2 * pad, px * 0.75);
    yy += px * 0.4;
    RM.paragraph("Absorption: a cool gas of the element absorbs at these same wavelengths (dark lines), mainly the ones from its ground state.", x + pad, yy, w - 2 * pad, px * 0.7);
    yy += px * 2.4;

    // Hydrogen series computed from the Rydberg formula.
    var ser = Chem.rydbergLines(1, 1.00782503, st.series, st.series + 7);
    RM.text("Hydrogen " + SERIES[st.series] + ", computed: 1/λ = R_H (1/n₁² − 1/n₂²)", x + pad, yy, px * 0.75, { bold: true });
    yy += px * 0.9;
    yy += RM.paragraph(ser.map(function (l) {
      var v = l.nm, a = Chem.vacToAir(v);
      return l.upper + "→" + l.lower + ": " + (v > 200 ? a.toFixed(2) + " nm air" : v.toFixed(2) + " nm vac");
    }).join(",   ") + "   · series limit " + (1e9 / (10967758.3 / (st.series * st.series))).toFixed(1) + " nm", x + pad, yy, w - 2 * pad, px * 0.75);
    yy += px * 0.8;

    // X-ray Kα for the current element (from the Element tab).
    var e = Chem.EL[st.z - 1], ka = Chem.kalpha(e.sym);
    RM.text("X-ray Kα1 of " + e.name + " (pick an element in the Table tab)", x + pad, yy, px * 0.75, { bold: true });
    yy += px * 0.9;
    yy += RM.paragraph(ka ? ka.keV.toFixed(ka.exact ? 4 : 2) + " keV  =  " + (Chem.HC / (ka.keV * 1000)).toFixed(ka.exact ? 5 : 3) + " nm  =  " + (Chem.HC / (ka.keV * 1000) * 10).toFixed(ka.exact ? 4 : 2) + " Å" + (ka.exact ? "  (tabulated)" : "  (estimate from Moseley's law, ±a few %)") : "No K lines for H, He or Li.", x + pad, yy, w - 2 * pad, px * 0.8);
    yy += px * 0.8;

    // Converter
    RM.text("Convert a wavelength", x + pad, yy, px * 0.75, { bold: true });
    yy += px * 0.6;
    var nm = st.conv, eV = Chem.HC / nm;
    RM.button(x + pad, yy, w * 0.3, px * 2, nm + " nm", function () {
      RM.prompt({ title: "Wavelength (nm)", value: String(st.conv), mode: "number" }, function (v) { var n = parseFloat(v); if (v !== null && n > 0) { st.conv = n; save(); } });
    }, { bold: true, px: px * 0.85 });
    RM.paragraph("= " + fmt(eV) + " eV  ·  " + fmt(299792.458 / nm) + " THz  ·  " + fmt(1e7 / nm) + " cm⁻¹  ·  " + fmt(nm * 10) + " Å  ·  " + Chem.regionOf(nm), x + pad + w * 0.32, yy + px * 0.2, w * 0.66 - pad, px * 0.8);
  }

  function fmt(v) { return Math.abs(v) >= 1e5 || Math.abs(v) < 1e-3 ? v.toExponential(4) : (+v.toPrecision(6)).toString(); }

  // ------------------------------------------------------------------
  function draw(ctx, W, H) {
    var m = Math.min(W, H);
    var items = [];
    if (st.tab === "Element") {
      items.push({ label: "◀ Prev", fn: function () { st.z = st.z > 1 ? st.z - 1 : 118; save(); } }, { label: "Next ▶", fn: function () { st.z = st.z < 118 ? st.z + 1 : 1; save(); } });
    }
    items.push({ label: "Search", fn: function () {
      RM.prompt({ title: "Element name, symbol or number" }, function (v) {
        if (!v) return;
        var q = v.trim().toLowerCase();
        var hit = Chem.EL.filter(function (e) { return e.sym.toLowerCase() === q || e.name.toLowerCase() === q || String(e.Z) === q; })[0] ||
          Chem.EL.filter(function (e) { return e.name.toLowerCase().indexOf(q) === 0; })[0];
        if (hit) { st.z = hit.Z; st.tab = "Element"; save(); } else RM.toast("No element matches \"" + v + "\".");
      });
    } });
    var toolH = RM.toolbar(items);
    var tabH = Math.round(Math.max(44, m * 0.07));
    RM.segmented(m * 0.015, m * 0.015, W - m * 0.03, tabH - m * 0.015, ["Table", "Element", "Reactions", "Spectra"], st.tab, function (t) { st.tab = t; save(); }, { px: tabH * 0.36 });
    var y = tabH + m * 0.02, h = H - toolH - y;
    if (st.tab === "Table") drawTable(ctx, 0, y, W, h);
    else if (st.tab === "Element") drawElement(ctx, 0, y, W, h);
    else if (st.tab === "Reactions") drawReactions(ctx, 0, y, W, h);
    else drawSpectra(ctx, 0, y, W, h);
  }

  RM.init({ draw: draw });
})();
