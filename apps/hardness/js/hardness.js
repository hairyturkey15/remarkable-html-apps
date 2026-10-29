// Mohs hardness explorer: the scale, a materials list, scale converters
// and temperature notes (data in data.js).
(function () {
  "use strict";

  var st = Object.assign({ tab: "Scale", cat: "All", sort: "hardness", page: 0, conv: { scale: "Mohs", value: 7 }, query: "" }, RM.load("hardness.state", {}));
  function save() { RM.store("hardness.state", st); }

  var CATS = ["All"].concat(MATERIALS.map(function (m) { return m[1]; }).filter(function (c, i, a) { return a.indexOf(c) === i; }));

  function mohsText(m) { return m[2] === m[3] ? String(m[2]) : m[2] + "–" + m[3]; }

  // --- Interpolation helpers ------------------------------------------------
  function interp(table, xi, yi, x, logY) {
    var rows = table.filter(function (r) { return r[xi] !== null && r[yi] !== null; });
    rows.sort(function (a, b) { return a[xi] - b[xi]; });
    if (x < rows[0][xi] || x > rows[rows.length - 1][xi]) return null;
    for (var i = 1; i < rows.length; i++) {
      if (x <= rows[i][xi]) {
        var a = rows[i - 1], b = rows[i], t = (x - a[xi]) / (b[xi] - a[xi] || 1);
        if (logY) return Math.exp(Math.log(a[yi]) + t * (Math.log(b[yi]) - Math.log(a[yi])));
        return a[yi] + t * (b[yi] - a[yi]);
      }
    }
    return rows[rows.length - 1][yi];
  }

  // Everything converts through Vickers (HV), except Shore A/D.
  var SCALES = ["Mohs", "Vickers HV", "Knoop HK", "Rockwell C", "Rockwell B", "Brinell HB", "Shore A", "Shore D"];

  function toHV(scale, v) {
    switch (scale) {
      case "Mohs": return interp(MOHS_REF, 0, 2, v, true);
      case "Vickers HV": return v;
      case "Knoop HK": return interp(MOHS_REF.map(function (r) { return [r[1], r[2]]; }), 0, 1, v, true);
      case "Rockwell C": return interp(STEEL_TABLE, 0, 1, v);
      case "Rockwell B": return interp(HRB_TABLE, 0, 1, v);
      case "Brinell HB": return interp(STEEL_TABLE.concat(HRB_TABLE.map(function (r) { return [null, r[1], r[2]]; })), 2, 1, v);
    }
    return null;
  }

  function fromHV(scale, hv) {
    switch (scale) {
      case "Mohs": return interp(MOHS_REF, 2, 0, hv);
      case "Vickers HV": return hv;
      case "Knoop HK": return interp(MOHS_REF.map(function (r) { return [r[1], r[2]]; }), 1, 0, hv, true);
      case "Rockwell C": return interp(STEEL_TABLE, 1, 0, hv);
      case "Rockwell B": return interp(HRB_TABLE, 1, 0, hv);
      case "Brinell HB": return interp(STEEL_TABLE.concat(HRB_TABLE.map(function (r) { return [null, r[1], r[2]]; })), 1, 2, hv);
    }
    return null;
  }

  function fmt(v, d) { return v === null || v === undefined || isNaN(v) ? "—" : (+v.toFixed(d === undefined ? 1 : d)).toString(); }

  // --- Scale tab ------------------------------------------------------------------
  function drawScale(ctx, x, y, w, h) {
    var m = Math.min(RM.W, RM.H), pad = m * 0.04, px = Math.min(m * 0.03, 23);
    RM.text("Mohs scale: each mineral scratches the ones below it", x + pad, y + px, px, { bold: true });
    var top = y + px * 2.5, bottom = y + h - px * 6.5, bx = x + w * 0.42;
    var yFor = function (mohs) { return bottom - (mohs / 10) * (bottom - top); };
    RM.line(bx, top, bx, bottom, 4);
    var refs = MATERIALS.filter(function (r) { return r[1] === "Mohs reference"; });
    refs.forEach(function (r) {
      var yy = yFor(r[2]);
      RM.line(bx - 12, yy, bx + 12, yy, 3);
      RM.text(String(r[2]), bx - 22, yy, px * 1.1, { align: "right", bold: true });
      RM.text(r[0], bx + 22, yy - px * 0.35, px * 0.95, { bold: true });
      RM.text("HV ≈ " + r[4] + "  ·  " + r[5], bx + 22, yy + px * 0.6, RM.fitPx("HV ≈ " + r[4] + "  ·  " + r[5], w - bx - 30, px * 0.62), {});
    });
    // Everyday tests on the left
    var tests = MATERIALS.filter(function (r) { return r[1] === "Everyday tests"; });
    tests.forEach(function (r, i) {
      var yy = yFor((r[2] + r[3]) / 2) + (i % 2 ? px * 0.6 : -px * 0.2);
      RM.text(r[0] + " " + mohsText(r) + " —", bx - px * 2.4, yy, RM.fitPx(r[0] + " " + mohsText(r) + " —", bx - px * 3, px * 0.68), { align: "right" });
    });
    RM.paragraph("Mohs is a ranking, not a measurement: corundum (9) is about twice as hard as topaz (8) in indentation tests, and diamond (10) about four times corundum. Use the Convert tab for indentation scales.",
      x + pad, bottom + px * 1.2, w - 2 * pad, px * 0.75);
  }

  // --- Materials tab ---------------------------------------------------------------
  function drawMaterials(ctx, x, y, w, h) {
    var m = Math.min(RM.W, RM.H), pad = m * 0.025, px = Math.min(m * 0.027, 21), rowH = px * 2.6;
    RM.button(x + pad, y, w * 0.42, px * 2, "Category: " + st.cat + " ▾", function () {
      RM.choose("Category", CATS, function (c) { if (c) { st.cat = c; st.page = 0; save(); } }, { current: st.cat });
    }, { px: px * 0.8, bold: true });
    RM.button(x + pad + w * 0.44, y, w * 0.24, px * 2, "Sort: " + (st.sort === "hardness" ? "hardness" : "name"), function () {
      st.sort = st.sort === "hardness" ? "name" : "hardness"; save();
    }, { px: px * 0.8 });
    RM.button(x + pad + w * 0.7, y, w * 0.3 - 2 * pad, px * 2, st.query ? "“" + st.query + "” ✕" : "Search", function () {
      if (st.query) { st.query = ""; st.page = 0; save(); return; }
      RM.prompt({ title: "Search materials" }, function (v) { if (v !== null) { st.query = v.trim(); st.page = 0; save(); } });
    }, { px: px * 0.8 });
    var list = MATERIALS.filter(function (r) {
      return (st.cat === "All" || r[1] === st.cat) && (!st.query || (r[0] + " " + r[5] + " " + r[1]).toLowerCase().indexOf(st.query.toLowerCase()) >= 0);
    });
    list.sort(st.sort === "hardness" ? function (a, b) { return a[2] - b[2] || a[3] - b[3]; } : function (a, b) { return a[0].localeCompare(b[0]); });
    var ly = y + px * 2.6, per = Math.max(1, Math.floor((y + h - ly - px * 2.6) / rowH)), pages = Math.max(1, Math.ceil(list.length / per));
    st.page = Math.min(st.page, pages - 1);
    list.slice(st.page * per, (st.page + 1) * per).forEach(function (r, i) {
      var yy = ly + i * rowH, barW = w * 0.22;
      RM.text(r[0], x + pad, yy + px * 0.75, RM.fitPx(r[0], w * 0.55, px * 0.95, true), { bold: true });
      var detail = (st.cat === "All" ? r[1] + " · " : "") + (r[4] ? "HV ≈ " + r[4] + " · " : "") + r[5];
      RM.text(detail, x + pad, yy + px * 1.85, RM.fitPx(detail, w * 0.66, px * 0.7), {});
      // Hardness bar: range on a 0–10 track.
      var bx = x + w - pad - barW, by = yy + px * 0.55;
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#000";
      ctx.strokeRect(bx, by, barW, px * 0.5);
      ctx.fillStyle = "#000";
      ctx.fillRect(bx + barW * r[2] / 10, by, Math.max(3, barW * (r[3] - r[2]) / 10), px * 0.5);
      RM.text(mohsText(r), bx - 8, by + px * 0.25, px * 0.95, { align: "right", bold: true });
      RM.line(x + pad, yy + rowH - 2, x + w - pad, yy + rowH - 2, 1, "#c8c8c8");
      RM.hit(x, yy, w, rowH, function () {
        RM.showText(r[0], "Category: " + r[1] + "\nMohs: " + mohsText(r) + (r[4] ? "\nVickers (typical): HV " + r[4] + " ≈ " + (r[4] * 0.0098).toFixed(1) + " GPa" : "") +
          "\n\n" + (r[5] || "") + "\n\nApprox. on other scales (from the Mohs value): Knoop ≈ " + fmt(interp(MOHS_REF, 0, 1, (r[2] + r[3]) / 2, true), 0) + ", Vickers ≈ " + fmt(interp(MOHS_REF, 0, 2, (r[2] + r[3]) / 2, true), 0) + ". These are rough: real values depend on the specific sample, load and direction.");
      });
    });
    if (pages > 1) {
      var py = y + h - px * 2.2;
      RM.button(x + pad, py, w * 0.25, px * 2, "◀ Prev", function () { st.page = Math.max(0, st.page - 1); save(); }, { px: px * 0.8 });
      RM.text((st.page + 1) + " / " + pages + "  (" + list.length + " materials)", x + w / 2, py + px, px * 0.8, { align: "center" });
      RM.button(x + w - pad - w * 0.25, py, w * 0.25, px * 2, "Next ▶", function () { st.page = Math.min(pages - 1, st.page + 1); save(); }, { px: px * 0.8 });
    }
  }

  // --- Converter tab ------------------------------------------------------------------
  function drawConvert(ctx, x, y, w, h) {
    var m = Math.min(RM.W, RM.H), pad = m * 0.03, px = Math.min(m * 0.03, 23), c = st.conv;
    RM.text("Convert from", x + pad, y + px * 0.8, px, { bold: true });
    var bw = (w - 2 * pad) / 4;
    SCALES.forEach(function (s, i) {
      RM.button(x + pad + (i % 4) * bw + 2, y + px * 1.8 + Math.floor(i / 4) * px * 2.3, bw - 4, px * 2, s, function () { c.scale = s; save(); }, { active: c.scale === s, px: px * 0.75 });
    });
    var vy = y + px * 6.8;
    RM.text("Value", x + pad, vy + px, px * 0.9, {});
    RM.button(x + pad + w * 0.18, vy, w * 0.35, px * 2.1, fmt(c.value, 2) + "  " + c.scale, function () {
      RM.prompt({ title: c.scale + " value", value: String(c.value), mode: "number" }, function (v) { var n = parseFloat(v); if (v !== null && !isNaN(n)) { c.value = n; save(); } });
    }, { bold: true, px: px * 0.9 });
    var ry = vy + px * 3.2, lines = [];
    if (c.scale === "Shore A" || c.scale === "Shore D") {
      var other = c.scale === "Shore A" ? interp(SHORE_AD, 0, 1, c.value) : interp(SHORE_AD, 1, 0, c.value);
      lines.push([c.scale === "Shore A" ? "Shore D" : "Shore A", fmt(other, 0)]);
      lines.push(["Note", "Shore durometers measure elastomers and plastics by indentation depth. A↔D is an empirical approximation, and Shore values don't map onto Mohs or metal scales: even Shore D 90 plastics scratch at roughly Mohs 2–3."]);
    } else {
      var hv = toHV(c.scale, c.value);
      if (hv === null) {
        lines.push(["Out of range", "That value is outside the conversion tables for " + c.scale + "."]);
      } else {
        SCALES.slice(0, 6).forEach(function (s) {
          if (s === c.scale) return;
          var v = fromHV(s, hv);
          lines.push([s, v === null ? "outside table range" : fmt(v, s === "Mohs" ? 1 : 0)]);
        });
        lines.push(["Vickers in GPa", fmt(hv * 0.0098, 2)]);
        var hb = fromHV("Brinell HB", hv);
        if (hb !== null) lines.push(["Tensile strength (steel)", "≈ " + fmt(3.45 * hb, 0) + " MPa (rule of thumb: 3.45 × HB)"]);
        lines.push(["Note", "Rockwell and Brinell use ASTM E140-style values for carbon/alloy steels; Mohs/Knoop links use mineral reference points. All conversions are approximate: they depend on the material, and Mohs is a ranking, not a measurement."]);
      }
    }
    lines.forEach(function (l) {
      if (l[0] === "Note" || l[0] === "Out of range") {
        ry += px * 0.6;
        ry += RM.paragraph(l[0] + ": " + l[1], x + pad, ry, w - 2 * pad, px * 0.75);
        return;
      }
      RM.text(l[0], x + pad, ry + px * 0.7, px * 0.9, {});
      RM.text(l[1], x + w - pad, ry + px * 0.7, px * 1.05, { align: "right", bold: true });
      RM.line(x + pad, ry + px * 1.5, x + w - pad, ry + px * 1.5, 1, "#c8c8c8");
      ry += px * 1.8;
    });
  }

  // --- Temperature tab ------------------------------------------------------------------
  function drawTemperature(ctx, x, y, w, h) {
    var m = Math.min(RM.W, RM.H), pad = m * 0.03, px = Math.min(m * 0.028, 22), yy = y + pad * 0.5;
    RM.text("Hardness changes with temperature", x + pad, yy + px * 0.6, px * 1.1, { bold: true });
    yy += px * 1.8;
    // Ice chart (approximate Mohs vs temperature).
    var cw = w - 2 * pad, ch = Math.min(h * 0.22, px * 9), cx = x + pad, cy = yy;
    var pts = [[0, 1.75], [-10, 2.5], [-20, 3.2], [-40, 4], [-60, 5], [-78, 6]];
    var X = function (t) { return cx + 40 + (t + 80) / 80 * (cw - 50); }, Y = function (mh) { return cy + ch - mh / 7 * ch; };
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#000";
    ctx.strokeRect(cx + 40, cy, cw - 50, ch);
    ctx.beginPath();
    pts.forEach(function (p, i) { if (i) ctx.lineTo(X(p[0]), Y(p[1])); else ctx.moveTo(X(p[0]), Y(p[1])); });
    ctx.lineWidth = 3;
    ctx.stroke();
    pts.forEach(function (p) { ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), 4, 0, Math.PI * 2); ctx.fillStyle = "#000"; ctx.fill(); });
    [-80, -60, -40, -20, 0].forEach(function (t) { RM.text(t + " °C", X(t), cy + ch + 14, 12, { align: "center" }); });
    [0, 2, 4, 6].forEach(function (mh) { RM.text(String(mh), cx + 32, Y(mh), 12, { align: "right" }); });
    RM.text("Ice: Mohs vs temperature (approximate)", cx + 48, cy + 14, px * 0.7, { bold: true });
    yy += ch + px * 1.6;
    TEMPERATURE_NOTES.forEach(function (n) {
      if (yy > y + h - px * 2) return;
      RM.text(n[0], x + pad, yy + px * 0.5, px * 0.85, { bold: true });
      yy += px * 1.1;
      yy += RM.paragraph(n[1], x + pad, yy, w - 2 * pad, px * 0.75) + px * 0.3;
    });
  }

  function draw(ctx, W, H) {
    var m = Math.min(W, H);
    var toolH = RM.toolbar([]);
    var tabH = Math.round(Math.max(44, m * 0.07));
    RM.segmented(m * 0.015, m * 0.015, W - m * 0.03, tabH - m * 0.015, ["Scale", "Materials", "Convert", "Temperature"], st.tab, function (t) { st.tab = t; save(); }, { px: tabH * 0.36 });
    var y = tabH + m * 0.025, h = H - toolH - y - m * 0.01;
    if (st.tab === "Scale") drawScale(ctx, 0, y, W, h);
    else if (st.tab === "Materials") drawMaterials(ctx, 0, y, W, h);
    else if (st.tab === "Convert") drawConvert(ctx, 0, y, W, h);
    else drawTemperature(ctx, 0, y, W, h);
  }

  RM.init({ draw: draw });
})();
