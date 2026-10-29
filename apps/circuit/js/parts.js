// Component library for the circuit editor: size (grid units), pins
// (grid points relative to the top-left, "in"/"out"/"io"), logic function
// (for simulated parts) and a drawing function in grid units.
var Parts = (function () {
  "use strict";

  // Drawing helpers take the context and a grid scale g; coordinates are
  // in grid units relative to the part's top-left corner.
  function L(c, g, pts, w) {
    c.beginPath();
    c.moveTo(pts[0][0] * g, pts[0][1] * g);
    for (var i = 1; i < pts.length; i++) c.lineTo(pts[i][0] * g, pts[i][1] * g);
    c.lineWidth = w || Math.max(1.5, g * 0.08);
    c.strokeStyle = "#000";
    c.stroke();
  }
  function circle(c, g, x, y, r, fill) {
    c.beginPath();
    c.arc(x * g, y * g, r * g, 0, Math.PI * 2);
    if (fill === true) { c.fillStyle = "#000"; c.fill(); }
    else { c.fillStyle = "#fff"; c.fill(); c.lineWidth = Math.max(1.5, g * 0.08); c.strokeStyle = "#000"; c.stroke(); }
  }
  function label(c, g, s, x, y, size, bold) {
    c.font = (bold ? "bold " : "") + Math.round(g * (size || 0.6)) + "px sans-serif";
    c.fillStyle = "#000";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(s, x * g, y * g);
  }
  function arrowHead(c, g, x1, y1, x2, y2, size) {
    var a = Math.atan2(y2 - y1, x2 - x1), s = size || 0.3;
    c.beginPath();
    c.moveTo(x2 * g, y2 * g);
    c.lineTo((x2 - s * Math.cos(a - 0.45)) * g, (y2 - s * Math.sin(a - 0.45)) * g);
    c.lineTo((x2 - s * Math.cos(a + 0.45)) * g, (y2 - s * Math.sin(a + 0.45)) * g);
    c.closePath();
    c.fillStyle = "#000";
    c.fill();
  }

  // Gate bodies span x 1..3, y 0..2; inputs at (0,0),(0,2) leads; output (4,1).
  function gateLeads(c, g, inputs, bubble) {
    if (inputs === 1) L(c, g, [[0, 1], [1, 1]]);
    else { L(c, g, [[0, 0], [1.2, 0], [1.2, 0.5]]); L(c, g, [[0, 2], [1.2, 2], [1.2, 1.5]]); }
    L(c, g, [[bubble ? 3.35 : 3, 1], [4, 1]]);
  }
  function andBody(c, g) {
    c.beginPath();
    c.moveTo(1.2 * g, 0.2 * g);
    c.lineTo(2 * g, 0.2 * g);
    c.arc(2 * g, 1 * g, 0.8 * g, -Math.PI / 2, Math.PI / 2);
    c.lineTo(1.2 * g, 1.8 * g);
    c.closePath();
    c.fillStyle = "#fff"; c.fill();
    c.lineWidth = Math.max(1.5, g * 0.08); c.strokeStyle = "#000"; c.stroke();
  }
  function orBody(c, g, xor) {
    c.beginPath();
    c.moveTo(1.1 * g, 0.2 * g);
    c.quadraticCurveTo(2.3 * g, 0.2 * g, 3 * g, 1 * g);
    c.quadraticCurveTo(2.3 * g, 1.8 * g, 1.1 * g, 1.8 * g);
    c.quadraticCurveTo(1.6 * g, 1 * g, 1.1 * g, 0.2 * g);
    c.closePath();
    c.fillStyle = "#fff"; c.fill();
    c.lineWidth = Math.max(1.5, g * 0.08); c.strokeStyle = "#000"; c.stroke();
    if (xor) {
      c.beginPath();
      c.moveTo(0.85 * g, 0.2 * g);
      c.quadraticCurveTo(1.35 * g, 1 * g, 0.85 * g, 1.8 * g);
      c.stroke();
    }
  }
  function notBody(c, g) {
    c.beginPath();
    c.moveTo(1.2 * g, 0.3 * g);
    c.lineTo(2.9 * g, 1 * g);
    c.lineTo(1.2 * g, 1.7 * g);
    c.closePath();
    c.fillStyle = "#fff"; c.fill();
    c.lineWidth = Math.max(1.5, g * 0.08); c.strokeStyle = "#000"; c.stroke();
  }

  var gate2 = [{ x: 0, y: 0, dir: "in" }, { x: 0, y: 2, dir: "in" }, { x: 4, y: 1, dir: "out" }];
  var gate1 = [{ x: 0, y: 1, dir: "in" }, { x: 4, y: 1, dir: "out" }];
  var two = function (w, h) { return [{ x: 0, y: h / 2, dir: "io" }, { x: w, y: h / 2, dir: "io" }]; };

  var P = {
    AND: { group: "Logic", w: 4, h: 2, pins: gate2, logic: function (a) { return a[0] & a[1]; }, draw: function (c, g) { gateLeads(c, g, 2); andBody(c, g); } },
    NAND: { group: "Logic", w: 4, h: 2, pins: gate2, logic: function (a) { return 1 - (a[0] & a[1]); }, draw: function (c, g) { gateLeads(c, g, 2, true); andBody(c, g); circle(c, g, 3.0, 1, 0.17); } },
    OR: { group: "Logic", w: 4, h: 2, pins: gate2, logic: function (a) { return a[0] | a[1]; }, draw: function (c, g) { gateLeads(c, g, 2); orBody(c, g); } },
    NOR: { group: "Logic", w: 4, h: 2, pins: gate2, logic: function (a) { return 1 - (a[0] | a[1]); }, draw: function (c, g) { gateLeads(c, g, 2, true); orBody(c, g); circle(c, g, 3.17, 1, 0.17); } },
    XOR: { group: "Logic", w: 4, h: 2, pins: gate2, logic: function (a) { return a[0] ^ a[1]; }, draw: function (c, g) { gateLeads(c, g, 2); orBody(c, g, true); } },
    XNOR: { group: "Logic", w: 4, h: 2, pins: gate2, logic: function (a) { return 1 - (a[0] ^ a[1]); }, draw: function (c, g) { gateLeads(c, g, 2, true); orBody(c, g, true); circle(c, g, 3.17, 1, 0.17); } },
    NOT: { group: "Logic", w: 4, h: 2, pins: gate1, logic: function (a) { return 1 - a[0]; }, draw: function (c, g) { gateLeads(c, g, 1, true); notBody(c, g); circle(c, g, 3.07, 1, 0.17); } },
    BUF: { group: "Logic", w: 4, h: 2, pins: gate1, logic: function (a) { return a[0]; }, draw: function (c, g) { gateLeads(c, g, 1); notBody(c, g); } },
    SWITCH: { group: "Logic I/O", w: 3, h: 2, pins: [{ x: 3, y: 1, dir: "out" }], source: true, label: "Input (tap to toggle)",
      draw: function (c, g, part) {
        c.lineWidth = Math.max(1.5, g * 0.08);
        c.strokeStyle = "#000";
        c.fillStyle = part.on ? "#000" : "#fff";
        c.fillRect(0.2 * g, 0.4 * g, 1.8 * g, 1.2 * g);
        c.strokeRect(0.2 * g, 0.4 * g, 1.8 * g, 1.2 * g);
        c.font = "bold " + Math.round(g * 0.8) + "px sans-serif";
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillStyle = part.on ? "#fff" : "#000";
        c.fillText(part.on ? "1" : "0", 1.1 * g, 1 * g);
        L(c, g, [[2, 1], [3, 1]]);
      } },
    HIGH: { group: "Logic I/O", w: 2, h: 2, pins: [{ x: 2, y: 1, dir: "out" }], source: true, constant: 1, draw: function (c, g) { label(c, g, "1", 0.8, 1, 0.9, true); c.strokeRect(0.25 * g, 0.4 * g, 1.1 * g, 1.2 * g); L(c, g, [[1.35, 1], [2, 1]]); } },
    LOW: { group: "Logic I/O", w: 2, h: 2, pins: [{ x: 2, y: 1, dir: "out" }], source: true, constant: 0, draw: function (c, g) { label(c, g, "0", 0.8, 1, 0.9, true); c.strokeRect(0.25 * g, 0.4 * g, 1.1 * g, 1.2 * g); L(c, g, [[1.35, 1], [2, 1]]); } },
    LAMP_LOGIC: { group: "Logic I/O", w: 3, h: 2, pins: [{ x: 0, y: 1, dir: "in" }], sink: true, label: "Output LED",
      draw: function (c, g, part, value) {
        L(c, g, [[0, 1], [1.2, 1]]);
        circle(c, g, 1.9, 1, 0.7, value === 1);
        if (value === 1) for (var k = 0; k < 8; k++) { var a = k * Math.PI / 4; L(c, g, [[1.9 + Math.cos(a) * 0.8, 1 + Math.sin(a) * 0.8], [1.9 + Math.cos(a) * 1.0, 1 + Math.sin(a) * 1.0]]); }
      } },
    PROBE: { group: "Logic I/O", w: 2, h: 2, pins: [{ x: 0, y: 1, dir: "in" }], sink: true, label: "Probe (shows 0/1)",
      draw: function (c, g, part, value) { L(c, g, [[0, 1], [0.6, 1]]); c.strokeRect(0.6 * g, 0.4 * g, 1.2 * g, 1.2 * g); label(c, g, value === 1 ? "1" : value === 0 ? "0" : "?", 1.2, 1, 0.8, true); } },

    RESISTOR: { group: "Passive", w: 4, h: 2, pins: two(4, 2), draw: function (c, g) {
      var pts = [[0, 1], [1, 1]];
      for (var i = 0; i < 6; i++) pts.push([1.17 + i * 0.33, i % 2 ? 1.35 : 0.65]);
      pts.push([3, 1], [4, 1]);
      L(c, g, pts);
    } },
    CAPACITOR: { group: "Passive", w: 4, h: 2, pins: two(4, 2), draw: function (c, g) { L(c, g, [[0, 1], [1.8, 1]]); L(c, g, [[2.2, 1], [4, 1]]); L(c, g, [[1.8, 0.3], [1.8, 1.7]], g * 0.14); L(c, g, [[2.2, 0.3], [2.2, 1.7]], g * 0.14); } },
    INDUCTOR: { group: "Passive", w: 4, h: 2, pins: two(4, 2), draw: function (c, g) {
      L(c, g, [[0, 1], [0.8, 1]]); L(c, g, [[3.2, 1], [4, 1]]);
      for (var i = 0; i < 4; i++) { c.beginPath(); c.arc((1.1 + i * 0.6) * g, 1 * g, 0.3 * g, Math.PI, 0); c.lineWidth = Math.max(1.5, g * 0.08); c.stroke(); }
    } },
    DIODE: { group: "Semiconductor", w: 4, h: 2, pins: [{ x: 0, y: 1, dir: "io" }, { x: 4, y: 1, dir: "io" }], draw: function (c, g) {
      L(c, g, [[0, 1], [1.4, 1]]); L(c, g, [[2.6, 1], [4, 1]]);
      c.beginPath(); c.moveTo(1.4 * g, 0.4 * g); c.lineTo(2.5 * g, 1 * g); c.lineTo(1.4 * g, 1.6 * g); c.closePath(); c.fillStyle = "#000"; c.fill();
      L(c, g, [[2.55, 0.4], [2.55, 1.6]], g * 0.12);
    } },
    LED: { group: "Semiconductor", w: 4, h: 2, pins: [{ x: 0, y: 1, dir: "io" }, { x: 4, y: 1, dir: "io" }], draw: function (c, g) {
      P.DIODE.draw(c, g);
      L(c, g, [[2.0, 0.35], [2.5, -0.15]]); arrowHead(c, g, 2.0, 0.35, 2.55, -0.2, 0.25);
      L(c, g, [[2.4, 0.5], [2.9, 0.0]]); arrowHead(c, g, 2.4, 0.5, 2.95, -0.05, 0.25);
    } },
    ZENER: { group: "Semiconductor", w: 4, h: 2, pins: [{ x: 0, y: 1, dir: "io" }, { x: 4, y: 1, dir: "io" }], draw: function (c, g) {
      P.DIODE.draw(c, g);
      L(c, g, [[2.3, 0.4], [2.55, 0.4], [2.55, 1.6], [2.8, 1.6]], g * 0.12);
    } },
    NPN: { group: "Semiconductor", w: 3, h: 4, pins: [{ x: 0, y: 2, dir: "io", name: "B" }, { x: 3, y: 0, dir: "io", name: "C" }, { x: 3, y: 4, dir: "io", name: "E" }], draw: function (c, g) { bjt(c, g, true); } },
    PNP: { group: "Semiconductor", w: 3, h: 4, pins: [{ x: 0, y: 2, dir: "io", name: "B" }, { x: 3, y: 0, dir: "io", name: "E" }, { x: 3, y: 4, dir: "io", name: "C" }], draw: function (c, g) { bjt(c, g, false); } },
    NMOS: { group: "Semiconductor", w: 3, h: 4, pins: [{ x: 0, y: 2, dir: "io", name: "G" }, { x: 3, y: 0, dir: "io", name: "D" }, { x: 3, y: 4, dir: "io", name: "S" }], draw: function (c, g) { mos(c, g, true); } },
    PMOS: { group: "Semiconductor", w: 3, h: 4, pins: [{ x: 0, y: 2, dir: "io", name: "G" }, { x: 3, y: 0, dir: "io", name: "S" }, { x: 3, y: 4, dir: "io", name: "D" }], draw: function (c, g) { mos(c, g, false); } },
    PTYPE: { group: "Semiconductor", w: 3, h: 2, pins: two(3, 2), label: "P-type region", draw: function (c, g) { region(c, g, true); } },
    NTYPE: { group: "Semiconductor", w: 3, h: 2, pins: two(3, 2), label: "N-type region", draw: function (c, g) { region(c, g, false); } },
    OPAMP: { group: "Semiconductor", w: 4, h: 4, pins: [{ x: 0, y: 1, dir: "io", name: "−" }, { x: 0, y: 3, dir: "io", name: "+" }, { x: 4, y: 2, dir: "io", name: "out" }], draw: function (c, g) {
      L(c, g, [[0, 1], [0.8, 1]]); L(c, g, [[0, 3], [0.8, 3]]); L(c, g, [[3.4, 2], [4, 2]]);
      c.beginPath(); c.moveTo(0.8 * g, 0.2 * g); c.lineTo(3.4 * g, 2 * g); c.lineTo(0.8 * g, 3.8 * g); c.closePath();
      c.fillStyle = "#fff"; c.fill(); c.lineWidth = Math.max(1.5, g * 0.08); c.stroke();
      label(c, g, "−", 1.2, 1, 0.7, true); label(c, g, "+", 1.2, 3, 0.7, true);
    } },
    BATTERY: { group: "Power", w: 4, h: 2, pins: [{ x: 0, y: 1, dir: "io", name: "+" }, { x: 4, y: 1, dir: "io", name: "−" }], draw: function (c, g) {
      L(c, g, [[0, 1], [1.7, 1]]); L(c, g, [[2.3, 1], [4, 1]]);
      L(c, g, [[1.7, 0.2], [1.7, 1.8]]); L(c, g, [[2.3, 0.6], [2.3, 1.4]], g * 0.16);
      label(c, g, "+", 1.2, 0.4, 0.5, true);
    } },
    GROUND: { group: "Power", w: 2, h: 2, pins: [{ x: 1, y: 0, dir: "io" }], draw: function (c, g) { L(c, g, [[1, 0], [1, 0.9]]); L(c, g, [[0.3, 0.9], [1.7, 0.9]]); L(c, g, [[0.55, 1.25], [1.45, 1.25]]); L(c, g, [[0.8, 1.6], [1.2, 1.6]]); } },
    VCC: { group: "Power", w: 2, h: 2, pins: [{ x: 1, y: 2, dir: "io" }], draw: function (c, g) { L(c, g, [[1, 2], [1, 0.7]]); L(c, g, [[0.4, 0.7], [1.6, 0.7]]); label(c, g, "Vcc", 1, 0.25, 0.45, true); } },
    SPST: { group: "Power", w: 4, h: 2, pins: two(4, 2), label: "Switch", draw: function (c, g, part) {
      L(c, g, [[0, 1], [1.2, 1]]); L(c, g, [[2.8, 1], [4, 1]]);
      circle(c, g, 1.2, 1, 0.12, true); circle(c, g, 2.8, 1, 0.12, true);
      L(c, g, part.on ? [[1.2, 1], [2.8, 1]] : [[1.2, 1], [2.6, 0.3]]);
    } },
    LAMP: { group: "Power", w: 4, h: 2, pins: two(4, 2), draw: function (c, g) { L(c, g, [[0, 1], [1.3, 1]]); L(c, g, [[2.7, 1], [4, 1]]); circle(c, g, 2, 1, 0.7); L(c, g, [[1.5, 0.5], [2.5, 1.5]]); L(c, g, [[2.5, 0.5], [1.5, 1.5]]); } },
    DOT: { group: "Wiring", w: 0, h: 0, pins: [{ x: 0, y: 0, dir: "io" }], label: "Junction", draw: function (c, g) { circle(c, g, 0, 0, 0.18, true); } },
    TEXT: { group: "Wiring", w: 4, h: 1, pins: [], label: "Text label", draw: function (c, g, part) { label(c, g, part.text || "Label", 2, 0.5, 0.6, true); } }
  };

  function bjt(c, g, npn) {
    L(c, g, [[0, 2], [1.2, 2]]);
    L(c, g, [[1.2, 1.2], [1.2, 2.8]], g * 0.14);
    L(c, g, [[1.2, 1.6], [3, 0.5], [3, 0]]);
    L(c, g, [[1.2, 2.4], [3, 3.5], [3, 4]]);
    if (npn) arrowHead(c, g, 1.2, 2.4, 2.4, 3.15, 0.4);
    else arrowHead(c, g, 2.6, 0.75, 1.35, 1.5, 0.4);
    c.beginPath(); c.arc(1.9 * g, 2 * g, 1.25 * g, 0, Math.PI * 2); c.lineWidth = Math.max(1.2, g * 0.06); c.stroke();
  }

  function mos(c, g, n) {
    L(c, g, [[0, 2], [1.0, 2]]);
    L(c, g, [[1.0, 1.2], [1.0, 2.8]]);
    L(c, g, [[1.35, 1.0], [1.35, 1.5]], g * 0.12); L(c, g, [[1.35, 1.75], [1.35, 2.25]], g * 0.12); L(c, g, [[1.35, 2.5], [1.35, 3.0]], g * 0.12);
    L(c, g, [[1.35, 1.25], [3, 1.25], [3, 0]]);
    L(c, g, [[1.35, 2.75], [3, 2.75], [3, 4]]);
    L(c, g, [[1.35, 2], [3, 2], [3, 2.75]]);
    if (n) arrowHead(c, g, 2.4, 2, 1.45, 2, 0.35); else arrowHead(c, g, 1.45, 2, 2.4, 2, 0.35);
    if (!n) circle(c, g, 0.85, 2, 0.15);
  }

  function region(c, g, p) {
    c.lineWidth = Math.max(1.5, g * 0.08);
    c.strokeStyle = "#000";
    c.fillStyle = "#fff";
    c.fillRect(0.3 * g, 0.2 * g, 2.4 * g, 1.6 * g);
    c.strokeRect(0.3 * g, 0.2 * g, 2.4 * g, 1.6 * g);
    L(c, g, [[0, 1], [0.3, 1]]); L(c, g, [[2.7, 1], [3, 1]]);
    label(c, g, p ? "P" : "N", 1.5, 0.75, 0.6, true);
    // Majority carriers: holes (+) for P, electrons (−) for N.
    for (var i = 0; i < 4; i++) label(c, g, p ? "+" : "−", 0.75 + i * 0.5, 1.4, 0.4, true);
  }

  return { P: P, label: label };
})();
