import QtQuick 2.5

// Runs one HTML app folder inside QML.
//
// There is no web engine on the tablet, so this is a small browser-like
// runtime for *canvas* apps: the page's <script>s run in QML's JavaScript
// engine against shims for window/document/canvas/Image/timers/
// localStorage, and the page's <canvas> is this Canvas item. HTML layout
// and CSS are not rendered.
//
// E-ink rule: nothing here runs on its own. The canvas is only repainted
// after an input event, a timer the page set itself, or an image load -
// and only if the page actually drew something in that callback.
Item {
    id: app
    property var host
    property var appInfo: ({})

    signal requestClose

    property string baseDir: ""
    property var listeners: ({})
    property var timers: ({})
    property int nextTimerId: 1
    property var pendingImages: []
    property var store: ({})
    property bool storeDirty: false
    property bool dirty: false
    property bool started: false
    property bool closeButtonVisible: !app.appInfo.standalone
    property var env: null

    function shutdown() {
        for (const id in timers) {
            timers[id].stop();
            timers[id].destroy();
        }
        timers = {};
        if (storeDirty) flushStore();
    }

    // ---------------------------------------------------------------
    // Paths
    // ---------------------------------------------------------------
    function resolvePath(base, rel) {
        rel = rel.replace(/[?#].*$/, "");
        const parts = (rel.charAt(0) === "/" ? rel : base + "/" + rel).split("/");
        const out = [];
        for (const p of parts) {
            if (p === "" || p === ".") continue;
            if (p === "..") out.pop();
            else out.push(p);
        }
        return "/" + out.join("/");
    }

    function fileUrl(rel) {
        if (/^(file|qrc|data):/.test(rel)) return rel;
        return "file://" + encodeURI(resolvePath(baseDir, rel));
    }

    function readText(path) {
        return new Promise((resolve, reject) => host.readFile(path, (err, text) => err ? reject(new Error(path + ": " + err)) : resolve(text)));
    }

    // ---------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------
    function showError(prefix, e) {
        const msg = prefix + ": " + (e && e.message ? e.message : String(e)) +
            (e && e.lineNumber ? " (line " + e.lineNumber + ")" : "") +
            (e && e.stack ? "\n" + e.stack : "");
        console.log("[htmlload] " + msg);
        errorText.text = msg;
        errorBox.visible = true;
    }

    // Every callback into page code goes through here so a thrown error is
    // shown instead of silently killing the app, and the canvas repaints
    // once afterwards if (and only if) the page drew something.
    function invoke(label, fn, args) {
        try {
            fn.apply(null, args || []);
        } catch (e) {
            showError(label, e);
        }
        flush();
    }

    function flush() {
        if (dirty) {
            dirty = false;
            canvas.requestPaint();
        }
    }

    // ---------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------
    function addListener(target, type, fn) {
        const key = target + ":" + type;
        if (!listeners[key]) listeners[key] = [];
        if (listeners[key].indexOf(fn) < 0) listeners[key].push(fn);
    }

    function removeListener(target, type, fn) {
        const list = listeners[target + ":" + type];
        if (!list) return;
        const i = list.indexOf(fn);
        if (i >= 0) list.splice(i, 1);
    }

    function dispatch(target, type, ev) {
        const list = listeners[target + ":" + type];
        if (!list || list.length === 0) return;
        for (const fn of list.slice()) {
            try {
                if (typeof fn === "function") fn(ev);
                else if (fn && typeof fn.handleEvent === "function") fn.handleEvent(ev);
            } catch (e) {
                showError(type + " handler", e);
            }
        }
    }

    function pointerEvent(type, x, y) {
        const ev = {
            type: type, x: x, y: y, offsetX: x, offsetY: y, clientX: x, clientY: y, pageX: x, pageY: y,
            button: 0, buttons: type === "pointerup" || type === "mouseup" || type === "click" ? 0 : 1,
            pointerId: 1, pointerType: "touch", isPrimary: true, timeStamp: Date.now(),
            target: env ? env.canvasEl : null, currentTarget: env ? env.canvasEl : null,
            defaultPrevented: false,
            preventDefault: function () { this.defaultPrevented = true; },
            stopPropagation: function () {}
        };
        return ev;
    }

    // Pointer events go to the canvas, then bubble to document and window,
    // which is how browser pages usually listen.
    function sendPointer(types, x, y) {
        for (const t of types) {
            const ev = pointerEvent(t, x, y);
            dispatch("canvas", t, ev);
            dispatch("document", t, ev);
            dispatch("window", t, ev);
        }
        flush();
    }

    // ---------------------------------------------------------------
    // Timers (only exist while the page asks for them)
    // ---------------------------------------------------------------
    function makeTimer(fn, ms, repeat, args) {
        const id = nextTimerId++;
        const t = Qt.createQmlObject("import QtQuick 2.5; Timer {}", app);
        t.interval = Math.max(1, ms | 0);
        t.repeat = repeat;
        t.triggered.connect(function () {
            if (!repeat) clearTimer(id);
            if (typeof fn === "function") invoke("timer", fn, args);
        });
        timers[id] = t;
        t.start();
        return id;
    }

    function clearTimer(id) {
        const t = timers[id];
        if (!t) return;
        t.stop();
        delete timers[id];
        t.destroy();
    }

    // ---------------------------------------------------------------
    // localStorage, persisted by the backend into the app folder
    // ---------------------------------------------------------------
    function touchStore() {
        storeDirty = true;
        storeSaveTimer.restart();
    }

    function flushStore() {
        storeDirty = false;
        host.saveStore(app.appInfo.dir, JSON.stringify(store));
    }

    Timer {
        id: storeSaveTimer
        interval: 800
        onTriggered: app.flushStore()
    }

    function makeLocalStorage() {
        const ls = {
            getItem: function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
            setItem: function (k, v) { store[String(k)] = String(v); touchStore(); },
            removeItem: function (k) { delete store[String(k)]; touchStore(); },
            clear: function () { store = {}; touchStore(); },
            key: function (i) { const keys = Object.keys(store); return i < keys.length ? keys[i] : null; }
        };
        Object.defineProperty(ls, "length", { get: function () { return Object.keys(store).length; } });
        return ls;
    }

    // ---------------------------------------------------------------
    // Images: drawn straight from disk through the Canvas image cache
    // ---------------------------------------------------------------
    function makeImageClass() {
        function HtmlImage(w, h) {
            this._url = "";
            this._src = "";
            this.complete = false;
            this.naturalWidth = this.width = w || 0;
            this.naturalHeight = this.height = h || 0;
            this.onload = null;
            this.onerror = null;
            this._listeners = {};
        }
        HtmlImage.prototype.addEventListener = function (type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); };
        HtmlImage.prototype.removeEventListener = function (type, fn) {
            const l = this._listeners[type];
            if (l && l.indexOf(fn) >= 0) l.splice(l.indexOf(fn), 1);
        };
        HtmlImage.prototype._fire = function (type) {
            const self = this;
            const handlers = (this._listeners[type] || []).slice();
            const prop = this["on" + type];
            if (typeof prop === "function") handlers.unshift(prop);
            for (const h of handlers) invoke("image " + type, function () { h.call(self, { type: type, target: self }); });
        };
        HtmlImage.prototype.decode = function () {
            const self = this;
            return new Promise(function (resolve, reject) {
                if (self.complete) resolve();
                else { self.addEventListener("load", resolve); self.addEventListener("error", reject); }
            });
        };
        Object.defineProperty(HtmlImage.prototype, "src", {
            get: function () { return this._src; },
            set: function (v) {
                this._src = String(v);
                this._url = fileUrl(this._src);
                this.complete = false;
                if (canvas.isImageLoaded(this._url)) imageReady(this);
                else {
                    pendingImages.push(this);
                    canvas.loadImage(this._url);
                }
            }
        });
        return HtmlImage;
    }

    function imageReady(img) {
        img.complete = true;
        try {
            const data = canvas.getContext("2d").createImageData(img._url);
            if (!img.width) img.width = img.naturalWidth = data.width;
            if (!img.height) img.height = img.naturalHeight = data.height;
        } catch (e) {}
        img._fire("load");
    }

    function checkPendingImages() {
        const still = [];
        for (const img of pendingImages) {
            if (canvas.isImageLoaded(img._url)) imageReady(img);
            else if (canvas.isImageError(img._url)) {
                img._fire("error");
                console.log("[htmlload] image failed: " + img._url);
            } else still.push(img);
        }
        pendingImages = still;
        flush();
    }

    // ---------------------------------------------------------------
    // 2D context wrapper: marks the frame dirty, accepts our Image
    // objects in drawImage, and stubs the few browser-only methods.
    // ---------------------------------------------------------------
    function makeContext(real, canvasEl) {
        const extras = {
            canvas: canvasEl,
            drawImage: function (img) {
                const args = Array.prototype.slice.call(arguments);
                if (img && img._url !== undefined) {
                    if (!img.complete) return;
                    args[0] = img._url;
                } else if (img && img._isCanvasShim) {
                    return;
                }
                app.dirty = true;
                real.drawImage.apply(real, args);
            },
            roundRect: function (x, y, w, h, r) {
                r = Math.min(Array.isArray(r) ? r[0] : (r || 0), w / 2, h / 2);
                real.moveTo(x + r, y);
                real.arcTo(x + w, y, x + w, y + h, r);
                real.arcTo(x + w, y + h, x, y + h, r);
                real.arcTo(x, y + h, x, y, r);
                real.arcTo(x, y, x + w, y, r);
                real.closePath();
            },
            setLineDash: function () {},
            getLineDash: function () { return []; },
            resetTransform: function () { real.setTransform(1, 0, 0, 1, 0, 0); }
        };
        return new Proxy({}, {
            get: function (t, prop) {
                if (Object.prototype.hasOwnProperty.call(extras, prop)) {
                    if (prop === "roundRect" && typeof real.roundRect === "function") {
                        return function () { app.dirty = true; return real.roundRect.apply(real, arguments); };
                    }
                    return extras[prop];
                }
                const v = real[prop];
                if (typeof v === "function") {
                    return function () { app.dirty = true; return v.apply(real, arguments); };
                }
                return v;
            },
            set: function (t, prop, value) {
                real[prop] = value;
                return true;
            }
        });
    }

    // ---------------------------------------------------------------
    // window / document
    // ---------------------------------------------------------------
    function makeElement(tag, id) {
        return {
            tagName: tag.toUpperCase(), id: id || "", style: {}, dataset: {}, children: [], childNodes: [],
            classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
            textContent: "", innerHTML: "", innerText: "",
            appendChild(c) { return c; }, removeChild(c) { return c; }, insertBefore(c) { return c; },
            setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
            addEventListener() {}, removeEventListener() {},
            getBoundingClientRect() { return { left: 0, top: 0, x: 0, y: 0, width: 0, height: 0, right: 0, bottom: 0 }; },
            focus() {}, blur() {}
        };
    }

    function buildEnv(canvasIds) {
        const e = {};
        let ctx2d = null;

        const canvasEl = makeElement("canvas", canvasIds.length ? canvasIds[0] : "canvas");
        canvasEl._isCanvasShim = true;
        Object.defineProperty(canvasEl, "width", { get: () => Math.round(canvas.width), set: () => {} });
        Object.defineProperty(canvasEl, "height", { get: () => Math.round(canvas.height), set: () => {} });
        Object.defineProperty(canvasEl, "clientWidth", { get: () => Math.round(canvas.width) });
        Object.defineProperty(canvasEl, "clientHeight", { get: () => Math.round(canvas.height) });
        Object.defineProperty(canvasEl, "offsetWidth", { get: () => Math.round(canvas.width) });
        Object.defineProperty(canvasEl, "offsetHeight", { get: () => Math.round(canvas.height) });
        canvasEl.getContext = function (type) {
            if (type !== "2d") return null;
            if (!ctx2d) ctx2d = makeContext(canvas.getContext("2d"), canvasEl);
            return ctx2d;
        };
        canvasEl.getBoundingClientRect = function () {
            return { left: 0, top: 0, x: 0, y: 0, width: canvas.width, height: canvas.height, right: canvas.width, bottom: canvas.height };
        };
        canvasEl.addEventListener = (t, fn) => addListener("canvas", t, fn);
        canvasEl.removeEventListener = (t, fn) => removeListener("canvas", t, fn);
        canvasEl.setPointerCapture = function () {};
        canvasEl.releasePointerCapture = function () {};
        e.canvasEl = canvasEl;

        const body = makeElement("body");
        body.appendChild = function (c) { return c; };
        const elements = {};
        const doc = {
            title: app.appInfo.name || "",
            body: body,
            documentElement: makeElement("html"),
            readyState: "loading",
            getElementById: function (id) {
                if (canvasIds.indexOf(id) >= 0 || canvasIds.length === 0) return canvasEl;
                return elements[id] || (elements[id] = makeElement("div", id));
            },
            querySelector: function (sel) {
                if (/canvas/i.test(sel) || (sel.charAt(0) === "#" && canvasIds.indexOf(sel.substring(1)) >= 0)) return canvasEl;
                if (sel.charAt(0) === "#") return doc.getElementById(sel.substring(1));
                if (sel === "body") return body;
                return null;
            },
            querySelectorAll: function (sel) { const el = doc.querySelector(sel); return el ? [el] : []; },
            getElementsByTagName: function (tag) { return /canvas/i.test(tag) ? [canvasEl] : (/body/i.test(tag) ? [body] : []); },
            createElement: function (tag) { return /canvas/i.test(tag) ? canvasEl : makeElement(tag); },
            addEventListener: (t, fn) => addListener("document", t, fn),
            removeEventListener: (t, fn) => removeListener("document", t, fn),
            hasFocus: () => true,
            hidden: false,
            visibilityState: "visible"
        };

        const win = {
            document: doc,
            localStorage: makeLocalStorage(),
            devicePixelRatio: 1,
            navigator: { userAgent: "htmlload (reMarkable; QML)", language: "en", maxTouchPoints: 1, platform: "reMarkable" },
            location: { href: "file://" + baseDir + "/" + (app.appInfo.entry || "index.html"), protocol: "file:", search: "", hash: "", pathname: baseDir, reload: function () {} },
            performance: { now: () => Date.now() - startTime },
            addEventListener: (t, fn) => addListener("window", t, fn),
            removeEventListener: (t, fn) => removeListener("window", t, fn),
            setTimeout: (fn, ms, ...a) => makeTimer(fn, ms, false, a),
            setInterval: (fn, ms, ...a) => makeTimer(fn, ms, true, a),
            clearTimeout: (id) => clearTimer(id),
            clearInterval: (id) => clearTimer(id),
            requestAnimationFrame: (fn) => makeTimer(function () { fn(Date.now() - startTime); }, 16, false, []),
            cancelAnimationFrame: (id) => clearTimer(id),
            alert: function (msg) { errorText.text = String(msg); errorBox.visible = true; },
            confirm: function () { return true; },
            prompt: function (m, d) { return d === undefined ? null : d; },
            matchMedia: function (q) { return { matches: /prefers-reduced-motion/.test(q), addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }; },
            getComputedStyle: function () { return {}; },
            fetch: function (url) {
                return readText(resolvePath(baseDir, url)).then(text => ({
                    ok: true, status: 200,
                    text: () => Promise.resolve(text),
                    json: () => Promise.resolve(JSON.parse(text))
                }));
            },
            close: function () { app.requestClose(); },
            // Extra API for pages that know they run on the tablet.
            htmlload: {
                platform: "remarkable",
                standalone: !!app.appInfo.standalone,
                setCloseButtonVisible: function (v) { app.closeButtonVisible = !!v && !app.appInfo.standalone; },
                close: function () { app.requestClose(); }
            },
            console: console,
            Image: makeImageClass()
        };
        Object.defineProperty(win, "innerWidth", { get: () => Math.round(canvas.width) });
        Object.defineProperty(win, "innerHeight", { get: () => Math.round(canvas.height) });
        Object.defineProperty(win, "screen", { get: () => ({ width: Math.round(canvas.width), height: Math.round(canvas.height) }) });
        win.window = win.self = win.globalThis = win;
        doc.defaultView = win;
        e.window = win;
        return e;
    }

    // Names the page's scripts see as globals.
    readonly property var globalNames: [
        "window", "self", "document", "localStorage", "navigator", "location", "performance",
        "setTimeout", "setInterval", "clearTimeout", "clearInterval",
        "requestAnimationFrame", "cancelAnimationFrame", "alert", "confirm", "prompt",
        "matchMedia", "getComputedStyle", "fetch", "Image", "htmlload"
    ]
    property double startTime: Date.now()

    // ---------------------------------------------------------------
    // Loading
    // ---------------------------------------------------------------
    function parseHtml(html) {
        const scripts = [];
        const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
        let m;
        while ((m = re.exec(html)) !== null) {
            const attrs = m[1];
            const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs);
            if (type && !/javascript|module|ecmascript/i.test(type[1])) continue;
            const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
            scripts.push(src ? { src: src[1] } : { code: m[2] });
        }
        const canvasIds = [];
        const cre = /<canvas\b[^>]*\bid\s*=\s*["']([^"']+)["']/gi;
        while ((m = cre.exec(html)) !== null) canvasIds.push(m[1]);
        const bg = /<body\b[^>]*background(?:-color)?\s*:\s*([#\w]+)/i.exec(html);
        return { scripts: scripts, canvasIds: canvasIds, background: bg ? bg[1] : "white" };
    }

    function start() {
        if (started || !canvas.available || !host) return;
        started = true;
        const entryPath = resolvePath(app.appInfo.dir, app.appInfo.entry || "index.html");
        baseDir = entryPath.substring(0, entryPath.lastIndexOf("/"));

        new Promise(resolve => host.loadStore(app.appInfo.dir, (err, json) => {
            try { store = json ? JSON.parse(json) : {}; } catch (e) { store = {}; }
            resolve();
        })).then(() => readText(entryPath)).then(html => {
            const page = parseHtml(html);
            app.color = page.background;
            return Promise.all(page.scripts.map(s => s.src
                ? (/^https?:/.test(s.src) ? Promise.reject(new Error("remote scripts are not supported: " + s.src)) : readText(resolvePath(baseDir, s.src)))
                : Promise.resolve(s.code))).then(sources => ({ page: page, sources: sources }));
        }).then(loaded => {
            env = buildEnv(loaded.page.canvasIds);
            const w = env.window;
            const values = globalNames.map(n => n === "Image" ? w.Image : w[n]);
            // All scripts share one function scope, so top-level functions
            // and vars in one <script> are visible to the next, as in a page.
            const body = loaded.sources.map((s, i) => "// ---- script " + i + "\n" + s).join("\n;\n");
            const fn = new Function(globalNames.join(","), body);
            invoke("script", function () { fn.apply(w, values); });
            w.document.readyState = "complete";
            dispatch("document", "DOMContentLoaded", { type: "DOMContentLoaded" });
            dispatch("window", "load", { type: "load" });
            flush();
        }).catch(e => showError("Could not load " + (app.appInfo.name || "app"), e));
    }

    property color color: "white"
    Rectangle { anchors.fill: parent; color: app.color }

    Canvas {
        id: canvas
        anchors.fill: parent
        onAvailableChanged: app.start()
        onImageLoaded: app.checkPendingImages()
        onWidthChanged: resizeDebounce.restart()
        onHeightChanged: resizeDebounce.restart()
    }

    Timer {
        id: resizeDebounce
        interval: 60
        onTriggered: {
            if (!app.env) return;
            app.dispatch("window", "resize", { type: "resize" });
            app.flush();
        }
    }

    MouseArea {
        anchors.fill: parent
        property real downX: 0
        property real downY: 0
        property bool moved: false
        onPressed: (mouse) => {
            downX = mouse.x; downY = mouse.y; moved = false;
            app.sendPointer(["pointerdown", "mousedown"], mouse.x, mouse.y);
        }
        onPositionChanged: (mouse) => {
            if (Math.abs(mouse.x - downX) + Math.abs(mouse.y - downY) > 12) moved = true;
            app.sendPointer(["pointermove", "mousemove"], mouse.x, mouse.y);
        }
        onReleased: (mouse) => {
            app.sendPointer(moved ? ["pointerup", "mouseup"] : ["pointerup", "mouseup", "click"], mouse.x, mouse.y);
        }
        onCanceled: app.sendPointer(["pointercancel"], downX, downY)
    }

    // Back to the launcher (hidden for packaged single-app builds, and for
    // pages that call htmlload.setCloseButtonVisible(false)).
    Rectangle {
        visible: app.closeButtonVisible
        anchors.top: parent.top
        anchors.right: parent.right
        anchors.margins: 12
        width: 64; height: 64; radius: 32
        color: "white"
        border.width: 3
        border.color: "black"
        Text { anchors.centerIn: parent; text: "✕"; font.pixelSize: 32 }
        MouseArea { anchors.fill: parent; onClicked: app.requestClose() }
    }

    Rectangle {
        id: errorBox
        visible: false
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.margins: 20
        height: Math.min(parent.height / 2, errorText.paintedHeight + 40)
        color: "white"
        border.width: 4
        border.color: "black"
        Text {
            id: errorText
            anchors.fill: parent
            anchors.margins: 20
            wrapMode: Text.WrapAnywhere
            font.pixelSize: 24
        }
        MouseArea { anchors.fill: parent; onClicked: errorBox.visible = false }
    }

    Component.onCompleted: start()
}
