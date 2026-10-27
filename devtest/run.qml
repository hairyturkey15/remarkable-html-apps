import QtQuick
import QtQuick.Window

// Test harness: hosts ui/main.qml at a tablet-like size and runs a small
// script of actions passed with --script '[["wait",ms],["tap",x,y],["shot","f.png"],["js","code"],["quit"]]'.
Window {
    id: win
    width: 810; height: 1080
    visible: true
    color: "white"
    Loader { id: main; anchors.fill: parent; source: "../ui/main.qml" }

    property var script: {
        const a = Qt.application.arguments, i = a.indexOf("--script");
        return i >= 0 ? JSON.parse(a[i + 1]) : [["wait", 2000], ["shot", "shot.png"], ["quit"]];
    }
    property int step: 0

    function runtime() {
        // HtmlApp instance inside main.qml's Loader.
        const root = main.item;
        for (let i = 0; i < root.children.length; i++) {
            const c = root.children[i];
            if (c.item && c.item.sendPointer) return c.item;
        }
        return null;
    }

    Timer {
        id: ticker
        interval: 10
        onTriggered: win.next()
    }
    function next() {
        if (step >= script.length) return;
        const a = script[step++];
        if (a[0] === "wait") { ticker.interval = a[1]; ticker.start(); return; }
        if (a[0] === "tap") {
            const rt = runtime();
            if (rt) {
                rt.sendPointer(["pointerdown", "mousedown"], a[1], a[2]);
                rt.sendPointer(["pointerup", "mouseup", "click"], a[1], a[2]);
            } else console.log("no runtime");
        }
        if (a[0] === "open") main.item.openApp(main.item.apps[a[1]]);
        if (a[0] === "js") { const rt = runtime(); console.log("js:", eval(a[1])); }
        if (a[0] === "shot") {
            main.grabToImage(r => { r.saveToFile(a[1]); console.log("saved", a[1]); ticker.interval = 10; ticker.start(); });
            return;
        }
        if (a[0] === "quit") { Qt.quit(); return; }
        ticker.interval = 10; ticker.start();
    }
    Component.onCompleted: ticker.start()
}
