import QtQuick

// Desktop stand-in for AppLoad's backend bridge, for testing the frontend
// with the `qml` tool. It answers the htmlload protocol itself using
// XMLHttpRequest (run with QML_XHR_ALLOW_FILE_READ=1). Apps dir: --apps <dir>.
QtObject {
    id: mock
    property string applicationID
    signal messageReceived(int type, string contents)

    property string exportsDir: appsDir + "/../devtest/exports"
    property string appsDir: {
        const a = Qt.application.arguments;
        const i = a.indexOf("--apps");
        return i >= 0 ? a[i + 1] : "";
    }
    function later(fn) {
        const t = Qt.createQmlObject("import QtQuick; Timer { interval: 5 }", mock);
        t.triggered.connect(function () { fn(); t.destroy(); });
        t.start();
    }

    function readFile(path) {
        const x = new XMLHttpRequest();
        x.open("GET", "file://" + path, false);
        x.send();
        return x.status === 200 || x.status === 0 ? x.responseText : null;
    }

    // Type-7 parts are joined onto the next message, like the real backend.
    property string part: ""
    function sendMessage(type, msg) {
        if (type === 7) { part += msg; return; }
        if (part) { msg = part + msg; part = ""; }
        if (type === 5 || type === 6) {
            // Pretend to save: report the size, keep nothing.
            const parts = msg.split("\n");
            console.log("SAVE", type, parts[1], (parts[2] || "").length, "base64 chars");
            later(() => messageReceived(104, parts[0] + "\nok\n" + exportsDir + "/" + parts[1]));
            return;
        }
        if (type === 1) {
            // --list chess,spider,...  (QML can't list directories itself)
            const a = Qt.application.arguments, i = a.indexOf("--list");
            const names = i >= 0 ? a[i + 1].split(",") : ["chess"];
            later(() => messageReceived(100, JSON.stringify(names.map(n => (
                { name: n, dir: appsDir + "/" + n, entry: "index.html", icon: "icon.png", standalone: false, exports: exportsDir }
            )))));
        } else if (type === 2) {
            const nl = msg.indexOf("\n"), id = msg.substring(0, nl), path = msg.substring(nl + 1);
            const text = readFile(path);
            if (text === null || text === "") { later(() => messageReceived(102, id + "\nnot found")); return; }
            // Same 32 KB chunking as the real backend.
            const chunks = [];
            for (let i = 0; i < text.length; i += 32768) chunks.push(text.substring(i, i + 32768));
            chunks.forEach((c, i) => later(() => messageReceived(101, id + "\n" + i + "\n" + chunks.length + "\n" + c)));
        } else if (type === 3) {
            later(() => messageReceived(103, msg + "\n" + (store[msg] || "")));
        } else if (type === 4) {
            const nl = msg.indexOf("\n");
            store[msg.substring(0, nl)] = msg.substring(nl + 1);
            console.log("STORE_SAVE", msg.length, "bytes");
        }
    }
    // localStorage lives in memory for the session (XHR can't write files reliably).
    property var store: ({})
    function terminate() {}
}
