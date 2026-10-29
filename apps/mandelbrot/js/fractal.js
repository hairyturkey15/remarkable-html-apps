// Mandelbrot math in the spirit of Kalles Fraktaler:
//  - multi-precision reference orbit (fixed point, no BigInt needed)
//  - perturbation: each pixel iterates a small double-precision delta
//  - series approximation to skip the first iterations for all pixels
//  - rebasing (Zhuoran) instead of glitch detection + extra references
//  - "guessing" refinement, cardioid/bulb and periodicity checks
var Fractal = (function () {
  "use strict";

  // --- Multi-precision fixed point: sign + limbs in base 2^24 --------------
  // value = ±(l[0] + l[1]·2^-24 + l[2]·2^-48 + ...)
  var B = 16777216;

  function mpZero(F) { var l = []; for (var i = 0; i <= F; i++) l.push(0); return { neg: false, l: l }; }

  function mpFromDouble(x, F) {
    var r = mpZero(F);
    r.neg = x < 0;
    x = Math.abs(x);
    r.l[0] = Math.floor(x);
    x -= r.l[0];
    for (var i = 1; i <= F; i++) { x *= B; r.l[i] = Math.floor(x); x -= r.l[i]; }
    return r;
  }

  function mpToDouble(a) {
    var v = 0, s = 1;
    for (var i = 0; i < Math.min(a.l.length, 4); i++) { v += a.l[i] * s; s /= B; }
    return a.neg ? -v : v;
  }

  function cmpMag(a, b) {
    for (var i = 0; i < a.l.length; i++) if (a.l[i] !== b.l[i]) return a.l[i] > b.l[i] ? 1 : -1;
    return 0;
  }

  function addMag(a, b) {
    var F = a.l.length - 1, r = mpZero(F), carry = 0;
    for (var i = F; i >= 0; i--) {
      var v = a.l[i] + b.l[i] + carry;
      carry = v >= B ? 1 : 0;
      r.l[i] = v - carry * B;
    }
    r.l[0] += carry * B;
    return r;
  }

  function subMag(a, b) { // |a| >= |b|
    var F = a.l.length - 1, r = mpZero(F), borrow = 0;
    for (var i = F; i >= 0; i--) {
      var v = a.l[i] - b.l[i] - borrow;
      borrow = v < 0 ? 1 : 0;
      r.l[i] = v + borrow * B;
    }
    return r;
  }

  function mpAdd(a, b) {
    var r;
    if (a.neg === b.neg) { r = addMag(a, b); r.neg = a.neg; return r; }
    if (cmpMag(a, b) >= 0) { r = subMag(a, b); r.neg = a.neg; } else { r = subMag(b, a); r.neg = b.neg; }
    return r;
  }

  function mpNeg(a) { return { neg: !a.neg, l: a.l.slice() }; }
  function mpSub(a, b) { return mpAdd(a, mpNeg(b)); }

  function mpMul(a, b) {
    var F = a.l.length - 1, p = new Array(2 * F + 1), i, j;
    for (i = 0; i <= 2 * F; i++) p[i] = 0;
    for (i = 0; i <= F; i++) {
      var ai = a.l[i];
      if (!ai) continue;
      for (j = 0; j <= F; j++) p[i + j] += ai * b.l[j];
    }
    for (i = 2 * F; i >= 1; i--) {
      var c = Math.floor(p[i] / B);
      p[i] -= c * B;
      p[i - 1] += c;
    }
    return { neg: a.neg !== b.neg, l: p.slice(0, F + 1) };
  }

  function mpFromString(s, F) {
    s = String(s).trim();
    var neg = s.charAt(0) === "-";
    if (neg || s.charAt(0) === "+") s = s.slice(1);
    var parts = s.split("."), ip = parseInt(parts[0] || "0", 10), frac = (parts[1] || "").replace(/[^0-9]/g, "");
    var r = mpZero(F);
    r.neg = neg;
    r.l[0] = ip;
    var digits = frac.split("").map(Number);
    for (var k = 1; k <= F; k++) {
      var carry = 0;
      for (var d = digits.length - 1; d >= 0; d--) {
        var v = digits[d] * B + carry;
        digits[d] = v % 10;
        carry = Math.floor(v / 10);
      }
      r.l[k] = carry;
    }
    return r;
  }

  function mpToString(a, digits) {
    var l = a.l.slice(), out = (a.neg ? "-" : "") + l[0] + ".";
    for (var d = 0; d < digits; d++) {
      var carry = 0;
      for (var k = l.length - 1; k >= 1; k--) {
        var v = l[k] * 10 + carry;
        l[k] = v % B;
        carry = Math.floor(v / B);
      }
      out += carry;
    }
    return out;
  }

  function mpResize(a, F) {
    var l = a.l.slice(0, F + 1);
    while (l.length < F + 1) l.push(0);
    return { neg: a.neg, l: l };
  }

  // Fraction limbs needed for a given pixel size.
  function limbsFor(pixel) {
    var digits = Math.max(20, -Math.log10(pixel) + 12);
    return Math.min(30, Math.ceil(digits * 3.33 / 24) + 1);
  }

  // --- Reference orbit ------------------------------------------------------
  // Returns Float64 arrays of the orbit (doubles) up to escape or maxIter.
  function referenceOrbit(cre, cim, maxIter) {
    var F = cre.l.length - 1;
    var zr = mpZero(F), zi = mpZero(F);
    var xs = new Float64Array(maxIter + 1), ys = new Float64Array(maxIter + 1), n = 0;
    for (; n <= maxIter; n++) {
      var dr = mpToDouble(zr), di = mpToDouble(zi);
      xs[n] = dr;
      ys[n] = di;
      if (dr * dr + di * di > 1e6) break;
      var r2 = mpMul(zr, zr), i2 = mpMul(zi, zi), ri = mpMul(zr, zi);
      zr = mpAdd(mpSub(r2, i2), cre);
      zi = mpAdd(mpAdd(ri, ri), cim);
    }
    return { x: xs, y: ys, len: Math.min(n + 1, maxIter + 1) };
  }

  // Series approximation coefficients A, B, C for δ_n ≈ A δc + B δc² + C δc³.
  // Stops when the cubic term stops being negligible for the view's corner.
  function seriesSkip(ref, radius, maxIter) {
    var Ar = 1, Ai = 0, Br = 0, Bi = 0, Cr = 0, Ci = 0, n = 0, best = { n: 0 };
    var limit = Math.min(ref.len - 2, maxIter - 1);
    // A_1 = 1 at n = 1 (δ_1 = δc).
    for (n = 1; n < limit; n++) {
      var zr = 2 * ref.x[n], zi = 2 * ref.y[n];
      var nAr = zr * Ar - zi * Ai + 1, nAi = zr * Ai + zi * Ar;
      var nBr = zr * Br - zi * Bi + (Ar * Ar - Ai * Ai), nBi = zr * Bi + zi * Br + 2 * Ar * Ai;
      var nCr = zr * Cr - zi * Ci + 2 * (Ar * Br - Ai * Bi), nCi = zr * Ci + zi * Cr + 2 * (Ar * Bi + Ai * Br);
      var a = Math.hypot(nAr, nAi) * radius, bb = Math.hypot(nBr, nBi) * radius * radius, c = Math.hypot(nCr, nCi) * radius * radius * radius;
      if (!isFinite(c) || c > 1e-6 * bb || bb > 1e-3 * a) break;
      Ar = nAr; Ai = nAi; Br = nBr; Bi = nBi; Cr = nCr; Ci = nCi;
      best = { n: n + 1, Ar: Ar, Ai: Ai, Br: Br, Bi: Bi, Cr: Cr, Ci: Ci };
    }
    return best;
  }

  // --- Per-pixel iteration ---------------------------------------------------------
  // Result: smooth iteration count (μ) or -1 inside; de = distance estimate.
  var out = { mu: 0, de: 0 };

  // Plain double precision (shallow zooms), with interior shortcuts.
  function iterateDirect(cx, cy, maxIter) {
    // Main cardioid and period-2 bulb.
    var q = (cx - 0.25) * (cx - 0.25) + cy * cy;
    if (q * (q + (cx - 0.25)) <= 0.25 * cy * cy || (cx + 1) * (cx + 1) + cy * cy <= 0.0625) { out.mu = -1; out.de = 0; return out; }
    var x = 0, y = 0, dx = 0, dy = 0, x2 = 0, y2 = 0, px = 0, py = 0, period = 8, check = 0;
    for (var n = 0; n < maxIter; n++) {
      // derivative dz/dc: d = 2 z d + 1
      var ndx = 2 * (x * dx - y * dy) + 1, ndy = 2 * (x * dy + y * dx);
      dx = ndx; dy = ndy;
      y = 2 * x * y + cy;
      x = x2 - y2 + cx;
      x2 = x * x; y2 = y * y;
      if (x2 + y2 > 1e6) {
        var r = Math.sqrt(x2 + y2);
        out.mu = n + 1 - Math.log(Math.log(r)) / Math.LN2;
        out.de = r * Math.log(r) / Math.hypot(dx, dy);
        return out;
      }
      // Brent-style periodicity check: interior orbits repeat.
      if (Math.abs(x - px) < 1e-14 && Math.abs(y - py) < 1e-14) { out.mu = -1; out.de = 0; return out; }
      if (++check === period) { check = 0; period *= 2; px = x; py = y; }
    }
    out.mu = -1;
    out.de = 0;
    return out;
  }

  // Perturbation around the reference orbit, with rebasing.
  function iteratePerturbed(ref, sa, dcx, dcy, maxIter) {
    var n = 0, m = 0, ex = 0, ey = 0, dx = 0, dy = 0;
    if (sa.n > 1) {
      // δ from the series; derivative dδ/dδc from its derivative.
      var c2r = dcx * dcx - dcy * dcy, c2i = 2 * dcx * dcy, c3r = c2r * dcx - c2i * dcy, c3i = c2r * dcy + c2i * dcx;
      ex = sa.Ar * dcx - sa.Ai * dcy + sa.Br * c2r - sa.Bi * c2i + sa.Cr * c3r - sa.Ci * c3i;
      ey = sa.Ar * dcy + sa.Ai * dcx + sa.Br * c2i + sa.Bi * c2r + sa.Cr * c3i + sa.Ci * c3r;
      dx = sa.Ar + 2 * (sa.Br * dcx - sa.Bi * dcy);
      dy = sa.Ai + 2 * (sa.Br * dcy + sa.Bi * dcx);
      n = m = sa.n;
    }
    var len = ref.len, rx = ref.x, ry = ref.y;
    for (; n < maxIter; n++) {
      var Zx = rx[m], Zy = ry[m];
      var zx = Zx + ex, zy = Zy + ey;
      var r2 = zx * zx + zy * zy;
      if (r2 > 1e6) {
        var r = Math.sqrt(r2);
        // z_n escaped here (the direct loop counts z_{n+1}): same scale.
        out.mu = n - Math.log(Math.log(r)) / Math.LN2;
        out.de = r * Math.log(r) / Math.hypot(dx, dy);
        return out;
      }
      // Rebase when the full orbit gets closer to 0 than the delta, or the
      // reference runs out: continue from the start of the reference.
      if (r2 < ex * ex + ey * ey || m >= len - 1) {
        ex = zx; ey = zy; m = 0;
        Zx = 0; Zy = 0;
      }
      // dz/dc of the full orbit.
      var fx = Zx + ex, fy = Zy + ey;
      var ndx = 2 * (fx * dx - fy * dy) + 1, ndy = 2 * (fx * dy + fy * dx);
      dx = ndx; dy = ndy;
      // δ' = 2 Z δ + δ² + δc
      var nex = 2 * (Zx * ex - Zy * ey) + ex * ex - ey * ey + dcx;
      var ney = 2 * (Zx * ey + Zy * ex) + 2 * ex * ey + dcy;
      ex = nex; ey = ney;
      m++;
    }
    out.mu = -1;
    out.de = 0;
    return out;
  }

  // --- PNG (8-bit grayscale, stored deflate: exact pixels) ----------------------------
  var CRC_TABLE = (function () {
    var t = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t.push(c >>> 0);
    }
    return t;
  })();

  function crc32(bytes, start, end) {
    var c = 0xffffffff;
    for (var i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function pngGray(gray, w, h) {
    var raw = (w + 1) * h, blocks = Math.ceil(raw / 65535);
    var idatLen = 2 + raw + blocks * 5 + 4;
    var total = 8 + 25 + (12 + idatLen) + 12;
    var b = new Uint8Array(total), p = 0;
    var put32 = function (v) { b[p++] = (v >>> 24) & 255; b[p++] = (v >>> 16) & 255; b[p++] = (v >>> 8) & 255; b[p++] = v & 255; };
    [137, 80, 78, 71, 13, 10, 26, 10].forEach(function (x) { b[p++] = x; });
    put32(13); var cs = p; [73, 72, 68, 82].forEach(function (x) { b[p++] = x; });
    put32(w); put32(h); b[p++] = 8; b[p++] = 0; b[p++] = 0; b[p++] = 0; b[p++] = 0;
    put32(crc32(b, cs, p));
    put32(idatLen); cs = p; [73, 68, 65, 84].forEach(function (x) { b[p++] = x; });
    b[p++] = 0x78; b[p++] = 0x01;
    var s1 = 1, s2 = 0, row = 0, col = -1, left = raw;
    while (left > 0) {
      var n = Math.min(65535, left);
      left -= n;
      b[p++] = left === 0 ? 1 : 0;
      b[p++] = n & 255; b[p++] = n >> 8; b[p++] = ~n & 255; b[p++] = (~n >> 8) & 255;
      for (var i = 0; i < n; i++) {
        var v = col < 0 ? 0 : gray[row * w + col]; // filter byte 0 then the row
        b[p++] = v;
        s1 = (s1 + v) % 65521; s2 = (s2 + s1) % 65521;
        if (++col === w) { col = -1; row++; }
      }
    }
    put32(((s2 << 16) | s1) >>> 0);
    put32(crc32(b, cs, p));
    put32(0); cs = p; [73, 69, 78, 68].forEach(function (x) { b[p++] = x; }); put32(crc32(b, cs, p));
    return b;
  }

  return {
    mpFromDouble: mpFromDouble, mpFromString: mpFromString, mpToString: mpToString, mpToDouble: mpToDouble, mpAdd: mpAdd, mpResize: mpResize,
    limbsFor: limbsFor, referenceOrbit: referenceOrbit, seriesSkip: seriesSkip, iterateDirect: iterateDirect, iteratePerturbed: iteratePerturbed,
    pngGray: pngGray
  };
})();
