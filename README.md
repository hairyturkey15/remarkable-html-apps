# HTML Apps for AppLoad

Run folders of HTML on the reMarkable through AppLoad, either from a launcher
("HTML Apps") or packaged as their own AppLoad entries. Comes with a set of
apps built for it:

| App | What it does |
|---|---|
| Chess | Standard, atomic, crazyhouse, horde; bot; clock; position editor; 2D/3D pieces |
| Chess Variants | Black-and-white chess with chess.com's variant set: Chess960, 3-Check, King of the Hill, Crazyhouse, Atomic, Horde, Fog of War, Giveaway, Torpedo, Sideways Pawns, No Castling, Capture Anything, Chaturanga, Duck Chess, Blindfold |
| Spider | 1 suit (black), 2 suits (red/black) or 4; unlimited undo; optional "fill empty columns before dealing" rule |
| Solitaire | Klondike, draw 1 or 3, unlimited undo, hints, auto-finish |
| Checkers | American rules, compulsory captures (optional), bot with 3 levels or two players |
| Hexline | An original hex-grid line puzzle with rotation and combo scoring |
| Calculator | Keypad calculator, function graphing, unit converter, formula table, light scripting |
| Periodic Table | All 118 elements with discovery, uses, facts, configurations and orbital pictures; reaction balancer/analyser (redox, ΔH, predictions with confidence labels); spectra and X-ray lines |
| Mohs Hardness | Scale, ~150 materials (elements, steels, ceramics, gems, biological, superhard), Mohs/Vickers/Knoop/Rockwell/Brinell/Shore converters, temperature notes |
| Score | Music notation editor with a music keypad; PDF and MIDI export |
| Mandelbrot | Perturbation + series approximation + rebasing deep zoom, guessing refinement, lossless PNG export |
| Circuit | Logic and electronics diagrams with live logic simulation and truth tables |

Every app has Refresh (clears e-ink ghosting) and Exit buttons.

## Install (no build tools needed)

Requirements: a reMarkable Paper Pro, Paper Pro Move or Paper Pure (64-bit)
in developer mode, with xovi and AppLoad installed.

1. Download `remarkable-html-apps-<version>.zip` from the
   [Releases](../../releases) page and unzip it.
2. Connect the tablet by USB and keep its screen on. If you use a VPN, allow
   local network traffic, or 10.11.99.1 won't be reachable.
3. In the unzipped folder, run `./install.sh` (Linux or macOS). It asks for
   the tablet's root password once. Or copy the files by hand:

   ```bash
   scp -r appload html-apps root@10.11.99.1:/home/root/xovi/exthome/
   ```

4. On the tablet, open AppLoad, reload its app list, and start **HTML Apps**.

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

Tablet-only extras on `window.htmlload`: `refresh(ms)` (native full-screen
black/white flash), `saveFile(name, data)` and `saveCanvas(name)` (write to
the exports folder), `importPdf(name, title)` (copy an exported PDF into My
Files; it shows up after the tablet restarts), and `htmlpinch` events for
two-finger pinch. `putImageData` is mapped onto QML's `drawImage`, since
QML's own `putImageData` draws nothing.

Shared app kit: `apps/shared/rmkit.js` (toolbar with Refresh/Exit, tap
targets, drags, pinch, on-screen keyboard, dialogs, storage, export) and
`apps/shared/cards.js` (card drawing). Apps load them from `../shared/`;
`package.sh` bundles them into packaged apps.

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
/home/root/xovi/exthome/html-exports/       files apps save (PDF, MIDI, PNG, ...)
```

Copy exports to your computer with
`scp -r root@10.11.99.1:/home/root/xovi/exthome/html-exports .`

An HTML folder can include an optional `manifest.json`
(`{"name": "...", "entry": "index.html", "icon": "icon.png"}`). Without one,
the `<title>` and an `icon.png` are used if present.

## Build from source

You need Qt's `rcc` and an aarch64 C compiler (`zig`, or a cross-gcc):

| OS | rcc | compiler |
|---|---|---|
| macOS | `brew install qtbase` | `brew install zig` |
| Debian/Ubuntu | `sudo apt install qt6-base-dev-tools` | `sudo apt install gcc-aarch64-linux-gnu` |
| Fedora | `sudo dnf install qt6-qtbase-devel` | zig from ziglang.org |
| Arch | `sudo pacman -S qt6-base` | `sudo pacman -S zig` |

The scripts look for `rcc` in the usual Qt 6 (and Qt 5) locations on each
distro. Set `RCC=/path/to/rcc` or `BACKEND_CC=<compiler>` to override.

```bash
./build.sh                # -> output/htmlload and output/html-apps
./deploy.sh 10.11.99.1    # copy both to the tablet over one SSH connection
./release.sh v1.0.0       # -> output/remarkable-html-apps-v1.0.0.zip
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

## Tested on

A reMarkable Paper Pure (xochitl on Qt 6.8.2) with xovi and AppLoad: the
launcher, chess and the release installer all run there. Notes:

- **Bot speed.** A move takes about 90 ms worst case on a Mac and is slower
  on the tablet. If Hard feels sluggish, lower `nodes` in
  `apps/chess/js/bot.js` (`LEVELS`).
- **Ghosting.** E-ink keeps faint traces of earlier frames; chess has a
  Refresh button that flashes the screen to clear them.
- **Logs.** The backend writes `/tmp/htmlload-debug.log`; page errors show in
  a box at the bottom of the screen and in `journalctl -u xochitl`.

## License

MIT, see [LICENSE](LICENSE). The piece artwork in `apps/chess/pieces/` is
original and generated by the scripts in `tools/`, under the same license.
