// Renders the "3D" piece set: a small signed-distance-field raymarcher in
// plain Node (no Blender needed). The shapes follow the 2D set's
// silhouettes - lathe profiles taken from the same proportions, the knight
// extruded from the same outline - so the two sets match.
//
//   node render-3d.js <out dir> [size]
//
// Writes wK.png ... bP.png (RGBA). Geometry is traced once per piece and
// shaded twice (ivory and ebony).
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT = process.argv[2] || path.join(__dirname, "..", "apps", "chess", "pieces", "3d");
const SIZE = parseInt(process.argv[3] || "256", 10);
const SS = 3; // supersampling per axis

// ------------------------------------------------------------------
// Vector helpers (arrays are slow in hot loops; use scalars where it counts)
// ------------------------------------------------------------------
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
function smin(a, b, k) {
  const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
  return b * (1 - h) + a * h - k * h * (1 - h);
}

// 2D polygon SDF (Inigo Quilez). pts: flat [x0, y0, x1, y1, ...]
function sdPolygon(px, py, pts) {
  const n = pts.length / 2;
  let d = (px - pts[0]) * (px - pts[0]) + (py - pts[1]) * (py - pts[1]);
  let s = 1;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const vix = pts[2 * i], viy = pts[2 * i + 1], vjx = pts[2 * j], vjy = pts[2 * j + 1];
    const ex = vjx - vix, ey = vjy - viy, wx = px - vix, wy = py - viy;
    const t = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey), 0, 1);
    const bx = wx - ex * t, by = wy - ey * t;
    const dd = bx * bx + by * by;
    if (dd < d) d = dd;
    const c1 = py >= viy, c2 = py < vjy, c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}

function bezier(p0, p1, p2, p3, steps) {
  const out = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]
    ]);
  }
  return out;
}

// A solid of revolution from an (r, y) profile running bottom to top. The
// profile is mirrored to -r so the axis lies inside the polygon.
function lathe(profile) {
  const pts = [];
  for (const [r, y] of profile) pts.push(r, y);
  for (let i = profile.length - 1; i >= 0; i--) pts.push(-profile[i][0], profile[i][1]);
  let ymax = 0, rmax = 0;
  for (const [r, y] of profile) { ymax = Math.max(ymax, y); rmax = Math.max(rmax, r); }
  return (x, y, z) => {
    const q = Math.sqrt(x * x + z * z);
    // Cheap bound outside the profile's cylinder.
    const bound = Math.max(q - rmax, -y, y - ymax);
    if (bound > 0.05) return bound;
    return sdPolygon(q, y, pts);
  };
}

const sphere = (cx, cy, cz, r) => (x, y, z) => Math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2) - r;

function box(x, y, z, bx, by, bz) {
  const qx = Math.abs(x) - bx, qy = Math.abs(y) - by, qz = Math.abs(z) - bz;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0);
}

// Shared pedestal (r = 0.27 at the foot), same proportions as the 2D base.
function baseProfile(r) {
  return [[0, 0], [r - 0.02, 0], [r, 0.02], [r, 0.075], [r - 0.025, 0.105], [r - 0.045, 0.115]];
}

// ------------------------------------------------------------------
// Pieces (units: 1.0 = image height, y up, centered on the y axis)
// ------------------------------------------------------------------
const PIECES = {};

{
  const body = lathe([
    ...baseProfile(0.23),
    [0.155, 0.115], ...bezier([0.155, 0.115], [0.155, 0.23], [0.08, 0.3], [0.065, 0.36], 10),
    [0.12, 0.365], [0.128, 0.4], [0.115, 0.43], [0.06, 0.44], [0, 0.44]
  ]);
  const head = sphere(0, 0.565, 0, 0.145);
  PIECES.P = (x, y, z) => smin(body(x, y, z), head(x, y, z), 0.02) - 0.004;
}

