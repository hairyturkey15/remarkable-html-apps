# HTML Apps for AppLoad (+ Chess)

Run folders of HTML on the reMarkable through AppLoad, either from a launcher
("HTML Apps") or packaged as their own AppLoad entries. Includes a chess
game built for it.

## Why it works this way

The tablet has no web engine (no QtWebEngine/Chromium), so a real browser
isn't an option. Instead `ui/HtmlApp.qml` is a small **browser-like runtime
for canvas apps**:

- `index.html` is parsed for its `<script>` tags (inline or `src=`), `<title>`
  and `<canvas id>`. The scripts run in QML's own JavaScript engine (ES2016+:
  classes, arrow functions, Promise, Proxy all work).
- The page sees shims for `window`, `document`, `canvas.getContext('2d')`
  (backed by a QML `Canvas`, whose API mirrors HTML canvas), `Image`,
  `setTimeout`/`setInterval`/`requestAnimationFrame`, `localStorage`, `fetch`
  (for local files), and pointer/mouse/click events.
- Assets live in the app folder. Images load straight from disk by relative
  path (`pieces/2d/wK.png`), and text files go through the backend.
- HTML layout and CSS are **not** rendered. Pages that draw everything on
  one `<canvas>` work; DOM-heavy pages (forms, divs, CSS layout) do not.

E-ink behavior: nothing runs on its own. The canvas repaints only after a
touch, a timer the page itself set, or an image load, and only if the page
drew something during that callback.

The backend (`backend/entry.c`, a static aarch64 binary) does what QML can't:
it lists app folders, reads files (in 32 KB UTF-8-safe chunks over AppLoad's
socket), and saves each app's localStorage to `<app>/.localstorage.json`.
Reads are confined to the app folders.

## Layout on the tablet

```
/home/root/xovi/exthome/appload/htmlload/   the "HTML Apps" launcher (an AppLoad app)
/home/root/xovi/exthome/html-apps/<name>/   drop-in HTML folders, each with index.html
```

An HTML folder can include an optional `manifest.json`
(`{"name": "...", "entry": "index.html", "icon": "icon.png"}`). Without one,
the `<title>` and an `icon.png` are used if present.

## Build and deploy

Needs Qt's `rcc` (`brew install qtbase`) and `zig` (`brew install zig`);
both are already set up for the Calculator project.

```bash
./build.sh                # -> output/htmlload and output/html-apps
./deploy.sh 10.11.99.1    # scp both to the tablet
```

Then open **HTML Apps** from AppLoad. To add another app, copy its folder into
`/home/root/xovi/exthome/html-apps/` and tap Refresh.

### Packaging one HTML folder as its own AppLoad app

```bash
./package.sh apps/chess          # -> output/html-chess (id html-chess, name "Chess")
./deploy.sh 10.11.99.1 html-chess
```

The packaged app ships the same runtime with the folder in `www/`, appears in
AppLoad's menu under its own name, and opens straight into the page.

## Chess (`apps/chess`)

- Variants: Standard, Atomic, Crazyhouse (tap a pocket piece, then a square),
  Horde. Move generation is checked against published perft counts for all
  four.
- Tap a piece to see its legal moves (dots, and rings for captures), then tap
  a target. Lifting the pen on a target also moves. Check gets a ring;
  checkmate gets a filled square, a `#` badge and a result banner.
- Undo / Redo (against the bot, these step back to your turn), Flip,
  Refresh (flashes the screen black, then white, then redraws, to clear e-ink
  ghosting), and New (tap twice to confirm).
- Captured pieces and a `+N` material lead show for each side. In crazyhouse
  that row is the pocket.
- Settings (gear, bottom-left): variant, opponent (bot or two players), bot
  level, side, timer (off by default; 1–30 min, +0/2/5/10 s), live ticking
  clock (off by default), 2D/3D pieces,
  move hints, coordinates, board size (fit/90/80/70%), centered or
  top-aligned, **Set up position** (board editor with side to move; castling
  rights are inferred).
- Clock without "live clock": no timer runs. The clocks update whenever the
  screen redraws, and a single timeout fires at the exact moment the side to
  move would flag.
- Bot: alpha-beta search with a capture search and a hard node budget
  (Easy/Medium/Hard). It only computes on its own turn, with no background
  work. On a Mac a move takes 2–90 ms.
- The game and settings persist through localStorage.

Piece sets (`pieces/2d`, `pieces/3d`, 256 px PNG with alpha):

- **2D flat** (default): original vector art in a chunky "neo" style, with
  sources in `tools/make-2d-svgs.js`, rasterized by `tools/render-png.qml`.
- **3D**: rendered by `tools/render-3d.js`, a signed-distance-field raymarcher
  (soft shadows, ambient occlusion, specular highlights) using the same
  silhouettes, so the sets match. Blender isn't installed here, and this needs
  only Node.

Regenerate with:

```bash
cd tools
node make-2d-svgs.js && qml render-png.qml -- 256 "$PWD/../apps/chess/pieces/2d" $PWD/svg2d/*.svg
node render-3d.js ../apps/chess/pieces/3d 256
```

## Testing on the Mac

- In a browser: serve `apps/` (`python3 -m http.server`) and open `chess/`.
- In the real QML runtime: `devtest/` has a stand-in for AppLoad's QML module:

  ```bash
  cd devtest
  QML_XHR_ALLOW_FILE_READ=1 qml -I . run.qml -- --apps "$PWD/../apps"
  ```

## Not yet verified on the tablet

Everything above ran on a Mac (the real QML runtime under Qt 6.11, and a
browser). It has not been run on the device yet, so these are the things to
watch:

1. **Qt version on the tablet.** The runtime needs Proxy, Promise and the
   `Function` constructor, all standard in Qt 6's JS engine. If a page fails to
   load, the error appears in a box at the bottom of the screen.
2. **Pen vs finger.** Input uses a plain `MouseArea`, like the Calculator and
   Shape3D apps.
3. **Bot speed.** A move takes about 90 ms worst case on the Mac. The tablet's
   CPU is much slower, so expect up to a few seconds on Hard in crazyhouse. If
   it's too slow, lower `nodes` in `apps/chess/js/bot.js` (`LEVELS`).
4. **Backend log:** `/tmp/htmlload-debug.log` on the tablet.
