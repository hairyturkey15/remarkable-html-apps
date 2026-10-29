// Unit tables (factor = value of 1 unit in the category's SI base unit)
// and a table of everyday engineering formulas.
var UnitData = (function () {
  "use strict";

  var CATEGORIES = {
    Length: { base: "m", units: [["nm", 1e-9], ["µm", 1e-6], ["mm", 1e-3], ["cm", 0.01], ["m", 1], ["km", 1000], ["mil (thou)", 2.54e-5], ["in", 0.0254], ["ft", 0.3048], ["yd", 0.9144], ["mi", 1609.344], ["nmi", 1852], ["au", 1.495978707e11], ["light-year", 9.4607304725808e15]] },
    Area: { base: "m²", units: [["mm²", 1e-6], ["cm²", 1e-4], ["m²", 1], ["ha", 1e4], ["km²", 1e6], ["in²", 6.4516e-4], ["ft²", 0.09290304], ["yd²", 0.83612736], ["acre", 4046.8564224], ["mi²", 2589988.110336]] },
    Volume: { base: "m³", units: [["mL (cm³)", 1e-6], ["L", 1e-3], ["m³", 1], ["tsp (US)", 4.92892159375e-6], ["tbsp (US)", 1.478676478125e-5], ["fl oz (US)", 2.95735295625e-5], ["cup (US)", 2.365882365e-4], ["pint (US)", 4.73176473e-4], ["quart (US)", 9.46352946e-4], ["gal (US)", 3.785411784e-3], ["gal (UK)", 4.54609e-3], ["in³", 1.6387064e-5], ["ft³", 0.028316846592], ["yd³", 0.764554857984], ["barrel (oil)", 0.158987294928]] },
    Mass: { base: "kg", units: [["mg", 1e-6], ["g", 1e-3], ["kg", 1], ["tonne", 1000], ["grain", 6.479891e-5], ["carat", 2e-4], ["oz", 0.028349523125], ["lb", 0.45359237], ["stone", 6.35029318], ["short ton", 907.18474], ["long ton", 1016.0469088]] },
    Time: { base: "s", units: [["ns", 1e-9], ["µs", 1e-6], ["ms", 1e-3], ["s", 1], ["min", 60], ["h", 3600], ["day", 86400], ["week", 604800], ["year (365.25 d)", 31557600]] },
    Speed: { base: "m/s", units: [["m/s", 1], ["km/h", 1 / 3.6], ["mph", 0.44704], ["ft/s", 0.3048], ["knot", 1852 / 3600], ["mach (15 °C, sea level)", 340.29]] },
    Pressure: { base: "Pa", units: [["Pa", 1], ["kPa", 1e3], ["MPa", 1e6], ["bar", 1e5], ["mbar", 100], ["atm", 101325], ["psi", 6894.757293168], ["ksi", 6894757.293168], ["mmHg", 133.322387415], ["torr", 101325 / 760], ["inHg", 3386.389], ["inH₂O (4 °C)", 249.08891], ["ftH₂O (4 °C)", 2989.06692], ["mH₂O (4 °C)", 9806.38]] },
    Energy: { base: "J", units: [["J", 1], ["kJ", 1e3], ["MJ", 1e6], ["Wh", 3600], ["kWh", 3.6e6], ["cal", 4.184], ["kcal", 4184], ["BTU", 1055.05585262], ["therm", 105480400], ["ft·lbf", 1.3558179483314004], ["eV", 1.602176634e-19], ["erg", 1e-7]] },
    Power: { base: "W", units: [["W", 1], ["kW", 1e3], ["MW", 1e6], ["hp (mechanical)", 745.69987158227022], ["hp (metric)", 735.49875], ["BTU/h", 0.29307107017], ["ft·lbf/s", 1.3558179483314004], ["ton (refrigeration)", 3516.8528420667]] },
    Force: { base: "N", units: [["N", 1], ["kN", 1e3], ["lbf", 4.4482216152605], ["kgf", 9.80665], ["dyn", 1e-5]] },
    Torque: { base: "N·m", units: [["N·m", 1], ["kN·m", 1e3], ["lbf·ft", 1.3558179483314004], ["lbf·in", 0.1129848290276167], ["kgf·m", 9.80665]] },
    Temperature: { base: "K", units: [["°C"], ["°F"], ["K"], ["°R"]] },
    Density: { base: "kg/m³", units: [["kg/m³", 1], ["g/cm³", 1000], ["g/L", 1], ["lb/ft³", 16.018463373960138], ["lb/in³", 27679.904710203125], ["lb/gal (US)", 119.82642731689663]] },
    "Flow rate": { base: "m³/s", units: [["m³/s", 1], ["m³/h", 1 / 3600], ["L/s", 1e-3], ["L/min", 1e-3 / 60], ["gal/min (US)", 3.785411784e-3 / 60], ["ft³/min (CFM)", 0.028316846592 / 60]] },
    Angle: { base: "rad", units: [["rad", 1], ["degree", Math.PI / 180], ["arcminute", Math.PI / 10800], ["arcsecond", Math.PI / 648000], ["gradian", Math.PI / 200], ["turn", 2 * Math.PI]] },
    Data: { base: "byte", units: [["bit", 0.125], ["byte", 1], ["kB", 1e3], ["KiB", 1024], ["MB", 1e6], ["MiB", 1048576], ["GB", 1e9], ["GiB", 1073741824], ["TB", 1e12], ["TiB", 1099511627776]] }
  };

  function toK(v, u) {
    if (u === "°C") return v + 273.15;
    if (u === "°F") return (v - 32) * 5 / 9 + 273.15;
    if (u === "°R") return v * 5 / 9;
    return v;
  }
  function fromK(k, u) {
    if (u === "°C") return k - 273.15;
    if (u === "°F") return (k - 273.15) * 9 / 5 + 32;
    if (u === "°R") return k * 9 / 5;
    return k;
  }

  function convert(category, value, from, to) {
    var cat = CATEGORIES[category];
    if (category === "Temperature") return fromK(toK(value, from), to);
    var f = cat.units.filter(function (u) { return u[0] === from; })[0][1];
    var t = cat.units.filter(function (u) { return u[0] === to; })[0][1];
    return value * f / t;
  }

  // Formulas: inputs with defaults; outputs computed from them.
  var G = 9.80665, PI = Math.PI;
  var FORMULAS = [
    { name: "Circle from diameter", text: "A = π d² / 4,  C = π d", inputs: [["d", "Diameter", 10]],
      outputs: [["Area", function (v) { return PI * v.d * v.d / 4; }], ["Circumference", function (v) { return PI * v.d; }], ["Radius", function (v) { return v.d / 2; }]] },
    { name: "Circle from radius", text: "A = π r²,  C = 2 π r", inputs: [["r", "Radius", 5]],
      outputs: [["Area", function (v) { return PI * v.r * v.r; }], ["Circumference", function (v) { return 2 * PI * v.r; }], ["Diameter", function (v) { return 2 * v.r; }]] },
    { name: "Head pressure (any fluid)", text: "P = ρ g h", inputs: [["h", "Head height (m)", 10], ["rho", "Density (kg/m³)", 1000]],
      outputs: [["Pressure (Pa)", function (v) { return v.rho * G * v.h; }], ["Pressure (kPa)", function (v) { return v.rho * G * v.h / 1000; }], ["Pressure (psi)", function (v) { return v.rho * G * v.h / 6894.757293168; }], ["Pressure (bar)", function (v) { return v.rho * G * v.h / 1e5; }]] },
    { name: "Head pressure (water, feet)", text: "psi ≈ 0.4335 × ft of water (4 °C)", inputs: [["ft", "Head (ft)", 100]],
      outputs: [["Pressure (psi)", function (v) { return v.ft * 0.3048 * 999.97 * G / 6894.757293168; }], ["Pressure (kPa)", function (v) { return v.ft * 0.3048 * 999.97 * G / 1000; }]] },
    { name: "Head from pressure (water)", text: "h = P / (ρ g)", inputs: [["psi", "Pressure (psi)", 50]],
      outputs: [["Head (ft)", function (v) { return v.psi * 6894.757293168 / (999.97 * G) / 0.3048; }], ["Head (m)", function (v) { return v.psi * 6894.757293168 / (999.97 * G); }]] },
    { name: "Pipe flow", text: "Q = A v,  A = π d² / 4", inputs: [["d", "Inner diameter (mm)", 50], ["vel", "Velocity (m/s)", 2]],
      outputs: [["Flow (L/s)", function (v) { return PI * Math.pow(v.d / 1000, 2) / 4 * v.vel * 1000; }], ["Flow (m³/h)", function (v) { return PI * Math.pow(v.d / 1000, 2) / 4 * v.vel * 3600; }], ["Flow (US gpm)", function (v) { return PI * Math.pow(v.d / 1000, 2) / 4 * v.vel / (3.785411784e-3 / 60); }]] },
    { name: "Hydraulic cylinder force", text: "F = P × π d² / 4", inputs: [["bore", "Bore (in)", 3], ["psi", "Pressure (psi)", 2000]],
      outputs: [["Force (lbf)", function (v) { return v.psi * PI * v.bore * v.bore / 4; }], ["Force (kN)", function (v) { return v.psi * PI * v.bore * v.bore / 4 * 4.4482216152605 / 1000; }]] },
    { name: "Ohm's law", text: "V = I R,  P = V I", inputs: [["I", "Current (A)", 2], ["R", "Resistance (Ω)", 10]],
      outputs: [["Voltage (V)", function (v) { return v.I * v.R; }], ["Power (W)", function (v) { return v.I * v.I * v.R; }]] },
    { name: "Resistors in parallel", text: "1/R = 1/R1 + 1/R2 + 1/R3 (0 = unused)", inputs: [["a", "R1 (Ω)", 100], ["b", "R2 (Ω)", 220], ["c", "R3 (Ω)", 0]],
      outputs: [["Total (Ω)", function (v) { var s = [v.a, v.b, v.c].filter(function (x) { return x; }).reduce(function (t, x) { return t + 1 / x; }, 0); return 1 / s; }]] },
    { name: "Sphere", text: "V = 4/3 π r³,  A = 4 π r²", inputs: [["r", "Radius", 1]],
      outputs: [["Volume", function (v) { return 4 / 3 * PI * Math.pow(v.r, 3); }], ["Surface area", function (v) { return 4 * PI * v.r * v.r; }]] },
    { name: "Cylinder / tank volume", text: "V = π r² h", inputs: [["d", "Diameter (m)", 1], ["h", "Height (m)", 2]],
      outputs: [["Volume (m³)", function (v) { return PI * v.d * v.d / 4 * v.h; }], ["Volume (L)", function (v) { return PI * v.d * v.d / 4 * v.h * 1000; }], ["Volume (US gal)", function (v) { return PI * v.d * v.d / 4 * v.h / 3.785411784e-3; }]] },
    { name: "Cone volume", text: "V = π r² h / 3", inputs: [["r", "Radius", 1], ["h", "Height", 3]],
      outputs: [["Volume", function (v) { return PI * v.r * v.r * v.h / 3; }], ["Slant height", function (v) { return Math.hypot(v.r, v.h); }]] },
    { name: "Right triangle", text: "c = √(a² + b²)", inputs: [["a", "Side a", 3], ["b", "Side b", 4]],
      outputs: [["Hypotenuse c", function (v) { return Math.hypot(v.a, v.b); }], ["Angle A (°)", function (v) { return Math.atan2(v.a, v.b) * 180 / PI; }], ["Area", function (v) { return v.a * v.b / 2; }]] },
    { name: "Triangle from 3 sides (Heron)", text: "A = √(s(s-a)(s-b)(s-c))", inputs: [["a", "a", 3], ["b", "b", 4], ["c", "c", 5]],
      outputs: [["Area", function (v) { var s = (v.a + v.b + v.c) / 2; return Math.sqrt(s * (s - v.a) * (s - v.b) * (s - v.c)); }]] },
    { name: "Kinetic energy", text: "E = ½ m v²", inputs: [["m", "Mass (kg)", 1000], ["vel", "Speed (m/s)", 20]],
      outputs: [["Energy (J)", function (v) { return 0.5 * v.m * v.vel * v.vel; }], ["Energy (kWh)", function (v) { return 0.5 * v.m * v.vel * v.vel / 3.6e6; }]] },
    { name: "Potential energy", text: "E = m g h", inputs: [["m", "Mass (kg)", 10], ["h", "Height (m)", 5]],
      outputs: [["Energy (J)", function (v) { return v.m * G * v.h; }]] },
    { name: "Torque and power", text: "P = T ω,  hp = lbf·ft × rpm / 5252", inputs: [["T", "Torque (N·m)", 300], ["rpm", "Speed (rpm)", 3000]],
      outputs: [["Power (kW)", function (v) { return v.T * v.rpm * 2 * PI / 60 / 1000; }], ["Power (hp)", function (v) { return v.T * v.rpm * 2 * PI / 60 / 745.69987158227022; }]] },
    { name: "Wheel / pulley speed", text: "v = π d × rpm", inputs: [["d", "Diameter (mm)", 650], ["rpm", "rpm", 200]],
      outputs: [["Speed (m/s)", function (v) { return PI * v.d / 1000 * v.rpm / 60; }], ["Speed (km/h)", function (v) { return PI * v.d / 1000 * v.rpm / 60 * 3.6; }], ["Speed (mph)", function (v) { return PI * v.d / 1000 * v.rpm / 60 / 0.44704; }]] },
    { name: "Ideal gas", text: "P V = n R T", inputs: [["n", "Amount (mol)", 1], ["T", "Temperature (K)", 273.15], ["V", "Volume (L)", 22.414]],
      outputs: [["Pressure (kPa)", function (v) { return v.n * 8.314462618 * v.T / (v.V / 1000) / 1000; }], ["Pressure (atm)", function (v) { return v.n * 8.314462618 * v.T / (v.V / 1000) / 101325; }]] },
    { name: "Spring (Hooke)", text: "F = k x,  E = ½ k x²", inputs: [["k", "Spring rate (N/m)", 500], ["x", "Deflection (m)", 0.1]],
      outputs: [["Force (N)", function (v) { return v.k * v.x; }], ["Stored energy (J)", function (v) { return 0.5 * v.k * v.x * v.x; }]] },
    { name: "Percent change", text: "Δ% = (new − old) / old × 100", inputs: [["o", "Old value", 80], ["n", "New value", 100]],
      outputs: [["Change (%)", function (v) { return (v.n - v.o) / v.o * 100; }], ["Ratio new/old", function (v) { return v.n / v.o; }]] },
    { name: "Compound interest", text: "A = P (1 + r/n)^(n t)", inputs: [["P", "Principal", 1000], ["rate", "Rate (%/year)", 5], ["n", "Compounds per year", 12], ["t", "Years", 10]],
      outputs: [["Amount", function (v) { return v.P * Math.pow(1 + v.rate / 100 / v.n, v.n * v.t); }], ["Interest", function (v) { return v.P * Math.pow(1 + v.rate / 100 / v.n, v.n * v.t) - v.P; }]] },
    { name: "Density and mass", text: "m = ρ V", inputs: [["rho", "Density (kg/m³)", 7850], ["V", "Volume (cm³)", 1000]],
      outputs: [["Mass (kg)", function (v) { return v.rho * v.V / 1e6; }], ["Mass (lb)", function (v) { return v.rho * v.V / 1e6 / 0.45359237; }]] }
  ];

  return { CATEGORIES: CATEGORIES, convert: convert, FORMULAS: FORMULAS };
})();