{
  const body = lathe([
    ...baseProfile(0.28),
    [0.245, 0.12], [0.245, 0.18], [0.19, 0.195], [0.158, 0.49], [0.215, 0.5], [0.225, 0.56],
    [0.235, 0.57], [0.235, 0.775], [0, 0.775]
  ]);
  const c = Math.cos(Math.PI / 4), s = Math.sin(Math.PI / 4);
  PIECES.R = (x, y, z) => {
    let d = body(x, y, z);
    if (d > 0.05) return d;
    // Hollow top and four crenel gaps (turned 45 degrees to face the camera).
    d = Math.max(d, -(Math.max(Math.sqrt(x * x + z * z) - 0.15, 0.7 - y)));
    const rx = c * x - s * z, rz = s * x + c * z;
    const gaps = Math.min(box(rx, y - 0.79, rz, 0.04, 0.09, 0.4), box(rx, y - 0.79, rz, 0.4, 0.09, 0.04));
    return Math.max(d, -gaps) - 0.004;
  };
}

{
  const body = lathe([
    ...baseProfile(0.27),
    [0.15, 0.115], [0.09, 0.25], [0.14, 0.255], [0.148, 0.3], [0.125, 0.31],
    ...bezier([0.125, 0.31], [0.185, 0.4], [0.165, 0.56], [0, 0.665], 14)
  ]);
  const ball = sphere(0, 0.718, 0, 0.06);
  const a = -0.95, ca = Math.cos(a), sa = Math.sin(a);
  PIECES.B = (x, y, z) => {
    let d = smin(body(x, y, z), ball(x, y, z), 0.015);
    if (d > 0.05) return d;
    // Diagonal slit through the mitre.
    const lx = x - 0.03, ly = y - 0.53;
    const rx = ca * lx - sa * ly, ry = sa * lx + ca * ly;
    d = Math.max(d, -box(rx, ry, z, 0.13, 0.014, 0.4));
    return d - 0.003;
  };
}

{
  const body = lathe([
    ...baseProfile(0.28),
    [0.235, 0.12], [0.235, 0.19], [0.2, 0.2],
    ...bezier([0.2, 0.2], [0.13, 0.3], [0.1, 0.4], [0.11, 0.46], 8),
    ...bezier([0.11, 0.46], [0.15, 0.52], [0.22, 0.58], [0.25, 0.65], 8),
    [0.215, 0.66], [0.15, 0.645], [0, 0.64]
  ]);
  const balls = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    balls.push(sphere(Math.cos(a) * 0.235, 0.678, Math.sin(a) * 0.235, 0.042));
  }
  const dome = sphere(0, 0.62, 0, 0.13);
  const top = sphere(0, 0.775, 0, 0.05);
  PIECES.Q = (x, y, z) => {
    let d = body(x, y, z);
    if (d > 0.1) return d;
    d = smin(d, dome(x, y, z), 0.02);
    for (const b of balls) d = smin(d, b(x, y, z), 0.012);
    d = smin(d, top(x, y, z), 0.02);
    return d - 0.003;
  };
}

{
  const body = lathe([
    ...baseProfile(0.28),
    [0.235, 0.12], [0.235, 0.19], [0.2, 0.2],
    ...bezier([0.2, 0.2], [0.13, 0.3], [0.11, 0.4], [0.115, 0.46], 8),
    ...bezier([0.115, 0.46], [0.16, 0.52], [0.21, 0.58], [0.22, 0.63], 8),
    [0.2, 0.655], [0, 0.66]
  ]);
  const dome = sphere(0, 0.6, 0, 0.165);
  PIECES.K = (x, y, z) => {
    let d = body(x, y, z);
    if (d > 0.1 && y < 0.7) return d;
    d = smin(d, Math.max(dome(x, y, z), 0.55 - y), 0.02);
    const cross = Math.min(box(x, y - 0.83, z, 0.03, 0.105, 0.03), box(x, y - 0.855, z, 0.085, 0.03, 0.03));
    d = smin(d, cross - 0.008, 0.015);
    return d - 0.003;
  };
}

