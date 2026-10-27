import QtQuick 2.5
import net.asivery.AppLoad 1.0

// HTML Loader: lists the HTML app folders the backend finds and runs the
// chosen one in HtmlApp.qml. A packaged single-app build (see package.sh)
// reports exactly one "standalone" app and opens straight into it.
Rectangle {
    id: root
    anchors.fill: parent
    color: "white"

    signal close
    function unloading() {
        if (appLoader.item) appLoader.item.shutdown();
    }

    property var apps: []
    property bool listReceived: false
    property var running: null
    property var pending: ({})
    property int nextRequestId: 1

    AppLoad {
        id: backend
        applicationID: "htmlload"
        onMessageReceived: (type, contents) => root.handleMessage(type, contents)
    }

    // ---------------------------------------------------------------
    // Backend requests (protocol documented in backend/entry.c)
    // ---------------------------------------------------------------
    function handleMessage(type, contents) {
        if (type === 100) {
            listReceived = true;
            try { apps = JSON.parse(contents); } catch (e) { apps = []; }
            if (!running && apps.length === 1 && apps[0].standalone) openApp(apps[0]);
            return;
        }
        const nl = contents.indexOf("\n");
        if (nl < 0) return;
        const key = contents.substring(0, nl);
        const rest = contents.substring(nl + 1);
        if (type === 101) {
            const req = pending[key];
            if (!req) return;
            const a = rest.indexOf("\n"), b = rest.indexOf("\n", a + 1);
            const index = parseInt(rest.substring(0, a));
            const count = parseInt(rest.substring(a + 1, b));
            req.chunks[index] = rest.substring(b + 1);
            req.received++;
            if (req.received === count) {
                delete pending[key];
                req.callback(null, req.chunks.join(""));
            }
        } else if (type === 102) {
            const req = pending[key];
            if (!req) return;
            delete pending[key];
            req.callback(rest || "read failed", null);
        } else if (type === 103) {
            const req = pending["store:" + key];
            if (!req) return;
            delete pending["store:" + key];
            req.callback(null, rest);
        }
    }

    function readFile(path, callback) {
        const id = String(nextRequestId++);
        pending[id] = { chunks: [], received: 0, callback: callback };
        backend.sendMessage(2, id + "\n" + path);
    }

    function loadStore(dir, callback) {
        pending["store:" + dir] = { callback: callback };
        backend.sendMessage(3, dir);
    }

    function saveStore(dir, json) {
        backend.sendMessage(4, dir + "\n" + json);
    }

    function refreshList() {
        backend.sendMessage(1, "list");
    }

    function openApp(app) {
        running = app;
        appLoader.setSource("HtmlApp.qml", { host: root, appInfo: app });
    }

    function closeApp() {
        if (running && running.standalone) {
            root.close();
            return;
        }
        if (appLoader.item) appLoader.item.shutdown();
        appLoader.source = "";
        running = null;
        refreshList();
    }

    // The backend pushes the list when we attach, but our own request can
    // still race its connect(); retry a few times until a list arrives.
    Timer {
        id: listRetry
        interval: 700
        repeat: true
        running: !root.listReceived
        property int tries: 0
        onTriggered: {
            if (++tries > 10) stop();
            root.refreshList();
        }
    }
    Component.onCompleted: refreshList()

    // ---------------------------------------------------------------
    // Launcher
    // ---------------------------------------------------------------
    Item {
        id: launcher
        anchors.fill: parent
        visible: root.running === null

        Text {
            id: heading
            text: "HTML Apps"
            font.pixelSize: 56
            font.bold: true
            anchors.left: parent.left
            anchors.top: parent.top
            anchors.margins: 40
        }

        Rectangle {
            id: refreshButton
            width: 200; height: 72
            radius: 12
            border.width: 3
            border.color: "black"
            anchors.right: parent.right
            anchors.verticalCenter: heading.verticalCenter
            anchors.rightMargin: 40
            Text { anchors.centerIn: parent; text: "Refresh"; font.pixelSize: 30 }
            MouseArea { anchors.fill: parent; onClicked: root.refreshList() }
        }

        Text {
            anchors.top: heading.bottom
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.margins: 40
            visible: root.apps.length === 0
            wrapMode: Text.WordWrap
            font.pixelSize: 30
            text: root.listReceived
                ? "No HTML apps found.\n\nCopy a folder that contains an index.html into\n/home/root/xovi/exthome/html-apps/ and tap Refresh."
                : "Waiting for the backend…"
        }

        GridView {
            id: grid
            anchors.top: heading.bottom
            anchors.topMargin: 40
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            anchors.leftMargin: 30
            clip: true
            model: root.apps
            cellWidth: Math.max(240, Math.floor(width / Math.max(1, Math.floor(width / 280))))
            cellHeight: 320
            delegate: Item {
                width: grid.cellWidth
                height: grid.cellHeight
                Rectangle {
                    anchors.fill: parent
                    anchors.margins: 14
                    radius: 18
                    border.width: 3
                    border.color: "black"
                    Image {
                        id: tileIcon
                        anchors.top: parent.top
                        anchors.topMargin: 24
                        anchors.horizontalCenter: parent.horizontalCenter
                        width: 170; height: 170
                        fillMode: Image.PreserveAspectFit
                        source: modelData.icon ? "file://" + modelData.dir + "/" + modelData.icon : ""
                        visible: status === Image.Ready
                    }
                    Text {
                        anchors.centerIn: tileIcon
                        visible: !tileIcon.visible
                        text: "</>"
                        font.pixelSize: 64
                        font.bold: true
                    }
                    Text {
                        anchors.bottom: parent.bottom
                        anchors.bottomMargin: 22
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.margins: 10
                        horizontalAlignment: Text.AlignHCenter
                        elide: Text.ElideRight
                        font.pixelSize: 30
                        text: modelData.name
                    }
                    MouseArea { anchors.fill: parent; onClicked: root.openApp(modelData) }
                }
            }
        }
    }

    Loader {
        id: appLoader
        anchors.fill: parent
    }
    Connections {
        target: appLoader.item
        ignoreUnknownSignals: true
        function onRequestClose() { root.closeApp(); }
    }
}
