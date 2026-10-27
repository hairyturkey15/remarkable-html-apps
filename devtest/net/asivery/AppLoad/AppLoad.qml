import QtQuick

// Desktop stand-in for AppLoad's backend bridge, for testing the frontend
// with the `qml` tool. It answers the htmlload protocol itself using
// XMLHttpRequest (run with QML_XHR_ALLOW_FILE_READ=1). Apps dir: --apps <dir>.
QtObject {
    id: mock
    property string applicationID
    signal messageReceived(int type, string contents)

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

    function sendMessage(type, msg) {
        if (type === 1) {
            later(() => messageReceived(100, JSON.stringify([
                { name: "Chess", dir: appsDir + "/chess", entry: "index.html", icon: "icon.png", standalone: false }
            ])));
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