{
  // The 2D knight outline (100x100 SVG units, y down) as a 3D slab.
  const svg = [];
  const M = (x, y) => svg.push([x, y]);
  const L = (x, y) => svg.push([x, y]);
  const C = (x1, y1, x2, y2, x, y) => {
    const p0 = svg[svg.length - 1];
    for (const p of bezier(p0, [x1, y1], [x2, y2], [x, y], 8)) svg.push(p);
  };
  M(28, 81); C(30, 74, 36, 70, 40, 66); C(44, 60, 44, 56, 40, 54); L(33, 57);
  C(30, 60, 26, 62, 22, 61); C(17, 60, 15, 56, 17, 52); L(25, 36);
  C(29, 28, 35, 22, 43, 20); L(48, 11); L(51, 20); C(55, 21, 59, 25, 62, 31);
  C(70, 43, 73, 62, 72, 81);
  const pts = [];
  // Reverse winding is irrelevant for the SDF; map to 3D units.
  for (const [x, y] of svg) pts.push((x - 50) / 100, (91 - y) / 100);
  const base = lathe([...baseProfile(0.27), [0.2, 0.115], [0, 0.115]]);
  const eye = sphere(-0.11, 0.58, 0, 0.026);
  PIECES.N = (x, y, z) => {
    let d = base(x, y, z);
    // Thicker at the neck than at the muzzle.
    const half = 0.085 + clamp((x + 0.2) * 0.12, 0, 0.05);
    const d2 = sdPolygon(x, y, pts) + 0.03;
    const dz = Math.abs(z) - half;
    const slab = Math.min(Math.max(d2, dz), 0) + Math.sqrt(Math.max(d2, 0) ** 2 + Math.max(dz, 0) ** 2) - 0.03;
    d = smin(d, slab, 0.02);
    // Eyes on both sides.
    const ez = Math.abs(z) - half - 0.012;
    d = Math.max(d, -(Math.sqrt((x + 0.11) ** 2 + (y - 0.58) ** 2 + ez * ez) - 0.026));
    return d;
  };
}

// ------------------------------------------------------------------
// Camera, tracing and shading
// ------------------------------------------------------------------
const EL = (14 * Math.PI) / 180, AZ = (28 * Math.PI) / 180;
const cam = [Math.sin(AZ) * Math.cos(EL), Math.sin(EL), Math.cos(AZ) * Math.cos(EL)];
const right = [Math.cos(AZ), 0, -Math.sin(AZ)];
const up = [
  cam[1] * right[2] - cam[2] * right[1],
  cam[2] * right[0] - cam[0] * right[2],
  cam[0] * right[1] - cam[1] * right[0]
];
const TARGET = [0, 0.47, 0];
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const KEY = norm([-0.55, 0.85, 0.55]), FILL = norm([0.8, 0.25, 0.45]), RIM = norm([0.3, 0.45, -0.85]);

function trace(sdf, ox, oy, oz, dx, dy, dz, tmax) {
  let t = 0;
  for (let i = 0; i < 160 && t < tmax; i++) {
    const d = sdf(ox + dx * t, oy + dy * t, oz + dz * t);
    if (d < 0.0004) return t;
    t += d * 0.9;
  }
  return -1;
}

function normalAt(sdf, x, y, z) {
  const e = 0.0008;
  return norm([
    sdf(x + e, y, z) - sdf(x - e, y, z),
    sdf(x, y + e, z) - sdf(x, y - e, z),
    sdf(x, y, z + e) - sdf(x, y, z - e)
  ]);
}

function softShadow(sdf, x, y, z, l) {
  let res = 1, t = 0.01;
  for (let i = 0; i < 48 && t < 1.2; i++) {
    const h = sdf(x + l[0] * t, y + l[1] * t, z + l[2] * t);
    if (h < 0.0005) return 0;
    res = Math.min(res, (10 * h) / t);
    t += clamp(h, 0.004, 0.08);
  }
  return clamp(res, 0, 1);
}

function ambientOcclusion(sdf, x, y, z, n) {
  let occ = 0, w = 1;
  for (let i = 1; i <= 5; i++) {
    const h = 0.012 * i;
    occ += (h - sdf(x + n[0] * h, y + n[1] * h, z + n[2] * h)) * w;
    w *= 0.7;
  }
  return clamp(1 - occ * 9, 0, 1);
}

