// Writes the flat "2D" piece set as SVG (100x100 viewBox), one file per
// piece, into tools/svg2d/ - or, with the argument "bw", the pure
// black-and-white set (no gradients) into tools/svgbw/. render-png.qml then
// rasterizes them with Qt.
// Original artwork in a chunky, rounded "neo" style - tuned for e-ink:
// bold outlines, white pieces stay light on dark squares, black pieces
// keep light detail lines so their shapes read on dark squares too.
const fs = require("fs");
const path = require("path");
const BW = process.argv[2] === "bw";
const out = path.join(__dirname, BW ? "svgbw" : "svg2d");

const BASE = '<rect x="22" y="80" width="56" height="11" rx="4"/>';
const COLLAR = (x0, x1, y0, y1) => `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="3"/>`;

const SHAPES = {
  P: {
    body: `<rect x="28" y="80" width="44" height="11" rx="4"/>
      <path d="M35 81 C35 68 42 61 44 55 L56 55 C58 61 65 68 65 81 Z"/>
      ${COLLAR(38, 62, 48, 56)}
      <circle cx="50" cy="35" r="14"/>`,
    detail: ""
  },
  R: {
    body: `${BASE}
      ${COLLAR(26, 74, 72, 81)}
      <path d="M32 73 L35 41 L65 41 L68 73 Z"/>
      ${COLLAR(28, 72, 34, 42)}
      <path d="M27 35 L27 16 Q27 14 29 14 L36 14 Q38 14 38 16 L38 22 L44.5 22 L44.5 16 Q44.5 14 46.5 14 L53.5 14 Q55.5 14 55.5 16 L55.5 22 L62 22 L62 16 Q62 14 64 14 L71 14 Q73 14 73 16 L73 35 Z"/>`,
    detail: '<path d="M36 49 L64 49 M35 66 L65 66"/>'
  },
  N: {
    body: `${BASE}
      <path d="M28 81 C30 74 36 70 40 66 C44 60 44 56 40 54 L33 57 C30 60 26 62 22 61 C17 60 15 56 17 52 L25 36 C29 28 35 22 43 20 L48 11 L51 20 C55 21 59 25 62 31 C70 43 73 62 72 81 Z"/>`,
    detail: '<circle cx="39" cy="33" r="3.2" class="fill"/><path d="M63 36 C67 48 68 62 67 76"/><circle cx="22" cy="53" r="1.6" class="fill"/>'
  },
  B: {
    body: `<rect x="24" y="80" width="52" height="11" rx="4"/>
      <path d="M35 81 L41 66 L59 66 L65 81 Z"/>
      ${COLLAR(36, 64, 60, 68)}
      <path d="M50 25 C36 35 32 50 37 61 L63 61 C68 50 64 35 50 25 Z"/>
      <circle cx="50" cy="20" r="6"/>`,
    detail: '<path d="M57 37 L47 50"/>'
  },
  Q: {
    body: `${BASE}
      ${COLLAR(27, 73, 71, 81)}
      <path d="M30 72 L19 35 L32 54 L35 28 L44 51 L50 24 L56 51 L65 28 L68 54 L81 35 L70 72 Z"/>
      <circle cx="19" cy="33" r="5.5"/><circle cx="35" cy="25" r="5.5"/><circle cx="50" cy="20" r="5.5"/>
      <circle cx="65" cy="25" r="5.5"/><circle cx="81" cy="33" r="5.5"/>`,
    detail: '<path d="M33 64 L67 64"/>'
  },
  K: {
    body: `${BASE}
      ${COLLAR(27, 73, 70, 81)}
      <path d="M30 71 C16 59 18 39 34 39 C42 39 47 45 50 52 C53 45 58 39 66 39 C82 39 84 59 70 71 Z"/>
      <path d="M50 53 C45 45 43 38 50 31 C57 38 55 45 50 53 Z"/>
      <path d="M46.5 31 L46.5 22 L41 22 L41 16 L46.5 16 L46.5 10 L53.5 10 L53.5 16 L59 16 L59 22 L53.5 22 L53.5 31 Z"/>`,
    detail: '<path d="M32 63 L68 63"/>'
  }
};

const STYLES = BW ? {
  w: { light: "#ffffff", dark: "#ffffff", stroke: "#000000", detail: "#000000", eye: "#000000" },
  b: { light: "#000000", dark: "#000000", stroke: "#000000", detail: "#ffffff", eye: "#ffffff" }
} : {
  w: { light: "#ffffff", dark: "#d4d4d4", stroke: "#161616", detail: "#161616", eye: "#161616" },
  b: { light: "#5c5c5c", dark: "#1f1f1f", stroke: "#000000", detail: "#d8d8d8", eye: "#e8e8e8" }
};

fs.mkdirSync(out, { recursive: true });
for (const c of ["w", "b"]) {
  const st = STYLES[c];
  for (const t of Object.keys(SHAPES)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="256" height="256">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="0.25">
      <stop offset="0" stop-color="${st.light}"/><stop offset="1" stop-color="${st.dark}"/>
    </linearGradient>
  </defs>
  ${BW ? `<g fill="#ffffff" stroke="#ffffff" stroke-width="10" stroke-linejoin="round">${SHAPES[t].body}</g>` : ""}
  <g fill="url(#g)" stroke="${st.stroke}" stroke-width="3.6" stroke-linejoin="round">
    ${SHAPES[t].body}
  </g>
  <g fill="none" stroke="${st.detail}" stroke-width="2.6" stroke-linecap="round">
    ${SHAPES[t].detail.replace(/class="fill"/g, `fill="${st.eye}" stroke="none"`)}
  </g>
</svg>
`;
    fs.writeFileSync(path.join(out, c + t + ".svg"), svg);
  }
}
console.log("wrote", fs.readdirSync(out).length, "svgs");
