// Mandelbrot explorer for e-ink. Tap to zoom in, pinch or drag to frame a
// view, then Render. Renders in short time slices and only repaints the
// screen after each refinement pass; nothing runs when idle.
(function () {
  "use strict";

  var F = Fractal;
  var LOCATIONS = [
    { name: "Whole set", re: "-0.5", im: "0", scale: 3.2 },
    { name: "Seahorse valley", re: "-0.7435", im: "0.1314", scale: 0.006 },
    { name: "Seahorse spiral, deep (1e-11)", re: "-0.743643887037158704752191506114774", im: "0.131825904205311970493132056385139", scale: 3e-11 },
    { name: "Elephant valley", re: "0.2825", im: "0.01", scale: 0.02 },
    { name: "Triple spiral", re: "-0.0884", im: "0.6541", scale: 0.012 },
    { name: "Minibrot on the needle", re: "-1.7497", im: "0", scale: 0.0012 },
    { name: "Deep zoom (1e-30)", re: "-1.7685736563152709932817429153295447129341200534055498823375111352827757", im: "0.0009642968513582800001762427203738194482747761226565635652857831533070", scale: 1e-30 },
    { name: "Very deep zoom (1e-50)", re: "-1.7685736563152709932817429153295447129341200534055498823375111352827757", im: "0.0009642968513582800001762427203738194482747761226565635652857831533070", scale: 1e-50 }
  ];
  var st = Object.assign({ re: "-0.5", im: "0", scale: 3.2, style: "smooth", quality: 2, iterMode: "auto", iterMul: 1, tapZoom: 4 }, RM.load("mandel.state", {}));
  function save() { RM.store("mandel.state", st); }

  var job = null; // running render
  var img = null; // { gray, sw, sh, q, dpr }
  var info = "";
  var frame = null; // gesture preview rectangle {x, y, w, h}

  function maxIter() {
    var depth = Math.max(0, Math.log10(3 / st.scale));
    var base = Math.round(200 + 90 * Math.pow(depth, 1.35));
    return Math.min(200000, Math.round(base * st.iterMul));
  }

  // --- Rendering -------------------------------------------------------------
  function viewRect() {
    var toolH = Math.round(Math.max(54, Math.min(RM.W, RM.H) * 0.085));
    return { x: 0, y: 0, w: RM.W, h: RM.H - toolH };
  }

  function startRender() {
    cancel();
    var v = viewRect(), dpr = RM.canvas.width / RM.W || 1;
    var q = st.quality, sw = Math.max(16, Math.floor(v.w * dpr / q)), sh = Math.max(16, Math.floor(v.h * dpr / q));
    var pixel = st.scale / sw, iters = maxIter();
    var perturb = pixel < 1e-13;
    if (pixel < 1e-290) { RM.toast("That's as deep as double-precision deltas go (about 1e-290)."); return; }
    var j = {
      sw: sw, sh: sh, q: q, dpr: dpr, pixel: pixel, iters: iters, perturb: perturb,
      mu: new Float32Array(sw * sh), de: new Float32Array(sw * sh), done: new Uint8Array(sw * sh),
      step: 8, y: 0, computed: 0, guessed: 0, started: Date.now(), timer: 0
    };
    var cx = parseFloat(st.re), cy = parseFloat(st.im);
    if (perturb) {
      var limbs = F.limbsFor(pixel);
      var cre = F.mpFromString(st.re, limbs), cim = F.mpFromString(st.im, limbs);
      j.ref = F.referenceOrbit(cre, cim, iters);
      j.sa = F.seriesSkip(j.ref, Math.hypot(sw, sh) / 2 * pixel, iters);
      j.limbs = limbs;
    }
    j.cx = cx;
    j.cy = cy;
    job = j;
    info = "Rendering…";
    RM.redraw();
    job.timer = setTimeout(work, 30);
  }

  function cancel() {
    if (job) { clearTimeout(job.timer); job = null; }
  }

  function sample(j, px, py) {
    var dx = (px - j.sw / 2 + 0.5) * j.pixel, dy = (j.sh / 2 - py - 0.5) * j.pixel;
    var r = j.perturb ? F.iteratePerturbed(j.ref, j.sa, dx, dy, j.iters) : F.iterateDirect(j.cx + dx, j.cy + dy, j.iters);
    var k = py * j.sw + px;
    j.mu[k] = r.mu;
    j.de[k] = r.de;
    j.done[k] = 1;
    j.computed++;
  }

  // Successive refinement with guessing: a point whose already-computed
  // neighbours (one step coarser) all share the same iteration band is
  // filled in without iterating.
  function same(j, a, b) {
    if (!j.done[a] || !j.done[b]) return false;
    var ma = j.mu[a], mb = j.mu[b];
    if ((ma < 0) !== (mb < 0)) return false;
    if (ma < 0) return true;
    if (Math.floor(ma) !== Math.floor(mb)) return false;
    // Near the boundary (thin filaments) always compute.
    return j.de[a] > j.pixel * 3 && j.de[b] > j.pixel * 3;
  }

  function work() {
    var j = job;
    if (!j) return;
    var t0 = Date.now(), sw = j.sw, sh = j.sh, s = j.step;
    while (Date.now() - t0 < 120) {
      if (j.y >= sh) {
        // Pass complete: show it, then refine.
        if (s === 1) { finish(); return; }
        paint(false);
        j.step = s = s / 2;
        j.y = 0;
        RM.redraw();
        j.timer = setTimeout(work, 20);
        return;
      }
      var y = j.y;
      if (y % s === 0) {
        for (var x = 0; x < sw; x += s) {
          var k = y * sw + x;
          if (j.done[k]) continue;
          if (s < 8) {
            var s2 = s * 2, xOdd = x % s2 !== 0, yOdd = y % s2 !== 0, ok = false, nb = null;
            var L = x - s, R = x + s, U = y - s, D = y + s;
            if (xOdd && !yOdd && R < sw) nb = [y * sw + L, y * sw + R];
            else if (!xOdd && yOdd && D < sh) nb = [U * sw + x, D * sw + x];
            else if (xOdd && yOdd && R < sw && D < sh) nb = [U * sw + L, U * sw + R, D * sw + L, D * sw + R];
            if (nb) ok = nb.every(function (n) { return same(j, nb[0], n); });
            if (ok) {
              // Smooth values vary smoothly away from the boundary, so the
              // guess interpolates its neighbours instead of copying one.
              var smu = 0, sde = 0;
              nb.forEach(function (n) { smu += j.mu[n]; sde += j.de[n]; });
              j.mu[k] = j.mu[nb[0]] < 0 ? -1 : smu / nb.length;
              j.de[k] = sde / nb.length;
              j.done[k] = 1;
              j.guessed++;
              continue;
            }
          }
          sample(j, x, y);
        }
      }
      j.y++;
    }
    j.timer = setTimeout(work, 0);
  }

  function finish() {
    var j = job;
    paint(true);
    var secs = ((Date.now() - j.started) / 1000).toFixed(1);
    info = "Done in " + secs + " s · " + Math.round(100 * j.guessed / (j.computed + j.guessed)) + "% guessed" + (j.perturb ? " · perturbation (" + j.limbs * 24 + "-bit reference, skipped " + j.sa.n + " iterations by series)" : "");
    job = null;
    RM.redraw();
  }

  // Turns iteration data into gray levels for the current style.
  function shade(j, k) {
    var mu = j.mu[k];
    if (mu < 0) return 0; // inside: black
    if (st.style === "ink") {
      // Distance estimate: dark only where the boundary is within a pixel or two.
      var t = j.de[k] / j.pixel;
      return Math.max(0, Math.min(255, Math.round(255 * (1 - Math.exp(-t * 0.9)))));
    }
    if (st.style === "bands") return Math.floor(mu) % 2 ? 235 : 40;
    var v = Math.log(mu + 1) * 2.2;
    return Math.round(128 + 120 * Math.cos(v * Math.PI));
  }

  // Fills the gray buffer; unfinished pixels take the nearest coarse sample.
  function paint(final) {
    var j = job, sw = j.sw, sh = j.sh, s = j.step, gray = new Uint8Array(sw * sh);
    for (var y = 0; y < sh; y++) {
      var by = final ? y : y - (y % s);
      for (var x = 0; x < sw; x++) {
        var bx = final ? x : x - (x % s), k = by * sw + bx;
        gray[y * sw + x] = j.done[k] ? shade(j, k) : 255;
      }
    }
    img = { gray: gray, sw: sw, sh: sh, q: j.q, dpr: j.dpr, mu: j.mu, de: j.de, pixel: j.pixel, done: j.done, step: j.step, version: ++imgVersion };
  }

  function recolor() {
    if (!img || job) return;
    var j = img, gray = new Uint8Array(j.sw * j.sh);
    for (var k = 0; k < gray.length; k++) gray[k] = j.done[k] ? shade(j, k) : 255;
    img.gray = gray;
  }

  // --- Navigation ---------------------------------------------------------------
  // Moves the center by a pixel offset (screen px) and zooms by factor.
  function navigate(dxPx, dyPx, zoom) {
    var v = viewRect(), unit = st.scale / v.w;
    var dre = dxPx * unit, dim = -dyPx * unit;
    var pixel = st.scale / zoom / (v.w * (RM.canvas.width / RM.W)) / st.quality;
    var limbs = F.limbsFor(Math.min(pixel, unit));
    var re = F.mpAdd(F.mpFromString(st.re, limbs), F.mpFromDouble(dre, limbs));
    var im = F.mpAdd(F.mpFromString(st.im, limbs), F.mpFromDouble(dim, limbs));
    var digits = Math.max(17, Math.ceil(-Math.log10(pixel)) + 6);
    st.re = trimZeros(F.mpToString(re, digits));
    st.im = trimZeros(F.mpToString(im, digits));
    st.scale /= zoom;
    save();
    startRender();
  }

  function trimZeros(s) { return s.indexOf(".") >= 0 ? s.replace(/0+$/, "").replace(/\.$/, "") : s; }

  RM.onPinch(function (e) {
    var v = viewRect();
    if (e.phase === "start") { frame = { x: v.x, y: v.y, w: v.w, h: v.h, cx: e.centerX, cy: e.centerY }; return; }
    if (!frame) return;
    var s = Math.max(0.05, Math.min(40, e.scale));
    if (e.phase === "move") {
      frame.w = v.w / s; frame.h = v.h / s;
      frame.x = frame.cx - frame.w / 2; frame.y = frame.cy - frame.h / 2;
    } else {
      var cx = frame.cx, cy = frame.cy;
      frame = null;
      if (Math.abs(s - 1) > 0.05) navigate(cx - v.w / 2, cy - v.h / 2, s);
    }
  });

  // --- Saving --------------------------------------------------------------------------
  function saveImage() {
    if (!img) { RM.toast("Render something first."); return; }
    if (job) { RM.toast("Wait for the render to finish."); return; }
    var name = "mandelbrot_" + RM.stamp();
    var png = F.pngGray(img.gray, img.sw, img.sh);
    var meta = "Mandelbrot view\ncenter re = " + st.re + "\ncenter im = " + st.im + "\nwidth = " + st.scale + "\nmax iterations = " + maxIter() + "\nstyle = " + st.style + "\nimage = " + img.sw + " x " + img.sh + " px, 8-bit grayscale PNG (lossless)\n";
    RM.saveFile(name + ".png", png, "image/png").then(function (p) {
      RM.saveFile(name + ".txt", meta, "text/plain");
      RM.toast("Saved " + img.sw + "×" + img.sh + " lossless PNG to " + p + " (coordinates in the .txt next to it).", 6000);
    }, function (e) { RM.toast("Couldn't save: " + e.message); });
  }

  // --- Drawing -------------------------------------------------------------------------
  var imageData = null, imageKey = "", imgVersion = 0;

  function drawImage(ctx, v) {
    if (!img) return;
    // Rebuild the RGBA buffer only when the gray image changed.
    var key = img.sw + "x" + img.sh + ":" + img.q + ":" + img.version;
    var dw = Math.min(Math.round(v.w * img.dpr), img.sw * img.q), dh = Math.min(Math.round(v.h * img.dpr), img.sh * img.q);
    if (!imageData || imageKey !== key) {
      imageData = ctx.createImageData(dw, dh);
      var d = imageData.data, q = img.q, sw = img.sw;
      for (var y = 0; y < dh; y++) {
        var row = Math.floor(y / q) * sw;
        for (var x = 0; x < dw; x++) {
          var g = img.gray[row + Math.floor(x / q)], o = (y * dw + x) * 4;
          d[o] = d[o + 1] = d[o + 2] = g;
          d[o + 3] = 255;
        }
      }
      imageKey = key;
    }
    ctx.putImageData(imageData, v.x * img.dpr, v.y * img.dpr);
  }

  function draw(ctx, W, H) {
    var m = Math.min(W, H);
    var toolH = RM.toolbar([
      { label: job ? "Stop" : "Render", fn: function () { if (job) { cancel(); info = "Stopped."; } else startRender(); }, bold: true, active: !job },
      { label: "Zoom out", fn: function () { navigate(0, 0, 1 / st.tapZoom); } },
      { label: "Style", fn: function () {
        RM.choose("Style", [{ label: "Smooth gray bands", value: "smooth" }, { label: "Ink lines (distance estimate)", value: "ink" }, { label: "Black and white bands", value: "bands" }],
          function (s) { if (s) { st.style = s; save(); if (img) { recolor(); img.version = ++imgVersion; } } }, { current: st.style });
      } },
      { label: "More", icon: "gear", fn: moreMenu },
      { label: "Save", fn: saveImage }
    ]);
    var v = viewRect();
    drawImage(ctx, v);
    if (!img) RM.text("Tap Render to draw the Mandelbrot set.", W / 2, v.h / 2, m * 0.035, { align: "center" });
    // Gesture frame
    if (frame) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#000";
      ctx.strokeRect(frame.x, frame.y, frame.w, frame.h);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#fff";
      ctx.strokeRect(frame.x + 3, frame.y + 3, frame.w - 6, frame.h - 6);
    }
    // Info box
    var depth = st.scale < 1e-3 ? st.scale.toExponential(2) : (+st.scale.toPrecision(3)).toString();
    var line1 = "width " + depth + " · zoom ×" + (3.2 / st.scale).toExponential(1) + " · " + maxIter() + " iterations · " + ["", "full", "½", "", "¼"][st.quality] + " resolution";
    var line2 = job ? "Rendering… pass " + ({ 8: 1, 4: 2, 2: 3, 1: 4 })[job.step] + " of 4" : info || "Tap to zoom ×" + st.tapZoom + " · drag to pan · pinch to frame";
    var px = m * 0.022, bw = Math.max(RM.measure(line1, px), RM.measure(line2, px)) + px * 1.4;
    RM.box(8, 8, Math.min(bw, W - 16), px * 3.3, { radius: 8, lineWidth: 2 });
    RM.text(line1, 8 + px * 0.7, 8 + px * 1.05, RM.fitPx(line1, W - 30, px), {});
    RM.text(line2, 8 + px * 0.7, 8 + px * 2.3, RM.fitPx(line2, W - 30, px), { bold: !!job });
    // Gestures on the image: tap = zoom in there; drag = pan.
    var start = null;
    RM.hit(0, 0, W, v.h, {
      down: function (x, y) { start = { x: x, y: y, moved: false }; },
      move: function (x, y) {
        if (!start) return;
        if (Math.abs(x - start.x) + Math.abs(y - start.y) > 14) start.moved = true;
        if (start.moved) frame = { x: v.x - (x - start.x), y: v.y - (y - start.y), w: v.w, h: v.h };
      },
      up: function (x, y) {
        if (!start) return;
        var s = start;
        start = null;
        if (s.moved) { frame = null; navigate(-(x - s.x), -(y - s.y), 1); }
        else navigate(x - v.w / 2, y - v.h / 2, st.tapZoom);
      }
    });
  }

  function moreMenu() {
    RM.choose("Options", [
      { label: "Locations…", value: "loc" },
      { label: "Quality: " + ({ 1: "full resolution", 2: "half (fast)", 4: "quarter (fastest)" })[st.quality], value: "quality" },
      { label: "Iterations: " + (st.iterMul === 1 ? "auto" : "auto ×" + st.iterMul) + " (" + maxIter() + ")", value: "iter" },
      { label: "Tap zoom: ×" + st.tapZoom, value: "tap" },
      { label: "Enter coordinates…", value: "coords" },
      { label: "Reset to the whole set", value: "reset" },
      { label: "About the speed tricks", value: "about" }
    ], function (v) {
      if (v === "loc") {
        RM.choose("Locations", LOCATIONS.map(function (l, i) { return { label: l.name, value: i }; }), function (i) {
          if (i === null || i === undefined) return;
          var l = LOCATIONS[i];
          st.re = l.re; st.im = l.im; st.scale = l.scale; save(); startRender();
        });
      } else if (v === "quality") {
        st.quality = st.quality === 2 ? 1 : st.quality === 1 ? 4 : 2; save(); moreMenu();
      } else if (v === "iter") {
        RM.choose("Iterations", [{ label: "Auto", value: 1 }, { label: "Auto ×2", value: 2 }, { label: "Auto ×4", value: 4 }, { label: "Auto ×10", value: 10 }, { label: "Auto ÷2", value: 0.5 }],
          function (x) { if (x) { st.iterMul = x; save(); } }, { current: st.iterMul });
      } else if (v === "tap") {
        st.tapZoom = st.tapZoom === 4 ? 10 : st.tapZoom === 10 ? 2 : 4; save(); moreMenu();
      } else if (v === "coords") {
        RM.prompt({ title: "Real part of the center", value: st.re, mode: "number" }, function (re) {
          if (re === null) return;
          RM.prompt({ title: "Imaginary part of the center", value: st.im, mode: "number" }, function (im) {
            if (im === null) return;
            RM.prompt({ title: "View width (e.g. 3.2 or 1e-20)", value: String(st.scale), mode: "number" }, function (w) {
              var sc = parseFloat(w);
              if (!(sc > 0)) return;
              st.re = re.trim(); st.im = im.trim(); st.scale = sc; save(); startRender();
            });
          });
        });
      } else if (v === "reset") {
        st.re = "-0.5"; st.im = "0"; st.scale = 3.2; save(); startRender();
      } else if (v === "about") {
        RM.showText("How it renders fast", "Shallow views use plain double precision with two shortcuts: points inside the main cardioid and the big circle are recognised instantly, and orbits that start repeating are stopped early (periodicity check).\n\nDeep views (narrower than about 1e-13 per pixel) use perturbation, the method Kalles Fraktaler made popular: one reference orbit is computed in high-precision fixed point at the center, and every pixel only iterates its small difference from that orbit in ordinary doubles. A series approximation skips the first stretch of iterations for all pixels at once, and 'rebasing' keeps the differences accurate without extra reference points.\n\nEvery view is rendered coarse-to-fine (8, 4, 2, 1 pixel steps). A point whose coarser neighbours all share the same iteration band is guessed instead of computed, which skips most of the flat areas.\n\nThe screen only refreshes after each of the four passes, and nothing runs once a render is done. Saved images are lossless 8-bit grayscale PNGs straight from the render buffer.");
      }
    });
  }

  RM.init({ draw: draw, resize: function () { if (img) img = null; } });
  startRender();
})();