// Geometry pass: per subsample, either nothing or the lighting terms
// needed to shade any material.
function renderGeometry(sdf) {
  const n = SIZE * SS;
  const samples = new Array(n * n);
  const view = [-cam[0], -cam[1], -cam[2]];
  for (let py = 0; py < n; py++) {
    for (let px = 0; px < n; px++) {
      const u = (px + 0.5) / n - 0.5, v = 0.5 - (py + 0.5) / n;
      const ox = TARGET[0] + right[0] * u + up[0] * v + cam[0] * 2;
      const oy = TARGET[1] + right[1] * u + up[1] * v + cam[1] * 2;
      const oz = TARGET[2] + right[2] * u + up[2] * v + cam[2] * 2;
      const t = trace(sdf, ox, oy, oz, view[0], view[1], view[2], 4);
      if (t < 0) continue;
      const x = ox + view[0] * t, y = oy + view[1] * t, z = oz + view[2] * t;
      const nn = normalAt(sdf, x, y, z);
      const ndl = (l) => Math.max(0, nn[0] * l[0] + nn[1] * l[1] + nn[2] * l[2]);
      const spec = (l) => {
        const h = norm([l[0] + cam[0], l[1] + cam[1], l[2] + cam[2]]);
        return Math.pow(Math.max(0, nn[0] * h[0] + nn[1] * h[1] + nn[2] * h[2]), 48);
      };
      const shadow = softShadow(sdf, x + nn[0] * 0.002, y + nn[1] * 0.002, z + nn[2] * 0.002, KEY);
      const ndv = Math.max(0, nn[0] * cam[0] + nn[1] * cam[1] + nn[2] * cam[2]);
      samples[py * n + px] = {
        key: ndl(KEY) * shadow, fill: ndl(FILL), rim: ndl(RIM), sky: 0.5 + 0.5 * nn[1],
        ao: ambientOcclusion(sdf, x, y, z, nn), spec: spec(KEY) * shadow, fresnel: Math.pow(1 - ndv, 3)
      };
    }
  }
  return samples;
}

const MATERIALS = {
  w: { albedo: 0.8, spec: 0.35, outline: 40 },
  b: { albedo: 0.075, spec: 0.55, outline: 0 }
};

function shade(s, m) {
  const diffuse = s.key * 1.05 + s.fill * 0.32 + s.rim * 0.35 + s.sky * 0.38 * s.ao;
  let c = m.albedo * diffuse * (0.55 + 0.45 * s.ao) + s.spec * m.spec + s.fresnel * 0.12 * s.ao;
  return Math.pow(clamp(c, 0, 1), 1 / 2.2);
}

function composite(samples, m) {
  const n = SIZE * SS;
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  const cover = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let sum = 0, hitCount = 0;
      for (let j = 0; j < SS; j++) {
        for (let i = 0; i < SS; i++) {
          const s = samples[(y * SS + j) * n + x * SS + i];
          if (!s) continue;
          sum += shade(s, m);
          hitCount++;
        }
      }
      const a = hitCount / (SS * SS);
      cover[y * SIZE + x] = a;
      const g = hitCount ? Math.round((sum / hitCount) * 255) : 0;
      const o = (y * SIZE + x) * 4;
      rgba[o] = rgba[o + 1] = rgba[o + 2] = g;
      rgba[o + 3] = Math.round(a * 255);
    }
  }
  // A thin dark outline keeps light pieces readable on light squares.
  const radius = SIZE / 110;
  const out = Buffer.from(rgba);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let best = 0;
      const r = Math.ceil(radius);
      for (let j = -r; j <= r; j++) {
        for (let i = -r; i <= r; i++) {
          const xx = x + i, yy = y + j;
          if (xx < 0 || yy < 0 || xx >= SIZE || yy >= SIZE) continue;
          const dist = Math.hypot(i, j);
          if (dist > radius + 0.5) continue;
          best = Math.max(best, cover[yy * SIZE + xx] * clamp(radius + 0.5 - dist, 0, 1));
        }
      }
      const o = (y * SIZE + x) * 4;
      const a = rgba[o + 3] / 255;
      const outA = best * (1 - a);
      const total = a + outA;
      if (total <= 0) continue;
      const g = (rgba[o] * a + m.outline * outA) / total;
      out[o] = out[o + 1] = out[o + 2] = Math.round(g);
      out[o + 3] = Math.round(total * 255);
    }
  }
  return out;
}

// ------------------------------------------------------------------
// Minimal PNG writer
// ------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePNG(file, rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]));
}

fs.mkdirSync(OUT, { recursive: true });
const only = process.argv[4];
for (const t of Object.keys(PIECES)) {
  if (only && only.indexOf(t) < 0) continue;
  const t0 = Date.now();
  const samples = renderGeometry(PIECES[t]);
  for (const c of ["w", "b"]) writePNG(path.join(OUT, c + t + ".png"), composite(samples, MATERIALS[c]), SIZE, SIZE);
  console.log(t, ((Date.now() - t0) / 1000).toFixed(1) + "s");
}
